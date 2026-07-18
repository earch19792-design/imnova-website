import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  getLoop1DecisionExplanation,
  getLoop1PackageSaveDisabledReason,
  getLoop1WinnerAnalysisGate,
  verifyLoop1DecisionPackageReadback,
} from "./ebay-loop1-winner-analysis-ux.ts"
import {
  buildWinnerEvidenceDecisionPackage,
  verifyWinnerEvidenceDecisionPackageIntegrity,
} from "./ebay-winner-evidence-v2.ts"

const completeLunaCandidate = {
  supplierSku: "Alibaba-Series-BatterySwitchRED-B000K2MCR2",
  supplierVariantId: "48809645408480",
  variantTitle: "Default Title",
  productUrl: "https://lunaportex.com/products/9001e-e-series-battery-switch-selector-4-position-red",
  imageReference: "https://cdn.shopify.com/s/files/1/0798/2520/7520/files/qxmk.png?v=1781806404",
  lunaPrice: 16.05,
  stockQuantity: 27,
}

function decisionInput() {
  const identity = {
    manufacturerBrand: null,
    distributor: "Luna Portex",
    vendor: "Luna Warehouse",
    gtin: null,
    mpn: null,
    model: null,
    productName: "9001E e-Series Battery Switch, Selector 4 Position, Red",
    packCount: 1,
    unitCount: 1,
    color: "Red",
    variant: "Default Title",
    condition: "New",
  }
  return {
    marketplaceAccountKey: "seller:" + "a".repeat(64),
    candidateId: null,
    supplierSku: completeLunaCandidate.supplierSku,
    supplierVariantId: completeLunaCandidate.supplierVariantId,
    identity,
    supplierPackageCost: 16.05,
    packagingCost: null,
    outboundShippingCost: 6.99,
    fixedFulfillmentCost: null,
    authorizedKeywords: ["battery switch", "selector switch", "4 position", "red"],
    requiredKeywordCount: 4,
    stockAvailable: 27,
    stockObservedAt: "2026-07-16T22:05:37.638Z",
    costObservedAt: "2026-07-16T22:05:37.638Z",
    complianceBlocked: false,
    comparables: [{
      source: "EBAY_BROWSE_ACTIVE_LISTING",
      sourceListingId: "active-9001e-1",
      observedAt: "2026-07-16T22:10:00.000Z",
      identity,
      itemPrice: 39.99,
      shippingCost: 0,
      currency: "USD",
      keywords: ["battery switch", "selector switch"],
      evidenceReviewed: true,
    }, {
      source: "EBAY_BROWSE_ACTIVE_LISTING",
      sourceListingId: "active-9001e-2",
      observedAt: "2026-07-16T22:10:00.000Z",
      identity,
      itemPrice: 41.99,
      shippingCost: 0,
      currency: "USD",
      keywords: ["battery switch", "4 position"],
      evidenceReviewed: true,
    }],
    now: "2026-07-16T22:15:00.000Z",
  }
}

test("complete Luna candidate enables analysis only after stock, cost and image confirmations", () => {
  const before = getLoop1WinnerAnalysisGate(completeLunaCandidate, {
    stockConfirmed: false,
    costConfirmed: false,
    imageConfirmed: false,
  })
  assert.equal(before.mappingComplete, true)
  assert.equal(before.analysisEnabled, false)
  assert.deepEqual(before.pendingConfirmations, [
    "Falta confirmar stock",
    "Falta confirmar costo",
    "Falta confirmar imagen",
  ])
  const after = getLoop1WinnerAnalysisGate(completeLunaCandidate, {
    stockConfirmed: true,
    costConfirmed: true,
    imageConfirmed: true,
  })
  assert.equal(after.analysisEnabled, true)
  assert.equal(after.disabledReason, null)
})

test("incomplete Luna mapping is explicit and allows choosing another candidate", () => {
  const gate = getLoop1WinnerAnalysisGate({
    ...completeLunaCandidate,
    supplierSku: null,
    supplierVariantId: null,
    productUrl: null,
    imageReference: null,
  }, { stockConfirmed: true, costConfirmed: true, imageConfirmed: true })
  assert.equal(gate.mappingComplete, false)
  assert.ok(gate.missingMapping.includes("Falta URL Luna válida"))
  assert.ok(gate.missingMapping.includes("Falta SKU Luna"))
  assert.ok(gate.missingMapping.includes("Falta variante Luna"))
  assert.ok(gate.missingMapping.includes("Falta imagen Luna válida"))
})

