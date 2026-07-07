import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixturePath =
  "tools/fixtures/luna-portex-staging-schema-compatibility-v1.json";
const schemaSnapshotPath =
  "tools/fixtures/luna-portex-staging-schema-snapshot-example-v1.json";
const catalogPath =
  "tools/fixtures/luna-portex-staging-scan-sample-catalog-v1.json";
const sqlPath =
  "tools/sql/luna-portex-staging-schema-read-only-v1.sql";
const scanModulePath =
  "lib/ebay/luna-portex-staging-scan-dry-run-executor.ts";
const gateModulePath =
  "lib/ebay/luna-portex-staging-write-gate.ts";
const adapterModulePath =
  "lib/ebay/luna-portex-staging-write-adapter.ts";
const compatibilityModulePath =
  "lib/ebay/luna-portex-staging-schema-compatibility.ts";
const routeModulePath =
  "lib/ebay/ebay-pro-official-route.ts";
const cliPath =
  "tools/luna-portex-staging-schema-compatibility-dry-run.mjs";
const docPath =
  "docs/ebay-pro-isolation/LUNA_PORTEX_STAGING_SCHEMA_COMPATIBILITY_V1.md";

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function buildPayloadBundle() {
  const scanModule =
    await import(`../${scanModulePath}`);
  const gateModule =
    await import(`../${gateModulePath}`);
  const adapterModule =
    await import(`../${adapterModulePath}`);
  const catalog =
    readJson(catalogPath);
  const scanResult =
    scanModule.runLunaPortexStagingScanDryRun({
      catalog:
        catalog.items,
      maxProductsPerDryRun:
        20,
    });
  const writePlan =
    gateModule.buildLunaPortexStagingWritePlan(scanResult);

  return adapterModule.buildLunaPortexStagingWritePayloads(
    writePlan,
    {
      maxPayloadCandidates:
        20,
    },
  );
}

const fixture =
  readJson(fixturePath);
const schemaSnapshot =
  readJson(schemaSnapshotPath);

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
  ["send", "WhatsApp"].join(""),
  ["postgres", "://"].join(""),
  ["postgresql", "://"].join(""),
  ["supa", "base", ".co"].join(""),
  ["access", "_token"].join(""),
  ["refresh", "_token"].join(""),
  ["client", "_secret"].join(""),
];

test("schema compatibility fixture is ready and write-safe", () => {
  assert.equal(
    fixture.schemaCompatibilityVersion,
    "LUNA_PORTEX_STAGING_SCHEMA_COMPATIBILITY_V1",
  );
  assert.equal(
    fixture.status,
    "STAGING_SCHEMA_COMPATIBILITY_READY_LOCAL_SNAPSHOT_ONLY",
  );
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.staging.realSchemaInspectionExecutedInThisLoop, false);
  assert.equal(fixture.safetyFlags.noDbConnections, true);
  assert.equal(fixture.readOnlySql.prepared, true);
  assert.equal(fixture.readOnlySql.executedInThisLoop, false);
});

test("read-only SQL file exists and contains no dangerous statements", () => {
  assert.equal(fileExists(sqlPath), true);

  const sql =
    readText(sqlPath);
  const upperSql =
    sql.toUpperCase();

  assert.equal(upperSql.includes("SELECT"), true);
  assert.equal(upperSql.includes("INFORMATION_SCHEMA.COLUMNS"), true);
  assert.equal(upperSql.includes("EBAY_PRODUCT_CANDIDATES"), true);
  assert.equal(upperSql.includes("EBAY_CANDIDATE_SCORES"), true);
  assert.equal(upperSql.includes("EBAY_CANDIDATE_VALIDATIONS"), true);
  assert.equal(upperSql.includes("EBAY_PROFIT_SCENARIOS"), true);

  for (const pattern of [
    /\bINSERT\b/i,
    /\bUPDATE\b/i,
    /\bDELETE\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\b/i,
    /\bALTER\b/i,
    /\bCREATE\b/i,
    /\bCOMMIT\b/i,
    /\bROLLBACK\b/i,
  ]) {
    assert.equal(pattern.test(sql), false, `${sqlPath} contains ${pattern}`);
  }
});

