import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value === "server-only") return {
    url: "data:text/javascript,export default {}", shortCircuit: true,
  }
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { buildCommercialTracePricingDispatchV1 } = await import(
  "./seller-os-commercial-trace-pricing-enrichment-v1.ts")
const { buildEbaySellerKeywordDemandValidation } = await import(
  "./ebay-seller-keyword-demand-validation.ts")
const { buildCommercialMarketProjectionV1 } = await import(
  "./seller-os-live-commercial-trace-v1.ts")

const migration = readFileSync(
  "supabase/migrations/20260920224425_commercial_trace_browser_pricing_enrichment_v1.sql",
  "utf8")
const refreshMigration = readFileSync(
  "supabase/migrations/20260921002628_commercial_trace_pricing_enrichment_refresh_v1.sql",
  "utf8")
const runner = readFileSync(
  "app/admin/ebay/opportunity-queue/research/mayel-market-revalidation-runner.tsx",
  "utf8")
const service = readFileSync(
  "lib/ebay/seller-os-commercial-trace-pricing-enrichment-v1.ts", "utf8")
const gateway = readFileSync(
  "lib/ebay/ebay-seller-keyword-demand-gateway.ts", "utf8")

test("dispatch supports public SOLD/COMPLETED and near-exact research paths", () => {
  const dispatch = buildCommercialTracePricingDispatchV1({
    exactProductTitle: "CFS 7 Pack Watts Premier Replacement Filters WPRL-58",
    market: { acceptedComparables: [{ comparableId: "366617258035",
      title: "Watts Premier WPRL-58 Compatible Filter Seven Pack",
      comparableClass: "NEAR_EXACT_PRODUCT",
      pricingAuthorityEligible: true }], nearExactSoldEnrichment: {
        candidates: [{ comparableId: "366617258035",
          result: "NOT_AVAILABLE" }] } },
  })
  assert.equal(dispatch.tasks.length, 2)
  assert.deepEqual(dispatch.tasks.map((task) => task.acquisitionPath), [
    "PUBLIC_EBAY_SOLD_COMPLETED", "PRODUCT_RESEARCH_NEAR_EXACT_SOLD",
  ])
  assert.equal(dispatch.freeShippingRequired, false)
  assert.equal(dispatch.arbitraryUrlAllowed, false)
  assert.equal(dispatch.marketplaceWrites, 0)
})

test("dispatch is bounded and deduplicates identical search intents", () => {
  const acceptedComparables = Array.from({ length: 10 }, (_, index) => ({
    comparableId: String(300000000000 + index),
    title: index === 0 ? "Exact Water Filter WPRL-58" :
      `Exact Water Filter WPRL-58 Alternative ${index}`,
    comparableClass: "NEAR_EXACT_PRODUCT", pricingAuthorityEligible: true,
  }))
  const dispatch = buildCommercialTracePricingDispatchV1({
    exactProductTitle: "Exact Water Filter WPRL-58",
    market: { acceptedComparables, nearExactSoldEnrichment: {
      candidates: acceptedComparables.map((entry) => ({
        comparableId: entry.comparableId, result: "NOT_AVAILABLE" })) } },
  })
  assert.ok(dispatch.tasks.length >= 2 && dispatch.tasks.length <= 6)
  assert.equal(new Set(dispatch.tasks.map((task) =>
    task.searchQuery.toLowerCase())).size, dispatch.tasks.length)
})

