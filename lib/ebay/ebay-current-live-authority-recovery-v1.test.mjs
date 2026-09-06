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

test("recovery is attached to the existing cron and does not add a GET executor", () => {
  const cron = readFileSync(
    "app/api/cron/ebay-commercial-monitor/route.ts", "utf8")
  const stockCron = readFileSync(
    "app/api/cron/ebay-active-listing-luna-monitor/route.ts", "utf8")
  const migration = readFileSync(
    "supabase/migrations/20260906224852_seller_os_current_live_authority_recovery_v1.sql",
    "utf8")
  assert.match(cron, /runCurrentLiveAuthorityRecoveryV1/)
  assert.match(stockCron, /runCurrentLiveAuthorityRecoveryV1/)
  assert.match(stockCron, /forceOfficialRead:\s*true/)
  assert.match(stockCron, /currentLiveCount:\s*null/)
  assert.match(cron, /export function GET\(\)[\s\S]*sellerOsPostOnlyGetResponseV1/)
  assert.match(migration,
    /record_ebay_current_live_authority_failure_v1[\s\S]*current_live_source_state/)
  assert.match(migration,
    /last_certified_live_item_ids[\s\S]*preserved on source failure/i)
})
