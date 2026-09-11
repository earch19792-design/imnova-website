import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
registerHooks({resolve(s,c,n){if(s==='server-only')return {url:'data:text/javascript,export{}',shortCircuit:true};try{return n(s,c)}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.(ts|mjs|js)$/.test(s))return n(s+'.ts',c);throw e}}})
const {shippingProbeDiagnosticV1:project,persistExistingShippingProbeDiagnosticV1:persist}=await import('../seller-os/shipping-probe-diagnostic-v1.ts')
const probe={contract:'LUNA_CAPTURE_READ_ONLY_PROBE_V1',observedAt:'2026-09-11T09:00:00Z',canonicalBindingPresent:true,checkoutDomReady:false,captureAvailable:false}
test('existing valid binding with no checkout explains SHOP_PAY_NOT_READY without capture authority',()=>{
 assert.equal(project(probe).reason,'SHOP_PAY_NOT_READY');assert.equal(project({...probe,secret:'never persist',url:'private'}).secret,undefined)
 assert.equal(project(probe).captureAuthorized,false)
 assert.equal(project({...probe,canonicalBindingPresent:false}).reason,'CANONICAL_BINDING_NOT_PROVEN')
 assert.equal(project({...probe,captureAvailable:true}),null)
 assert.equal(project({...probe,checkoutDomReady:true,captureAvailable:true}).reason,'AVAILABLE')
})
test('follower and stale proof never write diagnostic; exact leader and observation filters are mandatory',async()=>{
 const calls=[];const chain={update:x=>{calls.push(['update',x]);return chain},eq:(...x)=>{calls.push(['eq',...x]);return chain},gt:(...x)=>{calls.push(['gt',...x]);return chain},select:()=>chain,maybeSingle:async()=>({data:{shipping_probe_diagnostic:probe},error:null})};const input={supabase:{from:()=>chain},accountKey:'a',workerId:'w',leaderSessionId:'l',probe,gate:{state:'UNAVAILABLE'}}
 for(const code of ['FOLLOWER_SUPPRESSED','CAPABILITY_PROOF_STALE'])assert.equal(await persist({...input,gate:{state:'UNAVAILABLE',reasonCode:code}}),false)
 assert.equal(calls.length,0);assert.equal(await persist(input),true)
 for(const [key,value] of [['marketplace_account_key','a'],['worker_family','LUNA_SHIPPING'],['worker_instance_id','w'],['leader_session_id','l'],['shipping_capability_worker_id','w'],['shipping_capability_observed_at',probe.observedAt]])assert.ok(calls.some(c=>c[0]==='eq'&&c[1]===key&&c[2]===value))
 assert.deepEqual(Object.keys(calls[0][1]),['shipping_probe_diagnostic'])
})
test('existing lease gains bounded diagnostic metadata without changing capture or backoff authority',async()=>{
 const db=new PGlite();try{
 await db.exec("create table public.seller_os_browser_workload_leases_v1(id int primary key, shipping_capture_state text, shipping_next_attempt_at timestamptz); insert into public.seller_os_browser_workload_leases_v1 values(1,'UNAVAILABLE','2026-09-11T10:00:00Z')")
 await db.exec(readFileSync(new URL('../../supabase/migrations/20260911094504_shipping_existing_probe_diagnostic_v1.sql',import.meta.url),'utf8'))
 await db.query('update public.seller_os_browser_workload_leases_v1 set shipping_probe_diagnostic=$1 where id=1',[project(probe)])
 const row=(await db.query('select shipping_capture_state,shipping_next_attempt_at,shipping_probe_diagnostic from public.seller_os_browser_workload_leases_v1 where id=1')).rows[0]
 assert.equal(row.shipping_capture_state,'UNAVAILABLE');assert.equal(new Date(row.shipping_next_attempt_at).toISOString(),'2026-09-11T10:00:00.000Z')
 await assert.rejects(db.query('update public.seller_os_browser_workload_leases_v1 set shipping_probe_diagnostic=$1 where id=1',[{...project(probe),captureAuthorized:true}]))
 }finally{await db.close()}
})
const {inspectPublicationPayoutGrantV1}=await import('./ebay-publication-fee-supplement-v1.ts')
async function fixture(fn){const keys={EBAY_DRAFT_ONLY_TARGET:'PRODUCTION',EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID:'fixture',EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET:'fixture',EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN:'refresh-secret',EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID:'fixture-seller',EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT:'',EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT:''};const old=Object.fromEntries(Object.keys(keys).map(k=>[k,process.env[k]]));Object.assign(process.env,keys);try{await fn()}finally{for(const k of Object.keys(keys))old[k]===undefined?delete process.env[k]:process.env[k]=old[k]}}
test('usable existing grant plus inactive introspection is not a missing consent proof; no scope expansion or retry',()=>fixture(async()=>{
 const responses=[{access_token:'access-secret'},{userId:'fixture-seller'},{active:false},{errors:[{errorId:1100,domain:'ACCESS',category:'REQUEST',message:'private'}]}];const calls=[]
 const r=await inspectPublicationPayoutGrantV1(async(url,opts)=>{calls.push([String(url),opts]);const b=responses.shift();return new Response(JSON.stringify(b),{status:responses.length===0?403:200})})
 assert.equal(calls.length,4);assert.equal(calls[0][1].body.has('scope'),false);assert.equal(calls[2][1].body.get('token_type_hint'),'access_token')
 assert.equal(r.accountBindingExact,true);assert.equal(r.existingGrantRefreshPass,true);assert.equal(r.ownerReauthRequired,null);assert.equal(r.inactiveIntrospectionProvesInvalidToken,false)
 assert.doesNotMatch(JSON.stringify(r),/access-secret|refresh-secret|private/)
}))
test('scope proven missing in active introspection requires consent; valid finances evidence can resolve payout',()=>fixture(async()=>{
 for(const missing of [true,false]){
 const base='https://api.ebay.com/oauth/api_scope';const funds=Object.fromEntries(['totalFunds','availableFunds','processingFunds','fundsOnHold'].map(k=>[k,{currency:'EUR',value:'private'}]));const responses=[{access_token:'secret'},{userId:'fixture-seller'},{active:true,scope:missing?base:base+'/sell.finances'},funds]
 const r=await inspectPublicationPayoutGrantV1(async()=>new Response(JSON.stringify(responses.shift()),{status:200}));assert.equal(r.requiredScopePresent,!missing);assert.equal(r.ownerReauthRequired,false);assert.equal(r.effectiveFinancesAccessProven,true);assert.equal(r.payout.currency,'EUR');assert.doesNotMatch(JSON.stringify(r),/private/)
 }
}))
test('identity rejection reports official code and introspection without reading another account funds',()=>fixture(async()=>{
 const responses=[{access_token:'secret'},{errors:[{errorId:1100,domain:'OAuth',category:'REQUEST',message:'private'}]},{active:false}];let calls=0
 const r=await inspectPublicationPayoutGrantV1(async()=>{calls++;return new Response(JSON.stringify(responses.shift()),{status:calls===2?403:200})})
 assert.equal(calls,3);assert.equal(r.identityHttpStatus,403);assert.equal(r.identityErrors[0].errorId,1100)
 assert.equal(r.fundsReadAttempted,false);assert.equal(r.ownerReauthRequired,null);assert.equal(r.accountBindingExact,false)
 assert.doesNotMatch(JSON.stringify(r),/secret|private/)
}))
test('REST opaque identifier reconciles only with the exact installed Trading identity using the same token',()=>fixture(async()=>{
 for(const matches of [true,false]){
 let calls=0;const responses=[{access_token:'secret'},{userId:'opaque-rest-id'},{active:false},{errors:[{errorId:1100,domain:'OAuth',category:'REQUEST'}]}]
 const r=await inspectPublicationPayoutGrantV1(async(url,opts)=>{calls++
  if(String(url).endsWith('/ws/api.dll')){assert.equal(opts.headers['X-EBAY-API-CALL-NAME'],'GetUser');assert.equal(opts.headers['X-EBAY-API-IAF-TOKEN'],'secret');return new Response(`<GetUserResponse><Ack>Success</Ack><User><UserID>${matches?'fixture-seller':'other-account'}</UserID></User></GetUserResponse>`)}
  return new Response(JSON.stringify(responses.shift()),{status:calls===5?403:200})})
 assert.equal(r.accountBindingExact,matches);assert.equal(r.tradingIdentityReadAttempted,true);assert.equal(calls,matches?5:4)
 assert.doesNotMatch(JSON.stringify(r),/secret|fixture-seller|opaque-rest-id|other-account/)
 }
}))

 test('successful official funds read reconciles cached scope metadata without expanding grants',async()=>{
 const {resolvePayoutGrantWithFundsReadV1:resolve}=await import('./ebay-publication-fee-supplement-v1.ts')
 const audit={requiredScopePresent:false,ownerReauthRequired:true,accountBindingExact:true,fundsHttpStatus:200,grantedScopes:['base']}
 const payout={status:'PROVEN',accountBindingExact:true,source:'https://apiz.ebay.com/sell/finances/v1/seller_funds_summary',currency:'USD'}
 assert.equal(resolve(audit,payout).ownerReauthRequired,false);assert.equal(resolve(audit,payout).requiredScopePresent,false);assert.deepEqual(resolve(audit,payout).grantedScopes,['base'])
 for(const invalid of [{...payout,accountBindingExact:false},{...payout,status:'UNPROVEN'},{...payout,source:'inferred'}])assert.equal(resolve(audit,invalid).ownerReauthRequired,true)
 assert.equal(resolve({...audit,fundsHttpStatus:403},payout).ownerReauthRequired,true)
 })
