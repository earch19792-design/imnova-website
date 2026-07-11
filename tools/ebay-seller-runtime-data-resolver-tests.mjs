import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildEbaySellerRuntimeDataResolverInput,
  buildEbaySellerRuntimeDataResolverReport,
  buildSellerRuntimeDataChecklist,
  buildSellerRuntimeDataResolverRouteRecommendation,
  buildSellerRuntimeReadinessGate,
  buildRuntimeTokenPresenceAssessment,
} from "../lib/ebay/ebay-seller-runtime-data-resolver.ts";

const fixturePath = "tools/fixtures/ebay-seller-runtime-data-resolver-v1.json";
const modulePath = "lib/ebay/ebay-seller-runtime-data-resolver.ts";
const dryRunPath = "tools/ebay-seller-runtime-data-resolver-dry-run.mjs";
const runnerPath = "tools/ebay-seller-runtime-data-resolver-runner.mjs";
const docPath = "docs/ebay-pro-isolation/EBAY_SELLER_RUNTIME_DATA_RESOLVER_B2_RUN_V1.md";
const fixtureSource = readFileSync(fixturePath, "utf8");
const moduleSource = readFileSync(modulePath, "utf8");
const dryRunSource = readFileSync(dryRunPath, "utf8");
const runnerSource = readFileSync(runnerPath, "utf8");
const docSource = readFileSync(docPath, "utf8");
const fixture = JSON.parse(fixtureSource);

function resolved(overrides = {}) {
  return {
    categoryIdResolved: true, fulfillmentPolicyResolved: true, returnPolicyResolved: true, paymentPolicyResolved: true,
    finalStockResolved: true, finalPriceResolved: true, finalImageResolved: true,
    targetEnvironmentResolved: true, targetEnvironment: "SANDBOX",
    tokenPresenceChecked: true, tokenPresentBooleanOnly: true, ...overrides,
  };
}

test("fixture declares safe runtime resolver contract", () => {
  assert.equal(fixture.version, "EBAY_SELLER_RUNTIME_DATA_RESOLVER_B2_RUN_V1");
  assert.equal(fixture.status, "READY");
  assert.equal(fixture.resolverModes.default, "SAFE_NO_RUNTIME_READ");
  assert.equal(fixture.selectedProduct.canPublish, false);
  assert.equal(fixture.safetyFlags.noEbayWrites, true);
  assert.equal(fixture.safetyFlags.publishOfferForbidden, true);
});

test("default builds eight-item checklist and category blocks first", () => {
  const input = buildEbaySellerRuntimeDataResolverInput(fixture);
  const checklist = buildSellerRuntimeDataChecklist(input);
  assert.equal(checklist.runtimeDataRequiredCount, 8);
  assert.equal(checklist.runtimeDataResolvedCount, 0);
  assert.equal(checklist.runtimeDataAllResolved, false);
  assert.equal(buildSellerRuntimeDataResolverRouteRecommendation(input).nextRecommendedRoute, "NEED_CATEGORY_RUNTIME_CONFIRMATION");
});

test("each runtime data family is independently required", () => {
  const cases = [
    ["categoryIdResolved", "NEED_CATEGORY_RUNTIME_CONFIRMATION"],
    ["fulfillmentPolicyResolved", "NEED_SELLER_POLICY_RUNTIME_CONFIRMATION"],
    ["returnPolicyResolved", "NEED_SELLER_POLICY_RUNTIME_CONFIRMATION"],
    ["paymentPolicyResolved", "NEED_SELLER_POLICY_RUNTIME_CONFIRMATION"],
    ["finalStockResolved", "NEED_FINAL_STOCK_REVIEW"],
    ["finalPriceResolved", "NEED_FINAL_PRICE_REVIEW"],
    ["finalImageResolved", "NEED_FINAL_IMAGE_ASSET"],
    ["targetEnvironmentResolved", "NEED_RUNTIME_ENVIRONMENT"],
  ];
  for (const [key, route] of cases) {
    const input = buildEbaySellerRuntimeDataResolverInput(fixture, resolved({ [key]: false }));
    assert.equal(buildSellerRuntimeDataChecklist(input).runtimeDataAllResolved, false, key);
    assert.equal(buildSellerRuntimeDataResolverRouteRecommendation(input).nextRecommendedRoute, route, key);
  }
});

