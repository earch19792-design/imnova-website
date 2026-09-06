import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { EbayCommercialMonitorLiveReadonlyResult } from
  "./ebay-commercial-monitor-live-readonly"

export const SELLER_OS_CURRENT_LIVE_AUTHORITY_RECOVERY_V1 =
  "SELLER_OS_CURRENT_LIVE_AUTHORITY_RECOVERY_V1" as const
export const CURRENT_LIVE_SOURCE_AUTHORITY =
  "EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION" as const

const CURRENT_MAXIMUM_AGE_MS = 20 * 60 * 1_000
const ITEM_ID = /^\d{9,20}$/
const SAFE_CODE = /^[A-Z0-9_]{3,160}$/

export type CurrentLiveAuthorityStoredStateV1 = Readonly<{
  current_live_source_state: string | null
  current_live_last_attempt_at: string | null
  current_live_next_retry_at: string | null
  current_live_last_error_code: string | null
  last_certified_live_scope_id: string | null
  last_certified_live_item_ids: unknown
  last_certified_live_count: number | string | null
  last_certified_live_observed_at: string | null
  last_certified_live_fresh_until: string | null
  last_certified_live_source_authority: string | null
}>

export type CurrentLiveAuthorityProjectionV1 = Readonly<{
  contractVersion: typeof SELLER_OS_CURRENT_LIVE_AUTHORITY_RECOVERY_V1
  currentState: "CURRENT_FRESH" | "CURRENT_UNAVAILABLE"
  currentListingCount: number | null
  currentItemIds: readonly string[]
  currentObservedAt: string | null
  authoritativeZero: boolean
  lastCertifiedState: "LAST_CERTIFIED_AVAILABLE" |
    "LAST_CERTIFIED_STALE" | "NO_CERTIFIED_HISTORY"
  lastCertifiedListingCount: number | null
  lastCertifiedItemIds: readonly string[]
  lastCertifiedAt: string | null
  lastCertifiedFreshUntil: string | null
  scopeId: string | null
  sourceAuthority: typeof CURRENT_LIVE_SOURCE_AUTHORITY | null
  sourceFailureCode: string | null
  nextRetryAt: string | null
  ownerActionRequired: false
  marketplaceWrites: 0
}>

function iso(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString() : null
}

function integer(value: unknown) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function itemIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is string =>
    typeof entry === "string" && ITEM_ID.test(entry)))].sort()
}

function safeCode(value: unknown, fallback: string) {
  return typeof value === "string" && SAFE_CODE.test(value)
    ? value : fallback
}

export function currentLiveScopeIdV1(ids: readonly string[], accountKey: string) {
  const digest = createHash("sha256").update(JSON.stringify({
    accountKey, marketplaceId: "EBAY_US", itemIds: [...ids].sort(),
  })).digest("hex")
  return `current-live:sha256:${digest}`
}

export function currentLiveItemIdsV1(
  live: EbayCommercialMonitorLiveReadonlyResult,
) {
  return [...new Set(live.discovery.currentLiveListings.flatMap((listing) =>
    listing.marketplaceCertification.status === "US_CERTIFIED" &&
      ITEM_ID.test(listing.itemId) ? [listing.itemId] : []))].sort()
}

export function officialCurrentLiveReadCertifiedV1(
  live: EbayCommercialMonitorLiveReadonlyResult,
) {
  const certification = live.discovery.marketplaceCertification
  return live.account.status === "CERTIFIED" &&
    live.account.bindingMatched === true &&
    live.discovery.status === "AVAILABLE" &&
    live.discovery.coverage === "COMPLETE" &&
    live.discovery.sellerWideEnumeration.itemSetComplete === true &&
    live.discovery.sellerWideEnumeration.identitySetComplete === true &&
    certification.sellerWideItemsParsed !== null &&
    certification.sellerWideItemsReported !== null &&
    certification.sellerWideItemsParsed ===
      certification.sellerWideItemsReported &&
    certification.sellerWideItemsMarketplaceUnresolved === 0 &&
    certification.sellerWideItemsMarketplaceError === 0 &&
    certification.sellerWideItemsMarketplaceItemIdMismatch === 0 &&
    certification.sellerWideItemsMarketplaceBudgetExhausted === 0 &&
    Boolean(iso(live.discovery.observedAt))
}

