import type { JSONContent } from '@tiptap/core'

export type Language = 'sv' | 'en'

export interface DocumentSettings {
  model: 'auto' | 'haiku' | 'sonnet' | 'opus'
  imageCaptions: boolean
  showOwnChanges: boolean
}

export const DEFAULT_SETTINGS: DocumentSettings = {
  model: 'auto',
  imageCaptions: true,
  showOwnChanges: false,
}

export interface DocumentRecord {
  id: string
  title: string
  language: Language
  settings: DocumentSettings
  content: JSONContent
  createdAt: number
  updatedAt: number
}

export type DocumentSummary = Pick<DocumentRecord, 'id' | 'title' | 'updatedAt'>

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }
