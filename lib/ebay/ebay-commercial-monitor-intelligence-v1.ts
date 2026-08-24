import type {
  AlertCandidate,
  CommercialDecisionAction,
  CommercialDecisionClass,
  CommercialListingDecisionV1,
  CommercialListingReadModel,
  CommercialMonitorBackendV1,
  CommercialMonitorCapabilityStatus,
  EbayGuidanceComparisonReason,
  EbayGuidanceComparisonV1,
  EbayListingQualityRecommendation,
  EbayLiveCertificationReadModel,
  DataQualityCode,
  OperationalReviewBurdenV2,
} from "./commercial-monitor-readonly-contract"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { assessExperimentGuardianV1, EXPERIMENT_REGISTRY_CONTRACT_VERSION, type ExperimentEvidenceMetricV1, type ExperimentGuardianAssessmentV1, type ExperimentLifecycleStateV1, type ExperimentRegistryRecordV1, type ExternalEbaySignalV1 } from "./ebay-commercial-monitor-experiment-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { buildCanonicalCommercialTimeSeriesV1, unavailableAccountTrafficV1, type AccountTrafficEvidenceV1, type CommercialSeriesSnapshotV1 } from "./ebay-commercial-monitor-traffic-scope-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { buildCrossModuleLivePortfolioIntegrityV1, selectCanonicalCurrentLiveListingsV1 } from "./ebay-seller-os-live-portfolio-integrity-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { buildMonitorCoverageTransparencyV1, buildOrderSourceHealthV1 } from "./ebay-sales-order-event-foundation-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { createUnavailableSellerOsSaleAlertsReadV1, type SellerOsSaleAlertsReadV1 } from "./ebay-sale-alerts-read-v1.ts"

export const EBAY_LISTING_QUALITY_REPORT_SOURCE =
  "EBAY_LISTING_QUALITY_REPORT" as const

export type CommercialMonitorRegistryCertificationV1 = {
  status: "PARTIAL_CERTIFIED" | "COMPLETE" | "UNPROVEN" | "UNAVAILABLE"
  currentLiveCount: number | null
  matchedCount: number | null
  humanReviewCount: number | null
  coveragePercent: number | null
  limitationCodes: string[]
}

export type CommercialMonitorOrderFactsV1 = {
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE_AUTH_PENDING" | "UNAVAILABLE"
  orderCount: number | null
  lineItemCount: number | null
  quantitySold: number | null
  latestOrderCreationAt: string | null
  orderStatuses: string[]
  fulfillmentStatuses: string[]
  trackingAvailability: "AVAILABLE" | "MISSING" | "UNPROVEN"
  sourceObservedAt?: string | null
  pollIntervalMinutes?: number
  recentSales?: CommercialMonitorBackendV1["recentSales"]
}

type QualityReportArtifact = {
  source?: unknown
  sourceVersion?: unknown
  observedAt?: unknown
  importedAt?: unknown
  rows?: unknown
}

