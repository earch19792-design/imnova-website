import { getEbayDraftOnlyGatewayConfig } from './ebay-draft-only-gateway'
import { ebayProductionAccountFingerprint } from './ebay-seller-account-scope'
import { keywordRecord as record } from '../seller-os/keyword-intelligence-handoff-v1'

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
