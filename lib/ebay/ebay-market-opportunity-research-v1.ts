import { createHash } from "node:crypto"

// @ts-expect-error Node's strip-types test runner requires the explicit extension.
import { parseOfficialSoldEvidenceImport, type OfficialSoldEvidenceExport, type OfficialSoldEvidenceFormat } from "./ebay-official-sold-evidence-import.ts"
import type { EbaySellerKeywordDemandReport } from
  "./ebay-seller-keyword-demand-validation.ts"
// @ts-expect-error Node's strip-types test runner requires the explicit extension.
import { resolveCanonicalProductFamilyV1 } from "./ebay-commercial-intelligence-upgrade-v1.ts"

export const MARKET_OPPORTUNITY_RESEARCH_VERSION =
  "EBAY_MARKET_OPPORTUNITY_RESEARCH_V1_2026_08_11"
export const MARKET_RESEARCH_QUERY_BUDGET_MAX = 5
export const MARKET_RESEARCH_RESULT_LIMIT = 50

export type MarketResearchCapabilityStatus =
  | "AVAILABLE" | "PARTIAL" | "RESTRICTED" | "UNAVAILABLE" | "UNPROVEN"
export type MarketResearchSeedType =
  | "SEED_AUTO" | "SEED_QUERY" | "SEED_ITEM_ID" | "SEED_PRODUCT_TITLE"
  | "SEED_PRODUCT_FAMILY" | "PRODUCT_CASE_CANDIDATE"
export type MarketResearchEvidenceSource =
  | "EBAY_BROWSE_ACTIVE_LISTING"
  | "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE"
  | "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY"
  | "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE"
  | "MANUAL_MARKET_EVIDENCE"

export const EBAY_MARKET_RESEARCH_SOURCE_CAPABILITIES_V1 = Object.freeze([
  { capability: "ACTIVE_MARKET_LISTINGS", status: "AVAILABLE", source: "EBAY_BROWSE_ITEM_SUMMARY_SEARCH", grain: "ACTIVE_PURCHASABLE_LISTING", limitations: ["PRODUCTION_BUY_API_ENTITLEMENT_REQUIRED"], pagination: "OFFSET_LIMIT_BOUNDED", historicalWindow: null },
  { capability: "COMPETITOR_LISTING_TITLE", status: "AVAILABLE", source: "EBAY_BROWSE", grain: "LISTING", limitations: [], pagination: "OFFSET_LIMIT_BOUNDED", historicalWindow: null },
  { capability: "COMPETITOR_PRICE", status: "AVAILABLE", source: "EBAY_BROWSE", grain: "ACTIVE_ASKING_PRICE", limitations: ["NOT_SOLD_PRICE"], pagination: "OFFSET_LIMIT_BOUNDED", historicalWindow: null },
  { capability: "COMPETITOR_CATEGORY", status: "AVAILABLE", source: "EBAY_BROWSE", grain: "LISTING_CATEGORY", limitations: [], pagination: "OFFSET_LIMIT_BOUNDED", historicalWindow: null },
  { capability: "COMPETITOR_ITEM_SPECIFICS", status: "PARTIAL", source: "EBAY_BROWSE_ITEM_DETAIL", grain: "BOUNDED_DETAIL_SAMPLE", limitations: ["DETAIL_SAMPLE_MAX_5"], pagination: "NOT_APPLICABLE", historicalWindow: null },
  { capability: "COMPETITOR_IMAGES", status: "AVAILABLE", source: "EBAY_BROWSE", grain: "LISTING_IMAGE_REFERENCE", limitations: ["NO_IMAGE_COPY_OR_PERSISTENCE"], pagination: "OFFSET_LIMIT_BOUNDED", historicalWindow: null },
  { capability: "COMPLETED_LISTINGS", status: "RESTRICTED", source: "EBAY_MARKETPLACE_INSIGHTS_OR_REVIEWED_IMPORT", grain: "COMPLETED_LISTING", limitations: ["MARKETPLACE_INSIGHTS_NOT_OPEN_TO_NEW_USERS"], pagination: "SOURCE_DEPENDENT", historicalWindow: "SOURCE_DEPENDENT" },
  { capability: "SOLD_LISTINGS", status: "RESTRICTED", source: "EBAY_MARKETPLACE_INSIGHTS_OR_REVIEWED_IMPORT", grain: "CONFIRMED_SALE", limitations: ["ENTITLEMENT_OR_REVIEWED_IMPORT_REQUIRED"], pagination: "SOURCE_DEPENDENT", historicalWindow: "UP_TO_90_DAYS_WHEN_PROVEN" },
  { capability: "SOLD_QUANTITY", status: "PARTIAL", source: "EBAY_MARKETPLACE_INSIGHTS_OR_REVIEWED_IMPORT", grain: "CONFIRMED_SOLD_QUANTITY", limitations: ["ACTIVE_BROWSE_ESTIMATE_IS_NOT_VERIFIED_SOLD_HISTORY"], pagination: "SOURCE_DEPENDENT", historicalWindow: "SOURCE_DEPENDENT" },
  { capability: "SOLD_PRICE", status: "PARTIAL", source: "EBAY_MARKETPLACE_INSIGHTS_OR_REVIEWED_IMPORT", grain: "SOLD_LISTING_PRICE", limitations: ["NEVER_MIXED_WITH_ACTIVE_ASKING_PRICE"], pagination: "SOURCE_DEPENDENT", historicalWindow: "SOURCE_DEPENDENT" },
  { capability: "SALE_DATE_RECENCY", status: "PARTIAL", source: "EBAY_MARKETPLACE_INSIGHTS_OR_REVIEWED_IMPORT", grain: "SALE_OBSERVATION", limitations: ["SOURCE_TIMESTAMP_REQUIRED"], pagination: "SOURCE_DEPENDENT", historicalWindow: "SOURCE_DEPENDENT" },
  { capability: "SELLER_INFO", status: "PARTIAL", source: "EBAY_BROWSE", grain: "SAFE_SELLER_METADATA", limitations: ["RAW_SELLER_ID_NOT_REQUIRED_BY_OPPORTUNITY_CASE"], pagination: "OFFSET_LIMIT_BOUNDED", historicalWindow: null },
  { capability: "CATEGORY_ASPECTS", status: "AVAILABLE", source: "EBAY_COMMERCE_TAXONOMY", grain: "LEAF_CATEGORY", limitations: ["CATEGORY_ID_REQUIRED"], pagination: "NOT_APPLICABLE", historicalWindow: null },
  { capability: "SEARCH_VOLUME", status: "UNAVAILABLE", source: "NONE", grain: "UNAVAILABLE", limitations: ["NO_AUTHORIZED_SEARCH_VOLUME_SOURCE"], pagination: "NOT_APPLICABLE", historicalWindow: null },
  { capability: "90_DAY_SOLD_HISTORY", status: "PARTIAL", source: "EBAY_MARKETPLACE_INSIGHTS_OR_REVIEWED_IMPORT", grain: "CONFIRMED_SALE_WITH_DATE", limitations: ["RESTRICTED_API_OR_HUMAN_REVIEWED_IMPORT_REQUIRED"], pagination: "SOURCE_DEPENDENT", historicalWindow: "90_DAYS_ONLY_WHEN_SOURCE_PROVES_WINDOW" },
] as const)

