type R = Record<string, unknown>
const record = (value: unknown): R => value && typeof value === "object" &&
  !Array.isArray(value) ? value as R : {}
const nonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const ceilCents = (value: number) => Math.ceil((value - 1e-9) * 100) / 100

/** Scenario-bound, conservative prelisting economics. It consumes the
 * existing final evaluator's validated cost/shipping/fulfillment readback;
 * it neither changes that evaluator nor calls a conservative fee "realized".
 * The fee callback must evaluate every price on the same official policy. */
export function evaluateCommercialTraceConservativePrelistingV1(input: Readonly<{
  finalAuthority: unknown; ownerPolicy: unknown; categoryId: string | null
  feeAtPrice: (price: number) => unknown
}>) {
  const final = record(input.finalAuthority)
  const owner = record(input.ownerPolicy)
  const cost = record(final.productCost), shipping = record(final.shippingQty1)
  const fulfillment = record(final.fulfillmentAuthority)
  const market = record(final.marketPricingAuthority)
  const promotion = record(final.promotedListingsPolicy)
  const returns = record(final.returnsReservePolicy)
  const other = record(final.otherExplicitCostsPolicy)
  const gates = record(owner.profitabilityGates)
  const price = final.salePrice
  const fee = nonNegative(price) && price > 0 ? record(input.feeAtPrice(price)) : {}
  const feeReady = fee.status === "CONSERVATIVE_BOUND" &&
    fee.marketplaceAccountKey === final.marketplaceAccountKey &&
    fee.categoryId === input.categoryId && fee.itemPrice === price &&
    nonNegative(fee.totalConservativeFee) && fee.realizedFeeExact === null &&
    Array.isArray(fee.blockers) && fee.blockers.length === 0
  const costReady = cost.status === "PROVEN" && nonNegative(cost.amountUsd) &&
    cost.amountUsd > 0 && shipping.status === "PROVEN" &&
    nonNegative(shipping.amountUsd) && fulfillment.status === "PROVEN" &&
    nonNegative(fulfillment.amountUsd)
  const policyReady = owner.status === "PROVEN" &&
    owner.marketplaceAccountKey === final.marketplaceAccountKey &&
    record(final.ownerPolicyAuthority).status === "PROVEN" &&
    [promotion, returns, other].every((part) =>
      ["CONFIGURED", "NOT_APPLICABLE"].includes(String(part.state)) &&
      nonNegative(part.amountUsd)) &&
    gates.state === "CONFIGURED" && nonNegative(gates.minNetProfit) &&
    nonNegative(gates.minNetMarginPercent) && nonNegative(gates.minRoiPercent)
  const marketReady = market.sufficient === true &&
    final.marketSupportedTargetPrice === price
  const blockers = [
    !feeReady ? "CONSERVATIVE_FEE_AUTHORITY_INCOMPLETE" : null,
    !costReady ? "COST_SHIPPING_OR_FULFILLMENT_UNPROVEN" : null,
    !policyReady ? "OWNER_POLICY_OR_RESERVE_UNKNOWN" : null,
    !marketReady ? "MARKET_PRICING_AUTHORITY_UNPROVEN" : null,
    !nonNegative(price) || price <= 0 ? "SALE_PRICE_UNPROVEN" : null,
  ].filter((value): value is string => value !== null)
  const base = { status: "INCOMPLETE" as const,
    feeAmountAuthority: feeReady ? "CONSERVATIVE_BOUND" as const : "UNKNOWN" as const,
    realizedFeeExact: false as const,
    roiBasis: "PRODUCT_COST_ONLY" as const,
    formula: "salePrice-productCost-shippingQty1-conservativeEbayFees-promotedListings-returnsReserve-otherExplicitCosts-fulfillmentCost" as const,
    salePrice: nonNegative(price) ? price : null,
    productCost: costReady ? cost.amountUsd : null,
    shippingQty1: costReady ? shipping.amountUsd : null,
    officialCategoryFvf: feeReady ? fee.officialCategoryFvf : null,
    perOrderFee: feeReady ? fee.perOrderFee : null,
    sellerLevelSurcharge: feeReady ? fee.sellerLevelSurcharge : null,
    serviceMetricsReserve: feeReady ? fee.serviceMetricsReserve : null,
    buyerDependentFeeReserve: feeReady ? fee.buyerDependentFeeReserve : null,
    promotedListingsCost: policyReady ? promotion.amountUsd : null,
    returnsReserve: policyReady ? returns.amountUsd : null,
    otherExplicitCosts: policyReady ? other.amountUsd : null,
    fulfillmentCost: costReady ? fulfillment.amountUsd : null,
    totalConservativeCosts: null as number | null,
    netProfitUnderBound: null as number | null,
    netMarginUnderBound: null as number | null,
    roiUnderBound: null as number | null,
    economicFloor: null as number | null,
    profitabilityGate: { status: "UNPROVEN" as const, gatePass: false },
    prelistingPriceSafe: false, prelistingSafePrice: null as number | null,
    blockers }
  if (blockers.length) return base

  const fixedCost = Number(cost.amountUsd) + Number(shipping.amountUsd) +
    Number(other.amountUsd) + Number(fulfillment.amountUsd)
  const promotionalRate = nonNegative(promotion.ratePercent) ? promotion.ratePercent : 0
  const returnsRate = nonNegative(returns.ratePercent) ? returns.ratePercent : 0
  const promotionFixed = promotionalRate === 0 ? Number(promotion.amountUsd) : 0
  const returnsFixed = returnsRate === 0 ? Number(returns.amountUsd) : 0
  const at = (candidatePrice: number, candidateFee: R) => {
    const promotionCost = promotionalRate > 0
      ? ceilCents(candidatePrice * promotionalRate / 100) : promotionFixed
    const returnsCost = returnsRate > 0
      ? ceilCents(candidatePrice * returnsRate / 100) : returnsFixed
    const total = cents(fixedCost + promotionCost + returnsCost +
      Number(candidateFee.totalConservativeFee))
    const profit = cents(candidatePrice - total)
    const margin = profit / candidatePrice * 100
    const roi = profit / Number(cost.amountUsd) * 100
    return { total, profit, margin, roi, promotionCost, returnsCost,
      pass: profit + 1e-9 >= Number(gates.minNetProfit) &&
        margin + 1e-9 >= Number(gates.minNetMarginPercent) &&
        roi + 1e-9 >= Number(gates.minRoiPercent) }
  }
  const current = at(Number(price), fee)
  // Deliberately bounded. Every cent is re-evaluated, so $10 order-fee and
  // category tier discontinuities cannot inherit a fee from another price.
  const targetCents = Math.round(Number(price) * 100)
  if (targetCents > 50_000) return { ...base,
    blockers: ["CONSERVATIVE_FLOOR_SEARCH_LIMIT_EXCEEDED"],
    profitabilityGate: { status: "PROVEN" as const, gatePass: current.pass },
    totalConservativeCosts: current.total,
    netProfitUnderBound: current.profit,
    netMarginUnderBound: current.margin,
    roiUnderBound: current.roi }
  let floor: number | null = null
  for (let centsAtPrice = 1; centsAtPrice <= targetCents; centsAtPrice++) {
    const candidate = centsAtPrice / 100
    const quote = record(input.feeAtPrice(candidate))
    if (quote.status !== "CONSERVATIVE_BOUND" ||
        quote.marketplaceAccountKey !== final.marketplaceAccountKey ||
        quote.categoryId !== input.categoryId || quote.itemPrice !== candidate ||
        quote.policySourceDigest !== fee.policySourceDigest ||
        !nonNegative(quote.totalConservativeFee) ||
        !Array.isArray(quote.blockers) || quote.blockers.length) return { ...base,
      blockers: ["CONSERVATIVE_FLOOR_FEE_UNPROVEN_AT_PRICE"],
      profitabilityGate: { status: "UNPROVEN" as const, gatePass: false } }
    if (at(candidate, quote).pass) { floor = candidate; break }
  }
  return { ...base, status: "CALCULATED_UNDER_CONSERVATIVE_BOUND" as const,
    totalConservativeCosts: current.total,
    netProfitUnderBound: current.profit,
    netMarginUnderBound: current.margin,
    roiUnderBound: current.roi,
    promotedListingsCost: current.promotionCost,
    returnsReserve: current.returnsCost,
    economicFloor: floor,
    profitabilityGate: { status: "PROVEN" as const,
      gatePass: current.pass,
      minNetProfit: gates.minNetProfit,
      minNetMarginPercent: gates.minNetMarginPercent,
      minRoiPercent: gates.minRoiPercent },
    prelistingPriceSafe: current.pass && floor !== null,
    prelistingSafePrice: current.pass && floor !== null ? Number(price) : null,
    blockers: current.pass && floor !== null ? [] : ["PROFITABILITY_GATE_FAILED"] }
}
