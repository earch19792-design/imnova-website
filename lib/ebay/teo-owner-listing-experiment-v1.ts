import {
  calculateEbayMinimumOperatorPrice,
  calculateEbayUnitEconomics,
  DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG,
} from "./ebay-unit-economics"

export const TEO_OWNER_LISTING_EXPERIMENT_VERSION =
  "TEO_OWNER_LISTING_EXPERIMENT_V1" as const

export const TEO_MINIMUM_NET_PROFIT_USD = 4 as const

export const TEO_VERIFIABLE_LISTING_VARIABLES = [
  "TITLE",
  "PRICE",
  "CATEGORY_ID",
  "CONDITION_ID",
  "SHIPPING_PRICE",
] as const

export type TeoVerifiableListingVariableV1 =
  typeof TEO_VERIFIABLE_LISTING_VARIABLES[number]

export type TeoOfficialListingSnapshotV1 = Readonly<{
  title: string | null
  price: number | null
  currency: string | null
  categoryId: string | null
  conditionId: string | null
  shippingPrice: number | null
  shippingCurrency: string | null
  listingStatus: string | null
  sku: string | null
  observedAt: string
}>

export type TeoPerformanceEvidenceV1 = Readonly<{
  reportDateFrom: string
  reportDateTo: string
  totalImpressions: number
  searchImpressions: number | null
  totalViews: number | null
  searchViews: number | null
  transactions: number | null
  observedAt: string
}>

