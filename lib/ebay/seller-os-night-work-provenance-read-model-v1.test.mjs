import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { buildSellerOsNightWorkProvenanceReadModelV1 } = await import(
  "./seller-os-night-work-provenance-read-model-v1.ts")

const RUN_ID = "59f9eab1-b0bd-40f8-944a-e9dded0643e8"
const BATCH_ID = "1c8f2ba2-9da7-4bbf-8cc8-d429eb42fbac"
const A_ID = "b739f873-979a-46f1-9c14-8ecc88be4be2"
const B_ID = "695aae9f-4c01-4bd1-86a6-d030fec710a2"
const C_ID = "49566f51-3573-4384-93fd-8e349f31b390"

function audit(overrides = {}) {
  return { contractVersion: "QUICK_PICK_RADAR_OVERNIGHT_ENRICHMENT_V1",
    runId: RUN_ID, enrichedAt: "2026-09-03T09:12:26.161Z",
    beforeStatus: "OWNER_FACT_REQUIRED",
    afterStatus: "OWNER_FACT_REQUIRED", fieldsResolvedOvernight: [],
    demandEvidenceAdded: false, listingIntelligenceUpdated: true,
    ownerActionRequired: "ENTER_FACT", factInvented: false, ...overrides }
}

function operation(batchId = BATCH_ID) {
  return { contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
    batchId }
}

function authorityRow(id, sku, candidateKey, assessment) {
  return { id, supplier_sku: sku, product_title: `Product ${sku}`,
    candidate_key: candidateKey, assessment }
}

function card(id, overrides = {}) {
  return { opportunityId: id, sourceUrl: `https://luna.invalid/${id}`,
    sourceSku: overrides.sourceSku ?? null, state: "WAITING",
    disposition: "WAITING", commercialStage: "WAITING",
    exactBlocker: null, exactUnresolvedFields: [], ownerResidualActions: [],
    ...overrides }
}

const keyA = `sha256:${"a".repeat(64)}`
const keyB = `sha256:${"b".repeat(64)}`

test("origin, processor, enrichment and resolution remain separate", () => {
  const rows = [
    authorityRow(A_ID, "MANUAL-A", keyA, {
      lunaQuickPickOperationV1: operation(),
      quickPickRadarOvernightEnrichmentV1: audit(),
      quickPickRequiredSpecificsContinuationV1: {
        autonomousClaimedAt: "2026-09-03T12:21:57.377Z",
        initialUnresolvedFields: ["Brand"], exactUnresolvedFields: [],
        resolvedFieldAudits: [{ specificName: "Brand",
          resolvedValue: "Unbranded", sourceClass: "OWNER_POLICY",
          sourceAuthority: "OWNER_LUNA_UNBRANDED_POLICY",
          resolutionMethod: "OWNER_POLICY", factInvented: false }],
      },
    }),
    authorityRow(B_ID, "MANUAL-B", keyB, {
      lunaQuickPickOperationV1: operation(),
      quickPickRadarOvernightEnrichmentV1: audit(),
      quickPickRequiredSpecificsContinuationV1: {
        autonomousClaimedAt: "2026-09-03T12:27:48.599Z",
        initialUnresolvedFields: ["Material", "Color"],
        exactUnresolvedFields: ["Material"], resolvedFieldAudits: [{
          specificName: "Color", resolvedValue: "Multicolor",
          sourceAuthority: "EXACT_LUNA_PRODUCT_IMAGE",
          sourceClass: "AI_COMPLETION", resolutionMethod: "AI_CLASSIFICATION",
          factInvented: false }],
      },
    }),
    authorityRow(C_ID, "RADAR-C", `sha256:${"c".repeat(64)}`, {
      lunaQuickPickOperationV1: operation(
        "2e3a14b6-bdb6-4ce5-975c-1fa09e05be4d"),
      radarToQuickPickHandoffV1: {
        contractVersion: "RADAR_LUNA_QUICK_PICK_HANDOFF_V1",
        quickPickOperationId: C_ID,
        opportunityCaseId: `opportunity-case-v1:sha256:${"d".repeat(64)}`,
        radarFamilyId: `market-family-v1:sha256:${"e".repeat(64)}`,
        radarObservationId:
          `family-market-observation-v1:sha256:${"f".repeat(64)}`,
        lunaProductId: "9220837802208", lunaVariantId: "48809649373408",
        identityClass: "STRONG",
      },
    }),
  ]
  const result = buildSellerOsNightWorkProvenanceReadModelV1({
    authorityRows: rows,
    receipts: [{ batchId: BATCH_ID, ownerReference: "QP-1C8F2BA2",
      candidateKeys: [keyA, keyB], rawInputCount: 2 }],
    currentCards: [
      card(A_ID, { sourceSku: "MANUAL-A", state: "READY",
        disposition: "MARKET_TEST_READY",
        commercialStage: "MARKET_TEST_READY" }),
      card(B_ID, { sourceSku: "MANUAL-B", state: "BLOCKED",
        disposition: "OWNER_FACT_REQUIRED",
        commercialStage: "OWNER_FACT_REQUIRED",
        exactUnresolvedFields: ["Material"], ownerResidualActions: [{
          productField: "Material", ownerAction: "ENTER_FACT" }] }),
      card(C_ID, { sourceSku: "RADAR-C", state: "WAITING",
        disposition: "WAITING_FOR_SHIPPING_WORKER",
        commercialStage: "WAITING_FOR_SHIPPING_WORKER" }),
    ],
    overnightEnrichment: { automationRunId: RUN_ID,
      observedAt: "2026-09-03T09:12:26.161Z",
      outcomes: [{ opportunityId: A_ID }, { opportunityId: B_ID }] },
  })
  assert.equal(result.historicalSnapshot.outcomes.length, 2)
  const [manualResolved, manualUnresolved] =
    result.historicalSnapshot.outcomes
  assert.equal(manualResolved.origin.classification, "MANUAL_LUNA_BATCH")
  assert.equal(manualResolved.origin.batchReference, "QP-1C8F2BA2")
  assert.equal(manualResolved.processor, "NIGHT_WORK")
  assert.equal(manualResolved.enrichmentSource, "NO_NEW_EVIDENCE")
  assert.equal(manualResolved.resolutionSource, "NOT_RESOLVED")
  assert.equal(manualResolved.currentResolutions[0].resolutionSource,
    "OWNER_LUNA_POLICY")
  assert.equal(manualResolved.currentCanonicalState, "MARKET_TEST_READY")
  assert.equal(manualResolved.currentAction, "Revisar / autorizar publicación")
  assert.deepEqual(manualUnresolved.persistentBlockingFields, ["Material"])
  assert.equal(manualUnresolved.currentCanonicalState, "OWNER_FACT_REQUIRED")
  assert.equal(manualUnresolved.currentAction, "Completar Material")
  const radar = result.currentOperations.find((entry) =>
    entry.operationId === C_ID)
  assert.equal(radar.origin.classification, "RADAR_HANDOFF")
  assert.equal(radar.origin.identityClass, "STRONG")
  assert.equal(radar.processor, "QUICK_PICK_RUNTIME")
  assert.equal(radar.currentAction, "Ninguna · Seller OS continúa")
  assert.deepEqual(result.morningSummary, {
    linksReceived: { value: 2,
      authority: "LATEST_DURABLE_MANUAL_LUNA_BATCH_RECEIPT" },
    processedDuringDay: { value: null,
      authority: "UNPROVEN_NO_DURABLE_PROCESSOR_DISCRIMINATOR" },
    processedAtNight: { value: 2,
      authority: "OVERNIGHT_RUN_OPERATION_LINEAGE" }, radarEnrichedCount: 0,
    noNewRadarEvidenceCount: 2, blockersResolvedByRadarCount: 0,
    blockersResolvedByOtherSystemCount: 2, ownerFactsRemainingCount: 1,
    marketTestReadyCount: 1,
  })
})

