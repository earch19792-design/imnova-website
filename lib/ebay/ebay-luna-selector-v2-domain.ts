export const EBAY_LUNA_SELECTOR_V2_POLICY_VERSION =
  "EBAY_LUNA_SELECTOR_V2_BOOTSTRAP_CANARY_V1_SHADOW_2026_07_26"

export type EbayDemandEvidenceClass =
  | "CONFIRMED_SOLD_EXACT"
  | "OBSERVED_ESTIMATED_ROTATION"
  | "POPULARITY_OR_RELATED"
  | "ACTIVE_ONLY"
  | "INSUFFICIENT_EVIDENCE"

export type SupplierRotationClass =
  | "HIGH_CONFIDENCE"
  | "LOW_OR_UNSTABLE"
  | "UNKNOWN"

export type SelectorLane =
  | "protection"
  | "event"
  | "hot"
  | "baseline"
  | "coverage"

export type EbayLunaSelectorV2Policy = {
  policyVersion: string
  targetBatchSize: number
  minimumConfirmedDemandPreferred: number
  maximumExploratory: number
  bootstrapCanaryEnabled: boolean
  maximumBootstrapCanaries: number
  maximumPerFamily: number
  maximumPerCategory: number
  minimumFreshStockQuantity: number
  minimumNetProfitUsd: number
  minimumMarginRate: number
  minimumRoiRate: number
  minimumConfidenceScore: number
  minimumReadyScore: number
  maximumRiskScore: number
  maximumSupplierEvidenceAgeHours: number
  maximumSoldEvidenceAgeDays: number
  explorationMinimumPotentialScore: number
  fairnessMaximumBoost: number
}

export const DEFAULT_EBAY_LUNA_SELECTOR_V2_POLICY: EbayLunaSelectorV2Policy = {
  policyVersion: EBAY_LUNA_SELECTOR_V2_POLICY_VERSION,
  targetBatchSize: 5,
  minimumConfirmedDemandPreferred: 4,
  maximumExploratory: 1,
  bootstrapCanaryEnabled: false,
  maximumBootstrapCanaries: 5,
  maximumPerFamily: 2,
  maximumPerCategory: 2,
  minimumFreshStockQuantity: 1,
  minimumNetProfitUsd: 5,
  minimumMarginRate: 0.2,
  minimumRoiRate: 0.3,
  minimumConfidenceScore: 70,
  minimumReadyScore: 70,
  maximumRiskScore: 35,
  maximumSupplierEvidenceAgeHours: 72,
  maximumSoldEvidenceAgeDays: 30,
  explorationMinimumPotentialScore: 55,
  fairnessMaximumBoost: 10,
}

export type EbayLunaSelectorCandidateV2 = {
  candidateKey: string
  productId: string
  supplierProductId: string | null
  supplierVariantId: string | null
  supplierSku: string | null
  familyKey: string
  categoryId: string | null
  lane: SelectorLane | null
  currentOpportunityScore: number | null
  lastDeepAnalyzedAt: string | null
  consumableResearchBoost?: number | null
  supplier: {
    productCurrent: boolean
    exactVariant: boolean
    numericStock: number | null
    costUsd: number | null
    observedAt: string | null
    rotationClass: SupplierRotationClass
    readinessScore: number | null
    rotationScore: number | null
    confidenceScore: number | null
  }
  demand: {
    evidenceClass: EbayDemandEvidenceClass
    reviewed: boolean
    exactIdentity: boolean
    samePack: boolean
    sameSize: boolean
    sameVariant: boolean
    sameCondition: boolean
    soldExactUnits: number | null
    soldExactSellerCount: number | null
    soldExactComparableCount: number | null
    observedAt: string | null
    historicalMarketCheckCompleted: boolean
    score: number | null
    confidenceScore: number | null
  }
  economics: {
    landedSoldPriceComplete: boolean
    netProfitUsd: number | null
    marginRate: number | null
    roiRate: number | null
    safeFloorUsd: number | null
    targetPriceUsd: number | null
    score: number | null
  }
  operational: {
    categoryValid: boolean
    complianceResolved: boolean
    weightResolved: boolean
    dimensionsResolved: boolean
    imagesAuthorized: boolean
    listingFactsComplete: boolean
    score: number | null
  }
  risk: {
    score: number | null
    blockerCodes: string[]
  }
  confidenceScore: number | null
}

