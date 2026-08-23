import { createHash } from "node:crypto"

import {
  DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG,
  normalizeEbayUnitEconomicsConfig,
} from "./ebay-unit-economics"

export const SELLER_OS_PROFITABILITY_FRONTIER_VERSION =
  "SELLER_OS_PROFITABILITY_FRONTIER_V1" as const
export const SELLER_OS_DOLLAR_PRIORITY_SCORE_VERSION =
  "SELLER_OS_DOLLAR_PRIORITY_SCORE_V1" as const

const SHA256 = /^sha256:[0-9a-f]{64}$/
const LUNA_ID = /^\d{1,30}$/
const SAFE_SKU = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,119}$/
const TERMINAL_RESEARCH_BLOCKERS = new Set([
  "BOM_CONFLICT",
  "CONFIGURATION_CONFLICT",
  "FORBIDDEN_PRODUCT_POLICY",
  "LIVE_SKU_COLLISION",
  "POLICY_BLOCKER_PRESENT",
  "PRODUCT_ALREADY_PUBLISHED",
])

export type SellerOsEconomicInputAuthorityClassV1 =
  | "OFFICIAL_EXTERNAL_FACT"
  | "DIRECT_OBSERVATION"
  | "DURABLY_PERSISTED_FACT"
  | "DERIVED_FACT"
  | "INFERENCE"
  | "PROVISIONAL_ASSUMPTION"
  | "UNPROVEN"

export type SellerOsEconomicEvidenceV1 = Readonly<{
  authorityClass: SellerOsEconomicInputAuthorityClassV1
  reference: string
  evidenceDigest: string
  observedAt: string
  maximumAgeSeconds: number
}>

export type SellerOsShippingStatusV1 =
  | "SHIPPING_OBSERVED"
  | "SHIPPING_DURABLY_PERSISTED"
  | "SHIPPING_PROVISIONAL_RESERVE"
  | "SHIPPING_UNPROVEN"

export type SellerOsPriceScenarioSupportV1 =
  | "SUPPORTED"
  | "EXCLUDED_OUTLIER"
  | "UNPROVEN"

export type SellerOsEconomicClassificationV1 =
  | "ECONOMICALLY_DEAD"
  | "ECONOMICALLY_RECOVERABLE"
  | "ECONOMICALLY_PROMISING"
  | "ECONOMICS_UNPROVEN"

export type SellerOsNextEconomicEvidenceV1 =
  | "ACTUAL_LUNA_SHIPPING"
  | "BETTER_PRICE_DISTRIBUTION"
  | "CURRENT_EBAY_COMPETITION"
  | "EXACT_SUBTYPE_DEMAND"
  | "COMPLIANCE"
  | "LUNA_COST_CONFIRMATION"
  | "NONE"

export type SellerOsPriceScenarioV1 = Readonly<{
  valueUsd: number | null
  support: SellerOsPriceScenarioSupportV1
  evidence: SellerOsEconomicEvidenceV1
}>

export type SellerOsProfitabilityFrontierInputV1 = Readonly<{
  configurationId: string
  familyId: string
  familyName: string
  familyDemandStatus:
    | "FAMILY_DEMAND_PROVEN"
    | "FAMILY_DEMAND_SUPPORTED"
    | "FAMILY_DEMAND_UNPROVEN"
    | "FAMILY_DEMAND_UNAVAILABLE"
  lunaProductId: string
  lunaVariantId: string
  lunaSku: string
  productFit: "STRONG" | "MEDIUM" | "WEAK" | "UNPROVEN"
  components: readonly Readonly<{
    componentId: string
    unitCostUsd: number | null
    supplierQuantityRequired: number
    costEvidence: SellerOsEconomicEvidenceV1
    quantityEvidence: SellerOsEconomicEvidenceV1
  }>[]
  marketPrices: Readonly<{
    low: SellerOsPriceScenarioV1
    median: SellerOsPriceScenarioV1
    high: SellerOsPriceScenarioV1
  }>
  shipping: Readonly<{
    status: SellerOsShippingStatusV1
    valueUsd: number | null
    evidence: SellerOsEconomicEvidenceV1
  }>
  complianceStatus: "PASS" | "BLOCKED" | "UNPROVEN"
  currentHardBlockers: readonly string[]
  evidenceAcquisitionCost: "LOW" | "MEDIUM" | "HIGH"
  evaluatedAt: string
}>

type ScenarioKey = "LOW" | "MEDIAN" | "HIGH"

export type SellerOsProfitabilityScenarioResultV1 = Readonly<{
  scenario: ScenarioKey
  sellingPrice: number | null
  evidenceSupport: SellerOsPriceScenarioSupportV1
  usableForDecision: boolean
  ebayFeeEstimate: number | null
  returnsReserve: number | null
  promotedListingsReserve: number | null
  contributionProfit: number | null
  contributionMarginPercent: number | null
  passesTargetPolicy: boolean | null
}>

