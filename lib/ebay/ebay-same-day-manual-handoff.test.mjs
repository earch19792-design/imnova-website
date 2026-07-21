import assert from "node:assert/strict"
import test from "node:test"

import { buildVerifiedManualSellerHubHandoff } from "./ebay-same-day-manual-handoff.ts"
import { buildOpenAiFactsInputPackage } from "./ebay-product-facts-readiness.ts"

function authoritativePackage(rows) {
  const facts = rows.map((fact, index) => ({
    factScope: fact.scope,
    factKey: fact.key,
    selectedValue: fact.value,
    selectedUnit: fact.unit ?? null,
    supportingObservationIds: [`observation-${index}`],
    supportingSourceTypes: fact.status === "DERIVED_VERIFIED"
      ? ["INTERNAL_DERIVATION"]
      : fact.scope === "SHIPPING_PACKAGE" ? ["LUNA_FULFILLMENT"] : ["LUNA_EXACT_VARIANT"],
    supportingSourceAuthorities: fact.scope === "SHIPPING_PACKAGE" ? ["FULFILLMENT"] : ["SUPPLIER"],
    conflictingObservationIds: [],
    resolutionRule: fact.status === "DERIVED_VERIFIED" ? "AUTHORIZED_DERIVATION" : "FIELD_AUTHORITY_MATRIX",
    confidence: .9,
    verificationStatus: fact.status,
    resolvedAt: "2026-07-18T12:00:00.000Z",
    resolverVersion: "TEST",
  }))
  return buildOpenAiFactsInputPackage({ facts, readiness: {
    gates: { OPENAI_INPUT_READY: true }, regulatory: { status: "NOT_APPLICABLE", blocking: false, missing: [] }, conflicted: false,
  } })
}

function baseResolvedFacts() {
  return [
    { scope: "PRODUCT_UNIT", key: "exactProductName", value: "Example Product", status: "VERIFIED" },
    { scope: "PRODUCT_UNIT", key: "brand", value: "Example", status: "VERIFIED" },
    { scope: "PRODUCT_UNIT", key: "condition", value: "New", status: "VERIFIED" },
    { scope: "PRODUCT_UNIT", key: "mpn", value: "M-1", status: "CORROBORATED" },
    { scope: "OFFER_PACK", key: "offerPackCount", value: 3, unit: "count", status: "VERIFIED" },
    { scope: "OFFER_PACK", key: "unitsPerPack", value: 1, unit: "count", status: "VERIFIED" },
    { scope: "OFFER_PACK", key: "totalUnitCount", value: 3, unit: "count", status: "DERIVED_VERIFIED" },
    ...["shippingWeight", "shippingLength", "shippingWidth", "shippingHeight"].map((key, index) => ({
      scope: "SHIPPING_PACKAGE", key, value: index ? 8 : 1.5, unit: index ? "in" : "lb", status: "VERIFIED",
    })),
  ]
}

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
      resolvedFacts: baseResolvedFacts(),
      authoritativeFactsPackage: authoritativePackage(baseResolvedFacts()),
      resolvedRequirements: [{ aspectName: "Brand", required: true, status: "SATISFIED_VERIFIED",
        mappedFactKey: "brand", selectedValue: "Example", allowedValues: ["Example"] }],
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
  assert.ok(result.package.qualityWarnings.includes("EBAY_FEE_PROFILE_ESTIMATE_NOT_EXACT"))
  assert.ok(result.package.operatorChecklist.some((item) => /tarifa estimada/i.test(item)))
})

test("preserves complete Taxonomy values and accepts semantic spacing", () => {
  const base = input()
  const result = buildVerifiedManualSellerHubHandoff(input({
    factsSummary: {
      ...base.factsSummary,
      resolvedRequirements: [{
        aspectName: "Brand", required: true, status: "SATISFIED_VERIFIED",
        mappedFactKey: "brand", selectedValue: "Example", allowedValues: ["Unbranded", "Example"],
      }, {
        aspectName: "Type", required: true, status: "SATISFIED_VERIFIED",
        mappedFactKey: "brand", selectedValue: "Example", allowedValues: ["Other", "Example"],
      }],
    },
  }))
  assert.equal(result.ready, true)
  assert.deepEqual(result.package.itemSpecifics.Brand, ["Example"])
})

