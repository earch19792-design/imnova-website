import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {registerHooks} from 'node:module'
import {PGlite} from '@electric-sql/pglite'
import {MAYEL_REMOVAL_REASONS_V1 as reasons,MAYEL_REMOVAL_CHECKS_V1 as required,semanticRemovalReviewMatchesV1} from './mayel-semantic-removal-v1.ts'
import {buildFullGalleryMutationV1} from './mayel-full-gallery-mutation-v1.ts'
registerHooks({resolve(s,c,n){return s==='server-only'?{url:'data:text/javascript,export{}',shortCircuit:true}:n(s,c)}})
const {provenGalleryRemovalsV1}=await import('./mayel-full-gallery-server-v1.ts')
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const truth='sha256:'+'a'.repeat(64),old='sha256:'+'b'.repeat(64)
const current=['https://i.ebayimg.com/A.jpg','https://i.ebayimg.com/B.jpg','https://i.ebayimg.com/C.jpg'],final=[current[0],current[2]]
const checks=()=>({...Object.fromEntries(required.map(k=>[k,true])),identityDrift:false,productUncertainty:false,unsupportedClaimCount:0,competitorContaminationCount:0})
const review=()=>({contract:'MAYEL_SEMANTIC_REMOVAL_REVIEW_V1',itemId:'366643122092',productTruthDigest:truth,sourceImageSetDigest:truth,
 baseManifestDigest:old,currentImages:current,finalImages:final,sourcePosition:1,reason:'LOW_QUALITY',evidenceReferences:current,
 explanation:'Fixture semantic assessment: the retained views demonstrate all required product information.',checks:checks()})
const task={id:id(1),marketplace_account_key:'account',ebay_item_id:'366643122092',product_truth_digest:truth,source_image_set_digest:truth,source_image_references:[]}
function decisions(rid,reason='LOW_QUALITY'){return current.map((url,p)=>({action:p===1?'REMOVE':'KEEP',sourcePosition:p,targetPosition:p===1?null:p===2?1:0,
 assetId:null,visualRole:p?'DETAIL':'MAIN',intentReason:'Keep required product evidence in retained views.',...(p===1?{removalEvidence:{reviewId:rid,baseManifestDigest:old,reason,
 productTruthDigest:truth,evidenceReferences:current,noRequiredEvidenceLost:true,semanticQaPassed:true}}:{})}))}
const manifest=(rid,reason)=>buildFullGalleryMutationV1({visualTaskId:id(1),ebayItemId:task.ebay_item_id,accountKey:'account',generation:old,
 currentImages:current,assets:[],decisions:decisions(rid,reason),productTruthDigest:truth,sourceImageSetDigest:truth})
const row=(rid=id(7))=>({id:rid,account_key:'account',task_id:id(1),item_id:task.ebay_item_id,product_truth_digest:truth,source_image_set_digest:truth,
 base_manifest_digest:old,current_images:current,final_images:final,source_position:1,reason:'LOW_QUALITY',evidence_references:current,checks:checks(),revoked_at:null})
