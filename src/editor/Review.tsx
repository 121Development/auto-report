import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { Check, CheckCheck, Eye, EyeOff, ListChecks, ListX, X } from 'lucide-react'
import { IconButton } from '../lib/ui'
import { listSections } from './sections'
import { listSuggestions, resolveSuggestions, suggestionIds } from './track-changes'

interface ControlsProps {
  editor: Editor
  showOwn: boolean
  onToggleOwn: () => void
}

/** Top-bar review controls: AI suggestion count with accept/reject all, and your own changes. */
export function ReviewControls({ editor, showOwn, onToggleOwn }: ControlsProps) {
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
    <div className="review">
      {counts.ai > 0 && (
        <div className="pill ai" role="group" aria-label="AI suggestions">
          <span className="count">
            {counts.ai} suggestion{counts.ai === 1 ? '' : 's'}
          </span>
          <IconButton icon={CheckCheck} label="Accept all AI suggestions" tone="positive" size={15} onClick={() => resolveAll('ai', true)} />
          <IconButton icon={X} label="Reject all AI suggestions" tone="negative" size={15} onClick={() => resolveAll('ai', false)} />
        </div>
      )}
      <IconButton
        icon={showOwn ? Eye : EyeOff}
        label={showOwn ? 'Hide my changes' : 'Show my changes'}
        pressed={showOwn}
        onClick={onToggleOwn}
      />
      {counts.own > 0 && showOwn && (
        <IconButton icon={Check} label={`Accept my changes (${counts.own})`} onClick={() => resolveAll('u', true)} />
      )}
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
      // Above the line where the change starts, so it never covers the next line.
      let coords: { left: number; top: number } | null = null
      try {
        const c = editor.view.coordsAtPos(Math.min(hit.from + 1, editor.state.doc.content.size))
        coords = { left: c.left, top: c.top }
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
      ? suggestionIds(editor.state.doc, (s) => s.author === 'ai' && s.from < active.section!.to && s.to > active.section!.from)
      : [active.id]
  const resolve = (ids: string[], accept: boolean) => {
    resolveSuggestions(editor, ids, accept)
    editor.commands.focus()
  }

  return (
    <div
      className="change-bubble"
      style={{ left: active.coords.left - 6, top: active.coords.top - 44 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <IconButton icon={Check} label="Accept change" tone="positive" onClick={() => resolve([active.id], true)} />
      <IconButton icon={X} label="Reject change" tone="negative" onClick={() => resolve([active.id], false)} />
      {active.section && (
        <>
          <span className="divider" aria-hidden />
          <span className="section-label">§{active.section.number}</span>
          <IconButton icon={ListChecks} label="Accept all changes in this section" tone="positive" onClick={() => resolve(sectionIds(), true)} />
          <IconButton icon={ListX} label="Reject all changes in this section" tone="negative" onClick={() => resolve(sectionIds(), false)} />
        </>
      )}
    </div>
  )
}
