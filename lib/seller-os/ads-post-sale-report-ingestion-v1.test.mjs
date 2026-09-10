import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {normalizeOfficialAdsReportV1,ingestOfficialAdsReportV1,adsPostSaleLearningV1} from './ads-post-sale-report-ingestion-v1.ts'
const now=new Date('2026-09-10T00:30:00Z')
const observation=()=>({accountKey:'TEST_ACCOUNT',marketplace:'EBAY_US',itemId:'999999999999',campaignId:'TEST_CAMPAIGN',adId:null,
 reportId:'TEST_REPORT',reportTaskId:'TEST_TASK',reportType:'TEST_LISTING_REPORT',reportRevision:'1',windowStart:'2026-09-01T00:00:00Z',windowEnd:'2026-09-09T00:00:00Z',observedAt:'2026-09-10T00:00:00Z',source:'https://api.ebay.com/sell/marketing/v1/ad_report/TEST_REPORT',sourceSha256:'a'.repeat(64),metadataReference:'TEST_OFFICIAL_METADATA',metadataSha256:'b'.repeat(64),normalizerVersion:'TEST_NORMALIZER',adSpend:{value:3.5,sourceKey:'TEST_SPEND',currency:'USD',availability:'AVAILABLE'},attributedSales:{value:52.99,sourceKey:'TEST_ATTRIBUTED_SALES',currency:'USD',availability:'AVAILABLE'},currency:'USD'})
test('official report contract keeps unknown metrics null and never infers profit or causality',()=>{
 const o=observation(),r=normalizeOfficialAdsReportV1(o,now)
 assert.equal(r.adSpend,3.5);assert.equal(r.attributedSales,52.99);assert.equal(r.profitAfterAds,null);assert.equal(r.causalAttribution,false)
 o.attributedSales={...o.attributedSales,value:null,availability:'UNAVAILABLE'};assert.equal(normalizeOfficialAdsReportV1(o,now).attributedSales,null)
 const learning=adsPostSaleLearningV1({accountKey:o.accountKey,itemId:o.itemId,feeReconciliation:{receiptId:'FEE'},report:r})
 assert.equal(learning.adSpend,3.5);assert.equal(learning.profitAfterAds,null)
 assert.equal(adsPostSaleLearningV1({accountKey:'OTHER',itemId:o.itemId,report:r}).adSpend,null)
})
test('unofficial source, currency, future interval, missing metadata and fake unknown zero fail closed',()=>{
 for(const edit of [o=>o.source='https://api.ebay.com.attacker.test/report',o=>o.source+='?token=SECRET',o=>o.currency='EUR',o=>o.windowEnd='2027-01-01',o=>o.metadataSha256=null,o=>o.adSpend.value=null,o=>o.adSpend.availability='UNAVAILABLE']){
  const o=observation();edit(o);assert.throws(()=>normalizeOfficialAdsReportV1(o,now))
 }
 const o=observation(),r=normalizeOfficialAdsReportV1(o,now);o.observedAt=now.toISOString()
 assert.equal(normalizeOfficialAdsReportV1(o,now).receiptId,r.receiptId)
})
test('durable SQL handoff is idempotent, immutable, scoped, and reads latest evidence per component',async()=>{
 const db=new PGlite()
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 alter default privileges grant all on tables to service_role;
 create table public.seller_os_live_economic_evidence_v1(evidence_id text,marketplace_account_key text,marketplace_id text,ebay_item_id text,evidence_type text,captured_at timestamptz,created_at timestamptz);
 create table public.ebay_active_listings(account_key text,ebay_item_id text);
 create function public.seller_os_fee_immutable_v1() returns trigger language plpgsql as $$begin raise exception 'FEE_EVIDENCE_IMMUTABLE';end$$;`)
 await db.exec(readFileSync(new URL('../../supabase/migrations/20260910000833_ebay_quota_hold_economic_handoff_v1.sql',import.meta.url),'utf8'))
 await db.exec('set role service_role')
 await db.query('insert into public.ebay_active_listings values($1,$2)',['TEST_ACCOUNT','999999999999'])
 const r=normalizeOfficialAdsReportV1(observation(),now)
 const supabase={rpc:async(name,args)=>{const x=await db.query(`select public.${name}($1) as id`,[args.p_receipt]);return {data:x.rows[0].id}}}
 for(let n=0;n<2;n++)assert.equal((await ingestOfficialAdsReportV1({supabase,observation:observation(),now})).receiptId,r.receiptId)
 assert.equal((await db.query('select count(*)::int n from public.seller_os_ads_report_observations_v1')).rows[0].n,1)
 await assert.rejects(db.query('select public.seller_os_record_ads_report_observation_v1($1)',[{...r,receiptId:'c'.repeat(64),adSpend:7}]),/REVISION_CONFLICT/)
 await assert.rejects(db.query('select public.seller_os_record_ads_report_observation_v1($1)',[{...r,accountKey:'OTHER'}]),/EXACT_OFFICIAL_SCOPE/)
 await assert.rejects(db.exec('truncate public.seller_os_ads_report_observations_v1'),/permission denied/)
 await db.exec('reset role')
 await assert.rejects(db.exec('delete from public.seller_os_ads_report_observations_v1'),/IMMUTABLE/)
 await db.exec(`insert into public.seller_os_live_economic_evidence_v1 values('old_cost','TEST_ACCOUNT','EBAY_US','999999999999','LUNA_CURRENT_COST','2026-09-01','2026-09-01');
 insert into public.seller_os_live_economic_evidence_v1 select 'price_'||n,'TEST_ACCOUNT','EBAY_US','999999999999','EBAY_LIVE_PRICE','2026-09-09'::timestamptz+n*interval '1 second','2026-09-09' from generate_series(1,1500) n;`)
 const latest=(await db.query('select * from public.seller_os_latest_economic_evidence_v1($1,$2)',['TEST_ACCOUNT',['999999999999']])).rows
 assert.equal(latest.length,2);assert.ok(latest.some(e=>e.evidence_id==='old_cost'));assert.ok(latest.some(e=>e.evidence_id==='price_1500'))
 await db.exec('set role authenticated')
 await assert.rejects(db.query('select * from public.seller_os_latest_economic_evidence_v1($1,$2)',['TEST_ACCOUNT',['999999999999']]),/permission denied/)
 await assert.rejects(db.exec('select * from public.seller_os_ads_report_observations_v1'),/permission denied/)
 }finally{await db.close()}
})
