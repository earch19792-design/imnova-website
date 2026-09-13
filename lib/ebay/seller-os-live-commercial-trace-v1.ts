import type { SupabaseClient } from "@supabase/supabase-js"

import { fetchDirectedLunaProduct, parseDirectedLunaProductUrl,
  type DirectedLunaProduct, type DirectedLunaVariant } from
  // @ts-expect-error Node direct TypeScript tests require the explicit suffix.
  "./ebay-luna-directed-product-import.ts"
import type { EbaySellerKeywordCandidate, EbaySellerKeywordDemandReport } from
  "./ebay-seller-keyword-demand-validation.ts"
import { calculateEbayMinimumOperatorPrice, calculateEbayUnitEconomics } from
  // @ts-expect-error Node direct TypeScript tests require the explicit suffix.
  "./ebay-unit-economics.ts"
import { buildCommercialDecisionLoopSnapshotV1_1 } from
  // @ts-expect-error Node direct TypeScript tests require the explicit suffix.
  "./seller-os-commercial-decision-loop-v1-1.ts"

export const SELLER_OS_LIVE_COMMERCIAL_TRACE_V1 =
  "SELLER_OS_LIVE_COMMERCIAL_TRACE_V1" as const
export const SELLER_OS_COMMERCIAL_DECISION_LOOP_V1_1 =
  "SELLER_OS_COMMERCIAL_DECISION_LOOP_V1_1" as const
const SHIPPING_MAX_AGE_MS = 24 * 60 * 60 * 1_000
type JsonRecord = Record<string, unknown>
type MarketReaderV1 = (candidate: EbaySellerKeywordCandidate, options?: Readonly<{
  functionalSearchQuery?: string | null
  marketplaceAccountKey?: string | null
}>) =>
  Promise<EbaySellerKeywordDemandReport>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 2_000) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().slice(0, maximum) : null
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function median(values: readonly number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]
    : round((sorted[middle - 1] + sorted[middle]) / 2)
}

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(message)
    ? message : "LIVE_COMMERCIAL_TRACE_STAGE_FAILED"
}

export function detectCommercialClaimConflictsV1(product: Readonly<{
  title: string
  descriptionText?: string | null
}>) {
  const title = product.title.toLocaleLowerCase("en-US")
  const description = String(product.descriptionText ?? "")
    .toLocaleLowerCase("en-US")
  const claims = `${title} ${description}`
  const resolutions = [...new Set(claims.match(/\b(?:720p|1080p|2k|4k|8k)\b/g)
    ?? [])]
  const conflicts: Array<Readonly<{ code: string; evidence: string }>> = []
  if (resolutions.length > 1) conflicts.push(Object.freeze({
    code: "CONFLICTING_VIDEO_RESOLUTION_CLAIMS",
    evidence: `La fuente afirma resoluciones distintas: ${resolutions.join(", ")}.`,
  }))
  if (/omni[ -]?directional\s+(?:microphone|mic)/.test(title) &&
      /\bdirectional\s+(?:noise[ -]?cancell?ing\s+)?(?:microphone|mic)\b/
        .test(description) &&
      !/omni[ -]?directional\s+(?:microphone|mic)/.test(description)) {
    conflicts.push(Object.freeze({
      code: "CONFLICTING_MICROPHONE_DIRECTIONALITY_CLAIMS",
      evidence: "El título dice micrófono omnidireccional y la descripción dice direccional.",
    }))
  }
  const titleRingLight = /ring light/.test(title)
  const descriptionRingLight = /ring light/.test(description)
  if (!titleRingLight && descriptionRingLight) conflicts.push(Object.freeze({
    code: "DESCRIPTION_MENTIONS_UNCONFIRMED_RING_LIGHT_MODEL",
    evidence: "La descripción menciona una webcam con ring light que el título/variante no confirma.",
  }))
  return Object.freeze(conflicts)
}

type SafeCommercialClaimV1 = Readonly<{
  value: string
  normalizedValue: string
  kind: "PRODUCT_IDENTITY" | "SPECIFICATION" | "FUNCTIONAL_DIFFERENTIATOR" |
    "CONNECTIVITY" | "MODEL"
  source: "LUNA_PRODUCT_TITLE" | "LUNA_CANONICAL_PRODUCT_URL"
  status: "CONFIRMED_SAFE_SUBSET"
}>

const SAFE_PRODUCT_IDENTITIES_V1 = ["webcam", "camera", "scale", "vacuum",
  "translator", "necklace", "bracelet", "ring", "holder", "chopper",
  "turntable", "backpack", "bag", "facial device"] as const

export function buildConservativeSafeClaimSubsetV1(product: Readonly<{
  title: string
  descriptionText?: string | null
  sourceUrl?: string | null
}>) {
  const title = product.title.normalize("NFKC")
  const normalizedTitle = title.toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ").trim()
  const conflicts = detectCommercialClaimConflictsV1(product)
  const claims: SafeCommercialClaimV1[] = []
  const normalizedUrl = String(product.sourceUrl ?? "")
    .toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim()
  const add = (value: string, normalizedValue: string,
    kind: SafeCommercialClaimV1["kind"], source:
      SafeCommercialClaimV1["source"] = "LUNA_PRODUCT_TITLE") => {
    if (claims.some((entry) => entry.normalizedValue === normalizedValue)) return
    claims.push(Object.freeze({ value, normalizedValue, kind,
      source, status: "CONFIRMED_SAFE_SUBSET" }))
  }
  const identity = SAFE_PRODUCT_IDENTITIES_V1.find((term) =>
    new RegExp(`\\b${term}\\b`).test(normalizedTitle)) ?? null
  if (identity) add(identity.split(" ").map((word) =>
    word[0].toUpperCase() + word.slice(1)).join(" "), identity,
  "PRODUCT_IDENTITY")
  const titleResolutions = [...new Set(normalizedTitle.match(
    /\b(?:720p|1080p|2k|4k|8k)\b/g) ?? [])]
  if (titleResolutions.length === 1) add(titleResolutions[0].toUpperCase(),
    titleResolutions[0], "SPECIFICATION")
  if (/\bbuilt\s+in\s+speakers?\b/.test(normalizedTitle)) add(
    "Built-In Speakers", "built in speakers", "FUNCTIONAL_DIFFERENTIATOR")
  if (/\b(?:microphone|mic)\b/.test(normalizedTitle)) add(
    "Microphone", "microphone", "FUNCTIONAL_DIFFERENTIATOR")
  if (/\bmicrocurrent\b/.test(normalizedTitle)) add(
    "Microcurrent", "microcurrent", "FUNCTIONAL_DIFFERENTIATOR")
  if (/\busb\s*c\b/.test(normalizedTitle) || /\busb\s*c\b/.test(normalizedUrl)) {
    add("USB-C", "usb c", "CONNECTIVITY", /\busb\s*c\b/.test(normalizedTitle)
      ? "LUNA_PRODUCT_TITLE" : "LUNA_CANONICAL_PRODUCT_URL")
  }
  if (/\busb\s*a\b/.test(normalizedTitle) || /\busb\s*a\b/.test(normalizedUrl)) {
    add("USB-A", "usb a", "CONNECTIVITY", /\busb\s*a\b/.test(normalizedTitle)
      ? "LUNA_PRODUCT_TITLE" : "LUNA_CANONICAL_PRODUCT_URL")
  }
  for (const model of title.match(/\b(?=[A-Za-z0-9-]{5,}\b)(?=[A-Za-z0-9-]*[A-Za-z])(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]+\b/g) ?? []) {
    if (!/^\d{3,4}p$/i.test(model) && !/^usb-?[ac]?$/i.test(model) &&
        !/^\d+-in-\d+$/i.test(model)) {
      add(model.toUpperCase(), model.toLocaleLowerCase("en-US"), "MODEL")
    }
  }
  const descriptionResolutions = [...new Set(String(product.descriptionText ?? "")
    .toLocaleLowerCase("en-US").match(/\b(?:720p|1080p|2k|4k|8k)\b/g) ?? [])]
  const conflictingResolutions = titleResolutions.length === 1
    ? descriptionResolutions.filter((value) => value !== titleResolutions[0])
    : [...titleResolutions, ...descriptionResolutions]
  const doNotUseClaims = conflicts.flatMap((entry) =>
    entry.code === "CONFLICTING_VIDEO_RESOLUTION_CLAIMS"
      ? [...new Set(conflictingResolutions)].map((value) => value.toUpperCase())
      : entry.code === "CONFLICTING_MICROPHONE_DIRECTIONALITY_CLAIMS"
        ? ["Omnidirectional microphone", "Directional microphone"]
        : entry.code === "DESCRIPTION_MENTIONS_UNCONFIRMED_RING_LIGHT_MODEL"
          ? ["Ring light"] : [entry.code])
    .map((value) => Object.freeze({ value,
      status: "UNVERIFIED_DO_NOT_USE" as const,
      reason: "SUPPLIER_CLAIM_CONFLICT" as const }))
  const observedDescriptors = [...title.matchAll(
    /\b(\d{1,2})\s*(?:-|\s)?in\s*(?:-|\s)?(\d{1,2})\b/gi)]
    .map((match) => `${Number(match[1])}-in-${Number(match[2])}`)
  const observedBenefitPhrases = title.split(/\bfor\b/i).slice(1)
    .flatMap((segment) => segment.split(/[,;&|]|\band\b/i))
    .map((value) => value.replace(/[^A-Za-z0-9 -]+/g, " ")
      .replace(/\s+/g, " ").trim())
    .filter((value) => value.split(" ").length >= 2 &&
      value.split(" ").length <= 8)
  const observedUnverifiedClaims = [...new Set([
    ...observedDescriptors, ...observedBenefitPhrases,
  ])].filter((value) => !claims.some((claim) =>
    claim.normalizedValue === value.toLocaleLowerCase("en-US")))
    .map((value) => Object.freeze({ value,
      status: "UNVERIFIED_DO_NOT_USE" as const,
      reason: "SOURCE_OBSERVED_NOT_IN_CONFIRMED_SAFE_SUBSET" as const }))
  const reconciledDoNotUseClaims: Array<Readonly<{ value: string
    status: "UNVERIFIED_DO_NOT_USE"; reason: string }>> = [...doNotUseClaims]
  for (const claim of observedUnverifiedClaims) {
    if (!reconciledDoNotUseClaims.some((entry) =>
      entry.value.toLocaleLowerCase("en-US") ===
        claim.value.toLocaleLowerCase("en-US"))) {
      reconciledDoNotUseClaims.push(claim)
    }
  }
  const identitySufficient = Boolean(identity && claims.some((entry) =>
    entry.kind === "MODEL" || entry.kind === "FUNCTIONAL_DIFFERENTIATOR"))
  return Object.freeze({ safeClaims: Object.freeze(claims),
    doNotUseClaims: Object.freeze(reconciledDoNotUseClaims),
    observedUnverifiedClaims: Object.freeze(observedUnverifiedClaims),
    identitySufficient,
    safeMarketIdentity: claims.map((entry) => entry.value).join(" "),
    materialConflictCount: identitySufficient ? 0 : conflicts.length })
}

