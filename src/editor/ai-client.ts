import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { SectionEdit, SectionSnapshot } from '../ai/types'
import { isTrailingPlaceholder, listSections } from './sections'

/** The document as the AI engine sees it: one Markdown string per section, at fire time. */
export function snapshotSections(editor: Editor): SectionSnapshot[] {
  const markdown = editor.markdown
  if (!markdown) throw new Error('Markdown extension missing')
  const out: SectionSnapshot[] = []
  const { doc } = editor.state
  doc.forEach((node, _offset, index) => {
    if (isTrailingPlaceholder(doc, index)) return
    out.push({
      id: node.attrs.sectionId ?? '',
      number: index + 1,
      type: node.type.name,
      markdown: markdown.serialize({ type: 'doc', content: [node.toJSON()] }).trim(),
    })
  })
  return out
}

export function previousSectionId(editor: Editor): string | null {
  const $from = editor.state.selection.$from
  const index = $from.index(0)
  return index > 0 ? (editor.state.doc.child(index - 1).attrs.sectionId ?? null) : null
}

/**
 * Apply AI edits as one undoable transaction. The first new block of each edit
 * keeps the ID of the first section it replaces, so comments, suggestions and
 * version diffs stay attached. A merge removes the other replaced sections.
 *
 * Interim for M2: changes land directly. M3 turns them into tracked suggestions.
 */
export function applyEdits(editor: Editor, edits: SectionEdit[]): void {
  const markdown = editor.markdown
  if (!markdown || edits.length === 0) return
  const { schema } = editor.state
  const sections = listSections(editor.state.doc)
  const byId = new Map(sections.map((s) => [s.id, s]))

  type Op = { from: number; to: number; nodes: PMNode[] }
  const ops: Op[] = []
  for (const edit of edits) {
    const replaced = edit.replaces.map((id) => byId.get(id)).filter((s) => s !== undefined)
    if (replaced.length === 0) continue
    replaced.sort((a, b) => a.pos - b.pos)
    const parsed: JSONContent = markdown.parse(edit.markdown)
    const blocks = (parsed.content ?? []).filter((b) => b.type)
    if (blocks.length === 0) blocks.push({ type: 'paragraph' })
    blocks[0] = { ...blocks[0], attrs: { ...blocks[0].attrs, sectionId: replaced[0].id } }
    const nodes = blocks.map((b) => schema.nodeFromJSON(b))
    ops.push({ from: replaced[0].pos, to: replaced[0].end, nodes })
    for (const extra of replaced.slice(1)) ops.push({ from: extra.pos, to: extra.end, nodes: [] })
  }

  // Apply from the end of the document backwards so earlier positions stay valid.
  ops.sort((a, b) => b.from - a.from)
  const tr = editor.state.tr
  for (const op of ops) tr.replaceWith(op.from, op.to, op.nodes)
  editor.view.dispatch(tr.scrollIntoView())
}
