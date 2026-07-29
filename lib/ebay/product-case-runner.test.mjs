import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import {
  acceptedProductCaseEvidence,
  applyProductCaseEvidenceReview,
  buildProductCaseRunnerOutput,
  buildStrategyLabAdapterPreview,
  createHumanVisualReviewRecord,
  createProductCaseWorkspaceExport,
  extractProductCaseEvidence,
  hashProductCaseContent,
  importProductCaseWorkspaceExport,
  PRODUCT_CASE_CONTENT_MAX_BYTES,
  PRODUCT_CASE_OPERATIONAL_PHASES,
  serializeProductCaseWorkspaceExport,
  validateProductCaseDocumentProvenance,
  validateProductCaseImageAnalysis,
} from "./product-case-runner.ts"
import {
  canonicalizeLunaProductSourceUrl,
  isPublicProductCaseSourceAddress,
  preflightLunaProductSource,
  PRODUCT_CASE_RUNNER_MAX_SOURCE_BYTES,
} from "./product-case-runner-preflight.ts"
import {
  GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE,
  GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT,
  GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
  GOLF_SWING_TRAINER_EXACT_BLOCKERS,
  GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT,
  GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT_SHA256,
  GOLF_SWING_TRAINER_VISUAL_REVIEW_SNAPSHOT,
  GOLF_SWING_TRAINER_VISUAL_REVIEW_SNAPSHOT_SHA256,
  SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE,
  SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_OUTPUT,
} from "./product-case-runner-fixtures.ts"
import {
  evaluateSingleProductLabRequest,
  SINGLE_PRODUCT_LAB_MODE,
  singleProductLabBlockedPayload,
} from "./single-product-lab.ts"

const ROOT = join(import.meta.dirname, "../..")
const read = (path) => readFileSync(join(ROOT, path), "utf8")
const CAPTURED_AT = "2026-07-28T16:00:00.000Z"
const PILOT_URL =
  "https://lunaportex.com/products/smart-inflatable-golf-ball-swing-trainer-black"
const PUBLIC_DNS = async () => [{ address: "104.16.1.1", family: 4 }]

function buildWorkspaceOutput(workspaceState) {
  const adapter = buildStrategyLabAdapterPreview({
    document: workspaceState.document,
    evaluatedAt: workspaceState.evaluatedAt,
    economicsPolicy: workspaceState.economicsPolicy,
    scenarioDraft: workspaceState.scenarioDraft,
  })
  return buildProductCaseRunnerOutput({
    document: workspaceState.document,
    adapter,
    imageApprovals: workspaceState.imageApprovals,
    listingOperations: workspaceState.listingOperations,
    generatedAt: workspaceState.generatedAt,
  })
}

function response(body, init = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...init.headers,
    },
  })
}

test("acepta únicamente una URL HTTPS exacta de producto Luna", () => {
  assert.equal(canonicalizeLunaProductSourceUrl(PILOT_URL), PILOT_URL)
  assert.equal(
    canonicalizeLunaProductSourceUrl(
      "https://www.lunaportex.com/products/example-product/",
    ),
    "https://www.lunaportex.com/products/example-product",
  )

  const rejected = [
    "http://lunaportex.com/products/example-product",
    "https://user:password@lunaportex.com/products/example-product",
    "https://lunaportex.com:444/products/example-product",
    "https://localhost/products/example-product",
    "https://127.0.0.1/products/example-product",
    "https://evil.example/products/example-product",
    "https://lunaportex.com/collections/example-product",
    "https://lunaportex.com/products/example-product?view=json",
    "https://lunaportex.com/products/example-product#fragment",
    "https://lunaportex.com/products/example%2fescape",
    "file:///products/example-product",
  ]
  for (const value of rejected) {
    assert.throws(
      () => canonicalizeLunaProductSourceUrl(value),
      /PRODUCT_CASE_SOURCE_URL_INVALID/,
      value,
    )
  }
})

test("rechaza direcciones privadas, loopback, link-local y reservadas", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fc00::1",
    "2001:db8::1",
  ]) {
    assert.equal(isPublicProductCaseSourceAddress(address), false, address)
  }
  assert.equal(isPublicProductCaseSourceAddress("104.16.1.1"), true)
  assert.equal(
    isPublicProductCaseSourceAddress(
      "2606:4700:3037::6815:4f4e",
    ),
    true,
  )
})

test("Access Restricted es estado esperado y no devuelve el cuerpo", async () => {
  const result = await preflightLunaProductSource({
    sourceUrl: PILOT_URL,
    capturedAt: CAPTURED_AT,
    dnsResolver: PUBLIC_DNS,
    fetchImpl: async () => response(
      "<html><title>Access Restricted</title><body>Log in</body></html>",
    ),
  })
  assert.deepEqual(result, {
    accessStatus: "AUTHENTICATED_SOURCE_REQUIRED",
    sourceUrl: PILOT_URL,
    capturedAt: CAPTURED_AT,
    httpStatus: 200,
    contentType: "text/html",
    contentHash: null,
    responseBytes: null,
    publicEvidence: [],
    nextAction: "PASTE_VISIBLE_AUTHENTICATED_SOURCE",
  })
  assert.equal("body" in result, false)
  assert.equal("rawContent" in result, false)
})

