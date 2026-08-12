import { createHash } from "node:crypto"

import type { CommercialMonitorGetDto, CommercialListingDecisionV1,
  CommercialListingReadModel } from "./commercial-monitor-readonly-contract"

export const SELLER_OS_PORTFOLIO_INTELLIGENCE_VERSION =
  "SELLER_OS_PORTFOLIO_INTELLIGENCE_V1_2026_08_12"

export type ExceptionClassV1 = "CRITICAL_OPERATIONAL" | "COMMERCIAL_INTERVENTION" |
  "HUMAN_REVIEW" | "EXPERIMENT_REVIEW" | "DO_NOT_TOUCH" | "STALE_EVIDENCE" |
  "REPLACEMENT_CANDIDATE" | "NEW_OPPORTUNITY" | "WAIT_HEALTHY"

export type OpportunityRadarStateV1 = "NEW_CANDIDATE" | "STRENGTHENING" | "STABLE" |
  "WEAKENING" | "INSUFFICIENT_EVIDENCE" | "RESEARCH_REQUIRED"

type OpportunityCandidateV1 = {
  opportunityId: string
  familyLabel: string
  decision: "ADVANCE" | "HOLD" | "REJECT" | "HUMAN_REVIEW"
  score: number | null
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNPROVEN"
  activeCompetitionCount: number | null
  keywordEvidenceScore: number | null
  comparableConfidence: number | null
  soldHistoryStatus: "AVAILABLE" | "UNAVAILABLE" | "PARTIAL" | "UNPROVEN"
  supplierMatchStatus?: "EXACT_PROVEN" | "CANDIDATE" | "UNPROVEN"
  observedAt: string
}

type MarketObservationV1 = {
  opportunityId: string
  observedAt: string
  activeCompetitionCount: number | null
  medianActivePrice: number | null
  keywordEvidenceScore: number | null
  comparableClusterCount: number | null
  supplierMatchStatus: "EXACT_PROVEN" | "CANDIDATE" | "UNPROVEN"
  soldEvidenceStatus: "AVAILABLE" | "UNAVAILABLE" | "PARTIAL" | "UNPROVEN"
}

const severityRank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 } as const

function fingerprint(values: unknown[]) {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 24)
}

function listingDecision(monitor: CommercialMonitorGetDto, listingKey: string) {
  return monitor.backend.decisions.find((decision) => decision.listingKey === listingKey) ?? null
}

function recommendationFor(decision: CommercialListingDecisionV1) {
  if (decision.protectionState === "DO_NOT_TOUCH") return "WAIT_ACTIVE_EXPERIMENT"
  if (decision.reasonCodes.includes("REVIEW_EXPERIMENT_RESULT")) return "REVIEW_EXPERIMENT_RESULT"
  if (decision.reasonCodes.includes("HARD_OVERRIDE_REQUIRES_HUMAN_REVIEW")) return "HUMAN_REVIEW"
  const map = {
    WAIT: "NO_ACTION", IMPROVE_VISIBILITY: "IMPROVE_VISIBILITY", IMPROVE_CTR: "IMPROVE_CTR",
    IMPROVE_CONVERSION: "IMPROVE_CONVERSION", FIX_DATA_QUALITY: "FIX_DATA_QUALITY",
    REVIEW_EBAY_GUIDANCE: "HUMAN_REVIEW", START_CONTROLLED_EXPERIMENT: "START_CONTROLLED_EXPERIMENT",
    HUMAN_REVIEW: "HUMAN_REVIEW",
  } as const
  return map[decision.recommendedAction]
}

