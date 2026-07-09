export const AMAZON_FEES_PROFIT_GUARD_ROI_VERSION =
  "AMAZON_FEES_PROFIT_GUARD_ROI_V1"

// @ts-ignore Node dry-runs import TypeScript modules directly.
import { buildAmazonReferralFeeEstimate as buildResolvedAmazonReferralFeeEstimate } from "./amazon-referral-fee-schedule.ts"

const sourceDataClass =
  "LOOP_149E_AMAZON_FEES_PROFIT_GUARD_ROI"

type RiskLevel =
  | "LOW"
  | "MEDIUM"
  | "HIGH"

type FulfillmentRecommendation =
  | "FBA_REVIEW_REQUIRED"
  | "FBM_REVIEW_REQUIRED"
  | "FBA_CANDIDATE"
  | "FBM_CANDIDATE"
  | "NEED_DIMENSIONS_WEIGHT"
  | "DO_NOT_FULFILL_YET"

type ProfitGuardDecision =
  | "PROFITABLE_CONTINUE"
  | "LOW_MARGIN_WATCHLIST"
  | "REJECT_LOW_ROI"
  | "REJECT_NEGATIVE_PROFIT"
  | "NEED_REAL_AMAZON_FEES"
  | "NEED_FBA_FBM_DECISION"
  | "PRICE_TOO_COMPETITIVE"
  | "BLOCKED_BY_RESTRICTION_GATE"
  | "CONTINUE_RESEARCH_ONLY"

type PriceRange = {
  min: number
  max: number
}

type ProfitGuardConfig = {
  minimumNetMarginPercent?: number | null
  minimumRoiPercent?: number | null
  priceRangeSpreadPercent?: number | null
  defaultReferralFeeRate?: number | null
  defaultAdReserveRate?: number | null
  defaultReturnReserveRate?: number | null
}

type FeesProfitEntry = {
  supplierSku?: string | null
  productTitle?: string | null
  brand?: string | null
  asinStrategyRecommendation?: string | null
  restrictionGateDecision?: string | null
  canProceedToFeesRoi?: boolean | null
  canProceedToListingPackage?: boolean | null
  humanReviewRequired?: boolean | null
  overallRestrictionRiskScore?: number | null
  blockedReasons?: string[] | null
  warnings?: string[] | null
  supplierCost?: number | null
  amazonSalePriceEstimate?: number | null
  referralFeeRateEstimate?: number | null
  fbaFeeEstimate?: number | null
  fbmCostEstimate?: number | null
  possibleAmazonCategory?: string | null
  referralFeeCategory?: string | null
  prepPackagingCostEstimate?: number | null
  shippingCostEstimate?: number | null
  advertisingReserveRate?: number | null
  returnReserveRate?: number | null
  weightOz?: number | null
  dimensionsKnown?: boolean | null
  fulfillmentPreference?: string | null
}

type FeesProfitFixture = {
  profitGuardConfig?: ProfitGuardConfig | null
  restrictionGateAssessments?: FeesProfitEntry[] | null
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

function normalizeNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null
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

function normalizePercentRate(value: unknown, fallback: number) {
  const rate =
    normalizeNumber(value, fallback)

  return Math.max(0, Math.min(1, rate))
}

function money(value: number) {
  return Number(value.toFixed(2))
}

function percent(value: number) {
  return Number(value.toFixed(2))
}

function average(values: number[]) {
  return values.length > 0
    ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2))
    : 0
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function buildConfig(config?: ProfitGuardConfig | null) {
  return {
    minimumNetMarginPercent:
      normalizeNumber(config?.minimumNetMarginPercent, 18),
    minimumRoiPercent:
      normalizeNumber(config?.minimumRoiPercent, 35),
    priceRangeSpreadPercent:
      normalizeNumber(config?.priceRangeSpreadPercent, 8),
    defaultReferralFeeRate:
      normalizePercentRate(config?.defaultReferralFeeRate, 0.15),
    defaultAdReserveRate:
      normalizePercentRate(config?.defaultAdReserveRate, 0.08),
    defaultReturnReserveRate:
      normalizePercentRate(config?.defaultReturnReserveRate, 0.04),
  }
}

