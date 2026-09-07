export const PRODUCT_RESEARCH_QUERY_INTELLIGENCE_V1 =
  "PRODUCT_RESEARCH_QUERY_INTELLIGENCE_V2_2026_09_07" as const

export type ProductResearchQueryIntentV1 =
  | "EXACT_PRODUCT_QUERY"
  | "CORE_FAMILY_QUERY"
  | "SEMANTIC_EXPANSION_QUERY"

export type CommercialComparableClassificationV1 =
  | "EXACT_PRODUCT_COMPARABLE"
  | "CLOSE_VARIANT_COMPARABLE"
  | "CORE_FAMILY_COMPARABLE"
  | "ADJACENT_BUT_NOT_COMPARABLE"
  | "FALSE_POSITIVE"

export type ProductResearchTermEvidenceV1 = Readonly<{
  term: string
  sourceField: string
  sourceAuthority: string
  selectionReason: string
}>

export type ProductResearchEntityV1 = Readonly<{
  productNoun: string | null
  productFamilyCandidate: string | null
  materialQualifiers: readonly string[]
  countOrSetQualifiers: readonly string[]
  sizeOrVariantQualifiers: readonly string[]
  brandSignal: readonly string[]
  featureQualifiers: readonly string[]
  definingFamilyQualifiers: readonly string[]
  evidence: readonly ProductResearchTermEvidenceV1[]
  status: "PROVEN" | "UNPROVEN"
}>

export type ProductResearchMarketplaceTermV1 = Readonly<{
  term: string
  titleFrequency: number
  sellerDiversity: number | null
  relevance: "EXACT" | "FAMILY" | "ADJACENT" | "UNKNOWN"
  evidenceIds: readonly string[]
}>

export type ProductResearchCommercialQueryV1 = Readonly<{
  intent: ProductResearchQueryIntentV1
  query: string
  evidenceBasis: readonly ProductResearchTermEvidenceV1[]
  ordinal: number
}>

const MATERIALS = new Set([
  "aluminum", "aluminium", "bamboo", "brass", "ceramic", "cotton", "fabric",
  "glass", "leather", "metal", "nylon", "plastic", "rubber", "silicone",
  "stainless", "steel", "stone", "wood", "wooden", "wool",
])
const COLORS = new Set([
  "beige", "black", "blue", "brown", "clear", "gold", "gray", "green",
  "grey", "orange", "pink", "purple", "red", "silver", "white", "yellow",
])
const SHAPES = new Set([
  "oval", "rectangular", "round", "square", "triangular",
])
const GENERIC_CONTEXT = new Set([
  "accessory", "accessories", "premium", "professional", "replacement",
  "universal",
])
const FUNCTION_WORDS = new Set([
  "a", "an", "and", "by", "each", "for", "from", "in", "including", "of",
  "on", "or", "per", "the", "to", "with",
])
const COUNT_WORDS = new Set([
  "count", "ct", "pack", "packs", "pc", "pcs", "piece", "pieces", "set",
])
const NOISE_WORDS = new Set([
  "assorted", "default", "new", "title", "various",
])
const CONNECTORS = new Set(["for", "including", "with"])

function normalizedText(value: unknown, maximum = 320) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

function tokens(value: unknown) {
  return normalizedText(value).normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US")
    .match(/[a-z0-9]+/g) ?? []
}

function lexicalStem(value: string) {
  if (value.length > 4 && value.endsWith("ies")) return `${value.slice(0, -3)}y`
  if (value.length > 4 && value.endsWith("es")) return value.slice(0, -2)
  if (value.length > 3 && value.endsWith("s")) return value.slice(0, -1)
  return value
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))]
}

function boundedQuery(values: readonly string[]) {
  const selected: string[] = []
  for (const value of values) {
    if (!value || selected.includes(value)) continue
    const candidate = [...selected, value].join(" ")
    if (candidate.length > 100 || selected.length >= 12) break
    selected.push(value)
  }
  return selected.join(" ")
}

