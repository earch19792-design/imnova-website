type R = Record<string, unknown>
const record = (v: unknown): R => v && typeof v === "object" && !Array.isArray(v) ? v as R : {}
const amount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0
const up = (n: number) => Math.ceil(n * 100 - 1e-9) / 100

/** Evaluate the category's certified tariff, never a universal fee percentage. */
export function categoryFeeChargeV1(policyValue: unknown, basis: number, upperBound = false, lowerBasis = basis): number | null {
  const p = record(policyValue), tiers = Array.isArray(p.tiers) ? p.tiers.map(record) : []
  if (!amount(basis) || !amount(lowerBasis) || lowerBasis > basis || !tiers.length || tiers.length > 10 ||
    !tiers.every((t, i) => amount(t.ratePct) && t.ratePct <= 100 && (i === tiers.length - 1 ? t.upTo === null : amount(t.upTo) && t.upTo > 0) &&
      (i === 0 || t.upTo === null || Number(t.upTo) > Number(tiers[i - 1].upTo)))) return null
  if (p.tierMethod === "WHOLE_AMOUNT") {
    const tier = tiers.find(t => t.upTo === null || basis <= Number(t.upTo))!
    let result = basis * Number(tier.ratePct) / 100
    if (upperBound) for (const t of tiers) if (amount(t.upTo) && t.upTo >= lowerBasis && t.upTo <= basis) result = Math.max(result, t.upTo * Number(t.ratePct) / 100)
    return result
  }
  if (p.tierMethod !== "MARGINAL") return null
  let result = 0, lower = 0
  for (const t of tiers) { const upper = t.upTo === null ? basis : Number(t.upTo); result += Math.max(0, Math.min(basis, upper) - lower) * Number(t.ratePct) / 100; lower = upper }
  return result
}

/** Buyer tax is a basis component, never seller revenue or an expense. The
 * incremental fee is separately visible, without subtracting tax itself. */
export function preSaleFeeBreakdownV1(input: { policy: unknown; knownBasis: number | null; fullBasis?: number | null; boundProven?: boolean }) {
  const normal = input.knownBasis === null ? null : categoryFeeChargeV1(input.policy, input.knownBasis)
  const bounded = normal !== null && input.fullBasis != null && input.boundProven === true
    ? categoryFeeChargeV1(input.policy, input.fullBasis, true, input.knownBasis!) : null
  const fixed = record(record(input.policy).perOrder)
  const fixedKnown = amount(fixed.threshold) && amount(fixed.atOrBelow) && amount(fixed.above) && input.knownBasis !== null
  const normalFixed = fixedKnown ? Number(input.knownBasis! <= Number(fixed.threshold) ? fixed.atOrBelow : fixed.above) : null
  const fixedTaxDelta = fixedKnown && bounded !== null && input.fullBasis != null
    ? Math.max(0, Number(input.fullBasis <= Number(fixed.threshold) ? fixed.atOrBelow : fixed.above) - normalFixed!) : null
  return { buyerTaxTreatedAsSellerCost: false, buyerTaxTreatedAsSellerRevenue: false, feeOnTaxModeledSeparately: true,
    normalCategoryFeeBeforeBuyerTax: normal === null ? null : up(normal),
    normalPerOrderFeeBeforeBuyerTax: normalFixed,
    contingentPerOrderFeeOnTax: fixedTaxDelta,
    contingentFeeOnTax: bounded === null || fixedTaxDelta === null ? null : up(Math.max(0, bounded - normal!) + fixedTaxDelta),
    contingentFeeOnTaxStatus: bounded === null ? "PENDING_ORDER_CONTEXT" : "CONSERVATIVE_SAFE_BOUND",
    buyerSalesTaxStatus: "PENDING_ORDER_CONTEXT", categorySpecificFeeResolution: true, globalFlatFeeRate: false }
}
