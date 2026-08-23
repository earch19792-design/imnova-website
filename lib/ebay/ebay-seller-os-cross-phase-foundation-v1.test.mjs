import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier)
    if (value.startsWith(".") && !/\.(?:ts|mjs|js|json)$/.test(value)) {
      return nextResolve(`${value}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const {
  SELLER_OS_CROSS_PHASE_ARCHITECTURE_INVENTORY_V1,
  SELLER_OS_CROSS_PHASE_CLASSIFICATIONS_V1,
  SELLER_OS_CROSS_PHASE_DUPLICATION_AUDIT_V1,
  SELLER_OS_CROSS_PHASE_REUSE_MAP_V1,
  SELLER_OS_CROSS_PHASE_REUSE_POLICY_V1,
  SELLER_OS_ROADMAP_PHASES_V1,
  getSellerOsCrossPhaseFoundationV1,
} = await import("./ebay-seller-os-cross-phase-foundation-v1.ts")

const byCapability = new Map(SELLER_OS_CROSS_PHASE_REUSE_MAP_V1.entries.map(
  (entry) => [entry.capability, entry]))

test("W0 freezes versioned architecture, reuse-map and anti-duplication contracts", () => {
  const foundation = getSellerOsCrossPhaseFoundationV1()
  assert.equal(foundation.contractVersion,
    "W0_CROSS_PHASE_SHARED_FOUNDATION_V1")
  assert.equal(foundation.architectureInventory.contractVersion,
    "W0_CROSS_PHASE_SHARED_FOUNDATION_V1")
  assert.equal(foundation.reuseMap.contractVersion,
    "SELLER_OS_CROSS_PHASE_REUSE_MAP_V1")
  assert.equal(foundation.reusePolicy.contractVersion,
    "SELLER_OS_CROSS_PHASE_REUSE_POLICY_V1")
  assert.equal(SELLER_OS_CROSS_PHASE_ARCHITECTURE_INVENTORY_V1.layers.length, 5)
  assert.deepEqual(foundation.safety, {
    readOnly: true,
    buyerPiiIncluded: false,
    credentialsIncluded: false,
    environmentValuesIncluded: false,
    fileContentsIncluded: false,
    rawUpstreamPayloadIncluded: false,
    arbitraryUrlAllowed: false,
    callerControlledAccountAllowed: false,
    callerControlledTokenAllowed: false,
    databaseWrites: 0,
    marketplaceWrites: 0,
    inventoryWrites: 0,
    productCaseMutations: 0,
    lunaLinkMutations: 0,
    lunaMutations: 0,
    whatsappSends: 0,
    buyerMessageSends: 0,
    paymentTransactions: 0,
  })
})

test("reuse map covers every roadmap phase and uses exactly the five classifications", () => {
  assert.equal(SELLER_OS_ROADMAP_PHASES_V1.length, 11)
  const covered = new Set(SELLER_OS_CROSS_PHASE_REUSE_MAP_V1.entries.flatMap(
    (entry) => entry.futureConsumers))
  assert.deepEqual([...SELLER_OS_ROADMAP_PHASES_V1].filter(
    (phase) => !covered.has(phase)), [])

  const actualClassifications = new Set()
  for (const entry of SELLER_OS_CROSS_PHASE_REUSE_MAP_V1.entries) {
    assert.ok(entry.capability.length > 2)
    assert.ok(entry.responsibility.length > 10)
    assert.ok(entry.canonicalOwner.length > 2)
    assert.ok(entry.canonicalImplementation.length > 0)
    assert.ok(entry.extensionPolicy.length > 10)
    assert.ok(entry.safetyClass.length > 1)
    assert.ok(entry.sideEffectClass.length > 1)
    assert.ok(SELLER_OS_CROSS_PHASE_CLASSIFICATIONS_V1.includes(
      entry.classification))
    assert.ok(entry.canonicalImplementation.every((path) =>
      !path.startsWith("/") && !path.includes("..")))
    actualClassifications.add(entry.classification)
  }
  assert.deepEqual([...actualClassifications].sort(),
    [...SELLER_OS_CROSS_PHASE_CLASSIFICATIONS_V1].sort())
})

test("certified Phase 1 identities and authority boundaries remain frozen", () => {
  const identity = SELLER_OS_CROSS_PHASE_REUSE_POLICY_V1.identityAndIdempotency
  assert.equal(identity.certifiedSalesOrderEventIdentityFrozen, true)
  assert.equal(identity.certifiedGrain,
    "CANONICAL_ACCOUNT_MARKETPLACE_ORDER_ID_LINE_ITEM_ID_EVENT_TYPE_VERSION")
  assert.ok(identity.forbiddenBusinessIdentityInputs.includes("RANDOM_UUID"))
  assert.ok(identity.forbiddenBusinessIdentityInputs.includes(
    "PROCESSING_TIMESTAMP"))
  assert.equal(identity.attemptAndLeaseIdsMayBeRandom, true)
  assert.equal(byCapability.get("SALES_ORDER_LINE_EVENT_IDENTITY").classification,
    "REUSE_AS_IS")
  assert.equal(byCapability.get("OFFICIAL_EBAY_ORDER_AUTHORITY").classification,
    "REUSE_AS_IS")

  const authorityRules = SELLER_OS_CROSS_PHASE_REUSE_POLICY_V1
    .evidenceAuthority.rules
  assert.ok(authorityRules.includes(
    "ANALYTICS_QUANTITY_SOLD_IS_NOT_OFFICIAL_ORDERS"))
  assert.ok(authorityRules.includes("NO_EVIDENCE_DOES_NOT_PROVE_ZERO"))
  assert.ok(authorityRules.includes("UNKNOWN_IS_NOT_ZERO"))
  assert.ok(authorityRules.includes("INFERENCE_IS_NOT_OFFICIAL_FACT"))
  assert.ok(authorityRules.includes("CORRELATION_IS_NOT_CAUSALITY"))
})

test("provenance, categorized statuses and freshness have non-conflating contracts", () => {
  const policy = SELLER_OS_CROSS_PHASE_REUSE_POLICY_V1
  for (const field of ["authorityClass", "source", "sourceContractVersion",
    "operation", "accountBinding", "observedAt", "sourceUpdatedAt",
    "evidenceReferences", "evidenceCompleteness", "limitations"]) {
    assert.ok(policy.provenance.requiredFields.includes(field), field)
  }
  assert.equal(policy.statusTaxonomy.rule,
    "STATUS_CATEGORY_MUST_BE_DECLARED_AND_CROSS_CATEGORY_SUCCESS_MUST_NOT_BE_INFERRED")
  assert.notStrictEqual(policy.statusTaxonomy.source,
    policy.statusTaxonomy.workflow)
  assert.ok(policy.freshness.rules.includes(
    "OBSERVED_AT_IS_NOT_SOURCE_UPDATED_AT"))
  assert.ok(policy.freshness.rules.includes(
    "PERSISTED_CERTIFICATION_EVIDENCE_REQUIRES_EXACT_SUBJECT_FINGERPRINT"))
  assert.equal(byCapability.get("FRESHNESS_AND_STALENESS").classification,
    "EXTEND_CANONICAL")
})

test("sensitive data, bounded reads and human gates are deny-by-default", () => {
  const policy = SELLER_OS_CROSS_PHASE_REUSE_POLICY_V1
  for (const forbidden of ["ACCESS_TOKEN", "REFRESH_TOKEN", "CLIENT_SECRET",
    "AUTHORIZATION_HEADER", "CARD_NUMBER", "CVV", "RAW_ENVIRONMENT_VALUE"]) {
    assert.ok(policy.sensitiveData.tunnelForbidden.includes(forbidden), forbidden)
  }
  for (const pii of ["BUYER_NAME", "EMAIL", "PHONE", "SHIPPING_ADDRESS",
    "BILLING_ADDRESS", "PAYMENT_DATA"]) {
    assert.ok(policy.sensitiveData.buyerPiiTunnelForbidden.includes(pii), pii)
  }
  assert.equal(policy.sensitiveData.defaultPolicy, "DENY_BY_DEFAULT")
  assert.deepEqual(policy.automationAuthority.levels, ["READ_ONLY",
    "RECOMMENDATION", "HUMAN_APPROVAL_REQUIRED", "AUTO_EXECUTION_ALLOWED"])
  assert.equal(policy.automationAuthority.defaultLevel, "READ_ONLY")
  assert.ok(policy.boundedRead.forbidden.includes("ARBITRARY_URL"))
  assert.ok(policy.boundedRead.forbidden.includes("ARBITRARY_SQL"))
  assert.ok(policy.boundedRead.forbidden.includes("CALLER_ACCOUNT"))
  assert.equal(policy.humanReview.invariant,
    "NO_GATED_EXTERNAL_ACTION_BEFORE_EXPLICIT_VALID_APPROVAL")
})

test("retry and audit contracts separate business identity, attempts and child effects", () => {
  const policy = SELLER_OS_CROSS_PHASE_REUSE_POLICY_V1
  assert.deepEqual(policy.retryReplayRestart.states, ["NOT_STARTED",
    "IN_PROGRESS", "SUCCEEDED", "RETRYABLE_FAILURE", "TERMINAL_FAILURE",
    "BLOCKED", "SKIPPED", "NOT_APPLICABLE"])
  assert.ok(policy.retryReplayRestart.invariants.includes(
    "ONE_STEP_FAILURE_DOES_NOT_REPLAY_SUCCEEDED_SIBLING_STEPS"))
  assert.ok(policy.retryReplayRestart.invariants.includes(
    "EACH_SIDE_EFFECT_HAS_CHILD_DEDUPLICATION_KEY"))
  assert.deepEqual(policy.auditTrail.chain, ["BUSINESS_FACT", "DETECTION",
    "EVENT", "DECISION", "NOTIFICATION_OR_EXTERNAL_ACTION", "OUTCOME"])
  assert.equal(policy.auditTrail.eventSourcingPlatformRequired, false)
  assert.ok(policy.sideEffects.classes.includes(
    "INTERNAL_IDEMPOTENT_MAINTENANCE_WRITE"))
  assert.ok(policy.sideEffects.classes.includes("MARKETPLACE_WRITE"))
  assert.ok(policy.sideEffects.classes.includes("PAYMENT_TRANSACTION"))
})

test("only proven same-responsibility grain conflicts are frozen for removal", () => {
  const duplicates = SELLER_OS_CROSS_PHASE_DUPLICATION_AUDIT_V1.filter(
    (entry) => entry.classification === "DUPLICATE_TO_REMOVE")
  assert.equal(duplicates.length, 2)
  assert.ok(duplicates.every((entry) => entry.sameResponsibility === "YES"))
  const mapped = SELLER_OS_CROSS_PHASE_REUSE_MAP_V1.entries.filter(
    (entry) => entry.classification === "DUPLICATE_TO_REMOVE")
  assert.equal(mapped.length, 2)
  assert.ok(mapped.every((entry) =>
    entry.deprecationStatus === "DEPRECATE_AFTER_CONSUMER_MIGRATION" &&
    entry.futureConsumers.length === 0 &&
    entry.extensionPolicy.includes("Do not")))
  assert.ok(SELLER_OS_CROSS_PHASE_DUPLICATION_AUDIT_V1.filter(
    (entry) => entry.sameResponsibility === "NO").every((entry) =>
    entry.classification !== "DUPLICATE_TO_REMOVE"))

  const audited = new Set(SELLER_OS_CROSS_PHASE_DUPLICATION_AUDIT_V1.map(
    (entry) => entry.auditedConcern))
  for (const concern of ["OAUTH_AUTH_RESOLUTION", "EVENT_IDENTITY",
    "READ_MODEL_IDENTITY", "PROVENANCE", "STATUS_ENUMS", "RETRY_LOGIC",
    "IDEMPOTENCY", "AUDIT_LOGGING", "APPROVAL_HUMAN_GATE",
    "SAFETY_RESPONSE", "MCP_BOUNDS", "SOURCE_EVIDENCE_SEMANTICS"]) {
    assert.ok(audited.has(concern), concern)
  }
})

test("W0 is contract-only and does not weaken certified sources or add writes", () => {
  const source = readFileSync(new URL(
    "./ebay-seller-os-cross-phase-foundation-v1.ts", import.meta.url), "utf8")
  const eventSource = readFileSync(new URL(
    "./ebay-sales-order-event-foundation-v1.ts", import.meta.url), "utf8")
  const ordersSource = readFileSync(new URL(
    "./ebay-official-orders-read-v1.ts", import.meta.url), "utf8")
  assert.match(eventSource, /function orderEventIdempotencyKeyV1/)
  assert.match(eventSource, /"AUTHORITATIVE_ORDER_LINE_OBSERVED"/)
  assert.match(eventSource, /ORDER_EVENT_INGESTION_VERSION/)
  assert.match(eventSource, /normalizedText\(orderId, 100\)/)
  assert.match(eventSource, /normalizedText\(orderLineItemId, 100\)/)
  assert.match(ordersSource, /ANALYTICS_QUANTITY_SOLD_IS_NOT_OFFICIAL_ORDERS/)
  assert.doesNotMatch(source, /from\(["']@supabase|\.insert\(|\.update\(|\.delete\(/)
  assert.doesNotMatch(source, /process\.env|Authorization:/)
})
