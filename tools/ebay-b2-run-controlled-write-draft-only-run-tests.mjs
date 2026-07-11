import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildControlledDraftOnlyRunGate,
  buildEbayB2RunControlledWriteDraftOnlyRunInput,
  buildEbayB2RunControlledWriteDraftOnlyRunReport,
  buildNoPublishActionGuard,
  validateControlledDraftOnlyRuntimeChecks,
  validateControlledDraftOnlyRuntimeInputs,
} from "../lib/ebay/ebay-b2-run-controlled-write-draft-only-run.ts";

const fixturePath = "tools/fixtures/ebay-b2-run-controlled-write-draft-only-run-v1.json";
const modulePath = "lib/ebay/ebay-b2-run-controlled-write-draft-only-run.ts";
const dryRunPath = "tools/ebay-b2-run-controlled-write-draft-only-run-dry-run.mjs";
const runnerPath = "tools/ebay-b2-run-controlled-write-draft-only-runner.mjs";
const docPath = "docs/ebay-pro-isolation/EBAY_B2_RUN_CONTROLLED_WRITE_DRAFT_ONLY_RUN_V1.md";
const fixtureSource = readFileSync(fixturePath, "utf8");
const moduleSource = readFileSync(modulePath, "utf8");
const dryRunSource = readFileSync(dryRunPath, "utf8");
const runnerSource = readFileSync(runnerPath, "utf8");
const docSource = readFileSync(docPath, "utf8");
const fixture = JSON.parse(fixtureSource);

function approved(overrides = {}) {
  return {
    runRequested: true, runApprovalPhrase: fixture.exactRunApprovalPhrase, environment: "SANDBOX",
    accessTokenProvidedAtRuntime: true, marketplaceId: "EBAY_US", writeRunId: "TEST-RUN-0001",
    authorizedImageOrBypass: true, interactiveConfirmation: fixture.exactInteractiveConfirmation,
    categoryIdConfirmed: true, fulfillmentPolicyConfirmed: true, returnPolicyConfirmed: true,
    paymentPolicyConfirmed: true, finalStockConfirmed: true, finalPriceConfirmed: true,
    finalImageApprovedOrUnpublishedOnlyBypassConfirmed: true, ...overrides,
  };
}

test("fixture defines a hard-gated no-publication RUN", () => {
  assert.equal(fixture.version, "EBAY_B2_RUN_CONTROLLED_WRITE_DRAFT_ONLY_RUN_V1");
  assert.equal(fixture.status, "READY");
  assert.equal(fixture.defaultMode, "SAFE_NO_WRITE");
  assert.equal(fixture.canPublish, false);
  assert.equal(fixture.publishOfferForbidden, true);
  assert.equal(fixture.requiredRuntimeInputs.length, 6);
  assert.equal(fixture.requiredRuntimeChecks.length, 8);
});

test("approved simulation builds both payloads but never uses API or writes", () => {
  const report = buildEbayB2RunControlledWriteDraftOnlyRunReport(fixture, approved());
  assert.equal(report.runGatePassed, true);
  assert.equal(report.inventoryItemPayloadBuilt, true);
  assert.equal(report.unpublishedOfferPayloadBuilt, true);
  assert.equal(report.noPublishActionGuardPassed, true);
  assert.equal(report.nextRecommendedRoute, "READY_FOR_REAL_RUN_COMMAND");
  assert.equal(report.realEbayApiUsed, false);
  assert.equal(report.realEbayWriteExecuted, false);
  assert.equal(report.canPublish, false);
});

test("every runtime input is independently required and missing token has explicit route", () => {
  const changes = {
    environment: "", accessTokenProvidedAtRuntime: false, marketplaceId: "", runApprovalPhrase: "WRONG",
    writeRunId: "", authorizedImageOrBypass: false,
  };
  for (const [key, value] of Object.entries(changes)) {
    const input = buildEbayB2RunControlledWriteDraftOnlyRunInput(fixture, approved({ [key]: value }));
    assert.equal(validateControlledDraftOnlyRuntimeInputs(input).runtimeInputsPresent, false, key);
    assert.equal(buildControlledDraftOnlyRunGate(input).runGatePassed, false, key);
  }
  const missingToken = buildEbayB2RunControlledWriteDraftOnlyRunReport(fixture, approved({ accessTokenProvidedAtRuntime: false }));
  assert.equal(missingToken.nextRecommendedRoute, "NEED_RUNTIME_EBAY_ACCESS_TOKEN");
});

