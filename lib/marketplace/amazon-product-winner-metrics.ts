export const AMAZON_PRODUCT_WINNER_METRICS_VERSION =
  "AMAZON_PRODUCT_WINNER_METRICS_LISTING_READINESS_V1"

const sourceDataClass =
  "LOOP_149A_AMAZON_PRODUCT_WINNER_METRICS"

const maxAssessmentQueue =
  25

type AsinStrategy =
  | "SELL_ON_EXISTING_ASIN"
  | "CREATE_NEW_ASIN"
  | "NEED_GTIN_OR_EXEMPTION"
  | "NEED_BRAND_APPROVAL"
  | "REJECT_FOR_NOW"

type AmazonProductDecision =
  | "RESEARCH_MORE"
  | "SELL_ON_EXISTING_ASIN"
  | "CREATE_NEW_ASIN"
  | "REQUEST_CATEGORY_APPROVAL"
  | "REQUEST_BRAND_APPROVAL"
  | "REQUEST_SUPPLIER_INVOICE"
  | "REQUEST_IMAGE_PACKAGE"
  | "WATCHLIST"
  | "REJECT_FOR_NOW"

type AmazonProductCandidate = {
  candidateKey?: string | null
  title?: string | null
  productType?: string | null
  category?: string | null
  brand?: string | null
  authorizedBrands?: string[] | null
  hasExistingAsinMatch?: boolean | null
  existingAsin?: string | null
  hasGtin?: boolean | null
  gtinExemptionLikely?: boolean | null
  brandApprovalRequired?: boolean | null
  categoryApprovalRequired?: boolean | null
  supplierInvoiceAvailable?: boolean | null
  demand?: {
    estimatedMonthlySalesSignal?: number | null
    bsrSignal?: number | null
    keywordDemand?: number | null
  } | null
  competition?: {
    competingAsinCount?: number | null
    averageReviewCount?: number | null
    averageRating?: number | null
    buyBoxDifficulty?: number | null
    fbaFbmFit?: number | null
  } | null
  profitability?: {
    expectedSellPrice?: number | null
    landedCost?: number | null
    estimatedAmazonFees?: number | null
    expectedRoiPercent?: number | null
    feeRisk?: number | null
  } | null
  restrictionRisk?: {
    categoryRestrictionRisk?: number | null
    brandIpRisk?: number | null
    hazmatRisk?: number | null
    expirationRisk?: number | null
    supplyRisk?: number | null
  } | null
  keywordOpportunity?: {
    researchKeywords?: string[] | null
    unauthorizedTrademarkKeywords?: string[] | null
    exactListingCopyRequested?: boolean | null
    medicalClaimsPresent?: boolean | null
    unconfirmedClaimsPresent?: boolean | null
    differentiationOpportunity?: number | null
    listingWeaknessOpportunity?: number | null
  } | null
  listingAssets?: {
    titleReady?: boolean | null
    bulletsReady?: boolean | null
    imagePackageReady?: boolean | null
    backendKeywordsReady?: boolean | null
    categoryAttributesComplete?: boolean | null
    complianceReady?: boolean | null
    priceCompetitive?: boolean | null
    conversionReady?: boolean | null
  } | null
  missingData?: string[] | null
}

type AmazonProductWinnerOptions = {
  maxAssessments?: number | null
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

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function average(values: number[]) {
  return values.length > 0
    ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2))
    : 0
}

function hasHighRestrictionRisk(restrictionRisk: ReturnType<typeof buildAmazonRestrictionRiskSignals>) {
  return (
    restrictionRisk.categoryRestrictionRisk >= 70 ||
    restrictionRisk.brandIpRisk >= 70 ||
    restrictionRisk.hazmatRisk >= 70 ||
    restrictionRisk.expirationRisk >= 70
  )
}

function hasPolicyBlockedKeywords(input: ReturnType<typeof buildAmazonProductWinnerInput>) {
  return (
    input.keywordOpportunity.unauthorizedTrademarkKeywords.length > 0 ||
    input.keywordOpportunity.exactListingCopyRequested ||
    input.keywordOpportunity.medicalClaimsPresent ||
    input.keywordOpportunity.unconfirmedClaimsPresent
  )
}

