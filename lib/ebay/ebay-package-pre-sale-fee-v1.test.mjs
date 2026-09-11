import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { feeFixtureV1 } from '../../tools/fee-economics-test-fixtures-v1.mjs'
// Every test uses synthetic evidence. Any accidental marketplace/source call fails.
globalThis.fetch=()=>{throw Error('NO_EXTERNAL_CALLS_ALLOWED')}
registerHooks({resolve(s,c,n){if(s==='server-only')return {url:'data:text/javascript,export{}',shortCircuit:true};try{return n(s,c)}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.(ts|mjs|js)$/.test(s))return n(s+'.ts',c);throw e}}})
const {produceEbayFeeAuthorityV1,feePackageRevisionV1}=await import('../seller-os/ebay-fee-producer-v1.ts')
const {persistProducedEbayFeeV1,readEbayFeeHandoffV1,runPendingPackageFeesV1}=await import('../seller-os/ebay-fee-runtime-v1.ts')
const {consumeListingFeeAuthorityV1}=await import('../seller-os/listing-fee-authority-v1.ts')
const {feeSubjectMatchesV1}=await import('../seller-os/fee-subject-v1.ts')
const packageId='24535b37-0335-4984-a36c-dbb73a7560da'
function fixture(){
 const i=feeFixtureV1(), data={title:'Synthetic product',categoryId:'50692',pricing:{targetPrice:52.99,currency:'USD'},imageUrls:['https://example.test/authorized.jpg']}
 const subject={itemId:null,packageId,sku:i.sku,packageRevision:feePackageRevisionV1(data)}
 Object.assign(i,subject)
 for(const evidence of [i.context.identity,i.context.categoryFeePolicy.policy,i.resolutionInputs.context,i.resolutionInputs.basis,...i.resolutionInputs.adjustments,...i.resolutionInputs.boundCoverage])Object.assign(evidence,subject)
 return {i,data}
}
test('PRE_SALE_ITEM_ID_DEPENDENCY_REMOVED: exact package resolves with existing official bound contract',()=>{
 const {i}=fixture(),a=produceEbayFeeAuthorityV1(i)
 assert.equal(a.state,'PROVEN_PRE_SALE');assert.equal(a.itemId,null);assert.equal(a.packageId,packageId)
 assert.equal(a.amount,9.03);assert.equal(a.feeEstimateMode,'CONSERVATIVE_SAFE_BOUND');assert.equal(a.actualPostSaleFee,null)
 assert.equal(a.buyerTaxTreatedAsSellerCost,false);assert.equal(a.buyerTaxTreatedAsSellerRevenue,false)
 assert.equal(consumeListingFeeAuthorityV1({...i,categoryId:'50692',salePrice:52.99,metadata:{feeAuthorityV1:a.resolvedAuthority}}).status,'PROVEN')
})
test('package, revision, SKU and account mismatches fail closed at every fee evidence boundary',()=>{
 const paths=[i=>i.context.identity,i=>i.context.categoryFeePolicy.policy,i=>i.resolutionInputs.context,
   i=>i.resolutionInputs.basis,i=>i.resolutionInputs.adjustments[0],i=>i.resolutionInputs.boundCoverage[0]]
 for(const path of paths)for(const key of ['packageId','packageRevision','sku']){
   const {i}=fixture();path(i)[key]='OTHER';assert.equal(produceEbayFeeAuthorityV1(i).amount,null,`${key} at ${path}`)
 }
 const {i}=fixture();i.context.marketplaceAccountKey='OTHER';assert.equal(produceEbayFeeAuthorityV1(i).state,'CONFLICT')
 assert.equal(feeSubjectMatchesV1({itemId:undefined},{}),false)
 assert.equal(feeSubjectMatchesV1({itemId:null,packageId:'-'.repeat(36),packageRevision:i.packageRevision,sku:i.sku},{...i,itemId:null,packageId:'-'.repeat(36)}),false)
})
test('missing or expired package fee inputs remain pending; unknown tax and costs never become zero',()=>{
 for(const edit of [i=>delete i.resolutionInputs,i=>i.resolutionInputs.boundCoverage.pop(),
   i=>i.resolutionInputs.basis.buyerTax=null,i=>i.resolutionInputs.basis.method='EXACT_SCENARIO',
   i=>i.context.categoryFeePolicy.policy.freshUntil='2026-09-08T00:00:00Z']){
   const {i}=fixture();edit(i);const a=produceEbayFeeAuthorityV1(i)
   assert.equal(a.amount,null);assert.equal(a.resolvedAuthority,null);assert.equal(a.promotionBlockedEvidence,true)
 }
})
test('fee handoff does not hash itself; changing material package content invalidates the revision',()=>{
 const {i,data}=fixture();const bound={...data,feeContextV1:i.context,feeResolutionInputsV1:i.resolutionInputs}
 assert.equal(feePackageRevisionV1(bound),i.packageRevision)
 for(const change of [p=>p.title='Other',p=>p.categoryId='OTHER',p=>p.pricing.targetPrice=17.77,p=>p.imageUrls.reverse().push('https://example.test/other.jpg')]){
  const changed=structuredClone(bound);change(changed);assert.notEqual(feePackageRevisionV1(changed),i.packageRevision)
 }
})
function database(i,data){
 const state={data,head:null,authority:null,records:0,updates:0,queries:[],concurrent:false}
 const db={from(table){let payload,filters={},operation='select';const q={
  select(){return q},eq(k,v){filters[k]=v;return q},is(k,v){filters[k]=v;return q},lte(){return q},order(){return q},limit(){return q},
  abortSignal(){return q},retry(v){assert.equal(v,false);return q},
  upsert(v){operation='upsert';payload=v;return q},update(v){operation='update';payload=v;return q},
  single(){return q},maybeSingle(){return q},then(resolve,reject){return Promise.resolve().then(()=>{
   state.queries.push(table)
   if(table==='ebay_listing_packages')return {data:{id:packageId,account_key:i.accountKey,opportunity_id:'OPPORTUNITY',candidate_key:'CANDIDATE',package_data:state.data},error:null}
   if(table==='ebay_luna_opportunity_queue')return {data:{supplier_sku:i.sku,supplier_product_id:'PRODUCT',supplier_variant_id:'VARIANT'},error:null}
   if(table==='seller_os_ebay_fee_authorities_v1')return {data:state.authority?{authority:state.authority}:null,error:null}
   assert.equal(table,'seller_os_ebay_fee_bindings_v1')
   if(operation==='upsert'){state.head??={...payload,authority_id:null,state:'PENDING_ORDER_CONTEXT',updated_at:i.now.toISOString()};return {error:null}}
   if(operation==='update'){state.updates++;if(state.concurrent)return {data:null,error:{code:'CONFLICT'}};Object.assign(state.head,payload);return {data:state.head,error:null}}
   return {data:filters.binding_key?state.head:state.head?[state.head]:[],error:null}
  }).then(resolve,reject)}};return q},
 rpc(name,args){assert.equal(name,'seller_os_record_fee_authority_v1');state.records++;
  if(state.concurrent||args.p_expected_updated_at!==state.head.updated_at)return Promise.resolve({data:false,error:null})
  state.authority=args.p_authority;Object.assign(state.head,{authority_id:state.authority.authorityId,state:state.authority.state})
  return Promise.resolve({data:true,error:null})}}
 return {db,state}
}
test('normal package producer and handoff bind SKU/revision with zero marketplace calls',async()=>{
 const {i,data}=fixture(),{db,state}=database(i,data)
 const a=await persistProducedEbayFeeV1({...i,supabase:db})
 assert.equal(a.state,'PROVEN_PRE_SALE');assert.equal(a.packageRevision,i.packageRevision);assert.equal(state.records,1)
 assert.equal((await readEbayFeeHandoffV1({...i,supabase:db})).status,'PROVEN')
 state.data={...data,title:'Changed package'}
 const stale=await readEbayFeeHandoffV1({...i,supabase:db});assert.equal(stale.status,'STALE');assert.equal(stale.resolvedAuthority,null)
 assert.equal(state.records,1);assert.equal(state.updates,0)
 await assert.rejects(persistProducedEbayFeeV1({...i,supabase:db}),/FEE_INPUT_CHANGED_RETRY/)
 assert.equal(state.records,1);assert.equal(state.updates,0)
})
test('missing head uses exact package; legacy null SKU is resolved without rewriting package/history',async()=>{
 const {i,data}=fixture(),{db,state}=database(i,data)
 await persistProducedEbayFeeV1({...i,supabase:db})
 state.head.sku=null
 await persistProducedEbayFeeV1({...i,supabase:db,sku:null})
 assert.equal(state.head.sku,i.sku);assert.equal(state.updates,1);assert.deepEqual(state.data,data)
 state.concurrent=true;await assert.rejects(persistProducedEbayFeeV1({...i,supabase:db}),/FEE_INPUT_CHANGED_RETRY/)
})
test('existing bounded package lane automatically consumes durable current fee inputs',async()=>{
 const {i,data}=fixture(),stored={...data,feeContextV1:i.context,feeResolutionInputsV1:i.resolutionInputs}
 const {db,state}=database(i,stored)
 await persistProducedEbayFeeV1({...i,supabase:db,context:{}})
 state.head.state='PENDING_ORDER_CONTEXT'
 assert.equal(await runPendingPackageFeesV1({supabase:db,accountKey:i.accountKey,now:i.now}),1)
 assert.equal(state.authority.state,'PROVEN_PRE_SALE');assert.equal(state.authority.packageRevision,i.packageRevision)
})
test('live fee authority and new package authority cannot substitute for each other',()=>{
 const live=feeFixtureV1(),published=produceEbayFeeAuthorityV1(live)
 assert.equal(published.state,'PROVEN_PRE_SALE');assert.equal(published.amount,9.03)
 const {i}=fixture();i.context=live.context;assert.equal(produceEbayFeeAuthorityV1(i).state,'CONFLICT')
 live.context=fixture().i.context;assert.equal(produceEbayFeeAuthorityV1(live).state,'CONFLICT')
})
test('runtime cannot hide a supplied wrong account, price or category behind a valid package binding',async()=>{
 const {i,data}=fixture(),{db}=database(i,data)
 i.context.marketplaceAccountKey='OTHER'
 assert.equal((await persistProducedEbayFeeV1({...i,supabase:db})).state,'CONFLICT')
 i.context.marketplaceAccountKey=i.accountKey;i.context.listing.price=17.77
 await assert.rejects(persistProducedEbayFeeV1({...i,supabase:db}),/FEE_PACKAGE_CONTEXT_CONFLICT/)
 i.context.listing.price=52.99;i.context.listing.categoryId='OTHER'
 await assert.rejects(persistProducedEbayFeeV1({...i,supabase:db}),/FEE_PACKAGE_CONTEXT_CONFLICT/)
})

