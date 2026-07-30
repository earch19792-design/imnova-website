import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import {
  acceptedProductCaseEvidence,
  applyProductCaseEvidenceReview,
  buildProductCaseRunnerOutput,
  buildStrategyLabAdapterPreview,
  createHumanVisualReviewRecord,
  createManualAuthenticatedSupplierSourceCapture,
  createProductCaseWorkspaceExport,
  deleteHumanIdentityReviewRecord,
  deleteHumanVisualReviewRecord,
  extractProductCaseEvidence,
  hashProductCaseContent,
  humanVisualReviewContractIssues,
  HUMAN_IDENTITY_REVIEW_CONTRACT_VERSION,
  HUMAN_VISUAL_REVIEW_CONTRACT_VERSION,
  importProductCaseWorkspaceExport,
  LUNA_SOURCE_CONTRACT_VERSION,
  PRODUCT_CASE_CONTENT_MAX_BYTES,
  PRODUCT_CASE_OPERATIONAL_PHASES,
  PRODUCT_CASE_OUTPUT_CONTRACT_VERSION,
  PRODUCT_CASE_PARSER_VERSION,
  PRODUCT_CASE_PRE_IDENTITY_OUTPUT_CONTRACT_VERSION,
  PRODUCT_CASE_PRE_IDENTITY_OUTPUT_WARNING,
  PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES,
  productCaseOutputMismatchPaths,
  reevaluateProductCaseEvidence,
  refreshProductCaseLegacyImportAuditForExport,
  resolveLunaSourceContractGuard,
  saveHumanIdentityReviewRecord,
  serializeProductCaseWorkspaceExport,
  transitionProductCaseSupplierCapture,
  validateLunaProductUrl,
  validateHumanIdentityReviewIntegrity,
  validateManualAuthenticatedVisibleSourceText,
  validateHumanVisualReviewIntegrity,
  validateProductCaseDocumentProvenance,
  validateProductCaseDocumentProvenanceIntegrity,
  validateProductCaseImageAnalysis,
  validateProductCaseImportFileMetadata,
  validateProductCaseImportJsonCandidate,
} from "./product-case-runner.ts"
import {
  canonicalizeLunaProductSourceUrl,
  isPublicProductCaseSourceAddress,
  preflightLunaProductSource,
  PRODUCT_CASE_RUNNER_MAX_SOURCE_BYTES,
} from "./product-case-runner-preflight.ts"
import {
  ELECTRIC_RAZOR_LUNA_CONTRACT_SANITIZED_SNAPSHOT,
  ELECTRIC_RAZOR_INVENTORY_FIRST_SANITIZED_SNAPSHOT,
  GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE,
  GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT,
  GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT_SHA256,
  GOLF_SWING_TRAINER_EXACT_BLOCKERS,
  GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT,
  GOLF_SWING_TRAINER_PUBLIC_SNAPSHOT_SHA256,
  GOLF_SWING_TRAINER_VISUAL_REVIEW_SNAPSHOT,
  GOLF_SWING_TRAINER_VISUAL_REVIEW_SNAPSHOT_SHA256,
  LUNA_CONCATENATED_PRICES_SANITIZED_SNAPSHOT,
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

function visualRawInput(overrides = {}) {
  return {
    imageId: "manual-image-reference-1",
    sourceUrl: "",
    sourceReference: "MANUAL_IMAGE_REFERENCE:manual-image-reference-1",
    observedProductType: "",
    visibleFeatures: "Black handheld object visible",
    visibleText: "",
    visibleBrands: "",
    visibleColors: "BLACK",
    visibleQuantity: "1",
    observedVariant: "BLACK",
    possibleConflicts: "",
    confidence: "MEDIUM",
    humanDecision: "ACCEPT_FOR_ANALYSIS",
    humanReason: "Human observation recorded for analysis only.",
    ...overrides,
  }
}

function visualReviewInput(document, overrides = {}) {
  const {
    rawHumanInput: rawOverrides,
    ...directOverrides
  } = overrides
  const rawHumanInput = visualRawInput(rawOverrides)
  return {
    document,
    imageId: rawHumanInput.imageId,
    sourceUrl: rawHumanInput.sourceUrl || null,
    sourceReference: rawHumanInput.sourceReference,
    reviewerType: "HUMAN",
    observedProductType: rawHumanInput.observedProductType || null,
    visibleFeatures: rawHumanInput.visibleFeatures
      ? rawHumanInput.visibleFeatures.split("\n") : [],
    visibleText: rawHumanInput.visibleText
      ? rawHumanInput.visibleText.split("\n") : [],
    visibleBrands: rawHumanInput.visibleBrands
      ? rawHumanInput.visibleBrands.split("\n") : [],
    visibleColors: rawHumanInput.visibleColors
      ? rawHumanInput.visibleColors.split("\n") : [],
    visibleQuantity: rawHumanInput.visibleQuantity
      ? Number(rawHumanInput.visibleQuantity) : null,
    observedVariant: rawHumanInput.observedVariant || null,
    possibleConflicts: rawHumanInput.possibleConflicts
      ? rawHumanInput.possibleConflicts.split("\n") : [],
    contradictsEvidenceIds: [],
    confidence: rawHumanInput.confidence,
    humanDecision: rawHumanInput.humanDecision,
    humanReason: rawHumanInput.humanReason,
    reviewedAt: CAPTURED_AT,
    rawHumanInput,
    ...directOverrides,
  }
}

function partialHumanIdentityReviewInput(document, overrides = {}) {
  const selectedSupplierEvidenceIds = document.evidence
    .filter((entry) =>
      ["title", "product_type"].includes(entry.field) &&
      entry.evidenceStatus !== "MISSING"
    )
    .map((entry) => entry.id)
  const selectedHumanObservationEvidenceIds =
    document.imageAnalysis.observations
      .slice(0, 1)
      .map((entry) => entry.evidenceId)
  const evidenceIds = [
    ...selectedSupplierEvidenceIds,
    ...selectedHumanObservationEvidenceIds,
  ]
  const rawHumanInput = {
    reviewer: "HUMAN_IDENTITY_REVIEWER",
    decision: "NEEDS_MORE_EVIDENCE",
    confidence: "LOW",
    humanReason:
      "El tipo general parece coincidir, pero faltan identificadores exactos.",
    evidenceIds: [...evidenceIds],
    sameGeneralProductTypeConfirmed: true,
    exactIdentityConfirmed: false,
    brandConfirmed: false,
    brand: "",
    model: "",
    mpn: "",
    supplierProductId: "",
    supplierSku: "",
    variantId: "",
    color: "",
    packQuantity: "",
    physicalProductVerified: false,
    physicalVerificationEvidenceIds: [],
    ...(overrides.rawHumanInput ?? {}),
  }
  return {
    document,
    reviewer: rawHumanInput.reviewer,
    reviewedAt: CAPTURED_AT,
    decision: rawHumanInput.decision,
    confidence: rawHumanInput.confidence,
    humanReason: rawHumanInput.humanReason,
    evidenceIds: [...rawHumanInput.evidenceIds],
    sameGeneralProductTypeConfirmed:
      rawHumanInput.sameGeneralProductTypeConfirmed,
    exactIdentityConfirmed: rawHumanInput.exactIdentityConfirmed,
    brandConfirmed: rawHumanInput.brandConfirmed,
    brand: rawHumanInput.brand || null,
    model: rawHumanInput.model || null,
    mpn: rawHumanInput.mpn || null,
    supplierProductId: rawHumanInput.supplierProductId || null,
    supplierSku: rawHumanInput.supplierSku || null,
    variantId: rawHumanInput.variantId || null,
    color: rawHumanInput.color || null,
    packQuantity: rawHumanInput.packQuantity === ""
      ? null
      : Number(rawHumanInput.packQuantity),
    physicalProductVerified: false,
    physicalVerificationEvidenceIds:
      [...rawHumanInput.physicalVerificationEvidenceIds],
    rawHumanInput,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== "rawHumanInput"),
    ),
  }
}

function canonicalHumanIdentityReviewInput(document, overrides = {}) {
  const review = document.identityReview.humanReview
  assert.ok(review)
  const rawHumanInput = {
    ...structuredClone(review.rawHumanInput),
    ...(overrides.rawHumanInput ?? {}),
  }
  return {
    document,
    reviewer: review.reviewer,
    reviewedAt: review.reviewedAt,
    decision: review.decision,
    confidence: review.confidence,
    humanReason: review.humanReason,
    evidenceIds: [...review.evidenceIds],
    sameGeneralProductTypeConfirmed:
      review.sameGeneralProductTypeConfirmed,
    exactIdentityConfirmed: review.exactIdentityConfirmed,
    brandConfirmed: review.brandConfirmed,
    brand: review.brand,
    model: review.model,
    mpn: review.mpn,
    supplierProductId: review.supplierProductId,
    supplierSku: review.supplierSku,
    variantId: review.variantId,
    color: review.color,
    packQuantity: review.packQuantity,
    physicalProductVerified: review.physicalProductVerified,
    physicalVerificationEvidenceIds: [
      ...review.physicalVerificationEvidenceIds,
    ],
    rawHumanInput,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== "rawHumanInput"),
    ),
  }
}

const PILOT_URL =
  "https://lunaportex.com/products/smart-inflatable-golf-ball-swing-trainer-black"
const INTERACTIVE_ACCEPTANCE_URL =
  "https://lunaportex.com/products/sanitized-rechargeable-device"
const INTERACTIVE_ACCEPTANCE_TEXT = `Product title: Portable Rechargeable Device
Regular price: USD 39.99
Sale price: USD 29.50
Currency: USD
Stock: 1250 units available
Charging time: 2 hours
Autonomy: 90 minutes
IP rating: IPX7
Battery: 1200 mAh lithium
Power: 5 W
Included accessories: Charging cable, cleaning brush, storage pouch
Available variants: Black, Silver
Marketing claims: Ultimate professional results guaranteed`
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

function legacyVisualWorkspace(
  currentWorkspace =
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
) {
  const workspaceState = structuredClone(currentWorkspace)
  delete workspaceState.document.identityReview.humanReview
  const primaryImageId = workspaceState.imageObservations[0]?.imageId
  assert.ok(primaryImageId)
  for (const observation of workspaceState.imageObservations) {
    delete observation.contractVersion
    delete observation.rawHumanInput
  }
  for (const observation of
    workspaceState.document.imageAnalysis.observations) {
    delete observation.contractVersion
    delete observation.rawHumanInput
  }
  const sanitizedObservation = workspaceState.imageObservations.find(
    (entry) => entry.imageId === primaryImageId,
  )
  if (sanitizedObservation) {
    const currentEvidenceId = sanitizedObservation.evidenceId
    const legacyEvidenceId = "san-visual-observation"
    const legacyContentHash =
      "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
    const legacyValue =
      "Human confirmed the sanitized source image matches the reviewed variant."
    for (const observation of [
      sanitizedObservation,
      workspaceState.document.imageAnalysis.observations.find(
        (entry) => entry.imageId === primaryImageId,
      ),
    ]) {
      assert.ok(observation)
      observation.evidenceId = legacyEvidenceId
      observation.contentHash = legacyContentHash
      observation.reviewerType = "CHATGPT_ASSISTED_HUMAN"
    }
    const evidence = workspaceState.document.evidence.find(
      (entry) => entry.id === currentEvidenceId,
    )
    assert.ok(evidence)
    evidence.id = legacyEvidenceId
    evidence.contentHash = legacyContentHash
    evidence.extractionPath = "sanitized.visual_observation"
    evidence.rawValue = legacyValue
    evidence.normalizedValue = legacyValue
    evidence.originalValue = legacyValue
    evidence.humanReason = null
    const capture = workspaceState.document.captures.find((entry) =>
      entry.sourceType === "HUMAN_VISUAL_OBSERVATION"
    )
    assert.ok(capture)
    capture.contentHash = legacyContentHash
    capture.byteLength = 256
    workspaceState.document.identityReview.humanObservationEvidenceIds =
      [legacyEvidenceId]
  }
  return workspaceState
}

function stableTestValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableTestValue).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableTestValue(value[key])}`
    ).join(",")}}`
  }
  return JSON.stringify(value) ?? String(value)
}

function legacyVisualCanonicalRecord(observation) {
  return {
    imageId: observation.imageId,
    sourceUrl: observation.sourceUrl,
    sourceReference: observation.sourceReference,
    reviewerType: observation.reviewerType,
    observedProductType: observation.observedProductType,
    visibleFeatures: observation.visibleFeatures,
    visibleText: observation.visibleText,
    visibleBrands: observation.visibleBrands,
    visibleColors: observation.visibleColors,
    visibleQuantity: observation.visibleQuantity,
    observedVariant: observation.observedVariant,
    possibleConflicts: observation.possibleConflicts,
    contradictsEvidenceIds: observation.contradictsEvidenceIds,
    confidence: observation.confidence,
    humanDecision: observation.humanDecision,
    humanReason: observation.humanReason,
    reviewedAt: observation.reviewedAt,
  }
}

function verifiableLegacyVisualWorkspace(
  currentWorkspace =
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
) {
  const workspaceState = structuredClone(currentWorkspace)
  const document = workspaceState.document
  delete document.identityReview.humanReview
  const captureTemplate = document.captures.find((entry) =>
    entry.sourceType === "HUMAN_VISUAL_OBSERVATION"
  )
  assert.ok(captureTemplate)
  const replacements = new Map()
  const legacyCaptures = []
  for (const observation of document.imageAnalysis.observations) {
    const currentEvidenceId = observation.evidenceId
    delete observation.contractVersion
    delete observation.rawHumanInput
    const canonical = legacyVisualCanonicalRecord(observation)
    const serialized = stableTestValue(canonical)
    const contentHash = `sha256:${
      createHash("sha256").update(serialized).digest("hex")
    }`
    const evidenceId =
      `visual-${contentHash.slice(7, 19)}-${observation.imageId}`
    observation.contentHash = contentHash
    observation.evidenceId = evidenceId
    replacements.set(currentEvidenceId, evidenceId)

    const evidence = document.evidence.find((entry) =>
      entry.id === currentEvidenceId
    )
    assert.ok(evidence)
    evidence.id = evidenceId
    evidence.contentHash = contentHash
    evidence.capturedAt = observation.reviewedAt
    evidence.sourceUrl = document.sourceUrl
    evidence.extractionPath =
      `humanVisualReview.${observation.imageId}`
    evidence.evidenceClass = "HUMAN_VISUAL_REVIEW"
    evidence.sourceEvidenceClass = "HUMAN_VISUAL_REVIEW"
    evidence.humanReason = observation.humanReason
    evidence.rawValue = structuredClone(canonical)
    evidence.normalizedValue = structuredClone(canonical)
    evidence.originalValue = structuredClone(canonical)
    evidence.correctedValue = null
    legacyCaptures.push({
      ...structuredClone(captureTemplate),
      sourceUrl: document.sourceUrl,
      capturedAt: observation.reviewedAt,
      contentHash,
      format: "JSON",
      byteLength: Buffer.byteLength(serialized),
    })
  }
  const replaceReferences = (value) => {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const child = value[index]
        if (typeof child === "string" && replacements.has(child)) {
          value[index] = replacements.get(child)
        } else {
          replaceReferences(child)
        }
      }
      return
    }
    if (!value || typeof value !== "object") return
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string" && replacements.has(child)) {
        value[key] = replacements.get(child)
      } else {
        replaceReferences(child)
      }
    }
  }
  document.captures = document.captures.filter((entry) =>
    entry.sourceType !== "HUMAN_VISUAL_OBSERVATION"
  ).concat(legacyCaptures)
  workspaceState.imageObservations = structuredClone(
    document.imageAnalysis.observations,
  )
  replaceReferences(workspaceState)
  return workspaceState
}

function historicalOutputBeforePersistentVisualGate(
  workspaceState,
  currentWorkspace =
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
) {
  const auditWorkspace = structuredClone(workspaceState)
  const currentObservations = currentWorkspace.imageObservations
  for (const observation of auditWorkspace.imageObservations) {
    const current = currentObservations.find((entry) =>
      entry.imageId === observation.imageId
    )
    assert.ok(current)
    observation.contractVersion = current.contractVersion
    observation.rawHumanInput = structuredClone(current.rawHumanInput)
  }
  for (const observation of
    auditWorkspace.document.imageAnalysis.observations) {
    const current = currentObservations.find((entry) =>
      entry.imageId === observation.imageId
    )
    assert.ok(current)
    observation.contractVersion = current.contractVersion
    observation.rawHumanInput = structuredClone(current.rawHumanInput)
  }
  const historicalOutput = buildWorkspaceOutput(auditWorkspace)
  for (const observation of
    historicalOutput.document.imageAnalysis.observations) {
    delete observation.contractVersion
    delete observation.rawHumanInput
  }
  return historicalOutput
}

function authenticLegacyOutputEnvelope(
  currentWorkspace =
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
) {
  const workspaceState = verifiableLegacyVisualWorkspace(currentWorkspace)
  const envelope = createProductCaseWorkspaceExport({
    workspaceState,
    exportedAt: CAPTURED_AT,
  })
  envelope.version = "PRODUCT_CASE_WORKSPACE_EXPORT_V1"
  delete envelope.outputContractVersion
  envelope.output = historicalOutputBeforePersistentVisualGate(
    workspaceState,
    currentWorkspace,
  )
  return envelope
}

function coherentStringLegacyOutputEnvelope(
  currentWorkspace =
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
) {
  const workspaceState = legacyVisualWorkspace(currentWorkspace)
  const envelope = createProductCaseWorkspaceExport({
    workspaceState,
    exportedAt: CAPTURED_AT,
  })
  envelope.version = "PRODUCT_CASE_WORKSPACE_EXPORT_V1"
  delete envelope.outputContractVersion
  envelope.output = historicalOutputBeforePersistentVisualGate(
    workspaceState,
    currentWorkspace,
  )
  return envelope
}

