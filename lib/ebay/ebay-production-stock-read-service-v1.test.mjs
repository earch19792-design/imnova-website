import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { registerHooks } from 'node:module'
registerHooks({resolve(specifier,context,nextResolve){const value=String(specifier??'');if(value.startsWith('.')&&!/\.(?:ts|tsx|mjs|js|json)$/.test(value)){try{return nextResolve(`${value}.ts`,context)}catch{return nextResolve(specifier,context)}}return nextResolve(specifier,context)}})
const { readProductionStockGuardV1 } = await import('./ebay-production-stock-read-service-v1.ts')

const now=new Date('2026-09-19T16:10:00Z')
const itemA='366666581320',itemB='366672502737',sku='IMN-LST-000027'
const product='9220815749344',variant='48809620930784',lunaSku='ITEM5195'
const linkage='luna-linkage-v1:sha256:'+'a'.repeat(64),jobId='job'
const component='luna-component-identity-v1:sha256:'+createHash('sha256').update(JSON.stringify([product,variant,lunaSku])).digest('hex')
const authorityId='listing-link-authority-v1:sha256:'+'d'.repeat(64)
const identityKey='listing-product-identity-v1:sha256:'+'e'.repeat(64)

function fixture(){
 const components=[{componentIdentityId:component,lunaProductId:product,lunaVariantId:variant,lunaSku,
  supplierQuantityRequired:1,exactProductIdentity:true,exactVariantIdentity:true,exactSupplierSku:true,
  structuredVariantAttributesComplete:true,identityConflict:false}]
 const rows={
  ebay_active_listings:[
   {account_key:'account',ebay_item_id:itemA,ebay_sku:sku,listing_status:'active',raw_payload:{secret:'NEVER_RETURN'}},
   {account_key:'account',ebay_item_id:itemB,ebay_sku:sku,listing_status:'active',raw_payload:{}},
  ],
  seller_os_listing_product_link_authorities_v1:[{authority_id:authorityId,account_key:'account',marketplace_id:'EBAY_US',
   ebay_item_id:itemA,ebay_sku:sku,seller_os_product_id:'11111111-1111-4111-8111-111111111111',luna_product_id:product,
   luna_variant_id:variant,luna_sku:lunaSku,supplier_quantity_required:1,evidence_maximum_age_seconds:21600,
   components,identity_key:identityKey,linkage_id:linkage,source_decision_id:'luna-linkage-decision-v1:sha256:'+'f'.repeat(64),
   lifecycle_state:'ACTIVE',previous_authority_id:null,transition_reason_code:'BACKFILL',actor_type:'SYSTEM',
   actor_reference:'SYSTEM:TEST',identity_preflight_status:'HISTORICAL_CERTIFIED_EXACT',source_fingerprint:null,
   identity_engine_version:null,preflight_contract_version:null,activated_at:now.toISOString(),ended_at:null,
   created_at:now.toISOString(),updated_at:now.toISOString()}],
  seller_os_listing_identity_quarantines_v1:[{quarantine_id:'q',account_key:'account',marketplace_id:'EBAY_US',
   ebay_item_id:itemB,ebay_sku:sku,quarantine_state:'ACTIVE',reason_code:'DUPLICATE_LIVE_EBAY_SKU',
   conflicting_item_ids:[itemA],authority_id:null,observed_at:now.toISOString(),resolved_at:null}],
  seller_os_luna_stock_check_jobs:[{stock_check_job_id:jobId,linkage_id:linkage,ebay_item_id:itemA,
   observation_window_start:now.toISOString(),observation_window_end:now.toISOString(),workflow_state:'SUCCEEDED',attempt_count:1,success_receipt_digest:'receipt'}],
  seller_os_luna_stock_observations:[{observation_id:'obs',stock_check_job_id:jobId,linkage_id:linkage,ebay_item_id:itemA,component_identity_id:component,
   luna_product_id:product,luna_variant_id:variant,luna_sku:lunaSku,supplier_quantity_required:1,observation_state:'OBSERVED_IN_STOCK',source_status:'AVAILABLE',
   observed_availability:true,observed_supplier_quantity:null,evidence_class:'SUPPLIER_STATED',evidence_digest:'luna-stock-evidence-v1:sha256:'+'b'.repeat(64),acquisition_method:'CANONICAL_SERVER_READ',attempt_number:1,
   observed_at:now.toISOString(),maximum_age_seconds:21600,limitations:['LUNA_PORTEX_PUBLIC_EXACT_PRODUCT_STOCK','PUBLIC_EXACT_IDENTITY_MATCHED']}],
  ebay_active_listing_sync_state:[{current_live_source_state:'CURRENT_FRESH',last_certified_live_scope_id:'current-live:sha256:'+'c'.repeat(64),
   last_certified_live_item_ids:[itemA,itemB],last_certified_live_count:2,last_certified_live_observed_at:now.toISOString(),last_certified_live_fresh_until:'2026-09-19T16:30:00Z',
   last_certified_live_source_authority:'EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION'}]}
 const calls=[]
 const db={from(table){calls.push(table);let single=false;const q={};for(const method of ['select','eq','in','order','limit'])q[method]=()=>q
  q.maybeSingle=()=>{single=true;return q};q.then=(yes,no)=>Promise.resolve({data:single?rows[table]?.[0]:rows[table],error:null}).then(yes,no);return q}}
 return {rows,calls,read:(overrides={})=>readProductionStockGuardV1({supabase:db,accountKey:'account',accountAlias:'primary',itemId:null,now,...overrides})}
}

