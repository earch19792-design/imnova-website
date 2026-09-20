import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { buildVisualIntentManifestV1 } from './mayel-visual-intent-v1.ts'
import { buildFullGalleryMutationV1 } from './mayel-full-gallery-mutation-v1.ts'
import { discardProposalManifestV1, discardedProposalIdsV1 } from './mayel-proposal-discard-v1.ts'
import { proposalSlotLabelV1, proposalDeliveryStatusV1 } from './mayel-gallery-presentation-v1.ts'
import { delegatedVisualQaV1 } from './mayel-optimization-delegation-v1.ts'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`, truth='sha256:'+'a'.repeat(64)
const current='ABCDEF'.split('').map(c=>`https://i.ebayimg.com/${c}.jpg`)
const assets=[{assetId:id(2),role:'DETAIL',outputSha256:'b'.repeat(64),publicUrl:'https://own.test/X.jpg'},
 {assetId:id(3),role:'DIMENSIONS',outputSha256:'c'.repeat(64),publicUrl:'https://own.test/Y.jpg'},
 {assetId:id(4),role:'PACKAGE_CONTENTS',outputSha256:'d'.repeat(64),publicUrl:'https://own.test/Z.jpg'}]
const common={visualTaskId:id(1),ebayItemId:'366574069492',currentImages:current,assets,productTruthDigest:truth,sourceImageSetDigest:truth}
const make=()=>buildVisualIntentManifestV1({...common,intents:[{assetId:id(2),visualIntent:'REPLACE_MAIN',targetImagePosition:0},
 {assetId:id(3),visualIntent:'REPLACE_SLOT',targetImagePosition:3},{assetId:id(4),visualIntent:'ADD_SECONDARY',targetImagePosition:6}]})