export type TeoListingPriceDecisionV1 = Readonly<{
  status: "READY" | "PARTIAL" | "UNAVAILABLE"
  action: "LOWER_PRICE" | "RAISE_TO_SAFE_FLOOR" | "KEEP_PRICE" |
    "WAIT_FOR_EVIDENCE"
  currentItemPrice: number | null
  currentLandedPrice: number | null
  competitiveLandedPrice: number | null
  competitiveEvidence: "CONFIRMED_SOLD" | "ACTIVE_MARKET" | "UNAVAILABLE"
  minimumSafeItemPrice: number | null
  minimumSafeLandedPrice: number | null
  recommendedFinalItemPrice: number | null
  recommendedFinalLandedPrice: number | null
  suggestedDiscountUsd: number | null
  suggestedDiscountPercent: number | null
  maximumSafeDiscountUsd: number | null
  expectedNetProfitAtRecommended: number | null
  expectedMarginPercentAtRecommended: number | null
  currentExpectedNetProfit: number | null
  minimumNetProfitUsd: typeof TEO_MINIMUM_NET_PROFIT_USD
  safeToDiscount: boolean
  humanApprovalRequired: true
  automaticPriceChangeAllowed: false
  floorBasis: "CURRENT_PROVEN_COSTS_CONSERVATIVE_FEES" |
    "PERSISTED_COMPETITOR_ECONOMIC_FLOOR" | "UNAVAILABLE"
  reasonCodes: string[]
}>

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function finiteMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function buildTeoListingPriceDecisionV1(input: {
  currentItemPrice: unknown
  currentBuyerShipping: unknown
  supplierCost: unknown
  supplierShipping: unknown
  otherExplicitCosts: unknown
  currentExpectedNetProfit: unknown
  economicsProven: boolean
  competitiveLandedPrice: unknown
  competitiveEvidence: "CONFIRMED_SOLD" | "ACTIVE_MARKET" | "UNAVAILABLE"
  persistedStandardFloorLandedPrice?: unknown
  promotedListingsReserveRate?: unknown
  returnsReserveRate?: unknown
}): TeoListingPriceDecisionV1 {
  const currentItemPrice = finiteMoney(input.currentItemPrice)
  const buyerShipping = finiteMoney(input.currentBuyerShipping)
  const supplierCost = finiteMoney(input.supplierCost)
  const supplierShipping = finiteMoney(input.supplierShipping)
  const otherCosts = finiteMoney(input.otherExplicitCosts)
  const competitiveLandedPrice = finiteMoney(input.competitiveLandedPrice)
  const currentExpectedNetProfit = finiteNumber(input.currentExpectedNetProfit)
  const promotedRate = finiteMoney(input.promotedListingsReserveRate)
  const returnsRate = finiteMoney(input.returnsReserveRate)
  const currentLandedPrice = currentItemPrice !== null && buyerShipping !== null
    ? money(currentItemPrice + buyerShipping)
    : null

  const currentInputsReady = input.economicsProven && supplierCost !== null &&
    supplierShipping !== null && otherCosts !== null
  const combinedSupplierAndOtherCost = currentInputsReady
    ? money(supplierCost + otherCosts)
    : null
  const floor = combinedSupplierAndOtherCost === null ? null
    : calculateEbayMinimumOperatorPrice({
      supplierCost: combinedSupplierAndOtherCost,
    }, {
      estimatedOutboundShipping: supplierShipping as number,
      minimumNetProfit: TEO_MINIMUM_NET_PROFIT_USD,
      promotedListingsReserveRate: promotedRate ??
        DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.promotedListingsReserveRate,
      returnsReserveRate: returnsRate ??
        DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.returnsReserveRate,
    })
  const calculatedFloor = floor?.ready
    ? floor.minimumOperatorPrice
    : null
  const persistedFloor = finiteMoney(
    input.persistedStandardFloorLandedPrice,
  )
  const minimumSafeLandedPrice = calculatedFloor ?? persistedFloor
  const minimumSafeItemPrice = minimumSafeLandedPrice !== null &&
      buyerShipping !== null
    ? money(Math.max(0.01, minimumSafeLandedPrice - buyerShipping))
    : null
  const floorBasis = calculatedFloor !== null
    ? "CURRENT_PROVEN_COSTS_CONSERVATIVE_FEES" as const
    : persistedFloor !== null
      ? "PERSISTED_COMPETITOR_ECONOMIC_FLOOR" as const
      : "UNAVAILABLE" as const
  const reasonCodes = [
    currentItemPrice === null ? "CURRENT_ITEM_PRICE_MISSING" : null,
    buyerShipping === null ? "CURRENT_BUYER_SHIPPING_MISSING" : null,
    !currentInputsReady ? "CURRENT_PROVEN_ECONOMICS_MISSING" : null,
    minimumSafeLandedPrice === null ? "ECONOMIC_FLOOR_UNAVAILABLE" : null,
    competitiveLandedPrice === null ? "COMPETITIVE_PRICE_EVIDENCE_MISSING" : null,
    input.competitiveEvidence === "ACTIVE_MARKET"
      ? "ACTIVE_OFFERS_ARE_NOT_CONFIRMED_SALES" : null,
  ].filter((value): value is string => value !== null)
  if (currentItemPrice === null || buyerShipping === null ||
      currentLandedPrice === null || minimumSafeLandedPrice === null ||
      minimumSafeItemPrice === null) {
    return {
      status: currentItemPrice !== null || currentExpectedNetProfit !== null
        ? "PARTIAL" : "UNAVAILABLE",
      action: "WAIT_FOR_EVIDENCE",
      currentItemPrice,
      currentLandedPrice,
      competitiveLandedPrice,
      competitiveEvidence: input.competitiveEvidence,
      minimumSafeItemPrice,
      minimumSafeLandedPrice,
      recommendedFinalItemPrice: null,
      recommendedFinalLandedPrice: null,
      suggestedDiscountUsd: null,
      suggestedDiscountPercent: null,
      maximumSafeDiscountUsd: null,
      expectedNetProfitAtRecommended: null,
      expectedMarginPercentAtRecommended: null,
      currentExpectedNetProfit,
      minimumNetProfitUsd: TEO_MINIMUM_NET_PROFIT_USD,
      safeToDiscount: false,
      humanApprovalRequired: true,
      automaticPriceChangeAllowed: false,
      floorBasis,
      reasonCodes,
    }
  }

  const competitiveTarget = competitiveLandedPrice === null
    ? currentLandedPrice
    : Math.max(minimumSafeLandedPrice, competitiveLandedPrice)
  const recommendedFinalLandedPrice = currentLandedPrice < minimumSafeLandedPrice
    ? minimumSafeLandedPrice
    : Math.min(currentLandedPrice, competitiveTarget)
  const recommendedFinalItemPrice = money(Math.max(
    0.01,
    recommendedFinalLandedPrice - buyerShipping,
  ))
  const suggestedDiscountUsd = money(Math.max(
    0,
    currentItemPrice - recommendedFinalItemPrice,
  ))
  const maximumSafeDiscountUsd = money(Math.max(
    0,
    currentItemPrice - minimumSafeItemPrice,
  ))
  const expected = combinedSupplierAndOtherCost === null ? null
    : calculateEbayUnitEconomics({
      salePrice: recommendedFinalLandedPrice,
      supplierCost: combinedSupplierAndOtherCost,
    }, {
      estimatedOutboundShipping: supplierShipping as number,
      minimumNetProfit: TEO_MINIMUM_NET_PROFIT_USD,
      promotedListingsReserveRate: promotedRate ??
        DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.promotedListingsReserveRate,
      returnsReserveRate: returnsRate ??
        DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.returnsReserveRate,
    })
  const expectedProfit = expected?.ready
    ? expected.estimatedNetProfit
    : null
  const expectedMargin = expected?.ready
    ? expected.estimatedNetMarginPercent
    : null
  const safeToDiscount = suggestedDiscountUsd > 0 &&
    expected?.ready === true && expected.passesProfitGate &&
    (expectedProfit ?? Number.NEGATIVE_INFINITY) >= TEO_MINIMUM_NET_PROFIT_USD
  const action = currentLandedPrice < minimumSafeLandedPrice
    ? "RAISE_TO_SAFE_FLOOR" as const
    : safeToDiscount
      ? "LOWER_PRICE" as const
      : "KEEP_PRICE" as const
  return {
    status: expected?.ready ? "READY" : "PARTIAL",
    action,
    currentItemPrice,
    currentLandedPrice,
    competitiveLandedPrice,
    competitiveEvidence: input.competitiveEvidence,
    minimumSafeItemPrice,
    minimumSafeLandedPrice,
    recommendedFinalItemPrice: safeToDiscount || action === "RAISE_TO_SAFE_FLOOR"
      ? recommendedFinalItemPrice
      : currentItemPrice,
    recommendedFinalLandedPrice: safeToDiscount || action === "RAISE_TO_SAFE_FLOOR"
      ? recommendedFinalLandedPrice
      : currentLandedPrice,
    suggestedDiscountUsd: safeToDiscount ? suggestedDiscountUsd : 0,
    suggestedDiscountPercent: safeToDiscount && currentItemPrice > 0
      ? money((suggestedDiscountUsd / currentItemPrice) * 100)
      : 0,
    maximumSafeDiscountUsd,
    expectedNetProfitAtRecommended: expectedProfit,
    expectedMarginPercentAtRecommended: expectedMargin,
    currentExpectedNetProfit,
    minimumNetProfitUsd: TEO_MINIMUM_NET_PROFIT_USD,
    safeToDiscount,
    humanApprovalRequired: true,
    automaticPriceChangeAllowed: false,
    floorBasis,
    reasonCodes,
  }
}

