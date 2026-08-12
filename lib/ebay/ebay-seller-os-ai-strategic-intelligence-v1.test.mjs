import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  SELLER_OS_AI_WORKLOADS,
  buildDailyStrategicBriefFallbackV1,
  buildDailyStrategicReviewScheduleContractV1,
  buildLargeVolumeAiPolicyV1,
  buildStrategicReviewQueueV1,
  buildSystemReviewBundleV1,
  detectAutomationCandidatesV1,
  evaluateAiBudgetPolicyV1,
  evaluateHighImpactConsensusPolicyV1,
  planEventDrivenStrategicReviewV1,
  prefilterStrategicReviewV1,
  resolveModelPolicyV1,
} from "./ebay-seller-os-ai-strategic-intelligence-v1.ts"
import {
  buildSellerOsAgentRuntimePlanV1,
  getSellerOsAiRuntimeStatusV1,
  sanitizeCopilotContextRefV1,
  validateSellerOsAgentInputV1,
} from "./ebay-seller-os-strategic-agent-v1.ts"

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8")
const gatewaySource = read("./ebay-seller-os-assistant-gateway-v1.ts")
const mcpSource = read("./ebay-seller-os-mcp-server-v1.ts")
const agentSource = read("./ebay-seller-os-strategic-agent-v1.ts")
const portfolioSource = read("./ebay-seller-os-portfolio-intelligence-v1.ts")
const opportunitySource = read("./ebay-commercial-intelligence-upgrade-v1.ts")
const copilotRoute = read("../../app/api/admin/ebay/copilot/route.ts")
const strategicRoute = read("../../app/api/admin/ebay/strategic-review/route.ts")
const externalMcpRoute = read("../../app/api/seller-os/assistant/mcp/route.ts")
const copilotPage = read("../../app/admin/ebay/copilot/page.tsx")
const strategicPage = read("../../app/admin/ebay/strategic-review/page.tsx")
const boundaries = read("./environment-boundaries.ts")
const opportunityPage = read("../../app/admin/ebay/opportunity-queue/research/page.tsx")
const stockPage = read("../../app/admin/ebay/stock-guard/page.tsx")
const intelligencePage = read("../../app/admin/ebay/intelligence/protected-intelligence-surface.tsx")

function observation(value, availability = "AVAILABLE") {
  return { value, availability, completeness: value === null ? "UNPROVEN" : "COMPLETE",
    source: { system: "TEST", operation: "READ", evidenceReference: "ref" },
    capturedAt: "2026-08-12T00:00:00Z", marketplace: { marketplaceId: "EBAY_US" },
    identity: { itemId: "366581876813" }, grain: "LISTING", reportingWindow: null,
    freshness: { status: "FRESH", ageSeconds: 0, maximumAgeSeconds: 60 }, unit: null,
    limitationCode: null, explicitAuthoritativeZero: value === 0 }
}

function listing(itemId, overrides = {}) {
  return { key: `listing:${itemId}`, identity: { itemId, title: `Listing ${itemId}`,
    sku: `SKU-${itemId}`, primaryImageUrl: null, lastObservedAt: "2026-08-12T00:00:00Z" },
  discovery: { livePresence: { status: "LIVE_ACTIVE" } },
  metrics: { impressions: observation(null, "UNAVAILABLE"),
    ebay_views: observation(null, "UNAVAILABLE"), views: observation(null, "UNAVAILABLE"),
    ctr_calculated: observation(null, "UNAVAILABLE"), ctr: observation(null, "UNAVAILABLE"),
    transactions: observation(null, "UNAVAILABLE"), orders: observation(null, "UNAVAILABLE") },
  stock: { state: "STOCK_UNKNOWN", sourceContractStatus: "UNPROVEN",
    supplierProductId: null, supplierVariantId: null, supplierSku: null,
    quantity: observation(null, "UNKNOWN"),
    freshness: { status: "UNKNOWN", ageSeconds: null, maximumAgeSeconds: 60 },
    limitationCode: "UNPROVEN" },
  composition: { bundleCapacity: observation(null, "UNKNOWN") },
  blockers: [], dataQualityIssues: [], ...overrides }
}

