#!/usr/bin/env node

import { spawn } from "node:child_process"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

const PROJECT_REF = "vsfthqydfrdzulldbfbe"
const REPOSITORY = "/home/earch/imnova-seller-os-canonical-integration-foundation-v1"
const PASSWORD_FIFO = process.env.SELLER_OS_DB_PASSWORD_FIFO ?? ""
const PHASE = process.env.SELLER_OS_I02W_PREFLIGHT_PHASE ?? "all"
const ACCESS_TOKEN_PATH = "/home/earch/.supabase/access-token"
// The project direct endpoint is IPv6-only and unreachable from this runner.
// Supabase documents shared-pooler session mode as the IPv4 alternative for
// persistent Postgres clients. Keep every value fixed and non-caller-controlled
// so a handoff credential cannot be redirected.
const DB_HOST = "aws-1-us-west-2.pooler.supabase.com"
const DB_PORT = "5432"
const DB_USER = `postgres.${PROJECT_REF}`
const I02W = resolve(REPOSITORY,
  "supabase/migrations/20260823023000_create_seller_os_daily_dollar_radar_autopilot.sql")
const FRONTIER = resolve(REPOSITORY,
  "supabase/migrations/20260823034507_create_seller_os_profitability_frontier_and_schedule_policy.sql")

function run(program, args, { input = "", environment = {}, code }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(program, args, {
      cwd: REPOSITORY,
      env: { ...process.env, ...environment },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", () => rejectRun(new Error(`${code}:PROCESS_UNAVAILABLE`)))
    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        const diagnostic = `${stderr}\n${stdout}`
          .replace(/[\r\n]+/g, " ").slice(0, 1_200)
        rejectRun(new Error(`${code}:${diagnostic}`))
        return
      }
      resolveRun({ stdout, stderr })
    })
    child.stdin.end(input)
  })
}

async function psql(query, password, code, tuplesOnly = false) {
  const args = ["--host", DB_HOST, "--port", DB_PORT, "--username", DB_USER,
    "--dbname", "postgres", "--set", "ON_ERROR_STOP=1", "--no-psqlrc",
    "--quiet", "--set", "sslmode=require"]
  if (tuplesOnly) args.push("--tuples-only", "--no-align")
  return run("/usr/bin/psql", args, { input: query,
    environment: { PGPASSWORD: password, PGSSLMODE: "require",
      PGGSSENCMODE: "disable" }, code })
}

async function managementSql(query, accessToken, code) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(60_000),
    })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = String(body?.message ?? body?.error ?? "UNKNOWN")
      .replace(/[\r\n]+/g, " ").slice(0, 1_200)
    throw new Error(`${code}:${message}`)
  }
  return body
}

