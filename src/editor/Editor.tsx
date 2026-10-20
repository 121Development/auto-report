import type { JSONContent } from '@tiptap/core'
import { useServerFn } from '@tanstack/react-start'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import type { DocumentRecord, DocumentSettings } from '../lib/types'
import { updateSettings } from '../server/documents'
import { ActionBox, type ActionRequestDraft } from './ActionBox'
import { baseExtensions } from './extensions'
import { Gutter } from './gutter'
import { InlinePrompt } from './inline-prompt'
import { getLocal } from './local-store'
import { resolveView } from './resolve-view'
import { ChangeBubble, SuggestionBar } from './Review'
import { reconcileSectionIds } from './sections'
import { setContentDirect, suggestionIds } from './track-changes'
import { useAutosave, type SaveStatus } from './use-autosave'

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: 'Saved',
  unsaved: 'Editing…',
  saving: 'Saving…',
  offline: 'Offline, saved locally',
}

export function Editor({ doc }: { doc: DocumentRecord }) {
  const [title, setTitle] = useState(doc.title)
  const [settings, setSettings] = useState<DocumentSettings>(doc.settings)
  const [raw, setRaw] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [draft, setDraft] = useState<ActionRequestDraft | null>(null)
  const { status, schedule } = useAutosave()
  const saveSettings = useServerFn(updateSettings)
  const titleRef = useRef(title)
  titleRef.current = title
  const live = { ...doc, settings }

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...baseExtensions,
      Gutter.configure({
        onAction: (ids) => setDraft({ entry: ids.length > 1 ? 'multi' : 'section', targets: ids }),
        onSelectionChange: setSelected,
      }),
      InlinePrompt.configure({
        onPrompt: ({ instruction, previousSectionId }) =>
          setDraft({ entry: 'inline', targets: [], instruction, previousSectionId }),
      }),
    ],
    content: doc.content,
    editorProps: { attributes: { class: 'doc', spellcheck: 'true', lang: doc.language } },
    onUpdate: ({ editor }) =>
      schedule({ id: doc.id, title: titleRef.current, content: editor.getJSON(), updatedAt: Date.now() }),
  })

  // A local copy newer than the server's (tab closed or offline before it synced) wins.
  useEffect(() => {
    if (!editor) return
    let cancelled = false
    void getLocal(doc.id).then((local) => {
      if (cancelled || !local?.dirty || local.updatedAt <= doc.updatedAt) return
      setContentDirect(editor, local.content)
      setTitle(local.title)
      schedule({ id: doc.id, title: local.title, content: local.content, updatedAt: local.updatedAt })
    })
    return () => {
      cancelled = true
    }
  }, [editor, doc.id, doc.updatedAt, schedule])

  // Your own tracked changes: shown inline, or hidden so drafting stays clean.
  useEffect(() => {
    editor?.view.dom.classList.toggle('hide-own', !settings.showOwnChanges)
  }, [editor, settings.showOwnChanges])

  // Document prompt: ⌘J / Ctrl+J.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setDraft({ entry: 'document', targets: [] })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function changeTitle(next: string) {
    setTitle(next)
    if (editor) schedule({ id: doc.id, title: next, content: editor.getJSON(), updatedAt: Date.now() })
  }

  function toggleOwnChanges() {
    const next = { ...settings, showOwnChanges: !settings.showOwnChanges }
    setSettings(next)
    void saveSettings({ data: { id: doc.id, settings: { showOwnChanges: next.showOwnChanges } } })
  }

  function toggleRaw() {
    if (!editor) return
    if (raw === null) {
      if (suggestionIds(editor.state.doc, (s) => s.author === 'ai').length > 0) {
        setNotice('Accept or reject the AI suggestions before switching to Markdown.')
        return
      }
      // Raw Markdown can't hold tracked changes: your own edits are kept as plain text.
      setNotice(null)
      setRaw(editor.markdown!.serialize(resolveView(editor.getJSON())))
      return
    }
    const previous = resolveView(editor.getJSON())
    const parsed: JSONContent | undefined = editor.markdown?.parse(raw)
    if (parsed) setContentDirect(editor, reconcileSectionIds(previous, parsed))
    setRaw(null)
  }

  return (
    <div className="editor-shell">
      <header className="topbar">
        <a href="/" className="back" aria-label="All documents">
          ←
        </a>
        <input className="title" value={title} placeholder="Untitled" onChange={(e) => changeTitle(e.target.value)} />
        <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>
        <button
          type="button"
          className="toggle ask"
          onClick={() => setDraft({ entry: 'document', targets: [] })}
          title="Prompt the whole document (⌘J)"
        >
          ✦ Ask
        </button>
        <button
          type="button"
          className="toggle"
          onClick={toggleRaw}
          aria-pressed={raw !== null}
          title="Raw Markdown. Your own tracked edits are kept as plain text."
        >
          {raw === null ? 'Markdown' : 'Preview'}
        </button>
      </header>

      {editor && raw === null && (
        <SuggestionBar editor={editor} showOwn={settings.showOwnChanges} onToggleOwn={toggleOwnChanges} />
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button type="button" className="icon" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {selected.length > 0 && (
        <div className="selection-bar">
          {selected.length} section{selected.length === 1 ? '' : 's'} selected
        </div>
      )}

      <main className="page">
        {raw === null ? (
          <EditorContent editor={editor} />
        ) : (
          <textarea className="raw" value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck />
        )}
      </main>

      {editor && raw === null && <ChangeBubble editor={editor} />}
      {draft && editor && <ActionBox key={JSON.stringify(draft)} editor={editor} doc={live} draft={draft} onClose={() => setDraft(null)} />}
    </div>
  )
}
