export const SELLER_OS_ROI_MARGIN_POLICY_V2 =
  "SELLER_OS_ROI_MARGIN_POLICY_V2" as const

export const SELLER_OS_MINIMUM_ESTIMATED_ROI_PERCENT_V2 = 30 as const
export const SELLER_OS_MINIMUM_CONTRIBUTION_MARGIN_PERCENT_V2 = 15 as const

export type SellerOsInvestmentBaseV2 =
  | "EBAY_LUNA_ORDER_INVESTMENT"
  | "AMAZON_INVENTORY_INVESTMENT"

export type SellerOsCostComponentV2 = Readonly<{
  key: string
  amountUsd: number | null
  authority: string
  state: "KNOWN" | "ESTIMATED" | "UNKNOWN"
}>

function amount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value : null
}

function money(value: number) {
  return Number(value.toFixed(2))
}

function percent(value: number) {
  return Number(value.toFixed(2))
}

export function sellerOsRoiMarginPolicyContractV2() {
  return Object.freeze({
    contractVersion: SELLER_OS_ROI_MARGIN_POLICY_V2,
    minimumEstimatedRoiPercent:
      SELLER_OS_MINIMUM_ESTIMATED_ROI_PERCENT_V2,
    minimumContributionMarginPercent:
      SELLER_OS_MINIMUM_CONTRIBUTION_MARGIN_PERCENT_V2,
    minimumMonetaryProfitUsd: null,
    simultaneousGatesRequired: true as const,
    unknownCostTreatment: "BLOCK_EVALUATION_NEVER_ZERO" as const,
  })
}

export function evaluateSellerOsRoiMarginPolicyV2(input: Readonly<{
  revenueUsd: number | null
  investmentBaseUsd: number | null
  investmentBase: SellerOsInvestmentBaseV2
  costs: readonly SellerOsCostComponentV2[]
}>) {
  const revenueUsd = amount(input.revenueUsd)
  const investmentBaseUsd = amount(input.investmentBaseUsd)
  const unknownCostKeys = input.costs.filter((entry) =>
    entry.state === "UNKNOWN" || amount(entry.amountUsd) === null)
    .map((entry) => entry.key)
  const complete = revenueUsd !== null && revenueUsd > 0 &&
    investmentBaseUsd !== null && investmentBaseUsd > 0 &&
    unknownCostKeys.length === 0
  const totalCostUsd = complete
    ? money(input.costs.reduce((total, entry) =>
        total + Number(entry.amountUsd), 0)) : null
  const contributionUsd = totalCostUsd === null || revenueUsd === null
    ? null : money(revenueUsd - totalCostUsd)
  const contributionMarginPercent = contributionUsd === null ||
      revenueUsd === null || revenueUsd <= 0
    ? null : percent((contributionUsd / revenueUsd) * 100)
  const estimatedRoiPercent = contributionUsd === null ||
      investmentBaseUsd === null || investmentBaseUsd <= 0
    ? null : percent((contributionUsd / investmentBaseUsd) * 100)
  const roiGateMet = estimatedRoiPercent === null ? null
    : estimatedRoiPercent >= SELLER_OS_MINIMUM_ESTIMATED_ROI_PERCENT_V2
  const contributionMarginGateMet = contributionMarginPercent === null
    ? null : contributionMarginPercent >=
      SELLER_OS_MINIMUM_CONTRIBUTION_MARGIN_PERCENT_V2
  return Object.freeze({
    policy: sellerOsRoiMarginPolicyContractV2(),
    evidenceComplete: complete,
    unknownCostKeys: Object.freeze(unknownCostKeys),
    revenueUsd: revenueUsd === null ? null : money(revenueUsd),
    totalCostUsd,
    contributionUsd,
    contributionMarginPercent,
    investmentBase: input.investmentBase,
    investmentBaseUsd: investmentBaseUsd === null
      ? null : money(investmentBaseUsd),
    estimatedRoiPercent,
    roiGateMet,
    contributionMarginGateMet,
    passesPolicy: complete && roiGateMet === true &&
      contributionMarginGateMet === true,
    blockerCodes: Object.freeze([
      ...(revenueUsd === null || revenueUsd <= 0
        ? ["REVENUE_UNPROVEN"] : []),
      ...(investmentBaseUsd === null || investmentBaseUsd <= 0
        ? ["INVESTMENT_BASE_UNPROVEN"] : []),
      ...(unknownCostKeys.length ? ["COMPLETE_COSTS_REQUIRED"] : []),
      ...(roiGateMet === false ? ["ROI_BELOW_30_PERCENT"] : []),
      ...(contributionMarginGateMet === false
        ? ["CONTRIBUTION_MARGIN_BELOW_15_PERCENT"] : []),
    ]),
  })
}