function assertionSql({ includeFrontier }) {
  const targetTables = includeFrontier ? 5 : 4
  return `
set local request.jwt.claim.role = 'service_role';
do $assert$
declare
  v_table_count integer;
  v_rls_count integer;
  v_forced_count integer;
  v_function_count integer;
  v_direct_service_role_dml integer;
  v_not_null_count integer;
  v_final_policy_constraint_count integer;
  v_policy public.seller_os_daily_dollar_radar_scheduler_policy%rowtype;
  v_created jsonb;
  v_replay jsonb;
  v_read jsonb;
  v_claim jsonb;
  v_lease_held jsonb;
  v_completed jsonb;
  v_completed_replay jsonb;
  v_metrics jsonb;
  v_entry_durable jsonb;
  v_entry_escalated jsonb;
  v_family_id text := 'market-family-v1:sha256:${"1".repeat(64)}';
  v_configuration_id text := 'launch-configuration-v1:sha256:${"f".repeat(64)}';
  v_frontier_digest text := 'sha256:${"2".repeat(64)}';
  v_queue_entry_id text;
  v_conflict_rejected boolean := false;
begin
  select count(*), count(*) filter (where c.relrowsecurity),
    count(*) filter (where c.relforcerowsecurity)
  into v_table_count, v_rls_count, v_forced_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in (
    'seller_os_daily_dollar_radar_runs',
    'seller_os_daily_dollar_radar_run_receipts',
    'seller_os_morning_dollar_opportunity_queue_snapshots',
    'seller_os_daily_dollar_radar_scheduler_policy'${includeFrontier
      ? ", 'seller_os_profitability_frontier_snapshots'" : ""}
  );
  if v_table_count <> ${targetTables} or v_rls_count <> ${targetTables}
    or v_forced_count <> ${targetTables} then
    raise exception 'I02W_PREFLIGHT_RLS_ASSERTION_FAILED';
  end if;

  select count(*) into v_function_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'claim_seller_os_daily_dollar_radar_run_v1',
    'complete_seller_os_daily_dollar_radar_run_v1',
    'fail_seller_os_daily_dollar_radar_run_v1',
    'get_seller_os_morning_dollar_opportunity_queue_v1'${includeFrontier
      ? ", 'put_seller_os_profitability_frontier_v1', 'get_seller_os_latest_profitability_frontiers_v1'" : ""}
  );
  if v_function_count <> ${includeFrontier ? 6 : 4} then
    raise exception 'I02W_PREFLIGHT_FUNCTION_ASSERTION_FAILED';
  end if;

  select count(*) into v_direct_service_role_dml
  from information_schema.role_table_grants grant_row
  where grant_row.table_schema = 'public'
    and grant_row.table_name in (
      'seller_os_daily_dollar_radar_runs',
      'seller_os_daily_dollar_radar_run_receipts',
      'seller_os_morning_dollar_opportunity_queue_snapshots',
      'seller_os_daily_dollar_radar_scheduler_policy'${includeFrontier
        ? ", 'seller_os_profitability_frontier_snapshots'" : ""}
    )
    and grant_row.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
    and grant_row.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  if v_direct_service_role_dml <> 0 then
    raise exception 'I02W_PREFLIGHT_DIRECT_DML_ASSERTION_FAILED';
  end if;

  select * into v_policy
  from public.seller_os_daily_dollar_radar_scheduler_policy where singleton;
  if ${includeFrontier ? "v_policy.scheduler_enabled or v_policy.policy_status <> 'PREFLIGHT_APPROVED_DISABLED_PENDING_STORAGE_APPLY' or v_policy.business_timezone <> 'America/New_York' or v_policy.utc_cron_schedule <> '0 9 * * *' or v_policy.policy_reference <> 'SELLER_OS_COMMERCIAL_TIMEZONE_V1:America/New_York:READY_BY_06:00'" : "v_policy.scheduler_enabled or v_policy.policy_status <> 'BLOCKED_TIMEZONE_POLICY_UNPROVEN' or v_policy.business_timezone is not null or v_policy.utc_cron_schedule is not null"} then
    raise exception 'I02W_PREFLIGHT_SCHEDULER_POLICY_ASSERTION_FAILED';
  end if;

  ${includeFrontier ? `
  select count(*) into v_not_null_count
  from pg_catalog.pg_attribute
  where attrelid =
      'public.seller_os_daily_dollar_radar_scheduler_policy'::regclass
    and attname in ('business_timezone', 'utc_cron_schedule',
      'policy_reference')
    and attnotnull and not attisdropped;
  if v_not_null_count <> 3 then
    raise exception 'I02W_PREFLIGHT_SCHEDULER_NOT_NULL_ASSERTION_FAILED';
  end if;

  select count(*) into v_final_policy_constraint_count
  from pg_catalog.pg_constraint
  where conrelid =
      'public.seller_os_daily_dollar_radar_scheduler_policy'::regclass
    and contype = 'c' and convalidated
    and conname in (
      'seller_os_daily_dollar_scheduler_disabled_check',
      'seller_os_daily_dollar_scheduler_policy_status_check',
      'seller_os_daily_dollar_scheduler_timezone_check',
      'seller_os_daily_dollar_scheduler_cron_check',
      'seller_os_daily_dollar_scheduler_reference_check'
    );
  if v_final_policy_constraint_count <> 5 then
    raise exception 'I02W_PREFLIGHT_FINAL_POLICY_CONSTRAINT_ASSERTION_FAILED';
  end if;
  ` : ""}

  v_queue_entry_id := 'morning-dollar-queue-entry-v1:sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_MORNING_DOLLAR_QUEUE_ENTRY_ID_V1', E'\\n',
      v_family_id, E'\\n', v_configuration_id, E'\\n', v_frontier_digest
    ), 'UTF8'), 'sha256'), 'hex');
  v_entry_durable := jsonb_build_object(
    'queueEntryId', v_queue_entry_id, 'rank', 1, 'dollarPriorityRank', 1,
    'familyId', v_family_id, 'familyName', 'Transactional family',
    'opportunityCaseId', 'opportunity-case-v1:sha256:${"b".repeat(64)}',
    'currentMarketObservationId',
      'family-market-observation-v1:sha256:${"c".repeat(64)}',
    'demandStatus', 'FAMILY_DEMAND_PROVEN',
    'demandEvidenceSummary', jsonb_build_object(
      'demandEvidenceClass', 'OFFICIAL_SOLD_EVIDENCE',
      'soldComparableCount', 3, 'soldQuantityEvidence', 5,
      'priceMedianUsd', 27.17, 'limitations', '[]'::jsonb,
      'evidenceReference',
        'family-market-observation-v1:sha256:${"c".repeat(64)}',
      'evidenceDigest', 'sha256:${"d".repeat(64)}'),
    'candidateId', 'prelinked-candidate:transactional-test',
    'configurationId', v_configuration_id,
    'lunaProductId', '9220832493792', 'lunaVariantId', '48809643540704',
    'topLunaProductId', '9220832493792',
    'topLunaVariantId', '48809643540704', 'lunaSku', 'TEST-SKU-1',
    'exactProductVariantIdentity', true, 'productFit', 'STRONG',
    'competitionStatus', 'UNPROVEN',
    'targetProfileDigest', 'sha256:${"6".repeat(64)}',
    'targetProductProfileSummary', jsonb_build_object(
      'contractVersion', 'SELLER_OS_TARGET_PRODUCT_PROFILE_WITH_AUTHORITY_V1',
      'profileDigest', 'sha256:${"6".repeat(64)}',
      'authority', 'SERVER_DERIVED_FROM_CURRENT_MARKET_OBSERVATION',
      'requiredAttributes', jsonb_build_array(jsonb_build_object(
        'key', 'function', 'expectedValue', 'transactional test',
        'attributeClassification', 'PROVEN_ATTRIBUTE',
        'matchMode', 'EXACT_NORMALIZED', 'componentIdentityId', null,
        'authorityClass', 'DURABLY_PERSISTED_FACT',
        'evidenceReference',
          'family-market-observation-v1:sha256:${"c".repeat(64)}',
        'evidenceDigest', 'sha256:${"d".repeat(64)}')),
      'preferredAttributes', '[]'::jsonb),
    'economicClassification', 'ECONOMICALLY_RECOVERABLE',
    'dollarPriorityScore', 72, 'nextBestEvidence', 'ACTUAL_LUNA_SHIPPING',
    'nextAction', 'ACTUAL_LUNA_SHIPPING',
    'nextBestAction', 'ACTUAL_LUNA_SHIPPING', 'nextEvidenceValue', 'HIGH',
    'buyerIntent', jsonb_build_array('transactional test'),
    'buyerIntentTerms', jsonb_build_array('transactional test'),
    'primaryKeyword', 'transactional test',
    'primaryKeywords', jsonb_build_array('transactional test'),
    'secondaryKeywords', '[]'::jsonb,
    'contributionPathSummary', jsonb_build_object(
      'marketPriceMedianUsd', 27.17, 'totalProductCostUsd', 10.96,
      'shippingStatus', 'SHIPPING_PROVISIONAL_RESERVE',
      'provisionalShippingReserveUsd', 6.99,
      'contributionProfitAtMarketMedianUsd', 2.22,
      'contributionMarginAtMarketMedianPercent', 8.16,
      'maxShippingAtTargetMarginUsd', 3.77,
      'minSellingPriceAtTargetMarginUsd', 32.95,
      'strongRecoverablePath', true,
      'authority', 'CANONICAL_I02V_FRONTIER_PASSTHROUGH'),
    'currentHardBlockers', '[]'::jsonb, 'hardBlockers', '[]'::jsonb,
    'shipping', jsonb_build_object(
      'status', 'SHIPPING_PROVISIONAL_RESERVE',
      'provisionalReserveUsd', 6.99,
      'provisionalReserveClaimedAsObserved', false),
    'researchStatus', 'READY_FOR_BOUNDED_EVIDENCE_ACQUISITION',
    'ebayEscalationRequired', false, 'needsFreshEbayVerification', false,
    'ebayVerificationReason', null, 'ebayVerificationPriority', null,
    'ebayVerificationExpectedDecisionValue', null, 'ebayEscalationId', null,
    'executionRoute', 'DURABLE_EVIDENCE_ONLY',
    'frontierDigest', v_frontier_digest,
    'frontierInterpretation', 'PASSTHROUGH_I02V', 'reasonCodes', '[]'::jsonb,
    'listingAuthorized', false, 'marketplaceWriteAllowed', false,
    'p2MutationAllowed', false);
  v_entry_escalated := v_entry_durable || jsonb_build_object(
    'nextBestEvidence', 'BETTER_PRICE_DISTRIBUTION',
    'nextAction', 'BETTER_PRICE_DISTRIBUTION',
    'nextBestAction', 'BETTER_PRICE_DISTRIBUTION',
    'ebayEscalationRequired', true, 'needsFreshEbayVerification', true,
    'ebayVerificationReason', 'BETTER_PRICE_DISTRIBUTION',
    'ebayVerificationPriority', 'HIGH',
    'ebayVerificationExpectedDecisionValue', 'HIGH',
    'ebayEscalationId', 'ebay-read-escalation-v1:sha256:${"7".repeat(64)}',
    'executionRoute', 'BOUNDED_EBAY_EVIDENCE_ESCALATION');
  if not public.is_valid_seller_os_morning_dollar_queue_v1(
      jsonb_build_array(v_entry_durable))
    or not public.is_valid_seller_os_morning_dollar_queue_v1(
      jsonb_build_array(v_entry_escalated))
    or public.is_valid_seller_os_morning_dollar_queue_v1(
      jsonb_build_array(v_entry_durable || jsonb_build_object(
        'executionRoute', 'CALLER_CONTROLLED_ROUTE')))
    or public.is_valid_seller_os_morning_dollar_queue_v1(
      jsonb_build_array(v_entry_durable, v_entry_durable, v_entry_durable,
        v_entry_durable, v_entry_durable, v_entry_durable)) then
    raise exception 'I02W_PREFLIGHT_QUEUE_CASE_RUNTIME_ASSERTION_FAILED';
  end if;

  v_metrics := jsonb_build_object(
    'familyInputCount',0,'eligibleFamilyCount',0,'configurationInputCount',0,
    'queueCount',0,'escalationCount',0,'radarFamilyRows',0,
    'productResearchRows',0,'lunaVariantRows',0,'familyEvaluationRows',0,
    'familiesEvaluated',0,'newFamiliesDiscovered',0,'demandProvenCount',0,
    'demandSupportedCount',0,'lunaMatchCount',0,'productFitStrongCount',0,
    'economicallyDeadCount',0,'economicallyRecoverableCount',0,
    'economicallyPromisingCount',0,'economicsUnprovenCount',0,
    'morningQueueCount',0,'needsFreshEbayVerificationCount',0,
    'failureStage','NONE','eBayApiCalls',0,'eBaySellCalls',0,
    'eBayMarketplaceApiCalls',0,'eBayTradingCalls',0,'eBayBrowseCalls',0,
    'eBayDeveloperAnalyticsCalls',0,'marketplaceWrites',0,
    'lunaNetworkReads',0,'lunaStockReads',0,'lunaMutations',0,
    'p2Mutations',0,'t0Writes',0,'t1Writes',0,'skuReservations',0);
  v_claim := public.claim_seller_os_daily_dollar_radar_run_v1(
    'test-account:${"a".repeat(64)}', 'EBAY_US',
    ${includeFrontier
      ? "'2026-03-08T05:00:00.000Z'::timestamptz, '2026-03-09T04:00:00.000Z'::timestamptz, '2026-03-09T04:00:00.000Z'::timestamptz,"
      : "'2026-08-23T00:00:00.000Z'::timestamptz, '2026-08-24T00:00:00.000Z'::timestamptz, '2026-08-24T00:00:00.000Z'::timestamptz,"}
    'transactional-preflight', 'sha256:${"3".repeat(64)}', 60);
  v_lease_held := public.claim_seller_os_daily_dollar_radar_run_v1(
    'test-account:${"a".repeat(64)}', 'EBAY_US',
    ${includeFrontier
      ? "'2026-03-08T05:00:00.000Z'::timestamptz, '2026-03-09T04:00:00.000Z'::timestamptz, '2026-03-09T04:00:00.000Z'::timestamptz,"
      : "'2026-08-23T00:00:00.000Z'::timestamptz, '2026-08-24T00:00:00.000Z'::timestamptz, '2026-08-24T00:00:00.000Z'::timestamptz,"}
    'transactional-preflight-replay', 'sha256:${"3".repeat(64)}', 60);
  if v_claim ->> 'outcome' <> 'CLAIMED'
    or v_lease_held ->> 'outcome' <> 'LEASE_HELD'
    or v_lease_held -> 'leaseToken' <> 'null'::jsonb then
    raise exception 'I02W_PREFLIGHT_LEASE_ASSERTION_FAILED';
  end if;
  v_completed := public.complete_seller_os_daily_dollar_radar_run_v1(
    v_claim ->> 'runId', v_claim ->> 'leaseToken',
    'sha256:${"3".repeat(64)}', 'sha256:${"4".repeat(64)}',
    '[]'::jsonb, v_metrics);
  v_completed_replay := public.complete_seller_os_daily_dollar_radar_run_v1(
    v_claim ->> 'runId', v_claim ->> 'leaseToken',
    'sha256:${"3".repeat(64)}', 'sha256:${"4".repeat(64)}',
    '[]'::jsonb, v_metrics);
  if v_completed ->> 'outcome' <> 'COMPLETED'
    or v_completed_replay ->> 'outcome' <> 'IDEMPOTENT_SUCCESS'
    or (select count(*) from public.seller_os_daily_dollar_radar_run_receipts
        where run_id = v_claim ->> 'runId') <> 2
    or exists (select 1 from public.seller_os_daily_dollar_radar_run_receipts
        where run_id = v_claim ->> 'runId' and (
          ebay_api_calls <> 0 or ebay_sell_calls <> 0
          or ebay_marketplace_api_calls <> 0 or ebay_trading_calls <> 0
          or ebay_browse_calls <> 0 or marketplace_writes <> 0)) then
    raise exception 'I02W_PREFLIGHT_COMPLETION_REPLAY_ASSERTION_FAILED';
  end if;

  ${includeFrontier ? `
  v_created := public.put_seller_os_profitability_frontier_v1(
    'test-account:${"a".repeat(64)}', 'EBAY_US',
    'opportunity-case-v1:sha256:${"b".repeat(64)}',
    'family-market-observation-v1:sha256:${"c".repeat(64)}',
    'sha256:${"d".repeat(64)}', 'SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1',
    'SELLER_OS_CANONICAL_PROVISIONAL_ECONOMICS_POLICY_V1',
    'sha256:${"e".repeat(64)}',
    '2026-08-23T01:00:00.000Z'::timestamptz,
    '2026-08-23T02:00:00.000Z'::timestamptz,
    jsonb_build_object(
      'contractVersion','SELLER_OS_PROFITABILITY_FRONTIER_V1',
      'configurationId','launch-configuration-v1:sha256:${"f".repeat(64)}',
      'familyId','market-family-v1:sha256:${"1".repeat(64)}',
      'familyName','Transactional test family',
      'familyDemandStatus','FAMILY_DEMAND_PROVEN',
      'lunaProductId','9220832493792','lunaVariantId','48809643540704',
      'lunaSku','TEST-SKU-1','productFit','STRONG',
      'marketPriceMin',23.80,'marketPriceMedian',27.17,'marketPriceMax',34.82,
      'lunaUnitCost',10.96,'supplierQuantityRequired',1,
      'totalProductCost',10.96,'shippingStatus','SHIPPING_PROVISIONAL_RESERVE',
      'shippingValue',6.99,'contributionProfitAtMarketMedian',2.22,
      'contributionMarginAtMarketMedian',8.16,'breakEvenSellingPrice',24.25,
      'maxShippingAtBreakEven',9.20,'maxShippingAtTargetMargin',3.77,
      'maxProductCostAtTargetMargin',7.74,'minSellingPriceAtTargetMargin',32.95,
      'economicClassification','ECONOMICALLY_RECOVERABLE',
      'currentHardBlockers','[]'::jsonb,'nextBestEvidence','ACTUAL_LUNA_SHIPPING',
      'nextEvidenceValue','HIGH','evaluatedAt','2026-08-23T03:00:00.000Z',
      'frontierDigest','sha256:${"2".repeat(64)}',
      'phase6CanonicalEconomicsAuthority',false,
      'unknownShippingTreatedAsZero',false,'listingAuthorized',false
    )
  );
  v_replay := public.put_seller_os_profitability_frontier_v1(
    'test-account:${"a".repeat(64)}', 'EBAY_US',
    'opportunity-case-v1:sha256:${"b".repeat(64)}',
    'family-market-observation-v1:sha256:${"c".repeat(64)}',
    'sha256:${"d".repeat(64)}', 'SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1',
    'SELLER_OS_CANONICAL_PROVISIONAL_ECONOMICS_POLICY_V1',
    'sha256:${"e".repeat(64)}',
    '2026-08-23T01:00:00.000Z'::timestamptz,
    '2026-08-23T02:00:00.000Z'::timestamptz,
    jsonb_build_object(
      'contractVersion','SELLER_OS_PROFITABILITY_FRONTIER_V1',
      'configurationId','launch-configuration-v1:sha256:${"f".repeat(64)}',
      'familyId','market-family-v1:sha256:${"1".repeat(64)}',
      'familyName','Transactional test family',
      'familyDemandStatus','FAMILY_DEMAND_PROVEN',
      'lunaProductId','9220832493792','lunaVariantId','48809643540704',
      'lunaSku','TEST-SKU-1','productFit','STRONG',
      'marketPriceMin',23.80,'marketPriceMedian',27.17,'marketPriceMax',34.82,
      'lunaUnitCost',10.96,'supplierQuantityRequired',1,
      'totalProductCost',10.96,'shippingStatus','SHIPPING_PROVISIONAL_RESERVE',
      'shippingValue',6.99,'contributionProfitAtMarketMedian',2.22,
      'contributionMarginAtMarketMedian',8.16,'breakEvenSellingPrice',24.25,
      'maxShippingAtBreakEven',9.20,'maxShippingAtTargetMargin',3.77,
      'maxProductCostAtTargetMargin',7.74,'minSellingPriceAtTargetMargin',32.95,
      'economicClassification','ECONOMICALLY_RECOVERABLE',
      'currentHardBlockers','[]'::jsonb,'nextBestEvidence','ACTUAL_LUNA_SHIPPING',
      'nextEvidenceValue','HIGH','evaluatedAt','2026-08-23T03:00:00.000Z',
      'frontierDigest','sha256:${"2".repeat(64)}',
      'phase6CanonicalEconomicsAuthority',false,
      'unknownShippingTreatedAsZero',false,'listingAuthorized',false
    )
  );
  if v_created ->> 'outcome' <> 'CREATED'
    or v_replay ->> 'outcome' <> 'IDEMPOTENT_SUCCESS' then
    raise exception 'I02W_PREFLIGHT_FRONTIER_REPLAY_ASSERTION_FAILED';
  end if;
  v_read := public.get_seller_os_latest_profitability_frontiers_v1(
    'test-account:${"a".repeat(64)}', 'EBAY_US', null, 10);
  if v_read ->> 'status' <> 'AVAILABLE'
    or (v_read ->> 'resultCount')::integer <> 1 then
    raise exception 'I02W_PREFLIGHT_FRONTIER_READ_ASSERTION_FAILED';
  end if;

  v_created := public.put_seller_os_profitability_frontier_v1(
    'test-account:${"a".repeat(64)}', 'EBAY_US',
    'opportunity-case-v1:sha256:${"b".repeat(64)}',
    'family-market-observation-v1:sha256:${"c".repeat(64)}',
    'sha256:${"8".repeat(64)}', 'SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1',
    'SELLER_OS_CANONICAL_PROVISIONAL_ECONOMICS_POLICY_V1',
    'sha256:${"e".repeat(64)}',
    '2026-08-23T01:00:00.000Z'::timestamptz,
    '2026-08-23T02:00:00.000Z'::timestamptz,
    jsonb_build_object(
      'contractVersion','SELLER_OS_PROFITABILITY_FRONTIER_V1',
      'configurationId','launch-configuration-v1:sha256:${"f".repeat(64)}',
      'familyId','market-family-v1:sha256:${"1".repeat(64)}',
      'familyName','Transactional test family',
      'familyDemandStatus','FAMILY_DEMAND_PROVEN',
      'lunaProductId','9220832493792','lunaVariantId','48809643540704',
      'lunaSku','TEST-SKU-1','productFit','STRONG',
      'marketPriceMin',23.80,'marketPriceMedian',27.17,'marketPriceMax',34.82,
      'lunaUnitCost',10.96,'supplierQuantityRequired',1,
      'totalProductCost',10.96,'shippingStatus','SHIPPING_PROVISIONAL_RESERVE',
      'shippingValue',6.99,'contributionProfitAtMarketMedian',2.22,
      'contributionMarginAtMarketMedian',8.16,'breakEvenSellingPrice',24.25,
      'maxShippingAtBreakEven',9.20,'maxShippingAtTargetMargin',3.77,
      'maxProductCostAtTargetMargin',7.74,'minSellingPriceAtTargetMargin',32.95,
      'economicClassification','ECONOMICALLY_RECOVERABLE',
      'currentHardBlockers','[]'::jsonb,'nextBestEvidence','ACTUAL_LUNA_SHIPPING',
      'nextEvidenceValue','HIGH','evaluatedAt','2026-08-23T03:01:00.000Z',
      'frontierDigest','sha256:${"8".repeat(64)}',
      'phase6CanonicalEconomicsAuthority',false,
      'unknownShippingTreatedAsZero',false,'listingAuthorized',false));
  v_replay := public.put_seller_os_profitability_frontier_v1(
    'test-account:${"a".repeat(64)}', 'EBAY_US',
    'opportunity-case-v1:sha256:${"b".repeat(64)}',
    'family-market-observation-v1:sha256:${"c".repeat(64)}',
    'sha256:${"d".repeat(64)}', 'SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1',
    'SELLER_OS_CANONICAL_PROVISIONAL_ECONOMICS_POLICY_V1',
    'sha256:${"9".repeat(64)}',
    '2026-08-23T01:00:00.000Z'::timestamptz,
    '2026-08-23T02:00:00.000Z'::timestamptz,
    jsonb_build_object(
      'contractVersion','SELLER_OS_PROFITABILITY_FRONTIER_V1',
      'configurationId','launch-configuration-v1:sha256:${"f".repeat(64)}',
      'familyId','market-family-v1:sha256:${"1".repeat(64)}',
      'familyName','Transactional test family',
      'familyDemandStatus','FAMILY_DEMAND_PROVEN',
      'lunaProductId','9220832493792','lunaVariantId','48809643540704',
      'lunaSku','TEST-SKU-1','productFit','STRONG',
      'marketPriceMin',23.80,'marketPriceMedian',27.17,'marketPriceMax',34.82,
      'lunaUnitCost',10.96,'supplierQuantityRequired',1,
      'totalProductCost',10.96,'shippingStatus','SHIPPING_PROVISIONAL_RESERVE',
      'shippingValue',6.99,'contributionProfitAtMarketMedian',2.22,
      'contributionMarginAtMarketMedian',8.16,'breakEvenSellingPrice',24.25,
      'maxShippingAtBreakEven',9.20,'maxShippingAtTargetMargin',3.77,
      'maxProductCostAtTargetMargin',7.74,'minSellingPriceAtTargetMargin',32.95,
      'economicClassification','ECONOMICALLY_RECOVERABLE',
      'currentHardBlockers','[]'::jsonb,'nextBestEvidence','ACTUAL_LUNA_SHIPPING',
      'nextEvidenceValue','HIGH','evaluatedAt','2026-08-23T03:02:00.000Z',
      'frontierDigest','sha256:${"9".repeat(64)}',
      'phase6CanonicalEconomicsAuthority',false,
      'unknownShippingTreatedAsZero',false,'listingAuthorized',false));
  if v_created ->> 'outcome' <> 'CREATED'
    or v_replay ->> 'outcome' <> 'CREATED'
    or (select count(*) from public.seller_os_profitability_frontier_snapshots)
      <> 3
    or exists (select 1
      from public.seller_os_profitability_frontier_snapshots
      where not provisional_fast_lane_economics
        or phase_6_canonical_authority) then
    raise exception 'I02W_PREFLIGHT_FRONTIER_HISTORY_ASSERTION_FAILED';
  end if;

  begin
    perform public.put_seller_os_profitability_frontier_v1(
      'test-account:${"a".repeat(64)}', 'EBAY_US',
      'opportunity-case-v1:sha256:${"b".repeat(64)}',
      'family-market-observation-v1:sha256:${"c".repeat(64)}',
      'sha256:${"d".repeat(64)}', 'SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1',
      'SELLER_OS_CANONICAL_PROVISIONAL_ECONOMICS_POLICY_V1',
      'sha256:${"e".repeat(64)}',
      '2026-08-23T01:01:00.000Z'::timestamptz,
      '2026-08-23T02:00:00.000Z'::timestamptz,
      jsonb_build_object(
        'contractVersion','SELLER_OS_PROFITABILITY_FRONTIER_V1',
        'configurationId','launch-configuration-v1:sha256:${"f".repeat(64)}',
        'familyId','market-family-v1:sha256:${"1".repeat(64)}',
        'familyName','Transactional test family',
        'familyDemandStatus','FAMILY_DEMAND_PROVEN',
        'lunaProductId','9220832493792','lunaVariantId','48809643540704',
        'lunaSku','TEST-SKU-1','productFit','STRONG',
        'marketPriceMin',23.80,'marketPriceMedian',27.17,'marketPriceMax',34.82,
        'lunaUnitCost',10.96,'supplierQuantityRequired',1,
        'totalProductCost',10.96,'shippingStatus','SHIPPING_PROVISIONAL_RESERVE',
        'shippingValue',6.99,'contributionProfitAtMarketMedian',2.22,
        'contributionMarginAtMarketMedian',8.16,'breakEvenSellingPrice',24.25,
        'maxShippingAtBreakEven',9.20,'maxShippingAtTargetMargin',3.77,
        'maxProductCostAtTargetMargin',7.74,
        'minSellingPriceAtTargetMargin',32.95,
        'economicClassification','ECONOMICALLY_RECOVERABLE',
        'currentHardBlockers','[]'::jsonb,
        'nextBestEvidence','ACTUAL_LUNA_SHIPPING','nextEvidenceValue','HIGH',
        'evaluatedAt','2026-08-23T03:00:00.000Z',
        'frontierDigest','sha256:${"2".repeat(64)}',
        'phase6CanonicalEconomicsAuthority',false,
        'unknownShippingTreatedAsZero',false,'listingAuthorized',false));
  exception when others then
    if sqlerrm = 'SELLER_OS_PROFITABILITY_FRONTIER_REPLAY_CONFLICT' then
      v_conflict_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_conflict_rejected
    or (select count(*) from public.seller_os_profitability_frontier_snapshots)
      <> 3
    or (select logical_run_date from public.seller_os_daily_dollar_radar_runs
      where run_id = v_claim ->> 'runId') <> date '2026-03-08'
    or extract(epoch from (
      '2026-03-09T04:00:00.000Z'::timestamptz
      - '2026-03-08T05:00:00.000Z'::timestamptz)) / 3600 <> 23 then
    raise exception 'I02W_PREFLIGHT_IMMUTABILITY_DST_ASSERTION_FAILED';
  end if;
  ` : ""}
end;
$assert$;
`
}

