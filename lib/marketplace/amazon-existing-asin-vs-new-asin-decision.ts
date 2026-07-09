export const AMAZON_EXISTING_ASIN_VS_NEW_ASIN_DECISION_VERSION =
  "AMAZON_EXISTING_ASIN_VS_NEW_ASIN_DECISION_ENGINE_V1"

const sourceDataClass =
  "LOOP_149F_AMAZON_EXISTING_ASIN_VS_NEW_ASIN_DECISION"

type RiskLevel =
  | "LOW"
  | "MEDIUM"
  | "HIGH"

type TriState =
  | true
  | false
  | "unknown"

type AsinRouteDecision =
  | "SELL_ON_EXISTING_ASIN_AFTER_MANUAL_CHECK"
  | "SELL_ON_EXISTING_ASIN_RESEARCH_ONLY"
  | "CREATE_NEW_ASIN_CANDIDATE_AFTER_GTIN_BRAND_CHECK"
  | "NEED_GTIN_OR_EXEMPTION_BEFORE_NEW_ASIN"
  | "NEED_SELLER_CENTRAL_ELIGIBILITY_CHECK"
  | "NEED_BRAND_OR_CATEGORY_APPROVAL"
  | "WATCHLIST_EXISTING_ASIN"
  | "WATCHLIST_NEW_ASIN_CANDIDATE"
  | "REJECT_FOR_NOW"
  | "DO_NOT_LIST_YET"

type AsinDecisionEntry = {
  supplierSku?: string | null
  productTitle?: string | null
  brand?: string | null
  catalogMatchType?: string | null
  matchConfidenceScore?: number | null
  bestMatchAsin?: string | null
  previousAsinStrategyRecommendation?: string | null
  duplicateAsinRisk?: string | null
  wrongAsinRisk?: string | null
  missingUpcGtin?: boolean | null
  categoryApprovalLikelyRequired?: TriState | null
  brandApprovalLikelyRequired?: TriState | null
  gtinOrExemptionRequired?: TriState | null
  hazmatReviewRequired?: TriState | null
  chemicalComplianceReviewRequired?: TriState | null
  electricalSafetyReviewRequired?: TriState | null
  restrictionGateDecision?: string | null
  overallRestrictionRiskScore?: number | null
  profitGuardDecision?: string | null
  netProfitEstimate?: number | null
  netMarginPercent?: number | null
  roiPercent?: number | null
  canProceedToListingPackage?: boolean | null
  blockedReasons?: string[] | null
  warnings?: string[] | null
}

type AsinDecisionFixture = {
  feesProfitAssessments?: AsinDecisionEntry[] | null
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback
}

function normalizeBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean"
    ? value
    : fallback
}

function normalizeArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

function normalizeTriState(value: unknown): TriState {
  if (value === true || value === false) {
    return value
  }

  return "unknown"
}

function normalizeRisk(value: unknown, fallback: RiskLevel = "MEDIUM"): RiskLevel {
  const text =
    normalizeText(value)?.toUpperCase()

  return text === "LOW" || text === "MEDIUM" || text === "HIGH"
    ? text
    : fallback
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function average(values: number[]) {
  return values.length > 0
    ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2))
    : 0
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function riskPenalty(risk: RiskLevel) {
  return risk === "LOW" ? 0 : risk === "MEDIUM" ? 12 : 30
}

function compatibilityScore(value: RiskLevel) {
  return value === "HIGH" ? 90 : value === "MEDIUM" ? 55 : 20
}

