import { BUYER_TAX_FEE_CLASSIFICATION_V1 } from './publication-fee-structure-v1'
import { feeSubjectMatchesV1, feeSubjectFieldsV1 } from "./fee-subject-v1"
import { classifyFeeComponentsV1 } from "./fee-component-applicability-v1"
import { preSaleFeeBreakdownV1 } from "./pre-sale-fee-breakdown-v1"
import { SELLING_FEE_TAX_SOURCE } from "../ebay/ebay-selling-fee-tax-policy-v1"
import contingentPolicy from "../../docs/ebay-official-contingent-fee-policy-v1.json" with { type: "json" }
import { automaticFeeResolutionInputsV1, completeAutomaticFeeAdjustmentsV1 } from "./automatic-fee-inputs-v1"
import { assessFeeBoundCoverageV1 } from "./ebay-fee-safe-bound-v1"
import { createHash } from "node:crypto"
import { resolveListingPreSaleFeesV1 } from "./listing-fee-resolver-v1"
import { currentCategoryAncestryV1 } from "../ebay/ebay-package-category-fee-binding-v1"

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
/** Fee evidence is a projection of this package, not part of its own subject
 * hash. Excluding only the fee handoffs avoids a circular self-binding. This
 * revision does not replace the certified Listing Package hash/generation. */
export function feePackageRevisionV1(value: unknown): string {
  return `sha256:${feeDigestV1(Object.fromEntries(Object.entries(feeRecordV1(value))
    .filter(([key]) => !["feeContextV1", "feeResolutionInputsV1"].includes(key))))}`
}
const feeSource = "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822"
const regulatorySource = "https://export.ebay.com/en/fees-regulations-policies/seller-fees/international-fees/"

/** Pure producer; official context is obtained by the existing bounded reader.
 * Monetary unknowns stay null. PENDING is an expected business state, not an exception.
 */
