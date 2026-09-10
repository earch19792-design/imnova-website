import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildVisualIntentManifestV1,visualIntentOrderV1} from './mayel-visual-intent-v1.ts'
import {visualAssetSyncViewV1} from './visual-asset-sync-state-v1.ts'
const assetId='2ee8fe53-fd42-4c4a-ae43-c8b6d908b1f7'
const current=Array.from({length:6},(_,i)=>`https://i.ebayimg.com/${i}.jpg`)
const input={visualTaskId:'7b8172df-d6bd-4345-a1c7-4b4acd3d51c5',ebayItemId:'366650121192',currentImages:current,
 assets:[{assetId,role:'DETAIL',outputSha256:'a'.repeat(64),publicUrl:'https://assets.example/approved.jpg'}],productTruthDigest:'sha256:'+'b'.repeat(64),sourceImageSetDigest:'sha256:'+'c'.repeat(64)}
test('REPLACE_MAIN_INTENT_MANIFEST_PASS preserves five secondaries, removes only old hero',()=>{
 const r=buildVisualIntentManifestV1({...input,intents:[{assetId,visualIntent:'REPLACE_MAIN',targetImagePosition:0}]})
 assert.equal(r.mainImageChange,true);assert.equal(r.selectedHeroAssetId,assetId);assert.equal(r.intentPolicy,'REPLACE_POSITION_0_ONLY')
 assert.deepEqual(r.proposedOrderedImages.slice(1).map(e=>e.publicUrl),current.slice(1));assert.equal(r.proposedOrderedImages.length,6)
 assert.deepEqual(r.slotPreview.map(s=>s.action),['REPLACE','KEEP','KEEP','KEEP','KEEP','KEEP'])
 assert.equal(r.ownerPreviewRequired,true);assert.equal(r.mayelApprovalIsWriteAuthority,false)
})
test('ADD_SECONDARY_INTENT_MANIFEST_PASS preserves hero and all original positions',()=>{
 const r=buildVisualIntentManifestV1({...input,intents:[{assetId,visualIntent:'ADD_SECONDARY',targetImagePosition:6}]})
 assert.equal(r.mainImageChange,false);assert.equal(r.selectedHeroAssetId,null)
 assert.deepEqual(r.proposedOrderedImages.slice(0,6).map(e=>e.publicUrl),current);assert.equal(r.slotPreview[6].action,'ADD')
 for(const targetImagePosition of [0,3,7,-1,NaN])assert.throws(()=>visualIntentOrderV1(current,[{assetId,visualIntent:'ADD_SECONDARY',targetImagePosition}]))
 assert.throws(()=>visualIntentOrderV1(current,[{assetId,visualIntent:'REPLACE_MAIN',targetImagePosition:1}]))
})
test('explicit intent changes generation; unknown intent or duplicate targets fail closed',()=>{
 const a=buildVisualIntentManifestV1({...input,intents:[{assetId,visualIntent:'REPLACE_MAIN',targetImagePosition:0}]})
 const b=buildVisualIntentManifestV1({...input,intents:[{assetId,visualIntent:'ADD_SECONDARY',targetImagePosition:6}]})
 assert.notEqual(a.visualManifestDigest,b.visualManifestDigest)
 assert.throws(()=>visualIntentOrderV1(current,[{assetId,visualIntent:'UNKNOWN',targetImagePosition:0}]))
 assert.throws(()=>visualIntentOrderV1(current,[{assetId,visualIntent:'REPLACE_MAIN',targetImagePosition:0},{assetId:'other',visualIntent:'REPLACE_MAIN',targetImagePosition:0}]))
})
test('OWNER_APPROVAL_TO_OUTBOX_PASS and no false synchronized state from QA',()=>{
 const r=visualAssetSyncViewV1({id:assetId,status:'approved',mayel_approval_status:'APPROVED',qa_result:{automaticStatus:'PASSED',humanReview:{decision:'APPROVE'}}},{id:input.visualTaskId,ebay_item_id:input.ebayItemId})
 assert.equal(r.state,'OWNER_APPROVAL_REQUIRED');assert.equal(r.approvedForEbaySync,false)
 const gate=readFileSync(new URL('./ipad-durable-outbox-v1.ts',import.meta.url),'utf8')
 assert.match(gate,/manifest.ownerPreviewRequired === true/);assert.match(gate,/galleryPreview.manifestDigest !== t.visual_manifest_digest/)
 const confirm=readFileSync(new URL('./mayel-gallery-preview-handoff-v1.ts',import.meta.url),'utf8')
 assert.match(confirm,/if \(existing.data\) return/);assert.match(confirm,/visualAssetOwnerApprovedV1/)
})

