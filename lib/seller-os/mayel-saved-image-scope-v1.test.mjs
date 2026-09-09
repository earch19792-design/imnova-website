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
 }finally{await db.close()}
})
