import assert from "node:assert/strict"
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

const control = await import(
  "./ebay-luna-linkage-approval-control-plane-v1.ts"
)
const { createSellerOsLunaLinkageApprovalRepositoryV1 } = await import(
  "./ebay-luna-linkage-approval-repository-v1.ts"
)

const ACCOUNT = `seller:${"a".repeat(64)}`
const COHORT = `current-live:EBAY_US:${"b".repeat(20)}`
const ACTOR = "11111111-1111-4111-8111-111111111111"
const NOW = "2026-08-22T16:00:00.000Z"
const IDENTITY_EVIDENCE_REFERENCE =
  `luna-identity-v1:sha256:${"c".repeat(64)}`
const IDENTITY_EVIDENCE_PROVENANCE = Object.freeze({
  contractVersion: "SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1",
  sourceStatus: "AVAILABLE",
  acquisitionMethod: "CANONICAL_SERVER_READ_IDENTITY_ONLY",
})

function review(count = 1) {
  const entries = Array.from({ length: count }, (_, index) =>
    control.buildSellerOsLunaLinkageReviewEntryV2({
      currentCohortId: COHORT, accountKey: ACCOUNT,
      ebayItemId: (366582586826n + BigInt(index)).toString(),
      ebaySku: `IMN-LST-${String(index + 11).padStart(6, "0")}`,
      listingTitle: `Z6 Translator Black ${index + 1}`,
      classification: "EXACT_UNIQUE_MATCH",
      linkageMode: "SINGLE_COMPONENT",
      components: [{
        lunaProductId: (9220805755104n + BigInt(index)).toString(),
        lunaVariantId: (48809607659744n + BigInt(index)).toString(),
        lunaSku: `ITEM${5810 + index}`, productTitle: "Z6 Translator",
        variantTitle: "Black", supplierQuantityRequired: 1,
        quantityBasis: "STRUCTURED_EVIDENCE", variantPresence: "PRESENT",
        exactProductIdentity: true, exactVariantIdentity: true,
        exactSupplierSku: true, structuredVariantAttributesComplete: true,
        identityConflict: false,
      }],
      matchSignals: ["EXACT_SUPPLIER_SKU"], conflictSignals: [],
      evidenceReferences: [IDENTITY_EVIDENCE_REFERENCE],
      evidenceObservedAt: NOW, reviewObservedAt: NOW,
      identityEvidenceProvenance: IDENTITY_EVIDENCE_PROVENANCE,
      decisionVersion: 1,
    }))
  return control.buildSellerOsLunaLinkageReviewSetV2({
    currentCohortId: COHORT, accountKey: ACCOUNT,
    currentLiveCount: count, entries,
  })
}

function persistedRow(set, entry, overrides = {}) {
  const scalar = entry.components.length === 1 ? entry.components[0] : null
  return {
    review_candidate_id: entry.reviewCandidateId,
    review_set_id: set.reviewSetId,
    current_cohort_id: set.currentCohortId,
    account_key: set.accountKey,
    account_binding: "CANONICAL_SELLER_ACCOUNT",
    marketplace_id: set.marketplaceId,
    ebay_item_id: entry.ebayItemId,
    ebay_sku: entry.ebaySku,
    listing_title: entry.listingTitle,
    classification: entry.classification,
    linkage_mode: entry.linkageMode,
    linkage_id: entry.linkageId,
    luna_product_id: scalar?.lunaProductId ?? null,
    luna_variant_id: scalar?.lunaVariantId ?? null,
    luna_sku: scalar?.lunaSku ?? null,
    components: structuredClone(entry.components),
    supplier_quantity_required: scalar?.supplierQuantityRequired ?? null,
    match_signals: [...entry.matchSignals],
    conflict_signals: [...entry.conflictSignals],
    evidence_references: [...entry.evidenceReferences],
    evidence_digest: entry.evidenceDigest,
    evidence_observed_at: NOW.replace(".000Z", "+00:00"),
    review_observed_at: NOW.replace(".000Z", "+00:00"),
    evidence_maximum_age_seconds: entry.evidenceMaximumAgeSeconds,
    identity_evidence_provenance:
      structuredClone(entry.identityEvidenceProvenance),
    evidence_freshness: entry.evidenceFreshness,
    decision_version: entry.decisionVersion,
    approval_eligible: entry.approvalEligibility.eligible,
    is_current: true,
    retired_at: null,
    contract_version: entry.contractVersion,
    ...overrides,
  }
}

