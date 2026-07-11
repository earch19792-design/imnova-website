import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildEbayLunaCatalogRunnerInput,
  buildLocalCatalogFileGate,
  buildLunaCatalogLogicalSnapshot,
  buildLunaCatalogPrePublishGuard,
  buildLunaCatalogProductOperationalStates,
  buildRealLunaCatalogIngestReport,
  compareLunaCatalogSnapshots,
  detectCatalogFileType,
  parseLocalLunaCatalogCsv,
  parseLocalLunaCatalogJson,
  parseLocalLunaCatalogXlsxIfAvailable,
  sanitizeLunaCatalogRowsForReport,
} from "../lib/ebay/ebay-luna-catalog-runner.ts";

const fixturePath = "tools/fixtures/ebay-luna-catalog-runner-v1.json";
const samplePath = "tools/fixtures/luna-portex-catalog-sample-v1.json";
const modulePath = "lib/ebay/ebay-luna-catalog-runner.ts";
const dryPath = "tools/ebay-luna-catalog-runner-dry-run.mjs";
const runnerPath = "tools/ebay-luna-catalog-runner.mjs";
const docPath = "docs/ebay-pro-isolation/EBAY_LUNA_CATALOG_RUNNER_B2A_LUNA_CATALOG_RUN_V1.md";
const fixtureSource = readFileSync(fixturePath, "utf8");
const moduleSource = readFileSync(modulePath, "utf8");
const drySource = readFileSync(dryPath, "utf8");
const runnerSource = readFileSync(runnerPath, "utf8");
const docSource = readFileSync(docPath, "utf8");
const fixture = JSON.parse(fixtureSource);
const sample = JSON.parse(readFileSync(samplePath, "utf8"));

test("fixture defines runner and safety boundaries", () => {
  assert.equal(fixture.status, "EBAY_LUNA_CATALOG_RUNNER_READY");
  assert.equal(fixture.realCatalogFileUsedInThisLoop, false);
  assert.equal(fixture.sampleCatalogUsedInDryRun, true);
  for (const key of ["noProductionWrites", "noMainWrites", "noStagingWritesInThisLoop", "noEbayWrites", "noOauthInThisLoop", "noTokenStorage", "noDraftCreation", "noListingCreation", "noOfferCreation", "noPublication", "noScraper", "noRealCatalogCommitted", "noFullWarehouseStreetAddressCommitted"]) {
    assert.equal(fixture.safetyFlags[key], true, key);
  }
});

async function importRunnerAndCapture(args = []) {
  const messages = [];
  const originalArgv = process.argv;
  const originalLog = console.log;
  process.argv = [originalArgv[0], runnerPath, ...args];
  console.log = (message) => messages.push(String(message));
  try { await import(`./ebay-luna-catalog-runner.mjs?test=${Date.now()}-${Math.random()}`); }
  finally { process.argv = originalArgv; console.log = originalLog; }
  return JSON.parse(messages.join("\n"));
}

test("default runner is safe and reads no real file", async () => {
  const output = await importRunnerAndCapture();
  assert.equal(output.mode, "safe-default");
  assert.equal(output.realCatalogFileUsed, false);
  assert.equal(output.catalogReadExecuted, false);
  assert.equal(output.canProceedToB2Run, false);
  assert.equal(output.canPublish, false);
  assert.equal(output.nextRecommendedRoute, "NEED_REAL_LUNA_CATALOG_FILE");
});

test("execution requires catalog path and approval environment", async () => {
  const saved = process.env.LUNA_CATALOG_RUN_APPROVED;
  delete process.env.LUNA_CATALOG_RUN_APPROVED;
  const noPath = await importRunnerAndCapture(["--execute-local-catalog-ingest"]);
  const noApproval = await importRunnerAndCapture(["--catalog-file", "/tmp/local-catalog.csv", "--execute-local-catalog-ingest"]);
  if (saved === undefined) delete process.env.LUNA_CATALOG_RUN_APPROVED;
  else process.env.LUNA_CATALOG_RUN_APPROVED = saved;
  assert.equal(noPath.blockedReason, "CATALOG_FILE_PATH_REQUIRED");
  assert.equal(noApproval.blockedReason, "MISSING_OR_INVALID_LOCAL_CATALOG_APPROVAL");
  assert.equal(noApproval.catalogReadExecuted, false);
});