export function buildAmazonProductWinnerInput(
  candidate: AmazonProductCandidate,
  options: AmazonProductWinnerOptions = {},
) {
  void options

  const demand =
    candidate.demand ?? {}
  const competition =
    candidate.competition ?? {}
  const profitability =
    candidate.profitability ?? {}
  const restrictionRisk =
    candidate.restrictionRisk ?? {}
  const keywordOpportunity =
    candidate.keywordOpportunity ?? {}
  const listingAssets =
    candidate.listingAssets ?? {}

  return {
    amazonProductWinnerMetricsVersion:
      AMAZON_PRODUCT_WINNER_METRICS_VERSION,
    sourceDataClass,
    candidateKey:
      normalizeText(candidate.candidateKey) ?? "unknown-amazon-candidate",
    title:
      normalizeText(candidate.title) ?? "Untitled Amazon candidate",
    productType:
      normalizeText(candidate.productType) ?? "unknown",
    category:
      normalizeText(candidate.category) ?? "unknown",
    brand:
      normalizeText(candidate.brand) ?? "unbranded",
    authorizedBrands:
      normalizeArray(candidate.authorizedBrands),
    hasExistingAsinMatch:
      normalizeBoolean(candidate.hasExistingAsinMatch),
    existingAsin:
      normalizeText(candidate.existingAsin),
    hasGtin:
      normalizeBoolean(candidate.hasGtin),
    gtinExemptionLikely:
      normalizeBoolean(candidate.gtinExemptionLikely),
    brandApprovalRequired:
      normalizeBoolean(candidate.brandApprovalRequired),
    categoryApprovalRequired:
      normalizeBoolean(candidate.categoryApprovalRequired),
    supplierInvoiceAvailable:
      normalizeBoolean(candidate.supplierInvoiceAvailable),
    demand:
      {
        estimatedMonthlySalesSignal:
          normalizeNumber(demand.estimatedMonthlySalesSignal, 0),
        bsrSignal:
          normalizeNumber(demand.bsrSignal, 0),
        keywordDemand:
          normalizeNumber(demand.keywordDemand, 0),
      },
    competition:
      {
        competingAsinCount:
          normalizeNumber(competition.competingAsinCount, 0),
        averageReviewCount:
          normalizeNumber(competition.averageReviewCount, 0),
        averageRating:
          normalizeNumber(competition.averageRating, 0),
        buyBoxDifficulty:
          normalizeNumber(competition.buyBoxDifficulty, 0),
        fbaFbmFit:
          normalizeNumber(competition.fbaFbmFit, 50),
      },
    profitability:
      {
        expectedSellPrice:
          normalizeNumber(profitability.expectedSellPrice, 0),
        landedCost:
          normalizeNumber(profitability.landedCost, 0),
        estimatedAmazonFees:
          normalizeNumber(profitability.estimatedAmazonFees, 0),
        expectedRoiPercent:
          normalizeNumber(profitability.expectedRoiPercent, 0),
        feeRisk:
          normalizeNumber(profitability.feeRisk, 50),
      },
    restrictionRisk:
      {
        categoryRestrictionRisk:
          normalizeNumber(restrictionRisk.categoryRestrictionRisk, 0),
        brandIpRisk:
          normalizeNumber(restrictionRisk.brandIpRisk, 0),
        hazmatRisk:
          normalizeNumber(restrictionRisk.hazmatRisk, 0),
        expirationRisk:
          normalizeNumber(restrictionRisk.expirationRisk, 0),
        supplyRisk:
          normalizeNumber(restrictionRisk.supplyRisk, 0),
      },
    keywordOpportunity:
      {
        researchKeywords:
          normalizeArray(keywordOpportunity.researchKeywords),
        unauthorizedTrademarkKeywords:
          normalizeArray(keywordOpportunity.unauthorizedTrademarkKeywords),
        exactListingCopyRequested:
          normalizeBoolean(keywordOpportunity.exactListingCopyRequested),
        medicalClaimsPresent:
          normalizeBoolean(keywordOpportunity.medicalClaimsPresent),
        unconfirmedClaimsPresent:
          normalizeBoolean(keywordOpportunity.unconfirmedClaimsPresent),
        differentiationOpportunity:
          normalizeNumber(keywordOpportunity.differentiationOpportunity, 0),
        listingWeaknessOpportunity:
          normalizeNumber(keywordOpportunity.listingWeaknessOpportunity, 0),
      },
    listingAssets:
      {
        titleReady:
          normalizeBoolean(listingAssets.titleReady),
        bulletsReady:
          normalizeBoolean(listingAssets.bulletsReady),
        imagePackageReady:
          normalizeBoolean(listingAssets.imagePackageReady),
        backendKeywordsReady:
          normalizeBoolean(listingAssets.backendKeywordsReady),
        categoryAttributesComplete:
          normalizeBoolean(listingAssets.categoryAttributesComplete),
        complianceReady:
          normalizeBoolean(listingAssets.complianceReady),
        priceCompetitive:
          normalizeBoolean(listingAssets.priceCompetitive),
        conversionReady:
          normalizeBoolean(listingAssets.conversionReady),
      },
    missingData:
      normalizeArray(candidate.missingData),
  }
}