test("schema compatibility accepts valid adapter payloads", async () => {
  const compatibilityModule =
    await import(`../${compatibilityModulePath}`);
  const payloadBundle =
    await buildPayloadBundle();
  const report =
    compatibilityModule.validatePayloadBundleAgainstStagingSchema(
      payloadBundle,
      schemaSnapshot,
      {
        readOnlySqlPrepared:
          true,
      },
    );

  assert.equal(payloadBundle.eligibleCandidates, 3);
  assert.equal(payloadBundle.blockedCandidates, 1);
  assert.equal(report.compatible, true);
  assert.equal(report.payloadTablesChecked, 4);
  assert.equal(report.payloadsChecked, 12);
  assert.equal(report.schemaTablesChecked, 4);
  assert.deepEqual(report.incompatibleTables, []);
  assert.deepEqual(report.missingRequiredColumns, []);
  assert.equal(report.stagingWriteExecuted, false);
  assert.equal(report.readOnlyInspectionRequiredBeforeRealWrite, true);
  assert.equal(report.approvalRequiredBeforeWrite, true);
});

test("schema contract includes the four allowed tables", async () => {
  const compatibilityModule =
    await import(`../${compatibilityModulePath}`);
  const payloadBundle =
    await buildPayloadBundle();
  const contract =
    compatibilityModule.buildExpectedStagingSchemaContract(payloadBundle);

  assert.deepEqual(
    compatibilityModule.LUNA_PORTEX_STAGING_ALLOWED_WRITE_TABLES,
    fixture.allowedTables,
  );
  assert.deepEqual(
    contract.tables.map((table) => table.tableName),
    fixture.allowedTables,
  );
  assert.equal(contract.readOnlySqlPrepared, true);
});

test("schema compatibility blocks forbidden tables", async () => {
  const compatibilityModule =
    await import(`../${compatibilityModulePath}`);
  const payloadBundle =
    clone(await buildPayloadBundle());

  payloadBundle.payloadsByTable.products = [
    {
      tableName: "products",
      sourceId: "blocked",
      dedupeKey: "blocked-products",
      dryRun: true,
      stagingOnly: true,
      approvalRequired: true,
      writeExecuted: false,
    },
  ];

  const report =
    compatibilityModule.validatePayloadBundleAgainstStagingSchema(
      payloadBundle,
      schemaSnapshot,
    );

  assert.equal(report.compatible, false);
  assert.equal(
    report.errors.some((error) => error.includes("table not allowed")),
    true,
  );
  assert.equal(
    report.errors.some((error) => error.includes("forbidden table target")),
    true,
  );
});

test("schema compatibility is incompatible when a required column is missing", async () => {
  const compatibilityModule =
    await import(`../${compatibilityModulePath}`);
  const payloadBundle =
    await buildPayloadBundle();
  const incompleteSnapshot =
    clone(schemaSnapshot);
  const table =
    incompleteSnapshot.tables.find(
      (entry) => entry.tableName === "ebay_candidate_scores",
    );

  table.columns =
    table.columns.filter((column) => column.columnName !== "score");

  const report =
    compatibilityModule.validatePayloadBundleAgainstStagingSchema(
      payloadBundle,
      incompleteSnapshot,
    );

  assert.equal(report.compatible, false);
  assert.equal(
    report.missingRequiredColumns.includes("ebay_candidate_scores.score"),
    true,
  );
  assert.equal(
    report.incompatibleTables.includes("ebay_candidate_scores"),
    true,
  );
});

test("schema compatibility reports warnings for extra and unverifiable columns", async () => {
  const compatibilityModule =
    await import(`../${compatibilityModulePath}`);
  const payloadBundle =
    await buildPayloadBundle();
  const warningSnapshot =
    clone(schemaSnapshot);
  const table =
    warningSnapshot.tables.find(
      (entry) => entry.tableName === "ebay_product_candidates",
    );

  table.columns.push({
    columnName:
      "futureOptionalMetadata",
    dataType:
      "domain_specific_type",
    isNullable:
      true,
  });

  const report =
    compatibilityModule.validatePayloadBundleAgainstStagingSchema(
      payloadBundle,
      warningSnapshot,
    );

  assert.equal(report.compatible, true);
  assert.equal(
    report.warnings.some((warning) => warning.includes("extra columns")),
    true,
  );
  assert.equal(
    report.warnings.some((warning) => warning.includes("type not verifiable locally")),
    true,
  );
});

test("schema compatibility blocks payloads without dryRun", async () => {
  const compatibilityModule =
    await import(`../${compatibilityModulePath}`);
  const payloadBundle =
    clone(await buildPayloadBundle());

  payloadBundle.payloadsByTable.ebay_product_candidates[0].dryRun = false;

  const report =
    compatibilityModule.validatePayloadBundleAgainstStagingSchema(
      payloadBundle,
      schemaSnapshot,
    );

  assert.equal(report.compatible, false);
  assert.equal(
    report.errors.some((error) => error.includes("dryRun required")),
    true,
  );
});

