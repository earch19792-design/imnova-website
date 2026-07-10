import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildEbayLunaPortexMatchEnrichmentReport,
  buildEbayLunaPortexMatchInput,
  buildLunaMatchRouteRecommendation,
  buildMarketObservedDimensionsPackage,
  buildSupplierConfirmedDimensionsAssessment,
  normalizeEbayDetectedPackSizes,
  summarizeEbayLunaPortexMatchEnrichment,
} from "../lib/ebay/ebay-luna-portex-match-enrichment.ts";

const fixturePath = "tools/fixtures/ebay-luna-portex-match-enrichment-v1.json";
const modulePath = "lib/ebay/ebay-luna-portex-match-enrichment.ts";
const cliPath = "tools/ebay-luna-portex-match-enrichment-dry-run.mjs";
const docPath = "docs/ebay-pro-isolation/EBAY_LUNA_PORTEX_MATCH_ENRICHMENT_B2A_LUNA_MATCH_V1.md";
const fixtureSource = readFileSync(fixturePath, "utf8");
const moduleSource = readFileSync(modulePath, "utf8");
const cliSource = readFileSync(cliPath, "utf8");
const docSource = readFileSync(docPath, "utf8");
const fixture = JSON.parse(fixtureSource);

test("fixture has expected status and safety boundaries", () => {
  assert.equal(fixture.status, "EBAY_LUNA_PORTEX_MATCH_ENRICHMENT_READY");
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

test("warehouse uses alias and files contain no street-level address", () => {
  assert.equal(fixture.warehouse.warehouseAlias, "LUNA_PORTEX_BOCA_RATON");
  assert.equal(fixture.warehouse.fullWarehouseStreetAddressCommitted, false);
  const combined = `${fixtureSource}\n${moduleSource}\n${cliSource}\n${docSource}`;
  assert.doesNotMatch(combined, /streetAddress\s*[:=]|addressLine|fullAddress/i);
});

test("pack size zero is removed and never becomes dominant", () => {
  const result = normalizeEbayDetectedPackSizes([20, 6, 0, 2, 10, 1, -1, 6]);
  assert.deepEqual(result.rawPackSizesDetected, [20, 6, 0, 2, 10, 1, -1, 6]);
  assert.deepEqual(result.normalizedPackSizesDetected, [20, 6, 2, 10, 1]);
  assert.deepEqual(result.invalidPackSizesRemoved, [0, -1]);
  assert.equal(result.normalizedPackSizesDetected.includes(0), false);
});

test("market dimensions remain reference-only and distinct from supplier confirmation", () => {
  const input = buildEbayLunaPortexMatchInput(fixture);
  const market = buildMarketObservedDimensionsPackage(input);
  const supplier = buildSupplierConfirmedDimensionsAssessment(input);
  assert.equal(market.referenceOnly, true);
  assert.equal(market.supplierConfirmedDimensions, false);
  assert.equal(supplier.supplierDimensionsKnown, false);
  assert.equal(supplier.marketObservedDataUsedAsSupplierTruth, false);
});

function confirmedSupplier(overrides = {}) {
  return {
    ...fixture.lunaPortexCandidateData,
    matchStatus: "CONFIRMED", matchConfidence: 0.95, sku: "LP-CC20",
    cost: 0.32, quantityAvailable: 200, availablePackSizes: [1, 6, 10, 20],
    color: "Black", material: "Silicone", weight: { value: 6, unit: "oz" },
    dimensions: { length: 8, width: 6, height: 2, unit: "in" }, imageAvailable: true,
    estimatedShippingCost: 4.25, humanApprovalConfirmed: true, accountRiskKnown: false,
    ...overrides,
  };
}

test("missing Luna match routes first to NEED_LUNA_MATCH", () => {
  const report = buildEbayLunaPortexMatchEnrichmentReport(fixture);
  assert.equal(report.supplierConfirmedProductMatch, false);
  assert.equal(report.canProceedToB2Run, false);
  assert.equal(report.nextRecommendedRoute, "NEED_LUNA_MATCH");
});

test("missing supplier pack quantity routes to pack confirmation", () => {
  const report = buildEbayLunaPortexMatchEnrichmentReport(fixture, confirmedSupplier({ quantityAvailable: "runtime_required", availablePackSizes: "runtime_required" }));
  assert.equal(report.nextRecommendedRoute, "NEED_LUNA_PACK_QUANTITY_CONFIRMATION");
});

test("missing supplier dimensions routes to dimensions", () => {
  const report = buildEbayLunaPortexMatchEnrichmentReport(fixture, confirmedSupplier({ weight: "runtime_required", dimensions: "runtime_required" }));
  assert.equal(report.nextRecommendedRoute, "NEED_SUPPLIER_DIMENSIONS");
});

test("missing supplier image routes to image", () => {
  const report = buildEbayLunaPortexMatchEnrichmentReport(fixture, confirmedSupplier({ imageAvailable: "runtime_required" }));
  assert.equal(report.nextRecommendedRoute, "NEED_SUPPLIER_IMAGE");
});

test("complete supplier data and approval can recommend B2-RUN without publishing", () => {
  const report = buildEbayLunaPortexMatchEnrichmentReport(fixture, confirmedSupplier());
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-B2-RUN");
  assert.equal(report.canProceedToB2Run, true);
  assert.equal(report.canPublish, false);
  assert.equal(report.recommendedPackSize, 20);
});

test("high account or product risk routes to hold", () => {
  const input = buildEbayLunaPortexMatchInput(fixture, confirmedSupplier({ accountRiskKnown: true }));
  assert.equal(buildLunaMatchRouteRecommendation(input).nextRecommendedRoute, "EBAY-RESUME-HOLD");
});

test("pure module and CLI have no environment, network, database, or writes", () => {
  const prohibited = [
    "process" + ".env", "fetch" + "(", "create" + "Client", ".fr" + "om(",
    ".ins" + "ert(", ".upd" + "ate(", ".ups" + "ert(", "write" + "File",
    "append" + "File", "create" + "WriteStream",
  ];
  for (const marker of prohibited) {
    assert.equal(moduleSource.includes(marker), false, marker);
    assert.equal(cliSource.includes(marker), false, marker);
  }
});

test("files have no credential values, paused tracks, or publication execution", () => {
  const combined = `${fixtureSource}\n${moduleSource}\n${cliSource}\n${docSource}`;
  for (const marker of ["access" + "_token", "refresh" + "_token", "client" + "_secret", "authorization" + " code"]) {
    assert.equal(combined.toLowerCase().includes(marker.toLowerCase()), false, marker);
  }
  for (const marker of ["AMAZON_LISTING_" + "PACKAGE_BUILDER", "ebay-sandbox-" + "draft-listing", "EBAY_SANDBOX_" + "DRAFT_LISTING"]) {
    assert.equal(combined.includes(marker), false, marker);
  }
  const report = buildEbayLunaPortexMatchEnrichmentReport(fixture);
  assert.equal(report.canPublish, false);
  assert.equal(report.draftCreated, false);
  assert.equal(report.listingCreated, false);
  assert.equal(report.offerCreated, false);
  assert.equal(report.publicationExecuted, false);
});

test("CLI dry-run executes with expected numeric and normalized output", async () => {
  const messages = [];
  const originalLog = console.log;
  console.log = (message) => messages.push(String(message));
  try {
    await import(`./ebay-luna-portex-match-enrichment-dry-run.mjs?test=${Date.now()}`);
  } finally {
    console.log = originalLog;
  }
  const output = JSON.parse(messages.join("\n"));
  assert.equal(output.matchReportBuilt, true);
  assert.equal(typeof output.matchScore, "number");
  assert.ok(output.rawPackSizesDetected.includes(0));
  assert.equal(output.normalizedPackSizesDetected.includes(0), false);
  assert.ok(output.invalidPackSizesRemoved.includes(0));
  assert.equal(output.nextRecommendedRoute, "NEED_LUNA_MATCH");
  assert.equal(output.canPublish, false);
  assert.deepEqual(output, summarizeEbayLunaPortexMatchEnrichment(buildEbayLunaPortexMatchEnrichmentReport(fixture)));
});
