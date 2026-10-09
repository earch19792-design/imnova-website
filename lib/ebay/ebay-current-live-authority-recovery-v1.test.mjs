import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const {
  resolveCurrentLiveAuthorityV1,
} = await import("./ebay-current-live-authority-v1.ts")
const {
  adaptOfficialListingSweepForCurrentLiveV1,
  runCurrentLiveAuthorityRecoveryV1,
} = await import("./ebay-current-live-authority-recovery-v1.ts")

const ACCOUNT = `imnova:${"a".repeat(64)}`
const NOW = new Date("2026-09-06T22:30:00.000Z")

function unavailableLive(code = "EBAY_MONITOR_SELLER_LIST_TRADING_ERROR_518") {
  return {
    account: { status: "CERTIFIED", bindingMatched: true },
    discovery: {
      status: "UNAVAILABLE", coverage: "UNPROVEN", observedAt: null,
      gapCodes: [code], currentLiveListings: [],
      sellerWideEnumeration: { itemSetComplete: false,
        identitySetComplete: false },
      marketplaceCertification: {
        sellerWideItemsParsed: null, sellerWideItemsReported: null,
        sellerWideItemsMarketplaceUnresolved: null,
        sellerWideItemsMarketplaceError: null,
        sellerWideItemsMarketplaceItemIdMismatch: null,
        sellerWideItemsMarketplaceBudgetExhausted: null,
      },
    },
  }
}

function stored(ids, freshUntil = "2026-09-06T22:20:00.000Z") {
  return {
    current_live_source_state: "CURRENT_UNAVAILABLE",
    current_live_last_attempt_at: "2026-09-06T22:15:00.000Z",
    current_live_next_retry_at: "2026-09-06T22:45:00.000Z",
    current_live_last_error_code:
      "EBAY_MONITOR_SELLER_LIST_TRADING_ERROR_518",
    last_certified_live_scope_id: `current-live:sha256:${"b".repeat(64)}`,
    last_certified_live_item_ids: ids,
    last_certified_live_count: ids.length,
    last_certified_live_observed_at: "2026-09-06T22:00:00.000Z",
    last_certified_live_fresh_until: freshUntil,
    last_certified_live_source_authority:
      "EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION",
  }
}

function quotaRecoverySupabase(initialStored, claimData = { claimed: true }) {
  const calls = []
  let state = initialStored ? { ...initialStored } : null
  return {
    calls,
    from(table) {
      assert.equal(table, "ebay_active_listing_sync_state")
      const chain = {
        select() { return chain },
        eq() { return chain },
        limit() { return chain },
        async maybeSingle() { return { data: state, error: null } },
      }
      return chain
    },
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === "claim_ebay_active_listing_sync_run") {
        return { data: claimData, error: null }
      }
      if (name === "record_ebay_current_live_authority_failure_v1") {
        state = {
          ...(state ?? {}),
          current_live_source_state: "CURRENT_UNAVAILABLE",
          current_live_last_attempt_at: NOW.toISOString(),
          current_live_next_retry_at: args.p_next_retry_at,
          current_live_last_error_code: args.p_error_code,
        }
        return { data: { recorded: true }, error: null }
      }
      if (name === "record_ebay_current_live_authority_success_v1") {
        return { data: { recorded: true }, error: null }
      }
      if (name === "finish_ebay_active_listing_sync_run") {
        return { data: { finished: true }, error: null }
      }
      throw new Error(`UNEXPECTED_RPC_${name}`)
    },
  }
}

test("a closed seller-wide window is waiting, not a false single flight", async () => {
  const waiting = { ...stored([]), current_live_next_retry_at: null,
    current_live_last_error_code: "CURRENT_LIVE_UNAVAILABLE" }
  const database = quotaRecoverySupabase(waiting, { claimed: false,
    active_run_id: null, active_run_lease_expires_at: null })
  let reads = 0
  const result = await runCurrentLiveAuthorityRecoveryV1({
    supabase: database, accountKey: "fixture", accountAlias: "fixture",
    now: NOW, readOfficial: async () => { reads += 1; return unavailableLive() },
  })
  assert.equal(result.status, "WAITING_FOR_RETRY")
  assert.equal(result.officialReadAttempted, false)
  assert.equal(reads, 0)
})

function quota(gateState, nextSafeTradingProbeAt = null) {
  return {
    gateState,
    ebay518BucketIdentity: gateState === "BLOCKED" ? "PROVEN" : "UNPROVEN",
    nextSafeTradingProbeAt,
  }
}

