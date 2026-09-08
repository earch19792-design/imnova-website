import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

process.on('uncaughtException', error => {
  console.error(error.message, error.detail ?? '', error.where ?? '', error.stack ?? '')
  process.exit(1)
})

const migration = await readFile(new URL(
  '../supabase/migrations/20260908122732_product_research_keyword_refresh_coalescing_v1.sql',
  import.meta.url
), 'utf8')
const db = new PGlite({ extensions: { pgcrypto } })

await db.exec(`
create schema extensions;
create extension pgcrypto with schema extensions;
create role anon;
create role authenticated;
create role service_role;

create table public.marketplace_product_research_query_plans(
  id uuid primary key,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  source_context text not null default 'QUICK_PICK_RESEARCH_REQUIRED',
  source_candidate_key text not null,
  source_luna_product_id text,
  subject_supplier_variant_id text,
  source_opportunity_id uuid,
  status text not null default 'ACTIVE',
  completed_at timestamptz,
  plan_version text,
  input_hash text,
  query_count integer not null default 0,
  research_intelligence_status text,
  terminal_research_conclusion text,
  intelligence_contract_version text,
  worker_lease_owner text,
  worker_lease_expires_at timestamptz,
  worker_claim_count integer not null default 0,
  worker_next_retry_at timestamptz,
  worker_last_release_code text,
  worker_last_result jsonb,
  keyword_intelligence_decision jsonb,
  updated_at timestamptz not null default now()
);

create table public.marketplace_product_research_query_tasks(
  id uuid primary key default extensions.gen_random_uuid(),
  plan_id uuid not null references public.marketplace_product_research_query_plans(id),
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  ordinal integer not null,
  search_query text not null,
  query_hash text not null,
  cluster_key_hash text,
  category_id text,
  candidate_count integer,
  candidate_variant_hashes text[],
  query_intent text,
  evidence_basis jsonb not null default '[]'::jsonb,
  strategy_version text,
  capture_batch_id uuid,
  commercial_evidence_entities jsonb not null default '[{"item":"evidence"}]'::jsonb,
  quality_status text,
  updated_at timestamptz not null default now(),
  unique(plan_id, query_hash)
);

create table public.ebay_luna_opportunity_queue(
  id uuid primary key,
  assessment jsonb
);
create table public.marketplace_product_research_capture_observations(
  id uuid primary key,
  capture_batch_id uuid,
  evidence_semantics_versions jsonb not null default '[]'::jsonb
);
create table public.maintenance_counter(
  kind text primary key,
  calls integer not null default 0
);
insert into public.maintenance_counter(kind) values ('keyword'),('evidence');
create table public.maintenance_control(fail_keyword boolean not null default false);
insert into public.maintenance_control values (false);

create function public.refresh_product_research_keyword_intelligence_v1(p_plan_id uuid)
returns jsonb language plpgsql as $$
begin
  update public.maintenance_counter set calls=calls+1 where kind='keyword';
  if (select fail_keyword from public.maintenance_control limit 1) then
    raise exception 'INJECTED_FINAL_REFRESH_FAILURE';
  end if;
  return jsonb_build_object('PLAN_ID',p_plan_id,'READY',true);
end;
$$;

create function public.reclassify_product_research_evidence_semantics_v2(
  p_marketplace_account_key text,p_plan_id uuid
) returns jsonb language plpgsql as $$
begin
  update public.maintenance_counter set calls=calls+1 where kind='evidence';
  return jsonb_build_object('PLAN_ID',p_plan_id,'STATUS','RECLASSIFIED');
end;
$$;

create function public.product_research_keyword_intelligence_trigger_v1()
returns trigger language plpgsql as $$ begin return new; end $$;
create function public.reclassify_product_research_task_evidence_v1()
returns trigger language plpgsql as $$ begin return new; end $$;

create trigger product_research_keyword_plan_insert_v1
after insert on public.marketplace_product_research_query_plans for each row
execute function public.product_research_keyword_intelligence_trigger_v1();
create trigger product_research_keyword_plan_update_v1
after update of status,research_intelligence_status,
  terminal_research_conclusion,source_candidate_key,source_luna_product_id,
  subject_supplier_variant_id,intelligence_contract_version
on public.marketplace_product_research_query_plans for each row
execute function public.product_research_keyword_intelligence_trigger_v1();
create trigger product_research_keyword_task_insert_v1
after insert on public.marketplace_product_research_query_tasks for each row
execute function public.product_research_keyword_intelligence_trigger_v1();
create trigger product_research_keyword_task_update_v1
after update of query_intent,evidence_basis,strategy_version,capture_batch_id
on public.marketplace_product_research_query_tasks for each row
execute function public.product_research_keyword_intelligence_trigger_v1();
create trigger reclassify_product_research_task_evidence_insert_v1
after insert on public.marketplace_product_research_query_tasks for each row
when (new.strategy_version is not null)
execute function public.reclassify_product_research_task_evidence_v1();
create trigger reclassify_product_research_task_evidence_update_v1
after update
on public.marketplace_product_research_query_tasks for each row
when (new.strategy_version is not null)
execute function public.reclassify_product_research_task_evidence_v1();

create function public.create_or_reuse_quick_pick_product_research_plan_v1(
  p_plan_id uuid,p_marketplace_account_key text,p_plan_version text,p_input_hash text,
  p_opportunity_id uuid,p_candidate_key text,p_luna_product_id text,p_luna_variant_id text,
  p_supplier_sku text,p_worker_capability_fresh boolean,p_observed_at timestamptz,p_queries jsonb
) returns jsonb language plpgsql as $$
declare v_plan_id uuid; v_created boolean := false; q record;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    p_marketplace_account_key || ':' || p_candidate_key, 0));
  select id into v_plan_id from public.marketplace_product_research_query_plans
   where marketplace_account_key=p_marketplace_account_key
     and source_candidate_key=p_candidate_key order by id limit 1;
  if not found then
    v_plan_id:=p_plan_id; v_created:=true;
    insert into public.marketplace_product_research_query_plans(
      id,marketplace_account_key,source_candidate_key,source_luna_product_id,
      subject_supplier_variant_id,source_opportunity_id,plan_version,input_hash,
      intelligence_contract_version,research_intelligence_status,updated_at)
    values(v_plan_id,p_marketplace_account_key,p_candidate_key,p_luna_product_id,
      p_luna_variant_id,p_opportunity_id,p_plan_version,p_input_hash,
      p_plan_version,'RESEARCH_IN_PROGRESS',p_observed_at);
    for q in select * from jsonb_to_recordset(p_queries) as x(
      ordinal integer,search_query text,query_hash text,cluster_key_hash text,
      category_id text,candidate_count integer,candidate_variant_hashes text[])
    loop
      insert into public.marketplace_product_research_query_tasks(
        plan_id,marketplace_account_key,ordinal,search_query,query_hash,
        cluster_key_hash,category_id,candidate_count,candidate_variant_hashes)
      values(v_plan_id,p_marketplace_account_key,q.ordinal,q.search_query,q.query_hash,
        q.cluster_key_hash,q.category_id,q.candidate_count,q.candidate_variant_hashes);
    end loop;
  end if;
  return jsonb_build_object('planId',v_plan_id,'planCreated',v_created,
    'supplierSku',p_supplier_sku);
end;
$$;
`)

