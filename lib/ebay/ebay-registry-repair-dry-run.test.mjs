import assert from "node:assert/strict"
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
  buildEbayRegistryRepairEvidenceFingerprint,
  buildEbayRegistryRepairDryRun,
  buildUnprovenEbayRegistryRepairDryRun,
  evaluateEbayRegistryRepairFutureWriteFreshness,
} = await import("./ebay-registry-repair-dry-run.ts")

const ACCOUNT_KEY = "seller-certified:fixture-fingerprint"
const OBSERVED_AT = "2026-08-11T16:00:00.000Z"

function liveListing(index) {
  return {
    itemId: String(400000000000 + index),
    sku: `LIVE-SKU-${index + 1}`,
    customLabel: `LIVE-SKU-${index + 1}`,
    variationKey: null,
    title: `Protected listing ${index + 1}`,
    listingState: "ACTIVE",
    listingFormat: "FixedPriceItem",
    startTime: "2026-07-01T00:00:00.000Z",
    availableQuantity: 5,
    price: 19.99,
    currency: "USD",
    marketplaceSite: "US",
    marketplaceCertification: {
      status: "US_CERTIFIED",
      source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
      observedAt: OBSERVED_AT,
    },
    identityAmbiguous: false,
    source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
    observedAt: OBSERVED_AT,
  }
}

function registryRow({ id, itemId, sku }) {
  return {
    id,
    account_key: ACCOUNT_KEY,
    source: "EBAY_INVENTORY_API",
    ebay_item_id: itemId,
    ebay_sku: sku,
    ebay_variation_key: null,
    listing_status: "active",
    title: "Registry title not returned",
    ebay_quantity: null,
    ebay_price: null,
    currency: "USD",
    market_radar_product_id: null,
    supplier_variant_id: null,
    supplier_sku: null,
    supplier_cost_at_linking: null,
    last_ebay_sync_at: "2026-08-10T12:00:00.000Z",
    raw_payload: { marker: "RAW_MARKER_MUST_NOT_ESCAPE" },
    sync_generation: 7,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-08-10T12:00:00.000Z",
  }
}

function certifiedFixture() {
  const liveListings = Array.from({ length: 26 }, (_, index) =>
    liveListing(index))
  const registryRows = [
    registryRow({
      id: "registry-repair",
      itemId: liveListings[0].itemId,
      sku: "STALE-REGISTRY-SKU",
    }),
    registryRow({
      id: "registry-review-1",
      itemId: "910000000001",
      sku: liveListings[1].sku,
    }),
    registryRow({
      id: "registry-review-2",
      itemId: "910000000002",
      sku: liveListings[2].sku,
    }),
    ...Array.from({ length: 4 }, (_, index) => registryRow({
      id: `registry-stale-${index + 1}`,
      itemId: String(920000000001 + index),
      sku: `OLD-REGISTRY-SKU-${index + 1}`,
    })),
  ]
  return { liveListings, registryRows }
}

function build(fixture = certifiedFixture(), options = {}) {
  const input = {
    accountKey: ACCOUNT_KEY,
    accountVerified: "YES",
    marketplaceId: "EBAY_US",
    observedAt: OBSERVED_AT,
    liveListings: fixture.liveListings,
    registryRows: fixture.registryRows,
  }
  const capturedEvidenceFingerprint = Object.hasOwn(
    options,
    "capturedEvidenceFingerprint",
  )
    ? options.capturedEvidenceFingerprint
    : buildEbayRegistryRepairEvidenceFingerprint(input)
  return buildEbayRegistryRepairDryRun({
    ...input,
    capturedEvidenceFingerprint,
  })
}

