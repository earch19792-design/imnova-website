import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildEbayB2RunControlledWriteDraftOnlyInput,
  buildEbayB2RunControlledWriteDraftOnlyReport,
  buildInventoryItemPayloadPreview,
  buildNoPublishEndpointGuard,
  buildUnpublishedOfferPayloadPreview,
  validateControlledWriteExecutionGates,
  validateFinalApprovalPhraseForDraftOnly,
} from "../lib/ebay/ebay-b2-run-controlled-write-draft-only.ts";

const fixturePath = "tools/fixtures/ebay-b2-run-controlled-write-draft-only-v1.json";
const modulePath = "lib/ebay/ebay-b2-run-controlled-write-draft-only.ts";
const dryRunPath = "tools/ebay-b2-run-controlled-write-draft-only-dry-run.mjs";
const runnerPath = "tools/ebay-b2-run-controlled-write-draft-only-runner.mjs";
const docPath = "docs/ebay-pro-isolation/EBAY_B2_RUN_CONTROLLED_WRITE_DRAFT_ONLY_V1.md";
const fixtureSource = readFileSync(fixturePath, "utf8");
const moduleSource = readFileSync(modulePath, "utf8");
const dryRunSource = readFileSync(dryRunPath, "utf8");
const runnerSource = readFileSync(runnerPath, "utf8");
const docSource = readFileSync(docPath, "utf8");
const fixture = JSON.parse(fixtureSource);
const exact = "FINAL_WRITE_APPROVED_FOR_UNPUBLISHED_DRAFT_ONLY";

function approvedSimulation(overrides = {}) {
  return {
    controlledWriteExecutionRequested: true, runtimeChecksAllPassed: true,
    environmentApproval: exact, interactiveConfirmation: fixture.exactInteractiveConfirmation,
    authorizedImageAsset: true, policyRuntimeReady: true, categoryRuntimeReady: true,
    stockRuntimeReady: true, priceRuntimeReady: true, ...overrides,
  };
}

test("fixture records exact human approval and permanent no-publish policy", () => {
  assert.equal(fixture.version, "EBAY_B2_RUN_CONTROLLED_WRITE_DRAFT_ONLY_V1");
  assert.equal(fixture.status, "READY");
  assert.equal(fixture.finalApprovalPhraseReceived.value, exact);
  assert.equal(fixture.finalApprovalPhraseReceived.accepted, true);
  assert.equal(fixture.writeModePolicy.localImplementationExecutesWrite, false);
  assert.equal(fixture.writeModePolicy.publishAllowed, false);
  assert.equal(fixture.writeModePolicy.listingActiveAllowed, false);
});

test("exact approval passes and altered approval blocks", () => {
  const input = buildEbayB2RunControlledWriteDraftOnlyInput(fixture);
  assert.equal(validateFinalApprovalPhraseForDraftOnly(input).finalApprovalPhraseAccepted, true);
  for (const value of ["APPROVE", `${exact} `, exact.toLowerCase()]) {
    const changed = structuredClone(fixture);
    changed.finalApprovalPhraseReceived.value = value;
    assert.equal(validateFinalApprovalPhraseForDraftOnly(buildEbayB2RunControlledWriteDraftOnlyInput(changed)).finalApprovalPhraseAccepted, false);
  }
});

test("inventory and unpublished offer previews are inert and publication guard is absolute", () => {
  const input = buildEbayB2RunControlledWriteDraftOnlyInput(fixture);
  assert.equal(buildInventoryItemPayloadPreview(input).inventoryItemPayloadPreviewBuilt, true);
  assert.equal(buildUnpublishedOfferPayloadPreview(input).unpublishedOfferPayloadPreviewBuilt, true);
  const guard = buildNoPublishEndpointGuard(input);
  assert.equal(guard.publishEndpointGuardBuilt, true);
  assert.equal(guard.publishOfferForbidden, true);
  assert.equal(guard.canPublish, false);
  assert.deepEqual(fixture.allowedFutureDraftOnlyActions, ["createOrReplaceInventoryItem", "createOfferUnpublishedOnly"]);
});

test("every controlled execution gate is independently required", () => {
  const keys = ["runtimeChecksAllPassed", "controlledWriteExecutionRequested", "environmentApproval", "interactiveConfirmation", "authorizedImageAsset", "policyRuntimeReady", "categoryRuntimeReady", "stockRuntimeReady", "priceRuntimeReady"];
  for (const key of keys) {
    const simulation = approvedSimulation();
    simulation[key] = typeof simulation[key] === "string" ? "WRONG" : false;
    const input = buildEbayB2RunControlledWriteDraftOnlyInput(fixture, simulation);
    assert.equal(validateControlledWriteExecutionGates(input).controlledWriteGatePassed, false, key);
  }
});

test("zero stock and missing positive price block the future gate", () => {
  const noStock = structuredClone(fixture);
  noStock.selectedProduct.stockObserved = 0;
  assert.equal(buildEbayB2RunControlledWriteDraftOnlyReport(noStock, approvedSimulation()).controlledWriteGatePassed, false);
  const noPrice = structuredClone(fixture);
  noPrice.payloadPreview.price.value = 0;
  assert.equal(buildEbayB2RunControlledWriteDraftOnlyReport(noPrice, approvedSimulation()).controlledWriteGatePassed, false);
});

