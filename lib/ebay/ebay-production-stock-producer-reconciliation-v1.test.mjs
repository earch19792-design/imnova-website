import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {authorizeProductionPopulationV1, runProductionCurrentLivePopulationV1} from './ebay-production-current-live-population-v1.ts'
import {PRODUCTION_STOCK_AUTHORITY_BINDING_V1 as binding} from './ebay-production-stock-authority-binding-v1.ts'
const account=binding.accountKey, item='366643126310', sku='FL-3SISTER-KEYCHAIN'
const product='9220851957984',variant='53002121347296',legacyId='00000000-0000-4000-8000-000000000001'
const run='00000000-0000-4000-8000-000000000002',run2='00000000-0000-4000-8000-000000000003',digest='a'.repeat(64)
const scope='current-live:sha256:'+digest,linkage='luna-linkage-v1:sha256:'+digest
const component='luna-component-identity-v1:sha256:'+createHash('sha256').update(JSON.stringify([product,variant,sku])).digest('hex'),job='luna-stock-check-v1:sha256:'+digest,worker='certified-local-test'
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8')
const schemaMigration=read('supabase/migrations/20260911170910_production_stock_authority_schema_reconciliation_v1.sql')
const migration=read('supabase/migrations/20260911175426_production_current_live_producer_reconciliation_v1.sql')
async function oldDatabase(){
 const db=new PGlite()
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create table public.ebay_active_listings (
  id uuid primary key default gen_random_uuid(), ebay_item_id text not null unique,
  listing_status text not null default 'active', title text not null, ebay_sku text,
  ebay_quantity integer, ebay_price numeric(12,2), currency text not null default 'USD',
  market_radar_product_id uuid, supplier_variant_id text, supplier_sku text,
  last_ebay_sync_at timestamptz, last_radar_review_at timestamptz,
  raw_payload jsonb not null default '{}', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
 alter table public.ebay_active_listings enable row level security;
 create policy legacy_admin_policy on public.ebay_active_listings for all to authenticated using (false);
 grant all on public.ebay_active_listings to anon, authenticated, service_role;
 insert into public.ebay_active_listings(id,ebay_item_id,title,raw_payload)
 values ('${legacyId}','999999999999','Historical unchanged','{"keep":true}');`)
 return db
}

async function migrate(db){await db.exec('begin;'+migration+'commit;')}
async function database(){const db=await oldDatabase();await db.exec('begin;'+schemaMigration+'commit;');
 await db.exec(`create schema auth;create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
 grant usage on schema auth to service_role;select set_config('request.jwt.claim.role','service_role',false);`);await migrate(db);return db}
const query=async(db,sql,params=[]) => (await db.query(sql,params)).rows
async function claim(db,id=run,key=account){return (await query(db,'select * from claim_ebay_active_listing_sync_run($1,$2,180)',[key,id]))[0]}
function evidence(){const observed=new Date().toISOString(),fresh=new Date(Date.now()+1200000).toISOString();
 return [account,run,scope,observed,fresh,JSON.stringify([item]),JSON.stringify([{itemId:item,title:'Test exact source',sku,quantity:1,price:17.77,currency:'USD',variationKey:null,primaryImageUrl:null,observedAt:observed}])]}
const record=(db,e)=>query(db,'select * from record_ebay_current_live_authority_success_v1($1,$2,$3,$4,$5,$6,$7)',e)
async function certifyLive(db){await claim(db);const e=evidence();await record(db,e);await query(db,'select * from finish_ebay_active_listing_sync_run($1,$2,true,null)',[account,run]);return e}
async function certifyLinkage(db){await query(db,`insert into seller_os_luna_linkage_decisions(decision_id,account_key,marketplace_id,decision_version,decision,decision_at,ebay_item_id,ebay_sku,linkage_id,components,evidence_digest,evidence_references)
 values ('fixture',$1,'EBAY_US',1,'APPROVE_EXACT_LINKAGE',clock_timestamp(),$2,$3,$4,$5,$6,$7)`,[account,item,sku,linkage,JSON.stringify([{lunaProductId:product,lunaVariantId:variant,lunaSku:sku,supplierQuantityRequired:1}]),'sha256:'+digest,['test:exact-lineage']])}
async function ensureJob(db){return query(db,`select ensure_seller_os_luna_stock_check_job_v1($1,$2,$3,$4,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',clock_timestamp(),'SELLER_OS_LUNA_STOCK_OBSERVATION_V1')`,[job,linkage,account,item])}
const claimJob=db=>query(db,'select * from claim_seller_os_luna_stock_check_job_v1($1,$2)',[job,worker])
const complete=db=>query(db,'select complete_seller_os_luna_stock_check_job_v1($1,$2,$3)',[job,worker,'luna-stock-package-v1:sha256:'+digest])
const recordObservation=(db,args)=>query(db,'select ensure_seller_os_luna_stock_observation_v1('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args)
function observation(){return ['luna-stock-observation-v1:sha256:'+digest,job,linkage,account,item,component,product,variant,sku,1,'OBSERVED_IN_STOCK','AVAILABLE',true,null,'SUPPLIER_STATED','luna-stock-evidence-v1:sha256:'+digest,'CANONICAL_SERVER_READ',1,new Date().toISOString(),21600,[],worker]}

test('targeted producers install/replay on reconciled old schema, preserving legacy rows, table ACL/RLS and no account backfill',async()=>{
 const db=await oldDatabase();try{await db.exec('begin;'+schemaMigration+'commit;');await db.exec("create schema auth;create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;");
 const acl=()=>query(db,`select relname,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by relname`)
 const before=await acl(),row=(await query(db,'select to_jsonb(r) row from ebay_active_listings r'))[0].row
 await migrate(db);await migrate(db);assert.deepEqual(await acl(),before)
 const after=(await query(db,'select to_jsonb(r) row from ebay_active_listings r'))[0].row
 for(const [k,v] of Object.entries(row))assert.deepEqual(after[k],v);assert.equal(after.account_key,null)
 const dep=(await query(db,'select get_production_stock_producer_readiness_v1() value'))[0].value
 assert.equal(dep.missing[0],'public.resolve_relist_supplier_handoff_v1')
 assert.ok(dep.missing.includes('public.ebay_listing_packages'))
 for(const name of ['claim_ebay_active_listing_sync_run','record_ebay_current_live_authority_success_v1','ensure_seller_os_luna_stock_check_job_v1']){
 const r=await query(db,`select has_function_privilege('service_role',oid,'EXECUTE') allowed,has_function_privilege('authenticated',oid,'EXECUTE') denied from pg_proc where proname=$1`,[name]);assert.equal(r[0].allowed,true);assert.equal(r[0].denied,false)}
 }finally{await db.close()}
})
test('CURRENT LIVE claim is single-leader/account-pinned; receipt requires owned lease and exact cohort; replay is idempotent',async()=>{
 const db=await database();try{
 await assert.rejects(claim(db,run,'wrong:'+'b'.repeat(64)),/CLAIM_INVALID/)
 const e=evidence();await assert.rejects(record(db,e),/LEASE_REQUIRED/)
 assert.equal((await claim(db)).claimed,true);assert.equal((await claim(db,run2)).claimed,false)
 await assert.rejects(record(db,[...e.slice(0,6),'[]']),/COHORT_INVALID/)
 assert.equal((await record(db,e))[0].applied,true);assert.equal((await record(db,e))[0].applied,false)
 const altered=[...e];altered[2]='current-live:sha256:'+'b'.repeat(64)
 await assert.rejects(record(db,altered),/REPLAY_EVIDENCE_CONFLICT/)
 await query(db,'select * from finish_ebay_active_listing_sync_run($1,$2,true,null)',[account,run])
 assert.equal((await claim(db,run2)).claimed,false,'fresh cohort not reclaimed')
 assert.equal((await query(db,'select count(*)::int n from ebay_active_listings where account_key=$1',[account]))[0].n,1)
 assert.equal((await query(db,'select listing_status from ebay_active_listings where ebay_item_id=$1',[item]))[0].listing_status,'active')
 }finally{await db.close()}
})
test('bounded source failure preserves last known LIVE and enforces retry window, never invents OUT_OF_STOCK',async()=>{
 const db=await database();try{await certifyLive(db)
 await query(db,"update ebay_active_listing_sync_state set last_certified_live_observed_at=clock_timestamp()-interval '30 minutes',last_certified_live_fresh_until=clock_timestamp()-interval '1 second' where account_key=$1",[account])
 await claim(db,run2)
 await query(db,"select * from record_ebay_current_live_authority_failure_v1($1,$2,'OFFICIAL_SOURCE_UNAVAILABLE',clock_timestamp()+interval '15 minutes')",[account,run2])
 await query(db,"select * from finish_ebay_active_listing_sync_run($1,$2,false,'OFFICIAL_SOURCE_UNAVAILABLE')",[account,run2])
 assert.equal((await claim(db)).claimed,false)
 assert.equal((await query(db,'select listing_status from ebay_active_listings where ebay_item_id=$1',[item]))[0].listing_status,'active')
 assert.equal((await query(db,'select count(*)::int n from seller_os_luna_stock_observations'))[0].n,0)
 }finally{await db.close()}
})
test('normal stock producer requires CURRENT then exact linkage; immutable availability-only receipt/readback/replay; no numeric supplier invention',async()=>{
 const db=await database();try{
 await assert.rejects(ensureJob(db),/CERTIFIED_LINKAGE_REQUIRED/);await certifyLive(db)
 await assert.rejects(ensureJob(db),/CERTIFIED_LINKAGE_REQUIRED/);await certifyLinkage(db);await ensureJob(db)
 assert.equal((await claimJob(db))[0].claimed,true);assert.equal((await claimJob(db))[0].claimed,false)
 await assert.rejects(complete(db),/OBSERVATION_RECEIPT_REQUIRED/)
 const o=observation(),wrong=[...o];wrong[6]='wrong-product'
 await assert.rejects(recordObservation(db,wrong),/EXACT_LINKAGE_REQUIRED/)
 const crossed=[...o];crossed[3]='wrong:'+'b'.repeat(64)
 await assert.rejects(recordObservation(db,crossed),/LEASE_OR_IDENTITY_INVALID/)
 await recordObservation(db,o);await recordObservation(db,o)
 const row=(await query(db,'select observed_availability,observed_supplier_quantity from seller_os_luna_stock_observations'))[0]
 assert.deepEqual(row,{observed_availability:true,observed_supplier_quantity:null})
 await complete(db);await complete(db);assert.equal((await claimJob(db))[0].reason,'SUCCESS_RECEIPT_PRESENT')
 assert.equal((await query(db,'select count(*)::int n from seller_os_luna_stock_observations'))[0].n,1)
 await assert.rejects(db.exec("update seller_os_luna_stock_observations set observed_availability=false"),/IMMUTABLE/)
 }finally{await db.close()}
})
test('unknown/unavailable stock remains unknown, cannot complete a partial component set',async()=>{
 const db=await database();try{await certifyLive(db);await certifyLinkage(db);await ensureJob(db);await claimJob(db)
 const o=observation();o[10]='UNKNOWN';o[11]='UNAVAILABLE';o[12]=null;o[14]='UNAVAILABLE'
 await recordObservation(db,o)
 assert.deepEqual((await query(db,'select observed_availability,observed_supplier_quantity from seller_os_luna_stock_observations'))[0],{observed_availability:null,observed_supplier_quantity:null})
 await query(db,"update seller_os_luna_linkage_decisions set components=components||$1::jsonb",[JSON.stringify([{componentIdentityId:'luna-component-identity-v1:sha256:'+'b'.repeat(64),lunaProductId:'other',lunaVariantId:null,lunaSku:'other',supplierQuantityRequired:1}])])
 await assert.rejects(complete(db),/OBSERVATION_RECEIPT_REQUIRED/)
 }finally{await db.close()}
})
const url='https://'+binding.hostname+'/api/cron/ebay-active-listing-luna-monitor'
const headers={'x-seller-os-caller':'SELLER_OS_STOCKGUARD_MONITOR_V1','x-seller-os-service-assertion':'test-assertion'}
test('producer uses existing intake with production service identity, fixed account/target and zero caller-supplied input',async()=>{
 const verify=async s=>s==='test-assertion'
 assert.equal(await authorizeProductionPopulationV1(new Request(url,{method:'POST',headers}),verify),true)
 for(const [u,method,h,body] of [[url,'GET',headers],[url+'?account=wrong','POST',headers],[url,'POST',{...headers,authorization:'Bearer arbitrary'}],[url,'POST',{...headers,'x-seller-os-caller':'wrong'}],[url.replace('https:','http:'),'POST',headers],[url.replace(binding.hostname,'preprod.example'),'POST',headers],[url,'POST',headers,'{"token":"arbitrary"}']])
 assert.equal(await authorizeProductionPopulationV1(new Request(u,{method,headers:h,body}),verify),false)
 assert.equal(await authorizeProductionPopulationV1(new Request(url,{method:'POST',headers}),async()=>false),false)
})
test('unconfigured official source does not claim, mutate, consult marketplace or invoke StockGuard; exact missing dependency reported',async()=>{
 const result=await runProductionCurrentLivePopulationV1({supabase:new Proxy({},{get(){throw Error('DB must not be touched')}}),environment:{NEXT_PUBLIC_SUPABASE_URL:binding.databaseUrl}})
 assert.equal(result.status,'BLOCKED_SOURCE_DEPENDENCY');assert.equal(result.missingDependency,'OFFICIAL_EBAY_CURRENT_LIVE_READ:EBAY_CLIENT_ID')
 assert.equal(result.currentLiveAuthorityPopulated,false);assert.equal(result.safety.marketplaceWrites,0);assert.equal(result.safety.stockGuardEvaluations,0)
 assert.doesNotMatch(JSON.stringify(result),/Bearer|access_token|refresh_token|client_secret/)
})
test('fresh CURRENT without real linkage dependencies stops before stock and reports first exact absent RPC',async()=>{
 const r=await runProductionCurrentLivePopulationV1({environment:{NEXT_PUBLIC_SUPABASE_URL:binding.databaseUrl},
 configuration:()=>({configured:true,identityConsistent:true,accountAlias:binding.accountAlias}),
 recover:async()=>({authority:{currentState:'CURRENT_FRESH',currentItemIds:[item]}}),
 supabase:{rpc:async name=>{assert.equal(name,'get_production_stock_producer_readiness_v1');return {data:{missing:['public.resolve_relist_supplier_handoff_v1']},error:null}}}})
 assert.equal(r.missingDependency,'public.resolve_relist_supplier_handoff_v1');assert.equal(r.safety.stockGuardEvaluations,0)
})
test('targeted set has no seed, historical replay, destructive DDL, table grants or scheduler; production branch precedes legacy marketplace writers',()=>{
 assert.doesNotMatch(migration,/\bdrop\s+(table|column)|\btruncate\b|supabase_migrations|cron\.schedule|grant .*on table/i)
 assert.doesNotMatch(migration,/insert into public\.(ebay_listing_packages|seller_os_luna_linkage_decisions)/i)
 const route=read('app/api/cron/ebay-active-listing-luna-monitor/route.ts')
 assert.ok(route.indexOf('runProductionCurrentLivePopulationV1({')<route.indexOf('if (!commercialPreviewCronAuthorized(req))'))
 assert.match(route,/return NextResponse.json\(await runProductionCurrentLivePopulationV1/)
})