test("401, 403 y redirección interna a login requieren fuente autenticada", async () => {
  for (const status of [401, 403]) {
    const result = await preflightLunaProductSource({
      sourceUrl: PILOT_URL,
      capturedAt: CAPTURED_AT,
      dnsResolver: PUBLIC_DNS,
      fetchImpl: async () => response("restricted", { status }),
    })
    assert.equal(result.accessStatus, "AUTHENTICATED_SOURCE_REQUIRED")
    assert.equal(result.httpStatus, status)
  }
  const redirected = await preflightLunaProductSource({
    sourceUrl: PILOT_URL,
    capturedAt: CAPTURED_AT,
    dnsResolver: PUBLIC_DNS,
    fetchImpl: async () => response(null, {
      status: 302,
      headers: { location: "/account/login" },
    }),
  })
  assert.equal(
    redirected.accessStatus,
    "AUTHENTICATED_SOURCE_REQUIRED",
  )
})

test("una redirección externa falla cerrada y nunca se sigue", async () => {
  let requests = 0
  await assert.rejects(
    preflightLunaProductSource({
      sourceUrl: PILOT_URL,
      capturedAt: CAPTURED_AT,
      dnsResolver: PUBLIC_DNS,
      fetchImpl: async (_url, init) => {
        requests += 1
        assert.equal(init?.redirect, "manual")
        assert.equal(init?.credentials, "omit")
        return response(null, {
          status: 302,
          headers: { location: "https://example.com/login" },
        })
      },
    }),
    /PRODUCT_CASE_SOURCE_REDIRECT_REJECTED/,
  )
  assert.equal(requests, 1)
})

test("DNS privado, content type y tamaño de fuente fallan cerrados", async () => {
  let fetchCalls = 0
  await assert.rejects(
    preflightLunaProductSource({
      sourceUrl: PILOT_URL,
      capturedAt: CAPTURED_AT,
      dnsResolver: async () => [{ address: "127.0.0.1" }],
      fetchImpl: async () => {
        fetchCalls += 1
        return response("never")
      },
    }),
    /PRODUCT_CASE_SOURCE_DNS_NOT_PUBLIC/,
  )
  assert.equal(fetchCalls, 0)

  await assert.rejects(
    preflightLunaProductSource({
      sourceUrl: PILOT_URL,
      capturedAt: CAPTURED_AT,
      dnsResolver: PUBLIC_DNS,
      fetchImpl: async () => response("binary", {
        headers: { "content-type": "application/octet-stream" },
      }),
    }),
    /PRODUCT_CASE_SOURCE_CONTENT_TYPE_REJECTED/,
  )

  await assert.rejects(
    preflightLunaProductSource({
      sourceUrl: PILOT_URL,
      capturedAt: CAPTURED_AT,
      dnsResolver: PUBLIC_DNS,
      fetchImpl: async () => response("small", {
        headers: {
          "content-length":
            String(PRODUCT_CASE_RUNNER_MAX_SOURCE_BYTES + 1),
        },
      }),
    }),
    /PRODUCT_CASE_SOURCE_RESPONSE_TOO_LARGE/,
  )
})

test("fuente pública permitida devuelve sólo metadata y hash SHA-256", async () => {
  const result = await preflightLunaProductSource({
    sourceUrl: PILOT_URL,
    capturedAt: CAPTURED_AT,
    dnsResolver: PUBLIC_DNS,
    fetchImpl: async () => response(
      "<html><title>Visible public product</title></html>",
    ),
  })
  assert.equal(result.accessStatus, "SOURCE_AVAILABLE")
  assert.match(result.contentHash ?? "", /^sha256:[a-f0-9]{64}$/)
  assert.ok((result.responseBytes ?? 0) > 0)
  assert.deepEqual(result.publicEvidence, [])
  assert.equal("body" in result, false)
})

test("el fixture piloto es sólo Golf Trainer y conserva el snapshot verificable", async () => {
  const fixture = GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE
  const serialized = JSON.stringify(fixture)
  assert.match(
    fixture.document.sourceUrl,
    /smart-inflatable-golf-ball-swing-trainer-black$/,
  )
  assert.match(fixture.document.productLabel, /Golf Ball Swing Trainer/)
  assert.doesNotMatch(serialized, /backpack|mochila|molle|3-day assault/i)
  assert.equal(
    await hashProductCaseContent(GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT),
    GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT_SHA256,
  )
  assert.equal(
    fixture.publicSnapshot.contentHash,
    GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT_SHA256,
  )
  assert.equal(
    fixture.document.captures[0].byteLength,
    new TextEncoder().encode(GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT).byteLength,
  )
  assert.equal(
    await hashProductCaseContent(GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT),
    GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
  )
  assert.equal(
    await hashProductCaseContent(GOLF_SWING_TRAINER_VISUAL_REVIEW_SNAPSHOT),
    GOLF_SWING_TRAINER_VISUAL_REVIEW_SNAPSHOT_SHA256,
  )
  assert.equal(fixture.authenticatedSnapshot.credentialsStored, false)
})

