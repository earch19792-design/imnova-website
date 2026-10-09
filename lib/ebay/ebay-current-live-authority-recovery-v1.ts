import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getEbayCommercialMonitorLiveReadonly,
  getEbayOfficialLiveListingSweepReadonly,
  unavailableResult,
  type EbayCommercialMonitorLiveReadonlyResult } from
  "./ebay-commercial-monitor-live-readonly"
import { currentLiveItemIdsV1, currentLiveScopeIdV1,
  officialCurrentLiveReadCertifiedV1, readCurrentLiveAuthorityV1 } from
  "./ebay-current-live-authority-v1"
import { availableEbayLiveCoverageTradingV1,
  classifyEbayLiveCoverageFailureV1 } from
  "./ebay-live-coverage-failure-v1"
import { collectSellerOsEbayTradingRateLimitStatusV1,
  type SellerOsEbayTradingRateLimitStatusV1 } from
  "./ebay-trading-rate-limit-observability-v1"

const CURRENT_MAXIMUM_AGE_MS = 20 * 60 * 1_000
const RETRY_DELAY_MS = 15 * 60 * 1_000
const RETRY_MAXIMUM_DELAY_MS = (23 * 60 + 55) * 60 * 1_000
const TRADING_RESET_SAFETY_MS = 60 * 1_000
const ITEM_ID = /^\d{9,20}$/
const SAFE_CODE = /^[A-Z0-9_]{3,160}$/
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/
const TRADING_QUOTA_518 =
  /^EBAY_MONITOR_(?:ACCOUNT_IDENTITY|SELLER_DISCOVERY|SELLER_LIST)_TRADING_ERROR_518$/

type TradingQuotaAuthorityV1 = Pick<
  SellerOsEbayTradingRateLimitStatusV1,
  "gateState" | "ebay518BucketIdentity" | "nextSafeTradingProbeAt"
>

type OfficialListingSweepV1 = Awaited<ReturnType<
  typeof getEbayOfficialLiveListingSweepReadonly>>