test("confirmed durable SOLD from two item IDs and sellers preserves pricing gates", () => {
  const now = "2026-09-20T21:00:00.000Z"
  const candidate = { productName:
    "CFS Replacement Water Filters 7pk For Watts Premier WPRL-58",
    productTitle:
    "CFS Replacement Water Filters 7pk For Watts Premier WPRL-58",
    identityReferenceTitle:
    "CFS Replacement Water Filters 7pk For Watts Premier WPRL-58",
    model: "WPRL-58", packQuantity: 7 }
  const comparables = [
    { itemId: "123456789011", title:
      "CFS Replacement Water Filters 7pk Watts Premier WPRL-58",
      price: 36, shippingCost: 4, sellerUsername: "hmac-sha256:a",
      confirmedSoldQuantity: 2, lastSoldDate: now,
      soldHistorySource: "CONFIRMED_DURABLE_SOLD",
      durableSoldSourceType: "EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE",
      realizedPriceStatus: "REALIZED_PRICE_CONFIRMED",
      source: "EBAY_BROWSE_ACTIVE_LISTING" },
    { itemId: "123456789012", title:
      "CFS 7 Pack Replacement Filters for Watts Premier WPRL-58",
      price: 38, shippingCost: 3, sellerUsername: "hmac-sha256:b",
      confirmedSoldQuantity: 2, lastSoldDate: now,
      soldHistorySource: "CONFIRMED_DURABLE_SOLD",
      durableSoldSourceType: "EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE",
      realizedPriceStatus: "REALIZED_PRICE_CONFIRMED",
      source: "EBAY_BROWSE_ACTIVE_LISTING" },
  ]
  const report = buildEbaySellerKeywordDemandValidation({ candidate,
    comparables, asOf: now, nearExactSoldEnrichment: { status: "COMPLETED",
      budgetLimit: 6, candidateCount: 2, selectedCandidateCount: 2,
      attemptedCandidateCount: 2, durableSatisfiedCount: 2,
      completedCandidateCount: 2, pendingCandidateCount: 0, candidates: [] } })
  const market = buildCommercialMarketProjectionV1(report)
  assert.equal(market.pricingEvidenceQuality.strongDecisionAllowed, true)
  assert.equal(market.pricingEvidenceQuality.confirmedComparableCount, 2)
  assert.equal(market.pricingEvidenceQuality.confirmedSellerCount, 2)
  assert.deepEqual([market.priceRange.minimum, market.priceRange.maximum],
    [40, 41])
})

test("same eBay Item ID is deduplicated across acquisition sources", () => {
  assert.match(gateway,
    /const key = ebayComparableLegacyItemId\(comparable\.itemId\)/)
  assert.match(gateway,
    /EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE/)
  assert.match(service, /ebaySourceListingReferenceHash/)
  assert.match(service, /ebaySellerReferenceHash/)
})

test("durable queue is owner/account/trace bound and service-role only", () => {
  const durableSql = `${migration}\n${refreshMigration}`
  for (const binding of ["trace_id", "command_request_id",
    "marketplace_account_key", "owner_user_id", "command_client_id",
    "luna_product_id", "luna_variant_id", "supplier_sku",
    "source_fingerprint", "task_spec_digest", "receipt_digest",
    "mechanism_version", "generation", "predecessor_job_id",
    "predecessor_receipt_digest"]) {
    assert.match(durableSql, new RegExp(`\\b${binding}\\b`))
  }
  assert.match(migration, /force row level security/)
  assert.match(migration, /for update of job skip locked/)
  assert.match(migration, /is_seller_os_service_role_request_v1\(\)/g)
  assert.match(migration, /jsonb_array_length\(p_task_spec\) not between 1 and 6/)
  assert.doesNotMatch(migration,
    /ebay_active_listings|delete\s+from|truncate\s+|(?:insert|update)\s+[^;]*publisher/i)
  assert.match(refreshMigration, /generation between 1 and 3/)
  assert.match(refreshMigration,
    /trace_id,mechanism_version,refresh_reason/)
  assert.match(refreshMigration,
    /seller_os_commercial_trace_pricing_active_trace_v1_uidx/)
  assert.match(refreshMigration,
    /v_pricing_eligible>=2 and v_distinct_sellers>=2/)
  assert.match(refreshMigration, /v_latest\.generation>=3/)
  assert.match(refreshMigration,
    /COMMERCIAL_TRACE_PRICING_ENRICHMENT_MATERIAL_IMPROVEMENT_NOT_PROVEN/)
  assert.match(refreshMigration,
    /COMMERCIAL_TRACE_PRICING_ENRICHMENT_REFRESH_EXHAUSTED/)
  assert.doesNotMatch(refreshMigration,
    /ebay_active_listings|delete\s+from|truncate\s+|(?:insert|update)\s+[^;]*publisher/i)
})

