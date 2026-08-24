import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value.startsWith(".") &&
        !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      try { return nextResolve(`${value}.ts`, context) } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const {
  P2_I01_GATE_PASS_REQUIRED_FOR_LIVE_POLLING,
  P2_I02_PREBUILD_LIVE_ACTIVATION_LOCKED,
  P2_I02_SCHEMA_DELTA_REQUIRED,
  SELLER_OS_LUNA_STOCK_FAILURE_CATEGORIES_V1,
  SELLER_OS_LUNA_STOCK_OBSERVATION_RESOURCE_V1,
  SELLER_OS_LUNA_STOCK_OBSERVATION_STATUS_VERSION,
  SELLER_OS_LUNA_STOCK_OBSERVATION_VERSION,
  buildLunaStockCheckJobV1,
  buildLunaStockObservationPackageV1,
  buildLunaStockObservationSchedulerPlanV1,
  buildLunaStockObservationWindowV1,
  buildLunaStockRetryDecisionV1,
  buildSellerOsLunaStockObservationV1,
  claimLunaStockCheckJobV1,
  classifyLunaStockObservationEligibilityV1,
  createSellerOsLunaStockObservationPrebuildStatusV1,
  deriveLunaStockObservationAgeInputV1,
  getLunaStockAcquisitionCapabilityV1,
  getSellerOsLunaStockObservationActivationPolicyV1,
} = await import("./ebay-luna-stock-observation-v1.ts")
const { LUNA_SUPPLIER_STOCK_WATCHER_VERSION } = await import(
  "./ebay-luna-supplier-stock-watcher-v1.ts"
)

const NOW = "2026-08-21T12:34:56.000Z"
const ATTEMPT_AT = "2026-08-21T12:36:00.000Z"

function component(overrides = {}) {
  const productId = overrides.productId ?? "luna-product-z6"
  const variantId = Object.hasOwn(overrides, "variantId")
    ? overrides.variantId : "luna-variant-black"
  const sku = overrides.sku ?? "Z6-BLACK"
  return {
    componentIdentityId: overrides.componentIdentityId ??
      `luna-component-identity-v1:${productId}:${variantId ?? "none"}:${sku}`,
    productId,
    variantId,
    variantSemantics: overrides.variantSemantics ?? "EXACT_VARIANT_REQUIRED",
    sku,
    canonicalSourceUrl: overrides.canonicalSourceUrl ??
      `https://www.lunaportex.com/products/${productId}`,
    supplierQuantityRequired: overrides.supplierQuantityRequired ?? 1,
    ...overrides,
  }
}

function linkage(status = "CERTIFIED", overrides = {}) {
  const components = overrides.components ?? [component()]
  return {
    linkageId: overrides.linkageId ??
      "luna-linkage-v1:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    status,
    ebayItemId: overrides.ebayItemId ?? "123456789012",
    ebaySku: overrides.ebaySku ?? "EBAY-Z6-BLACK",
    components,
    bundleMode: overrides.bundleMode ??
      (components.length > 1 ? "MULTI_COMPONENT_BOM" : "NOT_APPLICABLE"),
    ...overrides,
  }
}

function window() {
  return buildLunaStockObservationWindowV1({ now: NOW,
    intervalSeconds: 3_600 })
}

function job(link = linkage()) {
  return buildLunaStockCheckJobV1({ linkage: link,
    observationWindow: window() })
}

function capture(overrides = {}) {
  return {
    contractVersion: LUNA_SUPPLIER_STOCK_WATCHER_VERSION,
    requestId: "luna-watch-test-request",
    sourceMode: "AUTHENTICATED_SERVER_HTTP",
    sessionState: "SESSION_OK",
    productId: "luna-product-z6",
    variantId: "luna-variant-black",
    supplierSku: "Z6-BLACK",
    availability: true,
    quantity: null,
    quantityExplicit: false,
    explicitLowStock: false,
    regularPrice: 100,
    salePrice: 90,
    currency: "GTQ",
    observedAt: "2026-08-21T12:35:00.000Z",
    parserVersion: "LUNA_AUTHENTICATED_BROWSER_CAPTURE_V1",
    selectorContractVersion: "LUNA_AUTHENTICATED_HTTP_PRODUCT_V1",
    sourceEvidenceFingerprint:
      "luna_agent_evidence_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    limitationCode: null,
    serverAttestation: {
      serverOnly: true,
      protectedSessionValuePresent: true,
      rawSessionMaterialExported: false,
      rawResponseExported: false,
      redirectFollowed: false,
    },
    ...overrides,
  }
}

