import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const service = readFileSync(
  "lib/ebay/ebay-mayel-live-market-revalidation-v1.ts", "utf8")
const route = readFileSync(
  "app/api/admin/ebay/live-optimization-operator/route.ts", "utf8")
const runner = readFileSync(
  "app/admin/ebay/opportunity-queue/research/mayel-market-revalidation-runner.tsx",
  "utf8")
const workstation = readFileSync(
  "app/admin/mayel-visual-workstation.tsx", "utf8")
const migration = readFileSync(
  "supabase/migrations/20260906052145_mayel_live_market_revalidation_connector_v1.sql",
  "utf8")
const acquisitionMigration = readFileSync(
  "supabase/migrations/20260906063338_mayel_product_research_autonomous_acquisition_v1.sql",
  "utf8")
const acquisition = readFileSync(
  "app/admin/product-research-autonomous-acquisition-v1.tsx", "utf8")

test("LIVE listing revalidation extends the durable Product Research plan", () => {
  assert.match(migration, /alter column run_id drop not null/)
  assert.match(migration, /LIVE_LISTING_REVALIDATION/)
  assert.match(migration, /create_live_listing_product_research_plan_v1/)
  assert.match(migration, /subject_item_id/)
  assert.match(migration, /request_receipt_id/)
  assert.match(service, /LIVE_LISTING_RESEARCH_REQUIRED/)
  assert.match(service, /buildProductResearchQueryPlan\(\[candidate\]\)/)
  assert.match(service, /nextResearchPlanCreated: true/)
})

test("existing Product Research worker owns keywords, Sold and pagination", () => {
  assert.match(runner, /IMNOVA_EBAY_ONE_CLICK_RESEARCH_QUERY_V1/)
  assert.match(runner, /soldFilterAutomated !== true/)
  assert.match(runner, /paginationAutomated !== true/)
  assert.match(runner, /attestEbayOneClickResearchExtensionArtifact/)
  assert.match(route, /COMPLETE_MARKET_REVALIDATION/)
  assert.match(service, /importProductResearchBrowserCapture/)
  assert.match(service, /importOfficialSoldEvidence/)
  assert.match(service, /adaptMainSearchSoldCaptureForCanonicalImport/)
  assert.match(service, /soldEvidenceNoValidRowsDiagnostic/)
  assert.match(service, /NO_VALID_SOLD_EVIDENCE/)
})

test("authenticated browser worker acquires plans autonomously with one durable lease", () => {
  assert.match(acquisitionMigration,
    /claim_next_live_listing_product_research_v1/)
  assert.match(acquisitionMigration, /pg_advisory_xact_lock/)
  assert.match(acquisitionMigration, /for update of ledger skip locked/)
  assert.match(acquisitionMigration, /lease_expires_at/)
  assert.match(acquisitionMigration, /LIVE_LISTING_RESEARCH_REQUIRED/)
  assert.match(acquisition, /READ_AUTONOMOUS_RESEARCH_ACQUISITION/)
  assert.match(acquisition, /ACQUISITION_CADENCE_MS = 60_000/)
  assert.match(acquisition, /method: "POST"/)
  assert.doesNotMatch(acquisition, /method: "GET"/)
  assert.match(runner, /CLAIM_AUTONOMOUS_RESEARCH_PLAN/)
  assert.match(runner, /RELEASE_AUTONOMOUS_RESEARCH_PLAN/)
  assert.match(service, /workerCapabilityFresh: true/)
})

test("completion produces durable Radar, pricing, economics and Mayel readback", () => {
  assert.match(service, /last_radar_review_at: completedAt/)
  assert.match(service, /radarReingest: true/)
  assert.match(service, /marketPriceRecalculated: true/)
  assert.match(service, /economicsRecalculated: true/)
  assert.match(service, /mayelResultVisible: true/)
  assert.match(service, /marketPriceAuthority/)
  assert.match(workstation, /Seller OS elige queries, páginas y filtros Sold/)
})

test("dedicated durable status keeps revalidation independent from the aggregate feed", () => {
  assert.match(service, /readMayelLiveMarketRevalidationStatusV1/)
  assert.match(service, /state: "READY_TO_REQUEST"/)
  assert.match(service, /state: completed \? "COMPLETED"/)
  assert.match(service, /"WAITING_FOR_WORKER"/)
  assert.match(route, /READ_MARKET_REVALIDATION_STATUS/)
  assert.match(workstation, /marketRevalidationByItemId/)
  assert.match(workstation, /revalidationStatus\?\.connectorAvailable/)
  assert.match(workstation,
    /No hubo comparables exactos suficientes; Seller OS no fabricó un precio/)
})

test("revalidation keeps every marketplace and commercial write closed", () => {
  assert.doesNotMatch(service, /publishOffer|createOffer|updateOffer|reviseItem/i)
  assert.match(service, /marketplaceWrites: 0/)
  assert.match(service, /ownerActionRequired: false/)
  assert.match(service, /mayelManualResearchRequired: false/)
  assert.match(route, /priceWrites: 0/)
  assert.match(route, /promotionWrites: 0/)
})