test("PostgreSQL executes the targeted enqueue and SKIP LOCKED claim contract", async () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create table public.seller_os_live_commercial_traces_v1(
      trace_id uuid primary key, account_key text not null,
      product_url text not null, started_by uuid, state text not null,
      result jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default clock_timestamp());
    create table public.seller_os_commercial_trace_command_requests_v1(
      request_id uuid primary key, trace_id uuid not null unique references
        public.seller_os_live_commercial_traces_v1(trace_id),
      marketplace_account_key text not null, owner_user_id uuid not null,
      command_client_id text not null, luna_product_id text not null,
      luna_variant_id text not null, supplier_sku text not null,
      canonical_url text not null, source_fingerprint text not null);
    create function public.is_seller_os_service_role_request_v1()
    returns boolean language sql immutable as 'select true';
  `)
  await db.exec(migration)
  const owner = "10000000-0000-4000-8000-000000000001"
  const trace = "20000000-0000-4000-8000-000000000002"
  const request = "30000000-0000-4000-8000-000000000003"
  const account = `seller:${"a".repeat(64)}`
  const url = "https://lunaportex.com/products/water-filter"
  const fingerprint = `sha256:${"b".repeat(64)}`
  await db.query(`insert into auth.users(id) values($1)`, [owner])
  await db.query(`insert into public.seller_os_live_commercial_traces_v1(
    trace_id,account_key,product_url,started_by,state,result)
    values($1,$2,$3,$4,'COMPLETED',
      '{"FINAL_DECISION":"HOLD_PRICING_EVIDENCE_QUALITY"}')`,
  [trace, account, url, owner])
  await db.query(`insert into
    public.seller_os_commercial_trace_command_requests_v1(
      request_id,trace_id,marketplace_account_key,owner_user_id,
      command_client_id,luna_product_id,luna_variant_id,supplier_sku,
      canonical_url,source_fingerprint)
    values($1,$2,$3,$4,'chatgpt-control-client','9220790976736',
      '48809590227168','ITEM6952',$5,$6)`,
  [request, trace, account, owner, url, fingerprint])
  const task = [{ ordinal: 1, sourceComparableId: "LUNA_EXACT_PRODUCT",
    searchQuery: "Watts Premier WPRL-58 water filters",
    acquisitionPath: "PUBLIC_EBAY_SOLD_COMPLETED" }]
  const digest = `sha256:${"c".repeat(64)}`
  const enqueued = await db.query(`select
    public.enqueue_seller_os_commercial_trace_pricing_enrichment_v1(
      $1,$2,'9220790976736','48809590227168','ITEM6952',$3,$4,$5::jsonb,$6)
      as value`, [trace, account, url, fingerprint, JSON.stringify(task), digest])
  assert.equal(enqueued.rows[0].value.state, "PENDING")
  const claimed = await db.query(`select
    public.claim_seller_os_commercial_trace_pricing_enrichment_v1(
      $1,$2,'product-research-browser:worker-001') as value`, [account, owner])
  assert.equal(claimed.rows[0].value.claimed, true)
  assert.equal(claimed.rows[0].value.traceId, trace)
  assert.equal(claimed.rows[0].value.tasks[0].acquisitionPath,
    "PUBLIC_EBAY_SOLD_COMPLETED")
  const receipt = { contractVersion:
      "SELLER_OS_COMMERCIAL_TRACE_PRICING_ENRICHMENT_RECEIPT_V1",
    jobId: claimed.rows[0].value.jobId, traceId: trace,
    lunaProductId: "9220790976736", lunaVariantId: "48809590227168",
    supplierSku: "ITEM6952", sourceFingerprint: fingerprint,
    taskSpecDigest: digest, rows: [], marketplaceWrites: 0 }
  const completed = await db.query(`select
    public.complete_seller_os_commercial_trace_pricing_enrichment_v1(
      $1,$2,$3,'product-research-browser:worker-001',$4::jsonb,$5) as value`,
  [claimed.rows[0].value.jobId, account, owner, JSON.stringify(receipt),
    `sha256:${"d".repeat(64)}`])
  assert.equal(completed.rows[0].value.completed, true)
  const durable = await db.query(`select state,receipt->>'traceId' as trace_id
    from public.seller_os_commercial_trace_pricing_enrichment_jobs_v1`)
  assert.deepEqual(durable.rows, [{ state: "COMPLETED", trace_id: trace }])

  const legacyReceiptDigest = `sha256:${"d".repeat(64)}`
  await db.exec(refreshMigration)
  await db.query(`update public.seller_os_live_commercial_traces_v1
    set updated_at=clock_timestamp() where trace_id=$1`, [trace])
  const mechanism =
    "COMMERCIAL_TRACE_PRICING_BROWSER_CAPTURE_V2_EXTENSION_1_2_40"
  const refreshDigest = `sha256:${"e".repeat(64)}`
  const refreshed = await db.query(`select
    public.enqueue_seller_os_commercial_trace_pricing_enrichment_v2(
      $1,$2,'9220790976736','48809590227168','ITEM6952',$3,$4,$5::jsonb,$6,$7)
      as value`, [trace, account, url, fingerprint, JSON.stringify(task),
      refreshDigest, mechanism])
  assert.equal(refreshed.rows[0].value.created, true)
  assert.equal(refreshed.rows[0].value.generation, 2)
  assert.equal(refreshed.rows[0].value.refreshReason, "MECHANISM_UPGRADE")
  assert.equal(refreshed.rows[0].value.predecessorReceiptDigest,
    legacyReceiptDigest)

  const duplicate = await db.query(`select
    public.enqueue_seller_os_commercial_trace_pricing_enrichment_v2(
      $1,$2,'9220790976736','48809590227168','ITEM6952',$3,$4,$5::jsonb,$6,$7)
      as value`, [trace, account, url, fingerprint, JSON.stringify(task),
      refreshDigest, mechanism])
  assert.equal(duplicate.rows[0].value.created, false)
  assert.equal(duplicate.rows[0].value.jobId, refreshed.rows[0].value.jobId)

  const refreshedClaim = await db.query(`select
    public.claim_seller_os_commercial_trace_pricing_enrichment_v1(
      $1,$2,'product-research-browser:worker-001') as value`, [account, owner])
  assert.equal(refreshedClaim.rows[0].value.claimed, true)
  assert.equal(refreshedClaim.rows[0].value.mechanismVersion, mechanism)
  const refreshReceipt = { contractVersion:
      "SELLER_OS_COMMERCIAL_TRACE_PRICING_ENRICHMENT_RECEIPT_V1",
    mechanismVersion: mechanism, extensionVersion: "1.2.40",
    extensionId: "llngdlffmjbnbmbffkfbknkkddjoknka",
    jobId: refreshedClaim.rows[0].value.jobId, traceId: trace,
    generation: 2, predecessorJobId: claimed.rows[0].value.jobId,
    predecessorReceiptDigest: legacyReceiptDigest,
    lunaProductId: "9220790976736", lunaVariantId: "48809590227168",
    supplierSku: "ITEM6952", sourceFingerprint: fingerprint,
    taskSpecDigest: refreshDigest, rows: [], marketplaceWrites: 0 }
  const refreshedCompleted = await db.query(`select
    public.complete_seller_os_commercial_trace_pricing_enrichment_v1(
      $1,$2,$3,'product-research-browser:worker-001',$4::jsonb,$5) as value`,
  [refreshedClaim.rows[0].value.jobId, account, owner,
    JSON.stringify(refreshReceipt), `sha256:${"f".repeat(64)}`])
  assert.equal(refreshedCompleted.rows[0].value.completed, true)
  const generations = await db.query(`select generation,state,receipt_digest,
      predecessor_job_id,predecessor_receipt_digest
    from public.seller_os_commercial_trace_pricing_enrichment_jobs_v1
    order by generation`)
  assert.equal(generations.rows.length, 2)
  assert.equal(generations.rows[0].receipt_digest, legacyReceiptDigest)
  assert.equal(generations.rows[1].predecessor_job_id,
    claimed.rows[0].value.jobId)
  assert.equal(generations.rows[1].predecessor_receipt_digest,
    legacyReceiptDigest)
  await db.close()
})

test("worker exposes only the fixed browser command and zero marketplace writes", () => {
  assert.match(runner, /CLAIM_COMMERCIAL_TRACE_PRICING_ENRICHMENT/)
  assert.match(runner, /IMNOVA_EBAY_NEAR_EXACT_SOLD_ENRICHMENT_V1/)
  assert.match(runner, /remainingRows !== 60/)
  assert.match(runner, /freeShippingRequired !== false/)
  assert.match(runner, /arbitraryUrlAllowed !== false/)
  assert.match(runner, /captured\.marketplaceWrites !== 0/)
  assert.doesNotMatch(runner, /COMMERCIAL_TRACE.*(?:url|href)/i)
})