function countQualifierTokens(titleTokens: readonly string[]) {
  for (let index = 0; index < titleTokens.length; index += 1) {
    if (!/^\d{1,3}$/.test(titleTokens[index])) continue
    const following = titleTokens.slice(index + 1, index + 3)
    const countWord = following.find((entry) => COUNT_WORDS.has(entry))
    if (countWord) return unique([titleTokens[index], countWord,
      following.includes("set") ? "set" : ""])
  }
  return []
}

function sizeQualifierTokens(titleTokens: readonly string[]) {
  const units = new Set(["cm", "ft", "g", "in", "inch", "inches", "kg", "l",
    "lb", "lbs", "ml", "mm", "oz", "quart", "quarts"])
  const result: string[] = []
  for (let index = 0; index < titleTokens.length - 1; index += 1) {
    if (/^\d+(?:\.\d+)?$/.test(titleTokens[index]) && units.has(titleTokens[index + 1])) {
      result.push(titleTokens[index], titleTokens[index + 1])
    }
  }
  return unique(result)
}

export function extractProductResearchEntityV1(input: Readonly<{
  productName: unknown
  brand?: unknown
  sourceField?: string
  sourceAuthority?: string
}>) {
  const sourceField = normalizedText(input.sourceField, 120) || "product_title"
  const sourceAuthority = normalizedText(input.sourceAuthority, 160) ||
    "LUNA_PRODUCT_TRUTH"
  const titleTokens = tokens(input.productName)
  const brandSignal = unique(tokens(input.brand).filter((entry) => entry.length >= 2))
  const countOrSetQualifiers = countQualifierTokens(titleTokens)
  const sizeOrVariantQualifiers = sizeQualifierTokens(titleTokens)
  const boundary = titleTokens.findIndex((entry) => CONNECTORS.has(entry))
  const main = (boundary >= 0 ? titleTokens.slice(0, boundary) : titleTokens)
    .filter((entry) => entry.length >= 2 && !/^\d+(?:\.\d+)?$/.test(entry) &&
      !FUNCTION_WORDS.has(entry) && !COUNT_WORDS.has(entry) &&
      !NOISE_WORDS.has(entry) && !brandSignal.includes(entry))
  const productNoun = [...main].reverse().find((entry) =>
    !MATERIALS.has(entry) && !COLORS.has(entry) && !SHAPES.has(entry) &&
    !GENERIC_CONTEXT.has(entry)) ?? null
  const nounIndex = productNoun ? main.lastIndexOf(productNoun) : -1
  const materialQualifiers = unique(main.filter((entry) => MATERIALS.has(entry)))
  const beforeNoun = nounIndex >= 0 ? main.slice(0, nounIndex) : []
  const afterConnector = boundary >= 0 ? titleTokens.slice(boundary + 1) : []
  const featureQualifiers = unique([
    ...beforeNoun.filter((entry) => SHAPES.has(entry)),
    ...afterConnector,
  ]
    .filter((entry) => entry.length >= 2 && !MATERIALS.has(entry) &&
      !COLORS.has(entry) && !GENERIC_CONTEXT.has(entry) &&
      !FUNCTION_WORDS.has(entry) && !COUNT_WORDS.has(entry) &&
      !NOISE_WORDS.has(entry) && !/^\d+(?:\.\d+)?$/.test(entry) &&
      entry !== productNoun))
  const definingFamilyQualifiers = unique(beforeNoun.filter((entry) =>
    !MATERIALS.has(entry) && !COLORS.has(entry) && !SHAPES.has(entry) &&
    !GENERIC_CONTEXT.has(entry))).slice(-2)
  const productFamilyCandidate = productNoun
    ? boundedQuery([...materialQualifiers, ...definingFamilyQualifiers, productNoun])
    : null
  const reason = (term: string) => term === productNoun
    ? "PRODUCT_ENTITY_HEAD_NOUN"
    : brandSignal.includes(term) ? "STRUCTURED_BRAND_SIGNAL"
      : countOrSetQualifiers.includes(term) ? "COUNT_OR_SET_QUALIFIER"
        : sizeOrVariantQualifiers.includes(term) ? "SIZE_OR_VARIANT_QUALIFIER"
          : materialQualifiers.includes(term) ? "MATERIAL_QUALIFIER"
            : definingFamilyQualifiers.includes(term)
              ? "DEFINING_FAMILY_QUALIFIER" : "FEATURE_QUALIFIER"
  const selectedEvidence = unique([
    ...brandSignal, ...countOrSetQualifiers, ...sizeOrVariantQualifiers,
    ...materialQualifiers, ...definingFamilyQualifiers, ...featureQualifiers,
    productNoun ?? "",
  ]).map((term) => Object.freeze({ term, sourceField, sourceAuthority,
    selectionReason: reason(term) }))
  return Object.freeze({
    productNoun,
    productFamilyCandidate,
    materialQualifiers: Object.freeze(materialQualifiers),
    countOrSetQualifiers: Object.freeze(countOrSetQualifiers),
    sizeOrVariantQualifiers: Object.freeze(sizeOrVariantQualifiers),
    brandSignal: Object.freeze(brandSignal),
    featureQualifiers: Object.freeze(featureQualifiers),
    definingFamilyQualifiers: Object.freeze(definingFamilyQualifiers),
    evidence: Object.freeze(selectedEvidence),
    status: productNoun ? "PROVEN" as const : "UNPROVEN" as const,
  }) satisfies ProductResearchEntityV1
}

