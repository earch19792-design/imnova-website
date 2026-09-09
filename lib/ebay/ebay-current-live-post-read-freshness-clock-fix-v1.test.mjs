import assert from "node:assert/strict"
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
  runCurrentLiveAuthorityRecoveryV1,
} = await import("./ebay-current-live-authority-recovery-v1.ts")

const ACCOUNT = `imnova:${"a".repeat(64)}`
const PRE_READ_NOW = new Date("2026-09-09T00:00:00.000Z")
const OBSERVED_AT = new Date("2026-09-09T00:00:00.250Z")
const POST_READ_NOW = new Date("2026-09-09T00:00:00.300Z")
const TTL_MS = 20 * 60 * 1_000

function listing(overrides = {}) {
  return {
    itemId: "123456789012",
    title: "Certified listing",
    sku: "SKU-1",
    variationKey: null,
    availableQuantity: 2,
    price: 14.5,
    currency: "USD",
    primaryImageUrl: "https://example.invalid/item.jpg",
    identityAmbiguous: false,
    marketplaceCertification: { status: "US_CERTIFIED" },
    ...overrides,
  }
}

function live(observedAt = OBSERVED_AT, rows = [listing()]) {
  return {
    account: { status: "CERTIFIED", bindingMatched: true },
    discovery: {
      status: "AVAILABLE",
      coverage: "COMPLETE",
      observedAt: observedAt.toISOString(),
      gapCodes: [],
      currentLiveListings: rows,
      sellerWideEnumeration: {
        itemSetComplete: true,
        identitySetComplete: true,
      },
      marketplaceCertification: {
        sellerWideItemsParsed: new Set(rows.map((row) => row.itemId)).size,
        sellerWideItemsReported: new Set(rows.map((row) => row.itemId)).size,
        sellerWideItemsMarketplaceUnresolved: 0,
        sellerWideItemsMarketplaceError: 0,
        sellerWideItemsMarketplaceItemIdMismatch: 0,
        sellerWideItemsMarketplaceBudgetExhausted: 0,
      },
    },
  }
}

function fakeSupabase() {
  const calls = []
  return {
    calls,
    from(table) {
      assert.equal(table, "ebay_active_listing_sync_state")
      const chain = {
        select() { return chain },
        eq() { return chain },
        limit() { return chain },
        async maybeSingle() { return { data: null, error: null } },
      }
      return chain
    },
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === "claim_ebay_active_listing_sync_run") {
        return { data: { claimed: true }, error: null }
      }
      if (name === "record_ebay_current_live_authority_success_v1") {
        return { data: { applied: true }, error: null }
      }
      if (name === "record_ebay_current_live_authority_failure_v1") {
        return { data: { applied: true }, error: null }
      }
      if (name === "finish_ebay_active_listing_sync_run") {
        return { data: { finished: true }, error: null }
      }
      throw new Error(`UNEXPECTED_RPC_${name}`)
    },
  }
}

async function recovered(options = {}) {
  const supabase = fakeSupabase()
  const official = live(options.observedAt ?? OBSERVED_AT,
    options.rows ?? [listing()])
  let clockReads = 0
  const result = await runCurrentLiveAuthorityRecoveryV1({
    supabase,
    accountKey: ACCOUNT,
    accountAlias: "fixture",
    now: PRE_READ_NOW,
    clock: () => {
      clockReads += 1
      return options.postReadNow ?? POST_READ_NOW
    },
    forceOfficialRead: true,
    readOfficial: async () => official,
  })
  return { result, calls: supabase.calls, clockReads }
}

test("PRE_READ_NOW_REPRODUCES_OLD_BUG_PASS", () => {
  const result = resolveCurrentLiveAuthorityV1({
    accountKey: ACCOUNT,
    live: live(),
    now: PRE_READ_NOW,
  })
  assert.equal(result.currentState, "CURRENT_UNAVAILABLE")
  assert.equal(result.sourceFailureCode,
    "CURRENT_LIVE_OFFICIAL_CLOCK_SKEW_FUTURE")
})