test("separa señales públicas Luna de costo, demanda y mercado", () => {
  const fixture = GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE
  const evidence = fixture.document.evidence
  const title = evidence.find((entry) => entry.field === "title")
  const productType = evidence.find((entry) =>
    entry.field === "product_type"
  )
  const price = evidence.find((entry) => entry.field === "supplier_price")
  const merchandising = evidence.find((entry) =>
    entry.field === "supplier_merchandising_signal"
  )
  const availability = evidence.find((entry) =>
    entry.field === "visible_stock"
  )
  const productCost = evidence.find((entry) =>
    entry.field === "supplier_unit_cost"
  )

  assert.equal(title?.evidenceClass, "SUPPLIER_STATED")
  assert.equal(productType?.evidenceClass, "SUPPLIER_STATED")
  assert.equal(
    productType?.normalizedValue,
    "INFLATABLE_GOLF_SWING_TRAINER",
  )
  assert.equal(price?.normalizedValue, 8)
  assert.equal(price?.evidenceClass, "SUPPLIER_STATED")
  assert.equal(merchandising?.evidenceClass,
    "SUPPLIER_MERCHANDISING_SIGNAL")
  assert.equal(availability?.normalizedValue, 50000)
  assert.equal(availability?.evidenceClass, "SUPPLIER_STATED")
  assert.equal(availability?.availabilityPurpose, "INVENTORY_SIGNAL")
  assert.equal(availability?.demandEvidence, "NONE")
  assert.equal(productCost?.evidenceClass, "MISSING")
  assert.equal(productCost?.normalizedValue, null)
  assert.equal(fixture.document.identityReview.status, "CONFLICTED")
  assert.equal(fixture.document.identityReview.confidence, "LOW")
  assert.equal(fixture.document.marketEvidence.runStatus, "INSUFFICIENT")
  assert.equal(fixture.document.marketEvidence.soldExactCount, 0)
  assert.equal(fixture.document.marketEvidence.referenceMedian, null)
  assert.equal(fixture.document.marketEvidence.comparables.length, 0)
})

test("los cinco candidatos humanos conservan señales sin crear SOLD_EXACT", () => {
  const candidates =
    GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document.marketEvidence
      .humanSuppliedComparableCandidates
  assert.equal(candidates.length, 5)
  assert.deepEqual(
    candidates.slice(0, 2).map((entry) => entry.ebayItemId),
    ["187697800648", "376837929124"],
  )
  assert.equal(candidates[0].visibleSoldSignal, 9)
  for (const candidate of candidates.slice(0, 2)) {
    assert.equal(
      candidate.sourceType,
      "HUMAN_SUPPLIED_COMPARABLE_CANDIDATE",
    )
    assert.equal(candidate.validationStatus, "NOT_VALIDATED")
    assert.equal(candidate.listingStatus, "ACTIVE_VISIBLE")
    assert.equal(candidate.eligibleForSoldExact, false)
    assert.equal(candidate.eligibleForStrategyLab, false)
    assert.equal(candidate.canBecomeProductFact, false)
  }
  assert.equal(candidates[1].competitorDimensions, "28 cm")
  assert.equal(candidates[1].competitorWeight, "0.16 kg")
  assert.equal(candidates[2].provisionalCohort, "SIMILAR_NOT_EXACT")
  assert.equal(candidates[2].observedPriceApprox, 3.99)
  assert.equal(candidates[2].observedShippingApprox, 5.73)
  assert.equal(candidates[2].visibleSoldSignal, 1)
  assert.equal(candidates[2].eligibleForSoldExact, false)

  for (const candidate of candidates.slice(3)) {
    assert.equal(candidate.listingStatus, "SOLD_USED_VISIBLE")
    assert.equal(candidate.provisionalCohort, "REJECTED")
    assert.equal(candidate.visibleSoldSignal, 1)
    assert.deepEqual(candidate.review.reasonCodes, [
      "BRANDED_TOUR_STRIKER",
      "CONDITION_USED",
      "PRODUCT_TYPE_MISMATCH",
      "NOT_EXACT_LUNA_PRODUCT",
    ])
    assert.equal(candidate.eligibleForStrategyLab, false)
    assert.equal(candidate.eligibleForSoldExact, false)
    assert.equal(candidate.canBecomeProductFact, false)
  }
})