export function buildProactiveExceptionQueueV1(input: {
  monitor: CommercialMonitorGetDto
  opportunities?: OpportunityCandidateV1[]
  maximumEntries?: number
}) {
  const maximumEntries = Math.min(250, Math.max(1, input.maximumEntries ?? 100))
  const entries: Array<Record<string, unknown> & { entityKey: string; classification: ExceptionClassV1;
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"; dedupeIdentity: string }> = []
  for (const listing of input.monitor.listings) {
    const decision = listingDecision(input.monitor, listing.key)
    if (!decision) continue
    const reasonCodes = [...new Set(decision.reasonCodes)].sort()
    const hardOverride = reasonCodes.includes("HARD_OVERRIDE_REQUIRES_HUMAN_REVIEW") ||
      listing.stock.state === "OUT_OF_STOCK_SIGNAL"
    const classification: ExceptionClassV1 = hardOverride ? "CRITICAL_OPERATIONAL"
      : decision.protectionState === "DO_NOT_TOUCH" ? "DO_NOT_TOUCH"
        : decision.reasonCodes.includes("REVIEW_EXPERIMENT_RESULT") ? "EXPERIMENT_REVIEW"
          : listing.stock.freshness.status === "STALE" ? "STALE_EVIDENCE"
            : decision.recommendedAction === "HUMAN_REVIEW" ? "HUMAN_REVIEW"
              : decision.recommendedAction === "WAIT" ? "WAIT_HEALTHY"
                : "COMMERCIAL_INTERVENTION"
    const severity = hardOverride ? "CRITICAL" as const : classification === "DO_NOT_TOUCH" ||
      classification === "EXPERIMENT_REVIEW" ? "HIGH" as const : decision.priority
    const dedupeIdentity = `exception_${fingerprint([listing.identity.itemId, classification,
      reasonCodes, decision.recommendedAction])}`
    entries.push({ entityKey: listing.identity.itemId, listingKey: listing.key,
      entityType: "EBAY_LIVE_LISTING", title: listing.identity.title,
      classification, priority: decision.priority, severity, confidence: decision.evidenceStatus,
      reasonCodes, observedEvidence: {
        analyticsStatus: listing.metrics.impressions.availability,
        stockState: listing.stock.state, stockFreshness: listing.stock.freshness.status },
      lastObservationTime: listing.identity.lastObservedAt,
      recommendedAction: hardOverride ? "HUMAN_REVIEW" : recommendationFor(decision),
      humanApprovalRequired: true, actionBlockedByEvidence: decision.actionBlockedByInsufficientEvidence,
      experimentProtectionExists: decision.protectionState === "DO_NOT_TOUCH",
      nextReviewCondition: decision.nextReviewCondition, dedupeIdentity })
  }
  if ((input.monitor.backend.capabilities.registry.humanReviewCount ?? 0) > 0) {
    const registry = input.monitor.backend.capabilities.registry
    entries.push({ entityKey: "REGISTRY_HUMAN_REVIEW", entityType: "REGISTRY_PARTITION",
      classification: "HUMAN_REVIEW", priority: "HIGH", severity: "HIGH",
      confidence: registry.status, reasonCodes: registry.limitationCodes,
      observedEvidence: { humanReviewCount: registry.humanReviewCount,
        coveragePercent: registry.coveragePercent }, lastObservationTime: input.monitor.generatedAt,
      recommendedAction: "HUMAN_REVIEW", humanApprovalRequired: true,
      actionBlockedByEvidence: false, experimentProtectionExists: false,
      nextReviewCondition: "Review unresolved authoritative relationships",
      dedupeIdentity: `exception_${fingerprint(["REGISTRY", registry.humanReviewCount,
        registry.coveragePercent])}` })
  }
  for (const opportunity of (input.opportunities ?? []).filter((row) => row.decision === "ADVANCE")) {
    entries.push({ entityKey: opportunity.opportunityId, entityType: "MARKET_OPPORTUNITY",
      listingKey: null, title: opportunity.familyLabel, classification: "NEW_OPPORTUNITY",
      priority: opportunity.confidence === "HIGH" ? "HIGH" : "MEDIUM",
      severity: opportunity.confidence === "HIGH" ? "HIGH" : "MEDIUM",
      confidence: opportunity.confidence, reasonCodes: ["OPPORTUNITY_ADVANCE_EVIDENCE"],
      observedEvidence: { opportunityScore: opportunity.score,
        activeCompetitionCount: opportunity.activeCompetitionCount },
      lastObservationTime: opportunity.observedAt, recommendedAction: "ADVANCE_OPPORTUNITY",
      humanApprovalRequired: true, actionBlockedByEvidence: opportunity.score === null,
      experimentProtectionExists: false, nextReviewCondition: "Supplier match required",
      dedupeIdentity: `exception_${fingerprint([opportunity.opportunityId, opportunity.score,
        opportunity.observedAt])}` })
  }
  const unique = [...new Map(entries.map((entry) => [entry.dedupeIdentity, entry])).values()]
  return unique.sort((left, right) => severityRank[right.severity] - severityRank[left.severity] ||
    String(left.entityKey).localeCompare(String(right.entityKey))).slice(0, maximumEntries)
}

export function evaluateReplaceKillIntelligenceV1(input: {
  listing: CommercialListingReadModel
  decision: CommercialListingDecisionV1 | null
  alternativeOpportunity?: OpportunityCandidateV1 | null
}) {
  const decision = input.decision
  const protectedExperiment = decision?.protectionState === "DO_NOT_TOUCH" ||
    decision?.experimentRunning === true
  const observationSufficient = decision?.evidenceStatus === "AVAILABLE" &&
    !decision.actionBlockedByInsufficientEvidence
  const alternative = input.alternativeOpportunity
  const alternativeStronger = alternative?.decision === "ADVANCE" && alternative.score !== null &&
    alternative.confidence !== "UNPROVEN"
  const status = protectedExperiment ? "WAIT" as const : !observationSufficient ? "WAIT" as const
    : alternativeStronger && decision?.priority === "CRITICAL" ? "KILL_REVIEW" as const
      : alternativeStronger && ["HIGH", "CRITICAL"].includes(decision?.priority ?? "")
        ? "REPLACE_CANDIDATE" as const
        : decision?.recommendedAction === "WAIT" ? "KEEP" as const : "IMPROVE" as const
  return { contractVersion: "REPLACE_KILL_INTELLIGENCE_V1", listingItemId: input.listing.identity.itemId,
    status, currentListingWeakness: decision?.reasonCodes ?? ["DECISION_EVIDENCE_UNAVAILABLE"],
    observationSufficient, experimentProtection: protectedExperiment,
    alternativeOpportunityId: alternativeStronger ? alternative?.opportunityId ?? null : null,
    strongerDimensions: alternativeStronger ? ["MARKET_OPPORTUNITY_EVIDENCE"] : [],
    unprovenDimensions: [
      ...(input.listing.metrics.orders.availability === "AVAILABLE" ? [] : ["ORDERS"]),
      ...(input.listing.stock.sourceContractStatus === "HEALTHY" ? [] : ["SUPPLIER_STOCK"]),
      ...(alternative ? [] : ["ALTERNATIVE_OPPORTUNITY"]),
    ], automaticListingEndAllowed: false as const, humanApprovalRequired: status === "KILL_REVIEW" ||
      status === "REPLACE_CANDIDATE" }
}

export function evaluateOpportunityRadarV1(input: {
  current: MarketObservationV1
  previous?: MarketObservationV1 | null
}) {
  const current = input.current
  const previous = input.previous
  if (!previous) return { opportunityId: current.opportunityId, state: "NEW_CANDIDATE" as const,
    soldMomentumClaimed: false as const, reasonCodes: ["FIRST_OBSERVATION"] }
  const comparable = [current.activeCompetitionCount, current.medianActivePrice,
    current.keywordEvidenceScore, current.comparableClusterCount].every((value) => value !== null) &&
    [previous.activeCompetitionCount, previous.medianActivePrice,
      previous.keywordEvidenceScore, previous.comparableClusterCount].every((value) => value !== null)
  if (!comparable) return { opportunityId: current.opportunityId,
    state: "INSUFFICIENT_EVIDENCE" as const, soldMomentumClaimed: false as const,
    reasonCodes: ["COMPARABLE_ACTIVE_MARKET_OBSERVATIONS_REQUIRED"] }
  const strengthDelta = (current.keywordEvidenceScore! - previous.keywordEvidenceScore!) +
    (current.comparableClusterCount! - previous.comparableClusterCount!) -
    Math.sign(current.activeCompetitionCount! - previous.activeCompetitionCount!)
  return { opportunityId: current.opportunityId,
    state: strengthDelta > 1 ? "STRENGTHENING" as const
      : strengthDelta < -1 ? "WEAKENING" as const : "STABLE" as const,
    soldMomentumClaimed: false as const,
    evidenceScope: "ACTIVE_MARKET_CHANGE_ONLY" as const,
    reasonCodes: ["ACTIVE_COMPETITION_PRICE_KEYWORD_CLUSTER_COMPARISON"] }
}

export type AutomationWorkClassV1 = "CRITICAL_WATCH" | "ACTIVE_EXPERIMENT" |
  "STALE_EVIDENCE" | "NEW_OPPORTUNITY_RESEARCH" | "NORMAL_ACTIVE_LISTING" |
  "HEALTHY_LOW_PRIORITY"

export function planAutomationWorkV1(input: {
  entities: Array<{ entityKey: string; critical: boolean; experimentActive: boolean;
    evidenceStale: boolean; newOpportunity: boolean; healthy: boolean; unchangedFingerprint?: boolean }>
  policy: { maximumBatchSize: number; maximumConcurrency: number; paginationBudget: number;
    classWeights: Record<AutomationWorkClassV1, number> }
}) {
  const maximumBatchSize = Math.min(500, Math.max(1, input.policy.maximumBatchSize))
  const classify = (row: typeof input.entities[number]): AutomationWorkClassV1 => row.critical
    ? "CRITICAL_WATCH" : row.experimentActive ? "ACTIVE_EXPERIMENT"
      : row.evidenceStale ? "STALE_EVIDENCE" : row.newOpportunity ? "NEW_OPPORTUNITY_RESEARCH"
        : row.healthy ? "HEALTHY_LOW_PRIORITY" : "NORMAL_ACTIVE_LISTING"
  const work = input.entities.filter((row) => !row.unchangedFingerprint || row.critical || row.evidenceStale)
    .map((row) => ({ entityKey: row.entityKey, workClass: classify(row) }))
    .sort((left, right) => input.policy.classWeights[right.workClass] -
      input.policy.classWeights[left.workClass] || left.entityKey.localeCompare(right.entityKey))
    .slice(0, maximumBatchSize)
  return { contractVersion: "AUTOMATION_ORCHESTRATOR_V1", activationStatus: "READY_BUT_NOT_ACTIVATED" as const,
    work, policy: { maximumBatchSize, maximumConcurrency: Math.min(20,
      Math.max(1, input.policy.maximumConcurrency)), paginationBudget: Math.min(100,
      Math.max(1, input.policy.paginationBudget)) }, incrementalReads: true as const,
    unchangedEvidenceReused: true as const, uncontrolledFanout: false as const,
    recurringSchedulerActivated: false as const }
}

export function buildAutomationHealthMetricsV1(input: {
  detections?: Array<{ observedAt: string; detectedAt: string; decidedAt?: string;
    alertedAt?: string; falseAlert?: boolean; manualReview?: boolean }>
  experimentReviews?: Array<{ readyAt: string; reviewedAt: string | null }>
  staleEntityCount?: number
  totalEntityCount?: number
}) {
  const detections = input.detections ?? []
  const latency = (end: string, start: string) => Math.max(0, Date.parse(end) - Date.parse(start))
  const average = (values: number[]) => values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null
  const detectionLatencyMs = average(detections.map((row) => latency(row.detectedAt, row.observedAt)))
  const decisionLatencyMs = average(detections.flatMap((row) => row.decidedAt
    ? [latency(row.decidedAt, row.detectedAt)] : []))
  const alertLatencyMs = average(detections.flatMap((row) => row.alertedAt
    ? [latency(row.alertedAt, row.decidedAt ?? row.detectedAt)] : []))
  const ratio = (numerator: number, denominator: number) => denominator > 0
    ? Math.round((numerator / denominator) * 10_000) / 100 : null
  return { detectionLatency: detectionLatencyMs === null ? { status: "NOT_ENOUGH_HISTORY" }
    : { status: "AVAILABLE", milliseconds: detectionLatencyMs },
  decisionLatency: decisionLatencyMs === null ? { status: "NOT_ENOUGH_HISTORY" }
    : { status: "AVAILABLE", milliseconds: decisionLatencyMs },
  alertLatency: alertLatencyMs === null ? { status: "NOT_ENOUGH_HISTORY" }
    : { status: "AVAILABLE", milliseconds: alertLatencyMs },
  staleEvidenceRate: input.staleEntityCount === undefined || input.totalEntityCount === undefined
    ? { status: "UNPROVEN", value: null } : { status: "AVAILABLE",
      value: ratio(input.staleEntityCount, input.totalEntityCount) },
  manualReviewRate: detections.length ? { status: "AVAILABLE",
    value: ratio(detections.filter((row) => row.manualReview).length, detections.length) }
    : { status: "NOT_ENOUGH_HISTORY", value: null },
  falseAlertRate: detections.some((row) => row.falseAlert !== undefined) ? { status: "AVAILABLE",
    value: ratio(detections.filter((row) => row.falseAlert).length, detections.length) }
    : { status: "NOT_ENOUGH_HISTORY", value: null },
  opportunityDetectionRate: { status: "NOT_ENOUGH_HISTORY", value: null },
  experimentReviewLatency: input.experimentReviews?.some((row) => row.reviewedAt) ? {
    status: "AVAILABLE", milliseconds: average(input.experimentReviews.flatMap((row) =>
      row.reviewedAt ? [latency(row.reviewedAt, row.readyAt)] : [])) } :
    { status: "NOT_ENOUGH_HISTORY", milliseconds: null } }
}

export function buildPortfolioIntelligenceV1(input: {
  monitor: CommercialMonitorGetDto
  familyByItemId?: Record<string, string | null>
}) {
  const familyCounts = new Map<string, number>()
  for (const listing of input.monitor.listings) {
    const family = input.familyByItemId?.[listing.identity.itemId]
    if (family) familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1)
  }
  const decisions = input.monitor.backend.decisions
  return { contractVersion: "PORTFOLIO_INTELLIGENCE_V1",
    currentLiveListingCount: input.monitor.backend.kpis.activeListings.value,
    familyConcentration: [...familyCounts].map(([family, count]) => ({ family, count }))
      .sort((left, right) => right.count - left.count || left.family.localeCompare(right.family)),
    opportunityConcentration: { status: "UNPROVEN", reason: "PERSISTED_OPPORTUNITY_PORTFOLIO_UNAVAILABLE" },
    nearDuplicateExposure: { status: "UNPROVEN", count: null,
      reason: "AUTHORITATIVE_PRODUCT_FAMILY_IDENTITY_REQUIRED" },
    replacementCandidateCount: decisions.filter((row) => row.priority === "CRITICAL" &&
      !row.experimentRunning && row.evidenceStatus === "AVAILABLE").length,
    healthyWaitingCount: decisions.filter((row) => row.recommendedAction === "WAIT").length,
    interventionBurden: decisions.filter((row) => row.recommendedAction !== "WAIT" &&
      !row.actionBlockedByInsufficientEvidence).length,
    humanReviewBurden: (input.monitor.backend.capabilities.registry.humanReviewCount ?? 0) +
      decisions.filter((row) => row.recommendedAction === "HUMAN_REVIEW").length,
    automaticPortfolioMutationAllowed: false as const }
}

