import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readProductionStockGuardV1 } from './ebay-production-stock-read-service-v1.ts'
const now=new Date('2026-09-11T16:10:00Z'),item='366643126310',sku='FL-3SISTER-KEYCHAIN'
const product='9220851957984',variant='53002121347296'
const linkage='luna-linkage-v1:sha256:'+'a'.repeat(64),jobId='job'
const component='luna-component-identity-v1:sha256:'+createHash('sha256').update(JSON.stringify([product,variant,sku])).digest('hex')
function fixture(){
 const rows={
 ebay_active_listings:[{account_key:'account',ebay_item_id:item,ebay_sku:sku,listing_status:'active',raw_payload:{secret:'NEVER_RETURN'}}],
 seller_os_luna_linkage_decisions:[{decision_id:'decision',decision_version:1,decision:'APPROVE_EXACT_LINKAGE',decision_at:now.toISOString(),
  ebay_item_id:item,ebay_sku:sku,linkage_id:linkage,components:[{componentIdentityId:component,lunaProductId:product,lunaVariantId:variant,lunaSku:sku,
   supplierQuantityRequired:1,exactProductIdentity:true,exactVariantIdentity:true,exactSupplierSku:true,structuredVariantAttributesComplete:true}]}],
 seller_os_luna_stock_check_jobs:[{stock_check_job_id:jobId,linkage_id:linkage,ebay_item_id:item,observation_window_end:now.toISOString(),workflow_state:'SUCCEEDED',attempt_count:1,success_receipt_digest:'receipt'}],
 seller_os_luna_stock_observations:[{observation_id:'obs',stock_check_job_id:jobId,linkage_id:linkage,ebay_item_id:item,component_identity_id:component,
  luna_product_id:product,luna_variant_id:variant,luna_sku:sku,supplier_quantity_required:1,observation_state:'OBSERVED_IN_STOCK',source_status:'AVAILABLE',
  observed_availability:true,observed_supplier_quantity:null,evidence_digest:'luna-stock-evidence-v1:sha256:'+'b'.repeat(64),attempt_number:1,
  observed_at:now.toISOString(),maximum_age_seconds:21600,limitations:['LUNA_PORTEX_PUBLIC_EXACT_PRODUCT_STOCK','PUBLIC_EXACT_IDENTITY_MATCHED']}],
 ebay_active_listing_sync_state:[{current_live_source_state:'CURRENT_FRESH',last_certified_live_scope_id:'current-live:sha256:'+'c'.repeat(64),
  last_certified_live_item_ids:[item],last_certified_live_count:1,last_certified_live_observed_at:now.toISOString(),last_certified_live_fresh_until:'2026-09-11T16:30:00Z',
  last_certified_live_source_authority:'EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION'}]}
 const calls=[]
 const db={from(table){calls.push(table);let single=false;const q={};for(const method of ['select','eq','in','order','limit'])q[method]=()=>q
  q.maybeSingle=()=>{single=true;return q};q.then=(yes,no)=>Promise.resolve({data:single?rows[table]?.[0]:rows[table],error:null}).then(yes,no);return q}}
 return {rows,calls,read:(overrides={})=>readProductionStockGuardV1({supabase:db,accountKey:'account',accountAlias:'primary',itemId:null,now,...overrides})}
}
test('deployed read consumer uses exact durable linkage and availability-only stock without quantity fabrication',async()=>{
 const f=fixture(),r=await f.read();assert.equal(f.calls.length,5);assert.equal(r.cohortComplete,true)
 const row=r.listings[0];assert.equal(row.liveStatus,'LIVE_ACTIVE');assert.equal(row.supplierLinkage,'CERTIFIED')
 assert.equal(row.stockGuardState,'IN_STOCK_SIGNAL');assert.equal(row.stockFreshness,'FRESH');assert.equal(row.supplierAvailability,'IN_STOCK')
 assert.deepEqual(row.components,[{supplierProductId:product,supplierVariantId:variant,supplierSku:sku}])
 assert.ok(!JSON.stringify(r).includes('NEVER_RETURN'))
})
test('stale/unknown stock cannot become out of stock and performs no takedown',async()=>{
 const f=fixture();f.rows.seller_os_luna_stock_observations[0].observed_at='2026-09-10T00:00:00Z'
 const r=await f.read();assert.equal(r.listings[0].supplierAvailability,'UNKNOWN');assert.equal(r.listings[0].stockFreshness,'STALE');assert.equal(f.calls.length,5)
})
test('wrong SKU, duplicate identity and revoked linkage fail closed',async()=>{
 for(const change of [f=>{f.rows.ebay_active_listings[0].ebay_sku='other'},f=>{f.rows.ebay_active_listings.push({...f.rows.ebay_active_listings[0]})},
  f=>{f.rows.seller_os_luna_linkage_decisions[0].decision='REJECT'}]){
  const f=fixture();change(f);const r=await f.read();assert.equal(r.listings[0].supplierLinkage,'UNPROVEN');assert.equal(r.listings[0].supplierAvailability,'UNKNOWN')
 }
})
test('missing current live evidence cannot certify a cohort from historical active strings',async()=>{
 const f=fixture();f.rows.ebay_active_listing_sync_state[0].last_certified_live_fresh_until='2026-09-10T00:00:00Z'
 const r=await f.read({itemId:item});assert.equal(r.cohortComplete,false);assert.equal(r.listings[0].liveStatus,'CURRENT_LIVE_UNPROVEN')
})
test('replay reads the same durable identity without creating jobs/decisions',async()=>{
 const f=fixture();assert.deepEqual(await f.read(),await f.read());assert.equal(f.calls.length,10)
})