export function produceEbayFeeAuthorityV1(input: {accountKey:string; itemId:string|null; sku:string|null;
  packageId:string|null; packageRevision?:string|null; context:unknown; resolutionInputs?:unknown; now:Date}) {
  const c=feeRecordV1(input.context), identity=feeRecordV1(c.identity), listing=feeRecordV1(c.listing)
  const store=feeRecordV1(c.resolvedStoreContext), performance=feeRecordV1(c.accountPerformance)
  const standards=feeRecordV1(performance.standards), service=feeRecordV1(performance.serviceMetrics)
  const boundPolicy=feeRecordV1(c.categoryFeePolicy), policy=feeRecordV1(boundPolicy.policy)
  const exact=identity.accountBindingExact===true && feeSubjectMatchesV1(input,identity) &&
    identity.sku===input.sku && identity.marketplace==="EBAY_US" && c.marketplaceAccountKey===input.accountKey
  const policyKnown=exact && boundPolicy.status==="PROVEN_BASE_POLICY_ONLY" &&
    Date.parse(String(policy.freshUntil))>input.now.getTime() &&
    policy.marketplaceAccountKey===input.accountKey && feeSubjectMatchesV1(input,policy)
  const knownPrice=typeof listing.price==="number"&&Number.isFinite(listing.price)&&listing.price>=0 ? listing.price:null
  const noPerformance=exact && performance.accountBindingExact===true && standards.status==="AVAILABLE" &&
    standards.program==="PROGRAM_US" && feeRecordV1(standards.evaluation).evaluationType==="CURRENT" &&
    ["ABOVE_STANDARD","TOP_RATED"].includes(String(standards.standardsLevel))
  const matchingService=(Array.isArray(service.categories)?service.categories:[]).map(feeRecordV1)
    .filter(x=>x.categoryId===listing.categoryId || policyKnown &&
      currentCategoryAncestryV1(c.categoryAuthority,listing.categoryId,input.now) &&
      (feeRecordV1(c.categoryAuthority).ancestorIds as string[]).includes(String(x.categoryId)))
  const noService=exact&&service.status==="AVAILABLE"&&service.marketplace==="EBAY_US"&&
    feeRecordV1(service.evaluation).evaluationType==="CURRENT"&&matchingService.length===1&&
    ["LOW","AVERAGE","HIGH","NOT_APPLICABLE"].includes(String(matchingService[0].rating))
  const regulatoryNA=exact&&performance.registrationCountry==="US"&&identity.marketplace==="EBAY_US"
  const contingentCurrent=exact && performance.registrationCountry===contingentPolicy.registeredCountry &&
    Date.parse(contingentPolicy.observedAt)<=input.now.getTime() && Date.parse(contingentPolicy.freshUntil)>input.now.getTime()
  const payout=feeRecordV1(c.payoutCurrencyAuthority)
  const payoutSameCurrency=exact && payout.status==='PROVEN' && payout.accountBindingExact===true &&
    payout.source==='https://apiz.ebay.com/sell/finances/v1/seller_funds_summary' &&
    payout.authorityClass==='CURRENT_PENDING_PAYOUT_FUNDS_CURRENCY' && payout.currency==='USD' && listing.currency==='USD' &&
    Date.parse(String(payout.observedAt))<=input.now.getTime() &&
    input.now.getTime()-Date.parse(String(payout.observedAt))<6*3600000
  const taxPolicy=feeRecordV1(c.feeTaxPolicy)
  const validStates=new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "))
  const taxNA=exact && performance.accountBindingExact===true && performance.registrationCountry==="US" &&
    validStates.has(String(performance.registrationState)) && taxPolicy.source===SELLING_FEE_TAX_SOURCE &&
    typeof taxPolicy.digest==="string" && /^[a-f0-9]{64}$/.test(taxPolicy.digest) &&
    Date.parse(String(taxPolicy.observedAt))<=input.now.getTime() && Date.parse(String(taxPolicy.freshUntil))>input.now.getTime() &&
    Array.isArray(taxPolicy.applicableStates) && taxPolicy.applicableStates.length===4 &&
    !taxPolicy.applicableStates.includes(performance.registrationState)
  const component=(type:string,preSaleResolvable:boolean,source:string,basis:string,rateOrAmount:unknown,
    amount:number|null,pendingDependency:string|null)=>({type,preSaleResolvable,source,basis,rateOrAmount,amount,pendingDependency,
      classification: !pendingDependency && amount===0 ? "NOT_APPLICABLE" : preSaleResolvable ? "PRE_SALE_RESOLVABLE" : "ORDER_CONTINGENT_UNBOUNDED",
      applies: !pendingDependency && amount===0 ? false : amount!==null ? true : null,
      boundIfAny: amount, officialAuthority: source,
      status:pendingDependency ? (pendingDependency.startsWith("ORDER_")?"PENDING_ORDER_CONTEXT":"PENDING_AUTHORITY") : amount===0?"NOT_APPLICABLE":"PROVEN"})
  const fixed=feeRecordV1(policy.perOrder)
  const components=[
    component("FINAL_VALUE_PERCENT",false,feeSource,"ITEM_PRICE_PLUS_BUYER_SHIPPING_HANDLING_AND_TAX",policyKnown?policy.tiers:null,null,
      policyKnown?"ORDER_BUYER_TAX_AND_TOTAL_BASIS":"OFFICIAL_CATEGORY_POLICY"),
    component("PER_ORDER",true,feeSource,"SINGLE_ORDER",policyKnown?fixed:null,
      policyKnown&&knownPrice!==null&&knownPrice>Number(fixed.threshold)?Number(fixed.above):null,
      policyKnown&&knownPrice!==null&&knownPrice>Number(fixed.threshold)?null:"ORDER_TOTAL_THRESHOLD"),
    component("SELLER_PERFORMANCE",true,str(standards.source)??feeSource,"CURRENT_US_SELLER_PROFILE",noPerformance?0:null,noPerformance?0:null,
      noPerformance?null:"CURRENT_SELLER_SURCHARGE_AUTHORITY"),
    component("SERVICE_METRICS",true,str(service.source)??feeSource,"CURRENT_EXACT_CATEGORY_SERVICE_PROFILE",noService?0:contingentCurrent?{maximumRatePct:contingentPolicy.components.SERVICE_METRICS.maximumRatePct,monetaryBoundProven:false}:null,noService?0:null,
      noService?null:"CURRENT_EXACT_CATEGORY_SERVICE_AUTHORITY"),
    component("INTERNATIONAL",false,feeSource,"BUYER_REGISTRATION_DELIVERY_AND_SHIPPING_PROGRAM",contingentCurrent?{maximumRatePct:contingentPolicy.components.INTERNATIONAL.maximumRatePct,monetaryBoundProven:false}:null,null,"ORDER_BUYER_COUNTRY_AND_PROGRAM"),
    component("CURRENCY_CONVERSION",true,"https://pages.ebay.com/payment/2.0/terms.html","ACTUAL_TRANSACTION_AND_PAYOUT_CURRENCIES",payoutSameCurrency?0:contingentCurrent?{chargeRatePct:contingentPolicy.components.CURRENCY_CONVERSION.chargeRatePct,exchangeRiskBounded:false}:null,payoutSameCurrency?0:null,payoutSameCurrency?null:"CURRENT_PAYOUT_CURRENCY_AUTHORITY"),
    component("REGULATORY_OPERATING",true,regulatorySource,"LISTING_MARKETPLACE_EBAY_US",regulatoryNA?0:null,regulatoryNA?0:null,
      regulatoryNA?null:"OFFICIAL_MARKETPLACE_SCOPE"),
    component("TAX_ON_FEES",true,SELLING_FEE_TAX_SOURCE,"CURRENT_OFFICIAL_US_FEE_TAX_SCOPE_AND_SELLER_REGISTRATION",taxNA?0:null,taxNA?0:null,taxNA?null:"CURRENT_ACCOUNT_FEE_TAX_AUTHORITY"),
  ]
  const resolutionInputs = completeAutomaticFeeAdjustmentsV1({ components, now: input.now, bundle: automaticFeeResolutionInputsV1({ context: input.context,
    packageData: c.packageData, previousMetadata: { feeResolutionInputsV1: input.resolutionInputs } }) })
  const coverage=assessFeeBoundCoverageV1(resolutionInputs,input.now)
  const resolutionContext=feeRecordV1(feeRecordV1(resolutionInputs).context)
  const supplied=feeRecordV1(resolutionInputs)
  const adjustments=(Array.isArray(supplied.adjustments)?supplied.adjustments:[]).map(feeRecordV1)
  const currentSurchargesMatch=adjustments.every(a=>a.type==="SELLER_PERFORMANCE" ? noPerformance || Number(a.amount)>0 :
    a.type==="SERVICE_METRICS" ? noService || Number(a.amount)>0 : true)
  const currentContextMatches=policyKnown && resolutionContext.categoryId===listing.categoryId &&
    resolutionContext.saleFormat===listing.saleFormat && resolutionContext.storeLevel===store.storeSubscriptionLevel &&
    currentSurchargesMatch
  const resolved=exact && coverage.pass && currentContextMatches ? resolveListingPreSaleFeesV1({accountKey:input.accountKey,...feeSubjectFieldsV1(input),
    categoryId:str(listing.categoryId),salePrice:knownPrice,now:input.now,bundle:{...supplied,policies:[policy]}}) : null
  const sourceFresh=exact&&str(c.observedAt)!==null&&Date.parse(String(c.observedAt))<=input.now.getTime()&&
    input.now.getTime()-Date.parse(String(c.observedAt))<6*3600000
  const freshUntil=new Date(Math.min(input.now.getTime()+6*3600000,
      ...[c.observedAt,listing.observedAt,performance.observedAt,standards.observedAt,service.observedAt]
        .filter(v=>typeof v==="string"&&Number.isFinite(Date.parse(v))).map(v=>Date.parse(String(v))+6*3600000),
      ...[resolved?.authority?.freshUntil,policy.freshUntil].filter(v=>typeof v==="string"&&Number.isFinite(Date.parse(v)))
        .map(v=>Date.parse(String(v))))).toISOString()
  // One exact hypothetical order is useful arithmetic, but cannot authorize
  // promotion across unknown future buyers. Pre-sale exposure must be bounded.
  const preSaleScopeProven=resolved?.authority?.feeBasis.method==="PROVEN_UPPER_BOUND"
  const state:FeeLifecycleState = (input.itemId || input.packageRevision) && !exact ? "CONFLICT" : exact && (!sourceFresh || Date.parse(freshUntil)<=input.now.getTime()) ? "STALE" :
    resolved?.status==="PROVEN" && preSaleScopeProven ? "PROVEN_PRE_SALE" : "PENDING_ORDER_CONTEXT"
  const knownBasis = policyKnown && knownPrice !== null && listing.buyerShippingChargeStatus === "AVAILABLE" &&
    typeof listing.buyerShippingCharge === "number" && listing.buyerShippingCharge >= 0
    ? knownPrice + listing.buyerShippingCharge : null
  const taxTreatment = preSaleFeeBreakdownV1({ policy, knownBasis,
    fullBasis: resolved?.authority?.feeBasis.amount as number | undefined, boundProven: state === "PROVEN_PRE_SALE" })
  const body={contractVersion:EBAY_FEE_AUTHORITY_V1,producerVersion:EBAY_FEE_PRODUCER_V1,
    marketplaceAccountKey:input.accountKey,marketplace:"EBAY_US",...feeSubjectFieldsV1(input),sku:input.sku,packageId:input.packageId,
    categoryId:str(listing.categoryId),categoryPath:str(listing.categoryPath),saleFormat:str(listing.saleFormat),
    storeContext:store,sellerContext:{standards,serviceMetrics:service},policyVersion:str(policy.sourceVersion),
    policyObservedAt:str(policy.observedAt),sourceEffectiveDate:policy.sourceEffectiveDate??null,
    sourceObservedAt:str(c.observedAt), feeTaxPolicy: taxPolicy,
    // Reuse current package context on the existing economics lane without
    // rewriting an immutable package or refreshing still-current account data.
    ...(input.itemId === null ? { preSaleSourceContextV1: Object.fromEntries([
      "observedAt", "marketplaceAccountKey", "identity", "listing", "resolvedStoreContext", "subscription",
      "accountPerformance", "officialFeePolicySnapshot", "feeTaxPolicy", "categoryAuthority", "categoryFeePolicy", "payoutCurrencyAuthority", "currentCategoryServiceAuthority",
    ].filter(k=>c[k] !== undefined).map(k=>[k,c[k]])) } : {}),
    automaticFeeProducer: true, codexRuntimeDependency: false,
    buyerTaxFeeClassification: BUYER_TAX_FEE_CLASSIFICATION_V1,
    taxTreatment, componentApplicability: classifyFeeComponentsV1({ components: state === "PROVEN_PRE_SALE" ? resolved?.authority?.components ?? components : components,
      normalCategoryFee: taxTreatment.normalCategoryFeeBeforeBuyerTax, contingentFeeOnTax: taxTreatment.contingentFeeOnTax,
      sourceFresh: sourceFresh && state !== "STALE" && state !== "CONFLICT", completeBoundProven: state === "PROVEN_PRE_SALE" }),
    normalPreSaleCategoryFee: taxTreatment.normalCategoryFeeBeforeBuyerTax,
    categorySpecificFeeResolution: true, globalFlatFeeRate: false,
    buyerTaxTreatedAsSellerCost: false, buyerTaxTreatedAsSellerRevenue: false, feeOnTaxModeledSeparately: true,
    state,economicsState:state==="PROVEN_PRE_SALE"?"ECONOMICS_PROVEN":components.some(c=>c.status==="PENDING_AUTHORITY") ? "PROMOTION_BLOCKED_EVIDENCE" : "PENDING_ORDER_CONTEXT",
    label:state==="CONFLICT"?"Economía: revisar identidad":state==="STALE"?"Economía: actualizando evidencia":
      state==="PROVEN_PRE_SALE"?"Economía: datos completos":components.some(c=>c.status==="PENDING_AUTHORITY") ? "Economía: esperando evidencia de fees" : "Economía: esperando datos de la orden",
    pendingIsError: false, resolutionBlockers: [...(resolved?.blockers ?? coverage.blockers),
      ...(resolved?.status==="PROVEN" && !preSaleScopeProven?["FUTURE_ORDER_EXPOSURE_BOUND_REQUIRED"]:[])],
    boundCoverage:coverage,
    officialContingentRateLimits:exact && performance.registrationCountry===contingentPolicy.registeredCountry &&
      Date.parse(contingentPolicy.observedAt)<=input.now.getTime() && Date.parse(contingentPolicy.freshUntil)>input.now.getTime()
      ? contingentPolicy : null,
    components:state==="PROVEN_PRE_SALE" ? resolved?.authority?.components ?? components : components,
    unknownMaterialFeeComponentCount:state==="PROVEN_PRE_SALE"?0:components.filter(x=>x.amount===null).length,
    buyerDependentComponents:["CONTINGENT_FEE_ON_TAX","INTERNATIONAL_APPLICABILITY"],
    accountAuthorityDependencies:components.filter(x=>x.status==="PENDING_AUTHORITY").map(x=>x.pendingDependency),
    knownPreSaleBasis:{salePrice:knownPrice,buyerShipping:listing.buyerShippingChargeStatus==="AVAILABLE"?listing.buyerShippingCharge:null},
    basePreSaleFeeProven:policyKnown,
    contingentOrderComponents:components.filter(x=>x.status==="PENDING_ORDER_CONTEXT"),
    actualPostSaleFee:null,
    feeEstimateMode:resolved?.authority?resolved.authority.feeBasis.method==="PROVEN_UPPER_BOUND"?"CONSERVATIVE_SAFE_BOUND":"EXACT_PRE_SALE":"UNBOUNDED_UNTIL_ORDER",
    amount:state==="PROVEN_PRE_SALE"?resolved?.amount??null:null,
    resolvedAuthority:state==="PROVEN_PRE_SALE"?resolved?.authority??null:null,
    promotionBlockedEvidence:state!=="PROVEN_PRE_SALE",ebayAdsWriteEnabled:false,
    observedAt:input.now.toISOString(),freshUntil:freshUntil}
  const fingerprint=feeDigestV1({...body,observedAt:undefined,freshUntil:undefined})
  return {...body,inputFingerprint:fingerprint,authorityId:feeDigestV1([fingerprint,input.now.toISOString()])}
}