function observation(overrides = {}) {
  const checkJob = overrides.job ?? job()
  return buildSellerOsLunaStockObservationV1({
    job: checkJob,
    componentIdentityId: overrides.componentIdentityId ??
      checkJob.components[0].componentIdentityId,
    attemptNumber: overrides.attemptNumber ?? 1,
    observedAt: overrides.observedAt ?? ATTEMPT_AT,
    capture: Object.hasOwn(overrides, "capture")
      ? overrides.capture : capture(),
    failure: overrides.failure,
    maximumAgeSeconds: overrides.maximumAgeSeconds,
  })
}

test("1 certified linkage is eligible for a prepared exact stock job", () => {
  const result = classifyLunaStockObservationEligibilityV1(linkage())
  assert.equal(result.eligible, true)
  assert.equal(result.linkageStatus, "CERTIFIED")
  assert.equal(result.components[0].variantId, "luna-variant-black")
})

for (const [number, status] of [[2, "CANDIDATE"], [3, "UNPROVEN"],
  [4, "STALE"]]) {
  test(`${number} ${status} linkage is blocked`, () => {
    const result = classifyLunaStockObservationEligibilityV1(linkage(status))
    assert.equal(result.eligible, false)
    assert.equal(result.failureCategory, "LINKAGE_NOT_CERTIFIED")
    assert.throws(() => job(linkage(status)), /LINKAGE_NOT_CERTIFIED/)
  })
}

test("5 exact variant IN_STOCK remains a supplier-stated observation", () => {
  const result = observation()
  assert.equal(result.observationState, "OBSERVED_IN_STOCK")
  assert.equal(result.evidenceClass, "SUPPLIER_STATED")
  assert.equal(result.lunaVariantIdentity, "luna-variant-black")
})

test("6 exact variant OUT_OF_STOCK is observed but not certified", () => {
  const result = observation({ capture: capture({ availability: false }) })
  assert.equal(result.observationState, "OBSERVED_OUT_OF_STOCK")
  assert.equal(result.downstreamDecision.certifiedOos, false)
  assert.equal(result.downstreamDecision.automaticPauseAllowed, false)
})

test("7 explicit supplier quantity is preserved", () => {
  const result = observation({ capture: capture({ quantity: 7,
    quantityExplicit: true }) })
  assert.equal(result.observationState, "OBSERVED_QUANTITY")
  assert.equal(result.observedSupplierQuantity, 7)
})

test("8 availability without quantity never invents quantity", () => {
  const result = observation()
  assert.equal(result.observationState, "OBSERVED_IN_STOCK")
  assert.equal(result.observedSupplierQuantity, null)
})

test("9 source timeout is retryable and never zero/OOS", () => {
  const result = observation({ capture: null, failure: new Error("LUNA_TIMEOUT") })
  assert.equal(result.failureCategory, "LUNA_TIMEOUT")
  assert.equal(result.observationState, "SOURCE_UNAVAILABLE")
  assert.equal(result.observedSupplierQuantity, null)
  assert.equal(result.observedAvailability, null)
  assert.equal(result.attemptCorrelation.workflowState, "RETRYABLE_FAILURE")
})

test("10 network failure uses bounded retry", () => {
  const result = observation({ capture: null,
    failure: new Error("LUNA_NETWORK_ERROR") })
  assert.equal(result.failureCategory, "LUNA_NETWORK_ERROR")
  assert.equal(result.attemptCorrelation.retryAllowed, true)
})

test("11 expired Luna auth blocks instead of becoming OOS", () => {
  const result = observation({ capture: capture({
    sessionState: "REAUTH_REQUIRED",
    productId: null,
    variantId: null,
    supplierSku: null,
    availability: null,
    limitationCode: "LUNA_REAUTH_REQUIRED",
  }) })
  assert.equal(result.failureCategory, "LUNA_SESSION_EXPIRED")
  assert.equal(result.attemptCorrelation.workflowState, "BLOCKED")
  assert.equal(result.observationState, "SOURCE_UNAVAILABLE")
})

