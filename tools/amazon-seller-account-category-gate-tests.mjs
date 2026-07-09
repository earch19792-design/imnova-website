import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/amazon-seller-account-category-gate-v1.json";
const modulePath =
  "lib/marketplace/amazon-seller-account-category-gate.ts";
const cliPath =
  "tools/amazon-seller-account-category-gate-dry-run.mjs";
const docPath =
  "docs/marketplace-isolation/AMAZON_SELLER_ACCOUNT_SETUP_CATEGORY_GATE_V1.md";

const allowedDecisions =
  [
    "ACCOUNT_READY_FOR_RESEARCH_ONLY",
    "ACCOUNT_READY_FOR_MANUAL_LISTING_PREP",
    "ACCOUNT_BLOCKED_IDENTITY",
    "ACCOUNT_BLOCKED_TAX_BANK",
    "ACCOUNT_BLOCKED_MARKETPLACE_SETUP",
    "SAFE_TO_CONTINUE_RESEARCH",
    "NEED_SELLER_CENTRAL_CATEGORY_CHECK",
    "NEED_CATEGORY_APPROVAL",
    "NEED_BRAND_APPROVAL",
    "NEED_SUPPLIER_INVOICE",
    "NEED_GTIN_OR_EXEMPTION",
    "NEED_HAZMAT_REVIEW",
    "NEED_ELECTRICAL_COMPLIANCE_REVIEW",
    "NEED_CHEMICAL_COMPLIANCE_REVIEW",
    "DO_NOT_LIST_YET",
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
  const amazonModule =
    await import(`../${modulePath}`);

  return {
    fixture,
    amazonModule,
    queue:
      amazonModule.buildAmazonSellerAccountCategoryGateQueue(fixture.sellerAccounts, fixture.products),
  };
}

test("fixture locks LOOP 149B dry-run boundaries", () => {
  const fixture =
    readJson(fixturePath);

  assert.equal(fixture.sellerAccountGateVersion, "AMAZON_SELLER_ACCOUNT_SETUP_CATEGORY_GATE_V1");
  assert.equal(fixture.status, "AMAZON_SELLER_ACCOUNT_CATEGORY_GATE_READY");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_ACCOUNT_AND_CATEGORY_GATE_ONLY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.amazonApi.usedInThisLoop, false);
  assert.equal(fixture.spApi.usedInThisLoop, false);
  assert.equal(fixture.sellerCentral.writeExecutedInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.whatsapp.realSendUsedInThisLoop, false);
  assert.equal(fixture.openAi.usedInThisLoop, false);
  assert.equal(fixture.safetyFlags.noProductionWrites, true);
  assert.equal(fixture.safetyFlags.noStagingWritesInThisLoop, true);
  assert.equal(fixture.safetyFlags.noAmazonApi, true);
  assert.equal(fixture.safetyFlags.noSpApi, true);
  assert.equal(fixture.safetyFlags.noSellerCentralWrite, true);
  assert.equal(fixture.safetyFlags.noPublication, true);
  assert.equal(fixture.safetyFlags.noWhatsappRealSend, true);
  assert.equal(fixture.safetyFlags.noOpenAi, true);
  assert.equal(fixture.safetyFlags.noSecretsCommitted, true);
});

test("seller account readiness is generated with bounded scores and blockers", async () => {
  const { queue } =
    await buildQueue();
  const account =
    queue.reports[0].accountReadiness;

  assert.ok(account);
  assert.equal(account.accountReadinessScore >= 0, true);
  assert.equal(account.accountReadinessScore <= 100, true);
  assert.equal(account.documentReadinessScore >= 0, true);
  assert.equal(account.documentReadinessScore <= 100, true);
  assert.equal(account.missingAccountItems.length > 0, true);
  assert.equal(account.accountBlockers.length > 0, true);
  assert.equal(account.accountWarnings.length > 0, true);
});

test("builds three product category gates with bounded safety outputs", async () => {
  const { queue } =
    await buildQueue();

  assert.equal(queue.sellerAccountsAssessed, 1);
  assert.equal(queue.marketplaceTargetsAssessed, 1);
  assert.equal(queue.productCategoryGatesBuilt, 3);

  for (const gate of queue.reports[0].productCategoryGates) {
    assert.equal(allowedDecisions.includes(gate.decision), true);
    assert.equal(allowedDecisions.includes(gate.nextRecommendedAction), true);
    assert.equal(gate.canProceedToListingPrep, false);
    assert.equal(gate.categoryApprovedBySellerCentralOrHuman, false);
    assert.equal(gate.amazonApiUsed, false);
    assert.equal(gate.spApiUsed, false);
    assert.equal(gate.sellerCentralWriteExecuted, false);
    assert.equal(gate.publicationExecuted, false);
    assert.equal(gate.stagingWriteExecuted, false);
  }
});

