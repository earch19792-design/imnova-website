import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export%20{}" }
    }
    const value = String(specifier)
    if (value.startsWith(".") &&
        !String(context.parentURL).includes("/node_modules/") &&
        !/\.(?:ts|mjs|js|json)$/.test(value)) {
      return nextResolve(`${value}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const {
  buildEbayRegistryRepairEvidenceFingerprint,
  buildEbayRegistryRepairPlanningResult,
} = await import("./ebay-registry-repair-dry-run.ts")
const {
  EbayRegistryRepairExecutorError,
  executeApprovedRegistryRepairV1WithDependencies,
} = await import("./ebay-registry-repair-executor.ts")

const ACCOUNT_KEY = `official:${"a".repeat(64)}`
const SOURCE = "EBAY_TRADING_GET_MY_EBAY_SELLING"
const NOW = new Date()
const OBSERVED_AT = NOW.toISOString()

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
}

function liveListing(index) {
  return {
    itemId: String(4_000_000_000 + index),
    sku: `LIVE-SKU-${index + 1}`,
    customLabel: `LIVE-SKU-${index + 1}`,
    variationKey: null,
    title: `Canonical listing ${index + 1}`,
    listingState: "ACTIVE",
    listingFormat: "FixedPriceItem",
    startTime: "2026-08-01T00:00:00.000Z",
    availableQuantity: 5,
    price: 19.99,
    currency: "USD",
    marketplaceSite: "US",
    marketplaceCertification: {
      status: "US_CERTIFIED",
      source: SOURCE,
      observedAt: OBSERVED_AT,
    },
    identityAmbiguous: false,
    source: SOURCE,
    observedAt: OBSERVED_AT,
  }
}

function registryRow(index, itemId, sku, status = "active") {
  return {
    id: uuid(index),
    account_key: ACCOUNT_KEY,
    source: SOURCE,
    sync_key: `${SOURCE}:${ACCOUNT_KEY}:${itemId}`,
    ebay_item_id: itemId,
    ebay_sku: sku,
    ebay_variation_key: null,
    listing_status: status,
    title: `Registry row ${index}`,
    ebay_quantity: 1,
    ebay_price: 10,
    currency: "USD",
    market_radar_product_id: null,
    supplier_variant_id: null,
    supplier_sku: null,
    supplier_cost_at_linking: null,
    last_ebay_sync_at: OBSERVED_AT,
    raw_payload: {},
    sync_generation: 7,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: OBSERVED_AT,
  }
}

function fixture() {
  const liveListings = Array.from({ length: 27 }, (_, index) =>
    liveListing(index))
  const registryRows = [
    registryRow(1, liveListings[0].itemId, "OLD-LIFECYCLE-SKU", "unknown"),
    registryRow(2, "910000000001", liveListings[1].sku),
    registryRow(3, "910000000002", liveListings[2].sku),
    ...Array.from({ length: 4 }, (_, index) => registryRow(
      index + 4,
      String(9_200_000_001 + index),
      `OLD-STALE-SKU-${index + 1}`,
    )),
  ]
  return { liveListings, registryRows }
}

function planningResult(inputFixture = fixture()) {
  const fingerprintInput = {
    accountKey: ACCOUNT_KEY,
    marketplaceId: "EBAY_US",
    liveListings: inputFixture.liveListings,
    registryRows: inputFixture.registryRows,
    syncKeyLookupStatus: "AVAILABLE",
    existingRegistrySyncKeys: [],
  }
  const capturedEvidenceFingerprint =
    buildEbayRegistryRepairEvidenceFingerprint(fingerprintInput)
  return buildEbayRegistryRepairPlanningResult({
    ...fingerprintInput,
    accountVerified: "YES",
    observedAt: OBSERVED_AT,
    capturedEvidenceFingerprint,
  })
}

function approval(result) {
  return {
    approvedPackageHandle: result.dryRun.DRY_RUN_PACKAGE_HANDLE,
    approvedEvidenceFingerprint: result.dryRun.CURRENT_EVIDENCE_FINGERPRINT,
    approvedCreateCount: 24,
    approvedStaleCount: 4,
    approvedHumanReviewCount: 3,
  }
}

function successDependencies(result, overrides = {}) {
  let rpcCalls = 0
  let postWriteCalls = 0
  const dependencies = {
    readCurrentPlanningResult: async () => result,
    invokeRpc: async (arguments_) => {
      rpcCalls += 1
      return {
        result_status: "APPLIED",
        create_inserted: arguments_.p_expected_create_count,
        stale_updated: arguments_.p_expected_stale_count,
        repair_updated: 0,
        human_review_mutated: 0,
      }
    },
    postWriteVerify: async () => {
      postWriteCalls += 1
      return { status: "OBSERVED" }
    },
    now: () => NOW,
    ...overrides,
  }
  return {
    dependencies,
    rpcCalls: () => rpcCalls,
    postWriteCalls: () => postWriteCalls,
  }
}

function cloneResult(result) {
  return structuredClone(result)
}

test("one classifier emits the canonical public DTO and private 24/4/3 plan", () => {
  const result = planningResult()
  assert.ok(result.executionPlan)
  assert.equal(result.dryRun.CREATE_NEW_COUNT, 24)
  assert.equal(result.dryRun.MARK_STALE_COUNT, 4)
  assert.equal(result.dryRun.HUMAN_REVIEW_COUNT, 3)
  assert.equal(result.executionPlan.createCandidates.length, 24)
  assert.equal(result.executionPlan.staleCandidates.length, 4)
  assert.equal(result.executionPlan.repairCandidates.length, 0)
  assert.equal(result.executionPlan.humanReviewCandidates.length, 3)
  assert.equal(result.executionPlan.evidenceFingerprint,
    result.dryRun.CURRENT_EVIDENCE_FINGERPRINT)
  assert.equal(result.executionPlan.packageHandle,
    result.dryRun.DRY_RUN_PACKAGE_HANDLE)
  assert.deepEqual(
    result.executionPlan.humanReviewCandidates.map((candidate) =>
      candidate.relationshipType).sort(),
    ["ITEM_ID_ONLY_LIFECYCLE", "SKU_ONLY", "SKU_ONLY"],
  )
  assert.equal(result.executionPlan.humanReviewCandidates.some(
    (candidate) => "rpcInput" in candidate || "membershipHandle" in candidate,
  ), false)
})

test("public DTO and Preview route expose no private action membership", () => {
  const result = planningResult()
  const serialized = JSON.stringify(result.dryRun)
  for (const candidate of result.executionPlan.createCandidates) {
    assert.equal(serialized.includes(candidate.rpcInput.ebay_item_id), false)
    assert.equal(serialized.includes(candidate.rpcInput.ebay_sku), false)
  }
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/monitor/seller-oauth-reauth/route.ts",
    import.meta.url,
  ), "utf8")
  assert.doesNotMatch(route,
    /executeApprovedRegistryRepairV1|apply_ebay_registry_repair_v1|executionPlan/)
})

test("CREATE and STALE materializers emit the exact RPC V1 schemas", () => {
  const result = planningResult()
  const create = result.executionPlan.createCandidates[0].rpcInput
  const stale = result.executionPlan.staleCandidates[0].rpcInput
  assert.deepEqual(Object.keys(create).sort(), [
    "account_key", "currency", "ebay_item_id", "ebay_price",
    "ebay_quantity", "ebay_sku", "last_ebay_sync_at", "raw_payload",
    "source", "sync_key", "title",
  ])
  assert.deepEqual(Object.keys(stale).sort(), [
    "account_key", "expected_ebay_item_id", "expected_ebay_sku",
    "expected_listing_status", "expected_source", "expected_sync_generation",
    "expected_sync_key", "expected_updated_at", "id",
  ])
  assert.equal(create.sync_key,
    `${create.source}:${ACCOUNT_KEY}:${create.ebay_item_id}`)
  const original = fixture().registryRows.find((row) => row.id === stale.id)
  assert.deepEqual(stale, {
    id: original.id,
    account_key: original.account_key,
    expected_source: original.source,
    expected_sync_key: original.sync_key,
    expected_listing_status: original.listing_status,
    expected_ebay_item_id: original.ebay_item_id,
    expected_ebay_sku: original.ebay_sku,
    expected_sync_generation: original.sync_generation,
    expected_updated_at: original.updated_at,
  })
})

test("duplicate mutable SKU remains executable because sync identity uses Item ID", () => {
  const inputFixture = fixture()
  inputFixture.liveListings[4].sku = inputFixture.liveListings[3].sku
  inputFixture.liveListings[4].customLabel = inputFixture.liveListings[3].sku
  const result = planningResult(inputFixture)
  assert.equal(result.dryRun.CREATE_NEW_COUNT, 24)
  assert.equal(result.executionPlan.createCandidates.length, 24)
  assert.equal(new Set(result.executionPlan.createCandidates.map(
    (candidate) => candidate.rpcInput.sync_key)).size, 24)
})

test("executor binds approval, calls the RPC mock once, and wires post-write verification", async () => {
  const result = planningResult()
  const context = successDependencies(result)
  const applied = await executeApprovedRegistryRepairV1WithDependencies(
    approval(result),
    context.dependencies,
  )
  assert.deepEqual(applied, {
    EXECUTION_STATUS: "APPLIED",
    RPC_INVOCATION_COUNT: 1,
    CREATE_COMMITTED: 24,
    STALE_COMMITTED: 4,
    REPAIR_COMMITTED: 0,
    HUMAN_REVIEW_MUTATED: 0,
    POST_WRITE_VERIFICATION_STATUS: "COMPLETED",
  })
  assert.equal(context.rpcCalls(), 1)
  assert.equal(context.postWriteCalls(), 1)
})

for (const [name, mutate, expectedCode] of [
  ["package mismatch", ({ approved }) => {
    approved.approvedPackageHandle = `rr_package_${"f".repeat(24)}`
  }, "CURRENT_STATE_NOT_APPROVABLE"],
  ["evidence state change", ({ approved }) => {
    approved.approvedEvidenceFingerprint = `rr_evidence_${"e".repeat(24)}`
  }, "CURRENT_STATE_NOT_APPROVABLE"],
  ["private count mismatch", ({ result }) => {
    result.executionPlan.createCandidates.pop()
  }, "ACTION_COUNT_MISMATCH"],
  ["human review overlap", ({ result }) => {
    result.executionPlan.humanReviewCandidates[0].candidateHandle =
      result.executionPlan.createCandidates[0].membershipHandle
  }, "HUMAN_REVIEW_EXCLUSION_FAILED"],
  ["unsafe materialized payload", ({ result }) => {
    result.executionPlan.createCandidates[0].rpcInput.raw_payload = {
      ...result.executionPlan.createCandidates[0].rpcInput.raw_payload,
      authorization: `Bearer ${"x".repeat(32)}`,
    }
  }, "CREATE_PAYLOAD_UNSAFE"],
]) {
  test(`${name} blocks before the RPC mock`, async () => {
    const result = cloneResult(planningResult())
    const approved = approval(result)
    mutate({ result, approved })
    const context = successDependencies(result)
    await assert.rejects(
      executeApprovedRegistryRepairV1WithDependencies(
        approved,
        context.dependencies,
      ),
      (error) => error instanceof EbayRegistryRepairExecutorError &&
        error.code === expectedCode,
    )
    assert.equal(context.rpcCalls(), 0)
    assert.equal(context.postWriteCalls(), 0)
  })
}

test("source contracts contain no live invocation or non-Registry writer path", () => {
  const source = readFileSync(new URL(
    "./ebay-registry-repair-executor.ts",
    import.meta.url,
  ), "utf8")
  assert.match(source, /^import "server-only"/)
  assert.equal((source.match(/"apply_ebay_registry_repair_v1"/g) ?? []).length, 1)
  assert.doesNotMatch(source, /ReviseItem|AddItem|EndItem|product.case|fulfillment/i)
})
