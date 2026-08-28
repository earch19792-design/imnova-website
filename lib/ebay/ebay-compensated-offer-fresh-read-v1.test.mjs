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
  classifyCompensatedOfferFreshReadEligibilityV1,
  classifyCompensatedOfferFreshReadV1,
  executeCompensatedOfferFreshReadGateV1,
} = await import(
  "./ebay-compensated-offer-fresh-read-v1.ts"
)

const OFFER_ID = "247475747011"
const SKU = "IMNOVA42B4E4B51A124021918289B782A5C6AC"
const ITEM_ID = "366633121948"
const APPROVAL_ID = "8da9dc2f-ec5e-42b4-8b8c-a021d01ceccc"
const EXECUTION_ID = "86a15258-3d6d-4df1-baf4-c2ab4247146d"
const AUTHORIZED_HASH = "a".repeat(64)

function durableState(overrides = {}) {
  return {
    approval: {
      id: APPROVAL_ID,
      status: "consumed",
      revoked_at: null,
      payload_hash: AUTHORIZED_HASH,
    },
    execution: {
      id: EXECUTION_ID,
      approval_id: APPROVAL_ID,
      phase: "completed",
      offer_id: OFFER_ID,
      sku: SKU,
      request_hash: AUTHORIZED_HASH,
    },
    publication: {
      draft_execution_id: EXECUTION_ID,
      draft_approval_id: APPROVAL_ID,
      phase: "terminal_failure",
      offer_id: OFFER_ID,
      sku: SKU,
      listing_id: ITEM_ID,
      publish_attempt_count: 1,
      last_error_code: "EBAY_FINAL_PUBLICATION_MONITOR_PERSIST_FAILED",
      sanitized_result: {
        compensatingEndVerified: true,
        officialReadbackNotCurrentLive: true,
      },
    },
    ...overrides,
  }
}

function safeInput(overrides = {}) {
  return {
    expectedOfferId: OFFER_ID,
    expectedSku: SKU,
    expectedHistoricalItemId: ITEM_ID,
    offerVerification: {
      safe: true,
      status: "UNPUBLISHED",
      offerId: OFFER_ID,
      offerDiscoveryCount: 1,
      offerHasListing: false,
      associatedListingId: null,
      blocker: "",
    },
    inventoryVerification: { safe: true, blocker: "" },
    historicalItemReadback: {
      ownership: "inactive",
      itemId: ITEM_ID,
      listingStatus: "Ended",
      ebaySku: SKU,
    },
    activeDuplicateCount: 0,
    observedAt: new Date("2026-08-28T21:00:00.000Z"),
    ...overrides,
  }
}

test("unique UNPUBLISHED exact offer is SAFE to rearm existing Golden Path", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput())
  assert.equal(result.OFFER_DISCOVERY_COUNT, 1)
  assert.equal(result.OFFER_ID, OFFER_ID)
  assert.equal(result.OFFER_STATUS, "UNPUBLISHED")
  assert.equal(result.OFFER_HAS_LISTING, false)
  assert.equal(result.ASSOCIATED_LISTING_ID, null)
  assert.equal(result.INVENTORY_ITEM_READBACK_STATUS, "PASS_EXACT_MATCH")
  assert.equal(result.HISTORICAL_ITEM_STATUS, "NOT_ACTIVE")
  assert.equal(result.ACTIVE_DUPLICATE_COUNT, 0)
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION,
    "SAFE_TO_REARM_EXISTING_GOLDEN_PATH")
  assert.equal(result.BLOCKER, null)
  for (const field of ["MARKETPLACE_WRITES", "DATABASE_MUTATIONS",
    "REARM_CALLS", "NEW_OFFERS", "PUBLISH_CALLS", "WITHDRAW_CALLS"]) {
    assert.equal(result[field], 0, field)
  }
})

test("published offer is BLOCKED", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput({
    offerVerification: {
      safe: false,
      status: "PUBLISHED",
      offerId: OFFER_ID,
      offerDiscoveryCount: 1,
      offerHasListing: true,
      associatedListingId: ITEM_ID,
      blocker: "EBAY_COMPENSATED_PUBLICATION_RECOVERY_ACTIVE_OR_PUBLISHED_OFFER",
    },
  }))
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION, "BLOCKED")
  assert.equal(result.OFFER_STATUS, "PUBLISHED")
})

