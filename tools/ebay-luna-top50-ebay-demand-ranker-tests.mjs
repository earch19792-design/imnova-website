import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applyHumanTopProductSelection,
  buildEbayLunaTop50DemandRankerInput,
  buildEbayLunaTop50DemandRankerReport,
  buildListingBlueprintFromEbayWinningStructure,
  buildTop50CandidateSetFromLunaScan,
  buildTop50OpportunityScore,
  buildTop5ListingBlueprints,
  buildTop10Recommendations,
  rankLunaCandidatesAgainstEbayDemand,
} from "../lib/ebay/ebay-luna-top50-ebay-demand-ranker.ts";

const fixturePath = "tools/fixtures/ebay-luna-top50-ebay-demand-ranker-v1.json";
const modulePath = "lib/ebay/ebay-luna-top50-ebay-demand-ranker.ts";
const cliPath = "tools/ebay-luna-top50-ebay-demand-ranker-dry-run.mjs";
const docPath = "docs/ebay-pro-isolation/EBAY_LUNA_TOP50_EBAY_DEMAND_RANKER_B2A_V1.md";
const fixtureSource = readFileSync(fixturePath, "utf8");
const moduleSource = readFileSync(modulePath, "utf8");
const cliSource = readFileSync(cliPath, "utf8");
const docSource = readFileSync(docPath, "utf8");
const fixture = JSON.parse(fixtureSource);

test("fixture models the strategic Top 50 route safely", () => {
  assert.equal(fixture.version, "EBAY_LUNA_TOP50_EBAY_DEMAND_RANKER_B2A_V1");
  assert.equal(fixture.status, "READY");
  assert.equal(fixture.requiresRealLunaCatalogFile, false);
  assert.equal(fixture.requiresWarehouseConsultation, false);
  assert.equal(fixture.requiresManualProductSearch, false);
  assert.equal(fixture.usesLunaScanCandidates, true);
  assert.equal(fixture.usesEbayMarketObservedData, true);
  assert.equal(fixture.salesGuaranteeClaimAllowed, false);
  assert.equal(fixture.imageCopyAllowed, false);
  assert.equal(fixture.imageGenerationUsed, false);
  assert.equal(fixture.canPublish, false);
});

test("loads and normalizes exactly 50 Luna scan candidates", () => {
  const set = buildTop50CandidateSetFromLunaScan(buildEbayLunaTop50DemandRankerInput(fixture));
  assert.equal(set.top50Loaded, true);
  assert.equal(set.candidatesLoaded, 50);
  assert.equal(set.candidates.length, 50);
  assert.ok(set.candidates.every((candidate) => candidate.source === "LUNA_SCAN_OBSERVED"));
});

test("compares 50 candidates deterministically against observed eBay signals", () => {
  const input = buildEbayLunaTop50DemandRankerInput(fixture);
  const first = rankLunaCandidatesAgainstEbayDemand(input);
  const second = rankLunaCandidatesAgainstEbayDemand(input);
  assert.equal(first.ebayDemandComparedCount, 50);
  assert.deepEqual(first.ranked.map(({ candidate, opportunityScore }) => [candidate.candidateId, opportunityScore]), second.ranked.map(({ candidate, opportunityScore }) => [candidate.candidateId, opportunityScore]));
  for (let index = 1; index < first.ranked.length; index += 1) assert.ok(first.ranked[index - 1].opportunityScore >= first.ranked[index].opportunityScore);
});

test("eBay demand and listing quality gap reward better opportunities", () => {
  const input = buildEbayLunaTop50DemandRankerInput(fixture);
  const ranking = rankLunaCandidatesAgainstEbayDemand(input);
  const high = ranking.ranked.find((entry) => entry.candidate.candidateId === "LUNA-TOP50-002");
  const low = ranking.ranked.find((entry) => entry.candidate.candidateId === "LUNA-TOP50-050");
  assert.ok(high.ebayDemandScore > low.ebayDemandScore);
  assert.ok(high.listingQualityGapScore > low.listingQualityGapScore);
  assert.ok(high.opportunityScore > low.opportunityScore);
});

test("risk products are penalized or held even with observed demand", () => {
  const ranking = rankLunaCandidatesAgainstEbayDemand(buildEbayLunaTop50DemandRankerInput(fixture));
  for (const id of ["LUNA-TOP50-047", "LUNA-TOP50-048", "LUNA-TOP50-049"]) {
    const risky = ranking.ranked.find((entry) => entry.candidate.candidateId === id);
    assert.equal(risky.highRisk, true);
    assert.equal(risky.status, "EBAY-RESUME-HOLD");
    assert.ok(risky.riskPenalty > 0);
  }
});