test("disabled save action always explains the exact pending step", () => {
  assert.equal(getLoop1PackageSaveDisabledReason({
    analysisEnabled: false,
    analysisAvailable: false,
    saving: false,
  }), "Completa las confirmaciones requeridas antes de guardar")
  assert.equal(getLoop1PackageSaveDisabledReason({
    analysisEnabled: true,
    analysisAvailable: false,
    saving: false,
  }), "Ejecuta Analizar mercado eBay antes de guardar")
})

test("versioned decision package readback stays non-publishable", () => {
  const created = buildWinnerEvidenceDecisionPackage(decisionInput())
  const reloaded = structuredClone(created)
  assert.match(created.packageHash, /^sha256:[0-9a-f]{64}$/)
  assert.equal(verifyWinnerEvidenceDecisionPackageIntegrity(created), true)
  assert.equal(verifyLoop1DecisionPackageReadback(created, reloaded), true)
  assert.equal(reloaded.safety.canPublish, false)
  assert.equal(reloaded.safety.ebayWrites, 0)
  assert.equal(reloaded.decision.verdict, "NO_GO")
  assert.ok(reloaded.decision.blockers.includes("PRODUCT_IDENTITY_NOT_STRONG"))
  assert.equal(reloaded.economics.minimumSafePrice, null)
  assert.equal(reloaded.economics.targetPrice, null)
  const tampered = structuredClone(reloaded)
  tampered.packageHash = `sha256:${"f".repeat(64)}`
  assert.equal(verifyLoop1DecisionPackageReadback(created, tampered), false)
  assert.equal(verifyWinnerEvidenceDecisionPackageIntegrity(tampered), false)
})

test("Loop 1 UI is unified and excludes Commercial Monitor from its panel", () => {
  const page = readFileSync("app/admin/ebay/mobile-review/page.tsx", "utf8")
  const summary = readFileSync(
    "app/admin/ebay/mobile-review/loop1-winner-analysis-summary.tsx",
    "utf8",
  )
  const route = readFileSync("app/api/admin/ebay/winner-evidence-v2/route.ts", "utf8")
  const service = readFileSync("lib/ebay/ebay-winner-evidence-v2-service.ts", "utf8")
  assert.match(page, /Producto en revisión/)
  assert.match(page, /journeyStep === 2/)
  assert.match(page, /journeyStep === 3/)
  assert.match(page, /journeyStep === 4/)
  assert.match(page, /ACTIVE LOOP/)
  assert.match(page, /BACKGROUND MONITOR/)
  assert.match(page, /Verificar mercado en eBay/)
  assert.match(page, /Falta confirmar stock/)
  assert.match(page, /Falta confirmar costo/)
  assert.match(page, /Falta confirmar imagen/)
  assert.match(page, /manufacturerBrand: null/)
  assert.match(page, /supplierVendor: selectedRadarCandidate\.brand/)
  assert.match(summary, /Comparables activos exactos/)
  assert.match(summary, /Vendidos\/completados exactos/)
  assert.match(summary, /Señales estimadas separadas/)
  assert.match(summary, /Patrones visuales del mercado/)
  assert.match(summary, /Estrategia original de seis imágenes/)
  assert.match(summary, /Guardar paquete de decisión/)
  assert.doesNotMatch(summary, /CommercialMonitorPanel|commercial-monitor/i)
  assert.match(route, /marketplaceAccountKey: accountKey/)
  assert.match(route, /readWinnerEvidenceDecisionPackage/)
  assert.match(service, /WINNER_EVIDENCE_PACKAGE_INTEGRITY_MISMATCH/)
  assert.match(service, /openAiCalls: 0/)
  assert.match(service, /imagesGenerated: 0/)
  assert.match(service, /draftsCreated: 0/)
  assert.match(service, /publicationsCreated: 0/)
  assert.doesNotMatch(route, /manufacturerBrand: candidate\.supplierVendor/)
  assert.doesNotMatch(`${page}\n${summary}\n${route}`, /OPENAI_API_KEY|publishOffer|shipping_fulfillment/)
})

test("Spanish verdict explanation is simple and never promises sales", () => {
  const explanation = getLoop1DecisionExplanation({
    decision: {
      verdict: "GO_WITH_CHANGES",
      blockers: [],
      evidenceSufficientForGo: false,
      evidenceSufficientForConditionalGo: true,
      recommendedAction: "REVIEW_REQUIRED_CHANGES_BEFORE_LISTING_FACTORY",
      humanApprovalRequired: true,
    },
  })
  assert.match(explanation, /puede ser viable/i)
  assert.doesNotMatch(explanation, /garantiza|ventas seguras/i)
})
