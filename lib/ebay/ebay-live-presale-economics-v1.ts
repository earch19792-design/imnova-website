import type { EbayPromotionStateReadonlyV1 } from
  "./ebay-marketing-promotion-readonly-v1"

export const SELLER_OS_LIVE_PRE_SALE_ECONOMICS_VERSION =
  "SELLER_OS_LIVE_PRE_SALE_ECONOMICS_V1_2026_08_30" as const

export type FeeEvidenceClass =
  | "REALIZED_FEE"
  | "PROVEN_RATE_PRE_SALE_FEE_MODEL"

type ModelInput = {
  ebayItemId: string
  marketplaceId: "EBAY_US"
  categoryId: string
  storeSubscriptionLevel: "NO_STORE" | string
  livePriceUsd: number
  supplierCostUsd: number
  supplierShippingUsd: number
  buyerShippingChargeUsd: number | null
  buyerShippingChargeStatus: "AVAILABLE" | "UNPROVEN"
  baseFinalValueFeeRatePercent: number
  perOrderFixedFeeUsd: number
  promotion: EbayPromotionStateReadonlyV1
  observedAt?: string
}

export function resolveOfficialPreSaleFeePolicyV1(input: {
  categoryId: string
  storeSubscriptionLevel: string
  orderSubtotalUsd: number
}) {
  if (
    input.categoryId !== "94861" ||
    input.storeSubscriptionLevel !== "NO_STORE"
  ) return {
    status: "UNPROVEN" as const,
    limitationCode: "OFFICIAL_CATEGORY_FEE_POLICY_NOT_CERTIFIED",
  }
  return {
    status: "AVAILABLE" as const,
    marketplaceId: "EBAY_US" as const,
    categoryId: input.categoryId,
    storeSubscriptionLevel: "NO_STORE" as const,
    finalValueFeeRatePercent: 13.6,
    perOrderFixedFeeUsd: input.orderSubtotalUsd > 10 ? 0.4 : 0.3,
    authority: "EBAY_OFFICIAL_NO_STORE_CATEGORY_FEE_SCHEDULE" as const,
    exactPreSaleFeeAmountPossible: false as const,
  }
}

function money(value: number) {
  return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2))
}

function percent(value: number) {
  return Number(value.toFixed(4))
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0
}

function unavailable(input: ModelInput, blocker: string) {
  return {
    contractVersion: SELLER_OS_LIVE_PRE_SALE_ECONOMICS_VERSION,
    status: "UNPROVEN" as const,
    economicsEvidenceClass: "PROVEN_RATE_PRE_SALE_FEE_MODEL" as const,
    feeEvidenceClass: "PROVEN_RATE_PRE_SALE_FEE_MODEL" as FeeEvidenceClass,
    ebayItemId: input.ebayItemId,
    marketplaceId: input.marketplaceId,
    profitUsd: null,
    marginPercent: null,
    economicsNonNegative: null,
    nextBlocker: blocker,
    realizedFee: null,
    realizedFeeReconciliation: {
      status: "NOT_IMPLEMENTED" as const,
      futureAuthority: "EBAY_FINANCES_TRANSACTION_FEES" as const,
      modelWillNotBeRelabeledAsRealized: true as const,
    },
  }
}

