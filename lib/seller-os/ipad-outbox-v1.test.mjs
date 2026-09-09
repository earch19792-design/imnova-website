import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parseOutboxIntentV1,IPAD_OUTBOX_VERSION,stableOutboxJsonV1 } from './ipad-outbox-contract-v1.ts'
import { executeOutboxOperationV1 } from './ipad-sync-engine-v1.ts'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const policy={minRate:3,maxRate:5,minProfit:8,minMargin:15,mode:'MANUAL',window:'NOW',timeZone:'UTC',startsAt:null,endsAt:null}
const intent={version:IPAD_OUTBOX_VERSION,kind:'ADS_POLICY',itemId:'366582671136',listingTitle:'Necklace',generationId:'draft1',createdAt:'2026-09-09T00:00:00Z',baseVersionHash:null,baseObservedAt:null,idempotencyKey:`ipados:v1:${'a'.repeat(64)}`,requestedChanges:{policy}}
test('NO_SECRET_LOCAL_STORAGE_PASS: strict draft allowlist rejects credentials, tokens and signed URLs',()=>{
 assert.deepEqual(parseOutboxIntentV1(intent),intent)
 for(const key of ['access_token','ebayCredentials','openaiKey','authorization','headers','session'])assert.throws(()=>parseOutboxIntentV1({...intent,[key]:'secret'}))
 for(const secret of ['Bearer abc','eyJ123456789012345.abc.signature','sk-proj-12345678901234567890','https://example.com/image?token=secret'])
  assert.throws(()=>parseOutboxIntentV1({...intent,listingTitle:secret}),/UNSAFE_TEXT/)
 assert.throws(()=>parseOutboxIntentV1({...intent,requestedChanges:{...intent.requestedChanges,access_token:'secret'}}))
 assert.equal(stableOutboxJsonV1({b:2,a:1}),stableOutboxJsonV1({a:1,b:2}))
 assert.deepEqual(JSON.parse(stableOutboxJsonV1(intent)),intent)
})
function fixture(overrides={}){
 const events=[],row={state:'LEASED',dispatchCount:0,baseHash:'base',kind:'IMAGE_DRAFT',...overrides}
 let open=true,applied=false,drift=false,safe=true,failAfterWrite=false,approved=true,official=true
 const d={authority:async()=>{events.push('authority');return{approved,reason:approved?null:'OWNER_VISUAL_REVIEW_REQUIRED'}},quota:async()=>{events.push('quota');return{open}},
 readback:async()=>{events.push('readback');return{official,baseHash:drift?'changed':'base',matchesIntent:applied,safetyPass:safe,reason:null,receipt:{official:true}}},
 finish:async(state,reason,proof)=>{events.push(`finish:${state}`);row.state=state;row.reason=reason;row.proof=proof},
 markDispatch:async()=>{events.push('mark');if(row.dispatchCount)throw Error('DUPLICATE');row.dispatchCount=1;row.state='UNKNOWN_COMMIT'},
 execute:async()=>{events.push('write');applied=true;if(failAfterWrite)throw Error('TIMEOUT');return{writes:1,mediaWrites:1}}}
 return{row,d,events,set:(values)=>{if('open'in values)open=values.open;if('drift'in values)drift=values.drift;if('safe'in values)safe=values.safe;if('applied'in values)applied=values.applied;if('failAfterWrite'in values)failAfterWrite=values.failAfterWrite;if('approved'in values)approved=values.approved;if('official'in values)official=values.official}}
}
test('EBAY_QUOTA_HOLD_DRAFT_PASS and POST_QUOTA_AUTO_RESUME_PASS: same durable operation resumes with fresh official preflight',async()=>{
 const f=fixture();f.set({open:false});await executeOutboxOperationV1(f.row,f.d)
 assert.equal(f.row.state,'PENDING_EBAY_SYNC');assert.ok(!f.events.includes('readback'));assert.equal(f.row.dispatchCount,0)
 f.set({open:true});const r=await executeOutboxOperationV1(f.row,f.d)
 assert.equal(r.writes,1);assert.equal(f.row.state,'SYNCED')
 assert.deepEqual(f.events.slice(3),['authority','quota','readback','mark','write','readback','finish:SYNCED'])
})
test('STALE_DRAFT_REVALIDATION_PASS: drift, missing base and safety failure cannot write',async()=>{
 for(const setup of [f=>f.set({drift:true}),f=>f.set({safe:false}),f=>{f.row.baseHash=null}]){
 const f=fixture();setup(f);await executeOutboxOperationV1(f.row,f.d);assert.equal(f.row.state,'ATTENTION');assert.ok(!f.events.includes('write'))}
})
test('DUPLICATE_SYNC_BLOCKED_PASS and UNKNOWN_COMMIT_READBACK_PASS: accepted response loss resolves by readback only',async()=>{
 const f=fixture();f.set({failAfterWrite:true});await executeOutboxOperationV1(f.row,f.d)
 assert.equal(f.row.state,'UNKNOWN_COMMIT');assert.equal(f.row.dispatchCount,1)
 await executeOutboxOperationV1(f.row,f.d);assert.equal(f.row.state,'SYNCED');assert.equal(f.events.filter(e=>e==='write').length,1)
 const g=fixture({state:'UNKNOWN_COMMIT',dispatchCount:1});await executeOutboxOperationV1(g.row,g.d)
 assert.equal(g.row.state,'ATTENTION');assert.ok(g.events.includes('readback'));assert.ok(!g.events.includes('write'))
})
test('draft image QA and an old Ads policy never grant spending authority',async()=>{
 const f=fixture();f.set({approved:false,open:false});await executeOutboxOperationV1(f.row,f.d)
 assert.equal(f.row.state,'PENDING_EBAY_SYNC');assert.ok(!f.events.includes('quota'));assert.ok(!f.events.includes('write'))
 const ads=fixture({kind:'ADS_POLICY'});await executeOutboxOperationV1(ads.row,ads.d);assert.equal(ads.row.state,'ATTENTION');assert.ok(!ads.events.includes('write'))
})
test('NO_CODEX_RUNTIME_DEPENDENCY_PASS: normal server runtime owns durable claims; browser uses lifecycle recovery only',()=>{
 const runtime=readFileSync(new URL('./operational-integrity-runtime-v1.ts',import.meta.url),'utf8')
 assert.match(runtime,/runIpadOutboxRuntimeV1\(input\)/)
 const worker=readFileSync(new URL('./ipad-sync-runtime-v1.ts',import.meta.url),'utf8')
 assert.match(worker,/seller_os_claim_ipad_outbox_v1/);assert.doesNotMatch(worker,/localStorage|indexedDB|Codex|window\./)
 const local=readFileSync(new URL('../../app/admin/ebay/mayel/local-first.tsx',import.meta.url),'utf8')
 for(const event of ['online','focus','visibilitychange'])assert.ok(local.includes(`"${event}"`))
})

