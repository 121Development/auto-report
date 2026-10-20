import {
  applySuggestion,
  deletion,
  insertion,
  modification,
  revertSuggestion,
  suggestChanges,
  suggestChangesKey,
  transformToSuggestionTransaction,
} from '@handlewithcare/prosemirror-suggest-changes'
import { Extension, Mark, type Editor, type JSONContent } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import { closeHistory } from '@tiptap/pm/history'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'

/**
 * Track changes on top of @handlewithcare/prosemirror-suggest-changes.
 *
 * Suggestion IDs carry their author: "ai:12" for AI suggestions, "u:7" for your own
 * edits. AI changes to existing text arrive as suggestions; your own edits are tracked
 * too and can be hidden from view. Transactions say how they should be handled
 * with the TRACK meta:
 *   - 'ai'      → transformed into AI suggestions
 *   - 'direct'  → applied as-is (loading content, AI writing into an empty section, the // line)
 *   - unset     → your own edit, tracked when tracking is on
 */
export const TRACK = 'track'
export type TrackMode = 'ai' | 'direct'
export type Author = 'ai' | 'u'

export function authorOf(id: unknown): Author {
  return typeof id === 'string' && id.startsWith('ai:') ? 'ai' : 'u'
}

function nextId(schema: Schema, doc: PMNode | undefined, author: Author): string {
  const types = [schema.marks.insertion, schema.marks.deletion, schema.marks.modification]
  let max = 0
  doc?.descendants((node) => {
    for (const mark of node.marks) {
      if (!types.includes(mark.type)) continue
      const n = Number(String(mark.attrs.id).split(':')[1] ?? mark.attrs.id)
      if (Number.isFinite(n)) max = Math.max(max, n)
    }
    return true
  })
  return `${author}:${max + 1}`
}

const idAttribute = {
  id: {
    default: null,
    parseHTML: (el: HTMLElement) => (el.dataset.id ? JSON.parse(el.dataset.id) : null),
    renderHTML: (attrs: Record<string, unknown>) => ({
      'data-id': JSON.stringify(attrs.id),
      'data-author': authorOf(attrs.id),
    }),
  },
}

function suggestionMark(name: 'insertion' | 'deletion', tag: 'ins' | 'del') {
  return Mark.create({
    name,
    inclusive: false,
    excludes: name === 'insertion' ? insertion.excludes : deletion.excludes,
    addAttributes: () => idAttribute,
    parseHTML: () => [{ tag: `${tag}[data-id]` }],
    renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes, 0],
  })
}

export const Insertion = suggestionMark('insertion', 'ins')
export const Deletion = suggestionMark('deletion', 'del')
export const Modification = Mark.create({
  name: 'modification',
  inclusive: false,
  excludes: modification.excludes,
  addAttributes: () => ({
    ...idAttribute,
    type: { default: null, renderHTML: (a) => ({ 'data-mod-type': a.type }) },
    attrName: { default: null, renderHTML: () => ({}) },
    previousValue: { default: null, renderHTML: () => ({}) },
    newValue: { default: null, renderHTML: () => ({}) },
  }),
  parseHTML: () => [{ tag: "span[data-type='modification']" }],
  renderHTML: ({ HTMLAttributes }) => ['span', { 'data-type': 'modification', ...HTMLAttributes }, 0],
})

/** Document that allows suggestion marks on blocks, for block-level suggestions. */
export const TrackedDocument = Document.extend({ marks: 'insertion modification deletion' })

export interface TrackChangesOptions {
  /** Whether your own edits are tracked. */
  trackOwn: () => boolean
}

interface TrackStorage {
  /** Your freshly typed ranges, waiting to be marked as your insertions. */
  pending: { from: number; to: number }[]
  scheduled: boolean
}

const LEAF = '\ufffc'

/** Does the step remove any text (or inline leaf, like an image or line break)? */
function removesText(doc: PMNode, step: ReplaceStep): boolean {
  return step.from < step.to && doc.textBetween(step.from, step.to, '', LEAF).length > 0
}

