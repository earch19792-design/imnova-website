import assert from "node:assert/strict"
import test from "node:test"

import {
  assertCommercialMonitorAssistantDtoSafe,
  containsSensitiveAssistantMaterial,
  createAlertCandidate,
  createCalculatedNumericObservation,
  createDiscoveryCoverage,
  createObservation,
  projectObservationToGrain,
  resolveExperiment,
  resolveProductCaseLink,
  resolveStockEvidence,
  unavailableObservation,
} from "./commercial-monitor-readonly-contract.ts"
import {
  classifyStoredAnalyticsEvidence,
  classifyTargetedLunaSnapshotContract,
  isAuthoritativeReadonlyOrderSource,
  oldestRequiredEvidenceTimestamp,
} from "./commercial-monitor-readonly-utilities.mjs"

const marketplace = {
  marketplaceId: "EBAY_US",
  accountAlias: "official-seller",
}
const identity = {
  itemId: "123456789012",
  variationKey: null,
  sku: "SKU-EXACT",
}
const source = {
  system: "AUTHORITATIVE_TEST_SOURCE",
  operation: "EXPLICIT_VALUE",
  evidenceReference: "TEST:EVIDENCE:1",
}
const freshness = {
  status: "FRESH",
  ageSeconds: 60,
  maximumAgeSeconds: 3_600,
}

function availableNumber(value, overrides = {}) {
  return createObservation({
    value,
    availability: "AVAILABLE",
    completeness: "COMPLETE",
    source,
    capturedAt: "2026-08-08T12:00:00.000Z",
    marketplace,
    identity,
    grain: "ITEM",
    reportingWindow: null,
    freshness,
    limitationCode: null,
    explicitAuthoritativeZero: value === 0,
    ...overrides,
  })
}

test("cero autoritativo permanece cero y missing permanece null", () => {
  const zero = availableNumber(0)
  const missing = unavailableObservation({
    availability: "MISSING",
    source,
    marketplace,
    identity,
    grain: "ITEM",
    limitationCode: "VALUE_MISSING",
  })
  assert.equal(zero.value, 0)
  assert.equal(zero.explicitAuthoritativeZero, true)
  assert.equal(missing.value, null)
  assert.equal(missing.availability, "MISSING")
  assert.throws(() => createObservation({
    ...zero,
    availability: "UNKNOWN",
  }), /COMMERCIAL_MONITOR_UNAVAILABLE_VALUE_FORBIDDEN/)
  assert.throws(() => createObservation({
    ...zero,
    explicitAuthoritativeZero: false,
  }), /COMMERCIAL_MONITOR_ZERO_AUTHORITY_REQUIRED/)
  assert.throws(() => createObservation({
    ...missing,
    completeness: "COMPLETE",
  }), /COMMERCIAL_MONITOR_UNPROVEN_COMPLETENESS_REQUIRED/)
  assert.throws(() => createObservation({
    ...zero,
    value: Number.POSITIVE_INFINITY,
    explicitAuthoritativeZero: false,
  }), /COMMERCIAL_MONITOR_FINITE_NUMBER_REQUIRED/)
})

test("UNAVAILABLE UNKNOWN ERROR y PARTIAL conservan semántica distinta", () => {
  const states = ["UNAVAILABLE", "UNKNOWN", "ERROR"].map((availability) =>
    unavailableObservation({
      availability,
      source,
      marketplace,
      identity,
      grain: "ITEM",
      limitationCode: `${availability}_REASON`,
    }))
  const partial = createObservation({
    value: 7,
    availability: "PARTIAL",
    completeness: "PARTIAL",
    source,
    capturedAt: "2026-08-08T12:00:00.000Z",
    marketplace,
    identity,
    grain: "ITEM",
    reportingWindow: null,
    freshness,
    limitationCode: "PARTIAL_WINDOW",
  })
  assert.deepEqual(states.map((entry) => entry.availability), [
    "UNAVAILABLE",
    "UNKNOWN",
    "ERROR",
  ])
  assert.equal(partial.value, 7)
  assert.equal(partial.completeness, "PARTIAL")
  assert.throws(() => createObservation({
    ...partial,
    completeness: "COMPLETE",
  }), /COMMERCIAL_MONITOR_PARTIAL_COMPLETENESS_REQUIRED/)
})

