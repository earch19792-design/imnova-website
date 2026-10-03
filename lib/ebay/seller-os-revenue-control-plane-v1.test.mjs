import test from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(specifier)) {
    try { return nextResolve(`${specifier}.ts`, context) } catch { /* continue */ }
  }
  return nextResolve(specifier, context)
} })
const { classifyRevenueLiveDuplicateV1,
  readSellerOsRevenueControlPlaneV1 } = await import(
    "./seller-os-revenue-control-plane-v1.ts")

const now = new Date("2026-09-26T12:00:00.000Z")
const recent = "2026-09-26T11:55:00.000Z"
const until = "2026-09-26T12:10:00.000Z"
const old = "2026-09-25T11:55:00.000Z"
const ids = ["ITEM3635", "ITEM3734", "Alibaba-Razor-ShaverforMen-B0CQ45KVVP",
  "Alibaba-Pot&Pan-OrganizerRack-B094JBXLWM",
  "FL-NHGO1612102-2-Adjustable-opening",
  "FL-RARE-SEA-TURTLE-RING-SIZE7", "FL-EAGLE-RING"]
const itemIds = ids.map((_, index) => String(366700000001 + index))
const tuples = ids.map((sku, index) => ({ supplierSku: sku,
  supplierProductId: String(9220000000000 + index),
  supplierVariantId: String(48800000000000 + index) }))

class Query {
  constructor(rows, calls, table) { this.rows = rows; this.calls = calls;
    this.table = table; this.single = false; this.max = Infinity }
  select() { return this }
  eq(key, value) { this.rows = this.rows.filter((row) => row[key] === value);
    return this }
  neq(key, value) { this.rows = this.rows.filter((row) => row[key] !== value);
    return this }
  in(key, values) { this.rows = this.rows.filter((row) =>
    values.includes(row[key])); return this }
  order(key, options = {}) { this.rows.sort((a, b) =>
    String(a[key]).localeCompare(String(b[key])) *
    (options.ascending ? 1 : -1)); return this }
  limit(max) { this.max = max; return this }
  maybeSingle() { this.single = true; return this }
  then(resolve, reject) { this.calls.push(this.table)
    return Promise.resolve({ data: this.single ? this.rows[0] ?? null :
      this.rows.slice(0, this.max), error: null }).then(resolve, reject) }
}

