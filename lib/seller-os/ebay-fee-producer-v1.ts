import contingentPolicy from "../../docs/ebay-official-contingent-fee-policy-v1.json" with { type: "json" }
import { assessFeeBoundCoverageV1 } from "./ebay-fee-safe-bound-v1"
import { createHash } from "node:crypto"
import { resolveListingPreSaleFeesV1 } from "./listing-fee-resolver-v1"

export const EBAY_FEE_PRODUCER_V1 = "SELLER_OS_EBAY_FEE_PRODUCER_V1"
export const EBAY_FEE_AUTHORITY_V1 = "SELLER_OS_EBAY_FEE_AUTHORITY_V1"
export type FeeLifecycleState = "PROVEN_PRE_SALE" | "PENDING_ORDER_CONTEXT" | "STALE" | "CONFLICT" | "NOT_APPLICABLE"
type R = Record<string, unknown>
export const feeRecordV1 = (v: unknown): R => v && typeof v === "object" && !Array.isArray(v) ? v as R : {}
const str = (v: unknown) => typeof v === "string" && v.length ? v : null
export function feeDigestV1(v: unknown): string {
  const canonical = (x: unknown): unknown => Array.isArray(x) ? x.map(canonical) : x && typeof x === "object"
    ? Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : x
  return createHash("sha256").update(JSON.stringify(canonical(v)) ?? "null").digest("hex")
}
const feeSource = "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822"
const regulatorySource = "https://export.ebay.com/en/fees-regulations-policies/seller-fees/international-fees/"

/** Pure producer; official context is obtained by the existing bounded reader.
 * Monetary unknowns stay null. PENDING is an expected business state, not an exception.
 */