export type TeoReadbackAssessmentV1 = Readonly<{
  readbackStatus: "PENDING_READBACK" | "VERIFIED_ON_EBAY"
  attributionStatus:
    | "UNASSESSED"
    | "CLEAN_SINGLE_VARIABLE"
    | "CONTAMINATED_MULTIPLE_VARIABLES"
  targetVariable: TeoVerifiableListingVariableV1
  changedVariables: TeoVerifiableListingVariableV1[]
  targetChangeObserved: boolean
  reasonCode:
    | "TARGET_CHANGE_NOT_OBSERVED_YET"
    | "EXPECTED_PRICE_NOT_OBSERVED_YET"
    | "TARGET_CHANGE_VERIFIED"
    | "MULTIPLE_VARIABLES_CHANGED"
}>

export type TeoListingRecommendationV1 = Readonly<{
  action: "IMPROVE" | "REPLACE_CANDIDATE" | "WAIT"
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
  diagnosisClass:
    | "VISIBILITY"
    | "CTR"
    | "CONVERSION"
    | "DATA_QUALITY"
    | "HEALTHY_WAIT"
  variable: TeoVerifiableListingVariableV1 | null
  headline: string
  rationale: string
  hypothesis: string | null
  metric: "IMPRESSIONS" | "LISTING_VIEWS" | "QUANTITY_SOLD" | null
  minimumEvidenceValue: number | null
  reasonCode: string
}>

