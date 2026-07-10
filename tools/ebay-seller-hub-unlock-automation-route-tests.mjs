import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildEbaySellerHubUnlockAutomationRouteFromFixture,
  buildEbaySellerHubUnlockAutomationRouteReport,
  getEbaySellerHubUnlockAutomationChecklist,
  summarizeEbaySellerHubUnlockAutomationRoute,
} from "../lib/ebay/ebay-seller-hub-unlock-automation-route.ts";

const fixture = JSON.parse(
  readFileSync(
    "tools/fixtures/ebay-seller-hub-unlock-automation-route-v1.json",
    "utf8",
  ),
);

const moduleSource = readFileSync(
  "lib/ebay/ebay-seller-hub-unlock-automation-route.ts",
  "utf8",
);
const cliSource = readFileSync(
  "tools/ebay-seller-hub-unlock-automation-route-dry-run.mjs",
  "utf8",
);
const fixtureSource = readFileSync(
  "tools/fixtures/ebay-seller-hub-unlock-automation-route-v1.json",
  "utf8",
);

test("fixture has expected A5 status and safety boundaries", () => {
  assert.equal(
    fixture.status,
    "EBAY_SELLER_HUB_UNLOCK_AUTOMATION_ROUTE_READY",
  );
  assert.equal(fixture.production.offLimitsForWrites, true);
  assert.equal(fixture.main.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.ebayApi.usedInThisLoop, false);
  assert.equal(fixture.ebayWriteApi.usedInThisLoop, false);
  assert.equal(fixture.oauth.usedInThisLoop, false);
  assert.equal(fixture.tokenStorage.usedInThisLoop, false);
  assert.equal(fixture.draft.createdInThisLoop, false);
  assert.equal(fixture.listing.createdInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.amazonTrack.touchedInThisLoop, false);
});

test("warehouse model uses safe Luna Portex alias without full street address", () => {
  assert.equal(fixture.storeName, "ShopEliteCart");
  assert.equal(fixture.warehouse.warehouseAlias, "LUNA_PORTEX_BOCA_RATON");
  assert.equal(fixture.warehouse.city, "Boca Raton");
  assert.equal(fixture.warehouse.state, "FL");
  assert.equal(fixture.warehouse.postalCode, "33487");
  assert.equal(fixture.warehouse.country, "US");
  assert.equal(fixture.warehouse.streetAddressStoredInGit, false);
  assert.equal(fixture.safetyFlags.noFullWarehouseStreetAddressCommitted, true);
  assert.equal(
    fixtureSource.includes("streetAddressStoredInGit"),
    true,
  );
});

test("route report detects unlock model and automation path", () => {
  const report = buildEbaySellerHubUnlockAutomationRouteFromFixture(fixture);
  assert.equal(report.routeReconciliationBuilt, true);
  assert.equal(report.sellerHubAccessible, true);
  assert.equal(report.storeNameConfigured, true);
  assert.equal(report.warehouseAliasConfigured, true);
  assert.equal(report.fullWarehouseStreetAddressCommitted, false);
  assert.equal(report.shipFromConfiguredManually, true);
  assert.equal(report.returnAddressConfiguredManually, true);
  assert.equal(report.payoutUnlockModelDetected, true);
  assert.equal(report.businessPoliciesUnlockModelDetected, true);
  assert.equal(report.benchmarkAutomationRouteReady, true);
  assert.equal(report.canProceedToAutomatedListingPackage, true);
  assert.equal(report.canProceedToEbayDraftWrite, false);
  assert.equal(report.canPublish, false);
  assert.equal(report.requiresHumanApproval, true);
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-C-AUTO");
});

