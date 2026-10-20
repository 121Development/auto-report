import { createServerFn } from '@tanstack/react-start'
import type { JSONContent } from '@tiptap/core'
import { env } from 'cloudflare:workers'
import { nanoid } from 'nanoid'
import {
  DEFAULT_SETTINGS,
  EMPTY_DOC,
  type DocumentRecord,
  type DocumentSummary,
  type Language,
} from '../lib/types'

interface DocumentRow {
  id: string
  title: string
  language: Language
  settings: string
  content: string
  created_at: number
  updated_at: number
}

function fromRow(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    title: row.title,
    language: row.language,
    settings: { ...DEFAULT_SETTINGS, ...JSON.parse(row.settings) },
    content: JSON.parse(row.content),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const listDocuments = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DocumentSummary[]> => {
    const { results } = await env.DB.prepare(
      'SELECT id, title, updated_at FROM documents ORDER BY updated_at DESC',
    ).all<Pick<DocumentRow, 'id' | 'title' | 'updated_at'>>()
    return results.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }))
  },
)

export const getDocument = createServerFn({ method: 'GET' })
  .validator((id: string) => {
    if (typeof id !== 'string' || !id) throw new Error('Document id required')
    return id
  })
  .handler(async ({ data: id }): Promise<DocumentRecord | null> => {
    const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ?')
      .bind(id)
      .first<DocumentRow>()
    return row ? fromRow(row) : null
  })

export const createDocument = createServerFn({ method: 'POST' })
  .validator((input: { language?: Language } | undefined) => ({
    language: input?.language === 'en' ? ('en' as const) : ('sv' as const),
  }))
  .handler(async ({ data }): Promise<{ id: string }> => {
    const id = nanoid(12)
    const now = Date.now()
    await env.DB.prepare(
      `INSERT INTO documents (id, title, language, settings, content, created_at, updated_at)
       VALUES (?, '', ?, ?, ?, ?, ?)`,
    )
      .bind(id, data.language, JSON.stringify(DEFAULT_SETTINGS), JSON.stringify(EMPTY_DOC), now, now)
      .run()
    return { id }
  })

export interface SaveInput {
  id: string
  title: string
  content: JSONContent
  updatedAt: number
}

/**
 * Autosave. Writes only if the incoming change is newer than what's stored, so a
 * stale local copy syncing late can't overwrite newer work. Returns the stored timestamp.
 */
export const saveDocument = createServerFn({ method: 'POST' })
  .validator((input: SaveInput) => {
    if (!input?.id || typeof input.updatedAt !== 'number' || input.content?.type !== 'doc') {
      throw new Error('Invalid save payload')
    }
    return { id: input.id, title: String(input.title ?? ''), content: input.content, updatedAt: input.updatedAt }
  })
  .handler(async ({ data }): Promise<{ updatedAt: number; applied: boolean }> => {
    const result = await env.DB.prepare(
      `UPDATE documents SET title = ?, content = ?, updated_at = ?
       WHERE id = ? AND updated_at <= ?`,
    )
      .bind(data.title, JSON.stringify(data.content), data.updatedAt, data.id, data.updatedAt)
      .run()
    if (result.meta.changes > 0) return { updatedAt: data.updatedAt, applied: true }
    const row = await env.DB.prepare('SELECT updated_at FROM documents WHERE id = ?')
      .bind(data.id)
      .first<{ updated_at: number }>()
    if (!row) throw new Error('Document not found')
    return { updatedAt: row.updated_at, applied: false }
  })
