import type { Editor } from '@tiptap/core'
import type { Placement } from '@floating-ui/react'
import type { EntryPoint } from '../ai/types'
import { listSections, type Section } from './sections'

export type Anchor =
  | { kind: 'docked' }
  | { kind: 'floating'; placement: Placement; getRect: () => DOMRect }

function sectionRect(editor: Editor, section: Section): DOMRect | null {
  const dom = editor.view.nodeDOM(section.pos)
  return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null
}

/**
 * Where the action box sits: to the right of the text column, next to its target.
 * One section: level with its top. Adjacent sections: centred on them. Scattered
 * sections: level with the top one. Document prompts dock in the corner.
 */
export function anchorFor(
  editor: Editor,
  draft: { entry: EntryPoint; targets: string[]; previousSectionId?: string | null },
): Anchor {
  if (draft.entry === 'document') return { kind: 'docked' }

  const columnRight = () => editor.view.dom.getBoundingClientRect().right
  const targets = () => {
    const ids = draft.entry === 'inline' ? [draft.previousSectionId].filter(Boolean) : draft.targets
    const wanted = new Set(ids)
    return listSections(editor.state.doc).filter((s) => wanted.has(s.id))
  }
  const initial = targets()
  const adjacent = initial.length > 1 && initial.every((s, i) => i === 0 || s.number === initial[i - 1].number + 1)

  const getRect = () => {
    const sections = targets()
    const rects = (adjacent ? sections : sections.slice(0, 1))
      .map((s) => sectionRect(editor, s))
      .filter((r): r is DOMRect => r !== null)
    if (rects.length === 0) {
      // Inline prompt at the top of the document, or the target is gone: use the cursor.
      const c = editor.view.coordsAtPos(editor.state.selection.from)
      return new DOMRect(columnRight(), c.top, 0, c.bottom - c.top)
    }
    const top = Math.min(...rects.map((r) => r.top))
    const bottom = Math.max(...rects.map((r) => r.bottom))
    return new DOMRect(columnRight(), top, 0, bottom - top)
  }

  return { kind: 'floating', placement: adjacent ? 'right' : 'right-start', getRect }
}
