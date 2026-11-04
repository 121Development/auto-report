# Auto Report — Spec v0.2

Oct 20, 2026 · @Erik

## Overview

A personal, Markdown-native writing app in which every block of text is a numbered section that AI can rewrite, expand, merge or check. The AI is reached through three entry points: an inline `//` prompt, a per-section chat or voice box, and a document-wide prompt. The design is clean and minimal, with AI controls in the gutter and margin rather than a permanent sidebar.

- **User:** Erik only for the MVP. No collaboration, accounts or multi-tenancy.
- **Content:** reports, articles and posts, in Swedish and English.
- **MVP goal:** a working editor with numbered sections, the AI entry points, templates and a template creator, context upload, track changes, versioning, autosave, images and export to Word, PDF and Markdown.
- **Deferred:** confidentiality controls, linked context folders and multi-user support (see Out of scope).

## Core model

The document is plain Markdown split into sections. Each section shows a number in the left gutter, and the numbers renumber live as the document changes. Behind the visible number, every section carries a hidden stable ID, so AI edits, track changes and version diffs never land on the wrong block when numbers shift.

**What counts as a section**

- A paragraph ended by a carriage return.
- A heading, which is always its own section.
- A whole list is one section. Tables, code blocks and images follow the same rule: one block, one section.

**Heading groups**

- Clicking a heading's number selects the heading alone.
- A second control (or a second click) selects the heading plus every section up to the next heading.
- "Next heading" means the next heading of any level, so an H2 group stops at its first H3.

**Numbering**

- Flat numbering (1, 2, 3).
- Dynamic: deleting section 2 makes section 3 the new section 2.
- A `//` prompt that names a section ("section 4") is resolved to that section's stable ID when the prompt fires, not later.

**Gutter**

- Left gutter shows the section number.
- On hover or selection, an action icon appears beside the number and opens the section's chat or voice box.

## Features

All AI work goes through one action engine with four entry points. AI changes to existing text arrive as tracked suggestions that you accept or reject.

| Entry point | Trigger | Scope | Example |
| --- | --- | --- | --- |
| Inline prompt | Line starting with `//`, fired by carriage return | Resolved from the prompt: previous section, a named section, a range | `// make previous section shorter` |
| Section action | Icon beside the section number, then chat or voice | One section or heading group | "Expand the NIS2 section to double the length" |
| Multi-section action | Select several sections, then the same icon | The selected sections | Merge into one; summarize and replace; check terminology |
| Document prompt | Main prompt box (top bar or shortcut) | Whole document | "Review the full draft for a board audience" |

### Inline prompts

- Trigger: `//` at the start of a line, then the instruction, then carriage return. Mid-line `//` (as in URLs) never triggers.
- Section numbers in the prompt ("section 4", "sections 2 to 5") are parsed deterministically.
- The decision model answers typed questions about the rest: action type, target scope, and whether attached context is needed.
- If the decision model's confidence on the target is low, the app asks "Which section?" instead of guessing.
- The generative model writes the change, which appears as a tracked suggestion.
- The `//` line is removed once handled and never exported.

### Section and multi-section actions

- Selection: click a number for one section, shift-click for a range, cmd-click for non-adjacent sections.
- Input: a small chat box or voice, opened from the icon beside the number.
- Two modes, for text and voice: one-shot (one instruction, one suggestion), or expanded into a back-and-forth chat to refine the request before committing. The document prompt works the same way.
- Proposed one-click presets: expand, shorten, rewrite, merge, summarize and replace, check consistency.

### Document prompt

- A main prompt that works on the whole document: review, restructure, adjust tone, tighten.
- Results land as tracked suggestions spread across the affected sections.

### Coherence and terminology check

- Runs on a selection or the whole document.
- Output: margin comments, each with a suggested fix.
- Accept or reject per comment, or accept all.

### Templates

- **Document level:** tone, recipient, purpose, language and length guidance.
- **Structure:** section headers and their order.
- **Section level:** optional instructions per section, such as what belongs there, length and must-include items.
- Proposed storage: one Markdown file per template, with frontmatter for document-level settings and comments for section instructions.

