import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { applyAiEdits, sectionsWithPendingAi, snapshotSections } from '../src/editor/ai-client'
import { baseExtensions } from '../src/editor/extensions'
import { listSections } from '../src/editor/sections'
import { listSuggestions, resolveSuggestions, suggestionIds } from '../src/editor/track-changes'

let editor: Editor | undefined
afterEach(() => editor?.destroy())

async function make(markdown: string) {
  const e = new Editor({ extensions: baseExtensions, content: markdown, contentType: 'markdown' })
  editor = e
  await new Promise((resolve) => e.on('create', resolve))
  return e
}

/** Typed text is marked as your insertion on the next microtask. */
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve))
const ids = (e: Editor) => listSections(e.state.doc).map((s) => s.id)
const texts = (e: Editor) => snapshotSections(e).map((s) => s.markdown)
const aiIds = (e: Editor) => suggestionIds(e.state.doc, (s) => s.author === 'ai')
const acceptAi = (e: Editor) => resolveSuggestions(e, aiIds(e), true)
const rejectAi = (e: Editor) => resolveSuggestions(e, aiIds(e), false)

describe('snapshotSections', () => {
  it('serializes each section to its own Markdown', async () => {
    const e = await make('# Title\n\nSome **bold** text.\n\n- a\n- b')
    const snap = snapshotSections(e)
    expect(snap.map((s) => s.markdown)).toEqual(['# Title', 'Some **bold** text.', '- a\n- b'])
    expect(snap.map((s) => s.number)).toEqual([1, 2, 3])
  })

  it('leaves out // prompt lines and gives them no number', async () => {
    const e = await make('One\n\n// make it shorter\n\nTwo')
    expect(texts(e)).toEqual(['One', 'Two'])
  })
})

describe('AI edits as tracked suggestions', () => {
  it('a paragraph rewrite becomes word-level AI suggestions; numbers and IDs hold', async () => {
    const e = await make('One\n\nThe quick brown fox jumps.\n\nThree')
    const before = ids(e)
    const res = applyAiEdits(e, [{ replaces: [before[1]], markdown: 'The quick red fox leaps.' }])
    expect(res).toEqual({ filled: 0, suggested: 1 })

    const pending = listSuggestions(e.state.doc).filter((s) => s.author === 'ai')
    expect(pending.length).toBeGreaterThanOrEqual(2)
    // "quick" and "fox" are untouched: only the changed words are marked.
    expect(e.state.doc.child(1).textContent).toContain('quick')
    expect(ids(e)).toEqual(before)
    expect(texts(e)[1]).toBe('The quick brown fox jumps.') // the AI still sees the current text

    acceptAi(e)
    expect(texts(e)[1]).toBe('The quick red fox leaps.')
    expect(ids(e)).toEqual(before)
    expect(listSuggestions(e.state.doc)).toEqual([])
  })

  it('rejecting restores the original', async () => {
    const e = await make('Short text here.')
    applyAiEdits(e, [{ replaces: ids(e), markdown: 'Completely different words.' }])
    rejectAi(e)
    expect(texts(e)).toEqual(['Short text here.'])
  })

  it('writes into an empty section directly, without a suggestion', async () => {
    const e = await make('# Heading')
    e.commands.focus('end')
    e.commands.splitBlock()
    const target = ids(e)[1]
    const res = applyAiEdits(e, [{ replaces: [target], markdown: 'Fresh text.' }])
    expect(res).toEqual({ filled: 1, suggested: 0 })
    expect(aiIds(e)).toEqual([])
    expect(texts(e)).toEqual(['# Heading', 'Fresh text.'])
    expect(ids(e)[1]).toBe(target)
  })

  it('one section into several blocks: pending blocks get no number; accept keeps the ID on the first', async () => {
    const e = await make('One\n\nTwo')
    const [a, b] = ids(e)
    applyAiEdits(e, [{ replaces: [a], markdown: 'One A.\n\nOne B.' }])
    expect(ids(e)).toEqual([a, b])
    acceptAi(e)
    const after = ids(e)
    expect(after).toHaveLength(3)
    expect(after[0]).toBe(a)
    expect(after[2]).toBe(b)
    expect(texts(e)).toEqual(['One A.', 'One B.', 'Two'])
  })

  it('merges non-adjacent sections into the first on accept', async () => {
    const e = await make('One\n\nTwo\n\nThree\n\nFour')
    const [a, b, c, d] = ids(e)
    applyAiEdits(e, [{ replaces: [d, b], markdown: 'Two and four.' }])
    expect(ids(e)).toEqual([a, b, c, d])
    acceptAi(e)
    expect(ids(e)).toEqual([a, b, c])
    expect(texts(e)).toEqual(['One', 'Two and four.', 'Three'])
  })

  it('accept and the suggestion itself are separate undo steps', async () => {
    const e = await make('Alpha beta.')
    applyAiEdits(e, [{ replaces: ids(e), markdown: 'Alpha gamma.' }])
    acceptAi(e)
    expect(texts(e)).toEqual(['Alpha gamma.'])
    e.commands.undo()
    expect(aiIds(e).length).toBeGreaterThan(0)
    e.commands.undo()
    expect(aiIds(e)).toEqual([])
    expect(texts(e)).toEqual(['Alpha beta.'])
  })

  it('reports sections with pending AI suggestions', async () => {
    const e = await make('One\n\nTwo')
    const [a, b] = ids(e)
    applyAiEdits(e, [{ replaces: [b], markdown: 'Deux' }])
    expect(sectionsWithPendingAi(e, [a, b])).toEqual([b])
  })
})

