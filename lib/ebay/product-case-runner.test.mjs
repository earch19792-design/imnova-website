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
  createManualAuthenticatedSupplierSourceCapture,
  createProductCaseWorkspaceExport,
  deleteHumanVisualReviewRecord,
  extractProductCaseEvidence,
  hashProductCaseContent,
  humanVisualReviewContractIssues,
  HUMAN_VISUAL_REVIEW_CONTRACT_VERSION,
  importProductCaseWorkspaceExport,
  LUNA_SOURCE_CONTRACT_VERSION,
  PRODUCT_CASE_CONTENT_MAX_BYTES,
  PRODUCT_CASE_OPERATIONAL_PHASES,
  PRODUCT_CASE_PARSER_VERSION,
  PRODUCT_CASE_WORKSPACE_EXPORT_MAX_BYTES,
  reevaluateProductCaseEvidence,
  resolveLunaSourceContractGuard,
  serializeProductCaseWorkspaceExport,
  transitionProductCaseSupplierCapture,
  validateLunaProductUrl,
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
  const workspaceState = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
  )
  const legacyObservation = workspaceState.imageObservations[0]
  delete legacyObservation.contractVersion
  delete legacyObservation.rawHumanInput
  delete workspaceState.document.imageAnalysis.observations[0].contractVersion
  delete workspaceState.document.imageAnalysis.observations[0].rawHumanInput
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
  const workspaceState = structuredClone(
    SANITIZED_DETERMINISTIC_COMPLETE_PRODUCT_CASE_FIXTURE.workspaceState,
  )
  delete workspaceState.imageObservations[0].contractVersion
  delete workspaceState.imageObservations[0].rawHumanInput
  delete workspaceState.document.imageAnalysis.observations[0].contractVersion
  delete workspaceState.document.imageAnalysis.observations[0].rawHumanInput
  const serialized = serializeProductCaseWorkspaceExport({
    workspaceState,
    exportedAt: CAPTURED_AT,
  })
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
  assert.equal(imported.visualReviewCorrectionRequired, true)
  assert.match(
    imported.visualReviewContractIssues.join("\n"),
    /HUMAN_VISUAL_REVIEW_HUMAN_CORRECTION_REQUIRED:sanitized-main/,
  )
  assert.equal(imported.rebuiltOutput.manualHandoffAllowed, false)
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
