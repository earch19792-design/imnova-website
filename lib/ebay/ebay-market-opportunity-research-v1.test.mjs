import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  EBAY_MARKET_RESEARCH_SOURCE_CAPABILITIES_V1,
  buildMarketOpportunityResearchV1,
  classifyMarketComparableV1,
  normalizeMarketResearchRequestV1,
  parseManualMarketEvidenceV1,
} from "./ebay-market-opportunity-research-v1.ts"

const request = normalizeMarketResearchRequestV1({
  marketplace: "EBAY_US",
  seedType: "SEED_PRODUCT_TITLE",
  seedValue: "Acme portable rechargeable fan 2 pack",
  requestedWindowDays: 90,
  researchIntent: "OPPORTUNITY_VALIDATION",
  queryBudget: 3,
  seedIdentity: { categoryId: "123", brand: "Acme", model: "Breeze", packCount: 2 },
})

function evidence(overrides = {}) {
  return {
    evidenceId: "ev-1",
    itemId: "123456789012",
    title: "Acme portable rechargeable fan 2 pack",
    categoryId: "123",
    categoryName: "Portable Fans",
    brand: "Acme",
    gtin: null,
    mpn: null,
    model: "Breeze",
    packCount: 2,
    size: null,
    color: null,
    condition: "NEW",
    price: 29.99,
    currency: "USD",
    shippingCost: null,
    imageUrl: "https://i.ebayimg.com/images/g/example/s-l500.jpg",
    itemSpecifics: { Brand: "Acme", Model: "Breeze" },
    keywordSignals: [],
    activeListing: true,
    confirmedSold: false,
    confirmedSoldQuantity: null,
    saleObservedAt: null,
    observedAt: "2026-08-11T12:00:00.000Z",
    source: "EBAY_BROWSE_ACTIVE_LISTING",
    sourceVersion: "v1",
    evidenceCompleteness: "PARTIAL",
    sellerReferenceHash: null,
    ...overrides,
  }
}

const build = (rows, extra = {}) => buildMarketOpportunityResearchV1({
  request,
  evidence: rows,
  observedAt: "2026-08-11T12:00:00.000Z",
  activeMarketStatus: "AVAILABLE",
  soldHistoryStatus: rows.some((row) => row.confirmedSold) ? "PARTIAL" : "UNAVAILABLE",
  paginationCoverage: "BOUNDED_TEST_FIXTURE",
  sourceLimitations: [],
  ...extra,
})

test("source matrix fails closed for sold history and search volume", () => {
  const byCapability = Object.fromEntries(EBAY_MARKET_RESEARCH_SOURCE_CAPABILITIES_V1.map((row) => [row.capability, row]))
  assert.equal(byCapability.ACTIVE_MARKET_LISTINGS.status, "AVAILABLE")
  assert.notEqual(byCapability.SOLD_LISTINGS.status, "AVAILABLE")
  assert.notEqual(byCapability["90_DAY_SOLD_HISTORY"].status, "AVAILABLE")
  assert.equal(byCapability.SEARCH_VOLUME.status, "UNAVAILABLE")
})

test("strict comparable classifier preserves brand, pack and variant mismatches", () => {
  const brandMismatch = classifyMarketComparableV1(request, evidence({ brand: "Other" }))
  assert.notEqual(brandMismatch.classification, "EXACT_OR_STRONG_COMPARABLE")
  assert.ok(brandMismatch.mismatchAttributes.includes("BRAND_MISMATCH"))
  const packMismatch = classifyMarketComparableV1(request, evidence({ packCount: 1 }))
  assert.notEqual(packMismatch.classification, "EXACT_OR_STRONG_COMPARABLE")
  assert.ok(packMismatch.mismatchAttributes.includes("PACK_COUNT_MISMATCH"))
  const modelMismatch = classifyMarketComparableV1(request, evidence({ model: "Storm" }))
  assert.notEqual(modelMismatch.classification, "EXACT_OR_STRONG_COMPARABLE")
  assert.ok(modelMismatch.mismatchAttributes.includes("MODEL_MISMATCH"))
})

