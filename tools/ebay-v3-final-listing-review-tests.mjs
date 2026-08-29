import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  "supabase/migrations/20260722053000_create_v3_final_listing_review_preview.sql",
  "utf8",
)
const reconciliationMigration = readFileSync(
  "supabase/migrations/20260722054500_reconcile_calypso_final_listing_review.sql",
  "utf8",
)
const gateSourceMigration = readFileSync(
  "supabase/migrations/20260722055000_fix_final_listing_gate_source_attribution.sql",
  "utf8",
)
const route = readFileSync(
  "app/api/admin/ebay/final-listing-review/route.ts",
  "utf8",
)
const workspace = readFileSync(
  "app/admin/ebay/listing-workspace/page.tsx",
  "utf8",
)
const visualAccess = readFileSync(
  "lib/ebay/reference-guided-visual-review-access.ts",
  "utf8",
)

test("final listing review is append-only, service-role only and creates no eBay object", () => {
  assert.match(migration, /final_listing_review_append_only/)
  assert.match(migration, /force row level security/i)
  assert.match(migration, /grant select, insert[\s\S]*to service_role/i)
  assert.match(migration, /authorization_enabled boolean not null check \(not authorization_enabled\)/)
  assert.match(migration, /inventory_item_created boolean not null check \(not inventory_item_created\)/)
  assert.match(migration, /offer_created boolean not null check \(not offer_created\)/)
  assert.match(migration, /ebay_writes integer not null check \(ebay_writes = 0\)/)
  assert.doesNotMatch(migration, /createOrReplaceInventoryItem|createOffer|publishOffer/)
})

test("seven selected V3 images are immutable, ordered and primary-first", () => {
  assert.match(migration, /jsonb_array_length\(v_final\.selected_assets\) <> 7/)
  assert.match(migration, /count\(distinct \(asset->>'position'\)::integer\) = 7/)
  assert.match(migration, /v_selected->0->>'assetRole'\) = 'PRIMARY_MAIN'/)
  assert.match(migration, /bool_and\(asset->>'status' = 'PASSED'\)/)
  assert.match(migration, /ebay-listing-image-staging/)
  assert.match(migration, /and not bucket\.public/)
})

test("canonical product gates reject contradictions and keep shipping facts unknown", () => {
  for (const expected of [
    "Calypso Basics",
    "08300",
    "036588083005",
    "White",
    "powder coated enamel on steel",
    "1.5",
    "20636",
  ]) {
    assert.ok(migration.includes(expected))
  }
  assert.match(migration, /'shippingWeight','UNKNOWN'/)
  assert.match(migration, /'packageDimensions','UNKNOWN'/)
  assert.match(migration, /PRESENTATION_AND_COPY_GUIDANCE_ONLY_NOT_PRODUCT_FACTS/)
  assert.match(migration, /length\(v_title\) between 1 and 80/)
})

test("Luna, economics, policy and location gates are independently fail-closed", () => {
  assert.match(migration, /interval '24 hours'/)
  assert.match(migration, /AVAILABLE_EXACT_QUANTITY/)
  assert.match(migration, /IMAGE_RIGHTS_CONFIRMATION_REQUIRED/)
  assert.match(migration, /PRICE_OR_MARGIN_INVALID/)
  assert.match(migration, /EBAY_BUSINESS_POLICIES_NOT_VERIFIED/)
  assert.match(migration, /EBAY_MERCHANT_LOCATION_NOT_VERIFIED/)
  assert.match(migration, /MANDATORY_LISTING_FIELD_MISSING/)
})

test("authenticated GET signs exact private objects and remains read-only", () => {
  assert.match(route, /validateAdminApiRequest/)
  assert.match(route, /createSignedUrl\(storagePath, 600\)/)
  assert.match(route, /\.eq\("created_by", validation\.userId\)/)
  assert.match(route, /Cache-Control": "private, no-store, max-age=0/)
  assert.match(route, /authorizationEnabled: false/)
  assert.match(route, /inventoryItemCreated: false/)
  assert.match(route, /offerCreated: false/)
})

