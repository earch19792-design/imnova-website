import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const repoRoot =
  process.cwd();
const fixturePath =
  "tools/fixtures/ebay-pro-official-route-pre139-v1.json";
const modulePath =
  "lib/ebay/ebay-pro-official-route.ts";
const workstreamDocPath =
  "docs/ebay-pro-isolation/EBAY_PRO_STAGING_WORKSTREAM_PRE139.md";
const routeDocPath =
  "docs/ebay-pro-isolation/EBAY_PRO_OFFICIAL_ROUTE_139_153.md";
const definitionOfDoneDocPath =
  "docs/engineering/EBAY_PRO_DEFINITION_OF_DONE_V1.md";

function readText(path) {
  return readFileSync(
    join(repoRoot, path),
    "utf8",
  );
}

function readJson(path) {
  return JSON.parse(
    readText(path),
  );
}

function fileExists(path) {
  try {
    return statSync(
      join(repoRoot, path),
    ).isFile();
  } catch {
    return false;
  }
}

function listFiles(path) {
  const root =
    join(repoRoot, path);
  const results =
    [];

  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath =
        join(current, entry.name);

      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === ".next" ||
          entry.name === ".git"
        ) {
          continue;
        }

        walk(fullPath);
        continue;
      }

      if (entry.isFile()) {
        results.push(
          relative(repoRoot, fullPath),
        );
      }
    }
  }

  walk(root);
  return results;
}

const fixture =
  readJson(fixturePath);

test("official route fixture locks PRE-139 through 153", () => {
  assert.equal(fixture.version, "EBAY_PRO_OFFICIAL_ROUTE_PRE139_V1");
  assert.equal(fixture.status, "OFFICIAL_ROUTE_LOCKED");
  assert.equal(fixture.route[0].loopId, "PRE-139");
  assert.equal(fixture.route.at(-1).loopId, "153");
  assert.equal(fixture.route.length, 16);
});

test("official route contains required loop labels", () => {
  const routeById =
    new Map(
      fixture.route.map((loop) => [loop.loopId, loop.label]),
    );

  assert.equal(routeById.get("139"), "Execution Harness con candado");
  assert.match(routeById.get("142"), /Automatic Scan Foundation/);
  assert.match(routeById.get("143"), /Pricing Psychology Inputs/);
  assert.match(routeById.get("143"), /Sold Price Intelligence/);
  assert.match(routeById.get("143"), /Direct Sourcing Signals/);
  assert.match(routeById.get("144"), /Price Confidence Score/);
  assert.match(routeById.get("144"), /Price War Risk Score/);
  assert.match(routeById.get("144"), /Perceived Value Score/);
  assert.match(routeById.get("144"), /Margin Protection Score/);
  assert.match(routeById.get("145"), /WhatsApp Mobile Approval/);
  assert.match(routeById.get("145"), /Pricing Advisor/);
  assert.match(routeById.get("146"), /Value-Based Pricing Strategy/);
  assert.match(routeById.get("146"), /Trust-Based Listing Optimization/);
  assert.match(routeById.get("147"), /Perceived Value Image Check/);
  assert.match(routeById.get("151"), /eBay Active Listings View Mapping/);
  assert.match(routeById.get("151"), /Reminder: configure and order eBay Seller Hub active listing columns/);
  assert.match(routeById.get("152"), /eBay Listing Data Sync/);
  assert.match(routeById.get("152"), /Automatic Luna Portex Scan/);
  assert.match(routeById.get("152"), /Supplier Stock Guard/);
  assert.match(routeById.get("152"), /WhatsApp Seller Alerts/);
  assert.match(routeById.get("152"), /Price Adjustment Alerts/);
  assert.match(routeById.get("152"), /Price War Protection/);
  assert.match(routeById.get("153"), /Direct Supplier \/ Brand Sourcing Pipeline/);
});

test("workstream policy freezes Production and reserves Staging", () => {
  assert.equal(fixture.production.frozen, true);
  assert.equal(fixture.production.coreOnly, true);
  assert.equal(fixture.production.ebayProEnabled, false);
  assert.equal(fixture.staging.reservedForEbayPro, true);
  assert.equal(fixture.staging.futureBaseBranch, "staging/ebay-pro-seller-os");
  assert.equal(
    fixture.main.stabilityRule,
    "no ebay pro workstream merges unless checkpoint approved",
  );
  assert.equal(fixture.ebayDeveloper.sandboxKeysetCreated, true);
  assert.equal(fixture.ebayDeveloper.useBeforeLoop148, false);
});

