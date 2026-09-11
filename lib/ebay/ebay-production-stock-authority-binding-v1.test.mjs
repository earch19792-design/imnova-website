import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, SignJWT } from 'jose'
import { PRODUCTION_STOCK_AUTHORITY_BINDING_V1 as binding,
  verifyProductionStockServiceIdentityV1 as verify,
  productionStockAuthorityConfigurationValidV1 as validConfig } from './ebay-production-stock-authority-binding-v1.ts'
import { authorizeProductionStockReadV1 as authorize, productionStockReadTransportV1 as transport } from './ebay-production-stock-read-boundary-v1.ts'
const pair=await generateKeyPair('RS256'), now=new Date(), seconds=Math.floor(+now/1000)
const claims={iss:binding.issuer,aud:binding.audience,sub:binding.subject,iat:seconds,nbf:seconds-1,exp:seconds+3599,
 project_id:binding.projectId,project:binding.project,owner_id:binding.ownerId,owner:binding.owner,environment:'production'}
const sign=(overrides={},key=pair.privateKey)=>new SignJWT({...claims,...overrides}).setProtectedHeader({alg:'RS256'}).sign(key)
const options={keyResolver:async()=>pair.publicKey,currentDate:now}
const env={VERCEL_ENV:'production',VERCEL_TARGET_ENV:'production',VERCEL_PROJECT_ID:binding.projectId,
 VERCEL_PROJECT_PRODUCTION_URL:binding.hostname,NEXT_PUBLIC_SUPABASE_URL:binding.databaseUrl}
const req=(assertion,query='capability=STOCKGUARD_EVALUATION',headers={})=>new Request('https://'+binding.hostname+'/api/runtime/stockguard-read?'+query,
 {headers:{'x-seller-os-caller':'SELLER_OS_STOCKGUARD_MONITOR_V1',...(assertion?{'x-seller-os-service-assertion':assertion}:{}),...headers}})
test('production service authenticates a signed production workload without a shared secret',async()=>{
 const assertion=await sign();assert.equal(await verify(assertion,options),true)
 assert.equal((await authorize(req(assertion),env,t=>verify(t,options))).allowed,true)
 assert.equal(validConfig(env),true)
})
test('wrong project, owner, subject, issuer, audience, environment and missing identity claims fail closed',async()=>{
 for(const field of ['project_id','project','owner_id','owner','sub','iss','aud','environment']){
  assert.equal(await verify(await sign({[field]:'wrong'}),options),false,field)
  assert.equal(await verify(await sign({[field]:undefined}),options),false,field)
 }
})
test('PREPROD project tokens are rejected even when Vercel labels their deployment production',async()=>{
 assert.equal(await verify(await sign({project_id:'prj_XvOpSg1jhmLLG1yOCFhAbiLEn222',project:'imnova-seller-os-preprod'}),options),false)
 assert.equal((await authorize(req(await sign()),{...env,VERCEL_PROJECT_ID:'prj_XvOpSg1jhmLLG1yOCFhAbiLEn222'},t=>verify(t,options))).allowed,false)
})
test('missing, forged, expired, future and overly long lived assertions fail closed',async()=>{
 const wrong=await generateKeyPair('RS256')
 for(const token of ['', 'private-secret-not-a-service-assertion', await sign({},wrong.privateKey),
  await sign({exp:seconds-60}), await sign({nbf:seconds+60}),await sign({exp:seconds+7200})]){
  assert.equal(await verify(token,options),false)
 }
})
test('caller account, tokens, URLs, writes and capabilities cannot change the bound service',async()=>{
 const token=await sign()
 for(const query of ['account=other','accountAlias=other','token=x','url=https://evil.test','capability=publishOffer']){
  assert.equal((await authorize(req(token,'capability=STOCKGUARD_EVALUATION&'+query),env,t=>verify(t,options))).allowed,false)
 }
 assert.equal((await authorize(req(token,undefined,{authorization:'Bearer caller-database-key'}),env,t=>verify(t,options))).allowed,false)
 for(const c of ['publishOffer','reviseItem','endItem','offer_write','inventory_write','ads_write','UNKNOWN'])
  assert.equal((await authorize(req(token,'capability='+c),env,t=>verify(t,options))).allowed,false)
})
test('configuration rejects PREPROD runtime/credentials and arbitrary database/account binding',()=>{
 for(const update of [{NEXT_PUBLIC_SUPABASE_URL:'https://vsfthqydfrdzulldbfbe.supabase.co'},
  {EBAY_SELLER_ACCOUNT_KEY:'other'}, {SELLER_OS_CLOUD_READ_RELAY_URL:'https://preview.vercel.app'},
  {SELLER_OS_CLOUD_READ_RELAY_SECRET:'secret'}, {SELLER_OS_CLOUD_READ_RELAY_PROTECTION_BYPASS:'secret'}])
  assert.equal(validConfig({...env,...update}),false)
 for(const input of [{databaseUrl:'https://vsfthqydfrdzulldbfbe.supabase.co',accountKey:binding.accountKey},
  {databaseUrl:binding.databaseUrl,accountKey:'wrong'}])assert.throws(()=>transport({...input,deadlineAt:+now+6000}))
})
test('restart/redeploy and replay retain exact binding without persisting a token or changing stock',async()=>{
 for(let i=0;i<2;i++){
  const auth=await authorize(req(await sign()),{...env},t=>verify(t,options))
  assert.equal(auth.allowed,true);assert.equal(validConfig({...env}),true)
  assert.equal(JSON.stringify(auth).includes(binding.accountKey),false)
 }
})
test('upstream errors are reduced to fixed table/code without leaking database diagnostics',async()=>{
 const errors=[]
 const read=transport({databaseUrl:binding.databaseUrl,accountKey:binding.accountKey,deadlineAt:Date.now()+6000,
  fetcher:async()=>Response.json({message:'secret-environment-value'},{status:404}),onFailure:e=>errors.push(e)})
 await assert.rejects(read(binding.databaseUrl+'/rest/v1/ebay_active_listings?account_key=eq.'+binding.accountKey+'&select=id&limit=1'),
  {message:'PRODUCTION_STOCK_AUTHORITY_TABLE_MISSING:ebay_active_listings'})
 assert.deepEqual(errors,['PRODUCTION_STOCK_AUTHORITY_TABLE_MISSING:ebay_active_listings'])
})
