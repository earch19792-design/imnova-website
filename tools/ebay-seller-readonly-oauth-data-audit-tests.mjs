import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/ebay-seller-readonly-oauth-data-audit-v1.json";
const modulePath =
  "lib/ebay/ebay-seller-readonly-oauth-data-audit.ts";
const dryRunPath =
  "tools/ebay-seller-readonly-oauth-data-audit-dry-run.mjs";
const runnerPath =
  "tools/ebay-seller-readonly-oauth-data-audit-runner.mjs";
const docPath =
  "docs/ebay-pro-isolation/EBAY_SELLER_READONLY_OAUTH_DATA_AUDIT_RESUME_A3_V1.md";

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

async function buildReport(entry, fixtureOverrides = {}) {
  const auditModule =
    await import(`../${modulePath}`);
  const fixture =
    {
      sellerAccountTypeCurrent: "PERSONAL",
      plannedFutureSellerAccountType: "BUSINESS",
      plannedBusinessConversionWindowDays: 15,
      targetMarketplace: "EBAY_US",
      ...fixtureOverrides,
    };

  return {
    auditModule,
    report:
      auditModule.buildEbaySellerReadOnlyOauthDataAuditReport(entry, fixture),
  };
}

test("fixture locks EBAY-RESUME-A3 safety boundaries", () => {
  const fixture =
    readJson(fixturePath);

  assert.equal(fixture.auditVersion, "EBAY_SELLER_READONLY_OAUTH_DATA_AUDIT_RESUME_A3_V1");
  assert.equal(fixture.status, "EBAY_SELLER_READONLY_OAUTH_DATA_AUDIT_READY");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_AND_OPTIONAL_GATED_READONLY_OAUTH_AUDIT");
  assert.equal(fixture.production.offLimitsForWrites, true);
  assert.equal(fixture.main.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.ebayApi.writeUsedInThisLoop, false);
  assert.equal(fixture.ebayProductionApi.writeUsedInThisLoop, false);
  assert.equal(fixture.oauth.accessTokenStoredInThisLoop, false);
  assert.equal(fixture.oauth.refreshTokenStoredInThisLoop, false);
  assert.equal(fixture.oauth.clientSecretStoredInThisLoop, false);
  assert.equal(fixture.draft.createdInThisLoop, false);
  assert.equal(fixture.listing.createdInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.amazonTrack.touchedInThisLoop, false);
});

test("dry-run fixture builds report without API or token exchange", async () => {
  const fixture =
    readJson(fixturePath);
  const { auditModule, report } =
    await buildReport(fixture.dryRunAuditInput, fixture);

  assert.equal(report.auditReportBuilt, true);
  assert.equal(report.auditScore >= 0, true);
  assert.equal(report.auditScore <= 100, true);
  assert.equal(report.oauthGateReady, true);
  assert.equal(report.readOnlyScopesReady, true);
  assert.equal(report.canPublish, false);
  assert.equal(report.requiresHumanApproval, true);
  assert.equal(report.ebayReadOnlyApiUsed, false);
  assert.equal(report.ebayWriteApiUsed, false);
  assert.equal(report.realTokenExchangeExecuted, false);
  assert.equal(report.accessTokenStored, false);
  assert.equal(report.refreshTokenStored, false);
  assert.equal(report.clientSecretStored, false);
  assert.equal(report.tokensPrinted, false);
  assert.equal(report.amazonTrackTouched, false);
  assert.equal(["NEED_MORE_OAUTH_AUDIT_DATA", "EBAY-RESUME-A4"].includes(report.nextRecommendedRoute), true);
  assert.equal(auditModule.getEbaySellerReadOnlyOauthDataAuditChecklist().length > 0, true);
});

test("runner default mode does not execute token exchange or API", () => {
  assert.equal(readText(runnerPath).includes("safe-default"), true);
  assert.equal(readText(runnerPath).includes("No OAuth real token exchange was executed."), true);
  assert.equal(readText(runnerPath).includes("realTokenExchangeExecuted"), true);
  assert.equal(readText(runnerPath).includes("ebayWriteApiUsed"), true);
});

test("runner real mode requires env approval before any token exchange", () => {
  const runnerText =
    readText(runnerPath);

  assert.equal(runnerText.includes("--execute-readonly-audit"), true);
  assert.equal(runnerText.includes("missing exact EBAY_READONLY_AUDIT_APPROVED approval"), true);
  assert.equal(runnerText.includes("missing exact CLI confirmation"), true);
  assert.equal(runnerText.includes("realTokenExchangeExecuted"), true);
  assert.equal(runnerText.includes("accessTokenStored"), true);
  assert.equal(runnerText.includes("tokensPrinted"), true);
});

test("write scopes are rejected", async () => {
  const { report } =
    await buildReport({
      developerAccountCreated: "confirmed",
      developerApplicationCreated: "confirmed",
      productionKeysAvailable: "available",
      redirectUriConfigured: "configured",
      sellerPersonalAccountCreated: "confirmed",
      sellerHubAccessible: "confirmed",
      humanApprovalForReadOnlyOauthAudit: true,
      oauthEnvironment: "PRODUCTION",
      requestedScopes: [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.account",
      ],
      oauthAuthorizationSucceeded: true,
    });

  assert.equal(report.readOnlyScopesReady, false);
  assert.equal(report.blockers.some(blocker => blocker.includes("Write scopes")), true);
  assert.equal(report.nextRecommendedRoute, "NEED_MORE_OAUTH_AUDIT_DATA");
});