test("every runtime check is independently required", () => {
  const keys = ["categoryIdConfirmed", "fulfillmentPolicyConfirmed", "returnPolicyConfirmed", "paymentPolicyConfirmed", "finalStockConfirmed", "finalPriceConfirmed", "finalImageApprovedOrUnpublishedOnlyBypassConfirmed"];
  for (const key of keys) {
    const input = buildEbayB2RunControlledWriteDraftOnlyRunInput(fixture, approved({ [key]: false }));
    assert.equal(validateControlledDraftOnlyRuntimeChecks(input).runtimeChecksPassed, false, key);
    assert.equal(buildControlledDraftOnlyRunGate(input).runGatePassed, false, key);
  }
  const interactive = buildEbayB2RunControlledWriteDraftOnlyRunInput(fixture, approved({ interactiveConfirmation: "WRONG" }));
  assert.equal(validateControlledDraftOnlyRuntimeChecks(interactive).runtimeChecksPassed, false);
});

test("zero stock and missing price block", () => {
  for (const simulation of [approved({ simulatedStock: 0 }), approved({ simulatedStock: -1 }), approved({ simulatedPrice: 0 })]) {
    assert.equal(buildEbayB2RunControlledWriteDraftOnlyRunReport(fixture, simulation).runGatePassed, false);
  }
});

test("publication intent always forces HOLD and allowlist excludes active actions", () => {
  const input = buildEbayB2RunControlledWriteDraftOnlyRunInput(fixture, { forbiddenPublishRequested: true });
  const guard = buildNoPublishActionGuard(input);
  assert.equal(guard.noPublishActionGuardPassed, false);
  assert.equal(guard.publishOfferForbidden, true);
  assert.deepEqual(fixture.allowedEbayActions, ["createOrReplaceInventoryItem", "createOfferUnpublishedOnly"]);
  const report = buildEbayB2RunControlledWriteDraftOnlyRunReport(fixture, { forbiddenPublishRequested: true });
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-HOLD");
  assert.equal(report.canPublish, false);
});

async function runCli(path, args = [], env = {}) {
  const messages = [], originalArgv = process.argv, originalLog = console.log, originalEnv = {};
  for (const [key, value] of Object.entries(env)) { originalEnv[key] = process.env[key]; process.env[key] = value; }
  process.argv = [originalArgv[0], path, ...args]; console.log = (message) => messages.push(String(message));
  try { await import(`./${path.split("/").at(-1)}?test=${Date.now()}-${Math.random()}`); }
  finally {
    process.argv = originalArgv; console.log = originalLog;
    for (const key of Object.keys(env)) originalEnv[key] === undefined ? delete process.env[key] : process.env[key] = originalEnv[key];
  }
  return JSON.parse(messages.join("\n"));
}

test("dry-run supports safe, approved, missing-token, and forbidden modes", async () => {
  const initial = await runCli(dryRunPath);
  const run = await runCli(dryRunPath, ["--simulate-run-approved"]);
  const missing = await runCli(dryRunPath, ["--simulate-run-approved", "--simulate-missing-token"]);
  const forbidden = await runCli(dryRunPath, ["--simulate-forbidden-publish-request"]);
  assert.equal(initial.nextRecommendedRoute, "SAFE_NO_WRITE");
  assert.equal(run.runGatePassed, true);
  assert.equal(run.nextRecommendedRoute, "READY_FOR_REAL_RUN_COMMAND");
  assert.equal(missing.nextRecommendedRoute, "NEED_RUNTIME_EBAY_ACCESS_TOKEN");
  assert.equal(forbidden.nextRecommendedRoute, "EBAY-RESUME-HOLD");
  for (const report of [initial, run, missing, forbidden]) { assert.equal(report.realEbayApiUsed, false); assert.equal(report.realEbayWriteExecuted, false); assert.equal(report.canPublish, false); }
});

test("runner defaults safe and execute flag without gates blocks", async () => {
  const initial = await runCli(runnerPath);
  const blocked = await runCli(runnerPath, ["--execute-controlled-draft-only-run"]);
  assert.equal(initial.mode, "SAFE_NO_WRITE");
  assert.equal(initial.runRequested, false);
  assert.equal(initial.nextRecommendedRoute, "EXECUTION_NOT_REQUESTED_SAFE_NO_WRITE");
  assert.equal(blocked.runRequested, true);
  assert.equal(blocked.runGatePassed, false);
  assert.equal(blocked.nextRecommendedRoute, "NEED_RUNTIME_GATES");
  assert.equal(blocked.realRunImplementationReady, true);
  assert.equal(blocked.realRunExecutionDisabledLocally, true);
  assert.equal(blocked.realEbayWriteExecuted, false);
});

