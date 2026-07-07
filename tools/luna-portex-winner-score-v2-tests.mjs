import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/luna-portex-winner-score-v2-v1.json";
const soldPriceFixturePath =
  "tools/fixtures/luna-portex-sold-price-intelligence-sample-v1.json";
const modulePath =
  "lib/ebay/luna-portex-winner-score-v2.ts";
const benchmarkModulePath =
  "lib/ebay/luna-portex-benchmark-data-model.ts";
const routeModulePath =
  "lib/ebay/ebay-pro-official-route.ts";
const cliPath =
  "tools/luna-portex-winner-score-v2-dry-run.mjs";
const docPath =
  "docs/ebay-pro-isolation/LUNA_PORTEX_WINNER_SCORE_V2_BUY_DIRECT_OPPORTUNITY_V1.md";

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

async function buildSampleWinnerModel() {
  const benchmarkModule =
    await import(`../${benchmarkModulePath}`);
  const winnerModule =
    await import(`../${modulePath}`);
  const candidateRows =
    soldPriceSignals.map(signal => signal.candidateSnapshot);
  const benchmarkModel =
    benchmarkModule.buildBenchmarkDataModel(candidateRows, soldPriceSignals);

  return {
    winnerModule,
    model:
      winnerModule.buildWinnerScoreV2Model(benchmarkModel.models),
    benchmarkModel,
  };
}