test("Top 10 is descending and Top 5 creates original safe listing blueprints", () => {
  const ranking = rankLunaCandidatesAgainstEbayDemand(buildEbayLunaTop50DemandRankerInput(fixture));
  const top10 = buildTop10Recommendations(ranking);
  const top5 = buildTop5ListingBlueprints(ranking);
  assert.equal(top10.top10Built, true);
  assert.equal(top10.top10Recommended.length, 10);
  assert.equal(top5.top5BlueprintsBuilt, true);
  assert.equal(top5.listingBlueprints.length, 5);
  for (const blueprint of top5.listingBlueprints) {
    assert.equal(blueprint.titleSource, "EBAY_MARKET_OBSERVED");
    assert.equal(blueprint.imageOptimizationBlueprint.noCompetitorImageCopy, true);
    assert.equal(blueprint.imageOptimizationBlueprint.imageSourcePolicy.ebayImages, "EBAY_REFERENCE_FOR_STRUCTURE_ONLY");
    assert.equal(blueprint.imageOptimizationBlueprint.imageSourcePolicy.generatedOrOwnImageRequiredBeforePublish, true);
    const sourceSignal = fixture.ebayObservedDemandSignals.find((entry) => entry.candidateId === blueprint.candidateId).ebayDemandSignal;
    assert.notEqual(blueprint.recommendedTitle, sourceSignal.titleWinningPattern);
  }
});

test("previous confirmed candidate enters ranking but does not bypass final selection", () => {
  const report = buildEbayLunaTop50DemandRankerReport(fixture);
  assert.ok(report.previousSingleConfirmedCandidateRank >= 1);
  assert.equal(report.previousSingleConfirmedCandidateStillRecommended, report.previousSingleConfirmedCandidateRank <= 10);
  assert.equal(report.humanTopProductSelectionStatus, "PENDING");
  assert.equal(report.canProceedToB2Run, false);
  assert.equal(report.nextRecommendedRoute, "NEED_HUMAN_TOP_PRODUCT_SELECTION");
});

test("rank one human selection alone enables B2-RUN preflight", () => {
  const report = buildEbayLunaTop50DemandRankerReport(fixture, "TOP50_HUMAN_SELECTED_RANK_1");
  assert.equal(report.humanTopProductSelectionStatus, "SELECTED_RANK_1");
  assert.equal(report.canProceedToB2Run, true);
  assert.equal(report.canPublish, false);
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-B2-RUN-PREFLIGHT");
});

test("human rejection of all routes to a Luna scan refresh", () => {
  const report = buildEbayLunaTop50DemandRankerReport(fixture, "TOP50_HUMAN_REJECTED_ALL");
  assert.equal(report.humanTopProductSelectionStatus, "REJECTED_ALL");
  assert.equal(report.canProceedToB2Run, false);
  assert.equal(report.nextRecommendedRoute, "NEED_LUNA_SCAN_REFRESH");
});

test("no-demand candidates cannot rank high", () => {
  const ranking = rankLunaCandidatesAgainstEbayDemand(buildEbayLunaTop50DemandRankerInput(fixture));
  const noDemand = ranking.ranked.filter((entry) => !entry.demand.demandObserved);
  assert.ok(noDemand.every((entry) => entry.rank > 10));
});

async function runCli(selection) {
  const messages = [];
  const originalArgv = process.argv;
  const originalLog = console.log;
  process.argv = [originalArgv[0], cliPath, ...(selection ? ["--simulate-human-selection", selection] : [])];
  console.log = (message) => messages.push(String(message));
  try { await import(`./ebay-luna-top50-ebay-demand-ranker-dry-run.mjs?test=${Date.now()}-${Math.random()}`); }
  finally { process.argv = originalArgv; console.log = originalLog; }
  return JSON.parse(messages.join("\n"));
}

test("CLI supports pending, rank-one selection, and reject-all simulations", async () => {
  const pending = await runCli();
  const selected = await runCli("TOP50_HUMAN_SELECTED_RANK_1");
  const rejected = await runCli("TOP50_HUMAN_REJECTED_ALL");
  assert.equal(pending.top50CandidatesLoaded, 50);
  assert.equal(pending.nextRecommendedRoute, "NEED_HUMAN_TOP_PRODUCT_SELECTION");
  assert.equal(selected.nextRecommendedRoute, "EBAY-RESUME-B2-RUN-PREFLIGHT");
  assert.equal(selected.canPublish, false);
  assert.equal(rejected.nextRecommendedRoute, "NEED_LUNA_SCAN_REFRESH");
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
  for (const simulation of [undefined, "TOP50_HUMAN_SELECTED_RANK_1", "TOP50_HUMAN_REJECTED_ALL"]) {
    const report = buildEbayLunaTop50DemandRankerReport(fixture, simulation);
    assert.equal(report.canPublish, false);
    assert.equal(report.salesGuaranteeClaimAllowed, false);
    assert.equal(report.imageCopyAllowed, false);
    assert.equal(report.imageGenerationUsed, false);
    assert.equal(report.realEbayApiUsedInThisLoop, false);
    assert.equal(report.oauthUsed, false);
    assert.equal(report.draftCreated, false);
    assert.equal(report.listingCreated, false);
    assert.equal(report.offerCreated, false);
    assert.equal(report.publicationExecuted, false);
    assert.equal(report.scraperUsed, false);
  }
});
