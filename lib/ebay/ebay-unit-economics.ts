import { calculateSellerOsPolicyLimitsV2,
  evaluateSellerOsRoiMarginPolicyV2,
  SELLER_OS_MINIMUM_CONTRIBUTION_MARGIN_PERCENT_V2,
  SELLER_OS_MINIMUM_ESTIMATED_ROI_PERCENT_V2 } from
  "../marketplace/seller-os-roi-margin-policy-v2"

export type EbayUnitEconomicsConfig = {
  estimatedEbayFeeRate: number
  fixedOrderFee: number
  estimatedOutboundShipping: number
  returnsReserveRate: number
  promotedListingsReserveRate: number
  /** @deprecated Compatibility-only. Policy V2 has no monetary profit floor. */
  minimumNetProfit: number
  minimumNetMarginPercent: number
  minimumRoiPercent: number
}

export const DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG: EbayUnitEconomicsConfig = {
  // Conservative pre-Taxonomy reserve. It is intentionally distinct from an
  // exact category fee and must be labelled as an estimate in every consumer.
  estimatedEbayFeeRate: 0.153,
  fixedOrderFee: 0.40,
  estimatedOutboundShipping: 6.99,
  returnsReserveRate: 0.04,
  promotedListingsReserveRate: 0.05,
  minimumNetProfit: 0,
  minimumNetMarginPercent:
    SELLER_OS_MINIMUM_CONTRIBUTION_MARGIN_PERCENT_V2,
  minimumRoiPercent: SELLER_OS_MINIMUM_ESTIMATED_ROI_PERCENT_V2,
}

