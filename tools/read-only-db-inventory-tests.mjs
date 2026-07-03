import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/read-only-production-staging-db-inventory-v1.json";
const sqlPath =
  "tools/sql/read-only-db-inventory-v1.sql";
const docPath =
  "docs/db-boundaries/READ_ONLY_PRODUCTION_STAGING_DB_INVENTORY_V1.md";

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

const forbiddenSqlPatterns = [
  ["select", " *"].join(""),
  ["drop", " table"].join(""),
  ["trun", "cate"].join(""),
  ["delete", " from"].join(""),
  ["update", " "].join(""),
  ["insert", " "].join(""),
  ["alter", " table"].join(""),
  ["create", " table"].join(""),
  ["create", " migration"].join(""),
  ["co", "py", " "].join(""),
  ["\\", "co", "py"].join(""),
  ["grant", " "].join(""),
  ["revoke", " "].join(""),
  ["count", "(*)"].join(""),
];

test("read-only inventory fixture is metadata-only", () => {
  assert.equal(
    fixture.inventoryVersion,
    "READ_ONLY_PRODUCTION_STAGING_DB_INVENTORY_V1",
  );
  assert.equal(
    fixture.status,
    "READ_ONLY_DB_INVENTORY_READY",
  );
  assert.equal(
    fixture.mode,
    "METADATA_ONLY_NO_DATA_ROWS",
  );
  assert.equal(
    fixture.physicalDbCleanupApplied,
    false,
  );
  assert.equal(
    fixture.committedRawDbOutput,
    false,
  );

  const flags =
    fixture.safetyFlags;

  assert.equal(flags.readOnlyInventoryOnly, true);
  assert.equal(flags.metadataOnly, true);
  assert.equal(flags.businessRowsSelected, false);
  assert.equal(flags.piiSelected, false);
  assert.equal(flags.supabaseWriteUsed, false);
  assert.equal(flags.sqlMigrationCreated, false);
  assert.equal(flags.destructiveSqlCreated, false);
});

test("classification categories are declared", () => {
  for (const category of [
    "IMNOVA_CORE_PRODUCTION",
    "EBAY_PRO_STAGING",
    "LOCAL_VM_LAB_HEAVY",
    "SHARED_MINIMUM",
    "UNKNOWN_MANUAL_REVIEW",
  ]) {
    assert.equal(
      fixture.classificationCategories.includes(category),
      true,
      `${category} missing`,
    );
  }
});

test("read-only SQL is metadata-only and avoids business row access", () => {
  assert.equal(
    fileExists(sqlPath),
    true,
  );

  const sql =
    readText(sqlPath).toLowerCase();

  assert.equal(sql.includes("begin read only"), true);
  assert.equal(sql.includes("information_schema.tables"), true);
  assert.equal(sql.includes("pg_stat_user_tables"), true);
  assert.equal(sql.includes("from products"), false);
  assert.equal(sql.includes("from subscribers"), false);
  assert.equal(sql.includes("from community"), false);
  assert.equal(sql.includes("from market_radar"), false);
  assert.equal(sql.includes("from ebay_"), false);

  for (const pattern of forbiddenSqlPatterns) {
    assert.equal(
      sql.includes(pattern),
      false,
      `${sqlPath} contains ${pattern}`,
    );
  }
});

test("runbook documents manual safety gates", () => {
  assert.equal(
    fileExists(docPath),
    true,
  );

  const doc =
    readText(docPath);

  assert.equal(doc.includes("does not remove data"), true);
  assert.equal(doc.includes("Production should be IMNOVA Core only"), true);
  assert.equal(doc.includes("Staging is the controlled environment for eBay Pro"), true);
  assert.equal(doc.includes("The Local VM/Lab is the future home for heavy datasets"), true);
  assert.equal(doc.includes("Backup/export exists"), true);
  assert.equal(doc.includes("Rollback plan exists"), true);
  assert.equal(doc.includes("User explicitly approves the cleanup"), true);
});