describe('AI edits on text you just typed', () => {
  it('arrive as AI suggestions, not merged into your own insertion', async () => {
    const e = await make('# Title')
    e.commands.focus('end')
    e.commands.insertContent('Freshly typed sentence about phishing.')
    await tick()
    const target = ids(e)[1]
    expect(listSuggestions(e.state.doc).some((s) => s.author === 'u')).toBe(true)

    applyAiEdits(e, [{ replaces: [target], markdown: 'A formal sentence about phishing.' }])
    expect(aiIds(e).length).toBeGreaterThan(0)
    expect(texts(e)[1]).toBe('Freshly typed sentence about phishing.')
    acceptAi(e)
    expect(texts(e)[1]).toBe('A formal sentence about phishing.')
    expect(ids(e)[1]).toBe(target)
  })

  it('leaves your tracked edits in other sections alone', async () => {
    const e = await make('One\n\nTwo')
    e.commands.insertContentAt(4, ' more')
    await tick()
    const [a, b] = ids(e)
    applyAiEdits(e, [{ replaces: [b], markdown: 'Deux' }])
    const own = listSuggestions(e.state.doc).filter((s) => s.author === 'u')
    expect(own.length).toBe(1)
    void a
  })
})

describe('your own edits are tracked', () => {
  it('typing is an own insertion; the AI snapshot includes it', async () => {
    const e = await make('Hello world')
    e.commands.insertContentAt(7, 'big ')
    await tick()
    const own = listSuggestions(e.state.doc).filter((s) => s.author === 'u')
    expect(own).toHaveLength(1)
    expect(texts(e)).toEqual(['Hello big world'])
  })

  it('Markdown input rules still work while tracking ("# " makes a heading, "- " a list)', async () => {
    const e = await make('')
    const typeChar = (ch: string) => {
      const { from, to } = e.state.selection
      const handled = e.view.someProp('handleTextInput', (f) => f(e.view, from, to, ch, () => e.state.tr.insertText(ch, from, to)))
      if (!handled) e.view.dispatch(e.state.tr.insertText(ch, from, to))
    }
    e.commands.focus('start')
    for (const ch of '# Title') typeChar(ch)
    expect(e.state.doc.child(0).type.name).toBe('heading')
    expect(texts(e)[0]).toBe('# Title')
    e.commands.focus('end') // the empty paragraph TipTap keeps after the heading
    for (const ch of '- item') typeChar(ch)
    await tick()
    expect(snapshotSections(e).map((s) => s.type)).toEqual(['heading', 'bulletList'])
    expect(listSuggestions(e.state.doc).every((s) => s.author === 'u' && s.kind === 'insertion')).toBe(true)
  })

  it('deleting a whole section removes its number even while tracked', async () => {
    const e = await make('One\n\nTwo\n\nThree')
    const [a, b, c] = ids(e)
    const second = listSections(e.state.doc)[1]
    e.commands.deleteRange({ from: second.pos + 1, to: second.end - 1 })
    expect(ids(e)).toEqual([a, c])
    expect(listSections(e.state.doc).map((s) => s.number)).toEqual([1, 2])
    void b
  })
})
