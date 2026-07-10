import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/ebay-developer-seller-link-readiness-v1.json";
const modulePath =
  "lib/ebay/ebay-developer-seller-link-readiness.ts";
const cliPath =
  "tools/ebay-developer-seller-link-readiness-dry-run.mjs";
const docPath =
  "docs/ebay-pro-isolation/EBAY_DEVELOPER_SELLER_LINK_READINESS_RESUME_A2_V1.md";

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

async function buildReport(entry, fixtureOverrides = {}) {
  const readinessModule =
    await import(`../${modulePath}`);
  const fixture =
    {
      sellerAccountTypeCurrent: "PERSONAL",
      plannedFutureSellerAccountType: "BUSINESS",
      plannedBusinessConversionWindowDays: 15,
      targetMarketplace: "EBAY_US",
      ...fixtureOverrides,
    };

  return {
    readinessModule,
    report:
      readinessModule.buildEbayDeveloperSellerLinkReadinessReport(entry, fixture),
  };
}

test("fixture locks EBAY-RESUME-A2 safety boundaries", () => {
  const fixture =
    readJson(fixturePath);

  assert.equal(fixture.readinessVersion, "EBAY_DEVELOPER_SELLER_LINK_READINESS_RESUME_A2_V1");
  assert.equal(fixture.status, "EBAY_DEVELOPER_SELLER_LINK_READINESS_READY");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_DEVELOPER_SELLER_LINK_CHECKLIST_ONLY");
  assert.equal(fixture.sellerAccountTypeCurrent, "PERSONAL");
  assert.equal(fixture.plannedFutureSellerAccountType, "BUSINESS");
  assert.equal(fixture.plannedBusinessConversionWindowDays, 15);
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.main.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.ebayApi.usedInThisLoop, false);
  assert.equal(fixture.oauth.realTokenExchangeExecutedInThisLoop, false);
  assert.equal(fixture.oauth.accessTokenStoredInThisLoop, false);
  assert.equal(fixture.oauth.refreshTokenStoredInThisLoop, false);
  assert.equal(fixture.draft.createdInThisLoop, false);
  assert.equal(fixture.listing.createdInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.amazonTrack.touchedInThisLoop, false);
});

test("unknown developer app data requires more developer seller link data", async () => {
  const fixture =
    readJson(fixturePath);
  const { readinessModule, report } =
    await buildReport(fixture.developerSellerLinkChecklist, fixture);

  assert.equal(report.readinessScore >= 0, true);
  assert.equal(report.readinessScore <= 100, true);
  assert.equal(report.personalSellerModeAllowed, true);
  assert.equal(report.businessConversionPlanned, true);
  assert.equal(report.businessConversionDays, 15);
  assert.equal(report.apiReadableDataCategories.length > 0, true);
  assert.equal(report.manualOnlyDataCategories.length > 0, true);
  assert.equal(report.nextRecommendedRoute, "NEED_MORE_DEVELOPER_SELLER_LINK_DATA");
  assert.equal(report.canPublish, false);
  assert.equal(report.amazonTrackTouched, false);
  assert.equal(readinessModule.getEbayDeveloperSellerLinkChecklist().length > 0, true);
});

test("developer app plus redirect URI plus human approval can recommend EBAY-RESUME-A3", async () => {
  const { report } =
    await buildReport({
      developerAccountCreated: "confirmed",
      developerApplicationCreated: "confirmed",
      productionKeysAvailable: "available",
      sandboxKeysAvailable: "available",
      redirectUriConfigured: "configured",
      sellerPersonalAccountCreated: "confirmed",
      sellerAccountAuthorizationStatus: "confirmed",
      sellerHubManualChecklistStatus: "NEED_MORE_SELLER_HUB_DATA",
      businessPoliciesReadableViaApi: "available",
      fulfillmentPoliciesReadableViaApi: "available",
      returnPoliciesReadableViaApi: "available",
      paymentPoliciesReadableViaApi: "available",
      inventoryLocationsReadableViaApi: "available",
      sellerLimitsReadableViaApi: "partial_or_manual_required",
      paymentsPayoutsReadableViaApi: "partial_or_manual_required",
      accountAlertsReadableViaApi: "partial_or_manual_required",
      businessConversionPlanned: true,
      businessConversionDays: 15,
      accountRiskStatus: "confirmed",
      humanApprovalForReadOnlyOauthAudit: true,
    });

  assert.equal(report.developerAppReady, true);
  assert.equal(report.sellerAuthorizationReady, true);
  assert.equal(report.oauthSafetyReady, true);
  assert.equal(report.canProceedToRealOAuthAudit, true);
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-A3");
  assert.equal(report.canPublish, false);
  assert.equal(report.realTokenExchangeExecuted, false);
});