export function buildAmazonFeesProfitGuardInput(
  entry: FeesProfitEntry,
  config?: ProfitGuardConfig | null,
) {
  const normalizedConfig =
    buildConfig(config)

  return {
    feesProfitGuardVersion:
      AMAZON_FEES_PROFIT_GUARD_ROI_VERSION,
    sourceDataClass,
    supplierSku:
      normalizeText(entry.supplierSku) ?? "unknown-supplier-sku",
    productTitle:
      normalizeText(entry.productTitle) ?? "Untitled Amazon profit guard candidate",
    brand:
      normalizeText(entry.brand) ?? "unbranded",
    asinStrategyRecommendation:
      normalizeText(entry.asinStrategyRecommendation) ?? "NEED_MORE_PRODUCT_DATA",
    restrictionGateDecision:
      normalizeText(entry.restrictionGateDecision) ?? "CONTINUE_RESEARCH_ONLY",
    canProceedToFeesRoi:
      normalizeBoolean(entry.canProceedToFeesRoi),
    canProceedToListingPackage:
      normalizeBoolean(entry.canProceedToListingPackage),
    humanReviewRequired:
      normalizeBoolean(entry.humanReviewRequired, true),
    overallRestrictionRiskScore:
      Math.max(0, Math.min(100, Math.round(normalizeNumber(entry.overallRestrictionRiskScore, 0)))),
    blockedReasons:
      normalizeArray(entry.blockedReasons),
    warnings:
      normalizeArray(entry.warnings),
    supplierCost:
      money(Math.max(0, normalizeNumber(entry.supplierCost, 0))),
    amazonSalePriceEstimate:
      money(Math.max(0, normalizeNumber(entry.amazonSalePriceEstimate, 0))),
    referralFeeRateEstimate:
      normalizePercentRate(entry.referralFeeRateEstimate, normalizedConfig.defaultReferralFeeRate),
    possibleAmazonCategory:
      normalizeText(entry.possibleAmazonCategory),
    referralFeeCategory:
      normalizeText(entry.referralFeeCategory) ?? normalizeText(entry.possibleAmazonCategory),
    fbaFeeEstimate:
      normalizeNullableNumber(entry.fbaFeeEstimate),
    fbmCostEstimate:
      normalizeNullableNumber(entry.fbmCostEstimate),
    prepPackagingCostEstimate:
      money(Math.max(0, normalizeNumber(entry.prepPackagingCostEstimate, 0))),
    shippingCostEstimate:
      money(Math.max(0, normalizeNumber(entry.shippingCostEstimate, 0))),
    advertisingReserveRate:
      normalizePercentRate(entry.advertisingReserveRate, normalizedConfig.defaultAdReserveRate),
    returnReserveRate:
      normalizePercentRate(entry.returnReserveRate, normalizedConfig.defaultReturnReserveRate),
    weightOz:
      normalizeNullableNumber(entry.weightOz),
    dimensionsKnown:
      normalizeBoolean(entry.dimensionsKnown),
    fulfillmentPreference:
      normalizeText(entry.fulfillmentPreference)?.toUpperCase() ?? "UNKNOWN",
    config:
      normalizedConfig,
  }
}