test("manual and automated boundaries are explicit", () => {
  const report = buildEbaySellerHubUnlockAutomationRouteFromFixture(fixture);
  const manualBoundary = report.manualStepsRemaining.join(" ");
  const automationBoundary = report.automationStepsReady.join(" ");

  assert.match(manualBoundary, /identity/i);
  assert.match(manualBoundary, /payout/i);
  assert.match(manualBoundary, /payment/i);
  assert.match(manualBoundary, /final listing review/i);
  assert.match(automationBoundary, /benchmark/i);
  assert.match(automationBoundary, /title/i);
  assert.match(automationBoundary, /pricing/i);
  assert.match(automationBoundary, /item specifics/i);
  assert.match(automationBoundary, /payload/i);
});

test("account risk and missing candidate change recommendation safely", () => {
  const riskReport = buildEbaySellerHubUnlockAutomationRouteReport({
    ...fixture,
    automationSignals: {
      ...fixture.automationSignals,
      accountRiskVisible: true,
    },
  });
  assert.equal(riskReport.nextRecommendedRoute, "EBAY-RESUME-HOLD");
  assert.equal(riskReport.canPublish, false);
  assert.equal(riskReport.canProceedToEbayDraftWrite, false);

  const missingCandidateReport = buildEbaySellerHubUnlockAutomationRouteReport({
    ...fixture,
    automationSignals: {
      ...fixture.automationSignals,
      productCandidateExists: false,
    },
  });
  assert.equal(
    missingCandidateReport.nextRecommendedRoute,
    "NEED_AUTOMATED_LISTING_CANDIDATE",
  );
  assert.equal(missingCandidateReport.canProceedToAutomatedListingPackage, false);
});

test("summary exposes expected numeric output", () => {
  const report = buildEbaySellerHubUnlockAutomationRouteFromFixture(fixture);
  const summary = summarizeEbaySellerHubUnlockAutomationRoute(report);
  assert.equal(summary.routeReconciliationBuilt, true);
  assert.equal(typeof summary.routeScore, "number");
  assert.ok(summary.routeScore >= 0 && summary.routeScore <= 100);
  assert.equal(summary.manualStepsRemainingCount, 6);
  assert.equal(summary.automationStepsReadyCount, 11);
  assert.equal(summary.fullWarehouseStreetAddressCommitted, false);
  assert.equal(summary.canProceedToEbayDraftWrite, false);
  assert.equal(summary.canPublish, false);
});

test("checklist exists", () => {
  const checklist = getEbaySellerHubUnlockAutomationChecklist();
  assert.ok(checklist.length >= 5);
  assert.ok(
    checklist.some((item) =>
      item.includes("Do not commit full warehouse street address"),
    ),
  );
});

test("module and CLI do not use prohibited runtime capabilities", () => {
  const prohibited = [
    "process.env",
    "fetch(",
    "createClient",
    ".from(",
    ".insert(",
    ".update(",
    ".upsert(",
    "writeFile",
    "appendFile",
    "createWriteStream",
  ];
  for (const pattern of prohibited) {
    assert.equal(moduleSource.includes(pattern), false, pattern);
    assert.equal(cliSource.includes(pattern), false, pattern);
  }
});

test("A5 files do not include old eBay LOOP 149 or Amazon 149G implementation markers", () => {
  const combined = `${moduleSource}\n${cliSource}\n${fixtureSource}`;
  assert.equal(combined.includes("AMAZON_LISTING_PACKAGE_BUILDER"), false);
  assert.equal(combined.includes("ebay-sandbox-draft-listing"), false);
  assert.equal(combined.includes("EBAY_SANDBOX_DRAFT_LISTING"), false);
});

test("CLI dry-run executes", async () => {
  const messages = [];
  const originalLog = console.log;
  console.log = (message) => {
    messages.push(String(message));
  };
  try {
    await import(`./ebay-seller-hub-unlock-automation-route-dry-run.mjs?test=${Date.now()}`);
  } finally {
    console.log = originalLog;
  }

  assert.ok(messages.length > 0);
  const output = JSON.parse(messages.join("\n"));
  assert.equal(output.routeReconciliationBuilt, true);
  assert.equal(output.nextRecommendedRoute, "EBAY-RESUME-C-AUTO");
  assert.equal(output.canPublish, false);
  assert.equal(output.fullWarehouseStreetAddressCommitted, false);
});
