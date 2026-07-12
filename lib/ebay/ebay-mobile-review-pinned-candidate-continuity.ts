import type { RealRadarCandidate } from "@/lib/ebay/ebay-mobile-review-real-radar-connector"

export type PinnedCandidate = {
  pinnedCandidateId: string
  marketRadarProductId: string | null
  supplierProductId: string | null
  productName: string
  handle: string | null
  productUrl: string | null
  status: string
  sameProductConfirmed: boolean
  stockConfirmed: boolean
  stockQuantityConfirmed: number | null
  stockWarning: string | null
  lunaPriceConfirmed: boolean
  lunaPrice: number | null
  imageConfirmed: boolean
  source: "HUMAN_MOBILE_CONFIRMED"
  lastHumanConfirmationAt: string | null
  lastKnownRoute: string
  radarPresenceStatus: string
  nextRecommendedRoute: string
  lastKnownHumanConfirmation?: LastKnownHumanConfirmation
  latestRadarObservation?: LatestRadarObservation | null
}

export type LastKnownHumanConfirmation = {
  stockQuantityConfirmed: number | null
  lunaPrice: number | null
  availabilityStatus: string
  imageConfirmed: boolean
  imageReference: string | null
  sameProductConfirmed: boolean
  confirmedAt: string | null
}

export type LatestRadarObservation = {
  latestAvailabilityStatus: string | null
  latestStockQuantity: number | null
  latestLunaPrice: number | null
  latestImageReference: string | null
  latestLastSeenAt: string | null
  latestScanId: string | null
  sourceLastSuccessAt: string | null
  latestProductUrlStatus: string
  isPresentInLatestScan: boolean
  missingIntervals: number
}

export type PinnedCandidateAction =
  | { type: "RECHECK_PINNED_CANDIDATE"; pinnedCandidateId: string }
  | { type: "MARK_PINNED_UNAVAILABLE"; pinnedCandidateId: string }
  | { type: "CONTINUE_EBAY_MARKET_VALIDATION"; pinnedCandidateId: string }
  | { type: "HOLD_PINNED_FOR_REVIEW"; pinnedCandidateId: string }
  | { type: "UNPIN_CANDIDATE"; pinnedCandidateId: string }

const normalized = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase()

function humanConfirmation(candidate: PinnedCandidate): LastKnownHumanConfirmation {
  return candidate.lastKnownHumanConfirmation ?? {
    stockQuantityConfirmed: candidate.stockQuantityConfirmed,
    lunaPrice: candidate.lunaPrice,
    availabilityStatus: "AVAILABLE",
    imageConfirmed: candidate.imageConfirmed,
    imageReference: null,
    sameProductConfirmed: candidate.sameProductConfirmed,
    confirmedAt: candidate.lastHumanConfirmationAt,
  }
}

function radarObservationFromCandidate(candidate: RealRadarCandidate): LatestRadarObservation {
  return {
    latestAvailabilityStatus: candidate.availabilityStatus,
    latestStockQuantity: candidate.stockQuantity,
    latestLunaPrice: candidate.lunaPrice,
    latestImageReference: candidate.imageReference,
    latestLastSeenAt: candidate.lastSeenAt,
    latestScanId: candidate.marketRadarSnapshotId,
    sourceLastSuccessAt: candidate.lastSnapshotAt,
    latestProductUrlStatus: candidate.productUrl ? "VALID" : "MISSING",
    isPresentInLatestScan: true,
    missingIntervals: 0,
  }
}