function decision(itemId, overrides = {}) {
  return { listingKey: `listing:${itemId}`, classification: "DATA_QUALITY", priority: "MEDIUM",
    evidenceStatus: "UNPROVEN", reasonCodes: ["INSUFFICIENT_ANALYTICS_EVIDENCE"],
    recommendedAction: "FIX_DATA_QUALITY", actionBlockedByInsufficientEvidence: true,
    experimentRunning: false, variableFrozen: false, protectionState: "NONE",
    experimentOperationalState: "INACTIVE", frozenVariables: [],
    nextReviewEvidenceRemaining: null, externalSignalCount: null,
    nextReviewCondition: null, nextReviewAt: null, actionExecutionAllowed: false,
    ...overrides }
}

function monitor(listings, decisions, overrides = {}) {
  return { contractVersion: "COMMERCIAL_MONITOR_READONLY_V1", mode: "READ_ONLY",
    generatedAt: "2026-08-12T00:00:00Z", listings, alertCandidates: [],
    productCaseOperatingState: { status: "PAUSED_FOR_MONITORING_MILESTONE", reset: false,
      resumePolicy: "RESUME_FROM_LAST_VERIFIED_GATE", manualGoldenPath: "PRESERVE" },
    learning: { status: "UNPROVEN", source: "EBAY_CATEGORY_LEARNING",
      evidenceTimestamp: null, categoryAdjustments: [], limitationCode: "NO_STORED_CATEGORY_LEARNING" },
    backend: { decisions, guidanceVsSellerOs: [],
      listingQualityReport: { status: "UNAVAILABLE_NO_CURRENT_REPORT", recommendations: [],
        limitationCode: "NO_CURRENT_REPORT" },
      orders: { status: "AUTH_PENDING", fulfillmentStatuses: ["AUTH_PENDING"] },
      trafficScopes: { accountTraffic: { status: "UNPROVEN" },
        currentLivePortfolio: { activeListings: listings.length } },
      kpis: { activeListings: { value: listings.length } },
      capabilities: { registry: { status: "CERTIFIED", humanReviewCount: 0,
        matchedCount: listings.length, coveragePercent: 100, limitationCodes: [] },
        inventory: { inventoryItemsResource: "UNPROVEN" } },
      operationalHealth: { runningExperiments: { status: "AVAILABLE" } },
      ...overrides },
    safety: { marketplaceWritesAllowed: false, dispatchAllowed: false,
      whatsappCalled: false, buyerMessagesAllowed: false, sanitized: true,
      containsSecrets: false, containsTokens: false, containsAuthorizationHeaders: false,
      containsCookies: false, buyerPiiIncluded: false },
  }
}