export function buildAmazonDemandSignals(input: ReturnType<typeof buildAmazonProductWinnerInput>) {
  const bsrSignalScore =
    clampScore(input.demand.bsrSignal)
  const estimatedMonthlySalesSignal =
    clampScore(input.demand.estimatedMonthlySalesSignal)
  const keywordDemandScore =
    clampScore(input.demand.keywordDemand)
  const demandScore =
    clampScore(
      estimatedMonthlySalesSignal * 0.45 +
      bsrSignalScore * 0.3 +
      keywordDemandScore * 0.25 -
      input.missingData.length * 5,
    )

  return {
    demandScore,
    bsrSignalScore,
    estimatedMonthlySalesSignal,
    keywordDemandScore,
  }
}

export function buildAmazonCompetitionSignals(input: ReturnType<typeof buildAmazonProductWinnerInput>) {
  const competitionScore =
    clampScore(100 - input.competition.competingAsinCount * 5)
  const reviewBarrierScore =
    clampScore(100 - input.competition.averageReviewCount / 20)
  const ratingQualityScore =
    clampScore(input.competition.averageRating * 20)
  const buyBoxDifficultyScore =
    clampScore(100 - input.competition.buyBoxDifficulty)
  const fbaFbmFitScore =
    clampScore(input.competition.fbaFbmFit)

  return {
    competitionScore,
    reviewBarrierScore,
    ratingQualityScore,
    buyBoxDifficultyScore,
    fbaFbmFitScore,
  }
}

export function buildAmazonProfitabilitySignals(input: ReturnType<typeof buildAmazonProductWinnerInput>) {
  const netProfit =
    input.profitability.expectedSellPrice -
    input.profitability.landedCost -
    input.profitability.estimatedAmazonFees
  const marginPercent =
    input.profitability.expectedSellPrice > 0
      ? (netProfit / input.profitability.expectedSellPrice) * 100
      : 0
  const marginScore =
    clampScore(marginPercent * 2.5)
  const roiScore =
    clampScore(input.profitability.expectedRoiPercent)
  const feeRiskScore =
    clampScore(100 - input.profitability.feeRisk)

  return {
    marginScore,
    roiScore,
    feeRiskScore,
    netProfit:
      Number(netProfit.toFixed(2)),
    marginPercent:
      Number(marginPercent.toFixed(2)),
  }
}

export function buildAmazonRestrictionRiskSignals(input: ReturnType<typeof buildAmazonProductWinnerInput>) {
  return {
    categoryRestrictionRisk:
      clampScore(input.restrictionRisk.categoryRestrictionRisk + (input.categoryApprovalRequired ? 15 : 0)),
    brandIpRisk:
      clampScore(input.restrictionRisk.brandIpRisk + (input.brandApprovalRequired ? 15 : 0)),
    hazmatRisk:
      clampScore(input.restrictionRisk.hazmatRisk),
    expirationRisk:
      clampScore(input.restrictionRisk.expirationRisk),
    supplyRisk:
      clampScore(input.restrictionRisk.supplyRisk + (input.supplierInvoiceAvailable ? 0 : 15)),
  }
}

