import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixturePath =
  "tools/fixtures/local-vm-lab-connection-contract-v1.json";
const modulePath =
  "lib/ebay/local-vm-lab-connection-contract.ts";
const harnessPath =
  "tools/local-vm-lab-connection-dry-run.mjs";
const docPath =
  "docs/ebay-pro-isolation/LOCAL_VM_LAB_CONNECTION_CONTRACT_V1.md";

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

const forbiddenSourcePatterns = [
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
  ["net", "."].join(""),
  ["ssh", " "].join(""),
];

test("local VM lab connection contract fixture records static dry-run state", () => {
  assert.equal(
    fixture.contractVersion,
    "LOCAL_VM_LAB_CONNECTION_CONTRACT_V1",
  );
  assert.equal(fixture.status, "LOCAL_VM_LAB_CONNECTION_CONTRACT_READY");
  assert.equal(fixture.mode, "STATIC_CONTRACT_AND_DRY_RUN_ONLY");
  assert.equal(fixture.productionCoreOnly, true);
  assert.equal(fixture.productionEbayProDataCleaned, true);
  assert.equal(fixture.stagingReservedForEbayPro, true);
  assert.equal(fixture.localVmConnectedInThisLoop, false);
  assert.equal(fixture.localVmDryRunHarnessCreated, true);
  assert.equal(fixture.localVmNetworkCallsUsed, false);
  assert.equal(fixture.localVmDbWritesUsed, false);
  assert.equal(fixture.firstRealLunaPortexScanStillPending, true);
  assert.equal(fixture.whatsappDryRunDefault, true);
  assert.equal(fixture.secretsCommitted, false);
  assert.equal(fixture.envFilesCreated, false);

  const variables =
    new Map(
      fixture.futureEnvironmentVariables.map((variable) => [
        variable.name,
        variable.defaultValue,
      ]),
    );

  assert.equal(variables.get("LOCAL_VM_LAB_ENABLED"), "false");
  assert.equal(variables.get("LOCAL_VM_LAB_DRY_RUN"), "true");
  assert.equal(variables.has("LOCAL_VM_LAB_HOST"), true);
  assert.equal(variables.has("EBAY_PRO_RUNTIME"), true);
  assert.equal(variables.has("LUNA_PORTEX_SCAN_MODE"), true);
  assert.equal(fixture.safetyFlags.networkCallsUsed, false);
  assert.equal(fixture.safetyFlags.dbConnectionsInThisLoop, false);
  assert.equal(fixture.safetyFlags.envFilesCreated, false);
});

test("local VM lab connection module is pure and static", () => {
  assert.equal(fileExists(modulePath), true);

  const source =
    readText(modulePath);

  assert.equal(
    source.includes("LOCAL_VM_LAB_CONNECTION_CONTRACT_V1"),
    true,
  );
  assert.equal(source.includes("getLocalVmLabConnectionContract"), true);
  assert.equal(source.includes("getLocalVmLabDryRunStatus"), true);
  assert.equal(source.includes("getLocalVmLabFutureEnvironmentVariables"), true);

  for (const pattern of forbiddenSourcePatterns) {
    assert.equal(
      source.includes(pattern),
      false,
      `${modulePath} contains ${pattern}`,
    );
  }
});

test("dry-run harness is local-only and prints simulated readiness", () => {
  assert.equal(fileExists(harnessPath), true);

  const source =
    readText(harnessPath);

  for (const pattern of forbiddenSourcePatterns) {
    assert.equal(
      source.includes(pattern),
      false,
      `${harnessPath} contains ${pattern}`,
    );
  }

  assert.equal(source.includes("LOCAL_VM_LAB_CONNECTION_CONTRACT_V1"), true);
  assert.equal(source.includes("SIMULATED_NO_NETWORK_NO_DB"), true);
  assert.equal(source.includes("LOCAL_VM_LAB_DRY_RUN=true"), true);
  assert.equal(source.includes("console.log(JSON.stringify(dryRunResult"), true);
  assert.equal(source.includes("networkCallsUsed:"), true);
  assert.equal(source.includes("databaseConnectionsUsed:"), true);
  assert.equal(source.includes("databaseWritesUsed:"), true);
  assert.equal(source.includes("productionTouched:"), true);
});

test("contract document defines future connection rules without real values", () => {
  assert.equal(fileExists(docPath), true);

  const doc =
    readText(docPath);

  assert.equal(doc.includes("Production remains IMNOVA Core-only"), true);
  assert.equal(doc.includes("Staging remains the controlled eBay Pro environment"), true);
  assert.equal(doc.includes("Local VM/Lab is planned for heavy scans"), true);
  assert.equal(doc.includes("LOCAL_VM_LAB_ENABLED"), true);
  assert.equal(doc.includes("defaults to `false`"), true);
  assert.equal(doc.includes("defaults to `true`"), true);
  assert.equal(doc.includes("does not connect the VM/Lab"), true);
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
