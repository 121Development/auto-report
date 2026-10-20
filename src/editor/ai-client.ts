import type { Editor, JSONContent } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import type { SectionEdit, SectionSnapshot } from '../ai/types'
import { resolveView } from './resolve-view'
import { isTrailingPlaceholder, listSections, type Section } from './sections'
import { authorOf, settleOwnChanges, TRACK } from './track-changes'
import { diffWords } from './word-diff'

const ZWSP = '​'

function isPlaceholder(doc: PMNode, s: Section): boolean {
  return s.end === doc.content.size && isTrailingPlaceholder(doc, doc.childCount - 1)
}

/** Text of a block as it currently reads (your edits applied, AI suggestions pending). */
export function visibleText(node: PMNode): string {
  const view = resolveView(node.toJSON())
  const text = (n: JSONContent): string => (n.text ?? '') + (n.content ?? []).map(text).join('')
  return text(view)
}

/** The document as the AI engine sees it: one Markdown string per live section, at fire time. */
export function snapshotSections(editor: Editor): SectionSnapshot[] {
  const markdown = editor.markdown
  if (!markdown) throw new Error('Markdown extension missing')
  const { doc } = editor.state
  return listSections(doc)
    .filter((s) => !isPlaceholder(doc, s))
    .map((s) => {
      const node = doc.nodeAt(s.pos)!
      return {
        id: s.id,
        number: s.number,
        type: s.type,
        markdown: markdown.serialize({ type: 'doc', content: [resolveView(node.toJSON())] }).trim(),
      }
    })
}

export function previousSectionId(editor: Editor): string | null {
  const pos = editor.state.selection.$from.before(1)
  const before = listSections(editor.state.doc).filter((s) => s.end <= pos)
  return before.length > 0 ? before[before.length - 1].id : null
}

/** Sections (by ID) that still hold pending AI suggestions. */
export function sectionsWithPendingAi(editor: Editor, ids: string[]): string[] {
  const { doc } = editor.state
  const wanted = new Set(ids)
  return listSections(doc)
    .filter((s) => wanted.has(s.id))
    .filter((s) => {
      let found = false
      doc.nodesBetween(s.pos, s.end, (node) => {
        if (node.marks.some((m) => (m.type.name === 'insertion' || m.type.name === 'deletion') && authorOf(m.attrs.id) === 'ai')) found = true
        return !found
      })
      return found
    })
    .map((s) => s.id)
}

interface Op {
  from: number
  to: number
  content: Fragment
}

/** Visible characters of a textblock mapped to document positions (skips your deletions and zero-width spaces). */
function visibleMap(node: PMNode, pos: number) {
  let text = ''
  const positions: number[] = []
  node.forEach((child, offset) => {
    const start = pos + 1 + offset
    if (child.isText) {
      if (child.marks.some((m) => m.type.name === 'deletion')) return
      const t = child.text ?? ''
      for (let k = 0; k < t.length; k++) {
        if (t[k] === ZWSP) continue
        text += t[k]
        positions.push(start + k)
      }
    } else {
      text += '\n'
      positions.push(start)
    }
  })
  return { text, positions, end: pos + 1 + node.content.size }
}

/** Word-level ops for rewriting one textblock in place, or null if that doesn't fit. */
function inlineOps(oldNode: PMNode, pos: number, newNode: PMNode): Op[] | null {
  if (!oldNode.isTextblock || oldNode.type !== newNode.type) return null
  if (oldNode.type.name === 'heading' && oldNode.attrs.level !== newNode.attrs.level) return null
  const { text, positions, end } = visibleMap(oldNode, pos)
  const newText = newNode.textBetween(0, newNode.content.size, undefined, () => '\n')
  const diff = diffWords(text, newText)
  if (!diff) return null
  return diff.map((d) => {
    const from = d.from < positions.length ? positions[d.from] : end
    const to = d.to > d.from ? positions[d.to - 1] + 1 : from
    return { from, to, content: newNode.content.cut(d.newFrom, d.newTo) }
  })
}

