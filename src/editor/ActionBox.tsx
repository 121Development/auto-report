import type { Editor } from '@tiptap/core'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useRef, useState } from 'react'
import { parseSectionRefs } from '../ai/section-refs'
import type { ActionResponse, EntryPoint } from '../ai/types'
import type { DocumentRecord } from '../lib/types'
import { runActionFn } from '../server/ai'
import { applyEdits, previousSectionId, snapshotSections } from './ai-client'
import { listSections } from './sections'

type Result = Extract<ActionResponse, { kind: 'result' }>

type State =
  | { step: 'input' }
  | { step: 'running' }
  | { step: 'ask'; question: string; instruction: string }
  | { step: 'result'; result: Result }
  | { step: 'error'; message: string }

interface Props {
  editor: Editor
  doc: DocumentRecord
  /** Target sections from the gutter selection. Empty for an inline or document request. */
  targets: string[]
  onClose: () => void
}

/**
 * Section and multi-section entry point: one instruction, one result. Sends the
 * same ActionRequest as every other entry point.
 */
export function ActionBox({ editor, doc, targets, onClose }: Props) {
  const run = useServerFn(runActionFn)
  const [instruction, setInstruction] = useState('')
  const [answer, setAnswer] = useState('')
  const [state, setState] = useState<State>({ step: 'input' })
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const numberOf = (id: string) => listSections(editor.state.doc).find((s) => s.id === id)?.number
  const label = (ids: string[]) => ids.map(numberOf).filter(Boolean).join(', ')

  async function submit(text: string, selection: string[]) {
    const entry: EntryPoint = selection.length > 1 ? 'multi' : 'section'
    setState({ step: 'running' })
    try {
      const response = await run({
        data: {
          documentId: doc.id,
          entry,
          instruction: text,
          language: doc.language,
          model: doc.settings.model,
          selection,
          previousSectionId: previousSectionId(editor),
          sections: snapshotSections(editor),
        },
      })
      if (response.kind === 'needs-target') setState({ step: 'ask', question: response.question, instruction: text })
      else if (response.kind === 'error') setState({ step: 'error', message: response.message })
      else setState({ step: 'result', result: response })
    } catch {
      setState({ step: 'error', message: 'Could not reach the server.' })
    }
  }

  function submitAnswer(text: string) {
    // "3", "2-4", "2, 5": resolved to IDs now, against the current numbering.
    const numbers = parseSectionRefs(`sections ${text}`)
    const sections = listSections(editor.state.doc)
    const ids = numbers.map((n) => sections[n - 1]?.id).filter((id): id is string => !!id)
    if (ids.length === 0) return
    void submit(state.step === 'ask' ? state.instruction : instruction, ids)
  }

  function apply(result: Result) {
    applyEdits(editor, result.edits)
    onClose()
    editor.commands.focus()
  }

  const onKey = (e: React.KeyboardEvent, send: () => void) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="action-box" role="dialog" aria-label="AI action">
      <header>
        <span>{targets.length > 0 ? `Section${targets.length > 1 ? 's' : ''} ${label(targets)}` : 'Document'}</span>
        <button type="button" className="icon" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      {(state.step === 'input' || state.step === 'error') && (
        <>
          <textarea
            ref={inputRef}
            rows={2}
            value={instruction}
            placeholder="What should change? e.g. make it shorter, more formal"
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => onKey(e, () => instruction.trim() && submit(instruction, targets))}
          />
          {state.step === 'error' && <p className="error">{state.message}</p>}
        </>
      )}

      {state.step === 'running' && <p className="muted">Working…</p>}

      {state.step === 'ask' && (
        <>
          <p>{state.question}</p>
          <input
            autoFocus
            value={answer}
            placeholder="e.g. 3 or 2-4"
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => onKey(e, () => submitAnswer(answer))}
          />
        </>
      )}

      {state.step === 'result' && (
        <>
          <div className="result">
            {state.result.edits.map((edit) => (
              <div key={edit.replaces.join()} className="edit">
                <span className="muted">§{label(edit.replaces)}</span>
                <pre>{edit.markdown}</pre>
              </div>
            ))}
            {state.result.comments.map((c, i) => (
              <div key={i} className="comment">
                <span className="muted">§{label([c.sectionId])}</span> {c.comment}
                <div className="suggestion">{c.suggestion}</div>
              </div>
            ))}
            {state.result.edits.length === 0 && state.result.comments.length === 0 && (
              <p className="muted">No changes suggested.</p>
            )}
            {state.result.note && <p className="note">{state.result.note}</p>}
          </div>
          <footer>
            <span className="muted meta">
              {state.result.decision.action} · {state.result.model} · {state.result.decision.decidedBy}
            </span>
            <button type="button" onClick={() => setState({ step: 'input' })}>
              Back
            </button>
            {state.result.edits.length > 0 && (
              <button type="button" className="primary" onClick={() => apply(state.result)}>
                Apply
              </button>
            )}
          </footer>
        </>
      )}
    </div>
  )
}
