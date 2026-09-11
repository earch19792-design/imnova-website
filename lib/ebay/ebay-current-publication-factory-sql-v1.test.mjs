import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const migration=readFileSync(new URL('../../supabase/migrations/20260911200135_current_publication_factory_isolation.sql',import.meta.url),'utf8')
const core=migration.slice(0,migration.indexOf('-- A new, unpublished preparation'))
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
test('CURRENT factory SQL: old schema, clean reentry, greenfield, replay and collision boundaries',async t=>{
 const db=new PGlite()
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create function is_seller_os_service_role_request_v1() returns boolean language sql as $$select current_setting('test.service',true)='yes'$$;
 set test.service='yes';
 create table ebay_luna_opportunity_queue(id uuid primary key,candidate_key text,supplier_product_id text,supplier_variant_id text,supplier_sku text);
 create table ebay_listing_packages(id uuid primary key,account_key text,opportunity_id uuid unique,candidate_key text,status text,package_data jsonb,readiness numeric,created_by uuid);
 create table ebay_authorized_listing_publications(id uuid primary key,listing_package_id uuid,marketplace_account_key text,opportunity_id uuid,sanitized_result jsonb);
 create table ebay_account_policy_profiles(account_key text,marketplace_id text);
 create table market_radar_latest_variants(source_key text,supplier_product_id text,supplier_variant_id text,sku text);
 create table ebay_active_listings(account_key text,listing_status text,supplier_variant_id text,supplier_sku text,ebay_sku text);
 insert into ebay_account_policy_profiles values('account','EBAY_US');
 insert into ebay_luna_opportunity_queue values('${uuid(1)}','same','p1','v1','sku1'),('${uuid(2)}','new','p2','v2','sku2');
 insert into market_radar_latest_variants values('lunaportex','p1','v1','sku1'),('lunaportex','p2','v2','sku2');
 insert into ebay_listing_packages values('7c812255-f36e-4369-9ca5-55181e87f916','account','${uuid(1)}','same','ready_for_review',
 '{"keyword":{"status":"ACCEPTED"},"shipping":{"amount":6.99,"freshUntil":"2026-09-01"},"preview":{"aligned":true},"fees":{"ready":true},"approval":"old","execution":"old","blockers":["23 dependent blockers"]}',100,null);`)
 const history=await db.query('select * from ebay_listing_packages')
 await db.exec(core);await db.exec(core)
 const run=async(n,key,account='account')=>(await db.query('select begin_current_publication_package_v1($1,$2,$3) as r',[account,uuid(n),key])).rows[0].r
 await t.test('same link creates a new CURRENT package without legacy authorities',async()=>{
 const r=await run(1,'same');assert.equal(r.status,'CURRENT_CREATED');assert.notEqual(r.package.id,history.rows[0].id)
 assert.deepEqual(Object.keys(r.package.package_data),['currentPublicationFactoryV1'])
 assert.equal(r.package.readiness,0);assert.equal(r.package.status,'draft')
 const marker=r.package.package_data.currentPublicationFactoryV1
 assert.equal(marker.reuseLegacyPreparation,false);assert.equal(marker.authorityPolicy,'CURRENT_ONLY')
 assert.equal(marker.historicalReferences[0].packageId,history.rows[0].id)
 assert.deepEqual((await db.query('select * from ebay_listing_packages where id=$1',[history.rows[0].id])).rows,history.rows)
 const replay=await run(1,'same');assert.equal(replay.package.id,r.package.id);assert.equal(replay.packageCreated,false)
 assert.equal((await db.query('select * from ebay_current_listing_packages_v1')).rows.length,1)
 })
 await t.test('greenfield is clean, and two admissions replay one identity slot',async()=>{
 const first=await run(2,'new'),second=await run(2,'new')
 assert.equal(first.package.id,second.package.id);assert.deepEqual(first.package.package_data.currentPublicationFactoryV1.historicalReferences,[])
 assert.equal((await db.query('select * from ebay_listing_packages')).rows.length,3)
 })
 await t.test('LIVE duplicate is recognized across all history without modifying the listing',async()=>{
 await db.exec("insert into ebay_active_listings values('account','active','v1','sku1','IMNOVA')")
 const before=(await db.query('select * from ebay_active_listings')).rows
 assert.equal((await run(1,'same')).reason,'EXACT_PRODUCT_ALREADY_LIVE')
 assert.deepEqual((await db.query('select * from ebay_active_listings')).rows,before)
 })
 await t.test('wrong identity/account/candidate cannot be rebound',async()=>{
 await assert.rejects(run(1,'other'),/EXACT_IDENTITY_REQUIRED/)
 await assert.rejects(run(2,'new','other'),/ACCOUNT_AUTHORITY_REQUIRED/)
 await db.exec("insert into market_radar_latest_variants values('lunaportex','p-other','v-other','sku2')")
 await assert.rejects(run(2,'new'),/CANONICAL_IDENTITY_AMBIGUOUS/)
 })
 await t.test('existing historical publication/Offer blocks duplication instead of copying approval',async()=>{
 await db.exec(`insert into ebay_luna_opportunity_queue values('${uuid(3)}','offer','p3','v3','sku3');
 insert into market_radar_latest_variants values('lunaportex','p3','v3','sku3');
 insert into ebay_authorized_listing_publications values('${uuid(9)}',null,'account','${uuid(3)}','{"offerId":"existing"}');`)
 assert.equal((await run(3,'offer')).reason,'EXISTING_PUBLICATION_IDENTITY_RECONCILIATION_REQUIRED')
 assert.equal((await db.query("select * from ebay_listing_packages where candidate_key='offer'")).rows.length,0)
 assert.equal((await db.query('select * from ebay_authorized_listing_publications')).rows.length,1)
 })
 await t.test('missing service authority fails closed',async()=>{
 await db.exec("set test.service='no'");await assert.rejects(run(2,'new'),/CURRENT_FACTORY_SCOPE_REQUIRED/)
 })
 }finally{await db.close()}
})
