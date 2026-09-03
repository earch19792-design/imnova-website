import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"

import type { SupabaseClient } from "@supabase/supabase-js"

import { humanConfirmedProductTruthValuesV1,
  ownerExplicitProductTruthValuesV1 } from
  "./ebay-human-product-truth-evidence-v1"

import {
  buildEbayListingTaxonomyPreflightV1,
} from "./ebay-listing-taxonomy-preflight-v1"
import {
  categoryResolverBindingMatchesContextV1,
} from "./ebay-listing-context-isolation-v1"
import type { EbayListingContextIdentityV1 } from
  "./ebay-listing-context-isolation-v1"
import type {
  EbayTaxonomyAspectIntelligence,
  EbayTaxonomyListingIntelligence,
} from "./ebay-seller-keyword-demand-gateway"

export const EBAY_CATEGORY_RESOLVER_V1 =
  "SELLER_OS_EBAY_CATEGORY_RESOLVER_V1" as const

export const EBAY_CATEGORY_RESOLVER_POLICY_V1 = Object.freeze({
  maximumCandidatesTested: 3,
  highConfidenceMinimum: 85,
  ambiguityMargin: 8,
  learningFreshnessMs: 30 * 24 * 60 * 60 * 1_000,
})

type JsonRecord = Record<string, unknown>

export type EbayCategoryCandidateSourceV1 =
  | "PROVEN_MAPPING"
  | "PRODUCT_TRUTH"
  | "OFFICIAL_TITLE_SUGGESTION"
  | "MARKET_CONTEXT"
  | "REFERENCE_CONTEXT"

export type EbayCategoryCandidateSignalV1 = Readonly<{
  categoryId: string
  categoryName?: string | null
  source: Exclude<EbayCategoryCandidateSourceV1, "PROVEN_MAPPING">
  evidenceId?: string | null
}>

export type EbayCategoryResolverLearningRowV1 = Readonly<{
  id: string
  accountKey: string
  marketplaceId: "EBAY_US"
  normalizedProductFamily: string
  normalizedProductType: string
  familyTypeFingerprint: string
  categoryId: string
  categoryName: string | null
  taxonomyTreeId: string
  taxonomyTreeVersion: string
  taxonomySnapshotDigest: string
  taxonomyPass: true
  requiredAspects: unknown[]
  listingAcceptance: "UNKNOWN" | "ACCEPTED" | "REJECTED"
  confidenceTier: "HIGH_CONFIDENCE" | "MEDIUM_CONFIDENCE" | "LOW_CONFIDENCE"
  confidenceScore: number
  lastValidatedAt: string
  revalidateAfter: string
}>

export type EbayCategoryResolverProductTruthV1 = Readonly<{
  title: string
  normalizedProductFamily: string
  normalizedProductType: string
  familyTypeFingerprint: string
  categorySignals: EbayCategoryCandidateSignalV1[]
  provenProductValues: Record<string, string>
  knownUnknownAspectNames: string[]
  unprovenAspectEvidenceRequirements: Record<string, string>
}>

export type EbayCategoryResolverTaxonomyReaderV1 = (
  query: string,
  categoryId?: string | null,
  options?: { allowTitleSuggestionFallback?: boolean },
) => Promise<EbayTaxonomyListingIntelligence>

export type EbayExactCanonicalCategoryAuthorityV1 = Readonly<{
  categoryId: string
  categoryName?: string | null
  authorityClass: string
  exactProductIdentityVerified: true
}>

type RankedCandidate = {
  categoryId: string
  categoryName: string | null
  score: number
  sources: Set<EbayCategoryCandidateSourceV1>
  evidenceIds: Set<string>
  mappingIds: Set<string>
  freshMapping: boolean
  staleMapping: boolean
  listingAccepted: boolean
}

