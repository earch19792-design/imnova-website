import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

const migrationName =
  "20260919160000_pre_research_controlled_rerun_cohort_v1.sql"
const migrationPath = `supabase/migrations/${migrationName}`
const sql = readFileSync(migrationPath, "utf8")
const server = readFileSync("lib/ebay/ebay-seller-os-mcp-server-v1.ts", "utf8")
const controlledRoute = readFileSync(
  "app/api/admin/ebay/pre-research/controlled-rerun/route.ts", "utf8")
const normalRoute = readFileSync(
  "app/api/admin/ebay/pre-research/route.ts", "utf8")
const runtime = readFileSync(
  "lib/ebay/ebay-mayel-live-market-revalidation-v1.ts", "utf8")

test("migration ID is unique and run_id approval authority is untouched", () => {
  const matches = readdirSync("supabase/migrations")
    .filter((name) => name.startsWith("20260919160000_"))
  assert.deepEqual(matches, [migrationName])
  assert.doesNotMatch(sql, /drop\s+constraint[^;]*run_id/is)
  assert.doesNotMatch(sql,
    /alter\s+column\s+run_id|update[^;]*\brun_id\b|insert[^;]*marketplace_listing_approval_queue_runs/is)
  assert.match(sql, /pre_research_rerun_cohort_id uuid null references/)
})

test("normal and cohort identities use separate partial uniqueness while global input uniqueness remains", () => {
  assert.match(sql,
    /marketplace_product_research_luna_normal_identity_uq[\s\S]*source_context = 'LUNA_PRE_RESEARCH'[\s\S]*pre_research_rerun_cohort_id is null/)
  assert.match(sql,
    /marketplace_product_research_luna_rerun_identity_uq[\s\S]*source_candidate_key,[\s\S]*pre_research_rerun_cohort_id[\s\S]*pre_research_rerun_cohort_id is not null/)
  assert.doesNotMatch(sql,
    /drop\s+constraint\s+marketplace_product_research_query_plans_input_unique/i)
  assert.match(sql,
    /create or replace function public\.create_or_reuse_luna_pre_research_plan_v1[\s\S]*source_candidate_key = p_identity_key[\s\S]*pre_research_rerun_cohort_id is null/)
})

test("cohort authority is bounded, sealed, immutable, actor-bound, and read-only outside RPC", () => {
  for (const field of ["cohort_id", "account", "marketplace",
    "contract_version", "reason_code", "actor_subject", "actor_client_id",
    "snapshot_id", "policy_version", "maximum_members", "membership_digest",
    "state", "created_at", "sealed_at"]) assert.match(sql, new RegExp(`\\b${field}\\b`))
  for (const field of ["product_id", "variant_id", "luna_sku",
    "source_candidate_key", "product_truth_fingerprint", "prior_plan_id",
    "prior_plan_input_hash", "base_input_hash", "execution_input_hash",
    "rerun_plan_id"]) assert.match(sql, new RegExp(`\\b${field}\\b`))
  assert.match(sql, /maximum_members between 1 and 10/)
  assert.match(sql, /RERUN_COHORT_SEALED_IMMUTABLE/)
  assert.match(sql, /RERUN_MEMBERSHIP_IMMUTABLE/)
  assert.match(sql, /RERUN_COHORT_REPLAY_MISMATCH/)
  assert.match(sql, /p_actor_subject[\s\S]*p_actor_client_id/)
  assert.match(sql, /revoke all on table[\s\S]*public, anon, authenticated, service_role/)
  assert.match(sql, /grant select on table[\s\S]*to service_role/)
  assert.doesNotMatch(sql, /grant\s+(?:insert|update|delete)[^;]*to service_role/i)
  assert.match(sql,
    /revoke all on function[\s\S]*from public, anon, authenticated[\s\S]*grant execute on function[\s\S]*to service_role/)
})

