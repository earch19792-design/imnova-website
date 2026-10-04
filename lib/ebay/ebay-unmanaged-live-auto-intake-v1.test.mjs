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
const adminSync = readFileSync(new URL(
  "../../app/api/admin/ebay/active-listings/sync/route.ts",
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
const listingsPage = readFileSync(new URL(
  "../../app/admin/ebay/listings/page.tsx", import.meta.url,
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

test("admin sync links an exact manual LIVE listing in the same request", () => {
  assert.match(adminSync, /getEbayCommercialMonitorLiveReadonly/)
  assert.match(adminSync, /autoIngestUnmanagedEbayLiveListingsV1/)
  assert.match(adminSync, /currentLive\.discovery\.currentLiveListings/)
  assert.match(adminSync, /immediateLinkage:/)
  assert.match(adminSync, /ambiguousIdentityFailsClosed: true/)
  assert.match(adminSync, /titleInferenceUsed: false/)
  assert.match(adminSync, /ebayMarketplaceWrites: 0/)
  const autoLinkCall = adminSync.lastIndexOf(
    "autoIngestUnmanagedEbayLiveListingsV1(",
  )
  const protectionCall = adminSync.lastIndexOf(
    "reconcileActiveListingProtectionRisks(supabase)",
  )
  assert.ok(
    autoLinkCall >= 0 && autoLinkCall < protectionCall,
    "StockGuard protection must reconcile after immediate linkage",
  )
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

test("one bounded portfolio cycle prioritizes every exact match before relist recovery", () => {
  assert.match(service,
    /EBAY_UNMANAGED_LIVE_AUTO_INTAKE_MAXIMUM_PER_CYCLE = 50/)
  const exactFirst = service.indexOf(
    'row.classification === "EXACT_DETERMINISTIC_MATCH"',
    service.indexOf("const cycleOrder"),
  )
  const relistSecond = service.indexOf(
    'row.classification !== "EXACT_DETERMINISTIC_MATCH"',
    exactFirst + 1,
  )
  assert.ok(exactFirst >= 0 && relistSecond > exactFirst)
  assert.match(service, /status: "DEFERRED_TO_NEXT_CYCLE"/)
  assert.match(service, /attempted >= maximumAutoLinks/)
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
  assert.match(service, /seller_os_listing_product_link_authorities_v1/)
  assert.match(service, /seller_os_listing_identity_quarantines_v1/)
  assert.match(service, /lifecycle_state === "UNLINKED"/)
  assert.match(service, /lifecycle_state === "INVALIDATED"/)
  assert.match(service, /quarantine_state === "ACTIVE"/)
  assert.match(service, /ensureStockguardAuthorityFromDecisionP0/)
  assert.match(service, /UNMANAGED_LIVE_RELIST_STOCKGUARD_AUTHORITY_REQUIRED/)
  assert.match(service, /result\.linkAuthority\?\.stockguardEligible !== true/)
})

test("manual exact linkage enrolls StockGuard immediately and Admin Sync persists the current cases", () => {
  const ensureAuthority = manualService.indexOf(
    "ensureStockguardAuthorityFromDecisionP0",
    manualService.indexOf("export async function registerManualEbayListing"),
  )
  const refreshStock = manualService.indexOf(
    "refreshCertifiedManualListingStockGuard",
    ensureAuthority,
  )
  assert.ok(ensureAuthority >= 0 && refreshStock > ensureAuthority)
  assert.match(adminSync, /reconcileListingRegistry/)
  assert.match(adminSync, /action: "reconcile_current_live"/)
  assert.ok(adminSync.lastIndexOf("autoIngestUnmanagedEbayLiveListingsV1(") <
    adminSync.lastIndexOf("reconcileListingRegistry("))
})

test("a manual registration is repaired only when the official exact tuple is unchanged", () => {
  assert.match(service,
    /ebay_item_id,verification_status,opportunity_id,candidate_key,supplier_sku,supplier_variant_id/)
  assert.match(service, /const preliminaryClassifications = listings\.map/)
  assert.match(service, /const repairableManualItemIds = new Set/)
  for (const field of [
    "opportunity_id === candidate.opportunityId",
    "candidate_key === candidate.candidateKey",
    "supplier_sku === candidate.supplierSku",
    "supplier_variant_id === candidate.supplierVariantId",
  ]) assert.match(service, new RegExp(field.replaceAll(".", "\\.")))
  assert.match(service, /!repairableManualItemIds\.has\(link\.ebay_item_id\)/)
  assert.match(service, /manualRegistrationsRepaired:/)
  assert.ok(service.indexOf("prior decisions and quarantines were already added") <
    service.indexOf("const classifications = listings.map"))
})

test("an existing exact decision can repair only its missing StockGuard authority", () => {
  assert.match(service,
    /decision_id,ebay_item_id,ebay_sku,decision,luna_product_id,luna_variant_id,luna_sku/)
  assert.match(service, /const repairableDecisionByItemId = new Map/)
  for (const field of [
    'decision.decision === "APPROVE_EXACT_LINKAGE"',
    "decision.ebay_sku) === classification?.customLabel",
    "decision.luna_product_id) === candidate.supplierProductId",
    "decision.luna_variant_id) === candidate.supplierVariantId",
    "decision.luna_sku) === candidate.supplierSku",
  ]) assert.ok(service.includes(field), `missing exact decision guard: ${field}`)
  assert.match(service, /mode: "EXISTING_EXACT_DECISION"/)
  assert.match(service, /existingDecisionAuthoritiesRepaired:/)
  assert.match(service,
    /UNMANAGED_LIVE_EXISTING_DECISION_STOCKGUARD_AUTHORITY_REQUIRED/)
})

test("Active Sync cannot restore an UNLINKED, INVALIDATED or quarantined identity", () => {
  const conflictGate=service.indexOf("const classifications = listings.map")
  assert.ok(service.indexOf('authority.lifecycle_state === "UNLINKED"') < conflictGate)
  assert.ok(service.indexOf('authority.lifecycle_state === "INVALIDATED"') < conflictGate)
  assert.ok(service.indexOf('quarantine.quarantine_state === "ACTIVE"') < conflictGate)
  assert.match(service, /!conflictingItemIds\.has\(classification\.itemId\)/)
})

test("dashboard exposes only unresolved exceptions through the manual fallback", () => {
  assert.match(dashboard, /listingsNeedingLinkage\.length > 0/)
  assert.match(dashboard, /Listing necesita vinculación/)
  assert.match(dashboard, /No se usó similitud de título/)
  assert.match(dashboard, /id="seller-os-unlinked-listings"/)
  assert.match(dashboard, /role="alert"/)
  assert.match(dashboard, /border-red-500/)
  assert.match(dashboard, /listing\.identity\.itemId/)
  assert.match(dashboard, /listing\.identity\.title/)
  assert.match(dashboard, /listing\.identity\.customLabel/)
  assert.match(dashboard, /manualLinkageUrl\(listing\)/)
  assert.match(dashboard, /ebayItemId:/)
  assert.match(dashboard, /expectedSku/)
  assert.match(dashboard, /Resolver ahora/)
  assert.match(stockGuard, /href="\/admin\/ebay\/listings"/)
  assert.match(listingsPage, /RESOLVE IDENTITY/)
})

test("auto intake has zero marketplace writes and contains no eBay mutation primitive", () => {
  for (const source of [service, manualService, migration]) {
    assert.doesNotMatch(source,
      /publishOffer|withdrawOffer|createOffer|createOrReplaceInventoryItem|ReviseFixedPriceItem|EndFixedPriceItem/)
  }
  assert.match(service, /marketplaceWrites: 0 as const/)
  assert.match(migration, /No marketplace method is introduced or called here/)
})
