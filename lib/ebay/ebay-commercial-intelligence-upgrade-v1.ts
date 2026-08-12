import { createHash } from "node:crypto"

import type { MarketEvidenceV1, MarketResearchRequestV1 } from
  "./ebay-market-opportunity-research-v1"

export const EBAY_COMMERCIAL_INTELLIGENCE_UPGRADE_VERSION =
  "EBAY_COMMERCIAL_INTELLIGENCE_UPGRADE_V1_2026_08_12"
export const CANONICAL_OPPORTUNITY_RESULT_VERSION_V2 =
  "CANONICAL_OPPORTUNITY_RESULT_V2_2026_08_12"
export const CANONICAL_OPPORTUNITY_DECISION_VERSION_V2 =
  "CANONICAL_OPPORTUNITY_DECISION_V2_2026_08_12"
export const OPPORTUNITY_BATCH_MAX_CONCURRENCY = 4
export const OPPORTUNITY_BATCH_CHUNK_SIZE = 25
export const OPPORTUNITY_QUERY_MAX_PER_CANDIDATE = 2

export type CanonicalFamilyInputV1 = {
  seedValue?: string | null
  title?: string | null
  categoryId?: string | null
  categoryName?: string | null
  itemSpecifics?: Record<string, string> | null
  packCount?: number | null
  brand?: string | null
  model?: string | null
}

export type ComparableFingerprintStateV2 =
  | "STRICT_COMPARABLE"
  | "FAMILY_COMPARABLE"
  | "ADJACENT_PRODUCT"
  | "PACK_MISMATCH"
  | "FORM_FACTOR_CONFLICT"
  | "VARIANT_CONFLICT"
  | "IDENTITY_CONFLICT"
  | "NOT_COMPARABLE"

export type KeywordRoleV2 =
  | "CORE_PRODUCT"
  | "FORM_FACTOR"
  | "FEATURE"
  | "POWER"
  | "BENEFIT"
  | "USE_CASE"
  | "ATTRIBUTE"
  | "GENERIC"
  | "REJECT"

export type PriceRepresentativenessStateV2 =
  | "PRICE_CORE_CLUSTER"
  | "PRICE_PREMIUM"
  | "PRICE_LOW_OUTLIER"
  | "PRICE_HIGH_OUTLIER"
  | "PRICE_OUTLIER_UNPROVEN"
  | "PRICE_REPRESENTATIVE_UNKNOWN"

type EconomicsEvidenceV1 = {
  supplierCost?: number | null
  shippingCost?: number | null
  ebayFeeRate?: number | null
  promotedFeeRate?: number | null
  promotedFeeComplete?: boolean
}

type SupplierEvidenceV1 = {
  identityStatus?: "EXACT_PROVEN" | "STRONG_CANDIDATE_HUMAN_REVIEW" | "UNPROVEN" | "CONFLICT"
  stockStatus?: "IN_STOCK" | "LOW_STOCK_CONFIRMED" | "OUT_OF_STOCK" | "STALE_EVIDENCE" | "UNKNOWN"
}

const STOP_WORDS = new Set([
  "a", "an", "and", "at", "by", "ebay", "for", "from", "in", "new", "of",
  "on", "or", "sale", "shipping", "the", "to", "with",
])
const COLOR_WORDS = new Set([
  "black", "blue", "brown", "clear", "gold", "gray", "green", "grey", "orange",
  "pink", "purple", "red", "silver", "tan", "white", "yellow",
])
const ATTRIBUTE_WORDS = new Set([
  "black", "blue", "white", "red", "pink", "green", "silver", "gold", "personal",
  "rechargeable", "usb", "usb-c", "bladeless", "quiet", "speed", "speeds", "mah",
])
const GENERIC_WORDS = new Set([
  "fan", "portable", "rechargeable", "personal", "device", "accessory", "product",
])
const PRODUCT_HEADS = new Set([
  "fan", "conditioner", "holder", "organizer", "adapter", "charger", "case", "bottle",
  "sprayer", "cleaner", "lamp", "light", "pump", "filter", "brush", "rack", "cover",
])
const PROMOTIONAL_CONTAMINANTS = new Set([
  "best", "deal", "free", "hot", "new", "sale", "shipping",
])

const FAMILY_PATTERNS = [
  { pattern: /\b(?:portable\s+)?(?:wearable\s+)?(?:neck|neckband)(?:\s+mounted)?\s+fans?\b/i,
    label: "Portable Neck Fan", core: "neck fan", formFactor: "wearable / neck-mounted",
    placement: "neck", purpose: "personal cooling" },
  { pattern: /\bhandheld(?:\s+(?:mini|turbo|portable|foldable)){0,3}\s+fans?\b|\bportable\s+(?:mini\s+)?(?:turbo\s+)?handheld(?:\s+foldable)?\s+fans?\b/i,
    label: "Handheld Fan", core: "handheld fan", formFactor: "handheld",
    placement: "hand", purpose: "personal cooling" },
  { pattern: /\bdesk(?:top)?\s+fans?\b|\btable(?:top)?\s+fans?\b/i,
    label: "Desk Fan", core: "desk fan", formFactor: "desktop",
    placement: "table / desk", purpose: "space cooling" },
  { pattern: /\btower\s+fans?\b/i, label: "Tower Fan", core: "tower fan",
    formFactor: "floor-standing tower", placement: "floor", purpose: "space cooling" },
  { pattern: /\bceiling\s+fans?\b/i, label: "Ceiling Fan", core: "ceiling fan",
    formFactor: "ceiling-mounted", placement: "ceiling", purpose: "space cooling" },
] as const

function clean(value: unknown, maximum = 240) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

function normalize(value: unknown) {
  return clean(value).toLocaleLowerCase("en-US")
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9+.-]+/g, " ").trim()
}

function words(value: unknown) {
  return normalize(value).split(/\s+/).filter((word) =>
    word.length > 1 && !STOP_WORDS.has(word))
}

function unique<T>(values: T[]) {
  return [...new Set(values)]
}

function score(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)) * 100) / 100
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function overlap(left: string[], right: string[]) {
  if (!left.length || !right.length) return 0
  const rightSet = new Set(right)
  return left.filter((word) => rightSet.has(word)).length /
    Math.max(1, Math.min(left.length, right.length))
}

function titleCase(value: string) {
  return value.split(" ").map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : "")
    .join(" ")
}

function structuredText(input: CanonicalFamilyInputV1) {
  return Object.entries(input.itemSpecifics ?? {}).flatMap(([name, value]) => [name, value]).join(" ")
}

export function normalizePackQuantityV1(input: {
  title?: string | null
  itemSpecifics?: Record<string, string> | null
  packCount?: number | null
}) {
  const structured = Number(input.packCount)
  if (Number.isInteger(structured) && structured > 0 && structured <= 100) {
    return { packType: structured === 1 ? "SINGLE_UNIT" as const : "MULTI_PACK" as const,
      packCount: structured, confidence: 100, reasonCodes: ["STRUCTURED_PACK_COUNT"] }
  }
  const aspects = Object.entries(input.itemSpecifics ?? {})
  for (const [name, value] of aspects) {
    if (!/(?:number in pack|pack quantity|unit count|number of items)/i.test(name)) continue
    const parsed = Number(clean(value).match(/\b(\d{1,3})\b/)?.[1])
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 100) {
      return { packType: parsed === 1 ? "SINGLE_UNIT" as const : "MULTI_PACK" as const,
        packCount: parsed, confidence: 95, reasonCodes: ["ITEM_SPECIFIC_PACK_COUNT"] }
    }
  }
  const title = clean(input.title)
  const pack = title.match(/\b(?:pack|set|lot)\s+(?:of\s+)?(\d{1,3})\b/i) ??
    title.match(/\b(\d{1,3})\s*(?:pack|pk|pcs?|pieces?|count|ct)\b/i) ??
    title.match(/\b(\d{1,3})\s*x\b/i)
  const parsed = Number(pack?.[1])
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 100) {
    return { packType: parsed === 1 ? "SINGLE_UNIT" as const : "MULTI_PACK" as const,
      packCount: parsed, confidence: 88, reasonCodes: ["TITLE_PACK_COUNT"] }
  }
  if (/\bbundle\b/i.test(title)) return { packType: "BUNDLE" as const, packCount: null,
    confidence: 85, reasonCodes: ["TITLE_BUNDLE"] }
  if (/\bkit\b/i.test(title)) return { packType: "KIT" as const, packCount: null,
    confidence: 85, reasonCodes: ["TITLE_KIT"] }
  return { packType: "SINGLE_UNIT" as const, packCount: 1, confidence: 65,
    reasonCodes: ["NO_MULTI_UNIT_SIGNAL_DEFAULT_SINGLE"] }
}

function attributeSet(input: CanonicalFamilyInputV1) {
  const combined = `${clean(input.title)} ${clean(input.seedValue)} ${structuredText(input)}`
  const values = new Set<string>()
  for (const match of combined.matchAll(/\b\d{3,6}\s*m\s*ah\b/gi)) {
    values.add(match[0].replace(/\s+/g, "").replace(/mah/i, "mAh"))
  }
  for (const match of combined.matchAll(/\b\d{1,2}\s*[- ]?speeds?\b/gi)) {
    values.add(match[0].replace(/\s+/g, "-").replace(/speeds?/i, "speed"))
  }
  if (/\brechargeable\b/i.test(combined)) values.add("rechargeable")
  if (/\bbladeless\b/i.test(combined)) values.add("bladeless")
  if (/\busb[ -]?c\b/i.test(combined)) values.add("USB-C")
  for (const word of words(combined)) if (COLOR_WORDS.has(word)) values.add(word)
  const pack = normalizePackQuantityV1({ title: combined, itemSpecifics: input.itemSpecifics,
    packCount: input.packCount })
  if (pack.packType === "MULTI_PACK" && pack.packCount) values.add(`${pack.packCount}-pack`)
  if (pack.packType === "BUNDLE") values.add("bundle")
  if (pack.packType === "KIT") values.add("kit")
  return [...values]
}

