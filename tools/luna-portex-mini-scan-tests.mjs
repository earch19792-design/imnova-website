import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixturePath =
  "tools/fixtures/luna-portex-mini-scan-foundation-v1.json";
const inputFixturePath =
  "tools/fixtures/luna-portex-mini-scan-sanitized-input-v1.json";
const modulePath =
  "lib/ebay/luna-portex-mini-scan-foundation.ts";
const routeModulePath =
  "lib/ebay/ebay-pro-official-route.ts";
const cliPath =
  "tools/luna-portex-mini-scan-v1.mjs";
const docPath =
  "docs/ebay-pro-isolation/LUNA_PORTEX_FIRST_REAL_MINI_SCAN_AUTOMATIC_FOUNDATION_V1.md";

function readText(path) {
  return readFileSync(path, "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function fileExists(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

const fixture =
  readJson(fixturePath);
const sanitizedInput =
  readJson(inputFixturePath);

test("mini scan fixture locks LOOP 142 boundaries", () => {
  assert.equal(fixture.scanVersion, "LUNA_PORTEX_FIRST_REAL_MINI_SCAN_AUTOMATIC_FOUNDATION_V1");
  assert.equal(fixture.status, "MINI_SCAN_FOUNDATION_READY");
  assert.equal(fixture.production.offLimits, true);
  assert.deepEqual(fixture.staging.allowedWriteTables, ["ebay_product_candidates"]);
  assert.equal(fixture.staging.forbiddenWriteTables.includes("ebay_candidate_scores"), true);
  assert.equal(fixture.staging.forbiddenWriteTables.includes("ebay_candidate_validations"), true);
  assert.equal(fixture.staging.forbiddenWriteTables.includes("ebay_profit_scenarios"), true);
  assert.equal(fixture.automaticScanFoundation.included, true);
  assert.equal(fixture.automaticScanFoundation.schedulerCreated, false);
  assert.equal(fixture.automaticScanFoundation.realWhatsappAlerts, false);
});

test("normalizes valid, incomplete, missing variant, and out-of-stock items", async () => {
  const module =
    await import(`../${modulePath}`);
  const valid =
    module.normalizeLunaPortexMiniScanItem(sanitizedInput[0]);
  const outOfStock =
    module.normalizeLunaPortexMiniScanItem(sanitizedInput[1]);
  const incomplete =
    module.normalizeLunaPortexMiniScanItem(sanitizedInput[2]);
  const missingVariant =
    module.normalizeLunaPortexMiniScanItem(sanitizedInput[3]);

  assert.equal(valid.writeEligible, true);
  assert.equal(valid.blockedReason, null);
  assert.equal(outOfStock.blockedReason, "out_of_stock");
  assert.equal(incomplete.needsData.includes("missing cost"), true);
  assert.equal(incomplete.needsData.includes("missing stock"), true);
  assert.equal(incomplete.needsData.includes("missing image"), true);
  assert.equal(missingVariant.needsData.includes("missing supplierVariantId"), true);
});

test("missing title is blocked before candidate write eligibility", async () => {
  const module =
    await import(`../${modulePath}`);
  const missingTitle =
    module.normalizeLunaPortexMiniScanItem({
      ...sanitizedInput[0],
      title:
        "",
    });

  assert.equal(missingTitle.writeEligible, false);
  assert.equal(missingTitle.needsData.includes("missing title"), true);
  assert.equal(missingTitle.blockedReason, "needs_data");
});

test("candidate key is stable and candidate rows only target base table shape", async () => {
  const module =
    await import(`../${modulePath}`);
  const scanRun =
    module.buildLunaPortexMiniScanRun(sanitizedInput);
  const rows =
    module.buildLunaPortexMiniScanCandidateRows(scanRun);

  assert.equal(rows.length, 3);
  assert.equal(
    module.buildLunaPortexCandidateKey(scanRun.normalizedItems[0]),
    "luna-portex:first_real_mini_scan:lp-sanitized-variant-001",
  );
  assert.equal(rows[0].state, "DETECTED");
  assert.equal(rows[0].normalized_payload.listableInEbay, false);
  assert.equal(rows[0].normalized_payload.publishable, false);
  assert.equal(rows.some(row => Object.hasOwn(row, "candidate_id")), false);
  assert.equal(rows.some(row => Object.hasOwn(row, "idempotency_key")), false);
});

test("scan run enforces max ten products and automatic foundation", async () => {
  const module =
    await import(`../${modulePath}`);
  const manyItems =
    Array.from({ length: 12 }, (_, index) => ({
      ...sanitizedInput[0],
      supplierVariantId:
        `lp-sanitized-extra-${index}`,
    }));
  const scanRun =
    module.buildLunaPortexMiniScanRun(manyItems);
  const foundation =
    module.buildLunaPortexAutomaticScanFoundation(scanRun);

  assert.equal(scanRun.inputProducts, 10);
  assert.equal(scanRun.normalizedProducts, 10);
  assert.equal(foundation.included, true);
  assert.equal(foundation.schedulerCreated, false);
  assert.equal(foundation.realWhatsappAlerts, false);
  assert.equal(foundation.futureCadence.catalogSnapshot, "daily");
});

test("default dry-run summary is local and write-safe", async () => {
  const module =
    await import(`../${modulePath}`);
  const scanRun =
    module.buildLunaPortexMiniScanRun(sanitizedInput);
  const candidateRows =
    module.buildLunaPortexMiniScanCandidateRows(scanRun);
  const automaticScanFoundation =
    module.buildLunaPortexAutomaticScanFoundation(scanRun);
  const summary =
    module.summarizeLunaPortexMiniScan({
      ...scanRun,
      candidateRows,
      automaticScanFoundation,
    });

  assert.equal(summary.inputProducts, 4);
  assert.equal(summary.normalizedProducts, 4);
  assert.equal(summary.candidateRowsPlanned, 3);
  assert.equal(summary.writeEligibleCandidates, 3);
  assert.equal(summary.blockedCandidates, 3);
  assert.equal(summary.outOfStockCandidates, 1);
  assert.equal(summary.needsDataCandidates, 2);
  assert.equal(summary.automaticScanFoundationReady, true);
  assert.equal(summary.schedulerCreated, false);
  assert.equal(summary.stagingWriteExecuted, false);
});

test("CLI execute mode is gated for staging and writes only product candidates", () => {
  const cliSource =
    readText(cliPath);

  assert.equal(cliSource.includes("LUNA_PORTEX_MINI_SCAN_APPROVED"), true);
  assert.equal(cliSource.includes("APPROVE_LOOP_142_FIRST_REAL_MINI_SCAN"), true);
  assert.equal(cliSource.includes("EBAY_PRO_TARGET_ENV"), true);
  assert.equal(cliSource.includes("EBAY_PRO_STAGING_PROJECT_REF"), true);
  assert.equal(cliSource.includes("createClient"), true);
  assert.equal(cliSource.includes("ebay_product_candidates"), true);
  assert.equal(cliSource.includes("ebay_candidate_scores"), false);
  assert.equal(cliSource.includes("ebay_candidate_validations"), false);
  assert.equal(cliSource.includes("ebay_profit_scenarios"), false);
  assert.equal(cliSource.includes(".insert("), true);
  assert.equal(cliSource.includes(".update("), true);
  assert.equal(cliSource.includes(".upsert("), false);
});

test("pure module avoids clients env filesystem and external actions", () => {
  const source =
    readText(modulePath);
  const forbiddenPatterns = [
    "process.env",
    "readFileSync",
    "createClient",
    ".from(",
    "fetch(",
    "new OpenAI",
    "sendWhatsApp",
    "sendWhatsapp",
  ];

  for (const pattern of forbiddenPatterns) {
    assert.equal(source.includes(pattern), false, `${modulePath} contains ${pattern}`);
  }
});

test("route helper points LOOP 142 to LOOP 143", async () => {
  const routeModule =
    await import(`../${routeModulePath}`);
  const nextLoop =
    routeModule.getNextEbayProLoop("142");

  assert.equal(nextLoop.loopId, "143");
  assert.equal(nextLoop.label.includes("Benchmark Data Model"), true);
});

test("LOOP 142 files avoid env dumps images and secret-like output", () => {
  for (const path of [
    fixturePath,
    inputFixturePath,
    modulePath,
    cliPath,
    docPath,
  ]) {
    assert.equal(fileExists(path), true);
    const source =
      readText(path);
    const forbiddenPatterns = [
      "access_token",
      "refresh_token",
      "client_secret",
      "Authorization:",
      "new OpenAI",
      "sendWhatsApp",
      "sendWhatsapp",
      "createDraft",
      "publishListing",
    ];

    for (const pattern of forbiddenPatterns) {
      assert.equal(source.includes(pattern), false, `${path} contains ${pattern}`);
    }
  }

  const status =
    spawnSync(
      "git",
      ["status", "--short", "--untracked-files=all"],
      {
        encoding:
          "utf8",
      },
    );

  assert.equal(status.status, 0);
  assert.equal(/\.env($|\.|\/)/.test(status.stdout), false);
  assert.equal(/\.(dump|sql\.dump|backup)$/im.test(status.stdout), false);
  assert.equal(/\.(png|jpg|jpeg|webp|gif|svg|avif|heic|tiff)$/im.test(status.stdout), false);
});
