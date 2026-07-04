import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixturePath =
  "tools/fixtures/production-ebay-pro-cleanup-exact-count-verification-v1.json";
const modulePath =
  "lib/ebay/production-cleanup-exact-count-verification.ts";
const docPath =
  "docs/db-boundaries/PRODUCTION_EBAY_PRO_CLEANUP_EXACT_COUNT_VERIFICATION_V1.md";

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

test("exact count verification fixture records all target tables at zero", () => {
  assert.equal(
    fixture.exactCountVerificationVersion,
    "PRODUCTION_EBAY_PRO_CLEANUP_EXACT_COUNT_VERIFICATION_V1",
  );
  assert.equal(
    fixture.status,
    "PRODUCTION_EBAY_PRO_CLEANUP_EXACT_COUNT_VERIFIED",
  );
  assert.equal(fixture.mode, "POST_EXECUTION_EXACT_COUNT_RECORD_STATIC_ONLY");
  assert.equal(fixture.backup.manualBackupCreated, true);
  assert.equal(fixture.backup.backupSize, "60 MB");
  assert.equal(fixture.backup.dumpFileCommitted, false);
  assert.equal(fixture.backup.connectionStringCommitted, false);
  assert.equal(fixture.backup.secretsCommitted, false);
  assert.equal(fixture.verification.exactCountVerificationDocumented, true);
  assert.equal(
    fixture.verification.exactCountVerificationExecutedManuallyBeforeThisLoop,
    true,
  );
  assert.equal(fixture.verification.allTargetTablesExactRowsZero, true);
  assert.equal(fixture.verification.productionCleanupFinalVerified, true);
  assert.equal(fixture.targetTables.length, 16);
  assert.equal(
    fixture.targetTables.every((table) => table.exactRows === 0),
    true,
  );

  const byTable =
    new Map(fixture.targetTables.map((table) => [table.tableName, table]));

  assert.equal(byTable.get("market_radar_snapshots")?.exactRows, 0);
  assert.equal(byTable.get("ebay_product_candidates")?.exactRows, 0);
  assert.equal(fixture.notTouched.staging, true);
  assert.equal(fixture.notTouched.schema, true);
  assert.equal(fixture.notTouched.views, true);
  assert.equal(fixture.notTouched.products, true);
  assert.equal(fixture.notTouched.subscribers, true);
  assert.equal(fixture.notTouched.notificationLogs, true);

  const flags =
    fixture.safetyFlags;

  assert.equal(flags.liveDbQueriedInThisLoop, false);
  assert.equal(flags.sqlExecutedInThisLoop, false);
  assert.equal(flags.supabaseWriteUsedInThisLoop, false);
  assert.equal(flags.exactCountVerificationDocumented, true);
  assert.equal(flags.allTargetTablesExactRowsZero, true);
  assert.equal(flags.dumpFileCommitted, false);
  assert.equal(flags.secretsCommitted, false);
  assert.equal(flags.stagingTouched, false);
});

test("exact count verification module is pure and static", () => {
  assert.equal(fileExists(modulePath), true);

  const source =
    readText(modulePath);

  assert.equal(
    source.includes("PRODUCTION_EBAY_PRO_CLEANUP_EXACT_COUNT_VERIFICATION_V1"),
    true,
  );
  assert.equal(source.includes("getProductionCleanupExactCountVerification"), true);
  assert.equal(source.includes("getExactCountVerifiedTables"), true);
  assert.equal(source.includes("getProductionCleanupFinalStatus"), true);

  for (const pattern of forbiddenModulePatterns) {
    assert.equal(
      source.includes(pattern),
      false,
      `${modulePath} contains ${pattern}`,
    );
  }
});

test("exact count verification document states no live action in this loop", () => {
  assert.equal(fileExists(docPath), true);

  const doc =
    readText(docPath);

  assert.equal(doc.includes("All 16 Production eBay Pro / Market Radar target tables returned exact rows of 0"), true);
  assert.equal(doc.includes("does not execute SQL"), true);
  assert.equal(doc.includes("does not query a live database"), true);
  assert.equal(doc.includes("Staging was not touched"), true);
  assert.equal(doc.includes("Schema was preserved"), true);
  assert.equal(doc.includes("manual 60 MB backup"), true);
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
