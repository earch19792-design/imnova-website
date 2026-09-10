import contract from "../../docs/ebay-ads-revenue-official-contract-v1.json" with { type: "json" }
import variableCosts from "../../docs/owner-variable-cost-policy-v1.json" with { type: "json" }
import { consumeListingFeeAuthorityV1 } from "./listing-fee-authority-v1"
import { EBAY_FEE_AUTHORITY_V1, feeRecordV1 as record } from "./ebay-fee-producer-v1"
import { listingEconomicsV1, validatePromotionPolicyV1, type Economics, type PromotionPolicy } from "./listing-treatment-engine-v1"
import { safeAdCapacityV1 } from "./ad-rate-economics-v1"
const down = (n: number) => Math.floor(n * 100 + 1e-9) / 100
const ceil = (n: number) => Math.ceil(n * 100 - 1e-9) / 100
export const economicAmountV1 = (v: unknown): number | null => (typeof v === "number" || typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null
export const economicFreshV1 = (v: Record<string, unknown>, now: Date) => Date.parse(String(v.observedAt)) <= now.getTime() && Date.parse(String(v.freshUntil)) > now.getTime()
const arr = (v: unknown) => Array.isArray(v) ? v.map(record) : []
/** All values must come from the server's current authority, never UI amounts.
 * The ad basis may be a conservative bound larger than the item sale price. */
export function adsCanaryEconomicsV1(e: Economics, policy: PromotionPolicy, recommendedRate: number | null) {
  validatePromotionPolicyV1(policy)
  const result = listingEconomicsV1(e)
  const empty = { ...result, maxSafeAdRatePct: null as number | null, allowedAdRate: null as number | null,
    proposedAdRatePct: null as number | null, projectedAdCost: null as number | null,
    projectedProfitAfterAds: null as number | null, projectedMarginAfterAds: null as number | null,
    promotionBlockedMargin: false, status: "BLOCKED_EVIDENCE" }
  if (result.economicsUnproven || !e.adFeeBasis.fresh || !e.adFeeBasis.reference || e.adFeeBasis.value === null || e.adFeeBasis.value < e.salePrice.value!) return empty
  // A cent of reserved profit cannot be spent by rounding the fee up.
  const room = down(result.profitBeforeAds! - Math.max(policy.minProfit, e.salePrice.value! * policy.minMargin / 100))
  const maxSafeAdRatePct = safeAdCapacityV1(e, policy).maxSafeAdRatePct!
  const cap = recommendedRate === null || !Number.isFinite(recommendedRate) || recommendedRate < 0 || recommendedRate > 100 ? null :
    Math.min(recommendedRate, policy.maxRate, maxSafeAdRatePct)
  const rate = cap === null ? null : Math.floor(cap * 10 + 1e-9) / 10
  const blockedMargin = room < 0 || maxSafeAdRatePct < policy.minRate
  if (blockedMargin || rate === null || rate < policy.minRate || rate < contract.adRate.apiMinPct)
    return { ...empty, maxSafeAdRatePct, allowedAdRate: cap, promotionBlockedMargin: blockedMargin,
      status: blockedMargin ? "BLOCKED_MARGIN" : rate === null ? "RECOMMENDED_RATE_REQUIRED" : "NO_REPRESENTABLE_RATE_IN_POLICY" }
  const projectedAdCost = ceil(e.adFeeBasis.value * rate / 100)
  const projectedProfitAfterAds = down(result.profitBeforeAds! - projectedAdCost)
  const projectedMarginAfterAds = projectedProfitAfterAds / e.salePrice.value! * 100
  const safe = projectedProfitAfterAds + 1e-9 >= policy.minProfit && projectedMarginAfterAds + 1e-9 >= policy.minMargin
  return { ...empty, maxSafeAdRatePct, allowedAdRate: cap, proposedAdRatePct: safe ? rate : null,
    projectedAdCost: safe ? projectedAdCost : null, projectedProfitAfterAds: safe ? projectedProfitAfterAds : null,
    projectedMarginAfterAds: safe ? projectedMarginAfterAds : null, promotionBlockedMargin: !safe,
    status: !safe ? "BLOCKED_MARGIN" : policy.mode === "OFF" ? "POLICY_OFF" : "PREVIEW_READY" }
}


/** One authority consumer for worker readbacks, Mayel and Ads. Numeric legacy
 * fees and newer pending heads can never fall back to an older successful fee. */
export function consumeFeeLifecycleV1(input: {accountKey:string; itemId:string; sku?:string|null; authority:unknown; headState?:unknown; salePrice:number|null; now:Date}) {
  const a=record(input.authority)
  const fee=consumeListingFeeAuthorityV1({...input,categoryId:typeof a.categoryId==="string"?a.categoryId:null,
    metadata:{feeAuthorityV1:a.resolvedAuthority}})
  const proven=a.contractVersion===EBAY_FEE_AUTHORITY_V1 && a.marketplaceAccountKey===input.accountKey && a.itemId===input.itemId &&
    (input.sku===undefined || a.sku===input.sku) && a.state==="PROVEN_PRE_SALE" &&
    (input.headState===undefined || input.headState==="PROVEN_PRE_SALE") && economicFreshV1(a,input.now) && fee.status==="PROVEN"
  return {...fee,status:proven?"PROVEN" as const:"NEEDS_EVIDENCE" as const,amount:proven?fee.amount:null,
    reference:proven?fee.reference:null,adFeeBasis:proven?fee.adFeeBasis:null}
}
export function otherVariableCostPolicyPresentV1(accountKey: string, itemId: string) {
  return variableCosts.OWNER_VARIABLE_COST_POLICY_CONFIRMED && variableCosts.marketplaceAccountKey === accountKey &&
    /^\d{9,20}$/.test(itemId)
}
export function explicitOtherCostV1(input: {accountKey:string;itemId:string;economics:Omit<Economics,"adFeeBasis">}) {
  const e=input.economics
  // A newly observed material cost always overrides the older zero policy.
  if (e.otherCosts.value!==null) return e.otherCosts
  const applies=variableCosts.OWNER_VARIABLE_COST_POLICY_CONFIRMED && variableCosts.marketplaceAccountKey===input.accountKey &&
    otherVariableCostPolicyPresentV1(input.accountKey, input.itemId)
  return applies ? {value:variableCosts.OTHER_PROVEN_VARIABLE_COSTS,reference:`${variableCosts.contractVersion}:${variableCosts.recordedAt}`,fresh:true} : e.otherCosts
}
export function resolvePreSaleEconomicsV1(input: {accountKey:string;itemId:string;listing:unknown;evidence:unknown;feeHead:unknown;now:Date}) {
  const listing=record(input.listing), head=record(input.feeHead), authority=record(head.authority), evidence=arr(input.evidence)
  const e=Object.fromEntries(Object.entries({salePrice:"EBAY_LIVE_PRICE",productCost:"LUNA_CURRENT_COST",shippingCost:"LUNA_CURRENT_SHIPPING",ebayFees:"EXPECTED_EBAY_FEE",otherCosts:"OTHER_EXPLICIT_COSTS"}).map(([key,type])=>{
    const rows=evidence.filter(r=>r.evidence_type===type), r=rows.length===1?rows[0]:{}
    return [key,{value:economicAmountV1(r.value_amount),reference:typeof r.evidence_id==="string"?r.evidence_id:null,
      fresh:r.freshness_status==="FRESH" && r.value_currency==="USD" && economicFreshV1({observedAt:r.captured_at,freshUntil:r.fresh_until},input.now)}]
  })) as Omit<Economics,"adFeeBasis">
  if (economicAmountV1(listing.ebay_price)!==e.salePrice.value || listing.currency!=="USD") e.salePrice.fresh=false
  const fee=consumeFeeLifecycleV1({...input,authority,headState:head.state,sku:typeof listing.ebay_sku==="string"?listing.ebay_sku:null,salePrice:e.salePrice.value})
  const feeProven=fee.status==="PROVEN" && head.sku===listing.ebay_sku
  e.ebayFees={value:feeProven?fee.amount:null,reference:feeProven?fee.reference:null,fresh:feeProven}
  e.otherCosts=explicitOtherCostV1({...input,economics:e})
  const economics:Economics={...e,adFeeBasis:{value:feeProven?fee.adFeeBasis:null,reference:feeProven?fee.reference:null,fresh:feeProven}}
  const incrementalAdCostsProven=!feeProven || ["TAX_ON_FEES","CURRENCY_CONVERSION"].every(type=>
    arr(record(authority.resolvedAuthority).components).some(c=>c.type===type && c.status==="NOT_APPLICABLE" && c.amount===0))
  if (!incrementalAdCostsProven) economics.adFeeBasis.fresh=false
  return {economics,fee,feeProven,incrementalAdCostsProven,otherVariableCostPolicyPresent:otherVariableCostPolicyPresentV1(input.accountKey,input.itemId),base:listingEconomicsV1(economics)}
}
