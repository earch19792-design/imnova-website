import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'

const migration=readFileSync(new URL('../../supabase/migrations/20260911194733_research_reformulation_incoming_lineage.sql',import.meta.url),'utf8')
const plan='11111111-1111-4111-8111-111111111111',origin='22222222-2222-4222-8222-222222222222',child='33333333-3333-4333-8333-333333333333',incoming='44444444-4444-4444-8444-444444444444',outgoing='55555555-5555-4555-8555-555555555555'
const account='exact-account',strategy='certified-strategy-v2'
const incomingDecision={parentTaskId:origin,outcome:'CREATE_TASK',evidence:['original-receipt']}
async function fixture(){
 const db=new PGlite()
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create function public.is_seller_os_service_role_request_v1() returns boolean language sql as $$select coalesce(current_setting('test.service_role',true),'true')='true'$$;
 create table public.marketplace_product_research_query_plans(id uuid primary key,marketplace_account_key text,marketplace text,source_context text,status text,completed_at timestamptz,terminal_research_conclusion text,research_intelligence_status text,worker_next_retry_at timestamptz,updated_at timestamptz,reformulation_attempt_count int,max_reformulation_attempts int,worker_last_release_code text,worker_last_result jsonb,query_count int);
 create table public.marketplace_product_research_query_tasks(id uuid primary key,plan_id uuid,marketplace_account_key text,marketplace text,ordinal int,search_query text,query_hash text,cluster_key_hash text,category_id text,candidate_count int,candidate_variant_hashes text[],status text,query_intent text,evidence_basis jsonb,strategy_version text,reformulation_parent_task_id uuid,reformulation_decision_id uuid,reformulation_ordinal int,reformulation_decision jsonb,reformulation_decided_at timestamptz,created_at timestamptz,updated_at timestamptz,quality_status text,unique(plan_id,reformulation_parent_task_id));`)
 await db.exec(migration)
 await db.exec(migration)
 await db.query("insert into public.marketplace_product_research_query_plans(id,marketplace_account_key,marketplace,source_context,status,updated_at,reformulation_attempt_count,max_reformulation_attempts,query_count) values($1,$2,'EBAY_US','QUICK_PICK_RESEARCH_REQUIRED','ACTIVE',now(),1,2,2)",[plan,account])
 for(const [id,parent,ordinal] of [[origin,null,1],[child,origin,2]])await db.query("insert into public.marketplace_product_research_query_tasks(id,plan_id,marketplace_account_key,marketplace,ordinal,status,strategy_version,reformulation_parent_task_id,reformulation_decision_id,reformulation_decision,quality_status,updated_at) values($1,$2,$3,'EBAY_US',$4,'PROCESSED',$5,$6,$7,$8,'LOW_PRECISION_REFORMULATION_REQUIRED',now())",[id,plan,account,ordinal,strategy,parent,incoming,JSON.stringify(incomingDecision)])
 return db
}
async function persist(db,{accountKey=account,terminal=null}={}){
 const args=[accountKey,plan,child,outgoing,JSON.stringify({parentTaskId:child,outcome:terminal?'TERMINAL':'CREATE_TASK'}),2,terminal?null:'REFORMULATED_CORE_FAMILY_QUERY',terminal?null:'supported product concept',terminal?null:'sha256:'+'a'.repeat(64),terminal?null:'sha256:'+'b'.repeat(64),'261987',1,['exact-variant'],JSON.stringify([{source:'PRODUCT_TRUTH'}]),strategy,terminal,new Date().toISOString()]
 return (await db.query(`select public.persist_product_research_adaptive_decision_v1(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result
}

test('incoming creation receipt permits exactly one remaining bounded continuation; replay preserves history',async()=>{
 const db=await fixture();try{
 const before=(await db.query('select * from public.marketplace_product_research_query_tasks where id=$1',[origin])).rows[0]
 const result=await persist(db);assert.equal(result.state,'REFORMULATION_TASK_CREATED');assert.equal(result.taskCreated,true);assert.equal(result.marketplaceWrites,0)
 const replay=await persist(db);assert.equal(replay.state,'REFORMULATION_REUSED');assert.equal(replay.taskCreated,false);assert.equal(replay.taskId,result.taskId)
 const saved=(await db.query('select * from public.marketplace_product_research_query_tasks where id=$1',[child])).rows[0]
 assert.deepEqual(saved.reformulation_decision.priorIncomingDecision,incomingDecision);assert.equal(saved.reformulation_parent_task_id,origin);assert.equal(saved.reformulation_decision_id,outgoing)
 assert.deepEqual((await db.query('select * from public.marketplace_product_research_query_tasks where id=$1',[origin])).rows[0],before)
 assert.equal((await db.query("select count(*)::int n from public.marketplace_product_research_query_tasks where status='PENDING'")).rows[0].n,1)
 assert.equal((await db.query('select reformulation_attempt_count n from public.marketplace_product_research_query_plans')).rows[0].n,2)
 }finally{await db.close()}
})

test('unverified incoming lineage and real outgoing terminal decisions remain fail closed',async()=>{
 const db=await fixture();try{
 await db.query("update public.marketplace_product_research_query_tasks set marketplace_account_key='other-account' where id=$1",[origin])
 assert.equal((await persist(db)).state,'TERMINAL_UNPROVEN')
 await db.query('update public.marketplace_product_research_query_tasks set marketplace_account_key=$1 where id=$2',[account,origin])
 const terminal=await persist(db,{terminal:'DEMAND_REMAINS_UNPROVEN_AFTER_BOUNDED_RESEARCH'});assert.equal(terminal.state,'TERMINAL_UNPROVEN')
 assert.equal((await persist(db)).state,'TERMINAL_UNPROVEN')
 assert.equal((await db.query('select count(*)::int n from public.marketplace_product_research_query_tasks')).rows[0].n,2)
 const decision=(await db.query('select reformulation_decision d from public.marketplace_product_research_query_tasks where id=$1',[child])).rows[0].d
 assert.deepEqual(decision.priorIncomingDecision,incomingDecision)
 }finally{await db.close()}
})

test('account, service authorization, ordinal, pending-work and duplicate-query protections remain enforced',async()=>{
 const db=await fixture();try{
 await assert.rejects(persist(db,{accountKey:'wrong-account'}),/PLAN_SCOPE_INVALID/)
 await db.exec("set test.service_role='false'");await assert.rejects(persist(db),/DECISION_INVALID/);await db.exec("set test.service_role='true'")
 await db.exec('update public.marketplace_product_research_query_plans set max_reformulation_attempts=1');await assert.rejects(persist(db),/ATTEMPTS_EXHAUSTED/)
 await db.exec('update public.marketplace_product_research_query_plans set max_reformulation_attempts=2,reformulation_attempt_count=2');await assert.rejects(persist(db),/ORDINAL_INVALID/)
 await db.exec('update public.marketplace_product_research_query_plans set reformulation_attempt_count=1')
 await db.query("update public.marketplace_product_research_query_tasks set status='PENDING' where id=$1",[origin]);await assert.rejects(persist(db),/PENDING_TASK_EXISTS/)
 await db.query("update public.marketplace_product_research_query_tasks set status='PROCESSED',query_hash=$1 where id=$2",['sha256:'+'a'.repeat(64),origin]);await assert.rejects(persist(db),/QUERY_DUPLICATE/)
 assert.equal((await db.query('select count(*)::int n from public.marketplace_product_research_query_tasks')).rows[0].n,2)
 }finally{await db.close()}
})
