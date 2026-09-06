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

test("revalidation keeps every marketplace and commercial write closed", () => {
  assert.doesNotMatch(service, /publishOffer|createOffer|updateOffer|reviseItem/i)
  assert.match(service, /marketplaceWrites: 0/)
  assert.match(service, /ownerActionRequired: false/)
  assert.match(service, /mayelManualResearchRequired: false/)
  assert.match(route, /priceWrites: 0/)
  assert.match(route, /promotionWrites: 0/)
})
