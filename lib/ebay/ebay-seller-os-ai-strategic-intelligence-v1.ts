import { createHash } from "node:crypto"

import type { CommercialMonitorGetDto, LivePortfolioInvariantCode } from
  "./commercial-monitor-readonly-contract"
import type { CanonicalOpportunityResultV2 } from
  "./ebay-commercial-intelligence-upgrade-v1"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { buildAutomationHealthMetricsV1, buildPortfolioIntelligenceV1, buildProactiveExceptionQueueV1, selectMaterialPrioritiesV2 } from "./ebay-seller-os-portfolio-intelligence-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { currentLiveListingsForMonitorV1, resolveCrossModuleLivePortfolioIntegrityV1 } from "./ebay-seller-os-live-portfolio-integrity-v1.ts"

export const SELLER_OS_AI_STRATEGIC_INTELLIGENCE_VERSION =
  "SELLER_OS_AI_STRATEGIC_INTELLIGENCE_V1_2026_08_12"
export const ASSISTANT_FINDING_VERSION = "ASSISTANT_FINDING_V1_2026_08_12"
export const SYSTEM_REVIEW_BUNDLE_VERSION = "SYSTEM_REVIEW_BUNDLE_V1_2026_08_12"
export const STRATEGIC_REVIEW_QUEUE_VERSION = "STRATEGIC_REVIEW_QUEUE_V1_2026_08_12"
export const SELLER_OS_AI_MONTHLY_BUDGET_USD = 10
export const SELLER_OS_AI_MAX_BUNDLE_ENTITIES = 40
export const SELLER_OS_AI_MAX_MODEL_SIGNALS = 20
export const SELLER_OS_AI_MAX_CONTEXT_CHARACTERS = 48_000

export const SELLER_OS_AI_WORKLOADS = Object.freeze([
  "seller_os.strategic_review",
  "seller_os.daily_brief",
  "seller_os.market_research",
  "seller_os.keyword_intelligence",
  "seller_os.product_family",
  "seller_os.commercial_decision",
  "seller_os.listing_analysis",
  "seller_os.experiment_evaluation",
  "seller_os.reference_strategy",
  "seller_os.system_coherence",
  "seller_os.copilot",
] as const)

export type SellerOsAiWorkload = typeof SELLER_OS_AI_WORKLOADS[number]
export type AiBudgetState = "NORMAL" | "WATCH" | "CONSERVE" | "CRITICAL_ONLY" |
  "BUDGET_EXHAUSTED"
export type StrategicSignalType = "DECISION_CONFLICT" | "CANONICAL_TRUTH_CONFLICT" |
  "HIGH_MANUAL_REVIEW_RATE" | "FALSE_INTERVENTION_SPIKE" |
  "DUPLICATE_EXCEPTION_SPIKE" | "STALE_EVIDENCE_SPIKE" | "SUPPLIER_RISK" |
  "OPPORTUNITY_STRENGTHENING" | "OPPORTUNITY_WEAKENING" |
  "REPLACEMENT_CANDIDATE" | "EXPERIMENT_READY" | "QUALITY_GUIDANCE_CONFLICT" |
  "KEYWORD_QUALITY_ANOMALY" | "PRICE_DISTRIBUTION_ANOMALY" |
  "PORTFOLIO_CONCENTRATION_RISK" | "CAPABILITY_BLOCKER" | "AUTOMATION_FAILURE" |
  "SCHEDULER_LATENCY" | "AI_COST_ANOMALY" | "MODEL_FALLBACK_SPIKE" |
  "HIGH_HUMAN_OVERRIDE_RATE" | LivePortfolioInvariantCode
export type FindingStatus = "PROPOSED" | "HUMAN_ACCEPTED" | "HUMAN_REJECTED" |
  "IMPLEMENTED" | "MEASURED"

export type AssistantFindingV1 = {
  contractVersion: typeof ASSISTANT_FINDING_VERSION
  findingId: string
  findingType: StrategicSignalType
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
  module: string
  entityRefs: string[]
  evidenceRefs: string[]
  summary: string
  whyItMatters: string
  recommendedImprovement: string
  automationCandidate: boolean
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNPROVEN"
  createdAt: string
  status: FindingStatus
}

export type StrategicSignalV1 = {
  signalId: string
  signalType: StrategicSignalType
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
  module: string
  entityRefs: string[]
  evidenceRefs: string[]
  evidenceCount: number
  summary: string
  nextAction: string
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNPROVEN"
  materiality: number
  observedAt: string
  deterministic: true
}

export type AiUsageObservationV1 = {
  requestCount: number
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
  model: string | null
  fallbackUsed: boolean | null
  workload: SellerOsAiWorkload
  observedAt: string
  actualCostUsd: number | null
  costEvidence: "AUTHORITATIVE" | "UNPROVEN"
}

export type SellerOsSourceGapClassificationV1 =
  | "RUNTIME_CONFIGURATION_GAP"
  | "SOURCE_NOT_AVAILABLE"
  | "PERSISTENCE_NOT_IMPLEMENTED"
  | "EXPECTED_UNAVAILABLE"
  | "REAL_EXTERNAL_BLOCKER"
  | "CODE_WIRING_DEFECT"

type SellerOsSourceParityV1 = Readonly<{
  status: "AVAILABLE" | "PARTIAL" | "UNPROVEN" | "UNAVAILABLE"
  classification: SellerOsSourceGapClassificationV1 | null
  source: string
  limitationCode: string | null
  zeroIsAuthoritative: boolean
}>

function stableId(prefix: string, values: unknown[]) {
  const digest = createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 24)
  return `${prefix}:${digest}`
}

function cap<T>(values: T[], maximum: number) {
  return values.slice(0, Math.min(SELLER_OS_AI_MAX_BUNDLE_ENTITIES,
    Math.max(0, maximum)))
}

function roundedRatio(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : null
}

export function evaluateAiBudgetPolicyV1(input: {
  monthlyBudgetUsd?: number
  authoritativeSpendUsd?: number | null
  windowStart?: string | null
  now?: string
}) {
  const monthlyBudgetUsd = Number.isFinite(input.monthlyBudgetUsd) &&
    (input.monthlyBudgetUsd ?? 0) > 0 ? input.monthlyBudgetUsd! :
    SELLER_OS_AI_MONTHLY_BUDGET_USD
  const spend = typeof input.authoritativeSpendUsd === "number" &&
    Number.isFinite(input.authoritativeSpendUsd) && input.authoritativeSpendUsd >= 0
    ? input.authoritativeSpendUsd : null
  const ratio = spend === null ? null : spend / monthlyBudgetUsd
  const state: AiBudgetState = ratio === null ? "WATCH" : ratio >= 1
    ? "BUDGET_EXHAUSTED" : ratio >= 0.95 ? "CRITICAL_ONLY"
      : ratio >= 0.8 ? "CONSERVE" : ratio >= 0.6 ? "WATCH" : "NORMAL"
  return {
    contractVersion: "SELLER_OS_AI_BUDGET_POLICY_V1_2026_08_12",
    monthlyBudgetUsd,
    spendStatus: spend === null ? "UNPROVEN" as const : "AUTHORITATIVE" as const,
    authoritativeSpendUsd: spend,
    remainingBudgetUsd: spend === null ? null : Math.max(0,
      Math.round((monthlyBudgetUsd - spend) * 100) / 100),
    usagePercent: ratio === null ? null : Math.round(ratio * 10_000) / 100,
    state,
    enforcementStatus: spend === null
      ? "READY_REQUIRES_AUTHORITATIVE_GATEWAY_COST_FEED" as const
      : "ENFORCED_FROM_AUTHORITATIVE_SPEND" as const,
    hardStopScope: "NON_CRITICAL_AI_ONLY" as const,
    behavior: state === "NORMAL" ? "FULL_APPROVED_WORKLOADS"
      : state === "WATCH" ? "SUPPRESS_LOW_VALUE_OPTIONAL_REVIEWS"
        : state === "CONSERVE" ? "EFFICIENT_MODELS_AND_FEWER_SECONDARY_REVIEWS"
          : state === "CRITICAL_ONLY" ? "CRITICAL_REVIEWS_ONLY"
            : "DEFER_NON_CRITICAL_AI",
    deterministicSellerOsAvailable: true as const,
    nonCriticalAiDeferred: state === "CRITICAL_ONLY" || state === "BUDGET_EXHAUSTED",
    windowStart: input.windowStart ?? null,
    evaluatedAt: input.now ?? new Date().toISOString(),
  }
}

