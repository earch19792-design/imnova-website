import assert from "node:assert/strict"
import test from "node:test"

import { buildMarketOpportunityResearchV1,
  marketEvidenceFromKeywordDemandReportV1 } from "./ebay-market-opportunity-research-v1.ts"

const now = "2026-08-11T12:00:00.000Z"
const request = {
  marketplace: "EBAY_US", seedType: "SEED_QUERY", seedValue: "Portable Neck Fan",
  requestedWindowDays: 90, researchIntent: "OPPORTUNITY_VALIDATION", queryBudget: 3,
  seedIdentity: { categoryId: "100", categoryName: "Indoor Air Quality & Fans",
    brand: null, gtin: null, mpn: null, model: null, packCount: null, size: null, color: null },
}
const evidence = (id, title, overrides = {}) => ({ evidenceId: id, itemId: `1234567890${id}`,
  title, categoryId: "100", categoryName: "Indoor Air Quality & Fans", brand: null,
  gtin: null, mpn: null, model: null, packCount: null, size: null, color: null,
  condition: "NEW", price: 20, currency: "USD", shippingCost: 0, imageUrl: null,
  itemSpecifics: {}, keywordSignals: [], activeListing: true, confirmedSold: false,
  confirmedSoldQuantity: null, saleObservedAt: null, observedAt: now,
  source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE", sourceVersion: "v1",
  evidenceCompleteness: "PARTIAL", sellerReferenceHash: null, ...overrides })

test("Browse evidence is active-market-only and never increments sold counters", () => {
  const mapped = marketEvidenceFromKeywordDemandReportV1({
    comparableEvidence: [{ comparableId: "v1|123456789012|0", evidenceSource:
      "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE", verifiedSoldQuantity: 999,
      title: "Portable Neck Fan", categoryId: "100", categoryName: "Fans", brand: null,
      gtin: null, mpn: null, model: null, lotSize: null, size: null, color: null,
      price: 20, currency: "USD", shippingCost: 0, imageUrl: null, localizedAspects: [],
      identifierExact: false, sellerUsername: null, lastSoldDate: null, itemEndDate: null }],
    evidenceAsOf: now, validationVersion: "v1",
  })
  assert.equal(mapped[0].source, "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE")
  assert.equal(mapped[0].confirmedSold, false)
  assert.equal(mapped[0].confirmedSoldQuantity, null)
  assert.equal(mapped[0].itemId, "123456789012")
})

test("category, product family and comparable cardinalities reconcile", () => {
  const result = buildMarketOpportunityResearchV1({ request, evidence: [
    evidence("12", "Portable Neck Fan Rechargeable"),
    evidence("13", "Wearable Portable Neck Fan"),
    evidence("14", "Portable Personal Cooling Fan"),
    evidence("15", "Desktop Fan", { categoryId: "200", categoryName: "Desk Fans" }),
  ], activeMarketStatus: "AVAILABLE", soldHistoryStatus: "UNAVAILABLE",
  paginationCoverage: "BOUNDED", observedAt: now })
  assert.notEqual(result.productFamilies[0].canonicalLabel,
    result.productFamilies[0].category.canonicalLabel)
  assert.equal(result.competition.competitionCount,
    result.competition.strongComparableCount + result.competition.familyComparableCount)
  assert.equal(result.competition.activeMarketResultCount, 4)
  assert.equal(result.demand.soldListingCount90d, null)
})

test("keyword quality penalizes generic fragments and spine avoids redundancy", () => {
  const result = buildMarketOpportunityResearchV1({ request, evidence: [
    evidence("12", "Portable Neck Fan Rechargeable Cooling"),
    evidence("13", "Portable Neck Fan Rechargeable Quiet"),
    evidence("14", "Wearable Portable Neck Fan Cooling"),
  ], activeMarketStatus: "AVAILABLE", soldHistoryStatus: "UNAVAILABLE",
  paginationCoverage: "BOUNDED", observedAt: now })
  const generic = result.keywordFamilies.find((row) => row.canonicalPhrase === "neck")
  const specific = result.keywordFamilies.find((row) => row.canonicalPhrase === "portable neck fan")
  if (generic && specific) assert.ok(specific.qualityScore > generic.qualityScore)
  for (const [index, term] of result.keywordSpine.terms.entries()) {
    const terms = term.split(" ")
    assert.equal(result.keywordSpine.terms.some((other, otherIndex) => otherIndex !== index &&
      (terms.every((token) => other.split(" ").includes(token)) ||
       other.split(" ").every((token) => terms.includes(token)))), false)
  }
  assert.equal(result.keywordSpine.evidenceRole, "MARKET_EVIDENCE_ONLY")
  assert.equal(result.opportunityCase.productCaseCreated, false)
})
