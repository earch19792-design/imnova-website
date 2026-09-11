import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {visualAssetStatusV1, VISUAL_STATUS_DESIGN_V1} from './mayel-visual-asset-status-v1.ts'
const base={generated:true,qaPassed:false,savedToSellerOS:false,ownerApproved:false,serverReceiptPresent:false,officialReadback:false,state:'DRAFT'}
test('VISUAL_STATUS_COLORS_AND_LABELS_PASS all seven states require icon and text',()=>{
 assert.deepEqual(Object.values(VISUAL_STATUS_DESIGN_V1).map(v=>v.color),['blue','violet','teal','amber','orange','green','red'])
 for(const v of Object.values(VISUAL_STATUS_DESIGN_V1))assert.ok(v.icon&&v.label&&v.className)
 assert.equal(visualAssetStatusV1(base).status,'MEJORA_GENERADA')
 assert.equal(visualAssetStatusV1({...base,qaPassed:true}).status,'QA_APROBADO')
 assert.equal(visualAssetStatusV1({...base,savedToSellerOS:true}).status,'GUARDADA_EN_SELLER_OS')
 assert.equal(visualAssetStatusV1({...base,savedToSellerOS:true,qaPassed:true}).status,'OWNER_APPROVAL_REQUIRED')
})
test('NO_FALSE_SYNCED_MESSAGE_PASS excludes dispatch, timeout and unverified SYNCED',()=>{
 for(const state of ['SYNCED','SYNCING','OFFICIAL_READBACK_REQUIRED','UNKNOWN_COMMIT']){
  assert.notEqual(visualAssetStatusV1({...base,qaPassed:true,savedToSellerOS:true,ownerApproved:true,serverReceiptPresent:true,state}).status,'SYNCED_WITH_EBAY')
 }
 const done={...base,qaPassed:true,savedToSellerOS:true,ownerApproved:true,serverReceiptPresent:true,state:'SYNCED',officialReadback:true,readbackCompatible:true}
 assert.equal(visualAssetStatusV1(done).status,'SYNCED_WITH_EBAY')
 for(const k of ['qaPassed','savedToSellerOS','ownerApproved','serverReceiptPresent','officialReadback','readbackCompatible'])assert.equal(visualAssetStatusV1({...done,[k]:false}).synced,false)
})
test('PER_IMAGE_STATUS_PASS / PROGRESS_STEPPER_PASS six independent assets',()=>{
 const six=[base,{...base,qaPassed:true},{...base,savedToSellerOS:true},{...base,savedToSellerOS:true,qaPassed:true},
  {...base,qaPassed:true,savedToSellerOS:true,ownerApproved:true,serverReceiptPresent:true,state:'PENDING_EBAY_SYNC'},
  {...base,qaPassed:true,savedToSellerOS:true,ownerApproved:true,serverReceiptPresent:true,state:'SYNCED',officialReadback:true,readbackCompatible:true}].map(visualAssetStatusV1)
 assert.equal(new Set(six.map(x=>x.status)).size,6)
 assert.deepEqual(six[5].steps.map(x=>x.label),['Generada','QA','Seller OS','eBay'])
 assert.equal(six[4].steps.at(-1).complete,false);assert.equal(six[5].steps.at(-1).complete,true)
})
test('IPAD_VISUAL_STATUS_PASS visible labels, touch targets, details remain closed',()=>{
 const ui=readFileSync(new URL('../../app/admin/mayel-visual-workstation.tsx',import.meta.url),'utf8')
 const progress=readFileSync(new URL("../../app/admin/ebay/mayel/visual-asset-progress.tsx",import.meta.url),"utf8")
 assert.match(progress,/aria-label="Progreso de esta imagen"/);assert.match(progress,/status.icon.*status.label/)
 assert.match(progress,/minmax\(7rem,1fr\)/);assert.match(ui,/min-h-11/)
 assert.match(ui,/<summary>Ver detalles<\/summary>/);assert.doesNotMatch(ui,/<details[^>]*\bopen[ =>]/)
 assert.match(ui,/SAVE_ASSET_INTENT/);assert.match(ui,/visualIntent: intent, targetImagePosition: targetPosition/)
})
