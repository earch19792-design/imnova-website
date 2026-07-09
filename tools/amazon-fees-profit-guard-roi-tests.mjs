import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/amazon-fees-profit-guard-roi-v1.json";
const modulePath =
  "lib/marketplace/amazon-fees-profit-guard-roi.ts";
const cliPath =
  "tools/amazon-fees-profit-guard-roi-dry-run.mjs";
const docPath =
  "docs/marketplace-isolation/AMAZON_FEES_PROFIT_GUARD_ROI_V1.md";

const allowedDecisions =
  [
    "PROFITABLE_CONTINUE",
    "LOW_MARGIN_WATCHLIST",
    "REJECT_LOW_ROI",
    "REJECT_NEGATIVE_PROFIT",
    "NEED_REAL_AMAZON_FEES",
    "NEED_FBA_FBM_DECISION",
    "PRICE_TOO_COMPETITIVE",
    "BLOCKED_BY_RESTRICTION_GATE",
    "CONTINUE_RESEARCH_ONLY",
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
  const profitModule =
    await import(`../${modulePath}`);

  return {
    fixture,
    profitModule,
    queue:
      profitModule.buildAmazonFeesProfitGuardQueue(fixture),
  };
}

test("fixture locks LOOP 149E dry-run boundaries", () => {
  const fixture =
    readJson(fixturePath);

  assert.equal(fixture.feesProfitGuardVersion, "AMAZON_FEES_PROFIT_GUARD_ROI_V1");
  assert.equal(fixture.status, "AMAZON_FEES_PROFIT_GUARD_ROI_READY");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_FEES_PROFIT_GUARD_ONLY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.amazonApi.usedInThisLoop, false);
  assert.equal(fixture.spApi.usedInThisLoop, false);
  assert.equal(fixture.sellerCentral.writeExecutedInThisLoop, false);
  assert.equal(fixture.scraper.usedInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.safetyFlags.noAmazonApi, true);
  assert.equal(fixture.safetyFlags.noSpApi, true);
  assert.equal(fixture.safetyFlags.noScraper, true);
  assert.equal(fixture.safetyFlags.noSecretsCommitted, true);
});

test("builds three bounded fees and profit assessments", async () => {
  const { queue } =
    await buildQueue();

  assert.equal(queue.inputRestrictionGateAssessments, 3);
  assert.equal(queue.feesProfitAssessmentsBuilt, 3);

  for (const assessment of queue.assessments) {
    assert.equal(allowedDecisions.includes(assessment.profitGuardDecision), true);
    assert.equal(assessment.netMarginPercent > -100, true);
    assert.equal(assessment.netMarginPercent < 100, true);
    assert.equal(assessment.roiPercent > -500, true);
    assert.equal(assessment.roiPercent < 500, true);
    assert.equal(assessment.breakEvenPrice > 0, true);
    assert.equal(assessment.minimumProfitablePrice >= assessment.breakEvenPrice, true);
    assert.equal(typeof assessment.recommendedPriceRange.min, "number");
    assert.equal(typeof assessment.recommendedPriceRange.max, "number");
    assert.equal(assessment.recommendedPriceRange.max >= assessment.recommendedPriceRange.min, true);
    assert.equal(assessment.canProceedToListingPackage, false);
    assert.equal(assessment.referralFeeScheduleVersion, "AMAZON_REFERRAL_FEE_SCHEDULE_CATEGORY_RESOLVER_V1");
    assert.equal(typeof assessment.referralFeeAmount, "number");
    assert.equal(assessment.sellerCentralFeeVerified, false);
    assert.equal(assessment.spApiFeeVerified, false);
    assert.equal(assessment.publicationExecuted, false);
    assert.equal(assessment.amazonApiUsed, false);
    assert.equal(assessment.spApiUsed, false);
    assert.equal(assessment.sellerCentralWriteExecuted, false);
    assert.equal(assessment.scraperUsed, false);
  }
});

test("net profit, margin, and ROI formulas are deterministic", async () => {
  const { queue } =
    await buildQueue();
  const dm =
    queue.assessments.find(entry => entry.supplierSku === "luna-portex:first_real_mini_scan:dm0628n");

  assert.ok(dm);
  assert.equal(dm.netProfitEstimate, Number((dm.amazonSalePriceEstimate - dm.totalCostEstimate).toFixed(2)));
  assert.equal(dm.netMarginPercent, Number(((dm.netProfitEstimate / dm.amazonSalePriceEstimate) * 100).toFixed(2)));
  assert.equal(dm.roiPercent, Number(((dm.netProfitEstimate / dm.supplierCost) * 100).toFixed(2)));
  assert.equal(dm.referralFeeCategory, "Home and Kitchen");
  assert.equal(dm.referralFeeAmount, 3.45);
  assert.equal(dm.effectiveReferralFeePercent, 15.01);
  assert.equal(dm.sellerCentralFeeVerified, false);
  assert.equal(dm.spApiFeeVerified, false);
});

