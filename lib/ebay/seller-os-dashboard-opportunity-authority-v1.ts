export const SELLER_OS_DASHBOARD_OPPORTUNITY_AUTHORITY_VERSION =
  "SELLER_OS_DASHBOARD_OPPORTUNITY_AUTHORITY_V1" as const

const OWNER_REVIEW_DECISIONS = new Set([
  "MARKET_TEST_READY",
  "LISTING_READY",
])

type JsonRecord = Record<string, unknown>

export type SellerOsDashboardQueueAuthorityRowV1 = Readonly<{
  id?: unknown
  candidate_key?: unknown
  supplier_product_id?: unknown
  market_radar_product_id?: unknown
  supplier_variant_id?: unknown
  supplier_sku?: unknown
  product_title?: unknown
  queue_status?: unknown
  decision?: unknown
  assessment?: unknown
}>

type LiveMatch = Readonly<{ ebayItemIds: readonly string[] }>

export type SellerOsDashboardRadarSignalInputV1 = Readonly<{
  familyId?: unknown
  familyName?: unknown
  familyDemandStatus?: unknown
  demandStatus?: unknown
  evidenceFreshness?: unknown
  soldComparableCount?: unknown
  soldQuantityEvidence?: unknown
  priceBand?: unknown
  rawFamilyPriceBand?: unknown
  commercialComparableCluster?: unknown
  commercialPriceBand?: unknown
  momentumStatus?: unknown
  evidenceObservedAt?: unknown
  nextReviewCondition?: unknown
  monitorStatus?: unknown
  automaticReviewRuntime?: unknown
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 400) {
  return typeof value === "string" && value.trim() &&
      value.trim().length <= maximum &&
      !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim() : null
}

