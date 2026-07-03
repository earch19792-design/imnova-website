import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/ebay-pro-staging-lab-module-identity-v1.json";
const manifestPath =
  "lib/ebay/professional-suite-manifest.ts";
const hubPath =
  "app/admin/ebay-pro/page.tsx";
const boundaryPath =
  "lib/ebay/environment-boundaries.ts";
const sidebarPath =
  "app/admin/sidebar.tsx";

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

const forbiddenRuntimePatterns = [
  ["create", "Client"].join(""),
  ["create", "Server", "Client"].join(""),
  "supabase",
  [".", "from", "("].join(""),
  [".", "select", "("].join(""),
  [".", "insert", "("].join(""),
  [".", "update", "("].join(""),
  [".", "delete", "("].join(""),
  [".", "upsert", "("].join(""),
  [".", "rpc", "("].join(""),
  ["fetch", "("].join(""),
  "getProducts",
  ["process", "env"].join("."),
  ["new ", "OpenAI"].join(""),
  ["images", "generate"].join("."),
  ["create", "Draft"].join(""),
  ["publish", "Listing"].join(""),
  "market-radar-panel",
  "ebay-winner-pipeline-panel",
  "components/admin/market-radar-panel",
  "components/admin/ebay-winner-pipeline-panel",
  "ebay-listing-package/page",
];

function isEbayProPath(pathname) {
  const blockedPaths = [
    "/admin/ebay-pro",
    "/admin/market-radar",
    "/admin/ebay-seller-os",
    "/admin/ebay-listing",
    "/admin/ebay-listing-package",
    "/admin/ebay-listings",
    "/admin/ebay-image-generator",
    "/api/admin/market-radar",
    "/api/admin/ebay-winner-pipeline",
    "/api/admin/active-listing-risks",
    "/api/admin/ebay/oauth",
  ];

  return blockedPaths.some(
    blockedPath =>
      pathname === blockedPath ||
      pathname.startsWith(`${blockedPath}/`)
  );
}

function isAllowed({
  runtime = "production",
  pathname = "/",
}) {
  const production =
    runtime === "production";

  return !(
    production &&
    isEbayProPath(pathname)
  );
}

test("module identity fixture declares eBay Pro as staging/lab-only", () => {
  assert.equal(
    fixture.moduleIdentityVersion,
    "EBAY_PRO_STAGING_LAB_MODULE_IDENTITY_V1",
  );
  assert.equal(
    fixture.status,
    "EBAY_PRO_DECLARED_STAGING_LAB_ONLY_MODULE",
  );
  assert.equal(
    fixture.mode,
    "OPERATIONAL_INDEPENDENCE_FAST_TRACK",
  );
  assert.equal(
    fixture.suite.independentOperationalModule,
    true,
  );
  assert.equal(
    fixture.suite.stagingLabOnly,
    true,
  );
  assert.equal(
    fixture.suite.physicallySeparateDatabase,
    false,
  );
  assert.equal(
    fixture.production.ebayProAllowed,
    false,
  );
  assert.equal(
    fixture.staging.ebayProAllowed,
    true,
  );
  assert.equal(
    fixture.localNetworkVm.connectedInThisLoop,
    false,
  );
  assert.equal(
    fixture.safetyFlags.productionCoreProtected,
    true,
  );
  assert.equal(
    fixture.safetyFlags.ebayProProductionDisabled,
    true,
  );
  assert.equal(
    fixture.safetyFlags.ebayProStagingLabOnly,
    true,
  );
});

test("professional suite manifest is pure and declares routes", () => {
  assert.equal(
    fileExists(manifestPath),
    true,
  );

  const content =
    readText(manifestPath);

  assert.equal(
    content.includes("EBAY_PRO_STAGING_LAB_MODULE_IDENTITY_V1"),
    true,
  );
  assert.equal(
    content.includes("eBay Professional Seller Suite"),
    true,
  );
  assert.equal(
    content.includes("/admin/ebay-pro"),
    true,
  );
  assert.equal(
    content.includes("/api/admin/ebay-winner-pipeline"),
    true,
  );

  for (const pattern of forbiddenRuntimePatterns.slice(0, 16)) {
    assert.equal(
      content.includes(pattern),
      false,
      `${manifestPath} contains ${pattern}`,
    );
  }
});

test("eBay Pro hub is lightweight and does not read data", () => {
  assert.equal(
    fileExists(hubPath),
    true,
  );

  const content =
    readText(hubPath);

  assert.equal(
    content.includes("eBay Professional Seller Suite"),
    true,
  );
  assert.equal(
    content.includes("bloqueado en produccion"),
    true,
  );
  assert.equal(
    content.includes("staging/lab"),
    true,
  );
  assert.equal(
    content.includes("Market Radar eBay"),
    true,
  );
  assert.equal(
    content.includes("eBay Seller OS"),
    true,
  );
  assert.equal(
    content.includes("eBay Listing"),
    true,
  );

  for (const pattern of forbiddenRuntimePatterns) {
    assert.equal(
      content.includes(pattern),
      false,
      `${hubPath} contains ${pattern}`,
    );
  }
});

test("environment boundary blocks eBay Pro hub in production", () => {
  const content =
    readText(boundaryPath);

  assert.equal(
    content.includes("/admin/ebay-pro"),
    true,
  );
  assert.equal(
    isAllowed({
      runtime: "production",
      pathname: "/admin/ebay-pro",
    }),
    false,
  );
  assert.equal(
    isAllowed({
      runtime: "staging",
      pathname: "/admin/ebay-pro",
    }),
    true,
  );
  assert.equal(
    isAllowed({
      runtime: "production",
      pathname: "/admin",
    }),
    true,
  );
  assert.equal(
    isAllowed({
      runtime: "production",
      pathname: "/store",
    }),
    true,
  );
});

test("sidebar links to eBay Pro Suite", () => {
  const content =
    readText(sidebarPath);

  assert.equal(
    content.includes("eBay Pro Suite"),
    true,
  );
  assert.equal(
    content.includes("/admin/ebay-pro"),
    true,
  );
});