test("un valor ITEM no se promueve a VARIATION", () => {
  const projected = projectObservationToGrain(availableNumber(42), "VARIATION")
  assert.equal(projected.issueCode, "METRIC_GRAIN_MISMATCH")
  assert.equal(projected.observation.value, null)
  assert.equal(projected.observation.availability, "INSUFFICIENT_EVIDENCE")
  assert.equal(projected.observation.grain, "VARIATION")
})

test("snapshots Analytics requieren provenance, ventana y timestamp válidos", () => {
  const base = {
    sourceAnalytics: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
    completenessStatus: "complete",
    observedAt: "2026-08-08T12:00:00.000Z",
    windowStart: "2026-08-01T00:00:00.000Z",
    windowEnd: "2026-08-07T23:59:59.000Z",
    now: new Date("2026-08-08T12:01:00.000Z"),
    maximumAgeSeconds: 48 * 60 * 60,
    syntheticFallbackUsed: false,
    fixtureEvidenceUsed: false,
  }
  const valid = classifyStoredAnalyticsEvidence(base)
  assert.equal(valid.usable, true)
  assert.equal(valid.availability, "AVAILABLE")
  assert.equal(valid.completeness, "COMPLETE")

  for (const candidate of [
    { ...base, sourceAnalytics: "IMPORTED_UNKNOWN" },
    { ...base, windowStart: null },
    { ...base, observedAt: "2026-08-09T12:00:00.000Z" },
    { ...base, windowEnd: "2026-08-09T00:00:00.000Z" },
    { ...base, syntheticFallbackUsed: true },
    { ...base, fixtureEvidenceUsed: true },
  ]) {
    assert.equal(classifyStoredAnalyticsEvidence(candidate).usable, false)
  }
})

test("heartbeat Luna completo y no supersedido es obligatorio para stock actual", () => {
  const base = {
    sourceStatus: "AVAILABLE",
    syncStatus: "AVAILABLE",
    sourceActive: true,
    targetedSuccessAt: "2026-08-08T12:00:00.000Z",
    targetedErrorAt: null,
    targetedRunId: "123e4567-e89b-42d3-a456-426614174000",
    listingStatus: "active",
    listingUpdatedAt: "2026-08-08T11:45:00.000Z",
    snapshotCapturedAt: "2026-08-08T11:55:00.000Z",
    identityExact: true,
    now: new Date("2026-08-08T12:01:00.000Z"),
    maximumAgeSeconds: 36 * 60 * 60,
  }
  const complete = classifyTargetedLunaSnapshotContract(base)
  assert.equal(complete.status, "VALID")
  assert.match(complete.reference, /EBAY_TARGETED_LUNA_MONITOR_RUN/)

  for (const candidate of [
    { ...base, targetedSuccessAt: "2026-08-09T12:00:00.000Z" },
    { ...base, targetedErrorAt: "2026-08-08T12:00:30.000Z" },
    { ...base, listingStatus: "paused" },
    {
      ...base,
      listingUpdatedAt: "2026-08-08T12:00:30.000Z",
    },
    { ...base, identityExact: false },
  ]) {
    assert.equal(
      classifyTargetedLunaSnapshotContract(candidate).status,
      "UNPROVEN",
    )
  }
})

