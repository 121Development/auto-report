import Anthropic from '@anthropic-ai/sdk'
import type { DocumentSettings } from '../lib/types'
import type {
  ActionType,
  ModelSize,
  SectionComment,
  SectionEdit,
  SectionSnapshot,
} from './types'

export const MODELS = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
} as const

/** Jev picks fast or strong; a document setting can pin a model, including Opus for full drafts. */
export function selectModel(setting: DocumentSettings['model'], size: ModelSize): string {
  if (setting !== 'auto') return MODELS[setting]
  return size === 'fast' ? MODELS.haiku : MODELS.sonnet
}

const EFFORT: Record<string, 'low' | 'medium' | 'high'> = {
  [MODELS.haiku]: 'low',
  [MODELS.sonnet]: 'medium',
  [MODELS.opus]: 'high',
}

export interface GenerationInput {
  action: ActionType
  instruction: string
  language: 'sv' | 'en'
  model: string
  sections: SectionSnapshot[]
  targets: string[]
}

export interface GenerationOutput {
  edits: SectionEdit[]
  comments: SectionComment[]
  note: string
}

/** Writes the change. Claude via AI Gateway in production; a stub in tests. */
export interface Generator {
  generate(input: GenerationInput): Promise<GenerationOutput>
}

export interface ClaudeConfig {
  apiKey: string
  /** Cloudflare AI Gateway base URL for Anthropic, e.g. https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic */
  gatewayURL?: string
  /** Token for an authenticated gateway (cf-aig-authorization). */
  gatewayToken?: string
  fetch?: typeof fetch
}

export class GenerationError extends Error {}

const SYSTEM = `You are the writing engine inside a Markdown editor. The writer drafts reports, articles and posts. The document is split into numbered sections; each has a stable id.

You receive the full document, the ids of the target sections, the action, and the writer's instruction. Return JSON only, matching the schema:
- "edits": the new Markdown for target sections. Each edit lists the section ids it replaces in "replaces". Normally one edit per target, replacing exactly that one section. For "merge", one edit replaces all merged sections. Only ever replace target sections. Leave a target out if it needs no change.
- "comments": for "check", one comment per issue found, with a concrete suggested fix. Empty for other actions.
- "note": one short sentence for the writer about what you changed, or an empty string.

Writing rules:
- Write in the document's language. Keep the writer's terminology, voice and formatting conventions.
- Markdown in an edit may hold several blocks (paragraphs, a list) when the action calls for it, but a heading stays a heading.
- Never invent facts, figures or sources. If the instruction needs information that isn't in the document, keep to what is there and say so in "note".
- Don't add commentary inside the text itself.`

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['edits', 'comments', 'note'],
  properties: {
    edits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['replaces', 'markdown'],
        properties: {
          replaces: { type: 'array', items: { type: 'string' } },
          markdown: { type: 'string' },
        },
      },
    },
    comments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sectionId', 'comment', 'suggestion'],
        properties: {
          sectionId: { type: 'string' },
          comment: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
    note: { type: 'string' },
  },
}

function renderDocument(sections: SectionSnapshot[], targets: Set<string>): string {
  return sections
    .map(
      (s) =>
        `<section id="${s.id}" n="${s.number}"${targets.has(s.id) ? ' target="true"' : ''}>\n${s.markdown}\n</section>`,
    )
    .join('\n')
}

export function createClaudeGenerator(config: ClaudeConfig): Generator {
  const client = new Anthropic({
    apiKey: config.apiKey,
    ...(config.gatewayURL ? { baseURL: config.gatewayURL } : {}),
    ...(config.gatewayToken ? { defaultHeaders: { 'cf-aig-authorization': `Bearer ${config.gatewayToken}` } } : {}),
    ...(config.fetch ? { fetch: config.fetch } : {}),
  })

  return {
    async generate(input) {
      const targets = new Set(input.targets)
      const language = input.language === 'sv' ? 'Swedish' : 'English'
      // Haiku has no server-side refusal fallback; Sonnet and Opus fall back by refusal category.
      const fallback = input.model !== MODELS.haiku

      const response = await client.beta.messages.create({
        model: input.model,
        max_tokens: 16000,
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        output_config: {
          effort: EFFORT[input.model] ?? 'medium',
          format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
        },
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `<document language="${language}">\n${renderDocument(input.sections, targets)}\n</document>`,
                cache_control: { type: 'ephemeral' },
              },
              {
                type: 'text',
                text: `Action: ${input.action}\nTarget section ids: ${input.targets.join(', ')}\nInstruction: ${input.instruction}`,
              },
            ],
          },
        ],
      })

      if (response.stop_reason === 'refusal') {
        throw new GenerationError('Claude declined this request.')
      }
      if (response.stop_reason === 'max_tokens') {
        throw new GenerationError('The response was cut off. Try a smaller selection.')
      }
      const text = response.content.find((b) => b.type === 'text')
      if (!text || text.type !== 'text') throw new GenerationError('Claude returned no text.')
      let parsed: GenerationOutput
      try {
        parsed = JSON.parse(text.text)
      } catch {
        throw new GenerationError('Claude returned malformed JSON.')
      }
      return parsed
    },
  }
}
