import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {authorizeOptimizationV1,MAYEL_OPTIMIZATION_ACTIONS_V1,MAYEL_OPTIMIZATION_DELEGATION_V1} from './mayel-optimization-delegation-v1.ts'
import {buildVisualIntentManifestV1} from './mayel-visual-intent-v1.ts'
import {buildMayelVisualPhaseBPlanV1} from '../ebay/ebay-mayel-visual-phase-b-v1.ts'
import {visualAssetStatusV1} from './mayel-visual-asset-status-v1.ts'
import {executeOutboxOperationV1} from './ipad-sync-engine-v1.ts'
registerHooks({resolve(s,c,n){if(s==='server-only')return {url:'data:text/javascript,export{}',shortCircuit:true};return n(s,c)}})
const {enqueueDelegatedVisualV1,readDelegatedVisualAuthorityV1}=await import('./mayel-optimization-delegation-server-v1.ts')
const account='account',item='366650121192',id='7b8172df-d6bd-4345-a1c7-4b4acd3d51c5',assetId='2ee8fe53-fd42-4c4a-ae43-c8b6d908b1f7'
const grant={id:'00000000-0000-4000-8000-000000000001',account_key:account,owner_user_id:'00000000-0000-4000-8000-000000000002',scope:'FULL',status:'ACTIVE',revoked_at:null,
 contract_version:MAYEL_OPTIMIZATION_DELEGATION_V1,authority_digest:'sha256:'+'a'.repeat(64),allowed_actions:[...MAYEL_OPTIMIZATION_ACTIONS_V1]}
