import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildEbayPackMarginGuard,
  buildEbayPackSizeSignalAnalysis,
  buildEbayPackTitleKeywordStrategy,
  buildEbayRecommendedBundleStrategy,
  buildEbayReadonlyMarketResolverReport,
  buildEbayWinningListingReadonlyRunnerInput,
  getEbayWinningListingReadonlyRunnerChecklist,
  summarizeEbayWinningListingReadonlyRunner,
} from "../lib/ebay/ebay-winning-listing-readonly-runner.ts";

const fixturePath = "tools/fixtures/ebay-winning-listing-readonly-runner-v1.json";
const modulePath = "lib/ebay/ebay-winning-listing-readonly-runner.ts";
const dryRunPath = "tools/ebay-winning-listing-readonly-runner-dry-run.mjs";
const runnerPath = "tools/ebay-winning-listing-readonly-runner.mjs";
const docPath = "docs/ebay-pro-isolation/EBAY_WINNING_LISTING_READONLY_RUNNER_RESUME_B2A_RUN_V1.md";
const fixtureSource = readFileSync(fixturePath, "utf8");
const moduleSource = readFileSync(modulePath, "utf8");
const dryRunSource = readFileSync(dryRunPath, "utf8");
const runnerSource = readFileSync(runnerPath, "utf8");
const docSource = readFileSync(docPath, "utf8");
const fixture = JSON.parse(fixtureSource);

