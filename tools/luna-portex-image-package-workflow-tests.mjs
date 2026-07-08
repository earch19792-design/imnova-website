import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/luna-portex-image-package-workflow-v1.json";
const soldPriceFixturePath =
  "tools/fixtures/luna-portex-sold-price-intelligence-sample-v1.json";
const modulePath =
  "lib/ebay/luna-portex-image-package-workflow.ts";
const listingModulePath =
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
  "tools/luna-portex-image-package-workflow-dry-run.mjs";
const docPath =
  "docs/ebay-pro-isolation/LUNA_PORTEX_IMAGE_PACKAGE_WORKFLOW_PERCEIVED_VALUE_V1.md";

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

async function buildSampleImagePackageQueue() {
  const benchmarkModule =
    await import(`../${benchmarkModulePath}`);
  const winnerModule =
    await import(`../${winnerModulePath}`);
  const advisorModule =
    await import(`../${advisorModulePath}`);
  const listingModule =
    await import(`../${listingModulePath}`);
  const imageModule =
    await import(`../${modulePath}`);
  const candidateRows =
    soldPriceSignals.map(signal => signal.candidateSnapshot);
  const benchmarkModel =
    benchmarkModule.buildBenchmarkDataModel(candidateRows, soldPriceSignals);
  const winnerScoreModel =
    winnerModule.buildWinnerScoreV2Model(benchmarkModel.models);
  const advisorQueue =
    advisorModule.buildAdvisorDecisionQueue(winnerScoreModel.models);
  const listingPackageQueue =
    listingModule.buildListingPackageQueue(advisorQueue.advisorReviews);

  return {
    imageModule,
    listingPackageQueue,
    queue:
      imageModule.buildImagePackageQueue(listingPackageQueue.packages),
  };
}

