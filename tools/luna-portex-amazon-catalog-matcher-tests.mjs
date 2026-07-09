import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/luna-portex-amazon-catalog-matcher-v1.json";
const modulePath =
  "lib/marketplace/luna-portex-amazon-catalog-matcher.ts";
const cliPath =
  "tools/luna-portex-amazon-catalog-matcher-dry-run.mjs";
const docPath =
  "docs/marketplace-isolation/LUNA_PORTEX_AMAZON_CATALOG_MATCHER_V1.md";

const allowedDecisions =
  [
    "SELL_ON_EXISTING_ASIN",
    "HUMAN_REVIEW_EXISTING_ASIN",
    "CREATE_NEW_ASIN_CANDIDATE",
    "NEED_GTIN_OR_EXEMPTION",
    "NEED_MORE_PRODUCT_DATA",
    "REJECT_FOR_NOW",
    "WATCHLIST",
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
  const matcherModule =
    await import(`../${modulePath}`);

  return {
    fixture,
    matcherModule,
    queue:
      matcherModule.buildLunaPortexAmazonCatalogMatchQueue(fixture),
  };
}

test("fixture locks LOOP 149C dry-run boundaries", () => {
  const fixture =
    readJson(fixturePath);

  assert.equal(fixture.catalogMatcherVersion, "LUNA_PORTEX_AMAZON_CATALOG_MATCHER_V1");
  assert.equal(fixture.status, "LUNA_PORTEX_AMAZON_CATALOG_MATCHER_READY");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_CATALOG_MATCHER_ONLY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.amazonApi.usedInThisLoop, false);
  assert.equal(fixture.spApi.usedInThisLoop, false);
  assert.equal(fixture.sellerCentral.writeExecutedInThisLoop, false);
  assert.equal(fixture.scraper.usedInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.whatsapp.realSendUsedInThisLoop, false);
  assert.equal(fixture.openAi.usedInThisLoop, false);
  assert.equal(fixture.safetyFlags.noAmazonApi, true);
  assert.equal(fixture.safetyFlags.noSpApi, true);
  assert.equal(fixture.safetyFlags.noScraper, true);
  assert.equal(fixture.safetyFlags.noSecretsCommitted, true);
});

test("builds three bounded catalog matches", async () => {
  const { queue } =
    await buildQueue();

  assert.equal(queue.inputSupplierProducts, 3);
  assert.equal(queue.catalogMatchesBuilt, 3);
  assert.equal(queue.amazonApiUsed, false);
  assert.equal(queue.spApiUsed, false);
  assert.equal(queue.sellerCentralWriteExecuted, false);
  assert.equal(queue.publicationExecuted, false);
  assert.equal(queue.scraperUsed, false);

  for (const match of queue.catalogMatches) {
    assert.equal(match.matchConfidenceScore >= 0, true);
    assert.equal(match.matchConfidenceScore <= 100, true);
    assert.equal(match.canProceedToListingPrep, false);
    assert.equal(allowedDecisions.includes(match.asinStrategyRecommendation), true);
  }
});

test("DM0628N part number and model number create strong brand model size match", async () => {
  const { queue } =
    await buildQueue();
  const match =
    queue.catalogMatches.find(entry => entry.supplierSku === "luna-portex:first_real_mini_scan:dm0628n");

  assert.ok(match);
  assert.equal(match.partNumber, "DM0628N");
  assert.equal(match.modelNumber, "DM0628N");
  assert.equal(match.manufacturerPartNumber, "DM0628N");
  assert.equal(["STRONG_BRAND_MODEL_PART_MATCH", "STRONG_BRAND_MODEL_SIZE_MATCH"].includes(match.matchType), true);
  assert.equal(match.matchConfidenceScore >= 75, true);
  assert.equal(match.asinStrategyRecommendation, "SELL_ON_EXISTING_ASIN");
  assert.equal(match.warnings.includes("missing UPC/GTIN"), true);
});

test("brand model part and size are stronger than title-only", async () => {
  const { matcherModule, fixture } =
    await buildQueue();
  const product =
    fixture.supplierProducts.find(entry => entry.supplierSku.includes("dm0628n"));
  const strongCandidate =
    fixture.amazonCatalogCandidates.find(entry => entry.amazonCandidateAsin === "B0SANITIZED1");
  const titleOnlyCandidate =
    {
      ...strongCandidate,
      amazonCandidateAsin: "B0TITLEONLY",
      brand: "Other Brand",
      modelNumber: "OTHER",
      partNumber: "OTHER",
      manufacturerPartNumber: "OTHER",
      category: "Other Category",
    };
  const strong =
    matcherModule.buildLunaPortexAmazonCatalogMatch(product, [strongCandidate]);
  const titleOnly =
    matcherModule.buildLunaPortexAmazonCatalogMatch(product, [titleOnlyCandidate]);

  assert.equal(strong.matchConfidenceScore > titleOnly.matchConfidenceScore, true);
  assert.notEqual(titleOnly.asinStrategyRecommendation, "SELL_ON_EXISTING_ASIN");
});

