import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { authorizeProductionStockReadV1 as authorizeRaw, productionStockReadTransportV1 as transport,
  PRODUCTION_STOCK_READ_PATH as path, PRODUCTION_STOCK_READ_CALLER as caller,
  PRODUCTION_STOCK_READ_CAPABILITIES as capabilities } from './ebay-production-stock-read-boundary-v1.ts'
import { getEbayProRuntimeBoundary, getSellerOsStockGuardRuntimeBoundary } from './environment-boundaries.ts'

const authorize=(r,e)=>authorizeRaw(r,e,async a=>a==='test-production-assertion')
const secret='test-existing-service-authority-'+'x'.repeat(40)
const env={VERCEL_ENV:'production',VERCEL_TARGET_ENV:'production',
 VERCEL_PROJECT_ID:'prj_a6N1XDfeaKAiR5QmmNFYF16Nmqe5',
 VERCEL_PROJECT_PRODUCTION_URL:'imnova-website-z1qh.vercel.app',SUPABASE_SERVICE_ROLE_KEY:secret}
const request=(query='capability=STOCKGUARD_EVALUATION',options={})=>new Request('https://imnova-website-z1qh.vercel.app'+path+'?'+query,
 {headers:{'x-seller-os-service-assertion':'test-production-assertion','x-seller-os-caller':caller},...options})
test('production allows exactly the five read capabilities for the authenticated monitoring caller',async()=>{
 for(const capability of capabilities)assert.equal((await authorize(request('capability='+capability),env)).allowed,true)
})
test('all write verbs and marketplace/unknown capabilities fail closed',async()=>{
 for(const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])assert.equal((await authorize(request(undefined,{method}),env)).allowed,false)
 for(const capability of ['publishOffer','reviseItem','endItem','inventory_write','offer_write','ads_write','UNKNOWN'])
  assert.equal((await authorize(request('capability='+capability),env)).allowed,false)
})
test('wrong service, wrong credential, missing credential and wrong deployment are denied',async()=>{
 for(const headers of [{authorization:'Bearer '+secret,'x-seller-os-caller':'PUBLISHER'},
  {authorization:'Bearer '+'y'.repeat(secret.length),'x-seller-os-caller':caller},{}])
  assert.equal((await authorize(request(undefined,{headers}),env)).allowed,false)
 for(const override of [{VERCEL_ENV:'preview'},{VERCEL_PROJECT_ID:'other'},{VERCEL_TARGET_ENV:'preview'},
  {VERCEL_PROJECT_PRODUCTION_URL:'other.vercel.app'},{VERCEL_ENV:'development'}])
  assert.equal((await authorize(request(),{...env,...override})).allowed,false)
})
test('caller controlled target, credential selector, command, account and duplicate query keys are denied',async()=>{
 for(const query of ['url=https://api.ebay.com','credential=other','command=publishOffer','account=other','limit=10000',
  'capability=CURRENT_LIVE_LISTING_READ','itemId=x','itemId=366643126310&itemId=366662788140'])
  assert.equal((await authorize(request('capability=STOCKGUARD_EVALUATION&'+query),env)).allowed,false)
 assert.equal((await authorize(request('capability=STOCKGUARD_EVALUATION&itemId=366643126310'),env)).allowed,true)
})
test('the preprod-only monitor and cloud relay remain denied in production; cron execution is not enabled',async()=>{
 for(const pathname of ['/api/admin/ebay/commercial-monitor','/api/seller-os/assistant/cloud-read-relay','/api/admin/ebay/draft-only']){
  assert.equal((await authorize(new Request('https://example.test'+pathname),env)).allowed,false)
  assert.equal(getEbayProRuntimeBoundary({vercelEnv:'production',vercelProjectId:env.VERCEL_PROJECT_ID,pathname}).blocked,true)
 }
 assert.equal(getSellerOsStockGuardRuntimeBoundary({vercelEnv:'production',vercelProjectId:env.VERCEL_PROJECT_ID}).authorized,false)
})
const account='imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12'
const origin='https://qsefoxmmypmdtwrrtnry.supabase.co'
const readUrl=origin+'/rest/v1/seller_os_luna_stock_observations?account_key=eq.'+account+'&select=observation_id&limit=10'
function fixture(){const calls=[];const fetcher=async(u,i)=>{calls.push([u,i]);return Response.json([])}
 return {calls,fetch:transport({databaseUrl:origin,accountKey:account,deadlineAt:Date.now()+6000,fetcher})}}
test('transport permits only bounded reads against installed authority; replay has zero side effects',async()=>{
 const f=fixture()
 for(let n=0;n<2;n++){assert.equal((await authorize(request(),env)).allowed,true);await f.fetch(readUrl,{method:'GET'})}
 assert.equal(f.calls.length,2)
 for(const [,i]of f.calls){assert.equal(i.method,'GET');assert.equal(i.redirect,'error');assert.equal(i.cache,'no-store')}
})
test('transport rejects marketplace, RPC, alternate host/account/table, unlimited or wildcard reads',async()=>{
 for(const url of ['https://api.ebay.com/sell/inventory/v1/offer',origin+'/rest/v1/rpc/publish',
  readUrl.replace('qsefoxmmypmdtwrrtnry','vsfthqydfrdzulldbfbe'),readUrl.replace('eq.'+account,'eq.other'),
  readUrl.replace('seller_os_luna_stock_observations','users'),readUrl.replace('select=observation_id','select=*'),
  readUrl.replace('limit=10','limit=2000'),readUrl.replace('&limit=10','')]){
  const f=fixture();await assert.rejects(f.fetch(url));assert.equal(f.calls.length,0)
 }
 for(const method of ['POST','PUT','PATCH','DELETE']){const f=fixture();await assert.rejects(f.fetch(readUrl,{method}));assert.equal(f.calls.length,0)}
})
test('bounded invocation cannot turn into repeated polling or follow a redirect',async()=>{
 const f=fixture();for(let i=0;i<5;i++)await f.fetch(readUrl)
 await assert.rejects(f.fetch(readUrl));assert.equal(f.calls.length,5)
})
test('denied responses never expose secret or environment values',async()=>{
 for(const value of [(await authorize(request(),{...env,VERCEL_PROJECT_ID:'private-project'})),
  (await authorize(request(undefined,{headers:{}}),env))]){
  assert.ok(!JSON.stringify(value).includes(secret));assert.ok(!JSON.stringify(value).includes('private-project'))
 }
})
test('new route imports the canonical read consumer, never a worker or writer, and does not weaken old boundary',async()=>{
 const route=readFileSync(new URL('../../app/api/runtime/stockguard-read/route.ts',import.meta.url),'utf8')
 const service=readFileSync(new URL('./ebay-production-stock-read-service-v1.ts',import.meta.url),'utf8')
 assert.match(route,/authorizeProductionStockReadV1/);assert.match(route,/productionStockReadTransportV1/)
 assert.match(service,/projectSellerOsCanonicalLunaStockReadModelV1/)
 assert.doesNotMatch(route+service,/publishOffer|ReviseFixedPriceItem|endItem|\.rpc\(|\.insert\(|\.update\(|\.upsert\(|setInterval\(/)
 assert.doesNotMatch(route,/console\.|error\.message|process\.env\.VERCEL_GIT_COMMIT_SHA/)
})