test('known duplicate SKU keeps canonical A certified and quarantines live B',async()=>{
 const f=fixture(),r=await f.read();assert.equal(f.calls.length,11);assert.equal(r.cohortComplete,true)
 const a=r.listings.find(row=>row.itemId===itemA),b=r.listings.find(row=>row.itemId===itemB)
 assert.equal(a.liveStatus,'LIVE_ACTIVE');assert.equal(a.supplierLinkage,'CERTIFIED')
 assert.equal(a.stockGuardState,'IN_STOCK_SIGNAL');assert.equal(a.supplierAvailability,'IN_STOCK')
 assert.equal(a.stockFreshness,'FRESH')
 assert.equal(a.stockObservedAt,now.toISOString())
 assert.equal(a.stockFreshUntil,'2026-09-19T22:10:00.000Z')
 assert.deepEqual(a.conflictingLiveItemIds,[itemB])
 assert.equal(b.liveStatus,'LIVE_ACTIVE');assert.equal(b.supplierLinkage,'UNPROVEN')
 assert.equal(b.stockGuardState,'STOCK_UNKNOWN');assert.equal(b.identityQuarantine,'DUPLICATE_LIVE_EBAY_SKU')
 assert.deepEqual(b.components,[]);assert.ok(!JSON.stringify(r).includes('NEVER_RETURN'))
})

test('a linked listing stays stale after its exact six-hour stock evidence expires',async()=>{
 const f=fixture(),old='2026-09-19T08:10:00.000Z'
 f.rows.seller_os_luna_stock_observations[0].observed_at=old
 f.rows.seller_os_luna_stock_check_jobs[0].observation_window_start=old
 f.rows.seller_os_luna_stock_check_jobs[0].observation_window_end=old
 const r=await f.read(),a=r.listings.find(row=>row.itemId===itemA)
 assert.equal(a.stockFreshness,'STALE')
 assert.equal(a.stockObservedAt,old)
 assert.equal(a.stockFreshUntil,'2026-09-19T14:10:00.000Z')
})

test('linked identity without stock evidence remains UNKNOWN with no false zero',async()=>{
 const f=fixture()
 f.rows.seller_os_luna_stock_check_jobs=[]
 f.rows.seller_os_luna_stock_observations=[]
 const row=(await f.read()).listings.find(entry=>entry.itemId===itemA)
 assert.equal(row.supplierLinkage,'CERTIFIED')
 assert.equal(row.stockFreshness,'UNKNOWN')
 assert.equal(row.supplierStockQuantity,null)
 assert.equal(row.limitationCode,'CERTIFIED_COMPONENT_STOCK_NOT_AVAILABLE')
})