function evidenceForTerms(entity: ProductResearchEntityV1, selected: readonly string[]) {
  const byTerm = new Map(entity.evidence.map((entry) => [entry.term, entry] as const))
  return selected.flatMap((term) => byTerm.get(term) ? [byTerm.get(term)!] : [])
}

export function buildProductResearchCommercialQueryStrategyV1(input: Readonly<{
  productName: unknown
  brand?: unknown
  sourceField?: string
  sourceAuthority?: string
  marketplaceTerms?: readonly ProductResearchMarketplaceTermV1[]
}>) {
  const entity = extractProductResearchEntityV1(input)
  if (!entity.productNoun) return Object.freeze({ entity, queries: Object.freeze([]),
    semanticExpansionStatus: "UNPROVEN" as const })
  const exactTerms = unique([
    ...entity.brandSignal,
    ...entity.countOrSetQualifiers,
    ...entity.sizeOrVariantQualifiers,
    ...entity.materialQualifiers,
    ...entity.definingFamilyQualifiers,
    entity.productNoun,
    ...entity.featureQualifiers,
  ])
  const coreTerms = unique([
    ...entity.materialQualifiers,
    ...entity.definingFamilyQualifiers,
    entity.productNoun,
  ])
  const candidates: Array<Omit<ProductResearchCommercialQueryV1, "ordinal">> = []
  const exact = boundedQuery(exactTerms)
  const core = boundedQuery(coreTerms)
  if (exact) candidates.push({ intent: "EXACT_PRODUCT_QUERY", query: exact,
    evidenceBasis: evidenceForTerms(entity, exact.split(" ")) })
  if (core && core !== exact) candidates.push({ intent: "CORE_FAMILY_QUERY", query: core,
    evidenceBasis: evidenceForTerms(entity, core.split(" ")) })
  const marketplaceTerms = (input.marketplaceTerms ?? []).filter((entry) =>
    ["EXACT", "FAMILY"].includes(entry.relevance) && entry.titleFrequency >= 2 &&
    entry.evidenceIds.length > 0 &&
    (entry.sellerDiversity === null || entry.sellerDiversity >= 2))
    .sort((left, right) => right.titleFrequency - left.titleFrequency ||
      left.term.localeCompare(right.term))
  const expansionTerms = unique(marketplaceTerms.map((entry) =>
    tokens(entry.term)[0] ?? "").filter((entry) => entry &&
      !exactTerms.includes(entry))).slice(0, 2)
  if (expansionTerms.length) {
    const expansion = boundedQuery([entity.productNoun, ...expansionTerms])
    candidates.push({ intent: "SEMANTIC_EXPANSION_QUERY", query: expansion,
      evidenceBasis: marketplaceTerms.filter((entry) =>
        expansionTerms.includes(tokens(entry.term)[0] ?? "")).map((entry) => ({
          term: tokens(entry.term)[0] ?? entry.term,
          sourceField: "marketplace_sold_title_evidence",
          sourceAuthority: "EBAY_PRODUCT_RESEARCH_DURABLE_EVIDENCE",
          selectionReason: `MARKETPLACE_${entry.relevance}_TERM_FREQUENCY_${entry.titleFrequency}`,
        })) })
  }
  return Object.freeze({ entity,
    queries: Object.freeze(candidates.slice(0, 3).map((entry, index) =>
      Object.freeze({ ...entry, evidenceBasis: Object.freeze(entry.evidenceBasis),
        ordinal: index + 1 }))),
    semanticExpansionStatus: expansionTerms.length ? "PROVEN" as const : "UNPROVEN" as const,
  })
}