test("12 missing product is OBSERVATION_FAILED, not OOS", () => {
  const result = observation({ capture: capture({ productId: null,
    variantId: null, supplierSku: null, availability: null }) })
  assert.equal(result.failureCategory, "LUNA_PRODUCT_NOT_FOUND")
  assert.equal(result.observationState, "OBSERVATION_FAILED")
  assert.equal(result.downstreamDecision.certifiedOos, false)
})

test("13 missing exact variant is OBSERVATION_FAILED", () => {
  const result = observation({ capture: capture({ variantId: null,
    supplierSku: null, availability: null }) })
  assert.equal(result.failureCategory, "LUNA_VARIANT_NOT_FOUND")
  assert.equal(result.observationState, "OBSERVATION_FAILED")
})

test("14 source markup/contract change is terminal without stock claim", () => {
  const result = observation({ capture: capture({
    sessionState: "SOURCE_CHANGED",
    productId: null,
    variantId: null,
    supplierSku: null,
    availability: null,
    limitationCode: "LUNA_RESPONSE_BOUNDARY_CHANGED",
  }) })
  assert.equal(result.failureCategory, "LUNA_PARSE_CONTRACT_CHANGED")
  assert.equal(result.attemptCorrelation.workflowState, "TERMINAL_FAILURE")
})

test("15 duplicate scheduler invocation reuses job identity and success receipt", () => {
  const first = job()
  const second = job()
  assert.equal(first.stockCheckJobId, second.stockCheckJobId)
  const claim = claimLunaStockCheckJobV1({
    job: first,
    workerId: "worker-a",
    now: ATTEMPT_AT,
    successReceipt: {
      stockCheckJobId: first.stockCheckJobId,
      status: "SUCCEEDED",
      observationPackageDigest: "receipt:sha256:abc",
      completedAt: ATTEMPT_AT,
    },
  })
  assert.equal(claim.claimStatus, "ALREADY_SUCCEEDED")
})

test("16 100x replay produces one logical component observation", () => {
  const checkJob = job()
  const result = observation({ job: checkJob })
  const packaged = buildLunaStockObservationPackageV1({
    job: checkJob,
    observations: Array.from({ length: 100 }, () => result),
  })
  assert.equal(packaged.latestComponentObservations.length, 1)
  assert.equal(packaged.duplicateReplayCount, 99)
  assert.equal(packaged.status, "COMPLETE")
})

test("17 two workers cannot own one logical stock window", () => {
  const checkJob = job()
  const first = claimLunaStockCheckJobV1({ job: checkJob,
    workerId: "worker-a", now: ATTEMPT_AT })
  const second = claimLunaStockCheckJobV1({ job: checkJob,
    workerId: "worker-b", now: "2026-08-21T12:36:30.000Z",
    existingLease: first.lease })
  assert.equal(first.claimStatus, "CLAIMED")
  assert.equal(second.claimStatus, "ALREADY_CLAIMED")
})

test("18 restart after lease expiry resumes same deterministic job", () => {
  const checkJob = job()
  const first = claimLunaStockCheckJobV1({ job: checkJob,
    workerId: "worker-a", now: ATTEMPT_AT, leaseSeconds: 60 })
  const resumed = claimLunaStockCheckJobV1({ job: checkJob,
    workerId: "worker-b", now: "2026-08-21T12:38:00.000Z",
    existingLease: first.lease })
  assert.equal(resumed.claimStatus, "CLAIMED")
  assert.equal(resumed.lease.stockCheckJobId, first.lease.stockCheckJobId)
  assert.notEqual(resumed.lease.leaseId, first.lease.leaseId)
})

function bundleLinkage() {
  return linkage("CERTIFIED", {
    bundleMode: "MULTI_COMPONENT_BOM",
    components: [
      component({ componentIdentityId: "luna-component:A",
        productId: "product-a", variantId: "variant-a", sku: "SKU-A",
        supplierQuantityRequired: 2 }),
      component({ componentIdentityId: "luna-component:B",
        productId: "product-b", variantId: "variant-b", sku: "SKU-B" }),
      component({ componentIdentityId: "luna-component:C",
        productId: "product-c", variantId: "variant-c", sku: "SKU-C" }),
    ],
  })
}

