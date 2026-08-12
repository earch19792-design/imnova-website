import assert from "node:assert/strict"
import test from "node:test"

import {
  assessProductCaseOperationalReadinessV1,
  assessStockGuardV2,
  calculateCommercialEconomicsV1,
  captureLunaProductVariantV1,
  linkSupplierToEbayIdentityV1,
} from "./ebay-commercial-operational-readiness-v1.ts"

const captureInput = (overrides = {}) => ({
  sourceContractVersion: "LUNA_SOURCE_CONTRACT_V1", parserVersion: "parser-v1",
  sourceUrl: "https://lunaportex.com/products/example", productId: "p1", supplierSku: "S1",
  variantId: "v1", supplierTitle: "Example", variantTitle: "Blue", regularPrice: 12,
  salePrice: 10, currency: "USD", availability: true, visibleStock: 5,
  stockQuantityAuthoritative: true, explicitLowStock: false, stockTextEvidence: "Available",
  specifications: { Material: "Steel" }, packQuantity: 1, includedQuantity: 1,
  sourceNarrative: "Product facts", marketingClaims: ["Best ever"], imageReferences: [],
  observedAt: "2026-08-11T12:00:00.000Z", ...overrides,
})

const exactLink = () => linkSupplierToEbayIdentityV1({ accountKey: "acct", ebayItemId: "123456789012",
  ebaySku: "E1", supplierProductId: "p1", supplierSku: "S1", supplierVariantId: "v1",
  evidenceType: "EXPLICIT_APPROVED_MAPPING", observedAt: "2026-08-11T12:00:00.000Z",
  provenance: "HUMAN_APPROVED_MAPPING" })

test("Luna capture requires explicit stock evidence and detects source changes", () => {
  assert.equal(captureLunaProductVariantV1(captureInput({ availability: null, visibleStock: null,
    stockQuantityAuthoritative: false }), { now: "2026-08-11T13:00:00.000Z" }).stock.state,
  "STOCK_UNKNOWN")
  assert.equal(captureLunaProductVariantV1(captureInput({ availability: false }),
    { now: "2026-08-11T13:00:00.000Z" }).stock.state, "OUT_OF_STOCK_CONFIRMED")
  assert.equal(captureLunaProductVariantV1(captureInput({ sourceContractVersion: "changed" }),
    { now: "2026-08-11T13:00:00.000Z" }).sourceHealth, "SOURCE_CHANGED")
  assert.equal(captureLunaProductVariantV1(captureInput({ observedAt: "2026-08-01T00:00:00Z" }),
    { now: "2026-08-11T13:00:00.000Z" }).stock.state, "STALE_EVIDENCE")
})

test("supplier automatic reconciliation requires explicit exact identity", () => {
  assert.equal(exactLink().classification, "EXACT_PROVEN")
  assert.equal(linkSupplierToEbayIdentityV1({ accountKey: "acct", ebayItemId: "123456789012",
    ebaySku: "E1", supplierProductId: "p1", supplierSku: "S1", supplierVariantId: "v1",
    evidenceType: "SKU_EXACT_ONLY", observedAt: "2026-08-11T12:00:00Z",
    provenance: "SKU_ONLY" }).classification, "STRONG_CANDIDATE_HUMAN_REVIEW")
  assert.equal(linkSupplierToEbayIdentityV1({ accountKey: "acct", ebayItemId: "123456789012",
    ebaySku: "E1", supplierProductId: "p1", supplierSku: "S1", supplierVariantId: "v1",
    evidenceType: "TITLE_SIMILARITY_ONLY", observedAt: "2026-08-11T12:00:00Z",
    provenance: "TITLE" }).classification, "UNPROVEN")
  assert.equal(linkSupplierToEbayIdentityV1({ accountKey: "acct", ebayItemId: "123456789012",
    ebaySku: "E1", supplierProductId: "p1", supplierSku: null, supplierVariantId: "v1",
    evidenceType: "EXPLICIT_APPROVED_MAPPING", observedAt: "2026-08-11T12:00:00Z",
    provenance: "HUMAN" }).classification, "UNPROVEN")
})

test("Stock Guard separates unknown, stale, out, low and proven oversell", () => {
  const base = { listing: { ebayItemId: "123456789012", publishedQuantity: 8, live: true },
    link: exactLink(), supplierCapture: captureLunaProductVariantV1(captureInput(),
      { now: "2026-08-11T13:00:00.000Z" }) }
  assert.equal(assessStockGuardV2(base).riskClass, "OVERSELL_RISK")
  assert.equal(assessStockGuardV2({ ...base, supplierCapture: captureLunaProductVariantV1(
    captureInput({ availability: null, visibleStock: null, stockQuantityAuthoritative: false }),
    { now: "2026-08-11T13:00:00.000Z" }) }).riskClass, "STOCK_UNKNOWN")
  assert.equal(assessStockGuardV2({ ...base, bundleComponents: [{ componentId: "c1",
    unitsPerSale: null, availableUnits: 20, authoritative: false }] }).safeSellableCapacity, null)
})

test("proven stock hard override pauses an active experiment without marketplace mutation", () => {
  const capture = captureLunaProductVariantV1(captureInput({ availability: false }),
    { now: "2026-08-11T13:00:00.000Z" })
  const result = assessStockGuardV2({ listing: { ebayItemId: "123456789012",
    publishedQuantity: 1, live: true }, link: exactLink(), supplierCapture: capture,
    experimentActive: true })
  assert.equal(result.hardOverrideState, "HARD_OVERRIDE")
  assert.equal(result.experimentOperationalAction, "PAUSE_FOR_EXTERNAL_SIGNAL")
  assert.equal(result.ebayMutationAllowed, false)
})

test("economics never defaults missing costs to zero", () => {
  assert.equal(calculateCommercialEconomicsV1({ revenue: { value: 50, currency: "USD",
    source: "EBAY", observedAt: "2026-08-11T12:00:00Z", inputReference: "r" } }).status,
  "INSUFFICIENT_EVIDENCE")
  const evidence = (value, ref) => ({ value, currency: "USD", source: "PROVEN",
    observedAt: "2026-08-11T12:00:00Z", inputReference: ref })
  const result = calculateCommercialEconomicsV1({ revenue: evidence(50, "r"),
    supplierCost: evidence(15, "s"), shippingCost: evidence(5, "h"),
    ebayFees: evidence(7, "e"), promotedFees: evidence(0, "p") })
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.netProfit.value, 23)
  assert.equal(result.missingInputsDefaultedToZero, false)
})

test("Product Case stays paused with certified external limitations", () => {
  const result = assessProductCaseOperationalReadinessV1({ marketResearchReady: true,
    supplierCaptureReady: true, supplierIdentityReady: false, stockGuardReady: true,
    economicsReady: false, qualityReportReady: false, ordersReady: false,
    whatsappDryRunReady: true, experimentOverrideReady: true })
  assert.equal(result.productCaseOperationalReadiness, "READY_WITH_CERTIFIED_EXTERNAL_LIMITATIONS")
  assert.equal(result.productCaseResumed, false)
})
