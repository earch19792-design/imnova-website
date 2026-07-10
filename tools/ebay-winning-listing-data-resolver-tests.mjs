import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildEbayWinningListingDataResolverInput,
  buildEbayWinningListingDataResolverReport,
  buildEbayWinningKeywordExtraction,
  getEbayWinningListingDataResolverChecklist,
  summarizeEbayWinningListingDataResolver,
} from "../lib/ebay/ebay-winning-listing-data-resolver.ts";

const fixturePath = "tools/fixtures/ebay-winning-listing-data-resolver-v1.json";
const modulePath = "lib/ebay/ebay-winning-listing-data-resolver.ts";
const cliPath = "tools/ebay-winning-listing-data-resolver-dry-run.mjs";
const docPath = "docs/ebay-pro-isolation/EBAY_WINNING_LISTING_DATA_RESOLVER_RESUME_B2A_V1.md";
const fixtureSource = readFileSync(fixturePath, "utf8");
const moduleSource = readFileSync(modulePath, "utf8");
const cliSource = readFileSync(cliPath, "utf8");
const docSource = readFileSync(docPath, "utf8");
const fixture = JSON.parse(fixtureSource);

test("fixture has expected B2A status and safety boundaries", () => {
  assert.equal(fixture.status, "EBAY_WINNING_LISTING_DATA_RESOLVER_READY");
  assert.equal(fixture.production.offLimitsForWrites, true);
  assert.equal(fixture.main.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.ebayApi.usedInThisLoop, false);
  assert.equal(fixture.ebayWriteApi.usedInThisLoop, false);
  assert.equal(fixture.ebaySearchApi.usedInThisLoop, false);
  assert.equal(fixture.oauth.usedInThisLoop, false);
  assert.equal(fixture.tokenStorage.usedInThisLoop, false);
  assert.equal(fixture.draft.createdInThisLoop, false);
  assert.equal(fixture.listing.createdInThisLoop, false);
  assert.equal(fixture.offer.createdInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.imageGeneration.usedInThisLoop, false);
  assert.equal(fixture.scraper.usedInThisLoop, false);
  assert.equal(fixture.amazonTrack.touchedInThisLoop, false);
  assert.equal(fixture.marketDataSource, "LOCAL_FIXTURE_ONLY_IN_THIS_LOOP");
  assert.equal(fixture.realEbayWinningDataResolved, false);
  assert.equal(fixture.realLunaMatchConfirmed, false);
  assert.equal(fixture.requiresB2ARunBeforeDraftExecution, true);
  assert.equal(fixture.nextRecommendedRoute, "EBAY-RESUME-B2A-RUN");
  assert.equal(fixture.nextRouteAfterB2ARun, "EBAY-RESUME-B2-RUN");
});

test("safe warehouse alias is present without street-level data", () => {
  assert.equal(fixture.warehouse.warehouseAlias, "LUNA_PORTEX_BOCA_RATON");
  assert.equal(fixture.warehouse.fullWarehouseStreetAddressCommitted, false);
  const combined = `${fixtureSource}\n${docSource}\n${moduleSource}\n${cliSource}`;
  assert.doesNotMatch(combined, /streetAddress\s*[:=]|addressLine|fullAddress/i);
});

test("both Luna-first and eBay-first strategies are evaluated", () => {
  const report = buildEbayWinningListingDataResolverReport(fixture);
  assert.deepEqual(fixture.strategies, ["LUNA_FIRST", "EBAY_FIRST"]);
  assert.equal(report.strategiesEvaluated, 2);
  assert.ok(report.lunaFirstCandidatesEvaluated >= 1);
  assert.ok(report.marketFirstWinnersEvaluated >= 2);
  assert.ok(report.winningListingsAnalyzed >= 3);
});

test("winning keywords are extracted from patterns without copying a title", () => {
  const input = buildEbayWinningListingDataResolverInput(fixture);
  const keywords = buildEbayWinningKeywordExtraction(input.comparables);
  assert.equal(keywords.winningKeywordsExtracted, true);
  assert.equal(keywords.literalTitleContentUsed, false);
  assert.ok(keywords.keywords.includes("silicone cable organizer"));
});