test("controlled-risk handoff preserves 10% policy, disables promotion and warns about eBay protection", () => {
  const base = input()
  const result = buildVerifiedManualSellerHubHandoff(input({
    economics: {
      ...base.economics,
      controlledRiskOverride: {
        authorized: true,
        version: "EBAY_CONTROLLED_RISK_MANUAL_OVERRIDE_V1_2026_07_19",
        minimumNetMarginPercent: 10,
      },
    },
  }))
  assert.equal(result.ready, true)
  assert.equal(result.package.controlledRiskPolicy.minimumNetMarginPercent, 10)
  assert.equal(result.package.controlledRiskPolicy.promotion, "DO_NOT_PROMOTE")
  assert.equal(result.package.controlledRiskPolicy.ebayMoneyBackGuaranteeStillApplies, true)
  assert.equal(result.package.safety.promotedListingsAllowed, false)
  assert.ok(result.package.qualityWarnings.includes("PROMOTION_MUST_REMAIN_DISABLED"))
  assert.ok(result.package.operatorChecklist.some((item) => /No activar Promoted Listings/i.test(item)))
  assert.ok(result.package.operatorChecklist.some((item) => /Garantía al cliente de eBay/i.test(item)))
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
      authoritativeFactsPackage: authoritativePackage(base.factsSummary.resolvedFacts.filter((fact) => !fact.key.startsWith("shipping"))),
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
      authoritativeFactsPackage: authoritativePackage(base.factsSummary.resolvedFacts.filter((fact) => !fact.key.startsWith("shipping"))),
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

test("a positive conservative shipping reserve advances content while final shipping stays manual", () => {
  const base = input()
  const contentFacts = base.factsSummary.resolvedFacts.filter((fact) =>
    !fact.key.startsWith("shipping"))
  const result = buildVerifiedManualSellerHubHandoff(input({
    economics: {
      ...base.economics,
      config: { estimatedOutboundShipping: 6.99 },
    },
    factsSummary: {
      ...base.factsSummary,
      gates: { OPENAI_INPUT_READY: true, SHIPPING_ESTIMATE_READY: false,
        SHIPPING_CONFIRMED: false, PUBLICATION_FACTS_READY: false },
      resolvedFacts: contentFacts,
      authoritativeFactsPackage: authoritativePackage(contentFacts),
    },
  }))
  assert.equal(result.ready, true)
  assert.equal(result.package.publicationReadiness,
    "READY_FOR_MANUAL_SHIPPING_CONFIRMATION")
  assert.equal(result.package.shipping.conservativeEconomicReserveUsd, 6.99)
  assert.equal(result.package.shipping.operatorConfirmationRequired, true)
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
  const facts = base.factsSummary.resolvedFacts.map((fact) =>
    fact.key === "condition" ? { ...fact, value: "Used" } : fact)
  const result = buildVerifiedManualSellerHubHandoff(input({
    factsSummary: {
      ...base.factsSummary,
      resolvedFacts: facts,
      authoritativeFactsPackage: authoritativePackage(facts),
    },
  }))
  assert.equal(result.ready, false)
  assert.ok(result.blockers.includes("VERIFIED_CONDITION_ID_MAPPING_REQUIRED"))
})

test("competitor-only model, MPN and variant cannot enter the manual handoff through status-only summaries", () => {
  const base = input()
  const competitorClaims = [
    { scope: "PRODUCT_UNIT", key: "model", value: "COMPETITOR-MODEL", status: "CORROBORATED" },
    { scope: "PRODUCT_UNIT", key: "mpn", value: "COMPETITOR-MPN", status: "CORROBORATED" },
    { scope: "PRODUCT_UNIT", key: "variant", value: "COMPETITOR-VARIANT", status: "CORROBORATED" },
  ]
  const result = buildVerifiedManualSellerHubHandoff(input({
    factsSummary: {
      ...base.factsSummary,
      // This legacy/status-only projection is deliberately hostile. The final
      // boundary must ignore it and consume only authoritativeFactsPackage.
      resolvedFacts: [...base.factsSummary.resolvedFacts, ...competitorClaims],
      resolvedRequirements: [...base.factsSummary.resolvedRequirements,
        { aspectName: "Model", mappedFactKey: "model", required: false,
          status: "SATISFIED_CORROBORATED", selectedValue: "COMPETITOR-MODEL", allowedValues: [] },
        { aspectName: "MPN", mappedFactKey: "mpn", required: false,
          status: "SATISFIED_CORROBORATED", selectedValue: "COMPETITOR-MPN", allowedValues: [] }],
    },
  }))
  assert.equal(result.ready, true)
  const serialized = JSON.stringify(result.package)
  assert.doesNotMatch(serialized, /COMPETITOR-(?:MODEL|MPN|VARIANT)/)
  assert.equal(result.package.itemSpecifics.Model, undefined)
  assert.deepEqual(result.package.itemSpecifics.MPN, ["M-1"])
})

test("a forged or modified authoritative fact package is rejected at the manual boundary", () => {
  const base = input()
  const forged = structuredClone(base.factsSummary.authoritativeFactsPackage)
  forged.facts.push({ scope: "PRODUCT_UNIT", key: "model", value: "COMPETITOR-MODEL",
    unit: null, verificationStatus: "CORROBORATED",
    sourceTypes: ["EBAY_BROWSE_OFFICIAL_READONLY"], resolutionRule: "FIELD_AUTHORITY_MATRIX" })
  const result = buildVerifiedManualSellerHubHandoff(input({
    factsSummary: { ...base.factsSummary, authoritativeFactsPackage: forged },
  }))
  assert.equal(result.ready, false)
  assert.ok(result.blockers.includes("AUTHORITATIVE_FACT_PACKAGE_REQUIRED"))
})
