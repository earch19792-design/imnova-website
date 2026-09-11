import test from 'node:test'
import assert from 'node:assert/strict'
import {verifySingleCurrentOfferV1} from './ebay-draft-only-gateway.ts'
const sku='IMNOVA24535B3703354984A36CDBB73A7560DA',offerId='256820077011'
const exact={sku,offerId,marketplaceId:'EBAY_US',status:'UNPUBLISHED'}
async function read(body,status=200){
 const values={EBAY_DRAFT_ONLY_TARGET:'PRODUCTION',EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID:'fixture',EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET:'fixture',EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN:'fixture',EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID:'fixture-seller',EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT:'',EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT:'',EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_HMAC_SECRET:'x'.repeat(64)}
 const prior=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values)
 let calls=0
 try{return await verifySingleCurrentOfferV1(offerId,sku,async(resource,init)=>{
  const url=new URL(String(resource))
  if(url.pathname==='/identity/v1/oauth2/token')return Response.json({access_token:'fixture',expires_in:0})
  assert.equal(init.method,'GET')
  if(url.pathname==='/commerce/identity/v1/user/')return Response.json({userId:'fixture-seller',status:'CONFIRMED'})
  assert.equal(url.pathname,'/sell/inventory/v1/offer');calls++;assert.equal(calls,1)
  assert.equal(url.searchParams.get('sku'),sku);assert.equal(url.searchParams.get('limit'),'100')
  assert.equal(url.searchParams.has('marketplace_id'),false);assert.equal(url.searchParams.has('format'),false)
  assert.equal(init.headers['Accept-Language'],'en-US');assert.equal(init.cache,'no-store')
  return Response.json(body,{status})
 })}finally{for(const [k,v] of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v}
}
test('CURRENT duplicate guard uses the certified bounded exact-SKU request',async()=>{assert.equal((await read({total:1,size:1,offers:[exact]})).safe,true)})
test('Partial or multiple Offer collection never proves absence of duplicates',async()=>{
 assert.equal((await read({total:2,size:1,offers:[exact]})).safe,false)
 assert.equal((await read({total:2,size:2,offers:[exact,{...exact,offerId:'256820077012'}]})).safe,false)
})
test('Official collection errors remain structured and never mean no duplicates',async()=>{
 const r=await read({errors:[{errorId:25706,domain:'API_INVENTORY',category:'REQUEST',message:'Invalid pagination'}]},400)
 assert.equal(r.safe,false);assert.equal(r.errors[0].errorId,'25706');assert.equal(r.httpStatus,400)
})