type QualityReportRow = {
  itemId?: unknown
  sku?: unknown
  recommendationCategory?: unknown
  recommendationType?: unknown
  recommendationText?: unknown
  reportedBenchmark?: unknown
  topCategoryBenchmark?: unknown
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown, maximum = 240) {
  if (typeof value !== "string") return null
  const safe = value.replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/Bearer\s+[^\s"'<]+/gi, "[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]")
    .replace(/\s+/g, " ").trim().slice(0, maximum)
  return safe || null
}

function iso(value: unknown) {
  const candidate = text(value, 50)
  return candidate && Number.isFinite(Date.parse(candidate))
    ? new Date(candidate).toISOString()
    : null
}

function nonnegativeNumber(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function normalizedCategory(value: unknown) {
  const candidate = text(value, 80)?.toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return candidate || "UNSPECIFIED"
}

export function normalizeEbayListingQualityReport(input: {
  artifact?: unknown
  listings: CommercialListingReadModel[]
}): CommercialMonitorBackendV1["listingQualityReport"] {
  if (input.artifact === undefined || input.artifact === null) {
    return {
      status: "UNAVAILABLE_NO_CURRENT_REPORT",
      source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
      persistenceStatus: "IN_MEMORY_READ_ONLY",
      limitationCode: "LISTING_QUALITY_REPORT_NOT_PROVIDED",
      recommendations: [],
    }
  }
  const artifact = record(input.artifact) as QualityReportArtifact
  const sourceVersion = text(artifact.sourceVersion, 80)
  const observedAt = iso(artifact.observedAt)
  const importedAt = iso(artifact.importedAt)
  const rows = Array.isArray(artifact.rows) ? artifact.rows : null
  if (artifact.source !== EBAY_LISTING_QUALITY_REPORT_SOURCE ||
      !sourceVersion || !observedAt || !importedAt || !rows) {
    return {
      status: "UNPROVEN",
      source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
      persistenceStatus: "IN_MEMORY_READ_ONLY",
      limitationCode: "LISTING_QUALITY_REPORT_CONTRACT_INVALID",
      recommendations: [],
    }
  }
  const byItemId = new Map<string, CommercialListingReadModel[]>()
  const bySku = new Map<string, CommercialListingReadModel[]>()
  for (const listing of input.listings) {
    const itemGroup = byItemId.get(listing.identity.itemId) ?? []
    itemGroup.push(listing)
    byItemId.set(listing.identity.itemId, itemGroup)
    if (listing.identity.sku) {
      const skuGroup = bySku.get(listing.identity.sku) ?? []
      skuGroup.push(listing)
      bySku.set(listing.identity.sku, skuGroup)
    }
  }
  const recommendations: EbayListingQualityRecommendation[] = rows.map((value) => {
    const row = record(value) as QualityReportRow
    const itemId = text(row.itemId, 30)
    const sku = text(row.sku, 120)
    const itemMatches = itemId ? byItemId.get(itemId) ?? [] : []
    const skuMatches = !itemId && sku ? bySku.get(sku) ?? [] : []
    const itemCertified = itemMatches.length === 1
    const skuUnique = !itemId && skuMatches.length === 1
    return {
      source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
      sourceVersion,
      listingKey: itemCertified
        ? itemMatches[0].key
        : skuUnique
          ? skuMatches[0].key
          : null,
      associationStatus: itemCertified
        ? "ITEM_ID_CERTIFIED"
        : skuUnique
          ? "SKU_UNIQUE"
          : "UNPROVEN",
      recommendationCategory: normalizedCategory(row.recommendationCategory),
      recommendationType: normalizedCategory(row.recommendationType),
      recommendationText: text(row.recommendationText),
      reportedBenchmark: nonnegativeNumber(row.reportedBenchmark),
      topCategoryBenchmark: nonnegativeNumber(row.topCategoryBenchmark),
      observedAt,
      importedAt,
    }
  })
  const resolved = recommendations.filter((row) => row.listingKey !== null).length
  return {
    status: recommendations.length === 0
      ? "MISSING"
      : resolved === recommendations.length
        ? "AVAILABLE"
        : "PARTIAL",
    source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
    persistenceStatus: "IN_MEMORY_READ_ONLY",
    limitationCode: resolved === recommendations.length
      ? null
      : "LISTING_QUALITY_REPORT_ASSOCIATION_UNPROVEN",
    recommendations,
  }
}

function metricValue(
  listing: CommercialListingReadModel,
  keys: Array<keyof CommercialListingReadModel["metrics"]>,
) {
  for (const key of keys) {
    const metric = listing.metrics[key]
    if (!metric) continue
    if ((metric.availability === "AVAILABLE" ||
        metric.availability === "PARTIAL") &&
        typeof metric.value === "number" && Number.isFinite(metric.value)) {
      return metric.value
    }
  }
  return null
}

export function classifyRegistryIndependentCommercialEvidenceV1(
  listing: CommercialListingReadModel,
) {
  const impressions = metricValue(listing, ["impressions"])
  const ctr = metricValue(listing, ["ctr_calculated", "ctr_reported"])
  const views = metricValue(listing, ["ebay_views"])
  const orders = metricValue(listing, ["orders", "transactions"])
  const conversion = metricValue(listing, ["conversion"])
  if (impressions === null) {
    return { classification: "DATA_QUALITY" as const,
      recommendedAction: "FIX_DATA_QUALITY" as const, priority: "MEDIUM" as const,
      evidenceStatus: "UNPROVEN" as const,
      reasonCodes: ["INSUFFICIENT_ANALYTICS_EVIDENCE"] as const }
  }
  if (impressions === 0) {
    return { classification: "VISIBILITY" as const,
      recommendedAction: "IMPROVE_VISIBILITY" as const, priority: "HIGH" as const,
      evidenceStatus: "AVAILABLE" as const,
      reasonCodes: ["AUTHORITATIVE_ZERO_IMPRESSIONS"] as const }
  }
  if (impressions < 100) {
    return { classification: "HEALTHY_WAIT" as const,
      recommendedAction: "WAIT" as const, priority: "LOW" as const,
      evidenceStatus: "PARTIAL" as const,
      reasonCodes: ["INSUFFICIENT_TRAFFIC"] as const }
  }
  if (ctr !== null && ctr < 1) {
    return { classification: "CTR" as const,
      recommendedAction: "IMPROVE_CTR" as const, priority: "HIGH" as const,
      evidenceStatus: "AVAILABLE" as const,
      reasonCodes: ["LOW_CTR_WITH_SUFFICIENT_IMPRESSIONS"] as const }
  }
  if (views !== null && views >= 20 && (orders === 0 || conversion === 0)) {
    return { classification: "CONVERSION" as const,
      recommendedAction: "IMPROVE_CONVERSION" as const, priority: "HIGH" as const,
      evidenceStatus: "AVAILABLE" as const,
      reasonCodes: ["TRAFFIC_WITHOUT_CONVERSION"] as const }
  }
  return { classification: "HEALTHY_WAIT" as const,
    recommendedAction: "WAIT" as const, priority: "LOW" as const,
    evidenceStatus: "AVAILABLE" as const,
    reasonCodes: ["HEALTHY_EVIDENCE_WAIT_FOR_NEXT_REVIEW"] as const }
}

const REGISTRY_AVAILABLE_STATUSES = new Set<CommercialMonitorCapabilityStatus>([
  "AVAILABLE", "COMPLETE", "PARTIAL", "PARTIAL_CERTIFIED",
])

const REGISTRY_SURFACE_OR_INDEPENDENT_DECISION_BLOCKERS = new Set<string>(
  [
    "MISSING_COMPOSITION",
    "COMPOSITION_UNPROVEN",
    "UNKNOWN_SHARED_ALLOCATION",
    "REGISTRY_RECONCILIATION_FAILED",
    "PRODUCT_CASE_LINK_MISSING",
    "PRODUCT_CASE_LINK_UNPROVEN",
    "ECONOMICS_INCOMPLETE",
    "EXPERIMENT_STATE_UNPROVEN",
    "ACTIVE_EXPERIMENT_CONFLICT",
    "REPORT_NOT_UPDATED_YET",
    "LISTING_DISCOVERY_INCOMPLETE",
    "LISTING_IDENTITY_UNPROVEN",
    "DUPLICATE_LISTING_IDENTITY",
    "SUPPLIER_IDENTITY_CONFLICT",
  ],
)

function isIndependentDecisionPreservingBlocker(code: string): boolean {
  return REGISTRY_SURFACE_OR_INDEPENDENT_DECISION_BLOCKERS.has(
    code as DataQualityCode,
  )
}

function hasDecisionPreservingRegistryDependency(blockers: CommercialListingReadModel["blockers"]) {
  return blockers.some((entry) =>
    isIndependentDecisionPreservingBlocker(entry.code))
}

function requiresOperationalManualReviewFromDecision(row: CommercialListingDecisionV1) {
  return row.recommendedAction !== "WAIT"
}

function operationalReviewDispositionV2(input: {
  listing: CommercialListingReadModel
  decision: CommercialListingDecisionV1
  registryStatus: CommercialMonitorCapabilityStatus
}) {
  const reasons = new Set(input.decision.reasonCodes)
  const blockers = new Set(input.listing.blockers.map((row) => row.code))
  const requiresOperationalIntervention = new Set<string>([
    "IMPROVE_VISIBILITY",
    "IMPROVE_CTR",
    "IMPROVE_CONVERSION",
    "FIX_DATA_QUALITY",
    "REVIEW_EBAY_GUIDANCE",
    "START_CONTROLLED_EXPERIMENT",
    "HUMAN_REVIEW",
  ] as const).has(input.decision.recommendedAction)
  const isRegistryDependentBlocker = [...blockers].some((code) =>
    isIndependentDecisionPreservingBlocker(code))
  const hardOverride = reasons.has("HARD_OVERRIDE_REQUIRES_HUMAN_REVIEW")
  const policyOrComplianceBlock = [...reasons].some((reason) =>
    /POLICY|COMPLIANCE/.test(reason))
  const nonRegistryIdentityConflict = ["LISTING_IDENTITY_UNPROVEN",
    "DUPLICATE_LISTING_IDENTITY", "SUPPLIER_IDENTITY_CONFLICT"].some((code) =>
    blockers.has(code as typeof input.listing.blockers[number]["code"]))
  const registryReconciliationConflict = blockers.has(
    "REGISTRY_RECONCILIATION_FAILED",
  )
  if (hardOverride || policyOrComplianceBlock ||
      input.decision.protectionState === "DO_NOT_TOUCH") {
    return { status: "RESOLVED" as const, humanReview: false,
      registryDependent: false }
  }
  if (nonRegistryIdentityConflict) {
    return { status: "RESOLVED" as const, humanReview: true,
      registryDependent: false }
  }
  if (registryReconciliationConflict) {
    const requiresRegistryDependentResolution = input.registryStatus === "UNAVAILABLE"
    if (input.decision.actionBlockedByInsufficientEvidence ||
        input.decision.evidenceStatus === "UNPROVEN") {
      return { status: "UNPROVEN" as const, humanReview: null,
        registryDependent: requiresRegistryDependentResolution &&
          input.decision.evidenceStatus === "UNPROVEN" }
    }
    if (input.decision.recommendedAction === "HUMAN_REVIEW" ||
        requiresOperationalIntervention) {
      return { status: "RESOLVED" as const, humanReview: true,
        registryDependent: false }
    }
    return { status: "RESOLVED" as const, humanReview: false,
      registryDependent: requiresRegistryDependentResolution }
  }
  if (input.decision.actionBlockedByInsufficientEvidence ||
      input.decision.evidenceStatus === "UNPROVEN") {
    return { status: "UNPROVEN" as const, humanReview: null,
      registryDependent: isRegistryDependentBlocker && input.registryStatus === "UNAVAILABLE" }
  }
  if (input.decision.recommendedAction === "HUMAN_REVIEW" ||
      requiresOperationalIntervention) {
    return { status: "RESOLVED" as const, humanReview: true,
      registryDependent: false }
  }
  return { status: "RESOLVED" as const, humanReview: false,
    registryDependent: false }
}

export function resolveOperationalReviewTaxonomyV2(input: {
  listings: CommercialListingReadModel[]
  decisions: CommercialListingDecisionV1[]
  registryStatus: CommercialMonitorCapabilityStatus
  activeListingStatus: CommercialMonitorCapabilityStatus
  activeListingCount: number | null
  scopeId: string
  scopeCount: number
  scopeObservedAt: string | null
  identityStatus: "CERTIFIED" | "PARTIAL" | "UNPROVEN"
}) {
  const canonicalListings = selectCanonicalCurrentLiveListingsV1(input.listings)
  const decisionsByKey = new Map<string, CommercialListingDecisionV1[]>()
  const decisionIndexByItemId = new Map<string, CommercialListingDecisionV1[]>()
  const listingKeyToItemId = new Map<string, string>()
  for (const listing of input.listings) {
    listingKeyToItemId.set(listing.key, listing.identity.itemId)
  }
  for (const decision of input.decisions) {
    const group = decisionsByKey.get(decision.listingKey) ?? []
    group.push(decision)
    decisionsByKey.set(decision.listingKey, group)
    const itemId = listingKeyToItemId.get(decision.listingKey)
    if (itemId) {
      const byItem = decisionIndexByItemId.get(itemId) ?? []
      byItem.push(decision)
      decisionIndexByItemId.set(itemId, byItem)
    }
  }
  const usedDecisionIndexes = new Set<string>()

  const takeNextUnused = (entries: CommercialListingDecisionV1[]) =>
    entries.find((entry, index) => !usedDecisionIndexes.has(`${entry.listingKey}:${index}`))

  const classifyDecisionForOperationalReview = (
    entry: CommercialListingDecisionV1,
  ) => {
    const hasUsableEvidence = entry.evidenceStatus !== "UNPROVEN" &&
      entry.actionBlockedByInsufficientEvidence !== true
    const requiresReview = entry.recommendedAction !== "WAIT"
    const priorityScore = entry.priority === "CRITICAL" ? 4
      : entry.priority === "HIGH" ? 3
        : entry.priority === "MEDIUM" ? 2
          : 1
    if (requiresReview && hasUsableEvidence) return 400 + priorityScore
    if (hasUsableEvidence) return 100 + priorityScore
    if (requiresReview) return 40
    return 10
  }

  const chooseDecision = (listing: CommercialListingReadModel) => {
    const byKey = decisionsByKey.get(listing.key) ?? []
    const keyMatch = [...byKey]
      .map((entry, index) => ({
        entry,
        index,
        score: classifyDecisionForOperationalReview(entry),
      }))
      .filter((candidate) =>
        !usedDecisionIndexes.has(`${candidate.entry.listingKey}:${candidate.index}`))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        if (right.entry.priority !== left.entry.priority) {
          return (right.entry.priority === "CRITICAL" ? 4
            : right.entry.priority === "HIGH" ? 3
              : right.entry.priority === "MEDIUM" ? 2 : 1) -
            (left.entry.priority === "CRITICAL" ? 4
              : left.entry.priority === "HIGH" ? 3
                : left.entry.priority === "MEDIUM" ? 2 : 1)
        }
        return left.index - right.index
      })
    if (keyMatch.length > 0) {
      const winner = keyMatch[0]
      usedDecisionIndexes.add(`${winner.entry.listingKey}:${winner.index}`)
      return winner.entry
    }
    const itemId = listing.identity.itemId
    if (!itemId) return null
    const byItem = decisionIndexByItemId.get(itemId) ?? []
    const fallbackMatch = byItem
      .map((entry, index) => ({
        entry,
        index,
        score: classifyDecisionForOperationalReview(entry),
      }))
      .filter((candidate) => !usedDecisionIndexes.has(
        `${candidate.entry.listingKey}:${candidate.index}`))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        if (right.entry.priority !== left.entry.priority) {
          return (right.entry.priority === "CRITICAL" ? 4
            : right.entry.priority === "HIGH" ? 3
              : right.entry.priority === "MEDIUM" ? 2 : 1) -
            (left.entry.priority === "CRITICAL" ? 4
              : left.entry.priority === "HIGH" ? 3
                : left.entry.priority === "MEDIUM" ? 2 : 1)
        }
        return left.index - right.index
      })[0]
    if (!fallbackMatch) return null
    usedDecisionIndexes.add(`${fallbackMatch.entry.listingKey}:${fallbackMatch.index}`)
    return fallbackMatch.entry
  }

  const cohortAligned = typeof input.activeListingCount === "number" &&
    input.activeListingCount === input.scopeCount &&
    canonicalListings.length === input.scopeCount
  const cohortProven = cohortAligned &&
    ["AVAILABLE", "COMPLETE"].includes(input.activeListingStatus) &&
    input.identityStatus === "CERTIFIED"
  const cohortPartial = cohortAligned && !cohortProven &&
    (["PARTIAL", "PARTIAL_CERTIFIED"].includes(input.activeListingStatus) ||
      input.identityStatus === "PARTIAL")

  const assessments = canonicalListings.map((listing) => {
    const selectedDecision = chooseDecision(listing)
    if (!selectedDecision) {
      return { itemId: listing.identity.itemId, listingKey: listing.key,
        status: "UNPROVEN" as const,
        humanReview: null, registryDependent: false,
        requiresReview: false, decision: null as never }
    }
    return { itemId: listing.identity.itemId, listingKey: listing.key,
      ...operationalReviewDispositionV2({
        listing,
        decision: selectedDecision,
        registryStatus: input.registryStatus,
      }),
      decision: selectedDecision,
      requiresReview: requiresOperationalManualReviewFromDecision(selectedDecision) }
  })

  const independentDecisionManualReviewItemIds =
    assessments
      .filter((row) => row.status === "RESOLVED" &&
        row.humanReview === true &&
        row.decision !== null &&
        row.decision.evidenceStatus !== "UNPROVEN" &&
        row.decision.actionBlockedByInsufficientEvidence !== true)
      .map((row) => row.itemId)
      .filter((itemId, index, array) => array.indexOf(itemId) === index)
  const fallbackIndependentReviewItemIds = new Set<string>(
    assessments
      .filter((row) => row.decision &&
        row.status === "RESOLVED" &&
        row.requiresReview &&
        row.humanReview === true &&
        row.decision.evidenceStatus !== "UNPROVEN" &&
        row.decision.actionBlockedByInsufficientEvidence !== true)
      .map((row) => row.itemId),
  )
  for (const itemId of fallbackIndependentReviewItemIds) {
    if (!independentDecisionManualReviewItemIds.includes(itemId)) {
      independentDecisionManualReviewItemIds.push(itemId)
    }
  }
  const decisionCoverageComplete = assessments.length === input.scopeCount &&
    assessments.every((row) => row.decision !== null)
  const operationalReviewEvidentRows = assessments.filter((row) =>
    row.decision !== null &&
    row.decision.evidenceStatus !== "UNPROVEN" &&
    row.decision.actionBlockedByInsufficientEvidence !== true)
  const independentOperationallyResolvedRows = assessments.filter((row) =>
    row.decision !== null &&
    row.decision.evidenceStatus !== "UNPROVEN" &&
    row.decision.actionBlockedByInsufficientEvidence !== true &&
    (input.registryStatus !== "UNAVAILABLE" || !row.registryDependent))
  const independentOperationalReviewCandidates = operationalReviewEvidentRows.filter((row) =>
    row.status === "RESOLVED" &&
    row.decision !== null &&
    row.decision.recommendedAction !== "WAIT" &&
    (input.registryStatus !== "UNAVAILABLE" || !row.registryDependent))
      .map((row) => row.itemId)
      .filter((itemId, index, array) => array.indexOf(itemId) === index)
  const hasOnlyIndependentNoReviewRows = operationalReviewEvidentRows.length > 0 &&
    operationalReviewEvidentRows.every((row) => row.decision !== null &&
      !row.decision.actionBlockedByInsufficientEvidence &&
      row.decision.recommendedAction === "WAIT" &&
      (input.registryStatus !== "UNAVAILABLE" || !row.registryDependent))
  const hasIndependentOperationalCoverage = independentOperationallyResolvedRows.length ===
    assessments.length && assessments.length > 0
  const canProveIndependentOperationalZeroDuringOutage =
    hasIndependentOperationalCoverage &&
    independentOperationallyResolvedRows.every((row) => row.decision !== null &&
      row.decision.recommendedAction === "WAIT")
  const hasAnyIndependentOperationalEvidence = operationalReviewEvidentRows.some((row) =>
    row.status === "RESOLVED" &&
    row.decision !== null &&
    (input.registryStatus !== "UNAVAILABLE" || !row.registryDependent))
  const unresolvedListingCount = assessments.filter((row) =>
    row.status === "UNPROVEN").length
  const humanReviewItemIds = assessments.filter((row) =>
    row.status === "RESOLVED" && row.humanReview === true).map((row) => row.itemId)
  const independentHumanReviewItemIds = independentDecisionManualReviewItemIds
  const hasIndependentReviewEvidence = independentDecisionManualReviewItemIds.length > 0
  const hasRegistryDependentEvidence = canonicalListings.some((listing) =>
    hasDecisionPreservingRegistryDependency(listing.blockers) &&
    input.registryStatus === "UNAVAILABLE")
  const canDetermineOperationalReviewDuringRegistryOutage =
    hasIndependentReviewEvidence ||
    canProveIndependentOperationalZeroDuringOutage
  const registryRecoveryCalculationPossible =
    input.registryStatus !== "UNAVAILABLE" || canDetermineOperationalReviewDuringRegistryOutage
  const hasRegistrySuppressedReviewRisk =
    input.registryStatus === "UNAVAILABLE" &&
    hasRegistryDependentEvidence &&
    !hasIndependentReviewEvidence
  const status = !cohortProven ? cohortPartial ? "PARTIAL" as const : "UNPROVEN" as const
    : !decisionCoverageComplete
      ? assessments.length ? "PARTIAL" as const : "UNPROVEN" as const
      : unresolvedListingCount > 0
        ? "PARTIAL" as const
        : !registryRecoveryCalculationPossible
          ? "PARTIAL" as const
          : "AVAILABLE" as const
  const value = status === "AVAILABLE" &&
    (input.registryStatus !== "UNAVAILABLE" || canDetermineOperationalReviewDuringRegistryOutage)
    ? independentHumanReviewItemIds.length
    : null
  const effectiveDecisionDependencyStatus =
    !registryRecoveryCalculationPossible ? "PARTIAL" as const : (!cohortProven
      ? "UNPROVEN" as const
      : !decisionCoverageComplete || unresolvedListingCount > 0
        ? "PARTIAL" as const : "AVAILABLE" as const)
  const reasonCode: OperationalReviewBurdenV2["reasonCode"] = !cohortProven
    ? cohortPartial ? "CURRENT_LIVE_COHORT_PARTIAL"
      : "CURRENT_LIVE_COHORT_UNPROVEN"
    : !decisionCoverageComplete
      ? "OPERATIONAL_REVIEW_DECISION_COVERAGE_INCOMPLETE"
      : unresolvedListingCount > 0
        ? "OPERATIONAL_REVIEW_DEPENDENCY_UNAVAILABLE"
        : !registryRecoveryCalculationPossible
          ? "OPERATIONAL_REVIEW_DEPENDENCY_UNAVAILABLE"
            : value === 0 && input.registryStatus === "UNAVAILABLE" &&
              independentOperationalReviewCandidates.length === 0 &&
              !hasOnlyIndependentNoReviewRows
              ? "CURRENT_LIVE_COHORT_PARTIAL"
            : canProveIndependentOperationalZeroDuringOutage
              && input.registryStatus === "UNAVAILABLE" && value === 0
              && !hasRegistryDependentEvidence
              ? "OPERATIONAL_REVIEW_AUTHORITATIVE_ZERO"
        : value === 0 ? "OPERATIONAL_REVIEW_AUTHORITATIVE_ZERO"
          : "OPERATIONAL_REVIEW_AUTHORITATIVE_COUNT"
  return { status, value, reasonCode, cohortProven, cohortPartial,
    decisionCoverageComplete,
    unresolvedListingCount, humanReviewItemIds,
    decisionDependencyStatus: effectiveDecisionDependencyStatus }
}