test("winner score fixture locks LOOP 144 boundaries", () => {
  assert.equal(fixture.winnerScoreVersion, "LUNA_PORTEX_WINNER_SCORE_V2_BUY_DIRECT_OPPORTUNITY_V1");
  assert.equal(fixture.status, "WINNER_SCORE_V2_READY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.ebayApi.usedInThisLoop, false);
  assert.equal(fixture.whatsapp.realSendUsedInThisLoop, false);
  assert.equal(fixture.listing.createdInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.benchmarkInput.required, true);
});

test("Winner Score V2 generates three bounded models", async () => {
  const { model } =
    await buildSampleWinnerModel();

  assert.equal(model.winnerScoreModelsBuilt, 3);

  for (const entry of model.models) {
    assert.equal(entry.score.winnerScore >= 0, true);
    assert.equal(entry.score.winnerScore <= 100, true);
    assert.equal(entry.buyDirectOpportunity.buyDirectOpportunityScore >= 0, true);
    assert.equal(entry.buyDirectOpportunity.buyDirectOpportunityScore <= 100, true);
    assert.equal(["SELL", "REVIEW", "WATCHLIST", "REJECT"].includes(entry.sellerDecision), true);
    assert.equal(
      [
        "SELL_VIA_LUNA_PORTEX",
        "WATCHLIST",
        "REQUEST_DIRECT_SUPPLIER_QUOTE",
        "BUY_DIRECT_SMALL_BATCH",
        "REJECT",
      ].includes(entry.buyDirectOpportunity.directSourcingDecision),
      true,
    );
  }
});

test("pricing psychology does not reward lowest-price behavior", async () => {
  const { model } =
    await buildSampleWinnerModel();

  for (const entry of model.models) {
    assert.equal(entry.score.doNotRaceToBottom, true);
    assert.equal(entry.score.lowestPriceNotRequired, true);
  }
});

test("missing image stock compliance and LOW confidence block SELL", async () => {
  const { winnerModule, benchmarkModel, model } =
    await buildSampleWinnerModel();
  const missingImage =
    model.models.find(entry => entry.candidateKey === "luna-portex:first_real_mini_scan:rustoleum-smokey-beige-12oz");
  const lowConfidence =
    model.models.find(entry => entry.candidateKey === "luna-portex:first_real_mini_scan:gg-16000tsm");
  const complianceInput =
    winnerModule.buildWinnerScoreInput({
      ...benchmarkModel.models[0],
      candidateInput:
        {
          ...benchmarkModel.models[0].candidateInput,
          title:
            "Sanitized aerosol electrical candidate",
        },
    });
  const complianceScore =
    winnerModule.calculateWinnerScoreV2(complianceInput);
  const complianceBuyDirect =
    winnerModule.calculateBuyDirectOpportunityScore(complianceInput);
  const complianceReadiness =
    winnerModule.calculateWinnerReadinessGates(
      complianceInput,
      {
        ...complianceScore,
        buyDirectOpportunity:
          complianceBuyDirect,
      },
    );
  const complianceDecision =
    winnerModule.calculateSellerDecision(
      {
        ...complianceScore,
        buyDirectOpportunity:
          complianceBuyDirect,
      },
      complianceReadiness,
    );

  assert.ok(missingImage);
  assert.notEqual(missingImage.sellerDecision, "SELL");
  assert.equal(missingImage.readiness.blockedReasons.includes("missing image"), true);
  assert.ok(lowConfidence);
  assert.notEqual(lowConfidence.sellerDecision, "SELL");
  assert.equal(lowConfidence.input.soldPriceIntelligence.priceDataConfidence, "LOW");
  assert.notEqual(complianceDecision, "SELL");
  assert.equal(complianceReadiness.blockedReasons.includes("compliance review required"), true);
});

test("unknown stock and low margin block SELL", async () => {
  const { winnerModule, benchmarkModel } =
    await buildSampleWinnerModel();
  const unknownStockInput =
    winnerModule.buildWinnerScoreInput({
      ...benchmarkModel.models[0],
      candidateInput:
        {
          ...benchmarkModel.models[0].candidateInput,
          stockStatus:
            "unknown",
        },
    });
  const unknownScore =
    winnerModule.calculateWinnerScoreV2(unknownStockInput);
  const unknownBuy =
    winnerModule.calculateBuyDirectOpportunityScore(unknownStockInput);
  const unknownReadiness =
    winnerModule.calculateWinnerReadinessGates(unknownStockInput, {
      ...unknownScore,
      buyDirectOpportunity:
        unknownBuy,
    });
  const lowMarginInput =
    winnerModule.buildWinnerScoreInput({
      ...benchmarkModel.models[0],
      pricingPsychologyInputs:
        {
          ...benchmarkModel.models[0].pricingPsychologyInputs,
          marginProtectionScore:
            15,
          priceConfidenceScore:
            35,
        },
    });
  const lowMarginScore =
    winnerModule.calculateWinnerScoreV2(lowMarginInput);
  const lowMarginBuy =
    winnerModule.calculateBuyDirectOpportunityScore(lowMarginInput);
  const lowMarginReadiness =
    winnerModule.calculateWinnerReadinessGates(lowMarginInput, {
      ...lowMarginScore,
      buyDirectOpportunity:
        lowMarginBuy,
    });

  assert.equal(unknownReadiness.blockedReasons.includes("stock not confirmed"), true);
  assert.notEqual(winnerModule.calculateSellerDecision({ ...unknownScore, buyDirectOpportunity: unknownBuy }, unknownReadiness), "SELL");
  assert.equal(lowMarginReadiness.blockedReasons.includes("margin protection low"), true);
  assert.notEqual(winnerModule.calculateSellerDecision({ ...lowMarginScore, buyDirectOpportunity: lowMarginBuy }, lowMarginReadiness), "SELL");
});

test("high direct opportunity with missing data requests quote or watchlist, not immediate direct buy", async () => {
  const { model } =
    await buildSampleWinnerModel();
  const directCandidate =
    model.models.find(entry => entry.buyDirectOpportunity.buyDirectOpportunityScore >= 55);

  assert.ok(directCandidate);

  if (directCandidate.buyDirectOpportunity.minimumDataNeededBeforeBuyingDirect.length > 0) {
    assert.equal(
      ["REQUEST_DIRECT_SUPPLIER_QUOTE", "WATCHLIST"].includes(directCandidate.buyDirectOpportunity.directSourcingDecision),
      true,
    );
    assert.notEqual(directCandidate.buyDirectOpportunity.directSourcingDecision, "BUY_DIRECT_SMALL_BATCH");
  }
});

test("LOOP 144 never marks candidates ready for real listing", async () => {
  const { model } =
    await buildSampleWinnerModel();

  for (const entry of model.models) {
    assert.equal(entry.readiness.readyForRealListing, false);
  }

  assert.equal(model.models.some(entry => entry.readiness.readyForAdvisorReview), true);
});

test("dry-run summary has expected numeric output", async () => {
  const { winnerModule, model } =
    await buildSampleWinnerModel();
  const summary =
    winnerModule.summarizeWinnerScoreV2Model(model);

  assert.equal(summary.inputBenchmarkModels, 3);
  assert.equal(summary.winnerScoreModelsBuilt, 3);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.ebayApiUsed, false);
  assert.equal(summary.whatsappRealSendUsed, false);
  assert.equal(summary.nextLoop, "145");
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

test("route helper points LOOP 144 to LOOP 145", async () => {
  const routeModule =
    await import(`../${routeModulePath}`);
  const nextLoop =
    routeModule.getNextEbayProLoop("144");

  assert.equal(nextLoop.loopId, "145");
  assert.equal(nextLoop.label.includes("Advisor OS Candidate Review"), true);
});

test("LOOP 144 files avoid env dumps images and secret-like output", () => {
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

  const status =
    readText("/proc/self/cmdline");

  assert.equal(status.includes(".env"), false);
});
