# Section Editor — MVP plan

Source of truth: [docs/spec-v0.2.md](docs/spec-v0.2.md). Each milestone is shippable and testable on its own.

## M1 Foundation
- [x] TanStack Start (React, TS) on Cloudflare Workers, pnpm 12 with supply-chain hardening
- [x] `wrangler.jsonc` with D1 (`DB`) and R2 (`FILES`) bindings; deploy script with frozen lockfile + audit gate
- [x] D1 schema: `documents`, `versions` (editor JSON is canonical)
- [x] TipTap editor: every top-level block is a section with a hidden stable ID
- [x] Gutter: live flat numbering, hover/selected action icon (stub)
- [x] Selection: click number = section; second click on a heading = heading group (to next heading of any level)
- [x] Markdown import/export; live-preview / raw Markdown toggle
- [x] Autosave: debounced to D1 + IndexedDB mirror; newer copy wins on reopen
- [x] Routes: `/` document list, `/doc/$id` editor

## M2 AI action engine
- [x] One `ActionRequest` type shared by all entry points
- [x] Deterministic section-reference parser ("section 4", "sections 2 to 5"), resolved to stable IDs at fire time
- [x] `DecisionModel` interface; Jev adapter via `@tanstack/ai-typesafe` (action type, target scope, context needed, model size); Clef swap = config change
- [x] Low target confidence → "Which section?" prompt
- [x] Claude via Cloudflare AI Gateway; Haiku / Sonnet auto-pick, document-level override incl. Opus

- [x] Interim entry point to exercise the engine: gutter ✦ opens an instruction box; result previews, Apply replaces in one undo step (M3 turns this into tracked suggestions)

## M3 Entry points + track changes
- [x] `//` inline prompt (line start only, fired by Enter, line removed, unnumbered, never sent as text)
- [x] Section chat/voice box from gutter icon; one-shot and chat modes (chat refines the request, then Run); voice via browser speech recognition
- [x] Multi-select: click, shift-click range, cmd-click non-adjacent
- [x] Document prompt (top bar ✦ Ask + ⌘J)
- [x] Presets: expand, shorten, rewrite, merge, summarize & replace, check consistency
- [x] AI edits as tracked suggestions (word-level for a paragraph rewrite, block-level otherwise); empty sections filled directly; accept/reject per change, per section or all; section IDs survive accept
- [x] Own-edit tracking with show/hide toggle (document setting); "Accept mine"
- [x] Undo/redo across own edits and accepted AI changes (suggestion and accept are separate undo steps)

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
