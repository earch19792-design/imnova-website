import test from 'node:test'
import assert from 'node:assert/strict'
import { adsCanaryEconomicsV1, buildAdsActivationListingV1, selectAdsCanaryV1, adsOfficialContractV1 } from './ebay-ads-revenue-activation-v1.ts'
import { adsQuotaAvailableV1, adsErrorDispositionV1, readAdsActivationOfficialV1 } from '../ebay/ebay-ads-activation-readonly-v1.ts'
import { readAdsRevenueActivationV1 } from './ebay-ads-revenue-runtime-v1.ts'
const now = new Date('2026-09-10T00:10:00Z'), source = 'https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822'
const policy = {mode:'MANUAL',minRate:3,maxRate:5,minProfit:8,minMargin:15,window:'NOW',timeZone:'America/Guatemala',startsAt:null,endsAt:null}
const value = n => ({value:n,fresh:true,reference:'SYNTHETIC_PROVEN_EVIDENCE'})
const economics = () => ({salePrice:value(52.99),productCost:value(10),shippingCost:value(6.99),ebayFees:value(9.03),otherCosts:value(0),adFeeBasis:value(57.52)})
function fixture() {
 const itemId='999999999999', accountKey='SYNTHETIC_ACCOUNT', observedAt='2026-09-10T00:00:00Z',freshUntil='2026-09-10T01:00:00Z'
 const proof={source,sourceVersion:'SYNTHETIC_ONLY',reference:'SYNTHETIC_REF'}
 const resolvedAuthority={contractVersion:'SELLER_OS_LISTING_FEE_AUTHORITY_V1',evidenceClass:'PRE_SALE_FEE_ESTIMATE',marketplaceAccountKey:accountKey,marketplace:'EBAY_US',itemId,categoryId:'50692',storeLevel:'NO_STORE',saleFormat:'FixedPriceItem',storeContextReference:'SYNTHETIC_STORE',accountContextReference:'SYNTHETIC_ACCOUNT',observedAt,freshUntil,...proof,amount:9.03,
  feeBasis:{status:'PROVEN',reference:'SYNTHETIC_BOUND',amount:57.52,salePrice:52.99,method:'PROVEN_UPPER_BOUND',coveredComponents:['ITEM_PRICE','BUYER_SHIPPING','HANDLING','BUYER_TAX'],adBasisCovered:true},
  components:[{type:'FINAL_VALUE_PERCENT',status:'PROVEN',amount:8.63,ratePct:15,basisAmount:57.52,...proof},{type:'PER_ORDER',status:'PROVEN',amount:.4,...proof},...['SELLER_PERFORMANCE','SERVICE_METRICS','INTERNATIONAL','CURRENCY_CONVERSION','REGULATORY_OPERATING','TAX_ON_FEES'].map(type=>({type,status:'NOT_APPLICABLE',amount:0,applicabilityEvidence:'SYNTHETIC_EXPLICIT_NA',...proof}))]}
 const authority={contractVersion:'SELLER_OS_EBAY_FEE_AUTHORITY_V1',marketplaceAccountKey:accountKey,itemId,sku:'TEST_SKU',categoryId:'50692',state:'PROVEN_PRE_SALE',observedAt,freshUntil,authorityId:'SYNTHETIC_AUTHORITY',basePreSaleFeeProven:true,feeEstimateMode:'CONSERVATIVE_SAFE_BOUND',resolvedAuthority}
 const raw={itemId,listings:[{ebay_item_id:itemId,ebay_sku:'TEST_SKU',title:'Synthetic canary',ebay_price:52.99,ebay_quantity:3,currency:'USD',last_ebay_sync_at:observedAt,source:'EBAY_TRADING_SYNTHETIC'}],feeHeads:[{state:'PROVEN_PRE_SALE',sku:'TEST_SKU',authority}],policyDraft:{id:'SYNTHETIC_OWNER_DRAFT',policy},
 evidence:Object.entries({EBAY_LIVE_PRICE:52.99,LUNA_CURRENT_COST:10,LUNA_CURRENT_SHIPPING:6.99,OTHER_EXPLICIT_COSTS:0}).map(([evidence_type,value_amount])=>({evidence_type,value_amount,value_currency:'USD',evidence_id:evidence_type,captured_at:observedAt,fresh_until:freshUntil,freshness_status:'FRESH'}))}
 const official={accountKey,itemId,observedAt,freshUntil,reference:'SYNTHETIC_OFFICIAL_READ',accountEligible:true,listingEligible:true,termsAccepted:true,campaignId:'12345',adId:null,campaignRunning:true,fundingModel:'CPS',adRateStrategy:'FIXED',currentAdState:'INACTIVE',currentAdRate:null,recommendedRate:4,quotaAvailable:true}
 return {accountKey,raw,currentItemIds:[itemId],currentLiveFresh:true,official,now}
}
test('3/4/5 percent simulations use conservative total fee basis and independent OWNER floors',()=>{
 for (const [rate,ad,profit] of [[3,1.73,25.24],[4,2.31,24.66],[5,2.88,24.09]]) {
  const p=adsCanaryEconomicsV1(economics(),policy,rate)
  assert.equal(p.status,'PREVIEW_READY');assert.equal(p.projectedAdCost,ad);assert.equal(p.projectedProfitAfterAds,profit)
  assert.ok(p.projectedMarginAfterAds>=policy.minMargin)
 }
 assert.equal(adsCanaryEconomicsV1(economics(),{...policy,maxRate:12},10).proposedAdRatePct,10)
})
test('recommended, OWNER and economic ceilings all apply; rate rounds down to one decimal',()=>{
 assert.equal(adsCanaryEconomicsV1(economics(),policy,3.99).proposedAdRatePct,3.9)
 assert.equal(adsCanaryEconomicsV1(economics(),policy,20).proposedAdRatePct,5)
 const narrow=adsCanaryEconomicsV1(economics(),{...policy,minProfit:25,maxRate:10},10)
 assert.ok(narrow.proposedAdRatePct<=narrow.maxSafeAdRatePct);assert.ok(narrow.projectedProfitAfterAds>=25)
 assert.equal(adsCanaryEconomicsV1(economics(),{...policy,minProfit:26},5).promotionBlockedMargin,true)
 assert.equal(adsCanaryEconomicsV1(economics(),{...policy,minRate:2.05,maxRate:2.09},2.09).status,'NO_REPRESENTABLE_RATE_IN_POLICY')
})
test('unknown or stale components never become zero; missing ad basis cannot produce a safe rate',()=>{
 for (const key of Object.keys(economics())) for (const mutate of [e=>e[key].value=null,e=>e[key].fresh=false,e=>e[key].reference=null]) {
  const e=economics();mutate(e);const p=adsCanaryEconomicsV1(e,policy,4);assert.equal(p.maxSafeAdRatePct,null);assert.equal(p.proposedAdRatePct,null)
 }
})
test('cold-start TEST with conservative Fee Authority may prepare exactly one canary but never authorizes writes',()=>{
 const row=buildAdsActivationListingV1(fixture())
 assert.deepEqual(row.blockers,[]);assert.equal(row.treatment,'TEST');assert.equal(row.warmMetricsRequired,false)
 assert.equal(row.economicsProven,true);assert.equal(row.feeEstimateMode,'CONSERVATIVE_SAFE_BOUND');assert.equal(row.singleListingAdsCanaryReady,true)
 assert.equal(row.preview.OWNER_APPROVAL_REQUIRED,true);assert.equal(row.ebayAdsWriteEnabled,false);assert.equal(row.multiListingAdsWriteEnabled,false)
 assert.equal(selectAdsCanaryV1([row]).itemId,row.itemId)
 assert.throws(()=>selectAdsCanaryV1([row,row]),/UNIQUE/)
})
test('a historical fee amount or newer pending head cannot replace Fee Authority',()=>{
 for(const change of [i=>i.raw.feeHeads[0].state='PENDING_ORDER_CONTEXT',i=>i.raw.feeHeads[0].authority.freshUntil='2026-09-09T00:00:00Z',i=>i.raw.feeHeads[0].authority.contractVersion='LEGACY_FLAT_FEE',i=>i.raw.feeHeads.push(i.raw.feeHeads[0]),i=>i.raw.feeHeads[0].sku='DIFFERENT']) {
  const i=fixture();change(i);const r=buildAdsActivationListingV1(i);assert.equal(r.economicsProven,false);assert.equal(r.preview.EBAY_FEES,null);assert.equal(r.singleListingAdsCanaryReady,false)
 }
})
test('each official, stock and identity gate independently blocks even with strong economics',()=>{
 for(const change of [i=>i.official.accountEligible=false,i=>i.official.listingEligible=null,i=>i.official.quotaAvailable=false,i=>i.official.adRateStrategy='DYNAMIC',i=>i.official.fundingModel='CPC',i=>i.official.termsAccepted=null,i=>i.official.itemId='888888888888',i=>i.official.freshUntil='2026-09-09T23:00:00Z',i=>i.raw.listings[0].ebay_quantity=0,i=>i.currentLiveFresh=false,i=>i.raw.listings[0].source='LOCAL_DRAFT']) {
  const i=fixture();change(i);assert.equal(buildAdsActivationListingV1(i).singleListingAdsCanaryReady,false)
 }
})
test('invalid durable weekend policy is reported without dropping the economics diagnosis',()=>{
 const i=fixture();i.raw.policyDraft.policy={...policy,window:'WEEKEND',startsAt:'2026-09-09T21:04:00Z',endsAt:'2026-09-10T21:04:00Z'}
 const r=buildAdsActivationListingV1(i);assert.equal(r.ownerPolicyLoaded,true);assert.equal(r.ownerPolicyValid,false);assert.equal(r.economicsProven,true);assert.ok(r.blockers.includes('PROMOTION_WEEKEND_WINDOW_INVALID'))
})
test('base-fee tax/conversion bounds cannot silently authorize additional ad charges',()=>{
 const i=fixture();const tax=i.raw.feeHeads[0].authority.resolvedAuthority.components.find(x=>x.type==='TAX_ON_FEES');tax.status='PROVEN'
 const r=buildAdsActivationListingV1(i);assert.equal(r.singleListingAdsCanaryReady,false);assert.equal(r.preview.MAX_SAFE_AD_RATE_PCT,null)
})
test('same active rate is a no-op, not the required one Ads action',()=>{
 const i=fixture();Object.assign(i.official,{currentAdState:'ACTIVE',adId:'98765',currentAdRate:4})
 assert.ok(buildAdsActivationListingV1(i).blockers.includes('ALREADY_AT_REQUESTED_RATE_NO_ACTION'))
})
test('official contract expires and Ads transport cannot run during current-LIVE quota hold',async()=>{
 assert.equal(adsOfficialContractV1(now).certified,true);assert.equal(adsOfficialContractV1(new Date('2026-09-20')).certified,false)
 let calls=0;const r=await readAdsActivationOfficialV1({accountKey:'TEST',itemId:'999999999999',currentLiveFresh:false,fetchImpl:async()=>{calls++;throw Error('NETWORK_FORBIDDEN')}})
 assert.equal(calls,0);assert.equal(r.officialApiCalls,0)
})
test('official quota and unknown-commit errors fail closed; no blind retry',()=>{
 assert.equal(adsQuotaAvailableV1({},now),false)
 const q={rateLimits:[{apiContext:'sell',apiName:'marketing',resources:[{name:'ads',rates:[{limit:10000,remaining:100,reset:'2026-09-10T07:00:00Z'}]}]}]}
 assert.equal(adsQuotaAvailableV1(q,now),true);q.rateLimits[0].resources[0].rates[0].remaining=null;assert.equal(adsQuotaAvailableV1(q,now),false)
 assert.equal(adsErrorDispositionV1(0,true),'UNKNOWN_COMMIT_READBACK_REQUIRED');assert.equal(adsErrorDispositionV1(503,true),'UNKNOWN_COMMIT_READBACK_REQUIRED');assert.equal(adsErrorDispositionV1(429,true),'QUOTA_HOLD')
})
test('normal runtime reads saved policy/economics while quota holds without loading the monitor or calling eBay',async()=>{
 const i=fixture();let rpcCalls=0
 const supabase={from(){const q={select(){return q},eq(){return q},limit(){return q},maybeSingle:async()=>({data:{current_live_source_state:'SOURCE_UNAVAILABLE',current_live_last_error_code:'EBAY_QUOTA_EXHAUSTED',last_certified_live_item_ids:[i.raw.itemId],last_certified_live_count:1,last_certified_live_observed_at:'2026-09-09T18:00:00Z',last_certified_live_fresh_until:'2026-09-09T19:00:00Z',last_certified_live_scope_id:'current-live:sha256:'+'a'.repeat(64),last_certified_live_source_authority:'EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION'}})};return q},rpc:async()=>{rpcCalls++;return {data:[i.raw]}}}
 const r=await readAdsRevenueActivationV1({supabase,accountKey:i.accountKey,actorId:'TEST_ACTOR',itemIds:[i.raw.itemId],now})
 assert.equal(rpcCalls,1);assert.equal(r.officialApiCalls,0);assert.equal(r.ebayAdsWrites,0);assert.equal(r.summary.selectedCanaryCount,0);assert.equal(r.rows[0].ownerPolicyLoaded,true)
})
