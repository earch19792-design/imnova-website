import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

const i02wPath = new URL(
  "../../supabase/migrations/20260823023000_create_seller_os_daily_dollar_radar_autopilot.sql",
  import.meta.url)
const frontierPath = new URL(
  "../../supabase/migrations/20260823034507_create_seller_os_profitability_frontier_and_schedule_policy.sql",
  import.meta.url)
const bootstrapPath = new URL(
  "../../docs/ebay-pro-isolation/OP_LAUNCH_I02V_FRONTIER_BOOTSTRAP_PLAN_V1.json",
  import.meta.url)
const cronPlanPath = new URL(
  "../../docs/ebay-pro-isolation/OP_LAUNCH_I02W_CRON_POST_APPLY_PLAN_V1.json",
  import.meta.url)

const i02w = readFileSync(i02wPath)
const migration = readFileSync(frontierPath, "utf8")
const bootstrap = JSON.parse(readFileSync(bootstrapPath, "utf8"))
const cronPlan = JSON.parse(readFileSync(cronPlanPath, "utf8"))

function body(name) {
  return migration.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`,
  ))?.[0] ?? ""
}

test("preserves the existing I02W artifact byte-for-byte", () => {
  assert.equal(createHash("sha256").update(i02w).digest("hex"),
    "5956e9209c98da3b3b2255500f6f5f31c34eeb95a1579147a08777d89845b6ff")
})

test("backfills the frozen scheduler singleton before enforcing final constraints", () => {
  const update = migration.indexOf(
    "update public.seller_os_daily_dollar_radar_scheduler_policy")
  const notNull = migration.indexOf(
    "alter column business_timezone set not null")
  const finalChecks = migration.indexOf(
    "add constraint seller_os_daily_dollar_scheduler_disabled_check")
  assert.ok(update > -1)
  assert.ok(update < notNull)
  assert.ok(update < finalChecks)
  assert.equal(migration.match(
    /update public\.seller_os_daily_dollar_radar_scheduler_policy/g)?.length, 1)
  for (const authoritativeConstraint of [
    "seller_os_daily_dollar_radar_scheduler__scheduler_enabled_check",
    "seller_os_daily_dollar_radar_scheduler_poli_policy_status_check",
    "seller_os_daily_dollar_radar_scheduler__business_timezone_check",
    "seller_os_daily_dollar_radar_scheduler__utc_cron_schedule_check",
    "seller_os_daily_dollar_radar_scheduler_p_policy_reference_check",
  ]) assert.match(migration, new RegExp(`drop constraint ${authoritativeConstraint}`))
})

test("creates one append-only provisional frontier store with bounded RPCs", () => {
  assert.match(migration,
    /create table public\.seller_os_profitability_frontier_snapshots \(/)
  assert.match(migration, /provisional_fast_lane_economics boolean not null default true/)
  assert.match(migration, /phase_6_canonical_authority boolean not null default false/)
  assert.match(migration, /seller_os_profitability_frontier_snapshot_unique unique/)
  assert.match(migration, /before update or delete on public\.seller_os_profitability_frontier_snapshots/)
  assert.match(migration, /put_seller_os_profitability_frontier_v1/)
  assert.match(migration, /get_seller_os_latest_profitability_frontiers_v1/)
  assert.match(body("put_seller_os_profitability_frontier_v1"),
    /IDEMPOTENT_SUCCESS/)
  assert.match(body("put_seller_os_profitability_frontier_v1"),
    /SELLER_OS_PROFITABILITY_FRONTIER_REPLAY_CONFLICT/)
  assert.match(body("put_seller_os_profitability_frontier_v1"),
    /pg_advisory_xact_lock/)
})

test("supports every required frontier field without becoming Phase 6 authority", () => {
  for (const field of [
    "family_id", "opportunity_case_id", "luna_product_id", "luna_variant_id",
    "luna_sku", "product_fit", "market_price_evidence_reference",
    "market_price_evidence_digest", "market_price_low", "market_price_median",
    "market_price_high", "luna_cost", "supplier_quantity_required",
    "total_product_cost", "shipping_status", "shipping_value",
    "ebay_fee_policy_reference", "economic_policy_reference",
    "economic_policy_digest", "contribution_profit_median",
    "contribution_margin_median", "break_even_price",
    "max_shipping_break_even", "max_shipping_target_margin",
    "max_product_cost_target_margin", "min_price_target_margin",
    "economic_classification", "hard_blockers", "next_best_evidence",
    "next_evidence_value", "source_updated_at", "evidence_cutoff_at",
    "calculated_at",
  ]) assert.match(migration, new RegExp(`\\b${field}\\b`), field)
  assert.match(migration, /provisional_fast_lane_economics/)
  assert.match(migration, /not phase_6_canonical_authority/)
})

test("forces RLS and exposes writes only through the service-role RPC", () => {
  assert.match(migration,
    /alter table public\.seller_os_profitability_frontier_snapshots\s+enable row level security;/)
  assert.match(migration,
    /alter table public\.seller_os_profitability_frontier_snapshots\s+force row level security;/)
  assert.match(migration,
    /revoke all on table public\.seller_os_profitability_frontier_snapshots\s+from public, anon, authenticated, service_role;/)
  assert.match(migration,
    /revoke all on function public\.put_seller_os_profitability_frontier_v1\([\s\S]*?from public, anon, authenticated;/)
  assert.match(migration,
    /grant execute on function public\.put_seller_os_profitability_frontier_v1\([\s\S]*?to service_role;/)
  assert.match(body("put_seller_os_profitability_frontier_v1"),
    /is_seller_os_service_role_request_v1/)
})

test("freezes New York time policy while retaining zero cron authority", () => {
  assert.match(migration, /America\/New_York/g)
  assert.match(migration, /0 9 \* \* \*/g)
  assert.match(migration, /PREFLIGHT_APPROVED_DISABLED_PENDING_STORAGE_APPLY/)
  assert.match(migration, /not scheduler_enabled/)
  assert.match(migration,
    /logical_window_end - logical_window_start between interval '23 hours'\s+and interval '25 hours'/)
  assert.match(body("claim_seller_os_daily_dollar_radar_run_v1"),
    /at time zone 'America\/New_York'/)
  assert.doesNotMatch(body("claim_seller_os_daily_dollar_radar_run_v1"),
    /interval '24 hours'/)
  assert.deepEqual(cronPlan.vercelCron, {
    path: "/api/cron/daily-dollar-radar-autopilot",
    schedule: "0 9 * * *",
  })
  assert.equal(cronPlan.cronExecutionAuthority, false)
  assert.equal(cronPlan.status, "PREPARED_DISABLED_NOT_REGISTERED")
})

test("bootstrap plan preserves eight certified results and fails closed on missing durable identity", () => {
  assert.equal(bootstrap.configurationCount, 8)
  assert.equal(bootstrap.fullyReproducibleConfigurationCount, 0)
  assert.deepEqual(bootstrap.expectedClassificationCounts, {
    ECONOMICALLY_DEAD: 0,
    ECONOMICALLY_RECOVERABLE: 5,
    ECONOMICALLY_PROMISING: 0,
    ECONOMICS_UNPROVEN: 3,
  })
  assert.deepEqual(bootstrap.preferredResearchOrder, [
    "microcurrent", "rug-grippers-16-pack", "v60-gooseneck-kettle-black",
  ])
  const byKey = Object.fromEntries(bootstrap.configurations.map((row) =>
    [row.configurationKey, row]))
  assert.equal(byKey.microcurrent.maxShippingTargetMarginUsd, 3.77)
  assert.equal(byKey["rug-grippers-16-pack"].maxShippingTargetMarginUsd, 3.05)
  assert.equal(byKey["v60-gooseneck-kettle-black"].maxShippingTargetMarginUsd, 2.49)
  for (const row of bootstrap.configurations) {
    assert.equal(row.bootstrapStatus,
      "FAIL_CLOSED_BOOTSTRAP_FIELD_UNPROVEN")
    assert.equal(row.unprovenFields.includes("LUNA_PRODUCT_ID"), true)
    assert.equal(row.unprovenFields.includes("ECONOMIC_POLICY_DIGEST"), true)
  }
  assert.equal(bootstrap.realWrites, 0)
})

test("migration is transaction-safe and contains no scheduler or operational bootstrap", () => {
  for (const forbidden of [
    /\bcommit\s*;/i, /\brollback\s*;/i, /\bcreate\s+database\b/i,
    /\bdrop\s+database\b/i, /\bvacuum\b/i, /cron\.schedule/i,
    /net\.http/i,
  ]) assert.doesNotMatch(migration, forbidden)
  for (const bootstrapName of ["microcurrent", "rug-grippers-16-pack",
    "v60-gooseneck-kettle-black"]) {
    assert.doesNotMatch(migration, new RegExp(bootstrapName, "i"))
  }
})