export function adaptOfficialListingSweepForCurrentLiveV1(
  sweep: OfficialListingSweepV1,
): EbayCommercialMonitorLiveReadonlyResult {
  const listingOnlyGap = "CURRENT_LIVE_LISTING_ONLY_SWEEP"
  const unavailable = unavailableResult({
    accountAlias: null,
    limitationCode: listingOnlyGap,
    bindingConfigured: true,
  })
  const reported = Number.isSafeInteger(sweep.totalEntries)
    ? Number(sweep.totalEntries) : null
  const parsed = sweep.listings.length
  const certifiedUs = sweep.listings.filter((listing) =>
    listing.marketplaceCertification.status === "US_CERTIFIED").length
  const certifiedNonUs = sweep.listings.filter((listing) =>
    listing.marketplaceCertification.status === "NON_US_CERTIFIED").length
  const unresolved = sweep.listings.filter((listing) =>
    listing.marketplaceCertification.status === "UNRESOLVED").length
  const errors = sweep.listings.filter((listing) =>
    listing.marketplaceCertification.status === "ERROR").length
  const budgetExhausted = sweep.listings.filter((listing) =>
    listing.marketplaceCertification.status === "BUDGET_EXHAUSTED").length
  const complete = sweep.status === "CERTIFIED_COMPLETE" &&
    sweep.paginationComplete === true && reported !== null &&
    parsed === reported && sweep.gapCodes.length === 0
  return {
    ...unavailable,
    account: {
      ...unavailable.account,
      status: sweep.accountCertified ? "CERTIFIED" : "BLOCKED",
      bindingMatched: sweep.accountCertified,
      observedAt: sweep.observedAt,
      source: "EBAY_TRADING_GET_USER",
      limitationCode: sweep.accountCertified ? null : sweep.errorCode,
    },
    oauth: {
      ...unavailable.oauth,
      status: sweep.oauthReached ? "PARTIAL" : "UNAVAILABLE",
      tokenReceived: sweep.oauthReached,
    },
    discovery: {
      ...unavailable.discovery,
      status: complete ? "AVAILABLE" : "UNAVAILABLE",
      coverage: complete ? "COMPLETE" : "UNPROVEN",
      observedAt: sweep.observedAt,
      trading: complete
        ? availableEbayLiveCoverageTradingV1({
            calls: sweep.calls,
            observedAt: sweep.observedAt,
          })
        : classifyEbayLiveCoverageFailureV1({
            detailCode: sweep.errorCode ??
              sweep.gapCodes[0] ?? "CURRENT_LIVE_OFFICIAL_SOURCE_UNAVAILABLE",
            calls: sweep.calls,
          }),
      gapCodes: sweep.gapCodes.length ? sweep.gapCodes :
        sweep.errorCode ? [sweep.errorCode] : [],
      currentLiveListings: sweep.listings,
      listings: sweep.listings,
      pagesRead: sweep.pagesRead,
      totalPages: sweep.totalPages,
      totalEntries: reported,
      sellerWideEnumeration: {
        identities: sweep.listings.map((listing) => ({
          itemId: listing.itemId,
          sku: listing.sku,
          variationKey: listing.variationKey,
          identityAmbiguous: listing.identityAmbiguous,
          representationEligible: false as const,
          analyticsEligible: false as const,
        })),
        itemSetComplete: complete,
        identitySetComplete: complete && sweep.listings.every((listing) =>
          listing.identityAmbiguous !== true),
      },
      marketplaceCertification: {
        sellerWideItemsParsed: parsed,
        sellerWideItemsReported: reported,
        sellerWideItemsMarketplaceCertifiedUs: certifiedUs,
        sellerWideItemsMarketplaceCertifiedNonUs: certifiedNonUs,
        sellerWideItemsMarketplaceUnresolved: unresolved,
        sellerWideItemsMarketplaceError: errors,
        sellerWideItemsMarketplaceItemIdMismatch: 0,
        sellerWideItemsMarketplaceBudgetExhausted: budgetExhausted,
        sellerWideItemsRepresented: parsed,
      },
      inventory: {
        ...unavailable.discovery.inventory,
        gapCodes: [listingOnlyGap],
      },
      inventoryRepresentation: {
        ...unavailable.discovery.inventoryRepresentation,
        identityUnresolvedCount: sweep.listings.filter((listing) =>
          listing.identityAmbiguous === true).length,
        sourceUnprovenCount: parsed,
      },
    },
    analytics: {
      ...unavailable.analytics,
      analyticsRequestedItemCount: 0,
      gapCodes: [listingOnlyGap, "NO_EVIDENCE_DOES_NOT_PROVE_ZERO"],
    },
    orders: {
      ...unavailable.orders,
      gapCodes: [listingOnlyGap, "NO_EVIDENCE_DOES_NOT_PROVE_ZERO"],
    },
    calls: sweep.calls,
  }
}

function safeCode(value: unknown, fallback: string) {
  return typeof value === "string" && SAFE_CODE.test(value)
    ? value : fallback
}

function isTradingQuota518(value: unknown): value is string {
  return typeof value === "string" && TRADING_QUOTA_518.test(value)
}

