import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value === "server-only") {
      return { url: "data:text/javascript,export default {}", shortCircuit: true }
    }
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
const admin = await import(
  "./ebay-luna-linkage-approval-admin-server-v1.ts"
)

const ACCOUNT = `seller:${"a".repeat(64)}`
const COHORT = `current-live:EBAY_US:${"b".repeat(20)}`
const NOW = "2026-08-22T18:00:00.000Z"
const REFERENCE = `luna-identity-v1:sha256:${"c".repeat(64)}`
const PROVENANCE = Object.freeze({
  contractVersion: "SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1",
  sourceStatus: "AVAILABLE",
  acquisitionMethod: "CANONICAL_SERVER_READ_IDENTITY_ONLY",
})

function reviewSet() {
  const entries = Array.from({ length: 26 }, (_, index) =>
    control.buildSellerOsLunaLinkageReviewEntryV2({
      currentCohortId: COHORT,
      accountKey: ACCOUNT,
      ebayItemId: (366582586826n + BigInt(index)).toString(),
      ebaySku: `IMN-LST-${String(index + 1).padStart(6, "0")}`,
      listingTitle: `Current live exact listing ${index + 1}`,
      classification: "EXACT_UNIQUE_MATCH",
      linkageMode: index === 0 ? "SIMPLE_MULTIPLIER" : "SINGLE_COMPONENT",
      components: [{
        lunaProductId: (9220805755104n + BigInt(index)).toString(),
        lunaVariantId: (48809607659744n + BigInt(index)).toString(),
        lunaSku: `ITEM${5810 + index}`,
        productTitle: `Luna product ${index + 1}`,
        variantTitle: "Black",
        supplierQuantityRequired: index === 0 ? 3 : 1,
        quantityBasis: "STRUCTURED_EVIDENCE",
        variantPresence: "PRESENT",
        exactProductIdentity: true,
        exactVariantIdentity: true,
        exactSupplierSku: true,
        structuredVariantAttributesComplete: true,
        identityConflict: false,
      }],
      matchSignals: ["EXACT_SUPPLIER_SKU"],
      conflictSignals: [],
      evidenceReferences: [REFERENCE],
      evidenceObservedAt: NOW,
      reviewObservedAt: NOW,
      identityEvidenceProvenance: PROVENANCE,
      decisionVersion: 1,
    }))
  return control.buildSellerOsLunaLinkageReviewSetV2({
    currentCohortId: COHORT,
    accountKey: ACCOUNT,
    currentLiveCount: 26,
    entries,
  })
}

function persistedRow(set, entry, overrides = {}) {
  const scalar = entry.components.length === 1 ? entry.components[0] : null
  return {
    review_candidate_id: entry.reviewCandidateId,
    review_set_id: set.reviewSetId,
    current_cohort_id: set.currentCohortId,
    account_key: set.accountKey,
    account_binding: entry.accountBinding,
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
    components: entry.components,
    supplier_quantity_required: scalar?.supplierQuantityRequired ?? null,
    match_signals: entry.matchSignals,
    conflict_signals: entry.conflictSignals,
    evidence_references: entry.evidenceReferences,
    evidence_digest: entry.evidenceDigest,
    evidence_observed_at: entry.evidenceObservedAt,
    review_observed_at: entry.reviewObservedAt,
    evidence_maximum_age_seconds: entry.evidenceMaximumAgeSeconds,
    identity_evidence_provenance: entry.identityEvidenceProvenance,
    evidence_freshness: entry.evidenceFreshness,
    decision_version: entry.decisionVersion,
    approval_eligible: entry.approvalEligibility.eligible,
    is_current: true,
    contract_version: entry.contractVersion,
    ...overrides,
  }
}

function mockClient(candidateRows, decisionRows = []) {
  const calls = []
  return {
    calls,
    client: {
      from(table) {
        const call = { table, filters: [], order: null, limit: null }
        calls.push(call)
        const query = {
          select(columns) { call.columns = columns; return query },
          eq(column, value) { call.filters.push([column, value]); return query },
          in(column, value) { call.filters.push([column, value]); return query },
          order(column, options) { call.order = [column, options]; return query },
          limit(value) { call.limit = value; return query },
          then(resolve, reject) {
            const data = table === "seller_os_luna_linkage_review_candidates"
              ? candidateRows : decisionRows
            return Promise.resolve({ data, error: null }).then(resolve, reject)
          },
        }
        return query
      },
    },
  }
}

function issueCsrf(set) {
  return control.createSellerOsLunaLinkageApprovalCsrfBoundaryV1().issue({
    actorUserId: "11111111-1111-4111-8111-111111111111",
    adminSessionToken: `session-${"z".repeat(64)}`,
    requestUrl:
      "http://127.0.0.1:3000/api/admin/ebay/luna-supplier-linkage-review",
    origin: null,
    secFetchSite: "same-origin",
    currentCohortId: set.currentCohortId,
    reviewSetDigest: set.reviewSetDigest,
  })
}

