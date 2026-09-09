import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

test('fee ledger: package event, atomic authority, immutable history, invalidation and ACL',async()=>{
 const db=new PGlite()
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 alter default privileges grant all on tables to service_role;
 create table public.ebay_listing_packages(id uuid primary key,account_key text,package_data jsonb);
 create table public.ebay_authorized_listing_publications(listing_package_id uuid,marketplace_account_key text,listing_id text,sku text,verified_active_at timestamptz);
 create table public.marketplace_order_snapshots(id uuid);
 grant select,insert,update on public.ebay_listing_packages,public.ebay_authorized_listing_publications to service_role;`)
 await db.exec(readFileSync(new URL('../../supabase/migrations/20260909191023_seller_os_fee_automation_reconciliation_v1.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../supabase/migrations/20260909192829_seller_os_fee_immutable_acl_v1.sql',import.meta.url),'utf8'))
 const pkg='00000000-0000-4000-8000-000000000001',key='TEST:package:'+pkg
 await db.exec('set role service_role')
 await db.query('insert into public.ebay_listing_packages values($1,$2,$3)',[pkg,'TEST',{sku:'TEST_SKU',categoryId:'50692'}])
 const row=(await db.query('select binding_key,updated_at,state from public.seller_os_ebay_fee_bindings_v1 where binding_key=$1',[key])).rows[0]
 assert.equal(row.state,'PENDING_ORDER_CONTEXT')
 const authority={contractVersion:'SELLER_OS_EBAY_FEE_AUTHORITY_V1',authorityId:'TEST_AUTHORITY',inputFingerprint:'TEST_HASH',marketplaceAccountKey:'TEST',packageId:pkg,itemId:null,sku:'TEST_SKU',state:'PENDING_ORDER_CONTEXT',observedAt:'2026-09-09T20:00:00Z',freshUntil:'2026-09-10T00:00:00Z',amount:null}
 const write=await db.query('select public.seller_os_record_fee_authority_v1($1,$2,$3) as ok',[key,row.updated_at,authority]);assert.equal(write.rows[0].ok,true)
 assert.equal((await db.query('select public.seller_os_record_fee_authority_v1($1,$2,$3) as ok',[key,row.updated_at,authority])).rows[0].ok,false)
 await assert.rejects(db.query('update public.seller_os_ebay_fee_authorities_v1 set state=$1',['CONFLICT']),/permission denied/)
 await db.query('update public.ebay_listing_packages set package_data=$1 where id=$2',[{sku:'TEST_SKU',categoryId:'NEW'},pkg])
 assert.equal((await db.query('select state from public.seller_os_ebay_fee_bindings_v1 where binding_key=$1',[key])).rows[0].state,'PENDING_ORDER_CONTEXT')
 await assert.rejects(db.query('truncate public.seller_os_ebay_fee_authorities_v1 cascade'),/permission denied/)
 await db.exec('reset role')
 await assert.rejects(db.query('update public.seller_os_ebay_fee_authorities_v1 set state=$1',['CONFLICT']),/FEE_EVIDENCE_IMMUTABLE/)
 await assert.rejects(db.query('delete from public.seller_os_ebay_fee_authorities_v1'),/FEE_EVIDENCE_IMMUTABLE/)
 await db.exec('set role authenticated')
 await assert.rejects(db.query('select authority_id from public.seller_os_ebay_fee_authorities_v1'),/permission denied/)
 }finally{await db.close()}
})
