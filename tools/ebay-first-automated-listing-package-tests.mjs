import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildEbayFirstAutomatedListingPackageReport,
  buildEbayFirstListingHumanApprovalChecklist,
  getEbayFirstAutomatedListingPackageChecklist,
  summarizeEbayFirstAutomatedListingPackage,
} from "../lib/ebay/ebay-first-automated-listing-package.ts";

const fixturePath = "tools/fixtures/ebay-first-automated-listing-package-v1.json";
const modulePath = "lib/ebay/ebay-first-automated-listing-package.ts";
const cliPath = "tools/ebay-first-automated-listing-package-dry-run.mjs";
const docPath = "docs/ebay-pro-isolation/EBAY_FIRST_AUTOMATED_LISTING_PACKAGE_RESUME_C_AUTO_V1.md";
const fixtureSource = readFileSync(fixturePath, "utf8");
const moduleSource = readFileSync(modulePath, "utf8");
const cliSource = readFileSync(cliPath, "utf8");
const docSource = readFileSync(docPath, "utf8");
const fixture = JSON.parse(fixtureSource);

test("fixture has the expected C-AUTO status and safety boundaries", () => {
  assert.equal(fixture.packageVersion, "EBAY_FIRST_AUTOMATED_LISTING_PACKAGE_RESUME_C_AUTO_V1");
  assert.equal(fixture.status, "EBAY_FIRST_AUTOMATED_LISTING_PACKAGE_READY");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_AUTOMATED_LISTING_PACKAGE_ONLY");
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
  assert.equal(fixture.imageGeneration.usedInThisLoop, false);
  assert.equal(fixture.amazonTrack.touchedInThisLoop, false);
});

test("warehouse uses the safe Luna Portex alias without a street address", () => {
  assert.equal(fixture.warehouse.warehouseAlias, "LUNA_PORTEX_BOCA_RATON");
  assert.equal(fixture.warehouse.fullWarehouseStreetAddressCommitted, false);
  assert.equal(fixture.safetyFlags.noFullWarehouseStreetAddressCommitted, true);
  const combined = `${fixtureSource}\n${docSource}\n${moduleSource}\n${cliSource}`;
  assert.doesNotMatch(combined, /streetAddress\s*[:=]/i);
});

test("report evaluates three candidates and selects the low-risk product", () => {
  const report = buildEbayFirstAutomatedListingPackageReport(fixture);
  assert.ok(report.candidatesEvaluated >= 3);
  assert.equal(report.recommendedCandidateSelected, true);
  assert.equal(report.recommendedCandidate.riskLevel, "LOW");
  assert.equal(report.recommendedCandidate.candidateId, "LP-SAFE-CABLE-CLIPS-20");
  assert.equal(report.recommendedCandidate.quantityRecommendation, 1);
  assert.equal(report.recommendedCandidate.priceRecommendation.format, "BUY_IT_NOW");
  assert.equal(report.recommendedCandidate.marginEstimate.positive, true);
});

test("high-risk product is rejected and medium-risk product stays on watchlist", () => {
  const report = buildEbayFirstAutomatedListingPackageReport(fixture);
  const rejected = report.candidatePackages.find((candidate) => candidate.candidateId === "LP-REJECT-BRANDED-AEROSOL");
  const watchlist = report.candidatePackages.find((candidate) => candidate.candidateId === "LP-WATCH-GLASS-CONTAINER");
  assert.equal(rejected.riskLevel, "HIGH");
  assert.equal(rejected.canProceedToDraftBuilder, false);
  assert.ok(rejected.rejectionReasons.length > 0);
  assert.equal(watchlist.riskLevel, "MEDIUM");
  assert.equal(watchlist.canProceedToDraftBuilder, false);
  assert.equal(report.rejectedCandidates, 1);
  assert.equal(report.watchlistCandidates, 1);
});

test("sensitive products cannot become the first listing when a safe alternative exists", () => {
  const report = buildEbayFirstAutomatedListingPackageReport(fixture);
  assert.equal(report.recommendedCandidate.productName.includes("Aerosol"), false);
  assert.equal(report.recommendedCandidate.rejectionReasons.length, 0);
});

test("title is original, readable, and within a reasonable eBay limit", () => {
  const { recommendedCandidate } = buildEbayFirstAutomatedListingPackageReport(fixture);
  assert.ok(recommendedCandidate.titleCandidate.length <= 80);
  assert.doesNotMatch(recommendedCandidate.titleCandidate, /[\p{Extended_Pictographic}]/u);
  assert.notEqual(recommendedCandidate.titleCandidate, recommendedCandidate.titleCandidate.toUpperCase());
  assert.doesNotMatch(recommendedCandidate.titleCandidate, /\b(best|official|authentic|fda|guaranteed)\b/i);
  assert.equal(recommendedCandidate.benchmarkSignals.exactCompetitorTitleCopied, false);
});

test("description contains no medical claims or unsupported promises", () => {
  const { recommendedCandidate } = buildEbayFirstAutomatedListingPackageReport(fixture);
  assert.doesNotMatch(recommendedCandidate.descriptionCandidate, /cure|treat|diagnose|prevent disease|guaranteed/i);
});

