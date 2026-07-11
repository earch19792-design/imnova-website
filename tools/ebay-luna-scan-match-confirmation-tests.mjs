import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applyHumanWhatsappMatchConfirmation,
  buildBestLunaScanMatchAssessment,
  buildEbayListingFieldCompletionFromMarketData,
  buildEbayLunaScanMatchConfirmationInput,
  buildEbayLunaScanMatchConfirmationReport,
  buildHumanWhatsappConfirmationCard,
  buildLunaScanMatchQueryFromEbayWinner,
  buildLunaScanMatchRouteRecommendation,
  buildSupplierUnknownFieldGuard,
  scoreLunaScanCandidateAgainstEbayWinner,
} from "../lib/ebay/ebay-luna-scan-match-confirmation.ts";

const fixturePath = "tools/fixtures/ebay-luna-scan-match-confirmation-v1.json";
const modulePath = "lib/ebay/ebay-luna-scan-match-confirmation.ts";
const cliPath = "tools/ebay-luna-scan-match-confirmation-dry-run.mjs";
const docPath = "docs/ebay-pro-isolation/EBAY_LUNA_SCAN_MATCH_CONFIRMATION_B2A_V1.md";
const fixtureSource = readFileSync(fixturePath, "utf8");
const moduleSource = readFileSync(modulePath, "utf8");
const cliSource = readFileSync(cliPath, "utf8");
const docSource = readFileSync(docPath, "utf8");
const fixture = JSON.parse(fixtureSource);

test("fixture applies strategic correction without catalog or warehouse blocker", () => {
  assert.equal(fixture.version, "EBAY_LUNA_SCAN_MATCH_CONFIRMATION_B2A_V1");
  assert.equal(fixture.status, "READY");
  assert.equal(fixture.previousIncorrectBlocker, "NEED_REAL_LUNA_CATALOG_FILE");
  assert.equal(fixture.correctedBlocker, "NEED_LUNA_SCAN_MATCH_CONFIRMATION");
  assert.equal(fixture.requiresRealLunaCatalogFile, false);
  assert.equal(fixture.requiresWarehouseConsultation, false);
  assert.equal(fixture.requiresManualProductSearch, false);
  assert.equal(fixture.usesLunaScanCandidates, true);
  assert.equal(fixture.usesEbayWinnerMarketData, true);
  assert.equal(fixture.realWhatsappSendUsed, false);
  assert.equal(fixture.canPublish, false);
});

test("match query is built from eBay winner market observations", () => {
  const query = buildLunaScanMatchQueryFromEbayWinner(buildEbayLunaScanMatchConfirmationInput(fixture));
  assert.equal(query.queryBuilt, true);
  assert.equal(query.source, "EBAY_MARKET_OBSERVED");
  assert.equal(query.targetColor, "Black");
  assert.equal(query.targetMaterial, "Silicone");
  assert.equal(query.targetPackQuantity, 20);
});

test("strong, partial, unrelated, and risky scan candidates are distinguished", () => {
  const input = buildEbayLunaScanMatchConfirmationInput(fixture);
  const query = buildLunaScanMatchQueryFromEbayWinner(input);
  const scores = fixture.lunaScanCandidates.map((candidate) => scoreLunaScanCandidateAgainstEbayWinner(query, candidate));
  assert.equal(scores[0].matchLevel, "STRONG");
  assert.ok(scores[0].matchScore >= 70);
  assert.equal(scores[1].matchLevel, "PARTIAL");
  assert.equal(scores[2].matchLevel, "LOW");
  assert.equal(scores[3].highRisk, true);
  assert.ok(scores[3].riskSignals.includes("HAZMAT"));
});

test("best assessment selects strong safe Luna scan candidate", () => {
  const assessment = buildBestLunaScanMatchAssessment(buildEbayLunaScanMatchConfirmationInput(fixture));
  assert.equal(assessment.candidatesEvaluated, 4);
  assert.equal(assessment.bestLunaScanMatch.candidateId, "LUNA-SCAN-CABLE-STRONG");
  assert.equal(assessment.strongMatchFound, true);
});

