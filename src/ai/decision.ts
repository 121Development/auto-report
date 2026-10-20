import { boolean, choice, decide } from '@tanstack/ai'
import { createTypesafeDecider } from '@tanstack/ai-typesafe'
import type { ActionType, Decision, EntryPoint, ModelSize } from './types'

/** What the decision model sees: the instruction plus a light outline, never full text. */
export interface DecisionInput {
  entry: EntryPoint
  instruction: string
  language: string
  /** Section numbers parsed from the instruction (already deterministic). */
  namedSections: number[]
  targetCount: number
  outline: { number: number; type: string; excerpt: string }[]
}

/** Classifies a request. Jev today; Clef later, behind the same interface. */
export interface DecisionModel {
  decide(input: DecisionInput): Promise<Decision>
}

const ACTION_OPTIONS = {
  rewrite: 'Rewrite the target with the same content in a different wording, tone or style',
  expand: 'Make the target longer: add detail, examples or explanation',
  shorten: 'Make the target shorter or tighter',
  merge: 'Combine several sections into one',
  summarize: 'Replace the target with a summary of it',
  write: 'Write new text: fill an empty section or add new content',
  check: 'Check consistency, terminology or facts and report issues, without rewriting',
} satisfies Record<ActionType, string>

const SCOPE_OPTIONS = {
  previous: 'The section just before the prompt line',
  named: 'Sections the prompt names by number',
  document: 'The whole document',
  unclear: 'The prompt does not make clear which text it is about',
}

const MODEL_OPTIONS = {
  fast: 'A small, local edit to a short passage',
  strong: 'Substantial rewriting, reasoning across sections, or long output',
} satisfies Record<ModelSize, string>

export interface JevConfig {
  apiKey: string
  /** "jev-latest", or a Clef model id once the endpoint is switched. */
  model: string
  /** Defaults to TypeSafe. Point at a Jev-compatible endpoint (e.g. Clef on Workers AI) to swap. */
  baseURL?: string
  fetch?: typeof fetch
}

export function createJevDecisionModel(config: JevConfig): DecisionModel {
  const adapter = createTypesafeDecider(config.model, config.apiKey, {
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.fetch ? { fetch: config.fetch } : {}),
    timeout: 10_000,
  })

  return {
    async decide(input) {
      const base = {
        action: choice({ instructions: 'What kind of change does the writer ask for?', options: ACTION_OPTIONS }),
        needsContext: boolean({
          instructions:
            'Does the request depend on attached context documents (sources, notes, uploaded files) rather than only the document text?',
        }),
        modelSize: choice({ instructions: 'How demanding is the writing task?', options: MODEL_OPTIONS }),
      }
      // Scope is only open for inline prompts; other entry points carry their own target.
      if (input.entry === 'inline') {
        const result = await decide({
          adapter,
          state: input,
          questions: {
            ...base,
            scope: choice({ instructions: 'Which part of the document is the prompt about?', options: SCOPE_OPTIONS }),
          },
        })
        return {
          action: result.action.value,
          actionConfidence: result.action.confidence,
          scope: result.scope.value,
          scopeConfidence: result.scope.confidence,
          needsContext: result.needsContext.value,
          modelSize: result.modelSize.value,
          decidedBy: result.meta.model,
        }
      }
      const result = await decide({ adapter, state: input, questions: base })
      return {
        action: result.action.value,
        actionConfidence: result.action.confidence,
        scope: null,
        scopeConfidence: null,
        needsContext: result.needsContext.value,
        modelSize: result.modelSize.value,
        decidedBy: result.meta.model,
      }
    },
  }
}

const KEYWORDS: [ActionType, RegExp][] = [
  ['check', /\b(check|verify|consisten|terminolog|kontrollera|granska|konsekven)/i],
  ['merge', /\b(merge|combine|slå ihop|sammanfoga)/i],
  ['summarize', /\b(summar|sammanfatta)/i],
  ['shorten', /\b(short|tighten|trim|condense|kort|korta|strama)/i],
  ['expand', /\b(expand|longer|elaborate|double|utveckla|längre|bygg ut)/i],
  ['write', /\b(write|draft|add|skriv|lägg till)/i],
]

/**
 * Keyword fallback used when no decision-model key is configured (local dev),
 * or when the decision call fails. Low confidence on scope makes the engine ask.
 */
export const heuristicDecisionModel: DecisionModel = {
  async decide(input) {
    const action = KEYWORDS.find(([, re]) => re.test(input.instruction))?.[0] ?? 'rewrite'
    let scope: Decision['scope'] = null
    let scopeConfidence: number | null = null
    if (input.entry === 'inline') {
      if (input.namedSections.length > 0) [scope, scopeConfidence] = ['named', 1]
      else if (/\b(previous|above|föregående|ovan|förra)\b/i.test(input.instruction)) [scope, scopeConfidence] = ['previous', 0.9]
      else if (/\b(document|whole|entire|dokument|hela)\b/i.test(input.instruction)) [scope, scopeConfidence] = ['document', 0.8]
      else [scope, scopeConfidence] = ['unclear', 0.3]
    }
    const strong = input.entry === 'document' || input.targetCount > 2 || action === 'merge' || action === 'check'
    return {
      action,
      actionConfidence: 0.5,
      scope,
      scopeConfidence,
      needsContext: /\b(context|source|attached|underlag|källa|bifogad)/i.test(input.instruction),
      modelSize: strong ? 'strong' : 'fast',
      decidedBy: 'heuristic',
    }
  },
}