export function produceEbayFeeAuthorityV1(input: {accountKey:string; itemId:string|null; sku:string|null;
  packageId:string|null; context:unknown; resolutionInputs?:unknown; now:Date}) {
  const c=feeRecordV1(input.context), identity=feeRecordV1(c.identity), listing=feeRecordV1(c.listing)
  const store=feeRecordV1(c.resolvedStoreContext), performance=feeRecordV1(c.accountPerformance)
  const standards=feeRecordV1(performance.standards), service=feeRecordV1(performance.serviceMetrics)
  const boundPolicy=feeRecordV1(c.categoryFeePolicy), policy=feeRecordV1(boundPolicy.policy)
  const exact=identity.accountBindingExact===true && identity.itemId===input.itemId &&
    identity.sku===input.sku && identity.marketplace==="EBAY_US" && c.marketplaceAccountKey===input.accountKey
  const policyKnown=exact && boundPolicy.status==="PROVEN_BASE_POLICY_ONLY" &&
    Date.parse(String(policy.freshUntil))>input.now.getTime() &&
    policy.marketplaceAccountKey===input.accountKey && policy.itemId===input.itemId
  const knownPrice=typeof listing.price==="number"&&Number.isFinite(listing.price)&&listing.price>=0 ? listing.price:null
  const noPerformance=exact && performance.accountBindingExact===true && standards.status==="AVAILABLE" &&
    standards.program==="PROGRAM_US" && feeRecordV1(standards.evaluation).evaluationType==="CURRENT" &&
    ["ABOVE_STANDARD","TOP_RATED"].includes(String(standards.standardsLevel))
  const matchingService=(Array.isArray(service.categories)?service.categories:[]).map(feeRecordV1)
    .filter(x=>x.categoryId===listing.categoryId)
  const noService=exact&&service.status==="AVAILABLE"&&service.marketplace==="EBAY_US"&&
    feeRecordV1(service.evaluation).evaluationType==="CURRENT"&&matchingService.length===1&&
    ["LOW","AVERAGE","HIGH","NOT_APPLICABLE"].includes(String(matchingService[0].rating))
  const regulatoryNA=exact&&performance.registrationCountry==="US"&&identity.marketplace==="EBAY_US"
  const component=(type:string,preSaleResolvable:boolean,source:string,basis:string,rateOrAmount:unknown,
    amount:number|null,pendingDependency:string|null)=>({type,preSaleResolvable,source,basis,rateOrAmount,amount,pendingDependency,
      status:pendingDependency ? (pendingDependency.startsWith("ORDER_")?"PENDING_ORDER_CONTEXT":"PENDING_AUTHORITY") : amount===0?"NOT_APPLICABLE":"PROVEN"})
  const fixed=feeRecordV1(policy.perOrder)
  const components=[
    component("FINAL_VALUE_PERCENT",true,feeSource,"ITEM_PRICE_PLUS_BUYER_SHIPPING_HANDLING_AND_TAX",policyKnown?policy.tiers:null,null,
      policyKnown?"ORDER_BUYER_TAX_AND_TOTAL_BASIS":"OFFICIAL_CATEGORY_POLICY"),
    component("PER_ORDER",true,feeSource,"SINGLE_ORDER",policyKnown?fixed:null,
      policyKnown&&knownPrice!==null&&knownPrice>Number(fixed.threshold)?Number(fixed.above):null,
      policyKnown&&knownPrice!==null&&knownPrice>Number(fixed.threshold)?null:"ORDER_TOTAL_THRESHOLD"),
    component("SELLER_PERFORMANCE",true,str(standards.source)??feeSource,"CURRENT_US_SELLER_PROFILE",noPerformance?0:null,noPerformance?0:null,
      noPerformance?null:"CURRENT_SELLER_SURCHARGE_AUTHORITY"),
    component("SERVICE_METRICS",true,str(service.source)??feeSource,"CURRENT_EXACT_CATEGORY_SERVICE_PROFILE",noService?0:null,noService?0:null,
      noService?null:"CURRENT_EXACT_CATEGORY_SERVICE_AUTHORITY"),
    component("INTERNATIONAL",false,feeSource,"BUYER_REGISTRATION_DELIVERY_AND_SHIPPING_PROGRAM",null,null,"ORDER_BUYER_COUNTRY_AND_PROGRAM"),
    component("CURRENCY_CONVERSION",false,feeSource,"ACTUAL_TRANSACTION_AND_PAYOUT_CURRENCIES",null,null,"ORDER_CONVERSION"),
    component("REGULATORY_OPERATING",true,regulatorySource,"LISTING_MARKETPLACE_EBAY_US",regulatoryNA?0:null,regulatoryNA?0:null,
      regulatoryNA?null:"OFFICIAL_MARKETPLACE_SCOPE"),
    component("TAX_ON_FEES",true,feeSource,"SELLER_REGISTRATION_JURISDICTION_AND_FEE_TAX_INVOICE",null,null,"CURRENT_ACCOUNT_FEE_TAX_AUTHORITY"),
  ]
  const coverage=assessFeeBoundCoverageV1(input.resolutionInputs,input.now)
  const resolutionContext=feeRecordV1(feeRecordV1(input.resolutionInputs).context)
  const supplied=feeRecordV1(input.resolutionInputs)
  const adjustments=(Array.isArray(supplied.adjustments)?supplied.adjustments:[]).map(feeRecordV1)
  const currentSurchargesMatch=adjustments.every(a=>a.type==="SELLER_PERFORMANCE" ? noPerformance || Number(a.amount)>0 :
    a.type==="SERVICE_METRICS" ? noService || Number(a.amount)>0 : true)
  const currentContextMatches=policyKnown && resolutionContext.categoryId===listing.categoryId &&
    resolutionContext.saleFormat===listing.saleFormat && resolutionContext.storeLevel===store.storeSubscriptionLevel &&
    currentSurchargesMatch
  const resolved=input.itemId && coverage.pass && currentContextMatches ? resolveListingPreSaleFeesV1({accountKey:input.accountKey,itemId:input.itemId,
    categoryId:str(listing.categoryId),salePrice:knownPrice,now:input.now,bundle:{...supplied,policies:[policy]}}) : null
  const sourceFresh=exact&&str(c.observedAt)!==null&&Date.parse(String(c.observedAt))<=input.now.getTime()&&
    input.now.getTime()-Date.parse(String(c.observedAt))<6*3600000
  const state:FeeLifecycleState = input.itemId && !exact ? "CONFLICT" : input.itemId && !sourceFresh ? "STALE" :
    resolved?.status==="PROVEN" ? "PROVEN_PRE_SALE" : "PENDING_ORDER_CONTEXT"
  const body={contractVersion:EBAY_FEE_AUTHORITY_V1,producerVersion:EBAY_FEE_PRODUCER_V1,
    marketplaceAccountKey:input.accountKey,marketplace:"EBAY_US",itemId:input.itemId,sku:input.sku,packageId:input.packageId,
    categoryId:str(listing.categoryId),categoryPath:str(listing.categoryPath),saleFormat:str(listing.saleFormat),
    storeContext:store,sellerContext:{standards,serviceMetrics:service},policyVersion:str(policy.sourceVersion),
    policyObservedAt:str(policy.observedAt),sourceEffectiveDate:policy.sourceEffectiveDate??null,
    state,economicsState:state==="PROVEN_PRE_SALE"?"ECONOMICS_PROVEN":"ECONOMICS_PENDING_ORDER_CONTEXT",
    label:state==="CONFLICT"?"Economía: revisar identidad":state==="STALE"?"Economía: actualizando evidencia":
      state==="PROVEN_PRE_SALE"?"Economía: datos completos":"Economía: esperando datos de la orden",
    boundCoverage:coverage,
    officialContingentRateLimits:exact && performance.registrationCountry===contingentPolicy.registeredCountry &&
      Date.parse(contingentPolicy.observedAt)<=input.now.getTime() && Date.parse(contingentPolicy.freshUntil)>input.now.getTime()
      ? contingentPolicy : null,
    components:state==="PROVEN_PRE_SALE" ? resolved?.authority?.components ?? components : components,
    unknownMaterialFeeComponentCount:state==="PROVEN_PRE_SALE"?0:components.filter(x=>x.amount===null).length,
    buyerDependentComponents:["BUYER_TAX","INTERNATIONAL_APPLICABILITY","CURRENCY_CONVERSION"],
    accountAuthorityDependencies:components.filter(x=>x.status==="PENDING_AUTHORITY").map(x=>x.pendingDependency),
    knownPreSaleBasis:{salePrice:knownPrice,buyerShipping:listing.buyerShippingChargeStatus==="AVAILABLE"?listing.buyerShippingCharge:null},
    basePreSaleFeeProven:policyKnown,
    contingentOrderComponents:components.filter(x=>x.status==="PENDING_ORDER_CONTEXT"),
    actualPostSaleFee:null,
    feeEstimateMode:resolved?.authority?resolved.authority.feeBasis.method==="PROVEN_UPPER_BOUND"?"CONSERVATIVE_SAFE_BOUND":"EXACT_PRE_SALE":"UNBOUNDED_UNTIL_ORDER",
    amount:state==="PROVEN_PRE_SALE"?resolved?.amount??null:null,
    resolvedAuthority:state==="PROVEN_PRE_SALE"?resolved?.authority??null:null,
    promotionBlockedEvidence:state!=="PROVEN_PRE_SALE",ebayAdsWriteEnabled:false,
    observedAt:input.now.toISOString(),freshUntil:new Date(Math.min(input.now.getTime()+6*3600000,
      ...[resolved?.authority?.freshUntil,policy.freshUntil].filter(v=>typeof v==="string"&&Number.isFinite(Date.parse(v)))
        .map(v=>Date.parse(String(v))))).toISOString()}
  const fingerprint=feeDigestV1({...body,observedAt:undefined,freshUntil:undefined})
  return {...body,inputFingerprint:fingerprint,authorityId:feeDigestV1([fingerprint,input.now.toISOString()])}
}
