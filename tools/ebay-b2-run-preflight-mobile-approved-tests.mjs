import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildB2RunFinalWriteApprovalGate,
  buildB2RunImageReviewGuard,
  buildB2RunInventoryItemPayloadPreview,
  buildB2RunListingPackagePreview,
  buildB2RunOfferPayloadPreview,
  buildB2RunPolicyReadinessAssessment,
  buildB2RunSupplierAndStockGuard,
  buildEbayB2RunPreflightMobileApprovedInput,
  buildEbayB2RunPreflightMobileApprovedReport,
  validateMobileApprovalForB2RunPreflight,
} from "../lib/ebay/ebay-b2-run-preflight-mobile-approved.ts";

const fixturePath = "tools/fixtures/ebay-b2-run-preflight-mobile-approved-v1.json";
const modulePath = "lib/ebay/ebay-b2-run-preflight-mobile-approved.ts";
const cliPath = "tools/ebay-b2-run-preflight-mobile-approved-dry-run.mjs";
const docPath = "docs/ebay-pro-isolation/EBAY_B2_RUN_PREFLIGHT_MOBILE_APPROVED_V1.md";
const fixtureSource = readFileSync(fixturePath, "utf8");
const moduleSource = readFileSync(modulePath, "utf8");
const cliSource = readFileSync(cliPath, "utf8");
const docSource = readFileSync(docPath, "utf8");
const fixture = JSON.parse(fixtureSource);

const changed = (path, value) => {
  const copy = structuredClone(fixture);
  let cursor = copy;
  for (const key of path.slice(0, -1)) cursor = cursor[key];
  cursor[path.at(-1)] = value;
  return copy;
};

test("fixture contains complete mobile approval and hard write blocks", () => {
  assert.equal(fixture.version, "EBAY_B2_RUN_PREFLIGHT_MOBILE_APPROVED_V1");
  assert.equal(fixture.status, "READY");
  assert.equal(fixture.selectedCandidate.rank, 1);
  assert.equal(fixture.mobileApproval.mobileApprovalGatePassed, true);
  assert.equal(fixture.canExecuteEbayWrite, false);
  assert.equal(fixture.canPublish, false);
  assert.equal(fixture.requiresFinalWriteApproval, true);
});

test("complete mobile gates validate", () => {
  const validation = validateMobileApprovalForB2RunPreflight(buildEbayB2RunPreflightMobileApprovedInput(fixture));
  assert.equal(validation.mobileApprovalConsumed, true);
  assert.ok(Object.values(validation.gates).every(Boolean));
});

test("missing candidate or any mobile approval gate blocks preflight", () => {
  const cases = [
    changed(["selectedCandidate", "productName"], ""),
    changed(["mobileApproval", "sameProductConfirmed"], false),
    changed(["mobileApproval", "stockQuantityObservedByHuman"], null),
    changed(["mobileApproval", "stockQuantityObservedByHuman"], 0),
    changed(["mobileApproval", "stockQuantityObservedByHuman"], -1),
    changed(["mobileApproval", "imageReviewOk"], false),
    changed(["mobileApproval", "b2RunPreflightApproved"], false),
    changed(["mobileApproval", "mobileApprovalGatePassed"], false),
  ];
  for (const inputFixture of cases) {
    const report = buildEbayB2RunPreflightMobileApprovedReport(inputFixture);
    assert.equal(report.canProceedToB2RunPreflight, false);
    assert.equal(report.canExecuteEbayWrite, false);
    assert.equal(report.canPublish, false);
  }
});

test("listing fields are completed from observed eBay structure", () => {
  const input = buildEbayB2RunPreflightMobileApprovedInput(fixture);
  const preview = buildB2RunListingPackagePreview(input);
  assert.equal(preview.listingFieldsCompletedFromEbay, true);
  assert.equal(preview.title, "Reusable Hook and Loop Cable Ties 50 Pack Adjustable Cord Organizer Straps");
  assert.equal(preview.categorySignal, "Cable Ties & Organizers");
  assert.equal(preview.packQuantity, 50);
  assert.equal(preview.itemSpecifics.Brand, "Unbranded");
  assert.equal(preview.recommendedPrice.value, 12.99);
  assert.match(preview.description, /Reusable/);
});

test("inventory and offer previews remain non-writing and non-publishing", () => {
  const input = buildEbayB2RunPreflightMobileApprovedInput(fixture);
  const inventory = buildB2RunInventoryItemPayloadPreview(input);
  const offer = buildB2RunOfferPayloadPreview(input);
  assert.equal(inventory.inventoryItemPayloadPreviewBuilt, true);
  assert.equal(offer.offerPayloadPreviewBuilt, true);
  assert.equal(inventory.writeExecutionEnabled, false);
  assert.equal(offer.writeExecutionEnabled, false);
  assert.equal(inventory.payload.publish, false);
  assert.equal(offer.payload.publish, false);
  assert.equal(inventory.payload.availability.shipToLocationAvailability.source, "PREVIEW_ONLY");
});

