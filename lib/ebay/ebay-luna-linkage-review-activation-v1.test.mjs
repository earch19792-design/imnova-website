import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      try { return nextResolve(`${value}.ts`, context) } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const activation = await import(
  "./ebay-luna-linkage-review-activation-v1.ts"
)

const ACCOUNT = `seller:${"a".repeat(64)}`
const OBSERVED_AT = "2026-08-22T15:30:00.000Z"
const NOW = "2026-08-22T16:00:00.000Z"

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex")
}

function evidence(ebayItemId, observedAt = OBSERVED_AT) {
  const expected = activation
    .SELLER_OS_P2_I01C_EXPECTED_LUNA_IDENTITIES[ebayItemId]
  const digest = hash(`identity:${ebayItemId}:${observedAt}`)
  return {
    contractVersion: "SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1",
    currentCohortId: activation.SELLER_OS_P2_I01C_FROZEN_COHORT_ID,
    candidateId: `luna-linkage-review-candidate-v1:sha256:${hash(`candidate:${ebayItemId}`)}`,
    candidateEvidenceDigest: `sha256:${hash(`candidate-evidence:${ebayItemId}`)}`,
    ebayItemId,
    classification: "EXACT_UNIQUE_MATCH",
    currentLunaIdentity: {
      productId: expected.productId,
      productTitle: `Current Luna product ${ebayItemId}`,
      handle: `current-luna-product-${ebayItemId}`,
      variantId: expected.variantId,
      variantTitle: "Default Title",
      sku: expected.sku,
      barcode: null,
      model: null,
      structuredVariantAttributes: [],
    },
    defaultTitleOnly: true,
    configurationProven: false,
    observedAt,
    evidenceDigest: `luna-identity-v1:sha256:${digest}`,
    evidenceReference: `luna-current-identity:${digest}`,
    acquisitionMethod: "CANONICAL_SERVER_READ_IDENTITY_ONLY",
    sourceStatus: "AVAILABLE",
    commerceFactsUsedForIdentity: false,
    rawSourceIncluded: false,
    sessionMaterialIncluded: false,
  }
}

function receipt(itemIds = activation.SELLER_OS_P2_I01C_FROZEN_ITEM_IDS,
  observedAt = OBSERVED_AT) {
  return {
    contractVersion: "SELLER_OS_LUNA_IDENTITY_REVIEW_PREFLIGHT_V1",
    currentCohortId: activation.SELLER_OS_P2_I01C_FROZEN_COHORT_ID,
    currentLiveCount: 26,
    entries: itemIds.map((ebayItemId) => ({
      ebayItemId,
      targetCount: 1,
      evidence: [evidence(ebayItemId, observedAt)],
    })),
    metrics: {
      lunaIdentityReads: itemIds.length,
      recoveredCandidateTargets: itemIds.length,
      canonicalCatalogRowsRead: 25,
      existingEvidenceReusedCount: 26,
      verifiedItemCount: itemIds.length,
      lunaStockFactsAccessed: 0,
      lunaStockFactsEmitted: 0,
      lunaStockFactsPersisted: 0,
      databaseWrites: 0,
      ebayTradingCalls: 0,
    },
    safety: {
      credentialsIncluded: false,
      cookiesIncluded: false,
      rawSourceIncluded: false,
      stockEvaluated: false,
      marketplaceWrites: 0,
      vaultWrites: 0,
    },
  }
}

function sessionLog(receipts) {
  return receipts.map((value, index) => JSON.stringify({
    timestamp: `2026-08-22T15:3${index}:01.000Z`,
    type: "event_msg",
    payload: {
      type: "item_completed",
      item: {
        type: "CommandExecution",
        stdout: `${JSON.stringify(value)}\n`,
      },
    },
  })).join("\n")
}

function build(overrides = {}) {
  return activation.buildSellerOsLunaLinkageReviewActivationV1({
    receiptSourcePath: activation.SELLER_OS_P2_I01C_RECEIPT_SOURCE_PATH,
    sessionLogText: sessionLog([receipt()]),
    accountKey: ACCOUNT,
    now: NOW,
    ...overrides,
  })
}

