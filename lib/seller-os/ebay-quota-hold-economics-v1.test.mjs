import test from 'node:test'
import assert from 'node:assert/strict'
import { feeFixtureV1, feeOrderFixtureV1 } from '../../tools/fee-economics-test-fixtures-v1.mjs'
import { produceEbayFeeAuthorityV1 } from './ebay-fee-producer-v1.ts'
import { resolvePreSaleEconomicsV1, explicitOtherCostV1, adsCanaryEconomicsV1 } from './pre-sale-economics-v1.ts'
import { calculateLiveEconomicsV1, buildEconomicEvidenceV1 } from './economic-evidence-refresh-v1.ts'
import { quotaHoldEconomicsReportV1, postQuotaResetResumeV1 } from './ebay-economics-quota-hold-v1.ts'
import { reconcileObservedEbayFeesV1 } from './ebay-fee-reconciliation-v1.ts'
const policy={mode:'MANUAL',minRate:3,maxRate:5,minProfit:8,minMargin:15,window:'NOW',timeZone:'America/Guatemala',startsAt:null,endsAt:null}
function prepared(){
 const i=feeFixtureV1();i.context.packageData={feeResolutionInputsV1:i.resolutionInputs};delete i.resolutionInputs
 const authority=produceEbayFeeAuthorityV1(i)
 const evidence=Object.entries({EBAY_LIVE_PRICE:52.99,LUNA_CURRENT_COST:10,LUNA_CURRENT_SHIPPING:6.99,EXPECTED_EBAY_FEE:authority.amount,OTHER_EXPLICIT_COSTS:0}).map(([evidenceType,value])=>buildEconomicEvidenceV1({accountKey:i.accountKey,itemId:i.itemId,evidenceType,value,sourceAuthority:'SYNTHETIC_ONLY',sourceEntityId:'TEST',capturedAt:i.now.toISOString(),status:'FRESH',metadata:evidenceType==='EXPECTED_EBAY_FEE'?{feeLifecycleV1:authority}:{}}))
 return {i,authority,evidence,raw:{itemId:i.itemId,listings:[{ebay_item_id:i.itemId,ebay_sku:i.sku,ebay_price:52.99,currency:'USD'}],feeHeads:[{sku:i.sku,state:authority.state,authority}],evidence,policyDraft:{policy}}}
}
test('new listing consumes package handoff automatically without any previous fee observation',()=>{
 const {i,authority,evidence,raw}=prepared();assert.equal(authority.state,'PROVEN_PRE_SALE');assert.equal(authority.feeEstimateMode,'CONSERVATIVE_SAFE_BOUND')
 const r=resolvePreSaleEconomicsV1({accountKey:i.accountKey,itemId:i.itemId,listing:raw.listings[0],evidence,feeHead:raw.feeHeads[0],now:i.now})
 assert.equal(r.base.profitBeforeAds,26.97);assert.equal(r.feeProven,true)
 assert.ok(adsCanaryEconomicsV1(r.economics,policy,4).maxSafeAdRatePct>5)
 const readback=calculateLiveEconomicsV1({accountKey:i.accountKey,itemId:i.itemId,calculatedAt:i.now.toISOString(),evidence:Object.fromEntries(evidence.map(e=>[e.evidence_type,e]))})
 assert.equal(readback.status,'PROVEN');assert.equal(readback.expected_profit,26.97)
 assert.equal(evidence.find(e=>e.evidence_type==='EXPECTED_EBAY_FEE').fresh_until,authority.freshUntil)
})
test('new incomplete handoff supersedes old success; no copying proof across listing/account/category',()=>{
 for(const mutate of [i=>i.context.packageData.feeResolutionInputsV1={},i=>i.context.identity.itemId='888888888888',i=>i.context.listing.categoryId='OTHER',i=>i.context.marketplaceAccountKey='OTHER']){
  const {i}=prepared();mutate(i);assert.equal(produceEbayFeeAuthorityV1(i).amount,null)
 }
})
test('missing order information and missing authority remain distinct non-error business dependencies',()=>{
 const i=feeFixtureV1();delete i.resolutionInputs;const a=produceEbayFeeAuthorityV1(i)
 assert.equal(a.amount,null);assert.equal(a.pendingIsError,false);assert.equal(a.economicsState,'PROMOTION_BLOCKED_EVIDENCE')
 assert.ok(a.contingentOrderComponents.some(c=>c.status==='PENDING_ORDER_CONTEXT'))
 assert.ok(a.accountAuthorityDependencies.includes('CURRENT_ACCOUNT_FEE_TAX_AUTHORITY'))
 assert.equal(a.boundCoverage.pass,false)
})
test('existing explicit nonzero variable cost wins and an out-of-scope new listing never inherits zero',()=>{
 const value=n=>({value:n,fresh:true,reference:'SYNTHETIC'})
 const e={salePrice:value(50),productCost:value(10),shippingCost:value(5),ebayFees:value(7),otherCosts:value(2)}
 assert.equal(explicitOtherCostV1({accountKey:'NEW_ACCOUNT',itemId:'999999999999',economics:e}).value,2)
 e.otherCosts=value(null);assert.equal(explicitOtherCostV1({accountKey:'NEW_ACCOUNT',itemId:'999999999999',economics:e}).value,null)
})
test('quota report is network-free and classifications count each reason once per listing',()=>{
 const {i,raw}=prepared();const other=structuredClone(raw);other.itemId='888888888888';other.feeHeads=[]
 const r=quotaHoldEconomicsReportV1({accountKey:i.accountKey,rawRows:[raw,other],now:new Date('2026-09-11')})
 assert.equal(r.examined,2);assert.equal(r.economicsBlockerCountsByReason['SALE_PRICE:STALE'],2)
 assert.equal(r.economicsBlockerCountsByReason['FEE_AUTHORITY:MISSING_HEAD'],1)
 assert.equal(r.officialApiCalls,0);assert.equal(r.ebayAdsWrites,0)
 assert.throws(()=>quotaHoldEconomicsReportV1({accountKey:i.accountKey,rawRows:[raw,raw],now:i.now}),/UNIQUE/)
})
test('resume always ends at OWNER preview and cannot automatically authorize a spend',()=>{
 for(const quotaHeld of [true,false]){
  const r=postQuotaResetResumeV1({quotaHeld,currentEvidenceFresh:true,economicsProven:true,eligibilityProven:true,canaryItemId:'999999999999'})
  assert.equal(r.steps.at(-1),'STOP_FOR_OWNER_APPROVAL');assert.equal(r.automaticOwnerApproval,false);assert.equal(r.ebayAdsWriteEnabled,false)
  assert.equal(r.next,quotaHeld?'WAIT_FOR_QUOTA_RECOVERY':'SHOW_OWNER_PREVIEW')
 }
})
test('post-sale actual outside the proven order basis cannot be reported within bound',()=>{
 const {i,authority}=prepared(),order=feeOrderFixtureV1();order.feeEvidence.totalFeeBasisAmount=100
 const r=reconcileObservedEbayFeesV1({accountKey:i.accountKey,order,preSaleAuthority:authority,observedAt:order.lastModifiedDate})
 assert.equal(r.comparisonStatus,'ORDER_OUTSIDE_PROVEN_BOUND');assert.equal(r.delta,null)
 authority.contractVersion='HISTORICAL_NUMERIC_FEE';assert.equal(reconcileObservedEbayFeesV1({accountKey:i.accountKey,order,preSaleAuthority:authority,observedAt:order.lastModifiedDate}).preSaleEstimate,null)
})
test('conservative fees round upward, and a fresh calculation cannot revive an expired child authority',()=>{
 const i=feeFixtureV1();i.context.categoryFeePolicy.policy.tiers[0].ratePct=15.01
 assert.equal(produceEbayFeeAuthorityV1(i).amount,9.04)
 i.context.accountPerformance.standards.observedAt='2026-09-09T12:00:00Z'
 const expired=produceEbayFeeAuthorityV1(i);assert.equal(expired.state,'STALE');assert.equal(expired.amount,null)
})
test('one hypothetical exact order never proves exposure for every future advertised sale',()=>{
 const i=feeFixtureV1();i.resolutionInputs.basis.method='EXACT_SCENARIO'
 const r=produceEbayFeeAuthorityV1(i)
 assert.equal(r.amount,null);assert.equal(r.promotionBlockedEvidence,true)
 assert.ok(r.resolutionBlockers.includes('FUTURE_ORDER_EXPOSURE_BOUND_REQUIRED'))
})
