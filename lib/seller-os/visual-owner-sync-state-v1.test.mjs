import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { visualAssetSyncViewV1, visualAssetGenerationV1, visualAssetOwnerApprovedV1, VISUAL_OWNER_SYNC_CONFIRMATION } from './visual-asset-sync-state-v1.ts'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const migration=readFileSync(new URL('../../supabase/migrations/20260909230150_visual_asset_owner_sync_state_v1.sql',import.meta.url),'utf8')
async function setup(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table ebay_mayel_visual_delegation_authorities_v1(owner_user_id uuid,marketplace_account_key text,status text,revoked_at timestamptz);
 create table ebay_mayel_visual_tasks_v1(id uuid primary key,marketplace_account_key text,ebay_item_id text,visual_manifest_id uuid,visual_manifest_digest text,visual_manifest jsonb,current_image_set jsonb,status text,updated_at timestamptz,source_image_set_digest text,product_truth_digest text,assigned_operator_user_id uuid);
 create table ebay_listing_image_assets(id uuid primary key,account_key text,mayel_visual_task_id uuid,status text,mayel_approval_status text,qa_result jsonb,source_sha256 text,output_sha256 text,source_image_set_digest text,product_truth_digest text,mayel_output_role text);
 create table ebay_mayel_visual_phase_b_executions_v1(marketplace_account_key text,visual_task_id uuid,visual_manifest_digest text,phase text);`)
 await db.exec(readFileSync(new URL('../../supabase/migrations/20260909214649_ipad_local_first_ebay_outbox_v1.sql',import.meta.url),'utf8'))
 await db.query("insert into ebay_mayel_visual_delegation_authorities_v1 values($1,'account','ACTIVE',null)",[id(1)])
 const assets=Array.from({length:6},(_,n)=>({id:id(10+n),account_key:'account',mayel_visual_task_id:id(3),status:'approved',mayel_approval_status:'APPROVED',qa_result:{automaticStatus:'PASSED',humanReview:{decision:'APPROVE'}},source_sha256:String(n).repeat(64),output_sha256:String(n+1).repeat(64),source_image_set_digest:'sources',product_truth_digest:'truth',mayel_output_role:['DETAIL','PACKAGE_CONTENTS','DIMENSIONS','PRIMARY_BENEFIT','LIFESTYLE','HUMAN_USE'][n]}))
 const task={id:id(3),marketplace_account_key:'account',ebay_item_id:'366582671136',status:'OWNER_PREVIEW_READY',source_image_set_digest:'sources',product_truth_digest:'truth'}
 await db.query('insert into ebay_mayel_visual_tasks_v1(id,marketplace_account_key,ebay_item_id,status,visual_manifest_digest,visual_manifest,source_image_set_digest,product_truth_digest,assigned_operator_user_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[task.id,'account',task.ebay_item_id,task.status,'manifest',{proposedOrderedImages:assets.map(a=>({assetId:a.id,outputSha256:a.output_sha256}))},'sources','truth',id(2)])
 for(const a of assets)await db.query(`insert into ebay_listing_image_assets(${Object.keys(a).join(',')}) values(${Object.keys(a).map((_,n)=>'$'+(n+1)).join(',')})`,Object.values(a))
 const intent={kind:'IMAGE_DRAFT',itemId:task.ebay_item_id,idempotencyKey:`ipados:v1:${'a'.repeat(64)}`,requestedChanges:{taskId:task.id}}
 const binding={sourceImageSetDigest:'sources',assets:assets.map(a=>({assetId:a.id,sourceSha256:a.source_sha256}))}
 const row=(await db.query('select * from seller_os_put_ipad_outbox_v1($1,$2,$3,$4,$5)',['account',id(2),intent,'hash',binding])).rows[0]
 await db.exec(migration)
 await db.exec(readFileSync(new URL('../../supabase/migrations/20260909231004_visual_sync_stale_task_reconciliation_v1.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../supabase/migrations/20260909231227_visual_private_preparation_resume_v1.sql',import.meta.url),'utf8'))
 const approve=(n,actor=id(1),generation=visualAssetGenerationV1(assets[n]))=>db.query('select seller_os_approve_visual_asset_sync_v1($1,$2,$3,$4,$5,$6) approval',['account',actor,task.id,assets[n].id,generation,VISUAL_OWNER_SYNC_CONFIRMATION])
 return{db,assets,task,row,approve}
}
test('physical SQL state repair and per-asset OWNER approval: one of six never approves the other five',async()=>{
 const f=await setup();const{db}=f;try{
 await assert.rejects(db.query('insert into ebay_listing_image_assets select $1,account_key,mayel_visual_task_id,status,mayel_approval_status,qa_result,source_sha256,output_sha256,source_image_set_digest,product_truth_digest,mayel_output_role,null from ebay_listing_image_assets where id=$2',[id(99),f.assets[0].id]),/duplicate key/)
 let rows=(await db.query('select * from seller_os_ipad_outbox_v1')).rows
 assert.equal(rows[0].state,'OWNER_APPROVAL_REQUIRED');assert.equal((await db.query("select * from seller_os_claim_ipad_outbox_v1('account')")).rows.length,0)
 await db.exec("update seller_os_ipad_outbox_v1 set state='PENDING_EBAY_SYNC'")
 assert.equal((await db.query('select state from seller_os_ipad_outbox_v1')).rows[0].state,'OWNER_APPROVAL_REQUIRED')
 await assert.rejects(f.approve(0,id(2)),/OWNER_REQUIRED/)
 await assert.rejects(f.approve(0,id(1),'old-generation'),/GENERATION_CHANGED/)
 const a=(await f.approve(0)).rows[0].approval,b=(await f.approve(0)).rows[0].approval;assert.deepEqual(a,b)
 let assets=(await db.query('select * from ebay_listing_image_assets order by id')).rows
 assert.equal(assets.filter(x=>visualAssetOwnerApprovedV1(x,f.task)).length,1)
 assert.equal(assets.filter(x=>visualAssetSyncViewV1(x,f.task,rows).state==='OWNER_APPROVAL_REQUIRED').length,5)
 assert.equal(new Set(assets.map(x=>visualAssetSyncViewV1(x,f.task).idempotencyKey)).size,6)
 assert.equal((await db.query("select * from seller_os_claim_ipad_outbox_v1('account')")).rows.length,0)
 for(let n=1;n<6;n++)await f.approve(n)
 assert.equal((await db.query('select state from seller_os_ipad_outbox_v1')).rows[0].state,'APPROVED_FOR_EBAY_SYNC')
 const claim=(await db.query("select * from seller_os_claim_ipad_outbox_v1('account')")).rows[0];assert.equal(claim.id,f.row.id)
 assert.equal((await db.query("select * from seller_os_claim_ipad_outbox_v1('account')")).rows.length,0)
 await db.exec("update seller_os_ipad_outbox_v1 set state='SYNCING',dispatch_count=1;update seller_os_ipad_outbox_v1 set state='OFFICIAL_READBACK_REQUIRED',lease_until=now()-interval '1 second'")
 assert.equal((await db.query("select * from seller_os_claim_ipad_outbox_v1('account')")).rows[0].dispatch_count,1)
 await db.exec('set role authenticated');await assert.rejects(f.approve(0),/permission denied/)
 }finally{await db.close()}
})
test('generation, product and source drift invalidate approval and cannot enter syncing',async()=>{
 const f=await setup();try{
 for(let n=0;n<6;n++)await f.approve(n)
 await f.db.query('update ebay_listing_image_assets set output_sha256=$1 where id=$2',['f'.repeat(64),f.assets[0].id])
 const a=(await f.db.query('select * from ebay_listing_image_assets where id=$1',[f.assets[0].id])).rows[0]
 assert.equal(visualAssetOwnerApprovedV1(a,f.task),false)
 assert.equal((await f.db.query("select * from seller_os_claim_ipad_outbox_v1('account')")).rows.length,0)
 await assert.rejects(f.db.exec("update seller_os_ipad_outbox_v1 set state='SYNCING',dispatch_count=1"),/OWNER_APPROVAL_REQUIRED/)
 for(const key of ['source_image_set_digest','product_truth_digest'])assert.equal(visualAssetOwnerApprovedV1({...a,[key]:'changed'},f.task),false)
 }finally{await f.db.close()}
})

test('material saved task drift requires attention before quota recovery; no implicit rebase',async()=>{
 const f=await setup();try{
 for(let n=0;n<6;n++)await f.approve(n)
 await f.db.exec("update ebay_mayel_visual_tasks_v1 set product_truth_digest='new-product'")
 assert.equal((await f.db.query('select state from seller_os_ipad_outbox_v1')).rows[0].state,'REQUIRES_ATTENTION')
 assert.equal((await f.db.query("select * from seller_os_claim_ipad_outbox_v1('account')")).rows.length,0)
 }finally{await f.db.close()}
})

test('private preparation resumes without making an unapproved asset eligible for eBay sync',async()=>{
 const f=await setup();try{
 const intent={kind:'IMAGE_DRAFT',itemId:f.task.ebay_item_id,idempotencyKey:`ipados:v1:${'b'.repeat(64)}`,requestedChanges:{taskId:f.task.id,prepareReview:true}}
 const saved=(await f.db.query('select * from seller_os_put_ipad_outbox_v1($1,$2,$3,$4,$5)',['account',id(2),intent,'private-hash',f.row.binding])).rows[0]
 assert.equal(saved.state,'DRAFT')
 const claim=(await f.db.query("select * from seller_os_claim_ipad_outbox_v1('account')")).rows[0]
 assert.equal(claim.id,saved.id);assert.equal(claim.state,'DRAFT')
 await assert.rejects(f.db.query("update seller_os_ipad_outbox_v1 set state='SYNCING',dispatch_count=1 where id=$1",[saved.id]),/OWNER_APPROVAL_REQUIRED/)
 }finally{await f.db.close()}
})
