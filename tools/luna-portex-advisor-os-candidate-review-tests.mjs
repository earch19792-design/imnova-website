import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/luna-portex-advisor-os-candidate-review-v1.json";
const soldPriceFixturePath =
  "tools/fixtures/luna-portex-sold-price-intelligence-sample-v1.json";
const modulePath =
  "lib/ebay/luna-portex-advisor-os-candidate-review.ts";
const benchmarkModulePath =
  "lib/ebay/luna-portex-benchmark-data-model.ts";
const winnerModulePath =
  "lib/ebay/luna-portex-winner-score-v2.ts";
const routeModulePath =
  "lib/ebay/ebay-pro-official-route.ts";
const cliPath =
  "tools/luna-portex-advisor-os-candidate-review-dry-run.mjs";
const docPath =
  "docs/ebay-pro-isolation/LUNA_PORTEX_ADVISOR_OS_CANDIDATE_REVIEW_WHATSAPP_PRICING_V1.md";

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
const soldPriceSignals =
  readJson(soldPriceFixturePath);

async function buildSampleAdvisorQueue() {
  const benchmarkModule =
    await import(`../${benchmarkModulePath}`);
  const winnerModule =
    await import(`../${winnerModulePath}`);
  const advisorModule =
    await import(`../${modulePath}`);
  const candidateRows =
    soldPriceSignals.map(signal => signal.candidateSnapshot);
  const benchmarkModel =
    benchmarkModule.buildBenchmarkDataModel(candidateRows, soldPriceSignals);
  const winnerScoreModel =
    winnerModule.buildWinnerScoreV2Model(benchmarkModel.models);

  return {
    advisorModule,
    winnerScoreModel,
    queue:
      advisorModule.buildAdvisorDecisionQueue(winnerScoreModel.models),
  };
}

