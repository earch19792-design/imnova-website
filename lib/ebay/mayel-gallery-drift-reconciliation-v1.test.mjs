import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {currentLiveGalleryV1,galleryDriftEvidenceV1} from '../seller-os/mayel-gallery-drift-v1.ts'
import {executeOutboxOperationV1} from '../seller-os/ipad-sync-engine-v1.ts'
const hash=x=>'sha256:'+createHash('sha256').update(JSON.stringify(x)).digest('hex')
const a='https://i.ebayimg.com/a.jpg',b='https://i.ebayimg.com/b.jpg',c='https://i.ebayimg.com/c.jpg'
const binding={baseImageHash:hash([a,b]),baseObservedAt:'2026-09-11T18:00:00Z',optimizationAudit:{before:[a,b],after:[{assetId:'approved',publicUrl:c,outputSha256:'a'.repeat(64)}],mayelDecision:{visualManifestDigest:'manifest'}}}
const evidence=(currentUrls,extra={})=>galleryDriftEvidenceV1({binding,currentUrls,currentObservedAt:'2026-09-11T18:01:00Z',currentReadbackReference:'GetItem:7727:receipt',official:true,...extra})
test('LIVE authority is PictureDetails, never Inventory product image URLs or missing-read fallback',()=>{
 const official={pictureUrls:[a,b],inventoryImageUrls:[c]};assert.deepEqual(currentLiveGalleryV1(official),[a,b]);assert.deepEqual(currentLiveGalleryV1(null),[])
})
test('same CURRENT and baseline is NO_DRIFT, with three ordered, timestamped authorities',()=>{
 const d=evidence([a,b]);assert.equal(d.DRIFT_CLASSIFICATION,'NO_DRIFT');assert.equal(d.BASELINE_DIGEST,d.CURRENT_DIGEST)
 assert.equal(d.PROPOSED_DIGEST,hash([c]));assert.equal(d.BASELINE_GALLERY.count,2);assert.equal(d.CURRENT_EBAY_GALLERY.sourceReference,'GetItem:7727:receipt')
 assert.deepEqual(d.ADDED_ASSETS,[]);assert.deepEqual(d.REMOVED_ASSETS,[]);assert.deepEqual(d.REORDERED_ASSETS,[])
 assert.equal(d.PROPOSED_GALLERY.images[0].identity,'sha256:'+'a'.repeat(64))
 assert.equal(evidence([a,b],{proposalObservedAt:'2026-09-11T18:00:00Z'}).PROPOSED_GALLERY.observedAt,'2026-09-11T18:00:00Z')
})
test('missing/corrupt baseline or unofficial CURRENT is an evidence defect, not proof of external edits',()=>{
 for(const extra of [{binding:{}},{binding:{...binding,baseImageHash:'wrong'}},{official:false}])assert.equal(evidence([a,b],extra).DRIFT_CLASSIFICATION,'BASELINE_EVIDENCE_DEFECT')
})
test('real external additions, removal and reordering remain material and explained',()=>{
 const d=evidence([b,c]);assert.equal(d.DRIFT_CLASSIFICATION,'MATERIAL_EXTERNAL_DRIFT');assert.equal(d.ADDED_ASSETS[0].normalizedUrl,c)
 assert.equal(d.REMOVED_ASSETS[0].normalizedUrl,a);assert.equal(d.REORDERED_ASSETS[0].normalizedUrl,b)
})
test('rewritten URLs require affirmative official ordered identity proof; filenames alone cannot authorize a rebase',()=>{
 assert.equal(evidence([a+'?size=large',b]).DRIFT_CLASSIFICATION,'MATERIAL_EXTERNAL_DRIFT')
 const d=evidence([a+'?size=large',b],{orderedIdentityProof:{verified:true,method:'PERCEPTUAL_EPS',baselineDigest:hash([a,b]),currentDigest:hash([a+'?size=large',b])}})
 assert.equal(d.DRIFT_CLASSIFICATION,'NON_MATERIAL_DRIFT');assert.deepEqual(d.ADDED_ASSETS,[]);assert.deepEqual(d.REMOVED_ASSETS,[])
 assert.equal(evidence([a+'?size=large',b],{orderedIdentityProof:{verified:true,method:'PERCEPTUAL_EPS',baselineDigest:'another',currentDigest:hash([a+'?size=large',b])}}).DRIFT_CLASSIFICATION,'MATERIAL_EXTERNAL_DRIFT')
 assert.equal(evidence([a],{orderedIdentityProof:{verified:true,method:'PERCEPTUAL_EPS',baselineDigest:hash([a,b]),currentDigest:hash([a])}}).DRIFT_CLASSIFICATION,'MATERIAL_EXTERNAL_DRIFT')
 assert.equal(evidence([a+'?size=large',b],{orderedIdentityProof:{verified:false,method:'PERCEPTUAL_EPS',baselineDigest:hash([a,b]),currentDigest:hash([a+'?size=large',b])}}).DRIFT_CLASSIFICATION,'MATERIAL_EXTERNAL_DRIFT')
})
test('same-gallery recovery writes once, then official full-gallery readback; replay never redispatches',async()=>{
 let dispatch=0,writes=0,reads=0,finished
 const deps={authority:async()=>({approved:true}),quota:async()=>({open:true}),transition:async()=>{},
  readback:async()=>({official:true,baseHash:binding.baseImageHash,matchesIntent:++reads>1,safetyPass:true,reason:null,receipt:{ordered:true}}),
  markDispatch:async()=>{dispatch++},execute:async()=>{writes++;return{writes:1,mediaWrites:0}},finish:async(s)=>{finished=s}}
 await executeOutboxOperationV1({state:'PENDING_EBAY_SYNC',dispatchCount:0,baseHash:binding.baseImageHash,kind:'IMAGE_SYNC'},deps)
 assert.equal(finished,'SYNCED');assert.equal(writes,1);assert.equal(dispatch,1)
 await executeOutboxOperationV1({state:'OFFICIAL_READBACK_REQUIRED',dispatchCount:1,baseHash:binding.baseImageHash,kind:'IMAGE_SYNC'},deps)
 assert.equal(writes,1);assert.equal(dispatch,1)
})
test('external drift and ambiguous previous dispatch never overwrite CURRENT',async()=>{
 for(const op of [{dispatchCount:0,state:'PENDING_EBAY_SYNC'},{dispatchCount:1,state:'UNKNOWN_COMMIT'}]){
 let reason;const no=()=>{throw Error('must not write')}
 await executeOutboxOperationV1({...op,kind:'IMAGE_SYNC',baseHash:'base'}, {authority:async()=>({approved:true}),quota:async()=>({open:true}),transition:async()=>{},readback:async()=>({official:true,baseHash:'other',matchesIntent:false,safetyPass:true}),markDispatch:no,execute:no,finish:async(s,r)=>{reason=r}})
 assert.equal(reason,op.dispatchCount?'UNKNOWN_COMMIT_REQUIRES_REVIEW':'MATERIAL_LISTING_DRIFT')
 }
})
test('diagnostics persisted before engine comparison; existing-order recovery never enqueues or generates assets',()=>{
 const runtime=readFileSync(new URL('../seller-os/ipad-sync-runtime-v1.ts',import.meta.url),'utf8')
 assert.match(runtime,/await patch\(\{ execution_receipt: row.execution_receipt \}\)/)
 assert.match(runtime,/row.dispatch_count > 0 \? "postWriteGalleryEvidence" : "galleryDriftEvidence"/)
 const recovery=readFileSync(new URL('../seller-os/mayel-existing-gallery-recovery-v1.ts',import.meta.url),'utf8')
 assert.doesNotMatch(recovery,/enqueue|saveDurableOutbox|\.insert\(|upload|generateImage/)
 assert.match(recovery,/eq\("dispatch_count", 0\)/);assert.match(recovery,/eq\("lease_token", lease\)/)
 assert.match(recovery,/readOutboxImageAuthorityV1/);assert.match(recovery,/GALLERY_RECOVERY_CURRENT_SAFETY_FAILED/)
})

test('recovery diagnostics preserve immutable outbox binding and retain prewrite evidence in execution receipt',()=>{
 const recovery=readFileSync(new URL('../seller-os/mayel-existing-gallery-recovery-v1.ts',import.meta.url),'utf8')
 const runtime=readFileSync(new URL('../seller-os/ipad-sync-runtime-v1.ts',import.meta.url),'utf8')
 assert.doesNotMatch(recovery,/await patch\(\{ binding/)
 assert.match(recovery,/execution_receipt: \{ \.\.\.receipt, galleryRecovery: recovery \}/)
 assert.match(runtime,/execution_receipt: \{ \.\.\.row.execution_receipt, \.\.\.proof\?\.receipt/)
 assert.match(runtime,/official_readback,execution_receipt/)
})