test('package account context retains fresh official tax scope and derives only missing package identity fields',async()=>{
 const {i,data}=fixture(),{db}=database(i,data)
 i.context.identity={itemId:null,packageId,sku:i.sku,marketplace:'EBAY_US'}
 i.context.accountPerformance.registrationState='FL'
 i.context.feeTaxPolicy={source:'https://www.ebay.com/help/fees-billing/sell-fees-payments/payments-taxes-import-charges?id=4121',digest:'a'.repeat(64),observedAt:new Date(i.now.getTime()-1000).toISOString(),freshUntil:new Date(i.now.getTime()+3600000).toISOString(),applicableStates:['HI','SD','TX','WA']}
 const a=await persistProducedEbayFeeV1({...i,supabase:db})
 assert.notEqual(a.state,'CONFLICT');assert.deepEqual(a.feeTaxPolicy,i.context.feeTaxPolicy)
 i.context.identity.packageId='OTHER'
 assert.equal((await persistProducedEbayFeeV1({...i,supabase:db})).state,'CONFLICT')
})

const {exactCategoryAncestryV1,bindPackageCategoryFeeV1}=await import('./ebay-package-category-fee-binding-v1.ts')
const categorySnapshot=(await import('../../docs/ebay-official-basic-fee-policy-snapshot-v1.json',{with:{type:'json'}})).default
function categoryResponse(){return {categoryTreeId:'0',categoryTreeVersion:'134',categorySuggestions:[{category:{categoryId:'50692',categoryName:'Jewelry Sets'},categoryTreeNodeLevel:3,categoryTreeNodeAncestors:[{categoryId:'676',categoryName:'Fashion Jewelry',categoryTreeNodeLevel:2},{categoryId:'26395',categoryName:'Jewelry & Watches',categoryTreeNodeLevel:1}]}]}}
test('official ancestry resolves only the already-selected exact category and refuses ambiguity',()=>{
 const {i}=fixture(),response=categoryResponse(),a=exactCategoryAncestryV1(response,'50692','0',i.now)
 assert.equal(a.path,'Jewelry & Watches:Fashion Jewelry:Jewelry Sets');assert.deepEqual(a.ancestorIds,['26395','676'])
 assert.equal(exactCategoryAncestryV1(response,'261987','0',i.now),null)
 assert.equal(exactCategoryAncestryV1({...response,categorySuggestions:[...response.categorySuggestions,...response.categorySuggestions]},'50692','0',i.now),null)
 const broken=categoryResponse();broken.categorySuggestions[0].categoryTreeNodeAncestors[0].categoryTreeNodeLevel=5
 assert.equal(exactCategoryAncestryV1(broken,'50692','0',i.now),null)
})
test('official package fee binding reuses category rules; parent service profile requires current ancestry',async()=>{
 const {i,data}=fixture(),{db}=database(i,data),ancestry=exactCategoryAncestryV1(categoryResponse(),'50692','0',i.now)
 const snapshot={...categorySnapshot,verifiedAt:i.now.toISOString()}
 const input={ancestry,policySnapshot:snapshot,store:{status:'PROVEN',storeSubscriptionLevel:'NO_STORE',source:'GetUser'},accountKey:i.accountKey,packageId,packageRevision:i.packageRevision,sku:i.sku,categoryId:'50692',now:i.now}
 assert.equal(bindPackageCategoryFeeV1(input).policy.tiers[0].ratePct,15)
 assert.equal(bindPackageCategoryFeeV1({...input,ancestry:{...ancestry,freshUntil:'2020-01-01'}}),null)
 assert.equal(bindPackageCategoryFeeV1({...input,policySnapshot:{...snapshot,verifiedAt:'bad'}}),null)
 delete i.context.categoryFeePolicy;i.context.categoryAuthority=ancestry;i.context.officialFeePolicySnapshot=snapshot;i.context.resolvedStoreContext=input.store
 i.context.listing.saleFormat='FIXED_PRICE';i.context.accountPerformance.serviceMetrics.categories=[{categoryId:'26395',rating:'NOT_APPLICABLE'}]
 const a=await persistProducedEbayFeeV1({...i,supabase:db})
 assert.equal(a.basePreSaleFeeProven,true);assert.ok(a.components.find(c=>c.type==='SERVICE_METRICS').amount === 0)
 i.context.categoryAuthority={...ancestry,freshUntil:'2020-01-01'}
 const stale=await persistProducedEbayFeeV1({...i,supabase:db});assert.equal(stale.basePreSaleFeeProven,false);assert.equal(stale.components.find(c=>c.type==='SERVICE_METRICS').amount,null)
})