export function buildAmazonKeywordOpportunitySignals(input: ReturnType<typeof buildAmazonProductWinnerInput>) {
  const policyPenalty =
    hasPolicyBlockedKeywords(input) ? 45 : 0

  return {
    differentiationOpportunityScore:
      clampScore(input.keywordOpportunity.differentiationOpportunity - policyPenalty),
    listingWeaknessOpportunityScore:
      clampScore(input.keywordOpportunity.listingWeaknessOpportunity - policyPenalty),
    keywordResearchAllowed:
      !hasPolicyBlockedKeywords(input),
    exactListingCopyAllowed:
      false,
    unauthorizedTrademarkKeywordAllowed:
      false,
    medicalClaimsAllowed:
      false,
    unconfirmedClaimsAllowed:
      false,
  }
}

export function buildAmazonAsinStrategy(
  input: ReturnType<typeof buildAmazonProductWinnerInput>,
  restrictionRisk: ReturnType<typeof buildAmazonRestrictionRiskSignals> = buildAmazonRestrictionRiskSignals(input),
): AsinStrategy {
  if (hasHighRestrictionRisk(restrictionRisk) || hasPolicyBlockedKeywords(input)) {
    return "REJECT_FOR_NOW"
  }

  if (input.brandApprovalRequired) {
    return "NEED_BRAND_APPROVAL"
  }

  if (input.hasExistingAsinMatch && input.existingAsin) {
    return "SELL_ON_EXISTING_ASIN"
  }

  if (!input.hasGtin && !input.gtinExemptionLikely) {
    return "NEED_GTIN_OR_EXEMPTION"
  }

  return "CREATE_NEW_ASIN"
}

export function buildAmazonWinnerScore(input: ReturnType<typeof buildAmazonProductWinnerInput>) {
  const demandSignals =
    buildAmazonDemandSignals(input)
  const competitionSignals =
    buildAmazonCompetitionSignals(input)
  const profitabilitySignals =
    buildAmazonProfitabilitySignals(input)
  const restrictionRiskSignals =
    buildAmazonRestrictionRiskSignals(input)
  const keywordOpportunitySignals =
    buildAmazonKeywordOpportunitySignals(input)
  const riskPenalty =
    (
      restrictionRiskSignals.categoryRestrictionRisk +
      restrictionRiskSignals.brandIpRisk +
      restrictionRiskSignals.hazmatRisk +
      restrictionRiskSignals.expirationRisk +
      restrictionRiskSignals.supplyRisk
    ) * 0.18
  const reviewBarrierPenalty =
    competitionSignals.reviewBarrierScore < 45 ? 15 : 0
  const lowMarginPenalty =
    profitabilitySignals.marginScore < 35 ? 18 : 0
  const missingDataPenalty =
    input.missingData.length * 8
  const amazonWinnerScore =
    clampScore(
      demandSignals.demandScore * 0.24 +
      competitionSignals.competitionScore * 0.1 +
      competitionSignals.reviewBarrierScore * 0.1 +
      competitionSignals.ratingQualityScore * 0.08 +
      competitionSignals.buyBoxDifficultyScore * 0.1 +
      competitionSignals.fbaFbmFitScore * 0.07 +
      profitabilitySignals.marginScore * 0.13 +
      profitabilitySignals.roiScore * 0.1 +
      profitabilitySignals.feeRiskScore * 0.04 +
      keywordOpportunitySignals.differentiationOpportunityScore * 0.02 +
      keywordOpportunitySignals.listingWeaknessOpportunityScore * 0.02 -
      riskPenalty -
      reviewBarrierPenalty -
      lowMarginPenalty -
      missingDataPenalty,
    )

  return {
    ...demandSignals,
    ...competitionSignals,
    ...profitabilitySignals,
    ...restrictionRiskSignals,
    ...keywordOpportunitySignals,
    amazonWinnerScore,
  }
}