export function detectPinnedCandidateSupplierDrift(
  candidate: PinnedCandidate,
  latestRadarObservation: LatestRadarObservation | null
) {
  const lastHumanConfirmation = humanConfirmation(candidate)
  const observation = latestRadarObservation
  const missingIntervals = observation?.missingIntervals ?? 0
  const missingFromLatest = !observation || observation.isPresentInLatestScan === false
  const previousStockQuantity = lastHumanConfirmation.stockQuantityConfirmed
  const latestStockQuantity = observation?.latestStockQuantity ?? null
  const previousLunaPrice = lastHumanConfirmation.lunaPrice
  const latestLunaPrice = observation?.latestLunaPrice ?? null
  const previousAvailabilityStatus = lastHumanConfirmation.availabilityStatus
  const latestAvailabilityStatus = observation?.latestAvailabilityStatus ?? null
  const stockChanged = Boolean(observation && previousStockQuantity !== latestStockQuantity)
  const priceChanged = Boolean(observation && previousLunaPrice !== latestLunaPrice)
  const availabilityChanged = Boolean(observation && normalized(previousAvailabilityStatus) !== normalized(latestAvailabilityStatus))
  const imageReferenceChanged = Boolean(
    observation &&
    lastHumanConfirmation.imageReference &&
    observation.latestImageReference &&
    lastHumanConfirmation.imageReference !== observation.latestImageReference
  )

  let status = candidate.status
  let nextRecommendedRoute = candidate.nextRecommendedRoute
  let driftBlockingReason: string | null = null
  if (missingFromLatest && missingIntervals >= 2) {
    status = "STALE_MISSING_FROM_SOURCE"; nextRecommendedRoute = "STOCK_HOLD"; driftBlockingReason = "STALE_MISSING_FROM_SOURCE"
  } else if (missingFromLatest && missingIntervals >= 1) {
    status = "NOT_OBSERVED_LATEST_SCAN"; nextRecommendedRoute = "NEED_RADAR_RECHECK"; driftBlockingReason = "NOT_OBSERVED_LATEST_SCAN"
  } else if (missingFromLatest) {
    status = "NEED_RADAR_RECHECK"; nextRecommendedRoute = "NEED_RADAR_RECHECK"; driftBlockingReason = "NEED_RADAR_RECHECK"
  } else if (["sold_out", "out_of_stock", "unavailable"].includes(normalized(latestAvailabilityStatus)) || latestStockQuantity === 0) {
    status = availabilityChanged ? "SUPPLIER_UNAVAILABLE" : "OUT_OF_STOCK"; nextRecommendedRoute = "STOCK_HOLD"; driftBlockingReason = status
  } else if (stockChanged && latestStockQuantity === null) {
    status = "STOCK_RECONFIRMATION_REQUIRED"; nextRecommendedRoute = "NEED_STOCK_RECONFIRMATION"; driftBlockingReason = status
  } else if (stockChanged) {
    status = "STOCK_CHANGED_WARNING"; nextRecommendedRoute = "NEED_STOCK_RECONFIRMATION"; driftBlockingReason = status
  } else if (priceChanged) {
    status = "SUPPLIER_PRICE_CHANGED"; nextRecommendedRoute = "NEED_MARGIN_REVIEW"; driftBlockingReason = status
  } else if (imageReferenceChanged) {
    status = "IMAGE_REFERENCE_CHANGED"; nextRecommendedRoute = "NEED_IMAGE_REVIEW"; driftBlockingReason = status
  }
  const supplierDriftDetected = Boolean(
    missingFromLatest || stockChanged || priceChanged || availabilityChanged || imageReferenceChanged
  )
  return {
    supplierDriftDetected,
    stockChanged,
    priceChanged,
    availabilityChanged,
    imageReferenceChanged,
    latestRadarObservation: observation,
    lastHumanConfirmation,
    driftBlockingReason,
    previousLunaPrice,
    latestLunaPrice,
    previousStockQuantity,
    latestStockQuantity,
    previousAvailabilityStatus,
    latestAvailabilityStatus,
    status,
    nextRecommendedRoute,
    marginReviewPreserved: !priceChanged,
    canProceedToB2RunPreflight: false,
    canPublish: false,
  }
}