export type ModelClassV1 = "DETERMINISTIC" | "FAST_EFFICIENT" |
  "STANDARD_REASONING" | "STRONG_REASONING"

const FAST_WORKLOADS = new Set<SellerOsAiWorkload>([
  "seller_os.keyword_intelligence", "seller_os.product_family",
])
const STRONG_WORKLOADS = new Set<SellerOsAiWorkload>([
  "seller_os.system_coherence",
])

export function resolveModelPolicyV1(input: {
  workload: SellerOsAiWorkload
  budgetState: AiBudgetState
  impact?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  evidenceConflict?: boolean
  providerMode?: "VERCEL_AI_GATEWAY" | "OPENAI_DIRECT"
}) {
  const critical = input.impact === "CRITICAL"
  const deferred = ((input.budgetState === "CRITICAL_ONLY" ||
    input.budgetState === "BUDGET_EXHAUSTED") && !critical) ||
    (input.budgetState === "WATCH" && input.impact === "LOW")
  let modelClass: ModelClassV1 = deferred ? "DETERMINISTIC"
    : FAST_WORKLOADS.has(input.workload) ? "FAST_EFFICIENT"
      : STRONG_WORKLOADS.has(input.workload) ||
          (input.impact === "HIGH" && input.evidenceConflict)
        ? "STRONG_REASONING" : "STANDARD_REASONING"
  if (input.budgetState === "CONSERVE" && modelClass === "STANDARD_REASONING") {
    modelClass = "FAST_EFFICIENT"
  }
  const directModel = modelClass === "FAST_EFFICIENT" ? "gpt-5.6-luna"
    : modelClass === "STANDARD_REASONING" ? "gpt-5.6-terra"
      : modelClass === "STRONG_REASONING" ? "gpt-5.6-sol" : null
  return {
    contractVersion: "SELLER_OS_MODEL_POLICY_V1_2026_08_12",
    workload: input.workload,
    modelClass,
    model: directModel === null ? null : input.providerMode === "VERCEL_AI_GATEWAY"
      ? `openai/${directModel}` : directModel,
    reasoningEffort: modelClass === "STRONG_REASONING" ? "high" as const
      : modelClass === "STANDARD_REASONING" ? "medium" as const : "low" as const,
    aiCallAllowed: modelClass !== "DETERMINISTIC",
    imageGenerationAllowed: false as const,
    deterministicFallbackAvailable: true as const,
  }
}

export function evaluateHighImpactConsensusPolicyV1(input: {
  impact: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  evidenceConflict: boolean
  portfolioOrCapitalRisk: boolean
  changesSystemPolicy: boolean
  budgetState: AiBudgetState
}) {
  const material = ["HIGH", "CRITICAL"].includes(input.impact) &&
    (input.evidenceConflict || input.portfolioOrCapitalRisk || input.changesSystemPolicy)
  const budgetAllows = ["NORMAL", "WATCH"].includes(input.budgetState)
  return { enabled: material && budgetAllows, default: false as const,
    maximumIndependentReviews: material && budgetAllows ? 2 as const : 1 as const,
    requiresHumanDecision: true as const,
    reason: !material ? "HIGH_IMPACT_AND_MATERIAL_CONFLICT_REQUIRED"
      : !budgetAllows ? "AI_BUDGET_POLICY_SUPPRESSES_CONSENSUS"
        : "HIGH_IMPACT_CONSENSUS_ALLOWED" }
}

function opportunitySummary(row: CanonicalOpportunityResultV2) {
  return {
    itemId: row.sourceItemId,
    canonicalResultVersion: row.versions.canonicalResultVersion,
    canonicalFamily: row.canonicalFamily.canonicalFamily,
    canonicalFamilyConfidence: row.canonicalFamily.confidence,
    decision: row.commercialRecommendation.finalDecision,
    nextBestEvidence: row.nextBestEvidence,
    activeMarketAttractiveness: row.activeMarketAttractiveness.score,
    keywordOpportunity: row.keywordIntelligence.keywordOpportunity,
    priceAnomalies: row.priceOpportunity.PRICE_OUTLIER_LIST,
    referenceDecision: row.referenceStrategy.primaryReference?.referenceDecision ?? "UNPROVEN",
    supplierMatch: row.commercialRecommendation.supplierMatch,
    stock: row.commercialRecommendation.stock,
    economics: row.commercialRecommendation.economics,
    authoritative: true as const,
    legacyDiagnosticsMayOverride: false as const,
  }
}

