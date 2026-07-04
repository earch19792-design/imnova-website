import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixturePath =
  "tools/fixtures/luna-portex-staging-write-adapter-v1.json";
const catalogPath =
  "tools/fixtures/luna-portex-staging-scan-sample-catalog-v1.json";
const scanModulePath =
  "lib/ebay/luna-portex-staging-scan-dry-run-executor.ts";
const gateModulePath =
  "lib/ebay/luna-portex-staging-write-gate.ts";
const adapterModulePath =
  "lib/ebay/luna-portex-staging-write-adapter.ts";
const cliPath =
  "tools/luna-portex-staging-write-adapter-dry-run.mjs";
const docPath =
  "docs/ebay-pro-isolation/LUNA_PORTEX_STAGING_WRITE_ADAPTER_V1.md";

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

test("write adapter fixture is ready and write-safe", () => {
  assert.equal(fixture.adapterVersion, "LUNA_PORTEX_STAGING_WRITE_ADAPTER_V1");
  assert.equal(fixture.status, "STAGING_WRITE_ADAPTER_READY_NOT_EXECUTED");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_PAYLOADS_ONLY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.reservedForEbayPro, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.staging.writeApprovalRequired, true);
  assert.equal(fixture.scanType, "FIRST_REAL_LUNA_PORTEX_SCAN");
  assert.equal(fixture.maxPayloadCandidates <= 20, true);
  assert.equal(fixture.payloadTables.includes("ebay_product_candidates"), true);
  assert.equal(fixture.forbiddenTables.includes("products"), true);
  assert.equal(fixture.safetyFlags.noProductionWrites, true);
  assert.equal(fixture.safetyFlags.noStagingWritesInThisLoop, true);
  assert.equal(fixture.safetyFlags.noDbConnections, true);
});

test("adapter builds dry-run payloads only for eligible write gate candidates", async () => {
  const scanModule =
    await import(`../${scanModulePath}`);
  const gateModule =
    await import(`../${gateModulePath}`);
  const adapterModule =
    await import(`../${adapterModulePath}`);

  const scanResult =
    scanModule.runLunaPortexStagingScanDryRun({
      catalog:
        catalog.items,
      maxProductsPerDryRun:
        20,
    });
  const writePlan =
    gateModule.buildLunaPortexStagingWritePlan(scanResult);
  const payloads =
    adapterModule.buildLunaPortexStagingWritePayloads(
      writePlan,
      {
        maxPayloadCandidates:
          fixture.maxPayloadCandidates,
      },
    );

  assert.equal(payloads.eligibleCandidates, 3);
  assert.equal(payloads.blockedCandidates, 1);
  assert.equal(payloads.approvalRequired, true);
  assert.equal(payloads.stagingWriteExecuted, false);
  assert.deepEqual(payloads.payloadTables, fixture.payloadTables);
  assert.equal(payloads.dedupeKeys.length, 3);
  assert.equal(new Set(payloads.dedupeKeys).size, 3);
  assert.equal(payloads.dedupeKeys.includes("luna-portex:first_real_luna_portex_scan:lp-dry-003"), false);

  for (const table of fixture.payloadTables) {
    assert.equal(payloads.payloadsByTable[table].length, 3);
    assert.equal(
      payloads.payloadsByTable[table].every(
        (row) =>
          row.dryRun === true &&
          row.stagingOnly === true &&
          row.approvalRequired === true &&
          row.sourceScanType === "FIRST_REAL_LUNA_PORTEX_SCAN" &&
          row.writeExecuted === false,
      ),
      true,
    );
  }

  for (const table of fixture.forbiddenTables) {
    assert.equal(Object.hasOwn(payloads.payloadsByTable, table), false);
  }
});

test("adapter blocks demo, blocked, and forbidden-table candidates", async () => {
  const adapterModule =
    await import(`../${adapterModulePath}`);

  const payloads =
    adapterModule.buildLunaPortexStagingWritePayloads({
      plannedWrites: [
        {
          sourceId: "demo",
          scanType: "PRE_BASELINE_DEMO",
          targetTables: fixture.payloadTables,
          approvalRequired: true,
          writeExecuted: false,
        },
        {
          sourceId: "blocked",
          scanType: "FIRST_REAL_LUNA_PORTEX_SCAN",
          targetTables: ["products"],
          approvalRequired: true,
          writeExecuted: false,
        },
        {
          sourceId: "eligible",
          scanType: "FIRST_REAL_LUNA_PORTEX_SCAN",
          targetTables: fixture.payloadTables,
          approvalRequired: true,
          writeExecuted: false,
          sellReady: true,
        },
      ],
      blockedCandidates: [
        {
          sourceId: "manual-blocked",
          reasons: ["fixture blocked"],
        },
      ],
    });

    assert.equal(payloads.eligibleCandidates, 1);
    assert.equal(payloads.blockedCandidates, 1);
    assert.equal(payloads.payloadsByTable.ebay_product_candidates[0].sourceId, "eligible");
});

test("dedupe keys are stable", async () => {
  const adapterModule =
    await import(`../${adapterModulePath}`);
  const candidate =
    {
      sourceId: "LP-DRY-001",
      scanType: "FIRST_REAL_LUNA_PORTEX_SCAN",
    };

  assert.equal(
    adapterModule.buildStagingDedupeKey(candidate),
    adapterModule.buildStagingDedupeKey(candidate),
  );
  assert.equal(
    adapterModule.buildStagingDedupeKey(candidate),
    "luna-portex:first_real_luna_portex_scan:lp-dry-001",
  );
});

test("adapter CLI is wired to local scan, gate, and payload summary output", () => {
  const source =
    readText(cliPath);

  assert.equal(source.includes("readFileSync(fixturePath"), true);
  assert.equal(source.includes("runLunaPortexStagingScanDryRun"), true);
  assert.equal(source.includes("buildLunaPortexStagingWritePlan"), true);
  assert.equal(source.includes("buildLunaPortexStagingWritePayloads"), true);
  assert.equal(source.includes("summarizeStagingWritePayloads"), true);
  assert.equal(source.includes("payloadsByTable:"), true);
  assert.equal(source.includes("writeFile"), false);
  assert.equal(source.includes("appendFile"), false);
});

test("adapter files avoid external clients and runtime patterns", () => {
  for (const path of [docPath, fixturePath, adapterModulePath, cliPath]) {
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
