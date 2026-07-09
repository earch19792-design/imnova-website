import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/amazon-product-winner-metrics-v1.json";
const modulePath =
  "lib/marketplace/amazon-product-winner-metrics.ts";
const cliPath =
  "tools/amazon-product-winner-metrics-dry-run.mjs";
const docPath =
  "docs/marketplace-isolation/AMAZON_PRODUCT_WINNER_METRICS_LISTING_READINESS_V1.md";

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
  const amazonModule =
    await import(`../${modulePath}`);

  return {
    fixture,
    amazonModule,
    queue:
      amazonModule.buildAmazonAssessmentQueue(fixture.products),
  };
}

test("fixture locks LOOP 149A dry-run boundaries", () => {
  const fixture =
    readJson(fixturePath);

  assert.equal(fixture.amazonProductWinnerMetricsVersion, "AMAZON_PRODUCT_WINNER_METRICS_LISTING_READINESS_V1");
  assert.equal(fixture.status, "AMAZON_PRODUCT_WINNER_METRICS_READY");
  const prodBoundary =
    fixture.production;
  const stageBoundary =
    fixture.staging;

  assert.equal(prodBoundary.offLimits, true);
  assert.equal(prodBoundary.writeExecutedInThisLoop, false);
  assert.equal(stageBoundary.writeExecutedInThisLoop, false);
  assert.equal(fixture.amazonApi.usedInThisLoop, false);
  assert.equal(fixture.sellerCentral.writeExecutedInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.products.length, 3);
});

test("assessment queue builds three bounded Amazon assessments", async () => {
  const { queue } =
    await buildQueue();

  assert.equal(queue.inputProducts, 3);
  assert.equal(queue.assessmentsBuilt, 3);
  assert.equal(queue.amazonApiUsed, false);
  assert.equal(queue.sellerCentralWriteExecuted, false);
  assert.equal(queue.publicationExecuted, false);
  assert.equal(queue.stagingWriteExecuted, false);

  for (const assessment of queue.assessments) {
    assert.equal(assessment.winnerScore.amazonWinnerScore >= 0, true);
    assert.equal(assessment.winnerScore.amazonWinnerScore <= 100, true);
    assert.equal(assessment.listingReadiness.listingReadinessScore >= 0, true);
    assert.equal(assessment.listingReadiness.listingReadinessScore <= 100, true);
  }
});

test("existing ASIN product recommends selling on existing ASIN or more research", async () => {
  const { queue } =
    await buildQueue();
  const existingAsin =
    queue.assessments.find(entry => entry.input.existingAsin === "B0SANITIZED1");

  assert.ok(existingAsin);
  assert.equal(existingAsin.listingReadiness.asinStrategy, "SELL_ON_EXISTING_ASIN");
  assert.equal(["SELL_ON_EXISTING_ASIN", "RESEARCH_MORE"].includes(existingAsin.decision), true);
});

test("product without identifier needs exemption or can create new ASIN according to data", async () => {
  const { queue } =
    await buildQueue();
  const missingIdentifier =
    queue.assessments.find(entry => entry.input.candidateKey === "amazon-loop149a:household-simple-storage-bin");

  assert.ok(missingIdentifier);
  assert.equal(["NEED_GTIN_OR_EXEMPTION", "CREATE_NEW_ASIN"].includes(missingIdentifier.listingReadiness.asinStrategy), true);
  assert.equal(missingIdentifier.input.hasGtin, false);
});

test("restricted category blocks or requests approval", async () => {
  const { queue } =
    await buildQueue();
  const restricted =
    queue.assessments.find(entry => entry.input.productType === "cleaning_chemical");

  assert.ok(restricted);
  assert.equal(restricted.winnerScore.categoryRestrictionRisk >= 65, true);
  assert.equal(["REQUEST_CATEGORY_APPROVAL", "REJECT_FOR_NOW"].includes(restricted.decision), true);
});

test("high review barrier and low margin reduce winner score", async () => {
  const { amazonModule, fixture } =
    await buildQueue();
  const baseElectrical =
    fixture.products.find(entry => entry.productType === "electrical");
  const highReviewBarrier =
    amazonModule.buildAmazonProductAssessment({
      ...baseElectrical,
      candidateKey: "test:review-barrier",
      competition:
        {
          ...baseElectrical.competition,
          averageReviewCount: 4000,
        },
    });
  const lowMargin =
    amazonModule.buildAmazonProductAssessment({
      ...baseElectrical,
      candidateKey: "test:low-margin",
      profitability:
        {
          ...baseElectrical.profitability,
          landedCost: 21,
          estimatedAmazonFees: 7,
          expectedRoiPercent: 18,
        },
    });
  const base =
    amazonModule.buildAmazonProductAssessment(baseElectrical);

  assert.equal(highReviewBarrier.winnerScore.reviewBarrierScore < base.winnerScore.reviewBarrierScore, true);
  assert.equal(highReviewBarrier.winnerScore.amazonWinnerScore < base.winnerScore.amazonWinnerScore, true);
  assert.equal(lowMargin.winnerScore.marginScore < base.winnerScore.marginScore, true);
  assert.equal(lowMargin.winnerScore.amazonWinnerScore < base.winnerScore.amazonWinnerScore, true);
});