test('all supported reasons need an exact durable receipt; booleans and stale/foreign receipts cannot authorize removal',()=>{
 for(const reason of reasons){const r={...row(),reason};assert.equal(provenGalleryRemovalsV1(task,decisions(r.id,reason),current,[r],final),true)}
 assert.equal(provenGalleryRemovalsV1(task,decisions(id(7)),current,[],final),false)
 for(const patch of [{account_key:'foreign'},{task_id:id(2)},{item_id:'366650047727'},{source_position:0},{product_truth_digest:old},
  {source_image_set_digest:old},{base_manifest_digest:truth},{current_images:[...current].reverse()},{final_images:[...final].reverse()},
  {revoked_at:'2026-09-11'},{reason:'IDENTITY_DRIFT'},{evidence_references:[]}]){
  assert.equal(provenGalleryRemovalsV1(task,decisions(id(7)),current,[{...row(),...patch}],final),false,JSON.stringify(patch))
 }
 for(const k of required)assert.equal(semanticRemovalReviewMatchesV1({review:{...row(),checks:{...checks(),[k]:false}},task,decision:decisions(id(7))[1],currentImages:current,finalImages:final}),false)
 for(const k of ['identityDrift','productUncertainty'])assert.equal(provenGalleryRemovalsV1(task,decisions(id(7)),current,[{...row(),checks:{...checks(),[k]:true}}],final),false)
})
async function setup(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
 create table seller_os_mayel_optimization_grants_v1(id uuid primary key,account_key text,owner_user_id uuid,scope text,status text,revoked_at timestamptz,contract_version text,allowed_actions jsonb);
 create table ebay_mayel_visual_tasks_v1(id uuid primary key,marketplace_account_key text,assigned_operator_user_id uuid,ebay_item_id text,status text,selection_signal jsonb,visual_manifest jsonb,visual_manifest_id uuid,visual_manifest_digest text,product_truth_digest text,source_image_set_digest text,source_image_references jsonb,evidence_pack jsonb,current_image_set jsonb,updated_at timestamptz);
 create table ebay_mayel_visual_delegation_authorities_v1(marketplace_account_key text,owner_user_id uuid,status text,revoked_at timestamptz);
 create table ebay_listing_image_assets(id uuid,account_key text,mayel_visual_task_id uuid,status text,mayel_approval_status text,mayel_output_role text,output_sha256 text,public_url text,source_image_set_digest text,product_truth_digest text,qa_result jsonb);
 create table ebay_mayel_visual_phase_b_executions_v1(marketplace_account_key text,visual_task_id uuid,visual_manifest_digest text,phase text);
 create table seller_os_ipad_outbox_v1(account_key text,kind text,state text,intent jsonb,dispatch_count integer);
 create table seller_os_mayel_content_outbox_v1(task_id uuid,account_key text,audit jsonb);
 create function seller_os_visual_current_product_truth_v1(t ebay_mayel_visual_tasks_v1) returns jsonb language sql as $$select null::jsonb$$;`)
 const migration=name=>readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8')
 await db.exec(migration('20260910192811_mayel_full_gallery_mutation_control_v1.sql'))
 const semantic=migration('20260910175642_mayel_approved_asset_transition_recovery_v1.sql').split('create function public.seller_os_record_visual_safe_decision_v1')[0].replace('begin;','')
 await db.exec(semantic)
 await db.exec(migration('20260911054255_mayel_semantic_gallery_removal_authority_v1.sql'))
 await db.query('insert into auth.users values ($1)',[id(5)])
 await db.query(`insert into seller_os_mayel_optimization_grants_v1 values ($1,'account',$2,'FULL','ACTIVE',null,'MAYEL_AUTONOMOUS_LISTING_OPTIMIZATION_DELEGATION_V1','[]')`,[id(4),id(5)])
 await db.query(`insert into ebay_mayel_visual_delegation_authorities_v1 values ('account',$1,'ACTIVE',null)`,[id(5)])
 await db.query(`insert into seller_os_mayel_gallery_removal_grants_v1(grant_id,account_key,owner_user_id,owner_instruction) values ($1,'account',$2,'{}')`,[id(4),id(5)])
 await db.query(`insert into ebay_mayel_visual_tasks_v1(id,marketplace_account_key,assigned_operator_user_id,ebay_item_id,status,selection_signal,current_image_set,product_truth_digest,source_image_set_digest,visual_manifest_digest,source_image_references)
 values ($1,'account',$2,'366643122092','OWNER_PREVIEW_READY',$3,$4,$5,$5,$6,'[]')`,[id(1),id(5),JSON.stringify({productTruthSupported:true,currentOfficialGallery:{authority:'CURRENT_OFFICIAL_ORDERED_IMAGE_SET',images:current}}),JSON.stringify(current),truth,old])
 return db}
test('real durable producer/consumer: semantic removal beyond duplicate hashes, immutable/idempotent receipts and revalidation',async()=>{
 const db=await setup();try{
 const record=async(r=review(),actor=id(5))=>(await db.query('select seller_os_record_removal_review_v1($1,$2,$3,$4) id',['account',actor,id(1),JSON.stringify(r)])).rows[0].id
 const allowed=async(m)=>(await db.query('select seller_os_full_gallery_authority_v1(t,$1,$2) pass from ebay_mayel_visual_tasks_v1 t where id=$3',[JSON.stringify(m),id(4),id(1)])).rows[0].pass
 for(const reason of reasons){const r={...review(),reason},rid=await record(r);assert.equal(await record(r),rid);assert.equal(await allowed(manifest(rid,reason)),true)}
 assert.equal((await db.query('select count(*)::integer n from seller_os_mayel_removal_reviews_v1')).rows[0].n,reasons.length)
 assert.equal(await allowed(manifest(id(99))),false)
 const rid=await record(),m=manifest(rid)
 for(const bad of [{...review(),itemId:'366650047727'},{...review(),baseManifestDigest:truth},{...review(),productTruthDigest:old},
  {...review(),sourceImageSetDigest:old},{...review(),reason:'IDENTITY_DRIFT'},{...review(),finalImages:[]},
  {...review(),finalImages:[current[0],current[0]]},{...review(),finalImages:['https://foreign.test/X.jpg']},
  {...review(),evidenceReferences:[current[0]]},{...review(),explanation:'ok'},
  ...required.map(k=>({...review(),checks:{...checks(),[k]:false}})),
  ...['identityDrift','productUncertainty'].map(k=>({...review(),checks:{...checks(),[k]:true}})),
  {...review(),checks:{...checks(),semanticQaPass:'true'}}])await assert.rejects(record(bad))
 await assert.rejects(record(review(),id(9)),/EXACT_VISUAL_TASK_REQUIRED/)
 // A real durable rejection cannot be overridden by the removal review checks.
 await db.query(`insert into ebay_listing_image_assets(id,account_key,mayel_visual_task_id,status,mayel_approval_status,mayel_output_role,public_url,product_truth_digest,source_image_set_digest,qa_result)
 values ($1,'account',$2,'rejected','REJECTED','DETAIL','https://own.test/rejected.jpg',$3,$3,'{"automaticStatus":"PASSED","humanReview":{"decision":"REJECT","reason":"IDENTITY_DRIFT"}}')`,[id(8),id(1),truth])
 await assert.rejects(record({...review(),finalImages:[current[0],'https://own.test/rejected.jpg'],evidenceReferences:[...current,'https://own.test/rejected.jpg']}),/UNAUTHORIZED_IMAGE_EVIDENCE/)
 await db.exec(`update ebay_mayel_visual_tasks_v1 set selection_signal=jsonb_set(selection_signal,'{productTruthSupported}','false')`)
 await assert.rejects(record(),/PRODUCT_TRUTH_REQUIRED/)
 await db.exec(`update ebay_mayel_visual_tasks_v1 set selection_signal=jsonb_set(selection_signal,'{productTruthSupported}','true')`)
 const {recordMayelRemovalReviewV1}=await import('./mayel-semantic-removal-server-v1.ts')
 let calls=0
 const dbAdapter={async rpc(name,args){assert.equal(name,'seller_os_record_removal_review_v1');calls++;
  try{return {data:(await db.query('select seller_os_record_removal_review_v1($1,$2,$3,$4) id',[args.p_account,args.p_actor,args.p_task,JSON.stringify(args.p_review)])).rows[0].id,error:null}}
  catch(e){return {data:null,error:e}}}}
 const saved=await recordMayelRemovalReviewV1({supabase:dbAdapter,accountKey:'account',actorUserId:id(5),taskId:id(1),review:review()})
 assert.equal(saved.reviewId,rid);assert.equal(saved.marketplaceWrites,0);assert.equal(saved.outboxCreated,false);assert.equal(saved.ownerApprovalRequired,false)
 await assert.rejects(recordMayelRemovalReviewV1({supabase:dbAdapter,accountKey:'account',actorUserId:id(5),taskId:id(1),review:{...review(),checks:{}}}))
 assert.equal(calls,2)
 const changed=structuredClone(m);changed.proposedOrderedImages.reverse();assert.equal(await allowed(changed),false)
 await db.query('update ebay_mayel_visual_tasks_v1 set product_truth_digest=$1',[old]);assert.equal(await allowed(m),false)
 await db.query('update ebay_mayel_visual_tasks_v1 set product_truth_digest=$1',[truth])
 await assert.rejects(db.query('update seller_os_mayel_removal_reviews_v1 set reason=$1 where id=$2',['REDUNDANT',rid]),/IMMUTABLE/)
 await db.query('update seller_os_mayel_removal_reviews_v1 set revoked_at=now() where id=$1',[rid]);assert.equal(await allowed(m),false);await assert.rejects(record(),/REVOKED/)
 await db.exec(`update seller_os_mayel_gallery_removal_grants_v1 set revoked_at=now()`);await assert.rejects(record({...review(),reason:'REDUNDANT'}),/DELEGATION_REQUIRED/)
 const acl=(await db.query(`select has_table_privilege('anon','seller_os_mayel_removal_reviews_v1','SELECT') anon,
 has_function_privilege('authenticated','seller_os_record_removal_review_v1(text,uuid,uuid,jsonb)','EXECUTE') auth,
 has_table_privilege('service_role','seller_os_mayel_removal_reviews_v1','DELETE') can_delete`)).rows[0]
 assert.deepEqual(acl,{anon:false,auth:false,can_delete:false})
 }finally{await db.close()}
})
