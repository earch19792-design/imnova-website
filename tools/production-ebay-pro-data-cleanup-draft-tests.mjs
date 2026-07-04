import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/production-ebay-pro-data-cleanup-draft-v1.json";
const sqlPath =
  "tools/sql/production-ebay-pro-data-cleanup-draft-v1.sql";
const docPath =
  "docs/db-boundaries/PRODUCTION_EBAY_PRO_DATA_CLEANUP_DRAFT_V1.md";

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

function tableListedInTruncate(sql, tableName) {
  const truncateBlock =
    sql.slice(sql.indexOf("truncate table"), sql.indexOf("restart identity"));

  return truncateBlock.includes(tableName);
}

const fixture =
  readJson(fixturePath);

const forbiddenSqlPatterns = [
  ["com", "mit;"].join(""),
  ["cas", "cade"].join(""),
  ["drop", " table"].join(""),
  ["drop", " view"].join(""),
  ["delete", " from"].join(""),
  ["update", " "].join(""),
  ["insert", " "].join(""),
  ["alter", " table"].join(""),
  ["create", " table"].join(""),
  ["create", " migration"].join(""),
];

test("production eBay Pro cleanup draft fixture is not executed", () => {
  assert.equal(
    fixture.cleanupDraftVersion,
    "PRODUCTION_EBAY_PRO_DATA_CLEANUP_DRAFT_V1",
  );
  assert.equal(fixture.status, "CLEANUP_DRAFT_READY_NOT_EXECUTED");
  assert.equal(fixture.mode, "DRAFT_SQL_ROLLBACK_BY_DEFAULT");
  assert.equal(fixture.cleanupExecutionApplied, false);
  assert.equal(fixture.physicalDbCleanupApplied, false);
  assert.equal(fixture.backupRequired, true);
  assert.equal(fixture.userApprovalRequired, true);
  assert.equal(fixture.stagingMustNotBeCleaned, true);
  assert.equal(fixture.rollbackByDefault, true);
  assert.equal(fixture.commitEnabled, false);
  assert.equal(fixture.mainHeavyTable.tableName, "market_radar_snapshots");
  assert.equal(fixture.mainHeavyTable.estimatedRows, 139283);
  assert.equal(fixture.mainHeavyTable.totalSize, "283 MB");

  assert.equal(
    fixture.targetTables.includes("public.market_radar_snapshots"),
    true,
  );
  assert.equal(
    fixture.targetTables.includes("public.ebay_product_candidates"),
    true,
  );
  assert.equal(
    fixture.explicitlyNotTouchedTables.includes("public.products"),
    true,
  );
  assert.equal(
    fixture.explicitlyNotTouchedTables.includes("public.subscribers"),
    true,
  );
  assert.equal(
    fixture.explicitlyNotTouchedTables.includes("public.notification_logs"),
    true,
  );

  const flags =
    fixture.safetyFlags;

  assert.equal(flags.destructiveSqlCreatedAsDraftOnly, true);
  assert.equal(flags.destructiveSqlExecuted, false);
  assert.equal(flags.rollbackByDefault, true);
  assert.equal(flags.commitEnabled, false);
  assert.equal(flags.cascadeUsed, false);
  assert.equal(flags.dropTableUsed, false);
  assert.equal(flags.dropViewUsed, false);
  assert.equal(flags.stagingCleanupAllowed, false);
});

test("production cleanup SQL draft is rollback-first and targets only eBay Pro tables", () => {
  assert.equal(fileExists(sqlPath), true);

  const sql =
    readText(sqlPath);
  const lowerSql =
    sql.toLowerCase();

  assert.equal(sql.includes("PRODUCTION ONLY"), true);
  assert.equal(sql.includes("DRAFT"), true);
  assert.equal(sql.includes("BACKUP"), true);
  assert.equal(sql.includes("USER APPROVAL"), true);
  assert.equal(lowerSql.includes("begin;"), true);
  assert.equal(lowerSql.includes("truncate table"), true);
  assert.equal(lowerSql.includes("rollback;"), true);
  assert.equal(lowerSql.trim().endsWith("rollback;"), true);

  for (const pattern of forbiddenSqlPatterns) {
    assert.equal(
      lowerSql.includes(pattern),
      false,
      `${sqlPath} contains ${pattern}`,
    );
  }

  for (const tableName of fixture.targetTables) {
    assert.equal(
      tableListedInTruncate(lowerSql, tableName),
      true,
      `${tableName} missing from cleanup draft`,
    );
  }

  for (const tableName of [
    "public.products",
    "public.subscribers",
    "public.notification_logs",
    "public.community_",
    "public.market_radar_latest_products",
    "public.market_radar_latest_snapshots",
  ]) {
    assert.equal(
      tableListedInTruncate(lowerSql, tableName),
      false,
      `${tableName} must not be targeted`,
    );
  }
});

test("cleanup draft document records backup, approval, staging, and rollback gates", () => {
  assert.equal(fileExists(docPath), true);

  const doc =
    readText(docPath);

  assert.equal(doc.includes("does not execute SQL"), true);
  assert.equal(doc.includes("Backup/export is required"), true);
  assert.equal(doc.includes("Explicit user approval is required"), true);
  assert.equal(doc.includes("Staging must not be cleaned"), true);
  assert.equal(doc.includes("ends with `ROLLBACK` by default"), true);
  assert.equal(doc.includes("market_radar_snapshots"), true);
  assert.equal(doc.includes("139,283"), true);
  assert.equal(doc.includes("283 MB"), true);
});