function normalizedText(value: string | null) {
  return value?.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") ?? null
}

function normalizedMoney(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? null
    : Math.round(value * 100)
}

function variableValue(
  snapshot: TeoOfficialListingSnapshotV1,
  variable: TeoVerifiableListingVariableV1,
) {
  if (variable === "TITLE") return normalizedText(snapshot.title)
  if (variable === "PRICE") return normalizedMoney(snapshot.price)
  if (variable === "CATEGORY_ID") return snapshot.categoryId
  if (variable === "CONDITION_ID") return snapshot.conditionId
  return normalizedMoney(snapshot.shippingPrice)
}

export function buildTeoOfficialListingSnapshotV1(input: {
  title: string | null
  price: number | null
  currency: string | null
  categoryId: string | null
  conditionId: string | null
  shippingPrice: number | null
  shippingCurrency: string | null
  listingStatus: string | null
  sku: string | null
  observedAt: string
}): TeoOfficialListingSnapshotV1 {
  return {
    title: input.title?.trim() || null,
    price: input.price,
    currency: input.currency?.trim().toUpperCase() || null,
    categoryId: input.categoryId?.trim() || null,
    conditionId: input.conditionId?.trim() || null,
    shippingPrice: input.shippingPrice,
    shippingCurrency: input.shippingCurrency?.trim().toUpperCase() || null,
    listingStatus: input.listingStatus?.trim() || null,
    sku: input.sku?.trim() || null,
    observedAt: input.observedAt,
  }
}

export function assessTeoOfficialReadbackV1(input: {
  targetVariable: TeoVerifiableListingVariableV1
  baseline: TeoOfficialListingSnapshotV1
  observed: TeoOfficialListingSnapshotV1
  expectedPrice?: number | null
}): TeoReadbackAssessmentV1 {
  const changedVariables = TEO_VERIFIABLE_LISTING_VARIABLES.filter(
    (variable) => variableValue(input.baseline, variable) !==
      variableValue(input.observed, variable),
  )
  const targetChangeObserved = changedVariables.includes(input.targetVariable)
  const expectedPrice = finiteMoney(input.expectedPrice)
  const expectedPriceObserved = input.targetVariable !== "PRICE" ||
    expectedPrice === null || normalizedMoney(input.observed.price) ===
      normalizedMoney(expectedPrice)
  if (!targetChangeObserved) {
    return {
      readbackStatus: "PENDING_READBACK",
      attributionStatus: "UNASSESSED",
      targetVariable: input.targetVariable,
      changedVariables,
      targetChangeObserved,
      reasonCode: "TARGET_CHANGE_NOT_OBSERVED_YET",
    }
  }
  const contaminated = changedVariables.length > 1
  if (!contaminated && !expectedPriceObserved) return {
    readbackStatus: "PENDING_READBACK",
    attributionStatus: "UNASSESSED",
    targetVariable: input.targetVariable,
    changedVariables,
    targetChangeObserved: true,
    reasonCode: "EXPECTED_PRICE_NOT_OBSERVED_YET",
  }
  return {
    readbackStatus: "VERIFIED_ON_EBAY",
    attributionStatus: contaminated
      ? "CONTAMINATED_MULTIPLE_VARIABLES"
      : "CLEAN_SINGLE_VARIABLE",
    targetVariable: input.targetVariable,
    changedVariables,
    targetChangeObserved: true,
    reasonCode: contaminated
      ? "MULTIPLE_VARIABLES_CHANGED"
      : "TARGET_CHANGE_VERIFIED",
  }
}

