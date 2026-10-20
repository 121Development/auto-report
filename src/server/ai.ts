import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { createJevDecisionModel, heuristicDecisionModel } from '../ai/decision'
import { runAction } from '../ai/engine'
import { createClaudeGenerator, GenerationError } from '../ai/generate'
import type { ActionRequest, ActionResponse } from '../ai/types'

const ENTRIES = new Set(['inline', 'section', 'multi', 'document'])
const MODELS = new Set(['auto', 'haiku', 'sonnet', 'opus'])

function validate(input: ActionRequest): ActionRequest {
  if (!input || typeof input.instruction !== 'string' || !ENTRIES.has(input.entry)) {
    throw new Error('Invalid action request')
  }
  if (!Array.isArray(input.sections) || !Array.isArray(input.selection)) throw new Error('Invalid action request')
  return {
    documentId: String(input.documentId),
    entry: input.entry,
    instruction: input.instruction.slice(0, 4000),
    language: input.language === 'en' ? 'en' : 'sv',
    model: MODELS.has(input.model) ? input.model : 'auto',
    selection: input.selection.map(String),
    previousSectionId: input.previousSectionId ? String(input.previousSectionId) : null,
    sections: input.sections.map((s, i) => ({
      id: String(s.id),
      number: i + 1,
      type: String(s.type),
      markdown: String(s.markdown),
    })),
  }
}

function gatewayURL(): string | undefined {
  if (!env.CF_ACCOUNT_ID || !env.AI_GATEWAY_ID) return undefined
  return `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/anthropic`
}

/** The one AI endpoint. All four entry points send the same request. */
export const runActionFn = createServerFn({ method: 'POST' })
  .validator(validate)
  .handler(async ({ data }): Promise<ActionResponse> => {
    if (!env.ANTHROPIC_API_KEY) {
      return { kind: 'error', message: 'ANTHROPIC_API_KEY is not set (add it to .dev.vars or as a Worker secret).' }
    }
    const decider = env.TYPESAFE_API_KEY
      ? createJevDecisionModel({
          apiKey: env.TYPESAFE_API_KEY,
          model: env.DECISION_MODEL || 'jev-latest',
          baseURL: env.DECISION_BASE_URL || undefined,
        })
      : heuristicDecisionModel
    const generator = createClaudeGenerator({
      apiKey: env.ANTHROPIC_API_KEY,
      gatewayURL: gatewayURL(),
      gatewayToken: env.AI_GATEWAY_TOKEN || undefined,
    })
    try {
      return await runAction(data, { decider, fallbackDecider: heuristicDecisionModel, generator })
    } catch (error) {
      console.error('AI action failed', error)
      const message =
        error instanceof GenerationError ? error.message : 'The AI request failed. Check the server log.'
      return { kind: 'error', message }
    }
  })
