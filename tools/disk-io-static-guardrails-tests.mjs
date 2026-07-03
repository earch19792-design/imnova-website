import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const fixturePath = "tools/fixtures/disk-io-static-guardrails-v1.json";
const docPath = "docs/disk-io/DISK_IO_STATIC_GUARDRAILS_V1.md";
const testPath = "tools/disk-io-static-guardrails-tests.mjs";

function readText(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function fileExists(path) {
  try {
    return statSync(join(repoRoot, path)).isFile();
  } catch {
    return false;
  }
}

function listCodeFiles(path) {
  const root = join(repoRoot, path);
  const results = [];

  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") {
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
        results.push(relative(repoRoot, fullPath));
      }
    }
  }

  walk(root);
  return results;
}

function countSelectStar(content) {
  return (content.match(/\.select\s*\(\s*["']\*["']\s*\)/g) || []).length;
}

const fixture = readJson(fixturePath);

test("disk IO guardrail fixture documents static analysis mode", () => {
  assert.equal(fixture.guardrailVersion, "DISK_IO_STATIC_GUARDRAILS_V1");
  assert.equal(fixture.status, "STATIC_GUARDRAILS_READY");
  assert.equal(fixture.mode, "STATIC_CODE_ANALYSIS_ONLY");
  assert.equal(fixture.doesNotQueryLiveSupabase, true);
  assert.equal(fixture.safetyFlags.staticAnalysisOnly, true);
  assert.equal(fixture.safetyFlags.liveSupabaseQueried, false);
  assert.equal(fixture.safetyFlags.supabaseWriteUsed, false);
  assert.equal(fixture.safetyFlags.sqlMigrationCreated, false);
  assert.equal(fixture.safetyFlags.ebayApiUsed, false);
});

test("lightweight admin hubs do not import heavy panels or read data", () => {
  const hubPaths = fixture.lightweightHubRules.protectedHubs;
  const blocked = [
    ...fixture.heavyPanelImportBlocklist,
    ...fixture.supabaseReadBlocklistForHubs,
  ];

  for (const hubPath of hubPaths) {
    assert.equal(fileExists(hubPath), true, `${hubPath} should exist`);
    const content = readText(hubPath);
    const violations = blocked.filter((pattern) => content.includes(pattern));
    assert.deepEqual(violations, [], `${hubPath} contains blocked lightweight hub patterns`);
  }
});

test("select-star reads cannot be added outside the known debt allowlist", () => {
  const allowlist = new Map(
    fixture.knownDebtAllowlist.map((item) => [item.path, item]),
  );
  const scanFiles = fixture.selectStarPolicy.scanPaths.flatMap(listCodeFiles);
  const violations = [];
  const overBaseline = [];

  for (const file of scanFiles) {
    const count = countSelectStar(readText(file));
    if (count === 0) {
      continue;
    }

    const allowlistItem = allowlist.get(file);
    if (!allowlistItem) {
      violations.push(`${file}: ${count}`);
      continue;
    }

    if (
      Number.isInteger(allowlistItem.maxAllowedOccurrences)
      && count > allowlistItem.maxAllowedOccurrences
    ) {
      overBaseline.push(`${file}: ${count} > ${allowlistItem.maxAllowedOccurrences}`);
    }
  }

  assert.deepEqual(violations, [], `select-star outside allowlist:\n${violations.join("\n")}`);
  assert.deepEqual(overBaseline, [], `allowlisted select-star count increased:\n${overBaseline.join("\n")}`);
});

test("future summary endpoints must remain narrow and read-only when created", () => {
  const optionalEndpoints = fixture.futureSummaryEndpointRules.endpoints;
  const writePatterns = ["insert", "update", "delete", "upsert", "rpc"].map((name) => `.${name}(`);
  const forbiddenExternalPatterns = [
    ["create", "Draft"].join(""),
    ["publish", "Listing"].join(""),
    ["images", "generate"].join("."),
    ["new ", "OpenAI"].join(""),
    ["openai", "images"].join("."),
    ["fetch", "("].join(""),
  ];

  for (const endpoint of optionalEndpoints) {
    if (!fileExists(endpoint)) {
      continue;
    }

    const content = readText(endpoint);
    assert.equal(countSelectStar(content), 0, `${endpoint} must not use select-star`);

    for (const pattern of writePatterns) {
      assert.equal(content.includes(pattern), false, `${endpoint} must not contain ${pattern}`);
    }

    for (const pattern of forbiddenExternalPatterns) {
      assert.equal(content.includes(pattern), false, `${endpoint} must not contain ${pattern}`);
    }

    const hasLimitOrRange =
      content.includes(".limit(")
      || content.includes(".range(")
      || (content.includes("count:") && content.includes("head:"));
    assert.equal(hasLimitOrRange, true, `${endpoint} must include limit, range or count/head summary mode`);
  }
});

test("new guardrail files do not contain secrets or executable external actions", () => {
  const files = [fixturePath, docPath, testPath];
  const secretPatterns = [
    new RegExp(["client", "secret"].join("_"), "i"),
    new RegExp(["Authorization", ":"].join("")),
    /Bearer\s+[A-Za-z0-9._-]{16,}/,
    new RegExp(`${["access", "token"].join("_")}\\s*[:=]\\s*["'][A-Za-z0-9._-]{16,}["']`, "i"),
    new RegExp(`${["refresh", "token"].join("_")}\\s*[:=]\\s*["'][A-Za-z0-9._-]{16,}["']`, "i"),
  ];
  const actionPatterns = [
    ["create", "Draft"].join(""),
    ["publish", "Listing"].join(""),
    ["images", "generate"].join("."),
  ];

  for (const file of files) {
    const content = readText(file);
    for (const pattern of secretPatterns) {
      assert.equal(pattern.test(content), false, `${file} contains a blocked secret-like pattern`);
    }

    for (const pattern of actionPatterns) {
      assert.equal(content.includes(pattern), false, `${file} contains ${pattern}`);
    }
  }
});
