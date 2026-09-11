import { keywordRecord as record } from './keyword-intelligence-handoff-v1'
import { categoryFeeChargeV1 } from './pre-sale-fee-breakdown-v1'
import rates from '../../docs/ebay-official-contingent-fee-policy-v1.json' with { type: 'json' }

export const PUBLICATION_FEE_STRUCTURE_V1 = 'PRE_SALE_DETERMINISTIC_PLUS_POST_ORDER_CONTINGENT_V1'
export const BUYER_TAX_FEE_CLASSIFICATION_V1 = Object.freeze({
  classification: 'CONTINGENT_POST_ORDER', amount: null, assumedZero: false,
  monetaryUpperBound: null, preSaleMonetaryUpperBoundAvailable: false,
  postOrderReconciliationRequired: true,
  source: 'https://developer.ebay.com/api-docs/sell/static/seller-accounts/tax-tables.html',
  feeBasisSource: 'https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822',
  basis: 'EBAY_COMPUTES_TAX_AT_BUYER_DESTINATION_CHECKOUT; ONLY_INCREMENTAL_FEE_IS_SELLER_COST',
})
const money = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const up = (n: number) => Math.ceil(n * 100 - 1e-9) / 100
const rows = (v: unknown) => Array.isArray(v) ? v.map(record) : []

/** Publication structure is NOT a guaranteed all-orders monetary bound and
 * cannot satisfy Ads' unchanged absolute-spend guards. Missing knowable inputs
 * remain blockers. Only documented order variables remain unpriced. */
export function publicationFeeStructureV1(input: {authority:unknown; subjectMatched:boolean;
  accountKey:string; packageId:string; sku:string; categoryId:string; salePrice:number;
  buyerShipping:number|null; now:Date}) {
  const a=record(input.authority), context=record(a.preSaleSourceContextV1)
  const policy=record(record(context.categoryFeePolicy).policy), cs=rows(a.components)
  const blockers:string[]=[]
  const fresh=(v:Record<string,unknown>)=>Date.parse(String(v.observedAt))<=input.now.getTime() && Date.parse(String(v.freshUntil))>input.now.getTime()
  if(!input.subjectMatched || a.contractVersion!=='SELLER_OS_EBAY_FEE_AUTHORITY_V1' ||
    a.marketplaceAccountKey!==input.accountKey || a.packageId!==input.packageId || a.sku!==input.sku ||
    a.categoryId!==input.categoryId || a.marketplace!=='EBAY_US' || a.itemId!==null ||
    !fresh(a) || ['STALE','CONFLICT'].includes(String(a.state)))blockers.push('CURRENT_PACKAGE_FEE_AUTHORITY_REQUIRED')
  if(a.basePreSaleFeeProven!==true || !fresh(policy) || !policy.sourceVersion || !policy.reference ||
    policy.marketplaceAccountKey!==input.accountKey || policy.packageId!==input.packageId ||
    policy.packageRevision!==a.packageRevision || policy.sku!==input.sku ||
    !Array.isArray(policy.categoryIds) || !policy.categoryIds.includes(input.categoryId) ||
    policy.currency!=='USD' || record(context.listing).price!==input.salePrice)
    blockers.push('CATEGORY_RATE_OR_PRICE_UNPROVEN')
  const expected=['FINAL_VALUE_PERCENT','PER_ORDER','SELLER_PERFORMANCE','SERVICE_METRICS','INTERNATIONAL','CURRENCY_CONVERSION','REGULATORY_OPERATING','TAX_ON_FEES']
  if(cs.length!==expected.length || expected.some(k=>cs.filter(c=>c.type===k).length!==1))blockers.push('FEE_COMPONENT_SET_INVALID')
  for(const k of ['SELLER_PERFORMANCE','CURRENCY_CONVERSION','REGULATORY_OPERATING','TAX_ON_FEES']) {
    const c=cs.find(c=>c.type===k)
    if(!c || c.status!=='NOT_APPLICABLE' || c.amount!==0 || !c.source || c.pendingDependency!==null)
      blockers.push(`KNOWABLE_FEE_COMPONENT_UNPROVEN:${k}`)
  }
  const limitsFresh=fresh(rates) && record(context.accountPerformance).registrationCountry===rates.registeredCountry
  const service=cs.find(c=>c.type==='SERVICE_METRICS')
  const noService=service?.status==='NOT_APPLICABLE' && service.amount===0 && service.pendingDependency===null
  // Unreturned category is NOT evidence of no surcharge. Reserve the official
  // maximum rate on the known basis; retain the unknown tax effect separately.
  if(!limitsFresh)blockers.push('CURRENT_OFFICIAL_CONTINGENT_RATE_LIMITS_REQUIRED')
  const basis=money(input.buyerShipping) && money(input.salePrice) ? input.salePrice+input.buyerShipping : null
  if(basis===null)blockers.push('BUYER_SHIPPING_BASIS_UNPROVEN')
  const base=basis===null?null:categoryFeeChargeV1(policy,basis)
  const perOrder=cs.find(c=>c.type==='PER_ORDER')
  if(base===null || perOrder?.status!=='PROVEN' || !money(perOrder.amount))blockers.push('DETERMINISTIC_FEE_COMPONENT_UNPROVEN')
  const deterministic=base!==null && money(perOrder?.amount)?up(base)+perOrder.amount:null
  const reserves=basis!==null && limitsFresh?[
    {component:'SERVICE_METRICS',applicability:noService?'PROVEN_NOT_APPLICABLE':'UNPROVEN_RESERVED_AT_OFFICIAL_MAXIMUM',
      ratePct:noService?0:rates.components.SERVICE_METRICS.maximumRatePct,
      amount:noService?0:up(basis*rates.components.SERVICE_METRICS.maximumRatePct/100)},
    {component:'INTERNATIONAL',applicability:'CONTINGENT_POST_ORDER',ratePct:rates.components.INTERNATIONAL.maximumRatePct,
      amount:up(basis*rates.components.INTERNATIONAL.maximumRatePct/100)},
  ]:[]
  return {version:PUBLICATION_FEE_STRUCTURE_V1,feeAuthorityReady:blockers.length===0,blockers,
    authorityId:a.authorityId,packageRevision:a.packageRevision,freshUntil:a.freshUntil,
    deterministicPreSaleEbayFees:deterministic===null?null:up(deterministic),knownFeeBasis:basis,
    preSaleRiskReserves:reserves,contingentPostOrderFeeComponents:[{component:'BUYER_TAX_FEE_EFFECT',...BUYER_TAX_FEE_CLASSIFICATION_V1},
      {component:'INTERNATIONAL_APPLICABILITY',classification:'CONTINGENT_POST_ORDER',actualAmount:null,source:rates.source}],
    feeSafeBound:null,absoluteProfitGuaranteed:false,postOrderFeeReconciliationRequired:true,
    buyerTaxAssumedZero:false,buyerTaxTreatedAsSellerCost:false,buyerTaxTreatedAsSellerRevenue:false,
    maxSafeAdRatePct:null,adsEconomicsProven:false}
}