export type MarketResearchRequestV1 = {
  marketplace: "EBAY_US"
  seedType: MarketResearchSeedType
  seedValue: string
  requestedWindowDays: 30 | 90 | 365
  researchIntent: "FAMILY_DISCOVERY" | "OPPORTUNITY_VALIDATION" | "KEYWORD_EVIDENCE"
  queryBudget: number
  seedIdentity: {
    categoryId: string | null
    categoryName: string | null
    brand: string | null
    gtin: string | null
    mpn: string | null
    model: string | null
    packCount: number | null
    size: string | null
    color: string | null
  }
}

export type MarketEvidenceV1 = {
  evidenceId: string
  itemId: string | null
  title: string | null
  categoryId: string | null
  categoryName: string | null
  brand: string | null
  gtin: string | null
  mpn: string | null
  model: string | null
  packCount: number | null
  size: string | null
  color: string | null
  condition: string | null
  price: number | null
  currency: string | null
  shippingCost: number | null
  imageUrl: string | null
  itemSpecifics: Record<string, string>
  keywordSignals: string[]
  activeListing: boolean
  confirmedSold: boolean
  confirmedSoldQuantity: number | null
  saleObservedAt: string | null
  observedAt: string
  source: MarketResearchEvidenceSource
  sourceVersion: string
  evidenceCompleteness: "COMPLETE" | "PARTIAL" | "UNPROVEN"
  sellerReferenceHash: string | null
}

export type ComparableClassV1 =
  | "EXACT_OR_STRONG_COMPARABLE" | "PRODUCT_FAMILY_COMPARABLE"
  | "WEAK_COMPARABLE" | "NOT_COMPARABLE" | "UNPROVEN"

const STOP = new Set([
  "a", "an", "and", "at", "best", "by", "ebay", "for", "free", "from",
  "in", "new", "of", "on", "or", "sale", "shipping", "the", "to", "with",
])
const PACK_TERMS = new Set(["pack", "set", "bundle", "kit", "count", "ct", "pcs", "piece"])
const USE_TERMS = new Set(["use", "travel", "home", "office", "car", "outdoor"])
const BENEFIT_TERMS = new Set(["portable", "fast", "easy", "quiet", "compact", "durable"])
const AUDIENCE_TERMS = new Set(["men", "women", "kids", "adult", "baby", "pet"])
const FORM_TERMS = new Set(["spray", "gel", "fan", "holder", "case", "bottle", "adapter"])

function text(value: unknown, maximum = 240) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum) || null
    : null
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function integer(value: unknown) {
  const parsed = numberValue(value)
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalize(value: unknown) {
  return (text(value) ?? "").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ").trim()
}

function tokens(value: unknown) {
  return normalize(value).split(/\s+/).filter((token) =>
    token.length > 1 && !STOP.has(token))
}

function unique<T>(values: T[]) {
  return [...new Set(values)]
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function boundedScore(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)) * 100) / 100
}

function percentile(values: number[], quantile: number) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const position = (sorted.length - 1) * quantile
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const result = lower === upper ? sorted[lower]
    : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
  return Math.round(result * 100) / 100
}

function distribution(values: Array<number | null>) {
  const usable = values.filter((value): value is number => value !== null && value >= 0)
  return usable.length ? {
    count: usable.length,
    minimum: percentile(usable, 0) as number,
    p25: percentile(usable, .25) as number,
    median: percentile(usable, .5) as number,
    p75: percentile(usable, .75) as number,
    maximum: percentile(usable, 1) as number,
  } : null
}

function overlap(left: string[], right: string[]) {
  if (!left.length || !right.length) return 0
  const rightSet = new Set(right)
  return left.filter((token) => rightSet.has(token)).length /
    Math.max(1, Math.min(left.length, right.length))
}

