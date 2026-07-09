import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/amazon-existing-asin-vs-new-asin-decision-v1.json";
const modulePath =
  "lib/marketplace/amazon-existing-asin-vs-new-asin-decision.ts";
const cliPath =
  "tools/amazon-existing-asin-vs-new-asin-decision-dry-run.mjs";
const docPath =
  "docs/marketplace-isolation/AMAZON_EXISTING_ASIN_VS_NEW_ASIN_DECISION_ENGINE_V1.md";

const allowedDecisions =
  [
    "SELL_ON_EXISTING_ASIN_AFTER_MANUAL_CHECK",
    "SELL_ON_EXISTING_ASIN_RESEARCH_ONLY",
    "CREATE_NEW_ASIN_CANDIDATE_AFTER_GTIN_BRAND_CHECK",
    "NEED_GTIN_OR_EXEMPTION_BEFORE_NEW_ASIN",
    "NEED_SELLER_CENTRAL_ELIGIBILITY_CHECK",
    "NEED_BRAND_OR_CATEGORY_APPROVAL",
    "WATCHLIST_EXISTING_ASIN",
    "WATCHLIST_NEW_ASIN_CANDIDATE",
    "REJECT_FOR_NOW",
    "DO_NOT_LIST_YET",
  ];

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

async function buildQueue() {
  const fixture =
    readJson(fixturePath);
  const decisionModule =
    await import(`../${modulePath}`);

  return {
    fixture,
    decisionModule,
    queue:
      decisionModule.buildAmazonAsinDecisionQueue(fixture),
  };
}

test("fixture locks LOOP 149F dry-run boundaries", () => {
  const fixture =
    readJson(fixturePath);

  assert.equal(fixture.asinDecisionVersion, "AMAZON_EXISTING_ASIN_VS_NEW_ASIN_DECISION_ENGINE_V1");
  assert.equal(fixture.status, "AMAZON_ASIN_DECISION_ENGINE_READY");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_ASIN_DECISION_ONLY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.amazonApi.usedInThisLoop, false);
  assert.equal(fixture.spApi.usedInThisLoop, false);
  assert.equal(fixture.sellerCentral.writeExecutedInThisLoop, false);
  assert.equal(fixture.scraper.usedInThisLoop, false);
  assert.equal(fixture.asinCreation.createdInThisLoop, false);
  assert.equal(fixture.listing.createdInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.safetyFlags.noAsinCreation, true);
  assert.equal(fixture.safetyFlags.noListingCreation, true);
  assert.equal(fixture.safetyFlags.noSecretsCommitted, true);
});

test("builds three bounded ASIN decision assessments", async () => {
  const { queue } =
    await buildQueue();

  assert.equal(queue.inputFeesProfitAssessments, 3);
  assert.equal(queue.asinDecisionAssessmentsBuilt, 3);

  for (const assessment of queue.assessments) {
    assert.equal(assessment.asinDecisionScore >= 0, true);
    assert.equal(assessment.asinDecisionScore <= 100, true);
    assert.equal(allowedDecisions.includes(assessment.finalAsinRouteDecision), true);
    assert.equal(assessment.canCreateAmazonAsin, false);
    assert.equal(assessment.canCreateAmazonListing, false);
    assert.equal(assessment.canPublish, false);
    assert.equal(assessment.canProceedToAmazonListingPackage, false);
    assert.equal(assessment.publicationExecuted, false);
    assert.equal(assessment.amazonApiUsed, false);
    assert.equal(assessment.spApiUsed, false);
    assert.equal(assessment.sellerCentralWriteExecuted, false);
    assert.equal(assessment.scraperUsed, false);
  }
});

test("DM0628N strong match stays on existing ASIN route but requires manual review", async () => {
  const { queue } =
    await buildQueue();
  const dm =
    queue.assessments.find(entry => entry.supplierSku === "luna-portex:first_real_mini_scan:dm0628n");

  assert.ok(dm);
  assert.equal(dm.catalogMatchType, "STRONG_BRAND_MODEL_SIZE_MATCH");
  assert.equal(dm.matchConfidenceScore, 97);
  assert.equal(["SELL_ON_EXISTING_ASIN_AFTER_MANUAL_CHECK", "WATCHLIST_EXISTING_ASIN"].includes(dm.finalAsinRouteDecision), true);
  assert.equal(dm.humanReviewRequired, true);
  assert.equal(dm.canProceedToAmazonListingPackage, false);
});

test("DM0628N positive ROI does not unlock listing while hazmat or chemical is pending", async () => {
  const { queue } =
    await buildQueue();
  const dm =
    queue.assessments.find(entry => entry.supplierSku === "luna-portex:first_real_mini_scan:dm0628n");

  assert.ok(dm);
  assert.equal(dm.netProfitEstimate > 0, true);
  assert.equal(dm.roiPercent > 0, true);
  assert.equal(dm.canProceedToAmazonListingPackage, false);
  assert.equal(dm.blockedReasons.includes("positive ROI cannot override restriction gate"), true);
});