export function buildCommercialEvidenceScoreV1(input: {
  components: Array<{ name: string; value: number | null; weight: number;
    confidence: "HIGH" | "MEDIUM" | "LOW" | "UNPROVEN"; reason: string }>
}) {
  const usable = input.components.filter((row) => row.value !== null && row.confidence !== "UNPROVEN")
  const totalWeight = usable.reduce((sum, row) => sum + Math.max(0, row.weight), 0)
  const score = totalWeight > 0 ? Math.round(usable.reduce((sum, row) =>
    sum + Math.max(0, Math.min(100, row.value!)) * Math.max(0, row.weight), 0) / totalWeight * 100) / 100 : null
  return { contractVersion: "COMMERCIAL_EVIDENCE_SCORE_V1", score,
    status: score === null ? "SCORE_UNPROVEN" as const : "EVIDENCE_WEIGHTED_SCORE" as const,
    components: input.components, evidenceCompletenessPercent: input.components.length
      ? Math.round((usable.length / input.components.length) * 10_000) / 100 : 0,
    literalSaleProbability: false as const, statisticallyCalibrated: false as const,
    calibrationRoadmap: ["TIME_TO_FIRST_SALE", "QUANTITY_SOLD", "CONVERSION", "MARGIN",
      "EXPERIMENT_RESULT", "PRODUCT_SURVIVAL"] }
}

