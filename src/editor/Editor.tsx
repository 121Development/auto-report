import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import type { DocumentRecord } from '../lib/types'
import { baseExtensions } from './extensions'
import { Gutter } from './gutter'
import { getLocal } from './local-store'
import { listSections, reconcileSectionIds } from './sections'
import { useAutosave, type SaveStatus } from './use-autosave'

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: 'Saved',
  unsaved: 'Editing…',
  saving: 'Saving…',
  offline: 'Offline, saved locally',
}

export function Editor({ doc }: { doc: DocumentRecord }) {
  const [title, setTitle] = useState(doc.title)
  const [raw, setRaw] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [actionTarget, setActionTarget] = useState<string[] | null>(null)
  const { status, schedule } = useAutosave()
  const titleRef = useRef(title)
  titleRef.current = title

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...baseExtensions,
      Gutter.configure({ onAction: setActionTarget, onSelectionChange: setSelected }),
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
      editor.commands.setContent(local.content, { emitUpdate: false })
      setTitle(local.title)
      schedule({ id: doc.id, title: local.title, content: local.content, updatedAt: local.updatedAt })
    })
    return () => {
      cancelled = true
    }
  }, [editor, doc.id, doc.updatedAt, schedule])

  function changeTitle(next: string) {
    setTitle(next)
    if (editor) schedule({ id: doc.id, title: next, content: editor.getJSON(), updatedAt: Date.now() })
  }

  function toggleRaw() {
    if (!editor) return
    if (raw === null) {
      setRaw(editor.getMarkdown())
      return
    }
    const previous = editor.getJSON()
    const parsed: JSONContent | undefined = editor.markdown?.parse(raw)
    if (parsed) editor.commands.setContent(reconcileSectionIds(previous, parsed))
    setRaw(null)
  }

  const numbers = editor
    ? listSections(editor.state.doc)
        .filter((s) => (actionTarget ?? []).includes(s.id))
        .map((s) => s.number)
    : []

  return (
    <div className="editor-shell">
      <header className="topbar">
        <a href="/" className="back" aria-label="All documents">
          ←
        </a>
        <input
          className="title"
          value={title}
          placeholder="Untitled"
          onChange={(e) => changeTitle(e.target.value)}
        />
        <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>
        <button type="button" className="toggle" onClick={toggleRaw} aria-pressed={raw !== null}>
          {raw === null ? 'Markdown' : 'Preview'}
        </button>
      </header>

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

      {actionTarget && (
        <div className="action-popover" role="dialog" aria-label="AI actions">
          <p>
            Section{numbers.length === 1 ? '' : 's'} {numbers.join(', ')}
          </p>
          <p className="muted">AI actions arrive in milestone 2.</p>
          <button type="button" onClick={() => setActionTarget(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  )
}