test("cleaning chemical product requires compliance hazmat or human review", async () => {
  const { queue } =
    await buildQueue();
  const gate =
    queue.reports[0].productCategoryGates.find(entry => entry.productType === "cleaning_chemical");

  assert.ok(gate);
  assert.equal(gate.hazmatReviewRequired, true);
  assert.equal(gate.chemicalComplianceReviewRequired, true);
  assert.equal(gate.humanReviewRequired, true);
  assert.equal(["NEED_HAZMAT_REVIEW", "NEED_CHEMICAL_COMPLIANCE_REVIEW"].includes(gate.nextRecommendedAction), true);
});

test("electrical product requires safety compliance review", async () => {
  const { queue } =
    await buildQueue();
  const gate =
    queue.reports[0].productCategoryGates.find(entry => entry.productType === "electrical");

  assert.ok(gate);
  assert.equal(gate.electricalSafetyReviewRequired, true);
  assert.equal(gate.humanReviewRequired, true);
  assert.equal(gate.nextRecommendedAction, "NEED_ELECTRICAL_COMPLIANCE_REVIEW");
});

test("household simple product can continue research while still blocked from listing", async () => {
  const { queue } =
    await buildQueue();
  const gate =
    queue.reports[0].productCategoryGates.find(entry => entry.productType === "household_simple");

  assert.ok(gate);
  assert.equal(gate.categoryRiskLevel, "LOW");
  assert.equal(gate.canProceedToCatalogMatcher, true);
  assert.equal(gate.canProceedToListingPrep, false);
});

test("missing GTIN brand or invoice data produces warnings or gates", async () => {
  const { queue } =
    await buildQueue();
  const gates =
    queue.reports[0].productCategoryGates;

  assert.equal(gates.some(entry => entry.gtinOrExemptionRequired === true), true);
  assert.equal(gates.some(entry => entry.brandApprovalLikelyRequired === "unknown"), true);
  assert.equal(gates.some(entry => entry.invoiceLikelyRequired === true || entry.invoiceLikelyRequired === "unknown"), true);
  assert.equal(gates.some(entry => entry.warnings.length > 0), true);
});

test("no product is marked as real category approved without Seller Central or human review", async () => {
  const { queue } =
    await buildQueue();

  for (const gate of queue.reports[0].productCategoryGates) {
    assert.equal(gate.categoryApprovedBySellerCentralOrHuman, false);
    assert.equal(gate.cannotClaimRealCategoryApproval, true);
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

  assert.equal(summary.sellerAccountsAssessed, 1);
  assert.equal(summary.marketplaceTargetsAssessed, 1);
  assert.equal(summary.accountReadyForResearch >= 0, true);
  assert.equal(summary.accountReadyForManualListingPrep, 0);
  assert.equal(summary.accountBlockedByIdentity >= 0, true);
  assert.equal(summary.accountBlockedByTaxBank >= 0, true);
  assert.equal(summary.accountBlockedByMarketplaceSetup, 0);
  assert.equal(summary.averageAccountReadinessScore >= 0, true);
  assert.equal(summary.averageAccountReadinessScore <= 100, true);
  assert.equal(summary.productCategoryGatesBuilt, 3);
  assert.equal(summary.lowRiskCategoryCandidates >= 1, true);
  assert.equal(summary.categoryApprovalRequiredCandidates >= 1, true);
  assert.equal(summary.brandApprovalRequiredCandidates >= 0, true);
  assert.equal(summary.invoiceRequiredCandidates >= 1, true);
  assert.equal(summary.gtinOrExemptionRequiredCandidates >= 1, true);
  assert.equal(summary.hazmatReviewRequiredCandidates >= 1, true);
  assert.equal(summary.electricalReviewRequiredCandidates >= 1, true);
  assert.equal(summary.chemicalReviewRequiredCandidates >= 1, true);
  assert.equal(summary.productsAllowedToContinueResearch >= 1, true);
  assert.equal(summary.productsBlockedFromListing >= 1, true);
  assert.equal(summary.productsRequiringHumanReview >= 1, true);
  assert.equal(summary.amazonApiUsed, false);
  assert.equal(summary.spApiUsed, false);
  assert.equal(summary.sellerCentralWriteExecuted, false);
  assert.equal(summary.publicationExecuted, false);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.nextLoop, "149C");
});

test("checklist exists and next loop is 149C", async () => {
  const { amazonModule, queue } =
    await buildQueue();
  const checklist =
    amazonModule.getAmazonSellerAccountCategoryGateChecklist();

  assert.equal(Array.isArray(checklist), true);
  assert.equal(checklist.length >= 6, true);
  assert.equal(queue.nextLoop, "149C");
});

test("module CLI fixture and doc avoid integrations writes and sensitive artifacts", () => {
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
