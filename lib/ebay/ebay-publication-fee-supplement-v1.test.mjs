import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
registerHooks({resolve(s,c,n){if(s==='server-only')return {url:'data:text/javascript,export{}',shortCircuit:true};try{return n(s,c)}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.(ts|mjs|js)$/.test(s))return n(s+'.ts',c);throw e}}})
const {payoutCurrencyEvidenceV1,readPublicationPayoutCurrencyV1}=await import('./ebay-publication-fee-supplement-v1.ts')
const now='2026-09-11T09:00:00Z'
const funds=Object.fromEntries(['totalFunds','availableFunds','processingFunds','fundsOnHold'].map(k=>[k,{currency:'USD',value:'0'}]))
test('official account-bound pending payout funds supply currency without supplier or bank inference',()=>{
 const r=payoutCurrencyEvidenceV1(funds,true,now);assert.equal(r.status,'PROVEN');assert.equal(r.currency,'USD');assert.equal(r.amountsIncluded,false);assert.equal(r.bankDetailsIncluded,false)
})
test('missing, mixed or unbound currencies never default to marketplace USD',()=>{
 for(const [b,bound] of [[{},true],[funds,false],[{...funds,totalFunds:{currency:'EUR'}},true],[{...funds,fundsOnHold:{}},true]])assert.equal(payoutCurrencyEvidenceV1(b,bound,now).status,'UNPROVEN')
})
test('converted payout target is used only if consistent across the official funds',()=>{
 const converted=Object.fromEntries(Object.keys(funds).map(k=>[k,{currency:'USD',convertedToCurrency:'EUR'}]));assert.equal(payoutCurrencyEvidenceV1(converted,true,now).currency,'EUR')
})
test('missing or denied Finance grant cannot retry or call financial resources',async()=>{
 const keys={EBAY_DRAFT_ONLY_TARGET:'PRODUCTION',EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID:'fixture',EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET:'fixture',EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN:'fixture',EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID:'fixture-seller',EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT:'',EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT:''}
 const old=Object.fromEntries(Object.keys(keys).map(k=>[k,process.env[k]]));Object.assign(process.env,keys)
 try{const calls=[];const r=await readPublicationPayoutCurrencyV1(async(url,options)=>{calls.push({url,method:options.method});return new Response(JSON.stringify({error:'invalid_scope',error_description:'private fixture detail'}),{status:400})});assert.equal(r.reason,'PAYOUT_OAUTH_GRANT_UNAVAILABLE');assert.equal(r.oauthError,'invalid_scope');assert.ok(!JSON.stringify(r).includes('private fixture detail'));assert.equal(calls.length,1);assert.match(calls[0].url,/identity\/v1\/oauth2\/token$/)}finally{for(const k of Object.keys(keys)){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k]}}
})
const {payoutGrantEvidenceV1}=await import('./ebay-publication-fee-supplement-v1.ts')
test('official introspection projects exact granted scopes and no identifying/token metadata',()=>{
 const r=payoutGrantEvidenceV1({active:true,scope:'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory',client_id:'private',username:'private',sub:'private',token:'private'})
 assert.equal(r.requiredScopePresent,false);assert.equal(r.ownerReauthRequired,true);assert.equal(r.payoutCurrencyProven,false);assert.doesNotMatch(JSON.stringify(r),/private/)
 const yes=payoutGrantEvidenceV1({active:true,scope:r.requiredScope});assert.equal(yes.requiredScopePresent,true);assert.equal(yes.ownerReauthRequired,false);assert.equal(yes.payoutCurrencyProven,false)
})
test('missing or inactive introspection is unproven, not an invented grant list',()=>{
 for(const x of [{active:false,scope:'https://api.ebay.com/oauth/api_scope'},{active:true},{}])assert.equal(payoutGrantEvidenceV1(x).requiredScopePresent,null)
})