test("account suspension or verification risk recommends EBAY-RESUME-HOLD", async () => {
  const { report } =
    await buildReport({
      developerAccountCreated: "confirmed",
      developerApplicationCreated: "confirmed",
      redirectUriConfigured: "configured",
      sellerPersonalAccountCreated: "confirmed",
      sellerAccountAuthorizationStatus: "confirmed",
      accountRiskStatus: "blocked",
      humanApprovalForReadOnlyOauthAudit: true,
    });

  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-HOLD");
  assert.equal(report.blockers.some(blocker => blocker.includes("Account suspension")), true);
  assert.equal(report.canPublish, false);
});

test("business conversion checklist exists", async () => {
  const { report } =
    await buildReport({
      businessConversionPlanned: true,
      businessConversionDays: 15,
    });

  assert.equal(report.businessConversionChecklist.length >= 10, true);
  assert.equal(report.businessConversionChecklist.some(item => item.includes("15 days")), true);
});

test("CLI dry-run executes and prints expected summary", async () => {
  let output =
    "";
  const originalLog =
    console.log;

  console.log =
    value => {
      output += `${value}`;
    };

  try {
    await import(`../${cliPath}?testRun=${Date.now()}`);
  } finally {
    console.log =
      originalLog;
  }

  const summary =
    JSON.parse(output);

  assert.equal(summary.readinessReportBuilt, true);
  assert.equal(summary.personalSellerModeAllowed, true);
  assert.equal(summary.businessConversionPlanned, true);
  assert.equal(summary.businessConversionDays, 15);
  assert.equal(summary.apiReadableDataCategoriesCount > 0, true);
  assert.equal(summary.manualOnlyDataCategoriesCount > 0, true);
  assert.equal(summary.canPublish, false);
  assert.equal(summary.productionTouched, false);
  assert.equal(summary.mainTouched, false);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.ebayApiUsed, false);
  assert.equal(summary.realTokenExchangeExecuted, false);
  assert.equal(summary.accessTokenStored, false);
  assert.equal(summary.refreshTokenStored, false);
  assert.equal(summary.draftCreated, false);
  assert.equal(summary.listingCreated, false);
  assert.equal(summary.publicationExecuted, false);
  assert.equal(["NEED_MORE_DEVELOPER_SELLER_LINK_DATA", "EBAY-RESUME-A3"].includes(summary.nextRecommendedRoute), true);
});

test("static guardrails, docs, and no forbidden calls", () => {
  const moduleText =
    readText(modulePath);
  const cliText =
    readText(cliPath);

  assert.equal(fileExists(docPath), true);
  assert.equal(moduleText.includes("process.env"), false);
  assert.equal(moduleText.includes("fetch("), false);
  assert.equal(moduleText.includes("createClient"), false);
  assert.equal(moduleText.includes(".from("), false);
  assert.equal(moduleText.includes(".insert("), false);
  assert.equal(moduleText.includes(".update("), false);
  assert.equal(moduleText.includes(".upsert("), false);
  assert.equal(cliText.includes("process.env"), false);
  assert.equal(cliText.includes("fetch("), false);
  assert.equal(cliText.includes("createClient"), false);
  assert.equal(cliText.includes(".from("), false);
  assert.equal(cliText.includes(".insert("), false);
  assert.equal(cliText.includes(".update("), false);
  assert.equal(cliText.includes(".upsert("), false);
});