test("title-only match cannot recommend automatic existing ASIN", async () => {
  const { decisionModule } =
    await buildQueue();
  const assessment =
    decisionModule.buildAmazonAsinDecisionAssessment({
      supplierSku: "synthetic:title-only",
      productTitle: "Sanitized title-only product",
      brand: "Sanitized",
      catalogMatchType: "WEAK_TITLE_ONLY_MATCH",
      matchConfidenceScore: 42,
      bestMatchAsin: "B0SANITIZEDTITLE",
      duplicateAsinRisk: "MEDIUM",
      wrongAsinRisk: "MEDIUM",
      missingUpcGtin: true,
      restrictionGateDecision: "CONTINUE_RESEARCH_ONLY",
      profitGuardDecision: "LOW_MARGIN_WATCHLIST",
      netProfitEstimate: 1,
      netMarginPercent: 5,
      roiPercent: 10,
    });

  assert.notEqual(assessment.finalAsinRouteDecision, "SELL_ON_EXISTING_ASIN_AFTER_MANUAL_CHECK");
  assert.equal(assessment.canProceedToAmazonListingPackage, false);
});

test("conflicting match and high wrong ASIN risk require human review and block listing package", async () => {
  const { queue } =
    await buildQueue();
  const conflict =
    queue.assessments.find(entry => entry.catalogMatchType === "CONFLICTING_MATCH");

  assert.ok(conflict);
  assert.equal(conflict.humanReviewRequired, true);
  assert.equal(conflict.wrongAsinRisk, "HIGH");
  assert.equal(conflict.canProceedToAmazonListingPackage, false);
  assert.equal(conflict.finalAsinRouteDecision, "NEED_SELLER_CENTRAL_ELIGIBILITY_CHECK");
});

test("high duplicate ASIN risk and missing GTIN block automatic new ASIN", async () => {
  const { queue } =
    await buildQueue();
  const aerosol =
    queue.assessments.find(entry => entry.supplierSku.includes("rustoleum"));

  assert.ok(aerosol);
  assert.equal(aerosol.duplicateAsinRisk, "HIGH");
  assert.equal(aerosol.blockedReasons.includes("high duplicate ASIN risk blocks automatic new ASIN"), true);
  assert.equal(aerosol.blockedReasons.includes("missing UPC/GTIN blocks automatic new ASIN"), true);
  assert.notEqual(aerosol.finalAsinRouteDecision, "CREATE_NEW_ASIN_CANDIDATE_AFTER_GTIN_BRAND_CHECK");
});

test("CLI dry-run executes and prints expected numeric output", async () => {
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

  assert.equal(summary.inputFeesProfitAssessments, 3);
  assert.equal(summary.asinDecisionAssessmentsBuilt, 3);
  assert.equal(summary.productsBlockedFromAmazonListingPackage >= 1, true);
  assert.equal(summary.productsRequiringHumanReview >= 1, true);
  assert.equal(summary.asinCreationExecuted, false);
  assert.equal(summary.listingCreationExecuted, false);
  assert.equal(summary.publicationExecuted, false);
  assert.equal(summary.amazonApiUsed, false);
  assert.equal(summary.spApiUsed, false);
  assert.equal(summary.sellerCentralWriteExecuted, false);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.scraperUsed, false);
  assert.equal(summary.nextLoop, "149G");
});

test("checklist exists and next loop is 149G", async () => {
  const { decisionModule, queue } =
    await buildQueue();
  const checklist =
    decisionModule.getAmazonExistingAsinVsNewAsinDecisionChecklist();

  assert.equal(Array.isArray(checklist), true);
  assert.equal(checklist.length >= 5, true);
  assert.equal(queue.nextLoop, "149G");
});

test("module and CLI avoid integrations writes and sensitive calls", () => {
  for (const path of [
    fixturePath,
    modulePath,
    cliPath,
    docPath,
  ]) {
    assert.equal(fileExists(path), true);
  }

  for (const path of [modulePath, cliPath]) {
    const source =
      readText(path);
    const forbiddenPatterns = [
      ["process", "env"].join("."),
      ["fetch", "("].join(""),
      ["create", "Client"].join(""),
      [".from", "("].join(""),
      [".insert", "("].join(""),
      [".update", "("].join(""),
      [".upsert", "("].join(""),
      ["new ", "OpenAI"].join(""),
      ["send", "WhatsApp"].join(""),
      ["send", "Whatsapp"].join(""),
    ];

    for (const pattern of forbiddenPatterns) {
      assert.equal(source.includes(pattern), false, `${path} contains ${pattern}`);
    }
  }
});