test("Radar resolution requires a causal evidence delta and exact operation lineage", () => {
  const id = "11111111-1111-4111-8111-111111111111"
  const familyId = `market-family-v1:sha256:${"1".repeat(64)}`
  const baseAssessment = {
    lunaQuickPickOperationV1: operation(),
    radarFactoryCandidateV1: { familyId },
    quickPickRequiredSpecificsContinuationV1: {
      exactUnresolvedFields: [], resolvedFieldAudits: [{
        specificName: "Type", resolvedValue: "Tool",
        sourceAuthority: "RADAR_MARKET_EVIDENCE", sourceClass: "RADAR",
        resolutionMethod: "MAPPING", factInvented: false }],
    },
  }
  const withoutDelta = buildSellerOsNightWorkProvenanceReadModelV1({
    authorityRows: [authorityRow(id, "NO-GUESS", keyA, {
      ...baseAssessment, quickPickRadarOvernightEnrichmentV1: audit({
        fieldsResolvedOvernight: ["Type"], demandEvidenceAdded: false,
      }),
    })], receipts: [], currentCards: [card(id)],
    overnightEnrichment: { automationRunId: RUN_ID,
      outcomes: [{ opportunityId: id }] },
  }).historicalSnapshot.outcomes[0]
  assert.notEqual(withoutDelta.resolutionSource,
    "RADAR_NIGHT_ENRICHMENT")
  const withDelta = buildSellerOsNightWorkProvenanceReadModelV1({
    authorityRows: [authorityRow(id, "CAUSAL", keyA, {
      ...baseAssessment, quickPickRadarOvernightEnrichmentV1: audit({
        fieldsResolvedOvernight: ["Type"], demandEvidenceAdded: true,
      }),
    })], receipts: [], currentCards: [card(id)],
    overnightEnrichment: { automationRunId: RUN_ID,
      outcomes: [{ opportunityId: id }] },
  }).historicalSnapshot.outcomes[0]
  assert.equal(withDelta.enrichmentSource, "RADAR_NIGHT_ENRICHMENT")
  assert.equal(withDelta.resolutionSource, "RADAR_NIGHT_ENRICHMENT")
  assert.equal(withDelta.origin.classification, "UNPROVEN")
})

test("API and Dashboard expose presentation-only provenance without runtime writes", async () => {
  const route = await readFile(new URL(
    "../../app/api/admin/ebay/luna-quick-pick/route.ts", import.meta.url),
  "utf8")
  const dashboard = await readFile(new URL(
    "../../app/admin/seller-os-operational-dashboard.tsx", import.meta.url),
  "utf8")
  const model = await readFile(new URL(
    "./seller-os-night-work-provenance-read-model-v1.ts", import.meta.url),
  "utf8")
  assert.match(route, /nightWorkProvenance/)
  assert.match(route, /readOnly: true/)
  assert.match(dashboard, /Origen:/)
  assert.match(dashboard, /Procesado\/avanzado por:/)
  assert.match(dashboard, /Enriquecimiento nocturno:/)
  assert.match(dashboard, /Resolución en ese momento:/)
  assert.match(dashboard, /Acción en ese momento:/)
  assert.match(dashboard, /Acción actual:/)
  assert.match(model, /radarResolutionOnlyWhenCausallyProven: true/)
  assert.match(model, /legacyProvenanceNotGuessed: true/)
  assert.doesNotMatch(model, /\.insert\(|\.update\(|\.delete\(/)
})