test("ChatGPT bridge registers only bounded read-only tools including strategic review", () => {
  for (const name of ["seller_os_get_commercial_context", "seller_os_get_listing_intelligence",
    "seller_os_get_exception_queue", "seller_os_get_opportunity_case",
    "seller_os_get_opportunity_radar", "seller_os_get_experiments", "seller_os_get_stock_status",
    "seller_os_get_quality_guidance", "seller_os_get_learning_signals",
    "seller_os_get_operational_readiness", "seller_os_get_system_review_bundle",
    "seller_os_get_recent_system_changes", "seller_os_get_strategic_review_queue"])
    assert.match(gatewaySource, new RegExp(name))
  assert.match(mcpSource, /registerTool\("search"/)
  assert.match(mcpSource, /registerTool\("fetch"/)
  assert.match(mcpSource, /SELLER_OS_FETCH_RESOURCE_NOT_ALLOWLISTED/)
  assert.match(mcpSource, /readOnlyHint: true/)
  assert.match(mcpSource, /destructiveHint: false/)
  assert.match(mcpSource, /openWorldHint: false/)
  assert.doesNotMatch(mcpSource, /createOffer|publishOffer|reviseInventoryStatus|executeSql|fetch\(id\)/)
  assert.match(externalMcpRoute, /handleSellerOsMcpRequestV1/)
  assert.match(mcpSource, /validateAdminApiRequest\(req\)/)
  assert.match(mcpSource, /authenticateSellerOsMcpRequestV1\(req\)/)
  assert.match(mcpSource, /pathname\.startsWith\("\/api\/seller-os\/"\)/)
})

test("direct ChatGPT connection state is not falsely declared", () => {
  assert.match(mcpSource, /connected: false/)
  assert.match(mcpSource, /liveToolCallProven: false/)
  assert.match(mcpSource, /READY_FOR_HUMAN_CONNECTION_AFTER_APPROVED_AUTH_SETUP/)
  assert.doesNotMatch(mcpSource, /connected: true|liveToolCallProven: true/)
})

test("credential/runtime audit is presence-only and never returns secret values", () => {
  const environment = { OPENAI_API_KEY: "test-placeholder-not-returned" }
  const status = getSellerOsAiRuntimeStatusV1(environment)
  assert.equal(status.openAiApiKeyPresent, true)
  assert.equal(status.openAiApiKeyServerOnly, true)
  assert.equal(status.openAiApiKeyValueExposed, false)
  assert.equal(JSON.stringify(status).includes(environment.OPENAI_API_KEY), false)
  assert.doesNotMatch(JSON.stringify(status), /LUNA_COOKIE|authorization|cookie/i)
  assert.equal(status.environmentChanged, false)
  const gateway = getSellerOsAiRuntimeStatusV1({ VERCEL_OIDC_TOKEN: "opaque-not-returned" })
  assert.equal(gateway.activeProvider, "VERCEL_AI_GATEWAY")
  assert.equal(gateway.gatewayAuthenticationMode, "VERCEL_OIDC")
  assert.equal(JSON.stringify(gateway).includes("opaque-not-returned"), false)
})

test("Copilot context is bounded and sensitive input fails closed while Item IDs remain valid", () => {
  assert.deepEqual(sanitizeCopilotContextRefV1({ surface: "LISTING",
    itemId: "366581876813", opportunityCaseId: "case/unsafe?value" }), {
    surface: "LISTING", itemId: "366581876813", opportunityCaseId: "caseunsafevalue",
    experimentId: null, exceptionId: null })
  assert.equal(validateSellerOsAgentInputV1("Review Item ID 366581876813").ok, true)
  assert.equal(validateSellerOsAgentInputV1("Call buyer at 5551234567").ok, false)
  assert.equal(validateSellerOsAgentInputV1("buyer@example.com needs help").ok, false)
  assert.equal(validateSellerOsAgentInputV1("authorization=secret-value").ok, false)
  assert.match(copilotRoute, /maximumRequestsPerMinute: 6/)
  assert.match(copilotRoute, /validateAdminApiRequest/)
  assert.match(copilotPage, /not your ChatGPT conversation/i)
  assert.match(opportunityPage, /surface=OPPORTUNITY&itemId=/)
  assert.match(stockPage, /surface=STOCK/)
  assert.match(intelligencePage, /surface=\$\{mode === "DECISIONS"/)
})

test("System Review Bundle aggregates before bounding at 1000 listings", () => {
  const listings = Array.from({ length: 1_000 }, (_, index) =>
    listing(String(366_500_000_000 + index)))
  const current = monitor(listings, listings.map((row) => decision(row.identity.itemId)))
  const bundle = buildSystemReviewBundleV1({ monitor: current })
  assert.equal(bundle.portfolio.liveListingCount, 1_000)
  assert.equal(bundle.bounds.fullPortfolioModelDump, false)
  assert.equal(bundle.bounds.oneAiCallPerListing, false)
  assert.ok(bundle.decisions.researchOrEvidence.length <= 10)
  assert.ok(bundle.decisions.capabilityBlockers.length <= 10)
  assert.ok(bundle.strategicReviewQueue.entries.length <= 20)
  assert.equal(bundle.supplierAndStock.stockUnknown, 1_000)
  assert.equal(bundle.supplierAndStock.stockUnknownIsRisk, false)
  assert.equal(bundle.operationalBurden.falseInterventionCount, 0)
  assert.equal(bundle.safety.marketplaceWrites, 0)
  assert.equal(bundle.safety.arbitrarySqlAllowed, false)
  assert.equal(bundle.safety.arbitraryUrlFetchAllowed, false)
  assert.doesNotMatch(JSON.stringify(bundle), /LUNA_COOKIE|buyer@example\.com|Bearer\s+/i)
})

test("deterministic prefilter suppresses unchanged evidence and never fans out per listing", () => {
  const listings = Array.from({ length: 1_000 }, (_, index) =>
    listing(String(366_600_000_000 + index)))
  const bundle = buildSystemReviewBundleV1({ monitor: monitor(listings,
    listings.map((row) => decision(row.identity.itemId))) })
  const first = prefilterStrategicReviewV1({ bundle })
  assert.equal(first.shouldCallAi, true)
  assert.equal(first.candidateAiCalls, 1)
  assert.equal(first.maximumAiCalls, 1)
  assert.equal(first.oneCallPerListing, false)
  assert.equal(first.contextWithinLimit, true)
  assert.ok(first.contextCharacters <= 48_000)
  const unchanged = prefilterStrategicReviewV1({ bundle,
    previousMaterialFingerprint: first.materialFingerprint })
  assert.equal(unchanged.shouldCallAi, false)
  assert.equal(unchanged.candidateAiCalls, 0)
  assert.equal(unchanged.reason, "UNCHANGED_MATERIAL_EVIDENCE")
})

test("Strategic Review Queue is deterministic, deduped, and distinct from commercial exceptions", () => {
  const listings = Array.from({ length: 27 }, (_, index) =>
    listing(String(366_700_000_000 + index)))
  const queue = buildStrategicReviewQueueV1({ monitor: monitor(listings,
    listings.map((row) => decision(row.identity.itemId))) })
  assert.equal(queue.deterministicEvidenceOnly, true)
  assert.equal(queue.generatedByModel, false)
  assert.equal(queue.dedupeApplied, true)
  assert.equal(new Set(queue.entries.map((row) => row.signalId)).size, queue.entries.length)
  assert.ok(queue.entries.some((row) => row.signalType === "CAPABILITY_BLOCKER"))
  assert.equal(queue.entries.some((row) => row.signalType === "FALSE_INTERVENTION_SPIKE"), false)
})

test("automation candidate requires repeated deterministic evidence and remains human-gated", () => {
  const base = { signalId: "signal", signalType: "CAPABILITY_BLOCKER", severity: "MEDIUM",
    module: "QUALITY", entityRefs: [], evidenceRefs: ["quality"], summary: "Repeated import gap",
    nextAction: "IMPORT_REPORT", confidence: "HIGH", materiality: 70,
    observedAt: "2026-08-12T00:00:00Z", deterministic: true }
  assert.equal(detectAutomationCandidatesV1({ signals: [{ ...base, evidenceCount: 2 }] }).entries.length, 0)
  const result = detectAutomationCandidatesV1({ signals: [{ ...base, evidenceCount: 3 }] })
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].autoEnableAllowed, false)
  assert.equal(result.entries[0].requiredHumanGate, "HUMAN_APPROVAL_BEFORE_ENABLEMENT")
})

test("$10 budget policy never disables deterministic Seller OS", () => {
  assert.equal(evaluateAiBudgetPolicyV1({ authoritativeSpendUsd: 0 }).state, "NORMAL")
  assert.equal(evaluateAiBudgetPolicyV1({ authoritativeSpendUsd: 8.5 }).state, "CONSERVE")
  const exhausted = evaluateAiBudgetPolicyV1({ authoritativeSpendUsd: 10 })
  assert.equal(exhausted.state, "BUDGET_EXHAUSTED")
  assert.equal(exhausted.deterministicSellerOsAvailable, true)
  assert.equal(exhausted.enforcementStatus, "ENFORCED_FROM_AUTHORITATIVE_SPEND")
  assert.equal(evaluateAiBudgetPolicyV1({ authoritativeSpendUsd: null }).enforcementStatus,
    "READY_REQUIRES_AUTHORITATIVE_GATEWAY_COST_FEED")
  const routing = resolveModelPolicyV1({ workload: "seller_os.daily_brief",
    budgetState: exhausted.state, impact: "MEDIUM", providerMode: "OPENAI_DIRECT" })
  assert.equal(routing.modelClass, "DETERMINISTIC")
  assert.equal(routing.aiCallAllowed, false)
})

test("task-based model policy always carries a workload and never enables image generation", () => {
  assert.ok(SELLER_OS_AI_WORKLOADS.includes("seller_os.copilot"))
  assert.equal(SELLER_OS_AI_WORKLOADS.some((value) => value.includes("image_generation")), false)
  const fast = resolveModelPolicyV1({ workload: "seller_os.keyword_intelligence",
    budgetState: "NORMAL", providerMode: "OPENAI_DIRECT" })
  const standard = resolveModelPolicyV1({ workload: "seller_os.daily_brief",
    budgetState: "NORMAL", providerMode: "VERCEL_AI_GATEWAY" })
  const strong = resolveModelPolicyV1({ workload: "seller_os.system_coherence",
    budgetState: "NORMAL", impact: "HIGH", evidenceConflict: true,
    providerMode: "OPENAI_DIRECT" })
  assert.equal(fast.model, "gpt-5.6-luna")
  assert.equal(standard.model, "openai/gpt-5.6-terra")
  assert.equal(strong.model, "gpt-5.6-sol")
  assert.equal(fast.imageGenerationAllowed, false)
  const plan = buildSellerOsAgentRuntimePlanV1({ workload: "seller_os.copilot",
    environment: {}, authoritativeSpendUsd: 0 })
  assert.equal(plan.workloadTagPresent, true)
  assert.equal(plan.imageGenerationEnabled, false)
})

test("multi-model consensus is exceptional, impact-gated, human-gated, and budget-aware", () => {
  assert.equal(evaluateHighImpactConsensusPolicyV1({ impact: "MEDIUM", evidenceConflict: true,
    portfolioOrCapitalRisk: true, changesSystemPolicy: false, budgetState: "NORMAL" }).enabled, false)
  const allowed = evaluateHighImpactConsensusPolicyV1({ impact: "HIGH", evidenceConflict: true,
    portfolioOrCapitalRisk: false, changesSystemPolicy: true, budgetState: "WATCH" })
  assert.equal(allowed.enabled, true)
  assert.equal(allowed.maximumIndependentReviews, 2)
  assert.equal(allowed.requiresHumanDecision, true)
  assert.equal(evaluateHighImpactConsensusPolicyV1({ impact: "CRITICAL", evidenceConflict: true,
    portfolioOrCapitalRisk: true, changesSystemPolicy: true,
    budgetState: "CRITICAL_ONLY" }).enabled, false)
})

test("daily and event review contracts prefilter, dedupe, and remain inactive without authorization", () => {
  const schedule = buildDailyStrategicReviewScheduleContractV1({})
  assert.equal(schedule.status, "READY_BUT_NOT_ACTIVATED")
  assert.equal(schedule.schedule, null)
  assert.equal(schedule.clockTimeInvented, false)
  assert.equal(schedule.maximumAiCallsPerRun, 1)
  const event = planEventDrivenStrategicReviewV1({ eventType: "OUT_OF_STOCK_CONFIRMED",
    entityRefs: ["366581876813"], observedAt: "2026-08-12T12:00:00Z" })
  assert.equal(event.eligible, true)
  assert.equal(event.shouldQueueReview, true)
  const duplicate = planEventDrivenStrategicReviewV1({ eventType: "OUT_OF_STOCK_CONFIRMED",
    entityRefs: ["366581876813"], observedAt: "2026-08-12T12:01:00Z",
    previousEventFingerprint: event.fingerprint })
  assert.equal(duplicate.shouldQueueReview, false)
  assert.equal(planEventDrivenStrategicReviewV1({ eventType: "TITLE_CHANGED",
    entityRefs: ["366581876813"], observedAt: "2026-08-12T12:00:00Z" }).eligible, false)
})

test("Daily Brief fallback remains evidence-backed when AI is unavailable or exhausted", () => {
  const current = monitor([listing("366581876813")], [decision("366581876813")])
  const bundle = buildSystemReviewBundleV1({ monitor: current,
    authoritativeSpendUsd: 10 })
  const brief = buildDailyStrategicBriefFallbackV1({ bundle })
  assert.equal(brief.generatedBy, "DETERMINISTIC_FALLBACK")
  assert.equal(brief.evidenceBacked, true)
  assert.equal(brief.modelClaimsAdded, false)
  assert.equal(brief.marketplaceWrites, 0)
})

test("27, 100, 1000, and 5000+ scale policies never dump a portfolio or call per listing", () => {
  for (const count of [27, 100, 1_000, 5_000]) {
    const policy = buildLargeVolumeAiPolicyV1(count)
    assert.equal(policy.maximumModelCallsPerReview, 1)
    assert.equal(policy.maximumSignalsToModel, 20)
    assert.equal(policy.fullPortfolioModelDump, false)
    assert.equal(policy.oneAiCallPerListing, false)
    assert.equal(policy.cacheRequired, true)
    assert.equal(policy.dedupeRequired, true)
    assert.equal(policy.paginationRequired, true)
  }
})

test("Copilot, strategic agent, and UI expose no write, SQL, URL proxy, or image tool", () => {
  assert.match(agentSource, /tools: createReadOnlyAgentTools/)
  assert.match(agentSource, /tracingDisabled: true/)
  assert.match(agentSource, /traceIncludeSensitiveData: false/)
  assert.match(agentSource, /arbitrarySqlAllowed: false/)
  assert.match(agentSource, /arbitraryUrlFetchAllowed: false/)
  assert.match(agentSource, /imageGenerationEnabled: false/)
  assert.match(agentSource, /x-seller-os-workload/)
  assert.match(agentSource, /traceMetadata: \{ workload: input\.workload/)
  assert.doesNotMatch(agentSource, /imageGenerationTool|webSearchTool|shellTool|executeSql/)
  assert.doesNotMatch(copilotRoute + strategicRoute,
    /createOffer|publishOffer|reviseInventoryStatus|sendWhatsApp|\.insert\(|\.update\(|\.upsert\(|\.delete\(/)
  assert.match(copilotPage, /0 marketplace writes/)
  assert.match(strategicPage, /Aggressive thinking · conservative execution/)
})

test("canonical engines remain authoritative across AI DTOs", () => {
  assert.match(gatewaySource, /canonicalResultVersion/)
  assert.match(gatewaySource, /legacyDiagnosticsAuthoritative: false/)
  assert.match(gatewaySource, /mayOverrideCanonicalResult: false/)
  assert.match(portfolioSource, /CANONICAL_OPPORTUNITY_RESULT_V2/)
  assert.match(opportunitySource, /authoritative: true as const/)
  assert.match(agentSource, /Canonical Opportunity Result V2, Decisions V2, Experiment Guardian, Stock Guard/)
  assert.match(agentSource, /UNKNOWN is not risk/)
  assert.match(agentSource, /Never invent demand, sales probability, cost, health, identity/)
})

test("strategic surfaces are Preview-bound, persistence-safe, and explicit about activation", () => {
  for (const path of ["/admin/ebay/copilot", "/admin/ebay/strategic-review",
    "/api/admin/ebay/copilot", "/api/admin/ebay/strategic-review",
    "/api/admin/ebay/assistant/mcp", "/api/seller-os/assistant/mcp"])
    assert.match(boundaries, new RegExp(path.replaceAll("/", "\\/")))
  assert.match(strategicRoute, /PERSISTENCE_ACTIVATION_REQUIRES_AUTHORIZATION/)
  assert.match(strategicRoute, /PREVIEW_EPHEMERAL_NO_REMOTE_DDL/)
  assert.doesNotMatch(strategicRoute, /cron|schedule\s*:/i)
  assert.match(strategicPage, /READY_BUT_NOT_ACTIVATED|scheduler/i)
})
