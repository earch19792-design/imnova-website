import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixturePath =
  "tools/fixtures/luna-portex-staging-write-gate-v1.json";
const catalogPath =
  "tools/fixtures/luna-portex-staging-scan-sample-catalog-v1.json";
const scanModulePath =
  "lib/ebay/luna-portex-staging-scan-dry-run-executor.ts";
const gateModulePath =
  "lib/ebay/luna-portex-staging-write-gate.ts";
const cliPath =
  "tools/luna-portex-staging-write-gate-dry-run.mjs";
const docPath =
  "docs/ebay-pro-isolation/LUNA_PORTEX_STAGING_WRITE_GATE_V1.md";

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
  [".", "insert", "("].join(""),
  ["fetch", "("].join(""),
  ["process", ".env"].join(""),
  ["new ", "OpenAI"].join(""),
  ["images", ".generate"].join(""),
  ["create", "Draft"].join(""),
  ["publish", "Listing"].join(""),
  ["send", "Whatsapp"].join(""),
  ["postgres", "://"].join(""),
  ["postgresql", "://"].join(""),
  ["supa", "base", ".co"].join(""),
  ["access", "_token"].join(""),
  ["refresh", "_token"].join(""),
  ["client", "_secret"].join(""),
  ["http", "://"].join(""),
  ["https", "://"].join(""),
];

test("write gate fixture is ready and write-safe", () => {
  assert.equal(fixture.gateVersion, "LUNA_PORTEX_STAGING_WRITE_GATE_V1");
  assert.equal(fixture.status, "STAGING_WRITE_GATE_READY_NOT_EXECUTED");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_WRITE_PLAN_ONLY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.reservedForEbayPro, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.staging.writeApprovalRequired, true);
  assert.equal(fixture.scanType, "FIRST_REAL_LUNA_PORTEX_SCAN");
  assert.equal(fixture.excludesPreBaselineDemo, true);
  assert.equal(fixture.maxCandidatesPerWritePlan <= 20, true);
  assert.equal(fixture.targetTablesAllowed.includes("ebay_product_candidates"), true);
  assert.equal(fixture.targetTablesForbidden.includes("products"), true);
  assert.equal(fixture.safetyFlags.noProductionWrites, true);
  assert.equal(fixture.safetyFlags.noStagingWritesInThisLoop, true);
  assert.equal(fixture.safetyFlags.noDbConnections, true);
  assert.equal(fixture.safetyFlags.noExternalCalls, true);
});

test("write gate builds plan from local dry-run previews", async () => {
  const scanModule =
    await import(`../${scanModulePath}`);
  const gateModule =
    await import(`../${gateModulePath}`);

  const dryRunResult =
    scanModule.runLunaPortexStagingScanDryRun({
      catalog:
        catalog.items,
      maxProductsPerDryRun:
        20,
    });
  const plan =
    gateModule.buildLunaPortexStagingWritePlan(
      dryRunResult,
      {
        maxCandidatesPerWritePlan:
          fixture.maxCandidatesPerWritePlan,
      },
    );

  assert.equal(plan.totalPreviews, 4);
  assert.equal(plan.writeEligible, 3);
  assert.equal(plan.blocked, 1);
  assert.equal(plan.approvalRequired, true);
  assert.equal(plan.writeExecuted, false);
  assert.equal(plan.targetTablesPlanned.includes("ebay_product_candidates"), true);
  assert.equal(plan.targetTablesPlanned.includes("products"), false);
  assert.equal(plan.safetyFlags.productionTouched, false);
  assert.equal(plan.safetyFlags.stagingDbWritten, false);
  assert.equal(plan.safetyFlags.externalCallsUsed, false);

  const outOfStockPlan =
    plan.plannedWrites.find((entry) => entry.sourceId === "LP-DRY-002");

  assert.equal(outOfStockPlan.sellReady, false);
  assert.equal(outOfStockPlan.reviewRequired, true);

  const blockedIncomplete =
    plan.blockedCandidates.find((entry) => entry.sourceId === "LP-DRY-003");

  assert.equal(Boolean(blockedIncomplete), true);
  assert.equal(blockedIncomplete.reasons.includes("missing title"), true);
  assert.equal(blockedIncomplete.reasons.includes("missing estimated cost"), true);
});

test("write gate blocks pre-baseline, wrong scan type, production, and forbidden tables", async () => {
  const gateModule =
    await import(`../${gateModulePath}`);

  assert.equal(
    gateModule.shouldBlockStagingWrite({
      sourceId: "demo",
      scanType: "PRE_BASELINE_DEMO",
      title: "Demo",
      estimatedCost: 1,
    }),
    true,
  );
  assert.equal(
    gateModule.shouldBlockStagingWrite({
      sourceId: "wrong-scan",
      scanType: "OTHER_SCAN",
      title: "Wrong Scan",
      estimatedCost: 1,
    }),
    true,
  );
  assert.equal(
    gateModule.shouldBlockStagingWrite({
      sourceId: "prod",
      scanType: "FIRST_REAL_LUNA_PORTEX_SCAN",
      title: "Production Target",
      estimatedCost: 1,
      targetEnvironment: "production",
    }),
    true,
  );
  assert.equal(
    gateModule.shouldBlockStagingWrite({
      sourceId: "core-table",
      scanType: "FIRST_REAL_LUNA_PORTEX_SCAN",
      title: "Core Table",
      estimatedCost: 1,
      targetTables: ["products"],
    }),
    true,
  );
});

test("write gate CLI is wired to local fixtures and plan summary output", () => {
  const source =
    readText(cliPath);

  assert.equal(source.includes("readFileSync(fixturePath"), true);
  assert.equal(source.includes("luna-portex-staging-scan-sample-catalog-v1.json"), true);
  assert.equal(source.includes("runLunaPortexStagingScanDryRun"), true);
  assert.equal(source.includes("buildLunaPortexStagingWritePlan"), true);
  assert.equal(source.includes("summarizeStagingWritePlan"), true);
  assert.equal(source.includes("plannedWrites:"), true);
  assert.equal(source.includes("blockedCandidates:"), true);
  assert.equal(source.includes("writeFile"), false);
  assert.equal(source.includes("appendFile"), false);
});

test("write gate files avoid external clients and runtime patterns", () => {
  for (const path of [docPath, fixturePath, gateModulePath, cliPath]) {
    assert.equal(fileExists(path), true);
    const source =
      readText(path);

    for (const pattern of forbiddenPatterns) {
      assert.equal(
        source.includes(pattern),
        false,
        `${path} contains ${pattern}`,
      );
    }
  }

  const cliSource =
    readText(cliPath);

  assert.equal(cliSource.includes("readFileSync"), true);
  assert.equal(cliSource.includes("writeFile"), false);
  assert.equal(cliSource.includes("appendFile"), false);
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