test("multiple offers are BLOCKED", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput({
    offerVerification: {
      safe: false,
      status: "UNPUBLISHED",
      offerId: OFFER_ID,
      offerDiscoveryCount: 2,
      offerHasListing: false,
      associatedListingId: null,
      blocker: "EBAY_COMPENSATED_PUBLICATION_RECOVERY_OFFER_AMBIGUOUS",
    },
  }))
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION, "BLOCKED")
  assert.equal(result.OFFER_DISCOVERY_COUNT, 2)
})

test("UNPUBLISHED offer linked to exact inactive historical listing is safe", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput({
    offerVerification: {
      safe: true,
      status: "UNPUBLISHED",
      offerId: OFFER_ID,
      offerDiscoveryCount: 1,
      offerHasListing: true,
      associatedListingId: ITEM_ID,
      blocker: "",
    },
  }))
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION,
    "SAFE_TO_REARM_EXISTING_GOLDEN_PATH")
  assert.equal(result.OFFER_HAS_LISTING, true)
  assert.equal(result.ASSOCIATED_LISTING_ID, ITEM_ID)
})

test("UNPUBLISHED exact association is BLOCKED when historical listing is active", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput({
    offerVerification: {
      safe: true,
      status: "UNPUBLISHED",
      offerId: OFFER_ID,
      offerDiscoveryCount: 1,
      offerHasListing: true,
      associatedListingId: ITEM_ID,
      blocker: "",
    },
    historicalItemReadback: {
      ownership: "active",
      itemId: ITEM_ID,
      listingStatus: "Active",
      ebaySku: SKU,
    },
  }))
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION, "BLOCKED")
  assert.equal(result.BLOCKER,
    "EBAY_COMPENSATED_PUBLICATION_ORIGINAL_LISTING_STILL_ACTIVE")
})

test("UNPUBLISHED association to a different historical listing is BLOCKED", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput({
    offerVerification: {
      safe: false,
      status: "UNPUBLISHED",
      offerId: OFFER_ID,
      offerDiscoveryCount: 1,
      offerHasListing: true,
      associatedListingId: "366633121949",
      blocker:
        "EBAY_COMPENSATED_PUBLICATION_RECOVERY_HISTORICAL_LISTING_MISMATCH",
    },
  }))
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION, "BLOCKED")
  assert.equal(result.BLOCKER,
    "EBAY_COMPENSATED_PUBLICATION_RECOVERY_HISTORICAL_LISTING_MISMATCH")
})

test("Inventory Item mismatch is BLOCKED", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput({
    inventoryVerification: {
      safe: false,
      blocker: "EBAY_INVENTORY_OUTCOME_UNKNOWN",
    },
  }))
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION, "BLOCKED")
  assert.equal(result.INVENTORY_ITEM_READBACK_STATUS, "BLOCKED")
})

test("active duplicate is BLOCKED", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput({
    activeDuplicateCount: 1,
  }))
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION, "BLOCKED")
  assert.equal(result.ACTIVE_DUPLICATE_COUNT, 1)
  assert.equal(result.BLOCKER,
    "EBAY_COMPENSATED_PUBLICATION_ACTIVE_DUPLICATE")
})

test("exact compensated terminal failure durable state is eligible", () => {
  const eligibility = classifyCompensatedOfferFreshReadEligibilityV1(
    durableState(),
  )
  assert.deepEqual(eligibility, {
    eligible: true,
    reasonCode: "COMPENSATED_OFFER_FRESH_READ_REQUIRED",
    verifierExecuted: false,
  })
})

test("eligible gate executes verifier exactly once and emits result", async () => {
  let verifierCalls = 0
  const observed = { OFFER_ID, OFFER_STATUS: "UNPUBLISHED" }
  const result = await executeCompensatedOfferFreshReadGateV1({
    ...durableState(),
    verifier: async () => {
      verifierCalls += 1
      return observed
    },
  })
  assert.equal(verifierCalls, 1)
  assert.equal(result.eligibility.eligible, true)
  assert.equal(result.eligibility.verifierExecuted, true)
  assert.equal(result.compensatedOfferFreshRead, observed)
})

