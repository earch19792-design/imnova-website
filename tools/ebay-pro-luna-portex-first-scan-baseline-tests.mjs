import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/ebay-pro-luna-portex-first-scan-baseline-v1.json";
const modulePath =
  "lib/ebay/luna-portex-first-scan-baseline.ts";
const docPath =
  "docs/ebay-pro-isolation/EBAY_PRO_LUNA_PORTEX_FIRST_SCAN_BASELINE_V1.md";

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

function isPreBaselineDemoDataLike(record = {}) {
  return (
    record.scanType === "PRE_BASELINE_DEMO" ||
    record.baselineStatus === "PRE_BASELINE_DEMO" ||
    record.isDemo === true ||
    record.demo === true ||
    record.testData === true ||
    record.mode === "demo" ||
    record.source === "demo"
  );
}

function shouldIgnoreForFirstRealScanLike(record = {}) {
  if (record.scanType === "FIRST_REAL_LUNA_PORTEX_SCAN") {
    return false;
  }

  return isPreBaselineDemoDataLike(record);
}

const fixture =
  readJson(fixturePath);

const forbiddenModulePatterns = [
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
  ["drop", " table"].join(""),
  ["trun", "cate"].join(""),
  ["delete", " from"].join(""),
  ["new ", "OpenAI"].join(""),
  ["images", ".generate"].join(""),
  ["create", "Draft"].join(""),
  ["publish", "Listing"].join(""),
  ["console", "."].join(""),
];

test("first scan baseline fixture is staging/lab-only and non-destructive", () => {
  assert.equal(
    fixture.baselineVersion,
    "EBAY_PRO_LUNA_PORTEX_FIRST_SCAN_BASELINE_V1",
  );
  assert.equal(
    fixture.status,
    "FIRST_SCAN_BASELINE_READY",
  );
  assert.equal(
    fixture.mode,
    "STAGING_LAB_FIRST_SCAN_BASELINE_NO_DB_CHANGES",
  );
  assert.equal(fixture.production.ebayProAllowed, false);
  assert.equal(fixture.production.firstScanAllowed, false);
  assert.equal(fixture.staging.ebayProAllowed, true);
  assert.equal(fixture.staging.firstScanAllowed, true);
  assert.equal(
    fixture.staging.existingDemoDataPolicy,
    "IGNORE_AS_PRE_BASELINE_DEMO",
  );
  assert.equal(fixture.dataPolicy.currentDemoProductsAreProduction, false);
  assert.equal(
    fixture.dataPolicy.currentDemoProductsCanBeIgnoredForFirstScan,
    true,
  );
  assert.equal(fixture.dataPolicy.physicalDeleteApplied, false);
  assert.equal(
    fixture.scanPolicy.nextLunaPortexScanType,
    "FIRST_REAL_LUNA_PORTEX_SCAN",
  );
  assert.equal(fixture.scanPolicy.shouldMixDemoWithFirstRealScan, false);
  assert.equal(fixture.whatsappPolicy.ebayProWhatsappDryRunDefault, true);
  assert.equal(fixture.whatsappPolicy.realSendInThisLoop, false);

  const flags =
    fixture.safetyFlags;

  assert.equal(flags.physicalDbCleanupApplied, false);
  assert.equal(flags.supabaseWriteUsed, false);
  assert.equal(flags.destructiveSqlCreated, false);
  assert.equal(flags.vmConnected, false);
  assert.equal(flags.whatsappRealSendUsed, false);
});

test("first scan baseline module is pure and declares required contract", () => {
  assert.equal(
    fileExists(modulePath),
    true,
  );

  const source =
    readText(modulePath);

  assert.equal(
    source.includes("EBAY_PRO_LUNA_PORTEX_FIRST_SCAN_BASELINE_V1"),
    true,
  );
  assert.equal(source.includes("getLunaPortexFirstScanBaseline"), true);
  assert.equal(source.includes("isPreBaselineDemoData"), true);
  assert.equal(source.includes("shouldIgnoreForFirstRealScan"), true);
  assert.equal(source.includes("getFirstScanSafetyChecklist"), true);
  assert.equal(source.includes("getFirstScanAllowedEnvironmentPolicy"), true);

  for (const pattern of forbiddenModulePatterns) {
    assert.equal(
      source.includes(pattern),
      false,
      `${modulePath} contains ${pattern}`,
    );
  }
});

test("first scan baseline behavior contract treats demo as pre-baseline", () => {
  assert.equal(
    isPreBaselineDemoDataLike({ scanType: "PRE_BASELINE_DEMO" }),
    true,
  );
  assert.equal(
    shouldIgnoreForFirstRealScanLike({ scanType: "PRE_BASELINE_DEMO" }),
    true,
  );
  assert.equal(
    shouldIgnoreForFirstRealScanLike({
      scanType: "FIRST_REAL_LUNA_PORTEX_SCAN",
    }),
    false,
  );
});

test("first scan runbook documents production, staging, lab, cleanup, and WhatsApp boundaries", () => {
  assert.equal(
    fileExists(docPath),
    true,
  );

  const doc =
    readText(docPath);

  assert.equal(doc.includes("Production is IMNOVA Core only"), true);
  assert.equal(
    doc.includes("Staging is the official controlled environment"),
    true,
  );
  assert.equal(
    doc.includes("The Local VM/Lab is reserved for future heavy scan simulations"),
    true,
  );
  assert.equal(doc.includes("PRE_BASELINE_DEMO"), true);
  assert.equal(doc.includes("FIRST_REAL_LUNA_PORTEX_SCAN"), true);
  assert.equal(doc.includes("No physical cleanup happens in this loop"), true);
  assert.equal(doc.includes("dry-run by default"), true);
});
