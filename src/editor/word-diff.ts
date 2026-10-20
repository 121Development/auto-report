/**
 * Word-level diff, so an AI rewrite of a paragraph shows as small tracked changes
 * instead of the whole paragraph struck through and retyped.
 */

export interface DiffOp {
  /** Range in the old text, [from, to). Empty for a pure insertion. */
  from: number
  to: number
  /** Range in the new text, [newFrom, newTo). Empty for a pure deletion. */
  newFrom: number
  newTo: number
}

/** Words, runs of whitespace and punctuation are separate tokens. */
export function tokenize(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}_]/gu) ?? []
}

/** Above this many token pairs, the caller should fall back to a block replacement. */
export const MAX_DIFF_CELLS = 400_000

/** Changed ranges between `a` and `b`, or null when the texts are too long to diff. */
export function diffWords(a: string, b: string): DiffOp[] | null {
  const ta = tokenize(a)
  const tb = tokenize(b)
  const n = ta.length
  const m = tb.length
  if (n * m > MAX_DIFF_CELLS) return null

  // LCS table, filled from the end.
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = ta[i] === tb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  let posA = 0
  let posB = 0
  let open: DiffOp | null = null
  const flush = () => {
    if (open && (open.to > open.from || open.newTo > open.newFrom)) ops.push(open)
    open = null
  }
  while (i < n || j < m) {
    if (i < n && j < m && ta[i] === tb[j]) {
      flush()
      posA += ta[i++].length
      posB += tb[j++].length
      continue
    }
    open ??= { from: posA, to: posA, newFrom: posB, newTo: posB }
    if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      posB += tb[j++].length
      open.newTo = posB
    } else {
      posA += ta[i++].length
      open.to = posA
    }
  }
  flush()
  return ops
}