test("human confirmation card is logical only and sends no WhatsApp", () => {
  const input = buildEbayLunaScanMatchConfirmationInput(fixture);
  const card = buildHumanWhatsappConfirmationCard(input);
  assert.equal(card.confirmationCardBuilt, true);
  assert.equal(card.realWhatsappSendUsed, false);
  assert.equal(card.ebayWinner.source, "EBAY_MARKET_OBSERVED");
  assert.equal(card.lunaCandidate.source, "LUNA_SCAN_OBSERVED");
  assert.equal(card.responseSourceWhenConfirmed, "HUMAN_WHATSAPP_CONFIRMED");
});

test("pending confirmation blocks B2-RUN", () => {
  const report = buildEbayLunaScanMatchConfirmationReport(fixture);
  assert.equal(report.humanWhatsappConfirmationStatus, "PENDING");
  assert.equal(report.canProceedToB2Run, false);
  assert.equal(report.canPublish, false);
  assert.equal(report.nextRecommendedRoute, "NEED_LUNA_SCAN_MATCH_CONFIRMATION");
});

test("exact positive human confirmation enables controlled B2-RUN only", () => {
  const report = buildEbayLunaScanMatchConfirmationReport(fixture, "HUMAN_CONFIRMED_SAME_PRODUCT");
  assert.equal(report.humanWhatsappConfirmationStatus, "CONFIRMED_SAME_PRODUCT");
  assert.equal(report.fieldSourceMap.humanProductMatch, "HUMAN_WHATSAPP_CONFIRMED");
  assert.equal(report.canProceedToB2Run, true);
  assert.equal(report.canPublish, false);
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-B2-RUN");
});

test("exact negative confirmation routes to scan rematch", () => {
  const report = buildEbayLunaScanMatchConfirmationReport(fixture, "HUMAN_REJECTED_NOT_SAME_PRODUCT");
  assert.equal(report.humanWhatsappConfirmationStatus, "REJECTED_NOT_SAME_PRODUCT");
  assert.equal(report.canProceedToB2Run, false);
  assert.equal(report.nextRecommendedRoute, "NEED_LUNA_SCAN_REMATCH");
});

test("high-risk selected candidate routes to hold", () => {
  const riskyFixture = { ...fixture, lunaScanCandidates: [fixture.lunaScanCandidates[3]] };
  const input = buildEbayLunaScanMatchConfirmationInput(riskyFixture, "HUMAN_CONFIRMED_SAME_PRODUCT");
  const assessment = buildBestLunaScanMatchAssessment(input);
  const confirmation = applyHumanWhatsappMatchConfirmation(input);
  assert.equal(buildLunaScanMatchRouteRecommendation({ assessment, confirmation }).nextRecommendedRoute, "EBAY-RESUME-HOLD");
});

test("low match routes to rematch even with positive simulation", () => {
  const lowFixture = { ...fixture, lunaScanCandidates: [fixture.lunaScanCandidates[2]] };
  const report = buildEbayLunaScanMatchConfirmationReport(lowFixture, "HUMAN_CONFIRMED_SAME_PRODUCT");
  assert.equal(report.nextRecommendedRoute, "NEED_LUNA_SCAN_REMATCH");
  assert.equal(report.canProceedToB2Run, false);
});

test("eBay completes listing fields with explicit observed sources", () => {
  const fields = buildEbayListingFieldCompletionFromMarketData(buildEbayLunaScanMatchConfirmationInput(fixture));
  for (const name of ["title", "category", "itemSpecifics", "description", "priceRecommendation", "packWording"]) {
    assert.equal(fields.fields[name].source, "EBAY_MARKET_OBSERVED", name);
  }
  assert.equal(fields.fields.weightIfMissing.source, "EBAY_MARKET_OBSERVED_WITH_LOW_CONFIDENCE");
  assert.equal(fields.fields.dimensionsIfMissing.value, "UNKNOWN");
});