function safeRate(numerator: number | null, denominator: number | null) {
  return numerator !== null && denominator !== null && denominator > 0
    ? (numerator / denominator) * 100
    : null
}

export function recommendTeoListingActionV1(input: {
  listingStatus: string | null
  performance: TeoPerformanceEvidenceV1 | null
  consecutiveZeroImpressionWindows?: number
  completedNegativeExperiments?: number
}): TeoListingRecommendationV1 {
  const active = input.listingStatus?.trim().toLocaleLowerCase("en-US") ===
    "active"
  if (!active) {
    return {
      action: "REPLACE_CANDIDATE",
      priority: "CRITICAL",
      diagnosisClass: "DATA_QUALITY",
      variable: null,
      headline: "Revisar reemplazo o reactivación",
      rationale: "La lectura oficial no muestra el listing como activo.",
      hypothesis: null,
      metric: null,
      minimumEvidenceValue: null,
      reasonCode: "LISTING_NOT_ACTIVE",
    }
  }
  if ((input.completedNegativeExperiments ?? 0) >= 2) {
    return {
      action: "REPLACE_CANDIDATE",
      priority: "HIGH",
      diagnosisClass: "CONVERSION",
      variable: null,
      headline: "Evaluar reemplazo del listing",
      rationale: "Dos experimentos limpios no produjeron una mejora de ventas.",
      hypothesis: null,
      metric: null,
      minimumEvidenceValue: null,
      reasonCode: "TWO_CLEAN_NEGATIVE_EXPERIMENTS",
    }
  }
  if ((input.consecutiveZeroImpressionWindows ?? 0) >= 2) {
    return {
      action: "REPLACE_CANDIDATE",
      priority: "HIGH",
      diagnosisClass: "VISIBILITY",
      variable: null,
      headline: "Evaluar reemplazo por falta de exposición",
      rationale: "El listing acumuló dos ventanas completas sin impresiones.",
      hypothesis: null,
      metric: null,
      minimumEvidenceValue: null,
      reasonCode: "TWO_ZERO_IMPRESSION_WINDOWS",
    }
  }
  if (!input.performance) {
    return {
      action: "WAIT",
      priority: "LOW",
      diagnosisClass: "HEALTHY_WAIT",
      variable: null,
      headline: "Esperar la primera ventana oficial",
      rationale: "Todavía no existe una base comparable para medir ventas.",
      hypothesis: null,
      metric: null,
      minimumEvidenceValue: null,
      reasonCode: "PERFORMANCE_BASELINE_REQUIRED",
    }
  }

  const performance = input.performance
  const clickThroughRate = safeRate(
    performance.searchViews,
    performance.searchImpressions,
  )
  const conversionRate = safeRate(
    performance.transactions,
    performance.totalViews,
  )
  if (performance.totalImpressions < 100) {
    return {
      action: "IMPROVE",
      priority: "HIGH",
      diagnosisClass: "VISIBILITY",
      variable: "TITLE",
      headline: "Mejorar el título",
      rationale: "La exposición es insuficiente; primero hay que aumentar descubrimiento.",
      hypothesis: "Un título más preciso y orientado a la búsqueda aumentará las impresiones.",
      metric: "IMPRESSIONS",
      minimumEvidenceValue: 100,
      reasonCode: "LOW_IMPRESSIONS",
    }
  }
  if (clickThroughRate !== null && clickThroughRate < 1) {
    return {
      action: "IMPROVE",
      priority: "HIGH",
      diagnosisClass: "CTR",
      variable: "TITLE",
      headline: "Reformular el título para ganar clics",
      rationale: `El CTR de búsqueda es ${clickThroughRate.toFixed(2)}%.`,
      hypothesis: "Un título más claro y relevante aumentará las visitas desde búsqueda.",
      metric: "LISTING_VIEWS",
      minimumEvidenceValue: 25,
      reasonCode: "LOW_SEARCH_CTR",
    }
  }
  if (
    performance.totalViews !== null && performance.totalViews >= 25 &&
    (conversionRate === null || conversionRate < 1)
  ) {
    return {
      action: "IMPROVE",
      priority: "HIGH",
      diagnosisClass: "CONVERSION",
      variable: "PRICE",
      headline: "Probar un ajuste de precio",
      rationale: "Hay visitas suficientes, pero la conversión a venta es menor de 1%.",
      hypothesis: "Un precio total más competitivo aumentará las transacciones.",
      metric: "LISTING_VIEWS",
      minimumEvidenceValue: 25,
      reasonCode: "LOW_CONVERSION_WITH_TRAFFIC",
    }
  }
  return {
    action: "WAIT",
    priority: "LOW",
    diagnosisClass: "HEALTHY_WAIT",
    variable: null,
    headline: "Mantener sin cambios",
    rationale: "No hay un cuello de botella suficientemente probado para intervenir hoy.",
    hypothesis: null,
    metric: null,
    minimumEvidenceValue: null,
    reasonCode: "NO_ACTIONABLE_SALES_BOTTLENECK",
  }
}

