// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { detectProductResearchOfferFacts } from "./ebay-product-research-browser-capture.ts"
import type { EbaySellerComparableInput } from "./ebay-seller-keyword-demand-validation"

export const EBAY_MAIN_SEARCH_SOLD_CAPTURE_ADAPTER_VERSION =
  "EBAY_MAIN_SEARCH_SOLD_CAPTURE_ADAPTER_V1_2026_08_26"

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
  if (!/^\d{9,20}$/.test(itemId) || title.length < 3 || queryIdentity.length < 3 ||
    !Number.isFinite(soldAt.getTime()) || !Number.isFinite(capturedAt.getTime()) ||
    soldAt.getTime() > now.getTime() + 86_400_000 ||
    capturedAt.getTime() > now.getTime() + 300_000 ||
    capturedAt.getTime() < now.getTime() - 15 * 60_000 ||
    displayedSoldPriceAmount === null ||
    !["EXPLICIT_PRESENT", "EXPLICIT_ABSENT", "UNKNOWN"].includes(bestOfferStatus) ||
    !["OBSERVED", "UNAVAILABLE", "AMBIGUOUS"].includes(shippingStatus) ||
    (shippingStatus === "OBSERVED" && visibleShippingAmount === null)) return null
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
    ageDays: Math.max(0, ageMs / 86_400_000),
  }
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

  const uniqueItemIds = [...new Set(fresh.map((row) => row.itemId))]
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

  const rows = fresh.map((row) => {
    const detail = identityByItemId.get(row.itemId) ?? null
    const offerFacts = detectProductResearchOfferFacts(row.title)
    return {
      sourceListingId: row.itemId,
      observedAt: row.soldAt,
      soldAt: row.soldAt,
      capturedAt: row.capturedAt,
      queryOrResearchIdentity: row.queryIdentity,
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
    freshRowCount: fresh.length,
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