function repositoryClient(input) {
  const reads = []
  const client = {
    rpc: input.rpc,
    from(table) {
      const call = { table, columns: null, options: null, filters: [],
        order: null, limit: null }
      const query = {
        eq(column, value) { call.filters.push([column, value]); return query },
        order(column, options) { call.order = [column, options]; return query },
        limit(value) { call.limit = value; return query },
        then(resolve, reject) {
          reads.push(structuredClone(call))
          return Promise.resolve(input.reads[table]).then(resolve, reject)
        },
      }
      return { select(columns, options) {
        call.columns = columns
        call.options = options
        return query
      } }
    },
  }
  return { client, reads }
}

test("26-item review persistence is one RPC plus exact bounded readback", async () => {
  const calls = []
  const set = review(26)
  const rows = set.entries.map((entry) => persistedRow(set, entry))
  const harness = repositoryClient({
    rpc: async (name, parameters) => {
      calls.push({ name, parameters })
      return { data: [{ outcome: "CREATED",
        reviewSetId: parameters.p_review_set_id,
        candidateCount: parameters.p_candidates.length }], error: null }
    },
    reads: {
      seller_os_luna_linkage_review_candidates:
        { data: rows, count: 26, error: null },
      seller_os_luna_linkage_decisions:
        { data: [], count: 0, error: null },
    },
  })
  const repository = createSellerOsLunaLinkageApprovalRepositoryV1(
    harness.client)
  assert.equal(calls.length, 0)
  const receipt = await repository.replaceReviewSet(set)
  assert.equal(receipt.status, "CREATED")
  assert.equal(receipt.readbackVerified, true)
  assert.equal(receipt.decisionCount, 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name,
    "replace_seller_os_luna_linkage_review_set_v1")
  assert.equal(calls[0].parameters.p_candidates.length, 26)
  assert.equal(calls[0].parameters.p_candidates[0].contractVersion,
    "SELLER_OS_LUNA_LINKAGE_REVIEW_V2")
  assert.equal(calls[0].parameters.p_candidates[0].linkageMode,
    "SINGLE_COMPONENT")
  assert.equal(calls[0].parameters.p_candidates[0].approvalEligibility.eligible,
    true)
  assert.equal(Object.keys(calls[0].parameters).some((key) =>
    /cookie|credential|password|url|sql/i.test(key)), false)
  assert.equal(harness.reads.length, 2)
  const reviewRead = harness.reads.find((call) =>
    call.table === "seller_os_luna_linkage_review_candidates")
  assert.equal(reviewRead.limit, 27)
  assert.deepEqual(reviewRead.filters, [
    ["account_key", ACCOUNT], ["marketplace_id", "EBAY_US"],
    ["is_current", true],
  ])
  assert.deepEqual(reviewRead.order,
    ["ebay_item_id", { ascending: true }])
  const decisionRead = harness.reads.find((call) =>
    call.table === "seller_os_luna_linkage_decisions")
  assert.equal(decisionRead.limit, 1)
  assert.deepEqual(decisionRead.filters, [
    ["account_key", ACCOUNT], ["marketplace_id", "EBAY_US"],
    ["current_cohort_id", COHORT], ["review_set_id", set.reviewSetId],
  ])
})

test("exact replay stays idempotent and still requires readback", async () => {
  const set = review(2)
  const harness = repositoryClient({
    rpc: async (_name, parameters) => ({ data: [{
      outcome: "IDEMPOTENT_SUCCESS",
      reviewSetId: parameters.p_review_set_id,
      candidateCount: parameters.p_candidates.length,
    }], error: null }),
    reads: {
      seller_os_luna_linkage_review_candidates: { data: set.entries.map(
        (entry) => persistedRow(set, entry)), count: 2, error: null },
      seller_os_luna_linkage_decisions: { data: [], count: 0, error: null },
    },
  })
  const receipt = await createSellerOsLunaLinkageApprovalRepositoryV1(
    harness.client).replaceReviewSet(set)
  assert.equal(receipt.status, "IDEMPOTENT_SUCCESS")
  assert.equal(receipt.readbackVerified, true)
})

