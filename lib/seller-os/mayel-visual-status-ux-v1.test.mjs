import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {visualAssetSyncViewV1} from './visual-asset-sync-state-v1.ts'
import {visualAssetStatusV1,visualEvidenceV1,visualListingStatusV1,visualTaskStatusV1,localReceiptVisualEvidenceV1} from './mayel-visual-asset-status-v1.ts'
import {friendlyVisualSyncV1} from './mayel-visual-scope-v1.ts'
import {proposalDeliveryStatusV1} from './mayel-gallery-presentation-v1.ts'
const hash='a'.repeat(64), source='b'.repeat(64), digest='sha256:'+hash
const checks={productIdentityPreserved:true,noUnsupportedClaims:true,noInventedAccessories:true,noUnauthorizedText:true}
const asset={id:'asset',account_key:'account',mayel_visual_task_id:'task',output_sha256:hash,source_sha256:source,output_storage_path:'outputs/asset.png',public_url:null,
 status:'approved',mayel_approval_status:'APPROVED',owner_approval_status:'PENDING',product_truth_digest:'truth',source_image_set_digest:'sources',qa_result:{automaticStatus:'PASSED',humanReview:{decision:'APPROVE',checks}}}
const task={id:'task',marketplace_account_key:'account',ebay_item_id:'366650121192',product_truth_digest:'truth',source_image_set_digest:'sources',visual_manifest_digest:digest,
 visual_manifest:{ebayItemId:'366650121192',visualTaskId:'task',proposedOrderedImages:[{assetId:asset.id,outputSha256:hash}]},selection_signal:{currentOfficialGallery:{authority:'CURRENT_OFFICIAL_ORDERED_IMAGE_SET',digest}}}
const row={id:'receipt',account_key:'account',item_id:task.ebay_item_id,state:'SYNCED',official_readback:true,received_at:'2026-09-11T00:00:00Z',
 intent:{requestedChanges:{taskId:task.id,manifestDigest:digest}},binding:{assets:[{assetId:asset.id,sourceSha256:source}],executionManifestDigest:digest},execution_receipt:{manifestDigest:digest,officialDigest:digest}}
