import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { applyEdits, snapshotSections } from '../src/editor/ai-client'
import { baseExtensions } from '../src/editor/extensions'
import { listSections } from '../src/editor/sections'

let editor: Editor | undefined
afterEach(() => editor?.destroy())

async function make(markdown: string) {
  const e = new Editor({ extensions: baseExtensions, content: markdown, contentType: 'markdown' })
  editor = e
  await new Promise((resolve) => e.on('create', resolve))
  return e
}

describe('snapshotSections', () => {
  it('serializes each section to its own Markdown', async () => {
    const e = await make('# Title\n\nSome **bold** text.\n\n- a\n- b')
    const snap = snapshotSections(e)
    expect(snap.map((s) => s.markdown)).toEqual(['# Title', 'Some **bold** text.', '- a\n- b'])
    expect(snap.map((s) => s.number)).toEqual([1, 2, 3])
  })
})

describe('applyEdits', () => {
  it('replaces a section and keeps its ID', async () => {
    const e = await make('One\n\nTwo\n\nThree')
    const [a, b, c] = listSections(e.state.doc).map((s) => s.id)
    applyEdits(e, [{ replaces: [b], markdown: 'Two, rewritten.' }])
    const after = listSections(e.state.doc)
    expect(after.map((s) => s.id)).toEqual([a, b, c])
    expect(e.getMarkdown()).toContain('Two, rewritten.')
  })

  it('expands one section into several blocks; only the first keeps the ID', async () => {
    const e = await make('One\n\nTwo')
    const [a, b] = listSections(e.state.doc).map((s) => s.id)
    applyEdits(e, [{ replaces: [a], markdown: 'One A.\n\nOne B.' }])
    const ids = listSections(e.state.doc).map((s) => s.id)
    expect(ids).toHaveLength(3)
    expect(ids[0]).toBe(a)
    expect(ids[2]).toBe(b)
    expect(new Set(ids).size).toBe(3)
  })

  it('merges non-adjacent sections into the first, removing the others', async () => {
    const e = await make('One\n\nTwo\n\nThree\n\nFour')
    const [a, b, c, d] = listSections(e.state.doc).map((s) => s.id)
    applyEdits(e, [{ replaces: [d, b], markdown: 'Two and four.' }])
    const after = listSections(e.state.doc)
    expect(after.map((s) => s.id)).toEqual([a, b, c])
    expect(e.state.doc.child(1).textContent).toBe('Two and four.')
  })

  it('is one undo step', async () => {
    const e = await make('One\n\nTwo')
    const [a, b] = listSections(e.state.doc).map((s) => s.id)
    applyEdits(e, [
      { replaces: [a], markdown: 'Uno' },
      { replaces: [b], markdown: 'Dos' },
    ])
    expect(e.state.doc.textContent).toBe('UnoDos')
    e.commands.undo()
    expect(e.state.doc.textContent).toBe('OneTwo')
  })
})
