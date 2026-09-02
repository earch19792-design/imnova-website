import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

let implementation = readFileSync(
  "lib/ebay/ebay-remote-live-optimization-operator-v1.ts", "utf8")
implementation = implementation
  .replace(/import type \{ SupabaseClient \} from "@supabase\/supabase-js"\n\n/, "")
  .replace(/import \{[\s\S]*?\} from "\.\/commercial-monitor-readonly-contract"\n/,
    `const isProvenSupplierLinkageV1 = (stock) =>\n  stock.supplierLinkageStatus === "CERTIFIED" ||\n  stock.supplierLinkageStatus === "EXACT_PROVEN" ||\n  Boolean(stock.supplierProductId && stock.supplierVariantId && stock.supplierSku)\n`)
  .replace(/import type \{ SellerOsHeroVisualReviewV1 \} from\n  "\.\/ebay-seller-os-visual-quality-v1"\n/, "")
  .replace(/import \{ currentLiveListingsForMonitorV1 \} from\n  "\.\/ebay-seller-os-live-portfolio-integrity-v1"\n/,
    "const currentLiveListingsForMonitorV1 = (monitor) => monitor.listings\n")
const compiled = ts.transpileModule(implementation, { compilerOptions: {
  module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022,
} }).outputText
const implementationModule = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`)
const {
  buildRemoteLiveOptimizationOperatorV1,
  readRemoteLiveOperatorSalesResultsV1,
  remoteLiveOptimizationTasksV1,
} = implementationModule
import {
  SELLER_OS_ACCESS_ROLES,
  sellerOsAccessRoleFromUser,
} from "../seller-os-access-control.ts"

function metric(value, availability = "AVAILABLE") {
  return { value, availability,
    completeness: availability === "AVAILABLE" ? "COMPLETE" : "UNPROVEN" }
}

function listing(itemId, overrides = {}) {
  return {
    key: `listing:${itemId}`,
    identity: {
      itemId, title: `Producto ${itemId}`, sku: `SKU-${itemId}`,
      primaryImageUrl: `https://i.ebayimg.com/images/g/${itemId}/s-l1600.jpg`,
      marketplaceCertification: { status: "US_CERTIFIED" },
      ...overrides.identity,
    },
    discovery: { livePresence: { status: "LIVE_ACTIVE",
      source: "EBAY_TRADING_GET_MY_EBAY_SELLING" } },
    stock: { state: "IN_STOCK_SIGNAL", supplierLinkageStatus: "CERTIFIED",
      supplierProductId: "100", supplierVariantId: "200", supplierSku: "SKU",
      ...overrides.stock },
    metrics: {
      impressions: metric(1_000), ebay_views: metric(20),
      ctr_calculated: metric(2), ctr_reported: metric(null, "UNAVAILABLE"),
      orders: metric(2), units_sold: metric(2), ...overrides.metrics,
    },
    experiment: { status: "MISSING", lifecycleState: null },
    dataQualityIssues: [], blockers: [], evidenceReferences: [],
    alertCandidateKeys: [], ...overrides.root,
  }
}

function dashboardFixture() {
  const itemId = "366600000001"
  const priceTask = { id: "11111111-1111-4111-8111-111111111111",
    eventType: "COMPETITOR_ACTIVE_MARKET_PRICE_RECOMMENDATION",
    listingId: itemId }
  const monitor = {
    generatedAt: "2026-09-02T00:00:00.000Z",
    listings: [listing(itemId)],
    backend: {
      livePortfolioIntegrity: { canonicalCohort: { itemIds: [itemId] } },
      decisions: [{ listingKey: `listing:${itemId}`,
        reasonCodes: ["LOW_CTR_WITH_SUFFICIENT_IMPRESSIONS"] }],
      listingQualityReport: { status: "AVAILABLE", recommendations: [] },
    },
  }
  const salesResults = { source: "PERSISTED_OFFICIAL_EBAY_ORDERS",
    sourceStatus: "AVAILABLE", observedAt: "2026-09-02T00:00:00.000Z",
    timeZone: "UTC", salesToday: 1, salesLast7Days: 2,
    revenueToday: 22.98, revenueLast7Days: 79.97, currency: "USD",
    listingsWithSales: 2, series: [], limitationCodes: [],
    analyticsQuantitySoldUsed: false, buyerPiiIncluded: false }
  return { itemId, priceTask, monitor, salesResults }
}