test("certified 26-to-7 evidence produces only the safe dry-run tranche", () => {
  const result = build()
  assert.equal(result.REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.CREATE_NEW_COUNT, 23)
  assert.equal(result.MARK_STALE_COUNT, 4)
  assert.equal(result.HUMAN_REVIEW_COUNT, 2)
  assert.equal(result.REPAIR_PRECONDITION_STATUS, "PASS")
  assert.equal(result.CREATE_PRECONDITION_STATUS, "PASS")
  assert.equal(result.STALE_PRECONDITION_STATUS, "PASS")
  assert.deepEqual([
    result.LIVE_ALREADY_MATCHED_COUNT,
    result.LIVE_REPAIR_EXISTING_COUNT,
    result.LIVE_CREATE_NEW_COUNT,
    result.LIVE_HUMAN_REVIEW_COUNT,
    result.LIVE_UNPROVEN_COUNT,
  ], [0, 1, 23, 2, 0])
  assert.deepEqual([
    result.REGISTRY_KEEP_CURRENT_COUNT,
    result.REGISTRY_REPAIR_EXISTING_COUNT,
    result.REGISTRY_MARK_STALE_COUNT,
    result.REGISTRY_MARK_HISTORICAL_COUNT,
    result.REGISTRY_HUMAN_REVIEW_COUNT,
    result.REGISTRY_UNPROVEN_COUNT,
  ], [0, 1, 4, 0, 2, 0])
  assert.equal(result.LIVE_DRY_RUN_PARTITION_VALID, "YES")
  assert.equal(result.REGISTRY_DRY_RUN_PARTITION_VALID, "YES")
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "YES")
  assert.equal(result.CURRENT_LIVE_COUNT, 26)
  assert.equal(result.CURRENT_REGISTRY_COUNT, 7)
  assert.match(result.CURRENT_EVIDENCE_FINGERPRINT,
    /^rr_evidence_[a-f0-9]{24}$/)
  assert.equal(result.DRY_RUN_FRESHNESS_STATUS, "CURRENT")
  assert.equal(result.DRY_RUN_REJECTION_REASON, null)
  assert.equal(result.AMBIGUITY_CLASS, "REVIEWABLE_ONLY")
  assert.equal(result.UNPROVEN_COMPONENT, "NONE")
  assert.equal(result.UNPROVEN_COUNT, 0)
  assert.equal(result.REPAIR_EXISTING_UNPROVEN_COUNT, 0)
  assert.equal(result.MARK_STALE_UNPROVEN_COUNT, 0)
  assert.equal(result.CREATE_NEW_UNPROVEN_COUNT, 0)
  assert.equal(result.HUMAN_REVIEW_UNPROVEN_COUNT, 0)
  assert.equal(result.IDENTITY_PARTITION_UNPROVEN_COUNT, 0)
  assert.equal(result.UNPROVEN_REPAIR_EXISTING_COUNT, 0)
  assert.equal(result.UNPROVEN_MARK_STALE_COUNT, 0)
  assert.equal(result.UNPROVEN_CREATE_NEW_COUNT, 0)
  assert.equal(result.UNPROVEN_HUMAN_REVIEW_COUNT, 0)
  assert.equal(result.UNPROVEN_IDENTITY_PARTITION_COUNT, 0)
  assert.equal(result.UNPROVEN_TOTAL_COUNT, 0)
  assert.equal(result.UNPROVEN_STATE_GUARD_COUNT, 0)
  assert.equal(result.UNPROVEN_SOURCE_READ_COUNT, 0)
  assert.equal(result.UNPROVEN_OTHER_COUNT, 0)
  assert.equal(result.BLOCKING_UNPROVEN_PRIMARY_SOURCE, "NONE")
  assert.deepEqual(result.BLOCKING_UNPROVEN_SECONDARY_SOURCES, [])
  assert.deepEqual([
    result.RAW_ALREADY_MATCHED_COUNT,
    result.RAW_REPAIR_EXISTING_COUNT,
    result.RAW_CREATE_NEW_COUNT,
    result.RAW_HUMAN_REVIEW_COUNT,
    result.RAW_UNPROVEN_COUNT,
  ], [0, 1, 23, 2, 0])
  assert.deepEqual([
    result.RAW_KEEP_CURRENT_COUNT,
    result.RAW_REPAIR_EXISTING_REGISTRY_COUNT,
    result.RAW_MARK_STALE_COUNT,
    result.RAW_MARK_HISTORICAL_COUNT,
    result.RAW_HUMAN_REVIEW_REGISTRY_COUNT,
    result.RAW_UNPROVEN_REGISTRY_COUNT,
  ], [0, 1, 4, 0, 2, 0])
  assert.equal(result.LIVE_RAW_PARTITION_VALID, "YES")
  assert.equal(result.REGISTRY_RAW_PARTITION_VALID, "YES")
  assert.deepEqual([
    result.UNPROVEN_REASON_MISSING_AUTHORITATIVE_ITEM_ID,
    result.UNPROVEN_REASON_DUPLICATE_ITEM_ID,
    result.UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES,
    result.UNPROVEN_REASON_CROSS_LINK_CONFLICT,
    result.UNPROVEN_REASON_ACCOUNT_SCOPE,
    result.UNPROVEN_REASON_PARTITION_OVERLAP,
    result.UNPROVEN_REASON_SOURCE_EVIDENCE,
    result.UNPROVEN_REASON_OTHER,
  ], [0, 0, 0, 0, 0, 0, 0, 0])
  assert.equal(result.UNPROVEN_PRIMARY_REASON, "NONE")
  assert.equal(result.DRY_RUN_STALE_LABEL,
    "DRY RUN CURRENT — LIVE RECHECK REQUIRED BEFORE WRITE")
  assert.equal(result.DRY_RUN_STATE_BOUND, "YES")
  assert.equal(result.DRY_RUN_STATE_FINGERPRINT_PRESENT, "YES")
  assert.equal(result.APPROVAL_INVALIDATES_ON_EBAY_STATE_CHANGE, "YES")
  assert.equal(result.APPROVAL_INVALIDATES_ON_REGISTRY_STATE_CHANGE, "YES")
  assert.equal(result.EXPECTED_MATCHED_AFTER_SAFE_TRANCHE, 24)
  assert.equal(result.EXPECTED_LIVE_COUNT, 26)
  assert.equal(result.EXPECTED_PENDING_HUMAN_REVIEW, 2)
  assert.equal(result.EXPECTED_COVERAGE_PERCENT, 92.31)
  assert.deepEqual(result.REPAIR_FIELDS_TO_CHANGE, ["ebay_sku"])
  assert.deepEqual(result.STALE_FIELDS_TO_CHANGE, ["listing_status"])
  assert.ok(!result.CREATE_FIELDS_TO_POPULATE.includes("market_radar_product_id"))
  assert.equal(result.STALE_STATE_GUARD_SUPPORTED, "YES")
})

