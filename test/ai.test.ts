// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createJevDecisionModel, heuristicDecisionModel, type DecisionModel } from '../src/ai/decision'
import { runAction, sanitizeEdits, SCOPE_CONFIDENCE_THRESHOLD } from '../src/ai/engine'
import { createClaudeGenerator, MODELS, selectModel, type Generator, type GenerationInput } from '../src/ai/generate'
import { parseSectionRefs } from '../src/ai/section-refs'
import type { ActionRequest, Decision } from '../src/ai/types'

describe('parseSectionRefs', () => {
  it.each([
    ['make section 4 shorter', [4]],
    ['merge sections 2 to 5', [2, 3, 4, 5]],
    ['sections 2-4', [2, 3, 4]],
    ['sections 1, 3 and 6', [1, 3, 6]],
    ['Section 3 and section 7', [3, 7]],
    ['§12 needs a source', [12]],
    ['korta avsnitt 3 till 5', [3, 4, 5]],
    ['slå ihop stycke 2 och 4', [2, 4]],
    ['sektion 9', [9]],
    ['sections 5-3', [3, 4, 5]],
  ])('%s', (text, expected) => {
    expect(parseSectionRefs(text)).toEqual(expected)
  })

  it('ignores numbers that are not section references', () => {
    expect(parseSectionRefs('cut it to 150 words')).toEqual([])
    expect(parseSectionRefs('the 2026 report, version 3')).toEqual([])
    expect(parseSectionRefs('intersections 4')).toEqual([])
  })
})

const sections = [
  { id: 'a', number: 1, type: 'heading', markdown: '# Title' },
  { id: 'b', number: 2, type: 'paragraph', markdown: 'First.' },
  { id: 'c', number: 3, type: 'paragraph', markdown: 'Second.' },
  { id: 'd', number: 4, type: 'paragraph', markdown: 'Third.' },
]

function request(over: Partial<ActionRequest>): ActionRequest {
  return {
    documentId: 'doc',
    entry: 'inline',
    instruction: 'make it shorter',
    language: 'sv',
    model: 'auto',
    selection: [],
    previousSectionId: 'c',
    sections,
    presetAction: null,
    ...over,
  }
}

function decider(partial: Partial<Decision>): DecisionModel & { calls: number } {
  const model = {
    calls: 0,
    async decide() {
      model.calls++
      return {
        action: 'shorten',
        actionConfidence: 0.9,
        scope: 'previous',
        scopeConfidence: 0.9,
        needsContext: false,
        modelSize: 'fast',
        decidedBy: 'test',
        ...partial,
      } satisfies Decision
    },
  }
  return model
}

function generator(): Generator & { last?: GenerationInput } {
  const g: Generator & { last?: GenerationInput } = {
    async generate(input) {
      g.last = input
      return {
        edits: input.targets.map((id) => ({ replaces: [id], markdown: `new ${id}` })),
        comments: [],
        note: '',
      }
    },
  }
  return g
}

describe('runAction', () => {
  it('resolves "previous section" for an inline prompt', async () => {
    const gen = generator()
    const res = await runAction(request({}), { decider: decider({}), generator: gen })
    expect(res.kind).toBe('result')
    expect(gen.last?.targets).toEqual(['c'])
    expect(gen.last?.model).toBe(MODELS.haiku)
  })

  it('named section numbers win over the decision model and resolve to IDs', async () => {
    const gen = generator()
    await runAction(request({ instruction: 'shorten sections 2 to 3' }), {
      decider: decider({ scope: 'unclear', scopeConfidence: 0.1 }),
      generator: gen,
    })
    expect(gen.last?.targets).toEqual(['b', 'c'])
  })

  it('asks "Which section?" when target confidence is low', async () => {
    const gen = generator()
    const res = await runAction(request({}), {
      decider: decider({ scopeConfidence: SCOPE_CONFIDENCE_THRESHOLD - 0.01 }),
      generator: gen,
    })
    expect(res).toMatchObject({ kind: 'needs-target', question: 'Which section?' })
    expect(gen.last).toBeUndefined()
  })

  it('reports a named section that does not exist instead of guessing', async () => {
    const res = await runAction(request({ instruction: 'expand section 9' }), {
      decider: decider({}),
      generator: generator(),
    })
    expect(res).toMatchObject({ kind: 'error' })
  })

  it('uses the selection for section actions and the strong model when asked', async () => {
    const gen = generator()
    await runAction(request({ entry: 'multi', selection: ['b', 'd'] }), {
      decider: decider({ modelSize: 'strong', scope: null, scopeConfidence: null }),
      generator: gen,
    })
    expect(gen.last?.targets).toEqual(['b', 'd'])
    expect(gen.last?.model).toBe(MODELS.sonnet)
  })

  it('document prompts target every section; a document setting pins the model', async () => {
    const gen = generator()
    await runAction(request({ entry: 'document', model: 'opus' }), { decider: decider({}), generator: gen })
    expect(gen.last?.targets).toEqual(['a', 'b', 'c', 'd'])
    expect(gen.last?.model).toBe(MODELS.opus)
  })

  it('falls back to the heuristic decider when the decision model fails', async () => {
    const failing: DecisionModel = {
      decide: () => Promise.reject(new Error('down')),
    }
    const res = await runAction(request({ instruction: 'make the previous section shorter' }), {
      decider: failing,
      fallbackDecider: heuristicDecisionModel,
      generator: generator(),
    })
    expect(res).toMatchObject({ kind: 'result', decision: { decidedBy: 'heuristic', action: 'shorten' } })
  })
})