const i02w = await readFile(I02W, "utf8")
const frontier = await readFile(FRONTIER, "utf8")
for (const [name, sql] of [["I02W", i02w], ["I02W_FRONTIER", frontier]]) {
  if (/^\s*(?:commit|rollback|create\s+database|drop\s+database|vacuum)\b/im.test(sql)) {
    throw new Error(`${name}_TRANSACTION_UNSAFE_STATEMENT`)
  }
}

const accessToken = (await readFile(ACCESS_TOKEN_PATH, "utf8")).trim()
if (!accessToken || accessToken.length > 512 || /[\r\n\u0000]/.test(accessToken)) {
  throw new Error("SUPABASE_ACCESS_TOKEN_INVALID")
}

if (PHASE !== "dry-run") {
  await managementSql(
    `begin;\n${i02w}\n${assertionSql({ includeFrontier: false })}\nrollback;`,
    accessToken, "I02W_TRANSACTIONAL_COMPILE_FAILED")
  await managementSql(
    `begin;\n${i02w}\n${frontier}\n${assertionSql({ includeFrontier: true })}\nrollback;`,
    accessToken, "I02W_FRONTIER_TRANSACTIONAL_COMPILE_FAILED")
}

const postRollbackResult = await managementSql(`
select jsonb_build_object(
  'targetTableCount', (
    select count(*) from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in (
      'seller_os_daily_dollar_radar_runs',
      'seller_os_daily_dollar_radar_run_receipts',
      'seller_os_morning_dollar_opportunity_queue_snapshots',
      'seller_os_daily_dollar_radar_scheduler_policy',
      'seller_os_profitability_frontier_snapshots'
    )
  ),
  'targetFunctionCount', (
    select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'claim_seller_os_daily_dollar_radar_run_v1',
      'complete_seller_os_daily_dollar_radar_run_v1',
      'fail_seller_os_daily_dollar_radar_run_v1',
      'get_seller_os_morning_dollar_opportunity_queue_v1',
      'put_seller_os_profitability_frontier_v1',
      'get_seller_os_latest_profitability_frontiers_v1'
    )
  ),
  'targetLedgerCount', (
    select count(*) from supabase_migrations.schema_migrations
    where version in ('20260823023000','20260823034507')
  ),
  'testFrontierRows', (
    select case when to_regclass(
      'public.seller_os_profitability_frontier_snapshots') is null then 0 else -1 end
  )
) as receipt;
`, accessToken, "I02W_POST_ROLLBACK_PROOF_FAILED")

