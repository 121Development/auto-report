/**
 * Deterministic section references in a prompt, in English and Swedish:
 * "section 4", "sections 2 to 5", "sections 2-5", "sections 1, 3 and 6",
 * "§4", "avsnitt 3 till 5", "stycke 2 och 4". Parsed before the decision call;
 * the decision model never guesses a number.
 */

const NOUN = String.raw`(?:sections?|sektion(?:er|erna|en)?|avsnitt(?:en|et)?|stycke(?:n|na|t)?|§)`
const NUM = String.raw`\d{1,4}`
const RANGE_SEP = String.raw`\s*(?:-|–|—|to|through|till|t\.o\.m\.)\s*`
const LIST_SEP = String.raw`\s*(?:,|&|\band\b|\boch\b)\s*`
const ITEM = String.raw`${NUM}(?:${RANGE_SEP}${NUM})?`
const REF = new RegExp(String.raw`(?:^|[^\p{L}])${NOUN}\s*(${ITEM}(?:${LIST_SEP}(?:${NOUN}\s*)?${ITEM})*)`, 'giu')
const ITEM_RE = new RegExp(String.raw`(${NUM})(?:${RANGE_SEP}(${NUM}))?`, 'giu')

const MAX_RANGE = 500

export function parseSectionRefs(text: string): number[] {
  const numbers = new Set<number>()
  for (const match of text.matchAll(REF)) {
    for (const item of match[1].matchAll(ITEM_RE)) {
      const a = Number(item[1])
      const b = item[2] === undefined ? a : Number(item[2])
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      if (hi - lo > MAX_RANGE) continue
      for (let n = lo; n <= hi; n++) numbers.add(n)
    }
  }
  return [...numbers].filter((n) => n > 0).sort((x, y) => x - y)
}