test("advisor fixture locks LOOP 145 boundaries", () => {
  assert.equal(fixture.advisorVersion, "LUNA_PORTEX_ADVISOR_OS_CANDIDATE_REVIEW_WHATSAPP_PRICING_V1");
  assert.equal(fixture.status, "ADVISOR_OS_CANDIDATE_REVIEW_READY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.ebayApi.usedInThisLoop, false);
  assert.equal(fixture.whatsapp.realSendUsedInThisLoop, false);
  assert.equal(fixture.whatsapp.previewOnly, true);
  assert.equal(fixture.listing.createdInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
});

test("Advisor OS generates three reviews previews and actions", async () => {
  const { queue } =
    await buildSampleAdvisorQueue();
  const summary =
    (await import(`../${modulePath}`)).summarizeAdvisorDecisionQueue(queue);

  assert.equal(queue.advisorReviewsBuilt, 3);
  assert.equal(queue.whatsappPreviews.length >= 3, true);
  assert.equal(queue.mobileDecisionActions.length > 0, true);
  assert.deepEqual(queue.prohibitedActionsDetected, []);
  assert.equal(summary.inputWinnerScoreModels, 3);
  assert.equal(summary.advisorReviewsBuilt, 3);
});

test("real draft publication and real WhatsApp remain blocked", async () => {
  const { queue } =
    await buildSampleAdvisorQueue();

  for (const review of queue.advisorReviews) {
    assert.equal(review.canCreateEbayDraft, false);
    assert.equal(review.canPublishRealListing, false);
    assert.equal(review.requiresHumanApproval, true);
  }

  for (const preview of queue.whatsappPreviews) {
    assert.equal(preview.previewOnly, true);
    assert.equal(preview.realSendUsed, false);
  }
});

test("product missing image requests image package and blocks listing builder", async () => {
  const { queue } =
    await buildSampleAdvisorQueue();
  const imageCandidate =
    queue.advisorReviews.find(review => review.candidateKey === "luna-portex:first_real_mini_scan:rustoleum-smokey-beige-12oz");

  assert.ok(imageCandidate);
  assert.equal(imageCandidate.advisorRecommendation, "REQUEST_IMAGE_PACKAGE");
  assert.equal(imageCandidate.canMoveToListingBuilder, false);
});

test("direct sourcing opportunity recommends supplier quote or volume watchlist", async () => {
  const { queue } =
    await buildSampleAdvisorQueue();
  const directCandidates =
    queue.advisorReviews.filter(review => review.sourcingRecommendation.buyDirectOpportunityScore >= 55);

  assert.equal(directCandidates.length > 0, true);

  for (const review of directCandidates) {
    assert.equal(
      ["REQUEST_DIRECT_SUPPLIER_QUOTE", "WATCHLIST_FOR_VOLUME", "BUY_DIRECT_SMALL_BATCH_LATER"].includes(review.sourcingRecommendation.sourcingAction),
      true,
    );
  }
});

test("Pricing Advisor keeps price psychology protections", async () => {
  const { queue } =
    await buildSampleAdvisorQueue();

  for (const review of queue.advisorReviews) {
    assert.equal(review.pricingAdvisor.doNotRaceToBottom, true);
    assert.equal(review.pricingAdvisor.lowestPriceNotRequired, true);
    assert.notEqual(review.pricingAdvisor.pricingGuidance.toLowerCase().includes("cheapest"), true);
  }
});

test("LOW price data and weak margin do not trigger blind price cuts", async () => {
  const { queue } =
    await buildSampleAdvisorQueue();
  const lowConfidence =
    queue.advisorReviews.find(review => review.candidateKey === "luna-portex:first_real_mini_scan:gg-16000tsm");

  assert.ok(lowConfidence);
  assert.equal(
    ["NEED_MORE_SOLD_DATA", "IMPROVE_IMAGE_OR_TITLE_FIRST", "REJECT_IF_MARGIN_DESTROYED"].includes(lowConfidence.pricingAdvisor.priceAction),
    true,
  );
});

test("compliance review maps to compliance recommendation", async () => {
  const { advisorModule, winnerScoreModel } =
    await buildSampleAdvisorQueue();
  const complianceModel =
    {
      ...winnerScoreModel.models[0],
      readiness:
        {
          ...winnerScoreModel.models[0].readiness,
          blockedReasons:
            ["compliance review required"],
        },
    };
  const review =
    advisorModule.buildAdvisorCandidateReview(
      advisorModule.buildAdvisorCandidateInput(complianceModel),
    );

  assert.equal(review.advisorRecommendation, "NEEDS_COMPLIANCE_REVIEW");
});

test("dry-run summary has expected numeric output", async () => {
  const { advisorModule, queue } =
    await buildSampleAdvisorQueue();
  const summary =
    advisorModule.summarizeAdvisorDecisionQueue(queue);

  assert.equal(summary.inputWinnerScoreModels, 3);
  assert.equal(summary.advisorReviewsBuilt, 3);
  assert.equal(summary.whatsappPreviewMessages >= 3, true);
  assert.equal(summary.mobileDecisionActions > 0, true);
  assert.deepEqual(summary.prohibitedActionsDetected, []);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.ebayApiUsed, false);
  assert.equal(summary.whatsappRealSendUsed, false);
  assert.equal(summary.nextLoop, "146");
});

test("module and CLI avoid external integrations and writes", () => {
  for (const path of [modulePath, cliPath]) {
    const source =
      readText(path);
    const forbiddenPatterns = [
      "process.env",
      "fetch(",
      "createClient",
      ".from(",
      ".insert(",
      ".update(",
      ".upsert(",
      "new OpenAI",
      "sendWhatsApp",
      "sendWhatsapp",
    ];

    for (const pattern of forbiddenPatterns) {
      assert.equal(source.includes(pattern), false, `${path} contains ${pattern}`);
    }
  }
});

test("route helper points LOOP 145 to LOOP 146", async () => {
  const routeModule =
    await import(`../${routeModulePath}`);
  const nextLoop =
    routeModule.getNextEbayProLoop("145");

  assert.equal(nextLoop.loopId, "146");
  assert.equal(nextLoop.label.includes("Listing Package Builder"), true);
});

test("LOOP 145 files avoid env dumps images and secret-like output", () => {
  for (const path of [
    fixturePath,
    modulePath,
    cliPath,
    docPath,
  ]) {
    assert.equal(fileExists(path), true);
    const source =
      readText(path);
    const forbiddenPatterns = [
      "access_token",
      "refresh_token",
      "client_secret",
      "Authorization:",
      "new OpenAI",
      "sendWhatsApp",
      "sendWhatsapp",
      "createDraft",
      "publishListing",
    ];

    for (const pattern of forbiddenPatterns) {
      assert.equal(source.includes(pattern), false, `${path} contains ${pattern}`);
    }
  }
});