export function buildAmazonAsinDecisionInput(entry: AsinDecisionEntry) {
  return {
    asinDecisionVersion:
      AMAZON_EXISTING_ASIN_VS_NEW_ASIN_DECISION_VERSION,
    sourceDataClass,
    supplierSku:
      normalizeText(entry.supplierSku) ?? "unknown-supplier-sku",
    productTitle:
      normalizeText(entry.productTitle) ?? "Untitled Amazon ASIN decision candidate",
    brand:
      normalizeText(entry.brand) ?? "unbranded",
    catalogMatchType:
      normalizeText(entry.catalogMatchType) ?? "NO_MATCH",
    matchConfidenceScore:
      clampScore(normalizeNumber(entry.matchConfidenceScore, 0)),
    bestMatchAsin:
      normalizeText(entry.bestMatchAsin),
    previousAsinStrategyRecommendation:
      normalizeText(entry.previousAsinStrategyRecommendation) ?? "NEED_MORE_PRODUCT_DATA",
    duplicateAsinRisk:
      normalizeRisk(entry.duplicateAsinRisk, "MEDIUM"),
    wrongAsinRisk:
      normalizeRisk(entry.wrongAsinRisk, "MEDIUM"),
    missingUpcGtin:
      normalizeBoolean(entry.missingUpcGtin),
    categoryApprovalLikelyRequired:
      normalizeTriState(entry.categoryApprovalLikelyRequired),
    brandApprovalLikelyRequired:
      normalizeTriState(entry.brandApprovalLikelyRequired),
    gtinOrExemptionRequired:
      normalizeTriState(entry.gtinOrExemptionRequired),
    hazmatReviewRequired:
      normalizeTriState(entry.hazmatReviewRequired),
    chemicalComplianceReviewRequired:
      normalizeTriState(entry.chemicalComplianceReviewRequired),
    electricalSafetyReviewRequired:
      normalizeTriState(entry.electricalSafetyReviewRequired),
    restrictionGateDecision:
      normalizeText(entry.restrictionGateDecision) ?? "DO_NOT_LIST_YET",
    overallRestrictionRiskScore:
      clampScore(normalizeNumber(entry.overallRestrictionRiskScore, 0)),
    profitGuardDecision:
      normalizeText(entry.profitGuardDecision) ?? "CONTINUE_RESEARCH_ONLY",
    netProfitEstimate:
      Number(normalizeNumber(entry.netProfitEstimate, 0).toFixed(2)),
    netMarginPercent:
      Number(normalizeNumber(entry.netMarginPercent, 0).toFixed(2)),
    roiPercent:
      Number(normalizeNumber(entry.roiPercent, 0).toFixed(2)),
    canProceedToListingPackage:
      normalizeBoolean(entry.canProceedToListingPackage),
    blockedReasons:
      normalizeArray(entry.blockedReasons),
    warnings:
      normalizeArray(entry.warnings),
  }
}

export function buildAmazonExistingAsinEvidenceSignal(input: ReturnType<typeof buildAmazonAsinDecisionInput>) {
  const baseScore =
    input.catalogMatchType === "EXACT_UPC_GTIN_MATCH"
      ? 100
      : input.catalogMatchType === "STRONG_BRAND_MODEL_PART_MATCH"
        ? 95
        : input.catalogMatchType === "STRONG_BRAND_MODEL_SIZE_MATCH"
          ? 92
          : input.catalogMatchType === "POSSIBLE_TITLE_SIZE_MATCH"
            ? 62
            : input.catalogMatchType === "WEAK_TITLE_ONLY_MATCH"
              ? 28
              : input.catalogMatchType === "CONFLICTING_MATCH"
                ? 45
                : 5
  const existingAsinEvidenceScore =
    clampScore(baseScore * 0.65 + input.matchConfidenceScore * 0.35)
  const hasExistingAsinEvidence =
    input.bestMatchAsin !== null &&
    existingAsinEvidenceScore >= 70 &&
    input.catalogMatchType !== "WEAK_TITLE_ONLY_MATCH" &&
    input.catalogMatchType !== "CONFLICTING_MATCH"

  return {
    existingAsinEvidenceScore,
    hasExistingAsinEvidence,
  }
}

