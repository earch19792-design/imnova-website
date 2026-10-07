import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

import {
  classifySellerOsWorkerFailureV2,
  nextSellerOsBrowserRecoveryStageV2,
  sellerOsWorkerCircuitStateV2,
} from "../seller-os/worker-self-healing-v2.ts"

const migration = readFileSync(
  "supabase/migrations/20261007164841_seller_os_worker_resilience_and_self_healing_v2.sql",
  "utf8")
const runtimeCertificationMigration = readFileSync(
  "supabase/migrations/20261007172003_seller_os_worker_resilience_runtime_certification_v2_1.sql",
  "utf8")
const runner = readFileSync(
  "app/admin/ebay/opportunity-queue/research/mayel-market-revalidation-runner.tsx",
  "utf8")
const extension = readFileSync(
  "tools/browser-extensions/ebay-product-research-capture/background.js", "utf8")
const readinessPage = readFileSync(
  "app/admin/ebay/operational-readiness/page.tsx", "utf8")
const operatorRoute = readFileSync(
  "app/api/admin/ebay/live-optimization-operator/route.ts", "utf8")
const preResearchControl = readFileSync(
  "lib/ebay/teo-pre-research-control-plane-v1.ts", "utf8")
const acquisition = readFileSync(
  "lib/ebay/ebay-mayel-live-market-revalidation-v1.ts", "utf8")

function functionSql(source, name) {
  const start = source.indexOf(`create or replace function public.${name}(`)
  assert.notEqual(start, -1, `${name} exists`)
  const opening = source.indexOf("$function$", start)
  const end = source.indexOf("$function$;", opening + 10)
  assert.notEqual(end, -1, `${name} ends`)
  return source.slice(start, end + 11)
}

const account = "ebay-us-owner"
const worker = "product-research-browser:40000000-0000-4000-8000-000000000001"
const batch = "30000000-0000-4000-8000-000000000001"
const member = "31000000-0000-4000-8000-000000000001"
const plan = "70000000-0000-4000-8000-000000000001"
const task = "80000000-0000-4000-8000-000000000001"
const receipt = "50000000-0000-4000-8000-000000000001"

