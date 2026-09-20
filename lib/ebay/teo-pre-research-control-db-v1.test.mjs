import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"

const name = "20260919180000_teo_pre_research_control_plane_v1.sql"
const sql = readFileSync(`supabase/migrations/${name}`, "utf8")

test("target migration ID is unique and additive", () => {
  assert.deepEqual(readdirSync("supabase/migrations")
    .filter((entry) => entry.startsWith("20260919180000_")), [name])
  assert.doesNotMatch(sql, /drop\s+table|truncate\s+|delete\s+from|alter\s+type/i)
  const executable = sql.replace(/^--.*$/gm, "")
  assert.doesNotMatch(executable,
    /ebay_active_listings|seller_os_luna_stock|publisher/i)
  assert.equal(createHash("sha256").update(sql).digest("hex").length, 64)
})

test("durable capability is owner/client/contract bound and revocable", () => {
  for (const field of ["capability_code", "owner_user_id", "command_client_id",
    "allowed_contract_version", "maximum_candidates", "enabled", "disabled_at",
    "expires_at"]) assert.match(sql, new RegExp(`\\b${field}\\b`))
  assert.match(sql, /TEO_PRE_RESEARCH_NORMAL_BATCH_V1/)
  assert.match(sql, /maximum_candidates between 1 and 50/)
  assert.match(sql, /disable_seller_os_pre_research_command_v1/)
  assert.match(sql, /and capability\.enabled/)
})

test("batch and immutable membership authority are bounded and idempotent", () => {
  for (const state of ["REQUESTED", "AUTHORIZED", "RUNNING",
    "NEEDS_ATTENTION", "COMPLETED", "CANCELLED"]) assert.match(sql,
      new RegExp(`'${state}'`))
  assert.match(sql, /unique \(owner_authorization_id, source_snapshot_id,[\s\S]*candidate_identity_digest, client_idempotency_key\)/)
  assert.match(sql, /unique \(batch_id, source_candidate_key\)/)
  assert.match(sql, /TEO_PRE_RESEARCH_BATCH_IDEMPOTENCY_MISMATCH/)
  assert.match(sql, /snapshot\.snapshot_status='COMPLETE'/)
  assert.match(sql, /variant\.preflight_status <> 'PREFLIGHT_PASS'/)
  assert.doesNotMatch(sql, /update\s+public\.luna_catalog_snapshot_variants_v1/i)
})

test("database authority is service-role only behind forced RLS", () => {
  assert.equal((sql.match(/force row level security/g) ?? []).length, 4)
  assert.match(sql, /revoke all on table[\s\S]*from public, anon, authenticated, service_role/)
  assert.match(sql, /revoke all on function[\s\S]*from public,anon,authenticated/)
  assert.match(sql, /grant execute on function[\s\S]*to service_role/)
  assert.match(sql, /is_seller_os_service_role_request_v1\(\)/)
})

test("runner selection cannot fall back to global queue", () => {
  const nextStart = sql.indexOf(
    "create or replace function public.next_seller_os_pre_research_batch_plan_v1")
  const next = sql.slice(nextStart, sql.indexOf(
    "create or replace function public.resume_seller_os_pre_research_batch_v1",
    nextStart))
  assert.match(next, /member\.execution_state='PENDING'/)
  assert.match(next, /plan\.source_context='LUNA_PRE_RESEARCH'/)
  assert.match(next, /plan\.pre_research_rerun_cohort_id is null/)
  assert.match(next, /plan\.id=member\.plan_id/)
  assert.doesNotMatch(next, /claim_next_live_listing_product_research_v2/)
})

test("shared claim authority excludes batches globally and rechecks revocation", () => {
  const claim = sql.slice(sql.indexOf(
    "create or replace function public.claim_next_live_listing_product_research_v2"),
  sql.indexOf("revoke all on function public.authorize_seller_os_pre_research_command_v1"))
  assert.match(claim, /not exists \([\s\S]*batch_member\.plan_id = plan\.id/)
  assert.match(claim, /p_plan_id is not null and exists/)
  assert.match(claim, /batch_member\.execution_state = 'PENDING'/)
  assert.match(claim, /batch\.batch_state in \('AUTHORIZED','RUNNING'\)/)
  assert.match(claim, /capability\.enabled/)
  assert.match(claim, /capability\.expires_at > clock_timestamp\(\)/)
})

test("resume accepts only durable retry-safe unfinished members", () => {
  assert.match(sql, /SAFE_IDEMPOTENT_RUNTIME_RESUME/)
  assert.match(sql, /TEO_PRE_RESEARCH_NON_RETRY_SAFE_MEMBER/)
  assert.match(sql, /plan\.worker_claim_count>=5/)
  assert.match(sql, /plan\.worker_lease_owner is not null/)
})
