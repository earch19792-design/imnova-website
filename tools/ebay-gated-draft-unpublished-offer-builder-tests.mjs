import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildEbayGatedDraftBuilderInput,
  buildEbayGatedDraftUnpublishedOfferBuilderReport,
  buildEbayImageDependencyMap,
  getEbayGatedDraftUnpublishedOfferBuilderChecklist,
  summarizeEbayGatedDraftUnpublishedOfferBuilder,
} from "../lib/ebay/ebay-gated-draft-unpublished-offer-builder.ts";

const fixturePath = "tools/fixtures/ebay-gated-draft-unpublished-offer-builder-v1.json";
const modulePath = "lib/ebay/ebay-gated-draft-unpublished-offer-builder.ts";
const cliPath = "tools/ebay-gated-draft-unpublished-offer-builder-dry-run.mjs";
const docPath = "docs/ebay-pro-isolation/EBAY_GATED_DRAFT_UNPUBLISHED_OFFER_BUILDER_RESUME_B2_V1.md";
const fixtureSource = readFileSync(fixturePath, "utf8");
const moduleSource = readFileSync(modulePath, "utf8");
const cliSource = readFileSync(cliPath, "utf8");
const docSource = readFileSync(docPath, "utf8");
const fixture = JSON.parse(fixtureSource);

test("fixture has expected B2 status and immutable safety boundaries", () => {
  assert.equal(fixture.status, "EBAY_GATED_DRAFT_UNPUBLISHED_OFFER_BUILDER_READY");
  assert.equal(fixture.production.offLimitsForWrites, true);
  assert.equal(fixture.main.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.ebayApi.usedInThisLoop, false);
  assert.equal(fixture.ebayWriteApi.usedInThisLoop, false);
  assert.equal(fixture.oauth.usedInThisLoop, false);
  assert.equal(fixture.tokenStorage.usedInThisLoop, false);
  assert.equal(fixture.draft.createdInThisLoop, false);
  assert.equal(fixture.listing.createdInThisLoop, false);
  assert.equal(fixture.offer.createdInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.imageGeneration.usedInThisLoop, false);
  assert.equal(fixture.amazonTrack.touchedInThisLoop, false);
});

test("source candidate exists, is LOW risk, and remains unpublished", () => {
  assert.equal(fixture.recommendedCandidate.productName, "Compact Silicone Cable Organizer Clips 20 Pack");
  assert.equal(fixture.recommendedCandidate.riskLevel, "LOW");
  assert.equal(fixture.recommendedCandidate.canProceedToDraftBuilder, true);
  assert.equal(fixture.recommendedCandidate.canPublish, false);
});

test("report builds sanitized inventory and offer payload previews", () => {
  const report = buildEbayGatedDraftUnpublishedOfferBuilderReport(fixture);
  assert.equal(report.draftBuilderReportBuilt, true);
  assert.equal(report.sourceListingPackageReady, true);
  assert.equal(report.inventoryItemPayloadPreview.previewOnly, true);
  assert.equal(report.inventoryItemPayloadPreview.executionAllowed, false);
  assert.equal(report.inventoryItemPayloadPreview.publish, false);
  assert.equal(report.offerPayloadPreview.previewOnly, true);
  assert.equal(report.offerPayloadPreview.executionAllowed, false);
  assert.equal(report.offerPayloadPreview.publish, false);
});

test("policy and location identifiers remain explicit runtime dependencies", () => {
  const report = buildEbayGatedDraftUnpublishedOfferBuilderReport(fixture);
  assert.equal(report.offerPayloadPreview.listingPolicies.fulfillmentPolicyId, "runtime_required");
  assert.equal(report.offerPayloadPreview.listingPolicies.paymentPolicyId, "runtime_required");
  assert.equal(report.offerPayloadPreview.listingPolicies.returnPolicyId, "runtime_required");
  assert.equal(report.offerPayloadPreview.merchantLocationKey, "runtime_required");
  for (const field of ["fulfillmentPolicyId", "paymentPolicyId", "returnPolicyId", "merchantLocationKey"]) {
    assert.ok(report.missingForRealDraftExecution.includes(field));
  }
});

test("warehouse alias is safe and no street-level warehouse data is versioned", () => {
  assert.equal(fixture.warehouse.warehouseAlias, "LUNA_PORTEX_BOCA_RATON");
  assert.equal(fixture.warehouse.fullWarehouseStreetAddressCommitted, false);
  const combined = `${fixtureSource}\n${docSource}\n${moduleSource}\n${cliSource}`;
  assert.doesNotMatch(combined, /streetAddress\s*[:=]|addressLine|fullAddress/i);
});

test("authorized image dependency is explicit and missing image blocks controlled execution", () => {
  const ready = buildEbayImageDependencyMap(buildEbayGatedDraftBuilderInput(fixture));
  assert.equal(ready.authorizedImageAvailable, true);
  assert.equal(ready.imageApprovalRequired, true);
  assert.equal(ready.payloadImageReference, "image_required_or_pending");
  const missingFixture = {
    ...fixture,
    recommendedCandidate: { ...fixture.recommendedCandidate, authorizedImageAvailable: false },
  };
  const report = buildEbayGatedDraftUnpublishedOfferBuilderReport(missingFixture);
  assert.equal(report.imageDependencyMap.blocksControlledExecution, true);
  assert.equal(report.canProceedToControlledDraftExecution, false);
});

