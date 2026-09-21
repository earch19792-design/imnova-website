import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {webcrypto} from 'node:crypto'
import {buildCheckoutObserver} from '../../tools/build-luna-checkout-observer.mjs'
import {checkoutObservationV1 as project,compactCheckoutObservationV1 as compact} from './luna-checkout-observation-v1.ts'
import {shippingProbeDiagnosticV1} from '../seller-os/shipping-probe-diagnostic-v1.ts'
const dir=new URL('../../tools/browser-extensions/luna-shipping-capture/',import.meta.url)
const background=readFileSync(new URL('background.js',dir),'utf8')
const content=readFileSync(new URL('content.js',dir),'utf8')
const observer=readFileSync(new URL('checkout-observation.js',dir),'utf8')
const functions=background.slice(background.indexOf('// Observation-only recovery.'),background.indexOf('// Independent read-only capability observation.'))
const markers=['shipToMarker','shippingMarker','subtotalMarker','totalMarker','payNowMarker']
function worker(options={}){
 let loaded=options.loaded??false, now=1000000, injections=0, markerCalls=0, hellos=0
 const context={URL,crypto:webcrypto,Map,Date:{now:()=>now},activeJob:false,
  EXTENSION_BUILD_VERSION:'1.0.57',SHOP_APP_HOST_PATTERN:'https://shop.app/*',MAX_BIND_DISCOVERY_TABS:200,
  BIND_CONTENT_RESPONSE_TIMEOUT_MS:5000,BIND_TOP_FRAME_TIMEOUT_MS:25000,
  BIND_ELIGIBILITY_CONTRACT:'LUNA_BIND_ELIGIBILITY_PROBE_V1',BIND_ELIGIBILITY_PROBE:'probe',boundedBindStep:p=>p,
  sendTabMessage:async(tab,message)=>{
   assert.equal(tab,7)
   if(message.type==='SELLER_OS_LUNA_CHECKOUT_OBSERVER_HELLO_V1'){
    hellos++;if(!loaded || options.legacy)throw Error('STALE_CHANNEL')
    return {contract:'LUNA_CHECKOUT_OBSERVER_HANDSHAKE_V1',nonce:options.badNonce?'wrong':message.nonce,version:'1.0.57',loaded:true}
   }
   assert.equal(message.type,'probe');if(!loaded)throw Error('NO_RECEIVER');markerCalls++
   return {contractVersion:'LUNA_BIND_ELIGIBILITY_PROBE_V1',checkoutHostClassification:'SHOP_PAY_CHECKOUT_HOST',eligible:!options.missing,
    checkoutPageDetected:true,...Object.fromEntries(markers.map(k=>[k,k!==options.missing]))}
  },chrome:{runtime:{},permissions:{contains:(q,cb)=>cb(options.permission!==false)},
   webNavigation:{getFrame:(q,cb)=>{assert.equal(q.frameId,0);cb({parentFrameId:options.wrongFrame?0:-1,documentId:'doc',url:options.wrongHost?'https://other.example/':'https://shop.app/checkout'})}},
   scripting:{executeScript:async payload=>{
    injections++;assert.deepEqual(JSON.parse(JSON.stringify(payload)),{target:{tabId:7,documentIds:['doc']},world:'ISOLATED',files:['checkout-observation.js']})
    loaded=!options.noLoad
    if(options.fail)throw Error(options.fail)
    return [{frameId:options.wrongResult?2:0,documentId:'doc'}]
   }}}}
 runInNewContext(functions+';globalThis.observe=observeRecoverableCheckout;globalThis.view=checkoutObservationV1',context)
 return {context,run:async(allowance={used:false})=>context.view(true,await context.observe(7,allowance)),
  counts:()=>({injections,markerCalls,hellos}),advance:()=>{now+=900001},stale:()=>{loaded=false}}
}
test('absent script recovers once in exact top-frame document; ACK precedes marker evaluation',async()=>{
 const w=worker(),d=await w.run();assert.equal(d.checkoutInjectionApiSucceeded,true);assert.equal(d.checkoutScriptBootstrapAck,true)
 assert.equal(d.checkoutContentScriptPortConnected,true);assert.equal(d.checkoutContentScriptResponded,true);assert.equal(d.checkoutDomReady,true)
 assert.deepEqual(w.counts(),{injections:1,markerCalls:1,hellos:2})
})
test('loaded script has no injection; stale message channel reconnects boundedly',async()=>{
 const w=worker({loaded:true});assert.equal((await w.run()).checkoutInjectionRequested,false)
 w.stale();assert.equal((await w.run()).checkoutScriptBootstrapAck,true);assert.equal(w.counts().injections,1)
 await w.run();assert.equal(w.counts().injections,1)
})
test('legacy loaded static observer responds without duplicate injection',async()=>{
 const w=worker({loaded:true,legacy:true}),d=await w.run();assert.equal(d.checkoutDomReady,true);assert.equal(d.checkoutInjectionRequested,false);assert.equal(w.counts().injections,0)
})
test('wrong frame, wrong host and missing permission never inject or evaluate markers',async()=>{
 for(const options of [{wrongFrame:true},{wrongHost:true},{permission:false}]){
  const w=worker(options),d=await w.run();assert.equal(d.checkoutDomReady,false);assert.equal(d.shopPayMarkersEvaluated,false)
  assert.equal(w.counts().injections,0);assert.equal(w.counts().markerCalls,0)
 }
})
test('injection errors are structured, preserve channel readback and never retry blindly',async()=>{
 const w=worker({fail:'Cannot access page containing private-address',noLoad:true}),d=await w.run()
 assert.equal(d.checkoutInjectionApiSucceeded,false);assert.equal(d.checkoutInjectionErrorCode,'HOST_PERMISSION_DENIED')
 assert.equal(d.checkoutNotReadyReason,'INJECTION_FAILED');assert.equal(d.shopPayMarkersEvaluated,false)
 assert.doesNotMatch(JSON.stringify(d),/private-address/)
 await w.run();assert.equal(w.counts().injections,1);assert.equal(w.counts().markerCalls,0)
 w.advance();await w.run();assert.equal(w.counts().injections,2)
})
test('ambiguous injection reads back handshake; wrong injection frame never authorizes readiness',async()=>{
 for(const options of [{fail:'timeout'},{wrongResult:true}]){
  const w=worker(options),d=await w.run();assert.equal(d.checkoutScriptBootstrapAck,true)
  assert.equal(d.checkoutContentScriptResponded,false);assert.equal(d.checkoutDomReady,false);assert.equal(w.counts().injections,1)
  assert.equal(w.counts().markerCalls,0)
 }
})
test('one probe allowance cannot inject multiple tabs; active work prevents recovery',async()=>{
 const w=worker();assert.equal((await w.run({used:true})).recoveryBlockedReason,'OBSERVER_RECOVERY_BACKOFF')
 w.context.activeJob=true;assert.equal((await w.run()).checkoutDomReady,false);assert.equal(w.counts().injections,0)
})
test('response with missing markers is distinct from script silence; no DOM drift inferred',async()=>{
 const d=await worker({loaded:true,missing:'shippingMarker'}).run()
 assert.equal(d.checkoutNotReadyReason,'REQUIRED_MARKERS_MISSING');assert.equal(d.shopPayMarkersEvaluated,true)
 assert.deepEqual(Array.from(d.missingMarkers),['shippingMarker']);assert.equal(d.markerContractDrift,null)
 const silent=await worker({noLoad:true}).run();assert.equal(silent.shopPayMarkersEvaluated,false);assert.deepEqual(Array.from(silent.missingMarkers),[])
})
test('recovery diagnostics fit existing durable limit, roundtrip, and cannot leak raw errors',async()=>{
 for(const opts of [{},{noLoad:true,fail:'Cannot access secret'},{permission:false}]){
  const d=await worker(opts).run(),p=project(d)
  assert.deepEqual(project(compact(d)),p)
  const durable=shippingProbeDiagnosticV1({contract:'LUNA_CAPTURE_READ_ONLY_PROBE_V1',observedAt:new Date().toISOString(),canonicalBindingPresent:true,
   checkoutDomReady:p.checkoutDomReady,captureAvailable:p.checkoutDomReady,checkoutObservation:d})
  assert.ok(Buffer.byteLength(JSON.stringify(durable,null,1))<1024,JSON.stringify(durable,null,1))
 }
})
test('generated observer reuses unchanged detector; double injection registers once and has no capture side effects',()=>{
 assert.equal(observer,buildCheckoutObserver(content))
 const listeners=[],calls=[]
 const context={URL,location:{hostname:'shop.app',pathname:'/checkout',origin:'https://shop.app',href:'https://shop.app/checkout'},
  chrome:{runtime:{id:'extension',getManifest:()=>({version:'1.0.57'}),sendMessage:()=>calls.push('FORBIDDEN'),onMessage:{addListener:f=>listeners.push(f)}}},
  document:{querySelectorAll:()=>[],querySelector:()=>null},console}
 runInNewContext(observer,context);runInNewContext(observer,context)
 assert.equal(listeners.length,1);assert.deepEqual(calls,[])
 let ack;listeners[0]({type:'SELLER_OS_LUNA_CHECKOUT_OBSERVER_HELLO_V1',nonce:'fresh'},{},r=>{ack=r})
 assert.equal(ack.nonce,'fresh');assert.equal(ack.loaded,true)
 assert.equal(listeners[0]({type:'BIND_CANONICAL_DESTINATION_EXECUTE_V1'},{},()=>calls.push('FORBIDDEN')),false)
 assert.deepEqual(calls,[])
 assert.doesNotMatch(functions,/startJob\(|recoverActiveJob\(|fetch\(|\.click\(|tabs\.update|tabs\.create|setInterval\(/)
 assert.match(content,/LUNA_PURCHASE_BOUNDARY_REACHED/)
})