export type SellerOsProfitabilityFrontierV1 = Readonly<{
  contractVersion: typeof SELLER_OS_PROFITABILITY_FRONTIER_VERSION
  configurationId: string
  familyId: string
  familyName: string
  familyDemandStatus: SellerOsProfitabilityFrontierInputV1["familyDemandStatus"]
  lunaProductId: string
  lunaVariantId: string
  lunaSku: string
  productFit: SellerOsProfitabilityFrontierInputV1["productFit"]
  lunaUnitCost: number | null
  supplierQuantityRequired: number | null
  totalProductCost: number | null
  bomCost: number | null
  marketPriceMin: number | null
  marketPriceMedian: number | null
  marketPriceMax: number | null
  marketPriceEvidence: Readonly<{
    low: SellerOsPriceScenarioSupportV1
    median: SellerOsPriceScenarioSupportV1
    high: SellerOsPriceScenarioSupportV1
  }>
  shippingStatus: SellerOsShippingStatusV1
  provisionalShippingReserve: number | null
  shippingValue: number | null
  ebayFeeEstimateAtMedian: number | null
  otherVariableCostEstimateAtMedian: number | null
  contributionProfitAtMarketMedian: number | null
  contributionMarginAtMarketMedian: number | null
  breakEvenSellingPrice: number | null
  maxShippingAtBreakEven: number | null
  maxShippingAtTargetMargin: number | null
  maxProductCostAtTargetMargin: number | null
  minSellingPriceAtTargetMargin: number | null
  scenarios: Readonly<{
    low: SellerOsProfitabilityScenarioResultV1
    median: SellerOsProfitabilityScenarioResultV1
    high: SellerOsProfitabilityScenarioResultV1
  }>
  economicClassification: SellerOsEconomicClassificationV1
  failsCurrentProvisionalCase: boolean | null
  passesTargetAtZeroShippingAtMedian: boolean | null
  passesTargetAtZeroShippingAtBestSupportedPrice: boolean | null
  shippingEvidenceRequired: boolean
  currentHardBlockers: readonly string[]
  nextBestEvidence: SellerOsNextEconomicEvidenceV1
  nextEvidenceValue: "HIGH" | "MEDIUM" | "LOW" | "NEAR_ZERO"
  dollarPriorityScore: number | null
  dollarPriorityScoreVersion: typeof SELLER_OS_DOLLAR_PRIORITY_SCORE_VERSION | null
  dollarPriorityScoreAuthority: "INFERENCE" | null
  dollarPriorityComponents: Readonly<{
    familyDemandQuality: number
    productFit: number
    profitabilityHeadroom: number
    uncertaintyBurden: number
    evidenceAcquisitionCost: number
    evidenceAcquisitionCostClass: SellerOsProfitabilityFrontierInputV1["evidenceAcquisitionCost"]
    evidenceAcquisitionCostAuthority: "INFERENCE"
  }> | null
  researchEligible: boolean
  researchIneligibilityReasons: readonly string[]
  strongRecoverablePath: boolean
  targetMarginPolicy: Readonly<{
    status: "CANONICAL_EXISTING_PROVISIONAL_POLICY_REUSED"
    source: "SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1"
    minimumNetProfit: number
    minimumNetMarginPercent: number
    minimumRoiPercent: number
    phase6CanonicalAuthority: false
  }>
  inputAuthority: Readonly<{
    componentCosts: readonly SellerOsEconomicInputAuthorityClassV1[]
    componentQuantities: readonly SellerOsEconomicInputAuthorityClassV1[]
    marketLow: SellerOsEconomicInputAuthorityClassV1
    marketMedian: SellerOsEconomicInputAuthorityClassV1
    marketHigh: SellerOsEconomicInputAuthorityClassV1
    shipping: SellerOsEconomicInputAuthorityClassV1
    ebayFeePolicy: "PROVISIONAL_ASSUMPTION"
    returnsReservePolicy: "PROVISIONAL_ASSUMPTION"
    promotedListingsPolicy: "PROVISIONAL_ASSUMPTION"
  }>
  phase6CanonicalEconomicsAuthority: false
  unknownShippingTreatedAsZero: false
  listingAuthorized: false
  evaluatedAt: string
  frontierDigest: string
}>

function fail(code: string): never { throw new Error(code) }

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function ceilMoney(value: number) {
  return Math.ceil((value + 1e-9) * 100) / 100
}

function floorMoney(value: number) {
  // Maximum tolerated costs are capacity ceilings. Rounding them upward could
  // claim one cent more headroom than the policy actually permits.
  return Math.floor((value + 1e-9) * 100) / 100
}

function finite(value: unknown, code: string, allowNull = false) {
  if (value === null && allowNull) return null
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(code)
  return value
}

function boundedText(value: unknown, code: string, maximum = 240) {
  if (typeof value !== "string") fail(code)
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  if (!normalized || normalized.length > maximum) fail(code)
  return normalized
}

function safeReference(value: unknown, code: string) {
  const normalized = boundedText(value, code)
  if (!SAFE_REFERENCE.test(normalized)) fail(code)
  return normalized
}

