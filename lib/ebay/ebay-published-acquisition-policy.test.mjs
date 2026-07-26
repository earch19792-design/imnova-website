import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  EBAY_PUBLISHED_ACQUISITION_BLOCKER_CODE,
  EBAY_PUBLISHED_ACQUISITION_POLICY_VERSION,
  evaluateEbayPublishedAcquisitionPolicy,
  resolveEbayPublishedAcquisitionPolicyMode,
} from "./ebay-published-acquisition-policy.ts"

const account = `ebay:${"a".repeat(64)}`
const otherAccount = `ebay:${"b".repeat(64)}`
const now = new Date("2026-07-26T18:00:00.000Z")

function identity(overrides = {}) {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    accountKey: account,
    marketplace: "EBAY_US",
    identityStatus: "ACTIVE",
    marketRadarProductId: "20000000-0000-4000-8000-000000000001",
    supplierVariantId: "hearing-aids-default",
    supplierSku: "ITEM3155",
    ebaySku: "IMNOVA-ITEM3155",
    offerId: "offer-item3155",
    ebayItemId: "123456789012",
    commercialGeneration: 1,
    observedAt: now.toISOString(),
    source: "EBAY_ACTIVE_LISTING",
    ...overrides,
  }
}

function candidate(overrides = {}) {
  return {
    accountKey: account,
    marketplace: "EBAY_US",
    marketRadarProductId: "20000000-0000-4000-8000-000000000001",
    supplierVariantId: "hearing-aids-default",
    supplierSku: "ITEM3155",
    ebaySku: null,
    offerId: null,
    ebayItemId: null,
    acquisitionIntent: "NEW_ACQUISITION",
    commercialGeneration: 1,
    authorizationId: null,
    ...overrides,
  }
}

test("ITEM3155 already published is excluded in enforce mode", () => {
  const result = evaluateEbayPublishedAcquisitionPolicy({
    candidate: candidate(),
    identities: [identity()],
    machineState: "WAITING_LUNA_CONFIRMATION",
    mode: "ENFORCE",
    now,
  })
  assert.equal(result.decision, "BLOCK_ALREADY_PUBLISHED")
  assert.equal(result.enforced, true)
  assert.equal(result.canEnterAcquisition, false)
  assert.deepEqual(result.blockerCodes, [
    EBAY_PUBLISHED_ACQUISITION_BLOCKER_CODE,
  ])
  assert.ok(result.matchReasons.includes("SUPPLIER_OR_EBAY_SKU"))
  assert.equal(result.policyVersion, EBAY_PUBLISHED_ACQUISITION_POLICY_VERSION)
  assert.equal(result.ebayWrites, 0)
})

test("supplier and eBay SKU aliases are canonical and case insensitive", () => {
  const result = evaluateEbayPublishedAcquisitionPolicy({
    candidate: candidate({
      supplierSku: null,
      ebaySku: "imnova-item3155",
      marketRadarProductId: null,
      supplierVariantId: null,
    }),
    identities: [identity()],
    mode: "ENFORCE",
    now,
  })
  assert.equal(result.enforced, true)
  assert.deepEqual(result.matchReasons, ["SUPPLIER_OR_EBAY_SKU"])
})

test("Offer ID and Item ID independently protect the acquisition lane", () => {
  for (const key of ["offerId", "ebayItemId"]) {
    const result = evaluateEbayPublishedAcquisitionPolicy({
      candidate: candidate({
        supplierSku: null,
        ebaySku: null,
        marketRadarProductId: null,
        supplierVariantId: null,
        offerId: key === "offerId" ? "offer-item3155" : null,
        ebayItemId: key === "ebayItemId" ? "123456789012" : null,
      }),
      identities: [identity()],
      mode: "ENFORCE",
      now,
    })
    assert.equal(result.enforced, true)
  }
})

test("account and marketplace scope isolate identical SKUs", () => {
  for (const scopedCandidate of [
    candidate({ accountKey: otherAccount }),
    candidate({ marketplace: "EBAY_GB" }),
  ]) {
    const result = evaluateEbayPublishedAcquisitionPolicy({
      candidate: scopedCandidate,
      identities: [identity()],
      mode: "ENFORCE",
      now,
    })
    assert.equal(result.enforced, false)
    assert.equal(result.matchedIdentityIds.length, 0)
  }
})

test("shadow is the fail-safe initial feature mode and creates no effect", () => {
  assert.equal(resolveEbayPublishedAcquisitionPolicyMode(undefined), "SHADOW")
  const result = evaluateEbayPublishedAcquisitionPolicy({
    candidate: candidate(),
    identities: [identity()],
    machineState: "RUN_CREATED",
    mode: "SHADOW",
    now,
  })
  assert.equal(result.wouldBlock, true)
  assert.equal(result.enforced, false)
  assert.equal(result.decision, "SHADOW_MATCH_ALREADY_PUBLISHED")
  assert.equal(result.canEnterAcquisition, true)
  assert.equal(result.ebayWrites, 0)
})