export type TeoExperimentOutcomeV1 = Readonly<{
  result: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "INCONCLUSIVE"
  baselineValue: number | null
  currentValue: number | null
  delta: number | null
  metric: "IMPRESSIONS" | "LISTING_VIEWS" | "QUANTITY_SOLD"
  reasonCode: string
}>

function outcomeMetric(
  variable: TeoVerifiableListingVariableV1,
  evidence: TeoPerformanceEvidenceV1,
) {
  if (variable === "TITLE" || variable === "CATEGORY_ID") {
    return {
      metric: "IMPRESSIONS" as const,
      value: evidence.totalImpressions,
      meaningfulDelta: Math.max(10, evidence.totalImpressions * 0.1),
    }
  }
  return {
    metric: "QUANTITY_SOLD" as const,
    value: evidence.transactions,
    meaningfulDelta: 1,
  }
}

export function evaluateTeoExperimentOutcomeV1(input: {
  variable: TeoVerifiableListingVariableV1
  baseline: TeoPerformanceEvidenceV1
  current: TeoPerformanceEvidenceV1
  attributionStatus:
    | "CLEAN_SINGLE_VARIABLE"
    | "CONTAMINATED_MULTIPLE_VARIABLES"
}): TeoExperimentOutcomeV1 {
  const baseline = outcomeMetric(input.variable, input.baseline)
  const current = outcomeMetric(input.variable, input.current)
  if (input.attributionStatus === "CONTAMINATED_MULTIPLE_VARIABLES") {
    return {
      result: "INCONCLUSIVE",
      baselineValue: baseline.value,
      currentValue: current.value,
      delta: null,
      metric: current.metric,
      reasonCode: "MULTIPLE_VARIABLES_CHANGED",
    }
  }
  if (baseline.value === null || current.value === null) {
    return {
      result: "INCONCLUSIVE",
      baselineValue: baseline.value,
      currentValue: current.value,
      delta: null,
      metric: current.metric,
      reasonCode: "COMPARABLE_METRIC_MISSING",
    }
  }
  const delta = current.value - baseline.value
  const threshold = input.variable === "TITLE" || input.variable === "CATEGORY_ID"
    ? Math.max(10, baseline.value * 0.1)
    : 1
  return {
    result: Math.abs(delta) < threshold
      ? "NEUTRAL"
      : delta > 0 ? "POSITIVE" : "NEGATIVE",
    baselineValue: baseline.value,
    currentValue: current.value,
    delta,
    metric: current.metric,
    reasonCode: Math.abs(delta) < threshold
      ? "CHANGE_BELOW_MEANINGFUL_THRESHOLD"
      : "COMPARABLE_POST_CHANGE_WINDOW",
  }
}