describe('presets', () => {
  it('a preset fixes the action type while the decision model still sizes the model', async () => {
    const gen = generator()
    const res = await runAction(request({ entry: 'section', selection: ['b'], presetAction: 'expand' }), {
      decider: decider({ action: 'rewrite', modelSize: 'strong' }),
      generator: gen,
    })
    expect(res).toMatchObject({ kind: 'result', decision: { action: 'expand' } })
    expect(gen.last?.action).toBe('expand')
    expect(gen.last?.model).toBe(MODELS.sonnet)
  })
})

describe('sanitizeEdits', () => {
  it('drops edits to non-target sections, duplicates, and multi-replace outside merge', () => {
    const edits = [
      { replaces: ['b'], markdown: 'ok' },
      { replaces: ['x'], markdown: 'not a target' },
      { replaces: ['b'], markdown: 'duplicate' },
      { replaces: ['c', 'd'], markdown: 'merge' },
    ]
    expect(sanitizeEdits(edits, ['b', 'c', 'd'], false)).toEqual([{ replaces: ['b'], markdown: 'ok' }])
    expect(sanitizeEdits(edits, ['b', 'c', 'd'], true)).toEqual([
      { replaces: ['b'], markdown: 'ok' },
      { replaces: ['c', 'd'], markdown: 'merge' },
    ])
  })
})

describe('selectModel', () => {
  it('auto maps fast/strong to Haiku/Sonnet; settings override', () => {
    expect(selectModel('auto', 'fast')).toBe(MODELS.haiku)
    expect(selectModel('auto', 'strong')).toBe(MODELS.sonnet)
    expect(selectModel('opus', 'fast')).toBe(MODELS.opus)
  })
})

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