test("official source failure is unavailable, never authoritative zero", () => {
  const result = resolveCurrentLiveAuthorityV1({ accountKey: ACCOUNT,
    live: unavailableLive(), stored: null, now: NOW })
  assert.equal(result.currentState, "CURRENT_UNAVAILABLE")
  assert.equal(result.currentListingCount, null)
  assert.equal(result.authoritativeZero, false)
  assert.equal(result.lastCertifiedState, "NO_CERTIFIED_HISTORY")
})

test("source failure preserves a stale certified cohort separately", () => {
  const ids = ["366643122092", "366543596425"]
  const result = resolveCurrentLiveAuthorityV1({ accountKey: ACCOUNT,
    live: unavailableLive(), stored: stored(ids), now: NOW })
  assert.equal(result.currentListingCount, null)
  assert.equal(result.lastCertifiedState, "LAST_CERTIFIED_STALE")
  assert.equal(result.lastCertifiedListingCount, 2)
  assert.deepEqual(result.lastCertifiedItemIds, [...ids].sort())
  assert.equal(result.sourceFailureCode,
    "EBAY_MONITOR_SELLER_LIST_TRADING_ERROR_518")
})

test("a certified complete empty read is the only authoritative zero", () => {
  const live = {
    account: { status: "CERTIFIED", bindingMatched: true },
    discovery: {
      status: "AVAILABLE", coverage: "COMPLETE",
      observedAt: "2026-09-06T22:29:00.000Z", gapCodes: [],
      currentLiveListings: [],
      sellerWideEnumeration: { itemSetComplete: true,
        identitySetComplete: true },
      marketplaceCertification: {
        sellerWideItemsParsed: 0, sellerWideItemsReported: 0,
        sellerWideItemsMarketplaceUnresolved: 0,
        sellerWideItemsMarketplaceError: 0,
        sellerWideItemsMarketplaceItemIdMismatch: 0,
        sellerWideItemsMarketplaceBudgetExhausted: 0,
      },
    },
  }
  const result = resolveCurrentLiveAuthorityV1({ accountKey: ACCOUNT,
    live, stored: null, now: NOW })
  assert.equal(result.currentState, "CURRENT_FRESH")
  assert.equal(result.currentListingCount, 0)
  assert.equal(result.authoritativeZero, true)
})

test("forced recovery honors a future 518 retry without probing any authority", async () => {
  const supabase = quotaRecoverySupabase(stored([]))
  let quotaReads = 0
  let officialReads = 0
  const result = await runCurrentLiveAuthorityRecoveryV1({
    supabase,
    accountKey: ACCOUNT,
    accountAlias: "fixture",
    now: NOW,
    forceOfficialRead: true,
    readTradingQuota: async () => {
      quotaReads += 1
      return quota("BLOCKED", "2026-09-07T00:00:00.000Z")
    },
    readOfficial: async () => {
      officialReads += 1
      return unavailableLive()
    },
  })
  assert.equal(result.status, "WAITING_FOR_RETRY")
  assert.equal(result.officialReadAttempted, false)
  assert.equal(quotaReads, 0)
  assert.equal(officialReads, 0)
  assert.equal(supabase.calls.length, 0)
})

test("a bounded quota recheck unlocks an early 518 recovery only after OPEN", async () => {
  const supabase = quotaRecoverySupabase(stored([]))
  let quotaReads = 0
  let officialReads = 0
  const live = {
    account: { status: "CERTIFIED", bindingMatched: true },
    discovery: {
      status: "AVAILABLE", coverage: "COMPLETE",
      observedAt: "2026-09-06T22:29:00.000Z", gapCodes: [],
      currentLiveListings: [],
      sellerWideEnumeration: { itemSetComplete: true,
        identitySetComplete: true },
      marketplaceCertification: {
        sellerWideItemsParsed: 0, sellerWideItemsReported: 0,
        sellerWideItemsMarketplaceUnresolved: 0,
        sellerWideItemsMarketplaceError: 0,
        sellerWideItemsMarketplaceItemIdMismatch: 0,
        sellerWideItemsMarketplaceBudgetExhausted: 0,
      },
    },
  }
  const result = await runCurrentLiveAuthorityRecoveryV1({
    supabase,
    accountKey: ACCOUNT,
    accountAlias: "fixture",
    now: NOW,
    clock: () => NOW,
    recheckQuotaBeforeRetry: true,
    readTradingQuota: async () => {
      quotaReads += 1
      return quota("OPEN")
    },
    readOfficial: async () => {
      officialReads += 1
      return live
    },
  })
  assert.equal(result.status, "RECOVERED_CURRENT_FRESH")
  assert.equal(result.officialReadAttempted, true)
  assert.equal(quotaReads, 1)
  assert.equal(officialReads, 1)
  assert.equal(supabase.calls.filter((call) => call.name ===
    "record_ebay_current_live_authority_success_v1").length, 1)
})