export function buildAmazonListingReadiness(
  input: ReturnType<typeof buildAmazonProductWinnerInput>,
  asinStrategy: AsinStrategy = buildAmazonAsinStrategy(input),
) {
  const titleReadinessScore =
    input.listingAssets.titleReady ? 100 : 35
  const bulletReadinessScore =
    input.listingAssets.bulletsReady ? 100 : 30
  const imageReadinessScore =
    input.listingAssets.imagePackageReady ? 100 : 20
  const backendKeywordReadinessScore =
    input.listingAssets.backendKeywordsReady && !hasPolicyBlockedKeywords(input) ? 100 : 25
  const categoryAttributeCompletenessScore =
    input.listingAssets.categoryAttributesComplete ? 100 : 30
  const complianceReadinessScore =
    input.listingAssets.complianceReady && asinStrategy !== "REJECT_FOR_NOW" ? 100 : 15
  const priceCompetitivenessScore =
    input.listingAssets.priceCompetitive ? 100 : 40
  const conversionReadinessScore =
    input.listingAssets.conversionReady ? 100 : 35
  const asinPenalty =
    asinStrategy === "NEED_GTIN_OR_EXEMPTION" || asinStrategy === "NEED_BRAND_APPROVAL"
      ? 15
      : asinStrategy === "REJECT_FOR_NOW"
        ? 35
        : 0
  const listingReadinessScore =
    clampScore(
      average([
        titleReadinessScore,
        bulletReadinessScore,
        imageReadinessScore,
        backendKeywordReadinessScore,
        categoryAttributeCompletenessScore,
        complianceReadinessScore,
        priceCompetitivenessScore,
        conversionReadinessScore,
      ]) - asinPenalty - input.missingData.length * 4,
    )

  return {
    asinStrategy,
    titleReadinessScore,
    bulletReadinessScore,
    imageReadinessScore,
    backendKeywordReadinessScore,
    categoryAttributeCompletenessScore,
    complianceReadinessScore,
    priceCompetitivenessScore,
    conversionReadinessScore,
    listingReadinessScore,
  }
}

export function buildAmazonProductDecision(
  input: ReturnType<typeof buildAmazonProductWinnerInput>,
  winnerScore: ReturnType<typeof buildAmazonWinnerScore>,
  listingReadiness: ReturnType<typeof buildAmazonListingReadiness>,
): AmazonProductDecision {
  if (listingReadiness.asinStrategy === "REJECT_FOR_NOW") {
    return "REJECT_FOR_NOW"
  }

  if (winnerScore.categoryRestrictionRisk >= 65 || input.categoryApprovalRequired) {
    return "REQUEST_CATEGORY_APPROVAL"
  }

  if (listingReadiness.asinStrategy === "NEED_BRAND_APPROVAL" || input.brandApprovalRequired) {
    return "REQUEST_BRAND_APPROVAL"
  }

  if (!input.supplierInvoiceAvailable || winnerScore.supplyRisk >= 70) {
    return "REQUEST_SUPPLIER_INVOICE"
  }

  if (listingReadiness.imageReadinessScore < 60) {
    return "REQUEST_IMAGE_PACKAGE"
  }

  if (input.missingData.length > 0 || listingReadiness.asinStrategy === "NEED_GTIN_OR_EXEMPTION") {
    return "RESEARCH_MORE"
  }

  if (winnerScore.amazonWinnerScore < 45) {
    return "REJECT_FOR_NOW"
  }

  if (winnerScore.amazonWinnerScore < 65 || listingReadiness.listingReadinessScore < 70) {
    return "WATCHLIST"
  }

  if (listingReadiness.asinStrategy === "SELL_ON_EXISTING_ASIN") {
    return "SELL_ON_EXISTING_ASIN"
  }

  return "CREATE_NEW_ASIN"
}