export function buildAmazonNewAsinEligibilitySignal(input: ReturnType<typeof buildAmazonAsinDecisionInput>) {
  const blockedByGtin =
    input.missingUpcGtin || input.gtinOrExemptionRequired === true || input.gtinOrExemptionRequired === "unknown"
  const blockedByBrandCategory =
    input.brandApprovalLikelyRequired !== false || input.categoryApprovalLikelyRequired !== false
  const blockedByDuplicateRisk =
    input.duplicateAsinRisk === "HIGH"
  const newAsinEligibilityScore =
    clampScore(
      100 -
      (blockedByGtin ? 35 : 0) -
      (blockedByBrandCategory ? 25 : 0) -
      riskPenalty(input.duplicateAsinRisk) -
      (input.catalogMatchType !== "NO_MATCH" ? 25 : 0),
    )

  return {
    newAsinEligibilityScore,
    newAsinBlockedByGtin:
      blockedByGtin,
    newAsinBlockedByBrandCategory:
      blockedByBrandCategory,
    newAsinBlockedByDuplicateRisk:
      blockedByDuplicateRisk,
  }
}

export function buildAmazonDuplicateAsinRiskSignal(input: ReturnType<typeof buildAmazonAsinDecisionInput>) {
  const duplicateAsinRisk: RiskLevel =
    input.catalogMatchType === "NO_MATCH"
      ? input.duplicateAsinRisk
      : input.duplicateAsinRisk === "LOW"
        ? "MEDIUM"
        : input.duplicateAsinRisk

  return {
    duplicateAsinRisk,
  }
}

export function buildAmazonWrongAsinRiskSignal(input: ReturnType<typeof buildAmazonAsinDecisionInput>) {
  const wrongAsinRisk: RiskLevel =
    input.catalogMatchType === "CONFLICTING_MATCH"
      ? "HIGH"
      : input.catalogMatchType === "WEAK_TITLE_ONLY_MATCH"
        ? "HIGH"
        : input.wrongAsinRisk

  return {
    wrongAsinRisk,
  }
}

export function buildAmazonRestrictionCompatibilitySignal(input: ReturnType<typeof buildAmazonAsinDecisionInput>) {
  const unresolvedCompliance =
    input.hazmatReviewRequired === true ||
    input.chemicalComplianceReviewRequired === true ||
    input.electricalSafetyReviewRequired === true
  const approvalNeeded =
    input.categoryApprovalLikelyRequired === true ||
    input.brandApprovalLikelyRequired === true
  const restrictionCompatibility: RiskLevel =
    input.restrictionGateDecision === "REJECT_FOR_NOW" || input.overallRestrictionRiskScore >= 85
      ? "LOW"
      : unresolvedCompliance || approvalNeeded || input.overallRestrictionRiskScore >= 55
        ? "MEDIUM"
        : "HIGH"

  return {
    restrictionCompatibility,
    unresolvedCompliance,
    approvalNeeded,
  }
}

export function buildAmazonProfitCompatibilitySignal(input: ReturnType<typeof buildAmazonAsinDecisionInput>) {
  const profitCompatibility: RiskLevel =
    input.profitGuardDecision === "PROFITABLE_CONTINUE" && input.netProfitEstimate > 0
      ? "HIGH"
      : input.profitGuardDecision === "LOW_MARGIN_WATCHLIST" || input.profitGuardDecision === "CONTINUE_RESEARCH_ONLY"
        ? "MEDIUM"
        : "LOW"

  return {
    profitCompatibility,
  }
}

export function buildAmazonHumanReviewSignal(
  input: ReturnType<typeof buildAmazonAsinDecisionInput>,
  signals: {
    duplicateAsinRisk: RiskLevel
    wrongAsinRisk: RiskLevel
    restrictionCompatibility: RiskLevel
    profitCompatibility: RiskLevel
  },
) {
  return {
    humanReviewRequired:
      true,
    manualReviewReasons:
      unique([
        "Seller Central eligibility check required before any real offer",
        signals.duplicateAsinRisk === "HIGH" ? "high duplicate ASIN risk" : "",
        signals.wrongAsinRisk === "HIGH" ? "high wrong ASIN risk" : "",
        signals.restrictionCompatibility !== "HIGH" ? "restriction or compliance gate unresolved" : "",
        signals.profitCompatibility !== "HIGH" ? "profit guard not fully green" : "",
        input.catalogMatchType === "CONFLICTING_MATCH" ? "conflicting catalog match" : "",
      ].filter(Boolean)),
  }
}