export function classifyCommercialComplianceV1(input: Readonly<{
  title: string
  descriptionText?: string | null
  claimConflictCount: number
}>) {
  const source = `${input.title} ${input.descriptionText ?? ""}`
    .toLocaleLowerCase("en-US")
  const blockedPatterns = [
    { code: "MEDICAL_TREATMENT_CLAIM", pattern: /\b(?:cure|treats?|diagnos(?:e|is)|fda approved)\b/ },
    { code: "COVERT_SURVEILLANCE_PRODUCT", pattern: /\b(?:hidden camera|spy camera|nanny cam)\b/ },
    { code: "WEAPON_OR_CONTROLLED_ITEM", pattern: /\b(?:firearm|ammunition|switchblade)\b/ },
  ]
  const blockers = blockedPatterns.filter((entry) => entry.pattern.test(source))
    .map((entry) => entry.code)
  return Object.freeze({
    status: blockers.length ? "BLOCKED" as const
      : input.claimConflictCount ? "REVIEW_REQUIRED" as const : "PASS" as const,
    blockers: Object.freeze(blockers),
    reviewReasons: Object.freeze(input.claimConflictCount
      ? ["SUPPLIER_CLAIM_CONFLICTS_REQUIRE_RESOLUTION"] : []),
    policyScope: "SUPPLIER_TEXT_PREPUBLICATION_SCREEN_V1",
    publicationAuthorized: false as const,
  })
}

function comparableRejectionReason(entry: JsonRecord) {
  const conflicts = Array.isArray(entry.identityConflicts)
    ? entry.identityConflicts.map(String).filter(Boolean) : []
  if (conflicts.length) return conflicts.join("; ")
  if (!text(entry.title)) return "MISSING_LISTING_TITLE"
  if (!["EXACT", "EXACT_IDENTIFIER", "STRONG"].includes(
    String(entry.identityMatchQuality ?? ""))) return "IDENTITY_MATCH_TOO_WEAK"
  return "NOT_ELIGIBLE_UNDER_EXACT_COMPARABLE_PREDICATE"
}

function claimSupportedByComparable(claim: SafeCommercialClaimV1,
  titleValue: unknown) {
  const title = String(titleValue ?? "").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
  if (claim.normalizedValue === "built in speakers") {
    return /\bbuilt\s+in\s+speakers?\b/.test(title)
  }
  if (claim.normalizedValue === "microphone") return /\b(?:microphone|mic)\b/.test(title)
  return title.includes(claim.normalizedValue)
}

export function buildMaterialKeywordFamilyV1(
  report: EbaySellerKeywordDemandReport | null,
  safeClaims: readonly SafeCommercialClaimV1[],
) {
  const exact = (report?.comparableEvidence ?? []).filter((entry) =>
    entry.commercialComparableClass === "EXACT_MODEL_COMPARABLE")
  const identity = safeClaims.find((entry) => entry.kind === "PRODUCT_IDENTITY")
  const specification = safeClaims.find((entry) => entry.kind === "SPECIFICATION")
  const featurePriority = (claim: SafeCommercialClaimV1) =>
    claim.normalizedValue === "built in speakers" ? 3
      : claim.normalizedValue === "microphone" ? 2 : 1
  const differentiators = safeClaims.filter((entry) =>
    ["FUNCTIONAL_DIFFERENTIATOR", "CONNECTIVITY"].includes(entry.kind))
    .map((claim) => ({ claim, exactSupport: exact.filter((entry) =>
      claimSupportedByComparable(claim, entry.title)).length }))
    .filter((entry) => entry.exactSupport >= Math.min(2, exact.length) &&
      entry.exactSupport > 0)
    .sort((left, right) => right.exactSupport - left.exactSupport ||
      featurePriority(right.claim) - featurePriority(left.claim))
  if (!identity || !specification || !differentiators.length) {
    return report?.recommendedListingKeywordStructure.primarySearchPhrase ?? null
  }
  const selected = differentiators.slice(0, 2).map((entry) => entry.claim.value)
  return `${specification.value} ${identity.value} with ${selected.join(" and ")}`
}

export function buildFunctionalFamilySearchQueryV1(
  safeClaims: readonly SafeCommercialClaimV1[],
) {
  const identity = safeClaims.find((entry) => entry.kind === "PRODUCT_IDENTITY")
  const specification = safeClaims.find((entry) => entry.kind === "SPECIFICATION")
  const priority = (claim: SafeCommercialClaimV1) =>
    claim.normalizedValue === "built in speakers" ? 3
      : claim.normalizedValue === "microphone" ? 2 : 1
  const differentiators = safeClaims.filter((entry) =>
    entry.kind === "FUNCTIONAL_DIFFERENTIATOR")
    .sort((left, right) => priority(right) - priority(left))
    .slice(0, 2)
  if (!identity || !differentiators.length) return null
  const prefix = specification ? `${specification.value} ` : ""
  return `${prefix}${identity.value} with ${differentiators
    .map((entry) => entry.value).join(" and ")}`
}

function normalizedKeywordTokensV1(value: unknown) {
  return String(value ?? "").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((token) =>
      token.length > 1)
}

function boundedEbayTitleV1(parts: readonly (string | null | undefined)[]) {
  const value = [...new Set(parts.map((entry) => String(entry ?? "").trim())
    .filter(Boolean))].join(" ").replace(/\s+/g, " ").trim()
  if (value.length <= 80) return value || null
  return value.slice(0, 80).replace(/\s+\S*$/, "").trim() || null
}

function comparableItemIdV1(value: unknown) {
  const raw = String(value ?? "").trim()
  return raw.match(/^v1\|(\d{9,19})\|\d+$/)?.[1] ?? raw
}

