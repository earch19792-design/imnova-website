// Explicit one-shot production-build certification, never a scheduler/worker.
// Uses only the build's short-lived platform workload assertion. No credential
// is read from a file, printed, persisted, or transferred from PREPROD.
if(process.env.SELLER_OS_STOCK_PRODUCTION_CERTIFICATION!=='1')process.exit(0)
const project='prj_a6N1XDfeaKAiR5QmmNFYF16Nmqe5'
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_PROJECT_ID!==project){
 throw Error('PRODUCTION_STOCK_CERTIFICATION_BUILD_IDENTITY_REQUIRED')
}
const assertion=process.env.VERCEL_OIDC_TOKEN
if(!assertion)throw Error('PRODUCTION_WORKLOAD_ASSERTION_MISSING')
const results=[]
for(const item of ['366643126310','366662788140',null]){
 const url=new URL('https://imnova-website-z1qh.vercel.app/api/runtime/stockguard-read')
 url.searchParams.set('capability','STOCKGUARD_EVALUATION');if(item)url.searchParams.set('itemId',item)
 const response=await fetch(url,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
  headers:{'x-seller-os-caller':'SELLER_OS_STOCKGUARD_MONITOR_V1','x-seller-os-service-assertion':assertion}})
 const body=await response.json()
 for(const r of body.reads??[])console.log('PRODUCTION_STOCK_AUTH_READ='+JSON.stringify({itemId:item,table:r.table,method:r.method,httpStatus:r.httpStatus,
   requestAuthMode:r.requestAuthMode,authorizationHeaderPresent:r.authorizationHeaderPresent,
   apiKeyHeaderPresent:r.apiKeyHeaderPresent,authorizationMatchesApiKey:r.authorizationMatchesApiKey,
   authHeadersMatchFirstRequest:r.authHeadersMatchFirstRequest,jwtRole:r.jwtRole,
   jwtIssuerMatch:r.jwtIssuerMatch,jwtAudienceMatch:r.jwtAudienceMatch,jwtProjectMatch:r.jwtProjectMatch,
   upstreamErrorCode:r.upstreamErrorCode,permissionDeniedOnRequestedTable:r.permissionDeniedOnRequestedTable,
   http401Origin:r.http401Origin}))
 // Whitelist structured fields, never echo arbitrary upstream messages.
 results.push({itemId:item,status:response.status,
  error:typeof body.error==='string'&&/^[A-Z_]+(?::[a-z_]+)?$/.test(body.error)?body.error:null,
  authenticated:body.authority?.serviceAuthenticated===true,
  canonicalBinding:body.authority?.productionAccountBindingCanonical===true,
  cohortComplete:body.cohortComplete===true,
  listingCount:(body.listings??[]).length,
  freshInStockCount:(body.listings??[]).filter(r=>r.supplierAvailability==='IN_STOCK'&&r.stockFreshness==='FRESH').length,
  listings:(body.listings??[]).filter(r=>['366643126310','366662788140'].includes(r.itemId)).slice(0,2).map(r=>({itemId:r.itemId,liveStatus:r.liveStatus,supplierLinkage:r.supplierLinkage,
   components:r.components,supplierAvailability:r.supplierAvailability,stockFreshness:r.stockFreshness,
   stockGuardState:r.stockGuardState,limitationCode:r.limitationCode})),
  marketplaceWrites:0})
 // A shared schema/authentication blocker affects the whole cohort. Do not
 // multiply failing reads to prove the same missing prerequisite three times.
 if(!response.ok)break
}
console.log('PRODUCTION_STOCK_SERVICE_READBACK='+JSON.stringify({observedAt:new Date().toISOString(),results,
 secretValuesIncluded:false,physicalPass:results.length===3&&results.every(r=>r.status===200&&r.authenticated&&r.cohortComplete)}))