function fallbackFamily(value: string) {
  const candidateWords = words(value).filter((word) =>
    !ATTRIBUTE_WORDS.has(word) && !/^\d+(?:mah|w|v|oz|ml)?$/.test(word))
  const headIndex = candidateWords.findIndex((word) => PRODUCT_HEADS.has(word))
  if (headIndex < 0) return null
  const start = Math.max(0, headIndex - 2)
  const phrase = candidateWords.slice(start, headIndex + 1).join(" ")
  return phrase.length >= 3 ? titleCase(phrase) : null
}

export function resolveCanonicalProductFamilyV1(input: CanonicalFamilyInputV1) {
  const sourceValues = [input.title, input.seedValue, structuredText(input), input.categoryName]
    .map((value) => clean(value)).filter(Boolean)
  const combined = sourceValues.join(" ")
  const titleMatches = FAMILY_PATTERNS.filter((entry) => entry.pattern.test(clean(input.title)))
  const seedMatches = FAMILY_PATTERNS.filter((entry) => entry.pattern.test(clean(input.seedValue)))
  const combinedMatches = FAMILY_PATTERNS.filter((entry) => entry.pattern.test(combined))
  // Listing title is the strongest family-bearing text in this pure resolver. Aspects and
  // category can confirm or conflict, but they cannot silently turn a visibly different
  // form factor into a strict comparable.
  const matches = titleMatches.length ? titleMatches : seedMatches.length ? seedMatches : combinedMatches
  const attributes = attributeSet(input)
  const pack = normalizePackQuantityV1({ title: `${clean(input.title)} ${clean(input.seedValue)}`,
    itemSpecifics: input.itemSpecifics, packCount: input.packCount })
  const primary = matches[0]
  const fallback = primary ? null : fallbackFamily(clean(input.title) || clean(input.seedValue))
  const family = primary?.label ?? fallback
  const hasStructuredTruth = Boolean(Object.keys(input.itemSpecifics ?? {}).length || input.categoryId)
  const confidence = family ? score(primary
    ? 82 + (hasStructuredTruth ? 8 : 0) + (matches.length === 1 ? 5 : 0)
    : 58 + (hasStructuredTruth ? 7 : 0)) : 15
  const conflicts = unique(combinedMatches.filter((entry) => entry.label !== primary?.label).map((entry) =>
    `FAMILY_CONFLICT:${primary?.label ?? "UNPROVEN"}:${entry.label}`))
  const candidates = unique([
    ...(primary ? [primary.label] : []),
    ...matches.slice(1).map((entry) => entry.label),
    ...(fallback ? [fallback] : []),
  ]).map((label, index) => ({
    family: label,
    confidence: score(confidence - index * 18),
    reasonCodes: primary && index === 0
      ? ["PRODUCT_HEAD_AND_FORM_FACTOR_MATCH", ...(hasStructuredTruth ? ["STRUCTURED_LISTING_TRUTH_USED"] : [])]
      : ["TITLE_PRODUCT_HEAD_FALLBACK"],
  }))
  return {
    status: family && confidence >= 75 && !conflicts.length ? "RESOLVED" as const
      : family ? "CANDIDATES_RANKED" as const : "UNPROVEN" as const,
    canonicalFamily: family,
    confidence,
    fingerprint: {
      coreProduct: primary?.core ?? (family ? normalize(family) : null),
      formFactor: primary?.formFactor ?? null,
      placement: primary?.placement ?? null,
      power: attributes.includes("rechargeable") ? "rechargeable" : null,
      portability: /\bportable\b/i.test(combined) || primary?.label === "Portable Neck Fan"
        ? "portable" : null,
      functionalPurpose: primary?.purpose ?? null,
      pack,
      attributes,
    },
    attributes,
    candidates,
    conflicts,
    reasons: family
      ? ["PRODUCT_FAMILY_SEPARATED_FROM_ATTRIBUTES",
        ...(hasStructuredTruth ? ["CATEGORY_OR_ASPECT_TRUTH_CONSIDERED"] : ["TITLE_ONLY_EVIDENCE"])]
      : ["PRODUCT_HEAD_NOT_PROVEN"],
  }
}

export function buildMultiSeedConsensusV1(input: {
  request: MarketResearchRequestV1
  sourceListing?: MarketEvidenceV1 | null
  evidence?: MarketEvidenceV1[]
}) {
  const source = input.sourceListing ?? null
  const evidenceFamilies = (input.evidence ?? []).filter((row) => row.activeListing)
    .map((row) => resolveCanonicalProductFamilyV1({ title: row.title,
      categoryId: row.categoryId, categoryName: row.categoryName,
      itemSpecifics: row.itemSpecifics, packCount: row.packCount,
      brand: row.brand, model: row.model }))
    .filter((result) => result.canonicalFamily && result.confidence >= 70)
  const clustered = new Map<string, { result: typeof evidenceFamilies[number]; support: number }>()
  for (const result of evidenceFamilies) {
    const key = normalize(result.canonicalFamily)
    const current = clustered.get(key)
    clustered.set(key, { result: current && current.result.confidence > result.confidence
      ? current.result : result, support: (current?.support ?? 0) + 1 })
  }
  const evidenceCluster = [...clustered.values()].sort((left, right) =>
    right.support - left.support || right.result.confidence - left.result.confidence ||
    normalize(left.result.canonicalFamily).localeCompare(normalize(right.result.canonicalFamily)))[0]
  const paths = [
    { path: input.request.seedType, value: input.request.seedValue,
      supportCount: 1,
      result: resolveCanonicalProductFamilyV1({ seedValue: input.request.seedValue,
        categoryId: input.request.seedIdentity.categoryId,
        categoryName: input.request.seedIdentity.categoryName,
        packCount: input.request.seedIdentity.packCount,
        brand: input.request.seedIdentity.brand,
        model: input.request.seedIdentity.model }) },
    ...(source ? [{ path: "AUTHORITATIVE_LISTING_TRUTH", value: source.title ?? input.request.seedValue,
      supportCount: 1,
      result: resolveCanonicalProductFamilyV1({ seedValue: input.request.seedValue, title: source.title,
        categoryId: source.categoryId, categoryName: source.categoryName,
        itemSpecifics: source.itemSpecifics, packCount: source.packCount,
        brand: source.brand, model: source.model }) }] : []),
    ...(evidenceCluster && evidenceCluster.support >= 2 ? [{
      path: "ACTIVE_MARKET_FAMILY_CLUSTER",
      value: evidenceCluster.result.canonicalFamily ?? "",
      supportCount: evidenceCluster.support,
      result: evidenceCluster.result,
    }] : []),
  ]
  const familySupport = new Map<string, { score: number; paths: string[] }>()
  for (const path of paths) {
    if (!path.result.canonicalFamily) continue
    const key = normalize(path.result.canonicalFamily)
    const current = familySupport.get(key) ?? { score: 0, paths: [] }
    current.score += path.result.confidence
    current.paths.push(path.path)
    familySupport.set(key, current)
  }
  const ranked = [...familySupport.entries()].sort((left, right) =>
    right[1].score - left[1].score || left[0].localeCompare(right[0]))
  const winner = ranked[0]
  const canonicalFamily = winner ? paths.find((path) =>
    normalize(path.result.canonicalFamily) === winner[0])?.result.canonicalFamily ?? null : null
  const familyConfidence = winner
    ? score(winner[1].score / winner[1].paths.length + (winner[1].paths.length > 1 ? 5 : 0)) : 15
  const conflicts = ranked.slice(1).filter((entry) => entry[1].score >= (winner?.[1].score ?? 0) * .7)
    .map((entry) => `MATERIAL_FAMILY_CONFLICT:${entry[0]}`)
  const attributes = unique(paths.flatMap((path) => path.result.attributes))
  const searchTerms = unique([
    ...(canonicalFamily ? [normalize(canonicalFamily)] : []),
    ...paths.flatMap((path) => path.result.fingerprint.formFactor && path.result.canonicalFamily
      ? [`${path.result.fingerprint.formFactor.split(" /")[0]} ${normalize(path.result.canonicalFamily)}`]
      : []),
  ]).filter((term) => term.length >= 3).slice(0, OPPORTUNITY_QUERY_MAX_PER_CANDIDATE)
  const reason = conflicts.length ? "MULTIPLE_MATERIAL_FAMILY_IDENTITIES"
    : winner?.[1].paths.length && winner[1].paths.length > 1
      ? "LISTING_TRUTH_AND_SEED_PATHS_AGREE"
      : canonicalFamily ? "BEST_AVAILABLE_CANONICAL_FAMILY_PATH" : "FAMILY_IDENTITY_UNPROVEN"
  return {
    CANONICAL_FAMILY: canonicalFamily,
    FAMILY_CONFIDENCE: familyConfidence,
    ATTRIBUTE_SET: attributes,
    SEARCH_TERM_CANDIDATES: searchTerms,
    CONFLICTS: conflicts,
    CONSENSUS_REASON: reason,
    canonicalFamily,
    familyConfidence,
    attributeSet: attributes,
    searchTermCandidates: searchTerms,
    conflicts,
    consensusReason: reason,
    seedPaths: paths.map((path) => ({ path: path.path, value: path.value,
      family: path.result.canonicalFamily, confidence: path.result.confidence,
      supportCount: path.supportCount,
      structuredListingTruthUsed: path.path === "AUTHORITATIVE_LISTING_TRUTH" })),
    queryPolicy: { maxQueries: OPPORTUNITY_QUERY_MAX_PER_CANDIDATE,
      dedupe: "NORMALIZED_QUERY", cacheAware: true, rateLimitAware: true },
  }
}

function formSignals(value: string) {
  const normalized = normalize(value)
  if (/\b(?:neck|neckband|wearable)\b/.test(normalized)) {
    return { formFactor: "wearable / neck-mounted", placement: "neck" }
  }
  if (/\b(?:handheld|foldable|pocket)\b/.test(normalized)) {
    return { formFactor: "handheld", placement: "hand" }
  }
  if (/\b(?:desk|desktop|tabletop)\b/.test(normalized)) {
    return { formFactor: "desktop", placement: "table / desk" }
  }
  return { formFactor: null, placement: null }
}