test("el caso Golf falla cerrado con identidad conflictiva y paquete nulo", () => {
  const fixture = GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE
  const document = structuredClone(fixture.document)
  const adapter = buildStrategyLabAdapterPreview({
    document,
    evaluatedAt: CAPTURED_AT,
    economicsPolicy: null,
    scenarioDraft: null,
  })
  assert.equal(adapter.status, "BLOCKED")
  assert.equal(adapter.osConclusion, "HOLD_IDENTITY")
  assert.equal(adapter.nextAction, "VERIFY_PHYSICAL_PRODUCT_AND_VARIANT")
  assert.deepEqual(adapter.blockers, [...GOLF_SWING_TRAINER_EXACT_BLOCKERS])
  assert.equal(adapter.strategyLabInput, null)
  assert.equal(adapter.currentEvidenceLeader, null)
  assert.equal(adapter.strategicHypothesisToValidate, null)
  assert.equal(adapter.excludedComparableCandidates.length, 5)
  assert.equal(adapter.validatedComparableInputs.length, 0)

  const output = buildProductCaseRunnerOutput({
    document,
    adapter,
    imageApprovals: [],
    listingOperations: structuredClone(fixture.listingOperations),
    generatedAt: CAPTURED_AT,
  })
  assert.equal(output.readiness.productIdentity, "CONFLICTED")
  assert.equal(output.readiness.identityConfidence, "LOW")
  assert.equal(output.readiness.productFactsReadiness, "NOT_READY")
  assert.equal(output.readiness.marketEvidence, "INSUFFICIENT")
  assert.equal(output.readiness.economics, "MISSING_INPUT")
  assert.equal(output.readiness.strategy, "HOLD_IDENTITY")
  assert.equal(output.listingPackage, null)
  assert.equal(
    output.listingPackageStatus,
    "NOT_GENERATED_IDENTITY_HOLD",
  )
  assert.equal(output.manualHandoffAllowed, false)
  assert.equal(output.canPublishAutomatically, false)
  assert.equal(output.registrationDraft.canSubmit, false)
  assert.equal(
    output.learningObservation.ruleCandidate,
    "TITLE_CANNOT_OVERRIDE_CONTRADICTORY_VISUAL_EVIDENCE",
  )
  assert.equal(output.learningObservation.ruleCandidateStatus,
    "OBSERVATION_ONLY")
  assert.equal(output.learningObservation.listingOutcomeStatus,
    "NOT_YET_MEASURED")
  assert.equal(output.learningObservation.engineRuleChanged, false)
  assert.equal(output.learningObservation.evidenceAddedByHuman.length, 3)
  assert.equal(output.learningObservation.evidenceRejectedByHuman.length, 1)
  assert.deepEqual(output.shadowMode.differences, [])
  assert.equal(output.safety.ebayWrites, 0)
  assert.equal(output.safety.supabaseWrites, 0)
  assert.equal(output.safety.openAiCalls, 0)
  assert.equal(output.safety.whatsappCalls, 0)
})

test("pipeline Golf usa las 12 fases exactas y propaga el bloqueo", () => {
  const fixture = GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE
  const workspace = {
    document: structuredClone(fixture.document),
    economicsPolicy: null,
    scenarioDraft: null,
    listingOperations: structuredClone(fixture.listingOperations),
    imageApprovals: [],
    imageObservations:
      structuredClone(fixture.document.imageAnalysis.observations),
    evaluatedAt: CAPTURED_AT,
    generatedAt: CAPTURED_AT,
  }
  const output = buildWorkspaceOutput(workspace)
  const allowedStatuses = new Set([
    "NOT_STARTED",
    "IN_PROGRESS",
    "HUMAN_REVIEW_REQUIRED",
    "BLOCKED",
    "COMPLETED",
  ])
  assert.deepEqual(
    output.operationalPipeline.map((phase) => phase.phase),
    [...PRODUCT_CASE_OPERATIONAL_PHASES],
  )
  assert.equal(
    output.operationalPipeline.every((phase) =>
      allowedStatuses.has(phase.status)
    ),
    true,
  )
  const identityIndex = output.operationalPipeline.findIndex((phase) =>
    phase.phase === "IDENTITY_AND_VARIANTS"
  )
  assert.equal(output.operationalPipeline[identityIndex].status, "BLOCKED")
  assert.equal(
    output.operationalPipeline.slice(identityIndex + 1)
      .some((phase) => phase.status === "COMPLETED"),
    false,
  )
  const registration = output.operationalPipeline.at(-1)
  assert.equal(registration?.phase, "MANUAL_LISTING_REGISTRATION")
  assert.equal(registration?.status, "BLOCKED")
  assert.equal(
    registration?.nextAction,
    "Después de publicar manualmente, registra el Item ID para iniciar el enlace y monitoreo read-only.",
  )
})

test("visión es exclusivamente humana y conserva conflicto/provenance", () => {
  const fixture = GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE
  const analysis = fixture.document.imageAnalysis
  assert.deepEqual({
    imageAnalysisCapability: analysis.imageAnalysisCapability,
    machineVisionStatus: analysis.machineVisionStatus,
    openAiVisionUsed: analysis.openAiVisionUsed,
    humanReviewRequired: analysis.humanReviewRequired,
  }, {
    imageAnalysisCapability: "HUMAN_ASSISTED_ONLY",
    machineVisionStatus: "NOT_IMPLEMENTED",
    openAiVisionUsed: false,
    humanReviewRequired: true,
  })
  assert.deepEqual(analysis.conflictDetectedFrom, [
    "SUPPLIER_TEXT",
    "HUMAN_VISUAL_REVIEW",
  ])
  assert.equal(validateProductCaseImageAnalysis(fixture.document).valid, true)
  for (const observation of analysis.observations) {
    assert.equal(observation.sourceType, "SUPPLIER_IMAGE")
    assert.equal(observation.captureMethod, "HUMAN_VISUAL_REVIEW")
    assert.equal(
      observation.verificationStatus,
      "SOURCE_IMAGE_OBSERVED",
    )
    assert.equal(observation.physicalProductVerified, false)
    assert.ok(observation.evidenceId)
    assert.match(observation.contentHash, /^sha256:[a-f0-9]{64}$/)
    assert.ok(observation.contradictsEvidenceIds.length > 0)
  }
  const image2 = analysis.observations.find((entry) =>
    entry.imageId === "supplier-image-2"
  )
  assert.equal(image2?.humanDecision, "REJECT_FOR_EBAY_HANDOFF")
  assert.match(
    image2?.humanReason ?? "",
    /THIRD_PARTY_TRADEMARK_VISIBLE:TITLEIST/,
  )
  assert.match(image2?.humanReason ?? "", /PROMOTIONAL_COMPOSITE/)
  assert.match(
    image2?.humanReason ?? "",
    /PRODUCT_FUNCTION_NOT_VERIFIED/,
  )
})

