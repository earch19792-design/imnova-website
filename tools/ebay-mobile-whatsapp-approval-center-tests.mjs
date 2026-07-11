import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applyMobileApprovalCommand,
  buildCandidateMobileDetailCard,
  buildMobileApprovalState,
  buildMobileWhatsappApprovalCenterInput,
  buildMobileWhatsappApprovalCenterReport,
  buildTop5MobileSummaryCard,
  parseMobileApprovalCommand,
} from "../lib/ebay/ebay-mobile-whatsapp-approval-center.ts";

const fixturePath = "tools/fixtures/ebay-mobile-whatsapp-approval-center-v1.json";
const modulePath = "lib/ebay/ebay-mobile-whatsapp-approval-center.ts";
const cliPath = "tools/ebay-mobile-whatsapp-approval-center-dry-run.mjs";
const docPath = "docs/ebay-pro-isolation/EBAY_MOBILE_WHATSAPP_APPROVAL_CENTER_B2A_V1.md";
const fixtureSource = readFileSync(fixturePath, "utf8");
const moduleSource = readFileSync(modulePath, "utf8");
const cliSource = readFileSync(cliPath, "utf8");
const docSource = readFileSync(docPath, "utf8");
const fixture = JSON.parse(fixtureSource);
const complete = ["TOP5_SHOW", "SELECT_RANK_1", "CONFIRM_SAME_PRODUCT", "CONFIRM_STOCK_QTY:20", "CONFIRM_IMAGE_REVIEW_OK", "APPROVE_B2_RUN_PREFLIGHT"];

test("fixture defines a modeled mobile approval center with hard safety", () => {
  assert.equal(fixture.version, "EBAY_MOBILE_WHATSAPP_APPROVAL_CENTER_B2A_V1");
  assert.equal(fixture.status, "READY");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_MOBILE_APPROVAL_CENTER_ONLY");
  assert.equal(fixture.realWhatsappSendUsed, false);
  assert.equal(fixture.realSmsSendUsed, false);
  assert.equal(fixture.realEbayApiUsedInThisLoop, false);
  assert.equal(fixture.canPublish, false);
  assert.equal(fixture.top5Candidates.length, 5);
});

test("builds Top 5 summary and candidate detail cards", () => {
  const input = buildMobileWhatsappApprovalCenterInput(fixture);
  const summary = buildTop5MobileSummaryCard(input);
  const detail = buildCandidateMobileDetailCard(input, 1);
  assert.equal(summary.top5SummaryCardBuilt, true);
  assert.equal(summary.candidates.length, 5);
  assert.equal(detail.candidateDetailCardBuilt, true);
  assert.equal(detail.candidate.productName, "Reusable Hook and Loop Cable Ties 50 Pack");
  assert.equal(summary.realWhatsappSendUsed, false);
});

test("default and TOP5_SHOW never advance", () => {
  const initial = buildMobileWhatsappApprovalCenterReport(fixture);
  const shown = buildMobileWhatsappApprovalCenterReport(fixture, ["TOP5_SHOW"]);
  assert.equal(initial.mobileApprovalState, "MOBILE_APPROVAL_PENDING");
  assert.equal(initial.nextRecommendedRoute, "NEED_HUMAN_TOP_PRODUCT_SELECTION");
  assert.equal(shown.mobileApprovalState, "TOP5_REVIEWED");
  assert.equal(shown.canProceedToB2RunPreflight, false);
});

test("selection alone does not approve preflight", () => {
  const report = buildMobileWhatsappApprovalCenterReport(fixture, ["SELECT_RANK_1"]);
  assert.equal(report.mobileApprovalState, "CANDIDATE_SELECTED");
  assert.equal(report.selectedCandidateRank, 1);
  assert.equal(report.selectedCandidateName, "Reusable Hook and Loop Cable Ties 50 Pack");
  assert.equal(report.canProceedToB2RunPreflight, false);
  assert.equal(report.nextRecommendedRoute, "NEED_MOBILE_CONFIRMATIONS");
});

test("approval is blocked without selection, same-product, stock, or image gates", () => {
  const noSelection = buildMobileWhatsappApprovalCenterReport(fixture, ["APPROVE_B2_RUN_PREFLIGHT"]);
  const noSame = buildMobileWhatsappApprovalCenterReport(fixture, ["SELECT_RANK_1", "CONFIRM_STOCK_QTY:20", "CONFIRM_IMAGE_REVIEW_OK", "APPROVE_B2_RUN_PREFLIGHT"]);
  const noStock = buildMobileWhatsappApprovalCenterReport(fixture, ["SELECT_RANK_1", "CONFIRM_SAME_PRODUCT", "CONFIRM_IMAGE_REVIEW_OK", "APPROVE_B2_RUN_PREFLIGHT"]);
  const noImage = buildMobileWhatsappApprovalCenterReport(fixture, ["SELECT_RANK_1", "CONFIRM_SAME_PRODUCT", "CONFIRM_STOCK_QTY:20", "APPROVE_B2_RUN_PREFLIGHT"]);
  for (const report of [noSelection, noSame, noStock, noImage]) {
    assert.equal(report.b2RunPreflightApproved, false);
    assert.equal(report.canProceedToB2RunPreflight, false);
  }
});

