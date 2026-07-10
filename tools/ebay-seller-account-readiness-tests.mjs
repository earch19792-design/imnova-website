import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/ebay-seller-account-readiness-v1.json";
const modulePath =
  "lib/ebay/ebay-seller-account-readiness.ts";
const cliPath =
  "tools/ebay-seller-account-readiness-dry-run.mjs";
const docPath =
  "docs/ebay-pro-isolation/EBAY_SELLER_ACCOUNT_READINESS_RESUME_A_V1.md";

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

async function buildReport(entry) {
  const readinessModule =
    await import(`../${modulePath}`);

  return {
    readinessModule,
    report:
      readinessModule.buildEbaySellerAccountReadinessReport(entry),
  };
}

test("fixture locks EBAY-RESUME-A safety boundaries", () => {
  const fixture =
    readJson(fixturePath);

  assert.equal(fixture.readinessVersion, "EBAY_SELLER_ACCOUNT_READINESS_RESUME_A_V1");
  assert.equal(fixture.status, "EBAY_SELLER_ACCOUNT_READINESS_READY");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_SELLER_ACCOUNT_CHECKLIST_ONLY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.main.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.ebayApi.usedInThisLoop, false);
  assert.equal(fixture.ebayProductionApi.usedInThisLoop, false);
  assert.equal(fixture.oauth.usedInThisLoop, false);
  assert.equal(fixture.draft.createdInThisLoop, false);
  assert.equal(fixture.listing.createdInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.amazonTrack.touchedInThisLoop, false);
  assert.equal(fixture.safetyFlags.noAmazonTrackMixing, true);
});

test("unknown critical checklist items require more Seller Hub data", async () => {
  const fixture =
    readJson(fixturePath);
  const { report } =
    await buildReport(fixture.sellerAccountChecklist);

  assert.equal(report.readinessScore >= 0, true);
  assert.equal(report.readinessScore <= 100, true);
  assert.equal(report.accountStatus, "NEEDS_HUMAN_CONFIRMATION");
  assert.equal(report.nextRecommendedRoute, "NEED_MORE_SELLER_HUB_DATA");
  assert.equal(report.canProceedToSandboxDraft, false);
  assert.equal(report.canProceedToManualListingPrep, false);
  assert.equal(report.canPublish, false);
  assert.equal(report.requiresHumanApproval, true);
  assert.equal(report.amazonTrackTouched, false);
});

test("suspension or verification risk generates EBAY-RESUME-HOLD", async () => {
  const { report } =
    await buildReport({
      sellerAccountActive: "active",
      sellerHubAccessible: "confirmed",
      paymentsSetupStatus: "configured",
      payoutsSetupStatus: "configured",
      paymentMethodStatus: "configured",
      bankAccountStatus: "configured",
      itemLocationStatus: "confirmed",
      shippingPoliciesStatus: "configured",
      returnPoliciesStatus: "configured",
      handlingTimeStatus: "configured",
      sellerLimitsStatus: "confirmed",
      categoryPermissionStatus: "confirmed",
      warehouseLogisticsStatus: "confirmed",
      firstProductCandidateStatus: "confirmed",
      mainImageStatus: "confirmed",
      accountRiskStatus: "verification_required",
    });

  assert.equal(report.accountStatus, "BLOCKED_ACCOUNT_RISK");
  assert.equal(report.accountRiskLevel, "HIGH");
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-HOLD");
  assert.equal(report.canPublish, false);
});

test("ready account can route to sandbox draft but never publish", async () => {
  const { report } =
    await buildReport({
      sellerAccountActive: "active",
      sellerHubAccessible: "confirmed",
      paymentsSetupStatus: "configured",
      payoutsSetupStatus: "configured",
      paymentMethodStatus: "configured",
      bankAccountStatus: "configured",
      itemLocationStatus: "confirmed",
      targetMarketplace: "EBAY_US",
      shippingPoliciesStatus: "configured",
      returnPoliciesStatus: "configured",
      handlingTimeStatus: "configured",
      sellerLimitsStatus: "confirmed",
      categoryPermissionStatus: "confirmed",
      warehouseLogisticsStatus: "confirmed",
      firstProductCandidateStatus: "confirmed",
      mainImageStatus: "confirmed",
      accountRiskStatus: "confirmed",
    });

  assert.equal(report.accountStatus, "READY_FOR_SANDBOX_DRAFT");
  assert.equal(["EBAY-RESUME-B", "EBAY-RESUME-C"].includes(report.nextRecommendedRoute), true);
  assert.equal(report.canProceedToSandboxDraft, true);
  assert.equal(report.canProceedToManualListingPrep, true);
  assert.equal(report.canPublish, false);
});

test("manual listing strategy can route to EBAY-RESUME-C but canPublish remains false", async () => {
  const { report } =
    await buildReport({
      sellerAccountActive: true,
      sellerHubAccessible: true,
      paymentsSetupStatus: true,
      payoutsSetupStatus: true,
      paymentMethodStatus: true,
      bankAccountStatus: true,
      itemLocationStatus: true,
      targetMarketplace: "EBAY_US",
      shippingPoliciesStatus: true,
      returnPoliciesStatus: true,
      handlingTimeStatus: true,
      sellerLimitsStatus: true,
      categoryPermissionStatus: true,
      warehouseLogisticsStatus: true,
      firstProductCandidateStatus: true,
      mainImageStatus: true,
      accountRiskStatus: true,
      preferredResumeStrategy: "manual_listing_first",
    });

  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-C");
  assert.equal(report.canPublish, false);
});

test("manual checklist contains all required seller hub items", async () => {
  const { readinessModule } =
    await buildReport({});
  const checklist =
    readinessModule.getEbaySellerAccountReadinessChecklist().join(" | ");

  assert.match(checklist, /Seller Hub/);
  assert.match(checklist, /Payments/);
  assert.match(checklist, /Payouts/);
  assert.match(checklist, /item location/);
  assert.match(checklist, /Shipping policy/);
  assert.match(checklist, /Return policy/);
  assert.match(checklist, /Handling time/);
  assert.match(checklist, /Seller limits/);
  assert.match(checklist, /Categorías/);
  assert.match(checklist, /Luna Portex/);
  assert.match(checklist, /Primer producto/);
  assert.match(checklist, /Imagen principal/);
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
  assert.equal(summary.readinessScore >= 0, true);
  assert.equal(summary.readinessScore <= 100, true);
  assert.equal(summary.canPublish, false);
  assert.equal(summary.productionTouched, false);
  assert.equal(summary.mainTouched, false);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.ebayApiUsed, false);
  assert.equal(summary.ebayProductionApiUsed, false);
  assert.equal(summary.oauthUsed, false);
  assert.equal(summary.draftCreated, false);
  assert.equal(summary.listingCreated, false);
  assert.equal(summary.publicationExecuted, false);
  assert.equal(summary.amazonTrackTouched, false);
  assert.equal(summary.nextRecommendedRoute, "NEED_MORE_SELLER_HUB_DATA");
});

test("static guardrails and docs exist", async () => {
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