test("runner source requires exact CLI confirmation and never writes", () => {
  assert.match(runnerSource, /LOCAL_LUNA_CATALOG_INGEST_APPROVED/);
  assert.match(runnerSource, /LUNA_CATALOG_RUN_APPROVED/);
  assert.doesNotMatch(runnerSource, /writeFile|appendFile|createWriteStream|copyFile|rename\(/);
  assert.doesNotMatch(runnerSource, /fetch\(|createClient|\.from\(|\.insert\(|\.update\(|\.upsert\(/);
});

test("file type detection supports CSV JSON XLSX and blocks unknown", () => {
  assert.equal(detectCatalogFileType("catalog.csv"), "CSV");
  assert.equal(detectCatalogFileType("catalog.JSON"), "JSON");
  assert.equal(detectCatalogFileType("catalog.xlsx"), "XLSX");
  assert.equal(detectCatalogFileType("catalog.txt"), "UNSUPPORTED");
});

test("CSV parser handles quoted and structured fields", () => {
  const csv = 'sku,productName,cost,stockAvailable,packQuantity,weight,dimensions,imageUrl\nLP-1,"Silicone Cable Clips, Black",6.2,100,20,"{""value"":6,""unit"":""oz""}","{""length"":8}",https://catalog.example.invalid/item';
  const rows = parseLocalLunaCatalogCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].productName, "Silicone Cable Clips, Black");
  assert.equal(rows[0].cost, 6.2);
  assert.deepEqual(rows[0].weight, { value: 6, unit: "oz" });
});

test("JSON parser accepts arrays and rejects objects", () => {
  assert.equal(parseLocalLunaCatalogJson(JSON.stringify(sample)).length, 4);
  assert.throws(() => parseLocalLunaCatalogJson('{"sku":"x"}'), /CATALOG_JSON_MUST_BE_ARRAY/);
});

test("XLSX missing dependency is handled safely", async () => {
  const output = await parseLocalLunaCatalogXlsxIfAvailable(new Uint8Array());
  assert.equal(output.parserAvailable, false);
  assert.equal(output.error, "XLSX_PARSER_UNAVAILABLE");
  assert.deepEqual(output.rows, []);
});

test("missing required columns block a real catalog", () => {
  const report = buildRealLunaCatalogIngestReport(fixture, [{ sku: "LP-1", productName: "Cable clips" }], { realCatalogFileUsed: true, catalogFileType: "JSON" });
  assert.equal(report.requiredColumnsPresent, false);
  assert.ok(report.missingRequiredColumns.includes("cost"));
  assert.equal(report.canProceedToB2Run, false);
  assert.equal(report.nextRecommendedRoute, "NEED_REAL_LUNA_CATALOG_FILE");
});

test("dry-run sample remains sample-only and cannot enable B2-RUN", () => {
  const report = buildRealLunaCatalogIngestReport(fixture, sample, { realCatalogFileUsed: false, catalogFileType: "JSON" });
  assert.equal(report.sampleMatchOnly, true);
  assert.equal(report.realCatalogFileUsed, false);
  assert.equal(report.canProceedToB2Run, false);
  assert.equal(report.canPublish, false);
  assert.equal(report.nextRecommendedRoute, "NEED_REAL_LUNA_CATALOG_FILE");
});

test("real complete catalog without approval routes to human approval", () => {
  const report = buildRealLunaCatalogIngestReport(fixture, [sample[0]], { realCatalogFileUsed: true, humanApprovalConfirmed: false, catalogFileType: "JSON" });
  assert.equal(report.requiredColumnsPresent, true);
  assert.equal(report.sampleMatchOnly, false);
  assert.equal(report.nextRecommendedRoute, "NEED_HUMAN_APPROVAL");
  assert.equal(report.canProceedToB2Run, false);
});

test("sanitized report never returns raw catalog rows", () => {
  const sanitized = sanitizeLunaCatalogRowsForReport(sample);
  assert.equal(sanitized.catalogRowsLoaded, 4);
  assert.equal(sanitized.rawRowsPrinted, false);
  assert.equal(sanitized.fullCatalogPrinted, false);
  assert.equal(Object.hasOwn(sanitized, "rows"), false);
});

test("logical snapshot includes identity, checksum, stock, and cost summaries without file writes", () => {
  const snapshot = buildLunaCatalogLogicalSnapshot(sample, { importedAt: "2026-07-10T12:00:00.000Z", catalogSource: "LOCAL_TEST_CATALOG" });
  assert.match(snapshot.snapshotId, /^luna-/);
  assert.equal(snapshot.importedAt, "2026-07-10T12:00:00.000Z");
  assert.equal(snapshot.catalogSource, "LOCAL_TEST_CATALOG");
  assert.equal(snapshot.productCount, 4);
  assert.equal(snapshot.skuCount, 4);
  assert.match(snapshot.checksum, /^fnv1a-[0-9a-f]{8}$/);
  assert.ok(snapshot.stockSummary.totalUnits > 0);
  assert.equal(snapshot.priceCostSummary.productsWithCost, 4);
  assert.equal(snapshot.logicalSnapshotOnly, true);
  assert.equal(snapshot.snapshotFileWritten, false);
});

test("snapshot comparison detects every guarded supplier change", () => {
  const beforeRows = sample.slice(0, 2).map((row) => ({ ...row }));
  beforeRows[1].stockAvailable = 0;
  const afterRows = [
    { ...beforeRows[0], stockAvailable: 0, cost: 7, packQuantity: 10, weight: { value: 7, unit: "oz" }, dimensions: { length: 9 }, imageUrl: null, discontinued: true },
    { ...beforeRows[1], stockAvailable: 30 },
    { ...sample[2], sku: "LP-NEW" },
  ];
  const previous = buildLunaCatalogLogicalSnapshot(beforeRows, { importedAt: "2026-07-09T12:00:00.000Z" });
  const current = buildLunaCatalogLogicalSnapshot(afterRows, { importedAt: "2026-07-10T12:00:00.000Z" });
  const changes = compareLunaCatalogSnapshots(current, previous);
  assert.ok(changes.newProductsDetected.includes("LP-NEW"));
  assert.ok(changes.stockChangedProducts.includes("LP-SAMPLE-CC20"));
  assert.ok(changes.outOfStockProducts.includes("LP-SAMPLE-CC20"));
  assert.ok(changes.restockedProducts.includes("LP-SAMPLE-CC06"));
  assert.ok(changes.costChangedProducts.includes("LP-SAMPLE-CC20"));
  assert.ok(changes.packChangedProducts.includes("LP-SAMPLE-CC20"));
  assert.ok(changes.weightChangedProducts.includes("LP-SAMPLE-CC20"));
  assert.ok(changes.dimensionsChangedProducts.includes("LP-SAMPLE-CC20"));
  assert.ok(changes.imageChangedProducts.includes("LP-SAMPLE-CC20"));
  assert.ok(changes.discontinuedProducts.includes("LP-SAMPLE-CC20"));
});

test("snapshot comparison detects removed products", () => {
  const previous = buildLunaCatalogLogicalSnapshot(sample.slice(0, 2));
  const current = buildLunaCatalogLogicalSnapshot(sample.slice(0, 1));
  assert.ok(compareLunaCatalogSnapshots(current, previous).removedProductsDetected.includes("LP-SAMPLE-CC06"));
});

test("product operational states cover listing protection decisions", () => {
  const previousRows = [
    { ...sample[0], sku: "LIST", cost: 6 },
    { ...sample[0], sku: "REPRICE", cost: 5 },
    { ...sample[0], sku: "PRICE", packQuantity: 20 },
    { ...sample[0], sku: "WATCH", stockAvailable: 100, packQuantity: 20 },
  ];
  const currentRows = [
    { ...sample[0], sku: "LIST", cost: 6 },
    { ...sample[0], sku: "REPRICE", cost: 7 },
    { ...sample[0], sku: "PRICE", packQuantity: 10 },
    { ...sample[0], sku: "STOCK", stockAvailable: 0 },
    { ...sample[0], sku: "WATCH", stockAvailable: 2, packQuantity: 20 },
    { ...sample[0], sku: "CONFIRM", dimensions: null },
    { ...sample[0], sku: "DELIST", discontinued: true },
    { ...sample[0], sku: "NEW" },
  ];
  const previous = buildLunaCatalogLogicalSnapshot(previousRows);
  const current = buildLunaCatalogLogicalSnapshot(currentRows);
  const states = Object.fromEntries(buildLunaCatalogProductOperationalStates(current, compareLunaCatalogSnapshots(current, previous)).map((row) => [row.sku, row.status]));
  assert.equal(states.LIST, "LISTABLE");
  assert.equal(states.REPRICE, "REPRICE_REQUIRED");
  assert.equal(states.PRICE, "PRICE_REVIEW");
  assert.equal(states.STOCK, "STOCK_HOLD");
  assert.equal(states.WATCH, "WATCHLIST");
  assert.equal(states.CONFIRM, "NEED_SUPPLIER_CONFIRMATION");
  assert.equal(states.DELIST, "DELIST_OR_PAUSE_REQUIRED");
  assert.equal(states.NEW, "NEW_OPPORTUNITY");
});

function guardFor(overrides = {}) {
  const snapshot = buildLunaCatalogLogicalSnapshot([sample[0]], { importedAt: "2026-07-10T12:00:00.000Z" });
  return buildLunaCatalogPrePublishGuard({
    snapshot, product: snapshot.products[0], requiredQuantity: 20, estimatedGrossMargin: 8.54,
    now: "2026-07-10T13:00:00.000Z", humanApprovalConfirmed: true, ...overrides,
  });
}

test("fresh complete snapshot passes guard for B2-RUN but never publication", () => {
  const guard = guardFor();
  assert.equal(guard.catalogFreshnessPassed, true);
  assert.equal(guard.catalogAgeHours, 1);
  assert.equal(guard.canProceedToB2Run, true);
  assert.equal(guard.canPublish, false);
  assert.equal(guard.nextRecommendedRoute, "EBAY-RESUME-B2-RUN");
});

test("pre-publish guard blocks stale, stock, cost, pack, dimensions, image, and risk failures", () => {
  assert.equal(guardFor({ now: "2026-07-12T13:00:00.000Z" }).nextRecommendedRoute, "NEED_FRESH_LUNA_CATALOG");
  assert.equal(guardFor({ requiredQuantity: 200 }).nextRecommendedRoute, "STOCK_HOLD");
  assert.equal(guardFor({ estimatedGrossMargin: -1 }).nextRecommendedRoute, "PRICE_REVIEW");
  assert.equal(guardFor({ requiredQuantity: 10 }).nextRecommendedRoute, "NEED_LUNA_PACK_QUANTITY_CONFIRMATION");
  const noDimensions = buildLunaCatalogLogicalSnapshot([{ ...sample[0], dimensions: null }], { importedAt: "2026-07-10T12:00:00.000Z" });
  assert.equal(guardFor({ snapshot: noDimensions, product: noDimensions.products[0] }).nextRecommendedRoute, "NEED_SUPPLIER_DIMENSIONS");
  const noImage = buildLunaCatalogLogicalSnapshot([{ ...sample[0], imageUrl: null }], { importedAt: "2026-07-10T12:00:00.000Z" });
  assert.equal(guardFor({ snapshot: noImage, product: noImage.products[0] }).nextRecommendedRoute, "NEED_SUPPLIER_IMAGE");
  assert.equal(guardFor({ highRisk: true }).nextRecommendedRoute, "EBAY-RESUME-HOLD");
});

test("pure module and dry-run have no environment, network, or filesystem writes", () => {
  for (const marker of ["process" + ".env", "fetch" + "(", "write" + "File", "append" + "File", "create" + "WriteStream", "create" + "Client", ".fr" + "om("]) {
    assert.equal(moduleSource.includes(marker), false, marker);
    assert.equal(drySource.includes(marker), false, marker);
  }
  assert.match(runnerSource, /process\.env/);
  assert.match(runnerSource, /readFileSync/);
});

test("runner files contain no credentials, street address, or paused tracks", () => {
  const combined = `${fixtureSource}\n${moduleSource}\n${drySource}\n${runnerSource}\n${docSource}`;
  for (const marker of ["access" + "_token", "refresh" + "_token", "client" + "_secret", "authorization" + " code"]) assert.equal(combined.toLowerCase().includes(marker), false);
  assert.doesNotMatch(combined, /streetAddress\s*[:=]|addressLine|fullAddress/i);
  for (const marker of ["AMAZON_LISTING_" + "PACKAGE_BUILDER", "ebay-sandbox-" + "draft-listing", "EBAY_SANDBOX_" + "DRAFT_LISTING"]) assert.equal(combined.includes(marker), false);
  assert.doesNotMatch(runnerSource, /git\s+add|git\s+commit|git\s+push/);
});

test("local file gate requires every explicit approval", () => {
  const input = buildEbayLunaCatalogRunnerInput(fixture);
  assert.equal(input.fullWarehouseStreetAddressCommitted, false);
  assert.equal(buildLocalCatalogFileGate(fixture, { filePath: "/tmp/catalog.csv", approved: true, cliConfirmed: false }).gateReady, false);
  assert.equal(buildLocalCatalogFileGate(fixture, { filePath: "/tmp/catalog.csv", approved: true, cliConfirmed: true }).gateReady, true);
});