function captureFor(componentValue, overrides = {}) {
  return capture({
    productId: componentValue.productId,
    variantId: componentValue.variantId,
    supplierSku: componentValue.sku,
    ...overrides,
  })
}

test("19 bundle preserves three exact component observations", () => {
  const checkJob = job(bundleLinkage())
  const observations = checkJob.components.map((entry) => observation({
    job: checkJob,
    componentIdentityId: entry.componentIdentityId,
    capture: captureFor(entry),
  }))
  const packaged = buildLunaStockObservationPackageV1({ job: checkJob,
    observations })
  assert.equal(packaged.componentCount, 3)
  assert.equal(packaged.succeededComponentCount, 3)
  assert.equal(packaged.bundleOutOfStockDecision, null)
})

test("20 one failed bundle component yields partial evidence only", () => {
  const checkJob = job(bundleLinkage())
  const observations = checkJob.components.map((entry, index) => observation({
    job: checkJob,
    componentIdentityId: entry.componentIdentityId,
    capture: index === 1 ? null : captureFor(entry),
    failure: index === 1 ? new Error("LUNA_TIMEOUT") : undefined,
  }))
  const packaged = buildLunaStockObservationPackageV1({ job: checkJob,
    observations })
  assert.equal(packaged.status, "PARTIAL")
  assert.equal(packaged.failedComponentCount, 1)
  assert.equal(packaged.certifiedOos, false)
})

test("21 supplier multiplier greater than one is preserved, never capacity", () => {
  const linked = linkage("CERTIFIED", {
    bundleMode: "SINGLE_COMPONENT_MULTIPLIER",
    components: [component({ supplierQuantityRequired: 3 })],
  })
  const result = observation({ job: job(linked), capture: capture({
    quantity: 7, quantityExplicit: true }) })
  assert.equal(result.supplierQuantityRequired, 3)
  assert.equal(result.observedSupplierQuantity, 7)
  assert.equal(result.downstreamDecision.safeSalesCapacity, null)
})

test("22 UNKNOWN never becomes zero", () => {
  const result = observation({ capture: capture({ availability: null,
    quantity: null, quantityExplicit: false }) })
  assert.equal(result.observationState, "UNKNOWN")
  assert.equal(result.observedSupplierQuantity, null)
  assert.equal(result.observedAvailability, null)
})

test("23 old evidence age never changes stock state to OOS", () => {
  const result = observation({ maximumAgeSeconds: 3_600 })
  const age = deriveLunaStockObservationAgeInputV1({ observation: result,
    asOf: "2026-08-22T12:35:00.000Z" })
  assert.equal(age.ageExceedsMaximum, true)
  assert.equal(age.observationState, "OBSERVED_IN_STOCK")
  assert.equal(age.outOfStockInferredFromAge, false)
})

test("24 observed OOS never becomes CERTIFIED_OOS", () => {
  const result = observation({ capture: capture({ availability: false,
    quantity: 0, quantityExplicit: true }) })
  assert.equal(result.observationState, "OBSERVED_OUT_OF_STOCK")
  assert.equal(result.downstreamDecision.certifiedOos, false)
  assert.ok(result.limitations.includes(
    "OBSERVED_OUT_OF_STOCK_IS_NOT_CERTIFIED_OOS"))
})

test("25 arbitrary supplier URL is rejected", () => {
  const unsafe = linkage("CERTIFIED", { components: [component({
    canonicalSourceUrl: "https://example.com/products/z6",
  })] })
  assert.throws(() => classifyLunaStockObservationEligibilityV1(unsafe),
    /ARBITRARY_URL_REJECTED/)
})

test("26 arbitrary Luna credential is rejected", () => {
  const unsafe = { ...linkage(), password: "not-accepted-test-value" }
  assert.throws(() => classifyLunaStockObservationEligibilityV1(unsafe),
    /CALLER_CREDENTIAL_REJECTED/)
})

test("27 observation excludes buyer PII", () => {
  const result = observation()
  assert.equal(result.safety.buyerPiiIncluded, false)
  assert.doesNotMatch(JSON.stringify(result), /buyer@example|shipping_address/i)
})

test("28 observation excludes secrets, cookies, raw payload and URL", () => {
  const result = observation()
  assert.equal(result.safety.credentialsIncluded, false)
  assert.equal(result.safety.cookiesIncluded, false)
  assert.equal(result.safety.rawSupplierPayloadIncluded, false)
  assert.equal(Object.hasOwn(result, "canonicalSourceUrl"), false)
})

