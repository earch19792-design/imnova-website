import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { NextResponse } from 'next/server.js'
import * as transport from './ebay-listing-quality-upload-transport-v1.ts'

const file={name:'eBay.xlsx',type:'application/octet-stream',size:128}
const base={file,read:async()=> 'UEs=',ownerToken:async()=> 'mock-owner-token'}
test('browser rejects oversize, unsupported and empty files before auth or request',async()=>{
 for(const [candidate,code] of [[{...file,size:3_000_001},'FILE_TOO_LARGE'],[{...file,name:'report.xls'},'UNSUPPORTED_FILE_TYPE'],[{...file,size:0},'INPUT_INVALID']]) {
  await assert.rejects(transport.submitQualityUploadV1({...base,file:candidate,ownerToken:async()=>assert.fail('auth not reached'),request:async()=>assert.fail('request not reached')}),e=>e.trace.ERROR_CODE===`QUALITY_REPORT_${code}`&&e.trace.FAILURE_STAGE==='BROWSER_VALIDATION'&&!e.trace.stages.ROUTE.REACHED)
 }
})
test('absent owner session is pre-ingestion, never parser validation',async()=>{
 await assert.rejects(transport.submitQualityUploadV1({...base,ownerToken:async()=>null,request:async()=>assert.fail('no upload')}),e=>e.trace.ERROR_CODE==='QUALITY_REPORT_OWNER_AUTH_REQUIRED'&&e.trace.FAILURE_STAGE==='AUTH'&&!e.trace.stages.WORKBOOK_PARSER.REACHED)
})
test('JSON base64 contract tolerates empty MIME and keeps server trace and exact rejection',async()=>{
 for(const mime of ['', 'application/octet-stream','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) {
  await assert.rejects(transport.submitQualityUploadV1({...base,file:{...file,type:mime},request:async(url,init)=>{
   assert.equal(url,transport.QUALITY_UPLOAD_ENDPOINT);assert.equal(init.headers['Content-Type'],'application/json')
   assert.deepEqual(JSON.parse(init.body),{format:'XLSX',fileName:file.name,mimeType:mime,content:'UEs='})
   const trace=transport.createQualityUploadTraceV1(init.headers['x-seller-os-trace-id'])
   trace.stages.ROUTE.REACHED=true;trace.FAILURE_STAGE='ROUTE'
   return Response.json({success:false,error:'QUALITY_REPORT_DEDICATED_PREPROD_ONLY',uploadTrace:trace},{status:403})
  }}),e=>e.trace.HTTP_STATUS===403&&e.trace.ERROR_CODE==='QUALITY_REPORT_DEDICATED_PREPROD_ONLY'&&e.trace.stages.ROUTE.REACHED&&!e.trace.stages.UPLOAD_ATTEMPT_LEDGER.REACHED&&e.message.includes('preprod'))
 }
})
test('non-JSON platform 413 and network errors stay transport failures',async()=>{
 for(const [request,code] of [[async()=>new Response('too big',{status:413}),'QUALITY_REPORT_HTTP_413'],[async()=>{throw Error('raw private endpoint')},'QUALITY_REPORT_NETWORK_FAILED']]) {
  await assert.rejects(transport.submitQualityUploadV1({...base,request}),e=>e.trace.ERROR_CODE===code&&e.trace.FAILURE_STAGE==='FILE_TRANSPORT'&&!e.message.includes('raw private'))
 }
})

function route(options={}) {
 const calls=[]
 const dependencies={
  'next/server':{NextResponse},
  '@/lib/ebay/ebay-listing-quality-upload-transport-v1':transport,
  '@/lib/admin-session-origin-v1':{isSameSellerOsAdminOriginV1:()=>true},
  '@/lib/ebay/environment-boundaries':{getEbayProRuntimeBoundary:()=>({runtime:options.production?'production_core':'seller_os_dedicated_preprod'})},
  '@/lib/supabase-admin':{getSupabaseAdminClient:()=>({}),validateAdminApiRequest:async()=>({ok:!options.unauthorized,authenticationMode:options.service?'service_role':'admin_user',userId:'mock-owner'})},
  '@/lib/ebay/ebay-seller-account-scope':{getEbaySellerAccountScopeConfiguration:()=>({accountKey:'mock',accountAlias:'mock'})},
  '@/lib/ebay/ebay-seller-os-assistant-runtime':{loadSellerOsAssistantMonitorSnapshotV1:async()=>({})},
  '@/lib/ebay/ebay-seller-os-live-portfolio-integrity-v1':{resolveCrossModuleLivePortfolioIntegrityV1:()=>({canonicalCohort:{}}),currentLiveListingsForMonitorV1:()=>[]},
  '@/lib/ebay/ebay-listing-quality-report-import-v1':{parseEbayListingQualityReportV1:()=>{calls.push('parser');if(options.parserFail)throw Error('QUALITY_REPORT_NO_VALID_SHEET');return {}}},
  '@/lib/ebay/ebay-listing-quality-report-owner-import-v1':{
   OWNER_QUALITY_REPORT_SAFETY_V1:{marketplaceWrites:0},readExactProductTruthForLiveListingsV1:async()=>({}),
   prepareOwnerListingQualityReportImportV1:()=>({guards:{}}),
   prepareSuccessfulOwnerQualityReportUploadAttemptV1:x=>x,prepareFailedOwnerQualityReportUploadAttemptV1:x=>x,
   persistOwnerListingQualityReportV1:async()=>{calls.push('import');return{importId:'valid-id',idempotent:false}},
   persistOwnerQualityReportUploadAttemptV1:async()=>{calls.push('ledger');if(options.ledgerFail)throw Error('QUALITY_REPORT_ATTEMPT_AUDIT_FAILED');return{attemptId:'attempt-id'}},
   readOwnerListingQualityReportStatusV1:async()=>({state:'STALE',reportFreshness:'STALE'}),
   readOwnerQualityReportLatestUploadAttemptV1:async()=>({id:'attempt-id',status:'IMPORTED'})
  }
 }
 const exports={}
 const source=fs.readFileSync('app/api/admin/ebay/listing-quality-report/route.ts','utf8')
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,require:name=>{assert.ok(dependencies[name],name);return dependencies[name]},process:{env:{}},URL,Date,Promise,Error})
 return {post:exports.POST,calls}
}
const traceId='550e8400-e29b-41d4-a716-446655440000'
function request(body={format:'XLSX',fileName:'eBay.xlsx',content:'UEs='},type='application/json') {
 return new Request('https://imnova-seller-os-preprod.vercel.app/api/admin/ebay/listing-quality-report',{method:'POST',headers:{'Content-Type':type,'x-seller-os-trace-id':traceId},body:JSON.stringify(body)})
}
test('route rejects production and non-owner without parser or audit writes, with correlation',async()=>{
 for(const options of [{production:true},{unauthorized:true},{service:true}]) {
  const r=route(options),response=await r.post(request()),p=await response.json()
  assert.equal(response.status,403);assert.equal(p.TRACE_ID,traceId);assert.equal(p.failureClass,'PRE_INGESTION_UPLOAD_FAILURE');assert.deepEqual(r.calls,[])
 }
})
test('multipart or malformed body is diagnosed before parser and audit',async()=>{
 for(const [body,type,status] of [[{},'multipart/form-data; boundary=mock',415],[{},'application/json',400]]) {
  const r=route(),response=await r.post(request(body,type)),p=await response.json()
  assert.equal(response.status,status);assert.equal(p.FAILURE_STAGE,'FILE_TRANSPORT');assert.equal(p.uploadTrace.stages.UPLOAD_ATTEMPT_LEDGER.REACHED,false);assert.deepEqual(r.calls,[])
 }
})
test('parser failure creates terminal audit and preserves parser code',async()=>{
 const r=route({parserFail:true}),response=await r.post(request()),p=await response.json()
 assert.equal(response.status,422);assert.equal(p.ERROR_CODE,'QUALITY_REPORT_NO_VALID_SHEET');assert.equal(p.FAILURE_STAGE,'WORKBOOK_PARSER');assert.equal(p.uploadTrace.stages.UPLOAD_ATTEMPT_LEDGER.REACHED,true);assert.deepEqual(r.calls,['parser','ledger'])
})
test('successful import reports exact attempt ID and truthful stages; ledger failure is not generic 500',async()=>{
 const r=route(),response=await r.post(request()),p=await response.json()
 assert.equal(response.status,200);assert.equal(p.uploadAttemptId,'attempt-id');assert.equal(p.importId,'valid-id');assert.deepEqual(r.calls,['parser','import','ledger'])
 for(const stage of ['ROUTE','AUTH','FILE_TRANSPORT','WORKBOOK_PARSER','IMPORT_VALIDATION','IMPORTS','SIGNALS','UPLOAD_ATTEMPT_LEDGER'])assert.equal(p.uploadTrace.stages[stage].REACHED,true)
 assert.equal(p.uploadTrace.stages.ASSISTANT_QUALITY_CONTEXT.REACHED,false)
 const failure=await route({ledgerFail:true}).post(request()),bad=await failure.json()
 assert.equal(failure.status,503);assert.equal(bad.ERROR_CODE,'QUALITY_REPORT_ATTEMPT_AUDIT_FAILED');assert.equal(bad.FAILURE_STAGE,'UPLOAD_ATTEMPT_LEDGER');assert.equal(bad.TRACE_ID,traceId)
})
