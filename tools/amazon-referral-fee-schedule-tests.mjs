import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/amazon-referral-fee-schedule-v1.json";
const modulePath =
  "lib/marketplace/amazon-referral-fee-schedule.ts";
const cliPath =
  "tools/amazon-referral-fee-schedule-dry-run.mjs";
const docPath =
  "docs/marketplace-isolation/AMAZON_REFERRAL_FEE_SCHEDULE_CATEGORY_RESOLVER_V1.md";

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

async function loadModule() {
  const fixture =
    readJson(fixturePath);
  const feeModule =
    await import(`../${modulePath}`);

  return {
    fixture,
    feeModule,
  };
}

async function fee(category, salePrice, productContext = category) {
  const { fixture, feeModule } =
    await loadModule();

  return feeModule.buildAmazonReferralFeeEstimate({
    category,
    salePrice,
    productContext,
    scheduleFixture:
      fixture,
  });
}

test("fixture locks referral fee schedule boundaries", () => {
  const fixture =
    readJson(fixturePath);

  assert.equal(fixture.referralFeeScheduleVersion, "AMAZON_REFERRAL_FEE_SCHEDULE_CATEGORY_RESOLVER_V1");
  assert.equal(fixture.status, "AMAZON_REFERRAL_FEE_SCHEDULE_READY");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_USER_PROVIDED_FEE_BASELINE_ONLY");
  assert.equal(fixture.source, "USER_PROVIDED_REFERRAL_FEE_TABLE");
  assert.equal(fixture.sellerCentralVerified, false);
  assert.equal(fixture.spApiVerified, false);
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.amazonApi.usedInThisLoop, false);
  assert.equal(fixture.spApi.usedInThisLoop, false);
  assert.equal(fixture.sellerCentral.writeExecutedInThisLoop, false);
  assert.equal(fixture.scraper.usedInThisLoop, false);
});

test("schedule loads at least thirty categories", async () => {
  const { fixture, feeModule } =
    await loadModule();
  const schedule =
    feeModule.buildAmazonReferralFeeSchedule(fixture);

  assert.equal(schedule.length >= 30, true);
});

test("simple percent categories calculate expected fees", async () => {
  assert.equal((await fee("Home and Kitchen", 22.99)).referralFeeAmount, 3.45);
  assert.equal((await fee("Computers", 100)).referralFeeAmount, 8);
  assert.equal((await fee("Amazon Device Accessories", 10)).referralFeeAmount, 4.5);
});

test("price band categories calculate expected fees", async () => {
  assert.equal((await fee("Beauty, Health, and Personal Care", 10)).referralFeeAmount, 0.8);
  assert.equal((await fee("Beauty, Health, and Personal Care", 10.01)).referralFeeAmount, 1.5);
  assert.equal((await fee("Baby Products", 10)).referralFeeAmount, 0.8);
  assert.equal((await fee("Baby Products", 12)).referralFeeAmount, 1.8);
  assert.equal((await fee("Clothing and Accessories", 15)).referralFeeAmount, 0.75);
  assert.equal((await fee("Clothing and Accessories", 18)).referralFeeAmount, 1.8);
  assert.equal((await fee("Clothing and Accessories", 25)).referralFeeAmount, 4.25);
  assert.equal((await fee("Grocery and Gourmet", 15)).referralFeeAmount, 1.2);
  assert.equal((await fee("Grocery and Gourmet", 20)).referralFeeAmount, 3);
});

test("tiered portion categories calculate expected fees", async () => {
  assert.equal((await fee("Electronics Accessories", 150)).referralFeeAmount, 19);
  assert.equal((await fee("Jewelry", 300)).referralFeeAmount, 52.5);
  assert.equal((await fee("Watches", 2000)).referralFeeAmount, 255);
});

test("special cases and fallbacks work", async () => {
  assert.equal((await fee("Pet Supplies", 100, "standard pet supplies")).referralFeeAmount, 15);
  assert.equal((await fee("Pet Supplies", 100, "veterinary diet")).referralFeeAmount, 22);

  const fallback =
    await fee("Unknown category", 20);

  assert.equal(fallback.categoryLabel, "Everything Else");
  assert.equal(fallback.referralFeeAmount, 3);
  assert.equal(fallback.categoryMatched, false);
  assert.equal(fallback.warnings.length > 0, true);
});

test("minimum fee and no-minimum categories are respected", async () => {
  const minimum =
    await fee("Home and Kitchen", 1);
  const noMinimum =
    await fee("Grocery and Gourmet", 1);

  assert.equal(minimum.referralFeeAmount, 0.3);
  assert.equal(minimum.minimumFeeApplied, true);
  assert.equal(noMinimum.referralFeeAmount, 0.08);
  assert.equal(noMinimum.minimumFeeApplied, false);
});

test("CLI dry-run executes and prints expected summary", async () => {
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

  assert.equal(summary.referralFeeScheduleBuilt, true);
  assert.equal(summary.categoriesLoaded >= 30, true);
  assert.equal(summary.feeAssessmentsBuilt >= 3, true);
  assert.equal(summary.dm0628nReferralFeeCategory, "Home and Kitchen");
  assert.equal(summary.dm0628nSalePrice, 22.99);
  assert.equal(summary.dm0628nReferralFeeAmount, 3.45);
  assert.equal(summary.sellerCentralVerified, false);
  assert.equal(summary.spApiVerified, false);
  assert.equal(summary.amazonApiUsed, false);
  assert.equal(summary.spApiUsed, false);
  assert.equal(summary.nextLoop, "149G");
});

test("module and CLI avoid real integrations and writes", () => {
  for (const path of [
    fixturePath,
    modulePath,
    cliPath,
    docPath,
  ]) {
    assert.equal(fileExists(path), true);
  }

  for (const path of [modulePath, cliPath]) {
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