test('OWNER_APPROVAL_TO_OUTBOX_PASS OWNER differs from operator, replay creates exactly one intent',async()=>{
 const {registerHooks}=await import('node:module')
 registerHooks({resolve(s,c,n){if(s==='server-only')return {url:'data:text/javascript,export{}',shortCircuit:true};return n(s,c)}})
 const {confirmMayelGalleryPreviewV1}=await import('./mayel-gallery-preview-handoff-v1.ts')
 const {visualAssetGenerationV1,visualAssetSyncKeyV1,VISUAL_OWNER_SYNC_CONFIRMATION}=await import('./visual-asset-sync-state-v1.ts')
 for(const visualIntent of ['REPLACE_MAIN','ADD_SECONDARY']){
  const owner='00000000-0000-4000-8000-000000000001',operator='00000000-0000-4000-8000-000000000002',account='account'
  const m=buildVisualIntentManifestV1({...input,intents:[{assetId,visualIntent,targetImagePosition:visualIntent==='REPLACE_MAIN'?0:6}]})
  const task={id:input.visualTaskId,marketplace_account_key:account,ebay_item_id:input.ebayItemId,assigned_operator_user_id:operator,
   visual_manifest_id:'00000000-0000-4000-8000-000000000003',visual_manifest:m,visual_manifest_digest:m.visualManifestDigest,
   current_image_set:current,source_image_set_digest:input.sourceImageSetDigest,product_truth_digest:input.productTruthDigest,
   status:'OWNER_PREVIEW_READY',created_at:'2026-09-10T09:00:00Z',evidence_pack:{productTitle:'Product'}}
  const asset={id:assetId,account_key:account,mayel_visual_task_id:task.id,status:'approved',mayel_approval_status:'APPROVED',
   qa_result:{automaticStatus:'PASSED',humanReview:{decision:'APPROVE'}},source_sha256:'d'.repeat(64),output_sha256:'a'.repeat(64),
   source_image_set_digest:input.sourceImageSetDigest,product_truth_digest:input.productTruthDigest}
  asset.owner_sync_approval={confirmation:VISUAL_OWNER_SYNC_CONFIRMATION,assetId,generation:visualAssetGenerationV1(asset),
   idempotencyKey:visualAssetSyncKeyV1(asset),ownerUserId:owner,approvedAt:'2026-09-10T10:00:00Z',
   sourceImageSetDigest:input.sourceImageSetDigest,productTruthDigest:input.productTruthDigest}
  let saved=null,puts=0
  const db={from(table){const filters=[];const q={select(){return this},eq(k,v){filters.push([k,v]);return this},is(k,v){return this.eq(k,v)},in(k,v){filters.push([k,v]);return this},limit(){return this},order(){return this},
   getRows(){const candidate=table==='ebay_mayel_visual_tasks_v1'?[task]:table==='ebay_listing_image_assets'?[asset]:table==='seller_os_ipad_outbox_v1'?saved?[saved]:[]:
    table==='ebay_mayel_visual_delegation_authorities_v1'?[{id:owner,marketplace_account_key:account,owner_user_id:owner,status:'ACTIVE',revoked_at:null}]:[];
    return candidate.filter(r=>filters.every(([k,v])=>Array.isArray(v)?v.includes(r[k]):r[k]===v))},async maybeSingle(){return {data:this.getRows()[0]??null,error:null}},then(r,j){return Promise.resolve({data:this.getRows(),error:null}).then(r,j)}};return q},
   async rpc(name,a){assert.equal(name,'seller_os_put_ipad_outbox_v1');puts++;saved={id:'receipt',account_key:account,actor_user_id:owner,
    idempotency_key:a.p_intent.idempotencyKey,payload_hash:a.p_hash,state:'APPROVED_FOR_EBAY_SYNC',received_at:'2026-09-10T11:00:00Z',official_readback:false};return {data:saved,error:null}}}
  const request={supabase:db,accountKey:account,actorUserId:owner,taskId:task.id,expectedDigest:m.visualManifestDigest,confirmation:'CONFIRM_FULL_GALLERY_PREVIEW_V1'}
  const first=await confirmMayelGalleryPreviewV1(request),second=await confirmMayelGalleryPreviewV1(request)
  assert.equal(first.id,second.id);assert.equal(puts,1);assert.equal(task.assigned_operator_user_id,operator)
  asset.owner_sync_approval=null
  await assert.rejects(confirmMayelGalleryPreviewV1(request),/OWNER_VISUAL_REVIEW_REQUIRED/);assert.equal(puts,1)
 }
})