test("optimized title is original, readable, and safe", () => {
  const report = buildEbayWinningListingDataResolverReport(fixture);
  assert.equal(report.optimizedTitleGenerated, true);
  for (const comparable of fixture.comparables) {
    assert.notEqual(report.optimizedTitle, comparable.titlePattern);
  }
  assert.notEqual(report.optimizedTitle, report.optimizedTitle.toUpperCase());
  assert.doesNotMatch(report.optimizedTitle, /[^\x00-\x7F]/);
  assert.doesNotMatch(report.optimizedTitle, /\b(official|authentic|guaranteed|fda|medical|best)\b/i);
});

test("every comparable preserves copy safety", () => {
  const report = buildEbayWinningListingDataResolverReport(fixture);
  for (const comparable of report.comparables) {
    assert.equal(comparable.copySafety.exactTitleCopied, false);
    assert.equal(comparable.copySafety.descriptionCopied, false);
    assert.equal(comparable.copySafety.imagesCopied, false);
    assert.equal(comparable.copySafety.competitorBrandMisused, false);
  }
  assert.equal(report.enrichedPayloadForB2Run.copySafety.exactTitleCopied, false);
});

test("category, item specifics, price, and benchmark summary are built", () => {
  const report = buildEbayWinningListingDataResolverReport(fixture);
  assert.equal(report.categorySuggestionBuilt, true);
  assert.equal(report.itemSpecificsSuggested, true);
  assert.equal(report.priceRangeBuilt, true);
  assert.equal(report.competitorBenchmarkSummaryBuilt, true);
  assert.equal(report.suggestedCategory.name, "Cable Organizers");
  assert.equal(report.suggestedItemSpecifics["Number in Pack"], "20");
  assert.ok(report.priceRange.min > 0);
});

test("risk rejection and Luna match watchlist logic work", () => {
  const report = buildEbayWinningListingDataResolverReport(fixture);
  assert.equal(report.rejectedForRiskCount, 1);
  assert.ok(report.lunaPortexMatchesFound >= 1);
  const rejected = report.comparables.find((entry) => entry.comparableId === "CMP-MARKET-BRANDED-AEROSOL");
  assert.ok(rejected.riskFlags.includes("AEROSOL"));
  assert.equal(rejected.lunaMatch.status, "NO_MATCH");
});

test("controlled draft readiness remains non-executing", () => {
  const report = buildEbayWinningListingDataResolverReport(fixture);
  assert.equal(report.canProceedToControlledDraftExecution, true);
  assert.equal(report.canPublish, false);
  assert.equal(report.requiresHumanApproval, true);
  assert.equal(report.enrichedPayloadForB2Run.publish, false);
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-B2A-RUN");
  assert.equal(report.nextRouteAfterB2ARun, "EBAY-RESUME-B2-RUN");
});

test("local fixture evidence requires B2A-RUN before B2-RUN", () => {
  const local = buildEbayWinningListingDataResolverReport(fixture);
  assert.equal(local.marketDataSource, "LOCAL_FIXTURE_ONLY_IN_THIS_LOOP");
  assert.equal(local.realEbayWinningDataResolved, false);
  assert.equal(local.realLunaMatchConfirmed, false);
  assert.equal(local.requiresB2ARunBeforeDraftExecution, true);
  assert.equal(local.nextRecommendedRoute, "EBAY-RESUME-B2A-RUN");

  const confirmed = buildEbayWinningListingDataResolverReport({
    ...fixture,
    marketDataSource: "CONTROLLED_READ_ONLY_EBAY_DATA",
    realEbayWinningDataResolved: true,
    realLunaMatchConfirmed: true,
    requiresB2ARunBeforeDraftExecution: false,
  });
  assert.equal(confirmed.nextRecommendedRoute, "EBAY-RESUME-B2-RUN");
});

