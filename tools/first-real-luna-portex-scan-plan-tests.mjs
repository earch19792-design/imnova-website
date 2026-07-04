import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixturePath =
  "tools/fixtures/first-real-luna-portex-scan-plan-v1.json";
const modulePath =
  "lib/ebay/first-real-luna-portex-scan-plan.ts";
const docPath =
  "docs/ebay-pro-isolation/FIRST_REAL_LUNA_PORTEX_SCAN_PLAN_V1.md";

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
  ["postgres", "://"].join(""),
  ["postgresql", "://"].join(""),
  ["supa", "base", ".co"].join(""),
  ["access", "_token"].join(""),
  ["refresh", "_token"].join(""),
  ["client", "_secret"].join(""),
  ["console", "."].join(""),
  ["net", "."].join(""),
  ["s", "sh", " "].join(""),
];

test("first real Luna Portex scan plan fixture is ready but not executed", () => {
  assert.equal(fixture.planVersion, "FIRST_REAL_LUNA_PORTEX_SCAN_PLAN_V1");
  assert.equal(fixture.status, "FIRST_REAL_SCAN_PLAN_READY_NOT_EXECUTED");
  assert.equal(fixture.productionCoreOnly, true);
  assert.equal(fixture.productionEbayProDataCleaned, true);
  assert.equal(fixture.productionOffLimits, true);
  assert.equal(fixture.stagingReservedForEbayPro, true);
  assert.equal(fixture.firstRealLunaPortexScanPlanned, true);
  assert.equal(fixture.firstRealLunaPortexScanExecuted, false);
  assert.equal(fixture.preBaselineDemoDataExcluded, true);
  assert.equal(fixture.stagingDryRunGateRequired, true);
  assert.equal(fixture.approvalRequiredBeforeScan, true);
  assert.equal(fixture.whatsappDryRunDefault, true);
  assert.equal(fixture.localVmConnectedInThisLoop, false);
  assert.equal(fixture.noProductionWrites, true);
  assert.equal(fixture.noStagingWritesInThisLoop, true);
  assert.equal(fixture.noExternalCalls, true);
  assert.equal(fixture.noSecretsCommitted, true);
});

test("first real scan module is pure and classifies records", async () => {
  assert.equal(fileExists(modulePath), true);

  const source =
    readText(modulePath);

  assert.equal(source.includes("FIRST_REAL_LUNA_PORTEX_SCAN_PLAN_V1"), true);
  assert.equal(source.includes("getFirstRealLunaPortexScanPlan"), true);
  assert.equal(source.includes("getFirstScanStagingDryRunGate"), true);
  assert.equal(source.includes("getFirstScanApprovalChecklist"), true);
  assert.equal(source.includes("shouldTreatAsPreBaselineDemo"), true);
  assert.equal(source.includes("shouldTreatAsFirstRealScan"), true);

  for (const pattern of forbiddenPatterns) {
    assert.equal(
      source.includes(pattern),
      false,
      `${modulePath} contains ${pattern}`,
    );
  }

  const module =
    await import(`../${modulePath}`);

  assert.equal(
    module.shouldTreatAsPreBaselineDemo({ scanType: "PRE_BASELINE_DEMO" }),
    true,
  );
  assert.equal(
    module.shouldTreatAsPreBaselineDemo({ demo: true }),
    true,
  );
  assert.equal(
    module.shouldTreatAsFirstRealScan({
      scanType: "FIRST_REAL_LUNA_PORTEX_SCAN",
      lunaPortexCatalog: true,
      approvedForFirstScan: true,
    }),
    true,
  );
  assert.equal(
    module.shouldTreatAsFirstRealScan({
      scanType: "FIRST_REAL_LUNA_PORTEX_SCAN",
      lunaPortexCatalog: true,
      approvedForFirstScan: true,
      demo: true,
    }),
    false,
  );

  const plan =
    module.getFirstRealLunaPortexScanPlan();

  assert.equal(plan.production.productionOffLimits, true);
  assert.equal(plan.scan.firstRealLunaPortexScanExecuted, false);
  assert.equal(plan.scan.preBaselineDemoDataExcluded, true);
  assert.equal(plan.gate.required, true);
  assert.equal(plan.gate.approvalRequiredBeforeScan, true);
});

test("first scan document records staging gate and no execution", () => {
  assert.equal(fileExists(docPath), true);

  const doc =
    readText(docPath);

  assert.equal(doc.includes("Production is Core-only and clean"), true);
  assert.equal(doc.includes("Staging is reserved for eBay Pro"), true);
  assert.equal(doc.includes("VM/Lab is reserved for future heavy scan processing"), true);
  assert.equal(doc.includes("FIRST_REAL_LUNA_PORTEX_SCAN"), true);
  assert.equal(doc.includes("PRE_BASELINE_DEMO"), true);
  assert.equal(doc.includes("staging dry-run gate is required"), true);
  assert.equal(doc.includes("does not execute a scan"), true);
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
