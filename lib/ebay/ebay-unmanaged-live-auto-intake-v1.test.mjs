import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const service = readFileSync(new URL(
  "./ebay-unmanaged-live-auto-intake-v1.ts", import.meta.url,
), "utf8")
const manualService = readFileSync(new URL(
  "./ebay-manual-listing-service.ts", import.meta.url,
), "utf8")
const cron = readFileSync(new URL(
  "../../app/api/cron/ebay-active-listing-luna-monitor/route.ts",
  import.meta.url,
), "utf8")
const migration = readFileSync(new URL(
  "../../supabase/migrations/20260829042327_seller_os_auto_ingest_unmanaged_live_listings_v1.sql",
  import.meta.url,
), "utf8")
const dashboard = readFileSync(new URL(
  "../../app/admin/ebay/monitor/commercial-monitor-canonical-dashboard.tsx",
  import.meta.url,
), "utf8")
const stockGuard = readFileSync(new URL(
  "../../app/admin/ebay/stock-guard/page.tsx", import.meta.url,
), "utf8")

test("current LIVE sync invokes the shared manual LIVE intake without another scheduler", () => {
  assert.match(cron, /autoIngestUnmanagedEbayLiveListingsV1/)
  assert.match(cron, /live\.discovery\.currentLiveListings/)
  assert.match(service, /registerManualEbayListing\(supabase/)
  assert.match(service, /automatedDeterministic: true/)
  assert.doesNotMatch(migration, /create\s+table|create\s+type|pg_cron|cron\.schedule/i)
})

test("exact known lineage and exact Luna identity are deterministic zero-click matches", () => {
  for (const authority of [
    "EXACT_KNOWN_LINEAGE",
    "EXACT_LUNA_IDENTITY",
    "EXACT_DETERMINISTIC_MATCH",
  ]) assert.match(service, new RegExp(authority))
  assert.match(service, /humanClicks: 0 as const/)
  assert.match(service, /supplierLinkage: "CERTIFIED"/)
  assert.match(service, /result\.manualLiveLinkage\.mode/)
  assert.match(service, /result\.stockGuardRefresh/)
})

test("Product Truth and current exact Luna variant identity are both required", () => {
  assert.match(service, /productTruthExact\(opportunity\)/)
  assert.match(service, /currentLunaIdentityExact\(opportunity/)
  assert.match(service, /market_radar_latest_variants/)
  assert.match(service, /supplier_product_id,supplier_variant_id,sku/)
  assert.match(service, /UNMANAGED_LIVE_PRODUCT_TRUTH_OR_LUNA_IDENTITY_CONFLICT/)
})

test("ambiguous and conflicting identities fail closed and never use title", () => {
  assert.match(service, /AMBIGUOUS_MATCH/)
  assert.match(service, /CONFLICT/)
  assert.match(service, /UNMANAGED_LIVE_MULTIPLE_EXACT_IDENTITY_CANDIDATES/)
  assert.match(service, /titleInferenceUsed: false as const/)
  const classifier = service.slice(
    service.indexOf("export function classifyEbayUnmanagedLiveListingV1"),
    service.indexOf("export async function autoIngestUnmanagedEbayLiveListingsV1"),
  )
  assert.doesNotMatch(classifier, /listing\.title|levenshtein|fuzzy/i)
})

test("automatic durability has an explicit authority and cannot impersonate a human", () => {
  assert.match(migration, /DETERMINISTIC_EXACT_IDENTITY/)
  assert.match(migration, /actor_user_id is null/)
  assert.match(migration, /actor_user_id is not null[\s\S]*HUMAN_DECISION/)
  assert.match(migration,
    /OWNERSHIP_AND_DETERMINISTIC_IDENTITY_CONFIRMED_TRADING_READONLY/)
  assert.match(manualService, /automatedDeterministic/)
})

test("official ownership, duplicate guards, linkage modes and StockGuard remain shared", () => {
  assert.match(manualService, /verifyManualListingOwnershipReadonly/)
  assert.match(migration, /certify_ebay_manual_live_luna_linkage_v1/)
  assert.match(migration, /register_ebay_manual_listing_link_bound_core_v2/)
  assert.match(service, /seller_os_luna_linkage_decisions/)
  assert.match(service, /ebay_manual_listing_links/)
  assert.match(service, /manualLiveLinkage\.mode/)
})

test("dashboard exposes only unresolved exceptions through the manual fallback", () => {
  assert.match(dashboard, /listingsNeedingLinkage\.length > 0/)
  assert.match(dashboard, /Listing necesita vinculación/)
  assert.match(dashboard, /No se usó similitud de título/)
  assert.match(dashboard, /href="\/admin\/ebay\/listings\/register"/)
  assert.match(stockGuard, /needsLinkCount > 0/)
  assert.match(stockGuard, /Resolver/)
})

test("auto intake has zero marketplace writes and contains no eBay mutation primitive", () => {
  for (const source of [service, manualService, migration]) {
    assert.doesNotMatch(source,
      /publishOffer|withdrawOffer|createOffer|createOrReplaceInventoryItem|ReviseFixedPriceItem|EndFixedPriceItem/)
  }
  assert.match(service, /marketplaceWrites: 0 as const/)
  assert.match(migration, /No marketplace method is introduced or called here/)
})