export function evaluateOperationalReviewFalseZeroGuardV1(input: Pick<
  OperationalReviewBurdenV2,
  "status" | "value" | "authority" | "scopeType" | "scopeCount" |
  "zeroIsAuthoritative" | "dependencyStatus" | "observedAt"
>): OperationalReviewBurdenV2["falseZeroGuard"] {
  const dependencyUnavailable = input.dependencyStatus.registry === "UNAVAILABLE"
  const unresolvedListingCannotBeAuthoritativeZero = input.dependencyStatus.unresolvedListingCount > 0
  const triggered = input.value === 0 &&
    (input.authority === "DECISION_TAXONOMY_V2" &&
      (!input.zeroIsAuthoritative || input.status !== "AVAILABLE" ||
        (dependencyUnavailable && (input.dependencyStatus.decisions !== "AVAILABLE" ||
          unresolvedListingCannotBeAuthoritativeZero))))
  return { guardCode: "OPERATIONAL_REVIEW_FALSE_ZERO_GUARD",
    status: triggered ? "TRIGGERED" : "PASS", authority: input.authority,
    scopeType: input.scopeType, scopeCount: input.scopeCount,
    reasonCode: triggered ? "UNAVAILABLE_DEPENDENCY_WOULD_CREATE_FALSE_ZERO"
      : input.value === 0 ? "AUTHORITATIVE_OPERATIONAL_ZERO"
        : typeof input.value === "number" ? "AUTHORITATIVE_OPERATIONAL_REVIEW_COUNT"
          : "UNPROVEN_OPERATIONAL_REVIEW_REMAINS_NULL",
    zeroIsAuthoritative: input.zeroIsAuthoritative,
    dependencyStatus: input.dependencyStatus.decisions,
    observedAt: input.observedAt, autoMutationAllowed: false }
}