function includesStem(row: readonly string[], expected: string) {
  const stem = lexicalStem(expected)
  return row.some((entry) => lexicalStem(entry) === stem)
}

function hasStructuralDiscriminatorMatch(
  entity: ProductResearchEntityV1,
  rowTokens: readonly string[],
) {
  const setStructureVisible = entity.countOrSetQualifiers
    .filter((entry) => !/^\d+$/.test(entry))
    .some((entry) => includesStem(rowTokens, entry))
  const sizeVisible = entity.sizeOrVariantQualifiers.length > 0 &&
    entity.sizeOrVariantQualifiers.every((entry) => includesStem(rowTokens, entry))
  const featureMatches = entity.featureQualifiers.filter((entry) =>
    includesStem(rowTokens, entry)).length
  const minimumFeatureMatches = Math.min(2, entity.featureQualifiers.length)
  const featureIdentityVisible = minimumFeatureMatches > 0 &&
    featureMatches >= minimumFeatureMatches
  return setStructureVisible || sizeVisible || featureIdentityVisible
}

export function classifyCommercialComparableV1(input: Readonly<{
  entity: ProductResearchEntityV1
  title: unknown
  detectedCount?: number | null
  detectedSize?: string | null
}>) {
  const rowTokens = unique(tokens(input.title).filter((entry) => entry.length >= 2))
  if (!input.entity.productNoun ||
      !includesStem(rowTokens, input.entity.productNoun)) {
    return Object.freeze({ classification: "FALSE_POSITIVE" as const,
      reasons: Object.freeze(["PRODUCT_NOUN_ABSENT"]) })
  }
  const missingFamily = input.entity.definingFamilyQualifiers.filter((entry) =>
    !includesStem(rowTokens, entry))
  if (missingFamily.length) {
    return Object.freeze({ classification: "ADJACENT_BUT_NOT_COMPARABLE" as const,
      reasons: Object.freeze(["DEFINING_FAMILY_QUALIFIER_MISSING",
        ...missingFamily.map((entry) => `MISSING_${entry.toUpperCase()}`)]) })
  }
  const expectedCount = Number(input.entity.countOrSetQualifiers.find((entry) =>
    /^\d+$/.test(entry))) || null
  const expectedSize = input.entity.sizeOrVariantQualifiers.join(" ") || null
  const structuralDiscriminatorMatch = hasStructuralDiscriminatorMatch(
    input.entity, rowTokens)
  if (expectedCount && input.detectedCount && expectedCount !== input.detectedCount ||
      expectedSize && input.detectedSize && expectedSize !== input.detectedSize) {
    return structuralDiscriminatorMatch
      ? Object.freeze({ classification: "CLOSE_VARIANT_COMPARABLE" as const,
        reasons: Object.freeze(["EXACT_VARIANT_QUALIFIER_DIFFERS",
          "PRODUCT_ENTITY_STRUCTURE_MATCHES"]) })
      : Object.freeze({ classification: "ADJACENT_BUT_NOT_COMPARABLE" as const,
        reasons: Object.freeze(["EXACT_VARIANT_QUALIFIER_DIFFERS",
          "PRODUCT_ENTITY_STRUCTURE_UNPROVEN"]) })
  }
  const exactDiscriminators = unique([
    ...input.entity.materialQualifiers,
    ...input.entity.countOrSetQualifiers,
    ...input.entity.sizeOrVariantQualifiers,
    ...input.entity.featureQualifiers,
  ]).filter((entry) => !COUNT_WORDS.has(entry))
  const exactVisible = exactDiscriminators.length > 0 && exactDiscriminators.every((entry) =>
    includesStem(rowTokens, entry))
  return exactVisible
    ? Object.freeze({ classification: "EXACT_PRODUCT_COMPARABLE" as const,
      reasons: Object.freeze(["PRODUCT_ENTITY_AND_EXACT_DISCRIMINATORS_MATCH"]) })
    : structuralDiscriminatorMatch
      ? Object.freeze({ classification: "CORE_FAMILY_COMPARABLE" as const,
        reasons: Object.freeze(["PRODUCT_ENTITY_FAMILY_AND_STRUCTURE_MATCH"]) })
      : Object.freeze({ classification: "ADJACENT_BUT_NOT_COMPARABLE" as const,
        reasons: Object.freeze(["GENERIC_ATTRIBUTE_OVERLAP_ONLY",
          "PRODUCT_ENTITY_STRUCTURE_UNPROVEN"]) })
}