const guards={exactListingIdentity:true,productTruthProven:true,currentLiveReadbackPass:true,baseGenerationCompatible:true,qaPass:true,unsupportedClaimCount:0,competitorContaminationCount:0}
for(const action of MAYEL_OPTIMIZATION_ACTIONS_V1)test(`${action}: permanent OWNER grant allows only proven current changes`,()=>{
 const input={grant,accountKey:account,actions:[action],guards}
 assert.equal(authorizeOptimizationV1(input).authorized,true)
 assert.equal(authorizeOptimizationV1(input).ownerRoutineApprovalRequired,false)
 for(const key of Object.keys(guards))assert.equal(authorizeOptimizationV1({...input,guards:{...guards,[key]:key.endsWith('Count')?null:false}}).authorized,false,key)
 for(const bad of [{...grant,revoked_at:'2026-09-10T16:00:00Z'},{...grant,status:'REVOKED'},{...grant,account_key:'other'},null])assert.equal(authorizeOptimizationV1({...input,grant:bad}).authorized,false)
})
test('UNSUPPORTED_CHANGE_FAIL_CLOSED_PASS: no publication, spend, price, inventory, policy or identity authority',()=>{
 for(const action of ['NEW_LISTING_PUBLICATION','EBAY_ADS_SPEND','PRICE','QUANTITY','SKU','BRAND','INVENTORY','IMAGE_REMOVAL']){
  const r=authorizeOptimizationV1({grant,accountKey:account,actions:[action],guards});assert.equal(r.authorized,false);assert.equal(r.publicationAuthorized,false);assert.equal(r.adsSpendAuthorized,false)
 }
})
function fixture(visualIntent='REPLACE_MAIN',count=6){
 const current=Array.from({length:count},(_,i)=>`https://i.ebayimg.com/${i}.jpg`),url='https://assets.example/approved.jpg'
 const truth='sha256:'+'b'.repeat(64),source='sha256:'+'c'.repeat(64)
 const manifest=buildVisualIntentManifestV1({visualTaskId:id,ebayItemId:item,currentImages:current,
  assets:[{assetId,role:'DETAIL',outputSha256:'d'.repeat(64),publicUrl:url}],productTruthDigest:truth,sourceImageSetDigest:source,
  intents:[{assetId,visualIntent,targetImagePosition:visualIntent==='REPLACE_MAIN'?0:visualIntent==='REPLACE_SLOT'?2:count}]})
 const task={id,marketplace_account_key:account,ebay_item_id:item,assigned_operator_user_id:'00000000-0000-4000-8000-000000000003',status:'OWNER_PREVIEW_READY',
  visual_manifest:manifest,visual_manifest_digest:manifest.visualManifestDigest,visual_manifest_id:'00000000-0000-4000-8000-000000000004',source_image_set_digest:source,
  product_truth_digest:truth,current_image_set:current,created_at:'2026-09-10T16:00:00Z',selection_signal:{productTruthSupported:true,currentOfficialGallery:{authority:'CURRENT_OFFICIAL_ORDERED_IMAGE_SET',images:current}},
  source_image_references:[{authority:'OFFICIAL_EBAY_CURRENT_LISTING_IMAGE',referenceId:`EBAY_ITEM_${item}`,sha256:'e'.repeat(64)}]}
 const asset={id:assetId,account_key:account,mayel_visual_task_id:id,status:'approved',mayel_approval_status:'APPROVED',owner_approval_status:'PENDING',owner_sync_approval:null,
  product_truth_digest:truth,source_image_set_digest:source,output_sha256:'d'.repeat(64),source_sha256:'e'.repeat(64),public_url:url,
  qa_result:{automaticStatus:'PASSED',humanReview:{decision:'APPROVE',checks:{productIdentityPreserved:true,noUnsupportedClaims:true,noInventedAccessories:true,noUnauthorizedText:true}}}}
 return {task,asset,current,manifest}
}
for(const [intent,name] of [['REPLACE_MAIN','AUTONOMOUS_MAIN_IMAGE_REPLACEMENT_PASS'],['REPLACE_SLOT','AUTONOMOUS_SECONDARY_IMAGE_PASS'],['ADD_SECONDARY','AUTONOMOUS_IMAGE_ADDITION_PASS']])test(name,async()=>{
 const {task,asset,current,manifest}=fixture(intent)
 const a=await readDelegatedVisualAuthorityV1({supabase:{},accountKey:account,task,assets:[asset],grant})
 assert.equal(a.authorized,true);assert.equal(asset.owner_sync_approval,null)
 const plan=buildMayelVisualPhaseBPlanV1({visualTaskId:id,ebayItemId:item,visualManifest:manifest,visualManifestDigest:manifest.visualManifestDigest,
  currentOfficialImageUrls:current,approvedAssets:[asset],canonicalPublicAssetUrlAllowed:()=>true})
 assert.equal(plan.ready,true,plan.blocker)
 const drift=await readDelegatedVisualAuthorityV1({supabase:{},accountKey:account,task:{...task,current_image_set:[...current,'https://i.ebayimg.com/new.jpg']},assets:[asset],grant})
 assert.equal(drift.authorized,false)
 const poisoned=await readDelegatedVisualAuthorityV1({supabase:{},accountKey:account,task:{...task,source_image_references:[{authority:'COMPETITOR'}]},assets:[asset],grant})
 assert.equal(poisoned.authorized,false)
})
test('AUTONOMOUS_GALLERY_REBASE_PASS: new complete base gives new digest, preserves all untargeted positions',()=>{
 const one=fixture('REPLACE_MAIN',1),six=fixture('REPLACE_MAIN',6)
 assert.notEqual(one.manifest.visualManifestDigest,six.manifest.visualManifestDigest)
 assert.deepEqual(six.manifest.proposedOrderedImages.slice(1).map(e=>e.publicUrl),six.current.slice(1))
 assert.equal(buildMayelVisualPhaseBPlanV1({visualTaskId:id,ebayItemId:item,visualManifest:one.manifest,visualManifestDigest:one.manifest.visualManifestDigest,
  currentOfficialImageUrls:six.current,approvedAssets:[one.asset],canonicalPublicAssetUrlAllowed:()=>true}).ready,false)
})
test('NO_OWNER_ROUTINE_APPROVAL_PASS: real handoff creates one durable intent, repeats reuse it',async()=>{
 const {task,asset}=fixture();let saved=null,puts=0
 const db={from(table){const filters=[];const q={select(){return this},eq(k,v){filters.push([k,v]);return this},is(k,v){return this.eq(k,v)},in(k,v){return this.eq(k,v)},limit(){return this},order(){return this},
  rows(){const rows=table==='seller_os_mayel_optimization_grants_v1'?[grant]:table==='ebay_mayel_visual_tasks_v1'?[task]:table==='ebay_listing_image_assets'?[asset]:table==='seller_os_ipad_outbox_v1'&&saved?[saved]:[];
   return rows.filter(r=>filters.every(([k,v])=>Array.isArray(v)?v.includes(r[k]):r[k]===v))},async maybeSingle(){return {data:this.rows()[0]??null,error:null}},then(a,b){return Promise.resolve({data:this.rows(),error:null}).then(a,b)}};return q},
  async rpc(name,p){assert.equal(name,'seller_os_put_ipad_outbox_v1');puts++;assert.equal(p.p_binding.ownerGalleryPreview,undefined);
   assert.equal(p.p_binding.ownerDelegation.grantId,grant.id);assert.deepEqual(p.p_binding.optimizationAudit.before,task.current_image_set)
   saved={id:'receipt',account_key:account,actor_user_id:task.assigned_operator_user_id,idempotency_key:p.p_intent.idempotencyKey,payload_hash:p.p_hash,
    state:'APPROVED_FOR_EBAY_SYNC',received_at:'2026-09-10T16:00:00Z',official_readback:false};return {data:saved,error:null}}}
 const a=await enqueueDelegatedVisualV1({supabase:db,accountKey:account,taskId:id}),b=await enqueueDelegatedVisualV1({supabase:db,accountKey:account,taskId:id})
 assert.equal(a.receipt.id,b.receipt.id);assert.equal(puts,1);assert.equal(asset.owner_sync_approval,null)
})
test('OFFICIAL_READBACK_REQUIRED_PASS and NO_DUPLICATE_WRITE_PASS: uncertain commit reads, never replays write',async()=>{
 let writes=0,reads=0,state='',official=false
 const deps={authority:async()=>({approved:true,reason:null}),quota:async()=>({open:true}),transition:async()=>{},markDispatch:async()=>{},
  readback:async()=>{reads++;return {official:true,baseHash:'same',matchesIntent:official,safetyPass:true,reason:null,receipt:{proof:official}}},
  execute:async()=>{writes++;throw Error('TIMEOUT')},finish:async(s)=>{state=s}}
 await executeOutboxOperationV1({state:'APPROVED_FOR_EBAY_SYNC',dispatchCount:0,baseHash:'same',kind:'IMAGE_SYNC'},deps)
 assert.equal(writes,1);assert.equal(state,'OFFICIAL_READBACK_REQUIRED')
 official=true;await executeOutboxOperationV1({state,dispatchCount:1,baseHash:'same',kind:'IMAGE_SYNC'},deps)
 assert.equal(writes,1);assert.equal(reads,2);assert.equal(state,'SYNCED')
 const ui={autonomousOptimization:true,generated:true,qaPassed:true,savedToSellerOS:true,ownerApproved:true,serverReceiptPresent:true,state:'SYNCED',officialReadback:false}
 assert.equal(visualAssetStatusV1(ui).synced,false)
 assert.equal(visualAssetStatusV1({...ui,officialReadback:true}).synced,true)
})
test('current exact LIVE product truth resolves an old task without modifying its QA or source digest',async()=>{
 const {task,asset}=fixture();task.selection_signal.productTruthSupported=false
 const original=structuredClone({task,asset});let reads=0
 const proof={authority:'EXACT_LIVE_LINKED_PRODUCT_TRUTH_V1',accountKey:account,itemId:item,taskId:id,visualSourceDigest:task.source_image_set_digest,
  productTruthDigest:'sha256:'+'f'.repeat(64),packageId:'own-draft-live-package',variantId:'123',productId:'456'}
 const db={async rpc(name,args){reads++;assert.equal(name,'seller_os_read_visual_current_product_truth_v1');assert.equal(args.p_task_id,id);return {data:proof,error:null}}}
 const result=await readDelegatedVisualAuthorityV1({supabase:db,accountKey:account,task,assets:[asset],grant})
 assert.equal(result.authorized,true);assert.equal(reads,1);assert.deepEqual({task,asset},original)
 const denied=await readDelegatedVisualAuthorityV1({supabase:{rpc:async()=>({data:{...proof,itemId:'other'},error:null})},accountKey:account,task,assets:[asset],grant})
 assert.equal(denied.authorized,false);assert.equal(denied.reason,'PRODUCT_TRUTH_REQUIRED')
})