test('fresh package context is reused only for the exact commercial binding and original observation',async()=>{
 const {reusablePackageFeeContextV1}=await import('./ebay-package-category-fee-binding-v1.ts')
 const {i}=fixture(),binding={accountKey:i.accountKey,packageId,productId:'PRODUCT',variantId:'VARIANT',sku:i.sku,categoryId:'50692',price:52.99}
 const context={...i.context,listing:{...i.context.listing,currency:'USD'},identity:{...i.context.identity,productId:'PRODUCT',variantId:'VARIANT'},
  officialFeePolicySnapshot:{verifiedAt:i.now.toISOString()},feeTaxPolicy:{freshUntil:new Date(i.now.getTime()+3600000).toISOString()},subscription:{status:'UNPROVEN'}}
 assert.equal(reusablePackageFeeContextV1(context,binding,i.now),context)
 for(const field of ['accountKey','packageId','productId','variantId','sku','categoryId','price'])
  assert.equal(reusablePackageFeeContextV1(context,{...binding,[field]:'OTHER'},i.now),null)
 assert.equal(reusablePackageFeeContextV1({...context,observedAt:'2020-01-01'},binding,i.now),null)
 assert.equal(reusablePackageFeeContextV1({...context,feeTaxPolicy:{freshUntil:'2020-01-01'}},binding,i.now),null)
 const {data}=fixture(),{db}=database(i,data)
 await persistProducedEbayFeeV1({...i,supabase:db})
 const later=new Date(i.now.getTime()+60000)
 const reused=await persistProducedEbayFeeV1({...i,supabase:db,now:later,context:{observedAt:later.toISOString()}})
 assert.equal(reused.sourceObservedAt,i.context.observedAt)
 assert.equal(reused.basePreSaleFeeProven,true)
})
