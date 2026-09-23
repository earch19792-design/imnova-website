import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

const original = readFileSync(
  "supabase/migrations/20260919180000_teo_pre_research_control_plane_v1.sql", "utf8")
const hardening = readFileSync(
  "supabase/migrations/20260923133000_pre_research_runtime_hardening_v1.sql", "utf8")
const intake = readFileSync(
  "supabase/migrations/20260915170000_luna_pre_research_intake_v1.sql", "utf8")
const parity = readFileSync(
  "supabase/migrations/20260915171000_luna_pre_research_worker_parity_v1.sql", "utf8")

function functionSql(source, name) {
  const start = source.indexOf(`create or replace function public.${name}(`)
  assert.notEqual(start, -1, `${name} exists`)
  const opening = source.indexOf("$function$", start)
  const end = source.indexOf("$function$;", opening + 10)
  assert.notEqual(end, -1, `${name} ends`)
  return source.slice(start, end + 11)
}

const account = "ebay-us-owner"
const owner = "10000000-0000-4000-8000-000000000001"
const capability = "20000000-0000-4000-8000-000000000001"
const batch = "30000000-0000-4000-8000-000000000001"
const worker = "product-research-browser:40000000-0000-4000-8000-000000000001"
const receipt = "50000000-0000-4000-8000-000000000001"
const ids = Array.from({ length: 5 }, (_, index) => ({
  member: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  plan: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  task: `80000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  capture: `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
}))

