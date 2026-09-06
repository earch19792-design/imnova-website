import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getEbayCommercialMonitorLiveReadonly,
  type EbayCommercialMonitorLiveReadonlyResult } from
  "./ebay-commercial-monitor-live-readonly"
import { currentLiveItemIdsV1, currentLiveScopeIdV1,
  officialCurrentLiveReadCertifiedV1, readCurrentLiveAuthorityV1 } from
  "./ebay-current-live-authority-v1"

const CURRENT_MAXIMUM_AGE_MS = 20 * 60 * 1_000
const RETRY_DELAY_MS = 15 * 60 * 1_000
const ITEM_ID = /^\d{9,20}$/
const SAFE_CODE = /^[A-Z0-9_]{3,160}$/

function safeCode(value: unknown, fallback: string) {
  return typeof value === "string" && SAFE_CODE.test(value)
    ? value : fallback
}

function rowsForPersistence(live: EbayCommercialMonitorLiveReadonlyResult) {
  const byItem = new Map<string, Record<string, unknown>>()
  for (const listing of live.discovery.currentLiveListings) {
    if (listing.marketplaceCertification.status !== "US_CERTIFIED" ||
        !ITEM_ID.test(listing.itemId) || byItem.has(listing.itemId) ||
        !listing.title?.trim() || !/^[A-Z]{3}$/.test(listing.currency ?? "")) {
      continue
    }
    byItem.set(listing.itemId, {
      itemId: listing.itemId, title: listing.title.trim(),
      sku: listing.sku, quantity: listing.availableQuantity,
      price: listing.price, currency: listing.currency,
      variationKey: listing.variationKey,
      primaryImageUrl: listing.primaryImageUrl,
      observedAt: new Date(live.discovery.observedAt!).toISOString(),
    })
  }
  return [...byItem.values()].sort((left, right) =>
    String(left.itemId).localeCompare(String(right.itemId)))
}

export async function runCurrentLiveAuthorityRecoveryV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  accountAlias: string | null
  now?: Date
  readOfficial?: typeof getEbayCommercialMonitorLiveReadonly
}>) {
  const now = input.now ?? new Date()
  const stored = await readCurrentLiveAuthorityV1({ supabase: input.supabase,
    accountKey: input.accountKey, now })
  if (stored.currentState === "CURRENT_FRESH") return Object.freeze({
    status: "CURRENT_FRESH_REUSED" as const, authority: stored,
    officialReadAttempted: false, databaseWrites: 0,
    marketplaceWrites: 0 as const,
  })
  if (stored.nextRetryAt && Date.parse(stored.nextRetryAt) > now.getTime()) {
    return Object.freeze({ status: "WAITING_FOR_RETRY" as const,
      authority: stored, officialReadAttempted: false, databaseWrites: 0,
      marketplaceWrites: 0 as const })
  }

  const runId = randomUUID()
  const claim = await input.supabase.rpc("claim_ebay_active_listing_sync_run", {
    p_account_key: input.accountKey, p_run_id: runId, p_lease_seconds: 180,
  })
  const claimed = Array.isArray(claim.data) ? claim.data[0] : claim.data
  if (claim.error || !claimed) throw new Error(
    "CURRENT_LIVE_AUTHORITY_RECOVERY_CLAIM_FAILED")
  if (claimed.claimed !== true) return Object.freeze({
    status: "SINGLE_FLIGHT_ALREADY_RUNNING" as const, authority: stored,
    officialReadAttempted: false, databaseWrites: 0,
    marketplaceWrites: 0 as const,
  })

  const finish = async (success: boolean, errorCode: string | null) => {
    const result = await input.supabase.rpc(
      "finish_ebay_active_listing_sync_run", {
        p_account_key: input.accountKey, p_run_id: runId,
        p_success: success, p_error_code: errorCode,
      })
    if (result.error) throw new Error(
      "CURRENT_LIVE_AUTHORITY_RECOVERY_FINISH_FAILED")
  }
  try {
    const live = await (input.readOfficial ??
      getEbayCommercialMonitorLiveReadonly)({ accountKey: input.accountKey,
        accountAlias: input.accountAlias })
    if (!officialCurrentLiveReadCertifiedV1(live)) {
      const errorCode = safeCode(live.discovery.gapCodes[0],
        "CURRENT_LIVE_OFFICIAL_SOURCE_UNAVAILABLE")
      const nextRetryAt = new Date(now.getTime() + RETRY_DELAY_MS).toISOString()
      const failed = await input.supabase.rpc(
        "record_ebay_current_live_authority_failure_v1", {
          p_account_key: input.accountKey, p_run_id: runId,
          p_error_code: errorCode, p_next_retry_at: nextRetryAt,
        })
      if (failed.error) throw new Error(
        "CURRENT_LIVE_AUTHORITY_FAILURE_RECEIPT_FAILED")
      await finish(false, errorCode)
      const authority = await readCurrentLiveAuthorityV1({
        supabase: input.supabase, accountKey: input.accountKey, live, now })
      return Object.freeze({ status: "CURRENT_UNAVAILABLE" as const,
        authority, officialReadAttempted: true, databaseWrites: 1,
        marketplaceWrites: 0 as const })
    }
    const rows = rowsForPersistence(live)
    const ids = currentLiveItemIdsV1(live)
    if (rows.length !== ids.length) throw new Error(
      "CURRENT_LIVE_AUTHORITY_CERTIFIED_ROWS_INCOMPLETE")
    const observedAt = new Date(live.discovery.observedAt!).toISOString()
    const id = currentLiveScopeIdV1(ids, input.accountKey)
    const persisted = await input.supabase.rpc(
      "record_ebay_current_live_authority_success_v1", {
        p_account_key: input.accountKey, p_run_id: runId, p_scope_id: id,
        p_observed_at: observedAt,
        p_fresh_until: new Date(Date.parse(observedAt) +
          CURRENT_MAXIMUM_AGE_MS).toISOString(),
        p_item_ids: ids, p_rows: rows,
      })
    if (persisted.error) throw new Error(
      "CURRENT_LIVE_AUTHORITY_SUCCESS_RECEIPT_FAILED")
    await finish(true, null)
    const authority = await readCurrentLiveAuthorityV1({
      supabase: input.supabase, accountKey: input.accountKey, live, now })
    return Object.freeze({ status: "RECOVERED_CURRENT_FRESH" as const,
      authority, officialReadAttempted: true, databaseWrites: 1,
      marketplaceWrites: 0 as const })
  } catch (error) {
    const code = safeCode(error instanceof Error ? error.message : null,
      "CURRENT_LIVE_AUTHORITY_RECOVERY_FAILED")
    try { await finish(false, code) } catch { /* preserve primary failure */ }
    throw error
  }
}