test("supplier cost remains unknown while human stock observation is guarded", () => {
  const guard = buildB2RunSupplierAndStockGuard(buildEbayB2RunPreflightMobileApprovedInput(fixture));
  assert.equal(guard.supplierCostSource, "UNKNOWN_FROM_SUPPLIER");
  assert.equal(guard.supplierCostGuard, "LOW_CONFIDENCE_GUARD");
  assert.equal(guard.supplierUnknownGuardApplied, true);
  assert.equal(guard.supplierStockSource, "HUMAN_MOBILE_CONFIRMED");
  assert.equal(guard.stockQuantityObservedByHuman, 20);
  assert.equal(guard.stockGuardApplied, true);
  assert.equal(guard.finalStockReviewRequired, true);
});

test("image review is consumed but final image approval remains required", () => {
  const guard = buildB2RunImageReviewGuard(buildEbayB2RunPreflightMobileApprovedInput(fixture));
  assert.equal(guard.imageReviewGuardApplied, true);
  assert.equal(guard.humanImageReviewOk, true);
  assert.equal(guard.finalImageApprovalStillRequired, true);
  assert.equal(guard.imageGenerationUsed, false);
  assert.equal(guard.imageDownloadUsed, false);
  assert.equal(guard.imageCopyAllowed, false);
});

test("category and business policies remain runtime checks", () => {
  const input = buildEbayB2RunPreflightMobileApprovedInput(fixture);
  const policy = buildB2RunPolicyReadinessAssessment(input);
  assert.equal(input.listing.categoryIdStatus, "PENDING_RUNTIME_CONFIRMATION");
  assert.equal(policy.policyReadinessStatus, "REVIEW_REQUIRED");
  assert.equal(policy.statuses.payment, "REVIEW_REQUIRED");
  assert.equal(policy.statuses.returns, "REVIEW_REQUIRED");
  assert.equal(policy.statuses.fulfillment, "REVIEW_REQUIRED");
  assert.ok(input.runtimeChecksRequired.includes("finalStockReview"));
  assert.ok(input.runtimeChecksRequired.includes("finalHumanWriteApproval"));
});

test("final write approval gate is built but execution remains disabled", () => {
  const gate = buildB2RunFinalWriteApprovalGate(buildEbayB2RunPreflightMobileApprovedInput(fixture));
  assert.equal(gate.finalWriteApprovalGateBuilt, true);
  assert.equal(gate.requiresFinalWriteApproval, true);
  assert.equal(gate.canExecuteEbayWrite, false);
  assert.equal(gate.writeExecutionEnabled, false);
  assert.equal(gate.canPublish, false);
});

test("complete report routes to write approval with runtime checks", () => {
  const report = buildEbayB2RunPreflightMobileApprovedReport(fixture);
  assert.equal(report.b2RunPreflightMobileApprovedReportBuilt, true);
  assert.equal(report.mobileApprovalConsumed, true);
  assert.equal(report.selectedCandidateName, "Reusable Hook and Loop Cable Ties 50 Pack");
  assert.equal(report.selectedCandidateRank, 1);
  assert.equal(report.canProceedToB2RunPreflight, true);
  assert.equal(report.canExecuteEbayWrite, false);
  assert.equal(report.canPublish, false);
  assert.equal(report.requiresFinalWriteApproval, true);
  assert.equal(report.nextRecommendedRoute, "READY_FOR_B2_RUN_WRITE_APPROVAL_WITH_RUNTIME_CHECKS");
});

async function runCli() {
  const messages = [];
  const originalArgv = process.argv;
  const originalLog = console.log;
  process.argv = [originalArgv[0], cliPath];
  console.log = (message) => messages.push(String(message));
  try { await import(`./ebay-b2-run-preflight-mobile-approved-dry-run.mjs?test=${Date.now()}-${Math.random()}`); }
  finally { process.argv = originalArgv; console.log = originalLog; }
  return JSON.parse(messages.join("\n"));
}

test("CLI executes and prints expected sanitized summary", async () => {
  const summary = await runCli();
  assert.equal(summary.mobileApprovalConsumed, true);
  assert.equal(summary.stockQuantityObservedByHuman, 20);
  assert.equal(summary.inventoryItemPayloadPreviewBuilt, true);
  assert.equal(summary.canExecuteEbayWrite, false);
  assert.equal(summary.canPublish, false);
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

test("report preserves every hard safety boundary", () => {
  const report = buildEbayB2RunPreflightMobileApprovedReport(fixture);
  for (const key of ["productionWriteTouched", "mainTouched", "stagingWriteExecuted", "ebayApiUsedInThisLoop", "ebayWriteApiUsed", "oauthUsedInThisLoop", "tokenStored", "tokensPrinted", "draftCreated", "listingCreated", "offerCreated", "publicationExecuted", "imageGenerationUsed", "imageDownloadUsed", "imageCopyAllowed", "scraperUsed", "amazonTrackTouched", "whatsappRealSendUsed", "smsRealSendUsed", "openAiUsed", "fullWarehouseStreetAddressCommitted"]) assert.equal(report[key], false, key);
});
