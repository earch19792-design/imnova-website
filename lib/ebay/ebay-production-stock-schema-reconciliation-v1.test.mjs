import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { readProductionStockGuardV1 } from './ebay-production-stock-read-service-v1.ts'

const migration=readFileSync(new URL('../../supabase/migrations/20260911170910_production_stock_authority_schema_reconciliation_v1.sql',import.meta.url),'utf8')
const attestation=JSON.parse(readFileSync(new URL('../../docs/production-stock-schema-attestation-v1.json',import.meta.url),'utf8'))
const tables=attestation.REQUIRED_STOCK_AUTHORITY_TABLES
const account='imnova-ebay-us-primary:'+'a'.repeat(64),other='other:'+'b'.repeat(64)
const item='366643126310',sku='FL-3SISTER-KEYCHAIN',product='9220851957984',variant='53002121347296'
const legacyId='00000000-0000-4000-8000-000000000001'
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
async function schema(db){return (await db.query(`select table_name,column_name,data_type,is_nullable,column_default
 from information_schema.columns where table_schema='public' order by table_name,ordinal_position`)).rows}
async function security(db){return (await db.query(`select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,
 (select jsonb_agg(to_jsonb(p)) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) policies
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname`)).rows}

// Execute the actual five repository queries against PostgreSQL, including
// projection columns, ordering and account predicates (not a permissive mock).
function reader(db){return {from(table){assert.ok(tables.includes(table));let columns,filters=[],values=[],order='',limit=1,single=false
 const ident=x=>{assert.match(x,/^[a-z_]+$/);return '"'+x+'"'}
 const q={select(c){columns=c.split(',').map(ident).join(',');return q},
 eq(c,v){values.push(v);filters.push(ident(c)+'=$'+values.length);return q},
 in(c,vs){const binds=vs.map(v=>{values.push(v);return '$'+values.length});filters.push(ident(c)+' in ('+binds.join(',')+')');return q},
 order(c,o){order=' order by '+ident(c)+(o.ascending?' asc':' desc');return q},limit(n){limit=n;return q},
 maybeSingle(){single=true;return q},then(yes,no){return db.query('select '+columns+' from '+ident(table)+' where '+filters.join(' and ')+order+' limit '+limit,values)
 .then(r=>({data:JSON.parse(JSON.stringify(single?r.rows[0]??null:r.rows)),error:null})).then(yes,no)}};return q}}}

test('old production schema gains every exact reader column without rewriting existing rows or account attribution',async()=>{
 const db=await oldDatabase();try{
 const before=(await db.query('select to_jsonb(r) row from ebay_active_listings r')).rows[0].row
 const acl=(await security(db))[0]
 await migrate(db)
 const columns=await schema(db)
 for(const [table,required] of Object.entries(attestation.REQUIRED_STOCK_AUTHORITY_COLUMNS)){
  assert.ok(required.every(column=>columns.some(c=>c.table_name===table&&c.column_name===column)),table)
 }
 const after=(await db.query('select to_jsonb(r) row from ebay_active_listings r')).rows[0].row
 for(const [key,value] of Object.entries(before))assert.deepEqual(after[key],value)
 assert.equal(after.account_key,null);assert.equal(after.sync_generation,null)
 const column=columns.find(c=>c.table_name==='ebay_active_listings'&&c.column_name==='account_key')
 assert.equal(column.is_nullable,'YES');assert.equal(column.column_default,null)
 assert.deepEqual((await security(db)).find(r=>r.relname==='ebay_active_listings'),acl)
 }finally{await db.close()}
})

test('reconciliation replay preserves schema, ACLs, authority rows and optional canonical extensions',async()=>{
 const db=await oldDatabase();try{await migrate(db)
 await db.query('insert into ebay_active_listing_sync_state(account_key) values ($1)',[account])
 await db.exec('alter table ebay_active_listing_sync_state add column canonical_extension text;')
 const beforeSchema=await schema(db),beforeSecurity=await security(db)
 const beforeRows=(await db.query('select * from ebay_active_listing_sync_state')).rows
 await migrate(db)
 assert.deepEqual(await schema(db),beforeSchema);assert.deepEqual(await security(db),beforeSecurity)
 assert.deepEqual((await db.query('select * from ebay_active_listing_sync_state')).rows,beforeRows)
 }finally{await db.close()}
})

test('new authorities expose service SELECT only, no public reads/writes, no implicit account',async()=>{
 const db=await oldDatabase();try{await migrate(db)
 for(const table of tables.slice(1)){
  const row=(await db.query('select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass',[table])).rows[0]
  assert.equal(row.relrowsecurity,true);assert.equal(row.relforcerowsecurity,true)
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']){
   const allowed=(await db.query('select has_table_privilege($1,$2,$3) allowed',[role,table,privilege])).rows[0].allowed
   assert.equal(allowed,role==='service_role'&&privilege==='SELECT',`${table} ${role} ${privilege}`)
  }
 }
 await assert.rejects(db.exec('insert into ebay_active_listing_sync_state default values'))
 await assert.rejects(db.exec("insert into ebay_active_listing_sync_state(account_key) values ('default')"))
 await assert.rejects(db.query("insert into ebay_active_listing_sync_state(account_key,current_live_source_state) values ($1,'CURRENT_FRESH')",[account]))
 }finally{await db.close()}
})