test("agregados de órdenes validan fuente y exponen fórmula e inputs", () => {
  assert.equal(isAuthoritativeReadonlyOrderSource(
    "EBAY_SELL_FULFILLMENT_GET_ORDERS"), true)
  assert.equal(isAuthoritativeReadonlyOrderSource("LEGACY_IMPORT"), false)
  assert.equal(oldestRequiredEvidenceTimestamp(
    "2026-08-08T11:59:00.000Z",
    "2026-08-06T12:05:00.000Z",
  ), "2026-08-06T12:05:00.000Z")
  assert.equal(oldestRequiredEvidenceTimestamp(
    "2026-08-08T11:59:00.000Z",
    null,
  ), null)
  const reference = "MARKETPLACE_ORDER_LINE:order-safe-1:line-safe-1"
  const observation = createCalculatedNumericObservation(
    createObservation({
      value: 2,
      unit: "UNIT",
      availability: "PARTIAL",
      completeness: "PARTIAL",
      source: { ...source, evidenceReference: reference },
      capturedAt: "2026-08-08T11:30:00.000Z",
      marketplace,
      identity,
      grain: "VARIATION",
      reportingWindow: {
        start: "2026-08-08T10:00:00.000Z",
        end: "2026-08-08T11:30:00.000Z",
        timeZone: "UTC",
      },
      freshness,
      limitationCode: "OPEN_PAID_UNFULFILLED_ORDER_WINDOW_ONLY",
    }), {
      formula: "SUM(marketplace_order_line_items.quantity)",
      version: "OPEN_PAID_UNFULFILLED_ORDER_WINDOW_V1",
      inputEvidenceReferences: [reference],
      inputs: [{
        name: "order_line_quantity_1",
        value: 2,
        unit: "UNIT",
        source: { ...source, evidenceReference: reference },
        capturedAt: "2026-08-08T11:30:00.000Z",
      }],
    },
  )
  assert.equal(observation.value, 2)
  assert.equal(observation.calculation.inputs[0].value, 2)
  assert.throws(() => createCalculatedNumericObservation(observation, {
    ...observation.calculation,
    inputEvidenceReferences: [],
  }), /COMMERCIAL_MONITOR_CALCULATION_INPUTS_REQUIRED/)
})

test("Product Case soporta AVAILABLE MISSING y UNPROVEN sin placeholder", () => {
  const unproven = resolveProductCaseLink()
  const missing = resolveProductCaseLink({
    completed: true,
    found: false,
    checkedAt: "2026-08-08T12:00:00.000Z",
    evidence: {
      reference: "PRODUCT_CASE_LOOKUP:1",
      source: "PERSISTENT_PRODUCT_CASE",
      capturedAt: "2026-08-08T12:00:00.000Z",
    },
  })
  const available = resolveProductCaseLink({
    completed: true,
    found: true,
    productCaseId: "pc-safe-1",
    versionId: "pcv-safe-2",
    versionStatus: "APPROVED",
    checkedAt: "2026-08-08T12:00:00.000Z",
    evidence: {
      reference: "PRODUCT_CASE_LOOKUP:2",
      source: "PERSISTENT_PRODUCT_CASE",
      capturedAt: "2026-08-08T12:00:00.000Z",
    },
  })
  assert.equal(unproven.status, "UNPROVEN")
  assert.equal(unproven.blocker, "PRODUCT_CASE_LINK_UNPROVEN")
  assert.equal("productCaseId" in unproven, false)
  assert.equal(missing.status, "MISSING")
  assert.equal(missing.blocker, "PRODUCT_CASE_LINK_MISSING")
  assert.equal("productCaseId" in missing, false)
  assert.equal(available.status, "AVAILABLE")
  assert.equal(available.productCaseId, "pc-safe-1")
})

