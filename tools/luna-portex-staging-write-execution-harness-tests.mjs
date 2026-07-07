import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixturePath =
  "tools/fixtures/luna-portex-staging-write-execution-harness-v1.json";
const catalogPath =
  "tools/fixtures/luna-portex-staging-scan-sample-catalog-v1.json";
const scanModulePath =
  "lib/ebay/luna-portex-staging-scan-dry-run-executor.ts";
const gateModulePath =
  "lib/ebay/luna-portex-staging-write-gate.ts";
const adapterModulePath =
  "lib/ebay/luna-portex-staging-write-adapter.ts";
const harnessModulePath =
  "lib/ebay/luna-portex-staging-write-execution-harness.ts";
const routeModulePath =
  "lib/ebay/ebay-pro-official-route.ts";
const cliPath =
  "tools/luna-portex-staging-write-execution-harness-dry-run.mjs";
const docPath =
  "docs/ebay-pro-isolation/LUNA_PORTEX_STAGING_WRITE_EXECUTION_HARNESS_V1.md";

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

async function buildAdapterPayloads() {
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const fixture =
  readJson(fixturePath);

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
  ["http", "://"].join(""),
  ["https", "://"].join(""),
];

test("execution harness fixture is ready and write-safe", () => {
  assert.equal(
    fixture.harnessVersion,
    "LUNA_PORTEX_STAGING_WRITE_EXECUTION_HARNESS_V1",
  );
  assert.equal(
    fixture.status,
    "STAGING_WRITE_EXECUTION_HARNESS_READY_NOT_EXECUTED",
  );
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_EXECUTION_PLAN_ONLY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.reservedForEbayPro, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.staging.realWriterConnected, false);
  assert.equal(fixture.staging.writeApprovalRequired, true);
  assert.equal(fixture.safetyFlags.noDbConnections, true);
  assert.equal(fixture.safetyFlags.noStagingWritesInThisLoop, true);
});

test("harness accepts valid adapter payloads and simulates execution only", async () => {
  const harnessModule =
    await import(`../${harnessModulePath}`);
  const payloads =
    await buildAdapterPayloads();
  const plan =
    harnessModule.buildLunaPortexStagingExecutionPlan(payloads);
  const simulation =
    harnessModule.simulateStagingWriteExecution(plan);

  assert.equal(payloads.eligibleCandidates, 3);
  assert.equal(payloads.blockedCandidates, 1);
  assert.equal(plan.validation.valid, true);
  assert.equal(plan.payloadsValidated, 12);
  assert.equal(plan.executionOperationsPlanned, 12);
  assert.deepEqual(plan.tablesPlanned, fixture.allowedTables);
  assert.deepEqual(plan.dedupeKeys, [
    "luna-portex:first_real_luna_portex_scan:lp-dry-001",
    "luna-portex:first_real_luna_portex_scan:lp-dry-002",
    "luna-portex:first_real_luna_portex_scan:lp-dry-004",
  ]);
  assert.equal(plan.approvalRequired, true);
  assert.equal(plan.simulatedExecutionOnly, true);
  assert.equal(plan.stagingWriteExecuted, false);
  assert.equal(plan.executionReadyForFutureApproval, true);
  assert.equal(simulation.simulatedExecutionOnly, true);
  assert.equal(simulation.stagingWriteExecuted, false);
  assert.equal(simulation.executionReadyForFutureApproval, true);
});

test("harness blocks forbidden tables and production targets", async () => {
  const harnessModule =
    await import(`../${harnessModulePath}`);
  const payloads =
    clone(await buildAdapterPayloads());

  payloads.payloadsByTable.products = [
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

  const validation =
    harnessModule.validateStagingExecutionPayloads(payloads);

  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((error) => error.includes("table not allowed")),
    true,
  );
  assert.equal(
    validation.errors.some((error) => error.includes("forbidden table target")),
    true,
  );
});

test("harness blocks payloads without dedupeKey", async () => {
  const harnessModule =
    await import(`../${harnessModulePath}`);
  const payloads =
    clone(await buildAdapterPayloads());

  delete payloads.payloadsByTable.ebay_product_candidates[0].dedupeKey;

  const validation =
    harnessModule.validateStagingExecutionPayloads(payloads);

  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((error) => error.includes("dedupeKey required")),
    true,
  );
});

test("harness blocks payloads without dryRun", async () => {
  const harnessModule =
    await import(`../${harnessModulePath}`);
  const payloads =
    clone(await buildAdapterPayloads());

  payloads.payloadsByTable.ebay_candidate_scores[0].dryRun = false;

  const validation =
    harnessModule.validateStagingExecutionPayloads(payloads);

  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((error) => error.includes("dryRun required")),
    true,
  );
});

