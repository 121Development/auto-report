import type { JSONContent } from '@tiptap/core'

/**
 * Browser-side copy of each document in IndexedDB, written on every change, so a
 * closed tab or dropped connection loses nothing. `dirty` means the server hasn't
 * confirmed this version yet.
 */
export interface LocalCopy {
  id: string
  title: string
  content: JSONContent
  updatedAt: number
  dirty: boolean
}

const DB_NAME = 'auto-report'
const STORE = 'documents'

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export async function getLocal(id: string): Promise<LocalCopy | undefined> {
  try {
    return await run('readonly', (s) => s.get(id))
  } catch {
    return undefined
  }
}

export async function putLocal(copy: LocalCopy): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(copy))
  } catch {
    // Private mode or blocked storage: the server copy still autosaves.
  }
}
