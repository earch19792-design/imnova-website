// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
import { getSupabaseAdminClient } from "../supabase-admin.ts"

export const SELLER_OS_LONGITUDINAL_OPPORTUNITY_RADAR_READ_VERSION =
  "SELLER_OS_LONGITUDINAL_OPPORTUNITY_RADAR_READ_ADAPTER_V1" as const

const FAMILY_RADAR_RPC = "get_seller_os_family_market_radar_v1" as const
const CASE_ID = /^opportunity-case-v1:sha256:[0-9a-f]{64}$/
const MAXIMUM_RADAR_ENTRIES = 100

type JsonRecord = Record<string, unknown>
type RpcResult = Readonly<{ data: unknown; error: unknown }>
type RadarRpcClient = Readonly<{
  rpc: (name: string, parameters: Record<string, unknown>) =>
    PromiseLike<RpcResult>
}>

export type SellerOsLongitudinalOpportunityReadToolV1 =
  | "seller_os_get_opportunity_radar"
  | "seller_os_get_opportunity_case"

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function text(value: unknown, maximum = 256) {
  const candidate = typeof value === "string" ? value.trim() : ""
  return candidate && candidate.length <= maximum &&
      !/[\u0000-\u001f\u007f]/.test(candidate)
    ? candidate
    : null
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function safeLimit(value: unknown, fallback = 20) {
  return Number.isInteger(value) && Number(value) >= 1 &&
      Number(value) <= MAXIMUM_RADAR_ENTRIES
    ? Number(value)
    : fallback
}

function safeLimitations(value: unknown) {
  return array(value).map((entry) => text(entry, 160)).filter(
    (entry): entry is string => Boolean(entry),
  ).slice(0, 20)
}

function safety() {
  return Object.freeze({
    readOnly: true as const,
    databaseWrites: 0 as const,
    marketplaceWrites: 0 as const,
    productCaseMutations: 0 as const,
    p2Mutations: 0 as const,
    lunaMutations: 0 as const,
    whatsappSends: 0 as const,
    credentialsIncluded: false as const,
    environmentValuesIncluded: false as const,
    buyerPiiIncluded: false as const,
    rawPayloadIncluded: false as const,
  })
}

function unavailable(reason = "PERSISTED_MARKET_OBSERVATION_SERIES_UNAVAILABLE") {
  return Object.freeze({
    contractVersion: SELLER_OS_LONGITUDINAL_OPPORTUNITY_RADAR_READ_VERSION,
    status: "UNPROVEN" as const,
    backend: "LONGITUDINAL_PERSISTED_FAMILY_RADAR" as const,
    persistedMarketObservationSeriesAvailable: false,
    resultCount: null,
    entries: Object.freeze([]),
    reason,
    soldMomentumClaimed: false,
    bounded: true,
    safety: safety(),
    marketplaceWrites: 0 as const,
  })
}

function projectFamily(value: unknown) {
  const family = record(value)
  const observations = array(family.observationSeries).map(record)
  const current = observations[0]
  if (!current) return null
  const enrollments = array(family.monitorEnrollments).map(record)
  const currentObservationId = text(current.observationId, 120)
  const monitor = enrollments.find((entry) =>
    text(entry.lastObservationId, 120) === currentObservationId) ??
    enrollments[0] ?? null
  const familyId = text(family.familyId, 120)
  const opportunityCaseId = text(family.opportunityCaseId, 120)
  const familyName = text(family.familyName, 200)
  if (!familyId || !opportunityCaseId || !familyName ||
      !currentObservationId) return null
  const familyDemandStatus = text(current.familyDemandStatus, 80)
  const momentumStatus = text(current.momentumStatus, 80) ??
    "INSUFFICIENT_HISTORY"
  const fresh = typeof current.fresh === "boolean" ? current.fresh : null
  return Object.freeze({
    familyId,
    familyName,
    opportunityCaseId,
    currentObservationId,
    observationCount: Number.isSafeInteger(family.marketObservationCount)
      ? Number(family.marketObservationCount)
      : observations.length,
    familyDemandStatus,
    demandStatus: familyDemandStatus,
    demandEvidenceClass: text(current.demandEvidenceClass, 120),
    demandEvidenceDigest: text(current.demandEvidenceDigest, 160),
    momentumStatus,
    soldMomentumClaimed: false,
    competitionState: text(current.competitionState, 80) ?? "UNPROVEN",
    monitorStatus: monitor ? text(monitor.status, 80) : null,
    nextReviewCondition: monitor
      ? text(monitor.nextReviewCondition, 120) : null,
    evidenceObservedAt: text(current.evidenceObservedAt, 48),
    sourceUpdatedAt: text(current.sourceUpdatedAt, 48),
    evidenceFreshness: fresh === true ? "FRESH" as const
      : fresh === false ? "STALE" as const : "UNPROVEN" as const,
    soldComparableCount: number(current.soldComparableCount),
    soldQuantityEvidence: number(current.soldQuantity),
    activeComparableCount: number(current.activeComparableCount),
    sellerDiversity: number(current.sellerDiversity),
    priceBand: Object.freeze({
      currency: text(current.priceCurrency, 12),
      minimum: number(current.priceBandMinimum),
      maximum: number(current.priceBandMaximum),
      median: number(current.priceMedian),
    }),
    limitations: Object.freeze(safeLimitations(current.limitations)),
    monitorEnrollment: monitor ? Object.freeze({
      enrollmentId: text(monitor.enrollmentId, 120),
      status: text(monitor.status, 80),
      nextReviewCondition: text(monitor.nextReviewCondition, 120),
      nextEligibleReviewAt: text(monitor.nextEligibleReviewAt, 48),
      lastObservationId: text(monitor.lastObservationId, 120),
      lastEvaluatedAt: text(monitor.lastEvaluatedAt, 48),
      monitorPolicyVersion: text(monitor.monitorPolicyVersion, 120),
      schedulerEnabled: false as const,
    }) : null,
    currentObservation: Object.freeze({
      observationId: currentObservationId,
      observationWindowStart: text(current.observationWindowStart, 48),
      observationWindowEnd: text(current.observationWindowEnd, 48),
      familyDemandStatus,
      demandEvidenceClass: text(current.demandEvidenceClass, 120),
      demandEvidenceDigest: text(current.demandEvidenceDigest, 160),
      momentumStatus,
      previousObservationId: text(current.previousObservationId, 120),
      competitionState: text(current.competitionState, 80) ?? "UNPROVEN",
      evidenceObservedAt: text(current.evidenceObservedAt, 48),
      sourceUpdatedAt: text(current.sourceUpdatedAt, 48),
      evidenceFreshness: fresh === true ? "FRESH" as const
        : fresh === false ? "STALE" as const : "UNPROVEN" as const,
    }),
    canonicalFamily: familyName,
    commercialRecommendation: null,
    legacyDiagnostics: Object.freeze({
      authoritative: false,
      mayOverrideLongitudinalRadar: false,
    }),
  })
}

export function buildSellerOsLongitudinalOpportunityRadarV1(
  payload: unknown,
  limit = 20,
) {
  const root = record(payload)
  if (root.status !== "AVAILABLE") return unavailable()
  const maximum = safeLimit(limit)
  const entries = array(root.families).map(projectFamily).filter(
    (entry): entry is NonNullable<ReturnType<typeof projectFamily>> =>
      entry !== null,
  ).slice(0, maximum)
  if (!entries.length) return unavailable()
  return Object.freeze({
    contractVersion: SELLER_OS_LONGITUDINAL_OPPORTUNITY_RADAR_READ_VERSION,
    status: "AVAILABLE" as const,
    backend: "LONGITUDINAL_PERSISTED_FAMILY_RADAR" as const,
    persistedMarketObservationSeriesAvailable: true,
    resultCount: entries.length,
    entries: Object.freeze(entries),
    reason: null,
    soldMomentumClaimed: false,
    bounded: true,
    limit: maximum,
    phase7Authority: "FUTURE_CANONICAL_AUTHORITY" as const,
    safety: safety(),
    marketplaceWrites: 0 as const,
  })
}

export function buildSellerOsLongitudinalOpportunityCaseV1(
  payload: unknown,
  opportunityCaseId: string,
) {
  if (!CASE_ID.test(opportunityCaseId)) {
    throw new Error("SELLER_OS_OPPORTUNITY_CASE_ID_INVALID")
  }
  const radar = buildSellerOsLongitudinalOpportunityRadarV1(
    payload,
    MAXIMUM_RADAR_ENTRIES,
  )
  const entry = radar.entries.find((candidate) =>
    candidate.opportunityCaseId === opportunityCaseId) ?? null
  if (!entry) return Object.freeze({
    contractVersion: SELLER_OS_LONGITUDINAL_OPPORTUNITY_RADAR_READ_VERSION,
    status: "NOT_FOUND" as const,
    backend: "LONGITUDINAL_PERSISTED_FAMILY_RADAR" as const,
    opportunityCaseId,
    reason: radar.status === "UNPROVEN"
      ? "PERSISTED_MARKET_OBSERVATION_SERIES_UNAVAILABLE"
      : "OPPORTUNITY_CASE_NOT_FOUND",
    soldMomentumClaimed: false,
    bounded: true,
    canonicalFamily: null,
    commercialRecommendation: null,
    keywordRecommendation: null,
    keywordOpportunity: null,
    priceOpportunity: null,
    referenceCandidate: null,
    useAsReferenceReadiness: "UNPROVEN" as const,
    nextBestEvidence: "NEED_PERSISTED_OPPORTUNITY_CASE" as const,
    safety: safety(),
    productCaseMutations: 0 as const,
    marketplaceWrites: 0 as const,
  })
  return Object.freeze({
    contractVersion: SELLER_OS_LONGITUDINAL_OPPORTUNITY_RADAR_READ_VERSION,
    status: "AVAILABLE" as const,
    backend: "LONGITUDINAL_PERSISTED_FAMILY_RADAR" as const,
    persistedMarketObservationSeriesAvailable: true,
    opportunityCaseId: entry.opportunityCaseId,
    familyId: entry.familyId,
    familyName: entry.familyName,
    currentObservation: entry.currentObservation,
    currentObservationId: entry.currentObservationId,
    observationCount: entry.observationCount,
    demandStatus: entry.demandStatus,
    familyDemandStatus: entry.familyDemandStatus,
    momentumStatus: entry.momentumStatus,
    soldMomentumClaimed: false,
    competitionState: entry.competitionState,
    monitorEnrollment: entry.monitorEnrollment,
    nextReviewCondition: entry.nextReviewCondition,
    demandEvidenceDigest: entry.demandEvidenceDigest,
    evidenceFreshness: entry.evidenceFreshness,
    limitations: entry.limitations,
    canonicalFamily: entry.familyName,
    commercialRecommendation: null,
    keywordRecommendation: null,
    keywordOpportunity: null,
    priceOpportunity: null,
    referenceCandidate: null,
    useAsReferenceReadiness: "UNPROVEN" as const,
    nextBestEvidence: "NEED_PRODUCT_FIT_DISCOVERY" as const,
    bounded: true,
    safety: safety(),
    productCaseMutations: 0 as const,
    marketplaceWrites: 0 as const,
  })
}

export async function collectSellerOsLongitudinalOpportunityReadV1(input: {
  toolName: SellerOsLongitudinalOpportunityReadToolV1
  arguments: Record<string, unknown>
  client?: RadarRpcClient
}) {
  const client = input.client ?? getSupabaseAdminClient()
  const opportunityCaseId = input.toolName === "seller_os_get_opportunity_case"
    ? text(input.arguments.opportunityCaseId, 120)
    : null
  if (input.toolName === "seller_os_get_opportunity_case" &&
      (!opportunityCaseId || !CASE_ID.test(opportunityCaseId))) {
    throw new Error("SELLER_OS_OPPORTUNITY_CASE_ID_INVALID")
  }
  const limit = input.toolName === "seller_os_get_opportunity_case"
    ? MAXIMUM_RADAR_ENTRIES
    : safeLimit(input.arguments.limit)
  const { data, error } = await client.rpc(FAMILY_RADAR_RPC, {
    p_family_id: null,
    p_limit: limit,
  })
  if (error) return input.toolName === "seller_os_get_opportunity_case"
    ? buildSellerOsLongitudinalOpportunityCaseV1(null, opportunityCaseId!)
    : unavailable("LONGITUDINAL_FAMILY_RADAR_BACKEND_UNAVAILABLE")
  return input.toolName === "seller_os_get_opportunity_case"
    ? buildSellerOsLongitudinalOpportunityCaseV1(data, opportunityCaseId!)
    : buildSellerOsLongitudinalOpportunityRadarV1(data, limit)
}
