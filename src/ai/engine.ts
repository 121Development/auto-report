import type { DecisionModel } from './decision'
import { selectModel, type Generator } from './generate'
import { parseSectionRefs } from './section-refs'
import type { ActionRequest, ActionResponse, Decision, SectionEdit, SectionSnapshot } from './types'

/** Below this confidence on the target, ask "Which section?" instead of guessing. */
export const SCOPE_CONFIDENCE_THRESHOLD = 0.6

const EXCERPT = 80

export interface EngineDeps {
  decider: DecisionModel
  /** Used when the primary decider fails (network, quota). */
  fallbackDecider?: DecisionModel
  generator: Generator
}

type Targets = { ok: true; ids: string[] } | { ok: false; reason: 'ask' } | { ok: false; reason: 'error'; message: string }

function resolveNumbers(sections: SectionSnapshot[], numbers: number[]): Targets {
  const missing = numbers.filter((n) => n > sections.length)
  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'error',
      message: `There is no section ${missing.join(', ')}. The document has ${sections.length}.`,
    }
  }
  return { ok: true, ids: numbers.map((n) => sections[n - 1].id) }
}

/** Pick the target sections. Named numbers win; then the entry point; then the decision model's scope. */
export function resolveTargets(request: ActionRequest, named: number[], decision: Decision): Targets {
  const { sections } = request
  if (named.length > 0) return resolveNumbers(sections, named)

  switch (request.entry) {
    case 'section':
    case 'multi': {
      const alive = new Set(sections.map((s) => s.id))
      const ids = request.selection.filter((id) => alive.has(id))
      return ids.length > 0 ? { ok: true, ids } : { ok: false, reason: 'ask' }
    }
    case 'document':
      return { ok: true, ids: sections.map((s) => s.id) }
    case 'inline': {
      if ((decision.scopeConfidence ?? 0) < SCOPE_CONFIDENCE_THRESHOLD) return { ok: false, reason: 'ask' }
      if (decision.scope === 'document') return { ok: true, ids: sections.map((s) => s.id) }
      if (decision.scope === 'previous' && request.previousSectionId) {
        return { ok: true, ids: [request.previousSectionId] }
      }
      return { ok: false, reason: 'ask' }
    }
  }
}

/** Keep only edits that replace target sections, each section at most once. */
export function sanitizeEdits(edits: SectionEdit[], targets: string[], allowMulti: boolean): SectionEdit[] {
  const allowed = new Set(targets)
  const used = new Set<string>()
  const clean: SectionEdit[] = []
  for (const edit of edits) {
    const replaces = [...new Set(edit.replaces)].filter((id) => allowed.has(id) && !used.has(id))
    if (replaces.length === 0 || (!allowMulti && replaces.length > 1)) continue
    replaces.forEach((id) => used.add(id))
    clean.push({ replaces, markdown: edit.markdown })
  }
  return clean
}

export async function runAction(request: ActionRequest, deps: EngineDeps): Promise<ActionResponse> {
  const instruction = request.instruction.trim()
  if (!instruction) return { kind: 'error', message: 'Write an instruction first.' }
  if (request.sections.length === 0) return { kind: 'error', message: 'The document is empty.' }

  // Section numbers are parsed deterministically, before the decision call.
  const named = parseSectionRefs(instruction)
  const input = {
    entry: request.entry,
    instruction,
    language: request.language,
    namedSections: named,
    targetCount: named.length || request.selection.length || 1,
    outline: request.sections.map((s) => ({
      number: s.number,
      type: s.type,
      excerpt: s.markdown.slice(0, EXCERPT),
    })),
  }

  let decision: Decision
  try {
    decision = await deps.decider.decide(input)
  } catch (error) {
    if (!deps.fallbackDecider) throw error
    console.warn('Decision model failed, using fallback', error)
    decision = await deps.fallbackDecider.decide(input)
  }

  const targets = resolveTargets(request, named, decision)
  if (!targets.ok) {
    if (targets.reason === 'ask') return { kind: 'needs-target', question: 'Which section?', decision }
    return { kind: 'error', message: targets.message }
  }

  const model = selectModel(request.model, decision.modelSize)
  const output = await deps.generator.generate({
    action: decision.action,
    instruction,
    language: request.language,
    model,
    sections: request.sections,
    targets: targets.ids,
  })

  const allowed = new Set(targets.ids)
  return {
    kind: 'result',
    decision,
    model,
    targets: targets.ids,
    edits: sanitizeEdits(output.edits ?? [], targets.ids, decision.action === 'merge'),
    comments: (output.comments ?? []).filter((c) => allowed.has(c.sectionId)),
    note: output.note ?? '',
  }
}
