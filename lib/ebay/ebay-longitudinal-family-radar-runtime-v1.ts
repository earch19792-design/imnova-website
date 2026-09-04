import { createHash } from "node:crypto"

type MarketReader = typeof import(
  "./ebay-seller-keyword-demand-gateway"
)["runEbaySellerKeywordDemandValidation"]

export const SELLER_OS_LONGITUDINAL_RADAR_RUNTIME_VERSION =
  "SELLER_OS_LONGITUDINAL_RADAR_RUNTIME_V1" as const

const MAXIMUM_FAMILIES_PER_CYCLE = 3
const MINIMUM_COMMERCIAL_COMPARABLES = 3

type JsonRecord = Record<string, unknown>
type ReadWriteClient = Readonly<{
  rpc: (name: string, parameters: Record<string, unknown>) => PromiseLike<{
    data: unknown
    error: { message?: string } | null
  }>
}>

type FamilyProjection = Readonly<{
  familyId: string
  familyName: string
  opportunityCaseId: string
  observationCount: number
  currentObservationId: string
  familyDemandStatus: string
  evidenceFreshness: "FRESH" | "STALE" | "UNPROVEN"
  nextReviewCondition: string | null
  nextEligibleReviewAt: string | null
  schedulerEnabled: boolean
  categoryId: string | null
  rawPriceBand: Readonly<{ minimum: number | null; maximum: number | null }>
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value : []
}

function text(value: unknown, maximum = 256) {
  const candidate = typeof value === "string" ? value.trim() : ""
  return candidate && candidate.length <= maximum ? candidate : null
}