test("fixed loader reconstructs exactly one complete 26-row review set", async () => {
  const set = reviewSet()
  const rows = set.entries.map((entry) => persistedRow(set, entry))
  const harness = mockClient(rows, [{
    ebay_item_id: set.entries[0].ebayItemId,
    decision: "KEEP_UNPROVEN",
    decision_version: 1,
    decision_at: NOW,
    decision_reference:
      `luna-linkage-decision-v1:sha256:${"d".repeat(64)}`,
    evidence_digest: set.entries[0].evidenceDigest,
  }])
  const loaded = await admin.loadSellerOsLunaLinkageAdminReviewV1(
    harness.client)
  assert.equal(loaded.reviewSet.reviewSetId, set.reviewSetId)
  assert.equal(loaded.reviewSet.entries.length, 26)
  assert.equal(loaded.latestDecisions.length, 1)
  assert.deepEqual(harness.calls[0].filters, [
    ["marketplace_id", "EBAY_US"], ["is_current", true],
  ])
  assert.equal(harness.calls[0].limit, 27)
  assert.equal(harness.calls[1].limit, 101)
  assert.deepEqual(harness.calls[1].filters.slice(0, 4), [
    ["account_key", ACCOUNT], ["marketplace_id", "EBAY_US"],
    ["current_cohort_id", COHORT], ["review_set_id", set.reviewSetId],
  ])
  const payload = admin.buildSellerOsLunaLinkageAdminReviewPayloadV1({
    loaded,
    csrf: issueCsrf(set),
    observedAt: NOW,
  })
  assert.equal(payload.reviewSet.currentLiveCount, 26)
  assert.equal(payload.reviewSet.entries[0].decisionWindowStatus, "CURRENT")
  assert.equal(payload.reviewSet.entries[0].stockCertification.status,
    "NOT_EVALUATED")
  assert.equal("accountKey" in payload.reviewSet, false)
  assert.equal(JSON.stringify(payload).includes(ACCOUNT), false)
  assert.equal(payload.safety.productionLunaPolling, 0)
  assert.equal(payload.safety.ebayWrites, 0)
})

test("loader fails closed for incomplete, duplicate, or changed persisted evidence", async (t) => {
  const set = reviewSet()
  const rows = set.entries.map((entry) => persistedRow(set, entry))
  const cases = [
    ["25 rows", rows.slice(0, 25), /COMPLETE_SET_REQUIRED/],
    ["27 rows", [...rows, { ...rows[0] }], /COMPLETE_SET_REQUIRED/],
    ["duplicate item", [...rows.slice(0, 25), { ...rows[0] }],
      /MIXED_OR_DUPLICATE_SET/],
    ["changed digest", [{ ...rows[0], evidence_digest:
      `sha256:${"e".repeat(64)}` }, ...rows.slice(1)], /ROW_MISMATCH/],
    ["changed candidate id", [{ ...rows[0], review_candidate_id:
      `luna-linkage-review-candidate-v1:sha256:${"f".repeat(64)}` },
    ...rows.slice(1)], /SET_DIGEST_MISMATCH/],
  ]
  for (const [name, candidateRows, expected] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        admin.loadSellerOsLunaLinkageAdminReviewV1(
          mockClient(candidateRows).client), expected)
    })
  }
})

test("Admin POST parser accepts exact six server-bound fields only", () => {
  const set = reviewSet()
  const entry = set.entries[0]
  const valid = {
    reviewSetId: set.reviewSetId,
    currentCohortId: set.currentCohortId,
    ebayItemId: entry.ebayItemId,
    candidateEvidenceDigest: entry.evidenceDigest,
    decision: "APPROVE_EXACT_LINKAGE",
    decisionVersion: 1,
  }
  assert.deepEqual(admin.parseSellerOsLunaLinkageAdminDecisionRequestV1(valid),
    valid)
  for (const injected of [
    { lunaProductId: "9220805755104" },
    { lunaVariantId: "48809607659744" },
    { url: "https://example.com" },
    { components: [] },
    { accountKey: ACCOUNT },
    { sql: "select 1" },
  ]) {
    assert.throws(() =>
      admin.parseSellerOsLunaLinkageAdminDecisionRequestV1({
        ...valid, ...injected,
      }), /CALLER_INPUT_REJECTED/)
  }
  const { reviewSetId: _omitted, ...withoutSet } = valid
  assert.throws(() =>
    admin.parseSellerOsLunaLinkageAdminDecisionRequestV1(withoutSet),
  /CALLER_INPUT_REJECTED/)
})

test("decision-time stale payload disables every operator decision", async () => {
  const set = reviewSet()
  const loaded = await admin.loadSellerOsLunaLinkageAdminReviewV1(
    mockClient(set.entries.map((entry) => persistedRow(set, entry))).client)
  const payload = admin.buildSellerOsLunaLinkageAdminReviewPayloadV1({
    loaded,
    csrf: issueCsrf(set),
    observedAt: "2026-08-23T01:00:01.000Z",
  })
  assert.equal(payload.reviewSet.entries.every((entry) =>
    entry.decisionWindowStatus === "STALE" &&
    entry.allowedOperatorDecisions.length === 0), true)
})

test("a decision row for changed evidence cannot bleed into the current set", async () => {
  const set = reviewSet()
  const rows = set.entries.map((entry) => persistedRow(set, entry))
  await assert.rejects(admin.loadSellerOsLunaLinkageAdminReviewV1(
    mockClient(rows, [{
      ebay_item_id: set.entries[0].ebayItemId,
      decision: "KEEP_UNPROVEN",
      decision_version: 1,
      decision_at: NOW,
      decision_reference:
        `luna-linkage-decision-v1:sha256:${"d".repeat(64)}`,
      evidence_digest: `sha256:${"f".repeat(64)}`,
    }]).client), /DECISION_ROW_INVALID/)
})
