import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

import { summarizeProductResearchComparableEvidenceV1 } from
  "./ebay-product-research-query-intelligence-v1.ts"

const preparePath =
  "supabase/migrations/20260919110000_pre_research_evidence_quality_v2_prepare.sql"
const activatePath =
  "supabase/migrations/20260919120000_pre_research_evidence_quality_v2_activate.sql"
const prepare = readFileSync(preparePath, "utf8")
const activate = readFileSync(activatePath, "utf8")
const runtime = readFileSync(
  "lib/ebay/ebay-mayel-live-market-revalidation-v1.ts", "utf8")
const extensionManifest = readFileSync(
  "tools/browser-extensions/ebay-product-research-capture/manifest.json", "utf8")
const uuid = (value) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`

test("PREPARE dynamically preserves and backfills every completed V1 plan", () => {
  assert.match(prepare, /source_context = 'LUNA_PRE_RESEARCH'/)
  assert.match(prepare, /status = 'COMPLETED'/)
  assert.match(prepare,
    /coalesce\(plan\.pre_research_evidence ->> 'contractVersion',''\) <>/)
  assert.doesNotMatch(prepare,
    /071f7249-bd44-47f5-8e17-3900cf474c68|ITEM-8028|ITEM-8042|ITEM-8043|ITEM-8031|ITEM-8046/)
  assert.match(prepare, /prior_evidence jsonb not null/)
  assert.match(prepare, /prior_evidence_digest text null/)
  assert.match(prepare, /backfillLineage/)
  assert.match(prepare, /PRE_RESEARCH_V1_BACKFILL_HISTORY_IMMUTABLE/)
  assert.doesNotMatch(prepare,
    /delete\s+from\s+public\.marketplace_product_research_(?:query_tasks|capture_observations)/i)
})

test("PREPARE provides bounded durable quiescence without pausing other contexts", () => {
  assert.match(prepare, /QUIESCED_FOR_V2_DEPLOYMENT/)
  assert.match(prepare, /zz_guard_luna_pre_research_rollout_v2/)
  assert.match(prepare,
    /case when tg_op = 'INSERT' then new\.source_context[\s\S]*coalesce\(new\.source_context,old\.source_context\)[\s\S]*'LUNA_PRE_RESEARCH'[\s\S]*return new/)
  assert.match(prepare, /LUNA_PRE_RESEARCH_QUIESCED_FOR_V2_DEPLOYMENT/)
  assert.match(prepare, /in share row exclusive mode/)
  assert.doesNotMatch(prepare, /PRODUCT_RESEARCH_EXTENSION|browserWorkerControl/)
})

test("one durable derivation authority deduplicates and rejects contamination", () => {
  assert.match(prepare, /derive_luna_pre_research_evidence_v2/)
  assert.match(prepare, /partition by item_id/)
  assert.match(prepare, /max\(sold_quantity\) over/)
  assert.match(prepare,
    /\(BRAND\|IP\)_CONTAMINATION/)
  assert.match(prepare, /PREMIUM_MATERIAL_\(CONTAMINATION\|MISMATCH\)/)
  assert.match(prepare, /PACK\.\*\(DIFFERS\|MISMATCH\)/)
  assert.match(prepare, /PRODUCT_ENTITY_FAMILY_AND_STRUCTURE_MATCH/)
  assert.match(prepare, /ADJACENT_BUT_NOT_COMPARABLE/)
  assert.match(prepare, /FALSE_POSITIVE/)
  for (const field of ["exactComparableCount", "closeVariantComparableCount",
    "familyComparableCount", "acceptedComparableCount",
    "rawObservedSoldQuantity", "acceptedComparableSoldQuantity"]) {
    assert.match(prepare, new RegExp(`'${field}'`))
    assert.match(activate, new RegExp(`'${field}'`))
    assert.match(runtime, new RegExp(field))
  }
})

test("ACTIVATE derives provenance and rejects V1 or disagreeing envelopes", () => {
  assert.match(activate,
    /p_evidence ->> 'contractVersion' is distinct from[\s\S]*LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19/)
  assert.match(activate,
    /v_derived := public\.derive_luna_pre_research_evidence_v2\(v_plan\.id\)/)
  assert.match(activate, /LUNA_PRE_RESEARCH_DURABLE_PROVENANCE_MISMATCH/)
  assert.match(activate,
    /v_accepted_count <> v_exact_count \+ v_close_count \+ v_family_count/)
  assert.match(activate, /v_accepted_sold > v_raw_sold/)
  assert.match(activate,
    /v_accepted_count = 0[\s\S]*INSUFFICIENT_MARKET_EVIDENCE/)
  assert.match(activate,
    /LUNA_PRE_RESEARCH_COMPLETION_IDEMPOTENCY_MISMATCH/)
  const rpcPosition = activate.indexOf("create or replace function public.complete_luna")
  const reopenPosition = activate.indexOf("set rollout_state = 'ACTIVE_V2'")
  assert.ok(rpcPosition >= 0 && reopenPosition > rpcPosition)
})

test("runtime V2 remains compatible with PREPARE and retains quality fixes", () => {
  assert.match(runtime, /LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19/)
  assert.match(runtime, /summarizeProductResearchComparableEvidenceV1\(planEvidenceRows\)/)
  assert.match(runtime,
    /Array\.isArray\(task\.commercial_evidence_entities\)/)
  assert.match(runtime, /taskIds: planTasks\.map/)
  assert.equal(JSON.parse(extensionManifest).version, "1.2.38")
})

test("five-case V1 fixture migrates fail-closed while preserving 144 rows", () => {
  const caseSizes = [17, 45, 3, 40, 39]
  let nextItem = 100000000000
  const fixtures = caseSizes.map((size, caseIndex) => Array.from(
    { length: size }, (_, rowIndex) => ({
      itemId: String(nextItem++),
      soldQuantity: rowIndex % 4 === 0 ? 2 : 1,
      classification: rowIndex % 5 === 0
        ? "FALSE_POSITIVE" : "ADJACENT_BUT_NOT_COMPARABLE",
      classificationReasons: [caseIndex === 3
        ? "IP_CONTAMINATION" : "GENERIC_ATTRIBUTE_OVERLAP_ONLY"],
    })))
  const summaries = fixtures.map((rows) =>
    summarizeProductResearchComparableEvidenceV1(rows))
  assert.equal(fixtures.flat().length, 144)
  assert.equal(summaries.length, 5)
  for (const summary of summaries) {
    assert.equal(summary.acceptedComparableCount, 0)
    assert.equal(summary.acceptedComparableSoldQuantity, 0)
    assert.equal(summary.result, "INSUFFICIENT_MARKET_EVIDENCE")
    assert.equal(summary.traceEligible, false)
    assert.ok(summary.rawObservedSoldQuantity > 0)
  }
})

test("PREPARE and completion remain idempotent and least-privileged", () => {
  assert.match(prepare, /on conflict \(plan_id\) do nothing/)
  assert.match(prepare, /LUNA_PRE_RESEARCH_V1_BACKFILL_IDEMPOTENCY_MISMATCH/)
  assert.match(prepare, /force row level security/)
  assert.match(prepare, /grant select[\s\S]*to service_role/)
  assert.doesNotMatch(prepare, /grant (?:insert|update|delete)/i)
  assert.match(activate, /'reused',true/)
  assert.match(activate, /grant execute[\s\S]*to service_role/)
  assert.match(activate, /set search_path = ''/)
})

test("real staged SQL migrates five V1 envelopes, quiesces, then validates V2 provenance", async () => {
  const db = new PGlite({ extensions: { pgcrypto } })
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema extensions; create extension pgcrypto schema extensions;
      create function public.is_seller_os_service_role_request_v1()
        returns boolean language sql stable as $$ select true $$;
      create table public.marketplace_product_research_query_plans(
        id uuid primary key, marketplace_account_key text not null,
        marketplace text not null, source_context text not null,
        status text not null, worker_lease_owner text,
        worker_lease_expires_at timestamptz, pre_research_result text not null,
        pre_research_trace_eligible boolean not null,
        pre_research_evidence_digest text, pre_research_evidence jsonb not null,
        pre_research_completed_at timestamptz, completed_at timestamptz,
        worker_last_result jsonb, updated_at timestamptz not null);
      create table public.marketplace_product_research_query_tasks(
        id uuid primary key, plan_id uuid not null references
          public.marketplace_product_research_query_plans(id),
        ordinal integer not null, status text not null,
        capture_batch_id uuid, commercial_evidence_entities jsonb not null);
    `)
    let item = 100000000000n
    const caseSizes = [17, 45, 3, 40, 39]
    for (let index = 0; index < caseSizes.length; index += 1) {
      const planId = uuid(index + 1)
      const rows = Array.from({ length: caseSizes[index] }, (_, rowIndex) => ({
        itemId: String(item++), soldQuantity: rowIndex % 4 === 0 ? 2 : 1,
        classification: rowIndex % 5 === 0
          ? "FALSE_POSITIVE" : "ADJACENT_BUT_NOT_COMPARABLE",
        classificationReasons: ["GENERIC_ATTRIBUTE_OVERLAP_ONLY"],
      }))
      await db.query(`insert into public.marketplace_product_research_query_plans
        values($1,'account-key','EBAY_US','LUNA_PRE_RESEARCH','COMPLETED',
        null,null,'PRE_RESEARCH_MEDIUM',true,$2,$3,now(),now(),$4,now())`,
      [planId, `sha256:${"a".repeat(64)}`, JSON.stringify({
        contractVersion: "LUNA_PRE_RESEARCH_RESULT_V1_2026_09_15",
        result: "PRE_RESEARCH_MEDIUM", traceEligible: true,
      }), JSON.stringify({ state: "PRE_RESEARCH_MEDIUM" })])
      await db.query(`insert into public.marketplace_product_research_query_tasks
        values($1,$2,1,'PROCESSED',$3,$4)`, [uuid(100 + index), planId,
        uuid(200 + index), JSON.stringify(rows)])
    }

    await db.exec(prepare)
    const migrated = (await db.query(`select count(*)::int total,
      count(*) filter(where pre_research_result=
        'INSUFFICIENT_MARKET_EVIDENCE')::int insufficient,
      count(*) filter(where pre_research_trace_eligible=false)::int closed
      from public.marketplace_product_research_query_plans`)).rows[0]
    assert.deepEqual(migrated, { total: 5, insufficient: 5, closed: 5 })
    const preserved = (await db.query(`select
      sum(jsonb_array_length(commercial_evidence_entities))::int observations
      from public.marketplace_product_research_query_tasks`)).rows[0]
    assert.equal(preserved.observations, 144)
    assert.equal((await db.query(`select count(*)::int total from
      public.seller_os_pre_research_v1_backfills_v2`)).rows[0].total, 5)
    await assert.rejects(db.query(`insert into
      public.marketplace_product_research_query_plans
      values($1,'account-key','EBAY_US','LUNA_PRE_RESEARCH','ACTIVE',null,null,
      'PENDING',false,null,'{}',null,null,null,now())`, [uuid(50)]),
    /LUNA_PRE_RESEARCH_QUIESCED_FOR_V2_DEPLOYMENT/)
    await db.query(`insert into public.marketplace_product_research_query_plans
      values($1,'account-key','EBAY_US','QUICK_PICK_RESEARCH_REQUIRED','ACTIVE',
      null,null,'PENDING',false,null,'{}',null,null,null,now())`, [uuid(51)])
    await db.exec(prepare)
    assert.equal((await db.query(`select count(*)::int total from
      public.seller_os_pre_research_v1_backfills_v2`)).rows[0].total, 5)

    await db.exec(activate)
    const worker =
      "product-research-browser:11111111-1111-4111-8111-111111111111"
    const createPlan = async (planNumber, taskNumber, batchNumber, rows) => {
      const planId = uuid(planNumber)
      const batchId = uuid(batchNumber)
      await db.query(`insert into public.marketplace_product_research_query_plans
        values($1,'account-key','EBAY_US','LUNA_PRE_RESEARCH','ACTIVE',$2,
        now()+interval '10 minutes','PENDING',false,null,'{}',null,null,null,now())`,
      [planId, worker])
      await db.query(`insert into public.marketplace_product_research_query_tasks
        values($1,$2,1,'PROCESSED',$3,$4)`, [uuid(taskNumber), planId,
        batchId, JSON.stringify(rows)])
      return { planId, batchId }
    }
    const accepted = await createPlan(60, 61, 62, [{
      itemId: "366666581320", soldQuantity: 3,
      classification: "EXACT_PRODUCT_COMPARABLE",
      classificationReasons: [
        "PRODUCT_ENTITY_AND_EXACT_DISCRIMINATORS_MATCH"],
    }])
    const validEvidence = {
      contractVersion: "LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19",
      comparablePolicyVersion:
        "PRODUCT_RESEARCH_ACCEPTED_COMPARABLE_POLICY_V1_2026_09_19",
      result: "PRE_RESEARCH_HIGH", traceEligible: true,
      exactComparableCount: 1, closeVariantComparableCount: 0,
      familyComparableCount: 0, acceptedComparableCount: 1,
      rawObservedSoldQuantity: 3, acceptedComparableSoldQuantity: 3,
    }
    const complete = () => db.query(`select
      public.complete_luna_pre_research_product_research_v1(
        'account-key',$1,$2,$3,'PRE_RESEARCH_HIGH',true,$4,$5,now()) result`,
    [accepted.planId, worker, accepted.batchId, `sha256:${"b".repeat(64)}`,
      JSON.stringify(validEvidence)])
    assert.equal((await complete()).rows[0].result.provenanceValidation, "PASS")
    assert.equal((await complete()).rows[0].result.reused, true)

    const contaminated = await createPlan(70, 71, 72, [{
      itemId: "366672502737", soldQuantity: 20,
      classification: "EXACT_PRODUCT_COMPARABLE",
      classificationReasons: ["IP_CONTAMINATION"],
    }])
    await assert.rejects(db.query(`select
      public.complete_luna_pre_research_product_research_v1(
        'account-key',$1,$2,$3,'PRE_RESEARCH_HIGH',true,$4,$5,now())`,
    [contaminated.planId, worker, contaminated.batchId,
      `sha256:${"c".repeat(64)}`, JSON.stringify(validEvidence)]),
    /LUNA_PRE_RESEARCH_DURABLE_PROVENANCE_MISMATCH/)

    const v1 = await createPlan(80, 81, 82, [])
    await assert.rejects(db.query(`select
      public.complete_luna_pre_research_product_research_v1(
        'account-key',$1,$2,$3,'INSUFFICIENT_MARKET_EVIDENCE',false,$4,$5,now())`,
    [v1.planId, worker, v1.batchId, `sha256:${"d".repeat(64)}`,
      JSON.stringify({ ...validEvidence,
        contractVersion: "LUNA_PRE_RESEARCH_RESULT_V1_2026_09_15",
        result: "INSUFFICIENT_MARKET_EVIDENCE", traceEligible: false })]),
    /LUNA_PRE_RESEARCH_EVIDENCE_CONTRACT_INVALID/)
  } finally {
    await db.close()
  }
})
