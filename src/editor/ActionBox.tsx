import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react'
import type { Editor } from '@tiptap/core'
import { useServerFn } from '@tanstack/react-start'
import {
  ArrowUp,
  CircleCheck,
  FoldVertical,
  ListCollapse,
  LoaderCircle,
  Merge,
  MessagesSquare,
  Mic,
  PenLine,
  SpellCheck,
  UnfoldVertical,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { parseSectionRefs } from '../ai/section-refs'
import type { ActionResponse, ActionType, ChatMessage, EntryPoint, SectionComment } from '../ai/types'
import type { DocumentRecord } from '../lib/types'
import { IconButton } from '../lib/ui'
import { chatFn, runActionFn } from '../server/ai'
import { applyAiEdits, sectionsWithPendingAi, snapshotSections } from './ai-client'
import { anchorFor } from './anchor'
import { listSections } from './sections'
import { useDictation } from './use-dictation'

export interface ActionRequestDraft {
  entry: EntryPoint
  /** Selected sections; empty for inline and document prompts. */
  targets: string[]
  /** Inline prompts arrive with their instruction and run at once. */
  instruction?: string
  previousSectionId?: string | null
}

type Done = { suggested: number; filled: number; note: string; comments: SectionComment[]; meta: string }

type State =
  | { step: 'input' }
  | { step: 'running'; label: string }
  | { step: 'ask'; question: string; instruction: string; preset: ActionType | null }
  | { step: 'done'; done: Done }
  | { step: 'error'; message: string }

const PRESETS: {
  action: ActionType
  icon: LucideIcon
  label: string
  instruction: string
  when: (n: number, entry: EntryPoint) => boolean
}[] = [
  { action: 'expand', icon: UnfoldVertical, label: 'Expand', instruction: 'Expand this: add detail and explanation, about double the length.', when: (_, e) => e !== 'document' },
  { action: 'shorten', icon: FoldVertical, label: 'Shorten', instruction: 'Shorten this: keep the key points and cut about a third.', when: () => true },
  { action: 'rewrite', icon: PenLine, label: 'Rewrite for clarity', instruction: 'Rewrite this for clarity and flow, keeping the meaning.', when: (_, e) => e !== 'document' },
  { action: 'merge', icon: Merge, label: 'Merge into one section', instruction: 'Merge these sections into one coherent section.', when: (n) => n > 1 },
  { action: 'summarize', icon: ListCollapse, label: 'Summarize and replace', instruction: 'Replace this with a concise summary of it.', when: (_, e) => e !== 'document' },
  { action: 'check', icon: SpellCheck, label: 'Check consistency and terminology', instruction: 'Check consistency and terminology. Report each issue with a suggested fix.', when: () => true },
]

/** [3, 4, 5, 8] → "3–5, 8" */
export function formatNumbers(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  const runs: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    runs.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]))
    i = j
  }
  return runs.join(', ')
}

function useNarrow() {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)')
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return narrow
}

interface Props {
  editor: Editor
  doc: DocumentRecord
  draft: ActionRequestDraft
  onClose: () => void
}

/**
 * The chat or voice box for section, multi-section and document actions, and the
 * status box for inline `//` prompts. One-shot: one instruction, one suggestion.
 * Chat: refine the request back and forth, then run it.
 */