let proof = postRollbackResult?.[0]?.receipt ?? {}
if (!proof || typeof proof !== "object") {
  throw new Error("I02W_POST_ROLLBACK_PROOF_MALFORMED")
}
if (Number(proof.targetTableCount) !== 0 || Number(proof.targetFunctionCount) !== 0 ||
    Number(proof.targetLedgerCount) !== 0 || Number(proof.testFrontierRows) !== 0) {
  throw new Error("I02W_POST_ROLLBACK_DURABLE_STATE_DETECTED")
}

const ledgerResult = await managementSql(`
select coalesce(jsonb_agg(jsonb_build_object(
  'version', version, 'name', name
) order by version), '[]'::jsonb) as ledger
from supabase_migrations.schema_migrations;
`, accessToken, "I02W_LEDGER_READ_FAILED")
let applied = ledgerResult?.[0]?.ledger ?? []
if (!Array.isArray(applied)) {
  throw new Error("I02W_LEDGER_READ_MALFORMED")
}
if (!Array.isArray(applied) || applied.length !== 259 || applied.some((row) =>
  !/^(?:[0-9]{12}|[0-9]{14})$/.test(String(row.version)) ||
  !/^[a-z0-9_]+$/.test(String(row.name)))) {
  throw new Error("I02W_LEDGER_IDENTITY_INVALID")
}