test("cobertura manual parcial conserva gaps y nunca afirma COMPLETE", () => {
  const coverage = createDiscoveryCoverage({
    universalCoverageProven: false,
    sourceCoverageAvailable: true,
    sources: ["EBAY_SELL_INVENTORY_READONLY"],
    observedAt: "2026-08-08T12:00:00.000Z",
    knownGapCodes: [
      "MANUAL_LISTINGS_REQUIRE_KNOWN_ITEM_ID",
      "UNIVERSAL_ACCOUNT_LISTING_DISCOVERY_UNPROVEN",
    ],
  })
  assert.equal(coverage.status, "PARTIAL")
  assert.deepEqual(coverage.knownGapCodes, [
    "MANUAL_LISTINGS_REQUIRE_KNOWN_ITEM_ID",
    "UNIVERSAL_ACCOUNT_LISTING_DISCOVERY_UNPROVEN",
  ])
  const unproven = createDiscoveryCoverage({
    universalCoverageProven: false,
    sourceCoverageAvailable: false,
    sources: [],
    observedAt: null,
    knownGapCodes: ["REGISTRY_SOURCE_UNAVAILABLE"],
  })
  assert.equal(unproven.status, "UNPROVEN")
})

test("experimento RUNNING autoritativo produce NO_TOCAR y preserva frozen variables", () => {
  const experiment = resolveExperiment({
    completed: true,
    found: true,
    experimentId: "experiment-safe-1",
    lifecycleState: "RUNNING",
    testedVariable: "TITLE",
    t0: "2026-08-01T00:00:00.000Z",
    postChangeT0: "2026-08-02T00:00:00.000Z",
    frozenVariables: ["PRICE", "IMAGES", "PROMOTION"],
    checkpointGate: "DAY_7",
    evidenceTimestamp: "2026-08-08T12:00:00.000Z",
    dataQualityStatus: "AVAILABLE",
    evidence: {
      reference: "EXPERIMENT:experiment-safe-1",
      source: "EXPERIMENT_REGISTRY",
      capturedAt: "2026-08-08T12:00:00.000Z",
    },
  })
  assert.equal(experiment.status, "AVAILABLE")
  assert.equal(experiment.commercialAction, "NO_TOCAR")
  assert.deepEqual(experiment.frozenVariables, ["PRICE", "IMAGES", "PROMOTION"])
})

test("stock sin identidad, parser roto o evidencia stale nunca se vuelve OOS", () => {
  const baseSupply = {
    productId: "product-1",
    supplierVariantId: "variant-1",
    sku: "SUPPLIER-1",
    sourceKey: "lunaportex",
    snapshotId: "snapshot-1",
    available: false,
    inventoryQuantity: 0,
    price: 4.25,
    capturedAt: "2026-08-08T11:59:00.000Z",
    parserHealth: "VALID",
    sourceContractReference: "TARGETED_LUNA_RUN:run-complete-1",
    sourceContractCapturedAt: "2026-08-08T12:00:00.000Z",
  }
  const unknown = resolveStockEvidence({
    productId: null,
    supplierVariantId: null,
    supplierSku: null,
    supplies: [baseSupply],
    marketplace,
    identity,
    now: new Date("2026-08-08T12:00:00.000Z"),
  })
  const parserError = resolveStockEvidence({
    productId: "product-1",
    supplierVariantId: "variant-1",
    supplierSku: "SUPPLIER-1",
    supplies: [{ ...baseSupply, parserHealth: "PARSER_ERROR" }],
    marketplace,
    identity,
    now: new Date("2026-08-08T12:00:00.000Z"),
  })
  const stale = resolveStockEvidence({
    productId: "product-1",
    supplierVariantId: "variant-1",
    supplierSku: "SUPPLIER-1",
    supplies: [{ ...baseSupply, capturedAt: "2026-08-01T00:00:00.000Z" }],
    marketplace,
    identity,
    now: new Date("2026-08-08T12:00:00.000Z"),
    maximumAgeSeconds: 3_600,
  })
  assert.equal(unknown.state, "STOCK_UNKNOWN")
  assert.equal(parserError.state, "SOURCE_FORMAT_CHANGED")
  assert.equal(stale.state, "STALE")
  for (const result of [unknown, parserError, stale]) {
    assert.equal(result.quantity.value, null)
    assert.notEqual(result.state, "OUT_OF_STOCK_SIGNAL")
  }
})

