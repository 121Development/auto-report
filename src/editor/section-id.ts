import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { nanoid } from 'nanoid'
import { SECTION_TYPES } from './sections'

export const sectionIdKey = new PluginKey('sectionId')

/**
 * Gives every top-level block a unique, stable `sectionId`.
 *
 * - New blocks (typing Enter, paste, split) get a fresh ID.
 * - A duplicate ID (from splitting a block, which copies attributes) is replaced
 *   on the later block, so the original keeps its ID.
 * - Blocks nested inside other blocks (a paragraph inside a list item) are not
 *   sections, so any ID they carry is cleared.
 */
export const SectionId = Extension.create({
  name: 'sectionId',

  addGlobalAttributes() {
    return [
      {
        types: SECTION_TYPES,
        attributes: {
          sectionId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute('data-section-id'),
            renderHTML: (attrs) =>
              attrs.sectionId ? { 'data-section-id': attrs.sectionId } : {},
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: sectionIdKey,
        appendTransaction: (transactions, _old, state) => {
          const relevant = transactions.some(
            (tr) => tr.docChanged || tr.getMeta('sectionIdInit'),
          )
          if (!relevant) return null

          const tr = state.tr
          const seen = new Set<string>()
          state.doc.forEach((node, offset) => {
            const id = node.attrs.sectionId
            if ('sectionId' in node.attrs && (!id || seen.has(id))) {
              const fresh = nanoid(10)
              tr.setNodeAttribute(offset, 'sectionId', fresh)
              seen.add(fresh)
            } else if (id) {
              seen.add(id)
            }
            node.descendants((child, childOffset) => {
              if (child.attrs.sectionId) {
                tr.setNodeAttribute(offset + 1 + childOffset, 'sectionId', null)
              }
            })
          })
          if (!tr.docChanged) return null
          return tr.setMeta('addToHistory', false)
        },
      }),
    ]
  },

  onCreate() {
    // appendTransaction only runs on transactions; assign IDs to the initial content too.
    const { view, state } = this.editor
    view.dispatch(state.tr.setMeta('sectionIdInit', true))
  },
})