test("SKU equality is human review only and never relink or create authority", () => {
  const result = build()
  assert.equal(result.HUMAN_REVIEW_CANDIDATES.length, 2)
  for (const candidate of result.HUMAN_REVIEW_CANDIDATES) {
    assert.equal(candidate.RELATIONSHIP_TYPE, "SKU_ONLY")
    assert.equal(candidate.REGISTRY_ITEM_ID_CURRENTLY_LIVE, "NO")
    assert.equal(candidate.SKU_UNIQUE_BOTH_SIDES, "YES")
    assert.equal(candidate.COMPETING_REGISTRY_RELATION, "NO")
    assert.equal(candidate.RECOMMENDED_ACTION, "REVIEW_REQUIRED")
    assert.match(candidate.CANDIDATE_HANDLE, /^rr_review_[a-f0-9]{24}$/)
  }
  assert.equal(result.REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.CREATE_NEW_COUNT, 23)
  assert.equal(result.AMBIGUITY_CLASS, "REVIEWABLE_ONLY")
  assert.equal(result.DRY_RUN_REJECTION_REASON, null)
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "YES")
})

test("an isolated unique SKU-only relationship is reviewable, not blocking", () => {
  const live = liveListing(80)
  const reviewRow = registryRow({
    id: "registry-review-isolated",
    itemId: "930000000080",
    sku: live.sku,
  })
  delete reviewRow.sync_generation
  const result = build({
    liveListings: [live],
    registryRows: [reviewRow],
  })
  assert.equal(result.HUMAN_REVIEW_COUNT, 1)
  assert.equal(result.LIVE_HUMAN_REVIEW_COUNT, 1)
  assert.equal(result.REGISTRY_HUMAN_REVIEW_COUNT, 1)
  assert.equal(result.LIVE_UNPROVEN_COUNT, 0)
  assert.equal(result.REGISTRY_UNPROVEN_COUNT, 0)
  assert.equal(result.CREATE_NEW_COUNT, 0)
  assert.equal(result.AMBIGUITY_CLASS, "REVIEWABLE_ONLY")
  assert.equal(result.DRY_RUN_REJECTION_REASON, null)
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "YES")
  assert.equal(result.STALE_STATE_GUARD_SUPPORTED, "YES")
  assert.equal(result.UNPROVEN_COMPONENT, "NONE")
  assert.equal(result.HUMAN_REVIEW_UNPROVEN_COUNT, 0)
  assert.equal(result.HUMAN_REVIEW_UNPROVEN_SOURCE, "NONE")
})

test("repair identity remains partitioned when its existing-row CAS is absent", () => {
  const fixture = certifiedFixture()
  delete fixture.registryRows[0].sync_generation
  const result = build(fixture)
  assert.equal(result.REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.LIVE_REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.REGISTRY_REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.LIVE_UNPROVEN_COUNT, 0)
  assert.equal(result.REGISTRY_UNPROVEN_COUNT, 0)
  assert.equal(result.REPAIR_PRECONDITION_STATUS, "UNPROVEN")
  assert.equal(result.REPAIR_EXISTING_UNPROVEN_COUNT, 1)
  assert.equal(result.REPAIR_EXISTING_UNPROVEN_SOURCE, "EXISTING_ROW_CAS")
  assert.equal(result.UNPROVEN_COMPONENT, "REPAIR_EXISTING_MUTATION_GUARD")
  assert.equal(result.UNPROVEN_COUNT, 1)
  assert.equal(result.UNPROVEN_REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.UNPROVEN_TOTAL_COUNT, 1)
  assert.equal(result.BLOCKING_UNPROVEN_PRIMARY_SOURCE, "REPAIR_EXISTING")
  assert.deepEqual(result.BLOCKING_UNPROVEN_SECONDARY_SOURCES, [])
  assert.equal(result.AMBIGUITY_CLASS, "REVIEWABLE_ONLY")
  assert.equal(result.DRY_RUN_REJECTION_REASON, "PRECONDITION_UNPROVEN")
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
})

test("stale identity remains partitioned when its existing-row CAS is absent", () => {
  const fixture = certifiedFixture()
  delete fixture.registryRows[3].sync_generation
  const result = build(fixture)
  assert.equal(result.MARK_STALE_COUNT, 4)
  assert.equal(result.REGISTRY_MARK_STALE_COUNT, 4)
  assert.equal(result.REGISTRY_UNPROVEN_COUNT, 0)
  assert.equal(result.STALE_PRECONDITION_STATUS, "UNPROVEN")
  assert.equal(result.MARK_STALE_UNPROVEN_COUNT, 1)
  assert.equal(result.MARK_STALE_UNPROVEN_SOURCE, "EXISTING_ROW_CAS")
  assert.equal(result.UNPROVEN_COMPONENT, "MARK_STALE_MUTATION_GUARD")
  assert.equal(result.UNPROVEN_COUNT, 1)
  assert.equal(result.UNPROVEN_MARK_STALE_COUNT, 1)
  assert.equal(result.UNPROVEN_TOTAL_COUNT, 1)
  assert.equal(result.BLOCKING_UNPROVEN_PRIMARY_SOURCE, "MARK_STALE")
  assert.equal(result.AMBIGUITY_CLASS, "REVIEWABLE_ONLY")
  assert.equal(result.DRY_RUN_REJECTION_REASON, "PRECONDITION_UNPROVEN")
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
})