describe('Jev decision model (wire level)', () => {
  it('posts typed questions to the configured endpoint and maps answers', async () => {
    const calls: { url: string; body: any; auth: string | null }[] = []
    const fetchMock: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body))
      calls.push({ url: String(url), body, auth: new Headers(init?.headers).get('authorization') })
      return json({
        model: 'jev-1.13.0',
        usage: { input_tokens: 10, output_tokens: 3 },
        answers: {
          action: { type: 'choice', choice: 'expand', confidence: 0.82, probabilities: { expand: 0.9, rewrite: 0.1 } },
          needsContext: { type: 'noul', noul: 0.2 },
          modelSize: { type: 'choice', choice: 'strong', confidence: 0.7, probabilities: { strong: 0.8, fast: 0.2 } },
          scope: { type: 'choice', choice: 'previous', confidence: 0.91, probabilities: { previous: 0.95 } },
        },
      })
    }
    const model = createJevDecisionModel({
      apiKey: 'k',
      model: 'clef-flash',
      baseURL: 'https://clef.example/',
      fetch: fetchMock,
    })
    const decision = await model.decide({
      entry: 'inline',
      instruction: 'expand the previous section',
      language: 'en',
      namedSections: [],
      targetCount: 1,
      outline: [],
    })
    expect(calls[0].url).toBe('https://clef.example/v1/systemone')
    expect(calls[0].auth).toBe('Bearer k')
    expect(calls[0].body.model).toBe('clef-flash')
    expect(Object.keys(calls[0].body.questions).sort()).toEqual(['action', 'modelSize', 'needsContext', 'scope'])
    expect(calls[0].body.questions.needsContext.type).toBe('noul')
    expect(decision).toEqual({
      action: 'expand',
      actionConfidence: 0.82,
      scope: 'previous',
      scopeConfidence: 0.91,
      needsContext: false,
      modelSize: 'strong',
      decidedBy: 'jev-1.13.0',
    })
  })

  it('does not ask about scope outside inline prompts', async () => {
    let questions: string[] = []
    const fetchMock: typeof fetch = async (_url, init) => {
      questions = Object.keys(JSON.parse(String(init?.body)).questions)
      return json({
        model: 'jev',
        usage: { input_tokens: 1, output_tokens: 1 },
        answers: {
          action: { type: 'choice', choice: 'rewrite', confidence: 0.9, probabilities: { rewrite: 0.9 } },
          needsContext: { type: 'noul', noul: 0.9 },
          modelSize: { type: 'choice', choice: 'fast', confidence: 0.9, probabilities: { fast: 0.9 } },
        },
      })
    }
    const d = await createJevDecisionModel({ apiKey: 'k', model: 'jev-latest', fetch: fetchMock }).decide({
      entry: 'section',
      instruction: 'rewrite',
      language: 'sv',
      namedSections: [],
      targetCount: 1,
      outline: [],
    })
    expect(questions).not.toContain('scope')
    expect(d.scope).toBeNull()
    expect(d.needsContext).toBe(true)
  })
})

describe('Claude generator (wire level)', () => {
  function claudeFetch(captured: { url?: string; body?: any; headers?: Headers }, stop = 'end_turn') {
    const fetchMock: typeof fetch = async (url, init) => {
      captured.url = String(url)
      captured.body = JSON.parse(String(init?.body))
      captured.headers = new Headers(init?.headers)
      return json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: captured.body.model,
        stop_reason: stop,
        stop_sequence: null,
        content: [
          { type: 'text', text: JSON.stringify({ edits: [{ replaces: ['b'], markdown: 'Kortare.' }], comments: [], note: '' }) },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    }
    return fetchMock
  }

  const input: GenerationInput = {
    action: 'shorten',
    instruction: 'shorter',
    language: 'sv',
    model: MODELS.sonnet,
    sections,
    targets: ['b'],
  }

  it('goes through AI Gateway with structured output and refusal fallbacks', async () => {
    const captured: { url?: string; body?: any; headers?: Headers } = {}
    const gen = createClaudeGenerator({
      apiKey: 'sk',
      gatewayURL: 'https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic',
      gatewayToken: 'gwt',
      fetch: claudeFetch(captured),
    })
    const out = await gen.generate(input)
    expect(out.edits).toEqual([{ replaces: ['b'], markdown: 'Kortare.' }])
    expect(captured.url).toMatch(/^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/acct\/gw\/anthropic\/v1\/messages/)
    expect(captured.headers?.get('cf-aig-authorization')).toBe('Bearer gwt')
    expect(captured.headers?.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
    expect(captured.body.fallbacks).toBe('default')
    expect(captured.body.output_config.format.type).toBe('json_schema')
    expect(captured.body.output_config.effort).toBe('medium')
    expect(captured.body.messages[0].content[0].text).toContain('<section id="b" n="2" target="true">')
    expect(captured.body.messages[0].content[0].text).toContain('language="Swedish"')
  })

  it('sends no fallback for Haiku', async () => {
    const captured: { url?: string; body?: any; headers?: Headers } = {}
    await createClaudeGenerator({ apiKey: 'sk', fetch: claudeFetch(captured) }).generate({ ...input, model: MODELS.haiku })
    expect(captured.body.fallbacks).toBeUndefined()
    expect(captured.body.output_config.effort).toBe('low')
    expect(captured.url).toMatch(/^https:\/\/api\.anthropic\.com\//)
  })

  it('turns a refusal into a readable error', async () => {
    const gen = createClaudeGenerator({ apiKey: 'sk', fetch: claudeFetch({}, 'refusal') })
    await expect(gen.generate(input)).rejects.toThrow('declined')
  })
})
