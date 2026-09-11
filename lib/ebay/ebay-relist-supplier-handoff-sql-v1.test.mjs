import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto'
const read=name=>readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8')
const main=read('20260911155055_deterministic_relist_supplier_handoff_v1.sql')
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const jsonColumns=new Set(['components','identity_evidence_provenance','provenance'])
const arrayColumns=new Set(['match_signals','conflict_signals','evidence_references'])
const intColumns=new Set(['supplier_quantity_required','decision_version','evidence_maximum_age_seconds'])
function schema(table){
 const columns=main.match(new RegExp(`insert into public\\.${table} \\(([\\s\\S]*?)\\) values`))[1].split(',').map(x=>x.trim())
 return `create table ${table} (${columns.map(c=>`${c} ${jsonColumns.has(c)?'jsonb':arrayColumns.has(c)?'text[]':intColumns.has(c)?'integer':c==='actor_user_id'?'uuid':c==='approval_eligible'?'boolean':c.endsWith('_at')?'timestamptz':'text'}`).join(',')},
 check(is_valid_seller_os_luna_linkage_components_v1(components)), unique(${table.endsWith('decisions')?'decision_id':'review_candidate_id'}));`
}
test('real SQL relist handoff: certified lineage, identity boundaries, immutable history and idempotent replay',async t=>{
 const db=new PGlite({extensions:{pgcrypto}})
 try{
 await db.exec(`create schema extensions; create extension pgcrypto schema extensions;
 create role anon; create role authenticated; create role service_role;
 create function is_seller_os_service_role_request_v1() returns boolean language sql as $$select true$$;
 create table ebay_active_listings(id uuid primary key,account_key text,ebay_item_id text,ebay_sku text,listing_status text,market_radar_product_id uuid,supplier_variant_id text,supplier_sku text,raw_payload jsonb,last_ebay_sync_at timestamptz,updated_at timestamptz);
 create table ebay_luna_opportunity_queue(id uuid primary key,candidate_key text,supplier_product_id text,supplier_variant_id text,supplier_sku text,market_radar_product_id uuid,assessment jsonb,product_title text,variant_title text);
 create table ebay_listing_packages(id uuid primary key,account_key text,opportunity_id uuid,candidate_key text,created_by uuid);
 create table market_radar_latest_variants(source_key text,supplier_product_id text,supplier_variant_id text,sku text);
 create table ebay_same_day_pilot_events(id uuid,candidate_id uuid,event_type text,event_payload jsonb);
 create table ebay_same_day_pilot_candidates(id uuid,opportunity_id uuid,candidate_key text,supplier_variant_id text,supplier_sku text);
 create table ebay_manual_listing_links(id uuid,created_by uuid,account_key text,opportunity_id uuid,ebay_item_id text,supplier_variant_id text,supplier_sku text);`)
 const validators=read('20260822150720_create_seller_os_luna_linkage_approval_control_plane.sql')
 await db.exec(validators.slice(0,validators.indexOf('create or replace function public.is_seller_os_service_role_request_v1')))
 await db.exec(schema('seller_os_luna_linkage_review_candidates')+schema('seller_os_luna_linkage_decisions'))
 await db.exec(main.slice(0,main.indexOf('-- CURRENT publication completion')))
 await db.exec(read('20260911155742_relist_handoff_preserve_revocation_v1.sql'))
 await db.exec(read('20260911155921_relist_handoff_component_contract_v1.sql'))
 await db.exec(read('20260911160458_relist_handoff_explicit_chain_v1.sql'))
 const truth={productTruth:{fieldTruthV1:{evidenceDigest:'sha256:'+'a'.repeat(64),fields:[['LUNA_PRODUCT_ID','9220851957984'],['LUNA_VARIANT_ID','53002121347296'],['SUPPLIER_SKU','FL-3SISTER-KEYCHAIN']].map(([FIELD,VALUE])=>({FIELD,VALUE,EVIDENCE_STATUS:'PROVEN',SEMANTIC_CLASS:'FACT',CONTRADICTION:false,SOURCE:'LUNA_EXACT_VARIANT'}))}}}
 await db.query('insert into ebay_luna_opportunity_queue values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[uuid(3),'luna:exact','9220851957984','53002121347296','FL-3SISTER-KEYCHAIN',uuid(4),JSON.stringify(truth),'Unrelated title',null])
 await db.query('insert into ebay_listing_packages values($1,$2,$3,$4,null)',[uuid(5),'account',uuid(3),'luna:exact'])
 await db.exec(`insert into ebay_active_listings values
 ('${uuid(1)}','account','366643126310','FL-3SISTER-KEYCHAIN','active',null,null,null,'{"source":"EBAY_TRADING_GET_MY_EBAY_SELLING","marketplaceId":"EBAY_US"}',now(),now()),
 ('${uuid(2)}','account','366553691290','FL-3SISTER-KEYCHAIN','ended','${uuid(4)}','53002121347296','FL-3SISTER-KEYCHAIN','{}',now(),now());
 insert into market_radar_latest_variants values('lunaportex','9220851957984','53002121347296','FL-3SISTER-KEYCHAIN');
 insert into seller_os_luna_linkage_decisions(decision_id,decision_version,account_key,marketplace_id,ebay_item_id,decision,luna_product_id,luna_variant_id,luna_sku)
 values('historical',1,'account','EBAY_US','366553691290','APPROVE_EXACT_LINKAGE','9220851957984','53002121347296','FL-3SISTER-KEYCHAIN');`)
 const run=async(apply=true)=>(await db.query("select resolve_relist_supplier_handoff_v1('account','366643126310',$1) as result",[apply])).rows[0].result
 const scenario=async(name,change,reason)=>t.test(name,async()=>{
  await db.exec('begin');try{await db.exec(change);const r=await run();assert.equal(r.reason,reason);assert.notEqual(r.status,'CERTIFIED');assert.equal((await db.query("select decision_id from seller_os_luna_linkage_decisions where ebay_item_id='366643126310'")).rows.length,0)}finally{await db.exec('rollback')}
 })
 await scenario('similar SKU cannot inherit exact historical identity',"update ebay_active_listings set ebay_sku='FL-3SISTER-KEYCHAIN-X' where listing_status='active'",'CERTIFIED_PREDECESSOR_MISSING')
 await scenario('another account cannot inherit lineage',"update ebay_active_listings set account_key='other' where listing_status='ended'",'CERTIFIED_PREDECESSOR_MISSING')
 await scenario('ambiguous relist fails closed',`insert into ebay_active_listings select '${uuid(8)}',account_key,'366553691291',ebay_sku,listing_status,market_radar_product_id,supplier_variant_id,supplier_sku,raw_payload,last_ebay_sync_at,updated_at from ebay_active_listings where listing_status='ended'`,'AMBIGUOUS_PREDECESSOR')
 await scenario('revoked canonical history cannot fall back to older approval',"update seller_os_luna_linkage_decisions set decision='REJECT_CANDIDATE'",'PREDECESSOR_LINKAGE_REVOKED_OR_CONFLICTED')
 await scenario('wrong current variant fails closed',"update ebay_active_listings set supplier_variant_id='other' where listing_status='active'",'CURRENT_SUPPLIER_IDENTITY_CONFLICT')
 await scenario('product truth identity contradiction fails closed',"update ebay_luna_opportunity_queue set assessment=jsonb_set(assessment,'{productTruth,fieldTruthV1,fields,0,CONTRADICTION}','true')",'PRODUCT_TRUTH_IDENTITY_MISMATCH')
 await scenario('duplicate supplier SKU with different variant fails closed',"insert into market_radar_latest_variants values('lunaportex','9220851957984','99999999','FL-3SISTER-KEYCHAIN')",'SUPPLIER_IDENTITY_NOT_UNIQUE')
 await scenario('newer different certified identity cannot reuse an older certificate',"update seller_os_luna_linkage_decisions set luna_variant_id='other'",'PREDECESSOR_LINKAGE_REVOKED_OR_CONFLICTED')
 await t.test('apply and replay preserve exact lineage and predecessor history',async()=>{
  const before=(await db.query("select to_jsonb(a) as row from ebay_active_listings a where listing_status='ended'")).rows
  assert.equal((await run(false)).status,'READY_TO_BIND')
  const first=await run();assert.equal(first.status,'CERTIFIED');assert.equal(first.durableReadbackMatch,true)
  assert.equal(first.productId,'9220851957984');assert.equal(first.variantId,'53002121347296');assert.equal(first.supersedesItemId,'366553691290')
  const replay=await run();assert.equal(replay.idempotent,true);assert.equal(replay.linkageId,first.linkageId)
  assert.equal((await db.query("select decision_id from seller_os_luna_linkage_decisions where ebay_item_id='366643126310'")).rows.length,1)
  assert.deepEqual((await db.query("select to_jsonb(a) as row from ebay_active_listings a where listing_status='ended'")).rows,before)
 })
 await t.test('a second relist follows explicit durable chain rather than picking the newest by time',async()=>{
  await db.exec("update ebay_active_listings set listing_status='ended' where ebay_item_id='366643126310'")
  await db.query("insert into ebay_active_listings(id,account_key,ebay_item_id,ebay_sku,listing_status,raw_payload,last_ebay_sync_at,updated_at) values($1,'account','366643126311','FL-3SISTER-KEYCHAIN','active',$2,now(),now())",[uuid(9),JSON.stringify({source:'EBAY_TRADING_GET_MY_EBAY_SELLING',marketplaceId:'EBAY_US'})])
  const r=(await db.query("select resolve_relist_supplier_handoff_v1('account','366643126311',true) as result")).rows[0].result
  assert.equal(r.status,'CERTIFIED');assert.equal(r.supersedesItemId,'366643126310')
  assert.equal(r.productId,'9220851957984');assert.equal(r.variantId,'53002121347296')
 })

 }finally{await db.close()}
})
