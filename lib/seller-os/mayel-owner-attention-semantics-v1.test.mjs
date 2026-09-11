import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import {readFileSync} from 'node:fs'
import {visualAssetStatusV1,visualEvidenceV1,visualListingStatusV1,localReceiptVisualEvidenceV1} from './mayel-visual-asset-status-v1.ts'
import {friendlyVisualSyncV1} from './mayel-visual-scope-v1.ts'
import {proposalDeliveryStatusV1} from './mayel-gallery-presentation-v1.ts'
import {publicOutboxReceiptV1} from './ipad-durable-outbox-v1.ts'
const status=e=>visualAssetStatusV1(visualEvidenceV1(e))
const recovered7727={state:'REQUIRES_ATTENTION',reasonCode:'MATERIAL_LISTING_DRIFT',autonomousOptimization:true,
 generated:true,qaPassed:true,savedToSellerOS:true,approvedForEbaySync:true,serverReceiptPresent:true,
 ownerActionRequired:false,listingOperationalHealth:'LIVE_ACTIVE'}
const human=reasonCode=>({required:true,humanOnly:true,proven:true,reasonCode,action:'Confirma la identidad correcta del producto.',sourceReference:'current-resolution:7727:1'})
test('366650047727: recoverable technical attention does not ask the owner or change listing health',()=>{
 const before=structuredClone(recovered7727), p=status(recovered7727)
 assert.equal(p.assistantRedAttention,false);assert.equal(p.ownerActionRequired,false);assert.equal(p.ownerCtaPresent,false)
 assert.equal(p.assistantState,'WAITING_OR_AUTOMATIC_RECOVERY');assert.equal(p.label,'Mayel está revisando')
 assert.equal(p.mayelWorkflowState,'REQUIRES_ATTENTION');assert.equal(p.listingOperationalHealth,'LIVE_ACTIVE');assert.equal(p.ownerActionState,'NONE_REQUIRED')
 assert.match(p.action,/No necesitas hacer nada/);assert.equal(p.synced,false);assert.deepEqual(recovered7727,before)
 const current=status({...recovered7727,state:'PENDING_EBAY_SYNC',reasonCode:'EBAY_RATE_LIMITED'})
 assert.equal(current.label,'Pendiente de eBay');assert.equal(current.ownerCtaPresent,false)
})
test('generic HUMAN_REVIEW, missing evidence, STALE and UNKNOWN never prove a human action',()=>{
 for(const state of ['REQUIRES_ATTENTION','ATTENTION','MATERIAL_LISTING_DRIFT','HUMAN_REVIEW','HUMAN_REVIEW_REQUIRED','STALE','UNKNOWN','INSUFFICIENT_EVIDENCE','INSUFFICIENT_ANALYTICS_EVIDENCE','READBACK_REQUIRED','UNKNOWN_COMMIT_STATE']){
  for(const ownerActionRequired of [false,undefined]){
   const p=status({...recovered7727,state,ownerActionRequired})
   assert.equal(p.assistantRedAttention,false,state);assert.equal(p.ownerCtaPresent,false,state);assert.equal(p.synced,false,state)
   assert.equal(p.color,'amber');assert.match(p.action,/No necesitas hacer nada/)
  }
 }
})
test('only explicit owner requirement or current concrete proven human-only blocker is red',()=>{
 for(const reason of ['CANONICAL_IDENTITY_AMBIGUOUS','OAUTH_OWNER_CONSENT_REQUIRED','MATERIAL_MISMATCH_OWNER_DECISION_REQUIRED','ESSENTIAL_INFORMATION_HUMAN_ONLY']){
  const p=status({...recovered7727,ownerAction:human(reason)})
  assert.equal(p.assistantRedAttention,true);assert.equal(p.ownerActionRequired,true);assert.equal(p.ownerCtaPresent,true)
  assert.equal(p.ownerActionState,'REQUIRED');assert.equal(p.listingOperationalHealth,'LIVE_ACTIVE');assert.doesNotMatch(p.action,/No necesitas hacer nada/)
 }
 assert.equal(status({...recovered7727,ownerActionRequired:true}).assistantRedAttention,true)
 for(const patch of [{proven:false},{humanOnly:false},{required:false},{sourceReference:''},{action:''},{action:123}])
  assert.equal(status({...recovered7727,ownerAction:{...human('IDENTITY'),...patch}}).assistantRedAttention,false)
})
test('same durable evidence is identical across asset, listing, slot and generic Assistant projection',()=>{
 for(const e of [recovered7727,{...recovered7727,state:'STALE'},{...recovered7727,ownerAction:human('IDENTITY')}]){
  const p=status(e)
  assert.deepEqual(friendlyVisualSyncV1(e),p);assert.equal(visualListingStatusV1([e]).status,p.status)
  assert.equal(proposalDeliveryStatusV1(e).label,`${p.icon} ${p.label}`)
 }
 const rows=Array.from({length:6},()=>recovered7727)
 assert.equal(visualListingStatusV1(rows).assistantRedAttention,false)
 assert.equal(visualListingStatusV1([...rows,{...recovered7727,ownerAction:human('IDENTITY')}]).assistantRedAttention,true)
 assert.equal(visualListingStatusV1([...rows,{...recovered7727,ownerAction:human('IDENTITY'),discarded:true}]).assistantRedAttention,false)
})
test('local receipt retains scoped server owner evidence; legacy local red labels cannot create it',()=>{
 const row={id:'order7727',idempotency_key:'current',state:'REQUIRES_ATTENTION',reason_code:'MATERIAL_LISTING_DRIFT',binding:{ownerDelegation:{}},execution_receipt:{},payload_hash:'hash'}
 const receipt=publicOutboxReceiptV1(row), local=r=>status(localReceiptVisualEvidenceV1({intent:{idempotencyKey:'current'},receipt:r}))
 assert.equal(local(receipt).assistantRedAttention,false)
 const actual=publicOutboxReceiptV1({...row,execution_receipt:{ownerAction:human('IDENTITY')}})
 assert.equal(local(actual).assistantRedAttention,true)
 assert.equal(local({...actual,idempotencyKey:'historical'}).assistantRedAttention,false)
 const nonDelegated=publicOutboxReceiptV1({...row,binding:{},state:'OWNER_APPROVAL_REQUIRED',reason_code:'OWNER_VISUAL_REVIEW_REQUIRED'})
 assert.equal(local(nonDelegated).ownerCtaPresent,true)
})
test('projection does not perform network or weaken write/QA/readback authority',()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('NO_NETWORK')}
 try {for(const e of [recovered7727,{...recovered7727,qaPassed:false},{...recovered7727,state:'SYNCED',officialReadback:false}]){
  assert.equal(status(e).synced,false);assert.equal(status(e).steps.at(-1).complete,false)
 }assert.equal(calls,0)}finally{globalThis.fetch=original}
 const main=readFileSync(new URL('../../app/admin/mayel-visual-workstation.tsx',import.meta.url),'utf8')
 assert.match(main,/status.ownerCtaPresent && output.status === "approved"/)
 assert.match(main,/output.status === "pending_review" && status.ownerCtaPresent/)
 assert.doesNotMatch(main,/Requiere atención\. Revisa el estado de tu propuesta guardada/)
})

test('rendered asset stepper communicates yellow waiting with no owner CTA and independent state axes',()=>{
 const code=ts.transpileModule(readFileSync(new URL('../../app/admin/ebay/mayel/visual-asset-progress.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
 const exports={};vm.runInNewContext(code,{exports,require:createRequire(import.meta.url)})
 const html=renderToStaticMarkup(React.createElement(exports.MayelVisualAssetProgress,{status:status(recovered7727)}))
 for(const text of ['🟡','Mayel está revisando','No necesitas hacer nada','bg-amber-50','data-owner-action-state="NONE_REQUIRED"','data-mayel-workflow-state="REQUIRES_ATTENTION"','data-listing-operational-health="LIVE_ACTIVE"'])assert.ok(html.includes(text),text)
 assert.doesNotMatch(html,/🔴|bg-red-50|<button|Aprobar/)
 const waiting=status({...recovered7727,reasonCode:'EBAY_QUOTA_EXHAUSTED'})
 assert.equal(waiting.label,'Pendiente de eBay');assert.equal(waiting.ownerActionRequired,false)
})