test("POST_READ_CLOCK_FIX_PASS", async () => {
  const { result, clockReads } = await recovered()
  assert.equal(clockReads, 1)
  assert.equal(result.status, "RECOVERED_CURRENT_FRESH")
  assert.equal(result.authority.currentState, "CURRENT_FRESH")
})

test("OBSERVED_AT_AFTER_PRE_READ_NOW_PASS", async () => {
  assert.ok(OBSERVED_AT.getTime() > PRE_READ_NOW.getTime())
  const { result } = await recovered()
  assert.equal(result.authority.currentObservedAt, OBSERVED_AT.toISOString())
})

test("NON_VARIATION_LISTING_PASS", async () => {
  const { calls } = await recovered()
  const success = calls.find((call) =>
    call.name === "record_ebay_current_live_authority_success_v1")
  assert.equal(success.args.p_rows[0].variationKey, null)
})

test("VARIATION_LISTING_PASS", async () => {
  const { calls } = await recovered({
    rows: [listing({ variationKey: "Color=Blue" })],
  })
  const success = calls.find((call) =>
    call.name === "record_ebay_current_live_authority_success_v1")
  assert.equal(success.args.p_rows[0].variationKey, "Color=Blue")
})

test("FRESH_WITHIN_TTL_PASS", () => {
  const result = resolveCurrentLiveAuthorityV1({
    accountKey: ACCOUNT,
    live: live(),
    now: new Date(OBSERVED_AT.getTime() + TTL_MS),
  })
  assert.equal(result.currentState, "CURRENT_FRESH")
})

test("STALE_AFTER_TTL_PASS", () => {
  const result = resolveCurrentLiveAuthorityV1({
    accountKey: ACCOUNT,
    live: live(),
    now: new Date(OBSERVED_AT.getTime() + TTL_MS + 1),
  })
  assert.equal(result.currentState, "CURRENT_UNAVAILABLE")
})

test("FUTURE_TIMESTAMP_FAIL_CLOSED_PASS", async () => {
  const future = new Date(POST_READ_NOW.getTime() + 1)
  const { result, calls } = await recovered({ observedAt: future })
  assert.equal(result.status, "CURRENT_UNAVAILABLE_CLOCK_SKEW")
  assert.equal(result.authority.currentState, "CURRENT_UNAVAILABLE")
  assert.equal(result.authority.sourceFailureCode,
    "CURRENT_LIVE_OFFICIAL_CLOCK_SKEW_FUTURE")
  assert.equal(calls.some((call) => call.name ===
    "record_ebay_current_live_authority_success_v1"), false)
  assert.equal(calls.find((call) => call.name ===
    "record_ebay_current_live_authority_failure_v1").args.p_error_code,
  "CURRENT_LIVE_OFFICIAL_CLOCK_SKEW_FUTURE")
})

test("IDEMPOTENT_REPLAY_PASS", async () => {
  const first = await recovered()
  const second = await recovered()
  const success = (run) => {
    const { p_run_id: _runId, ...durableIdentity } = run.calls.find((call) =>
      call.name === "record_ebay_current_live_authority_success_v1").args
    return durableIdentity
  }
  assert.deepEqual(success(first), success(second))
})

test("NO_MARKETPLACE_WRITES_PASS", async () => {
  const { result, calls } = await recovered()
  assert.equal(result.marketplaceWrites, 0)
  assert.deepEqual([...new Set(calls.map((call) => call.name))].sort(), [
    "claim_ebay_active_listing_sync_run",
    "finish_ebay_active_listing_sync_run",
    "record_ebay_current_live_authority_success_v1",
  ])
})

test("NO_FRESHNESS_TTL_EXPANSION_PASS", async () => {
  const { result, calls } = await recovered()
  const success = calls.find((call) =>
    call.name === "record_ebay_current_live_authority_success_v1")
  const expectedFreshUntil = new Date(OBSERVED_AT.getTime() + TTL_MS)
    .toISOString()
  assert.equal(success.args.p_fresh_until, expectedFreshUntil)
  assert.equal(result.authority.lastCertifiedFreshUntil, expectedFreshUntil)
})