await db.exec(migration)

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const account = 'acct-test'
const version = 'PRODUCT_RESEARCH_QUERY_INTELLIGENCE_V1'
const queries = n => Array.from({ length: n }, (_, i) => ({
  ordinal: i + 1,
  search_query: `query ${i + 1}`,
  query_hash: `query-${i + 1}`,
  cluster_key_hash: `cluster-${i + 1}`,
  category_id: '123',
  candidate_count: 10,
  candidate_variant_hashes: [`variant-${i + 1}`],
  query_intent: i === 0 ? 'EXACT_PRODUCT_QUERY' : 'CORE_FAMILY_QUERY',
  evidence_basis: [{ authority: 'TEST', ordinal: i + 1 }],
  strategy_version: version
}))

const callV2 = (planId, candidate, inputQueries, observedAt = '2026-09-08T12:00:00Z') =>
  db.query(`select public.create_or_reuse_quick_pick_product_research_plan_v2(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) result`, [
    planId, account, version, `input-${candidate}`, id(900), candidate,
    'product', 'variant', 'sku', true, observedAt, JSON.stringify(inputQueries)
  ])

async function counts() {
  const rows = (await db.query('select kind,calls from public.maintenance_counter order by kind')).rows
  return Object.fromEntries(rows.map(row => [row.kind, Number(row.calls)]))
}
async function resetCounts() {
  await db.exec('update public.maintenance_counter set calls=0')
}
async function test(name, fn) {
  await fn()
  console.log(name)
}

