import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/production-db-ebay-table-audit-cleanup-plan-v1.json";
const classifierPath =
  "lib/ebay/db-table-boundary-classifier.ts";
const docPath =
  "docs/db-boundaries/PRODUCTION_DB_EBAY_TABLE_AUDIT_CLEANUP_PLAN_V1.md";

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

function classifyFromFixture(tableName) {
  const categories =
    fixture.categories;

  if (categories.imnovaCoreProduction.includes(tableName)) {
    return "IMNOVA_CORE_PRODUCTION";
  }

  if (categories.ebayProStaging.includes(tableName)) {
    return "EBAY_PRO_STAGING";
  }

  if (categories.localVmLabHeavy.includes(tableName)) {
    return "LOCAL_VM_LAB_HEAVY";
  }

  if (categories.sharedMinimum.includes(tableName)) {
    return "SHARED_MINIMUM";
  }

  return "UNKNOWN_MANUAL_REVIEW";
}

const forbiddenPatterns = [
  ["drop", " table"].join(""),
  ["trun", "cate"].join(""),
  ["delete", " from"].join(""),
  ["alter", " table ", "drop"].join(""),
  ["create ", "migration"].join(""),
  [".", "insert", "("].join(""),
  [".", "update", "("].join(""),
  [".", "delete", "("].join(""),
  [".", "upsert", "("].join(""),
  [".", "rpc", "("].join(""),
  ["create", "Client"].join(""),
  ["create", "Server", "Client"].join(""),
  ["fetch", "("].join(""),
  ["process", "env"].join("."),
  ["new ", "OpenAI"].join(""),
  ["images", "generate"].join("."),
  ["create", "Draft"].join(""),
  ["publish", "Listing"].join(""),
];

test("production db boundary fixture is static audit only", () => {
  assert.equal(
    fixture.dbBoundaryVersion,
    "PRODUCTION_DB_EBAY_TABLE_AUDIT_CLEANUP_PLAN_V1",
  );
  assert.equal(
    fixture.status,
    "DB_TABLE_BOUNDARIES_AUDITED_CLEANUP_PLAN_READY",
  );
  assert.equal(
    fixture.mode,
    "STATIC_AUDIT_NO_DB_CHANGES",
  );
  assert.equal(
    fixture.productionCoreProtectedOperationally,
    true,
  );
  assert.equal(
    fixture.physicalDbCleanupApplied,
    false,
  );
  assert.equal(
    fixture.liveDbQueried,
    false,
  );

  const flags =
    fixture.safetyFlags;

  assert.equal(flags.staticAuditOnly, true);
  assert.equal(flags.physicalDbCleanupApplied, false);
  assert.equal(flags.liveSupabaseQueried, false);
  assert.equal(flags.supabaseWriteUsed, false);
  assert.equal(flags.sqlMigrationCreated, false);
  assert.equal(flags.destructiveSqlCreated, false);
  assert.equal(flags.vmConnected, false);
});

test("production db boundary categories are present", () => {
  assert.equal(
    fixture.categories.imnovaCoreProduction.includes("products"),
    true,
  );
  assert.equal(
    fixture.categories.imnovaCoreProduction.includes("product_states"),
    true,
  );
  assert.equal(
    fixture.categories.ebayProStaging.includes("ebay_product_candidates") ||
      fixture.categories.ebayProStaging.includes("market_radar_snapshots"),
    true,
  );
  assert.equal(
    fixture.categories.localVmLabHeavy.includes("benchmark_raw_snapshots"),
    true,
  );
  assert.equal(
    fixture.categories.sharedMinimum.includes("product_id"),
    true,
  );
  assert.equal(
    fixture.categories.sharedMinimum.includes("slug"),
    true,
  );
  assert.equal(
    Array.isArray(fixture.categories.unknownManualReview),
    true,
  );
});

test("classifier module declares expected boundaries", () => {
  assert.equal(
    fileExists(classifierPath),
    true,
  );

  const content =
    readText(classifierPath);

  assert.equal(
    content.includes("PRODUCTION_DB_EBAY_TABLE_AUDIT_CLEANUP_PLAN_V1"),
    true,
  );
  assert.equal(
    content.includes("classifyDbTableName"),
    true,
  );
  assert.equal(
    content.includes("products"),
    true,
  );
  assert.equal(
    content.includes("market_radar_snapshots"),
    true,
  );
  assert.equal(
    content.includes("benchmark_raw_snapshots"),
    true,
  );
});

test("fixture classifier examples match expected categories", () => {
  assert.equal(
    classifyFromFixture("products"),
    "IMNOVA_CORE_PRODUCTION",
  );
  assert.equal(
    classifyFromFixture("product_states"),
    "IMNOVA_CORE_PRODUCTION",
  );
  assert.equal(
    classifyFromFixture("ebay_product_candidates"),
    "EBAY_PRO_STAGING",
  );
  assert.equal(
    classifyFromFixture("market_radar_snapshots"),
    "EBAY_PRO_STAGING",
  );
  assert.equal(
    classifyFromFixture("ebay_price_intelligence_snapshots"),
    "EBAY_PRO_STAGING",
  );
  assert.equal(
    classifyFromFixture("benchmark_raw_snapshots"),
    "LOCAL_VM_LAB_HEAVY",
  );
  assert.equal(
    classifyFromFixture("trend_radar_signals"),
    "UNKNOWN_MANUAL_REVIEW",
  );
});

test("new audit files avoid executable cleanup or external systems", () => {
  for (const path of [
    fixturePath,
    classifierPath,
    docPath,
  ]) {
    const content =
      readText(path).toLowerCase();

    for (const pattern of forbiddenPatterns) {
      assert.equal(
        content.includes(pattern.toLowerCase()),
        false,
        `${path} contains ${pattern}`,
      );
    }
  }
});