test("active evidence never becomes sold price, sold quantity, sell-through or fake history", () => {
  const research = build([evidence()])
  assert.equal(research.demand.soldListingCount90d, null)
  assert.equal(research.demand.soldQuantity90d, null)
  assert.equal(research.demand.sellThrough, null)
  assert.equal(research.demand.demand90d, "UNAVAILABLE")
  assert.equal(research.demand.context365d, "UNAVAILABLE")
  assert.equal(research.priceOpportunity.soldPrice, null)
  assert.equal(research.priceOpportunity.activeAskingPrice?.median, 29.99)
  assert.equal(research.opportunityScore.value, null)
  assert.equal(research.opportunityScore.status, "SCORE_UNPROVEN")
  assert.notEqual(research.decision.outcome, "ADVANCE")
})

test("verified sold evidence feeds transparent score components without inventing sell-through", () => {
  const sold = [0, 1, 2, 3].map((offset) => evidence({
    evidenceId: `sold-${offset}`,
    itemId: null,
    activeListing: false,
    confirmedSold: true,
    confirmedSoldQuantity: 1 + offset,
    price: 24 + offset,
    saleObservedAt: `2026-08-0${offset + 1}T12:00:00.000Z`,
    observedAt: `2026-08-0${offset + 1}T12:00:00.000Z`,
    source: "MANUAL_MARKET_EVIDENCE",
  }))
  const research = build([evidence(), ...sold])
  assert.equal(research.demand.soldListingCount90d, 4)
  assert.equal(research.demand.soldQuantity90d, 10)
  assert.equal(research.demand.sellThrough, null)
  assert.equal(Object.keys(research.opportunityScore.components).length, 8)
  const totalWeight = Object.values(research.opportunityScore.weights).reduce((sum, value) => sum + value, 0)
  assert.equal(Number(totalWeight.toFixed(2)), 1)
})

test("generated query stays bounded and is not evidence until observed", () => {
  const research = build([evidence(), evidence({ evidenceId: "ev-2", itemId: "223456789012" })])
  assert.ok(research.generatedQueries.length <= 3)
  assert.ok(research.generatedQueries.every((row) => row.classification === "GENERATED_RESEARCH_QUERY" && row.observed === false && row.marketEvidence === false))
})

test("manual adapter rejects buyer PII and preserves explicit source label", () => {
  const cleanCsv = "itemId,observedAt,quantitySold,price,shippingCost,brand,upc,title,packCount,unitCount,size,scent,condition,imageCount,fullPackVisible\n366543596425,2026-08-10T00:00:00.000Z,2,25.00,0,Acme,012345678905,Acme portable fan,2,2,standard,,New,4,true"
  const clean = parseManualMarketEvidenceV1({
    format: "CSV",
    sourceExportType: "EBAY_PRODUCT_RESEARCH_EXPORT",
    content: cleanCsv,
    now: new Date("2026-08-11T12:00:00.000Z"),
  })
  assert.equal(clean.source, "MANUAL_MARKET_EVIDENCE")
  assert.equal(clean.observations[0]?.source, "MANUAL_MARKET_EVIDENCE")
  assert.equal(clean.observations[0]?.confirmedSold, true)
  assert.throws(() => parseManualMarketEvidenceV1({
    format: "CSV",
    sourceExportType: "EBAY_SELLER_HUB_EXPORT",
    content: `${cleanCsv.split("\n")[0]},buyerEmail\n${cleanCsv.split("\n")[1]},buyer@example.com`,
    now: new Date("2026-08-11T12:00:00.000Z"),
  }), /PII|FORBIDDEN/)
})

test("identical normalized evidence produces deterministic output", () => {
  const first = build([evidence({ evidenceId: "b" }), evidence({ evidenceId: "a", itemId: "223456789012" })])
  const second = build([evidence({ evidenceId: "a", itemId: "223456789012" }), evidence({ evidenceId: "b" })])
  assert.deepEqual(first, second)
})

test("protected route and UI remain read-only and Product Case disconnected", () => {
  const route = readFileSync(new URL("../../app/api/admin/ebay/market-research/route.ts", import.meta.url), "utf8")
  const page = readFileSync(new URL("../../app/admin/ebay/opportunity-queue/research/page.tsx", import.meta.url), "utf8")
  assert.match(route, /validateAdminApiRequest/)
  assert.match(route, /marketplaceWrites: 0/)
  assert.match(route, /productCaseMutations: 0/)
  assert.doesNotMatch(route, /createProductCase|\.insert\(|\.update\(|\.delete\(/)
  assert.doesNotMatch(page, /Revise listing|End listing|Create Product Case/)
})