async function rehashLegacyImportAudit(audit) {
  const hashPayload = structuredClone(audit)
  delete hashPayload.historicalOutputContentHash
  audit.historicalOutputContentHash = await hashProductCaseContent(
    stableTestValue(hashPayload),
  )
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
  const trackedUrl =
    "https://lunaportex.com/products/example-product?_pos=2&_sid=sanitized-session&_ss=r"
  assert.equal(
    canonicalizeLunaProductSourceUrl(trackedUrl),
    "https://lunaportex.com/products/example-product",
  )
  assert.deepEqual(validateLunaProductUrl(trackedUrl), {
    valid: true,
    canonicalUrl: "https://lunaportex.com/products/example-product",
    host: "lunaportex.com",
    handle: "example-product",
  })

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

test("captura autenticada interactiva separa precios, stock, specs, claims y MISSING", async () => {
  const extraction = await extractProductCaseEvidence({
    sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
    capturedAt: CAPTURED_AT,
    content: INTERACTIVE_ACCEPTANCE_TEXT,
    format: "TEXT",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  const present = extraction.evidence.filter((entry) =>
    entry.evidenceStatus !== "MISSING"
  )
  const byField = (field) => present.filter((entry) =>
    entry.field === field
  )

  assert.deepEqual(
    byField("regular_price").map((entry) => entry.normalizedValue),
    [39.99],
  )
  assert.deepEqual(
    byField("sale_price").map((entry) => entry.normalizedValue),
    [29.5],
  )
  assert.equal(byField("supplier_price").length, 0)
  assert.equal(byField("visible_stock")[0]?.normalizedValue, 1250)
  assert.equal(
    byField("visible_stock")[0]?.availabilityPurpose,
    "INVENTORY_SIGNAL",
  )
  assert.equal(byField("visible_stock")[0]?.demandEvidence, "NONE")
  assert.deepEqual(
    byField("supplier_specification").map((entry) =>
      entry.normalizedValue
    ),
    [
      "Charging time: 2 hours",
      "Autonomy: 90 minutes",
      "IP rating: IPX7",
      "Battery: 1200 mAh lithium",
      "Power: 5 W",
    ],
  )
  assert.equal(
    byField("accessories")[0]?.normalizedValue,
    "Charging cable, cleaning brush, storage pouch",
  )
  assert.equal(byField("option_value")[0]?.normalizedValue, "Black, Silver")
  assert.equal(
    byField("marketing_claim")[0]?.evidenceClass,
    "SUPPLIER_MARKETING_CLAIM",
  )
  assert.equal(
    extraction.evidence.find((entry) =>
      entry.field === "outbound_shipping_cost"
    )?.normalizedValue,
    null,
  )
  assert.equal(
    extraction.evidence.find((entry) =>
      entry.field === "packaging_cost"
    )?.evidenceClass,
    "MISSING",
  )

  const sourceCapture = await createManualAuthenticatedSupplierSourceCapture({
    supplierUrl: INTERACTIVE_ACCEPTANCE_URL,
    rawVisibleSourceText: INTERACTIVE_ACCEPTANCE_TEXT,
    sourceAccessStatus: "AUTHENTICATED_SOURCE_REQUIRED",
    extraction,
    humanVisibleProductTextConfirmed: true,
  })
  assert.equal(
    sourceCapture.sourceCaptureMethod,
    "MANUAL_AUTHENTICATED_PASTE",
  )
  assert.equal(
    sourceCapture.rawVisibleSourceText,
    INTERACTIVE_ACCEPTANCE_TEXT,
  )
  assert.equal(
    sourceCapture.sensitiveContentAssessment,
    "NO_SENSITIVE_PATTERN_DETECTED",
  )
  assert.equal(sourceCapture.humanVisibleProductTextConfirmed, true)
  assert.equal(sourceCapture.fullHtmlAccepted, false)
  assert.equal(sourceCapture.parserVersion, PRODUCT_CASE_PARSER_VERSION)
  assert.equal(
    sourceCapture.sourceContractVersion,
    LUNA_SOURCE_CONTRACT_VERSION,
  )
  assert.equal(sourceCapture.parseHealth, "PARSED_OK")
  assert.equal(sourceCapture.stockState, "IN_STOCK_SIGNAL")
})

test("regresión: precios Luna concatenados conservan amount y currency", async () => {
  for (const line of [
    LUNA_CONCATENATED_PRICES_SANITIZED_SNAPSHOT,
    "Regular price $14.50 USD Sale price $11.56 USD Sale",
  ]) {
    const extraction = await extractProductCaseEvidence({
      sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
      capturedAt: CAPTURED_AT,
      content: line,
      format: "TEXT",
      sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    })
    const present = extraction.evidence.filter((entry) =>
      entry.evidenceStatus !== "MISSING"
    )
    const byField = (field) => present.filter((entry) =>
      entry.field === field
    )

    assert.deepEqual(
      byField("regular_price").map((entry) => ({
        amount: entry.normalizedValue,
        rawValue: entry.rawValue,
      })),
      [{ amount: 14.5, rawValue: "$14.50 USD" }],
      line,
    )
    assert.deepEqual(
      byField("sale_price").map((entry) => ({
        amount: entry.normalizedValue,
        rawValue: entry.rawValue,
      })),
      [{ amount: 11.56, rawValue: "$11.56 USD" }],
      line,
    )
    assert.deepEqual(
      byField("currency").map((entry) => entry.normalizedValue),
      ["USD"],
      line,
    )
    assert.equal(byField("supplier_unit_cost").length, 0, line)
    assert.equal(byField("supplier_price").length, 0, line)
    assert.equal(extraction.parserVersion, PRODUCT_CASE_PARSER_VERSION)
    assert.equal(
      extraction.sourceContractVersion,
      LUNA_SOURCE_CONTRACT_VERSION,
    )
    assert.equal(extraction.parseHealth, "PARSED_OK")
    assert.equal(extraction.stockState, "STOCK_UNKNOWN")
    assert.equal(extraction.safety.ebayWrites, 0)
    assert.equal(extraction.safety.canPublishAutomatically, false)
  }
})

test("fixture Luna sanitizado extrae specs, packing y bloques promocionales completos", async () => {
  const extraction = await extractProductCaseEvidence({
    sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
    capturedAt: CAPTURED_AT,
    content: ELECTRIC_RAZOR_LUNA_CONTRACT_SANITIZED_SNAPSHOT,
    format: "TEXT",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  const present = extraction.evidence.filter((entry) =>
    entry.evidenceStatus !== "MISSING"
  )
  const byField = (field) => present.filter((entry) =>
    entry.field === field
  )

  assert.equal(extraction.parseHealth, "PARSED_OK")
  assert.equal(extraction.stockState, "IN_STOCK_SIGNAL")
  assert.equal(present.length, 24)
  assert.deepEqual(
    byField("supplier_specification").map((entry) => entry.normalizedValue),
    [
      "Shave time per charge: 99 mins",
      "Waterproof rated: IPX6",
      "Rated power: 5W",
      "How to use: use while charging or use cordless",
      "Charging: Equipped with USB data cable",
    ],
  )
  assert.deepEqual(
    byField("warnings").map((entry) => entry.rawValue),
    ["(DO NOT including transformer/adapter/charger)"],
  )

  const packingLines = [
    "1 * men electric razor",
    "1 * USB charging cable(Type-C charging interface)",
    "1 * Clean brush",
    "1 * User manual",
  ]
  assert.deepEqual(
    byField("contents").map((entry) => entry.rawValue),
    packingLines,
  )
  assert.deepEqual(
    byField("contents").map((entry) => entry.normalizedValue),
    [
      { quantity: 1, item: "men electric razor" },
      {
        quantity: 1,
        item: "USB charging cable(Type-C charging interface)",
      },
      { quantity: 1, item: "Clean brush" },
      { quantity: 1, item: "User manual" },
    ],
  )
  assert.deepEqual(
    byField("accessories").map((entry) => entry.rawValue),
    packingLines.slice(1),
  )

  const marketingNarratives = [
    {
      rawValue:
        "A cordless wet and dry electric razor promoted for everyday home and travel use.",
      normalizedValue: {
        sectionTitle: "Supplier introduction",
        body:
          "A cordless wet and dry electric razor promoted for everyday home and travel use.",
      },
    },
    {
      rawValue:
        "Close shave\nFloating heads are promoted as following facial contours for a close shave and a comfortable routine.",
      normalizedValue: {
        sectionTitle: "Close shave",
        body:
          "Floating heads are promoted as following facial contours for a close shave and a comfortable routine.",
      },
    },
    {
      rawValue:
        "Easy to clean\nThe washable body is presented as making rinsing easier and safer after use.",
      normalizedValue: {
        sectionTitle: "Easy to clean",
        body:
          "The washable body is presented as making rinsing easier and safer after use.",
      },
    },
    {
      rawValue:
        "Pop-up sideburns\nThe pop-up trimmer is promoted for shaping sideburns and beard edges.",
      normalizedValue: {
        sectionTitle: "Pop-up sideburns",
        body:
          "The pop-up trimmer is promoted for shaping sideburns and beard edges.",
      },
    },
    {
      rawValue:
        "Dry and wet shaving\nThe supplier says it can be used for dry shaving or with water and shaving foam.",
      normalizedValue: {
        sectionTitle: "Dry and wet shaving",
        body:
          "The supplier says it can be used for dry shaving or with water and shaving foam.",
      },
    },
    {
      rawValue:
        "Fast charging and durable\nThe supplier promotes fast charging and says one charge can support up to one month of typical use.",
      normalizedValue: {
        sectionTitle: "Fast charging and durable",
        body:
          "The supplier promotes fast charging and says one charge can support up to one month of typical use.",
      },
    },
  ]
  assert.deepEqual(
    byField("marketing_claim").map((entry) => ({
      rawValue: entry.rawValue,
      normalizedValue: entry.normalizedValue,
    })),
    marketingNarratives,
  )
  assert.equal(
    byField("marketing_claim").every((entry) =>
      entry.evidenceClass === "SUPPLIER_MARKETING_CLAIM" &&
      entry.sourceEvidenceClass === "SUPPLIER_MARKETING_CLAIM"
    ),
    true,
  )
  assert.equal(
    new Set(
      byField("marketing_claim").map((entry) =>
        JSON.stringify([entry.rawValue, entry.normalizedValue])
      ),
    ).size,
    marketingNarratives.length,
  )
  assert.deepEqual(
    byField("title").map((entry) => entry.normalizedValue),
    ["Electric Razor for Men,Shavers for Men Electric Razor Wet Dry"],
  )
  assert.equal(
    byField("title").some((entry) =>
      byField("marketing_claim").some((claim) =>
        claim.rawValue === entry.rawValue
      )
    ),
    false,
  )
  const promotionalPhrases =
    /\b(?:floating heads|close shave|safer|one month)\b/i
  assert.equal(
    present.filter((entry) =>
      entry.field !== "marketing_claim" &&
      promotionalPhrases.test(JSON.stringify(entry.normalizedValue))
    ).length,
    0,
  )

  const adapter = buildStrategyLabAdapterPreview({
    document: {
      ...structuredClone(GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document),
      sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
      evidence: extraction.evidence,
    },
    evaluatedAt: CAPTURED_AT,
    economicsPolicy:
      GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document.economicsPolicy,
    scenarioDraft:
      GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document.scenarioDraft,
  })
  assert.equal(
    byField("marketing_claim").every((claim) =>
      adapter.excludedEvidence.some((entry) =>
        entry.evidenceId === claim.id &&
        entry.reason === "SUPPLIER_MARKETING_CLAIM_NOT_PRODUCT_FACT"
      )
    ),
    true,
  )
  assert.equal(
    byField("marketing_claim").every((claim) =>
      !adapter.acceptedRunnerEvidenceIds.includes(claim.id)
    ),
    true,
  )
  assert.equal(extraction.safety.ebayWrites, 0)
  assert.equal(extraction.safety.canPublishAutomatically, false)
})

test("bloque promocional conserva raw exacto, párrafos y límite de especificación", async () => {
  const narrativeRaw =
    "Close shave\r\n  Floating heads follow facial contours.  \r\n\r\nSafer handling is a supplier claim for one month of typical use."
  const extraction = await extractProductCaseEvidence({
    sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
    capturedAt: CAPTURED_AT,
    content:
      `Regular price: $14.50 USD\r\nNarrative Test Electric Razor\r\n${narrativeRaw}\r\nRated power: 5W\r\nPacking Include:\r\n1 * razor`,
    format: "TEXT",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  const present = extraction.evidence.filter((entry) =>
    entry.evidenceStatus !== "MISSING"
  )
  const claim = present.find((entry) =>
    entry.field === "marketing_claim" &&
    entry.normalizedValue?.sectionTitle === "Close shave"
  )

  assert.equal(extraction.parseHealth, "PARSED_OK")
  assert.equal(claim?.rawValue, narrativeRaw)
  assert.deepEqual(claim?.normalizedValue, {
    sectionTitle: "Close shave",
    body:
      "Floating heads follow facial contours.\n\nSafer handling is a supplier claim for one month of typical use.",
  })
  assert.deepEqual(
    present.filter((entry) =>
      entry.field === "supplier_specification"
    ).map((entry) => entry.rawValue),
    ["Rated power: 5W"],
  )
  assert.equal(
    present.filter((entry) =>
      entry.field === "marketing_claim" &&
      entry.rawValue === narrativeRaw
    ).length,
    1,
  )
  assert.equal(extraction.safety.ebayWrites, 0)
  assert.equal(extraction.safety.canPublishAutomatically, false)
})

test("etiquetas Luna reconocibles sin evidencia fuerzan SOURCE_FORMAT_CHANGED", async () => {
  const cases = [
    ["SHAVE_TIME_PER_CHARGE", "Shave time per charge:"],
    ["WATERPROOF_RATED", "Waterproof rated:"],
    ["RATED_POWER", "Rated power:"],
    ["HOW_TO_USE", "How to use:"],
    ["CHARGING", "Charging:"],
    ["PACKING_INCLUDE", "Packing Include:"],
    ["PACKING_INCLUDE_ITEM", "1 * product without packing header"],
    [
      "MARKETING_SECTION_CLOSE_SHAVE",
      "Close shave\nMore information",
    ],
  ]
  for (const [failureCode, recognizableLine] of cases) {
    const extraction = await extractProductCaseEvidence({
      sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
      capturedAt: CAPTURED_AT,
      content:
        `${recognizableLine}\nPortable Rechargeable Device for Travel`,
      format: "TEXT",
      sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    })
    assert.equal(
      extraction.parseHealth,
      "SOURCE_FORMAT_CHANGED",
      failureCode,
    )
    assert.equal(
      extraction.parserWarnings.includes(
        `LUNA_SOURCE_CONTRACT_UNEXTRACTED:${failureCode}`,
      ),
      true,
      failureCode,
    )
    assert.equal(extraction.safety.ebayWrites, 0, failureCode)
    assert.equal(
      extraction.safety.canPublishAutomatically,
      false,
      failureCode,
    )
  }
})

test("precios ya procesados no se retokenizan sin reprocesar la captura", async () => {
  const legacyExtraction = await extractProductCaseEvidence({
    sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
    capturedAt: CAPTURED_AT,
    content: "Regular price: USD 14.50",
    format: "TEXT",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  const legacyEvidence = structuredClone(legacyExtraction.evidence)
  const regularPrice = legacyEvidence.find((entry) =>
    entry.field === "regular_price"
  )
  assert.ok(regularPrice)
  regularPrice.rawValue = LUNA_CONCATENATED_PRICES_SANITIZED_SNAPSHOT
  regularPrice.originalValue = LUNA_CONCATENATED_PRICES_SANITIZED_SNAPSHOT

  const reevaluated = reevaluateProductCaseEvidence(legacyEvidence)
  const salePrice = reevaluated.find((entry) => entry.field === "sale_price")
  assert.equal(salePrice?.evidenceStatus, "MISSING")
  assert.equal(salePrice?.normalizedValue, null)
  assert.equal(
    reevaluated.find((entry) => entry.field === "regular_price")
      ?.normalizedValue,
    14.5,
  )
})

test("regresión: inventario inicial no suplanta el título ni se convierte en demanda", async () => {
  const trackedUrl =
    "https://lunaportex.com/products/electric-razor-men?_pos=1&_sid=sanitized&_ss=r"
  const extraction = await extractProductCaseEvidence({
    sourceUrl: trackedUrl,
    capturedAt: CAPTURED_AT,
    content: ELECTRIC_RAZOR_INVENTORY_FIRST_SANITIZED_SNAPSHOT,
    format: "TEXT",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  const present = extraction.evidence.filter((entry) =>
    entry.evidenceStatus !== "MISSING"
  )
  const titles = present.filter((entry) => entry.field === "title")
  const stock = present.find((entry) => entry.field === "visible_stock")

  assert.deepEqual(
    titles.map((entry) => entry.normalizedValue),
    ["Electric Razor for Men,Shavers for Men Electric Razor Wet Dry"],
  )
  assert.equal(
    titles.some((entry) => entry.rawValue === "643 units available"),
    false,
  )
  assert.equal(stock?.normalizedValue, 643)
  assert.equal(stock?.availabilityPurpose, "INVENTORY_SIGNAL")
  assert.equal(stock?.demandEvidence, "NONE")
  assert.equal(
    extraction.capture.sourceUrl,
    "https://lunaportex.com/products/electric-razor-men",
  )
})

test("variantes visibles de stock producen sólo INVENTORY_SIGNAL", async () => {
  for (const [line, expected] of [
    ["643 units available", 643],
    ["1 unit available", 1],
    ["643 available", 643],
    ["In stock: 643", 643],
    ["Stock: 643", 643],
  ]) {
    const extraction = await extractProductCaseEvidence({
      sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
      capturedAt: CAPTURED_AT,
      content: `${line}\nPortable Rechargeable Device`,
      format: "TEXT",
      sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    })
    const stock = extraction.evidence.find((entry) =>
      entry.field === "visible_stock" &&
      entry.evidenceStatus !== "MISSING"
    )
    const title = extraction.evidence.find((entry) =>
      entry.field === "title" &&
      entry.evidenceStatus !== "MISSING"
    )
    assert.equal(stock?.normalizedValue, expected, line)
    assert.equal(stock?.availabilityPurpose, "INVENTORY_SIGNAL", line)
    assert.equal(stock?.demandEvidence, "NONE", line)
    assert.equal(title?.normalizedValue, "Portable Rechargeable Device", line)
    assert.equal(extraction.parseHealth, "PARSED_OK", line)
    assert.equal(extraction.stockState, "IN_STOCK_SIGNAL", line)
    assert.equal(extraction.safety.ebayWrites, 0, line)
  }
})

test("Out of stock y Sold out no inventan stock cero", async () => {
  for (const line of ["Out of stock", "Sold out"]) {
    const extraction = await extractProductCaseEvidence({
      sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
      capturedAt: CAPTURED_AT,
      content: `${line}\nPortable Rechargeable Device`,
      format: "TEXT",
      sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    })
    const stock = extraction.evidence.find((entry) =>
      entry.field === "visible_stock"
    )
    assert.equal(extraction.parseHealth, "PARSED_OK", line)
    assert.equal(extraction.stockState, "OUT_OF_STOCK_SIGNAL", line)
    assert.equal(stock?.evidenceStatus, "MISSING", line)
    assert.equal(stock?.normalizedValue, null, line)
    assert.equal(
      extraction.evidence.find((entry) =>
        entry.field === "title" && entry.evidenceStatus !== "MISSING"
      )?.normalizedValue,
      "Portable Rechargeable Device",
      line,
    )
    assert.equal(extraction.safety.ebayWrites, 0, line)
  }
})

test("etiquetas y availability estructurada activan OUT_OF_STOCK_SIGNAL", async () => {
  const cases = [
    {
      name: "availability label",
      content: "Availability: Out of stock\nPortable Rechargeable Device",
      format: "TEXT",
    },
    {
      name: "stock label",
      content: "Stock: Sold out\nPortable Rechargeable Device",
      format: "TEXT",
    },
    {
      name: "JSON-LD availability",
      content: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Portable Rechargeable Device",
        offers: {
          "@type": "Offer",
          availability: "https://schema.org/OutOfStock",
        },
      }),
      format: "JSON_LD",
    },
    {
      name: "structured meta availability",
      content: `<html><head>
<meta property="product:availability" content="sold out">
</head><body><h1>Portable Rechargeable Device</h1></body></html>`,
      format: "HTML_AS_TEXT",
    },
  ]
  for (const fixture of cases) {
    const extraction = await extractProductCaseEvidence({
      sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
      capturedAt: CAPTURED_AT,
      content: fixture.content,
      format: fixture.format,
      sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    })
    assert.equal(extraction.parseHealth, "PARSED_OK", fixture.name)
    assert.equal(
      extraction.stockState,
      "OUT_OF_STOCK_SIGNAL",
      fixture.name,
    )
    assert.equal(extraction.safety.ebayWrites, 0, fixture.name)
    assert.equal(
      extraction.safety.canPublishAutomatically,
      false,
      fixture.name,
    )
  }
})

test("frases descriptivas de agotado no son señales de inventario", async () => {
  const cases = [
    {
      name: "plain product description",
      content: `Portable Rechargeable Device
This product sold out quickly last year`,
      format: "TEXT",
    },
    {
      name: "plain product claim",
      content: `Portable Rechargeable Device
Avoid out of stock problems`,
      format: "TEXT",
    },
    {
      name: "structured description and claim",
      content: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Portable Rechargeable Device",
        description: "This product sold out quickly last year",
        claims: ["Avoid out of stock problems"],
      }),
      format: "JSON_LD",
    },
  ]
  for (const fixture of cases) {
    const extraction = await extractProductCaseEvidence({
      sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
      capturedAt: CAPTURED_AT,
      content: fixture.content,
      format: fixture.format,
      sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
    })
    const stock = extraction.evidence.find((entry) =>
      entry.field === "visible_stock"
    )
    assert.equal(extraction.parseHealth, "PARSED_OK", fixture.name)
    assert.equal(extraction.stockState, "STOCK_UNKNOWN", fixture.name)
    assert.equal(stock?.evidenceStatus, "MISSING", fixture.name)
    assert.equal(stock?.normalizedValue, null, fixture.name)
    assert.equal(extraction.safety.ebayWrites, 0, fixture.name)
    assert.equal(
      extraction.safety.canPublishAutomatically,
      false,
      fixture.name,
    )
  }
})

test("ausencia de inventario queda STOCK_UNKNOWN y nunca equivale a cero", async () => {
  const extraction = await extractProductCaseEvidence({
    sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
    capturedAt: CAPTURED_AT,
    content: "Portable Rechargeable Device",
    format: "TEXT",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  const stock = extraction.evidence.find((entry) =>
    entry.field === "visible_stock"
  )
  assert.equal(extraction.parseHealth, "PARSED_OK")
  assert.equal(extraction.stockState, "STOCK_UNKNOWN")
  assert.equal(stock?.evidenceStatus, "MISSING")
  assert.equal(stock?.normalizedValue, null)
  assert.equal(extraction.safety.ebayWrites, 0)
})

test("señal reconocible no extraída marca SOURCE_FORMAT_CHANGED sin inferir OOS", async () => {
  const extraction = await extractProductCaseEvidence({
    sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
    capturedAt: CAPTURED_AT,
    content: `Regular price unavailable
Portable Rechargeable Device`,
    format: "TEXT",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  assert.equal(extraction.parseHealth, "SOURCE_FORMAT_CHANGED")
  assert.equal(extraction.stockState, "STOCK_UNKNOWN")
  assert.equal(
    extraction.parserWarnings.includes(
      "LUNA_SOURCE_CONTRACT_UNEXTRACTED:REGULAR_PRICE",
    ),
    true,
  )
  assert.equal(extraction.safety.ebayWrites, 0)
  assert.equal(extraction.safety.canPublishAutomatically, false)
})

test("SOURCE_FORMAT_CHANGED bloquea cualquier preparación eBay", async () => {
  const workspaceState = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
  )
  const extraction = await extractProductCaseEvidence({
    sourceUrl: workspaceState.document.sourceUrl,
    capturedAt: CAPTURED_AT,
    content: `Regular price unavailable
Sanitized Deterministic Product`,
    format: "TEXT",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  const supplierSourceCapture =
    await createManualAuthenticatedSupplierSourceCapture({
      supplierUrl: workspaceState.document.sourceUrl,
      rawVisibleSourceText: `Regular price unavailable
Sanitized Deterministic Product`,
      sourceAccessStatus: "AUTHENTICATED_SOURCE_REQUIRED",
      extraction,
      humanVisibleProductTextConfirmed: true,
    })
  workspaceState.document.supplierSourceCapture = supplierSourceCapture
  workspaceState.document.captures.push(extraction.capture)

  const output = buildWorkspaceOutput(workspaceState)
  assert.equal(output.document.safety.ebayWrites, 0)
  assert.equal(output.safety.ebayWrites, 0)
  assert.equal(output.canPublishAutomatically, false)
  assert.equal(output.manualHandoffAllowed, false)
  assert.equal(output.handoffArtifactGenerated, false)
  assert.equal(output.listingPackage, null)
})

test("señales de inventario contradictorias quedan STOCK_CONFLICTED", async () => {
  const extraction = await extractProductCaseEvidence({
    sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
    capturedAt: CAPTURED_AT,
    content: `643 units available
Out of stock
Portable Rechargeable Device`,
    format: "TEXT",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  assert.equal(extraction.parseHealth, "PARSED_OK")
  assert.equal(extraction.stockState, "STOCK_CONFLICTED")
  assert.equal(extraction.safety.ebayWrites, 0)
})

test("guard sin captura representa autenticación requerida de forma independiente", () => {
  assert.deepEqual(resolveLunaSourceContractGuard({
    sourceAccessStatus: "AUTHENTICATED_SOURCE_REQUIRED",
    supplierSourceCapture: null,
  }), {
    parserVersion: PRODUCT_CASE_PARSER_VERSION,
    sourceContractVersion: LUNA_SOURCE_CONTRACT_VERSION,
    parseHealth: "AUTHENTICATION_REQUIRED",
    stockState: "STOCK_UNKNOWN",
  })
})

test("contenido estructurado incompleto queda PARTIAL_EXTRACTION sin writes", async () => {
  const extraction = await extractProductCaseEvidence({
    sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
    capturedAt: CAPTURED_AT,
    content: "{\"product\":",
    format: "JSON",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  assert.equal(extraction.parseHealth, "PARTIAL_EXTRACTION")
  assert.equal(extraction.stockState, "STOCK_UNKNOWN")
  assert.equal(
    extraction.parserWarnings.includes("STRUCTURED_CONTENT_INVALID"),
    true,
  )
  assert.equal(extraction.safety.ebayWrites, 0)
  assert.equal(extraction.safety.canPublishAutomatically, false)
})

test("navegación, merchandising y precios no son candidatos de título", async () => {
  const extraction = await extractProductCaseEvidence({
    sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
    capturedAt: CAPTURED_AT,
    content: `Home
Top Sellers
New Arrivals & Restocks
Shop now
Free shipping on orders over $50
Only $29.99 Today
Portable Rechargeable Device for Travel`,
    format: "TEXT",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  const titles = extraction.evidence.filter((entry) =>
    entry.field === "title" &&
    entry.evidenceStatus !== "MISSING"
  )
  assert.deepEqual(
    titles.map((entry) => entry.normalizedValue),
    ["Portable Rechargeable Device for Travel"],
  )
})

test("la reevaluación no repara evidencia procesada; la corrección exige reprocesar", () => {
  const legacy = structuredClone(
    GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document.evidence,
  )
  const title = legacy.find((entry) => entry.field === "title")
  assert.ok(title)
  title.rawValue = "643 units available"
  title.normalizedValue = "643 units available"
  title.extractionPath = "text.line[0]"

  const reevaluated = reevaluateProductCaseEvidence(legacy)
  const unchangedTitle = reevaluated.find((entry) => entry.id === title.id)
  assert.equal(unchangedTitle?.rawValue, "643 units available")
  assert.equal(unchangedTitle?.normalizedValue, "643 units available")
  assert.equal(unchangedTitle?.field, "title")
})

test("Export JSON conserva texto fuente original y excluye claims de product facts", async () => {
  const extraction = await extractProductCaseEvidence({
    sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
    capturedAt: CAPTURED_AT,
    content: INTERACTIVE_ACCEPTANCE_TEXT,
    format: "TEXT",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  const supplierSourceCapture =
    await createManualAuthenticatedSupplierSourceCapture({
      supplierUrl: INTERACTIVE_ACCEPTANCE_URL,
      rawVisibleSourceText: INTERACTIVE_ACCEPTANCE_TEXT,
      sourceAccessStatus: "AUTHENTICATED_SOURCE_REQUIRED",
      extraction,
      humanVisibleProductTextConfirmed: true,
    })
  const base = structuredClone(
    GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document,
  )
  const document = {
    ...base,
    caseId: "interactive-acceptance-browser-case",
    productLabel: "Interactive acceptance case",
    sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
    createdAt: CAPTURED_AT,
    sourceAccess: {
      status: "AUTHENTICATED_SOURCE_REQUIRED",
      canonicalUrl: INTERACTIVE_ACCEPTANCE_URL,
      checkedAt: CAPTURED_AT,
      reason: "AUTHENTICATED_SOURCE_REQUIRED",
      httpStatus: 200,
      redirectsFollowed: 0,
      credentialsUsed: false,
    },
    supplierSourceCapture,
    captures: [extraction.capture],
    evidence: extraction.evidence,
    imageAnalysis: {
      ...base.imageAnalysis,
      visualEvidenceStatus: "NOT_REVIEWED",
      conflictDetectedFrom: [],
      observations: [],
    },
    identityReview: {
      ...base.identityReview,
      status: "NOT_REVIEWED",
      confidence: "LOW",
      supplierEvidenceIds: [],
      humanObservationEvidenceIds: [],
      blockers: ["HUMAN_IDENTITY_REVIEW_REQUIRED"],
      currentConflict: null,
      conflictHistory: [],
      nextAction: "REVIEW_PRODUCT_EVIDENCE",
    },
  }
  const workspaceState = {
    document,
    economicsPolicy: null,
    scenarioDraft: null,
    listingOperations: structuredClone(
      GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.listingOperations,
    ),
    imageApprovals: [],
    imageObservations: [],
    evaluatedAt: CAPTURED_AT,
    generatedAt: CAPTURED_AT,
  }
  const envelope = createProductCaseWorkspaceExport({
    workspaceState,
    exportedAt: CAPTURED_AT,
  })
  const serialized = serializeProductCaseWorkspaceExport({
    workspaceState,
    exportedAt: CAPTURED_AT,
  })
  assert.equal(
    envelope.workspaceState.document.supplierSourceCapture
      ?.rawVisibleSourceText,
    INTERACTIVE_ACCEPTANCE_TEXT,
  )
  assert.match(serialized, /Portable Rechargeable Device/)
  assert.equal(
    envelope.output.adapter.acceptedEvidenceInputs.some((entry) =>
      entry.field === "marketing_claim"
    ),
    false,
  )
  assert.equal(
    envelope.output.operationalPipeline.find((phase) =>
      phase.phase === "SUPPLIER_SOURCE"
    )?.status,
    "COMPLETED",
  )
  assert.equal(
    envelope.output.operationalPipeline.find((phase) =>
      phase.phase === "SCENARIO_ECONOMICS"
    )?.status,
    "BLOCKED",
  )
  assert.equal(envelope.output.manualHandoffAllowed, false)
  assert.equal(envelope.output.canPublishAutomatically, false)
  assert.equal(envelope.safety.supabaseWrites, 0)
  assert.equal(envelope.safety.ebayWrites, 0)
})

test("captura manual detecta patrones sensibles sin afirmar ausencia absoluta", () => {
  for (const content of [
    "<!doctype html><html><body>Product</body></html>",
    "Password: secret",
    "Cookie: session=secret",
    "Cookie session=secret-value",
    "Authorization: Bearer secret",
    "Bearer abcdefghijklmnop",
    "Access token: secret",
    "Credit card: 4111111111111111",
    "Account email: private@example.com",
    "Contact support@example.com",
    "Session eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123",
  ]) {
    const result = validateManualAuthenticatedVisibleSourceText(content)
    assert.equal(result.valid, false, content)
  }
  for (const content of [
    INTERACTIVE_ACCEPTANCE_TEXT,
    "Cookie cutter set with 12 pieces",
    "Bearer handle for travel bag",
    "Card holder, black",
    "Product reference: 4111111111111112",
    "Battery model 1200-5555-9012",
  ]) {
    assert.equal(
      validateManualAuthenticatedVisibleSourceText(content).valid,
      true,
      content,
    )
  }
})

test("captura autenticada exige confirmación humana de texto visible", async () => {
  const extraction = await extractProductCaseEvidence({
    sourceUrl: INTERACTIVE_ACCEPTANCE_URL,
    capturedAt: CAPTURED_AT,
    content: INTERACTIVE_ACCEPTANCE_TEXT,
    format: "TEXT",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  await assert.rejects(
    createManualAuthenticatedSupplierSourceCapture({
      supplierUrl: INTERACTIVE_ACCEPTANCE_URL,
      rawVisibleSourceText: INTERACTIVE_ACCEPTANCE_TEXT,
      sourceAccessStatus: "AUTHENTICATED_SOURCE_REQUIRED",
      extraction,
      humanVisibleProductTextConfirmed: false,
    }),
    /HUMAN_VISIBLE_PRODUCT_TEXT_CONFIRMATION_REQUIRED/,
  )
})

test("revisión visual simple queda HUMAN_VISUAL_REVIEW sin inventar conflicto", async () => {
  const document = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
      .document,
  )
  const result = await createHumanVisualReviewRecord({
    document,
    imageId: "manual-image-reference-1",
    sourceUrl: null,
    sourceReference: "MANUAL_IMAGE_REFERENCE:manual-image-reference-1",
    reviewerType: "HUMAN",
    observedProductType: null,
    visibleFeatures: ["Black handheld object visible"],
    visibleText: [],
    visibleBrands: [],
    visibleColors: ["BLACK"],
    visibleQuantity: 1,
    observedVariant: "BLACK",
    possibleConflicts: [],
    contradictsEvidenceIds: [],
    confidence: "MEDIUM",
    humanDecision: "ACCEPT_FOR_ANALYSIS",
    humanReason: "Human observation recorded for analysis only.",
    reviewedAt: CAPTURED_AT,
    rawHumanInput: visualRawInput(),
  })
  assert.equal(result.observation.captureMethod, "HUMAN_VISUAL_REVIEW")
  assert.equal(result.observation.humanDecision, "ACCEPT_FOR_ANALYSIS")
  assert.equal(result.evidence.evidenceClass, "HUMAN_VISUAL_REVIEW")
  assert.equal(
    result.evidence.sourceEvidenceClass,
    "HUMAN_VISUAL_REVIEW",
  )
  assert.equal(result.evidence.evidenceStatus, "ACCEPTED")
  assert.equal(result.evidence.humanVerdict, "ACCEPT")
  assert.deepEqual(result.observation.visibleFeatures, [
    "Black handheld object visible",
  ])
  assert.deepEqual(result.observation.visibleText, [])
  assert.deepEqual(result.observation.visibleBrands, [])
  assert.deepEqual(result.observation.visibleColors, ["BLACK"])
  assert.equal(result.observation.visibleQuantity, 1)
  assert.equal(result.observation.observedVariant, "BLACK")
  assert.deepEqual(result.observation.possibleConflicts, [])
  assert.equal(result.observation.physicalProductVerified, false)
  assert.deepEqual(result.evidence.rawValue.visibleText, [])
  assert.deepEqual(result.evidence.rawValue.visibleFeatures, [
    "Black handheld object visible",
  ])
  assert.equal(result.identityConflict, null)
  assert.equal(result.safety.openAiCalls, 0)
})

test("contrato visual versionado agrega, reemplaza por imageId y elimina atómicamente", async () => {
  const initial = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
      .document,
  )
  const supplierSnapshot = {
    supplierSourceCapture: structuredClone(initial.supplierSourceCapture),
    supplierCaptures: structuredClone(initial.captures.filter((entry) =>
      entry.sourceType !== "HUMAN_VISUAL_OBSERVATION"
    )),
    supplierEvidence: structuredClone(initial.evidence.filter((entry) =>
      entry.sourceType !== "HUMAN_VISUAL_OBSERVATION"
    )),
  }
  const added = await createHumanVisualReviewRecord({
    document: initial,
    imageId: "image-contract-1",
    sourceUrl: "https://example.invalid/sanitized-image",
    sourceReference: "human image reference",
    reviewerType: "HUMAN",
    observedProductType: "Electric razor",
    visibleFeatures: ["Floating heads, flexible", "Cordless"],
    visibleText: ["IPX6"],
    visibleBrands: ["No brand visible"],
    visibleColors: ["Black, silver"],
    visibleQuantity: 1,
    observedVariant: "Black",
    possibleConflicts: ["BRAND_CONFLICT, COLOR_CONFLICT", "PACK_CONFLICT"],
    contradictsEvidenceIds: [],
    confidence: "MEDIUM",
    humanDecision: "ACCEPT_FOR_ANALYSIS",
    humanReason: "Sanitized human review.",
    reviewedAt: CAPTURED_AT,
    rawHumanInput: visualRawInput({
      imageId: "image-contract-1",
      sourceUrl: "https://example.invalid/sanitized-image",
      sourceReference: "human image reference",
      observedProductType: "Electric razor",
      visibleFeatures: "Floating heads, flexible\nCordless",
      visibleText: "IPX6",
      visibleBrands: "No brand visible",
      visibleColors: "Black, silver",
      possibleConflicts: "BRAND_CONFLICT, COLOR_CONFLICT\nPACK_CONFLICT",
      humanReason: "Sanitized human review.",
    }),
  })
  assert.equal(
    added.observation.contractVersion,
    HUMAN_VISUAL_REVIEW_CONTRACT_VERSION,
  )
  assert.equal(added.observation.reviewerType, "HUMAN")
  assert.equal(added.observation.captureMethod, "HUMAN_VISUAL_REVIEW")
  assert.equal(
    added.updatedDocument.imageAnalysis.machineVisionStatus,
    "NOT_IMPLEMENTED",
  )
  assert.equal(added.updatedDocument.imageAnalysis.openAiVisionUsed, false)
  assert.equal(added.observation.physicalProductVerified, false)
  assert.notEqual(added.evidence.evidenceClass, "PRODUCT_VERIFIED")
  assert.equal(added.updatedDocument.safety.supabaseWrites, 0)
  assert.equal(added.updatedDocument.safety.ebayWrites, 0)
  assert.equal(added.updatedDocument.safety.openAiCalls, 0)
  assert.equal(added.updatedDocument.safety.canPublishAutomatically, false)
  assert.deepEqual(added.observation.visibleBrands, [])
  assert.deepEqual(added.observation.visibleFeatures, [
    "Floating heads, flexible",
    "Cordless",
  ])
  assert.deepEqual(added.observation.visibleText, ["IPX6"])
  assert.deepEqual(added.observation.possibleConflicts, [
    "BRAND_CONFLICT, COLOR_CONFLICT",
    "PACK_CONFLICT",
  ])
  assert.equal(
    added.observation.rawHumanInput.visibleFeatures,
    "Floating heads, flexible\nCordless",
  )
  assert.equal(
    added.updatedDocument.imageAnalysis.observations.filter((entry) =>
      entry.imageId === "image-contract-1"
    ).length,
    1,
  )
  assert.equal(added.updatedDocument.identityReview.status, "NOT_REVIEWED")
  assert.equal(added.updatedDocument.identityReview.physicalProductVerified, false)

  const edited = await createHumanVisualReviewRecord({
    document: added.updatedDocument,
    imageId: "image-contract-1",
    sourceUrl: null,
    sourceReference: "human image reference edited",
    reviewerType: "HUMAN",
    observedProductType: null,
    visibleFeatures: [],
    visibleText: ["IPX6", "USB"],
    visibleBrands: [],
    visibleColors: [],
    visibleQuantity: null,
    observedVariant: null,
    possibleConflicts: [],
    contradictsEvidenceIds: [],
    confidence: "HIGH",
    humanDecision: "NEEDS_MORE_EVIDENCE",
    humanReason: "Edited human review.",
    reviewedAt: "2026-07-28T17:00:00.000Z",
    rawHumanInput: visualRawInput({
      imageId: "image-contract-1",
      sourceReference: "human image reference edited",
      visibleFeatures: "",
      visibleText: "IPX6\nUSB",
      visibleColors: "",
      visibleQuantity: "",
      observedVariant: "",
      confidence: "HIGH",
      humanDecision: "NEEDS_MORE_EVIDENCE",
      humanReason: "Edited human review.",
    }),
  })
  assert.equal(
    edited.updatedDocument.imageAnalysis.observations.filter((entry) =>
      entry.imageId === "image-contract-1"
    ).length,
    1,
  )
  assert.notEqual(edited.observation.contentHash, added.observation.contentHash)
  assert.notEqual(edited.observation.evidenceId, added.observation.evidenceId)
  assert.equal(
    edited.updatedDocument.evidence.some((entry) =>
      entry.id === added.observation.evidenceId
    ),
    false,
  )
  assert.equal(
    edited.updatedDocument.captures.some((entry) =>
      entry.contentHash === added.observation.contentHash
    ),
    false,
  )
  assert.equal(
    edited.updatedDocument.identityReview.humanObservationEvidenceIds.includes(
      edited.observation.evidenceId,
    ),
    true,
  )
  assert.equal(
    edited.updatedDocument.identityReview.humanObservationEvidenceIds.includes(
      added.observation.evidenceId,
    ),
    false,
  )
  assert.equal(edited.updatedDocument.identityReview.status, "NOT_REVIEWED")

  const deleted = deleteHumanVisualReviewRecord({
    document: edited.updatedDocument,
    imageId: "image-contract-1",
  })
  assert.equal(
    deleted.imageAnalysis.observations.some((entry) =>
      entry.imageId === "image-contract-1"
    ),
    false,
  )
  assert.equal(
    deleted.evidence.some((entry) =>
      entry.id === edited.observation.evidenceId
    ),
    false,
  )
  assert.equal(
    deleted.captures.some((entry) =>
      entry.contentHash === edited.observation.contentHash
    ),
    false,
  )
  assert.equal(
    deleted.identityReview.humanObservationEvidenceIds.includes(
      edited.observation.evidenceId,
    ),
    false,
  )
  assert.equal(deleted.identityReview.status, "NOT_REVIEWED")
  assert.equal(deleted.identityReview.physicalProductVerified, false)
  assert.deepEqual(deleted.supplierSourceCapture, supplierSnapshot.supplierSourceCapture)
  assert.deepEqual(
    deleted.captures.filter((entry) =>
      entry.sourceType !== "HUMAN_VISUAL_OBSERVATION"
    ),
    supplierSnapshot.supplierCaptures,
  )
  assert.deepEqual(
    deleted.evidence.filter((entry) =>
      entry.sourceType !== "HUMAN_VISUAL_OBSERVATION"
    ),
    supplierSnapshot.supplierEvidence,
  )
  assert.deepEqual(humanVisualReviewContractIssues(
    edited.updatedDocument.imageAnalysis.observations,
  ), [])
})

test("contrato visual rechaza campos obligatorios vacíos y marca legacy sin corregir", async () => {
  const document = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
      .document,
  )
  await assert.rejects(
    createHumanVisualReviewRecord({
      document,
      imageId: "",
      sourceUrl: null,
      sourceReference: "",
      reviewerType: "HUMAN",
      observedProductType: null,
      visibleFeatures: [],
      visibleText: [],
      visibleBrands: [],
      visibleColors: [],
      visibleQuantity: null,
      observedVariant: null,
      possibleConflicts: [],
      contradictsEvidenceIds: [],
      confidence: "LOW",
      humanDecision: "NEEDS_MORE_EVIDENCE",
      humanReason: "",
      reviewedAt: CAPTURED_AT,
      rawHumanInput: visualRawInput({
        imageId: "",
        sourceReference: "",
        humanReason: "",
      }),
    }),
    /HUMAN_VISUAL_REVIEW_REQUIRED_FIELD_MISSING/,
  )
  const legacy = {
    imageId: "legacy-image",
    visibleBrands: ["No brand visible"],
  }
  assert.deepEqual(
    humanVisualReviewContractIssues([legacy]),
    [
      "HUMAN_VISUAL_REVIEW_HUMAN_CORRECTION_REQUIRED:legacy-image",
      "HUMAN_VISUAL_REVIEW_BRAND_PLACEHOLDER_INVALID:legacy-image",
    ],
  )
  assert.deepEqual(legacy.visibleBrands, ["No brand visible"])
})

test("edición visual usa evidenceId estable, permite renombrar y reemplaza la tarjeta correcta", async () => {
  const base = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
      .document,
  )
  const first = await createHumanVisualReviewRecord(visualReviewInput(base, {
    imageId: "visual-a",
    sourceReference: "visual a",
    humanReason: "Visual A.",
    rawHumanInput: {
      imageId: "visual-a",
      sourceReference: "visual a",
      humanReason: "Visual A.",
    },
  }))
  const second = await createHumanVisualReviewRecord(visualReviewInput(
    first.updatedDocument,
    {
      imageId: "visual-b",
      sourceReference: "visual b",
      humanReason: "Visual B.",
      rawHumanInput: {
        imageId: "visual-b",
        sourceReference: "visual b",
        humanReason: "Visual B.",
      },
    },
  ))
  const beforeB = structuredClone(
    second.updatedDocument.imageAnalysis.observations.find((entry) =>
      entry.imageId === "visual-b"
    ),
  )
  const renamed = await createHumanVisualReviewRecord(visualReviewInput(
    second.updatedDocument,
    {
      replaceEvidenceId: first.observation.evidenceId,
      imageId: "visual-a-renamed",
      sourceReference: "visual a renamed",
      humanReason: "Visual A renamed.",
      rawHumanInput: {
        imageId: "visual-a-renamed",
        sourceReference: "visual a renamed",
        humanReason: "Visual A renamed.",
      },
    },
  ))
  assert.equal(
    renamed.updatedDocument.imageAnalysis.observations.some((entry) =>
      entry.imageId === "visual-a"
    ),
    false,
  )
  assert.equal(
    renamed.updatedDocument.imageAnalysis.observations.filter((entry) =>
      entry.imageId === "visual-a-renamed"
    ).length,
    1,
  )
  assert.deepEqual(
    renamed.updatedDocument.imageAnalysis.observations.find((entry) =>
      entry.imageId === "visual-b"
    ),
    beforeB,
  )
  assert.notEqual(renamed.observation.evidenceId, first.observation.evidenceId)
})

test("colisión de imageId al editar falla sin modificar ninguna tarjeta", async () => {
  const base = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
      .document,
  )
  const first = await createHumanVisualReviewRecord(visualReviewInput(base, {
    imageId: "collision-a",
    sourceReference: "collision a",
    humanReason: "Collision A.",
    rawHumanInput: {
      imageId: "collision-a",
      sourceReference: "collision a",
      humanReason: "Collision A.",
    },
  }))
  const second = await createHumanVisualReviewRecord(visualReviewInput(
    first.updatedDocument,
    {
      imageId: "collision-b",
      sourceReference: "collision b",
      humanReason: "Collision B.",
      rawHumanInput: {
        imageId: "collision-b",
        sourceReference: "collision b",
        humanReason: "Collision B.",
      },
    },
  ))
  const snapshot = structuredClone(second.updatedDocument)
  await assert.rejects(
    createHumanVisualReviewRecord(visualReviewInput(
      second.updatedDocument,
      {
        replaceEvidenceId: first.observation.evidenceId,
        imageId: "collision-b",
        sourceReference: "collision attempt",
        humanReason: "Must fail.",
        rawHumanInput: {
          imageId: "collision-b",
          sourceReference: "collision attempt",
          humanReason: "Must fail.",
        },
      },
    )),
    /HUMAN_VISUAL_REVIEW_IMAGE_ID_COLLISION/,
  )
  assert.deepEqual(second.updatedDocument, snapshot)
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
    rawHumanInput: visualRawInput({
      imageId: "human-image-review-test",
      sourceReference: "human supplied image reference",
      observedProductType: "POUCH_OR_STORAGE_ACCESSORY",
      visibleFeatures: "zipper\nstorage",
      visibleColors: "BLACK",
      possibleConflicts: "PRODUCT_FUNCTION_CONFLICT",
      confidence: "HIGH",
      humanDecision: "NEEDS_MORE_EVIDENCE",
      humanReason: "TEXT_AND_HUMAN_VISUAL_OBSERVATION_DIFFER",
    }),
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

test("export/import preserva el expediente pero invalida aprobaciones", async () => {
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
  const imported = await importProductCaseWorkspaceExport(serialized)
  assert.equal(imported.importMode, "VIEW_ONLY")
  assert.equal(imported.humanReviewStatus, "HUMAN_REVIEW_REQUIRED")
  assert.equal(imported.importedManualHandoffTrusted, false)
  assert.deepEqual(imported.preservedWorkspaceState, workspaceState)
  assert.equal(imported.visualReviewCorrectionRequired, false)
  assert.equal(
    serializeProductCaseWorkspaceExport({
      workspaceState: imported.preservedWorkspaceState,
      exportedAt: CAPTURED_AT,
    }),
    serialized,
  )
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
  await assert.rejects(
    importProductCaseWorkspaceExport(JSON.stringify(tampered)),
    /PRODUCT_CASE_IMPORT_OUTPUT_MISMATCH/,
  )
})

test("import visual legacy conserva datos y exige corrección humana", async () => {
  const workspaceState = verifiableLegacyVisualWorkspace()
  const legacyObservation = workspaceState.imageObservations[0]
  const serialized = serializeProductCaseWorkspaceExport({
    workspaceState,
    exportedAt: CAPTURED_AT,
  })
  const imported = await importProductCaseWorkspaceExport(serialized)
  assert.equal(imported.visualReviewCorrectionRequired, true)
  assert.match(
    imported.visualReviewContractIssues.join("\n"),
    /HUMAN_VISUAL_REVIEW_HUMAN_CORRECTION_REQUIRED:sanitized-main/,
  )
  assert.deepEqual(imported.preservedWorkspaceState, workspaceState)
  assert.equal(
    Object.hasOwn(
      imported.preservedWorkspaceState.imageObservations[0],
      "contractVersion",
    ),
    false,
  )
  assert.deepEqual(
    imported.workspaceState.document.imageAnalysis.contractIssues,
    imported.visualReviewContractIssues,
  )
  assert.equal(imported.rebuiltOutput.manualHandoffAllowed, false)
  assert.notEqual(
    imported.rebuiltOutput.listingPackageStatus,
    "READY_FOR_HUMAN_SELLER_HUB_ENTRY",
  )

  const originalObservation =
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
      .imageObservations[0]
  const resolved = await createHumanVisualReviewRecord({
    document: imported.workspaceState.document,
    replaceEvidenceId: legacyObservation.evidenceId,
    imageId: originalObservation.imageId,
    sourceUrl: originalObservation.sourceUrl,
    sourceReference: originalObservation.sourceReference,
    reviewerType: "HUMAN",
    observedProductType: originalObservation.observedProductType,
    visibleFeatures: originalObservation.visibleFeatures,
    visibleText: originalObservation.visibleText,
    visibleBrands: originalObservation.visibleBrands,
    visibleColors: originalObservation.visibleColors,
    visibleQuantity: originalObservation.visibleQuantity,
    observedVariant: originalObservation.observedVariant,
    possibleConflicts: originalObservation.possibleConflicts,
    contradictsEvidenceIds: originalObservation.contradictsEvidenceIds,
    confidence: originalObservation.confidence,
    humanDecision: originalObservation.humanDecision,
    humanReason: originalObservation.humanReason,
    reviewedAt: originalObservation.reviewedAt,
    rawHumanInput: originalObservation.rawHumanInput,
  })
  assert.deepEqual(resolved.updatedDocument.imageAnalysis.contractIssues, [])
  assert.equal(
    resolved.updatedDocument.identityReview.blockers.some((entry) =>
      entry.includes("HUMAN_VISUAL_REVIEW_HUMAN_CORRECTION_REQUIRED")
    ),
    false,
  )
  const humanRevalidatedDocument = {
    ...resolved.updatedDocument,
    identityReview: {
      ...structuredClone(
        SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
          .document.identityReview,
      ),
      humanObservationEvidenceIds:
        resolved.updatedDocument.imageAnalysis.observations.map((entry) =>
          entry.evidenceId
        ),
    },
  }
  const humanRevalidatedWorkspace = {
    ...structuredClone(
      SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
    ),
    document: humanRevalidatedDocument,
    imageObservations: humanRevalidatedDocument.imageAnalysis.observations,
  }
  const humanRevalidatedOutput = buildWorkspaceOutput(
    humanRevalidatedWorkspace,
  )
  assert.doesNotMatch(
    JSON.stringify(humanRevalidatedOutput),
    /HUMAN_VISUAL_REVIEW_HUMAN_CORRECTION_REQUIRED/,
  )
})

test("archivo legacy equivalente de 288 KB se lee y entra con warning persistente", async () => {
  const envelope = coherentStringLegacyOutputEnvelope()
  const serialized = JSON.stringify(envelope)
  const targetBytes = 288_426
  assert.ok(Buffer.byteLength(serialized) < targetBytes)
  const browserFileText = serialized +
    " ".repeat(targetBytes - Buffer.byteLength(serialized))
  assert.equal(Buffer.byteLength(browserFileText), targetBytes)
  assert.equal(
    validateProductCaseImportFileMetadata({
      name: "product-case-browser-draft (2).json",
      size: targetBytes,
      type: "application/json",
    }),
    null,
  )
  assert.equal(validateProductCaseImportJsonCandidate(browserFileText), null)

  const imported = await importProductCaseWorkspaceExport(browserFileText)
  assert.equal(imported.legacyOutputRebuilt, true)
  assert.deepEqual(imported.importWarnings, [
    "LEGACY_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN",
  ])
  assert.deepEqual(
    imported.historicalOutputAudit
      .quarantinedLegacyVisualObservationIds,
    ["sanitized-main"],
  )
  assert.equal(imported.visualReviewCorrectionRequired, true)
  assert.match(
    imported.visualReviewContractIssues.join("\n"),
    /HUMAN_VISUAL_REVIEW_HUMAN_CORRECTION_REQUIRED:sanitized-main/,
  )
  assert.match(
    imported.visualReviewContractIssues.join("\n"),
    /HUMAN_VISUAL_REVIEW_LEGACY_EVIDENCE_UNVERIFIABLE:sanitized-main/,
  )
  assert.match(
    imported.workspaceState.document.imageAnalysis.contractIssues.join("\n"),
    /HUMAN_VISUAL_REVIEW_HUMAN_CORRECTION_REQUIRED:sanitized-main/,
  )
  assert.match(
    imported.workspaceState.document.imageAnalysis.contractIssues.join("\n"),
    /HUMAN_VISUAL_REVIEW_LEGACY_EVIDENCE_UNVERIFIABLE:sanitized-main/,
  )
  assert.equal(imported.workspaceState.document.identityReview.status,
    "NOT_REVIEWED")
  assert.match(
    imported.workspaceState.document.identityReview.blockers.join("\n"),
    /HUMAN_VISUAL_REVIEW_LEGACY_EVIDENCE_UNVERIFIABLE:sanitized-main/,
  )
  assert.notEqual(imported.rebuiltOutput.readiness.productIdentity, "READY")
  assert.equal(imported.rebuiltOutput.manualHandoffAllowed, false)
  assert.equal(imported.rebuiltOutput.handoffArtifactGenerated, false)
  assert.equal(imported.rebuiltOutput.listingPackage, null)
  assert.notEqual(
    imported.rebuiltOutput.listingPackageStatus,
    "READY_FOR_HUMAN_SELLER_HUB_ENTRY",
  )

  const currentSerialized = serializeProductCaseWorkspaceExport({
    workspaceState: imported.workspaceState,
    exportedAt: CAPTURED_AT,
  })
  const reimported = await importProductCaseWorkspaceExport(
    currentSerialized,
  )
  assert.equal(reimported.legacyOutputRebuilt, false)
  assert.deepEqual(reimported.importWarnings, [
    "LEGACY_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN",
  ])
  assert.deepEqual(
    reimported.historicalOutputAudit,
    imported.historicalOutputAudit,
  )
  assert.deepEqual(
    reimported.preservedWorkspaceState,
    imported.workspaceState,
  )
  assert.equal(
    serializeProductCaseWorkspaceExport({
      workspaceState: reimported.workspaceState,
      exportedAt: CAPTURED_AT,
    }),
    currentSerialized,
  )
})

test("corrección humana refresca el audit legacy antes del export V2 sin mutar el histórico", async (t) => {
  for (const action of ["REPLACE", "DELETE"]) {
    await t.test(action, async () => {
      const imported = await importProductCaseWorkspaceExport(
        JSON.stringify(coherentStringLegacyOutputEnvelope()),
      )
      const legacyAudit = structuredClone(
        imported.workspaceState.legacyImportAudit,
      )
      assert.ok(legacyAudit)
      assert.deepEqual(
        legacyAudit.quarantinedLegacyVisualObservationIds,
        ["sanitized-main"],
      )
      const legacyObservation =
        imported.workspaceState.document.imageAnalysis.observations.find(
          (entry) => entry.imageId === "sanitized-main",
        )
      assert.ok(legacyObservation)

      let correctedDocument
      if (action === "REPLACE") {
        const canonicalObservation =
          SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE
            .workspaceState.imageObservations.find(
              (entry) => entry.imageId === legacyObservation.imageId,
            )
        assert.ok(canonicalObservation)
        const replacement = await createHumanVisualReviewRecord({
          document: imported.workspaceState.document,
          replaceEvidenceId: legacyObservation.evidenceId,
          imageId: canonicalObservation.imageId,
          sourceUrl: canonicalObservation.sourceUrl,
          sourceReference: canonicalObservation.sourceReference,
          reviewerType: "HUMAN",
          observedProductType: canonicalObservation.observedProductType,
          visibleFeatures: canonicalObservation.visibleFeatures,
          visibleText: canonicalObservation.visibleText,
          visibleBrands: canonicalObservation.visibleBrands,
          visibleColors: canonicalObservation.visibleColors,
          visibleQuantity: canonicalObservation.visibleQuantity,
          observedVariant: canonicalObservation.observedVariant,
          possibleConflicts: canonicalObservation.possibleConflicts,
          contradictsEvidenceIds:
            canonicalObservation.contradictsEvidenceIds,
          confidence: canonicalObservation.confidence,
          humanDecision: canonicalObservation.humanDecision,
          humanReason: canonicalObservation.humanReason,
          reviewedAt: canonicalObservation.reviewedAt,
          rawHumanInput: canonicalObservation.rawHumanInput,
        })
        correctedDocument = replacement.updatedDocument
        assert.equal(
          correctedDocument.imageAnalysis.observations.some((entry) =>
            entry.evidenceId === legacyObservation.evidenceId
          ),
          false,
        )
        assert.equal(
          correctedDocument.imageAnalysis.observations.filter((entry) =>
            entry.imageId === legacyObservation.imageId
          ).length,
          1,
        )
      } else {
        correctedDocument = deleteHumanVisualReviewRecord({
          document: imported.workspaceState.document,
          imageId: legacyObservation.imageId,
        })
        assert.equal(
          correctedDocument.imageAnalysis.observations.some((entry) =>
            entry.imageId === legacyObservation.imageId
          ),
          false,
        )
      }

      assert.equal(
        correctedDocument.imageAnalysis.contractIssues.some((issue) =>
          issue.includes(
            "HUMAN_VISUAL_REVIEW_LEGACY_EVIDENCE_UNVERIFIABLE:" +
              legacyObservation.imageId,
          )
        ),
        false,
        "la cuarentena activa se resuelve sólo por la acción humana",
      )
      assert.equal(
        correctedDocument.identityReview.blockers.some((blocker) =>
          blocker.includes(
            "HUMAN_VISUAL_REVIEW_LEGACY_EVIDENCE_UNVERIFIABLE:" +
              legacyObservation.imageId,
          )
        ),
        false,
      )

      const correctedWorkspace = {
        ...imported.workspaceState,
        document: correctedDocument,
        imageObservations: structuredClone(
          correctedDocument.imageAnalysis.observations,
        ),
      }
      assert.throws(
        () => serializeProductCaseWorkspaceExport({
          workspaceState: correctedWorkspace,
          exportedAt: CAPTURED_AT,
        }),
        /PRODUCT_CASE_EXPORT_LEGACY_AUDIT_REFRESH_REQUIRED/,
      )

      const refreshedWorkspace =
        await refreshProductCaseLegacyImportAuditForExport({
          workspaceState: correctedWorkspace,
          exportedAt: CAPTURED_AT,
        })
      assert.ok(refreshedWorkspace.legacyImportAudit)
      assert.deepEqual(
        refreshedWorkspace.legacyImportAudit.historicalOutput,
        legacyAudit.historicalOutput,
        "la referencia histórica es audit-only e inmutable",
      )
      assert.deepEqual(
        refreshedWorkspace.legacyImportAudit
          .quarantinedLegacyVisualObservationIds,
        legacyAudit.quarantinedLegacyVisualObservationIds,
        "la lista histórica no se reescribe como si nunca hubiera existido",
      )
      assert.equal(
        refreshedWorkspace.document.imageAnalysis.contractIssues.some(
          (issue) => issue.includes(
            "HUMAN_VISUAL_REVIEW_LEGACY_EVIDENCE_UNVERIFIABLE:" +
              legacyObservation.imageId,
          ),
        ),
        false,
      )

      const serialized = serializeProductCaseWorkspaceExport({
        workspaceState: refreshedWorkspace,
        exportedAt: CAPTURED_AT,
      })
      const envelope = JSON.parse(serialized)
      assert.equal(envelope.version, "PRODUCT_CASE_WORKSPACE_EXPORT_V2")
      assert.deepEqual(
        envelope.workspaceState.legacyImportAudit.historicalOutput,
        legacyAudit.historicalOutput,
      )
      assert.equal(envelope.output.listingPackage, null)
      assert.equal(envelope.output.manualHandoffAllowed, false)
      assert.equal(envelope.output.handoffArtifactGenerated, false)

      const reimported = await importProductCaseWorkspaceExport(serialized)
      assert.equal(reimported.legacyOutputRebuilt, false)
      assert.deepEqual(reimported.importWarnings, [
        "LEGACY_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN",
      ])
      assert.deepEqual(
        reimported.historicalOutputAudit.historicalOutput,
        legacyAudit.historicalOutput,
      )
      assert.equal(
        reimported.workspaceState.document.imageAnalysis.contractIssues.some(
          (issue) => issue.includes(
            "HUMAN_VISUAL_REVIEW_LEGACY_EVIDENCE_UNVERIFIABLE:" +
              legacyObservation.imageId,
          ),
        ),
        false,
      )
      const normalizedSerialized = serializeProductCaseWorkspaceExport({
        workspaceState: reimported.workspaceState,
        exportedAt: CAPTURED_AT,
      })
      const normalizedReimport = await importProductCaseWorkspaceExport(
        normalizedSerialized,
      )
      assert.deepEqual(normalizedReimport.outputMismatchPaths, [])
      assert.deepEqual(
        normalizedReimport.historicalOutputAudit.historicalOutput,
        legacyAudit.historicalOutput,
      )
      assert.equal(
        serializeProductCaseWorkspaceExport({
          workspaceState: normalizedReimport.workspaceState,
          exportedAt: CAPTURED_AT,
        }),
        normalizedSerialized,
        "V2 refrescado se reimporta y exporta idempotentemente",
      )
    })
  }
})

test("serialize sync rechaza un legacy audit stale y exige refresh async", async () => {
  const imported = await importProductCaseWorkspaceExport(
    JSON.stringify(coherentStringLegacyOutputEnvelope()),
  )
  const legacyObservation =
    imported.workspaceState.document.imageAnalysis.observations[0]
  assert.ok(legacyObservation)
  const correctedDocument = deleteHumanVisualReviewRecord({
    document: imported.workspaceState.document,
    imageId: legacyObservation.imageId,
  })
  const staleWorkspace = {
    ...imported.workspaceState,
    document: correctedDocument,
    imageObservations: structuredClone(
      correctedDocument.imageAnalysis.observations,
    ),
  }

  assert.throws(
    () => serializeProductCaseWorkspaceExport({
      workspaceState: staleWorkspace,
      exportedAt: CAPTURED_AT,
    }),
    (error) => {
      assert.equal(
        error.message,
        "PRODUCT_CASE_EXPORT_LEGACY_AUDIT_REFRESH_REQUIRED",
      )
      return true
    },
  )
})

test("output V0 canónico verificable se reconstruye sin cuarentena visual", async () => {
  const envelope = authenticLegacyOutputEnvelope()
  const compact = JSON.stringify(envelope)
  const targetBytes = 288_426
  assert.ok(Buffer.byteLength(compact) < targetBytes)
  const browserFileText = compact +
    " ".repeat(targetBytes - Buffer.byteLength(compact))
  assert.equal(Buffer.byteLength(browserFileText), targetBytes)

  const imported = await importProductCaseWorkspaceExport(browserFileText)
  assert.equal(imported.legacyOutputRebuilt, true)
  assert.equal(
    imported.importWarnings.includes(
      "LEGACY_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN",
    ),
    true,
  )
  assert.ok(imported.outputMismatchPaths.length > 0)
  assert.deepEqual(
    imported.outputMismatchPaths,
    productCaseOutputMismatchPaths(
      envelope.output,
      imported.rebuiltOutput,
    ),
    "el audit describe exactamente el output histórico frente al activo bloqueado",
  )
  assert.match(imported.outputMismatchPaths.join("\n"), /adapter/)
  assert.match(
    imported.outputMismatchPaths.join("\n"),
    /identityReview\.(?:status|blockers)|readiness\.productIdentity/,
  )
  assert.equal(
    imported.outputMismatchPaths.every((path) =>
      /^[A-Za-z0-9_.[\]-]+$/.test(path)
    ),
    true,
    "el diagnóstico expone únicamente rutas estructurales, no valores",
  )
  assert.ok(imported.historicalOutputAudit)
  assert.ok(imported.workspaceState.legacyImportAudit)
  assert.deepEqual(
    imported.historicalOutputAudit.quarantinedLegacyVisualObservationIds,
    [],
  )
  assert.deepEqual(
    imported.historicalOutputAudit.historicalOutput,
    envelope.output,
  )
  assert.equal(imported.historicalOutputAudit.auditOnly, true)
  assert.equal(imported.historicalOutputAudit.historicalOutputTrusted, false)
  assert.equal(imported.historicalOutputAudit.historicalPackageTrusted, false)
  assert.equal(imported.historicalOutputAudit.historicalHandoffTrusted, false)
  assert.deepEqual(
    imported.workspaceState.legacyImportAudit,
    imported.historicalOutputAudit,
  )
  assert.equal(
    imported.workspaceState.legacyImportAudit.legacyProfile,
    "PRE_PERSISTENT_HUMAN_VISUAL_CONTRACT_GATE_V1",
  )
  assert.equal(imported.visualReviewCorrectionRequired, true)
  assert.equal(imported.rebuiltOutput.manualHandoffAllowed, false)
  assert.equal(imported.rebuiltOutput.handoffArtifactGenerated, false)
  assert.equal(imported.rebuiltOutput.listingPackage, null)
  assert.notEqual(
    imported.rebuiltOutput.listingPackageStatus,
    "READY_FOR_HUMAN_SELLER_HUB_ENTRY",
  )
  assert.notDeepEqual(
    imported.rebuiltOutput,
    envelope.output,
    "el output histórico es sólo auditoría y nunca el output activo",
  )
})

test("V0 string inconsistente rechaza evidence, hash, captura y referencia alterados", async () => {
  const mutations = [
    ["evidence", (envelope) => {
      const evidence = envelope.workspaceState.document.evidence.find(
        (entry) => entry.sourceType === "HUMAN_VISUAL_OBSERVATION",
      )
      assert.ok(evidence)
      evidence.rawValue = "Legacy visual evidence tampered"
    }],
    ["hash", (envelope) => {
      const invalidHash = "sha256:not-a-valid-content-hash"
      const document = envelope.workspaceState.document
      document.imageAnalysis.observations[0].contentHash = invalidHash
      envelope.workspaceState.imageObservations[0].contentHash = invalidHash
      document.evidence.find((entry) =>
        entry.sourceType === "HUMAN_VISUAL_OBSERVATION"
      ).contentHash = invalidHash
      document.captures.find((entry) =>
        entry.sourceType === "HUMAN_VISUAL_OBSERVATION"
      ).contentHash = invalidHash
    }],
    ["capture", (envelope) => {
      const capture = envelope.workspaceState.document.captures.find(
        (entry) => entry.sourceType === "HUMAN_VISUAL_OBSERVATION",
      )
      assert.ok(capture)
      capture.byteLength = 0
    }],
    ["reference", (envelope) => {
      const document = envelope.workspaceState.document
      const evidence = document.evidence.find((entry) =>
        entry.sourceType === "HUMAN_VISUAL_OBSERVATION"
      )
      const capture = document.captures.find((entry) =>
        entry.sourceType === "HUMAN_VISUAL_OBSERVATION"
      )
      assert.ok(evidence)
      assert.ok(capture)
      const alteredReference =
        "https://lunaportex.com/products/altered-reference"
      evidence.sourceUrl = alteredReference
      capture.sourceUrl = alteredReference
    }],
  ]

  for (const [label, mutate] of mutations) {
    const envelope = coherentStringLegacyOutputEnvelope()
    mutate(envelope)
    await assert.rejects(
      importProductCaseWorkspaceExport(JSON.stringify(envelope)),
      /PRODUCT_CASE_IMPORT_CRYPTOGRAPHIC_PROVENANCE_INVALID:HUMAN_VISUAL_REVIEW_LEGACY_INTEGRITY_MISMATCH:sanitized-main/,
      label,
    )
  }
})

test("V0 visual canónico verificable continúa aceptado con audit y gates", async () => {
  const envelope = authenticLegacyOutputEnvelope()
  const imported = await importProductCaseWorkspaceExport(
    JSON.stringify(envelope),
  )

  assert.equal(imported.legacyOutputRebuilt, true)
  assert.equal(
    imported.importWarnings.includes(
      "LEGACY_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN",
    ),
    true,
  )
  assert.ok(imported.historicalOutputAudit)
  assert.deepEqual(
    imported.historicalOutputAudit.quarantinedLegacyVisualObservationIds,
    [],
  )
  assert.equal(imported.visualReviewCorrectionRequired, true)
  assert.equal(imported.rebuiltOutput.manualHandoffAllowed, false)
  assert.equal(imported.rebuiltOutput.handoffArtifactGenerated, false)
  assert.equal(imported.rebuiltOutput.listingPackage, null)
})

test("migración legacy valida criptográficamente la captura Luna original", async () => {
  const document = structuredClone(
    GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document,
  )
  const currentWorkspace = {
    document,
    economicsPolicy: null,
    scenarioDraft: null,
    listingOperations: structuredClone(
      GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.listingOperations,
    ),
    imageApprovals: structuredClone(
      GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.imageApprovals,
    ),
    imageObservations: structuredClone(
      document.imageAnalysis.observations,
    ),
    evaluatedAt: CAPTURED_AT,
    generatedAt: CAPTURED_AT,
  }
  const envelope = authenticLegacyOutputEnvelope(currentWorkspace)
  const sourceCapture =
    envelope.workspaceState.document.supplierSourceCapture
  assert.ok(sourceCapture)
  const originalText = sourceCapture.rawVisibleSourceText
  const alteredText = originalText.replace("Smart", "Smort")
  assert.notEqual(alteredText, originalText)
  assert.equal(Buffer.byteLength(alteredText), Buffer.byteLength(originalText))
  sourceCapture.rawVisibleSourceText = alteredText

  await assert.rejects(
    importProductCaseWorkspaceExport(JSON.stringify(envelope)),
    /PRODUCT_CASE_IMPORT_CRYPTOGRAPHIC_PROVENANCE_INVALID/,
  )
})

test("migración legacy no convierte tampering visual en output confiable", async () => {
  const envelope = authenticLegacyOutputEnvelope()
  envelope.workspaceState.imageObservations[0].visibleColors[0] = "WHITE"
  envelope.workspaceState.document.imageAnalysis.observations[0]
    .visibleColors[0] = "WHITE"

  await assert.rejects(
    importProductCaseWorkspaceExport(JSON.stringify(envelope)),
    /PRODUCT_CASE_IMPORT_(?:CRYPTOGRAPHIC_PROVENANCE_INVALID|LEGACY_OUTPUT_STRUCTURE_INVALID)/,
  )
})

test("migración legacy rechaza safety y contadores de writes alterados", async () => {
  const envelopeSafetyTampered = authenticLegacyOutputEnvelope()
  envelopeSafetyTampered.safety = {
    ...envelopeSafetyTampered.safety,
    ebayWrites: 1,
  }
  await assert.rejects(
    importProductCaseWorkspaceExport(
      JSON.stringify(envelopeSafetyTampered),
    ),
    /PRODUCT_CASE_IMPORT_SAFETY_INVALID/,
  )

  const workspaceSafetyTampered = authenticLegacyOutputEnvelope()
  workspaceSafetyTampered.workspaceState.document.safety.supabaseWrites = 1
  await assert.rejects(
    importProductCaseWorkspaceExport(
      JSON.stringify(workspaceSafetyTampered),
    ),
    /PRODUCT_CASE_IMPORT_SAFETY_INVALID/,
  )
})

test("nombres de safety dentro de business data no son efectos externos", async () => {
  const workspaceState = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
  )
  const titleEvidence = workspaceState.document.evidence.find((entry) =>
    entry.id === "san-title"
  )
  assert.ok(titleEvidence)
  titleEvidence.rawValue = {
    generatedImages: 7,
    listingChanges: 3,
    canPublishAutomatically: true,
    context: "BUSINESS_DATA_ONLY",
  }
  workspaceState.listingOperations.itemSpecifics = {
    ...workspaceState.listingOperations.itemSpecifics,
    generatedImages: ["7"],
    listingChanges: ["3"],
    canPublishAutomatically: ["true"],
  }

  const serialized = serializeProductCaseWorkspaceExport({
    workspaceState,
    exportedAt: CAPTURED_AT,
  })
  const imported = await importProductCaseWorkspaceExport(serialized)
  assert.deepEqual(imported.preservedWorkspaceState, workspaceState)
  assert.equal(imported.legacyOutputRebuilt, false)
  assert.deepEqual(imported.importWarnings, [])
  assert.deepEqual(imported.safety, {
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

  const currentRoundtrip = serializeProductCaseWorkspaceExport({
    workspaceState: imported.preservedWorkspaceState,
    exportedAt: CAPTURED_AT,
  })
  assert.equal(currentRoundtrip, serialized)
  const reimported = await importProductCaseWorkspaceExport(currentRoundtrip)
  assert.deepEqual(reimported.preservedWorkspaceState, workspaceState)
})

test("tampering en objetos safety reales continúa rechazado", async () => {
  const envelope = JSON.parse(serializeProductCaseWorkspaceExport({
    workspaceState:
      SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
    exportedAt: CAPTURED_AT,
  }))
  envelope.safety.listingChanges = 1
  envelope.workspaceState.document.safety.listingChanges = 1
  envelope.output.document.safety.listingChanges = 1
  envelope.output.safety.listingChanges = 1

  await assert.rejects(
    importProductCaseWorkspaceExport(JSON.stringify(envelope)),
    /PRODUCT_CASE_IMPORT_SAFETY_INVALID/,
  )
})

test("output actual marcado conserva PRODUCT_CASE_IMPORT_OUTPUT_MISMATCH fail-closed", async () => {
  const envelope = createProductCaseWorkspaceExport({
    workspaceState:
      SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
    exportedAt: CAPTURED_AT,
  })
  assert.equal(
    envelope.outputContractVersion,
    PRODUCT_CASE_OUTPUT_CONTRACT_VERSION,
  )
  envelope.output.manualHandoffAllowed = false

  await assert.rejects(
    importProductCaseWorkspaceExport(JSON.stringify(envelope)),
    (error) => {
      assert.match(error.message, /PRODUCT_CASE_IMPORT_OUTPUT_MISMATCH/)
      assert.match(error.message, /output\.manualHandoffAllowed/)
      return true
    },
  )
})

test("V1 relabelado desde contrato actual no elude el perfil legacy", async () => {
  const relabeled = createProductCaseWorkspaceExport({
    workspaceState:
      SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
    exportedAt: CAPTURED_AT,
  })
  relabeled.version = "PRODUCT_CASE_WORKSPACE_EXPORT_V1"
  delete relabeled.outputContractVersion
  assert.deepEqual(
    relabeled.output,
    buildWorkspaceOutput(relabeled.workspaceState),
  )

  await assert.rejects(
    importProductCaseWorkspaceExport(JSON.stringify(relabeled)),
    /PRODUCT_CASE_IMPORT_LEGACY_PROFILE_INVALID/,
  )
})

test("V1 auténtico con output coincidente conserva audit, warning y gates legacy", async () => {
  const envelope = authenticLegacyOutputEnvelope()
  envelope.output = buildWorkspaceOutput(envelope.workspaceState)

  const imported = await importProductCaseWorkspaceExport(
    JSON.stringify(envelope),
  )
  assert.equal(imported.legacyOutputRebuilt, true)
  assert.deepEqual(imported.importWarnings, [
    "LEGACY_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN",
  ])
  assert.deepEqual(
    imported.outputMismatchPaths,
    productCaseOutputMismatchPaths(
      envelope.output,
      imported.rebuiltOutput,
    ),
  )
  assert.ok(imported.outputMismatchPaths.length > 0)
  assert.match(
    imported.outputMismatchPaths.join("\n"),
    /identityReview|imageRegistry/,
  )
  assert.ok(imported.historicalOutputAudit)
  assert.deepEqual(
    imported.historicalOutputAudit.historicalOutput,
    envelope.output,
  )
  assert.deepEqual(
    imported.workspaceState.legacyImportAudit,
    imported.historicalOutputAudit,
  )
  assert.equal(imported.visualReviewCorrectionRequired, true)
  assert.equal(imported.rebuiltOutput.manualHandoffAllowed, false)
  assert.equal(imported.rebuiltOutput.handoffArtifactGenerated, false)
  assert.equal(imported.rebuiltOutput.listingPackage, null)
  assert.notEqual(
    imported.rebuiltOutput.listingPackageStatus,
    "READY_FOR_HUMAN_SELLER_HUB_ENTRY",
  )
})

test("legacy con mismatch fuera de la proyección versionada se rechaza", async () => {
  const envelope = authenticLegacyOutputEnvelope()
  envelope.output.futureMeasurementStages[0].unexpectedLegacyField = true

  await assert.rejects(
    importProductCaseWorkspaceExport(JSON.stringify(envelope)),
    /PRODUCT_CASE_IMPORT_(?:OUTPUT_MISMATCH|LEGACY_OUTPUT_STRUCTURE_INVALID)/,
  )
})

test("diagnóstico truncado no oculta ni autoriza un mismatch fuera del allowlist", async () => {
  const envelope = authenticLegacyOutputEnvelope()
  const currentOutput = buildWorkspaceOutput(envelope.workspaceState)
  for (let index = 0; index < 400; index += 1) {
    envelope.output.adapter[
      `versionedDiagnostic${String(index).padStart(4, "0")}`
    ] = `legacy-${index}`
  }
  envelope.output.futureMeasurementStages[0]
    .unexpectedAuthorizationBypass = true

  const diagnostics = productCaseOutputMismatchPaths(
    envelope.output,
    currentOutput,
  )
  assert.ok(diagnostics.length > 0)
  assert.ok(diagnostics.length <= 256)
  assert.equal(
    diagnostics.includes(
      "output.futureMeasurementStages[0].unexpectedAuthorizationBypass",
    ),
    false,
    "la ruta inesperada queda deliberadamente después del límite diagnóstico",
  )

  await assert.rejects(
    importProductCaseWorkspaceExport(JSON.stringify(envelope)),
    (error) => {
      assert.match(error.message, /PRODUCT_CASE_IMPORT_OUTPUT_MISMATCH/)
      assert.ok(error.message.length < 32_768)
      return true
    },
  )
})

test("legacy importado se exporta al contrato actual y reimporta idempotente", async () => {
  const legacy = authenticLegacyOutputEnvelope()
  const firstImport = await importProductCaseWorkspaceExport(
    JSON.stringify(legacy),
  )
  assert.equal(firstImport.legacyOutputRebuilt, true)
  const currentSerialized = serializeProductCaseWorkspaceExport({
    workspaceState: firstImport.workspaceState,
    exportedAt: CAPTURED_AT,
  })
  const currentEnvelope = JSON.parse(currentSerialized)
  assert.equal(
    currentEnvelope.outputContractVersion,
    PRODUCT_CASE_OUTPUT_CONTRACT_VERSION,
  )
  assert.equal(currentEnvelope.output.manualHandoffAllowed, false)
  assert.equal(currentEnvelope.output.handoffArtifactGenerated, false)
  assert.equal(currentEnvelope.output.listingPackage, null)

  const secondImport = await importProductCaseWorkspaceExport(
    currentSerialized,
  )
  assert.equal(secondImport.legacyOutputRebuilt, false)
  assert.deepEqual(secondImport.importWarnings, [
    "LEGACY_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN",
  ])
  assert.deepEqual(secondImport.outputMismatchPaths, [])
  assert.deepEqual(
    secondImport.historicalOutputAudit,
    firstImport.historicalOutputAudit,
  )
  assert.deepEqual(
    secondImport.preservedWorkspaceState,
    firstImport.workspaceState,
  )
  assert.equal(secondImport.rebuiltOutput.manualHandoffAllowed, false)
  assert.equal(secondImport.rebuiltOutput.handoffArtifactGenerated, false)
  assert.equal(secondImport.rebuiltOutput.listingPackage, null)
  assert.deepEqual(secondImport.workspaceState, firstImport.workspaceState)
})

test("V2 exige el audit legacy persistido y verifica su semántica aunque se recalcule el hash", async () => {
  const legacy = authenticLegacyOutputEnvelope()
  const firstImport = await importProductCaseWorkspaceExport(
    JSON.stringify(legacy),
  )
  const currentSerialized = serializeProductCaseWorkspaceExport({
    workspaceState: firstImport.workspaceState,
    exportedAt: CAPTURED_AT,
  })
  const baseline = JSON.parse(currentSerialized)
  const baselineAudit = baseline.workspaceState.legacyImportAudit
  assert.ok(baselineAudit)
  assert.ok(baselineAudit.outputMismatchPaths.length > 1)
  const alternateImport = await importProductCaseWorkspaceExport(
    JSON.stringify(coherentStringLegacyOutputEnvelope()),
  )
  const alternateAudit = alternateImport.historicalOutputAudit
  assert.ok(alternateAudit)

  const mutations = [
    ["audit omitido", async (envelope) => {
      delete envelope.workspaceState.legacyImportAudit
      envelope.output = buildWorkspaceOutput(envelope.workspaceState)
    }],
    ["audit reemplazado por otro audit válido", async (envelope) => {
      envelope.workspaceState.legacyImportAudit =
        structuredClone(alternateAudit)
    }],
    ["output histórico reemplazado", async (envelope) => {
      const audit = envelope.workspaceState.legacyImportAudit
      assert.ok(audit)
      audit.historicalOutput.adapter.status =
        audit.historicalOutput.adapter.status === "BLOCKED"
          ? "READY"
          : "BLOCKED"
      await rehashLegacyImportAudit(audit)
    }],
    ["paths reordenados", async (envelope) => {
      const audit = envelope.workspaceState.legacyImportAudit
      assert.ok(audit)
      audit.outputMismatchPaths.reverse()
      await rehashLegacyImportAudit(audit)
    }],
    ["count alterado", async (envelope) => {
      const audit = envelope.workspaceState.legacyImportAudit
      assert.ok(audit)
      audit.outputMismatchPathCount += 1
      audit.outputMismatchPathsTruncated = true
      await rehashLegacyImportAudit(audit)
    }],
    ["mode alterado", async (envelope) => {
      const audit = envelope.workspaceState.legacyImportAudit
      assert.ok(audit)
      audit.validationMode =
        audit.validationMode === "EXACT_CURRENT_DOMAIN_REBUILD"
          ? "EXACT_AUDIT_PROJECTION"
          : "EXACT_CURRENT_DOMAIN_REBUILD"
      await rehashLegacyImportAudit(audit)
    }],
    ["quarantine alterada", async (envelope) => {
      const audit = envelope.workspaceState.legacyImportAudit
      assert.ok(audit)
      audit.quarantinedLegacyVisualObservationIds =
        ["legacy:visual:inexistente"]
      await rehashLegacyImportAudit(audit)
    }],
  ]

  for (const [label, mutate] of mutations) {
    const envelope = structuredClone(baseline)
    await mutate(envelope)
    await assert.rejects(
      importProductCaseWorkspaceExport(JSON.stringify(envelope)),
      /PRODUCT_CASE_IMPORT_LEGACY_AUDIT_(?:INVALID|MISSING|REQUIRED|SEMANTIC_MISMATCH|SEMANTICS_INVALID|OUTPUT_INVALID|PROVENANCE_INVALID)/,
      label,
    )
  }
})

test("imageId legacy coherente con dos puntos conserva el identificador completo", async () => {
  const imageId = "luna:gallery:main"
  const currentWorkspace = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
  )
  for (const observation of currentWorkspace.imageObservations) {
    observation.imageId = imageId
    observation.rawHumanInput.imageId = imageId
  }
  for (const observation of
    currentWorkspace.document.imageAnalysis.observations) {
    observation.imageId = imageId
    observation.rawHumanInput.imageId = imageId
  }
  const legacy = coherentStringLegacyOutputEnvelope(currentWorkspace)
  const firstImport = await importProductCaseWorkspaceExport(
    JSON.stringify(legacy),
  )
  assert.deepEqual(
    firstImport.historicalOutputAudit
      .quarantinedLegacyVisualObservationIds,
    [imageId],
  )
  assert.equal(
    firstImport.visualReviewContractIssues.includes(
      `HUMAN_VISUAL_REVIEW_LEGACY_EVIDENCE_UNVERIFIABLE:${imageId}`,
    ),
    true,
  )
  assert.equal(
    firstImport.workspaceState.document.imageAnalysis.observations[0].imageId,
    imageId,
  )

  const currentSerialized = serializeProductCaseWorkspaceExport({
    workspaceState: firstImport.workspaceState,
    exportedAt: CAPTURED_AT,
  })
  const secondImport = await importProductCaseWorkspaceExport(
    currentSerialized,
  )
  assert.deepEqual(
    secondImport.historicalOutputAudit
      .quarantinedLegacyVisualObservationIds,
    [imageId],
  )
  assert.deepEqual(
    secondImport.preservedWorkspaceState,
    firstImport.workspaceState,
  )
  assert.equal(
    serializeProductCaseWorkspaceExport({
      workspaceState: secondImport.workspaceState,
      exportedAt: CAPTURED_AT,
    }),
    currentSerialized,
  )
})

test("import legacy válido cerca de 1 MiB no depende del export V2 acotado", async () => {
  const targetBytes = PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES - 4_096
  const envelopeWithPadding = (paddingLength) => {
    const workspaceState = structuredClone(
      SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
    )
    workspaceState.listingOperations.itemSpecifics = {
      ...workspaceState.listingOperations.itemSpecifics,
      "Legacy audit padding": ["x".repeat(paddingLength)],
    }
    return authenticLegacyOutputEnvelope(workspaceState)
  }
  let lower = 0
  let upper = PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES
  let legacy = envelopeWithPadding(0)
  while (lower <= upper) {
    const midpoint = Math.floor((lower + upper) / 2)
    const candidate = envelopeWithPadding(midpoint)
    const candidateBytes = Buffer.byteLength(JSON.stringify(candidate))
    if (candidateBytes <= targetBytes) {
      legacy = candidate
      lower = midpoint + 1
    } else {
      upper = midpoint - 1
    }
  }
  const serializedLegacy = JSON.stringify(legacy)
  const sourceBytes = Buffer.byteLength(serializedLegacy)
  assert.ok(sourceBytes <= targetBytes)
  assert.ok(sourceBytes > targetBytes - 16_384)
  assert.equal(
    validateProductCaseImportFileMetadata({
      name: "product-case-browser-draft-near-limit.json",
      size: sourceBytes,
      type: "application/json",
    }),
    null,
  )
  assert.equal(validateProductCaseImportJsonCandidate(serializedLegacy), null)

  const imported = await importProductCaseWorkspaceExport(serializedLegacy)
  assert.equal(imported.legacyOutputRebuilt, true)
  assert.ok(imported.historicalOutputAudit)
  const unboundedCanonicalJson = JSON.stringify(
    createProductCaseWorkspaceExport({
      workspaceState: imported.workspaceState,
      exportedAt: CAPTURED_AT,
    }),
    null,
    2,
  )
  assert.ok(
    Buffer.byteLength(unboundedCanonicalJson) >
      PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES,
  )
  assert.throws(
    () => serializeProductCaseWorkspaceExport({
      workspaceState: imported.workspaceState,
      exportedAt: CAPTURED_AT,
    }),
    /PRODUCT_CASE_EXPORT_TOO_LARGE/,
    "el límite sigue aplicando únicamente al export explícito",
  )

  const page = read("app/admin/ebay/product-case-runner/page.tsx")
  const importStart = page.indexOf("async function importProductCaseJson")
  const exportStart = page.indexOf("function exportReviewedCase", importStart)
  assert.ok(importStart >= 0)
  assert.ok(exportStart > importStart)
  const importFlow = page.slice(importStart, exportStart)
  assert.doesNotMatch(
    importFlow,
    /serializeProductCaseWorkspaceExport\(/,
    "la importación no puede abortar por el límite del export explícito",
  )
  assert.match(
    importFlow,
    /JSON\.stringify\(\s*createProductCaseWorkspaceExport\(/,
    "la vista canónica auditada puede construirse sin el límite de export",
  )
})

test("preflight browser de import distingue pegado, archivo inválido y límite de 1 MB", () => {
  assert.equal(
    validateProductCaseImportJsonCandidate(
      JSON.stringify({ version: "PRODUCT_CASE_WORKSPACE_EXPORT_V1" }),
    ),
    null,
    "JSON sintácticamente válido pegado habilita la validación de dominio",
  )
  assert.equal(
    validateProductCaseImportJsonCandidate("{invalid"),
    "PRODUCT_CASE_IMPORT_JSON_INVALID",
  )
  assert.equal(
    validateProductCaseImportFileMetadata({
      name: "product-case.json",
      size: 12,
      type: "image/png",
    }),
    "PRODUCT_CASE_IMPORT_CONTENT_TYPE_INVALID",
  )
  assert.equal(
    validateProductCaseImportFileMetadata({
      name: "product-case.json",
      size: PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES + 1,
      type: "application/json",
    }),
    "PRODUCT_CASE_IMPORT_SIZE_LIMIT_EXCEEDED",
  )
  assert.equal(
    validateProductCaseImportJsonCandidate(
      JSON.stringify({ value: "x".repeat(PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES) }),
    ),
    "PRODUCT_CASE_IMPORT_SIZE_LIMIT_EXCEEDED",
  )
})

test("input file conserva selección visible tras rerender y habilita import sólo al leer JSON", () => {
  const page = read("app/admin/ebay/product-case-runner/page.tsx")
  assert.match(page, /const \[selectedImportFile, setSelectedImportFile\]/)
  assert.match(page, /const importFileInputRef = useRef<HTMLInputElement>/)
  assert.match(page, /setSelectedImportFile\(file\)/)
  assert.match(page, /await file\.text\(\)/)
  assert.match(page, /setImportJson\(rawJson\)/)
  assert.match(
    page,
    /const candidateError = validateProductCaseImportJsonCandidate\(rawJson\)[\s\S]*if \(candidateError\)[\s\S]*setImportJson\(rawJson\)/,
  )
  assert.match(page, /product-case-import-file-selection/)
  assert.match(page, /selectedImportFile\.name/)
  assert.match(page, /selectedImportFile\.size\.toLocaleString\(\)/)
  assert.match(page, /disabled=\{!importReady\}/)
  assert.match(page, /validateProductCaseImportJsonCandidate\(importJson\)/)
  assert.match(page, /PRODUCT_CASE_IMPORT_FILE_READ_FAILED/)
  assert.match(page, /product-case-import-file-retry/)
  assert.match(
    page,
    /importReadStatus === "ERROR"[\s\S]*importInputSource === "TEXTAREA"[\s\S]*importProductCaseFile\(selectedImportFile\)/,
  )
  assert.match(page, /VOLVER A CARGAR EL ARCHIVO SELECCIONADO/)
  assert.match(page, /product-case-legacy-output-warning/)
  assert.match(page, /product-case-import-mismatch-paths/)
  assert.match(page, /RUTAS DEL OUTPUT HISTÓRICO QUE CAMBIARON/)
  assert.match(page, /Historical envelope · audit only · never active/)
  assert.match(
    page,
    /errorCode === "PRODUCT_CASE_IMPORT_OUTPUT_MISMATCH"[\s\S]*!path\.includes\("REDACTED_KEY"\)/,
  )
  assert.doesNotMatch(page, /const importedOperationalPipeline/)
  assert.match(
    page,
    /const canonicalJson = JSON\.stringify\([\s\S]*createProductCaseWorkspaceExport\(/,
  )
  assert.match(
    page,
    /setImportInputSource\("TEXTAREA"\)[\s\S]*setNotice\(""\)[\s\S]*setImportRoundtrip\(null\)/,
  )
  assert.match(page, /const readGeneration = \+\+importReadGenerationRef\.current/)
  assert.match(
    page,
    /if \(importReadGenerationRef\.current !== readGeneration\) return/,
  )
  assert.match(page, /importReadGenerationRef\.current \+= 1/)
  assert.match(
    page,
    /const importGeneration = importReadGenerationRef\.current/,
  )
  assert.match(
    page,
    /if \(importReadGenerationRef\.current !== importGeneration\) return/,
  )
  assert.match(page, /const importReady = importReadStatus === "READY"/)
  assert.match(
    page,
    /setSelectedImportFile\(null\)[\s\S]*setImportReadStatus\("IDLE"\)[\s\S]*importFileInputRef\.current\.value = ""/,
  )
  assert.match(page, /ref=\{importFileInputRef\}/)
  assert.doesNotMatch(
    page,
    /if \(metadataError\) \{\s*setImportJson\(""\)/,
  )
  assert.doesNotMatch(
    page,
    /const readError = "PRODUCT_CASE_IMPORT_FILE_READ_FAILED"\s*setImportJson\(""\)/,
  )
  assert.doesNotMatch(page, /event\.currentTarget\.value\s*=\s*""/)
})

test("export UI conserva legacyImportAudit después de importar y editar localmente", () => {
  const page = read("app/admin/ebay/product-case-runner/page.tsx")
  assert.match(
    page,
    /const \[legacyImportAudit,\s*setLegacyImportAudit\]/,
  )
  const importStart = page.indexOf("async function importProductCaseJson")
  const exportStart = page.indexOf("function exportReviewedCase")
  const exportEnd = page.indexOf(
    "function exportRegistrationDraft",
    exportStart,
  )
  assert.ok(importStart >= 0)
  assert.ok(exportStart > importStart)
  assert.ok(exportEnd > exportStart)
  const importFlow = page.slice(importStart, exportStart)
  const exportFlow = page.slice(exportStart, exportEnd)
  assert.match(
    importFlow,
    /setLegacyImportAudit\([\s\S]*importedWorkspace\.legacyImportAudit/,
  )
  assert.match(
    exportFlow,
    /workspaceState:\s*\{[\s\S]*legacyImportAudit/,
  )
})

test("UI visual expone jerarquía auditable, anchors y retorno de foco al bloqueo", () => {
  const page = read("app/admin/ebay/product-case-runner/page.tsx")

  for (const marker of [
    "PHASE_2_EVIDENCE_REVIEW",
    "PHASE_3_HUMAN_VISUAL_REVIEW",
    "VISUAL_REVIEW_LEGACY_QUEUE",
    "VISUAL_REVIEW_CARD:",
    "EVIDENCE_CARD:",
  ]) {
    assert.match(page, new RegExp(marker), marker)
  }
  for (const anchor of [
    "phase-3-human-visual-review",
    "visual-review-legacy-queue",
  ]) {
    assert.match(
      page,
      new RegExp(`id=["']${anchor}["']`),
      `target ${anchor}`,
    )
  }
  assert.match(
    page,
    /href=\{`#\$\{navigationTarget\.anchorId\}`\}/,
    "la navegación de fases usa el target funcional mapeado",
  )
  assert.match(page, /href=["']#visual-review-legacy-queue["']/)
  assert.match(
    page,
    /const cardAnchor\s*=\s*visualReviewCardAnchorFor\(observation\)[\s\S]{0,500}id=\{cardAnchor\}/,
    "cada tarjeta debe ser el target de su anchor",
  )
  assert.match(
    page,
    /`visual-review-card-\$\{[\s\S]{0,300}(?:observation\.imageId|imageId)[\s\S]{0,300}\}`/,
    "#visual-review-card-luna-razor-front-01 debe derivarse del imageId",
  )
  assert.match(
    page,
    /HUMAN_VISUAL_REVIEW_HUMAN_CORRECTION_REQUIRED:[\s\S]{0,2500}<(?:button|a)[\s\S]{0,800}IR A CORREGIR/,
  )
  assert.match(page, /revisión visual requiere corrección/)
  assert.match(page, /<(?:button|a)[\s\S]{0,800}>\s*REVISAR AHORA\s*</)
  assert.match(
    page,
    /(?:pending|legacy)[A-Za-z]*Visual[A-Za-z]*\.map\([\s\S]{0,500}\.imageId/,
    "el resumen debe enumerar los imageIds pendientes",
  )

  const focusCalls = page.match(/\.focus\(/g) ?? []
  assert.ok(
    focusCalls.length >= 2,
    "el helper común y la edición deben transferir foco",
  )
  assert.match(
    page,
    /(?:getElementById|querySelector)[\s\S]{0,500}\.focus\(/,
  )
  assert.match(
    page,
    /editVisualObservation[\s\S]{0,2500}\.focus\(/,
  )
  assert.match(page, />\s*VOLVER AL BLOQUEO\s*</)
  assert.match(
    page,
    /(?:return|blocker|legacy)[A-Za-z]*(?:Focus|Target|Anchor|Ref)/i,
    "editar desde un bloqueo debe preservar el destino de retorno",
  )
})

test("anchors visuales son únicos con imageId legacy duplicado o faltante", () => {
  const page = read("app/admin/ebay/product-case-runner/page.tsx")
  assert.match(
    page,
    /function canonicalVisualReviewImageId\(value: string\)\s*\{[\s\S]{0,180}value\.normalize\("NFKC"\)\.replace\(\/\\s\+\/g, " "\)\.trim\(\)/,
    "el matcher visual usa la misma canonicalización Unicode/whitespace que el dominio",
  )
  assert.match(
    page,
    /function visualIssueMatchesObservation\([\s\S]{0,250}canonicalVisualReviewImageId\(observation\.imageId\)/,
    "front  01 debe enlazar el blocker canónico front 01",
  )
  assert.match(
    page,
    /function visualReviewCardAnchor\([\s\S]{0,250}disambiguator\?: string[\s\S]{0,350}return disambiguator[\s\S]{0,250}: baseAnchor/,
    "un imageId único conserva visual-review-card-luna-razor-front-01",
  )
  assert.match(
    page,
    /function visualReviewIssueAnchor\([\s\S]{0,250}disambiguator\?: string[\s\S]{0,350}return disambiguator[\s\S]{0,250}: baseAnchor/,
  )
  assert.match(
    page,
    /const visualReviewImageAnchorCounts\s*=\s*imageAnalysis\.observations\.reduce<Map<string, number>>/,
    "las colisiones se calculan sobre la colección canónica",
  )
  assert.match(
    page,
    /const needsDisambiguation\s*=\s*!observation\.imageId\.trim\(\)\s*\|\|[\s\S]{0,200}visualReviewImageAnchorCounts\.get\(segment\)[\s\S]{0,100}>\s*1/,
  )
  assert.match(
    page,
    /const observationIndex\s*=\s*imageAnalysis\.observations\.indexOf\(observation\)[\s\S]{0,200}return `\$\{observation\.evidenceId\}-\$\{observationIndex \+ 1\}`/,
    "evidenceId más ordinal evita colisión aun en registros legacy dañados",
  )
  for (const helper of [
    "visualReviewCardAnchorFor",
    "visualReviewIssueAnchorFor",
  ]) {
    assert.match(
      page,
      new RegExp(
        `function ${helper}\\([\\s\\S]{0,180}` +
        "observation: ProductCaseImageObservation[\\s\\S]{0,300}" +
        "visualReviewAnchorDisambiguator\\(observation\\)",
      ),
      helper,
    )
  }
  assert.match(
    page,
    /highlightedVisualReviewEvidenceId ===\s*observation\.evidenceId/,
    "el resaltado también distingue tarjetas con el mismo imageId",
  )
})

test("editar B reemplaza el return anchor heredado de A", () => {
  const page = read("app/admin/ebay/product-case-runner/page.tsx")
  assert.match(
    page,
    /type VisualReviewReturnTarget\s*=\s*\{[\s\S]{0,250}observationEvidenceId:\s*string[\s\S]{0,250}anchorId:\s*string[\s\S]{0,100}\}/,
    "evidencia y anchor forman una sola unidad atómica",
  )
  assert.match(
    page,
    /const \[\s*visualReviewReturnTarget,\s*setVisualReviewReturnTarget,\s*\]\s*=\s*useState<VisualReviewReturnTarget \| null>\(null\)/,
  )
  assert.doesNotMatch(
    page,
    /const \[\s*visualReviewReturn(?:Anchor|Evidence)Id,/,
    "dos estados independientes permiten pares A/B incoherentes",
  )

  const editStart = page.indexOf("function editVisualObservation(")
  const editEnd = page.indexOf(
    "function cancelVisualObservationEdit(",
    editStart,
  )
  assert.ok(editStart >= 0)
  assert.ok(editEnd > editStart)
  const editFlow = page.slice(editStart, editEnd)

  assert.match(
    editFlow,
    /setVisualReviewReturnTarget\(\s*\(current\)\s*=>[\s\S]{0,400}current\?\.observationEvidenceId === observation\.evidenceId[\s\S]{0,250}\? current[\s\S]{0,400}observationEvidenceId:\s*observation\.evidenceId[\s\S]{0,250}anchorId:/,
    "A sólo se conserva para A; al editar B se crea un target de B",
  )
  assert.doesNotMatch(
    editFlow,
    /setVisualReviewReturnTarget\(\s*\(current\)\s*=>\s*current\s*\?\?/,
    "un fallback ciego conservaría A al abrir B",
  )
  assert.match(
    page,
    /function returnToVisualReviewBlocker\(\)[\s\S]{0,500}visualReviewReturnTarget\.observationEvidenceId !==[\s\S]{0,100}editingVisualObservationEvidenceId[\s\S]{0,250}focusProductCaseTarget\(\s*visualReviewReturnTarget\.anchorId\s*\)/,
    "VOLVER sólo usa el par atómico de la tarjeta editada",
  )
  assert.match(
    page,
    /setVisualReviewReturnTarget\(\{\s*observationEvidenceId:\s*observation\.evidenceId,\s*anchorId:\s*returnAnchorId,\s*\}\)/,
    "IR A CORREGIR fija atómicamente el origen de esa tarjeta",
  )
})

test("revisiones visuales registradas tienen filtros, búsqueda y labels ES — clave técnica", () => {
  const page = read("app/admin/ebay/product-case-runner/page.tsx")
  const start = page.indexOf("REVISIONES VISUALES REGISTRADAS")
  const end = page.indexOf('id="strategy-input-preview"', start)
  assert.ok(start >= 0, "falta el encabezado de revisiones registradas")
  assert.ok(end > start, "falta delimitar el listado visual canónico")
  const visualReviewSection = page.slice(start, end)

  assert.match(visualReviewSection, /Total(?: de revisiones)?\s*:/)
  assert.match(visualReviewSection, /Pendientes\s*:/)
  for (const filter of ["TODAS", "PENDIENTES", "CORREGIDAS"]) {
    assert.match(
      visualReviewSection,
      new RegExp(`["']${filter}["']`),
      filter,
    )
  }
  assert.match(
    visualReviewSection,
    /aria-pressed=\{visualReviewFilter === filter\}/,
    "cada filtro generado debe anunciar su estado seleccionado",
  )
  assert.match(
    visualReviewSection,
    /<label[\s\S]{0,400}htmlFor=["']visual-review-search["'][\s\S]{0,400}Buscar revisión visual/i,
  )
  assert.match(
    visualReviewSection,
    /<input(?=[\s\S]{0,400}id=["']visual-review-search["'])(?=[\s\S]{0,400}type=["']search["'])[\s\S]{0,500}\/>/,
  )
  assert.match(
    page,
    /const searchable = \[[\s\S]{0,250}observation\.imageId,[\s\S]{0,250}observation\.evidenceId,[\s\S]{0,500}return searchable\.includes\(normalizedVisualReviewQuery\)/,
    "la búsqueda debe incluir imageId",
  )
  assert.match(
    visualReviewSection,
    /data-testid=\{`human-visual-review-card-\$\{observation\.evidenceId\}`\}/,
    "se conserva el testid existente de cada tarjeta",
  )

  const labels = [
    ["ID de imagen", "imageId"],
    ["Referencia de origen", "sourceReference"],
    ["URL de origen", "sourceUrl"],
    ["Tipo de producto observado", "observedProductType"],
    ["Características visibles", "visibleFeatures"],
    ["Texto visible en la imagen", "visibleText"],
    ["Marcas visibles", "visibleBrands"],
    ["Colores visibles", "visibleColors"],
    ["Cantidad visible", "visibleQuantity"],
    ["Variante observada", "observedVariant"],
    ["Bloqueos visuales", "possibleConflicts"],
    ["Confianza", "confidence"],
    ["Decisión humana", "humanDecision"],
    ["Motivo humano", "humanReason"],
  ]
  for (const [spanish, technicalKey] of labels) {
    assert.match(
      page,
      new RegExp(`${spanish}\\s*—\\s*${technicalKey}`),
      `${spanish} — ${technicalKey}`,
    )
  }
  assert.equal(
    (page.match(/data-testid="add-human-visual-review"/g) ?? []).length,
    1,
    "se conserva un único formulario canónico con su testid actual",
  )
})

test("import rechaza tampering visual de igual longitud aunque se recalcule el envelope", async () => {
  const workspaceState = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
  )
  workspaceState.document.imageAnalysis.observations[0].visibleColors[0] =
    "WHITE"
  workspaceState.imageObservations[0].visibleColors[0] = "WHITE"
  const envelope = createProductCaseWorkspaceExport({
    workspaceState,
    exportedAt: CAPTURED_AT,
  })
  await assert.rejects(
    importProductCaseWorkspaceExport(JSON.stringify(envelope)),
    /HUMAN_VISUAL_REVIEW_CONTENT_HASH_MISMATCH:sanitized-main/,
  )
})

test("integridad visual cruza hash, ID, captura, evidencia e identidad", async () => {
  const original = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
      .document,
  )
  assert.deepEqual(
    await validateHumanVisualReviewIntegrity(original),
    { valid: true, errors: [] },
  )

  const badHash = structuredClone(original)
  badHash.imageAnalysis.observations[0].contentHash =
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  assert.match(
    (await validateHumanVisualReviewIntegrity(badHash)).errors.join("\n"),
    /HUMAN_VISUAL_REVIEW_CONTENT_HASH_MISMATCH/,
  )

  const badId = structuredClone(original)
  badId.imageAnalysis.observations[0].evidenceId = "visual-invalid-id"
  assert.match(
    (await validateHumanVisualReviewIntegrity(badId)).errors.join("\n"),
    /HUMAN_VISUAL_REVIEW_EVIDENCE_ID_MISMATCH/,
  )

  const badCapture = structuredClone(original)
  badCapture.captures.find((entry) =>
    entry.sourceType === "HUMAN_VISUAL_OBSERVATION"
  ).byteLength += 1
  assert.match(
    (await validateHumanVisualReviewIntegrity(badCapture)).errors.join("\n"),
    /HUMAN_VISUAL_REVIEW_CAPTURE_MISMATCH/,
  )

  const badEvidence = structuredClone(original)
  badEvidence.evidence.find((entry) =>
    entry.sourceType === "HUMAN_VISUAL_OBSERVATION"
  ).normalizedValue.visibleColors = ["WHITE"]
  assert.match(
    (await validateHumanVisualReviewIntegrity(badEvidence)).errors.join("\n"),
    /HUMAN_VISUAL_REVIEW_EVIDENCE_MISMATCH/,
  )

  const badIdentity = structuredClone(original)
  badIdentity.identityReview.humanObservationEvidenceIds = []
  assert.match(
    (await validateHumanVisualReviewIntegrity(badIdentity)).errors.join("\n"),
    /HUMAN_VISUAL_REVIEW_IDENTITY_REFERENCES_MISMATCH/,
  )

  for (const [label, document] of [
    ["hash", badHash],
    ["id", badId],
    ["capture", badCapture],
    ["evidence", badEvidence],
    ["identity", badIdentity],
  ]) {
    const workspaceState = {
      ...structuredClone(
        SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
      ),
      document,
      imageObservations: structuredClone(
        document.imageAnalysis.observations,
      ),
    }
    const validEnvelope = createProductCaseWorkspaceExport({
      workspaceState:
        SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
      exportedAt: CAPTURED_AT,
    })
    const externallyRecomputedEnvelope = {
      ...validEnvelope,
      workspaceState,
      output: buildWorkspaceOutput(workspaceState),
    }
    await assert.rejects(
      importProductCaseWorkspaceExport(
        JSON.stringify(externallyRecomputedEnvelope),
      ),
      /PRODUCT_CASE_IMPORT_(?:PROVENANCE|CRYPTOGRAPHIC_PROVENANCE)_INVALID/,
      label,
    )
  }
})

test("imageId visual duplicado es un gate persistente de listing y handoff", () => {
  const workspace = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
  )
  workspace.document.imageAnalysis.observations.push(
    structuredClone(workspace.document.imageAnalysis.observations[0]),
  )
  workspace.imageObservations = structuredClone(
    workspace.document.imageAnalysis.observations,
  )
  workspace.document.imageAnalysis.contractIssues = [
    "HUMAN_VISUAL_REVIEW_IMAGE_ID_DUPLICATE_OR_MISSING:sanitized-main",
  ]
  const output = buildWorkspaceOutput(workspace)
  assert.equal(output.manualHandoffAllowed, false)
  assert.notEqual(
    output.listingPackageStatus,
    "READY_FOR_HUMAN_SELLER_HUB_ENTRY",
  )
  assert.match(
    JSON.stringify(output),
    /HUMAN_VISUAL_REVIEW_IMAGE_ID_DUPLICATE_OR_MISSING/,
  )
})

test("import recalcula SHA-256 y rechaza tampering de igual longitud", async () => {
  const document = structuredClone(
    GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document,
  )
  const workspaceState = {
    document,
    economicsPolicy: null,
    scenarioDraft: null,
    listingOperations: structuredClone(
      GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.listingOperations,
    ),
    imageApprovals: [],
    imageObservations: structuredClone(
      document.imageAnalysis.observations,
    ),
    evaluatedAt: CAPTURED_AT,
    generatedAt: CAPTURED_AT,
  }
  const serialized = serializeProductCaseWorkspaceExport({
    workspaceState,
    exportedAt: CAPTURED_AT,
  })
  const tampered = JSON.parse(serialized)
  const originalText =
    tampered.workspaceState.document.supplierSourceCapture
      .rawVisibleSourceText
  const alteredText = originalText.replace("Smart", "Smort")
  assert.notEqual(alteredText, originalText)
  assert.equal(
    new TextEncoder().encode(alteredText).byteLength,
    new TextEncoder().encode(originalText).byteLength,
  )
  tampered.workspaceState.document.supplierSourceCapture
    .rawVisibleSourceText = alteredText

  const integrity = await validateProductCaseDocumentProvenanceIntegrity(
    tampered.workspaceState.document,
  )
  assert.equal(integrity.valid, false)
  assert.equal(
    integrity.errors.includes(
      "SUPPLIER_SOURCE_CAPTURE_CONTENT_HASH_MISMATCH",
    ),
    true,
  )
  assert.equal(
    integrity.errors.includes(
      "SUPPLIER_SOURCE_PRODUCT_CASE_CAPTURE_HASH_MISMATCH",
    ),
    true,
  )
  await assert.rejects(
    importProductCaseWorkspaceExport(JSON.stringify(tampered)),
    /PRODUCT_CASE_IMPORT_CRYPTOGRAPHIC_PROVENANCE_INVALID/,
  )
})

test("cambiar parserVersion invalida la captura hasta reprocesarla", async () => {
  const legacy = structuredClone(
    GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document,
  )
  legacy.supplierSourceCapture.parserVersion = "LUNA_TEXT_PARSER_LEGACY"
  const matchingCapture = legacy.captures.find((capture) =>
    capture.contentHash === legacy.supplierSourceCapture.contentHash
  )
  assert.ok(matchingCapture)
  matchingCapture.parserVersion = "LUNA_TEXT_PARSER_LEGACY"

  const validation = await validateProductCaseDocumentProvenanceIntegrity(
    legacy,
  )
  assert.equal(validation.valid, false)
  assert.equal(
    validation.errors.includes("SUPPLIER_SOURCE_CAPTURE_CONTRACT_INVALID"),
    true,
  )
})

test("transición pura de clear elimina estado derivado obsoleto", () => {
  const original = structuredClone(
    GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document,
  )
  const previousHash = original.supplierSourceCapture.contentHash
  const previousCurrentConflict = original.identityReview.currentConflict
  const cleared = transitionProductCaseSupplierCapture({
    document: original,
    replacement: null,
  })

  assert.equal(cleared.supplierSourceCapture, null)
  assert.equal(
    cleared.evidence.some((entry) =>
      entry.sourceType.startsWith("LUNA_") &&
      entry.contentHash === previousHash
    ),
    false,
  )
  assert.equal(
    cleared.captures.some((entry) =>
      entry.sourceType === "LUNA_AUTHENTICATED_MANUAL_CAPTURE" &&
      entry.contentHash === previousHash
    ),
    false,
  )
  assert.equal(cleared.identityReview.status, "NOT_REVIEWED")
  assert.equal(cleared.identityReview.physicalProductVerified, false)
  assert.deepEqual(cleared.identityReview.supplierEvidenceIds, [])
  assert.deepEqual(
    cleared.identityReview.humanObservationEvidenceIds,
    original.imageAnalysis.observations.map((entry) => entry.evidenceId),
  )
  assert.equal(cleared.identityReview.currentConflict, null)
  assert.equal(
    cleared.identityReview.conflictHistory.includes(
      previousCurrentConflict,
    ),
    true,
  )
  assert.equal(
    cleared.imageAnalysis.conflictDetectedFrom.length,
    0,
  )
  assert.deepEqual(
    cleared.imageAnalysis.observations,
    original.imageAnalysis.observations,
    "human observations and their hashes must remain unchanged",
  )
  assert.equal(
    cleared.imageAnalysis.contractIssues.some((issue) =>
      issue.startsWith("HUMAN_VISUAL_REVIEW_STALE_SUPPLIER_REFERENCE:")
    ),
    true,
  )
  assert.equal(
    cleared.identityReview.blockers.some((issue) =>
      issue.startsWith("HUMAN_VISUAL_REVIEW_STALE_SUPPLIER_REFERENCE:")
    ),
    true,
  )
  for (const observation of cleared.imageAnalysis.observations) {
    assert.equal(
      cleared.evidence.some((entry) =>
        entry.id === observation.evidenceId &&
        entry.contentHash === observation.contentHash
      ),
      true,
    )
    assert.equal(
      cleared.captures.some((entry) =>
        entry.sourceType === "HUMAN_VISUAL_OBSERVATION" &&
        entry.contentHash === observation.contentHash
      ),
      true,
    )
  }
  assert.deepEqual(
    original,
    GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document,
    "the transition must not mutate its input",
  )
})

test("transición pura de reprocess reemplaza captura e invalida identidad", async () => {
  const original = structuredClone(
    GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document,
  )
  const previousHash = original.supplierSourceCapture.contentHash
  const replacementText =
    GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT.replaceAll("BLACK", "AZURE")
  const extraction = await extractProductCaseEvidence({
    sourceUrl: PILOT_URL,
    capturedAt: "2026-07-29T12:00:00.000Z",
    content: replacementText,
    format: "JSON",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  const supplierSourceCapture =
    await createManualAuthenticatedSupplierSourceCapture({
      supplierUrl: PILOT_URL,
      rawVisibleSourceText: replacementText,
      sourceAccessStatus: "AUTHENTICATED_SOURCE_REQUIRED",
      extraction,
      humanVisibleProductTextConfirmed: true,
    })
  const reprocessed = transitionProductCaseSupplierCapture({
    document: original,
    replacement: { supplierSourceCapture, extraction },
  })

  assert.equal(
    reprocessed.supplierSourceCapture.contentHash,
    extraction.capture.contentHash,
  )
  assert.equal(
    reprocessed.evidence.some((entry) =>
      entry.sourceType.startsWith("LUNA_") &&
      entry.contentHash === previousHash
    ),
    false,
  )
  assert.equal(
    reprocessed.captures.some((entry) =>
      entry.sourceType === "LUNA_AUTHENTICATED_MANUAL_CAPTURE" &&
      entry.contentHash === previousHash
    ),
    false,
  )
  assert.equal(reprocessed.identityReview.status, "NOT_REVIEWED")
  assert.equal(reprocessed.identityReview.currentConflict, null)
  assert.deepEqual(
    reprocessed.imageAnalysis.conflictDetectedFrom,
    [],
  )
  assert.equal(
    reprocessed.identityReview.supplierEvidenceIds.length > 0,
    true,
  )
  assert.equal(
    reprocessed.identityReview.supplierEvidenceIds.every((id) =>
      reprocessed.evidence.some((entry) => entry.id === id)
    ),
    true,
  )
  assert.deepEqual(
    reprocessed.identityReview.humanObservationEvidenceIds,
    original.imageAnalysis.observations.map((entry) => entry.evidenceId),
  )
  assert.deepEqual(
    reprocessed.imageAnalysis.observations,
    original.imageAnalysis.observations,
  )
  assert.equal(
    reprocessed.imageAnalysis.contractIssues.some((issue) =>
      issue.startsWith("HUMAN_VISUAL_REVIEW_STALE_SUPPLIER_REFERENCE:")
    ),
    true,
  )
  for (const observation of reprocessed.imageAnalysis.observations) {
    assert.equal(
      reprocessed.evidence.some((entry) =>
        entry.id === observation.evidenceId &&
        entry.contentHash === observation.contentHash
      ),
      true,
    )
    assert.equal(
      reprocessed.captures.some((entry) =>
        entry.sourceType === "HUMAN_VISUAL_OBSERVATION" &&
        entry.contentHash === observation.contentHash
      ),
      true,
    )
  }
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

test("HUMAN_IDENTITY_REVIEW_CONTRACT_V1 conserva identidad parcial sin convertir tipo general en identidad exacta", async () => {
  const fixture =
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
  const document = structuredClone(
    fixture.document,
  )
  const saved = await saveHumanIdentityReviewRecord(
    partialHumanIdentityReviewInput(document),
  )
  const identity = saved.updatedDocument.identityReview
  const review = identity.humanReview

  assert.ok(review)
  assert.equal(
    review.contractVersion,
    HUMAN_IDENTITY_REVIEW_CONTRACT_VERSION,
  )
  assert.match(review.reviewId, /^identity-review-/)
  assert.match(review.contentHash, /^sha256:[a-f0-9]{64}$/)
  assert.equal(review.reviewer, "HUMAN_IDENTITY_REVIEWER")
  assert.equal(review.reviewedAt, CAPTURED_AT)
  assert.equal(review.decision, "NEEDS_MORE_EVIDENCE")
  assert.equal(review.confidence, "LOW")
  assert.equal(review.sameGeneralProductTypeConfirmed, true)
  assert.equal(review.exactIdentityConfirmed, false)
  assert.equal(review.brandConfirmed, false)
  assert.equal(review.physicalProductVerified, false)
  assert.equal(identity.status, "PARTIAL")
  assert.equal(identity.confidence, "LOW")
  assert.equal(identity.nextAction, "CAPTURE_MISSING_IDENTITY_EVIDENCE")
  assert.equal(identity.physicalProductVerified, false)

  for (const field of [
    "brand",
    "model",
    "mpn",
    "supplierProductId",
    "supplierSku",
    "variantId",
    "color",
    "packQuantity",
  ]) {
    assert.equal(review[field], null, `${field} permanece MISSING/null`)
  }
  assert.equal(
    GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document.evidence
      .find((entry) => entry.field === "title")
      ?.sourceEvidenceClass,
    "SUPPLIER_STATED",
  )
  assert.deepEqual(
    review.rawHumanInput,
    partialHumanIdentityReviewInput(document).rawHumanInput,
  )

  const workspace = {
    ...structuredClone(fixture),
    document: saved.updatedDocument,
    imageObservations: structuredClone(
      saved.updatedDocument.imageAnalysis.observations,
    ),
  }
  const output = buildWorkspaceOutput(workspace)
  assert.equal(output.readiness.productIdentity, "PARTIAL")
  assert.equal(output.readiness.identityConfidence, "LOW")
  assert.notEqual(
    output.listingPackageStatus,
    "READY_FOR_HUMAN_SELLER_HUB_ENTRY",
  )
  assert.equal(output.listingPackage, null)
  assert.equal(output.manualHandoffAllowed, false)
  assert.equal(output.handoffArtifactGenerated, false)
  assert.equal(output.canPublishAutomatically, false)
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

  const deleted = deleteHumanIdentityReviewRecord({
    document: saved.updatedDocument,
  })
  assert.equal(deleted.identityReview.humanReview, null)
  assert.equal(deleted.identityReview.status, "NOT_REVIEWED")
  assert.equal(deleted.identityReview.confidence, "LOW")
  assert.equal(deleted.identityReview.physicalProductVerified, false)
  assert.equal(
    buildWorkspaceOutput({
      ...workspace,
      document: deleted,
      imageObservations: structuredClone(
        deleted.imageAnalysis.observations,
      ),
    }).manualHandoffAllowed,
    false,
  )
})

test("identidad humana rechaza evidencia duplicada, inexistente y verificación física no sustentada", async () => {
  const document = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
      .document,
  )
  const base = partialHumanIdentityReviewInput(document)
  await assert.rejects(
    saveHumanIdentityReviewRecord({
      ...base,
      evidenceIds: [base.evidenceIds[0], base.evidenceIds[0]],
      rawHumanInput: {
        ...base.rawHumanInput,
        evidenceIds: [base.evidenceIds[0], base.evidenceIds[0]],
      },
    }),
    /HUMAN_IDENTITY_REVIEW_EVIDENCE_ID_DUPLICATE/,
  )
  await assert.rejects(
    saveHumanIdentityReviewRecord({
      ...base,
      evidenceIds: ["identity-evidence-does-not-exist"],
      rawHumanInput: {
        ...base.rawHumanInput,
        evidenceIds: ["identity-evidence-does-not-exist"],
      },
    }),
    /HUMAN_IDENTITY_REVIEW_EVIDENCE_REFERENCE_MISSING/,
  )
  await assert.rejects(
    saveHumanIdentityReviewRecord({
      ...base,
      decision: "IDENTITY_CONFIRMED",
      confidence: "HIGH",
      exactIdentityConfirmed: true,
      physicalProductVerified: true,
      rawHumanInput: {
        ...base.rawHumanInput,
        decision: "IDENTITY_CONFIRMED",
        confidence: "HIGH",
        exactIdentityConfirmed: true,
        physicalProductVerified: true,
      },
    }),
    /HUMAN_IDENTITY_REVIEW_PHYSICAL_VERIFICATION_UNSUPPORTED/,
  )
})

test("cambiar evidencia visual o Luna invalida atómicamente la revisión de identidad", async () => {
  const fixture =
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
  const document = structuredClone(
    fixture.document,
  )
  const saved = await saveHumanIdentityReviewRecord(
    partialHumanIdentityReviewInput(document),
  )
  const observation =
    saved.updatedDocument.imageAnalysis.observations[0]
  const editedVisual = await createHumanVisualReviewRecord({
    document: saved.updatedDocument,
    replaceEvidenceId: observation.evidenceId,
    imageId: observation.imageId,
    sourceUrl: observation.sourceUrl,
    sourceReference: observation.sourceReference,
    reviewerType: "HUMAN",
    observedProductType: observation.observedProductType,
    visibleFeatures: [...observation.visibleFeatures, "human edit"],
    visibleText: [...observation.visibleText],
    visibleBrands: [...observation.visibleBrands],
    visibleColors: [...observation.visibleColors],
    visibleQuantity: observation.visibleQuantity,
    observedVariant: observation.observedVariant,
    possibleConflicts: [...observation.possibleConflicts],
    contradictsEvidenceIds: [...observation.contradictsEvidenceIds],
    confidence: observation.confidence,
    humanDecision: observation.humanDecision,
    humanReason: "Revisión visual editada humanamente.",
    reviewedAt: "2026-07-28T17:00:00.000Z",
    rawHumanInput: {
      ...observation.rawHumanInput,
      visibleFeatures:
        `${observation.rawHumanInput.visibleFeatures}\nhuman edit`,
      humanReason: "Revisión visual editada humanamente.",
    },
  })
  assert.equal(editedVisual.updatedDocument.identityReview.humanReview, null)
  assert.equal(
    editedVisual.updatedDocument.identityReview.status,
    "NOT_REVIEWED",
  )
  assert.equal(
    editedVisual.updatedDocument.identityReview.physicalProductVerified,
    false,
  )
  assert.match(
    editedVisual.updatedDocument.identityReview.blockers.join("\n"),
    /HUMAN_IDENTITY_REVIEW_REQUIRED_AFTER_VISUAL_EVIDENCE_CHANGE/,
  )
  assert.doesNotMatch(
    JSON.stringify(editedVisual.updatedDocument),
    new RegExp(saved.review.reviewId),
  )
  assert.doesNotMatch(
    JSON.stringify(editedVisual.updatedDocument),
    new RegExp(saved.review.contentHash),
  )
  assert.equal(
    buildWorkspaceOutput({
      ...structuredClone(fixture),
      document: editedVisual.updatedDocument,
      imageObservations: structuredClone(
        editedVisual.updatedDocument.imageAnalysis.observations,
      ),
    }).manualHandoffAllowed,
    false,
  )

  const savedAgain = await saveHumanIdentityReviewRecord(
    partialHumanIdentityReviewInput(document),
  )
  const clearedLuna = transitionProductCaseSupplierCapture({
    document: savedAgain.updatedDocument,
    replacement: null,
  })
  assert.equal(clearedLuna.identityReview.humanReview, null)
  assert.equal(clearedLuna.identityReview.status, "NOT_REVIEWED")
  assert.equal(clearedLuna.identityReview.physicalProductVerified, false)
  assert.match(
    clearedLuna.identityReview.blockers.join("\n"),
    /HUMAN_IDENTITY_REVIEW_REQUIRED/,
  )
  assert.equal(clearedLuna.identityReview.supplierEvidenceIds.length, 0)
  assert.doesNotMatch(
    JSON.stringify(clearedLuna),
    new RegExp(savedAgain.review.reviewId),
  )
  assert.doesNotMatch(
    JSON.stringify(clearedLuna),
    new RegExp(savedAgain.review.contentHash),
  )
})

test("export/import actual preserva revisión de identidad y rechaza tampering aunque se reconstruya output", async () => {
  const base =
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
  const document = structuredClone(base.document)
  const saved = await saveHumanIdentityReviewRecord(
    partialHumanIdentityReviewInput(document),
  )
  const workspaceState = {
    ...structuredClone(base),
    document: saved.updatedDocument,
    imageObservations: structuredClone(
      saved.updatedDocument.imageAnalysis.observations,
    ),
  }
  const serialized = serializeProductCaseWorkspaceExport(
    createProductCaseWorkspaceExport({
      workspaceState,
      exportedAt: CAPTURED_AT,
    }),
  )
  const imported = await importProductCaseWorkspaceExport(serialized)
  assert.deepEqual(
    imported.preservedWorkspaceState.document.identityReview.humanReview,
    saved.updatedDocument.identityReview.humanReview,
  )
  const roundTrip = serializeProductCaseWorkspaceExport(
    createProductCaseWorkspaceExport({
      workspaceState: imported.preservedWorkspaceState,
      exportedAt: CAPTURED_AT,
    }),
  )
  assert.equal(roundTrip, serialized)

  const tampered = JSON.parse(serialized)
  const historicalReason =
    tampered.workspaceState.document.identityReview.humanReview.humanReason
  tampered.workspaceState.document.identityReview.humanReview.humanReason =
    historicalReason.replace("parece", "PARECE")
  assert.equal(
    tampered.workspaceState.document.identityReview.humanReview.humanReason
      .length,
    historicalReason.length,
  )
  tampered.output = buildWorkspaceOutput(tampered.workspaceState)
  await assert.rejects(
    importProductCaseWorkspaceExport(JSON.stringify(tampered)),
    /HUMAN_IDENTITY_REVIEW_(?:CONTENT_HASH|INTEGRITY)_MISMATCH/,
  )

  const staleReference = JSON.parse(serialized)
  staleReference.workspaceState.document.identityReview.humanReview
    .evidenceIds[0] = "identity-evidence-does-not-exist"
  staleReference.workspaceState.document.identityReview.humanReview
    .rawHumanInput.evidenceIds[0] = "identity-evidence-does-not-exist"
  staleReference.output = buildWorkspaceOutput(
    staleReference.workspaceState,
  )
  await assert.rejects(
    importProductCaseWorkspaceExport(JSON.stringify(staleReference)),
    /HUMAN_IDENTITY_REVIEW_EVIDENCE_REFERENCE_MISSING/,
  )

  const duplicatedReference = JSON.parse(serialized)
  const repeatedId =
    duplicatedReference.workspaceState.document.identityReview.humanReview
      .evidenceIds[0]
  duplicatedReference.workspaceState.document.identityReview.humanReview
    .evidenceIds.push(repeatedId)
  duplicatedReference.workspaceState.document.identityReview.humanReview
    .rawHumanInput.evidenceIds.push(repeatedId)
  duplicatedReference.output = buildWorkspaceOutput(
    duplicatedReference.workspaceState,
  )
  await assert.rejects(
    importProductCaseWorkspaceExport(JSON.stringify(duplicatedReference)),
    /HUMAN_IDENTITY_REVIEW_EVIDENCE_ID_DUPLICATE/,
  )
})

test("UI de fase 4 navega al contrato canónico y expone acciones humanas", () => {
  const page = read("app/admin/ebay/product-case-runner/page.tsx")
  const navigationStart = page.indexOf(
    "const PRODUCT_CASE_PHASE_NAVIGATION_TARGETS",
  )
  const navigationEnd = page.indexOf("] as const", navigationStart)
  assert.ok(navigationStart >= 0)
  assert.ok(navigationEnd > navigationStart)
  const navigation = page.slice(navigationStart, navigationEnd)
  const targets = [
    ...navigation.matchAll(/anchorId:\s*"([^"]+)"/g),
  ].map((match) => match[1])

  assert.equal(targets[1], "phase-2-evidence-review")
  assert.equal(targets[2], "phase-3-human-visual-review")
  assert.equal(targets[3], "phase-4-identity-and-variants")
  assert.match(
    navigation,
    /anchorId:\s*"phase-4-identity-and-variants"[\s\S]*focusId:\s*"identity-review-heading"/,
  )
  assert.match(page, /id="phase-4-identity-and-variants"/)
  assert.match(page, /id="identity-review-heading"/)
  assert.match(
    page,
    /function navigateToProductCasePhase[\s\S]*setActivePhaseIndex\(index\)[\s\S]*window\.requestAnimationFrame\(\(\) => \{[\s\S]*window\.requestAnimationFrame\(\(\) => \{[\s\S]*focusProductCaseTarget\(target\.anchorId, target\.focusId\)/,
  )
  assert.match(page, /HUMAN_IDENTITY_REVIEW_CONTRACT_V1/)
  assert.match(page, /GUARDAR REVISIÓN DE IDENTIDAD/)
  assert.match(page, /EDITAR REVISIÓN/)
  assert.match(page, /REVISAR EVIDENCIA FALTANTE/)
  assert.match(page, /saveHumanIdentityReviewRecord/)
  assert.match(page, /deleteHumanIdentityReviewRecord/)
  assert.match(page, /supplierEvidenceIds/)
  assert.match(page, /humanObservationEvidenceIds/)
  assert.match(page, /Campos MISSING/)
  assert.match(page, /physicalProductVerified:\s*false/)
  assert.match(page, /setGeneratedPackage\(null\)/)
  const saveStart = page.indexOf(
    "async function saveHumanIdentityReview()",
  )
  const editStart = page.indexOf(
    "function editHumanIdentityReview()",
    saveStart,
  )
  const deleteStart = page.indexOf(
    "function deleteHumanIdentityReview()",
    editStart,
  )
  const missingStart = page.indexOf(
    "function reviewMissingIdentityEvidence()",
    deleteStart,
  )
  assert.ok(saveStart >= 0 && editStart > saveStart)
  assert.ok(deleteStart > editStart && missingStart > deleteStart)
  assert.match(
    page.slice(saveStart, editStart),
    /new Date\(\)\.toISOString\(\)/,
  )
  assert.match(
    page.slice(saveStart, editStart),
    /setGeneratedPackage\(null\)/,
  )
  assert.match(
    page.slice(deleteStart, missingStart),
    /setGeneratedPackage\(null\)/,
  )
})

test("READY exige HUMAN_IDENTITY_REVIEW_CONTRACT_V1 verificable", async () => {
  const base =
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
  const fixtureReview = base.document.identityReview.humanReview
  assert.ok(fixtureReview)
  assert.equal(
    fixtureReview.contractVersion,
    HUMAN_IDENTITY_REVIEW_CONTRACT_VERSION,
  )
  assert.deepEqual(
    await validateHumanIdentityReviewIntegrity(base.document),
    { valid: true, errors: [] },
  )
  assert.equal(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_OUTPUT
      .readiness.productIdentity,
    "READY",
  )
  assert.equal(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_OUTPUT
      .manualHandoffAllowed,
    true,
  )

  const withoutContract = structuredClone(base)
  delete withoutContract.document.identityReview.humanReview
  const output = buildWorkspaceOutput(withoutContract)
  assert.notEqual(output.readiness.productIdentity, "READY")
  assert.notEqual(
    output.listingPackageStatus,
    "READY_FOR_HUMAN_SELLER_HUB_ENTRY",
  )
  assert.equal(output.listingPackage, null)
  assert.equal(output.manualHandoffAllowed, false)
  assert.equal(output.handoffArtifactGenerated, false)
})

test("output V1 pre-identidad auténtico se reconstruye bloqueado; contrato actual conserva mismatch fail-closed", async () => {
  const base =
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
  const historical = createProductCaseWorkspaceExport({
    workspaceState: structuredClone(base),
    exportedAt: CAPTURED_AT,
  })
  historical.outputContractVersion =
    PRODUCT_CASE_PRE_IDENTITY_OUTPUT_CONTRACT_VERSION
  delete historical.workspaceState.document.identityReview.humanReview
  const stripHumanIdentityReview = (value) => {
    if (Array.isArray(value)) {
      value.forEach(stripHumanIdentityReview)
      return
    }
    if (!value || typeof value !== "object") return
    if (
      Object.hasOwn(value, "supplierEvidenceIds") &&
      Object.hasOwn(value, "humanObservationEvidenceIds")
    ) {
      delete value.humanReview
    }
    Object.values(value).forEach(stripHumanIdentityReview)
  }
  stripHumanIdentityReview(historical.output)

  const imported = await importProductCaseWorkspaceExport(
    JSON.stringify(historical),
  )
  assert.equal(imported.preIdentityOutputRebuilt, true)
  assert.equal(imported.legacyOutputRebuilt, true)
  assert.deepEqual(imported.importWarnings, [
    PRODUCT_CASE_PRE_IDENTITY_OUTPUT_WARNING,
  ])
  assert.match(
    imported.workspaceState.document.identityReview.blockers.join("\n"),
    /PRE_IDENTITY_CONTRACT_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN/,
  )
  assert.equal(
    imported.workspaceState.document.identityReview.status,
    "NOT_REVIEWED",
  )
  assert.equal(imported.rebuiltOutput.listingPackage, null)
  assert.equal(imported.rebuiltOutput.manualHandoffAllowed, false)
  assert.equal(imported.rebuiltOutput.handoffArtifactGenerated, false)

  const current = createProductCaseWorkspaceExport({
    workspaceState: structuredClone(base),
    exportedAt: CAPTURED_AT,
  })
  assert.equal(
    current.outputContractVersion,
    PRODUCT_CASE_OUTPUT_CONTRACT_VERSION,
  )
  current.output.manualHandoffAllowed = false
  await assert.rejects(
    importProductCaseWorkspaceExport(JSON.stringify(current)),
    /PRODUCT_CASE_IMPORT_OUTPUT_MISMATCH/,
  )
})

test("review/commit de evidencia Luna invalida identidad y paquete en la transición UI", () => {
  const page = read("app/admin/ebay/product-case-runner/page.tsx")
  const start = page.indexOf("function commitReview(")
  const end = page.indexOf("function editVisualObservation(", start)
  assert.ok(start >= 0)
  assert.ok(end > start)
  const commitFlow = page.slice(start, end)
  assert.match(
    commitFlow,
    /sourceType\.startsWith\("LUNA_"\)/,
  )
  assert.match(
    commitFlow,
    /deleteHumanIdentityReviewRecord\(\{[\s\S]*evidence:\s*reviewedEvidence/,
  )
  assert.match(
    commitFlow,
    /setIdentityReviewState\(invalidatedDocument\.identityReview\)/,
  )
  assert.match(commitFlow, /setGeneratedPackage\(null\)/)

  const transition = transitionProductCaseSupplierCapture({
    document: structuredClone(
      SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
        .document,
    ),
    replacement: null,
  })
  assert.equal(transition.identityReview.humanReview, null)
  assert.equal(transition.identityReview.status, "NOT_REVIEWED")
  assert.equal(transition.identityReview.physicalProductVerified, false)
  assert.notEqual(
    buildWorkspaceOutput({
      ...structuredClone(
        SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
      ),
      document: transition,
    }).listingPackageStatus,
    "READY_FOR_HUMAN_SELLER_HUB_ENTRY",
  )
})

test("blockers legacy y de autenticación sobreviven guardar/eliminar identidad y bloquean READY", async () => {
  const base =
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
  const document = structuredClone(base.document)
  document.identityReview.blockers = [
    "LEGACY_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN",
    "AUTHENTICATED_SUPPLIER_CAPTURE_REQUIRED",
  ]
  const saved = await saveHumanIdentityReviewRecord(
    canonicalHumanIdentityReviewInput(document),
  )
  assert.equal(saved.updatedDocument.identityReview.status, "READY")
  assert.match(
    saved.updatedDocument.identityReview.blockers.join("\n"),
    /LEGACY_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN/,
  )
  assert.match(
    saved.updatedDocument.identityReview.blockers.join("\n"),
    /AUTHENTICATED_SUPPLIER_CAPTURE_REQUIRED/,
  )
  const savedOutput = buildWorkspaceOutput({
    ...structuredClone(base),
    document: saved.updatedDocument,
  })
  assert.notEqual(savedOutput.readiness.productIdentity, "READY")
  assert.equal(savedOutput.manualHandoffAllowed, false)
  assert.equal(savedOutput.listingPackage, null)

  const deleted = deleteHumanIdentityReviewRecord({
    document: saved.updatedDocument,
  })
  assert.match(
    deleted.identityReview.blockers.join("\n"),
    /LEGACY_OUTPUT_REBUILT_WITH_CURRENT_DOMAIN/,
  )
  assert.match(
    deleted.identityReview.blockers.join("\n"),
    /AUTHENTICATED_SUPPLIER_CAPTURE_REQUIRED/,
  )
  assert.equal(deleted.identityReview.status, "NOT_REVIEWED")
  assert.equal(
    buildWorkspaceOutput({
      ...structuredClone(base),
      document: deleted,
    }).manualHandoffAllowed,
    false,
  )
})

test("TITLE_READY exige ebay_optimized_title humano y nunca el title original Luna", () => {
  const base =
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
  const canonicalOutput = buildWorkspaceOutput(structuredClone(base))
  const canonicalTitleGate = canonicalOutput.listingPackage?.gates.find(
    (gate) => gate.id === "TITLE_READY",
  )
  assert.equal(canonicalTitleGate?.status, "PASS")
  assert.deepEqual(
    base.listingOperations.evidenceLinks.title,
    ["san-ebay-title"],
  )
  const optimizedTitleEvidence = base.document.evidence.find((entry) =>
    entry.id === "san-ebay-title"
  )
  assert.equal(
    optimizedTitleEvidence?.field,
    "ebay_optimized_title",
  )
  assert.equal(
    optimizedTitleEvidence?.sourceType,
    "HUMAN_CORRECTION",
  )

  const supplierTitleWorkspace = structuredClone(base)
  const supplierTitleSeed =
    GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document.evidence.find(
      (entry) => entry.field === "title",
    )
  assert.ok(supplierTitleSeed)
  const supplierTitle = structuredClone(supplierTitleSeed)
  supplierTitle.rawValue = "Sanitized Deterministic Product"
  supplierTitle.normalizedValue = "Sanitized Deterministic Product"
  supplierTitle.originalValue = "Sanitized Deterministic Product"
  const supplierCapture =
    GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document.captures.find(
      (capture) =>
        capture.sourceType === supplierTitle.sourceType &&
        capture.sourceUrl === supplierTitle.sourceUrl &&
        capture.capturedAt === supplierTitle.capturedAt &&
        capture.contentHash === supplierTitle.contentHash,
    )
  assert.ok(supplierCapture)
  supplierTitleWorkspace.document.evidence.push(
    structuredClone(supplierTitle),
  )
  supplierTitleWorkspace.document.captures.push(
    structuredClone(supplierCapture),
  )
  supplierTitleWorkspace.listingOperations.title =
    supplierTitle.normalizedValue
  supplierTitleWorkspace.listingOperations.evidenceLinks.title = [
    supplierTitle.id,
  ]
  supplierTitleWorkspace.listingOperations.supportingEvidenceIds.push(
    supplierTitle.id,
  )
  const output = buildWorkspaceOutput(supplierTitleWorkspace)
  const titleGate = output.listingPackage?.gates.find(
    (gate) => gate.id === "TITLE_READY",
  )
  assert.equal(supplierTitle.sourceEvidenceClass, "SUPPLIER_STATED")
  assert.equal(titleGate?.status, "BLOCKED")
  assert.match(
    titleGate?.blockers.join("\n") ?? "",
    /HUMAN_REVIEWED_TITLE_REQUIRED/,
  )
  assert.equal(output.manualHandoffAllowed, false)
})

test("identidad rechaza campos inventados, evidencia irrelevante/rechazada y tipo general sin doble contexto", async () => {
  const document = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
      .document,
  )
  const base = partialHumanIdentityReviewInput(document)

  await assert.rejects(
    saveHumanIdentityReviewRecord({
      ...base,
      model: "INVENTED-MODEL",
      rawHumanInput: {
        ...base.rawHumanInput,
        model: "INVENTED-MODEL",
      },
    }),
    /HUMAN_IDENTITY_REVIEW_FIELD_EVIDENCE_UNSUPPORTED:model/,
  )

  await assert.rejects(
    saveHumanIdentityReviewRecord({
      ...base,
      evidenceIds: [...base.evidenceIds, "san-unit-cost"],
      rawHumanInput: {
        ...base.rawHumanInput,
        evidenceIds: [...base.evidenceIds, "san-unit-cost"],
      },
    }),
    /HUMAN_IDENTITY_REVIEW_EVIDENCE_NOT_CURRENT_OR_ACCEPTED:san-unit-cost/,
  )

  const rejectedDocument = structuredClone(document)
  const rejectedProductType = rejectedDocument.evidence.find((entry) =>
    entry.id === "san-product-type"
  )
  assert.ok(rejectedProductType)
  rejectedProductType.evidenceStatus = "REJECTED"
  rejectedProductType.humanVerdict = "REJECT"
  rejectedProductType.humanReason = "Human rejected this identity evidence."
  const rejectedInput = partialHumanIdentityReviewInput(rejectedDocument)
  await assert.rejects(
    saveHumanIdentityReviewRecord(rejectedInput),
    /HUMAN_IDENTITY_REVIEW_EVIDENCE_NOT_CURRENT_OR_ACCEPTED:san-product-type/,
  )

  const visualId = document.imageAnalysis.observations[0].evidenceId
  const noVisualIds = base.evidenceIds.filter((id) => id !== visualId)
  await assert.rejects(
    saveHumanIdentityReviewRecord({
      ...base,
      evidenceIds: noVisualIds,
      rawHumanInput: {
        ...base.rawHumanInput,
        evidenceIds: noVisualIds,
      },
    }),
    /HUMAN_IDENTITY_REVIEW_GENERAL_PRODUCT_TYPE_UNSUPPORTED/,
  )
  await assert.rejects(
    saveHumanIdentityReviewRecord({
      ...base,
      evidenceIds: [visualId],
      rawHumanInput: {
        ...base.rawHumanInput,
        evidenceIds: [visualId],
      },
    }),
    /HUMAN_IDENTITY_REVIEW_GENERAL_PRODUCT_TYPE_UNSUPPORTED/,
  )
})

test("HUMAN_HYPOTHESIS y HUMAN_CORRECTION no sustentan identidad exacta ni READY", async () => {
  const base =
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
  const document = structuredClone(base.document)
  const modelEvidence = document.evidence.find((entry) =>
    entry.id === "san-model"
  )
  assert.ok(modelEvidence)
  modelEvidence.sourceType = "HUMAN_CORRECTION"
  modelEvidence.evidenceClass = "HUMAN_HYPOTHESIS"
  modelEvidence.sourceEvidenceClass = "HUMAN_HYPOTHESIS"
  modelEvidence.evidenceStatus = "CORRECTED"
  modelEvidence.humanVerdict = "CORRECT"
  modelEvidence.humanReason =
    "Hipótesis humana no verificable como identidad exacta."
  modelEvidence.correctedValue = modelEvidence.normalizedValue
  const reviewInput = canonicalHumanIdentityReviewInput(document)
  const independentPhysicalIds =
    reviewInput.physicalVerificationEvidenceIds.filter((id) =>
      id !== modelEvidence.id
    )

  await assert.rejects(
    saveHumanIdentityReviewRecord({
      ...reviewInput,
      physicalVerificationEvidenceIds: independentPhysicalIds,
      rawHumanInput: {
        ...reviewInput.rawHumanInput,
        physicalVerificationEvidenceIds: independentPhysicalIds,
      },
    }),
    /HUMAN_IDENTITY_REVIEW_FIELD_EVIDENCE_UNSUPPORTED:model/,
  )

  const validation = await validateHumanIdentityReviewIntegrity(document)
  assert.equal(validation.valid, false)
  assert.equal(
    validation.errors.includes(
      "HUMAN_IDENTITY_REVIEW_FIELD_EVIDENCE_UNSUPPORTED:model",
    ),
    true,
  )
  assert.equal(
    validation.errors.includes(
      "HUMAN_IDENTITY_REVIEW_EXACT_IDENTITY_UNSUPPORTED",
    ),
    true,
  )
  const output = buildWorkspaceOutput({
    ...structuredClone(base),
    document,
  })
  assert.notEqual(output.readiness.productIdentity, "READY")
  assert.equal(output.manualHandoffAllowed, false)
  assert.equal(output.handoffArtifactGenerated, false)
})

test("LOW nunca habilita READY ni se reporta como HIGH", async () => {
  const base =
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
  const document = structuredClone(base.document)
  await assert.rejects(
    saveHumanIdentityReviewRecord(
      canonicalHumanIdentityReviewInput(document, {
        confidence: "LOW",
        rawHumanInput: { confidence: "LOW" },
      }),
    ),
    /HUMAN_IDENTITY_REVIEW_READY_CONFIDENCE_INSUFFICIENT/,
  )

  const partial = await saveHumanIdentityReviewRecord(
    partialHumanIdentityReviewInput(document),
  )
  const output = buildWorkspaceOutput({
    ...structuredClone(base),
    document: partial.updatedDocument,
    imageObservations: structuredClone(
      partial.updatedDocument.imageAnalysis.observations,
    ),
  })
  assert.equal(output.readiness.productIdentity, "PARTIAL")
  assert.equal(output.readiness.identityConfidence, "LOW")
  assert.notEqual(
    output.listingPackageStatus,
    "READY_FOR_HUMAN_SELLER_HUB_ENTRY",
  )
  assert.equal(output.manualHandoffAllowed, false)
})

test("supplierEvidenceIds exige el conjunto Luna canónico exacto", async () => {
  const baseDocument = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
      .document,
  )
  const extraLunaDocument = structuredClone(baseDocument)
  const extraLunaEvidence = extraLunaDocument.evidence.find((entry) =>
    entry.id === "san-stock"
  )
  assert.ok(extraLunaEvidence)
  extraLunaEvidence.sourceType = "LUNA_AUTHENTICATED_MANUAL_CAPTURE"
  extraLunaEvidence.evidenceClass = "SUPPLIER_STATED"
  extraLunaEvidence.sourceEvidenceClass = "SUPPLIER_STATED"

  for (const [label, document, supplierEvidenceIds] of [
    ["extra Luna no seleccionada", extraLunaDocument, ["san-stock"]],
    ["referencia que no es Luna", baseDocument, ["san-title"]],
    [
      "referencia inexistente o manipulada",
      baseDocument,
      ["supplier-evidence-does-not-exist"],
    ],
    [
      "referencia duplicada",
      extraLunaDocument,
      ["san-stock", "san-stock"],
    ],
  ]) {
    const candidate = structuredClone(document)
    candidate.identityReview.supplierEvidenceIds = supplierEvidenceIds
    const validation = await validateHumanIdentityReviewIntegrity(candidate)
    assert.equal(validation.valid, false, label)
    assert.equal(
      validation.errors.includes(
        "HUMAN_IDENTITY_REVIEW_SUPPLIER_REFERENCES_MISMATCH",
      ),
      true,
      label,
    )
  }
})

test("clear y reprocess eliminan correcciones derivadas de Luna pero conservan correcciones humanas independientes", async () => {
  const independentEvidence = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
      .document.evidence.find((entry) => entry.id === "san-ebay-title"),
  )
  const independentCapture = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
      .document.captures.find((capture) =>
        capture.sourceType === "HUMAN_CORRECTION"
      ),
  )
  assert.ok(independentEvidence)
  assert.ok(independentCapture)

  const withCorrections = () => {
    const document = structuredClone(
      GOLF_SWING_TRAINER_PRODUCT_CASE_FIXTURE.document,
    )
    const lunaCandidate = document.supplierSourceCapture
      ?.evidenceCandidates.find((entry) =>
        entry.id === "golf-evidence-05-visible_stock"
      )
    assert.ok(lunaCandidate)
    document.evidence = applyProductCaseEvidenceReview(
      document.evidence,
      {
        evidenceId: lunaCandidate.id,
        action: "CORRECT",
        reason: "Corrección humana derivada de esta captura Luna.",
        correctedValue: 644,
      },
    )
    document.evidence.push(structuredClone(independentEvidence))
    document.captures.push(structuredClone(independentCapture))
    return {
      document,
      derivedId: lunaCandidate.id,
      independentId: independentEvidence.id,
    }
  }

  const clearedInput = withCorrections()
  const cleared = transitionProductCaseSupplierCapture({
    document: clearedInput.document,
    replacement: null,
  })
  assert.equal(
    cleared.evidence.some((entry) => entry.id === clearedInput.derivedId),
    false,
  )
  assert.equal(
    cleared.evidence.some((entry) =>
      entry.id === clearedInput.independentId &&
      entry.sourceType === "HUMAN_CORRECTION"
    ),
    true,
  )

  const replacementText =
    GOLF_SWING_TRAINER_AUTHENTICATED_SNAPSHOT.replaceAll(
      "BLACK",
      "AZURE",
    )
  const extraction = await extractProductCaseEvidence({
    sourceUrl: PILOT_URL,
    capturedAt: "2026-07-29T12:00:00.000Z",
    content: replacementText,
    format: "JSON",
    sourceType: "LUNA_AUTHENTICATED_MANUAL_CAPTURE",
  })
  const supplierSourceCapture =
    await createManualAuthenticatedSupplierSourceCapture({
      supplierUrl: PILOT_URL,
      rawVisibleSourceText: replacementText,
      sourceAccessStatus: "AUTHENTICATED_SOURCE_REQUIRED",
      extraction,
      humanVisibleProductTextConfirmed: true,
    })
  const reprocessedInput = withCorrections()
  const reprocessed = transitionProductCaseSupplierCapture({
    document: reprocessedInput.document,
    replacement: { supplierSourceCapture, extraction },
  })
  assert.equal(
    reprocessed.evidence.some((entry) =>
      entry.id === reprocessedInput.derivedId &&
      entry.sourceType === "HUMAN_CORRECTION"
    ),
    false,
  )
  assert.equal(
    reprocessed.evidence.some((entry) =>
      entry.id === reprocessedInput.independentId &&
      entry.sourceType === "HUMAN_CORRECTION"
    ),
    true,
  )
  assert.equal(reprocessed.identityReview.humanReview, null)
  assert.equal(reprocessed.identityReview.status, "NOT_REVIEWED")
})

test("rawHumanInput físico e IDs deben coincidir con el registro estructurado", async () => {
  const document = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
      .document,
  )
  const base = partialHumanIdentityReviewInput(document)
  await assert.rejects(
    saveHumanIdentityReviewRecord({
      ...base,
      rawHumanInput: {
        ...base.rawHumanInput,
        evidenceIds: base.rawHumanInput.evidenceIds.slice(1),
      },
    }),
    /HUMAN_IDENTITY_REVIEW_INTEGRITY_MISMATCH:RAW_INPUT/,
  )
  await assert.rejects(
    saveHumanIdentityReviewRecord({
      ...base,
      rawHumanInput: {
        ...base.rawHumanInput,
        physicalProductVerified: true,
      },
    }),
    /HUMAN_IDENTITY_REVIEW_PHYSICAL_VERIFICATION_UNSUPPORTED/,
  )
  await assert.rejects(
    saveHumanIdentityReviewRecord({
      ...base,
      rawHumanInput: {
        ...base.rawHumanInput,
        physicalVerificationEvidenceIds: ["san-title"],
      },
    }),
    /HUMAN_IDENTITY_REVIEW_INTEGRITY_MISMATCH:RAW_INPUT/,
  )
})

test("editar sin cambios conserva rawHumanInput y orden humano de evidenceIds", async () => {
  const document = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState
      .document,
  )
  const canonical = canonicalHumanIdentityReviewInput(document)
  const rawEvidenceOrder = [...canonical.evidenceIds].reverse()
  const rawPhysicalOrder =
    [...canonical.physicalVerificationEvidenceIds].reverse()
  const saved = await saveHumanIdentityReviewRecord({
    ...canonical,
    evidenceIds: rawEvidenceOrder,
    physicalVerificationEvidenceIds: rawPhysicalOrder,
    rawHumanInput: {
      ...canonical.rawHumanInput,
      evidenceIds: rawEvidenceOrder,
      physicalVerificationEvidenceIds: rawPhysicalOrder,
    },
  })
  assert.deepEqual(
    saved.review.evidenceIds,
    [...rawEvidenceOrder].sort(),
  )
  assert.deepEqual(
    saved.review.rawHumanInput.evidenceIds,
    rawEvidenceOrder,
  )
  assert.deepEqual(
    saved.review.physicalVerificationEvidenceIds,
    [...rawPhysicalOrder].sort(),
  )
  assert.deepEqual(
    saved.review.rawHumanInput.physicalVerificationEvidenceIds,
    rawPhysicalOrder,
  )

  const page = read("app/admin/ebay/product-case-runner/page.tsx")
  assert.match(
    page,
    /type HumanIdentityReviewDraft\s*=\s*\{[\s\S]*physicalVerificationEvidenceIds:\s*string\[\]/,
  )
  const draftStart = page.indexOf(
    "function humanIdentityReviewDraftFrom(",
  )
  const draftEnd = page.indexOf("function mergeEvidence(", draftStart)
  assert.ok(draftStart >= 0 && draftEnd > draftStart)
  const draftFlow = page.slice(draftStart, draftEnd)
  assert.match(
    draftFlow,
    /rawEvidenceIds\s*=\s*Array\.isArray\(rawHumanInput\.evidenceIds\)[\s\S]*rawHumanInput\.evidenceIds\.map\(String\)[\s\S]*:\s*strings\(review\.evidenceIds\)/,
  )
  assert.match(
    draftFlow,
    /rawPhysicalEvidenceIds\s*=\s*Array\.isArray\([\s\S]*rawHumanInput\.physicalVerificationEvidenceIds[\s\S]*rawHumanInput\.physicalVerificationEvidenceIds\.map\(String\)[\s\S]*:\s*strings\(review\.physicalVerificationEvidenceIds\)/,
  )
  assert.match(draftFlow, /evidenceIds:\s*rawEvidenceIds/)
  assert.match(
    draftFlow,
    /physicalVerificationEvidenceIds:\s*rawPhysicalEvidenceIds/,
  )
  assert.match(
    draftFlow,
    /function humanIdentityRawInputForSave\([\s\S]*JSON\.stringify\(draft\)\s*===\s*JSON\.stringify\(baseline\)[\s\S]*return structuredClone\(original\)/,
  )
  const saveStart = page.indexOf(
    "async function saveHumanIdentityReview()",
  )
  const editStart = page.indexOf(
    "function editHumanIdentityReview()",
    saveStart,
  )
  assert.ok(saveStart >= 0 && editStart > saveStart)
  const saveFlow = page.slice(saveStart, editStart)
  assert.match(
    saveFlow,
    /humanIdentityRawInputForSave\(\s*draft,\s*humanIdentityReviewDraftBaseline,\s*humanIdentityRawInputSnapshot,\s*\)/,
  )
  assert.match(
    saveFlow,
    /physicalVerificationEvidenceIds:\s*\[\.\.\.draft\.physicalVerificationEvidenceIds\]/,
  )
})

test("errores locales de identidad son visibles y reciben foco", () => {
  const page = read("app/admin/ebay/product-case-runner/page.tsx")
  const helperStart = page.indexOf(
    "function showHumanIdentityReviewError(",
  )
  const saveStart = page.indexOf(
    "async function saveHumanIdentityReview()",
    helperStart,
  )
  const editStart = page.indexOf(
    "function editHumanIdentityReview()",
    saveStart,
  )
  assert.ok(helperStart >= 0 && saveStart > helperStart)
  assert.ok(editStart > saveStart)
  const errorHelper = page.slice(helperStart, saveStart)
  const saveFlow = page.slice(saveStart, editStart)
  assert.match(errorHelper, /setHumanIdentityReviewError\(message\)/)
  assert.match(errorHelper, /window\.requestAnimationFrame/)
  assert.match(
    errorHelper,
    /humanIdentityReviewErrorRef\.current\?\.focus\(\)/,
  )
  assert.match(
    saveFlow,
    /catch \(caught\)[\s\S]*showHumanIdentityReviewError\(/,
  )
  assert.match(
    page,
    /ref=\{humanIdentityReviewErrorRef\}[\s\S]{0,240}role="alert"[\s\S]{0,120}tabIndex=\{-1\}/,
  )
})

test("banner de fase 4 muestra valores efectivos y no estados fijos", () => {
  const page = read("app/admin/ebay/product-case-runner/page.tsx")
  const phaseStart = page.indexOf('id="phase-4-identity-and-variants"')
  const phaseBodyStart = page.indexOf("<div", phaseStart)
  assert.ok(phaseStart >= 0 && phaseBodyStart > phaseStart)
  const banner = page.slice(phaseStart, phaseBodyStart)
  assert.match(
    banner,
    /physicalProductVerified:[\s\S]*String\(Boolean\(identityReview\.physicalProductVerified\)\)/,
  )
  assert.match(
    banner,
    /manualHandoffAllowed efectivo:[\s\S]*String\(manualHandoffAllowed\)/,
  )
  assert.doesNotMatch(banner, /manualHandoffAllowed:false/)
  assert.doesNotMatch(banner, /physicalProductVerified:false/)
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
  const authenticatedTextarea = page.match(
    /<textarea[\s\S]{0,900}id="authenticated-visible-source-text"[\s\S]{0,900}\/>/,
  )?.[0] ?? ""

  assert.match(page, /GENERAR PAQUETE PARA PUBLICACIÓN MANUAL/)
  assert.match(page, /PEGAR CONTENIDO VISIBLE AUTENTICADO DE LUNA/)
  assert.match(page, /PROCESAR EVIDENCIA DEL PROVEEDOR/)
  assert.match(page, /LIMPIAR CONTENIDO/)
  assert.match(page, /value=\{manualContent\}/)
  assert.ok(authenticatedTextarea)
  assert.doesNotMatch(authenticatedTextarea, /\bdisabled=/)
  assert.match(
    page,
    /setManualContent\(event\.target\.value\)[\s\S]{0,120}setHumanVisibleProductTextConfirmed\(false\)/,
  )
  assert.match(page, /data-testid="confirm-visible-product-text"/)
  assert.match(page, /humanVisibleProductTextConfirmed/)
  assert.match(domain, /NO_SENSITIVE_PATTERN_DETECTED/)
  assert.match(page, /sensitiveContentAssessment/)
  assert.match(page, /HUMAN_CONFIRMED/)
  assert.match(page, /onClick=\{\(\) => void analyzeManualContent\(\)\}/)
  assert.match(page, /DECISIÓN APLICADA:/)
  assert.match(page, /data-testid="luna-source-contract-guard"/)
  assert.match(page, /Parse health/)
  assert.match(page, /Stock state/)
  assert.match(
    page,
    /El formato de Luna pudo cambiar\. Revisión humana obligatoria\./,
  )
  assert.match(page, /Título original del proveedor/)
  assert.match(page, /EBAY_OPTIMIZED_TITLE_DRAFT/)
  assert.match(
    page,
    /sourceType:\s*sourceAccess\.status\s*===\s*"AUTHENTICATED_SOURCE_REQUIRED"/,
  )
  assert.match(
    page,
    /sourceAccess\.status\s*===\s*"AUTHENTICATED_SOURCE_REQUIRED"\s*\?\s*await createManualAuthenticatedSupplierSourceCapture/,
  )
  assert.match(page, /AGREGAR REVISIÓN HUMANA/)
  assert.equal(
    (page.match(/data-testid="add-human-visual-review"/g) ?? []).length,
    1,
  )
  assert.match(page, /HUMAN_VISUAL_REVIEW_CONTRACT_VERSION/)
  assert.match(page, /phase3-visual-image-id/)
  assert.match(page, /phase3-visual-source-reference/)
  assert.match(page, /phase3-visual-source-url/)
  for (const field of [
    "observedProductType",
    "visibleFeatures",
    "visibleText",
    "visibleBrands",
    "visibleColors",
    "visibleQuantity",
    "observedVariant",
    "possibleConflicts",
  ]) {
    assert.match(page, new RegExp(`\\b${field}\\b`), field)
  }
  assert.match(page, /\bEDITAR\b/)
  assert.match(page, /\bELIMINAR\b/)
  assert.match(page, /editVisualObservation/)
  assert.match(page, /deleteVisualObservation/)
  assert.match(
    page,
    /replaceEvidenceId:\s*editingVisualObservationEvidenceId/,
  )
  assert.equal(
    (page.match(/setGeneratedPackage\(null\)/g) ?? []).length >= 2,
    true,
  )
  assert.match(page, /GUARDAR CAMBIOS DE REVISIÓN/)
  assert.match(page, /human-visual-review-card-/)
  assert.match(page, /Texto humano original preservado/)
  assert.match(page, /LEGACY_UNVERSIONED · CORRECCIÓN HUMANA REQUERIDA/)
  assert.match(
    page,
    /text\(record\(entry\)\.field,\s*""\)\s*!==\s*"visual_observation"/,
  )
  assert.doesNotMatch(
    page,
    /humanReason:\s*event\.target\.value,\s*visible(?:Text|Features):/,
  )
  assert.doesNotMatch(
    page,
    /Revisiones visuales humanas registradas/,
  )
  assert.match(
    page,
    /function splitLines\(value: string\)\s*\{\s*return \[\.\.\.new Set\(value\.split\(\/\\r\?\\n\/\)/,
  )
  assert.doesNotMatch(page, /value\.split\(\/\\r\?\\n\|,\//)
  assert.match(
    page,
    /physicalProductVerified:\s*false/,
  )
  assert.match(page, /ACCEPT_FOR_ANALYSIS/)
  assert.match(page, /HUMAN_VISUAL_REVIEW/)
  assert.match(
    page,
    /useEffect\(\(\) => \{\s*setItemSpecificsJson\(JSON\.stringify\(value\.itemSpecifics,\s*null,\s*2\)\)/,
  )
  assert.match(
    page,
    /useEffect\(\(\) => \{\s*setEvidenceLinksJson\(JSON\.stringify\(value\.evidenceLinks,\s*null,\s*2\)\)/,
  )
  assert.doesNotMatch(page, /type=["']password["']/i)
  assert.doesNotMatch(page, /name=["'](?:cookie|token|password)["']/i)
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
  assert.doesNotMatch(domain, /electric razor/i)
})