test("negative profit and low ROI products are rejected or strongly warned", async () => {
  const { queue } =
    await buildQueue();
  const negative =
    queue.assessments.find(entry => entry.netProfitEstimate <= 0);
  const lowRoi =
    queue.assessments.find(entry => entry.roiPercent < 35);

  assert.ok(negative);
  assert.equal(["REJECT_NEGATIVE_PROFIT", "BLOCKED_BY_RESTRICTION_GATE"].includes(negative.profitGuardDecision), true);
  assert.ok(lowRoi);
  assert.equal(
    ["REJECT_LOW_ROI", "LOW_MARGIN_WATCHLIST", "PRICE_TOO_COMPETITIVE", "BLOCKED_BY_RESTRICTION_GATE"].includes(lowRoi.profitGuardDecision),
    true,
  );
});

test("sale price below minimum profitable price triggers low margin or price warning", async () => {
  const { queue } =
    await buildQueue();
  const underFloor =
    queue.assessments.find(entry => entry.amazonSalePriceEstimate < entry.minimumProfitablePrice);

  assert.ok(underFloor);
  assert.equal(
    ["PRICE_TOO_COMPETITIVE", "LOW_MARGIN_WATCHLIST", "BLOCKED_BY_RESTRICTION_GATE"].includes(underFloor.profitGuardDecision),
    true,
  );
  assert.equal(["MEDIUM", "HIGH"].includes(underFloor.priceCompetitivenessRisk), true);
});

test("missing dimensions or weight gates FBA/FBM decision or real fee need", async () => {
  const { queue } =
    await buildQueue();
  const missingDimensions =
    queue.assessments.find(entry => entry.supplierSku === "luna-portex:first_real_mini_scan:gg-16000tsm");

  assert.ok(missingDimensions);
  assert.equal(missingDimensions.fulfillmentRecommendation, "NEED_DIMENSIONS_WEIGHT");
  assert.equal(
    ["NEED_FBA_FBM_DECISION", "BLOCKED_BY_RESTRICTION_GATE"].includes(missingDimensions.profitGuardDecision),
    true,
  );
  assert.equal(missingDimensions.warnings.includes("FBA/FBM decision needs dimensions and weight"), true);
});

test("DM0628N can calculate ROI but remains blocked from listing package", async () => {
  const { queue } =
    await buildQueue();
  const dm =
    queue.assessments.find(entry => entry.supplierSku === "luna-portex:first_real_mini_scan:dm0628n");

  assert.ok(dm);
  assert.equal(dm.canProceedToFeesRoi, true);
  assert.equal(dm.netProfitEstimate > 0, true);
  assert.equal(dm.roiPercent > 0, true);
  assert.equal(dm.referralFeeRuleType, "SIMPLE_PERCENT");
  assert.equal(dm.referralFeeMinimumApplied, false);
  assert.equal(dm.canProceedToListingPackage, false);
  assert.equal(dm.blockedReasons.includes("listing package remains blocked by prior gates"), true);
});

test("high restriction product cannot advance to listing package even with margin", async () => {
  const { queue } =
    await buildQueue();
  const aerosol =
    queue.assessments.find(entry => entry.supplierSku.includes("rustoleum"));

  assert.ok(aerosol);
  assert.equal(aerosol.profitGuardDecision, "BLOCKED_BY_RESTRICTION_GATE");
  assert.equal(aerosol.canProceedToListingPackage, false);
  assert.equal(aerosol.productsBlockedFromListingPackage, true);
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

  assert.equal(summary.inputRestrictionGateAssessments, 3);
  assert.equal(summary.feesProfitAssessmentsBuilt, 3);
  assert.equal(summary.productsEligibleForFeesRoi >= 1, true);
  assert.equal(summary.productsBlockedFromListingPackage >= 1, true);
  assert.equal(summary.productsRequiringHumanReview >= 1, true);
  assert.equal(summary.referralFeeScheduleUsed, true);
  assert.equal(summary.referralFeeCategoriesResolved, 3);
  assert.equal(summary.uncertainReferralFeeCategories >= 1, true);
  assert.equal(summary.sellerCentralFeeVerified, false);
  assert.equal(summary.spApiFeeVerified, false);
  assert.equal(typeof summary.averageNetProfitEstimate, "number");
  assert.equal(typeof summary.averageNetMarginPercent, "number");
  assert.equal(typeof summary.averageRoiPercent, "number");
  assert.equal(summary.amazonApiUsed, false);
  assert.equal(summary.spApiUsed, false);
  assert.equal(summary.sellerCentralWriteExecuted, false);
  assert.equal(summary.publicationExecuted, false);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.scraperUsed, false);
  assert.equal(summary.nextLoop, "149F");
});

test("checklist exists and next loop is 149F", async () => {
  const { profitModule, queue } =
    await buildQueue();
  const checklist =
    profitModule.getAmazonFeesProfitGuardRoiChecklist();

  assert.equal(Array.isArray(checklist), true);
  assert.equal(checklist.length >= 5, true);
  assert.equal(queue.nextLoop, "149F");
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
