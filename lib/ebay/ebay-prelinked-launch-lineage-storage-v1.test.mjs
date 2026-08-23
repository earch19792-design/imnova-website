import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260822174339_create_seller_os_prelinked_launch_lineage.sql",
  import.meta.url,
), "utf8")
const runtimeFoundation = readFileSync(new URL(
  "./ebay-prelinked-listing-fast-lane-foundation-v1.ts",
  import.meta.url,
), "utf8")

function functionBody(name) {
  return migration.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`,
  ))?.[0] ?? ""
}

test("OP-LAUNCH-I01 stores candidates, immutable evidence, and append-only lineage", () => {
  for (const table of [
    "seller_os_prelinked_launch_candidates",
    "seller_os_prelinked_launch_evidence_packages",
    "seller_os_prelinked_launch_lineage_references",
  ]) assert.match(migration, new RegExp(`create table public\\.${table} \\(`))
  assert.match(migration,
    /before update or delete\s+on public\.seller_os_prelinked_launch_evidence_packages/)
  assert.match(migration,
    /before update or delete\s+on public\.seller_os_prelinked_launch_lineage_references/)
  assert.match(migration, /SELLER_OS_PRELINKED_LAUNCH_APPEND_ONLY/)
  assert.match(migration,
    /unique \(\s*launch_candidate_id, source_type, source_identity, evidence_digest\s*\)/)
})

test("configuration identity is the order-independent external Luna business grain", () => {
  assert.match(migration, /unique \(configuration_identity_digest\)/)
  assert.doesNotMatch(migration,
    /unique \(account_key, marketplace_id, configuration_identity_digest\)/)
  for (const key of [
    "componentOrdinal", "componentIdentityId", "lunaProductId",
    "lunaVariantId", "lunaSku", "supplierQuantityRequired",
    "identityEvidenceDigest", "supplierIdentityStatus",
    "p2LinkageId", "p2LinkageStatus",
  ]) assert.match(migration, new RegExp(`'${key}'`))
  for (const state of [
    "EXACT_PRELINKED", "UNPROVEN", "UNKNOWN", "UNAVAILABLE", "CONFLICT",
  ]) assert.match(migration, new RegExp(`'${state}'`))
  assert.match(migration, /lunaProductId', ''\) !~ '\^\[0-9\]\{1,30\}\$'/)
  assert.match(migration, /lunaVariantId', ''\) !~ '\^\[0-9\]\{1,30\}\$'/)
  assert.match(migration,
    /'launch-component-v1:sha256:' \|\| encode\(\s*extensions\.digest\(convert_to\(concat\(\s*'SELLER_OS_PRELINKED_LAUNCH_COMPONENT_IDENTITY_V1'/)
  assert.match(migration,
    /\(v_component -> 'p2LinkageId' = 'null'::jsonb\) <>\s*\(v_component -> 'p2LinkageStatus' = 'null'::jsonb\)/)
  assert.match(migration, /MULTI_COMPONENT_BOM/)

  const putEvidence = functionBody(
    "put_seller_os_prelinked_launch_evidence_package_v1")
  const identityProjection = putEvidence.match(
    /select string_agg\([\s\S]*?v_configuration_id :=[\s\S]*?;/,
  )?.[0] ?? ""
  assert.match(identityProjection, /SELLER_OS_PRELINKED_CONFIGURATION_V1/)
  assert.match(identityProjection, /p_offer_semantics ->> 'configurationMode'/)
  assert.match(identityProjection,
    /order by\s*\(component\.value ->> 'lunaProductId'\) collate "C",\s*\(component\.value ->> 'lunaVariantId'\) collate "C",\s*\(component\.value ->> 'supplierQuantityRequired'\)::integer/)
  assert.doesNotMatch(identityProjection,
    /accountKey|marketplaceId|productCase|opportunity|packCount|bundleSemantics/i)
  assert.match(putEvidence,
    /row_number\(\) over \(order by\s*\(value ->> 'lunaProductId'\) collate "C",\s*\(value ->> 'lunaVariantId'\) collate "C",\s*\(value ->> 'supplierQuantityRequired'\)::integer/)
})

test("candidate, launch, and package IDs share the exact cross-language framing", () => {
  const putCandidate = functionBody("put_seller_os_prelinked_launch_candidate_v1")
  const reserveSku = functionBody("reserve_seller_os_prelinked_launch_sku_v1")
  assert.match(putCandidate,
    /'SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_V1', E'\\n',\s*v_evidence\.configuration_id/)
  assert.match(putCandidate,
    /'SELLER_OS_PRELINKED_LAUNCH_V1', E'\\n',\s*v_evidence\.configuration_id/)
  assert.doesNotMatch(putCandidate.match(
    /v_candidate_id :=[\s\S]*?v_launch_id :=[\s\S]*?;/)?.[0] ?? "",
  /account_key|marketplace_id/i)
  assert.match(reserveSku,
    /'SELLER_OS_PRELINKED_LISTING_PACKAGE_V1', E'\\n',\s*v_candidate\.launch_candidate_id, E'\\n', v_attempt::text/)
  assert.match(runtimeFoundation,
    /`SELLER_OS_PRELINKED_LISTING_PACKAGE_V1\\n\$\{launchCandidateId\}\\n\$\{attempt\}`/)
  assert.match(runtimeFoundation,
    /\["SELLER_OS_PRELINKED_CONFIGURATION_V1", input\.configurationMode,/)
})

test("evidence packages preserve bounded per-item authority and normalize replay inputs", () => {
  const putEvidence = functionBody(
    "put_seller_os_prelinked_launch_evidence_package_v1")
  assert.match(migration, /evidence_items jsonb not null/)
  assert.match(putEvidence, /p_evidence_items jsonb/)
  for (const evidenceClass of [
    "SUPPLIER_IDENTITY", "MARKET_EVIDENCE", "ECONOMICS_EVIDENCE",
    "LISTING_READINESS", "PORTFOLIO_POLICY", "LEARNING_OUTCOME",
  ]) assert.match(migration, new RegExp(`'${evidenceClass}'`))
  for (const authority of [
    "OFFICIAL_EXTERNAL_FACT", "DIRECT_OBSERVATION", "DURABLY_PERSISTED_FACT",
    "DERIVED_FACT", "INFERENCE", "RECOMMENDATION", "UNPROVEN", "UNAVAILABLE",
  ]) assert.match(migration, new RegExp(`'${authority}'`))
  assert.match(migration,
    /v_subject ->> 'configurationIdentity' <> p_configuration_id/)
  assert.match(migration,
    /v_subject -> 'componentIdentityIds' <> v_expected_component_ids/)
  assert.match(putEvidence,
    /order by \(item\.value ->> 'evidenceClass'\) collate "C",\s*\(item\.value ->> 'reference'\) collate "C"/)
  assert.match(putEvidence,
    /string_agg\(line\.item_line, E'\\n'\s*order by line\.item_line collate "C"\)/)
  assert.match(putEvidence,
    /array_agg\(reference\.value order by reference\.value collate "C"\)/)
  assert.match(putEvidence,
    /array_agg\(blocker\.value\s*order by blocker\.value collate "C"\)/)
  assert.match(putEvidence,
    /array_agg\(limitation\.value\s*order by limitation\.value collate "C"\)/)
  assert.match(migration,
    /A claimed READY gate must be backed by exactly one fresh, AVAILABLE item/)
  assert.match(migration,
    /v_gate_item_count <> 1/)
  assert.match(migration,
    /v_gate_item ->> 'authorityClass' not in/)
  assert.match(migration,
    /v_gate_item ->> 'observedAt'[\s\S]*?p_evaluated_at/)
  assert.match(putEvidence,
    /SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_ID_V1/)
  assert.match(putEvidence,
    /v_account_key, E'\\n', p_marketplace_id, E'\\n',\s*v_configuration_id, E'\\n', p_p2_dependency_gate, E'\\n',\s*v_evidence_item_lines/)
  assert.match(putEvidence, /SELLER_OS_LAUNCH_EVIDENCE_DIGEST_V1/)
  assert.match(putEvidence,
    /v_evidence_package_id, E'\\n', v_evaluated_at_text, E'\\n',[\s\S]*?p_gate_statuses ->> 'SUPPLY'[\s\S]*?p_gate_statuses ->> 'MARKET'[\s\S]*?p_gate_statuses ->> 'ECONOMICS'[\s\S]*?p_gate_statuses ->> 'LISTING'/)
  assert.match(runtimeFoundation, /SELLER_OS_LAUNCH_EVIDENCE_PACKAGE_ID_V1/)
  assert.match(runtimeFoundation, /SELLER_OS_LAUNCH_EVIDENCE_DIGEST_V1/)
  assert.match(migration, /p2_dependency_gate text not null/)
  assert.match(migration, /evidence_evaluated_at timestamptz not null/)
})

test("schema supports future gates while current RPCs remain shadow-only", () => {
  assert.match(migration,
    /readiness in \('NOT_READY_TO_LIST', 'READY_TO_LIST'\)/)
  assert.match(migration,
    /launch_state in \(\s*'NEEDS_DATA', 'READY_TO_LIST', 'LISTING_PACKAGE_BOUND', 'PUBLISHED'\s*\)/)
  assert.match(migration, /hard_blockers, 0, 64/)
  const putEvidence = functionBody(
    "put_seller_os_prelinked_launch_evidence_package_v1")
  const putCandidate = functionBody("put_seller_os_prelinked_launch_candidate_v1")
  assert.match(putEvidence, /p_hard_blockers, 1, 64/)
  assert.doesNotMatch(putEvidence.match(/\([\s\S]*?\)\nreturns jsonb/)?.[0] ?? "",
    /p_readiness|p_publish/i)
  assert.match(putCandidate, /'NEEDS_DATA', true, false, false/)
  assert.match(putCandidate,
    /launch_state = 'NEEDS_DATA',[\s\S]*?human_approval_required = true,[\s\S]*?publish_allowed = false/)
  assert.match(migration,
    /future transitions require an independently gated adapter and migration/)
  assert.match(migration,
    /Pool membership\/rank intentionally remains a bounded derived read model/)
  assert.doesNotMatch(migration,
    /create table public\.seller_os_prelinked_launch_(?:pool|pool_membership)/)
  assert.doesNotMatch(migration, /create or replace function public\.[^(]*publish/i)
})

test("candidate identity survives guarded current-evidence refresh", () => {
  const putCandidate = functionBody("put_seller_os_prelinked_launch_candidate_v1")
  assert.match(putCandidate,
    /where configuration_identity_digest =\s*v_evidence\.configuration_identity_digest\s*for update/)
  assert.match(putCandidate,
    /SELLER_OS_PRELINKED_LAUNCH_STALE_EVIDENCE_REJECTED/)
  assert.match(putCandidate, /'outcome', 'CURRENT_EVIDENCE_UPDATED'/)
  assert.match(putCandidate,
    /current_evidence_package_id = v_evidence\.evidence_package_id/)
  const updateBlock = putCandidate.match(
    /update public\.seller_os_prelinked_launch_candidates[\s\S]*?returning \* into v_existing;/,
  )?.[0] ?? ""
  const updateAssignments = updateBlock.match(/set[\s\S]*?where/)?.[0] ?? ""
  assert.doesNotMatch(updateAssignments,
    /launch_candidate_id\s*=|configuration_identity_digest\s*=|launch_id\s*=/)
  assert.match(putCandidate, /'outcome', 'IDEMPOTENT_SUCCESS'/)
})

test("candidate preserves nullable lineage and conflict-proof future bindings", () => {
  for (const column of [
    "canonical_sku", "reserved_listing_package_id", "listing_package_id",
    "ebay_item_id", "p2_linkage_id", "outcome_tracking_id",
    "product_case_id", "product_case_version_id",
  ]) assert.match(migration, new RegExp(`\\b${column}\\b`))
  assert.match(migration,
    /\(\(product_case_id is null\) = \(product_case_version_id is null\)\)/)
  assert.match(migration,
    /listing_package_id uuid null\s+references public\.ebay_listing_packages\(id\)/)
  assert.match(migration,
    /listing_package_id is null\s+or listing_package_id = reserved_listing_package_id/)
  assert.match(migration,
    /\^launch-outcome-tracking-v1:sha256:\[0-9a-f\]\{64\}\$/)
  for (const index of [
    "seller_os_prelinked_launch_candidate_bound_package_unique",
    "seller_os_prelinked_launch_candidate_item_unique",
    "seller_os_prelinked_launch_candidate_p2_linkage_unique",
    "seller_os_prelinked_launch_candidate_outcome_unique",
  ]) assert.match(migration, new RegExp(`create unique index ${index}`))
  assert.match(migration, /PRODUCT_CASE_NON_AUTHORITATIVE/)
  assert.match(migration, /SHADOW_FOUNDATION_ONLY/)
})

test("canonical SKU is server allocated from the full compact package UUID", () => {
  const reserveSku = functionBody("reserve_seller_os_prelinked_launch_sku_v1")
  const signature = reserveSku.match(
    /create or replace function public\.reserve_seller_os_prelinked_launch_sku_v1\(([\s\S]*?)\)\nreturns jsonb/,
  )?.[1]
  assert.ok(signature)
  assert.match(signature, /p_launch_candidate_id text/)
  assert.match(signature, /p_reservation_idempotency_key text/)
  assert.doesNotMatch(signature, /p_sku|p_url|p_listing_package_id/i)
  assert.match(reserveSku, /for v_attempt in 0\.\.7 loop/)
  assert.match(reserveSku, /\), 'sha256'\), 'hex'\), 1, 32\)/)
  assert.doesNotMatch(reserveSku, /overlay|set_byte|version bit/i)
  assert.match(reserveSku,
    /v_canonical_sku := 'IMNOVA' \|\| upper\(replace\(\s*v_reserved_listing_package_id::text, '-', ''\s*\)\);/)
  assert.match(migration, /canonical_sku ~ '\^IMNOVA\[0-9A-F\]\{32\}\$'/)
  assert.match(migration, /length\(canonical_sku\) = 38/)
  assert.doesNotMatch(migration, /canonical_sku = 'IMNOVA-'/)
  assert.match(reserveSku, /pg_advisory_xact_lock/)
  assert.match(reserveSku, /IDEMPOTENT_SUCCESS/)
  assert.match(reserveSku, /RESERVATION_REPLAY_CONFLICT/)
})

test("reservation checks every authoritative and historical SKU surface", () => {
  const reserveSku = functionBody("reserve_seller_os_prelinked_launch_sku_v1")
  for (const source of [
    "public.ebay_active_listings",
    "public.ebay_listing_packages",
    "public.ebay_draft_only_execution_ledger",
    "public.ebay_authorized_listing_publications",
    "public.ebay_same_day_pilot_candidates",
    "public.ebay_same_day_pilot_handoffs",
    "public.ebay_manual_listing_links",
    "public.seller_os_prelinked_launch_candidates",
  ]) assert.match(reserveSku, new RegExp(source.replaceAll(".", "\\.")))
  assert.doesNotMatch(reserveSku, /listing\.listing_status\s*<>\s*'ended'/)
  assert.match(reserveSku, /to_jsonb\(pilot_candidate\) ->> 'reserved_sku'/)
  assert.match(reserveSku, /manual_link\.connector_ebay_sku/)
  assert.match(reserveSku, /\{draftConfiguration,sku\}/)
  assert.match(reserveSku, /\{package,customLabel\}/)
  assert.match(reserveSku, /handoff\.package_data ->> 'customLabel'/)
})

test("RPC-only writes are service-role gated behind forced RLS", () => {
  for (const table of [
    "seller_os_prelinked_launch_candidates",
    "seller_os_prelinked_launch_evidence_packages",
    "seller_os_prelinked_launch_lineage_references",
  ]) {
    assert.match(migration, new RegExp(
      `alter table public\\.${table}[\\s\\S]*?enable row level security;`))
    assert.match(migration, new RegExp(
      `alter table public\\.${table}[\\s\\S]*?force row level security;`))
    assert.match(migration, new RegExp(
      `revoke all on table public\\.${table}[\\s\\S]*?from public, anon, authenticated, service_role;`))
  }
  assert.match(migration, /public\.is_seller_os_service_role_request_v1\(\)/)
  assert.match(migration, /language plpgsql security definer/g)
  assert.match(migration,
    /put_seller_os_prelinked_launch_evidence_package_v1\(\s*text,text,text,jsonb,jsonb,text\[\],jsonb,jsonb,numeric,text,text\[\],\s*timestamptz,integer,text\[\]\s*\) to service_role/)
  assert.match(migration,
    /grant execute on function\s+public\.reserve_seller_os_prelinked_launch_sku_v1/)
  assert.doesNotMatch(migration,
    /grant\s+(?:insert|update|delete|all)\b[^;]*\bon table\b/i)
  assert.doesNotMatch(migration,
    /for (?:insert|update|delete) to (?:anon|authenticated|service_role)/i)
})

test("artifact cannot create downstream truth or marketplace side effects", () => {
  assert.doesNotMatch(migration,
    /(?:insert into|update|delete from)\s+public\.ebay_/i)
  assert.doesNotMatch(migration, /publishOffer|createOffer|createOrReplaceInventoryItem/)
  assert.doesNotMatch(migration, /https?:\/\//i)
  assert.doesNotMatch(migration, /marketplaceWrites|inventoryWrites|ebayWrites/i)
  assert.match(migration, /publish_allowed = false/)
  assert.match(migration,
    /Product Case and discovery queues are never product or launch truth/)
})
