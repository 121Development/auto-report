import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Every top-level block of the document is one section: a paragraph, a heading,
 * a whole list, a table, a code block, an image. Each carries a hidden, stable
 * `sectionId`; the visible number is just its 1-based position.
 */
export const SECTION_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'table',
  'image',
]

export interface Section {
  id: string
  number: number
  type: string
  /** Heading level, or null for non-headings. */
  level: number | null
  /** Document position where the section node starts. */
  pos: number
  /** Document position right after the section node. */
  end: number
}

export function listSections(doc: PMNode): Section[] {
  const sections: Section[] = []
  doc.forEach((node, offset, index) => {
    sections.push({
      id: node.attrs.sectionId ?? '',
      number: index + 1,
      type: node.type.name,
      level: node.type.name === 'heading' ? node.attrs.level : null,
      pos: offset,
      end: offset + node.nodeSize,
    })
  })
  return sections
}

/**
 * A heading plus every section up to the next heading of any level, so an H2
 * group stops at its first H3. Returns just the section itself for non-headings.
 */
export function headingGroup(sections: Section[], id: string): Section[] {
  const start = sections.findIndex((s) => s.id === id)
  if (start === -1) return []
  if (sections[start].type !== 'heading') return [sections[start]]
  let end = start + 1
  while (end < sections.length && sections[end].type !== 'heading') end++
  return sections.slice(start, end)
}

/** Visible section number → stable ID, resolved at the moment of use. */
export function idForNumber(sections: Section[], number: number): string | null {
  return sections[number - 1]?.id ?? null
}

/** Inclusive range of IDs between two section IDs, in document order. */
export function rangeBetween(sections: Section[], a: string, b: string): string[] {
  const i = sections.findIndex((s) => s.id === a)
  const j = sections.findIndex((s) => s.id === b)
  if (i === -1 || j === -1) return []
  const [lo, hi] = i <= j ? [i, j] : [j, i]
  return sections.slice(lo, hi + 1).map((s) => s.id)
}

function blockSignature(node: JSONContent): string {
  const text = (n: JSONContent): string =>
    (n.text ?? '') + (n.content ?? []).map(text).join('\u0001')
  return `${node.type}|${node.attrs?.level ?? ''}|${text(node)}`
}

/**
 * After a round trip through raw Markdown (which can't carry section IDs), give
 * unchanged blocks back their old IDs so AI edits, suggestions and diffs stay
 * attached. Blocks are matched by type and text, first unused match wins.
 * Unmatched blocks are left without an ID; the sectionId plugin assigns new ones.
 */
export function reconcileSectionIds(previous: JSONContent, next: JSONContent): JSONContent {
  const pool = new Map<string, string[]>()
  for (const block of previous.content ?? []) {
    const id = block.attrs?.sectionId
    if (!id) continue
    const sig = blockSignature(block)
    pool.set(sig, [...(pool.get(sig) ?? []), id])
  }
  return {
    ...next,
    content: (next.content ?? []).map((block) => {
      const ids = pool.get(blockSignature(block))
      const id = ids?.shift()
      return id ? { ...block, attrs: { ...block.attrs, sectionId: id } } : block
    }),
  }
}