async function fixture() {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create extension pgcrypto;
    create function public.is_seller_os_service_role_request_v1()
    returns boolean language sql stable as $$ select true $$;
    create table public.seller_os_pre_research_command_capabilities_v1(
      capability_id uuid primary key,enabled boolean not null,
      expires_at timestamptz,owner_user_id uuid,command_client_id text);
    create table public.seller_os_pre_research_batches_v1(
      batch_id uuid primary key,owner_authorization_id uuid,
      marketplace_account_key text,owner_user_id uuid,command_client_id text,
      batch_state text,created_at timestamptz default clock_timestamp(),
      started_at timestamptz,completed_at timestamptz,
      updated_at timestamptz default clock_timestamp());
    create table public.seller_os_pre_research_batch_members_v1(
      member_id uuid primary key,batch_id uuid,ordinal integer,plan_id uuid,
      execution_state text,started_at timestamptz,completed_at timestamptz,
      bounded_failure_reason text,retry_safety text,
      updated_at timestamptz default clock_timestamp());
    create table public.seller_os_pre_research_batch_events_v1(
      event_id uuid primary key default gen_random_uuid(),batch_id uuid,
      member_id uuid,event_type text,actor_kind text,actor_subject text,
      detail jsonb,created_at timestamptz default clock_timestamp());
    create table public.marketplace_product_research_query_plans(
      id uuid primary key,marketplace_account_key text,marketplace text,
      source_context text,pre_research_rerun_cohort_id uuid,status text,
      request_receipt_id uuid,worker_lease_owner text,
      worker_lease_expires_at timestamptz,worker_claim_count integer default 0,
      worker_last_claimed_at timestamptz,worker_capability_receipt_id uuid,
      worker_last_release_code text,worker_next_retry_at timestamptz,
      worker_last_result jsonb default '{}'::jsonb,
      created_at timestamptz default clock_timestamp(),
      updated_at timestamptz default clock_timestamp(),
      completed_at timestamptz,pre_research_result text,
      pre_research_trace_eligible boolean,pre_research_evidence_digest text,
      pre_research_evidence jsonb,pre_research_completed_at timestamptz,
      ebay_writes integer default 0);
    create table public.marketplace_product_research_query_tasks(
      id uuid primary key,plan_id uuid,marketplace_account_key text,
      marketplace text,status text,capture_batch_id uuid);
    create table public.seller_os_browser_worker_capabilities_v1(
      marketplace_account_key text,capability_id text,worker_instance_id text,
      heartbeat_receipt_id uuid,heartbeat_source text,
      physical_connection text,extension_identity_match boolean,
      observed_at timestamptz,fresh_until timestamptz);
    create table public.seller_os_operational_learning_ledger_v1(
      id uuid primary key,marketplace_account_key text,invariant_code text,
      status text,lease_owner text,lease_expires_at timestamptz,
      recovery_attempt_count integer,recovery_outcome text,
      last_observed_at timestamptz,recovery_class text,retry_safety text,
      mechanism_version text,evidence jsonb,updated_at timestamptz);
  `)
  await db.exec([
    functionSql(hardening, "reconcile_seller_os_pre_research_batch_member_v1"),
    functionSql(hardening, "prepare_seller_os_pre_research_batch_runner_v1"),
    functionSql(hardening, "next_seller_os_pre_research_batch_plan_v1"),
    functionSql(hardening, "resume_seller_os_pre_research_batch_v1"),
    functionSql(original, "claim_next_live_listing_product_research_v2"),
    functionSql(parity, "release_live_listing_product_research_v1"),
    functionSql(intake, "complete_luna_pre_research_product_research_v1"),
    `create trigger seller_os_pre_research_batch_plan_reconcile_v1
      after update of status,worker_lease_owner,worker_lease_expires_at,
        worker_last_result,worker_last_release_code,completed_at
      on public.marketplace_product_research_query_plans for each row
      execute function public.reconcile_seller_os_pre_research_batch_member_v1();`,
  ].join("\n"))
  await db.query(`insert into public.seller_os_pre_research_command_capabilities_v1
    values ($1::uuid,true,null,$2::uuid,'chatgpt-control-client')`,
  [capability, owner])
  await db.query(`insert into public.seller_os_pre_research_batches_v1
    (batch_id,owner_authorization_id,marketplace_account_key,owner_user_id,
      command_client_id,batch_state)
    values ($1::uuid,$2::uuid,$3,$4::uuid,'chatgpt-control-client','AUTHORIZED')`,
  [batch, capability, account, owner])
  for (const [index, id] of ids.entries()) {
    await db.query(`insert into public.seller_os_pre_research_batch_members_v1
      (member_id,batch_id,ordinal,plan_id,execution_state)
      values ($1::uuid,$2::uuid,$3,$4::uuid,'PENDING')`,
    [id.member, batch, index + 1, id.plan])
    await db.query(`insert into public.marketplace_product_research_query_plans
      (id,marketplace_account_key,marketplace,source_context,status)
      values ($1::uuid,$2,'EBAY_US','LUNA_PRE_RESEARCH','ACTIVE')`,
    [id.plan, account])
    await db.query(`insert into public.marketplace_product_research_query_tasks
      (id,plan_id,marketplace_account_key,marketplace,status)
      values ($1::uuid,$2::uuid,$3,'EBAY_US','PENDING')`,
    [id.task, id.plan, account])
  }
  return db
}

async function state(db) {
  return (await db.query(`select batch_state,started_at,completed_at
    from public.seller_os_pre_research_batches_v1 where batch_id=$1::uuid`,
  [batch])).rows[0]
}

async function members(db) {
  return (await db.query(`select ordinal,execution_state,
    bounded_failure_reason,retry_safety,plan_id
    from public.seller_os_pre_research_batch_members_v1
    where batch_id=$1::uuid order by ordinal`, [batch])).rows
}

async function next(db) {
  await db.query(`select public.prepare_seller_os_pre_research_batch_runner_v1(
    $1::text) as result`, [account])
  return (await db.query(`select public.next_seller_os_pre_research_batch_plan_v1(
    $1::text) as result`, [account])).rows[0].result
}

async function claim(db, planId) {
  const observed = new Date().toISOString()
  for (const family of ["PRODUCT_RESEARCH_EXTENSION",
    "PRODUCT_RESEARCH_BROWSER_WORKER"]) {
    await db.query(`insert into public.seller_os_browser_worker_capabilities_v1
      values ($1,$2,$3,$4::uuid,'INDEPENDENT_WORKER_LIVENESS',
        'PROVEN_AVAILABLE',true,$5::timestamptz,
        clock_timestamp() + interval '5 minutes')`,
    [account, family, worker, receipt, observed])
  }
  const proof = { handshakeStatus: "PASS", workerCapability: "PASS",
    extensionIdentityMatch: true, cookieAccess: false, marketplaceWrites: 0,
    heartbeatSource: "INDEPENDENT_WORKER_LIVENESS",
    extensionVersion: "test", observedAt: observed, heartbeatReceiptId: receipt }
  return (await db.query(`select claimed,plan_id
    from public.claim_next_live_listing_product_research_v2(
      $1::text,$2::text,$3::jsonb,$4::uuid,300)`,
  [account, worker, JSON.stringify(proof), planId])).rows[0]
}

async function complete(db, id, result) {
  await db.query(`update public.marketplace_product_research_query_tasks
    set status='CAPTURED',capture_batch_id=$2::uuid where id=$1::uuid`,
  [id.task, id.capture])
  const evidence = { officialSoldAuthority: true,
    comparableClassification: result,
    capturedTaskId: id.task, captureBatchId: id.capture }
  const completed = await db.query(`select
    public.complete_luna_pre_research_product_research_v1(
      $1::text,$2::uuid,$3::text,$4::uuid,$5::text,$6::boolean,
      $7::text,$8::jsonb,clock_timestamp()) as result`,
  [account, id.plan, worker, id.capture, result,
    result !== "INSUFFICIENT_MARKET_EVIDENCE",
    `sha256:${"a".repeat(64)}`, JSON.stringify(evidence)])
  assert.equal(completed.rows[0].result.result, result)
  return evidence
}

test("five-member batch auto-starts, isolates failure and terminalizes without sibling replay", async () => {
  const db = await fixture()
  try {
    assert.equal((await state(db)).batch_state, "AUTHORIZED")
    assert.equal((await next(db)).planId, ids[0].plan)
    assert.equal((await claim(db, ids[0].plan)).claimed, true)
    assert.equal((await state(db)).batch_state, "RUNNING")
    const firstEvidence = await complete(db, ids[0], "PRE_RESEARCH_HIGH")

    assert.equal((await next(db)).planId, ids[1].plan)
    assert.equal((await claim(db, ids[1].plan)).claimed, true)
    const failed = await db.query(`select
      public.release_live_listing_product_research_v1(
        $1::text,$2::uuid,$3::text,$4::text) as released`,
    [account, ids[1].plan, worker, "MARKET_REVALIDATION_REQUEST_FAILED"])
    assert.equal(failed.rows[0].released, true)
    assert.equal((await state(db)).batch_state, "RUNNING")
    assert.equal((await members(db))[1].execution_state, "NEEDS_ATTENTION")

    for (const [index, result] of [
      [2, "PRE_RESEARCH_MEDIUM"],
      [3, "INSUFFICIENT_MARKET_EVIDENCE"],
      [4, "PRE_RESEARCH_LOW"],
    ]) {
      assert.equal((await next(db)).planId, ids[index].plan)
      assert.equal((await claim(db, ids[index].plan)).claimed, true)
      await complete(db, ids[index], result)
    }
    assert.deepEqual((await members(db)).map((row) => row.execution_state),
      ["COMPLETED", "NEEDS_ATTENTION", "COMPLETED", "COMPLETED", "COMPLETED"])
    assert.equal((await state(db)).batch_state, "NEEDS_ATTENTION")
    assert.ok((await state(db)).completed_at)
    assert.equal((await next(db)).planId, null)

    const plans = (await db.query(`select id,worker_claim_count,ebay_writes,
      pre_research_evidence from public.marketplace_product_research_query_plans
      order by id`)).rows
    assert.deepEqual(plans.map((row) => row.worker_claim_count), [1,1,1,1,1])
    assert.deepEqual(plans.map((row) => row.ebay_writes), [0,0,0,0,0])
    assert.deepEqual(plans[0].pre_research_evidence, firstEvidence)
    const events = (await db.query(`select member_id,event_type,detail
      from public.seller_os_pre_research_batch_events_v1
      order by created_at,event_id`)).rows
    assert.ok(events.some((event) => event.member_id === ids[1].member &&
      event.event_type === "NEEDS_ATTENTION" &&
      event.detail.failureCode === "MARKET_REVALIDATION_REQUEST_FAILED"))
    for (const id of ids.slice(2)) assert.ok(events.some((event) =>
      event.member_id === id.member && event.event_type === "COMPLETED"))

    const resumed = (await db.query(`select
      public.resume_seller_os_pre_research_batch_v1(
        $1::uuid,$2::uuid,$3::text) as result`,
    [batch, owner, "chatgpt-control-client"])).rows[0].result
    assert.equal(resumed.resumedMembers, 1)
    assert.equal((await state(db)).batch_state, "RUNNING")
    const replay = (await db.query(`select
      public.resume_seller_os_pre_research_batch_v1(
        $1::uuid,$2::uuid,$3::text) as result`,
    [batch, owner, "chatgpt-control-client"])).rows[0].result
    assert.equal(replay.resumedMembers, 0)
    assert.equal((await next(db)).planId, null) // cooldown still applies
    assert.deepEqual((await members(db)).map((row) => row.execution_state),
      ["COMPLETED", "PENDING", "COMPLETED", "COMPLETED", "COMPLETED"])
    assert.deepEqual((await db.query(`select worker_claim_count
      from public.marketplace_product_research_query_plans
      order by id`)).rows.map((row) => row.worker_claim_count), [1,1,1,1,1])
    assert.deepEqual((await db.query(`select pre_research_evidence
      from public.marketplace_product_research_query_plans
      where id=$1::uuid`, [ids[0].plan])).rows[0].pre_research_evidence,
    firstEvidence)
  } finally { await db.close() }
})

test("expired leases recover only retry-safe pending work and retain durable capture", async () => {
  const db = await fixture()
  try {
    assert.equal((await claim(db, ids[0].plan)).claimed, true)
    await db.query(`update public.marketplace_product_research_query_plans
      set worker_lease_expires_at=clock_timestamp()-interval '1 minute',
        pre_research_evidence='{"durable":"kept"}'::jsonb
      where id=$1::uuid`, [ids[0].plan])
    assert.equal((await next(db)).planId, ids[0].plan)
    const plan = (await db.query(`select worker_lease_owner,worker_claim_count,
      worker_last_result,pre_research_evidence
      from public.marketplace_product_research_query_plans
      where id=$1::uuid`, [ids[0].plan])).rows[0]
    assert.equal(plan.worker_lease_owner, null)
    assert.equal(plan.worker_claim_count, 1)
    assert.equal(plan.worker_last_result.state, "STALE_LEASE_RECOVERED")
    assert.deepEqual(plan.pre_research_evidence, { durable: "kept" })
    assert.equal((await claim(db, ids[0].plan)).claimed, true)
    assert.equal((await db.query(`select worker_claim_count from
      public.marketplace_product_research_query_plans
      where id=$1::uuid`, [ids[0].plan])).rows[0].worker_claim_count, 2)
    assert.equal((await next(db)).planId, ids[1].plan)
    const recovered = (await db.query(`select count(*)::int as count
      from public.seller_os_pre_research_batch_events_v1
      where member_id=$1::uuid and detail->>'leaseRecovery'='EXPIRED'`,
    [ids[0].member])).rows[0].count
    assert.equal(recovered, 1)
  } finally { await db.close() }
})

test("expired lease with no pending task is quarantined without replaying capture", async () => {
  const db = await fixture()
  try {
    assert.equal((await claim(db, ids[0].plan)).claimed, true)
    await db.query(`update public.marketplace_product_research_query_tasks
      set status='CAPTURED',capture_batch_id=$2::uuid where id=$1::uuid`,
    [ids[0].task, ids[0].capture])
    await db.query(`update public.marketplace_product_research_query_plans
      set worker_lease_expires_at=clock_timestamp()-interval '1 minute'
      where id=$1::uuid`, [ids[0].plan])
    assert.equal((await next(db)).planId, ids[1].plan)
    assert.equal((await members(db))[0].execution_state, "NEEDS_ATTENTION")
    assert.equal((await members(db))[0].retry_safety, "ENGINEERING_REQUIRED")
    assert.equal((await members(db))[0].bounded_failure_reason,
      "PRODUCT_RESEARCH_CAPTURE_SETTLED_REVIEW_REQUIRED")
    assert.equal((await db.query(`select capture_batch_id from
      public.marketplace_product_research_query_tasks
      where id=$1::uuid`, [ids[0].task])).rows[0].capture_batch_id,
    ids[0].capture)
  } finally { await db.close() }
})

test("historical NEEDS_ATTENTION batch with pending siblings is healed on worker poll", async () => {
  const db = await fixture()
  try {
    await db.query(`update public.seller_os_pre_research_batch_members_v1
      set execution_state='NEEDS_ATTENTION',
        bounded_failure_reason='MARKET_REVALIDATION_REQUEST_FAILED',
        retry_safety='SAFE_IDEMPOTENT_RUNTIME_RESUME'
      where member_id=$1::uuid`, [ids[1].member])
    await db.query(`update public.seller_os_pre_research_batches_v1
      set batch_state='NEEDS_ATTENTION',started_at=clock_timestamp()
      where batch_id=$1::uuid`, [batch])
    assert.equal((await next(db)).planId, ids[0].plan)
    assert.equal((await state(db)).batch_state, "RUNNING")
    assert.equal((await members(db))[1].execution_state, "NEEDS_ATTENTION")
    assert.equal((await members(db))[1].bounded_failure_reason,
      "MARKET_REVALIDATION_REQUEST_FAILED")
  } finally { await db.close() }
})

test("stale lease remains recoverable when a previous failure receipt masks member state", async () => {
  const db = await fixture()
  try {
    assert.equal((await claim(db, ids[0].plan)).claimed, true)
    await db.query(`update public.marketplace_product_research_query_plans
      set worker_last_result='{"state":"RELEASED_RETRY_SAFE"}'::jsonb,
        worker_lease_expires_at=clock_timestamp()-interval '1 minute'
      where id=$1::uuid`, [ids[0].plan])
    assert.equal((await members(db))[0].execution_state, "NEEDS_ATTENTION")
    assert.equal((await next(db)).planId, ids[0].plan)
    assert.equal((await members(db))[0].execution_state, "PENDING")
    assert.equal((await state(db)).batch_state, "RUNNING")
  } finally { await db.close() }
})

test("exhausted stale lease is isolated while later members remain eligible", async () => {
  const db = await fixture()
  try {
    assert.equal((await claim(db, ids[0].plan)).claimed, true)
    await db.query(`update public.marketplace_product_research_query_plans
      set worker_claim_count=5,
        worker_lease_expires_at=clock_timestamp()-interval '1 minute'
      where id=$1::uuid`, [ids[0].plan])
    assert.equal((await next(db)).planId, ids[1].plan)
    assert.deepEqual({ state: (await members(db))[0].execution_state,
      retrySafety: (await members(db))[0].retry_safety }, {
      state: "NEEDS_ATTENTION", retrySafety: "ENGINEERING_REQUIRED",
    })
    assert.equal((await db.query(`select worker_claim_count from
      public.marketplace_product_research_query_plans
      where id=$1::uuid`, [ids[0].plan])).rows[0].worker_claim_count, 5)
    assert.equal((await next(db)).planId, ids[1].plan)
  } finally { await db.close() }
})

test("resume selects safe members without reviving exhausted or completed siblings", async () => {
  const db = await fixture()
  try {
    await db.query(`update public.seller_os_pre_research_batch_members_v1
      set execution_state='COMPLETED' where member_id=$1::uuid`,
    [ids[0].member])
    await db.query(`update public.seller_os_pre_research_batch_members_v1
      set execution_state='NEEDS_ATTENTION',
        retry_safety='ENGINEERING_REQUIRED' where member_id=$1::uuid`,
    [ids[1].member])
    await db.query(`update public.seller_os_pre_research_batch_members_v1
      set execution_state='NEEDS_ATTENTION',
        retry_safety='SAFE_IDEMPOTENT_RUNTIME_RESUME'
      where member_id=$1::uuid`, [ids[2].member])
    const resumed = (await db.query(`select
      public.resume_seller_os_pre_research_batch_v1(
        $1::uuid,$2::uuid,$3::text) as result`,
    [batch, owner, "chatgpt-control-client"])).rows[0].result
    assert.equal(resumed.resumedMembers, 1)
    assert.deepEqual((await members(db)).map((row) => row.execution_state),
      ["COMPLETED","NEEDS_ATTENTION","PENDING","PENDING","PENDING"])
    const repeated = (await db.query(`select
      public.resume_seller_os_pre_research_batch_v1(
        $1::uuid,$2::uuid,$3::text) as result`,
    [batch, owner, "chatgpt-control-client"])).rows[0].result
    assert.equal(repeated.resumedMembers, 0)
    assert.equal((await db.query(`select count(*)::int as count from
      public.seller_os_pre_research_batch_events_v1
      where event_type='RESUMED' and actor_kind='COMMAND_CLIENT'`)).rows[0].count, 1)
  } finally { await db.close() }
})

test("one reused canonical plan reconciles every attached batch without duplicate capture", async () => {
  const db = await fixture()
  const reusedBatch = "30000000-0000-4000-8000-000000000002"
  const reusedMember = "60000000-0000-4000-8000-000000000099"
  try {
    await db.query(`insert into public.seller_os_pre_research_batches_v1
      (batch_id,owner_authorization_id,marketplace_account_key,owner_user_id,
        command_client_id,batch_state)
      values ($1::uuid,$2::uuid,$3,$4::uuid,
        'chatgpt-control-client','AUTHORIZED')`,
    [reusedBatch, capability, account, owner])
    await db.query(`insert into public.seller_os_pre_research_batch_members_v1
      (member_id,batch_id,ordinal,plan_id,execution_state)
      values ($1::uuid,$2::uuid,1,$3::uuid,'PENDING')`,
    [reusedMember, reusedBatch, ids[0].plan])
    assert.equal((await next(db)).planId, ids[0].plan)
    assert.equal((await claim(db, ids[0].plan)).claimed, true)
    assert.equal((await db.query(`select execution_state from
      public.seller_os_pre_research_batch_members_v1
      where member_id=$1::uuid`, [reusedMember])).rows[0].execution_state,
    "RUNNING")
    await complete(db, ids[0], "PRE_RESEARCH_HIGH")
    assert.equal((await db.query(`select execution_state from
      public.seller_os_pre_research_batch_members_v1
      where member_id=$1::uuid`, [reusedMember])).rows[0].execution_state,
    "COMPLETED")
    assert.equal((await db.query(`select batch_state from
      public.seller_os_pre_research_batches_v1
      where batch_id=$1::uuid`, [reusedBatch])).rows[0].batch_state,
    "COMPLETED")
    assert.equal((await db.query(`select worker_claim_count from
      public.marketplace_product_research_query_plans
      where id=$1::uuid`, [ids[0].plan])).rows[0].worker_claim_count, 1)
  } finally { await db.close() }
})

test("runner and migration preserve isolated explicit claims and no market writes", () => {
  const runner = readFileSync(
    "app/admin/ebay/opportunity-queue/research/mayel-market-revalidation-runner.tsx",
    "utf8")
  const operator = readFileSync(
    "app/api/admin/ebay/live-optimization-operator/route.ts", "utf8")
  assert.match(runner, /GET_NEXT_AUTHORIZED_PRE_RESEARCH_BATCH_PLAN/)
  assert.match(runner, /PREPARE_AUTHORIZED_PRE_RESEARCH_BATCH_RUNNER/)
  const workerSelection = runner.slice(runner.indexOf(
    "async function nextAuthorizedBatchPlanId"), runner.indexOf(
    "function extensionCommand"))
  assert.match(workerSelection,
    /if \(result\.planId === null\)[\s\S]*GET_NEXT_CURRENT_PACKAGE_KEYWORD_PLAN/)
  assert.match(runner, /CLAIM_AUTONOMOUS_RESEARCH_PLAN/)
  assert.match(runner, /if \(browserWorkerControl && autonomous\) continue/)
  assert.match(runner, /captured\.marketplaceWrites !== 0/)
  const prepareRoute = operator.slice(operator.indexOf(
    'if (action === "PREPARE_AUTHORIZED_PRE_RESEARCH_BATCH_RUNNER")'),
  operator.indexOf('if (action === "GET_NEXT_AUTHORIZED_PRE_RESEARCH_BATCH_PLAN")'))
  assert.match(prepareRoute, /verifySellerOsBrowserWorkloadLeaseV1/)
  assert.match(prepareRoute, /claimAuthorityGranted/)
  assert.match(prepareRoute, /prepareAuthorizedTeoPreResearchRunnerV1/)
  assert.match(original, /batch_member\.execution_state = 'PENDING'/)
  assert.match(original, /batch\.batch_state in \('AUTHORIZED','RUNNING'\)/)
  const lookup = functionSql(hardening,
    "next_seller_os_pre_research_batch_plan_v1")
  assert.match(lookup, /language sql security definer[\s\S]*stable/)
  assert.doesNotMatch(lookup, /update\s+|insert\s+|delete\s+/i)
  assert.doesNotMatch(hardening,
    /ebay_active_listings|seller_os_luna_stock|publisher|commercial_trace/i)
  assert.doesNotMatch(hardening, /delete\s+from|truncate\s+|drop\s+table/i)
})