export function classifyStrictComparableV2(input: {
  canonical: ReturnType<typeof resolveCanonicalProductFamilyV1>
  seed: MarketResearchRequestV1["seedIdentity"]
  evidence: MarketEvidenceV1
}) {
  const evidenceFamily = resolveCanonicalProductFamilyV1({ title: input.evidence.title,
    categoryId: input.evidence.categoryId, categoryName: input.evidence.categoryName,
    itemSpecifics: input.evidence.itemSpecifics, packCount: input.evidence.packCount,
    brand: input.evidence.brand, model: input.evidence.model })
  const expectedPack = input.canonical.fingerprint.pack
  const observedPack = evidenceFamily.fingerprint.pack
  const expectedForm = input.canonical.fingerprint.formFactor
  const observedForm = evidenceFamily.fingerprint.formFactor ?? formSignals(input.evidence.title ?? "").formFactor
  const sameFamily = Boolean(input.canonical.canonicalFamily && evidenceFamily.canonicalFamily &&
    normalize(input.canonical.canonicalFamily) === normalize(evidenceFamily.canonicalFamily))
  const functionalOverlap = overlap(words(input.canonical.fingerprint.functionalPurpose),
    words(evidenceFamily.fingerprint.functionalPurpose))
  const categoryConsistent = Boolean(input.seed.categoryId && input.evidence.categoryId
    ? input.seed.categoryId === input.evidence.categoryId : input.evidence.categoryId)
  const categoryConflict = Boolean(input.seed.categoryId && input.evidence.categoryId &&
    input.seed.categoryId !== input.evidence.categoryId)
  const risks: string[] = []
  if (expectedPack.packCount && observedPack.packCount &&
      expectedPack.packCount !== observedPack.packCount) risks.push("PACK_COUNT_CONFLICT")
  if (expectedPack.packType !== observedPack.packType &&
      [expectedPack.packType, observedPack.packType].some((value) => ["BUNDLE", "KIT"].includes(value))) {
    risks.push("BUNDLE_STRUCTURE_CONFLICT")
  }
  if (expectedForm && observedForm && expectedForm !== observedForm) risks.push("FORM_FACTOR_CONFLICT")
  if (categoryConflict) risks.push("CATEGORY_CONFLICT")
  if (input.seed.brand && input.evidence.brand &&
      normalize(input.seed.brand) !== normalize(input.evidence.brand)) risks.push("BRAND_CONTAMINATION_RISK")
  if ((input.seed.model || input.seed.mpn) && (input.evidence.model || input.evidence.mpn) &&
      normalize(input.seed.model ?? input.seed.mpn) !== normalize(input.evidence.model ?? input.evidence.mpn)) {
    risks.push("MODEL_VARIANT_CONFLICT")
  }
  let classification: ComparableFingerprintStateV2
  if (!input.canonical.canonicalFamily || !evidenceFamily.canonicalFamily) classification = "NOT_COMPARABLE"
  else if (risks.includes("FORM_FACTOR_CONFLICT")) classification = "FORM_FACTOR_CONFLICT"
  else if (risks.some((risk) => risk.includes("PACK") || risk.includes("BUNDLE"))) classification = "PACK_MISMATCH"
  else if (risks.includes("MODEL_VARIANT_CONFLICT")) classification = "VARIANT_CONFLICT"
  else if (risks.includes("BRAND_CONTAMINATION_RISK")) classification = "IDENTITY_CONFLICT"
  else if (risks.includes("CATEGORY_CONFLICT") && sameFamily) classification = "FAMILY_COMPARABLE"
  else if (sameFamily && expectedForm === observedForm && expectedPack.packCount === observedPack.packCount) {
    classification = "STRICT_COMPARABLE"
  } else if (sameFamily) classification = "FAMILY_COMPARABLE"
  else if (functionalOverlap > 0 || categoryConsistent) classification = "ADJACENT_PRODUCT"
  else classification = "IDENTITY_CONFLICT"
  const confidence = score((sameFamily ? 58 : 15) + (expectedForm === observedForm ? 18 : 0) +
    (expectedPack.packCount === observedPack.packCount ? 14 : 0) + (categoryConsistent ? 10 : 0) - risks.length * 12)
  return {
    classification,
    confidence,
    strictPricingEligible: classification === "STRICT_COMPARABLE",
    referenceEligible: ["STRICT_COMPARABLE", "FAMILY_COMPARABLE"].includes(classification),
    expected: { family: input.canonical.canonicalFamily, coreProduct: input.canonical.fingerprint.coreProduct,
      formFactor: expectedForm, placement: input.canonical.fingerprint.placement,
      packType: expectedPack.packType, packCount: expectedPack.packCount },
    observed: { family: evidenceFamily.canonicalFamily, coreProduct: evidenceFamily.fingerprint.coreProduct,
      formFactor: observedForm, placement: evidenceFamily.fingerprint.placement,
      packType: observedPack.packType, packCount: observedPack.packCount },
    riskCodes: risks,
    reasonCodes: [classification, ...(categoryConsistent ? ["CATEGORY_CONSISTENT"] : []),
      ...(sameFamily ? ["CANONICAL_FAMILY_MATCH"] : [])],
  }
}

function phraseNgrams(value: string) {
  const tokens = words(value).slice(0, 32)
  const phrases: string[] = []
  for (let size = 1; size <= 3; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      phrases.push(tokens.slice(index, index + size).join(" "))
    }
  }
  return phrases
}

export function normalizeCommercialKeywordPhraseV2(
  value: string,
  canonicalFamily: string | null = null,
) {
  const original = normalize(value)
  const rawTokens = original.split(/\s+/).filter(Boolean)
  const contaminants = unique(rawTokens.filter((token) =>
    PROMOTIONAL_CONTAMINANTS.has(token)))
  if (contaminants.length) return {
    status: "REJECT" as const,
    phrase: original,
    originalPhrase: original,
    reasonCodes: ["REJECT_PROMOTIONAL_CONTAMINATION"],
    contaminants,
  }
  const tokens = words(value)
  const heads = unique(tokens.filter((token) => PRODUCT_HEADS.has(token)))
  if (heads.length > 1) return {
    status: "REJECT" as const,
    phrase: original,
    originalPhrase: original,
    reasonCodes: ["REJECT_CONFLICTING_PRODUCT_HEADS"],
    contaminants: [],
  }
  if (!tokens.length) return {
    status: "REJECT" as const,
    phrase: original,
    originalPhrase: original,
    reasonCodes: ["REJECT_EMPTY_COMMERCIAL_PHRASE"],
    contaminants: [],
  }
  let ordered = [...tokens]
  if (tokens.includes("fan")) {
    const hasNeck = tokens.includes("neck") || tokens.includes("neckband")
    const qualifiers = tokens.filter((token) =>
      !["fan", "fans", "neck", "neckband"].includes(token))
    const portable = qualifiers.filter((token) => token === "portable")
    const remaining = qualifiers.filter((token) => token !== "portable")
    ordered = [...portable, ...remaining, ...(hasNeck ? ["neck"] : []), "fan"]
  }
  const phrase = unique(ordered).join(" ")
  const changed = phrase !== original
  const family = words(canonicalFamily)
  const missingCoreQualifier = family.includes("neck") && phrase.includes("fan") &&
    !phrase.split(" ").includes("neck")
  return {
    status: "NORMALIZED" as const,
    phrase,
    originalPhrase: original,
    reasonCodes: unique([
      ...(changed ? ["CANONICAL_COMMERCIAL_WORD_ORDER"] : ["NATURAL_WORD_ORDER_OBSERVED"]),
      ...(missingCoreQualifier ? ["CANONICAL_FAMILY_QUALIFIER_MISSING"] : []),
    ]),
    contaminants: [],
  }
}

function classifyKeywordRole(
  phrase: string,
  canonicalFamily: string | null,
  rejectionReason: string | null = null,
): KeywordRoleV2 {
  const normalized = normalize(phrase)
  const phraseWords = words(phrase)
  const familyWords = words(canonicalFamily)
  const hasProductHead = phraseWords.some((word) => PRODUCT_HEADS.has(word))
  const isCapacity = /\b\d{3,6}\s*(?:m\s*)?ah\b/i.test(phrase)
  const nonsense = /\b(?:rechargeable\s+speed\s+portable|speed\s+portable\s+neck|fan\s+rechargeable\s+speed|black\s+personal|conditioner\s+\d+\s+mah\s+neck)\b/i.test(normalized)
  if (rejectionReason || nonsense || (!hasProductHead && phraseWords.length > 1 &&
      phraseWords.every((word) => ATTRIBUTE_WORDS.has(word) || /^\d+$/.test(word)))) return "REJECT"
  if (phraseWords.length === 1 && GENERIC_WORDS.has(phraseWords[0])) return "GENERIC"
  if (isCapacity || phraseWords.every((word) => COLOR_WORDS.has(word) || /^\d+$/.test(word))) {
    return "ATTRIBUTE"
  }
  if (!hasProductHead && phraseWords.length === 1 &&
      ["rechargeable", "usb", "usb-c"].includes(phraseWords[0])) return "POWER"
  if (normalized === normalize(canonicalFamily)) return "CORE_PRODUCT"
  if (familyWords.includes("neck") && phraseWords.includes("fan") &&
      !phraseWords.includes("neck")) return phraseWords.length > 2 ? "REJECT" : "GENERIC"
  if (hasProductHead && phraseWords.some((word) => /^(?:\d+-?)?speeds?$/.test(word))) {
    return "FEATURE"
  }
  if (hasProductHead && phraseWords.includes("cooling")) return "BENEFIT"
  if (hasProductHead && phraseWords.includes("rechargeable")) return "POWER"
  if (normalized === "neck fan" && familyWords.includes("neck")) return "CORE_PRODUCT"
  if (hasProductHead && phraseWords.some((word) => ["wearable", "neck", "neckband", "handheld"].includes(word))) {
    if (normalized !== "neck fan") return "FORM_FACTOR"
  }
  if (hasProductHead && familyWords.length && overlap(phraseWords, familyWords) >= .8) return "CORE_PRODUCT"
  if (hasProductHead && phraseWords.some((word) => ["quiet", "bladeless", "cooling"].includes(word))) {
    return "FEATURE"
  }
  if (phraseWords.some((word) => ["travel", "office", "outdoor", "sports"].includes(word))) {
    return hasProductHead ? "USE_CASE" : "REJECT"
  }
  if (phraseWords.some((word) => ["cooling", "comfort", "quiet"].includes(word))) {
    return hasProductHead ? "BENEFIT" : "REJECT"
  }
  if (!hasProductHead) return "REJECT"
  return "FEATURE"
}