test("harness blocks payloads without stagingOnly", async () => {
  const harnessModule =
    await import(`../${harnessModulePath}`);
  const payloads =
    clone(await buildAdapterPayloads());

  payloads.payloadsByTable.ebay_candidate_validations[0].stagingOnly = false;

  const validation =
    harnessModule.validateStagingExecutionPayloads(payloads);

  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((error) => error.includes("stagingOnly required")),
    true,
  );
});

test("harness blocks payloads without approvalRequired", async () => {
  const harnessModule =
    await import(`../${harnessModulePath}`);
  const payloads =
    clone(await buildAdapterPayloads());

  payloads.payloadsByTable.ebay_profit_scenarios[0].approvalRequired = false;

  const validation =
    harnessModule.validateStagingExecutionPayloads(payloads);

  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((error) => error.includes("approvalRequired required")),
    true,
  );
});

test("harness blocks more than 20 candidates", async () => {
  const harnessModule =
    await import(`../${harnessModulePath}`);
  const payloads =
    clone(await buildAdapterPayloads());

  payloads.eligibleCandidates = 21;

  const validation =
    harnessModule.validateStagingExecutionPayloads(payloads);

  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.includes("too many execution candidates"),
    true,
  );
});

test("harness keeps real writes blocked even with approval granted in LOOP 139", async () => {
  const harnessModule =
    await import(`../${harnessModulePath}`);
  const payloads =
    await buildAdapterPayloads();
  const plan =
    harnessModule.buildLunaPortexStagingExecutionPlan(payloads);
  const simulation =
    harnessModule.simulateStagingWriteExecution(
      plan,
      {
        approvalGranted:
          true,
      },
    );

  assert.equal(
    harnessModule.shouldBlockStagingExecution(plan, { approvalGranted: false }),
    true,
  );
  assert.equal(
    harnessModule.shouldBlockStagingExecution(plan, { approvalGranted: true }),
    false,
  );
  assert.equal(simulation.approvalGranted, true);
  assert.equal(simulation.simulatedExecutionOnly, true);
  assert.equal(simulation.stagingWriteExecuted, false);
  assert.equal(
    simulation.operations.every((operation) => operation.writeExecuted === false),
    true,
  );
});

test("CLI dry-run is wired to the full local pipeline and expected summary", async () => {
  const cliSource =
    readText(cliPath);

  assert.equal(cliSource.includes("runLunaPortexStagingScanDryRun"), true);
  assert.equal(cliSource.includes("buildLunaPortexStagingWritePlan"), true);
  assert.equal(cliSource.includes("buildLunaPortexStagingWritePayloads"), true);
  assert.equal(cliSource.includes("buildLunaPortexStagingExecutionPlan"), true);
  assert.equal(cliSource.includes("simulateStagingWriteExecution"), true);
  assert.equal(cliSource.includes("summarizeStagingExecutionSimulation"), true);
  assert.equal(cliSource.includes("console.log"), true);
  assert.equal(cliSource.includes("writeFile"), false);
  assert.equal(cliSource.includes("appendFile"), false);

  const harnessModule =
    await import(`../${harnessModulePath}`);
  const payloads =
    await buildAdapterPayloads();
  const plan =
    harnessModule.buildLunaPortexStagingExecutionPlan(payloads);
  const simulation =
    harnessModule.simulateStagingWriteExecution(plan);
  const summary =
    harnessModule.summarizeStagingExecutionSimulation(simulation);

  assert.equal(summary.eligibleCandidates, 3);
  assert.equal(summary.blockedCandidates, 1);
  assert.equal(summary.payloadsValidated, 12);
  assert.equal(summary.executionOperationsPlanned, 12);
  assert.deepEqual(summary.tablesPlanned, fixture.allowedTables);
  assert.deepEqual(summary.dedupeKeys, [
    "luna-portex:first_real_luna_portex_scan:lp-dry-001",
    "luna-portex:first_real_luna_portex_scan:lp-dry-002",
    "luna-portex:first_real_luna_portex_scan:lp-dry-004",
  ]);
  assert.equal(summary.approvalRequired, true);
  assert.equal(summary.simulatedExecutionOnly, true);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.executionReadyForFutureApproval, true);
});

test("route helper points LOOP 139 to LOOP 140", async () => {
  const routeModule =
    await import(`../${routeModulePath}`);
  const nextLoop =
    routeModule.getNextEbayProLoop("139");

  assert.equal(nextLoop.loopId, "140");
  assert.equal(nextLoop.label, "Staging schema compatibility");
});

test("harness files avoid external clients and runtime patterns", () => {
  for (const path of [docPath, fixturePath, harnessModulePath, cliPath]) {
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
