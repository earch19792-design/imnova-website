import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'

const migration=readFileSync(new URL('../../supabase/migrations/20261005224341_seller_os_commercial_memory_and_golden_path_hardening_v1.sql',import.meta.url),'utf8')
const indexMigration=readFileSync(new URL('../../supabase/migrations/20261005224707_seller_os_commercial_memory_fk_indexes_v1.sql',import.meta.url),'utf8')
const supplierScopeMigration=readFileSync(new URL('../../supabase/migrations/20261006191123_seller_os_888lots_manual_dual_market_capture_v1.sql',import.meta.url),'utf8')
const account='SYNTHETIC-ACCOUNT'
const owner='10000000-0000-4000-8000-000000000002'
const receipt='10000000-0000-4000-8000-000000000001'
const receiptDigest=`sha256:${'a'.repeat(64)}`
const memoryDigest=`sha256:${'b'.repeat(64)}`

function memory(overrides={}){return {
 contractVersion:'SELLER_OS_COMMERCIAL_OPPORTUNITY_MEMORY_V1',canonicalResultVersion:'CANONICAL_OPPORTUNITY_RESULT_V2_2026_08_12',
 candidate:{productId:'9220861100256',variantId:'53002125082848',supplierSku:'FL-EAGLE-RING',supplierQuantity:1,title:'Fixture Eagle Ring'},
 lifecycleStage:'DEMAND_PROVEN',completedStages:['DISCOVERED','DEMAND_PROVEN'],decision:'UNPROVEN',
 demand:{status:'PROVEN',soldQuantity:4},evidenceFreshness:'FRESH',blockers:['PRODUCT_FIT_UNPROVEN'],
 nextBestEvidence:{action:'VERIFY_PRODUCT_FIT',priority:1,reasonCode:'PRODUCT_FIT_UNPROVEN',authority:'LUNA_PRODUCT_TRUTH',inventedEvidence:false},
 decisionProvenance:{evaluationReceiptId:receipt,evaluationEvidenceDigest:receiptDigest,sourceEvaluationEvidenceDigest:`sha256:${'c'.repeat(64)}`,minimumNetProfitUsd:0,failClosed:true},
 marketOpportunityCase:{opportunityCaseId:null,familyId:null,linkageStatus:'UNPROVEN_NOT_INVENTED'},
 observedAt:'2026-10-05T20:00:00Z',safety:{marketplaceWrites:0,publications:0,repricing:0,ebayMutationAllowed:false},memoryDigest,...overrides}}

