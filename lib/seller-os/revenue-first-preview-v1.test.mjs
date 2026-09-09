import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { prepareRevenueFirstListingPreviewV1 } from "./revenue-first-preview-v1.ts"
import { readSellerOsProductCaseAuditV1 } from "./audit-observability-gateway-v1.ts"
import { keywordWireDigestV1 } from "./keyword-intelligence-handoff-v1.ts"
import { revenueFailureV1, RevenueDependencyErrorV1 } from "./revenue-first-diagnostics-v1.ts"
import { readDurableListingQualityArtifactV1, readOwnerListingQualityReportStatusV1,
  readRemoteListingQualitySignalsV1 } from "../ebay/ebay-listing-quality-report-owner-import-v1.ts"
import { normalizeEbayListingQualityReport } from "../ebay/ebay-commercial-monitor-intelligence-v1.ts"
import { executeSellerOsAssistantToolV1 } from "../ebay/ebay-seller-os-assistant-gateway-v1.ts"
import { canGenerateVisualFindingV1 } from "../ebay/ebay-visual-generation-capabilities-v1.ts"
import { createSellerOsVisualVariantsV1 } from "../ebay/ebay-seller-os-visual-variant-v1.ts"

const account = "seller:test", itemId = "366643122092", now = new Date("2026-09-09T15:00:00Z")
const opportunityId = "11111111-1111-4111-8111-111111111111"
const packageId = "22222222-2222-4222-8222-222222222222"
const binding = { ACCOUNT_KEY: account, PRODUCT_ID: "9220873322720", VARIANT_ID: "48809689415904",
  CANDIDATE_KEY: "sha256:" + "b".repeat(64), OPPORTUNITY_ID: opportunityId,
  PLAN_ID: "33333333-3333-4333-8333-333333333333" }
const monitor = { listings: [{ key: "live", identity: { itemId, sku: "EXACT" },
  discovery: { livePresence: { status: "LIVE_ACTIVE" } } }] }
function keyword(ready = true) {
  const version = "PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1", authority = "sha256:" + "a".repeat(64)
  const decision = { DECISION_VERSION: version, INPUT_AUTHORITY_FINGERPRINT: authority,
    INPUT_FINGERPRINT: "sha256:" + createHash("sha256").update(`[${JSON.stringify(version)}, ${JSON.stringify(authority)}]`).digest("hex"),
    KEYWORD_DECISION_READY: ready, BLOCKERS: ready ? [] : ["NO_DEFENSIBLE_PRIMARY_QUERY_CONCEPT"],
    PRIMARY_KEYWORD: ready ? "phone holder" : "UNPROVEN", TERMS: ready ? [
      { TERM: "phone holder", CLASSIFICATION: "PRIMARY_KEYWORD" },
      { TERM: "black", CLASSIFICATION: "CORE_QUALIFIERS" },
      { TERM: "unsupported brand", CLASSIFICATION: "REJECTED_TERMS" }] : [] }
  return { READ_CONTRACT_VERSION: "PRODUCT_RESEARCH_KEYWORD_HANDOFF_READ_V1", STATUS: ready ? "READY" : "NEEDS_EVIDENCE",
    BINDING: binding, DECISION: decision, BLOCKERS: decision.BLOCKERS,
    VALIDATION: { CURRENT_INPUTS_MATCH: true,
      TRANSPORT_DIGEST: keywordWireDigestV1({ BINDING: binding, DECISION: decision }) } }
}
function fixtures() {
  return {
    ebay_manual_listing_links: [{ id: "exact-link", account_key: account, marketplace_id: "EBAY_US", ebay_item_id: itemId,
      opportunity_id: opportunityId, candidate_key: binding.CANDIDATE_KEY,
      verification_status: "verified", connector_listing_status: "active", verified_at: now.toISOString() }],
    ebay_active_listings: [
      { id: "new", account_key: account, ebay_item_id: itemId, last_ebay_sync_at: now.toISOString(),
        supplier_variant_id: null, supplier_sku: null, ebay_quantity: 1, ebay_price: 22.98 },
      { id: "old", account_key: account, ebay_item_id: itemId, last_ebay_sync_at: "2026-09-01T00:00:00Z",
        supplier_variant_id: binding.VARIANT_ID, supplier_sku: "EXACT" }],
    ebay_luna_opportunity_queue: [{ id: opportunityId, candidate_key: binding.CANDIDATE_KEY,
      supplier_product_id: binding.PRODUCT_ID, supplier_variant_id: binding.VARIANT_ID,
      supplier_sku: "EXACT", product_title: "Black ABS Adjustable Phone Holder", assessment: {
        productTruth: { exact: true, title: "Black ABS Adjustable Phone Holder" },
        listingIntelligencePackage: { titleStrategy: { primarySearchPhrase: "LEGACY UNRELATED WORD" } },
        canonicalMarketplaceReadinessV1: { ready: true, categoryId: "35190", conditionId: "1000",
          requiredItemSpecificsReady: true },
        quickPickMarketTestReviewV1: { finalDecision: "MARKET_TEST_READY", testPrice: 29.99,
          supplierCost: 5.5, shipping: 6.99, ebayFees: 5.21, profit: 8.29, margin: 27.64, roi: 150.73 },
      } }, { id: "other-opportunity", candidate_key: "other-candidate", supplier_variant_id: binding.VARIANT_ID }],
    ebay_listing_packages: [{ id: packageId, opportunity_id: opportunityId, account_key: account,
      candidate_key: binding.CANDIDATE_KEY, status: "approved", package_data: {
        title: "Owner approved phone holder", description: "Owner approved description.", categoryId: "35190",
        conditionId: "1000", itemSpecifics: { Material: "ABS" }, imageUrls: ["https://i.ebayimg.com/images/g/a/s-l1600.jpg"],
        pricing: { supplierCost: 5.5, targetPrice: 29.99 } } }],
    ebay_listing_quality_report_imports: [report("new-report", "2026-09-09", "2026-09-09T01:00:00Z"),
      report("uploaded-last", "2026-09-08", "2026-09-09T14:00:00Z")],
    ebay_listing_quality_report_signals: [],
  }
}
function report(id, date, importedAt) { return { id, marketplace_account_key: account, marketplace: "EBAY_US",
  report_date: date, report_observed_at: date + "T00:00:00Z", imported_at: importedAt,
  live_listings_covered: 12, current_live_count: 17, signals_imported: 0,
  signals_actionable: 0, signals_need_evidence: 0, nonlive_rows_excluded: 5 } }
