import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/imnova-self-improvement-codex-handoff-v1.json";
const modulePath =
  "lib/imnova/imnova-self-improvement-codex-handoff.ts";
const backlogComponentPath =
  "components/imnova/self-improvement-backlog.tsx";
const handoffComponentPath =
  "components/imnova/codex-handoff-preview.tsx";
const cliPath =
  "tools/imnova-self-improvement-codex-handoff-dry-run.mjs";
const pagePath =
  "app/admin/self-improvement/page.tsx";
const sidebarPath =
  "app/admin/sidebar.tsx";
const docPath =
  "docs/marketplace-isolation/IMNOVA_SELF_IMPROVEMENT_CODEX_HANDOFF_V1.md";

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
  const handoffModule =
    await import(`../${modulePath}`);
  const queue =
    handoffModule.buildCodexHandoffQueue(fixture);

  return {
    fixture,
    handoffModule,
    queue,
    summary:
      handoffModule.summarizeCodexHandoffQueue(queue),
  };
}

test("fixture locks local read-only self-improvement boundaries", () => {
  const fixture =
    readJson(fixturePath);

  assert.equal(fixture.selfImprovementVersion, "IMNOVA_SELF_IMPROVEMENT_CODEX_HANDOFF_V1");
  assert.equal(fixture.status, "SELF_IMPROVEMENT_CODEX_HANDOFF_READY");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_HANDOFF_ONLY");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.codexApi.usedInThisLoop, false);
  assert.equal(fixture.openAiApi.usedInThisLoop, false);
  assert.equal(fixture.automaticCodeChanges.executedInThisLoop, false);
  assert.equal(fixture.branchCreation.executedInThisLoop, false);
  assert.equal(fixture.pullRequestCreation.executedInThisLoop, false);
  assert.equal(fixture.merge.executedInThisLoop, false);
  assert.equal(fixture.amazonApi.usedInThisLoop, false);
  assert.equal(fixture.spApi.usedInThisLoop, false);
  assert.equal(fixture.sellerCentral.writeExecutedInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.whatsapp.realSendUsedInThisLoop, false);
  assert.equal(fixture.scraper.usedInThisLoop, false);
});

test("builds backlog, work orders, and manual handoff prompts", async () => {
  const { queue, summary } =
    await buildQueue();

  assert.equal(summary.selfImprovementBacklogBuilt, true);
  assert.equal(summary.backlogItemsBuilt >= 4, true);
  assert.equal(summary.codexWorkOrdersBuilt >= 4, true);
  assert.equal(summary.codexHandoffPromptsBuilt >= 4, true);
  assert.equal(summary.promptsSanitized, true);
  assert.equal(summary.secretsDetected, false);
  assert.equal(summary.manualHandoffOnly, true);
  assert.equal(summary.humanApprovalRequired, true);
  assert.equal(summary.codexApiUsed, false);
  assert.equal(summary.openAiApiUsed, false);
  assert.equal(summary.automaticCodeChangesExecuted, false);
  assert.equal(summary.branchCreationExecuted, false);
  assert.equal(summary.pullRequestCreationExecuted, false);
  assert.equal(summary.mergeExecuted, false);
  assert.equal(summary.nextLoop, "149CODEX-B");
  assert.equal(summary.thenNextAmazonLoop, "149G");

  for (const item of queue) {
    assert.equal(item.manualHandoffOnly, true);
    assert.equal(item.humanApprovalRequired, true);
    assert.equal(item.canSendToCodex, false);
    assert.equal(item.workOrder.branchName.length > 0, true);
    assert.equal(item.workOrder.testsToRun.length > 0, true);
    assert.equal(item.workOrder.safetyBoundaries.length > 0, true);
    assert.equal(item.workOrder.definitionOfDone.length > 0, true);
    assert.equal(item.workOrder.prohibitedCommands.includes("/review"), true);
    assert.equal(item.workOrder.prohibitedCommands.includes("Summarize recent commits"), true);
    assert.equal(item.workOrder.prohibitedCommands.includes("Write tests for @filename"), true);
    assert.equal(item.handoffPrompt.includes("[REDACTED_SECRET]"), false);
  }
});

test("sanitizer redacts secrets in a negative prompt sample", async () => {
  const { handoffModule } =
    await buildQueue();
  const unsafePrompt =
    [
      "token sample",
      ["s", "k-"].join("") + "unsafeexample",
      ["OPENAI", "_API_KEY"].join("") + "=unsafe",
      ["CODEX", "_API_KEY"].join("") + "=unsafe",
      ["access", "_token"].join("") + "=unsafe",
      ["refresh", "_token"].join("") + "=unsafe",
      ["client", "_secret"].join("") + "=unsafe",
      "auth code=unsafe",
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFG",
    ].join("\n");

  const result =
    handoffModule.sanitizeCodexHandoffPrompt(unsafePrompt);

  assert.equal(result.secretsDetected, true);
  assert.equal(result.redactionsApplied >= 7, true);
  assert.equal(result.prompt.includes("[REDACTED_SECRET]"), true);
  assert.equal(result.prompt.includes("unsafeexample"), false);
});

test("UI route, components, CLI, and docs exist", async () => {
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

  assert.equal(summary.selfImprovementBacklogBuilt, true);
  assert.equal(summary.uiRoute, "/admin/self-improvement");

  for (const path of [
    backlogComponentPath,
    handoffComponentPath,
    cliPath,
    pagePath,
    sidebarPath,
    docPath,
  ]) {
    assert.equal(fileExists(path), true);
  }

  assert.equal(readText(backlogComponentPath).includes("export function SelfImprovementBacklog"), true);
  assert.equal(readText(handoffComponentPath).includes("export function CodexHandoffPreview"), true);
  assert.equal(readText(pagePath).includes("/admin/self-improvement") || readText(pagePath).includes("IMNOVA Self-Improvement"), true);
  assert.equal(readText(sidebarPath).includes("/admin/self-improvement"), true);
  assert.equal(readText(sidebarPath).includes("Codex Handoff"), true);
});

test("module, components, and CLI avoid real integrations and writes", () => {
  for (const path of [
    modulePath,
    backlogComponentPath,
    handoffComponentPath,
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
      ["new ", "OpenAI"].join(""),
      ["api.openai", ".com"].join(""),
    ];

    for (const pattern of forbiddenPatterns) {
      assert.equal(source.includes(pattern), false, `${path} contains ${pattern}`);
    }
  }
});

test("checklist exists", async () => {
  const { handoffModule } =
    await buildQueue();
  const checklist =
    handoffModule.getSelfImprovementCodexHandoffChecklist();

  assert.equal(Array.isArray(checklist), true);
  assert.equal(checklist.length >= 5, true);
});
