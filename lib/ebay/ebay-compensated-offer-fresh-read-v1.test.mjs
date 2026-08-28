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

const { classifyCompensatedOfferFreshReadV1 } = await import(
  "./ebay-compensated-offer-fresh-read-v1.ts"
)

const OFFER_ID = "247475747011"
const SKU = "IMNOVA42B4E4B51A124021918289B782A5C6AC"
const ITEM_ID = "366633121948"

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

test("offer linked to a listing is BLOCKED even when status says UNPUBLISHED", () => {
  const result = classifyCompensatedOfferFreshReadV1(safeInput({
    offerVerification: {
      safe: false,
      status: "UNPUBLISHED",
      offerId: OFFER_ID,
      offerDiscoveryCount: 1,
      offerHasListing: true,
      associatedListingId: ITEM_ID,
      blocker: "EBAY_COMPENSATED_PUBLICATION_RECOVERY_ACTIVE_OR_PUBLISHED_OFFER",
    },
  }))
  assert.equal(result.RECOVERY_SAFETY_CLASSIFICATION, "BLOCKED")
  assert.equal(result.OFFER_HAS_LISTING, true)
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