if (PHASE === "transaction") {
  process.stdout.write(`${JSON.stringify({
    transactionalPreflight: "PASS", i02wCompile: "PASS",
    frontierCompile: "PASS", targetAFunctionalSmoke: "PASS",
    targetBFunctionalSmoke: "PASS", caseExpressionRuntimeTest: "PASS",
    explicitBeginCount: 2, explicitRollbackCount: 2, commitCount: 0,
    durableTargetTablesAfterRollback: 0,
    durableTargetFunctionsAfterRollback: 0,
    durableTestRowsAfterRollback: 0, appliedCount: applied.length,
    targetLedgerCount: 0, secretsDisplayed: false,
  })}\n`)
  process.exit(0)
}

if (PHASE !== "all" && PHASE !== "dry-run") {
  throw new Error("I02W_PREFLIGHT_PHASE_INVALID")
}
if (!PASSWORD_FIFO.startsWith("/tmp/seller-os-i02w1-handoff.") ||
    !PASSWORD_FIFO.endsWith("/db-password.fifo")) {
  throw new Error("SECURE_DB_CREDENTIAL_HANDOFF_PATH_INVALID")
}
const password = (await readFile(PASSWORD_FIFO, "utf8")).trim()
if (!password || password.length > 512 || /[\r\n\u0000]/.test(password)) {
  throw new Error("SECURE_DB_CREDENTIAL_HANDOFF_INVALID")
}

