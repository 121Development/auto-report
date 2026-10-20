# Section Editor — MVP plan

Source of truth: [docs/spec-v0.2.md](docs/spec-v0.2.md). Each milestone is shippable and testable on its own.

## M1 Foundation
- [ ] TanStack Start (React, TS) on Cloudflare Workers, pnpm 12 with supply-chain hardening
- [ ] `wrangler.jsonc` with D1 (`DB`) and R2 (`FILES`) bindings; deploy script with frozen lockfile + audit gate
- [ ] D1 schema: `documents`, `versions` (editor JSON is canonical)
- [ ] TipTap editor: every top-level block is a section with a hidden stable ID
- [ ] Gutter: live flat numbering, hover/selected action icon (stub)
- [ ] Selection: click number = section; second click on a heading = heading group (to next heading of any level)
- [ ] Markdown import/export; live-preview / raw Markdown toggle
- [ ] Autosave: debounced to D1 + IndexedDB mirror; newer copy wins on reopen
- [ ] Routes: `/` document list, `/doc/$id` editor

## M2 AI action engine
- [ ] One `ActionRequest` type shared by all entry points
- [ ] Deterministic section-reference parser ("section 4", "sections 2 to 5"), resolved to stable IDs at fire time
- [ ] `DecisionModel` interface; Jev adapter via `@tanstack/ai-typesafe` (action type, target scope, context needed, model size); Clef swap = config change
- [ ] Low target confidence → "Which section?" prompt
- [ ] Claude via Cloudflare AI Gateway; Haiku / Sonnet auto-pick, document-level override incl. Opus

## M3 Entry points + track changes
- [ ] `//` inline prompt (line start only, fired by Enter, line removed after, never exported)
- [ ] Section chat/voice box from gutter icon; one-shot and chat modes
- [ ] Multi-select: click, shift-click range, cmd-click non-adjacent
- [ ] Document prompt (top bar + shortcut)
- [ ] Presets: expand, shorten, rewrite, merge, summarize & replace, check consistency
- [ ] Suggestion marks: accept/reject per change or per section; own-edit tracking with show/hide toggle
- [ ] Undo/redo across own edits and accepted AI changes

## M4 Context + generation
- [ ] Upload PDF, .docx, Markdown, pasted text; URLs via Browser Rendering → Markdown
- [ ] Originals in R2, extracted text in D1; reusable library; per-document context panel (drag & drop files/folder)
- [ ] All attached context sent in full to the generative model
- [ ] Generation from template (fill every section) or freeform prompt; snapshot first, stream section by section
- [ ] Per-section regenerate; one-click rollback to the snapshot

## M5 Templates
- [ ] Markdown template format: frontmatter (name, language, recipient, tone, …) + `<!-- -->` section instructions
- [ ] Creators: guided, from a prompt (with follow-up questions), from an example document
- [ ] Review/edit before save

## M6 Versions + coherence check
- [ ] Named snapshots; automatic hourly and before every full generation
- [ ] Fork any version; side-by-side compare
- [ ] Coherence/terminology check on selection or document → margin comments with fixes; accept/reject/accept all

## M7 Images, language, export, access
- [ ] Images pasted/dragged in as their own section, stored in R2; AI caption + description (toggle)
- [ ] Swedish/English spell check; AI output in the document's language
- [ ] Export: Markdown; .docx via `docx`; PDF via Browser Rendering; house template (fonts, logo, cover)
- [ ] Cloudflare Access in front of the app

## Out of scope for v1
Linked context folders, confidentiality controls, multi-user, Jev→Clef switch, retrieval/vector search.