export function normalizeMarketResearchRequestV1(value: unknown): MarketResearchRequestV1 {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  const allowedKeys = new Set([
    "marketplace", "seedType", "seedValue", "requestedWindowDays",
    "researchIntent", "queryBudget", "seedIdentity", "manualEvidence",
  ])
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new Error("MARKET_RESEARCH_INPUT_FIELD_NOT_ALLOWED")
  }
  const seedTypes: MarketResearchSeedType[] = [
    "SEED_AUTO", "SEED_QUERY", "SEED_ITEM_ID", "SEED_PRODUCT_TITLE", "SEED_PRODUCT_FAMILY",
    "PRODUCT_CASE_CANDIDATE",
  ]
  const seedType = seedTypes.includes(input.seedType as MarketResearchSeedType)
    ? input.seedType as MarketResearchSeedType : null
  const seedValue = text(input.seedValue, 180)
  const marketplace = input.marketplace === undefined || input.marketplace === "EBAY_US"
    ? "EBAY_US" as const : null
  const requestedWindowDays = [30, 90, 365].includes(Number(input.requestedWindowDays))
    ? Number(input.requestedWindowDays) as 30 | 90 | 365 : 90
  const intents = ["FAMILY_DISCOVERY", "OPPORTUNITY_VALIDATION", "KEYWORD_EVIDENCE"] as const
  const researchIntent = intents.includes(input.researchIntent as typeof intents[number])
    ? input.researchIntent as typeof intents[number] : "OPPORTUNITY_VALIDATION"
  if (!seedType || !seedValue || !marketplace) throw new Error("MARKET_RESEARCH_INPUT_INVALID")
  if (seedType === "SEED_ITEM_ID" && !/^\d{9,19}$/.test(seedValue)) {
    throw new Error("MARKET_RESEARCH_ITEM_ID_INVALID")
  }
  const rawIdentity = input.seedIdentity && typeof input.seedIdentity === "object" &&
      !Array.isArray(input.seedIdentity)
    ? input.seedIdentity as Record<string, unknown> : {}
  return {
    marketplace,
    seedType,
    seedValue,
    requestedWindowDays,
    researchIntent,
    queryBudget: Math.min(MARKET_RESEARCH_QUERY_BUDGET_MAX,
      Math.max(1, Math.floor(Number(input.queryBudget) || 1))),
    seedIdentity: {
      categoryId: text(rawIdentity.categoryId, 40),
      categoryName: text(rawIdentity.categoryName, 160),
      brand: text(rawIdentity.brand, 120),
      gtin: text(rawIdentity.gtin, 24),
      mpn: text(rawIdentity.mpn, 120),
      model: text(rawIdentity.model, 120),
      packCount: integer(rawIdentity.packCount),
      size: text(rawIdentity.size, 80),
      color: text(rawIdentity.color, 80),
    },
  }
}

export function classifyMarketComparableV1(
  request: MarketResearchRequestV1,
  evidence: MarketEvidenceV1,
) {
  const seedTokens = tokens(request.seedValue)
  const titleTokens = tokens(evidence.title)
  const tokenOverlap = overlap(seedTokens, titleTokens)
  const sameCategory = Boolean(request.seedIdentity.categoryId && evidence.categoryId &&
    request.seedIdentity.categoryId === evidence.categoryId)
  const exactGtin = Boolean(request.seedIdentity.gtin && evidence.gtin &&
    normalize(request.seedIdentity.gtin) === normalize(evidence.gtin))
  const exactBrandModel = Boolean(request.seedIdentity.brand && evidence.brand &&
    normalize(request.seedIdentity.brand) === normalize(evidence.brand) &&
    (request.seedIdentity.mpn || request.seedIdentity.model) &&
    normalize(request.seedIdentity.mpn ?? request.seedIdentity.model) ===
      normalize(evidence.mpn ?? evidence.model))
  const reasons: string[] = []
  const mismatch = (code: string, left: unknown, right: unknown) => {
    if (text(left) && text(right) && normalize(left) !== normalize(right)) reasons.push(code)
  }
  mismatch("BRAND_MISMATCH", request.seedIdentity.brand, evidence.brand)
  mismatch("MODEL_MISMATCH", request.seedIdentity.mpn ?? request.seedIdentity.model,
    evidence.mpn ?? evidence.model)
  if (request.seedIdentity.packCount && evidence.packCount &&
      request.seedIdentity.packCount !== evidence.packCount) reasons.push("PACK_COUNT_MISMATCH")
  mismatch("SIZE_VARIANT_MISMATCH", request.seedIdentity.size, evidence.size)
  mismatch("COLOR_VARIANT_MISMATCH", request.seedIdentity.color, evidence.color)
  const materialMismatch = reasons.length > 0
  let classification: ComparableClassV1
  if (!titleTokens.length && !evidence.categoryId && !exactGtin && !exactBrandModel) {
    classification = "UNPROVEN"
  } else if (!materialMismatch && (exactGtin || exactBrandModel ||
      (sameCategory && tokenOverlap >= .7 && seedTokens.length >= 2))) {
    classification = "EXACT_OR_STRONG_COMPARABLE"
  } else if (sameCategory || tokenOverlap >= .35 ||
      ((exactGtin || exactBrandModel) && materialMismatch)) {
    classification = "PRODUCT_FAMILY_COMPARABLE"
  } else if (tokenOverlap >= .18) {
    classification = "WEAK_COMPARABLE"
  } else {
    classification = "NOT_COMPARABLE"
  }
  return {
    classification,
    confidence: boundedScore((exactGtin || exactBrandModel ? 90 : tokenOverlap * 75) +
      (sameCategory ? 10 : 0) - reasons.length * 8),
    matchingAttributes: [
      ...(exactGtin ? ["GTIN"] : []),
      ...(exactBrandModel ? ["BRAND_MODEL"] : []),
      ...(sameCategory ? ["CATEGORY"] : []),
      ...(tokenOverlap >= .35 ? ["TITLE_PRODUCT_TERMS"] : []),
    ],
    mismatchAttributes: reasons,
  }
}

function evidencePhrases(row: MarketEvidenceV1) {
  const sources = [row.title, ...row.keywordSignals].filter((value): value is string => Boolean(value))
  const phrases = new Set<string>()
  for (const source of sources) {
    const rowTokens = tokens(source).slice(0, 30)
    for (let size = 1; size <= 3; size += 1) {
      for (let index = 0; index <= rowTokens.length - size; index += 1) {
        const phrase = rowTokens.slice(index, index + size).join(" ")
        if (phrase.length >= 3) phrases.add(phrase)
      }
    }
  }
  return [...phrases]
}

function keywordFamilyType(phrase: string, seedValue: string) {
  const values = tokens(phrase)
  if (values.length >= 2 && overlap(values, tokens(seedValue)) >= .65) return "CORE"
  if (values.some((token) => PACK_TERMS.has(token)) || /\b\d+\b/.test(phrase)) return "PACK_FORMAT"
  if (values.some((token) => AUDIENCE_TERMS.has(token))) return "AUDIENCE"
  if (values.some((token) => USE_TERMS.has(token))) return "USE_CASE"
  if (values.some((token) => BENEFIT_TERMS.has(token))) return "BENEFIT"
  if (values.some((token) => FORM_TERMS.has(token))) return "FORM_FACTOR"
  return values.length >= 2 ? "FEATURE" : "ATTRIBUTE"
}

