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
const mcpToolPolicySource = read("./ebay-seller-os-mcp-tool-policy-v1.ts")
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
    sku: `SKU-${itemId}`, primaryImageUrl: null, lastObservedAt: "2026-08-12T00:00:00Z",
    marketplaceCertification: { status: "US_CERTIFIED" } },
  discovery: { livePresence: { status: "LIVE_ACTIVE" } },
  metrics: { impressions: observation(null, "UNAVAILABLE"),
    ebay_views: observation(null, "UNAVAILABLE"), views: observation(null, "UNAVAILABLE"),
    ctr_calculated: observation(null, "UNAVAILABLE"),
    ctr_reported: observation(null, "UNAVAILABLE"), ctr: observation(null, "UNAVAILABLE"),
    transactions: observation(null, "UNAVAILABLE"), orders: observation(null, "UNAVAILABLE") },
  stock: { state: "STOCK_UNKNOWN", sourceContractStatus: "UNPROVEN",
    supplierProductId: null, supplierVariantId: null, supplierSku: null,
    quantity: observation(null, "UNKNOWN"),
    freshness: { status: "UNKNOWN", ageSeconds: null, maximumAgeSeconds: 60 },
    limitationCode: "UNPROVEN" },
  composition: { bundleCapacity: observation(null, "UNKNOWN") },
  experiment: { status: "UNAVAILABLE", lifecycleState: null },
  blockers: [], dataQualityIssues: [], evidenceReferences: [], alertCandidateKeys: [],
  ...overrides }
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
  const liveItemCount = new Set(listings.filter((row) =>
    row.discovery.livePresence.status === "LIVE_ACTIVE")
    .map((row) => row.identity.itemId)).size
  return { contractVersion: "COMMERCIAL_MONITOR_READONLY_V1", mode: "READ_ONLY",
    generatedAt: "2026-08-12T00:00:00Z", listings, alertCandidates: [],
    liveCertification: { status: "CERTIFIED", marketplaceId: "EBAY_US",
      account: { bindingConfigured: true },
      discovery: { status: "AVAILABLE", coverage: "COMPLETE" } },
    productCaseOperatingState: { status: "PAUSED_FOR_MONITORING_MILESTONE", reset: false,
      resumePolicy: "RESUME_FROM_LAST_VERIFIED_GATE", manualGoldenPath: "PRESERVE" },
    learning: { status: "UNPROVEN", source: "EBAY_CATEGORY_LEARNING",
      evidenceTimestamp: null, categoryAdjustments: [], limitationCode: "NO_STORED_CATEGORY_LEARNING" },
    backend: { decisions, guidanceVsSellerOs: [],
      listingQualityReport: { status: "UNAVAILABLE_NO_CURRENT_REPORT", recommendations: [],
        limitationCode: "NO_CURRENT_REPORT" },
      orders: { status: "AUTH_PENDING", fulfillmentStatuses: ["AUTH_PENDING"] },
      trafficScopes: { accountTraffic: { status: "UNPROVEN",
        scopeId: "account-traffic:unproven", scopeType: "ACCOUNT_TRAFFIC_SCOPE",
        scopeCount: null, grain: "ACCOUNT_DAY_AGGREGATE", observedAt: null,
        sourceUpdatedAt: null, upstreamSnapshotAcquisitionCount: 0,
        accountTrafficSnapshotId: null,
        auditSpanId: "account-traffic-audit:not-attempted",
        metadataValidationStatus: "NOT_ATTEMPTED",
        metadataValidationReasonCode: null, cumulativeAcquisitionCount: 0,
        cacheHitCount: 0, retryCount: 0, retryPolicy: "NO_RETRY",
        snapshotReuseStatus: "UNAVAILABLE",
        snapshotReuseReasonCode: "SOURCE_UNAVAILABLE" },
        currentLivePortfolio: { activeListings: liveItemCount } },
      kpis: { activeListings: { status: "AVAILABLE", value: liveItemCount },
        impressions: { status: "UNPROVEN", value: null },
        ebayViews: { status: "UNPROVEN", value: null },
        averageCtr: { status: "UNPROVEN", value: null },
        quantitySold: { status: "UNPROVEN", value: null } },
      capabilities: { registry: { status: "COMPLETE", humanReviewCount: 0,
        currentLiveCount: liveItemCount, matchedCount: liveItemCount,
        coveragePercent: 100, limitationCodes: [] },
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
  assert.match(mcpSource + mcpToolPolicySource, /readOnlyHint: true/)
  assert.match(mcpSource + mcpToolPolicySource, /destructiveHint: false/)
  assert.match(mcpSource + mcpToolPolicySource, /openWorldHint: false/)
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

test("System Review Bundle separates live, evidence-entity, and Registry review rates", () => {
  const live = Array.from({ length: 27 }, (_, index) =>
    listing(String(366_800_000_000 + index)))
  live[0].identity.sku = "IMN-LST-000026"
  live[1].identity.sku = "IMN-LST-000026"
  const duplicate = structuredClone(live[26])
  duplicate.key = `stock-duplicate:${duplicate.identity.itemId}`
  duplicate.identity.title = "Conflicting Stock evidence title"
  const historical = Array.from({ length: 6 }, (_, index) => {
    const row = listing(String(365_700_000_000 + index))
    row.key = `historical:${row.identity.itemId}`
    row.discovery.livePresence.status = "ENDED"
    return row
  })
  const decisions = live.map((row, index) => decision(row.identity.itemId,
    index < 25 ? {
      recommendedAction: "HUMAN_REVIEW",
      evidenceStatus: "AVAILABLE",
      reasonCodes: ["BLOCKING_DATA_QUALITY_ISSUE"],
      actionBlockedByInsufficientEvidence: false,
    } : {
      classification: "HEALTHY_WAIT",
      evidenceStatus: "AVAILABLE",
      recommendedAction: "WAIT",
      reasonCodes: ["HEALTHY_EVIDENCE_WAIT_FOR_NEXT_REVIEW"],
      actionBlockedByInsufficientEvidence: false,
    }))
  decisions.push(decision(historical[0].identity.itemId, {
    listingKey: historical[0].key,
    recommendedAction: "HUMAN_REVIEW",
    reasonCodes: ["HISTORICAL_EVIDENCE_REVIEW_ONLY"],
    actionBlockedByInsufficientEvidence: false,
  }))
  const current = monitor([...live, duplicate, ...historical], decisions, {
    capabilities: {
      registry: { status: "PARTIAL_CERTIFIED", currentLiveCount: 27,
        humanReviewCount: 3, matchedCount: 24, coveragePercent: 88.89,
        limitationCodes: ["REGISTRY_RELATIONSHIP_HUMAN_REVIEW"] },
      inventory: { inventoryItemsResource: "UNPROVEN" },
    },
  })
  const bundle = buildSystemReviewBundleV1({ monitor: current })

  assert.equal(bundle.crossModuleIntegrity.hardeningVersion,
    "CROSS_MODULE_INTEGRITY_HARDENING_V2_2026_08_13")
  assert.equal(bundle.crossModuleIntegrity.canonicalCohort.listingCount, 27)
  assert.equal(bundle.crossModuleIntegrity.stockCohort.evidenceRowCount, 34)
  assert.equal(bundle.crossModuleIntegrity.stockCohort.nonLiveEvidenceRowCount, 6)
  assert.equal(bundle.crossModuleIntegrity.stockCohort.duplicateItemIds.length, 1)
  assert.equal(bundle.crossModuleIntegrity.findings.find((row) =>
    row.invariantCode === "NON_LIVE_EVIDENCE_PRESENT_EXCLUDED")?.lifecycle,
  "MITIGATED_BY_POLICY")
  assert.equal(bundle.operationalBurden.liveListingHumanReviewRate.numerator, 25)
  assert.equal(bundle.operationalBurden.liveListingHumanReviewRate.denominator, 27)
  assert.equal(bundle.operationalBurden.liveListingHumanReviewRate.rate, 92.59)
  assert.equal(bundle.operationalBurden.liveListingHumanReviewRate.grain,
    "EBAY_LIVE_LISTING")
  assert.equal(bundle.operationalBurden.liveListingHumanReviewRate.authority,
    "DECISION_TAXONOMY_V2")
  assert.equal(bundle.operationalBurden.evidenceEntityReviewRate.numerator, 25)
  assert.equal(bundle.operationalBurden.evidenceEntityReviewRate.denominator, 34)
  assert.equal(bundle.operationalBurden.evidenceEntityReviewRate.rate, 73.53)
  assert.equal(bundle.operationalBurden.evidenceEntityReviewRate
    .registryPartitionsIncluded, false)
  assert.equal(bundle.operationalBurden.evidenceEntityReviewRate.grain,
    "STOCK_EVIDENCE_ROW")
  assert.equal(bundle.operationalBurden.registryPartitionReviewRate.numerator, 3)
  assert.equal(bundle.operationalBurden.registryPartitionReviewRate.denominator, 27)
  assert.equal(bundle.decisions.humanReview.some((row) =>
    row.entityKey === historical[0].identity.itemId), false)
  assert.equal(bundle.registryIntegrity.status, "PARTIAL_CERTIFIED")
  assert.equal(bundle.registryIntegrity.matchedCount, 24)
  assert.equal(bundle.registryIntegrity.humanReviewCount, 3)
  assert.equal(bundle.registryIntegrity.coveragePercent, 88.89)
  assert.equal(bundle.registryIntegrity.unresolvedRelationshipMappingStatus,
    "UNPROVEN")
  assert.equal(bundle.registryIntegrity.unresolvedRelationshipItemIds, null)
  assert.equal(bundle.portfolio.state.replacementCandidateStatus, "UNPROVEN")
  assert.equal(bundle.portfolio.state.replacementCandidateCount, null)
  assert.equal(bundle.commercialAnomalies.referenceCandidateStatus, "UNPROVEN")
  assert.equal(bundle.commercialAnomalies.referenceCandidateCount, null)
  assert.equal(bundle.commercialAnomalies.sellOneLikeThisReady, null)
  assert.equal(bundle.economicsCompleteness.proven, null)
  assert.equal(bundle.economicsCompleteness.unproven, null)
  assert.equal(bundle.supplierAndStock.stockRisks, 0)
  assert.equal(bundle.supplierAndStock.stockRiskSemantics,
    "PROVEN_STOCK_RISKS_ONLY")
  assert.equal(bundle.supplierAndStock.stockSafeInferenceAllowed, false)
  assert.equal(bundle.supplierAndStock.exactSupplierLinked, 0)
  assert.equal(bundle.supplierAndStock.liveWithoutProvenSupplierLink, 27)
  assert.ok(bundle.strategicReviewQueue.entries.some((row) =>
    row.signalType === "DUPLICATE_ITEM_ID"))
  assert.ok(bundle.strategicReviewQueue.entries.some((row) =>
    row.signalType === "DUPLICATE_LIVE_SKU"))
  const mitigatedSignal = bundle.strategicReviewQueue.entries.find((row) =>
    row.signalType === "NON_LIVE_EVIDENCE_PRESENT_EXCLUDED")
  assert.equal(mitigatedSignal?.strategicClassification,
    "MITIGATED_CONDITION")
  assert.equal(mitigatedSignal?.invariantLifecycle, "MITIGATED_BY_POLICY")
  assert.ok((mitigatedSignal?.materiality ?? 100) <= 28)
  assert.equal(bundle.strategicReviewQueue.mitigatedFindingCount, 1)
  const liveSkuGuard = bundle.deterministicIntegrityGuards.entries.find((row) =>
    row.guardCode === "LIVE_SKU_UNIQUENESS_CHECK")
  assert.equal(liveSkuGuard?.status, "TRIGGERED")
  assert.equal(liveSkuGuard?.independentOfAutomationThreshold, true)
  assert.equal(bundle.automationCandidates.entries.some((row) =>
    row.manualOperation ===
      "HUMAN_REVIEW_LIVE_SKU_COLLISION_NO_MARKETPLACE_WRITE"), false)
  assert.equal(bundle.portfolio.state.humanReviewBurden.scopeType,
    "CURRENT_LIVE_COHORT_SCOPE")
  assert.equal(bundle.portfolio.state.humanReviewBurden.grain,
    "CANONICAL_COMMERCIAL_DECISION")
  assert.equal(bundle.portfolio.state.humanReviewBurden.authority,
    "RAW_CANONICAL_COMMERCIAL_DECISION_V1")
  assert.equal(bundle.operationalBurden.manualReviewCount.scopeType,
    "CURRENT_LIVE_COHORT_SCOPE")
  assert.equal(bundle.operationalBurden.manualReviewCount.grain,
    "EBAY_LIVE_LISTING")
  assert.equal(bundle.operationalBurden.manualReviewCount.authority,
    "DECISION_TAXONOMY_V2")
  assert.equal(bundle.portfolio.state.burdenSemanticPolicy.equalityRequired,
    false)
  assert.equal(bundle.operationalBurden.authorityComparison.status, "PASS")
  assert.equal(bundle.operationalBurden.authorityComparison
    .comparisonRequiresMatchingAuthorityAndGrain, true)
  assert.equal(bundle.operationalBurden.authorityComparison
    .directEqualityAllowed, false)
  assert.equal(bundle.deterministicIntegrityGuards.entries.find((row) =>
    row.guardCode === "REVIEW_BURDEN_AUTHORITY_MISMATCH_GUARD")?.status,
  "PASS")
  assert.equal(new Set(bundle.strategicReviewQueue.entries.map((row) =>
    row.signalId)).size, bundle.strategicReviewQueue.entries.length)
})

test("Registry failure is isolated from analytics, decisions, burden, and commercial materiality", () => {
  const live = Array.from({ length: 5 }, (_, index) => {
    const row = listing(String(366_810_000_000 + index))
    row.metrics = {
      ...row.metrics,
      impressions: observation(1_000 + index),
      ebay_views: observation(25 + index),
      views: observation(25 + index),
      ctr_calculated: observation(2.5),
      ctr_reported: observation(2.5),
      ctr: observation(2.5),
      transactions: observation(0),
    }
    return row
  })
  const current = monitor(live, live.map((row) => decision(
    row.identity.itemId,
    { recommendedAction: "HUMAN_REVIEW",
      reasonCodes: ["LISTING_IDENTITY_UNPROVEN"],
      actionBlockedByInsufficientEvidence: false,
      evidenceStatus: "AVAILABLE" },
  )), {
    capabilities: {
      registry: { status: "UNAVAILABLE", currentLiveCount: null,
        humanReviewCount: null, matchedCount: null, coveragePercent: null,
        limitationCodes: ["COMMERCIAL_REGISTRY_READ_FAILED"] },
      inventory: { inventoryItemsResource: "UNPROVEN" },
    },
    kpis: { activeListings: { status: "AVAILABLE", value: 5 },
      impressions: { status: "AVAILABLE", value: 5_010 },
      ebayViews: { status: "AVAILABLE", value: 135 },
      averageCtr: { status: "AVAILABLE", value: 2.5 },
      quantitySold: { status: "AVAILABLE", value: 0 } },
  })
  const bundle = buildSystemReviewBundleV1({ monitor: current })

  assert.equal(bundle.dataParity.registry.status, "UNAVAILABLE")
  assert.equal(bundle.registryIntegrity.matchedCount, null)
  assert.equal(bundle.registryIntegrity.humanReviewCount, null)
  assert.equal(bundle.registryIntegrity.coveragePercent, null)
  assert.equal(bundle.dataParity.decisions.status, "AVAILABLE")
  assert.equal(bundle.capabilityFaultIsolation
    .registryFailureMaySuppressIndependentEvidence, false)
  assert.equal(bundle.capabilityFaultIsolation.registryDecisionPolicy,
    "REGISTRY_UNAVAILABLE_MUST_NOT_ERASE_INDEPENDENT_DECISION_EVIDENCE_V1")
  assert.equal(bundle.capabilityFaultIsolation.independentlyPreserved
    .commercialMateriality, "AVAILABLE")
  assert.equal(bundle.portfolio.state.humanReviewBurden.value, 5)
  assert.equal(bundle.operationalBurden.manualReviewCount.value, 5)
  assert.equal(bundle.operationalBurden.manualReviewCount.authority,
    "DECISION_TAXONOMY_V2")
  assert.equal(bundle.operationalBurden.manualReviewCount.zeroIsAuthoritative,
    false)
  assert.equal(bundle.operationalBurden.falseZeroGuard.status, "PASS")
  assert.equal(bundle.operationalBurden.registryPartitionReviewRate.numerator,
    null)
  assert.equal(bundle.decisions.humanReview.length, 5)
  assert.equal(bundle.decisions.humanReview.every((entry) => {
    const materiality = entry.observedEvidence.commercialMateriality
    return materiality.impressions !== null &&
      materiality.independentlyRepresentedFromDataQuality === true
  }), true)
  assert.ok(bundle.automationCandidates.entries.some((candidate) =>
    candidate.manualOperation ===
      "IDENTIFY_REPEATABLE_LOW_RISK_RESOLUTION_PATTERNS" &&
      candidate.autoEnableAllowed === false &&
      candidate.evidenceStatus === "AVAILABLE"))
})

test("Registry unavailable with stale operational payload does not force false-authoritative zero", () => {
  const hearingAidsItemId = "366575102453"
  const live = Array.from({ length: 27 }, (_, index) => {
    const itemId = index === 0 ? hearingAidsItemId : String(3_668_000_000 + index)
    const row = listing(itemId)
    row.metrics = {
      ...row.metrics,
      impressions: itemId === hearingAidsItemId ? observation(1_343) : observation(1_000 + index),
      ebay_views: itemId === hearingAidsItemId ? observation(1) : observation(11 + index),
      views: itemId === hearingAidsItemId ? observation(1) : observation(11 + index),
      ctr_calculated: itemId === hearingAidsItemId ? observation(0.2119)
        : observation(0.32),
      ctr_reported: itemId === hearingAidsItemId ? observation(0.2119)
        : observation(0.32),
      ctr: itemId === hearingAidsItemId ? observation(0.2119)
        : observation(0.32),
      transactions: observation(0),
    }
    if (itemId === hearingAidsItemId) {
      row.discovery.livePresence.status = "LIVE_ACTIVE"
      row.identity.title = "Hearing Aids Hearing Amplifiers for Seniors Rechargeable with Noise Cancelling"
    }
    return row
  })
  const reviewable = 24
  const decisions = live.map((row, index) => decision(row.identity.itemId,
    index < reviewable
      ? {
        recommendedAction: "HUMAN_REVIEW",
        reasonCodes: ["INDEPENDENT_EVIDENCE_OPPORTUNITY"],
        actionBlockedByInsufficientEvidence: false,
        evidenceStatus: "AVAILABLE",
      }
      : {
        classification: "HEALTHY_WAIT",
        evidenceStatus: "AVAILABLE",
        recommendedAction: "WAIT",
        reasonCodes: ["HEALTHY_EVIDENCE_WAIT_FOR_NEXT_REVIEW"],
        actionBlockedByInsufficientEvidence: false,
      }))
  const current = monitor(live, decisions, {
    capabilities: {
      registry: { status: "UNAVAILABLE", currentLiveCount: null,
        humanReviewCount: null, matchedCount: null, coveragePercent: null,
        limitationCodes: ["COMMERCIAL_REGISTRY_READ_FAILED"] },
      inventory: { inventoryItemsResource: "UNPROVEN" },
    },
    kpis: {
      activeListings: { status: "AVAILABLE", value: 27 },
      impressions: { status: "AVAILABLE", value: 30_000 },
      ebayViews: { status: "AVAILABLE", value: 120 },
      averageCtr: { status: "AVAILABLE", value: 0.34 },
      quantitySold: { status: "AVAILABLE", value: 0 },
    },
    operationalHealth: {
      manualReview: {
        contractVersion: "OPERATIONAL_REVIEW_BURDEN_V2_2026_08_13",
        status: "AVAILABLE",
        value: 0,
        numerator: 0,
        denominator: 27,
        authority: "DECISION_TAXONOMY_V2",
        scopeId: "current-live:cohort:2026-08-13",
        scopeType: "CURRENT_LIVE_COHORT_SCOPE",
        scopeCount: 27,
        observedAt: "2026-08-13T17:59:02Z",
        grain: "EBAY_LIVE_LISTING",
        entityType: "EBAY_LIVE_LISTING",
        zeroIsAuthoritative: true,
        reasonCode: "AUTHORITATIVE_OPERATIONAL_ZERO",
        dependencyStatus: {
          currentLiveIdentity: "AVAILABLE",
          decisions: "AVAILABLE",
          registry: "UNAVAILABLE",
          unresolvedListingCount: 3,
          registryUnavailableMayBecomeZero: false,
        },
        falseZeroGuard: {
          guardCode: "OPERATIONAL_REVIEW_FALSE_ZERO_GUARD",
          status: "PASS",
          authority: "DECISION_TAXONOMY_V2",
          scopeType: "CURRENT_LIVE_COHORT_SCOPE",
          scopeCount: 27,
          reasonCode: "AUTHORITATIVE_OPERATIONAL_ZERO",
          zeroIsAuthoritative: true,
          dependencyStatus: "AVAILABLE",
          observedAt: "2026-08-13T17:59:02Z",
          autoMutationAllowed: false,
        },
      },
      runningExperiments: { status: "AVAILABLE", count: 0 },
      needIntervention: { status: "AVAILABLE", count: null },
      doNotTouch: { status: "AVAILABLE", count: null },
      readyToEvaluate: { status: "AVAILABLE", count: null },
      externalSignalReview: { status: "UNAVAILABLE", count: null },
      stockRisk: { status: "UNAVAILABLE", count: null },
      dataQuality: { status: "UNAVAILABLE", count: null },
      ebayRecommendations: { status: "UNAVAILABLE", count: null },
      waitingHealthy: { status: "UNAVAILABLE", count: null },
      criticalAlerts: { status: "UNAVAILABLE", count: null },
      stockUnknown: { status: "UNAVAILABLE", count: null },
      priorityActionPlan: [],
      upcomingReviews: [],
      performanceSeries: { status: "MISSING", points: [], limitationCode: null },
      statusDistribution: [],
      categoryBenchmarks: [],
    },
  })
  const bundle = buildSystemReviewBundleV1({ monitor: current })

  assert.equal(bundle.dataParity.registry.status, "UNAVAILABLE")
  assert.equal(bundle.registryIntegrity.currentLiveCount, null)
  assert.equal(bundle.registryIntegrity.matchedCount, null)
  assert.equal(bundle.registryIntegrity.humanReviewCount, null)
  assert.equal(bundle.registryIntegrity.coveragePercent, null)
  assert.equal(bundle.dataParity.trafficKpis.status, "AVAILABLE")
  assert.equal(bundle.dataParity.decisions.status, "AVAILABLE")
  assert.equal(bundle.dataParity.decisions.zeroIsAuthoritative, true)
  assert.equal(bundle.operationalBurden.manualReviewCount.status, "AVAILABLE")
  assert.equal(bundle.operationalBurden.manualReviewCount.value, 24)
  assert.equal(bundle.operationalBurden.manualReviewCount.zeroIsAuthoritative, false)
  assert.equal(bundle.operationalBurden.manualReviewRate.numerator, 24)
  assert.equal(bundle.operationalBurden.manualReviewRate.denominator, 27)
  assert.equal(bundle.operationalBurden.manualReviewRate.authority, "DECISION_TAXONOMY_V2")
  assert.equal(bundle.operationalBurden.falseZeroGuard.status, "PASS")
  const hearing = bundle.decisions.humanReview.find((entry) =>
    entry.entityKey === hearingAidsItemId) ??
    bundle.decisions.todaysCommercialPriorities.find((entry) =>
      entry.entityKey === hearingAidsItemId)
  assert.equal(hearing?.entityKey ?? null, hearingAidsItemId)
  assert.equal(hearing?.observedEvidence.commercialMateriality?.impressions, 1_343)
  assert.equal(hearing?.observedEvidence.commercialMateriality?.ebayViews, 1)
  assert.equal(hearing?.observedEvidence.commercialMateriality?.ctr, 0.2119)
  assert.equal(bundle.operationalBurden.authorityComparison.status, "PASS")
  assert.equal(bundle.operationalBurden.authorityComparison
    .comparisonRequiresMatchingAuthorityAndGrain, true)
  assert.equal(bundle.operationalBurden.authorityComparison.directEqualityAllowed, false)
})

test("Registry capability blockers coexist with independently derivable listing priorities", () => {
  const itemId = "366811000001"
  const row = listing(itemId)
  row.metrics = {
    ...row.metrics,
    impressions: observation(3_339),
    ebay_views: observation(18),
    views: observation(18),
    ctr_calculated: observation(0.54),
    ctr_reported: observation(0.54),
    ctr: observation(0.54),
    transactions: observation(0),
  }
  row.blockers = [{ code: "SOURCE_UNAVAILABLE", domain: "COLLECTOR",
    source: "EBAY_ACTIVE_LISTING_REGISTRY" }]
  const current = monitor([row], [decision(itemId)], {
    capabilities: {
      registry: { status: "UNAVAILABLE", currentLiveCount: null,
        humanReviewCount: null, matchedCount: null, coveragePercent: null,
        limitationCodes: ["COMMERCIAL_REGISTRY_READ_FAILED"] },
      inventory: { inventoryItemsResource: "UNPROVEN" },
    },
    kpis: { activeListings: { status: "AVAILABLE", value: 1 },
      impressions: { status: "AVAILABLE", value: 3_339 },
      ebayViews: { status: "AVAILABLE", value: 18 },
      averageCtr: { status: "AVAILABLE", value: 0.54 },
      quantitySold: { status: "AVAILABLE", value: 0 } },
  })
  const bundle = buildSystemReviewBundleV1({ monitor: current })

  assert.equal(bundle.operationalBurden.manualReviewCount.status, "PARTIAL")
  assert.equal(bundle.operationalBurden.manualReviewCount.value, null)
  assert.equal(bundle.operationalBurden.manualReviewCount.zeroIsAuthoritative,
    false)
  assert.equal(bundle.operationalBurden.falseZeroGuard.status, "PASS")
  assert.ok(bundle.decisions.capabilityBlockers.length > 0)
  const priority = bundle.decisions.actionableCommercial.find((entry) =>
    entry.entityKey === itemId)
  assert.equal(priority?.recommendedAction, "IMPROVE_CTR")
  assert.equal(priority?.observedEvidence.commercialMateriality.impressions,
    3_339)
  assert.equal(priority?.observedEvidence.commercialMateriality
    .independentlyRepresentedFromDataQuality, true)
  assert.equal(bundle.decisions.todaysCommercialPriorities.some((entry) =>
    entry.entityKey === itemId), true)
  assert.equal(bundle.registryIntegrity.humanReviewCount, null)
  assert.equal(bundle.deterministicIntegrityGuards.entries.find((guard) =>
    guard.guardCode === "OPERATIONAL_REVIEW_FALSE_ZERO_GUARD")?.status,
  "PASS")
})

test("Registry recovery restores only Registry counts without duplicating independent priorities", () => {
  const live = Array.from({ length: 3 }, (_, index) =>
    listing(String(366_812_000_000 + index)))
  const decisions = live.map((row) => decision(row.identity.itemId, {
    recommendedAction: "HUMAN_REVIEW",
    reasonCodes: ["LISTING_IDENTITY_UNPROVEN"],
    actionBlockedByInsufficientEvidence: false,
    evidenceStatus: "AVAILABLE",
  }))
  const unavailable = buildSystemReviewBundleV1({ monitor: monitor(live, decisions, {
    capabilities: {
      registry: { status: "UNAVAILABLE", currentLiveCount: null,
        humanReviewCount: null, matchedCount: null, coveragePercent: null,
        limitationCodes: ["COMMERCIAL_REGISTRY_READ_FAILED"] },
      inventory: { inventoryItemsResource: "UNPROVEN" },
    },
  }) })
  const recovered = buildSystemReviewBundleV1({ monitor: monitor(live, decisions, {
    capabilities: {
      registry: { status: "PARTIAL_CERTIFIED", currentLiveCount: 3,
        humanReviewCount: 1, matchedCount: 2, coveragePercent: 66.67,
        limitationCodes: ["REGISTRY_RELATIONSHIP_HUMAN_REVIEW"] },
      inventory: { inventoryItemsResource: "UNPROVEN" },
    },
  }) })

  assert.equal(unavailable.operationalBurden.manualReviewCount.value, 3)
  assert.equal(recovered.operationalBurden.manualReviewCount.value, 3)
  assert.equal(unavailable.registryIntegrity.humanReviewCount, null)
  assert.equal(recovered.registryIntegrity.humanReviewCount, 1)
  assert.equal(new Set(recovered.decisions.todaysCommercialPriorities.map((entry) =>
    entry.dedupeIdentity)).size,
  recovered.decisions.todaysCommercialPriorities.length)
})

test("missing operational decision coverage remains null instead of false zero", () => {
  const live = [listing("366813000001"), listing("366813000002")]
  const bundle = buildSystemReviewBundleV1({ monitor: monitor(live, []) })
  assert.equal(bundle.operationalBurden.manualReviewCount.status, "PARTIAL")
  assert.equal(bundle.operationalBurden.manualReviewCount.value, null)
  assert.equal(bundle.operationalBurden.manualReviewCount.zeroIsAuthoritative,
    false)
  assert.equal(bundle.operationalBurden.falseZeroGuard.status, "PASS")
})

test("unconfigured runtime never presents empty portfolio, experiments, or stock as proven zero", () => {
  const current = monitor([], [], {
    kpis: { activeListings: { status: "UNPROVEN", value: null },
      impressions: { status: "UNPROVEN", value: null },
      ebayViews: { status: "UNPROVEN", value: null },
      averageCtr: { status: "UNPROVEN", value: null },
      quantitySold: { status: "UNPROVEN", value: null } },
    capabilities: { registry: { status: "UNPROVEN", currentLiveCount: null,
      matchedCount: null, humanReviewCount: null, coveragePercent: null,
      limitationCodes: ["REGISTRY_CANONICAL_EVIDENCE_UNAVAILABLE"] },
      inventory: { inventoryItemsResource: "UNPROVEN" } },
    operationalHealth: { runningExperiments: { status: "UNPROVEN" } },
  })
  current.connection = { status: "UNAVAILABLE", readers: [{
    source: "SELLER_ACCOUNT_SCOPE", status: "UNAVAILABLE", observedAt: null,
    limitationCode: "ACCOUNT_KEY_REQUIRED",
  }] }
  current.learning = { status: "UNAVAILABLE", source: "EBAY_CATEGORY_LEARNING",
    evidenceTimestamp: null, categoryAdjustments: [],
    limitationCode: "ACCOUNT_SCOPE_NOT_CONFIGURED" }
  const bundle = buildSystemReviewBundleV1({ monitor: current })

  assert.equal(bundle.dataParity.accountScope.classification,
    "RUNTIME_CONFIGURATION_GAP")
  assert.equal(bundle.dataParity.livePortfolio.classification,
    "RUNTIME_CONFIGURATION_GAP")
  assert.equal(bundle.dataParity.registry.classification,
    "RUNTIME_CONFIGURATION_GAP")
  assert.equal(bundle.dataParity.trafficKpis.classification,
    "RUNTIME_CONFIGURATION_GAP")
  assert.equal(bundle.dataParity.decisions.classification,
    "RUNTIME_CONFIGURATION_GAP")
  assert.equal(bundle.dataParity.experiments.classification,
    "RUNTIME_CONFIGURATION_GAP")
  assert.equal(bundle.dataParity.stock.classification,
    "RUNTIME_CONFIGURATION_GAP")
  assert.equal(bundle.dataParity.learning.classification,
    "RUNTIME_CONFIGURATION_GAP")
  assert.equal(bundle.dataParity.opportunities.classification,
    "PERSISTENCE_NOT_IMPLEMENTED")
  assert.equal(bundle.dataParity.qualityReport.classification,
    "PERSISTENCE_NOT_IMPLEMENTED")
  assert.equal(bundle.portfolio.state.currentLiveListingCountStatus, "UNPROVEN")
  assert.equal(bundle.portfolio.state.currentLiveListingCount, null)
  assert.equal(bundle.portfolio.state.healthyWaitingCount, null)
  assert.equal(bundle.portfolio.state.interventionBurden, null)
  assert.equal(bundle.portfolio.state.humanReviewBurden.status, "UNPROVEN")
  assert.equal(bundle.portfolio.state.humanReviewBurden.value, null)
  assert.equal(bundle.operationalBurden.manualReviewCount.status, "UNPROVEN")
  assert.equal(bundle.operationalBurden.manualReviewCount.value, null)
  assert.equal(bundle.operationalBurden.manualReviewRate.status, "UNPROVEN")
  assert.equal(bundle.operationalBurden.manualReviewRate.value, null)
  assert.equal(bundle.automationHealth.staleEvidenceRate.status, "UNPROVEN")
  assert.equal(bundle.automationHealth.staleEvidenceRate.value, null)
  assert.equal(bundle.supplierAndStock.totalListings, null)
  assert.equal(bundle.supplierAndStock.exactSupplierLinked, null)
  assert.equal(bundle.supplierAndStock.stockUnknown, null)
  assert.equal(bundle.experiments.authoritative, false)
  assert.equal(bundle.supplierAndStock.stockUnknownIsRisk, false)
})

test("a source-proven empty portfolio remains an authoritative zero", () => {
  const bundle = buildSystemReviewBundleV1({ monitor: monitor([], []) })
  assert.equal(bundle.dataParity.accountScope.status, "AVAILABLE")
  assert.equal(bundle.dataParity.livePortfolio.status, "AVAILABLE")
  assert.equal(bundle.dataParity.livePortfolio.zeroIsAuthoritative, true)
  assert.equal(bundle.dataParity.decisions.zeroIsAuthoritative, true)
  assert.equal(bundle.dataParity.experiments.zeroIsAuthoritative, true)
  assert.equal(bundle.dataParity.stock.zeroIsAuthoritative, true)
  assert.equal(bundle.portfolio.liveListingCount, 0)
  assert.equal(bundle.portfolio.state.currentLiveListingCountStatus, "AVAILABLE")
  assert.equal(bundle.portfolio.state.currentLiveListingCount, 0)
  assert.equal(bundle.supplierAndStock.totalListings, 0)
  assert.equal(bundle.supplierAndStock.stockUnknown, 0)
  assert.equal(bundle.experiments.authoritative, true)
  assert.equal(bundle.experiments.resultCount, 0)
  assert.equal(bundle.experiments.resultStatus, "AVAILABLE")
})

test("invalid Account Traffic metadata stays unavailable and reaches the supervisor with telemetry", () => {
  const current = monitor([], [])
  current.backend.trafficScopes.accountTraffic = {
    ...current.backend.trafficScopes.accountTraffic,
    status: "UNAVAILABLE",
    scopeId: "account-traffic:UTC:2026-07-14:2026-08-12",
    scopeCount: null,
    accountTrafficSnapshotId: null,
    auditSpanId: "account-traffic-audit:test",
    metadataValidationStatus: "INVALID",
    metadataValidationReasonCode: "ACCOUNT_TRAFFIC_LAST_UPDATED_DATE_INVALID",
    upstreamSnapshotAcquisitionCount: 2,
    cumulativeAcquisitionCount: 7,
    cacheHitCount: 0,
    retryCount: 1,
    impressions: null,
    listingViews: null,
    quantitySold: null,
    ctr: null,
  }
  const bundle = buildSystemReviewBundleV1({ monitor: current })
  const guard = bundle.deterministicIntegrityGuards.entries.find((entry) =>
    entry.guardCode === "ACCOUNT_TRAFFIC_METADATA_VALIDATION_GUARD")
  assert.equal(guard?.status, "TRIGGERED")
  assert.equal(bundle.trafficScopeIntegrity.accountTraffic
    .metadataValidationStatus, "INVALID")
  assert.equal(bundle.trafficScopeIntegrity.accountTraffic
    .upstreamSnapshotAcquisitionCount, 2)
  assert.equal(bundle.trafficScopeIntegrity.accountTraffic
    .cumulativeAcquisitionCount, 7)
  assert.equal(bundle.trafficScopeIntegrity.accountTraffic.impressions, null)
  assert.equal(bundle.trafficScopeIntegrity.accountTraffic.quantitySold, null)
  assert.ok(bundle.strategicReviewQueue.entries.some((entry) =>
    entry.signalType === "ACCOUNT_TRAFFIC_METADATA_VALIDATION_GUARD" &&
    entry.strategicClassification === "CAPABILITY_BLOCKER"))
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

test("system review exposes bounded order operations and monitored-scope evidence", () => {
  const live = Array.from({ length: 30 }, (_, index) =>
    listing(String(366_900_000_000 + index)))
  const itemIds = live.map((row) => row.identity.itemId)
  const sales = Array.from({ length: 12 }, (_, index) => ({
    orderId: `ORDER-${index}`,
    orderLineItemIds: [`LINE-${index}`],
    itemIds: [itemIds[index]],
    listingTitle: `Listing ${itemIds[index]}`,
    quantity: 1,
    orderTotal: 20 + index,
    currency: "USD",
    soldAt: new Date(Date.UTC(2026, 7, 12, 0, index)).toISOString(),
    paymentState: "PAID",
    fulfillmentState: "NOT_STARTED",
    attributionStatus: "PROVEN",
    buyerMessageStatus: "UNPROVEN",
    whatsappNotificationStatus: "UNPROVEN",
    supplierStockStatus: "UNPROVEN",
    evidenceReference: `EBAY_ORDER:ORDER-${index}`,
    buyerPiiIncluded: false,
  }))
  const current = monitor(live, live.map((row) =>
    decision(row.identity.itemId)), {
    orderSourceHealth: {
      contractVersion: "ORDER_SOURCE_HEALTH_V1",
      detectionPolicyVersion: "ORDER_DETECTION_POLICY_V1",
      capability: "EBAY_SELL_FULFILLMENT_GET_ORDERS",
      permissionStatus: "PROVEN",
      detectionMode: "POLLING",
      eventDrivenStatus: "OFFICIAL_CAPABILITY_UNPROVEN_NOT_CONFIGURED",
      status: "AVAILABLE",
      pollIntervalMinutes: 5,
      expectedDetectionLatency: "Configured polling; scheduler activation separate",
      observedAt: "2026-08-12T00:00:00.000Z",
      lastSuccessfulReadAt: "2026-08-12T00:00:00.000Z",
      limitationCodes: [],
      bounded: true,
      idempotent: true,
      incrementalCursor: true,
      overlapMinutes: 5,
    },
    recentSales: {
      contractVersion: "RECENT_SALES_FEED_V1",
      status: "AVAILABLE",
      resultCount: 12,
      entries: sales,
      maximumEntries: 10,
      truncated: true,
      limitationCodes: ["RECENT_SALES_FEED_RESULT_LIMIT_REACHED"],
      source: "PERSISTED_OFFICIAL_EBAY_ORDER_EVENTS",
      buyerPiiIncluded: false,
    },
    monitorCoverage: {
      contractVersion: "MONITOR_COVERAGE_TRANSPARENCY_V1",
      status: "AVAILABLE",
      currentLiveScopeId: "current-live:EBAY_US:test",
      currentLiveScopeType: "CURRENT_LIVE_COHORT_SCOPE",
      currentLiveScopeCount: 30,
      currentLiveObservedAt: "2026-08-12T00:00:00.000Z",
      monitoredItemIds: itemIds,
      visiblePriorityItemIds: itemIds.slice(0, 8),
      visiblePriorityRowCount: 8,
      monitoredOutsideVisibleCount: 22,
      visibleRowsEqualMonitoredScope: false,
      visibleRowsArePresentationSubset: true,
      notVisibleDoesNotMeanNotMonitored: true,
    },
  })
  const bundle = buildSystemReviewBundleV1({ monitor: current })
  const prefiltered = prefilterStrategicReviewV1({ bundle })

  assert.equal(bundle.orderOperations.recentSales.entries.length, 10)
  assert.equal(bundle.orderOperations.monitorCoverage.monitoredItemIds.length, 25)
  assert.equal(bundle.orderOperations.monitorCoverage.monitoredItemIdsTruncated,
    true)
  assert.equal(bundle.orderOperations.monitorCoverage.visiblePriorityItemIds.length,
    8)
  assert.equal(bundle.orderOperations.buyerPiiIncluded, false)
  assert.ok(prefiltered.boundedPayload.orderOperations)
  assert.ok(prefiltered.boundedPayload.orderOperations.recentSales.entries.length <=
    10)
  assert.ok(prefiltered.contextWithinLimit)
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
  assert.match(strategicRoute, /operatorEbayLoginRequired: false/)
  assert.match(strategicRoute, /secretExposure: 0/)
  assert.match(strategicRoute, /marketplaceWrites: 0/)
  assert.match(strategicRoute, /customerProductionUntouched: true/)
  assert.doesNotMatch(strategicRoute, /cron|schedule\s*:/i)
  assert.match(strategicPage, /READY_BUT_NOT_ACTIVATED|scheduler/i)
})
