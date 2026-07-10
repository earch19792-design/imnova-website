import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/ebay-seller-hub-missing-data-fix-plan-v1.json";
const modulePath =
  "lib/ebay/ebay-seller-hub-missing-data-fix-plan.ts";
const cliPath =
  "tools/ebay-seller-hub-missing-data-fix-plan-dry-run.mjs";
const docPath =
  "docs/ebay-pro-isolation/EBAY_SELLER_HUB_MISSING_DATA_FIX_PLAN_RESUME_A4_V1.md";

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
  const fixPlanModule =
    await import(`../${modulePath}`);
  const fixture =
    {
      targetMarketplace: "EBAY_US",
      sellerAccountTypeCurrent: "PERSONAL",
      plannedFutureSellerAccountType: "BUSINESS",
      plannedBusinessConversionWindowDays: 15,
      ...fixtureOverrides,
    };

  return {
    fixPlanModule,
    report:
      fixPlanModule.buildEbaySellerHubMissingDataFixPlanReport(entry, fixture),
  };
}

test("fixture locks EBAY-RESUME-A4 safety boundaries", () => {
  const fixture =
    readJson(fixturePath);

  assert.equal(fixture.fixPlanVersion, "EBAY_SELLER_HUB_MISSING_DATA_FIX_PLAN_RESUME_A4_V1");
  assert.equal(fixture.status, "EBAY_SELLER_HUB_MISSING_DATA_FIX_PLAN_READY");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_SELLER_HUB_FIX_PLAN_ONLY");
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

test("A3 missing policies create required Seller Hub fix plan", async () => {
  const fixture =
    readJson(fixturePath);
  const { fixPlanModule, report } =
    await buildReport(fixture.a3SanitizedAuditResult, fixture);

  assert.equal(report.fixPlanBuilt, true);
  assert.equal(report.fixPlanScore >= 0, true);
  assert.equal(report.fixPlanScore <= 100, true);
  assert.equal(report.oauthAuthorizationSucceededFromA3, true);
  assert.equal(report.policyFixesRequiredCount, 3);
  assert.equal(report.manualSellerHubChecksRequiredCount, 7);
  assert.equal(report.endpointScopeGapsCount >= 3, true);
  assert.equal(report.fulfillmentPolicyMissing, true);
  assert.equal(report.returnPolicyMissing, true);
  assert.equal(report.paymentPolicyMissing, true);
  assert.equal(report.inventoryLocationMissing, true);
  assert.equal(report.canProceedToSandboxDraft, false);
  assert.equal(report.canProceedToManualListingPrep, false);
  assert.equal(report.canPublish, false);
  assert.equal(report.requiresHumanApproval, true);
  assert.equal(report.nextRecommendedRoute, "NEED_SELLER_HUB_FIXES");
  assert.equal(fixPlanModule.getEbaySellerHubMissingDataFixChecklist().length > 0, true);
});

test("fixture includes required policy and manual missing data", () => {
  const fixture =
    readJson(fixturePath);
  const audit =
    fixture.a3SanitizedAuditResult;

  assert.deepEqual(
    audit.missingPolicyTypes,
    [
      "fulfillment_policy",
      "return_policy",
      "payment_policy",
    ],
  );
  assert.equal(audit.inventoryLocationsCount, 0);
  assert.equal(audit.missingManualSellerHubData.includes("Seller Hub account alerts"), true);
  assert.equal(audit.missingManualSellerHubData.includes("Identity verification status"), true);
  assert.equal(audit.missingManualSellerHubData.includes("Payments and payouts final approval"), true);
  assert.equal(audit.missingManualSellerHubData.includes("Seller limits"), true);
  assert.equal(audit.missingManualSellerHubData.includes("Personal-to-business conversion status"), true);
});

test("endpoint unavailable_or_scope_missing 400 creates endpoint scope gap assessment", async () => {
  const fixture =
    readJson(fixturePath);
  const { report } =
    await buildReport(fixture.a3SanitizedAuditResult, fixture);

  assert.equal(report.endpointScopeGapAssessment.some(gap => gap.key === "fulfillmentPolicies"), true);
  assert.equal(report.endpointScopeGapAssessment.some(gap => gap.key === "returnPolicies"), true);
  assert.equal(report.endpointScopeGapAssessment.some(gap => gap.key === "paymentPolicies"), true);
  assert.equal(report.endpointScopeGapAssessment.some(gap => gap.errorType === "unavailable_or_scope_missing_400"), true);
});

test("payments, alerts, identity, seller limits, and business conversion require manual checks", async () => {
  const fixture =
    readJson(fixturePath);
  const { report } =
    await buildReport(fixture.a3SanitizedAuditResult, fixture);

  assert.equal(report.paymentsPayoutsNeedsManualCheck, true);
  assert.equal(report.accountAlertsNeedManualCheck, true);
  assert.equal(report.identityVerificationNeedsManualCheck, true);
  assert.equal(report.sellerLimitsNeedManualCheck, true);
  assert.equal(report.businessConversionNeedsManualCheck, true);
  assert.equal(report.blockers.some(blocker => blocker.includes("Payments")), true);
});

test("personal account business conversion warning and low-risk recommendation exist", async () => {
  const fixture =
    readJson(fixturePath);
  const { report } =
    await buildReport(fixture.a3SanitizedAuditResult, fixture);

  assert.equal(report.warnings.some(warning => warning.includes("Personal account")), true);
  assert.equal(report.lowRiskFirstListingRecommendation.initialQuantity, 1);
  assert.equal(report.lowRiskFirstListingRecommendation.listingFormat, "Buy It Now");
  assert.equal(report.lowRiskFirstListingRecommendation.avoidProductTypes.includes("supplements"), true);
  assert.equal(report.lowRiskFirstListingRecommendation.avoidProductTypes.includes("VERO/IP risk products"), true);
});

test("high account risk recommends HOLD", async () => {
  const { report } =
    await buildReport({
      oauthAuthorizationSucceeded: true,
      businessPoliciesReadable: true,
      fulfillmentPoliciesCount: 1,
      returnPoliciesCount: 1,
      paymentPoliciesCount: 1,
      inventoryLocationsCount: 1,
      missingPolicyTypes: [],
      missingManualSellerHubData: [],
      accountRiskStatus: "suspended",
    });

  assert.equal(report.accountRiskLevel, "HIGH");
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-HOLD");
  assert.equal(report.canPublish, false);
});

test("confirmed policies and manual checks can recommend C but still require human publication approval", async () => {
  const { report } =
    await buildReport({
      oauthAuthorizationSucceeded: true,
      businessPoliciesReadable: true,
      fulfillmentPoliciesCount: 1,
      returnPoliciesCount: 1,
      paymentPoliciesCount: 1,
      inventoryLocationsCount: 1,
      missingPolicyTypes: [],
      missingManualSellerHubData: [],
      endpointAvailability: {
        fulfillmentPolicies: { available: true, count: 1 },
        returnPolicies: { available: true, count: 1 },
        paymentPolicies: { available: true, count: 1 },
        inventoryLocations: { available: true, count: 1 },
      },
      accountRiskStatus: "low",
      manualPoliciesConfirmed: true,
      manualSellerHubChecksConfirmed: true,
    });

  assert.equal(["EBAY-RESUME-B", "EBAY-RESUME-C"].includes(report.nextRecommendedRoute), true);
  assert.equal(report.canPublish, false);
});

test("CLI dry-run executes and prints expected numeric summary", async () => {
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

  assert.equal(summary.fixPlanBuilt, true);
  assert.equal(typeof summary.fixPlanScore, "number");
  assert.equal(summary.policyFixesRequiredCount, 3);
  assert.equal(summary.manualSellerHubChecksRequiredCount, 7);
  assert.equal(summary.endpointScopeGapsCount >= 3, true);
  assert.equal(summary.fulfillmentPolicyMissing, true);
  assert.equal(summary.returnPolicyMissing, true);
  assert.equal(summary.paymentPolicyMissing, true);
  assert.equal(summary.inventoryLocationMissing, true);
  assert.equal(summary.canProceedToSandboxDraft, false);
  assert.equal(summary.canProceedToManualListingPrep, false);
  assert.equal(summary.canPublish, false);
  assert.equal(summary.nextRecommendedRoute, "NEED_SELLER_HUB_FIXES");
  assert.equal(summary.ebayApiUsedInThisLoop, false);
  assert.equal(summary.ebayWriteApiUsed, false);
  assert.equal(summary.oauthUsedInThisLoop, false);
  assert.equal(summary.tokenStored, false);
  assert.equal(summary.tokensPrinted, false);
});

test("static guardrails, docs, and no forbidden calls", () => {
  const moduleText =
    readText(modulePath);
  const cliText =
    readText(cliPath);
  const fixtureText =
    readText(fixturePath);
  const testText =
    readText("tools/ebay-seller-hub-missing-data-fix-plan-tests.mjs");

  assert.equal(fileExists(docPath), true);
  for (const text of [moduleText, cliText]) {
    assert.equal(text.includes("process.env"), false);
    assert.equal(text.includes("fetch("), false);
    assert.equal(text.includes("createClient"), false);
    assert.equal(text.includes(".from("), false);
    assert.equal(text.includes(".insert("), false);
    assert.equal(text.includes(".update("), false);
    assert.equal(text.includes(".upsert("), false);
    assert.equal(text.includes("writeFile"), false);
    assert.equal(text.includes("appendFile"), false);
    assert.equal(text.includes("createWriteStream"), false);
  }

  for (const text of [fixtureText, testText]) {
    assert.equal(text.includes(`access_${"token"}`), false);
    assert.equal(text.includes(`refresh_${"token"}`), false);
    assert.equal(text.includes(`client_${"secret"}`), false);
    assert.equal(text.includes(`authorization ${"code"}`), false);
  }

  assert.equal(moduleText.includes("amazon-listing-package"), false);
  assert.equal(moduleText.includes("ebay-sandbox-draft-listing"), false);
});