export function calculateTimeToFirstSaleV1(input: {
  listingStartedAt: string | null
  firstAuthoritativeSaleAt: string | null
  source: string | null
}) {
  const start = Date.parse(input.listingStartedAt ?? "")
  const sale = Date.parse(input.firstAuthoritativeSaleAt ?? "")
  if (!Number.isFinite(start) || !Number.isFinite(sale) || sale < start || !input.source) {
    return { metric: "TIME_TO_FIRST_SALE", status: "UNPROVEN" as const, milliseconds: null,
      source: null, approximateAnalyticsWindowUsed: false as const }
  }
  return { metric: "TIME_TO_FIRST_SALE", status: "AVAILABLE" as const,
    milliseconds: sale - start, source: input.source, approximateAnalyticsWindowUsed: false as const }
}

export function assessLearningTransferV1(input: {
  comparableCompletedExperiments: number
  familyIdentityProven: boolean
  categoryIdentityProven: boolean
}) {
  const scope = input.comparableCompletedExperiments < 1 ? "INSUFFICIENT_FOR_GENERALIZATION" as const
    : input.comparableCompletedExperiments === 1 ? "LISTING_ONLY" as const
      : input.familyIdentityProven ? "FAMILY_CANDIDATE" as const
        : input.categoryIdentityProven ? "CATEGORY_CANDIDATE" as const
          : "INSUFFICIENT_FOR_GENERALIZATION" as const
  return { scope, universalRuleAllowed: false as const, proactiveHypothesisAllowed: true as const,
    uncertaintyPreserved: true as const }
}