export function buildAmazonFulfillmentCostModel(input: ReturnType<typeof buildAmazonFeesProfitGuardInput>) {
  const missingDimensionsWeight =
    !input.dimensionsKnown || input.weightOz === null
  const fbaKnown =
    input.fbaFeeEstimate !== null
  const fbmKnown =
    input.fbmCostEstimate !== null
  const fulfillmentRecommendation: FulfillmentRecommendation =
    input.overallRestrictionRiskScore >= 90
      ? "DO_NOT_FULFILL_YET"
      : missingDimensionsWeight
        ? "NEED_DIMENSIONS_WEIGHT"
        : input.fulfillmentPreference === "FBA" && fbaKnown
          ? "FBA_CANDIDATE"
          : input.fulfillmentPreference === "FBM" && fbmKnown
            ? "FBM_CANDIDATE"
            : fbaKnown
              ? "FBA_REVIEW_REQUIRED"
              : fbmKnown
                ? "FBM_REVIEW_REQUIRED"
                : "NEED_DIMENSIONS_WEIGHT"
  const fulfillmentCostEstimate =
    fulfillmentRecommendation === "FBA_CANDIDATE" || fulfillmentRecommendation === "FBA_REVIEW_REQUIRED"
      ? input.fbaFeeEstimate ?? 0
      : fulfillmentRecommendation === "FBM_CANDIDATE" || fulfillmentRecommendation === "FBM_REVIEW_REQUIRED"
        ? input.fbmCostEstimate ?? 0
        : Math.max(input.fbaFeeEstimate ?? 0, input.fbmCostEstimate ?? 0)

  return {
    fulfillmentRecommendation,
    fulfillmentCostEstimate:
      money(fulfillmentCostEstimate),
    missingDimensionsWeight,
  }
}

export function buildAmazonReferralFeeEstimate(input: ReturnType<typeof buildAmazonFeesProfitGuardInput>) {
  return buildResolvedAmazonReferralFeeEstimate({
    category:
      input.referralFeeCategory ?? input.possibleAmazonCategory ?? null,
    salePrice:
      input.amazonSalePriceEstimate,
    productContext:
      [
        input.productTitle,
        input.brand,
        input.referralFeeCategory,
        input.possibleAmazonCategory,
      ].filter(Boolean).join(" "),
  })
}

export function buildAmazonFbaFeeEstimate(input: ReturnType<typeof buildAmazonFeesProfitGuardInput>) {
  return input.fbaFeeEstimate === null
    ? 0
    : money(input.fbaFeeEstimate)
}

export function buildAmazonFbmCostEstimate(input: ReturnType<typeof buildAmazonFeesProfitGuardInput>) {
  return input.fbmCostEstimate === null
    ? 0
    : money(input.fbmCostEstimate)
}

export function buildAmazonAdvertisingCostEstimate(input: ReturnType<typeof buildAmazonFeesProfitGuardInput>) {
  return money(input.amazonSalePriceEstimate * input.advertisingReserveRate)
}

export function buildAmazonReturnReserveEstimate(input: ReturnType<typeof buildAmazonFeesProfitGuardInput>) {
  return money(input.amazonSalePriceEstimate * input.returnReserveRate)
}

export function buildAmazonLandedCostEstimate(input: ReturnType<typeof buildAmazonFeesProfitGuardInput>) {
  return money(input.supplierCost + input.shippingCostEstimate + input.prepPackagingCostEstimate)
}

export function buildAmazonNetProfitEstimate(values: {
  amazonSalePriceEstimate: number
  totalCostEstimate: number
}) {
  return money(values.amazonSalePriceEstimate - values.totalCostEstimate)
}

export function buildAmazonRoiEstimate(values: {
  netProfitEstimate: number
  supplierCost: number
  amazonSalePriceEstimate: number
}) {
  return {
    netMarginPercent:
      values.amazonSalePriceEstimate > 0
        ? percent((values.netProfitEstimate / values.amazonSalePriceEstimate) * 100)
        : 0,
    roiPercent:
      values.supplierCost > 0
        ? percent((values.netProfitEstimate / values.supplierCost) * 100)
        : 0,
  }
}

export function buildAmazonBreakEvenPrice(values: {
  supplierCost: number
  fulfillmentCostEstimate: number
  prepPackagingCostEstimate: number
  shippingCostEstimate: number
  variableRate: number
}) {
  const fixedCost =
    values.supplierCost +
    values.fulfillmentCostEstimate +
    values.prepPackagingCostEstimate +
    values.shippingCostEstimate
  const denominator =
    Math.max(0.01, 1 - values.variableRate)

  return money(fixedCost / denominator)
}