async function persistOfficialReadFailureReceiptV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  runId: string
  errorCode: string
  live: EbayCommercialMonitorLiveReadonlyResult | null
  quota: TradingQuotaAuthorityV1 | null
}>) {
  const call = [...(input.live?.calls ?? [])].reverse().find((entry) =>
    entry.providerResponse !== undefined)
  if (!call?.providerResponse) return Object.freeze({
    status: "ORIGINAL_RESPONSE_UNAVAILABLE" as const,
    receiptId: null, evidenceDigest: null,
  })
  const receiptId = randomUUID()
  const evidence = Object.freeze({
    contractVersion: "SELLER_OS_EBAY_OFFICIAL_READ_FAILURE_RECEIPT_V1",
    source: "ORIGINAL_PROVIDER_RESPONSE_REDACTED" as const,
    accountScopeDigest: `sha256:${createHash("sha256")
      .update(input.accountKey).digest("hex")}`,
    runId: input.runId,
    errorCode: input.errorCode,
    operation: call.operation,
    requestedAt: call.requestedAt ?? null,
    respondedAt: call.observedAt,
    httpStatus: call.httpStatus,
    providerErrorCode: call.providerErrorCode ?? null,
    providerResponse: call.providerResponse,
    quotaAuthority: input.quota ? Object.freeze({
      gateState: input.quota.gateState,
      ebay518BucketIdentity: input.quota.ebay518BucketIdentity,
      nextSafeTradingProbeAt: input.quota.nextSafeTradingProbeAt,
    }) : null,
    rawXmlStored: false as const,
    credentialsIncluded: false as const,
  })
  const evidenceDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify(evidence)).digest("hex")}`
  try {
    const write = await input.supabase.from(
      "seller_os_ebay_official_read_failure_receipts_v1").insert({
        receipt_id: receiptId,
        account_key: input.accountKey,
        recovery_run_id: input.runId,
        error_code: input.errorCode,
        observed_at: call.observedAt,
        operation: call.operation,
        http_status: call.httpStatus,
        evidence,
        evidence_digest: evidenceDigest,
      }).select("receipt_id,evidence_digest").single()
    if (write.error || !write.data ||
        write.data.receipt_id !== receiptId ||
        write.data.evidence_digest !== evidenceDigest) {
      return Object.freeze({ status: "PERSISTENCE_FAILED" as const,
        receiptId: null, evidenceDigest: null })
    }
    return Object.freeze({ status: "PERSISTED" as const,
      receiptId, evidenceDigest })
  } catch {
    return Object.freeze({ status: "PERSISTENCE_FAILED" as const,
      receiptId: null, evidenceDigest: null })
  }
}

function boundedQuotaRetryAt(now: Date, resetAt: string | null) {
  const minimum = now.getTime() + RETRY_DELAY_MS
  const maximum = now.getTime() + RETRY_MAXIMUM_DELAY_MS
  const parsedReset = Date.parse(resetAt ?? "")
  const preferred = Number.isFinite(parsedReset)
    ? parsedReset + TRADING_RESET_SAFETY_MS
    : minimum
  return new Date(Math.min(maximum, Math.max(minimum, preferred))).toISOString()
}

function rowsForPersistence(live: EbayCommercialMonitorLiveReadonlyResult) {
  const byItem = new Map<string, Record<string, unknown>>()
  for (const listing of live.discovery.currentLiveListings) {
    if (listing.marketplaceCertification.status !== "US_CERTIFIED" ||
        !ITEM_ID.test(listing.itemId) ||
        !listing.title?.trim() || !/^[A-Z]{3}$/.test(listing.currency ?? "")) {
      continue
    }
    if (listing.identityAmbiguous) throw new Error(
      listing.variationKey === null
        ? "CURRENT_LIVE_AUTHORITY_VARIATION_IDENTITY_UNPROVEN"
        : "CURRENT_LIVE_AUTHORITY_VARIATION_IDENTITY_AMBIGUOUS")
    if (byItem.has(listing.itemId)) throw new Error(
      "CURRENT_LIVE_AUTHORITY_VARIATION_IDENTITY_AMBIGUOUS")
    const variationKey = listing.variationKey
    if (variationKey !== null &&
        (variationKey.length < 1 || variationKey.length > 120 ||
         variationKey !== variationKey.trim() ||
         CONTROL_CHARACTER.test(variationKey))) {
      throw new Error("CURRENT_LIVE_AUTHORITY_VARIATION_IDENTITY_UNPROVEN")
    }
    byItem.set(listing.itemId, {
      itemId: listing.itemId, title: listing.title.trim(),
      sku: listing.sku, quantity: listing.availableQuantity,
      price: listing.price, currency: listing.currency,
      variationKey,
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
  clock?: () => Date
  forceOfficialRead?: boolean
  recheckQuotaBeforeRetry?: boolean
  readOfficial?: typeof getEbayCommercialMonitorLiveReadonly
  readTradingQuota?: () => Promise<TradingQuotaAuthorityV1>
}>) {
  const clock = input.clock ?? (() => new Date())
  const preReadNow = input.now ?? clock()
  const readTradingQuota = async (): Promise<TradingQuotaAuthorityV1 | null> => {
    try {
      return await (input.readTradingQuota ??
        collectSellerOsEbayTradingRateLimitStatusV1)()
    } catch {
      return null
    }
  }
  const stored = await readCurrentLiveAuthorityV1({ supabase: input.supabase,
    accountKey: input.accountKey, now: preReadNow })
  if (stored.currentState === "CURRENT_FRESH" &&
      input.forceOfficialRead !== true) return Object.freeze({
    status: "CURRENT_FRESH_REUSED" as const, authority: stored,
    live: null, officialReadAttempted: false, databaseWrites: 0,
    marketplaceWrites: 0 as const,
  })
  const priorTradingQuota518 = isTradingQuota518(stored.sourceFailureCode)
  let preflightQuota: TradingQuotaAuthorityV1 | null = null
  if (stored.nextRetryAt &&
      Date.parse(stored.nextRetryAt) > preReadNow.getTime()) {
    if (priorTradingQuota518 && input.recheckQuotaBeforeRetry === true) {
      preflightQuota = await readTradingQuota()
      if (preflightQuota?.gateState !== "OPEN") {
        return Object.freeze({
          status: preflightQuota?.gateState === "BLOCKED"
            ? "WAITING_FOR_TRADING_QUOTA_RESET" as const
            : "CURRENT_UNAVAILABLE_TRADING_QUOTA_UNPROVEN" as const,
          authority: stored, officialReadAttempted: false, databaseWrites: 0,
          live: null, marketplaceWrites: 0 as const,
        })
      }
    } else if (input.forceOfficialRead !== true || priorTradingQuota518) {
      return Object.freeze({ status: "WAITING_FOR_RETRY" as const,
        authority: stored, officialReadAttempted: false, databaseWrites: 0,
        live: null, marketplaceWrites: 0 as const })
    }
  }

  const runId = randomUUID()
  const claim = await input.supabase.rpc("claim_ebay_active_listing_sync_run", {
    p_account_key: input.accountKey, p_run_id: runId, p_lease_seconds: 180,
  })
  const claimed = Array.isArray(claim.data) ? claim.data[0] : claim.data
  if (claim.error || !claimed) throw new Error(
    "CURRENT_LIVE_AUTHORITY_RECOVERY_CLAIM_FAILED")
  if (claimed.claimed !== true) {
    const activeLease = Date.parse(String(
      claimed.active_run_lease_expires_at ?? ""))
    const activeRun = typeof claimed.active_run_id === "string" &&
      claimed.active_run_id.length > 0 && Number.isFinite(activeLease) &&
      activeLease > preReadNow.getTime()
    return Object.freeze({
    status: activeRun ? "SINGLE_FLIGHT_ALREADY_RUNNING" as const
      : "WAITING_FOR_RETRY" as const, authority: stored,
    live: null, officialReadAttempted: false, databaseWrites: 0,
    marketplaceWrites: 0 as const,
  })
  }

  const finish = async (success: boolean, errorCode: string | null) => {
    const result = await input.supabase.rpc(
      "finish_ebay_active_listing_sync_run", {
        p_account_key: input.accountKey, p_run_id: runId,
        p_success: success, p_error_code: errorCode,
      })
    if (result.error) throw new Error(
      "CURRENT_LIVE_AUTHORITY_RECOVERY_FINISH_FAILED")
  }
  const recordFailure = async <TStatus extends string>(failure: Readonly<{
    errorCode: string
    nextRetryAt: string
    now: Date
    live: EbayCommercialMonitorLiveReadonlyResult | null
    status: TStatus
    officialReadAttempted: boolean
    tradingQuota?: TradingQuotaAuthorityV1 | null
  }>) => {
    const officialFailureReceipt = await persistOfficialReadFailureReceiptV1({
      supabase: input.supabase, accountKey: input.accountKey, runId,
      errorCode: failure.errorCode, live: failure.live,
      quota: failure.tradingQuota ?? null,
    })
    const failed = await input.supabase.rpc(
      "record_ebay_current_live_authority_failure_v1", {
        p_account_key: input.accountKey, p_run_id: runId,
        p_error_code: failure.errorCode,
        p_next_retry_at: failure.nextRetryAt,
      })
    if (failed.error) throw new Error(
      "CURRENT_LIVE_AUTHORITY_FAILURE_RECEIPT_FAILED")
    await finish(false, failure.errorCode)
    const authority = await readCurrentLiveAuthorityV1({
      supabase: input.supabase, accountKey: input.accountKey,
      live: failure.live, now: failure.now })
    return Object.freeze({ status: failure.status, authority,
      live: failure.live, officialReadAttempted: failure.officialReadAttempted,
      officialFailureReceipt,
      databaseWrites: officialFailureReceipt.status === "PERSISTED" ? 2 : 1,
      marketplaceWrites: 0 as const })
  }
  try {
    if (priorTradingQuota518) {
      const quota = preflightQuota ?? await readTradingQuota()
      if (quota?.gateState !== "OPEN") {
        return await recordFailure({
          errorCode: stored.sourceFailureCode!,
          nextRetryAt: boundedQuotaRetryAt(preReadNow,
            quota?.gateState === "BLOCKED"
              ? quota.nextSafeTradingProbeAt : null),
          now: preReadNow,
          live: null,
          status: quota?.gateState === "BLOCKED"
            ? "WAITING_FOR_TRADING_QUOTA_RESET" as const
            : "CURRENT_UNAVAILABLE_TRADING_QUOTA_UNPROVEN" as const,
          officialReadAttempted: false,
          tradingQuota: quota,
        })
      }
    }
    const officialInput = { accountKey: input.accountKey,
      accountAlias: input.accountAlias ?? "" }
    const live = input.readOfficial
      ? await input.readOfficial({ ...officialInput,
        readLimits: {
          certifiedPortfolioMode: true,
          maximumCalls: 100,
          budgetMs: 48_000,
          isolateIndependentReads: true,
        } })
      : adaptOfficialListingSweepForCurrentLiveV1(
        await getEbayOfficialLiveListingSweepReadonly(officialInput))
    // The official read creates observedAt. Freshness must therefore use a
    // reference captured after that read, never the pre-read admission clock.
    const postReadNow = clock()
    const certifiedOfficialRead = officialCurrentLiveReadCertifiedV1(live)
    const officialObservedAt = certifiedOfficialRead
      ? new Date(live.discovery.observedAt!).toISOString() : null
    const futureClockSkew = officialObservedAt !== null &&
      Date.parse(officialObservedAt) > postReadNow.getTime()
    if (!certifiedOfficialRead || futureClockSkew) {
      const errorCode = futureClockSkew
        ? "CURRENT_LIVE_OFFICIAL_CLOCK_SKEW_FUTURE"
        : safeCode(live.discovery.gapCodes[0],
          "CURRENT_LIVE_OFFICIAL_SOURCE_UNAVAILABLE")
      const quota = isTradingQuota518(errorCode)
        ? await readTradingQuota() : null
      return await recordFailure({
        errorCode,
        nextRetryAt: boundedQuotaRetryAt(postReadNow,
          quota?.gateState === "BLOCKED"
            ? quota.nextSafeTradingProbeAt : null),
        now: postReadNow,
        live,
        status: futureClockSkew
          ? "CURRENT_UNAVAILABLE_CLOCK_SKEW" as const
          : "CURRENT_UNAVAILABLE" as const,
        officialReadAttempted: true,
        tradingQuota: quota,
      })
    }
    const rows = rowsForPersistence(live)
    const ids = currentLiveItemIdsV1(live)
    if (rows.length !== ids.length) throw new Error(
      "CURRENT_LIVE_AUTHORITY_CERTIFIED_ROWS_INCOMPLETE")
    const observedAt = officialObservedAt!
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
      supabase: input.supabase, accountKey: input.accountKey, live,
      now: postReadNow })
    return Object.freeze({ status: "RECOVERED_CURRENT_FRESH" as const,
      authority, live, officialReadAttempted: true, databaseWrites: 1,
      marketplaceWrites: 0 as const })
  } catch (error) {
    const code = safeCode(error instanceof Error ? error.message : null,
      "CURRENT_LIVE_AUTHORITY_RECOVERY_FAILED")
    try { await finish(false, code) } catch { /* preserve primary failure */ }
    throw error
  }
}