export function buildAmazonAsinDecisionScore(values: {
  existingAsinEvidenceScore: number
  newAsinEligibilityScore: number
  duplicateAsinRisk: RiskLevel
  wrongAsinRisk: RiskLevel
  restrictionCompatibility: RiskLevel
  profitCompatibility: RiskLevel
}) {
  const bestPathScore =
    Math.max(values.existingAsinEvidenceScore, values.newAsinEligibilityScore)

  return clampScore(
    bestPathScore * 0.42 +
    compatibilityScore(values.restrictionCompatibility) * 0.22 +
    compatibilityScore(values.profitCompatibility) * 0.2 -
    riskPenalty(values.duplicateAsinRisk) -
    riskPenalty(values.wrongAsinRisk) +
    16,
  )
}

export function buildAmazonAsinRouteDecision(
  input: ReturnType<typeof buildAmazonAsinDecisionInput>,
  signals: ReturnType<typeof buildAmazonExistingAsinEvidenceSignal> &
    ReturnType<typeof buildAmazonNewAsinEligibilitySignal> &
    ReturnType<typeof buildAmazonDuplicateAsinRiskSignal> &
    ReturnType<typeof buildAmazonWrongAsinRiskSignal> &
    ReturnType<typeof buildAmazonRestrictionCompatibilitySignal> &
    ReturnType<typeof buildAmazonProfitCompatibilitySignal> &
    { asinDecisionScore: number },
): AsinRouteDecision {
  if (input.restrictionGateDecision === "REJECT_FOR_NOW" || input.overallRestrictionRiskScore >= 90) {
    return "REJECT_FOR_NOW"
  }

  if (signals.wrongAsinRisk === "HIGH" || input.catalogMatchType === "CONFLICTING_MATCH") {
    return "NEED_SELLER_CENTRAL_ELIGIBILITY_CHECK"
  }

  if (signals.approvalNeeded) {
    return "NEED_BRAND_OR_CATEGORY_APPROVAL"
  }

  if (signals.hasExistingAsinEvidence) {
    return input.profitGuardDecision === "LOW_MARGIN_WATCHLIST"
      ? "WATCHLIST_EXISTING_ASIN"
      : "SELL_ON_EXISTING_ASIN_AFTER_MANUAL_CHECK"
  }

  if (input.catalogMatchType === "WEAK_TITLE_ONLY_MATCH") {
    return "SELL_ON_EXISTING_ASIN_RESEARCH_ONLY"
  }

  if (input.catalogMatchType === "NO_MATCH") {
    if (signals.newAsinBlockedByDuplicateRisk) {
      return "WATCHLIST_NEW_ASIN_CANDIDATE"
    }

    if (signals.newAsinBlockedByGtin) {
      return "NEED_GTIN_OR_EXEMPTION_BEFORE_NEW_ASIN"
    }

    if (signals.newAsinBlockedByBrandCategory) {
      return "NEED_BRAND_OR_CATEGORY_APPROVAL"
    }

    return "CREATE_NEW_ASIN_CANDIDATE_AFTER_GTIN_BRAND_CHECK"
  }

  return signals.asinDecisionScore >= 55
    ? "SELL_ON_EXISTING_ASIN_RESEARCH_ONLY"
    : "DO_NOT_LIST_YET"
}