test("missing policies recommend A4 or more audit data", async () => {
  const { report } =
    await buildReport({
      developerAccountCreated: "confirmed",
      developerApplicationCreated: "confirmed",
      productionKeysAvailable: "available",
      redirectUriConfigured: "configured",
      sellerPersonalAccountCreated: "confirmed",
      sellerHubAccessible: "confirmed",
      humanApprovalForReadOnlyOauthAudit: true,
      sellerAuthorizationStatus: "confirmed",
      oauthEnvironment: "PRODUCTION",
      oauthAuthorizationSucceeded: true,
      fulfillmentPoliciesCount: 0,
      returnPoliciesCount: 0,
      paymentPoliciesCount: 0,
      inventoryLocationsCount: 0,
      accountRiskStatus: "confirmed",
    });

  assert.equal(report.businessPoliciesReadable, false);
  assert.equal(report.missingPolicyTypes.length, 3);
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-A4");
  assert.equal(report.canPublish, false);
});

test("complete policies can recommend B or C while publishing remains blocked", async () => {
  const { report } =
    await buildReport({
      developerAccountCreated: "confirmed",
      developerApplicationCreated: "confirmed",
      productionKeysAvailable: "available",
      redirectUriConfigured: "configured",
      sellerPersonalAccountCreated: "confirmed",
      sellerHubAccessible: "confirmed",
      humanApprovalForReadOnlyOauthAudit: true,
      sellerAuthorizationStatus: "confirmed",
      oauthEnvironment: "PRODUCTION",
      oauthAuthorizationSucceeded: true,
      fulfillmentPoliciesCount: 2,
      returnPoliciesCount: 1,
      paymentPoliciesCount: 1,
      inventoryLocationsCount: 1,
      accountRiskStatus: "confirmed",
      manualSellerHubDataStatus: "confirmed",
    });

  assert.equal(["EBAY-RESUME-B", "EBAY-RESUME-C"].includes(report.nextRecommendedRoute), true);
  assert.equal(report.canProceedToSandboxDraft, true);
  assert.equal(report.canPublish, false);
});

test("suspension or account risk recommends HOLD", async () => {
  const { report } =
    await buildReport({
      developerAccountCreated: "confirmed",
      developerApplicationCreated: "confirmed",
      productionKeysAvailable: "available",
      redirectUriConfigured: "configured",
      sellerPersonalAccountCreated: "confirmed",
      sellerHubAccessible: "confirmed",
      humanApprovalForReadOnlyOauthAudit: true,
      sellerAuthorizationStatus: "confirmed",
      oauthEnvironment: "PRODUCTION",
      accountRiskStatus: "blocked",
      oauthAuthorizationSucceeded: true,
    });

  assert.equal(report.accountRiskLevel, "HIGH");
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-HOLD");
  assert.equal(report.canPublish, false);
});

test("CLI dry-run executes and prints expected numeric summary", async () => {
  let output =
    "";
  const originalLog =
    console.log;

  console.log =
    value => {
      output += `${value}`;
    };

  try {
    await import(`../${dryRunPath}?testRun=${Date.now()}`);
  } finally {
    console.log =
      originalLog;
  }

  const summary =
    JSON.parse(output);

  assert.equal(summary.auditReportBuilt, true);
  assert.equal(typeof summary.auditScore, "number");
  assert.equal(typeof summary.fulfillmentPoliciesCount, "number");
  assert.equal(typeof summary.returnPoliciesCount, "number");
  assert.equal(typeof summary.paymentPoliciesCount, "number");
  assert.equal(typeof summary.inventoryLocationsCount, "number");
  assert.equal(summary.canPublish, false);
  assert.equal(summary.ebayReadOnlyApiUsed, false);
  assert.equal(summary.ebayWriteApiUsed, false);
  assert.equal(summary.realTokenExchangeExecuted, false);
  assert.equal(summary.accessTokenStored, false);
  assert.equal(summary.refreshTokenStored, false);
  assert.equal(summary.clientSecretStored, false);
  assert.equal(summary.tokensPrinted, false);
});

test("static guardrails for module, dry-run, runner, and docs", () => {
  const moduleText =
    readText(modulePath);
  const dryRunText =
    readText(dryRunPath);
  const runnerText =
    readText(runnerPath);

  assert.equal(fileExists(docPath), true);
  assert.equal(moduleText.includes("process.env"), false);
  assert.equal(moduleText.includes("fetch("), false);
  assert.equal(dryRunText.includes("process.env"), false);
  assert.equal(dryRunText.includes("fetch("), false);

  for (const text of [moduleText, dryRunText, runnerText]) {
    assert.equal(text.includes("createClient"), false);
    assert.equal(text.includes(".from("), false);
    assert.equal(text.includes(".insert("), false);
    assert.equal(text.includes(".update("), false);
    assert.equal(text.includes(".upsert("), false);
    assert.equal(text.includes("writeFile"), false);
    assert.equal(text.includes("appendFile"), false);
    assert.equal(text.includes("createWriteStream"), false);
  }

  assert.equal(runnerText.includes("process.env"), true);
  assert.equal(runnerText.includes("fetch("), true);
  assert.equal(runnerText.includes("POST"), true);
  assert.equal(runnerText.includes("GET"), true);
  assert.equal(runnerText.includes("inventory_item"), false);
  assert.equal(runnerText.includes("offer"), false);
  assert.equal(runnerText.includes("publish"), false);
  assert.equal(runnerText.includes("bulk_create"), false);
  assert.equal(runnerText.includes("bulk_update"), false);
  assert.equal(runnerText.includes("sell.account\""), false);
  assert.equal(runnerText.includes("sell.inventory\""), false);
});
