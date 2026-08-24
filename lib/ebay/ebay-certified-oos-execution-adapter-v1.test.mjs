import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  preflightCertifiedOosExecutionV1,
  SELLER_OS_CERTIFIED_OOS_MARKETPLACE_OPERATION_V1,
} from "./ebay-certified-oos-execution-adapter-v1.ts"
import { endActiveListingOutOfStockRequestXml } from
  "./ebay-commercial-improvement-action-domain.ts"

const ITEM_ID = "366569086086"
const SKU = "IMN-LST-000001"
const SOURCE = "LUNA_PORTEX_PUBLIC_EXACT_PRODUCT_STOCK"

function listing(overrides = {}) {
  const value = {
    identity: {
      itemId: ITEM_ID,
      sku: SKU,
      listedQuantity: 2,
      marketplaceCertification: { status: "US_CERTIFIED" },
    },
    discovery: { livePresence: { status: "LIVE_ACTIVE" } },
    composition: {
      status: "AVAILABLE",
      components: [{ componentId: "component-1", supplierSku: "ITEM3752",
        quantityRequired: 1, evidenceReferences: [] }],
      limitingComponentId: "component-1",
      bundleCapacity: {
        value: 0,
        availability: "AVAILABLE",
        completeness: "COMPLETE",
        explicitAuthoritativeZero: true,
        source: { system: SOURCE },
      },
    },
    stock: {
      state: "CERTIFIED_OOS",
      sourceContractStatus: "HEALTHY",
      supplierLinkageStatus: "CERTIFIED",
      freshness: { status: "FRESH" },
      quantity: { source: { system: SOURCE } },
    },
    experiment: { status: "MISSING", commercialAction: "HUMAN_REVIEW_ONLY" },
  }
  return Object.assign(value, overrides)
}

function monitor(target = listing()) {
  return {
    listings: [target],
    alertCandidates: [{
      reasonCode: "COMPONENT_OUT_OF_STOCK_CONFIRMED",
      severity: "CRITICAL",
      listingReference: { scope: "LISTING", itemId: ITEM_ID, sku: SKU },
      supportingEvidence: [{ reference: "evidence-1" }],
      candidateOnly: true,
      dispatchAllowed: false,
    }],
    liveCertification: {
      status: "CERTIFIED",
      marketplaceId: "EBAY_US",
      account: { bindingConfigured: true, bindingMatched: true },
      oauth: { status: "AVAILABLE", tokenReceived: true },
      safety: { marketplaceWrites: 0 },
    },
  }
}

function preflight(input = monitor()) {
  return preflightCertifiedOosExecutionV1({ monitor: input,
    targetItemId: ITEM_ID, targetSku: SKU, operatorAuthorized: true })
}

test("A certified single-product OOS is eligible", () => {
  assert.equal(preflight().executionEligible, true)
})

test("B certified bundle mandatory component OOS is eligible", () => {
  const target = listing()
  target.composition.components.push({ componentId: "component-2",
    supplierSku: "FL-WF01-BLK", quantityRequired: 1,
    evidenceReferences: [] })
  const result = preflight(monitor(target))
  assert.equal(result.executionEligible, true)
  assert.equal(result.compositionComplete, true)
})

test("C missing legacy Luna fields do not block a certified bundle", () => {
  const result = preflight()
  assert.equal(result.legacyLunaFieldsRequired, false)
  assert.equal(result.executionEligible, true)
})

test("D absent legacy commercial event does not block canonical OOS", () => {
  const result = preflight()
  assert.equal(result.legacyCommercialAlertEventRequired, false)
  assert.equal(result.executionEligible, true)
})

test("E UNPROVEN linkage is blocked", () => {
  const target = listing()
  target.stock.supplierLinkageStatus = "UNPROVEN"
  const result = preflight(monitor(target))
  assert.equal(result.executionEligible, false)
  assert.ok(result.blockerCodes.includes(
    "CERTIFIED_OOS_SUPPLIER_LINKAGE_REQUIRED"))
})

