import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const fixturePath =
  "tools/fixtures/amazon-luna-fba-prep-packing-costs-v1.json";
const modulePath =
  "lib/marketplace/amazon-luna-fba-prep-packing-costs.ts";
const cliPath =
  "tools/amazon-luna-fba-prep-packing-costs-dry-run.mjs";

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
  return import(`../${modulePath}`);
}

test("fixture locks Luna FBA prep packing dry-run boundaries", () => {
  const fixture =
    readJson(fixturePath);

  assert.equal(fixture.lunaPrepPackingVersion, "AMAZON_LUNA_FBA_PREP_PACKING_COSTS_V1");
  assert.equal(fixture.status, "LUNA_FBA_PREP_PACKING_COSTS_READY");
  assert.equal(fixture.mode, "LOCAL_DRY_RUN_USER_PROVIDED_LUNA_COST_BASELINE_ONLY");
  assert.equal(fixture.source, "USER_PROVIDED_LUNA_WAREHOUSE_FBA_PREP_AND_FBM_MATERIALS");
  assert.equal(fixture.production.offLimits, true);
  assert.equal(fixture.staging.writeExecutedInThisLoop, false);
  assert.equal(fixture.amazonApi.usedInThisLoop, false);
  assert.equal(fixture.spApi.usedInThisLoop, false);
  assert.equal(fixture.sellerCentral.writeExecutedInThisLoop, false);
  assert.equal(fixture.scraper.usedInThisLoop, false);
  assert.equal(fixture.publication.createdInThisLoop, false);
});

test("calculates Luna and external FNSKU, reception, bundle, wrap, box, and pallet costs", async () => {
  const fixture =
    readJson(fixturePath);
  const module =
    await loadModule();
  const schedule =
    module.buildLunaFbaPrepPackingCostSchedule(fixture);

  assert.equal(module.calculateFnSkuLabelingCost({ customerType: "LUNA_CLIENT", fnSkuLabelingRequired: true, schedule }), 0.5);
  assert.equal(module.calculateFnSkuLabelingCost({ customerType: "EXTERNAL_CLIENT", fnSkuLabelingRequired: true, schedule }), 0.8);
  assert.equal(module.calculateInventoryReceptionCost({ preparedAndSentToFbaWithLuna: true, schedule }), 0);
  assert.equal(module.calculateInventoryReceptionCost({ preparedAndSentToFbaWithLuna: false, schedule }), 0.2);

  assert.equal(module.calculateBundlePreparationCost({ customerType: "LUNA_CLIENT", bundleUnits: 1, schedule }).amount, 0.6);
  assert.equal(module.calculateBundlePreparationCost({ customerType: "LUNA_CLIENT", bundleUnits: 3, schedule }).amount, 0.8);
  assert.equal(module.calculateBundlePreparationCost({ customerType: "LUNA_CLIENT", bundleUnits: 6, schedule }).amount, 1);
  assert.equal(module.calculateBundlePreparationCost({ customerType: "LUNA_CLIENT", bundleUnits: 12, schedule }).amount, 1.25);
  assert.equal(module.calculateBundlePreparationCost({ customerType: "EXTERNAL_CLIENT", bundleUnits: 1, schedule }).amount, 1);
  assert.equal(module.calculateBundlePreparationCost({ customerType: "EXTERNAL_CLIENT", bundleUnits: 3, schedule }).amount, 1.25);
  assert.equal(module.calculateBundlePreparationCost({ customerType: "EXTERNAL_CLIENT", bundleUnits: 6, schedule }).amount, 1.5);
  assert.equal(module.calculateBundlePreparationCost({ customerType: "EXTERNAL_CLIENT", bundleUnits: 12, schedule }).amount, 2);
  assert.equal(module.calculateBundlePreparationCost({ customerType: "LUNA_CLIENT", bundleUnits: 13, schedule }).status, "QUOTE_REQUIRED");

  assert.equal(module.calculateBundleWrapCost({ customerType: "LUNA_CLIENT", wrapUnits: 1, schedule }).amount, 1);
  assert.equal(module.calculateBundleWrapCost({ customerType: "LUNA_CLIENT", wrapUnits: 3, schedule }).amount, 1.25);
  assert.equal(module.calculateBundleWrapCost({ customerType: "LUNA_CLIENT", wrapUnits: 6, schedule }).amount, 1.75);
  assert.equal(module.calculateBundleWrapCost({ customerType: "LUNA_CLIENT", wrapUnits: 12, schedule }).amount, 2);
  assert.equal(module.calculateBundleWrapCost({ customerType: "EXTERNAL_CLIENT", wrapUnits: 1, schedule }).amount, 1.5);
  assert.equal(module.calculateBundleWrapCost({ customerType: "EXTERNAL_CLIENT", wrapUnits: 3, schedule }).amount, 2);
  assert.equal(module.calculateBundleWrapCost({ customerType: "EXTERNAL_CLIENT", wrapUnits: 6, schedule }).amount, 2.5);
  assert.equal(module.calculateBundleWrapCost({ customerType: "EXTERNAL_CLIENT", wrapUnits: 12, schedule }).amount, 3);

  assert.equal(module.calculateBoxCost({ customerType: "LUNA_CLIENT", boxRequired: true, boxSize: "SMALL", schedule }), 2);
  assert.equal(module.calculateBoxCost({ customerType: "LUNA_CLIENT", boxRequired: true, boxSize: "MEDIUM", schedule }), 3);
  assert.equal(module.calculateBoxCost({ customerType: "LUNA_CLIENT", boxRequired: true, boxSize: "LARGE", schedule }), 4);
  assert.equal(module.calculateBoxCost({ customerType: "EXTERNAL_CLIENT", boxRequired: true, boxSize: "SMALL", schedule }), 3);
  assert.equal(module.calculateBoxCost({ customerType: "EXTERNAL_CLIENT", boxRequired: true, boxSize: "MEDIUM", schedule }), 4);
  assert.equal(module.calculateBoxCost({ customerType: "EXTERNAL_CLIENT", boxRequired: true, boxSize: "LARGE", schedule }), 5);
  assert.equal(module.calculatePalletCost({ palletRequired: true, schedule }), 10);
});