export function buildAmazonMinimumProfitablePrice(values: {
  breakEvenPrice: number
  minimumNetMarginPercent: number
}) {
  const requiredMarginRate =
    Math.max(0, Math.min(0.8, values.minimumNetMarginPercent / 100))

  return money(values.breakEvenPrice / Math.max(0.01, 1 - requiredMarginRate))
}

export function buildAmazonRecommendedPriceRange(values: {
  minimumProfitablePrice: number
  amazonSalePriceEstimate: number
  priceRangeSpreadPercent: number
}): PriceRange {
  const spread =
    Math.max(0, values.priceRangeSpreadPercent / 100)
  const min =
    Math.max(values.minimumProfitablePrice, values.amazonSalePriceEstimate * (1 - spread))
  const max =
    Math.max(min, values.amazonSalePriceEstimate * (1 + spread))

  return {
    min:
      money(min),
    max:
      money(max),
  }
}

export function buildAmazonProfitGuardDecision(values: {
  input: ReturnType<typeof buildAmazonFeesProfitGuardInput>
  netProfitEstimate: number
  netMarginPercent: number
  roiPercent: number
  minimumProfitablePrice: number
  missingDimensionsWeight: boolean
}): ProfitGuardDecision {
  if (!values.input.canProceedToFeesRoi || values.input.restrictionGateDecision === "REJECT_FOR_NOW") {
    return "BLOCKED_BY_RESTRICTION_GATE"
  }

  if (values.missingDimensionsWeight) {
    return "NEED_FBA_FBM_DECISION"
  }

  if (values.input.fbaFeeEstimate === null && values.input.fbmCostEstimate === null) {
    return "NEED_REAL_AMAZON_FEES"
  }

  if (values.netProfitEstimate <= 0) {
    return "REJECT_NEGATIVE_PROFIT"
  }

  if (values.input.amazonSalePriceEstimate < values.minimumProfitablePrice) {
    return "PRICE_TOO_COMPETITIVE"
  }

  if (values.roiPercent < values.input.config.minimumRoiPercent) {
    return values.roiPercent < values.input.config.minimumRoiPercent * 0.65
      ? "REJECT_LOW_ROI"
      : "LOW_MARGIN_WATCHLIST"
  }

  if (values.netMarginPercent < values.input.config.minimumNetMarginPercent) {
    return "LOW_MARGIN_WATCHLIST"
  }

  return values.input.humanReviewRequired
    ? "CONTINUE_RESEARCH_ONLY"
    : "PROFITABLE_CONTINUE"
}