test("complete sequence enables only B2-RUN preflight", () => {
  const report = buildMobileWhatsappApprovalCenterReport(fixture, complete);
  assert.equal(report.mobileApprovalState, "B2_RUN_PREFLIGHT_APPROVED");
  assert.equal(report.selectedCandidateRank, 1);
  assert.equal(report.sameProductConfirmed, true);
  assert.equal(report.stockQuantityObservedByHuman, 20);
  assert.equal(report.stockQuantitySource, "HUMAN_MOBILE_CONFIRMED");
  assert.equal(report.imageReviewOk, true);
  assert.equal(report.b2RunPreflightApproved, true);
  assert.equal(report.mobileApprovalGatePassed, true);
  assert.equal(report.canProceedToB2RunPreflight, true);
  assert.equal(report.canPublish, false);
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-B2-RUN-PREFLIGHT");
});

test("reject, refresh, and hold routes remain blocking", () => {
  const rejected = buildMobileWhatsappApprovalCenterReport(fixture, ["REJECT_ALL"]);
  const refresh = buildMobileWhatsappApprovalCenterReport(fixture, ["REQUEST_REFRESH"]);
  const hold = buildMobileWhatsappApprovalCenterReport(fixture, ["HOLD_FOR_REVIEW"]);
  assert.equal(rejected.mobileApprovalState, "REJECTED_ALL");
  assert.equal(rejected.nextRecommendedRoute, "NEED_LUNA_SCAN_REFRESH");
  assert.equal(refresh.mobileApprovalState, "REFRESH_REQUESTED");
  assert.equal(refresh.nextRecommendedRoute, "NEED_LUNA_SCAN_REFRESH");
  assert.equal(hold.mobileApprovalState, "HOLD_FOR_REVIEW");
  assert.equal(hold.nextRecommendedRoute, "EBAY-RESUME-HOLD");
});

test("stock command accepts positive integers and rejects invalid values", () => {
  assert.deepEqual(parseMobileApprovalCommand("CONFIRM_STOCK_QTY:20"), { parsedCommand: "CONFIRM_STOCK_QTY:20", commandType: "CONFIRM_STOCK_QTY", valid: true, value: 20 });
  for (const command of ["CONFIRM_STOCK_QTY:0", "CONFIRM_STOCK_QTY:-2", "CONFIRM_STOCK_QTY:nope", "CONFIRM_STOCK_QTY:1.5"]) assert.equal(parseMobileApprovalCommand(command).valid, false, command);
});

test("HELP and invalid commands do not advance", () => {
  for (const command of ["HELP", "NOT_ALLOWED"]) {
    const report = buildMobileWhatsappApprovalCenterReport(fixture, [command]);
    assert.equal(report.mobileApprovalState, "MOBILE_APPROVAL_PENDING");
    assert.equal(report.canProceedToB2RunPreflight, false);
  }
});

test("audit trail records every simulated command without real sends", () => {
  const report = buildMobileWhatsappApprovalCenterReport(fixture, complete);
  assert.equal(report.auditTrailBuilt, true);
  assert.equal(report.entries.length, complete.length);
  assert.ok(report.entries.every((entry) => entry.realMessageSent === false));
  assert.equal(report.realWhatsappSendUsed, false);
  assert.equal(report.realSmsSendUsed, false);
});

async function runCli(args = []) {
  const messages = [];
  const originalArgv = process.argv;
  const originalLog = console.log;
  process.argv = [originalArgv[0], cliPath, ...args];
  console.log = (message) => messages.push(String(message));
  try { await import(`./ebay-mobile-whatsapp-approval-center-dry-run.mjs?test=${Date.now()}-${Math.random()}`); }
  finally { process.argv = originalArgv; console.log = originalLog; }
  return JSON.parse(messages.join("\n"));
}

test("CLI supports default, individual commands, and full sequence", async () => {
  const initial = await runCli();
  const selected = await runCli(["--simulate-command", "SELECT_RANK_1"]);
  const approved = await runCli(["--simulate-command-sequence", complete.join(",")]);
  assert.equal(initial.mobileApprovalState, "MOBILE_APPROVAL_PENDING");
  assert.equal(selected.selectedCandidateRank, 1);
  assert.equal(approved.nextRecommendedRoute, "EBAY-RESUME-B2-RUN-PREFLIGHT");
  assert.equal(approved.canPublish, false);
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

test("all modes preserve hard safety boundaries", () => {
  for (const commands of [[], ["TOP5_SHOW"], ["SELECT_RANK_1"], complete, ["REJECT_ALL"], ["HOLD_FOR_REVIEW"]]) {
    const report = buildMobileWhatsappApprovalCenterReport(fixture, commands);
    assert.equal(report.canPublish, false);
    assert.equal(report.realWhatsappSendUsed, false);
    assert.equal(report.realSmsSendUsed, false);
    assert.equal(report.ebayApiUsed, false);
    assert.equal(report.oauthUsed, false);
    assert.equal(report.draftCreated, false);
    assert.equal(report.listingCreated, false);
    assert.equal(report.offerCreated, false);
    assert.equal(report.publicationExecuted, false);
    assert.equal(report.imageGenerationUsed, false);
    assert.equal(report.imageDownloadUsed, false);
    assert.equal(report.imageCopyUsed, false);
    assert.equal(report.scraperUsed, false);
  }
});
