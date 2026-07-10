import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildEbayLunaCatalogIngestInput, buildEbayLunaCatalogIngestReport,
  buildLunaCatalogAutomatedMatchAssessment, buildLunaCatalogB2RunReadiness,
  buildLunaCatalogImageReadiness, buildLunaCatalogPackAvailabilityAssessment,
  buildLunaCatalogRiskAssessment, buildLunaCatalogShippingReadiness,
  normalizeLunaCatalog, normalizeLunaCatalogProduct, scoreLunaCatalogProductMatch,
  buildLunaCatalogMatchQueryFromEbayMarketData,
} from "../lib/ebay/ebay-luna-catalog-ingest.ts";

const fixturePath = "tools/fixtures/ebay-luna-catalog-ingest-v1.json";
const catalogPath = "tools/fixtures/luna-portex-catalog-sample-v1.json";
const modulePath = "lib/ebay/ebay-luna-catalog-ingest.ts";
const cliPath = "tools/ebay-luna-catalog-ingest-dry-run.mjs";
const docPath = "docs/ebay-pro-isolation/EBAY_LUNA_CATALOG_INGEST_B2A_LUNA_CATALOG_V1.md";
const fixtureSource = readFileSync(fixturePath, "utf8");
const catalogSource = readFileSync(catalogPath, "utf8");
const moduleSource = readFileSync(modulePath, "utf8");
const cliSource = readFileSync(cliPath, "utf8");
const docSource = readFileSync(docPath, "utf8");
const fixture = JSON.parse(fixtureSource);
const catalog = JSON.parse(catalogSource);

test("fixture has correct status and safety boundaries", () => {
  assert.equal(fixture.status, "EBAY_LUNA_CATALOG_INGEST_READY");
  assert.equal(fixture.production.offLimitsForWrites, true);
  assert.equal(fixture.main.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.ebayApi.usedInThisLoop, false);
  assert.equal(fixture.ebayWriteApi.usedInThisLoop, false);
  assert.equal(fixture.oauth.usedInThisLoop, false);
  assert.equal(fixture.tokenStorage.usedInThisLoop, false);
  assert.equal(fixture.draft.createdInThisLoop, false);
  assert.equal(fixture.listing.createdInThisLoop, false);
  assert.equal(fixture.offer.createdInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.imageGeneration.usedInThisLoop, false);
  assert.equal(fixture.scraper.usedInThisLoop, false);
  assert.equal(fixture.amazonTrack.touchedInThisLoop, false);
});

test("required columns cover supplier and fulfillment facts", () => {
  for (const column of ["sku", "productName", "cost", "stockAvailable", "packQuantity", "weight", "dimensions", "imageUrl"]) {
    assert.ok(fixture.requiredCatalogColumns.includes(column), column);
  }
});

test("catalog normalizes all four product classes", () => {
  const normalized = normalizeLunaCatalog(catalog);
  assert.equal(normalized.length, 4);
  assert.equal(normalized[0].packQuantity, 20);
  assert.equal(normalized[1].dimensions, null);
  assert.equal(normalized[2].category, "Kitchen Storage");
});

test("strong silicone organizer is highest automated match", () => {
  const input = buildEbayLunaCatalogIngestInput(fixture, catalog);
  const assessment = buildLunaCatalogAutomatedMatchAssessment(input);
  assert.equal(assessment.matchCandidatesEvaluated, 4);
  assert.equal(assessment.bestSupplierMatch.product.sku, "LP-SAMPLE-CC20");
  assert.ok(assessment.bestSupplierMatchScore >= 70);
  assert.equal(assessment.bestSupplierMatch.strongMatch, true);
});

test("partial match exposes missing image and dimensions", () => {
  const partial = normalizeLunaCatalogProduct(catalog[1]);
  assert.equal(buildLunaCatalogShippingReadiness(partial).shippingReadiness, "NEED_SUPPLIER_DIMENSIONS");
  assert.equal(buildLunaCatalogImageReadiness(partial).imageReadiness, "NEED_SUPPLIER_IMAGE");
});

test("unrelated product has a lower match score", () => {
  const input = buildEbayLunaCatalogIngestInput(fixture, catalog);
  const query = buildLunaCatalogMatchQueryFromEbayMarketData(input);
  const strong = scoreLunaCatalogProductMatch(query, normalizeLunaCatalogProduct(catalog[0]));
  const unrelated = scoreLunaCatalogProductMatch(query, normalizeLunaCatalogProduct(catalog[2]));
  assert.ok(strong.matchScore > unrelated.matchScore);
});

test("risky supplier product is rejected and routes to hold when selected", () => {
  const risky = normalizeLunaCatalogProduct(catalog[3]);
  assert.equal(buildLunaCatalogRiskAssessment(risky).riskLevel, "HIGH");
  const input = buildEbayLunaCatalogIngestInput({ ...fixture, realCatalogFileUsedInThisLoop: true, humanApprovalConfirmed: true }, [catalog[3]]);
  assert.equal(buildLunaCatalogB2RunReadiness(input).nextRecommendedRoute, "EBAY-RESUME-HOLD");
});