test("sin observación humana no existe evidencia visual inferida", async () => {
  const fixture = GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE
  const document = structuredClone(fixture.document)
  document.imageAnalysis = {
    ...document.imageAnalysis,
    visualEvidenceStatus: "NOT_REVIEWED",
    conflictDetectedFrom: [],
    observations: [],
  }
  document.evidence = document.evidence.filter((entry) =>
    entry.sourceType !== "HUMAN_VISUAL_OBSERVATION"
  )
  document.captures = document.captures.filter((capture) =>
    capture.sourceType !== "HUMAN_VISUAL_OBSERVATION"
  )
  const validation = validateProductCaseImageAnalysis(document)
  assert.equal(validation.valid, true)
  assert.equal(validation.visualEvidenceStatus, "NOT_REVIEWED")

  const parsed = await extractProductCaseEvidence({
    sourceUrl: PILOT_URL,
    capturedAt: CAPTURED_AT,
    format: "HTML_AS_TEXT",
    content:
      "<img src=\"https://cdn.example.com/inflatable-swing-trainer.jpg\" alt=\"Inflatable swing trainer with pump\">",
  })
  assert.equal(
    parsed.evidence.some((entry) =>
      entry.evidenceStatus !== "MISSING" &&
      (
        entry.field === "visual_observation" ||
        entry.field === "product_type" ||
        entry.field === "accessories"
      )
    ),
    false,
  )
  assert.equal(
    parsed.evidence.some((entry) =>
      entry.field === "source_image_url" &&
      entry.normalizedValue ===
        "https://cdn.example.com/inflatable-swing-trainer.jpg"
    ),
    true,
  )
})

test("helper visual no contamina la clase SUPPLIER_STATED", async () => {
  const document = structuredClone(
    GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document,
  )
  const supplierIds = document.evidence
    .filter((entry) =>
      ["title", "description", "product_type"].includes(entry.field)
    )
    .map((entry) => entry.id)
  document.evidence = document.evidence.filter((entry) =>
    entry.sourceType !== "HUMAN_VISUAL_OBSERVATION"
  )
  document.captures = document.captures.filter((capture) =>
    capture.sourceType !== "HUMAN_VISUAL_OBSERVATION"
  )
  const result = await createHumanVisualReviewRecord({
    document,
    imageId: "human-image-review-test",
    sourceUrl: null,
    sourceReference: "human supplied image reference",
    reviewerType: "HUMAN",
    observedProductType: "POUCH_OR_STORAGE_ACCESSORY",
    visibleFeatures: ["zipper", "storage"],
    visibleText: [],
    visibleBrands: [],
    visibleColors: ["BLACK"],
    visibleQuantity: 1,
    observedVariant: "BLACK",
    possibleConflicts: ["PRODUCT_FUNCTION_CONFLICT"],
    contradictsEvidenceIds: supplierIds,
    confidence: "HIGH",
    humanDecision: "NEEDS_MORE_EVIDENCE",
    humanReason: "TEXT_AND_HUMAN_VISUAL_OBSERVATION_DIFFER",
    reviewedAt: CAPTURED_AT,
  })
  for (const id of supplierIds) {
    const supplier = result.updatedEvidence.find((entry) => entry.id === id)
    assert.equal(supplier?.evidenceClass, "SUPPLIER_STATED")
    assert.equal(supplier?.evidenceStatus, "ACCEPTED")
    assert.equal(supplier?.conflictKey, null)
  }
  assert.deepEqual(result.identityConflict.conflictDetectedFrom, [
    "SUPPLIER_TEXT",
    "HUMAN_VISUAL_REVIEW",
  ])
  assert.equal(result.observation.physicalProductVerified, false)
})

test("fixture sanitizado completa prepublicación sin efectos externos", () => {
  const fixture = SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE
  const output = SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_OUTPUT
  assert.equal(fixture.fixtureClass, "SANITIZED_DETERMINISTIC")
  assert.equal(fixture.liveMarketEvidence, false)
  assert.equal(fixture.linkedToOwnEbayListing, false)
  assert.equal(output.adapter.status, "READY")
  assert.equal(output.adapter.osConclusion, "GO_SINGLE")
  assert.equal(output.readiness.productIdentity, "READY")
  assert.equal(output.readiness.identityConfidence, "HIGH")
  assert.equal(output.readiness.productFactsReadiness, "READY")
  assert.equal(output.readiness.supplierEvidence, "READY")
  assert.equal(output.readiness.marketEvidence, "READY")
  assert.equal(output.readiness.economics, "READY")
  assert.equal(
    output.listingPackageStatus,
    "READY_FOR_HUMAN_SELLER_HUB_ENTRY",
  )
  assert.equal(output.listingPackage?.manualHandoffAllowed, true)
  assert.equal(output.manualHandoffAllowed, true)
  assert.equal(output.canPublishAutomatically, false)
  assert.equal(output.listingPackage?.canPublishAutomatically, false)
  assert.equal(
    output.listingPackage?.gates.every((gate) => gate.status === "PASS"),
    true,
  )
  assert.deepEqual(output.listingPackage?.economics, {
    totalInvestment: 16,
    estimatedProfit: 12.4,
    marginPercent: 35.43,
    roiPercent: 77.5,
  })
  assert.equal(
    output.operationalPipeline.slice(0, 11)
      .every((phase) => phase.status === "COMPLETED"),
    true,
  )
  assert.equal(output.operationalPipeline[11].status, "BLOCKED")
  assert.deepEqual(output.safety, {
    supabaseWrites: 0,
    ebayWrites: 0,
    openAiCalls: 0,
    whatsappCalls: 0,
    generatedImages: 0,
    transformedImages: 0,
    listingChanges: 0,
    serverFilesWritten: 0,
    canPublishAutomatically: false,
    canChangeEngineRules: false,
  })
})