export function buildOperationalReviewBurdenV2(input: Parameters<
  typeof resolveOperationalReviewTaxonomyV2
>[0]): OperationalReviewBurdenV2 {
  const assessment = resolveOperationalReviewTaxonomyV2(input)
  const provisional = {
    contractVersion: "OPERATIONAL_REVIEW_BURDEN_V2_2026_08_13" as const,
    status: assessment.status,
    value: assessment.value,
    numerator: assessment.value,
    denominator: assessment.status === "AVAILABLE" ? input.scopeCount : null,
    authority: "DECISION_TAXONOMY_V2" as const,
    scopeId: input.scopeId,
    scopeType: "CURRENT_LIVE_COHORT_SCOPE" as const,
    scopeCount: input.scopeCount,
    observedAt: input.scopeObservedAt,
    grain: "EBAY_LIVE_LISTING" as const,
    entityType: "EBAY_LIVE_LISTING" as const,
    zeroIsAuthoritative: assessment.status === "AVAILABLE" &&
      assessment.value === 0,
    reasonCode: assessment.reasonCode,
    dependencyStatus: {
      currentLiveIdentity: assessment.cohortProven
        ? "AVAILABLE" as const : assessment.cohortPartial
          ? "PARTIAL" as const : "UNPROVEN" as const,
      decisions: assessment.decisionDependencyStatus,
      registry: input.registryStatus,
      unresolvedListingCount: assessment.unresolvedListingCount,
      registryUnavailableMayBecomeZero: false as const,
    },
  }
  const resolved = { ...provisional,
    zeroIsAuthoritative: provisional.status === "AVAILABLE" &&
      provisional.value === 0 &&
      provisional.reasonCode === "OPERATIONAL_REVIEW_AUTHORITATIVE_ZERO",
  }
  return { ...resolved,
    falseZeroGuard: evaluateOperationalReviewFalseZeroGuardV1(resolved) }
}