test("create readiness uses absence and uniqueness, never existing-row CAS", () => {
  const first = liveListing(85)
  const second = {
    ...liveListing(86),
    sku: first.sku,
    customLabel: first.sku,
  }
  const result = build({
    liveListings: [first, second],
    registryRows: [],
  })
  assert.equal(result.CREATE_NEW_COUNT, 0)
  assert.equal(result.CREATE_PRECONDITION_STATUS, "UNPROVEN")
  assert.equal(result.CREATE_NEW_UNPROVEN_COUNT, 2)
  assert.equal(result.CREATE_NEW_UNPROVEN_SOURCE,
    "ABSENCE_OR_UNIQUENESS_GUARD")
  assert.equal(result.UNPROVEN_COMPONENT,
    "CREATE_NEW_ABSENCE_OR_UNIQUENESS_GUARD")
  assert.equal(result.UNPROVEN_COUNT, 2)
  assert.equal(result.UNPROVEN_CREATE_NEW_COUNT, 2)
  assert.equal(result.UNPROVEN_TOTAL_COUNT, 2)
  assert.equal(result.BLOCKING_UNPROVEN_PRIMARY_SOURCE, "CREATE_NEW")
  assert.equal(result.AMBIGUITY_CLASS, "NONE")
  assert.equal(result.DRY_RUN_REJECTION_REASON, "PRECONDITION_UNPROVEN")
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
})

test("unsafe human-review evidence is diagnosed without a mutation CAS", () => {
  const live = liveListing(87)
  const row = registryRow({
    id: "registry-review-evidence-unproven",
    itemId: "930000000087",
    sku: live.sku,
  })
  row.account_key = "different-account-scope"
  const result = build({ liveListings: [live], registryRows: [row] })
  assert.equal(result.HUMAN_REVIEW_COUNT, 0)
  assert.equal(result.HUMAN_REVIEW_UNPROVEN_COUNT, 1)
  assert.equal(result.HUMAN_REVIEW_UNPROVEN_SOURCE, "REVIEW_EVIDENCE")
  assert.equal(result.UNPROVEN_COMPONENT, "HUMAN_REVIEW_EVIDENCE")
  assert.equal(result.UNPROVEN_HUMAN_REVIEW_COUNT, 1)
  assert.equal(result.UNPROVEN_TOTAL_COUNT, 1)
  assert.equal(result.BLOCKING_UNPROVEN_PRIMARY_SOURCE, "HUMAN_REVIEW")
  assert.equal(result.AMBIGUITY_CLASS, "BLOCKING_UNPROVEN")
  assert.equal(result.DRY_RUN_REJECTION_REASON, "AMBIGUOUS_IDENTITY")
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
})

test("multiple live Item ID candidates are blocking ambiguity", () => {
  const first = liveListing(90)
  const second = {
    ...liveListing(91),
    itemId: first.itemId,
  }
  const result = build({
    liveListings: [first, second],
    registryRows: [registryRow({
      id: "registry-multiple-item-candidates",
      itemId: first.itemId,
      sku: "STALE-MULTIPLE-CANDIDATE-SKU",
    })],
  })
  assert.equal(result.AMBIGUITY_CLASS, "BLOCKING_MULTIPLE_CANDIDATES")
  assert.equal(result.DRY_RUN_REJECTION_REASON, "AMBIGUOUS_IDENTITY")
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
  assert.ok(result.UNPROVEN_IDENTITY_PARTITION_COUNT > 0)
  assert.equal(result.BLOCKING_UNPROVEN_PRIMARY_SOURCE,
    "IDENTITY_PARTITION")
})

test("multiple unproven action guards expose ordered safe provenance", () => {
  const fixture = certifiedFixture()
  delete fixture.registryRows[0].sync_generation
  delete fixture.registryRows[3].sync_generation
  const result = build(fixture)
  assert.equal(result.UNPROVEN_REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.UNPROVEN_MARK_STALE_COUNT, 1)
  assert.equal(result.UNPROVEN_TOTAL_COUNT, 2)
  assert.equal(result.UNPROVEN_COMPONENT, "MULTIPLE_COMPONENTS")
  assert.equal(result.BLOCKING_UNPROVEN_PRIMARY_SOURCE, "REPAIR_EXISTING")
  assert.deepEqual(result.BLOCKING_UNPROVEN_SECONDARY_SOURCES,
    ["MARK_STALE"])
})

test("cross-linked Item ID and SKU evidence is blocking ambiguity", () => {
  const first = liveListing(100)
  const second = liveListing(101)
  const result = build({
    liveListings: [first, second],
    registryRows: [registryRow({
      id: "registry-cross-link",
      itemId: first.itemId,
      sku: second.sku,
    })],
  })
  assert.equal(result.AMBIGUITY_CLASS, "BLOCKING_CROSS_LINK")
  assert.equal(result.DRY_RUN_REJECTION_REASON, "AMBIGUOUS_IDENTITY")
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
})