export function buildAmazonFeesProfitGuardAssessment(
  entry: FeesProfitEntry,
  config?: ProfitGuardConfig | null,
) {
  const input =
    buildAmazonFeesProfitGuardInput(entry, config)
  const fulfillment =
    buildAmazonFulfillmentCostModel(input)
  const referralFeeEstimate =
    buildAmazonReferralFeeEstimate(input)
  const fbaFeeEstimate =
    buildAmazonFbaFeeEstimate(input)
  const fbmCostEstimate =
    buildAmazonFbmCostEstimate(input)
  const advertisingReserveEstimate =
    buildAmazonAdvertisingCostEstimate(input)
  const returnReserveEstimate =
    buildAmazonReturnReserveEstimate(input)
  const landedCostEstimate =
    buildAmazonLandedCostEstimate(input)
  const totalAmazonFeeEstimate =
    money(referralFeeEstimate.referralFeeAmount + fulfillment.fulfillmentCostEstimate)
  const totalCostEstimate =
    money(
      input.supplierCost +
      referralFeeEstimate.referralFeeAmount +
      fulfillment.fulfillmentCostEstimate +
      input.prepPackagingCostEstimate +
      input.shippingCostEstimate +
      advertisingReserveEstimate +
      returnReserveEstimate,
    )
  const netProfitEstimate =
    buildAmazonNetProfitEstimate({
      amazonSalePriceEstimate:
        input.amazonSalePriceEstimate,
      totalCostEstimate,
    })
  const roi =
    buildAmazonRoiEstimate({
      netProfitEstimate,
      supplierCost:
        input.supplierCost,
      amazonSalePriceEstimate:
        input.amazonSalePriceEstimate,
    })
  const variableRate =
    (referralFeeEstimate.effectiveReferralFeePercent / 100) +
    input.advertisingReserveRate +
    input.returnReserveRate
  const breakEvenPrice =
    buildAmazonBreakEvenPrice({
      supplierCost:
        input.supplierCost,
      fulfillmentCostEstimate:
        fulfillment.fulfillmentCostEstimate,
      prepPackagingCostEstimate:
        input.prepPackagingCostEstimate,
      shippingCostEstimate:
        input.shippingCostEstimate,
      variableRate,
    })
  const minimumProfitablePrice =
    buildAmazonMinimumProfitablePrice({
      breakEvenPrice,
      minimumNetMarginPercent:
        input.config.minimumNetMarginPercent,
    })
  const recommendedPriceRange =
    buildAmazonRecommendedPriceRange({
      minimumProfitablePrice,
      amazonSalePriceEstimate:
        input.amazonSalePriceEstimate,
      priceRangeSpreadPercent:
        input.config.priceRangeSpreadPercent,
    })
  const profitGuardDecision =
    buildAmazonProfitGuardDecision({
      input,
      netProfitEstimate,
      netMarginPercent:
        roi.netMarginPercent,
      roiPercent:
        roi.roiPercent,
      minimumProfitablePrice,
      missingDimensionsWeight:
        fulfillment.missingDimensionsWeight,
    })
  const productsBlockedFromListingPackage =
    !input.canProceedToListingPackage
  const canProceedToNextDecisionEngine =
    input.canProceedToFeesRoi &&
    netProfitEstimate > 0 &&
    profitGuardDecision !== "REJECT_NEGATIVE_PROFIT" &&
    profitGuardDecision !== "REJECT_LOW_ROI" &&
    profitGuardDecision !== "PRICE_TOO_COMPETITIVE"
  const priceCompetitivenessRisk: RiskLevel =
    input.amazonSalePriceEstimate < minimumProfitablePrice
      ? "HIGH"
      : input.amazonSalePriceEstimate < minimumProfitablePrice * 1.08
        ? "MEDIUM"
        : "LOW"
  const priceWarRisk: RiskLevel =
    roi.netMarginPercent < input.config.minimumNetMarginPercent
      ? "HIGH"
      : roi.netMarginPercent < input.config.minimumNetMarginPercent + 5
        ? "MEDIUM"
        : "LOW"
  const blockedReasons =
    unique([
      ...input.blockedReasons,
      !input.canProceedToFeesRoi ? "restriction gate blocks fees ROI continuation" : "",
      productsBlockedFromListingPackage ? "listing package remains blocked by prior gates" : "",
      fulfillment.missingDimensionsWeight ? "dimensions or weight needed for reliable FBA/FBM estimate" : "",
      netProfitEstimate <= 0 ? "estimated net profit is not positive" : "",
      roi.roiPercent < input.config.minimumRoiPercent ? "estimated ROI below guardrail" : "",
      input.amazonSalePriceEstimate < minimumProfitablePrice ? "sale price estimate below minimum profitable price" : "",
    ].filter(Boolean))
  const warnings =
    unique([
      ...input.warnings,
      "Amazon fees are estimates only until Seller Central or SP-API confirms real fees",
      ...referralFeeEstimate.warnings,
      profitGuardDecision === "BLOCKED_BY_RESTRICTION_GATE" ? "positive margin cannot override restriction gate" : "",
      fulfillment.missingDimensionsWeight ? "FBA/FBM decision needs dimensions and weight" : "",
    ].filter(Boolean))

  return {
    feesProfitGuardVersion:
      AMAZON_FEES_PROFIT_GUARD_ROI_VERSION,
    sourceDataClass,
    supplierSku:
      input.supplierSku,
    productTitle:
      input.productTitle,
    brand:
      input.brand,
    asinStrategyRecommendation:
      input.asinStrategyRecommendation,
    restrictionGateDecision:
      input.restrictionGateDecision,
    canProceedToFeesRoi:
      input.canProceedToFeesRoi,
    canProceedToListingPackage:
      false,
    supplierCost:
      input.supplierCost,
    amazonSalePriceEstimate:
      input.amazonSalePriceEstimate,
    referralFeeScheduleVersion:
      referralFeeEstimate.referralFeeScheduleVersion,
    referralFeeCategory:
      referralFeeEstimate.categoryLabel,
    referralFeeRuleType:
      referralFeeEstimate.feeRuleType,
    referralFeeAmount:
      referralFeeEstimate.referralFeeAmount,
    effectiveReferralFeePercent:
      referralFeeEstimate.effectiveReferralFeePercent,
    referralFeeMinimumApplied:
      referralFeeEstimate.minimumFeeApplied,
    referralFeeCategoryConfidence:
      referralFeeEstimate.categoryConfidence,
    sellerCentralFeeVerified:
      false,
    spApiFeeVerified:
      false,
    referralFeeWarnings:
      referralFeeEstimate.warnings,
    referralFeeEstimate:
      referralFeeEstimate.referralFeeAmount,
    fbaFeeEstimate,
    fbmCostEstimate,
    prepPackagingCostEstimate:
      input.prepPackagingCostEstimate,
    shippingCostEstimate:
      input.shippingCostEstimate,
    advertisingReserveEstimate,
    returnReserveEstimate,
    totalAmazonFeeEstimate,
    totalCostEstimate,
    landedCostEstimate,
    netProfitEstimate,
    netMarginPercent:
      roi.netMarginPercent,
    roiPercent:
      roi.roiPercent,
    breakEvenPrice,
    minimumProfitablePrice,
    recommendedPriceRange,
    priceFloor:
      recommendedPriceRange.min,
    priceCeiling:
      recommendedPriceRange.max,
    priceCompetitivenessRisk,
    priceWarRisk,
    fulfillmentRecommendation:
      fulfillment.fulfillmentRecommendation,
    profitGuardDecision,
    productsBlockedFromListingPackage,
    canProceedToNextDecisionEngine,
    humanReviewRequired:
      true,
    blockedReasons,
    warnings,
    nextRecommendedAction:
      profitGuardDecision,
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    scraperUsed:
      false,
  }
}