const EXPERIMENT_EVIDENCE_METRICS = new Set<ExperimentEvidenceMetricV1>([
  "IMPRESSIONS",
  "LISTING_VIEWS",
  "QUANTITY_SOLD",
  "DATA_QUALITY_RESOLUTION",
])

const EXPERIMENT_LIFECYCLE_STATES = new Set<ExperimentLifecycleStateV1>([
  "DRAFT",
  "READY",
  "RUNNING",
  "WAITING_FOR_EVIDENCE",
  "READY_TO_EVALUATE",
  "PAUSED_FOR_EXTERNAL_SIGNAL",
  "COMPLETED",
  "INCONCLUSIVE",
  "CANCELLED",
])

function experimentGuardian(
  listing: CommercialListingReadModel,
): ExperimentGuardianAssessmentV1 | null {
  if (listing.experiment.status !== "AVAILABLE") return null
  const experiment = listing.experiment
  const metric = EXPERIMENT_EVIDENCE_METRICS.has(
      experiment.minimumEvidenceMetric as ExperimentEvidenceMetricV1,
    )
    ? experiment.minimumEvidenceMetric as ExperimentEvidenceMetricV1
    : "DATA_QUALITY_RESOLUTION"
  const currentEvidenceValue = experiment.currentEvidenceValue ??
    (metric === "IMPRESSIONS"
      ? metricValue(listing, ["impressions"])
      : metric === "LISTING_VIEWS"
        ? metricValue(listing, ["ebay_views"])
        : metric === "QUANTITY_SOLD"
          ? metricValue(listing, ["transactions"])
          : null)
  const lifecycleState = EXPERIMENT_LIFECYCLE_STATES.has(
      experiment.lifecycleState as ExperimentLifecycleStateV1,
    )
    ? experiment.lifecycleState as ExperimentLifecycleStateV1
    : "DRAFT"
  const diagnosisClass = ["VISIBILITY", "CTR", "CONVERSION", "DATA_QUALITY"]
    .includes(experiment.diagnosisClass ?? "")
    ? experiment.diagnosisClass as ExperimentRegistryRecordV1["diagnosisClass"]
    : "DATA_QUALITY"
  const record: ExperimentRegistryRecordV1 = {
    contractVersion: EXPERIMENT_REGISTRY_CONTRACT_VERSION,
    experimentId: experiment.experimentId,
    accountKey: experiment.accountKey ?? "SERVER_SCOPE_UNPROVEN",
    marketplace: experiment.marketplace ?? "EBAY_US",
    ebayItemId: experiment.ebayItemId ?? listing.identity.itemId,
    sku: experiment.sku ?? listing.identity.sku,
    hypothesis: experiment.hypothesis ?? "HYPOTHESIS_NOT_RECORDED",
    diagnosisClass,
    experimentType: experiment.experimentType ?? "UNPROVEN",
    variableChanged: experiment.testedVariable,
    changedAt: experiment.t0,
    baselineEvidenceRef: null,
    baselineMetric: metric,
    baselineValue: null,
    lifecycleState,
    frozenVariables: experiment.frozenVariables,
    minimumObservationDurationHours:
      experiment.minimumObservationDurationHours ?? Number.MAX_SAFE_INTEGER,
    minimumEvidenceMetric: metric,
    minimumEvidenceValue:
      experiment.minimumEvidenceValue ?? Number.MAX_SAFE_INTEGER,
    currentEvidenceValue,
    nextReviewAt: experiment.nextReviewAt ?? null,
    createdAt: experiment.t0,
    updatedAt: experiment.evidenceTimestamp,
  }
  const signalCodes = [...(experiment.externalSignalCodes ?? [])]
  if (["OUT_OF_STOCK_SIGNAL", "CERTIFIED_OOS"].includes(
      listing.stock?.state ?? "")) {
    signalCodes.push("OUT_OF_STOCK")
  }
  const signals: ExternalEbaySignalV1[] = [...new Set(signalCodes)].map(
    (code) => ({
      code,
      observedAt: experiment.evidenceTimestamp,
      source: "COMMERCIAL_MONITOR_CANONICAL_EVIDENCE",
    }),
  )
  return assessExperimentGuardianV1({
    experiment: record,
    observedAt: experiment.evidenceTimestamp,
    currentEvidenceValue,
    externalSignals: signals,
  })
}

export function classifyCommercialListingV1(
  listing: CommercialListingReadModel,
): CommercialListingDecisionV1 {
  const independent = classifyRegistryIndependentCommercialEvidenceV1(listing)
  const guardian = experimentGuardian(listing)
  const experimentRunning = guardian?.active === true
  const variableFrozen = listing.experiment.status === "AVAILABLE" &&
    listing.experiment.frozenVariables.length > 0
  let classification: CommercialDecisionClass = independent.classification
  let action: CommercialDecisionAction = independent.recommendedAction
  let priority: CommercialListingDecisionV1["priority"] = independent.priority
  let evidenceStatus: CommercialListingDecisionV1["evidenceStatus"] =
    independent.evidenceStatus
  const reasons: CommercialListingDecisionV1["reasonCodes"] = []
  const blockerCodes = listing.blockers.map((row) => row.code)
  const nonPreservingBlockers = blockerCodes
    .filter((row) => !isIndependentDecisionPreservingBlocker(row))
  if (nonPreservingBlockers.length > 0) {
    classification = "DATA_QUALITY"
    action = "FIX_DATA_QUALITY"
    priority = "HIGH"
    evidenceStatus = "UNPROVEN"
    reasons.push("BLOCKING_DATA_QUALITY_ISSUE")
  }
  reasons.push(...independent.reasonCodes)
  if (guardian?.active) {
    if (guardian.operationalAction === "HARD_OVERRIDE_REQUIRED") {
      action = "HUMAN_REVIEW"
      priority = "CRITICAL"
      reasons.push(
        "ACTIVE_EXPERIMENT_PROTECTS_VARIABLE",
        "HARD_OVERRIDE_REQUIRES_HUMAN_REVIEW",
        "EXTERNAL_SIGNAL_REVIEW",
      )
    } else {
      action = "WAIT"
      reasons.push("ACTIVE_EXPERIMENT_PROTECTS_VARIABLE")
      if (guardian.readyToEvaluate) reasons.push("REVIEW_EXPERIMENT_RESULT")
      else {
        reasons.push("WAIT_ACTIVE_EXPERIMENT")
        if (!guardian.timeGateSatisfied) reasons.push("WAIT_MINIMUM_TIME")
        if (!guardian.evidenceGateSatisfied) reasons.push("WAIT_MINIMUM_EVIDENCE")
        if (guardian.externalSignalClassification === "SOFT_SIGNAL") {
          reasons.push("EXTERNAL_SIGNAL_REVIEW")
        }
      }
    }
  }
  return {
    listingKey: listing.key,
    classification,
    priority,
    evidenceStatus,
    reasonCodes: [...new Set(reasons)],
    recommendedAction: action,
    actionBlockedByInsufficientEvidence: evidenceStatus === "UNPROVEN",
    experimentRunning,
    variableFrozen,
    protectionState: guardian?.protectionState === "DO_NOT_TOUCH"
      ? "DO_NOT_TOUCH"
      : guardian ? "NONE" : "UNPROVEN",
    experimentOperationalState: guardian?.protectionState ===
        "PAUSE_FOR_HUMAN_REVIEW"
      ? "PAUSED_FOR_EXTERNAL_SIGNAL"
      : guardian?.readyToEvaluate
        ? "READY_TO_EVALUATE"
        : guardian?.active
          ? guardian.evidenceGateSatisfied
            ? "RUNNING"
            : "WAITING_FOR_EVIDENCE"
          : listing.experiment.status === "MISSING"
            ? "INACTIVE"
            : "UNPROVEN",
    frozenVariables: guardian?.frozenVariables ?? [],
    nextReviewEvidenceRemaining: guardian?.nextReviewEvidenceRemaining ?? null,
    externalSignalCount: guardian?.externalSignalCount ?? null,
    nextReviewCondition: guardian
      ? guardian.nextReviewReason.replaceAll("_", " ")
      : listing.experiment.status === "AVAILABLE"
        ? listing.experiment.checkpointGate ?? "EXPERIMENT CHECKPOINT"
      : evidenceStatus === "PARTIAL"
        ? "MINIMUM_TRAFFIC_THRESHOLD"
        : null,
    nextReviewAt: guardian?.nextReviewAt ?? null,
    actionExecutionAllowed: false,
  }
}