// This fake executes filters and stable ordering; it fails immediately on writes.
function database(tables, options = {}) {
  const queries = []
  return { queries, rpc: async name => ({ data: name === "read_product_research_keyword_handoff_v1"
    ? options.keyword ?? keyword() : null, error: null }), from(table) {
    const filters = [], order = []; let maximum = Infinity, single = false
    const q = { select() { return q }, eq(k, v) { filters.push([k, v]); return q },
      order(k, opts) { order.push([k, opts]); return q }, limit(n) { maximum = n; return q },
      maybeSingle() { single = true; return q },
      then(resolve, reject) { queries.push({ table, filters, order })
        let data = (tables[table] ?? []).filter(row => filters.every(([k, v]) => row[k] === v))
        data = [...data].sort((a, b) => { for (const [k, opts] of order) {
          const c = String(a[k] ?? "").localeCompare(String(b[k] ?? ""))
          if (c) return opts.ascending ? c : -c
        } return 0 }).slice(0, maximum)
        return Promise.resolve({ data: single ? data[0] ?? null : data,
          error: options.failTable === table ? { code: "READ_FAILED" } : null }).then(resolve, reject)
      }, insert() { throw Error("UNEXPECTED_WRITE") }, update() { throw Error("UNEXPECTED_WRITE") },
      delete() { throw Error("UNEXPECTED_WRITE") } }
    return q
  } }
}