function parseBlocks(editor: Editor, markdown: string): PMNode[] {
  const parsed: JSONContent = editor.markdown!.parse(markdown)
  const blocks = (parsed.content ?? []).filter((b) => b.type)
  if (blocks.length === 0) blocks.push({ type: 'paragraph' })
  return blocks.map((b) => editor.schema.nodeFromJSON(b))
}

function dispatchOps(editor: Editor, ops: Op[], mode: 'ai' | 'direct') {
  if (ops.length === 0) return
  const tr = editor.state.tr
  for (const op of [...ops].sort((a, b) => b.from - a.from)) {
    if (op.content.size === 0) tr.delete(op.from, op.to)
    else tr.replaceWith(op.from, op.to, op.content)
  }
  tr.setMeta(TRACK, mode)
  editor.view.dispatch(closeHistory(tr).scrollIntoView())
}

/**
 * Apply AI edits. Writing into an empty section goes in directly; changes to
 * existing text arrive as tracked AI suggestions. A rewrite of one paragraph or
 * heading becomes word-level changes; anything structural (one block into several,
 * a merge, a type change) becomes a block-level suggestion.
 */
export function applyAiEdits(editor: Editor, edits: SectionEdit[]): { filled: number; suggested: number } {
  const counts = { filled: 0, suggested: 0 }
  const plan = (doc: PMNode) => {
    const byId = new Map(listSections(doc).map((s) => [s.id, s]))
    return edits
      .map((edit) => ({
        edit,
        replaced: edit.replaces
          .map((id) => byId.get(id))
          .filter((s): s is Section => !!s)
          .sort((a, b) => a.pos - b.pos),
      }))
      .filter((e) => e.replaced.length > 0)
  }

  // 0. Settle your own tracked edits in the target sections first.
  settleOwnChanges(editor, plan(editor.state.doc).flatMap((e) => e.replaced.map((s) => ({ from: s.pos, to: s.end }))))

  // 1. Fill empty sections directly.
  const fills: Op[] = []
  const filled = new Set<SectionEdit>()
  for (const { edit, replaced } of plan(editor.state.doc)) {
    const node = editor.state.doc.nodeAt(replaced[0].pos)!
    if (replaced.length !== 1 || visibleText(node).trim() !== '') continue
    filled.add(edit)
    const blocks = parseBlocks(editor, edit.markdown)
    blocks[0] = blocks[0].type.create({ ...blocks[0].attrs, sectionId: replaced[0].id }, blocks[0].content, blocks[0].marks)
    fills.push({ from: replaced[0].pos, to: replaced[0].end, content: Fragment.from(blocks) })
    counts.filled++
  }
  dispatchOps(editor, fills, 'direct')

  // 2. Everything else as tracked suggestions, against the updated document.
  const doc = editor.state.doc
  const ops: Op[] = []
  for (const { edit, replaced } of plan(doc)) {
    if (filled.has(edit)) continue
    const first = replaced[0]
    const oldNode = doc.nodeAt(first.pos)!
    const blocks = parseBlocks(editor, edit.markdown)
    const inline = replaced.length === 1 && blocks.length === 1 ? inlineOps(oldNode, first.pos, blocks[0]) : null
    if (inline) {
      ops.push(...inline)
    } else {
      blocks[0] = blocks[0].type.create(
        { ...blocks[0].attrs, sectionId: null, replacesSectionId: first.id },
        blocks[0].content,
        blocks[0].marks,
      )
      ops.push({ from: first.pos, to: first.end, content: Fragment.from(blocks) })
      for (const extra of replaced.slice(1)) ops.push({ from: extra.pos, to: extra.end, content: Fragment.empty })
    }
    counts.suggested++
  }
  dispatchOps(editor, ops, 'ai')
  return counts
}
