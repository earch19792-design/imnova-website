import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  get888LotsRadarDashboardV1,
  type SellerOs888LotsRadarCardV1,
} from "./seller-os-888lots-public-radar-v1"

export const SELLER_OS_888LOTS_DUAL_MARKET_PRESEARCH_V1 =
  "SELLER_OS_888LOTS_DUAL_MARKET_PRESEARCH_V1" as const
export const SELLER_OS_888LOTS_AMAZON_STAR_READ_V1 =
  "SELLER_OS_888LOTS_AMAZON_STAR_READ_V1" as const
export const SELLER_OS_888LOTS_PRESEARCH_MAX_BATCH_V1 = 5 as const
export const SELLER_OS_888LOTS_STAR_LIMITS_V1 = [10, 20] as const
export const SELLER_OS_888LOTS_RETIRED_V1 = true as const

const PRESEARCH_REPLAY_WINDOW_MS = 6 * 60 * 60 * 1000
const PRESEARCH_FRESH_WINDOW_MS = 24 * 60 * 60 * 1000

type UnknownRecord = Record<string, unknown>

type EbayReader = (
  candidate: SellerOs888LotsRadarCardV1,
) => Promise<unknown>

export type SellerOs888LotsPreSearchResultV1 = Readonly<{
  contractVersion: typeof SELLER_OS_888LOTS_DUAL_MARKET_PRESEARCH_V1
  sourceKey: "888lots"
  supplierProductId: string
  supplierVariantId: string
  supplierSku: string
  title: string
  asin: string | null
  supplierObservationDigest: string
  completedAt: string
  preSearchScore: number
  researchDisposition: "DEEP_CHECK_NOW" | "REVIEW_RISK" |
    "WAIT_SUPPLIER" | "LOW_PRIORITY"
  publicationReadiness: "NOT_AUTHORIZED_EVIDENCE_REQUIRED"
  nextBestEvidence: "VERIFY_AMAZON_ASIN" |
    "VERIFY_AMAZON_ELIGIBILITY" | "GET_AMAZON_DEMAND" |
    "CAPTURE_DELIVERED_COST" | "GET_EBAY_EXACT_SOLD" |
    "WAIT_UPSTREAM" | "READY_FOR_OWNER_BUY_REVIEW"
  blockers: readonly string[]
  supplier: Readonly<{
    availableQuantity: number | null
    minimumOrderQuantity: number | null
    currentUnitCostUsd: number | null
    publicShippingEstimateUsd: number | null
    supplierAmazonPriceEstimateUsd: number | null
    supplierAmazonEstimateIsMarketProof: false
    deliveredCostState: "UNPROVEN"
  }>
  amazon: Readonly<{
    asin: string | null
    identityState: "SUPPORTED" | "UNPROVEN"
    identityAuthority: "888LOTS_SUPPLIER_ASSERTED_ASIN" | null
    eligibilityState: "UNPROVEN"
    demandState: "UNPROVEN"
    offerPriceState: "UNPROVEN"
    sellerCentralAutomationState: "UNAVAILABLE_NOT_CONFIGURED"
    maximumSupplierUnitCostUsd: number | null
  }>
  ebay: Readonly<{
    status: "AVAILABLE" | "UNAVAILABLE"
    evidenceLevel: string | null
    activeComparableCount: number | null
    activeSellerCount: number | null
    soldEvidenceState: "PROVEN" | "SUPPORTED" | "UNPROVEN" |
      "UNAVAILABLE"
    observedSoldQuantity: number | null
    demandValidationPassed: boolean | null
    demandValidationBasis: string | null
    minimumComparableLandedPriceUsd: number | null
    medianComparableLandedPriceUsd: number | null
    maximumComparableLandedPriceUsd: number | null
    limitationCode: string | null
    source: "EBAY_OFFICIAL_READONLY_PRESEARCH"
  }>
  evidencePolicy: Readonly<{
    noFalseZeros: true
    supplierEstimateSeparatedFromMarketplaceEvidence: true
    minimumNetProfitUsd: 4
    clickOnlyMaximumTestUnits: 3
    exactVelocityCoverageDays: 14
  }>
  safety: Readonly<{
    supplierPurchases: 0
    marketplaceWrites: 0
    publications: 0
    repricing: 0
  }>
  resultDigest: string
}>

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function integerOrNull(value: unknown) {
  const parsed = numberOrNull(value)
  return parsed === null ? null : Math.trunc(parsed)
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value))
    .digest("hex")}`
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]{3,160}$/.test(message)
    ? message : "EBAY_PRESEARCH_UNAVAILABLE"
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * ratio)))
  return Number(sorted[index].toFixed(2))
}

function mappedEbayEvidence(reportValue: unknown, errorCode?: string | null) {
  if (errorCode) return {
    status: "UNAVAILABLE" as const,
    evidenceLevel: null,
    activeComparableCount: null,
    activeSellerCount: null,
    soldEvidenceState: "UNAVAILABLE" as const,
    observedSoldQuantity: null,
    demandValidationPassed: null,
    demandValidationBasis: null,
    minimumComparableLandedPriceUsd: null,
    medianComparableLandedPriceUsd: null,
    maximumComparableLandedPriceUsd: null,
    limitationCode: errorCode,
    source: "EBAY_OFFICIAL_READONLY_PRESEARCH" as const,
  }
  const report = record(reportValue)
  const available = Boolean(text(report.validationVersion))
  if (!available) return mappedEbayEvidence(null,
    "EBAY_PRESEARCH_RESPONSE_INVALID")
  const demandPassed = typeof report.demandValidationPassed === "boolean"
    ? report.demandValidationPassed : null
  const demandBasis = text(report.demandValidationBasis) || null
  const verified = numberOrNull(report.totalVerifiedSoldQuantity)
  const estimated = numberOrNull(report.totalEstimatedSoldQuantity)
  const soldEvidenceState = demandPassed === true &&
      demandBasis === "VERIFIED_HISTORICAL_MULTI_SELLER"
    ? "PROVEN" as const
    : demandPassed === true ? "SUPPORTED" as const : "UNPROVEN" as const
  const soldQuantity = soldEvidenceState === "PROVEN"
    ? verified !== null && verified > 0 ? verified : null
    : soldEvidenceState === "SUPPORTED"
      ? estimated !== null && estimated > 0 ? estimated : null : null
  const landedPrices = array(report.comparableEvidence).map(record)
    .filter((entry) => entry.eligibleComparable === true &&
      entry.pricingAuthorityEligible === true)
    .map((entry) => {
      const price = numberOrNull(entry.price)
      const shipping = numberOrNull(entry.shippingCost)
      return price === null ? null : Number((price + (shipping ?? 0)).toFixed(2))
    }).filter((value): value is number => value !== null)
  return {
    status: "AVAILABLE" as const,
    evidenceLevel: text(report.evidenceLevel) || null,
    activeComparableCount: integerOrNull(report.eligibleComparableListings),
    activeSellerCount: integerOrNull(report.sellersAnalyzed),
    soldEvidenceState,
    observedSoldQuantity: soldQuantity,
    demandValidationPassed: demandPassed,
    demandValidationBasis: demandBasis,
    minimumComparableLandedPriceUsd: percentile(landedPrices, 0),
    medianComparableLandedPriceUsd: percentile(landedPrices, 0.5),
    maximumComparableLandedPriceUsd: percentile(landedPrices, 1),
    limitationCode: soldEvidenceState === "UNPROVEN"
      ? "GET_EBAY_EXACT_SOLD" : null,
    source: "EBAY_OFFICIAL_READONLY_PRESEARCH" as const,
  }
}

function hasSevereRisk(candidate: SellerOs888LotsRadarCardV1) {
  return candidate.riskFlags.some((flag) =>
    /APPROVAL|AUTHENTICITY|FUNCTIONALITY/.test(flag))
}

export function select888LotsPreSearchCandidatesV1(
  cards: readonly SellerOs888LotsRadarCardV1[],
  limit: number = SELLER_OS_888LOTS_PRESEARCH_MAX_BATCH_V1,
) {
  const bounded = Math.min(Math.max(Math.trunc(limit), 1),
    SELLER_OS_888LOTS_PRESEARCH_MAX_BATCH_V1)
  return [...cards].filter((candidate) =>
    !["REJECTED", "RESULT", "BUY_READY"].includes(candidate.operatingLane) &&
    (candidate.availableQuantity ?? 0) > 0 &&
    (candidate.availableQuantity ?? 0) >=
      (candidate.minimumOrderQuantity ?? Number.POSITIVE_INFINITY))
    .sort((left, right) => {
      const leftPreSearch = record(left.preSearch)
      const rightPreSearch = record(right.preSearch)
      const leftMissing = text(leftPreSearch.contractVersion) ===
        SELLER_OS_888LOTS_DUAL_MARKET_PRESEARCH_V1 ? 0 : 1
      const rightMissing = text(rightPreSearch.contractVersion) ===
        SELLER_OS_888LOTS_DUAL_MARKET_PRESEARCH_V1 ? 0 : 1
      return rightMissing - leftMissing ||
        right.researchScore - left.researchScore ||
        (left.minimumOrderQuantity ?? 999) -
          (right.minimumOrderQuantity ?? 999) ||
        right.lastObservedAt.localeCompare(left.lastObservedAt)
    }).slice(0, bounded)
}

export function build888LotsDualMarketPreSearchResultV1(input: {
  candidate: SellerOs888LotsRadarCardV1
  ebayReport?: unknown
  ebayErrorCode?: string | null
  observedAt: string
}) {
  if (!Number.isFinite(Date.parse(input.observedAt))) {
    throw new Error("SELLER_OS_888LOTS_PRESEARCH_TIME_INVALID")
  }
  const candidate = input.candidate
  const ebay = mappedEbayEvidence(input.ebayReport,
    input.ebayErrorCode ?? null)
  const stockAvailable = (candidate.availableQuantity ?? 0) > 0 &&
    (candidate.availableQuantity ?? 0) >=
      (candidate.minimumOrderQuantity ?? Number.POSITIVE_INFINITY)
  const severeRisk = hasSevereRisk(candidate)
  const preSearchScore = Math.min(79, Math.max(0, Math.round(
    candidate.researchScore * 0.65 +
    (candidate.asin ? 5 : 0) +
    (ebay.soldEvidenceState === "PROVEN" ? 20
      : ebay.soldEvidenceState === "SUPPORTED" ? 12
        : (ebay.activeComparableCount ?? 0) > 0 ? 5 : 0) -
    (severeRisk ? 10 : 0))))
  const researchDisposition = !stockAvailable
    ? "WAIT_SUPPLIER" as const
    : severeRisk ? "REVIEW_RISK" as const
      : preSearchScore >= 50 ? "DEEP_CHECK_NOW" as const
        : "LOW_PRIORITY" as const
  const nextBestEvidence = !stockAvailable
    ? "WAIT_UPSTREAM" as const
    : !candidate.asin ? "VERIFY_AMAZON_ASIN" as const
      : severeRisk ? "VERIFY_AMAZON_ELIGIBILITY" as const
        : "GET_AMAZON_DEMAND" as const
  const blockers = [...new Set([
    ...candidate.blockers,
    "AMAZON_ELIGIBILITY_UNPROVEN",
    "AMAZON_DEMAND_UNPROVEN",
    "AMAZON_OFFER_PRICE_UNPROVEN",
    "DELIVERED_COST_CART_CONFIRMATION_REQUIRED",
    ...(ebay.status === "UNAVAILABLE"
      ? [ebay.limitationCode ?? "EBAY_PRESEARCH_UNAVAILABLE"] : []),
    ...(ebay.soldEvidenceState === "UNPROVEN"
      ? ["EBAY_EXACT_SOLD_UNPROVEN"] : []),
  ])]
  const withoutDigest = {
    contractVersion: SELLER_OS_888LOTS_DUAL_MARKET_PRESEARCH_V1,
    sourceKey: "888lots" as const,
    supplierProductId: candidate.supplierProductId,
    supplierVariantId: candidate.supplierVariantId,
    supplierSku: candidate.supplierSku,
    title: candidate.title,
    asin: candidate.asin,
    supplierObservationDigest: candidate.observationDigest,
    completedAt: input.observedAt,
    preSearchScore,
    researchDisposition,
    publicationReadiness: "NOT_AUTHORIZED_EVIDENCE_REQUIRED" as const,
    nextBestEvidence,
    blockers,
    supplier: {
      availableQuantity: candidate.availableQuantity,
      minimumOrderQuantity: candidate.minimumOrderQuantity,
      currentUnitCostUsd: candidate.currentUnitCostUsd,
      publicShippingEstimateUsd: candidate.publicShippingEstimateUsd,
      supplierAmazonPriceEstimateUsd:
        candidate.supplierAmazonPriceEstimateUsd,
      supplierAmazonEstimateIsMarketProof: false as const,
      deliveredCostState: "UNPROVEN" as const,
    },
    amazon: {
      asin: candidate.asin,
      identityState: candidate.asin ? "SUPPORTED" as const : "UNPROVEN" as const,
      identityAuthority: candidate.asin
        ? "888LOTS_SUPPLIER_ASSERTED_ASIN" as const : null,
      eligibilityState: "UNPROVEN" as const,
      demandState: "UNPROVEN" as const,
      offerPriceState: "UNPROVEN" as const,
      sellerCentralAutomationState: "UNAVAILABLE_NOT_CONFIGURED" as const,
      maximumSupplierUnitCostUsd:
        candidate.commercialMaxSupplierUnitCostUsd,
    },
    ebay,
    evidencePolicy: {
      noFalseZeros: true as const,
      supplierEstimateSeparatedFromMarketplaceEvidence: true as const,
      minimumNetProfitUsd: 4 as const,
      clickOnlyMaximumTestUnits: 3 as const,
      exactVelocityCoverageDays: 14 as const,
    },
    safety: { supplierPurchases: 0 as const,
      marketplaceWrites: 0 as const, publications: 0 as const,
      repricing: 0 as const },
  }
  const digestBasis = { ...withoutDigest, completedAt: null }
  return Object.freeze({ ...withoutDigest,
    resultDigest: sha256(digestBasis) }) satisfies
      SellerOs888LotsPreSearchResultV1
}

function isFreshReplay(candidate: SellerOs888LotsRadarCardV1, now: Date) {
  const existing = record(candidate.preSearch)
  return existing.contractVersion ===
      SELLER_OS_888LOTS_DUAL_MARKET_PRESEARCH_V1 &&
    existing.publicationReadiness ===
      "NOT_AUTHORIZED_EVIDENCE_REQUIRED" &&
    /^sha256:[0-9a-f]{64}$/.test(text(existing.resultDigest)) &&
    existing.supplierObservationDigest === candidate.observationDigest &&
    Number.isFinite(Date.parse(text(existing.completedAt))) &&
    now.getTime() - Date.parse(text(existing.completedAt)) >= 0 &&
    now.getTime() - Date.parse(text(existing.completedAt)) <
      PRESEARCH_REPLAY_WINDOW_MS
}

async function defaultEbayReader(
  candidate: SellerOs888LotsRadarCardV1,
) {
  const gateway = await import("../ebay/ebay-seller-keyword-demand-gateway")
  return gateway.runEbaySellerKeywordDemandValidation({
    productName: candidate.title,
    productTitle: candidate.title,
    supplierSku: candidate.supplierSku,
    gtin: candidate.upc,
    brand: candidate.brand,
    productType: candidate.category ?? candidate.department,
  })
}

async function mapWithConcurrency<T, R>(values: readonly T[], maximum: number,
  mapper: (value: T) => Promise<R>) {
  const output = new Array<R>(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(maximum, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++
        output[index] = await mapper(values[index])
      }
    })
  await Promise.all(workers)
  return output
}

export async function run888LotsDualMarketPreSearchV1(input: {
  supabase: SupabaseClient
  accountKey: string
  limit?: number
  now?: Date
  ebayReader?: EbayReader
}) {
  const now = input.now ?? new Date()
  const observedAt = now.toISOString()
  const dashboard = await get888LotsRadarDashboardV1({
    supabase: input.supabase, accountKey: input.accountKey, limit: 100,
  })
  const selected = select888LotsPreSearchCandidatesV1(dashboard.cards,
    input.limit)
  const ebayReader = input.ebayReader ?? defaultEbayReader
  let ebayCalls = 0
  const evaluated = await mapWithConcurrency(selected, 2,
    async (candidate) => {
      if (isFreshReplay(candidate, now)) {
        return { candidate, result: candidate.preSearch as
          SellerOs888LotsPreSearchResultV1, replay: true }
      }
      let ebayReport: unknown = null
      let ebayErrorCode: string | null = null
      try {
        ebayCalls += 1
        ebayReport = await ebayReader(candidate)
      } catch (error) {
        ebayErrorCode = safeErrorCode(error)
      }
      return { candidate,
        result: build888LotsDualMarketPreSearchResultV1({ candidate,
          ebayReport, ebayErrorCode, observedAt }), replay: false }
    })
  const pending = evaluated.filter((entry) => !entry.replay)
  let inserted: Array<{ id: string, product_id: string }> = []
  if (pending.length > 0) {
    const snapshotIds = pending.map((entry) => entry.candidate.snapshotId)
    const sourceSnapshots = await input.supabase
      .from("market_radar_snapshots")
      .select("id,source_id,product_id,supplier_variant_id,variant_title,sku,barcode,price,compare_at_price,available,inventory_quantity,collections,discount_percent,raw")
      .in("id", snapshotIds)
    if (sourceSnapshots.error ||
        (sourceSnapshots.data?.length ?? 0) !== snapshotIds.length) {
      throw new Error("SELLER_OS_888LOTS_PRESEARCH_SOURCE_READ_FAILED")
    }
    const sourceById = new Map((sourceSnapshots.data ?? []).map((row) =>
      [String(row.id), record(row)]))
    const insertRows = pending.map((entry) => {
      const source = sourceById.get(entry.candidate.snapshotId)
      if (!source) throw new Error(
        "SELLER_OS_888LOTS_PRESEARCH_SOURCE_READBACK_FAILED")
      return {
        source_id: source.source_id,
        product_id: source.product_id,
        supplier_variant_id: source.supplier_variant_id,
        variant_title: source.variant_title,
        sku: source.sku,
        barcode: source.barcode,
        price: source.price,
        compare_at_price: source.compare_at_price,
        available: source.available,
        inventory_quantity: source.inventory_quantity,
        collections: source.collections,
        discount_percent: source.discount_percent,
        raw: { ...record(source.raw), preSearch: entry.result },
        captured_at: observedAt,
      }
    })
    const write = await input.supabase.from("market_radar_snapshots")
      .insert(insertRows).select("id,product_id")
    if (write.error || (write.data?.length ?? 0) !== insertRows.length) {
      throw new Error("SELLER_OS_888LOTS_PRESEARCH_WRITE_FAILED")
    }
    inserted = (write.data ?? []).map((row) => ({ id: String(row.id),
      product_id: String(row.product_id) }))
    const readback = await input.supabase.from("market_radar_snapshots")
      .select("id,product_id,raw").in("id", inserted.map((row) => row.id))
    const expectedDigestByProduct = new Map(pending.map((entry) => [
      entry.candidate.productId, entry.result.resultDigest,
    ]))
    const readbackVerified = !readback.error &&
      (readback.data?.length ?? 0) === inserted.length &&
      (readback.data ?? []).every((row) =>
        text(record(record(row.raw).preSearch).resultDigest) ===
          expectedDigestByProduct.get(String(row.product_id)))
    if (!readbackVerified) {
      throw new Error("SELLER_OS_888LOTS_PRESEARCH_READBACK_FAILED")
    }
    const sourceByProduct = new Map((sourceSnapshots.data ?? []).map((row) =>
      [String(row.product_id), String(row.source_id)]))
    const scoreRows = pending.map((entry) => {
      const sourceId = sourceByProduct.get(entry.candidate.productId)
      if (!sourceId) throw new Error(
        "SELLER_OS_888LOTS_PRESEARCH_SOURCE_READBACK_FAILED")
      return { product_id: entry.candidate.productId, source_id: sourceId,
        opportunity_score: entry.result.preSearchScore,
        updated_at: observedAt }
    })
    const scoreWrite = await input.supabase.from("market_radar_scores")
      .upsert(scoreRows, { onConflict: "product_id" })
    if (scoreWrite.error) {
      throw new Error("SELLER_OS_888LOTS_PRESEARCH_SCORE_WRITE_FAILED")
    }
  }
  return Object.freeze({
    contractVersion: SELLER_OS_888LOTS_DUAL_MARKET_PRESEARCH_V1,
    observedAt,
    selectedCount: selected.length,
    researchedCount: pending.length,
    replayedCount: evaluated.filter((entry) => entry.replay).length,
    ebayReadonlyCalls: ebayCalls,
    persistedSnapshotCount: inserted.length,
    results: evaluated.map((entry) => ({ ...entry.result,
      replayed: entry.replay })),
    receipt: { requestedProductIds: selected.map((row) => row.productId),
      insertedSnapshotIds: inserted.map((row) => row.id),
      readbackVerified: inserted.length === pending.length },
    safety: { internalDatabaseWrites: inserted.length,
      supplierPurchases: 0, marketplaceWrites: 0,
      publications: 0, repricing: 0 },
  })
}

export function assert888LotsAmazonStarLimitV1(value: unknown) {
  const parsed = Number(value ?? 10)
  if (!SELLER_OS_888LOTS_STAR_LIMITS_V1.includes(parsed as 10 | 20)) {
    throw new Error("SELLER_OS_888LOTS_STAR_LIMIT_INVALID")
  }
  return parsed as 10 | 20
}

export async function get888LotsAmazonStarCandidatesV1(input: {
  supabase: SupabaseClient
  accountKey: string
  limit?: 10 | 20
  now?: Date
}) {
  const now = input.now ?? new Date()
  const limit = assert888LotsAmazonStarLimitV1(input.limit)
  if (SELLER_OS_888LOTS_RETIRED_V1) {
    return Object.freeze({
      contractVersion: SELLER_OS_888LOTS_AMAZON_STAR_READ_V1,
      sourceKey: "888lots" as const,
      marketplace: "AMAZON_US" as const,
      supplierStatus: "RETIRED" as const,
      retirementReason: "SUPPLIER_CLOSING" as const,
      requestedLimit: limit, returnedCount: 0,
      observedAt: now.toISOString(), candidates: [],
      interpretation: {
        starMeansResearchPriorityNotPublicationAuthorization: true as const,
        publicationReadyCount: 0 as const,
        supplierExcludedFromNewRecommendations: true as const,
        historicalEvidencePreserved: true as const,
      },
      policy: { minimumNetProfitUsd: 4 as const,
        clickOnlyMaximumTestUnits: 3 as const,
        exactVelocityCoverageDays: 14 as const },
      safety: { readOnly: true as const, supplierReads: 0 as const,
        supplierPurchases: 0 as const, marketplaceWrites: 0 as const,
        publications: 0 as const, repricing: 0 as const,
        buyerPiiIncluded: false as const, credentialsIncluded: false as const },
    })
  }
  const dashboard = await get888LotsRadarDashboardV1({
    supabase: input.supabase, accountKey: input.accountKey, limit: 100,
  })
  const candidates = dashboard.cards.filter((candidate) =>
    !["REJECTED", "RESULT"].includes(candidate.operatingLane) &&
    (candidate.availableQuantity ?? 0) > 0 &&
    (candidate.availableQuantity ?? 0) >=
      (candidate.minimumOrderQuantity ?? Number.POSITIVE_INFINITY))
    .map((candidate) => {
      const preSearch = record(candidate.preSearch)
      const completedAt = text(preSearch.completedAt)
      const preSearchAvailable = preSearch.contractVersion ===
        SELLER_OS_888LOTS_DUAL_MARKET_PRESEARCH_V1
      const preSearchFresh = preSearchAvailable &&
        Number.isFinite(Date.parse(completedAt)) &&
        now.getTime() - Date.parse(completedAt) >= 0 &&
        now.getTime() - Date.parse(completedAt) < PRESEARCH_FRESH_WINDOW_MS
      const score = integerOrNull(preSearch.preSearchScore) ??
        Math.min(candidate.researchScore, 49)
      const nextBestEvidence = text(preSearch.nextBestEvidence) ||
        candidate.nextBestEvidence
      const disposition = text(preSearch.researchDisposition) ||
        (hasSevereRisk(candidate) ? "REVIEW_RISK" : "PRESEARCH_REQUIRED")
      return {
        rankScore: score,
        supplierProductId: candidate.supplierProductId,
        supplierVariantId: candidate.supplierVariantId,
        supplierSku: candidate.supplierSku,
        title: candidate.title,
        brand: candidate.brand,
        category: candidate.category ?? candidate.department,
        productUrl: candidate.productUrl,
        imageUrl: candidate.imageUrl,
        asin: candidate.asin,
        upc: candidate.upc,
        availableQuantity: candidate.availableQuantity,
        minimumOrderQuantity: candidate.minimumOrderQuantity,
        currentSupplierUnitCostUsd: candidate.currentUnitCostUsd,
        publicShippingEstimateUsd: candidate.publicShippingEstimateUsd,
        deliveredUnitCostUsd: null,
        supplierAmazonPriceEstimateUsd:
          candidate.supplierAmazonPriceEstimateUsd,
        supplierEstimateIsMarketProof: false as const,
        maximumSupplierUnitCostUsd:
          candidate.commercialMaxSupplierUnitCostUsd,
        minimumNetProfitUsd: 4 as const,
        preSearchStatus: !preSearchAvailable ? "NOT_RUN" as const
          : preSearchFresh ? "FRESH" as const : "STALE" as const,
        preSearchCompletedAt: completedAt || null,
        researchDisposition: disposition,
        nextBestEvidence,
        blockers: preSearchAvailable ? array(preSearch.blockers).map(String)
          : [...candidate.blockers, "AUTOMATED_PRESEARCH_REQUIRED"],
        amazonEvidence: preSearchAvailable ? record(preSearch.amazon) : {
          identityState: candidate.asin ? "SUPPORTED" : "UNPROVEN",
          eligibilityState: "UNPROVEN", demandState: "UNPROVEN",
          offerPriceState: "UNPROVEN",
        },
        ebayEvidence: preSearchAvailable ? record(preSearch.ebay) : {
          status: "UNAVAILABLE", soldEvidenceState: "UNAVAILABLE",
          limitationCode: "AUTOMATED_PRESEARCH_NOT_RUN",
        },
        commercialDecision: candidate.commercialDecision,
        publicationRecommendation:
          "NOT_AUTHORIZED_EVIDENCE_REQUIRED" as const,
      }
    }).sort((left, right) => right.rankScore - left.rankScore ||
      (left.minimumOrderQuantity ?? 999) -
        (right.minimumOrderQuantity ?? 999) ||
      left.title.localeCompare(right.title)).slice(0, limit)
    .map((candidate, index) => ({ rank: index + 1, ...candidate }))
  return Object.freeze({
    contractVersion: SELLER_OS_888LOTS_AMAZON_STAR_READ_V1,
    sourceKey: "888lots" as const,
    marketplace: "AMAZON_US" as const,
    requestedLimit: limit,
    returnedCount: candidates.length,
    observedAt: now.toISOString(),
    candidates,
    interpretation: {
      starMeansResearchPriorityNotPublicationAuthorization: true as const,
      publicationReadyCount: 0 as const,
      ownerMustConfirmAmazonEligibilityDemandPriceAndFees: true as const,
      deliveredCostMustBeConfirmedInSupplierCart: true as const,
    },
    policy: { minimumNetProfitUsd: 4 as const,
      clickOnlyMaximumTestUnits: 3 as const,
      exactVelocityCoverageDays: 14 as const },
    safety: { readOnly: true as const, supplierPurchases: 0 as const,
      marketplaceWrites: 0 as const, publications: 0 as const,
      repricing: 0 as const, buyerPiiIncluded: false as const,
      credentialsIncluded: false as const },
  })
}