export function buildKeywordIntelligenceV2(input: {
  canonical: ReturnType<typeof resolveCanonicalProductFamilyV1>
  evidence: MarketEvidenceV1[]
  comparables: Array<{ evidenceId: string; classification: ComparableFingerprintStateV2 }>
}) {
  const canonicalFamily = input.canonical.canonicalFamily
  const allowedEvidence = new Set(input.comparables.filter((row) =>
    ["STRICT_COMPARABLE", "FAMILY_COMPARABLE"].includes(row.classification)).map((row) => row.evidenceId))
  const evidence = input.evidence.filter((row) => allowedEvidence.has(row.evidenceId))
  const rawCandidates = unique([
    ...(canonicalFamily ? [normalize(canonicalFamily)] : []),
    ...input.canonical.fingerprint.coreProduct ? [input.canonical.fingerprint.coreProduct] : [],
    ...input.canonical.fingerprint.formFactor?.includes("wearable") &&
      input.canonical.fingerprint.coreProduct
      ? [`wearable ${input.canonical.fingerprint.coreProduct}`] : [],
    ...input.canonical.attributes.includes("rechargeable") && input.canonical.fingerprint.coreProduct
      ? [`rechargeable ${input.canonical.fingerprint.coreProduct}`] : [],
    ...input.canonical.attributes,
    ...evidence.flatMap((row) => phraseNgrams(row.title ?? "")),
  ]).slice(0, 200)
  const candidateMap = new Map<string, { phrase: string; sourcePhrases: string[];
    normalizationReasonCodes: string[]; rejectionReason: string | null }>()
  for (const rawPhrase of rawCandidates) {
    const normalizedPhrase = normalizeCommercialKeywordPhraseV2(rawPhrase, canonicalFamily)
    if (!normalizedPhrase.phrase) continue
    const current = candidateMap.get(normalizedPhrase.phrase)
    candidateMap.set(normalizedPhrase.phrase, {
      phrase: normalizedPhrase.phrase,
      sourcePhrases: unique([...(current?.sourcePhrases ?? []), normalize(rawPhrase)]),
      normalizationReasonCodes: unique([...(current?.normalizationReasonCodes ?? []),
        ...normalizedPhrase.reasonCodes]),
      rejectionReason: current?.rejectionReason ??
        (normalizedPhrase.status === "REJECT" ? normalizedPhrase.reasonCodes[0] : null),
    })
  }
  const entries = [...candidateMap.values()].map((candidate) => {
    const phrase = candidate.phrase
    const role = classifyKeywordRole(phrase, canonicalFamily, candidate.rejectionReason)
    const phraseWords = words(phrase)
    const familyWords = words(canonicalFamily)
    const supportingRows = evidence.filter((row) => {
      const titleWords = new Set(words(row.title))
      return phraseWords.every((word) => titleWords.has(word))
    })
    const sellers = new Set(supportingRows.map((row) => row.sellerReferenceHash).filter(Boolean)).size
    const productHeadCorrectness = phraseWords.some((word) => PRODUCT_HEADS.has(word)) ? 100 : 0
    const familySet = new Set(familyWords)
    const familyIdentity = familyWords.length
      ? phraseWords.filter((word) => familySet.has(word)).length / familyWords.length * 100 : 0
    const naturalOrderObserved = candidate.sourcePhrases.some((source) => source === phrase)
    const naturalPhrase = role === "REJECT" ? 0
      : naturalOrderObserved && phraseWords.length >= 2 && phraseWords.length <= 4 ? 95
        : phraseWords.length >= 2 && phraseWords.length <= 4 ? 55
          : phraseWords.length === 1 ? 30 : 40
    const productIntent = productHeadCorrectness && familyIdentity >= 60 ? 100
      : productHeadCorrectness ? 45 : 0
    const contaminationPenalty = role === "REJECT" ? 85 : role === "ATTRIBUTE" ? 40 : 0
    const genericPenalty = role === "GENERIC" ? 65 : 0
    const relevance = score(familyIdentity * .42 + productHeadCorrectness * .25 +
      naturalPhrase * .20 + productIntent * .13 -
      contaminationPenalty - genericPenalty)
    const categoryConsistency = supportingRows.filter((row) => row.categoryId).length
      / Math.max(1, supportingRows.length)
    const prominence = supportingRows.filter((row) => normalize(row.title).startsWith(normalize(phrase))).length
      / Math.max(1, supportingRows.length)
    const opportunity = role === "REJECT" || relevance < 35 ? 0 : score(
      relevance * .5 + Math.min(20, supportingRows.length * 5) + Math.min(10, sellers * 3) +
      prominence * 10 + categoryConsistency * 10,
    )
    return {
      phrase,
      role,
      KEYWORD_RELEVANCE_SCORE: relevance,
      KEYWORD_OPPORTUNITY_SCORE: opportunity,
      relevanceScore: relevance,
      opportunityScore: opportunity,
      independentComparableSupport: supportingRows.length,
      sellerDiversity: sellers,
      normalizedFrom: candidate.sourcePhrases,
      searchVolume: { status: "UNPROVEN" as const, value: null, source: null },
      reasonCodes: unique([
        ...(candidate.rejectionReason ? [candidate.rejectionReason] : []),
        ...candidate.normalizationReasonCodes,
        role === "REJECT" && !candidate.rejectionReason
          ? "UNNATURAL_OR_PRODUCT_HEAD_MISSING" : "SEMANTIC_ROLE_ASSIGNED",
        ...(role === "GENERIC" ? ["GENERIC_FRAGMENT_PENALTY"] : []),
        ...(role === "ATTRIBUTE" ? ["ATTRIBUTE_NOT_CORE_FAMILY"] : []),
        ...(!naturalOrderObserved ? ["NATURAL_COMMERCIAL_PHRASE_PENALTY"] : []),
        ...(supportingRows.length ? ["OBSERVED_COMPARABLE_SUPPORT"] : ["NO_INDEPENDENT_SUPPORT"]),
      ]),
    }
  }).sort((left, right) => right.opportunityScore - left.opportunityScore ||
    right.relevanceScore - left.relevanceScore || left.phrase.localeCompare(right.phrase))
  const accepted = entries.filter((row) => !["REJECT", "GENERIC", "ATTRIBUTE"].includes(row.role) &&
    row.relevanceScore >= 60 && row.independentComparableSupport > 0 &&
    words(row.phrase).some((word) => PRODUCT_HEADS.has(word)))
  const primary = accepted.find((row) => row.role === "CORE_PRODUCT" &&
    !/^\d/.test(row.phrase)) ?? null
  const secondary = accepted.filter((row) => row.phrase !== primary?.phrase).slice(0, 5)
  const attributeTerms = entries.filter((row) => (row.role === "ATTRIBUTE" ||
    (row.role === "POWER" && !words(row.phrase).some((word) => PRODUCT_HEADS.has(word)))) &&
    row.relevanceScore > 0)
  const rejected = entries.filter((row) => row.role === "REJECT" || row.relevanceScore < 35)
  return {
    engineVersion: "KEYWORD_INTELLIGENCE_V2",
    primaryKeyword: primary?.phrase ?? null,
    secondaryKeywords: secondary.map((row) => row.phrase),
    attributeTerms: attributeTerms.map((row) => row.phrase),
    rejectedTerms: rejected.slice(0, 30).map((row) => ({ phrase: row.phrase,
      rejectionReason: row.reasonCodes[0] })),
    keywords: entries.slice(0, 60),
    keywordOpportunity: primary ? (primary.opportunityScore >= 70 ? "HIGH" as const
      : primary.opportunityScore >= 45 ? "MEDIUM" as const : "LOW" as const) : "UNPROVEN" as const,
    searchVolume: { status: "UNPROVEN" as const, value: null, source: null },
    spine: { PRIMARY_KEYWORD: primary?.phrase ?? null,
      SECONDARY_KEYWORDS: secondary.map((row) => row.phrase),
      ATTRIBUTE_TERMS: attributeTerms.map((row) => row.phrase),
      REJECTED_TERMS: rejected.slice(0, 30).map((row) => row.phrase),
      REJECTION_REASON: rejected.slice(0, 30).map((row) => ({ term: row.phrase,
        reason: row.reasonCodes[0] })),
      REJECTION_REASONS: rejected.slice(0, 30).map((row) => ({ term: row.phrase,
        reason: row.reasonCodes[0] })),
      requiresProductTruth: true,
      absurdConcatenationsAllowed: false },
  }
}

function percentile(values: number[], quantile: number) {
  if (!values.length) return null
  const ordered = [...values].sort((left, right) => left - right)
  const position = (ordered.length - 1) * quantile
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const value = lower === upper ? ordered[lower]
    : ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)
  return Math.round(value * 100) / 100
}

