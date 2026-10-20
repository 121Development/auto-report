# AGENTS.md

Section Editor: a personal, Markdown-native writing app where every block is a numbered section that AI can act on. Spec: [docs/spec-v0.2.md](docs/spec-v0.2.md). Roadmap: [PLAN.md](PLAN.md).

## Stack
- TanStack Start (React, TypeScript) on Cloudflare Workers, pnpm 12
- TipTap (ProseMirror) editor
- D1 for documents and versions, R2 for files and images
- Claude via Cloudflare AI Gateway (generative); Jev via `@tanstack/ai-typesafe` (decision)

## Commands
- `pnpm dev`: local dev server (local D1/R2 via Miniflare)
- `pnpm db:migrate:local`: apply D1 migrations locally
- `pnpm test`: unit tests (Vitest)
- `pnpm typecheck`
- `pnpm run deploy`: frozen-lockfile install, audit gate, `wrangler deploy`

## First deploy
1. `wrangler login`
2. `wrangler d1 create section-editor` and put the id in `wrangler.jsonc`; `wrangler r2 bucket create section-editor-files`
3. `pnpm db:migrate:remote`, then `pnpm run deploy`

## Invariants
- Editor JSON is the canonical stored format. Markdown is for import and export only.
- Every top-level block is one section and carries a unique `sectionId` attribute. Never address a section by its visible number in stored data or AI edits; resolve numbers to IDs at the moment a prompt fires.
- AI writes into empty sections directly; AI changes to existing text are tracked suggestions.

## Dependency security (do not change without asking)
- Never modify the supply-chain settings in `pnpm-workspace.yaml` (`minimumReleaseAge`, `trustPolicy`, `blockExoticSubdeps`, `strictDepBuilds`, …).
- Never add `allowBuilds` entries, and never enable `dangerouslyAllowAllBuilds`. If an install reports a new build script, stop and ask.
- Keep `pnpm-lock.yaml` committed. Don't bypass the release-age wait except through `pnpm audit --fix` for a security fix.
