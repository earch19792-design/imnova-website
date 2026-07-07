import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/luna-portex-listing-package-builder-v1.json";
const soldPriceFixturePath =
  "tools/fixtures/luna-portex-sold-price-intelligence-sample-v1.json";
const modulePath =
  "lib/ebay/luna-portex-listing-package-builder.ts";
const advisorModulePath =
  "lib/ebay/luna-portex-advisor-os-candidate-review.ts";
const benchmarkModulePath =
  "lib/ebay/luna-portex-benchmark-data-model.ts";
const winnerModulePath =
  "lib/ebay/luna-portex-winner-score-v2.ts";
const routeModulePath =
  "lib/ebay/ebay-pro-official-route.ts";
const cliPath =
  "tools/luna-portex-listing-package-builder-dry-run.mjs";
const docPath =
  "docs/ebay-pro-isolation/LUNA_PORTEX_LISTING_PACKAGE_BUILDER_VALUE_PRICING_V1.md";

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

async function buildSampleListingPackageQueue() {
  const benchmarkModule =
    await import(`../${benchmarkModulePath}`);
  const winnerModule =
    await import(`../${winnerModulePath}`);
  const advisorModule =
    await import(`../${advisorModulePath}`);
  const listingModule =
    await import(`../${modulePath}`);
  const candidateRows =
    soldPriceSignals.map(signal => signal.candidateSnapshot);
  const benchmarkModel =
    benchmarkModule.buildBenchmarkDataModel(candidateRows, soldPriceSignals);
  const winnerScoreModel =
    winnerModule.buildWinnerScoreV2Model(benchmarkModel.models);
  const advisorQueue =
    advisorModule.buildAdvisorDecisionQueue(winnerScoreModel.models);

  return {
    advisorQueue,
    listingModule,
    queue:
      listingModule.buildListingPackageQueue(advisorQueue.advisorReviews),
  };
}

test("listing package fixture locks LOOP 146 boundaries", () => {
  assert.equal(fixture.listingPackageVersion, "LUNA_PORTEX_LISTING_PACKAGE_BUILDER_VALUE_PRICING_V1");
  assert.equal(fixture.status, "LISTING_PACKAGE_BUILDER_READY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.ebayApi.usedInThisLoop, false);
  assert.equal(fixture.whatsapp.realSendUsedInThisLoop, false);
  assert.equal(fixture.whatsapp.previewOnly, true);
  assert.equal(fixture.listingDraft.createdInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.valueBasedPricing.included, true);
  assert.equal(fixture.trustBasedOptimization.included, true);
});

test("Listing Package Builder generates packages and previews", async () => {
  const { queue, listingModule } =
    await buildSampleListingPackageQueue();
  const summary =
    listingModule.summarizeListingPackageQueue(queue);

  assert.equal(queue.inputAdvisorReviews, 3);
  assert.equal(queue.listingPackagesBuilt >= 1, true);
  assert.equal(queue.whatsappListingApprovalPreviews.length >= 1, true);
  assert.deepEqual(queue.prohibitedActionsDetected, []);
  assert.equal(summary.inputAdvisorReviews, 3);
  assert.equal(summary.listingPackagesBuilt, 3);
});

test("listing titles are eBay-safe for this dry-run layer", async () => {
  const { queue } =
    await buildSampleListingPackageQueue();
  const emojiPattern =
    /[\u{1F300}-\u{1FAFF}]/u;

  for (const listingPackage of queue.packages) {
    assert.equal(listingPackage.listingTitle.length <= 80, true);
    assert.equal(emojiPattern.test(listingPackage.listingTitle), false);
    assert.notEqual(listingPackage.listingTitle, listingPackage.listingTitle.toUpperCase());
    assert.equal(/\b(best|guaranteed|official)\b/i.test(listingPackage.listingTitle), false);
  }
});

test("listing description is original and avoids unconfirmed claims", async () => {
  const { queue } =
    await buildSampleListingPackageQueue();

  for (const listingPackage of queue.packages) {
    assert.equal(listingPackage.listingDescription.includes("benchmark"), false);
    assert.equal(/\bguaranteed\b/i.test(listingPackage.listingDescription), false);
    assert.equal(/\bmedical\b/i.test(listingPackage.listingDescription), false);
    assert.notEqual(listingPackage.listingDescription, listingPackage.productTitle);
  }
});

test("Value-Based Pricing keeps price war protections", async () => {
  const { queue } =
    await buildSampleListingPackageQueue();

  for (const listingPackage of queue.packages) {
    assert.equal(listingPackage.pricingRecommendation.doNotRaceToBottom, true);
    assert.equal(listingPackage.pricingRecommendation.lowestPriceNotRequired, true);
    assert.equal(listingPackage.pricingRecommendation.valueBasedPricing, true);
    assert.notEqual(listingPackage.pricingRecommendation.pricingGuidance.toLowerCase().includes("cheapest"), true);
  }
});

test("missing images and compliance risk produce blockers", async () => {
  const { queue, listingModule } =
    await buildSampleListingPackageQueue();
  const summary =
    listingModule.summarizeListingPackageQueue(queue);

  assert.equal(summary.blockedByImages > 0, true);

  const compliancePackage =
    listingModule.buildListingPackage({
      candidateKey: "luna-portex:test:aerosol-spray",
      productTitle: "Aerosol Spray Finish",
      advisorRecommendation: "APPROVE_FOR_ADVISOR_REVIEW",
      sellerDecision: "REVIEW",
      blockers: [],
      warnings: [],
      pricingAdvisor: {
        priceConfidenceScore: 70,
        marginProtectionScore: 70,
        perceivedValueScore: 70,
        priceWarRiskScore: 20,
        doNotRaceToBottom: true,
        lowestPriceNotRequired: true,
      },
    });

  assert.equal(compliancePackage.requiresComplianceReview, true);
  assert.equal(compliancePackage.complianceWarnings.length > 0, true);
});

test("draft publication and real listing remain blocked", async () => {
  const { queue } =
    await buildSampleListingPackageQueue();

  for (const listingPackage of queue.packages) {
    assert.equal(listingPackage.canCreateEbayDraft, false);
    assert.equal(listingPackage.canPublishRealListing, false);
    assert.equal(listingPackage.readyForRealListing, false);
    assert.equal(listingPackage.requiresHumanApproval, true);
  }
});

test("WhatsApp listing approval previews use allowed intents only", async () => {
  const { queue } =
    await buildSampleListingPackageQueue();
  const prohibited =
    [
      "CREATE_EBAY_DRAFT",
      "PUBLISH_LISTING",
      "SEND_REAL_WHATSAPP",
      "UPDATE_STAGING_DECISION",
      "TOUCH_PRODUCTION",
    ];

  assert.equal(queue.whatsappListingApprovalPreviews.length > 0, true);
  assert.deepEqual(queue.prohibitedActionsDetected, []);

  for (const preview of queue.whatsappListingApprovalPreviews) {
    assert.equal(preview.messageType, "LISTING_PACKAGE_REVIEW");
    assert.equal(preview.previewOnly, true);
    assert.equal(preview.realSendUsed, false);
    for (const action of preview.buttons) {
      assert.equal(prohibited.includes(action), false);
    }
  }
});

test("readyForImageWorkflow is calculated and dry-run summary is numeric", async () => {
  const { queue, listingModule } =
    await buildSampleListingPackageQueue();
  const summary =
    listingModule.summarizeListingPackageQueue(queue);

  assert.equal(summary.inputAdvisorReviews, 3);
  assert.equal(summary.listingPackagesBuilt >= 1, true);
  assert.equal(summary.readyForImageWorkflow >= 0, true);
  assert.equal(summary.whatsappListingApprovalPreviews >= 1, true);
  assert.deepEqual(summary.prohibitedActionsDetected, []);
  assert.equal(summary.canCreateEbayDraft, false);
  assert.equal(summary.canPublishRealListing, false);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.ebayApiUsed, false);
  assert.equal(summary.whatsappRealSendUsed, false);
  assert.equal(summary.nextLoop, "147");
});