test("payload is preview-only and every candidate keeps publication disabled", () => {
  const report = buildEbayFirstAutomatedListingPackageReport(fixture);
  for (const candidate of report.candidatePackages) {
    assert.equal(candidate.canPublish, false);
    assert.equal(candidate.payloadPreview.previewOnly, true);
    assert.equal(candidate.payloadPreview.executionAllowed, false);
    if (candidate.canProceedToDraftBuilder) assert.equal(candidate.riskLevel, "LOW");
  }
  assert.equal(report.canPublish, false);
  assert.equal(report.requiresHumanApproval, true);
});

test("complete low-risk candidate can advance and incomplete candidates cannot", () => {
  const report = buildEbayFirstAutomatedListingPackageReport(fixture);
  assert.equal(report.recommendedCandidate.canProceedToDraftBuilder, true);
  assert.equal(report.recommendedCandidate.missingItemSpecifics.length, 0);
  assert.equal(report.recommendedCandidate.imagePackage.authorizedImageAvailable, true);
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-B2");
});

test("missing safe candidate routes to product data and account risk routes to hold", () => {
  const unsafeOnly = buildEbayFirstAutomatedListingPackageReport({
    ...fixture,
    candidates: fixture.candidates.slice(1),
  });
  assert.equal(unsafeOnly.nextRecommendedRoute, "NEED_PRODUCT_CANDIDATE_DATA");
  const hold = buildEbayFirstAutomatedListingPackageReport({ ...fixture, accountRiskVisible: true });
  assert.equal(hold.nextRecommendedRoute, "EBAY-RESUME-HOLD");
  assert.equal(hold.canPublish, false);
});

test("human approval and operational checklists are explicit", () => {
  const report = buildEbayFirstAutomatedListingPackageReport(fixture);
  const approval = buildEbayFirstListingHumanApprovalChecklist(fixture.candidates[0]);
  assert.ok(approval.length >= 7);
  assert.match(approval.join(" "), /image/i);
  assert.match(approval.join(" "), /price/i);
  assert.match(approval.join(" "), /VERO/i);
  assert.ok(getEbayFirstAutomatedListingPackageChecklist().length >= 5);
  assert.ok(report.humanApprovalChecklistBuilt);
});

test("module and CLI do not use prohibited runtime capabilities", () => {
  const prohibited = [
    "process" + ".env",
    "fetch" + "(",
    "create" + "Client",
    ".fr" + "om(",
    ".ins" + "ert(",
    ".upd" + "ate(",
    ".ups" + "ert(",
    "write" + "File",
    "append" + "File",
    "create" + "WriteStream",
  ];
  for (const pattern of prohibited) {
    assert.equal(moduleSource.includes(pattern), false, pattern);
    assert.equal(cliSource.includes(pattern), false, pattern);
  }
});

test("C-AUTO files do not mix paused implementation tracks or credentials", () => {
  const combined = `${moduleSource}\n${cliSource}\n${fixtureSource}\n${docSource}`;
  const forbidden = [
    "AMAZON_LISTING_PACKAGE_BUILDER",
    "ebay-sandbox-draft-listing",
    "EBAY_SANDBOX_DRAFT_LISTING",
    "access" + "_token",
    "refresh" + "_token",
    "client" + "_secret",
    "authorization" + " code",
  ];
  for (const marker of forbidden) assert.equal(combined.includes(marker), false, marker);
});

test("summary exposes expected numeric and safety output", () => {
  const summary = summarizeEbayFirstAutomatedListingPackage(
    buildEbayFirstAutomatedListingPackageReport(fixture),
  );
  assert.equal(summary.automatedListingPackageBuilt, true);
  assert.equal(typeof summary.candidatesEvaluated, "number");
  assert.equal(summary.candidatesEvaluated, 3);
  assert.equal(summary.canProceedToDraftBuilder, true);
  assert.equal(summary.canPublish, false);
  assert.equal(summary.productionWriteTouched, false);
  assert.equal(summary.ebayWriteApiUsed, false);
  assert.equal(summary.oauthUsedInThisLoop, false);
  assert.equal(summary.fullWarehouseStreetAddressCommitted, false);
});

test("CLI dry-run executes and prints the expected route", async () => {
  const messages = [];
  const originalLog = console.log;
  console.log = (message) => messages.push(String(message));
  try {
    await import(`./ebay-first-automated-listing-package-dry-run.mjs?test=${Date.now()}`);
  } finally {
    console.log = originalLog;
  }
  const output = JSON.parse(messages.join("\n"));
  assert.equal(output.automatedListingPackageBuilt, true);
  assert.equal(output.candidatesEvaluated, 3);
  assert.equal(output.recommendedCandidateSelected, true);
  assert.equal(output.listingTitleBuilt, true);
  assert.equal(output.pricingPackageBuilt, true);
  assert.equal(output.imagePackageBuilt, true);
  assert.equal(output.payloadPreviewBuilt, true);
  assert.equal(output.humanApprovalChecklistBuilt, true);
  assert.equal(output.nextRecommendedRoute, "EBAY-RESUME-B2");
  assert.equal(output.canPublish, false);
});