test("missing market data, missing Luna match, and account risk route safely", () => {
  const noMarket = buildEbayWinningListingDataResolverReport({ ...fixture, comparables: [] });
  assert.equal(noMarket.nextRecommendedRoute, "NEED_MARKET_DATA");
  const noMatch = buildEbayWinningListingDataResolverReport({
    ...fixture,
    comparables: fixture.comparables.map((entry) => ({ ...entry, lunaMatch: { status: "NO_MATCH", matchScore: 0, estimatedMarginPercent: 0 } })),
  });
  assert.equal(noMatch.nextRecommendedRoute, "NEED_LUNA_MATCH");
  const hold = buildEbayWinningListingDataResolverReport({
    ...fixture,
    sourceCandidateFromB2: { ...fixture.sourceCandidateFromB2, riskLevel: "HIGH" },
  });
  assert.equal(hold.nextRecommendedRoute, "EBAY-RESUME-HOLD");
});

test("module and CLI use no network, database, or filesystem-write capability", () => {
  const prohibited = [
    "process" + ".env", "fetch" + "(", "create" + "Client", ".fr" + "om(",
    ".ins" + "ert(", ".upd" + "ate(", ".ups" + "ert(", "write" + "File",
    "append" + "File", "create" + "WriteStream",
  ];
  for (const marker of prohibited) {
    assert.equal(moduleSource.includes(marker), false, marker);
    assert.equal(cliSource.includes(marker), false, marker);
  }
});

test("B2A files contain no credential material or paused implementation markers", () => {
  const combined = `${moduleSource}\n${cliSource}\n${fixtureSource}\n${docSource}`;
  const forbidden = [
    "access" + "_token", "refresh" + "_token", "client" + "_secret", "authorization" + " code",
    "AMAZON_LISTING_PACKAGE_BUILDER", "ebay-sandbox-draft-listing", "EBAY_SANDBOX_DRAFT_LISTING",
  ];
  for (const marker of forbidden) assert.equal(combined.includes(marker), false, marker);
});

test("summary exposes numeric and safety output", () => {
  const summary = summarizeEbayWinningListingDataResolver(buildEbayWinningListingDataResolverReport(fixture));
  assert.equal(typeof summary.resolverScore, "number");
  assert.ok(summary.resolverScore >= 0 && summary.resolverScore <= 100);
  assert.equal(summary.strategiesEvaluated, 2);
  assert.equal(summary.enrichedPayloadForB2RunBuilt, true);
  assert.equal(summary.canPublish, false);
  assert.equal(summary.productionWriteTouched, false);
  assert.equal(summary.ebayApiUsedInThisLoop, false);
  assert.equal(summary.scraperUsed, false);
});

test("resolver checklist exists", () => {
  const checklist = getEbayWinningListingDataResolverChecklist();
  assert.ok(checklist.length >= 5);
  assert.match(checklist.join(" "), /Never copy exact titles/i);
});

test("CLI dry-run executes with expected strategy and route", async () => {
  const messages = [];
  const originalLog = console.log;
  console.log = (message) => messages.push(String(message));
  try {
    await import(`./ebay-winning-listing-data-resolver-dry-run.mjs?test=${Date.now()}`);
  } finally {
    console.log = originalLog;
  }
  const output = JSON.parse(messages.join("\n"));
  assert.equal(output.resolverReportBuilt, true);
  assert.equal(output.strategiesEvaluated, 2);
  assert.ok(output.winningListingsAnalyzed >= 3);
  assert.equal(output.winningKeywordsExtracted, true);
  assert.equal(output.optimizedTitleGenerated, true);
  assert.equal(output.categorySuggestionBuilt, true);
  assert.equal(output.itemSpecificsSuggested, true);
  assert.equal(output.priceRangeBuilt, true);
  assert.equal(output.canPublish, false);
  assert.equal(output.realEbayWinningDataResolved, false);
  assert.equal(output.realLunaMatchConfirmed, false);
  assert.equal(output.requiresB2ARunBeforeDraftExecution, true);
  assert.equal(output.nextRecommendedRoute, "EBAY-RESUME-B2A-RUN");
  assert.equal(output.nextRouteAfterB2ARun, "EBAY-RESUME-B2-RUN");
});
