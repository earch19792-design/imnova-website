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
  buildRemoteOperatorCanonicalTaskFeedV1,
  buildRemoteLiveOptimizationOperatorV1,
  readRemoteLiveOperatorSalesResultsV1,
  remoteFeedHasUnprovenFalseZeroV1,
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
      freshness: { status: "FRESH" },
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

function imageProposal(itemId) {
  return {
    proposalId: "22222222-2222-4222-8222-222222222222",
    ebayItemId: itemId,
    preparedAt: "2026-09-02T00:00:00.000Z",
    proposedMainImageUrl: "https://example.com/proposed-main.jpg",
    proposedLifestyleImageUrl: "https://example.com/proposed-life.jpg",
    proposedImageUrls: ["https://example.com/proposed-main.jpg",
      "https://example.com/proposed-life.jpg"],
    guards: { pipelineExactProductIdentity: true, noFalseFeatures: true,
      noUnprovenAccessories: true, productNotMisrepresented: true },
    reviewDecision: null,
    reviewedAt: null,
  }
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

test("the canonical feed fixes false empty without inventing a second decision source", () => {
  const first = listing("366600000001")
  const second = listing("366600000002")
  const nonlive = listing("366600000003", { root: { discovery: {
    livePresence: { status: "ENDED",
      source: "EBAY_TRADING_GET_MY_EBAY_SELLING" },
  } } })
  const feed = buildRemoteOperatorCanonicalTaskFeedV1({
    listings: [first, second, nonlive],
    commercialExceptions: [{ entityKey: first.identity.itemId,
      entityType: "EBAY_LIVE_LISTING", classification: "ACTIONABLE_COMMERCIAL",
      reasonCodes: ["LOW_CTR_WITH_SUFFICIENT_IMPRESSIONS"],
      recommendedAction: "IMPROVE_CTR", humanApprovalRequired: true,
      actionBlockedByEvidence: false, experimentProtectionExists: false,
      lastObservationTime: "2026-09-02T12:00:00.000Z",
      dedupeIdentity: "exception:first", material: true },
    { entityKey: nonlive.identity.itemId, entityType: "EBAY_LIVE_LISTING",
      classification: "ACTIONABLE_COMMERCIAL", recommendedAction: "IMPROVE_CTR",
      dedupeIdentity: "exception:ended", material: true }],
    listingQualitySignals: [{ signalId: "quality:first",
      itemId: first.identity.itemId,
      sourceAuthority: "EBAY_LISTING_QUALITY_REPORT",
      observedAt: "2026-09-02T12:01:00.000Z",
      signalType: "LISTING_QUALITY_SPECIFIC_RECOMMENDATION",
      freshness: "CURRENT",
      whatIsHappening: "eBay recomienda completar Material.",
      whyItMatters: "Puede ayudar a explicar el producto.",
      sellerOsRecommendation: "Revisar Material: Aluminum.",
      whatToDoNow: "Revisa el valor respaldado.",
      priorityClass: "NEEDS_ATTENTION", productTruthSupported: true,
      proposedField: "Material", proposedValue: "Aluminum",
      operatorActionRequired: true },
    { signalId: "quality:second", itemId: second.identity.itemId,
      sourceAuthority: "EBAY_LISTING_QUALITY_REPORT",
      observedAt: "2026-09-02T12:02:00.000Z",
      signalType: "LISTING_QUALITY_SPECIFIC_RECOMMENDATION",
      freshness: "CURRENT", whatIsHappening: "eBay recomienda completar Color.",
      whyItMatters: "Puede ayudar a explicar el producto.",
      sellerOsRecommendation: "Revisar Color: Black.",
      whatToDoNow: "Revisa el valor respaldado.",
      priorityClass: "CAN_IMPROVE", productTruthSupported: true,
      proposedField: "Color", proposedValue: "Black",
      operatorActionRequired: true }],
    remoteScopeAuthorized: true,
    generatedAt: "2026-09-02T12:03:00.000Z",
  })
  assert.equal(feed.tasks.length, 2)
  assert.equal(feed.trace.currentLiveCohortVisibleToServer, 2)
  assert.equal(feed.trace.commercialExceptionCount, 1)
  assert.equal(feed.trace.validQualitySignalCount, 2)
  assert.equal(feed.trace.qualitySignalCurrentLiveMatchCount, 2)
  assert.equal(feed.trace.remoteTaskCandidateCountBeforeAcl, 2)
  assert.equal(feed.trace.remoteTaskCountAfterAcl, 2)
  assert.equal(feed.trace.remoteTaskCountRendered, 2)
  assert.equal(feed.trace.duplicateTaskCount, 0)
  const bundled = feed.tasks.find((task) =>
    task.ebayItemId === first.identity.itemId)
  assert.deepEqual([...bundled.sourceAuthorities].sort(),
    ["COMMERCIAL_EXCEPTION_QUEUE", "EBAY_LISTING_QUALITY_REPORT"])
  assert.deepEqual([...bundled.sourceSignalIds].sort(),
    ["exception:first", "quality:first"])
  assert.equal(bundled.currentLive, true)
  assert.equal(bundled.executable, true)
})

test("the API render collection has exact server parity without a client join", () => {
  const fixture = dashboardFixture()
  const result = buildRemoteLiveOptimizationOperatorV1({
    monitor: fixture.monitor,
    commercialDashboard: { competitorWatch: { priceRecommendations: [] } },
    commercialExceptions: [{ entityKey: fixture.itemId,
      entityType: "EBAY_LIVE_LISTING",
      classification: "ACTIONABLE_COMMERCIAL",
      recommendedAction: "IMPROVE_CTR",
      actionBlockedByEvidence: false,
      lastObservationTime: "2026-09-02T12:00:00.000Z",
      dedupeIdentity: "exception:render-parity", material: true }],
    visualQuality: { status: "AVAILABLE", listings: [] },
    salesResults: fixture.salesResults,
    remoteScopeAuthorized: true,
  })
  assert.equal(result.taskFeed.length, 1)
  assert.equal(result.taskListings.length, 1)
  assert.equal(result.suggestedTaskListings.length, 1)
  assert.equal(result.deliveryTrace.serverGeneratedCount, 1)
  assert.equal(result.deliveryTrace.apiResponseCount, 1)
  assert.equal(result.deliveryTrace.suggestedApiResponseCount, 1)
  assert.equal(result.deliveryTrace.serverToClientCountParity, true)
  assert.equal(result.deliveryTrace.clientJoinRequired, false)
  assert.equal(result.taskListings[0].canonicalTask.ebayItemId,
    result.taskListings[0].ebayItemId)
  assert.equal(result.taskListings[0].attentionClass,
    result.taskListings[0].canonicalTask.attentionClass)
})

test("a persisted active cohort makes a runtime zero unproven", () => {
  assert.equal(remoteFeedHasUnprovenFalseZeroV1({
    currentLiveCount: 0, persistedActiveCount: 14, decisionCount: 0,
  }), true)
  assert.equal(remoteFeedHasUnprovenFalseZeroV1({
    currentLiveCount: 14, persistedActiveCount: 14, decisionCount: 14,
  }), false)
  assert.equal(remoteFeedHasUnprovenFalseZeroV1({
    currentLiveCount: 0, persistedActiveCount: 0, decisionCount: 0,
  }), false)
  assert.equal(remoteFeedHasUnprovenFalseZeroV1({
    currentLiveCount: 14, persistedActiveCount: 14, decisionCount: 0,
  }), true)
})

test("evidence-blocked work stays visible, non-executable, and ACL fails closed", () => {
  const blocked = listing("366600000004", { stock: {
    state: "UNKNOWN", supplierLinkageStatus: "UNPROVEN",
    supplierProductId: null, supplierVariantId: null, supplierSku: null,
    freshness: { status: "STALE" },
  } })
  const input = {
    listings: [blocked],
    commercialExceptions: [{ entityKey: blocked.identity.itemId,
      entityType: "EBAY_LIVE_LISTING", classification: "HUMAN_REVIEW",
      recommendedAction: "COLLECT_REQUIRED_EVIDENCE",
      actionBlockedByEvidence: true,
      lastObservationTime: "2026-09-02T12:00:00.000Z",
      dedupeIdentity: "exception:blocked", material: true }],
    generatedAt: "2026-09-02T12:03:00.000Z",
  }
  const accepted = buildRemoteOperatorCanonicalTaskFeedV1({ ...input,
    remoteScopeAuthorized: true })
  assert.equal(accepted.tasks.length, 1)
  assert.equal(accepted.tasks[0].actionBlockedByEvidence, true)
  assert.equal(accepted.tasks[0].executable, false)
  assert.equal(accepted.trace.remoteTaskCountAfterEvidenceGate, 1)
  assert.equal(accepted.trace.remoteExecutableTaskCountAfterEvidenceGate, 0)
  assert.equal(accepted.trace.remoteBlockedTaskCountAfterEvidenceGate, 1)
  const rejected = buildRemoteOperatorCanonicalTaskFeedV1({ ...input,
    remoteScopeAuthorized: false })
  assert.equal(rejected.tasks.length, 0)
  assert.equal(rejected.trace.remoteOperatorAuthPass, false)
  assert.equal(rejected.trace.remoteTaskCandidateCountBeforeAcl, 1)
  assert.equal(rejected.trace.remoteTaskCountAfterAcl, 0)
})

test("the human-first queue reuses current LIVE identity and price actions", () => {
  const fixture = dashboardFixture()
  const result = buildRemoteLiveOptimizationOperatorV1({
    monitor: fixture.monitor,
    commercialDashboard: { competitorWatch: {
      priceRecommendations: [fixture.priceTask] } },
    visualQuality: { status: "AVAILABLE", listings: [] },
    salesResults: fixture.salesResults,
    imageProposals: [imageProposal(fixture.itemId)],
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
  assert.deepEqual(result.menu, ["Inicio", "Mis tareas", "Listings LIVE",
    "Mejoras sugeridas", "Resultados", "Historial", "Ayuda"])
  assert.equal(result.aiAssistancePolicy.deterministicFirst, true)
  assert.equal(result.aiAssistancePolicy.inventProductTruth, false)
  assert.equal(result.aiAssistancePolicy.inventDemandEvidence, false)
  assert.equal(result.aiAssistancePolicy.inventProductIdentifiers, false)
  assert.equal(result.aiAssistancePolicy.inventProductFeatures, false)
  assert.equal(result.aiAssistancePolicy.overrideMarginGuards, false)
  assert.equal(result.aiAssistancePolicy.overrideOwnerAuthority, false)
  assert.equal(result.aiAssistancePolicy.autoPublishNewListing, false)
  assert.equal(result.aiAssistancePolicy.continuousAiPolling, false)
  assert.equal(result.listings[0].imageProposal.reviewAllowed, true)
  assert.equal(result.capabilities.imageEnrichmentReview, true)
  assert.equal(result.capabilities.lifestylePreparedAssetReview, true)
  assert.equal(result.capabilities.preparedImageProposalCount, 1)
  assert.equal(result.safety.remoteOperatorReportUploadAccess, false)
  assert.equal(result.safety.remoteOperatorRawReportAccess, false)
})

test("official quality signals become human-first tasks without exposing raw report data", () => {
  const fixture = dashboardFixture()
  const result = buildRemoteLiveOptimizationOperatorV1({
    monitor: fixture.monitor,
    commercialDashboard: { competitorWatch: { priceRecommendations: [] } },
    visualQuality: { status: "AVAILABLE", listings: [] },
    salesResults: fixture.salesResults,
    listingQualitySignals: [{ itemId: fixture.itemId,
      signalType: "ITEM_SPECIFIC_MISSING", freshness: "CURRENT",
      whatIsHappening: "eBay recomienda completar Material en este producto.",
      whyItMatters: "Agregar Material puede ayudar a que eBay entienda mejor el listing.",
      sellerOsRecommendation: "Seller OS encontró un valor respaldado por el producto exacto: Aluminum.",
      whatToDoNow: "Revisa Material: Aluminum.",
      priorityClass: "NEEDS_ATTENTION", productTruthSupported: true,
      proposedField: "Material", proposedValue: "Aluminum",
      operatorActionRequired: true }],
  })
  assert.equal(result.listings[0].attentionClass, "NEEDS_ATTENTION")
  assert.equal(result.listings[0].whatOperatorShouldDo,
    "Revisa Material: Aluminum.")
  assert.equal(result.listings[0].officialQualitySignals[0].proposedValue,
    "Aluminum")
  assert.equal("rawSignalReference" in
    result.listings[0].officialQualitySignals[0], false)
})

test("image review fails closed unless every product-truth guard passes", () => {
  const fixture = dashboardFixture()
  const unsafe = imageProposal(fixture.itemId)
  unsafe.guards.noUnprovenAccessories = false
  const result = buildRemoteLiveOptimizationOperatorV1({
    monitor: fixture.monitor,
    commercialDashboard: { competitorWatch: { priceRecommendations: [] } },
    visualQuality: { status: "AVAILABLE", listings: [] },
    salesResults: fixture.salesResults,
    imageProposals: [unsafe],
  })
  assert.equal(result.listings[0].imageProposal.reviewAllowed, false)
  assert.equal(result.listings[0].imageProposal.guards.noUnprovenAccessories,
    false)
})

test("impact requires a real operator audit row and never attributes sales", () => {
  const fixture = dashboardFixture()
  const operatorUserId = "33333333-3333-4333-8333-333333333333"
  const withoutAudit = buildRemoteLiveOptimizationOperatorV1({
    monitor: fixture.monitor,
    commercialDashboard: { competitorWatch: { priceRecommendations: [] } },
    visualQuality: { status: "AVAILABLE", listings: [] },
    salesResults: fixture.salesResults,
    operatorUserId,
    improvementExecutions: [],
  })
  assert.equal(withoutAudit.impact.visible, false)
  const withAudit = buildRemoteLiveOptimizationOperatorV1({
    monitor: fixture.monitor,
    commercialDashboard: { competitorWatch: { priceRecommendations: [] } },
    visualQuality: { status: "AVAILABLE", listings: [] },
    salesResults: fixture.salesResults,
    operatorUserId,
    improvementExecutions: [{ actor_user_id: operatorUserId,
      listing_id: fixture.itemId, phase: "applied_verified",
      action_type: "PRICE", created_at: "2026-09-02T01:00:00.000Z" }],
  })
  assert.equal(withAudit.impact.visible, true)
  assert.equal(withAudit.impact.causalAttributionClaimed, false)
  assert.equal(withAudit.impact.operatorAttributedSales, null)
  assert.equal(withAudit.history[0].saleCausalityClaimed, false)
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
  const visualReview = readFileSync(
    "lib/ebay/ebay-remote-operator-image-review-v1.ts", "utf8")
  const migration = readFileSync(
    "supabase/migrations/20260902070259_remote_operator_visual_review_v1.sql",
    "utf8")
  assert.match(page, /data-postsale-access="false"/)
  assert.match(page, /data-new-listing-publish-access="false"/)
  assert.match(page, /min-h-1[12]/)
  assert.match(page, /overflow-x-hidden/)
  assert.match(page, /grid grid-cols-2 gap-2 sm:grid-cols-4/)
  assert.doesNotMatch(page, /md:grid-cols-7/)
  assert.match(page,
    /embeddedForOwner \? "mt-4" : "mt-4 lg:hidden"/)
  assert.doesNotMatch(page, /setInterval/)
  assert.match(page, /data-continuous-ai-polling="false"/)
  assert.match(page, /value === null \|\| value === undefined \|\| value === ""/)
  assert.deepEqual([...page.matchAll(/label: "([^"]+)"/g)]
    .slice(0, 7).map((match) => match[1]), ["Inicio", "Mis tareas",
      "Listings LIVE", "Mejoras sugeridas", "Resultados", "Historial",
      "Ayuda"])
  assert.doesNotMatch(page,
    /Command Center|Experimentos|Analítica|Codex|Infrastructure|Developer|Raw diagnostics/)
  assert.match(page, /Qué necesita tu atención hoy/)
  assert.ok(page.indexOf("Qué necesita tu atención hoy") <
    page.indexOf("<SalesChart dashboard={dashboard} />"))
  assert.match(page, /Actual vs Propuesta/)
  assert.match(page, /Comprueba que el producto se vea correcto y que no aparezcan accesorios o funciones que no vienen incluidos\./)
  assert.match(page, /Aplicando cambio…/)
  assert.match(page, /Verificando con eBay…/)
  assert.match(page, /Cambio confirmado ✓/)
  assert.match(page,
    /Estamos verificando el cambio\. No vuelvas a pulsar\./)
  assert.match(page, /remoteLiveOperatorDisplayNameFromUser/)
  assert.doesNotMatch(page, /Hola, Mayel/)
  assert.match(route, /validateSellerOsApiRequest/)
  assert.match(page, /dashboard\?\.taskListings \?\? \[\]/)
  assert.doesNotMatch(page, /taskItemIds/)
  assert.match(page, /REPORT_FEED_RENDER/)
  assert.match(page, /querySelectorAll\("\[data-remote-live-listing\]"\)/)
  assert.match(page, /serverGeneratedCount: dashboard\.deliveryTrace/)
  assert.match(page, /apiResponseCount: dashboard\.deliveryTrace/)
  assert.match(page, /data-client-received-count/)
  assert.match(route, /REMOTE_FEED_FALSE_ZERO_REJECTED/)
  assert.match(route, /REMOTE_OPERATOR_SESSION_FEED_RESPONSE_V1/)
  assert.match(route, /REMOTE_OPERATOR_CLIENT_RENDER_V1/)
  assert.match(route, /REVIEW_IMAGE_PROPOSAL/)
  assert.match(route, /recordRemoteOperatorImageReviewV1/)
  assert.match(route, /marketplaceWrites: 0, newListingPublications: 0/)
  assert.match(route, /inspected\.actionType !== "PRICE"/)
  assert.match(route, /unknownResultAutoRetry: false/)
  assert.match(route, /postActionReadbackPass: verified/)
  assert.doesNotMatch(route,
    /publishOffer|EndFixedPriceItem|send[A-Za-z]*(?:Buyer|Message)|AddMemberMessage/i)
  assert.match(middleware,
    /verification === "REMOTE_OPERATOR" && pathname !== "\/admin"/)
  assert.match(session,
    /validation\.accessRole === SELLER_OS_ACCESS_ROLES\.owner/)
  assert.match(visualReview, /EXACT_AUTHORIZED_PIXELS_ONLY/)
  assert.match(visualReview, /verifiedFactsOnly === true/)
  assert.match(visualReview, /contextualPropsPassed === true/)
  assert.doesNotMatch(page, /productVariantFingerprint|qa_result|asset_ids|hash/i)
  assert.match(migration, /REMOTE_OPERATOR_VISUAL_REVIEW_APPEND_ONLY/)
  assert.match(migration, /new_listing_publications = 0/)
  assert.match(migration, /promotion_spend_writes = 0/)
  assert.match(migration,
    /revoke all on table[\s\S]*from anon, authenticated/)
  assert.match(migration,
    /revoke all on function[\s\S]*from public, anon, authenticated, service_role/)
})
