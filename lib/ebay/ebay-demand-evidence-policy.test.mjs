import assert from "node:assert/strict"
import test from "node:test"

import {
  EBAY_DEMAND_EVIDENCE_POLICY_VERSION,
  evaluateEbayDemandEvidencePolicy,
} from "./ebay-demand-evidence-policy.ts"

const now = "2026-07-26T18:00:00.000Z"
const enforced = { enabled: true, shadowMode: false, now }

function confirmed(overrides = {}) {
  return {
    evidenceClass: "CONFIRMED_SOLD_EXACT",
    officialEbaySource: true,
    reviewed: true,
    exactIdentity: true,
    samePack: true,
    sameVariant: true,
    sameCondition: true,
    observedAt: "2026-07-25T18:00:00.000Z",
    expiresAt: "2026-10-23T18:00:00.000Z",
    soldExactUnits: 3,
    soldExactSellerCount: 2,
    soldExactComparableCount: 2,
    ...overrides,
  }
}

test("only reviewed, exact, fresh official sold evidence validates demand", () => {
  const result = evaluateEbayDemandEvidencePolicy(confirmed(), enforced)
  assert.equal(result.policyVersion, EBAY_DEMAND_EVIDENCE_POLICY_VERSION)
  assert.equal(result.demandValidated, true)
  assert.equal(result.blockerCodes.length, 0)
  assert.deepEqual(
    [
      result.soldExactUnits,
      result.soldExactSellerCount,
      result.soldExactComparableCount,
    ],
    [3, 2, 2],
  )
})

for (const evidenceClass of [
  "OBSERVED_ESTIMATED_ROTATION",
  "POPULARITY_OR_RELATED",
  "ACTIVE_ONLY",
]) {
  test(`${evidenceClass} remains research-only`, () => {
    const result = evaluateEbayDemandEvidencePolicy(
      confirmed({ evidenceClass, soldExactUnits: 100 }),
      enforced,
    )
    assert.equal(result.demandValidated, false)
    assert.equal(result.researchEligible, true)
    assert.ok(
      result.blockerCodes.includes("CONFIRMED_SOLD_EXACT_REQUIRED"),
    )
  })
}

test("missing or invalid sold metrics fail closed as zero", () => {
  const result = evaluateEbayDemandEvidencePolicy(
    confirmed({
      soldExactUnits: undefined,
      soldExactSellerCount: Number.NaN,
      soldExactComparableCount: -1,
    }),
    enforced,
  )
  assert.equal(result.demandValidated, false)
  assert.deepEqual(
    [
      result.soldExactUnits,
      result.soldExactSellerCount,
      result.soldExactComparableCount,
    ],
    [0, 0, 0],
  )
})

test("stale, mismatched, or unreviewed evidence cannot validate", () => {
  const result = evaluateEbayDemandEvidencePolicy(
    confirmed({
      reviewed: false,
      samePack: false,
      sameVariant: false,
      sameCondition: false,
      expiresAt: now,
    }),
    enforced,
  )
  assert.equal(result.demandValidated, false)
  assert.ok(result.blockerCodes.includes("REVIEWED_EVIDENCE_REQUIRED"))
  assert.ok(result.blockerCodes.includes("SAME_PACK_REQUIRED"))
  assert.ok(result.blockerCodes.includes("SAME_VARIANT_REQUIRED"))
  assert.ok(result.blockerCodes.includes("SAME_CONDITION_REQUIRED"))
  assert.ok(result.blockerCodes.includes("FRESH_EVIDENCE_REQUIRED"))
})

test("shadow mode records the safe result but permits no advancement", () => {
  const result = evaluateEbayDemandEvidencePolicy(confirmed(), {
    enabled: true,
    shadowMode: true,
    now,
  })
  assert.equal(result.shadowDemandValidated, true)
  assert.equal(result.demandValidated, false)
  assert.equal(result.mode, "SHADOW")
  assert.ok(result.blockerCodes.includes("SHADOW_MODE_NO_ADVANCEMENT"))
})

test("disabled policy is fail-closed rather than falling back", () => {
  const result = evaluateEbayDemandEvidencePolicy(confirmed(), {
    enabled: false,
    shadowMode: true,
    now,
  })
  assert.equal(result.demandValidated, false)
  assert.equal(result.mode, "DISABLED_FAIL_CLOSED")
  assert.ok(result.blockerCodes.includes("POLICY_DISABLED_FAIL_CLOSED"))
})