function canonicalProductFamilyLabel(
  request: MarketResearchRequestV1,
  rows: Array<{ evidence: MarketEvidenceV1 }>,
) {
  const representative = rows[0]?.evidence
  const resolved = resolveCanonicalProductFamilyV1({ seedValue: request.seedValue,
    title: request.seedType === "SEED_PRODUCT_TITLE" ? request.seedValue : representative?.title,
    categoryId: representative?.categoryId ?? request.seedIdentity.categoryId,
    categoryName: representative?.categoryName ?? request.seedIdentity.categoryName,
    itemSpecifics: representative?.itemSpecifics,
    packCount: representative?.packCount ?? request.seedIdentity.packCount,
    brand: representative?.brand ?? request.seedIdentity.brand,
    model: representative?.model ?? request.seedIdentity.model })
  if (resolved.canonicalFamily) return resolved.canonicalFamily
  const seedTerms = tokens(request.seedValue)
  if (request.seedType !== "SEED_ITEM_ID" && seedTerms.length >= 2 && seedTerms.length <= 7) {
    return text(request.seedValue, 160) as string
  }
  const support = new Map<string, Set<string>>()
  for (const row of rows) {
    for (const phrase of evidencePhrases(row.evidence).filter((value) => {
      const size = tokens(value).length
      return size >= 2 && size <= 4
    })) {
      const ids = support.get(phrase) ?? new Set<string>()
      ids.add(row.evidence.evidenceId)
      support.set(phrase, ids)
    }
  }
  return [...support.entries()].sort((left, right) =>
    right[1].size - left[1].size ||
    tokens(right[0]).length - tokens(left[0]).length ||
    left[0].localeCompare(right[0]))[0]?.[0] ??
    text(request.seedIdentity.categoryName, 160) ?? "Unproven product family"
}

function keywordPhraseQuality(input: {
  phrase: string
  support: number
  seedValue: string
  allPhrases: Map<string, { evidenceIds: Set<string> }>
}) {
  const phraseTokens = tokens(input.phrase)
  const longerSupportedPhrase = [...input.allPhrases.entries()].some(([candidate, values]) => {
    const candidateTokens = tokens(candidate)
    return candidate !== input.phrase && candidateTokens.length > phraseTokens.length &&
      phraseTokens.every((token) => candidateTokens.includes(token)) &&
      values.evidenceIds.size >= input.support
  })
  const seedRelevance = overlap(phraseTokens, tokens(input.seedValue))
  const ambiguityPenalty = phraseTokens.length === 1 && longerSupportedPhrase ? 38
    : phraseTokens.length === 2 && longerSupportedPhrase ? 12 : 0
  const specificity = phraseTokens.length >= 3 ? 34 : phraseTokens.length === 2 ? 24 : 8
  const qualityScore = boundedScore(
    specificity + Math.min(30, input.support * 8) + seedRelevance * 32 - ambiguityPenalty,
  )
  return {
    qualityScore,
    reasonCodes: [
      ...(phraseTokens.length >= 2 ? ["COMMERCIAL_MULTI_TOKEN_PHRASE"] : []),
      ...(seedRelevance >= .5 ? ["PRODUCT_FAMILY_RELEVANT"] : []),
      ...(longerSupportedPhrase ? ["SUBSUMED_BY_STRONGER_PHRASE_PENALTY"] : []),
    ],
  }
}

function selectKeywordSpine<T extends {
  canonicalPhrase: string
  familyType: string
  qualityScore: number
}>(families: T[]) {
  const selected: string[] = []
  const ranked = [...families].sort((left, right) =>
    right.qualityScore - left.qualityScore ||
    tokens(right.canonicalPhrase).length - tokens(left.canonicalPhrase).length ||
    left.canonicalPhrase.localeCompare(right.canonicalPhrase))
  for (const familyType of ["CORE", "FORM_FACTOR", "FEATURE", "USE_CASE", "BENEFIT"]) {
    const candidate = ranked.find((row) => row.familyType === familyType &&
      (tokens(row.canonicalPhrase).length >= 2 || row.qualityScore >= 75) &&
      !selected.some((current) => {
        const currentTokens = tokens(current)
        const candidateTokens = tokens(row.canonicalPhrase)
        return currentTokens.every((token) => candidateTokens.includes(token)) ||
          candidateTokens.every((token) => currentTokens.includes(token))
      }))
    if (candidate) selected.push(candidate.canonicalPhrase)
    if (selected.length === 4) break
  }
  return selected
}

function freshness(observedAt: string, asOf: Date) {
  const timestamp = Date.parse(observedAt)
  if (!Number.isFinite(timestamp)) return "UNKNOWN" as const
  const days = Math.max(0, (asOf.getTime() - timestamp) / 86_400_000)
  return days <= 2 ? "FRESH" as const : days <= 14 ? "STALE" as const : "EXPIRED" as const
}

function ageDays(value: string | null, asOf: Date) {
  const timestamp = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(timestamp)
    ? Math.max(0, (asOf.getTime() - timestamp) / 86_400_000)
    : null
}

