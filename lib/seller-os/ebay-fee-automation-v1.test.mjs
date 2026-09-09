import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { produceEbayFeeAuthorityV1 } from './ebay-fee-producer-v1.ts'
import { reconcileObservedEbayFeesV1 } from './ebay-fee-reconciliation-v1.ts'
import { resolveListingPreSaleFeesV1 } from './listing-fee-resolver-v1.ts'
import { normalizeCompletedEbayOrders } from '../marketplace/commercial-monitor-domain.ts'
import { parseCurrentOfficialFeePolicyV1 } from '../ebay/ebay-fee-policy-readonly-v1.ts'
import { promotionProfitGuardV1 } from './listing-treatment-engine-v1.ts'
import { readEbayFeeHandoffV1 } from './ebay-fee-runtime-v1.ts'

// Synthetic official-evidence contracts, not evidence of real account tariffs.
const now=new Date('2026-09-09T20:00:00Z'), source='https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822'
function fixture(){
 const proof={status:'PROVEN',source,sourceVersion:'TEST',reference:'TEST',observedAt:'2026-09-09T19:00:00Z',freshUntil:'2026-09-10T00:00:00Z',effectiveFrom:'2026-09-01T00:00:00Z',effectiveUntil:'2026-10-01T00:00:00Z'}
 const binding={marketplaceAccountKey:'TEST_ACCOUNT',itemId:'999999999999',categoryId:'50692',currency:'USD'}
 const policy={...proof,...binding,marketplace:'EBAY_US',categoryIds:['50692'],saleFormats:['FixedPriceItem'],storeLevels:['NO_STORE'],tierMethod:'WHOLE_AMOUNT',tiers:[{upTo:5000,ratePct:15},{upTo:null,ratePct:9}],perOrder:{threshold:10,atOrBelow:.3,above:.4}}
 const basis={...proof,...binding,method:'PROVEN_UPPER_BOUND',scenarioReference:'TEST_BOUND',quantity:1,orderItemCount:1,itemPrice:52.99,buyerShipping:0,handling:0,buyerTax:4.53,amount:57.52,adBasisCovered:true}
 const adjustments=['SELLER_PERFORMANCE','SERVICE_METRICS','INTERNATIONAL','CURRENCY_CONVERSION','REGULATORY_OPERATING','TAX_ON_FEES'].map(type=>({...proof,...binding,type,scenarioReference:'TEST_BOUND',applicability:'NOT_APPLICABLE',applicabilityEvidence:'TEST_EXPLICIT_NON_APPLICABILITY',amount:0}))
 const resolutionInputs={context:{...proof,...binding,marketplace:'EBAY_US',storeLevel:'NO_STORE',saleFormat:'FixedPriceItem',categoryReference:'TEST',storeReference:'TEST',formatReference:'TEST'},policies:[policy],basis,adjustments,
 boundCoverage:['BUYER_TAX','INTERNATIONAL_APPLICABILITY','CURRENCY_CONVERSION','TAX_ON_FEES'].map(component=>({...proof,...binding,component,scenarioReference:'TEST_BOUND',coversAllEligibleOrders:true,maximumAmount:component==='BUYER_TAX'?4.53:0}))}
 return {accountKey:'TEST_ACCOUNT',itemId:'999999999999',sku:'TEST_SKU',packageId:'TEST_PACKAGE',now,resolutionInputs,context:{marketplaceAccountKey:'TEST_ACCOUNT',observedAt:now.toISOString(),identity:{accountBindingExact:true,itemId:'999999999999',sku:'TEST_SKU',marketplace:'EBAY_US'},listing:{categoryId:'50692',categoryPath:'Jewelry & Watches:Fashion Jewelry:Jewelry Sets',saleFormat:'FixedPriceItem',price:52.99,buyerShippingCharge:0,buyerShippingChargeStatus:'AVAILABLE'},resolvedStoreContext:{storeSubscriptionLevel:'NO_STORE'},categoryFeePolicy:{status:'PROVEN_BASE_POLICY_ONLY',policy},accountPerformance:{accountBindingExact:true,registrationCountry:'US',standards:{status:'AVAILABLE',program:'PROGRAM_US',evaluation:{evaluationType:'CURRENT'},standardsLevel:'ABOVE_STANDARD'},serviceMetrics:{status:'AVAILABLE',marketplace:'EBAY_US',evaluation:{evaluationType:'CURRENT'},categories:[{categoryId:'50692',rating:'NOT_APPLICABLE'}]}}}}
}
function order(){return {ebayOrderId:'TEST_ORDER',creationDate:'2026-09-09T21:00:00Z',lastModifiedDate:'2026-09-09T22:00:00Z',orderPaymentStatus:'PAID',orderFulfillmentStatus:'NOT_STARTED',totalAmount:57.52,currency:'USD',marketplaceId:'EBAY_US',lineItems:[{ebayOrderId:'TEST_ORDER',lineItemId:'TEST_LINE',listingId:'999999999999',sku:'TEST_SKU',quantity:1,title:'Test',lineItemAmount:52.99,currency:'USD',shipByDate:null}],feeEvidence:{totalMarketplaceFee:8.22,totalFeeBasisAmount:57.52,currency:'USD',components:[],source:'https://api.ebay.com/sell/fulfillment/v1/order'}}}
test('NEW_LISTING_FEE_AUTO_PRODUCER_PASS: pending is durable, not zero or a technical failure',()=>{
 const i=fixture();delete i.resolutionInputs;const a=produceEbayFeeAuthorityV1(i)
 assert.equal(a.basePreSaleFeeProven,true);assert.equal(a.state,'PENDING_ORDER_CONTEXT');assert.equal(a.amount,null)
 assert.equal(a.components.find(c=>c.type==='REGULATORY_OPERATING').amount,0)
 assert.equal(a.components.find(c=>c.type==='TAX_ON_FEES').amount,null)
 assert.equal(a.promotionBlockedEvidence,true)
})
test('conservative coverage allows proven economics without knowing a future exact order',()=>{
 const a=produceEbayFeeAuthorityV1(fixture());assert.equal(a.state,'PROVEN_PRE_SALE')
 assert.equal(a.feeEstimateMode,'CONSERVATIVE_SAFE_BOUND');assert.equal(a.amount,9.03)
 assert.equal(a.unknownMaterialFeeComponentCount,0);assert.equal(a.actualPostSaleFee,null)
})
test('BUYER_DEPENDENT_COMPONENT_PENDING_PASS / NO_UNKNOWN_TO_ZERO_PASS',()=>{
 for(const edit of [i=>i.resolutionInputs.boundCoverage.pop(),i=>i.resolutionInputs.boundCoverage[0].maximumAmount=null,
 i=>i.resolutionInputs.boundCoverage[0].source='https://ebay.com.attacker.test',i=>i.resolutionInputs.basis.buyerTax=null]){
 const i=fixture();edit(i);const a=produceEbayFeeAuthorityV1(i);assert.equal(a.amount,null);assert.equal(a.promotionBlockedEvidence,true)}
})
test('CATEGORY_CHANGE_RECOMPUTES_FEE_PASS / SUBSCRIPTION_CHANGE_INVALIDATES_FEE_PASS',()=>{
 for(const edit of [i=>i.context.listing.categoryId='OTHER',i=>i.context.resolvedStoreContext.storeSubscriptionLevel='BASIC',i=>i.context.listing.saleFormat='Chinese']){
 const i=fixture(), before=produceEbayFeeAuthorityV1(i);edit(i);const after=produceEbayFeeAuthorityV1(i)
 assert.notEqual(before.inputFingerprint,after.inputFingerprint);assert.equal(after.amount,null)}
})
test('whole-amount tier drop cannot understate the conservative fee ceiling',()=>{
 const i=fixture();i.resolutionInputs.basis.itemPrice=4900;i.resolutionInputs.basis.buyerTax=300;i.resolutionInputs.basis.amount=5200
 const a=resolveListingPreSaleFeesV1({accountKey:i.accountKey,itemId:i.itemId,categoryId:'50692',salePrice:4900,now,bundle:i.resolutionInputs})
 assert.equal(a.amount,750.4) // 5000 * 15%, not 5200 * 9%.
})
test('SALE_AUTO_RECONCILIATION_PASS / PRE_SALE_EVIDENCE_IMMUTABLE_PASS / ESTIMATE_ACTUAL_DELTA_PASS',()=>{
 const authority=produceEbayFeeAuthorityV1(fixture()), original=structuredClone(authority)
 const input={accountKey:'TEST_ACCOUNT',order:order(),preSaleAuthority:authority,observedAt:'2026-09-09T22:00:00Z'}
 const r=reconcileObservedEbayFeesV1(input);assert.equal(r.actualEbayFeesTotal,8.22);assert.equal(r.delta,-.81);assert.equal(r.comparisonStatus,'WITHIN_BOUND')
 assert.deepEqual(authority,original)
 assert.equal(reconcileObservedEbayFeesV1({...input,observedAt:'2026-09-09T23:00:00Z'}).receiptId,r.receiptId)
 input.order.feeEvidence.totalMarketplaceFee=10;const revised=reconcileObservedEbayFeesV1(input)
 assert.notEqual(revised.receiptId,r.receiptId);assert.equal(revised.comparisonStatus,'BOUND_EXCEEDED')
})
test('post-sale observation never creates a pre-sale authority or allocates a cart arbitrarily',()=>{
 const input={accountKey:'TEST_ACCOUNT',order:order(),preSaleAuthority:null,observedAt:now.toISOString()}
 const r=reconcileObservedEbayFeesV1(input);assert.equal(r.preSaleEstimate,null);assert.equal(r.delta,null)
 input.order.lineItems.push({...input.order.lineItems[0],lineItemId:'SECOND'});assert.equal(reconcileObservedEbayFeesV1(input),null)
})
test('existing Fulfillment normalization captures official amounts without buyer PII',()=>{
 const raw={orderId:'TEST_ORDER',creationDate:now.toISOString(),lastModifiedDate:now.toISOString(),orderPaymentStatus:'PAID',orderFulfillmentStatus:'NOT_STARTED',pricingSummary:{total:{value:'57.52',currency:'USD'}},totalMarketplaceFee:{value:'8.22',currency:'USD'},totalFeeBasisAmount:{value:'57.52',currency:'USD'},buyer:{username:'PRIVATE'},lineItems:[{lineItemId:'TEST_LINE',legacyItemId:'999999999999',listingMarketplaceId:'EBAY_US',sku:'TEST_SKU',quantity:1,title:'Test',lineItemCost:{value:'52.99',currency:'USD'}}]}
 const normalized=normalizeCompletedEbayOrders({orders:[raw]});assert.equal(normalized.length,1)
 assert.equal(normalized[0].feeEvidence.totalMarketplaceFee,8.22);assert.equal(JSON.stringify(normalized).includes('PRIVATE'),false)
 delete raw.totalMarketplaceFee;delete raw.totalFeeBasisAmount;assert.equal(normalizeCompletedEbayOrders({orders:[raw]})[0].feeEvidence,undefined)
})
test('MAYEL_AUTO_UPDATE_AFTER_SALE_PASS: next normal read sees receipt and newer pending head suppresses old success',async()=>{
 const authority=produceEbayFeeAuthorityV1(fixture());let pending=false,actual=null
 const supabase={from(table){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},maybeSingle(){return Promise.resolve({data:table.includes('receipts')?{receipt:actual}:{authority}})},then(resolve){return Promise.resolve({data:[{authority_id:authority.authorityId,ebay_item_id:authority.itemId,sku:authority.sku,state:pending?'PENDING_ORDER_CONTEXT':'PROVEN_PRE_SALE'}]}).then(resolve)}};return q}}
 const input={supabase,accountKey:'TEST_ACCOUNT',itemId:authority.itemId,sku:authority.sku,now}
 assert.equal((await readEbayFeeHandoffV1(input)).status,'PROVEN')
 actual={receiptId:'NEW_RECEIPT',actualEbayFeesTotal:8.22};assert.equal((await readEbayFeeHandoffV1(input)).actualPostSaleFee.receiptId,'NEW_RECEIPT')
 pending=true;assert.equal((await readEbayFeeHandoffV1(input)).resolvedAuthority,null)
})
test('NO_CODEX_RUNTIME_DEPENDENCY_PASS: existing producer/order paths are wired and ledgers immutable',()=>{
 const root=new URL('../',import.meta.url)
 const refresh=readFileSync(new URL('seller-os/economic-evidence-refresh-runtime-v1.ts',root),'utf8')
 const orders=readFileSync(new URL('ebay/ebay-commercial-monitor-service.ts',root),'utf8')
 assert.match(refresh,/persistProducedEbayFeeV1/);assert.match(refresh,/runPendingPackageFeesV1/)
 assert.match(orders,/await reconcileEbayOrderFeesV1/)
 const migration=readFileSync(new URL('../supabase/migrations/20260909191023_seller_os_fee_automation_reconciliation_v1.sql',root),'utf8')
 assert.match(migration,/FEE_EVIDENCE_IMMUTABLE/);assert.match(migration,/p_expected_updated_at/)
 assert.doesNotMatch(refresh,/finalValueFeeRatePercent/)
})