```markdown
---
name: Board security update
language: sv
recipient: Executive board
tone: Factual, concise, conclusion first
---
# Summary
<!-- max 150 words; state the conclusion in the first sentence -->
# Threat picture
<!-- 3 to 5 key threats, each with likelihood and impact -->
# Recommendations
```

**Template creator**

- **Guided:** a step-by-step flow through document settings, sections and section instructions.
- **From a prompt:** describe the report; the app asks follow-up questions, then drafts the template.
- **From an example:** upload a finished document; the app extracts structure, tone and section instructions.
- Every created template opens for review and editing before it is saved.

### Context

- Formats: PDF, Word (.docx), Markdown, URLs and pasted text.
- Added per document by drag and drop (files or a folder) or upload, and shown in a context panel.
- Uploaded items are kept in a reusable library and can be attached to new documents.
- Attached context is available to every AI action in the document.

### Generation from template and context

- With a template: one pass fills every section from the attached context.
- Without a template: attached context plus a freeform prompt produces a first draft.
- Handling: the app saves a version snapshot, then writes the draft straight into the document, streaming section by section. Suggestions covering the whole text would only be noise.
- General rule: AI writing into an empty section goes in directly; AI changes to existing text arrive as tracked suggestions.
- Each generated section gets a regenerate control. Rolling back the whole draft is one click to the snapshot.
- You then refine with the document prompt or section actions.

### Track changes, undo and versions

- AI edits arrive as tracked insertions and deletions, accepted or rejected per change or per section.
- Your own edits are tracked too. A toggle shows or hides them inline, so drafting stays clean.
- Undo and redo cover your edits and accepted AI changes alike.
- Versions are named snapshots. You can fork any version and keep working on the fork, and compare two versions side by side.
- Automatic snapshots are taken hourly while editing and before every full generation.

### Language and export

- Swedish and English throughout: spell check, AI output in the document's language, and a language setting per template.
- Export to Markdown, Word (.docx) and PDF.
- Word and PDF use a house template: fonts, logo and cover page.

### Editor

- Rendered Markdown while you type, in the style of Obsidian's live preview. A toggle switches to raw Markdown.
- Autosave: every change is saved continuously. Closing the tab or losing the connection loses nothing.
- Images: paste or drag in. Each image is its own section, stored with the document and included in Word and PDF export.
- Image reading: the AI reads each image and adds a caption and a description automatically.
- Document settings hold the toggles: model choice (Auto by default), automatic image captions, and showing your own tracked changes.

## Architecture and stack

Recommendation: one TanStack Start app on Cloudflare Workers. A decision model classifies each AI request and a generative model writes the text. Jev starts as the decision model, behind an interface that lets Clef replace it by changing the model and endpoint.

&#91;embedded content: AI request flow · two models, one fallback\]

All four entry points send the same request. If Jev is unsure of the target, the app asks before Claude writes anything.

| Layer | Choice | Why |
| --- | --- | --- |
| App | TanStack Start on Cloudflare Workers, TypeScript, pnpm | Your preferred stack; UI and server functions in one deploy |
| Editor | TipTap (ProseMirror) | Gutter numbers and icons as decorations; suggestion marks for track changes; Markdown import and export |
| Decision model | Jev via the TypeSafe System One API, using `@tanstack/ai-typesafe` | Typed answers with calibrated probabilities, not generated text |
| Decision model, later | Clef or Clef-flash on Workers AI | Jev-compatible API, so the swap is a config change |
| Generative model | Claude via the Anthropic API, routed through Cloudflare AI Gateway | Writing quality in Swedish and English; gateway adds logs, caching and cost tracking |
| Model selection | Jev picks Haiku (fast) or Sonnet (strong) per request; a document setting can override this, including Opus for full drafts | Small edits stay quick and cheap; full drafts get the stronger model |
| Documents and versions | D1 | Documents, section IDs, version snapshots and forks |
| Autosave | Debounced saves to D1, plus a local copy in the browser (IndexedDB) | Survives a closed tab or dropped connection; syncs on reopen |
| Context files and images | R2 for originals; extracted context text in D1 | Text is extracted once on upload and reused by every action |
| URL context | Browser Rendering, page to Markdown | Handles pages that need JavaScript |
| Export | Markdown direct; .docx via the `docx` library; PDF via Browser Rendering from styled HTML | All three run inside Workers |
| Access | Cloudflare Access | Single-user login with no auth code |