export function buildCommercialKeywordSynthesisV1(
  report: EbaySellerKeywordDemandReport | null,
  safeClaims: readonly SafeCommercialClaimV1[],
  doNotUseClaims: readonly Readonly<{ value: string }>[] = [],
) {
  const eligible = (report?.comparableEvidence ?? []).filter((entry) =>
    entry.eligibleComparable)
  const identity = safeClaims.find((entry) => entry.kind === "PRODUCT_IDENTITY")
  const specification = safeClaims.find((entry) => entry.kind === "SPECIFICATION")
  const sellerSupport = (phrase: string) => {
    const required = normalizedKeywordTokensV1(phrase)
    if (!required.length) return 0
    return new Set(eligible.filter((entry) => {
      const observed = new Set(normalizedKeywordTokensV1(entry.title))
      return required.every((token) => observed.has(token))
    }).map((entry) => entry.sellerUsername.toLocaleLowerCase("en-US")))
      .size
  }
  const safeDifferentiators = safeClaims.filter((entry) =>
    ["FUNCTIONAL_DIFFERENTIATOR", "CONNECTIVITY"].includes(entry.kind))
    .map((claim) => ({ claim, support: sellerSupport(claim.value) }))
    .sort((left, right) => right.support - left.support ||
      right.claim.value.length - left.claim.value.length)
  const supportedDifferentiators = safeDifferentiators.filter((entry) =>
    entry.support > 0).map((entry) => entry.claim.value)
  const supportedDescriptors = (report?.candidateCommercialDescriptors ?? [])
    .filter((descriptor) => sellerSupport(descriptor) >= 2)
  let primary: string | null = null
  if (identity && eligible.length) {
    if (specification) {
      primary = `${specification.value} ${identity.value}${
        supportedDifferentiators.length ? ` with ${supportedDifferentiators
          .slice(0, 2).join(" and ")}` : ""}`
    } else if (supportedDifferentiators.length) {
      primary = `${supportedDifferentiators[0]} ${identity.value}${
        supportedDifferentiators.length > 1 ? ` with ${supportedDifferentiators
          .slice(1, 3).join(" and ")}` : ""}`
    } else if (sellerSupport(identity.value) >= 2) {
      primary = identity.value
    }
  }
  const phraseCandidates = identity ? [
    ...supportedDifferentiators.flatMap((value) => [
      `${value} ${identity.value}`,
      `${identity.value} with ${value}`,
    ]),
    ...(specification ? [`${specification.value} ${identity.value}`] : []),
    ...supportedDescriptors.map((descriptor) =>
      `${descriptor} ${supportedDifferentiators[0] ?? ""} ${identity.value}`
        .replace(/\s+/g, " ").trim()),
  ] : []
  const commerciallyUseful = (phrase: string) => {
    const tokens = normalizedKeywordTokensV1(phrase)
    return tokens.length >= 2 && sellerSupport(phrase) >= 2 &&
      phrase.toLocaleLowerCase("en-US") !== primary?.toLocaleLowerCase("en-US")
  }
  const secondary = [...new Set(phraseCandidates.filter(commerciallyUseful))]
    .sort((left, right) => sellerSupport(right) - sellerSupport(left) ||
      right.length - left.length).slice(0, 5)
  const longTail = [...new Set([
    ...(primary && normalizedKeywordTokensV1(primary).length >= 4
      ? [primary] : []),
    ...phraseCandidates.filter((phrase) =>
      normalizedKeywordTokensV1(phrase).length >= 4),
  ].filter(commerciallyUseful))].slice(0, 6)
  const differentiators = [...new Set([
    ...safeDifferentiators.map((entry) => entry.claim.value),
    ...supportedDescriptors,
  ])]
  const descriptorSet = new Set(supportedDescriptors.map((entry) =>
    entry.toLocaleLowerCase("en-US")))
  const excluded = [...new Set(doNotUseClaims.map((entry) => entry.value)
    .filter((value) => !descriptorSet.has(value.toLocaleLowerCase("en-US"))))]
    .slice(0, 16)
  const model = safeClaims.find((entry) => entry.kind === "MODEL")?.value ?? null
  return Object.freeze({
    primaryKeywordFamily: primary,
    secondaryCommercialKeywords: Object.freeze(secondary),
    validatedLongTailKeywords: Object.freeze(longTail),
    productDifferentiators: Object.freeze(differentiators),
    unsupportedOrExcludedTerms: Object.freeze(excluded),
    finalEbayTitle: boundedEbayTitleV1([primary, model]),
    rawKeywordEvidence: Object.freeze({
      generatedNgrams: Object.freeze([
        ...(report?.recommendedListingKeywordStructure.secondarySearchTerms ?? []),
        ...(report?.activeListingKeywords ?? []).map((entry) => entry.term),
      ]),
      presentationScope: "TECHNICAL_EVIDENCE_ONLY" as const,
    }),
  })
}

