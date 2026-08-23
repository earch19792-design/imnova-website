import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260823023000_create_seller_os_daily_dollar_radar_autopilot.sql",
  import.meta.url,
), "utf8")

function functionBody(name) {
  return migration.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`,
  ))?.[0] ?? ""
}

const claim = functionBody("claim_seller_os_daily_dollar_radar_run_v1")
const complete = functionBody("complete_seller_os_daily_dollar_radar_run_v1")
const fail = functionBody("fail_seller_os_daily_dollar_radar_run_v1")
const readQueue = functionBody(
  "get_seller_os_morning_dollar_opportunity_queue_v1")
const queueValidator = functionBody(
  "is_valid_seller_os_morning_dollar_queue_v1")
const metricsValidator = functionBody(
  "is_valid_seller_os_daily_dollar_metrics_v1")
const receiptAppender = functionBody(
  "append_seller_os_daily_dollar_run_receipt_v1")

test("I02W creates only dedicated run, receipt, queue, and blocked policy state", () => {
  for (const table of [
    "seller_os_daily_dollar_radar_runs",
    "seller_os_daily_dollar_radar_run_receipts",
    "seller_os_morning_dollar_opportunity_queue_snapshots",
    "seller_os_daily_dollar_radar_scheduler_policy",
  ]) assert.match(migration, new RegExp(`create table public\\.${table} \\(`))

  assert.match(migration, /MORNING_DOLLAR_OPPORTUNITY_QUEUE_V1/)
  assert.match(migration, /rawMarketFactsDuplicated', false/)
  assert.doesNotMatch(migration,
    /create table public\.(?:market_radar|marketplace_product_research|seller_os_family_market_observations)/)
  assert.doesNotMatch(migration,
    /raw_(?:payload|html|evidence)|authorization_header|cookie|credential/i)
})

test("one logical daily run is durable, deterministic, and restart safe", () => {
  assert.match(migration,
    /seller_os_daily_dollar_radar_one_logical_day unique \(\s*account_key, marketplace_id, logical_run_date, contract_version\s*\)/)
  assert.match(migration,
    /seller_os_daily_dollar_radar_one_logical_window unique \(\s*account_key, marketplace_id, logical_window_start, logical_window_end,/)
  assert.match(migration,
    /logical_window_end - logical_window_start = interval '24 hours'/)
  assert.match(migration, /evidence_cutoff_at = logical_window_end/)
  assert.match(claim, /p_evidence_cutoff_at <> p_logical_window_end/)
  assert.match(claim, /SELLER_OS_DAILY_DOLLAR_RADAR_RUN_ID_V1/)
  assert.match(claim, /pg_advisory_xact_lock/)
  assert.match(claim, /for update/)
  assert.match(claim, /SELLER_OS_DAILY_DOLLAR_LOGICAL_RUN_CONFLICT/)
  assert.match(claim, /IDEMPOTENT_COMPLETED/)
  assert.doesNotMatch(claim, /insert[\s\S]*?on conflict[\s\S]*?do update/i)
})

test("claim owns the lease server-side and stores only its SHA-256 hash", () => {
  const signature = claim.match(
    /claim_seller_os_daily_dollar_radar_run_v1\(([\s\S]*?)\)\nreturns/,
  )?.[1] ?? ""
  for (const parameter of [
    "p_account_key text", "p_marketplace_id text",
    "p_logical_window_start timestamptz", "p_logical_window_end timestamptz",
    "p_evidence_cutoff_at timestamptz", "p_worker_id text",
    "p_input_digest text", "p_lease_seconds integer default 300",
  ]) assert.match(signature, new RegExp(parameter.replaceAll(" ", "\\s+")))
  assert.doesNotMatch(signature, /p_lease_token/)
  assert.match(claim, /extensions\.gen_random_bytes\(32\)/)
  assert.match(claim, /v_lease_token_hash := 'sha256:' \|\| encode/)
  assert.match(migration, /lease_token_hash text not null/)
  assert.doesNotMatch(migration, /^\s+lease_token\s+text|raw_lease/im)
  assert.match(claim, /p_lease_seconds not between 60 and 900/)
  assert.match(claim, /'outcome', 'LEASE_HELD'/)
  assert.match(claim, /'leaseToken', null/)
})

test("retries are bounded to three and expired leases cannot amplify runs", () => {
  assert.match(migration, /maximum_attempts integer not null default 3/)
  assert.match(migration, /maximum_attempts = 3/)
  assert.match(migration, /attempt_count between 1 and maximum_attempts/)
  assert.match(claim,
    /append_seller_os_daily_dollar_run_receipt_v1\(\s*v_run\.run_id, 'LEASE_EXPIRED'/)
  assert.match(claim, /v_run\.attempt_count >= v_run\.maximum_attempts/)
  assert.match(claim, /MAXIMUM_ATTEMPTS_EXHAUSTED/)
  assert.match(claim, /attempt_count = attempt_count \+ 1/)
  assert.match(fail, /v_run\.attempt_count < v_run\.maximum_attempts/)
  assert.match(fail, /60 \* \(2 \^ \(attempt_count - 1\)\)/)
  assert.match(fail, /'RETRY_WAIT'/)
  assert.match(fail, /'FAILED_TERMINAL'/)
  assert.doesNotMatch(fail, /p_retryable|p_maximum_attempts/)
})

test("input/output digests and lease ownership bind completion and failure", () => {
  for (const body of [complete, fail]) {
    assert.match(body, /v_run\.input_digest <> p_input_digest/)
    assert.match(body, /v_run\.lease_token_hash <> v_token_hash/)
    assert.match(body, /for update/)
  }
  assert.match(complete, /p_output_digest/)
  assert.match(complete,
    /SELLER_OS_MORNING_DOLLAR_OPPORTUNITY_QUEUE_DIGEST_V1/)
  assert.match(complete, /SELLER_OS_DAILY_DOLLAR_COMPLETION_REPLAY_CONFLICT/)
  assert.match(complete, /SELLER_OS_MORNING_DOLLAR_QUEUE_REPLAY_CONFLICT/)
  assert.match(complete, /IDEMPOTENT_SUCCESS/)
  assert.match(fail, /IDEMPOTENT_SUCCESS/)
})

test("the morning queue is deterministic, reference-only, and bounded to five", () => {
  assert.match(migration, /entry_count between 0 and 5/)
  assert.match(queueValidator, /jsonb_array_length\(p_entries\) > 5/)
  assert.match(queueValidator, /morning-dollar-queue-entry-v1:sha256:/)
  assert.match(queueValidator,
    /SELLER_OS_MORNING_DOLLAR_QUEUE_ENTRY_ID_V1/)
  assert.match(queueValidator, /launch-configuration-v1:sha256:/)
  assert.match(queueValidator, /family-market-observation-v1:sha256:/)
  assert.match(queueValidator, /frontierDigest/)
  assert.match(queueValidator, /reasonCodes/)
  for (const field of [
    "demandStatus", "demandEvidenceSummary", "topLunaProductId",
    "topLunaVariantId", "dollarPriorityRank", "exactProductVariantIdentity", "productFit",
    "competitionStatus", "targetProductProfileSummary", "buyerIntent",
    "buyerIntentTerms", "primaryKeyword", "primaryKeywords",
    "secondaryKeywords", "contributionPathSummary", "currentHardBlockers",
    "hardBlockers", "shipping", "researchStatus", "nextAction",
    "nextBestAction", "needsFreshEbayVerification",
    "ebayVerificationReason", "ebayVerificationPriority",
    "ebayVerificationExpectedDecisionValue", "ebayEscalationId",
    "frontierInterpretation", "listingAuthorized", "marketplaceWriteAllowed",
    "p2MutationAllowed",
  ]) assert.match(queueValidator, new RegExp(`'${field}'`))
  assert.match(queueValidator,
    /SELLER_OS_TARGET_PRODUCT_PROFILE_WITH_AUTHORITY_V1/)
  assert.match(queueValidator,
    /dollarPriorityRank' <> v_entry ->> 'rank'/)
  assert.match(queueValidator, /CANONICAL_I02V_FRONTIER_PASSTHROUGH/)
  assert.match(queueValidator, /READY_FOR_BOUNDED_EVIDENCE_ACQUISITION/)
  assert.match(queueValidator,
    /v_entry -> 'reasonCodes' <> v_entry -> 'currentHardBlockers'/)
  assert.match(queueValidator,
    /v_entry -> 'ebayEscalationRequired' <>\s*v_entry -> 'needsFreshEbayVerification'/)
  assert.match(queueValidator,
    /BOUNDED_EBAY_EVIDENCE_ESCALATION/)
  assert.match(queueValidator, /DURABLE_EVIDENCE_ONLY/)
  assert.match(queueValidator, /prior\.value >= reason\.value collate "C"/)
  assert.match(complete,
    /jsonb_agg\(entry\.value order by\s*\(entry\.value ->> 'rank'\)::integer\)/)
  assert.match(complete,
    /\(p_metrics ->> 'queueCount'\)::integer <>\s*jsonb_array_length\(p_entries\)/)
})

test("metrics are exact and every external/mutation safety counter is zero", () => {
  for (const key of [
    "familyInputCount", "eligibleFamilyCount", "configurationInputCount",
    "queueCount", "escalationCount", "radarFamilyRows",
    "productResearchRows", "lunaVariantRows", "familyEvaluationRows",
    "familiesEvaluated", "newFamiliesDiscovered", "demandProvenCount",
    "demandSupportedCount", "lunaMatchCount", "productFitStrongCount",
    "economicallyDeadCount", "economicallyRecoverableCount",
    "economicallyPromisingCount", "economicsUnprovenCount",
    "morningQueueCount", "needsFreshEbayVerificationCount", "failureStage",
    "eBayApiCalls", "eBaySellCalls", "eBayMarketplaceApiCalls",
    "eBayTradingCalls",
    "eBayBrowseCalls", "eBayDeveloperAnalyticsCalls", "marketplaceWrites",
    "lunaNetworkReads", "lunaStockReads", "lunaMutations", "p2Mutations",
    "t0Writes", "t1Writes", "skuReservations",
  ]) assert.match(metricsValidator, new RegExp(`'${key}'`))
  assert.match(metricsValidator,
    /count\(\*\) from jsonb_object_keys\(p_metrics\)[\s\S]*?cardinality\(v_required_keys\)/)
  for (const zero of [
    "eBayApiCalls", "eBaySellCalls", "eBayMarketplaceApiCalls",
    "eBayTradingCalls", "eBayBrowseCalls", "eBayDeveloperAnalyticsCalls",
    "marketplaceWrites", "lunaNetworkReads", "lunaStockReads",
    "lunaMutations", "p2Mutations", "t0Writes", "t1Writes",
    "skuReservations",
  ]) assert.match(metricsValidator, new RegExp(`'${zero}'\\)::integer = 0`))
  for (const column of [
    "ebay_api_calls", "ebay_sell_calls", "ebay_marketplace_api_calls",
    "ebay_trading_calls", "ebay_browse_calls",
    "ebay_developer_analytics_calls", "marketplace_writes",
    "luna_network_reads", "luna_stock_reads", "luna_mutations",
    "p2_mutations", "t0_writes", "t1_writes", "sku_reservations",
    "generative_image_calls", "payments",
  ]) assert.match(migration, new RegExp(`and ${column} = 0`))
  assert.match(metricsValidator,
    /morningQueueCount'\)::integer = v_queue_count/)
  assert.match(metricsValidator,
    /needsFreshEbayVerificationCount'\)::integer =[\s\S]*?escalationCount/)
  assert.match(metricsValidator,
    /escalationCount'\)::integer\s+between 0 and v_queue_count/)
  assert.match(complete, /p_metrics ->> 'failureStage' <> 'NONE'/)
  assert.match(fail, /p_metrics ->> 'failureStage' = 'NONE'/)
})

test("append-only receipts capture required decision and lifecycle metrics", () => {
  for (const column of [
    "run_status", "evidence_cutoff_at", "run_started_at", "run_completed_at",
    "failure_stage", "families_evaluated", "new_families_discovered",
    "demand_proven_count", "demand_supported_count", "luna_match_count",
    "product_fit_strong_count", "economically_dead_count",
    "economically_recoverable_count", "economically_promising_count",
    "economics_unproven_count", "morning_queue_count",
    "needs_fresh_ebay_verification_count",
  ]) assert.match(migration, new RegExp(`\\b${column}\\b`))
  for (const source of [
    "status", "evidence_cutoff_at", "started_at", "completed_at",
    "failure_stage", "families_evaluated", "new_families_discovered",
    "demand_proven_count", "demand_supported_count", "luna_match_count",
    "product_fit_strong_count", "economically_dead_count",
    "economically_recoverable_count", "economically_promising_count",
    "economics_unproven_count", "morning_queue_count",
    "needs_fresh_ebay_verification_count",
  ]) assert.match(receiptAppender, new RegExp(`v_run\\.${source}`))
})

test("receipts, queue snapshots, and scheduler policy are append-only", () => {
  for (const table of [
    "seller_os_daily_dollar_radar_run_receipts",
    "seller_os_morning_dollar_opportunity_queue_snapshots",
    "seller_os_daily_dollar_radar_scheduler_policy",
  ]) assert.match(migration, new RegExp(
    `before update or delete\\s+on public\\.${table}`,
  ))
  assert.match(migration, /SELLER_OS_DAILY_DOLLAR_APPEND_ONLY/)
  assert.match(migration,
    /seller_os_daily_dollar_radar_receipt_logical_event unique \(\s*run_id, attempt_number, event_type\s*\)/)
  assert.match(receiptAppender,
    /SELLER_OS_DAILY_DOLLAR_RADAR_RUN_RECEIPT_V1/)
  for (const body of [claim, complete, fail]) {
    assert.match(body, /append_seller_os_daily_dollar_run_receipt_v1/)
  }
})

test("scheduler stays blocked with no pg_cron, pg_net, or second dispatcher", () => {
  assert.match(migration, /scheduler_authority = 'VERCEL_CRON'/)
  assert.match(migration, /scheduler_enabled boolean not null default false check \(not scheduler_enabled\)/)
  assert.match(migration, /BLOCKED_TIMEZONE_POLICY_UNPROVEN/)
  assert.match(migration, /business_timezone text null check \(business_timezone is null\)/)
  assert.match(migration, /utc_cron_schedule text null check \(utc_cron_schedule is null\)/)
  assert.match(migration, /authorization_secret_name = 'CRON_SECRET'/)
  assert.doesNotMatch(migration,
    /pg_cron|pg_net|cron\.schedule|net\.http|dispatch_seller_os|enable_seller_os_daily_dollar/i)
})

test("all tables use forced RLS and direct DML is revoked from service_role", () => {
  for (const table of [
    "seller_os_daily_dollar_radar_runs",
    "seller_os_daily_dollar_radar_run_receipts",
    "seller_os_morning_dollar_opportunity_queue_snapshots",
    "seller_os_daily_dollar_radar_scheduler_policy",
  ]) {
    assert.match(migration, new RegExp(
      `alter table public\\.${table}\\s+enable row level security;`,
    ))
    assert.match(migration, new RegExp(
      `alter table public\\.${table}\\s+force row level security;`,
    ))
    assert.match(migration, new RegExp(
      `revoke all on table public\\.${table}\\s+from public, anon, authenticated, service_role;`,
    ))
  }
  assert.doesNotMatch(migration,
    /grant\s+(?:select|insert|update|delete|all)[\s\S]{0,120}?to service_role/i)
  assert.match(migration, /is_seller_os_service_role_request_v1\(\)/)
})

test("only service_role can execute the four bounded operational RPCs", () => {
  for (const name of [
    "claim_seller_os_daily_dollar_radar_run_v1",
    "complete_seller_os_daily_dollar_radar_run_v1",
    "fail_seller_os_daily_dollar_radar_run_v1",
    "get_seller_os_morning_dollar_opportunity_queue_v1",
  ]) {
    assert.match(migration, new RegExp(
      `revoke all on function public\\.${name}\\([\\s\\S]*?\\) from public, anon, authenticated;`,
    ))
    assert.match(migration, new RegExp(
      `grant execute on function public\\.${name}\\([\\s\\S]*?\\) to service_role;`,
    ))
  }
  for (const body of [claim, complete, fail, readQueue]) {
    assert.match(body, /not public\.is_seller_os_service_role_request_v1\(\)/)
  }
})

test("queue read is bounded and never returns lease or secret material", () => {
  assert.match(readQueue, /p_limit not between 1 and 5/)
  assert.match(readQueue, /entry\.ordinality <= p_limit/)
  assert.match(readQueue, /MORNING_DOLLAR_QUEUE_NOT_PERSISTED/)
  assert.match(readQueue, /'status', 'AVAILABLE'/)
  assert.match(readQueue, /'rawMarketFactsDuplicated', false/)
  assert.doesNotMatch(readQueue,
    /lease_token|leaseToken|authorization_secret_name|CRON_SECRET|raw_payload/i)
})

test("storage cannot publish, mutate P2, reserve SKU, or write market evidence", () => {
  assert.doesNotMatch(migration,
    /publish(?:_listing)?\s*\(|revise(?:_listing)?\s*\(|reserve_seller_os_prelinked_launch_sku_v1\s*\(|put_seller_os_family_market_observation_v1\s*\(|put_seller_os_opportunity_monitor_enrollment_v1\s*\(/i)
  assert.doesNotMatch(migration, /ebay_item_id|p2_linkage_id|listing_package_id/i)
})