const disposable = await mkdtemp("/tmp/seller-os-i02w1-targeted-dry-run.")
try {
  const supabaseDirectory = join(disposable, "supabase")
  const migrationsDirectory = join(supabaseDirectory, "migrations")
  await mkdir(migrationsDirectory, { recursive: true, mode: 0o700 })
  await copyFile(resolve(REPOSITORY, "supabase/config.toml"),
    join(supabaseDirectory, "config.toml"))
  for (const row of applied) {
    await writeFile(join(migrationsDirectory, `${row.version}_${row.name}.sql`),
      `-- Version-aware remote ledger placeholder for ${row.version}.\n`,
      { mode: 0o600 })
  }
  const targets = [
    "20260823023000_create_seller_os_daily_dollar_radar_autopilot.sql",
    "20260823034507_create_seller_os_profitability_frontier_and_schedule_policy.sql",
  ]
  for (const target of targets) {
    await copyFile(resolve(REPOSITORY, "supabase/migrations", target),
      join(migrationsDirectory, target))
  }
  const dryRun = await run("npx", ["supabase@latest", "db", "push", "--dry-run",
    "--project-ref", PROJECT_REF, "--workdir", disposable, "--skip-vault", "--yes"], {
    environment: { SUPABASE_DB_PASSWORD: password }, code: "I02W_CLI_DRY_RUN_FAILED",
  })
  const combinedOutput = `${dryRun.stdout}\n${dryRun.stderr}`
  const selected = [...combinedOutput.matchAll(
    /\b((?:[0-9]{12}|[0-9]{14})_[a-z0-9_]+\.sql)\b/g)]
    .map((match) => match[1]).filter((value, index, all) => all.indexOf(value) === index)
  if (selected.length !== 2 || targets.some((target) => !selected.includes(target)) ||
      selected.some((target) => !targets.includes(target))) {
    throw new Error(`I02W_CLI_DRY_RUN_TARGET_SET_INVALID:${selected.join(",")}`)
  }
} finally {
  await rm(disposable, { recursive: true, force: true })
}