function thenableQuery(result) {
  const query = {
    select: () => query, eq: () => query, gte: () => query,
    order: () => query, limit: () => query, in: () => query,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  return query
}

function orderClient(results) {
  return { from: (table) => thenableQuery(results[table]) }
}

test("the remote role is derived only from trusted app_metadata", () => {
  assert.equal(sellerOsAccessRoleFromUser({ app_metadata: {
    role: SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator } }),
  SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator)
  assert.equal(sellerOsAccessRoleFromUser({ user_metadata: {
    role: SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator } }), null)
  assert.equal(sellerOsAccessRoleFromUser({ app_metadata: { role: "admin" } }),
    SELLER_OS_ACCESS_ROLES.owner)
})

test("all existing commercial task lanes share one remote LIVE authority", () => {
  const tasks = remoteLiveOptimizationTasksV1({
    optimizationTasks: [{ id: "optimization" }],
    competitorWatch: { priceRecommendations: [{ id: "price" }] },
    supplyActions: [{ id: "stock" }],
  })
  assert.deepEqual(tasks.map((row) => row.id),
    ["optimization", "price", "stock"])
})

test("the human-first queue reuses current LIVE identity and price actions", () => {
  const fixture = dashboardFixture()
  const result = buildRemoteLiveOptimizationOperatorV1({
    monitor: fixture.monitor,
    commercialDashboard: { competitorWatch: {
      priceRecommendations: [fixture.priceTask] } },
    visualQuality: { status: "AVAILABLE", listings: [] },
    salesResults: fixture.salesResults,
    improvementExecutions: [],
    liveMutationEnabled: true,
  })
  assert.equal(result.role, "REMOTE_LIVE_OPTIMIZATION_OPERATOR")
  assert.equal(result.listings.length, 1)
  assert.equal(result.listings[0].attentionClass, "CAN_IMPROVE")
  assert.match(result.listings[0].humanSummary,
    /Muchas personas ven este producto/)
  assert.equal(result.listings[0].action.kind, "SAFE_PRICE_CHANGE")
  assert.equal(result.listings[0].action.status, "AVAILABLE")
  assert.equal(result.listings[0].evidence.exactListingIdentity, true)
  assert.equal(result.listings[0].evidence.productTruthSupported, true)
  assert.equal(result.authority.remoteOperatorPostsaleAccess, false)
  assert.equal(result.authority.newListingPublishOwnerOnly, true)
  assert.equal(result.impact.causalAttributionClaimed, false)
})

test("unproven metrics remain null and actions fail closed without exact lineage", () => {
  const fixture = dashboardFixture()
  fixture.monitor.listings[0].metrics.impressions = metric(null, "UNAVAILABLE")
  fixture.monitor.listings[0].stock.supplierLinkageStatus = "UNPROVEN"
  fixture.monitor.listings[0].stock.supplierProductId = null
  fixture.monitor.listings[0].stock.supplierVariantId = null
  fixture.monitor.listings[0].stock.supplierSku = null
  const result = buildRemoteLiveOptimizationOperatorV1({
    monitor: fixture.monitor,
    commercialDashboard: { competitorWatch: {
      priceRecommendations: [fixture.priceTask] } },
    visualQuality: { status: "UNPROVEN", listings: [] },
    salesResults: fixture.salesResults,
  })
  assert.equal(result.listings[0].metrics.impressions, null)
  assert.equal(result.listings[0].action.status, "UNAVAILABLE")
  assert.equal(result.safety.factsInvented, false)
})

test("official order history is the sales authority and authoritative zero is preserved", async () => {
  const available = await readRemoteLiveOperatorSalesResultsV1({
    supabase: orderClient({
      marketplace_order_snapshots: { data: [], error: null },
      marketplace_order_line_items: { data: [], error: null },
    }), accountKey: "account", now: new Date("2026-09-02T12:00:00.000Z"),
  })
  assert.equal(available.sourceStatus, "AVAILABLE")
  assert.equal(available.salesToday, 0)
  assert.equal(available.salesLast7Days, 0)
  assert.equal(available.analyticsQuantitySoldUsed, false)
  const unavailable = await readRemoteLiveOperatorSalesResultsV1({
    supabase: orderClient({ marketplace_order_snapshots: {
      data: null, error: { message: "read failed" } } }),
    accountKey: "account", now: new Date("2026-09-02T12:00:00.000Z"),
  })
  assert.equal(unavailable.sourceStatus, "UNAVAILABLE")
  assert.equal(unavailable.salesToday, null)
  assert.equal(unavailable.revenueToday, null)
})

test("the iPad surface is role-bounded, touch-first, and never renders false zero", () => {
  const page = readFileSync(
    "app/admin/remote-live-optimization-operator.tsx", "utf8")
  const route = readFileSync(
    "app/api/admin/ebay/live-optimization-operator/route.ts", "utf8")
  const middleware = readFileSync("middleware.ts", "utf8")
  const session = readFileSync("app/api/admin/session/route.ts", "utf8")
  assert.match(page, /data-postsale-access="false"/)
  assert.match(page, /data-new-listing-publish-access="false"/)
  assert.match(page, /min-h-1[12]/)
  assert.match(page, /overflow-x-hidden/)
  assert.match(page, /value === null \|\| value === undefined \|\| value === ""/)
  assert.doesNotMatch(page, /href=.*command-center/i)
  assert.match(route, /validateSellerOsApiRequest/)
  assert.match(route, /inspected\.actionType !== "PRICE"/)
  assert.match(route, /unknownResultAutoRetry: false/)
  assert.match(route, /postActionReadbackPass: verified/)
  assert.doesNotMatch(route, /publishOffer|EndFixedPriceItem|buyer.*message/i)
  assert.match(middleware,
    /verification === "REMOTE_OPERATOR" && pathname !== "\/admin"/)
  assert.match(session,
    /validation\.accessRole === SELLER_OS_ACCESS_ROLES\.owner/)
})