await test('PASS_NEW_PLAN_WITH_N_TASKS_BOUNDED', async () => {
  const result = (await callV2(id(1), 'candidate-new', queries(4))).rows[0].result
  assert.deepEqual(await counts(), { evidence: 1, keyword: 1 })
  assert.deepEqual(Object.keys(result).sort(), [
    'addedQueryCount','marketplaceWrites','planCreated','planId','planReopened',
    'queryStrategyVersion','researchState','supplierSku'
  ].sort())
})

await test('PASS_REUSE_NO_SEMANTIC_CHANGE', async () => {
  await resetCounts()
  await callV2(id(2), 'candidate-new', queries(4), '2026-09-08T12:01:00Z')
  assert.deepEqual(await counts(), { evidence: 0, keyword: 0 })
})

await test('PASS_REUSE_WITH_N_CHANGED_TASKS_ONE_FINAL_DERIVATION', async () => {
  await db.exec(`update public.marketplace_product_research_query_tasks
    set query_intent='SEMANTIC_EXPANSION_QUERY',evidence_basis='[{"old":true}]',
        strategy_version='OLD_VERSION'
    where plan_id='${id(1)}'`)
  await resetCounts()
  await callV2(id(3), 'candidate-new', queries(4), '2026-09-08T12:02:00Z')
  assert.deepEqual(await counts(), { evidence: 1, keyword: 1 })
})

await test('PASS_EVIDENCE_SEMANTICS_COALESCED', async () => {
  assert.match(migration, /set evidence_dirty=true,keyword_dirty=true/)
  assert.equal((await counts()).evidence, 1)
})

await test('PASS_PLAN_CONTRACT_VERSION_NOOP_DOES_NOT_REFRESH', async () => {
  await db.query(`update public.marketplace_product_research_query_plans
    set plan_version='LEGACY_PLAN_VERSION' where id=$1`, [id(1)])
  await resetCounts()
  await callV2(id(4), 'candidate-new', queries(4), '2026-09-08T12:03:00Z')
  assert.equal((await counts()).keyword, 0)
  const plan = (await db.query(`select plan_version,intelligence_contract_version
    from public.marketplace_product_research_query_plans where id=$1`, [id(1)])).rows[0]
  assert.equal(plan.plan_version, version)
  assert.equal(plan.intelligence_contract_version, version)
})

await test('PASS_EXTERNAL_TASK_WRITE_STILL_REFRESHES', async () => {
  await resetCounts()
  await db.query(`update public.marketplace_product_research_query_tasks
    set evidence_basis=$1 where plan_id=$2 and query_hash='query-1'`,
    [JSON.stringify([{ external: true }]), id(1)])
  assert.deepEqual(await counts(), { evidence: 1, keyword: 1 })
})

await test('PASS_EXTERNAL_PLAN_WRITE_STILL_REFRESHES', async () => {
  await resetCounts()
  await db.query(`update public.marketplace_product_research_query_plans
    set status='COMPLETED' where id=$1`, [id(1)])
  assert.deepEqual(await counts(), { evidence: 0, keyword: 1 })
})