function economics(input?: EconomicsEvidenceV1) {
  const supplier = typeof input?.supplierCost === "number" && input.supplierCost >= 0
    ? input.supplierCost : null
  const shipping = typeof input?.shippingCost === "number" && input.shippingCost >= 0
    ? input.shippingCost : null
  const fee = typeof input?.ebayFeeRate === "number" && input.ebayFeeRate >= 0 &&
    input.ebayFeeRate <= 1
    ? input.ebayFeeRate : null
  const promoted = typeof input?.promotedFeeRate === "number" && input.promotedFeeRate >= 0 &&
    input.promotedFeeRate <= 1
    ? input.promotedFeeRate : null
  const complete = supplier !== null && shipping !== null && fee !== null &&
    input?.promotedFeeComplete === true && promoted !== null
  return { status: complete ? "COMPLETE" as const : "UNPROVEN" as const,
    supplierCost: supplier, shippingCost: shipping, ebayFeeRate: fee,
    promotedFeeRate: promoted, missingCostsAssumedZero: false as const }
}

function buildPriceRepresentativenessV2(
  strict: MarketEvidenceV1[],
  currency: string | null,
) {
  const priced = strict.filter((row): row is MarketEvidenceV1 & { price: number } =>
    typeof row.price === "number" && Number.isFinite(row.price))
  const prices = priced.map((row) => row.price)
  const p25 = percentile(prices, .25)
  const p75 = percentile(prices, .75)
  const sampleSufficientForSignal = prices.length >= 4 && p25 !== null && p75 !== null &&
    currency !== null
  const iqr = sampleSufficientForSignal && p25 !== null && p75 !== null
    ? p75 - p25 : null
  const lowerFence = iqr === null || p25 === null ? null : p25 - iqr * 1.5
  const upperFence = iqr === null || p75 === null ? null : p75 + iqr * 1.5
  const assessments = priced.map((row) => {
    let state: PriceRepresentativenessStateV2 = "PRICE_OUTLIER_UNPROVEN"
    if (sampleSufficientForSignal && lowerFence !== null && row.price < lowerFence) {
      state = "PRICE_LOW_OUTLIER"
    } else if (sampleSufficientForSignal && upperFence !== null && row.price > upperFence) {
      state = "PRICE_HIGH_OUTLIER"
    } else if (sampleSufficientForSignal && p75 !== null && row.price > p75) {
      state = "PRICE_PREMIUM"
    } else if (sampleSufficientForSignal) {
      state = "PRICE_CORE_CLUSTER"
    }
    const possibleOutlier = ["PRICE_LOW_OUTLIER", "PRICE_HIGH_OUTLIER"].includes(state)
    return {
      evidenceId: row.evidenceId,
      itemId: row.itemId,
      title: row.title,
      price: row.price,
      currency: row.currency,
      physicalComparableClassification: "STRICT_COMPARABLE" as const,
      priceRepresentativeness: state,
      outlierAssessment: possibleOutlier
        ? "POSSIBLE_PRICE_OUTLIER" as const : "NO_OUTLIER_SIGNAL" as const,
      reasonCode: !sampleSufficientForSignal ? "TINY_SAMPLE_OUTLIER_UNPROVEN" as const
        : state === "PRICE_LOW_OUTLIER" ? "BELOW_IQR_LOWER_FENCE" as const
          : state === "PRICE_HIGH_OUTLIER" ? "ABOVE_IQR_UPPER_FENCE" as const
            : state === "PRICE_PREMIUM" ? "ABOVE_CORE_INTERQUARTILE_BAND" as const
              : "WITHIN_CORE_INTERQUARTILE_BAND" as const,
      removedFromPhysicalComparables: false as const,
    }
  })
  const outliers = assessments.filter((row) =>
    ["PRICE_LOW_OUTLIER", "PRICE_HIGH_OUTLIER"].includes(row.priceRepresentativeness))
  const coreEvidenceIds = new Set(assessments.filter((row) =>
    !outliers.some((outlier) => outlier.evidenceId === row.evidenceId)).map((row) => row.evidenceId))
  const corePrices = priced.filter((row) => coreEvidenceIds.has(row.evidenceId)).map((row) => row.price)
  const robustPrices = corePrices.length >= 3 ? corePrices : prices
  const robustCorePriceBand = sampleSufficientForSignal && robustPrices.length >= 3 ? {
    p25: percentile(robustPrices, .25),
    median: percentile(robustPrices, .5),
    p75: percentile(robustPrices, .75),
    range: { minimum: percentile(robustPrices, 0), maximum: percentile(robustPrices, 1) },
    currency,
    possibleOutliersExcludedFromRobustBandOnly: outliers.length,
  } : null
  return {
    engineVersion: "PRICE_REPRESENTATIVENESS_V2" as const,
    sampleSize: prices.length,
    tinySampleConservative: prices.length < 8,
    physicalComparabilityPreserved: true as const,
    assessments,
    ROBUST_CORE_PRICE_BAND: robustCorePriceBand,
    PRICE_OUTLIER_COUNT: outliers.length,
    PRICE_OUTLIER_LIST: outliers,
    PRICE_OUTLIER_REASON: !sampleSufficientForSignal
      ? "TINY_SAMPLE_OUTLIER_UNPROVEN" as const
      : outliers.length ? "POSSIBLE_IQR_OUTLIER_TINY_SAMPLE" as const
        : "NO_IQR_OUTLIER_SIGNAL" as const,
    robustCorePriceBand,
    priceOutlierCount: outliers.length,
    priceOutlierList: outliers,
    priceOutlierReason: !sampleSufficientForSignal
      ? "TINY_SAMPLE_OUTLIER_UNPROVEN" as const
      : outliers.length ? "POSSIBLE_IQR_OUTLIER_TINY_SAMPLE" as const
        : "NO_IQR_OUTLIER_SIGNAL" as const,
  }
}

export function buildPriceOpportunityV2(input: {
  evidence: MarketEvidenceV1[]
  comparables: Array<{ evidenceId: string; classification: ComparableFingerprintStateV2 }>
  economics?: EconomicsEvidenceV1
}) {
  const classification = new Map(input.comparables.map((row) => [row.evidenceId, row.classification]))
  const active = input.evidence.filter((row) => row.activeListing)
  const strict = active.filter((row) => classification.get(row.evidenceId) === "STRICT_COMPARABLE" &&
    typeof row.price === "number")
  const prices = strict.map((row) => row.price as number)
  const currencies = unique(strict.map((row) => row.currency).filter((value): value is string => Boolean(value)))
  const representativeness = buildPriceRepresentativenessV2(
    strict,
    currencies.length === 1 ? currencies[0] : null,
  )
  const cost = economics(input.economics)
  const median = percentile(prices, .5)
  const completeMarketAndEconomics = prices.length >= 3 && currencies.length === 1 &&
    cost.status === "COMPLETE" && median !== null
  const totalRate = cost.status === "COMPLETE"
    ? (cost.ebayFeeRate as number) + (cost.promotedFeeRate as number) : null
  const contribution = completeMarketAndEconomics && median !== null && totalRate !== null
    ? Math.round((median - median * totalRate - (cost.supplierCost as number) -
      (cost.shippingCost as number)) * 100) / 100 : null
  const marginConstrained = contribution !== null && contribution <= 0
  const recommended = completeMarketAndEconomics && !marginConstrained ? median : null
  return {
    status: prices.length ? "ACTIVE_MARKET_PRICE_AVAILABLE" as const : "UNPROVEN" as const,
    observedResults: active.length,
    strictComparables: strict.length,
    packMismatchExcluded: active.filter((row) => classification.get(row.evidenceId) === "PACK_MISMATCH").length,
    formFactorExcluded: active.filter((row) => classification.get(row.evidenceId) === "FORM_FACTOR_CONFLICT").length,
    priceBand: prices.length ? { p25: percentile(prices, .25), median, p75: percentile(prices, .75),
      range: { minimum: percentile(prices, 0), maximum: percentile(prices, 1) },
      currency: currencies.length === 1 ? currencies[0] : null } : null,
    priceRepresentativeness: representativeness,
    ROBUST_CORE_PRICE_BAND: representativeness.ROBUST_CORE_PRICE_BAND,
    PRICE_OUTLIER_COUNT: representativeness.PRICE_OUTLIER_COUNT,
    PRICE_OUTLIER_LIST: representativeness.PRICE_OUTLIER_LIST,
    PRICE_OUTLIER_REASON: representativeness.PRICE_OUTLIER_REASON,
    economics: { ...cost, contribution,
      margin: contribution !== null && median !== null && median > 0
        ? Math.round(contribution / median * 10_000) / 100 : null },
    recommendedEntryPrice: recommended,
    recommendationReason: marginConstrained ? "MARGIN_CONSTRAINED" as const
      : completeMarketAndEconomics ? "WITHIN_MARKET_BAND" as const
        : cost.status !== "COMPLETE" ? "ECONOMICS_UNPROVEN" as const
        : strict.length < 3 ? "STRICT_COMPARABLE_BREADTH_INSUFFICIENT" as const
          : "CURRENCY_CONFLICT" as const,
    activeAskNotSoldPrice: true as const,
    missingCostsAssumedZero: false as const,
  }
}