test('stock evidence age remains visible when the official LIVE cohort has expired',async()=>{
 const f=fixture(),sweepId='11111111-1111-4111-8111-111111111111'
 const old='2026-09-19T08:10:00.000Z'
 f.rows.seller_os_luna_stock_observations[0].observed_at=old
 f.rows.seller_os_luna_stock_check_jobs[0].observation_window_start=old
 f.rows.seller_os_luna_stock_check_jobs[0].observation_window_end=old
 f.rows.ebay_active_listing_sync_state[0].last_certified_live_fresh_until=old
 f.rows.seller_os_listing_registry_sweeps_v1=[{sweep_id:sweepId,
  official_observed_at:old,official_live_item_count:2,reconciled_item_count:2}]
 f.rows.seller_os_listing_cases_v1=[
  {case_id:'22222222-2222-4222-8222-222222222222',ebay_item_id:itemA,listing_status:'ACTIVE',
   ebay_custom_label:sku,identity_status:'LINKED_EXACT',stockguard_link_status:'LINKED_MONITOR_ONLY',
   stockguard_authority_id:authorityId,origin:'MANUAL_EBAY',last_reconciled_sweep_id:sweepId},
  {case_id:'33333333-3333-4333-8333-333333333333',ebay_item_id:itemB,listing_status:'ACTIVE',
   ebay_custom_label:sku,identity_status:'DUPLICATE_IDENTITY',stockguard_link_status:'NEEDS_OWNER_REVIEW',
   stockguard_authority_id:null,origin:'IMPORTED_LEGACY',last_reconciled_sweep_id:sweepId},
 ]
 const r=await f.read({includeKnownListingStockEvidence:true})
 assert.equal(r.currentLiveState,'CURRENT_UNAVAILABLE')
 assert.equal(r.cohortComplete,false)
 assert.equal(r.listings.length,1)
 assert.equal(r.listings[0].liveStatus,'CURRENT_LIVE_UNPROVEN')
 assert.equal(r.listings[0].stockFreshness,'STALE')
 assert.equal(r.listings[0].stockObservedAt,old)
 assert.equal(r.listings[0].stockFreshUntil,'2026-09-19T14:10:00.000Z')
})

test('authority loss immediately makes historical stock non-authoritative',async()=>{
 for(const state of ['SUPERSEDED','UNLINKED','INVALIDATED']){
  const f=fixture();f.rows.seller_os_listing_product_link_authorities_v1[0].lifecycle_state=state
  const r=await f.read();const a=r.listings.find(row=>row.itemId===itemA)
  assert.equal(a.supplierLinkage,'UNPROVEN');assert.equal(a.stockGuardState,'STOCK_UNKNOWN')
 }
})

test('fresh StockGuard linkage authority supersedes stale listing case status',async()=>{
 const f=fixture(),sweepId='11111111-1111-4111-8111-111111111111'
 f.rows.seller_os_listing_registry_sweeps_v1=[{sweep_id:sweepId,
  official_observed_at:now.toISOString(),official_live_item_count:2,
  reconciled_item_count:2}]
 f.rows.seller_os_listing_cases_v1=[
  {case_id:'22222222-2222-4222-8222-222222222222',ebay_item_id:itemA,listing_status:'ACTIVE',
   ebay_custom_label:sku,identity_status:'AMBIGUOUS',stockguard_link_status:'NEEDS_OWNER_REVIEW',
   stockguard_authority_id:null,origin:'MANUAL_EBAY',last_reconciled_sweep_id:sweepId},
  {case_id:'33333333-3333-4333-8333-333333333333',ebay_item_id:itemB,listing_status:'ACTIVE',
   ebay_custom_label:sku,identity_status:'DUPLICATE_IDENTITY',stockguard_link_status:'NEEDS_OWNER_REVIEW',
   stockguard_authority_id:null,origin:'IMPORTED_LEGACY',last_reconciled_sweep_id:sweepId},
 ]
 const r=await f.read(),a=r.listings.find(row=>row.itemId===itemA)
 assert.equal(r.sourceStatus.listingRegistry,'CURRENT_FRESH')
 assert.equal(a.canonicalCaseId,f.rows.seller_os_listing_cases_v1[0].case_id)
 assert.equal(a.supplierLinkage,'CERTIFIED')
 assert.equal(a.stockFreshness,'FRESH')
})

test('variant, SKU and authority cardinality mismatch fail closed',async()=>{
 for(const mutate of [
  f=>{f.rows.ebay_active_listings[0].ebay_sku='OTHER'},
  f=>{f.rows.seller_os_listing_product_link_authorities_v1.push({...f.rows.seller_os_listing_product_link_authorities_v1[0],authority_id:'listing-link-authority-v1:sha256:'+'9'.repeat(64)})},
 ]){
  const f=fixture();mutate(f);const r=await f.read();const a=r.listings.find(row=>row.itemId===itemA)
  assert.equal(a.supplierLinkage,'UNPROVEN');assert.equal(a.supplierAvailability,'UNKNOWN')
 }
})

test('replay reads durable authorities and decisions without writes',async()=>{
 const f=fixture();assert.deepEqual(await f.read(),await f.read());assert.equal(f.calls.length,22)
 assert.ok(f.calls.includes('seller_os_luna_linkage_decisions'))
})