export type EbayLunaSelectorEvaluationV2 = {
  candidateKey: string
  productId: string
  supplierVariantId: string | null
  supplierSku: string | null
  familyKey: string
  categoryId: string | null
  lane: SelectorLane | null
  policyVersion: string
  evidenceClass: EbayDemandEvidenceClass
  evidenceObservedAt: string | null
  soldExactUnits: number
  soldExactSellerCount: number
  soldExactComparableCount: number
  supplierReadinessScore: number
  supplierRotationScore: number
  ebayDemandScore: number
  commercialViabilityScore: number
  operationalReadinessScore: number
  riskScore: number
  confidenceScore: number
  finalSelectionScore: number
  researchEligibilityScore: number
  researchPriorityScore: number
  consumableResearchBoost: number
  fairnessBoost: number
  hardGateCodes: string[]
  nonDemandHardGateCodes: string[]
  readyToList: boolean
  eligibleForResearch: boolean
  eligibleForExploration: boolean
  eligibleForBootstrapCanary: boolean
  canReceivePromotion: false
  selectionMode:
    | "DEMAND_VALIDATED"
    | "BOOTSTRAP_CANARY"
    | "RESEARCH_ONLY"
    | "BLOCKED"
  forcedListingQuantity: 1 | null
  promotionRatePercent: 0
  canDecreasePrice: false
  externalWritesAllowed: false
  commercialMonitorRequired: boolean
  oneVariableAtATime: boolean
  selectionReason: string
}

export type EbayLunaSelectorBatchV2 = {
  policyVersion: string
  targetBatchSize: number
  ready: EbayLunaSelectorEvaluationV2[]
  bootstrapCanaries: EbayLunaSelectorEvaluationV2[]
  exploratory: EbayLunaSelectorEvaluationV2[]
  researchOnly: EbayLunaSelectorEvaluationV2[]
  displayed: EbayLunaSelectorEvaluationV2[]
  commerciallyEligibleCount: number
  confirmedDemandCount: number
  unfilledSlots: number
  explanation: string
}

function clampScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function positiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0
}