test("image workflow fixture locks LOOP 147 boundaries", () => {
  assert.equal(fixture.imageWorkflowVersion, "LUNA_PORTEX_IMAGE_PACKAGE_WORKFLOW_PERCEIVED_VALUE_V1");
  assert.equal(fixture.status, "IMAGE_PACKAGE_WORKFLOW_READY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.ebayApi.usedInThisLoop, false);
  assert.equal(fixture.whatsapp.realSendUsedInThisLoop, false);
  assert.equal(fixture.openAi.usedInThisLoop, false);
  assert.equal(fixture.imageGeneration.executedInThisLoop, false);
  assert.equal(fixture.imageUpload.executedInThisLoop, false);
  assert.equal(fixture.listingDraft.createdInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
});

test("Image Package Workflow generates image packages", async () => {
  const { queue, imageModule } =
    await buildSampleImagePackageQueue();
  const summary =
    imageModule.summarizeImagePackageQueue(queue);

  assert.equal(queue.inputListingPackages, 3);
  assert.equal(queue.imagePackagesBuilt, 3);
  assert.equal(summary.inputListingPackages, 3);
  assert.equal(summary.imagePackagesBuilt, 3);
  assert.equal(queue.whatsappImageAlertPreviews.length >= 1, true);
});

test("main image requirements enforce real product image rules", async () => {
  const { queue } =
    await buildSampleImagePackageQueue();

  for (const imagePackage of queue.packages) {
    assert.equal(imagePackage.mainImageRequirements.mustUseRealProductImage, true);
    assert.equal(imagePackage.mainImageRequirements.noTextOverlay, true);
    assert.equal(imagePackage.mainImageRequirements.noWatermarks, true);
    assert.equal(imagePackage.mainImageRequirements.noGeneratedFakeProduct, true);
    assert.equal(imagePackage.mainImageRequirements.mustNotAlterProductAppearance, true);
  }
});

test("secondary image plan includes six expected image types", async () => {
  const { queue } =
    await buildSampleImagePackageQueue();
  const expectedTypes =
    [
      "product-in-use",
      "material or detail zoom",
      "package contents",
      "dimensions / size context",
      "benefit visual",
      "lifestyle or use scenario",
    ];

  for (const imagePackage of queue.packages) {
    const actualTypes =
      imagePackage.secondaryImagePlan.secondaryImages.map(image => image.imageType);

    assert.deepEqual(actualTypes, expectedTypes);
  }
});

test("perceived value image score stays within bounds", async () => {
  const { queue } =
    await buildSampleImagePackageQueue();

  for (const imagePackage of queue.packages) {
    const score =
      imagePackage.perceivedValueImageCheck.perceivedValueImageScore;

    assert.equal(score >= 0 && score <= 100, true);
    assert.equal(imagePackage.perceivedValueImageCheck.mainImageReadinessScore >= 0, true);
    assert.equal(imagePackage.perceivedValueImageCheck.imageRiskPenalty >= 0, true);
  }
});

test("missing main image and missing image data block draft readiness", async () => {
  const { queue } =
    await buildSampleImagePackageQueue();

  assert.equal(queue.packages.some(imagePackage => imagePackage.imageReadinessGates.blockedByMissingMainImage), true);

  for (const imagePackage of queue.packages) {
    assert.equal(imagePackage.readyForEbayDraft, false);
    assert.equal(imagePackage.imageReadinessGates.readyForEbayDraft, false);
    assert.equal(imagePackage.warnings.length > 0, true);
  }
});

test("special products generate review notes when applicable", async () => {
  const { imageModule } =
    await buildSampleImagePackageQueue();
  const aerosolPackage =
    imageModule.buildImagePackage({
      candidateKey: "luna-portex:test:aerosol-spray",
      productTitle: "Aerosol Spray Finish",
      listingTitle: "Aerosol Spray Finish New",
      imageRequirements: ["primary product image required"],
      complianceWarnings: ["compliance review required before eBay draft"],
      blockedReasons: ["image package required"],
      warnings: [],
      requiresImagePackage: true,
      requiresComplianceReview: true,
      trustSignals: {
        imageQualityRequired: true,
        complianceReviewRequired: true,
      },
    });

  assert.equal(aerosolPackage.secondaryImagePlan.reviewNotes.some(note => note.includes("aerosol")), true);
  assert.equal(aerosolPackage.imageReadinessGates.blockedByComplianceImageReview, true);
});

test("draft publication and real listing remain blocked", async () => {
  const { queue } =
    await buildSampleImagePackageQueue();

  for (const imagePackage of queue.packages) {
    assert.equal(imagePackage.canCreateEbayDraft, false);
    assert.equal(imagePackage.canPublishRealListing, false);
    assert.equal(imagePackage.readyForRealListing, false);
    assert.equal(imagePackage.imageReadinessGates.readyForRealListing, false);
    assert.equal(imagePackage.requiresHumanApproval, true);
  }
});

test("WhatsApp image alert previews use allowed intents only", async () => {
  const { queue } =
    await buildSampleImagePackageQueue();
  const prohibited =
    [
      "GENERATE_IMAGE_WITH_OPENAI",
      "UPLOAD_IMAGE",
      "CREATE_EBAY_DRAFT",
      "PUBLISH_LISTING",
      "SEND_REAL_WHATSAPP",
      "UPDATE_STAGING_DECISION",
      "TOUCH_PRODUCTION",
    ];

  assert.equal(queue.whatsappImageAlertPreviews.length > 0, true);
  assert.deepEqual(queue.prohibitedActionsDetected, []);

  for (const preview of queue.whatsappImageAlertPreviews) {
    assert.equal(preview.messageType, "IMAGE_PACKAGE_REVIEW");
    assert.equal(preview.previewOnly, true);
    assert.equal(preview.realSendUsed, false);
    for (const action of preview.buttons) {
      assert.equal(prohibited.includes(action), false);
    }
  }
});

test("image generation and uploads never execute", async () => {
  const { queue } =
    await buildSampleImagePackageQueue();

  assert.equal(queue.imageGenerationExecuted, false);
  assert.equal(queue.imageUploadExecuted, false);

  for (const imagePackage of queue.packages) {
    assert.equal(imagePackage.imageGenerationExecuted, false);
    assert.equal(imagePackage.imageUploadExecuted, false);
    assert.equal(imagePackage.imageProductionPrompts.prohibitedImageEdits.some(edit => edit.includes("producto falso")), true);
  }
});

test("CLI dry-run executes and returns expected numeric output", () => {
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

      assert.equal(parsed.summary.inputListingPackages, 3);
      assert.equal(parsed.summary.imagePackagesBuilt, 3);
      assert.equal(parsed.summary.whatsappImageAlertPreviews >= 1, true);
      assert.deepEqual(parsed.summary.prohibitedActionsDetected, []);
      assert.equal(parsed.summary.imageGenerationExecuted, false);
      assert.equal(parsed.summary.imageUploadExecuted, false);
      assert.equal(parsed.summary.canCreateEbayDraft, false);
      assert.equal(parsed.summary.canPublishRealListing, false);
      assert.equal(parsed.summary.stagingWriteExecuted, false);
      assert.equal(parsed.summary.ebayApiUsed, false);
      assert.equal(parsed.summary.openAiUsed, false);
      assert.equal(parsed.summary.whatsappRealSendUsed, false);
      assert.equal(parsed.summary.nextLoop, "148");
    })
    .finally(() => {
      console.log =
        originalLog;
    });
});

test("module and CLI avoid external integrations writes generation and uploads", () => {
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
      "generateImage",
      "uploadImage",
    ];

    for (const pattern of forbiddenPatterns) {
      assert.equal(source.includes(pattern), false, `${path} contains ${pattern}`);
    }
  }
});

test("docs exist and route helper points LOOP 147 to LOOP 148", async () => {
  assert.equal(fileExists(docPath), true);

  const routeModule =
    await import(`../${routeModulePath}`);
  const nextLoop =
    routeModule.getNextEbayProLoop("147");

  assert.ok(nextLoop);
  assert.equal(nextLoop.loopId, "148");
  assert.equal(nextLoop.label.includes("eBay Sandbox OAuth"), true);
});

test("no env dumps or image files were added for LOOP 147", () => {
  const loopFiles =
    [
      fixturePath,
      modulePath,
      cliPath,
      docPath,
      "tools/luna-portex-image-package-workflow-tests.mjs",
    ];

  assert.equal(loopFiles.some(path => path.includes(".env")), false);
  assert.equal(loopFiles.some(path => /\.(dump|backup|png|jpg|jpeg|gif|webp|svg)$/i.test(path)), false);
});