test("duplicate Registry Item ID authority is blocking ambiguity", () => {
  const live = liveListing(105)
  const duplicateItemId = "930000000105"
  const result = build({
    liveListings: [live],
    registryRows: [
      registryRow({
        id: "registry-duplicate-authority-1",
        itemId: duplicateItemId,
        sku: "STALE-DUPLICATE-SKU-1",
      }),
      registryRow({
        id: "registry-duplicate-authority-2",
        itemId: duplicateItemId,
        sku: "STALE-DUPLICATE-SKU-2",
      }),
    ],
  })
  assert.equal(result.AMBIGUITY_CLASS, "BLOCKING_DUPLICATE_AUTHORITY")
  assert.equal(result.DRY_RUN_REJECTION_REASON, "AMBIGUOUS_IDENTITY")
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
})

test("competing Registry references are a blocking partition conflict", () => {
  const live = liveListing(110)
  const result = build({
    liveListings: [live],
    registryRows: [
      registryRow({
        id: "registry-partition-item",
        itemId: live.itemId,
        sku: "STALE-PARTITION-SKU",
      }),
      registryRow({
        id: "registry-partition-sku",
        itemId: "930000000110",
        sku: live.sku,
      }),
    ],
  })
  assert.equal(result.AMBIGUITY_CLASS, "BLOCKING_PARTITION_CONFLICT")
  assert.equal(result.DRY_RUN_REJECTION_REASON, "AMBIGUOUS_IDENTITY")
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
})

test("new identity ambiguity makes the package unproven and not approvable", () => {
  const fixture = certifiedFixture()
  fixture.liveListings[0] = {
    ...fixture.liveListings[0],
    identityAmbiguous: true,
  }
  const result = build(fixture)
  assert.equal(result.REPAIR_EXISTING_COUNT, 0)
  assert.equal(result.REPAIR_PRECONDITION_STATUS, "PASS")
  assert.equal(result.LIVE_UNPROVEN_COUNT, 1)
  assert.equal(result.REGISTRY_UNPROVEN_COUNT, 1)
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
  assert.equal(result.DRY_RUN_REJECTION_REASON, "AMBIGUOUS_IDENTITY")
  assert.equal(result.AMBIGUITY_CLASS, "BLOCKING_UNPROVEN")
  assert.equal(result.UNPROVEN_COMPONENT, "IDENTITY_PARTITION")
  assert.ok(result.IDENTITY_PARTITION_UNPROVEN_COUNT > 0)
})

test("raw unresolved marketplace evidence explains all 27 live failures", () => {
  const fixture = certifiedFixture()
  fixture.liveListings.push({
    ...fixture.liveListings[25],
    itemId: "500000000027",
    sku: "LIVE-NEW-024",
    customLabel: "LIVE-NEW-024",
  })
  fixture.liveListings = fixture.liveListings.map((listing) => ({
    ...listing,
    marketplaceCertification: {
      status: "UNRESOLVED",
      source: null,
      observedAt: null,
    },
  }))
  const result = build(fixture)
  assert.equal(result.CURRENT_LIVE_COUNT, 27)
  assert.deepEqual([
    result.RAW_ALREADY_MATCHED_COUNT,
    result.RAW_REPAIR_EXISTING_COUNT,
    result.RAW_CREATE_NEW_COUNT,
    result.RAW_HUMAN_REVIEW_COUNT,
    result.RAW_UNPROVEN_COUNT,
  ], [0, 0, 0, 0, 27])
  assert.deepEqual([
    result.RAW_KEEP_CURRENT_COUNT,
    result.RAW_REPAIR_EXISTING_REGISTRY_COUNT,
    result.RAW_MARK_STALE_COUNT,
    result.RAW_MARK_HISTORICAL_COUNT,
    result.RAW_HUMAN_REVIEW_REGISTRY_COUNT,
    result.RAW_UNPROVEN_REGISTRY_COUNT,
  ], [0, 0, 4, 0, 0, 3])
  assert.equal(result.LIVE_RAW_PARTITION_VALID, "YES")
  assert.equal(result.REGISTRY_RAW_PARTITION_VALID, "YES")
  assert.equal(result.UNPROVEN_REASON_SOURCE_EVIDENCE, 27)
  assert.equal(result.UNPROVEN_PRIMARY_REASON, "SOURCE_EVIDENCE")
  const reasonTotal = [
    result.UNPROVEN_REASON_MISSING_AUTHORITATIVE_ITEM_ID,
    result.UNPROVEN_REASON_DUPLICATE_ITEM_ID,
    result.UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES,
    result.UNPROVEN_REASON_CROSS_LINK_CONFLICT,
    result.UNPROVEN_REASON_ACCOUNT_SCOPE,
    result.UNPROVEN_REASON_PARTITION_OVERLAP,
    result.UNPROVEN_REASON_SOURCE_EVIDENCE,
    result.UNPROVEN_REASON_OTHER,
  ].reduce((total, count) => total + count, 0)
  assert.equal(reasonTotal, result.RAW_UNPROVEN_COUNT)
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
})

