import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {projectGoldenCategoryCandidateV1,writeGoldenReceiptV1,GoldenReceiptPersistenceErrorV1} from './commercial-golden-path-runtime-v1.ts'
import {goldenDigest} from './commercial-golden-path-domain-v1.ts'

const evaluation=()=>({candidate:{productId:'1',variantId:'2',supplierSku:'SYNTHETIC-ONLY',supplierQuantity:1},
 decision:'UNPROVEN',reasonCodes:['BUYER_FULFILLMENT_SHIPPING_UNPROVEN'],
 productTruth:{status:'UNPROVEN',verifiedSpecifics:[]},duplicateGate:{status:'UNPROVEN'},
 shipping:{status:'UNPROVEN'},economics:{status:'UNPROVEN',expectedNetProfit:null,realizedNetProfit:null},
 market:{soldQuantity:null,exactSold:[{listingState:'SOLD',classification:'EXACT'}],closeSold:[],familyEvidence:[{classification:'FAMILY'}],rejectedComparables:[],activeCompetition:[{listingState:'ACTIVE'}]},
 compliance:{status:'UNPROVEN',blockers:['IDENTITY_UNPROVEN'],missingRequiredSpecifics:['Brand'],publicationAuthorized:false,
  category:{id:'123',name:'Synthetic',receipt:{taxonomy:'x'.repeat(250000)}},taxonomy:{status:'AVAILABLE',categoryId:'123',aspects:'x'.repeat(250000)}},
 durableReceipt:{receiptId:'10000000-0000-4000-8000-000000000002',readback:'PASS'}})

test('category references evaluation evidence without changing decisions, blockers or SOLD/ACTIVE classifications',()=>{
 const original=evaluation(),before=structuredClone(original),summary=projectGoldenCategoryCandidateV1(original)
 assert.deepEqual(original,before)
 for(const key of ['candidate','decision','reasonCodes','productTruth','duplicateGate','shipping','economics'])assert.deepEqual(summary[key],original[key])
 for(const key of ['status','blockers','missingRequiredSpecifics','publicationAuthorized'])assert.deepEqual(summary.compliance[key],original.compliance[key])
 for(const key of ['exactSold','closeSold','familyEvidence','rejectedComparables','activeCompetition'])assert.deepEqual(summary.market[key],original.market[key])
 assert.equal(summary.compliance.taxonomy.evaluationEvidenceReceiptId,original.durableReceipt.receiptId)
 assert.equal(summary.compliance.taxonomy.evidenceDigest,goldenDigest(original.compliance.taxonomy))
 assert.equal(summary.compliance.category.receipt.evidenceDigest,goldenDigest(original.compliance.category.receipt))
 assert.equal(summary.compliance.category.receipt.path,'compliance.category.receipt')
 assert.equal(summary.economics.expectedNetProfit,null)
})

test('unchanged Production receipt constraint rejects duplicated five-candidate payload and accepts bounded references',async()=>{
 const db=new PGlite()
 try{
  const migration=readFileSync(new URL('../../supabase/migrations/20261003033856_commercial_golden_path_v1.sql',import.meta.url),'utf8')
  await db.exec(migration.split('create table public.seller_os_golden_manual_market_v1')[0])
  const full={candidates:Array.from({length:5},evaluation)}
  const compact={candidates:full.candidates.map(projectGoldenCategoryCandidateV1)}
  const insert=p=>db.query(`insert into public.seller_os_golden_path_receipts_v1 values($1,$2,$3,'OPPORTUNITIES',$4,$5,now())`,['10000000-0000-4000-8000-000000000001','SYNTHETIC-ACCOUNT','10000000-0000-4000-8000-000000000003',goldenDigest(p),JSON.stringify(p)])
  await assert.rejects(insert(full),e=>e.code==='23514'&&e.message.includes('seller_os_golden_path_receipts_v1_payload_check'))
  await insert(compact)
  const row=(await db.query('select payload,octet_length(payload::text) as bytes from public.seller_os_golden_path_receipts_v1')).rows[0]
  assert.deepEqual(row.payload,compact);assert.ok(row.bytes<2000000)
 }finally{await db.close()}
})

const context=supabase=>({supabase,accountKey:'SYNTHETIC-ACCOUNT',principal:{ownerUserId:'synthetic-owner',commandClientId:'synthetic-client'},invocationSource:'SERVICE_CERTIFICATION_DIAGNOSTIC',now:new Date()})
test('writer preserves safe SQL cause and never exposes Postgres failing-row details',async()=>{
 let reads=0
 const ctx=context({from(){return {upsert:async()=>({error:{code:'23514',message:'new row violates check constraint "seller_os_golden_path_receipts_v1_payload_check"',details:'PRIVATE_FAILING_ROW',hint:'PRIVATE_HINT'}}),select(){reads++;throw Error('NO_READ_AFTER_FAILED_WRITE')}}}})
 await assert.rejects(writeGoldenReceiptV1(ctx,'OPPORTUNITIES',{candidates:[]}),e=>{
  assert.ok(e instanceof GoldenReceiptPersistenceErrorV1)
  assert.equal(e.diagnostic.databaseCode,'23514')
  assert.equal(e.diagnostic.constraint,'seller_os_golden_path_receipts_v1_payload_check')
  assert.equal(e.diagnostic.kind,'OPPORTUNITIES')
  assert.equal(JSON.stringify(e.diagnostic).includes('PRIVATE'),false)
  return true
 });assert.equal(reads,0)
})

test('receipt replay uses immutable conflict-ignore and verifies the stored payload digest',async()=>{
 let stored=null,inserts=0,corrupt=false
 const ctx=context({from(){const q={upsert:async(row,options)=>{
  assert.deepEqual(options,{onConflict:'account_key,kind,evidence_digest',ignoreDuplicates:true})
  if(!stored){stored={...structuredClone(row),created_at:'2026-10-03T07:00:00Z'};inserts++}return {error:null}
 },select(){return q},eq(){return q},limit(){return q},maybeSingle:async()=>({data:corrupt?{...stored,payload:{tampered:true}}:stored,error:null})};return q}})
 const first=await writeGoldenReceiptV1(ctx,'OPPORTUNITIES',{candidates:[]})
 const replay=await writeGoldenReceiptV1(ctx,'OPPORTUNITIES',{candidates:[]})
 assert.equal(first.durableReceipt.receiptId,replay.durableReceipt.receiptId)
 assert.equal(first.durableReceipt.readback,'PASS');assert.equal(inserts,1)
 corrupt=true
 await assert.rejects(writeGoldenReceiptV1(ctx,'OPPORTUNITIES',{candidates:[]}),/DURABLE_RECEIPT_READBACK_FAILED/)
})
