import { getEbayDraftOnlyGatewayConfig } from './ebay-draft-only-gateway'
import { ebayProductionAccountFingerprint } from './ebay-seller-account-scope'
import { keywordRecord as record } from '../seller-os/keyword-intelligence-handoff-v1'
import { readEbayTradingUserIdWithAccessToken } from './ebay-trading-identity-proof'

export const PAYOUT_REQUIRED_SCOPE_V1='https://api.ebay.com/oauth/api_scope/sell.finances'
export const PAYOUT_GRANT_DIAGNOSTIC_V2='PAYOUT_EXISTING_ACCESS_GRANT_V3'
export function payoutGrantEvidenceV1(value:unknown) {
 const b=record(value), scopes=typeof b.scope==='string'?b.scope.split(/\s+/).filter(s=>/^https:\/\/api\.ebay\.com\/oauth\/api_scope(?:\/[a-z._]+)?$/.test(s)):null
 return {active:b.active===true,requiredScope:PAYOUT_REQUIRED_SCOPE_V1,grantedScopes:scopes,
  requiredScopePresent:b.active===true&&scopes?scopes.includes(PAYOUT_REQUIRED_SCOPE_V1):null,
  ownerReauthRequired:b.active===true&&scopes?!scopes.includes(PAYOUT_REQUIRED_SCOPE_V1):null,
  applicationKeysetScopeAvailability:'NOT_EXPOSED_BY_TOKEN_INTROSPECTION',payoutCurrencyProven:false}
}