test("29 observation has zero eBay and marketplace writes", () => {
  const result = observation()
  assert.equal(result.safety.marketplaceWrites, 0)
  assert.equal(result.safety.ebayPauseWrites, 0)
  assert.equal(result.safety.ebayReviseWrites, 0)
  assert.equal(result.safety.inventoryWrites, 0)
})

test("30 observation has zero Luna and Product Case mutations", () => {
  const result = observation()
  assert.equal(result.safety.lunaMutations, 0)
  assert.equal(result.safety.productCaseMutations, 0)
})

test("31 observation has zero WhatsApp sends", () => {
  assert.equal(observation().safety.whatsappSends, 0)
})

test("32 observation has zero buyer messages", () => {
  assert.equal(observation().safety.buyerMessageSends, 0)
})

test("33 observation has zero payment transactions", () => {
  assert.equal(observation().safety.paymentTransactions, 0)
})

test("34 blocked P2-I01 gate disables every production dispatch", () => {
  const plan = buildLunaStockObservationSchedulerPlanV1({
    linkages: [linkage()],
    now: NOW,
    p2I01GateCertified: false,
  })
  assert.equal(plan.activationStatus, "BLOCKED_BY_P2_I01_GATE")
  assert.equal(plan.productionSchedulerEnabled, false)
  assert.equal(plan.preparedJobCount, 1)
  assert.equal(plan.dispatchableJobCount, 0)
  assert.equal(plan.dispatchableJobs.length, 0)
})

test("retry policy is bounded with exponential backoff and no loop", () => {
  const first = buildLunaStockRetryDecisionV1({
    failureCategory: "LUNA_TIMEOUT", attemptNumber: 1,
    observedAt: ATTEMPT_AT,
  })
  const third = buildLunaStockRetryDecisionV1({
    failureCategory: "LUNA_TIMEOUT", attemptNumber: 3,
    observedAt: ATTEMPT_AT,
  })
  assert.equal(first.state, "RETRYABLE_FAILURE")
  assert.equal(first.backoffSeconds, 30)
  assert.equal(third.state, "TERMINAL_FAILURE")
  assert.equal(third.retryAllowed, false)
})

test("PREBUILD resource contract is bounded, honest and side-effect free", () => {
  const status = createSellerOsLunaStockObservationPrebuildStatusV1({
    observedAt: NOW,
    protectedSessionConfigured: true,
    protectedSessionServerOnly: true,
  })
  assert.equal(status.contractVersion,
    SELLER_OS_LUNA_STOCK_OBSERVATION_STATUS_VERSION)
  assert.equal(SELLER_OS_LUNA_STOCK_OBSERVATION_RESOURCE_V1.id,
    "seller-os://phase-2/luna-stock-observation")
  assert.equal(status.activationStatus, "BLOCKED_BY_P2_I01_GATE")
  assert.equal(status.scheduler.productionSchedulerEnabled, false)
  assert.equal(status.storageReadiness, "READY")
  assert.equal(status.schemaArtifactStatus, "MIGRATION_ARTIFACT_APPLIED")
  assert.equal(status.schemaAppliedStatus, "APPLIED")
  assert.equal(status.lunaProtectedSessionStatus, "SESSION_READY")
  assert.equal(status.humanBootstrapRequired, false)
  assert.equal(status.safety.productionLunaPolling, 0)
  assert.equal(status.safety.certifiedOosProduced, false)
  assert.equal(status.counts.eligibleCertifiedLinkages, null)
})

test("acquisition audit reports canonical server read without assuming an API", () => {
  const ready = getLunaStockAcquisitionCapabilityV1({
    protectedSessionConfigured: true,
    protectedSessionServerOnly: true,
  })
  assert.equal(ready.classification, "CANONICAL_SERVER_READ")
  assert.equal(ready.supportedApiAssumed, false)
  assert.equal(ready.canonicalBrowserAutomationActivated, false)
  assert.equal(ready.callerProvidedUrlAllowed, false)
})