test("HOLD, economía alterada o imagen no aprobada impiden handoff", () => {
  const base = SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE
    .workspaceState

  const hold = structuredClone(base)
  hold.document.humanReview.conclusion.conclusion = "HOLD_ECONOMICS"
  assert.equal(buildWorkspaceOutput(hold).manualHandoffAllowed, false)

  const wrongEconomics = structuredClone(base)
  wrongEconomics.listingOperations.totalInvestment += 1
  assert.equal(
    buildWorkspaceOutput(wrongEconomics).manualHandoffAllowed,
    false,
  )

  const pendingImage = structuredClone(base)
  pendingImage.imageApprovals[0].status = "HUMAN_REVIEW"
  assert.equal(buildWorkspaceOutput(pendingImage).manualHandoffAllowed, false)

  const unsupportedDescription = structuredClone(base)
  unsupportedDescription.listingOperations.evidenceLinks.description = []
  assert.equal(
    buildWorkspaceOutput(unsupportedDescription).manualHandoffAllowed,
    false,
  )
})

test("scenario humano distinto y clases hipotéticas no liberan gates", () => {
  const base = SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE
    .workspaceState

  const differentScenario = structuredClone(base)
  differentScenario.document.humanReview.conclusion.scenario = "TWO_PACK"
  assert.equal(
    buildWorkspaceOutput(differentScenario).manualHandoffAllowed,
    false,
  )

  const hypotheticalStock = structuredClone(base)
  const stock = hypotheticalStock.document.evidence.find((entry) =>
    entry.field === "visible_stock"
  )
  assert.ok(stock)
  stock.evidenceClass = "HUMAN_HYPOTHESIS"
  stock.sourceEvidenceClass = "HUMAN_HYPOTHESIS"
  assert.equal(
    buildWorkspaceOutput(hypotheticalStock).manualHandoffAllowed,
    false,
  )

  const hypotheticalPack = structuredClone(base)
  const pack = hypotheticalPack.document.evidence.find((entry) =>
    entry.field === "pack_quantity"
  )
  assert.ok(pack)
  pack.evidenceClass = "HUMAN_HYPOTHESIS"
  pack.sourceEvidenceClass = "HUMAN_HYPOTHESIS"
  assert.equal(
    buildWorkspaceOutput(hypotheticalPack).manualHandoffAllowed,
    false,
  )
})

test("timestamps humanos inválidos bloquean aprobación y QA", () => {
  const base = SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE
    .workspaceState

  const invalidStrategyReview = structuredClone(base)
  invalidStrategyReview.document.humanReview.conclusion.reviewedAt =
    "not-a-date"
  assert.equal(
    buildWorkspaceOutput(invalidStrategyReview).manualHandoffAllowed,
    false,
  )

  const invalidBrandReview = structuredClone(base)
  invalidBrandReview.listingOperations.brandIpClaimsReview.reviewedAt =
    "not-a-date"
  assert.equal(
    buildWorkspaceOutput(invalidBrandReview).manualHandoffAllowed,
    false,
  )

  const invalidApproval = structuredClone(base)
  invalidApproval.listingOperations.explicitHumanApproval.reviewedAt =
    "not-a-date"
  assert.equal(
    buildWorkspaceOutput(invalidApproval).manualHandoffAllowed,
    false,
  )

  const invalidImageReview = structuredClone(base)
  invalidImageReview.imageApprovals[0].reviewedAt = "not-a-date"
  assert.equal(
    buildWorkspaceOutput(invalidImageReview).manualHandoffAllowed,
    false,
  )
})

test("export/import preserva el expediente pero invalida aprobaciones", () => {
  const fixture = SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE
  const workspaceState = structuredClone(fixture.workspaceState)
  const envelope = createProductCaseWorkspaceExport({
    workspaceState,
    exportedAt: CAPTURED_AT,
  })
  assert.equal(envelope.output.manualHandoffAllowed, true)

  const serialized = serializeProductCaseWorkspaceExport({
    workspaceState,
    exportedAt: CAPTURED_AT,
  })
  const imported = importProductCaseWorkspaceExport(serialized)
  assert.equal(imported.importMode, "VIEW_ONLY")
  assert.equal(imported.humanReviewStatus, "HUMAN_REVIEW_REQUIRED")
  assert.equal(imported.importedManualHandoffTrusted, false)
  assert.deepEqual(imported.preservedWorkspaceState, workspaceState)
  assert.equal(imported.rebuiltOutput.manualHandoffAllowed, false)
  assert.equal(imported.workspaceState.listingOperations
    .explicitHumanApproval.approved, false)
  assert.equal(
    imported.workspaceState.imageApprovals
      .every((approval) => approval.status === "HUMAN_REVIEW"),
    true,
  )

  const tampered = JSON.parse(serialized)
  tampered.output.manualHandoffAllowed = false
  assert.throws(
    () => importProductCaseWorkspaceExport(JSON.stringify(tampered)),
    /PRODUCT_CASE_IMPORT_OUTPUT_MISMATCH/,
  )
})