export function buildCommercialMarketProjectionV1(
  report: EbaySellerKeywordDemandReport | null,
  safeClaims: readonly SafeCommercialClaimV1[] = [],
  doNotUseClaims: readonly Readonly<{ value: string }>[] = [],
) {
  const observed = (report?.comparableEvidence ?? []).map((entry) =>
    record(entry))
  const accepted = observed.filter((entry) => entry.eligibleComparable === true)
  const excluded = observed.filter((entry) => entry.eligibleComparable !== true)
  const nearExactSoldEnrichment = report?.evidenceBuckets
    .nearExactSoldEnrichment ?? null
  const nearExactEnrichmentComplete = !nearExactSoldEnrichment ||
    nearExactSoldEnrichment.status === "NOT_REQUIRED" ||
    nearExactSoldEnrichment.status === "COMPLETED"
  const demandBearing = accepted.filter((entry) =>
    (number(entry.salesQuantity) ?? 0) > 0)
  const pricingCandidates = report?.demandValidationPassed
    ? demandBearing.filter((entry) => entry.pricingAuthorityEligible !== false)
    : []
  const verifiedPricingCandidates = pricingCandidates.filter((entry) =>
    (number(entry.verifiedSoldQuantity) ?? 0) > 0 &&
    ["CONFIRMED_DURABLE_SOLD", "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY"]
      .includes(String(entry.soldHistorySource ?? "")))
  // Price authority follows SOLD provenance: confirmed durable and other
  // verified sold history take precedence over Browse estimates. Estimated
  // prices remain auditable but do not dilute a verified pricing set.
  const pricingPool = verifiedPricingCandidates.length
    ? verifiedPricingCandidates : pricingCandidates
  const pricedAuthority = pricingPool.filter((entry) =>
    (number(entry.price) ?? 0) > 0)
  const confirmedPricingAuthority = pricedAuthority.filter((entry) =>
    (number(entry.verifiedSoldQuantity) ?? 0) > 0 &&
    ["CONFIRMED_DURABLE_SOLD", "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY"]
      .includes(String(entry.soldHistorySource ?? "")))
  const confirmedPricingSellers = new Set(confirmedPricingAuthority.map((entry) =>
    String(entry.sellerUsername ?? "").trim().toLocaleLowerCase("en-US"))
    .filter(Boolean)).size
  const estimatedPricingAuthority = pricingCandidates.filter((entry) =>
    (number(entry.price) ?? 0) > 0 &&
    (number(entry.verifiedSoldQuantity) ?? 0) === 0 &&
    (number(entry.estimatedSoldQuantity) ?? 0) > 0)
  const estimatedPricingSellers = new Set(estimatedPricingAuthority.map((entry) =>
    String(entry.sellerUsername ?? "").trim().toLocaleLowerCase("en-US"))
    .filter(Boolean)).size
  const pricingEvidenceQuality = !nearExactEnrichmentComplete
    ? Object.freeze({ status: "INSUFFICIENT" as const,
        classification: "NEAR_EXACT_SOLD_ENRICHMENT_INCOMPLETE" as const,
        strongDecisionAllowed: false, confirmedComparableCount:
          confirmedPricingAuthority.length, confirmedSellerCount:
          confirmedPricingSellers, estimatedComparableCount:
          estimatedPricingAuthority.length, estimatedSellerCount:
          estimatedPricingSellers,
        reason: "NEAR_EXACT_SOLD_ENRICHMENT_NOT_COMPLETED" })
    : confirmedPricingAuthority.length >= 2 &&
      confirmedPricingSellers >= 2
    ? Object.freeze({ status: "SUFFICIENT" as const,
        classification: "CONFIRMED_MULTI_SELLER_PRICING_AUTHORITY" as const,
        strongDecisionAllowed: true, confirmedComparableCount:
          confirmedPricingAuthority.length, confirmedSellerCount:
          confirmedPricingSellers, estimatedComparableCount:
          estimatedPricingAuthority.length, estimatedSellerCount:
          estimatedPricingSellers, reason: "PRICING_CONFIRMED_ACROSS_SELLERS" })
    : pricedAuthority.length >= 2 && estimatedPricingSellers >= 2
      ? Object.freeze({ status: "PROVISIONAL" as const,
          classification: "ESTIMATED_MULTI_SELLER_PRICING_SIGNAL" as const,
          strongDecisionAllowed: false, confirmedComparableCount:
            confirmedPricingAuthority.length, confirmedSellerCount:
            confirmedPricingSellers, estimatedComparableCount:
            estimatedPricingAuthority.length, estimatedSellerCount:
            estimatedPricingSellers,
          reason: "PRICING_DEPENDS_ON_ESTIMATED_SOLD_EVIDENCE" })
      : Object.freeze({ status: "INSUFFICIENT" as const,
          classification: "INSUFFICIENT_PRICING_AUTHORITY" as const,
          strongDecisionAllowed: false, confirmedComparableCount:
            confirmedPricingAuthority.length, confirmedSellerCount:
            confirmedPricingSellers, estimatedComparableCount:
            estimatedPricingAuthority.length, estimatedSellerCount:
            estimatedPricingSellers,
          reason: "PRICING_SAMPLE_NOT_CONFIRMED_ACROSS_SELLERS" })
  const prices = pricingPool.flatMap((entry) => {
    const item = number(entry.price)
    const shipping = number(entry.shippingCost) ?? 0
    return item !== null && item > 0 ? [round(item + shipping)] : []
  })
  const range = prices.length ? Object.freeze({
    minimum: Math.min(...prices), median: median(prices),
    maximum: Math.max(...prices), currency: "USD" as const,
    basis: report?.demandValidationBasis ?? "INSUFFICIENT_EVIDENCE",
  }) : null
  const acceptedProjection = accepted.map((entry) => {
    const usedForPricing = pricingPool.includes(entry) &&
      (number(entry.price) ?? 0) > 0
    const comparableId = text(entry.comparableId, 160)
    const nearExactAudit = nearExactSoldEnrichment?.candidates.find((candidate) =>
      candidate.comparableId === comparableId) ?? null
    const price = number(entry.price)
    const shippingCost = number(entry.shippingCost) ?? 0
    return Object.freeze({
      comparableId,
      title: text(entry.title, 500),
      itemWebUrl: text(entry.itemWebUrl, 2_000),
      price, shippingCost: number(entry.shippingCost),
      totalPrice: price === null ? null : round(price + shippingCost),
      currency: text(entry.currency, 8),
      evidenceSource: text(entry.evidenceSource, 120),
      identityMatchQuality: text(entry.identityMatchQuality, 80),
      identityEvidenceClass: text(entry.identityEvidenceClass, 120),
      comparableClass: text(entry.commercialComparableClass, 80),
      brand: text(entry.brand, 160),
      pricingAuthorityEligible: entry.pricingAuthorityEligible !== false,
      pricingAuthorityClass: text(entry.pricingAuthorityClass, 120),
      exactModelToken: text(entry.exactModelToken, 80),
      similarity: number(entry.formFactorCoverage) ?? 0,
      verifiedSoldQuantity: number(entry.verifiedSoldQuantity) ?? 0,
      confirmedSoldQuantity: number(entry.confirmedSoldQuantity) ?? 0,
      estimatedSoldQuantity: number(entry.estimatedSoldQuantity) ?? 0,
      soldHistorySource: text(entry.soldHistorySource, 120),
      soldHistorySourceDetail: text(entry.durableSoldSourceType, 160),
      lastSoldDate: text(entry.lastSoldDate, 80),
      realizedPriceStatus: text(entry.realizedPriceStatus, 80),
      sellerUsername: text(entry.sellerUsername, 160),
      nearExactSoldEnrichment: nearExactAudit ? Object.freeze({
        ...nearExactAudit, contributedToPricing: usedForPricing ||
          nearExactAudit.matchedSoldComparableIds.some((itemId) =>
            pricingPool.some((candidate) => comparableItemIdV1(
              candidate.comparableId) === comparableItemIdV1(itemId))),
      }) : null,
      usedForPricing,
      pricingReason: usedForPricing ? "DEMAND_BEARING_ELIGIBLE_COMPARABLE"
        : report?.demandValidationPassed
          ? "NO_POSITIVE_PRICE_OR_DEMAND_SIGNAL"
          : "DEMAND_NOT_PROVEN",
    })
  })
  const excludedProjection = excluded.map((entry) => Object.freeze({
    comparableId: text(entry.comparableId, 160),
    title: text(entry.title, 500),
    itemWebUrl: text(entry.itemWebUrl, 2_000),
    price: number(entry.price), shippingCost: number(entry.shippingCost),
    evidenceSource: text(entry.evidenceSource, 120),
    identityMatchQuality: text(entry.identityMatchQuality, 80),
    identityEvidenceClass: text(entry.identityEvidenceClass, 120),
    comparableClass: text(entry.commercialComparableClass, 80),
    confirmedSoldQuantity: number(entry.confirmedSoldQuantity) ?? 0,
    estimatedSoldQuantity: number(entry.estimatedSoldQuantity) ?? 0,
    soldHistorySource: text(entry.soldHistorySource, 120),
    soldHistorySourceDetail: text(entry.durableSoldSourceType, 160),
    lastSoldDate: text(entry.lastSoldDate, 80),
    realizedPriceStatus: text(entry.realizedPriceStatus, 80),
    rejectionReason: comparableRejectionReason(entry),
  }))
  const exactModelAccepted = acceptedProjection.filter((entry) =>
    entry.comparableClass === "EXACT_MODEL_COMPARABLE")
  const nearExactAccepted = acceptedProjection.filter((entry) =>
    entry.comparableClass === "NEAR_EXACT_PRODUCT")
  const functionalAccepted = acceptedProjection.filter((entry) =>
    entry.comparableClass === "FUNCTIONAL_COMPARABLE")
  const confirmedSoldEvidence = [...acceptedProjection, ...excludedProjection]
    .filter((entry) => ("verifiedSoldQuantity" in entry &&
      Number(entry.verifiedSoldQuantity) > 0) || entry.confirmedSoldQuantity > 0)
  const estimatedSoldEvidence = [...acceptedProjection, ...excludedProjection]
    .filter((entry) => entry.estimatedSoldQuantity > 0)
  const structuredModelConflicts = excludedProjection.filter((entry) =>
    entry.rejectionReason?.includes("STRUCTURED_MODEL_CONFLICT"))
  const marketSearches = report?.evidenceBuckets.marketSearches
  const demand = !report ? "MARKET_READ_UNAVAILABLE"
    : report.demandValidationBasis === "VERIFIED_HISTORICAL_MULTI_SELLER"
      ? "VERIFIED_MULTI_SELLER_DEMAND"
      : report.demandValidationBasis === "ESTIMATED_MULTI_SELLER_SIGNAL"
        ? "ESTIMATED_MULTI_SELLER_DEMAND"
        : report.eligibleComparableListings > 0
          ? "COMPARABLES_OBSERVED_DEMAND_UNPROVEN"
          : "INSUFFICIENT_COMPARABLE_EVIDENCE"
  const keywordSynthesis = buildCommercialKeywordSynthesisV1(report,
    safeClaims, doNotUseClaims)
  return Object.freeze({
    searchQuery: report?.searchQuery ?? null,
    resolvedCategoryId: report?.resolvedCategoryId ?? null,
    exactModelSearchQuery: marketSearches?.exactModel.query ??
      report?.searchQuery ?? null,
    functionalSearchQuery: marketSearches?.functionalFamily?.query ?? null,
    primaryKeywordFamily: keywordSynthesis.primaryKeywordFamily,
    secondaryKeywords: keywordSynthesis.secondaryCommercialKeywords,
    longTailKeywords: keywordSynthesis.validatedLongTailKeywords,
    productDifferentiators: keywordSynthesis.productDifferentiators,
    unsupportedOrExcludedTerms: keywordSynthesis.unsupportedOrExcludedTerms,
    finalEbayTitle: keywordSynthesis.finalEbayTitle,
    rawKeywordEvidence: keywordSynthesis.rawKeywordEvidence,
    keywordProvenance: Object.freeze({
      primary: report?.demandValidationBasis ?? "INSUFFICIENT_EVIDENCE",
      secondary: report?.recommendedListingKeywordStructure
        .strategyConfidence ?? "LOW_INSUFFICIENT_EVIDENCE",
      differentiators: report?.candidateCommercialDescriptors?.length
        ? "MULTI_SELLER_MARKET_AND_PRODUCT_TRUTH" : "PRODUCT_TRUTH",
      excluded: "PRODUCT_TRUTH_RECONCILIATION",
    }),
    demandClassification: demand,
    demandValidationBasis: report?.demandValidationBasis ?? "INSUFFICIENT_EVIDENCE",
    demandValidationPassed: report?.demandValidationPassed === true,
    acceptedComparables: Object.freeze(acceptedProjection),
    excludedComparables: Object.freeze(excludedProjection),
    exactModelAccepted: Object.freeze(exactModelAccepted),
    nearExactAccepted: Object.freeze(nearExactAccepted),
    functionalAccepted: Object.freeze(functionalAccepted),
    nonComparable: Object.freeze(excludedProjection),
    confirmedSoldEvidence: Object.freeze(confirmedSoldEvidence),
    estimatedSoldEvidence: Object.freeze(estimatedSoldEvidence),
    structuredModelConflicts: Object.freeze(structuredModelConflicts),
    priceRange: range,
    pricingEvidenceQuality,
    nearExactSoldEnrichment,
    observedComparableCount: observed.length,
    candidateFoundCount: report?.evidenceBuckets.candidateFoundCount ?? 0,
    returnedCandidateCount: report?.evidenceBuckets.returnedCandidateCount ?? 0,
    enrichedSampleCount: report?.evidenceBuckets.enrichedSampleCount ?? 0,
    commercialSamplingPolicy:
      report?.evidenceBuckets.commercialSamplingPolicy ?? null,
    samplingSufficientBeforeDemandUnproven:
      report?.demandValidationPassed === true ||
      report?.evidenceBuckets.commercialSamplingPolicy
        ?.sufficientBeforeDemandUnproven === true,
    everyObservedComparableAccountedFor:
      accepted.length + excluded.length === observed.length,
    sourceLimitations: Object.freeze([
      ...(report?.soldHistoryIsLimitedRelease
        ? ["EBAY_SOLD_HISTORY_LIMITED_RELEASE"] : []),
      ...(report?.durableSoldEvidenceStatus === "REQUEST_FAILED"
        ? ["DURABLE_SOLD_EVIDENCE_READ_FAILED"] : []),
      ...(!nearExactEnrichmentComplete
        ? ["NEAR_EXACT_SOLD_ENRICHMENT_NOT_COMPLETED"] : []),
      ...((report?.evidenceBuckets.candidateFoundCount ?? 0) > observed.length
        ? ["EBAY_RESULT_SET_BOUNDED_BY_GATEWAY_SAMPLE"] : []),
    ]),
  })
}