export function ActionBox({ editor, doc, draft, onClose }: Props) {
  const runAction = useServerFn(runActionFn)
  const chat = useServerFn(chatFn)
  const [mode, setMode] = useState<'oneshot' | 'chat'>('oneshot')
  const [input, setInput] = useState('')
  const [answer, setAnswer] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [agreed, setAgreed] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [state, setState] = useState<State>({ step: 'input' })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const started = useRef(false)
  const dictation = useDictation(doc.language, (text) => setInput((v) => (v ? `${v} ${text}` : text)))

  // Sit beside the target sections, to the right of the text column.
  const anchor = useMemo(() => anchorFor(editor, draft), [editor, draft])
  const narrow = useNarrow()
  const floating = anchor.kind === 'floating' && !narrow
  const { refs, floatingStyles } = useFloating({
    placement: anchor.kind === 'floating' ? anchor.placement : 'right-start',
    strategy: 'fixed',
    middleware: [offset(28), flip({ fallbackPlacements: ['left-start', 'bottom-end'] }), shift({ padding: 12, crossAxis: true })],
    whileElementsMounted: (reference, el, update) => autoUpdate(reference, el, update, { animationFrame: true }),
  })
  useEffect(() => {
    if (anchor.kind === 'floating') {
      refs.setPositionReference({ getBoundingClientRect: anchor.getRect, contextElement: editor.view.dom })
    }
  }, [anchor, refs, editor])

  const numberOf = (id: string) => listSections(editor.state.doc).find((s) => s.id === id)?.number
  const label = (ids: string[]) => formatNumbers(ids.map(numberOf).filter((n): n is number => n !== undefined))
  const title =
    draft.entry === 'document'
      ? 'Whole document'
      : draft.entry === 'inline'
        ? 'Inline prompt'
        : `§ ${label(draft.targets)}`

  async function run(instruction: string, preset: ActionType | null, selection = draft.targets, entry = draft.entry) {
    const pending = sectionsWithPendingAi(editor, selection)
    if (pending.length > 0) {
      setState({
        step: 'error',
        message: `Section ${label(pending)} has pending AI suggestions. Accept or reject them first.`,
      })
      return
    }
    setState({ step: 'running', label: instruction })
    try {
      const response: ActionResponse = await runAction({
        data: {
          documentId: doc.id,
          entry,
          instruction,
          language: doc.language,
          model: doc.settings.model,
          selection,
          previousSectionId: draft.previousSectionId ?? null,
          sections: snapshotSections(editor),
          presetAction: preset,
        },
      })
      if (response.kind === 'needs-target') {
        setState({ step: 'ask', question: response.question, instruction, preset })
      } else if (response.kind === 'error') {
        setState({ step: 'error', message: response.message })
      } else {
        const counts = applyAiEdits(editor, response.edits)
        setState({
          step: 'done',
          done: {
            ...counts,
            note: response.note,
            comments: response.comments,
            meta: `${response.decision.action} · ${response.model} · ${response.decision.decidedBy}`,
          },
        })
      }
    } catch {
      setState({ step: 'error', message: 'Could not reach the server.' })
    }
  }

  // Inline prompts run as soon as they fire.
  useEffect(() => {
    if (draft.instruction && !started.current) {
      started.current = true
      void run(draft.instruction, null)
    } else {
      inputRef.current?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function answerTarget(text: string) {
    if (state.step !== 'ask') return
    // "3", "2-4", "2, 5": resolved to IDs now, against the current numbering.
    const sections = listSections(editor.state.doc)
    const ids = parseSectionRefs(`sections ${text}`)
      .map((n) => sections[n - 1]?.id)
      .filter((id): id is string => !!id)
    if (ids.length === 0) return
    void run(state.instruction, state.preset, ids, ids.length > 1 ? 'multi' : 'section')
  }

  async function sendChat(text: string) {
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setChatBusy(true)
    try {
      const res = await chat({
        data: { language: doc.language, targets: draft.targets, sections: snapshotSections(editor), messages: next },
      })
      if (res.kind === 'error') setState({ step: 'error', message: res.message })
      else {
        setMessages([...next, { role: 'assistant', content: res.reply }])
        setAgreed(res.instruction)
      }
    } catch {
      setState({ step: 'error', message: 'Could not reach the server.' })
    } finally {
      setChatBusy(false)
    }
  }

  const submit = () => {
    const text = input.trim()
    if (!text) return
    if (mode === 'chat') void sendChat(text)
    else void run(text, null)
  }

  const onKey = (e: React.KeyboardEvent, send: () => void) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const presets = PRESETS.filter((p) => p.when(draft.targets.length, draft.entry))
  const canEdit = state.step === 'input' || state.step === 'error'
  const placement = floating ? 'floating' : narrow ? 'sheet' : 'docked'

  return (
    <div
      ref={refs.setFloating}
      className={`action-box ${placement}`}
      style={floating ? floatingStyles : undefined}
      role="dialog"
      aria-label="AI action"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <header>
        <span className="target">{title}</span>
        {canEdit && draft.entry !== 'inline' && (
          <div className="segmented" role="group" aria-label="Mode">
            <IconButton icon={Zap} label="One-shot: one instruction, one suggestion" pressed={mode === 'oneshot'} size={14} onClick={() => setMode('oneshot')} />
            <IconButton icon={MessagesSquare} label="Chat: refine the request before running it" pressed={mode === 'chat'} size={14} onClick={() => setMode('chat')} />
          </div>
        )}
        <IconButton icon={X} label="Close" shortcut="Esc" size={15} onClick={onClose} />
      </header>

      {canEdit && mode === 'oneshot' && presets.length > 0 && draft.entry !== 'inline' && (
        <div className="presets" role="group" aria-label="Presets">
          {presets.map((p) => (
            <IconButton key={p.action} icon={p.icon} label={p.label} onClick={() => run(p.instruction, p.action)} />
          ))}
        </div>
      )}

      {canEdit && mode === 'chat' && messages.length > 0 && (
        <div className="chat">
          {messages.map((m, i) => (
            <p key={i} className={m.role}>
              {m.content}
            </p>
          ))}
          {chatBusy && (
            <p className="assistant pending">
              <LoaderCircle size={14} className="spin" aria-label="Thinking" />
            </p>
          )}
        </div>
      )}

      {canEdit && draft.entry !== 'inline' && (
        <div className="composer">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            placeholder={
              mode === 'chat'
                ? 'Describe what you want…'
                : draft.entry === 'document'
                  ? 'Review the full draft for a board audience…'
                  : 'What should change?'
            }
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => onKey(e, submit)}
          />
          <div className="composer-actions">
            {dictation.supported && (
              <IconButton
                icon={Mic}
                label={dictation.listening ? 'Stop dictation' : 'Dictate'}
                pressed={dictation.listening}
                className={dictation.listening ? 'listening' : undefined}
                onClick={dictation.toggle}
              />
            )}
            <IconButton
              icon={ArrowUp}
              label={mode === 'chat' ? 'Send' : 'Run'}
              shortcut="↵"
              tone="accent"
              className="send"
              disabled={!input.trim() || chatBusy}
              onClick={submit}
            />
          </div>
        </div>
      )}

      {canEdit && mode === 'chat' && agreed && (
        <div className="agreed">
          <p title={agreed}>{agreed}</p>
          <button type="button" className="primary" onClick={() => run(agreed, null)}>
            Run this
          </button>
        </div>
      )}

      {state.step === 'error' && <p className="error">{state.message}</p>}
      {state.step === 'running' && (
        <p className="running">
          <LoaderCircle size={15} className="spin" aria-hidden />
          <span>{state.label}</span>
        </p>
      )}

      {state.step === 'ask' && (
        <div className="ask">
          <p>{state.question}</p>
          <input
            autoFocus
            value={answer}
            placeholder="e.g. 3 or 2-4"
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => onKey(e, () => answerTarget(answer))}
          />
        </div>
      )}

      {state.step === 'done' && (
        <>
          <div className="result">
            {(state.done.suggested > 0 || state.done.filled > 0) && (
              <p className="summary">
                <CircleCheck size={15} aria-hidden />
                <span>
                  {state.done.suggested > 0 &&
                    `Suggested changes in ${state.done.suggested} section${state.done.suggested === 1 ? '' : 's'}. `}
                  {state.done.filled > 0 && `Wrote ${state.done.filled} empty section${state.done.filled === 1 ? '' : 's'}.`}
                </span>
              </p>
            )}
            {state.done.comments.map((c, i) => (
              <div key={i} className="comment">
                <span className="ref">§{label([c.sectionId])}</span>
                <p>{c.comment}</p>
                <p className="fix">{c.suggestion}</p>
              </div>
            ))}
            {state.done.suggested + state.done.filled === 0 && state.done.comments.length === 0 && (
              <p className="muted">No changes suggested.</p>
            )}
            {state.done.note && <p className="note">{state.done.note}</p>}
          </div>
          <footer>
            <span className="meta">{state.done.meta}</span>
            <button type="button" className="primary" onClick={onClose}>
              Done
            </button>
          </footer>
        </>
      )}
    </div>
  )
}