function buildSystemReviewSourceParityV1(input: {
  monitor: CommercialMonitorGetDto
  canonicalOpportunityCount: number
}) {
  const readers = input.monitor.connection?.readers ?? []
  const reader = (source: string) => readers.find((row) =>
    row.source === source) ?? null
  const accountReader = reader("SELLER_ACCOUNT_SCOPE")
  const activeListings = input.monitor.backend.kpis.activeListings
  const accountConfigured = accountReader
    ? accountReader.status === "AVAILABLE"
    : input.monitor.liveCertification?.account.bindingConfigured === true ||
      (activeListings.status === "AVAILABLE" &&
        typeof activeListings.value === "number")
  const runtimeGap = !accountConfigured
  const source = (
    status: SellerOsSourceParityV1["status"],
    classification: SellerOsSourceGapClassificationV1 | null,
    sourceName: string,
    limitationCode: string | null,
    zeroIsAuthoritative = false,
  ): SellerOsSourceParityV1 => Object.freeze({ status, classification,
    source: sourceName, limitationCode, zeroIsAuthoritative })
  const unavailableAfterAccount = (
    sourceName: string,
    sourceReader: ReturnType<typeof reader>,
    fallbackLimitation: string,
  ) => runtimeGap
    ? source("UNAVAILABLE", "RUNTIME_CONFIGURATION_GAP", sourceName,
        accountReader?.limitationCode ?? "ACCOUNT_SCOPE_NOT_CONFIGURED")
    : source("UNAVAILABLE",
        sourceReader?.status === "ERROR"
          ? "REAL_EXTERNAL_BLOCKER"
          : "SOURCE_NOT_AVAILABLE",
        sourceName,
        sourceReader?.limitationCode ?? fallbackLimitation)

  const portfolioReader = reader("EBAY_TRADING_GET_MY_EBAY_SELLING")
  const portfolio = activeListings.status === "AVAILABLE" &&
      typeof activeListings.value === "number"
    ? source("AVAILABLE", null, "EBAY_TRADING_GET_MY_EBAY_SELLING",
        null, true)
    : unavailableAfterAccount("EBAY_TRADING_GET_MY_EBAY_SELLING",
        portfolioReader, "LIVE_PORTFOLIO_UNPROVEN")

  const registryCapability = input.monitor.backend.capabilities.registry
  const registryReader = reader("EBAY_ACTIVE_LISTING_REGISTRY")
  const registry = ["COMPLETE", "PARTIAL_CERTIFIED", "AVAILABLE", "PARTIAL"]
    .includes(registryCapability.status)
    ? source(registryCapability.status === "COMPLETE" ||
        registryCapability.status === "AVAILABLE" ? "AVAILABLE" : "PARTIAL",
      null, "EBAY_ACTIVE_LISTING_REGISTRY",
      registryCapability.limitationCodes[0] ?? registryReader?.limitationCode ?? null,
      true)
    : unavailableAfterAccount("EBAY_ACTIVE_LISTING_REGISTRY", registryReader,
        registryCapability.limitationCodes[0] ?? "REGISTRY_EVIDENCE_UNPROVEN")

  const trafficReader = reader("EBAY_SELL_ANALYTICS_TRAFFIC_REPORT")
  const trafficKpis = [input.monitor.backend.kpis.impressions,
    input.monitor.backend.kpis.ebayViews,
    input.monitor.backend.kpis.averageCtr,
    input.monitor.backend.kpis.quantitySold]
  const trafficAvailable = trafficKpis.some((metric) =>
    (metric.status === "AVAILABLE" || metric.status === "PARTIAL") &&
    typeof metric.value === "number")
  const traffic = trafficAvailable
    ? source(trafficKpis.every((metric) => metric.status === "AVAILABLE")
        ? "AVAILABLE" : "PARTIAL", null,
      "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT", trafficReader?.limitationCode ?? null,
      true)
    : unavailableAfterAccount("EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
        trafficReader, "TRAFFIC_KPI_EVIDENCE_UNPROVEN")

  const decisions = portfolio.status === "AVAILABLE" || portfolio.status === "PARTIAL"
    ? source(portfolio.status, null,
      "COMMERCIAL_MONITOR_CANONICAL_DECISIONS_V2", null, true)
    : source("UNAVAILABLE", portfolio.classification,
      "COMMERCIAL_MONITOR_CANONICAL_DECISIONS_V2",
      portfolio.limitationCode, false)

  const opportunity = input.canonicalOpportunityCount > 0
    ? source("AVAILABLE", null, "CANONICAL_OPPORTUNITY_RESULT_V2", null, true)
    : source("UNAVAILABLE", "PERSISTENCE_NOT_IMPLEMENTED",
      "CANONICAL_OPPORTUNITY_RESULT_V2",
      "UNPROVEN_NO_DURABLE_CANONICAL_RESULT_STORE", false)

  const experimentReader = reader("EBAY_EXPERIMENT_REGISTRY_V1")
  const experimentReadProven = experimentReader?.status === "AVAILABLE" ||
    experimentReader?.status === "PARTIAL" ||
    input.monitor.backend.operationalHealth.runningExperiments.status === "AVAILABLE"
  const experiments = experimentReadProven
    ? source(experimentReader?.status === "PARTIAL" ? "PARTIAL" : "AVAILABLE",
      null, "EBAY_EXPERIMENT_REGISTRY_V1",
      experimentReader?.limitationCode ?? null, true)
    : unavailableAfterAccount("EBAY_EXPERIMENT_REGISTRY_V1", experimentReader,
        "EXPERIMENT_REGISTRY_EVIDENCE_UNPROVEN")

  const supplyReader = reader("LUNA_PORTEX_MARKET_RADAR")
  const stock = portfolio.status === "AVAILABLE" || portfolio.status === "PARTIAL"
    ? source(supplyReader?.status === "ERROR" ? "PARTIAL" : portfolio.status,
      supplyReader?.status === "ERROR" ? "SOURCE_NOT_AVAILABLE" : null,
      "STOCK_GUARD_CANONICAL_LISTING_EVIDENCE",
      supplyReader?.limitationCode ?? null, true)
    : source("UNAVAILABLE", portfolio.classification,
      "STOCK_GUARD_CANONICAL_LISTING_EVIDENCE",
      portfolio.limitationCode, false)

  const learningReader = reader("EBAY_CATEGORY_LEARNING")
  const learning = runtimeGap
    ? source("UNAVAILABLE", "RUNTIME_CONFIGURATION_GAP",
      "EBAY_CATEGORY_LEARNING",
      accountReader?.limitationCode ?? "ACCOUNT_SCOPE_NOT_CONFIGURED")
    : input.monitor.learning.limitationCode === "NO_STORED_CATEGORY_LEARNING"
      ? source("UNAVAILABLE", "EXPECTED_UNAVAILABLE", "EBAY_CATEGORY_LEARNING",
        input.monitor.learning.limitationCode, true)
      : input.monitor.learning.status === "AVAILABLE" ||
          input.monitor.learning.status === "PARTIAL"
        ? source(input.monitor.learning.status, null, "EBAY_CATEGORY_LEARNING",
          input.monitor.learning.limitationCode, true)
        : source("UNAVAILABLE",
          learningReader?.status === "ERROR"
            ? "SOURCE_NOT_AVAILABLE" : "EXPECTED_UNAVAILABLE",
          "EBAY_CATEGORY_LEARNING",
          input.monitor.learning.limitationCode ??
            learningReader?.limitationCode ?? null,
          learningReader?.status === "AVAILABLE")

  const qualityStatus = input.monitor.backend.listingQualityReport.status
  const qualityReport = qualityStatus === "AVAILABLE" || qualityStatus === "PARTIAL"
    ? source(qualityStatus, null, "EBAY_LISTING_QUALITY_REPORT",
      input.monitor.backend.listingQualityReport.limitationCode, true)
    : source("UNAVAILABLE", "PERSISTENCE_NOT_IMPLEMENTED",
      "EBAY_LISTING_QUALITY_REPORT",
      input.monitor.backend.listingQualityReport.limitationCode ??
        "LISTING_QUALITY_REPORT_NOT_BOUND_TO_MONITOR", false)

  return Object.freeze({
    contractVersion: "SELLER_OS_SYSTEM_REVIEW_SOURCE_PARITY_V1_2026_08_12",
    accountScope: accountConfigured
      ? source("AVAILABLE", null, "SELLER_ACCOUNT_SCOPE", null, true)
      : source("UNAVAILABLE", "RUNTIME_CONFIGURATION_GAP",
        "SELLER_ACCOUNT_SCOPE",
        accountReader?.limitationCode ?? "ACCOUNT_SCOPE_NOT_CONFIGURED"),
    livePortfolio: portfolio,
    registry,
    trafficKpis: traffic,
    decisions,
    opportunities: opportunity,
    experiments,
    stock,
    learning,
    qualityReport,
  })
}

