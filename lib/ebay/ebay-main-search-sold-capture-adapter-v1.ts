// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { detectProductResearchOfferFacts } from "./ebay-product-research-browser-capture.ts"
import type { EbaySellerComparableInput } from "./ebay-seller-keyword-demand-validation"
import {
  canonicalizeComparableEvidenceByItemIdV1,
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
} from "./ebay-product-research-query-intelligence-v1.ts"

export const EBAY_MAIN_SEARCH_SOLD_CAPTURE_ADAPTER_VERSION =
  "EBAY_MAIN_SEARCH_SOLD_CAPTURE_ADAPTER_V1_2026_08_26"
export const EBAY_COMMERCIAL_TRACE_SOLD_CAPTURE_ADAPTER_VERSION =
  "EBAY_COMMERCIAL_TRACE_SOLD_CAPTURE_ADAPTER_V1_2026_09_13_FAIL_CLOSED_FIELD_PROVENANCE"

const MAX_ROWS = 200
const MAX_EVIDENCE_AGE_MS = 30 * 86_400_000
const LOOKUP_CONCURRENCY = 2

type JsonRecord = Record<string, unknown>
type OfficialItemReader = (legacyItemId: string) =>
  Promise<EbaySellerComparableInput | null>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 320) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

function money(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function positiveInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function safeFreeShippingNavigationEvidence(value: unknown,
  expectedQuery: string) {
  const evidence = record(value)
  const requestedUrl = text(evidence.requestedUrl, 1_000)
  const effectiveUrl = text(evidence.effectiveUrl, 1_000)
  const pendingUrl = text(evidence.pendingUrl, 1_000)
  const documentId = text(evidence.documentId, 100)
  const navigationStartedAt = new Date(text(evidence.navigationStartedAt, 80))
  const navigationCompletedAt = new Date(text(evidence.navigationCompletedAt, 80))
  const validUrl = (candidate: string) => {
    try {
      const url = new URL(candidate)
      return url.protocol === "https:" && url.hostname === "www.ebay.com" &&
        /^\/sch\//.test(url.pathname) &&
        url.searchParams.get("_nkw") === expectedQuery &&
        url.searchParams.get("LH_Sold") === "1" &&
        url.searchParams.get("LH_Complete") === "1" &&
        url.searchParams.get("LH_FS") === "1"
    } catch { return false }
  }
  if (evidence.filterProofStatus !== "FREE_SHIPPING_FILTER_PROVEN" ||
      !validUrl(requestedUrl) || !validUrl(effectiveUrl) ||
      !/^[A-Za-z0-9_-]{8,100}$/.test(documentId) ||
      !Number.isFinite(navigationStartedAt.getTime()) ||
      !Number.isFinite(navigationCompletedAt.getTime()) ||
      navigationCompletedAt.getTime() < navigationStartedAt.getTime()) return null
  return Object.freeze({ requestedUrl,
    pendingUrl: pendingUrl || null, effectiveUrl, documentId,
    navigationStartedAt: navigationStartedAt.toISOString(),
    navigationCompletedAt: navigationCompletedAt.toISOString(),
    filterProofStatus: "FREE_SHIPPING_FILTER_PROVEN" as const })
}

const GENERIC_SELLER_LABELS = new Set([
  "ebay seller", "seller", "shop", "vendedor", "vendedor ebay",
  "vendeur", "vendeur ebay", "verkaufer", "ebay verkaufer",
  "venditore", "venditore ebay",
])

function stableSellerUsername(value: unknown) {
  const candidate = text(value, 80)
  const normalized = candidate.toLocaleLowerCase("en-US")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  return candidate && /^[a-z0-9][a-z0-9._-]{1,63}$/i.test(candidate) &&
      !GENERIC_SELLER_LABELS.has(normalized)
    ? candidate : null
}

function safeSellerProfileUrl(value: unknown) {
  try {
    const url = new URL(text(value, 500))
    if (url.protocol !== "https:" || !/(^|\.)ebay\.com$/i.test(url.hostname) ||
      url.username || url.password || url.port) return null
    const match = url.pathname.match(/^\/(?:usr|str)\/([^/?#]{2,80})/i)
    const querySeller = url.searchParams.get("_ssn") ??
      url.searchParams.get("seller")
    const username = stableSellerUsername(match?.[1] ?? querySeller)
    return username ? { username,
      profileUrl: `https://www.ebay.com/usr/${encodeURIComponent(username)}` }
      : null
  } catch {
    return null
  }
}

function exactLegacyIdentity(detail: EbaySellerComparableInput | null, itemId: string) {
  const returned = text(detail?.itemId, 100)
  return Boolean(detail && detail.source === "EBAY_BROWSE_ACTIVE_LISTING" &&
    (returned === itemId || returned.split("|").includes(itemId)))
}

function safeCapturedRow(value: unknown, now: Date) {
  const row = record(value)
  const itemId = text(row.itemId ?? row.sourceListingId, 30)
  const title = text(row.title, 300)
  const queryIdentity = text(row.queryOrResearchIdentity, 100)
  const soldAt = new Date(text(row.soldAt ?? row.observedAt, 80))
  const capturedAt = new Date(text(row.capturedAt, 80))
  const displayedSoldPriceAmount = money(row.displayedSoldPriceAmount)
  const bestOfferStatus = text(row.bestOfferStatus, 32).toUpperCase()
  const shippingStatus = text(row.shippingStatus, 32).toUpperCase()
  const visibleShippingAmount = money(row.visibleShippingAmount)
  const realizedPriceStatus = text(row.realizedPriceStatus, 40).toUpperCase()
  const endedItemIdentityStatus = text(row.endedItemIdentityStatus, 40)
    .toUpperCase()
  const suppliedFieldProvenance = record(row.fieldProvenance ??
    row.soldFieldProvenance)
  const safeField = (name: string, fallbackStatus: string) => {
    const field = record(suppliedFieldProvenance[name])
    const status = text(field.status, 24).toUpperCase()
    const claimedSource = text(field.source, 80)
    const source = ["SOLD_SEARCH_ROW", "SOLD_SEARCH_FREE_SHIPPING_FILTER",
      "ENDED_ITEM_PUBLIC_DETAIL", "SOLD_ITEM_PUBLIC_DETAIL_SAME_ITEM_ID"]
      .includes(claimedSource) ? claimedSource : "SOLD_SEARCH_ROW"
    return Object.freeze({ source,
      status: (["CONFIRMED", "OBSERVED", "UNKNOWN", "AMBIGUOUS", "UNPROVEN"]
        .includes(status) ? status : fallbackStatus) as
        "CONFIRMED" | "OBSERVED" | "UNKNOWN" | "AMBIGUOUS" | "UNPROVEN",
      observedAt: text(field.observedAt, 80) || capturedAt.toISOString(),
      evidenceItemId: text(field.evidenceItemId, 30) === itemId ? itemId : itemId })
  }
  const profileIdentity = safeSellerProfileUrl(row.sellerProfileUrl)
  const claimedSellerProven = text(row.sellerIdentityStatus, 20)
    .toUpperCase() === "PROVEN"
  const sellerUsername = claimedSellerProven
    ? profileIdentity?.username ?? stableSellerUsername(row.sellerUsername)
    : null
  const sellerProfileUrl = profileIdentity?.profileUrl ?? (sellerUsername
    ? `https://www.ebay.com/usr/${encodeURIComponent(sellerUsername)}` : null)
  if (!/^\d{9,20}$/.test(itemId) || title.length < 3 || queryIdentity.length < 3 ||
    !Number.isFinite(soldAt.getTime()) || !Number.isFinite(capturedAt.getTime()) ||
    soldAt.getTime() > now.getTime() + 86_400_000 ||
    capturedAt.getTime() > now.getTime() + 300_000 ||
    capturedAt.getTime() < now.getTime() - 15 * 60_000 ||
    displayedSoldPriceAmount === null ||
    !["EXPLICIT_PRESENT", "EXPLICIT_ABSENT", "UNKNOWN"].includes(bestOfferStatus) ||
    !["OBSERVED", "UNAVAILABLE", "AMBIGUOUS"].includes(shippingStatus) ||
    (shippingStatus === "OBSERVED" && visibleShippingAmount === null)) return null
  const shippingEvidence = text(row.shippingEvidence, 60).toUpperCase()
  const searchBranch = text(row.searchBranch, 32).toUpperCase()
  const shippingSearchBranch = text(row.shippingSearchBranch, 32).toUpperCase()
  const navigationEvidence = safeFreeShippingNavigationEvidence(
    row.shippingNavigationEvidence ?? row.navigationEvidence, queryIdentity)
  const filterZeroProven = visibleShippingAmount === 0 &&
    shippingEvidence === "PROVEN_ZERO_BY_SEARCH_FILTER" &&
    [searchBranch, shippingSearchBranch].includes("FREE_SHIPPING_ONLY") &&
    row.freeShippingFilterProven === true &&
    navigationEvidence !== null &&
    safeField("shipping", "UNKNOWN").source ===
      "SOLD_SEARCH_FREE_SHIPPING_FILTER"
  if (shippingEvidence === "PROVEN_ZERO_BY_SEARCH_FILTER" &&
      !filterZeroProven) return null
  const ageMs = now.getTime() - soldAt.getTime()
  if (ageMs < -86_400_000 || ageMs > MAX_EVIDENCE_AGE_MS) return {
    itemId,
    stale: true as const,
  }
  return {
    itemId,
    stale: false as const,
    title,
    soldAt: soldAt.toISOString(),
    capturedAt: capturedAt.toISOString(),
    queryIdentity,
    displayedSoldPriceAmount,
    bestOfferStatus: bestOfferStatus as
      "EXPLICIT_PRESENT" | "EXPLICIT_ABSENT" | "UNKNOWN",
    shippingStatus: shippingStatus as "OBSERVED" | "UNAVAILABLE" | "AMBIGUOUS",
    visibleShippingAmount: shippingStatus === "OBSERVED" ? visibleShippingAmount : null,
    realizedPriceStatus: bestOfferStatus !== "EXPLICIT_PRESENT" &&
        endedItemIdentityStatus === "PROVEN_SAME_ENDED_ITEM" &&
        ["REALIZED_PRICE_CONFIRMED", "PROVEN"].includes(realizedPriceStatus) &&
        safeField("realizedPrice", "UNPROVEN").source ===
          "ENDED_ITEM_PUBLIC_DETAIL" &&
        safeField("realizedPrice", "UNPROVEN").status === "CONFIRMED"
      ? "REALIZED_PRICE_CONFIRMED" as const : "UNPROVEN" as const,
    endedItemIdentityStatus: endedItemIdentityStatus === "PROVEN_SAME_ENDED_ITEM"
      ? "PROVEN_SAME_ENDED_ITEM" as const : "NOT_PROVEN" as const,
    sellerUsername,
    sellerProfileUrl,
    stableSellerIdentity: sellerUsername
      ? `SELLER:${sellerUsername.toLocaleLowerCase("en-US")}` : null,
    sellerIdentityStatus: sellerUsername ? "PROVEN" as const : "UNKNOWN" as const,
    sellerIdentitySource: sellerUsername
      ? text(row.sellerIdentitySource, 48) ||
        (profileIdentity ? "SELLER_PROFILE_URL" : "SELLER_USERNAME")
      : "NONE",
    sellerIdentityKey: sellerUsername
      ? `SELLER:${sellerUsername.toLocaleLowerCase("en-US")}`
      : "SELLER_IDENTITY_UNKNOWN",
    shippingEvidence: filterZeroProven
      ? "PROVEN_ZERO_BY_SEARCH_FILTER" as const
      : ["PROVEN_ZERO_BY_RESULT_TEXT", "PROVEN_AMOUNT_BY_RESULT_TEXT"]
          .includes(shippingEvidence)
        ? shippingEvidence as "PROVEN_ZERO_BY_RESULT_TEXT" |
          "PROVEN_AMOUNT_BY_RESULT_TEXT"
        : shippingStatus === "AMBIGUOUS" ? "AMBIGUOUS" as const
          : "UNKNOWN" as const,
    displayedDeliveredPrice: shippingStatus === "OBSERVED" &&
        visibleShippingAmount !== null
      ? Math.round((displayedSoldPriceAmount + visibleShippingAmount) * 100) / 100
      : null,
    searchBranch: searchBranch === "FREE_SHIPPING_ONLY"
      ? "FREE_SHIPPING_ONLY" as const : "ALL_SOLD" as const,
    shippingSearchBranch: shippingSearchBranch === "FREE_SHIPPING_ONLY"
      ? "FREE_SHIPPING_ONLY" as const : null,
    shippingNavigationEvidence: navigationEvidence,
    freeShippingFilterProven: filterZeroProven,
    soldFieldProvenance: Object.freeze({
      sellerIdentity: safeField("sellerIdentity", sellerUsername
        ? "CONFIRMED" : "UNKNOWN"),
      shipping: safeField("shipping", shippingStatus === "OBSERVED"
        ? "OBSERVED" : shippingStatus === "AMBIGUOUS" ? "AMBIGUOUS" : "UNKNOWN"),
      displayedPrice: safeField("displayedPrice", "CONFIRMED"),
      bestOffer: safeField("bestOffer", bestOfferStatus === "UNKNOWN"
        ? "UNKNOWN" : "CONFIRMED"),
      realizedPrice: safeField("realizedPrice",
        ["REALIZED_PRICE_CONFIRMED", "PROVEN"].includes(realizedPriceStatus)
          ? "CONFIRMED" : "UNPROVEN"),
    }),
    ageDays: Math.max(0, ageMs / 86_400_000),
  }
}

/**
 * Trace-only adapter for public eBay Sold rows captured by the bounded browser
 * worker. Unlike the canonical import, this does not pretend that a generic
 * listing has GTIN/MPN identity. The commercial classifier must still prove a
 * near-exact or functional match before the row can influence pricing.
 */
export function adaptMainSearchSoldCaptureForCommercialTrace(input: {
  rows: readonly unknown[]
  requestedQueries: readonly string[]
  now?: Date
}) {
  if (!Array.isArray(input.rows) || input.rows.length > MAX_ROWS) {
    throw new Error("COMMERCIAL_TRACE_SOLD_CAPTURE_ROW_BOUND_INVALID")
  }
  const now = input.now ?? new Date()
  const allowedQueries = new Set(input.requestedQueries.map((value) =>
    text(value, 100).toLocaleLowerCase("en-US")).filter((value) =>
    value.length >= 3))
  if (!allowedQueries.size || allowedQueries.size > 6) {
    throw new Error("COMMERCIAL_TRACE_SOLD_QUERY_BOUND_INVALID")
  }
  const malformed: string[] = []
  const fresh = input.rows.flatMap((row, index) => {
    const safe = safeCapturedRow(row, now)
    if (!safe || safe.stale) {
      malformed.push(`ROW_${index + 1}_INVALID_OR_STALE`)
      return []
    }
    if (!allowedQueries.has(safe.queryIdentity.toLocaleLowerCase("en-US"))) {
      malformed.push(`ROW_${index + 1}_QUERY_MISMATCH`)
      return []
    }
    return [Object.freeze({
      itemId: safe.itemId,
      title: safe.title,
      soldAt: safe.soldAt,
      capturedAt: safe.capturedAt,
      queryIdentity: safe.queryIdentity,
      displayedSoldPriceAmount: safe.displayedSoldPriceAmount,
      displayedSoldPriceCurrency: "USD" as const,
      visibleShippingAmount: safe.visibleShippingAmount,
      sellerUsername: safe.sellerUsername,
      sellerProfileUrl: safe.sellerProfileUrl,
      stableSellerIdentity: safe.stableSellerIdentity,
      sellerIdentityStatus: safe.sellerIdentityStatus,
      sellerIdentitySource: safe.sellerIdentitySource,
      sellerIdentityKey: safe.sellerIdentityKey,
      shippingStatus: safe.shippingStatus,
      shippingEvidence: safe.shippingEvidence,
      displayedDeliveredPrice: safe.displayedDeliveredPrice,
      searchBranch: safe.searchBranch,
      freeShippingFilterProven: safe.freeShippingFilterProven,
      bestOfferStatus: safe.bestOfferStatus,
      confirmedSoldQuantity: 1 as const,
      estimatedSoldQuantity: 0 as const,
      soldConfirmationStatus: "SOLD_CONFIRMED" as const,
      displayedPriceStatus: "DISPLAYED_PRICE_CONFIRMED" as const,
      realizedPriceStatus: safe.realizedPriceStatus,
      provenance: "EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE" as const,
      pricingEligibility: safe.bestOfferStatus === "EXPLICIT_PRESENT" ||
          safe.realizedPriceStatus !== "REALIZED_PRICE_CONFIRMED"
        ? "DISPLAYED_PRICE_NOT_REALIZED" as const
        : "SUBJECT_TO_COMMERCIAL_IDENTITY_VALIDATION" as const,
      soldFieldProvenance: safe.soldFieldProvenance,
      endedItemIdentityStatus: safe.endedItemIdentityStatus,
    })]
  })
  const unique = new Map<string, (typeof fresh)[number]>()
  for (const row of fresh) {
    const current = unique.get(row.itemId)
    if (!current || Date.parse(row.soldAt) > Date.parse(current.soldAt)) {
      unique.set(row.itemId, row)
    }
  }
  return Object.freeze({
    version: EBAY_COMMERCIAL_TRACE_SOLD_CAPTURE_ADAPTER_VERSION,
    rows: Object.freeze([...unique.values()]),
    requestedQueryCount: allowedQueries.size,
    observedRowCount: input.rows.length,
    acceptedRowCount: unique.size,
    rejectedRowCount: malformed.length,
    rejectionReasons: Object.freeze(malformed),
    soldFilterRequired: true as const,
    marketplaceWrites: 0 as const,
  })
}

export async function adaptMainSearchSoldCaptureForCanonicalImport(input: {
  rows: readonly unknown[]
  now?: Date
  officialItemReader?: OfficialItemReader
}) {
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > MAX_ROWS) {
    throw new Error("MAIN_SEARCH_SOLD_CAPTURE_ROW_BOUND_INVALID")
  }
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new Error("MAIN_SEARCH_SOLD_CAPTURE_CLOCK_INVALID")
  const sanitized = input.rows.map((row) => safeCapturedRow(row, now))
  const malformedCount = sanitized.filter((row) => row === null).length
  const staleCount = sanitized.filter((row) => row?.stale === true).length
  const fresh = sanitized.filter((row): row is Exclude<ReturnType<typeof safeCapturedRow>, null> &
    { stale: false } => row !== null && row.stale === false)
  if (!fresh.length) throw new Error("MAIN_SEARCH_SOLD_CAPTURE_NO_FRESH_ROWS")

  const canonical = canonicalizeComparableEvidenceByItemIdV1(fresh.map((row) => ({
    ...row,
    queryProvenance: row.queryIdentity,
    soldQuantity: 1,
  })))

  const uniqueItemIds = canonical.map((row) => row.itemId)
  const reader = input.officialItemReader ?? (await import(
    // @ts-expect-error Node's native TypeScript runner requires explicit extensions.
    "./ebay-seller-keyword-demand-gateway.ts"
  )).getEbayListingIdentityByLegacyItemId
  const identityByItemId = new Map<string, EbaySellerComparableInput | null>()
  let cursor = 0
  const worker = async () => {
    while (cursor < uniqueItemIds.length) {
      const itemId = uniqueItemIds[cursor]
      cursor += 1
      try {
        const detail = await reader(itemId)
        identityByItemId.set(itemId, exactLegacyIdentity(detail, itemId) ? detail : null)
      } catch {
        identityByItemId.set(itemId, null)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, uniqueItemIds.length) },
    () => worker()))

  const rows = canonical.map((row) => {
    const detail = identityByItemId.get(row.itemId) ?? null
    const offerFacts = detectProductResearchOfferFacts(row.title)
    return {
      sourceListingId: row.itemId,
      observedAt: row.soldAt,
      soldAt: row.soldAt,
      capturedAt: row.capturedAt,
      queryOrResearchIdentity: row.queryIdentity,
      queryProvenances: row.queryProvenances,
      confirmedSoldQuantity: 1,
      explicitSaleConfirmed: true,
      listingStatus: "SOLD",
      title: row.title,
      manufacturerBrand: text(detail?.brand, 80) || null,
      gtin: text(detail?.gtin, 32) || null,
      mpn: text(detail?.mpn, 100) || null,
      model: text(detail?.model, 100) || null,
      packCount: positiveInteger(detail?.lotSize) ?? offerFacts.packCount,
      unitCount: offerFacts.unitCount,
      size: text(detail?.size, 80) || offerFacts.size,
      color: text(detail?.color, 80) || null,
      displayedSoldPriceAmount: row.displayedSoldPriceAmount,
      displayedSoldPriceCurrency: "USD",
      realizedTransactionPriceAmount: null,
      realizedTransactionPriceCurrency: null,
      realizedPriceStatus: "UNPROVEN",
      bestOfferStatus: row.bestOfferStatus,
      visibleShippingAmount: row.visibleShippingAmount,
      visibleShippingCurrency: row.visibleShippingAmount === null ? null : "USD",
      shippingStatus: row.shippingStatus,
      priceEvidenceProvenance: "MAIN_SEARCH_VISIBLE_SOLD_ROW",
    }
  })
  return Object.freeze({
    version: EBAY_MAIN_SEARCH_SOLD_CAPTURE_ADAPTER_VERSION,
    rows: Object.freeze(rows),
    sourceRowCount: input.rows.length,
    freshRowCount: canonical.length,
    canonicalUniqueItemCount: canonical.length,
    itemIdDuplicateCount: fresh.length - canonical.length,
    staleCount,
    malformedCount,
    browseItemLookupsAttempted: uniqueItemIds.length,
    browseItemLookupsSucceeded: uniqueItemIds.filter((itemId) =>
      identityByItemId.get(itemId) !== null &&
      identityByItemId.get(itemId) !== undefined).length,
    evidenceMaxAgeDays: Math.max(...fresh.map((row) => row.ageDays)),
    marketplaceWrites: 0 as const,
    secretsExposed: false as const,
  })
}
