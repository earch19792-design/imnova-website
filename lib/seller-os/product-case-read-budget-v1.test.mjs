import assert from 'node:assert/strict'
import test from 'node:test'
import {readSellerOsProductCaseAuditV1} from './audit-observability-gateway-v1.ts'
import {LUNA_FIELD_TRUTH_FIELDS_V1} from './luna-field-truth-projection-v1.ts'
import {createProductCaseReadBudgetV1, PRODUCT_CASE_INTERNAL_BUDGET_MS} from './product-case-read-budget-v1.ts'
import {handleSellerOsCloudReadRelayRequestV1,signSellerOsCloudReadRelayRequestV1,
  SELLER_OS_CLOUD_READ_RELAY_VERSION,SELLER_OS_CLOUD_READ_RELAY_PATH} from '../ebay/ebay-seller-os-cloud-read-relay-v1.ts'

const NOW=new Date('2026-09-01T12:00:00Z')
const fields=LUNA_FIELD_TRUTH_FIELDS_V1.map((FIELD,i)=>({FIELD,
  VALUE:i===0?null:i===9?['small','large']:`source-${FIELD}`,
  SEMANTIC_CLASS:i===0?'MISSING':i===14?'SUPPLIER_CLAIM':'FACT',
  EVIDENCE_STATUS:i===0?'MISSING':i===14?'UNPROVEN':'PROVEN',
  SOURCE_AUTHORITY:'CANONICAL_LUNA_SOURCE',EVIDENCE_ID:`source-receipt-${i}`,
  CAPTURED_AT:NOW.toISOString(),OBSERVED_AT:NOW.toISOString(),FRESH_UNTIL:null,
  CONTRADICTION:false,SOURCE_EVIDENCE:[{RAW_VALUE:`source-${FIELD}`}],
  REASONING_BASIS:'Existing captured supplier evidence'}))
const sourceColumns=entries=>entries.filter(x=>LUNA_FIELD_TRUTH_FIELDS_V1.includes(x.FIELD))
  .map(x=>Object.fromEntries(Object.keys(fields[0]).map(k=>[k,x[k]])))

function fixture(behavior={}) {
  const calls=[],aborted=[]
  const tables={
    ebay_luna_opportunity_queue:[{id:'queue-receipt',candidate_key:'canonical-candidate',
      supplier_product_id:'123',supplier_variant_id:'456',supplier_sku:'SYNTHETIC',
      updated_at:NOW.toISOString(),assessment:{productTruth:{fieldTruthV1:{
        contractVersion:'LUNA_FIELD_PRODUCT_TRUTH_V1',fields:behavior.__contradicted
          ? fields.map((f,i)=>i===3?{...f,SEMANTIC_CLASS:'CONTRADICTED',
            EVIDENCE_STATUS:'CONTRADICTED',CONTRADICTION:true}:f):fields}}}}],
    ebay_listing_packages:[{id:'package-receipt',status:'DRAFT',updated_at:NOW.toISOString(),
      package_data:{categoryId:'category',shipping:{amount:8}}}],
    ebay_active_listings:[{id:'active-receipt',ebay_item_id:'123456789',
      current_price:25,updated_at:NOW.toISOString()}],
    seller_os_live_economics_readbacks_v1:[{live_price:25,expected_profit:4,calculated_at:NOW.toISOString()}],
    ebay_draft_only_approvals:[{id:'approval-receipt',status:'APPROVED',updated_at:NOW.toISOString()}],
    ebay_draft_only_execution_ledger:[{id:'execution-receipt',sku:'EBAY-SKU',updated_at:NOW.toISOString()}],
  }
  const supabase={from(table){
    let single=false,signal,retryValue=true
    const call={table,filters:[],limit:null,attempts:0};calls.push(call)
    const query={select(){return this},eq(k,v){call.filters.push([k,v]);return this},
      order(){return this},limit(n){call.limit=n;return this},maybeSingle(){single=true;return this},
      abortSignal(s){signal=s;return this},retry(v){retryValue=v;call.retry=v;return this},
      then(resolve,reject){
        call.attempts++;assert.equal(retryValue,false)
        const mode=behavior[table]
        if(mode==='throw')return Promise.reject(new TypeError('Synthetic programmer failure')).then(resolve,reject)
        if(mode==='error')return Promise.resolve({data:null,error:{code:'57014',message:'SECRET_PAYLOAD_MUST_NOT_ESCAPE'}}).then(resolve,reject)
        if(mode==='http521')return Promise.resolve({data:null,error:{code:'',message:'SECRET_HTML_MUST_NOT_ESCAPE'},status:521}).then(resolve,reject)
        if(mode==='hang')return new Promise((res)=>{
          signal.addEventListener('abort',()=>{aborted.push(table);res({data:null,error:{code:'',message:'AbortError'}})},{once:true})
        }).then(resolve,reject)
        const value={data:single?(tables[table]?.[0]??null):(tables[table]??[]),error:null}
        return (typeof mode==='number'?new Promise(res=>setTimeout(()=>res(value),mode)):Promise.resolve(value)).then(resolve,reject)
      }}
    return query
  }}
  return {supabase,calls,aborted}
}
const read=(f,options={})=>readSellerOsProductCaseAuditV1({supabase:f.supabase,
  accountKey:'fixed-account',identityType:'LUNA_PRODUCT_ID',identity:'123',
  detailMode:'EVIDENCE',now:NOW,readBudget:{internalBudgetMs:250,perReadBudgetMs:60},...options})

