import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { buildCommercialDecisionLoopSnapshotV1_1,
  executeCommercialDecisionLoopV1_1 } from
  "./seller-os-commercial-decision-loop-v1-1.ts"

function ready(overrides = {}) {
  return { analysisComplete: true,
    finalDecision: "ADVANCE_TO_OWNER_COMMERCIAL_REVIEW",
    productTruthSufficient: true, safeClaimsPresent: true, stockValid: true,
    shippingQty1Fresh: true, marketAuthoritySufficient: true,
    pricingAuthoritySufficient: true, economicsPass: true,
    primaryKeywordComplete: true, titleComplete: true,
    itemSpecificsComplete: true, imagesValid: true, complianceClear: true,
    ipClear: true, listingPackageId: "pkg-1", ...overrides }
}

test("AUTO_PUBLISH=false stops at listing package with an Owner CTA", () => {
  const result = buildCommercialDecisionLoopSnapshotV1_1(ready())
  assert.equal(result.state, "LISTING_PACKAGE_READY")
  assert.equal(result.ownerCta?.label, "Publicar producto")
  assert.equal(result.publicationWritesPerformed, 0)
  assert.equal(result.purchaseAllowed, false)
})

test("publication readiness fails closed on every missing prerequisite", () => {
  const result = buildCommercialDecisionLoopSnapshotV1_1(ready({
    imagesValid: false, pricingAuthoritySufficient: false,
  }))
  assert.equal(result.state, "HOLD")
  assert.deepEqual(result.blockers, ["PRICING_AUTHORITY_SUFFICIENT",
    "IMAGES_VALID"])
})

test("AUTO_PUBLISH=true uses injected preflight, publisher and readback", async () => {
  const calls = []
  const result = await executeCommercialDecisionLoopV1_1({ ...ready({
    autoPublish: true }), publicationWritesEnabled: true,
    preflight: async () => { calls.push("preflight"); return { passed: true } },
    publish: async () => { calls.push("publish"); return { itemId: "123456789012" } },
    readback: async (itemId) => { calls.push(`readback:${itemId}`)
      return { verified: true } },
  })
  assert.deepEqual(calls, ["preflight", "publish",
    "readback:123456789012"])
  assert.equal(result.state, "READBACK_VERIFIED")
  assert.equal(result.ebayWritesPerformed, 1)
})

test("certification boundary never calls publish when writes are disabled", async () => {
  let publishCalls = 0
  const result = await executeCommercialDecisionLoopV1_1({ ...ready({
    autoPublish: true }), publicationWritesEnabled: false,
    preflight: async () => ({ passed: true }),
    publish: async () => { publishCalls += 1; return { itemId: "unsafe" } },
    readback: async () => ({ verified: true }),
  })
  assert.equal(result.state, "HOLD")
  assert.equal(publishCalls, 0)
  assert.ok(result.blockers.includes("PUBLICATION_WRITES_DISABLED"))
})

test("AUTO mode is wired only to the current canonical publisher", async () => {
  const adapter = await readFile(new URL(
    "./seller-os-commercial-decision-loop-server-v1-1.ts", import.meta.url),
  "utf8")
  assert.match(adapter, /certifyCurrentPrepublicationV1/)
  assert.match(adapter, /publishCurrentRevisionV1/)
  assert.match(adapter, /OFFICIAL_READBACK_PASS/)
  assert.doesNotMatch(adapter, /publishEbayOfferOnce/)
})