function fixture({ current = true, shipping = [] } = {}) {
  const calls = []
  const tables = {
    seller_os_live_economic_evidence_v1: [],
    seller_os_live_listing_shipping_evidence: shipping,
    seller_os_ebay_fee_authorities_v1: [],
    marketplace_order_line_items: [],
    commercial_monitor_runs: [{ marketplace_account_key: "test-account",
      marketplace: "EBAY_US", trigger_source: "manual",
      started_at: recent, completed_at: recent,
      readers: { analytics: { status: "unavailable",
        error: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT_UNAVAILABLE" } } }],
    market_radar_latest_variants: [],
    seller_os_pre_research_batch_members_v1: [],
    seller_os_pre_research_batches_v1: [],
    marketplace_product_research_query_plans: [],
    seller_os_listing_registry_sweeps_v1: [],
    seller_os_listing_cases_v1: [],
    seller_os_live_commercial_traces_v1: [],
  }
  const supabase = { from(table) { assert.ok(table in tables, table)
    return new Query([...tables[table]], calls, table) } }
  const stockReader = async () => ({ cohortComplete: current,
    currentLiveState: current ? "CURRENT_FRESH" : "CURRENT_UNAVAILABLE",
    sourceStatus: { observations: "AVAILABLE" },
    listings: itemIds.map((itemId, index) => ({ itemId,
      sku: ids[index], title: `Listing ${index}`, supplierLinkage: "CERTIFIED",
      components: [tuples[index]], supplierAvailability: "IN_STOCK",
      stockFreshness: "FRESH", supplierStockQuantity: null,
      stockObservedAt: recent, stockFreshUntil: until,
      lastSuccessfulSource: "LUNA", linkAuthorityState: "ACTIVE",
      limitationCode: "NUMERIC_SAFE_CAPACITY_UNPROVEN" })) })
  const liveReader = async () => ({ lastCertifiedState: current
    ? "LAST_CERTIFIED_AVAILABLE" : "LAST_CERTIFIED_STALE",
    lastCertifiedListingCount: 7, lastCertifiedItemIds: itemIds,
    lastCertifiedAt: current ? recent : old,
    lastCertifiedFreshUntil: current ? until : old,
    sourceAuthority: "OFFICIAL_EBAY" })
  const registryReader = async () => ({ status: "AVAILABLE", truncated: false,
    rows: [...itemIds.map((itemId, index) => ({ account_key: "test-account",
      ebay_item_id: itemId, ebay_sku: ids[index], title: `Listing ${index}`,
      ebay_price: 20, ebay_quantity: index === 0 ? 0 : 1,
      currency: "USD", last_ebay_sync_at: recent, raw_payload: {} })),
      { ebay_item_id: "366600000000", title: "Ended item",
        listing_status: "ended" }] })
  const analyticsReader = async () => ({ status: "AVAILABLE", rows: [{
    listing_id: itemIds[0], source: {
      analytics: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT" },
    completeness_status: "complete", observed_at: old,
    window_start: "2026-09-20", window_end: "2026-09-25",
    impressions: 100, views: 10, ctr: 0.1, transactions: 1,
    sales_conversion_rate: 0.1 }] })
  return { calls, input: { supabase, accountKey: "test-account",
    accountAlias: "primary", now, stockReader, liveReader,
    registryReader, analyticsReader } }
}

test("official cohort has one row per LIVE Item ID and excludes ended history", async () => {
  const { input, calls } = fixture()
  const result = await readSellerOsRevenueControlPlaneV1(input)
  assert.equal(result.portfolioCount, 7)
  assert.deepEqual(result.rows.map((row) => row.ebayItemId), itemIds)
  assert.equal(new Set(result.rows.map((row) => row.ebayItemId)).size, 7)
  assert.equal(result.summaryStatus.semanticDuplicateReviewCount, "UNPROVEN")
  assert.ok(result.rows.every((row) => row.liveStatus === "LIVE_ACTIVE"))
  assert.ok(calls.length < 20, `bounded calls: ${calls.length}`)
  assert.equal(result.rows[0].liveQuantity, 0)
})

test("missing shipping and unavailable current analytics never become zero", async () => {
  const { input } = fixture()
  const result = await readSellerOsRevenueControlPlaneV1(input)
  const row = result.rows[0]
  assert.equal(row.shippingQty1, null)
  assert.equal(row.shippingStatus, "MISSING")
  assert.equal(row.economicsStatus, "INCOMPLETE")
  assert.equal(row.estimatedNetProfit, null)
  assert.equal(row.analyticsStatus, "UNAVAILABLE")
  assert.equal(row.currentAnalytics.impressions, null)
  assert.equal(row.lastCertifiedAnalytics.impressions, 100)
  assert.equal(row.lastCertifiedAnalytics.status, "STALE")
  assert.equal(row.supplierStockQuantity, null)
  assert.equal(row.preResearchState, "NOT_REQUESTED")
})

test("unavailable current cohort keeps historical certification separate", async () => {
  const { input } = fixture({ current: false })
  const result = await readSellerOsRevenueControlPlaneV1(input)
  assert.equal(result.portfolioCount, null)
  assert.equal(result.summary, null)
  assert.equal(result.rows.length, 0)
  assert.equal(result.lastCertifiedPortfolio.count, 7)
  assert.equal(result.lastCertifiedPortfolio.status, "LAST_CERTIFIED_STALE")
})

test("one official acquisition restores LIVE scope and uses current analytics and orders", async () => {
  const { input } = fixture({ current: false })
  let officialReads = 0
  const official = { discovery: { status: "AVAILABLE", gapCodes: [],
    currentLiveListings: itemIds.map((itemId, index) => ({ itemId,
      sku: ids[index], customLabel: ids[index], title: `Listing ${index}`,
      price: 20, availableQuantity: index === 0 ? 0 : 1,
      currency: "USD", observedAt: recent })) },
    analytics: { status: "CERTIFIED", observations: [{ itemId: itemIds[0],
      completeness: "COMPLETE", impressions: 200,
      totalListingViews: 20, reportedCtr: 0.1,
      transactions: 2, reportedConversion: 0.1,
      observedAt: recent, windowStart: "2026-09-25",
      windowEnd: "2026-09-26" }], gapCodes: [] },
    orders: { status: "CERTIFIED", observedAt: recent, orders: [] } }
  input.officialReader = async () => { officialReads++; return official }
  const originalStock = input.stockReader
  input.stockReader = async (request) => ({ ...await originalStock(),
    cohortComplete: Boolean(request.officialLive),
    currentLiveState: request.officialLive
      ? "CURRENT_FRESH" : "CURRENT_UNAVAILABLE" })
  input.liveReader = async (request) => ({ lastCertifiedState:
    "LAST_CERTIFIED_AVAILABLE", lastCertifiedListingCount: 7,
    lastCertifiedItemIds: itemIds, lastCertifiedAt: recent,
    lastCertifiedFreshUntil: until, sourceAuthority: "OFFICIAL_EBAY",
    currentState: request.live ? "CURRENT_FRESH" : "CURRENT_UNAVAILABLE",
    currentItemIds: request.live ? itemIds : [] })
  const result = await readSellerOsRevenueControlPlaneV1(input)
  assert.equal(officialReads, 1)
  assert.equal(result.portfolioCount, 7)
  assert.equal(result.rows[0].liveQuantity, 0)
  assert.equal(result.rows[0].analyticsStatus, "AVAILABLE")
  assert.equal(result.rows[0].impressions, 200)
  assert.equal(result.rows[0].officialOrders, 0)
})

test("a StockGuard read failure does not erase a certified LIVE cohort", async () => {
  const { input } = fixture()
  input.liveReader = async () => ({ currentState: "CURRENT_FRESH",
    currentItemIds: itemIds, lastCertifiedState: "LAST_CERTIFIED_AVAILABLE",
    lastCertifiedListingCount: itemIds.length, lastCertifiedItemIds: itemIds,
    lastCertifiedAt: recent, lastCertifiedFreshUntil: until,
    sourceAuthority: "OFFICIAL_EBAY" })
  input.stockReader = async () => { throw Error("STOCK_SOURCE_FAILED") }
  const result = await readSellerOsRevenueControlPlaneV1(input)
  assert.equal(result.portfolioCount, itemIds.length)
  assert.equal(result.sourceStatus.stockRead, "UNAVAILABLE")
  assert.ok(result.rows.every((row) => row.identityStatus === "UNPROVEN" &&
    row.supplierStockQuantity === null && row.supplierStockFreshness === "UNKNOWN"))
})

test("exact published products are blocked; family or title matches require review", () => {
  const live = [{ supplierSku: ids[0], lunaProductId: tuples[0].supplierProductId,
    lunaVariantId: tuples[0].supplierVariantId,
    title: "A published product exact title",
    liveStatus: "LIVE_ACTIVE" }]
  assert.equal(classifyRevenueLiveDuplicateV1({ supplierSku: ids[0],
    lunaProductId: tuples[0].supplierProductId,
    lunaVariantId: tuples[0].supplierVariantId }, live),
  "EXACT_LIVE_DUPLICATE")
  assert.equal(classifyRevenueLiveDuplicateV1({ supplierSku: "other",
    lunaProductId: tuples[0].supplierProductId,
    lunaVariantId: tuples[0].supplierVariantId }, live),
  "VARIANT_DUPLICATE")
  assert.equal(classifyRevenueLiveDuplicateV1({ supplierSku: ids[0],
    lunaProductId: null, lunaVariantId: null }, live),
  "REVIEW_REQUIRED")
  assert.equal(classifyRevenueLiveDuplicateV1({ supplierSku: "other",
    lunaProductId: "1", lunaVariantId: "2",
    title: "A published product exact title" }, live), "REVIEW_REQUIRED")
  assert.equal(classifyRevenueLiveDuplicateV1({ supplierSku: "other",
    lunaProductId: "1", lunaVariantId: "2",
    title: "Different product in family" }, live), "NONE")
  assert.equal(classifyRevenueLiveDuplicateV1({ supplierSku: "other",
    lunaProductId: "1", lunaVariantId: "2",
    productFingerprint: "sha256:proven" },
  [{ ...live[0], productFingerprint: "sha256:proven" }]),
  "SEMANTIC_DUPLICATE")
})