test("ordinary listing GET does not execute verifier", async () => {
  let verifierCalls = 0
  const state = durableState()
  const result = await executeCompensatedOfferFreshReadGateV1({
    ...state,
    publication: { ...state.publication, phase: "published" },
    verifier: async () => {
      verifierCalls += 1
      return {}
    },
  })
  assert.equal(verifierCalls, 0)
  assert.equal(result.eligibility.eligible, false)
  assert.equal(result.eligibility.verifierExecuted, false)
  assert.equal(result.compensatedOfferFreshRead, null)
})

test("wrong terminal error code is not eligible", () => {
  const state = durableState()
  const eligibility = classifyCompensatedOfferFreshReadEligibilityV1({
    ...state,
    publication: {
      ...state.publication,
      last_error_code: "EBAY_PUBLISH_WRITE_REJECTED",
    },
  })
  assert.equal(eligibility.eligible, false)
  assert.equal(eligibility.reasonCode,
    "COMPENSATED_OFFER_FRESH_READ_ERROR_CODE_NOT_ELIGIBLE")
})

test("unverified compensation is not eligible", () => {
  const state = durableState()
  const eligibility = classifyCompensatedOfferFreshReadEligibilityV1({
    ...state,
    publication: {
      ...state.publication,
      sanitized_result: {
        compensatingEndVerified: false,
        officialReadbackNotCurrentLive: true,
      },
    },
  })
  assert.equal(eligibility.eligible, false)
  assert.equal(eligibility.reasonCode,
    "COMPENSATED_OFFER_FRESH_READ_COMPENSATION_NOT_VERIFIED")
})

test("authenticated GET fresh-read branch contains reads only and no rearm", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/ebay/draft-only/route.ts", import.meta.url),
    "utf8",
  )
  const start = route.indexOf(
    "async function readCompensatedPublicationFreshSafety(",
  )
  const end = route.indexOf("async function verifyExactUnpublishedPublicationState(", start)
  assert.ok(start >= 0 && end > start)
  const branch = route.slice(start, end)
  assert.match(branch, /verifyEbayCompensatedOfferRecoveryState/)
  assert.match(branch, /verifyEbayDraftInventoryItem/)
  assert.match(branch, /readManualListingFromTradingApi/)
  assert.match(branch, /listing_status", "active"/)
  assert.match(branch, /Promise\.allSettled/)
  assert.doesNotMatch(branch, /\.rpc\(|\.insert\(|\.update\(|\.delete\(/)
  assert.doesNotMatch(branch, /rearmFinalPublication|publishEbayOfferOnce|createEbayUnpublishedOffer/)
})

test("GET exposes eligibility and fresh read as explicit top-level fields", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/ebay/draft-only/route.ts", import.meta.url),
    "utf8",
  )
  const getStart = route.indexOf("export async function GET(req: Request)")
  const postStart = route.indexOf("export async function POST(req: Request)")
  const get = route.slice(getStart, postStart)
  assert.match(get, /executeCompensatedOfferFreshReadGateV1\(\{/)
  assert.match(get, /compensatedOfferFreshReadEligibility,\s*compensatedOfferFreshRead,/)
  assert.match(get,
    /"Cache-Control": "private, no-store, no-cache, max-age=0"/)
})

test("auth failure returns before verifier and every GET path is write-free", () => {
  const route = readFileSync(
    new URL("../../app/api/admin/ebay/draft-only/route.ts", import.meta.url),
    "utf8",
  )
  const getStart = route.indexOf("export async function GET(req: Request)")
  const postStart = route.indexOf("export async function POST(req: Request)")
  const get = route.slice(getStart, postStart)
  assert.ok(get.indexOf("await authenticate(req)") >= 0)
  assert.ok(get.indexOf("if (auth.response) return auth.response") >
    get.indexOf("await authenticate(req)"))
  assert.ok(get.indexOf("executeCompensatedOfferFreshReadGateV1") >
    get.indexOf("if (auth.response) return auth.response"))
  assert.doesNotMatch(get, /\.rpc\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(/)
  assert.doesNotMatch(get,
    /publishEbayOfferOnce|createEbayUnpublishedOffer|withdraw|rearm/i)
})