test("cohort RPC preserves source key and historical plan while deriving distinct execution input", () => {
  assert.match(sql,
    /plan\.source_candidate_key = v_member ->> 'source_candidate_key'/)
  assert.match(sql,
    /plan\.pre_research_rerun_cohort_id is null/)
  assert.match(sql, /plan\.id = \(v_member ->> 'prior_plan_id'\)::uuid/)
  assert.match(sql, /LUNA_PRE_RESEARCH_RERUN_INPUT_V1/)
  assert.match(sql, /extensions\.digest/)
  assert.match(sql, /LUNA_PRE_RESEARCH_RERUN_INPUT_HASH_MISMATCH/)
  assert.match(sql,
    /plan\.input_hash = v_member ->> 'prior_plan_input_hash'/)
  assert.doesNotMatch(sql,
    /plan\.input_hash = v_member ->> 'base_input_hash'/)
  assert.match(sql, /LUNA_PRE_RESEARCH_RERUN_PRIOR_IDENTITY_MISMATCH/)
  assert.doesNotMatch(sql, /update[^;]*prior_plan_id/is)
})

test("global claiming excludes reruns and exact plan claim has no queue fallback", () => {
  assert.match(sql,
    /and \(p_plan_id is null or plan\.id = p_plan_id\)[\s\S]*and \(p_plan_id is not null[\s\S]*or plan\.pre_research_rerun_cohort_id is null\)/)
  assert.match(sql, /limit 1 for update of plan skip locked/)
  assert.doesNotMatch(sql,
    /if\s+p_plan_id\s+is\s+not\s+null[\s\S]*p_plan_id\s*:=\s*null/i)
})

test("both plan mutations are owner-admin routes and absent from MCP", () => {
  assert.doesNotMatch(server, /seller_os_request_luna_pre_research/)
  for (const route of [controlledRoute, normalRoute]) {
    assert.match(route, /validateAdminApiRequest\(request\)/)
    assert.match(route, /assertSellerOsOwnerAdminPreResearchV1\(auth\)/)
    assert.match(route, /getSellerOsAdminPreResearchCsrfBoundaryV1\(\)\.consume/)
    assert.match(route, /getSupabaseAdminClient\(\)/)
    assert.doesNotMatch(route, /seller_os\.command|SellerOsMcpOAuthPrincipalV1/)
  }
  assert.match(controlledRoute,
    /SELLER_OS_ADMIN_PRE_RESEARCH_CONTROLLED_RERUN_V1/)
})

test("certified V2 evidence policy remains the completion authority", () => {
  assert.match(runtime, /LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19/)
  assert.match(runtime, /acceptedComparableCount/)
  assert.match(runtime, /acceptedComparableSoldQuantity/)
  assert.match(runtime, /summarizeProductResearchComparableEvidenceV1/)
  assert.doesNotMatch(sql,
    /insert\s+into\s+[^;]*(?:commercial_trace|publisher)|createOffer|updateOffer|reviseItem|insert\s+into\s+[^;]*purchase/is)
})

const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`
const uuid = (value) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`

