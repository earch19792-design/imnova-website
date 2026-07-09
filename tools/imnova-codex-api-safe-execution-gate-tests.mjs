import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/imnova-codex-api-safe-execution-gate-v1.json";
const modulePath =
  "lib/imnova/imnova-codex-api-safe-execution-gate.ts";
const componentPath =
  "components/imnova/codex-safe-execution-gate.tsx";
const pagePath =
  "app/admin/self-improvement/codex-gate/page.tsx";
const cliPath =
  "tools/imnova-codex-api-safe-execution-gate-dry-run.mjs";
const docPath =
  "docs/marketplace-isolation/IMNOVA_CODEX_API_SAFE_EXECUTION_GATE_V1.md";

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
  const gateModule =
    await import(`../${modulePath}`);
  const queue =
    gateModule.buildCodexSafeExecutionGateQueue(fixture);

  return {
    fixture,
    gateModule,
    queue,
    summary:
      gateModule.summarizeCodexSafeExecutionGateQueue(
        queue,
        fixture,
      ),
  };
}

test("fixture locks Codex safe execution gate boundaries", () => {
  const fixture =
    readJson(fixturePath);

  assert.equal(fixture.codexGateVersion, "IMNOVA_CODEX_API_SAFE_EXECUTION_GATE_V1");
  assert.equal(fixture.status, "CODEX_API_SAFE_EXECUTION_GATE_READY");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_CODEX_GATE_ONLY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.main.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.codexApi.usedInThisLoop, false);
  assert.equal(fixture.openAiApi.usedInThisLoop, false);
  assert.equal(fixture.externalNetworkCall.executedInThisLoop, false);
  assert.equal(fixture.automaticCodeChanges.executedInThisLoop, false);
  assert.equal(fixture.branchCreation.executedInThisLoop, false);
  assert.equal(fixture.pullRequestCreation.executedInThisLoop, false);
  assert.equal(fixture.merge.executedInThisLoop, false);
  assert.equal(fixture.tokenStorage.executedInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.whatsapp.realSendUsedInThisLoop, false);
  assert.equal(fixture.scraper.usedInThisLoop, false);
});

test("builds execution plans and required gate outcomes", async () => {
  const { queue, summary } =
    await buildQueue();

  assert.equal(summary.codexGateBuilt, true);
  assert.equal(summary.workOrdersEvaluated >= 4, true);
  assert.equal(summary.executionPlansBuilt >= 4, true);
  assert.equal(summary.approvedForDryRunPreview >= 1, true);
  assert.equal(summary.blockedMissingHumanApproval >= 1, true);
  assert.equal(summary.blockedSecretDetected >= 1, true);
  assert.equal(summary.blockedHighRisk >= 1, true);
  assert.equal(summary.promptsSanitized, true);
  assert.equal(summary.secretsDetected, true);
  assert.equal(summary.redactionCount >= 1, true);
  assert.equal(summary.humanApprovalRequired, true);
  assert.equal(summary.realCodexApiCallExecuted, false);
  assert.equal(summary.openAiApiUsed, false);
  assert.equal(summary.externalNetworkCallExecuted, false);
  assert.equal(summary.automaticCodeChangesExecuted, false);
  assert.equal(summary.branchCreationExecuted, false);
  assert.equal(summary.pullRequestCreationExecuted, false);
  assert.equal(summary.mergeExecuted, false);
  assert.equal(summary.productionTouched, false);
  assert.equal(summary.mainTouched, false);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.tokenStored, false);
  assert.equal(summary.nextLoop, "149G");
  assert.equal(summary.futureLoop, "149CODEX-C");

  const decisions =
    queue.map(item => item.executionDecision);

  assert.equal(decisions.includes("APPROVED_FOR_LOCAL_DRY_RUN_PREVIEW"), true);
  assert.equal(decisions.includes("BLOCKED_MISSING_HUMAN_APPROVAL"), true);
  assert.equal(decisions.includes("BLOCKED_SECRET_DETECTED"), true);
  assert.equal(decisions.includes("BLOCKED_HIGH_RISK"), true);
});

