import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { listSections } from './sections'
import { listSuggestions, resolveSuggestions, suggestionIds } from './track-changes'

interface BarProps {
  editor: Editor
  showOwn: boolean
  onToggleOwn: () => void
}

/** Counts and bulk actions for pending suggestions, plus the show/hide toggle for your own edits. */
export function SuggestionBar({ editor, showOwn, onToggleOwn }: BarProps) {
  const counts = useEditorState({
    editor,
    selector: ({ editor }) => {
      const all = listSuggestions(editor.state.doc)
      return {
        ai: new Set(all.filter((s) => s.author === 'ai').map((s) => s.id)).size,
        own: new Set(all.filter((s) => s.author === 'u').map((s) => s.id)).size,
      }
    },
  })
  const resolveAll = (author: 'ai' | 'u', accept: boolean) =>
    resolveSuggestions(editor, suggestionIds(editor.state.doc, (s) => s.author === author), accept)

  return (
    <div className="suggestion-bar">
      {counts.ai > 0 && (
        <span className="group ai">
          {counts.ai} AI suggestion{counts.ai === 1 ? '' : 's'}
          <button type="button" onClick={() => resolveAll('ai', true)}>
            Accept all
          </button>
          <button type="button" onClick={() => resolveAll('ai', false)}>
            Reject all
          </button>
        </span>
      )}
      <span className="group own">
        <label>
          <input type="checkbox" checked={showOwn} onChange={onToggleOwn} /> Show my changes
        </label>
        {counts.own > 0 && (
          <button type="button" onClick={() => resolveAll('u', true)} title="Keep your edits and stop tracking them">
            Accept mine ({counts.own})
          </button>
        )}
      </span>
    </div>
  )
}

/**
 * When the cursor is inside an AI suggestion: accept or reject that change, or
 * every AI change in its section.
 */
export function ChangeBubble({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor }) => {
      const { from } = editor.state.selection
      const hit = listSuggestions(editor.state.doc).find((s) => s.author === 'ai' && s.from <= from && from <= s.to)
      if (!hit) return null
      const section = listSections(editor.state.doc).find((s) => s.pos <= hit.from && hit.from < s.end)
      let coords: { left: number; bottom: number } | null = null
      try {
        const c = editor.view.coordsAtPos(Math.min(hit.to, editor.state.doc.content.size))
        coords = { left: c.left, bottom: c.bottom }
      } catch {
        coords = null
      }
      return { id: hit.id, section: section ? { from: section.pos, to: section.end, number: section.number } : null, coords }
    },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  })
  if (!active?.coords) return null

  const sectionIds = () =>
    active.section
      ? suggestionIds(
          editor.state.doc,
          (s) => s.author === 'ai' && s.from < active.section!.to && s.to > active.section!.from,
        )
      : [active.id]
  const resolve = (ids: string[], accept: boolean) => {
    resolveSuggestions(editor, ids, accept)
    editor.commands.focus()
  }

  return (
    <div
      className="change-bubble"
      style={{ left: active.coords.left, top: active.coords.bottom + 6 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" className="accept" onClick={() => resolve([active.id], true)}>
        ✓ Accept
      </button>
      <button type="button" className="reject" onClick={() => resolve([active.id], false)}>
        ✗ Reject
      </button>
      {active.section && (
        <>
          <span className="sep">§{active.section.number}</span>
          <button type="button" onClick={() => resolve(sectionIds(), true)}>
            Accept section
          </button>
          <button type="button" onClick={() => resolve(sectionIds(), false)}>
            Reject section
          </button>
        </>
      )}
    </div>
  )
}