test('production reader runs on reconciled schema; no rows cannot certify LIVE, stock or relist',async()=>{
 const db=await oldDatabase();try{await migrate(db)
 await db.exec('set role service_role')
 const r=await readProductionStockGuardV1({supabase:reader(db),accountKey:account,accountAlias:'imnova-ebay-us-primary',itemId:item})
 assert.deepEqual(r.listings,[]);assert.equal(r.cohortComplete,false)
 assert.ok(Object.values(r.sourceStatus).every(s=>s==='AVAILABLE'))
 }finally{await db.close()}
})

test('real PostgreSQL authority rows produce stock read; wrong account and unbound legacy row never leak',async()=>{
 const db=await oldDatabase();try{await migrate(db)
 const now=new Date('2026-09-11T17:30:00Z'),digest='a'.repeat(64)
 const linkage='luna-linkage-v1:sha256:'+digest,job='luna-stock-check-v1:sha256:'+digest
 const {createHash}=await import('node:crypto')
 const component='luna-component-identity-v1:sha256:'+createHash('sha256').update(JSON.stringify([product,variant,sku])).digest('hex')
 await db.query(`insert into ebay_active_listings(account_key,ebay_item_id,ebay_sku,title) values ($1,$2,$3,'Fixture')`,[account,item,sku])
 await db.query(`insert into ebay_active_listing_sync_state(account_key,current_live_source_state,last_certified_live_scope_id,
 last_certified_live_item_ids,last_certified_live_count,last_certified_live_observed_at,last_certified_live_fresh_until,last_certified_live_source_authority)
 values ($1,'CURRENT_FRESH',$2,$3,1,$4,$5,'EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION')`,
 [account,'current-live:sha256:'+digest,JSON.stringify([item]),now,'2026-09-11T18:00:00Z'])
 await db.query(`insert into seller_os_luna_linkage_decisions values ($1,$2,'EBAY_US',1,'APPROVE_EXACT_LINKAGE',$3,$4,$5,$6,$7,$8,$9)`,
 ['decision',account,now,item,sku,linkage,JSON.stringify([{componentIdentityId:component,lunaProductId:product,lunaVariantId:variant,lunaSku:sku,
 supplierQuantityRequired:1,exactProductIdentity:true,exactVariantIdentity:true,exactSupplierSku:true,structuredVariantAttributesComplete:true}]),'sha256:'+digest,['fixture:identity']])
 await db.query(`insert into seller_os_luna_stock_check_jobs values ($1,$2,$3,$4,$5,$6,'SUCCEEDED',1,$7)`,
 [job,account,linkage,item,'2026-09-11T17:20:00Z',now,'luna-stock-package-v1:sha256:'+digest])
 const obs=['luna-stock-observation-v1:sha256:'+digest,job,linkage,account,item,component,product,variant,sku,1,
 'OBSERVED_IN_STOCK','AVAILABLE',true,null,'SUPPLIER_STATED','luna-stock-evidence-v1:sha256:'+digest,
 'CANONICAL_SERVER_READ',1,now,21600,['LUNA_PORTEX_PUBLIC_EXACT_PRODUCT_STOCK','PUBLIC_EXACT_IDENTITY_MATCHED']]
 const sql='insert into seller_os_luna_stock_observations values ('+obs.map((_,i)=>'$'+(i+1)).join(',')+')'
 const crossed=[...obs];crossed[3]=other;await assert.rejects(db.query(sql,crossed),/foreign key/)
 await db.query(sql,obs)
 await db.exec('set role service_role')
 const run=accountKey=>readProductionStockGuardV1({supabase:reader(db),accountKey,accountAlias:'imnova-ebay-us-primary',itemId:item,now})
 const result=await run(account)
 assert.equal(result.listings[0].supplierLinkage,'CERTIFIED');assert.equal(result.listings[0].stockGuardState,'IN_STOCK_SIGNAL')
 assert.equal(result.listings[0].stockFreshness,'FRESH');assert.equal(result.cohortComplete,true)
 assert.deepEqual((await run(other)).listings,[])
 assert.deepEqual(await run(account),result)
 }finally{await db.close()}
})

test('migration introduces no destructive DDL, DML backfill, RPC, writer or ledger rewrite',()=>{
 const executable=migration.replace(/--[^\n]*/g,'')
 assert.doesNotMatch(executable,/\bdrop\b|\btruncate\b|\bdelete\s+from\b|\binsert\s+into\b|\bupdate\s+public\.|security\s+definer|create\s+(?:or\s+replace\s+)?function|supabase_migrations/i)
 assert.doesNotMatch(executable,/account_key\s+text[^,\n]*default/i)
})

test('unexpected partially present authority fails atomically instead of reporting reconciliation success',async()=>{
 const db=await oldDatabase();try{
 await db.exec('create table seller_os_luna_linkage_decisions(decision_id text primary key)')
 await assert.rejects(migrate(db),/column.*does not exist/)
 await db.exec('rollback')
 assert.equal((await schema(db)).some(c=>c.table_name==='ebay_active_listings'&&c.column_name==='account_key'),false)
 assert.equal((await db.query('select count(*)::integer count from ebay_active_listings')).rows[0].count,1)
 }finally{await db.close()}
})