function timestamp(value: unknown, code: string) {
  const normalized = boundedText(value, code, 40)
  const parsed = Date.parse(normalized)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) fail(code)
  return normalized
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"))
      .map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value))).digest("hex")}`
}

function evidence(input: SellerOsEconomicEvidenceV1, prefix: string) {
  if (!input || typeof input !== "object") fail(`${prefix}_EVIDENCE_INVALID`)
  if (!["OFFICIAL_EXTERNAL_FACT", "DIRECT_OBSERVATION", "DURABLY_PERSISTED_FACT",
    "DERIVED_FACT", "INFERENCE", "PROVISIONAL_ASSUMPTION", "UNPROVEN"]
    .includes(input.authorityClass)) fail(`${prefix}_AUTHORITY_INVALID`)
  const reference = safeReference(input.reference, `${prefix}_REFERENCE_INVALID`)
  if (!SHA256.test(input.evidenceDigest)) fail(`${prefix}_DIGEST_INVALID`)
  const observedAt = timestamp(input.observedAt, `${prefix}_OBSERVED_AT_INVALID`)
  if (!Number.isInteger(input.maximumAgeSeconds) || input.maximumAgeSeconds < 1 ||
      input.maximumAgeSeconds > 10 * 365 * 24 * 60 * 60) {
    fail(`${prefix}_MAXIMUM_AGE_INVALID`)
  }
  return Object.freeze({ ...input, reference, observedAt })
}

function fresh(item: SellerOsEconomicEvidenceV1, evaluatedAt: string) {
  const age = Date.parse(evaluatedAt) - Date.parse(item.observedAt)
  return age >= 0 && age <= item.maximumAgeSeconds * 1000
}

function authoritativeCost(item: SellerOsEconomicEvidenceV1) {
  return ["OFFICIAL_EXTERNAL_FACT", "DIRECT_OBSERVATION", "DURABLY_PERSISTED_FACT"]
    .includes(item.authorityClass)
}

function authoritativeMarket(item: SellerOsEconomicEvidenceV1) {
  return ["OFFICIAL_EXTERNAL_FACT", "DIRECT_OBSERVATION", "DURABLY_PERSISTED_FACT",
    "DERIVED_FACT"].includes(item.authorityClass)
}

function fixedFee(price: number, configured: number) {
  return price <= 10 ? Math.min(configured, 0.30) : Math.max(configured, 0.40)
}

function priceForConstraint(numeratorWithoutFixed: number, denominator: number,
  configuredFixedFee: number) {
  if (denominator <= 0) return null
  const lowTier = (numeratorWithoutFixed + Math.min(configuredFixedFee, 0.30)) /
    denominator
  if (lowTier <= 10) return ceilMoney(lowTier)
  return ceilMoney((numeratorWithoutFixed + Math.max(configuredFixedFee, 0.40)) /
    denominator)
}

function targetLimitsAtPrice(price: number, productCost: number, shipping: number,
  variableRate: number, config: ReturnType<typeof normalizeEbayUnitEconomicsConfig>) {
  const fixed = fixedFee(price, config.fixedOrderFee)
  const marginRate = config.minimumNetMarginPercent / 100
  const roiRate = config.minimumRoiPercent / 100
  const maxShipping = Math.min(
    price * (1 - variableRate) - fixed - productCost - config.minimumNetProfit,
    price * (1 - variableRate - marginRate) - fixed - productCost,
    price * (1 - variableRate) - fixed - productCost * (1 + roiRate),
  )
  const maxProductCost = Math.min(
    price * (1 - variableRate) - fixed - shipping - config.minimumNetProfit,
    price * (1 - variableRate - marginRate) - fixed - shipping,
    (price * (1 - variableRate) - fixed - shipping) / (1 + roiRate),
  )
  const minPrice = Math.max(
    priceForConstraint(productCost + shipping + config.minimumNetProfit,
      1 - variableRate, config.fixedOrderFee) ?? Number.POSITIVE_INFINITY,
    priceForConstraint(productCost + shipping,
      1 - variableRate - marginRate, config.fixedOrderFee) ?? Number.POSITIVE_INFINITY,
    priceForConstraint(productCost * (1 + roiRate) + shipping,
      1 - variableRate, config.fixedOrderFee) ?? Number.POSITIVE_INFINITY,
  )
  return Object.freeze({
    maxShipping: floorMoney(maxShipping),
    maxProductCost: floorMoney(maxProductCost),
    minPrice: Number.isFinite(minPrice) ? round(minPrice) : null,
  })
}

function priceEvidenceUsable(input: SellerOsPriceScenarioV1, evaluatedAt: string) {
  return input.support === "SUPPORTED" && input.valueUsd !== null &&
    authoritativeMarket(input.evidence) && fresh(input.evidence, evaluatedAt)
}

function scenario(scenarioName: ScenarioKey, input: SellerOsPriceScenarioV1,
  totalProductCost: number | null, shippingValue: number | null,
  evaluatedAt: string, economicsInputsReady: boolean,
  config: ReturnType<typeof normalizeEbayUnitEconomicsConfig>) {
  const price = input.valueUsd
  const usable = priceEvidenceUsable(input, evaluatedAt) && economicsInputsReady
  if (!usable || totalProductCost === null || shippingValue === null || price === null) {
    return Object.freeze({ scenario: scenarioName, sellingPrice: price,
      evidenceSupport: input.support, usableForDecision: usable,
      ebayFeeEstimate: null, returnsReserve: null, promotedListingsReserve: null,
      contributionProfit: null, contributionMarginPercent: null,
      passesTargetPolicy: null })
  }
  const fee = price * config.estimatedEbayFeeRate + fixedFee(price, config.fixedOrderFee)
  const returns = price * config.returnsReserveRate
  const promoted = price * config.promotedListingsReserveRate
  const profit = price - totalProductCost - shippingValue - fee - returns - promoted
  const margin = price > 0 ? profit / price * 100 : 0
  const roi = totalProductCost > 0 ? profit / totalProductCost * 100
    : profit > 0 ? Number.POSITIVE_INFINITY : 0
  return Object.freeze({
    scenario: scenarioName, sellingPrice: round(price),
    evidenceSupport: input.support, usableForDecision: true,
    ebayFeeEstimate: round(fee), returnsReserve: round(returns),
    promotedListingsReserve: round(promoted), contributionProfit: round(profit),
    contributionMarginPercent: round(margin),
    passesTargetPolicy: profit >= config.minimumNetProfit &&
      margin >= config.minimumNetMarginPercent && roi >= config.minimumRoiPercent,
  })
}

function passesAtZeroShipping(price: number | null, usable: boolean,
  productCost: number | null, variableRate: number,
  config: ReturnType<typeof normalizeEbayUnitEconomicsConfig>) {
  if (!usable || price === null || productCost === null) return null
  return targetLimitsAtPrice(price, productCost, 0, variableRate, config).maxShipping >= 0
}

function priorityScore(input: SellerOsProfitabilityFrontierInputV1,
  classification: SellerOsEconomicClassificationV1,
  bestTargetShipping: number | null, shippingValue: number | null) {
  if (classification === "ECONOMICALLY_DEAD") return null
  const demand = input.familyDemandStatus === "FAMILY_DEMAND_PROVEN" ? 25
    : input.familyDemandStatus === "FAMILY_DEMAND_SUPPORTED" ? 18 : 0
  const fit = input.productFit === "STRONG" ? 25
    : input.productFit === "MEDIUM" ? 15 : input.productFit === "WEAK" ? 5 : 0
  const headroom = bestTargetShipping === null ? 0
    : bestTargetShipping >= (shippingValue ?? Number.POSITIVE_INFINITY) ? 25
      : bestTargetShipping >= 4 ? 20 : bestTargetShipping >= 2 ? 14
        : bestTargetShipping >= 0 ? 7 : 0
  const uncertainty = classification === "ECONOMICALLY_PROMISING" ? 15
    : classification === "ECONOMICALLY_RECOVERABLE" ? 10 : 3
  const evidenceCost = input.evidenceAcquisitionCost === "LOW" ? 10
    : input.evidenceAcquisitionCost === "MEDIUM" ? 6 : 2
  return Object.freeze({
    familyDemandQuality: demand,
    productFit: fit,
    profitabilityHeadroom: headroom,
    uncertaintyBurden: uncertainty,
    evidenceAcquisitionCost: evidenceCost,
    evidenceAcquisitionCostClass: input.evidenceAcquisitionCost,
    evidenceAcquisitionCostAuthority: "INFERENCE" as const,
  })
}

export function calculateSellerOsProfitabilityFrontierV1(
  input: SellerOsProfitabilityFrontierInputV1,
): SellerOsProfitabilityFrontierV1 {
  const evaluatedAt = timestamp(input.evaluatedAt, "FRONTIER_EVALUATED_AT_INVALID")
  const configurationId = safeReference(input.configurationId,
    "FRONTIER_CONFIGURATION_ID_INVALID")
  const familyId = safeReference(input.familyId, "FRONTIER_FAMILY_ID_INVALID")
  const familyName = boundedText(input.familyName, "FRONTIER_FAMILY_NAME_INVALID", 160)
  if (!LUNA_ID.test(input.lunaProductId)) fail("FRONTIER_LUNA_PRODUCT_ID_INVALID")
  if (!LUNA_ID.test(input.lunaVariantId)) fail("FRONTIER_LUNA_VARIANT_ID_INVALID")
  if (!SAFE_SKU.test(input.lunaSku)) fail("FRONTIER_LUNA_SKU_INVALID")
  if (!["FAMILY_DEMAND_PROVEN", "FAMILY_DEMAND_SUPPORTED", "FAMILY_DEMAND_UNPROVEN",
    "FAMILY_DEMAND_UNAVAILABLE"].includes(input.familyDemandStatus)) {
    fail("FRONTIER_FAMILY_DEMAND_STATUS_INVALID")
  }
  if (!["STRONG", "MEDIUM", "WEAK", "UNPROVEN"].includes(input.productFit)) {
    fail("FRONTIER_PRODUCT_FIT_INVALID")
  }
  if (!["PASS", "BLOCKED", "UNPROVEN"].includes(input.complianceStatus)) {
    fail("FRONTIER_COMPLIANCE_STATUS_INVALID")
  }
  if (!["LOW", "MEDIUM", "HIGH"].includes(input.evidenceAcquisitionCost)) {
    fail("FRONTIER_EVIDENCE_ACQUISITION_COST_INVALID")
  }
  if (!Array.isArray(input.components) || input.components.length < 1 ||
      input.components.length > 20) fail("FRONTIER_COMPONENTS_INVALID")
  const seenComponents = new Set<string>()
  const components = input.components.map((item, index) => {
    const componentId = safeReference(item.componentId, "FRONTIER_COMPONENT_ID_INVALID")
    if (seenComponents.has(componentId)) fail("FRONTIER_COMPONENT_DUPLICATE")
    seenComponents.add(componentId)
    const unitCostUsd = finite(item.unitCostUsd, "FRONTIER_UNIT_COST_INVALID", true)
    if (!Number.isInteger(item.supplierQuantityRequired) ||
        item.supplierQuantityRequired < 1 || item.supplierQuantityRequired > 10_000) {
      fail("FRONTIER_SUPPLIER_QUANTITY_INVALID")
    }
    return Object.freeze({ componentId, unitCostUsd,
      supplierQuantityRequired: item.supplierQuantityRequired,
      costEvidence: evidence(item.costEvidence, `FRONTIER_COMPONENT_${index}_COST`),
      quantityEvidence: evidence(item.quantityEvidence,
        `FRONTIER_COMPONENT_${index}_QUANTITY`) })
  })
  const priceEntries = {
    low: { ...input.marketPrices.low,
      evidence: evidence(input.marketPrices.low.evidence, "FRONTIER_PRICE_LOW") },
    median: { ...input.marketPrices.median,
      evidence: evidence(input.marketPrices.median.evidence, "FRONTIER_PRICE_MEDIAN") },
    high: { ...input.marketPrices.high,
      evidence: evidence(input.marketPrices.high.evidence, "FRONTIER_PRICE_HIGH") },
  }
  for (const [name, item] of Object.entries(priceEntries)) {
    finite(item.valueUsd, `FRONTIER_PRICE_${name.toUpperCase()}_INVALID`, true)
    if (!["SUPPORTED", "EXCLUDED_OUTLIER", "UNPROVEN"].includes(item.support)) {
      fail(`FRONTIER_PRICE_${name.toUpperCase()}_SUPPORT_INVALID`)
    }
    if (item.support === "SUPPORTED" && item.valueUsd === null) {
      fail(`FRONTIER_PRICE_${name.toUpperCase()}_SUPPORTED_VALUE_MISSING`)
    }
  }
  const numericPrices = [priceEntries.low.valueUsd, priceEntries.median.valueUsd,
    priceEntries.high.valueUsd]
  if (numericPrices.every((item) => item !== null) &&
      !(Number(numericPrices[0]) <= Number(numericPrices[1]) &&
        Number(numericPrices[1]) <= Number(numericPrices[2]))) {
    fail("FRONTIER_PRICE_ORDER_INVALID")
  }
  const shippingEvidence = evidence(input.shipping.evidence, "FRONTIER_SHIPPING")
  const shippingValue = finite(input.shipping.valueUsd, "FRONTIER_SHIPPING_VALUE_INVALID", true)
  const shippingAuthority: Record<SellerOsShippingStatusV1,
    SellerOsEconomicInputAuthorityClassV1> = {
    SHIPPING_OBSERVED: "DIRECT_OBSERVATION",
    SHIPPING_DURABLY_PERSISTED: "DURABLY_PERSISTED_FACT",
    SHIPPING_PROVISIONAL_RESERVE: "PROVISIONAL_ASSUMPTION",
    SHIPPING_UNPROVEN: "UNPROVEN",
  }
  if (!(input.shipping.status in shippingAuthority)) fail("FRONTIER_SHIPPING_STATUS_INVALID")
  if (input.shipping.status === "SHIPPING_UNPROVEN") {
    if (shippingValue !== null || shippingEvidence.authorityClass !== "UNPROVEN") {
      fail("FRONTIER_UNPROVEN_SHIPPING_CONTRACT_INVALID")
    }
  } else if (shippingValue === null ||
      shippingEvidence.authorityClass !== shippingAuthority[input.shipping.status]) {
    fail("FRONTIER_SHIPPING_AUTHORITY_MISMATCH")
  }
  const hardBlockers = input.currentHardBlockers.map((item) => {
    const normalized = boundedText(item, "FRONTIER_HARD_BLOCKER_INVALID", 120)
    if (!SAFE_CODE.test(normalized)) fail("FRONTIER_HARD_BLOCKER_INVALID")
    return normalized
  })
  if (new Set(hardBlockers).size !== hardBlockers.length) {
    fail("FRONTIER_HARD_BLOCKER_DUPLICATE")
  }
  const costReady = components.every((item) => item.unitCostUsd !== null &&
    authoritativeCost(item.costEvidence) && fresh(item.costEvidence, evaluatedAt) &&
    authoritativeCost(item.quantityEvidence) && fresh(item.quantityEvidence, evaluatedAt))
  const totalProductCost = costReady ? components.reduce((sum, item) =>
    sum + Number(item.unitCostUsd) * item.supplierQuantityRequired, 0) : null
  const config = normalizeEbayUnitEconomicsConfig()
  const variableRate = config.estimatedEbayFeeRate + config.returnsReserveRate +
    config.promotedListingsReserveRate
  const shippingReady = input.shipping.status !== "SHIPPING_UNPROVEN" &&
    fresh(shippingEvidence, evaluatedAt)
  const economicsInputsReady = costReady && shippingReady
  const scenarioResults = Object.freeze({
    low: scenario("LOW", priceEntries.low, totalProductCost, shippingValue,
      evaluatedAt, economicsInputsReady, config),
    median: scenario("MEDIAN", priceEntries.median, totalProductCost, shippingValue,
      evaluatedAt, economicsInputsReady, config),
    high: scenario("HIGH", priceEntries.high, totalProductCost, shippingValue,
      evaluatedAt, economicsInputsReady, config),
  })
  const medianPriceUsable = priceEvidenceUsable(priceEntries.median, evaluatedAt)
  const medianUsable = scenarioResults.median.usableForDecision
  const medianPrice = priceEntries.median.valueUsd
  const medianLimits = medianUsable && medianPrice !== null && totalProductCost !== null
    ? targetLimitsAtPrice(medianPrice, totalProductCost, shippingValue ?? 0,
      variableRate, config) : null
  const medianShippingCapacity = medianPriceUsable && totalProductCost !== null &&
    medianPrice !== null ? targetLimitsAtPrice(medianPrice, totalProductCost, 0,
      variableRate, config).maxShipping : null
  const supportedPrices = [priceEntries.low, priceEntries.median, priceEntries.high]
    .filter((item) => priceEvidenceUsable(item, evaluatedAt) && item.valueUsd !== null)
    .sort((left, right) => Number(right.valueUsd) - Number(left.valueUsd))
  const bestSupportedPrice = supportedPrices[0]?.valueUsd ?? null
  const zeroMedian = passesAtZeroShipping(medianPrice, medianPriceUsable && costReady,
    totalProductCost, variableRate, config)
  const zeroBest = passesAtZeroShipping(bestSupportedPrice,
    bestSupportedPrice !== null && costReady, totalProductCost, variableRate, config)
  const contributionAtZeroShippingAtBestSupportedPrice =
    bestSupportedPrice !== null && totalProductCost !== null
    ? Number(bestSupportedPrice) * (1 - variableRate) -
      fixedFee(Number(bestSupportedPrice), config.fixedOrderFee) -
      totalProductCost
    : null
  let economicClassification: SellerOsEconomicClassificationV1
  if (!costReady || !medianPriceUsable || bestSupportedPrice === null) {
    economicClassification = "ECONOMICS_UNPROVEN"
  } else if (contributionAtZeroShippingAtBestSupportedPrice !== null &&
      contributionAtZeroShippingAtBestSupportedPrice <= 0) {
    economicClassification = "ECONOMICALLY_DEAD"
  } else if (!shippingReady) {
    economicClassification = "ECONOMICS_UNPROVEN"
  } else if (scenarioResults.median.passesTargetPolicy === true) {
    economicClassification = "ECONOMICALLY_PROMISING"
  } else if (zeroBest === true) {
    economicClassification = "ECONOMICALLY_RECOVERABLE"
  } else {
    economicClassification = "ECONOMICS_UNPROVEN"
  }
  const shippingEvidenceRequired = economicClassification !== "ECONOMICALLY_DEAD" &&
    (input.shipping.status === "SHIPPING_PROVISIONAL_RESERVE" ||
      input.shipping.status === "SHIPPING_UNPROVEN" || !shippingReady) &&
    scenarioResults.median.passesTargetPolicy !== true && zeroMedian === true
  let nextBestEvidence: SellerOsNextEconomicEvidenceV1 = "NONE"
  let nextEvidenceValue: SellerOsProfitabilityFrontierV1["nextEvidenceValue"] = "NEAR_ZERO"
  if (economicClassification !== "ECONOMICALLY_DEAD") {
    if (!costReady) {
      nextBestEvidence = "LUNA_COST_CONFIRMATION"; nextEvidenceValue = "HIGH"
    } else if (!medianPriceUsable || bestSupportedPrice === null) {
      nextBestEvidence = "BETTER_PRICE_DISTRIBUTION"; nextEvidenceValue = "HIGH"
    } else if (hardBlockers.includes("PRICE_DISTRIBUTION_SINGLE_COMPARABLE")) {
      nextBestEvidence = "BETTER_PRICE_DISTRIBUTION"; nextEvidenceValue = "HIGH"
    } else if (hardBlockers.includes("EXACT_SUBTYPE_DEMAND_UNPROVEN")) {
      nextBestEvidence = "EXACT_SUBTYPE_DEMAND"; nextEvidenceValue = "HIGH"
    } else if (shippingEvidenceRequired) {
      nextBestEvidence = "ACTUAL_LUNA_SHIPPING"; nextEvidenceValue = "HIGH"
    } else if (zeroMedian !== true || priceEntries.high.support !== "SUPPORTED") {
      // If zero shipping cannot clear the canonical thresholds at the median,
      // shipping alone is not the decision-changing fact. Validate the price
      // distribution before spending shipping or competition research budget.
      nextBestEvidence = "BETTER_PRICE_DISTRIBUTION"; nextEvidenceValue = "HIGH"
    } else if (input.complianceStatus !== "PASS") {
      nextBestEvidence = "COMPLIANCE"; nextEvidenceValue = "HIGH"
    } else {
      nextBestEvidence = "CURRENT_EBAY_COMPETITION"; nextEvidenceValue = "MEDIUM"
    }
  }
  const terminalBlockers = hardBlockers.filter((item) =>
    TERMINAL_RESEARCH_BLOCKERS.has(item))
  const researchIneligibilityReasons = input.complianceStatus === "BLOCKED"
    ? ["COMPLIANCE_BLOCKED", ...terminalBlockers] : terminalBlockers
  const researchEligible = researchIneligibilityReasons.length === 0
  const scoreComponents = priorityScore(input, economicClassification,
    medianShippingCapacity, shippingValue)
  const score = scoreComponents === null ? null : Math.max(0, Math.min(100,
    scoreComponents.familyDemandQuality + scoreComponents.productFit +
    scoreComponents.profitabilityHeadroom + scoreComponents.uncertaintyBurden +
    scoreComponents.evidenceAcquisitionCost))
  const strongRecoverablePath = economicClassification === "ECONOMICALLY_RECOVERABLE" &&
    researchEligible &&
    input.productFit === "STRONG" &&
    ["FAMILY_DEMAND_PROVEN", "FAMILY_DEMAND_SUPPORTED"].includes(input.familyDemandStatus) &&
    (medianShippingCapacity ?? -1) >= 0
  const breakEvenSellingPrice = economicsInputsReady && totalProductCost !== null &&
    shippingValue !== null
    ? priceForConstraint(totalProductCost + shippingValue, 1 - variableRate,
      config.fixedOrderFee) : null
  const outputWithoutDigest = {
    contractVersion: SELLER_OS_PROFITABILITY_FRONTIER_VERSION,
    configurationId, familyId, familyName,
    familyDemandStatus: input.familyDemandStatus,
    lunaProductId: input.lunaProductId, lunaVariantId: input.lunaVariantId,
    lunaSku: input.lunaSku, productFit: input.productFit,
    lunaUnitCost: components.length === 1 && costReady
      ? round(Number(components[0].unitCostUsd)) : null,
    supplierQuantityRequired: components.length === 1 && costReady
      ? components[0].supplierQuantityRequired : null,
    totalProductCost: totalProductCost === null ? null : round(totalProductCost),
    bomCost: components.length > 1 && totalProductCost !== null
      ? round(totalProductCost) : null,
    marketPriceMin: priceEntries.low.valueUsd === null ? null : round(priceEntries.low.valueUsd),
    marketPriceMedian: medianPrice === null ? null : round(medianPrice),
    marketPriceMax: priceEntries.high.valueUsd === null ? null : round(priceEntries.high.valueUsd),
    marketPriceEvidence: Object.freeze({ low: priceEntries.low.support,
      median: priceEntries.median.support, high: priceEntries.high.support }),
    shippingStatus: input.shipping.status,
    provisionalShippingReserve: input.shipping.status === "SHIPPING_PROVISIONAL_RESERVE"
      ? shippingValue : null,
    shippingValue,
    ebayFeeEstimateAtMedian: scenarioResults.median.ebayFeeEstimate,
    otherVariableCostEstimateAtMedian: scenarioResults.median.returnsReserve === null ||
      scenarioResults.median.promotedListingsReserve === null ? null
      : round(scenarioResults.median.returnsReserve +
        scenarioResults.median.promotedListingsReserve),
    contributionProfitAtMarketMedian: scenarioResults.median.contributionProfit,
    contributionMarginAtMarketMedian: scenarioResults.median.contributionMarginPercent,
    breakEvenSellingPrice,
    maxShippingAtBreakEven: medianUsable && medianPrice !== null &&
      totalProductCost !== null ? floorMoney(medianPrice * (1 - variableRate) -
        fixedFee(medianPrice, config.fixedOrderFee) - totalProductCost) : null,
    maxShippingAtTargetMargin: medianLimits?.maxShipping ?? null,
    maxProductCostAtTargetMargin: medianLimits && shippingValue !== null
      ? medianLimits.maxProductCost : null,
    minSellingPriceAtTargetMargin: medianLimits && shippingValue !== null
      ? medianLimits.minPrice : null,
    scenarios: scenarioResults, economicClassification,
    failsCurrentProvisionalCase: input.shipping.status === "SHIPPING_PROVISIONAL_RESERVE"
      ? scenarioResults.median.passesTargetPolicy === null ? null
        : !scenarioResults.median.passesTargetPolicy : null,
    passesTargetAtZeroShippingAtMedian: zeroMedian,
    passesTargetAtZeroShippingAtBestSupportedPrice: zeroBest,
    shippingEvidenceRequired,
    currentHardBlockers: Object.freeze([...hardBlockers]),
    nextBestEvidence, nextEvidenceValue,
    dollarPriorityScore: score,
    dollarPriorityScoreVersion: score === null ? null
      : SELLER_OS_DOLLAR_PRIORITY_SCORE_VERSION,
    dollarPriorityScoreAuthority: score === null ? null : "INFERENCE" as const,
    dollarPriorityComponents: scoreComponents,
    researchEligible,
    researchIneligibilityReasons: Object.freeze([...researchIneligibilityReasons]),
    strongRecoverablePath,
    targetMarginPolicy: Object.freeze({
      status: "CANONICAL_EXISTING_PROVISIONAL_POLICY_REUSED" as const,
      source: "SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1" as const,
      minimumNetProfit: config.minimumNetProfit,
      minimumNetMarginPercent: config.minimumNetMarginPercent,
      minimumRoiPercent: config.minimumRoiPercent,
      phase6CanonicalAuthority: false as const,
    }),
    inputAuthority: Object.freeze({
      componentCosts: Object.freeze(components.map((item) =>
        item.costEvidence.authorityClass)),
      componentQuantities: Object.freeze(components.map((item) =>
        item.quantityEvidence.authorityClass)),
      marketLow: priceEntries.low.evidence.authorityClass,
      marketMedian: priceEntries.median.evidence.authorityClass,
      marketHigh: priceEntries.high.evidence.authorityClass,
      shipping: shippingEvidence.authorityClass,
      ebayFeePolicy: "PROVISIONAL_ASSUMPTION" as const,
      returnsReservePolicy: "PROVISIONAL_ASSUMPTION" as const,
      promotedListingsPolicy: "PROVISIONAL_ASSUMPTION" as const,
    }),
    phase6CanonicalEconomicsAuthority: false as const,
    unknownShippingTreatedAsZero: false as const,
    listingAuthorized: false as const,
    evaluatedAt,
  }
  return Object.freeze({ ...outputWithoutDigest,
    frontierDigest: digest(outputWithoutDigest) })
}

export function selectSellerOsTopDollarResearchCandidatesV1(
  frontiers: readonly SellerOsProfitabilityFrontierV1[], maximum = 3,
) {
  if (!Number.isInteger(maximum) || maximum < 0 || maximum > 3) {
    fail("DOLLAR_RESEARCH_MAXIMUM_INVALID")
  }
  const seen = new Set<string>()
  for (const frontier of frontiers) {
    if (seen.has(frontier.configurationId)) fail("DOLLAR_RESEARCH_CONFIGURATION_DUPLICATE")
    seen.add(frontier.configurationId)
  }
  return Object.freeze(frontiers
    .filter((frontier) => frontier.researchEligible &&
      frontier.economicClassification !== "ECONOMICALLY_DEAD" &&
      frontier.dollarPriorityScore !== null && frontier.nextBestEvidence !== "NONE")
    .sort((left, right) => Number(right.dollarPriorityScore) -
      Number(left.dollarPriorityScore) ||
      left.configurationId.localeCompare(right.configurationId, "en-US"))
    .slice(0, maximum)
    .map((frontier) => Object.freeze({
      configurationId: frontier.configurationId,
      lunaProductId: frontier.lunaProductId,
      lunaVariantId: frontier.lunaVariantId,
      lunaSku: frontier.lunaSku,
      economicClassification: frontier.economicClassification,
      dollarPriorityScore: frontier.dollarPriorityScore,
      nextBestEvidence: frontier.nextBestEvidence,
      nextEvidenceValue: frontier.nextEvidenceValue,
    })))
}

export function evaluateSellerOsRadarExpansionFromProfitabilityV1(
  frontiers: readonly SellerOsProfitabilityFrontierV1[],
) {
  return Object.freeze({
    radarExpansionRequired: frontiers.some((item) =>
      item.researchEligible &&
      (item.economicClassification === "ECONOMICALLY_PROMISING" ||
      item.strongRecoverablePath)) ? "NO" as const : "YES" as const,
    economicallyPromisingCount: frontiers.filter((item) =>
      item.economicClassification === "ECONOMICALLY_PROMISING").length,
    strongRecoverableCount: frontiers.filter((item) =>
      item.strongRecoverablePath).length,
    phase6CanonicalEconomicsAuthority: false as const,
  })
}

export const SELLER_OS_CANONICAL_PROVISIONAL_ECONOMICS_POLICY_V1 = Object.freeze({
  ...DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG,
  targetMarginPolicy: "CANONICAL_EXISTING_PROVISIONAL_POLICY_REUSED" as const,
  phase6CanonicalAuthority: false as const,
})