test("even complete environment gates stop at manual enablement without reading token value", async () => {
  const output = await runCli(runnerPath, ["--execute-controlled-draft-only-run"], {
    EBAY_ENVIRONMENT: "SANDBOX", EBAY_ACCESS_TOKEN: "IN_MEMORY_TEST_VALUE",
    EBAY_MARKETPLACE_ID: "EBAY_US", EBAY_B2_CONTROLLED_WRITE_APPROVED: fixture.exactRunApprovalPhrase,
    EBAY_B2_WRITE_RUN_ID: "TEST-RUN-0002", AUTHORIZED_IMAGE_URL_OR_IMAGE_APPROVAL_BYPASS_FOR_UNPUBLISHED_ONLY: "APPROVED",
  });
  assert.equal(output.nextRecommendedRoute, "READY_FOR_MANUAL_REAL_RUN_ENABLEMENT");
  assert.equal(output.realRunExecutionDisabledLocally, true);
  assert.equal(output.realEbayApiUsed, false);
  assert.equal(output.realEbayWriteExecuted, false);
  assert.equal(JSON.stringify(output).includes("IN_MEMORY_TEST_VALUE"), false);
});

test("pure module and dry-run have no environment, network, DB, or filesystem writes", () => {
  for (const marker of ["process" + ".env", "fetch" + "(", "create" + "Client", ".fr" + "om(", ".ins" + "ert(", ".upd" + "ate(", ".ups" + "ert(", "write" + "File", "append" + "File"]) {
    assert.equal(moduleSource.includes(marker), false, marker);
    assert.equal(dryRunSource.includes(marker), false, marker);
  }
  assert.equal(runnerSource.includes("fetch" + "("), false);
  const directEnvNames = [...runnerSource.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(directEnvNames)].sort(), ["EBAY_B2_CONTROLLED_WRITE_APPROVED", "EBAY_B2_WRITE_RUN_ID", "EBAY_ENVIRONMENT"].sort());
  assert.match(runnerSource, /\["EBAY", "ACCESS", "TOKEN"\]\.join/);
  assert.match(runnerSource, /\["EBAY", "MARKETPLACE", "ID"\]\.join/);
});

test("files contain no endpoint, secret, image, full address, or paused track", () => {
  const implementation = `${moduleSource}\n${dryRunSource}\n${runnerSource}`;
  assert.doesNotMatch(implementation, /https?:\/\/api\.ebay\.com/i);
  assert.doesNotMatch(implementation, /\/sell\/inventory\/v1\/offer\/.+publish/i);
  const combined = `${fixtureSource}\n${implementation}\n${docSource}`;
  for (const marker of ["refresh" + "_token", "client" + "_secret", "service" + "_role"]) assert.equal(combined.toLowerCase().includes(marker), false);
  assert.doesNotMatch(combined, /streetAddress\s*[:=]|addressLine|fullAddress/i);
  assert.doesNotMatch(combined, /\.(png|jpe?g|webp)\b/i);
  for (const marker of ["AMAZON_LISTING_" + "PACKAGE_BUILDER", "ebay-sandbox-" + "draft-listing", "EBAY_SANDBOX_" + "DRAFT_LISTING"]) assert.equal(combined.includes(marker), false);
});

test("all reports preserve permanent safety boundaries", () => {
  for (const simulation of [{}, approved(), approved({ accessTokenProvidedAtRuntime: false }), { forbiddenPublishRequested: true }]) {
    const report = buildEbayB2RunControlledWriteDraftOnlyRunReport(fixture, simulation);
    for (const key of ["realEbayApiUsed", "realEbayWriteExecuted", "inventoryItemCreated", "unpublishedOfferCreated", "listingCreated", "publicationExecuted", "canPublish", "tokenStored", "tokensPrinted", "productionDeploymentWriteTouched", "mainTouched", "stagingDbWriteExecuted", "supabaseWriteExecuted", "imageGenerationUsed", "imageDownloadUsed", "imageCopyAllowed", "scraperUsed", "amazonTrackTouched", "whatsappRealSendUsed", "smsRealSendUsed", "openAiUsed", "fullWarehouseStreetAddressCommitted"]) assert.equal(report[key], false, key);
  }
});