export function buildStrategicReviewQueueV1(input: {
  monitor: CommercialMonitorGetDto
  canonicalOpportunities?: Record<string, CanonicalOpportunityResultV2>
  aiUsage?: AiUsageObservationV1[]
  maximumSignals?: number
  decisionQueue?: ReturnType<typeof buildProactiveExceptionQueueV1>
}) {
  const observedAt = input.monitor.generatedAt
  const canonical = Object.values(input.canonicalOpportunities ?? {})
  const integrity = resolveCrossModuleLivePortfolioIntegrityV1(input.monitor)
  const liveListings = currentLiveListingsForMonitorV1(input.monitor)
  const liveItemIds = new Set(integrity.canonicalCohort.itemIds)
  const decisionQueue = input.decisionQueue ?? buildProactiveExceptionQueueV1({ monitor: input.monitor,
    canonicalOpportunities: canonical.map((row) => row.decisionIntegration),
    maximumEntries: 250 })
  const signals: StrategicSignalV1[] = []
  const add = (signal: Omit<StrategicSignalV1, "signalId" | "deterministic" | "observedAt">) => {
    const entityRefs = [...new Set(signal.entityRefs)].sort().slice(0, 25)
    const evidenceRefs = [...new Set(signal.evidenceRefs)].sort().slice(0, 25)
    signals.push({ ...signal, entityRefs, evidenceRefs,
      signalId: stableId("strategic-signal-v1", [signal.signalType, signal.module,
        entityRefs, evidenceRefs]), observedAt, deterministic: true })
  }
  for (const invariant of integrity.findings) {
    const materiality = invariant.severity === "CRITICAL" ? 100
      : invariant.severity === "HIGH" ? 92
        : invariant.severity === "MEDIUM" ? 72 : 45
    add({
      signalType: invariant.invariantCode,
      severity: invariant.severity,
      module: invariant.module,
      entityRefs: invariant.entityRefs,
      evidenceRefs: invariant.evidenceRefs,
      evidenceCount: Math.max(1, invariant.observedNumerator ??
        invariant.entityRefs.length),
      summary: `${invariant.invariantCode.replaceAll("_", " ")} · ${invariant.blockingImpact.replaceAll("_", " ")}`,
      nextAction: invariant.recommendedAction,
      confidence: "HIGH",
      materiality,
    })
  }
  const capability = decisionQueue.filter((row) => row.classification === "CAPABILITY_BLOCKED")
  const capabilityAffected = capability.reduce((sum, row) => {
    const evidence = row.observedEvidence && typeof row.observedEvidence === "object"
      ? row.observedEvidence as Record<string, unknown> : {}
    return sum + (typeof evidence.affectedListingCount === "number"
      ? evidence.affectedListingCount : 1)
  }, 0)
  const capabilityEntityRefs = capability.flatMap((row) => {
    const evidence = row.observedEvidence && typeof row.observedEvidence === "object"
      ? row.observedEvidence as Record<string, unknown> : {}
    return Array.isArray(evidence.affectedItemIdSample)
      ? evidence.affectedItemIdSample.map(String) : []
  })
  if (capability.length) add({ signalType: "CAPABILITY_BLOCKER", severity: "MEDIUM",
    module: "DECISIONS", entityRefs: capabilityEntityRefs,
    evidenceRefs: capability.map((row) => row.dedupeIdentity), evidenceCount: capabilityAffected,
    summary: `${capability.length} grouped capability blocker(s) limit current evidence.`,
    nextAction: "RESTORE_HIGHEST_IMPACT_EVIDENCE_CAPABILITY", confidence: "HIGH",
    materiality: Math.min(85, 45 + capability.length * 4) })
  const stale = liveListings.filter((row) =>
    row.stock.freshness.status === "STALE")
  if (stale.length && (stale.length >= 3 || stale.length / Math.max(1,
    integrity.canonicalCohort.listingCount) >= 0.2)) add({ signalType: "STALE_EVIDENCE_SPIKE",
    severity: "HIGH", module: "STOCK_GUARD", entityRefs: stale.map((row) => row.identity.itemId),
    evidenceRefs: stale.map((row) => `${row.identity.itemId}:STALE`), evidenceCount: stale.length,
    summary: `${stale.length} listing(s) have stale supplier evidence.`,
    nextAction: "PRIORITIZE_BOUNDED_SUPPLIER_RECAPTURE", confidence: "HIGH", materiality: 88 })
  const supplierRisk = decisionQueue.filter((row) => row.classification === "CRITICAL_OPERATIONAL" &&
    row.reasonCodes.some((reason) => /STOCK|SUPPLIER|OVERSELL/.test(reason)))
  if (supplierRisk.length) add({ signalType: "SUPPLIER_RISK", severity: "CRITICAL",
    module: "STOCK_GUARD", entityRefs: supplierRisk.map((row) => row.entityKey),
    evidenceRefs: supplierRisk.map((row) => row.dedupeIdentity), evidenceCount: supplierRisk.length,
    summary: `${supplierRisk.length} proven supplier or stock critical issue(s).`,
    nextAction: "REVIEW_CRITICAL_STOCK_EXCEPTION_DRY_RUN", confidence: "HIGH", materiality: 100 })
  const readyExperiments = input.monitor.backend.decisions.filter((row) =>
    row.experimentOperationalState === "READY_TO_EVALUATE")
  if (readyExperiments.length) add({ signalType: "EXPERIMENT_READY", severity: "HIGH",
    module: "EXPERIMENT_GUARDIAN", entityRefs: readyExperiments.map((row) => row.listingKey),
    evidenceRefs: readyExperiments.map((row) => `${row.listingKey}:READY_TO_EVALUATE`),
    evidenceCount: readyExperiments.length,
    summary: `${readyExperiments.length} experiment(s) are ready for evidence-backed evaluation.`,
    nextAction: "EVALUATE_WITHOUT_CHANGING_FROZEN_VARIABLES", confidence: "HIGH", materiality: 86 })
  const liveManualReview = decisionQueue.filter((row) =>
    row.classification === "HUMAN_REVIEW" &&
    row.entityType === "EBAY_LIVE_LISTING" && liveItemIds.has(row.entityKey))
  const manualCount = new Set(liveManualReview.map((row) => row.entityKey)).size
  const manualRate = roundedRatio(manualCount,
    integrity.canonicalCohort.listingCount)
  if (manualCount >= 5 && (manualRate ?? 0) >= 20) add({ signalType: "HIGH_MANUAL_REVIEW_RATE",
    severity: "MEDIUM", module: "DECISIONS",
    entityRefs: liveManualReview.map((row) => row.entityKey),
    evidenceRefs: [`${integrity.canonicalCohort.scopeId}:human-review-rate:${manualRate}`],
    evidenceCount: manualCount,
    summary: `${manualRate}% of canonical current-live Item IDs require human review.`,
    nextAction: "IDENTIFY_REPEATABLE_LOW_RISK_RESOLUTION_PATTERNS", confidence: "HIGH",
    materiality: 72 })
  const nonProvenActionable = decisionQueue.filter((row) =>
    row.classification === "ACTIONABLE_COMMERCIAL" && row.confidence === "UNPROVEN")
  if (nonProvenActionable.length) add({ signalType: "FALSE_INTERVENTION_SPIKE",
    severity: "HIGH", module: "DECISIONS", entityRefs: nonProvenActionable.map((row) => row.entityKey),
    evidenceRefs: nonProvenActionable.map((row) => row.dedupeIdentity),
    evidenceCount: nonProvenActionable.length,
    summary: `${nonProvenActionable.length} actionable classification(s) lack proven evidence.`,
    nextAction: "REVIEW_DECISION_TAXONOMY_GATES", confidence: "HIGH", materiality: 94 })
  for (const row of canonical) {
    if ((row.activeMarketAttractiveness.score ?? 0) >= 75) add({
      signalType: "OPPORTUNITY_STRENGTHENING", severity: "MEDIUM",
      module: "OPPORTUNITY_V2", entityRefs: row.sourceItemId ? [row.sourceItemId] : [],
      evidenceRefs: [row.versions.canonicalResultVersion,
        `${row.decisionIntegration.contractVersion}:${row.decisionIntegration.entityKey}`],
      evidenceCount: 1, summary: `${row.canonicalFamily.canonicalFamily} has material active-market evidence.`,
      nextAction: row.nextBestEvidence.priority ?? "REVIEW_CANONICAL_OPPORTUNITY_EVIDENCE",
      confidence: row.canonicalFamily.confidence >= 80 ? "HIGH" : "MEDIUM",
      materiality: Math.min(95, Math.round(row.activeMarketAttractiveness.score ?? 75)) })
    if (row.keywordIntelligence.rejectedTerms.length >= 5) add({
      signalType: "KEYWORD_QUALITY_ANOMALY", severity: "LOW", module: "KEYWORD_INTELLIGENCE_V2",
      entityRefs: row.sourceItemId ? [row.sourceItemId] : [],
      evidenceRefs: row.keywordIntelligence.rejectedTerms.slice(0, 10).map((term) =>
        `${term.phrase}:${term.rejectionReason}`), evidenceCount: row.keywordIntelligence.rejectedTerms.length,
      summary: "Keyword evidence contains a material rejected-term cluster.",
      nextAction: "REVIEW_REJECTION_PATTERN_FOR_DETERMINISTIC_RULE", confidence: "HIGH", materiality: 48 })
    if (row.priceOpportunity.PRICE_OUTLIER_LIST.length) add({
      signalType: "PRICE_DISTRIBUTION_ANOMALY", severity: "LOW", module: "PRICE_OPPORTUNITY_V2",
      entityRefs: row.sourceItemId ? [row.sourceItemId] : [],
      evidenceRefs: row.priceOpportunity.PRICE_OUTLIER_LIST.map((outlier) => outlier.evidenceId),
      evidenceCount: row.priceOpportunity.PRICE_OUTLIER_LIST.length,
      summary: "Physically comparable evidence includes possible price outliers.",
      nextAction: "PRESERVE_COMPARABILITY_AND_REVIEW_PRICE_REPRESENTATIVENESS",
      confidence: "MEDIUM", materiality: 45 })
  }
  const usage = input.aiUsage ?? []
  const authoritativeCost = usage.filter((row) => row.costEvidence === "AUTHORITATIVE" &&
    row.actualCostUsd !== null).reduce((sum, row) => sum + row.actualCostUsd!, 0)
  if (authoritativeCost >= SELLER_OS_AI_MONTHLY_BUDGET_USD * 0.8) add({
    signalType: "AI_COST_ANOMALY",
    severity: authoritativeCost >= SELLER_OS_AI_MONTHLY_BUDGET_USD ? "HIGH" : "MEDIUM",
    module: "AI_RUNTIME", entityRefs: [],
    evidenceRefs: usage.filter((row) => row.costEvidence === "AUTHORITATIVE").map((row) =>
      `${row.workload}:${row.observedAt}`), evidenceCount: usage.length,
    summary: "Authoritative AI cost reached the budget watch threshold.",
    nextAction: "APPLY_AI_BUDGET_CONSERVATION_POLICY", confidence: "HIGH", materiality: 90 })
  if (usage.some((row) => row.fallbackUsed === true)) add({ signalType: "MODEL_FALLBACK_SPIKE",
    severity: "MEDIUM", module: "AI_RUNTIME", entityRefs: [],
    evidenceRefs: usage.filter((row) => row.fallbackUsed).map((row) =>
      `${row.workload}:${row.observedAt}`), evidenceCount: usage.filter((row) => row.fallbackUsed).length,
    summary: "One or more observed AI requests used a fallback model/provider.",
    nextAction: "REVIEW_MODEL_AND_PROVIDER_HEALTH", confidence: "HIGH", materiality: 60 })
  const maximum = Math.min(SELLER_OS_AI_MAX_MODEL_SIGNALS,
    Math.max(1, input.maximumSignals ?? SELLER_OS_AI_MAX_MODEL_SIGNALS))
  const deduped = [...new Map(signals.map((row) => [row.signalId, row])).values()]
    .sort((left, right) => right.materiality - left.materiality ||
      left.signalId.localeCompare(right.signalId)).slice(0, maximum)
  return { contractVersion: STRATEGIC_REVIEW_QUEUE_VERSION, observedAt,
    entries: deduped, totalMaterialSignals: deduped.length,
    deterministicEvidenceOnly: true as const, generatedByModel: false as const,
    dedupeApplied: true as const, bounded: true as const, maximumSignals: maximum,
    marketplaceWrites: 0 as const }
}

