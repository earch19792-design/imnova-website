import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(specifier)) {
    try { return nextResolve(`${specifier}.ts`, context) } catch {}
  }
  return nextResolve(specifier, context)
} })

const { canConfirmListingOwnerCandidateV1 } = await import(
  "./seller-os-listing-owner-review-v1.ts")

const candidate = { productId: "10211942072544", variantId: "54943494865120",
  sku: "ITEM-8058-RED-LU-DE", opportunityId: null,
  source: "CURRENT_LUNA_CATALOG_EXACT_SKU", preflightStatus: "PREFLIGHT_PASS" }
const base = { identityStatus: "MISSING_LUNA_IDENTITY",
  duplicateItemIds: [], candidates: [candidate],
  alreadyLinkedToOtherLiveItem: false, lastAction: null }

test("one exact current SKU is owner confirmable; conflicts fail closed", () => {
  assert.equal(canConfirmListingOwnerCandidateV1(base), true)
  assert.equal(canConfirmListingOwnerCandidateV1({ ...base,
    identityStatus: "AMBIGUOUS" }), false)
  assert.equal(canConfirmListingOwnerCandidateV1({ ...base,
    duplicateItemIds: ["366672502737"] }), false)
  assert.equal(canConfirmListingOwnerCandidateV1({ ...base,
    candidates: [candidate, { ...candidate, variantId: "2" }] }), false)
  assert.equal(canConfirmListingOwnerCandidateV1({ ...base,
    alreadyLinkedToOtherLiveItem: true }), false)
  assert.equal(canConfirmListingOwnerCandidateV1({ ...base,
    candidates: [{ ...candidate, preflightStatus: "UNKNOWN" }] }), false)
  assert.equal(canConfirmListingOwnerCandidateV1({ ...base,
    lastAction: { action: "REJECT_CANDIDATE",
      candidateProductId: candidate.productId,
      candidateVariantId: candidate.variantId } }), false)
})