export const TrackChanges = Extension.create<TrackChangesOptions, TrackStorage>({
  name: 'trackChanges',

  addOptions() {
    return { trackOwn: () => true }
  },

  addStorage() {
    return { pending: [], scheduled: false }
  },

  addExtensions() {
    return [Insertion, Deletion, Modification]
  },

  addProseMirrorPlugins() {
    return [suggestChanges()]
  },

  dispatchTransaction({ transaction: tr, next }) {
    const storage = this.storage
    const pass = (t: Transaction) => {
      storage.pending = storage.pending.map((r) => ({ from: t.mapping.map(r.from, -1), to: t.mapping.map(r.to, 1) }))
      next(t)
    }
    const mode = tr.getMeta(TRACK) as TrackMode | undefined
    const untracked =
      !tr.docChanged ||
      mode === 'direct' ||
      tr.getMeta('history$') ||
      'skip' in (tr.getMeta(suggestChangesKey) ?? {}) ||
      (mode !== 'ai' && !this.options.trackOwn())
    if (untracked) return pass(tr)

    if (mode === 'ai') {
      return pass(transformToSuggestionTransaction(tr, this.editor.state, (schema, doc) => nextId(schema, doc, 'ai')))
    }

    // Your own edit. Structure and formatting changes (Markdown input rules like "# "
    // or "- ", block types, bold, Enter, joining paragraphs) apply untracked.
    if (tr.steps.some((step) => !(step instanceof ReplaceStep))) return pass(tr)
    const steps = tr.steps as ReplaceStep[]
    if (steps.some((step, i) => removesText(tr.docs[i], step))) {
      // Deleting or replacing text: the library turns it into deletion marks.
      return pass(transformToSuggestionTransaction(tr, this.editor.state, (schema, doc) => nextId(schema, doc, 'u')))
    }

    // Typing: apply as-is, so TipTap's input rules (which compare the document right
    // after the keystroke) still fire, then mark the new text on the next microtask.
    pass(tr)
    steps.forEach((step, i) => {
      if (step.slice.content.textBetween(0, step.slice.content.size, '', LEAF).length === 0) return
      const after = tr.mapping.slice(i + 1)
      storage.pending.push({ from: after.map(step.from, -1), to: after.map(step.from + step.slice.size, 1) })
    })
    if (storage.pending.length === 0 || storage.scheduled) return
    storage.scheduled = true
    queueMicrotask(() => {
      storage.scheduled = false
      markTyped(this.editor, storage.pending.splice(0))
    })
  },
})

/** Mark freshly typed text as your insertion, continuing an adjacent insertion's ID. */
function markTyped(editor: Editor, ranges: { from: number; to: number }[]) {
  if (editor.isDestroyed) return
  const { state } = editor
  const insertion = state.schema.marks.insertion
  const size = state.doc.content.size
  const tr = state.tr
  let fresh: string | null = null
  for (const range of ranges) {
    const from = Math.max(0, Math.min(range.from, size))
    const to = Math.max(from, Math.min(range.to, size))
    if (from === to || state.doc.textBetween(from, to, '', LEAF).length === 0) continue
    const neighbour = [state.doc.resolve(from).nodeBefore, state.doc.resolve(to).nodeAfter]
      .flatMap((n) => n?.marks ?? [])
      .find((m) => m.type === insertion && authorOf(m.attrs.id) === 'u')
    const id = neighbour ? String(neighbour.attrs.id) : (fresh ??= nextId(state.schema, state.doc, 'u'))
    tr.addMark(from, to, insertion.create({ id }))
  }
  if (!tr.docChanged) return
  editor.view.dispatch(tr.setMeta(TRACK, 'direct').setMeta('addToHistory', false))
}

export interface SuggestionInfo {
  id: string
  author: Author
  kind: 'insertion' | 'deletion' | 'modification'
  from: number
  to: number
}

/** Every suggestion range in the document, in order. */
export function listSuggestions(doc: PMNode): SuggestionInfo[] {
  const out: SuggestionInfo[] = []
  doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      const kind = mark.type.name
      if (kind !== 'insertion' && kind !== 'deletion' && kind !== 'modification') continue
      const id = String(mark.attrs.id)
      const last = out[out.length - 1]
      const to = pos + node.nodeSize
      if (last && last.id === id && last.kind === kind && last.to >= pos) last.to = Math.max(last.to, to)
      else out.push({ id, author: authorOf(id), kind, from: pos, to })
    }
    return true
  })
  return out
}

