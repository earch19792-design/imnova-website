import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixturePath =
  "tools/fixtures/luna-portex-staging-scan-dry-run-executor-v1.json";
const catalogPath =
  "tools/fixtures/luna-portex-staging-scan-sample-catalog-v1.json";
const modulePath =
  "lib/ebay/luna-portex-staging-scan-dry-run-executor.ts";
const cliPath =
  "tools/luna-portex-staging-scan-dry-run.mjs";

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
const catalog =
  readJson(catalogPath);

const forbiddenPatterns = [
  ["create", "Client"].join(""),
  ["create", "Server", "Client"].join(""),
  [".", "from", "("].join(""),
  [".", "select", "("].join(""),
  [".", "insert", "("].join(""),
  [".", "update", "("].join(""),
  [".", "delete", "("].join(""),
  [".", "upsert", "("].join(""),
  [".", "rpc", "("].join(""),
  ["fetch", "("].join(""),
  ["process", ".env"].join(""),
  ["new ", "OpenAI"].join(""),
  ["images", ".generate"].join(""),
  ["create", "Draft"].join(""),
  ["publish", "Listing"].join(""),
  ["send", "Whatsapp"].join(""),
  ["http", "://"].join(""),
  ["https", "://"].join(""),
  ["postgres", "://"].join(""),
  ["postgresql", "://"].join(""),
  ["supa", "base", ".co"].join(""),
  ["access", "_token"].join(""),
  ["refresh", "_token"].join(""),
  ["client", "_secret"].join(""),
  ["net", "."].join(""),
  ["s", "sh"].join(""),
];

test("dry-run policy fixture is ready and write-safe", () => {
  assert.equal(
    fixture.dryRunVersion,
    "LUNA_PORTEX_STAGING_SCAN_DRY_RUN_EXECUTOR_V1",
  );
  assert.equal(fixture.status, "STAGING_SCAN_DRY_RUN_EXECUTOR_READY");
  assert.equal(fixture.mode, "LOCAL_FIXTURE_ONLY_NO_DB_WRITES");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.writesInThisLoop, false);
  assert.equal(fixture.localVmLab.connectedInThisLoop, false);
  assert.equal(fixture.scanPolicy.scanType, "FIRST_REAL_LUNA_PORTEX_SCAN");
  assert.equal(fixture.scanPolicy.excludePreBaselineDemo, true);
  assert.equal(fixture.limits.maxProductsPerDryRun <= 20, true);
  assert.equal(fixture.whatsappPolicy.realDeliveryUsed, false);
  assert.equal(fixture.safetyFlags.noProductionWrites, true);
  assert.equal(fixture.safetyFlags.noStagingWrites, true);
  assert.equal(fixture.safetyFlags.noDbConnections, true);
  assert.equal(fixture.safetyFlags.noExternalCalls, true);
});

test("sample catalog includes first scan and pre-baseline demo records", () => {
  assert.equal(fileExists(catalogPath), true);
  assert.equal(Array.isArray(catalog.items), true);
  assert.equal(catalog.items.length > 0, true);
  assert.equal(catalog.items.length <= 6, true);
  assert.equal(
    catalog.items.some((item) => item.scanType === "PRE_BASELINE_DEMO"),
    true,
  );
  assert.equal(
    catalog.items.some((item) => item.scanType === "FIRST_REAL_LUNA_PORTEX_SCAN"),
    true,
  );
  assert.equal(
    catalog.items.some((item) => item.stockStatus === "in_stock" && item.stockQuantity > 0),
    true,
  );
  assert.equal(
    catalog.items.some((item) => item.stockStatus === "out_of_stock"),
    true,
  );
});

test("dry-run executor excludes demo data and builds local previews", async () => {
  const module =
    await import(`../${modulePath}`);

  const result =
    module.runLunaPortexStagingScanDryRun({
      catalog:
        catalog.items,
      maxProductsPerDryRun:
        fixture.limits.maxProductsPerDryRun,
    });

  assert.equal(result.totalInput, catalog.items.length);
  assert.equal(result.excludedPreBaselineDemo, 1);
  assert.equal(result.normalizedItems.length, catalog.items.length - 1);
  assert.equal(result.candidatePreviews.length, catalog.items.length - 1);
  assert.equal(
    result.candidatePreviews.every(
      (candidate) =>
        candidate.scanType === "FIRST_REAL_LUNA_PORTEX_SCAN" &&
        candidate.previewOnly === true &&
        candidate.persistCandidate === false,
    ),
    true,
  );
  assert.equal(result.candidatePreviews.length <= fixture.limits.maxProductsPerDryRun, true);
  assert.equal(result.warnings.length > 0, true);
  assert.equal(result.safetyFlags.noProductionWrites, true);
  assert.equal(result.safetyFlags.noDbConnections, true);
  assert.equal(result.safetyFlags.noExternalCalls, true);
  assert.equal(result.safetyFlags.persistCandidates, false);

  const summary =
    module.summarizeDryRunResult(result);

  assert.equal(summary.candidatePreviewCount, result.candidatePreviews.length);
});

test("module and CLI avoid external clients and network patterns", () => {
  assert.equal(fileExists(modulePath), true);
  assert.equal(fileExists(cliPath), true);

  const moduleSource =
    readText(modulePath);
  const cliSource =
    readText(cliPath);

  for (const pattern of forbiddenPatterns) {
    assert.equal(
      moduleSource.includes(pattern),
      false,
      `${modulePath} contains ${pattern}`,
    );
    assert.equal(
      cliSource.includes(pattern),
      false,
      `${cliPath} contains ${pattern}`,
    );
  }

  assert.equal(cliSource.includes("readFileSync"), true);
  assert.equal(cliSource.includes("luna-portex-staging-scan-sample-catalog-v1.json"), true);
});

test("dry-run CLI prints a local summary without writing files", () => {
  const source =
    readText(cliPath);

  assert.equal(source.includes("console.log("), true);
  assert.equal(source.includes("summary:"), true);
  assert.equal(source.includes("candidatePreviews:"), true);
  assert.equal(source.includes("readFileSync(fixturePath"), true);
  assert.equal(source.includes("writeFile"), false);
  assert.equal(source.includes("appendFile"), false);
});

test("repository does not include env, dump, backup, or image files", () => {
  const dumpResult =
    spawnSync(
      "find",
      [".", "-name", "*.dump", "-o", "-name", "*.sql.dump", "-o", "-name", "*.backup"],
      { encoding: "utf8" },
    );

  assert.equal(dumpResult.status, 0);
  assert.equal(dumpResult.stdout.trim(), "");

  const status =
    spawnSync(
      "git",
      ["status", "--short", "--untracked-files=all"],
      { encoding: "utf8" },
    );

  assert.equal(status.status, 0);
  assert.equal(/\.env($|\.|\/)/.test(status.stdout), false);
  assert.equal(/\.(png|jpg|jpeg|webp|gif|svg|avif|heic|tiff)$/im.test(status.stdout), false);
});