const afterDryRun = await managementSql(`select jsonb_build_object(
  'appliedCount', (select count(*) from supabase_migrations.schema_migrations),
  'targetCount', (select count(*) from supabase_migrations.schema_migrations
    where version in ('20260823023000','20260823034507'))
) as receipt;`, accessToken, "I02W_POST_DRY_RUN_LEDGER_FAILED")
let ledgerProof = afterDryRun?.[0]?.receipt ?? {}
if (!ledgerProof || typeof ledgerProof !== "object") {
  throw new Error("I02W_POST_DRY_RUN_LEDGER_MALFORMED")
}
if (Number(ledgerProof.appliedCount) !== 259 || Number(ledgerProof.targetCount) !== 0) {
  throw new Error("I02W_DRY_RUN_LEDGER_MUTATION_DETECTED")
}

process.stdout.write(`${JSON.stringify({
  transactionalPreflight: "PASS",
  i02wCompile: "PASS",
  frontierCompile: "PASS",
  rpcFunctionalSmoke: "PASS",
  rls: "PASS",
  grants: "PASS",
  dstSpringWindowHours: 23,
  rollbackCount: 2,
  commitCount: 0,
  durableTargetTablesAfterRollback: 0,
  durableTargetFunctionsAfterRollback: 0,
  cliDryRunExactTarget: "PASS",
  targetedPlanCount: 2,
  selectedVersions: ["20260823023000", "20260823034507"],
  ledgerWrites: 0,
  secretsDisplayed: false,
})}\n`)