test("schema artifact is applied while every production activation gate remains closed", () => {
  assert.equal(P2_I02_SCHEMA_DELTA_REQUIRED.required, false)
  assert.equal(P2_I02_SCHEMA_DELTA_REQUIRED.migrationCreated, true)
  assert.equal(P2_I02_SCHEMA_DELTA_REQUIRED.migrationApplied, true)
  assert.equal(P2_I02_SCHEMA_DELTA_REQUIRED.schemaArtifactStatus,
    "MIGRATION_ARTIFACT_APPLIED")
  assert.equal(P2_I02_SCHEMA_DELTA_REQUIRED.storageReadiness,
    "READY")
  assert.equal(P2_I02_SCHEMA_DELTA_REQUIRED.proposedTables.length, 2)
})

test("W0 workflow and P2 activation invariants remain explicit", () => {
  const policy = getSellerOsLunaStockObservationActivationPolicyV1({
    p2I01GateCertified: false,
    schedulerRequested: true,
  })
  assert.equal(P2_I01_GATE_PASS_REQUIRED_FOR_LIVE_POLLING, true)
  assert.equal(P2_I02_PREBUILD_LIVE_ACTIVATION_LOCKED, false)
  assert.equal(policy.productionSchedulerEnabled, false)
  assert.equal(policy.policy.oneEffectiveActiveWorkerPerLogicalWindow, true)
})

test("certified current prerequisites activate the existing 15 minute scheduler", () => {
  const status = createSellerOsLunaStockObservationPrebuildStatusV1({
    observedAt: NOW,
    protectedSessionConfigured: true,
    protectedSessionServerOnly: true,
    activationCertified: true,
  })
  assert.equal(status.status, "ACTIVE")
  assert.equal(status.activationStatus, "ACTIVATED")
  assert.equal(status.p2I01Dependency.status, "CERTIFIED")
  assert.equal(status.scheduler.status, "ENABLED")
  assert.equal(status.scheduler.productionSchedulerEnabled, true)
  assert.equal(status.scheduler.policy.intervalSeconds, 900)
  assert.equal(status.scheduler.policy.maximumAttempts, 3)
  assert.equal(status.scheduler.policy.maximumConcurrency, 4)
  assert.equal(status.humanBootstrapRequired, false)
  assert.doesNotMatch(status.limitations.join(" "),
    /P2_I01_GATE_NOT_CERTIFIED|EXTERNAL_EBAY_QUOTA_BLOCKER/)
})

test("failure taxonomy contains every required non-OOS category", () => {
  for (const category of [
    "LUNA_SOURCE_UNAVAILABLE", "LUNA_AUTH_REQUIRED", "LUNA_SESSION_EXPIRED",
    "LUNA_PRODUCT_NOT_FOUND", "LUNA_VARIANT_NOT_FOUND",
    "LUNA_PARSE_CONTRACT_CHANGED", "LUNA_TIMEOUT", "LUNA_RATE_LIMITED",
    "LUNA_NETWORK_ERROR", "LINKAGE_NOT_CERTIFIED",
    "P2_I01_GATE_NOT_CERTIFIED",
  ]) assert.ok(SELLER_OS_LUNA_STOCK_FAILURE_CATEGORIES_V1.includes(category))
})

test("resource is allowlisted through search/fetch without a new MCP tool or cron", async () => {
  const [server, vercel, route] = await Promise.all([
    readFile(new URL("./ebay-seller-os-mcp-server-v1.ts", import.meta.url), "utf8"),
    readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/cron/ebay-active-listing-luna-monitor/route.ts",
      import.meta.url), "utf8"),
  ])
  assert.match(server, /SELLER_OS_LUNA_STOCK_OBSERVATION_RESOURCE_V1/)
  assert.match(server, /lunaStockObservationStatusCollector/)
  assert.doesNotMatch(vercel, /ebay-active-listing-luna-monitor/)
  assert.match(route, /ACTIVATE_LUNA_STOCKGUARD_PRODUCTION_POLLING_V1/)
  assert.match(route, /activation\.productionSchedulerEnabled/)
  assert.match(route, /LUNA_PRODUCTION_POLL_INTERVAL_SECONDS = 900/)
  assert.match(route, /reconcileSellerOsStockIdentityV1/)
  assert.equal(SELLER_OS_LUNA_STOCK_OBSERVATION_VERSION,
    "SELLER_OS_LUNA_STOCK_OBSERVATION_V1")
})