test("Quality resolves report date before upload date, keeps zero-signal existence, isolates account", async () => {
  const tables = fixtures(), db = database(tables)
  tables.ebay_listing_quality_report_imports.push({ ...report("foreign", "2026-09-10", now.toISOString()), marketplace_account_key: "other" })
  const artifact = await readDurableListingQualityArtifactV1({ supabase: db, accountKey: account, now: now.toISOString() })
  assert.equal(artifact.importId, "new-report")
  const projected = normalizeEbayListingQualityReport({ artifact, listings: monitor.listings })
  assert.equal(projected.status, "AVAILABLE"); assert.equal(projected.reportExists, true)
  assert.deepEqual(projected.recommendations, []); assert.equal(projected.coverage.historicalLiveScopeCount, 17)
  const tool = executeSellerOsAssistantToolV1({ toolName: "seller_os_get_quality_guidance", arguments: {},
    monitor: { ...monitor, backend: { listingQualityReport: projected, guidanceVsSellerOs: [] } } })
  assert.equal(tool.importId, artifact.importId); assert.equal(tool.resultCount, 0)
  assert.deepEqual(db.queries[0].order.map(([name]) => name), ["report_date", "imported_at", "id"])
})
test("STALE report and signal cannot retain historical actionable count", async () => {
  const tables = fixtures(); tables.ebay_listing_quality_report_imports = [{ ...report("stale", "2026-09-04", now.toISOString()), signals_imported: 1, signals_actionable: 1 }]
  tables.ebay_listing_quality_report_signals = [{ id: "signal", report_import_id: "stale", item_id: itemId,
    freshness: "CURRENT", priority_class: "ENRICH", product_truth_supported: true, operator_action_required: true }]
  const input = { supabase: database(tables), accountKey: account, now: now.toISOString() }
  const status = await readOwnerListingQualityReportStatusV1(input), signals = await readRemoteListingQualitySignalsV1(input)
  assert.equal(status.reportExists, true); assert.equal(status.signalsActionable, 0)
  assert.equal(signals[0].priorityClass, "WAIT"); assert.equal(signals[0].operatorActionRequired, false)
})
test("Assistant locates a newly uploaded older report without replacing the latest report authority", async () => {
  const tables = fixtures()
  tables.ebay_listing_quality_report_imports.push(report("older-upload", "2026-08-27", now.toISOString()))
  tables.ebay_listing_quality_report_upload_attempts = [{ id: "attempt", marketplace_account_key: account,
    attempted_at: now.toISOString(), attempt_status: "IMPORTED", valid_import_id: "older-upload", rows_parsed: 12, current_live_rows_matched: 12 },
    { id: "foreign-attempt", marketplace_account_key: "other", attempted_at: "2026-09-10", valid_import_id: "foreign" }]
  const artifact = await readDurableListingQualityArtifactV1({ supabase: database(tables), accountKey: account, now: now.toISOString() })
  const projected = normalizeEbayListingQualityReport({ artifact, listings: monitor.listings })
  const result = executeSellerOsAssistantToolV1({ toolName: "seller_os_get_quality_guidance", arguments: {},
    monitor: { ...monitor, backend: { listingQualityReport: projected, guidanceVsSellerOs: [] } } })
  assert.equal(result.importId, "new-report")
  assert.equal(result.latestUploadAttempt.validImportId, "older-upload")
  assert.equal(result.latestUploadAttempt.attemptId, "attempt")
  assert.equal(result.latestUploadAttempt.freshness, "STALE")
  assert.equal(result.latestUploadAttempt.selectedAsLatestValidReport, false)
  const unavailable = await readDurableListingQualityArtifactV1({ supabase: database(tables, { failTable: "ebay_listing_quality_report_upload_attempts" }), accountKey: account, now: now.toISOString() })
  assert.equal(unavailable.importId, "new-report")
  assert.equal(unavailable.latestUploadAttempt.status, "UNAVAILABLE")
})
test("Quality read failure is unavailable and distinct from a missing import", async () => {
  await assert.rejects(readDurableListingQualityArtifactV1({ supabase: database({}, { failTable: "ebay_listing_quality_report_imports" }), accountKey: account }))
  for (const [artifact, exists, status] of [[{ durable: true, status: "UNAVAILABLE" }, null, "UNAVAILABLE"],
    [await readDurableListingQualityArtifactV1({ supabase: database({}), accountKey: account }), false, "MISSING"]]) {
    const result = normalizeEbayListingQualityReport({ artifact, listings: [] })
    assert.equal(result.reportExists, exists); assert.equal(result.status, status)
  }
})
test("Item ID and Package ID resolve the exact same candidate despite duplicate LIVE rows and variants", async () => {
  const supabase = database(fixtures())
  const byItem = await readSellerOsProductCaseAuditV1({ supabase, accountKey: account, identityType: "EBAY_ITEM_ID", identity: itemId, now })
  const byPackage = await readSellerOsProductCaseAuditV1({ supabase, accountKey: account, identityType: "LISTING_PACKAGE_ID", identity: packageId, now })
  assert.equal(byItem.RESOLVED_CANONICAL_IDENTITY.candidateId, binding.CANDIDATE_KEY)
  assert.equal(byItem.RESOLVED_CANONICAL_IDENTITY.candidateId, byPackage.RESOLVED_CANONICAL_IDENTITY.candidateId)
  assert.equal(byItem.IDENTITY_LINKAGE_PROVENANCE.linkId, "exact-link")
  assert.equal(byItem.KEYWORD_INTELLIGENCE.DECISION.PRIMARY_KEYWORD, "phone holder")
})
test("Conflicting verified links fail closed before candidate selection", async () => {
  const tables = fixtures(); tables.ebay_manual_listing_links.push({ ...tables.ebay_manual_listing_links[0], id: "conflict", candidate_key: "other" })
  const db = database(tables), result = await readSellerOsProductCaseAuditV1({ supabase: db, accountKey: account, identityType: "EBAY_ITEM_ID", identity: itemId, now })
  assert.equal(result.CONTRADICTION, "EXACT_LISTING_LINK_AMBIGUOUS")
  assert.equal(db.queries.some(q => q.table === "ebay_luna_opportunity_queue"), false)
})
test("Preview consumes Keyword V2.1, preserves approved content and has stable material digest", async () => {
  const tables = fixtures(), before = JSON.stringify(tables), db = database(tables)
  const first = await prepareRevenueFirstListingPreviewV1({ supabase: db, accountKey: account, itemId, monitor, now })
  const again = await prepareRevenueFirstListingPreviewV1({ supabase: db, accountKey: account, itemId, monitor, now })
  assert.equal(first.keywordIntelligence.STATUS, "ACCEPTED")
  assert.equal(first.preview.title, "Owner approved phone holder")
  assert.equal(first.previewDigest, again.previewDigest)
  assert.equal(first.safety.persistenceUsed, false); assert.equal(first.safety.canPublish, false)
  assert.equal(first.safety.providerCalls, 0); assert.equal(JSON.stringify(tables), before)
})
test("Existing NEEDS_EVIDENCE remains blocked with no keyword fallback or changed approved content", async () => {
  const result = await prepareRevenueFirstListingPreviewV1({ supabase: database(fixtures(), { keyword: keyword(false) }), accountKey: account, itemId, monitor, now })
  assert.equal(result.status, "NEEDS_EVIDENCE"); assert.equal(result.DEPENDENCY_STAGE, "KEYWORD_INTELLIGENCE")
  assert.deepEqual(result.preview, result.original)
  assert.equal(result.keywordIntelligence.LEGACY_FALLBACK_USED, false)
  assert.ok(result.blockers.includes("NO_DEFENSIBLE_PRIMARY_QUERY_CONCEPT"))
})
test("Failure quartet preserves trace and dependency while discarding untrusted messages", () => {
  const original = new RevenueDependencyErrorV1("IMAGE_PROVIDER_TRANSPORT_FAILED", "IMAGE_PROVIDER")
  const projected = revenueFailureV1(original, "ASSISTANT_RELAY", "SELLER_OS_TOOL_FAILED_CLOSED")
  assert.equal(projected.TRACE_ID, original.TRACE_ID); assert.equal(projected.DEPENDENCY_STAGE, "IMAGE_PROVIDER")
  const malicious = revenueFailureV1(new Error("Bearer private_test_material user@example.com"), "COPILOT", "SELLER_OS_TOOL_FAILED_CLOSED")
  assert.doesNotMatch(JSON.stringify(malicious), /private_test|example.com|Bearer/)
})
test("Unsupported image finding cannot call provider or persistence", async () => {
  assert.equal(canGenerateVisualFindingV1("LOW_SOURCE_RESOLUTION"), false)
  assert.equal(canGenerateVisualFindingV1("EDGE_CROPPING_RISK"), true)
  let calls = 0
  await assert.rejects(createSellerOsVisualVariantsV1({ supabase: database({}), monitor, accountKey: account,
    actorId: null, ebayItemId: itemId, findingCode: "LOW_SOURCE_RESOLUTION", variantCount: 1,
    apiKey: "test-mock-only", fetchImpl: async () => { calls++; throw Error("UNEXPECTED_NETWORK") } }), /MATERIAL_REASON_REQUIRED/)
  assert.equal(calls, 0)
})