test("a bounded quota recheck stays closed while the 518 bucket is blocked", async () => {
  const supabase = quotaRecoverySupabase(stored([]))
  let quotaReads = 0
  let officialReads = 0
  const result = await runCurrentLiveAuthorityRecoveryV1({
    supabase,
    accountKey: ACCOUNT,
    accountAlias: "fixture",
    now: NOW,
    recheckQuotaBeforeRetry: true,
    readTradingQuota: async () => {
      quotaReads += 1
      return quota("BLOCKED", "2026-09-07T00:00:00.000Z")
    },
    readOfficial: async () => {
      officialReads += 1
      return unavailableLive()
    },
  })
  assert.equal(result.status, "WAITING_FOR_TRADING_QUOTA_RESET")
  assert.equal(result.officialReadAttempted, false)
  assert.equal(quotaReads, 1)
  assert.equal(officialReads, 0)
  assert.equal(supabase.calls.length, 0)
})

test("known 518 uses the proven Trading reset and never performs a blind probe", async () => {
  const previous = stored([])
  previous.current_live_next_retry_at = "2026-09-06T22:20:00.000Z"
  const supabase = quotaRecoverySupabase(previous)
  let officialReads = 0
  const result = await runCurrentLiveAuthorityRecoveryV1({
    supabase,
    accountKey: ACCOUNT,
    accountAlias: "fixture",
    now: NOW,
    forceOfficialRead: true,
    readTradingQuota: async () => quota(
      "BLOCKED", "2026-09-06T23:00:00.000Z"),
    readOfficial: async () => {
      officialReads += 1
      return unavailableLive()
    },
  })
  assert.equal(result.status, "WAITING_FOR_TRADING_QUOTA_RESET")
  assert.equal(result.officialReadAttempted, false)
  assert.equal(officialReads, 0)
  const receipt = supabase.calls.find((call) => call.name ===
    "record_ebay_current_live_authority_failure_v1")
  assert.equal(receipt.args.p_error_code,
    "EBAY_MONITOR_SELLER_LIST_TRADING_ERROR_518")
  assert.equal(receipt.args.p_next_retry_at, "2026-09-06T23:01:00.000Z")
  assert.equal(result.authority.nextRetryAt, "2026-09-06T23:01:00.000Z")
})

test("unproven Trading quota remains fail-closed and rechecks without Trading", async () => {
  const previous = stored([])
  previous.current_live_next_retry_at = "2026-09-06T22:20:00.000Z"
  const supabase = quotaRecoverySupabase(previous)
  let officialReads = 0
  const result = await runCurrentLiveAuthorityRecoveryV1({
    supabase,
    accountKey: ACCOUNT,
    accountAlias: "fixture",
    now: NOW,
    forceOfficialRead: true,
    readTradingQuota: async () => quota("UNPROVEN"),
    readOfficial: async () => {
      officialReads += 1
      return unavailableLive()
    },
  })
  assert.equal(result.status,
    "CURRENT_UNAVAILABLE_TRADING_QUOTA_UNPROVEN")
  assert.equal(officialReads, 0)
  const receipt = supabase.calls.find((call) => call.name ===
    "record_ebay_current_live_authority_failure_v1")
  assert.equal(receipt.args.p_next_retry_at, "2026-09-06T22:45:00.000Z")
  assert.equal(receipt.args.p_error_code,
    "EBAY_MONITOR_SELLER_LIST_TRADING_ERROR_518")
})