export function buildAmazonAsinDecisionAssessment(entry: AsinDecisionEntry) {
  const input =
    buildAmazonAsinDecisionInput(entry)
  const existingAsin =
    buildAmazonExistingAsinEvidenceSignal(input)
  const newAsin =
    buildAmazonNewAsinEligibilitySignal(input)
  const duplicate =
    buildAmazonDuplicateAsinRiskSignal(input)
  const wrong =
    buildAmazonWrongAsinRiskSignal(input)
  const restriction =
    buildAmazonRestrictionCompatibilitySignal(input)
  const profit =
    buildAmazonProfitCompatibilitySignal(input)
  const asinDecisionScore =
    buildAmazonAsinDecisionScore({
      ...existingAsin,
      ...newAsin,
      ...duplicate,
      ...wrong,
      ...restriction,
      ...profit,
    })
  const signals =
    {
      ...existingAsin,
      ...newAsin,
      ...duplicate,
      ...wrong,
      ...restriction,
      ...profit,
      asinDecisionScore,
    }
  const finalAsinRouteDecision =
    buildAmazonAsinRouteDecision(input, signals)
  const human =
    buildAmazonHumanReviewSignal(input, {
      ...duplicate,
      ...wrong,
      ...restriction,
      ...profit,
    })
  const canProceedToAmazonListingPackage =
    false
  const blockedReasons =
    unique([
      ...input.blockedReasons,
      "Amazon listing package blocked until ASIN route, eligibility, and human review are complete",
      input.catalogMatchType === "CONFLICTING_MATCH" ? "conflicting match cannot proceed to listing package" : "",
      wrong.wrongAsinRisk === "HIGH" ? "high wrong ASIN risk blocks listing package" : "",
      duplicate.duplicateAsinRisk === "HIGH" ? "high duplicate ASIN risk blocks automatic new ASIN" : "",
      input.missingUpcGtin ? "missing UPC/GTIN blocks automatic new ASIN" : "",
      restriction.unresolvedCompliance ? "hazmat, chemical, or electrical review remains unresolved" : "",
      input.netProfitEstimate > 0 && restriction.restrictionCompatibility !== "HIGH" ? "positive ROI cannot override restriction gate" : "",
    ].filter(Boolean))
  const warnings =
    unique([
      ...input.warnings,
      "Existing ASIN requires Seller Central eligibility check before a real offer",
      "New ASIN requires GTIN/exemption and brand/category decision before creation",
      input.catalogMatchType === "WEAK_TITLE_ONLY_MATCH" ? "title-only match is research-only evidence" : "",
      profit.profitCompatibility !== "HIGH" ? "profit guard is not fully green" : "",
      ...human.manualReviewReasons,
    ].filter(Boolean))

  return {
    asinDecisionVersion:
      AMAZON_EXISTING_ASIN_VS_NEW_ASIN_DECISION_VERSION,
    sourceDataClass,
    supplierSku:
      input.supplierSku,
    productTitle:
      input.productTitle,
    brand:
      input.brand,
    catalogMatchType:
      input.catalogMatchType,
    matchConfidenceScore:
      input.matchConfidenceScore,
    bestMatchAsin:
      input.bestMatchAsin,
    previousAsinStrategyRecommendation:
      input.previousAsinStrategyRecommendation,
    restrictionGateDecision:
      input.restrictionGateDecision,
    profitGuardDecision:
      input.profitGuardDecision,
    netProfitEstimate:
      input.netProfitEstimate,
    netMarginPercent:
      input.netMarginPercent,
    roiPercent:
      input.roiPercent,
    existingAsinEvidenceScore:
      existingAsin.existingAsinEvidenceScore,
    newAsinEligibilityScore:
      newAsin.newAsinEligibilityScore,
    duplicateAsinRisk:
      duplicate.duplicateAsinRisk,
    wrongAsinRisk:
      wrong.wrongAsinRisk,
    restrictionCompatibility:
      restriction.restrictionCompatibility,
    profitCompatibility:
      profit.profitCompatibility,
    asinDecisionScore,
    finalAsinRouteDecision,
    canProceedToAmazonListingPackage,
    canCreateAmazonAsin:
      false,
    canCreateAmazonListing:
      false,
    canPublish:
      false,
    humanReviewRequired:
      human.humanReviewRequired,
    blockedReasons,
    warnings,
    nextRecommendedAction:
      finalAsinRouteDecision,
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    asinCreationExecuted:
      false,
    listingCreationExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    scraperUsed:
      false,
  }
}

export function buildAmazonAsinDecisionQueue(fixture: AsinDecisionFixture) {
  const feesProfitAssessments =
    fixture.feesProfitAssessments ?? []
  const assessments =
    feesProfitAssessments.map(buildAmazonAsinDecisionAssessment)

  return {
    asinDecisionVersion:
      AMAZON_EXISTING_ASIN_VS_NEW_ASIN_DECISION_VERSION,
    sourceDataClass,
    inputFeesProfitAssessments:
      feesProfitAssessments.length,
    asinDecisionAssessmentsBuilt:
      assessments.length,
    assessments,
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    asinCreationExecuted:
      false,
    listingCreationExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    scraperUsed:
      false,
    nextLoop:
      "149G",
  }
}