test("schema compatibility blocks payloads without stagingOnly", async () => {
  const compatibilityModule =
    await import(`../${compatibilityModulePath}`);
  const payloadBundle =
    clone(await buildPayloadBundle());

  payloadBundle.payloadsByTable.ebay_candidate_scores[0].stagingOnly = false;

  const report =
    compatibilityModule.validatePayloadBundleAgainstStagingSchema(
      payloadBundle,
      schemaSnapshot,
    );

  assert.equal(report.compatible, false);
  assert.equal(
    report.errors.some((error) => error.includes("stagingOnly required")),
    true,
  );
});

test("schema compatibility blocks payloads without approvalRequired", async () => {
  const compatibilityModule =
    await import(`../${compatibilityModulePath}`);
  const payloadBundle =
    clone(await buildPayloadBundle());

  payloadBundle.payloadsByTable.ebay_candidate_validations[0].approvalRequired = false;

  const report =
    compatibilityModule.validatePayloadBundleAgainstStagingSchema(
      payloadBundle,
      schemaSnapshot,
    );

  assert.equal(report.compatible, false);
  assert.equal(
    report.errors.some((error) => error.includes("approvalRequired required")),
    true,
  );
});

test("schema compatibility blocks payloads without dedupeKey or idempotency key", async () => {
  const compatibilityModule =
    await import(`../${compatibilityModulePath}`);
  const payloadBundle =
    clone(await buildPayloadBundle());

  delete payloadBundle.payloadsByTable.ebay_profit_scenarios[0].dedupeKey;

  const report =
    compatibilityModule.validatePayloadBundleAgainstStagingSchema(
      payloadBundle,
      schemaSnapshot,
    );

  assert.equal(report.compatible, false);
  assert.equal(
    report.errors.some((error) => error.includes("dedupeKey required")),
    true,
  );
});

test("CLI dry-run is wired to compatibility pipeline and expected output", async () => {
  const cliSource =
    readText(cliPath);

  assert.equal(cliSource.includes("runLunaPortexStagingScanDryRun"), true);
  assert.equal(cliSource.includes("buildLunaPortexStagingWritePlan"), true);
  assert.equal(cliSource.includes("buildLunaPortexStagingWritePayloads"), true);
  assert.equal(cliSource.includes("buildLunaPortexStagingExecutionPlan"), true);
  assert.equal(cliSource.includes("simulateStagingWriteExecution"), true);
  assert.equal(cliSource.includes("validatePayloadBundleAgainstStagingSchema"), true);
  assert.equal(cliSource.includes("summarizeStagingSchemaCompatibilityReport"), true);
  assert.equal(cliSource.includes("console.log"), true);
  assert.equal(cliSource.includes("writeFile"), false);
  assert.equal(cliSource.includes("appendFile"), false);

  const compatibilityModule =
    await import(`../${compatibilityModulePath}`);
  const payloadBundle =
    await buildPayloadBundle();
  const report =
    compatibilityModule.validatePayloadBundleAgainstStagingSchema(
      payloadBundle,
      schemaSnapshot,
    );
  const summary =
    compatibilityModule.summarizeStagingSchemaCompatibilityReport(report);

  assert.equal(summary.eligibleCandidates, 3);
  assert.equal(summary.blockedCandidates, 1);
  assert.equal(summary.payloadTablesChecked, 4);
  assert.equal(summary.payloadsChecked, 12);
  assert.equal(summary.schemaTablesChecked, 4);
  assert.equal(summary.compatible, true);
  assert.deepEqual(summary.incompatibleTables, []);
  assert.deepEqual(summary.missingRequiredColumns, []);
  assert.equal(summary.readOnlySqlPrepared, true);
  assert.equal(summary.realSchemaInspectionExecutedInThisLoop, false);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.approvalRequiredBeforeWrite, true);
  assert.deepEqual(summary.warnings, []);
});

test("route helper points LOOP 140 to LOOP 141", async () => {
  const routeModule =
    await import(`../${routeModulePath}`);
  const nextLoop =
    routeModule.getNextEbayProLoop("140");

  assert.equal(nextLoop.loopId, "141");
  assert.equal(nextLoop.label, "Approved Staging Write de 3 candidatos");
});

test("schema compatibility files avoid external clients and runtime patterns", () => {
  for (const path of [
    docPath,
    fixturePath,
    schemaSnapshotPath,
    compatibilityModulePath,
    cliPath,
  ]) {
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

test("repository status does not include env, dump, backup, or image files", () => {
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