test("frozen 26-item Review V2 preserves the certified classification matrix", () => {
  const plan = build()
  assert.equal(plan.reviewSet.currentLiveCount, 26)
  assert.deepEqual(plan.reviewSet.entries.map((entry) => entry.ebayItemId),
    [...activation.SELLER_OS_P2_I01C_FROZEN_ITEM_IDS].sort())
  assert.deepEqual(plan.classificationCounts, {
    EXACT_UNIQUE_MATCH: 1,
    AMBIGUOUS_MATCH: 1,
    CONFLICTING_MATCH: 3,
    NO_MATCH: 0,
    BUNDLE_INCOMPLETE: 6,
    IDENTITY_EVIDENCE_INCOMPLETE: 15,
  })
  assert.equal(plan.reviewSet.entries.every((entry) =>
    entry.recommendedSafeDecision === "KEEP_UNPROVEN"), true)
  assert.equal(plan.reviewSet.entries.some((entry) =>
    entry.allowedOperatorDecisions.includes("APPROVE_EXACT_LINKAGE")), false)
})

test("Default Title does not make even the one exact review entry approvable", () => {
  const plan = build()
  const keychain = plan.reviewSet.entries.find((entry) =>
    entry.ebayItemId === "366602466981")
  assert.equal(keychain.classification, "EXACT_UNIQUE_MATCH")
  assert.equal(keychain.components[0].variantTitle, "Default Title")
  assert.equal(keychain.components[0].structuredVariantAttributesComplete,
    false)
  assert.equal(keychain.approvalEligibility.eligible, false)
  assert.equal(keychain.approvalEligibility.reasonCodes.includes(
    "CONFLICT_SIGNALS_PRESENT"), true)
  assert.deepEqual(keychain.allowedOperatorDecisions,
    ["REJECT_CANDIDATE", "KEEP_UNPROVEN"])
})

test("six certified bundle cases are incomplete and never approve", () => {
  const plan = build()
  const output = activation.createSellerOsLunaLinkageReviewActivationOutputV1({
    plan,
    persistence: { requested: false, status: "NOT_REQUESTED" },
  })
  const bundles = output.entries.filter((entry) =>
    entry.classification === "BUNDLE_INCOMPLETE")
  assert.equal(bundles.length, 6)
  assert.equal(bundles.every((entry) =>
    entry.requiredBundleComponents.length >= 2), true)
  assert.equal(bundles.every((entry) =>
    !entry.allowedOperatorDecisions.includes("APPROVE_EXACT_LINKAGE")), true)
  const dogKit = bundles.find((entry) =>
    entry.ebayItemId === "366588773733")
  assert.deepEqual(dogKit.requiredBundleComponents,
    ["DOG_SEAT_COVER", "DOG_TETHER", "HANDHELD_VACUUM"])
  const persistedDogKit = plan.reviewSet.entries.find((entry) =>
    entry.ebayItemId === "366588773733")
  assert.equal(persistedDogKit.conflictSignals.includes(
    "REQUIRED_COMPONENT_UNRESOLVED_DOG_TETHER"), true)
  assert.equal(persistedDogKit.conflictSignals.includes(
    "REQUIRED_COMPONENT_UNRESOLVED_HANDHELD_VACUUM"), true)
})

test("Lysol remains a conflicting simple multiplier of three", () => {
  const entry = build().reviewSet.entries.find((candidate) =>
    candidate.ebayItemId === "366543596425")
  assert.equal(entry.classification, "CONFLICTING_MATCH")
  assert.equal(entry.linkageMode, "SIMPLE_MULTIPLIER")
  assert.equal(entry.supplierQuantityRequired, 3)
  assert.equal(entry.components[0].supplierQuantityRequired, 3)
  assert.equal(entry.conflictSignals.includes(
    "LISTING_IDENTITY_REPRESENTATION_CONFLICT"), true)
  assert.equal(entry.allowedOperatorDecisions.includes(
    "APPROVE_EXACT_LINKAGE"), false)
})

