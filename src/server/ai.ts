import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { createJevDecisionModel, heuristicDecisionModel } from '../ai/decision'
import { runAction } from '../ai/engine'
import { createClaudeChat, createClaudeGenerator, GenerationError, type ClaudeConfig } from '../ai/generate'
import {
  ACTION_TYPES,
  type ActionRequest,
  type ActionResponse,
  type ActionType,
  type ChatRequest,
  type ChatResponse,
  type SectionSnapshot,
} from '../ai/types'

const ENTRIES = new Set(['inline', 'section', 'multi', 'document'])
const MODELS = new Set(['auto', 'haiku', 'sonnet', 'opus'])
const ACTIONS = new Set<string>(ACTION_TYPES)

function validSections(input: unknown): SectionSnapshot[] {
  if (!Array.isArray(input)) throw new Error('Invalid request')
  return input.map((s, i) => ({
    id: String(s.id),
    number: i + 1,
    type: String(s.type),
    markdown: String(s.markdown),
  }))
}

function validate(input: ActionRequest): ActionRequest {
  if (!input || typeof input.instruction !== 'string' || !ENTRIES.has(input.entry)) {
    throw new Error('Invalid action request')
  }
  if (!Array.isArray(input.selection)) throw new Error('Invalid action request')
  return {
    documentId: String(input.documentId),
    entry: input.entry,
    instruction: input.instruction.slice(0, 4000),
    language: input.language === 'en' ? 'en' : 'sv',
    model: MODELS.has(input.model) ? input.model : 'auto',
    selection: input.selection.map(String),
    previousSectionId: input.previousSectionId ? String(input.previousSectionId) : null,
    sections: validSections(input.sections),
    presetAction: ACTIONS.has(input.presetAction ?? '') ? (input.presetAction as ActionType) : null,
  }
}

function claudeConfig(): ClaudeConfig | null {
  if (!env.ANTHROPIC_API_KEY) return null
  const gatewayURL =
    env.CF_ACCOUNT_ID && env.AI_GATEWAY_ID
      ? `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/anthropic`
      : undefined
  return { apiKey: env.ANTHROPIC_API_KEY, gatewayURL, gatewayToken: env.AI_GATEWAY_TOKEN || undefined }
}

const MISSING_KEY = 'ANTHROPIC_API_KEY is not set (add it to .dev.vars or as a Worker secret).'

function failure(error: unknown) {
  console.error('AI request failed', error)
  return {
    kind: 'error' as const,
    message: error instanceof GenerationError ? error.message : 'The AI request failed. Check the server log.',
  }
}

/** The one AI endpoint. All four entry points send the same request. */
export const runActionFn = createServerFn({ method: 'POST' })
  .validator(validate)
  .handler(async ({ data }): Promise<ActionResponse> => {
    const config = claudeConfig()
    if (!config) return { kind: 'error', message: MISSING_KEY }
    const decider = env.TYPESAFE_API_KEY
      ? createJevDecisionModel({
          apiKey: env.TYPESAFE_API_KEY,
          model: env.DECISION_MODEL || 'jev-latest',
          baseURL: env.DECISION_BASE_URL || undefined,
        })
      : heuristicDecisionModel
    try {
      return await runAction(data, {
        decider,
        fallbackDecider: heuristicDecisionModel,
        generator: createClaudeGenerator(config),
      })
    } catch (error) {
      return failure(error)
    }
  })

/** Chat mode: refine the request in a back-and-forth before running it. */
export const chatFn = createServerFn({ method: 'POST' })
  .validator((input: ChatRequest): ChatRequest => {
    if (!input || !Array.isArray(input.messages) || input.messages.length === 0) throw new Error('Invalid chat request')
    return {
      language: input.language === 'en' ? 'en' : 'sv',
      targets: Array.isArray(input.targets) ? input.targets.map(String) : [],
      sections: validSections(input.sections),
      messages: input.messages.slice(-20).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content).slice(0, 4000),
      })),
    }
  })
  .handler(async ({ data }): Promise<ChatResponse> => {
    const config = claudeConfig()
    if (!config) return { kind: 'error', message: MISSING_KEY }
    try {
      const { reply, instruction } = await createClaudeChat(config).chat(data)
      return { kind: 'reply', reply, instruction }
    } catch (error) {
      return failure(error)
    }
  })