export function calculateSellerOsPolicyLimitsV2(input: Readonly<{
  revenueUsd?: number | null
  purchaseCostUsd?: number | null
  otherFixedCostUsd: number | null
  variableCostRate: number | null
  investmentBaseAdditionalUsd: number | null
}>) {
  const revenueUsd = amount(input.revenueUsd)
  const purchaseCostUsd = amount(input.purchaseCostUsd)
  const otherFixedCostUsd = amount(input.otherFixedCostUsd)
  const investmentBaseAdditionalUsd = amount(
    input.investmentBaseAdditionalUsd)
  const variableCostRate = typeof input.variableCostRate === "number" &&
      Number.isFinite(input.variableCostRate) && input.variableCostRate >= 0 &&
      input.variableCostRate < 1
    ? input.variableCostRate : null
  const roiRate = SELLER_OS_MINIMUM_ESTIMATED_ROI_PERCENT_V2 / 100
  const marginRate =
    SELLER_OS_MINIMUM_CONTRIBUTION_MARGIN_PERCENT_V2 / 100
  const maximumPurchasePriceByMarginUsd = revenueUsd === null ||
      otherFixedCostUsd === null || variableCostRate === null
    ? null : money(revenueUsd * (1 - variableCostRate - marginRate) -
      otherFixedCostUsd)
  const maximumPurchasePriceByRoiUsd = revenueUsd === null ||
      otherFixedCostUsd === null || variableCostRate === null ||
      investmentBaseAdditionalUsd === null
    ? null : money((revenueUsd * (1 - variableCostRate) -
      otherFixedCostUsd - roiRate * investmentBaseAdditionalUsd) /
      (1 + roiRate))
  const maximumPurchasePriceUsd = maximumPurchasePriceByMarginUsd === null ||
      maximumPurchasePriceByRoiUsd === null
    ? null : Math.max(0, money(Math.min(maximumPurchasePriceByMarginUsd,
      maximumPurchasePriceByRoiUsd)))
  const fixedCostWithPurchase = purchaseCostUsd === null ||
      otherFixedCostUsd === null ? null
    : purchaseCostUsd + otherFixedCostUsd
  const minimumPriceByMarginUsd = fixedCostWithPurchase === null ||
      variableCostRate === null || variableCostRate + marginRate >= 1
    ? null : money(fixedCostWithPurchase /
      (1 - variableCostRate - marginRate))
  const investmentBaseUsd = purchaseCostUsd === null ||
      investmentBaseAdditionalUsd === null ? null
    : purchaseCostUsd + investmentBaseAdditionalUsd
  const minimumPriceByRoiUsd = fixedCostWithPurchase === null ||
      variableCostRate === null || investmentBaseUsd === null
    ? null : money((fixedCostWithPurchase + roiRate * investmentBaseUsd) /
      (1 - variableCostRate))
  const minimumViablePriceUsd = minimumPriceByMarginUsd === null ||
      minimumPriceByRoiUsd === null ? null
    : Math.ceil(Math.max(minimumPriceByMarginUsd,
      minimumPriceByRoiUsd) * 100 - 1e-9) / 100
  return Object.freeze({
    policy: sellerOsRoiMarginPolicyContractV2(),
    maximumPurchasePriceUsd,
    maximumPurchasePriceByMarginUsd,
    maximumPurchasePriceByRoiUsd,
    minimumViablePriceUsd,
    minimumPriceByContributionMarginUsd: minimumPriceByMarginUsd,
    minimumPriceByRoiUsd,
  })
}