export function detectAutomationCandidatesV1(input: {
  signals: StrategicSignalV1[]
  minimumRepeatedEvidence?: number
}) {
  const threshold = Math.max(3, input.minimumRepeatedEvidence ?? 3)
  const candidates = input.signals.filter((signal) => signal.evidenceCount >= threshold &&
    ["HIGH_MANUAL_REVIEW_RATE", "DUPLICATE_EXCEPTION_SPIKE", "STALE_EVIDENCE_SPIKE",
      "CAPABILITY_BLOCKER", "KEYWORD_QUALITY_ANOMALY", "DUPLICATE_ITEM_ID",
      "DUPLICATE_LIVE_SKU", "NON_LIVE_ENTITY_IN_LIVE_DENOMINATOR",
      "COUNT_PARITY_FAILURE", "FALSE_ZERO_FROM_UNPROVEN_CAPABILITY"].includes(
      signal.signalType))
    .map((signal) => ({
      candidateId: stableId("automation-candidate-v1", [signal.signalId, signal.nextAction]),
      manualOperation: signal.nextAction,
      frequency: signal.evidenceCount,
      evidenceCount: signal.evidenceCount,
      evidenceRefs: signal.evidenceRefs,
      deterministicPattern: signal.summary,
      riskClass: signal.severity === "CRITICAL" ? "HIGH" as const
        : signal.severity === "HIGH" ? "MEDIUM" as const : "LOW" as const,
      proposedAutomationBoundary: "DETECTION_ANALYSIS_PRIORITIZATION_OR_PREPARATION_ONLY" as const,
      requiredHumanGate: "HUMAN_APPROVAL_BEFORE_ENABLEMENT" as const,
      autoEnableAllowed: false as const,
    }))
  return { contractVersion: "AUTOMATION_CANDIDATE_DETECTION_V1_2026_08_12",
    entries: cap(candidates, 20), repeatedEvidenceRequired: threshold,
    deterministicEvidenceOnly: true as const, autoEnableAllowed: false as const }
}

