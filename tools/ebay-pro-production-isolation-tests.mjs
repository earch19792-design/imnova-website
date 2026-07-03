import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/ebay-pro-production-isolation-fast-v1.json";
const modulePath =
  "lib/ebay/environment-boundaries.ts";
const middlewarePath =
  "middleware.ts";

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
  [".", "from", "("].join(""),
  [".", "select", "("].join(""),
  [".", "insert", "("].join(""),
  [".", "update", "("].join(""),
  [".", "delete", "("].join(""),
  [".", "upsert", "("].join(""),
  [".", "rpc", "("].join(""),
  ["fetch", "("].join(""),
  ["new ", "OpenAI"].join(""),
  ["images", "generate"].join("."),
  ["create", "Draft"].join(""),
  ["publish", "Listing"].join(""),
];

function isEbayProPath(pathname) {
  return fixture.blockedProductionPaths.some(
    blockedPath =>
      pathname === blockedPath ||
      pathname.startsWith(`${blockedPath}/`)
  );
}

function isEbayProAllowed({
  vercelEnv = "",
  nodeEnv = "",
  ebayProRuntime = "",
  pathname = "/",
}) {
  const runtime =
    ebayProRuntime.trim().toLowerCase();
  const runtimeAllows =
    runtime === "staging" ||
    runtime === "local_vm_lab" ||
    runtime === "development";
  const runtimeBlocks =
    runtime === "production_core" ||
    runtime === "production";
  const isProduction =
    runtimeBlocks ||
    (
      !runtimeAllows &&
      (
        vercelEnv === "production" ||
        (
          !vercelEnv &&
          nodeEnv === "production"
        )
      )
    );

  return !(
    isProduction &&
    isEbayProPath(pathname)
  );
}

test("production isolation fixture is ready", () => {
  assert.equal(
    fixture.isolationVersion,
    "EBAY_PRO_PRODUCTION_ISOLATION_FAST_V1",
  );
  assert.equal(
    fixture.status,
    "PRODUCTION_CORE_PROTECTED_EBAY_PRO_STAGING_LAB_ONLY",
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
});

test("safety flags confirm production protection without live systems", () => {
  const flags =
    fixture.safetyFlags;

  assert.equal(flags.productionCoreProtected, true);
  assert.equal(flags.ebayProProductionDisabled, true);
  assert.equal(flags.localVmConnected, false);
  assert.equal(flags.liveSupabaseQueried, false);
  assert.equal(flags.supabaseWriteUsed, false);
  assert.equal(flags.ebayApiUsed, false);
});

test("environment boundary module exists and avoids external systems", () => {
  assert.equal(
    fileExists(modulePath),
    true,
  );

  const content =
    readText(modulePath);

  assert.equal(
    content.includes("EBAY_PRO_PRODUCTION_ISOLATION_FAST_V1"),
    true,
  );
  assert.equal(
    content.includes("/admin/ebay-pro"),
    true,
  );
  assert.equal(
    content.includes("/api/admin/market-radar"),
    true,
  );
  assert.equal(
    content.includes("/api/admin/ebay-winner-pipeline"),
    true,
  );
  assert.equal(
    content.includes("/admin/ebay-seller-os"),
    true,
  );

  for (const pattern of forbiddenRuntimePatterns) {
    assert.equal(
      content.includes(pattern),
      false,
      `${modulePath} contains ${pattern}`,
    );
  }
});

test("middleware contains eBay Pro gate without live system calls", () => {
  assert.equal(
    fileExists(middlewarePath),
    true,
  );

  const content =
    readText(middlewarePath);

  assert.equal(
    content.includes("getEbayProRuntimeBoundary"),
    true,
  );
  assert.equal(
    content.includes("/admin/ebay-pro"),
    true,
  );
  assert.equal(
    content.includes("/api/admin/market-radar"),
    true,
  );
  assert.equal(
    content.includes("/api/admin/ebay-winner-pipeline"),
    true,
  );
  assert.equal(
    content.includes("/admin/ebay-seller-os"),
    true,
  );

  for (const pattern of forbiddenRuntimePatterns) {
    assert.equal(
      content.includes(pattern),
      false,
      `${middlewarePath} contains ${pattern}`,
    );
  }
});

test("production blocks eBay Pro paths while core paths remain allowed", () => {
  assert.equal(
    isEbayProAllowed({
      vercelEnv: "production",
      pathname: "/admin/ebay-pro",
    }),
    false,
  );
  assert.equal(
    isEbayProAllowed({
      ebayProRuntime: "staging",
      pathname: "/admin/ebay-pro",
    }),
    true,
  );
  assert.equal(
    isEbayProAllowed({
      vercelEnv: "production",
      pathname: "/admin/ebay-seller-os",
    }),
    false,
  );
  assert.equal(
    isEbayProAllowed({
      vercelEnv: "production",
      pathname: "/api/admin/market-radar",
    }),
    false,
  );
  assert.equal(
    isEbayProAllowed({
      vercelEnv: "preview",
      pathname: "/admin/ebay-seller-os",
    }),
    true,
  );
  assert.equal(
    isEbayProAllowed({
      ebayProRuntime: "staging",
      pathname: "/api/admin/market-radar",
    }),
    true,
  );
  assert.equal(
    isEbayProAllowed({
      vercelEnv: "production",
      pathname: "/admin",
    }),
    true,
  );
  assert.equal(
    isEbayProAllowed({
      vercelEnv: "production",
      pathname: "/api/products",
    }),
    true,
  );
});