export function rankReferenceCandidatesV1(input: {
  candidates: Array<{ itemId: string; comparability: number; categoryCorrect: boolean;
    packCompatible: boolean; formFactorCompatible: boolean; variantCompatible: boolean;
    brandModelContamination: boolean; dataQualityClean: boolean; marketEvidence: number }>
}) {
  return input.candidates.map((row) => {
    const riskCodes = [
      ...(!row.categoryCorrect ? ["CATEGORY_MISMATCH"] : []),
      ...(!row.packCompatible ? ["PACK_COUNT_MISMATCH"] : []),
      ...(!row.formFactorCompatible ? ["FORM_FACTOR_MISMATCH"] : []),
      ...(!row.variantCompatible ? ["VARIANT_MISMATCH"] : []),
      ...(row.brandModelContamination ? ["BRAND_MODEL_CONTAMINATION_RISK"] : []),
      ...(!row.dataQualityClean ? ["DATA_QUALITY_UNPROVEN"] : []),
    ]
    const score = Math.max(0, Math.min(100, Math.round((row.comparability * 0.6 +
      row.marketEvidence * 0.4) - riskCodes.length * 12)))
    return { itemId: row.itemId, referenceQualityScore: score, referenceRiskCodes: riskCodes,
      useAsReferenceRecommendation: score >= 75 && riskCodes.length === 0 ? "USE_AS_REFERENCE" as const
        : score >= 50 ? "HUMAN_REVIEW" as const : "DO_NOT_USE" as const,
      copiedFields: [] as string[], competitorContentCopyAllowed: false as const }
  }).sort((left, right) => right.referenceQualityScore - left.referenceQualityScore ||
    left.itemId.localeCompare(right.itemId))
}
