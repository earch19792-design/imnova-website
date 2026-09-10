import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {webcrypto} from 'node:crypto'
import {createLunaShippingPortLeadershipGateV1,createLunaCaptureProbeRecorderV1} from './luna-shipping-port-lifecycle-v1.ts'
const read=p=>readFileSync(p,'utf8')

test('FOLLOWER_WAIT_IS_EVENT_DRIVEN / ONE_LEADER_ONE_PORT / CANCELLED_PAGE_NEVER_CONNECTS',async()=>{
 const a=new AbortController(),gate=createLunaShippingPortLeadershipGateV1(a.signal)
 let connects=0
 const waiting=gate.wait().then(allowed=>{if(allowed)connects++})
 for(let i=0;i<900;i++)await Promise.resolve()
 assert.equal(connects,0)
 gate.setLeader(true);await waiting;assert.equal(connects,1)
 gate.setLeader(true);assert.equal(connects,1)
 const b=new AbortController(),follower=createLunaShippingPortLeadershipGateV1(b.signal)
 const pending=follower.wait();b.abort();assert.equal(await pending,false)
})

test('UNAVAILABLE_PROBE_DURABLE_WITHOUT_CLAIM / HEARTBEATS_DO_NOT_REPEAT_RECEIPT',async()=>{
 let now=Date.now(),leader=false,posts=0
 const recorder=createLunaCaptureProbeRecorderV1({now:()=>now,canPersist:()=>leader,retryDelayMs:()=>900000,persist:async p=>{posts++;assert.equal(p.captureAvailable,false);return true}})
 const probe={contract:'LUNA_CAPTURE_READ_ONLY_PROBE_V1',observedAt:new Date(now).toISOString(),captureAvailable:false}
 assert.equal(recorder.receive(probe),true);await recorder.flush();assert.equal(posts,0)
 leader=true;await Promise.all([recorder.flush(),recorder.flush()]);assert.equal(posts,1)
 for(let i=0;i<15;i++){now+=60000;await recorder.flush()}
 assert.equal(posts,1);assert.equal(recorder.receive(probe),false)
})

test('PROBE_FAILURE_BACKOFF / NEWEST_TRANSITION_PRESERVED / STALE_PROOF_REJECTED',async()=>{
 let now=Date.now(),posts=0,fail=true
 const recorder=createLunaCaptureProbeRecorderV1({now:()=>now,canPersist:()=>true,retryDelayMs:()=>900000,persist:async()=>{posts++;if(fail)throw Error('429');return true}})
 const probe=()=>({contract:'LUNA_CAPTURE_READ_ONLY_PROBE_V1',observedAt:new Date(now).toISOString(),captureAvailable:true})
 recorder.receive(probe());await recorder.flush()
 for(let i=0;i<14;i++){now+=60000;recorder.receive(probe());await recorder.flush()}
 assert.equal(posts,1)
 fail=false;now+=60000;recorder.receive(probe());assert.equal(await recorder.flush(),true);assert.equal(posts,2)
 assert.equal(recorder.receive({...probe(),observedAt:new Date(now-600000).toISOString()}),false)
 assert.equal(recorder.receive({...probe(),observedAt:new Date(now+120000).toISOString()}),false)
})

test('REAL_EXTENSION_SECOND_PORT_REJECTED_BEFORE_HANDSHAKE / ID_ORIGIN_CONTRACT_UNCHANGED',()=>{
 const manifest=JSON.parse(read('tools/browser-extensions/luna-shipping-capture/manifest.json'))
 let connect
 const event={addListener(){}}
 const chrome={runtime:{id:'mhpkojahbbfdgodeaecggpjaplllgclk',lastError:null,getManifest:()=>manifest,onConnectExternal:{addListener(fn){connect=fn}},onMessageExternal:event,onInstalled:event,onMessage:event},tabs:{onRemoved:event,onUpdated:event},storage:{local:{}},webNavigation:{onCommitted:event,onCompleted:event}}
 runInNewContext(read('tools/browser-extensions/luna-shipping-capture/background.js'),{chrome,crypto:webcrypto,URL,TextDecoder,TextEncoder,Uint8Array,atob,btoa,setTimeout,clearTimeout})
 const port=(url='https://imnova-seller-os-preprod.vercel.app/admin/ebay/luna-shipping-capture')=>{
  const p={name:'SELLER_OS_LUNA_SHIPPING_CAPTURE_V1',sender:{url},disconnected:false,posted:[],handler:null,disconnect(){this.disconnected=true},postMessage(v){this.posted.push(v)},onDisconnect:event}
  p.onMessage={addListener(fn){p.handler=fn}};return p
 }
 const invalid=port('https://untrusted.invalid/');connect(invalid);assert.equal(invalid.disconnected,true)
 const first=port();connect(first);first.handler({type:'SELLER_OS_LUNA_SHIPPING_PORT_HANDSHAKE_V1',portGeneration:1})
 assert.equal(first.posted.at(-1).type,'LUNA_SHIPPING_PORT_HANDSHAKE_ACK_V1')
 assert.equal(first.posted.at(-1).portCurrent,true)
 const second=port();connect(second)
 assert.equal(second.disconnected,true);assert.equal(second.handler,null);assert.equal(second.posted.length,0)
 assert.equal(first.disconnected,false)
})

test('PAGE_ORDER_AND_PROBE_WIRING / HISTORICAL_PASS_SEPARATE / NO_NEW_POLLER',()=>{
 const page=read('app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx')
 assert.match(page,/await portLeadership.wait\(\)[\s\S]*?detectAndWakeLunaShippingExtensionV1/)
 assert.match(page,/acquireCurrentPort = async[\s\S]*?await portLeadership.wait\(\)[\s\S]*?runtime.connect/)
 const ack=page.slice(page.indexOf('if (message?.type === PORT_HANDSHAKE_ACK)'),page.indexOf('if (message?.type === "LUNA_CAPTURE_CAPABILITY_STATE_V1")'))
 assert.match(ack,/readyPortGeneration = sourceGeneration[\s\S]*?SELLER_OS_GET_LUNA_CAPTURE_CAPABILITY_V1/)
 const heartbeat=page.slice(page.indexOf('const heartbeat = () =>'),page.indexOf('}, [connected])'))
 assert.doesNotMatch(heartbeat,/GET_LUNA_CAPTURE_CAPABILITY|resolve_jobs|loadJobs|attemptProductionAcquisition|runtime.connect/)
 assert.equal((page.match(/setInterval\(/g)||[]).length,1)
 assert.match(page,/setHistoricalTraceEvents\(recovered/)
 assert.doesNotMatch(page,/traceEvents = recovered/)
 assert.match(page,/Última captura certificada: PASS/)
 assert.match(page,/<details[\s\S]*?Ver detalles[\s\S]*?CURRENT_BLOCKER/)
})