function validDate(value: string | null | undefined) {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function evidenceAgeHours(value: string | null, now: Date) {
  const observedAt = validDate(value)
  if (observedAt === null) return Number.POSITIVE_INFINITY
  return Math.max(0, (now.getTime() - observedAt) / 3_600_000)
}

function fairnessBoost(
  lastDeepAnalyzedAt: string | null,
  now: Date,
  maximumBoost: number,
) {
  const previous = validDate(lastDeepAnalyzedAt)
  if (previous === null) return maximumBoost
  const ageDays = Math.max(0, (now.getTime() - previous) / 86_400_000)
  return Math.min(maximumBoost, Math.floor(ageDays / 3))
}

export function isCommercialDiscoveryLane(
  lane: SelectorLane | string | null | undefined,
) {
  return lane === "hot" || lane === "baseline" || lane === "coverage"
}

export function classifySupplyDemandMatrix(input: {
  supplierRotationClass: SupplierRotationClass
  demandEvidenceClass: EbayDemandEvidenceClass
}) {
  const confirmedDemand = input.demandEvidenceClass === "CONFIRMED_SOLD_EXACT"
  if (input.supplierRotationClass === "HIGH_CONFIDENCE" && confirmedDemand) {
    return "COMMERCIAL_PRIORITY" as const
  }
  if (input.supplierRotationClass === "LOW_OR_UNSTABLE" && confirmedDemand) {
    return "SUPPLY_RISK_OPPORTUNITY" as const
  }
  if (input.supplierRotationClass === "UNKNOWN" && confirmedDemand) {
    return "ENRICH_SUPPLY" as const
  }
  if (input.supplierRotationClass === "HIGH_CONFIDENCE") {
    return "ENRICH_DEMAND" as const
  }
  return "LOW_PRIORITY" as const
}

export function evaluateEbayLunaSelectorCandidateV2(
  candidate: EbayLunaSelectorCandidateV2,
  options: {
    now?: Date
    policy?: EbayLunaSelectorV2Policy
  } = {},
): EbayLunaSelectorEvaluationV2 {
  const now = options.now ?? new Date()
  const policy = options.policy ?? DEFAULT_EBAY_LUNA_SELECTOR_V2_POLICY
  const gates: string[] = []
  const supplierAgeHours = evidenceAgeHours(candidate.supplier.observedAt, now)
  const soldAgeDays = evidenceAgeHours(candidate.demand.observedAt, now) / 24
  const soldExactUnits = positiveNumber(candidate.demand.soldExactUnits)
  const soldExactSellerCount = positiveNumber(candidate.demand.soldExactSellerCount)
  const soldExactComparableCount = positiveNumber(
    candidate.demand.soldExactComparableCount,
  )
  const exactSoldEvidence =
    candidate.demand.evidenceClass === "CONFIRMED_SOLD_EXACT" &&
    candidate.demand.reviewed &&
    candidate.demand.exactIdentity &&
    candidate.demand.samePack &&
    candidate.demand.sameSize &&
    candidate.demand.sameVariant &&
    candidate.demand.sameCondition &&
    soldExactUnits > 0 &&
    soldExactSellerCount > 0 &&
    soldExactComparableCount > 0 &&
    soldAgeDays <= policy.maximumSoldEvidenceAgeDays

  if (!candidate.supplier.productCurrent) gates.push("LUNA_PRODUCT_NOT_CURRENT")
  if (!candidate.supplier.exactVariant) gates.push("LUNA_EXACT_VARIANT_REQUIRED")
  if (
    candidate.supplier.numericStock === null ||
    candidate.supplier.numericStock < policy.minimumFreshStockQuantity
  ) {
    gates.push("LUNA_FRESH_NUMERIC_STOCK_REQUIRED")
  }
  if (!positiveNumber(candidate.supplier.costUsd)) {
    gates.push("LUNA_FRESH_COST_REQUIRED")
  }
  if (supplierAgeHours > policy.maximumSupplierEvidenceAgeHours) {
    gates.push("LUNA_EVIDENCE_STALE")
  }
  if (!candidate.demand.exactIdentity) gates.push("EXACT_IDENTITY_REQUIRED")
  if (!candidate.demand.samePack) gates.push("EXACT_PACK_REQUIRED")
  if (!candidate.demand.sameSize) gates.push("EXACT_SIZE_REQUIRED")
  if (!candidate.demand.sameVariant) gates.push("EXACT_VARIANT_REQUIRED")
  if (!candidate.demand.sameCondition) gates.push("EXACT_CONDITION_REQUIRED")
  if (!candidate.demand.historicalMarketCheckCompleted) {
    gates.push("HISTORICAL_MARKET_CHECK_REQUIRED")
  }
  if (!exactSoldEvidence) gates.push("CONFIRMED_SOLD_EXACT_REQUIRED")
  if (!candidate.economics.landedSoldPriceComplete) {
    gates.push("LANDED_SOLD_PRICE_REQUIRED")
  }
  if (
    positiveNumber(candidate.economics.netProfitUsd) <
    policy.minimumNetProfitUsd
  ) {
    gates.push("MINIMUM_NET_PROFIT_NOT_MET")
  }
  if (
    positiveNumber(candidate.economics.marginRate) <
    policy.minimumMarginRate
  ) {
    gates.push("MINIMUM_MARGIN_NOT_MET")
  }
  if (positiveNumber(candidate.economics.roiRate) < policy.minimumRoiRate) {
    gates.push("MINIMUM_ROI_NOT_MET")
  }
  if (
    !positiveNumber(candidate.economics.safeFloorUsd) ||
    !positiveNumber(candidate.economics.targetPriceUsd) ||
    positiveNumber(candidate.economics.targetPriceUsd) <
      positiveNumber(candidate.economics.safeFloorUsd)
  ) {
    gates.push("SAFE_PRICE_FLOOR_NOT_MET")
  }
  if (!candidate.operational.categoryValid) gates.push("CATEGORY_REQUIRED")
  if (!candidate.operational.complianceResolved) {
    gates.push("COMPLIANCE_REQUIRED")
  }
  if (!candidate.operational.weightResolved) gates.push("WEIGHT_REQUIRED")
  if (!candidate.operational.dimensionsResolved) {
    gates.push("DIMENSIONS_REQUIRED")
  }
  if (!candidate.operational.imagesAuthorized) {
    gates.push("AUTHORIZED_IMAGES_REQUIRED")
  }
  if (!candidate.operational.listingFactsComplete) {
    gates.push("LISTING_FACTS_INCOMPLETE")
  }
  if (clampScore(candidate.risk.score) > policy.maximumRiskScore) {
    gates.push("RISK_SCORE_TOO_HIGH")
  }
  if (
    candidate.risk.score === null ||
    !Number.isFinite(candidate.risk.score)
  ) {
    gates.push("RISK_SCORE_REQUIRED")
  }
  for (const blocker of candidate.risk.blockerCodes) {
    if (blocker && !gates.includes(blocker)) gates.push(blocker)
  }

  const supplierReadinessScore = clampScore(candidate.supplier.readinessScore)
  const supplierRotationScore = clampScore(candidate.supplier.rotationScore)
  const ebayDemandScore = exactSoldEvidence
    ? clampScore(candidate.demand.score)
    : 0
  const commercialViabilityScore = clampScore(candidate.economics.score)
  const operationalReadinessScore = clampScore(candidate.operational.score)
  const riskScore = clampScore(candidate.risk.score)
  const confidenceScore = clampScore(candidate.confidenceScore)
  const finalSelectionScore = Math.round(
    ebayDemandScore * 0.35 +
    commercialViabilityScore * 0.25 +
    supplierReadinessScore * 0.15 +
    supplierRotationScore * 0.1 +
    operationalReadinessScore * 0.1 +
    confidenceScore * 0.05 -
    riskScore * 0.2,
  )
  const boost = fairnessBoost(
    candidate.lastDeepAnalyzedAt,
    now,
    policy.fairnessMaximumBoost,
  )
  const weakDemandScore =
    candidate.demand.evidenceClass === "INSUFFICIENT_EVIDENCE"
      ? 0
      : clampScore(candidate.demand.score)
  const researchEligibilityScore = Math.max(
    0,
    Math.round(
      weakDemandScore * 0.3 +
      commercialViabilityScore * 0.2 +
      supplierReadinessScore * 0.2 +
      operationalReadinessScore * 0.1 +
      confidenceScore * 0.1 +
      (100 - riskScore) * 0.1 +
      boost,
    ),
  )
  const consumableResearchBoost = Math.min(
    5,
    clampScore(candidate.consumableResearchBoost),
  )
  const researchPriorityScore = Math.min(
    100,
    researchEligibilityScore + consumableResearchBoost,
  )
  const readyToList =
    gates.length === 0 &&
    finalSelectionScore >= policy.minimumReadyScore &&
    confidenceScore >= policy.minimumConfidenceScore
  const explorationBlockers = new Set([
    "LUNA_PRODUCT_NOT_CURRENT",
    "LUNA_EXACT_VARIANT_REQUIRED",
    "LUNA_FRESH_NUMERIC_STOCK_REQUIRED",
    "LUNA_FRESH_COST_REQUIRED",
    "LUNA_EVIDENCE_STALE",
    "EXACT_IDENTITY_REQUIRED",
    "EXACT_PACK_REQUIRED",
    "EXACT_SIZE_REQUIRED",
    "EXACT_VARIANT_REQUIRED",
    "EXACT_CONDITION_REQUIRED",
    "MINIMUM_NET_PROFIT_NOT_MET",
    "MINIMUM_MARGIN_NOT_MET",
    "MINIMUM_ROI_NOT_MET",
    "SAFE_PRICE_FLOOR_NOT_MET",
    "COMPLIANCE_REQUIRED",
    "RISK_SCORE_TOO_HIGH",
  ])
  const eligibleForResearch =
    !readyToList &&
    researchEligibilityScore >= policy.explorationMinimumPotentialScore &&
    gates.every((gate) =>
      gate === "CONFIRMED_SOLD_EXACT_REQUIRED" ||
      gate === "LANDED_SOLD_PRICE_REQUIRED" ||
      gate === "CATEGORY_REQUIRED" ||
      gate === "WEIGHT_REQUIRED" ||
      gate === "DIMENSIONS_REQUIRED" ||
      gate === "AUTHORIZED_IMAGES_REQUIRED" ||
      gate === "LISTING_FACTS_INCOMPLETE" ||
      !explorationBlockers.has(gate)
    )
  const deterministicEconomicsComplete =
    positiveNumber(candidate.economics.netProfitUsd) >=
      policy.minimumNetProfitUsd &&
    positiveNumber(candidate.economics.marginRate) >=
      policy.minimumMarginRate &&
    positiveNumber(candidate.economics.roiRate) >= policy.minimumRoiRate &&
    positiveNumber(candidate.economics.safeFloorUsd) > 0 &&
    positiveNumber(candidate.economics.targetPriceUsd) >=
      positiveNumber(candidate.economics.safeFloorUsd)
  const allowedCanaryDemandGates = new Set([
    "CONFIRMED_SOLD_EXACT_REQUIRED",
    "EXACT_IDENTITY_REQUIRED",
    "EXACT_PACK_REQUIRED",
    "EXACT_SIZE_REQUIRED",
    "EXACT_VARIANT_REQUIRED",
    "EXACT_CONDITION_REQUIRED",
    ...(deterministicEconomicsComplete
      ? ["LANDED_SOLD_PRICE_REQUIRED"]
      : []),
  ])
  const nonDemandHardGateCodes = gates.filter(
    (gate) => !allowedCanaryDemandGates.has(gate),
  )
  const eligibleForBootstrapCanary =
    policy.bootstrapCanaryEnabled &&
    !readyToList &&
    isCommercialDiscoveryLane(candidate.lane) &&
    candidate.demand.historicalMarketCheckCompleted &&
    deterministicEconomicsComplete &&
    nonDemandHardGateCodes.length === 0 &&
    researchEligibilityScore >= policy.explorationMinimumPotentialScore &&
    confidenceScore >= policy.minimumConfidenceScore &&
    operationalReadinessScore >= policy.minimumReadyScore &&
    riskScore <= policy.maximumRiskScore
  const selectionMode = readyToList
    ? "DEMAND_VALIDATED" as const
    : eligibleForBootstrapCanary
      ? "BOOTSTRAP_CANARY" as const
      : eligibleForResearch
        ? "RESEARCH_ONLY" as const
        : "BLOCKED" as const

  return {
    candidateKey: candidate.candidateKey,
    productId: candidate.productId,
    supplierVariantId: candidate.supplierVariantId,
    supplierSku: candidate.supplierSku,
    familyKey: candidate.familyKey,
    categoryId: candidate.categoryId,
    lane: candidate.lane,
    policyVersion: policy.policyVersion,
    evidenceClass: candidate.demand.evidenceClass,
    evidenceObservedAt: candidate.demand.observedAt,
    soldExactUnits,
    soldExactSellerCount,
    soldExactComparableCount,
    supplierReadinessScore,
    supplierRotationScore,
    ebayDemandScore,
    commercialViabilityScore,
    operationalReadinessScore,
    riskScore,
    confidenceScore,
    finalSelectionScore,
    researchEligibilityScore,
    researchPriorityScore,
    consumableResearchBoost,
    fairnessBoost: boost,
    hardGateCodes: gates,
    nonDemandHardGateCodes,
    readyToList,
    eligibleForResearch,
    eligibleForExploration: eligibleForResearch,
    eligibleForBootstrapCanary,
    canReceivePromotion: false,
    selectionMode,
    forcedListingQuantity: eligibleForBootstrapCanary ? 1 : null,
    promotionRatePercent: 0,
    canDecreasePrice: false,
    externalWritesAllowed: false,
    commercialMonitorRequired: eligibleForBootstrapCanary,
    oneVariableAtATime: eligibleForBootstrapCanary,
    selectionReason: readyToList
      ? "CONFIRMED_DEMAND_AND_ALL_HARD_GATES_PASSED"
      : eligibleForBootstrapCanary
        ? "BOOTSTRAP_CANARY_ALL_NON_DEMAND_GATES_PASSED"
        : eligibleForResearch
        ? "RESEARCH_ONLY_MISSING_STRONG_EVIDENCE_OR_READINESS"
        : gates[0] ?? "SELECTION_SCORE_BELOW_POLICY",
  }
}

function compareReady(
  left: EbayLunaSelectorEvaluationV2,
  right: EbayLunaSelectorEvaluationV2,
) {
  return (
    right.finalSelectionScore - left.finalSelectionScore ||
    right.ebayDemandScore - left.ebayDemandScore ||
    right.confidenceScore - left.confidenceScore ||
    left.candidateKey.localeCompare(right.candidateKey)
  )
}

function compareResearch(
  left: EbayLunaSelectorEvaluationV2,
  right: EbayLunaSelectorEvaluationV2,
) {
  return (
    right.researchPriorityScore - left.researchPriorityScore ||
    right.fairnessBoost - left.fairnessBoost ||
    left.candidateKey.localeCompare(right.candidateKey)
  )
}

function withinDiversityPolicy(
  candidate: EbayLunaSelectorEvaluationV2,
  selected: EbayLunaSelectorEvaluationV2[],
  policy: EbayLunaSelectorV2Policy,
) {
  const familyCount = selected.filter(
    (row) => row.familyKey === candidate.familyKey,
  ).length
  const categoryCount = candidate.categoryId
    ? selected.filter((row) => row.categoryId === candidate.categoryId).length
    : 0
  return (
    familyCount < policy.maximumPerFamily &&
    (!candidate.categoryId || categoryCount < policy.maximumPerCategory)
  )
}

export function selectEbayLunaBatchV2(
  evaluations: EbayLunaSelectorEvaluationV2[],
  policy: EbayLunaSelectorV2Policy = DEFAULT_EBAY_LUNA_SELECTOR_V2_POLICY,
): EbayLunaSelectorBatchV2 {
  const ready: EbayLunaSelectorEvaluationV2[] = []
  for (const candidate of evaluations.filter((row) => row.readyToList).sort(compareReady)) {
    if (ready.length >= policy.targetBatchSize) break
    if (!withinDiversityPolicy(candidate, ready, policy)) continue
    ready.push(candidate)
  }

  const bootstrapCanaries: EbayLunaSelectorEvaluationV2[] = []
  const remainingSlots = Math.max(0, policy.targetBatchSize - ready.length)
  const bootstrapCanaryLimit = Math.min(
    policy.maximumBootstrapCanaries,
    remainingSlots,
  )
  for (const candidate of evaluations
    .filter((row) => row.eligibleForBootstrapCanary && !row.readyToList)
    .sort(compareResearch)) {
    if (bootstrapCanaries.length >= bootstrapCanaryLimit) break
    if (
      !withinDiversityPolicy(
        candidate,
        [...ready, ...bootstrapCanaries],
        policy,
      )
    ) continue
    bootstrapCanaries.push(candidate)
  }

  const researchOnly = evaluations
    .filter((row) =>
      row.eligibleForResearch &&
      !row.readyToList &&
      !row.eligibleForBootstrapCanary
    )
    .sort(compareResearch)
  const displayed = [...ready, ...bootstrapCanaries]
  return {
    policyVersion: policy.policyVersion,
    targetBatchSize: policy.targetBatchSize,
    ready,
    bootstrapCanaries,
    exploratory: bootstrapCanaries,
    researchOnly,
    displayed,
    commerciallyEligibleCount: evaluations.filter((row) => row.readyToList).length,
    confirmedDemandCount: ready.filter(
      (row) => row.evidenceClass === "CONFIRMED_SOLD_EXACT",
    ).length,
    unfilledSlots: Math.max(0, policy.targetBatchSize - displayed.length),
    explanation: ready.length >= policy.minimumConfirmedDemandPreferred
      ? "CONFIRMED_DEMAND_TARGET_MET"
      : displayed.length === policy.targetBatchSize &&
          bootstrapCanaries.length > 0
        ? "BOOTSTRAP_CANARY_SHADOW_BATCH_FILLED"
      : "QUALIFIED_DEFICIT_CONTINUE_DISCOVERY",
  }
}
