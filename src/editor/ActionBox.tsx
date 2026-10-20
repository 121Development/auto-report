import type { Editor } from '@tiptap/core'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useRef, useState } from 'react'
import { parseSectionRefs } from '../ai/section-refs'
import type { ActionResponse, ActionType, ChatMessage, EntryPoint, SectionComment } from '../ai/types'
import type { DocumentRecord } from '../lib/types'
import { chatFn, runActionFn } from '../server/ai'
import { applyAiEdits, sectionsWithPendingAi, snapshotSections } from './ai-client'
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

const PRESETS: { action: ActionType; label: string; instruction: string; when: (n: number, entry: EntryPoint) => boolean }[] = [
  { action: 'expand', label: 'Expand', instruction: 'Expand this: add detail and explanation, about double the length.', when: (_, e) => e !== 'document' },
  { action: 'shorten', label: 'Shorten', instruction: 'Shorten this: keep the key points and cut about a third.', when: () => true },
  { action: 'rewrite', label: 'Rewrite', instruction: 'Rewrite this for clarity and flow, keeping the meaning.', when: (_, e) => e !== 'document' },
  { action: 'merge', label: 'Merge', instruction: 'Merge these sections into one coherent section.', when: (n) => n > 1 },
  { action: 'summarize', label: 'Summarize', instruction: 'Replace this with a concise summary of it.', when: (_, e) => e !== 'document' },
  { action: 'check', label: 'Check consistency', instruction: 'Check consistency and terminology. Report each issue with a suggested fix.', when: () => true },
]

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

  const numberOf = (id: string) => listSections(editor.state.doc).find((s) => s.id === id)?.number
  const label = (ids: string[]) => ids.map(numberOf).filter(Boolean).join(', ')
  const title =
    draft.entry === 'document'
      ? 'Document'
      : draft.entry === 'inline'
        ? 'Inline prompt'
        : `Section${draft.targets.length > 1 ? 's' : ''} ${label(draft.targets)}`

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

  return (
    <div className="action-box" role="dialog" aria-label="AI action" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <header>
        <span>{title}</span>
        {canEdit && draft.entry !== 'inline' && (
          <div className="modes" role="tablist">
            <button type="button" aria-pressed={mode === 'oneshot'} onClick={() => setMode('oneshot')}>
              One-shot
            </button>
            <button type="button" aria-pressed={mode === 'chat'} onClick={() => setMode('chat')}>
              Chat
            </button>
          </div>
        )}
        <button type="button" className="icon" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      {canEdit && mode === 'oneshot' && presets.length > 0 && draft.entry !== 'inline' && (
        <div className="presets">
          {presets.map((p) => (
            <button key={p.action} type="button" onClick={() => run(p.instruction, p.action)}>
              {p.label}
            </button>
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
          {chatBusy && <p className="assistant muted">…</p>}
        </div>
      )}

      {canEdit && draft.entry !== 'inline' && (
        <div className="input-row">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            placeholder={
              mode === 'chat'
                ? 'Describe what you want; refine it before running'
                : draft.entry === 'document'
                  ? 'e.g. review the full draft for a board audience'
                  : 'What should change? e.g. make it more formal'
            }
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => onKey(e, submit)}
          />
          {dictation.supported && (
            <button
              type="button"
              className={`mic${dictation.listening ? ' on' : ''}`}
              aria-pressed={dictation.listening}
              aria-label={dictation.listening ? 'Stop dictation' : 'Dictate'}
              title="Dictate (your browser's speech recognition)"
              onClick={dictation.toggle}
            >
              🎙
            </button>
          )}
        </div>
      )}

      {canEdit && mode === 'chat' && agreed && (
        <footer>
          <span className="muted meta" title={agreed}>
            Will run: {agreed}
          </span>
          <button type="button" className="primary" onClick={() => run(agreed, null)}>
            Run
          </button>
        </footer>
      )}

      {state.step === 'error' && <p className="error">{state.message}</p>}
      {state.step === 'running' && <p className="muted">Working on: {state.label}</p>}

      {state.step === 'ask' && (
        <>
          <p>{state.question}</p>
          <input
            autoFocus
            value={answer}
            placeholder="e.g. 3 or 2-4"
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => onKey(e, () => answerTarget(answer))}
          />
        </>
      )}

      {state.step === 'done' && (
        <>
          <div className="result">
            {state.done.suggested > 0 && (
              <p>
                {state.done.suggested} section{state.done.suggested === 1 ? '' : 's'} with suggested changes. Review them in
                the text.
              </p>
            )}
            {state.done.filled > 0 && (
              <p>
                Wrote {state.done.filled} empty section{state.done.filled === 1 ? '' : 's'}.
              </p>
            )}
            {state.done.comments.map((c, i) => (
              <div key={i} className="comment">
                <span className="muted">§{label([c.sectionId])}</span> {c.comment}
                <div className="suggestion">{c.suggestion}</div>
              </div>
            ))}
            {state.done.suggested + state.done.filled === 0 && state.done.comments.length === 0 && (
              <p className="muted">No changes suggested.</p>
            )}
            {state.done.note && <p className="note">{state.done.note}</p>}
          </div>
          <footer>
            <span className="muted meta">{state.done.meta}</span>
            <button type="button" onClick={onClose}>
              Done
            </button>
          </footer>
        </>
      )}
    </div>
  )
}