async function fixture() {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema extensions;
    create extension pgcrypto schema extensions;
    create function public.is_seller_os_service_role_request_v1()
    returns boolean language sql stable as $$ select true $$;
    create table public.seller_os_operational_learning_ledger_v1(
      id uuid primary key default extensions.gen_random_uuid(),
      marketplace_account_key text not null,failure_class text not null,
      invariant_code text not null,mechanism_version text not null,
      evidence_fingerprint text not null,recovery_policy_version text not null,
      retry_safety text not null,recovery_class text not null,
      recovery_outcome text not null,regression_guard jsonb not null,
      evidence jsonb not null,status text not null,lease_owner text,
      lease_expires_at timestamptz,recovery_attempt_count integer default 0,
      first_observed_at timestamptz,last_observed_at timestamptz,
      resolved_at timestamptz,created_at timestamptz default clock_timestamp(),
      updated_at timestamptz default clock_timestamp(),incident_state text default 'OPEN',
      occurrence_count integer default 1,consecutive_count integer default 1,
      affected_task_count integer default 0,first_recovery_attempt_at timestamptz,
      last_recovery_attempt_at timestamptz,recovery_succeeded_at timestamptz,
      code_version text,regression_after_fix boolean default false,
      unique(marketplace_account_key,invariant_code,evidence_fingerprint,
        mechanism_version));
    create table public.marketplace_product_research_query_plans(
      id uuid primary key,marketplace_account_key text,marketplace text,
      source_context text,pre_research_rerun_cohort_id uuid,status text,
      source_luna_product_id text,subject_supplier_variant_id text,
      source_supplier_sku text,source_candidate_key text,
      source_product_truth_fingerprint text,request_receipt_id uuid,
      worker_lease_owner text,worker_lease_expires_at timestamptz,
      worker_claim_count integer default 0,worker_last_claimed_at timestamptz,
      worker_capability_receipt_id uuid,worker_last_release_code text,
      worker_next_retry_at timestamptz,worker_last_result jsonb default '{}'::jsonb,
      created_at timestamptz default clock_timestamp(),
      updated_at timestamptz default clock_timestamp(),completed_at timestamptz,
      pre_research_completed_at timestamptz);
    create table public.marketplace_product_research_query_tasks(
      id uuid primary key,plan_id uuid,marketplace_account_key text,
      marketplace text,status text,capture_batch_id uuid,
      captured_at timestamptz,processed_at timestamptz,
      created_at timestamptz default clock_timestamp(),
      updated_at timestamptz default clock_timestamp());
    create table public.seller_os_pre_research_batches_v1(
      batch_id uuid primary key,marketplace_account_key text,batch_state text,
      started_at timestamptz,completed_at timestamptz,
      updated_at timestamptz default clock_timestamp());
    create table public.seller_os_pre_research_batch_members_v1(
      member_id uuid primary key,batch_id uuid,ordinal integer,
      luna_product_id text,luna_variant_id text,luna_sku text,
      source_candidate_key text,product_truth_fingerprint text,plan_id uuid,
      execution_state text,started_at timestamptz,completed_at timestamptz,
      bounded_failure_reason text,retry_safety text,
      updated_at timestamptz default clock_timestamp());
    create table public.seller_os_pre_research_batch_events_v1(
      event_id uuid primary key default extensions.gen_random_uuid(),
      batch_id uuid,member_id uuid,event_type text,actor_kind text,
      actor_subject text,detail jsonb,created_at timestamptz default clock_timestamp());
    create table public.seller_os_browser_worker_capabilities_v1(
      marketplace_account_key text,capability_id text,worker_family text,
      worker_instance_id text,heartbeat_receipt_id uuid,heartbeat_source text,
      physical_connection text,worker_state text,extension_identity_match boolean,
      extension_version text,observed_at timestamptz,fresh_until timestamptz,
      last_heartbeat_at timestamptz);
    create table public.seller_os_browser_workload_leader_heartbeats_v1(
      marketplace_account_key text,worker_family text,leader_session_id uuid,
      worker_instance_id text,lease_generation bigint,observed_at timestamptz,
      fresh_until timestamptz,updated_at timestamptz default clock_timestamp());
  `)
  await db.exec([
    functionSql(migration, "guard_seller_os_pre_research_authorization_v2"),
    functionSql(migration, "classify_seller_os_worker_failure_v2"),
    functionSql(migration, "release_seller_os_product_research_failure_v2"),
    functionSql(migration, "record_seller_os_worker_progress_v2"),
    functionSql(runtimeCertificationMigration,
      "reconcile_seller_os_worker_stuck_work_v2"),
    functionSql(runtimeCertificationMigration,
      "read_seller_os_worker_resilience_v2"),
    functionSql(migration, "reconcile_seller_os_pre_research_batch_member_v1"),
    `create trigger authorization_guard before insert or update of batch_state
      on public.seller_os_pre_research_batches_v1 for each row execute function
      public.guard_seller_os_pre_research_authorization_v2();`,
    `create trigger member_reconcile after update of status,worker_lease_owner,
      worker_lease_expires_at,worker_last_result,worker_last_release_code,completed_at
      on public.marketplace_product_research_query_plans for each row execute function
      public.reconcile_seller_os_pre_research_batch_member_v1();`,
  ].join("\n"))
  await db.query(`insert into public.seller_os_pre_research_batches_v1
    values ($1::uuid,$2,'REQUESTED',null,null,clock_timestamp())`, [batch, account])
  await db.query(`insert into public.seller_os_pre_research_batch_members_v1(
    member_id,batch_id,ordinal,luna_product_id,luna_variant_id,luna_sku,
    source_candidate_key,product_truth_fingerprint,execution_state)
    values ($1::uuid,$2::uuid,1,'6127','7127','ITEM6127',$3,$4,'PENDING')`,
  [member, batch, `sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`])
  await db.query(`insert into public.marketplace_product_research_query_plans(
    id,marketplace_account_key,marketplace,source_context,status,
    source_luna_product_id,subject_supplier_variant_id,source_supplier_sku,
    source_candidate_key,source_product_truth_fingerprint)
    values ($1::uuid,$2,'EBAY_US','LUNA_PRE_RESEARCH','ACTIVE','6127','7127',
      'ITEM6127',$3,$4)`, [plan, account, `sha256:${"a".repeat(64)}`,
    `sha256:${"b".repeat(64)}`])
  await db.query(`insert into public.marketplace_product_research_query_tasks(
    id,plan_id,marketplace_account_key,marketplace,status)
    values ($1::uuid,$2::uuid,$3,'EBAY_US','PENDING')`, [task, plan, account])
  return db
}

test("failure classifier is explicit and unknown failures fail closed", () => {
  assert.equal(classifySellerOsWorkerFailureV2(
    "PRODUCT_RESEARCH_VISIBLE_TABLE_NOT_FOUND"), "TRANSIENT")
  assert.equal(classifySellerOsWorkerFailureV2("SESSION_EXPIRED"), "SESSION")
  assert.equal(classifySellerOsWorkerFailureV2(
    "INSUFFICIENT_MARKET_EVIDENCE"), "TASK_DATA")
  assert.equal(classifySellerOsWorkerFailureV2("PLAN_ATTACHMENT_MISSING"),
    "ENGINEERING")
  assert.equal(classifySellerOsWorkerFailureV2("SOMETHING_NEW"), "ENGINEERING")
})

test("visible-table recovery ladder exhausts before task quarantine", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(nextSellerOsBrowserRecoveryStageV2), [
    "WAIT_RENDER_CHECK", "REFRESH_PAGE", "RECREATE_TAB_SESSION",
    "RESTART_BROWSER_WORKER", "QUARANTINE_TASK",
  ])
  assert.equal(sellerOsWorkerCircuitStateV2({
    consecutiveFingerprintCount: 9, canaryPassed: false,
  }).consumptionAllowed, true)
  assert.equal(sellerOsWorkerCircuitStateV2({
    consecutiveFingerprintCount: 10, canaryPassed: false,
  }).state, "OPEN")
  assert.equal(sellerOsWorkerCircuitStateV2({
    consecutiveFingerprintCount: 10, canaryPassed: true,
  }).state, "CLOSED")
  for (const stage of ["WAIT_RENDER_CHECK", "REFRESH_PAGE",
    "RECREATE_TAB_SESSION", "RESTART_BROWSER_WORKER"]) {
    assert.ok(extension.indexOf(stage) >= 0)
  }
  assert.ok(extension.indexOf("WAIT_RENDER_CHECK") <
    extension.indexOf("REFRESH_PAGE"))
  assert.ok(extension.indexOf("REFRESH_PAGE") <
    extension.indexOf("RECREATE_TAB_SESSION"))
})

test("authorization is fail-closed until every member has a valid plan", async () => {
  const db = await fixture()
  try {
    await assert.rejects(db.query(`update public.seller_os_pre_research_batches_v1
      set batch_state='AUTHORIZED' where batch_id=$1::uuid`, [batch]),
    /PLAN_ATTACHMENT_MISSING/)
    await db.query(`update public.seller_os_pre_research_batch_members_v1
      set plan_id=$2::uuid where member_id=$1::uuid`, [member, plan])
    await db.query(`update public.seller_os_pre_research_batches_v1
      set batch_state='AUTHORIZED' where batch_id=$1::uuid`, [batch])
    const state = await db.query(`select batch_state from
      public.seller_os_pre_research_batches_v1 where batch_id=$1::uuid`, [batch])
    assert.equal(state.rows[0].batch_state, "AUTHORIZED")
  } finally { await db.close() }
})

test("a bad item enters RETRY_WAIT while its sibling lane remains consumable", async () => {
  const db = await fixture()
  try {
    await db.query(`update public.seller_os_pre_research_batch_members_v1
      set plan_id=$2::uuid where member_id=$1::uuid`, [member, plan])
    await db.query(`update public.seller_os_pre_research_batches_v1
      set batch_state='AUTHORIZED' where batch_id=$1::uuid`, [batch])
    await db.query(`update public.marketplace_product_research_query_plans
      set worker_lease_owner=$2,worker_lease_expires_at=clock_timestamp()+interval '5 minutes',
        worker_claim_count=1,worker_last_claimed_at=clock_timestamp()
      where id=$1::uuid`, [plan, worker])
    const released = await db.query(`select
      public.release_seller_os_product_research_failure_v2(
        $1,$2::uuid,$3,'PRODUCT_RESEARCH_VISIBLE_TABLE_NOT_FOUND',
        'SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2') as value`,
    [account, plan, worker])
    assert.equal(released.rows[0].value.failureClass, "TRANSIENT")
    assert.equal(released.rows[0].value.recoveryAction, "RETRY_WAIT")
    const memberState = await db.query(`select execution_state,retry_safety
      from public.seller_os_pre_research_batch_members_v1
      where member_id=$1::uuid`, [member])
    assert.equal(memberState.rows[0].execution_state, "RETRY_WAIT")
    assert.equal(memberState.rows[0].retry_safety,
      "SAFE_IDEMPOTENT_RUNTIME_RESUME")
    const batchState = await db.query(`select batch_state from
      public.seller_os_pre_research_batches_v1 where batch_id=$1::uuid`, [batch])
    assert.equal(batchState.rows[0].batch_state, "RUNNING")
  } finally { await db.close() }
})

test("functional canary proves PENDING through COMPLETED and auto-resolves", async () => {
  const db = await fixture()
  try {
    const report = (stage) => db.query(`select
      public.record_seller_os_worker_progress_v2($1,$2,$3::uuid,$4,
        'SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2') as value`,
    [account, worker, plan, stage])
    assert.equal((await report("PENDING")).rows[0].value.stage, "PENDING")
    await db.query(`update public.marketplace_product_research_query_plans set
      worker_lease_owner=$2,worker_lease_expires_at=clock_timestamp()+interval '5 minutes',
      worker_claim_count=1,worker_last_claimed_at=clock_timestamp()
      where id=$1::uuid`, [plan, worker])
    assert.equal((await report("CLAIMED")).rows[0].value.stage, "CLAIMED")
    assert.equal((await report("RUNNING")).rows[0].value.stage, "RUNNING")
    await db.query(`update public.marketplace_product_research_query_tasks
      set status='PROCESSED',captured_at=clock_timestamp(),processed_at=clock_timestamp()
      where id=$1::uuid`, [task])
    await db.query(`update public.marketplace_product_research_query_plans
      set status='COMPLETED',completed_at=clock_timestamp(),
        worker_lease_owner=null,worker_lease_expires_at=null where id=$1::uuid`, [plan])
    assert.equal((await report("COMPLETED")).rows[0].value.stage, "COMPLETED")
    await db.query(`update public.seller_os_operational_learning_ledger_v1
      set recovery_succeeded_at=clock_timestamp()-interval '2 seconds'
      where invariant_code='PRODUCT_RESEARCH_FUNCTIONAL_CANARY'`)
    for (const capability of ["PRODUCT_RESEARCH_EXTENSION",
      "PRODUCT_RESEARCH_BROWSER_WORKER"]) {
      await db.query(`insert into public.seller_os_browser_worker_capabilities_v1
        values ($1,$2,'PRODUCT_RESEARCH',$3,$4::uuid,
          'INDEPENDENT_WORKER_LIVENESS','PROVEN_AVAILABLE','IDLE',true,'test',
          clock_timestamp(),clock_timestamp()+interval '5 minutes',clock_timestamp())`,
      [account, capability, worker, receipt])
    }
    await db.query(`insert into public.seller_os_browser_workload_leader_heartbeats_v1
      values ($1,'PRODUCT_RESEARCH',$2::uuid,$3,1,clock_timestamp(),
        clock_timestamp()+interval '2 minutes',clock_timestamp())`,
    [account, receipt, worker])
    const reconciled = await db.query(`select
      public.reconcile_seller_os_worker_stuck_work_v2($1,$2) as value`,
    [account, worker])
    assert.equal(reconciled.rows[0].value.incidentsAutoResolved, 1)
    const canary = await db.query(`select status,incident_state
      from public.seller_os_operational_learning_ledger_v1
      where invariant_code='PRODUCT_RESEARCH_FUNCTIONAL_CANARY'`)
    assert.deepEqual(canary.rows[0], { status: "RESOLVED",
      incident_state: "RESOLVED" })
  } finally { await db.close() }
})

test("retry-exhausted plans remain quarantined and are not false pending work", async () => {
  const db = await fixture()
  try {
    for (const capability of ["PRODUCT_RESEARCH_EXTENSION",
      "PRODUCT_RESEARCH_BROWSER_WORKER"]) {
      await db.query(`insert into public.seller_os_browser_worker_capabilities_v1
        values ($1,$2,'PRODUCT_RESEARCH',$3,$4::uuid,
          'INDEPENDENT_WORKER_LIVENESS','PROVEN_AVAILABLE','IDLE',true,'test',
          clock_timestamp(),clock_timestamp()+interval '5 minutes',clock_timestamp())`,
      [account, capability, worker, receipt])
    }
    await db.query(`insert into public.seller_os_browser_workload_leader_heartbeats_v1
      values ($1,'PRODUCT_RESEARCH',$2::uuid,$3,1,clock_timestamp(),
        clock_timestamp()+interval '2 minutes',clock_timestamp())`,
    [account, receipt, worker])
    await db.query(`update public.marketplace_product_research_query_plans set
      worker_claim_count=5,worker_last_result=jsonb_build_object(
        'state','RECLAIMED_PENDING','retrySafety','ENGINEERING_REQUIRED'),
      updated_at=clock_timestamp()-interval '10 minutes'
      where id=$1::uuid`, [plan])
    const reconciled = await db.query(`select
      public.reconcile_seller_os_worker_stuck_work_v2($1,$2) as value`,
    [account, worker])
    assert.equal(reconciled.rows[0].value.exhaustedPlansQuarantined, 1)
    assert.equal(reconciled.rows[0].value.pendingPlansRepublished, 0)
    const health = await db.query(`select
      public.read_seller_os_worker_resilience_v2($1) as value`, [account])
    assert.equal(health.rows[0].value.progress.pendingTaskCount, 0)
    assert.equal(health.rows[0].value.progress.exhaustedPlanCount, 1)
    assert.equal(health.rows[0].value.progress.state, "PASS")
    assert.equal(health.rows[0].value.progress.reasonCode,
      "IDLE_NO_PENDING_WORK")
    const planState = await db.query(`select worker_last_result->>'state' as state
      from public.marketplace_product_research_query_plans where id=$1::uuid`,
    [plan])
    assert.equal(planState.rows[0].state, "QUARANTINED")
  } finally { await db.close() }
})

test("read-only surfaces preserve unavailable values and expose three health levels", () => {
  assert.match(readinessPage, /LIVENESS/)
  assert.match(readinessPage, /READINESS/)
  assert.match(readinessPage, /PROGRESS/)
  assert.match(readinessPage, /function shownCount/)
  assert.doesNotMatch(readinessPage,
    /pendingTaskCount\s*\?\?\s*0|missingPlanAttachmentCount\s*\?\?\s*0/)
  assert.match(runner, /REPORT_PRODUCT_RESEARCH_PROGRESS/)
  assert.match(runner, /los demás miembros continúan/)
  assert.match(migration, /BATCH_AUTHORIZED_EVERY_MEMBER_HAS_VALID_PLAN/)
  assert.match(migration, /marketplaceWrites',0/)
  assert.match(runtimeCertificationMigration, /worker_claim_count < 5/)
  assert.match(runtimeCertificationMigration,
    /PRODUCT_RESEARCH_RETRY_BUDGET_EXHAUSTED/)
  assert.match(operatorRoute, /repairMissingTeoPreResearchPlanAttachmentsV2/)
  assert.match(preResearchControl,
    /attach_seller_os_pre_research_batch_plans_v1/)
  assert.match(preResearchControl,
    /TEO_PRE_RESEARCH_ATTACHMENT_REPAIR_READBACK_FAILED/)
  assert.match(acquisition, /Number\(plan\.worker_claim_count \?\? 0\) < 5/)
})