export function buildLiveListingPreSaleEconomicsV1(input: ModelInput) {
  if (
    !/^\d{9,20}$/.test(input.ebayItemId) ||
    input.marketplaceId !== "EBAY_US" ||
    !/^\d{1,20}$/.test(input.categoryId) ||
    ![
      input.livePriceUsd,
      input.supplierCostUsd,
      input.supplierShippingUsd,
      input.baseFinalValueFeeRatePercent,
      input.perOrderFixedFeeUsd,
    ].every(finiteNonNegative)
  ) return unavailable(input, "PRE_SALE_ECONOMICS_REQUIRED_INPUT_INVALID")
  if (
    input.buyerShippingChargeStatus !== "AVAILABLE" ||
    input.buyerShippingChargeUsd === null ||
    !finiteNonNegative(input.buyerShippingChargeUsd)
  ) return unavailable(input, "BUYER_SHIPPING_CHARGE_UNPROVEN")
  if (
    input.promotion.status !== "AVAILABLE" ||
    input.promotion.promotionState === "UNPROVEN"
  ) return unavailable(input,
    input.promotion.limitationCode ?? "PROMOTION_STATE_UNPROVEN")
  if (
    input.promotion.promotionState === "ACTIVE" &&
    !finiteNonNegative(input.promotion.adRatePercent ?? Number.NaN)
  ) return unavailable(input, "PROMOTION_AD_RATE_UNPROVEN")

  const knownPreSaleFeeBasisUsd = money(
    input.livePriceUsd + input.buyerShippingChargeUsd,
  )
  const baseFeeUsd = money(
    knownPreSaleFeeBasisUsd * input.baseFinalValueFeeRatePercent / 100 +
    input.perOrderFixedFeeUsd,
  )
  // eBay states that the Below Standard and Very High service-metric
  // surcharges do not stack; the larger published current bound is 7 points.
  const accountPerformanceModifierBoundPercent = 7
  const accountPerformanceModifierBoundUsd = money(
    knownPreSaleFeeBasisUsd * accountPerformanceModifierBoundPercent / 100,
  )
  const promotionRatePercent = input.promotion.promotionState === "ACTIVE"
    ? input.promotion.adRatePercent ?? 0
    : 0
  const promotionFeeUsd = money(
    input.livePriceUsd * promotionRatePercent / 100,
  )
  const totalEbayFeeModelUsd = money(
    baseFeeUsd + accountPerformanceModifierBoundUsd + promotionFeeUsd,
  )
  const profitUsd = money(
    input.livePriceUsd - input.supplierCostUsd -
    input.supplierShippingUsd - totalEbayFeeModelUsd,
  )
  const marginPercent = input.livePriceUsd > 0
    ? percent(profitUsd / input.livePriceUsd * 100)
    : 0

  return {
    contractVersion: SELLER_OS_LIVE_PRE_SALE_ECONOMICS_VERSION,
    status: "AVAILABLE" as const,
    economicsEvidenceClass: "PROVEN_RATE_PRE_SALE_MODEL" as const,
    feeEvidenceClass: "PROVEN_RATE_PRE_SALE_FEE_MODEL" as FeeEvidenceClass,
    ebayItemId: input.ebayItemId,
    marketplaceId: input.marketplaceId,
    categoryId: input.categoryId,
    currency: "USD" as const,
    observedAt: input.observedAt ?? new Date().toISOString(),
    revenueUsd: money(input.livePriceUsd),
    supplierCostUsd: money(input.supplierCostUsd),
    supplierShippingUsd: money(input.supplierShippingUsd),
    supplierTotalUsd: money(input.supplierCostUsd + input.supplierShippingUsd),
    buyerShippingChargeUsd: money(input.buyerShippingChargeUsd),
    feeBasis: {
      knownPreSaleBasisUsd: knownPreSaleFeeBasisUsd,
      provenComponents: ["ITEM_PRICE", "CHEAPEST_DOMESTIC_BUYER_SHIPPING"],
      salesTaxPreSaleAmount: "UNPROVEN" as const,
      salesTaxClassification: "CONDITIONAL_POST_SALE" as const,
      otherMandatoryBasisComponents: [] as const,
      limitation: "BUYER_DEPENDENT_SALES_TAX_EXCLUDED_FROM_PRE_SALE_MODEL" as const,
    },
    baseFees: {
      officialFinalValueFeeRatePercent: input.baseFinalValueFeeRatePercent,
      perOrderFixedFeeUsd: input.perOrderFixedFeeUsd,
      preSaleBaseFeeModelUsd: baseFeeUsd,
      authority: "EBAY_OFFICIAL_NO_STORE_CATEGORY_FEE_SCHEDULE" as const,
    },
    officialModifiers: {
      sellerPerformanceModifier: "UNPROVEN" as const,
      serviceMetricsModifier: "UNPROVEN" as const,
      conservativeMutuallyExclusiveBoundPercent:
        accountPerformanceModifierBoundPercent,
      conservativeMutuallyExclusiveBoundUsd:
        accountPerformanceModifierBoundUsd,
      boundAuthority: "EBAY_OFFICIAL_SELLER_PERFORMANCE_FEE_SCHEDULE" as const,
      internationalFeeApplicability: "CONDITIONAL_POST_SALE" as const,
      internationalFeeIncluded: false as const,
    },
    promotion: {
      state: input.promotion.promotionState,
      type: input.promotion.promotionType,
      adRatePercent: input.promotion.promotionState === "ACTIVE"
        ? promotionRatePercent
        : null,
      feeBasis: input.promotion.promotionFeeBasis,
      preSalePromotionFeeModelUsd: promotionFeeUsd,
      authority: input.promotion.authority,
      priceDiscountState: input.promotion.priceDiscountState,
    },
    preSaleBaseFeeModelUsd: baseFeeUsd,
    preSalePromotionFeeModelUsd: promotionFeeUsd,
    preSaleTotalEbayFeeModelUsd: totalEbayFeeModelUsd,
    preSaleProfitUsd: profitUsd,
    preSaleMarginPercent: marginPercent,
    profitUsd,
    marginPercent,
    economicsNonNegative: profitUsd >= 0,
    nextBlocker: null,
    realizedFee: null,
    realizedFeeReconciliation: {
      status: "NOT_IMPLEMENTED" as const,
      futureAuthority: "EBAY_FINANCES_TRANSACTION_FEES" as const,
      modelWillNotBeRelabeledAsRealized: true as const,
    },
    provenance: {
      marketplace: "EBAY_US",
      category: input.categoryId,
      sellerStoreTier: input.storeSubscriptionLevel,
      officialFeeRate: input.baseFinalValueFeeRatePercent,
      fixedFee: input.perOrderFixedFeeUsd,
      feeBasis: "ITEM_PRICE_PLUS_CHEAPEST_DOMESTIC_BUYER_SHIPPING",
      knownApplicableModifiers:
        "OFFICIAL_MAX_OF_MUTUALLY_EXCLUSIVE_ACCOUNT_SURCHARGES",
      promotionState: input.promotion.promotionState,
    },
    limitations: [
      "NOT_A_REALIZED_FEE",
      "BUYER_DEPENDENT_SALES_TAX_EXCLUDED",
      "INTERNATIONAL_FEE_IS_CONDITIONAL_POST_SALE",
      "ACTUAL_ACCOUNT_PERFORMANCE_MODIFIER_RECONCILES_POST_SALE",
    ] as const,
  }
}
