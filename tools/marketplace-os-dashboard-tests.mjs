import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const viewModelPath =
  "lib/marketplace/marketplace-os-dashboard-view-model.ts";
const dashboardComponentPath =
  "components/marketplace/marketplace-os-dashboard.tsx";
const decisionCenterComponentPath =
  "components/marketplace/amazon-decision-center.tsx";
const cliPath =
  "tools/marketplace-os-dashboard-dry-run.mjs";
const pagePath =
  "app/admin/marketplace-os/page.tsx";
const docPath =
  "docs/marketplace-isolation/IMNOVA_MARKETPLACE_OS_DASHBOARD_AMAZON_DECISION_CENTER_V1.md";

function readText(path) {
  return readFileSync(path, "utf8");
}

function fileExists(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

async function buildDashboard() {
  const dashboardModule =
    await import(`../${viewModelPath}`);
  const viewModel =
    dashboardModule.buildMarketplaceOsDashboardViewModel();

  return {
    dashboardModule,
    viewModel,
    summary:
      dashboardModule.summarizeMarketplaceOsDashboard(viewModel),
  };
}

test("view model builds Marketplace OS dashboard status", async () => {
  const { viewModel } =
    await buildDashboard();

  assert.equal(typeof viewModel.dashboardVersion, "string");
  assert.equal(viewModel.dashboardVersion.length > 0, true);
  assert.equal(viewModel.ebayTrack.status, "PAUSED_YELLOW_OPERATIONAL");
  assert.equal(viewModel.amazonTrack.status, "ACTIVE_LOCAL_DECISION_ENGINE");
  assert.deepEqual(viewModel.amazonTrack.completedLoops, [
    "149A",
    "149B",
    "149C",
    "149D",
    "149E",
    "149F",
  ]);
  assert.equal(viewModel.amazonTrack.nextRecommendedLoop, "149G");
});

test("product rows include DM0628N and local Amazon decision state", async () => {
  const { viewModel } =
    await buildDashboard();
  const dm =
    viewModel.productRows.find(row => row.supplierSku === "luna-portex:first_real_mini_scan:dm0628n");

  assert.equal(viewModel.productRows.length >= 3, true);
  assert.ok(dm);
  assert.equal(dm.matchConfidenceScore, 97);
  assert.equal(dm.finalAsinRouteDecision, "WATCHLIST_EXISTING_ASIN");
  assert.equal(dm.canProceedToAmazonListingPackage, false);
  assert.equal(dm.published, false);
  assert.equal(dm.sellerCentralWriteReady, false);
});

test("dashboard summary prints expected local-only output", async () => {
  const { summary } =
    await buildDashboard();

  assert.equal(summary.dashboardBuilt, true);
  assert.equal(summary.ebayTrackStatus, "PAUSED_YELLOW_OPERATIONAL");
  assert.equal(summary.amazonTrackStatus, "ACTIVE_LOCAL_DECISION_ENGINE");
  assert.equal(summary.completedAmazonLoops, 6);
  assert.equal(summary.productRowsBuilt >= 3, true);
  assert.equal(summary.productsBlockedFromListingPackage, 3);
  assert.equal(summary.productsRequiringHumanReview, 3);
  assert.equal(summary.watchlistExistingAsinCandidates, 1);
  assert.equal(summary.rejectedCandidates, 1);
  assert.equal(summary.averageAsinDecisionScore, 22.33);
  assert.equal(summary.codexSelfImprovementRoadmapVisible, true);
  assert.equal(summary.codexApiUsed, false);
  assert.equal(summary.automaticCodeChangesExecuted, false);
  assert.equal(summary.humanApprovalRequiredForCodex, true);
  assert.equal(summary.recommendedStrategicNextStep, "149CODEX-A");
  assert.equal(summary.thenNextAmazonLoop, "149G");
  assert.equal(summary.nextRecommendedLoop, "149G");
  assert.equal(summary.uiRoute, "/admin/marketplace-os");
  assert.equal(summary.amazonApiUsed, false);
  assert.equal(summary.spApiUsed, false);
  assert.equal(summary.sellerCentralWriteExecuted, false);
  assert.equal(summary.asinCreationExecuted, false);
  assert.equal(summary.listingCreationExecuted, false);
  assert.equal(summary.publicationExecuted, false);
  assert.equal(summary.stagingWriteExecuted, false);
  assert.equal(summary.whatsappRealSendUsed, false);
  assert.equal(summary.openAiUsed, false);
  assert.equal(summary.scraperUsed, false);
  assert.equal(summary.nextLoop, "149G");
});

test("Codex Self-Improvement roadmap is visible and gated", async () => {
  const { viewModel, summary } =
    await buildDashboard();

  assert.equal(viewModel.codexSelfImprovement.status, "PLANNED_SAFE_HANDOFF_ONLY");
  assert.equal(viewModel.codexSelfImprovement.currentMode, "ROADMAP_ONLY_NO_API");
  assert.equal(viewModel.codexSelfImprovement.guardrails.noCodexApiUsed, true);
  assert.equal(viewModel.codexSelfImprovement.guardrails.noAutomaticCodeChanges, true);
  assert.equal(viewModel.codexSelfImprovement.guardrails.humanApprovalRequired, true);
  assert.equal(viewModel.recommendedStrategicNextStep, "149CODEX-A");
  assert.equal(viewModel.thenContinueToAmazonListingPackageBuilder, "149G");
  assert.equal(summary.codexSelfImprovementRoadmapVisible, true);
  assert.equal(summary.codexApiUsed, false);
  assert.equal(summary.automaticCodeChangesExecuted, false);
  assert.equal(summary.humanApprovalRequiredForCodex, true);
});

test("CLI dry-run executes and components/routes exist", async () => {
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

  assert.equal(summary.dashboardBuilt, true);
  assert.equal(typeof summary.productRowsBuilt, "number");

  for (const path of [
    dashboardComponentPath,
    decisionCenterComponentPath,
    pagePath,
    docPath,
  ]) {
    assert.equal(fileExists(path), true);
  }

  assert.equal(readText(dashboardComponentPath).includes("export function MarketplaceOsDashboard"), true);
  assert.equal(readText(decisionCenterComponentPath).includes("export function AmazonDecisionCenter"), true);
  assert.equal(readText(dashboardComponentPath).includes("Codex Roadmap"), true);
  assert.equal(readText(decisionCenterComponentPath).includes("Codex Self-Improvement"), true);
  assert.equal(readText(viewModelPath).includes("Codex Handoff"), true);
});

test("module, components, and CLI avoid integrations writes and sensitive calls", () => {
  for (const path of [
    viewModelPath,
    dashboardComponentPath,
    decisionCenterComponentPath,
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
      ["send", "WhatsApp"].join(""),
      ["send", "Whatsapp"].join(""),
      ["OPENAI", "_API_KEY"].join(""),
      ["CODEX", "_API_KEY"].join(""),
      ["api.openai", ".com"].join(""),
    ];

    for (const pattern of forbiddenPatterns) {
      assert.equal(source.includes(pattern), false, `${path} contains ${pattern}`);
    }
  }
});

test("checklist exists", async () => {
  const { dashboardModule } =
    await buildDashboard();
  const checklist =
    dashboardModule.getMarketplaceOsDashboardChecklist();

  assert.equal(Array.isArray(checklist), true);
  assert.equal(checklist.length >= 5, true);
});
