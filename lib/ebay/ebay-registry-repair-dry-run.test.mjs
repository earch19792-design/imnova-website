import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"
import ts from "typescript"

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
    sync_key: `registry-fixture:${id}`,
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
    syncKeyLookupStatus: "AVAILABLE",
    existingRegistrySyncKeys: Object.hasOwn(
      options,
      "existingRegistrySyncKeys",
    ) ? options.existingRegistrySyncKeys : [],
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

let pageValidatorPromise
function loadPageValidator() {
  pageValidatorPromise ??= (async () => {
    const page = readFileSync(new URL(
      "../../app/admin/ebay/monitor/seller-oauth-reauth/page.tsx",
      import.meta.url,
    ), "utf8")
    const start = page.indexOf("const REGISTRY_REPAIR_DRY_RUN_KEYS")
    const end = page.indexOf(
      "\nexport default function EbaySellerOAuthReauthPage",
    )
    assert.ok(start >= 0 && end > start)
    const source = `${page.slice(start, end)}
export { validateRegistryRepairDryRun };
`
    const javascript = ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText
    return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`)
  })()
  return pageValidatorPromise
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
  assert.deepEqual(result.OTHER_SUBTYPE_COUNTS, {
    LISTING_IDENTITY_SHAPE: 0,
    CREATE_PAYLOAD_REQUIREMENT: 0,
    REGISTRY_ABSENCE_PROOF: 0,
    LIFECYCLE_REQUIREMENT: 0,
    NORMALIZATION_FAILURE: 0,
    UNEXPECTED_CLASSIFIER_BRANCH: 0,
  })
  assert.deepEqual([
    result.RAW_CREATE_IDENTITY_CANDIDATE_COUNT,
    result.CREATE_IDENTITY_DETERMINISTIC_COUNT,
    result.CREATE_IDENTITY_UNPROVEN_COUNT,
    result.CREATE_MATERIALIZATION_PASS_COUNT,
    result.CREATE_MATERIALIZATION_UNPROVEN_COUNT,
    result.CREATE_ABSENCE_CAS_PASS_COUNT,
    result.CREATE_ABSENCE_CAS_UNPROVEN_COUNT,
  ], [23, 23, 0, 23, 0, 23, 0])
  assert.equal(result.CREATE_MATERIALIZATION_STATUS, "PASS")
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
  assert.equal(result.REPAIR_ROW_CURRENT_STATUS_CLASS, "ACTIVE")
  assert.equal(result.REPAIR_ROW_STATUS_RAW_VALUE_RECOGNIZED, "YES")
  assert.equal(result.REPAIR_ROW_STATUS_REACTIVATABLE, "NO")
  assert.equal(result.REPAIR_ROW_ACCOUNT_SCOPE_MATCH, "YES")
  assert.equal(result.REPAIR_ROW_AUTHORITATIVE_ITEM_ID_STILL_LIVE, "YES")
  assert.equal(result.REPAIR_ROW_ITEM_ID_UNIQUE_BOTH_SIDES, "YES")
  assert.equal(result.REPAIR_ROW_COMPETING_RELATIONSHIP, "NO")
  assert.equal(result.REGISTRY_LIFECYCLE_SUPPORTS_REACTIVATION, "YES")
  assert.equal(result.REACTIVATION_ALLOWED_FROM_STALE, "NO")
  assert.equal(result.REACTIVATION_ALLOWED_FROM_ENDED, "YES")
  assert.equal(result.REACTIVATION_ALLOWED_FROM_HISTORICAL, "NO")
  assert.equal(result.REACTIVATION_ALLOWED_FROM_UNKNOWN, "NO")
  assert.equal(result.REACTIVATION_CAS_SUPPORTED, "YES")
  assert.equal(result.REPAIR_EXISTING_AUTOMATIC_COUNT, 1)
  assert.equal(result.HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT, 0)
  assert.equal(result.IDENTITY_UNPROVEN_COUNT, 0)
  assert.equal(result.AUTOMATIC_PRECONDITION_UNPROVEN_COUNT, 0)
  assert.equal(result.AUTOMATIC_TRANCHE_PRECONDITIONS_PASS, "YES")
  assert.equal(result.HUMAN_REVIEW_WRITE_ALLOWED, "NO")
  assert.equal(result.HUMAN_REVIEW_MUTATION_COUNT, 0)
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

test("duplicate mutable live SKU does not defeat Item-ID create authority", () => {
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
  assert.equal(result.CREATE_NEW_COUNT, 2)
  assert.equal(result.CREATE_PRECONDITION_STATUS, "PASS")
  assert.equal(result.CREATE_NEW_UNPROVEN_COUNT, 0)
  assert.equal(result.CREATE_NEW_UNPROVEN_SOURCE, "NONE")
  assert.deepEqual([
    result.RAW_CREATE_IDENTITY_CANDIDATE_COUNT,
    result.CREATE_IDENTITY_DETERMINISTIC_COUNT,
    result.CREATE_IDENTITY_UNPROVEN_COUNT,
    result.CREATE_MATERIALIZATION_PASS_COUNT,
    result.CREATE_MATERIALIZATION_UNPROVEN_COUNT,
    result.CREATE_ABSENCE_CAS_PASS_COUNT,
    result.CREATE_ABSENCE_CAS_UNPROVEN_COUNT,
  ], [2, 2, 0, 2, 0, 2, 0])
  assert.equal(result.OTHER_SUBTYPE_REGISTRY_ABSENCE_PROOF_COUNT, 0)
  assert.equal(result.RAW_CREATE_NEW_COUNT, 2)
  assert.equal(result.LIVE_CREATE_NEW_COUNT, 2)
  assert.equal(result.RAW_UNPROVEN_COUNT, 0)
  assert.equal(result.LIVE_UNPROVEN_COUNT, 0)
  assert.equal(result.UNPROVEN_REASON_OTHER, 0)
  assert.equal(result.LIVE_RAW_PARTITION_VALID, "YES")
  assert.equal(result.LIVE_DRY_RUN_PARTITION_VALID, "YES")
  assert.equal(result.UNPROVEN_COMPONENT, "NONE")
  assert.equal(result.UNPROVEN_COUNT, 0)
  assert.equal(result.UNPROVEN_CREATE_NEW_COUNT, 0)
  assert.equal(result.UNPROVEN_TOTAL_COUNT, 0)
  assert.equal(result.BLOCKING_UNPROVEN_PRIMARY_SOURCE, "NONE")
  assert.equal(result.AMBIGUITY_CLASS, "NONE")
  assert.equal(result.DRY_RUN_REJECTION_REASON, null)
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "YES")
  assert.equal(result.ABSENCE_PROOF_UNPROVEN_COUNT, 0)
  assert.equal(result.ABSENCE_PROOF_PRIMARY_CAUSE, "NONE")
  assert.equal(result.FINAL_IDENTITY_UNPROVEN_COUNT, 0)
  assert.equal(result.FINAL_PRECONDITION_UNPROVEN_COUNT, 0)
  assert.equal(result.FINAL_REJECTION_REASON, null)
})

test("duplicate mutable Registry SKU does not defeat unique Item-ID full matches", () => {
  const first = liveListing(185)
  const second = {
    ...liveListing(186),
    sku: first.sku,
    customLabel: first.sku,
  }
  const result = build({
    liveListings: [first, second],
    registryRows: [
      registryRow({
        id: "registry-duplicate-mutable-sku-1",
        itemId: first.itemId,
        sku: first.sku,
      }),
      registryRow({
        id: "registry-duplicate-mutable-sku-2",
        itemId: second.itemId,
        sku: second.sku,
      }),
    ],
  })
  assert.deepEqual([
    result.RAW_ALREADY_MATCHED_COUNT,
    result.RAW_HUMAN_REVIEW_COUNT,
    result.RAW_UNPROVEN_COUNT,
    result.REGISTRY_KEEP_CURRENT_COUNT,
    result.REGISTRY_UNPROVEN_COUNT,
  ], [2, 0, 0, 2, 0])
  assert.equal(result.UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES, 0)
  assert.equal(result.IDENTITY_UNPROVEN_COUNT, 0)
  assert.equal(result.LIVE_DRY_RUN_PARTITION_VALID, "YES")
  assert.equal(result.REGISTRY_DRY_RUN_PARTITION_VALID, "YES")
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "YES")
})

test("post-write 27 listing topology remains 24 matched and 3 review", () => {
  const liveListings = Array.from({ length: 27 }, (_, index) => liveListing(200 + index))
  liveListings[1] = {
    ...liveListings[1],
    sku: liveListings[0].sku,
    customLabel: liveListings[0].sku,
  }
  const registryRows = [
    ...liveListings.slice(0, 24).map((listing, index) => registryRow({
      id: `postwrite-full-${index + 1}`,
      itemId: listing.itemId,
      sku: listing.sku,
    })),
    {
      ...registryRow({
        id: "postwrite-lifecycle-review",
        itemId: liveListings[24].itemId,
        sku: "OLD-LIFECYCLE-SKU",
      }),
      listing_status: "unknown",
    },
    registryRow({
      id: "postwrite-sku-review-1",
      itemId: "990000000001",
      sku: liveListings[25].sku,
    }),
    registryRow({
      id: "postwrite-sku-review-2",
      itemId: "990000000002",
      sku: liveListings[26].sku,
    }),
  ]
  const result = build({ liveListings, registryRows })
  assert.deepEqual([
    result.RAW_ALREADY_MATCHED_COUNT,
    result.RAW_HUMAN_REVIEW_COUNT,
    result.RAW_UNPROVEN_COUNT,
  ], [24, 3, 0])
  assert.deepEqual(
    result.HUMAN_REVIEW_CANDIDATES.map((candidate) =>
      candidate.RELATIONSHIP_TYPE).sort(),
    ["ITEM_ID_ONLY_LIFECYCLE", "SKU_ONLY", "SKU_ONLY"],
  )
  assert.equal(result.UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES, 0)
  assert.equal(result.IDENTITY_UNPROVEN_COUNT, 0)
  assert.equal(result.LIVE_DRY_RUN_PARTITION_VALID, "YES")
  assert.equal(result.REGISTRY_DRY_RUN_PARTITION_VALID, "YES")
})

test("real Registry sync-key collision fails CREATE absence closed", () => {
  const live = liveListing(86)
  const row = registryRow({
    id: "registry-sync-key-collision",
    itemId: "930000000086",
    sku: "UNRELATED-REGISTRY-SKU",
  })
  row.sync_key =
    `EBAY_TRADING_GET_MY_EBAY_SELLING:${ACCOUNT_KEY}:${live.itemId}`
  const result = build(
    { liveListings: [live], registryRows: [row] },
    { existingRegistrySyncKeys: [row.sync_key] },
  )
  assert.equal(result.RAW_CREATE_NEW_COUNT, 1)
  assert.equal(result.CREATE_NEW_COUNT, 0)
  assert.equal(result.RAW_UNPROVEN_COUNT, 0)
  assert.equal(result.CREATE_ABSENCE_CAS_UNPROVEN_COUNT, 1)
  assert.equal(result.ABSENCE_PROOF_UNPROVEN_COUNT, 1)
  assert.equal(result.ABSENCE_PROOF_CAUSE_SYNC_KEY_COLLISION, 1)
  assert.equal(result.ABSENCE_PROOF_PRIMARY_CAUSE, "SYNC_KEY_COLLISION")
  assert.equal(result.FINAL_IDENTITY_UNPROVEN_COUNT, 0)
  assert.equal(result.FINAL_PRECONDITION_UNPROVEN_COUNT, 1)
  assert.equal(result.AMBIGUITY_CLASS, "NONE")
  assert.equal(result.FINAL_REJECTION_REASON, "PRECONDITION_UNPROVEN")
})

test("nullable existing Registry sync key does not defeat exact collision lookup", () => {
  const fixture = certifiedFixture()
  fixture.registryRows[3].sync_key = null
  const result = build(fixture)
  assert.equal(result.REPAIR_PRECONDITION_STATUS, "PASS")
  assert.equal(result.STALE_PRECONDITION_STATUS, "PASS")
  assert.equal(result.CREATE_PRECONDITION_STATUS, "PASS")
  assert.equal(result.CREATE_NEW_COUNT, 23)
  assert.equal(result.ABSENCE_PROOF_UNPROVEN_COUNT, 0)
  assert.equal(result.ABSENCE_PROOF_CAUSE_SYNC_KEY_COLLISION, 0)
  assert.equal(result.ABSENCE_PROOF_PRIMARY_CAUSE, "NONE")
  assert.equal(result.FINAL_IDENTITY_UNPROVEN_COUNT, 0)
  assert.equal(result.FINAL_PRECONDITION_UNPROVEN_COUNT, 0)
  assert.equal(result.FINAL_REJECTION_REASON, null)
})

test("unknown deterministic repair lifecycle moves to protected human review", () => {
  const fixture = certifiedFixture()
  fixture.registryRows[0].listing_status = "unknown"
  const result = build(fixture)
  assert.equal(result.RAW_REPAIR_EXISTING_COUNT, 0)
  assert.equal(result.RAW_HUMAN_REVIEW_COUNT, 3)
  assert.equal(result.RAW_UNPROVEN_COUNT, 0)
  assert.equal(result.RAW_UNPROVEN_REGISTRY_COUNT, 0)
  assert.equal(result.REPAIR_PRECONDITION_STATUS, "PASS")
  assert.equal(result.LIFECYCLE_UNPROVEN_ACTION, "NONE")
  assert.equal(result.LIFECYCLE_UNPROVEN_STAGE, "NONE")
  assert.equal(result.LIFECYCLE_REQUIRED_SIGNAL, "NONE")
  assert.equal(result.LIFECYCLE_SIGNAL_AVAILABLE, "YES")
  assert.equal(result.OTHER_SUBTYPE_LIFECYCLE_REQUIREMENT_COUNT, 0)
  assert.equal(result.UNPROVEN_REASON_OTHER, 0)
  assert.equal(result.FINAL_IDENTITY_UNPROVEN_COUNT, 0)
  assert.equal(result.FINAL_PRECONDITION_UNPROVEN_COUNT, 0)
  assert.equal(result.AMBIGUITY_CLASS, "REVIEWABLE_ONLY")
  assert.equal(result.FINAL_REJECTION_REASON, null)
  assert.equal(result.REPAIR_ROW_CURRENT_STATUS_CLASS, "UNKNOWN")
  assert.equal(result.REPAIR_ROW_STATUS_RAW_VALUE_RECOGNIZED, "YES")
  assert.equal(result.REACTIVATION_ALLOWED_FROM_UNKNOWN, "NO")
  assert.equal(result.REPAIR_ROW_STATUS_REACTIVATABLE, "NO")
  assert.equal(result.REACTIVATION_CAS_SUPPORTED, "NO")
  assert.equal(result.LIFECYCLE_FAILURE_CAUSE, "REACTIVATION_NOT_ALLOWED")
  assert.deepEqual(result.REPAIR_FIELDS_TO_CHANGE, ["ebay_sku"])
  assert.equal(result.REPAIR_EXISTING_COUNT, 0)
  assert.equal(result.REPAIR_EXISTING_AUTOMATIC_COUNT, 0)
  assert.equal(result.CREATE_NEW_COUNT, 23)
  assert.equal(result.MARK_STALE_COUNT, 4)
  assert.equal(result.HUMAN_REVIEW_COUNT, 3)
  assert.equal(result.REGISTRY_REPAIR_EXISTING_COUNT, 0)
  assert.equal(result.REGISTRY_HUMAN_REVIEW_COUNT, 3)
  assert.equal(result.HUMAN_REVIEW_CANDIDATES.length, 3)
  const lifecycleCandidate = result.HUMAN_REVIEW_CANDIDATES.find(
    (candidate) => candidate.RELATIONSHIP_TYPE ===
      "ITEM_ID_ONLY_LIFECYCLE",
  )
  assert.ok(lifecycleCandidate)
  assert.equal(lifecycleCandidate.REGISTRY_ITEM_ID_CURRENTLY_LIVE, "YES")
  assert.equal(lifecycleCandidate.COMPETING_REGISTRY_RELATION, "NO")
  assert.equal(lifecycleCandidate.RECOMMENDED_ACTION, "REVIEW_REQUIRED")
  const serialized = JSON.parse(JSON.stringify(result))
  const serializedLifecycleCandidate = serialized.HUMAN_REVIEW_CANDIDATES.find(
    (candidate) => candidate.RELATIONSHIP_TYPE ===
      "ITEM_ID_ONLY_LIFECYCLE",
  )
  assert.deepEqual(serializedLifecycleCandidate, lifecycleCandidate)
  assert.equal(result.HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT, 1)
  assert.equal(result.IDENTITY_UNPROVEN_COUNT, 0)
  assert.equal(result.AUTOMATIC_PRECONDITION_UNPROVEN_COUNT, 0)
  assert.equal(result.AUTOMATIC_TRANCHE_PRECONDITIONS_PASS, "YES")
  assert.equal(result.HUMAN_REVIEW_WRITE_ALLOWED, "NO")
  assert.equal(result.HUMAN_REVIEW_MUTATION_COUNT, 0)
  assert.equal(result.EXPECTED_MATCHED_AFTER_SAFE_TRANCHE, 23)
  assert.equal(result.EXPECTED_PENDING_HUMAN_REVIEW, 3)
  assert.equal(result.EXPECTED_COVERAGE_PERCENT, 88.46)
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "YES")
})

test("canonical 27-to-7 lifecycle review response passes the page validator", async () => {
  const fixture = certifiedFixture()
  fixture.liveListings.push(liveListing(26))
  fixture.registryRows[0].listing_status = "unknown"
  const result = build(fixture)
  const routeSerialized = JSON.parse(JSON.stringify(result))
  const { validateRegistryRepairDryRun } = await loadPageValidator()

  assert.deepEqual({
    repair: result.REPAIR_EXISTING_AUTOMATIC_COUNT,
    create: result.CREATE_NEW_COUNT,
    stale: result.MARK_STALE_COUNT,
    review: result.HUMAN_REVIEW_COUNT,
    identityUnproven: result.IDENTITY_UNPROVEN_COUNT,
    automaticPreconditionUnproven:
      result.AUTOMATIC_PRECONDITION_UNPROVEN_COUNT,
    automaticTranche: result.AUTOMATIC_TRANCHE_PRECONDITIONS_PASS,
    ready: result.DRY_RUN_READY_FOR_APPROVAL,
  }, {
    repair: 0,
    create: 24,
    stale: 4,
    review: 3,
    identityUnproven: 0,
    automaticPreconditionUnproven: 0,
    automaticTranche: "YES",
    ready: "YES",
  })
  assert.deepEqual(
    result.HUMAN_REVIEW_CANDIDATES.map((candidate) =>
      candidate.RELATIONSHIP_TYPE).sort(),
    ["ITEM_ID_ONLY_LIFECYCLE", "SKU_ONLY", "SKU_ONLY"],
  )
  assert.deepEqual([
    result.HUMAN_REVIEW_WRITE_ALLOWED,
    result.HUMAN_REVIEW_MUTATION_COUNT,
    result.REGISTRY_MUTATIONS,
    result.EBAY_WRITES,
  ], ["NO", 0, 0, 0])
  assert.deepEqual(validateRegistryRepairDryRun(routeSerialized), {
    valid: true,
    failureCode: null,
  })

  const missingRequiredField = structuredClone(routeSerialized)
  delete missingRequiredField.EVIDENCE_STATUS
  assert.deepEqual(validateRegistryRepairDryRun(missingRequiredField), {
    valid: false,
    failureCode: "TOP_LEVEL_SHAPE_INVALID",
  })

  const obsoleteEvidenceStatus = structuredClone(routeSerialized)
  obsoleteEvidenceStatus.EVIDENCE_STATUS = "CURRENT"
  assert.deepEqual(validateRegistryRepairDryRun(obsoleteEvidenceStatus), {
    valid: false,
    failureCode: "EVIDENCE_STATUS_INVALID",
  })

  const reviewWriteEnabled = structuredClone(routeSerialized)
  reviewWriteEnabled.HUMAN_REVIEW_WRITE_ALLOWED = "YES"
  assert.deepEqual(validateRegistryRepairDryRun(reviewWriteEnabled), {
    valid: false,
    failureCode: "HUMAN_REVIEW_WRITE_POLICY_INVALID",
  })

  const reviewMutationAdded = structuredClone(routeSerialized)
  reviewMutationAdded.HUMAN_REVIEW_MUTATION_COUNT = 1
  assert.deepEqual(validateRegistryRepairDryRun(reviewMutationAdded), {
    valid: false,
    failureCode: "HUMAN_REVIEW_WRITE_POLICY_INVALID",
  })

  const automaticPreconditionUnproven = structuredClone(routeSerialized)
  automaticPreconditionUnproven.AUTOMATIC_PRECONDITION_UNPROVEN_COUNT = 1
  automaticPreconditionUnproven.FINAL_PRECONDITION_UNPROVEN_COUNT = 1
  automaticPreconditionUnproven.AUTOMATIC_TRANCHE_PRECONDITIONS_PASS = "NO"
  assert.deepEqual(validateRegistryRepairDryRun(automaticPreconditionUnproven), {
    valid: false,
    failureCode: "READY_FOR_APPROVAL_INVARIANT_INVALID",
  })

  const identityUnproven = structuredClone(routeSerialized)
  identityUnproven.IDENTITY_UNPROVEN_COUNT = 1
  identityUnproven.FINAL_IDENTITY_UNPROVEN_COUNT = 1
  assert.deepEqual(validateRegistryRepairDryRun(identityUnproven), {
    valid: false,
    failureCode: "READY_FOR_APPROVAL_INVARIANT_INVALID",
  })
})

test("Registry active lifecycle signal uses the canonical schema value", () => {
  const fixture = certifiedFixture()
  fixture.registryRows[0].listing_status = "active"
  const result = build(fixture)
  assert.equal(result.REPAIR_PRECONDITION_STATUS, "PASS")
  assert.equal(result.LIFECYCLE_UNPROVEN_ACTION, "NONE")
  assert.equal(result.LIFECYCLE_UNPROVEN_STAGE, "NONE")
  assert.equal(result.LIFECYCLE_REQUIRED_SIGNAL, "NONE")
  assert.equal(result.LIFECYCLE_SIGNAL_AVAILABLE, "YES")
  assert.equal(result.LIFECYCLE_FAILURE_CAUSE, "NONE")
  assert.equal(result.REPAIR_ROW_CURRENT_STATUS_CLASS, "ACTIVE")
  assert.equal(result.REACTIVATION_CAS_SUPPORTED, "YES")
})

test("exact paused draft and ended rows reactivate by Item ID CAS regardless of connector naming", () => {
  for (const [status, statusClass] of [
    ["paused", "PAUSED"],
    ["draft", "DRAFT"],
    ["ended", "ENDED"],
  ]) {
    const fixture = certifiedFixture()
    fixture.registryRows[0].listing_status = status
    fixture.registryRows[0].source = "LEGACY_READONLY_SOURCE"
    fixture.registryRows[0].sync_key = "legacy-opaque-key"
    const result = build(fixture)
    assert.equal(result.REPAIR_PRECONDITION_STATUS, "PASS")
    assert.equal(result.REPAIR_ROW_CURRENT_STATUS_CLASS, statusClass)
    assert.equal(result.REPAIR_ROW_STATUS_RAW_VALUE_RECOGNIZED, "YES")
    assert.equal(result.REPAIR_ROW_STATUS_REACTIVATABLE, "YES")
    assert.equal(result.REPAIR_ROW_AUTHORITATIVE_ITEM_ID_STILL_LIVE, "YES")
    assert.equal(result.REPAIR_ROW_ITEM_ID_UNIQUE_BOTH_SIDES, "YES")
    assert.equal(result.REPAIR_ROW_COMPETING_RELATIONSHIP, "NO")
    assert.equal(result.REACTIVATION_CAS_SUPPORTED, "YES")
    assert.deepEqual(result.REPAIR_FIELDS_TO_CHANGE,
      ["ebay_sku", "listing_status"])
    assert.equal(result.LIFECYCLE_UNPROVEN_ACTION, "NONE")
    assert.equal(result.FINAL_REJECTION_REASON, null)
    assert.equal(result.REGISTRY_MUTATIONS, 0)
    assert.equal(result.EBAY_WRITES, 0)
    assert.equal(result.PRODUCT_CASE_MUTATIONS, 0)
  }
})

test("reactivation package is bound to old status SKU and evidence fingerprint", () => {
  const fixture = certifiedFixture()
  fixture.registryRows[0].listing_status = "paused"
  fixture.registryRows[0].source = "EBAY_SELL_INVENTORY_READONLY"
  fixture.registryRows[0].sync_key =
    `EBAY_SELL_INVENTORY_READONLY:${ACCOUNT_KEY}:opaque-listing-anchor`
  const paused = build(fixture)
  const changedStatus = structuredClone(fixture)
  changedStatus.registryRows[0].listing_status = "draft"
  const draft = build(changedStatus)
  const changedSku = structuredClone(fixture)
  changedSku.registryRows[0].ebay_sku = "ANOTHER-STALE-SKU"
  const otherSku = build(changedSku)
  assert.notEqual(paused.DRY_RUN_PACKAGE_HANDLE,
    draft.DRY_RUN_PACKAGE_HANDLE)
  assert.notEqual(paused.DRY_RUN_PACKAGE_HANDLE,
    otherSku.DRY_RUN_PACKAGE_HANDLE)
  const freshness = evaluateEbayRegistryRepairFutureWriteFreshness({
    reviewedEvidenceFingerprint: paused.CURRENT_EVIDENCE_FINGERPRINT,
    currentEvidenceFingerprint: draft.CURRENT_EVIDENCE_FINGERPRINT,
  })
  assert.equal(freshness.WRITE_STATE_STATUS, "STALE")
  assert.equal(freshness.WRITE_ALLOWED, "NO")
  assert.equal(freshness.REFRESH_REQUIRED, "YES")
  assert.doesNotMatch(JSON.stringify(paused),
    /opaque-listing-anchor|STALE-REGISTRY-SKU|LIVE-SKU-1/)
})

test("connector naming is CAS evidence and not a lifecycle permission gate", () => {
  const fixture = certifiedFixture()
  fixture.registryRows[0].listing_status = "paused"
  fixture.registryRows[0].source = "LEGACY_READONLY_SOURCE"
  fixture.registryRows[0].sync_key = "legacy-key-without-canonical-prefix"
  const result = build(fixture)
  assert.equal(result.RAW_REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.REPAIR_PRECONDITION_STATUS, "PASS")
  assert.equal(result.REPAIR_ROW_CURRENT_STATUS_CLASS, "PAUSED")
  assert.equal(result.REPAIR_ROW_STATUS_REACTIVATABLE, "YES")
  assert.equal(result.REACTIVATION_CAS_SUPPORTED, "YES")
  assert.deepEqual(result.REPAIR_FIELDS_TO_CHANGE,
    ["ebay_sku", "listing_status"])
  assert.equal(result.FINAL_REJECTION_REASON, null)
})

test("non-reactivatable lifecycle classes route to review without automatic mutation", () => {
  for (const [status, statusClass] of [
    ["stale", "STALE"],
    ["historical", "HISTORICAL"],
    ["noncanonical", "OTHER"],
  ]) {
    const fixture = certifiedFixture()
    fixture.registryRows[0].listing_status = status
    const result = build(fixture)
    assert.equal(result.REPAIR_ROW_CURRENT_STATUS_CLASS, statusClass)
    assert.equal(result.REPAIR_ROW_STATUS_REACTIVATABLE, "NO")
    assert.equal(result.REPAIR_PRECONDITION_STATUS, "PASS")
    assert.equal(result.LIFECYCLE_FAILURE_CAUSE,
      "REACTIVATION_NOT_ALLOWED")
    assert.equal(result.FINAL_REJECTION_REASON, null)
    assert.equal(result.REPAIR_EXISTING_AUTOMATIC_COUNT, 0)
    assert.equal(result.HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT, 1)
    assert.equal(result.IDENTITY_UNPROVEN_COUNT, 0)
    assert.equal(result.AUTOMATIC_PRECONDITION_UNPROVEN_COUNT, 0)
    assert.equal(result.AUTOMATIC_TRANCHE_PRECONDITIONS_PASS, "YES")
    assert.equal(result.HUMAN_REVIEW_WRITE_ALLOWED, "NO")
    assert.equal(result.HUMAN_REVIEW_MUTATION_COUNT, 0)
    assert.equal(result.REGISTRY_MUTATIONS, 0)
    assert.equal(result.EBAY_WRITES, 0)
    assert.equal(result.PRODUCT_CASE_MUTATIONS, 0)
  }
})

test("isolated lifecycle review has no automatic handles and stale future state", () => {
  const fixture = certifiedFixture()
  fixture.registryRows[0].listing_status = "unknown"
  const reviewFixture = {
    liveListings: [fixture.liveListings[0]],
    registryRows: [fixture.registryRows[0]],
  }
  const reviewed = build(reviewFixture)
  const changedFixture = structuredClone(reviewFixture)
  changedFixture.registryRows[0].listing_status = "active"
  const changed = build(changedFixture)
  assert.equal(reviewed.REPAIR_EXISTING_AUTOMATIC_COUNT, 0)
  assert.equal(reviewed.CREATE_NEW_COUNT, 0)
  assert.equal(reviewed.MARK_STALE_COUNT, 0)
  assert.equal(reviewed.HUMAN_REVIEW_COUNT, 1)
  assert.equal(reviewed.HUMAN_REVIEW_CANDIDATES[0].RELATIONSHIP_TYPE,
    "ITEM_ID_ONLY_LIFECYCLE")
  assert.equal(reviewed.IDENTITY_UNPROVEN_COUNT, 0)
  assert.equal(reviewed.AUTOMATIC_PRECONDITION_UNPROVEN_COUNT, 0)
  assert.equal(reviewed.AUTOMATIC_TRANCHE_PRECONDITIONS_PASS, "YES")
  assert.equal(reviewed.HUMAN_REVIEW_MUTATION_COUNT, 0)
  assert.equal(reviewed.DRY_RUN_READY_FOR_APPROVAL, "YES")
  assert.equal(reviewed.REGISTRY_MUTATIONS, 0)
  assert.equal(reviewed.EBAY_WRITES, 0)
  assert.equal(reviewed.PRODUCT_CASE_MUTATIONS, 0)
  const freshness = evaluateEbayRegistryRepairFutureWriteFreshness({
    reviewedEvidenceFingerprint: reviewed.CURRENT_EVIDENCE_FINGERPRINT,
    currentEvidenceFingerprint: changed.CURRENT_EVIDENCE_FINGERPRINT,
  })
  assert.equal(freshness.WRITE_STATE_STATUS, "STALE")
  assert.equal(freshness.WRITE_ALLOWED, "NO")
  assert.equal(freshness.REFRESH_REQUIRED, "YES")
  assert.doesNotMatch(JSON.stringify(reviewed),
    new RegExp(`${reviewFixture.liveListings[0].itemId}|${reviewFixture.liveListings[0].sku}`))
})

test("missing existing-row CAS is not converted into lifecycle review", () => {
  const fixture = certifiedFixture()
  fixture.registryRows[0].listing_status = "unknown"
  fixture.registryRows[0].source = ""
  const result = build({
    liveListings: [fixture.liveListings[0]],
    registryRows: [fixture.registryRows[0]],
  })
  assert.equal(result.RAW_REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.REPAIR_EXISTING_AUTOMATIC_COUNT, 0)
  assert.equal(result.HUMAN_REVIEW_COUNT, 0)
  assert.equal(result.HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT, 0)
  assert.equal(result.REPAIR_PRECONDITION_STATUS, "UNPROVEN")
  assert.equal(result.IDENTITY_UNPROVEN_COUNT, 0)
  assert.equal(result.AUTOMATIC_PRECONDITION_UNPROVEN_COUNT, 1)
  assert.equal(result.AUTOMATIC_TRANCHE_PRECONDITIONS_PASS, "NO")
  assert.equal(result.FINAL_REJECTION_REASON, "PRECONDITION_UNPROVEN")
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
  assert.equal(result.REGISTRY_MUTATIONS, 0)
  assert.equal(result.EBAY_WRITES, 0)
  assert.equal(result.PRODUCT_CASE_MUTATIONS, 0)
})

test("mixed repair handles keep per-row fields and non-singular diagnostics unproven", () => {
  const fixture = certifiedFixture()
  const reactivationRow = registryRow({
    id: "registry-repair-reactivation",
    itemId: fixture.liveListings[3].itemId,
    sku: "SECOND-STALE-SKU",
  })
  reactivationRow.listing_status = "paused"
  reactivationRow.source = "EBAY_SELL_INVENTORY_READONLY"
  reactivationRow.sync_key =
    `EBAY_SELL_INVENTORY_READONLY:${ACCOUNT_KEY}:second-opaque-anchor`
  fixture.registryRows.push(reactivationRow)
  const forward = build(fixture)
  const reversed = build({
    liveListings: fixture.liveListings,
    registryRows: [...fixture.registryRows].reverse(),
  })
  assert.equal(forward.REPAIR_EXISTING_COUNT, 2)
  assert.equal(forward.REPAIR_PRECONDITION_STATUS, "PASS")
  assert.deepEqual(forward.REPAIR_FIELDS_TO_CHANGE,
    ["ebay_sku", "listing_status"])
  assert.equal(forward.DRY_RUN_PACKAGE_HANDLE,
    reversed.DRY_RUN_PACKAGE_HANDLE)
  for (const field of [
    "REPAIR_ROW_CURRENT_STATUS_CLASS",
    "REPAIR_ROW_STATUS_RAW_VALUE_RECOGNIZED",
    "REPAIR_ROW_STATUS_REACTIVATABLE",
    "REPAIR_ROW_ACCOUNT_SCOPE_MATCH",
    "REPAIR_ROW_AUTHORITATIVE_ITEM_ID_STILL_LIVE",
    "REPAIR_ROW_ITEM_ID_UNIQUE_BOTH_SIDES",
    "REPAIR_ROW_COMPETING_RELATIONSHIP",
    "REGISTRY_LIFECYCLE_SUPPORTS_REACTIVATION",
    "REACTIVATION_ALLOWED_FROM_STALE",
    "REACTIVATION_ALLOWED_FROM_ENDED",
    "REACTIVATION_ALLOWED_FROM_HISTORICAL",
    "REACTIVATION_ALLOWED_FROM_UNKNOWN",
    "REACTIVATION_CAS_SUPPORTED",
  ]) assert.equal(forward[field], "UNPROVEN")
})

test("missing mutable SKU blocks create materialization, not Item ID identity", () => {
  const live = { ...liveListing(88), sku: null, customLabel: null }
  const result = build({ liveListings: [live], registryRows: [] })
  assert.equal(result.RAW_CREATE_IDENTITY_CANDIDATE_COUNT, 1)
  assert.equal(result.CREATE_IDENTITY_DETERMINISTIC_COUNT, 1)
  assert.equal(result.CREATE_IDENTITY_UNPROVEN_COUNT, 0)
  assert.equal(result.CREATE_MATERIALIZATION_PASS_COUNT, 0)
  assert.equal(result.CREATE_MATERIALIZATION_UNPROVEN_COUNT, 1)
  assert.equal(result.CREATE_ABSENCE_CAS_PASS_COUNT, 0)
  assert.equal(result.CREATE_ABSENCE_CAS_UNPROVEN_COUNT, 0)
  assert.equal(result.CREATE_NEW_COUNT, 0)
  assert.equal(result.RAW_CREATE_NEW_COUNT, 1)
  assert.equal(result.LIVE_CREATE_NEW_COUNT, 1)
  assert.equal(result.RAW_UNPROVEN_COUNT, 0)
  assert.equal(result.LIVE_UNPROVEN_COUNT, 0)
  assert.equal(result.CREATE_NEW_UNPROVEN_COUNT, 1)
  assert.equal(result.CREATE_NEW_UNPROVEN_SOURCE, "CREATE_MATERIALIZATION")
  assert.equal(result.CREATE_MATERIALIZATION_STATUS, "UNPROVEN")
  assert.equal(result.UNPROVEN_COMPONENT, "CREATE_NEW_MATERIALIZATION")
  assert.equal(result.IDENTITY_PARTITION_UNPROVEN_COUNT, 0)
  assert.equal(result.UNPROVEN_REASON_OTHER, 0)
  assert.equal(result.OTHER_SUBTYPE_CREATE_PAYLOAD_REQUIREMENT_COUNT, 1)
  assert.equal(result.UNPROVEN_PRIMARY_REASON, "NONE")
  assert.equal(result.LIVE_RAW_PARTITION_VALID, "YES")
  assert.equal(result.LIVE_DRY_RUN_PARTITION_VALID, "YES")
  assert.equal(result.AMBIGUITY_CLASS, "NONE")
  assert.equal(result.DRY_RUN_REJECTION_REASON, "PRECONDITION_UNPROVEN")
})

test("ambiguous live identity blocks before create materialization", () => {
  const live = { ...liveListing(89), identityAmbiguous: true }
  const result = build({ liveListings: [live], registryRows: [] })
  assert.deepEqual([
    result.RAW_CREATE_IDENTITY_CANDIDATE_COUNT,
    result.CREATE_IDENTITY_DETERMINISTIC_COUNT,
    result.CREATE_IDENTITY_UNPROVEN_COUNT,
    result.CREATE_MATERIALIZATION_PASS_COUNT,
    result.CREATE_MATERIALIZATION_UNPROVEN_COUNT,
    result.CREATE_ABSENCE_CAS_PASS_COUNT,
    result.CREATE_ABSENCE_CAS_UNPROVEN_COUNT,
  ], [1, 0, 1, 0, 0, 0, 0])
  assert.equal(result.IDENTITY_PARTITION_UNPROVEN_COUNT, 1)
  assert.equal(result.UNPROVEN_REASON_OTHER, 1)
  assert.equal(result.OTHER_SUBTYPE_LISTING_IDENTITY_SHAPE_COUNT, 1)
  assert.equal(result.AMBIGUITY_CLASS, "BLOCKING_UNPROVEN")
  assert.equal(result.DRY_RUN_REJECTION_REASON, "AMBIGUOUS_IDENTITY")
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

test("volatile observation timestamps do not alter evidence or package identity", () => {
  const fixture = certifiedFixture()
  const first = build(fixture)
  const laterObservation = structuredClone(fixture)
  laterObservation.liveListings = laterObservation.liveListings.map((listing) => ({
    ...listing,
    observedAt: "2026-08-11T23:59:59.000Z",
    marketplaceCertification: {
      ...listing.marketplaceCertification,
      observedAt: "2026-08-11T23:59:59.000Z",
    },
  }))
  const second = build(laterObservation)
  assert.equal(second.CURRENT_EVIDENCE_FINGERPRINT,
    first.CURRENT_EVIDENCE_FINGERPRINT)
  assert.equal(second.DRY_RUN_PACKAGE_HANDLE, first.DRY_RUN_PACKAGE_HANDLE)
  assert.equal(second.DRY_RUN_READY_FOR_APPROVAL,
    first.DRY_RUN_READY_FOR_APPROVAL)
})

test("semantic live lifecycle and Registry lifecycle changes invalidate approval", () => {
  const fixture = certifiedFixture()
  const first = build(fixture)

  const endedLive = structuredClone(fixture)
  endedLive.liveListings[3].listingState = "ENDED"
  const ended = build(endedLive)
  assert.notEqual(ended.CURRENT_EVIDENCE_FINGERPRINT,
    first.CURRENT_EVIDENCE_FINGERPRINT)
  assert.notEqual(ended.DRY_RUN_PACKAGE_HANDLE, first.DRY_RUN_PACKAGE_HANDLE)

  const changedRegistry = structuredClone(fixture)
  changedRegistry.registryRows[3].listing_status = "paused"
  const changed = build(changedRegistry)
  assert.notEqual(changed.CURRENT_EVIDENCE_FINGERPRINT,
    first.CURRENT_EVIDENCE_FINGERPRINT)
  assert.notEqual(changed.DRY_RUN_PACKAGE_HANDLE, first.DRY_RUN_PACKAGE_HANDLE)
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
    "RAW_CREATE_IDENTITY_CANDIDATE_COUNT",
    "CREATE_IDENTITY_DETERMINISTIC_COUNT",
    "CREATE_IDENTITY_UNPROVEN_COUNT",
    "CREATE_MATERIALIZATION_PASS_COUNT",
    "CREATE_MATERIALIZATION_UNPROVEN_COUNT",
    "CREATE_ABSENCE_CAS_PASS_COUNT",
    "CREATE_ABSENCE_CAS_UNPROVEN_COUNT",
    "ABSENCE_PROOF_UNPROVEN_COUNT",
    "ABSENCE_PROOF_CAUSE_ITEM_ID_ALREADY_PRESENT",
    "ABSENCE_PROOF_CAUSE_ITEM_ID_LOOKUP_UNPROVEN",
    "ABSENCE_PROOF_CAUSE_SKU_RELATION",
    "ABSENCE_PROOF_CAUSE_SYNC_KEY_COLLISION",
    "ABSENCE_PROOF_CAUSE_ACCOUNT_SCOPE",
    "ABSENCE_PROOF_CAUSE_MULTIPLE_REGISTRY_ROWS",
    "ABSENCE_PROOF_CAUSE_SECOND_READ_INCONSISTENCY",
    "ABSENCE_PROOF_CAUSE_OTHER",
    "FINAL_IDENTITY_UNPROVEN_COUNT",
    "FINAL_PRECONDITION_UNPROVEN_COUNT",
  ]) {
    assert.equal(result[key], "UNPROVEN")
  }
  assert.equal(result.UNPROVEN_PRIMARY_REASON, "SOURCE_EVIDENCE")
  assert.deepEqual(result.OTHER_SUBTYPE_COUNTS, {
    LISTING_IDENTITY_SHAPE: "UNPROVEN",
    CREATE_PAYLOAD_REQUIREMENT: "UNPROVEN",
    REGISTRY_ABSENCE_PROOF: "UNPROVEN",
    LIFECYCLE_REQUIREMENT: "UNPROVEN",
    NORMALIZATION_FAILURE: "UNPROVEN",
    UNEXPECTED_CLASSIFIER_BRANCH: "UNPROVEN",
  })
  assert.equal(result.CREATE_MATERIALIZATION_STATUS, "UNPROVEN")
  assert.equal(result.ABSENCE_PROOF_PRIMARY_CAUSE, "UNPROVEN")
  assert.equal(result.LIFECYCLE_UNPROVEN_ACTION, "UNPROVEN")
  assert.equal(result.LIFECYCLE_UNPROVEN_STAGE, "UNPROVEN")
  assert.equal(result.LIFECYCLE_REQUIRED_SIGNAL, "UNPROVEN")
  assert.equal(result.LIFECYCLE_SIGNAL_AVAILABLE, "UNPROVEN")
  assert.equal(result.LIFECYCLE_FAILURE_CAUSE, "UNPROVEN")
  assert.equal(result.FINAL_REJECTION_REASON, "UNPROVEN")
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
