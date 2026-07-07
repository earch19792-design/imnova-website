import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixturePath =
  "tools/fixtures/luna-portex-approved-staging-write-3-candidates-v1.json";
const catalogPath =
  "tools/fixtures/luna-portex-staging-scan-sample-catalog-v1.json";
const schemaSnapshotPath =
  "tools/fixtures/luna-portex-staging-schema-snapshot-example-v1.json";
const scanModulePath =
  "lib/ebay/luna-portex-staging-scan-dry-run-executor.ts";
const gateModulePath =
  "lib/ebay/luna-portex-staging-write-gate.ts";
const adapterModulePath =
  "lib/ebay/luna-portex-staging-write-adapter.ts";
const schemaModulePath =
  "lib/ebay/luna-portex-staging-schema-compatibility.ts";
const approvedPlanModulePath =
  "lib/ebay/luna-portex-approved-staging-write-plan.ts";
const routeModulePath =
  "lib/ebay/ebay-pro-official-route.ts";
const cliPath =
  "tools/luna-portex-approved-staging-write-3-candidates.mjs";
const docPath =
  "docs/ebay-pro-isolation/LUNA_PORTEX_APPROVED_STAGING_WRITE_3_CANDIDATES_V1.md";

function readText(path) {
  return readFileSync(path, "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fileExists(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
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

async function buildCompatibilityReport(payloadBundle) {
  const schemaModule =
    await import(`../${schemaModulePath}`);
  const schemaSnapshot =
    readJson(schemaSnapshotPath);

  return schemaModule.validatePayloadBundleAgainstStagingSchema(
    payloadBundle,
    schemaSnapshot,
    {
      readOnlySqlPrepared:
        true,
    },
  );
}

async function buildApprovedPlan(payloadBundle) {
  const approvedPlanModule =
    await import(`../${approvedPlanModulePath}`);
  const schemaCompatibilityReport =
    await buildCompatibilityReport(payloadBundle);

  return approvedPlanModule.buildApprovedStagingWritePlan(
    payloadBundle,
    {
      schemaCompatibilityReport,
      maxCandidates:
        3,
      maxOperations:
        12,
    },
  );
}

const fixture =
  readJson(fixturePath);

test("approved staging write fixture is ready and bounded", () => {
  assert.equal(
    fixture.writeVersion,
    "LUNA_PORTEX_APPROVED_STAGING_WRITE_3_CANDIDATES_V1",
  );
  assert.equal(fixture.status, "APPROVED_STAGING_WRITE_READY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.writeAllowedInThisLoop, true);
  assert.equal(fixture.staging.writeMaxCandidates, 3);
  assert.equal(fixture.staging.writeMaxOperations, 12);
  assert.equal(fixture.staging.writeExecutedByDefault, false);
  assert.deepEqual(
    fixture.allowedTables,
    [
      "ebay_product_candidates",
      "ebay_candidate_scores",
      "ebay_candidate_validations",
      "ebay_profit_scenarios",
    ],
  );
  assert.deepEqual(
    fixture.expectedDedupeKeys,
    [
      "luna-portex:first_real_luna_portex_scan:lp-dry-001",
      "luna-portex:first_real_luna_portex_scan:lp-dry-002",
      "luna-portex:first_real_luna_portex_scan:lp-dry-004",
    ],
  );
  assert.equal(fixture.safetyFlags.noProductionWrites, true);
  assert.equal(fixture.safetyFlags.noEbayApi, true);
  assert.equal(fixture.safetyFlags.noOauth, true);
  assert.equal(fixture.safetyFlags.noTokens, true);
});

test("approved write plan builds exactly three candidates and twelve operations", async () => {
  const approvedPlanModule =
    await import(`../${approvedPlanModulePath}`);
  const payloadBundle =
    await buildPayloadBundle();
  const writePlan =
    await buildApprovedPlan(payloadBundle);
  const summary =
    approvedPlanModule.summarizeApprovedStagingWritePlan(writePlan);

  assert.equal(writePlan.validation.valid, true);
  assert.equal(summary.candidatesPlanned, 3);
  assert.equal(summary.operationsPlanned, 12);
  assert.equal(summary.tablesPlanned, 4);
  assert.deepEqual(summary.dedupeKeys, fixture.expectedDedupeKeys);
  assert.equal(summary.writeExecuted, false);
  assert.equal(summary.approvalRequired, true);
  assert.equal(summary.stagingOnly, true);
  assert.equal(summary.listableInEbay, false);
  assert.equal(summary.publishable, false);
});

test("approved write plan blocks more than three candidates", async () => {
  const payloadBundle =
    clone(await buildPayloadBundle());

  for (const tableName of fixture.allowedTables) {
    payloadBundle.payloadsByTable[tableName].push({
      ...payloadBundle.payloadsByTable[tableName][0],
      sourceId:
        "lp-dry-999",
      dedupeKey:
        "luna-portex:first_real_luna_portex_scan:lp-dry-999",
    });
  }

  payloadBundle.eligibleCandidates =
    4;
  payloadBundle.dedupeKeys.push("luna-portex:first_real_luna_portex_scan:lp-dry-999");

  const writePlan =
    await buildApprovedPlan(payloadBundle);

  assert.equal(writePlan.validation.valid, false);
  assert.equal(
    writePlan.validation.errors.some(error => error.includes("too many candidate")),
    true,
  );
});

test("approved write plan blocks more than twelve operations", async () => {
  const payloadBundle =
    clone(await buildPayloadBundle());

  payloadBundle.payloadsByTable.ebay_product_candidates.push({
    ...payloadBundle.payloadsByTable.ebay_product_candidates[0],
    sourceId:
      "lp-dry-001-extra",
  });

  const writePlan =
    await buildApprovedPlan(payloadBundle);

  assert.equal(writePlan.validation.valid, false);
  assert.equal(
    writePlan.validation.errors.some(error => error.includes("too many write operations")),
    true,
  );
});

test("approved write plan blocks missing dedupeKey", async () => {
  const payloadBundle =
    clone(await buildPayloadBundle());

  delete payloadBundle.payloadsByTable.ebay_candidate_scores[0].dedupeKey;

  const writePlan =
    await buildApprovedPlan(payloadBundle);

  assert.equal(writePlan.validation.valid, false);
  assert.equal(
    writePlan.validation.errors.some(error => error.includes("dedupeKey required")),
    true,
  );
});

test("approved write plan blocks missing dryRun, stagingOnly, and approvalRequired", async () => {
  const payloadBundle =
    clone(await buildPayloadBundle());

  payloadBundle.payloadsByTable.ebay_product_candidates[0].dryRun =
    false;
  payloadBundle.payloadsByTable.ebay_candidate_validations[0].stagingOnly =
    false;
  payloadBundle.payloadsByTable.ebay_profit_scenarios[0].approvalRequired =
    false;

  const writePlan =
    await buildApprovedPlan(payloadBundle);

  assert.equal(writePlan.validation.valid, false);
  assert.equal(
    writePlan.validation.errors.some(error => error.includes("dryRun required")),
    true,
  );
  assert.equal(
    writePlan.validation.errors.some(error => error.includes("stagingOnly required")),
    true,
  );
  assert.equal(
    writePlan.validation.errors.some(error => error.includes("approvalRequired required")),
    true,
  );
});

test("approved write plan blocks forbidden tables and Production targets", async () => {
  const payloadBundle =
    clone(await buildPayloadBundle());

  payloadBundle.payloadsByTable.products = [
    {
      tableName:
        "products",
      sourceId:
        "blocked",
      dedupeKey:
        "blocked-products",
      dryRun:
        true,
      stagingOnly:
        true,
      approvalRequired:
        true,
      writeExecuted:
        false,
      targetEnvironment:
        "production",
    },
  ];

  const writePlan =
    await buildApprovedPlan(payloadBundle);

  assert.equal(writePlan.validation.valid, false);
  assert.equal(
    writePlan.validation.errors.some(error => error.includes("table not allowed")),
    true,
  );
  assert.equal(
    writePlan.validation.errors.some(error => error.includes("Production target blocked")),
    true,
  );
});

test("post-write verification plan is explicit and idempotent", async () => {
  const approvedPlanModule =
    await import(`../${approvedPlanModulePath}`);
  const payloadBundle =
    await buildPayloadBundle();
  const writePlan =
    await buildApprovedPlan(payloadBundle);
  const verificationPlan =
    approvedPlanModule.buildPostWriteVerificationPlan(writePlan);

  assert.equal(verificationPlan.executionRunId, "loop141-approved-staging-write-v1");
  assert.equal(verificationPlan.postWriteVerificationRequired, true);
  assert.equal(verificationPlan.requireNoDuplicates, true);
  assert.equal(verificationPlan.expectedCandidates, 3);
  assert.equal(verificationPlan.expectedOperations, 12);
  assert.deepEqual(verificationPlan.dedupeKeys, fixture.expectedDedupeKeys);
  assert.deepEqual(
    Object.values(verificationPlan.expectedRowsByTable),
    [3, 3, 3, 3],
  );
});

test("default CLI dry-run is wired and plan prints expected numbers", async () => {
  const cliSource =
    readText(cliPath);
  const approvedPlanModule =
    await import(`../${approvedPlanModulePath}`);
  const payloadBundle =
    await buildPayloadBundle();
  const writePlan =
    await buildApprovedPlan(payloadBundle);
  const summary =
    approvedPlanModule.summarizeApprovedStagingWritePlan(writePlan);

  assert.equal(cliSource.includes("mode:"), true);
  assert.equal(cliSource.includes("\"dry-run\""), true);
  assert.equal(cliSource.includes("writeExecuted"), true);
  assert.equal(cliSource.includes("stagingWriteExecuted"), true);
  assert.equal(cliSource.includes("approvalRequired"), true);
  assert.equal(summary.candidatesPlanned, 3);
  assert.equal(summary.operationsPlanned, 12);
  assert.equal(summary.tablesPlanned, 4);
  assert.equal(summary.writeExecuted, false);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.approvalRequired, true);
});

test("execute mode requires explicit flags and exact approval", () => {
  const cliSource =
    readText(cliPath);

  assert.equal(cliSource.includes("--execute-approved-staging-write"), true);
  assert.equal(cliSource.includes("EBAY_PRO_TARGET_ENV"), true);
  assert.equal(cliSource.includes("EBAY_PRO_TARGET_ENV !== \"staging\""), true);
  assert.equal(cliSource.includes("EBAY_PRO_STAGING_WRITE_APPROVED"), true);
  assert.equal(
    cliSource.includes("APPROVE_LOOP_141_STAGING_WRITE_3_CANDIDATES"),
    true,
  );
  assert.equal(cliSource.includes("SUPABASE_STAGING_URL"), true);
  assert.equal(cliSource.includes("SUPABASE_STAGING_SERVICE_ROLE_KEY"), true);
  assert.equal(cliSource.includes("missingRequiredStagingEnvVars"), true);
  assert.equal(cliSource.includes("stagingWriteExecuted:"), true);
  assert.equal(cliSource.includes("false"), true);
});

test("route helper points LOOP 141 to LOOP 142", async () => {
  const routeModule =
    await import(`../${routeModulePath}`);
  const nextLoop =
    routeModule.getNextEbayProLoop("141");

  assert.equal(nextLoop.loopId, "142");
  assert.equal(
    nextLoop.label.includes("First Real Luna Portex Mini Scan"),
    true,
  );
});

test("pure module has no runtime client, env, filesystem, or external action patterns", () => {
  const source =
    readText(approvedPlanModulePath);
  const forbiddenPatterns = [
    ["create", "Client"].join(""),
    [".", "from", "("].join(""),
    [".", "upsert", "("].join(""),
    ["fetch", "("].join(""),
    ["process", ".env"].join(""),
    ["read", "File", "Sync"].join(""),
    ["new ", "OpenAI"].join(""),
    ["send", "WhatsApp"].join(""),
    ["send", "Whatsapp"].join(""),
  ];

  for (const pattern of forbiddenPatterns) {
    assert.equal(source.includes(pattern), false, `${approvedPlanModulePath} contains ${pattern}`);
  }
});

test("process env and Supabase client are restricted to LOOP 141 CLI", () => {
  const cliSource =
    readText(cliPath);

  assert.equal(cliSource.includes("process.env"), true);
  assert.equal(cliSource.includes("@supabase/supabase-js"), true);
  assert.equal(cliSource.includes("createClient"), true);
  assert.equal(cliSource.includes(".from("), true);
  assert.equal(cliSource.includes(".upsert("), true);
  assert.equal(cliSource.includes(".select("), true);
  assert.equal(cliSource.includes("console.log"), true);
  assert.equal(cliSource.includes("SUPABASE_STAGING_SERVICE_ROLE_KEY"), true);
  assert.equal(cliSource.includes("console.log(config.supabaseStagingServiceRoleKey)"), false);
});

test("LOOP 141 files avoid eBay, OpenAI, WhatsApp send, env files, dumps, and images", () => {
  for (const path of [
    fixturePath,
    approvedPlanModulePath,
    cliPath,
    docPath,
  ]) {
    assert.equal(fileExists(path), true);
    const source =
      readText(path);
    const forbiddenPatterns = [
      ["new ", "OpenAI"].join(""),
      ["images", ".generate"].join(""),
      ["create", "Draft"].join(""),
      ["publish", "Listing"].join(""),
      ["send", "WhatsApp"].join(""),
      ["send", "Whatsapp"].join(""),
      ["access", "_token"].join(""),
      ["refresh", "_token"].join(""),
      ["client", "_secret"].join(""),
      "Authorization:",
    ];

    for (const pattern of forbiddenPatterns) {
      assert.equal(source.includes(pattern), false, `${path} contains ${pattern}`);
    }
  }

  const status =
    spawnSync(
      "git",
      ["status", "--short", "--untracked-files=all"],
      {
        encoding:
          "utf8",
      },
    );

  assert.equal(status.status, 0);
  assert.equal(/\.env($|\.|\/)/.test(status.stdout), false);
  assert.equal(/\.(dump|sql\.dump|backup)$/im.test(status.stdout), false);
  assert.equal(/\.(png|jpg|jpeg|webp|gif|svg|avif|heic|tiff)$/im.test(status.stdout), false);
});