test("sample strong match never enables real B2-RUN", () => {
  const report = buildEbayLunaCatalogIngestReport(fixture, catalog);
  assert.equal(report.sampleMatchOnly, true);
  assert.equal(report.realCatalogFileUsed, false);
  assert.equal(report.canProceedToB2Run, false);
  assert.equal(report.nextRecommendedRoute, "NEED_REAL_LUNA_CATALOG_FILE");
  assert.equal(report.canPublish, false);
});

test("real complete catalog plus approval can enable B2-RUN", () => {
  const realFixture = { ...fixture, realCatalogFileUsedInThisLoop: true, localSampleCatalogUsed: false, humanApprovalConfirmed: true };
  const report = buildEbayLunaCatalogIngestReport(realFixture, [catalog[0]]);
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-B2-RUN");
  assert.equal(report.canProceedToB2Run, true);
  assert.equal(report.canPublish, false);
});

function reportForProduct(overrides) {
  const row = { ...catalog[0], ...overrides };
  const realFixture = { ...fixture, realCatalogFileUsedInThisLoop: true, localSampleCatalogUsed: false, humanApprovalConfirmed: true };
  return buildEbayLunaCatalogIngestReport(realFixture, [row]);
}

test("missing cost and stock block readiness", () => {
  assert.equal(reportForProduct({ cost: null }).canProceedToB2Run, false);
  assert.equal(reportForProduct({ stockAvailable: null }).canProceedToB2Run, false);
});

test("missing pack quantity routes to pack confirmation", () => {
  assert.equal(reportForProduct({ packQuantity: null }).nextRecommendedRoute, "NEED_LUNA_PACK_QUANTITY_CONFIRMATION");
});

test("missing dimensions routes to supplier dimensions", () => {
  assert.equal(reportForProduct({ dimensions: null }).nextRecommendedRoute, "NEED_SUPPLIER_DIMENSIONS");
});

test("missing authorized image routes to supplier image", () => {
  assert.equal(reportForProduct({ imageUrl: null }).nextRecommendedRoute, "NEED_SUPPLIER_IMAGE");
});

test("negative margin blocks and holds", () => {
  assert.equal(reportForProduct({ cost: 30 }).nextRecommendedRoute, "EBAY-RESUME-HOLD");
});

test("pack availability requires real stock for observed pack", () => {
  const input = buildEbayLunaCatalogIngestInput(fixture, catalog);
  const product = normalizeLunaCatalogProduct({ ...catalog[0], stockAvailable: 10 });
  assert.equal(buildLunaCatalogPackAvailabilityAssessment(input, product).lunaPackQuantityConfirmed, false);
});

test("module and CLI contain no environment, network, database, or writes", () => {
  const prohibited = ["process" + ".env", "fetch" + "(", "create" + "Client", ".fr" + "om(", ".ins" + "ert(", ".upd" + "ate(", ".ups" + "ert(", "write" + "File", "append" + "File"];
  for (const marker of prohibited) {
    assert.equal(moduleSource.includes(marker), false, marker);
    assert.equal(cliSource.includes(marker), false, marker);
  }
});

test("new files contain no credentials, street address, or paused tracks", () => {
  const combined = `${fixtureSource}\n${catalogSource}\n${moduleSource}\n${cliSource}\n${docSource}`;
  for (const marker of ["access" + "_token", "refresh" + "_token", "client" + "_secret", "authorization" + " code"]) assert.equal(combined.toLowerCase().includes(marker), false);
  assert.doesNotMatch(combined, /streetAddress\s*[:=]|addressLine|fullAddress/i);
  for (const marker of ["AMAZON_LISTING_" + "PACKAGE_BUILDER", "ebay-sandbox-" + "draft-listing", "EBAY_SANDBOX_" + "DRAFT_LISTING"]) assert.equal(combined.includes(marker), false);
});

test("CLI dry-run executes with sample-only route", async () => {
  const messages = [];
  const originalLog = console.log;
  console.log = (message) => messages.push(String(message));
  try { await import(`./ebay-luna-catalog-ingest-dry-run.mjs?test=${Date.now()}`); }
  finally { console.log = originalLog; }
  const output = JSON.parse(messages.join("\n"));
  assert.equal(output.catalogIngestReportBuilt, true);
  assert.ok(output.catalogProductsLoaded >= 4);
  assert.ok(output.bestSupplierMatchScore > 0);
  assert.equal(output.sampleMatchOnly, true);
  assert.equal(output.canProceedToB2Run, false);
  assert.equal(output.nextRecommendedRoute, "NEED_REAL_LUNA_CATALOG_FILE");
});