test("zero stock and zero price block readiness", () => {
  for (const simulation of [resolved({ simulatedStock: 0 }), resolved({ simulatedPrice: 0 })]) {
    const input = buildEbaySellerRuntimeDataResolverInput(fixture, simulation);
    assert.equal(buildSellerRuntimeReadinessGate(input).controlledWriteRunReady, false);
  }
});

test("complete simulation resolves 8/8 plus token without enabling write", () => {
  const report = buildEbaySellerRuntimeDataResolverReport(fixture, resolved());
  assert.equal(report.runtimeDataResolvedCount, 8);
  assert.equal(report.runtimeDataAllResolved, true);
  assert.equal(report.tokenPresenceChecked, true);
  assert.equal(report.tokenPresentBooleanOnly, true);
  assert.equal(report.controlledWriteRunReady, true);
  assert.equal(report.nextRecommendedRoute, "READY_FOR_CONTROLLED_DRAFT_ONLY_REAL_RUN");
  assert.equal(report.canExecuteEbayWrite, false);
  assert.equal(report.canPublish, false);
});

test("token presence is boolean-only and required separately from 8/8", () => {
  const input = buildEbaySellerRuntimeDataResolverInput(fixture, resolved({ tokenPresentBooleanOnly: false }));
  const token = buildRuntimeTokenPresenceAssessment(input), readiness = buildSellerRuntimeReadinessGate(input);
  assert.equal(token.tokenPresenceChecked, true);
  assert.equal(token.tokenPresentBooleanOnly, false);
  assert.equal(token.tokenStored, false);
  assert.equal(token.tokenPrinted, false);
  assert.equal(readiness.runtimeDataAllResolved, true);
  assert.equal(readiness.controlledWriteRunReady, false);
});