test("professional seller allocation and FBM material costs stay explicit", async () => {
  const fixture =
    readJson(fixturePath);
  const module =
    await loadModule();
  const schedule =
    module.buildLunaFbaPrepPackingCostSchedule(fixture);
  const allocation =
    module.buildAmazonProfessionalSellerPlanFeeAllocation({ expectedMonthlyUnits: 50 });
  const requirement =
    module.buildFbmPackingMaterialRequirement("fbm_poly_mailer_14_5x19", schedule);
  const materialCost =
    module.calculateFbmPackingMaterialCost(requirement);

  assert.equal(allocation.amazonProfessionalPlanMonthlyFee, 39.99);
  assert.equal(allocation.professionalPlanFeePerUnit, 0.8);
  assert.equal(requirement.costStatus, "NEED_UNIT_COST_INPUT");
  assert.equal(materialCost.costStatus, "NEED_UNIT_COST_INPUT");
  assert.equal(materialCost.costPerUnit, 0);
});

test("DM0628N operational add-on includes FNSKU and professional plan allocation", async () => {
  const fixture =
    readJson(fixturePath);
  const module =
    await loadModule();
  const queue =
    module.buildAmazonOperationalCostAssessmentQueue(fixture);
  const dm =
    queue.assessments.find(entry => entry.productKey === "dm0628n");

  assert.ok(dm);
  assert.equal(dm.fulfillmentPath, "FBA");
  assert.equal(dm.fnSkuLabelingCost, 0.5);
  assert.equal(dm.professionalPlanFeePerUnit, 0.8);
  assert.equal(dm.totalOperationalCostAddOn, 1.3);
});

test("CLI dry-run executes and prints expected numeric output", async () => {
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

  assert.equal(summary.lunaPrepPackingScheduleBuilt, true);
  assert.equal(summary.fbaPrepCostRulesLoaded >= 5, true);
  assert.equal(summary.fbmMaterialRequirementsLoaded >= 5, true);
  assert.equal(summary.professionalSellerPlanFeeModeled, true);
  assert.equal(summary.operationalCostAssessmentsBuilt >= 3, true);
  assert.equal(summary.dm0628nFnSkuLabelingCost, 0.5);
  assert.equal(summary.sellerCentralVerified, false);
  assert.equal(summary.spApiVerified, false);
  assert.equal(summary.amazonApiUsed, false);
  assert.equal(summary.nextLoop, "149G");
});

test("module and CLI avoid integrations writes and sensitive calls", () => {
  for (const path of [fixturePath, modulePath, cliPath]) {
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