function finite(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function bounded(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = finite(value)
  return parsed === null
    ? fallback
    : Math.max(minimum, Math.min(maximum, parsed))
}

function money(value: number) {
  return Math.round(value * 100) / 100
}

function minimumMoney(value: number) {
  // A price floor that lands exactly on a cent can otherwise miss its own
  // gate by a floating-point fraction (for example 4.999999999999999 profit).
  // The tiny guard makes that boundary one cent conservative without changing
  // ordinary non-boundary values.
  return Math.ceil((value + 1e-9) * 100) / 100
}

function contributionBreakEvenPrice(
  supplierCost: number,
  estimatedOutboundShipping: number,
  variableRate: number,
  fixedOrderFee: number,
) {
  const lowPriceFixedFee = Math.min(fixedOrderFee, 0.30)
  const lowPrice = (supplierCost + estimatedOutboundShipping +
    lowPriceFixedFee) / Math.max(0.01, 1 - variableRate)
  if (lowPrice <= 10) return money(lowPrice)
  const standardFixedFee = Math.max(fixedOrderFee, 0.40)
  return money((supplierCost + estimatedOutboundShipping +
    standardFixedFee) / Math.max(0.01, 1 - variableRate))
}

export function normalizeEbayUnitEconomicsConfig(
  input: Partial<EbayUnitEconomicsConfig> = {},
): EbayUnitEconomicsConfig {
  return {
    estimatedEbayFeeRate: bounded(
      input.estimatedEbayFeeRate,
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.estimatedEbayFeeRate,
      0,
      0.50,
    ),
    fixedOrderFee: bounded(
      input.fixedOrderFee,
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.fixedOrderFee,
      0,
      25,
    ),
    estimatedOutboundShipping: bounded(
      input.estimatedOutboundShipping,
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.estimatedOutboundShipping,
      0,
      500,
    ),
    returnsReserveRate: bounded(
      input.returnsReserveRate,
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.returnsReserveRate,
      0,
      0.50,
    ),
    promotedListingsReserveRate: bounded(
      input.promotedListingsReserveRate,
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.promotedListingsReserveRate,
      0,
      0.50,
    ),
    minimumNetProfit: 0,
    minimumNetMarginPercent:
      SELLER_OS_MINIMUM_CONTRIBUTION_MARGIN_PERCENT_V2,
    minimumRoiPercent: SELLER_OS_MINIMUM_ESTIMATED_ROI_PERCENT_V2,
  }
}

export function calculateEbayUnitEconomics(
  input: { salePrice: unknown; supplierCost: unknown },
  overrides: Partial<EbayUnitEconomicsConfig> = {},
) {
  const config = normalizeEbayUnitEconomicsConfig(overrides)
  const salePrice = finite(input.salePrice)
  const supplierCost = finite(input.supplierCost)
  if (salePrice === null || salePrice <= 0 || supplierCost === null || supplierCost < 0) {
    return {
      ready: false as const,
      salePrice,
      supplierCost,
      estimatedEbayFees: null,
      estimatedOutboundShipping: money(config.estimatedOutboundShipping),
      returnsReserve: null,
      promotedListingsReserve: null,
      estimatedNetProfit: null,
      estimatedNetMarginPercent: null,
      estimatedRoiPercent: null,
      contributionBreakEvenPrice: null,
      minimumProfitablePrice: null,
      passesProfitGate: false,
      config,
      calculationSource: "SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1" as const,
    }
  }

  const appliedFixedOrderFee = salePrice <= 10
    ? Math.min(config.fixedOrderFee, 0.30)
    : Math.max(config.fixedOrderFee, 0.40)
  const estimatedEbayFees = salePrice * config.estimatedEbayFeeRate + appliedFixedOrderFee
  const returnsReserve = salePrice * config.returnsReserveRate
  const promotedListingsReserve = salePrice * config.promotedListingsReserveRate
  const estimatedNetProfit = salePrice - supplierCost - config.estimatedOutboundShipping -
    estimatedEbayFees - returnsReserve - promotedListingsReserve
  const variableRate = config.estimatedEbayFeeRate + config.returnsReserveRate +
    config.promotedListingsReserveRate
  const exactContributionBreakEvenPrice = contributionBreakEvenPrice(
    supplierCost, config.estimatedOutboundShipping, variableRate,
    config.fixedOrderFee)
  const policyEvaluation = evaluateSellerOsRoiMarginPolicyV2({
    revenueUsd: salePrice,
    investmentBase: "EBAY_LUNA_ORDER_INVESTMENT",
    investmentBaseUsd: supplierCost + config.estimatedOutboundShipping +
      appliedFixedOrderFee,
    costs: [
      { key: "supplier_cost", amountUsd: supplierCost,
        authority: "LUNA_OR_CONFIRMED_SUPPLIER_COST", state: "KNOWN" },
      { key: "outbound_shipping",
        amountUsd: config.estimatedOutboundShipping,
        authority: "EBAY_UNIT_ECONOMICS_CONFIG", state: "ESTIMATED" },
      { key: "ebay_fees", amountUsd: estimatedEbayFees,
        authority: "EBAY_US_SELLING_FEE_ESTIMATE", state: "ESTIMATED" },
      { key: "returns_reserve", amountUsd: returnsReserve,
        authority: "SELLER_OS_RETURNS_RESERVE", state: "ESTIMATED" },
      { key: "promoted_listings_reserve", amountUsd: promotedListingsReserve,
        authority: "SELLER_OS_AD_RESERVE", state: "ESTIMATED" },
    ],
  })
  const limits = calculateSellerOsPolicyLimitsV2({ revenueUsd: salePrice,
    purchaseCostUsd: supplierCost,
    otherFixedCostUsd: config.estimatedOutboundShipping + appliedFixedOrderFee,
    investmentBaseAdditionalUsd:
      config.estimatedOutboundShipping + appliedFixedOrderFee,
    variableCostRate: variableRate })
  const passesProfitGate = policyEvaluation.passesPolicy

  return {
    ready: true as const,
    salePrice: money(salePrice),
    supplierCost: money(supplierCost),
    estimatedEbayFees: money(estimatedEbayFees),
    estimatedOutboundShipping: money(config.estimatedOutboundShipping),
    returnsReserve: money(returnsReserve),
    promotedListingsReserve: money(promotedListingsReserve),
    estimatedNetProfit: money(estimatedNetProfit),
    estimatedNetMarginPercent: policyEvaluation.contributionMarginPercent,
    contributionMarginPercent: policyEvaluation.contributionMarginPercent,
    estimatedRoiPercent: policyEvaluation.estimatedRoiPercent,
    investmentBase: policyEvaluation.investmentBase,
    investmentBaseUsd: policyEvaluation.investmentBaseUsd,
    contributionBreakEvenPrice: exactContributionBreakEvenPrice,
    minimumProfitablePrice: limits.minimumViablePriceUsd,
    minimumViablePrice: limits.minimumViablePriceUsd,
    maximumPurchasePrice: limits.maximumPurchasePriceUsd,
    policyEvaluation,
    passesProfitGate,
    config,
    feePolicy: {
      version: "EBAY_US_SELLING_FEES_2026_07_01_PRE_TAXONOMY_RESERVE_V1",
      status: "CONSERVATIVE_CATEGORY_AND_ACCOUNT_PROFILE_PENDING",
      appliedFixedOrderFee: money(appliedFixedOrderFee),
      salesTaxIncludedInFeeBasis: false,
      sellerPerformanceSurchargeIncluded: false,
      internationalFeeIncluded: false,
      exactFeeClaimed: false,
    },
    calculationSource: "SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1" as const,
  }
}

export function calculateEbayMinimumOperatorPrice(
  input: { supplierCost: unknown },
  overrides: Partial<EbayUnitEconomicsConfig> = {},
) {
  const config = normalizeEbayUnitEconomicsConfig(overrides)
  const supplierCost = finite(input.supplierCost)
  if (supplierCost === null || supplierCost < 0) {
    return {
      ready: false as const,
      supplierCost,
      minimumOperatorPrice: null,
      config,
      calculationSource: "SERVER_OWN_COST_PRICE_FLOOR_V1" as const,
    }
  }

  const variableRate = config.estimatedEbayFeeRate + config.returnsReserveRate +
    config.promotedListingsReserveRate
  const appliedFixedOrderFee = Math.max(config.fixedOrderFee, 0.40)
  const fixedBase = supplierCost + config.estimatedOutboundShipping + appliedFixedOrderFee
  const limits = calculateSellerOsPolicyLimitsV2({
    purchaseCostUsd: supplierCost,
    otherFixedCostUsd: config.estimatedOutboundShipping + appliedFixedOrderFee,
    investmentBaseAdditionalUsd:
      config.estimatedOutboundShipping + appliedFixedOrderFee,
    variableCostRate: variableRate,
  })

  return {
    ready: true as const,
    supplierCost: money(supplierCost),
    minimumOperatorPrice: limits.minimumViablePriceUsd === null
      ? null : minimumMoney(limits.minimumViablePriceUsd),
    components: {
      minimumNetProfitPrice: null,
      minimumNetMarginPrice: limits.minimumPriceByContributionMarginUsd,
      minimumContributionMarginPrice:
        limits.minimumPriceByContributionMarginUsd,
      minimumRoiPrice: limits.minimumPriceByRoiUsd,
    },
    policy: limits.policy,
    config,
    feePolicy: {
      version: "EBAY_US_SELLING_FEES_2026_07_01_PRE_TAXONOMY_RESERVE_V1",
      status: "CONSERVATIVE_CATEGORY_AND_ACCOUNT_PROFILE_PENDING",
      appliedFixedOrderFee: money(appliedFixedOrderFee),
      salesTaxIncludedInFeeBasis: false,
      sellerPerformanceSurchargeIncluded: false,
      internationalFeeIncluded: false,
      exactFeeClaimed: false,
    },
    calculationSource: "SERVER_OWN_COST_PRICE_FLOOR_V1" as const,
  }
}
