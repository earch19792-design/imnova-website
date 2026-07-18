import assert from "node:assert/strict"
import test from "node:test"

import { buildVerifiedManualSellerHubHandoff } from "./ebay-same-day-manual-handoff.ts"

function input(overrides = {}) {
  return {
    candidateId: "candidate-1", factRunId: "fact-run-1", productTitle: "Example Product",
    supplierSku: "ITEM-1", listingQuantity: 1, salePrice: 29.99,
    fulfillmentBasis: "OWNED_INVENTORY",
    economics: { operatorPriceApproved: true, passesProfitGate: true,
      lunaConfirmation: { status: "AVAILABLE_EXACT_QUANTITY", source: "OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE",
        confirmedAt: "2026-07-18T12:00:00.000Z", quantityVisible: true, confirmedQuantity: 20,
        recheckAfterSale: false } },
    factsSummary: {
      currentRunBound: true, factRunId: "fact-run-1",
      gates: { OPENAI_INPUT_READY: true, SHIPPING_ESTIMATE_READY: true, SHIPPING_CONFIRMED: true, PUBLICATION_FACTS_READY: true },
      taxonomy: { categoryId: "11860" },
      resolvedFacts: [
        { scope: "PRODUCT_UNIT", key: "exactProductName", value: "Example Product", status: "VERIFIED" },
        { scope: "PRODUCT_UNIT", key: "brand", value: "Example", status: "VERIFIED" },
        { scope: "PRODUCT_UNIT", key: "condition", value: "New", status: "VERIFIED" },
        { scope: "PRODUCT_UNIT", key: "mpn", value: "M-1", status: "CORROBORATED" },
        { scope: "OFFER_PACK", key: "totalUnitCount", value: 3, unit: "count", status: "DERIVED_VERIFIED" },
        ...["shippingWeight", "shippingLength", "shippingWidth", "shippingHeight"].map((key, index) => ({
          scope: "SHIPPING_PACKAGE", key, value: index ? 8 : 1.5, unit: index ? "in" : "lb", status: "VERIFIED",
        })),
      ],
      resolvedRequirements: [{ aspectName: "Brand", required: true, status: "SATISFIED_VERIFIED",
        selectedValue: "Example", allowedValues: ["Example"] }],
    },
    lunaImageUrls: ["https://cdn.example.com/luna-product.jpg"],
    policies: { categoryId: "11860", conditionId: "1000", fulfillmentPolicyId: "F1",
      paymentPolicyId: "P1", returnPolicyId: "R1", verifiedSourceAt: "2026-07-18T12:00:00.000Z" },
    generatedAt: "2026-07-18T12:00:00.000Z",
    ...overrides,
  }
}

test("builds an original facts-only Seller Hub package with operator price and zero writes", () => {
  const result = buildVerifiedManualSellerHubHandoff(input())
  assert.equal(result.ready, true)
  assert.ok(result.packageHash)
  assert.ok(result.package.title.length <= 80)
  assert.equal(result.package.price, 29.99)
  assert.equal(result.package.customLabel, "ITEM-1")
  assert.equal(result.package.fulfillmentCompliance.basis, "OWNED_INVENTORY")
  assert.equal(result.package.fulfillmentCompliance.documentsStored, false)
  assert.equal(result.package.fulfillmentCompliance.piiStored, false)
  assert.equal(result.package.supplierConfirmation.status, "AVAILABLE_EXACT_QUANTITY")
  assert.equal(result.package.supplierConfirmation.ebayConfirmedSupplierStock, false)
  assert.equal(result.package.images.source, "LUNA_AUTHORIZED_CATALOG")
  assert.equal(result.package.safety.openAiCalls, 0)
  assert.equal(result.package.safety.ebayWrites, 0)
  assert.equal(result.package.safety.automaticPricingUsed, false)
  assert.equal(result.package.safety.competitorContentUsed, false)
  assert.equal(result.package.publicationReadiness, "READY_WITH_CONFIRMED_SHIPPING")
})

test("blocks a Seller Hub handoff without an attested compliant fulfillment basis", () => {
  const result = buildVerifiedManualSellerHubHandoff(input({
    fulfillmentBasis: null,
  }))
  assert.equal(result.ready, false)
  assert.ok(result.blockers.includes("COMPLIANT_FULFILLMENT_BASIS_REQUIRED"))
  assert.equal(result.safety.ebayWrites, 0)
})

