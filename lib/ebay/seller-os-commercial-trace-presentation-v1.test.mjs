import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { buildCommercialTracePresentationV1, humanCommercialCodeV1,
  humanComparableReasonV1, humanConflictExplanationV1 } from
  "./seller-os-commercial-trace-presentation-v1.ts"

const result = {
  FINAL_DECISION: "HOLD_DEMAND_UNPROVEN",
  CONFIDENCE: "LOW",
  PRODUCT_TRUTH: { title: "1080P Webcam QX900", supplierSku: "ITEM-9",
    model: "QX900", gtin: "012345678905", variantTitle: "Black" },
  SAFE_CLAIM_SUBSET: [
    { kind: "PRODUCT_IDENTITY", value: "Webcam" },
    { kind: "SPECIFICATION", value: "1080P" },
    { kind: "FUNCTIONAL_DIFFERENTIATOR", value: "Built-In Speakers" },
    { kind: "FUNCTIONAL_DIFFERENTIATOR", value: "Microphone" },
    { kind: "MODEL", value: "QX900" },
  ],
  DO_NOT_USE_CLAIMS: [{ value: "2K" }],
  CLAIM_CONFLICTS: [{ code: "CONFLICTING_VIDEO_RESOLUTION_CLAIMS",
    evidence: "1080P and 2K" }],
  PRODUCT_COST: 10,
  SHIPPING_QTY1: 5,
  LANDED_COST: 15,
  STOCK: { available: true, quantity: 4 },
  EXACT_MODEL_SEARCH_QUERY: "webcam qx900",
  FUNCTIONAL_SEARCH_QUERY: "1080P Webcam with Speakers and Microphone",
  PRIMARY_KEYWORD_FAMILY: "1080P Webcam with Speakers and Microphone",
  SECONDARY_KEYWORDS: ["usb webcam microphone"],
  PRICE_RANGE: { minimum: 20, median: 25, maximum: 30 },
  RECOMMENDED_PRICE: null,
  MINIMUM_MARGIN_SAFE_PRICE: 32,
  ACCEPTED_COMPARABLES: [
    { comparableId: "v1|100000000001|0", title: "QX900 Webcam",
      comparableClass: "EXACT_MODEL_COMPARABLE", confirmedSoldQuantity: 1,
      estimatedSoldQuantity: 3, soldHistorySource: "CONFIRMED_DURABLE_SOLD" },
    { comparableId: "v1|100000000002|0", title: "1080P Speaker Webcam",
      comparableClass: "FUNCTIONAL_COMPARABLE", confirmedSoldQuantity: 0,
      estimatedSoldQuantity: 5, soldHistorySource: "BROWSE_ESTIMATED_SOLD" },
  ],
  EXCLUDED_COMPARABLES: [
    { comparableId: "v1|100000000003|0", title: "Other model",
      comparableClass: "NON_COMPARABLE",
      rejectionReason: "STRUCTURED_MODEL_CONFLICT" },
  ],
  EXACT_MODEL_ACCEPTED: [{ comparableId: "v1|100000000001|0" }],
  FUNCTIONAL_ACCEPTED: [{ comparableId: "v1|100000000002|0" }],
  KNOWN_UNCERTAINTIES: ["DEMAND_NOT_PROVEN"],
  COMPLIANCE: { status: "REVIEW_REQUIRED" },
}

const events = [
  { sequence: 1, stage: "PRODUCT_TRUTH", status: "PASS",
    narrative: "Producto identificado.", observed_at: "2026-09-13T12:00:00Z",
    evidence: { source: "LUNA_PUBLIC_READ_ONLY_PRODUCT_JSON" } },
  { sequence: 2, stage: "SHIPPING_QTY1", status: "PASS",
    narrative: "Shipping confirmado.", observed_at: "2026-09-13T12:00:01Z",
    evidence: { amountUsd: 5, reusedDurableEvidence: true } },
  { sequence: 3, stage: "MARKET_SEARCH_PROGRESS", status: "PASS",
    narrative: "Mercado leído.", observed_at: "2026-09-13T12:00:02Z",
    evidence: { candidateFoundCount: 342, returnedCandidateCount: 50,
      enrichedSampleCount: 20, commercialSamplingPolicy: { maximumExamined: 20 } } },
  { sequence: 4, stage: "FINAL_DECISION", status: "PASS",
    narrative: "Decisión lista.", observed_at: "2026-09-13T12:00:03Z",
    evidence: { finalDecision: "HOLD_DEMAND_UNPROVEN" } },
]

const trace = { trace_id: "10000000-0000-4000-8000-000000000001",
  state: "COMPLETED", current_stage: "FINAL_DECISION", result,
  product_url: "https://lunaportex.com/products/qx900",
  started_at: "2026-09-13T12:00:00Z",
  updated_at: "2026-09-13T12:00:03Z",
  completed_at: "2026-09-13T12:00:03Z" }

test("human view reconciles every reviewed comparable", () => {
  const view = buildCommercialTracePresentationV1({ trace, events })
  assert.equal(view.marketFunnel.found, 342)
  assert.equal(view.marketFunnel.reviewed, 3)
  assert.equal(view.marketFunnel.accepted, 2)
  assert.equal(view.marketFunnel.excluded, 1)
  assert.equal(view.marketFunnel.reconciled, true)
  assert.equal(view.marketFunnel.confirmedSales, 1)
  assert.equal(view.marketFunnel.estimatedSales, 5)
  assert.equal(view.progress, 100)
})

test("technical codes are translated in the primary experience", () => {
  assert.equal(humanCommercialCodeV1("GTIN_CONFLICT"),
    "Descartado: corresponde a otra identidad de producto")
  assert.equal(humanComparableReasonV1({
    rejectionReason: "STRUCTURED_MODEL_CONFLICT" }),
  "Descartado: el modelo declarado no coincide")
  const conflict = humanConflictExplanationV1(
    result.CLAIM_CONFLICTS[0], result.SAFE_CLAIM_SUBSET)
  assert.match(conflict, /usará 1080P/)
  assert.doesNotMatch(conflict, /UNVERIFIED|DO_NOT_USE/)
})

test("dossier is generated from the completed trace without a second analysis", () => {
  const view = buildCommercialTracePresentationV1({ trace, events })
  assert.equal(view.dossier.generated, true)
  assert.equal(view.dossier.product.title, result.PRODUCT_TRUTH.title)
  assert.equal(view.dossier.market.reviewed,
    result.ACCEPTED_COMPARABLES.length + result.EXCLUDED_COMPARABLES.length)
  assert.equal(view.dossier.listingStrategy.recommendedTitle,
    "1080P Webcam with Built-In Speakers and Microphone QX900")
  assert.equal(view.dossier.provenance.shipping, "DURABLE_REUSE")
  assert.equal(view.dossier.technical.rawDecisionCode,
    "HOLD_DEMAND_UNPROVEN")
})

test("UI keeps technical evidence collapsed and restores durable traces", async () => {
  const workspace = await readFile(new URL(
    "../../app/admin/ebay/commercial-trace/commercial-trace-workspace.tsx",
    import.meta.url), "utf8")
  const presentation = await readFile(new URL(
    "./seller-os-commercial-trace-presentation-v1.ts", import.meta.url),
  "utf8")
  assert.match(workspace, /Ver detalles técnicos/)
  assert.match(workspace, /visibilitychange/)
  assert.match(workspace, /window\.addEventListener\("online"/)
  assert.match(workspace, /animate-in fade-in/)
  assert.match(workspace, /Expediente comercial/)
  assert.doesNotMatch(presentation, /\bfetch\s*\(/)
})
