import type { DocumentSettings, Language } from '../lib/types'

/** Where a request came from. All four send the same `ActionRequest`. */
export type EntryPoint = 'inline' | 'section' | 'multi' | 'document'

export const ACTION_TYPES = ['rewrite', 'expand', 'shorten', 'merge', 'summarize', 'write', 'check'] as const
export type ActionType = (typeof ACTION_TYPES)[number]

export type ModelSize = 'fast' | 'strong'

/** One section as the client saw it when the prompt fired. */
export interface SectionSnapshot {
  id: string
  number: number
  type: string
  markdown: string
}

export interface ActionRequest {
  documentId: string
  entry: EntryPoint
  instruction: string
  language: Language
  model: DocumentSettings['model']
  /** Selected section IDs (section and multi-section entry points). */
  selection: string[]
  /** Inline prompts: the section right before the `//` line, if any. */
  previousSectionId: string | null
  /** Whole document, in order, at fire time. Section numbers resolve against this. */
  sections: SectionSnapshot[]
  /** A one-click preset fixes the action type; the decision model still sizes the model. */
  presetAction: ActionType | null
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Chat mode: refine a request before committing it as one action. */
export interface ChatRequest {
  language: 'sv' | 'en'
  targets: string[]
  sections: SectionSnapshot[]
  messages: ChatMessage[]
}

export type ChatResponse =
  | { kind: 'reply'; reply: string; instruction: string }
  | { kind: 'error'; message: string }

export interface Decision {
  action: ActionType
  actionConfidence: number
  /** Only asked for inline prompts; other entry points know their scope. */
  scope: 'previous' | 'named' | 'document' | 'unclear' | null
  scopeConfidence: number | null
  needsContext: boolean
  modelSize: ModelSize
  /** Which decision model answered, e.g. "jev-latest" or "heuristic". */
  decidedBy: string
}

/** Replace one or more sections (several only for merge) with new Markdown. */
export interface SectionEdit {
  replaces: string[]
  markdown: string
}

export interface SectionComment {
  sectionId: string
  comment: string
  suggestion: string
}

export type ActionResponse =
  | { kind: 'needs-target'; question: string; decision: Decision }
  | {
      kind: 'result'
      decision: Decision
      model: string
      targets: string[]
      edits: SectionEdit[]
      comments: SectionComment[]
      note: string
    }
  | { kind: 'error'; message: string }