test("forbidden write actions never appear in allowed loop actions", () => {
  assert.equal(fixture.forbiddenActions.includes("publishOffer"), true);
  assert.equal(fixture.allowedInThisLoop.some((action) => /create|publish|revise/i.test(action)), false);
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

test("dry-run supports default, resolved, missing policy, missing image, and token-only", async () => {
  const initial = await runCli(dryRunPath);
  const complete = await runCli(dryRunPath, ["--simulate-runtime-data-resolved"]);
  const policy = await runCli(dryRunPath, ["--simulate-missing-policy"]);
  const image = await runCli(dryRunPath, ["--simulate-missing-image"]);
  const token = await runCli(dryRunPath, ["--simulate-runtime-token-present"]);
  assert.equal(initial.runtimeDataResolvedCount, 0);
  assert.equal(initial.nextRecommendedRoute, "NEED_CATEGORY_RUNTIME_CONFIRMATION");
  assert.equal(complete.runtimeDataResolvedCount, 8);
  assert.equal(complete.nextRecommendedRoute, "READY_FOR_CONTROLLED_DRAFT_ONLY_REAL_RUN");
  assert.equal(policy.nextRecommendedRoute, "NEED_SELLER_POLICY_RUNTIME_CONFIRMATION");
  assert.equal(image.nextRecommendedRoute, "NEED_FINAL_IMAGE_ASSET");
  assert.equal(token.tokenPresentBooleanOnly, true);
  for (const report of [initial, complete, policy, image, token]) { assert.equal(report.canExecuteEbayWrite, false); assert.equal(report.canPublish, false); assert.equal(report.tokenStored, false); assert.equal(report.tokenPrinted, false); }
});

test("runner default performs no runtime read and optional check returns booleans only", async () => {
  const initial = await runCli(runnerPath);
  assert.equal(initial.mode, "SAFE_NO_RUNTIME_READ");
  assert.equal(initial.tokenPresenceChecked, false);
  assert.equal(initial.nextRecommendedRoute, "SAFE_NO_RUNTIME_READ");
  const checked = await runCli(runnerPath, ["--check-runtime-presence-readonly"], {
    EBAY_ACCESS_TOKEN: "IN_MEMORY_TEST_VALUE", EBAY_ENVIRONMENT: "SANDBOX",
    EBAY_RUNTIME_RESOLVER_READONLY_APPROVED: fixture.exactOptionalReadOnlyApproval.EBAY_RUNTIME_RESOLVER_READONLY_APPROVED,
  });
  assert.equal(checked.tokenPresenceChecked, true);
  assert.equal(checked.tokenPresentBooleanOnly, true);
  assert.equal(JSON.stringify(checked).includes("IN_MEMORY_TEST_VALUE"), false);
  assert.equal(checked.realEbayApiUsed, false);
  assert.equal(checked.ebayWriteApiUsed, false);
});

test("pure module and dry-run have no environment, network, DB, or filesystem writes", () => {
  for (const marker of ["process" + ".env", "fetch" + "(", "create" + "Client", ".fr" + "om(", ".ins" + "ert(", ".upd" + "ate(", ".ups" + "ert(", "write" + "File", "append" + "File"]) {
    assert.equal(moduleSource.includes(marker), false, marker);
    assert.equal(dryRunSource.includes(marker), false, marker);
  }
  assert.equal(runnerSource.includes("fetch" + "("), false);
  assert.match(runnerSource, /\["EBAY", "ACCESS", "TOKEN"\]\.join/);
  assert.match(runnerSource, /\["EBAY", "ENVIRONMENT"\]\.join/);
});

test("files contain no endpoint, credential material, image, address, or paused track", () => {
  const implementation = `${moduleSource}\n${dryRunSource}\n${runnerSource}`;
  assert.doesNotMatch(implementation, /https?:\/\/api\.ebay\.com/i);
  assert.doesNotMatch(implementation, /\/sell\/.+publish/i);
  const combined = `${fixtureSource}\n${implementation}\n${docSource}`;
  for (const marker of ["refresh" + "_token", "client" + "_secret", "service" + "_role"]) assert.equal(combined.toLowerCase().includes(marker), false);
  assert.doesNotMatch(combined, /streetAddress\s*[:=]|addressLine|fullAddress/i);
  assert.doesNotMatch(combined, /\.(png|jpe?g|webp)\b/i);
  for (const marker of ["AMAZON_LISTING_" + "PACKAGE_BUILDER", "ebay-sandbox-" + "draft-listing", "EBAY_SANDBOX_" + "DRAFT_LISTING"]) assert.equal(combined.includes(marker), false);
});

test("all resolver modes preserve permanent safety boundaries", () => {
  for (const simulation of [{}, resolved(), resolved({ fulfillmentPolicyResolved: false }), resolved({ finalImageResolved: false }), { tokenPresenceChecked: true, tokenPresentBooleanOnly: true }]) {
    const report = buildEbaySellerRuntimeDataResolverReport(fixture, simulation);
    for (const key of ["canExecuteEbayWrite", "canPublish", "tokenStored", "tokenPrinted", "realEbayApiUsed", "ebayWriteApiUsed", "oauthUsedInThisLoop", "tokenExchangeExecuted", "draftCreated", "inventoryItemCreated", "offerCreated", "listingCreated", "publicationExecuted", "productionWriteTouched", "mainTouched", "stagingWriteExecuted", "supabaseWriteExecuted", "imageGenerationUsed", "imageDownloadUsed", "imageCopyAllowed", "scraperUsed", "amazonTrackTouched", "whatsappRealSendUsed", "smsRealSendUsed", "openAiUsed", "fullWarehouseStreetAddressCommitted"]) assert.equal(report[key], false, key);
  }
});
