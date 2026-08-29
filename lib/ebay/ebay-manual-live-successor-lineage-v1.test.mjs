import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260829014500_manual_live_successor_lineage_handoff_v1.sql",
  import.meta.url,
), "utf8")
const modeMigration = readFileSync(new URL(
  "../../supabase/migrations/20260829025057_ebay_manual_live_linkage_modes_v1.sql",
  import.meta.url,
), "utf8")
const existingHandoff = readFileSync(new URL(
  "../../supabase/migrations/20260828195337_post_publish_luna_linkage_handoff_v1.sql",
  import.meta.url,
), "utf8")
const handoffContract = `${existingHandoff}\n${migration}`
const service = readFileSync(new URL(
  "./ebay-manual-listing-service.ts",
  import.meta.url,
), "utf8")
const route = readFileSync(new URL(
  "../../app/api/admin/ebay/listings/register/route.ts",
  import.meta.url,
), "utf8")
const page = readFileSync(new URL(
  "../../app/admin/ebay/listings/register/page.tsx",
  import.meta.url,
), "utf8")

test("manual LIVE successor reuses only existing registration and handoff contracts", () => {
  assert.match(migration,
    /register_ebay_manual_listing_link_canonical_core_v1/)
  assert.match(migration,
    /handoff_ebay_authorized_publication_luna_linkage_v1/)
  assert.doesNotMatch(migration, /create\s+table|create\s+type/i)
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?function/i)
  assert.doesNotMatch(route, /manual-live-successor|superseded/i)
})

test("exact compensated rearmed lineage is required before relink", () => {
  for (const predicate of [
    "publication.phase = 'preview_ready'",
    "publication.publish_attempt_count = 0",
    "publication.publish_recovery_count = 1",
    "approval.status = 'consumed'",
    "approval.revoked_at is null",
    "approval.payload_hash = execution.request_hash",
    "execution.phase = 'completed'",
    "execution.offer_id = publication.offer_id",
    "package.candidate_key = p_candidate_key",
    "old_active.listing_status = 'ended'",
  ]) assert.match(migration, new RegExp(predicate.replace(/[.*+?^${}()|[\]\\]/g,
    "\\$&")))
  assert.match(migration,
    /MANUAL_LIVE_SUCCESSOR_DUPLICATE_OR_HISTORY_MISMATCH/)
})

test("manual successor handoff uses durable Luna identity and never title or eBay SKU inference", () => {
  assert.match(migration, /'MANUAL_LIVE_SUCCESSOR'/)
  assert.match(handoffContract,
    /DURABLE_CANDIDATE_PACKAGE_PUBLICATION_LINEAGE/)
  assert.match(handoffContract, /'titleInferenceUsed', false/)
  assert.match(handoffContract, /'ebaySkuUsedAsSupplierIdentity', false/)
  assert.match(handoffContract,
    /seller_os_luna_linkage_decisions/)
})

test("old Offer publication becomes terminal and cannot be rearmed by its old predicate", () => {
  assert.match(migration, /set phase = 'terminal_failure'/)
  assert.match(migration,
    /last_error_code = 'SUPERSEDED_BY_MANUAL_LIVE_ITEM'/)
  assert.match(migration,
    /'SUPERSEDED_BY_MANUAL_LIVE_ITEM_' \|\| p_ebay_item_id/)
  assert.match(migration, /'supersededOfferId', publication.offer_id/)
  assert.doesNotMatch(migration,
    /EBAY_FINAL_PUBLICATION_MONITOR_PERSIST_FAILED/)
})

