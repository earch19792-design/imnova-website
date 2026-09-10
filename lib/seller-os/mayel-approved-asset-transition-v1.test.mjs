import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {approvalGalleryV1,assertReviewIntentV1,savedSafeDecisionV1,MAYEL_ASSET_TRANSITION_V1} from './mayel-approved-asset-transition-v1.ts'
import {buildVisualIntentManifestV1} from './mayel-visual-intent-v1.ts'
import {visualAssetSyncViewV1} from './visual-asset-sync-state-v1.ts'
registerHooks({resolve(s,c,n){if(s==='server-only')return {url:'data:text/javascript,export{}',shortCircuit:true};return n(s,c)}})
const current=Array.from({length:6},(_,i)=>`https://i.ebayimg.com/current-${i}.jpg`),digest='sha256:'+'a'.repeat(64)
const task={id:'db610d8e-cde3-4dc8-9407-1cbd47780b96',ebay_item_id:'366574069492',assigned_operator_user_id:'actor',current_image_set:[current[0]],visual_manifest_digest:null,product_truth_digest:digest,source_image_set_digest:digest}
const intent={assetId:'asset',visualIntent:'ADD_SECONDARY',targetImagePosition:6}
const checks=Object.fromEntries(['productIdentityPreserved','colorPreserved','shapePreserved','partCountPreserved','visibleLogosPreserved','noInventedAccessories','noUnsupportedClaims','noUnauthorizedText','roleMatchesOutput'].map(k=>[k,true]))
const decision={contract:MAYEL_ASSET_TRANSITION_V1,taskId:task.id,assetId:'asset',actorUserId:'actor',outputSha256:'b'.repeat(64),productTruthDigest:digest,sourceImageSetDigest:digest,checks,intent}
const asset={id:'asset',status:'pending_review',mayel_approval_status:'PENDING',mayel_output_role:'PACKAGE_CONTENTS',output_sha256:decision.outputSha256,qa_result:{automaticStatus:'PASSED',transitionDecision:decision}}
test('physical one-vs-six base reproduces rejection; legacy adoption preserves full gallery and ADD position',()=>{
 assert.throws(()=>assertReviewIntentV1(task.current_image_set,[],intent),/POSITION_INVALID/)
 const base=approvalGalleryV1(task,{images:current,digest},digest)
 const order=assertReviewIntentV1(base,[],intent)
 assert.equal(order.length,7);assert.deepEqual(order.slice(0,6).map(e=>e.publicUrl),current)
 assert.deepEqual(task.current_image_set,[current[0]])
 const manifest=buildVisualIntentManifestV1({visualTaskId:task.id,ebayItemId:task.ebay_item_id,currentImages:base,
  assets:[{assetId:'asset',role:'PACKAGE_CONTENTS',publicUrl:'https://own.test/safe.jpg',outputSha256:decision.outputSha256}],intents:[intent],productTruthDigest:digest,sourceImageSetDigest:digest})
 assert.equal(manifest.currentOfficialImageSet.length,6);assert.equal(manifest.proposedOrderedImages.length,7)
 assert.equal(manifest.mainImageChange,false);assert.deepEqual(manifest.visualIntents,[intent])
})
test('changed preview or existing stale manifest never silently rebases a reviewed slot',()=>{
 assert.throws(()=>approvalGalleryV1(task,{images:current,digest},'other'),/GALLERY_CHANGED/)
 assert.throws(()=>approvalGalleryV1({...task,visual_manifest_digest:digest},{images:current,digest}),/GALLERY_CHANGED/)
 assert.throws(()=>approvalGalleryV1(task,null),/GALLERY_REQUIRED/)
})
test('safe decision survives transition failure; identity and every semantic check remain fail closed',()=>{
 assert.equal(savedSafeDecisionV1(asset,task).safe,true)
 for(const key of Object.keys(checks))assert.equal(savedSafeDecisionV1({...asset,qa_result:{...asset.qa_result,transitionDecision:{...decision,checks:{...checks,[key]:false}}}},task).safe,false,key)
 for(const reason of ['IDENTITY_DRIFT','UNSUPPORTED_PRODUCT_FACTS','FALSE_FEATURES','UNPROVEN_ACCESSORIES','PRODUCT_MISREPRESENTATION'])
  assert.equal(savedSafeDecisionV1({...asset,status:'rejected',qa_result:{...asset.qa_result,humanReview:{decision:'REJECT',reason}}},task).safe,false)
 assert.equal(savedSafeDecisionV1({...asset,qa_result:{automaticStatus:'PASSED'}},task).reason,'SEMANTIC_QA_EVIDENCE_REQUIRED')
 for(const key of ['taskId','assetId','actorUserId','outputSha256','productTruthDigest','sourceImageSetDigest'])
  assert.equal(savedSafeDecisionV1({...asset,qa_result:{...asset.qa_result,transitionDecision:{...decision,[key]:'other'}}},task).safe,false)
})
test('FULL delegation removes routine approval status without converting unreviewed or rejected assets to safe',()=>{
 const pending=visualAssetSyncViewV1(asset,task,[],{active:true,authorized:false})
 assert.equal(pending.state,'QA_READY');assert.equal(pending.approvedForEbaySync,false)
 const rejected=visualAssetSyncViewV1({...asset,status:'rejected'},task,[],{active:true,authorized:true})
 assert.equal(rejected.state,'REQUIRES_ATTENTION');assert.equal(rejected.approvedForEbaySync,false)
 const attention=visualAssetSyncViewV1({...asset,qa_result:{...asset.qa_result,transitionRecovery:{state:'REQUIRES_ATTENTION'}}},task,[],{active:true,authorized:false})
 assert.equal(attention.state,'REQUIRES_ATTENTION');assert.equal(attention.officialReadback,false)
})
test('real recovery refuses an unproven or rejected proposal without promotion, outbox or eBay',async()=>{
 const {recoverApprovedAssetTransitionV1}=await import('./mayel-approved-asset-transition-server-v1.ts')
 const {MAYEL_OPTIMIZATION_DELEGATION_V1}=await import('./mayel-optimization-delegation-v1.ts')
 for(const rejected of [false,true]){
  let diagnostics=0
  const candidate={...asset,status:rejected?'rejected':'pending_review',mayel_approval_status:rejected?'REJECTED':'PENDING',qa_result:{automaticStatus:'PASSED',...(rejected?{humanReview:{decision:'REJECT',reason:'IDENTITY_DRIFT'}}:{})}}
  const bound={...task,marketplace_account_key:'account',selection_signal:{productTruthSupported:false}}
  const grant={id:'grant',account_key:'account',scope:'FULL',status:'ACTIVE',revoked_at:null,contract_version:MAYEL_OPTIMIZATION_DELEGATION_V1,authority_digest:digest,allowed_actions:['IMAGE_ADDITION']}
  const db={from(table){assert.ok(['ebay_mayel_visual_tasks_v1','seller_os_mayel_optimization_grants_v1','ebay_listing_image_assets'].includes(table));let update=false;
   return {select(){return this},eq(){return this},is(){return this},in(){return this},order(){return this},limit(){return this},
    update(v){assert.equal(rejected,false);assert.equal(v.qa_result.transitionRecovery.state,'REQUIRES_ATTENTION');update=true;diagnostics++;return this},
    async maybeSingle(){return {data:update?{id:candidate.id}:table==='ebay_mayel_visual_tasks_v1'?bound:grant,error:null}},
    then(a,b){return Promise.resolve({data:[candidate],error:null}).then(a,b)}}},
   async rpc(name){assert.equal(name,'seller_os_read_visual_current_product_truth_v1');return {data:null,error:null}}}
  const r=await recoverApprovedAssetTransitionV1({supabase:db,accountKey:'account',taskId:task.id,expectedItemId:task.ebay_item_id})
  assert.equal(r.status,'REQUIRES_ATTENTION');assert.equal(r.imageWriteCount,0);assert.equal(r.receipt,null)
  assert.equal(r.officialReadback,false);assert.equal(r.activeDelegationFound,true)
  assert.equal(diagnostics,rejected?0:1);assert.ok(r.blockers.includes('PRODUCT_TRUTH_REQUIRED'))
 }
})