test("workspace shows COMPLETED, seven previews and one publication control in final state", () => {
  assert.match(workspace, /Visual Strategy V3 · COMPLETED/)
  assert.match(workspace, /Conjunto final bloqueado · 7\/7 PASSED/)
  assert.match(workspace, /v3FinalListingReviewCanonicalReady/)
  assert.match(visualAccess, /input\.generationControlsHidden === true/)
  assert.match(visualAccess, /images\.length === V3_FINAL_ASSET_ROLES\.length/)
  assert.match(workspace, /Inventory Item y Offer todavía no existen/)
  assert.match(workspace, /Inventory Item \+ Offer UNPUBLISHED creados y verificados/)
  assert.match(workspace, /Ejecución registrada · fase/)
  assert.match(workspace, /data-v3-one-click-publication/)
  assert.match(workspace, /PUBLICAR EN EBAY/)
  assert.match(workspace,
    /!finalReviewCompleted && !listingReadyUi\.listingReady && <div className="fixed/)
  assert.match(workspace, /FINAL_LISTING_REVIEW persistente/)
})

test("reconciliation uses only the atomic V3 final selection for the visual gate", () => {
  assert.match(reconciliationMigration,
    /V3_FINAL_ATOMIC_SELECTION:ebay_reference_guided_position_6_extraordinary_human_verdict_events\.selected_assets/)
  assert.match(reconciliationMigration, /legacy_v2_visual_blockers_active boolean not null check \(not legacy_v2_visual_blockers_active\)/)
  assert.match(reconciliationMigration,
    /legacyV2VisualBlockersActive'[\s\S]*'false'::jsonb/)
  assert.match(visualAccess, /input\.visualPhase === "COMPLETED"/)
  assert.match(visualAccess, /blockers\.length === 0/)
  assert.match(workspace, /visibleWorkspaceGateBlockers/)
})

test("exact title and taxonomy-normalized exact facts are persisted without eBay writes", () => {
  const title =
    "Calypso Basics by Reston Lloyd 1.5 Qt Powder Coated Enamel Colander White"
  assert.equal([...title].length, 73)
  assert.ok(reconciliationMigration.includes(title))
  for (const fact of [
    "Calypso Basics",
    "08300",
    "Colander",
    "White",
    "powder coated enamel on steel",
    "1.5 Quart",
    "036588083005",
  ]) assert.ok(reconciliationMigration.includes(fact))
  assert.match(reconciliationMigration,
    /EBAY_TAXONOMY_OFFICIAL_READONLY/)
  assert.match(reconciliationMigration, /inventory_item_created boolean not null check \(not inventory_item_created\)/)
  assert.match(reconciliationMigration, /offer_created boolean not null check \(not offer_created\)/)
  assert.match(reconciliationMigration, /ebay_writes integer not null check \(ebay_writes = 0\)/)
  assert.doesNotMatch(reconciliationMigration,
    /createOrReplaceInventoryItem|createOffer|publishOffer/)
})

test("official taxonomy is GET-only and the UI never shows it as unqueried after final review", () => {
  assert.match(route, /getEbayTaxonomyListingIntelligence/)
  assert.match(route, /allowTitleSuggestionFallback: false/)
  assert.match(route, /taxonomy: taxonomySummary\(taxonomy\)/)
  assert.match(workspace,
    /finalReviewTaxonomy\.status \?\? finalListingReview\?\.taxonomy\?\.status/)
  assert.match(workspace, /APPROVED_BY_HUMAN/)
})

test("opportunity and demand states are reconciled without synthetic completion", () => {
  assert.match(reconciliationMigration,
    /CURRENT_CANDIDATE_READY_LEGACY_QUEUE_GATES_SUPERSEDED/)
  assert.match(reconciliationMigration,
    /CONTROLLED_TEST_APPROVED_WITH_INSUFFICIENT_EQUIVALENT_MARKET_DATA/)
  assert.match(reconciliationMigration, /'syntheticCompletionUsed',false/)
  assert.match(reconciliationMigration,
    /controlledExploratoryTestApproved' = 'true'/)
  assert.match(reconciliationMigration, /operatorPriceApproved' = 'true'/)
})

test("package preparation projects only canonical readiness", () => {
  assert.match(reconciliationMigration, /'percent',100/)
  assert.match(reconciliationMigration, /'gateDetails',v_gate_details/)
  assert.match(workspace,
    /data-preparation-v3-source="CANONICAL_DRAFT_ONLY_READINESS"/)
  assert.match(workspace, /listingReadyUi\.preparationPercent/)
  const preparationStart = workspace.indexOf(
    '<section className="rounded-3xl border border-amber-200/20',
  )
  const preparationEnd = workspace.indexOf(
    "{opportunity && listingPackage && !finalReviewCompleted",
    preparationStart,
  )
  const preparation = workspace.slice(preparationStart, preparationEnd)
  assert.doesNotMatch(preparation, /listingPackage\.readiness/)
  assert.doesNotMatch(preparation, /finalReviewGateDetails\.map/)
  assert.doesNotMatch(preparation, /humanWorkspaceBlocker\(/)
  assert.match(workspace, /esta tarjeta no ejecuta escrituras/)
})

test("gate sources are corrected append-only with explicit V3, candidate and market mappings", () => {
  assert.match(gateSourceMigration,
    /PERSISTED_GATE_SOURCE_ATTRIBUTION_FIX/)
  assert.match(gateSourceMigration,
    /visualFinalSetAtomic','legacyV2VisualBlockersInactive'/)
  assert.match(gateSourceMigration,
    /opportunityValidationCurrent'[\s\S]*v_gate_sources->>'opportunity'/)
  assert.match(gateSourceMigration,
    /marketDemandControlledRouteValid'[\s\S]*v_gate_sources->>'marketDemand'/)
  assert.match(gateSourceMigration,
    /before update or delete/)
  assert.match(gateSourceMigration, /provider_calls_snapshot,ebay_writes,production_changed/)
  assert.doesNotMatch(gateSourceMigration,
    /createOrReplaceInventoryItem|createOffer|publishOffer/)
})