test("verified registration invokes normal StockGuard refresh without eBay writes", () => {
  assert.match(service, /reconcileSellerOsStockIdentityV1\(supabase/)
  assert.match(service, /decision !== "APPROVE_EXACT_LINKAGE"/)
  assert.match(service, /marketplaceWrites: 0 as const/)
  assert.doesNotMatch(service,
    /publishOffer|withdrawOffer|createOffer|createOrReplaceInventoryItem/)
  assert.doesNotMatch(migration,
    /publishOffer|withdrawOffer|createOffer|ReviseFixedPriceItem|EndFixedPriceItem/)
})

test("supplier stock refresh cannot mutate eBay price or quantity", () => {
  const refreshFunction = service.slice(
    service.indexOf("async function refreshCertifiedManualListingStockGuard"),
    service.indexOf("export async function registerManualEbayListing"),
  )
  assert.doesNotMatch(refreshFunction, /ebay_quantity|ebay_price/)
  assert.doesNotMatch(refreshFunction, /\.update\(|\.insert\(|\.delete\(/)
  assert.match(refreshFunction, /targetItemIds: \[input\.ebayItemId\]/)
  assert.match(refreshFunction, /\? "IN_STOCK_SIGNAL" as const/)
})

test("manual LIVE registration classifies both general linkage modes", () => {
  assert.match(modeMigration, /'AUTO_LINEAGE_SUCCESSOR'/)
  assert.match(modeMigration, /'NET_NEW_MANUAL_LIVE'/)
  assert.match(modeMigration,
    /certify_ebay_manual_live_luna_linkage_v1/)
  assert.match(service, /manualLiveLinkage/)
  assert.match(page, /AUTO_LINEAGE_SUCCESSOR/)
  assert.match(page, /NET_NEW_MANUAL_LIVE/)
  assert.doesNotMatch(modeMigration,
    /ITEM3525|366635285436|366633121948|247475747011/)
})

test("both modes require official ACTIVE identity and the shared duplicate guard", () => {
  for (const predicate of [
    "v_active.listing_status <> 'active'",
    "v_link.verification_status <> 'verified'",
    "v_link.connector_listing_status <> 'active'",
    "v_active.ebay_item_id is distinct from p_expected_listing_id",
    "v_active.ebay_sku is distinct from v_link.connector_ebay_sku",
    "v_custom_label_exact is distinct from true",
    "v_active.supplier_variant_id is distinct from",
    "v_active.supplier_sku is distinct from v_opportunity.supplier_sku",
    "competing.listing_status = 'active'",
  ]) assert.match(modeMigration, new RegExp(
    predicate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ))
  assert.match(modeMigration, /CURRENT_LUNA_IDENTITY_EXACT/)
  assert.match(modeMigration, /seller_os_luna_linkage_decisions/)
})

test("NET_NEW manual LIVE linkage does not inherit publication authorization gates", () => {
  const commonGate = modeMigration.slice(
    modeMigration.indexOf("if v_active.id is null"),
    modeMigration.indexOf("select publication.* into v_publication"),
  )
  assert.doesNotMatch(commonGate, /package.status|approval|offer_id/)
  assert.doesNotMatch(commonGate,
    /authorization.*productTruthDigest|approved_payload/s)
  assert.match(commonGate, /v_product_truth ->> 'evidenceDigest'/)
})

test("only AUTO_LINEAGE_SUCCESSOR retires the prior publication", () => {
  const retirement = modeMigration.slice(
    modeMigration.indexOf("if v_mode = 'AUTO_LINEAGE_SUCCESSOR' then"),
    modeMigration.indexOf("return jsonb_build_object("),
  )
  assert.match(retirement, /SUPERSEDED_BY_MANUAL_LIVE_ITEM/)
  assert.match(retirement, /supersededOfferId/)
  assert.match(retirement, /publication.phase = 'preview_ready'/)
  assert.doesNotMatch(retirement, /publishOffer|withdrawOffer|createOffer/)
})

test("manual linkage runs after exact Custom Label binding and bypasses automatic publication handoff", () => {
  assert.match(modeMigration,
    /MANUAL_LIVE_OLD_AUTOMATIC_HANDOFF_TARGET_MISSING/)
  assert.match(modeMigration,
    /perform public\.certify_ebay_manual_live_luna_linkage_v1/)
  assert.match(modeMigration,
    /if p_verification_status = 'verified' then/)
  assert.equal([
    ...modeMigration.matchAll(
      /perform public\.handoff_ebay_authorized_publication_luna_linkage_v1/g,
    ),
  ].length, 1, "the only automatic handoff reference must be the removed target")
})

test("manual linkage errors preserve the real safe RPC reason through the UI", () => {
  assert.match(service, /isSafeManualListingErrorCode/)
  assert.match(service, /MANUAL_LIVE_LINKAGE_IDENTITY_MISMATCH/)
  assert.match(route, /isSafeManualListingErrorCode/)
  assert.match(page,
    /MANUAL_LIVE_LINKAGE_IDENTITY_MISMATCH: Item ID, Custom Label/)
  assert.match(page,
    /MANUAL_LIVE_\|POST_PUBLISH_LUNA_LINEAGE_/)
})

test("general manual LIVE onboarding contains no marketplace operation", () => {
  for (const source of [modeMigration, service]) {
    assert.doesNotMatch(source,
      /publishOffer|withdrawOffer|createOffer|createOrReplaceInventoryItem|EndFixedPriceItem|ReviseFixedPriceItem/)
  }
  assert.match(modeMigration, /'marketplaceWrites', 0/)
  assert.match(service, /marketplaceWrites: 0 as const/)
})