test('safe bound feeds the existing profit guard for 3%, 4%, 5%; unsafe floors still block',()=>{
 const authority=produceEbayFeeAuthorityV1(fixture())
 const value=n=>({value:n,fresh:true,reference:'TEST_EVIDENCE'})
 const economics={salePrice:value(52.99),productCost:value(10),shippingCost:value(6.99),ebayFees:value(authority.amount),otherCosts:value(0),adFeeBasis:value(57.52)}
 const policy={mode:'MANUAL',minRate:3,maxRate:5,minProfit:8,minMargin:15,window:'NOW',timeZone:'America/Guatemala',startsAt:null,endsAt:null}
 for(const rate of [3,4,5]){const r=promotionProfitGuardV1(economics,{...policy,minRate:rate,maxRate:rate});assert.equal(r.status,'SIMULATION_READY');assert.ok(r.projectedProfitAfterAds>=8);assert.ok(r.projectedMarginAfterAds>=15)}
 assert.equal(promotionProfitGuardV1(economics,{...policy,minProfit:40}).status,'BLOCKED_MARGIN')
 economics.ebayFees=value(null);assert.equal(promotionProfitGuardV1(economics,policy).status,'BLOCKED_EVIDENCE')
})

test('official policy updates are parsed without extending a stale snapshot or guessing changed structures',()=>{
 const html=`<table><tr><td>Most categories</td><td>13.6% on total amount of the sale up to $7,500 calculated per item 2.35% on the portion of the sale over $7,500</td></tr><tr><td>Jewelry &amp; Watches (except Watches, Parts &amp; Accessories)</td><td>15% if total amount of the sale is $5,000 or less, calculated per item 9% if total amount of the sale is over $5,000, calculated per item</td></tr><tr><td>Jewelry &amp; Watches &gt; Watches, Parts &amp; Accessories</td><td>15% on total amount of the sale up to $1,000 calculated per item 6.5% on the portion of the sale over $1,000 up to $7,500 calculated per item 3% on the portion of the sale over $7,500</td></tr></table><p>For orders $10.00 or less the per order fee is $0.30, for orders over $10.00 the per order fee is $0.40.</p>`
 const a=parseCurrentOfficialFeePolicyV1(html,now);assert.equal(a.rules[0].tiers[0].ratePct,15)
 const updated=parseCurrentOfficialFeePolicyV1(html.replace('15% if','16% if'),now)
 assert.equal(updated.rules[0].tiers[0].ratePct,16);assert.notEqual(updated.snapshotVersion,a.snapshotVersion)
 assert.equal(parseCurrentOfficialFeePolicyV1(html.replace('if total amount of the sale is','new unknown fee basis'),now),null)
 assert.equal(parseCurrentOfficialFeePolicyV1('Access denied',now),null)
})
