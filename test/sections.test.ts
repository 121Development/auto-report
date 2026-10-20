import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { baseExtensions } from '../src/editor/extensions'
import {
  headingGroup,
  idForNumber,
  listSections,
  rangeBetween,
  reconcileSectionIds,
} from '../src/editor/sections'

let editor: Editor | undefined

/** TipTap emits `create` on a timeout; initial section IDs are assigned then. */
async function make(markdown: string) {
  const e = new Editor({ extensions: baseExtensions, content: markdown, contentType: 'markdown' })
  editor = e
  await new Promise((resolve) => e.on('create', resolve))
  return e
}

const ids = (e: Editor) => listSections(e.state.doc).map((s) => s.id)

afterEach(() => editor?.destroy())

describe('section model', () => {
  it('treats each top-level block as one section, a whole list as one', async () => {
    const e = await make('# Title\n\nFirst paragraph.\n\n- one\n- two\n- three\n\nLast.')
    const sections = listSections(e.state.doc)
    expect(sections.map((s) => s.type)).toEqual(['heading', 'paragraph', 'bulletList', 'paragraph'])
    expect(sections.map((s) => s.number)).toEqual([1, 2, 3, 4])
  })

  it('assigns unique IDs to initial content and never to nested blocks', async () => {
    const e = await make('A\n\nB\n\n- x\n- y')
    const list = ids(e)
    expect(list.every(Boolean)).toBe(true)
    expect(new Set(list).size).toBe(list.length)
    let nested = 0
    e.state.doc.forEach((node) =>
      node.descendants((child) => {
        if (child.attrs.sectionId) nested++
      }),
    )
    expect(nested).toBe(0)
  })

  it('keeps the original ID and gives a new one when a paragraph is split', async () => {
    const e = await make('Hello world')
    const [original] = ids(e)
    e.commands.setTextSelection(6)
    e.commands.splitBlock()
    const after = ids(e)
    expect(after).toHaveLength(2)
    expect(after[0]).toBe(original)
    expect(after[1]).not.toBe(original)
  })

  it('renumbers live but keeps IDs stable when a section is deleted', async () => {
    const e = await make('One\n\nTwo\n\nThree')
    const [one, two, three] = ids(e)
    const second = listSections(e.state.doc)[1]
    e.commands.deleteRange({ from: second.pos, to: second.end })
    const sections = listSections(e.state.doc)
    expect(sections.map((s) => s.id)).toEqual([one, three])
    expect(idForNumber(sections, 2)).toBe(three)
    expect(sections.find((s) => s.id === two)).toBeUndefined()
  })

  it('gives pasted duplicates fresh IDs', async () => {
    const e = await make('One')
    const json = e.getJSON()
    e.commands.insertContentAt(e.state.doc.content.size, json.content!)
    const list = ids(e)
    expect(list).toHaveLength(2)
    expect(new Set(list).size).toBe(2)
  })
})

describe('selection helpers', () => {
  it('heading group stops at the next heading of any level', async () => {
    const e = await make('## A\n\na1\n\na2\n\n### B\n\nb1\n\n## C')
    const sections = listSections(e.state.doc)
    const group = headingGroup(sections, sections[0].id).map((s) => s.number)
    expect(group).toEqual([1, 2, 3])
    expect(headingGroup(sections, sections[3].id).map((s) => s.number)).toEqual([4, 5])
    expect(headingGroup(sections, sections[1].id).map((s) => s.number)).toEqual([2])
  })

  it('range works in either direction', async () => {
    const e = await make('a\n\nb\n\nc\n\nd')
    const s = listSections(e.state.doc)
    expect(rangeBetween(s, s[3].id, s[1].id)).toEqual([s[1].id, s[2].id, s[3].id])
  })
})

describe('raw Markdown round trip', () => {
  it('restores IDs of unchanged blocks and lets edited blocks get new ones', async () => {
    const e = await make('# Title\n\nKeep me.\n\nChange me.')
    const before = e.getJSON()
    const [title, keep, change] = ids(e)
    const parsed = e.markdown!.parse('# Title\n\nKeep me.\n\nChanged!')
    e.commands.setContent(reconcileSectionIds(before, parsed))
    const after = ids(e)
    expect(after[0]).toBe(title)
    expect(after[1]).toBe(keep)
    expect(after[2]).not.toBe(change)
    expect(after[2]).toBeTruthy()
  })
})
