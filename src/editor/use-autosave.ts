import type { JSONContent } from '@tiptap/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { saveDocument } from '../server/documents'
import { putLocal } from './local-store'

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'offline'

interface Snapshot {
  id: string
  title: string
  content: JSONContent
  updatedAt: number
}

const SERVER_DEBOUNCE_MS = 1000
const RETRY_MS = 10_000

/**
 * Every change goes to IndexedDB at once and to D1 after a short debounce.
 * Failed saves stay marked dirty locally and retry on reconnect, on tab hide and on a timer.
 */
export function useAutosave() {
  const [status, setStatus] = useState<SaveStatus>('saved')
  const pending = useRef<Snapshot | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const snap = pending.current
    if (!snap || inFlight.current) return
    inFlight.current = true
    setStatus('saving')
    try {
      await saveDocument({ data: snap })
      if (pending.current === snap) {
        pending.current = null
        await putLocal({ ...snap, dirty: false })
        setStatus('saved')
      }
    } catch {
      setStatus('offline')
      timer.current = setTimeout(() => void flush(), RETRY_MS)
    } finally {
      inFlight.current = false
    }
    // A change arrived while saving: save it too.
    if (pending.current && pending.current !== snap && !timer.current) void flush()
  }, [])

  const schedule = useCallback(
    (snap: Snapshot) => {
      pending.current = snap
      void putLocal({ ...snap, dirty: true })
      setStatus((s) => (s === 'offline' ? s : 'unsaved'))
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), SERVER_DEBOUNCE_MS)
    },
    [flush],
  )

  useEffect(() => {
    const onOnline = () => void flush()
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onHide)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [flush])

  return { status, schedule, flush }
}
