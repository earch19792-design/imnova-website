import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
test('LOCAL_TO_SERVER_OUTBOX_PASS: atomic idempotent handoff, account isolation, leases, unknown commits and RLS',async()=>{
 const db=new PGlite()
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table ebay_mayel_visual_tasks_v1(id uuid,marketplace_account_key text,ebay_item_id text,visual_manifest_id uuid,visual_manifest_digest text,status text,updated_at timestamptz);
 create table ebay_mayel_visual_phase_b_executions_v1(marketplace_account_key text,visual_task_id uuid,visual_manifest_digest text,phase text);`)
 await db.exec(readFileSync(new URL('../../supabase/migrations/20260909214649_ipad_local_first_ebay_outbox_v1.sql',import.meta.url),'utf8'))
 const intent={kind:'IMAGE_DRAFT',itemId:'366582671136',idempotencyKey:`ipados:v1:${'a'.repeat(64)}`,requestedChanges:{taskId:id(2)}}
 const put=(actor=id(1),hash='hash')=>db.query('select * from seller_os_put_ipad_outbox_v1($1,$2,$3,$4,$5)',['account',actor,intent,hash,{baseImageHash:'base'}])
 const a=(await put()).rows[0],b=(await put()).rows[0];assert.equal(a.id,b.id)
 assert.equal((await db.query('select count(*)::int n from seller_os_ipad_outbox_v1')).rows[0].n,1)
 await assert.rejects(put(id(1),'other'),/PAYLOAD_CONFLICT/)
 assert.equal((await db.query("select * from seller_os_claim_ipad_outbox_v1('other')")).rows.length,0)
 const claim=(await db.query("select * from seller_os_claim_ipad_outbox_v1('account')")).rows[0]
 assert.equal(claim.id,a.id);assert.equal(claim.state,'LEASED');assert.ok(claim.lease_token)
 assert.equal((await db.query("select * from seller_os_claim_ipad_outbox_v1('account')")).rows.length,0)
 await db.query("update seller_os_ipad_outbox_v1 set state='UNKNOWN_COMMIT',dispatch_count=1,lease_until=now()-interval '1 minute' where id=$1",[a.id])
 const reclaimed=(await db.query("select * from seller_os_claim_ipad_outbox_v1('account')")).rows[0]
 assert.equal(reclaimed.state,'UNKNOWN_COMMIT');assert.equal(reclaimed.dispatch_count,1);assert.notEqual(reclaimed.lease_token,claim.lease_token)
 assert.equal((await db.query("update seller_os_ipad_outbox_v1 set state='SYNCED' where id=$1 and lease_token=$2 returning id",[a.id,claim.lease_token])).rows.length,0)
 await db.query("insert into ebay_mayel_visual_tasks_v1 values($1,'account','366582671136',$2,'manifest','OWNER_PREVIEW_READY',now())",[id(2),id(3)])
 assert.equal((await db.query("select * from seller_os_pending_mayel_visual_manifests_v1('account')")).rows.length,0)
 await db.exec('set role authenticated')
 await assert.rejects(db.query('select * from seller_os_ipad_outbox_v1'),/permission denied/)
 await assert.rejects(put(),/permission denied/)
 }finally{await db.close()}
})