test('PASS_PRODUCT_CASE_WITHIN_MCP_BUDGET',async()=>{
  const f=fixture(),start=Date.now(),r=await read(f)
  assert(Date.now()-start<500);assert(PRODUCT_CASE_INTERNAL_BUDGET_MS<30000)
  assert(r.READ_DIAGNOSTICS.ELAPSED_MS<250)
})
test('PASS_OPTIONAL_SLOW_DEPENDENCY_DOES_NOT_502_WHOLE_CASE',async()=>{
  const f=fixture({marketplace_product_research_capture_observations:'hang',seller_os_luna_shipping_job_claims:'hang'})
  const r=await read(f)
  assert.equal(r.RESOLVED_CANONICAL_IDENTITY.lunaProductId,'123')
  assert.equal(r.PRODUCT_JOURNEY.find(x=>x.STAGE==='MARKET_RESEARCH').STATUS,'UNAVAILABLE')
  assert.equal(r.PRODUCT_JOURNEY.find(x=>x.STAGE==='MARKET_RESEARCH').FAILURE_CLASS,'PRODUCT_CASE_DEPENDENCY_TIMEOUT')
  assert.equal(f.aborted.length,2)
  assert.equal(r.READ_DIAGNOSTICS.READERS.find(x=>x.DEPENDENCY==='SHIPPING_PROJECTION').STATUS,'UNAVAILABLE')
})
test('PASS_CRITICAL_IDENTITY_FAILURE_FAILS_CLOSED',async()=>{
  for(const failure of ['hang','error']){
    const f=fixture({ebay_luna_opportunity_queue:failure}),r=await read(f)
    assert.equal(r.STATUS,'UNAVAILABLE');assert.equal(r.RESOLVED_CANONICAL_IDENTITY,null)
    assert.equal(r.PRODUCT_TRUTH_COMPLETENESS.STATUS,'UNAVAILABLE')
    assert.deepEqual(r.FIELD_TRUTH,[]);assert.equal(f.calls.length,1)
    assert(!JSON.stringify(r).includes('SECRET_PAYLOAD'))
  }
})
test('PASS_TIMEOUT_REMAINS_UNAVAILABLE_NOT_ZERO',async()=>{
  const r=await read(fixture({seller_os_live_economics_readbacks_v1:'hang'}))
  const profit=r.FIELD_TRUTH.find(x=>x.FIELD==='EXPECTED_PROFIT')
  assert.equal(profit.VALUE,null);assert.equal(profit.EVIDENCE_STATUS,'UNAVAILABLE')
  assert.equal(r.PRODUCT_JOURNEY.find(x=>x.STAGE==='ECONOMICS').STATUS,'UNAVAILABLE')
  // Independent official-price evidence survives an unavailable economics read.
  assert.equal(r.FIELD_TRUTH.find(x=>x.FIELD==='EBAY_LIVE_PRICE').VALUE,25)
})
test('PASS_INDEPENDENT_EVIDENCE_PRESERVED',async()=>{
  const r=await read(fixture({ebay_listing_packages:'hang',seller_os_luna_shipping_job_claims:'error'}))
  assert.deepEqual(sourceColumns(r.FIELD_TRUTH),fields)
  assert.equal(r.FIELD_TRUTH.find(x=>x.FIELD==='EBAY_ITEM_ID').VALUE,'123456789')
  assert.equal(r.PRODUCT_JOURNEY.find(x=>x.STAGE==='LISTING_PACKAGE').STATUS,'UNAVAILABLE')
  assert.equal(r.PRODUCT_JOURNEY.find(x=>x.STAGE==='OWNER_AUTHORIZATION').STATUS,'UNAVAILABLE')
  assert.equal(r.FIELD_TRUTH.find(x=>x.FIELD==='PACKAGE_STATE').VALUE,null)
})
test('PASS_GLOBAL_DEADLINE_ENFORCED',async()=>{
  const f=fixture({ebay_luna_opportunity_queue:25,ebay_listing_packages:25,
    ebay_active_listings:25,marketplace_product_research_capture_observations:'hang'})
  const start=Date.now(),r=await read(f,{readBudget:{internalBudgetMs:85,perReadBudgetMs:60}})
  assert(Date.now()-start<250)
  assert(r.READ_DIAGNOSTICS.READERS.some(x=>x.FAILURE_MODE==='PRODUCT_CASE_GLOBAL_DEADLINE_EXHAUSTED'))
  const budget=createProductCaseReadBudgetV1({internalBudgetMs:2})
  await new Promise(resolve=>setTimeout(resolve,5));let started=false
  const result=await budget.read({dependency:'LATE_OPTIONAL',authority:'existing',query:()=>{started=true;return Promise.resolve({data:[],error:null})}})
  assert.equal(started,false);assert(result.error);budget.close()
})
test('PASS_NO_UNBOUNDED_RETRIES',async()=>{
  const f=fixture({marketplace_product_research_capture_observations:'error'}),r=await read(f)
  assert(f.calls.every(x=>x.attempts===1&&x.retry===false))
  assert.equal(r.READ_DIAGNOSTICS.RETRY_COUNT,0)
  assert(!JSON.stringify(r).includes('SECRET_PAYLOAD'))
})
test('database HTTP 521 is classified without discarding independent Product Truth',async()=>{
  const r=await read(fixture({marketplace_product_research_capture_observations:'http521'}))
  const diagnostic=r.READ_DIAGNOSTICS.READERS.find(x=>x.DEPENDENCY==='MARKET_RESEARCH_PROJECTION')
  assert.equal(diagnostic.HTTP_STATUS,521)
  assert.equal(diagnostic.FAILURE_MODE,'PRODUCT_CASE_DATABASE_HTTP_UNAVAILABLE')
  assert.deepEqual(sourceColumns(r.FIELD_TRUTH),fields)
  assert(!JSON.stringify(r).includes('SECRET_HTML'))
})
test('PASS_NO_PORTFOLIO_SCAN',async()=>{
  const f=fixture();await read(f)
  assert(f.calls.every(x=>x.limit>0&&x.limit<=100&&x.filters.length>0))
  for(const call of f.calls.filter(x=>['ebay_active_listings','ebay_listing_packages'].includes(x.table)))
    assert(call.filters.some(([k])=>k==='account_key')&&call.filters.some(([k])=>['candidate_key','supplier_sku'].includes(k)))
})
test('PASS_25_OF_25_PRODUCT_TRUTH_PARITY_PRESERVED',async()=>{
  for(const detailMode of ['SUMMARY','EVIDENCE','TRACE']){
    const r=await read(fixture(),{detailMode})
    assert.equal(LUNA_FIELD_TRUTH_FIELDS_V1.length,25)
    assert.deepEqual(sourceColumns(r.FIELD_TRUTH),fields)
  }
})
test('PASS_PRODUCT_TRUTH_STAGE_PARTIAL_PRESERVED',async()=>{
  const r=await read(fixture())
  assert.equal(r.PRODUCT_TRUTH_COMPLETENESS.STATUS,'PARTIAL')
  assert.equal(r.PRODUCT_JOURNEY.find(x=>x.STAGE==='PRODUCT_TRUTH').STATUS,'PARTIAL')
})
test('existing contradicted source remains contradicted under optional failure',async()=>{
  const r=await read(fixture({__contradicted:true,ebay_listing_packages:'hang'}))
  assert.equal(r.PRODUCT_TRUTH_COMPLETENESS.STATUS,'CONTRADICTED')
  const title=r.FIELD_TRUTH.find(x=>x.FIELD==='TITLE')
  assert.equal(title.SEMANTIC_CLASS,'CONTRADICTED');assert.equal(title.CONTRADICTION,true)
})
test('PASS_READ_ONLY_SAFETY',async()=>{
  const r=await read(fixture())
  assert.equal(r.safety.readOnly,true);assert.equal(r.safety.databaseBusinessWrites,0)
  assert.equal(r.safety.marketplaceWrites,0);assert.equal(r.safety.taskAdvancements,0)
  assert.equal(r.READ_DIAGNOSTICS.EXTERNAL_CALL_COUNT,0)
})
test('unexpected programming exceptions remain visible, not optional missing evidence',async()=>{
  const previous=console.error,logs=[];console.error=(...x)=>logs.push(x)
  try{await assert.rejects(read(fixture({seller_os_luna_shipping_job_claims:'throw'})),TypeError)}
  finally{console.error=previous}
  assert(logs.some(x=>JSON.stringify(x).includes('UNEXPECTED_RUNTIME_EXCEPTION')))
  assert(!JSON.stringify(logs).includes('Synthetic programmer failure'))
})
test('relay returns 200 partial for optional timeout and 500 visible for programming error',async()=>{
  const secret='synthetic_relay_secret_0123456789abcdef',stamp=String(Date.now()),nonce='00000000-0000-4000-8000-000000000002'
  const body=JSON.stringify({contractVersion:SELLER_OS_CLOUD_READ_RELAY_VERSION,
    requestId:'00000000-0000-4000-8000-000000000001',toolName:'seller_os_get_product_case',
    arguments:{identityType:'LUNA_PRODUCT_ID',identity:'123',detailMode:'EVIDENCE'}})
  const signature=signSellerOsCloudReadRelayRequestV1({timestamp:stamp,nonce,body,authenticationSecret:secret})
  const request=()=>new Request('https://synthetic.vercel.app'+SELLER_OS_CLOUD_READ_RELAY_PATH,
    {method:'POST',body,headers:{'content-type':'application/json','x-seller-os-relay-timestamp':stamp,
      'x-seller-os-relay-nonce':nonce,'x-seller-os-relay-signature':signature}})
  const environment={VERCEL_ENV:'preview',SELLER_OS_CLOUD_READ_RELAY_SECRET:secret,
    EBAY_SELLER_ACCOUNT_KEY:'synthetic',EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT:'a'.repeat(64)}
  const r=await handleSellerOsCloudReadRelayRequestV1(request(),{environment,
    productCaseCollector:()=>read(fixture({marketplace_product_research_capture_observations:'hang'}))})
  assert.equal(r.status,200)
  assert.equal((await r.json()).result.PRODUCT_JOURNEY.find(x=>x.STAGE==='MARKET_RESEARCH').STATUS,'UNAVAILABLE')
  const before=console.error,logs=[];console.error=(...x)=>logs.push(x)
  try{
    const failure=await handleSellerOsCloudReadRelayRequestV1(request(),{environment,
      productCaseCollector:async()=>{throw new TypeError('SECRET_PROGRAMMER_PAYLOAD')}})
    assert.equal(failure.status,500)
    assert.equal((await failure.json()).code,'SELLER_OS_PRODUCT_CASE_UNEXPECTED_EXCEPTION')
  }finally{console.error=before}
  assert(logs.some(x=>JSON.stringify(x).includes('UNEXPECTED_RUNTIME_EXCEPTION')))
  assert(!JSON.stringify(logs).includes('SECRET_PROGRAMMER_PAYLOAD'))
})