test("post-publication readback is not mistaken for a duplicate acquisition", () => {
  const result = evaluateEbayPublishedAcquisitionPolicy({
    candidate: candidate(),
    identities: [identity()],
    machineState: "VERIFYING_PUBLISHED_LISTING",
    mode: "ENFORCE",
    now,
  })
  assert.equal(result.enforced, false)
  assert.equal(result.decision, "ALLOW_POST_PUBLICATION_RECONCILIATION")
})

test("relist and new generation require a current durable authorization", () => {
  const blocked = evaluateEbayPublishedAcquisitionPolicy({
    candidate: candidate({
      acquisitionIntent: "NEW_GENERATION",
      commercialGeneration: 2,
      authorizationId: "30000000-0000-4000-8000-000000000001",
    }),
    identities: [identity()],
    mode: "ENFORCE",
    now,
  })
  assert.equal(blocked.enforced, true)

  const allowed = evaluateEbayPublishedAcquisitionPolicy({
    candidate: candidate({
      acquisitionIntent: "NEW_GENERATION",
      commercialGeneration: 2,
      authorizationId: "30000000-0000-4000-8000-000000000001",
    }),
    identities: [identity()],
    authorizations: [{
      id: "30000000-0000-4000-8000-000000000001",
      accountKey: account,
      marketplace: "EBAY_US",
      identityId: identity().id,
      action: "NEW_GENERATION",
      commercialGeneration: 2,
      status: "APPROVED",
      expiresAt: "2026-07-27T18:00:00.000Z",
    }],
    mode: "ENFORCE",
    now,
  })
  assert.equal(allowed.enforced, false)
  assert.equal(
    allowed.decision,
    "ALLOW_EXPLICIT_RELIST_OR_NEW_GENERATION",
  )
})

test("Same-Day integrates selection, carryover, claim, resume and replacement guards", async () => {
  const service = await readFile(
    "lib/ebay/ebay-same-day-pilot-service.ts",
    "utf8",
  )
  assert.match(service, /evaluateEbayPublishedAcquisitionPolicy/)
  assert.match(service, /published_acquisition_policy/)
  assert.match(service, /supersede_published_acquisition_candidate_v1/)
  assert.match(service, /RECONCILE_ALREADY_LISTED_CANDIDATES/)
  assert.match(service, /resumeSameDayPilotAfterProductResearchCapture/)
  assert.match(service, /promoteNextCandidate/)
  assert.match(service, /ebayWrites:\s*0/)
  assert.doesNotMatch(
    service.slice(
      service.indexOf("async function reconcileAlreadyListedSameDayCandidates"),
      service.indexOf("export async function confirmSameDayLuna"),
    ),
    /publishOffer|createOffer|createOrReplaceInventoryItem/,
  )
})

test("migration is additive, idempotent, service-role-only and rollback preserves audit", async () => {
  const [migration, rollback] = await Promise.all([
    readFile(
      "supabase/migrations/20260726132000_exclude_published_acquisition_candidates_v1.sql",
      "utf8",
    ),
    readFile(
      "supabase/rollback/20260726132000_exclude_published_acquisition_candidates_v1.down.sql",
      "utf8",
    ),
  ])
  assert.match(migration, /create table if not exists public\.ebay_published_acquisition_identities/)
  assert.match(migration, /create table if not exists public\.ebay_published_acquisition_exclusions/)
  assert.match(migration, /supersede_published_acquisition_candidate_v1/)
  assert.match(migration, /on conflict \(source_table, source_row_id\)/)
  assert.match(migration, /ALREADY_PUBLISHED_AND_MONITORED/)
  assert.match(migration, /SUPERSEDED_ALREADY_PUBLISHED/)
  assert.match(migration, /set status = 'SUPERSEDED'/)
  assert.match(migration, /set status = 'CANCELLED'/)
  assert.match(migration, /ebay_writes,\s*production_changed/)
  assert.match(migration, /0,\s*false/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /from public, anon, authenticated/)
  assert.match(migration, /to service_role/)
  assert.doesNotMatch(migration, /ITEM3155/i)
  assert.doesNotMatch(migration, /\bdelete\s+from\b|\btruncate\b/i)

  assert.match(rollback, /revoke execute/)
  assert.match(rollback, /audit history is intentionally retained/i)
  assert.doesNotMatch(
    rollback,
    /\bdelete\s+from\b|\btruncate\b|\bdrop\s+table\b/i,
  )
  assert.doesNotMatch(
    rollback,
    /update\s+public\.ebay_same_day_pilot_(candidates|jobs|human_tasks)/i,
  )
})