test("official route module exports pure route helpers", async () => {
  const routeModule =
    await import(`../${modulePath}`);

  assert.equal(
    routeModule.EBAY_PRO_OFFICIAL_ROUTE_VERSION,
    fixture.version,
  );
  assert.equal(
    routeModule.EBAY_PRO_FUTURE_BASE_BRANCH,
    "staging/ebay-pro-seller-os",
  );
  assert.deepEqual(
    routeModule.EBAY_PRO_SEMAPHORE_STATUSES,
    ["GREEN", "YELLOW", "RED"],
  );
  assert.equal(
    routeModule.EBAY_PRO_OFFICIAL_ROUTE[0].loopId,
    "PRE-139",
  );
  assert.equal(
    routeModule.EBAY_PRO_OFFICIAL_ROUTE.at(-1).loopId,
    "153",
  );
  assert.deepEqual(
    routeModule.getNextEbayProLoop("PRE-139"),
    {
      loopId: "139",
      label: "Execution Harness con candado",
    },
  );
  assert.equal(
    routeModule.getNextEbayProLoop("153"),
    null,
  );
  assert.equal(
    routeModule.validateEbayProOfficialRoute(
      routeModule.EBAY_PRO_OFFICIAL_ROUTE,
    ).valid,
    true,
  );
});

test("Definition of Done and human explanation rules are complete", async () => {
  const routeModule =
    await import(`../${modulePath}`);

  assert.equal(routeModule.EBAY_PRO_DEFINITION_OF_DONE.length, 20);
  assert.equal(
    routeModule.validateLoopDefinitionOfDoneChecklist(
      routeModule.EBAY_PRO_DEFINITION_OF_DONE,
    ).valid,
    true,
  );
  assert.equal(
    routeModule.validateHumanExplanationSections(
      routeModule.EBAY_PRO_HUMAN_EXPLANATION_REQUIRED_SECTIONS,
    ).valid,
    true,
  );

  const requiredHumanSections = [
    "Que se hizo.",
    "Por que se hizo.",
    "Que problema resuelve.",
    "Que protegio.",
    "Que cambio realmente.",
    "Que NO se toco.",
    "Como esto nos acerca a vender en eBay.",
    "Que sigue exactamente en la ruta oficial.",
  ];

  assert.deepEqual(
    routeModule.EBAY_PRO_HUMAN_EXPLANATION_REQUIRED_SECTIONS,
    requiredHumanSections,
  );
});

test("semaphore allows only GREEN, YELLOW, and RED", () => {
  assert.deepEqual(
    fixture.semaphore.allowedStatuses,
    ["GREEN", "YELLOW", "RED"],
  );
});

test("documents include required PRE-139 operating rules", () => {
  for (const path of [
    workstreamDocPath,
    routeDocPath,
    definitionOfDoneDocPath,
  ]) {
    assert.equal(fileExists(path), true, `${path} should exist`);
  }

  const workstreamDoc =
    readText(workstreamDocPath);
  const routeDoc =
    readText(routeDocPath);
  const definitionDoc =
    readText(definitionOfDoneDocPath);

  assert.match(workstreamDoc, /Production is frozen for eBay Pro/);
  assert.match(workstreamDoc, /Staging is the eBay Pro workshop/);
  assert.match(workstreamDoc, /staging\/ebay-pro-seller-os/);
  assert.match(workstreamDoc, /Sandbox keyset must not be used until LOOP 148/);
  assert.match(workstreamDoc, /139 — Execution Harness con candado/);
  assert.match(routeDoc, /PRE-139 — eBay Pro Staging Workstream Structure/);
  assert.match(routeDoc, /153 — Direct Supplier \/ Brand Sourcing Pipeline/);
  assert.match(definitionDoc, /Mandatory Definition Of Done Per Loop/);
  assert.match(definitionDoc, /GREEN: funciona/);
});

test("official route files avoid external clients and runtime actions", () => {
  const files = [
    fixturePath,
    modulePath,
    workstreamDocPath,
    routeDocPath,
    definitionOfDoneDocPath,
  ];
  const forbiddenPatterns = [
    ["create", "Client"].join(""),
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

  for (const file of files) {
    const content =
      readText(file);

    for (const pattern of forbiddenPatterns) {
      assert.equal(
        content.includes(pattern),
        false,
        `${file} contains ${pattern}`,
      );
    }
  }
});

test("no env, dump, backup, or image files were added for PRE-139", () => {
  const changedFiles =
    listFiles(".").filter((path) =>
      path.includes("ebay-pro-official-route") ||
      path.includes("EBAY_PRO_STAGING_WORKSTREAM_PRE139") ||
      path.includes("EBAY_PRO_OFFICIAL_ROUTE_139_153") ||
      path.includes("EBAY_PRO_DEFINITION_OF_DONE_V1"),
    );
  const blockedExtensions =
    /\.(dump|sql\.dump|backup|png|jpg|jpeg|webp|gif|svg|avif|heic|tiff)$/i;

  assert.equal(
    changedFiles.some((path) => /\.env($|\.|\/)/.test(path)),
    false,
  );
  assert.equal(
    changedFiles.some((path) => blockedExtensions.test(path)),
    false,
  );
});