/** Official token metadata only; never returns tokens, user IDs or client IDs. */
export async function inspectPublicationPayoutGrantV1(fetchImpl:typeof fetch=fetch) {
 const c=getEbayDraftOnlyGatewayConfig(),observedAt=new Date().toISOString()
 const endpoint='https://api.ebay.com/identity/v1/oauth2/token/introspect'
 if(c.target!=='PRODUCTION'||!c.oauthConfigured||!c.identityBound||!c.identityConfigurationConsistent)
  return {status:'UNPROVEN',reason:'PAYOUT_ACCOUNT_AUTHORITY_UNAVAILABLE',observedAt}
 try {
  const basic={Authorization:`Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'}
  // Omitting scope requests the existing grant, never an expansion of consent.
  const refresh=await fetchImpl(c.tokenEndpoint,{method:'POST',headers:basic,
   body:new URLSearchParams({grant_type:'refresh_token',refresh_token:c.refreshToken}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})
  const refreshed=record(await refresh.json().catch(()=>({})))
  if(!refresh.ok||typeof refreshed.access_token!=='string')return {version:PAYOUT_GRANT_DIAGNOSTIC_V2,status:'UNPROVEN',reason:'EXISTING_GRANT_REFRESH_FAILED',refreshHttpStatus:refresh.status,observedAt}
  const token=refreshed.access_token
  const userRead=await fetchImpl(new URL('/commerce/identity/v1/user/',c.identityOrigin),{headers:{Authorization:`Bearer ${token}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})
  const user=record(await userRead.json().catch(()=>({})))
  let identityMatch=userRead.ok&&typeof user.userId==='string'&&ebayProductionAccountFingerprint(user.userId.trim())===c.accountFingerprint
  let tradingIdentityReadAttempted=false
  // Reuse the installed gateway's exact REST/Trading identity reconciliation.
  // A successful REST read with a different identifier is not missing consent.
  if(userRead.ok&&typeof user.userId==='string'&&user.userId.trim()&&!identityMatch){
   tradingIdentityReadAttempted=true
   try{identityMatch=ebayProductionAccountFingerprint(await readEbayTradingUserIdWithAccessToken(token,fetchImpl))===c.accountFingerprint}catch{/* Account remains unproven. */}
  }
  const r=await fetchImpl(endpoint,{method:'POST',headers:basic,
   body:new URLSearchParams({token,token_type_hint:'access_token'}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})
  if(!r.ok)return {status:'UNPROVEN',reason:'OFFICIAL_TOKEN_INTROSPECTION_UNAVAILABLE',httpStatus:r.status,endpoint,observedAt}
  const result=payoutGrantEvidenceV1(await r.json())
  if(!identityMatch)return {...result,version:PAYOUT_GRANT_DIAGNOSTIC_V2,status:'UNPROVEN',reason:'EXISTING_GRANT_IDENTITY_NOT_PROVEN',observedAt,
   existingGrantRefreshPass:true,identityHttpStatus:userRead.status,identityValuePresent:typeof user.userId==='string',accountBindingExact:false,tradingIdentityReadAttempted,
   identityErrors:Array.isArray(user.errors)?user.errors.map(e=>{const x=record(e);return {errorId:typeof x.errorId==='number'?x.errorId:null,domain:typeof x.domain==='string'?x.domain:null,category:typeof x.category==='string'?x.category:null}}):[],
   refreshReturnedScopes:payoutGrantEvidenceV1({active:true,scope:refreshed.scope}).grantedScopes,
   scopeExpansionRequested:false,fundsReadAttempted:false,ownerReauthRequired:null}
  const funds=await fetchImpl('https://apiz.ebay.com/sell/finances/v1/seller_funds_summary',{headers:{Authorization:`Bearer ${token}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})
  const fundsBody=record(await funds.json().catch(()=>({})))
  const payout=funds.ok?payoutCurrencyEvidenceV1(fundsBody,true,observedAt):null
  const errors=Array.isArray(fundsBody.errors)?fundsBody.errors.map(e=>{const x=record(e);return {errorId:typeof x.errorId==='number'?x.errorId:null,domain:typeof x.domain==='string'?x.domain:null,category:typeof x.category==='string'?x.category:null}}):[]
  return {...result,version:PAYOUT_GRANT_DIAGNOSTIC_V2,status:result.requiredScopePresent===null?'UNPROVEN':'PROVEN',httpStatus:r.status,endpoint,observedAt,
   existingGrantRefreshPass:true,accountBindingExact:true,tradingIdentityReadAttempted,refreshReturnedScopes:payoutGrantEvidenceV1({active:true,scope:refreshed.scope}).grantedScopes,
   inactiveIntrospectionProvesInvalidToken:false,scopeExpansionRequested:false,fundsHttpStatus:funds.status,fundsErrors:errors,payout}
 }catch{return {status:'UNPROVEN',reason:'OFFICIAL_TOKEN_INTROSPECTION_UNAVAILABLE',endpoint,observedAt}}
}

export function payoutCurrencyEvidenceV1(body:unknown, bound:boolean, observedAt:string) {
 const b=record(body), funds=['totalFunds','availableFunds','processingFunds','fundsOnHold'].map(k=>record(b[k]))
 const currencies=funds.map(f=>f.convertedToCurrency??f.currency)
 const valid=bound && currencies.every(c=>typeof c==='string' && /^[A-Z]{3}$/.test(c)) && new Set(currencies).size===1
 return {status:valid?'PROVEN':'UNPROVEN',currency:valid?currencies[0] as string:null,accountBindingExact:bound,
  source:'https://apiz.ebay.com/sell/finances/v1/seller_funds_summary',
  authorityClass:'CURRENT_PENDING_PAYOUT_FUNDS_CURRENCY',observedAt,
  reason:valid?null:'MISSING_OR_CONFLICTING_PAYOUT_FUNDS_CURRENCY',
  bankDetailsIncluded:false,amountsIncluded:false}
}

/** Fixed official GET and OAuth only. No token persistence or retry. */
export async function readPublicationPayoutCurrencyV1(fetchImpl:typeof fetch=fetch) {
 const c=getEbayDraftOnlyGatewayConfig(), observedAt=new Date().toISOString()
 const unavailable=(reason:string,httpStatus:number|null=null)=>({status:'UNPROVEN',currency:null,accountBindingExact:false,reason,httpStatus,observedAt})
 if(c.target!=='PRODUCTION'||!c.oauthConfigured||!c.identityBound||!c.identityConfigurationConsistent)return unavailable('PAYOUT_ACCOUNT_AUTHORITY_UNAVAILABLE')
 try {
  const oauth=await fetchImpl(c.tokenEndpoint,{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({grant_type:'refresh_token',refresh_token:c.refreshToken,scope:'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.finances https://api.ebay.com/oauth/api_scope/commerce.identity.readonly'}),
   cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})
  if(!oauth.ok){
   const code=record(await oauth.json().catch(()=>({}))).error
   return {...unavailable('PAYOUT_OAUTH_GRANT_UNAVAILABLE',oauth.status),oauthError:['invalid_scope','invalid_grant','invalid_client','unauthorized_client','unsupported_grant_type'].includes(String(code))?String(code):'UNCLASSIFIED_OAUTH_ERROR'}
  }
  const token=record(await oauth.json()).access_token
  if(typeof token!=='string'||!token)return unavailable('PAYOUT_OAUTH_TOKEN_MISSING')
  const read=async(url:string)=>fetchImpl(url,{method:'GET',headers:{Authorization:`Bearer ${token}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})
  const identity=await read(new URL('/commerce/identity/v1/user/',c.identityOrigin).href)
  if(!identity.ok)return unavailable('PAYOUT_IDENTITY_READ_UNAVAILABLE',identity.status)
  const user=record(await identity.json())
  if(typeof user.userId!=='string'||ebayProductionAccountFingerprint(user.userId)!==c.accountFingerprint||c.expectedUserId&&user.userId!==c.expectedUserId)return unavailable('PAYOUT_IDENTITY_MISMATCH')
  const funds=await read('https://apiz.ebay.com/sell/finances/v1/seller_funds_summary')
  if(!funds.ok)return unavailable('PAYOUT_FUNDS_READ_UNAVAILABLE',funds.status)
  return {...payoutCurrencyEvidenceV1(await funds.json(),true,observedAt),httpStatus:funds.status}
 }catch{return unavailable('PAYOUT_AUTHORITY_TEMPORARILY_UNAVAILABLE')}
}