type ValidatedCandidate = Readonly<{
  categoryId: string
  categoryName: string | null
  score: number
  sources: EbayCategoryCandidateSourceV1[]
  mappingIds: string[]
  taxonomy: EbayTaxonomyListingIntelligence
  taxonomySnapshotDigest: string
  taxonomyTreeVersion: string
  freshMapping: boolean
  staleMapping: boolean
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

function validTimestamp(value: unknown) {
  const normalized = text(value, 64)
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function categoryId(value: unknown) {
  const normalized = text(value, 20)
  return /^\d{1,20}$/.test(normalized) ? normalized : ""
}

function normalizeIdentityPhrase(value: unknown) {
  return text(value, 400).toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 160)
}

function canonical(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`
}

export function normalizeEbayCategoryResolverIdentityV1(input: Readonly<{
  marketplaceId?: "EBAY_US"
  productFamily: unknown
  productType: unknown
}>) {
  const marketplaceId = input.marketplaceId ?? "EBAY_US"
  const normalizedProductFamily = normalizeIdentityPhrase(input.productFamily)
  const normalizedProductType = normalizeIdentityPhrase(input.productType)
  if (
    marketplaceId !== "EBAY_US"
    || normalizedProductFamily.length < 2
    || normalizedProductType.length < 2
  ) throw new Error("EBAY_CATEGORY_RESOLVER_PRODUCT_IDENTITY_REQUIRED")
  return Object.freeze({
    marketplaceId,
    normalizedProductFamily,
    normalizedProductType,
    familyTypeFingerprint: digest({
      marketplaceId,
      normalizedProductFamily,
      normalizedProductType,
    }),
  })
}

function phraseSupportedByTruth(phrase: string, truth: string) {
  const truthTokens = new Set(normalizeIdentityPhrase(truth).split(" ").filter(Boolean))
  const phraseTokens = normalizeIdentityPhrase(phrase).split(" ").filter(Boolean)
  return phraseTokens.length > 0
    && phraseTokens.every((token) => truthTokens.has(token))
}

function uniqueStrings(values: unknown[], maximum = 200) {
  return [...new Set(values.map((value) => text(value, maximum)).filter(Boolean))]
}

function exactProductValuesFromOpportunity(input: Readonly<{
  opportunity: JsonRecord
  packageData?: JsonRecord
}>) {
  const assessment = record(input.opportunity.assessment)
  const intelligence = record(assessment.listingIntelligencePackage)
  const itemSpecifics = record(intelligence.itemSpecifics)
  const supplierConfirmed = record(itemSpecifics.supplierConfirmed)
  const productTruth = record(assessment.productTruth)
  const brand = record(productTruth.brand)
  const candidate = record(assessment.candidate)
  const ownerExplicit = ownerExplicitProductTruthValuesV1(input.opportunity)
  const ownerKeys = new Set(Object.keys(ownerExplicit).map(
    normalizeIdentityPhrase))
  const proven: Record<string, string> = {}
  for (const [name, value] of Object.entries(supplierConfirmed)) {
    const normalized = text(value, 500)
    if (normalized) proven[text(name, 120)] = normalized
  }
  for (const [name, value] of Object.entries(
    record(productTruth.provenProductValues))) {
    const normalizedName = text(name, 120)
    const normalizedValue = text(value, 500)
    if (!normalizedName || !normalizedValue) continue
    // A pre-publication owner correction supersedes only the prior active
    // owner value that the last readiness pass copied into this projection.
    // It does not override independent supplier-confirmed evidence.
    if (ownerKeys.has(normalizeIdentityPhrase(normalizedName))) continue
    const conflict = Object.entries(proven).find(([candidate, existing]) =>
      normalizeIdentityPhrase(candidate) ===
        normalizeIdentityPhrase(normalizedName)
      && normalizeIdentityPhrase(existing) !==
        normalizeIdentityPhrase(normalizedValue))
    if (conflict) throw new Error("EXACT_PRODUCT_TRUTH_ASPECT_CONFLICT")
    proven[normalizedName] = normalizedValue
  }
  const gtin = text(input.opportunity.gtin ?? candidate.gtin, 20)
  if (/^\d{8,14}$/.test(gtin)) proven.UPC = gtin
  const taxonomyBrand = text(brand.taxonomyBrandValue, 120)
  if (
    taxonomyBrand
    && brand.noManufacturerBrandClaim === "PROVEN"
    && brand.ebayBrandSemantics === "UNBRANDED_SUPPORTED"
  ) proven.Brand = taxonomyBrand
  const humanConfirmed = humanConfirmedProductTruthValuesV1(input.opportunity)
  for (const [name, value] of Object.entries(humanConfirmed)) {
    const existing = Object.entries(proven).find(([candidate]) =>
      normalizeIdentityPhrase(candidate) === normalizeIdentityPhrase(name))
    if (existing && normalizeIdentityPhrase(existing[1]) !==
        normalizeIdentityPhrase(value)) {
      throw new Error("HUMAN_PRODUCT_TRUTH_EVIDENCE_CONFLICT")
    }
    proven[name] = value
  }
  for (const [name, value] of Object.entries(ownerExplicit)) {
    const existing = Object.entries(proven).find(([candidate]) =>
      normalizeIdentityPhrase(candidate) === normalizeIdentityPhrase(name))
    if (existing && normalizeIdentityPhrase(existing[1]) !==
        normalizeIdentityPhrase(value)) {
      throw new Error("OWNER_EXPLICIT_PRODUCT_FACT_CONFLICT")
    }
    proven[name] = value
  }
  return proven
}

/**
 * Extracts only product-truth-backed resolver identity and candidate signals.
 * Market/reference categories are deliberately supporting signals; official
 * Taxonomy still has to validate the selected category.
 */
export function buildEbayCategoryResolverProductTruthV1(input: Readonly<{
  opportunity: JsonRecord
  packageData?: JsonRecord
}>): EbayCategoryResolverProductTruthV1 {
  const assessment = record(input.opportunity.assessment)
  const productTruth = record(assessment.productTruth)
  const candidate = record(assessment.candidate)
  const intelligence = record(assessment.listingIntelligencePackage)
  const categoryRecommendation = record(intelligence.categoryRecommendation)
  const titleStrategy = record(intelligence.titleStrategy)
  const supplierConfirmed = record(record(intelligence.itemSpecifics)
    .supplierConfirmed)
  const packageData = input.packageData ?? {}
  const title = text(
    productTruth.title
    ?? candidate.title
    ?? input.opportunity.product_title
    ?? packageData.title,
    350,
  )
  if (!title) throw new Error("EBAY_CATEGORY_RESOLVER_PRODUCT_TRUTH_REQUIRED")
  const productType = text(
    productTruth.productType
    ?? supplierConfirmed.Type
    ?? candidate.productType
    ?? input.opportunity.product_type,
    160,
  )
  const primaryPhrase = text(titleStrategy.primarySearchPhrase, 160)
  const authoritativeFamily = text(
    productTruth.normalizedProductFamily
    ?? productTruth.productFamily
    ?? assessment.productFamily,
    160,
  )
  const productFamily = authoritativeFamily
    || (primaryPhrase && phraseSupportedByTruth(primaryPhrase, `${title} ${productType}`)
      ? primaryPhrase
      : productType || title)
  const identity = normalizeEbayCategoryResolverIdentityV1({
    productFamily,
    productType: productType || productFamily || title,
  })
  const categorySignals: EbayCategoryCandidateSignalV1[] = []
  const pushSignal = (
    rawCategoryId: unknown,
    rawCategoryName: unknown,
    source: EbayCategoryCandidateSignalV1["source"],
    evidenceId?: unknown,
  ) => {
    const normalizedCategoryId = categoryId(rawCategoryId)
    if (!normalizedCategoryId) return
    categorySignals.push({
      categoryId: normalizedCategoryId,
      categoryName: text(rawCategoryName, 200) || null,
      source,
      evidenceId: text(evidenceId, 200) || null,
    })
  }
  const productTruthCategoryId = categoryId(
    productTruth.categoryId ?? productTruth.taxonomyCategoryId,
  )
  pushSignal(
    productTruthCategoryId,
    productTruth.categoryName,
    "PRODUCT_TRUTH",
    text(productTruth.evidenceDigest, 100),
  )
  const recommendationOfficial =
    categoryRecommendation.taxonomyStatus === "AVAILABLE"
    || categoryRecommendation.source === "EBAY_TAXONOMY_OFFICIAL_READONLY"
  pushSignal(
    categoryRecommendation.categoryId,
    categoryRecommendation.categoryName,
    recommendationOfficial ? "PRODUCT_TRUTH" : "MARKET_CONTEXT",
    categoryRecommendation.evidenceId,
  )
  pushSignal(
    packageData.categoryId,
    packageData.categoryName,
    "MARKET_CONTEXT",
    record(packageData.taxonomyPreflight).evidenceDigest,
  )
  for (const raw of array(input.opportunity.best_selling_matches).slice(0, 10)) {
    const reference = record(raw)
    pushSignal(
      reference.categoryId ?? reference.category_id,
      reference.categoryName ?? reference.category_name,
      "REFERENCE_CONTEXT",
      reference.itemId ?? reference.item_id,
    )
  }
  const provenProductValues = exactProductValuesFromOpportunity(input)
  const provenValueNames = new Set(Object.keys(provenProductValues).map(
    (name) => normalizeIdentityPhrase(name),
  ))
  const brand = record(productTruth.brand)
  const knownUnknownAspectNames = uniqueStrings([
    ...(provenValueNames.has("brand") ? [] : ["Brand"]),
    ...(provenValueNames.has("mpn") ? [] : ["MPN"]),
    ...(provenValueNames.has("model") ? [] : ["Model"]),
    ...(provenValueNames.has("color") ? [] : ["Color"]),
  ], 120)
  const unprovenAspectEvidenceRequirements: Record<string, string> = {}
  if (knownUnknownAspectNames.includes("Brand")) {
    unprovenAspectEvidenceRequirements.Brand =
      "AUTHORITATIVE_PRODUCT_BRAND_EVIDENCE_REQUIRED"
  }
  if (knownUnknownAspectNames.includes("MPN")) {
    unprovenAspectEvidenceRequirements.MPN =
      "AUTHORITATIVE_PRODUCT_MPN_EVIDENCE_REQUIRED"
  }
  if (knownUnknownAspectNames.includes("Model")) {
    unprovenAspectEvidenceRequirements.Model =
      "AUTHORITATIVE_PRODUCT_MODEL_EVIDENCE_REQUIRED"
  }
  if (knownUnknownAspectNames.includes("Color")) {
    unprovenAspectEvidenceRequirements.Color =
      "AUTHORITATIVE_PRODUCT_COLOR_EVIDENCE_REQUIRED"
  }
  return Object.freeze({
    title,
    normalizedProductFamily: identity.normalizedProductFamily,
    normalizedProductType: identity.normalizedProductType,
    familyTypeFingerprint: identity.familyTypeFingerprint,
    categorySignals,
    provenProductValues,
    knownUnknownAspectNames,
    unprovenAspectEvidenceRequirements,
  })
}

function sourceBaseScore(source: EbayCategoryCandidateSourceV1) {
  if (source === "PROVEN_MAPPING") return 92
  if (source === "PRODUCT_TRUTH") return 88
  if (source === "OFFICIAL_TITLE_SUGGESTION") return 84
  if (source === "MARKET_CONTEXT") return 56
  return 38
}

function addCandidate(
  candidates: Map<string, RankedCandidate>,
  input: Readonly<{
    categoryId: string
    categoryName?: string | null
    source: EbayCategoryCandidateSourceV1
    evidenceId?: string | null
    mappingId?: string | null
    freshMapping?: boolean
    staleMapping?: boolean
    listingAccepted?: boolean
    confidenceScore?: number
  }>,
) {
  const existing = candidates.get(input.categoryId) ?? {
    categoryId: input.categoryId,
    categoryName: input.categoryName ?? null,
    score: 0,
    sources: new Set<EbayCategoryCandidateSourceV1>(),
    evidenceIds: new Set<string>(),
    mappingIds: new Set<string>(),
    freshMapping: false,
    staleMapping: false,
    listingAccepted: false,
  }
  const newSource = !existing.sources.has(input.source)
  existing.sources.add(input.source)
  if (input.evidenceId) existing.evidenceIds.add(input.evidenceId)
  if (input.mappingId) existing.mappingIds.add(input.mappingId)
  existing.categoryName ||= input.categoryName ?? null
  existing.freshMapping ||= input.freshMapping === true
  existing.staleMapping ||= input.staleMapping === true
  existing.listingAccepted ||= input.listingAccepted === true
  existing.score = Math.max(
    existing.score,
    sourceBaseScore(input.source),
    input.confidenceScore ?? 0,
  ) + (newSource && existing.sources.size > 1 ? 4 : 0)
  if (input.freshMapping) existing.score = Math.max(existing.score, 94)
  if (input.listingAccepted) existing.score = Math.max(existing.score, 98)
  candidates.set(input.categoryId, existing)
}

export function rankEbayCategoryCandidatesV1(input: Readonly<{
  signals: EbayCategoryCandidateSignalV1[]
  learningRows: EbayCategoryResolverLearningRowV1[]
  now?: string | Date
}>) {
  const now = input.now instanceof Date
    ? input.now
    : new Date(validTimestamp(input.now) ?? new Date().toISOString())
  const candidates = new Map<string, RankedCandidate>()
  for (const signal of input.signals) {
    const normalizedCategoryId = categoryId(signal.categoryId)
    if (!normalizedCategoryId) continue
    addCandidate(candidates, { ...signal, categoryId: normalizedCategoryId })
  }
  for (const learning of input.learningRows) {
    if (!learning.taxonomyPass || !categoryId(learning.categoryId)) continue
    const revalidateAt = Date.parse(learning.revalidateAfter)
    const freshMapping = Number.isFinite(revalidateAt) && revalidateAt > now.getTime()
    addCandidate(candidates, {
      categoryId: learning.categoryId,
      categoryName: learning.categoryName,
      source: "PROVEN_MAPPING",
      evidenceId: learning.taxonomySnapshotDigest,
      mappingId: learning.id,
      freshMapping,
      staleMapping: !freshMapping,
      listingAccepted: learning.listingAcceptance === "ACCEPTED",
      confidenceScore: learning.confidenceScore,
    })
  }
  return [...candidates.values()].sort((left, right) =>
    right.score - left.score
    || Number(left.categoryId) - Number(right.categoryId)
    || left.categoryId.localeCompare(right.categoryId))
}

function taxonomyAspectSnapshot(aspect: EbayTaxonomyAspectIntelligence) {
  return {
    name: aspect.name,
    mode: aspect.mode,
    cardinality: aspect.cardinality,
    maxLength: aspect.maxLength,
    dataType: aspect.dataType,
    format: aspect.format,
    advancedDataType: aspect.advancedDataType,
    expectedRequiredByDate: aspect.expectedRequiredByDate,
    required: aspect.required,
    enabledForVariations: aspect.enabledForVariations,
    usage: aspect.usage,
    suggestedValues: aspect.suggestedValues,
    values: aspect.values,
    valuesComplete: aspect.valuesComplete,
    constraintsComplete: aspect.constraintsComplete,
  }
}

export function ebayCategoryTaxonomySnapshotDigestV1(
  taxonomy: EbayTaxonomyListingIntelligence,
) {
  return digest({
    source: taxonomy.source,
    taxonomyMarketplaceId: taxonomy.taxonomyMarketplaceId,
    categoryTreeId: taxonomy.categoryTreeId,
    categoryTreeVersion: taxonomy.categoryTreeVersion ?? "UNVERSIONED",
    categoryId: taxonomy.categoryId,
    categoryName: taxonomy.categoryName,
    aspects: taxonomy.aspects.map(taxonomyAspectSnapshot),
  })
}

function taxonomyExactPass(
  taxonomy: EbayTaxonomyListingIntelligence,
  expectedCategoryId: string,
) {
  return taxonomy.status === "AVAILABLE"
    && taxonomy.source === "EBAY_TAXONOMY_OFFICIAL_READONLY"
    && taxonomy.categoryId === expectedCategoryId
    && taxonomy.categoryResolution === "KNOWN_CATEGORY"
    && Boolean(taxonomy.categoryTreeId)
    && Boolean(taxonomy.observedAt)
}

export async function resolveEbayCategoryV1(input: Readonly<{
  productTruth: EbayCategoryResolverProductTruthV1
  learningRows?: EbayCategoryResolverLearningRowV1[]
  taxonomyReader: EbayCategoryResolverTaxonomyReaderV1
  now?: string | Date
}>) {
  const now = input.now instanceof Date
    ? input.now
    : new Date(validTimestamp(input.now) ?? new Date().toISOString())
  const learningRows = input.learningRows ?? []
  let ranked = rankEbayCategoryCandidatesV1({
    signals: input.productTruth.categorySignals,
    learningRows,
    now,
  })
  const topTwoAmbiguous = ranked.length > 1
    && ranked[0].score - ranked[1].score <
      EBAY_CATEGORY_RESOLVER_POLICY_V1.ambiguityMargin
  const needsOfficialSuggestion = !ranked.length
    || ranked[0].score < EBAY_CATEGORY_RESOLVER_POLICY_V1.highConfidenceMinimum
    || topTwoAmbiguous
  let officialSuggestionStatus: EbayTaxonomyListingIntelligence["status"] |
    null = null
  let officialSuggestionFailureCode: string | null = null
  if (needsOfficialSuggestion) {
    const suggestion = await input.taxonomyReader(
      input.productTruth.title,
      null,
      { allowTitleSuggestionFallback: false },
    )
    officialSuggestionStatus = suggestion.status
    officialSuggestionFailureCode = suggestion.failureCode
    if (suggestion.status === "AVAILABLE" && categoryId(suggestion.categoryId)) {
      ranked = rankEbayCategoryCandidatesV1({
        signals: [
          ...input.productTruth.categorySignals,
          {
            categoryId: String(suggestion.categoryId),
            categoryName: suggestion.categoryName,
            source: "OFFICIAL_TITLE_SUGGESTION",
            evidenceId: ebayCategoryTaxonomySnapshotDigestV1(suggestion),
          },
        ],
        learningRows,
        now,
      })
    }
  }

  const testedCategoryIds: string[] = []
  const validationFailures: string[] = []
  const validated: ValidatedCandidate[] = []
  for (const candidate of ranked.slice(
    0,
    EBAY_CATEGORY_RESOLVER_POLICY_V1.maximumCandidatesTested,
  )) {
    testedCategoryIds.push(candidate.categoryId)
    const taxonomy = await input.taxonomyReader(
      input.productTruth.title,
      candidate.categoryId,
      { allowTitleSuggestionFallback: false },
    )
    if (!taxonomyExactPass(taxonomy, candidate.categoryId)) {
      validationFailures.push(
        `${candidate.categoryId}:${taxonomy.failureCode ?? taxonomy.status}`,
      )
      continue
    }
    validated.push(Object.freeze({
      categoryId: candidate.categoryId,
      categoryName: taxonomy.categoryName ?? candidate.categoryName,
      score: Math.min(100, candidate.score + 6),
      sources: [...candidate.sources].sort(),
      mappingIds: [...candidate.mappingIds].sort(),
      taxonomy,
      taxonomySnapshotDigest: ebayCategoryTaxonomySnapshotDigestV1(taxonomy),
      taxonomyTreeVersion: taxonomy.categoryTreeVersion ?? "UNVERSIONED",
      freshMapping: candidate.freshMapping,
      staleMapping: candidate.staleMapping,
    }))
  }
  validated.sort((left, right) =>
    right.score - left.score
    || Number(left.categoryId) - Number(right.categoryId)
    || left.categoryId.localeCompare(right.categoryId))
  const selected = validated[0] ?? null
  const runnerUp = validated[1] ?? null
  const ambiguous = Boolean(selected && runnerUp
    && selected.categoryId !== runnerUp.categoryId
    && selected.score - runnerUp.score
      < EBAY_CATEGORY_RESOLVER_POLICY_V1.ambiguityMargin)
  const highConfidence = Boolean(selected
    && selected.score >= EBAY_CATEGORY_RESOLVER_POLICY_V1.highConfidenceMinimum
    && !ambiguous)
  if (!selected || !highConfidence) {
    const capabilityUnavailable = officialSuggestionStatus === "REQUEST_FAILED"
      || (testedCategoryIds.length > 0
        && validationFailures.length === testedCategoryIds.length
        && validationFailures.every((failure) =>
          /REQUEST_FAILED|EBAY_(?:READONLY|TAXONOMY)_/.test(failure)))
    return Object.freeze({
      authorityClass: EBAY_CATEGORY_RESOLVER_V1,
      status: "CATEGORY_EXCEPTION" as const,
      resolutionClass: selected ? "AMBIGUOUS" as const : "UNRESOLVED" as const,
      selectedCategory: null,
      testedCategoryIds,
      validationFailures,
      categoryCandidateCount: ranked.length,
      categoryConfidence: selected?.score ?? null,
      categorySource: selected?.sources ?? [],
      categoryBlockerReason: capabilityUnavailable
        ? "WAITING_FOR_EBAY_CAPABILITY"
        : selected ? "CATEGORY_AMBIGUOUS" : "CATEGORY_UNRESOLVED",
      capabilityUnavailable,
      officialSuggestionStatus,
      officialSuggestionFailureCode,
      boundedCandidateLimit:
        EBAY_CATEGORY_RESOLVER_POLICY_V1.maximumCandidatesTested,
      factoryContinuationAllowed: true as const,
      manualCategorySelectionRequired: false as const,
      codexRequired: false as const,
      marketplaceWrites: 0 as const,
    })
  }
  return Object.freeze({
    authorityClass: EBAY_CATEGORY_RESOLVER_V1,
    status: "AUTO_SELECTED" as const,
    resolutionClass: "HIGH_CONFIDENCE" as const,
    selectedCategory: selected,
    testedCategoryIds,
    validationFailures,
    categoryCandidateCount: ranked.length,
    categoryConfidence: selected.score,
    categorySource: selected.sources,
    categoryBlockerReason: null,
    capabilityUnavailable: false,
    officialSuggestionStatus,
    officialSuggestionFailureCode,
    boundedCandidateLimit: EBAY_CATEGORY_RESOLVER_POLICY_V1.maximumCandidatesTested,
    factoryContinuationAllowed: true as const,
    manualCategorySelectionRequired: false as const,
    codexRequired: false as const,
    marketplaceWrites: 0 as const,
  })
}

function mapLearningRow(value: unknown): EbayCategoryResolverLearningRowV1 | null {
  const row = record(value)
  const mapped: EbayCategoryResolverLearningRowV1 = {
    id: text(row.id, 64),
    accountKey: text(row.account_key, 160),
    marketplaceId: "EBAY_US",
    normalizedProductFamily: text(row.normalized_product_family, 160),
    normalizedProductType: text(row.normalized_product_type, 160),
    familyTypeFingerprint: text(row.family_type_fingerprint, 80),
    categoryId: categoryId(row.category_id),
    categoryName: text(row.category_name, 200) || null,
    taxonomyTreeId: text(row.taxonomy_tree_id, 20),
    taxonomyTreeVersion: text(row.taxonomy_tree_version, 80),
    taxonomySnapshotDigest: text(row.taxonomy_snapshot_digest, 80),
    taxonomyPass: true,
    requiredAspects: array(row.required_aspects),
    listingAcceptance: ["ACCEPTED", "REJECTED"].includes(text(row.listing_acceptance))
      ? text(row.listing_acceptance) as "ACCEPTED" | "REJECTED"
      : "UNKNOWN",
    confidenceTier: ["HIGH_CONFIDENCE", "MEDIUM_CONFIDENCE"]
      .includes(text(row.confidence_tier))
      ? text(row.confidence_tier) as "HIGH_CONFIDENCE" | "MEDIUM_CONFIDENCE"
      : "LOW_CONFIDENCE",
    confidenceScore: Number(row.confidence_score),
    lastValidatedAt: text(row.last_validated_at, 64),
    revalidateAfter: text(row.revalidate_after, 64),
  }
  if (
    !/^[0-9a-f-]{36}$/i.test(mapped.id)
    || !mapped.accountKey
    || row.marketplace_id !== "EBAY_US"
    || normalizeIdentityPhrase(mapped.normalizedProductFamily)
      !== mapped.normalizedProductFamily
    || normalizeIdentityPhrase(mapped.normalizedProductType)
      !== mapped.normalizedProductType
    || !mapped.categoryId
    || !/^sha256:[0-9a-f]{64}$/.test(mapped.familyTypeFingerprint)
    || !/^sha256:[0-9a-f]{64}$/.test(mapped.taxonomySnapshotDigest)
    || !mapped.taxonomyTreeId
    || !mapped.taxonomyTreeVersion
    || !Number.isFinite(mapped.confidenceScore)
    || !validTimestamp(mapped.lastValidatedAt)
    || !validTimestamp(mapped.revalidateAfter)
    || row.taxonomy_pass !== true
  ) return null
  return mapped
}

export async function loadEbayCategoryResolverLearningV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  productTruth: EbayCategoryResolverProductTruthV1
}>) {
  const { data, error } = await input.supabase
    .from("ebay_category_resolution_learning_v1")
    .select("id,account_key,marketplace_id,normalized_product_family,normalized_product_type,family_type_fingerprint,category_id,category_name,taxonomy_tree_id,taxonomy_tree_version,taxonomy_snapshot_digest,taxonomy_pass,required_aspects,listing_acceptance,confidence_tier,confidence_score,last_validated_at,revalidate_after")
    .eq("account_key", input.accountKey)
    .eq("marketplace_id", "EBAY_US")
    .eq("family_type_fingerprint", input.productTruth.familyTypeFingerprint)
    .eq("taxonomy_pass", true)
    .order("last_validated_at", { ascending: false })
    .limit(25)
  if (error) throw new Error("EBAY_CATEGORY_RESOLVER_LEARNING_READ_FAILED")
  return (data ?? []).map(mapLearningRow)
    .filter((row): row is EbayCategoryResolverLearningRowV1 => Boolean(row))
    .filter((row) =>
      row.normalizedProductFamily === input.productTruth.normalizedProductFamily
      && row.normalizedProductType === input.productTruth.normalizedProductType)
}

function durableRequiredAspectSnapshot(
  aspects: EbayTaxonomyAspectIntelligence[],
) {
  return aspects.map(taxonomyAspectSnapshot)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function persistEbayCategoryResolverLearningV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  context: EbayListingContextIdentityV1
  productTruth: EbayCategoryResolverProductTruthV1
  selected: ValidatedCandidate
  now?: string | Date
}>) {
  const validatedAt = input.now instanceof Date
    ? input.now.toISOString()
    : validTimestamp(input.now) ?? new Date().toISOString()
  const revalidateAfter = new Date(
    Date.parse(validatedAt)
    + EBAY_CATEGORY_RESOLVER_POLICY_V1.learningFreshnessMs,
  ).toISOString()
  const { data, error } = await input.supabase.rpc(
    "upsert_ebay_category_resolution_learning_v1",
    {
      p_account_key: input.accountKey,
      p_marketplace_id: "EBAY_US",
      p_normalized_product_family:
        input.productTruth.normalizedProductFamily,
      p_normalized_product_type: input.productTruth.normalizedProductType,
      p_family_type_fingerprint: input.productTruth.familyTypeFingerprint,
      p_category_id: input.selected.categoryId,
      p_category_name: input.selected.categoryName,
      p_taxonomy_tree_id: input.selected.taxonomy.categoryTreeId,
      p_taxonomy_tree_version: input.selected.taxonomyTreeVersion,
      p_taxonomy_snapshot_digest: input.selected.taxonomySnapshotDigest,
      p_required_aspects: durableRequiredAspectSnapshot(
        input.selected.taxonomy.requiredAspects,
      ),
      p_confidence_tier: "HIGH_CONFIDENCE",
      p_confidence_score: input.selected.score,
      p_provenance: {
        authorityClass: EBAY_CATEGORY_RESOLVER_V1,
        officialTaxonomySource: input.selected.taxonomy.source,
        candidateSources: input.selected.sources,
        priorMappingIds: input.selected.mappingIds,
        freshMappingRevalidated: input.selected.freshMapping,
        staleMappingRevalidated: input.selected.staleMapping,
        productValuesCopiedAcrossCandidates: false,
        marketplaceWrites: 0,
      },
      p_source_listing_package_id: input.context.listingPackageId,
      p_source_opportunity_id: input.context.opportunityId,
      p_source_candidate_key: input.context.candidateKey,
      p_validated_at: validatedAt,
      p_revalidate_after: revalidateAfter,
    },
  )
  const row = mapLearningRow(Array.isArray(data) ? data[0] : data)
  if (error || !row) {
    throw new Error("EBAY_CATEGORY_RESOLVER_LEARNING_WRITE_FAILED")
  }
  return row
}

export async function resolveAndBindEbayListingCategoryV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  context: EbayListingContextIdentityV1
  opportunity: JsonRecord
  packageData: JsonRecord
  taxonomyReader: EbayCategoryResolverTaxonomyReaderV1
  exactCanonicalCategory?: EbayExactCanonicalCategoryAuthorityV1 | null
  now?: string | Date
}>) {
  const productTruth = buildEbayCategoryResolverProductTruthV1({
    opportunity: input.opportunity,
    packageData: input.packageData,
  })
  const exactCanonicalAuthoritySupplied = input.exactCanonicalCategory
    ?.exactProductIdentityVerified === true
  const exactCanonicalCategoryId = exactCanonicalAuthoritySupplied
    ? categoryId(input.exactCanonicalCategory.categoryId) : ""
  if (exactCanonicalAuthoritySupplied && !exactCanonicalCategoryId) {
    throw new Error("EBAY_EXACT_CANONICAL_CATEGORY_AUTHORITY_INVALID")
  }
  const exactCanonicalTaxonomy = exactCanonicalCategoryId
    ? await input.taxonomyReader(
      productTruth.title,
      exactCanonicalCategoryId,
      { allowTitleSuggestionFallback: false },
    ) : null
  const exactCanonicalCategoryPass = Boolean(
    exactCanonicalTaxonomy
    && taxonomyExactPass(exactCanonicalTaxonomy, exactCanonicalCategoryId),
  )
  const learningRows = exactCanonicalCategoryId
    ? []
    : await loadEbayCategoryResolverLearningV1({
      supabase: input.supabase,
      accountKey: input.accountKey,
      productTruth,
    })
  const resolution = exactCanonicalCategoryId
    ? Object.freeze({
      authorityClass: input.exactCanonicalCategory?.authorityClass
        ?? EBAY_CATEGORY_RESOLVER_V1,
      status: exactCanonicalCategoryPass
        ? "AUTO_SELECTED" as const : "CATEGORY_EXCEPTION" as const,
      resolutionClass: exactCanonicalCategoryPass
        ? "HIGH_CONFIDENCE" as const : "UNRESOLVED" as const,
      selectedCategory: exactCanonicalCategoryPass && exactCanonicalTaxonomy
        ? Object.freeze({
          categoryId: exactCanonicalCategoryId,
          categoryName: exactCanonicalTaxonomy.categoryName
            ?? input.exactCanonicalCategory?.categoryName ?? null,
          score: 100,
          sources: ["PRODUCT_TRUTH" as const],
          mappingIds: [],
          taxonomy: exactCanonicalTaxonomy,
          taxonomySnapshotDigest:
            ebayCategoryTaxonomySnapshotDigestV1(exactCanonicalTaxonomy),
          taxonomyTreeVersion:
            exactCanonicalTaxonomy.categoryTreeVersion ?? "UNVERSIONED",
          freshMapping: false,
          staleMapping: false,
        })
        : null,
      testedCategoryIds: [exactCanonicalCategoryId],
      validationFailures: exactCanonicalCategoryPass
        ? [] : [`${exactCanonicalCategoryId}:${
          exactCanonicalTaxonomy?.failureCode
            ?? exactCanonicalTaxonomy?.status ?? "UNAVAILABLE"}`],
      categoryCandidateCount: 1,
      categoryConfidence: exactCanonicalCategoryPass ? 100 : null,
      categorySource: ["PRODUCT_TRUTH" as const],
      categoryBlockerReason: exactCanonicalCategoryPass
        ? null : exactCanonicalTaxonomy?.status === "REQUEST_FAILED"
          ? "WAITING_FOR_EBAY_CAPABILITY" : "CATEGORY_UNRESOLVED",
      capabilityUnavailable:
        exactCanonicalTaxonomy?.status === "REQUEST_FAILED",
      officialSuggestionStatus: null,
      officialSuggestionFailureCode: null,
      boundedCandidateLimit: 1,
      factoryContinuationAllowed: true as const,
      manualCategorySelectionRequired: false as const,
      codexRequired: false as const,
      marketplaceWrites: 0 as const,
    })
    : await resolveEbayCategoryV1({
      productTruth,
      learningRows,
      taxonomyReader: input.taxonomyReader,
      now: input.now,
    })
  const contextBinding = {
    contextBindingVersion: "SELLER_OS_EBAY_LISTING_CONTEXT_ISOLATION_V1",
    marketplaceId: input.context.marketplaceId,
    listingPackageId: input.context.listingPackageId,
    opportunityId: input.context.opportunityId,
    candidateKey: input.context.candidateKey,
  }
  if (resolution.status !== "AUTO_SELECTED" || !resolution.selectedCategory) {
    return Object.freeze({
      packageData: {
        ...input.packageData,
        categoryResolverV1: {
          ...contextBinding,
          ...resolution,
          normalizedProductFamily: productTruth.normalizedProductFamily,
          normalizedProductType: productTruth.normalizedProductType,
          familyTypeFingerprint: productTruth.familyTypeFingerprint,
          categoryResolutionAttempted: true,
          categoryCandidateCount: resolution.categoryCandidateCount,
          categoryConfidence: resolution.categoryConfidence,
          categorySource: resolution.categorySource,
          categoryBlockerReason: resolution.categoryBlockerReason,
          capabilityUnavailable: resolution.capabilityUnavailable,
        },
      },
      resolution,
      learning: null,
      taxonomyPreflight: null,
    })
  }
  const selected = resolution.selectedCategory
  const existingTaxonomyPreflight = record(
    input.packageData.taxonomyPreflight,
  )
  const existingCategoryResolver = record(
    input.packageData.categoryResolverV1,
  )
  const existingAspectBindingIsCurrent =
    categoryResolverBindingMatchesContextV1({
      expected: input.context,
      categoryResolver: existingCategoryResolver,
      taxonomyPreflight: existingTaxonomyPreflight,
      categoryId: selected.categoryId,
    })
    && existingCategoryResolver.taxonomySnapshotDigest
      === selected.taxonomySnapshotDigest
  const preflight = buildEbayListingTaxonomyPreflightV1({
    taxonomy: selected.taxonomy,
    expectedCategoryId: selected.categoryId,
    context: input.context,
    // Product-specific values are never learned or copied across candidates.
    // Existing values survive only when the exact package/candidate/category
    // binding and the currently observed official Taxonomy snapshot still
    // agree. Product Truth values below are always eligible to rebind.
    existingAspects: existingAspectBindingIsCurrent
      ? record(input.packageData.aspects) : {},
    provenProductValues: productTruth.provenProductValues,
    knownUnknownAspectNames: productTruth.knownUnknownAspectNames,
    unprovenAspectEvidenceRequirements:
      productTruth.unprovenAspectEvidenceRequirements,
  })
  const learning = exactCanonicalCategoryId
    ? null
    : await persistEbayCategoryResolverLearningV1({
      supabase: input.supabase,
      accountKey: input.accountKey,
      context: input.context,
      productTruth,
      selected,
      now: input.now,
    })
  return Object.freeze({
    packageData: {
      ...input.packageData,
      categoryId: selected.categoryId,
      categoryName: selected.categoryName ?? input.packageData.categoryName ?? null,
      aspects: preflight.resolvedAspects,
      taxonomyPreflight: preflight,
      categoryResolverV1: {
        ...contextBinding,
        authorityClass: exactCanonicalCategoryId
          ? input.exactCanonicalCategory?.authorityClass
            ?? EBAY_CATEGORY_RESOLVER_V1
          : EBAY_CATEGORY_RESOLVER_V1,
        status: resolution.status,
        resolutionClass: resolution.resolutionClass,
        normalizedProductFamily: productTruth.normalizedProductFamily,
        normalizedProductType: productTruth.normalizedProductType,
        familyTypeFingerprint: productTruth.familyTypeFingerprint,
        categoryResolutionAttempted: true,
        categoryCandidateCount: resolution.categoryCandidateCount,
        categoryConfidence: resolution.categoryConfidence,
        categorySource: resolution.categorySource,
        categoryBlockerReason: null,
        capabilityUnavailable: false,
        selectedCategoryId: selected.categoryId,
        taxonomySnapshotDigest: selected.taxonomySnapshotDigest,
        taxonomyPreflightEvidenceDigest: preflight.evidenceDigest,
        taxonomyTreeVersion: selected.taxonomyTreeVersion,
        learningId: learning?.id ?? null,
        testedCategoryIds: resolution.testedCategoryIds,
        listingAcceptance: learning?.listingAcceptance ?? "UNKNOWN",
        manualCategorySelectionRequired: false,
        categorySelectionMode: exactCanonicalCategoryId
          ? "PRESERVED_EXACT_CANONICAL_AUTHORITY"
          : "AUTOMATIC_CATEGORY_RESOLUTION",
        exactCanonicalCategoryPreserved: Boolean(exactCanonicalCategoryId),
        explicitReclassificationRequired: Boolean(exactCanonicalCategoryId),
        codexRequired: false,
        marketplaceWrites: 0,
      },
    },
    resolution,
    learning,
    taxonomyPreflight: preflight,
  })
}

const CANONICAL_CATEGORY_BINDING_FIELDS = [
  "categoryId",
  "categoryName",
  "aspects",
  "taxonomyPreflight",
  "categoryResolverV1",
] as const

function canonicalCategoryBindingProjectionV1(
  packageData: Record<string, unknown>,
) {
  return Object.fromEntries(CANONICAL_CATEGORY_BINDING_FIELDS.map((field) => [
    field,
    packageData[field] ?? null,
  ]))
}

export function canonicalCategoryBindingNeedsDurableSaveV1(input: Readonly<{
  currentPackageData: Record<string, unknown>
  resolvedPackageData: Record<string, unknown>
}>) {
  return !isDeepStrictEqual(
    canonicalCategoryBindingProjectionV1(input.currentPackageData),
    canonicalCategoryBindingProjectionV1(input.resolvedPackageData),
  )
}

export function mergeCanonicalCategoryBindingV1(input: Readonly<{
  durablePackageData: Record<string, unknown>
  resolvedPackageData: Record<string, unknown>
}>) {
  const next = { ...input.durablePackageData }
  for (const field of CANONICAL_CATEGORY_BINDING_FIELDS) {
    next[field] = input.resolvedPackageData[field] ?? null
  }
  return next
}

export async function recordEbayCategoryListingAcceptanceV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  listingPackageId: string
  packageData: JsonRecord
  categoryId: string
  listingAcceptance: "ACCEPTED" | "REJECTED"
  ebayItemId?: string | null
  observedAt?: string | Date
}>) {
  const resolution = record(input.packageData.categoryResolverV1)
  const learningId = text(resolution.learningId, 64)
  if (!/^[0-9a-f-]{36}$/i.test(learningId)) {
    return { recorded: false as const, reason: "CATEGORY_RESOLVER_LEARNING_ID_UNAVAILABLE" as const }
  }
  const observedAt = input.observedAt instanceof Date
    ? input.observedAt.toISOString()
    : validTimestamp(input.observedAt) ?? new Date().toISOString()
  const { data, error } = await input.supabase.rpc(
    "record_ebay_category_listing_acceptance_v1",
    {
      p_learning_id: learningId,
      p_account_key: input.accountKey,
      p_listing_package_id: input.listingPackageId,
      p_category_id: input.categoryId,
      p_listing_acceptance: input.listingAcceptance,
      p_ebay_item_id: input.listingAcceptance === "ACCEPTED"
        ? input.ebayItemId ?? null : null,
      p_observed_at: observedAt,
    },
  )
  const row = mapLearningRow(Array.isArray(data) ? data[0] : data)
  if (error || !row) {
    throw new Error("EBAY_CATEGORY_RESOLVER_LISTING_ACCEPTANCE_WRITE_FAILED")
  }
  return { recorded: true as const, learning: row }
}