test('commercial memory SQL is idempotent, append-only and readback-safe',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table public.seller_os_market_opportunity_cases(opportunity_case_id text primary key,family_id text not null unique,constraint cases_pair unique(family_id,opportunity_case_id));
   create table public.seller_os_golden_path_receipts_v1(receipt_id uuid primary key,account_key text not null,owner_user_id uuid not null,kind text not null,evidence_digest text not null,payload jsonb not null);
   create table public.ebay_luna_opportunity_queue(id uuid primary key default gen_random_uuid(),candidate_key text not null unique,supplier_product_id text,supplier_variant_id text,supplier_sku text,product_title text not null,queue_status text not null default 'watchlist',decision text not null,assessment jsonb not null default '{}'::jsonb,dashboard_radar_family_id text);
   create table public.ebay_luna_opportunity_queue_events(id uuid primary key default gen_random_uuid(),opportunity_id uuid not null references public.ebay_luna_opportunity_queue(id) on delete cascade,event_type text not null,old_value jsonb,new_value jsonb,idempotency_key text not null unique,created_at timestamptz not null default now(),constraint ebay_luna_opportunity_queue_event_type_check check(event_type in('discovered','rescored','price_up','price_down','out_of_stock','restocked','stock_changed','listed','status_changed')));
   grant all on public.seller_os_golden_path_receipts_v1,public.ebay_luna_opportunity_queue,public.ebay_luna_opportunity_queue_events to service_role;`)
  await db.exec(migration)
  await db.exec(indexMigration)
  await db.exec(supplierScopeMigration)
  await db.query(`insert into public.seller_os_golden_path_receipts_v1 values($1,$2,$3,'EVALUATION',$4,'{}')`,[receipt,account,owner,receiptDigest])
  const call=(payload=memory())=>db.query(`select public.put_seller_os_commercial_opportunity_memory_v1($1,$2,$3,$4) as result`,[account,owner,JSON.stringify(payload),`commercial-memory:${payload.memoryDigest}`])
  const first=(await call()).rows[0].result
  const replay=(await call()).rows[0].result
  assert.equal(first.status,'STORED');assert.equal(first.replay,false)
  assert.equal(replay.status,'IDEMPOTENT_SUCCESS');assert.equal(replay.replay,true)
  const row=(await db.query(`select commercial_memory,commercial_memory_digest,commercial_next_best_evidence,commercial_evidence_freshness from public.ebay_luna_opportunity_queue`)).rows[0]
  assert.equal(row.commercial_memory_digest,memoryDigest)
  assert.equal(row.commercial_memory.memoryDigest,memoryDigest)
  assert.equal(row.commercial_next_best_evidence,'VERIFY_PRODUCT_FIT')
  assert.equal(row.commercial_evidence_freshness,'FRESH')
  assert.equal((await db.query(`select count(*)::integer as n from public.ebay_luna_opportunity_queue_events`)).rows[0].n,1)
  await assert.rejects(db.query(`update public.ebay_luna_opportunity_queue_events set new_value='{}'`),/SELLER_OS_COMMERCIAL_MEMORY_EVENT_IMMUTABLE/)
  const invalid=memory({decisionProvenance:{...memory().decisionProvenance,evaluationReceiptId:'10000000-0000-4000-8000-000000000009'}})
  await assert.rejects(call(invalid),/SELLER_OS_COMMERCIAL_MEMORY_AUTHORITY_INVALID/)
  const supplierMemory=memory({candidate:{sourceKey:'888lots',productId:'888-B096YQGYFP-US',variantId:'888-B096YQGYFP-US',supplierSku:'888L-888-B096YQGYFP-US',supplierQuantity:49745,title:'Fixture Supplier Product'},lifecycleStage:'HOLD',decision:'HOLD',nextBestEvidence:{action:'REVIEW_AMAZON_COMPETITION',priority:1,reasonCode:'AMAZON_HIGH_OFFER_DEPTH_OWNER_REVIEW_REQUIRED',authority:'AMAZON_PRODUCT_OPPORTUNITY_EXPLORER_OWNER_READONLY',inventedEvidence:false},memoryDigest:`sha256:${'d'.repeat(64)}`})
  const supplier=(await call(supplierMemory)).rows[0].result
  assert.equal(supplier.status,'STORED')
  const supplierRow=(await db.query(`select candidate_key from public.ebay_luna_opportunity_queue where commercial_memory_digest=$1`,[supplierMemory.memoryDigest])).rows[0]
  assert.equal(supplierRow.candidate_key,'888lots:888-B096YQGYFP-US:888-B096YQGYFP-US')
  const permissions=(await db.query(`select has_function_privilege('anon','public.put_seller_os_commercial_opportunity_memory_v1(text,uuid,jsonb,text)','EXECUTE') as anon_execute,has_function_privilege('authenticated','public.put_seller_os_commercial_opportunity_memory_v1(text,uuid,jsonb,text)','EXECUTE') as authenticated_execute,has_function_privilege('service_role','public.put_seller_os_commercial_opportunity_memory_v1(text,uuid,jsonb,text)','EXECUTE') as service_execute`)).rows[0]
  assert.equal(permissions.anon_execute,false);assert.equal(permissions.authenticated_execute,false);assert.equal(permissions.service_execute,true)
  const indexes=(await db.query(`select indexname from pg_indexes where schemaname='public' and indexname like 'ebay_luna_queue_%_idx'`)).rows.map(row=>row.indexname)
  for(const expected of ['ebay_luna_queue_commercial_receipt_idx','ebay_luna_queue_market_family_case_idx','ebay_luna_queue_market_case_idx'])assert.ok(indexes.includes(expected))
 }finally{await db.close()}
})