test("sólo available=false exacto y fresco produce OOS y cero autoritativo", () => {
  const result = resolveStockEvidence({
    productId: "product-1",
    supplierVariantId: "variant-1",
    supplierSku: "SUPPLIER-1",
    supplies: [{
      productId: "product-1",
      supplierVariantId: "variant-1",
      sku: "SUPPLIER-1",
      sourceKey: "lunaportex",
      snapshotId: "snapshot-1",
      available: false,
      inventoryQuantity: 0,
      price: 4.25,
      capturedAt: "2026-08-08T11:59:00.000Z",
      parserHealth: "VALID",
      sourceContractReference: "TARGETED_LUNA_RUN:run-complete-1",
      sourceContractCapturedAt: "2026-08-08T12:00:00.000Z",
    }],
    marketplace,
    identity,
    now: new Date("2026-08-08T12:00:00.000Z"),
  })
  assert.equal(result.state, "OUT_OF_STOCK_SIGNAL")
  assert.equal(result.quantity.value, 0)
  assert.equal(result.quantity.explicitAuthoritativeZero, true)
  assert.equal(result.currentSupplierCost.value, 4.25)
  assert.equal(result.currentSupplierCost.availability, "PARTIAL")
  assert.equal(result.currentSupplierCost.completeness, "PARTIAL")
  assert.equal(result.currentSupplierCost.unit, null)
  assert.equal(
    result.currentSupplierCost.limitationCode,
    "SUPPLIER_COST_CURRENCY_UNPROVEN",
  )
})

test("available=true sin cantidad conserva señal in-stock pero cantidad UNKNOWN", () => {
  const result = resolveStockEvidence({
    productId: "product-1",
    supplierVariantId: "variant-1",
    supplierSku: "SUPPLIER-1",
    supplies: [{
      productId: "product-1",
      supplierVariantId: "variant-1",
      sku: "SUPPLIER-1",
      sourceKey: "lunaportex",
      snapshotId: "snapshot-2",
      available: true,
      inventoryQuantity: null,
      price: 4.25,
      capturedAt: "2026-08-08T11:59:00.000Z",
      parserHealth: "VALID",
      sourceContractReference: "TARGETED_LUNA_RUN:run-complete-2",
      sourceContractCapturedAt: "2026-08-08T12:00:00.000Z",
    }],
    marketplace,
    identity,
    now: new Date("2026-08-08T12:00:00.000Z"),
  })
  assert.equal(result.state, "IN_STOCK_SIGNAL")
  assert.equal(result.quantity.availability, "UNKNOWN")
  assert.equal(result.quantity.value, null)
})

test("OOS booleano sin cantidad no fabrica cero numérico", () => {
  const result = resolveStockEvidence({
    productId: "product-1",
    supplierVariantId: "variant-1",
    supplierSku: "SUPPLIER-1",
    supplies: [{
      productId: "product-1",
      supplierVariantId: "variant-1",
      sku: "SUPPLIER-1",
      sourceKey: "lunaportex",
      snapshotId: "snapshot-oos-without-quantity",
      available: false,
      inventoryQuantity: null,
      price: 4.25,
      capturedAt: "2026-08-08T11:59:00.000Z",
      parserHealth: "VALID",
      sourceContractReference: "TARGETED_LUNA_RUN:run-complete-3",
      sourceContractCapturedAt: "2026-08-08T12:00:00.000Z",
    }],
    marketplace,
    identity,
    now: new Date("2026-08-08T12:00:00.000Z"),
  })
  assert.equal(result.state, "OUT_OF_STOCK_SIGNAL")
  assert.equal(result.quantity.value, null)
  assert.equal(result.quantity.availability, "UNKNOWN")
  assert.equal(
    result.quantity.limitationCode,
    "OUT_OF_STOCK_WITHOUT_NUMERIC_QUANTITY",
  )
})