const delegation={active:true,authorized:true}
const view=(a=asset,t=task,rows=[row],d=delegation)=>visualAssetSyncViewV1(a,t,rows,d)
test('UNIFIED_STATUS_PROJECTION_PASS all surfaces use identical evidence',()=>{
 for(const state of ['DRAFT','QA_READY','PENDING_EBAY_SYNC','SYNCING','UNKNOWN_COMMIT','REQUIRES_ATTENTION','SYNCED']){
  const sync=view(asset,task,[{...row,state}]);const p=visualAssetStatusV1(visualEvidenceV1(sync))
  assert.deepEqual(friendlyVisualSyncV1(sync),p)
  assert.equal(proposalDeliveryStatusV1(sync).label,`${p.icon} ${p.label}`)
  assert.equal(visualListingStatusV1([sync]).status,p.status)
 }
 assert.equal(view().presentation.synced,true)
})
test('FULL_DELEGATION_PROJECTION_PASS no routine owner gate, while semantic guards fail closed',()=>{
 assert.equal(view().approvedForEbaySync,true);assert.equal(asset.owner_sync_approval,undefined)
 for(const [key] of Object.entries(checks)){
  const unsafe={...asset,qa_result:{...asset.qa_result,humanReview:{decision:'APPROVE',checks:{...checks,[key]:false}}}}
  assert.equal(view(unsafe).presentation.synced,false)
 }
 for(const patch of [{product_truth_digest:'different'},{source_image_set_digest:'different'},{status:'rejected'}, {mayel_approval_status:'PENDING'}])assert.equal(view({...asset,...patch}).presentation.synced,false)
 const pending=view({...asset,status:'pending_review'},task,[],{active:true,authorized:false})
 assert.equal(pending.presentation.label,'Mayel está revisando');assert.doesNotMatch(pending.presentation.action,/aprueba|autorizarla/)
 const manual=view({...asset,status:'pending_review'},task,[],{active:false,authorized:false})
 assert.match(manual.presentation.action,/revisión requerida/)
})
test('ACK, missing proof, timeout, UNKNOWN_COMMIT and isolated SYNCED never green',()=>{
 for(const state of ['SYNCED','SYNCING','OFFICIAL_READBACK_REQUIRED','UNKNOWN_COMMIT','UNKNOWN_COMMIT_STATE','TIMEOUT']){
  assert.equal(view(asset,task,[{...row,state,official_readback:false}]).presentation.synced,false)
  assert.equal(friendlyVisualSyncV1(state).synced,false)
 }
 assert.equal(view(asset,task,[{...row,execution_receipt:null}]).presentation.synced,false)
})
test('CROSS_ASSET_RECEIPT_BLOCKED_PASS / CROSS_GENERATION / CROSS_LISTING / ACCOUNT',()=>{
 for(const patch of [{item_id:'different'},{account_key:'different'},{binding:{...row.binding,assets:[{assetId:'other',sourceSha256:source}]}},
 {binding:{...row.binding,executionManifestDigest:'old'}},{execution_receipt:{...row.execution_receipt,manifestDigest:'old'}},
 {execution_receipt:{...row.execution_receipt,officialDigest:'different'}},{intent:{requestedChanges:{taskId:'other'}}}])assert.equal(view(asset,task,[{...row,...patch}]).presentation.steps.at(-1).complete,false)
 assert.equal(view({...asset,output_sha256:'c'.repeat(64)}).presentation.synced,false)
 assert.equal(view({...asset,source_sha256:'changed'}).presentation.synced,false)
})
test('DURABLE_ASSET_WITHOUT_THUMBNAIL_PASS independent generation, QA and storage milestones',()=>{
 const stored=view({...asset,status:'pending_review',mayel_approval_status:'PENDING',qa_result:{automaticStatus:'PASSED'}},task,[],{active:true,authorized:false})
 assert.equal(stored.generated,true);assert.equal(stored.savedToSellerOS,true);assert.equal(stored.qaPassed,false)
 assert.deepEqual(stored.presentation.steps.map(s=>s.complete),[true,false,true,false])
 assert.equal(view({...asset,output_storage_path:null}).generated,false)
})
test('MIXED_ASSET_LISTING_SUMMARY_PASS all current operations must complete',()=>{
 const done=view(),waiting={...done,state:'PENDING_EBAY_SYNC',officialReadback:false,readbackCompatible:false}
 for(const state of ['PENDING_EBAY_SYNC','UNKNOWN_COMMIT_STATE','REQUIRES_ATTENTION','QA_READY'])assert.equal(visualListingStatusV1([done,done,done,done,done,{...waiting,state}]).synced,false)
 assert.equal(visualListingStatusV1([done,done,done,done,done,done]).synced,true)
 assert.equal(visualListingStatusV1([done,{...waiting,discarded:true},{...waiting,rejected:true},{...waiting,state:'SUPERSEDED'}]).synced,true)
 assert.equal(visualListingStatusV1([]).synced,false)
})
test('QUOTA_HOLD_PRESENTATION_PASS pending without fictitious activity or retry',()=>{
 const status=friendlyVisualSyncV1({...view(),state:'PENDING_EBAY_SYNC',officialReadback:false,readbackCompatible:false})
 assert.equal(status.label,'Pendiente de eBay');assert.doesNotMatch(status.label,/Sincronizando/)
 assert.match(status.action,/no hace falta reenviarlo/)
})
test('local receipt label alone cannot claim synchronization or cross intent boundaries',()=>{
 const r={intent:{idempotencyKey:'current'},receipt:{id:'durable',idempotencyKey:'current',state:'SINCRONIZADO',internalState:'SYNCED',officialReadback:true}}
 assert.equal(friendlyVisualSyncV1(localReceiptVisualEvidenceV1(r)).synced,true)
 for(const patch of [{officialReadback:false},{idempotencyKey:'old'},{internalState:'UNKNOWN_COMMIT'},{id:''}])assert.equal(friendlyVisualSyncV1(localReceiptVisualEvidenceV1({...r,receipt:{...r.receipt,...patch}})).synced,false)
})
test('IPAD_STEPPER_RENDER_PASS actual SSR render has icon text colors and no network',()=>{
 let network=0;const old=globalThis.fetch;globalThis.fetch=()=>{network++;throw Error('NO_NETWORK_ALLOWED')}
 try{
  const filename=new URL('../../app/admin/ebay/mayel/visual-asset-progress.tsx',import.meta.url)
  const code=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
  const exports={};vm.runInNewContext(code,{exports,require:createRequire(import.meta.url)})
  const html=renderToStaticMarkup(React.createElement(exports.MayelVisualAssetProgress,{status:view().presentation}))
  for(const text of ['Progreso de esta imagen','Generada','QA','Seller OS','eBay','Sincronizada con eBay','🟢','bg-green-50'])assert.ok(html.includes(text),text)
  assert.equal(network,0)
 }finally{globalThis.fetch=old}
})
test('UI binding, delegation parity, no new polling, and non-delegated review are retained',()=>{
 const read=p=>readFileSync(new URL(p,import.meta.url),'utf8')
 const ws=read('../../app/admin/mayel-visual-workstation.tsx'),secondary=read('../../app/admin/ebay/mayel/image-workspace.tsx'),server=read('./mayel-image-workspace-v1.ts')
 assert.doesNotMatch(ws,/generated: Boolean\(output.previewUrl\)/)
 assert.match(ws,/MayelVisualAssetProgress status=\{visualAssetStatusV1\(visualEvidenceV1\(output\?\.sync\)/)
 assert.match(secondary,/!row.autonomousOptimization/)
 assert.doesNotMatch(secondary,/Puedes revisar propuestas y confirmar su envío|Confirmar y enviar cuando eBay esté disponible/)
 assert.match(server,/readDelegatedVisualAuthorityV1/);assert.match(server,/authorized: delegated\?\.authorized === true/)
 const presentation=read('./mayel-visual-asset-status-v1.ts')+read('./mayel-gallery-presentation-v1.ts')
 assert.doesNotMatch(presentation,/fetch\(|setInterval|setTimeout|\.rpc\(|\.update\(/)
})

test('current manifest missing asset cannot disappear from listing summary; old recovery does not override valid receipt',()=>{
 const snapshot={outputs:[{id:asset.id,status:'approved',sync:view()}],visualManifest:task.visual_manifest,currentGalleryProven:true}
 assert.equal(visualTaskStatusV1(snapshot).synced,true)
 assert.equal(visualTaskStatusV1({...snapshot,visualManifest:{proposedOrderedImages:[...task.visual_manifest.proposedOrderedImages,{assetId:'missing'}]}}).synced,false)
 assert.equal(visualTaskStatusV1({...snapshot,galleryRecovery:{state:'WAITING_FOR_EBAY'}}).synced,true)
 assert.equal(visualTaskStatusV1({...snapshot,currentGalleryProven:false,galleryRecovery:{state:'WAITING_FOR_EBAY'}}).synced,false)
 assert.equal(visualTaskStatusV1({...snapshot,outputs:[...snapshot.outputs,{id:'new',status:'pending_review',sync:{state:'QA_READY'}}]}).synced,false)
})

test('newer official receipt supersedes prewrite snapshot; later contrary gallery blocks historical green',()=>{
 const before={...task,selection_signal:{currentOfficialGallery:{authority:'CURRENT_OFFICIAL_ORDERED_IMAGE_SET',digest:'before',observedAt:'2026-09-10T17:09:38Z'}}}
 const proof={...row,execution_receipt:{...row.execution_receipt,observedAt:'2026-09-10T17:36:40Z'}}
 assert.equal(view(asset,before,[proof]).presentation.synced,true)
 const later={...before,selection_signal:{currentOfficialGallery:{...before.selection_signal.currentOfficialGallery,observedAt:'2026-09-10T18:00:00Z'}}}
 assert.equal(view(asset,later,[proof]).presentation.synced,false)
 assert.equal(view(asset,before,[{...proof,official_readback:false}]).presentation.synced,false)
})

test('owner-only attention is scoped to the current asset/task/listing/account/manifest',()=>{
 const action={required:true,humanOnly:true,proven:true,action:'Confirma el producto correcto.',reasonCode:'CANONICAL_IDENTITY_AMBIGUOUS',sourceReference:'current-decision'}
 const attention={...row,state:'REQUIRES_ATTENTION',official_readback:false,execution_receipt:{ownerAction:action}}
 assert.equal(view(asset,task,[attention]).presentation.assistantRedAttention,true)
 for(const patch of [{item_id:'other'},{account_key:'other'},{binding:{assets:[{assetId:'other',sourceSha256:source}]}},{intent:{requestedChanges:{taskId:'other',manifestDigest:digest}}},{intent:{requestedChanges:{taskId:task.id,manifestDigest:'old'}}},{intent:{requestedChanges:{manifestDigest:digest}}}]){
  assert.equal(view(asset,task,[{...attention,...patch}]).presentation.assistantRedAttention,false)
 }
})
