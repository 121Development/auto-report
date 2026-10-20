import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { headingGroup, isTrailingPlaceholder, listSections, rangeBetween } from './sections'
import { authorOf } from './track-changes'

export interface GutterState {
  /** Selected section IDs, in document order. */
  selected: string[]
  /** Last section clicked without shift, the start of a shift-click range. */
  anchor: string | null
}

export interface GutterOptions {
  /** The action icon beside a number was clicked. Receives the target section IDs. */
  onAction: (sectionIds: string[]) => void
  onSelectionChange: (sectionIds: string[]) => void
}

function hasAiSuggestion(doc: PMNode, from: number, to: number): boolean {
  let found = false
  doc.nodesBetween(from, to, (node) => {
    if (!found && node.marks.some((m) => CHANGE_MARKS.has(m.type.name) && authorOf(m.attrs.id) === 'ai')) {
      found = true
    }
    return !found
  })
  return found
}

const CHANGE_MARKS = new Set(['insertion', 'deletion'])

export const gutterKey = new PluginKey<GutterState>('gutter')

const EMPTY: GutterState = { selected: [], anchor: null }

export function selectSections(view: EditorView, next: GutterState) {
  view.dispatch(view.state.tr.setMeta(gutterKey, next))
}

function inDocOrder(state: EditorState, ids: Iterable<string>): string[] {
  const set = new Set(ids)
  return listSections(state.doc)
    .map((s) => s.id)
    .filter((id) => set.has(id))
}

/** Click on a section number: plain, shift (range) or cmd/ctrl (toggle). */
function clickNumber(view: EditorView, id: string, e: MouseEvent) {
  const current = gutterKey.getState(view.state) ?? EMPTY
  const sections = listSections(view.state.doc)

  if (e.shiftKey && current.anchor) {
    selectSections(view, { selected: rangeBetween(sections, current.anchor, id), anchor: current.anchor })
    return
  }
  if (e.metaKey || e.ctrlKey) {
    const has = current.selected.includes(id)
    const selected = has ? current.selected.filter((s) => s !== id) : [...current.selected, id]
    selectSections(view, { selected: inDocOrder(view.state, selected), anchor: id })
    return
  }
  // Second click on an already selected heading widens to its heading group.
  const section = sections.find((s) => s.id === id)
  if (section?.type === 'heading' && current.selected.length === 1 && current.selected[0] === id) {
    selectSections(view, { selected: headingGroup(sections, id).map((s) => s.id), anchor: id })
    return
  }
  selectSections(view, { selected: [id], anchor: id })
}

function button(className: string, label: string, title: string, onClick: (e: MouseEvent) => void) {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = className
  el.textContent = label
  el.title = title
  el.contentEditable = 'false'
  el.addEventListener('mousedown', (e) => e.preventDefault())
  el.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick(e)
  })
  return el
}

export const Gutter = Extension.create<GutterOptions>({
  name: 'gutter',

  addOptions() {
    return { onAction: () => {}, onSelectionChange: () => {} }
  },

  addProseMirrorPlugins() {
    const options = this.options
    return [
      new Plugin<GutterState>({
        key: gutterKey,
        state: {
          init: () => EMPTY,
          apply(tr, value, _old, state) {
            const meta = tr.getMeta(gutterKey) as GutterState | undefined
            if (meta) return meta
            if (!tr.docChanged || value.selected.length === 0) return value
            // Drop selected sections that no longer exist.
            const alive = new Set(listSections(state.doc).map((s) => s.id))
            const selected = value.selected.filter((id) => alive.has(id))
            if (selected.length === value.selected.length) return value
            return { selected, anchor: value.anchor && alive.has(value.anchor) ? value.anchor : null }
          },
        },
        props: {
          decorations(state) {
            const { selected } = gutterKey.getState(state) ?? EMPTY
            const decos: Decoration[] = []
            const sections = listSections(state.doc)
            const last = sections[sections.length - 1]
            if (last && last.end === state.doc.content.size && isTrailingPlaceholder(state.doc, state.doc.childCount - 1)) {
              sections.pop()
            }
            for (const s of sections) {
              const isSelected = selected.includes(s.id)
              const hasAi = hasAiSuggestion(state.doc, s.pos, s.end)
              decos.push(
                Decoration.node(s.pos, s.end, {
                  class: isSelected ? 'section is-selected' : 'section',
                }),
                Decoration.widget(
                  s.pos,
                  (view) => {
                    const gutter = document.createElement('div')
                    gutter.className = `gutter${isSelected ? ' is-selected' : ''}${hasAi ? ' has-ai' : ''}`
                    gutter.contentEditable = 'false'
                    gutter.dataset.gutterFor = s.id
                    gutter.appendChild(
                      button('sec-num', String(s.number), 'Select section (shift: range, ⌘: add)', (e) =>
                        clickNumber(view, s.id, e),
                      ),
                    )
                    if (s.type === 'heading') {
                      gutter.appendChild(
                        button('sec-group', '⤓', 'Select heading and its sections', () =>
                          selectSections(view, {
                            selected: headingGroup(listSections(view.state.doc), s.id).map((x) => x.id),
                            anchor: s.id,
                          }),
                        ),
                      )
                    }
                    gutter.appendChild(
                      button('sec-action', '✦', 'AI actions', () => {
                        const current = gutterKey.getState(view.state) ?? EMPTY
                        options.onAction(current.selected.includes(s.id) ? current.selected : [s.id])
                      }),
                    )
                    return gutter
                  },
                  {
                    side: -1,
                    ignoreSelection: true,
                    stopEvent: () => true,
                    key: `${s.id}:${s.number}:${s.type}:${isSelected ? 1 : 0}:${hasAi ? 1 : 0}`,
                  },
                ),
              )
            }
            return DecorationSet.create(state.doc, decos)
          },
          handleClick(view) {
            // Clicking into the text clears a section selection.
            const current = gutterKey.getState(view.state) ?? EMPTY
            if (current.selected.length > 0) selectSections(view, EMPTY)
            return false
          },
        },
        view: () => {
          let last: string[] = []
          return {
            update(view) {
              const { selected } = gutterKey.getState(view.state) ?? EMPTY
              if (selected !== last) {
                last = selected
                options.onSelectionChange(selected)
              }
            },
          }
        },
      }),
    ]
  },
})