test("timestamp, referencia y contrato no probados nunca confirman OOS", () => {
  const baseSupply = {
    productId: "product-1",
    supplierVariantId: "variant-1",
    sku: "SUPPLIER-1",
    sourceKey: "lunaportex",
    snapshotId: "snapshot-guarded",
    available: false,
    inventoryQuantity: 0,
    price: 4.25,
    capturedAt: "2026-08-08T11:59:00.000Z",
    parserHealth: "VALID",
    sourceContractReference: "TARGETED_LUNA_RUN:run-complete-4",
    sourceContractCapturedAt: "2026-08-08T12:00:00.000Z",
  }
  const variants = [
    { ...baseSupply, capturedAt: null },
    { ...baseSupply, capturedAt: "2026-08-09T12:00:00.000Z" },
    { ...baseSupply, snapshotId: null },
    { ...baseSupply, sourceContractReference: null },
    { ...baseSupply, sourceContractCapturedAt: "2026-08-09T12:00:00.000Z" },
    { ...baseSupply, sourceContractCapturedAt: "2026-08-08T11:58:00.000Z" },
    { ...baseSupply, parserHealth: "ERROR" },
    { ...baseSupply, parserHealth: "UNDOCUMENTED" },
  ]
  const results = variants.map((supply) => resolveStockEvidence({
    productId: "product-1",
    supplierVariantId: "variant-1",
    supplierSku: "SUPPLIER-1",
    supplies: [supply],
    marketplace,
    identity,
    now: new Date("2026-08-08T12:00:00.000Z"),
  }))
  assert.deepEqual(results.map((result) => result.state), [
    "STOCK_UNKNOWN",
    "STOCK_UNKNOWN",
    "STOCK_UNKNOWN",
    "STOCK_UNKNOWN",
    "STOCK_UNKNOWN",
    "STOCK_UNKNOWN",
    "SOURCE_FORMAT_CHANGED",
    "STOCK_UNKNOWN",
  ])
  for (const result of results) {
    assert.notEqual(result.state, "OUT_OF_STOCK_SIGNAL")
    assert.equal(result.quantity.value, null)
  }
})

test("alert candidates son determinísticos y nunca despachan", () => {
  const input = {
    accountScopeKey: `official:${"a".repeat(64)}`,
    marketplace,
    itemId: "123456789012",
    variationKey: null,
    sku: "SKU-EXACT",
    reasonCode: "DATA_COVERAGE_FAILURE",
    severity: "HIGH",
    supportingEvidence: [{
      reference: "REGISTRY:1",
      source: "EBAY_ACTIVE_LISTING_REGISTRY",
      capturedAt: "2026-08-08T12:00:00.000Z",
    }],
    freshness: {
      status: "UNKNOWN",
      capturedAt: "2026-08-08T12:00:00.000Z",
    },
    recommendedHumanDestination: "SELLER_OS_MONITOR",
  }
  const first = createAlertCandidate(input)
  const second = createAlertCandidate(input)
  assert.equal(first.eventKey, second.eventKey)
  assert.equal(first.candidateOnly, true)
  assert.equal(first.dispatchAllowed, false)
  assert.equal(first.whatsappCalled, false)
  assert.equal(first.deliveryAttempted, false)
  const accountCandidate = createAlertCandidate({
    ...input,
    itemId: null,
    sku: null,
    supportingEvidence: [{
      reference: "ACCOUNT_DISCOVERY_COVERAGE:UNPROVEN",
      source: "SELLER_OS_DISCOVERY_COVERAGE",
      capturedAt: null,
    }],
  })
  assert.equal(accountCandidate.listingReference.scope, "ACCOUNT")
  assert.equal(accountCandidate.listingReference.itemId, null)
  assert.throws(() => createAlertCandidate({
    ...input,
    supportingEvidence: [],
  }), /COMMERCIAL_MONITOR_ALERT_EVIDENCE_REQUIRED/)
})