export function buildAmazonProductAssessment(
  candidate: AmazonProductCandidate,
  options: AmazonProductWinnerOptions = {},
) {
  const input =
    buildAmazonProductWinnerInput(candidate, options)
  const winnerScore =
    buildAmazonWinnerScore(input)
  const asinStrategy =
    buildAmazonAsinStrategy(input, winnerScore)
  const listingReadiness =
    buildAmazonListingReadiness(input, asinStrategy)
  const decision =
    buildAmazonProductDecision(input, winnerScore, listingReadiness)

  return {
    amazonProductWinnerMetricsVersion:
      AMAZON_PRODUCT_WINNER_METRICS_VERSION,
    sourceDataClass,
    input,
    winnerScore,
    listingReadiness,
    decision,
    blockedReasons:
      [
        winnerScore.categoryRestrictionRisk >= 65 ? "category approval required" : null,
        winnerScore.reviewBarrierScore < 45 ? "review barrier high" : null,
        winnerScore.marginScore < 35 ? "margin protection low" : null,
        input.missingData.length > 0 ? "missing data" : null,
        hasPolicyBlockedKeywords(input) ? "keyword or claims policy risk" : null,
      ].filter((entry): entry is string => entry !== null),
    amazonApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
  }
}

export function buildAmazonAssessmentQueue(
  candidates: AmazonProductCandidate[],
  options: AmazonProductWinnerOptions = {},
) {
  const limit =
    Math.max(1, Math.min(maxAssessmentQueue, Math.trunc(normalizeNumber(options.maxAssessments, maxAssessmentQueue))))
  const assessments =
    candidates
      .slice(0, limit)
      .map(candidate => buildAmazonProductAssessment(candidate, options))

  return {
    amazonProductWinnerMetricsVersion:
      AMAZON_PRODUCT_WINNER_METRICS_VERSION,
    sourceDataClass,
    inputProducts:
      candidates.length,
    assessmentsBuilt:
      assessments.length,
    assessments,
    amazonApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
  }
}

export function summarizeAmazonAssessmentQueue(queue: ReturnType<typeof buildAmazonAssessmentQueue>) {
  const assessments =
    queue.assessments

  return {
    inputProducts:
      queue.inputProducts,
    assessmentsBuilt:
      queue.assessmentsBuilt,
    existingAsinCandidates:
      assessments.filter(entry => entry.listingReadiness.asinStrategy === "SELL_ON_EXISTING_ASIN").length,
    newAsinCandidates:
      assessments.filter(entry => entry.listingReadiness.asinStrategy === "CREATE_NEW_ASIN").length,
    approvalRequiredCandidates:
      assessments.filter(entry => ["REQUEST_CATEGORY_APPROVAL", "REQUEST_BRAND_APPROVAL"].includes(entry.decision)).length,
    invoiceRequiredCandidates:
      assessments.filter(entry => entry.decision === "REQUEST_SUPPLIER_INVOICE").length,
    imagePackageRequiredCandidates:
      assessments.filter(entry => entry.decision === "REQUEST_IMAGE_PACKAGE").length,
    watchlistCandidates:
      assessments.filter(entry => entry.decision === "WATCHLIST").length,
    rejectedCandidates:
      assessments.filter(entry => entry.decision === "REJECT_FOR_NOW").length,
    averageAmazonWinnerScore:
      average(assessments.map(entry => entry.winnerScore.amazonWinnerScore)),
    averageListingReadinessScore:
      average(assessments.map(entry => entry.listingReadiness.listingReadinessScore)),
    productsBlockedByRestrictions:
      assessments.filter(entry => entry.blockedReasons.includes("category approval required")).length,
    productsBlockedByReviewBarrier:
      assessments.filter(entry => entry.blockedReasons.includes("review barrier high")).length,
    productsBlockedByLowMargin:
      assessments.filter(entry => entry.blockedReasons.includes("margin protection low")).length,
    productsBlockedByMissingData:
      assessments.filter(entry => entry.blockedReasons.includes("missing data")).length,
    amazonApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    nextLoop:
      "149B",
  }
}

export function getAmazonProductWinnerMetricsChecklist() {
  return [
    "Confirm whether the product belongs on an existing ASIN before considering a new ASIN.",
    "Do not create duplicate ASINs.",
    "Use winning keywords as research inputs only; do not copy exact title, bullets, images, claims, or brand text.",
    "Reject or hold products with unauthorized trademarks, medical claims, or unconfirmed claims.",
    "Check category, brand, hazmat, expiration, GTIN, invoice, and supply risks before listing.",
    "Keep this loop local and dry-run only: no Amazon API use, no Seller Central mutation, no publication, no staging mutation.",
  ]
}