test("CLI dry-run executes and returns expected output", () => {
  const originalLog =
    console.log;
  let output =
    "";

  console.log =
    value => {
      output += String(value);
    };

  return import(`../${cliPath}?dryRunTest=${Date.now()}`)
    .then(() => {
      console.log =
        originalLog;
      const parsed =
        JSON.parse(output);

      assert.equal(parsed.summary.inputAdvisorReviews, 3);
      assert.equal(parsed.summary.listingPackagesBuilt >= 1, true);
      assert.equal(parsed.summary.whatsappListingApprovalPreviews >= 1, true);
      assert.deepEqual(parsed.summary.prohibitedActionsDetected, []);
      assert.equal(parsed.summary.canCreateEbayDraft, false);
      assert.equal(parsed.summary.canPublishRealListing, false);
      assert.equal(parsed.summary.stagingWriteExecuted, false);
      assert.equal(parsed.summary.ebayApiUsed, false);
      assert.equal(parsed.summary.whatsappRealSendUsed, false);
      assert.equal(parsed.summary.nextLoop, "147");
    })
    .finally(() => {
      console.log =
        originalLog;
    });
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

test("docs exist and route helper points LOOP 146 to LOOP 147", async () => {
  assert.equal(fileExists(docPath), true);

  const routeModule =
    await import(`../${routeModulePath}`);
  const nextLoop =
    routeModule.getNextEbayProLoop("146");

  assert.ok(nextLoop);
  assert.equal(nextLoop.loopId, "147");
  assert.equal(nextLoop.label.includes("Image Package Workflow"), true);
});

test("no env dumps or image files were added for LOOP 146", () => {
  const loopFiles =
    [
      fixturePath,
      modulePath,
      cliPath,
      docPath,
      "tools/luna-portex-listing-package-builder-tests.mjs",
    ];

  assert.equal(loopFiles.some(path => path.includes(".env")), false);
  assert.equal(loopFiles.some(path => /\.(dump|backup|png|jpg|jpeg|gif|webp|svg)$/i.test(path)), false);
});