export function marketEvidenceFromKeywordDemandReportV1(
  report: EbaySellerKeywordDemandReport,
): MarketEvidenceV1[] {
  return report.comparableEvidence.slice(0, MARKET_RESEARCH_RESULT_LIMIT).map((row) => {
    const sold = row.evidenceSource === "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY" &&
      row.verifiedSoldQuantity > 0
    const identity = [row.comparableId, row.evidenceSource, row.title].join(":")
    return {
      evidenceId: `market_${stableHash(identity).slice(0, 24)}`,
      // Browse returns RESTful IDs (for example v1|366581876813|0), while
      // Seller OS canonical identity uses the legacy numeric listing ID.
      itemId: row.comparableId.match(/(?:^|\|)(\d{9,19})(?:\||$)/)?.[1] ?? null,
      title: text(row.title),
      categoryId: text(row.categoryId, 40),
      categoryName: text(row.categoryName, 160),
      brand: text(row.brand, 120),
      gtin: text(row.gtin, 24),
      mpn: text(row.mpn, 120),
      model: text(row.model, 120),
      packCount: integer(row.lotSize),
      size: text(row.size, 80),
      color: text(row.color, 80),
      condition: null,
      price: numberValue(row.price),
      currency: text(row.currency, 3),
      shippingCost: numberValue(row.shippingCost),
      imageUrl: row.imageUrl?.startsWith("https://") ? row.imageUrl : null,
      itemSpecifics: Object.fromEntries(row.localizedAspects
        .filter((aspect) => aspect.name && aspect.value)
        .map((aspect) => [String(aspect.name).slice(0, 80), String(aspect.value).slice(0, 160)])),
      keywordSignals: [],
      activeListing: !sold,
      confirmedSold: sold,
      confirmedSoldQuantity: sold ? row.verifiedSoldQuantity : null,
      saleObservedAt: sold ? row.lastSoldDate ?? row.itemEndDate : null,
      observedAt: sold ? row.lastSoldDate ?? row.itemEndDate ?? report.evidenceAsOf
        : report.evidenceAsOf,
      source: sold
        ? "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY"
        : "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE",
      sourceVersion: report.validationVersion,
      evidenceCompleteness: row.identifierExact ? "COMPLETE" : "PARTIAL",
      sellerReferenceHash: row.sellerUsername
        ? `seller_${stableHash(normalize(row.sellerUsername)).slice(0, 16)}` : null,
    }
  })
}

export function parseManualMarketEvidenceV1(input: {
  format: OfficialSoldEvidenceFormat
  sourceExportType: OfficialSoldEvidenceExport
  content: string
  now?: Date
}) {
  const parsed = parseOfficialSoldEvidenceImport(input)
  const observations: MarketEvidenceV1[] = parsed.observations.map((row) => ({
    evidenceId: row.sourceListingReferenceHash,
    itemId: null,
    title: null,
    categoryId: null,
    categoryName: null,
    brand: text(row.normalizedIdentity.manufacturerBrand, 120),
    gtin: text(row.normalizedIdentity.gtin, 24),
    mpn: text(row.normalizedIdentity.mpn, 120),
    model: text(row.normalizedIdentity.model, 120),
    packCount: integer(row.normalizedIdentity.packCount),
    size: text(row.normalizedIdentity.size, 80),
    color: text(row.normalizedIdentity.color, 80),
    condition: text(row.normalizedIdentity.condition, 40),
    price: row.itemPrice,
    currency: null,
    shippingCost: row.shippingCost,
    imageUrl: null,
    itemSpecifics: {},
    keywordSignals: row.keywordSignals,
    activeListing: false,
    confirmedSold: true,
    confirmedSoldQuantity: row.confirmedSoldQuantity,
    saleObservedAt: row.observedAt,
    observedAt: row.observedAt,
    source: "MANUAL_MARKET_EVIDENCE",
    sourceVersion: MARKET_OPPORTUNITY_RESEARCH_VERSION,
    evidenceCompleteness: "PARTIAL",
    sellerReferenceHash: null,
  }))
  return {
    source: "MANUAL_MARKET_EVIDENCE" as const,
    sourceExportType: input.sourceExportType,
    evidenceScope: parsed.evidenceScope,
    marketWideSchemaConfirmed: parsed.marketWideSchemaConfirmed,
    rowCount: parsed.rowCount,
    observations,
    rawFileStored: false as const,
    piiStored: false as const,
  }
}