test("read errors, truncation, row mismatch, and decisions fail closed", async (t) => {
  const set = review(2)
  const validRows = set.entries.map((entry) => persistedRow(set, entry))
  const cases = [
    ["review read error", { data: null, count: null, error: { code: "read" } },
      { data: [], count: 0, error: null },
      /LUNA_LINKAGE_REVIEW_READBACK_FAILED_CLOSED/],
    ["decision read error", { data: validRows, count: 2, error: null },
      { data: null, count: null, error: { code: "read" } },
      /LUNA_LINKAGE_REVIEW_READBACK_FAILED_CLOSED/],
    ["missing row", { data: validRows.slice(0, 1), count: 1, error: null },
      { data: [], count: 0, error: null },
      /LUNA_LINKAGE_REVIEW_READBACK_MISMATCH/],
    ["truncated or extra current row", { data: [...validRows, validRows[0]],
      count: 3, error: null }, { data: [], count: 0, error: null },
      /LUNA_LINKAGE_REVIEW_READBACK_MISMATCH/],
    ["changed digest", { data: [persistedRow(set, set.entries[0], {
      evidence_digest: `sha256:${"f".repeat(64)}` }), validRows[1]],
      count: 2, error: null }, { data: [], count: 0, error: null },
      /LUNA_LINKAGE_REVIEW_READBACK_MISMATCH/],
    ["one durable decision", { data: validRows, count: 2, error: null },
      { data: [{ decision_id: "unexpected" }], count: 1, error: null },
      /LUNA_LINKAGE_DECISION_COUNT_NOT_ZERO/],
  ]
  for (const [name, reviewRead, decisionRead, expected] of cases) {
    await t.test(name, async () => {
      const harness = repositoryClient({
        rpc: async (_rpcName, parameters) => ({ data: [{ outcome: "CREATED",
          reviewSetId: parameters.p_review_set_id,
          candidateCount: parameters.p_candidates.length }], error: null }),
        reads: {
          seller_os_luna_linkage_review_candidates: reviewRead,
          seller_os_luna_linkage_decisions: decisionRead,
        },
      })
      await assert.rejects(createSellerOsLunaLinkageApprovalRepositoryV1(
        harness.client).replaceReviewSet(set), expected)
    })
  }
})

test("decision RPC never accepts caller Luna identity, component, URL, or account", async () => {
  const calls = []
  const set = review()
  const entry = set.entries[0]
  const decisionReference =
    `luna-linkage-decision-v1:sha256:${"d".repeat(64)}`
  const repository = createSellerOsLunaLinkageApprovalRepositoryV1({
    rpc: async (name, parameters) => {
      calls.push({ name, parameters })
      return { data: [{ outcome: "CREATED", decisionReference:
        parameters.p_decision_reference }], error: null }
    },
  })
  const receipt = await repository.recordDecision({
    contractVersion: "SELLER_OS_LUNA_LINKAGE_DECISION_V1",
    reviewCandidateId: entry.reviewCandidateId, reviewSetId: set.reviewSetId,
    actorUserId: ACTOR, accountKey: ACCOUNT, marketplaceId: "EBAY_US",
    currentCohortId: COHORT, ebayItemId: entry.ebayItemId,
    ebaySku: entry.ebaySku, listingTitle: entry.listingTitle,
    linkageId: entry.linkageId,
    lunaProductId: entry.components[0].lunaProductId,
    lunaVariantId: entry.components[0].lunaVariantId,
    lunaSku: entry.components[0].lunaSku, components: entry.components,
    supplierQuantityRequired: 1, evidenceReferences: entry.evidenceReferences,
    evidenceDigest: entry.evidenceDigest, evidenceObservedAt: NOW,
    reviewObservedAt: NOW, evidenceMaximumAgeSeconds: 21600,
    evidenceFreshness: "CURRENT",
    identityEvidenceProvenance: IDENTITY_EVIDENCE_PROVENANCE,
    provenance: { authorityClass: "HUMAN_DECISION",
      identityEvidenceClass: "SUPPLIER_CURRENT_IDENTITY",
      stockEvidenceUsed: false,
      identityEvidenceProvenance: IDENTITY_EVIDENCE_PROVENANCE },
    decision: "APPROVE_EXACT_LINKAGE", decisionVersion: 1,
    decisionAt: NOW, decisionReference,
    decisionPayloadDigest: `sha256:${"e".repeat(64)}`,
  })
  assert.equal(receipt.outcome, "CREATED")
  assert.equal(calls[0].name, "record_seller_os_luna_linkage_decision_v1")
  assert.equal(Object.keys(calls[0].parameters).some((key) =>
    /luna|product|variant|component|url|account|sql|credential|cookie/i
      .test(key)), false)
})

test("contradictory or failed RPC receipts fail closed", async () => {
  const repository = createSellerOsLunaLinkageApprovalRepositoryV1({
    rpc: async () => ({ data: [{ outcome: "CREATED",
      reviewSetId: "wrong", candidateCount: 99 }], error: null }),
  })
  await assert.rejects(repository.replaceReviewSet(review()),
    /LUNA_LINKAGE_REVIEW_PERSISTENCE_RECEIPT_INVALID/)
})
