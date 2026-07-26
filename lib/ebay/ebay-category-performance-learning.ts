import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { getEbaySellerAccountScopeConfiguration } from "./ebay-seller-account-scope.ts"
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { normalizeEbaySellerTrafficReport } from "./ebay-seller-traffic-report.ts"
import type { EbayCategoryLearningAdjustmentInput } from "./ebay-luna-opportunity-types"

export const EBAY_CATEGORY_LEARNING_MODEL_VERSION =
  "EBAY-CATEGORY-PERFORMANCE-CALIBRATION-V2"

export const EBAY_CATEGORY_LEARNING_SOURCE =
  "EBAY_SELL_ANALYTICS_READONLY" as const

export const EBAY_CATEGORY_LEARNING_PREVIEW_BRANCH =
  "feature/centralize-ebay-mobile-center"

const EBAY_CATEGORY_LEARNING_STAGING_REF = "vsfthqydfrdzulldbfbe"

export const EBAY_CATEGORY_LEARNING_POLICY = Object.freeze({
  minimumLinkedListings: 10,
  minimumObservationDays: 14,
  minimumTotalImpressions: 500,
  maximumAdjustmentPoints: 5,
  fullReliabilityLinkedListings: 20,
  fullReliabilityObservationDays: 28,
  fullReliabilityImpressions: 2_000,
  neutralClickThroughRatePercent: 3,
  neutralSalesConversionRatePercent: 4,
  clickThroughWeight: 0.4,
  salesConversionWeight: 0.6,
})

const DAY_MS = 86_400_000
const OWN_LISTING_VERIFICATION_MAX_AGE_MS = 36 * 60 * 60 * 1_000
const LEARNING_ADJUSTMENT_MAX_AGE_MS = 36 * 60 * 60 * 1_000
const LEARNING_ADJUSTMENT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000

type LearningSnapshot = {
  manualListingLinkId: string
  accountKey: string
  ebayItemId: string
  categoryId: string
  predictedOpportunityScore: number
  predictedEngineVersion: string
  predictionSource: string
  windowDays: number
  listingAgeDays: number
  totalImpressions: number
  searchImpressions: number | null
  totalViews: number | null
  searchViews: number | null
  transactions: number | null
  observedAt: string
  source: string
  ownershipVerified: boolean
}

export type EbayCategoryLearningEvaluation = {
  accountKey: string
  marketplaceId: "EBAY_US"
  categoryId: string
  modelVersion: string
  predictionEngineVersion: string
  status: "COLLECTING" | "ELIGIBLE_APPLIED"
  eligible: boolean
  adjustmentPoints: number
  sampleListingCount: number
  totalImpressions: number
  minimumObservationDays: number
  weightedPredictedScore: number | null
  observedPerformanceScore: number | null
  clickThroughRatePercent: number | null
  salesConversionRatePercent: number | null
  applicablePerformanceSignalAvailable: boolean
  reliabilityFactor: number
  remainingRequirements: {
    linkedListings: number
    observationDays: number
    totalImpressions: number
  }
  policy: typeof EBAY_CATEGORY_LEARNING_POLICY
  source: typeof EBAY_CATEGORY_LEARNING_SOURCE
  computedAt: string
}