function number(value: unknown) {
  if (typeof value !== "number" &&
      !(typeof value === "string" && value.trim())) return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function quickPickAssessment(value: unknown) {
  return Object.keys(record(record(value).lunaQuickPickOperationV1)).length > 0
}

function radarAssessment(value: unknown) {
  return Object.keys(record(record(value).radarFactoryCandidateV1)).length > 0
}

function radarHandoff(value: unknown) {
  const marker = record(record(value).radarToQuickPickHandoffV1)
  const familyId = text(marker.radarFamilyId, 140)
  const lunaSku = text(marker.lunaSku, 160)
  const quickPickOperationId = text(marker.quickPickOperationId, 100)
  return familyId && lunaSku && quickPickOperationId
    ? Object.freeze({ familyId, lunaSku, quickPickOperationId }) : null
}

function liveWorkspaceUrl(row: SellerOsDashboardQueueAuthorityRowV1,
  ebayItemId: string) {
  const opportunityId = text(row.id, 100)
  const candidateKey = text(row.candidate_key, 300)
  if (!opportunityId || !candidateKey) return "/admin/ebay/monitor"
  const query = new URLSearchParams({ opportunity: opportunityId,
    candidate: candidateKey, ebayItemId, mode: "maintenance" })
  return `/admin/ebay/listing-workspace?${query.toString()}`
}

function classifyQueueRow(row: SellerOsDashboardQueueAuthorityRowV1,
  alreadyLive: boolean) {
  if (alreadyLive) return "ALREADY_LIVE" as const
  const decision = text(row.decision, 120)
  const queueStatus = text(row.queue_status, 80)
  if (queueStatus === "ready" && decision &&
      OWNER_REVIEW_DECISIONS.has(decision)) return "READY" as const
  if (radarAssessment(row.assessment)) return "RADAR_SIGNAL" as const
  if (decision === "DIRECTED_LUNA_PACK_INTAKE") return "LEGACY" as const
  return "UNPROVEN" as const
}

function classificationCounts(rows: readonly Readonly<{
  classification: "READY" | "RADAR_SIGNAL" | "LEGACY" |
    "ALREADY_LIVE" | "UNPROVEN"
}>[]) {
  return Object.freeze({
    READY: rows.filter((row) => row.classification === "READY").length,
    RADAR_SIGNAL: rows.filter((row) =>
      row.classification === "RADAR_SIGNAL").length,
    LEGACY: rows.filter((row) => row.classification === "LEGACY").length,
    ALREADY_LIVE: rows.filter((row) =>
      row.classification === "ALREADY_LIVE").length,
    UNPROVEN: rows.filter((row) =>
      row.classification === "UNPROVEN").length,
  })
}

function projectQueueRow(row: SellerOsDashboardQueueAuthorityRowV1,
  liveMatches: ReadonlyMap<string, LiveMatch>) {
  const opportunityId = text(row.id, 100)
  if (!opportunityId) return null
  const match = liveMatches.get(opportunityId)
  const ebayItemIds = Object.freeze([...(match?.ebayItemIds ?? [])]
    .filter((value) => /^\d{9,20}$/.test(value)).sort())
  const alreadyLive = ebayItemIds.length > 0
  return Object.freeze({ opportunityId,
    candidateKey: text(row.candidate_key, 300),
    title: text(row.product_title, 500),
    sourceSku: text(row.supplier_sku, 160),
    lunaProductId: text(row.supplier_product_id, 100) ??
      text(row.market_radar_product_id, 100),
    lunaVariantId: text(row.supplier_variant_id, 100),
    queueStatus: text(row.queue_status, 80),
    decision: text(row.decision, 120),
    quickPick: quickPickAssessment(row.assessment),
    classification: classifyQueueRow(row, alreadyLive),
    alreadyLiveExactProduct: alreadyLive,
    ebayItemIds,
    publicationCtaVisible: false as const,
    completePackageCtaVisible: false as const,
    liveWorkspaceUrl: alreadyLive
      ? liveWorkspaceUrl(row, ebayItemIds[0]) : null,
  })
}

function projectRadarSignal(value: SellerOsDashboardRadarSignalInputV1) {
  const familyId = text(value.familyId, 140)
  const familyName = text(value.familyName, 240)
  const demandClass = text(value.familyDemandStatus ?? value.demandStatus, 100)
  if (!familyId || !familyName ||
      !["FAMILY_DEMAND_PROVEN", "FAMILY_DEMAND_SUPPORTED"]
        .includes(demandClass ?? "") || value.evidenceFreshness !== "FRESH") {
    return null
  }
  const rawPriceBand = record(value.rawFamilyPriceBand ?? value.priceBand)
  const commercial = record(value.commercialComparableCluster)
  const commercialPrice = record(value.commercialPriceBand)
  const commercialAvailable = commercial.status === "AVAILABLE"
  const automaticRuntime = record(value.automaticReviewRuntime)
  return Object.freeze({ familyId, family: familyName, demandClass,
    soldComparableCount: number(value.soldComparableCount),
    soldQuantityEvidence: number(value.soldQuantityEvidence),
    momentumStatus: text(value.momentumStatus, 80) ?? "INSUFFICIENT_HISTORY",
    commercialComparableCount: number(commercial.comparableCount) ?? 0,
    commercialPriceBand: commercialAvailable ? Object.freeze({
      status: "AVAILABLE" as const,
      currency: text(commercialPrice.currency, 12) ?? "USD",
      minimum: number(commercialPrice.minimum),
      median: number(commercialPrice.median),
      maximum: number(commercialPrice.maximum),
    }) : Object.freeze({ status: "UNPROVEN" as const, currency: null,
      minimum: null, median: null, maximum: null }),
    rawFamilyPriceBand: Object.freeze({ currency: text(rawPriceBand.currency, 12),
      minimum: number(rawPriceBand.minimum), median: number(rawPriceBand.median),
      maximum: number(rawPriceBand.maximum) }),
    evidenceObservedAt: text(value.evidenceObservedAt, 48),
    enrichmentNextStage: text(value.nextReviewCondition, 160) ??
      "WAITING_NEXT_BOUNDED_ENRICHMENT",
    monitorStatus: text(value.monitorStatus, 80),
    automaticReviewRuntime: Object.freeze({
      status: automaticRuntime.effectiveState === "ACTIVE"
        ? "ACTIVE" as const : "INACTIVE_OR_UNPROVEN" as const,
      authority: text(automaticRuntime.ownerPresentationAuthority, 160) ??
        "UNPROVEN",
      legacyEnrollmentFieldUsedAloneAsOwnerAuthority: false as const,
    }),
  })
}

export function buildSellerOsDashboardOpportunityAuthorityV1(input: Readonly<{
  queueRows: readonly SellerOsDashboardQueueAuthorityRowV1[]
  liveReadStatus: "AVAILABLE" | "UNAVAILABLE"
  liveMatches: ReadonlyMap<string, LiveMatch>
  radarReadStatus: "AVAILABLE" | "UNAVAILABLE"
  radarEntries: readonly SellerOsDashboardRadarSignalInputV1[]
}>) {
  const projected = input.queueRows.flatMap((row) => {
    const value = projectQueueRow(row, input.liveMatches)
    return value ? [value] : []
  })
  const reviewRows = projected.filter((row) => row.queueStatus === "review")
  const readyQueueRows = projected.filter((row) => row.queueStatus === "ready")
  const readyForOwnerReview = input.liveReadStatus === "AVAILABLE"
    ? readyQueueRows.filter((row) => row.classification === "READY") : []
  const alreadyLive = projected.filter((row) => row.alreadyLiveExactProduct)
  const handoffByFamily = new Map(input.queueRows.flatMap((row) => {
    const handoff = radarHandoff(row.assessment)
    return handoff ? [[handoff.familyId, handoff] as const] : []
  }))
  const radarSignals = input.radarReadStatus === "AVAILABLE"
    ? input.radarEntries.flatMap((entry) => {
      const projectedSignal = projectRadarSignal(entry)
      if (!projectedSignal) return []
      const handoff = handoffByFamily.get(projectedSignal.familyId)
      return [Object.freeze({ ...projectedSignal,
        lunaDiscoveryStatus: handoff
          ? "HANDED_TO_QUICK_PICK" as const : null,
        bestLunaSku: handoff?.lunaSku ?? null,
        quickPickOperationId: handoff?.quickPickOperationId ?? null,
      })]
    }) : []
  return Object.freeze({
    contractVersion: SELLER_OS_DASHBOARD_OPPORTUNITY_AUTHORITY_VERSION,
    readyForOwnerReview: Object.freeze({
      status: input.liveReadStatus,
      count: input.liveReadStatus === "AVAILABLE"
        ? readyForOwnerReview.length : null,
      decisions: Object.freeze([...OWNER_REVIEW_DECISIONS]),
      currentLiveExactLinkageCheck: input.liveReadStatus,
      records: Object.freeze(readyForOwnerReview),
    }),
    radar: Object.freeze({ status: input.radarReadStatus,
      count: input.radarReadStatus === "AVAILABLE" ? radarSignals.length : null,
      signals: Object.freeze(radarSignals),
      countedAsReadyForOwnerReview: false as const }),
    reviewQueueAudit: Object.freeze({ total: reviewRows.length,
      classification: classificationCounts(reviewRows),
      records: Object.freeze(reviewRows) }),
    readyQueueAudit: Object.freeze({ total: readyQueueRows.length,
      classification: classificationCounts(readyQueueRows),
      records: Object.freeze(readyQueueRows) }),
    alreadyLive: Object.freeze({ count: alreadyLive.length,
      records: Object.freeze(alreadyLive) }),
    safety: Object.freeze({ readOnly: true as const,
      marketplaceWrites: 0 as const, listingPublications: 0 as const,
      customerProductionTouched: false as const }),
  })
}