test('OWNER exact stock receipt becomes fresh, expires, and never invents quantity',async()=>{
 const f=fixture()
 f.rows.seller_os_owner_luna_stock_observations_v1=[{
  observation_id:'11111111-1111-4111-8111-111111111111',
  account_key:'account',marketplace_id:'EBAY_US',ebay_item_id:itemA,
  linkage_id:linkage,luna_sku:lunaSku,luna_product_id:product,
  luna_variant_id:variant,observed_stock_state:'IN_STOCK',
  observed_supplier_quantity:null,observed_at:'2026-09-19T16:11:00Z',
  maximum_age_seconds:21600,
 }]
 f.rows.ebay_active_listing_sync_state[0].last_certified_live_fresh_until='2026-09-20T00:00:00Z'
 const current=(await f.read({now:new Date('2026-09-19T16:12:00Z')})).listings[0]
 assert.equal(current.supplierLinkage,'CERTIFIED')
 assert.equal(current.stockFreshness,'FRESH')
 assert.equal(current.lastSuccessfulSource,'LUNA_OWNER_VISIBLE_SOURCE')
 assert.equal(current.supplierStockQuantity,null)
 assert.equal(current.supplierAvailability,'IN_STOCK')
 const expired=(await f.read({now:new Date('2026-09-19T22:12:00Z')})).listings[0]
 assert.equal(expired.stockFreshness,'STALE')
 assert.equal(expired.stockFreshUntil,'2026-09-19T22:11:00.000Z')
})

test('corrected OWNER quantity remains fresh IN_STOCK without false numeric stock',async()=>{
 const f=fixture()
 f.rows.seller_os_owner_luna_stock_observations_v1=[{
  observation_id:'22222222-2222-4222-8222-222222222222',
  account_key:'account',marketplace_id:'EBAY_US',ebay_item_id:itemA,
  linkage_id:linkage,luna_sku:lunaSku,luna_product_id:product,
  luna_variant_id:variant,observed_stock_state:'IN_STOCK',
  observed_supplier_quantity:85,observed_at:'2026-09-19T16:11:00Z',
  maximum_age_seconds:21600,
 }]
 f.rows.seller_os_owner_luna_stock_quantity_corrections_v1=[{
  observation_id:'22222222-2222-4222-8222-222222222222',
 }]
 const row=(await f.read({now:new Date('2026-09-19T16:12:00Z')})).listings[0]
 assert.equal(row.supplierLinkage,'CERTIFIED')
 assert.equal(row.stockGuardState,'IN_STOCK_SIGNAL')
 assert.equal(row.stockFreshness,'FRESH')
 assert.equal(row.supplierStockQuantity,null)
 assert.equal(row.limitationCode,'NUMERIC_SAFE_CAPACITY_UNPROVEN')
})

test('OWNER receipt with a contradictory exact tuple cannot override stock',async()=>{
 const f=fixture()
 f.rows.seller_os_owner_luna_stock_observations_v1=[{
  account_key:'account',marketplace_id:'EBAY_US',ebay_item_id:itemA,
  linkage_id:linkage,luna_sku:'DIFFERENT',luna_product_id:product,
  luna_variant_id:variant,observed_stock_state:'OUT_OF_STOCK',
  observed_supplier_quantity:0,observed_at:'2026-09-19T16:11:00Z',
  maximum_age_seconds:21600,
 }]
 const row=(await f.read()).listings[0]
 assert.equal(row.supplierAvailability,'IN_STOCK')
 assert.equal(row.lastSuccessfulSource,'CANONICAL_SERVER_READ')
 assert.equal(row.supplierStockQuantity,null)
})

test('approved exact legacy decision remains certified without a newer active-authority row',async()=>{
 const f=fixture(),authority=f.rows.seller_os_listing_product_link_authorities_v1[0]
 f.rows.seller_os_listing_product_link_authorities_v1=[]
 f.rows.seller_os_luna_linkage_decisions=[{
  decision_id:authority.source_decision_id,decision_version:1,decision:'APPROVE_EXACT_LINKAGE',
  decision_at:now.toISOString(),ebay_item_id:itemA,ebay_sku:sku,linkage_id:linkage,
  luna_product_id:product,luna_variant_id:variant,luna_sku:lunaSku,
  components:authority.components,evidence_digest:'',evidence_references:[],
 }]
 const r=await f.read(),a=r.listings.find(row=>row.itemId===itemA)
 assert.equal(a.supplierLinkage,'CERTIFIED')
 assert.equal(a.stockFreshness,'FRESH')
 assert.equal(a.supplierStockQuantity,null)
 assert.equal(r.listings.find(row=>row.itemId===itemB).supplierLinkage,'UNPROVEN')
 f.rows.seller_os_luna_linkage_decisions[0].decision='REJECT_CANDIDATE'
 assert.equal((await f.read()).listings.find(row=>row.itemId===itemA).supplierLinkage,'UNPROVEN')
})