export function buildSystemReviewBundleV1(input: {
  monitor: CommercialMonitorGetDto
  canonicalOpportunities?: Record<string, CanonicalOpportunityResultV2>
  aiUsage?: AiUsageObservationV1[]
  recentSystemChanges?: Array<{ changeId: string; summary: string; observedAt: string }>
  monthlyBudgetUsd?: number
  authoritativeSpendUsd?: number | null
}) {
  const canonical = Object.values(input.canonicalOpportunities ?? {})
  const integrity = resolveCrossModuleLivePortfolioIntegrityV1(input.monitor)
  const liveListings = currentLiveListingsForMonitorV1(input.monitor)
  const liveItemIds = new Set(integrity.canonicalCohort.itemIds)
  const decisionQueue = buildProactiveExceptionQueueV1({ monitor: input.monitor,
    canonicalOpportunities: canonical.map((row) => row.decisionIntegration),
    maximumEntries: 250 })
  const strategicQueue = buildStrategicReviewQueueV1({ ...input, decisionQueue })
  const automationCandidates = detectAutomationCandidatesV1({ signals: strategicQueue.entries })
  const aiBudget = evaluateAiBudgetPolicyV1({ monthlyBudgetUsd: input.monthlyBudgetUsd,
    authoritativeSpendUsd: input.authoritativeSpendUsd, now: input.monitor.generatedAt })
  const staleCount = liveListings.filter((row) =>
    row.stock.freshness.status === "STALE").length
  const exactSupplierLinked = liveListings.filter((row) =>
    row.stock.supplierProductId && row.stock.supplierVariantId && row.stock.supplierSku).length
  const dataParity = buildSystemReviewSourceParityV1({ monitor: input.monitor,
    canonicalOpportunityCount: canonical.length })
  const portfolioCountsProven = dataParity.livePortfolio.zeroIsAuthoritative
  const grouped = (classification: typeof decisionQueue[number]["classification"]) =>
    cap(decisionQueue.filter((row) => row.classification === classification), 10)
  const experiments = input.monitor.backend.decisions.filter((row) =>
    row.experimentOperationalState !== "INACTIVE")
  const usage = cap(input.aiUsage ?? [], 20)
  const actualCosts = usage.filter((row) => row.costEvidence === "AUTHORITATIVE" &&
    row.actualCostUsd !== null).map((row) => row.actualCostUsd!)
  const portfolioState = buildPortfolioIntelligenceV1({ monitor: input.monitor })
  const liveHumanReviewIds = new Set(decisionQueue.filter((row) =>
    row.classification === "HUMAN_REVIEW" &&
    row.entityType === "EBAY_LIVE_LISTING" && liveItemIds.has(row.entityKey))
    .map((row) => row.entityKey))
  const evidenceEntityHumanReviewCount = input.monitor.listings.filter((row) =>
    liveHumanReviewIds.has(row.identity.itemId)).length
  const registry = input.monitor.backend.capabilities.registry
  const registryReviewNumerator = registry.humanReviewCount
  const registryReviewDenominator = registry.currentLiveCount
  const registryReviewRateProven = typeof registryReviewNumerator === "number" &&
    typeof registryReviewDenominator === "number"
  const provenStockRiskCount = decisionQueue.filter((row) =>
    row.entityType === "EBAY_LIVE_LISTING" && liveItemIds.has(row.entityKey) &&
    row.classification === "CRITICAL_OPERATIONAL" &&
    row.reasonCodes.some((reason) => /STOCK|OVERSELL/.test(reason))).length
  const stockUnknownCount = liveListings.filter((row) =>
    row.stock.state === "STOCK_UNKNOWN").length
  return {
    contractVersion: SYSTEM_REVIEW_BUNDLE_VERSION,
    generatedAt: input.monitor.generatedAt,
    evidenceSource: input.monitor.contractVersion,
    portfolio: {
      state: portfolioState,
      kpis: input.monitor.backend.kpis,
      liveListingCount: portfolioCountsProven
        ? integrity.canonicalCohort.listingCount : null,
    },
    dataParity,
    crossModuleIntegrity: {
      contractVersion: integrity.contractVersion,
      canonicalCohort: {
        ...integrity.canonicalCohort,
        itemIds: cap(integrity.canonicalCohort.itemIds, 25),
        itemIdSampleTruncated: integrity.canonicalCohort.itemIds.length > 25,
      },
      stockCohort: {
        ...integrity.stockCohort,
        nonLiveItemIds: cap(integrity.stockCohort.nonLiveItemIds, 25),
        duplicateItemIds: cap(integrity.stockCohort.duplicateItemIds, 25),
        missingCurrentLiveItemIds: cap(
          integrity.stockCohort.missingCurrentLiveItemIds, 25),
      },
      liveSkuUniqueness: {
        ...integrity.liveSkuUniqueness,
        collisions: cap(integrity.liveSkuUniqueness.collisions, 20),
      },
      findings: cap(integrity.findings, 20),
      denominatorPolicy: integrity.denominatorPolicy,
      readOnly: true as const,
    },
    trafficScopeIntegrity: {
      accountTraffic: {
        scopeType: input.monitor.backend.trafficScopes.accountTraffic.scopeType,
        observedAt: input.monitor.backend.trafficScopes.accountTraffic.observedAt,
        freshnessSourceUpdatedAt:
          input.monitor.backend.trafficScopes.accountTraffic.sourceUpdatedAt,
        upstreamSnapshotAcquisitionCount:
          input.monitor.backend.trafficScopes.accountTraffic
            .upstreamSnapshotAcquisitionCount,
      },
      currentLive: {
        scopeId: integrity.canonicalCohort.scopeId,
        scopeType: integrity.canonicalCohort.scopeType,
        scopeCount: integrity.canonicalCohort.listingCount,
        scopeObservedAt: integrity.canonicalCohort.observedAt,
      },
      scopesAreNumericallyIndependent: true as const,
    },
    registryIntegrity: {
      status: registry.status,
      currentLiveCount: registry.currentLiveCount,
      matchedCount: registry.matchedCount,
      humanReviewCount: registry.humanReviewCount,
      coveragePercent: registry.coveragePercent,
      reviewReasonCodes: cap(registry.limitationCodes, 20),
      unresolvedRelationshipItemIds: null,
      unresolvedRelationshipMappingStatus: "UNPROVEN" as const,
      businessDataMutations: 0 as const,
    },
    decisions: {
      todaysCommercialPriorities: cap(selectMaterialPrioritiesV2(decisionQueue, 10), 10),
      criticalOperational: grouped("CRITICAL_OPERATIONAL"),
      actionableCommercial: grouped("ACTIONABLE_COMMERCIAL"),
      researchOrEvidence: grouped("RESEARCH_OR_EVIDENCE"),
      capabilityBlockers: grouped("CAPABILITY_BLOCKED"),
      humanReview: grouped("HUMAN_REVIEW"),
      doNotTouch: grouped("DO_NOT_TOUCH"),
      replacementCandidates: grouped("REPLACEMENT_CANDIDATE"),
      waitOrHealthy: cap([...grouped("WAIT"), ...grouped("HEALTHY")], 10),
    },
    canonicalOpportunities: cap(canonical.map(opportunitySummary), 10),
    opportunityPersistence: canonical.length ? "BOUNDED_CANONICAL_V2_RESULTS_AVAILABLE"
      : "UNPROVEN_NO_DURABLE_CANONICAL_RESULT_STORE",
    experiments: {
      active: cap(experiments.filter((row) => row.experimentRunning), 10),
      readyToEvaluate: cap(experiments.filter((row) =>
        row.experimentOperationalState === "READY_TO_EVALUATE"), 10),
      hardOverrides: cap(experiments.filter((row) =>
        row.reasonCodes.includes("HARD_OVERRIDE_REQUIRES_HUMAN_REVIEW")), 10),
      authoritative: dataParity.experiments.zeroIsAuthoritative,
      sourceStatus: dataParity.experiments,
    },
    supplierAndStock: {
      exactSupplierLinked: portfolioCountsProven ? exactSupplierLinked : null,
      totalListings: portfolioCountsProven
        ? integrity.canonicalCohort.listingCount : null,
      liveWithoutProvenSupplierLink: portfolioCountsProven
        ? integrity.canonicalCohort.listingCount - exactSupplierLinked : null,
      provenSupplierLinkCoverage: {
        status: portfolioCountsProven ? "AVAILABLE" as const : "UNPROVEN" as const,
        numerator: portfolioCountsProven ? exactSupplierLinked : null,
        denominator: portfolioCountsProven
          ? integrity.canonicalCohort.listingCount : null,
        scopeId: integrity.canonicalCohort.scopeId,
      },
      stockRisks: portfolioCountsProven ? provenStockRiskCount : null,
      stockRiskStatus: portfolioCountsProven ? "AVAILABLE" as const : "UNPROVEN" as const,
      stockRiskSemantics: "PROVEN_STOCK_RISKS_ONLY" as const,
      staleEvidence: portfolioCountsProven ? staleCount : null,
      stockUnknown: portfolioCountsProven ? stockUnknownCount : null,
      stockUnknownIsRisk: false as const,
      stockSafeInferenceAllowed: false as const,
      watcherSessionHealth: "UNPROVEN" as const,
      sourceStatus: dataParity.stock,
    },
    qualityReport: {
      status: input.monitor.backend.listingQualityReport.status,
      limitationCode: input.monitor.backend.listingQualityReport.limitationCode,
      recommendationCount: dataParity.qualityReport.zeroIsAuthoritative
        ? input.monitor.backend.listingQualityReport.recommendations.length : null,
    },
    commercialAnomalies: {
      keyword: strategicQueue.entries.filter((row) =>
        row.signalType === "KEYWORD_QUALITY_ANOMALY"),
      priceDistribution: strategicQueue.entries.filter((row) =>
        row.signalType === "PRICE_DISTRIBUTION_ANOMALY"),
      referenceCandidates: cap(canonical.flatMap((row) =>
        row.referenceStrategy.primaryReference ? [row.referenceStrategy.primaryReference] : []), 10),
      referenceCandidateStatus: dataParity.opportunities.zeroIsAuthoritative
        ? "AVAILABLE" as const : "UNPROVEN" as const,
      referenceCandidateCount: dataParity.opportunities.zeroIsAuthoritative
        ? canonical.filter((row) => row.referenceStrategy.primaryReference).length
        : null,
      sellOneLikeThisReady: dataParity.opportunities.zeroIsAuthoritative
        ? canonical.filter((row) =>
          row.commercialRecommendation.useAsReference === "USE_AS_REFERENCE").length
        : null,
    },
    economicsCompleteness: {
      proven: canonical.length
        ? canonical.filter((row) =>
          row.commercialRecommendation.economics !== "UNPROVEN").length
        : null,
      unproven: canonical.length
        ? canonical.filter((row) =>
          row.commercialRecommendation.economics === "UNPROVEN").length
        : null,
      status: canonical.length ? "BOUNDED_CANONICAL_RESULTS" : "UNPROVEN",
    },
    learning: {
      status: input.monitor.learning.status,
      storedLearningCount: dataParity.learning.zeroIsAuthoritative
        ? input.monitor.learning.categoryAdjustments.length : null,
      limitationCode: input.monitor.learning.limitationCode,
      syntheticLearning: false as const,
      universalRuleAllowed: false as const,
    },
    automationHealth: buildAutomationHealthMetricsV1(portfolioCountsProven
      ? { staleEntityCount: staleCount,
        totalEntityCount: integrity.canonicalCohort.listingCount }
      : {}),
    operationalBurden: {
      manualReviewCount: portfolioCountsProven ? liveHumanReviewIds.size : null,
      manualReviewRate: portfolioCountsProven
        ? roundedRatio(liveHumanReviewIds.size,
          integrity.canonicalCohort.listingCount) : null,
      liveListingHumanReviewRate: {
        status: portfolioCountsProven ? "AVAILABLE" as const : "UNPROVEN" as const,
        numerator: portfolioCountsProven ? liveHumanReviewIds.size : null,
        denominator: portfolioCountsProven
          ? integrity.canonicalCohort.listingCount : null,
        rate: portfolioCountsProven ? roundedRatio(liveHumanReviewIds.size,
          integrity.canonicalCohort.listingCount) : null,
        scopeType: integrity.canonicalCohort.scopeType,
        scopeCount: integrity.canonicalCohort.listingCount,
        scopeObservedAt: integrity.canonicalCohort.observedAt,
      },
      evidenceEntityReviewRate: {
        status: input.monitor.listings.length ? "AVAILABLE" as const : "UNPROVEN" as const,
        numerator: input.monitor.listings.length
          ? evidenceEntityHumanReviewCount : null,
        denominator: input.monitor.listings.length || null,
        rate: input.monitor.listings.length
          ? roundedRatio(evidenceEntityHumanReviewCount,
            input.monitor.listings.length) : null,
        scopeType: "EVIDENCE_ENTITY_SCOPE" as const,
        scopeCount: input.monitor.listings.length,
        scopeObservedAt: input.monitor.generatedAt,
        registryPartitionsIncluded: false as const,
      },
      registryPartitionReviewRate: {
        status: registryReviewRateProven
          ? "AVAILABLE" as const : "UNPROVEN" as const,
        numerator: registryReviewRateProven ? registryReviewNumerator : null,
        denominator: registryReviewRateProven ? registryReviewDenominator : null,
        rate: registryReviewRateProven
          ? roundedRatio(registryReviewNumerator, registryReviewDenominator) : null,
        scopeType: "REGISTRY_PARTITION_SCOPE" as const,
        scopeCount: registryReviewRateProven ? registryReviewDenominator : null,
        scopeObservedAt: input.monitor.generatedAt,
      },
      falseInterventionCount: decisionQueue.filter((row) =>
        row.classification === "ACTIONABLE_COMMERCIAL" && row.confidence === "UNPROVEN").length,
      duplicateExceptionCount: decisionQueue.length -
        new Set(decisionQueue.map((row) => row.dedupeIdentity)).size,
    },
    strategicReviewQueue: strategicQueue,
    automationCandidates,
    aiOperationalStatus: {
      budget: aiBudget,
      requestCount: usage.reduce((sum, row) => sum + row.requestCount, 0),
      usageByWorkload: usage,
      actualCostUsd: actualCosts.length === usage.length && usage.length
        ? Math.round(actualCosts.reduce((sum, value) => sum + value, 0) * 1_000_000) / 1_000_000
        : null,
      costStatus: actualCosts.length === usage.length && usage.length ? "AUTHORITATIVE" : "UNPROVEN",
      costPerUsefulDecision: "NOT_CALCULATED_OUTCOME_HISTORY_REQUIRED" as const,
      costMetrics: {
        AI_COST_TOTAL: actualCosts.length === usage.length && usage.length
          ? "AUTHORITATIVE" as const : "UNPROVEN" as const,
        COST_PER_STRATEGIC_REVIEW: "UNPROVEN" as const,
        COST_PER_OPPORTUNITY_ANALYSIS: "UNPROVEN" as const,
        COST_PER_LISTING_ANALYSIS: "UNPROVEN" as const,
        COST_PER_USEFUL_RECOMMENDATION: "NOT_CALCULATED_OUTCOME_HISTORY_REQUIRED" as const,
        COST_PER_COMMERCIAL_DECISION: "NOT_CALCULATED_OUTCOME_HISTORY_REQUIRED" as const,
      },
      imageGenerationEnabled: false as const,
    },
    recentSystemChanges: cap(input.recentSystemChanges ?? [], 10),
    recentSystemChangesStatus: input.recentSystemChanges?.length
      ? "AVAILABLE" as const : "UNPROVEN_NO_DURABLE_CHANGE_LEDGER" as const,
    bounds: {
      aggregateFirst: true as const,
      maximumEntitiesPerSection: 10,
      maximumStrategicSignals: SELLER_OS_AI_MAX_MODEL_SIGNALS,
      maximumContextCharacters: SELLER_OS_AI_MAX_CONTEXT_CHARACTERS,
      fullPortfolioModelDump: false as const,
      oneAiCallPerListing: false as const,
    },
    safety: {
      mode: "READ_ONLY" as const,
      buyerPiiIncluded: false as const,
      credentialsIncluded: false as const,
      arbitrarySqlAllowed: false as const,
      arbitraryUrlFetchAllowed: false as const,
      marketplaceWrites: 0 as const,
      inventoryWrites: 0 as const,
      registryBusinessDataMutations: 0 as const,
      productCaseMutations: 0 as const,
      lunaLinkMutations: 0 as const,
      whatsappSends: 0 as const,
    },
  }
}

