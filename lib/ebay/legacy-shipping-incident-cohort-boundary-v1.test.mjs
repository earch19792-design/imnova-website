import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test, { after, before } from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

const migration = readFileSync(
  "supabase/migrations/20260908203000_legacy_shipping_incident_cohort_boundary_v1.sql",
  "utf8")
const COHORT =
  "legacy-shipping-incident-v1:sha256:e10438c73be76dd6ac8b55d75c25a726c69d4a8adf0fce4d070835b50e4c92ba"
const RECOVERED = [
  "089c26b0-4bed-410d-847f-8eefdeee6fa0",
  "0ee819a7-ab47-41e9-8601-432a069a858e",
  "20de341a-9384-46f0-b912-1116cc40ee41",
  "2483007c-76bf-409d-927c-6c812caf53a4",
]

let db
before(async () => {
  db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create extension if not exists pgcrypto;
    create schema extensions;
    create function extensions.digest(bytea,text) returns bytea
      language sql as $$ select public.digest($1,$2); $$;
    create function public.is_seller_os_service_role_request_v1()
      returns boolean language sql stable as $$ select true; $$;
    create table public.seller_os_economic_shipping_legacy_recoveries_v1(
      marketplace_account_key text not null,
      job_id uuid not null,
      status text not null,
      primary key(marketplace_account_key,job_id));
  `)
  await db.exec(migration)
})
after(async () => db.close())

async function readCohort() {
  return (await db.query(`select
    public.read_seller_os_legacy_shipping_incident_cohort_v1($1) receipt`,
  [COHORT])).rows[0].receipt
}

test("original durable receipt freezes exactly 18 recoverable plus one out-of-scope", async () => {
  const receipt = await readCohort()
  assert.equal(receipt.status, "PROVEN")
  assert.equal(receipt.cohortMemberCount, 19)
  assert.equal(receipt.recoveredMemberCount, 0)
  assert.equal(receipt.unresolvedMemberCount, 18)
  assert.equal(receipt.outOfScopeMemberCount, 1)
  assert.equal(receipt.newJobArrivalsExcluded, true)
  assert.equal(receipt.recoveryWorkPerCycleMax, 1)
  assert.equal(receipt.members.filter((member) =>
    member.incidentClassification === "RECOVERABLE_VALID_SCOPE").length, 18)
  assert.equal(receipt.members.some((member) =>
    member.jobId === "7863fcfc-4229-487b-9173-aeb52e3d033f" &&
    member.incidentClassification === "OUT_OF_SCOPE_NO_ACTIVE_LISTING"), true)
})

test("four certified recoveries reconcile to 4 recovered and 14 unresolved", async () => {
  for (const jobId of RECOVERED) {
    await db.query(`insert into
      public.seller_os_economic_shipping_legacy_recoveries_v1(
        marketplace_account_key,job_id,status)
      values($1,$2::uuid,'COMPLETED')`, [
      "imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12",
      jobId,
    ])
  }
  await db.query(`insert into
    public.seller_os_economic_shipping_legacy_recoveries_v1(
      marketplace_account_key,job_id,status)
    values($1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','COMPLETED')`, [
    "imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12",
  ])
  const receipt = await readCohort()
  assert.equal(receipt.recoveredMemberCount, 4)
  assert.equal(receipt.unresolvedMemberCount, 14)
  assert.equal(receipt.outOfScopeMemberCount, 1)
  assert.equal(receipt.cohortMemberCount, 19)
})

test("membership is explicit, immutable to app roles and independent of classifier drift", () => {
  assert.match(migration,
    /ctco_01a081dd-094d-7400-bee9-21c9f8545268/)
  assert.match(migration, /member_count = 19/)
  assert.match(migration, /membership_digest<>v_cohort\.membership_digest/)
  assert.doesNotMatch(migration,
    /classify_seller_os_economic_shipping_legacy_job_v1\s*\(/)
  assert.match(migration, /newJobArrivalsExcluded',true/)
  assert.match(migration, /revoke all on table[\s\S]*?from public, anon, authenticated, service_role/)
  assert.doesNotMatch(migration, /create index/i)
  assert.doesNotMatch(migration, /count\s*=\s*['"]exact|select\s+\*/i)
})
