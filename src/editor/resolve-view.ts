import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { authorOf, type Author } from './track-changes'

/**
 * Which pending suggestions count as part of the text in a given view.
 * The AI snapshot and the raw Markdown view take your own edits as done and
 * AI suggestions as not yet applied.
 */
export type AcceptRule = (author: Author) => boolean

export const OWN_ACCEPTED: AcceptRule = (author) => author === 'u'

const ZWSP = /​/g

function markAuthor(marks: JSONContent['marks'], type: string): Author | null {
  const mark = marks?.find((m) => m.type === type)
  return mark ? authorOf(mark.attrs?.id) : null
}

/** Keep the node? Returns false when the view drops it. */
function keep(marks: JSONContent['marks'], accept: AcceptRule): boolean {
  const ins = markAuthor(marks, 'insertion')
  if (ins && !accept(ins)) return false
  const del = markAuthor(marks, 'deletion')
  if (del && accept(del)) return false
  return true
}

const stripSuggestionMarks = (marks: JSONContent['marks']) =>
  marks?.filter((m) => m.type !== 'insertion' && m.type !== 'deletion' && m.type !== 'modification')

/** A copy of the document as it reads with the given suggestions resolved. */
export function resolveView(node: JSONContent, accept: AcceptRule = OWN_ACCEPTED): JSONContent {
  const out: JSONContent = { ...node }
  const marks = stripSuggestionMarks(node.marks)
  if (marks?.length) out.marks = marks
  else delete out.marks
  if (typeof node.text === 'string') out.text = node.text.replace(ZWSP, '')
  if (node.content) {
    out.content = node.content
      .filter((child) => keep(child.marks, accept))
      .map((child) => resolveView(child, accept))
      .filter((child) => child.type !== 'text' || (child.text ?? '').length > 0)
  }
  return out
}

/** `//` lines are prompts, never document text. */
export function isPromptLine(text: string): boolean {
  return text.replace(ZWSP, '').trimStart().startsWith('//')
}

/**
 * A top-level block is a live section unless it is a pending AI insertion,
 * something you deleted, or a `//` prompt line. An AI-proposed deletion is still
 * live: it is current text until you accept.
 */
export function isLiveBlock(node: PMNode): boolean {
  const blockMarks = node.marks
  const ins = blockMarks.find((m) => m.type.name === 'insertion')
  if (ins && authorOf(ins.attrs.id) === 'ai') return false
  const del = blockMarks.find((m) => m.type.name === 'deletion')
  if (del && authorOf(del.attrs.id) === 'u') return false
  if (node.isTextblock && node.childCount > 0) {
    // Every piece is an AI insertion, or every piece is your deletion.
    let allAiInserted = true
    let allOwnDeleted = true
    let ownDeletion = false
    node.forEach((child) => {
      const i = child.marks.find((m) => m.type.name === 'insertion')
      const d = child.marks.find((m) => m.type.name === 'deletion')
      const ownDeleted = !!d && authorOf(d.attrs.id) === 'u'
      if (!(i && authorOf(i.attrs.id) === 'ai')) allAiInserted = false
      if (ownDeleted) ownDeletion = true
      else if ((child.text ?? '').replace(ZWSP, '') !== '') allOwnDeleted = false
    })
    if (allAiInserted || (ownDeletion && allOwnDeleted)) return false
  }
  if (node.type.name === 'paragraph' && isPromptLine(node.textContent)) return false
  return true
}
