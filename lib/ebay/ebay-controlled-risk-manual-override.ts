// @ts-expect-error Node's native TypeScript test runner requires an explicit extension.
import { calculateEbayMinimumOperatorPrice, calculateEbayUnitEconomics, normalizeEbayUnitEconomicsConfig, type EbayUnitEconomicsConfig } from "./ebay-unit-economics.ts"

export const EBAY_CONTROLLED_RISK_OVERRIDE_VERSION =
  "EBAY_CONTROLLED_RISK_MANUAL_OVERRIDE_V1_2026_07_19"
export const EBAY_CONTROLLED_RISK_MINIMUM_MARGIN_PERCENT = 10

const ALLOWED_COMMERCIAL_BLOCKERS = new Set([
  "ECONOMICS_NOT_VIABLE",
  "MARKET_PRICE_BELOW_MINIMUM_SAFE_PRICE",
])

export type ControlledRiskOverrideInput = {
  supplierCost: unknown
  operatorSalePrice?: unknown
  exactSoldReferenceTotalBuyerPrice: unknown
  confirmedSoldExactQuantity: unknown
  exactIdentityConfirmed: boolean
  exactOfferPackVerified: boolean
  lunaAvailable: boolean
  evidenceFresh: boolean
  decisionFresh: boolean
  decisionPackageHashMatches: boolean
  factsReady: boolean
  shippingEstimateReady: boolean
  decisionVerdict: unknown
  decisionBlockers: unknown
  baseConfig?: Partial<EbayUnitEconomicsConfig>
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : []
}

function money(value: number) {
  return Math.round(value * 100) / 100
}

export function controlledRiskEconomicsConfig(
  baseConfig: Partial<EbayUnitEconomicsConfig> = {},
) {
  return normalizeEbayUnitEconomicsConfig({
    ...baseConfig,
    promotedListingsReserveRate: 0,
    minimumNetProfit: 0.01,
    minimumNetMarginPercent: EBAY_CONTROLLED_RISK_MINIMUM_MARGIN_PERCENT,
    minimumRoiPercent: 0,
  })
}

export function evaluateControlledRiskManualOverride(input: ControlledRiskOverrideInput) {
  const supplierCost = number(input.supplierCost)
  const competitiveCeiling = number(input.exactSoldReferenceTotalBuyerPrice)
  const confirmedSoldExactQuantity = Math.max(0,
    Math.trunc(number(input.confirmedSoldExactQuantity) ?? 0))
  const decisionBlockers = strings(input.decisionBlockers)
  const unsupportedDecisionBlockers = decisionBlockers.filter((blocker) =>
    !ALLOWED_COMMERCIAL_BLOCKERS.has(blocker))
  const hasEconomicDecisionBlocker = decisionBlockers.some((blocker) =>
    ALLOWED_COMMERCIAL_BLOCKERS.has(blocker))
  const config = controlledRiskEconomicsConfig(input.baseConfig)
  const floor = calculateEbayMinimumOperatorPrice({ supplierCost }, config)
  const minimumRiskPrice = floor.ready ? floor.minimumOperatorPrice : null
  const blockers = [
    ...(input.decisionVerdict === "NO_GO" ? [] : ["CONTROLLED_RISK_REQUIRES_NO_GO_DECISION"]),
    ...(hasEconomicDecisionBlocker
      ? [] : ["ECONOMICS_ONLY_NO_GO_REQUIRED"]),
    ...(unsupportedDecisionBlockers.length ? ["NON_ECONOMIC_DECISION_BLOCKER"] : []),
    ...(input.exactIdentityConfirmed ? [] : ["EXACT_IDENTITY_REQUIRED"]),
    ...(input.exactOfferPackVerified ? [] : ["EXACT_OFFER_PACK_REQUIRED"]),
    ...(input.lunaAvailable ? [] : ["LUNA_AVAILABILITY_REQUIRED"]),
    ...(input.evidenceFresh ? [] : ["FRESH_EVIDENCE_REQUIRED"]),
    ...(input.decisionFresh ? [] : ["FRESH_DECISION_PACKAGE_REQUIRED"]),
    ...(input.decisionPackageHashMatches ? [] : ["DECISION_PACKAGE_HASH_MISMATCH"]),
    ...(input.factsReady ? [] : ["VERIFIED_PRODUCT_FACTS_REQUIRED"]),
    ...(input.shippingEstimateReady ? [] : ["SHIPPING_ESTIMATE_REQUIRED"]),
    ...(confirmedSoldExactQuantity > 0 ? [] : ["CONFIRMED_SOLD_EXACT_REQUIRED"]),
    ...(competitiveCeiling !== null && competitiveCeiling > 0
      ? [] : ["EXACT_SOLD_COMPETITIVE_REFERENCE_REQUIRED"]),
    ...(minimumRiskPrice !== null ? [] : ["CONTROLLED_RISK_PRICE_FLOOR_UNAVAILABLE"]),
  ]
  if (minimumRiskPrice !== null && competitiveCeiling !== null &&
    minimumRiskPrice > competitiveCeiling) {
    blockers.push("TEN_PERCENT_MARGIN_NOT_COMPETITIVE")
  }

  const operatorSalePrice = number(input.operatorSalePrice)
  let economics: ReturnType<typeof calculateEbayUnitEconomics> | null = null
  if (operatorSalePrice !== null && supplierCost !== null) {
    economics = calculateEbayUnitEconomics({
      supplierCost,
      salePrice: operatorSalePrice,
    }, config)
    if (minimumRiskPrice !== null && operatorSalePrice < minimumRiskPrice) {
      blockers.push("OPERATOR_PRICE_BELOW_TEN_PERCENT_MARGIN_FLOOR")
    }
    if (competitiveCeiling !== null && operatorSalePrice > competitiveCeiling) {
      blockers.push("OPERATOR_PRICE_ABOVE_EXACT_SOLD_REFERENCE")
    }
    if (!economics.ready || !economics.passesProfitGate ||
      Number(economics.estimatedNetProfit ?? 0) <= 0 ||
      Number(economics.estimatedNetMarginPercent ?? 0) <
        EBAY_CONTROLLED_RISK_MINIMUM_MARGIN_PERCENT) {
      blockers.push("CONTROLLED_RISK_ECONOMICS_FAILED")
    }
  }

  return {
    available: [...new Set(blockers)].length === 0,
    blockers: [...new Set(blockers)],
    minimumRiskPrice,
    maximumCompetitivePrice: competitiveCeiling === null ? null : money(competitiveCeiling),
    confirmedSoldExactQuantity,
    operatorSalePrice,
    economics,
    policy: {
      version: EBAY_CONTROLLED_RISK_OVERRIDE_VERSION,
      minimumNetMarginPercent: EBAY_CONTROLLED_RISK_MINIMUM_MARGIN_PERCENT,
      promotedListingsReserveRate: 0,
      voluntaryReturns: "NOT_ACCEPTED_WHERE_EBAY_ALLOWS",
      ebayMoneyBackGuaranteeStillApplies: true,
      automaticPricingUsed: false,
      manualPublicationOnly: false,
      finalHumanAuthorizationRequired: true,
      sellerOsPublicationAfterAuthorization: true,
      unattendedPublicationAllowed: false,
      ebayWrites: 0,
    },
  }
}