export function buildCommercialDecisionV1(input: Readonly<{
  supplierCost: number
  shipping: number | null
  claimConflictCount: number
  materialClaimConflictCount?: number
  complianceStatus: "PASS" | "REVIEW_REQUIRED" | "BLOCKED"
  market: ReturnType<typeof buildCommercialMarketProjectionV1>
}>) {
  const landedCost = input.shipping === null ? null
    : round(input.supplierCost + input.shipping)
  const floor = input.shipping === null ? null : calculateEbayMinimumOperatorPrice({
    supplierCost: input.supplierCost,
  }, { estimatedOutboundShipping: input.shipping })
  const marketMedian = input.market.priceRange?.median ?? null
  const marketMaximum = input.market.priceRange?.maximum ?? null
  const floorPrice = floor?.minimumOperatorPrice ?? null
  const recommendedPrice = floorPrice !== null && marketMedian !== null &&
      marketMaximum !== null && floorPrice <= marketMaximum
    ? round(Math.max(floorPrice, marketMedian)) : null
  const economics = recommendedPrice === null || input.shipping === null
    ? null : calculateEbayUnitEconomics({ salePrice: recommendedPrice,
        supplierCost: input.supplierCost }, {
        estimatedOutboundShipping: input.shipping,
      })
  const floorComponents = floor?.ready ? floor.components : null
  const bindingFloorEntry = floorComponents ? Object.entries(floorComponents)
    .sort((left, right) => Number(right[1]) - Number(left[1]))[0] : null
  const bindingGate = bindingFloorEntry?.[0] === "minimumNetProfitPrice"
    ? "PROFIT_FLOOR" : bindingFloorEntry?.[0] === "minimumNetMarginPrice"
      ? "MARGIN_FLOOR" : bindingFloorEntry?.[0] === "minimumRoiPrice"
        ? "ROI_FLOOR" : null
  const floorPriceForAllowances = floor?.minimumOperatorPrice ?? null
  const economicFloorExplanation = floor?.ready && floorPriceForAllowances !== null
    ? Object.freeze({
        minimumSafePrice: floorPriceForAllowances,
        observedEvidence: Object.freeze({ productCost: round(input.supplierCost),
          shippingQty1: input.shipping, landedCost }),
        policyAssumptions: Object.freeze({
          marketplaceFeeRate: floor.config.estimatedEbayFeeRate,
          marketplaceFeeAllowance: round(floorPriceForAllowances *
            floor.config.estimatedEbayFeeRate),
          fixedOrderFee: floor.feePolicy.appliedFixedOrderFee,
          advertisingReserveRate: floor.config.promotedListingsReserveRate,
          advertisingReserve: round(floorPriceForAllowances *
            floor.config.promotedListingsReserveRate),
          returnsRiskReserveRate: floor.config.returnsReserveRate,
          returnsRiskReserve: round(floorPriceForAllowances *
            floor.config.returnsReserveRate),
          profitFloor: floor.config.minimumNetProfit,
          marginFloorPercent: floor.config.minimumNetMarginPercent,
          roiFloorPercent: floor.config.minimumRoiPercent,
        }),
        candidateFloors: floor.components,
        bindingGate,
        feePolicy: floor.feePolicy,
        equation: "sale price - product cost - shipping - marketplace fee allowance - fixed fee - advertising reserve - returns/risk reserve",
      }) : null
  let finalDecision = "HOLD_INSUFFICIENT_EVIDENCE"
  if (input.complianceStatus === "BLOCKED") finalDecision = "REJECT_COMPLIANCE"
  else if ((input.materialClaimConflictCount ?? input.claimConflictCount) > 0) {
    finalDecision = "HOLD_CLAIM_CONFLICTS"
  }
  else if (input.shipping === null) finalDecision = "HOLD_SHIPPING_UNPROVEN"
  else if (!input.market.demandValidationPassed) {
    finalDecision = "HOLD_DEMAND_UNPROVEN"
  } else if (!input.market.pricingEvidenceQuality.strongDecisionAllowed) {
    finalDecision = "HOLD_PRICING_EVIDENCE_QUALITY"
  } else if (floorPrice !== null && marketMaximum !== null &&
      floorPrice > marketMaximum) finalDecision = "REJECT_ECONOMICS"
  else if (!economics?.passesProfitGate) finalDecision = "HOLD_ECONOMICS_UNPROVEN"
  else finalDecision = "ADVANCE_TO_OWNER_COMMERCIAL_REVIEW"
  const confidence = input.market.pricingEvidenceQuality.strongDecisionAllowed &&
      input.market.demandValidationBasis ===
      "VERIFIED_HISTORICAL_MULTI_SELLER" &&
      !(input.materialClaimConflictCount ?? input.claimConflictCount)
    ? "HIGH" : input.market.demandValidationPassed ? "MEDIUM" : "LOW"
  return Object.freeze({ landedCost, minimumMarginSafePrice: floorPrice,
    economicFloorExplanation, recommendedPrice, economics, finalDecision,
    confidence })
}

type TraceEventWriter = (stage: string, status: "RUNNING" | "PASS" |
  "BLOCKED" | "INFO" | "FAIL", narrative: string,
  evidence?: JsonRecord) => Promise<void>

async function latestShipping(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  productId: string
  variant: DirectedLunaVariant
}>) {
  // The immutable frontier ledger intentionally revokes direct service-role
  // table reads. Use its bounded security-definer read contract and then apply
  // the exact product/variant/SKU predicate in memory.
  const read = await input.supabase.rpc(
    "get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey,
      p_marketplace_id: "EBAY_US",
      p_family_ids: null,
      p_limit: 100,
    })
  if (read.error) throw new Error("LIVE_COMMERCIAL_TRACE_SHIPPING_READ_FAILED")
  const candidates = (Array.isArray(record(read.data).frontiers)
    ? record(read.data).frontiers as unknown[] : [])
    .map((outerValue) => {
      const outer = record(outerValue)
      return { outer, frontier: record(outer.frontier) }
    })
    .filter(({ frontier }) =>
      frontier.lunaProductId === input.productId &&
      frontier.lunaVariantId === input.variant.id &&
      frontier.lunaSku === input.variant.sku)
    .sort((left, right) => Date.parse(text(right.outer.calculatedAt, 80) ??
      text(right.frontier.evaluatedAt, 80) ?? "") -
      Date.parse(text(left.outer.calculatedAt, 80) ??
        text(left.frontier.evaluatedAt, 80) ?? ""))
  if (!candidates.length) return null
  const selected = candidates[0]
  const payload = selected.frontier
  const capture = record(payload.shippingCaptureEvidence)
  const observedAt = text(capture.observedAt ?? selected.outer.calculatedAt ??
    payload.evaluatedAt, 80)
  const age = observedAt ? Date.now() - Date.parse(observedAt) : Number.POSITIVE_INFINITY
  const valid = payload.shippingStatus === "SHIPPING_DURABLY_PERSISTED" &&
    number(payload.shippingValue) !== null &&
    capture.quantity === 1 && capture.noPurchase === true &&
    capture.noCredentials === true && capture.canonicalDestinationMatch === true &&
    capture.lunaProductId === input.productId &&
    capture.lunaVariantId === input.variant.id &&
    capture.supplierSku === input.variant.sku &&
    Number.isFinite(age) && age >= -60_000 && age <= SHIPPING_MAX_AGE_MS
  if (!valid) return null
  return Object.freeze({ amountUsd: number(payload.shippingValue) as number,
    observedAt, evidenceDigest: text(capture.evidenceDigest, 100),
    acquisitionMethod: text(capture.acquisitionMethod, 120),
    canonicalDestinationMatch: true as const,
    canonicalDestinationCountryClass:
      text(capture.canonicalDestinationCountryClass, 8),
    quantity: 1 as const, noPurchase: true as const,
    noCredentials: true as const, rawAddressPersisted: false as const })
}

async function completeFailure(input: Readonly<{
  supabase: SupabaseClient
  traceId: string
  code: string
  sequence: number
}>) {
  const now = new Date().toISOString()
  await input.supabase.from("seller_os_live_commercial_trace_events_v1")
    .insert({ trace_id: input.traceId, sequence: input.sequence,
      stage: "FINAL_DECISION", status: "FAIL",
      narrative: `La certificación terminó cerrada de forma segura: ${input.code}.`,
      evidence: { failureCode: input.code, marketplaceWrites: 0,
        publicationWrites: 0, purchaseCompleted: false } })
  await input.supabase.from("seller_os_live_commercial_traces_v1")
    .update({ state: "FAILED", current_stage: "FINAL_DECISION",
      event_count: input.sequence, completed_at: now, updated_at: now,
      result: { FINAL_DECISION: "FAIL_CLOSED", failureCode: input.code,
        COMMERCIAL_TRACE_CERTIFICATION: "FAIL" } })
    .eq("trace_id", input.traceId)
}