test("provenance inválida no puede producir identidad READY", () => {
  const document = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE
      .workspaceState.document,
  )
  const accepted = document.evidence.find((entry) =>
    entry.evidenceStatus === "ACCEPTED"
  )
  assert.ok(accepted)
  accepted.contentHash =
    "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  const provenance = validateProductCaseDocumentProvenance(document)
  assert.equal(provenance.valid, false)
  assert.equal(
    provenance.errors.some((error) =>
      error.startsWith("EVIDENCE_CAPTURE_PROVENANCE_MISMATCH:")
    ),
    true,
  )
  const workspace = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
  )
  workspace.document = document
  const output = buildWorkspaceOutput(workspace)
  assert.equal(output.manualHandoffAllowed, false)
  assert.equal(output.readiness.productFactsReadiness, "NOT_READY")
})

test("HTML pegado se trata como texto inerte y nunca ejecuta scripts", async () => {
  globalThis.__productCaseRunnerScriptExecuted = false
  const result = await extractProductCaseEvidence({
    sourceUrl: PILOT_URL,
    capturedAt: CAPTURED_AT,
    content: [
      "<html><head>",
      "<meta property=\"og:title\" content=\"Golf Trainer Black\">",
      "</head><body>",
      "<script>globalThis.__productCaseRunnerScriptExecuted = true</script>",
      "<p>Supplier SKU: GOLF-001</p>",
      "<img src=\"https://cdn.example.com/golf-trainer.jpg\">",
      "</body></html>",
    ].join(""),
    format: "HTML_AS_TEXT",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  assert.equal(globalThis.__productCaseRunnerScriptExecuted, false)
  assert.equal(result.capture.scriptsExecuted, false)
  assert.equal(result.capture.resourcesLoaded, false)
  assert.equal(result.capture.fullContentStored, false)
  assert.match(result.capture.contentHash, /^sha256:[a-f0-9]{64}$/)
  assert.equal(result.evidence.some((entry) =>
    entry.field === "supplier_sku" &&
    entry.normalizedValue === "GOLF-001"
  ), true)
  assert.equal(result.evidence.some((entry) =>
    entry.field === "source_image_url" &&
    entry.normalizedValue ===
      "https://cdn.example.com/golf-trainer.jpg"
  ), true)
  assert.equal(
    result.evidence
      .filter((entry) => entry.evidenceStatus !== "MISSING")
      .every((entry) =>
        entry.evidenceClass === "SUPPLIER_STATED" ||
        entry.evidenceClass === "SUPPLIER_MERCHANDISING_SIGNAL"
      ),
    true,
  )
  delete globalThis.__productCaseRunnerScriptExecuted
})

test("variantes quedan separadas y conflictos no se resuelven solos", async () => {
  const result = await extractProductCaseEvidence({
    sourceUrl: PILOT_URL,
    capturedAt: CAPTURED_AT,
    format: "JSON",
    content: JSON.stringify({
      "@graph": [
        {
          "@type": "Product",
          name: "Golf Trainer Black",
          variants: [
            { id: "variant-black", color: "Black", sku: "GT-BLACK" },
            { id: "variant-blue", color: "Blue", sku: "GT-BLUE" },
          ],
        },
        {
          "@type": "Product",
          name: "Conflicting Golf Trainer Name",
        },
      ],
    }),
  })
  const variants = result.evidence.filter((entry) =>
    entry.field === "variant_id" && entry.evidenceStatus !== "MISSING"
  )
  assert.deepEqual(
    variants.map((entry) => entry.normalizedValue).sort(),
    ["variant-black", "variant-blue"],
  )
  assert.deepEqual(
    variants.map((entry) => entry.variantKey).sort(),
    ["GT-BLACK", "GT-BLUE"],
  )
  const titleConflict = result.conflicts.find((entry) =>
    entry.field === "title"
  )
  assert.equal(titleConflict?.status, "OPEN")
  assert.equal(
    result.evidence.filter((entry) =>
      entry.field === "title" && entry.evidenceStatus === "CONFLICTED"
    ).length,
    2,
  )
})

test("revisión conserva raw/original y sólo aceptado entra al adapter", async () => {
  const result = await extractProductCaseEvidence({
    sourceUrl: PILOT_URL,
    capturedAt: CAPTURED_AT,
    content: [
      "Smart Inflatable Golf Ball Swing Trainer Black",
      "Supplier SKU: GOLF-RAW",
      "Packaging Cost: 0",
      "Outbound Shipping Cost: 6.99",
    ].join("\n"),
    format: "TEXT",
  })
  const sku = result.evidence.find((entry) =>
    entry.field === "supplier_sku" &&
    entry.evidenceStatus !== "MISSING"
  )
  const shipping = result.evidence.find((entry) =>
    entry.field === "outbound_shipping_cost" &&
    entry.evidenceStatus !== "MISSING"
  )
  assert.ok(sku)
  assert.ok(shipping)

  let evidence = applyProductCaseEvidenceReview(result.evidence, {
    evidenceId: sku.id,
    action: "CORRECT",
    correctedValue: "GOLF-CORRECTED",
    reason: "HUMAN_CONFIRMED_VISIBLE_VARIANT",
  })
  evidence = applyProductCaseEvidenceReview(evidence, {
    evidenceId: shipping.id,
    action: "REJECT",
    reason: "GENERAL_SHIPPING_IS_NOT_ORDER_COST",
  })
  const corrected = evidence.find((entry) => entry.id === sku.id)
  assert.equal(corrected?.rawValue, "GOLF-RAW")
  assert.equal(corrected?.originalValue, "GOLF-RAW")
  assert.equal(corrected?.correctedValue, "GOLF-CORRECTED")
  assert.equal(corrected?.evidenceClass, "HUMAN_HYPOTHESIS")
  assert.equal(
    acceptedProductCaseEvidence(evidence).some((entry) =>
      entry.id === shipping.id
    ),
    false,
  )
  assert.throws(
    () => applyProductCaseEvidenceReview(result.evidence, {
      evidenceId: shipping.id,
      action: "REJECT",
    }),
    /PRODUCT_CASE_HUMAN_REASON_REQUIRED/,
  )
})

test("MISSING nunca se convierte en cero y cero explícito conserva evidencia", async () => {
  const result = await extractProductCaseEvidence({
    sourceUrl: PILOT_URL,
    capturedAt: CAPTURED_AT,
    content: "Packaging Cost: 0",
    format: "TEXT",
  })
  const packaging = result.evidence.find((entry) =>
    entry.field === "packaging_cost" &&
    entry.evidenceStatus !== "MISSING"
  )
  const shipping = result.evidence.find((entry) =>
    entry.field === "outbound_shipping_cost"
  )
  assert.ok(packaging)
  assert.equal(packaging.normalizedValue, 0)
  assert.equal(shipping?.normalizedValue, null)
  assert.equal(shipping?.evidenceClass, "MISSING")
  const reviewed = applyProductCaseEvidenceReview(result.evidence, {
    evidenceId: packaging.id,
    action: "ACCEPT",
  })
  assert.equal(
    acceptedProductCaseEvidence(reviewed).find((entry) =>
      entry.id === packaging.id
    )?.normalizedValue,
    0,
  )
})

test("contenido pegado respeta el límite cliente y servidor analítico", async () => {
  const oversized = "x".repeat(PRODUCT_CASE_CONTENT_MAX_BYTES + 1)
  await assert.rejects(
    extractProductCaseEvidence({
      sourceUrl: PILOT_URL,
      capturedAt: CAPTURED_AT,
      content: oversized,
    }),
    /PRODUCT_CASE_CONTENT_TOO_LARGE/,
  )
})

test("Pilot Mode bloquea mutations del Runner y registro, pero permite GET", () => {
  for (const pathname of [
    "/api/admin/ebay/product-case-runner/preflight",
    "/api/admin/ebay/listings/register",
  ]) {
    assert.equal(evaluateSingleProductLabRequest({
      pathname,
      method: "GET",
    }), null)
    const blocked = evaluateSingleProductLabRequest({
      pathname,
      method: "POST",
    })
    assert.equal(blocked?.status, 423)
    assert.equal(blocked?.reason, "COMMERCIAL_ACTION_BLOCKED")
    const payload = singleProductLabBlockedPayload(blocked)
    assert.equal(payload.error, "SINGLE_PRODUCT_LAB_ACTION_BLOCKED")
    assert.equal(payload.mode, SINGLE_PRODUCT_LAB_MODE)
    assert.equal(payload.reason, "COMMERCIAL_ACTION_BLOCKED")
    assert.equal(payload.nextAction, "HUMAN_REVIEW_REQUIRED")
    assert.equal(payload.safety.ebayWrites, 0)
    assert.equal(payload.safety.openAiCalls, 0)
    assert.equal(payload.safety.whatsappCalls, 0)
    assert.equal(payload.safety.publications, 0)
  }
})

test("la superficie nueva no contiene ejecución o persistencia externa", () => {
  const page = read("app/admin/ebay/product-case-runner/page.tsx")
  const route = read(
    "app/api/admin/ebay/product-case-runner/preflight/route.ts",
  )
  const domain = read("lib/ebay/product-case-runner.ts")
  const fixture = read("lib/ebay/product-case-runner-fixtures.ts")
  const combined = `${domain}\n${fixture}`

  assert.match(page, /GENERAR PAQUETE PARA PUBLICACIÓN MANUAL/)
  assert.doesNotMatch(page, /dangerouslySetInnerHTML|DOMParser|localStorage/)
  assert.doesNotMatch(page, />\s*PUBLICAR EN EBAY\s*</i)
  assert.doesNotMatch(
    route,
    /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b/,
  )
  assert.doesNotMatch(
    route,
    /getSupabaseAdminClient|\.from\(|\.rpc\(|\.insert\(|\.upsert\(|\.update\(|\.delete\(/,
  )
  assert.doesNotMatch(
    combined,
    /\bfetch\s*\(|from\s+["'][^"']*(?:supabase|openai|whatsapp)|writeFile|createClient\s*\(/i,
  )
  assert.doesNotMatch(combined, /\b(?:eval|Function)\s*\(/)
})