test("current counts and safe-tranche expectations are recomputed dynamically", () => {
  const fixture = certifiedFixture()
  fixture.liveListings.pop()
  fixture.registryRows.pop()
  const result = build(fixture)
  assert.equal(result.CURRENT_LIVE_COUNT, 25)
  assert.equal(result.CURRENT_REGISTRY_COUNT, 6)
  assert.equal(result.CREATE_NEW_COUNT, 22)
  assert.equal(result.MARK_STALE_COUNT, 3)
  assert.equal(result.CREATE_PRECONDITION_STATUS, "PASS")
  assert.equal(result.EXPECTED_MATCHED_AFTER_SAFE_TRANCHE, 23)
  assert.equal(result.EXPECTED_LIVE_COUNT, 25)
  assert.equal(result.EXPECTED_PENDING_HUMAN_REVIEW, 2)
  assert.equal(result.EXPECTED_COVERAGE_PERCENT, 92)
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "YES")
})

test("current 27-to-7 evidence derives the refreshed mutually exclusive plan", () => {
  const fixture = certifiedFixture()
  fixture.liveListings.push({
    ...fixture.liveListings[25],
    itemId: "500000000027",
    sku: "LIVE-NEW-024",
    customLabel: "LIVE-NEW-024",
  })
  const result = build(fixture)
  assert.equal(result.CURRENT_LIVE_COUNT, 27)
  assert.equal(result.CURRENT_REGISTRY_COUNT, 7)
  assert.equal(result.LIVE_ALREADY_MATCHED_COUNT, 0)
  assert.equal(result.LIVE_REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.LIVE_CREATE_NEW_COUNT, 24)
  assert.equal(result.LIVE_HUMAN_REVIEW_COUNT, 2)
  assert.equal(result.LIVE_UNPROVEN_COUNT, 0)
  assert.equal(result.LIVE_DRY_RUN_PARTITION_VALID, "YES")
  assert.equal(result.REGISTRY_KEEP_CURRENT_COUNT, 0)
  assert.equal(result.REGISTRY_REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.REGISTRY_MARK_STALE_COUNT, 4)
  assert.equal(result.REGISTRY_MARK_HISTORICAL_COUNT, 0)
  assert.equal(result.REGISTRY_HUMAN_REVIEW_COUNT, 2)
  assert.equal(result.REGISTRY_UNPROVEN_COUNT, 0)
  assert.equal(result.REGISTRY_DRY_RUN_PARTITION_VALID, "YES")
  assert.equal(result.REPAIR_PRECONDITION_STATUS, "PASS")
  assert.equal(result.CREATE_PRECONDITION_STATUS, "PASS")
  assert.equal(result.STALE_PRECONDITION_STATUS, "PASS")
  assert.equal(result.EXPECTED_MATCHED_AFTER_SAFE_TRANCHE, 25)
  assert.equal(result.EXPECTED_LIVE_COUNT, 27)
  assert.equal(result.EXPECTED_PENDING_HUMAN_REVIEW, 2)
  assert.equal(result.EXPECTED_COVERAGE_PERCENT, 92.59)
  assert.equal(result.RAW_CREATE_NEW_COUNT, 24)
  assert.equal(result.RAW_UNPROVEN_COUNT, 0)
  assert.equal(result.UNPROVEN_PRIMARY_REASON, "NONE")
  assert.equal(result.AMBIGUITY_CLASS, "REVIEWABLE_ONLY")
  assert.equal(result.DRY_RUN_REJECTION_REASON, null)
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "YES")
})

test("each preview recomputes changed evidence without comparing prior preview state", () => {
  const fixture = certifiedFixture()
  const first = build(fixture)

  fixture.liveListings[25] = {
    ...fixture.liveListings[25],
    itemId: "499999999999",
    sku: "LIVE-SKU-CHANGED",
    customLabel: "LIVE-SKU-CHANGED",
  }
  fixture.liveListings.push({
    ...fixture.liveListings[25],
    itemId: "499999999998",
    sku: "LIVE-SKU-ADDED",
    customLabel: "LIVE-SKU-ADDED",
  })
  const refreshed = build(fixture)
  assert.notEqual(refreshed.CURRENT_EVIDENCE_FINGERPRINT,
    first.CURRENT_EVIDENCE_FINGERPRINT)
  assert.notEqual(refreshed.DRY_RUN_PACKAGE_HANDLE,
    first.DRY_RUN_PACKAGE_HANDLE)
  assert.equal(refreshed.CURRENT_LIVE_COUNT, 27)
  assert.equal(refreshed.CREATE_NEW_COUNT, 24)
  assert.equal(refreshed.DRY_RUN_FRESHNESS_STATUS, "CURRENT")
  assert.equal(refreshed.DRY_RUN_REJECTION_REASON, null)
  assert.equal(refreshed.REPAIR_PRECONDITION_STATUS, "PASS")
  assert.equal(refreshed.CREATE_PRECONDITION_STATUS, "PASS")
  assert.equal(refreshed.STALE_PRECONDITION_STATUS, "PASS")
  assert.equal(refreshed.DRY_RUN_READY_FOR_APPROVAL, "YES")
})