test("F STOCK_UNKNOWN is blocked", () => {
  const target = listing()
  target.stock.state = "STOCK_UNKNOWN"
  assert.ok(preflight(monitor(target)).blockerCodes.includes(
    "CERTIFIED_OOS_STOCK_STATE_REQUIRED"))
})

test("G stale stock evidence is blocked", () => {
  const target = listing()
  target.stock.freshness.status = "STALE"
  assert.ok(preflight(monitor(target)).blockerCodes.includes(
    "CERTIFIED_OOS_FRESH_EVIDENCE_REQUIRED"))
})

test("H unhealthy source is blocked", () => {
  const target = listing()
  target.stock.sourceContractStatus = "UNPROVEN"
  assert.ok(preflight(monitor(target)).blockerCodes.includes(
    "CERTIFIED_OOS_SOURCE_HEALTH_REQUIRED"))
})

test("I unknown safe capacity is blocked", () => {
  const target = listing()
  target.composition.bundleCapacity.value = null
  assert.ok(preflight(monitor(target)).blockerCodes.includes(
    "CERTIFIED_OOS_SAFE_CAPACITY_REQUIRED"))
})

test("J nonzero safe capacity is blocked", () => {
  const target = listing()
  target.composition.bundleCapacity.value = 1
  assert.ok(preflight(monitor(target)).blockerCodes.includes(
    "CERTIFIED_OOS_SAFE_CAPACITY_REQUIRED"))
})

test("J2 zero without explicit authoritative evidence is blocked", () => {
  const target = listing()
  target.composition.bundleCapacity.explicitAuthoritativeZero = false
  assert.ok(preflight(monitor(target)).blockerCodes.includes(
    "CERTIFIED_OOS_EXPLICIT_AUTHORITATIVE_ZERO_REQUIRED"))
})

test("K SKU identity mismatch is blocked", () => {
  const target = listing()
  target.identity.sku = "IMN-LST-OTHER"
  assert.ok(preflight(monitor(target)).blockerCodes.includes(
    "CERTIFIED_OOS_TARGET_IDENTITY_MISMATCH"))
})

test("L non-live listing needs no marketplace mutation", () => {
  const target = listing()
  target.discovery.livePresence.status = "NOT_CURRENT_LIVE"
  const result = preflight(monitor(target))
  assert.equal(result.status, "NO_MUTATION_REQUIRED")
  assert.equal(result.mutationRequired, false)
})

test("M unrelated listing cannot be targeted", () => {
  const target = listing()
  target.identity.itemId = "366569086087"
  const result = preflight(monitor(target))
  assert.equal(result.executionEligible, false)
  assert.ok(result.blockerCodes.includes("CERTIFIED_OOS_TARGET_NOT_FOUND"))
})

test("N preflight performs no eBay write", () => {
  const result = preflight()
  assert.equal(result.safety.preflightOnly, true)
  assert.equal(result.safety.ebayWrites, 0)
})

test("O preflight performs no database, Luna or WhatsApp write", () => {
  const result = preflight()
  assert.deepEqual({ databaseWrites: result.safety.databaseWrites,
    lunaWrites: result.safety.lunaWrites,
    whatsappSends: result.safety.whatsappSends },
  { databaseWrites: 0, lunaWrites: 0, whatsappSends: 0 })
})

test("P adapter reuses the existing END_LISTING Trading operation", () => {
  assert.deepEqual(SELLER_OS_CERTIFIED_OOS_MARKETPLACE_OPERATION_V1, {
    actionType: "END_LISTING",
    tradingCall: "EndFixedPriceItem",
    endingReason: "NotAvailable",
  })
  const xml = endActiveListingOutOfStockRequestXml({ listingId: ITEM_ID })
  assert.match(xml, /<EndFixedPriceItemRequest/)
  assert.match(xml, /<EndingReason>NotAvailable<\/EndingReason>/)
  const existingService = readFileSync(new URL(
    "./ebay-commercial-improvement-action-service.ts", import.meta.url), "utf8")
  assert.match(existingService,
    /executeCertifiedOosProtectionV1[\s\S]*await endListingOutOfStock/)
  assert.match(existingService,
    /executeCertifiedOosProtectionV1[\s\S]*readManualListingFromTradingApi/)
})