test('duplicate Custom Label is a warning for distinct exact supplier identities',async()=>{
 const f=fixture(),base=f.rows.seller_os_listing_product_link_authorities_v1[0]
 const otherProduct='9635271672032',otherVariant='51243499913440',otherSku='ITEM898'
 f.rows.seller_os_luna_linkage_decisions=[{
  decision_id:'luna-linkage-decision-v1:sha256:'+'b'.repeat(64),
  decision_version:1,decision:'APPROVE_EXACT_LINKAGE',
  decision_at:now.toISOString(),ebay_item_id:itemB,ebay_sku:sku,
  linkage_id:'luna-linkage-v1:sha256:'+'c'.repeat(64),
  luna_product_id:otherProduct,luna_variant_id:otherVariant,
  luna_sku:otherSku,components:[{...base.components[0],
    lunaProductId:otherProduct,lunaVariantId:otherVariant,lunaSku:otherSku}],
  evidence_digest:'',evidence_references:[],
 }]
 const b=(await f.read()).listings.find(row=>row.itemId===itemB)
 assert.equal(b.supplierLinkage,'CERTIFIED')
 assert.equal(b.identityQuarantine,null)
 assert.deepEqual(b.dataQualityWarnings,['DUPLICATE_CUSTOM_LABEL'])
 assert.equal(b.stockFreshness,'UNKNOWN')
})

test('contradicted legacy decision loses stock authority without deleting history',async()=>{
 const f=fixture(),base=f.rows.seller_os_listing_product_link_authorities_v1[0]
 f.rows.seller_os_listing_product_link_authorities_v1=[]
 f.rows.seller_os_luna_linkage_decisions=[{
  decision_id:base.source_decision_id,decision_version:1,
  decision:'APPROVE_EXACT_LINKAGE',decision_at:now.toISOString(),
  ebay_item_id:itemA,ebay_sku:sku,linkage_id:linkage,
  luna_product_id:product,luna_variant_id:variant,luna_sku:lunaSku,
  components:base.components,evidence_digest:'',evidence_references:[],
 }]
 f.rows.seller_os_listing_identity_quarantines_v1.push({
  quarantine_id:'q2',account_key:'account',marketplace_id:'EBAY_US',
  ebay_item_id:itemA,ebay_sku:sku,quarantine_state:'ACTIVE',
  reason_code:'CONTRADICTED_SUPPLIER_IDENTITY',conflicting_item_ids:[itemB],
  authority_id:null,observed_at:now.toISOString(),resolved_at:null,
 })
 const a=(await f.read()).listings.find(row=>row.itemId===itemA)
 assert.equal(a.supplierLinkage,'UNPROVEN')
 assert.equal(a.stockFreshness,'UNKNOWN')
 assert.equal(a.identityQuarantine,'CONTRADICTED_SUPPLIER_IDENTITY')
 assert.equal(f.rows.seller_os_luna_linkage_decisions.length,1)
})

test('complete official sweep takes precedence over expired independent sync marker',async()=>{
 const f=fixture(),sweepId='11111111-1111-4111-8111-111111111111'
 f.rows.ebay_active_listing_sync_state[0].last_certified_live_fresh_until='2026-09-19T08:00:00Z'
 f.rows.seller_os_listing_registry_sweeps_v1=[{sweep_id:sweepId,
  official_observed_at:now.toISOString(),official_live_item_count:2,reconciled_item_count:2}]
 f.rows.seller_os_listing_cases_v1=[itemA,itemB].map((id)=>({
  case_id:id,ebay_item_id:id,ebay_custom_label:sku,ebay_title:'title',listing_status:'ACTIVE',
  identity_status:'MISSING_LUNA_IDENTITY',stockguard_link_status:'BLOCKED_IDENTITY',
  stockguard_authority_id:null,origin:'IMPORTED_LEGACY',last_reconciled_sweep_id:sweepId,
 }))
 const r=await f.read()
 assert.equal(r.currentLiveState,'CURRENT_FRESH')
 assert.equal(r.cohortComplete,true)
 assert.equal(r.listings.find(row=>row.itemId===itemA).supplierLinkage,'CERTIFIED')
 f.rows.ebay_active_listings.pop()
 const missingCache=await f.read()
 assert.equal(missingCache.cohortComplete,true)
 assert.equal(missingCache.listings.length,2)
 assert.equal(missingCache.listings.find(row=>row.itemId===itemB).supplierLinkage,'UNPROVEN')
})
