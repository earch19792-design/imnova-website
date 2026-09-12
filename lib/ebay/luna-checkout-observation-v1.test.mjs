import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { canonicalDestinationMatchStatusV1 as match, checkoutObservationV1 as project, compactCheckoutObservationV1 as compact, lunaShippingAutoNavigationCapableV1 as autoNavigationCapable } from './luna-checkout-observation-v1.ts'
import { shippingProbeDiagnosticV1 } from '../seller-os/shipping-probe-diagnostic-v1.ts'
const markers=['shipToMarker','shippingMarker','subtotalMarker','totalMarker','payNowMarker']
const ready={version:'LUNA_CHECKOUT_OBSERVATION_V1',checkoutTabFound:true,checkoutHostMatch:true,checkoutContentScriptResponded:true,checkoutPageDetected:true,shopPayMarkersEvaluated:true,shopPayRequiredMarkersReady:true,checkoutDomReady:true,observedMarkers:markers}
test('valid binding recovery is NOT_EVALUATED; only an explicit comparison proves MATCH/MISMATCH',()=>{
 for(const value of [undefined,null,false,true,{bound:true}])assert.equal(match(value),'NOT_EVALUATED')
 assert.equal(match('MATCH'),'MATCH');assert.equal(match('MISMATCH'),'MISMATCH')
})
test('missing checkout tab permits automatic job navigation while runtime failures remain blocked',()=>{
 const base={contract:'LUNA_CAPTURE_READ_ONLY_PROBE_V1',canonicalBindingPresent:true,
  checkoutObservation:{version:'LUNA_CHECKOUT_OBSERVATION_V1',checkoutTabFound:false,
   checkoutHostMatch:false,checkoutInjectionRequested:false,checkoutContentScriptResponded:false,
   checkoutPageDetected:false,shopPayMarkersEvaluated:false,shopPayRequiredMarkersReady:false,
   checkoutDomReady:false,observedMarkers:[]}}
 assert.equal(autoNavigationCapable(base),true)
 for(const recoveryBlockedReason of ['FRAME_UNAVAILABLE','CONTENT_SCRIPT_NO_RESPONSE','HOST_PERMISSION_DENIED']){
  assert.equal(autoNavigationCapable({...base,checkoutObservation:{...base.checkoutObservation,
   checkoutTabFound:true,checkoutHostMatch:true,recoveryBlockedReason}}),false)
 }
 assert.equal(autoNavigationCapable({...base,canonicalBindingPresent:false}),false)
})
test('silence, failed injection, page absence and evaluated missing markers are distinct',()=>{
 const cases=[['NO_CHECKOUT_TAB',{checkoutTabFound:false}],['HOST_MISMATCH',{checkoutHostMatch:false}],['CONTENT_SCRIPT_NO_RESPONSE',{checkoutContentScriptResponded:false}],['INJECTION_FAILED',{checkoutInjectionRequested:true,checkoutInjectionApiSucceeded:false}],['CHECKOUT_PAGE_NOT_DETECTED',{checkoutPageDetected:false}],['REQUIRED_MARKERS_MISSING',{observedMarkers:markers.slice(1)}]]
 for(const [reason,change] of cases){const result=project({...ready,...change});assert.equal(result.checkoutNotReadyReason,reason);assert.equal(result.checkoutDomReady,false)}
 assert.equal(project(ready).checkoutNotReadyReason,'READY')
})
test('no response means markers NOT evaluated, not five falsely missing markers',()=>{
 const result=project({...ready,checkoutContentScriptResponded:false})
 assert.equal(result.shopPayMarkersEvaluated,false);assert.deepEqual(result.missingMarkers,[])
 assert.equal(project({...ready,observedMarkers:markers.slice(1)}).missingMarkers[0],'shipToMarker')
})
test('READY text, thumbnail, unsupported fields and older probes cannot supply current observation',()=>{
 assert.equal(project({checkoutNotReadyReason:'READY'}),null)
 const result=project({...ready,observedMarkers:[],checkoutNotReadyReason:'READY',destination:'private',url:'private'})
 assert.equal(result.checkoutDomReady,false);assert.doesNotMatch(JSON.stringify(result),/private/)
 const probe={contract:'LUNA_CAPTURE_READ_ONLY_PROBE_V1',observedAt:new Date().toISOString(),canonicalBindingPresent:true,checkoutDomReady:false,captureAvailable:false}
 assert.equal(shippingProbeDiagnosticV1(probe).reason,'CHECKOUT_DIAGNOSTIC_NOT_REPORTED')
 assert.equal(shippingProbeDiagnosticV1({...probe,checkoutObservation:ready}),null)
 assert.equal(shippingProbeDiagnosticV1({...probe,checkoutDomReady:true,captureAvailable:true,checkoutObservation:ready}).captureAuthorized,false)
})
const source=readFileSync(new URL('../../tools/browser-extensions/luna-shipping-capture/background.js',import.meta.url),'utf8')
const functions=source.slice(source.indexOf('function safeEligibilityResponse'),source.indexOf('// Independent read-only capability observation.'))
async function observe(response,throws=false){
 const context={BIND_ELIGIBILITY_CONTRACT:'LUNA_BIND_ELIGIBILITY_PROBE_V1',BIND_ELIGIBILITY_PROBE:'probe',BIND_TOP_FRAME_TIMEOUT_MS:25000,boundedBindStep:p=>p,sendTabMessage:async()=>{if(throws)throw Error('NO_RESPONSE');return response}}
 runInNewContext(functions+';globalThis.probe=probeBindingCapability;globalThis.view=checkoutObservationV1',context)
 const p=await context.probe(7);return context.view(true,p)
}
const answer={contractVersion:'LUNA_BIND_ELIGIBILITY_PROBE_V1',checkoutHostClassification:'SHOP_PAY_CHECKOUT_HOST',eligible:true,checkoutPageDetected:true,...Object.fromEntries(markers.map(k=>[k,true]))}
test('actual background probe retains response/missing marker distinction without navigation, cart or capture calls',async()=>{
 assert.equal((await observe(null,true)).checkoutNotReadyReason,'CONTENT_SCRIPT_NO_RESPONSE')
 assert.equal((await observe({})).checkoutNotReadyReason,'CONTENT_SCRIPT_RESPONSE_INVALID')
 const missing=await observe({...answer,eligible:false,shippingMarker:false})
 assert.equal(missing.checkoutNotReadyReason,'REQUIRED_MARKERS_MISSING');assert.equal(missing.shopPayMarkersEvaluated,true)
 assert.deepEqual(Array.from(missing.missingMarkers),['shippingMarker'])
 const current=await observe(answer);assert.equal(current.checkoutDomReady,true)
 assert.equal(current.productIdentityStatus,'NOT_EVALUATED');assert.equal(current.quantityIdentityStatus,'NOT_EVALUATED')
 assert.equal(current.checkoutInjectionApiSucceeded,null)
})
test('probe stays read-only; certified acquisition still requires fresh capability and its bounded permit',()=>{
 const probe=source.slice(source.indexOf('async function reportCaptureCapability'),source.indexOf('async function requestDestinationOperationFromTab'))
 assert.doesNotMatch(probe,/startJob\(|fetch\(|\.update\(|\.create\(|\.click\(|setInterval\(/)
 const page=readFileSync(new URL('../../app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx',import.meta.url),'utf8')
 const acquisition=page.slice(page.indexOf('const attemptProductionAcquisition ='),page.indexOf('discoveryInFlight = true',page.indexOf('const attemptProductionAcquisition =')))
 assert.match(acquisition,/!lunaShippingAutoNavigationCapableV1\(captureProbe\)/)
 assert.match(page,/setCaptureAvailable\(automaticNavigationCapable\)/)
 assert.match(page,/automaticNavigationCapable && !busy/)
 assert.match(acquisition,/captureNextAttemptAt/);assert.match(acquisition,/acquireClaimPermit/)
 assert.match(acquisition,/circuitBreakerState/);assert.match(acquisition,/serverClaimLeaderRef/)
 assert.doesNotMatch(page,/CANONICAL_DESTINATION_MATCH=\{String\(canonicalDestinationMatch\)\}/)
})

test('durable diagnostic roundtrip fits existing SQL byte limit and preserves unknown injection evidence',()=>{
 for(const d of [ready,{...ready,checkoutContentScriptResponded:false},{...ready,observedMarkers:markers.slice(1)}]){
  const expected=project(d), stored=compact(d)
  assert.deepEqual(project(stored),expected)
  assert.equal(project(stored).checkoutInjectionApiSucceeded,null)
  const p={contract:'LUNA_CAPTURE_READ_ONLY_PROBE_V1',observedAt:new Date().toISOString(),canonicalBindingPresent:true,checkoutDomReady:expected.checkoutDomReady,captureAvailable:expected.checkoutDomReady,checkoutObservation:d}
  const result=shippingProbeDiagnosticV1(p)
  // JSONB adds spaces; allow that overhead explicitly instead of measuring compact JSON only.
  assert.ok(Buffer.byteLength(JSON.stringify(result,null,1))<1024)
 }
 assert.equal(project({version:'LUNA_CHECKOUT_OBSERVATION_V1',encoding:'BOOLEAN_VECTOR_V1',facts:[],markers:[]}),null)
})