test("same-request fingerprint inconsistency fails closed", () => {
  const result = build(certifiedFixture(), {
    capturedEvidenceFingerprint: "rr_evidence_000000000000000000000000",
  })
  assert.equal(result.DRY_RUN_FRESHNESS_STATUS, "UNPROVEN")
  assert.equal(result.DRY_RUN_STALE_LABEL, "UNPROVEN")
  assert.equal(result.DRY_RUN_STATE_BOUND, "NO")
  assert.equal(result.DRY_RUN_REJECTION_REASON,
    "STATE_CHANGED_DURING_SAME_REQUEST")
  assert.equal(result.REPAIR_PRECONDITION_STATUS, "UNPROVEN")
  assert.equal(result.CREATE_PRECONDITION_STATUS, "UNPROVEN")
  assert.equal(result.STALE_PRECONDITION_STATUS, "UNPROVEN")
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
})

test("evidence fingerprint is order independent and exact-state bound", () => {
  const fixture = certifiedFixture()
  const first = build(fixture)
  const reordered = build({
    liveListings: [...fixture.liveListings].reverse(),
    registryRows: [...fixture.registryRows].reverse(),
  })
  assert.equal(first.CURRENT_EVIDENCE_FINGERPRINT,
    reordered.CURRENT_EVIDENCE_FINGERPRINT)
  assert.equal(first.DRY_RUN_PACKAGE_HANDLE, reordered.DRY_RUN_PACKAGE_HANDLE)

  const changedGuard = certifiedFixture()
  changedGuard.registryRows[0] = {
    ...changedGuard.registryRows[0],
    sync_generation: 8,
  }
  const changed = build(changedGuard)
  assert.notEqual(first.CURRENT_EVIDENCE_FINGERPRINT,
    changed.CURRENT_EVIDENCE_FINGERPRINT)
  assert.equal(changed.DRY_RUN_FRESHNESS_STATUS, "CURRENT")
  assert.equal(changed.DRY_RUN_READY_FOR_APPROVAL, "YES")

  const staleFutureWrite = evaluateEbayRegistryRepairFutureWriteFreshness({
    reviewedEvidenceFingerprint: first.CURRENT_EVIDENCE_FINGERPRINT,
    currentEvidenceFingerprint: changed.CURRENT_EVIDENCE_FINGERPRINT,
  })
  assert.equal(staleFutureWrite.DRY_RUN_FRESHNESS_STATUS, "STALE")
  assert.equal(staleFutureWrite.WRITE_STATE_STATUS, "STALE")
  assert.equal(staleFutureWrite.WRITE_ALLOWED, "NO")
  assert.equal(staleFutureWrite.REFRESH_REQUIRED, "YES")
  assert.equal(staleFutureWrite.DRY_RUN_STALE_LABEL,
    "DRY RUN STALE — REFRESH REQUIRED")
  assert.equal(staleFutureWrite.FUTURE_WRITE_REJECTION_REASON,
    "FUTURE_WRITE_EVIDENCE_STALE")

  const currentFutureWrite = evaluateEbayRegistryRepairFutureWriteFreshness({
    reviewedEvidenceFingerprint: first.CURRENT_EVIDENCE_FINGERPRINT,
    currentEvidenceFingerprint: first.CURRENT_EVIDENCE_FINGERPRINT,
  })
  assert.equal(currentFutureWrite.DRY_RUN_FRESHNESS_STATUS, "CURRENT")
  assert.equal(currentFutureWrite.WRITE_STATE_STATUS, "CURRENT")
  assert.equal(currentFutureWrite.WRITE_ALLOWED, "YES")
  assert.equal(currentFutureWrite.REFRESH_REQUIRED, "NO")
  assert.equal(currentFutureWrite.FUTURE_WRITE_REJECTION_REASON, "NONE")

  const unavailableFutureWrite =
    evaluateEbayRegistryRepairFutureWriteFreshness({
      reviewedEvidenceFingerprint: "UNPROVEN",
      currentEvidenceFingerprint: changed.CURRENT_EVIDENCE_FINGERPRINT,
    })
  assert.equal(unavailableFutureWrite.WRITE_STATE_STATUS, "UNPROVEN")
  assert.equal(unavailableFutureWrite.WRITE_ALLOWED, "NO")
  assert.equal(unavailableFutureWrite.REFRESH_REQUIRED, "YES")
})

