import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
test('unlinked saved image admission binds origin, account, actor and source; active assignment cannot change',async()=>{
 const db=new PGlite(), account=`seller:${'a'.repeat(64)}`
 try {
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create table ebay_listing_packages(id uuid primary key,account_key text);
 create table ebay_mayel_visual_tasks_v1(id uuid primary key,marketplace_account_key text,listing_package_id uuid,candidate_key text,opportunity_id uuid,assigned_operator_user_id uuid,status text,source_image_set_digest text,product_truth_digest text,ebay_item_id text,current_image_set jsonb,visual_manifest_digest text);
 create table ebay_listing_image_assets(id uuid,mayel_visual_task_id uuid,listing_package_id uuid,candidate_key text,opportunity_id uuid,source_type text,uploaded_by uuid,source_sha256 text,source_image_set_digest text,product_truth_digest text,provenance jsonb,account_key text);
 create table ebay_listing_experiments_v1(experiment_id uuid,account_key text,marketplace text,ebay_item_id text,experiment_type text,lifecycle_status text,baseline_evidence_ref jsonb);
 create table ebay_mayel_visual_phase_b_executions_v1(visual_task_id uuid);
 create function seller_os_same_ebay_image_source_v1(text,text) returns boolean language sql immutable as $$ select $1=$2 $$;`)
 await db.exec(readFileSync(new URL('../../supabase/migrations/20260909215024_saved_image_unlinked_task_scope_v1.sql',import.meta.url),'utf8'))
 await db.exec('create trigger scope before insert or update on ebay_listing_image_assets for each row execute function enforce_ebay_listing_image_account_scope()')
 const variant={assetId:id(2),outputSha256:'b'.repeat(64),outputStoragePath:'saved.png',status:'EXPERIMENT_READY',variantRejected:false,productTruthPreserved:true,protectedLayerRoundtripExact:true,sourceImageFullResolutionCertified:true,backgroundQa:{passed:true}}
 await db.query(`insert into ebay_mayel_visual_tasks_v1 values($1,$2,null,null,null,$3,'PROMPT_READY','source','truth','366582671136','["https://example.com/image.png"]',null)`,[id(1),account,id(4)])
 await db.query(`insert into ebay_listing_experiments_v1 values($1,$2,'EBAY_US','366582671136','HERO_VISUAL_VARIANT','DRAFT',$3)`,[id(3),account,{sellerOsVisualVariant:{sourceImageUrl:'https://example.com/image.png',variants:[variant]}}])
 const insert=({actor=id(4),hash=variant.outputSha256,type='SELLER_OS_ASSISTANT_IMAGE_VARIANT',acct=account}={})=>db.query(`insert into ebay_listing_image_assets values($1,$2,null,null,null,$3,$4,$5,'source','truth',$6,$7)`,[id(2),id(1),type,actor,hash,{generatedOrigin:{experimentId:id(3),outputStoragePath:'saved.png'}},acct])
 await assert.rejects(insert({actor:id(8)}),/TASK_SCOPE_MISMATCH/)
 await assert.rejects(insert({hash:'c'.repeat(64)}),/TASK_SCOPE_MISMATCH/)
 await assert.rejects(insert({acct:`other:${'c'.repeat(64)}`}),/ACCOUNT_SCOPE_MISMATCH/)
 await assert.rejects(insert({type:'CHATGPT_SUBSCRIPTION_MAYEL'}),/TASK_SCOPE_MISMATCH/)
 await insert()
 await assert.rejects(db.query('update ebay_mayel_visual_tasks_v1 set assigned_operator_user_id=$1 where id=$2',[id(8),id(1)]),/ACTIVE_WORK_CONFLICT/)
 await db.query('insert into ebay_listing_packages values($1,$2)',[id(9),account])
 await db.query('update ebay_mayel_visual_tasks_v1 set listing_package_id=$1 where id=$2',[id(9),id(1)])
 await insert({type:'CHATGPT_SUBSCRIPTION_MAYEL'})
 // Apply the follow-up migration against a minimal outbox/storage schema.
 await db.exec(`alter table ebay_listing_image_assets add source_image_references jsonb, add source_kind text, add rights_basis text, add rights_evidence_confirmed boolean, add authorization_reference text, add transformation_version text, add qa_result jsonb;
 alter table ebay_mayel_visual_tasks_v1 add source_image_references jsonb, add visual_manifest_id uuid, add updated_at timestamptz;
 alter table ebay_mayel_visual_phase_b_executions_v1 add marketplace_account_key text, add visual_manifest_digest text, add phase text;
 create schema storage; create table storage.buckets(id text,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
 await db.exec(readFileSync(new URL('../../supabase/migrations/20260909214649_ipad_local_first_ebay_outbox_v1.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../supabase/migrations/20260909221717_ipad_manual_visual_upload_outbox_v1.sql',import.meta.url),'utf8'))
 await db.query(`update ebay_mayel_visual_tasks_v1 set listing_package_id=null,source_image_references='[{"url":"https://example.com/image.png"}]' where id=$1`,[id(1)])
 const manual=({actor=id(4),rights=true,hash='d'.repeat(64),refs=[{url:'https://example.com/image.png'}],scope=account}={})=>db.query(`insert into ebay_listing_image_assets(id,mayel_visual_task_id,source_type,uploaded_by,source_sha256,source_image_set_digest,product_truth_digest,account_key,source_image_references,source_kind,rights_basis,rights_evidence_confirmed,authorization_reference,transformation_version,qa_result)
 values($1,$2,'CHATGPT_SUBSCRIPTION_MAYEL',$3,$4,'source','truth',$5,$6,'owned_upload','owned',$7,$8,'MAYEL_CHATGPT_OUTPUT_NORMALIZATION_V1','{"automaticStatus":"PASSED"}')`,[id(10),id(1),actor,hash,scope,refs,rights,`MAYEL_CHATGPT_SUBSCRIPTION:${id(1)}`])
 await manual()
 await assert.rejects(manual({rights:false}),/TASK_SCOPE_MISMATCH/)
 await assert.rejects(manual({actor:id(8)}),/TASK_SCOPE_MISMATCH/)
 await assert.rejects(manual({refs:[]}),/TASK_SCOPE_MISMATCH/)
 await assert.rejects(manual({hash:'invalid'}),/TASK_SCOPE_MISMATCH/)
 await assert.rejects(manual({scope:`other:${'c'.repeat(64)}`}),/ACCOUNT_SCOPE_MISMATCH/)
 const uploadIntent={kind:'IMAGE_UPLOAD',itemId:'366582671136',idempotencyKey:`ipados:v1:${'a'.repeat(64)}`,requestedChanges:{taskId:id(1)}}
 const put=()=>db.query('select * from seller_os_put_ipad_outbox_v1($1,$2,$3,$4,$5)',[account,id(4),uploadIntent,'hash',{assets:[id(10)]}])
 const receipt=(await put()).rows[0];assert.equal(receipt.state,'PENDING_EBAY_SYNC');assert.equal(receipt.id,(await put()).rows[0].id)
 assert.equal((await db.query("select public from storage.buckets where id='seller-os-ipad-image-parts-v1'")).rows[0].public,false)
 }finally{await db.close()}
})
