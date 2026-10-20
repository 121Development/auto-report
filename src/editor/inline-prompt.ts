import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { isPromptLine } from './resolve-view'
import { listSections } from './sections'
import { TRACK } from './track-changes'

export interface InlinePromptOptions {
  /** Fired when Enter is pressed on a `//` line. The line is already removed. */
  onPrompt: (prompt: { instruction: string; previousSectionId: string | null }) => void
}

const key = new PluginKey('inlinePrompt')
const ZWSP = /​/g

/**
 * A top-level paragraph starting with `//` is a prompt, not text. Enter fires it:
 * the line is removed (never tracked, never exported) and the instruction goes to
 * the action engine. `//` mid-line, as in URLs, never triggers.
 */
export const InlinePrompt = Extension.create<InlinePromptOptions>({
  name: 'inlinePrompt',
  priority: 1000,

  addOptions() {
    return { onPrompt: () => {} }
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty || $from.depth !== 1) return false
        const node = $from.parent
        if (node.type.name !== 'paragraph' || !isPromptLine(node.textContent)) return false

        const instruction = node.textContent.replace(ZWSP, '').trim().replace(/^\/\/\s*/, '')
        const pos = $from.before(1)
        const previous = listSections(editor.state.doc).filter((s) => s.end <= pos)
        const previousSectionId = previous.length > 0 ? previous[previous.length - 1].id : null

        const tr = editor.state.tr
        if (editor.state.doc.childCount > 1) tr.delete(pos, pos + node.nodeSize)
        else tr.replaceWith(pos, pos + node.nodeSize, editor.schema.nodes.paragraph.create())
        editor.view.dispatch(tr.setMeta(TRACK, 'direct'))

        if (instruction) this.options.onPrompt({ instruction, previousSectionId })
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            state.doc.forEach((node, offset) => {
              if (node.type.name === 'paragraph' && isPromptLine(node.textContent)) {
                decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'prompt-line' }))
              }
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