export function publicationEconomicsV1(input:{fee:ReturnType<typeof publicationFeeStructureV1>;salePrice:unknown;
  productCost:unknown;shipping:unknown;otherCosts:unknown;listingFees:unknown;materialCostsProven:boolean}) {
  const values=[input.salePrice,input.productCost,input.shipping,input.otherCosts,input.listingFees]
  const proven=input.materialCostsProven && input.fee.feeAuthorityReady && values.every(money) && Number(input.salePrice)>0
  const base=proven?up(Number(input.salePrice)-Number(input.productCost)-Number(input.shipping)-Number(input.otherCosts)-input.fee.deterministicPreSaleEbayFees!):null
  const reserve=input.fee.preSaleRiskReserves.reduce((s,c)=>s+c.amount,0)
  const budget=base===null?null:Math.floor((base-reserve-Number(input.listingFees))*100+1e-9)/100
  return {mode:PUBLICATION_FEE_STRUCTURE_V1,economicsProven:proven,deterministicProfitBeforePostOrderAdjustments:base,
    deterministicMarginBeforePostOrderAdjustments:base===null?null:base/Number(input.salePrice)*100,
    listingFees:money(input.listingFees)?input.listingFees:null,knownBasisRiskReserve:up(reserve),
    budgetedProfitBeforePostOrderAdjustments:budget,budgetedMarginBeforePostOrderAdjustments:budget===null?null:budget/Number(input.salePrice)*100,
    profitAfterAllActualFees:null,marginAfterAllActualFees:null,postOrderReconciliationRequired:true,
    positivePreSaleContribution:budget!==null && budget>0,absoluteProfitGuaranteed:false}
}