function finite(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as JsonRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stable(entry)]))
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stable(value))).digest("hex")}`
}

function percentile(sorted: number[], ratio: number) {
  if (!sorted.length) return null
  const position = (sorted.length - 1) * ratio
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const value = lower === upper ? sorted[lower]
    : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
  return Math.round(value * 100) / 100
}

function projectFamilies(payload: unknown): FamilyProjection[] {
  return rows(record(payload).families).flatMap((raw) => {
    const family = record(raw)
    const observations = rows(family.observationSeries).map(record)
    const current = observations[0]
    const monitors = rows(family.monitorEnrollments).map(record)
    const currentId = text(current?.observationId, 120)
    const monitor = monitors.find((entry) =>
      text(entry.lastObservationId, 120) === currentId) ?? monitors[0]
    const identity = record(family.familyIdentity)
    const structured = record(identity.structuredDefinition)
    const familyId = text(family.familyId, 120)
    const familyName = text(family.familyName, 200)
    const opportunityCaseId = text(family.opportunityCaseId, 120)
    if (!familyId || !familyName || !opportunityCaseId || !currentId) return []
    const fresh = current.fresh
    return [{ familyId, familyName, opportunityCaseId,
      observationCount: Number.isSafeInteger(family.marketObservationCount)
        ? Number(family.marketObservationCount) : observations.length,
      currentObservationId: currentId,
      familyDemandStatus: text(current.familyDemandStatus, 80) ?? "FAMILY_DEMAND_UNPROVEN",
      evidenceFreshness: fresh === true ? "FRESH" : fresh === false ? "STALE" : "UNPROVEN",
      nextReviewCondition: text(monitor?.nextReviewCondition, 120),
      nextEligibleReviewAt: text(monitor?.nextEligibleReviewAt, 48),
      schedulerEnabled: monitor?.schedulerEnabled === true,
      categoryId: text(structured["category id"], 32),
      rawPriceBand: { minimum: finite(current.priceBandMinimum),
        maximum: finite(current.priceBandMaximum) } }]
  })
}

export function isSellerOsRadarFamilyEligibleV1(family: FamilyProjection, now: Date) {
  const explicit = family.nextEligibleReviewAt
    ? Date.parse(family.nextEligibleReviewAt) <= now.getTime() : false
  return family.schedulerEnabled &&
    family.nextReviewCondition === "TIME_WINDOW_ELAPSED" &&
    (family.evidenceFreshness === "STALE" || explicit)
}

export function buildCommercialComparableClusterV1(reportValue: unknown) {
  const report = record(reportValue)
  const raw = rows(report.comparableEvidence).map(record)
  const accepted = raw.filter((entry) => {
    const quality = text(entry.identityMatchQuality, 40)
    return entry.eligibleComparable === true &&
      ["EXACT_IDENTIFIER", "EXACT", "STRONG"].includes(quality ?? "") &&
      rows(entry.identityConflicts).length === 0 &&
      (finite(entry.price) ?? 0) > 0
  })
  const unique = [...new Map(accepted.map((entry) =>
    [text(entry.comparableId, 160) ?? digest(entry), entry] as const)).values()]
  const sortedPrices = unique.map((entry) => finite(entry.price) as number)
    .sort((left, right) => left - right)
  const q1 = percentile(sortedPrices, 0.25)
  const q3 = percentile(sortedPrices, 0.75)
  const iqr = q1 !== null && q3 !== null ? q3 - q1 : null
  const lowFence = iqr === null ? null : q1! - 1.5 * iqr
  const highFence = iqr === null ? null : q3! + 1.5 * iqr
  const inliers = unique.filter((entry) => {
    const price = finite(entry.price) as number
    return unique.length < 4 || (price >= lowFence! && price <= highFence!)
  })
  const inlierPrices = inliers.map((entry) => finite(entry.price) as number)
    .sort((left, right) => left - right)
  const available = inliers.length >= MINIMUM_COMMERCIAL_COMPARABLES
  const exactCount = inliers.filter((entry) =>
    ["EXACT_IDENTIFIER", "EXACT"].includes(text(entry.identityMatchQuality, 40) ?? "")).length
  const statisticalOutliers = unique.length - inliers.length
  const reasons = new Set<string>()
  if (raw.length > accepted.length) reasons.add("FAMILY_OR_CONFLICTING_IDENTITY_EXCLUDED")
  if (statisticalOutliers) reasons.add("ROBUST_PRICE_OUTLIER_EXCLUDED")
  if (!available) reasons.add("COMMERCIAL_COMPARABLE_EVIDENCE_INSUFFICIENT")
  const safeEvidence = raw.map((entry) => ({
    reference: digest(text(entry.comparableId, 160) ?? entry),
    evidenceSource: text(entry.evidenceSource, 80),
    identityMatchQuality: text(entry.identityMatchQuality, 40),
    eligibleComparable: entry.eligibleComparable === true,
    price: finite(entry.price),
    estimatedSoldQuantity: finite(entry.estimatedSoldQuantity),
    verifiedSoldQuantity: finite(entry.verifiedSoldQuantity),
  }))
  return Object.freeze({
    status: available ? "AVAILABLE" as const : "UNPROVEN" as const,
    rawCandidateCount: raw.length,
    comparableCount: inliers.length,
    exactCount,
    strongCount: inliers.length - exactCount,
    typicalLow: available ? percentile(inlierPrices, 0.25) : null,
    typicalHigh: available ? percentile(inlierPrices, 0.75) : null,
    median: available ? percentile(inlierPrices, 0.5) : null,
    outliersExcludedCount: raw.length - inliers.length,
    exclusionReasons: Object.freeze([...reasons].sort()),
    activeComparableCount: raw.filter((entry) =>
      entry.evidenceSource !== "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY").length,
    sellerDiversity: Math.max(0, Math.trunc(finite(report.sellersAnalyzed) ?? 0)),
    activeEvidenceDigest: digest(safeEvidence),
  })
}

function competitionState(activeCount: number, sellerDiversity: number) {
  if (!activeCount || !sellerDiversity) return "UNPROVEN" as const
  if (activeCount >= 10 && sellerDiversity >= 5) return "HIGH" as const
  if (activeCount >= 4 && sellerDiversity >= 2) return "MODERATE" as const
  return "LOW" as const
}

function certificationFamilies(families: FamilyProjection[], now: Date) {
  const byId = [...families].sort((left, right) => left.familyId.localeCompare(right.familyId))
  const a = byId.find((family) => family.observationCount === 1 &&
    family.familyDemandStatus === "FAMILY_DEMAND_PROVEN" &&
    isSellerOsRadarFamilyEligibleV1(family, now))
  const b = byId.find((family) => family.observationCount === 1 &&
    family.familyDemandStatus === "FAMILY_DEMAND_SUPPORTED" &&
    isSellerOsRadarFamilyEligibleV1(family, now))
  const c = byId.find((family) => family.observationCount >= 2 &&
    family.familyId !== a?.familyId && family.familyId !== b?.familyId)
  if (!a || !b || !c) throw new Error("RADAR_LONGITUDINAL_CERTIFICATION_COHORT_UNAVAILABLE")
  return [a, b, c]
}

export async function runSellerOsLongitudinalRadarCycleV1(input: Readonly<{
  supabase: ReadWriteClient
  now?: Date
  mode?: "SCHEDULED" | "CERTIFICATION"
  marketReader?: MarketReader
}>) {
  const now = input.now ?? new Date()
  const read = await input.supabase.rpc("get_seller_os_family_market_radar_v1", {
    p_family_id: null, p_limit: 100,
  })
  if (read.error) throw new Error("RADAR_LONGITUDINAL_AUTHORITY_READ_FAILED")
  const families = projectFamilies(read.data)
  const selected = input.mode === "CERTIFICATION"
    ? certificationFamilies(families, now)
    : families.filter((family) => isSellerOsRadarFamilyEligibleV1(family, now))
      .sort((left, right) => left.familyId.localeCompare(right.familyId))
      .slice(0, MAXIMUM_FAMILIES_PER_CYCLE)
  let marketplaceReadCount = 0
  let observationsCreated = 0
  let duplicateObservationCount = 0
  const outcomes: JsonRecord[] = []
  for (const family of selected) {
    const eligible = isSellerOsRadarFamilyEligibleV1(family, now)
    if (!eligible) {
      outcomes.push({ familyId: family.familyId, familyName: family.familyName,
        eligibleForRefresh: false, freshEvidenceReused: true,
        marketplaceReadCount: 0, observationCreated: false,
        observationCountBefore: family.observationCount,
        observationCountAfter: family.observationCount,
        previousObservationId: family.currentObservationId,
        newObservationId: null, momentumStatus: "NEEDS_MORE_EVIDENCE",
        rawPriceBand: family.rawPriceBand })
      continue
    }
    marketplaceReadCount += 1
    const marketReader = input.marketReader ?? (await import(
      "./ebay-seller-keyword-demand-gateway"
    )).runEbaySellerKeywordDemandValidation
    const report = await marketReader({
      productName: family.familyName, productTitle: family.familyName,
      categoryId: family.categoryId,
    })
    const cluster = buildCommercialComparableClusterV1(report)
    const observedAt = new Date(now.getTime())
    observedAt.setMilliseconds(Math.trunc(observedAt.getMilliseconds()))
    const persisted = await input.supabase.rpc(
      "put_seller_os_longitudinal_family_refresh_v1", {
        p_family_id: family.familyId,
        p_expected_current_observation_id: family.currentObservationId,
        p_observed_at: observedAt.toISOString(),
        p_active_evidence_digest: cluster.activeEvidenceDigest,
        p_marketplace_read_count: 1,
        p_active_comparable_count: cluster.activeComparableCount,
        p_seller_diversity: cluster.sellerDiversity,
        p_competition_state: competitionState(cluster.activeComparableCount,
          cluster.sellerDiversity),
        p_commercial_comparable_status: cluster.status,
        p_commercial_comparable_count: cluster.comparableCount,
        p_commercial_exact_count: cluster.exactCount,
        p_commercial_strong_count: cluster.strongCount,
        p_commercial_price_typical_low: cluster.typicalLow,
        p_commercial_price_typical_high: cluster.typicalHigh,
        p_commercial_price_median: cluster.median,
        p_raw_outliers_excluded_count: cluster.outliersExcludedCount,
        p_commercial_exclusion_reasons: cluster.exclusionReasons,
        p_source_contract_version: SELLER_OS_LONGITUDINAL_RADAR_RUNTIME_VERSION,
      })
    if (persisted.error) throw new Error(
      persisted.error.message?.replace(/[^A-Z0-9_]/gi, "_").slice(0, 160) ||
      "RADAR_LONGITUDINAL_PERSIST_FAILED")
    const result = record(persisted.data)
    const created = result.outcome === "CREATED"
    observationsCreated += created ? 1 : 0
    duplicateObservationCount += result.duplicateObservationCreated === true ? 1 : 0
    outcomes.push({ familyId: family.familyId, familyName: family.familyName,
      eligibleForRefresh: true, freshEvidenceReused: false,
      marketplaceReadCount: 1, observationCreated: created,
      observationCountBefore: family.observationCount,
      observationCountAfter: family.observationCount + (created ? 1 : 0),
      previousObservationId: result.previousObservationId,
      newObservationId: result.observationId,
      momentumStatus: result.momentumStatus,
      familyDemandStatusBefore: family.familyDemandStatus,
      familyDemandStatusAfter: family.familyDemandStatus,
      commercialComparableCount: cluster.comparableCount,
      commercialPriceBand: cluster.status === "AVAILABLE" ? {
        minimum: cluster.typicalLow, maximum: cluster.typicalHigh,
        median: cluster.median, currency: "USD",
      } : "UNPROVEN",
      rawOutliersExcludedCount: cluster.outliersExcludedCount,
      exclusionReasons: cluster.exclusionReasons,
      rawPriceBand: family.rawPriceBand })
  }
  return Object.freeze({
    contractVersion: SELLER_OS_LONGITUDINAL_RADAR_RUNTIME_VERSION,
    trigger: "VERCEL_CRON_MARKET_RADAR_LUNA_SYNC" as const,
    mode: input.mode ?? "SCHEDULED",
    schedulerEnabled: true as const,
    familiesEvaluated: selected.length,
    eligibleFamiliesRead: marketplaceReadCount,
    ineligibleFamiliesSkipped: selected.length - marketplaceReadCount,
    marketplaceReadCount, observationsCreated, duplicateObservationCount,
    openAiCallCount: 0 as const,
    outcomes: Object.freeze(outcomes),
    safety: Object.freeze({ marketplaceWrites: 0 as const,
      listingPublications: 0 as const, lunaSearches: 0 as const,
      quickPickOperations: 0 as const }),
  })
}
