import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildB2RunWriteApprovalRouteRecommendation,
  buildCategoryRuntimeCheckAssessment,
  buildEbayB2RunWriteApprovalRuntimeChecksInput,
  buildEbayB2RunWriteApprovalRuntimeChecksReport,
  buildFinalHumanWriteApprovalCard,
  buildFinalStockReviewAssessment,
  buildRuntimeCheckChecklist,
  validateFinalWriteApprovalPhrase,
} from "../lib/ebay/ebay-b2-run-write-approval-runtime-checks.ts";

const fixturePath = "tools/fixtures/ebay-b2-run-write-approval-runtime-checks-v1.json";
const modulePath = "lib/ebay/ebay-b2-run-write-approval-runtime-checks.ts";
const cliPath = "tools/ebay-b2-run-write-approval-runtime-checks-dry-run.mjs";
const docPath = "docs/ebay-pro-isolation/EBAY_B2_RUN_WRITE_APPROVAL_RUNTIME_CHECKS_V1.md";
const fixtureSource = readFileSync(fixturePath, "utf8");
const moduleSource = readFileSync(modulePath, "utf8");
const cliSource = readFileSync(cliPath, "utf8");
const docSource = readFileSync(docPath, "utf8");
const fixture = JSON.parse(fixtureSource);
const exact = "FINAL_WRITE_APPROVED_FOR_UNPUBLISHED_DRAFT_ONLY";

test("fixture defines eight pending runtime checks and safe approval scope", () => {
  assert.equal(fixture.version, "EBAY_B2_RUN_WRITE_APPROVAL_RUNTIME_CHECKS_V1");
  assert.equal(fixture.status, "READY");
  assert.equal(Object.keys(fixture.runtimeChecks).length, 8);
  assert.equal(fixture.approvalPolicy.canExecuteEbayWriteInThisLoop, false);
  assert.equal(fixture.approvalPolicy.canPublish, false);
  assert.equal(fixture.runtimeChecks.finalHumanWriteApproval.exactApprovalPhrase, exact);
});

test("default checklist has eight items and category blocks first", () => {
  const input = buildEbayB2RunWriteApprovalRuntimeChecksInput(fixture);
  const checklist = buildRuntimeCheckChecklist(input);
  assert.equal(checklist.runtimeChecksRequiredCount, 8);
  assert.equal(checklist.runtimeChecksPassedCount, 0);
  assert.equal(checklist.runtimeChecksAllPassed, false);
  assert.equal(buildCategoryRuntimeCheckAssessment(input).categoryRuntimeCheckStatus, "PENDING_RUNTIME_CONFIRMATION");
  assert.equal(buildB2RunWriteApprovalRouteRecommendation(input).nextRecommendedRoute, "NEED_CATEGORY_RUNTIME_CONFIRMATION");
});

test("modeled runtime checks pass seven items but final approval remains pending", () => {
  const report = buildEbayB2RunWriteApprovalRuntimeChecksReport(fixture, { runtimeChecksPassed: true });
  assert.equal(report.categoryRuntimeCheckStatus, "CONFIRMED");
  assert.equal(report.fulfillmentPolicyStatus, "CONFIRMED");
  assert.equal(report.returnPolicyStatus, "CONFIRMED");
  assert.equal(report.paymentPolicyStatus, "CONFIRMED");
  assert.equal(report.finalStockReviewStatus, "CONFIRMED");
  assert.equal(report.finalPriceReviewStatus, "CONFIRMED");
  assert.equal(report.finalImageReviewStatus, "CONFIRMED");
  assert.equal(report.finalHumanWriteApprovalStatus, "PENDING");
  assert.equal(report.runtimeChecksPassedCount, 7);
  assert.equal(report.runtimeChecksAllPassed, false);
  assert.equal(report.nextRecommendedRoute, "NEED_FINAL_WRITE_APPROVAL");
});

test("only exact phrase is accepted", () => {
  for (const phrase of [undefined, "APPROVE", "final_write_approved_for_unpublished_draft_only", `${exact} `]) {
    const input = buildEbayB2RunWriteApprovalRuntimeChecksInput(fixture, { runtimeChecksPassed: true, finalWriteApprovalPhrase: phrase });
    assert.equal(validateFinalWriteApprovalPhrase(input).finalWriteApprovalPhraseAccepted, false, String(phrase));
  }
  const input = buildEbayB2RunWriteApprovalRuntimeChecksInput(fixture, { runtimeChecksPassed: true, finalWriteApprovalPhrase: exact });
  assert.equal(validateFinalWriteApprovalPhrase(input).finalWriteApprovalPhraseAccepted, true);
  assert.equal(buildFinalHumanWriteApprovalCard(input).publishAllowedByThisApproval, false);
});

test("all checks plus exact phrase prepare next loop without executing write", () => {
  const report = buildEbayB2RunWriteApprovalRuntimeChecksReport(fixture, { runtimeChecksPassed: true, finalWriteApprovalPhrase: exact });
  assert.equal(report.runtimeChecksPassedCount, 8);
  assert.equal(report.runtimeChecksAllPassed, true);
  assert.equal(report.finalWriteApprovalPhraseAccepted, true);
  assert.equal(report.controlledWriteReadyForNextLoop, true);
  assert.equal(report.requiresControlledWriteRunNext, true);
  assert.equal(report.canExecuteEbayWriteInThisLoop, false);
  assert.equal(report.canCreateDraftInThisLoop, false);
  assert.equal(report.canPublish, false);
  assert.equal(report.nextRecommendedRoute, "READY_FOR_CONTROLLED_B2_WRITE_DRAFT_ONLY");
});

