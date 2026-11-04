# Auto Report

A Markdown-native writing app where every block of text is a numbered section
that AI can rewrite, expand, merge or check, with AI changes arriving as
tracked suggestions you accept or reject.

**Status:** WIP. Milestones 1–3.5 of [PLAN.md](PLAN.md) are done (editor, AI
engine, entry points, track changes, design pass). Context upload, templates,
versions and export are next.

![Auto Report: a document with numbered sections and an AI action icon in the gutter](docs/images/screenshot.png)

## What it does

- **Numbered sections.** Every paragraph, heading, list or table is one section
  with a number in the gutter. Numbers update as you write; behind each one is
  a stable ID, so AI edits never land on the wrong block.
- **Four ways to ask the AI:**
  - Type `// make the previous section shorter` on a new line and press Enter.
  - Click the ✦ beside a section to type or dictate an instruction.
  - Select several sections (shift-click, ⌘-click) to merge, summarize or check them.
  - Press ⌘J to ask about the whole document.
- **Track changes.** AI edits to existing text show up as word-level
  suggestions you accept or reject per change, per section or all at once.
  Your own edits can be tracked too.
- **Markdown in and out.** Toggle to raw Markdown at any time. Documents
  autosave to D1, with an IndexedDB copy for offline.

The full design is in [docs/spec-v0.2.md](docs/spec-v0.2.md).

## Tech stack

- [TanStack Start](https://tanstack.com/start) (React, TypeScript) on Cloudflare Workers
- [TipTap](https://tiptap.dev) / ProseMirror for the editor, with
  [`@handlewithcare/prosemirror-suggest-changes`](https://www.npmjs.com/package/@handlewithcare/prosemirror-suggest-changes)
  for track changes
- Cloudflare D1 (documents, versions) and R2 (files)
- Two models per request:
  - Jev (via `@tanstack/ai-typesafe`) decides what kind of action this is and
    which sections it targets.
  - Claude (via Cloudflare AI Gateway) writes the change. Haiku handles quick
    edits and Sonnet the bigger ones; a document can pin Opus.

## How to run

You need Node, pnpm 12 and a Cloudflare account for deploys.

```bash
pnpm install
cp .dev.vars.example .dev.vars   # add ANTHROPIC_API_KEY; TYPESAFE_API_KEY is optional
pnpm db:migrate:local
pnpm dev
```

Then open the URL Vite prints, create a document and type `//` on a new line.
Without `TYPESAFE_API_KEY`, a keyword heuristic stands in for the decision
model. To use your own Cloudflare account, change `CF_ACCOUNT_ID` and
`AI_GATEWAY_ID` in [wrangler.jsonc](wrangler.jsonc).

```bash
pnpm test        # unit tests (Vitest)
pnpm typecheck
```

For a first deploy (D1 database, R2 bucket, AI Gateway, secrets), see
[AGENTS.md](AGENTS.md#first-deploy).

## What I learned

- **Never store what the user sees.** Section numbers are for people. Prompts
  resolve "section 4" to a stable ID at the moment they fire, and everything
  stored or sent to the AI uses IDs.
- **Split deciding from writing.** A small, typed decision model ("which
  sections, what kind of edit, how big a model") is cheaper and more
  predictable than asking one LLM to interpret and rewrite at the same time.
  Low confidence on the target makes the app ask "Which section?" instead of
  guessing.
- **Tracking your own typing is subtle.** TipTap input rules compare the
  document right after a keystroke, so marking typed text as an edit has to
  wait a microtask or Markdown shortcuts break.
- **Clean up before anything leaves the editor.** Suggestion marks and the
  zero-width spaces the track-changes library inserts must be resolved before
  Markdown export or before sending the AI a snapshot.
- **Patch upstream bugs small.** [`patches/`](patches) holds a one-line fix for
  a crash when accepting a deletion of the last block in the document.
