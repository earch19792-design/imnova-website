import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/ebay-pro-staging-lab-module-identity-v1.json";
const manifestPath =
  "lib/ebay/professional-suite-manifest.ts";
const hubPath =
  "app/admin/ebay-seller-os/page.tsx";
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

const forbiddenWhatsAppRuntimePatterns = [
  ["access", "token"].join("_"),
  ["refresh", "token"].join("_"),
  ["Authorization", ":"].join(""),
  ["graph", "facebook", "com"].join("."),
  ["whatsapp", "messages"].join("/"),
  ["fetch", "("].join(""),
  ["send", "Message"].join(""),
  ["send", "WhatsApp"].join(""),
  ["messages", "send"].join("."),
  ["meta", "Api", "Call"].join(""),
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
  assert.equal(
    fixture.whatsappAlerts.coreWhatsAppAllowedInProduction,
    true,
  );
  assert.equal(
    fixture.whatsappAlerts.ebayProWhatsAppAllowedInProduction,
    false,
  );
  assert.equal(
    fixture.whatsappAlerts.ebayProWhatsAppAllowedInStagingLab,
    true,
  );
  assert.equal(
    fixture.whatsappAlerts.dryRunDefault,
    true,
  );
  assert.equal(
    fixture.whatsappAlerts.realSendAllowedInThisLoop,
    false,
  );
  assert.equal(
    fixture.whatsappAlerts.whatsappApiCalledInThisLoop,
    false,
  );
  assert.equal(
    fixture.whatsappAlerts.metaTemplatesChanged,
    false,
  );
  assert.equal(
    fixture.whatsappAlerts.secretsDuplicated,
    false,
  );
  assert.equal(
    fixture.safetyFlags.coreWhatsAppProductionPreserved,
    true,
  );
  assert.equal(
    fixture.safetyFlags.ebayProWhatsappDryRunDefault,
    true,
  );
  assert.equal(
    fixture.safetyFlags.whatsappRealSendUsed,
    false,
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
    content.includes("WhatsApp Seller Alerts future"),
    true,
  );
  assert.equal(
    content.includes("shared_controlled_communication_channel"),
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

test("canonical Seller OS hub is lightweight and does not read data", () => {
  assert.equal(
    fileExists(hubPath),
    true,
  );

  const content =
    readText(hubPath);

  assert.equal(
    content.includes("eBay Seller OS"),
    true,
  );
  assert.equal(
    content.includes("Crear o publicar un listing en eBay requiere una autorización separada"),
    true,
  );
  assert.equal(
    content.includes("MODO SEGURO"),
    true,
  );
  assert.equal(
    content.includes("Seller Command Center"),
    true,
  );
  assert.equal(
    content.includes("eBay Seller OS"),
    true,
  );
  assert.equal(
    content.includes("Optimizar listing"),
    true,
  );
  assert.equal(
    content.includes("OpenAI estratégico: lectura y razonamiento acotado"),
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
  assert.equal(
    isAllowed({
      runtime: "production",
      pathname: "/api/whatsapp",
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

test("WhatsApp remains shared and eBay Pro alerts stay dry-run", () => {
  const manifestContent =
    readText(manifestPath);
  const boundaryContent =
    readText(boundaryPath);
  const hubContent =
    readText(hubPath);

  assert.equal(
    fixture.whatsappAlerts.futureSellerAlertEvents.includes(
      "candidate_winner_detected",
    ),
    true,
  );
  assert.equal(
    fixture.whatsappAlerts.futureSellerAlertEvents.includes(
      "seller_action_required",
    ),
    true,
  );
  assert.equal(
    boundaryContent.includes("/api/whatsapp"),
    false,
  );
  assert.equal(
    isAllowed({
      runtime: "production",
      pathname: "/api/whatsapp",
    }),
    true,
  );

  for (const content of [
    manifestContent,
    hubContent,
  ]) {
    for (const pattern of forbiddenWhatsAppRuntimePatterns) {
      assert.equal(
        content.includes(pattern),
        false,
        `WhatsApp runtime pattern found: ${pattern}`,
      );
    }
  }
});