test("zero, negative, or invalid final stock blocks readiness", () => {
  for (const stock of [0, -1, Number.NaN]) {
    const input = buildEbayB2RunWriteApprovalRuntimeChecksInput(fixture, { simulatedStock: stock });
    const assessment = buildFinalStockReviewAssessment(input);
    assert.equal(assessment.finalStockReviewStatus, "BLOCKED");
    assert.equal(assessment.passed, false);
  }
  const report = buildEbayB2RunWriteApprovalRuntimeChecksReport(fixture, { runtimeChecksPassed: true, finalWriteApprovalPhrase: exact, simulatedStock: 0 });
  assert.equal(report.controlledWriteReadyForNextLoop, false);
  assert.equal(report.nextRecommendedRoute, "NEED_FINAL_STOCK_REVIEW");
  const stockOnly = buildEbayB2RunWriteApprovalRuntimeChecksReport(fixture, { simulatedStock: 0 });
  assert.equal(stockOnly.nextRecommendedRoute, "NEED_FINAL_STOCK_REVIEW");
});

test("each pending runtime family blocks its corresponding route", () => {
  const policyFixture = structuredClone(fixture);
  const input = buildEbayB2RunWriteApprovalRuntimeChecksInput(policyFixture, { runtimeChecksPassed: false });
  assert.equal(buildB2RunWriteApprovalRouteRecommendation(input).nextRecommendedRoute, "NEED_CATEGORY_RUNTIME_CONFIRMATION");
  const runtimePassed = { runtimeChecksPassed: true };
  const noApproval = buildEbayB2RunWriteApprovalRuntimeChecksReport(fixture, runtimePassed);
  assert.equal(noApproval.nextRecommendedRoute, "NEED_FINAL_WRITE_APPROVAL");
  assert.equal(noApproval.controlledWriteReadyForNextLoop, false);
});

async function runCli(args = []) {
  const messages = [];
  const originalArgv = process.argv;
  const originalLog = console.log;
  process.argv = [originalArgv[0], cliPath, ...args];
  console.log = (message) => messages.push(String(message));
  try { await import(`./ebay-b2-run-write-approval-runtime-checks-dry-run.mjs?test=${Date.now()}-${Math.random()}`); }
  finally { process.argv = originalArgv; console.log = originalLog; }
  return JSON.parse(messages.join("\n"));
}

test("CLI supports all required dry-run modes", async () => {
  const initial = await runCli();
  const checks = await runCli(["--simulate-runtime-checks-passed"]);
  const approved = await runCli(["--simulate-runtime-checks-passed", "--simulate-final-write-approval", exact]);
  const wrong = await runCli(["--simulate-runtime-checks-passed", "--simulate-final-write-approval", "APPROVE"]);
  const noStock = await runCli(["--simulate-stock", "0"]);
  assert.equal(initial.nextRecommendedRoute, "NEED_CATEGORY_RUNTIME_CONFIRMATION");
  assert.equal(checks.nextRecommendedRoute, "NEED_FINAL_WRITE_APPROVAL");
  assert.equal(approved.nextRecommendedRoute, "READY_FOR_CONTROLLED_B2_WRITE_DRAFT_ONLY");
  assert.equal(wrong.finalWriteApprovalPhraseAccepted, false);
  assert.equal(noStock.finalStockReviewStatus, "BLOCKED");
  assert.equal(noStock.nextRecommendedRoute, "NEED_FINAL_STOCK_REVIEW");
});

test("module and CLI contain no environment, API, database, or filesystem writes", () => {
  for (const marker of ["process" + ".env", "fetch" + "(", "create" + "Client", ".fr" + "om(", ".ins" + "ert(", ".upd" + "ate(", ".ups" + "ert(", "write" + "File", "append" + "File"]) {
    assert.equal(moduleSource.includes(marker), false, marker);
    assert.equal(cliSource.includes(marker), false, marker);
  }
});

test("files contain no credentials, full address, images, or paused tracks", () => {
  const combined = `${fixtureSource}\n${moduleSource}\n${cliSource}\n${docSource}`;
  for (const marker of ["access" + "_token", "refresh" + "_token", "client" + "_secret", "authorization" + " code"]) assert.equal(combined.toLowerCase().includes(marker), false);
  assert.doesNotMatch(combined, /streetAddress\s*[:=]|addressLine|fullAddress/i);
  assert.doesNotMatch(combined, /\.(png|jpe?g|webp)\b/i);
  for (const marker of ["AMAZON_LISTING_" + "PACKAGE_BUILDER", "ebay-sandbox-" + "draft-listing", "EBAY_SANDBOX_" + "DRAFT_LISTING"]) assert.equal(combined.includes(marker), false);
});

test("every mode preserves hard safety boundaries", () => {
  const modes = [{}, { runtimeChecksPassed: true }, { runtimeChecksPassed: true, finalWriteApprovalPhrase: exact }, { runtimeChecksPassed: true, finalWriteApprovalPhrase: "APPROVE" }, { simulatedStock: 0 }];
  for (const simulation of modes) {
    const report = buildEbayB2RunWriteApprovalRuntimeChecksReport(fixture, simulation);
    for (const key of ["canExecuteEbayWriteInThisLoop", "canCreateDraftInThisLoop", "canPublish", "productionWriteTouched", "mainTouched", "stagingWriteExecuted", "supabaseWriteExecuted", "ebayApiUsedInThisLoop", "ebayWriteApiUsed", "oauthUsedInThisLoop", "tokenStored", "tokensPrinted", "draftCreated", "listingCreated", "offerCreated", "publicationExecuted", "imageGenerationUsed", "imageDownloadUsed", "imageCopyAllowed", "scraperUsed", "amazonTrackTouched", "whatsappRealSendUsed", "smsRealSendUsed", "openAiUsed", "fullWarehouseStreetAddressCommitted"]) assert.equal(report[key], false, key);
  }
});