export function pinnedCandidateMatchesRadar(
  pinned: PinnedCandidate,
  candidate: RealRadarCandidate
) {
  return Boolean(
    (pinned.marketRadarProductId && pinned.marketRadarProductId === candidate.marketRadarProductId) ||
    (pinned.supplierProductId && pinned.supplierProductId === candidate.supplierProductId) ||
    (pinned.handle && normalized(pinned.handle) === normalized(candidate.handle)) ||
    normalized(pinned.productName) === normalized(candidate.productName)
  )
}

export function canContinuePinnedEbayMarketValidation(
  candidate: PinnedCandidate,
  latestObservation: LatestRadarObservation | null = candidate.latestRadarObservation ?? null
) {
  const drift = detectPinnedCandidateSupplierDrift(
    candidate,
    latestObservation
  )
  return Boolean(
    candidate.sameProductConfirmed &&
    candidate.stockConfirmed &&
    (candidate.stockQuantityConfirmed ?? 0) > 0 &&
    candidate.lunaPriceConfirmed &&
    (candidate.lunaPrice ?? 0) > 0 &&
    candidate.imageConfirmed &&
    candidate.status !== "REMOVED_FROM_LUNA_SCAN" &&
    !drift.supplierDriftDetected
  )
}

export function applyPinnedCandidateAction(
  pinnedCandidates: PinnedCandidate[],
  action: PinnedCandidateAction,
  radarCandidates: RealRadarCandidate[] = []
) {
  if (action.type === "UNPIN_CANDIDATE") {
    return pinnedCandidates.filter(
      (candidate) => candidate.pinnedCandidateId !== action.pinnedCandidateId
    )
  }
  return pinnedCandidates.map((candidate) => {
    if (candidate.pinnedCandidateId !== action.pinnedCandidateId) return candidate
    if (action.type === "MARK_PINNED_UNAVAILABLE") {
      return { ...candidate, status: "REMOVED_FROM_LUNA_SCAN", nextRecommendedRoute: "STOCK_HOLD" }
    }
    if (action.type === "HOLD_PINNED_FOR_REVIEW") {
      return { ...candidate, status: "HOLD_FOR_REVIEW", nextRecommendedRoute: "EBAY-RESUME-HOLD" }
    }
    const radarMatch = radarCandidates.find((entry) => pinnedCandidateMatchesRadar(candidate, entry))
    const latestObservation = radarMatch
      ? radarObservationFromCandidate(radarMatch)
      : candidate.latestRadarObservation ?? null
    const supplierDrift = detectPinnedCandidateSupplierDrift(candidate, latestObservation)
    if (action.type === "CONTINUE_EBAY_MARKET_VALIDATION") {
      return canContinuePinnedEbayMarketValidation(candidate, latestObservation)
        ? { ...candidate, status: "PINNED_CANDIDATE_UNDER_REVIEW", nextRecommendedRoute: "NEED_EBAY_MARKET_VALIDATION" }
        : candidate
    }
    const inRadar = Boolean(radarMatch)
    const hasKnownReference = Boolean(candidate.handle || candidate.productUrl)
    return {
      ...candidate,
      latestRadarObservation: latestObservation,
      status: supplierDrift.supplierDriftDetected
        ? supplierDrift.status
        : "PINNED_CANDIDATE_UNDER_REVIEW",
      radarPresenceStatus: inRadar ? "PINNED_AND_IN_CURRENT_TOP5" : "NEEDS_RADAR_RECHECK",
      nextRecommendedRoute: supplierDrift.supplierDriftDetected
        ? supplierDrift.nextRecommendedRoute
        : inRadar || hasKnownReference
        ? "NEED_EBAY_MARKET_VALIDATION"
        : "NEED_RADAR_RECHECK",
    }
  })
}