export function buildReferenceStrategyV1(input: {
  evidence: MarketEvidenceV1[]
  comparables: Array<{ evidenceId: string; classification: ComparableFingerprintStateV2;
    confidence: number; riskCodes: string[] }>
}) {
  const byId = new Map(input.evidence.map((row) => [row.evidenceId, row]))
  const ranked = input.comparables.map((assessment) => {
    const row = byId.get(assessment.evidenceId)
    const risks = unique([
      ...assessment.riskCodes,
      ...assessment.classification === "PACK_MISMATCH" ? ["PACK_COUNT_CONFLICT"] : [],
      ...assessment.classification === "FORM_FACTOR_CONFLICT" ? ["FORM_FACTOR_CONFLICT"] : [],
      ...row?.brand ? ["BRAND_IDENTITY_MUST_NOT_TRANSFER"] : [],
      ...row?.model || row?.mpn || row?.gtin ? ["MODEL_IDENTIFIER_MUST_NOT_TRANSFER"] : [],
      ...row?.itemId ? [] : ["REFERENCE_ITEM_ID_UNAVAILABLE"],
    ])
    const eligible = ["STRICT_COMPARABLE", "FAMILY_COMPARABLE"].includes(assessment.classification)
    const quality = score((assessment.classification === "STRICT_COMPARABLE" ? 70
      : assessment.classification === "FAMILY_COMPARABLE" ? 48 : 10) +
      Math.min(15, Object.keys(row?.itemSpecifics ?? {}).length * 3) +
      (row?.categoryId ? 10 : 0) + (row?.itemId ? 5 : 0) -
      risks.filter((risk) => /CONFLICT/.test(risk)).length * 25)
    const decision = !eligible || risks.some((risk) =>
      /(?:PACK_COUNT|FORM_FACTOR|VARIANT|CATEGORY)_CONFLICT/.test(risk))
      ? "REJECT" as const : quality >= 80 ? "USE_AS_REFERENCE" as const : "CANDIDATE" as const
    const tieBreak = {
      strictComparability: assessment.classification === "STRICT_COMPARABLE" ? 2
        : assessment.classification === "FAMILY_COMPARABLE" ? 1 : 0,
      categoryMatch: risks.includes("CATEGORY_CONFLICT") ? 0 : row?.categoryId ? 1 : 0,
      packMatch: risks.some((risk) => /PACK|BUNDLE/.test(risk)) ? 0 : 1,
      formFactorMatch: risks.includes("FORM_FACTOR_CONFLICT") ? 0 : 1,
      variantCompatibility: risks.some((risk) => /VARIANT/.test(risk)) ? 0 : 1,
      identityContaminationRisk: assessment.riskCodes.filter((risk) =>
        /BRAND_CONTAMINATION|MODEL_VARIANT|IDENTITY_CONFLICT/.test(risk)).length,
      aspectStructureCompleteness: Math.min(40, Object.keys(row?.itemSpecifics ?? {}).length),
      marketEvidenceQuality: assessment.confidence,
    }
    return {
      evidenceId: assessment.evidenceId,
      itemId: row?.itemId ?? null,
      title: row?.title ?? null,
      categoryId: row?.categoryId ?? null,
      REFERENCE_QUALITY_SCORE: quality,
      REFERENCE_STRUCTURE_QUALITY_SCORE: quality,
      REFERENCE_RISK_CODES: risks,
      REFERENCE_DECISION: decision,
      referenceQualityScore: quality,
      referenceStructureQualityScore: quality,
      scoreMeaning: "SELL_ONE_LIKE_THIS_STRUCTURAL_SUITABILITY_NOT_OVERALL_LISTING_QUALITY" as const,
      referenceRiskCodes: risks,
      referenceDecision: decision,
      tieBreak,
      handoff: decision === "REJECT" ? null : {
        mode: "SELL_ONE_LIKE_THIS_READ_ONLY_HANDOFF" as const,
        referenceItemId: row?.itemId ?? null,
        referenceCategory: { categoryId: row?.categoryId ?? null,
          categoryName: row?.categoryName ?? null },
        aspectSkeleton: Object.keys(row?.itemSpecifics ?? {}).slice(0, 40).map((name) => ({
          name, inheritedValue: null, classification: "REQUIRES_PRODUCT_TRUTH" as const,
        })),
        variationStructure: { status: "UNPROVEN" as const, inherited: false as const },
        listingFormatPolicyStructure: { status: "UNPROVEN" as const, inherited: false as const },
        safeStructureCandidates: ["CATEGORY_ID", "ASPECT_NAMES"],
        requiresProductTruth: ["ASPECT_VALUES", "PACK_QUANTITY", "COMPATIBILITY"],
        rejectedCompetitorIdentity: ["BRAND", "MODEL", "MPN", "UPC_GTIN"],
        rejectedCopyrightContent: ["IMAGES", "DESCRIPTION", "CLAIMS"],
        competitorContentCopied: false as const,
        ebayDraftCreated: false as const,
        ebayWrites: 0 as const,
      },
    }
  }).sort((left, right) => right.referenceStructureQualityScore - left.referenceStructureQualityScore ||
    right.tieBreak.strictComparability - left.tieBreak.strictComparability ||
    right.tieBreak.categoryMatch - left.tieBreak.categoryMatch ||
    right.tieBreak.packMatch - left.tieBreak.packMatch ||
    right.tieBreak.formFactorMatch - left.tieBreak.formFactorMatch ||
    right.tieBreak.variantCompatibility - left.tieBreak.variantCompatibility ||
    left.tieBreak.identityContaminationRisk - right.tieBreak.identityContaminationRisk ||
    right.tieBreak.aspectStructureCompleteness - left.tieBreak.aspectStructureCompleteness ||
    right.tieBreak.marketEvidenceQuality - left.tieBreak.marketEvidenceQuality ||
    String(left.itemId ?? left.evidenceId).localeCompare(String(right.itemId ?? right.evidenceId)) ||
    left.evidenceId.localeCompare(right.evidenceId))
  const eligible = ranked.filter((row) => row.referenceDecision !== "REJECT")
  const primaryId = eligible[0]?.evidenceId ?? null
  const runnerUpId = eligible[1]?.evidenceId ?? null
  const candidates = ranked.map((row, index) => ({ ...row,
    referenceRank: index + 1,
    referenceRole: row.evidenceId === primaryId ? "PRIMARY_REFERENCE" as const
      : row.evidenceId === runnerUpId ? "RUNNER_UP_REFERENCE" as const
        : row.referenceDecision === "REJECT" ? "REJECTED_REFERENCE" as const
          : "REFERENCE_CANDIDATE" as const }))
  return { engineVersion: "REFERENCE_STRATEGY_V1_TIEBREAK_V2" as const,
    candidates,
    selected: candidates.find((row) => row.referenceRole === "PRIMARY_REFERENCE") ?? null,
    primaryReference: candidates.find((row) => row.referenceRole === "PRIMARY_REFERENCE") ?? null,
    runnerUpReference: candidates.find((row) => row.referenceRole === "RUNNER_UP_REFERENCE") ?? null,
    tieBreakPolicy: ["STRICT_COMPARABILITY", "CATEGORY_MATCH", "PACK_MATCH",
      "FORM_FACTOR_MATCH", "VARIANT_COMPATIBILITY", "IDENTITY_CONTAMINATION_RISK",
      "ASPECT_STRUCTURE_COMPLETENESS", "MARKET_EVIDENCE_QUALITY", "STABLE_ITEM_ID"],
  competitorContentCopied: false as const, ebayWrites: 0 as const }
}

function band(value: number) {
  return value >= 70 ? "HIGH" as const : value >= 45 ? "MEDIUM" as const : "LOW" as const
}

