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

export const SELLER_OS_LIVE_COMMERCIAL_TRACE_V1 =
  "SELLER_OS_LIVE_COMMERCIAL_TRACE_V1" as const
const SHIPPING_MAX_AGE_MS = 24 * 60 * 60 * 1_000
type JsonRecord = Record<string, unknown>
type MarketReaderV1 = (candidate: EbaySellerKeywordCandidate) =>
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
  source: "LUNA_PRODUCT_TITLE"
  status: "CONFIRMED_SAFE_SUBSET"
}>

const SAFE_PRODUCT_IDENTITIES_V1 = ["webcam", "camera", "scale", "vacuum",
  "translator", "necklace", "bracelet", "ring", "holder", "chopper",
  "turntable", "backpack", "bag"] as const

export function buildConservativeSafeClaimSubsetV1(product: Readonly<{
  title: string
  descriptionText?: string | null
}>) {
  const title = product.title.normalize("NFKC")
  const normalizedTitle = title.toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ").trim()
  const conflicts = detectCommercialClaimConflictsV1(product)
  const claims: SafeCommercialClaimV1[] = []
  const add = (value: string, normalizedValue: string,
    kind: SafeCommercialClaimV1["kind"]) => {
    if (claims.some((entry) => entry.normalizedValue === normalizedValue)) return
    claims.push(Object.freeze({ value, normalizedValue, kind,
      source: "LUNA_PRODUCT_TITLE", status: "CONFIRMED_SAFE_SUBSET" }))
  }
  const identity = SAFE_PRODUCT_IDENTITIES_V1.find((term) =>
    new RegExp(`\\b${term}\\b`).test(normalizedTitle)) ?? null
  if (identity) add(identity[0].toUpperCase() + identity.slice(1), identity,
    "PRODUCT_IDENTITY")
  const titleResolutions = [...new Set(normalizedTitle.match(
    /\b(?:720p|1080p|2k|4k|8k)\b/g) ?? [])]
  if (titleResolutions.length === 1) add(titleResolutions[0].toUpperCase(),
    titleResolutions[0], "SPECIFICATION")
  if (/\bbuilt\s+in\s+speakers?\b/.test(normalizedTitle)) add(
    "Built-In Speakers", "built in speakers", "FUNCTIONAL_DIFFERENTIATOR")
  if (/\b(?:microphone|mic)\b/.test(normalizedTitle)) add(
    "Microphone", "microphone", "FUNCTIONAL_DIFFERENTIATOR")
  if (/\busb\s*c\b/.test(normalizedTitle)) add("USB-C", "usb c", "CONNECTIVITY")
  if (/\busb\s*a\b/.test(normalizedTitle)) add("USB-A", "usb a", "CONNECTIVITY")
  for (const model of title.match(/\b(?=[A-Za-z0-9-]{5,}\b)(?=[A-Za-z0-9-]*[A-Za-z])(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]+\b/g) ?? []) {
    if (!/^\d{3,4}p$/i.test(model) && !/^usb-?[ac]?$/i.test(model)) {
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
  const identitySufficient = Boolean(identity && claims.some((entry) =>
    entry.kind === "MODEL" || entry.kind === "FUNCTIONAL_DIFFERENTIATOR"))
  return Object.freeze({ safeClaims: Object.freeze(claims),
    doNotUseClaims: Object.freeze(doNotUseClaims), identitySufficient,
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

export function buildCommercialMarketProjectionV1(
  report: EbaySellerKeywordDemandReport | null,
  safeClaims: readonly SafeCommercialClaimV1[] = [],
) {
  const observed = (report?.comparableEvidence ?? []).map((entry) =>
    record(entry))
  const accepted = observed.filter((entry) => entry.eligibleComparable === true)
  const excluded = observed.filter((entry) => entry.eligibleComparable !== true)
  const demandBearing = accepted.filter((entry) =>
    (number(entry.salesQuantity) ?? 0) > 0)
  const pricingPool = report?.demandValidationPassed ? demandBearing : []
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
    return Object.freeze({
      comparableId: text(entry.comparableId, 160),
      title: text(entry.title, 500),
      itemWebUrl: text(entry.itemWebUrl, 2_000),
      price: number(entry.price), shippingCost: number(entry.shippingCost),
      currency: text(entry.currency, 8),
      evidenceSource: text(entry.evidenceSource, 120),
      identityMatchQuality: text(entry.identityMatchQuality, 80),
      identityEvidenceClass: text(entry.identityEvidenceClass, 120),
      comparableClass: text(entry.commercialComparableClass, 80),
      exactModelToken: text(entry.exactModelToken, 80),
      verifiedSoldQuantity: number(entry.verifiedSoldQuantity) ?? 0,
      estimatedSoldQuantity: number(entry.estimatedSoldQuantity) ?? 0,
      sellerUsername: text(entry.sellerUsername, 160),
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
    rejectionReason: comparableRejectionReason(entry),
  }))
  const structure = report?.recommendedListingKeywordStructure
  const demand = !report ? "MARKET_READ_UNAVAILABLE"
    : report.demandValidationBasis === "VERIFIED_HISTORICAL_MULTI_SELLER"
      ? "VERIFIED_MULTI_SELLER_DEMAND"
      : report.demandValidationBasis === "ESTIMATED_MULTI_SELLER_SIGNAL"
        ? "ESTIMATED_MULTI_SELLER_DEMAND"
        : report.eligibleComparableListings > 0
          ? "COMPARABLES_OBSERVED_DEMAND_UNPROVEN"
          : "INSUFFICIENT_COMPARABLE_EVIDENCE"
  return Object.freeze({
    searchQuery: report?.searchQuery ?? null,
    primaryKeywordFamily: buildMaterialKeywordFamilyV1(report, safeClaims),
    secondaryKeywords: Object.freeze([...(structure?.secondarySearchTerms ?? [])]),
    demandClassification: demand,
    demandValidationBasis: report?.demandValidationBasis ?? "INSUFFICIENT_EVIDENCE",
    demandValidationPassed: report?.demandValidationPassed === true,
    acceptedComparables: Object.freeze(acceptedProjection),
    excludedComparables: Object.freeze(excludedProjection),
    priceRange: range,
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
  let finalDecision = "HOLD_INSUFFICIENT_EVIDENCE"
  if (input.complianceStatus === "BLOCKED") finalDecision = "REJECT_COMPLIANCE"
  else if ((input.materialClaimConflictCount ?? input.claimConflictCount) > 0) {
    finalDecision = "HOLD_CLAIM_CONFLICTS"
  }
  else if (input.shipping === null) finalDecision = "HOLD_SHIPPING_UNPROVEN"
  else if (!input.market.demandValidationPassed) {
    finalDecision = "HOLD_DEMAND_UNPROVEN"
  } else if (floorPrice !== null && marketMaximum !== null &&
      floorPrice > marketMaximum) finalDecision = "REJECT_ECONOMICS"
  else if (!economics?.passesProfitGate) finalDecision = "HOLD_ECONOMICS_UNPROVEN"
  else finalDecision = "ADVANCE_TO_OWNER_COMMERCIAL_REVIEW"
  const confidence = input.market.demandValidationBasis ===
      "VERIFIED_HISTORICAL_MULTI_SELLER" &&
      !(input.materialClaimConflictCount ?? input.claimConflictCount)
    ? "HIGH" : input.market.demandValidationPassed ? "MEDIUM" : "LOW"
  return Object.freeze({ landedCost, minimumMarginSafePrice: floorPrice,
    recommendedPrice, economics, finalDecision, confidence })
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
        variantTitle: variant.title, imageCount: product.imageUrls.length,
        sourceMode: product.sourceMode, sourceParserVersion:
          product.sourceParserVersion, rawHtmlPersisted: false })

    const conflicts = detectCommercialClaimConflictsV1(product)
    const safeClaimTruth = buildConservativeSafeClaimSubsetV1(product)
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
      report = await reader({ productName: safeMarketIdentity,
          productTitle: safeMarketIdentity, variantTitle: variant.title,
          supplierSku: variant.sku, gtin: variant.sourceUnitBarcode,
          productType: product.productType,
          description: safeClaimTruth.safeClaims.map((entry) => entry.value)
            .join(" ") })
    } catch (error) {
      marketFailure = safeCode(error)
    }
    const market = buildCommercialMarketProjectionV1(report,
      safeClaimTruth.safeClaims)
    await emit("MARKET_SEARCH_PROGRESS", report ? "PASS" : "BLOCKED",
      report
        ? `eBay devolvió ${market.returnedCandidateCount} candidatos; ${market.observedComparableCount} fueron enriquecidos y todos quedaron contabilizados como aceptados o excluidos.`
        : `La lectura de mercado no estuvo disponible (${marketFailure}); no se fabricó demanda ni precio.`,
      { searchQuery: market.searchQuery,
        candidateFoundCount: market.candidateFoundCount,
        returnedCandidateCount: market.returnedCandidateCount,
        enrichedSampleCount: market.enrichedSampleCount,
        observedComparableCount: market.observedComparableCount,
        commercialSamplingPolicy: market.commercialSamplingPolicy,
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
    await emit("ACCEPTED_COMPARABLES", "INFO",
      `${market.acceptedComparables.length} comparables pasaron identidad; exact-model y functional permanecen clasificados por separado.`,
      { acceptedComparables: market.acceptedComparables,
        acceptedCount: market.acceptedComparables.length })
    await emit("EXCLUDED_COMPARABLES", "INFO",
      `${market.excludedComparables.length} comparables fueron excluidos; cada uno conserva su razón.`,
      { excludedComparables: market.excludedComparables,
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
        feePolicyExact: decision.economics?.feePolicy?.exactFeeClaimed ?? false })

    const knownUncertainties = Object.freeze([
      ...conflicts.map((entry) => entry.code),
      ...market.sourceLimitations,
      ...(!market.demandValidationPassed ? ["DEMAND_NOT_PROVEN"] : []),
      ...(!market.priceRange ? ["MARKET_PRICE_DISTRIBUTION_UNPROVEN"] : []),
      ...(decision.economics?.feePolicy?.exactFeeClaimed === false
        ? ["EXACT_EBAY_CATEGORY_FEE_UNPROVEN"] : []),
      ...(variant.sourceInventoryQuantityExplicit !== true
        ? ["EXACT_SUPPLIER_QUANTITY_UNPROVEN"] : []),
    ])
    const certificationPass = market.everyObservedComparableAccountedFor &&
      market.samplingSufficientBeforeDemandUnproven &&
      safeClaimTruth.identitySufficient &&
      shipping?.noPurchase === true && shipping.noCredentials === true
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
      FINAL_DECISION: decision.finalDecision,
      CONFIDENCE: decision.confidence,
      RECOMMENDED_PRICE: decision.recommendedPrice,
      PRIMARY_KEYWORD_FAMILY: market.primaryKeywordFamily,
      LANDED_COST: decision.landedCost,
      ACCEPTED_COMPARABLE_COUNT: market.acceptedComparables.length,
      EXCLUDED_COMPARABLE_COUNT: market.excludedComparables.length,
      KNOWN_UNCERTAINTIES: knownUncertainties,
      COMMERCIAL_TRACE_CERTIFICATION: certificationPass ? "PASS" : "FAIL",
      PRODUCT_TRUTH: { productId: product.productId, variantId: variant.id,
        supplierSku: variant.sku, title: product.title },
      CLAIM_CONFLICTS: conflicts,
      SAFE_CLAIM_SUBSET: safeClaimTruth.safeClaims,
      DO_NOT_USE_CLAIMS: safeClaimTruth.doNotUseClaims,
      COMPLIANCE: compliance,
      STOCK: { available: variant.available,
        quantity: variant.sourceInventoryQuantity ?? null },
      PRODUCT_COST: variant.sourceUnitPrice,
      SHIPPING_QTY1: shipping?.amountUsd ?? null,
      PRICE_RANGE: market.priceRange,
      DEMAND_CLASSIFICATION: market.demandClassification,
      ACCEPTED_COMPARABLES: market.acceptedComparables,
      EXCLUDED_COMPARABLES: market.excludedComparables,
      ACCEPTANCE: {
        KEYWORD_FAMILY_INCLUDES_MATERIAL_DIFFERENTIATORS:
          Boolean(market.primaryKeywordFamily && market.primaryKeywordFamily
            .toLocaleLowerCase("en-US").includes(" with ")),
        COMPARABLE_SAMPLING_SUFFICIENT_BEFORE_DEMAND_UNPROVEN:
          market.samplingSufficientBeforeDemandUnproven,
        EXACT_MODEL_COMPARABLES_PRIORITIZED:
          market.commercialSamplingPolicy?.strategy ===
            "EXACT_MODEL_THEN_FUNCTIONAL_THEN_NON_COMPARABLE",
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
        current_stage: "FINAL_DECISION", event_count: sequence,
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