test("fixture has expected B2A-RUN safety boundaries", () => {
  assert.equal(fixture.status, "EBAY_WINNING_LISTING_READONLY_RUNNER_READY");
  assert.equal(fixture.production.offLimitsForWrites, true);
  assert.equal(fixture.main.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.ebayApi.writeUsedInThisLoop, false);
  assert.equal(fixture.ebaySearchApi.writeUsedInThisLoop, false);
  assert.equal(fixture.tokenStorage.usedInThisLoop, false);
  assert.equal(fixture.tokenPrinting.usedInThisLoop, false);
  assert.equal(fixture.draft.createdInThisLoop, false);
  assert.equal(fixture.listing.createdInThisLoop, false);
  assert.equal(fixture.offer.createdInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
  assert.equal(fixture.imageGeneration.usedInThisLoop, false);
  assert.equal(fixture.scraper.usedInThisLoop, false);
  assert.equal(fixture.amazonTrack.touchedInThisLoop, false);
});

test("warehouse uses safe alias without street-level data", () => {
  assert.equal(fixture.warehouse.warehouseAlias, "LUNA_PORTEX_BOCA_RATON");
  assert.equal(fixture.warehouse.fullWarehouseStreetAddressCommitted, false);
  const combined = `${fixtureSource}\n${moduleSource}\n${dryRunSource}\n${docSource}`;
  assert.doesNotMatch(combined, /streetAddress\s*[:=]|addressLine|fullAddress/i);
});

async function importRunnerAndCapture(args = []) {
  const messages = [];
  const originalArgv = process.argv;
  const originalLog = console.log;
  process.argv = [originalArgv[0], runnerPath, ...args];
  console.log = (message) => messages.push(String(message));
  try {
    await import(`./ebay-winning-listing-readonly-runner.mjs?test=${Date.now()}-${Math.random()}`);
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
  }
  return JSON.parse(messages.join("\n"));
}

test("default runner executes no API and no token exchange", async () => {
  const output = await importRunnerAndCapture();
  assert.equal(output.mode, "safe-default");
  assert.equal(output.realEbayMarketReadExecuted, false);
  assert.equal(output.ebayReadOnlyApiUsed, false);
  assert.equal(output.ebayWriteApiUsed, false);
  assert.equal(output.tokenExchangeExecuted, false);
  assert.equal(output.tokensStored, false);
  assert.equal(output.tokensPrinted, false);
});

test("execution flag remains blocked without exact environment approval", async () => {
  const names = ["EBAY_OAUTH_ENV", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_REDIRECT_URI", "EBAY_MARKETPLACE_ID", "EBAY_B2A_RUN_APPROVED"];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  const output = await importRunnerAndCapture(["--execute-readonly-market-resolver"]);
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  assert.equal(output.mode, "safe-default");
  assert.equal(output.blockedReason, "MISSING_OR_INVALID_APPROVAL_ENVIRONMENT");
  assert.equal(output.realEbayMarketReadExecuted, false);
  assert.equal(output.tokenExchangeExecuted, false);
});

test("runner requires exact CLI confirmation and read-only allowlist", () => {
  assert.match(runnerSource, /READ_ONLY_MARKET_RESOLVER_APPROVED/);
  assert.match(runnerSource, /BLOCKED_NON_ALLOWLISTED_EBAY_ENDPOINT/);
  assert.match(runnerSource, /method === "GET"/);
  assert.match(runnerSource, /\/buy\/browse\/v1\/item_summary\/search/);
  assert.doesNotMatch(runnerSource, /sell\/inventory|sell\/account|publish_offer|create_offer/i);
});

test("dry-run safely routes to market data", () => {
  const report = buildEbayReadonlyMarketResolverReport(fixture);
  assert.equal(report.realEbayWinningDataResolved, false);
  assert.equal(report.realEbayComparableDataResolved, false);
  assert.equal(report.soldDataResolved, false);
  assert.equal(report.realLunaMatchConfirmed, false);
  assert.equal(report.canProceedToB2Run, false);
  assert.equal(report.canPublish, false);
  assert.equal(report.nextRecommendedRoute, "NEED_MARKET_DATA");
});

const safeComparables = [
  { itemId: "one", title: "Silicone Cable Organizer Clips 20 Pack Self Adhesive Black", price: { value: "18.99", currency: "USD" }, categories: [{ categoryId: "123", categoryName: "Cable Organizers" }] },
  { itemId: "two", title: "Black Silicone Cord Holder 20 Pack Cable Organizer", price: { value: "20.49", currency: "USD" }, categories: [{ categoryId: "123", categoryName: "Cable Organizers" }] },
];

test("real comparables without Luna match route to NEED_LUNA_MATCH", () => {
  const report = buildEbayReadonlyMarketResolverReport(fixture, {
    source: "OFFICIAL_EBAY_BROWSE_API_READ_ONLY", realEbayWinningDataResolved: false,
    realEbayComparableDataResolved: true, soldDataResolved: false,
    soldDataUnavailableReason: "unavailable_or_scope_missing", comparables: safeComparables,
    realLunaMatchConfirmed: false, humanApprovalConfirmed: false, accountRiskKnown: false,
  });
  assert.equal(report.nextRecommendedRoute, "NEED_LUNA_MATCH");
});

test("high risk routes to hold", () => {
  const risky = safeComparables.map((entry) => ({ ...entry, title: `${entry.title} aerosol` }));
  const report = buildEbayReadonlyMarketResolverReport(fixture, {
    source: "OFFICIAL_EBAY_BROWSE_API_READ_ONLY", realEbayComparableDataResolved: true,
    soldDataResolved: false, soldDataUnavailableReason: "unavailable_or_scope_missing",
    comparables: risky, realLunaMatchConfirmed: true, humanApprovalConfirmed: true,
  });
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-HOLD");
  assert.equal(report.canProceedToB2Run, false);
});

test("market data, Luna match, and approval can recommend B2-RUN without writing", () => {
  const report = buildEbayReadonlyMarketResolverReport(fixture, {
    source: "OFFICIAL_EBAY_BROWSE_API_READ_ONLY", realEbayWinningDataResolved: false,
    realEbayComparableDataResolved: true, soldDataResolved: false,
    soldDataUnavailableReason: "unavailable_or_scope_missing", comparables: safeComparables,
    realLunaMatchConfirmed: true, lunaPackQuantityConfirmed: true, lunaUnitCost: 0.32,
    estimatedPackShippingCost: 4.25, humanApprovalConfirmed: true, accountRiskKnown: false,
  });
  assert.equal(report.canProceedToB2Run, true);
  assert.equal(report.canPublish, false);
  assert.equal(report.nextRecommendedRoute, "EBAY-RESUME-B2-RUN");
  assert.equal(report.enrichedCandidateForB2Run.copySafety.exactTitleCopied, false);
  assert.equal(report.enrichedCandidateForB2Run.copySafety.descriptionCopied, false);
  assert.equal(report.enrichedCandidateForB2Run.copySafety.imagesCopied, false);
});

const packComparables = [
  { itemId: "p3", title: "Silicone Cable Organizer 3 Pack Self Adhesive", price: { value: "8.99", currency: "USD" } },
  { itemId: "p6", title: "Cable Organizer Clips 6 Pack Black", price: { value: "10.99", currency: "USD" } },
  { itemId: "p12", title: "Self Adhesive Cord Holder 12 Pack", price: { value: "14.99", currency: "USD" } },
  { itemId: "p20a", title: "Silicone Cable Organizer Clips 20 Pack Black", price: { value: "18.99", currency: "USD" } },
  { itemId: "p20b", title: "Cable Organizer 20 Pack Self Adhesive Set", price: { value: "20.99", currency: "USD" } },
].map((entry, index) => ({
  comparableId: entry.itemId, titleForAnalysis: entry.title, titleCopiedToOutput: false,
  descriptionCopied: false, imagesCopied: false, competitorBrandMisused: false,
  price: Number(entry.price.value), currency: "USD", categoryId: "", categoryName: "",
  condition: "NEW", buyingOptions: ["FIXED_PRICE"], sellerFeedbackPercentage: 99,
  sellerFeedbackScore: 100, itemCountry: "US", shippingCost: 4.25, sourceUrlRetained: false,
}));

test("pack resolver detects 3, 6, 12, and 20 pack title signals", () => {
  const signals = buildEbayPackSizeSignalAnalysis(packComparables);
  assert.equal(signals.packSignalsDetected, true);
  assert.deepEqual(signals.packSizesDetected.sort((a, b) => a - b), [3, 6, 12, 20]);
  assert.equal(signals.dominantPackSize, 20);
  const title = buildEbayPackTitleKeywordStrategy(packComparables);
  for (const keyword of ["3 pack", "6 pack", "12 pack", "20 pack"]) assert.ok(title.packKeywordsExtracted.includes(keyword));
  assert.equal(title.exactCompetitorTitleCopied, false);
});

test("strong pack signals and safe margin recommend the winning pack", () => {
  const input = buildEbayWinningListingReadonlyRunnerInput(fixture, {
    lunaPackQuantityConfirmed: true, lunaUnitCost: 0.32, estimatedPackShippingCost: 4.25,
  });
  const recommendation = buildEbayRecommendedBundleStrategy(input, packComparables);
  assert.equal(recommendation.recommendedPrimaryPackSize, 20);
  assert.equal(recommendation.packMarginRisk, false);
  assert.equal(recommendation.packShippingRisk, false);
  assert.equal(recommendation.packReadinessForDraft, true);
  assert.ok(["TWENTY_PACK", "MIXED_PACK_TEST"].includes(recommendation.recommendedPackStrategy));
});

test("weak margin or missing Luna quantity blocks bundle recommendation", () => {
  const input = buildEbayWinningListingReadonlyRunnerInput(fixture, {
    lunaPackQuantityConfirmed: false, lunaUnitCost: 2, estimatedPackShippingCost: 15,
  });
  const margin = buildEbayPackMarginGuard(input, packComparables);
  const recommendation = buildEbayRecommendedBundleStrategy(input, packComparables);
  assert.equal(margin.packMarginGuardPassed, false);
  assert.equal(recommendation.recommendedPackStrategy, "DO_NOT_BUNDLE");
  assert.equal(recommendation.packReadinessForDraft, false);
  assert.equal(recommendation.packRecommendationReason, "NEED_LUNA_PACK_QUANTITY_CONFIRMATION");
});

test("pack strategy feeds enriched B2-RUN candidate and never enables publication", () => {
  const report = buildEbayReadonlyMarketResolverReport(fixture, {
    source: "OFFICIAL_EBAY_BROWSE_API_READ_ONLY", realEbayComparableDataResolved: true,
    soldDataResolved: false, soldDataUnavailableReason: "unavailable_or_scope_missing",
    comparables: safeComparables, realLunaMatchConfirmed: true, lunaPackQuantityConfirmed: true,
    lunaUnitCost: 0.32, estimatedPackShippingCost: 4.25, humanApprovalConfirmed: true,
  });
  assert.equal(report.enrichedCandidateForB2Run.bundleRecommendation.recommendedPrimaryPackSize, 20);
  assert.equal(report.enrichedCandidateForB2Run.bundleRecommendation.packHumanApprovalRequired, true);
  assert.equal(report.canPublish, false);
  assert.equal(report.enrichedCandidateForB2Run.copySafety.imagesCopied, false);
});

test("pure module and dry-run contain no environment, fetch, database, or filesystem writes", () => {
  const prohibited = [
    "process" + ".env", "fetch" + "(", "create" + "Client", ".fr" + "om(",
    ".ins" + "ert(", ".upd" + "ate(", ".ups" + "ert(", "write" + "File",
    "append" + "File", "create" + "WriteStream",
  ];
  for (const marker of prohibited) {
    assert.equal(moduleSource.includes(marker), false, marker);
    assert.equal(dryRunSource.includes(marker), false, marker);
  }
  assert.match(runnerSource, /process\.env/);
  assert.match(runnerSource, /fetch\(/);
});

test("runner contains no filesystem writes and report always blocks publication", () => {
  assert.doesNotMatch(runnerSource, /writeFile|appendFile|createWriteStream/);
  const report = buildEbayReadonlyMarketResolverReport(fixture);
  const summary = summarizeEbayWinningListingReadonlyRunner(report);
  assert.equal(summary.canPublish, false);
  assert.equal(summary.draftCreated, false);
  assert.equal(summary.listingCreated, false);
  assert.equal(summary.offerCreated, false);
  assert.equal(summary.publicationExecuted, false);
});

test("B2A-RUN files do not mix paused implementation tracks", () => {
  const combined = `${moduleSource}\n${dryRunSource}\n${fixtureSource}\n${docSource}`;
  for (const marker of ["AMAZON_LISTING_PACKAGE_BUILDER", "ebay-sandbox-draft-listing", "EBAY_SANDBOX_DRAFT_LISTING"]) {
    assert.equal(combined.includes(marker), false, marker);
  }
});

test("CLI dry-run executes with numeric output", async () => {
  const messages = [];
  const originalLog = console.log;
  console.log = (message) => messages.push(String(message));
  try {
    await import(`./ebay-winning-listing-readonly-runner-dry-run.mjs?test=${Date.now()}`);
  } finally {
    console.log = originalLog;
  }
  const output = JSON.parse(messages.join("\n"));
  assert.equal(output.readonlyRunnerBuilt, true);
  assert.equal(typeof output.runnerScore, "number");
  assert.equal(output.mode, "dry-run");
  assert.equal(output.realEbayWinningDataResolved, false);
  assert.equal(output.canProceedToB2Run, false);
  assert.equal(output.nextRecommendedRoute, "NEED_MARKET_DATA");
});

test("runner checklist exists", () => {
  const checklist = getEbayWinningListingReadonlyRunnerChecklist();
  assert.ok(checklist.length >= 6);
  assert.match(checklist.join(" "), /official eBay Browse search/i);
});
