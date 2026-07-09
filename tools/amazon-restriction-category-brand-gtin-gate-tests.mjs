import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/amazon-restriction-category-brand-gtin-gate-v1.json";
const modulePath =
  "lib/marketplace/amazon-restriction-category-brand-gtin-gate.ts";
const cliPath =
  "tools/amazon-restriction-category-brand-gtin-gate-dry-run.mjs";
const docPath =
  "docs/marketplace-isolation/AMAZON_RESTRICTION_CATEGORY_BRAND_GTIN_GATE_V1.md";

const allowedDecisions =
  [
    "SAFE_TO_CONTINUE_TO_FEES_ROI",
    "CONTINUE_RESEARCH_ONLY",
    "NEED_SELLER_CENTRAL_MANUAL_CHECK",
    "NEED_CATEGORY_APPROVAL",
    "NEED_BRAND_APPROVAL",
    "NEED_SUPPLIER_INVOICE",
    "NEED_GTIN_OR_EXEMPTION",
    "NEED_HAZMAT_REVIEW",
    "NEED_CHEMICAL_COMPLIANCE_REVIEW",
    "NEED_ELECTRICAL_COMPLIANCE_REVIEW",
    "WATCHLIST",
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
  const gateModule =
    await import(`../${modulePath}`);

  return {
    fixture,
    gateModule,
    queue:
      gateModule.buildAmazonRestrictionGateQueue(fixture),
  };
}

test("fixture locks LOOP 149D dry-run boundaries", () => {
  const fixture =
    readJson(fixturePath);

  assert.equal(fixture.restrictionGateVersion, "AMAZON_RESTRICTION_CATEGORY_BRAND_GTIN_GATE_V1");
  assert.equal(fixture.status, "AMAZON_RESTRICTION_CATEGORY_BRAND_GTIN_GATE_READY");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_RESTRICTION_GATE_ONLY");
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

test("builds three bounded restriction gate assessments", async () => {
  const { queue } =
    await buildQueue();

  assert.equal(queue.inputCatalogMatches, 3);
  assert.equal(queue.restrictionGateAssessmentsBuilt, 3);

  for (const assessment of queue.assessments) {
    assert.equal(assessment.overallRestrictionRiskScore >= 0, true);
    assert.equal(assessment.overallRestrictionRiskScore <= 100, true);
    assert.equal(allowedDecisions.includes(assessment.nextRecommendedAction), true);
    assert.equal(assessment.canProceedToListingPackage, false);
    assert.equal(assessment.canProceedToSellerCentral, false);
    assert.equal(assessment.publicationExecuted, false);
    assert.equal(assessment.amazonApiUsed, false);
    assert.equal(assessment.spApiUsed, false);
    assert.equal(assessment.sellerCentralWriteExecuted, false);
    assert.equal(assessment.scraperUsed, false);
  }
});

test("DM0628N strong match is not auto-approved for listing and triggers chemical or hazmat review", async () => {
  const { queue } =
    await buildQueue();
  const dm =
    queue.assessments.find(entry => entry.supplierSku === "luna-portex:first_real_mini_scan:dm0628n");

  assert.ok(dm);
  assert.equal(dm.catalogMatchType, "STRONG_BRAND_MODEL_SIZE_MATCH");
  assert.equal(dm.matchConfidenceScore, 97);
  assert.equal(dm.canProceedToListingPackage, false);
  assert.equal(dm.chemicalComplianceReviewRequired === true || dm.hazmatReviewRequired === true, true);
  assert.equal(dm.warnings.includes("missing UPC/GTIN"), true);
});

test("electrical product requires safety review and human review", async () => {
  const { queue } =
    await buildQueue();
  const electrical =
    queue.assessments.find(entry => entry.supplierSku === "luna-portex:first_real_mini_scan:gg-16000tsm");

  assert.ok(electrical);
  assert.equal(electrical.electricalSafetyReviewRequired, true);
  assert.equal(electrical.humanReviewRequired, true);
  assert.equal(electrical.canProceedToListingPackage, false);
});

test("aerosol paint is high hazmat risk and blocked from listing package", async () => {
  const { queue } =
    await buildQueue();
  const aerosol =
    queue.assessments.find(entry => entry.supplierSku.includes("rustoleum"));

  assert.ok(aerosol);
  assert.equal(aerosol.hazmatRisk, "HIGH");
  assert.equal(aerosol.canProceedToListingPackage, false);
  assert.equal(["REJECT_FOR_NOW", "NEED_HAZMAT_REVIEW"].includes(aerosol.nextRecommendedAction), true);
});

test("conflicting match and high wrong ASIN risk block listing package", async () => {
  const { queue } =
    await buildQueue();
  const conflict =
    queue.assessments.find(entry => entry.catalogMatchType === "CONFLICTING_MATCH");

  assert.ok(conflict);
  assert.equal(conflict.humanReviewRequired, true);
  assert.equal(conflict.canProceedToListingPackage, false);
  assert.equal(conflict.blockedReasons.includes("conflicting catalog match requires human review"), true);
  assert.equal(conflict.blockedReasons.includes("wrong ASIN risk high from catalog matcher"), true);
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

  assert.equal(summary.inputCatalogMatches, 3);
  assert.equal(summary.restrictionGateAssessmentsBuilt, 3);
  assert.equal(summary.productsBlockedFromListingPackage >= 1, true);
  assert.equal(summary.productsRequiringHumanReview >= 1, true);
  assert.equal(summary.averageOverallRestrictionRiskScore >= 0, true);
  assert.equal(summary.averageOverallRestrictionRiskScore <= 100, true);
  assert.equal(summary.amazonApiUsed, false);
  assert.equal(summary.spApiUsed, false);
  assert.equal(summary.sellerCentralWriteExecuted, false);
  assert.equal(summary.publicationExecuted, false);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.scraperUsed, false);
  assert.equal(summary.nextLoop, "149E");
});

test("checklist exists and next loop is 149E", async () => {
  const { gateModule, queue } =
    await buildQueue();
  const checklist =
    gateModule.getAmazonRestrictionCategoryBrandGtinGateChecklist();

  assert.equal(Array.isArray(checklist), true);
  assert.equal(checklist.length >= 5, true);
  assert.equal(queue.nextLoop, "149E");
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
