import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260913154500_manual_existing_certified_identity_resolution_v1.sql",
  import.meta.url,
), "utf8")
const route = readFileSync(new URL(
  "../../app/api/admin/ebay/listings/register/route.ts",
  import.meta.url,
), "utf8")
const service = readFileSync(new URL(
  "./ebay-manual-listing-service.ts",
  import.meta.url,
), "utf8")

test("manual resolver is service-only, human-bound and checks official freshness", () => {
  assert.match(migration, /is_seller_os_service_role_request_v1\(\)/)
  assert.match(migration, /p_actor_user_id is null/)
  assert.match(migration, /p_observed_at < v_now - interval '15 minutes'/)
  assert.match(migration, /v_target\.listing_status is distinct from 'active'/)
  assert.match(migration, /v_target\.ebay_sku is distinct from p_observed_ebay_sku/)
  assert.match(migration, /for update/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(route, /auth\.userId/)
  assert.match(service, /readManualListingFromTradingApi\(input\.ebayItemId\)/)
})

test("manual resolver reuses only one latest exact certified Luna identity", () => {
  assert.match(migration, /v_source\.decision <> 'APPROVE_EXACT_LINKAGE'/)
  assert.match(migration, /v_source\.classification <> 'EXACT_UNIQUE_MATCH'/)
  assert.match(migration, /v_source\.linkage_mode <> 'SINGLE_COMPONENT'/)
  assert.match(migration, /jsonb_array_length\(v_source\.components\) <> 1/)
  assert.match(migration, /select max\(current_source\.decision_version\)/)
  assert.match(migration, /market_radar_latest_variants/)
  assert.match(migration, /v_identity_count <> 1/)
})

test("manual resolver never infers by title and writes no marketplace state", () => {
  assert.match(migration, /titleInferenceUsed', false/)
  assert.match(migration, /marketplaceWrites', 0/)
  assert.match(migration, /HUMAN_SELECTED_EXISTING_CERTIFIED_IDENTITY/)
  assert.doesNotMatch(migration, /lower\s*\(.*title|similarity\s*\(|levenshtein/i)
  assert.doesNotMatch(migration, /publishOffer|createOffer|ReviseItem|AddFixedPriceItem/)
  assert.match(route, /VINCULAR_IDENTIDAD_LUNA_CERTIFICADA/)
})

test("manual resolver persists append-only evidence and exact active lineage", () => {
  assert.match(migration, /insert into public\.seller_os_luna_linkage_review_candidates/)
  assert.match(migration, /insert into public\.seller_os_luna_linkage_decisions/)
  assert.match(migration, /update public\.ebay_active_listings/)
  assert.match(migration, /canonicalSupplierLineage/)
  assert.match(migration, /durableReadbackMatch', true/)
  assert.match(migration, /grant execute on function[\s\S]*to service_role/)
  assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/)
})