test("keywords are research inputs, exact listing copy is never allowed", async () => {
  const { amazonModule, fixture } =
    await buildQueue();
  const household =
    fixture.products.find(entry => entry.productType === "household_simple");
  const assessment =
    amazonModule.buildAmazonProductAssessment(household);
  const copyRisk =
    amazonModule.buildAmazonProductAssessment({
      ...household,
      keywordOpportunity:
        {
          ...household.keywordOpportunity,
          exactListingCopyRequested: true,
        },
    });

  assert.equal(assessment.winnerScore.keywordResearchAllowed, true);
  assert.equal(assessment.winnerScore.exactListingCopyAllowed, false);
  assert.equal(copyRisk.winnerScore.keywordResearchAllowed, false);
  assert.equal(copyRisk.decision, "REJECT_FOR_NOW");
});

test("unauthorized trademarks and unsafe claims are blocked", async () => {
  const { amazonModule, fixture } =
    await buildQueue();
  const household =
    fixture.products.find(entry => entry.productType === "household_simple");
  const trademarkRisk =
    amazonModule.buildAmazonProductAssessment({
      ...household,
      keywordOpportunity:
        {
          ...household.keywordOpportunity,
          unauthorizedTrademarkKeywords: ["protected brand example"],
        },
    });
  const medicalClaimRisk =
    amazonModule.buildAmazonProductAssessment({
      ...household,
      keywordOpportunity:
        {
          ...household.keywordOpportunity,
          medicalClaimsPresent: true,
        },
    });
  const unconfirmedClaimRisk =
    amazonModule.buildAmazonProductAssessment({
      ...household,
      keywordOpportunity:
        {
          ...household.keywordOpportunity,
          unconfirmedClaimsPresent: true,
        },
    });

  assert.equal(trademarkRisk.winnerScore.unauthorizedTrademarkKeywordAllowed, false);
  assert.equal(trademarkRisk.decision, "REJECT_FOR_NOW");
  assert.equal(medicalClaimRisk.winnerScore.medicalClaimsAllowed, false);
  assert.equal(medicalClaimRisk.decision, "REJECT_FOR_NOW");
  assert.equal(unconfirmedClaimRisk.winnerScore.unconfirmedClaimsAllowed, false);
  assert.equal(unconfirmedClaimRisk.decision, "REJECT_FOR_NOW");
});

test("checklist exists and includes Amazon-specific gates", async () => {
  const { amazonModule } =
    await buildQueue();
  const checklist =
    amazonModule.getAmazonProductWinnerMetricsChecklist();

  assert.equal(Array.isArray(checklist), true);
  assert.equal(checklist.length >= 5, true);
  assert.equal(checklist.some(entry => entry.includes("duplicate ASINs")), true);
});

test("dry-run CLI executes and prints expected numeric output", () => {
  let output =
    "";
  const originalLog =
    console.log;

  console.log =
    value => {
      output += `${value}`;
    };

  return import(`../${cliPath}?testRun=${Date.now()}`)
    .then(() => {
      console.log =
        originalLog;
      return output;
    })
    .catch(error => {
      console.log =
        originalLog;
      throw error;
    })
    .then(capturedOutput => {
  const summary =
    JSON.parse(capturedOutput);

  assert.equal(summary.inputProducts, 3);
  assert.equal(summary.assessmentsBuilt, 3);
  assert.equal(summary.existingAsinCandidates, 1);
  assert.equal(summary.newAsinCandidates >= 0, true);
  assert.equal(summary.approvalRequiredCandidates >= 0, true);
  assert.equal(summary.invoiceRequiredCandidates >= 0, true);
  assert.equal(summary.imagePackageRequiredCandidates >= 0, true);
  assert.equal(summary.watchlistCandidates >= 0, true);
  assert.equal(summary.rejectedCandidates >= 0, true);
  assert.equal(summary.averageAmazonWinnerScore >= 0, true);
  assert.equal(summary.averageAmazonWinnerScore <= 100, true);
  assert.equal(summary.averageListingReadinessScore >= 0, true);
  assert.equal(summary.averageListingReadinessScore <= 100, true);
  assert.equal(summary.productsBlockedByRestrictions >= 1, true);
  assert.equal(summary.productsBlockedByReviewBarrier >= 1, true);
  assert.equal(summary.productsBlockedByLowMargin >= 1, true);
  assert.equal(summary.productsBlockedByMissingData >= 1, true);
  assert.equal(summary.amazonApiUsed, false);
  assert.equal(summary.sellerCentralWriteExecuted, false);
  assert.equal(summary.publicationExecuted, false);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.nextLoop, "149B");
    });
});

test("module CLI fixture and doc avoid external integrations writes and sensitive artifacts", () => {
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
      ["Seller Central ", "automation"].join(""),
    ];

    for (const pattern of forbiddenPatterns) {
      assert.equal(source.includes(pattern), false, `${path} contains ${pattern}`);
    }
  }

  for (const path of [
    fixturePath,
    modulePath,
    cliPath,
    docPath,
  ]) {
    const source =
      readText(path);
    const forbiddenPatterns = [
      ["access", "token"].join("_"),
      ["refresh", "token"].join("_"),
      ["client", "secret"].join("_"),
      ["Authorization", ":"].join(""),
      ["create", "Draft"].join(""),
      ["publish", "Listing"].join(""),
      "realSend",
      ["prod", "uction ", "write"].join(""),
    ];

    for (const pattern of forbiddenPatterns) {
      assert.equal(source.includes(pattern), false, `${path} contains ${pattern}`);
    }
  }
});