test("real migration creates five isolated plans, replays idempotently, and excludes global claims", async () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema extensions; create extension pgcrypto schema extensions;
      create function public.is_seller_os_service_role_request_v1()
        returns boolean language sql stable as $$ select true $$;
      create table public.luna_catalog_snapshots_v1(
        snapshot_id uuid primary key, snapshot_status text not null,
        snapshot_completed_at timestamptz not null);
      create table public.luna_catalog_snapshot_variants_v1(
        snapshot_id uuid not null references public.luna_catalog_snapshots_v1,
        product_id text not null, variant_id text not null, sku text not null,
        source_fingerprint text not null, observed_at timestamptz not null,
        preflight_status text not null,
        primary key(snapshot_id,product_id,variant_id));
      create table public.seller_os_pre_research_rollout_controls_v1(
        control_key text primary key, rollout_state text not null,
        required_result_contract_version text not null);
      create table public.marketplace_product_research_query_plans(
        id uuid primary key, marketplace_account_key text not null,
        marketplace text not null, run_id uuid, plan_version text not null,
        input_hash text not null, status text not null, query_count int not null,
        candidate_count int not null, source_context text not null,
        subject_supplier_variant_id text, source_candidate_key text,
        source_luna_product_id text, source_supplier_sku text,
        source_luna_snapshot_id uuid, source_product_truth_fingerprint text,
        pre_research_policy_version text, pre_research_result text not null,
        pre_research_trace_eligible boolean not null,
        pre_research_evidence jsonb not null,
        research_intelligence_status text,
        intelligence_contract_version text,
        raw_competitor_content_stored boolean not null,
        pii_stored boolean not null, openai_calls int not null,
        ebay_writes int not null, request_receipt_id uuid,
        worker_lease_owner text, worker_lease_expires_at timestamptz,
        worker_claim_count int not null default 0,
        worker_next_retry_at timestamptz, worker_last_claimed_at timestamptz,
        worker_capability_receipt_id uuid, worker_last_release_code text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint marketplace_product_research_query_plans_input_unique
          unique(marketplace_account_key,marketplace,input_hash));
      create unique index marketplace_product_research_luna_identity_uq
        on public.marketplace_product_research_query_plans(
          marketplace_account_key,marketplace,source_candidate_key)
        where source_context='LUNA_PRE_RESEARCH';
      create table public.marketplace_product_research_query_tasks(
        id uuid primary key default gen_random_uuid(), plan_id uuid not null,
        marketplace_account_key text not null, marketplace text not null,
        ordinal int not null, search_query text not null,
        query_hash text not null, cluster_key_hash text not null,
        category_id text, candidate_count int not null,
        candidate_variant_hashes text[] not null, query_intent text,
        evidence_basis jsonb, strategy_version text, status text not null
          default 'PENDING');
      create table public.seller_os_browser_worker_capabilities_v1(
        marketplace_account_key text, capability_id text,
        worker_instance_id text, heartbeat_receipt_id uuid,
        heartbeat_source text, physical_connection text,
        extension_identity_match boolean, observed_at timestamptz,
        fresh_until timestamptz);
      create table public.seller_os_operational_learning_ledger_v1(
        id uuid primary key, marketplace_account_key text,
        invariant_code text, status text, lease_owner text,
        lease_expires_at timestamptz, mechanism_version text,
        recovery_class text, retry_safety text, recovery_attempt_count int,
        recovery_outcome text, last_observed_at timestamptz, evidence jsonb,
        updated_at timestamptz);
      insert into public.seller_os_pre_research_rollout_controls_v1 values(
        'LUNA_PRE_RESEARCH_EVIDENCE_QUALITY_V2','ACTIVE_V2',
        'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19');
    `)
    const snapshot = uuid(1)
    const observedAt = "2026-09-19T12:00:00.000Z"
    await db.query(`insert into public.luna_catalog_snapshots_v1 values(
      $1,'COMPLETE',now())`, [snapshot])
    const members = []
    for (let index = 1; index <= 5; index += 1) {
      const product = String(8000 + index)
      const variant = String(18000 + index)
      const sku = `ITEM-${index}`
      const source = sha(`source-${index}`)
      const truth = sha(`truth-${index}`)
      const priorHash = sha(`historical-base-${index}`)
      const base = sha(`current-base-${index}`)
      const candidate = sha(`candidate-${index}`)
      const prior = uuid(10 + index)
      const rerunPlan = uuid(20 + index)
      await db.query(`insert into public.luna_catalog_snapshot_variants_v1
        values($1,$2,$3,$4,$5,$6,'PREFLIGHT_PASS')`,
      [snapshot, product, variant, sku, source, observedAt])
      await db.query(`insert into public.marketplace_product_research_query_plans(
        id,marketplace_account_key,marketplace,run_id,plan_version,input_hash,
        status,query_count,candidate_count,source_context,
        subject_supplier_variant_id,source_candidate_key,
        source_luna_product_id,source_supplier_sku,source_luna_snapshot_id,
        source_product_truth_fingerprint,pre_research_policy_version,
        pre_research_result,pre_research_trace_eligible,pre_research_evidence,
        research_intelligence_status,intelligence_contract_version,
        raw_competitor_content_stored,pii_stored,openai_calls,ebay_writes)
        values($1,'account-golden','EBAY_US',null,'normal',$2,'COMPLETED',1,1,
        'LUNA_PRE_RESEARCH',$3,$4,$5,$6,$7,$8,
        'LUNA_PRE_RESEARCH_POLICY_V1_2026_09_15','INSUFFICIENT_MARKET_EVIDENCE',
        false,'{}','COMPLETED','LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19',
        false,false,0,0)`,
      [prior, priorHash, variant, candidate, product, sku, snapshot, truth])
      const execution = sha(["LUNA_PRE_RESEARCH_RERUN_INPUT_V1", base,
        uuid(2), "LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19"].join("\n"))
      members.push({ product_id: product, variant_id: variant, luna_sku: sku,
        source_candidate_key: candidate, product_truth_fingerprint: truth,
        prior_plan_id: prior, prior_plan_input_hash: priorHash,
        rerun_plan_id: rerunPlan, base_input_hash: base,
        execution_input_hash: execution, source_fingerprint: source,
        observed_at: observedAt, queries: [{ ordinal: 1,
          search_query: `product ${index}`, query_hash: sha(`query-${index}`),
          cluster_key_hash: sha(`cluster-${index}`), category_id: null,
          candidate_count: 1, candidate_variant_hashes: [sha(variant)],
          query_intent: "EXACT", evidence_basis: [],
          strategy_version: "TEST" }] })
    }
    const lines = members.map((member) => [member.product_id,
      member.variant_id, member.luna_sku, member.source_candidate_key,
      member.product_truth_fingerprint, member.prior_plan_id,
      member.prior_plan_input_hash, member.base_input_hash,
      member.execution_input_hash].join("\u001f")).sort()
    const membership = sha(["LUNA_PRE_RESEARCH_RERUN_MEMBERSHIP_V1",
      ...lines].join("\n"))
    await db.exec(sql)
    const digestMembers = (value) => sha([
      "LUNA_PRE_RESEARCH_RERUN_MEMBERSHIP_V1",
      ...value.map((member) => [member.product_id, member.variant_id,
        member.luna_sku, member.source_candidate_key,
        member.product_truth_fingerprint, member.prior_plan_id,
        member.prior_plan_input_hash, member.base_input_hash,
        member.execution_input_hash].join("\u001f")).sort(),
    ].join("\n"))
    const call = ({ cohortId = uuid(2), reason = "GOLDEN_PILOT",
      value = members, memberDigest = membership } = {}) => db.query(`select
      public.create_or_reuse_luna_pre_research_rerun_cohort_v1(
        $1,'account-golden','EBAY_US',
        'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19',$5,
        '${uuid(88)}','SELLER_OS_ADMIN_PRE_RESEARCH_CONTROLLED_RERUN_V1',$2,
        'LUNA_PRE_RESEARCH_CONTROLLED_RERUN_POLICY_V1_2026_09_19',
        5,$3,$4::jsonb) result`, [cohortId, snapshot, memberDigest,
      JSON.stringify(value), reason])
    const created = (await call()).rows[0].result
    const replay = (await call()).rows[0].result
    assert.equal(created.newPlanCount, 5)
    assert.equal(replay.newPlanCount, 0)
    assert.equal(replay.existingPlanCount, 5)
    assert.equal((await db.query(`select count(*)::int total from
      public.marketplace_product_research_query_plans where
      pre_research_rerun_cohort_id=$1`, [uuid(2)])).rows[0].total, 5)
    const persistedMembers = (await db.query(`select product_id,
      prior_plan_input_hash,base_input_hash,execution_input_hash
      from public.seller_os_luna_pre_research_rerun_members_v1
      where cohort_id=$1 order by product_id`, [uuid(2)])).rows
    assert.equal(persistedMembers.length, 5)
    for (let index = 0; index < members.length; index += 1) {
      assert.equal(persistedMembers[index].prior_plan_input_hash,
        members[index].prior_plan_input_hash)
      assert.equal(persistedMembers[index].base_input_hash,
        members[index].base_input_hash)
      assert.equal(persistedMembers[index].execution_input_hash,
        members[index].execution_input_hash)
      assert.notEqual(persistedMembers[index].prior_plan_input_hash,
        persistedMembers[index].base_input_hash)
    }
    const historicalBefore = (await db.query(`select id,input_hash,
      source_candidate_key from public.marketplace_product_research_query_plans
      where pre_research_rerun_cohort_id is null order by id`)).rows
    assert.deepEqual(historicalBefore.map((plan) => plan.input_hash),
      members.map((member) => member.prior_plan_input_hash))

    const changedSameCohort = structuredClone(members)
    changedSameCohort[0].base_input_hash = sha("changed-current-base-same-cohort")
    changedSameCohort[0].execution_input_hash = sha([
      "LUNA_PRE_RESEARCH_RERUN_INPUT_V1",
      changedSameCohort[0].base_input_hash, uuid(2),
      "LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19",
    ].join("\n"))
    await assert.rejects(call({ value: changedSameCohort,
      memberDigest: digestMembers(changedSameCohort) }),
    /RERUN_COHORT_REPLAY_MISMATCH/)

    const newCohortId = uuid(3)
    const changedNewCohort = members.map((member, index) => {
      const base = sha(`new-current-base-${index + 1}`)
      return { ...structuredClone(member), rerun_plan_id: uuid(60 + index),
        base_input_hash: base,
        execution_input_hash: sha(["LUNA_PRE_RESEARCH_RERUN_INPUT_V1", base,
          newCohortId, "LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19"].join("\n")) }
    })
    const newCohort = (await call({ cohortId: newCohortId,
      reason: "QUERY_PLAN_REVALIDATION", value: changedNewCohort,
      memberDigest: digestMembers(changedNewCohort) })).rows[0].result
    assert.equal(newCohort.newPlanCount, 5)
    assert.equal(newCohort.existingPlanCount, 0)
    assert.equal((await db.query(`select count(*)::int total from
      public.marketplace_product_research_query_plans where
      pre_research_rerun_cohort_id=$1`, [newCohortId])).rows[0].total, 5)

    const invalidIdentityMembers = members.map((member, index) => ({
      ...structuredClone(member), rerun_plan_id: uuid(70 + index),
      execution_input_hash: sha(["LUNA_PRE_RESEARCH_RERUN_INPUT_V1",
        member.base_input_hash, uuid(4),
        "LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19"].join("\n")),
    }))
    invalidIdentityMembers[0].source_candidate_key = sha("wrong-candidate")
    await assert.rejects(call({ cohortId: uuid(4),
      reason: "IDENTITY_NEGATIVE_TEST", value: invalidIdentityMembers,
      memberDigest: digestMembers(invalidIdentityMembers) }),
    /LUNA_PRE_RESEARCH_RERUN_PRIOR_IDENTITY_MISMATCH/)

    const wrongPriorMembers = members.map((member, index) => ({
      ...structuredClone(member), rerun_plan_id: uuid(80 + index),
      execution_input_hash: sha(["LUNA_PRE_RESEARCH_RERUN_INPUT_V1",
        member.base_input_hash, uuid(5),
        "LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19"].join("\n")),
    }))
    wrongPriorMembers[0].prior_plan_id = uuid(999)
    await assert.rejects(call({ cohortId: uuid(5),
      reason: "PRIOR_PLAN_NEGATIVE_TEST", value: wrongPriorMembers,
      memberDigest: digestMembers(wrongPriorMembers) }),
    /LUNA_PRE_RESEARCH_RERUN_PRIOR_IDENTITY_MISMATCH/)
    const normalReplay = (await db.query(`select
      public.create_or_reuse_luna_pre_research_plan_v1(
        $1,'account-golden','LUNA_PRE_RESEARCH_INTAKE_V1_2026_09_15',
        $2,$3,$4,$5,$6,$7,$8,
        'LUNA_PRE_RESEARCH_POLICY_V1_2026_09_15',$9,$10,$11::jsonb) result`,
    [uuid(70), members[0].base_input_hash, members[0].source_candidate_key,
      snapshot, members[0].product_id, members[0].variant_id,
      members[0].luna_sku, members[0].product_truth_fingerprint,
      members[0].source_fingerprint, observedAt,
      JSON.stringify(members[0].queries)])).rows[0].result
    assert.equal(normalReplay.created, false)
    assert.equal(normalReplay.planId, members[0].prior_plan_id)
    assert.equal((await db.query(`select count(*)::int total from
      public.marketplace_product_research_query_plans where
      pre_research_rerun_cohort_id is null`)).rows[0].total, 5)
    const historicalAfter = (await db.query(`select id,input_hash,
      source_candidate_key from public.marketplace_product_research_query_plans
      where pre_research_rerun_cohort_id is null order by id`)).rows
    assert.deepEqual(historicalAfter, historicalBefore)
    const inputHashCardinality = (await db.query(`select count(*)::int total,
      count(distinct input_hash)::int distinct_total
      from public.marketplace_product_research_query_plans`)).rows[0]
    assert.equal(inputHashCardinality.total, inputHashCardinality.distinct_total)
    await assert.rejects(db.query(`update
      public.seller_os_luna_pre_research_rerun_cohorts_v1
      set reason_code='CHANGED_REASON' where cohort_id=$1`, [uuid(2)]),
    /IMMUTABLE/)
    await assert.rejects(db.query(`delete from
      public.seller_os_luna_pre_research_rerun_members_v1
      where cohort_id=$1`, [uuid(2)]), /IMMUTABLE/)
    const capabilityObservedAt = new Date().toISOString()
    const capabilityFreshUntil = new Date(Date.now() + 10 * 60_000).toISOString()
    const capability = (receipt) => ({ handshakeStatus: "PASS",
      workerCapability: "PASS", extensionIdentityMatch: true,
      cookieAccess: false, marketplaceWrites: 0,
      heartbeatSource: "INDEPENDENT_WORKER_LIVENESS",
      extensionVersion: "1.2.38", observedAt: capabilityObservedAt,
      heartbeatReceiptId: receipt })
    const workers = [uuid(31), uuid(32), uuid(33)].map((id) =>
      `product-research-browser:${id}`)
    const receipts = [uuid(41), uuid(42), uuid(43)]
    for (let index = 0; index < workers.length; index += 1) {
      for (const capabilityId of ["PRODUCT_RESEARCH_EXTENSION",
        "PRODUCT_RESEARCH_BROWSER_WORKER"]) {
        await db.query(`insert into
          public.seller_os_browser_worker_capabilities_v1 values(
          'account-golden',$1,$2,$3,'INDEPENDENT_WORKER_LIVENESS',
          'PROVEN_AVAILABLE',true,$4,$5)`, [capabilityId, workers[index],
          receipts[index], capabilityObservedAt, capabilityFreshUntil])
      }
    }
    const globalClaim = (await db.query(`select * from
      public.claim_next_live_listing_product_research_v2(
        'account-golden',$1,$2::jsonb,null,300)`, [workers[0],
      JSON.stringify(capability(receipts[0]))])).rows[0]
    assert.equal(globalClaim.claimed, false)
    assert.equal(globalClaim.plan_id, null)
    const explicitPlanId = created.plans[0].planId
    const explicitClaim = (await db.query(`select * from
      public.claim_next_live_listing_product_research_v2(
        'account-golden',$1,$2::jsonb,$3,300)`, [workers[1],
      JSON.stringify(capability(receipts[1])), explicitPlanId])).rows[0]
    assert.equal(explicitClaim.claimed, true)
    assert.equal(explicitClaim.plan_id, explicitPlanId)
    const nonexistentClaim = (await db.query(`select * from
      public.claim_next_live_listing_product_research_v2(
        'account-golden',$1,$2::jsonb,$3,300)`, [workers[2],
      JSON.stringify(capability(receipts[2])), uuid(99)])).rows[0]
    assert.equal(nonexistentClaim.claimed, false)
    assert.equal(nonexistentClaim.plan_id, null)
    await assert.rejects(db.query(`select
      public.create_or_reuse_luna_pre_research_rerun_cohort_v1(
        $1,'account-golden','EBAY_US',
        'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19','CHANGED_REASON',
        '${uuid(88)}','SELLER_OS_ADMIN_PRE_RESEARCH_CONTROLLED_RERUN_V1',$2,
        'LUNA_PRE_RESEARCH_CONTROLLED_RERUN_POLICY_V1_2026_09_19',
        5,$3,$4::jsonb)`, [uuid(2), snapshot, membership,
      JSON.stringify(members)]), /RERUN_COHORT_REPLAY_MISMATCH/)
  } finally {
    await db.close()
  }
})