function categoryClass(category: string): CommercialDecisionClass | null {
  if (category.includes("VISIBILITY") || category.includes("IMPRESSION")) {
    return "VISIBILITY"
  }
  if (category.includes("CTR") || category.includes("CLICK")) return "CTR"
  if (category.includes("CONVERSION") || category.includes("SALE")) {
    return "CONVERSION"
  }
  if (category.includes("DATA") || category.includes("QUALITY")) {
    return "DATA_QUALITY"
  }
  return null
}

export function compareEbayGuidanceWithSellerOsV1(input: {
  decision: CommercialListingDecisionV1
  guidance?: EbayListingQualityRecommendation
}): EbayGuidanceComparisonV1 {
  if (!input.guidance) {
    return {
      listingKey: input.decision.listingKey,
      ebayGuidanceStatus: "MISSING",
      sellerOsDiagnosisStatus: input.decision.evidenceStatus === "UNPROVEN"
        ? "UNPROVEN"
        : "AVAILABLE",
      conclusion: "INSUFFICIENT_EVIDENCE",
      reasonCodes: ["GUIDANCE_NOT_AVAILABLE"],
      automaticExecutionAllowed: false,
    }
  }
  if (input.guidance.associationStatus === "UNPROVEN") {
    return {
      listingKey: input.decision.listingKey,
      ebayGuidanceStatus: "UNPROVEN",
      sellerOsDiagnosisStatus: input.decision.evidenceStatus === "UNPROVEN"
        ? "UNPROVEN"
        : "AVAILABLE",
      conclusion: "INSUFFICIENT_EVIDENCE",
      reasonCodes: ["BENCHMARK_NOT_AVAILABLE"],
      automaticExecutionAllowed: false,
    }
  }
  const guidanceClass = categoryClass(input.guidance.recommendationCategory)
  const reasons: EbayGuidanceComparisonReason[] = []
  let conclusion: EbayGuidanceComparisonV1["conclusion"]
  if (input.decision.experimentRunning) {
    conclusion = "PARTIALLY_AGREE"
    reasons.push("ACTIVE_EXPERIMENT_PROTECTS_VARIABLE")
  } else if (input.decision.evidenceStatus === "UNPROVEN") {
    conclusion = "INSUFFICIENT_EVIDENCE"
    reasons.push("GUIDANCE_SUPPORTED_BY_DATA_QUALITY_GAP")
  } else if (!guidanceClass) {
    conclusion = "INSUFFICIENT_EVIDENCE"
    reasons.push("BENCHMARK_NOT_AVAILABLE")
  } else if (guidanceClass === input.decision.classification) {
    conclusion = "AGREE"
    reasons.push(input.guidance.reportedBenchmark !== null ||
      input.guidance.topCategoryBenchmark !== null
      ? "BENCHMARK_SUPPORTS_GUIDANCE"
      : "BENCHMARK_NOT_AVAILABLE")
  } else if (input.decision.classification === "HEALTHY_WAIT") {
    conclusion = "DISAGREE"
    reasons.push(input.decision.reasonCodes.includes("INSUFFICIENT_TRAFFIC")
      ? "INSUFFICIENT_TRAFFIC"
      : "LIVE_ANALYTICS_CONTRADICTS_GUIDANCE")
  } else {
    conclusion = "PARTIALLY_AGREE"
    reasons.push("INSUFFICIENT_CONVERSION_EVIDENCE")
  }
  return {
    listingKey: input.decision.listingKey,
    ebayGuidanceStatus: "AVAILABLE",
    sellerOsDiagnosisStatus: input.decision.evidenceStatus === "UNPROVEN"
      ? "UNPROVEN"
      : "AVAILABLE",
    conclusion,
    reasonCodes: reasons,
    automaticExecutionAllowed: false,
  }
}

function aggregateMetric(
  listings: CommercialListingReadModel[],
  keys: Array<keyof CommercialListingReadModel["metrics"]>,
  average = false,
) {
  const values = listings.flatMap((listing) => {
    const value = metricValue(listing, keys)
    return value === null ? [] : [value]
  })
  if (!values.length) {
    return { status: "UNPROVEN" as const, value: null }
  }
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    status: values.length === listings.length
      ? "AVAILABLE" as const
      : "PARTIAL" as const,
    value: average ? total / values.length : total,
  }
}

function capabilityFromLiveStatus(
  value: "CERTIFIED" | "PARTIAL" | "UNAVAILABLE",
): CommercialMonitorCapabilityStatus {
  return value === "CERTIFIED" ? "AVAILABLE" : value
}