export function evaluateProductResearchQueryQualityV1(
  classifications: readonly CommercialComparableClassificationV1[],
) {
  const count = (value: CommercialComparableClassificationV1) =>
    classifications.filter((entry) => entry === value).length
  const exact = count("EXACT_PRODUCT_COMPARABLE")
  const close = count("CLOSE_VARIANT_COMPARABLE")
  const family = count("CORE_FAMILY_COMPARABLE")
  const adjacent = count("ADJACENT_BUT_NOT_COMPARABLE")
  const falsePositive = count("FALSE_POSITIVE")
  const comparable = exact + close + family
  const total = classifications.length
  const comparablePrecision = total ? comparable / total : 0
  const productEntityMatchRate = total ? (comparable + adjacent) / total : 0
  const falsePositiveRate = total ? (adjacent + falsePositive) / total : 1
  const sufficient = comparable > 0 && comparablePrecision >= 0.5
  return Object.freeze({
    exactComparableCount: exact,
    closeVariantComparableCount: close,
    familyComparableCount: family,
    adjacentCount: adjacent,
    falsePositiveCount: falsePositive,
    comparablePrecision,
    productEntityMatchRate,
    falsePositiveRate,
    status: sufficient ? "COMMERCIALLY_SUFFICIENT" as const
      : total ? "LOW_PRECISION_REFORMULATION_REQUIRED" as const
        : "NO_EVIDENCE_UNPROVEN" as const,
  })
}

export function canonicalizeComparableEvidenceByItemIdV1<T extends Readonly<{
  itemId: string | null
  queryProvenance: string
  soldQuantity: number
}>>(rows: readonly T[]) {
  const grouped = new Map<string, { row: T; queryProvenances: Set<string> }>()
  for (const row of rows) {
    const itemId = normalizedText(row.itemId, 30)
    if (!/^\d{9,20}$/.test(itemId)) continue
    const current = grouped.get(itemId)
    if (current) current.queryProvenances.add(row.queryProvenance)
    else grouped.set(itemId, { row, queryProvenances: new Set([row.queryProvenance]) })
  }
  return Object.freeze([...grouped.entries()].sort(([left], [right]) =>
    left.localeCompare(right)).map(([itemId, entry]) => Object.freeze({
      ...entry.row,
      itemId,
      soldQuantity: entry.row.soldQuantity,
      queryProvenances: Object.freeze([...entry.queryProvenances].sort()),
    })))
}
