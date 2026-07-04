import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixturePath =
  "tools/fixtures/local-vm-lab-first-scan-readiness-v1.json";
const modulePath =
  "lib/ebay/local-vm-lab-readiness.ts";
const docPath =
  "docs/ebay-pro-isolation/LOCAL_VM_LAB_FIRST_SCAN_READINESS_V1.md";

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

const forbiddenPatterns = [
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
  ["console", "."].join(""),
  ["postgres", "://"].join(""),
  ["postgresql", "://"].join(""),
  ["supabase", ".co"].join(""),
  ["access", "_token"].join(""),
  ["refresh", "_token"].join(""),
  ["client", "_secret"].join(""),
];

test("local VM lab readiness fixture records static safety state", () => {
  assert.equal(
    fixture.readinessVersion,
    "LOCAL_VM_LAB_FIRST_SCAN_READINESS_V1",
  );
  assert.equal(
    fixture.status,
    "LOCAL_VM_LAB_FIRST_SCAN_READINESS_DOCUMENTED",
  );
  assert.equal(fixture.mode, "STATIC_READINESS_NO_CONNECTIONS");
  assert.equal(fixture.production.productionCoreOnly, true);
  assert.equal(fixture.production.productionEbayProDataCleaned, true);
  assert.equal(fixture.production.productionTargetTablesExactRowsZero, true);
  assert.equal(fixture.staging.stagingReservedForEbayPro, true);
  assert.equal(fixture.localVmLab.localVmConnectedInThisLoop, false);
  assert.equal(fixture.localVmLab.localVmPlannedForHeavyProcessing, true);
  assert.equal(
    fixture.firstScan.firstRealLunaPortexScanReadyForPlanning,
    true,
  );
  assert.equal(fixture.whatsapp.whatsappDryRunDefault, true);
  assert.equal(fixture.safetyFlags.noProductionWrites, true);
  assert.equal(fixture.safetyFlags.noDbConnectionsInThisLoop, true);
  assert.equal(fixture.safetyFlags.noSecretsCommitted, true);
  assert.equal(fixture.safetyFlags.noVmConnection, true);
});

test("local VM lab readiness module is pure and static", () => {
  assert.equal(fileExists(modulePath), true);

  const source =
    readText(modulePath);

  assert.equal(
    source.includes("LOCAL_VM_LAB_FIRST_SCAN_READINESS_V1"),
    true,
  );
  assert.equal(source.includes("getLocalVmLabReadiness"), true);
  assert.equal(
    source.includes("getFirstRealLunaPortexScanReadinessChecklist"),
    true,
  );
  assert.equal(source.includes("getLocalVmLabDataBoundaries"), true);
  assert.equal(source.includes("getLocalVmLabFutureConnectionRunbook"), true);

  for (const pattern of forbiddenPatterns) {
    assert.equal(
      source.includes(pattern),
      false,
      `${modulePath} contains ${pattern}`,
    );
  }
});

test("readiness document defines Production, Staging, VM, and WhatsApp rules", () => {
  assert.equal(fileExists(docPath), true);

  const doc =
    readText(docPath);

  assert.equal(doc.includes("IMNOVA Production remains Core-only"), true);
  assert.equal(doc.includes("Staging is the controlled eBay Pro environment"), true);
  assert.equal(doc.includes("Local VM/Lab is reserved for heavy processing"), true);
  assert.equal(doc.includes("first real Luna Portex scan"), true);
  assert.equal(doc.includes("dry-run by default"), true);
  assert.equal(doc.includes("does not connect to a VM"), true);
  assert.equal(doc.includes("No SQL or migrations"), true);
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