export function buildCommercialMonitorBackendV1(input: {
  liveCertification: EbayLiveCertificationReadModel
  listings: CommercialListingReadModel[]
  decisions?: Array<CommercialListingDecisionV1>
  alertCandidates: AlertCandidate[]
  registry?: CommercialMonitorRegistryCertificationV1 | null
  orders?: CommercialMonitorOrderFactsV1 | null
  accountTraffic?: AccountTrafficEvidenceV1 | null
  historicalSnapshots?: CommercialSeriesSnapshotV1[]
  currentLiveWindowStart?: string | null
  currentLiveWindowEnd?: string | null
  currentLiveObservedAt?: string | null
  reportObservedAt?: string | null
  listingQualityReportArtifact?: unknown
  saleAlerts?: SellerOsSaleAlertsReadV1
}): CommercialMonitorBackendV1 {
  const primaryListings = selectCanonicalCurrentLiveListingsV1(input.listings)
  const quality = normalizeEbayListingQualityReport({
    artifact: input.listingQualityReportArtifact,
    listings: primaryListings,
  })
  const decisionByListingKey = new Map<string, CommercialListingDecisionV1>(
    (input.decisions ?? []).map((row) => [row.listingKey, row]),
  )
  const decisions = primaryListings.map((listing) => {
    const baseline = classifyCommercialListingV1(listing)
    const provided = decisionByListingKey.get(listing.key)
    if (!provided) return baseline
    return { ...baseline, ...provided }
  })
  const guidanceByListing = new Map(quality.recommendations.flatMap((row) =>
    row.listingKey ? [[row.listingKey, row] as const] : []))
  const guidanceVsSellerOs = decisions.map((decision) =>
    compareEbayGuidanceWithSellerOsV1({
      decision,
      guidance: guidanceByListing.get(decision.listingKey),
    }))
  const orders = input.orders ?? {
    status: "UNAVAILABLE" as const,
    orderCount: null,
    lineItemCount: null,
    quantitySold: null,
    latestOrderCreationAt: null,
    orderStatuses: [],
    fulfillmentStatuses: [],
    trackingAvailability: "UNPROVEN" as const,
    sourceObservedAt: null,
  }
  const accountTraffic = input.accountTraffic ?? unavailableAccountTrafficV1(
    "ACCOUNT_TRAFFIC_NOT_COLLECTED",
  )
  const currentLiveImpressions = aggregateMetric(primaryListings, ["impressions"])
  const currentLiveViews = aggregateMetric(primaryListings, ["ebay_views"])
  const currentLiveCtr = aggregateMetric(
    primaryListings,
    ["ctr_calculated", "ctr_reported"],
    true,
  )
  const currentLiveQuantitySold = aggregateMetric(primaryListings, ["transactions"])
  const livePortfolioIntegrity = buildCrossModuleLivePortfolioIntegrityV1({
    listings: input.listings,
    liveCertification: input.liveCertification,
    registry: input.registry,
    accountTraffic,
    currentLiveQuantitySold: currentLiveQuantitySold.value,
    observedAt: input.liveCertification.discovery.observedAt ??
      input.currentLiveObservedAt ?? input.reportObservedAt ?? null,
  }).integrity
  const performanceSeries = buildCanonicalCommercialTimeSeriesV1({
    snapshots: input.historicalSnapshots ?? [],
    currentLiveItemIds: primaryListings.map((listing) => listing.identity.itemId),
  })
  const activeListingsProven = input.liveCertification.discovery.coverage ===
    "COMPLETE"
  const operationalReview = buildOperationalReviewBurdenV2({
    listings: primaryListings,
    decisions,
    registryStatus: input.registry?.status ?? "UNPROVEN",
    activeListingStatus: activeListingsProven ? "AVAILABLE" : "UNPROVEN",
    activeListingCount: activeListingsProven ? primaryListings.length : null,
    scopeId: livePortfolioIntegrity.canonicalCohort.scopeId,
    scopeCount: livePortfolioIntegrity.canonicalCohort.listingCount,
    scopeObservedAt: livePortfolioIntegrity.canonicalCohort.observedAt,
    identityStatus: livePortfolioIntegrity.canonicalCohort.identityStatus,
  })
  const operationalReviewGuard = {
    guardCode: "OPERATIONAL_REVIEW_FALSE_ZERO_GUARD" as const,
    status: operationalReview.falseZeroGuard.status,
    scopeId: operationalReview.scopeId,
    scopeType: operationalReview.scopeType,
    scopeCount: operationalReview.scopeCount,
    observedAt: operationalReview.observedAt,
    grain: "EBAY_LIVE_LISTING_OPERATIONAL_REVIEW_COUNT",
    evidenceCount: operationalReview.scopeCount,
    reasonCode: operationalReview.falseZeroGuard.reasonCode,
    guardAlwaysOn: true as const,
    independentOfAutomationThreshold: true as const,
    autoMutationAllowed: false as const,
  }
  const livePortfolioIntegrityWithOperationalReview = {
    ...livePortfolioIntegrity,
    deterministicGuards: [
      ...livePortfolioIntegrity.deterministicGuards.filter((guard) =>
        guard.guardCode !== "OPERATIONAL_REVIEW_FALSE_ZERO_GUARD"),
      operationalReviewGuard,
    ],
  }
  const tradingDiscoveryStatus = input.liveCertification.discovery.status
  const statusCounts = new Map<CommercialDecisionClass, number>()
  for (const decision of decisions) {
    const currentCount = statusCounts.get(decision.classification)
    statusCounts.set(
      decision.classification,
      currentCount === undefined ? 1 : currentCount + 1,
    )
  }
  const countStatus: CommercialMonitorCapabilityStatus = decisions.length
    ? "AVAILABLE"
    : "UNPROVEN"
  const priorityRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
  const priorityActionPlan = decisions.filter((row) =>
    row.recommendedAction !== "WAIT" &&
    !row.actionBlockedByInsufficientEvidence)
    .sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority])
    .slice(0, 12)
    .map((row) => ({
      listingKey: row.listingKey,
      classification: row.classification,
      priority: row.priority,
      recommendedAction: row.recommendedAction,
    }))
  const renderedCriticalAlertCount = priorityActionPlan.filter((row) =>
    row.priority === "CRITICAL" || row.priority === "HIGH").slice(0, 4).length
  const listingByKey = new Map(primaryListings.map((listing) =>
    [listing.key, listing] as const))
  const priorityListingKeys = [
    ...priorityActionPlan.map((row) => row.listingKey),
    ...decisions.map((decision) => decision.listingKey),
  ]
  const visiblePriorityItemIds = [...new Set(priorityListingKeys)]
    .flatMap((listingKey) => {
      const itemId = listingByKey.get(listingKey)?.identity.itemId
      return itemId ? [itemId] : []
    }).slice(0, 8)
  const monitorCoverage = buildMonitorCoverageTransparencyV1({
    scopeId: livePortfolioIntegrity.canonicalCohort.scopeId,
    scopeType: livePortfolioIntegrity.canonicalCohort.scopeType,
    observedAt: livePortfolioIntegrity.canonicalCohort.observedAt,
    listingCount: livePortfolioIntegrity.canonicalCohort.listingCount,
    itemIds: livePortfolioIntegrity.canonicalCohort.itemIds,
    identityStatus: livePortfolioIntegrity.canonicalCohort.identityStatus,
    visiblePriorityItemIds,
  })
  const recentSales = orders.recentSales ?? {
    contractVersion: "RECENT_SALES_FEED_V1" as const,
    status: "UNAVAILABLE" as const,
    resultCount: null,
    entries: [],
    maximumEntries: 10 as const,
    truncated: false,
    limitationCodes: ["PERSISTED_ORDER_EVENT_READ_NOT_AVAILABLE"],
    source: "PERSISTED_OFFICIAL_EBAY_ORDER_EVENTS" as const,
    buyerPiiIncluded: false as const,
  }
  const saleAlerts = input.saleAlerts ??
    createUnavailableSellerOsSaleAlertsReadV1(
      "DASHBOARD_CANONICAL_SALE_ALERTS_NOT_COLLECTED",
    )
  return {
    contractVersion: "COMMERCIAL_MONITOR_BACKEND_V1",
    mode: "READ_ONLY",
    capabilities: {
      sellerAccountBinding: input.liveCertification.account.bindingMatched
        ? "AVAILABLE"
        : input.liveCertification.account.bindingConfigured
          ? "PARTIAL"
          : "UNPROVEN",
      tradingDiscovery:
        tradingDiscoveryStatus === "UNKNOWN" ||
          tradingDiscoveryStatus === "INSUFFICIENT_EVIDENCE"
          ? "UNPROVEN"
          : tradingDiscoveryStatus,
      marketplaceCertification:
        input.liveCertification.discovery.coverage === "COMPLETE"
          ? "COMPLETE"
          : input.liveCertification.discovery.coverage,
      analytics: capabilityFromLiveStatus(input.liveCertification.analytics.status),
      registry: input.registry ?? {
        status: "UNPROVEN",
        currentLiveCount: null,
        matchedCount: null,
        humanReviewCount: null,
        coveragePercent: null,
        limitationCodes: ["REGISTRY_CERTIFICATION_NOT_AVAILABLE"],
      },
      ordersFulfillment: orders.status,
      listingQualityReport: quality.status,
      inventory: {
        status: "DEGRADED",
        oauthCapability: "AVAILABLE",
        locationsCapability: "AVAILABLE",
        inventoryItemsResource: "EBAY_REJECTED_25709_UNRESOLVED",
        representation: "UNPROVEN",
      },
    },
    kpis: {
      activeListings: {
        status: activeListingsProven ? "AVAILABLE" : "UNPROVEN",
        value: activeListingsProven ? primaryListings.length : null,
      },
      impressions: currentLiveImpressions,
      ebayViews: currentLiveViews,
      averageCtr: currentLiveCtr,
      quantitySold: currentLiveQuantitySold,
      orders: {
        status: orders.status,
        value: orders.orderCount,
      },
    },
    trafficScopes: {
      reconciliation: "EXPLICIT_SCOPE_SEPARATION",
      sellerHubEquivalence:
        "CONDITIONAL_ON_WINDOW_TIMEZONE_SCOPE_AND_REPORTING_LAG",
      accountTraffic,
      currentLivePortfolio: {
        scope: "CURRENT_LIVE_PORTFOLIO",
        scopeId: livePortfolioIntegrity.canonicalCohort.scopeId,
        scopeType: livePortfolioIntegrity.canonicalCohort.scopeType,
        scopeCount: livePortfolioIntegrity.canonicalCohort.listingCount,
        scopeObservedAt: livePortfolioIntegrity.canonicalCohort.observedAt,
        grain: "LISTING_WINDOW_AGGREGATE",
        source: "EBAY_TRADING_PLUS_SELL_ANALYTICS",
        windowStart: input.currentLiveWindowStart ?? null,
        windowEnd: input.currentLiveWindowEnd ?? null,
        timeZone: "UTC",
        observedAt: input.currentLiveObservedAt ?? null,
        completeness: activeListingsProven &&
            currentLiveImpressions.value !== null
          ? currentLiveImpressions.status
          : "UNPROVEN",
        activeListings: activeListingsProven ? primaryListings.length : null,
        impressions: currentLiveImpressions.value,
        listingViews: currentLiveViews.value,
        quantitySold: currentLiveQuantitySold.value,
        ctr: currentLiveCtr.value,
      },
    },
    livePortfolioIntegrity: livePortfolioIntegrityWithOperationalReview,
    orders: {
      ...orders,
      buyerPiiIncluded: false,
    },
    orderSourceHealth: buildOrderSourceHealthV1({
      status: orders.status === "AVAILABLE" || orders.status === "PARTIAL"
        ? orders.status
        : "UNAVAILABLE",
      permissionStatus: orders.status === "AVAILABLE" || orders.status === "PARTIAL"
        ? "PROVEN"
        : orders.status === "UNAVAILABLE_AUTH_PENDING"
          ? "UNPROVEN"
          : "UNAVAILABLE",
      pollIntervalMinutes: orders.pollIntervalMinutes ?? 5,
      observedAt: orders.sourceObservedAt ?? orders.latestOrderCreationAt,
      lastSuccessfulReadAt: orders.status === "AVAILABLE" || orders.status === "PARTIAL"
        ? orders.sourceObservedAt ?? orders.latestOrderCreationAt
        : null,
      limitationCodes: orders.status === "UNAVAILABLE_AUTH_PENDING"
        ? ["ORDER_PERMISSION_AUTHORIZATION_PENDING"]
        : orders.status === "UNAVAILABLE"
          ? ["ORDER_SOURCE_UNAVAILABLE"]
          : [],
    }),
    recentSales,
    saleAlerts,
    monitorCoverage,
    listingQualityReport: quality,
    decisions,
    guidanceVsSellerOs,
    operationalHealth: {
      manualReview: operationalReview,
      needIntervention: {
        status: countStatus,
        count: decisions.length
          ? decisions.filter((row) => row.recommendedAction !== "WAIT" &&
              !row.actionBlockedByInsufficientEvidence).length
          : null,
      },
      runningExperiments: {
        status: countStatus,
        count: decisions.length
          ? decisions.filter((row) => row.experimentRunning).length
          : null,
      },
      doNotTouch: {
        status: countStatus,
        count: decisions.length
          ? decisions.filter((row) => row.protectionState === "DO_NOT_TOUCH").length
          : null,
      },
      readyToEvaluate: {
        status: countStatus,
        count: decisions.length
          ? decisions.filter((row) =>
              row.experimentOperationalState === "READY_TO_EVALUATE").length
          : null,
      },
      externalSignalReview: {
        status: countStatus,
        count: decisions.length
          ? decisions.filter((row) => row.reasonCodes.includes(
              "EXTERNAL_SIGNAL_REVIEW",
            )).length
          : null,
      },
      stockRisk: {
        status: countStatus,
        count: decisions.length
          ? primaryListings.filter((listing) =>
              ["OUT_OF_STOCK_SIGNAL", "CERTIFIED_OOS"].includes(
                listing.stock?.state ?? "")).length
          : null,
      },
      stockUnknown: {
        status: countStatus,
        count: decisions.length
          ? primaryListings.filter((listing) =>
              listing.stock?.state === "STOCK_UNKNOWN").length
          : null,
      },
      dataQuality: {
        status: countStatus,
        count: decisions.length
          ? decisions.filter((row) => row.classification === "DATA_QUALITY").length
          : null,
      },
      ebayRecommendations: {
        status: quality.status,
        count: quality.status === "UNAVAILABLE_NO_CURRENT_REPORT" ||
            quality.status === "UNPROVEN"
          ? null
          : quality.recommendations.length,
      },
      waitingHealthy: {
        status: countStatus,
        count: decisions.length
          ? decisions.filter((row) => row.classification === "HEALTHY_WAIT").length
          : null,
      },
      criticalAlerts: {
        status: "AVAILABLE",
        count: renderedCriticalAlertCount,
      },
      priorityActionPlan,
      upcomingReviews: decisions.flatMap((row) => row.nextReviewCondition
        ? [{
            listingKey: row.listingKey,
            condition: row.nextReviewCondition,
            reviewAt: row.nextReviewAt,
          }]
        : []),
      performanceSeries,
      statusDistribution: [...statusCounts.entries()].map(
        ([classification, count]) => ({ classification, count })),
      categoryBenchmarks: quality.recommendations.flatMap((row) =>
        row.topCategoryBenchmark === null
          ? []
          : [{
              recommendationCategory: row.recommendationCategory,
              benchmark: row.topCategoryBenchmark,
              source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
            }]),
    },
    safety: {
      marketplaceWrites: 0,
      registryWrites: 0,
      fulfillmentWrites: 0,
      buyerMessages: 0,
      guidanceAutoExecution: false,
      decisionExecution: false,
      syntheticChartData: false,
    },
  }
}
