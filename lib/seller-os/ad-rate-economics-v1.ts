import type { Economics, PromotionPolicy } from "./listing-treatment-engine-v1"
import { SELLER_OS_MINIMUM_CONTRIBUTION_MARGIN_PERCENT_V2,
  SELLER_OS_MINIMUM_ESTIMATED_ROI_PERCENT_V2 } from
  "../marketplace/seller-os-roi-margin-policy-v2"

const proven = (v: Economics[keyof Economics]) => typeof v.value === "number" && Number.isFinite(v.value) && v.value >= 0 && v.fresh && !!v.reference
const down = (n: number) => Math.floor(n * 100 + 1e-9) / 100
const up = (n: number) => Math.ceil(n * 100 - 1e-9) / 100
export type AdSimulationStatus = "SAFE" | "UNSAFE_MARGIN" | "UNSAFE_PROFIT" | "UNPROVEN_ECONOMICS"

/** Monetary capacity is independent of OWNER's rate range and funnel metrics.
 * Reserve whole cents before converting capacity to the official ad fee basis. */
export function safeAdCapacityV1(e: Economics, policy: PromotionPolicy) {
  const ready = Object.values(e).every(proven) && e.salePrice.value! > 0 && e.adFeeBasis.value! >= e.salePrice.value!
  if (!ready) return { proven: false, profitBeforeAds: null,
    marginBeforeAds: null, investmentBase: null, roiBeforeAds: null,
    maxAdSpend: null, maxSafeAdRatePct: null }
  const profitBeforeAds = down(e.salePrice.value! - e.productCost.value! - e.shippingCost.value! - e.ebayFees.value! - e.otherCosts.value!)
  const investmentBase = down(e.productCost.value! + e.shippingCost.value!)
  if (investmentBase <= 0) return { proven: false, profitBeforeAds: null,
    marginBeforeAds: null, investmentBase: null, roiBeforeAds: null,
    maxAdSpend: null, maxSafeAdRatePct: null }
  const room = down(profitBeforeAds - Math.max(
    e.salePrice.value! * SELLER_OS_MINIMUM_CONTRIBUTION_MARGIN_PERCENT_V2 / 100,
    investmentBase * SELLER_OS_MINIMUM_ESTIMATED_ROI_PERCENT_V2 / 100))
  return { proven: true, profitBeforeAds, marginBeforeAds: profitBeforeAds / e.salePrice.value! * 100,
    investmentBase, roiBeforeAds: profitBeforeAds / investmentBase * 100,
    maxAdSpend: Math.max(0, room), maxSafeAdRatePct: Math.max(0, Math.min(100, down(room / e.adFeeBasis.value! * 100))) }
}

export function simulateAdRateV1(e: Economics, policy: PromotionPolicy, rate: number) {
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw Error("AD_SIMULATION_RATE_INVALID")
  const c = safeAdCapacityV1(e, policy)
  const base = { adRatePct: rate, adFeeBasis: proven(e.adFeeBasis) ? e.adFeeBasis.value : null,
    projectedAdCost: null as number | null, profitAfterAds: null as number | null, marginAfterAds: null as number | null,
    safe: null as boolean | null, status: "UNPROVEN_ECONOMICS" as AdSimulationStatus,
    violations: [] as string[], ownerRangeAllowed: rate >= policy.minRate && rate <= policy.maxRate }
  if (!c.proven) return base
  const projectedAdCost = up(e.adFeeBasis.value! * rate / 100)
  const profitAfterAds = down(c.profitBeforeAds! - projectedAdCost), marginAfterAds = profitAfterAds / e.salePrice.value! * 100
  const roiAfterAds = profitAfterAds / c.investmentBase! * 100
  const violations = [...(roiAfterAds + 1e-9 < SELLER_OS_MINIMUM_ESTIMATED_ROI_PERCENT_V2 ? ["MIN_ROI"] : []), ...(marginAfterAds + 1e-9 < SELLER_OS_MINIMUM_CONTRIBUTION_MARGIN_PERCENT_V2 ? ["MIN_MARGIN"] : [])]
  return { ...base, projectedAdCost, profitAfterAds, marginAfterAds, roiAfterAds,
    safe: violations.length === 0, violations,
    status: violations.length ? "UNSAFE_MARGIN" as const : "SAFE" as const }
}

export const simulateOwnerRateLevelsV1 = (e: Economics, policy: PromotionPolicy) => [3, 4, 5].map(rate => simulateAdRateV1(e, policy, rate))