export function prefilterStrategicReviewV1(input: {
  bundle: ReturnType<typeof buildSystemReviewBundleV1>
  previousMaterialFingerprint?: string | null
  forceCritical?: boolean
}) {
  const signals = input.bundle.strategicReviewQueue.entries
  const ranked = signals.filter((row) => row.materiality >= 40 || row.severity === "CRITICAL")
    .slice(0, SELLER_OS_AI_MAX_MODEL_SIGNALS)
  const fingerprint = stableId("strategic-material-v1", ranked.map((row) => ({
    signalId: row.signalId, severity: row.severity, evidenceCount: row.evidenceCount,
    evidenceRefs: row.evidenceRefs,
  })))
  const unchanged = Boolean(input.previousMaterialFingerprint) &&
    input.previousMaterialFingerprint === fingerprint
  const hasCritical = ranked.some((row) => row.severity === "CRITICAL")
  const budget = input.bundle.aiOperationalStatus.budget
  const aiAllowedByBudget = !["CRITICAL_ONLY", "BUDGET_EXHAUSTED"].includes(budget.state) ||
    hasCritical || input.forceCritical === true
  const summarizeDecision = (row: Record<string, unknown>) => ({
    entityKey: row.entityKey,
    classification: row.classification,
    priority: row.priority,
    severity: row.severity,
    confidence: row.confidence,
    reasonCodes: Array.isArray(row.reasonCodes) ? row.reasonCodes.slice(0, 8) : [],
    recommendedAction: row.recommendedAction,
    nextReviewCondition: row.nextReviewCondition,
    dedupeIdentity: row.dedupeIdentity,
  })
  const boundedPayload = {
    contractVersion: input.bundle.contractVersion,
    generatedAt: input.bundle.generatedAt,
    portfolio: input.bundle.portfolio,
    decisions: Object.fromEntries(Object.entries(input.bundle.decisions).map(([key, value]) =>
      [key, Array.isArray(value) ? value.slice(0, 10).map((row) =>
        summarizeDecision(row as Record<string, unknown>)) : value])),
    canonicalOpportunities: input.bundle.canonicalOpportunities,
    experiments: input.bundle.experiments,
    supplierAndStock: input.bundle.supplierAndStock,
    qualityReport: input.bundle.qualityReport,
    commercialAnomalies: input.bundle.commercialAnomalies,
    economicsCompleteness: input.bundle.economicsCompleteness,
    learning: input.bundle.learning,
    automationHealth: input.bundle.automationHealth,
    operationalBurden: input.bundle.operationalBurden,
    strategicSignals: ranked,
    automationCandidates: input.bundle.automationCandidates.entries,
    aiBudget: budget,
    recentSystemChanges: input.bundle.recentSystemChanges,
    safety: input.bundle.safety,
  }
  const serialized = JSON.stringify(boundedPayload)
  const payload = serialized.length <= SELLER_OS_AI_MAX_CONTEXT_CHARACTERS
    ? boundedPayload : { ...boundedPayload,
      portfolio: { liveListingCount: input.bundle.portfolio.liveListingCount },
      decisions: { todaysCommercialPriorities:
        input.bundle.decisions.todaysCommercialPriorities.slice(0, 5).map((row) =>
          summarizeDecision(row)) },
      canonicalOpportunities: input.bundle.canonicalOpportunities.slice(0, 5),
      experiments: { activeCount: input.bundle.experiments.active.length,
        readyToEvaluateCount: input.bundle.experiments.readyToEvaluate.length,
        hardOverrideCount: input.bundle.experiments.hardOverrides.length },
      commercialAnomalies: { keywordCount: input.bundle.commercialAnomalies.keyword.length,
        priceDistributionCount: input.bundle.commercialAnomalies.priceDistribution.length,
        referenceCandidateCount: input.bundle.commercialAnomalies.referenceCandidates.length,
        sellOneLikeThisReady: input.bundle.commercialAnomalies.sellOneLikeThisReady },
      strategicSignals: ranked.slice(0, 8), automationCandidates: [], recentSystemChanges: [] }
  const materialEvidence = ranked.length > 0
  return {
    contractVersion: "DETERMINISTIC_STRATEGIC_PREFILTER_V1_2026_08_12",
    shouldCallAi: materialEvidence && (!unchanged || hasCritical) && aiAllowedByBudget,
    reason: !materialEvidence ? "NO_MATERIAL_STRATEGIC_EVIDENCE"
      : unchanged && !hasCritical ? "UNCHANGED_MATERIAL_EVIDENCE"
        : !aiAllowedByBudget ? "AI_BUDGET_POLICY_DEFERRED"
          : "MATERIAL_STRATEGIC_EVIDENCE",
    materialFingerprint: fingerprint,
    unchanged,
    criticalOverride: hasCritical,
    candidateAiCalls: materialEvidence && (!unchanged || hasCritical) && aiAllowedByBudget ? 1 : 0,
    listingCount: input.bundle.portfolio.liveListingCount,
    signalsBeforePrefilter: signals.length,
    signalsAfterPrefilter: ranked.length,
    boundedPayload: payload,
    contextCharacters: JSON.stringify(payload).length,
    contextWithinLimit: JSON.stringify(payload).length <= SELLER_OS_AI_MAX_CONTEXT_CHARACTERS,
    maximumAiCalls: 1 as const,
    oneCallPerListing: false as const,
    deterministicSellerOsContinues: true as const,
  }
}