export function buildCommercialIntelligenceUpgradeV1(input: {
  request: MarketResearchRequestV1
  evidence: MarketEvidenceV1[]
  sourceItemId?: string | null
  observedResultCount?: number
  searchResultCap?: number
  supplier?: SupplierEvidenceV1
  economics?: EconomicsEvidenceV1
}) {
  const sourceListing = input.sourceItemId
    ? input.evidence.find((row) => row.itemId === input.sourceItemId) ?? null : null
  const marketEvidence = input.evidence.filter((row) =>
    !input.sourceItemId || row.itemId !== input.sourceItemId)
  const duplicateItemIds = new Set<string>()
  const duplicateResultSignatures = new Set<string>()
  const deduped = marketEvidence.filter((row) => {
    const itemId = clean(row.itemId, 40)
    const signature = `${normalize(row.title)}:${row.sellerReferenceHash ?? "unknown"}`
    if ((itemId && duplicateItemIds.has(itemId)) ||
        duplicateResultSignatures.has(signature)) {
      return false
    }
    if (itemId) duplicateItemIds.add(itemId)
    duplicateResultSignatures.add(signature)
    return true
  })
  const consensus = buildMultiSeedConsensusV1({ request: input.request, sourceListing,
    evidence: deduped })
  const seedCanonical = resolveCanonicalProductFamilyV1({
    seedValue: input.request.seedValue,
    title: sourceListing?.title ?? (input.request.seedType === "SEED_PRODUCT_TITLE"
      ? input.request.seedValue : null),
    categoryId: sourceListing?.categoryId ?? input.request.seedIdentity.categoryId,
    categoryName: sourceListing?.categoryName ?? input.request.seedIdentity.categoryName,
    itemSpecifics: sourceListing?.itemSpecifics,
    packCount: sourceListing?.packCount ?? input.request.seedIdentity.packCount,
    brand: sourceListing?.brand ?? input.request.seedIdentity.brand,
    model: sourceListing?.model ?? input.request.seedIdentity.model,
  })
  const canonical = seedCanonical.canonicalFamily ? seedCanonical
    : consensus.canonicalFamily && consensus.familyConfidence >= 70
      ? resolveCanonicalProductFamilyV1({ seedValue: consensus.canonicalFamily,
          categoryId: input.request.seedIdentity.categoryId,
          categoryName: input.request.seedIdentity.categoryName,
          packCount: input.request.seedIdentity.packCount })
      : seedCanonical
  const comparables = deduped.map((evidence) => ({ evidence,
    assessment: classifyStrictComparableV2({ canonical, seed: input.request.seedIdentity, evidence }) }))
  const comparableDtos = comparables.map((row) => ({ evidenceId: row.evidence.evidenceId,
    itemId: row.evidence.itemId, title: row.evidence.title, price: row.evidence.price,
    currency: row.evidence.currency, classification: row.assessment.classification,
    confidence: row.assessment.confidence, strictPricingEligible: row.assessment.strictPricingEligible,
    referenceEligible: row.assessment.referenceEligible, expected: row.assessment.expected,
    observed: row.assessment.observed, riskCodes: row.assessment.riskCodes,
    reasonCodes: row.assessment.reasonCodes }))
  const keyword = buildKeywordIntelligenceV2({ canonical, evidence: deduped,
    comparables: comparableDtos })
  const price = buildPriceOpportunityV2({ evidence: deduped, comparables: comparableDtos,
    economics: input.economics })
  const reference = buildReferenceStrategyV1({ evidence: deduped, comparables: comparableDtos })
  const active = deduped.filter((row) => row.activeListing)
  const strict = comparableDtos.filter((row) => row.classification === "STRICT_COMPARABLE")
  const family = comparableDtos.filter((row) => row.classification === "FAMILY_COMPARABLE")
  const sold = deduped.filter((row) => row.confirmedSold && (row.confirmedSoldQuantity ?? 0) > 0)
  const sellerDiversity = new Set(active.map((row) => row.sellerReferenceHash).filter(Boolean)).size
  const categoryConsistency = active.length ? active.filter((row) => row.categoryId &&
    (!input.request.seedIdentity.categoryId || row.categoryId === input.request.seedIdentity.categoryId)).length /
    active.length * 100 : 0
  const primaryKeywordScore = keyword.keywords.find((row) => row.phrase === keyword.primaryKeyword)
    ?.opportunityScore ?? 0
  const referenceScore = reference.selected?.referenceQualityScore ?? 0
  const components = {
    canonicalFamilyConfidence: canonical.confidence,
    strictComparableQuality: strict.length ? strict.reduce((sum, row) => sum + row.confidence, 0) / strict.length : 0,
    activeMarketBreadth: score(Math.min(100, active.length * 14)),
    keywordOpportunity: primaryKeywordScore,
    priceBandStructure: price.priceBand ? score(55 + Math.min(45, strict.length * 9)) : 0,
    sellerResultDiversity: score(Math.min(100, sellerDiversity * 20)),
    competitionEvidenceCompleteness: score(Math.min(100, active.length * 10)),
    categoryConsistency: score(categoryConsistency),
    referenceQuality: referenceScore,
  }
  const attractivenessScore = score(
    components.canonicalFamilyConfidence * .18 + components.strictComparableQuality * .18 +
    components.activeMarketBreadth * .12 + components.keywordOpportunity * .12 +
    components.priceBandStructure * .10 + components.sellerResultDiversity * .08 +
    components.competitionEvidenceCompleteness * .07 + components.categoryConsistency * .07 +
    components.referenceQuality * .08,
  )
  const activeEvidenceSufficient = canonical.confidence >= 70 && active.length >= 3 &&
    strict.length + family.length >= 2
  const demandValidation = sold.length ? { status: "PARTIAL" as const,
    verifiedSoldListings: sold.length } : { status: "UNPROVEN" as const,
    verifiedSoldListings: 0 }
  const nextEvidence = unique([
    ...canonical.confidence < 70 ? ["NEED_PRODUCT_TRUTH"] : [],
    ...strict.length < 2 ? ["NEED_STRICT_COMPARABLE_BREADTH"] : [],
    ...input.supplier?.identityStatus !== "EXACT_PROVEN" ? ["NEED_EXACT_SUPPLIER_MATCH"] : [],
    ...input.supplier?.stockStatus === undefined || ["UNKNOWN", "STALE_EVIDENCE"].includes(input.supplier.stockStatus)
      ? ["NEED_STOCK_EVIDENCE"] : [],
    ...price.economics.status !== "COMPLETE" ? ["NEED_ECONOMICS"] : [],
    ...!reference.selected ? ["NEED_REFERENCE_REVIEW"] : [],
    ...!sold.length ? ["NEED_VERIFIED_SOLD_EVIDENCE"] : [],
  ])
  const identityConflict = canonical.conflicts.length > 0 || consensus.conflicts.length > 0 ||
    input.supplier?.identityStatus === "CONFLICT"
  let finalDecision: "ADVANCE_TO_SUPPLIER_VALIDATION" | "ADVANCE_TO_ECONOMICS" |
    "ADVANCE_TO_PRODUCT_CASE_READINESS" | "HOLD" | "RESEARCH_REQUIRED" | "REJECT" | "HUMAN_REVIEW"
  let nextBestAction: string
  if (identityConflict) {
    finalDecision = "HUMAN_REVIEW"
    nextBestAction = "RESOLVE_IDENTITY_OR_PRODUCT_TRUTH_CONFLICT"
  } else if (canonical.confidence < 70 || strict.length < 2) {
    finalDecision = "RESEARCH_REQUIRED"
    nextBestAction = nextEvidence[0] ?? "NEED_STRICT_COMPARABLE_BREADTH"
  } else if (input.supplier?.identityStatus !== "EXACT_PROVEN") {
    finalDecision = "ADVANCE_TO_SUPPLIER_VALIDATION"
    nextBestAction = "NEED_EXACT_SUPPLIER_MATCH"
  } else if (price.economics.status !== "COMPLETE") {
    finalDecision = "ADVANCE_TO_ECONOMICS"
    nextBestAction = "NEED_ECONOMICS"
  } else {
    finalDecision = "ADVANCE_TO_PRODUCT_CASE_READINESS"
    nextBestAction = reference.selected ? "REVIEW_READ_ONLY_REFERENCE_HANDOFF" : "NEED_REFERENCE_REVIEW"
  }
  const researchPriority = attractivenessScore >= 70 ? "HIGH" as const
    : attractivenessScore >= 45 ? "MEDIUM" as const : "LOW" as const
  const commercialRecommendation = {
    productFamily: canonical.canonicalFamily,
    canonicalFamilyConfidence: canonical.confidence,
    primaryKeyword: keyword.primaryKeyword,
    secondaryKeywords: keyword.secondaryKeywords,
    keywordOpportunity: keyword.keywordOpportunity,
    searchVolume: "UNPROVEN" as const,
    strictComparables: strict.length,
    observedActiveMarket: input.observedResultCount ?? active.length,
    marketCompetitionTotal: "UNPROVEN" as const,
    priceBand: price.priceBand,
    robustCorePriceBand: price.ROBUST_CORE_PRICE_BAND,
    median: price.priceBand?.median ?? null,
    recommendedEntryPrice: price.recommendedEntryPrice,
    activeMarketAttractiveness: activeEvidenceSufficient
      ? band(attractivenessScore) : "UNPROVEN" as const,
    activeMarketAttractivenessScore: activeEvidenceSufficient ? attractivenessScore : null,
    demandValidation: demandValidation.status,
    supplierMatch: input.supplier?.identityStatus ?? "UNPROVEN",
    stock: input.supplier?.stockStatus ?? "UNKNOWN",
    economics: price.economics.status,
    referenceListing: reference.selected?.itemId ?? null,
    referenceStructureQuality: reference.selected?.referenceStructureQualityScore ?? null,
    referenceQuality: reference.selected?.referenceStructureQualityScore ?? null,
    useAsReference: reference.selected?.referenceDecision ?? "UNPROVEN",
    finalDecision,
    nextBestAction,
    reasonCodes: unique([finalDecision, nextBestAction, ...nextEvidence.slice(0, 3)]),
  }
  const versions = {
    analysisVersion: "ONE_BUTTON_OPPORTUNITY_ANALYSIS_V2" as const,
    canonicalResultVersion: CANONICAL_OPPORTUNITY_RESULT_VERSION_V2,
    seedResolutionVersion: "MULTI_SEED_CONSENSUS_V1" as const,
    comparableVersion: "STRICT_COMPARABLE_V2" as const,
    keywordVersion: "KEYWORD_INTELLIGENCE_V2_NORMALIZED" as const,
    priceVersion: "PRICE_OPPORTUNITY_V2_REPRESENTATIVENESS" as const,
    referenceVersion: "REFERENCE_STRATEGY_V1_TIEBREAK_V2" as const,
    decisionVersion: CANONICAL_OPPORTUNITY_DECISION_VERSION_V2,
  }
  const decisionClassification = identityConflict ? "HUMAN_REVIEW" as const
    : ["ADVANCE_TO_SUPPLIER_VALIDATION", "ADVANCE_TO_ECONOMICS", "RESEARCH_REQUIRED"]
        .includes(finalDecision) ? "RESEARCH_OR_EVIDENCE" as const
      : finalDecision === "ADVANCE_TO_PRODUCT_CASE_READINESS"
        ? "ACTIONABLE_COMMERCIAL" as const : "WAIT" as const
  const decisionIntegration = {
    contractVersion: CANONICAL_OPPORTUNITY_DECISION_VERSION_V2,
    sourceItemId: input.sourceItemId ?? null,
    entityKey: input.sourceItemId ??
      `opportunity:${hash(`${canonical.canonicalFamily ?? "unproven"}:${input.request.seedValue}`).slice(0, 24)}`,
    canonicalFamily: canonical.canonicalFamily,
    canonicalFamilyConfidence: canonical.confidence,
    classification: decisionClassification,
    finalDecision,
    nextBestAction,
    priority: researchPriority,
    severity: identityConflict ? "HIGH" as const
      : researchPriority === "HIGH" ? "HIGH" as const : "MEDIUM" as const,
    confidence: canonical.confidence >= 85 ? "HIGH" as const
      : canonical.confidence >= 70 ? "MEDIUM" as const : "LOW" as const,
    reasonCodes: unique([
      "CANONICAL_OPPORTUNITY_RESULT_V2",
      ...(nextBestAction === "NEED_EXACT_SUPPLIER_MATCH"
        ? ["SUPPLIER_VALIDATION_REQUIRED"] : []),
      ...(researchPriority === "HIGH" ? ["HIGH_RESEARCH_PRIORITY"] : []),
      finalDecision,
      nextBestAction,
    ]),
    observedEvidence: {
      activeMarketAttractiveness: activeEvidenceSufficient ? attractivenessScore : null,
      keywordOpportunity: keyword.keywordOpportunity,
      strictComparableCount: strict.length,
      observedActiveMarket: input.observedResultCount ?? active.length,
      supplierMatch: input.supplier?.identityStatus ?? "UNPROVEN",
      stock: input.supplier?.stockStatus ?? "UNKNOWN",
      economics: price.economics.status,
    },
    nextReviewCondition: nextBestAction,
    precedencePolicy: "CRITICAL_OR_IDENTITY_OR_PROVEN_QUALITY_BEFORE_CANONICAL_OPPORTUNITY" as const,
    legacyEvidenceBlockerMayOverride: false as const,
    actionExecutionAllowed: false as const,
  }
  const canonicalOpportunityCase = {
    contractVersion: "CANONICAL_OPPORTUNITY_CASE_V2" as const,
    authoritativeResultVersion: CANONICAL_OPPORTUNITY_RESULT_VERSION_V2,
    canonicalFamily: canonical.canonicalFamily,
    canonicalFamilyConfidence: canonical.confidence,
    commercialRecommendation,
    comparableClassifications: comparableDtos,
    keywordIntelligence: keyword,
    priceIntelligence: price,
    referenceStrategy: reference,
    nextBestEvidence: { priority: nextEvidence[0] ?? null, ordered: nextEvidence },
    productCaseCreated: false as const,
  }
  const canonicalResult = {
    authoritative: true as const,
    label: "Commercial Recommendation V2" as const,
    versions,
    sourceItemId: input.sourceItemId ?? null,
    canonicalFamily: canonical,
    consensus,
    commercialRecommendation,
    comparables: comparableDtos,
    competition: {
      OBSERVED_ACTIVE_RESULTS: input.observedResultCount ?? active.length,
      STRICT_COMPARABLE_COUNT: strict.length,
      FAMILY_COMPARABLE_COUNT: family.length,
      NEAR_DUPLICATE_RESULTS_EXCLUDED: marketEvidence.length - deduped.length,
      SEARCH_RESULT_COVERAGE:
        `BOUNDED:${input.observedResultCount ?? active.length}/${input.searchResultCap ?? 50}`,
      SEARCH_RESULT_CAP: input.searchResultCap ?? 50,
      MARKETPLACE_COMPETITION_TOTAL: { status: "UNPROVEN" as const, value: null },
      sampleSizeIsMarketplaceTotal: false as const,
    },
    keywordIntelligence: keyword,
    priceOpportunity: price,
    referenceStrategy: reference,
    activeMarketAttractiveness: { status: activeEvidenceSufficient
      ? "CALCULATED_FROM_ACTIVE_MARKET" as const : "UNPROVEN" as const,
      score: activeEvidenceSufficient ? attractivenessScore : null,
      band: activeEvidenceSufficient ? band(attractivenessScore) : "UNPROVEN" as const,
      components, salesProbability: { status: "NOT_CALCULATED" as const, value: null },
      isSalesProbability: false as const },
    demandValidation,
    salesProbability: { status: "NOT_CALCULATED" as const, value: null },
    researchPriority,
    nextBestEvidence: { priority: nextEvidence[0] ?? null, ordered: nextEvidence,
      deterministicResearchCanContinue: !identityConflict && nextEvidence.length > 0 },
    opportunityCase: canonicalOpportunityCase,
    decisionIntegration,
    legacyDiagnosticsPolicy: { allowedAsProvenance: true as const,
      authoritative: false as const, mayOverrideCanonicalResult: false as const,
      primarySurfaceVisible: false as const },
  }
  return {
    contractVersion: EBAY_COMMERCIAL_INTELLIGENCE_UPGRADE_VERSION,
    analysisVersion: versions.analysisVersion,
    canonicalResultVersion: versions.canonicalResultVersion,
    workflow: "ONE_BUTTON_OPPORTUNITY_ANALYSIS" as const,
    canonicalResult,
    canonicalFamily: canonical,
    consensus,
    comparables: comparableDtos,
    competition: {
      OBSERVED_ACTIVE_RESULTS: input.observedResultCount ?? active.length,
      STRICT_COMPARABLE_COUNT: strict.length,
      FAMILY_COMPARABLE_COUNT: family.length,
      NEAR_DUPLICATE_RESULTS_EXCLUDED: marketEvidence.length - deduped.length,
      SEARCH_RESULT_COVERAGE:
        `BOUNDED:${input.observedResultCount ?? active.length}/${input.searchResultCap ?? 50}`,
      SEARCH_RESULT_CAP: input.searchResultCap ?? 50,
      MARKETPLACE_COMPETITION_TOTAL: { status: "UNPROVEN" as const, value: null },
      sampleSizeIsMarketplaceTotal: false as const,
    },
    keywordIntelligence: keyword,
    priceOpportunity: price,
    referenceStrategy: reference,
    activeMarketAttractiveness: { status: activeEvidenceSufficient
      ? "CALCULATED_FROM_ACTIVE_MARKET" as const : "UNPROVEN" as const,
      score: activeEvidenceSufficient ? attractivenessScore : null,
      band: activeEvidenceSufficient ? band(attractivenessScore) : "UNPROVEN" as const,
      components, salesProbability: { status: "NOT_CALCULATED" as const, value: null },
      isSalesProbability: false as const },
    demandValidation,
    salesProbability: { status: "NOT_CALCULATED" as const, value: null },
    researchPriority,
    nextBestEvidence: { priority: nextEvidence[0] ?? null, ordered: nextEvidence,
      deterministicResearchCanContinue: !identityConflict && nextEvidence.length > 0 },
    commercialRecommendation,
    decisionPolicy: {
      sufficientEvidence: "DECIDE",
      partialEvidence: "PRIORITIZE_NEXT_RESEARCH",
      identityOrProductTruthConflict: "HUMAN_REVIEW",
      externalMarketplaceWrite: "HUMAN_APPROVAL",
      humanReviewCatchAll: false as const,
    },
    batchReadiness: buildOpportunityBatchPlanV1({ candidateCount: 1 }),
    safety: { executionMode: "READ_ONLY" as const, ebayWrites: 0 as const,
      inventoryWrites: 0 as const, fulfillmentWrites: 0 as const,
      registryBusinessDataMutations: 0 as const, productCaseMutations: 0 as const,
      buyerMessages: 0 as const, whatsappSends: 0 as const,
      externalExecutionRequiresHumanApproval: true as const },
  }
}

