import { createHash } from "node:crypto"

import type { LunaShippingQuoteV1 } from
  "./ebay-luna-authoritative-shipping-v1"

export const LIVE_LISTING_SHIPPING_EVIDENCE_VERSION =
  "LIVE_LISTING_LUNA_SHIPPING_EVIDENCE_V1" as const
export const LIVE_LISTING_SHIPPING_MAXIMUM_AGE_SECONDS = 6 * 60 * 60

const ITEM_ID = /^\d{9,20}$/
const PRODUCT_ID = /^\d{8,24}$/
const VARIANT_ID = /^\d{8,24}$/
const SKU = /^[A-Za-z0-9][A-Za-z0-9._:+/ -]{0,159}$/
const LINKAGE_ID = /^luna-linkage-v1:sha256:[0-9a-f]{64}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/

export type LiveListingShippingEvidenceIdentityV1 = Readonly<{
  accountKey: string
  marketplaceId: "EBAY_US"
  ebayItemId: string
  linkageId: string
  lunaProductId: string
  lunaVariantId: string
  sourceSku: string
}>

export type LiveListingShippingEvidenceRowV1 = Readonly<{
  evidence_id: string
  account_key: string
  marketplace_id: "EBAY_US"
  ebay_item_id: string
  linkage_id: string
  luna_product_id: string
  luna_variant_id: string
  source_sku: string
  destination_fingerprint: string
  supplier_subtotal: number
  supplier_currency: "USD"
  shipping_cost: number
  shipping_currency: "USD"
  observed_at: string
  maximum_age_seconds: number
  source_authority: LunaShippingQuoteV1["acquisitionMethod"]
  source_evidence_digest: string
  purchase_performed: false
  payment_performed: false
  raw_address_persisted: false
  credentials_persisted: false
}>

function money(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("LIVE_LISTING_SHIPPING_MONEY_INVALID")
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100
}

function exactIdentity(value: LiveListingShippingEvidenceIdentityV1) {
  if (!value.accountKey || value.accountKey.length > 240 ||
      value.marketplaceId !== "EBAY_US" || !ITEM_ID.test(value.ebayItemId) ||
      !LINKAGE_ID.test(value.linkageId) ||
      !PRODUCT_ID.test(value.lunaProductId) ||
      !VARIANT_ID.test(value.lunaVariantId) || !SKU.test(value.sourceSku)) {
    throw new Error("LIVE_LISTING_SHIPPING_IDENTITY_INVALID")
  }
  return value
}

function taggedHash(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value))
    .digest("hex")}`
}

export function liveListingShippingReaderScopeIdV1(
  identity: LiveListingShippingEvidenceIdentityV1,
) {
  exactIdentity(identity)
  return `live-listing-shipping-reader-v1:${taggedHash({
    contract: LIVE_LISTING_SHIPPING_EVIDENCE_VERSION,
    accountKey: identity.accountKey,
    marketplaceId: identity.marketplaceId,
    ebayItemId: identity.ebayItemId,
    linkageId: identity.linkageId,
    lunaProductId: identity.lunaProductId,
    lunaVariantId: identity.lunaVariantId,
    sourceSku: identity.sourceSku,
  })}`
}

export function buildLiveListingShippingEvidenceV1(input: Readonly<{
  identity: LiveListingShippingEvidenceIdentityV1
  quote: LunaShippingQuoteV1
}>) : LiveListingShippingEvidenceRowV1 {
  const identity = exactIdentity(input.identity)
  const quote = input.quote
  if (quote.status !== "AVAILABLE" || quote.currency !== "USD" ||
      !quote.exactLunaIdentity || !quote.noPurchase || !quote.noPayment ||
      !DIGEST.test(quote.evidenceDigest) ||
      !DIGEST.test(quote.destinationProfileDigest) ||
      !Number.isFinite(Date.parse(quote.observedAt))) {
    throw new Error("LIVE_LISTING_SHIPPING_QUOTE_INVALID")
  }
  const evidenceId = `live-listing-luna-shipping-v1:${taggedHash({
    identity, evidenceDigest: quote.evidenceDigest,
  })}`
  return Object.freeze({
    evidence_id: evidenceId,
    account_key: identity.accountKey,
    marketplace_id: identity.marketplaceId,
    ebay_item_id: identity.ebayItemId,
    linkage_id: identity.linkageId,
    luna_product_id: identity.lunaProductId,
    luna_variant_id: identity.lunaVariantId,
    source_sku: identity.sourceSku,
    destination_fingerprint: quote.destinationProfileDigest,
    supplier_subtotal: money(quote.subtotalUsd),
    supplier_currency: "USD" as const,
    shipping_cost: money(quote.shippingAmountUsd),
    shipping_currency: "USD" as const,
    observed_at: new Date(quote.observedAt).toISOString(),
    maximum_age_seconds: LIVE_LISTING_SHIPPING_MAXIMUM_AGE_SECONDS,
    source_authority: quote.acquisitionMethod,
    source_evidence_digest: quote.evidenceDigest,
    purchase_performed: false as const,
    payment_performed: false as const,
    raw_address_persisted: false as const,
    credentials_persisted: false as const,
  })
}

export function readLiveListingShippingFreshnessV1(input: Readonly<{
  row: Pick<LiveListingShippingEvidenceRowV1,
    "observed_at" | "maximum_age_seconds">
  now?: number
}>) {
  const observedAt = Date.parse(input.row.observed_at)
  const maximumAgeSeconds = Number(input.row.maximum_age_seconds)
  if (!Number.isFinite(observedAt) ||
      maximumAgeSeconds !== LIVE_LISTING_SHIPPING_MAXIMUM_AGE_SECONDS) {
    return Object.freeze({ status: "UNPROVEN" as const, ageSeconds: null })
  }
  const ageSeconds = Math.max(0, Math.floor(
    ((input.now ?? Date.now()) - observedAt) / 1_000,
  ))
  return Object.freeze({
    status: ageSeconds <= maximumAgeSeconds
      ? "FRESH" as const : "STALE" as const,
    ageSeconds,
  })
}

export function liveListingShippingReadbackMatchesV1(
  expected: LiveListingShippingEvidenceRowV1,
  observed: unknown,
) {
  if (!observed || typeof observed !== "object" || Array.isArray(observed)) {
    return false
  }
  const row = observed as Record<string, unknown>
  return Object.entries(expected).every(([key, value]) =>
    typeof value === "number"
      ? Number(row[key]) === value
      : row[key] === value)
}