export function planEventDrivenStrategicReviewV1(input: {
  eventType: string
  entityRefs: string[]
  observedAt: string
  previousEventFingerprint?: string | null
  previousReviewedAt?: string | null
  cooldownMinutes?: number
}) {
  const eligible = new Set(["OUT_OF_STOCK_CONFIRMED", "OVERSELL_RISK", "EXPERIMENT_READY",
    "HARD_OVERRIDE", "OPPORTUNITY_STRENGTHENING", "DECISION_CONFLICT",
    "SYSTEM_COHERENCE_CONFLICT", "SUPPLIER_SESSION_FAILURE", "FALSE_INTERVENTION_SPIKE",
    "AI_COST_ANOMALY"])
  const fingerprint = stableId("strategic-event-v1", [input.eventType,
    [...new Set(input.entityRefs)].sort()])
  const cooldownMs = Math.max(5, input.cooldownMinutes ?? 60) * 60_000
  const recentlyReviewed = Number.isFinite(Date.parse(input.previousReviewedAt ?? "")) &&
    Date.parse(input.observedAt) - Date.parse(input.previousReviewedAt!) < cooldownMs
  const duplicate = input.previousEventFingerprint === fingerprint
  return { eligible: eligible.has(input.eventType), fingerprint,
    shouldQueueReview: eligible.has(input.eventType) && !duplicate && !recentlyReviewed,
    reason: !eligible.has(input.eventType) ? "TRIVIAL_OR_UNSUPPORTED_EVENT"
      : duplicate ? "DUPLICATE_EVENT" : recentlyReviewed ? "EVENT_COOLDOWN_ACTIVE"
        : "MATERIAL_EVENT_ELIGIBLE",
    cooldownMinutes: Math.max(5, input.cooldownMinutes ?? 60),
    maximumAiCalls: 1 as const, marketplaceWrites: 0 as const }
}

export function buildDailyStrategicReviewScheduleContractV1(input: {
  configuredSchedule?: string | null
  persistenceAuthorized?: boolean
  productionDeploymentAuthorized?: boolean
}) {
  const schedule = input.configuredSchedule?.trim() || null
  const activated = Boolean(schedule && input.persistenceAuthorized &&
    input.productionDeploymentAuthorized)
  return { contractVersion: "DAILY_STRATEGIC_REVIEW_SCHEDULER_V1_2026_08_12",
    status: activated ? "ACTIVATED" as const : "READY_BUT_NOT_ACTIVATED" as const,
    schedule, clockTimeInvented: false as const,
    requires: [
      ...(!schedule ? ["HUMAN_DEFINED_SCHEDULE_AND_TIMEZONE"] : []),
      ...(!input.persistenceAuthorized ? ["DURABLE_REVIEW_CHECKPOINT_AUTHORIZATION"] : []),
      ...(!input.productionDeploymentAuthorized ? ["PRODUCTION_SCHEDULER_ACTIVATION_AUTHORIZATION"] : []),
    ], deterministicPrefilterFirst: true as const, maximumAiCallsPerRun: 1 as const,
    productionDeploymentPerformed: false as const, remoteDdlExecuted: false as const }
}

export function buildDailyStrategicBriefFallbackV1(input: {
  bundle: ReturnType<typeof buildSystemReviewBundleV1>
}) {
  const queue = input.bundle.strategicReviewQueue.entries
  const section = (types: StrategicSignalType[]) => queue.filter((row) =>
    types.includes(row.signalType)).slice(0, 5)
  return { contractVersion: "DAILY_STRATEGIC_BRIEF_V1_2026_08_12",
    generatedAt: input.bundle.generatedAt, generatedBy: "DETERMINISTIC_FALLBACK" as const,
    sections: {
      todaysCommercialPriorities: input.bundle.decisions.todaysCommercialPriorities,
      criticalOperational: input.bundle.decisions.criticalOperational,
      opportunities: section(["OPPORTUNITY_STRENGTHENING", "OPPORTUNITY_WEAKENING"]),
      replacementCandidates: input.bundle.decisions.replacementCandidates,
      experiments: section(["EXPERIMENT_READY"]),
      supplierAndStock: section(["SUPPLIER_RISK", "STALE_EVIDENCE_SPIKE"]),
      evidenceBlockers: section(["CAPABILITY_BLOCKER"]),
      automationCandidates: input.bundle.automationCandidates.entries,
      systemImprovements: section(["DECISION_CONFLICT", "CANONICAL_TRUTH_CONFLICT",
        "FALSE_INTERVENTION_SPIKE", "KEYWORD_QUALITY_ANOMALY",
        "PRICE_DISTRIBUTION_ANOMALY", "AUTOMATION_FAILURE"]),
      aiCostAndBudget: input.bundle.aiOperationalStatus,
      noActionHealthy: input.bundle.decisions.waitOrHealthy,
    },
    evidenceBacked: true as const, modelClaimsAdded: false as const,
    doNotTouchIncluded: input.bundle.decisions.doNotTouch,
    marketplaceWrites: 0 as const }
}

export function buildLargeVolumeAiPolicyV1(listingCount: number) {
  const normalized = Math.max(0, Math.floor(listingCount))
  return { listingCount: normalized,
    architectureValidatedRange: normalized <= 5_000 ? "27_TO_5000_PLUS" : "5000_PLUS_REQUIRES_REVIEW",
    deterministicEntitiesProcessed: normalized,
    maximumSignalsToModel: SELLER_OS_AI_MAX_MODEL_SIGNALS,
    maximumModelCallsPerReview: 1 as const,
    maximumContextCharacters: SELLER_OS_AI_MAX_CONTEXT_CHARACTERS,
    aggregateFirst: true as const, topNThenDrilldown: true as const,
    cacheRequired: true as const, dedupeRequired: true as const,
    boundedConcurrencyRequired: true as const, checkpointsRequired: true as const,
    paginationRequired: true as const, incrementalReadsRequired: true as const,
    rateLimitsRequired: true as const, fullPortfolioModelDump: false as const,
    oneAiCallPerListing: false as const }
}

export function createAssistantFindingV1(input: Omit<AssistantFindingV1,
  "contractVersion" | "findingId" | "createdAt" | "status"> & { createdAt: string }) {
  return { contractVersion: ASSISTANT_FINDING_VERSION,
    findingId: stableId("assistant-finding-v1", [input.findingType, input.module,
      [...new Set(input.entityRefs)].sort(), [...new Set(input.evidenceRefs)].sort(), input.createdAt]),
    ...input, status: "PROPOSED" as const }
}