export function buildOpportunityBatchPlanV1(input: {
  candidateCount: number
  requestedConcurrency?: number
  checkpointCursor?: string | null
}) {
  const candidateCount = Math.max(0, Math.min(100_000, Math.floor(input.candidateCount)))
  const concurrency = Math.max(1, Math.min(OPPORTUNITY_BATCH_MAX_CONCURRENCY,
    Math.floor(input.requestedConcurrency ?? OPPORTUNITY_BATCH_MAX_CONCURRENCY)))
  return {
    status: "READY" as const,
    candidateCount,
    boundedConcurrency: concurrency,
    chunkSize: OPPORTUNITY_BATCH_CHUNK_SIZE,
    maxMarketplaceQueriesPerCandidate: OPPORTUNITY_QUERY_MAX_PER_CANDIDATE,
    maximumConcurrentMarketplaceCalls: concurrency,
    totalChunks: Math.ceil(candidateCount / OPPORTUNITY_BATCH_CHUNK_SIZE),
    priorityQueue: "EVIDENCE_VALUE_AND_EXCEPTION_PRIORITY",
    cache: "NORMALIZED_SEED_AND_FAMILY_FINGERPRINT",
    dedupe: "CANONICAL_FAMILY_AND_QUERY_FINGERPRINT",
    rateLimitAwareness: true as const,
    incrementalReads: true as const,
    resumeSupported: true as const,
    checkpointCursor: input.checkpointCursor ?? null,
    staleEvidencePromotion: true as const,
    uncontrolledMarketplaceBurst: false as const,
    marketplaceWrites: 0 as const,
  }
}

export function deriveItemIdCanonicalFamilyBridgeV1(input: {
  itemId: string
  evidence: MarketEvidenceV1[]
}) {
  const source = input.evidence.find((row) => row.itemId === input.itemId) ?? null
  const family = source ? resolveCanonicalProductFamilyV1({ seedValue: input.itemId,
    title: source.title, categoryId: source.categoryId, categoryName: source.categoryName,
    itemSpecifics: source.itemSpecifics, packCount: source.packCount,
    brand: source.brand, model: source.model }) : resolveCanonicalProductFamilyV1({ seedValue: input.itemId })
  return {
    itemId: input.itemId,
    authoritativeListingResolved: Boolean(source),
    listingTruth: source ? { title: source.title, categoryId: source.categoryId,
      categoryName: source.categoryName, itemSpecifics: source.itemSpecifics,
      packCount: source.packCount, brand: source.brand, model: source.model } : null,
    candidateCanonicalFamily: family.canonicalFamily,
    confidence: family.confidence,
    candidates: family.candidates,
    marketExpansion: family.canonicalFamily && family.confidence >= 70
      ? { status: "READY" as const, query: family.canonicalFamily,
        excludeSourceItemId: input.itemId } : { status: "HUMAN_SELECTION_REQUIRED" as const,
        query: null, excludeSourceItemId: input.itemId },
    sourceListingMayCountAsIndependentMarketEvidence: false as const,
    evidenceSourcesUsed: source
      ? ["TITLE", "CATEGORY", "ITEM_SPECIFICS", "PACK_COUNT", "BRAND_MODEL"].filter((key) => {
        if (key === "CATEGORY") return Boolean(source.categoryId || source.categoryName)
        if (key === "ITEM_SPECIFICS") return Object.keys(source.itemSpecifics).length > 0
        if (key === "PACK_COUNT") return source.packCount !== null
        if (key === "BRAND_MODEL") return Boolean(source.brand || source.model)
        return Boolean(source.title)
      }) : [],
  }
}

export function commercialIntelligenceFingerprintV1(value: unknown) {
  return `sha256:${hash(JSON.stringify(value))}`
}

export type CommercialIntelligenceUpgradeV1 = ReturnType<
  typeof buildCommercialIntelligenceUpgradeV1
>
export type CanonicalOpportunityResultV2 =
  CommercialIntelligenceUpgradeV1["canonicalResult"]
export type CanonicalOpportunityDecisionV2 =
  CanonicalOpportunityResultV2["decisionIntegration"]
export type ItemIdCanonicalFamilyBridgeV1 = ReturnType<
  typeof deriveItemIdCanonicalFamilyBridgeV1
>