test("unavailable runtime evidence remains UNPROVEN instead of synthetic zero", () => {
  const result = buildUnprovenEbayRegistryRepairDryRun()
  for (const key of [
    "CURRENT_LIVE_COUNT",
    "CURRENT_REGISTRY_COUNT",
    "REPAIR_EXISTING_COUNT",
    "CREATE_NEW_COUNT",
    "MARK_STALE_COUNT",
    "HUMAN_REVIEW_COUNT",
    "LIVE_UNPROVEN_COUNT",
    "REGISTRY_UNPROVEN_COUNT",
  ]) {
    assert.equal(result[key], "UNPROVEN")
  }
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
  assert.equal(result.CURRENT_EVIDENCE_FINGERPRINT, "UNPROVEN")
  assert.equal(result.DRY_RUN_FRESHNESS_STATUS, "UNPROVEN")
  assert.equal(result.DRY_RUN_REJECTION_REASON, "UNPROVEN")
  assert.equal(result.AMBIGUITY_CLASS, "BLOCKING_UNPROVEN")
  assert.equal(result.UNPROVEN_COMPONENT, "EVIDENCE_UNAVAILABLE")
  assert.equal(result.UNPROVEN_COUNT, "UNPROVEN")
  assert.equal(result.UNPROVEN_REPAIR_EXISTING_COUNT, "UNPROVEN")
  assert.equal(result.UNPROVEN_MARK_STALE_COUNT, "UNPROVEN")
  assert.equal(result.UNPROVEN_CREATE_NEW_COUNT, "UNPROVEN")
  assert.equal(result.UNPROVEN_HUMAN_REVIEW_COUNT, "UNPROVEN")
  assert.equal(result.UNPROVEN_IDENTITY_PARTITION_COUNT, "UNPROVEN")
  assert.equal(result.UNPROVEN_TOTAL_COUNT, "UNPROVEN")
  assert.equal(result.UNPROVEN_STATE_GUARD_COUNT, "UNPROVEN")
  assert.equal(result.UNPROVEN_SOURCE_READ_COUNT, "UNPROVEN")
  assert.equal(result.UNPROVEN_OTHER_COUNT, "UNPROVEN")
  assert.equal(result.BLOCKING_UNPROVEN_PRIMARY_SOURCE, "SOURCE_READ")
  assert.deepEqual(result.BLOCKING_UNPROVEN_SECONDARY_SOURCES, [])
  for (const key of [
    "RAW_ALREADY_MATCHED_COUNT",
    "RAW_REPAIR_EXISTING_COUNT",
    "RAW_CREATE_NEW_COUNT",
    "RAW_HUMAN_REVIEW_COUNT",
    "RAW_UNPROVEN_COUNT",
    "RAW_KEEP_CURRENT_COUNT",
    "RAW_REPAIR_EXISTING_REGISTRY_COUNT",
    "RAW_MARK_STALE_COUNT",
    "RAW_MARK_HISTORICAL_COUNT",
    "RAW_HUMAN_REVIEW_REGISTRY_COUNT",
    "RAW_UNPROVEN_REGISTRY_COUNT",
    "UNPROVEN_REASON_MISSING_AUTHORITATIVE_ITEM_ID",
    "UNPROVEN_REASON_DUPLICATE_ITEM_ID",
    "UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES",
    "UNPROVEN_REASON_CROSS_LINK_CONFLICT",
    "UNPROVEN_REASON_ACCOUNT_SCOPE",
    "UNPROVEN_REASON_PARTITION_OVERLAP",
    "UNPROVEN_REASON_SOURCE_EVIDENCE",
    "UNPROVEN_REASON_OTHER",
  ]) {
    assert.equal(result[key], "UNPROVEN")
  }
  assert.equal(result.UNPROVEN_PRIMARY_REASON, "SOURCE_EVIDENCE")
  assert.equal(result.DRY_RUN_STALE_LABEL, "UNPROVEN")
  assert.equal(result.DRY_RUN_STATE_BOUND, "UNPROVEN")
  assert.equal(result.DRY_RUN_STATE_FINGERPRINT_PRESENT, "UNPROVEN")
  assert.equal(result.APPROVAL_INVALIDATES_ON_EBAY_STATE_CHANGE, "YES")
  assert.equal(result.APPROVAL_INVALIDATES_ON_REGISTRY_STATE_CHANGE, "YES")
  assert.equal(result.EXPECTED_MATCHED_AFTER_SAFE_TRANCHE, "UNPROVEN")
  assert.equal(result.EXPECTED_LIVE_COUNT, "UNPROVEN")
  assert.equal(result.EXPECTED_PENDING_HUMAN_REVIEW, "UNPROVEN")
  assert.equal(result.EXPECTED_COVERAGE_PERCENT, "UNPROVEN")
})

test("package is deterministic, opaque, input-preserving, and zero-write", () => {
  const fixture = certifiedFixture()
  const before = structuredClone(fixture)
  const first = build(fixture)
  const second = build(fixture)
  assert.deepEqual(fixture, before)
  assert.equal(first.DRY_RUN_PACKAGE_HANDLE, second.DRY_RUN_PACKAGE_HANDLE)
  assert.match(first.DRY_RUN_PACKAGE_HANDLE, /^rr_package_[a-f0-9]{24}$/)
  const serialized = JSON.stringify(first)
  assert.doesNotMatch(serialized, /400000000000|LIVE-SKU-1|STALE-REGISTRY-SKU/)
  assert.doesNotMatch(serialized, /RAW_MARKER_MUST_NOT_ESCAPE|Protected listing/)
  assert.doesNotMatch(serialized, /buyer|token|authorization|cookie/i)
  assert.equal(first.REGISTRY_MUTATIONS, 0)
  assert.equal(first.EBAY_WRITES, 0)
  assert.equal(first.PRODUCT_CASE_MUTATIONS, 0)
  assert.equal(first.INVENTORY_WRITES, 0)
  assert.equal(first.FULFILLMENT_WRITES, 0)
  assert.equal(first.OAUTH_CHANGES, 0)
  assert.equal(first.VERCEL_ENV_CHANGES, 0)
})