export function buildAmazonFeesProfitGuardQueue(fixture: FeesProfitFixture) {
  const restrictionGateAssessments =
    fixture.restrictionGateAssessments ?? []
  const assessments =
    restrictionGateAssessments.map(entry =>
      buildAmazonFeesProfitGuardAssessment(entry, fixture.profitGuardConfig),
    )

  return {
    feesProfitGuardVersion:
      AMAZON_FEES_PROFIT_GUARD_ROI_VERSION,
    sourceDataClass,
    inputRestrictionGateAssessments:
      restrictionGateAssessments.length,
    feesProfitAssessmentsBuilt:
      assessments.length,
    assessments,
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    scraperUsed:
      false,
    nextLoop:
      "149F",
  }
}

export function summarizeAmazonFeesProfitGuardQueue(queue: ReturnType<typeof buildAmazonFeesProfitGuardQueue>) {
  const assessments =
    queue.assessments
  const dm0628nAssessment =
    assessments.find(entry => entry.supplierSku === "luna-portex:first_real_mini_scan:dm0628n")

  return {
    inputRestrictionGateAssessments:
      queue.inputRestrictionGateAssessments,
    feesProfitAssessmentsBuilt:
      queue.feesProfitAssessmentsBuilt,
    productsEligibleForFeesRoi:
      assessments.filter(entry => entry.canProceedToFeesRoi).length,
    productsBlockedByRestrictionGate:
      assessments.filter(entry => entry.profitGuardDecision === "BLOCKED_BY_RESTRICTION_GATE").length,
    profitableContinueCandidates:
      assessments.filter(entry => entry.profitGuardDecision === "PROFITABLE_CONTINUE").length,
    lowMarginWatchlistCandidates:
      assessments.filter(entry => entry.profitGuardDecision === "LOW_MARGIN_WATCHLIST").length,
    rejectedLowRoiCandidates:
      assessments.filter(entry => entry.profitGuardDecision === "REJECT_LOW_ROI").length,
    rejectedNegativeProfitCandidates:
      assessments.filter(entry => entry.profitGuardDecision === "REJECT_NEGATIVE_PROFIT").length,
    needRealAmazonFeesCandidates:
      assessments.filter(entry => entry.profitGuardDecision === "NEED_REAL_AMAZON_FEES").length,
    needFbaFbmDecisionCandidates:
      assessments.filter(entry => entry.profitGuardDecision === "NEED_FBA_FBM_DECISION").length,
    priceTooCompetitiveCandidates:
      assessments.filter(entry => entry.profitGuardDecision === "PRICE_TOO_COMPETITIVE").length,
    productsWithPositiveNetProfit:
      assessments.filter(entry => entry.netProfitEstimate > 0).length,
    productsWithNegativeNetProfit:
      assessments.filter(entry => entry.netProfitEstimate <= 0).length,
    productsAboveMinimumMargin:
      assessments.filter(entry => entry.netMarginPercent >= 18).length,
    productsBelowMinimumMargin:
      assessments.filter(entry => entry.netMarginPercent < 18).length,
    averageNetProfitEstimate:
      average(assessments.map(entry => entry.netProfitEstimate)),
    averageNetMarginPercent:
      average(assessments.map(entry => entry.netMarginPercent)),
    averageRoiPercent:
      average(assessments.map(entry => entry.roiPercent)),
    averageBreakEvenPrice:
      average(assessments.map(entry => entry.breakEvenPrice)),
    averageMinimumProfitablePrice:
      average(assessments.map(entry => entry.minimumProfitablePrice)),
    productsBlockedFromListingPackage:
      assessments.filter(entry => entry.productsBlockedFromListingPackage).length,
    productsAllowedToNextDecisionEngine:
      assessments.filter(entry => entry.canProceedToNextDecisionEngine).length,
    productsRequiringHumanReview:
      assessments.filter(entry => entry.humanReviewRequired).length,
    referralFeeScheduleUsed:
      assessments.every(entry => Boolean(entry.referralFeeScheduleVersion)),
    referralFeeCategoriesResolved:
      assessments.filter(entry => entry.referralFeeCategory).length,
    uncertainReferralFeeCategories:
      assessments.filter(entry => entry.referralFeeCategoryConfidence !== "HIGH").length,
    sellerCentralFeeVerified:
      false,
    spApiFeeVerified:
      false,
    dm0628nNetProfitEstimate:
      dm0628nAssessment?.netProfitEstimate ?? 0,
    dm0628nRoiPercent:
      dm0628nAssessment?.roiPercent ?? 0,
    dm0628nReferralFeeAmount:
      dm0628nAssessment?.referralFeeAmount ?? 0,
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    scraperUsed:
      false,
    nextLoop:
      "149F",
  }
}

export function getAmazonFeesProfitGuardRoiChecklist() {
  return [
    "Calculate estimated supplier cost, fulfillment, referral fee, prep, shipping, ads, returns, net profit, margin, ROI, break-even, and minimum profitable price.",
    "Treat all Amazon fees as local estimates until Seller Central or SP-API confirms actual fee previews.",
    "Do not let positive ROI override restriction, hazmat, chemical, electrical, brand, category, invoice, or GTIN gates.",
    "Use a recommended price range, not a single rigid price.",
    "Reject or watchlist products with negative profit, low ROI, or sale price below minimum profitable price.",
    "Keep LOOP 149E local only: no Amazon connection, no Selling Partner API, no Seller Central mutation, no scraper, no publication.",
  ]
}