**Design decisions**

- **Canonical format:** store the editor's JSON in D1, not raw Markdown. Section IDs and pending suggestions have no place in plain Markdown. Markdown is what you write and what you export.
- **Context strategy:** for the MVP, send all attached context to the generative model in full. Add retrieval (Vectorize) only when the library outgrows the context window.
- **Decision questions per request:** action type (choice), target scope (choice), context needed (yes/no) and model size (fast or strong). Section numbers are parsed before the decision call.
- **Autosave versus versions:** autosave keeps the latest state. Versions are explicit snapshots, plus automatic ones hourly and before each full generation.
- **Latency:** Cloudflare reports a median of 524 ms for Jev, 209 ms for Clef and 39 ms for Clef-flash. These are vendor figures. Measure on your own prompts before switching.

Sources: [Jev overview](https://github.com/kraayenjon/awesome-jev/wiki) · [TanStack TypeSafe adapter](https://tanstack.com/ai/latest/docs/adapters/typesafe.md) · [Clef release coverage](https://letsdatascience.com/news/cloudflare-releases-open-weight-clef-decision-models-c52886d6)

## Dependency security

pnpm is configured against the common npm supply-chain attacks. New package versions wait seven days before they can be installed. Dependency install scripts run only when explicitly allowed. A version whose publishing trust has dropped is refused. The same rules apply to every package a coding agent adds.

**pnpm version:** pin pnpm 12 in the `packageManager` field. It reads the same settings as pnpm 11. Unlike pnpm 11, it fails on an unrecognized setting when the project pins a matching version, so a misspelled security key cannot be silently ignored. npm's `latest` tag still points at pnpm 11; install pnpm 12 with `pnpm self-update latest-12`.

```yaml
# pnpm-workspace.yaml: supply-chain hardening
minimumReleaseAge: 10080        # 7 days before a newly published version can be installed
minimumReleaseAgeExclude: []    # exact patched versions, for urgent security fixes only
trustPolicy: no-downgrade       # refuse a version whose publishing trust dropped
trustPolicyIgnoreAfter: 525600  # skip the trust check for versions older than 1 year
blockExoticSubdeps: true        # transitive deps only from the registry, never git or tarball URLs
strictDepBuilds: true           # fail install on any unreviewed build script
allowBuilds:                    # approve build scripts one package at a time
  esbuild: true
  workerd: true
```

**Rules**

- **Release age:** 7 days instead of pnpm's 1-day default. Compromised versions are usually pulled within hours, and a personal project rarely needs a package on release day.
- **Urgent fixes:** `pnpm audit --fix` adds the patched version to `minimumReleaseAgeExclude`, so a security fix installs without the wait.
- **Build scripts:** `allowBuilds` lists only what `pnpm install` reports as needing a build; esbuild and workerd are the expected ones for this stack. `dangerouslyAllowAllBuilds` stays off.
- **Trust policy:** the one-year cutoff avoids false alarms from older versions published before signing and provenance existed.
- **Lockfile:** `pnpm-lock.yaml` is committed; deploys run `pnpm install --frozen-lockfile`.
- **Audit:** `pnpm audit` runs in the deploy script and blocks a deploy on high-severity advisories.
- **Coding agents:** `AGENTS.md` tells agents never to change these settings or add `allowBuilds` entries without asking.

Sources: [pnpm supply-chain guide](https://pnpm.io/supply-chain-security) · [pnpm build settings](https://pnpm.io/settings/build) · [pnpm 12.0 release](https://pnpm.io/blog/releases/12.0)

## Out of scope for v1

- Linked context folder that the app watches and syncs (planned for v2).
- Confidentiality controls: EU-only hosting, local models, retention rules.
- Multi-user, sharing and collaboration.
- Switching from Jev to Clef, until measured on real prompts.
- Retrieval and vector search over the context library.

## Open questions

None right now. All questions from the last two rounds are resolved and folded into the sections above.