test("supplier cost and stock remain unknown when scan does not provide them", () => {
  const guard = buildSupplierUnknownFieldGuard(buildBestLunaScanMatchAssessment(buildEbayLunaScanMatchConfirmationInput(fixture)));
  assert.ok(guard.supplierFieldsUnknown.includes("supplierCost"));
  assert.ok(guard.supplierFieldsUnknown.includes("supplierStock"));
  assert.equal(guard.unknownFieldValue, "UNKNOWN_FROM_SUPPLIER");
  assert.equal(guard.confidenceGuard, "LOW_CONFIDENCE_GUARD");
  assert.equal(guard.supplierCostConfirmed, false);
  assert.equal(guard.supplierStockConfirmed, false);
  assert.equal(guard.supplierFieldsObservedFromLunaScan.supplierSku.source, "LUNA_SCAN_OBSERVED");
});

async function runCli(simulation) {
  const messages = [];
  const originalArgv = process.argv;
  const originalLog = console.log;
  process.argv = [originalArgv[0], cliPath, ...(simulation ? ["--simulate-human-confirmation", simulation] : [])];
  console.log = (message) => messages.push(String(message));
  try { await import(`./ebay-luna-scan-match-confirmation-dry-run.mjs?test=${Date.now()}-${Math.random()}`); }
  finally { process.argv = originalArgv; console.log = originalLog; }
  return JSON.parse(messages.join("\n"));
}

test("CLI supports pending, positive, and negative logical simulations", async () => {
  const pending = await runCli();
  const positive = await runCli("HUMAN_CONFIRMED_SAME_PRODUCT");
  const negative = await runCli("HUMAN_REJECTED_NOT_SAME_PRODUCT");
  assert.equal(pending.nextRecommendedRoute, "NEED_LUNA_SCAN_MATCH_CONFIRMATION");
  assert.equal(positive.nextRecommendedRoute, "EBAY-RESUME-B2-RUN");
  assert.equal(positive.canPublish, false);
  assert.equal(negative.nextRecommendedRoute, "NEED_LUNA_SCAN_REMATCH");
});

test("module and CLI contain no environment, API, database, or filesystem writes", () => {
  for (const marker of ["process" + ".env", "fetch" + "(", "create" + "Client", ".fr" + "om(", ".ins" + "ert(", ".upd" + "ate(", ".ups" + "ert(", "write" + "File", "append" + "File"] ) {
    assert.equal(moduleSource.includes(marker), false, marker);
    assert.equal(cliSource.includes(marker), false, marker);
  }
});

test("files contain no credentials, full address, or paused tracks", () => {
  const combined = `${fixtureSource}\n${moduleSource}\n${cliSource}\n${docSource}`;
  for (const marker of ["access" + "_token", "refresh" + "_token", "client" + "_secret", "authorization" + " code"]) assert.equal(combined.toLowerCase().includes(marker), false);
  assert.doesNotMatch(combined, /streetAddress\s*[:=]|addressLine|fullAddress/i);
  for (const marker of ["AMAZON_LISTING_" + "PACKAGE_BUILDER", "ebay-sandbox-" + "draft-listing", "EBAY_SANDBOX_" + "DRAFT_LISTING"]) assert.equal(combined.includes(marker), false);
});

test("all reports preserve hard safety boundaries", () => {
  for (const simulation of [undefined, "HUMAN_CONFIRMED_SAME_PRODUCT", "HUMAN_REJECTED_NOT_SAME_PRODUCT"]) {
    const report = buildEbayLunaScanMatchConfirmationReport(fixture, simulation);
    assert.equal(report.canPublish, false);
    assert.equal(report.whatsappRealSendUsed, false);
    assert.equal(report.ebayApiUsed, false);
    assert.equal(report.oauthUsed, false);
    assert.equal(report.draftCreated, false);
    assert.equal(report.listingCreated, false);
    assert.equal(report.offerCreated, false);
    assert.equal(report.publicationExecuted, false);
    assert.equal(report.scraperUsed, false);
  }
});