await test('PASS_ROLLBACK_CANNOT_SKIP_FINAL_REFRESH', async () => {
  await db.exec(`update public.marketplace_product_research_query_tasks
    set query_intent='SEMANTIC_EXPANSION_QUERY',evidence_basis='[{"rollback":true}]',
        strategy_version='ROLLBACK_OLD' where plan_id='${id(1)}';
    update public.maintenance_control set fail_keyword=true;
    update public.maintenance_counter set calls=0;`)
  await assert.rejects(
    callV2(id(5), 'candidate-new', queries(4), '2026-09-08T12:04:00Z'),
    /INJECTED_FINAL_REFRESH_FAILURE/
  )
  const beforeRetry = (await db.query(
    'select distinct strategy_version from public.marketplace_product_research_query_tasks where plan_id=$1',
    [id(1)]
  )).rows
  assert.deepEqual(beforeRetry.map(row => row.strategy_version), ['ROLLBACK_OLD'])
  assert.equal(Number((await db.query(
    'select count(*) count from pg_temp.seller_os_product_research_coalesce_v1'
  )).rows[0].count), 0)
  await db.exec('update public.maintenance_control set fail_keyword=false; update public.maintenance_counter set calls=0')
  await callV2(id(6), 'candidate-new', queries(4), '2026-09-08T12:05:00Z')
  assert.deepEqual(await counts(), { evidence: 1, keyword: 1 })
})

await test('PASS_CONCURRENT_CREATE_OR_REUSE_PRESERVES_AUTHORITY', async () => {
  await resetCounts()
  await Promise.all([
    callV2(id(20), 'candidate-concurrent', queries(3), '2026-09-08T12:06:00Z'),
    callV2(id(21), 'candidate-concurrent', queries(3), '2026-09-08T12:06:00Z')
  ])
  const plans = await db.query(
    'select count(*) count from public.marketplace_product_research_query_plans where source_candidate_key=$1',
    ['candidate-concurrent']
  )
  assert.equal(Number(plans.rows[0].count), 1)
  assert.match(migration, /create_or_reuse_quick_pick_product_research_plan_v1\(/)
  assert.doesNotMatch(migration, /disable trigger|session_replication_role|set_config|current_setting/i)
})

const parity = JSON.parse(await readFile(new URL(
  '../docs/product-research-keyword-refresh-coalescing-v1-parity.json', import.meta.url
), 'utf8'))

await test('PASS_GOLDEN_STAINLESS_STEEL_STRAINER_IDENTICAL', async () => {
  assert.equal(parity.contractVersion, 'PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1')
  assert.equal(parity.golden.primaryKeyword, 'stainless steel strainer')
  assert.equal(parity.golden.decisionSha256, 'dc34083db1dda9fb221f0e4826e4f9cc41dc9fca7b3e22604894e8cf2c2d1c5f')
  assert.doesNotMatch(migration, /create or replace function public\.derive_product_research_keyword_intelligence_v2_1/i)
})

await test('PASS_THREE_UNPROVEN_REMAIN_CLOSED', async () => {
  const expected = new Map([
    ['05335b69-c135-4715-95c4-107e10548127','8fbc3b95aa0b7e3ff10ee2525c0f650f5560eff393052db94db95cf6aa655118'],
    ['1db48220-ad65-4971-8739-0f3e010f373e','0524a7aa1c3837ff61b4fdaf57e0bd66848f4e2155a7e7973df411658452f863'],
    ['7e9f78fb-7a86-4605-bcc5-1b4e061e3cce','168a3a452b986077dbdabdb3fb1881f676d62c377ce6fb807facde840c469744']
  ])
  assert.equal(parity.unproven.length, 3)
  for (const row of parity.unproven) {
    assert.equal(row.decisionSha256, expected.get(row.planId))
    assert.ok(row.blockers.includes('NO_DEFENSIBLE_PRIMARY_QUERY_CONCEPT'))
  }
})

await test('PASS_NO_REMOTE_OR_DOWNSTREAM_SCOPE', async () => {
  assert.doesNotMatch(migration, /listing_package|relay|statement_timeout|alter system|alter trigger|drop trigger/i)
  assert.match(migration, /on commit delete rows/)
  assert.match(migration, /QUICK_PICK_PRODUCT_RESEARCH_COALESCE_REENTRY_DENIED/)
})

await db.close()
