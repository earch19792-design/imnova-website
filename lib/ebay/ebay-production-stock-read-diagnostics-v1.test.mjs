import test from 'node:test'
import assert from 'node:assert/strict'
import { stockRequestAuthMetadataV1, stockResponseDiagnosticV1 } from './ebay-production-stock-read-diagnostics-v1.ts'
import { productionStockReadTransportV1 } from './ebay-production-stock-read-boundary-v1.ts'
const token=claims=>Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature'
const secret=token({role:'service_role',iss:'supabase',ref:'qsefoxmmypmdtwrrtnry',private:'NEVER_ECHO'})
const headers={authorization:'Bearer '+secret,apikey:secret}
test('legacy service JWT and modern opaque keys are classified without exposing or authorizing token claims',()=>{
 const r=stockRequestAuthMetadataV1(new Headers(headers))
 assert.equal(r.jwtRole,'service_role');assert.equal(r.jwtIssuerMatch,'MATCH')
 assert.equal(r.jwtProjectMatch,'MATCH');assert.equal(r.jwtAudienceMatch,'ABSENT_LEGACY_CLAIM')
 assert.equal(r.jwtClaimsAreDiagnosticOnly,true);assert.equal(r.authorizationMatchesApiKey,true)
 assert.ok(!JSON.stringify(r).includes(secret));assert.ok(!JSON.stringify(r).includes('NEVER_ECHO'))
 const opaque=stockRequestAuthMetadataV1(new Headers({apikey:'sb_secret_NEVER_ECHO',authorization:'Bearer sb_secret_NEVER_ECHO'}))
 assert.equal(opaque.jwtRole,'NOT_JWT_OR_OPAQUE');assert.ok(!JSON.stringify(opaque).includes('sb_secret_'))
 const hostile=stockRequestAuthMetadataV1(new Headers({authorization:'Bearer '+token({role:'LEAK',iss:'LEAK',aud:'LEAK',ref:'LEAK'})}))
 assert.ok(!JSON.stringify(hostile).includes('LEAK'))
})
test('401 classification distinguishes PostgreSQL permission denial from JWT validation and unknown gateway rejection',async()=>{
 for(const [code,origin] of [['42501','POSTGRES_INSUFFICIENT_PRIVILEGE'],['PGRST301','POSTGREST_JWT_VALIDATION'],['secret','UPSTREAM_UNCLASSIFIED_401']]){
 const response=Response.json({code,message:'permission denied for table ebay_active_listing_sync_state',details:'NEVER_ECHO',hint:secret},{status:401})
 const r=await stockResponseDiagnosticV1(response,'ebay_active_listing_sync_state')
 assert.equal(r.http401Origin,origin);assert.equal(r.permissionDeniedOnRequestedTable,true)
 assert.equal(r.upstreamErrorCode,code==='secret'?null:code)
 assert.ok(!JSON.stringify(r).includes('NEVER_ECHO'));assert.ok(!JSON.stringify(r).includes(secret))
 assert.equal((await response.json()).code,code)
 }
})
test('five existing reads retain auth; first divergence is observable without retry or secret fingerprints',async()=>{
 const account='imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12'
 const tables=['ebay_active_listings','seller_os_luna_linkage_decisions','seller_os_luna_stock_check_jobs','seller_os_luna_stock_observations','ebay_active_listing_sync_state']
 const calls=[],reads=[]
 const fetch=productionStockReadTransportV1({databaseUrl:'https://qsefoxmmypmdtwrrtnry.supabase.co',accountKey:account,
 deadlineAt:Date.now()+6000,onRead:r=>reads.push(r),fetcher:async(u,i)=>{calls.push([u,i]);return String(u).includes('sync_state')
 ?Response.json({code:'42501',message:'permission denied for table ebay_active_listing_sync_state'},{status:401}):Response.json([])}})
 for(const table of tables){const call=fetch('https://qsefoxmmypmdtwrrtnry.supabase.co/rest/v1/'+table+'?account_key=eq.'+account+'&select=account_key&limit=1',
 {headers:table.includes('sync_state')?{apikey:secret}:headers});if(table.includes('sync_state'))await assert.rejects(call);else await call}
 assert.equal(calls.length,5);assert.equal(reads.length,5)
 assert.equal(reads[0].authorizationHeaderPresent,true);assert.equal(reads[0].authHeadersMatchFirstRequest,true)
 assert.equal(reads[4].authorizationHeaderPresent,false);assert.equal(reads[4].authHeadersMatchFirstRequest,false)
 assert.equal(reads[4].http401Origin,'POSTGRES_INSUFFICIENT_PRIVILEGE')
 assert.ok(!JSON.stringify(reads).includes(secret))
 await assert.rejects(fetch('https://qsefoxmmypmdtwrrtnry.supabase.co/rest/v1/ebay_active_listings?account_key=eq.'+account+'&select=account_key&limit=1'))
 assert.equal(calls.length,5)
})
test('invalid response bodies cannot inject arbitrary error text into diagnostics',async()=>{
 const r=await stockResponseDiagnosticV1(new Response('<secret>NEVER_ECHO</secret>',{status:401}),'ebay_active_listings')
 assert.equal(r.upstreamErrorCode,null);assert.equal(r.http401Origin,'UPSTREAM_UNCLASSIFIED_401')
 assert.ok(!JSON.stringify(r).includes('NEVER_ECHO'))
})