test("approved simulation only prepares future execution and never writes", () => {
  const report = buildEbayB2RunControlledWriteDraftOnlyReport(fixture, approvedSimulation());
  assert.equal(report.controlledWriteGatePassed, true);
  assert.equal(report.futureControlledWriteReady, true);
  assert.equal(report.nextRecommendedRoute, "READY_FOR_CONTROLLED_WRITE_RUNNER_EXECUTION");
  for (const key of ["realEbayApiUsedInImplementation", "realEbayWriteExecuted", "draftCreatedInImplementation", "inventoryItemCreatedInImplementation", "unpublishedOfferCreatedInImplementation", "listingCreated", "publicationExecuted", "canPublish"]) assert.equal(report[key], false, key);
});

test("forbidden publication request forces HOLD", () => {
  const report = buildEbayB2RunControlledWriteDraftOnlyReport(fixture, { forbiddenPublishRequested: true });
  assert.equal(report.controlledWriteGatePassed, false);
  assert.equal(report.publishOfferForbidden, true);
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-HOLD");
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

test("dry-run supports default, approved simulation, and forbidden request", async () => {
  const initial = await runCli(dryRunPath);
  const approved = await runCli(dryRunPath, ["--simulate-controlled-write-approved"]);
  const forbidden = await runCli(dryRunPath, ["--simulate-forbidden-publish-request"]);
  assert.equal(initial.nextRecommendedRoute, "CONTROLLED_WRITE_DRAFT_ONLY_READY_BUT_NOT_EXECUTED");
  assert.equal(initial.realEbayWriteExecuted, false);
  assert.equal(approved.controlledWriteGatePassed, true);
  assert.equal(approved.nextRecommendedRoute, "READY_FOR_CONTROLLED_WRITE_RUNNER_EXECUTION");
  assert.equal(forbidden.nextRecommendedRoute, "EBAY-RESUME-HOLD");
});

test("runner defaults safe and remains disabled even when environment gates appear", async () => {
  const initial = await runCli(runnerPath);
  assert.equal(initial.mode, "SAFE_NO_WRITE");
  assert.equal(initial.controlledWriteExecutionRequested, false);
  assert.equal(initial.realEbayWriteExecuted, false);
  assert.equal(initial.nextRecommendedRoute, "EXECUTION_NOT_REQUESTED_SAFE_NO_WRITE");
  const attempted = await runCli(runnerPath, ["--execute-controlled-write-draft-only"], {
    EBAY_B2_CONTROLLED_WRITE_APPROVED: exact, EBAY_ENVIRONMENT: "PRODUCTION", EBAY_B2_WRITE_RUN_ID: "SANITIZED_TEST_RUN",
  });
  assert.equal(attempted.controlledWriteGatePassed, false);
  assert.equal(attempted.blockedReason, "LOCAL_IMPLEMENTATION_EXECUTION_DISABLED");
  assert.equal(attempted.realEbayWriteExecuted, false);
});

test("pure module and dry-run contain no environment, network, database, or filesystem writes", () => {
  for (const marker of ["process" + ".env", "fetch" + "(", "create" + "Client", ".fr" + "om(", ".ins" + "ert(", ".upd" + "ate(", ".ups" + "ert(", "write" + "File", "append" + "File"]) {
    assert.equal(moduleSource.includes(marker), false, marker);
    assert.equal(dryRunSource.includes(marker), false, marker);
  }
  const envNames = [...runnerSource.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(envNames)].sort(), ["EBAY_B2_CONTROLLED_WRITE_APPROVED", "EBAY_B2_WRITE_RUN_ID", "EBAY_ENVIRONMENT"].sort());
  assert.equal(runnerSource.includes("fetch" + "("), false);
});

test("implementation contains no callable publication endpoint or credential material", () => {
  const implementation = `${moduleSource}\n${dryRunSource}\n${runnerSource}`;
  assert.doesNotMatch(implementation, /https?:\/\/api\.ebay\.com/i);
  assert.doesNotMatch(implementation, /\/sell\/inventory\/v1\/offer\/.+publish/i);
  assert.doesNotMatch(implementation, /publishOfferByInventoryItemGroup\s*\(/i);
  const combined = `${fixtureSource}\n${implementation}\n${docSource}`;
  for (const marker of ["access" + "_token", "refresh" + "_token", "client" + "_secret"]) assert.equal(combined.toLowerCase().includes(marker), false);
  assert.doesNotMatch(combined, /streetAddress\s*[:=]|addressLine|fullAddress/i);
  assert.doesNotMatch(combined, /\.(png|jpe?g|webp)\b/i);
  for (const marker of ["AMAZON_LISTING_" + "PACKAGE_BUILDER", "ebay-sandbox-" + "draft-listing", "EBAY_SANDBOX_" + "DRAFT_LISTING"]) assert.equal(combined.includes(marker), false);
});
