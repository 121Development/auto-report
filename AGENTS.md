# AGENTS.md

Auto Report: a personal, Markdown-native writing app where every block is a numbered section that AI can act on. Spec: [docs/spec-v0.2.md](docs/spec-v0.2.md). Roadmap: [PLAN.md](PLAN.md).

## Stack
- TanStack Start (React, TypeScript) on Cloudflare Workers, pnpm 12
- TipTap (ProseMirror) editor
- UI: Lucide icons (`lucide-react`; plain `lucide` inside ProseMirror widgets), Radix Tooltip, Floating UI for anchored popovers; Inter + Source Serif 4 via Fontsource. Icon-only buttons go through `IconButton` (`src/lib/ui.tsx`) so they always have a label and tooltip.
- D1 for documents and versions, R2 for files and images
- Claude via Cloudflare AI Gateway (generative); Jev via `@tanstack/ai-typesafe` (decision)

## Commands
- `pnpm dev`: local dev server (local D1/R2 via Miniflare)
- `pnpm db:migrate:local`: apply D1 migrations locally
- `pnpm test`: unit tests (Vitest)
- `pnpm typecheck`
- `pnpm run deploy`: frozen-lockfile install, audit gate, `wrangler deploy`

## AI engine (`src/ai/`)
- One `ActionRequest` from every entry point → `runAction` (`engine.ts`): parse section numbers (`section-refs.ts`) → decision model (`decision.ts`) → resolve targets (ask "Which section?" below 0.6 confidence) → Claude (`generate.ts`) → sanitized edits keyed by section ID.
- Decision model: Jev via `@tanstack/ai-typesafe`. Swap to Clef by changing `DECISION_MODEL` / `DECISION_BASE_URL` in `wrangler.jsonc`. Without `TYPESAFE_API_KEY` a keyword heuristic stands in.
- Generative model: Claude through Cloudflare AI Gateway (`CF_ACCOUNT_ID` + `AI_GATEWAY_ID`). Auto = Haiku 5.5 (fast) / Sonnet 5.5 (strong); the document setting can pin Haiku, Sonnet or Opus 5.5.
- Secrets: copy `.dev.vars.example` to `.dev.vars` locally; `wrangler secret put ANTHROPIC_API_KEY` (and `TYPESAFE_API_KEY`) in production.

## Track changes (`src/editor/track-changes.ts`)
- Built on `@handlewithcare/prosemirror-suggest-changes` (insertion/deletion/modification marks). Suggestion IDs carry the author: `ai:N` or `u:N`.
- Transactions say how to handle them with the `TRACK` meta: `'ai'` → AI suggestions; `'direct'` → untracked (loading, filling an empty section, the `//` line); unset → your own edit.
- Your own edits: typed text applies as-is and is marked on the next microtask (TipTap input rules compare the doc right after the keystroke, so the keystroke itself must not change); text deletions become deletion marks; structure and formatting (block types, lists, Enter, joins, bold) apply untracked.
- Before an AI edit, your tracked edits inside the target sections are settled (`settleOwnChanges`), so the AI change tracks against the text as it reads.
- Anything leaving the editor (AI snapshot, raw Markdown, export) goes through `resolveView` first: the serializer ignores suggestion marks and the library inserts zero-width spaces.
- `patches/` holds a one-line fix for the library (`applySuggestion` crashed when the deleted block was the last in the document). Drop it when upstream fixes the `deletionTo <= size` bound in `commands.js`.

## First deploy
1. `wrangler login`
2. `wrangler d1 create auto-report` and put the id in `wrangler.jsonc`; `wrangler r2 bucket create auto-report-files`
3. Create the AI Gateway `auto-report` in the Cloudflare dashboard; set secrets with `wrangler secret put`
4. `pnpm db:migrate:remote`, then `pnpm run deploy`

## Invariants
- Editor JSON is the canonical stored format. Markdown is for import and export only.
- Every top-level block is one section and carries a unique `sectionId` attribute. Never address a section by its visible number in stored data or AI edits; resolve numbers to IDs at the moment a prompt fires.
- AI writes into empty sections directly; AI changes to existing text are tracked suggestions.

## Dependency security (do not change without asking)
- Never modify the supply-chain settings in `pnpm-workspace.yaml` (`minimumReleaseAge`, `trustPolicy`, `blockExoticSubdeps`, `strictDepBuilds`, …).
- Never add `allowBuilds` entries, and never enable `dangerouslyAllowAllBuilds`. If an install reports a new build script, stop and ask.
- Keep `pnpm-lock.yaml` committed. Don't bypass the release-age wait except through `pnpm audit --fix` for a security fix.