function safeDto() {
  return {
    contractVersion: "COMMERCIAL_MONITOR_READONLY_FOUNDATION_V1",
    operation: "commercial_monitor.get",
    mode: "READ_ONLY",
    generatedAt: "2026-08-08T12:00:00.000Z",
    marketplace,
    connection: { status: "PARTIAL", readers: [] },
    discoveryCoverage: {
      status: "UNPROVEN",
      sources: [],
      observedAt: null,
      knownGapCodes: ["UNIVERSAL_DISCOVERY_UNPROVEN"],
    },
    listings: [],
    alertCandidates: [],
    accountDataQualityIssues: [],
    learning: {
      status: "UNAVAILABLE",
      source: "EBAY_CATEGORY_LEARNING",
      evidenceTimestamp: null,
      modelVersions: [],
      categoryAdjustments: [],
      limitationCode: "NO_STORED_CATEGORY_LEARNING",
    },
    timeline: [],
    productCaseOperatingState: {
      status: "PAUSED_FOR_MONITORING_MILESTONE",
      reset: false,
      resumePolicy: "RESUME_FROM_LAST_VERIFIED_GATE",
      manualGoldenPath: "PRESERVE",
    },
    capabilities: {
      canPublishAutomatically: false,
      canReviseInventoryAutomatically: false,
      canPauseListingAutomatically: false,
      canReactivateListingAutomatically: false,
      ebayBuyerMessageAutoSend: false,
      ebayTrackingWriteEnabled: false,
      whatsappSaleAlertEnabled: false,
      postSaleShadowMode: true,
    },
    safety: {
      marketplaceWritesAllowed: false,
      dispatchAllowed: false,
      whatsappCalled: false,
      buyerMessagesAllowed: false,
      sanitized: true,
      containsSecrets: false,
      containsTokens: false,
      containsAuthorizationHeaders: false,
      containsCookies: false,
      buyerPiiIncluded: false,
    },
  }
}

test("Assistant DTO acepta contrato sanitizado y bloquea material sensible o PII", () => {
  const dto = safeDto()
  assert.equal(assertCommercialMonitorAssistantDtoSafe(dto), dto)
  assert.equal(containsSensitiveAssistantMaterial(dto), false)
  assert.equal(containsSensitiveAssistantMaterial({
    refresh_token: "forbidden-value",
  }), true)
  assert.equal(containsSensitiveAssistantMaterial({ apiKey: "opaque" }), true)
  assert.equal(containsSensitiveAssistantMaterial({ token: "opaque" }), true)
  for (const unsafeDeclaration of [
    { containsSecrets: true },
    { containsTokens: true },
    { containsAuthorizationHeaders: true },
    { containsCookies: true },
    { buyerPiiIncluded: true },
    { sanitized: false },
  ]) {
    assert.equal(containsSensitiveAssistantMaterial(unsafeDeclaration), true)
    assert.throws(() => assertCommercialMonitorAssistantDtoSafe({
      ...dto,
      safety: { ...dto.safety, ...unsafeDeclaration },
    }), /COMMERCIAL_MONITOR_ASSISTANT_DTO_SANITIZATION_FAILED/)
  }
  assert.equal(containsSensitiveAssistantMaterial(
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signature",
  ), true)
  assert.throws(() => assertCommercialMonitorAssistantDtoSafe({
    ...dto,
    leaked: { authorization: "Bearer forbidden-value" },
  }), /COMMERCIAL_MONITOR_ASSISTANT_DTO_SANITIZATION_FAILED/)
  assert.throws(() => assertCommercialMonitorAssistantDtoSafe({
    ...dto,
    leaked: { buyer: { email: "private@example.invalid" } },
  }), /COMMERCIAL_MONITOR_ASSISTANT_DTO_SANITIZATION_FAILED/)
})
