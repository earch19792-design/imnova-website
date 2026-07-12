import type { RealRadarCandidate } from "@/lib/ebay/ebay-mobile-review-real-radar-connector"

export type RadarGuardName = "missingSnapshot" | "missingVariant" | "missingSku" | "stockUnknown" | "stockAvailabilityOnly" | "stockStale" | "missingLunaPrice" | "missingEbayPrice" | "missingMargin" | "missingCategoryId" | "missingDemandValidation" | "missingImageValidation" | "riskHold" | "outOfStock" | "staleMissingFromSource"

type GuardInput = {
  dataSource: string
  realRadarTop5Loaded: boolean
  top5Candidates: RealRadarCandidate[]
  selectedCandidate?: RealRadarCandidate | null
  approveAttempt?: boolean
  localConfirmationsComplete?: boolean
}

const includesMissing = (candidate: RealRadarCandidate, value: string) =>
  candidate.missingFields.some((field) => field.toLowerCase().includes(value))

export function getCandidatePendingRadarGuards(candidate: RealRadarCandidate): RadarGuardName[] {
  const guards: RadarGuardName[] = []
  if (!candidate.marketRadarSnapshotId) guards.push("missingSnapshot")
  if (!candidate.supplierVariantId) guards.push("missingVariant")
  if (!candidate.supplierSku) guards.push("missingSku")
  if (candidate.inventoryStatus === "out_of_stock") guards.push("outOfStock")
  if (candidate.inventoryStatus === "stale_missing_from_source") guards.push("staleMissingFromSource")
  if (candidate.stockSource === "availability_only") guards.push("stockAvailabilityOnly")
  if (candidate.stockQuantity === null || candidate.stockSource === "unknown") guards.push("stockUnknown")
  if ((candidate.stockConfirmationAgeHours ?? 0) > 24) guards.push("stockStale")
  if (candidate.lunaPrice === null) guards.push("missingLunaPrice")
  if (candidate.ebayEstimatedPrice === null || !candidate.ebayPriceSource) guards.push("missingEbayPrice")
  if (candidate.marginPrecheckPassed !== true) guards.push("missingMargin")
  if (!candidate.categoryId) guards.push("missingCategoryId")
  if (candidate.demandValidationPassed !== true || includesMissing(candidate, "demand")) guards.push("missingDemandValidation")
  if (candidate.imageValidationPassed !== true || includesMissing(candidate, "image")) guards.push("missingImageValidation")
  if (candidate.riskFlags.length > 0) guards.push("riskHold")
  return [...new Set(guards)]
}

export function getPrimaryRadarGuardRoute(pendingGuards: RadarGuardName[]) {
  const has = (guard: RadarGuardName) => pendingGuards.includes(guard)
  if (has("riskHold") || has("outOfStock") || has("staleMissingFromSource")) return "STOCK_HOLD"
  if (has("stockUnknown") || has("stockAvailabilityOnly")) return "NEED_STOCK_CONFIRMATION"
  if (has("stockStale")) return "NEED_STOCK_RECONFIRMATION"
  if (has("missingSnapshot") || has("missingVariant") || has("missingSku")) return "NEED_SUPPLIER_IDENTITY"
  if (has("missingLunaPrice")) return "NEED_SUPPLIER_PRICE"
  if (has("missingEbayPrice")) return "NEED_EBAY_MARKET_PRICE"
  if (has("missingMargin")) return "NEED_MARGIN_REVIEW"
  if (has("missingCategoryId")) return "NEED_CATEGORY_RUNTIME_CONFIRMATION"
  if (has("missingDemandValidation")) return "NEED_EBAY_DEMAND_VALIDATION"
  if (has("missingImageValidation")) return "NEED_IMAGE_REVIEW"
  return null
}

export function buildMobileReviewRadarGuardEnforcement(input: GuardInput) {
  const selectedCandidate = input.selectedCandidate ?? null
  const candidateGuardSummary = input.top5Candidates.map((candidate) => {
    const pendingGuards = getCandidatePendingRadarGuards(candidate)
    return { candidateRank: candidate.candidateRank, candidateId: candidate.candidateId, productName: candidate.productName, pendingGuards, primaryBlockingReason: getPrimaryRadarGuardRoute(pendingGuards), canProceedToB2RunPreflight: false }
  })
  const pendingGuards = selectedCandidate ? getCandidatePendingRadarGuards(selectedCandidate) : []
  const primaryBlockingReason = getPrimaryRadarGuardRoute(pendingGuards)
  const scores = input.top5Candidates.map((candidate) => candidate.opportunityScore)
  const scoreTie = scores.length === 5 && new Set(scores).size === 1
  const validSource = input.dataSource === "MARKET_RADAR_READONLY"
  const radarReady = validSource && input.realRadarTop5Loaded && Boolean(selectedCandidate) && pendingGuards.length === 0
  const canProceedToB2RunPreflight = Boolean(radarReady && input.approveAttempt && input.localConfirmationsComplete)
  const approveAttemptBlocked = Boolean(input.approveAttempt && !canProceedToB2RunPreflight)

  return {
    radarGuardEnforcementBuilt: true,
    dataSource: input.dataSource,
    realRadarTop5Loaded: input.realRadarTop5Loaded,
    candidateGuardSummary,
    pendingGuards,
    primaryBlockingReason,
    routePriorityApplied: true,
    approveAttemptBlocked,
    approveBlockedReason: approveAttemptBlocked ? primaryBlockingReason ?? (validSource ? "LOCAL_CONFIRMATIONS_INCOMPLETE" : "NON_REAL_DATA_SOURCE") : null,
    showScoreTieWarning: scoreTie,
    scoreStatus: scoreTie ? "PROVISIONAL_OR_UNDIFFERENTIATED" : "DIFFERENTIATED",
    needsScoreDisambiguation: scoreTie,
    canProceedToB2RunPreflight,
    canPublish: false,
    nextRecommendedRoute: primaryBlockingReason ?? (canProceedToB2RunPreflight ? "READY_FOR_B2_RUN_PREFLIGHT" : validSource && input.realRadarTop5Loaded ? "NEED_MOBILE_REVIEW_OF_REAL_TOP5" : "NEED_REAL_RADAR_TOP5"),
  }
}