export function buildMarketOpportunityResearchV1(input: {
  request: MarketResearchRequestV1
  evidence: MarketEvidenceV1[]
  observedAt?: string
  activeMarketStatus: MarketResearchCapabilityStatus
  soldHistoryStatus: MarketResearchCapabilityStatus
  paginationCoverage: string
  sourceLimitations?: string[]
}) {
  const asOf = new Date(input.observedAt ?? new Date().toISOString())
  if (!Number.isFinite(asOf.getTime())) throw new Error("MARKET_RESEARCH_OBSERVED_AT_INVALID")
  const byEvidence = new Map(input.evidence.map((row) => [row.evidenceId, row]))
  const evidence = [...byEvidence.values()].sort((left, right) =>
    left.evidenceId.localeCompare(right.evidenceId)).slice(0, MARKET_RESEARCH_RESULT_LIMIT)
  const comparables = evidence.map((row) => ({
    evidence: row,
    assessment: classifyMarketComparableV1(input.request, row),
  }))
  const usable = comparables.filter((row) => [
    "EXACT_OR_STRONG_COMPARABLE", "PRODUCT_FAMILY_COMPARABLE",
  ].includes(row.assessment.classification))
  const active = usable.filter((row) => row.evidence.activeListing)
  const sold = usable.filter((row) => row.evidence.confirmedSold &&
    (row.evidence.confirmedSoldQuantity ?? 0) > 0)
  const categoryGroups = new Map<string, typeof usable>()
  for (const row of usable) {
    const key = row.evidence.categoryId ?? (normalize(row.evidence.categoryName) || "core")
    const group = categoryGroups.get(key) ?? []
    group.push(row)
    categoryGroups.set(key, group)
  }
  if (!categoryGroups.size) categoryGroups.set("core", [])
  const productFamilies = [...categoryGroups.entries()].map(([key, rows], index) => {
    const categoryLabel = rows.map((row) => row.evidence.categoryName).find(Boolean) ??
      input.request.seedIdentity.categoryName ?? null
    const categoryId = rows.map((row) => row.evidence.categoryId).find(Boolean) ?? null
    const label = canonicalProductFamilyLabel(input.request, rows)
    const activeRows = rows.filter((row) => row.evidence.activeListing)
    const soldRows = rows.filter((row) => row.evidence.confirmedSold)
    return {
      familyId: `family_${stableHash(`${key}:${normalize(label)}`).slice(0, 20)}`,
      familyType: index === 0 ? "CORE_PRODUCT_FAMILY" as const : "ADJACENT_PRODUCT_FAMILY" as const,
      canonicalLabel: label,
      category: { categoryId, canonicalLabel: categoryLabel },
      normalizedTerms: unique(rows.flatMap((row) => tokens(row.evidence.title))).slice(0, 15),
      categoryEvidence: categoryId,
      representativeItems: rows.slice(0, 3).map((row) => row.evidence.evidenceId),
      supportingListingCount: rows.length,
      soldEvidenceCount: soldRows.length,
      activeCompetitionCount: activeRows.length,
      priceDistribution: {
        activeAskingPrice: distribution(activeRows.map((row) => row.evidence.price)),
        soldPrice: distribution(soldRows.map((row) => row.evidence.price)),
      },
      confidence: rows.length ? boundedScore(35 + rows.length * 10) : 15,
      sourceCompleteness: rows.length ? "PARTIAL" as const : "UNPROVEN" as const,
      reasonCodes: rows.length
        ? ["PRODUCT_PHRASE_AND_CATEGORY_EVIDENCE", "CATEGORY_IS_NOT_PRODUCT_FAMILY"]
        : ["NO_COMPARABLE_EVIDENCE"],
    }
  }).sort((left, right) => right.supportingListingCount - left.supportingListingCount ||
    left.familyId.localeCompare(right.familyId))

  const phraseMap = new Map<string, {
    evidenceIds: Set<string>; activeIds: Set<string>; soldIds: Set<string>;
    soldQuantity: number; activePrices: number[]; soldPrices: number[]; dates: string[]
  }>()
  for (const row of usable) {
    for (const phrase of evidencePhrases(row.evidence)) {
      const current = phraseMap.get(phrase) ?? {
        evidenceIds: new Set(), activeIds: new Set(), soldIds: new Set(),
        soldQuantity: 0, activePrices: [], soldPrices: [], dates: [],
      }
      current.evidenceIds.add(row.evidence.evidenceId)
      if (row.evidence.activeListing) {
        current.activeIds.add(row.evidence.evidenceId)
        if (row.evidence.price !== null) current.activePrices.push(row.evidence.price)
      }
      if (row.evidence.confirmedSold) {
        current.soldIds.add(row.evidence.evidenceId)
        current.soldQuantity += row.evidence.confirmedSoldQuantity ?? 0
        if (row.evidence.price !== null) current.soldPrices.push(row.evidence.price)
        if (row.evidence.saleObservedAt) current.dates.push(row.evidence.saleObservedAt)
      }
      phraseMap.set(phrase, current)
    }
  }
  const keywordFamilies = [...phraseMap.entries()].map(([phrase, values]) => {
    const soldEvidenceAvailable = input.soldHistoryStatus === "AVAILABLE" ||
      input.soldHistoryStatus === "PARTIAL"
    const recentDays = values.dates.map((date) => ageDays(date, asOf))
      .filter((value): value is number => value !== null)
    const quality = keywordPhraseQuality({
      phrase,
      support: values.evidenceIds.size,
      seedValue: input.request.seedValue,
      allPhrases: phraseMap,
    })
    return {
      keywordFamilyId: `keyword_${stableHash(phrase).slice(0, 20)}`,
      canonicalPhrase: phrase,
      relatedPhrases: [] as string[],
      familyType: keywordFamilyType(phrase, input.request.seedValue),
      soldListingsObserved: soldEvidenceAvailable ? values.soldIds.size : null,
      soldQuantityObserved: soldEvidenceAvailable ? values.soldQuantity : null,
      soldEvidenceReferences: soldEvidenceAvailable
        ? unique([...values.soldIds]) : [],
      activeListingsObserved: values.activeIds.size,
      activeEvidenceReferences: unique([...values.activeIds]),
      comparableListingsObserved: values.evidenceIds.size,
      medianSoldPrice: percentile(values.soldPrices, .5),
      medianActivePrice: percentile(values.activePrices, .5),
      recency: recentDays.length ? Math.min(...recentDays) : null,
      momentum: "INSUFFICIENT_EVIDENCE" as const,
      qualityScore: quality.qualityScore,
      marketEvidenceOnly: true as const,
      confidence: boundedScore(
        (values.evidenceIds.size * 18 + values.soldIds.size * 20) * .65 +
        quality.qualityScore * .35,
      ),
      evidenceStatus: soldEvidenceAvailable && values.soldIds.size
        ? "SOLD_EVIDENCE_AVAILABLE" as const
        : values.activeIds.size ? "ACTIVE_LISTING_EVIDENCE_ONLY" as const
          : "UNPROVEN" as const,
      reasonCodes: [
        ...(values.soldIds.size
          ? ["REPEATED_IN_CONFIRMED_SOLD_COMPARABLES"]
          : ["NO_AUTHORIZED_SOLD_KEYWORD_EVIDENCE"]),
        ...quality.reasonCodes,
      ],
    }
  }).filter((row) => row.comparableListingsObserved >= 2 ||
    overlap(tokens(row.canonicalPhrase), tokens(input.request.seedValue)) >= .5)
    .sort((left, right) =>
      (right.soldQuantityObserved ?? -1) - (left.soldQuantityObserved ?? -1) ||
      right.qualityScore - left.qualityScore ||
      right.comparableListingsObserved - left.comparableListingsObserved ||
      right.canonicalPhrase.split(" ").length - left.canonicalPhrase.split(" ").length ||
      left.canonicalPhrase.localeCompare(right.canonicalPhrase))
    .slice(0, 30)
  for (const family of keywordFamilies) {
    family.relatedPhrases = keywordFamilies.filter((candidate) =>
      candidate.keywordFamilyId !== family.keywordFamilyId &&
      overlap(tokens(candidate.canonicalPhrase), tokens(family.canonicalPhrase)) >= .5)
      .slice(0, 3).map((candidate) => candidate.canonicalPhrase)
  }

  const soldInWindow = (days: number) => sold.filter((row) => {
    const age = ageDays(row.evidence.saleObservedAt, asOf)
    return age !== null && age <= days
  })
  const sold30 = soldInWindow(30)
  const sold90 = soldInWindow(90)
  const previous30 = sold.filter((row) => {
    const age = ageDays(row.evidence.saleObservedAt, asOf)
    return age !== null && age > 30 && age <= 60
  })
  const quantity = (rows: typeof sold) => rows.reduce((sum, row) =>
    sum + (row.evidence.confirmedSoldQuantity ?? 0), 0)
  const momentum = sold30.length && previous30.length
    ? quantity(sold30) > quantity(previous30) * 1.2 ? "ACCELERATING"
      : quantity(sold30) < quantity(previous30) * .8 ? "DECELERATING" : "STABLE"
    : "INSUFFICIENT_EVIDENCE"
  const activePrice = distribution(active.map((row) => row.evidence.price))
  const soldPrice = distribution(sold90.map((row) => row.evidence.price))
  const soldStatus = sold.length ? "AVAILABLE" : input.soldHistoryStatus
  const demand = {
    soldHistoryStatus: soldStatus,
    recentSalesStrength: sold90.length
      ? boundedScore(sold90.length * 12 + quantity(sold90) * 4) : null,
    soldListingCount90d: soldStatus === "AVAILABLE" ? sold90.length : null,
    soldQuantity90d: soldStatus === "AVAILABLE" ? quantity(sold90) : null,
    sellThrough: null,
    sellThroughStatus: "UNPROVEN_INCOMPATIBLE_NUMERATOR_DENOMINATOR" as const,
    activeCompetition: active.length,
    soldPriceMedian: soldPrice?.median ?? null,
    soldPriceP25: soldPrice?.p25 ?? null,
    soldPriceP75: soldPrice?.p75 ?? null,
    recencyDays: sold90.map((row) => ageDays(row.evidence.saleObservedAt, asOf))
      .filter((value): value is number => value !== null).sort((a, b) => a - b)[0] ?? null,
    momentum30d: momentum,
    demand90d: soldStatus === "AVAILABLE" ? "AVAILABLE" as const : "UNAVAILABLE" as const,
    context365d: input.request.requestedWindowDays === 365 && sold.some((row) =>
      (ageDays(row.evidence.saleObservedAt, asOf) ?? 0) > 90)
      ? "PARTIAL" as const : "UNAVAILABLE" as const,
  }
  const priceOpportunity = {
    activeAskingPrice: activePrice,
    soldPrice,
    distributionsMixed: false as const,
    status: activePrice || soldPrice ? "AVAILABLE" as const : "UNPROVEN" as const,
  }
  const competition = {
    activeComparableCount: active.filter((row) =>
      row.assessment.classification === "EXACT_OR_STRONG_COMPARABLE").length,
    strongComparableCount: active.filter((row) =>
      row.assessment.classification === "EXACT_OR_STRONG_COMPARABLE").length,
    familyComparableCount: active.filter((row) =>
      row.assessment.classification === "PRODUCT_FAMILY_COMPARABLE").length,
    weakComparableCount: comparables.filter((row) => row.evidence.activeListing &&
      row.assessment.classification === "WEAK_COMPARABLE").length,
    activeMarketResultCount: evidence.filter((row) => row.activeListing).length,
    competitionCount: active.length,
    activeFamilyCount: active.length,
    distinctSellerCount: new Set(active.map((row) => row.evidence.sellerReferenceHash)
      .filter(Boolean)).size,
    priceCrowding: activePrice && activePrice.median > 0
      ? boundedScore(100 - ((activePrice.p75 - activePrice.p25) /
        activePrice.median) * 100) : null,
    salesInferredFromCompetition: false as const,
  }
  const exactCount = usable.filter((row) =>
    row.assessment.classification === "EXACT_OR_STRONG_COMPARABLE").length
  const completeness = boundedScore(
    (input.activeMarketStatus === "AVAILABLE" ? 25 : 0) +
    (sold.length ? 35 : 0) + (exactCount ? 20 : 0) +
    (keywordFamilies.length ? 10 : 0) + (activePrice ? 10 : 0),
  )
  const componentScores = {
    DEMAND_STRENGTH: demand.recentSalesStrength,
    RECENCY: demand.recencyDays === null ? null : boundedScore(100 - demand.recencyDays),
    MOMENTUM: momentum === "ACCELERATING" ? 85 : momentum === "STABLE" ? 60
      : momentum === "DECELERATING" ? 25 : null,
    COMPARABLE_CONFIDENCE: usable.length
      ? boundedScore((exactCount / usable.length) * 100) : null,
    KEYWORD_EVIDENCE: keywordFamilies.length
      ? boundedScore(keywordFamilies.slice(0, 5).reduce((sum, row) => sum + row.confidence, 0) /
        Math.min(5, keywordFamilies.length)) : null,
    PRICE_STABILITY: competition.priceCrowding,
    COMPETITION: boundedScore(active.length <= 10 ? 80 : active.length <= 50 ? 55 : 30),
    EVIDENCE_COMPLETENESS: completeness,
  }
  const weights = {
    DEMAND_STRENGTH: .25, RECENCY: .10, MOMENTUM: .10,
    COMPARABLE_CONFIDENCE: .15, KEYWORD_EVIDENCE: .10,
    PRICE_STABILITY: .10, COMPETITION: .08, EVIDENCE_COMPLETENESS: .12,
  } as const
  const essentialEvidence = componentScores.DEMAND_STRENGTH !== null && exactCount > 0 &&
    completeness >= 60
  const opportunityScore = essentialEvidence
    ? boundedScore(Object.entries(weights).reduce((sum, [key, weight]) =>
      sum + (componentScores[key as keyof typeof componentScores] ?? 0) * weight, 0))
    : null
  const decision = opportunityScore === null ? "HUMAN_REVIEW" as const
    : opportunityScore >= 70 && completeness >= 75 ? "ADVANCE" as const
      : opportunityScore < 35 && sold.length >= 3 ? "REJECT" as const : "HOLD" as const
  const spineTerms = selectKeywordSpine(keywordFamilies)
  const generatedQueries = unique(keywordFamilies.slice(0, input.request.queryBudget)
    .map((row) => row.canonicalPhrase)
    .filter((phrase) => normalize(phrase) !== normalize(input.request.seedValue)))
    .slice(0, input.request.queryBudget).map((query) => ({
      query,
      classification: "GENERATED_RESEARCH_QUERY" as const,
      observed: false as const,
      marketEvidence: false as const,
    }))
  const reasonCodes = unique([
    ...(sold.length ? ["STRONG_RECENT_DEMAND"] : ["SOLD_HISTORY_UNAVAILABLE"]),
    ...(exactCount ? [] : ["COMPARABLES_WEAK"]),
    ...(keywordFamilies.some((row) => row.evidenceStatus === "SOLD_EVIDENCE_AVAILABLE")
      ? ["KEYWORD_EVIDENCE_STRONG"] : ["INSUFFICIENT_EVIDENCE"]),
    ...(momentum === "ACCELERATING" ? ["MOMENTUM_ACCELERATING"] : []),
    ...(momentum === "DECELERATING" ? ["MOMENTUM_DECELERATING"] : []),
  ])
  return {
    contractVersion: MARKET_OPPORTUNITY_RESEARCH_VERSION,
    status: evidence.length ? "AVAILABLE" as const : "UNPROVEN" as const,
    sourceCapabilities: EBAY_MARKET_RESEARCH_SOURCE_CAPABILITIES_V1,
    request: input.request,
    productFamilies,
    comparables: comparables.map((row) => ({
      evidenceId: row.evidence.evidenceId,
      itemId: row.evidence.itemId,
      title: row.evidence.title,
      imageUrl: row.evidence.imageUrl,
      price: row.evidence.price,
      currency: row.evidence.currency,
      source: row.evidence.source,
      activeListing: row.evidence.activeListing,
      confirmedSold: row.evidence.confirmedSold,
      confirmedSoldQuantity: row.evidence.confirmedSoldQuantity,
      classification: row.assessment.classification,
      confidence: row.assessment.confidence,
      matchingAttributes: row.assessment.matchingAttributes,
      mismatchAttributes: row.assessment.mismatchAttributes,
    })).sort((left, right) => right.confidence - left.confidence ||
      left.evidenceId.localeCompare(right.evidenceId)),
    keywordFamilies,
    keywordSpine: {
      status: spineTerms.length ? "AVAILABLE" as const : "UNPROVEN" as const,
      terms: spineTerms,
      isAutomaticTitle: false as const,
      requiresPhysicalProductTruthValidation: true as const,
      evidenceRole: "MARKET_EVIDENCE_ONLY" as const,
      source: "OBSERVED_COMPARABLE_PHRASES" as const,
    },
    demand,
    priceOpportunity,
    competition,
    opportunityScore: {
      status: opportunityScore === null ? "SCORE_UNPROVEN" as const : "AVAILABLE" as const,
      value: opportunityScore,
      components: componentScores,
      weights,
      evidenceCompleteness: completeness,
      confidence: opportunityScore === null ? "LOW" as const
        : completeness >= 80 ? "HIGH" as const : "MEDIUM" as const,
      reasonCodes,
    },
    decision: { outcome: decision, reasonCodes },
    opportunityCase: {
      identity: {
        seed: { type: input.request.seedType, value: input.request.seedValue },
        marketplace: input.request.marketplace,
        productFamily: productFamilies[0]?.canonicalLabel ?? null,
        category: productFamilies[0]?.category ?? null,
        researchWindowDays: input.request.requestedWindowDays,
        observationTimestamp: asOf.toISOString(),
      },
      demand,
      comparables: {
        strong: comparables.filter((row) => row.assessment.classification ===
          "EXACT_OR_STRONG_COMPARABLE").map((row) => row.evidence.evidenceId).slice(0, 10),
        family: comparables.filter((row) => row.assessment.classification ===
          "PRODUCT_FAMILY_COMPARABLE").map((row) => row.evidence.evidenceId).slice(0, 10),
        excludedOrWeak: comparables.filter((row) => ["WEAK_COMPARABLE", "NOT_COMPARABLE",
          "UNPROVEN"].includes(row.assessment.classification)).map((row) => ({
            evidenceId: row.evidence.evidenceId,
            classification: row.assessment.classification,
            reasons: row.assessment.mismatchAttributes,
          })).slice(0, 10),
      },
      keywordFamilies: keywordFamilies.slice(0, 15),
      keywordSpine: spineTerms,
      pricing: priceOpportunity,
      competition,
      risks: unique([
        ...comparables.flatMap((row) => row.assessment.mismatchAttributes),
        ...(input.sourceLimitations ?? []),
        ...(sold.length ? [] : ["SOLD_HISTORY_UNAVAILABLE"]),
      ]),
      decision: { opportunityScore, confidence: opportunityScore === null ? "LOW" :
        completeness >= 80 ? "HIGH" : "MEDIUM", outcome: decision, reasonCodes },
      nextStep: decision === "ADVANCE" ? "SUPPLIER_MATCH_REQUIRED" as const
        : "EVIDENCE_REVIEW_REQUIRED" as const,
      productCaseCreated: false as const,
    },
    generatedQueries,
    provenance: {
      sources: unique(evidence.map((row) => row.source)),
      query: input.request.seedValue,
      windowDays: input.request.requestedWindowDays,
      timestamp: asOf.toISOString(),
      marketplace: input.request.marketplace,
      paginationCoverage: input.paginationCoverage,
      resultCount: evidence.length,
      deduplicationMethod: "EVIDENCE_ID_EXACT_SET",
      normalizationVersion: MARKET_OPPORTUNITY_RESEARCH_VERSION,
      comparableEngineVersion: "STRICT_COMPARABLE_V1",
      keywordEngineVersion: "SEMANTIC_KEYWORD_FAMILY_V1",
      scoringVersion: "TRANSPARENT_OPPORTUNITY_SCORE_V1",
      evidenceLimitations: unique(input.sourceLimitations ?? []),
      freshness: evidence.length
        ? freshness(evidence.map((row) => row.observedAt).sort().at(-1) ?? "", asOf)
        : "UNKNOWN",
      syntheticMarketData: false as const,
      searchVolumeClaimed: false as const,
      competitorDescriptionsCopied: false as const,
    },
    safety: {
      ebayWrites: 0 as const,
      registryWrites: 0 as const,
      productCaseMutations: 0 as const,
      remoteDdl: 0 as const,
      queryBudget: input.request.queryBudget,
      resultLimit: MARKET_RESEARCH_RESULT_LIMIT,
    },
  }
}

export type MarketOpportunityResearchV1 = ReturnType<
  typeof buildMarketOpportunityResearchV1
>