type PersistPerformanceInput = {
  dateFrom: string
  dateTo: string
  listingIds?: string[]
  observedAt?: string | Date
  environment?: NodeJS.ProcessEnv
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function nonNegative(value: unknown) {
  const parsed = finiteNumber(value)
  return parsed !== null && parsed >= 0 ? parsed : 0
}

function nonNegativeOrNull(value: unknown) {
  const parsed = finiteNumber(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function validTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

export function getEbayCategoryLearningActivationConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  let detectedRef: string | null = null
  try {
    detectedRef = new URL(environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "")
      .hostname.split(".")[0] || null
  } catch {
    detectedRef = null
  }
  const explicitlyEnabled =
    environment.EBAY_CATEGORY_PERFORMANCE_LEARNING_PREVIEW_ENABLED?.trim() === "true"
  const preview = environment.VERCEL_ENV === "preview"
  const staging = detectedRef === EBAY_CATEGORY_LEARNING_STAGING_REF
  const authorizedBranch =
    environment.VERCEL_GIT_COMMIT_REF === EBAY_CATEGORY_LEARNING_PREVIEW_BRANCH
  const active = explicitlyEnabled && preview && staging && authorizedBranch
  return {
    status: active ? "ACTIVE_PREVIEW_ONLY" as const : "DISABLED" as const,
    active,
    explicitlyEnabled,
    preview,
    staging,
    authorizedBranch,
    detectedRef,
    expectedRef: EBAY_CATEGORY_LEARNING_STAGING_REF,
    expectedBranch: EBAY_CATEGORY_LEARNING_PREVIEW_BRANCH,
    safety: {
      previewOnly: true as const,
      verifiedOwnListingsOnly: true as const,
      ebayReadOnly: true as const,
      ebayWrites: 0 as const,
      openAiCalls: 0 as const,
      automaticPriceChanges: 0 as const,
      automaticDeployments: 0 as const,
      maximumAdjustmentPoints:
        EBAY_CATEGORY_LEARNING_POLICY.maximumAdjustmentPoints,
    },
  }
}

function validDateOnly(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null
  const parsed = new Date(`${normalized}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized
    ? normalized
    : null
}

function reportCoverageDate(value: unknown) {
  const dateOnly = validDateOnly(value)
  if (dateOnly) return dateOnly
  const timestamp = validTimestamp(value)
  return timestamp?.slice(0, 10) ?? null
}

export function evaluateEbayAnalyticsReportCoverage(input: {
  requestedDateFrom: unknown
  requestedDateTo: unknown
  reportDateFrom: unknown
  reportDateTo: unknown
  lastUpdatedDate: unknown
}) {
  const requestedDateFrom = validDateOnly(input.requestedDateFrom)
  const requestedDateTo = validDateOnly(input.requestedDateTo)
  if (!requestedDateFrom || !requestedDateTo || requestedDateTo < requestedDateFrom) {
    throw new Error("EBAY_CATEGORY_LEARNING_DATE_RANGE_INVALID")
  }
  const reportDateFrom = validDateOnly(input.reportDateFrom)
  const reportDateTo = validDateOnly(input.reportDateTo)
  const lastUpdatedDate = reportCoverageDate(input.lastUpdatedDate)
  if (!reportDateFrom || !reportDateTo || reportDateTo < reportDateFrom) {
    return {
      complete: false as const,
      requestedDateFrom,
      requestedDateTo,
      reportDateFrom,
      reportDateTo,
      lastUpdatedDate,
      reason: "OFFICIAL_REPORT_WINDOW_MISSING_OR_INVALID" as const,
    }
  }
  if (
    !lastUpdatedDate ||
    lastUpdatedDate < requestedDateTo ||
    reportDateFrom > requestedDateFrom ||
    reportDateTo < requestedDateTo
  ) {
    return {
      complete: false as const,
      requestedDateFrom,
      requestedDateTo,
      reportDateFrom,
      reportDateTo,
      lastUpdatedDate,
      reason: "OFFICIAL_REPORT_NOT_FINALIZED_OR_INCOMPLETE" as const,
    }
  }
  return {
    complete: true as const,
    requestedDateFrom,
    requestedDateTo,
    reportDateFrom,
    reportDateTo,
    lastUpdatedDate,
    reason: null,
  }
}

function inclusiveDays(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`).getTime()
  const end = new Date(`${to}T00:00:00Z`).getTime()
  return Math.max(0, Math.floor((end - start) / DAY_MS) + 1)
}

function elapsedDays(from: string, to: string) {
  const start = new Date(from).getTime()
  const end = new Date(to).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, Math.floor((end - start) / DAY_MS))
}

function safeRate(numerator: number, denominator: number) {
  return denominator > 0 ? round((numerator / denominator) * 100, 4) : null
}

function latestPerListing(snapshots: LearningSnapshot[]) {
  const latest = new Map<string, LearningSnapshot>()
  for (const snapshot of [...snapshots].sort((left, right) =>
    new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime()
  )) {
    if (!latest.has(snapshot.manualListingLinkId)) {
      latest.set(snapshot.manualListingLinkId, snapshot)
    }
  }
  return [...latest.values()]
}

/**
 * Evaluates one category and one prediction-engine cohort. Repeated snapshots
 * never inflate the sample: only the newest observation of each seller-owned,
 * verified listing is considered.
 */
export function evaluateEbayCategoryLearning(input: {
  accountKey: string
  categoryId: string
  predictionEngineVersion: string
  snapshots: LearningSnapshot[]
  computedAt?: string | Date
}): EbayCategoryLearningEvaluation {
  const computedAt = input.computedAt instanceof Date
    ? input.computedAt.toISOString()
    : validTimestamp(input.computedAt) ?? new Date().toISOString()
  const trustedLatest = latestPerListing(input.snapshots)
    .filter((snapshot) =>
      snapshot.accountKey === input.accountKey &&
      snapshot.categoryId === input.categoryId &&
      snapshot.predictedEngineVersion === input.predictionEngineVersion &&
      snapshot.predictionSource === "LINK_TIME_OPPORTUNITY_QUEUE" &&
      snapshot.ownershipVerified === true &&
      snapshot.source === EBAY_CATEGORY_LEARNING_SOURCE &&
      /^\d{9,20}$/.test(snapshot.ebayItemId) &&
      Number.isFinite(snapshot.predictedOpportunityScore) &&
      snapshot.predictedOpportunityScore >= 0 &&
      snapshot.predictedOpportunityScore <= 100
    )

  const sampleListingCount = trustedLatest.length
  const totalImpressions = round(trustedLatest.reduce(
    (total, snapshot) => total + nonNegative(snapshot.totalImpressions),
    0,
  ))
  const minimumObservationDays = trustedLatest.length
    ? Math.min(...trustedLatest.map((snapshot) => Math.max(
        0,
        Math.min(
          Math.floor(nonNegative(snapshot.windowDays)),
          Math.floor(nonNegative(snapshot.listingAgeDays)),
        ),
      )))
    : 0
  const thresholdsSatisfied =
    sampleListingCount >= EBAY_CATEGORY_LEARNING_POLICY.minimumLinkedListings &&
    minimumObservationDays >= EBAY_CATEGORY_LEARNING_POLICY.minimumObservationDays &&
    totalImpressions >= EBAY_CATEGORY_LEARNING_POLICY.minimumTotalImpressions

  let totalSearchImpressions = 0
  let totalSearchViews = 0
  let totalViews = 0
  let totalTransactions = 0
  let hasApplicableClickThroughCounts = false
  let hasApplicableConversionCounts = false
  for (const snapshot of trustedLatest) {
    if (
      snapshot.searchImpressions !== null &&
      snapshot.searchViews !== null
    ) {
      hasApplicableClickThroughCounts = true
      totalSearchImpressions += snapshot.searchImpressions
      totalSearchViews += snapshot.searchViews
    }
    if (snapshot.totalViews !== null && snapshot.transactions !== null) {
      hasApplicableConversionCounts = true
      totalViews += snapshot.totalViews
      totalTransactions += snapshot.transactions
    }
  }
  const clickThroughRatePercent = hasApplicableClickThroughCounts
    ? safeRate(totalSearchViews, totalSearchImpressions)
    : null
  const salesConversionRatePercent = hasApplicableConversionCounts
    ? safeRate(totalTransactions, totalViews)
    : null
  // A score of 50 is the configured seller benchmark. Zero performance maps
  // to 0 and performance at twice the benchmark maps to 100. Keeping the
  // benchmark at the center prevents a category that merely meets the neutral
  // rate from receiving an automatic positive ranking adjustment.
  const ctrScore = clickThroughRatePercent === null
    ? null
    : clamp(
        50 + (
          (clickThroughRatePercent -
            EBAY_CATEGORY_LEARNING_POLICY.neutralClickThroughRatePercent) /
          EBAY_CATEGORY_LEARNING_POLICY.neutralClickThroughRatePercent
        ) * 50,
        0,
        100,
      )
  const conversionScore = salesConversionRatePercent === null
    ? null
    : clamp(
        50 + (
          (salesConversionRatePercent -
            EBAY_CATEGORY_LEARNING_POLICY.neutralSalesConversionRatePercent) /
          EBAY_CATEGORY_LEARNING_POLICY.neutralSalesConversionRatePercent
        ) * 50,
        0,
        100,
      )
  const availablePerformanceWeight =
    (clickThroughRatePercent === null
      ? 0
      : EBAY_CATEGORY_LEARNING_POLICY.clickThroughWeight) +
    (salesConversionRatePercent === null
      ? 0
      : EBAY_CATEGORY_LEARNING_POLICY.salesConversionWeight)
  const observedPerformanceScore = availablePerformanceWeight > 0
    ? round((
        (ctrScore ?? 0) * (clickThroughRatePercent === null
          ? 0
          : EBAY_CATEGORY_LEARNING_POLICY.clickThroughWeight) +
        (conversionScore ?? 0) * (salesConversionRatePercent === null
          ? 0
          : EBAY_CATEGORY_LEARNING_POLICY.salesConversionWeight)
      ) / availablePerformanceWeight)
    : null
  const eligible = thresholdsSatisfied && observedPerformanceScore !== null
  const predictionWeight = trustedLatest.reduce(
    (total, snapshot) => total + Math.max(1, nonNegative(snapshot.totalImpressions)),
    0,
  )
  const weightedPredictedScore = predictionWeight > 0
    ? round(trustedLatest.reduce(
        (total, snapshot) => total +
          snapshot.predictedOpportunityScore * Math.max(1, nonNegative(snapshot.totalImpressions)),
        0,
      ) / predictionWeight)
    : null
  const reliabilityFactor = eligible
    ? round(Math.min(
        1,
        sampleListingCount /
          EBAY_CATEGORY_LEARNING_POLICY.fullReliabilityLinkedListings,
        minimumObservationDays /
          EBAY_CATEGORY_LEARNING_POLICY.fullReliabilityObservationDays,
        totalImpressions /
          EBAY_CATEGORY_LEARNING_POLICY.fullReliabilityImpressions,
      ), 4)
    : 0
  const unboundedAdjustment = observedPerformanceScore !== null
    ? ((observedPerformanceScore - 50) / 50) *
      EBAY_CATEGORY_LEARNING_POLICY.maximumAdjustmentPoints *
      reliabilityFactor
    : 0
  const adjustmentPoints = eligible
    ? round(clamp(
        unboundedAdjustment,
        -EBAY_CATEGORY_LEARNING_POLICY.maximumAdjustmentPoints,
        EBAY_CATEGORY_LEARNING_POLICY.maximumAdjustmentPoints,
      ))
    : 0

  return {
    accountKey: input.accountKey,
    marketplaceId: "EBAY_US",
    categoryId: input.categoryId,
    modelVersion: EBAY_CATEGORY_LEARNING_MODEL_VERSION,
    predictionEngineVersion: input.predictionEngineVersion,
    status: eligible ? "ELIGIBLE_APPLIED" : "COLLECTING",
    eligible,
    adjustmentPoints,
    sampleListingCount,
    totalImpressions,
    minimumObservationDays,
    weightedPredictedScore,
    observedPerformanceScore,
    clickThroughRatePercent,
    salesConversionRatePercent,
    applicablePerformanceSignalAvailable:
      observedPerformanceScore !== null,
    reliabilityFactor,
    remainingRequirements: {
      linkedListings: Math.max(
        0,
        EBAY_CATEGORY_LEARNING_POLICY.minimumLinkedListings - sampleListingCount,
      ),
      observationDays: Math.max(
        0,
        EBAY_CATEGORY_LEARNING_POLICY.minimumObservationDays - minimumObservationDays,
      ),
      totalImpressions: Math.max(
        0,
        EBAY_CATEGORY_LEARNING_POLICY.minimumTotalImpressions - totalImpressions,
      ),
    },
    policy: EBAY_CATEGORY_LEARNING_POLICY,
    source: EBAY_CATEGORY_LEARNING_SOURCE,
    computedAt,
  }
}

export function getEbayCategoryLearningAccountKey() {
  const configuration = getEbaySellerAccountScopeConfiguration()
  if (configuration.configured && configuration.accountKey) {
    return configuration.accountKey
  }
  const invalid = configuration.reason === "ACCOUNT_KEY_INVALID" ||
    configuration.reason === "OFFICIAL_ACCOUNT_IDENTITY_INCONSISTENT"
  throw new Error(invalid
    ? "EBAY_CATEGORY_LEARNING_ACCOUNT_SCOPE_INVALID"
    : "EBAY_CATEGORY_LEARNING_ACCOUNT_SCOPE_REQUIRED")
}

function metricCount(
  row: { metrics: Record<string, number | null>; applicability: Record<string, boolean> },
  key: string,
) {
  if (row.applicability[key] !== true) return null
  const parsed = finiteNumber(row.metrics[key])
  return parsed !== null && parsed >= 0 ? Math.floor(parsed) : null
}

function metricRate(
  row: { metrics: Record<string, number | null>; applicability: Record<string, boolean> },
  key: string,
) {
  if (row.applicability[key] !== true) return null
  const parsed = finiteNumber(row.metrics[key])
  return parsed !== null && parsed >= 0 && parsed <= 100 ? parsed : null
}

function mapStoredSnapshot(row: Record<string, unknown>): LearningSnapshot {
  return {
    manualListingLinkId: String(row.manual_listing_link_id ?? ""),
    accountKey: String(row.account_key ?? ""),
    ebayItemId: String(row.ebay_item_id ?? ""),
    categoryId: String(row.category_id ?? ""),
    predictedOpportunityScore:
      finiteNumber(row.predicted_opportunity_score) ?? Number.NaN,
    predictedEngineVersion: String(row.predicted_engine_version ?? ""),
    predictionSource: String(row.prediction_source ?? ""),
    windowDays: nonNegative(row.window_days),
    listingAgeDays: nonNegative(row.listing_age_days),
    totalImpressions: nonNegative(row.total_impressions),
    searchImpressions: nonNegativeOrNull(row.search_impressions),
    totalViews: nonNegativeOrNull(row.total_views),
    searchViews: nonNegativeOrNull(row.search_views),
    transactions: nonNegativeOrNull(row.transactions),
    observedAt: String(row.observed_at ?? ""),
    source: String(row.source ?? ""),
    ownershipVerified: true,
  }
}

function adjustmentEvidence(evaluation: EbayCategoryLearningEvaluation) {
  return {
    performanceSource: evaluation.source,
    ownSellerAccountOnly: true,
    competitorDataUsed: false,
    latestSnapshotPerLinkedListing: true,
    linkTimePredictionOnly: true,
    backfilledPredictionsExcluded: true,
    scoreFormula: {
      observed:
        "Benchmark-centered score: 50 at CTR 3% and conversion 4%; 40% CTR + 60% conversion with only applicable metrics reweighted",
      adjustment:
        "(observed benchmark score - 50) / 50 x 5 x reliability",
      maximumAbsolutePoints: EBAY_CATEGORY_LEARNING_POLICY.maximumAdjustmentPoints,
    },
    rates: {
      clickThroughRatePercent: evaluation.clickThroughRatePercent,
      salesConversionRatePercent: evaluation.salesConversionRatePercent,
      applicablePerformanceSignalAvailable:
        evaluation.applicablePerformanceSignalAvailable,
    },
    remainingRequirements: evaluation.remainingRequirements,
    policy: evaluation.policy,
  }
}

/** Persist only official LISTING-dimension rows joined to verified own listings. */
export async function persistOwnEbayPerformanceSnapshots(
  supabase: SupabaseClient,
  rawReport: unknown,
  input: PersistPerformanceInput,
) {
  const activation = getEbayCategoryLearningActivationConfiguration(
    input.environment ?? process.env,
  )
  if (!activation.active) {
    return {
      status: "PREVIEW_LEARNING_DISABLED" as const,
      snapshotCount: 0,
      verifiedLinkedListingCount: 0,
      skippedUnlinkedListingCount: 0,
      categoryLearning: [] as EbayCategoryLearningEvaluation[],
      minimums: EBAY_CATEGORY_LEARNING_POLICY,
      rankingAdjustmentApplied: false as const,
      persistencePerformed: false as const,
      activation,
    }
  }
  const dashboard = normalizeEbaySellerTrafficReport(rawReport)
  if (dashboard.dimension !== "LISTING") {
    return {
      status: "LISTING_DIMENSION_REQUIRED" as const,
      snapshotCount: 0,
      verifiedLinkedListingCount: 0,
      skippedUnlinkedListingCount: dashboard.rows.length,
      categoryLearning: [] as EbayCategoryLearningEvaluation[],
      minimums: EBAY_CATEGORY_LEARNING_POLICY,
    }
  }

  const observedAt = input.observedAt === undefined
    ? new Date().toISOString()
    : input.observedAt instanceof Date && Number.isFinite(input.observedAt.getTime())
      ? input.observedAt.toISOString()
      : validTimestamp(input.observedAt)
  if (!observedAt) {
    throw new Error("EBAY_CATEGORY_LEARNING_OBSERVED_AT_INVALID")
  }
  const reportCoverage = evaluateEbayAnalyticsReportCoverage({
    requestedDateFrom: input.dateFrom,
    requestedDateTo: input.dateTo,
    reportDateFrom: dashboard.startDate,
    reportDateTo: dashboard.endDate,
    lastUpdatedDate: dashboard.lastUpdatedDate,
  })
  if (!reportCoverage.complete) {
    return {
      status: "REPORT_NOT_FINALIZED" as const,
      snapshotCount: 0,
      verifiedLinkedListingCount: 0,
      skippedUnlinkedListingCount: dashboard.rows.length,
      categoryLearning: [] as EbayCategoryLearningEvaluation[],
      minimums: EBAY_CATEGORY_LEARNING_POLICY,
      reportCoverage,
      rankingAdjustmentApplied: false as const,
    }
  }
  const { reportDateFrom, reportDateTo } = reportCoverage
  const windowDays = inclusiveDays(reportDateFrom, reportDateTo)
  if (windowDays < 1 || windowDays > 90) {
    throw new Error("EBAY_CATEGORY_LEARNING_DATE_RANGE_INVALID")
  }
  const accountKey = getEbayCategoryLearningAccountKey()
  const verificationFreshnessCutoff = new Date(
    Date.parse(observedAt) - OWN_LISTING_VERIFICATION_MAX_AGE_MS,
  ).toISOString()
  const reportListingIds = [...new Set(dashboard.rows
    .map((row) => row.dimension)
    .filter((listingId) => /^\d{9,20}$/.test(listingId)))]
  if (!reportListingIds.length) {
    return {
      status: "NO_LISTING_ROWS" as const,
      snapshotCount: 0,
      verifiedLinkedListingCount: 0,
      skippedUnlinkedListingCount: dashboard.rows.length,
      categoryLearning: [] as EbayCategoryLearningEvaluation[],
      minimums: EBAY_CATEGORY_LEARNING_POLICY,
    }
  }

  const { data: linksData, error: linksError } = await supabase
    .from("ebay_manual_listing_links")
    .select("id,account_key,marketplace_id,ebay_item_id,opportunity_id,candidate_key,verification_status,verification_method,verified_at,last_verification_at,safe_defaults,predicted_opportunity_score,predicted_engine_version,predicted_category_id,prediction_source")
    .eq("account_key", accountKey)
    .eq("marketplace_id", "EBAY_US")
    .eq("verification_status", "verified")
    .gte("last_verification_at", verificationFreshnessCutoff)
    .in("ebay_item_id", reportListingIds)
  if (linksError) throw new Error("EBAY_CATEGORY_LEARNING_LINK_READ_FAILED")

  const links = (linksData ?? []) as Array<Record<string, unknown>>
  const linksByItem = new Map(links.map((link) => [String(link.ebay_item_id), link]))
  const rowsByItem = new Map(dashboard.rows.map((row) => [row.dimension, row]))
  let preVerificationWindowLinkCount = 0
  const reportWindowStartedAt = Date.parse(`${reportDateFrom}T00:00:00.000Z`)
  const snapshots = links.flatMap((link) => {
    const ebayItemId = String(link.ebay_item_id ?? "")
    const row = rowsByItem.get(ebayItemId)
    const verifiedAt = validTimestamp(link.verified_at)
    const predictedScore = finiteNumber(link.predicted_opportunity_score)
    const predictedEngineVersion = String(link.predicted_engine_version ?? "").trim()
    const safeDefaults = record(link.safe_defaults)
    const sellerListingCategory = String(safeDefaults.categoryId ?? "").trim()
    const categoryIdValue =
      link.verification_method === "EBAY_TRADING_GET_ITEM_READONLY" &&
      /^\d{1,20}$/.test(sellerListingCategory)
      ? sellerListingCategory
      : String(link.predicted_category_id ?? "").trim()
    const categoryId = /^\d{1,20}$/.test(categoryIdValue)
      ? categoryIdValue
      : null
    const predictionSource = String(link.prediction_source ?? "").trim()
    const totalImpressions = row
      ? metricCount(row, "TOTAL_IMPRESSION_TOTAL")
      : null
    if (
      verifiedAt &&
      Number.isFinite(reportWindowStartedAt) &&
      Date.parse(verifiedAt) > reportWindowStartedAt
    ) {
      preVerificationWindowLinkCount += 1
      return []
    }
    if (
      !row || !verifiedAt || predictedScore === null || predictedScore < 0 ||
      predictedScore > 100 || !predictedEngineVersion ||
      !predictionSource || totalImpressions === null
    ) return []
    const fingerprint = createHash("sha256").update([
      link.id,
      reportDateFrom,
      reportDateTo,
      dashboard.lastUpdatedDate ?? "not-reported",
    ].join(":"), "utf8").digest("hex")
    return [{
      manual_listing_link_id: link.id,
      opportunity_id: link.opportunity_id,
      account_key: accountKey,
      marketplace_id: "EBAY_US",
      ebay_item_id: ebayItemId,
      candidate_key: link.candidate_key,
      category_id: categoryId,
      predicted_opportunity_score: predictedScore,
      predicted_engine_version: predictedEngineVersion,
      prediction_source: predictionSource,
      report_date_from: reportDateFrom,
      report_date_to: reportDateTo,
      window_days: windowDays,
      listing_age_days: elapsedDays(verifiedAt, observedAt),
      total_impressions: totalImpressions,
      search_impressions: metricCount(row, "LISTING_IMPRESSION_SEARCH_RESULTS_PAGE"),
      total_views: metricCount(row, "LISTING_VIEWS_TOTAL"),
      search_views: metricCount(row, "LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE"),
      transactions: metricCount(row, "TRANSACTION"),
      reported_click_through_rate: metricRate(row, "CLICK_THROUGH_RATE"),
      reported_sales_conversion_rate: metricRate(row, "SALES_CONVERSION_RATE"),
      ebay_last_updated_at: validTimestamp(dashboard.lastUpdatedDate),
      observed_at: observedAt,
      source: EBAY_CATEGORY_LEARNING_SOURCE,
      snapshot_fingerprint: fingerprint,
    }]
  })

  if (!snapshots.length) {
    return {
      status: preVerificationWindowLinkCount > 0
        ? "CAUSAL_WINDOW_REQUIRED" as const
        : "VERIFIED_PREDICTION_LINK_REQUIRED" as const,
      snapshotCount: 0,
      verifiedLinkedListingCount: links.length,
      skippedUnlinkedListingCount: reportListingIds.length - linksByItem.size,
      preVerificationWindowLinkCount,
      categoryLearning: [] as EbayCategoryLearningEvaluation[],
      minimums: EBAY_CATEGORY_LEARNING_POLICY,
    }
  }

  const { error: snapshotError } = await supabase
    .from("ebay_listing_performance_snapshots")
    .upsert(snapshots, { onConflict: "snapshot_fingerprint" })
  if (snapshotError) throw new Error("EBAY_CATEGORY_LEARNING_SNAPSHOT_WRITE_FAILED")

  const cohorts = [...new Set(snapshots.flatMap((snapshot) =>
    snapshot.category_id
      ? [`${snapshot.category_id}\u0000${snapshot.predicted_engine_version}`]
      : []
  ))].map((value) => {
    const [categoryId, predictionEngineVersion] = value.split("\u0000")
    return { categoryId, predictionEngineVersion }
  })
  const categoryLearning: EbayCategoryLearningEvaluation[] = []
  for (const cohort of cohorts) {
    const { data: storedData, error: storedError } = await supabase
      .from("ebay_listing_performance_snapshots")
      .select("manual_listing_link_id,account_key,ebay_item_id,category_id,predicted_opportunity_score,predicted_engine_version,prediction_source,window_days,listing_age_days,total_impressions,search_impressions,total_views,search_views,transactions,observed_at,source")
      .eq("account_key", accountKey)
      .eq("marketplace_id", "EBAY_US")
      .eq("category_id", cohort.categoryId)
      .eq("predicted_engine_version", cohort.predictionEngineVersion)
      .order("observed_at", { ascending: false })
      .limit(5_000)
    if (storedError) throw new Error("EBAY_CATEGORY_LEARNING_SNAPSHOT_READ_FAILED")
    const evaluation = evaluateEbayCategoryLearning({
      accountKey,
      categoryId: cohort.categoryId,
      predictionEngineVersion: cohort.predictionEngineVersion,
      snapshots: ((storedData ?? []) as Array<Record<string, unknown>>)
        .map(mapStoredSnapshot),
      computedAt: observedAt,
    })
    categoryLearning.push(evaluation)
    const { error: adjustmentError } = await supabase
      .from("ebay_category_learning_adjustments")
      .upsert({
        account_key: evaluation.accountKey,
        marketplace_id: evaluation.marketplaceId,
        category_id: evaluation.categoryId,
        model_version: evaluation.modelVersion,
        prediction_engine_version: evaluation.predictionEngineVersion,
        status: evaluation.status,
        eligible: evaluation.eligible,
        adjustment_points: evaluation.adjustmentPoints,
        sample_listing_count: evaluation.sampleListingCount,
        total_impressions: evaluation.totalImpressions,
        minimum_observation_days: evaluation.minimumObservationDays,
        weighted_predicted_score: evaluation.weightedPredictedScore,
        observed_performance_score: evaluation.observedPerformanceScore,
        reliability_factor: evaluation.reliabilityFactor,
        source: evaluation.source,
        evidence: adjustmentEvidence(evaluation),
        computed_at: evaluation.computedAt,
        updated_at: evaluation.computedAt,
      }, {
        onConflict:
          "account_key,marketplace_id,category_id,model_version,prediction_engine_version",
      })
    if (adjustmentError) throw new Error("EBAY_CATEGORY_LEARNING_ADJUSTMENT_WRITE_FAILED")
  }

  return {
    status: categoryLearning.some((evaluation) => evaluation.eligible)
      ? "ELIGIBLE_ADJUSTMENT_RECALCULATED" as const
      : "COLLECTING" as const,
    snapshotCount: snapshots.length,
    verifiedLinkedListingCount: links.length,
    skippedUnlinkedListingCount: reportListingIds.length - linksByItem.size,
    preVerificationWindowLinkCount,
    categoryLearning,
    minimums: EBAY_CATEGORY_LEARNING_POLICY,
  }
}

/** Read-only projection for dashboards. Viewing Analytics never trains. */
export async function loadStoredEbayCategoryLearningState(
  supabase: SupabaseClient,
  predictionEngineVersion: string,
) {
  const accountKey = getEbayCategoryLearningAccountKey()
  const { data, error } = await supabase
    .from("ebay_category_learning_adjustments")
    .select("account_key,marketplace_id,category_id,model_version,prediction_engine_version,status,eligible,adjustment_points,sample_listing_count,total_impressions,minimum_observation_days,source,computed_at")
    .eq("account_key", accountKey)
    .eq("marketplace_id", "EBAY_US")
    .eq("model_version", EBAY_CATEGORY_LEARNING_MODEL_VERSION)
    .eq("prediction_engine_version", predictionEngineVersion)
    .order("computed_at", { ascending: false })
    .limit(200)
  if (error) throw new Error("EBAY_CATEGORY_LEARNING_STATE_READ_FAILED")

  const categoryLearning = ((data ?? []) as Array<Record<string, unknown>>)
    .flatMap((row) => {
      const categoryId = String(row.category_id ?? "")
      const sampleListingCount = Math.floor(nonNegative(row.sample_listing_count))
      const totalImpressions = Math.floor(nonNegative(row.total_impressions))
      const minimumObservationDays = Math.floor(nonNegative(row.minimum_observation_days))
      const eligible = row.status === "ELIGIBLE_APPLIED" && row.eligible === true
      const adjustmentPoints = finiteNumber(row.adjustment_points)
      const computedAt = validTimestamp(row.computed_at)
      if (
        !/^\d{1,20}$/.test(categoryId) || adjustmentPoints === null ||
        !computedAt || row.source !== EBAY_CATEGORY_LEARNING_SOURCE ||
        row.model_version !== EBAY_CATEGORY_LEARNING_MODEL_VERSION ||
        row.prediction_engine_version !== predictionEngineVersion
      ) return []
      return [{
        categoryId,
        status: eligible ? "ELIGIBLE_APPLIED" as const : "COLLECTING" as const,
        eligible,
        adjustmentPoints: eligible
          ? clamp(
              adjustmentPoints,
              -EBAY_CATEGORY_LEARNING_POLICY.maximumAdjustmentPoints,
              EBAY_CATEGORY_LEARNING_POLICY.maximumAdjustmentPoints,
            )
          : 0,
        sampleListingCount,
        totalImpressions,
        minimumObservationDays,
        remainingRequirements: {
          linkedListings: Math.max(
            0,
            EBAY_CATEGORY_LEARNING_POLICY.minimumLinkedListings - sampleListingCount,
          ),
          observationDays: Math.max(
            0,
            EBAY_CATEGORY_LEARNING_POLICY.minimumObservationDays - minimumObservationDays,
          ),
          totalImpressions: Math.max(
            0,
            EBAY_CATEGORY_LEARNING_POLICY.minimumTotalImpressions - totalImpressions,
          ),
        },
        computedAt,
      }]
    })

  return {
    status: categoryLearning.some((item) => item.eligible)
      ? "STORED_ELIGIBLE_ADJUSTMENTS" as const
      : categoryLearning.length
        ? "STORED_COLLECTING" as const
        : "NO_STORED_LEARNING" as const,
    persistencePerformed: false as const,
    trainingTriggered: false as const,
    automaticCollectionOnly: true as const,
    accountKey,
    modelVersion: EBAY_CATEGORY_LEARNING_MODEL_VERSION,
    predictionEngineVersion,
    categoryLearning,
    minimums: EBAY_CATEGORY_LEARNING_POLICY,
  }
}

export async function loadEbayCategoryLearningAdjustments(
  supabase: SupabaseClient,
  predictionEngineVersion: string,
  options: { now?: string | Date; environment?: NodeJS.ProcessEnv } = {},
) {
  const activation = getEbayCategoryLearningActivationConfiguration(
    options.environment ?? process.env,
  )
  if (!activation.active) return {}
  const accountKey = getEbayCategoryLearningAccountKey()
  const now = options.now instanceof Date
    ? options.now
    : new Date(options.now ?? Date.now())
  if (!Number.isFinite(now.getTime())) {
    throw new Error("EBAY_CATEGORY_LEARNING_OBSERVED_AT_INVALID")
  }
  const freshnessCutoffMs = now.getTime() - LEARNING_ADJUSTMENT_MAX_AGE_MS
  const maximumComputedAtMs =
    now.getTime() + LEARNING_ADJUSTMENT_MAX_FUTURE_SKEW_MS
  const freshnessCutoff = new Date(freshnessCutoffMs).toISOString()
  const maximumComputedAt = new Date(maximumComputedAtMs).toISOString()
  const { data, error } = await supabase
    .from("ebay_category_learning_adjustments")
    .select("account_key,marketplace_id,category_id,model_version,prediction_engine_version,status,eligible,adjustment_points,sample_listing_count,total_impressions,minimum_observation_days,source,computed_at")
    .eq("account_key", accountKey)
    .eq("marketplace_id", "EBAY_US")
    .eq("prediction_engine_version", predictionEngineVersion)
    .eq("status", "ELIGIBLE_APPLIED")
    .eq("eligible", true)
    .gte("computed_at", freshnessCutoff)
    .lte("computed_at", maximumComputedAt)
  if (error) throw new Error("EBAY_CATEGORY_LEARNING_ADJUSTMENT_READ_FAILED")

  const adjustments: Record<string, EbayCategoryLearningAdjustmentInput> = {}
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const categoryId = String(row.category_id ?? "")
    const adjustmentPoints = finiteNumber(row.adjustment_points)
    const sampleListingCount = finiteNumber(row.sample_listing_count)
    const totalImpressions = finiteNumber(row.total_impressions)
    const minimumObservationDays = finiteNumber(row.minimum_observation_days)
    const computedAt = validTimestamp(row.computed_at)
    const computedAtMs = computedAt ? Date.parse(computedAt) : Number.NaN
    if (
      !/^\d{1,20}$/.test(categoryId) || adjustmentPoints === null ||
      sampleListingCount === null || totalImpressions === null ||
      minimumObservationDays === null || !computedAt ||
      computedAtMs < freshnessCutoffMs ||
      computedAtMs > maximumComputedAtMs ||
      row.source !== EBAY_CATEGORY_LEARNING_SOURCE ||
      row.model_version !== EBAY_CATEGORY_LEARNING_MODEL_VERSION ||
      row.prediction_engine_version !== predictionEngineVersion
    ) continue
    adjustments[categoryId] = {
      accountKey: String(row.account_key),
      marketplaceId: "EBAY_US",
      categoryId,
      modelVersion: String(row.model_version),
      predictionEngineVersion: String(row.prediction_engine_version),
      status: "ELIGIBLE_APPLIED",
      eligible: true,
      adjustmentPoints,
      sampleListingCount,
      totalImpressions,
      minimumObservationDays,
      source: EBAY_CATEGORY_LEARNING_SOURCE,
      computedAt,
    }
  }
  return adjustments
}

function utcDateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

export function buildEbayCategoryLearningCollectionWindow(
  value: string | Date | number = Date.now(),
) {
  const now = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(now.getTime())) {
    throw new Error("EBAY_CATEGORY_LEARNING_OBSERVED_AT_INVALID")
  }
  const dateToValue = new Date(now.getTime() - DAY_MS)
  const dateFromValue = new Date(dateToValue.getTime() - 13 * DAY_MS)
  const dateFrom = utcDateOnly(dateFromValue)
  return {
    dateFrom,
    dateTo: utcDateOnly(dateToValue),
    verifiedOnOrBefore: `${dateFrom}T00:00:00.000Z`,
    windowDays: EBAY_CATEGORY_LEARNING_POLICY.minimumObservationDays,
  }
}

/**
 * Daily automation entry point. It requests one bounded LISTING report for the
 * newest verified links and persists only the normalized aggregate snapshots.
 */
export async function collectOwnEbayPerformanceForLearning(
  supabase: SupabaseClient,
  options: {
    now?: string | Date
    maximumListings?: number
    environment?: NodeJS.ProcessEnv
  } = {},
) {
  const activation = getEbayCategoryLearningActivationConfiguration(
    options.environment ?? process.env,
  )
  if (!activation.active) {
    return {
      status: "PREVIEW_LEARNING_DISABLED" as const,
      requestedListingCount: 0,
      totalEligibleVerifiedListingCount: 0,
      hasMoreEligibleVerifiedListings: false,
      rankingAdjustmentApplied: false as const,
      persistencePerformed: false as const,
      externalReadsPerformed: false as const,
      minimums: EBAY_CATEGORY_LEARNING_POLICY,
      activation,
    }
  }
  const accountKey = getEbayCategoryLearningAccountKey()
  const now = options.now instanceof Date
    ? options.now
    : new Date(options.now ?? Date.now())
  const reportWindow = buildEbayCategoryLearningCollectionWindow(now)
  const maximumListings = Math.max(
    1,
    Math.min(200, Math.floor(options.maximumListings ?? 200)),
  )
  const verificationFreshnessCutoff = new Date(
    now.getTime() - OWN_LISTING_VERIFICATION_MAX_AGE_MS,
  ).toISOString()
  const { data, error, count } = await supabase
    .from("ebay_manual_listing_links")
    .select("ebay_item_id", { count: "exact" })
    .eq("account_key", accountKey)
    .eq("marketplace_id", "EBAY_US")
    .eq("verification_status", "verified")
    .gte("last_verification_at", verificationFreshnessCutoff)
    .lte("verified_at", reportWindow.verifiedOnOrBefore)
    .order("verified_at", { ascending: false })
    .limit(maximumListings)
  if (error) throw new Error("EBAY_CATEGORY_LEARNING_LINK_READ_FAILED")
  const listingIds = [...new Set((data ?? [])
    .map((row) => String(row.ebay_item_id ?? ""))
    .filter((itemId) => /^\d{9,20}$/.test(itemId)))]
  if (!listingIds.length) {
    return {
      status: "NO_CAUSALLY_ELIGIBLE_VERIFIED_LISTINGS" as const,
      requestedListingCount: 0,
      totalEligibleVerifiedListingCount: count ?? 0,
      hasMoreEligibleVerifiedListings: false,
      reportWindow,
      rankingAdjustmentApplied: false,
    }
  }

  if (!Number.isFinite(now.getTime())) {
    throw new Error("EBAY_CATEGORY_LEARNING_OBSERVED_AT_INVALID")
  }
  // eBay can still consolidate the current day. The canonical learning cohort
  // uses exactly fourteen complete UTC days ending yesterday, and only links
  // verified before the first instant in that report window.
  const { dateFrom, dateTo } = reportWindow
  const {
    getEbaySellerAnalyticsConfigurationState,
    getEbaySellerTrafficPerformance,
  } = await import(
    "./ebay-seller-analytics-readonly-gateway"
  )
  if (!getEbaySellerAnalyticsConfigurationState().configured) {
    return {
      status: "SELLER_ANALYTICS_OAUTH_NOT_CONFIGURED" as const,
      requestedListingCount: listingIds.length,
      totalEligibleVerifiedListingCount: count ?? listingIds.length,
      hasMoreEligibleVerifiedListings:
        (count ?? listingIds.length) > listingIds.length,
      reportWindow,
      rankingAdjustmentApplied: false,
    }
  }
  const report = await getEbaySellerTrafficPerformance({
    dateFrom,
    dateTo,
    listingIds,
  })
  const collection = await persistOwnEbayPerformanceSnapshots(
    supabase,
    report,
    {
      dateFrom,
      dateTo,
      listingIds,
      observedAt: now,
      environment: options.environment ?? process.env,
    },
  )
  return {
    ...collection,
    requestedListingCount: listingIds.length,
    totalEligibleVerifiedListingCount: count ?? listingIds.length,
    hasMoreEligibleVerifiedListings:
      (count ?? listingIds.length) > listingIds.length,
    reportWindow,
    activation,
  }
}