export function buildPinnedCandidateContinuityReport(
  currentTop5: RealRadarCandidate[],
  pinnedCandidates: PinnedCandidate[],
  allRadarCandidates: RealRadarCandidate[] = currentTop5
) {
  const decorated = pinnedCandidates.map((candidate) => {
    const top5Match = currentTop5.find((entry) => pinnedCandidateMatchesRadar(candidate, entry))
    const radarMatch = allRadarCandidates.find((entry) => pinnedCandidateMatchesRadar(candidate, entry))
    const inTop5 = Boolean(top5Match)
    const inRadar = Boolean(radarMatch)
    const latestObservation = radarMatch
      ? radarObservationFromCandidate(radarMatch)
      : candidate.latestRadarObservation ?? null
    const supplierDrift = detectPinnedCandidateSupplierDrift(candidate, latestObservation)
    return {
      ...candidate,
      status: supplierDrift.status,
      nextRecommendedRoute: supplierDrift.nextRecommendedRoute,
      supplierDrift,
      canContinueEbayMarketValidation: canContinuePinnedEbayMarketValidation(candidate, latestObservation),
      presentInRadar: inRadar,
      presentInCurrentTop5: inTop5,
      dedupedWithTop5: inTop5,
      radarPresenceStatus: inTop5
        ? "PINNED_AND_IN_CURRENT_TOP5"
        : inRadar ? "PRESENT_IN_RADAR_OUTSIDE_TOP5" : candidate.radarPresenceStatus,
    }
  })
  const first = decorated[0] ?? null
  return {
    pinnedCandidateContinuityBuilt: true,
    currentTop5Count: currentTop5.length,
    pinnedCandidatesCount: decorated.length,
    pinnedCandidateName: first?.productName ?? null,
    pinnedStatus: first?.status ?? null,
    radarPresenceStatus: first?.radarPresenceStatus ?? null,
    dedupedWithTop5: first?.dedupedWithTop5 ?? false,
    humanConfirmationsPreserved: Boolean(first?.source === "HUMAN_MOBILE_CONFIRMED"),
    pinnedCandidateNextRoute: first?.nextRecommendedRoute ?? null,
    canContinueEbayMarketValidation: first?.canContinueEbayMarketValidation ?? false,
    supplierDriftDetected: first?.supplierDrift.supplierDriftDetected ?? false,
    stockChanged: first?.supplierDrift.stockChanged ?? false,
    priceChanged: first?.supplierDrift.priceChanged ?? false,
    availabilityChanged: first?.supplierDrift.availabilityChanged ?? false,
    imageReferenceChanged: first?.supplierDrift.imageReferenceChanged ?? false,
    latestRadarObservation: first?.supplierDrift.latestRadarObservation ?? null,
    lastHumanConfirmation: first?.supplierDrift.lastHumanConfirmation ?? null,
    driftBlockingReason: first?.supplierDrift.driftBlockingReason ?? null,
    previousLunaPrice: first?.supplierDrift.previousLunaPrice ?? null,
    latestLunaPrice: first?.supplierDrift.latestLunaPrice ?? null,
    previousStockQuantity: first?.supplierDrift.previousStockQuantity ?? null,
    latestStockQuantity: first?.supplierDrift.latestStockQuantity ?? null,
    previousAvailabilityStatus: first?.supplierDrift.previousAvailabilityStatus ?? null,
    latestAvailabilityStatus: first?.supplierDrift.latestAvailabilityStatus ?? null,
    pinnedCandidates: decorated,
    pinnedCandidatesOutsideTop5: decorated.filter((candidate) => !candidate.dedupedWithTop5),
    canProceedToB2RunPreflight: false,
    canPublish: false,
    decisionPersistence: "BROWSER_STATE_OR_LOCAL_STORAGE",
    officialApprovalRecord: false,
    supabaseWriteUsed: false,
    ebayApiUsed: false,
    ebayWriteUsed: false,
    nextRecommendedRoute: first?.nextRecommendedRoute ?? "NEED_PINNED_CANDIDATE_SELECTION",
  }
}