export function suggestionIds(doc: PMNode, filter: (s: SuggestionInfo) => boolean = () => true): string[] {
  return [...new Set(listSuggestions(doc).filter(filter).map((s) => s.id))]
}

/** Run one of the library's commands and capture its transaction instead of dispatching it. */
function capture(state: EditorState, command: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean) {
  let captured: Transaction | null = null
  command(state, (tr) => {
    captured = tr
  })
  return captured as Transaction | null
}

/**
 * Accept or reject suggestions as one transaction (one undo step).
 *
 * When accepting removes a section that an AI block was proposed to replace, that
 * block takes over the section ID, so IDs stay stable across AI rewrites.
 */
export function resolveSuggestions(editor: Editor, ids: string[], accept: boolean): void {
  if (ids.length === 0) return
  let state = editor.state
  const tr = state.tr
  for (const id of ids) {
    const step = capture(state, (accept ? applySuggestion : revertSuggestion)(id))
    if (!step) continue
    for (const s of step.steps) tr.step(s)
    state = state.apply(step)
  }
  if (!tr.docChanged) return

  const alive = new Set<string>()
  tr.doc.forEach((node) => {
    if (node.attrs.sectionId) alive.add(node.attrs.sectionId)
  })
  tr.doc.forEach((node, offset) => {
    const origin = node.attrs.replacesSectionId as string | null
    if (!origin) return
    if (!alive.has(origin)) {
      tr.setNodeAttribute(offset, 'sectionId', origin)
      alive.add(origin)
    }
    if (!hasSuggestions(node)) tr.setNodeAttribute(offset, 'replacesSectionId', null)
  })
  tr.setMeta(suggestChangesKey, { skip: true })
  editor.view.dispatch(closeHistory(tr))
}

function hasSuggestions(node: PMNode): boolean {
  let found = node.marks.some((m) => SUGGESTION_MARKS.has(m.type.name))
  node.descendants((child) => {
    if (!found && child.marks.some((m) => SUGGESTION_MARKS.has(m.type.name))) found = true
    return !found
  })
  return found
}

const SUGGESTION_MARKS = new Set(['insertion', 'deletion', 'modification'])

/** Replace the whole document without tracking it (loading, raw Markdown round trip). */
export function setContentDirect(editor: Editor, content: JSONContent): void {
  editor
    .chain()
    .command(({ tr }) => {
      tr.setMeta(TRACK, 'direct')
      return true
    })
    .setContent(content)
    .run()
}

/**
 * Settle your own tracked changes inside the given ranges: insertions become plain
 * text, deletions go. Run before an AI edit, so the AI suggestion is tracked
 * against the text as it reads now. (Otherwise deleting your own fresh insertion
 * would remove it outright, and the AI's new text would merge into your insertion.)
 */
export function settleOwnChanges(editor: Editor, ranges: { from: number; to: number }[]): void {
  const { state } = editor
  const { insertion, deletion } = state.schema.marks
  const tr = state.tr
  const deletions: { from: number; to: number }[] = []
  for (const { from, to } of ranges) {
    state.doc.nodesBetween(from, to, (node, pos) => {
      for (const mark of node.marks) {
        if (authorOf(mark.attrs.id) !== 'u') continue
        if (mark.type === insertion) {
          if (node.isInline) tr.removeMark(Math.max(pos, from), Math.min(pos + node.nodeSize, to), mark)
          else tr.removeNodeMark(pos, mark)
        }
        if (mark.type === deletion && node.isInline) {
          deletions.push({ from: Math.max(pos, from), to: Math.min(pos + node.nodeSize, to) })
        }
      }
      if (node.isText) {
        const text = node.text ?? ''
        for (let i = text.indexOf('​'); i !== -1; i = text.indexOf('​', i + 1)) {
          if (pos + i >= from && pos + i < to) deletions.push({ from: pos + i, to: pos + i + 1 })
        }
      }
      return true
    })
  }
  for (const d of deletions.sort((a, b) => b.from - a.from)) tr.delete(tr.mapping.map(d.from), tr.mapping.map(d.to))
  if (!tr.docChanged) return
  editor.view.dispatch(tr.setMeta(TRACK, 'direct').setMeta('addToHistory', false))
}