test("blocks when Luna availability was not confirmed by the operator", () => {
  const result = buildVerifiedManualSellerHubHandoff(input({
    economics: { operatorPriceApproved: true, passesProfitGate: true },
  }))
  assert.equal(result.ready, false)
  assert.ok(result.blockers.includes("OPERATOR_LUNA_CONFIRMATION_REQUIRED"))
})

test("blocks when no shipping estimate, required aspects, images or operator economics are available", () => {
  const base = input()
  const result = buildVerifiedManualSellerHubHandoff(input({
    salePrice: 0,
    economics: { operatorPriceApproved: false, passesProfitGate: false },
    lunaImageUrls: [],
    factsSummary: {
      ...base.factsSummary,
      gates: { OPENAI_INPUT_READY: false, SHIPPING_ESTIMATE_READY: false, PUBLICATION_FACTS_READY: false },
      resolvedFacts: base.factsSummary.resolvedFacts.filter((fact) => fact.key !== "shippingHeight"),
      resolvedRequirements: [{ aspectName: "Brand", required: true, status: "MISSING_BLOCKING", selectedValue: null, allowedValues: [] }],
    },
  }))
  assert.equal(result.ready, false)
  assert.ok(result.blockers.includes("VERIFIED_CONTENT_FACTS_NOT_READY"))
  assert.ok(result.blockers.includes("SHIPPING_ESTIMATE_REQUIRED"))
  assert.ok(result.blockers.includes("AUTHORIZED_LUNA_IMAGE_REQUIRED"))
  assert.ok(result.blockers.includes("OPERATOR_PRICE_AND_ECONOMICS_REQUIRED"))
  assert.ok(result.blockers.some((blocker) => blocker.startsWith("REQUIRED_ASPECT_BRAND")))
  assert.equal(result.safety.openAiCalls, 0)
  assert.equal(result.safety.ebayWrites, 0)
})

test("recommended aspects and unconfirmed shipping dimensions become visible warnings instead of false hard gates", () => {
  const base = input()
  const result = buildVerifiedManualSellerHubHandoff(input({
    factsSummary: {
      ...base.factsSummary,
      gates: { OPENAI_INPUT_READY: true, SHIPPING_ESTIMATE_READY: true, SHIPPING_CONFIRMED: false,
        PUBLICATION_FACTS_READY: false },
      resolvedFacts: base.factsSummary.resolvedFacts.filter((fact) => !fact.key.startsWith("shipping")),
      resolvedRequirements: [...base.factsSummary.resolvedRequirements,
        { aspectName: "Material", required: false, status: "MISSING_OPTIONAL", selectedValue: null, allowedValues: [] }],
    },
  }))
  assert.equal(result.ready, true)
  assert.equal(result.package.publicationReadiness, "READY_FOR_MANUAL_SHIPPING_CONFIRMATION")
  assert.equal(result.package.shipping.estimatedValuesExcluded, true)
  assert.equal(result.package.shipping.operatorConfirmationRequired, true)
  assert.ok(result.warnings.includes("SHIPPING_CONFIRMATION_REQUIRED_IN_SELLER_HUB"))
  assert.ok(result.warnings.includes("OPTIONAL_ASPECT_MISSING_MATERIAL"))
})

test("condition fact New maps to eBay 1000 and rejects a mismatched reusable default", () => {
  const compatible = buildVerifiedManualSellerHubHandoff(input())
  assert.equal(compatible.ready, true)
  assert.equal(compatible.package.conditionId, "1000")
  assert.equal(compatible.package.conditionLabel, "New")

  const mismatched = buildVerifiedManualSellerHubHandoff(input({
    policies: { ...input().policies, conditionId: "1500" },
  }))
  assert.equal(mismatched.ready, false)
  assert.ok(mismatched.blockers.includes("CONDITION_ID_FACT_MISMATCH"))
})

test("an unmapped condition never guesses an eBay condition ID", () => {
  const base = input()
  const result = buildVerifiedManualSellerHubHandoff(input({
    factsSummary: {
      ...base.factsSummary,
      resolvedFacts: base.factsSummary.resolvedFacts.map((fact) =>
        fact.key === "condition" ? { ...fact, value: "Used" } : fact),
    },
  }))
  assert.equal(result.ready, false)
  assert.ok(result.blockers.includes("VERIFIED_CONDITION_ID_MAPPING_REQUIRED"))
})