export function resolveCurrentLiveAuthorityV1(input: Readonly<{
  accountKey: string
  live?: EbayCommercialMonitorLiveReadonlyResult | null
  stored?: CurrentLiveAuthorityStoredStateV1 | null
  now?: Date
}>): CurrentLiveAuthorityProjectionV1 {
  const now = input.now ?? new Date()
  const liveObservedAt = iso(input.live?.discovery.observedAt)
  const liveFresh = Boolean(input.live && liveObservedAt &&
    officialCurrentLiveReadCertifiedV1(input.live) &&
    now.getTime() >= Date.parse(liveObservedAt) &&
    now.getTime() - Date.parse(liveObservedAt) <= CURRENT_MAXIMUM_AGE_MS)
  if (input.live && liveFresh && liveObservedAt) {
    const ids = currentLiveItemIdsV1(input.live)
    return Object.freeze({
      contractVersion: SELLER_OS_CURRENT_LIVE_AUTHORITY_RECOVERY_V1,
      currentState: "CURRENT_FRESH" as const,
      currentListingCount: ids.length,
      currentItemIds: Object.freeze(ids),
      currentObservedAt: liveObservedAt,
      authoritativeZero: ids.length === 0,
      lastCertifiedState: "LAST_CERTIFIED_AVAILABLE" as const,
      lastCertifiedListingCount: ids.length,
      lastCertifiedItemIds: Object.freeze(ids),
      lastCertifiedAt: liveObservedAt,
      lastCertifiedFreshUntil: new Date(Date.parse(liveObservedAt) +
        CURRENT_MAXIMUM_AGE_MS).toISOString(),
      scopeId: currentLiveScopeIdV1(ids, input.accountKey),
      sourceAuthority: CURRENT_LIVE_SOURCE_AUTHORITY,
      sourceFailureCode: null,
      nextRetryAt: null,
      ownerActionRequired: false as const,
      marketplaceWrites: 0 as const,
    })
  }

  const storedIds = itemIds(input.stored?.last_certified_live_item_ids)
  const storedCount = integer(input.stored?.last_certified_live_count)
  const certifiedAt = iso(input.stored?.last_certified_live_observed_at)
  const freshUntil = iso(input.stored?.last_certified_live_fresh_until)
  const validHistory = Boolean(certifiedAt && freshUntil && storedCount !== null &&
    storedIds.length === storedCount &&
    input.stored?.last_certified_live_source_authority ===
      CURRENT_LIVE_SOURCE_AUTHORITY &&
    typeof input.stored?.last_certified_live_scope_id === "string" &&
    /^current-live:sha256:[0-9a-f]{64}$/.test(
      input.stored.last_certified_live_scope_id))
  const historyFresh = validHistory && now.getTime() <= Date.parse(freshUntil!)
  if (!input.live && input.stored?.current_live_source_state ===
      "CURRENT_FRESH" && historyFresh) {
    return Object.freeze({
      contractVersion: SELLER_OS_CURRENT_LIVE_AUTHORITY_RECOVERY_V1,
      currentState: "CURRENT_FRESH" as const,
      currentListingCount: storedCount,
      currentItemIds: Object.freeze(storedIds),
      currentObservedAt: certifiedAt,
      authoritativeZero: storedCount === 0,
      lastCertifiedState: "LAST_CERTIFIED_AVAILABLE" as const,
      lastCertifiedListingCount: storedCount,
      lastCertifiedItemIds: Object.freeze(storedIds),
      lastCertifiedAt: certifiedAt,
      lastCertifiedFreshUntil: freshUntil,
      scopeId: input.stored.last_certified_live_scope_id,
      sourceAuthority: CURRENT_LIVE_SOURCE_AUTHORITY,
      sourceFailureCode: null,
      nextRetryAt: null,
      ownerActionRequired: false as const,
      marketplaceWrites: 0 as const,
    })
  }
  const liveFailure = input.live?.discovery.gapCodes.find((code) =>
    SAFE_CODE.test(code)) ?? input.stored?.current_live_last_error_code
  return Object.freeze({
    contractVersion: SELLER_OS_CURRENT_LIVE_AUTHORITY_RECOVERY_V1,
    currentState: "CURRENT_UNAVAILABLE" as const,
    currentListingCount: null,
    currentItemIds: Object.freeze([] as string[]),
    currentObservedAt: null,
    authoritativeZero: false,
    lastCertifiedState: validHistory
      ? historyFresh ? "LAST_CERTIFIED_AVAILABLE" as const
        : "LAST_CERTIFIED_STALE" as const
      : "NO_CERTIFIED_HISTORY" as const,
    lastCertifiedListingCount: validHistory ? storedCount : null,
    lastCertifiedItemIds: Object.freeze(validHistory ? storedIds : []),
    lastCertifiedAt: validHistory ? certifiedAt : null,
    lastCertifiedFreshUntil: validHistory ? freshUntil : null,
    scopeId: validHistory ? input.stored!.last_certified_live_scope_id : null,
    sourceAuthority: validHistory ? CURRENT_LIVE_SOURCE_AUTHORITY : null,
    sourceFailureCode: safeCode(liveFailure,
      "CURRENT_LIVE_OFFICIAL_SOURCE_UNAVAILABLE"),
    nextRetryAt: iso(input.stored?.current_live_next_retry_at),
    ownerActionRequired: false as const,
    marketplaceWrites: 0 as const,
  })
}

export async function readCurrentLiveAuthorityV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  live?: EbayCommercialMonitorLiveReadonlyResult | null
  now?: Date
}>) {
  const read = await input.supabase.from("ebay_active_listing_sync_state")
    .select("current_live_source_state,current_live_last_attempt_at,current_live_next_retry_at,current_live_last_error_code,last_certified_live_scope_id,last_certified_live_item_ids,last_certified_live_count,last_certified_live_observed_at,last_certified_live_fresh_until,last_certified_live_source_authority")
    .eq("account_key", input.accountKey).limit(1).maybeSingle()
  if (read.error) throw new Error("CURRENT_LIVE_AUTHORITY_STATE_READ_FAILED")
  return resolveCurrentLiveAuthorityV1({ accountKey: input.accountKey,
    live: input.live, stored: read.data as CurrentLiveAuthorityStoredStateV1 |
      null, now: input.now })
}