test("title-only cannot recommend automatic existing ASIN", async () => {
  const { matcherModule, fixture } =
    await buildQueue();
  const product =
    fixture.supplierProducts.find(entry => entry.supplierSku.includes("rustoleum"));
  const candidate =
    fixture.amazonCatalogCandidates.find(entry => entry.amazonCandidateAsin === "B0SANITIZED4");
  const match =
    matcherModule.buildLunaPortexAmazonCatalogMatch(product, [candidate]);

  assert.equal(["POSSIBLE_TITLE_SIZE_MATCH", "WEAK_TITLE_ONLY_MATCH", "NO_MATCH"].includes(match.matchType), true);
  assert.notEqual(match.asinStrategyRecommendation, "SELL_ON_EXISTING_ASIN");
});

test("size mismatch lowers confidence and category mismatch raises wrong ASIN risk", async () => {
  const { matcherModule, fixture } =
    await buildQueue();
  const product =
    fixture.supplierProducts.find(entry => entry.supplierSku.includes("dm0628n"));
  const strongCandidate =
    fixture.amazonCatalogCandidates.find(entry => entry.amazonCandidateAsin === "B0SANITIZED1");
  const mismatchCandidate =
    {
      ...strongCandidate,
      amazonCandidateAsin: "B0MISMATCH",
      size: "14 oz",
      category: "Dishwasher Replacement Parts",
    };
  const strong =
    matcherModule.buildLunaPortexAmazonCatalogMatch(product, [strongCandidate]);
  const mismatch =
    matcherModule.buildLunaPortexAmazonCatalogMatch(product, [mismatchCandidate]);

  assert.equal(mismatch.matchConfidenceScore < strong.matchConfidenceScore, true);
  assert.equal(["MEDIUM", "HIGH"].includes(mismatch.wrongAsinRisk), true);
  assert.equal(mismatch.warnings.some(entry => entry.includes("mismatch")), true);
});

test("conflicting candidates require human review", async () => {
  const { queue } =
    await buildQueue();
  const match =
    queue.catalogMatches.find(entry => entry.supplierSku === "luna-portex:first_real_mini_scan:gg-16000tsm");

  assert.ok(match);
  assert.equal(match.matchType, "CONFLICTING_MATCH");
  assert.equal(match.humanReviewRequired, true);
  assert.equal(match.asinStrategyRecommendation, "HUMAN_REVIEW_EXISTING_ASIN");
});

test("no match recommends GTIN exemption new ASIN candidate or more data according to identifiers", async () => {
  const { queue } =
    await buildQueue();
  const match =
    queue.catalogMatches.find(entry => entry.supplierSku.includes("rustoleum"));

  assert.ok(match);
  assert.equal(match.matchType, "NO_MATCH");
  assert.equal(["NEED_GTIN_OR_EXEMPTION", "CREATE_NEW_ASIN_CANDIDATE", "NEED_MORE_PRODUCT_DATA"].includes(match.asinStrategyRecommendation), true);
});

test("no product is approved for real listing", async () => {
  const { queue } =
    await buildQueue();

  for (const match of queue.catalogMatches) {
    assert.equal(match.canProceedToListingPrep, false);
    assert.equal(match.publicationExecuted, false);
  }
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

  assert.equal(summary.inputSupplierProducts, 3);
  assert.equal(summary.amazonCatalogCandidates >= 3, true);
  assert.equal(summary.catalogMatchesBuilt, 3);
  assert.equal(summary.strongBrandModelPartMatches >= 1, true);
  assert.equal(summary.conflictingMatches >= 1, true);
  assert.equal(summary.noMatches >= 1, true);
  assert.equal(summary.productsBlockedFromListingPrep, 3);
  assert.equal(summary.averageMatchConfidenceScore >= 0, true);
  assert.equal(summary.averageMatchConfidenceScore <= 100, true);
  assert.equal(summary.amazonApiUsed, false);
  assert.equal(summary.spApiUsed, false);
  assert.equal(summary.sellerCentralWriteExecuted, false);
  assert.equal(summary.publicationExecuted, false);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.scraperUsed, false);
  assert.equal(summary.nextLoop, "149D");
});

test("checklist exists and next loop is 149D", async () => {
  const { matcherModule, queue } =
    await buildQueue();
  const checklist =
    matcherModule.getLunaPortexAmazonCatalogMatcherChecklist();

  assert.equal(Array.isArray(checklist), true);
  assert.equal(checklist.length >= 5, true);
  assert.equal(queue.nextLoop, "149D");
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