test("a newly observed 518 records the authoritative reset for later recovery", async () => {
  const supabase = quotaRecoverySupabase(null)
  let quotaReads = 0
  const result = await runCurrentLiveAuthorityRecoveryV1({
    supabase,
    accountKey: ACCOUNT,
    accountAlias: "fixture",
    now: NOW,
    clock: () => NOW,
    forceOfficialRead: true,
    readTradingQuota: async () => {
      quotaReads += 1
      return quota("BLOCKED", "2026-09-06T23:00:00.000Z")
    },
    readOfficial: async () => unavailableLive(),
  })
  assert.equal(result.status, "CURRENT_UNAVAILABLE")
  assert.equal(result.officialReadAttempted, true)
  assert.equal(quotaReads, 1)
  const receipt = supabase.calls.find((call) => call.name ===
    "record_ebay_current_live_authority_failure_v1")
  assert.equal(receipt.args.p_next_retry_at, "2026-09-06T23:01:00.000Z")
  assert.equal(result.authority.sourceFailureCode,
    "EBAY_MONITOR_SELLER_LIST_TRADING_ERROR_518")
  assert.equal(result.authority.nextRetryAt, "2026-09-06T23:01:00.000Z")
})

test("portfolio recovery gives the full reader enough time for a live sweep", async () => {
  const previous = stored([])
  previous.current_live_next_retry_at = "2026-09-06T22:20:00.000Z"
  previous.current_live_last_error_code =
    "SELLER_WIDE_MARKETPLACE_CERTIFICATION_BUDGET_EXHAUSTED"
  const supabase = quotaRecoverySupabase(previous)
  let capturedInput = null
  await runCurrentLiveAuthorityRecoveryV1({
    supabase,
    accountKey: ACCOUNT,
    accountAlias: "fixture",
    now: NOW,
    clock: () => NOW,
    forceOfficialRead: true,
    readOfficial: async (input) => {
      capturedInput = input
      return unavailableLive(
        "SELLER_WIDE_MARKETPLACE_CERTIFICATION_BUDGET_EXHAUSTED")
    },
  })
  assert.deepEqual(capturedInput.readLimits, {
    certifiedPortfolioMode: true,
    maximumCalls: 100,
    budgetMs: 48_000,
    isolateIndependentReads: true,
  })
})

test("CURRENT LIVE adapts the dedicated listing-only sweep without unrelated readers", () => {
  const listing = {
    itemId: "366643122092", title: "Fixture", sku: "ITEM1",
    availableQuantity: 1, price: 19.99, currency: "USD",
    variationKey: null, primaryImageUrl: null, identityAmbiguous: false,
    marketplaceCertification: { status: "US_CERTIFIED" },
  }
  const adapted = adaptOfficialListingSweepForCurrentLiveV1({
    status: "CERTIFIED_COMPLETE", failedOperation: null, errorCode: null,
    accountCertified: true, oauthReached: true, officialReadReached: true,
    paginationComplete: true, pagesRead: 1, totalPages: 1,
    totalEntries: 1, observedAt: "2026-09-06T22:29:00.000Z",
    gapCodes: [], listings: [listing], calls: [],
  })
  assert.equal(adapted.account.status, "CERTIFIED")
  assert.equal(adapted.discovery.coverage, "COMPLETE")
  assert.equal(adapted.discovery.currentLiveListings.length, 1)
  assert.equal(adapted.discovery.marketplaceCertification
    .sellerWideItemsMarketplaceBudgetExhausted, 0)
  assert.equal(adapted.analytics.status, "UNAVAILABLE")
  assert.deepEqual(adapted.analytics.observations, [])
  assert.equal(adapted.orders.status, "UNAVAILABLE")
  assert.equal(adapted.discovery.inventory.status, "UNAVAILABLE")
  assert.equal(adapted.discovery.sellerWideEnumeration.identities.length, 1)
})

test("a new seller-wide window resets its diagnostic count to one", () => {
  const migration = readFileSync(
    "supabase/migrations/20261004180100_reset_seller_wide_acquisition_window_counter_v1.sql",
    "utf8")
  assert.match(migration,
    /seller_wide_acquisition_count\s*=\s*case[\s\S]*then 1[\s\S]*else state\.seller_wide_acquisition_count \+ 1/)
})

test("a failed CURRENT LIVE read can retry after its durable delay without escaping the hourly cap", () => {
  const migration = readFileSync(
    "supabase/migrations/20261004185700_allow_bounded_current_live_retry_v1.sql",
    "utf8")
  assert.match(migration,
    /current_live_next_retry_at <= pg_catalog\.clock_timestamp\(\)/)
  assert.match(migration,
    /coalesce\(state\.seller_wide_acquisition_count, 0\) < 4/)
  assert.match(migration,
    /else state\.seller_wide_window_until/)
})

