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
 const f=fixture(),r=await f.read();assert.equal(f.calls.length,6);assert.equal(r.cohortComplete,true)
 const a=r.listings.find(row=>row.itemId===itemA),b=r.listings.find(row=>row.itemId===itemB)
 assert.equal(a.liveStatus,'LIVE_ACTIVE');assert.equal(a.supplierLinkage,'CERTIFIED')
 assert.equal(a.stockGuardState,'IN_STOCK_SIGNAL');assert.equal(a.supplierAvailability,'IN_STOCK')
 assert.deepEqual(a.conflictingLiveItemIds,[itemB])
 assert.equal(b.liveStatus,'LIVE_ACTIVE');assert.equal(b.supplierLinkage,'UNPROVEN')
 assert.equal(b.stockGuardState,'STOCK_UNKNOWN');assert.equal(b.identityQuarantine,'DUPLICATE_LIVE_EBAY_SKU')
 assert.deepEqual(b.components,[]);assert.ok(!JSON.stringify(r).includes('NEVER_RETURN'))
})

test('authority loss immediately makes historical stock non-authoritative',async()=>{
 for(const state of ['SUPERSEDED','UNLINKED','INVALIDATED']){
  const f=fixture();f.rows.seller_os_listing_product_link_authorities_v1[0].lifecycle_state=state
  const r=await f.read();const a=r.listings.find(row=>row.itemId===itemA)
  assert.equal(a.supplierLinkage,'UNPROVEN');assert.equal(a.stockGuardState,'STOCK_UNKNOWN')
 }
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

test('replay reads durable authority without creating jobs or decisions',async()=>{
 const f=fixture();assert.deepEqual(await f.read(),await f.read());assert.equal(f.calls.length,12)
 assert.ok(!f.calls.includes('seller_os_luna_linkage_decisions'))
})