test('manual six-image intent preserves provenance references and resumes with the same guarded executor',async()=>{
 const files=Array.from({length:6},(_,n)=>({id:id(n+1),sha256:String(n+1).repeat(64),mimeType:'image/png',bytes:1200,position:n}))
 const batch={...intent,kind:'IMAGE_UPLOAD',baseVersionHash:`sha256:${'a'.repeat(64)}`,requestedChanges:{taskId:id(7),files,rightsConfirmed:true}}
 assert.deepEqual(parseOutboxIntentV1(batch),batch)
 assert.throws(()=>parseOutboxIntentV1({...batch,requestedChanges:{...batch.requestedChanges,rightsConfirmed:false}}))
 assert.throws(()=>parseOutboxIntentV1({...batch,requestedChanges:{...batch.requestedChanges,files:[...files,files[0]]}}))
 assert.throws(()=>parseOutboxIntentV1({...batch,requestedChanges:{...batch.requestedChanges,files:files.map(f=>({...f,sha256:files[0].sha256}))}}))
 const f=fixture({kind:'IMAGE_UPLOAD'});f.set({open:false});await executeOutboxOperationV1(f.row,f.d)
 assert.equal(f.row.state,'PENDING_EBAY_SYNC');assert.equal(f.row.dispatchCount,0)
 f.set({open:true});await executeOutboxOperationV1(f.row,f.d);assert.equal(f.row.state,'SYNCED');assert.equal(f.row.dispatchCount,1)
 await executeOutboxOperationV1(f.row,f.d);assert.equal(f.events.filter(e=>e==='write').length,1)
})
