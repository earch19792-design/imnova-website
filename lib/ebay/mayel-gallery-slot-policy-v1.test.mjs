import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
registerHooks({resolve(s,c,n){if(s==='server-only')return {url:'data:text/javascript,export default {}',shortCircuit:true};try{return n(s,c)}catch(e){if(s.startsWith('.')&&!/\.(ts|mjs|js)$/.test(s))return n(s+'.ts',c);throw e}}})
const {replacementSlotOrderV1,gallerySlotPreviewV1}=await import('./mayel-gallery-slot-policy-v1.ts')
const {buildMayelOrderedVisualManifestV2}=await import('./ebay-mayel-visual-workstation-v1.ts')
const {buildMayelVisualPhaseBPlanV1,buildMayelVisualPhaseBRebaseV1}=await import('./ebay-mayel-visual-phase-b-v1.ts')
const {classifyEbayListingManagementModelEvidenceV1}=await import('./ebay-draft-only-gateway.ts')
const {executeOutboxOperationV1}=await import('../seller-os/ipad-sync-engine-v1.ts')
const current=Array.from({length:6},(_,i)=>`https://i.ebayimg.com/images/g/image${i}/s-l1600.jpg`)
const taskId='5161b7d3-37cf-4221-a6d8-2dde6940ef57',assetId='abbbc8d2-e8fe-4d87-8d28-6c9e419c8bd2'
const productTruthDigest=`sha256:${'a'.repeat(64)}`,sourceImageSetDigest=`sha256:${'b'.repeat(64)}`
const asset={assetId,role:'DETAIL',outputSha256:'c'.repeat(64),publicUrl:'https://project.supabase.co/approved.jpg'}
const row={id:assetId,mayel_output_role:asset.role,status:'approved',mayel_approval_status:'APPROVED',owner_approval_status:'PENDING',output_sha256:asset.outputSha256,public_url:asset.publicUrl,product_truth_digest:productTruthDigest,source_image_set_digest:sourceImageSetDigest}
const shared={visualTaskId:taskId,ebayItemId:'366582671136',productTruthDigest,sourceImageSetDigest,assets:[asset]}
const old=buildMayelOrderedVisualManifestV2({...shared,currentImages:[current[0]],finalOrder:[{kind:'MAYEL_ASSET',assetId},{kind:'CURRENT_OFFICIAL',publicUrl:current[0]}]})
const slots=[{targetImagePosition:0,assetId}]
function rebase(manifest=old,images=current,explicit=slots){return buildMayelVisualPhaseBRebaseV1({visualTaskId:taskId,ebayItemId:shared.ebayItemId,visualManifest:manifest,visualManifestDigest:manifest.visualManifestDigest,taskProductTruthDigest:productTruthDigest,taskSourceImageSetDigest:sourceImageSetDigest,currentOfficialImageUrls:images,approvedAssets:[row],canonicalPublicAssetUrlAllowed:u=>u===asset.publicUrl,slotReplacements:explicit})}
test('ONE_TO_SIX_GALLERY_DRIFT_FAIL_CLOSED_PASS',()=>{
 const p=buildMayelVisualPhaseBPlanV1({visualTaskId:taskId,ebayItemId:shared.ebayItemId,visualManifest:old,visualManifestDigest:old.visualManifestDigest,currentOfficialImageUrls:current,approvedAssets:[row],canonicalPublicAssetUrlAllowed:()=>true})
 assert.equal(p.ready,false);assert.equal(p.blocker,'MAYEL_VISUAL_CURRENT_OFFICIAL_IMAGE_SET_CHANGED')
})
test('SIX_IMAGE_REBASE_PASS / SECONDARIES_PRESERVED_PASS / STALE_MANIFEST_NOT_REUSED_PASS',()=>{
 const r=rebase();assert.equal(r.safe,true);assert.notEqual(r.visualManifestDigest,old.visualManifestDigest)
 assert.deepEqual(r.manifest.currentOfficialImageSet,current)
 assert.deepEqual(r.manifest.proposedOrderedImages.map(e=>e.publicUrl),[asset.publicUrl,...current.slice(1)])
 assert.deepEqual(r.manifest.slotReplacements,slots);assert.equal(r.manifest.keepOldHeroAsSecondary,false)
 assert.equal(r.manifest.sourceImageSetDigest,sourceImageSetDigest);assert.equal(r.manifest.productTruthDigest,productTruthDigest)
 const preview=gallerySlotPreviewV1(current,r.manifest.proposedOrderedImages.map(e=>e.publicUrl))
 assert.deepEqual(preview.map(p=>p.action),['REPLACE','KEEP','KEEP','KEEP','KEEP','KEEP'])
})
test('NO_UNAUTHORIZED_REMOVAL_PASS / NO_UNAUTHORIZED_REORDER_PASS',()=>{
 const order=replacementSlotOrderV1(current,slots)
 assert.throws(()=>buildMayelOrderedVisualManifestV2({...shared,currentImages:current,slotReplacements:slots,finalOrder:order.slice(0,5)}),/UNAUTHORIZED_SLOT_CHANGE/)
 assert.throws(()=>buildMayelOrderedVisualManifestV2({...shared,currentImages:current,slotReplacements:slots,finalOrder:[...order].reverse()}),/UNAUTHORIZED_SLOT_CHANGE/)
 assert.throws(()=>replacementSlotOrderV1(current,[...slots,...slots]),/SLOT_BINDING_INVALID/)
})
test('automatic rebase preserves targets and stops material target drift',()=>{
 const manifest=rebase().manifest
 const secondaryChange=[...current];secondaryChange[4]='https://i.ebayimg.com/newsecondary.jpg'
 assert.equal(rebase(manifest,secondaryChange,null).safe,true)
 const targetChange=[...current];targetChange[0]='https://i.ebayimg.com/newhero.jpg'
 assert.equal(rebase(manifest,targetChange,null).blocker,'MAYEL_VISUAL_REPLACEMENT_TARGET_CHANGED')
})
test('official unavailable offer is exact 25713; arbitrary errors stay unproven',()=>{
 const base={sku:'IMN-LST-000005',itemId:shared.ebayItemId,inventory:{ok:false,status:404,body:{errors:[{errorId:25710,domain:'API_INVENTORY',category:'REQUEST'}]}}}
 const offer=id=>({ok:false,status:404,body:{errors:[{errorId:id,domain:'API_INVENTORY',category:'REQUEST'}]}})
 assert.equal(classifyEbayListingManagementModelEvidenceV1({...base,offers:offer(25713)}).managementModel,'TRADING_MANAGED')
 assert.equal(classifyEbayListingManagementModelEvidenceV1({...base,offers:offer(25001)}).managementModel,'MANAGEMENT_MODEL_UNPROVEN')
})
test('ONE_IDEMPOTENT_WRITE_PASS / OFFICIAL_POSTWRITE_GALLERY_READBACK_PASS',async()=>{
 let applied=false,writes=0,final;const events=[]
 const d={authority:async()=>({approved:true,reason:null}),quota:async()=>({open:true}),transition:async()=>{},markDispatch:async()=>events.push('claim'),
 readback:async()=>{events.push(applied?'postread':'preread');return {official:true,baseHash:'base',matchesIntent:applied,safetyPass:true,reason:null,receipt:{gallery:applied?[asset.publicUrl,...current.slice(1)]:current}}},
 execute:async()=>{events.push('write');writes++;applied=true;return {writes:1,mediaWrites:0}},finish:async(s)=>{final=s}}
 const op={state:'APPROVED_FOR_EBAY_SYNC',dispatchCount:0,baseHash:'base',kind:'IMAGE_SYNC'}
 await executeOutboxOperationV1(op,d);assert.equal(final,'SYNCED');assert.deepEqual(events,['preread','claim','write','postread'])
 await executeOutboxOperationV1(op,d);assert.equal(writes,1)
})
test('last-moment gallery drift is zero-write attention, never unknown commit',async()=>{
 let state;const result=await executeOutboxOperationV1({state:'APPROVED_FOR_EBAY_SYNC',dispatchCount:0,baseHash:'base',kind:'IMAGE_SYNC'},
 {authority:async()=>({approved:true,reason:null}),quota:async()=>({open:true}),transition:async()=>{},markDispatch:async()=>{},readback:async()=>({official:true,baseHash:'base',matchesIntent:false,safetyPass:true,reason:null,receipt:null}),execute:async()=>({writes:0,mediaWrites:0,stoppedReason:'MAYEL_VISUAL_CURRENT_OFFICIAL_IMAGE_SET_CHANGED'}),finish:async(s)=>{state=s}})
 assert.equal(state,'REQUIRES_ATTENTION');assert.equal(result.writes,0);assert.equal(result.writeOutcomeUnknown,false)
})
test('asset approval alone cannot authorize a newly rebased slot Preview',async()=>{
 const {readOutboxImageAuthorityV1}=await import('../seller-os/ipad-durable-outbox-v1.ts')
 const {visualAssetGenerationV1,visualAssetSyncKeyV1}=await import('../seller-os/visual-asset-sync-state-v1.ts')
 const a={...row,source_sha256:'d'.repeat(64),qa_result:{automaticStatus:'PASSED',humanReview:{decision:'APPROVE'}}}
 const actor='75c9d5d5-03d2-478e-8999-714ba84ee994'
 a.owner_sync_approval={confirmation:'APPROVE_THIS_ASSET_FOR_EBAY_SYNC_V1',assetId,generation:visualAssetGenerationV1(a),idempotencyKey:visualAssetSyncKeyV1(a),ownerUserId:actor,approvedAt:new Date().toISOString(),sourceImageSetDigest,productTruthDigest}
 const manifest=rebase().manifest
 const task={id:taskId,ebay_item_id:shared.ebayItemId,status:'OWNER_PREVIEW_READY',assigned_operator_user_id:actor,visual_manifest:manifest,visual_manifest_digest:manifest.visualManifestDigest,source_image_set_digest:sourceImageSetDigest,product_truth_digest:productTruthDigest}
 const supabase={from(table){const data=table==='ebay_mayel_visual_tasks_v1'?task:[a];const q={select(){return q},eq(){return q},in(){return q},maybeSingle:async()=>({data,error:null}),then(resolve){return Promise.resolve({data,error:null}).then(resolve)}};return q}}
 const outbox={account_key:'account',actor_user_id:actor,item_id:shared.ebayItemId,kind:'IMAGE_SYNC',intent:{requestedChanges:{taskId,manifestDigest:manifest.visualManifestDigest}},binding:{assetId,sourceSha256:a.source_sha256,sourceImageSetDigest}}
 assert.equal((await readOutboxImageAuthorityV1({supabase,row:outbox})).approved,false)
 outbox.binding.ownerGalleryPreview={confirmation:'CONFIRM_FULL_GALLERY_PREVIEW_V1',ownerUserId:actor,manifestDigest:manifest.visualManifestDigest}
 assert.equal((await readOutboxImageAuthorityV1({supabase,row:outbox})).approved,true)
 outbox.binding.ownerGalleryPreview.manifestDigest=old.visualManifestDigest
 assert.equal((await readOutboxImageAuthorityV1({supabase,row:outbox})).approved,false)
})
