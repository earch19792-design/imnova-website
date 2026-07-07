import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixturePath =
  "tools/fixtures/luna-portex-benchmark-data-model-v1.json";
const soldPriceFixturePath =
  "tools/fixtures/luna-portex-sold-price-intelligence-sample-v1.json";
const modulePath =
  "lib/ebay/luna-portex-benchmark-data-model.ts";
const routeModulePath =
  "lib/ebay/ebay-pro-official-route.ts";
const cliPath =
  "tools/luna-portex-benchmark-data-model-dry-run.mjs";
const docPath =
  "docs/ebay-pro-isolation/LUNA_PORTEX_BENCHMARK_DATA_MODEL_DIRECT_SOURCING_PRICING_V1.md";

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

async function buildSampleBenchmarkModel() {
  const benchmarkModule =
    await import(`../${modulePath}`);
  const candidateRows =
    soldPriceSignals.map(signal => signal.candidateSnapshot);

  return {
    benchmarkModule,
    model:
      benchmarkModule.buildBenchmarkDataModel(candidateRows, soldPriceSignals),
    candidateRows,
  };
}

test("benchmark fixture locks LOOP 143 boundaries", () => {
  assert.equal(fixture.benchmarkVersion, "LUNA_PORTEX_BENCHMARK_DATA_MODEL_DIRECT_SOURCING_PRICING_V1");
  assert.equal(fixture.status, "BENCHMARK_DATA_MODEL_READY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.ebayApi.usedInThisLoop, false);
  assert.equal(fixture.oauth.usedInThisLoop, false);
  assert.equal(fixture.terapeakRealData.usedInThisLoop, false);
  assert.equal(fixture.soldPriceFixture.usedInThisLoop, true);
  assert.equal(fixture.pricingPsychology.included, true);
  assert.equal(fixture.directSourcing.included, true);
});

test("sold price intelligence calculates average median range and confidence", async () => {
  const { benchmarkModule } =
    await buildSampleBenchmarkModel();
  const intelligence =
    benchmarkModule.calculateSoldPriceIntelligence(soldPriceSignals[0]);
  const lowConfidence =
    benchmarkModule.calculateSoldPriceIntelligence(soldPriceSignals[2]);

  assert.equal(intelligence.averageSoldPrice > 0, true);
  assert.equal(intelligence.medianSoldPrice > 0, true);
  assert.equal(intelligence.soldPriceRange.low > 0, true);
  assert.equal(intelligence.soldPriceRange.high >= intelligence.soldPriceRange.low, true);
  assert.equal(intelligence.priceDataConfidence, "MEDIUM");
  assert.equal(lowConfidence.priceDataConfidence, "LOW");
});

test("pricing psychology refuses lowest-price race and protects margin", async () => {
  const { benchmarkModule, candidateRows } =
    await buildSampleBenchmarkModel();
  const intelligence =
    benchmarkModule.calculateSoldPriceIntelligence(soldPriceSignals[0]);
  const pricing =
    benchmarkModule.calculatePricingPsychologyInputs(candidateRows[0], intelligence);
  const destroyedMargin =
    benchmarkModule.calculatePricingPsychologyInputs(
      {
        ...candidateRows[0],
        normalized_payload:
          {
            ...candidateRows[0].normalized_payload,
            cost:
              200,
          },
      },
      intelligence,
    );

  assert.equal(pricing.doNotRaceToBottom, true);
  assert.equal(pricing.lowestPriceNotRequired, true);
  assert.equal(pricing.priceConfidenceScore >= 0, true);
  assert.equal(pricing.priceConfidenceScore <= 100, true);
  assert.equal(destroyedMargin.priceChangeGuidance, "reject_if_margin_destroyed");
});

test("missing images produce image-first guidance and readiness blocker", async () => {
  const { model } =
    await buildSampleBenchmarkModel();
  const incomplete =
    model.models.find(entry => entry.candidateKey === "luna-portex:first_real_mini_scan:rustoleum-smokey-beige-12oz");

  assert.ok(incomplete);
  assert.equal(incomplete.pricingPsychologyInputs.priceChangeGuidance, "improve_image_or_title_first");
  assert.equal(incomplete.benchmarkReadiness.nextRecommendedAction, "NEEDS_IMAGE_DATA");
});

test("direct sourcing signals are scored and actioned", async () => {
  const { model } =
    await buildSampleBenchmarkModel();

  for (const entry of model.models) {
    assert.equal(entry.directSourcingSignals.directBuyOpportunityScore >= 0, true);
    assert.equal(entry.directSourcingSignals.directBuyOpportunityScore <= 100, true);
    assert.equal(
      [
        "SELL_VIA_LUNA_PORTEX",
        "WATCHLIST",
        "REQUEST_DIRECT_SUPPLIER_QUOTE",
        "BUY_DIRECT_SMALL_BATCH",
        "REJECT",
      ].includes(entry.directSourcingSignals.suggestedSourcingAction),
      true,
    );
    assert.equal(typeof entry.directSourcingSignals.outsideLunaOpportunityCandidate, "boolean");
  }
});

test("benchmark readiness produces route-ready and needs-data outcomes", async () => {
  const { model } =
    await buildSampleBenchmarkModel();
  const actions =
    model.models.map(entry => entry.benchmarkReadiness.nextRecommendedAction);

  assert.equal(
    actions.some(action => action === "READY_FOR_WINNER_SCORE"),
    true,
  );
  assert.equal(
    actions.some(action => ["NEEDS_MORE_SOLD_DATA", "NEEDS_IMAGE_DATA", "NEEDS_COMPLIANCE_REVIEW", "NEEDS_STOCK_CONFIRMATION"].includes(action)),
    true,
  );
});

test("dry-run summary has expected numeric output", async () => {
  const { benchmarkModule, model } =
    await buildSampleBenchmarkModel();
  const summary =
    benchmarkModule.summarizeBenchmarkDataModel(model);

  assert.equal(summary.inputCandidates, 3);
  assert.equal(summary.soldPriceSignals, 3);
  assert.equal(summary.benchmarkModelsBuilt, 3);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.ebayApiUsed, false);
  assert.equal(summary.nextLoop, "144");
});

test("pure module and CLI avoid external integrations and writes", () => {
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

test("route helper points LOOP 143 to LOOP 144", async () => {
  const routeModule =
    await import(`../${routeModulePath}`);
  const nextLoop =
    routeModule.getNextEbayProLoop("143");

  assert.equal(nextLoop.loopId, "144");
  assert.equal(nextLoop.label.includes("Winner Score V2"), true);
});

test("LOOP 143 files avoid env dumps images and secret-like output", () => {
  for (const path of [
    fixturePath,
    soldPriceFixturePath,
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
    spawnSync(
      "git",
      ["status", "--short", "--untracked-files=all"],
      {
        encoding:
          "utf8",
      },
    );

  assert.equal(status.status, 0);
  assert.equal(/\.env($|\.|\/)/.test(status.stdout), false);
  assert.equal(/\.(dump|sql\.dump|backup)$/im.test(status.stdout), false);
  assert.equal(/\.(png|jpg|jpeg|webp|gif|svg|avif|heic|tiff)$/im.test(status.stdout), false);
});