test("account risk routes to hold and missing source package routes to data", () => {
  const hold = buildEbayGatedDraftUnpublishedOfferBuilderReport({ ...fixture, accountRiskKnown: true });
  assert.equal(hold.nextRecommendedRoute, "EBAY-RESUME-HOLD");
  const missingSource = buildEbayGatedDraftUnpublishedOfferBuilderReport({
    ...fixture,
    routeInputs: { ...fixture.routeInputs, "EBAY-RESUME-C-AUTO": "missing" },
  });
  assert.equal(missingSource.sourceListingPackageReady, false);
  assert.equal(missingSource.nextRecommendedRoute, "NEED_DRAFT_EXECUTION_DATA");
});

test("controlled execution readiness does not imply any real write", () => {
  const report = buildEbayGatedDraftUnpublishedOfferBuilderReport(fixture);
  assert.equal(report.canProceedToControlledDraftExecution, true);
  assert.equal(report.canCreateDraftNow, false);
  assert.equal(report.canCreateOfferNow, false);
  assert.equal(report.canPublish, false);
  assert.equal(report.requiresHumanApproval, true);
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-B2-RUN");
});

test("payload previews contain no credential material", () => {
  const report = buildEbayGatedDraftUnpublishedOfferBuilderReport(fixture);
  const payload = JSON.stringify({
    inventory: report.inventoryItemPayloadPreview,
    offer: report.offerPayloadPreview,
  });
  const forbidden = [
    "access" + "_token",
    "refresh" + "_token",
    "client" + "_secret",
    "authorization" + " code",
  ];
  for (const marker of forbidden) assert.equal(payload.includes(marker), false, marker);
});

test("module and CLI contain no runtime API, database, or filesystem-write capability", () => {
  const prohibited = [
    "process" + ".env",
    "fetch" + "(",
    "create" + "Client",
    ".fr" + "om(",
    ".ins" + "ert(",
    ".upd" + "ate(",
    ".ups" + "ert(",
    "write" + "File",
    "append" + "File",
    "create" + "WriteStream",
  ];
  for (const marker of prohibited) {
    assert.equal(moduleSource.includes(marker), false, marker);
    assert.equal(cliSource.includes(marker), false, marker);
  }
});

test("B2 files do not mix paused or old implementation tracks", () => {
  const combined = `${moduleSource}\n${cliSource}\n${fixtureSource}\n${docSource}`;
  const forbidden = [
    "AMAZON_LISTING_PACKAGE_BUILDER",
    "ebay-sandbox-draft-listing",
    "EBAY_SANDBOX_DRAFT_LISTING",
  ];
  for (const marker of forbidden) assert.equal(combined.includes(marker), false, marker);
});

test("summary provides numeric readiness and safe output", () => {
  const summary = summarizeEbayGatedDraftUnpublishedOfferBuilder(
    buildEbayGatedDraftUnpublishedOfferBuilderReport(fixture),
  );
  assert.equal(typeof summary.draftReadinessScore, "number");
  assert.ok(summary.draftReadinessScore >= 0 && summary.draftReadinessScore <= 100);
  assert.ok(summary.missingForRealDraftExecutionCount >= 1);
  assert.equal(summary.inventoryItemPayloadPreviewBuilt, true);
  assert.equal(summary.offerPayloadPreviewBuilt, true);
  assert.equal(summary.canCreateDraftNow, false);
  assert.equal(summary.canCreateOfferNow, false);
  assert.equal(summary.canPublish, false);
  assert.equal(summary.productionWriteTouched, false);
  assert.equal(summary.ebayApiUsedInThisLoop, false);
});

test("builder checklist exists", () => {
  const checklist = getEbayGatedDraftUnpublishedOfferBuilderChecklist();
  assert.ok(checklist.length >= 5);
  assert.match(checklist.join(" "), /Ernesto approval/i);
});

test("CLI dry-run executes with the expected candidate and route", async () => {
  const messages = [];
  const originalLog = console.log;
  console.log = (message) => messages.push(String(message));
  try {
    await import(`./ebay-gated-draft-unpublished-offer-builder-dry-run.mjs?test=${Date.now()}`);
  } finally {
    console.log = originalLog;
  }
  const output = JSON.parse(messages.join("\n"));
  assert.equal(output.draftBuilderReportBuilt, true);
  assert.equal(output.sourceListingPackageReady, true);
  assert.equal(output.recommendedCandidateName, "Compact Silicone Cable Organizer Clips 20 Pack");
  assert.equal(output.recommendedCandidateRiskLevel, "LOW");
  assert.equal(output.inventoryItemPayloadPreviewBuilt, true);
  assert.equal(output.offerPayloadPreviewBuilt, true);
  assert.equal(output.canCreateDraftNow, false);
  assert.equal(output.canCreateOfferNow, false);
  assert.equal(output.canPublish, false);
  assert.equal(output.nextRecommendedRoute, "EBAY-RESUME-B2-RUN");
});