test("an expired successful CURRENT LIVE cohort can refresh inside the bounded hour", () => {
  const migration = readFileSync(
    "supabase/migrations/20261004194800_allow_expired_current_live_refresh_v1.sql",
    "utf8")
  assert.match(migration,
    /current_live_source_state = 'CURRENT_FRESH'[\s\S]*current_live_last_attempt_at <=[\s\S]*interval '15 minutes'/)
  assert.match(migration,
    /coalesce\(state\.seller_wide_acquisition_count, 0\) < 4/)
  assert.match(migration,
    /last_certified_live_fresh_until <= pg_catalog\.clock_timestamp\(\)/)
})

test("recovery is attached to the existing cron and does not add a GET executor", () => {
  const cron = readFileSync(
    "app/api/cron/ebay-commercial-monitor/route.ts", "utf8")
  const stockCron = readFileSync(
    "app/api/cron/ebay-active-listing-luna-monitor/route.ts", "utf8")
  const ownerQuickPick = readFileSync(
    "app/api/admin/ebay/luna-quick-pick/route.ts", "utf8")
  const migration = readFileSync(
    "supabase/migrations/20260906224852_seller_os_current_live_authority_recovery_v1.sql",
    "utf8")
  const workflow = readFileSync(
    ".github/workflows/ebay-commercial-preview-monitor.yml", "utf8")
  assert.match(cron, /runCurrentLiveAuthorityRecoveryV1/)
  assert.match(stockCron, /runCurrentLiveAuthorityRecoveryV1/)
  assert.match(stockCron, /forceOfficialRead:\s*false/)
  assert.match(ownerQuickPick,
    /forceOfficialRead:\s*true,[\s\S]*recheckQuotaBeforeRetry:\s*true/)
  assert.match(stockCron,
    /liveRecovery\.status === "CURRENT_FRESH_REUSED"[\s\S]*CURRENT_LIVE_FRESH_REUSED_NEXT_CYCLE_WILL_REFRESH/)
  assert.match(stockCron, /falseFailurePrevented:\s*true/)
  assert.match(stockCron, /currentLiveCount:\s*null/)
  assert.match(stockCron,
    /recoveryDiagnostic:[\s\S]*discoveredListingRows:[\s\S]*marketplaceCertification:/)
  assert.match(cron, /export function GET\(\)[\s\S]*sellerOsPostOnlyGetResponseV1/)
  assert.equal((workflow.match(/--request POST/g) ?? []).length, 4)
  assert.match(migration,
    /record_ebay_current_live_authority_failure_v1[\s\S]*current_live_source_state/)
  assert.match(migration,
    /last_certified_live_item_ids[\s\S]*preserved on source failure/i)
})

test("redacted original Trading failures have append-only durable receipts", () => {
  const source = readFileSync(
    "lib/ebay/ebay-current-live-authority-recovery-v1.ts", "utf8")
  const migration = readFileSync(
    "supabase/migrations/20261009015051_ebay_control_publisher_certification_v2.sql",
    "utf8")
  const aclMigration = readFileSync(
    "supabase/migrations/20261009023000_harden_ebay_official_read_failure_receipts_acl_v1.sql",
    "utf8")
  assert.match(source,
    /seller_os_ebay_official_read_failure_receipts_v1/)
  assert.match(source, /ORIGINAL_PROVIDER_RESPONSE_REDACTED/)
  assert.match(source, /rawXmlStored:\s*false/)
  assert.match(source, /credentialsIncluded:\s*false/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /force row level security/)
  assert.match(migration,
    /revoke all on public\.seller_os_ebay_official_read_failure_receipts_v1[\s\S]*from public, anon, authenticated/)
  assert.doesNotMatch(migration,
    /grant (?:update|delete|truncate)[\s\S]*seller_os_ebay_official_read_failure_receipts_v1/i)
  assert.match(aclMigration,
    /revoke all on public\.seller_os_ebay_official_read_failure_receipts_v1[\s\S]*from service_role/)
  assert.match(aclMigration,
    /grant select, insert on[\s\S]*seller_os_ebay_official_read_failure_receipts_v1 to service_role/)
  assert.doesNotMatch(aclMigration,
    /grant (?:update|delete|truncate|all)[\s\S]*seller_os_ebay_official_read_failure_receipts_v1/i)
})