test("pack, historical mapping, and duplicate-SKU conflicts remain fail-closed", () => {
  const entries = new Map(build().reviewSet.entries.map((entry) =>
    [entry.ebayItemId, entry]))
  assert.equal(entries.get("366582630351").classification,
    "IDENTITY_EVIDENCE_INCOMPLETE")
  assert.equal(entries.get("366582630351").supplierQuantityRequired, 2)
  assert.equal(entries.get("366582630351").conflictSignals.includes(
    "PACK_COUNT_REQUIRES_HUMAN_CONFIRMATION"), true)
  assert.equal(entries.get("366575102453").conflictSignals.includes(
    "HISTORICAL_MAPPING_BELONGS_TO_DIFFERENT_EBAY_ITEM"), true)
  assert.equal(entries.get("366592919965").conflictSignals.includes(
    "DUPLICATE_EBAY_SKU_CONFLICT"), true)
  assert.equal(entries.get("366597514990").classification,
    "CONFLICTING_MATCH")
  assert.equal(entries.get("366597780377").conflictSignals.includes(
    "SUPPLIER_PACK_CONFIGURATION_CONFLICT"), true)
  assert.equal([...entries.values()].every((entry) =>
    !entry.allowedOperatorDecisions.includes("APPROVE_EXACT_LINKAGE")), true)
})

test("review replay is deterministic and uses verifier digest as evidence reference", () => {
  const first = build()
  const second = build({ now: "2026-08-22T16:05:00.000Z" })
  assert.equal(first.reviewSet.reviewSetId, second.reviewSet.reviewSetId)
  assert.equal(first.reviewSet.reviewSetDigest, second.reviewSet.reviewSetDigest)
  assert.equal(first.reviewObservedAt, OBSERVED_AT)
  assert.equal(first.reviewSet.entries.every((entry) =>
    entry.evidenceReferences.length === 1 &&
    /^luna-identity-v1:sha256:[0-9a-f]{64}$/.test(
      entry.evidenceReferences[0])), true)
})

test("stale evidence fails closed before any persistence boundary", () => {
  assert.throws(() => build({
    sessionLogText: sessionLog([receipt(
      activation.SELLER_OS_P2_I01C_FROZEN_ITEM_IDS,
      "2026-08-22T09:00:00.000Z",
    )]),
  }), /LUNA_LINKAGE_REVIEW_EVIDENCE_STALE/)
})

test("missing, malformed, or incomplete receipt evidence fails closed", () => {
  assert.throws(() => build({ sessionLogText: "{}\n" }),
    /LUNA_LINKAGE_REVIEW_RECEIPT_MISSING/)
  const malformed = JSON.stringify({
    payload: { item: { type: "CommandExecution",
      stdout: '{"contractVersion":"SELLER_OS_LUNA_IDENTITY_REVIEW_PREFLIGHT_V1"\n' } },
  })
  assert.throws(() => build({ sessionLogText: malformed }),
    /LUNA_LINKAGE_REVIEW_RECEIPT_MALFORMED/)
  const missingOne = activation.SELLER_OS_P2_I01C_FROZEN_ITEM_IDS.slice(0, 25)
  assert.throws(() => build({ sessionLogText: sessionLog([receipt(missingOne)]) }),
    /LUNA_LINKAGE_REVIEW_RECEIPT_COVERAGE_INCOMPLETE/)
})

test("activation output is dry-run safe and contains no decision mutation", () => {
  const serialized = JSON.stringify(
    activation.createSellerOsLunaLinkageReviewActivationOutputV1({
      plan: build(),
      persistence: { requested: false, status: "NOT_REQUESTED" },
    }),
  )
  const output = JSON.parse(serialized)
  assert.equal(output.persistence.reviewSetMutationCalls, 0)
  assert.equal(output.persistence.decisionRpcCalls, 0)
  assert.equal(output.safety.lunaIdentityReads, 0)
  assert.equal(output.safety.lunaStockReads, 0)
  assert.equal(output.safety.ebayCalls, 0)
  assert.equal(/accountKey|authorization|cookieHeader|password|serviceRole/i
    .test(serialized), false)
  const toolSource = readFileSync(
    new URL("../../tools/ebay-luna-linkage-review-activation.mjs",
      import.meta.url),
    "utf8",
  )
  assert.match(toolSource, /\.replaceReviewSet\(plan\.reviewSet\)/)
  assert.doesNotMatch(toolSource,
    /\.recordDecision\(|record_seller_os_luna_linkage_decision_v1/)
})