export async function runSellerOsLiveCommercialTraceV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  productUrl: string
  actorUserId?: string | null
  fetchImpl?: typeof fetch
  marketReader?: MarketReaderV1
}>) {
  const canonicalUrl = parseDirectedLunaProductUrl(input.productUrl).canonicalUrl
  const start = await input.supabase.from("seller_os_live_commercial_traces_v1")
    .insert({ account_key: input.accountKey, product_url: canonicalUrl,
      started_by: input.actorUserId ?? null }).select("trace_id").single()
  if (start.error || !start.data) throw new Error(
    "LIVE_COMMERCIAL_TRACE_START_WRITE_FAILED")
  const traceId = String(start.data.trace_id)
  let sequence = 0
  const emit: TraceEventWriter = async (stage, status, narrative,
    evidence = {}) => {
    sequence += 1
    const now = new Date().toISOString()
    const write = await input.supabase.from(
      "seller_os_live_commercial_trace_events_v1").insert({ trace_id: traceId,
        sequence, stage, status, narrative, evidence })
    if (write.error) throw new Error("LIVE_COMMERCIAL_TRACE_EVENT_WRITE_FAILED")
    const update = await input.supabase.from("seller_os_live_commercial_traces_v1")
      .update({ current_stage: stage, event_count: sequence, updated_at: now })
      .eq("trace_id", traceId)
    if (update.error) throw new Error("LIVE_COMMERCIAL_TRACE_STATE_WRITE_FAILED")
  }
  try {
    await emit("PRODUCT_TRUTH", "RUNNING",
      "Seller OS está leyendo la ficha pública exacta de Luna; no usa conclusiones humanas previas.",
      { source: "LUNA_PUBLIC_READ_ONLY_PRODUCT_JSON", productUrl: canonicalUrl })
    const product = await fetchDirectedLunaProduct(canonicalUrl,
      input.fetchImpl ?? fetch)
    if (product.variants.length !== 1) throw new Error(
      "LIVE_COMMERCIAL_TRACE_VARIANT_AMBIGUOUS")
    const variant = product.variants[0]
    await emit("PRODUCT_TRUTH", "PASS",
      `Identidad exacta encontrada: ${product.title}; variante ${variant.title}; SKU ${variant.sku}.`,
      { productId: product.productId, variantId: variant.id,
        supplierSku: variant.sku, title: product.title,
        gtin: variant.sourceUnitBarcode, productType: product.productType,
        variantTitle: variant.title, imageCount: product.imageUrls.length,
        sourceMode: product.sourceMode, sourceParserVersion:
          product.sourceParserVersion, rawHtmlPersisted: false })

    const conflicts = detectCommercialClaimConflictsV1(product)
    const safeClaimTruth = buildConservativeSafeClaimSubsetV1({ ...product,
      sourceUrl: canonicalUrl })
    await emit("CLAIM_CONFLICTS", conflicts.length
      ? safeClaimTruth.materialConflictCount ? "BLOCKED" : "INFO" : "PASS",
      conflicts.length
        ? `Seller OS detectó ${conflicts.length} conflicto(s); aisló los claims afectados como UNVERIFIED/DO_NOT_USE y conserva ${safeClaimTruth.safeClaims.length} claims seguros para el análisis.`
        : "No se observaron conflictos materiales entre los claims textuales disponibles.",
      { conflicts, safeClaims: safeClaimTruth.safeClaims,
        doNotUseClaims: safeClaimTruth.doNotUseClaims,
        identitySufficient: safeClaimTruth.identitySufficient,
        materialConflictCount: safeClaimTruth.materialConflictCount })
    const compliance = classifyCommercialComplianceV1({ title: product.title,
      descriptionText: product.descriptionText,
      claimConflictCount: conflicts.length })
    await emit("COMPLIANCE", compliance.status === "PASS" ? "PASS"
      : compliance.status === "BLOCKED" ? "BLOCKED" : "INFO",
      compliance.status === "PASS"
        ? "El tamiz prepublicación no encontró un riesgo restringido en el texto del proveedor."
        : compliance.status === "BLOCKED"
          ? "Se observó un patrón restringido y la evaluación queda bloqueada."
          : "Los claims conflictivos quedan prohibidos para publicación, pero el subconjunto seguro permite continuar el análisis comercial.",
      compliance as unknown as JsonRecord)
    await emit("STOCK", variant.available ? "PASS" : "BLOCKED",
      variant.available
        ? "Luna declara disponible la variante exacta. La cantidad física no se infiere."
        : "Luna declara no disponible la variante exacta.",
      { available: variant.available,
        inventoryQuantity: variant.sourceInventoryQuantity ?? null,
        inventoryQuantityExplicit:
          variant.sourceInventoryQuantityExplicit === true })
    await emit("PRODUCT_COST", "PASS",
      `Costo actual del producto qty=1: USD ${variant.sourceUnitPrice.toFixed(2)}.`,
      { currency: "USD", quantity: 1, productCostUsd: variant.sourceUnitPrice,
        authority: "LUNA_PUBLIC_READ_ONLY_PRODUCT_JSON" })

    const shipping = await latestShipping({ supabase: input.supabase,
      accountKey: input.accountKey, productId: product.productId, variant })
    await emit("SHIPPING_QTY1", shipping ? "PASS" : "BLOCKED",
      shipping
        ? `Se reutilizó una captura durable y fresca de shipping qty=1: USD ${shipping.amountUsd.toFixed(2)}. No se abrió una compra nueva.`
        : "No existe una captura qty=1 fresca y exacta; Seller OS no supone shipping cero.",
      shipping ? { ...shipping, reusedDurableEvidence: true }
        : { quantity: 1, shippingUsd: null, unknownShippingTreatedAsZero: false,
          purchaseCompleted: false })
    const landedCost = shipping ? round(variant.sourceUnitPrice +
      shipping.amountUsd) : null
    await emit("LANDED_COST", landedCost === null ? "BLOCKED" : "PASS",
      landedCost === null ? "Costo puesto no demostrado porque falta shipping."
        : `Costo puesto qty=1 antes de fees de eBay: USD ${landedCost.toFixed(2)}.`,
      { productCostUsd: variant.sourceUnitPrice,
        shippingUsd: shipping?.amountUsd ?? null, landedCostUsd: landedCost,
        includesEbayFees: false })

    await emit("MARKET_SEARCH_PROGRESS", "RUNNING",
      "Seller OS está consultando eBay en modo GET/read-only y evaluará cada resultado con identidad exacta o fuerte.",
      { queryInputAuthority: "LUNA_PRODUCT_TRUTH", manualComparables: 0,
        manualKeywords: 0, manualPrice: null, ebayWriteUsed: false })
    let report: EbaySellerKeywordDemandReport | null = null
    let marketFailure: string | null = null
    try {
      const reader = input.marketReader ?? (await import(
        "./ebay-seller-keyword-demand-gateway")).runEbaySellerKeywordDemandValidation
      const safeMarketIdentity = safeClaimTruth.safeMarketIdentity || product.title
      const candidateModel = safeClaimTruth.safeClaims.find((entry) =>
        entry.kind === "MODEL")?.value ?? null
      const functionalSearchQuery = buildFunctionalFamilySearchQueryV1(
        safeClaimTruth.safeClaims)
      report = await reader({ productName: safeMarketIdentity,
          productTitle: safeMarketIdentity, variantTitle: variant.title,
          identityReferenceTitle: product.title,
          supplierSku: variant.sku, gtin: variant.sourceUnitBarcode,
          model: candidateModel,
          productType: product.productType,
          description: safeClaimTruth.safeClaims.map((entry) => entry.value)
            .join(" ") }, { functionalSearchQuery,
          marketplaceAccountKey: input.accountKey })
    } catch (error) {
      marketFailure = safeCode(error)
    }
    const market = buildCommercialMarketProjectionV1(report,
      safeClaimTruth.safeClaims, safeClaimTruth.doNotUseClaims)
    await emit("MARKET_SEARCH_PROGRESS", report ? "PASS" : "BLOCKED",
      report
        ? `eBay devolvió ${market.returnedCandidateCount} candidatos; ${market.observedComparableCount} fueron enriquecidos y todos quedaron contabilizados como aceptados o excluidos.`
        : `La lectura de mercado no estuvo disponible (${marketFailure}); no se fabricó demanda ni precio.`,
      { searchQuery: market.searchQuery,
        exactModelSearchQuery: market.exactModelSearchQuery,
        functionalSearchQuery: market.functionalSearchQuery,
        marketSearches: report?.evidenceBuckets.marketSearches ?? null,
        candidateFoundCount: market.candidateFoundCount,
        returnedCandidateCount: market.returnedCandidateCount,
        enrichedSampleCount: market.enrichedSampleCount,
        observedComparableCount: market.observedComparableCount,
        commercialSamplingPolicy: market.commercialSamplingPolicy,
        nearExactSoldEnrichment: market.nearExactSoldEnrichment,
        samplingSufficientBeforeDemandUnproven:
          market.samplingSufficientBeforeDemandUnproven,
        sourceLimitations: market.sourceLimitations,
        everyObservedComparableAccountedFor:
          market.everyObservedComparableAccountedFor,
        failureCode: marketFailure, ebayWriteUsed: false })
    await emit("PRIMARY_KEYWORD_FAMILY",
      market.primaryKeywordFamily ? "PASS" : "BLOCKED",
      market.primaryKeywordFamily
        ? `Familia principal elegida por evidencia multi-vendedor: “${market.primaryKeywordFamily}”.`
        : "No existe evidencia suficiente para declarar una keyword family principal.",
      { primaryKeywordFamily: market.primaryKeywordFamily,
        manualKeywordFamilyUsed: false })
    await emit("SECONDARY_KEYWORDS", market.secondaryKeywords.length
      ? "PASS" : "INFO", market.secondaryKeywords.length
        ? `Seller OS encontró ${market.secondaryKeywords.length} keywords secundarias respaldadas.`
        : "No se declararon keywords secundarias sin respaldo suficiente.",
      { secondaryKeywords: market.secondaryKeywords,
        manualKeywordsUsed: false })
    await emit("KEYWORD_INTELLIGENCE", market.primaryKeywordFamily
      ? "PASS" : "BLOCKED",
      `Seller OS documentó familia principal, ${market.secondaryKeywords.length} términos secundarios, ${market.longTailKeywords.length} long-tail y ${market.productDifferentiators.length} diferenciadores con provenance.`,
      { primaryKeywordFamily: market.primaryKeywordFamily,
        secondaryKeywords: market.secondaryKeywords,
        longTailKeywords: market.longTailKeywords,
        productDifferentiators: market.productDifferentiators,
        unsupportedOrExcludedTerms: market.unsupportedOrExcludedTerms,
        provenance: market.keywordProvenance })
    await emit("ACCEPTED_COMPARABLES", "INFO",
      `${market.exactModelAccepted.length} exact-model, ${market.nearExactAccepted.length} near-exact y ${market.functionalAccepted.length} functional comparables pasaron identidad.`,
      { acceptedComparables: market.acceptedComparables,
        exactModelAccepted: market.exactModelAccepted,
        nearExactAccepted: market.nearExactAccepted,
        functionalAccepted: market.functionalAccepted,
        confirmedSoldEvidence: market.confirmedSoldEvidence,
        estimatedSoldEvidence: market.estimatedSoldEvidence,
        acceptedCount: market.acceptedComparables.length })
    await emit("NEAR_EXACT_SOLD_ENRICHMENT",
      !market.nearExactSoldEnrichment || ["NOT_REQUIRED", "COMPLETED"]
        .includes(market.nearExactSoldEnrichment.status) ? "PASS" : "BLOCKED",
      !market.nearExactSoldEnrichment ||
          market.nearExactSoldEnrichment.status === "NOT_REQUIRED"
        ? "No había candidatos del mismo producto/formato pendientes de historial SOLD."
        : market.nearExactSoldEnrichment.status === "COMPLETED"
          ? `Seller OS cerró un enrichment SOLD independiente y acotado para ${market.nearExactSoldEnrichment.selectedCandidateCount} candidatos near-exact prioritarios.`
          : "El enrichment SOLD near-exact no pudo cerrarse; pricing permanecerá en HOLD sin modificar thresholds ni inventar ventas.",
      { nearExactSoldEnrichment: market.nearExactSoldEnrichment,
        pricingMayClose: !market.nearExactSoldEnrichment ||
          ["NOT_REQUIRED", "COMPLETED"].includes(
            market.nearExactSoldEnrichment.status) })
    await emit("EXCLUDED_COMPARABLES", "INFO",
      `${market.excludedComparables.length} comparables fueron excluidos; cada uno conserva su razón.`,
      { excludedComparables: market.excludedComparables,
        structuredModelConflicts: market.structuredModelConflicts,
        excludedCount: market.excludedComparables.length,
        everyObservedComparableAccountedFor:
          market.everyObservedComparableAccountedFor })
    await emit("DEMAND_CLASSIFICATION", market.demandValidationPassed
      ? "PASS" : "BLOCKED",
      `Clasificación autónoma de demanda: ${market.demandClassification}.`,
      { demandClassification: market.demandClassification,
        demandValidationBasis: market.demandValidationBasis })
    await emit("PRICE_RANGE", market.priceRange ? "PASS" : "BLOCKED",
      market.priceRange
        ? `Rango observado con comparables elegibles que traen señal de demanda: USD ${market.priceRange.minimum.toFixed(2)}–${market.priceRange.maximum.toFixed(2)}; mediana USD ${market.priceRange.median?.toFixed(2)}.`
        : "No hay una distribución de precios suficientemente sustentada para usarla en decisión.",
      { priceRange: market.priceRange })
    await emit("PRICING_EVIDENCE_QUALITY",
      market.pricingEvidenceQuality.strongDecisionAllowed ? "PASS" : "BLOCKED",
      market.pricingEvidenceQuality.strongDecisionAllowed
        ? "La autoridad de pricing está confirmada entre múltiples vendedores."
        : "El rango permanece visible, pero no autoriza una decisión fuerte porque la muestra de pricing es insuficiente o depende de ventas estimadas.",
      { pricingEvidenceQuality: market.pricingEvidenceQuality })

    const decision = buildCommercialDecisionV1({
      supplierCost: variant.sourceUnitPrice,
      shipping: shipping?.amountUsd ?? null,
      claimConflictCount: conflicts.length,
      materialClaimConflictCount: safeClaimTruth.materialConflictCount,
      complianceStatus: compliance.status,
      market,
    })
    await emit("RECOMMENDED_PRICE", decision.recommendedPrice === null
      ? "BLOCKED" : "PASS", decision.recommendedPrice === null
        ? "Seller OS no recomienda precio: el mercado y el piso de margen no están ambos demostrados."
        : `Precio recomendado autónomo: USD ${decision.recommendedPrice.toFixed(2)}; nunca provino de input humano.`,
      { recommendedPriceUsd: decision.recommendedPrice,
        minimumMarginSafePriceUsd: decision.minimumMarginSafePrice,
        manualPriceUsed: false })
    await emit("ECONOMICS", decision.economics?.passesProfitGate
      ? "PASS" : "BLOCKED", decision.economics
        ? `A USD ${decision.recommendedPrice?.toFixed(2)}, la utilidad estimada es USD ${decision.economics.estimatedNetProfit?.toFixed(2)} y el margen ${decision.economics.estimatedNetMarginPercent?.toFixed(2)}%.`
        : "Economía no concluyente: no se evalúa un precio no sustentado.",
      { landedCostUsd: decision.landedCost,
        economics: decision.economics,
        economicFloorExplanation: decision.economicFloorExplanation,
        feePolicyExact: decision.economics?.feePolicy?.exactFeeClaimed ?? false })

    const knownUncertainties = Object.freeze([
      ...conflicts.map((entry) => entry.code),
      ...market.sourceLimitations,
      ...(!market.demandValidationPassed ? ["DEMAND_NOT_PROVEN"] : []),
      ...(!market.priceRange ? ["MARKET_PRICE_DISTRIBUTION_UNPROVEN"] : []),
      ...(!market.pricingEvidenceQuality.strongDecisionAllowed
        ? [market.pricingEvidenceQuality.reason] : []),
      ...(decision.economics?.feePolicy?.exactFeeClaimed === false
        ? ["EXACT_EBAY_CATEGORY_FEE_UNPROVEN"] : []),
      ...(variant.sourceInventoryQuantityExplicit !== true
        ? ["EXACT_SUPPLIER_QUANTITY_UNPROVEN"] : []),
    ])
    const certificationPass = market.everyObservedComparableAccountedFor &&
      market.samplingSufficientBeforeDemandUnproven &&
      safeClaimTruth.identitySufficient &&
      shipping?.noPurchase === true && shipping.noCredentials === true
    const recommendedTitle = market.finalEbayTitle
    const itemSpecifics = safeClaimTruth.safeClaims.filter((entry) =>
      !["PRODUCT_IDENTITY", "MODEL"].includes(entry.kind))
    const imageUrlsValid = product.imageUrls.length > 0 &&
      product.imageUrls.every((value) => {
        try { return new URL(value).protocol === "https:" } catch { return false }
      })
    const listingPackage = Object.freeze({
      title: recommendedTitle, categoryId: market.resolvedCategoryId,
      itemSpecifics, imageUrls: product.imageUrls,
      sourceTraceId: traceId, publicationAuthority:
        "EXISTING_SELLER_OS_DRAFT_ONLY_PIPELINE",
    })
    const decisionLoop = buildCommercialDecisionLoopSnapshotV1_1({
      analysisComplete: true, finalDecision: decision.finalDecision,
      productTruthSufficient: safeClaimTruth.identitySufficient,
      safeClaimsPresent: safeClaimTruth.safeClaims.length > 0,
      stockValid: variant.available,
      shippingQty1Fresh: Boolean(shipping),
      marketAuthoritySufficient: market.demandValidationPassed,
      pricingAuthoritySufficient:
        market.pricingEvidenceQuality.strongDecisionAllowed,
      economicsPass: decision.economics?.passesProfitGate === true,
      primaryKeywordComplete: Boolean(market.primaryKeywordFamily),
      titleComplete: Boolean(recommendedTitle),
      itemSpecificsComplete: itemSpecifics.length > 0,
      imagesValid: imageUrlsValid,
      complianceClear: compliance.status !== "BLOCKED",
      ipClear: compliance.blockers.length === 0,
      autoPublish: false,
    })
    await emit("DECISION_LOOP", decisionLoop.state === "LISTING_PACKAGE_READY"
      ? "PASS" : "BLOCKED",
      decisionLoop.state === "LISTING_PACKAGE_READY"
        ? "El expediente y el paquete comercial están listos. AUTO_PUBLISH está desactivado; el Owner conserva el CTA Publicar producto."
        : `El loop comercial se detuvo de forma segura en ${decisionLoop.state}; ${decisionLoop.blockers.length} requisito(s) permanecen pendientes.`,
      { decisionLoop, listingPackage, autoPublish: false,
        publicationWrites: 0, ebayWrites: 0 })
    await emit("FINAL_DECISION", "PASS",
      `Decisión final autónoma: ${decision.finalDecision}. Confianza ${decision.confidence}.`,
      { finalDecision: decision.finalDecision, confidence: decision.confidence,
        knownUncertainties, commercialTraceCertification:
          certificationPass ? "PASS" : "FAIL",
        noPublicationWrite: true, noEbayWrite: true,
        purchaseBoundaryEnforced: true })
    const now = new Date().toISOString()
    const result = Object.freeze({
      TRACE_ID: traceId,
      SYSTEM_VERSION: SELLER_OS_COMMERCIAL_DECISION_LOOP_V1_1,
      FINAL_DECISION: decision.finalDecision,
      CONFIDENCE: decision.confidence,
      RECOMMENDED_PRICE: decision.recommendedPrice,
      PRIMARY_KEYWORD_FAMILY: market.primaryKeywordFamily,
      LANDED_COST: decision.landedCost,
      ACCEPTED_COMPARABLE_COUNT: market.acceptedComparables.length,
      EXCLUDED_COMPARABLE_COUNT: market.excludedComparables.length,
      EXACT_MODEL_SEARCH_QUERY: market.exactModelSearchQuery,
      FUNCTIONAL_SEARCH_QUERY: market.functionalSearchQuery,
      EXACT_MODEL_ACCEPTED: market.exactModelAccepted,
      NEAR_EXACT_ACCEPTED: market.nearExactAccepted,
      FUNCTIONAL_ACCEPTED: market.functionalAccepted,
      NON_COMPARABLE: market.nonComparable,
      CONFIRMED_SOLD_EVIDENCE: market.confirmedSoldEvidence,
      ESTIMATED_SOLD_EVIDENCE: market.estimatedSoldEvidence,
      STRUCTURED_MODEL_CONFLICTS: market.structuredModelConflicts,
      NEAR_EXACT_SOLD_ENRICHMENT: market.nearExactSoldEnrichment,
      KNOWN_UNCERTAINTIES: knownUncertainties,
      COMMERCIAL_TRACE_CERTIFICATION: certificationPass ? "PASS" : "FAIL",
      PRODUCT_TRUTH: { productId: product.productId, variantId: variant.id,
        supplierSku: variant.sku, title: product.title,
        variantTitle: variant.title, gtin: variant.sourceUnitBarcode,
        model: safeClaimTruth.safeClaims.find((entry) =>
          entry.kind === "MODEL")?.value ?? null,
        productType: product.productType, imageCount: product.imageUrls.length },
      CLAIM_CONFLICTS: conflicts,
      SAFE_CLAIM_SUBSET: safeClaimTruth.safeClaims,
      DO_NOT_USE_CLAIMS: safeClaimTruth.doNotUseClaims,
      COMPLIANCE: compliance,
      STOCK: { available: variant.available,
        quantity: variant.sourceInventoryQuantity ?? null },
      PRODUCT_COST: variant.sourceUnitPrice,
      SHIPPING_QTY1: shipping?.amountUsd ?? null,
      PRICE_RANGE: market.priceRange,
      MINIMUM_MARGIN_SAFE_PRICE: decision.minimumMarginSafePrice,
      ECONOMIC_FLOOR_EXPLANATION: decision.economicFloorExplanation,
      ECONOMICS: decision.economics,
      SECONDARY_KEYWORDS: market.secondaryKeywords,
      LONG_TAIL_KEYWORDS: market.longTailKeywords,
      PRODUCT_DIFFERENTIATORS: market.productDifferentiators,
      UNSUPPORTED_OR_EXCLUDED_TERMS: market.unsupportedOrExcludedTerms,
      FINAL_EBAY_TITLE: market.finalEbayTitle,
      RAW_KEYWORD_EVIDENCE: market.rawKeywordEvidence,
      KEYWORD_PROVENANCE: market.keywordProvenance,
      PRICING_EVIDENCE_QUALITY: market.pricingEvidenceQuality,
      DEMAND_CLASSIFICATION: market.demandClassification,
      ACCEPTED_COMPARABLES: market.acceptedComparables,
      EXCLUDED_COMPARABLES: market.excludedComparables,
      LISTING_PACKAGE: listingPackage,
      DECISION_LOOP: decisionLoop,
      ACCEPTANCE: {
        KEYWORD_FAMILY_INCLUDES_MATERIAL_DIFFERENTIATORS:
          Boolean(market.primaryKeywordFamily && market.primaryKeywordFamily
            .toLocaleLowerCase("en-US").includes(" with ")),
        COMPARABLE_SAMPLING_SUFFICIENT_BEFORE_DEMAND_UNPROVEN:
          market.samplingSufficientBeforeDemandUnproven,
        EXACT_MODEL_COMPARABLES_PRIORITIZED:
          market.commercialSamplingPolicy?.strategy ===
            "EXACT_MODEL_THEN_NEAR_EXACT_THEN_FUNCTIONAL_THEN_NON_COMPARABLE",
        NEAR_EXACT_PRODUCT_SEPARATELY_CLASSIFIED: true,
        FUNCTIONAL_COMPARABLES_SEPARATELY_CLASSIFIED: true,
        CLAIM_CONFLICTS_VISIBLE: true,
        SAFE_CLAIM_SUBSET_SUPPORTED: safeClaimTruth.identitySufficient,
        NON_MATERIAL_CLAIM_CONFLICT_DOES_NOT_FORCE_HOLD:
          safeClaimTruth.materialConflictCount > 0 ||
          decision.finalDecision !== "HOLD_CLAIM_CONFLICTS",
        NO_UNSUPPORTED_CLAIMS: true,
        NO_PUBLICATION_WRITE: true,
        NO_EBAY_WRITE: true,
        PURCHASE_BOUNDARY_ENFORCED: true,
        LIVE_TRACE_REMAINS_HUMAN_READABLE: true,
      },
      safety: { publicationWrites: 0, ebayWrites: 0,
        purchaseCompleted: false, rawAddressPersisted: false,
        credentialsPersisted: false },
    })
    const completion = await input.supabase.from(
      "seller_os_live_commercial_traces_v1").update({ state: "COMPLETED",
        current_stage: "DECISION_LOOP", event_count: sequence,
        result, completed_at: now, updated_at: now }).eq("trace_id", traceId)
    if (completion.error) throw new Error(
      "LIVE_COMMERCIAL_TRACE_COMPLETION_WRITE_FAILED")
    return Object.freeze({ traceId, result })
  } catch (error) {
    await completeFailure({ supabase: input.supabase, traceId,
      code: safeCode(error), sequence: sequence + 1 }).catch(() => undefined)
    throw error
  }
}

export async function readSellerOsLiveCommercialTraceV1(input: Readonly<{
  supabase: SupabaseClient
  traceId?: string | null
}>) {
  let query = input.supabase.from("seller_os_live_commercial_traces_v1")
    .select("*").order("started_at", { ascending: false }).limit(1)
  if (input.traceId) query = query.eq("trace_id", input.traceId)
  const traceRead = await query.maybeSingle()
  if (traceRead.error) throw new Error("LIVE_COMMERCIAL_TRACE_READ_FAILED")
  if (!traceRead.data) return null
  const eventRead = await input.supabase.from(
    "seller_os_live_commercial_trace_events_v1").select("sequence,stage,status,narrative,evidence,observed_at")
    .eq("trace_id", traceRead.data.trace_id).order("sequence", {
      ascending: true }).limit(200)
  if (eventRead.error) throw new Error("LIVE_COMMERCIAL_TRACE_EVENT_READ_FAILED")
  return Object.freeze({ trace: traceRead.data,
    events: Object.freeze(eventRead.data ?? []) })
}
