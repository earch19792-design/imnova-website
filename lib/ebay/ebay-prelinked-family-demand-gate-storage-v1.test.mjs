import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260822192955_create_seller_os_prelinked_family_demand_gate.sql",
  import.meta.url,
), "utf8")

function functionBody(name) {
  return migration.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`,
  ))?.[0] ?? ""
}

const observation = functionBody("put_seller_os_family_market_observation_v1")
const evaluation = functionBody(
  "put_seller_os_prelinked_launch_family_evaluation_v1")
const monitor = functionBody("put_seller_os_opportunity_monitor_enrollment_v1")
const reserve = functionBody("reserve_seller_os_prelinked_launch_sku_v1")
const currentGate = functionBody(
  "assert_seller_os_prelinked_current_test_launch_gate_v1")

test("reserved REFERENCES keyword is never used as an unquoted CTE identifier", () => {
  assert.doesNotMatch(migration,
    /\bwith\s+(?:recursive\s+)?references\s+as\b/i)
  assert.doesNotMatch(migration, /\b(?:from|join)\s+references\b/i)
  assert.equal(migration.match(/\bwith\s+evidence_references\s+as\b/g)?.length, 3)
})

test("I02R adds family lineage adapters without duplicating canonical raw market facts", () => {
  for (const table of ["seller_os_market_opportunity_cases",
    "seller_os_market_family_definitions",
    "seller_os_family_market_observations",
    "seller_os_opportunity_monitor_enrollments",
    "seller_os_prelinked_launch_family_evaluations"]) {
    assert.match(migration, new RegExp(`create table public\\.${table} \\(`))
  }
  assert.doesNotMatch(migration,
    /create table public\.(?:market_radar_snapshots|marketplace_product_research_capture_observations|marketplace_sold_evidence_observations)/)
  assert.match(migration, /CANONICAL_SOURCE_REFERENCES_ONLY/)
  assert.match(migration, /rawMarketFactsDuplicated', false/)
  assert.match(migration, /phase7Authority', 'FUTURE_CANONICAL_AUTHORITY'/)
})

test("family identity excludes query, score, adapter, Luna and observation time", () => {
  const id = functionBody("seller_os_market_family_id_v1")
  assert.match(id, /productFunction/)
  assert.match(id, /buyerUseCase/)
  assert.match(id, /category/)
  assert.match(id, /structuredDefinition/)
  assert.doesNotMatch(id,
    /family_query|score|adapter|luna|observation_window|launch_candidate/i)
  assert.match(migration,
    /current_family_definition_version_id text not null/)
  assert.match(migration,
    /seller_os_market_family_definition_family_unique/)
})

test("one family keeps one opportunity case across definition upgrades", () => {
  assert.match(migration, /family_id text not null unique/)
  assert.match(functionBody("seller_os_opportunity_case_id_v1"),
    /demand-first-test-launch/)
  assert.match(functionBody("put_seller_os_market_opportunity_case_v1"),
    /DEFINITION_ADVANCED/)
})

test("observation identity is the exact family-window-contract grain", () => {
  assert.match(migration,
    /unique \(\s*family_id, observation_window_start, observation_window_end,\s*contract_version\s*\)/)
  assert.match(observation, /SELLER_OS_FAMILY_MARKET_OBSERVATION_V1/)
  assert.match(observation, /SELLER_OS_FAMILY_MARKET_OBSERVATION_WINDOW_CONFLICT/)
  assert.match(observation, /tstzrange\(/)
  assert.match(observation, /pg_advisory_xact_lock/)
  assert.match(observation, /IDEMPOTENT_SUCCESS/)
  assert.match(observation, /OBSERVATION_REPLAY_CONFLICT/)
  assert.match(observation, /observation_input_digest/)
  assert.match(observation, /p_observation_window_end > now\(\)/)
})

test("one observation cannot claim momentum and two comparable windows are required", () => {
  assert.match(migration, /momentum_status text not null/)
  assert.match(migration, /'INSUFFICIENT_HISTORY','NEW','STRENGTHENING','STABLE'/)
  assert.match(observation,
    /v_momentum_status text := 'INSUFFICIENT_HISTORY'/)
  assert.match(observation, /least\(\s*86400\.0/)
  assert.match(observation, /greatest\(300\.0/)
  for (const comparison of ["aggregation_semantics",
    "family_definition_version_id", "source_adapter",
    "source_contract_version"]) assert.match(observation, new RegExp(comparison))
  assert.match(observation, /'SATURATING'/)
  assert.match(observation, /v_comparable_change/)
  assert.match(observation, /abs\(v_sold_change\) <= 0\.05/)
  assert.match(observation, /'WEAKENING'/)
  assert.doesNotMatch(observation, /model_score|ai_score|llm/i)
})

test("active listings and missing evidence cannot prove family demand", () => {
  assert.match(observation,
    /p_demand_evidence_class = 'OFFICIAL_SOLD_EVIDENCE'/)
  assert.match(observation, /p_sold_comparable_count/)
  assert.match(observation, /p_sold_quantity/)
  assert.match(migration,
    /'DIRECT_MARKET_OBSERVATION',\s*'DERIVED_NON_SALES_SIGNAL','UNPROVEN','UNAVAILABLE'/)
  assert.match(migration,
    /family_demand_status not in[\s\S]*?OFFICIAL_SOLD_EVIDENCE/)
})

test("market evidence is source-referenced and no arbitrary caller family ID exists", () => {
  const source = functionBody("seller_os_market_evidence_references_exist_v1")
  for (const canonical of ["marketplace_product_research_capture_batches",
    "marketplace_product_research_capture_observations",
    "marketplace_sold_evidence_import_batches",
    "marketplace_sold_evidence_observations",
    "ebay_discovery_family_cache"]) assert.match(source, new RegExp(canonical))
  assert.match(observation,
    /seller_os_market_evidence_references_exist_v1/)
  const signature = observation.match(
    /put_seller_os_family_market_observation_v1\(([\s\S]*?)\)\nreturns/,
  )?.[1] ?? ""
  assert.doesNotMatch(signature,
    /p_family_id|p_observation_id|p_momentum_status|p_demand_evidence_digest/)
  assert.match(observation,
    /seller_os_official_sold_evidence_summary_matches_v1/)
  assert.match(observation,
    /SELLER_OS_FAMILY_MARKET_EVIDENCE_DIGEST_V1/)
  assert.match(observation,
    /seller_os_market_evidence_material_digest_v1/)
  assert.match(observation, /FACTS_UNVERIFIED/)
  assert.doesNotMatch(observation,
    /seller_os_direct_market_evidence_summary_matches_v1/)
  assert.match(observation,
    /p_demand_evidence_class <> 'OFFICIAL_SOLD_EVIDENCE'/)
  assert.match(observation,
    /v_case\.family_identity -> 'structuredDefinition'/)
  assert.match(observation, /v_definition\.key_buyer_intent_terms/)
  assert.match(observation, /array\['DEMAND_FIRST_TEST_LAUNCH'\]/)
  assert.match(source,
    /p_demand_evidence_class <> 'OFFICIAL_SOLD_EVIDENCE'[\s\S]*?return false/)
})

test("authoritative evidence is bound to current family query and server-owned time metadata", () => {
  const binding = functionBody(
    "seller_os_family_market_evidence_binding_v1")
  assert.match(binding, /v_definition\.family_query_set/)
  assert.match(binding, /search_keyword_patterns/)
  assert.match(binding, /resolved\.search_query_hash = 'sha256:'/)
  assert.match(binding, /extensions\.digest\(convert_to\(lower\(query\.value\)/)
  assert.match(binding, /familyQueryBinding','MATCHED'/)
  assert.match(binding, /marketplace_product_research_capture_batches/)
  assert.doesNotMatch(binding,
    /marketplace_sold_evidence|ebay_discovery_family_cache/)
  for (const derived of ["date_range", "captured_at", "maximumAgeSeconds",
    "CUMULATIVE_SNAPSHOT", "SELLER_OS_PRODUCT_RESEARCH_FAMILY_ADAPTER_V1",
    "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE"]) {
    assert.match(binding, new RegExp(derived))
  }
  assert.match(binding, /OFFICIAL_NO_SOLD_RESULTS/)
  assert.match(binding, /min\(resolved\.captured_at\)/)
  assert.match(binding,
    /resolved\.captured_at \+ interval '30 days' < now\(\)/)
  assert.match(binding,
    /v_captured_at - v_oldest_captured_at > interval '1 day'/)
  assert.match(observation, /SOURCE_BINDING_INVALID/)
  assert.match(observation,
    /seller_os_family_market_evidence_binding_v1/)
  assert.match(observation,
    /current_family_definition_version_id is distinct from/)
  assert.match(observation, /v_binding::text/)
})

test("official sold summaries are recalculated from reviewed non-sensitive canonical rows", () => {
  const summary = functionBody(
    "seller_os_official_sold_evidence_summary_matches_v1")
  for (const guard of ["quality_status = 'VALID'", "evidence_reviewed",
    "not observation.raw_html_stored", "not observation.pii_stored",
    "not observation.raw_file_stored", "confirmed_sold_quantity > 0",
    "evidence_deduplication_key", "percentile_cont(0.5)",
    "MARKET_WIDE_SOLD_EVIDENCE", "batch.status = 'IMPORTED'",
    "batch.operator_attested"]) {
    assert.match(summary, new RegExp(guard.replace(/[.*+?^${}()|[\]\\]/g,
      "\\$&")))
  }
  assert.match(summary, /p_references <@ p_price_distribution_evidence/)
  assert.match(migration, new RegExp(
    "revoke all on function public\\.seller_os_official_sold_evidence_summary_matches_v1"))
  const material = functionBody("seller_os_market_evidence_material_digest_v1")
  for (const binding of ["capture_hash", "capture_window_hash",
    "search_query_hash", "evidence_deduplication_key", "identity_hash",
    "source_file_hash", "query_fingerprint"]) {
    assert.match(material, new RegExp(binding))
  }
  assert.match(material, /SELLER_OS_MARKET_EVIDENCE_MATERIAL_V1/)
  assert.equal(functionBody(
    "seller_os_direct_market_evidence_summary_matches_v1"), "")
  assert.match(migration, /OFFICIAL_SOLD_EVIDENCE_ONLY_V1/)
})

test("observation series is replay-first and chronological append-only", () => {
  const replayIndex = observation.indexOf("IDEMPOTENT_SUCCESS")
  const overlapIndex = observation.indexOf(
    "SELLER_OS_FAMILY_MARKET_OBSERVATION_WINDOW_CONFLICT")
  const backfillIndex = observation.indexOf(
    "SELLER_OS_FAMILY_MARKET_OBSERVATION_BACKFILL_REJECTED")
  assert.ok(replayIndex >= 0 && replayIndex < overlapIndex)
  assert.ok(overlapIndex < backfillIndex)
  assert.match(observation,
    /observation\.observation_window_end > p_observation_window_start/)
})

test("family case and observation relationships use composite foreign keys", () => {
  assert.match(migration,
    /unique \(\s*family_id, opportunity_case_id, observation_id\s*\)/)
  assert.match(migration,
    /foreign key \(\s*family_id, opportunity_case_id, previous_observation_id\s*\)/)
  assert.match(migration,
    /foreign key \(\s*family_id, opportunity_case_id, last_observation_id\s*\)/)
  assert.match(migration,
    /foreign key \(family_id, opportunity_case_id, current_market_observation_id\)/)
})

test("monitor enrollment is stable, server-owned, bounded and scheduler-off", () => {
  assert.match(migration,
    /unique \(\s*family_id, monitor_policy_version\s*\)/)
  assert.match(migration,
    /seller_os_opportunity_monitor_one_enrolled_per_family[\s\S]*?where status = 'ENROLLED'/)
  for (const condition of ["TIME_WINDOW_ELAPSED","NEW_SOLD_EVIDENCE",
    "PRICE_SHIFT","COMPETITOR_SHIFT","KEYWORD_SHIFT","ATTRIBUTE_SHIFT",
    "PRODUCT_LAUNCHED","OUTCOME_WINDOW_COMPLETE"]) {
    assert.match(migration, new RegExp(`'${condition}'`))
  }
  assert.match(migration, /scheduler_enabled boolean not null default false/)
  assert.match(migration, /and not scheduler_enabled/)
  assert.match(monitor, /pg_advisory_xact_lock/)
  assert.match(monitor,
    /p_status = 'ENROLLED' and v_case\.status <> 'MONITORING'/)
  assert.match(monitor, /OPPORTUNITY_MONITOR_CASE_NOT_ACTIVE/)
  assert.match(monitor, /OPPORTUNITY_MONITOR_STALE_REJECTED/)
  assert.match(monitor, /OPPORTUNITY_MONITOR_ENROLLED_AT_IMMUTABLE/)
  assert.match(monitor,
    /v_existing\.status is not distinct from p_status/)
  assert.match(monitor, /'outcome','IDEMPOTENT_SUCCESS'/)
  assert.ok(monitor.indexOf("'outcome','IDEMPOTENT_SUCCESS'") <
    monitor.indexOf("on conflict (enrollment_id) do update"))
  assert.match(monitor,
    /p_last_evaluated_at < v_existing\.last_evaluated_at/)
})

test("family evaluation is bound to the current persisted market observation", () => {
  assert.match(migration, /current_market_observation_id text not null/)
  assert.match(migration, /seller_os_prelinked_family_evaluation_observation_fk/)
  assert.match(evaluation,
    /where observation_id = p_current_market_observation_id/)
  assert.match(evaluation, /v_observation\.family_demand_status/)
  assert.match(evaluation, /v_observation\.demand_evidence_digest/)
  assert.match(evaluation,
    /v_observation\.demand_evidence_references <@\s*v_source\.evidence_references/)
  assert.match(evaluation, /SELLER_OS_TARGET_PRODUCT_PROFILE_V1/)
  assert.match(evaluation, /profileDigest/)
  assert.match(evaluation, /for share/)
  assert.match(evaluation,
    /current_family_definition_version_id is distinct from/)
  assert.match(evaluation, /v_case\.status <> 'MONITORING'/)
  const signature = evaluation.match(
    /put_seller_os_prelinked_launch_family_evaluation_v1\(([\s\S]*?)\)\nreturns/,
  )?.[1] ?? ""
  assert.doesNotMatch(signature,
    /p_family_id|p_family_demand_status|p_market_evidence_digest|p_family_query/)
})

test("candidate current pointer cannot reference another candidate evaluation", () => {
  assert.match(migration,
    /unique \(launch_candidate_id, evaluation_id\)/)
  assert.match(migration,
    /foreign key \(launch_candidate_id, current_family_evaluation_id\)/)
  assert.match(currentGate,
    /launch_candidate_id = v_candidate\.launch_candidate_id/)
})

test("evaluation identity covers every gate input and remains append-only", () => {
  assert.match(evaluation,
    /SELLER_OS_PRELINKED_FAMILY_EVALUATION_INPUT_V1/)
  for (const field of ["p_exact_product_demand_status","p_product_fit",
    "p_economics_status","p_supply_status","p_listing_research_readiness",
    "v_hard_blockers","v_requirements","p_maximum_age_seconds"]) {
    assert.match(evaluation, new RegExp(field))
  }
  assert.match(migration, /seller_os_prelinked_family_evaluation_append_only/)
})

test("hard gates and the current observation dominate score", () => {
  assert.match(evaluation,
    /v_observation\.family_demand_status in \(\s*'FAMILY_DEMAND_PROVEN','FAMILY_DEMAND_SUPPORTED'/)
  assert.match(evaluation, /p_product_fit = 'STRONG'/)
  assert.match(evaluation, /p_economics_status = 'ECONOMICS_PROVISIONAL_PASS'/)
  assert.match(evaluation, /cardinality\(v_hard_blockers\) = 0/)
  assert.match(migration,
    /launch_classification = 'NOT_READY_TO_TEST_LAUNCH'[\s\S]*?launch_score is null/)
})

test("SKU reservation checks current observation even on idempotent replay", () => {
  assert.match(migration,
    /rename to reserve_seller_os_prelinked_launch_sku_i01_base_v1/)
  assert.match(reserve,
    /assert_seller_os_prelinked_current_test_launch_gate_v1/)
  assert.match(currentGate, /CURRENT_GATE_REQUIRED/)
  assert.match(currentGate,
    /seller_os_prelinked_launch_evidence_packages source/)
  assert.match(currentGate,
    /v_source\.evidence_evaluated_at \+ make_interval/)
  assert.match(currentGate, /SOURCE_EVIDENCE_STALE/)
  assert.match(currentGate, /MARKET_GATE_STALE/)
  assert.match(currentGate, /for share/)
  assert.match(currentGate,
    /current_family_definition_version_id is distinct from/)
  assert.match(currentGate, /v_case\.status <> 'MONITORING'/)
  const guard = functionBody("guard_seller_os_prelinked_test_launch_sku_v1")
  assert.match(guard, /old\.canonical_sku is distinct from new\.canonical_sku/)
  assert.match(guard, /CANONICAL_SKU_IMMUTABLE/)
})

test("bounded service-role Radar read computes effective current readiness", () => {
  const read = functionBody("get_seller_os_family_market_radar_v1")
  assert.match(read, /p_limit not between 1 and 100/)
  assert.match(read, /observationSeries/)
  assert.match(read, /limit 12/)
  assert.match(read, /effectiveLaunchClassification/)
  assert.match(read, /current_family_definition_version_id/)
  assert.match(read, /enrollment\.status = 'ENROLLED'/)
  assert.match(read, /evidence_observed_at \+ make_interval/)
  for (const currentGateCheck of ["opportunity_case.status = 'MONITORING'",
    "candidate.launch_state = 'READY_FOR_TEST_LAUNCH'",
    "cardinality(candidate.hard_blockers) = 0",
    "candidate.current_evidence_package_id",
    "candidate.current_evidence_digest",
    "source.evidence_evaluated_at"]) {
    assert.match(read, new RegExp(currentGateCheck.replace(/[.*+?^${}()|[\]\\]/g,
      "\\$&")))
  }
  assert.match(migration,
    /grant execute on function public\.get_seller_os_family_market_radar_v1\(text,integer\)[\s\S]*?to service_role/)
})

test("all domain tables force RLS and expose only service-role RPC execution", () => {
  for (const table of ["seller_os_market_opportunity_cases",
    "seller_os_market_family_definitions","seller_os_family_market_observations",
    "seller_os_opportunity_monitor_enrollments",
    "seller_os_prelinked_launch_family_evaluations"]) {
    assert.match(migration, new RegExp(
      `alter table public\\.${table} force row level security`))
    assert.match(migration, new RegExp(
      `revoke all on table public\\.${table}[\\s\\S]*?service_role`))
  }
  for (const rpc of ["put_seller_os_market_opportunity_case_v1",
    "put_seller_os_family_market_observation_v1",
    "put_seller_os_opportunity_monitor_enrollment_v1",
    "put_seller_os_prelinked_launch_family_evaluation_v1"]) {
    assert.match(migration, new RegExp(
      `grant execute on function public\\.${rpc}[\\s\\S]*?to service_role`))
  }
})

test("artifact contains no publication, P2, stock or Product Case mutation", () => {
  assert.doesNotMatch(migration,
    /insert into public\.(?:ebay_listing_packages|ebay_active_listings|product_cases|seller_os_luna_stock)/i)
  assert.doesNotMatch(migration, /CERTIFIED_OOS|productionLunaPolling/i)
  assert.match(migration, /publish_allowed = false/)
  assert.match(migration, /p2_gate_bypass_allowed = false/)
})