const discard=(manifest,assetIds)=>discardProposalManifestV1({taskId:id(1),itemId:common.ebayItemId,accountKey:'account',manifest,assetIds,assets})
test('9492: discard proposal 4 and 7 restores original 4 and removes only proposed addition',()=>{
 const m=make(),next=discard(m,[id(3),id(4)])
 assert.equal(m.proposedOrderedImages.length,7);assert.equal(next.proposedOrderedImages.length,6)
 assert.deepEqual(next.proposedOrderedImages.map(e=>e.publicUrl),[assets[0].publicUrl,...current.slice(1)])
 assert.equal(next.proposedOrderedImages[3].publicUrl,current[3]);assert.notEqual(next.visualManifestDigest,m.visualManifestDigest)
 assert.deepEqual(next.currentOfficialImageSet,current);assert.deepEqual(next.visualIntents,[{assetId:id(2),visualIntent:'REPLACE_MAIN',targetImagePosition:0}])
})
test('discard last/main proposal leaves original complete gallery, never empty',()=>{
 const next=discard(make(),assets.map(a=>a.assetId))
 assert.deepEqual(next.proposedOrderedImages.map(e=>e.publicUrl),current)
 assert.equal(next.selectedHeroAssetId,null);assert.equal(next.mainImageChange,false)
 assert.throws(()=>discard(make(),[id(9)]),/BINDING/)
 assert.throws(()=>discardProposalManifestV1({taskId:id(8),itemId:common.ebayItemId,accountKey:'account',manifest:make(),assetIds:[id(2)],assets}),/BINDING/)
})
test('full-gallery insertion cancellation preserves the other explicit slot decisions',()=>{
 const decisions=current.map((u,p)=>({action:'KEEP',sourcePosition:p,targetPosition:p,assetId:null,visualRole:p?'CURRENT':'MAIN',intentReason:'Keep'}))
 for(const d of decisions)if(d.targetPosition>=2)d.targetPosition++
 decisions.push({action:'ADD',sourcePosition:null,targetPosition:2,assetId:id(4),visualRole:'PACKAGE_CONTENTS',intentReason:'Show contents'})
 decisions[3]={...decisions[3],action:'REPLACE',assetId:id(3)}
 const m=buildFullGalleryMutationV1({...common,accountKey:'account',generation:truth,decisions})
 const next=discard(m,[id(4)])
 assert.equal(next.proposedOrderedImages[3].assetId,id(3));assert.equal(next.proposedOrderedImages.length,6)
 assert.deepEqual(next.proposedOrderedImages.filter(e=>!e.assetId).map(e=>e.publicUrl),current.filter((_,p)=>p!==3))
})
test('discarded disposition blocks delegated QA without rewriting historical semantic QA',()=>{
 const a={id:id(2),status:'approved',mayel_approval_status:'APPROVED',product_truth_digest:truth,source_image_set_digest:truth,
  qa_result:{automaticStatus:'PASSED',humanReview:{decision:'APPROVE',checks:{productIdentityPreserved:true,noUnsupportedClaims:true,noInventedAccessories:true,noUnauthorizedText:true}}}}
 const t={product_truth_digest:truth,source_image_set_digest:truth,selection_signal:{discardedVisualAssetIds:[id(2)]}}
 assert.equal(delegatedVisualQaV1(a,{...t,selection_signal:{}}),true);assert.equal(delegatedVisualQaV1(a,t),false)
 assert.deepEqual(discardedProposalIdsV1(t.selection_signal),[id(2)]);assert.equal(a.qa_result.automaticStatus,'PASSED')
})
test('friendly labels separate proposed addition and replacement from original eBay positions',()=>{
 assert.deepEqual(proposalSlotLabelV1(6,null,'ADD'),{slot:'Imagen 7',action:'Agregar como imagen 7'})
 assert.equal(proposalSlotLabelV1(3,3,'REPLACE').action,'Reemplazar imagen 4')
 const ui=readFileSync('app/admin/mayel-visual-workstation.tsx','utf8')
 for(const text of ['ANTES · Última galería verificada de eBay','DESPUÉS · Preview de Mayel','Descartar propuesta','Propuestas descartadas · historial','Quitar de la vista','Rechazada y archivada','No confirma que las imágenes ya estén en eBay.'])assert.ok(ui.includes(text))
 const server=readFileSync('lib/seller-os/mayel-proposal-discard-server-v1.ts','utf8')
 assert.doesNotMatch(server,/fetch\(|readCurrentMayelGallery|enqueueDelegatedVisual/)
})
test('per-image pending state requires durable queue; rejected/discarded assets never pending and green requires official readback',()=>{
 assert.equal(proposalDeliveryStatusV1({state:'PENDING_EBAY_SYNC',serverReceiptPresent:true}).kind,'PENDING')
 assert.equal(proposalDeliveryStatusV1({state:'PENDING_EBAY_SYNC',serverReceiptPresent:false}).kind,'SAVED')
 assert.equal(proposalDeliveryStatusV1({state:'PENDING_EBAY_SYNC',serverReceiptPresent:true,discarded:true}).kind,'ARCHIVED')
 assert.equal(proposalDeliveryStatusV1({state:'PENDING_EBAY_SYNC',serverReceiptPresent:true,rejected:true}).kind,'REJECTED')
 assert.equal(proposalDeliveryStatusV1({state:'SYNCED',officialReadback:false}).kind,'SAVED')
 assert.equal(proposalDeliveryStatusV1({state:'SYNCED',officialReadback:true,readbackCompatible:true,generated:true,qaPassed:true,savedToSellerOS:true,ownerApproved:true,serverReceiptPresent:true}).kind,'SYNCED')
 assert.equal(proposalDeliveryStatusV1({state:'DRAFT',serverReceiptPresent:true}).kind,'SAVED')
})

test('atomic durable discard: actor/CAS, idempotency, immutable history, no stale resurrection, unknown commit fails closed',async()=>{
 const db=new PGlite()
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);
 create table public.ebay_mayel_visual_tasks_v1(id uuid primary key,marketplace_account_key text,ebay_item_id text,assigned_operator_user_id uuid,status text,visual_manifest jsonb,visual_manifest_digest text,selection_signal jsonb,updated_at timestamptz);
 create table public.seller_os_mayel_optimization_grants_v1(account_key text,owner_user_id uuid,status text,revoked_at timestamptz);
 create table public.ebay_listing_image_assets(id uuid,account_key text,mayel_visual_task_id uuid,status text,mayel_approval_status text,qa_result jsonb);
 create table public.ebay_mayel_visual_phase_b_executions_v1(visual_task_id uuid,visual_manifest_digest text);
 create table public.seller_os_ipad_outbox_v1(id uuid,state text,dispatch_count integer,lease_until timestamptz,account_key text,item_id text,kind text,intent jsonb,reason_code text,updated_at timestamptz,lease_token uuid);
 create table public.seller_os_mayel_content_outbox_v1(id uuid,state text,dispatch_count integer,lease_until timestamptz,account_key text,item_id text,task_id uuid,audit jsonb,reason_code text,updated_at timestamptz,lease_token uuid);`)
 await db.exec(readFileSync('supabase/migrations/20260910202848_mayel_proposal_discard_and_gallery_labels_v1.sql','utf8'))
 await db.exec(readFileSync('supabase/migrations/20260910204526_mayel_rejected_proposal_archive_v1.sql','utf8'))
 const m=make(),next=discard(m,[id(3),id(4)])
 await db.query('insert into auth.users values($1)',[id(10)])
 await db.query("insert into seller_os_mayel_optimization_grants_v1 values('account',$1,'ACTIVE',null)",[id(10)])
 await db.query("insert into ebay_mayel_visual_tasks_v1 values($1,'account',$2,$3,'OWNER_PREVIEW_READY',$4,$5,'{}',now())",[id(1),common.ebayItemId,id(11),m,m.visualManifestDigest])
 await db.query("insert into seller_os_ipad_outbox_v1(id,state,dispatch_count,account_key,item_id,kind,intent) values($1,'PENDING_EBAY_SYNC',0,'account',$2,'IMAGE_SYNC',$3)",[id(12),common.ebayItemId,{requestedChanges:{taskId:id(1)}}])
 const call=(actor=id(10),digest=m.visualManifestDigest)=>db.query('select seller_os_discard_mayel_proposals_v1($1,$2,$3,$4,$5,$6,$7) as result',['account',actor,id(1),common.ebayItemId,digest,[id(3),id(4)],next])
 await assert.rejects(call(id(99)),/ACTOR_OR_TASK/);await assert.rejects(call(id(10),truth),/PREVIEW_CHANGED/)
 await db.query("update seller_os_ipad_outbox_v1 set state='UNKNOWN_COMMIT',dispatch_count=1")
 await assert.rejects(call(),/OFFICIAL_RECONCILIATION/)
 assert.equal((await db.query('select visual_manifest_digest from ebay_mayel_visual_tasks_v1')).rows[0].visual_manifest_digest,m.visualManifestDigest)
 await db.query("update seller_os_ipad_outbox_v1 set state='PENDING_EBAY_SYNC',dispatch_count=0,lease_until=now()+interval '1 minute'")
 await assert.rejects(call(),/OFFICIAL_RECONCILIATION/)
 await db.query('update seller_os_ipad_outbox_v1 set lease_until=null')
 assert.equal((await call()).rows[0].result.status,'PROPOSALS_DISCARDED')
 assert.equal((await call()).rows[0].result.idempotent,true)
 assert.equal((await db.query('select id from seller_os_mayel_proposal_discards_v1')).rows.length,1)
 assert.equal((await db.query('select state from seller_os_ipad_outbox_v1')).rows[0].state,'SUPERSEDED')
 await assert.rejects(db.query('update ebay_mayel_visual_tasks_v1 set visual_manifest=$1',[m]),/DISCARDED_ASSET/)
 await assert.rejects(db.query("update ebay_mayel_visual_tasks_v1 set selection_signal='{}'"),/HISTORY_IMMUTABLE/)
 await assert.rejects(db.query('delete from seller_os_mayel_proposal_discards_v1'),/HISTORY_IMMUTABLE/)
 assert.equal((await db.query("select has_function_privilege('anon','seller_os_discard_mayel_proposals_v1(text,uuid,uuid,text,text,jsonb,jsonb)','EXECUTE') as allowed")).rows[0].allowed,false)
 await db.query("insert into ebay_listing_image_assets values($1,'account',$2,'rejected','REJECTED',$3),($4,'account',$2,'approved','APPROVED',$5)",[id(20),id(1),{humanReview:{reason:'IDENTITY_DRIFT'}},id(21),{automaticStatus:'PASSED'}])
 const archive=(actor=id(10),asset=id(20))=>db.query('select seller_os_archive_rejected_proposals_v1($1,$2,$3,$4,$5) as result',['account',actor,id(1),common.ebayItemId,[asset]])
 await assert.rejects(archive(id(99)),/ACTOR_OR_TASK/)
 await assert.rejects(archive(id(10),id(21)),/FINAL_REJECTION_REQUIRED/)
 assert.equal((await archive()).rows[0].result.status,'REJECTED_PROPOSALS_ARCHIVED')
 assert.equal((await archive()).rows[0].result.idempotent,true)
 assert.equal((await db.query('select visual_manifest_digest from ebay_mayel_visual_tasks_v1')).rows[0].visual_manifest_digest,next.visualManifestDigest)
 assert.deepEqual((await db.query('select status,mayel_approval_status,qa_result from ebay_listing_image_assets where id=$1',[id(20)])).rows[0],{status:'rejected',mayel_approval_status:'REJECTED',qa_result:{humanReview:{reason:'IDENTITY_DRIFT'}}})
 assert.ok((await db.query('select selection_signal from ebay_mayel_visual_tasks_v1')).rows[0].selection_signal.discardedVisualAssetIds.includes(id(20)))
 assert.equal((await db.query("select has_function_privilege('anon','seller_os_archive_rejected_proposals_v1(text,uuid,uuid,text,jsonb)','EXECUTE') as allowed")).rows[0].allowed,false)

 } finally { await db.close() }
})
