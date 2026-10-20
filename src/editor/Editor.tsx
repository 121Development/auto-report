import type { JSONContent } from '@tiptap/core'
import { useServerFn } from '@tanstack/react-start'
import { EditorContent, useEditor } from '@tiptap/react'
import { ChevronLeft, Code, FileText, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DocumentRecord, DocumentSettings } from '../lib/types'
import { IconButton } from '../lib/ui'
import { updateSettings } from '../server/documents'
import { ActionBox, type ActionRequestDraft } from './ActionBox'
import { baseExtensions } from './extensions'
import { Gutter, selectSections } from './gutter'
import { InlinePrompt } from './inline-prompt'
import { getLocal } from './local-store'
import { resolveView } from './resolve-view'
import { ChangeBubble, ReviewControls } from './Review'
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
  const [draft, setDraftState] = useState<ActionRequestDraft | null>(null)
  const { status, schedule } = useAutosave()
  const saveSettings = useServerFn(updateSettings)
  const titleRef = useRef(title)
  titleRef.current = title
  const live = { ...doc, settings }

  const editorRef = useRef<ReturnType<typeof useEditor>>(null)
  /** Open (or close) the action box; its target sections show as selected while it is open. */
  const setDraft = (next: ActionRequestDraft | null) => {
    setDraftState(next)
    const view = editorRef.current?.view
    if (view && next && next.targets.length > 0) selectSections(view, { selected: next.targets, anchor: next.targets[0] })
  }

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

  editorRef.current = editor

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
    <div className={`editor-shell${draft ? ' panel-open' : ''}`}>
      <header className="topbar">
        <a href="/" className="icon-btn back" aria-label="All documents">
          <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
        </a>
        <input className="title" value={title} placeholder="Untitled" aria-label="Title" onChange={(e) => changeTitle(e.target.value)} />
        <span className={`status status-${status}`} title={STATUS_LABEL[status]}>
          <span className="dot" aria-hidden />
          <span className="label">{STATUS_LABEL[status]}</span>
        </span>
        <div className="toolbar">
          {editor && raw === null && (
            <ReviewControls editor={editor} showOwn={settings.showOwnChanges} onToggleOwn={toggleOwnChanges} />
          )}
          <span className="divider" aria-hidden />
          <IconButton
            icon={raw === null ? Code : FileText}
            label={raw === null ? 'Edit as Markdown' : 'Back to the editor'}
            pressed={raw !== null}
            onClick={toggleRaw}
          />
          <IconButton
            icon={Sparkles}
            label="Ask about the whole document"
            shortcut="⌘J"
            tone="accent"
            text="Ask"
            onClick={() => setDraft({ entry: 'document', targets: [] })}
          />
        </div>
      </header>

      {selected.length > 0 && !draft && (
        <div className="selection-chip" role="status">
          <span>
            {selected.length} section{selected.length === 1 ? '' : 's'} selected
          </span>
          <IconButton
            icon={Sparkles}
            label="AI actions for the selection"
            tone="accent"
            size={14}
            onClick={() => setDraft({ entry: selected.length > 1 ? 'multi' : 'section', targets: selected })}
          />
        </div>
      )}

      <main className="page">
        {raw === null ? (
          <EditorContent editor={editor} />
        ) : (
          <textarea className="raw" value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck aria-label="Markdown source" />
        )}
      </main>

      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <IconButton icon={X} label="Dismiss" size={14} onClick={() => setNotice(null)} />
        </div>
      )}
      {editor && raw === null && !draft && <ChangeBubble editor={editor} />}
      {draft && editor && (
        <ActionBox key={JSON.stringify(draft)} editor={editor} doc={live} draft={draft} onClose={() => setDraft(null)} />
      )}
    </div>
  )
}