export function summarizeAmazonAsinDecisionQueue(queue: ReturnType<typeof buildAmazonAsinDecisionQueue>) {
  const assessments =
    queue.assessments

  return {
    inputFeesProfitAssessments:
      queue.inputFeesProfitAssessments,
    asinDecisionAssessmentsBuilt:
      queue.asinDecisionAssessmentsBuilt,
    sellOnExistingAsinAfterManualCheckCandidates:
      assessments.filter(entry => entry.finalAsinRouteDecision === "SELL_ON_EXISTING_ASIN_AFTER_MANUAL_CHECK").length,
    sellOnExistingAsinResearchOnlyCandidates:
      assessments.filter(entry => entry.finalAsinRouteDecision === "SELL_ON_EXISTING_ASIN_RESEARCH_ONLY").length,
    createNewAsinCandidateAfterChecksCandidates:
      assessments.filter(entry => entry.finalAsinRouteDecision === "CREATE_NEW_ASIN_CANDIDATE_AFTER_GTIN_BRAND_CHECK").length,
    needGtinOrExemptionBeforeNewAsinCandidates:
      assessments.filter(entry => entry.finalAsinRouteDecision === "NEED_GTIN_OR_EXEMPTION_BEFORE_NEW_ASIN").length,
    needSellerCentralEligibilityCheckCandidates:
      assessments.filter(entry => entry.finalAsinRouteDecision === "NEED_SELLER_CENTRAL_ELIGIBILITY_CHECK").length,
    needBrandOrCategoryApprovalCandidates:
      assessments.filter(entry => entry.finalAsinRouteDecision === "NEED_BRAND_OR_CATEGORY_APPROVAL").length,
    watchlistExistingAsinCandidates:
      assessments.filter(entry => entry.finalAsinRouteDecision === "WATCHLIST_EXISTING_ASIN").length,
    watchlistNewAsinCandidates:
      assessments.filter(entry => entry.finalAsinRouteDecision === "WATCHLIST_NEW_ASIN_CANDIDATE").length,
    rejectedCandidates:
      assessments.filter(entry => entry.finalAsinRouteDecision === "REJECT_FOR_NOW").length,
    doNotListYetCandidates:
      assessments.filter(entry => entry.finalAsinRouteDecision === "DO_NOT_LIST_YET").length,
    productsWithHighDuplicateAsinRisk:
      assessments.filter(entry => entry.duplicateAsinRisk === "HIGH").length,
    productsWithHighWrongAsinRisk:
      assessments.filter(entry => entry.wrongAsinRisk === "HIGH").length,
    productsAllowedToAmazonListingPackage:
      assessments.filter(entry => entry.canProceedToAmazonListingPackage).length,
    productsBlockedFromAmazonListingPackage:
      assessments.filter(entry => !entry.canProceedToAmazonListingPackage).length,
    productsRequiringHumanReview:
      assessments.filter(entry => entry.humanReviewRequired).length,
    averageAsinDecisionScore:
      average(assessments.map(entry => entry.asinDecisionScore)),
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    asinCreationExecuted:
      false,
    listingCreationExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    scraperUsed:
      false,
    nextLoop:
      "149G",
  }
}

export function getAmazonExistingAsinVsNewAsinDecisionChecklist() {
  return [
    "Use catalog match confidence to choose existing ASIN research paths, but never treat match as listing approval.",
    "Block title-only and conflicting matches from automatic existing ASIN decisions.",
    "Block new ASIN creation when duplicate ASIN risk is high or GTIN/exemption is missing.",
    "Require Seller Central eligibility and human review before any real offer.",
    "Keep hazmat, chemical, electrical, brand, category, invoice, GTIN, and profit gates ahead of listing package.",
    "Keep LOOP 149F local only: no Amazon connection, no SP-API, no ASIN creation, no listing creation, no publication.",
  ]
}