test("plans never allow real execution actions", async () => {
  const { queue } =
    await buildQueue();

  for (const item of queue) {
    const plan =
      item.executionPlan;

    assert.equal(plan.canCallCodexApi, false);
    assert.equal(plan.canCreateBranch, false);
    assert.equal(plan.canCreatePr, false);
    assert.equal(plan.canMerge, false);
    assert.equal(plan.canTouchProduction, false);
    assert.equal(plan.canTouchMain, false);
    assert.equal(item.dryRunPreview.wouldCallCodexApi, false);
    assert.equal(item.dryRunPreview.wouldCreateBranch, false);
    assert.equal(item.dryRunPreview.wouldCreatePr, false);
    assert.equal(item.dryRunPreview.wouldMerge, false);
    assert.equal(item.unsafeExecutionBlock.canExecuteCodeChange, false);
    assert.equal(plan.prohibitedActions.includes("CALL_CODEX_API"), true);
    assert.equal(plan.prohibitedActions.includes("CALL_OPENAI_API"), true);
    assert.equal(plan.prohibitedActions.includes("EXECUTE_CODE_CHANGE"), true);
    assert.equal(plan.prohibitedActions.includes("CREATE_BRANCH"), true);
    assert.equal(plan.prohibitedActions.includes("CREATE_PR"), true);
    assert.equal(plan.prohibitedActions.includes("MERGE_PR"), true);
  }
});

test("sanitizer redacts unsafe samples and blocks permission", async () => {
  const { gateModule, queue } =
    await buildQueue();
  const unsafePrompt =
    [
      "sample",
      ["s", "k-"].join("") + "unsafeexample",
      ["OPENAI", "_API_KEY"].join("") + "=unsafe",
      ["CODEX", "_API_KEY"].join("") + "=unsafe",
      ["access", "_token"].join("") + "=unsafe",
      ["refresh", "_token"].join("") + "=unsafe",
      ["client", "_secret"].join("") + "=unsafe",
      "authorization code=unsafe",
      "bearer token=unsafe",
      ".env SECRET_VALUE=unsafe",
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFG",
    ].join("\n");

  const result =
    gateModule.sanitizeCodexExecutionPayload(unsafePrompt);

  assert.equal(result.secretsDetected, true);
  assert.equal(result.redactionCount >= 9, true);
  assert.equal(result.sanitizedText.includes("[REDACTED_SECRET]"), true);
  assert.equal(result.sanitizedText.includes("unsafeexample"), false);

  const secretPlan =
    queue.find(item => item.executionDecision === "BLOCKED_SECRET_DETECTED");

  assert.ok(secretPlan);
  assert.equal(secretPlan.executionPlan.canExecuteDryRun, false);
  assert.equal(secretPlan.executionPlan.sanitizedPromptPreview.includes("demo_value_should_be_redacted"), false);
});

test("UI route, component, CLI, and docs exist", async () => {
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

  assert.equal(summary.codexGateBuilt, true);
  assert.equal(summary.uiRoute, "/admin/self-improvement/codex-gate");

  for (const path of [
    componentPath,
    pagePath,
    cliPath,
    docPath,
  ]) {
    assert.equal(fileExists(path), true);
  }

  assert.equal(readText(componentPath).includes("export function CodexSafeExecutionGate"), true);
  assert.equal(readText(pagePath).includes("/admin/self-improvement/codex-gate") || readText(pagePath).includes("Codex Safe Execution Gate"), true);
});

test("module, component, and CLI avoid real integrations and writes", () => {
  for (const path of [
    modulePath,
    componentPath,
    cliPath,
  ]) {
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
    ];

    for (const pattern of forbiddenPatterns) {
      assert.equal(source.includes(pattern), false, `${path} contains ${pattern}`);
    }
  }
});

test("checklist exists", async () => {
  const { gateModule } =
    await buildQueue();
  const checklist =
    gateModule.getCodexApiSafeExecutionGateChecklist();

  assert.equal(Array.isArray(checklist), true);
  assert.equal(checklist.length >= 5, true);
});
