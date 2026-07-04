import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixturePath =
  "tools/fixtures/production-ebay-pro-cleanup-execution-record-v1.json";
const modulePath =
  "lib/ebay/production-cleanup-execution-record.ts";
const docPath =
  "docs/db-boundaries/PRODUCTION_EBAY_PRO_CLEANUP_EXECUTION_RECORD_V1.md";

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
  ["pg_", "dump"].join(""),
  ["postgres", "://"].join(""),
  ["postgresql", "://"].join(""),
  ["supabase", ".co"].join(""),
  ["access", "_token"].join(""),
  ["refresh", "_token"].join(""),
  ["client", "_secret"].join(""),
  ["new ", "OpenAI"].join(""),
  ["images", ".generate"].join(""),
  ["create", "Draft"].join(""),
  ["publish", "Listing"].join(""),
  ["send", "Whatsapp"].join(""),
  ["console", "."].join(""),
];

test("production cleanup execution fixture records sanitized post-execution evidence", () => {
  assert.equal(
    fixture.executionRecordVersion,
    "PRODUCTION_EBAY_PRO_CLEANUP_EXECUTION_RECORD_V1",
  );
  assert.equal(
    fixture.status,
    "PRODUCTION_EBAY_PRO_DATA_CLEANUP_EXECUTED_AND_RECORDED",
  );
  assert.equal(fixture.mode, "POST_EXECUTION_RECORD_STATIC_ONLY");
  assert.equal(fixture.backup.manualBackupCreated, true);
  assert.equal(fixture.backup.backupSize, "60 MB");
  assert.equal(fixture.backup.backupCommittedToRepo, false);
  assert.equal(fixture.backup.connectionStringCommitted, false);
  assert.equal(fixture.backup.secretsCommitted, false);
  assert.equal(fixture.cleanup.productionCleanupExecutedManually, true);
  assert.equal(fixture.cleanup.cleanupExecutionApplied, true);
  assert.equal(fixture.cleanup.physicalDbCleanupApplied, true);
  assert.equal(fixture.cleanup.stagingTouched, false);
  assert.equal(fixture.cleanup.schemaDropped, false);
  assert.equal(fixture.cleanup.viewsDropped, false);
  assert.equal(fixture.cleanup.tablesTruncatedNotDropped, true);
  assert.equal(fixture.beforeCleanup.mainHeavyTable.estimatedRows, 139283);
  assert.equal(fixture.beforeCleanup.mainHeavyTable.totalSize, "283 MB");
  assert.equal(fixture.afterCleanup.allTargetTablesEstimatedRowsZero, true);
  assert.equal(fixture.afterCleanup.mainHeavyTableAfter.estimatedRows, 0);
  assert.equal(fixture.afterCleanup.mainHeavyTableAfter.totalSize, "56 kB");
  assert.equal(fixture.afterCleanup.exactCountVerificationDocumented, false);

  const targetTableNames =
    fixture.targetTables.map((table) => table.tableName);

  assert.equal(targetTableNames.includes("market_radar_snapshots"), true);
  assert.equal(targetTableNames.includes("ebay_product_candidates"), true);
  assert.equal(
    fixture.targetTables.every((table) => table.afterEstimatedRows === 0),
    true,
  );
  assert.equal(fixture.notTouched.products, true);
  assert.equal(fixture.notTouched.subscribers, true);
  assert.equal(fixture.notTouched.notificationLogs, true);
  assert.equal(fixture.notTouched.staging, true);

  const flags =
    fixture.safetyFlags;

  assert.equal(flags.postExecutionRecordOnly, true);
  assert.equal(flags.liveDbQueriedInThisLoop, false);
  assert.equal(flags.sqlExecutedInThisLoop, false);
  assert.equal(flags.backupConfirmed, true);
  assert.equal(flags.dumpFileCommitted, false);
  assert.equal(flags.connectionStringCommitted, false);
  assert.equal(flags.secretsCommitted, false);
  assert.equal(flags.stagingTouched, false);
  assert.equal(flags.schemaDropped, false);
  assert.equal(flags.dropTableUsed, false);
  assert.equal(flags.cascadeUsed, false);
});

test("production cleanup execution module is pure and static", () => {
  assert.equal(fileExists(modulePath), true);

  const source =
    readText(modulePath);

  assert.equal(
    source.includes("PRODUCTION_EBAY_PRO_CLEANUP_EXECUTION_RECORD_V1"),
    true,
  );
  assert.equal(source.includes("getProductionEbayProCleanupExecutionRecord"), true);
  assert.equal(source.includes("getProductionCleanupBeforeAfterSummary"), true);
  assert.equal(source.includes("getCleanedProductionTargetTables"), true);
  assert.equal(source.includes("getCleanupBackupRecord"), true);
  assert.equal(source.includes("getPostCleanupSafetyStatus"), true);

  for (const pattern of forbiddenModulePatterns) {
    assert.equal(
      source.includes(pattern),
      false,
      `${modulePath} contains ${pattern}`,
    );
  }
});

test("execution record document explains evidence limits and safety", () => {
  assert.equal(fileExists(docPath), true);

  const doc =
    readText(docPath);

  assert.equal(doc.includes("metadata_inventory_estimated_rows"), true);
  assert.equal(doc.includes("not an exact `COUNT(*)` verification"), true);
  assert.equal(doc.includes("Backup file name"), true);
  assert.equal(doc.includes("60 MB"), true);
  assert.equal(doc.includes("Staging was not touched"), true);
  assert.equal(doc.includes("Schema was preserved"), true);
  assert.equal(doc.includes("does not execute SQL"), true);
  assert.equal(doc.includes("does not move or copy backup files"), true);
});

test("repository does not include dump or backup files", () => {
  const result =
    spawnSync(
      "find",
      [".", "-name", "*.dump", "-o", "-name", "*.sql.dump", "-o", "-name", "*.backup"],
      { encoding: "utf8" },
    );

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "");
});
