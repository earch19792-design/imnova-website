import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260822150720_create_seller_os_luna_linkage_approval_control_plane.sql",
  import.meta.url,
), "utf8")

test("P2-I01B artifact separates review evidence from append-only truth", () => {
  assert.match(migration,
    /create table public\.seller_os_luna_linkage_review_candidates \(/)
  assert.match(migration,
    /create table public\.seller_os_luna_linkage_decisions \(/)
  for (const column of [
    "decision_id", "ebay_item_id", "ebay_sku", "listing_title",
    "linkage_id", "luna_product_id", "luna_variant_id", "luna_sku",
    "components", "supplier_quantity_required", "evidence_references",
    "evidence_digest", "decision", "decision_version", "decision_at",
    "decision_reference", "contract_version", "classification",
    "evidence_observed_at", "account_key", "marketplace_id",
    "account_binding", "review_observed_at",
    "evidence_maximum_age_seconds", "identity_evidence_provenance",
    "evidence_freshness",
  ]) assert.match(migration, new RegExp(`\\b${column}\\b`))
  assert.doesNotMatch(migration, /\bmarket_radar_product_id\b/)
  assert.match(migration,
    /comment on table public\.seller_os_luna_linkage_decisions is\s+'Append-only/)
})

test("component envelope matches the canonical control-plane JSON", () => {
  for (const key of [
    "lunaProductId", "lunaVariantId", "lunaSku", "productTitle",
    "variantTitle", "supplierQuantityRequired", "quantityBasis",
    "variantPresence", "exactProductIdentity", "exactVariantIdentity",
    "exactSupplierSku", "structuredVariantAttributesComplete",
    "identityConflict",
  ]) assert.match(migration, new RegExp(`'${key}'`))
  for (const mode of [
    "SINGLE_COMPONENT", "SIMPLE_MULTIPLIER", "MULTI_COMPONENT_BOM",
    "UNRESOLVED",
  ]) assert.match(migration, new RegExp(`'${mode}'`))
  assert.match(migration,
    /are_seller_os_luna_linkage_components_approvable_v1/)
  assert.match(migration,
    /seller_os_luna_linkage_review_unresolved_shape_check/)
  assert.match(migration,
    /count\(distinct jsonb_build_array\(/)
  assert.match(migration,
    /lunaProductId'\) !~ '\^\[0-9\]\+\$'/)
  assert.match(migration,
    /lunaVariantId'\) !~ '\^\[0-9\]\+\$'/)
  assert.match(migration, /luna_product_id ~ '\^\[0-9\]\{1,30\}\$'/)
  assert.match(migration, /luna_variant_id ~ '\^\[0-9\]\{1,30\}\$'/)
  assert.match(migration,
    /SELLER_OS_LUNA_LINKAGE_UNRESOLVED_DECISION_NOT_ALLOWED/)
})

test("current canonical identity evidence is required only for approval", () => {
  for (const key of [
    "reviewObservedAt", "evidenceMaximumAgeSeconds",
    "identityEvidenceProvenance", "evidenceFreshness",
  ]) assert.match(migration, new RegExp(`'${key}'`))
  assert.match(migration, /evidence_maximum_age_seconds = 21600/)
  assert.match(migration, /evidence_freshness in \('CURRENT', 'STALE'\)/)
  assert.match(migration, /SELLER_OS_LUNA_IDENTITY_VERIFICATION_V1/)
  assert.match(migration, /'AVAILABLE'/)
  assert.match(migration, /'UNAVAILABLE'/)
  assert.match(migration, /'CANONICAL_SERVER_READ_IDENTITY_ONLY'/)
  assert.match(migration, /'NONE'/)
  assert.match(migration,
    /\^luna-identity-v1:sha256:\[0-9a-f\]\{64\}\$/)
  assert.match(migration,
    /not approval_eligible or \([\s\S]*?evidence_freshness = 'CURRENT'/)
  assert.match(migration,
    /cardinality\(conflict_signals\) = 0/)
  assert.match(migration,
    /'identityEvidenceProvenance', identity_evidence_provenance/)
})

test("review replacement is one bounded atomic set RPC", () => {
  const signature = migration.match(
    /create or replace function public\.replace_seller_os_luna_linkage_review_set_v1\(([\s\S]*?)\)\nreturns jsonb/,
  )?.[1]
  assert.ok(signature)
  for (const parameter of [
    "p_account_key text", "p_marketplace_id text",
    "p_current_cohort_id text", "p_review_set_id text",
    "p_contract_version text", "p_candidates jsonb",
  ]) assert.match(signature, new RegExp(parameter))
  assert.match(migration, /jsonb_array_length\(p_candidates\) not between 1 and 50/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /SELLER_OS_LUNA_LINKAGE_REVIEW_SET_REPLAY_CONFLICT/)
  assert.match(migration, /'outcome', 'IDEMPOTENT_SUCCESS'/)
  assert.match(migration,
    /where candidate\.review_set_id = p_review_set_id\s+and candidate\.review_candidate_id =\s+v_candidate ->> 'reviewCandidateId'/)
})

test("decision RPC binds only a current server-generated review candidate", () => {
  const signature = migration.match(
    /create or replace function public\.record_seller_os_luna_linkage_decision_v1\(([\s\S]*?)\)\nreturns jsonb/,
  )?.[1]
  assert.ok(signature)
  for (const parameter of [
    "p_review_candidate_id text", "p_review_set_id text",
    "p_current_cohort_id text", "p_ebay_item_id text",
    "p_evidence_digest text", "p_decision text",
    "p_decision_version integer", "p_decision_at timestamptz",
    "p_decision_reference text", "p_actor_user_id uuid",
  ]) assert.match(signature, new RegExp(parameter))
  assert.doesNotMatch(signature,
    /p_luna|p_components|p_supplier|p_url|p_evidence_references/i)
  assert.match(migration, /STALE_REVIEW_REJECTED/)
  assert.match(migration,
    /p_decision_at > v_candidate\.evidence_observed_at\s*\+ make_interval\(secs => v_candidate\.evidence_maximum_age_seconds\)/)
  assert.match(migration,
    /SELLER_OS_LUNA_LINKAGE_DECISION_CLOCK_INVALID/)
  assert.match(migration, /CONFLICT_REQUIRES_NEW_DECISION_VERSION/)
  assert.match(migration, /SELLER_OS_LUNA_LINKAGE_ADMIN_ACTOR_REQUIRED/)
  assert.match(migration,
    /decision_record\.decision_version = p_decision_version/)
  assert.match(migration,
    /select candidate\.account_key, candidate\.marketplace_id[\s\S]*?where candidate\.review_set_id = p_review_set_id\s+and candidate\.review_candidate_id = p_review_candidate_id/)
  assert.match(migration,
    /v_account_key \|\| ':' \|\| v_marketplace_id, 0/)
  assert.match(migration,
    /where candidate\.review_set_id = p_review_set_id\s+and candidate\.review_candidate_id = p_review_candidate_id\s+for update;/)
  assert.match(migration,
    /v_candidate\.review_observed_at,[\s\S]*?v_candidate\.evidence_maximum_age_seconds,[\s\S]*?v_candidate\.identity_evidence_provenance,[\s\S]*?v_candidate\.evidence_freshness/)
})

test("RLS and ACLs leave service role reads plus RPC-only writes", () => {
  for (const table of [
    "seller_os_luna_linkage_review_candidates",
    "seller_os_luna_linkage_decisions",
  ]) {
    assert.match(migration, new RegExp(
      `alter table public\\.${table}[^;]*enable row level security;`, "s"))
    assert.match(migration, new RegExp(
      `alter table public\\.${table}[^;]*force row level security;`, "s"))
    assert.match(migration, new RegExp(
      `revoke all on table public\\.${table}[\\s\\S]*?from public, anon, authenticated, service_role;`))
  }
  assert.doesNotMatch(migration,
    /grant\s+(?:insert|update|delete|all)\b[^;]*\bon table\b/i)
  assert.match(migration,
    /grant select on table public\.seller_os_luna_linkage_decisions to service_role;/)
  assert.match(migration,
    /grant execute on function public\.record_seller_os_luna_linkage_decision_v1/)
  for (const policy of [
    "seller_os_luna_linkage_review_rpc_owner_insert",
    "seller_os_luna_linkage_review_rpc_owner_read",
    "seller_os_luna_linkage_review_rpc_owner_retire",
    "seller_os_luna_linkage_decision_rpc_owner_insert",
    "seller_os_luna_linkage_decision_rpc_owner_read",
  ]) assert.match(migration, new RegExp(`create policy ${policy}`))
  assert.match(migration,
    /for insert to postgres\s+with check \(public\.is_seller_os_service_role_request_v1\(\)\);/)
  assert.match(migration,
    /for update to postgres\s+using \(public\.is_seller_os_service_role_request_v1\(\)\)\s+with check \(public\.is_seller_os_service_role_request_v1\(\)\);/)
  assert.match(migration,
    /for select to postgres\s+using \(public\.is_seller_os_service_role_request_v1\(\)\);/)
  assert.doesNotMatch(migration,
    /for (?:insert|update|delete) to (?:anon|authenticated|service_role)/i)
  assert.doesNotMatch(migration, /auth\.role\s*\(/)
  assert.match(migration, /request\.jwt\.claims/)
  assert.match(migration, /current_user = 'service_role'/)
})

test("immutable and safety boundaries fail closed", () => {
  assert.match(migration,
    /before update or delete on public\.seller_os_luna_linkage_decisions/)
  assert.match(migration, /SELLER_OS_LUNA_LINKAGE_DECISION_IMMUTABLE/)
  assert.match(migration, /'stockEvidenceUsed', false/)
  assert.match(migration, /'NOT_EVALUATED'/)
  assert.doesNotMatch(migration, /seller_os_luna_stock_check_jobs/)
  assert.doesNotMatch(migration,
    /(?:insert into|update|delete from)\s+public\.ebay_/i)
  assert.doesNotMatch(migration, /https?:\/\//i)
})
