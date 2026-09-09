import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { registerHooks } from 'node:module'
const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='server-only')return{url:'data:text/javascript,export {}',shortCircuit:true};return next(specifier,context)}})
const { receiveIpadVisualFileV1, IPAD_IMAGE_CHUNK_BYTES } = await import('./ipad-manual-visual-upload-v1.ts')
hooks.deregister()
import { visualAssetGenerationV1, visualAssetSyncKeyV1, VISUAL_OWNER_SYNC_CONFIRMATION } from './visual-asset-sync-state-v1.ts'
import { IPAD_OUTBOX_VERSION } from './ipad-outbox-contract-v1.ts'
import { readOutboxImageAuthorityV1 } from './ipad-durable-outbox-v1.ts'
import { buildMayelProductEvidencePackV1 } from '../ebay/ebay-mayel-visual-workstation-v1.ts'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const digest=b=>createHash('sha256').update(b).digest('hex')
function fixture() {
 const refs=[{referenceId:'original',sha256:'b'.repeat(64),url:'https://example.com/source.jpg',storagePath:null,authority:'APPROVED_CANONICAL_LISTING_ASSET',position:0}]
 const pack=buildMayelProductEvidencePackV1({ebayItemId:'366582671136',sku:'TEST',packageData:{title:'Test product',categoryName:'Jewelry',aspects:{Type:'Necklace'},evidenceSnapshot:{assessment:{candidate:{supplierProductId:'9220873322720',supplierVariantId:'48809689415904'},productTruth:{lunaProductId:'9220873322720',lunaVariantId:'48809689415904',evidenceDigest:`sha256:${'a'.repeat(64)}`,authorityClass:'SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1',provenProductValues:{},knownUnknownAspectNames:[]}}}},sourceImages:refs})
 const task={id:id(1),marketplace_account_key:'account',ebay_item_id:'366582671136',assigned_operator_user_id:id(2),status:'PROMPT_READY',source_image_set_digest:`sha256:${'b'.repeat(64)}`,product_truth_digest:pack.productTruthDigest,source_image_references:refs,evidence_pack:pack,current_image_set:[refs[0].url]}
 const tables={ebay_mayel_visual_tasks_v1:[task],ebay_listing_image_assets:[]}, objects=new Map()
 const db={from(table){const filters=[];let insert,update;const run=()=>{
  if(insert){tables[table].push(structuredClone(insert));return{data:[structuredClone(insert)],error:null}}
  const rows=tables[table].filter(r=>filters.every(fn=>fn(r)));if(update)rows.forEach(r=>Object.assign(r,structuredClone(update)))
  return{data:structuredClone(rows),error:null}}
  const q={select:()=>q,limit:()=>q,eq:(k,v)=>{filters.push(r=>r[k]===v);return q},in:(k,v)=>{filters.push(r=>v.includes(r[k]));return q},insert:v=>{insert=v;return q},update:v=>{update=v;return q},
   single:async()=>({...run(),data:run().data[0]}),maybeSingle:async()=>{const r=run();return{...r,data:r.data[0]??null}},then:resolve=>Promise.resolve(run()).then(resolve)}
  q.single=async()=>{const r=run();return{...r,data:r.data[0]??null}};return q},storage:{from(bucket){return{
   upload:async(path,bytes)=>{const key=`${bucket}/${path}`;if(objects.has(key))return{error:{message:'exists'}};objects.set(key,Buffer.from(bytes));return{error:null}},
   download:async path=>{const bytes=objects.get(`${bucket}/${path}`);return bytes?{data:new Blob([bytes]),error:null}:{data:null,error:{message:'missing'}}},
   remove:async paths=>{paths.forEach(p=>objects.delete(`${bucket}/${p}`));return{error:null}}
  }}}}
 return{db,task,tables,objects,input:{supabase:db,accountKey:'account',actorUserId:id(2)}}
}
test('six manual ChatGPT outputs use existing QA, survive response loss, preserve source provenance, and await complete human review',async()=>{
 const f=fixture(),bytes=await Promise.all(Array.from({length:6},(_,n)=>sharp({create:{width:1600,height:1600,channels:3,background:{r:30+n*25,g:80,b:120}}}).png().toBuffer()))
 const files=bytes.map((b,n)=>({id:id(n+10),sha256:digest(b),mimeType:'image/png',bytes:b.length,position:n}))
 const intent={version:IPAD_OUTBOX_VERSION,kind:'IMAGE_UPLOAD',itemId:f.task.ebay_item_id,listingTitle:'Test product',generationId:f.task.id,createdAt:'2026-09-09T00:00:00Z',baseVersionHash:f.task.source_image_set_digest,baseObservedAt:null,idempotencyKey:`ipados:v1:${'a'.repeat(64)}`,requestedChanges:{taskId:f.task.id,files,rightsConfirmed:true}}
 const form=(n,action,chunkIndex=0,b=bytes[n])=>{const fd=new FormData();fd.set('intent',JSON.stringify(intent));fd.set('fileId',files[n].id);fd.set('action',action);fd.set('chunkIndex',String(chunkIndex));if(action==='IPAD_VISUAL_CHUNK')fd.set('chunk',new Blob([b.subarray(chunkIndex*IPAD_IMAGE_CHUNK_BYTES,(chunkIndex+1)*IPAD_IMAGE_CHUNK_BYTES)]),'chunk.part');return fd}
 await assert.rejects(receiveIpadVisualFileV1({...f.input,actorUserId:id(9),form:form(0,'IPAD_VISUAL_CHUNK')}),/TASK_SCOPE_REQUIRED/)
 for(let n=0;n<6;n++){
  for(let c=0;c<Math.ceil(bytes[n].length/IPAD_IMAGE_CHUNK_BYTES);c++){
   await receiveIpadVisualFileV1({...f.input,form:form(n,'IPAD_VISUAL_CHUNK',c)})
   await receiveIpadVisualFileV1({...f.input,form:form(n,'IPAD_VISUAL_CHUNK',c)})
  }
  const result=await receiveIpadVisualFileV1({...f.input,form:form(n,'IPAD_VISUAL_FILE')})
  const replay=await receiveIpadVisualFileV1({...f.input,form:form(n,'IPAD_VISUAL_FILE')})
  assert.equal(result.assetId,replay.assetId);assert.equal(result.marketplaceWrites,0);assert.equal(replay.idempotent,true)
 }
 const assets=f.tables.ebay_listing_image_assets
 assert.equal(assets.length,6);assert.equal(new Set(assets.map(a=>a.mayel_output_role)).size,6)
 assert.ok(assets.every(a=>a.qa_result.automaticStatus==='PASSED'&&a.source_type==='CHATGPT_SUBSCRIPTION_MAYEL'&&a.source_image_set_digest===f.task.source_image_set_digest))
 assert.equal([...f.objects.keys()].filter(k=>k.startsWith('seller-os-ipad-image-parts-v1/')).length,0)
 const row={account_key:'account',actor_user_id:id(2),item_id:intent.itemId,kind:'IMAGE_UPLOAD',intent,binding:{sourceImageSetDigest:f.task.source_image_set_digest,assets:assets.map(a=>({assetId:a.id,sourceSha256:a.source_sha256}))}}
 assert.equal((await readOutboxImageAuthorityV1({supabase:f.db,row})).approved,false)
 f.task.status='OWNER_PREVIEW_READY';f.task.visual_manifest_digest='approved-manifest';f.task.visual_manifest={proposedOrderedImages:assets.map(a=>({assetId:a.id,outputSha256:a.output_sha256}))}
 for(const a of assets){a.status='approved';a.mayel_approval_status='APPROVED';a.approved_by=id(2);a.qa_result.humanReview={decision:'APPROVE'}}
 assert.equal((await readOutboxImageAuthorityV1({supabase:f.db,row})).approved,false)
 for(const a of assets)a.owner_sync_approval={confirmation:VISUAL_OWNER_SYNC_CONFIRMATION,assetId:a.id,generation:visualAssetGenerationV1(a),idempotencyKey:visualAssetSyncKeyV1(a),ownerUserId:id(2),approvedAt:'2026-09-09T00:00:00Z',sourceImageSetDigest:f.task.source_image_set_digest,productTruthDigest:f.task.product_truth_digest}
 assert.equal((await readOutboxImageAuthorityV1({supabase:f.db,row})).approved,true)
 assets[5].status='pending_review'
 assert.equal((await readOutboxImageAuthorityV1({supabase:f.db,row})).approved,false)
})
