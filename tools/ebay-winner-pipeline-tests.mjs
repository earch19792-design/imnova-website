import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import ts from "typescript"
import {
  buildDecisionIdempotencyKey,
  calculateProfitScenario,
  getListingQuantityPolicy,
  getPipelineReanalysisAdvisor,
  processRadarCandidate,
} from "../lib/ebay-winner-pipeline/core.mjs"
import {
  getEbayProductDecisionAdvisor,
  getPricingStrategyRecommendation,
} from "../lib/ebay-winner-pipeline/decision-advisor.mjs"
import {
  evaluateStockRotationRisk,
} from "../lib/ebay-winner-pipeline/stock-risk-guardrail.mjs"
import {
  buildProductSelectionAdvisorOutput,
  calculateProductEconomics,
  classifyEbayRisk,
  classifyOperationalRisk,
  determineProductSelectionDecision,
  evaluateProductSelectionCandidate,
} from "../lib/ebay-winner-pipeline/product-selection-decision-service.mjs"
import {
  buildListingProposalFromCandidate,
} from "../lib/ebay-winner-pipeline/listing-proposal-generator.mjs"
import {
  evaluateListingProposalQa,
} from "../lib/ebay-winner-pipeline/listing-proposal-qa-runner.mjs"
import {
  buildListingProposalReviewReport,
} from "../lib/ebay-winner-pipeline/listing-proposal-review-report-formatter.mjs"
import {
  runImageGenerationDryRun,
} from "../lib/ebay-winner-pipeline/image-generation-dry-run-runner.mjs"
import {
  formatDryRunSummary,
  loadJsonFile as loadListingDryRunJsonFile,
  normalizeDryRunInput,
  runListingProposalDryRun,
  selectDryRunCases,
} from "./ebay-listing-proposal-dry-run.mjs"
import {
  buildPipelineProductSelectionDecision,
  mapPipelineResultToProductSelectionCandidate,
} from "../lib/ebay-winner-pipeline/service.mjs"
import {
  evaluateCandidateCases,
  formatEvaluationSummary,
  loadJsonFile,
  parseArgs,
  runCli,
  selectCandidateCases,
} from "./product-selection-evaluate-candidate.mjs"
import {
  getActiveListingRiskSummary,
  getOpenActiveListingRisks,
  getRisksByEbaySku,
  getRisksBySupplierSku,
} from "../lib/ebay-winner-pipeline/active-listing-risk-read-service.mjs"
import {
  getProductSelectionAdvisorFromCandidate,
} from "../lib/ebay-winner-pipeline/admin-read-service.mjs"
import {
  descriptionConverterTemplate,
  imageConversionTemplate,
  launchObservationTemplate,
  listingReadinessTemplate,
  listingSellerAdvisorPromptsV0,
  listingStrategyTemplate,
  titleOptimizerTemplate,
} from "../lib/ebay-listing-prompts/index.mjs"
import {
  getRadarAdvisorEvent,
  getNormalizedInventoryContext,
} from "../lib/radar-advisor-events.mjs"
import {
  getManualStockQuantity,
  getMarketRadarActionability,
  isConfirmedVariantStock,
} from "../lib/market-radar-actionable-ranking.mjs"

let lunaPortexTestInternals = null

async function getLunaPortexTestInternals() {
  if (lunaPortexTestInternals) {
    return lunaPortexTestInternals
  }

  const sourcePath =
    path.resolve(
      "lib/market-radar-lunaportex.ts"
    )

  const source =
    fs.readFileSync(
      sourcePath,
      "utf8"
    )

  const testSource = `${source}
export {
  getAuthenticatedHtmlInventoryQuantity,
  mergeAuthenticatedHtmlInventory,
  getNormalizedVariantInventory,
}
`

  const transpiled =
    ts.transpileModule(
      testSource,
      {
        compilerOptions: {
          module:
            ts.ModuleKind.ES2022,
          target:
            ts.ScriptTarget.ES2022,
        },
      }
    ).outputText

  const outputPath =
    path.join(
      os.tmpdir(),
      `market-radar-lunaportex-test-${process.pid}-${Date.now()}.mjs`
    )

  fs.writeFileSync(
    outputPath,
    transpiled
  )

  lunaPortexTestInternals =
    await import(
      `file://${outputPath}`
    )

  return lunaPortexTestInternals
}

const validRadarProduct = {
  source_key: "lunaportex",
  source_name: "Luna Portex",
  source_id: "00000000-0000-0000-0000-000000000001",
  product_id: "00000000-0000-0000-0000-000000000002",
  snapshot_id: "00000000-0000-0000-0000-000000000003",
  supplier_product_id: "lp-100",
  supplier_variant_id: "lp-100-v1",
  sku: "LP-VALID-001",
  title: "Adjustable Desk Organizer",
  product_url: "https://lunaportex.com/products/desk-organizer",
  vendor: "Generic",
  product_type: "Home Office",
  price: 10,
  estimated_sale_price: 35,
  inventory_quantity: 20,
  available: true,
  image_urls: ["https://cdn.example.com/desk-organizer.jpg"],
  images_authorized: true,
  suggested_category_id: "159907",
  weight: 1.2,
  opportunity_score: 80,
  out_of_stock_count_7d: 0,
}

const baseRadarEvent = {
  id: "event-1",
  product_id: "radar-product-1",
  supplier_variant_id: "variant-1",
  created_at: "2026-06-23T12:00:00.000Z",
  old_value: null,
  new_value: null,
}

const baseRadarAdvisorProduct = {
  product_id: "radar-product-1",
  title: "Functional Coffee Pack",
  product_type: "Nutrition",
  tags: ["coffee", "pack"],
  inventory_quantity: 2,
}

const baseActionableRadarProduct = {
  product_id:
    "radar-product-actionable",
  available:
    true,
  inventory_quantity:
    8,
  inventory_status:
    "in_stock",
  inventory_source:
    "luna_numeric",
  inventory_confidence:
    "high",
  inventory_scope:
    "variant_level",
}

function createActiveListingRiskSupabaseMock(rows = []) {
  const calls = []
  const forbiddenWrites = []

  class QueryMock {
    constructor(tableName) {
      this.tableName =
        tableName
      this.calls =
        calls
      this.resultRows =
        rows
    }

    select(value) {
      this.calls.push([
        "select",
        this.tableName,
        value,
      ])
      return this
    }

    is(column, value) {
      this.calls.push([
        "is",
        column,
        value,
      ])
      return this
    }

    eq(column, value) {
      this.calls.push([
        "eq",
        column,
        value,
      ])
      return this
    }

    order(column, options) {
      this.calls.push([
        "order",
        column,
        options,
      ])
      return this
    }

    limit(value) {
      this.calls.push([
        "limit",
        value,
      ])
      return this
    }

    then(resolve) {
      return Promise.resolve({
        data:
          this.resultRows,
        error:
          null,
      }).then(resolve)
    }
  }

  const supabase = {
    from(tableName) {
      calls.push([
        "from",
        tableName,
      ])
      return new QueryMock(
        tableName
      )
    },
    insert(...args) {
      forbiddenWrites.push([
        "insert",
        args,
      ])
      throw new Error(
        "insert_not_allowed"
      )
    },
    update(...args) {
      forbiddenWrites.push([
        "update",
        args,
      ])
      throw new Error(
        "update_not_allowed"
      )
    },
    delete(...args) {
      forbiddenWrites.push([
        "delete",
        args,
      ])
      throw new Error(
        "delete_not_allowed"
      )
    },
    upsert(...args) {
      forbiddenWrites.push([
        "upsert",
        args,
      ])
      throw new Error(
        "upsert_not_allowed"
      )
    },
    rpc(...args) {
      forbiddenWrites.push([
        "rpc",
        args,
      ])
      throw new Error(
        "rpc_not_allowed"
      )
    },
  }

  return {
    supabase,
    calls,
    forbiddenWrites,
  }
}

const activeListingRiskRows = [
  {
    id:
      "risk-medium-old",
    active_listing_id:
      "listing-2",
    risk_type:
      "price_up",
    risk_priority:
      "medium",
    risk_summary:
      "Price moved up",
    recommended_action:
      "Recalculate margin",
    created_at:
      "2026-06-27T10:00:00.000Z",
    resolved_at:
      null,
    active_listing: {
      id:
        "listing-2",
      ebay_item_id:
        "TEST-ITEM-2",
      ebay_sku:
        "TEST-EBAY-SKU-2",
      supplier_sku:
        "TEST-SUPPLIER-SKU-2",
      title:
        "Test listing 2",
      listing_status:
        "active",
      ebay_quantity:
        4,
      ebay_price:
        29.99,
      currency:
        "USD",
    },
  },
  {
    id:
      "risk-critical-new",
    active_listing_id:
      "listing-1",
    risk_type:
      "out_of_stock",
    risk_priority:
      "critical",
    risk_summary:
      "No stock",
    recommended_action:
      "Confirm stock manually",
    created_at:
      "2026-06-28T10:00:00.000Z",
    resolved_at:
      null,
    active_listing: {
      id:
        "listing-1",
      ebay_item_id:
        "TEST-ITEM-1",
      ebay_sku:
        "TEST-EBAY-SKU-1",
      supplier_sku:
        "TEST-SUPPLIER-SKU-1",
      title:
        "Test listing 1",
      listing_status:
        "active",
      ebay_quantity:
        0,
      ebay_price:
        19.99,
      currency:
        "USD",
    },
  },
]

const goodProductSelectionCandidate = {
  productName:
    "Desk Cable Organizer",
  supplierName:
    "Example Supplier",
  supplierSku:
    "SUP-SEL-001",
  internalSku:
    "IMN-SEL-001",
  category:
    "Home Office",
  niche:
    "Desk organization",
  supplierCost:
    10,
  supplierShippingCost:
    2,
  estimatedEbayPrice:
    29.99,
  buyerShippingCharge:
    0,
  stockAvailable:
    12,
  stockStatus:
    "confirmed",
  shippingTimeDays:
    4,
  weight:
    1.2,
  dimensions: {
    length:
      8,
    width:
      4,
    height:
      2,
  },
  fragile:
    false,
  returnRisk:
    "low",
  brandRisk:
    "low",
  veroRisk:
    "low",
  medicalClaimsRisk:
    "low",
  imageAuthorizationStatus:
    "authorized",
  competitorCount:
    8,
  soldCompsMedianPrice:
    31,
  marketConfidence:
    "medium",
}

const productSelectionQaFixturePath =
  path.resolve(
    "tools/fixtures/product-selection-candidates-v1.json"
  )

const productSelectionQaCases =
  JSON.parse(
    fs.readFileSync(
      productSelectionQaFixturePath,
      "utf8"
    )
  )

const ebayListingGeneratorFixturePath =
  path.resolve(
    "tools/fixtures/ebay-listing-generator-candidates-v1.json"
  )

const ebayListingGeneratorCases =
  JSON.parse(
    fs.readFileSync(
      ebayListingGeneratorFixturePath,
      "utf8"
    )
  )

const ebayListingAdminReadOnlyFixturePath =
  path.resolve(
    "tools/fixtures/ebay-listing-admin-read-only-items-v1.json"
  )

const ebayListingAdminReadOnlyFixture =
  JSON.parse(
    fs.readFileSync(
      ebayListingAdminReadOnlyFixturePath,
      "utf8"
    )
  )

const ebayListingImagePlanFixturePath =
  path.resolve(
    "tools/fixtures/ebay-listing-image-plan-v1.json"
  )

const ebayListingImagePlanFixture =
  JSON.parse(
    fs.readFileSync(
      ebayListingImagePlanFixturePath,
      "utf8"
    )
  )

const ebayListingImageQaResultFixturePath =
  path.resolve(
    "tools/fixtures/ebay-listing-image-qa-result-v1.json"
  )

const ebayListingImageQaResultFixture =
  JSON.parse(
    fs.readFileSync(
      ebayListingImageQaResultFixturePath,
      "utf8"
    )
  )

const ebayListingImageGenerationPromptPlanFixturePath =
  path.resolve(
    "tools/fixtures/ebay-listing-image-generation-prompt-plan-v1.json"
  )

const ebayListingImageGenerationPromptPlanFixture =
  JSON.parse(
    fs.readFileSync(
      ebayListingImageGenerationPromptPlanFixturePath,
      "utf8"
    )
  )

const ebayListingImageGenerationDryRunResultFixturePath =
  path.resolve(
    "tools/fixtures/ebay-listing-image-generation-dry-run-result-v1.json"
  )

const ebayListingImageGenerationDryRunResultFixture =
  JSON.parse(
    fs.readFileSync(
      ebayListingImageGenerationDryRunResultFixturePath,
      "utf8"
    )
  )

const ebayListingManualImageBriefFixturePath =
  path.resolve(
    "tools/fixtures/ebay-listing-manual-image-brief-v1.json"
  )

const ebayListingManualImageBriefFixture =
  JSON.parse(
    fs.readFileSync(
      ebayListingManualImageBriefFixturePath,
      "utf8"
    )
  )

const ebayFirstListingPackageFixturePath =
  path.resolve(
    "tools/fixtures/ebay-first-listing-package-v1.json"
  )

const ebayFirstListingPackageFixture =
  JSON.parse(
    fs.readFileSync(
      ebayFirstListingPackageFixturePath,
      "utf8"
    )
  )

const ebayFirstListingQaReviewFixturePath =
  path.resolve(
    "tools/fixtures/ebay-first-listing-qa-review-v1.json"
  )

const ebayFirstListingQaReviewFixture =
  JSON.parse(
    fs.readFileSync(
      ebayFirstListingQaReviewFixturePath,
      "utf8"
    )
  )

const ebayLunaPortexImageAssetManifestFixturePath =
  path.resolve(
    "tools/fixtures/ebay-luna-portex-image-asset-manifest-v1.json"
  )

const ebayLunaPortexImageAssetManifestFixture =
  JSON.parse(
    fs.readFileSync(
      ebayLunaPortexImageAssetManifestFixturePath,
      "utf8"
    )
  )

const ebayLunaPortexImageSourceIntakeFixturePath =
  path.resolve(
    "tools/fixtures/ebay-luna-portex-image-source-intake-v1.json"
  )

const ebayLunaPortexImageSourceIntakeFixture =
  JSON.parse(
    fs.readFileSync(
      ebayLunaPortexImageSourceIntakeFixturePath,
      "utf8"
    )
  )

const ebayLunaPortexImageSourceReviewGateFixturePath =
  path.resolve(
    "tools/fixtures/ebay-luna-portex-image-source-review-gate-v1.json"
  )

const ebayLunaPortexImageSourceReviewGateFixture =
  JSON.parse(
    fs.readFileSync(
      ebayLunaPortexImageSourceReviewGateFixturePath,
      "utf8"
    )
  )

const ebayLunaPortexMainImageEnhancementBriefFixturePath =
  path.resolve(
    "tools/fixtures/ebay-luna-portex-main-image-enhancement-brief-v1.json"
  )

const ebayLunaPortexMainImageEnhancementBriefFixture =
  JSON.parse(
    fs.readFileSync(
      ebayLunaPortexMainImageEnhancementBriefFixturePath,
      "utf8"
    )
  )

const ebayLunaPortexCatalogCoverageAuditFixturePath =
  path.resolve(
    "tools/fixtures/ebay-luna-portex-catalog-coverage-audit-v1.json"
  )

const ebayLunaPortexCatalogCoverageAuditFixture =
  JSON.parse(
    fs.readFileSync(
      ebayLunaPortexCatalogCoverageAuditFixturePath,
      "utf8"
    )
  )

const ebayMarketRadarSellerCommandCenterMvpFixturePath =
  path.resolve(
    "tools/fixtures/ebay-market-radar-seller-command-center-mvp-v1.json"
  )

const ebayMarketRadarSellerCommandCenterMvpFixture =
  JSON.parse(
    fs.readFileSync(
      ebayMarketRadarSellerCommandCenterMvpFixturePath,
      "utf8"
    )
  )

const ebayListingImageGenerationDryRunRunnerFixtureSetPath =
  path.resolve(
    "tools/fixtures/ebay-listing-image-generation-dry-run-runner-fixture-set-v1.json"
  )

const ebayListingImageGenerationDryRunRunnerFixtureSet =
  JSON.parse(
    fs.readFileSync(
      ebayListingImageGenerationDryRunRunnerFixtureSetPath,
      "utf8"
    )
  )

const ebayListingAdminPagePath =
  path.resolve(
    "app/admin/ebay-listings/page.tsx"
  )

const ebayImageGeneratorAdminPagePath =
  path.resolve(
    "app/admin/ebay-image-generator/page.tsx"
  )

const ebayListingPackageAdminPagePath =
  path.resolve(
    "app/admin/ebay-listing-package/page.tsx"
  )

const adminSidebarPath =
  path.resolve(
    "app/admin/sidebar.tsx"
  )

test("product selection decision service: producto bueno aprueba para preparacion interna", () => {
  const result =
    evaluateProductSelectionCandidate(
      goodProductSelectionCandidate
    )

  assert.equal(result.decision, "approve")
  assert.equal(
    result.state,
    "APPROVED_FOR_DRAFT"
  )
  assert.equal(result.advisoryOnly, true)
  assert.equal(
    result.riskFlags.length,
    0
  )
  assert.ok(
    result.keyNumbers.netProfit >= 5
  )
  assert.ok(
    result.keyNumbers.roiPercent >= 30
  )
  assert.ok(
    result.keyNumbers.netMarginPercent >= 20
  )
})

test("product selection decision service: calcula economia V1 con defaults seguros", () => {
  const economics =
    calculateProductEconomics(
      goodProductSelectionCandidate
    )

  assert.equal(
    economics.estimatedShippingCost,
    2
  )
  assert.equal(
    economics.estimatedEbayFees,
    4.27
  )
  assert.equal(
    economics.netProfit,
    13.72
  )
  assert.equal(
    economics.thresholds.minimumProfitUsd,
    5
  )
  assert.equal(
    economics.thresholds.minimumRoiPercent,
    30
  )
  assert.equal(
    economics.thresholds.recommendedNetMarginPercent,
    20
  )
})

test("product selection decision service: sin stock bloquea", () => {
  const result =
    evaluateProductSelectionCandidate({
      ...goodProductSelectionCandidate,
      stockAvailable:
        0,
    })

  assert.equal(result.decision, "blocked")
  assert.equal(result.state, "BLOCKED")
  assert.ok(
    result.riskFlags.some(flag =>
      flag.code === "stock_zero"
    )
  )
})

test("product selection decision service: riesgo VeRO alto bloquea", () => {
  const ebayRisk =
    classifyEbayRisk({
      ...goodProductSelectionCandidate,
      veroRisk:
        "high",
    })

  assert.equal(
    ebayRisk.riskLevel,
    "critical"
  )
  assert.ok(
    ebayRisk.riskFlags.some(flag =>
      flag.code === "brand_or_vero_high" &&
      flag.severity === "blocker"
    )
  )

  const result =
    evaluateProductSelectionCandidate({
      ...goodProductSelectionCandidate,
      veroRisk:
        "high",
    })

  assert.equal(result.decision, "blocked")
  assert.equal(result.state, "BLOCKED")
})

test("product selection decision service: falta peso o dimensiones deja DATA_INCOMPLETE", () => {
  const operationalRisk =
    classifyOperationalRisk({
      ...goodProductSelectionCandidate,
      weight:
        null,
      dimensions:
        null,
    })

  assert.equal(
    operationalRisk.riskLevel,
    "review"
  )
  assert.ok(
    operationalRisk.riskFlags.some(flag =>
      flag.code === "missing_weight"
    )
  )
  assert.ok(
    operationalRisk.riskFlags.some(flag =>
      flag.code === "missing_dimensions"
    )
  )

  const result =
    evaluateProductSelectionCandidate({
      ...goodProductSelectionCandidate,
      weight:
        null,
      dimensions:
        null,
    })

  assert.equal(result.decision, "review")
  assert.equal(
    result.state,
    "DATA_INCOMPLETE"
  )
})

test("product selection decision service: profit bajo cae en MARGIN_REVIEW o rechazo", () => {
  const result =
    evaluateProductSelectionCandidate({
      ...goodProductSelectionCandidate,
      supplierCost:
        20,
      supplierShippingCost:
        4,
      estimatedEbayPrice:
        29,
    })

  assert.ok(
    [
      "review",
      "reject",
    ].includes(result.decision)
  )
  assert.ok(
    [
      "MARGIN_REVIEW",
      "REJECTED",
    ].includes(result.state)
  )
})

test("product selection decision service: ROI bajo requiere revision o rechazo", () => {
  const result =
    evaluateProductSelectionCandidate({
      ...goodProductSelectionCandidate,
      supplierCost:
        35,
      supplierShippingCost:
        2,
      estimatedEbayPrice:
        50,
      soldCompsMedianPrice:
        52,
    })

  assert.ok(
    [
      "review",
      "reject",
    ].includes(result.decision)
  )
  assert.ok(
    [
      "MARGIN_REVIEW",
      "REJECTED",
    ].includes(result.state)
  )
  assert.ok(
    result.keyNumbers.roiPercent < 30
  )
})

test("product selection decision service: stock desconocido requiere revision", () => {
  const result =
    evaluateProductSelectionCandidate({
      ...goodProductSelectionCandidate,
      stockAvailable:
        null,
      stockStatus:
        "unknown",
    })

  assert.equal(result.decision, "review")
  assert.equal(
    result.state,
    "DATA_INCOMPLETE"
  )
  assert.ok(
    result.riskFlags.some(flag =>
      flag.code === "stock_unknown"
    )
  )
})

test("product selection decision service: precio sobre sold comps median mas 10 requiere revision", () => {
  const result =
    evaluateProductSelectionCandidate({
      ...goodProductSelectionCandidate,
      estimatedEbayPrice:
        40,
      soldCompsMedianPrice:
        35,
    })

  assert.equal(result.decision, "review")
  assert.equal(
    result.state,
    "MARGIN_REVIEW"
  )
  assert.ok(
    result.riskFlags.some(flag =>
      flag.code === "price_above_market"
    )
  )
})

test("product selection decision service: claims medicos fuertes bloquean", () => {
  const result =
    evaluateProductSelectionCandidate({
      ...goodProductSelectionCandidate,
      medicalClaimsRisk:
        "high",
    })

  assert.equal(result.decision, "blocked")
  assert.equal(result.state, "BLOCKED")
  assert.ok(
    result.riskFlags.some(flag =>
      flag.code === "medical_claims_high"
    )
  )
})

test("product selection decision service: advisor output conserva estructura esperada", () => {
  const evaluation = {
    normalizedCandidate:
      goodProductSelectionCandidate,
    config: {},
    economics:
      calculateProductEconomics(
        goodProductSelectionCandidate
      ),
    operationalRisk:
      classifyOperationalRisk(
        goodProductSelectionCandidate
      ),
    ebayRisk:
      classifyEbayRisk(
        goodProductSelectionCandidate
      ),
    marketReview:
      null,
  }

  const decisionResult =
    determineProductSelectionDecision(
      evaluation
    )
  const output =
    buildProductSelectionAdvisorOutput({
      ...evaluation,
      decisionResult,
    })

  assert.equal(output.decision, "approve")
  assert.equal(
    output.state,
    "APPROVED_FOR_DRAFT"
  )
  assert.equal(
    typeof output.mainReason,
    "string"
  )
  assert.ok(
    Array.isArray(output.riskFlags)
  )
  assert.equal(
    typeof output.keyNumbers.netProfit,
    "number"
  )
  assert.equal(
    typeof output.nextHumanAction,
    "string"
  )
  assert.equal(output.advisoryOnly, true)
})

test("product selection QA fixture: contiene exactamente QA-001 a QA-010", () => {
  const expectedCaseIds =
    Array.from(
      {
        length:
          10,
      },
      (_, index) =>
        `QA-${String(index + 1).padStart(3, "0")}`
    )

  assert.equal(
    productSelectionQaCases.length,
    expectedCaseIds.length
  )

  const caseIds =
    productSelectionQaCases.map(item =>
      item.caseId
    )

  assert.deepEqual(
    caseIds,
    expectedCaseIds
  )
  assert.equal(
    new Set(caseIds).size,
    caseIds.length
  )

  for (const item of productSelectionQaCases) {
    assert.equal(
      typeof item.caseId,
      "string"
    )
    assert.equal(
      typeof item.name,
      "string"
    )
    assert.equal(
      typeof item.candidate,
      "object"
    )
    assert.ok(item.candidate)
    assert.equal(
      typeof item.expected,
      "object"
    )
    assert.ok(item.expected)
    assert.ok(
      item.expected.decision ||
        Array.isArray(item.expected.allowedDecisions)
    )
    assert.ok(
      item.expected.state ||
        Array.isArray(item.expected.allowedStates)
    )
    assert.ok(
      Array.isArray(item.expected.riskFlags)
    )
  }
})

test("product selection QA fixture: no contiene datos sensibles ni reales", () => {
  const rawFixture =
    fs.readFileSync(
      productSelectionQaFixturePath,
      "utf8"
    ).toLowerCase()

  const forbiddenFragments = [
    "bearer ",
    "secret",
    "cred" + "ential",
    "pass" + "word",
    "tok" + "en",
    "oa" + "uth",
    "http://",
    "https://",
  ]

  for (const fragment of forbiddenFragments) {
    assert.equal(
      rawFixture.includes(fragment),
      false,
      `fixture contains forbidden fragment: ${fragment}`
    )
  }
})

for (const item of productSelectionQaCases) {
  test(`product selection QA fixture: ${item.caseId} ${item.name}`, () => {
    const result =
      evaluateProductSelectionCandidate(
        item.candidate
      )

    if (item.expected.allowedDecisions) {
      assert.ok(
        item.expected.allowedDecisions.includes(
          result.decision
        ),
        `${item.caseId} unexpected decision ${result.decision}`
      )
    } else {
      assert.equal(
        result.decision,
        item.expected.decision
      )
    }

    if (item.expected.allowedStates) {
      assert.ok(
        item.expected.allowedStates.includes(
          result.state
        ),
        `${item.caseId} unexpected state ${result.state}`
      )
    } else {
      assert.equal(
        result.state,
        item.expected.state
      )
    }

    const resultRiskCodes =
      result.riskFlags.map(flag =>
        flag.code
      )

    for (const expectedRisk of item.expected.riskFlags) {
      assert.ok(
        resultRiskCodes.includes(expectedRisk),
        `${item.caseId} missing risk ${expectedRisk}`
      )
    }

    assert.equal(result.advisoryOnly, true)
    assert.equal(
      typeof result.mainReason,
      "string"
    )
    assert.ok(
      result.mainReason.length > 0
    )
    assert.equal(
      typeof result.nextHumanAction,
      "string"
    )
    assert.ok(
      result.nextHumanAction.length > 0
    )
    assert.equal(
      typeof result.keyNumbers,
      "object"
    )
    assert.equal(
      typeof result.keyNumbers.netProfit,
      "number"
    )
    assert.equal(
      typeof result.keyNumbers.roiPercent,
      "number"
    )
    assert.equal(
      typeof result.keyNumbers.netMarginPercent,
      "number"
    )
  })
}

test("product selection manual runner: evalua QA-001 desde fixture local", () => {
  const input =
    loadJsonFile(
      productSelectionQaFixturePath
    )
  const [caseEntry] =
    selectCandidateCases(input, {
      caseId:
        "QA-001",
    })
  const [result] =
    evaluateCandidateCases([
      caseEntry,
    ])

  assert.equal(
    result.evaluation.decision,
    "approve"
  )
  assert.equal(
    result.evaluation.state,
    "APPROVED_FOR_DRAFT"
  )
})

test("product selection manual runner: all procesa QA-001 a QA-010", () => {
  const input =
    loadJsonFile(
      productSelectionQaFixturePath
    )
  const caseEntries =
    selectCandidateCases(input, {
      all:
        true,
    })
  const results =
    evaluateCandidateCases(
      caseEntries
    )

  assert.equal(
    results.length,
    10
  )
  assert.deepEqual(
    results.map(item =>
      item.caseEntry.caseId
    ),
    [
      "QA-001",
      "QA-002",
      "QA-003",
      "QA-004",
      "QA-005",
      "QA-006",
      "QA-007",
      "QA-008",
      "QA-009",
      "QA-010",
    ]
  )
  assert.ok(
    results.every(item =>
      item.evaluation.advisoryOnly === true
    )
  )
})

test("product selection manual runner: case faltante produce error claro", () => {
  assert.throws(
    () =>
      selectCandidateCases(
        productSelectionQaCases,
        {
          caseId:
            "QA-999",
        }
      ),
    /Case not found: QA-999/
  )
})

test("product selection manual runner: input invalido o sin candidate produce error claro", () => {
  assert.throws(
    () =>
      selectCandidateCases(
        null,
        {
          all:
            true,
        }
      ),
    /Candidate input must be an object/
  )

  assert.throws(
    () =>
      selectCandidateCases(
        {
          caseId:
            "manual",
          candidate:
            null,
        },
        {
          caseId:
            "manual",
        }
      ),
    /Input candidate must be an object/
  )

  assert.throws(
    () =>
      parseArgs([
        "--file",
        productSelectionQaFixturePath,
      ]),
    /Pass --case <caseId> or --all/
  )
})

test("product selection manual runner: formato resume decision sin imprimir payload completo", () => {
  const [caseEntry] =
    selectCandidateCases(
      productSelectionQaCases,
      {
        caseId:
          "QA-010",
      }
    )
  const [result] =
    evaluateCandidateCases([
      caseEntry,
    ])
  const summary =
    formatEvaluationSummary(
      result.caseEntry,
      result.evaluation
    )

  assert.match(
    summary,
    /Decision: review/
  )
  assert.match(
    summary,
    /State: DATA_INCOMPLETE/
  )
  assert.match(
    summary,
    /Advisory only: true/
  )
  assert.match(
    summary,
    /Next human action:/
  )
  assert.doesNotMatch(
    summary,
    /supplierSku|internalSku|supplierName/
  )
  assert.doesNotMatch(
    summary,
    /"candidate"|"expected"/
  )
})

test("product selection manual runner: CLI helper soporta case y all", () => {
  const caseOutput =
    runCli([
      "--file",
      productSelectionQaFixturePath,
      "--case",
      "QA-001",
    ])

  assert.match(
    caseOutput,
    /Case: QA-001 - Producto ideal/
  )
  assert.match(
    caseOutput,
    /Decision: approve/
  )
  assert.match(
    caseOutput,
    /State: APPROVED_FOR_DRAFT/
  )

  const allOutput =
    runCli([
      "--file",
      productSelectionQaFixturePath,
      "--all",
    ])

  assert.match(
    allOutput,
    /Case: QA-001 - Producto ideal/
  )
  assert.match(
    allOutput,
    /Case: QA-010 - Imágenes no autorizadas/
  )
})

test("product selection manual runner: modulo local sin red ni acciones reales", () => {
  const source =
    fs.readFileSync(
      "tools/product-selection-evaluate-candidate.mjs",
      "utf8"
    )

  assert.doesNotMatch(
    source,
    /fetch\(|createClient|supabase|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/i
  )
  assert.doesNotMatch(
    source,
    /ebay.*api|oa(?:uth)|to(?:ken)|Authorization|publish|publicar|draft real/i
  )
})

const idealListingGeneratorCandidate = {
  title:
    "Compact Desk Organizer with Drawer, Space Saving Office Storage, Black",
  category:
    "Home Office Organization",
  supplierCost:
    12,
  supplierShippingCost:
    2,
  estimatedEbayPrice:
    32,
  buyerShippingCharge:
    0,
  stockAvailable:
    10,
  stockStatus:
    "available",
  weight:
    1.2,
  weightUnit:
    "lb",
  dimensions: {
    length:
      10,
    width:
      6,
    height:
      4,
    unit:
      "in",
  },
  brand:
    "Generic Home",
  productType:
    "Desk Organizer",
  color:
    "Black",
  material:
    "Plastic",
  features: [
    "Drawer",
    "Space Saving",
  ],
  brandRisk:
    "low",
  veroRisk:
    "low",
  medicalClaimsRisk:
    "low",
  returnRisk:
    "low",
  imageAuthorizationStatus:
    "authorized",
  soldCompsMedianPrice:
    31,
}

test("listing proposal generator: genera propuesta para candidato simulado ideal", () => {
  const result =
    buildListingProposalFromCandidate(
      idealListingGeneratorCandidate,
      {
        sourceCaseId:
          "GEN-001",
        sourceType:
          "unit_test_fixture",
        selectionDecision:
          "approve",
        selectionState:
          "APPROVED_FOR_DRAFT",
      }
    )

  assert.equal(
    result.schemaVersion,
    "EBAY_LISTING_DRAFT_SCHEMA_V1"
  )
  assert.ok(result.source)
  assert.ok(result.listingProposal)
  assert.ok(result.review)
  assert.ok(result.safety)
  assert.equal(
    result.listingProposal.advisoryOnly,
    true
  )
  assert.equal(
    result.listingProposal.humanReviewRequired,
    true
  )
  assert.equal(
    result.source.sourceCaseId,
    "GEN-001"
  )
  assert.equal(
    result.listingProposal.title.value,
    idealListingGeneratorCandidate.title
  )
})

test("listing proposal generator: safety flags V1 son conservadores", () => {
  const result =
    buildListingProposalFromCandidate(
      idealListingGeneratorCandidate
    )

  assert.deepEqual(
    result.safety,
    {
      advisoryOnly:
        true,
      localOnly:
        true,
      externalCallsMade:
        false,
      ebayApiUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
      listingMutated:
        false,
      requiresHumanReview:
        true,
    }
  )
})

test("listing proposal generator: no aprueba manual draft automaticamente", () => {
  const result =
    buildListingProposalFromCandidate(
      idealListingGeneratorCandidate
    )

  assert.notEqual(
    result.review.listingState,
    "LISTING_APPROVED_FOR_MANUAL_DRAFT"
  )
  assert.ok(
    [
      "LISTING_DRAFT_READY",
      "LISTING_REVIEW_REQUIRED",
      "LISTING_DATA_INCOMPLETE",
    ].includes(result.review.listingState)
  )
})

test("listing proposal generator: imagen unknown deja propuesta incompleta o en revision", () => {
  const result =
    buildListingProposalFromCandidate({
      ...idealListingGeneratorCandidate,
      imageAuthorizationStatus:
        "unknown",
    })

  assert.ok(
    [
      "LISTING_DATA_INCOMPLETE",
      "LISTING_REVIEW_REQUIRED",
    ].includes(result.review.listingState)
  )
  assert.ok(
    result.review.missingData.includes(
      "imageAuthorizationStatus"
    )
  )
  assert.ok(
    result.review.riskFlags.includes(
      "image_authorization_missing"
    )
  )
})

test("listing proposal generator: riesgo VeRO alto bloquea propuesta", () => {
  const result =
    buildListingProposalFromCandidate({
      ...idealListingGeneratorCandidate,
      veroRisk:
        "high",
    })

  assert.equal(
    result.review.listingState,
    "LISTING_BLOCKED"
  )
  assert.ok(
    result.review.riskFlags.includes(
      "brand_or_vero_high"
    )
  )
  assert.ok(
    result.listingProposal.compliance.blockedReasons.includes(
      "brand_or_vero_high"
    )
  )
})

test("listing proposal generator: claims medicos high bloquean propuesta", () => {
  const result =
    buildListingProposalFromCandidate({
      ...idealListingGeneratorCandidate,
      medicalClaimsRisk:
        "high",
    })

  assert.equal(
    result.review.listingState,
    "LISTING_BLOCKED"
  )
  assert.ok(
    result.review.riskFlags.includes(
      "medical_claims_high"
    )
  )
})

test("listing proposal generator: sin peso o dimensiones registra missing data", () => {
  const result =
    buildListingProposalFromCandidate({
      ...idealListingGeneratorCandidate,
      weight:
        null,
      dimensions:
        null,
    })

  assert.equal(
    result.review.listingState,
    "LISTING_DATA_INCOMPLETE"
  )
  assert.ok(
    result.review.missingData.includes(
      "weight"
    )
  )
  assert.ok(
    result.review.missingData.includes(
      "dimensions"
    )
  )
})

test("listing proposal generator: no inventa Brand MPN Model ni certificaciones", () => {
  const result =
    buildListingProposalFromCandidate({
      ...idealListingGeneratorCandidate,
      brand:
        null,
      model:
        null,
      mpn:
        null,
      material:
        null,
    })

  assert.deepEqual(
    result.listingProposal.itemSpecifics.required,
    {
      Type:
        "Desk Organizer",
      Color:
        "Black",
    }
  )
  assert.ok(
    result.listingProposal.itemSpecifics.missing.includes(
      "Brand"
    )
  )
  assert.ok(
    result.listingProposal.itemSpecifics.missing.includes(
      "MPN"
    )
  )
  assert.ok(
    result.listingProposal.itemSpecifics.missing.includes(
      "Model"
    )
  )

  const descriptionText =
    JSON.stringify(
      result.listingProposal.description
    )

  assert.doesNotMatch(
    descriptionText,
    /FDA|certified|official/i
  )
})

test("listing proposal generator: description evita claims medicos y promesas absolutas", () => {
  const result =
    buildListingProposalFromCandidate({
      ...idealListingGeneratorCandidate,
      title:
        "Guaranteed FDA Approved Organizer Cures Back Pain",
    })

  const descriptionText =
    JSON.stringify(
      result.listingProposal.description
    )

  assert.doesNotMatch(
    descriptionText,
    /cures back pain|FDA approved|guaranteed/i
  )
  assert.doesNotMatch(
    result.listingProposal.title.value,
    /cures|FDA approved|guaranteed/i
  )
})

test("listing proposal generator: modulo local sin red ni acciones reales", () => {
  const source =
    fs.readFileSync(
      "lib/ebay-winner-pipeline/listing-proposal-generator.mjs",
      "utf8"
    )

  assert.doesNotMatch(
    source,
    /fetch\(|createClient|supabase|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/i
  )
  assert.doesNotMatch(
    source,
    /ebay\s+api|oa(?:uth)|to(?:ken)|draft real/i
  )
})

test("listing proposal generator fixture: contiene exactamente LISTING-GEN-001 a LISTING-GEN-006", () => {
  const expectedCaseIds =
    Array.from(
      {
        length:
          6,
      },
      (_, index) =>
        `LISTING-GEN-${String(index + 1).padStart(3, "0")}`
    )

  assert.equal(
    ebayListingGeneratorCases.length,
    expectedCaseIds.length
  )

  const caseIds =
    ebayListingGeneratorCases.map(item =>
      item.caseId
    )

  assert.deepEqual(
    caseIds,
    expectedCaseIds
  )
  assert.equal(
    new Set(caseIds).size,
    caseIds.length
  )

  for (const item of ebayListingGeneratorCases) {
    assert.equal(
      typeof item.caseId,
      "string"
    )
    assert.equal(
      typeof item.name,
      "string"
    )
    assert.equal(
      typeof item.candidate,
      "object"
    )
    assert.ok(item.candidate)
    assert.equal(
      typeof item.expected,
      "object"
    )
    assert.ok(item.expected)
  }
})

test("listing proposal generator fixture: no contiene datos sensibles ni reales", () => {
  const rawFixture =
    fs.readFileSync(
      ebayListingGeneratorFixturePath,
      "utf8"
    ).toLowerCase()

  const forbiddenFragments = [
    "bearer ",
    "secret",
    "cred" + "ential",
    "pass" + "word",
    "tok" + "en",
    "oa" + "uth",
    "http://",
    "https://",
  ]

  for (const fragment of forbiddenFragments) {
    assert.equal(
      rawFixture.includes(fragment),
      false,
      `listing fixture contains forbidden fragment: ${fragment}`
    )
  }
})

test("listing image plan fixture: existe y cumple schema V1", () => {
  assert.ok(
    fs.existsSync(
      ebayListingImagePlanFixturePath
    )
  )
  assert.equal(
    ebayListingImagePlanFixture.schemaVersion,
    "EBAY_LISTING_IMAGE_PLAN_SCHEMA_V1"
  )
  assert.equal(
    ebayListingImagePlanFixture.caseId,
    "LISTING-GEN-001"
  )
  assert.ok(
    [
      "IMAGE_PLAN_READY_FOR_REVIEW",
      "IMAGE_PLAN_NEEDS_DATA",
      "IMAGE_PLAN_NEEDS_REPLACEMENT",
      "IMAGE_PLAN_COMPLIANCE_REVIEW_REQUIRED",
      "IMAGE_PLAN_BLOCKED",
    ].includes(
      ebayListingImagePlanFixture.imagePlanStatus
    )
  )
  assert.ok(
    [
      "authorized",
      "unknown",
      "unauthorized",
    ].includes(
      ebayListingImagePlanFixture.imageAuthorizationStatus
    )
  )
})

test("listing image plan fixture: required y optional images esperadas", () => {
  assert.ok(
    Array.isArray(
      ebayListingImagePlanFixture.requiredImages
    )
  )
  assert.ok(
    Array.isArray(
      ebayListingImagePlanFixture.optionalImages
    )
  )

  const requiredRoles =
    new Set(
      ebayListingImagePlanFixture.requiredImages.map(
        image => image.imageRole
      )
    )
  const optionalRoles =
    new Set(
      ebayListingImagePlanFixture.optionalImages.map(
        image => image.imageRole
      )
    )

  for (const role of [
    "main",
    "angle",
    "detail",
    "dimensions",
    "package_contents",
  ]) {
    assert.ok(
      requiredRoles.has(role),
      `missing required image role: ${role}`
    )
  }

  for (const role of [
    "lifestyle",
    "infographic",
    "comparison",
  ]) {
    assert.ok(
      optionalRoles.has(role),
      `missing optional image role: ${role}`
    )
  }
})

test("listing image plan fixture: slots usan valores permitidos", () => {
  const allowedRoles =
    new Set([
      "main",
      "angle",
      "lifestyle",
      "dimensions",
      "detail",
      "package_contents",
      "comparison",
      "infographic",
      "variant",
      "other",
    ])
  const allowedStatuses =
    new Set([
      "available",
      "missing",
      "needs_replacement",
      "needs_authorization",
      "blocked",
    ])
  const allowedAuthorizationStatuses =
    new Set([
      "authorized",
      "unknown",
      "unauthorized",
    ])
  const allowedQualityStatuses =
    new Set([
      "acceptable",
      "low_resolution",
      "unclear",
      "misleading",
      "compliance_risk",
      "not_reviewed",
    ])

  const imageSlots = [
    ...ebayListingImagePlanFixture.requiredImages,
    ...ebayListingImagePlanFixture.optionalImages,
  ]

  for (const slot of imageSlots) {
    assert.equal(
      typeof slot.slotId,
      "string"
    )
    assert.equal(
      typeof slot.label,
      "string"
    )
    assert.equal(
      typeof slot.purpose,
      "string"
    )
    assert.equal(
      typeof slot.required,
      "boolean"
    )
    assert.ok(
      allowedRoles.has(slot.imageRole)
    )
    assert.ok(
      allowedStatuses.has(slot.status)
    )
    assert.ok(
      allowedAuthorizationStatuses.has(
        slot.authorizationStatus
      )
    )
    assert.ok(
      allowedQualityStatuses.has(
        slot.qualityStatus
      )
    )
    assert.ok(
      Array.isArray(slot.notes)
    )
  }
})

test("listing image plan fixture: safety flags seguros", () => {
  assert.deepEqual(
    ebayListingImagePlanFixture.safetyFlags,
    {
      advisoryOnly:
        true,
      localOnly:
        true,
      imageGenerationPerformed:
        false,
      externalCallsMade:
        false,
      ebayApiUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
      listingMutated:
        false,
      requiresHumanReview:
        true,
    }
  )
})

test("listing image plan fixture: dimensions faltante refleja needs data", () => {
  const dimensionsSlot =
    ebayListingImagePlanFixture.requiredImages.find(
      image =>
        image.imageRole === "dimensions"
    )

  assert.equal(
    dimensionsSlot?.required,
    true
  )
  assert.equal(
    dimensionsSlot?.status,
    "missing"
  )
  assert.equal(
    ebayListingImagePlanFixture.imagePlanStatus,
    "IMAGE_PLAN_NEEDS_DATA"
  )
  assert.ok(
    ebayListingImagePlanFixture.missingImages.includes(
      "dimensions"
    )
  )
  assert.ok(
    ebayListingImagePlanFixture.requiredHumanActions.some(
      action =>
        /dimensions/i.test(action)
    )
  )
})

test("listing image plan fixture: no contiene campos prohibidos ni URLs", () => {
  const rawFixture =
    fs.readFileSync(
      ebayListingImagePlanFixturePath,
      "utf8"
    )

  assert.doesNotMatch(
    rawFixture,
    /https?:\/\//i
  )

  const forbiddenFieldNames = [
    "tok" + "en",
    "pass" + "word",
    "sec" + "ret",
    "cred" + "ential",
    "auth" + "orization",
    "apiKey",
    "supplierPrivateData",
    "supplierUrl",
    "customerData",
    "cookies",
    "base64Image",
    "localPath",
  ]

  function collectKeys(value, keys = []) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectKeys(item, keys)
      }
      return keys
    }

    if (
      value &&
      typeof value === "object"
    ) {
      for (const [
        key,
        childValue,
      ] of Object.entries(value)) {
        keys.push(key)
        collectKeys(childValue, keys)
      }
    }

    return keys
  }

  const lowerKeys =
    collectKeys(
      ebayListingImagePlanFixture
    ).map(key => key.toLowerCase())

  for (const fieldName of forbiddenFieldNames) {
    assert.equal(
      lowerKeys.includes(
        fieldName.toLowerCase()
      ),
      false,
      `image plan fixture contains forbidden field: ${fieldName}`
    )
  }
})

test("listing image QA result fixture: existe y cumple schema V1", () => {
  assert.ok(
    fs.existsSync(
      ebayListingImageQaResultFixturePath
    )
  )
  assert.equal(
    ebayListingImageQaResultFixture.resultVersion,
    "EBAY_LISTING_IMAGE_QA_RESULT_SCHEMA_V1"
  )
  assert.equal(
    ebayListingImageQaResultFixture.sourceSchemaVersion,
    "EBAY_LISTING_IMAGE_PLAN_SCHEMA_V1"
  )
  assert.equal(
    ebayListingImageQaResultFixture.caseId,
    "LISTING-GEN-001"
  )
  assert.equal(
    ebayListingImageQaResultFixture.sourceImagePlanStatus,
    "IMAGE_PLAN_NEEDS_DATA"
  )
  assert.equal(
    ebayListingImageQaResultFixture.imageQaStatus,
    "IMAGE_QA_NEEDS_DATA"
  )
  assert.equal(
    ebayListingImageQaResultFixture.recommendedPipelineState,
    "LISTING_DATA_INCOMPLETE"
  )
  assert.ok(
    ebayListingImageQaResultFixture.missingImageRoles.includes(
      "dimensions"
    )
  )
})

test("listing image QA result fixture: evaluated slots esperados", () => {
  assert.ok(
    Array.isArray(
      ebayListingImageQaResultFixture.evaluatedSlots
    )
  )

  const slotsById =
    Object.fromEntries(
      ebayListingImageQaResultFixture.evaluatedSlots.map(
        slot => [
          slot.slotId,
          slot,
        ]
      )
    )

  for (const slotId of [
    "main-001",
    "angle-001",
    "detail-001",
    "dimensions-001",
    "package-contents-001",
  ]) {
    assert.ok(
      slotsById[slotId],
      `missing evaluated slot: ${slotId}`
    )
  }

  assert.equal(
    slotsById["dimensions-001"].slotStatus,
    "needs_data"
  )
  assert.equal(
    typeof slotsById["dimensions-001"].requiredHumanAction,
    "string"
  )

  for (const slotId of [
    "main-001",
    "angle-001",
    "detail-001",
    "package-contents-001",
  ]) {
    assert.equal(
      slotsById[slotId].slotStatus,
      "passed"
    )
  }
})

test("listing image QA result fixture: safety flags seguros", () => {
  assert.deepEqual(
    ebayListingImageQaResultFixture.safetyFlags,
    {
      advisoryOnly:
        true,
      localOnly:
        true,
      imageGenerationPerformed:
        false,
      externalCallsMade:
        false,
      ebayApiUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
      listingMutated:
        false,
      requiresHumanReview:
        true,
    }
  )
})

test("listing image QA result fixture: no contiene campos prohibidos ni URLs", () => {
  const rawFixture =
    fs.readFileSync(
      ebayListingImageQaResultFixturePath,
      "utf8"
    )

  assert.doesNotMatch(
    rawFixture,
    /https?:\/\//i
  )

  const forbiddenFieldNames = [
    "tok" + "en",
    "pass" + "word",
    "sec" + "ret",
    "cred" + "ential",
    "auth" + "orization",
    "apiKey",
    "supplierPrivateData",
    "supplierUrl",
    "customerData",
    "cookies",
    "base64Image",
    "localPath",
  ]

  function collectKeys(value, keys = []) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectKeys(item, keys)
      }
      return keys
    }

    if (
      value &&
      typeof value === "object"
    ) {
      for (const [
        key,
        childValue,
      ] of Object.entries(value)) {
        keys.push(key)
        collectKeys(childValue, keys)
      }
    }

    return keys
  }

  const lowerKeys =
    collectKeys(
      ebayListingImageQaResultFixture
    ).map(key => key.toLowerCase())

  for (const fieldName of forbiddenFieldNames) {
    assert.equal(
      lowerKeys.includes(
        fieldName.toLowerCase()
      ),
      false,
      `image QA result fixture contains forbidden field: ${fieldName}`
    )
  }
})

test("image generation prompt plan fixture: existe y cumple schema V1", () => {
  assert.ok(
    fs.existsSync(
      ebayListingImageGenerationPromptPlanFixturePath
    )
  )
  assert.equal(
    ebayListingImageGenerationPromptPlanFixture.promptVersion,
    "IMAGE_GENERATION_PROMPT_PLAN_SCHEMA_V1"
  )
  assert.equal(
    ebayListingImageGenerationPromptPlanFixture.caseId,
    "LISTING-GEN-001"
  )
  assert.equal(
    ebayListingImageGenerationPromptPlanFixture.imageRole,
    "lifestyle_product_in_use"
  )
  assert.ok(
    [
      "main_product_image",
      "white_background_product_image",
      "lifestyle_product_in_use",
      "detail_closeup",
      "dimensions_visual",
      "package_contents_visual",
      "comparison_visual",
      "infographic_visual",
      "us_buyer_trust_visual",
      "variant_visual",
    ].includes(
      ebayListingImageGenerationPromptPlanFixture.imageRole
    )
  )
  assert.equal(
    ebayListingImageGenerationPromptPlanFixture.targetBuyer,
    "us_ebay_buyer"
  )
  assert.equal(
    ebayListingImageGenerationPromptPlanFixture.language,
    "en"
  )
  assert.ok(
    [
      "PROMPT_PLAN_READY_FOR_HUMAN_REVIEW",
      "PROMPT_PLAN_NEEDS_DATA",
      "PROMPT_PLAN_BLOCKED",
    ].includes(
      ebayListingImageGenerationPromptPlanFixture.promptStatus
    )
  )
  assert.equal(
    ebayListingImageGenerationPromptPlanFixture.promptStatus,
    "PROMPT_PLAN_NEEDS_DATA"
  )
})

test("image generation prompt plan fixture: datos y estrategia visual seguros", () => {
  assert.equal(
    typeof ebayListingImageGenerationPromptPlanFixture.productFacts,
    "object"
  )
  assert.ok(
    ebayListingImageGenerationPromptPlanFixture.productFacts
  )
  assert.equal(
    ebayListingImageGenerationPromptPlanFixture.productFacts.factsVerified,
    false
  )
  assert.equal(
    typeof ebayListingImageGenerationPromptPlanFixture.visualStrategy,
    "object"
  )
  assert.equal(
    ebayListingImageGenerationPromptPlanFixture.visualStrategy.mobileFirst,
    true
  )
  assert.equal(
    ebayListingImageGenerationPromptPlanFixture.visualStrategy.productMustRemainHero,
    true
  )
  assert.ok(
    Array.isArray(
      ebayListingImageGenerationPromptPlanFixture.allowedClaims
    )
  )
  assert.ok(
    Array.isArray(
      ebayListingImageGenerationPromptPlanFixture.prohibitedClaims
    )
  )
  assert.ok(
    Array.isArray(
      ebayListingImageGenerationPromptPlanFixture.requiredElements
    )
  )
  assert.ok(
    Array.isArray(
      ebayListingImageGenerationPromptPlanFixture.forbiddenElements
    )
  )
  assert.ok(
    Array.isArray(
      ebayListingImageGenerationPromptPlanFixture.safetyRules
    )
  )
})

test("image generation prompt plan fixture: trust signals no se usan sin verificar", () => {
  const trustSignals =
    ebayListingImageGenerationPromptPlanFixture.trustSignals

  for (const signalName of [
    "freeShipping",
    "shipsFromUsa",
    "inStockInUsa",
    "usaFlag",
  ]) {
    assert.equal(
      trustSignals[signalName].verified,
      false
    )
    assert.equal(
      trustSignals[signalName].allowed,
      false
    )
    assert.equal(
      Object.hasOwn(
        trustSignals[signalName],
        "text"
      ),
      false,
      `unverified trust signal should not expose text: ${signalName}`
    )
  }
})

test("image generation prompt plan fixture: output requirements y safety flags seguros", () => {
  assert.deepEqual(
    ebayListingImageGenerationPromptPlanFixture.outputRequirements,
    {
      intendedUse:
        "internal_review_only",
      imageGenerationAllowed:
        false,
      requiresImageQa:
        true,
      requiresHumanReview:
        true,
      doNotPublish:
        true,
      doNotCreateRealDraft:
        true,
    }
  )
  assert.deepEqual(
    ebayListingImageGenerationPromptPlanFixture.safetyFlags,
    {
      advisoryOnly:
        true,
      localOnly:
        true,
      openAiApiUsed:
        false,
      imageGenerated:
        false,
      externalCallsMade:
        false,
      ebayApiUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
      listingMutated:
        false,
      requiresHumanReview:
        true,
    }
  )
  assert.ok(
    Array.isArray(
      ebayListingImageGenerationPromptPlanFixture.requiredHumanActions
    )
  )
  assert.ok(
    ebayListingImageGenerationPromptPlanFixture.requiredHumanActions.length > 0
  )
})

test("image generation prompt plan fixture: no contiene campos prohibidos, URLs ni secretos", () => {
  const rawFixture =
    fs.readFileSync(
      ebayListingImageGenerationPromptPlanFixturePath,
      "utf8"
    )

  assert.doesNotMatch(
    rawFixture,
    /https?:\/\//i
  )

  const forbiddenFieldNames = [
    "finalPrompt",
    "productionPrompt",
    "openAiPayload",
    "apiKey",
    "auth" + "orization",
    "tok" + "en",
    "sec" + "ret",
    "pass" + "word",
    "base64Image",
    "imageUrl",
    "draftId",
    "listingId",
  ]

  function collectKeysAndValues(
    value,
    collected = {
      keys:
        [],
      values:
        [],
    }
  ) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectKeysAndValues(
          item,
          collected
        )
      }
      return collected
    }

    if (
      value &&
      typeof value === "object"
    ) {
      for (const [
        key,
        childValue,
      ] of Object.entries(value)) {
        collected.keys.push(key)
        collectKeysAndValues(
          childValue,
          collected
        )
      }
      return collected
    }

    if (typeof value === "string") {
      collected.values.push(value)
    }

    return collected
  }

  const collected =
    collectKeysAndValues(
      ebayListingImageGenerationPromptPlanFixture
    )

  const lowerKeys =
    collected.keys.map(key =>
      key.toLowerCase()
    )

  for (const fieldName of forbiddenFieldNames) {
    assert.equal(
      lowerKeys.includes(
        fieldName.toLowerCase()
      ),
      false,
      `prompt plan fixture contains forbidden field: ${fieldName}`
    )
  }

  for (const value of collected.values) {
    assert.doesNotMatch(
      value,
      /https?:\/\//i
    )
    assert.doesNotMatch(
      value,
      /bearer\s+|sk-[a-z0-9_-]+|api[_ -]?key|auth(?:orization)?\s*header|password|secret|credential|token/i
    )
  }
})

test("image generation dry run result fixture: existe y cumple schema V1", () => {
  assert.ok(
    fs.existsSync(
      ebayListingImageGenerationDryRunResultFixturePath
    )
  )
  assert.equal(
    ebayListingImageGenerationDryRunResultFixture.resultVersion,
    "IMAGE_GENERATION_DRY_RUN_RESULT_SCHEMA_V1"
  )
  assert.equal(
    ebayListingImageGenerationDryRunResultFixture.caseId,
    "LISTING-GEN-001"
  )
  assert.equal(
    ebayListingImageGenerationDryRunResultFixture.sourcePromptPlanVersion,
    "IMAGE_GENERATION_PROMPT_PLAN_SCHEMA_V1"
  )
  assert.equal(
    ebayListingImageGenerationDryRunResultFixture.imageRole,
    "lifestyle_product_in_use"
  )
  assert.equal(
    ebayListingImageGenerationDryRunResultFixture.targetBuyer,
    "us_ebay_buyer"
  )
  assert.equal(
    ebayListingImageGenerationDryRunResultFixture.language,
    "en"
  )
  assert.ok(
    [
      "DRY_RUN_READY_FOR_HUMAN_REVIEW",
      "DRY_RUN_NEEDS_DATA",
      "DRY_RUN_BLOCKED",
      "DRY_RUN_REJECTED",
    ].includes(
      ebayListingImageGenerationDryRunResultFixture.dryRunStatus
    )
  )
  assert.equal(
    ebayListingImageGenerationDryRunResultFixture.dryRunStatus,
    "DRY_RUN_NEEDS_DATA"
  )
})

test("image generation dry run result fixture: needs data mantiene decision coherente", () => {
  assert.ok(
    [
      "KEEP_AS_PROMPT_PLAN_NEEDS_DATA",
      "REQUEST_MORE_PRODUCT_DATA",
      "REQUEST_TRUST_SIGNAL_VERIFICATION",
      "REQUEST_MODEL_OR_IMAGE_AUTHORIZATION",
    ].includes(
      ebayListingImageGenerationDryRunResultFixture.recommendedNextState
    )
  )
  assert.equal(
    typeof ebayListingImageGenerationDryRunResultFixture.decisionSummary,
    "string"
  )
  assert.ok(
    ebayListingImageGenerationDryRunResultFixture.decisionSummary.length > 0
  )
  assert.ok(
    Array.isArray(
      ebayListingImageGenerationDryRunResultFixture.blockingReasons
    )
  )
  assert.ok(
    Array.isArray(
      ebayListingImageGenerationDryRunResultFixture.missingData
    )
  )
  assert.ok(
    ebayListingImageGenerationDryRunResultFixture.missingData.length > 0
  )

  for (const missingData of [
    "verified dimensions required",
    "verified material required",
    "free shipping verification required",
    "ships from USA verification required",
    "in stock in USA verification required",
    "model/image authorization review required",
  ]) {
    assert.ok(
      ebayListingImageGenerationDryRunResultFixture.missingData.includes(
        missingData
      ),
      `missing dry run missingData: ${missingData}`
    )
  }

  assert.ok(
    Array.isArray(
      ebayListingImageGenerationDryRunResultFixture.verifiedFactsUsed
    )
  )
  assert.ok(
    Array.isArray(
      ebayListingImageGenerationDryRunResultFixture.unverifiedFacts
    )
  )
  assert.ok(
    ebayListingImageGenerationDryRunResultFixture.unverifiedFacts.length > 0
  )
})

test("image generation dry run result fixture: trust signals no verificados no quedan allowed", () => {
  const trustSignalEvaluation =
    ebayListingImageGenerationDryRunResultFixture.trustSignalEvaluation

  assert.equal(
    typeof trustSignalEvaluation,
    "object"
  )
  assert.ok(trustSignalEvaluation)

  for (const signalName of [
    "freeShipping",
    "shipsFromUsa",
    "inStockInUsa",
    "usaFlag",
  ]) {
    const signal =
      trustSignalEvaluation[signalName]

    assert.equal(
      typeof signal,
      "object"
    )
    assert.equal(
      signal.allowed,
      false
    )
    assert.equal(
      signal.verified,
      false
    )
    assert.ok(
      [
        "needs_data",
        "blocked",
        "not_requested",
      ].includes(signal.decision)
    )
    assert.notEqual(
      signal.decision,
      "allowed",
      `unverified trust signal cannot be allowed: ${signalName}`
    )
    assert.equal(
      typeof signal.reason,
      "string"
    )
    assert.ok(signal.reason.length > 0)
  }
})

test("image generation dry run result fixture: prompt safety evaluation bloquea ejecucion real", () => {
  assert.deepEqual(
    ebayListingImageGenerationDryRunResultFixture.promptSafetyEvaluation,
    {
      promptPlanBasedOnVerifiedFacts:
        false,
      containsFinalProductionPrompt:
        false,
      containsOpenAiPayload:
        false,
      containsApiKeyOrSecret:
        false,
      containsBase64Image:
        false,
      containsRealImageUrl:
        false,
      containsUnauthorizedBrandOrLogo:
        false,
      containsMedicalClaim:
        false,
      containsGuaranteedResultClaim:
        false,
      containsUnverifiedTrustSignal:
        true,
      containsUnverifiedDimensions:
        true,
      containsUnverifiedMaterial:
        true,
      containsPersonOrModel:
        true,
      requiresModelRelease:
        true,
      safeForInternalReviewOnly:
        true,
    }
  )
  assert.ok(
    Array.isArray(
      ebayListingImageGenerationDryRunResultFixture.humanReviewRequirements
    )
  )
  assert.ok(
    ebayListingImageGenerationDryRunResultFixture.humanReviewRequirements.length > 0
  )
})

test("image generation dry run result fixture: output requirements y safety flags seguros", () => {
  assert.deepEqual(
    ebayListingImageGenerationDryRunResultFixture.outputRequirements,
    {
      intendedUse:
        "internal_review_only",
      mayGenerateImage:
        false,
      mayCallOpenAi:
        false,
      mayCreateRealDraft:
        false,
      mayPublish:
        false,
      mayMutateListing:
        false,
      requiresImageQaBeforeUse:
        true,
      requiresHumanReview:
        true,
    }
  )
  assert.deepEqual(
    ebayListingImageGenerationDryRunResultFixture.safetyFlags,
    {
      advisoryOnly:
        true,
      dryRunOnly:
        true,
      documentationOnly:
        false,
      openAiApiUsed:
        false,
      imageGenerated:
        false,
      externalCallsMade:
        false,
      ebayApiUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
      listingMutated:
        false,
      reportPersisted:
        false,
      humanReviewRequired:
        true,
    }
  )
})

test("image generation dry run result fixture: no contiene campos prohibidos, URLs ni secretos", () => {
  const rawFixture =
    fs.readFileSync(
      ebayListingImageGenerationDryRunResultFixturePath,
      "utf8"
    )

  assert.doesNotMatch(
    rawFixture,
    /https?:\/\//i
  )

  const forbiddenFieldNames = [
    "finalPrompt",
    "productionPrompt",
    "openAiPayload",
    "apiKey",
    "auth" + "orization",
    "tok" + "en",
    "sec" + "ret",
    "pass" + "word",
    "base64Image",
    "imageUrl",
    "draftId",
    "listingId",
    "publishedListingId",
  ]

  function collectKeysAndValues(
    value,
    collected = {
      keys:
        [],
      values:
        [],
    }
  ) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectKeysAndValues(
          item,
          collected
        )
      }
      return collected
    }

    if (
      value &&
      typeof value === "object"
    ) {
      for (const [
        key,
        childValue,
      ] of Object.entries(value)) {
        collected.keys.push(key)
        collectKeysAndValues(
          childValue,
          collected
        )
      }
      return collected
    }

    if (typeof value === "string") {
      collected.values.push(value)
    }

    return collected
  }

  const collected =
    collectKeysAndValues(
      ebayListingImageGenerationDryRunResultFixture
    )

  const lowerKeys =
    collected.keys.map(key =>
      key.toLowerCase()
    )

  for (const fieldName of forbiddenFieldNames) {
    assert.equal(
      lowerKeys.includes(
        fieldName.toLowerCase()
      ),
      false,
      `dry run result fixture contains forbidden field: ${fieldName}`
    )
  }

  for (const value of collected.values) {
    assert.doesNotMatch(
      value,
      /https?:\/\//i
    )
    assert.doesNotMatch(
      value,
      /bearer\s+|sk-[a-z0-9_-]+|api[_ -]?key|auth(?:orization)?\s*header|password|secret|credential|token/i
    )
  }
})

test("manual image brief fixture: existe y cumple schema V1", () => {
  assert.ok(
    fs.existsSync(
      ebayListingManualImageBriefFixturePath
    )
  )
  assert.equal(
    ebayListingManualImageBriefFixture.briefVersion,
    "IMAGE_GENERATION_MANUAL_IMAGE_BRIEF_SCHEMA_V1"
  )
  assert.equal(
    ebayListingManualImageBriefFixture.caseId,
    "LISTING-GEN-001"
  )
  assert.equal(
    ebayListingManualImageBriefFixture.sourcePromptPlanVersion,
    "IMAGE_GENERATION_PROMPT_PLAN_SCHEMA_V1"
  )
  assert.equal(
    ebayListingManualImageBriefFixture.sourceDryRunResultVersion,
    "IMAGE_GENERATION_DRY_RUN_RESULT_SCHEMA_V1"
  )
  assert.equal(
    ebayListingManualImageBriefFixture.imageRole,
    "lifestyle_product_in_use"
  )
  assert.equal(
    ebayListingManualImageBriefFixture.targetBuyer,
    "us_ebay_buyer"
  )
  assert.equal(
    ebayListingManualImageBriefFixture.language,
    "en"
  )
  assert.equal(
    ebayListingManualImageBriefFixture.briefStatus,
    "MANUAL_IMAGE_BRIEF_NEEDS_DATA"
  )
  assert.ok(
    [
      "manual_external_tool",
      "manual_photo_editing",
      "manual_design",
    ].includes(
      ebayListingManualImageBriefFixture.creationMode
    )
  )

  for (const fieldName of [
    "productFacts",
    "visualGoal",
    "trustSignals",
    "manualInstructions",
    "safetyNotes",
    "qaChecklist",
    "requiredHumanActions",
    "approvalRequirements",
    "safetyFlags",
  ]) {
    assert.equal(
      typeof ebayListingManualImageBriefFixture[fieldName],
      "object",
      `manual image brief missing object field: ${fieldName}`
    )
    assert.ok(
      ebayListingManualImageBriefFixture[fieldName]
    )
  }

  for (const fieldName of [
    "allowedClaims",
    "prohibitedClaims",
    "requiredElements",
    "forbiddenElements",
    "manualInstructions",
    "safetyNotes",
    "qaChecklist",
    "requiredHumanActions",
  ]) {
    assert.ok(
      Array.isArray(
        ebayListingManualImageBriefFixture[fieldName]
      ),
      `manual image brief missing array field: ${fieldName}`
    )
    assert.ok(
      ebayListingManualImageBriefFixture[fieldName].length > 0
    )
  }
})

test("manual image brief fixture: trust signals no verificados no se usan", () => {
  const trustSignals =
    ebayListingManualImageBriefFixture.trustSignals

  for (const signalName of [
    "freeShipping",
    "shipsFromUsa",
    "inStockInUsa",
    "usaFlag",
  ]) {
    const signal =
      trustSignals[signalName]

    assert.equal(
      typeof signal,
      "object"
    )
    assert.ok(signal)
    assert.equal(
      signal.allowed,
      false
    )
    assert.equal(
      signal.verified,
      false
    )
    assert.ok(
      [
        "needs_verification",
        "do_not_use",
      ].includes(signal.instruction)
    )
    assert.notEqual(
      signal.instruction,
      "use",
      `unverified trust signal cannot be used: ${signalName}`
    )
  }
})

test("manual image brief fixture: approval requirements bloquean publicacion y draft real", () => {
  assert.deepEqual(
    ebayListingManualImageBriefFixture.approvalRequirements,
    {
      requiresImageQa:
        true,
      requiresHumanReview:
        true,
      requiresPolicyReviewBeforeEbayUse:
        true,
      approvedForInternalUseOnly:
        false,
      approvedForListingReview:
        false,
      doNotPublish:
        true,
      doNotCreateRealDraft:
        true,
    }
  )
})

test("manual image brief fixture: safety flags mantienen side effects false", () => {
  assert.deepEqual(
    ebayListingManualImageBriefFixture.safetyFlags,
    {
      advisoryOnly:
        true,
      manualWorkflowOnly:
        true,
      imageGenerated:
        false,
      openAiApiUsed:
        false,
      externalCallsMade:
        false,
      ebayApiUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
      listingMutated:
        false,
      reportPersisted:
        false,
      humanReviewRequired:
        true,
    }
  )
})

test("manual image brief fixture: no contiene campos prohibidos, URLs ni secretos", () => {
  const rawFixture =
    fs.readFileSync(
      ebayListingManualImageBriefFixturePath,
      "utf8"
    )

  assert.doesNotMatch(
    rawFixture,
    /https?:\/\//i
  )

  const forbiddenFieldNames = [
    "finalPrompt",
    "productionPrompt",
    "openAiPayload",
    "apiKey",
    "auth" + "orization",
    "tok" + "en",
    "sec" + "ret",
    "pass" + "word",
    "base64Image",
    "imageUrl",
    "draftId",
    "listingId",
    "publishedListingId",
  ]

  function collectKeysAndValues(
    value,
    collected = {
      keys:
        [],
      values:
        [],
    }
  ) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectKeysAndValues(
          item,
          collected
        )
      }
      return collected
    }

    if (
      value &&
      typeof value === "object"
    ) {
      for (const [
        key,
        childValue,
      ] of Object.entries(value)) {
        collected.keys.push(key)
        collectKeysAndValues(
          childValue,
          collected
        )
      }
      return collected
    }

    if (typeof value === "string") {
      collected.values.push(value)
    }

    return collected
  }

  const collected =
    collectKeysAndValues(
      ebayListingManualImageBriefFixture
    )

  const lowerKeys =
    collected.keys.map(key =>
      key.toLowerCase()
    )

  for (const fieldName of forbiddenFieldNames) {
    assert.equal(
      lowerKeys.includes(
        fieldName.toLowerCase()
      ),
      false,
      `manual image brief fixture contains forbidden field: ${fieldName}`
    )
  }

  for (const value of collected.values) {
    assert.doesNotMatch(
      value,
      /https?:\/\//i
    )
    assert.doesNotMatch(
      value,
      /bearer\s+|sk-[a-z0-9_-]+|api[_ -]?key|auth(?:orization)?\s*header|password|secret|credential|token/i
    )
  }
})

test("first ebay listing package fixture: existe y cumple contrato V1", () => {
  assert.ok(
    fs.existsSync(
      ebayFirstListingPackageFixturePath
    )
  )
  assert.equal(
    ebayFirstListingPackageFixture.packageVersion,
    "EBAY_FIRST_LISTING_PACKAGE_V1"
  )
  assert.equal(
    ebayFirstListingPackageFixture.caseId,
    "LISTING-GEN-001"
  )
  assert.equal(
    ebayFirstListingPackageFixture.marketplace,
    "ebay_us"
  )
  assert.equal(
    ebayFirstListingPackageFixture.language,
    "en"
  )
  assert.equal(
    ebayFirstListingPackageFixture.listingPackageStatus,
    "LISTING_PACKAGE_NEEDS_DATA"
  )
  assert.equal(
    ebayFirstListingPackageFixture.publicationStatus,
    "NOT_READY_TO_PUBLISH"
  )
  assert.ok(
    ebayFirstListingPackageFixture.listingTitle.length > 0
  )
  assert.ok(
    ebayFirstListingPackageFixture.listingTitle.length <= 80
  )
  assert.ok(
    Array.isArray(
      ebayFirstListingPackageFixture.titleAlternatives
    )
  )
  assert.ok(
    ebayFirstListingPackageFixture.categorySuggestion
  )
  assert.equal(
    ebayFirstListingPackageFixture.categorySuggestion.needsHumanConfirmation,
    true
  )
  assert.ok(
    ebayFirstListingPackageFixture.condition
  )
  assert.equal(
    ebayFirstListingPackageFixture.condition.needsHumanConfirmation,
    true
  )
})

test("first ebay listing package fixture: contiene copy, specifics y secciones operativas", () => {
  assert.ok(
    ebayFirstListingPackageFixture.buyerFacingCopy
  )
  assert.ok(
    Array.isArray(
      ebayFirstListingPackageFixture.buyerFacingCopy.bullets
    )
  )
  assert.ok(
    ebayFirstListingPackageFixture.buyerFacingCopy.bullets.length > 0
  )
  assert.equal(
    typeof ebayFirstListingPackageFixture.buyerFacingCopy.descriptionPlainText,
    "string"
  )
  assert.ok(
    ebayFirstListingPackageFixture.buyerFacingCopy.descriptionPlainText.length > 0
  )
  assert.equal(
    typeof ebayFirstListingPackageFixture.buyerFacingCopy.descriptionHtml,
    "string"
  )
  assert.ok(
    ebayFirstListingPackageFixture.buyerFacingCopy.descriptionHtml.length > 0
  )

  const requiredArrays = [
    "itemSpecifics",
    "missingData",
    "riskFlags",
    "requiredHumanActions",
    "prePublishChecklist",
  ]

  for (const fieldName of requiredArrays) {
    assert.ok(
      Array.isArray(
        ebayFirstListingPackageFixture[fieldName]
      ),
      `${fieldName} must be an array`
    )
    assert.ok(
      ebayFirstListingPackageFixture[fieldName].length > 0,
      `${fieldName} must not be empty`
    )
  }

  const requiredObjects = [
    "priceStrategy",
    "shipping",
    "returns",
    "trustSignals",
    "optionalUsBuyerTrustVisual",
    "mainImagePolicy",
    "imagePlan",
    "recoveredImagePromptStrategy",
    "terapeakValidation",
    "soldListingsBenchmarkStrategy",
    "postConversionPackStrategy",
    "lunaPortexPackFulfillmentReview",
    "packImageStrategy",
    "recommendedNextLoop",
    "safetyFlags",
  ]

  for (const fieldName of requiredObjects) {
    assert.equal(
      typeof ebayFirstListingPackageFixture[fieldName],
      "object"
    )
    assert.notEqual(
      ebayFirstListingPackageFixture[fieldName],
      null
    )
  }
})

test("first ebay listing package fixture: optional US buyer trust visual nunca va en main image", () => {
  const trustVisual =
    ebayFirstListingPackageFixture.optionalUsBuyerTrustVisual

  assert.equal(
    trustVisual.status,
    "TRUST_VISUAL_NEEDS_VERIFICATION"
  )
  assert.equal(
    trustVisual.allowedOnlyAfterVerification,
    true
  )
  assert.equal(
    trustVisual.neverOnMainImage,
    true
  )
  assert.deepEqual(
    trustVisual.recommendedPlacementsAfterVerification,
    [
      "shipping section",
      "description top trust bar",
      "secondary trust visual",
    ]
  )

  for (const exclusion of [
    "no trust badges",
    "no USA flag",
    "no shipping badges",
  ]) {
    assert.ok(
      trustVisual.mainImageExclusions.includes(exclusion),
      `main image exclusion missing: ${exclusion}`
    )
  }

  for (const [
    signalName,
    signal,
  ] of Object.entries(trustVisual.signals)) {
    assert.equal(
      signal.verified,
      false,
      `${signalName} must remain unverified`
    )
    assert.equal(
      signal.allowed,
      false,
      `${signalName} must remain disallowed until verified`
    )
    assert.equal(
      signal.instruction,
      "do_not_use_until_verified"
    )
  }

  assert.equal(
    trustVisual.signals.usaFlag.mustNotImplyMadeInUsa,
    true
  )
  assert.deepEqual(
    trustVisual.signals.usaFlag.placementAllowedAfterVerification,
    [
      "secondary trust visual",
    ]
  )
})

test("first ebay listing package fixture: sold listings benchmark no requiere copia manual completa", () => {
  const benchmarkStrategy =
    ebayFirstListingPackageFixture.soldListingsBenchmarkStrategy

  assert.equal(
    benchmarkStrategy.strategyStatus,
    "SOLD_LISTINGS_BENCHMARK_REQUIRED"
  )
  assert.equal(
    benchmarkStrategy.requiredBeforePublish,
    true
  )
  assert.equal(
    benchmarkStrategy.manualCopyNotScalable,
    true
  )
  assert.equal(
    benchmarkStrategy.preferredFutureAcquisitionMode,
    "ebay_only_connector_or_import"
  )
  assert.equal(
    benchmarkStrategy.currentLoopAcquisitionMode,
    "structured_requirement_only"
  )
  assert.ok(
    benchmarkStrategy.sourceOptionsFuture.includes(
      "ebay_api_or_authorized_ebay_connector_if_supported"
    )
  )

  for (const item of [
    "ebay_api_connection",
    "oauth",
    "automated_sold_items_import",
    "sell_one_like_this_import",
    "scraping",
    "browser_automation",
  ]) {
    assert.ok(
      benchmarkStrategy.notImplementedInThisLoop.includes(item),
      `notImplementedInThisLoop must include: ${item}`
    )
  }

  assert.match(
    benchmarkStrategy.manualWorkflowLimit,
    /should not require copying a full competitor listing manually field by field/i
  )
  assert.match(
    benchmarkStrategy.professionalUseRule,
    /create an original, verified, compliant listing package/i
  )
  assert.match(
    benchmarkStrategy.publicationRule,
    /Do not mark listing as ready to publish/i
  )
})

test("first ebay listing package fixture: Sell one like this queda como referencia estructural", () => {
  const sellOneLikeThisStrategy =
    ebayFirstListingPackageFixture.soldListingsBenchmarkStrategy
      .sellOneLikeThisStrategy

  assert.equal(
    sellOneLikeThisStrategy.allowedAsReference,
    true
  )
  assert.equal(
    sellOneLikeThisStrategy.futureAutomationPreferred,
    true
  )
  assert.equal(
    sellOneLikeThisStrategy.manualFullCopyRequired,
    false
  )
  assert.equal(
    sellOneLikeThisStrategy.mustRewriteTitle,
    true
  )
  assert.equal(
    sellOneLikeThisStrategy.mustRewriteDescription,
    true
  )
  assert.equal(
    sellOneLikeThisStrategy.mustVerifyItemSpecifics,
    true
  )
  assert.equal(
    sellOneLikeThisStrategy.mustReplacePhotos,
    true
  )
  assert.equal(
    sellOneLikeThisStrategy.mustVerifyShipping,
    true
  )
  assert.equal(
    sellOneLikeThisStrategy.mustVerifyReturns,
    true
  )
  assert.equal(
    sellOneLikeThisStrategy.mustVerifyCondition,
    true
  )
  assert.equal(
    sellOneLikeThisStrategy.mustVerifyPriceAndMargin,
    true
  )
  assert.equal(
    sellOneLikeThisStrategy.mustNotCopyCompetitorContent,
    true
  )
  assert.equal(
    sellOneLikeThisStrategy.status,
    "REFERENCE_ONLY_IMPORT_NOT_IMPLEMENTED"
  )
})

test("first ebay listing package fixture: post conversion pack strategy espera datos reales", () => {
  const packStrategy =
    ebayFirstListingPackageFixture.postConversionPackStrategy

  assert.equal(
    packStrategy.strategyStatus,
    "WAITING_FOR_CONVERSION_DATA"
  )
  assert.equal(
    packStrategy.appliesToConsumables,
    true
  )
  assert.equal(
    packStrategy.appliesToHighRotationProducts,
    true
  )
  assert.match(
    packStrategy.activationRule,
    /after the single-unit listing shows real conversion signals/i
  )

  for (const requiredSignal of [
    "first_sales_detected",
    "watchers_or_cart_activity",
    "repeat_purchase_potential_confirmed",
    "Terapeak demand validated",
    "margin after pack fees confirmed",
  ]) {
    assert.ok(
      packStrategy.conversionSignalsRequired.includes(requiredSignal),
      `missing conversion signal: ${requiredSignal}`
    )
  }

  const packSizes =
    packStrategy.recommendedPackOptions.map(option =>
      option.packSize
    )

  assert.deepEqual(
    packSizes,
    [
      2,
      3,
      6,
      12,
    ]
  )

  for (const option of packStrategy.recommendedPackOptions) {
    assert.equal(
      option.requiresMarginValidation,
      true,
      `pack x${option.packSize} must require margin validation`
    )
  }

  for (const blocker of [
    "single-unit listing has conversion evidence",
    "Luna Portex packing or bundling fee is confirmed",
    "Terapeak or sales data supports demand",
  ]) {
    assert.ok(
      packStrategy.doNotCreatePackBefore.includes(blocker),
      `missing pack blocker: ${blocker}`
    )
  }
})

test("first ebay listing package fixture: Luna Portex pack fulfillment fee requiere verificacion", () => {
  const fulfillmentReview =
    ebayFirstListingPackageFixture.lunaPortexPackFulfillmentReview

  assert.equal(
    fulfillmentReview.requiredBeforePackListing,
    true
  )
  assert.equal(
    fulfillmentReview.status,
    "PACKING_FEE_VERIFICATION_REQUIRED"
  )
  assert.match(
    fulfillmentReview.reason,
    /Luna Portex service fee/i
  )

  for (const fee of [
    "bundle_preparation_fee",
    "pick_and_pack_fee",
  ]) {
    assert.ok(
      fulfillmentReview.feesToVerify.includes(fee),
      `missing Luna Portex fee to verify: ${fee}`
    )
  }

  assert.match(
    fulfillmentReview.marginRule,
    /Do not approve pack listings/i
  )
  assert.match(
    fulfillmentReview.marginRule,
    /Luna Portex packing fee/i
  )

  for (const action of [
    "Confirm Luna Portex fee for pack x6",
    "Confirm Luna Portex fee for pack x12",
    "Calculate margin per pack size before creating pack listing",
  ]) {
    assert.ok(
      fulfillmentReview.requiredHumanActions.includes(action),
      `missing Luna Portex pack action: ${action}`
    )
  }
})

test("first ebay listing package fixture: pack image strategy mantiene catalog image autorizado y evita packs falsos", () => {
  const packImageStrategy =
    ebayFirstListingPackageFixture.packImageStrategy

  assert.equal(
    packImageStrategy.status,
    "PACK_IMAGES_NOT_READY"
  )
  assert.match(
    packImageStrategy.mainImageRule,
    /authorized Luna Portex catalog product image/i
  )
  assert.equal(
    packImageStrategy.aiGeneratedMainImageAllowed,
    false
  )
  assert.equal(
    packImageStrategy.packSecondaryImagesAllowedAfterReview,
    true
  )

  const packImageRoles =
    packImageStrategy.recommendedPackImages.map(image =>
      image.role
    )

  assert.deepEqual(
    packImageRoles,
    [
      "pack_quantity_visual",
      "bulk_value_visual",
      "household_stockup_lifestyle",
    ]
  )

  assert.ok(
    packImageStrategy.rules.some(rule =>
      /Do not show 6 or 12 units unless pack quantity is real\./.test(rule)
    )
  )
  assert.ok(
    packImageStrategy.rules.some(rule =>
      /Do not use Free Shipping or Ships from USA unless verified\./.test(rule)
    )
  )
})

test("first ebay listing package fixture: main image requiere catalog image autorizado y enhancement controlado", () => {
  const mainImagePolicy =
    ebayFirstListingPackageFixture.mainImagePolicy
  const enhancementPolicy =
    ebayFirstListingPackageFixture.mainImageEnhancementPolicy

  assert.equal(
    mainImagePolicy.imageSourceRequired,
    "authorized_luna_portex_catalog_product_image"
  )
  assert.equal(
    mainImagePolicy.sourceAuthorizationRequired,
    true
  )
  assert.equal(
    mainImagePolicy.catalogSource,
    "luna_portex"
  )
  assert.equal(
    mainImagePolicy.physicalProductInSellerPossessionRequired,
    false
  )
  assert.equal(
    mainImagePolicy.enhancementRequired,
    true
  )
  assert.equal(
    mainImagePolicy.finalBackgroundRequired,
    "pure_white"
  )
  assert.ok(
    mainImagePolicy.minimumResolutionPx >= 1600
  )
  assert.equal(
    mainImagePolicy.productCentered,
    true
  )
  assert.equal(
    mainImagePolicy.productShouldFillFramePercent,
    80
  )
  assert.equal(
    mainImagePolicy.textAllowed,
    false
  )
  assert.equal(
    mainImagePolicy.trustBadgesAllowed,
    false
  )
  assert.equal(
    mainImagePolicy.usaFlagAllowed,
    false
  )
  assert.equal(
    mainImagePolicy.thirdPartyLogosAllowed,
    false
  )
  assert.equal(
    mainImagePolicy.watermarksAllowed,
    false
  )
  assert.equal(
    mainImagePolicy.status,
    "AUTHORIZED_CATALOG_IMAGE_REQUIRED_FOR_MAIN_IMAGE"
  )
  assert.equal(
    mainImagePolicy.aiGeneratedProductAllowed,
    false
  )
  assert.equal(
    mainImagePolicy.aiAssistedBackgroundCleanupAllowedAfterHumanReview,
    true
  )
  assert.equal(
    enhancementPolicy.sourceImageRequired,
    "authorized_luna_portex_catalog_product_image"
  )
  assert.equal(
    enhancementPolicy.status,
    "CATALOG_IMAGE_ENHANCEMENT_REQUIRED"
  )
  assert.ok(
    enhancementPolicy.allowedEnhancements.includes(
      "background_cleanup_to_pure_white"
    )
  )

  for (const prohibitedEnhancement of [
    "change_product_shape",
    "invent_accessories",
    "add_trust_badges",
    "add_usa_flag",
    "create_product_from_scratch",
  ]) {
    assert.ok(
      enhancementPolicy.prohibitedEnhancements.includes(
        prohibitedEnhancement
      ),
      `missing prohibited enhancement: ${prohibitedEnhancement}`
    )
  }

  assert.equal(
    enhancementPolicy.qaRequiredBeforeUse,
    true
  )
  assert.equal(
    enhancementPolicy.humanApprovalRequired,
    true
  )
})

test("first ebay listing package fixture: secondary images siguen prompt recuperado", () => {
  const secondaryImages =
    ebayFirstListingPackageFixture.imagePlan.secondaryImages

  assert.ok(
    Array.isArray(secondaryImages)
  )
  assert.equal(
    secondaryImages.length,
    6
  )

  const expectedRoles = [
    "material_zoom",
    "package_contents",
    "dimensions",
    "main_benefit_in_action",
    "aspirational_lifestyle",
    "hands_real_use",
  ]

  assert.deepEqual(
    secondaryImages.map(image => image.role),
    expectedRoles
  )
  assert.deepEqual(
    secondaryImages.map(image => image.imageNumber),
    [
      2,
      3,
      4,
      5,
      6,
      7,
    ]
  )

  for (const image of secondaryImages) {
    assert.equal(
      image.source,
      "manual_or_ai_assisted_secondary_only"
    )
    assert.equal(
      image.status,
      "NEEDS_DATA"
    )

    if (image.role === "dimensions") {
      assert.equal(
        image.textAllowed,
        true
      )
      assert.equal(
        image.allowedTextOnlyForMeasurements,
        true
      )
      continue
    }

    assert.equal(
      image.textAllowed,
      false,
      `${image.role} must not allow text`
    )
  }
})

test("first ebay listing package fixture: recovered image prompt strategy es secundaria y controlada", () => {
  const promptStrategy =
    ebayFirstListingPackageFixture.recoveredImagePromptStrategy

  assert.equal(
    promptStrategy.source,
    "user_uploaded_pdf_prompt"
  )
  assert.equal(
    promptStrategy.secondaryImageCount,
    6
  )
  assert.equal(
    promptStrategy.primaryImageAiAllowed,
    false
  )
  assert.equal(
    promptStrategy.secondaryImagesAiAssistedAllowedAfterHumanReview,
    true
  )

  for (const requirement of [
    "1:1 square format",
    "1600x1600 px",
    "no watermarks",
    "no third-party logos",
    "keep product faithful to original reference",
    "do not invent accessories or product variations",
  ]) {
    assert.ok(
      promptStrategy.generalRequirements.includes(requirement),
      `missing prompt strategy requirement: ${requirement}`
    )
  }
})

test("first ebay listing package fixture: Terapeak validation bloquea publicacion", () => {
  const terapeakValidation =
    ebayFirstListingPackageFixture.terapeakValidation

  assert.equal(
    terapeakValidation.requiredBeforePublish,
    true
  )
  assert.equal(
    terapeakValidation.status,
    "TERAPEAK_VALIDATION_REQUIRED"
  )
  assert.equal(
    terapeakValidation.specificSearchQueryRequired,
    true
  )
  assert.equal(
    terapeakValidation.salesVolumeRequired,
    true
  )
  assert.equal(
    terapeakValidation.averageSoldPriceRequired,
    true
  )
  assert.equal(
    terapeakValidation.sellThroughRateRequired,
    true
  )
  assert.equal(
    terapeakValidation.activeListingsRequired,
    true
  )
  assert.equal(
    terapeakValidation.competitionReviewRequired,
    true
  )
  assert.equal(
    terapeakValidation.marginValidationRequired,
    true
  )
  assert.ok(
    terapeakValidation.recommendedThresholds.minimumSellThroughRatePercent >= 30
  )
  assert.ok(
    terapeakValidation.recommendedThresholds.minimumNetMarginPercent >= 20
  )
  assert.notEqual(
    ebayFirstListingPackageFixture.publicationStatus,
    "READY_TO_PUBLISH"
  )
})

test("first ebay listing package fixture: missing data incluye bloqueos criticos", () => {
  const missingData =
    ebayFirstListingPackageFixture.missingData

  for (const item of [
    "verified dimensions required",
    "verified material required",
    "verified package contents required",
    "verified stock location required",
    "verified shipping policy required",
    "Terapeak validation required",
    "sold listings benchmark required",
    "eBay sold listings benchmark import method required",
    "Sell one like this structure review required",
    "comparable sold listing price review required",
    "winning item specifics review required",
    "competitor image sequence review required",
    "original title and description rewrite required",
    "authorized Luna Portex catalog product image required",
    "source authorization required",
    "white-background main image enhancement required",
    "main image QA required",
    "conversion data required before pack strategy activation",
    "Luna Portex packing fee required before pack listings",
    "pack shipping cost required",
    "pack margin validation required",
    "pack images require actual pack quantity confirmation",
  ]) {
    assert.ok(
      missingData.includes(item),
      `missingData must include: ${item}`
    )
  }
})

test("first ebay listing package fixture: human actions incluyen pack fee y margen", () => {
  const requiredHumanActions =
    ebayFirstListingPackageFixture.requiredHumanActions

  for (const action of [
    "Monitor single-unit listing conversion before creating pack listings",
    "Verify Luna Portex packing or bundling fee for pack sizes",
    "Calculate pack x6 margin before creating pack listing",
    "Calculate pack x12 margin before creating pack listing",
    "Create separate image plan for each approved pack size",
    "Review comparable sold listings for strategy before publishing",
    "Do not manually copy competitor listing field by field",
    "Use Sell one like this only as a structural reference",
    "Define future eBay-only import method for sold listing benchmark",
    "Rewrite title and description from scratch",
    "Verify item specifics from product facts, not competitor copy",
    "Confirm authorized Luna Portex catalog product image source.",
    "Confirm source authorization before image use.",
    "Prepare white-background main image enhancement.",
    "Replace all competitor images with owned or approved images",
    "Compare sold price against margin before publishing",
  ]) {
    assert.ok(
      requiredHumanActions.includes(action),
      `requiredHumanActions must include: ${action}`
    )
  }
})

test("first ebay listing package fixture: recomienda Loop 094 para import de benchmark", () => {
  assert.equal(
    ebayFirstListingPackageFixture.recommendedNextLoop.loop,
    "LOOP 094 — eBay Sold Listings Benchmark Import Design V1"
  )
  assert.equal(
    ebayFirstListingPackageFixture.recommendedNextLoop.connectionPreference,
    "eBay only, no OpenAI API"
  )

  for (const safetyRule of [
    "no publishing",
    "no drafts",
    "no listing mutation",
    "no scraping",
    "no unauthorized data copying",
  ]) {
    assert.ok(
      ebayFirstListingPackageFixture.recommendedNextLoop.safety.includes(
        safetyRule
      ),
      `recommendedNextLoop.safety must include: ${safetyRule}`
    )
  }
})

test("first ebay listing package fixture: trust signals no verificados no se usan", () => {
  const trustSignals =
    ebayFirstListingPackageFixture.trustSignals

  for (const [
    signalName,
    signal,
  ] of Object.entries(trustSignals)) {
    assert.equal(
      signal.verified,
      false,
      `${signalName} must remain unverified in this fixture`
    )
    assert.notEqual(
      signal.instruction,
      "use",
      `${signalName} must not be used when unverified`
    )
    assert.ok(
      [
        "do_not_use",
        "needs_verification",
      ].includes(signal.instruction)
    )
  }
})

test("first ebay listing package fixture: no esta listo para publicar con missing data", () => {
  assert.ok(
    ebayFirstListingPackageFixture.missingData.length > 0
  )
  assert.notEqual(
    ebayFirstListingPackageFixture.publicationStatus,
    "READY_TO_PUBLISH"
  )
  assert.equal(
    ebayFirstListingPackageFixture.listingPackageStatus,
    "LISTING_PACKAGE_NEEDS_DATA"
  )
})

test("first ebay listing package fixture: safety flags mantienen side effects false", () => {
  assert.deepEqual(
    ebayFirstListingPackageFixture.safetyFlags,
    {
      advisoryOnly:
        true,
      humanReviewRequired:
        true,
      ebayApiUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
      listingMutated:
        false,
      openAiApiUsed:
        false,
      imageGenerated:
        false,
      externalCallsMade:
        false,
    }
  )
})

test("first ebay listing package fixture: no contiene campos prohibidos ni URLs", () => {
  const rawFixture =
    fs.readFileSync(
      ebayFirstListingPackageFixturePath,
      "utf8"
    )

  assert.doesNotMatch(
    rawFixture,
    /https?:\/\//i
  )

  const forbiddenFieldNames = [
    "draftId",
    "listingId",
    "publishedListingId",
    "oa" + "uth",
    "tok" + "en",
    "sec" + "ret",
    "apiKey",
    "auth" + "orization",
    "openAiPayload",
    "imageUrl",
    "base64Image",
  ]

  function collectKeysAndValues(
    value,
    collected = {
      keys:
        [],
      values:
        [],
    }
  ) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectKeysAndValues(
          item,
          collected
        )
      }
      return collected
    }

    if (
      value &&
      typeof value === "object"
    ) {
      for (const [
        key,
        childValue,
      ] of Object.entries(value)) {
        collected.keys.push(key)
        collectKeysAndValues(
          childValue,
          collected
        )
      }
      return collected
    }

    if (typeof value === "string") {
      collected.values.push(value)
    }

    return collected
  }

  const collected =
    collectKeysAndValues(
      ebayFirstListingPackageFixture
    )

  const lowerKeys =
    collected.keys.map(key =>
      key.toLowerCase()
    )

  for (const fieldName of forbiddenFieldNames) {
    assert.equal(
      lowerKeys.includes(
        fieldName.toLowerCase()
      ),
      false,
      `first ebay listing package fixture contains forbidden field: ${fieldName}`
    )
  }

  for (const value of collected.values) {
    assert.doesNotMatch(
      value,
      /https?:\/\//i
    )
    assert.doesNotMatch(
      value,
      /bearer\s+|sk-[a-z0-9_-]+|api[_ -]?key|auth(?:orization)?\s*header|password|secret|credential|token/i
    )
  }
})

test("first listing QA review fixture: existe y bloquea draft/publicacion", () => {
  assert.ok(
    fs.existsSync(
      ebayFirstListingQaReviewFixturePath
    )
  )
  assert.equal(
    ebayFirstListingQaReviewFixture.qaVersion,
    "EBAY_FIRST_LISTING_QA_REVIEW_V1"
  )
  assert.equal(
    ebayFirstListingQaReviewFixture.caseId,
    "LISTING-GEN-001"
  )
  assert.equal(
    ebayFirstListingQaReviewFixture.sourceListingPackageVersion,
    "EBAY_FIRST_LISTING_PACKAGE_V1"
  )
  assert.equal(
    ebayFirstListingQaReviewFixture.marketplace,
    "ebay_us"
  )
  assert.equal(
    ebayFirstListingQaReviewFixture.language,
    "en"
  )
  assert.equal(
    ebayFirstListingQaReviewFixture.qaStatus,
    "LISTING_QA_NEEDS_DATA"
  )
  assert.equal(
    ebayFirstListingQaReviewFixture.publicationRecommendation,
    "DO_NOT_PUBLISH"
  )
  assert.equal(
    ebayFirstListingQaReviewFixture.draftRecommendation,
    "DO_NOT_CREATE_DRAFT"
  )
  assert.equal(
    ebayFirstListingQaReviewFixture.overallDecision,
    "NEEDS_DATA_BEFORE_DRAFT"
  )
})

test("first listing QA review fixture: incluye section reviews criticos", () => {
  const sectionReviews =
    ebayFirstListingQaReviewFixture.sectionReviews

  assert.equal(
    typeof sectionReviews,
    "object"
  )
  assert.notEqual(
    sectionReviews,
    null
  )

  for (const reviewName of [
    "titleReview",
    "categoryReview",
    "itemSpecificsReview",
    "priceMarginReview",
    "shippingReturnsReview",
    "trustSignalsReview",
    "imageStrategyReview",
    "terapeakReview",
    "soldListingsBenchmarkReview",
    "packStrategyReview",
    "lunaPortexReview",
    "complianceReview",
  ]) {
    assert.ok(
      sectionReviews[reviewName],
      `sectionReviews must include: ${reviewName}`
    )
  }

  assert.equal(
    sectionReviews.terapeakReview.status,
    "REQUIRED_NOT_COMPLETE"
  )
  assert.equal(
    sectionReviews.soldListingsBenchmarkReview.status,
    "REQUIRED_NOT_IMPORTED"
  )
  assert.equal(
    sectionReviews.packStrategyReview.status,
    "WAITING_FOR_CONVERSION_DATA"
  )
  assert.equal(
    sectionReviews.lunaPortexReview.status,
    "PACKING_FEE_VERIFICATION_REQUIRED"
  )
  assert.match(
    sectionReviews.soldListingsBenchmarkReview.checks.join(" "),
    /eBay-only and read-only/i
  )
  assert.match(
    sectionReviews.imageStrategyReview.checks.join(" "),
    /Only the dimensions image may include text/i
  )
  assert.match(
    sectionReviews.trustSignalsReview.checks.join(" "),
    /must not imply Made in USA/i
  )
})

test("first listing QA review fixture: contiene bloqueos y acciones humanas", () => {
  for (const blockingReason of [
    "Terapeak validation required",
    "Sold listings benchmark required",
    "Authorized Luna Portex catalog product image required",
    "White-background main image enhancement required",
    "Main image source authorization required",
    "Main image QA required",
    "Trust signals verification required",
  ]) {
    assert.ok(
      ebayFirstListingQaReviewFixture.blockingReasons.includes(
        blockingReason
      ),
      `blockingReasons must include: ${blockingReason}`
    )
  }

  for (const fieldName of [
    "missingData",
    "requiredHumanActions",
    "preDraftChecklist",
    "prePublishChecklist",
  ]) {
    assert.ok(
      Array.isArray(
        ebayFirstListingQaReviewFixture[fieldName]
      ),
      `${fieldName} must be an array`
    )
    assert.ok(
      ebayFirstListingQaReviewFixture[fieldName].length > 0,
      `${fieldName} must not be empty`
    )
  }

  for (const missingDataItem of [
    "Terapeak validation required",
    "sold listings benchmark required",
    "authorized Luna Portex catalog product image required",
    "source authorization required",
    "white-background main image enhancement required",
    "main image QA required",
    "margin validation required",
  ]) {
    assert.ok(
      ebayFirstListingQaReviewFixture.missingData.includes(
        missingDataItem
      ),
      `missingData must include: ${missingDataItem}`
    )
  }

  assert.ok(
    ebayFirstListingQaReviewFixture.requiredHumanActions.includes(
      "Approve manually before draft creation"
    )
  )
  assert.ok(
    ebayFirstListingQaReviewFixture.preDraftChecklist.includes(
      "Human approval recorded before draft creation"
    )
  )
  assert.ok(
    ebayFirstListingQaReviewFixture.prePublishChecklist.includes(
      "Do not publish without final human approval"
    )
  )
})

test("first listing QA review fixture: safety flags mantienen side effects false", () => {
  assert.deepEqual(
    ebayFirstListingQaReviewFixture.safetyFlags,
    {
      advisoryOnly:
        true,
      humanReviewRequired:
        true,
      ebayApiUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
      listingMutated:
        false,
      openAiApiUsed:
        false,
      imageGenerated:
        false,
      externalCallsMade:
        false,
      reportPersisted:
        false,
    }
  )
  assert.notEqual(
    ebayFirstListingQaReviewFixture.publicationRecommendation,
    "READY_TO_PUBLISH"
  )
  assert.notEqual(
    ebayFirstListingQaReviewFixture.draftRecommendation,
    "READY_TO_CREATE_DRAFT"
  )
})

test("first listing QA review fixture: no contiene campos prohibidos ni URLs", () => {
  const rawFixture =
    fs.readFileSync(
      ebayFirstListingQaReviewFixturePath,
      "utf8"
    )

  assert.doesNotMatch(
    rawFixture,
    /https?:\/\//i
  )

  const forbiddenFieldNames = [
    "draftId",
    "listingId",
    "publishedListingId",
    "oa" + "uth",
    "tok" + "en",
    "sec" + "ret",
    "apiKey",
    "auth" + "orization",
    "openAiPayload",
    "imageUrl",
    "base64Image",
  ]

  function collectKeysAndValues(
    value,
    collected = {
      keys:
        [],
      values:
        [],
    }
  ) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectKeysAndValues(
          item,
          collected
        )
      }
      return collected
    }

    if (
      value &&
      typeof value === "object"
    ) {
      for (const [
        key,
        childValue,
      ] of Object.entries(value)) {
        collected.keys.push(key)
        collectKeysAndValues(
          childValue,
          collected
        )
      }
      return collected
    }

    if (typeof value === "string") {
      collected.values.push(value)
    }

    return collected
  }

  const collected =
    collectKeysAndValues(
      ebayFirstListingQaReviewFixture
    )

  const lowerKeys =
    collected.keys.map(key =>
      key.toLowerCase()
    )

  for (const fieldName of forbiddenFieldNames) {
    assert.equal(
      lowerKeys.includes(
        fieldName.toLowerCase()
      ),
      false,
      `first listing QA review fixture contains forbidden field: ${fieldName}`
    )
  }

  for (const value of collected.values) {
    assert.doesNotMatch(
      value,
      /https?:\/\//i
    )
    assert.doesNotMatch(
      value,
      /bearer\s+|sk-[a-z0-9_-]+|api[_ -]?key|auth(?:orization)?\s*header|password|secret|credential|token/i
    )
  }
})

test("luna portex image asset manifest fixture: existe y cumple contrato V1", () => {
  assert.ok(
    fs.existsSync(
      ebayLunaPortexImageAssetManifestFixturePath
    )
  )
  assert.equal(
    ebayLunaPortexImageAssetManifestFixture.manifestVersion,
    "EBAY_LUNA_PORTEX_IMAGE_ASSET_MANIFEST_V1"
  )
  assert.equal(
    ebayLunaPortexImageAssetManifestFixture.caseId,
    "LISTING-GEN-001"
  )
  assert.equal(
    ebayLunaPortexImageAssetManifestFixture.sourceListingPackageVersion,
    "EBAY_FIRST_LISTING_PACKAGE_V1"
  )
  assert.equal(
    ebayLunaPortexImageAssetManifestFixture.marketplace,
    "ebay_us"
  )
  assert.equal(
    ebayLunaPortexImageAssetManifestFixture.language,
    "en"
  )
  assert.equal(
    ebayLunaPortexImageAssetManifestFixture.manifestStatus,
    "IMAGE_ASSETS_NEED_SOURCE"
  )
  assert.equal(
    ebayLunaPortexImageAssetManifestFixture.publicationImpact,
    "DO_NOT_CREATE_DRAFT_UNTIL_IMAGE_QA_APPROVED"
  )

  const sourceModel =
    ebayLunaPortexImageAssetManifestFixture.imageSourceModel

  assert.equal(
    sourceModel.primarySource,
    "luna_portex_catalog"
  )
  assert.equal(
    sourceModel.authorizedCatalogImageRequired,
    true
  )
  assert.equal(
    sourceModel.physicalProductInSellerPossessionRequired,
    false
  )
  assert.equal(
    sourceModel.externalUrlsAllowedInManifest,
    false
  )
  assert.equal(
    sourceModel.base64ImagesAllowedInManifest,
    false
  )
  assert.equal(
    sourceModel.realImagesIncludedInThisManifest,
    false
  )
  assert.equal(
    sourceModel.generatedImagesIncludedInThisManifest,
    false
  )
})

test("luna portex image asset manifest fixture: main image slot bloquea draft hasta QA", () => {
  const mainImageSlot =
    ebayLunaPortexImageAssetManifestFixture.mainImageSlot

  assert.equal(
    mainImageSlot.sourceRequired,
    "authorized_luna_portex_catalog_product_image"
  )
  assert.equal(
    mainImageSlot.sourceStatus,
    "MISSING_SOURCE_IMAGE"
  )
  assert.equal(
    mainImageSlot.authorizationStatus,
    "AUTHORIZATION_REQUIRED"
  )
  assert.equal(
    mainImageSlot.enhancementStatus,
    "WHITE_BACKGROUND_ENHANCEMENT_PENDING"
  )
  assert.equal(
    mainImageSlot.qaStatus,
    "IMAGE_QA_REQUIRED"
  )
  assert.equal(
    mainImageSlot.requirements.finalBackgroundRequired,
    "pure_white"
  )
  assert.equal(
    mainImageSlot.requirements.textAllowed,
    false
  )
  assert.equal(
    mainImageSlot.requirements.trustBadgesAllowed,
    false
  )
  assert.equal(
    mainImageSlot.requirements.usaFlagAllowed,
    false
  )
  assert.equal(
    mainImageSlot.requirements.aiGeneratedProductAllowed,
    false
  )
  assert.equal(
    mainImageSlot.requirements.productAlterationAllowed,
    false
  )
  assert.ok(
    mainImageSlot.allowedEnhancements.includes(
      "background_cleanup_to_pure_white"
    )
  )

  for (const prohibitedEnhancement of [
    "change_product_shape",
    "invent_accessories",
    "add_trust_badges",
    "add_usa_flag",
    "create_product_from_scratch",
  ]) {
    assert.ok(
      mainImageSlot.prohibitedEnhancements.includes(
        prohibitedEnhancement
      ),
      `main image slot must prohibit: ${prohibitedEnhancement}`
    )
  }
})

test("luna portex image asset manifest fixture: secondary slots requieren verificacion y QA", () => {
  const secondaryImageSlots =
    ebayLunaPortexImageAssetManifestFixture.secondaryImageSlots
  const expectedRoles = [
    "material_zoom",
    "package_contents",
    "dimensions",
    "main_benefit_in_action",
    "aspirational_lifestyle",
    "hands_real_use",
  ]

  assert.equal(
    secondaryImageSlots.length,
    6
  )
  assert.deepEqual(
    secondaryImageSlots.map(slot => slot.role),
    expectedRoles
  )

  for (const slot of secondaryImageSlots) {
    assert.equal(
      slot.factVerificationRequired,
      true,
      `${slot.role} must require fact verification`
    )
    assert.equal(
      slot.imageQaRequired,
      true,
      `${slot.role} must require image QA`
    )

    if (slot.role === "dimensions") {
      assert.equal(
        slot.textAllowed,
        true
      )
      assert.equal(
        slot.allowedTextOnlyForMeasurements,
        true
      )
    } else {
      assert.equal(
        slot.textAllowed,
        false,
        `${slot.role} must not allow text`
      )
    }
  }
})

test("luna portex image asset manifest fixture: safety flags mantienen side effects false", () => {
  const safetyFlags =
    ebayLunaPortexImageAssetManifestFixture.safetyFlags

  for (const [
    flagName,
    expectedValue,
  ] of [
    [
      "realImagesIncluded",
      false,
    ],
    [
      "imageUrlsIncluded",
      false,
    ],
    [
      "base64ImagesIncluded",
      false,
    ],
    [
      "imageGenerated",
      false,
    ],
    [
      "openAiApiUsed",
      false,
    ],
    [
      "externalCallsMade",
      false,
    ],
    [
      "ebayApiUsed",
      false,
    ],
    [
      "realDraftCreated",
      false,
    ],
    [
      "publishedToEbay",
      false,
    ],
  ]) {
    assert.equal(
      safetyFlags[flagName],
      expectedValue,
      `${flagName} must be ${expectedValue}`
    )
  }
})

test("luna portex image asset manifest fixture: no contiene URLs, imagenes embebidas ni asset URLs", () => {
  const rawFixture =
    fs.readFileSync(
      ebayLunaPortexImageAssetManifestFixturePath,
      "utf8"
    )

  for (const forbiddenPattern of [
    /http:\/\//i,
    /https:\/\//i,
    /base64/i,
    /imageUrl/,
    /assetUrl/,
    /uploadedUrl/,
    /<img/i,
    /next\/image/i,
  ]) {
    assert.doesNotMatch(
      rawFixture,
      forbiddenPattern
    )
  }

  function collectStringValues(
    value,
    collected = []
  ) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectStringValues(
          item,
          collected
        )
      }
      return collected
    }

    if (
      value &&
      typeof value === "object"
    ) {
      for (const childValue of Object.values(value)) {
        collectStringValues(
          childValue,
          collected
        )
      }
      return collected
    }

    if (typeof value === "string") {
      collected.push(value)
    }

    return collected
  }

  for (const value of collectStringValues(
    ebayLunaPortexImageAssetManifestFixture
  )) {
    assert.doesNotMatch(
      value,
      /https?:\/\//i
    )
    assert.doesNotMatch(
      value,
      /base64|imageUrl|assetUrl|uploadedUrl/i
    )
  }
})

test("luna portex image source intake fixture: existe y cumple contrato V1", () => {
  assert.ok(
    fs.existsSync(
      ebayLunaPortexImageSourceIntakeFixturePath
    )
  )
  assert.equal(
    ebayLunaPortexImageSourceIntakeFixture.intakeVersion,
    "EBAY_LUNA_PORTEX_IMAGE_SOURCE_INTAKE_V1"
  )
  assert.equal(
    ebayLunaPortexImageSourceIntakeFixture.caseId,
    "LISTING-GEN-001"
  )
  assert.equal(
    ebayLunaPortexImageSourceIntakeFixture.sourceManifestVersion,
    "EBAY_LUNA_PORTEX_IMAGE_ASSET_MANIFEST_V1"
  )
  assert.equal(
    ebayLunaPortexImageSourceIntakeFixture.sourceListingPackageVersion,
    "EBAY_FIRST_LISTING_PACKAGE_V1"
  )
  assert.equal(
    ebayLunaPortexImageSourceIntakeFixture.marketplace,
    "ebay_us"
  )
  assert.equal(
    ebayLunaPortexImageSourceIntakeFixture.language,
    "en"
  )
  assert.equal(
    ebayLunaPortexImageSourceIntakeFixture.intakeStatus,
    "SOURCE_EVIDENCE_REQUIRED"
  )
  assert.equal(
    ebayLunaPortexImageSourceIntakeFixture.draftImpact,
    "DRAFT_BLOCKED_UNTIL_SOURCE_EVIDENCE_APPROVED"
  )
})

test("luna portex image source intake fixture: primary evidence bloquea sin autorizacion", () => {
  const primaryEvidence =
    ebayLunaPortexImageSourceIntakeFixture.primaryImageSourceEvidence

  assert.equal(
    primaryEvidence.sourceType,
    "luna_portex_catalog"
  )
  assert.equal(
    primaryEvidence.sourceEvidenceStatus,
    "MISSING_EVIDENCE"
  )
  assert.equal(
    primaryEvidence.authorizedUseStatus,
    "AUTHORIZATION_NOT_CONFIRMED"
  )
  assert.equal(
    primaryEvidence.catalogImageReferenceStatus,
    "CATALOG_REFERENCE_REQUIRED"
  )
  assert.equal(
    primaryEvidence.supplierPermissionStatus,
    "SUPPLIER_PERMISSION_REQUIRED"
  )
  assert.equal(
    primaryEvidence.physicalProductInSellerPossessionRequired,
    false
  )
  assert.equal(
    primaryEvidence.realImageIncluded,
    false
  )
  assert.equal(
    primaryEvidence.imageUrlIncluded,
    false
  )
  assert.equal(
    primaryEvidence.base64Included,
    false
  )
  assert.equal(
    primaryEvidence.fileUploadIncluded,
    false
  )
})

test("luna portex image source intake fixture: checklist requiere confirmacion humana", () => {
  const checklist =
    ebayLunaPortexImageSourceIntakeFixture.authorizationChecklist
  const checkIds =
    checklist.map(check => check.checkId)

  assert.ok(
    checklist.length >= 6
  )

  for (const check of checklist) {
    assert.equal(
      check.status,
      "PENDING_CONFIRMATION"
    )
    assert.equal(
      check.requiredBeforeImageQa,
      true
    )
  }

  for (const expectedCheckId of [
    "source_is_luna_portex_catalog",
    "authorized_use_confirmed",
    "product_match_confirmed",
    "no_competitor_image",
    "no_restricted_watermark",
    "enhancement_permission_confirmed",
  ]) {
    assert.ok(
      checkIds.includes(expectedCheckId),
      `authorization checklist must include: ${expectedCheckId}`
    )
  }
})

test("luna portex image source intake fixture: source validation rules son conservadoras", () => {
  const rules =
    ebayLunaPortexImageSourceIntakeFixture.sourceValidationRules

  for (const ruleName of [
    "mustBeAuthorizedLunaPortexCatalogImage",
    "mustMatchListingProduct",
    "mustNotUseCompetitorImage",
    "mustNotUseUnauthorizedSupplierImage",
    "mustNotContainRestrictedWatermark",
    "mustNotContainCompetitorBranding",
    "mustConfirmEnhancementPermission",
    "mustPassHumanSourceReviewBeforeImageQa",
    "mustPassImageQaBeforeDraft",
  ]) {
    assert.equal(
      rules[ruleName],
      true,
      `${ruleName} must remain true`
    )
  }
})

test("luna portex image source intake fixture: human review bloquea image QA y draft", () => {
  const humanReview =
    ebayLunaPortexImageSourceIntakeFixture.humanReview

  assert.equal(
    humanReview.required,
    true
  )
  assert.equal(
    humanReview.reviewStatus,
    "SOURCE_REVIEW_NOT_STARTED"
  )
  assert.equal(
    humanReview.approvalStatus,
    "NOT_APPROVED"
  )

  for (const requiredGate of [
    "main_image_enhancement",
    "manual_image_qa",
    "ebay_draft_mapping",
    "ebay_draft_creation",
  ]) {
    assert.ok(
      humanReview.approvalRequiredBefore.includes(
        requiredGate
      ),
      `human review must be required before: ${requiredGate}`
    )
  }
})

test("luna portex image source intake fixture: safety flags mantienen side effects false", () => {
  const safetyFlags =
    ebayLunaPortexImageSourceIntakeFixture.safetyFlags

  for (const [
    flagName,
    expectedValue,
  ] of [
    [
      "realImagesIncluded",
      false,
    ],
    [
      "imageUrlsIncluded",
      false,
    ],
    [
      "base64ImagesIncluded",
      false,
    ],
    [
      "fileUploadsIncluded",
      false,
    ],
    [
      "supplierPrivateDataIncluded",
      false,
    ],
    [
      "customerDataIncluded",
      false,
    ],
    [
      "imageGenerated",
      false,
    ],
    [
      "openAiApiUsed",
      false,
    ],
    [
      "externalCallsMade",
      false,
    ],
    [
      "ebayApiUsed",
      false,
    ],
    [
      "realDraftCreated",
      false,
    ],
    [
      "publishedToEbay",
      false,
    ],
  ]) {
    assert.equal(
      safetyFlags[flagName],
      expectedValue,
      `${flagName} must be ${expectedValue}`
    )
  }
})

test("luna portex image source intake fixture: no contiene URLs, payloads ni datos privados", () => {
  const rawFixture =
    fs.readFileSync(
      ebayLunaPortexImageSourceIntakeFixturePath,
      "utf8"
    )

  for (const forbiddenPattern of [
    /http:\/\//i,
    /https:\/\//i,
    /base64/i,
    /imageUrl/,
    /assetUrl/,
    /uploadedUrl/,
    /<img/i,
    /next\/image/i,
    /supplierPrivateData/,
    /customerData/,
  ]) {
    assert.doesNotMatch(
      rawFixture,
      forbiddenPattern
    )
  }

  function collectStringValues(
    value,
    collected = []
  ) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectStringValues(
          item,
          collected
        )
      }
      return collected
    }

    if (
      value &&
      typeof value === "object"
    ) {
      for (const childValue of Object.values(value)) {
        collectStringValues(
          childValue,
          collected
        )
      }
      return collected
    }

    if (typeof value === "string") {
      collected.push(value)
    }

    return collected
  }

  for (const value of collectStringValues(
    ebayLunaPortexImageSourceIntakeFixture
  )) {
    assert.doesNotMatch(
      value,
      /https?:\/\//i
    )
    assert.doesNotMatch(
      value,
      /base64|imageUrl|assetUrl|uploadedUrl|real image payload|supplier private data|customer data/i
    )
  }
})

test("luna portex image source review gate fixture: existe y cumple contrato V1", () => {
  assert.ok(
    fs.existsSync(
      ebayLunaPortexImageSourceReviewGateFixturePath
    )
  )
  assert.equal(
    ebayLunaPortexImageSourceReviewGateFixture.gateVersion,
    "EBAY_LUNA_PORTEX_IMAGE_SOURCE_REVIEW_GATE_V1"
  )
  assert.equal(
    ebayLunaPortexImageSourceReviewGateFixture.caseId,
    "LISTING-GEN-001"
  )
  assert.equal(
    ebayLunaPortexImageSourceReviewGateFixture.sourceIntakeVersion,
    "EBAY_LUNA_PORTEX_IMAGE_SOURCE_INTAKE_V1"
  )
  assert.equal(
    ebayLunaPortexImageSourceReviewGateFixture.sourceManifestVersion,
    "EBAY_LUNA_PORTEX_IMAGE_ASSET_MANIFEST_V1"
  )
  assert.equal(
    ebayLunaPortexImageSourceReviewGateFixture.sourceListingPackageVersion,
    "EBAY_FIRST_LISTING_PACKAGE_V1"
  )
  assert.equal(
    ebayLunaPortexImageSourceReviewGateFixture.marketplace,
    "ebay_us"
  )
  assert.equal(
    ebayLunaPortexImageSourceReviewGateFixture.language,
    "en"
  )
  assert.equal(
    ebayLunaPortexImageSourceReviewGateFixture.gateStatus,
    "SOURCE_REVIEW_NOT_APPROVED"
  )
  assert.equal(
    ebayLunaPortexImageSourceReviewGateFixture.gateDecision,
    "BLOCK_IMAGE_WORKFLOW"
  )
  assert.equal(
    ebayLunaPortexImageSourceReviewGateFixture.draftImpact,
    "DRAFT_BLOCKED_UNTIL_SOURCE_REVIEW_APPROVED"
  )
})

test("luna portex image source review gate fixture: review inputs siguen sin evidencia aprobada", () => {
  const reviewInputs =
    ebayLunaPortexImageSourceReviewGateFixture.reviewInputs

  assert.equal(
    reviewInputs.sourceType,
    "luna_portex_catalog"
  )
  assert.equal(
    reviewInputs.sourceEvidenceStatus,
    "MISSING_EVIDENCE"
  )
  assert.equal(
    reviewInputs.authorizedUseStatus,
    "AUTHORIZATION_NOT_CONFIRMED"
  )
  assert.equal(
    reviewInputs.humanSourceReviewStatus,
    "SOURCE_REVIEW_NOT_STARTED"
  )
  assert.equal(
    reviewInputs.realImageIncluded,
    false
  )
  assert.equal(
    reviewInputs.imageUrlIncluded,
    false
  )
  assert.equal(
    reviewInputs.base64Included,
    false
  )
  assert.equal(
    reviewInputs.fileUploadIncluded,
    false
  )
})

test("luna portex image source review gate fixture: gate checks fallan y bloquean unlock", () => {
  const gateChecks =
    ebayLunaPortexImageSourceReviewGateFixture.gateChecks
  const checkIds =
    gateChecks.map(check => check.checkId)

  assert.equal(
    gateChecks.length,
    7
  )

  for (const check of gateChecks) {
    assert.equal(
      check.status,
      "FAILED"
    )
    assert.equal(
      check.requiredToUnlock,
      true
    )
  }

  for (const expectedCheckId of [
    "source_evidence_present",
    "authorized_use_confirmed",
    "product_match_confirmed",
    "no_competitor_image_confirmed",
    "watermark_logo_review_completed",
    "enhancement_permission_confirmed",
    "human_source_review_approved",
  ]) {
    assert.ok(
      checkIds.includes(expectedCheckId),
      `review gate checks must include: ${expectedCheckId}`
    )
  }
})

test("luna portex image source review gate fixture: workflows criticos permanecen bloqueados", () => {
  const blockedWorkflows =
    ebayLunaPortexImageSourceReviewGateFixture.blockedWorkflows
  const workflowNames =
    blockedWorkflows.map(item => item.workflow)

  assert.equal(
    blockedWorkflows.length,
    4
  )

  for (const workflow of blockedWorkflows) {
    assert.equal(
      workflow.status,
      "BLOCKED"
    )
  }

  for (const expectedWorkflow of [
    "main_image_enhancement",
    "manual_image_qa",
    "ebay_draft_mapping",
    "ebay_draft_creation",
  ]) {
    assert.ok(
      workflowNames.includes(expectedWorkflow),
      `blockedWorkflows must include: ${expectedWorkflow}`
    )
  }
})

test("luna portex image source review gate fixture: human decision pide mas evidencia", () => {
  const humanDecision =
    ebayLunaPortexImageSourceReviewGateFixture.humanDecision

  assert.equal(
    humanDecision.required,
    true
  )
  assert.equal(
    humanDecision.decisionStatus,
    "NOT_REVIEWED"
  )
  assert.equal(
    humanDecision.approvalStatus,
    "NOT_APPROVED"
  )
  assert.equal(
    humanDecision.currentDecision,
    "REQUEST_MORE_SOURCE_EVIDENCE"
  )

  for (const allowedDecision of [
    "APPROVE_SOURCE_FOR_IMAGE_QA",
    "REQUEST_MORE_SOURCE_EVIDENCE",
    "REJECT_SOURCE",
  ]) {
    assert.ok(
      humanDecision.allowedDecisionValues.includes(
        allowedDecision
      ),
      `allowedDecisionValues must include: ${allowedDecision}`
    )
  }
})

test("luna portex image source review gate fixture: safety flags mantienen workflow bloqueado", () => {
  const safetyFlags =
    ebayLunaPortexImageSourceReviewGateFixture.safetyFlags

  for (const [
    flagName,
    expectedValue,
  ] of [
    [
      "sourceApproved",
      false,
    ],
    [
      "imageEnhancementUnlocked",
      false,
    ],
    [
      "imageQaUnlocked",
      false,
    ],
    [
      "draftMappingUnlocked",
      false,
    ],
    [
      "draftCreationUnlocked",
      false,
    ],
    [
      "realImagesIncluded",
      false,
    ],
    [
      "imageUrlsIncluded",
      false,
    ],
    [
      "base64ImagesIncluded",
      false,
    ],
    [
      "fileUploadsIncluded",
      false,
    ],
    [
      "supplierPrivateDataIncluded",
      false,
    ],
    [
      "customerDataIncluded",
      false,
    ],
    [
      "imageGenerated",
      false,
    ],
    [
      "openAiApiUsed",
      false,
    ],
    [
      "externalCallsMade",
      false,
    ],
    [
      "ebayApiUsed",
      false,
    ],
    [
      "realDraftCreated",
      false,
    ],
    [
      "publishedToEbay",
      false,
    ],
  ]) {
    assert.equal(
      safetyFlags[flagName],
      expectedValue,
      `${flagName} must be ${expectedValue}`
    )
  }
})

test("luna portex image source review gate fixture: no contiene URLs, payloads ni datos privados", () => {
  const rawFixture =
    fs.readFileSync(
      ebayLunaPortexImageSourceReviewGateFixturePath,
      "utf8"
    )

  for (const forbiddenPattern of [
    /http:\/\//i,
    /https:\/\//i,
    /base64/i,
    /imageUrl/,
    /assetUrl/,
    /uploadedUrl/,
    /<img/i,
    /next\/image/i,
    /supplierPrivateData/,
    /customerData/,
  ]) {
    assert.doesNotMatch(
      rawFixture,
      forbiddenPattern
    )
  }

  function collectStringValues(
    value,
    collected = []
  ) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectStringValues(
          item,
          collected
        )
      }
      return collected
    }

    if (
      value &&
      typeof value === "object"
    ) {
      for (const childValue of Object.values(value)) {
        collectStringValues(
          childValue,
          collected
        )
      }
      return collected
    }

    if (typeof value === "string") {
      collected.push(value)
    }

    return collected
  }

  for (const value of collectStringValues(
    ebayLunaPortexImageSourceReviewGateFixture
  )) {
    assert.doesNotMatch(
      value,
      /https?:\/\//i
    )
    assert.doesNotMatch(
      value,
      /base64|imageUrl|assetUrl|uploadedUrl|real image payload|supplier private data|customer data/i
    )
  }
})

test("luna portex main image enhancement brief fixture: existe y cumple contrato V1", () => {
  assert.ok(
    fs.existsSync(
      ebayLunaPortexMainImageEnhancementBriefFixturePath
    )
  )
  assert.equal(
    ebayLunaPortexMainImageEnhancementBriefFixture.briefVersion,
    "EBAY_LUNA_PORTEX_MAIN_IMAGE_ENHANCEMENT_BRIEF_V1"
  )
  assert.equal(
    ebayLunaPortexMainImageEnhancementBriefFixture.caseId,
    "LISTING-GEN-001"
  )
  assert.equal(
    ebayLunaPortexMainImageEnhancementBriefFixture.sourceReviewGateVersion,
    "EBAY_LUNA_PORTEX_IMAGE_SOURCE_REVIEW_GATE_V1"
  )
  assert.equal(
    ebayLunaPortexMainImageEnhancementBriefFixture.sourceIntakeVersion,
    "EBAY_LUNA_PORTEX_IMAGE_SOURCE_INTAKE_V1"
  )
  assert.equal(
    ebayLunaPortexMainImageEnhancementBriefFixture.sourceManifestVersion,
    "EBAY_LUNA_PORTEX_IMAGE_ASSET_MANIFEST_V1"
  )
  assert.equal(
    ebayLunaPortexMainImageEnhancementBriefFixture.sourceListingPackageVersion,
    "EBAY_FIRST_LISTING_PACKAGE_V1"
  )
  assert.equal(
    ebayLunaPortexMainImageEnhancementBriefFixture.marketplace,
    "ebay_us"
  )
  assert.equal(
    ebayLunaPortexMainImageEnhancementBriefFixture.language,
    "en"
  )
  assert.equal(
    ebayLunaPortexMainImageEnhancementBriefFixture.briefStatus,
    "ENHANCEMENT_BRIEF_READY_BUT_SOURCE_BLOCKED"
  )
  assert.equal(
    ebayLunaPortexMainImageEnhancementBriefFixture.executionStatus,
    "DO_NOT_ENHANCE_YET"
  )
  assert.equal(
    ebayLunaPortexMainImageEnhancementBriefFixture.draftImpact,
    "DRAFT_BLOCKED_UNTIL_SOURCE_REVIEW_AND_IMAGE_QA_APPROVED"
  )
})

test("luna portex main image enhancement brief fixture: source requirements bloquean ejecucion", () => {
  const sourceRequirements =
    ebayLunaPortexMainImageEnhancementBriefFixture.sourceRequirements

  assert.equal(
    sourceRequirements.requiredSource,
    "authorized_luna_portex_catalog_product_image"
  )
  assert.equal(
    sourceRequirements.currentSourceReviewStatus,
    "SOURCE_REVIEW_NOT_APPROVED"
  )
  assert.equal(
    sourceRequirements.sourceEvidenceRequired,
    true
  )
  assert.equal(
    sourceRequirements.authorizedUseRequired,
    true
  )
  assert.equal(
    sourceRequirements.productMatchRequired,
    true
  )
  assert.equal(
    sourceRequirements.competitorImageAllowed,
    false
  )
  assert.equal(
    sourceRequirements.physicalProductInSellerPossessionRequired,
    false
  )
  assert.equal(
    sourceRequirements.sourceImageIncludedInThisBrief,
    false
  )
  assert.equal(
    sourceRequirements.imageUrlIncludedInThisBrief,
    false
  )
  assert.equal(
    sourceRequirements.base64IncludedInThisBrief,
    false
  )
})

test("luna portex main image enhancement brief fixture: target output define imagen principal ebay", () => {
  const targetOutputSpec =
    ebayLunaPortexMainImageEnhancementBriefFixture.targetOutputSpec

  assert.equal(
    targetOutputSpec.finalUse,
    "ebay_main_image"
  )
  assert.equal(
    targetOutputSpec.background,
    "pure_white"
  )
  assert.ok(
    targetOutputSpec.minimumResolutionPx >= 1600
  )
  assert.equal(
    targetOutputSpec.aspectRatio,
    "1:1"
  )
  assert.equal(
    targetOutputSpec.productCentered,
    true
  )
  assert.equal(
    targetOutputSpec.textAllowed,
    false
  )
  assert.equal(
    targetOutputSpec.badgesAllowed,
    false
  )
  assert.equal(
    targetOutputSpec.usaFlagAllowed,
    false
  )
  assert.equal(
    targetOutputSpec.watermarksAllowed,
    false
  )
})

test("luna portex main image enhancement brief fixture: mejoras permitidas y prohibidas son explicitas", () => {
  const allowed =
    ebayLunaPortexMainImageEnhancementBriefFixture.allowedEnhancements
  const prohibited =
    ebayLunaPortexMainImageEnhancementBriefFixture.prohibitedEnhancements

  for (const expectedAllowedEnhancement of [
    "background_cleanup_to_pure_white",
    "product_centering",
    "crop_and_frame_optimization",
    "sharpness_and_resolution_improvement",
    "color_accuracy_preservation",
  ]) {
    assert.ok(
      allowed.includes(expectedAllowedEnhancement),
      `allowedEnhancements must include: ${expectedAllowedEnhancement}`
    )
  }

  for (const expectedProhibitedEnhancement of [
    "change_product_shape",
    "invent_accessories",
    "add_trust_badges",
    "add_usa_flag",
    "create_product_from_scratch",
    "use_competitor_image",
    "use_unauthorized_supplier_image",
  ]) {
    assert.ok(
      prohibited.includes(expectedProhibitedEnhancement),
      `prohibitedEnhancements must include: ${expectedProhibitedEnhancement}`
    )
  }
})

test("luna portex main image enhancement brief fixture: instruccion no es payload ejecutable", () => {
  const enhancementInstruction =
    ebayLunaPortexMainImageEnhancementBriefFixture.enhancementInstruction

  assert.equal(
    enhancementInstruction.notAnOpenAiPayload,
    true
  )
  assert.equal(
    enhancementInstruction.notExecutable,
    true
  )

  for (const expectedSummaryText of [
    "pure white background",
    "Do not alter the product",
    "Do not add text",
    "Do not add a USA flag",
    "Do not create the product from scratch",
  ]) {
    assert.ok(
      enhancementInstruction.summary.includes(expectedSummaryText),
      `enhancement summary must include: ${expectedSummaryText}`
    )
  }
})

test("luna portex main image enhancement brief fixture: approval gate mantiene draft bloqueado", () => {
  const approvalGate =
    ebayLunaPortexMainImageEnhancementBriefFixture.approvalGate

  assert.equal(
    approvalGate.currentGateStatus,
    "BLOCKED_BY_SOURCE_REVIEW"
  )
  assert.equal(
    approvalGate.sourceReviewRequired,
    true
  )
  assert.equal(
    approvalGate.sourceReviewApproved,
    false
  )
  assert.equal(
    approvalGate.enhancementAllowedNow,
    false
  )
  assert.equal(
    approvalGate.imageQaApproved,
    false
  )
  assert.equal(
    approvalGate.draftMappingAllowed,
    false
  )
  assert.equal(
    approvalGate.draftCreationAllowed,
    false
  )
})

test("luna portex main image enhancement brief fixture: safety flags no ejecutan imagen ni draft", () => {
  const safetyFlags =
    ebayLunaPortexMainImageEnhancementBriefFixture.safetyFlags

  for (const [
    flagName,
    expectedValue,
  ] of [
    [
      "sourceApproved",
      false,
    ],
    [
      "enhancementExecuted",
      false,
    ],
    [
      "imageQaApproved",
      false,
    ],
    [
      "realImagesIncluded",
      false,
    ],
    [
      "imageUrlsIncluded",
      false,
    ],
    [
      "base64ImagesIncluded",
      false,
    ],
    [
      "fileUploadsIncluded",
      false,
    ],
    [
      "supplierPrivateDataIncluded",
      false,
    ],
    [
      "customerDataIncluded",
      false,
    ],
    [
      "imageGenerated",
      false,
    ],
    [
      "openAiApiUsed",
      false,
    ],
    [
      "externalCallsMade",
      false,
    ],
    [
      "ebayApiUsed",
      false,
    ],
    [
      "realDraftCreated",
      false,
    ],
    [
      "publishedToEbay",
      false,
    ],
  ]) {
    assert.equal(
      safetyFlags[flagName],
      expectedValue,
      `${flagName} must be ${expectedValue}`
    )
  }
})

test("luna portex main image enhancement brief fixture: no contiene URLs, payloads ni datos privados", () => {
  const rawFixture =
    fs.readFileSync(
      ebayLunaPortexMainImageEnhancementBriefFixturePath,
      "utf8"
    )

  for (const forbiddenPattern of [
    /http:\/\//i,
    /https:\/\//i,
    /base64/i,
    /imageUrl/,
    /assetUrl/,
    /uploadedUrl/,
    /<img/i,
    /next\/image/i,
    /supplierPrivateData/,
    /customerData/,
  ]) {
    assert.doesNotMatch(
      rawFixture,
      forbiddenPattern
    )
  }

  function collectStringValues(
    value,
    collected = []
  ) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectStringValues(
          item,
          collected
        )
      }
      return collected
    }

    if (
      value &&
      typeof value === "object"
    ) {
      for (const childValue of Object.values(value)) {
        collectStringValues(
          childValue,
          collected
        )
      }
      return collected
    }

    if (typeof value === "string") {
      collected.push(value)
    }

    return collected
  }

  for (const value of collectStringValues(
    ebayLunaPortexMainImageEnhancementBriefFixture
  )) {
    assert.doesNotMatch(
      value,
      /https?:\/\//i
    )
    assert.doesNotMatch(
      value,
      /base64|imageUrl|assetUrl|uploadedUrl|real image payload|supplier private data|customer data/i
    )
  }
})

test("luna portex catalog coverage audit fixture: existe y cumple contrato V1", () => {
  assert.ok(
    fs.existsSync(
      ebayLunaPortexCatalogCoverageAuditFixturePath
    )
  )
  assert.equal(
    ebayLunaPortexCatalogCoverageAuditFixture.auditVersion,
    "EBAY_LUNA_PORTEX_CATALOG_COVERAGE_AUDIT_V1"
  )
  assert.equal(
    ebayLunaPortexCatalogCoverageAuditFixture.caseId,
    "MARKET-RADAR-LUNA-PORTEX-001"
  )
  assert.equal(
    ebayLunaPortexCatalogCoverageAuditFixture.sourceProvider,
    "luna_portex"
  )
  assert.equal(
    ebayLunaPortexCatalogCoverageAuditFixture.radarContext,
    "ebay_market_radar"
  )
  assert.equal(
    ebayLunaPortexCatalogCoverageAuditFixture.marketplace,
    "ebay_us"
  )
  assert.equal(
    ebayLunaPortexCatalogCoverageAuditFixture.language,
    "en"
  )
  assert.equal(
    ebayLunaPortexCatalogCoverageAuditFixture.coverageStatus,
    "CATALOG_COVERAGE_PARTIAL"
  )
  assert.equal(
    ebayLunaPortexCatalogCoverageAuditFixture.coverageLabel,
    "Catalog coverage: Partial — synced configured collections only"
  )
  assert.equal(
    ebayLunaPortexCatalogCoverageAuditFixture.coverageDecision,
    "DO_NOT_CLAIM_FULL_CATALOG_SCAN"
  )
})

test("luna portex catalog coverage audit fixture: sync scope queda parcial", () => {
  const syncScope =
    ebayLunaPortexCatalogCoverageAuditFixture.syncScope

  assert.equal(
    syncScope.syncMode,
    "configured_collections_only"
  )
  assert.equal(
    syncScope.fullCatalogSyncConfirmed,
    false
  )
  assert.equal(
    syncScope.additionalCollectionsMayExist,
    true
  )
  assert.equal(
    syncScope.sourceApiConnected,
    false
  )
  assert.equal(
    syncScope.realCatalogScanned,
    false
  )
  assert.equal(
    syncScope.realSupplierDataIncluded,
    false
  )
})

test("luna portex catalog coverage audit fixture: collection coverage requiere revision", () => {
  const collectionCoverage =
    ebayLunaPortexCatalogCoverageAuditFixture.collectionCoverage

  assert.ok(
    Array.isArray(
      collectionCoverage.configuredCollections
    )
  )
  assert.equal(
    collectionCoverage.configuredCollectionCount,
    0
  )
  assert.equal(
    collectionCoverage.expectedTotalCollectionCountKnown,
    false
  )
  assert.equal(
    collectionCoverage.additionalCollectionsDetectionStatus,
    "NOT_CHECKED"
  )
  assert.equal(
    collectionCoverage.missingCollectionReviewRequired,
    true
  )
})

test("luna portex catalog coverage audit fixture: count comparison no esta disponible", () => {
  const countComparison =
    ebayLunaPortexCatalogCoverageAuditFixture.countComparison

  assert.equal(
    countComparison.expectedProductCountKnown,
    false
  )
  assert.equal(
    countComparison.syncedProductCountKnown,
    false
  )
  assert.equal(
    countComparison.coveragePercentKnown,
    false
  )
  assert.equal(
    countComparison.countComparisonStatus,
    "COUNT_COMPARISON_NOT_AVAILABLE"
  )
  assert.equal(
    countComparison.requiredBeforeFullCatalogClaim,
    true
  )
})

test("luna portex catalog coverage audit fixture: display exige advertencia visible", () => {
  const displayRequirements =
    ebayLunaPortexCatalogCoverageAuditFixture.radarDisplayRequirements

  assert.equal(
    displayRequirements.mustDisplayCoverageStatus,
    true
  )
  assert.equal(
    displayRequirements.mustDisplayFullCatalogClaimWarning,
    true
  )

  for (const expectedCopy of [
    "Catalog coverage: Partial — synced configured collections only",
    "Top 50 within synced Luna Portex scope",
    "Do not claim full Luna Portex catalog scan yet",
    "Configured collections only",
    "Coverage review required",
    "Partial coverage for discovery",
    "Mandatory monitoring for linked products",
    "Protect existing reviewed/listed products",
    "Find new opportunities within synced scope",
    "Linked product not covered by current sync scope",
    "Stock and price changes may be missed",
    "Manual Luna Portex check required",
    "Protect existing products first",
  ]) {
    assert.ok(
      displayRequirements.requiredVisibleCopy.includes(expectedCopy),
      `coverage requiredVisibleCopy must include: ${expectedCopy}`
    )
  }
})

test("luna portex catalog coverage audit fixture: separa discovery radar y linked product monitor", () => {
  const radarOperatingModel =
    ebayLunaPortexCatalogCoverageAuditFixture.radarOperatingModel
  const discoveryRadarCoverage =
    ebayLunaPortexCatalogCoverageAuditFixture.discoveryRadarCoverage
  const linkedProductMonitor =
    ebayLunaPortexCatalogCoverageAuditFixture.linkedProductMonitor

  assert.equal(
    radarOperatingModel.operatingMode,
    "SYNCED_SCOPE_WITH_LINKED_PRODUCT_PROTECTION"
  )
  assert.equal(
    radarOperatingModel.fullCatalogRequiredToOperate,
    false
  )
  assert.equal(
    radarOperatingModel.fullCatalogClaimAllowed,
    false
  )
  assert.equal(
    radarOperatingModel.discoveryRankingLabel,
    "Top 50 within synced Luna Portex scope"
  )
  assert.equal(
    discoveryRadarCoverage.coverageStatus,
    "CATALOG_COVERAGE_PARTIAL"
  )
  assert.equal(
    discoveryRadarCoverage.fullCatalogClaimAllowed,
    false
  )
  assert.equal(
    discoveryRadarCoverage.operationAllowedWithinSyncedScope,
    true
  )
  assert.equal(
    linkedProductMonitor.monitorStatus,
    "LINKED_PRODUCT_MONITOR_REQUIRED"
  )
  assert.equal(
    linkedProductMonitor.priorityPolicy,
    "PROTECT_EXISTING_PRODUCTS_FIRST"
  )
  assert.equal(
    linkedProductMonitor.coverageDependency,
    "MUST_VERIFY_LINKED_PRODUCTS_IN_SYNC_SCOPE"
  )
  assert.equal(
    linkedProductMonitor.operationBlockedByPartialCatalogCoverage,
    false
  )

  for (const expectedState of [
    "candidate_created",
    "listing_package_created",
    "qa_created",
    "internal_draft_created",
    "published_on_ebay",
    "paused",
    "blocked_by_stock",
    "blocked_by_price",
    "blocked_by_image",
  ]) {
    assert.ok(
      linkedProductMonitor.linkedPipelineStates.includes(expectedState),
      `linkedPipelineStates must include: ${expectedState}`
    )
  }

  for (const expectedCoverageState of [
    "LINKED_PRODUCT_COVERED_BY_CURRENT_SYNC_SCOPE",
    "LINKED_PRODUCT_NOT_COVERED_BY_CURRENT_SYNC_SCOPE",
    "LINKED_PRODUCT_COVERAGE_UNKNOWN",
  ]) {
    assert.ok(
      linkedProductMonitor.linkedProductCoverageStates.includes(
        expectedCoverageState
      ),
      `linkedProductCoverageStates must include: ${expectedCoverageState}`
    )
  }
})

test("luna portex catalog coverage audit fixture: alerta critica productos vinculados fuera de cobertura", () => {
  const linkedProductMonitor =
    ebayLunaPortexCatalogCoverageAuditFixture.linkedProductMonitor
  const notCoveredAlert =
    linkedProductMonitor.notCoveredAlert

  assert.equal(
    notCoveredAlert.alertStatus,
    "CRITICAL_MANUAL_REVIEW_REQUIRED"
  )
  assert.equal(
    notCoveredAlert.alertLabel,
    "Linked product not covered by current sync scope"
  )
  assert.equal(
    notCoveredAlert.requiredAction,
    "Manual Luna Portex check required."
  )

  for (const expectedEvent of [
    "out_of_stock",
    "low_stock",
    "back_in_stock",
    "price_drop",
    "price_increase",
    "margin_changed",
    "source_status_changed",
    "image_status_changed",
    "compliance_status_changed",
  ]) {
    assert.ok(
      linkedProductMonitor.coveredChangeEventsToMonitor.includes(
        expectedEvent
      ),
      `coveredChangeEventsToMonitor must include: ${expectedEvent}`
    )
  }
})

test("luna portex catalog coverage audit fixture: seller priority order protege existentes primero", () => {
  const sellerPriorityOrder =
    ebayLunaPortexCatalogCoverageAuditFixture.sellerPriorityOrder

  assert.ok(
    Array.isArray(sellerPriorityOrder)
  )
  assert.equal(
    sellerPriorityOrder.length,
    5
  )
  assert.equal(
    sellerPriorityOrder[0].priority,
    1
  )
  assert.equal(
    sellerPriorityOrder[0].queue,
    "published_or_listed_products_with_stock_or_price_risk"
  )
  assert.equal(
    sellerPriorityOrder[4].priority,
    5
  )
  assert.equal(
    sellerPriorityOrder[4].queue,
    "new_opportunities_from_partial_catalog"
  )
})

test("luna portex catalog coverage audit fixture: safety flags bloquean full catalog claim", () => {
  const safetyFlags =
    ebayLunaPortexCatalogCoverageAuditFixture.safetyFlags

  for (const [
    flagName,
    expectedValue,
  ] of [
    [
      "fullCatalogClaimAllowed",
      false,
    ],
    [
      "sourceApiConnected",
      false,
    ],
    [
      "lunaPortexApiUsed",
      false,
    ],
    [
      "realSupplierDataIncluded",
      false,
    ],
    [
      "apiCallsMade",
      false,
    ],
    [
      "supabaseUsed",
      false,
    ],
    [
      "sqlUsed",
      false,
    ],
    [
      "ebayApiUsed",
      false,
    ],
    [
      "openAiApiUsed",
      false,
    ],
    [
      "publishedToEbay",
      false,
    ],
  ]) {
    assert.equal(
      safetyFlags[flagName],
      expectedValue,
      `${flagName} must be ${expectedValue}`
    )
  }
})

test("luna portex catalog coverage audit fixture: no contiene URLs ni credenciales", () => {
  const rawFixture =
    fs.readFileSync(
      ebayLunaPortexCatalogCoverageAuditFixturePath,
      "utf8"
    )

  for (const forbiddenPattern of [
    /http:\/\//i,
    /https:\/\//i,
    /supplier private data/i,
    /credential/i,
    /token/i,
    /supplierUrl/i,
    /productUrl/i,
  ]) {
    assert.doesNotMatch(
      rawFixture,
      forbiddenPattern
    )
  }
})

test("market radar seller command center fixture: existe y cumple contrato MVP V1", () => {
  assert.ok(
    fs.existsSync(
      ebayMarketRadarSellerCommandCenterMvpFixturePath
    )
  )
  assert.equal(
    ebayMarketRadarSellerCommandCenterMvpFixture.commandCenterVersion,
    "EBAY_MARKET_RADAR_SELLER_COMMAND_CENTER_MVP_V1"
  )
  assert.equal(
    ebayMarketRadarSellerCommandCenterMvpFixture.commandCenterStatus,
    "SELLER_COMMAND_CENTER_READ_ONLY_MVP"
  )
  assert.equal(
    ebayMarketRadarSellerCommandCenterMvpFixture.coverageStatus,
    "CATALOG_COVERAGE_PARTIAL"
  )
  assert.equal(
    ebayMarketRadarSellerCommandCenterMvpFixture.coverageLabel,
    "Catalog coverage: Partial — synced configured collections only"
  )
  assert.equal(
    ebayMarketRadarSellerCommandCenterMvpFixture.rankingLabel,
    "Top 50 within synced Luna Portex scope"
  )
  assert.equal(
    ebayMarketRadarSellerCommandCenterMvpFixture.operatingRule,
    "Partial coverage for discovery, mandatory monitoring for linked products"
  )
})

test("market radar seller command center fixture: queues cards y semaforo profesional", () => {
  const primaryQueueIds =
    ebayMarketRadarSellerCommandCenterMvpFixture.primaryQueues.map(
      queue => queue.queueId
    )
  const topCardIds =
    ebayMarketRadarSellerCommandCenterMvpFixture.topCards.map(
      card => card.cardId
    )
  const trafficLightColors =
    ebayMarketRadarSellerCommandCenterMvpFixture.trafficLightLegend.map(
      item => item.color
    )

  for (const expectedQueue of [
    "protect_existing_reviewed_or_listed_products",
    "find_new_opportunities_within_synced_scope",
    "stock_risks",
    "margin_changes",
    "blocked_or_needs_recheck",
  ]) {
    assert.ok(
      primaryQueueIds.includes(expectedQueue),
      `primaryQueues must include: ${expectedQueue}`
    )
  }

  for (const expectedCard of [
    "coverage",
    "protect_existing",
    "new_opportunities",
    "stock_risk",
    "next_best_action",
  ]) {
    assert.ok(
      topCardIds.includes(expectedCard),
      `topCards must include: ${expectedCard}`
    )
  }

  for (const expectedColor of [
    "green",
    "yellow",
    "red",
    "blue",
    "purple",
  ]) {
    assert.ok(
      trafficLightColors.includes(expectedColor),
      `trafficLightLegend must include: ${expectedColor}`
    )
  }
})

test("market radar seller command center fixture: sample products cubren escenarios clave", () => {
  const sampleProducts =
    ebayMarketRadarSellerCommandCenterMvpFixture.sampleProducts
  const eventTypes =
    sampleProducts.map(product => product.eventType)

  assert.equal(
    sampleProducts.length,
    5
  )

  for (const expectedEventType of [
    "low_stock",
    "linked_product_not_covered",
    "back_in_stock",
    "margin_improved",
    "new_opportunity",
  ]) {
    assert.ok(
      eventTypes.includes(expectedEventType),
      `sampleProducts must include eventType: ${expectedEventType}`
    )
  }

  for (const product of sampleProducts) {
    assert.equal(
      product.readOnly,
      true
    )
    assert.ok(
      product.nextBestAction,
      `${product.productId} must include nextBestAction`
    )
  }
})

test("market radar seller command center fixture: next best action y safety siguen read-only", () => {
  const nextBestActionModel =
    ebayMarketRadarSellerCommandCenterMvpFixture.nextBestActionModel
  const safetyFlags =
    ebayMarketRadarSellerCommandCenterMvpFixture.safetyFlags

  assert.equal(
    nextBestActionModel.automationAllowed,
    false
  )
  assert.equal(
    nextBestActionModel.humanApprovalRequired,
    true
  )

  for (const [
    flagName,
    expectedValue,
  ] of [
    [
      "readOnly",
      true,
    ],
    [
      "automationAllowed",
      false,
    ],
    [
      "lunaPortexApiUsed",
      false,
    ],
    [
      "ebayApiUsed",
      false,
    ],
    [
      "openAiApiUsed",
      false,
    ],
    [
      "supabaseUsed",
      false,
    ],
    [
      "sqlUsed",
      false,
    ],
    [
      "publishedToEbay",
      false,
    ],
  ]) {
    assert.equal(
      safetyFlags[flagName],
      expectedValue,
      `${flagName} must be ${expectedValue}`
    )
  }
})

test("market radar seller command center fixture: no contiene URLs secretos ni datos reales", () => {
  const rawFixture =
    fs.readFileSync(
      ebayMarketRadarSellerCommandCenterMvpFixturePath,
      "utf8"
    )

  for (const forbiddenPattern of [
    /http:\/\//i,
    /https:\/\//i,
    /token/i,
    /secret/i,
    /supplier private data/i,
    /customer data/i,
    /REAL-/i,
    /supplierUrl/i,
    /productUrl/i,
  ]) {
    assert.doesNotMatch(
      rawFixture,
      forbiddenPattern
    )
  }
})

test("image generation dry run runner fixture set: existe y cumple contrato V1", () => {
  assert.ok(
    fs.existsSync(
      ebayListingImageGenerationDryRunRunnerFixtureSetPath
    )
  )
  assert.equal(
    ebayListingImageGenerationDryRunRunnerFixtureSet.fixtureSetVersion,
    "IMAGE_GENERATION_DRY_RUN_RUNNER_FIXTURE_SET_V1"
  )
  assert.equal(
    ebayListingImageGenerationDryRunRunnerFixtureSet.runnerDesignVersion,
    "IMAGE_GENERATION_DRY_RUN_RUNNER_DESIGN_V1"
  )
  assert.equal(
    ebayListingImageGenerationDryRunRunnerFixtureSet.fixtureTestDesignVersion,
    "IMAGE_GENERATION_DRY_RUN_RUNNER_FIXTURE_TEST_DESIGN_V1"
  )
  assert.equal(
    ebayListingImageGenerationDryRunRunnerFixtureSet.dryRunResultSchemaVersion,
    "IMAGE_GENERATION_DRY_RUN_RESULT_SCHEMA_V1"
  )
  assert.equal(
    ebayListingImageGenerationDryRunRunnerFixtureSet.promptPlanSchemaVersion,
    "IMAGE_GENERATION_PROMPT_PLAN_SCHEMA_V1"
  )
  assert.equal(
    ebayListingImageGenerationDryRunRunnerFixtureSet.advisoryOnly,
    true
  )
  assert.equal(
    ebayListingImageGenerationDryRunRunnerFixtureSet.dryRunOnly,
    true
  )
  assert.equal(
    ebayListingImageGenerationDryRunRunnerFixtureSet.fixtureOnly,
    true
  )
  assert.equal(
    ebayListingImageGenerationDryRunRunnerFixtureSet.externalCallsAllowed,
    false
  )
  assert.equal(
    ebayListingImageGenerationDryRunRunnerFixtureSet.openAiCallsAllowed,
    false
  )
  assert.equal(
    ebayListingImageGenerationDryRunRunnerFixtureSet.imageGenerationAllowed,
    false
  )
  assert.equal(
    ebayListingImageGenerationDryRunRunnerFixtureSet.ebayMutationAllowed,
    false
  )
  assert.equal(
    ebayListingImageGenerationDryRunRunnerFixtureSet.reportPersistenceAllowed,
    false
  )
  assert.equal(
    ebayListingImageGenerationDryRunRunnerFixtureSet.humanReviewRequired,
    true
  )
  assert.ok(
    Array.isArray(
      ebayListingImageGenerationDryRunRunnerFixtureSet.scenarios
    )
  )
  assert.ok(
    ebayListingImageGenerationDryRunRunnerFixtureSet.scenarios.length >= 8
  )
})

test("image generation dry run runner fixture set: contiene escenarios esperados y unicos", () => {
  const scenarios =
    ebayListingImageGenerationDryRunRunnerFixtureSet.scenarios

  const scenarioIds =
    scenarios.map(scenario =>
      scenario.scenarioId
    )

  assert.equal(
    new Set(scenarioIds).size,
    scenarioIds.length
  )

  for (const expectedScenarioId of [
    "needs_data_incomplete_prompt_plan",
    "ready_for_human_review_verified_facts",
    "blocked_unverified_trust_signals",
    "rejected_openai_payload_in_dry_run",
    "rejected_secret_or_token_placeholder",
    "rejected_real_url_placeholder",
    "blocked_unauthorized_brand_logo",
    "blocked_medical_claim",
    "lifestyle_model_authorization_required",
  ]) {
    assert.ok(
      scenarioIds.includes(
        expectedScenarioId
      ),
      `missing dry run runner scenario: ${expectedScenarioId}`
    )
  }
})

test("image generation dry run runner fixture set: scenarios mantienen enums y side effects seguros", () => {
  const allowedStatuses = [
    "DRY_RUN_READY_FOR_HUMAN_REVIEW",
    "DRY_RUN_NEEDS_DATA",
    "DRY_RUN_BLOCKED",
    "DRY_RUN_REJECTED",
  ]

  const allowedNextStates = [
    "KEEP_AS_PROMPT_PLAN_NEEDS_DATA",
    "READY_FOR_PROMPT_HUMAN_REVIEW",
    "BLOCK_IMAGE_GENERATION",
    "REQUEST_MORE_PRODUCT_DATA",
    "REQUEST_TRUST_SIGNAL_VERIFICATION",
    "REQUEST_MODEL_OR_IMAGE_AUTHORIZATION",
  ]

  for (const scenario of ebayListingImageGenerationDryRunRunnerFixtureSet.scenarios) {
    for (const fieldName of [
      "scenarioId",
      "description",
      "caseId",
      "imageRole",
      "expectedDryRunStatus",
      "expectedRecommendedNextState",
      "expectedSafetyFlags",
      "expectedOutputRequirements",
    ]) {
      assert.ok(
        Object.hasOwn(
          scenario,
          fieldName
        ),
        `runner fixture scenario missing field: ${fieldName}`
      )
    }

    assert.ok(
      allowedStatuses.includes(
        scenario.expectedDryRunStatus
      )
    )
    assert.ok(
      allowedNextStates.includes(
        scenario.expectedRecommendedNextState
      )
    )
    assert.equal(
      scenario.requiresHumanReview,
      true
    )
    assert.equal(
      scenario.sideEffectsAllowed,
      false
    )

    assert.deepEqual(
      scenario.expectedSafetyFlags,
      {
        openAiApiUsed:
          false,
        imageGenerated:
          false,
        externalCallsMade:
          false,
        ebayApiUsed:
          false,
        realDraftCreated:
          false,
        publishedToEbay:
          false,
        listingMutated:
          false,
        reportPersisted:
          false,
      }
    )
    assert.deepEqual(
      scenario.expectedOutputRequirements,
      {
        mayGenerateImage:
          false,
        mayCallOpenAi:
          false,
        mayCreateRealDraft:
          false,
        mayPublish:
          false,
        mayMutateListing:
          false,
      }
    )
  }
})

test("image generation dry run runner fixture set: appliesToAllScenarios bloquea ejecucion real", () => {
  assert.deepEqual(
    ebayListingImageGenerationDryRunRunnerFixtureSet.appliesToAllScenarios,
    {
      openAiApiUsed:
        false,
      imageGenerated:
        false,
      externalCallsMade:
        false,
      ebayApiUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
      listingMutated:
        false,
      reportPersisted:
        false,
      mayGenerateImage:
        false,
      mayCallOpenAi:
        false,
      mayCreateRealDraft:
        false,
      mayPublish:
        false,
      mayMutateListing:
        false,
    }
  )
})

test("image generation dry run runner fixture set: trust signals no verificados nunca quedan allowed", () => {
  for (const scenario of ebayListingImageGenerationDryRunRunnerFixtureSet.scenarios) {
    assert.equal(
      typeof scenario.expectedTrustSignalDecisions,
      "object"
    )
    assert.ok(
      scenario.expectedTrustSignalDecisions
    )

    for (const [
      signalName,
      signal,
    ] of Object.entries(
      scenario.expectedTrustSignalDecisions
    )) {
      assert.ok(
        [
          "freeShipping",
          "shipsFromUsa",
          "inStockInUsa",
          "usaFlag",
        ].includes(signalName)
      )
      assert.ok(
        [
          "allowed",
          "needs_data",
          "blocked",
          "not_requested",
        ].includes(signal.decision)
      )

      if (signal.verified === false) {
        assert.notEqual(
          signal.decision,
          "allowed",
          `unverified trust signal cannot be allowed in scenario ${scenario.scenarioId}: ${signalName}`
        )
        assert.equal(
          signal.allowed,
          false
        )
      }
    }
  }
})

test("image generation dry run runner fixture set: no contiene campos prohibidos, URLs ni credenciales reales", () => {
  const rawFixture =
    fs.readFileSync(
      ebayListingImageGenerationDryRunRunnerFixtureSetPath,
      "utf8"
    )

  assert.doesNotMatch(
    rawFixture,
    /https?:\/\//i
  )

  const forbiddenFieldNames = [
    "finalPrompt",
    "productionPrompt",
    "openAiPayload",
    "apiKey",
    "auth" + "orization",
    "tok" + "en",
    "sec" + "ret",
    "pass" + "word",
    "base64Image",
    "imageUrl",
    "draftId",
    "listingId",
    "publishedListingId",
  ]

  function collectKeysAndValues(
    value,
    collected = {
      keys:
        [],
      values:
        [],
    }
  ) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectKeysAndValues(
          item,
          collected
        )
      }
      return collected
    }

    if (
      value &&
      typeof value === "object"
    ) {
      for (const [
        key,
        childValue,
      ] of Object.entries(value)) {
        collected.keys.push(key)
        collectKeysAndValues(
          childValue,
          collected
        )
      }
      return collected
    }

    if (typeof value === "string") {
      collected.values.push(value)
    }

    return collected
  }

  const collected =
    collectKeysAndValues(
      ebayListingImageGenerationDryRunRunnerFixtureSet
    )

  const lowerKeys =
    collected.keys.map(key =>
      key.toLowerCase()
    )

  for (const fieldName of forbiddenFieldNames) {
    assert.equal(
      lowerKeys.includes(
        fieldName.toLowerCase()
      ),
      false,
      `dry run runner fixture set contains forbidden field: ${fieldName}`
    )
  }

  for (const value of collected.values) {
    assert.doesNotMatch(
      value,
      /https?:\/\//i
    )
    assert.doesNotMatch(
      value,
      /bearer\s+|sk-[a-z0-9_-]{8,}|[a-z0-9_-]{24,}\.[a-z0-9_-]{6,}\.[a-z0-9_-]{20,}/i
    )
  }
})

test("image generation dry run runner returns needs data for incomplete prompt plan", () => {
  const result =
    runImageGenerationDryRun(
      ebayListingImageGenerationPromptPlanFixture,
      {
        evaluatedAt:
          "2026-01-01T00:00:00.000Z",
      }
    )

  assert.equal(
    result.resultVersion,
    "IMAGE_GENERATION_DRY_RUN_RESULT_SCHEMA_V1"
  )
  assert.equal(
    result.caseId,
    "LISTING-GEN-001"
  )
  assert.equal(
    result.sourcePromptPlanVersion,
    "IMAGE_GENERATION_PROMPT_PLAN_SCHEMA_V1"
  )
  assert.equal(
    result.imageRole,
    "lifestyle_product_in_use"
  )
  assert.equal(
    result.targetBuyer,
    "us_ebay_buyer"
  )
  assert.equal(
    result.language,
    "en"
  )
  assert.equal(
    result.dryRunStatus,
    "DRY_RUN_NEEDS_DATA"
  )
  assert.equal(
    result.recommendedNextState,
    "REQUEST_MORE_PRODUCT_DATA"
  )
  assert.ok(
    Array.isArray(result.missingData)
  )
  assert.ok(
    result.missingData.length > 0
  )
  assert.ok(
    result.missingData.includes(
      "verified dimensions required"
    )
  )
  assert.ok(
    result.missingData.includes(
      "verified material required"
    )
  )
  assert.equal(
    typeof result.trustSignalEvaluation,
    "object"
  )

  for (const signal of Object.values(
    result.trustSignalEvaluation
  )) {
    if (signal.verified === false) {
      assert.notEqual(
        signal.decision,
        "allowed"
      )
    }
  }

  assert.deepEqual(
    result.outputRequirements,
    {
      intendedUse:
        "internal_review_only",
      mayGenerateImage:
        false,
      mayCallOpenAi:
        false,
      mayCreateRealDraft:
        false,
      mayPublish:
        false,
      mayMutateListing:
        false,
      requiresImageQaBeforeUse:
        true,
      requiresHumanReview:
        true,
    }
  )
  assert.equal(
    result.safetyFlags.openAiApiUsed,
    false
  )
  assert.equal(
    result.safetyFlags.imageGenerated,
    false
  )
  assert.equal(
    result.safetyFlags.externalCallsMade,
    false
  )
  assert.equal(
    result.safetyFlags.ebayApiUsed,
    false
  )
  assert.equal(
    result.safetyFlags.realDraftCreated,
    false
  )
  assert.equal(
    result.safetyFlags.publishedToEbay,
    false
  )
  assert.equal(
    result.safetyFlags.listingMutated,
    false
  )
  assert.equal(
    result.safetyFlags.reportPersisted,
    false
  )
})

test("image generation dry run runner rejects prohibited OpenAI payload fields", () => {
  const promptPlan =
    JSON.parse(
      JSON.stringify(
        ebayListingImageGenerationPromptPlanFixture
      )
    )

  promptPlan.openAiPayload =
    "simulated prohibited payload placeholder"

  const result =
    runImageGenerationDryRun(
      promptPlan,
      {
        evaluatedAt:
          "2026-01-01T00:00:00.000Z",
      }
    )

  assert.equal(
    result.dryRunStatus,
    "DRY_RUN_REJECTED"
  )
  assert.equal(
    result.recommendedNextState,
    "BLOCK_IMAGE_GENERATION"
  )
  assert.ok(
    result.blockingReasons.some(reason =>
      /prohibited field detected: openAiPayload/i.test(reason)
    )
  )
  assert.equal(
    result.safetyFlags.openAiApiUsed,
    false
  )
  assert.equal(
    result.safetyFlags.imageGenerated,
    false
  )
  assert.equal(
    result.safetyFlags.externalCallsMade,
    false
  )
  assert.equal(
    result.safetyFlags.ebayApiUsed,
    false
  )
  assert.equal(
    result.safetyFlags.reportPersisted,
    false
  )
})

test("image generation dry run runner never allows unverified trust signals", () => {
  const promptPlan =
    JSON.parse(
      JSON.stringify(
        ebayListingImageGenerationPromptPlanFixture
      )
    )

  promptPlan.trustSignals.freeShipping = {
    requested:
      true,
    allowed:
      true,
    verified:
      false,
    label:
      "Free Shipping",
  }

  const result =
    runImageGenerationDryRun(
      promptPlan,
      {
        evaluatedAt:
          "2026-01-01T00:00:00.000Z",
      }
    )

  assert.notEqual(
    result.trustSignalEvaluation.freeShipping.decision,
    "allowed"
  )
  assert.equal(
    result.trustSignalEvaluation.freeShipping.allowed,
    false
  )
  assert.equal(
    result.trustSignalEvaluation.freeShipping.verified,
    false
  )
  assert.ok(
    [
      "DRY_RUN_NEEDS_DATA",
      "DRY_RUN_BLOCKED",
    ].includes(
      result.dryRunStatus
    )
  )
})

test("image generation dry run runner is deterministic for same safe input", () => {
  const options = {
    evaluatedAt:
      "2026-01-01T00:00:00.000Z",
  }

  const firstResult =
    runImageGenerationDryRun(
      ebayListingImageGenerationPromptPlanFixture,
      options
    )

  const secondResult =
    runImageGenerationDryRun(
      ebayListingImageGenerationPromptPlanFixture,
      options
    )

  assert.equal(
    JSON.stringify(firstResult),
    JSON.stringify(secondResult)
  )
})

test("listing admin read-only fixture: cumple contrato V1", () => {
  assert.ok(
    fs.existsSync(
      ebayListingAdminReadOnlyFixturePath
    )
  )
  assert.equal(
    ebayListingAdminReadOnlyFixture.contractVersion,
    "EBAY_LISTING_ADMIN_READ_ONLY_DATA_CONTRACT_V1"
  )
  assert.equal(
    ebayListingAdminReadOnlyFixture.source,
    "simulated"
  )
  assert.ok(
    Array.isArray(
      ebayListingAdminReadOnlyFixture.items
    )
  )
  assert.equal(
    ebayListingAdminReadOnlyFixture.items.length,
    3
  )

  assert.deepEqual(
    ebayListingAdminReadOnlyFixture.items.map(
      item => item.caseId
    ),
    [
      "LISTING-GEN-001",
      "LISTING-GEN-004",
      "LISTING-GEN-006",
    ]
  )
})

test("listing admin read-only fixture: todos los items son simulados con safety flags seguros", () => {
  const expectedSafetyFlags = {
    advisoryOnly:
      true,
    localOnly:
      true,
    externalCallsMade:
      false,
    ebayApiUsed:
      false,
    realDraftCreated:
      false,
    publishedToEbay:
      false,
    listingMutated:
      false,
    requiresHumanReview:
      true,
  }

  for (const item of ebayListingAdminReadOnlyFixture.items) {
    assert.equal(
      item.sourceType,
      "simulated"
    )
    assert.deepEqual(
      item.safetyFlags,
      expectedSafetyFlags
    )
  }
})

test("listing admin read-only fixture: estados y decisiones esperadas", () => {
  const byCaseId =
    Object.fromEntries(
      ebayListingAdminReadOnlyFixture.items.map(
        item => [
          item.caseId,
          item,
        ]
      )
    )

  assert.equal(
    byCaseId["LISTING-GEN-001"].listingState,
    "LISTING_DRAFT_READY"
  )
  assert.equal(
    byCaseId["LISTING-GEN-001"].qaState,
    "QA_PASSED_FOR_HUMAN_REVIEW"
  )
  assert.equal(
    byCaseId["LISTING-GEN-001"].recommendedDecision,
    "PROCEED_TO_HUMAN_REVIEW"
  )

  assert.equal(
    byCaseId["LISTING-GEN-004"].listingState,
    "LISTING_BLOCKED"
  )
  assert.equal(
    byCaseId["LISTING-GEN-004"].qaState,
    "QA_BLOCKED"
  )
  assert.equal(
    byCaseId["LISTING-GEN-004"].recommendedDecision,
    "BLOCK_DO_NOT_ADVANCE"
  )
  assert.ok(
    byCaseId["LISTING-GEN-004"].blockedReasons.length > 0
  )

  assert.equal(
    byCaseId["LISTING-GEN-006"].listingState,
    "LISTING_REVIEW_REQUIRED"
  )
  assert.equal(
    byCaseId["LISTING-GEN-006"].qaState,
    "QA_REVIEW_REQUIRED"
  )
  assert.equal(
    byCaseId["LISTING-GEN-006"].recommendedDecision,
    "REVIEW_ECONOMICS"
  )
})

test("listing admin read-only fixture: safety summary coincide con items", () => {
  const items =
    ebayListingAdminReadOnlyFixture.items

  assert.deepEqual(
    ebayListingAdminReadOnlyFixture.safetySummary,
    {
      totalItems:
        items.length,
      blockedItems:
        items.filter(
          item =>
            item.recommendedDecision ===
            "BLOCK_DO_NOT_ADVANCE"
        ).length,
      itemsRequiringHumanReview:
        items.filter(
          item =>
            item.safetyFlags?.requiresHumanReview ===
            true
        ).length,
      unsafeItemsRejected:
        0,
    }
  )
})

test("listing admin read-only fixture: no contiene campos prohibidos ni URLs", () => {
  const rawFixture =
    fs.readFileSync(
      ebayListingAdminReadOnlyFixturePath,
      "utf8"
    )

  assert.doesNotMatch(
    rawFixture,
    /https?:\/\//i
  )

  const forbiddenFieldNames = [
    "tok" + "en",
    "pass" + "word",
    "sec" + "ret",
    "cred" + "ential",
    "auth" + "orization",
    "apiKey",
    "supplierPrivateData",
    "supplierUrl",
    "customerData",
    "cookies",
    "base64Image",
    "localPath",
  ]

  function collectKeys(value, keys = []) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectKeys(item, keys)
      }
      return keys
    }

    if (
      value &&
      typeof value === "object"
    ) {
      for (const [
        key,
        childValue,
      ] of Object.entries(value)) {
        keys.push(key)
        collectKeys(childValue, keys)
      }
    }

    return keys
  }

  const lowerKeys =
    collectKeys(
      ebayListingAdminReadOnlyFixture
    ).map(key => key.toLowerCase())

  for (const fieldName of forbiddenFieldNames) {
    assert.equal(
      lowerKeys.includes(
        fieldName.toLowerCase()
      ),
      false,
      `fixture contains forbidden field: ${fieldName}`
    )
  }
})

test("listing admin read-only page: usa fixture seguro V1", () => {
  const source =
    fs.readFileSync(
      ebayListingAdminPagePath,
      "utf8"
    )

  assert.match(
    source,
    /ebay-listing-admin-read-only-items-v1\.json/
  )
  assert.match(
    source,
    /EBAY_LISTING_ADMIN_READ_ONLY_DATA_CONTRACT_V1|contractVersion/
  )
  assert.match(source, /Data source/)
  assert.match(source, /simulated fixture/)
})

test("listing admin read-only page: conserva copy de seguridad", () => {
  const source =
    fs.readFileSync(
      ebayListingAdminPagePath,
      "utf8"
    )

  for (const expectedText of [
    "No eBay API",
    "No real draft",
    "Not published",
    "Human review required",
  ]) {
    assert.match(
      source,
      new RegExp(expectedText)
    )
  }
})

test("listing admin read-only page: no contiene integraciones reales", () => {
  const source =
    fs.readFileSync(
      ebayListingAdminPagePath,
      "utf8"
    )

  assert.doesNotMatch(
    source,
    /fetch\(|createClient|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/i
  )
})

test("image generator admin placeholder: existe y usa PromptPlan fixture", () => {
  assert.ok(
    fs.existsSync(
      ebayImageGeneratorAdminPagePath
    )
  )

  const source =
    fs.readFileSync(
      ebayImageGeneratorAdminPagePath,
      "utf8"
    )

  assert.match(
    source,
    /ebay-listing-image-generation-prompt-plan-v1\.json/
  )
  assert.match(
    source,
    /image-generation-dry-run-runner\.mjs/
  )
  assert.match(
    source,
    /runImageGenerationDryRun/
  )
  assert.doesNotMatch(
    source,
    /ebay-listing-image-generation-dry-run-result-v1\.json/
  )
  assert.match(
    source,
    /Image Generator/
  )
  assert.match(
    source,
    /Safe Preview/
  )
  assert.match(
    source,
    /PROMPT_PLAN_NEEDS_DATA|promptStatus/
  )
  assert.match(
    source,
    /DRY_RUN_NEEDS_DATA|dryRunStatus/
  )
  assert.match(
    source,
    /REQUEST_MORE_PRODUCT_DATA|recommendedNextState/
  )
})

test("image generator admin placeholder: conserva copy de seguridad", () => {
  const source =
    fs.readFileSync(
      ebayImageGeneratorAdminPagePath,
      "utf8"
    )

  for (const expectedText of [
    "OpenAI is not connected",
    "No image is generated",
    "Human review required",
    "Internal review only",
    "Calculated locally by runImageGenerationDryRun",
    "Source: PromptPlan fixture + local dry run runner",
    "No external calls were made",
    "Dry Run Result",
    "Image generation cannot proceed yet",
    "No OpenAI call was made",
    "No image was generated",
    "No eBay draft was created",
    "No listing was published",
  ]) {
    assert.ok(
      source.includes(expectedText),
      `missing image generator safety copy: ${expectedText}`
    )
  }
})

test("image generator admin placeholder: runner local calcula dry run seguro desde PromptPlan fixture", () => {
  const result =
    runImageGenerationDryRun(
      ebayListingImageGenerationPromptPlanFixture,
      {
        evaluatedAt:
          ebayListingImageGenerationPromptPlanFixture.generatedAt ||
          "2026-01-01T00:00:00.000Z",
        runnerVersion:
          "IMAGE_GENERATION_DRY_RUN_RUNNER_LOCAL_IMPLEMENTATION_V1",
      }
    )

  assert.equal(
    result.dryRunStatus,
    "DRY_RUN_NEEDS_DATA"
  )
  assert.equal(
    result.recommendedNextState,
    "REQUEST_MORE_PRODUCT_DATA"
  )
  assert.equal(
    result.outputRequirements.mayGenerateImage,
    false
  )
  assert.equal(
    result.outputRequirements.mayCallOpenAi,
    false
  )
  assert.equal(
    result.outputRequirements.mayCreateRealDraft,
    false
  )
  assert.equal(
    result.outputRequirements.mayPublish,
    false
  )
  assert.equal(
    result.outputRequirements.mayMutateListing,
    false
  )
  assert.equal(
    result.safetyFlags.openAiApiUsed,
    false
  )
  assert.equal(
    result.safetyFlags.imageGenerated,
    false
  )
  assert.equal(
    result.safetyFlags.externalCallsMade,
    false
  )
  assert.equal(
    result.safetyFlags.ebayApiUsed,
    false
  )
  assert.equal(
    result.safetyFlags.realDraftCreated,
    false
  )
  assert.equal(
    result.safetyFlags.publishedToEbay,
    false
  )
  assert.equal(
    result.safetyFlags.listingMutated,
    false
  )
  assert.equal(
    result.safetyFlags.reportPersisted,
    false
  )
})

test("image generator admin placeholder: muestra secciones de dry run result", () => {
  const source =
    fs.readFileSync(
      ebayImageGeneratorAdminPagePath,
      "utf8"
    )

  for (const expectedText of [
    "Dry Run Summary",
    "Missing Data",
    "Blocking Reasons",
    "Trust Signal Evaluation",
    "Prompt Safety Evaluation",
    "Dry Run Output Requirements",
    "Dry Run Safety Flags",
    "Human Review Requirements",
  ]) {
    assert.match(
      source,
      new RegExp(expectedText)
    )
  }
})

test("image generator admin placeholder: muestra campos de dry run seguros", () => {
  const source =
    fs.readFileSync(
      ebayImageGeneratorAdminPagePath,
      "utf8"
    )

  for (const expectedText of [
    "mayGenerateImage",
    "mayCallOpenAi",
    "mayCreateRealDraft",
    "mayPublish",
    "mayMutateListing",
    "openAiApiUsed",
    "imageGenerated",
    "ebayApiUsed",
    "realDraftCreated",
    "publishedToEbay",
    "listingMutated",
    "reportPersisted",
  ]) {
    assert.match(
      source,
      new RegExp(expectedText)
    )
  }
})

test("image generator admin placeholder: acciones visibles permanecen deshabilitadas", () => {
  const source =
    fs.readFileSync(
      ebayImageGeneratorAdminPagePath,
      "utf8"
    )

  for (const expectedText of [
    "Generate Image",
    "Send to OpenAI",
    "Create eBay Draft",
    "Publish",
  ]) {
    assert.match(
      source,
      new RegExp(expectedText)
    )
  }

  assert.match(
    source,
    /disabled/
  )
  assert.doesNotMatch(
    source,
    /onClick=/
  )
  assert.doesNotMatch(
    source,
    /<form/i
  )
})

test("image generator admin placeholder: no contiene integraciones reales", () => {
  const source =
    fs.readFileSync(
      ebayImageGeneratorAdminPagePath,
      "utf8"
    )

  for (const forbiddenPattern of [
    /fetch\(/,
    /createClient/,
    /\.insert\(/,
    /\.update\(/,
    /\.delete\(/,
    /\.upsert\(/,
    /\.rpc\(/,
    /process\.env/,
    /OPENAI_API_KEY/,
    /new OpenAI/,
    /images\.generate/,
    /openai\.images/,
    /ebayApi\.create/,
    /createDraft/,
    /publishListing/,
    /onClick=/,
  ]) {
    assert.doesNotMatch(
      source,
      forbiddenPattern
    )
  }
})

test("image generator admin placeholder: sidebar incluye ruta segura", () => {
  const source =
    fs.readFileSync(
      adminSidebarPath,
      "utf8"
    )

  assert.match(
    source,
    /\/admin\/ebay-image-generator/
  )
  assert.match(
    source,
    /Image Dry Run/
  )
})

test("ebay listing package admin MVP: existe y usa fixtures seguros", () => {
  assert.ok(
    fs.existsSync(
      ebayListingPackageAdminPagePath
    )
  )

  const source =
    fs.readFileSync(
      ebayListingPackageAdminPagePath,
      "utf8"
    )

  assert.match(
    source,
    /ebay-first-listing-package-v1\.json/
  )
  assert.match(
    source,
    /ebay-first-listing-qa-review-v1\.json/
  )
  assert.match(
    source,
    /ebay-luna-portex-image-asset-manifest-v1\.json/
  )
  assert.match(
    source,
    /ebay-luna-portex-image-source-intake-v1\.json/
  )
  assert.match(
    source,
    /ebay-luna-portex-image-source-review-gate-v1\.json/
  )
  assert.match(
    source,
    /ebay-luna-portex-main-image-enhancement-brief-v1\.json/
  )
})

test("ebay listing package admin MVP: muestra copy, estados y estrategia principal", () => {
  const source =
    fs.readFileSync(
      ebayListingPackageAdminPagePath,
      "utf8"
    )

  for (const expectedText of [
    "Listing Package QA",
    "Professional Listing MVP",
    "Seller View",
    "Read-only preview",
    "No eBay connection",
    "No draft created",
    "Do not publish yet",
    "Human review required",
    "Status: Not ready",
    "Main risk: Do not publish yet",
    "Next step: Complete critical data before creating an eBay draft",
    "Ready for: Internal preparation only",
    "Terapeak validation missing",
    "Sold listings benchmark missing",
    "Authorized Luna Portex catalog image missing",
    "White-background main image enhancement pending",
    "Main image QA pending",
    "AUTHORIZED_CATALOG_IMAGE_REQUIRED_FOR_MAIN_IMAGE",
    "CATALOG_IMAGE_ENHANCEMENT_REQUIRED",
    "Shipping/returns not confirmed",
    "Price and margin not validated",
    "LISTING_PACKAGE_NEEDS_DATA",
    "NOT_READY_TO_PUBLISH",
    "LISTING_QA_NEEDS_DATA",
    "DO_NOT_CREATE_DRAFT",
    "DO_NOT_PUBLISH",
    "TERAPEAK_VALIDATION_REQUIRED",
    "SOLD_LISTINGS_BENCHMARK_REQUIRED",
    "WAITING_FOR_CONVERSION_DATA",
    "PACKING_FEE_VERIFICATION_REQUIRED",
    "ebay_only_connector_or_import",
    "structured_requirement_only",
    "Sell One Like This",
    "manualCopyNotScalable",
    "Free Shipping",
    "Ships from USA",
    "In Stock in USA",
    "USA flag",
    "Made in USA",
    "pack x2",
    "pack x3",
    "pack x6",
    "pack x12",
    "Luna Portex",
  ]) {
    assert.ok(
      source.includes(expectedText),
      `missing listing package admin text: ${expectedText}`
    )
  }
})

test("ebay listing package admin MVP: contiene secciones requeridas", () => {
  const source =
    fs.readFileSync(
      ebayListingPackageAdminPagePath,
      "utf8"
    )

  for (const expectedSection of [
    "Executive Status",
    "Seller View",
    "Listing Preview",
    "What Blocks Publishing",
    "Action Plan",
    "Product facts",
    "Market validation",
    "Operations",
    "Assets",
    "Approval",
    "Product / Pricing / Shipping",
    "Image Plan",
    "Main Image Enhancement Brief",
    "Image Source Review Gate",
    "Image Source Intake",
    "Image Asset Manifest",
    "Market Validation",
    "Trust Signals",
    "QA Details",
    "System Safety / Audit",
    "Listing Overview",
    "Buyer-Facing Copy",
    "Item Specifics",
    "Price Strategy",
    "Shipping & Returns",
    "US Buyer Trust Signals",
    "Main Image Policy",
    "Main Image Enhancement Policy",
    "Secondary Image Strategy",
    "Optional US Buyer Trust Visual",
    "Terapeak Validation",
    "Sold Listings Benchmark",
    "Pack Strategy",
    "Luna Portex Pack Fulfillment Review",
    "QA Review",
    "Blocking Reasons",
    "Missing Data",
    "Required Human Actions",
    "Pre-Draft Checklist",
    "Pre-Publish Checklist",
    "Safety Flags",
  ]) {
    assert.ok(
      source.includes(expectedSection),
      `missing listing package admin section: ${expectedSection}`
    )
  }
})

test("ebay listing package admin MVP: muestra preview vendedor y plan de accion", () => {
  const source =
    fs.readFileSync(
      ebayListingPackageAdminPagePath,
      "utf8"
    )

  for (const expectedText of [
    "Authorized Luna Portex catalog image required",
    "White-background enhancement required",
    "No AI-generated product",
    "No product alteration",
    "No badges or flags",
    "Source authorization required",
    "Price: Pending",
    "Shipping: Pending",
    "Returns: Pending",
    "Do not create draft",
    "Do not publish",
    "Ready for internal preparation only",
  ]) {
    assert.ok(
      source.includes(expectedText),
      `missing seller preview/action text: ${expectedText}`
    )
  }
})

test("ebay listing package admin MVP: muestra image asset manifest", () => {
  const source =
    fs.readFileSync(
      ebayListingPackageAdminPagePath,
      "utf8"
    )

  for (const expectedText of [
    "Image Asset Manifest",
    "IMAGE_ASSETS_NEED_SOURCE",
    "DO_NOT_CREATE_DRAFT_UNTIL_IMAGE_QA_APPROVED",
    "Authorized Luna Portex catalog image",
    "Waiting for authorized Luna Portex catalog image",
    "White-background enhancement pending",
    "Image QA required",
    "Main Image Slot",
    "Secondary Image Slots",
    "material_zoom",
    "package_contents",
    "dimensions",
    "main_benefit_in_action",
    "aspirational_lifestyle",
    "hands_real_use",
    "Draft gate: blocked until image QA approved",
  ]) {
    assert.ok(
      source.includes(expectedText),
      `missing image asset manifest admin text: ${expectedText}`
    )
  }
})

test("ebay listing package admin MVP: muestra image source intake", () => {
  const source =
    fs.readFileSync(
      ebayListingPackageAdminPagePath,
      "utf8"
    )

  for (const expectedText of [
    "Image Source Intake",
    "SOURCE_EVIDENCE_REQUIRED",
    "DRAFT_BLOCKED_UNTIL_SOURCE_EVIDENCE_APPROVED",
    "Source is Luna Portex catalog",
    "Authorized use confirmed",
    "Image matches the listing product",
    "No competitor image is used",
    "No restricted watermark or competitor logo",
    "White-background enhancement permission confirmed",
    "Human source review required",
    "Source review not started",
    "Approval required before image QA and eBay draft",
  ]) {
    assert.ok(
      source.includes(expectedText),
      `missing image source intake admin text: ${expectedText}`
    )
  }
})

test("ebay listing package admin MVP: muestra main image enhancement brief", () => {
  const source =
    fs.readFileSync(
      ebayListingPackageAdminPagePath,
      "utf8"
    )

  for (const expectedText of [
    "Main Image Enhancement Brief",
    "ENHANCEMENT_BRIEF_READY_BUT_SOURCE_BLOCKED",
    "DO_NOT_ENHANCE_YET",
    "DRAFT_BLOCKED_UNTIL_SOURCE_REVIEW_AND_IMAGE_QA_APPROVED",
    "Source review required before enhancement",
    "Authorized Luna Portex catalog image required",
    "Pure white background",
    "1:1 eBay main image",
    "Minimum 1600px",
    "Product centered",
    "No product alteration",
    "No text overlay",
    "No trust badges",
    "No USA flag",
    "No competitor branding",
    "Not an OpenAI payload",
    "Enhancement blocked until source review approval",
  ]) {
    assert.ok(
      source.includes(expectedText),
      `missing main image enhancement brief admin text: ${expectedText}`
    )
  }
})

test("ebay listing package admin MVP: muestra image source review gate", () => {
  const source =
    fs.readFileSync(
      ebayListingPackageAdminPagePath,
      "utf8"
    )

  for (const expectedText of [
    "Image Source Review Gate",
    "SOURCE_REVIEW_NOT_APPROVED",
    "BLOCK_IMAGE_WORKFLOW",
    "DRAFT_BLOCKED_UNTIL_SOURCE_REVIEW_APPROVED",
    "Source evidence has not been approved yet",
    "Image enhancement: Blocked",
    "Image QA: Blocked",
    "eBay draft mapping: Blocked",
    "eBay draft creation: Blocked",
    "Human source review required",
    "Request more source evidence",
    "Unlock Requirements",
    "Blocked Workflows",
  ]) {
    assert.ok(
      source.includes(expectedText),
      `missing image source review gate admin text: ${expectedText}`
    )
  }
})

test("ebay listing package admin MVP: acciones visibles permanecen deshabilitadas", () => {
  const source =
    fs.readFileSync(
      ebayListingPackageAdminPagePath,
      "utf8"
    )

  for (const expectedButton of [
    "Import Sold Listings",
    "Validate Terapeak",
    "Create eBay Draft",
    "Publish to eBay",
    "Create Pack Listing",
    "Generate Images",
  ]) {
    assert.ok(
      source.includes(expectedButton),
      `missing disabled action: ${expectedButton}`
    )
  }

  for (const expectedReason of [
    "Disabled: benchmark import not implemented yet",
    "Disabled: manual validation required first",
    "Disabled: QA needs data",
    "Disabled: Terapeak and benchmark missing",
    "Disabled: waiting for conversion data",
    "Disabled: authorized catalog source and image QA required",
  ]) {
    assert.ok(
      source.includes(expectedReason),
      `missing disabled action reason: ${expectedReason}`
    )
  }

  assert.match(
    source,
    /disabled/
  )
  assert.doesNotMatch(
    source,
    /onClick=/
  )
  assert.doesNotMatch(
    source,
    /<form/i
  )
})

test("ebay listing package admin MVP: mantiene orden ejecutivo antes de auditoria", () => {
  const source =
    fs.readFileSync(
      ebayListingPackageAdminPagePath,
      "utf8"
    )

  assert.ok(
    source.indexOf("Executive Status") <
      source.indexOf("System Safety / Audit")
  )
  assert.ok(
    source.indexOf("Listing Preview") <
      source.indexOf("QA Details")
  )
  assert.ok(
    source.indexOf("What Blocks Publishing") <
      source.indexOf("System Safety / Audit")
  )
})

test("ebay listing package admin MVP: no contiene integraciones reales", () => {
  const source =
    fs.readFileSync(
      ebayListingPackageAdminPagePath,
      "utf8"
    )

  for (const forbiddenPattern of [
    /fetch\(/,
    /createClient/,
    /\.insert\(/,
    /\.update\(/,
    /\.delete\(/,
    /\.upsert\(/,
    /\.rpc\(/,
    /process\.env/,
    /OPENAI_API_KEY/,
    /new OpenAI/,
    /images\.generate/,
    /openai\.images/,
    /ebayApi\.create/,
    /createDraft/,
    /publishListing/,
    /onClick=/,
    /<img/i,
    /next\/image/i,
  ]) {
    assert.doesNotMatch(
      source,
      forbiddenPattern
    )
  }
})

test("ebay listing package admin MVP: sidebar incluye ruta segura", () => {
  const source =
    fs.readFileSync(
      adminSidebarPath,
      "utf8"
    )

  assert.match(
    source,
    /\/admin\/ebay-listing-package/
  )
  assert.match(
    source,
    /Listing Package QA/
  )
  assert.match(
    source,
    /eBay Proposals/
  )
  assert.match(
    source,
    /Image Dry Run/
  )
  assert.match(
    source,
    /Candidate ideas/
  )
  assert.match(
    source,
    /No eBay API/
  )
  assert.match(
    source,
    /No draft/
  )
  assert.match(
    source,
    /Package \+ QA review/
  )
  assert.match(
    source,
    /Do not publish/
  )
  assert.match(
    source,
    /PromptPlan \+ safety check/
  )
  assert.match(
    source,
    /No image generated/
  )
})

test("ebay listing package admin MVP: no contiene espanol operativo visible", () => {
  const source =
    fs.readFileSync(
      ebayListingPackageAdminPagePath,
      "utf8"
    )

  for (const forbiddenText of [
    "Acciones",
    "Qué estás viendo",
    "Pendiente",
    "Publicación",
    "Borrador",
    "mínimo",
    "minimo",
    "Faltan",
    "Imagen principal",
    "Precio pendiente",
    "Categoría pendiente",
    "Requiere",
    "Revisión",
    "Verificación",
  ]) {
    assert.ok(
      !source.includes(forbiddenText),
      `listing package admin source should not include Spanish operational text: ${forbiddenText}`
    )
  }
})

test("ebay listing package admin MVP: no contiene patrones de seguridad prohibidos", () => {
  const source =
    fs.readFileSync(
      ebayListingPackageAdminPagePath,
      "utf8"
    )

  for (const forbiddenPattern of [
    /<img/i,
    /next\/image/i,
    /fetch\(/,
    /createClient/,
    /process\.env/,
    /new OpenAI/,
    /images\.generate/,
    /openai\.images/,
    /createDraft/,
    /publishListing/,
    /onClick=/,
    /http:\/\//,
    /https:\/\//,
  ]) {
    assert.doesNotMatch(
      source,
      forbiddenPattern
    )
  }
})

test("ebay admin sidebar: normaliza labels eBay en ingles", () => {
  const source =
    fs.readFileSync(
      adminSidebarPath,
      "utf8"
    )

  for (const expectedText of [
    "eBay Proposals",
    "Listing Package QA",
    "Image Dry Run",
    "/admin/ebay-listings",
    "/admin/ebay-listing-package",
    "/admin/ebay-image-generator",
  ]) {
    assert.ok(
      source.includes(expectedText),
      `missing eBay sidebar text: ${expectedText}`
    )
  }
})

test("ebay listing package admin MVP: mantiene resumen ejecutivo en ingles", () => {
  const source =
    fs.readFileSync(
      ebayListingPackageAdminPagePath,
      "utf8"
    )

  for (const expectedText of [
    "Executive Status",
    "Seller View",
    "Listing Preview",
    "What Blocks Publishing",
    "Action Plan",
    "System Safety / Audit",
    "Status: Not ready",
    "Main risk: Do not publish yet",
    "Next step: Complete critical data before creating an eBay draft",
    "Ready for: Internal preparation only",
    "Price: Pending",
    "Shipping: Pending",
    "Returns: Pending",
    "Authorized Luna Portex catalog image required",
    "White-background enhancement required",
    "White-background main image required",
    "No AI-generated product",
    "No product alteration",
    "No badges or flags",
    "Source authorization required",
  ]) {
    assert.ok(
      source.includes(expectedText),
      `missing English listing package admin text: ${expectedText}`
    )
  }
})

test("ebay listing package admin MVP: conserva enums tecnicos", () => {
  const source =
    fs.readFileSync(
      ebayListingPackageAdminPagePath,
      "utf8"
    )

  for (const expectedEnum of [
    "LISTING_PACKAGE_NEEDS_DATA",
    "LISTING_QA_NEEDS_DATA",
    "DO_NOT_CREATE_DRAFT",
    "DO_NOT_PUBLISH",
    "TERAPEAK_VALIDATION_REQUIRED",
    "SOLD_LISTINGS_BENCHMARK_REQUIRED",
    "WAITING_FOR_CONVERSION_DATA",
    "PACKING_FEE_VERIFICATION_REQUIRED",
  ]) {
    assert.ok(
      source.includes(expectedEnum),
      `missing technical enum: ${expectedEnum}`
    )
  }
})

test("ebay listing package admin MVP: sidebar conserva propuestas eBay", () => {
  const source =
    fs.readFileSync(
      adminSidebarPath,
      "utf8"
    )

  assert.match(
    source,
    /eBay Proposals/
  )
})

for (const item of ebayListingGeneratorCases) {
  test(`listing proposal generator fixture: ${item.caseId} ${item.name}`, () => {
    const result =
      buildListingProposalFromCandidate(
        item.candidate,
        {
          sourceCaseId:
            item.caseId,
          sourceType:
            "listing_generator_fixture",
          selectionDecision:
            "approve",
          selectionState:
            "APPROVED_FOR_DRAFT",
        }
      )

    assert.equal(
      result.schemaVersion,
      "EBAY_LISTING_DRAFT_SCHEMA_V1"
    )
    assert.ok(result.source)
    assert.ok(result.listingProposal)
    assert.ok(result.review)
    assert.ok(result.safety)
    assert.equal(
      result.listingProposal.advisoryOnly,
      true
    )
    assert.equal(
      result.listingProposal.humanReviewRequired,
      true
    )
    assert.deepEqual(
      result.safety,
      {
        advisoryOnly:
          true,
        localOnly:
          true,
        externalCallsMade:
          false,
        ebayApiUsed:
          false,
        realDraftCreated:
          false,
        publishedToEbay:
          false,
        listingMutated:
          false,
        requiresHumanReview:
          true,
      }
    )
    assert.notEqual(
      result.review.listingState,
      "LISTING_APPROVED_FOR_MANUAL_DRAFT"
    )

    if (item.expected.listingState) {
      assert.equal(
        result.review.listingState,
        item.expected.listingState
      )
    }

    if (item.expected.allowedListingStates) {
      assert.ok(
        item.expected.allowedListingStates.includes(
          result.review.listingState
        ),
        `${item.caseId} unexpected state ${result.review.listingState}`
      )
    }

    if (item.expected.notListingState) {
      assert.notEqual(
        result.review.listingState,
        item.expected.notListingState
      )
    }

    for (const expectedMissing of item.expected.missingData || []) {
      assert.ok(
        result.review.missingData.includes(
          expectedMissing
        ),
        `${item.caseId} missing expected data flag ${expectedMissing}`
      )
    }

    for (const expectedRisk of item.expected.riskFlags || []) {
      assert.ok(
        result.review.riskFlags.includes(
          expectedRisk
        ),
        `${item.caseId} missing expected risk flag ${expectedRisk}`
      )
    }

    for (const expectedBlocker of item.expected.blockedReasons || []) {
      assert.ok(
        result.listingProposal.compliance.blockedReasons.includes(
          expectedBlocker
        ),
        `${item.caseId} missing expected blocker ${expectedBlocker}`
      )
    }

    for (const phrase of item.expected.descriptionMustNotContain || []) {
      assert.doesNotMatch(
        JSON.stringify(
          result.listingProposal.description
        ),
        new RegExp(phrase, "i")
      )
    }
  })
}

test("listing proposal generator fixture: ideal queda listo internamente", () => {
  const idealCase =
    ebayListingGeneratorCases.find(item =>
      item.caseId === "LISTING-GEN-001"
    )

  const result =
    buildListingProposalFromCandidate(
      idealCase.candidate,
      {
        sourceCaseId:
          idealCase.caseId,
      }
    )

  assert.equal(
    result.review.listingState,
    "LISTING_DRAFT_READY"
  )
  assert.deepEqual(
    result.listingProposal.compliance.blockedReasons,
    []
  )
})

test("listing proposal generator fixture: no inventa Brand MPN Model ni certificaciones", () => {
  const incompleteCase =
    ebayListingGeneratorCases.find(item =>
      item.caseId === "LISTING-GEN-002"
    )

  const result =
    buildListingProposalFromCandidate(
      {
        ...incompleteCase.candidate,
        brand:
          null,
        model:
          null,
        mpn:
          null,
      }
    )

  assert.ok(
    result.listingProposal.itemSpecifics.missing.includes(
      "Brand"
    )
  )
  assert.ok(
    result.listingProposal.itemSpecifics.missing.includes(
      "MPN"
    )
  )
  assert.ok(
    result.listingProposal.itemSpecifics.missing.includes(
      "Model"
    )
  )
  assert.doesNotMatch(
    JSON.stringify(
      result.listingProposal
    ),
    /FDA|certified|official/i
  )
})

function buildFixtureListingProposal(caseId) {
  const fixtureCase =
    buildFixtureListingProposalCase(caseId)

  return buildListingProposalFromCandidate(
    fixtureCase.candidate,
    {
      sourceCaseId:
        fixtureCase.caseId,
      sourceType:
        "listing_generator_fixture",
      selectionDecision:
        "approve",
      selectionState:
        "APPROVED_FOR_DRAFT",
    }
  )
}

function buildFixtureListingProposalCase(caseId) {
  const fixtureCase =
    ebayListingGeneratorCases.find(item =>
      item.caseId === caseId
    )

  assert.ok(
    fixtureCase,
    `missing listing generator fixture ${caseId}`
  )

  return fixtureCase
}

test("listing proposal QA runner: propuesta ideal pasa para revision humana", () => {
  const proposal =
    buildFixtureListingProposal(
      "LISTING-GEN-001"
    )

  const result =
    evaluateListingProposalQa(proposal)

  assert.equal(
    result.schemaVersion,
    "EBAY_LISTING_QA_RESULT_V1"
  )
  assert.equal(
    result.qaState,
    "QA_PASSED_FOR_HUMAN_REVIEW"
  )
  assert.equal(
    result.advisoryOnly,
    true
  )
  assert.equal(
    result.humanReviewRequired,
    true
  )
  assert.notEqual(
    result.qaState,
    "QA_APPROVED_FOR_MANUAL_DRAFT"
  )
  assert.deepEqual(
    result.blockedReasons,
    []
  )
  assert.deepEqual(
    result.missingData,
    []
  )
})

test("listing proposal QA runner: safety flags V1 se mantienen en resultado", () => {
  const result =
    evaluateListingProposalQa(
      buildFixtureListingProposal(
        "LISTING-GEN-001"
      )
    )

  assert.deepEqual(
    result.safety,
    {
      advisoryOnly:
        true,
      localOnly:
        true,
      externalCallsMade:
        false,
      ebayApiUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
      listingMutated:
        false,
      requiresHumanReview:
        true,
    }
  )
})

test("listing proposal QA runner: datos faltantes devuelven incomplete", () => {
  const result =
    evaluateListingProposalQa(
      buildFixtureListingProposal(
        "LISTING-GEN-002"
      )
    )

  assert.equal(
    result.qaState,
    "QA_INCOMPLETE"
  )
  assert.ok(
    result.missingData.includes(
      "weight"
    )
  )
  assert.ok(
    result.missingData.includes(
      "dimensions"
    )
  )
  assert.ok(
    result.missingData.includes(
      "stock"
    )
  )
})

test("listing proposal QA runner: imagen unknown no pasa como final-ready", () => {
  const result =
    evaluateListingProposalQa(
      buildFixtureListingProposal(
        "LISTING-GEN-003"
      )
    )

  assert.ok(
    [
      "QA_INCOMPLETE",
      "QA_REVIEW_REQUIRED",
    ].includes(result.qaState)
  )
  assert.notEqual(
    result.qaState,
    "QA_PASSED_FOR_HUMAN_REVIEW"
  )
  assert.ok(
    result.riskFlags.includes(
      "image_authorization_missing"
    )
  )
})

test("listing proposal QA runner: VeRO IP o marca high bloquea", () => {
  const result =
    evaluateListingProposalQa(
      buildFixtureListingProposal(
        "LISTING-GEN-004"
      )
    )

  assert.equal(
    result.qaState,
    "QA_BLOCKED"
  )
  assert.ok(
    result.blockedReasons.includes(
      "brand_or_vero_high"
    )
  )
})

test("listing proposal QA runner: claims medicos high bloquean", () => {
  const result =
    evaluateListingProposalQa(
      buildFixtureListingProposal(
        "LISTING-GEN-005"
      )
    )

  assert.equal(
    result.qaState,
    "QA_BLOCKED"
  )
  assert.ok(
    result.blockedReasons.includes(
      "medical_claims_high"
    )
  )
})

test("listing proposal QA runner: margen debil o precio riesgoso requiere revision", () => {
  const result =
    evaluateListingProposalQa(
      buildFixtureListingProposal(
        "LISTING-GEN-006"
      )
    )

  assert.equal(
    result.qaState,
    "QA_REVIEW_REQUIRED"
  )
  assert.ok(
    result.riskFlags.includes(
      "price_review_required"
    )
  )
})

test("listing proposal QA runner: safety flags alterados bloquean", () => {
  const proposal =
    buildFixtureListingProposal(
      "LISTING-GEN-001"
    )

  const result =
    evaluateListingProposalQa({
      ...proposal,
      safety: {
        ...proposal.safety,
        ebayApiUsed:
          true,
      },
    })

  assert.equal(
    result.qaState,
    "QA_BLOCKED"
  )
  assert.ok(
    result.blockedReasons.includes(
      "invalid_safety_ebayApiUsed"
    )
  )
})

test("listing proposal QA runner: evalua todos los outputs del fixture del generador", () => {
  const expectedStates = {
    "LISTING-GEN-001":
      "QA_PASSED_FOR_HUMAN_REVIEW",
    "LISTING-GEN-002":
      "QA_INCOMPLETE",
    "LISTING-GEN-003":
      "QA_INCOMPLETE",
    "LISTING-GEN-004":
      "QA_BLOCKED",
    "LISTING-GEN-005":
      "QA_BLOCKED",
    "LISTING-GEN-006":
      "QA_REVIEW_REQUIRED",
  }

  for (const item of ebayListingGeneratorCases) {
    const result =
      evaluateListingProposalQa(
        buildFixtureListingProposal(
          item.caseId
        )
      )

    assert.equal(
      result.schemaVersion,
      "EBAY_LISTING_QA_RESULT_V1"
    )
    assert.equal(
      result.qaState,
      expectedStates[item.caseId]
    )
    assert.notEqual(
      result.qaState,
      "QA_APPROVED_FOR_MANUAL_DRAFT"
    )
  }
})

test("listing proposal QA runner: modulo local sin red ni acciones reales", () => {
  const source =
    fs.readFileSync(
      "lib/ebay-winner-pipeline/listing-proposal-qa-runner.mjs",
      "utf8"
    )

  assert.doesNotMatch(
    source,
    /fetch\(|createClient|supabase|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/i
  )
  assert.doesNotMatch(
    source,
    /ebay\s+api|oa(?:uth)|to(?:ken)|draft real/i
  )
})

function buildFixtureListingReviewReport(caseId) {
  const fixtureCase =
    buildFixtureListingProposalCase(caseId)
  const listingProposalOutput =
    buildFixtureListingProposal(caseId)
  const qaResult =
    evaluateListingProposalQa(
      listingProposalOutput
    )

  return buildListingProposalReviewReport({
    caseId:
      fixtureCase.caseId,
    name:
      fixtureCase.name,
    candidate:
      fixtureCase.candidate,
    listingProposalOutput,
    qaResult,
  })
}

test("listing proposal review report formatter: genera estructura V1", () => {
  const report =
    buildFixtureListingReviewReport(
      "LISTING-GEN-001"
    )

  assert.equal(
    report.reportVersion,
    "EBAY_LISTING_PROPOSAL_REVIEW_REPORT_V1"
  )

  for (const key of [
    "header",
    "executiveSummary",
    "candidateSource",
    "listingProposalSummary",
    "qaResultSummary",
    "economicsReview",
    "safetyFlags",
    "recommendedDecision",
  ]) {
    assert.ok(
      key in report,
      `missing report key ${key}`
    )
  }
})

test("listing proposal review report formatter: decisiones esperadas por fixture", () => {
  const expectedDecisions = {
    "LISTING-GEN-001":
      "PROCEED_TO_HUMAN_REVIEW",
    "LISTING-GEN-002":
      "COMPLETE_MISSING_DATA",
    "LISTING-GEN-003":
      "COMPLETE_MISSING_DATA",
    "LISTING-GEN-004":
      "BLOCK_DO_NOT_ADVANCE",
    "LISTING-GEN-005":
      "BLOCK_DO_NOT_ADVANCE",
    "LISTING-GEN-006":
      "REVIEW_ECONOMICS",
  }

  for (const item of ebayListingGeneratorCases) {
    const report =
      buildFixtureListingReviewReport(
        item.caseId
      )

    assert.equal(
      report.recommendedDecision,
      expectedDecisions[item.caseId],
      `${item.caseId} unexpected review report decision`
    )
    assert.notEqual(
      report.recommendedDecision,
      "QA_APPROVED_FOR_MANUAL_DRAFT"
    )
    assert.notEqual(
      report.recommendedDecision,
      "LISTING_APPROVED_FOR_MANUAL_DRAFT"
    )
  }
})

test("listing proposal review report formatter: caso ideal incluye resumen y acciones humanas", () => {
  const report =
    buildFixtureListingReviewReport(
      "LISTING-GEN-001"
    )

  assert.equal(
    report.header.listingState,
    "LISTING_DRAFT_READY"
  )
  assert.equal(
    report.header.qaState,
    "QA_PASSED_FOR_HUMAN_REVIEW"
  )
  assert.equal(
    report.executiveSummary.canProceedToHumanReview,
    true
  )
  assert.ok(
    report.requiredHumanActions.length > 0
  )
})

test("listing proposal review report formatter: incompletos y bloqueados preservan razones", () => {
  const incompleteReport =
    buildFixtureListingReviewReport(
      "LISTING-GEN-002"
    )
  const blockedReport =
    buildFixtureListingReviewReport(
      "LISTING-GEN-004"
    )

  assert.ok(
    incompleteReport.missingData.includes(
      "weight"
    )
  )
  assert.ok(
    incompleteReport.missingData.includes(
      "dimensions"
    )
  )
  assert.ok(
    blockedReport.blockedReasons.includes(
      "brand_or_vero_high"
    )
  )
})

test("listing proposal review report formatter: safety flags V1 correctos", () => {
  const report =
    buildFixtureListingReviewReport(
      "LISTING-GEN-001"
    )

  assert.deepEqual(
    report.safetyFlags,
    {
      advisoryOnly:
        true,
      localOnly:
        true,
      externalCallsMade:
        false,
      ebayApiUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
      listingMutated:
        false,
      requiresHumanReview:
        true,
    }
  )
})

test("listing proposal review report formatter: modulo local sin red ni acciones reales", () => {
  const source =
    fs.readFileSync(
      "lib/ebay-winner-pipeline/listing-proposal-review-report-formatter.mjs",
      "utf8"
    )

  assert.doesNotMatch(
    source,
    /fetch\(|createClient|supabase|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/i
  )
  assert.doesNotMatch(
    source,
    /ebay\s+api|oa(?:uth)|to(?:ken)|draft real/i
  )
})

test("listing proposal dry-run runner: procesa LISTING-GEN-001 con generador y QA", () => {
  const cases =
    loadListingDryRunJsonFile(
      ebayListingGeneratorFixturePath
    )
  const selected =
    selectDryRunCases(
      cases,
      {
        caseId:
          "LISTING-GEN-001",
      }
    )

  const result =
    runListingProposalDryRun(
      selected[0]
    )

  assert.equal(
    result.proposal.schemaVersion,
    "EBAY_LISTING_DRAFT_SCHEMA_V1"
  )
  assert.equal(
    result.qa.schemaVersion,
    "EBAY_LISTING_QA_RESULT_V1"
  )
  assert.equal(
    result.qa.qaState,
    "QA_PASSED_FOR_HUMAN_REVIEW"
  )
  assert.equal(
    result.reviewReport.reportVersion,
    "EBAY_LISTING_PROPOSAL_REVIEW_REPORT_V1"
  )
  assert.equal(
    result.reviewReport.recommendedDecision,
    "PROCEED_TO_HUMAN_REVIEW"
  )
})

test("listing proposal dry-run runner: all procesa LISTING-GEN-001 a LISTING-GEN-006", () => {
  const selected =
    selectDryRunCases(
      ebayListingGeneratorCases,
      {
        all:
          true,
      }
    )

  assert.deepEqual(
    selected.map(item => item.caseId),
    [
      "LISTING-GEN-001",
      "LISTING-GEN-002",
      "LISTING-GEN-003",
      "LISTING-GEN-004",
      "LISTING-GEN-005",
      "LISTING-GEN-006",
    ]
  )

  const states =
    selected.map(item =>
      runListingProposalDryRun(item).qa.qaState
    )
  const reports =
    selected.map(item =>
      runListingProposalDryRun(item).reviewReport
    )

  assert.deepEqual(
    states,
    [
      "QA_PASSED_FOR_HUMAN_REVIEW",
      "QA_INCOMPLETE",
      "QA_INCOMPLETE",
      "QA_BLOCKED",
      "QA_BLOCKED",
      "QA_REVIEW_REQUIRED",
    ]
  )
  assert.ok(
    reports.every(report =>
      report.reportVersion === "EBAY_LISTING_PROPOSAL_REVIEW_REPORT_V1"
    )
  )
  assert.deepEqual(
    reports.map(report =>
      report.recommendedDecision
    ),
    [
      "PROCEED_TO_HUMAN_REVIEW",
      "COMPLETE_MISSING_DATA",
      "COMPLETE_MISSING_DATA",
      "BLOCK_DO_NOT_ADVANCE",
      "BLOCK_DO_NOT_ADVANCE",
      "REVIEW_ECONOMICS",
    ]
  )
})

test("listing proposal dry-run runner: review report recomienda decisiones esperadas", () => {
  const expectedDecisions = {
    "LISTING-GEN-001":
      "PROCEED_TO_HUMAN_REVIEW",
    "LISTING-GEN-002":
      "COMPLETE_MISSING_DATA",
    "LISTING-GEN-004":
      "BLOCK_DO_NOT_ADVANCE",
    "LISTING-GEN-006":
      "REVIEW_ECONOMICS",
  }

  for (const [caseId, expectedDecision] of Object.entries(expectedDecisions)) {
    const result =
      runListingProposalDryRun(
        buildFixtureListingProposalCase(
          caseId
        )
      )

    assert.equal(
      result.reviewReport.recommendedDecision,
      expectedDecision
    )
  }
})

test("listing proposal dry-run runner: case faltante produce error claro", () => {
  assert.throws(
    () =>
      selectDryRunCases(
        ebayListingGeneratorCases,
        {
          caseId:
            "LISTING-GEN-999",
        }
      ),
    /Case not found: LISTING-GEN-999/
  )
})

test("listing proposal dry-run runner: input invalido o sin candidate produce error claro", () => {
  assert.throws(
    () =>
      normalizeDryRunInput(null),
    /Dry-run input must be an object/
  )

  assert.throws(
    () =>
      normalizeDryRunInput({
        candidate:
          null,
      }),
    /Input candidate must be an object/
  )
})

test("listing proposal dry-run runner: formato resume estados y safety sin payload completo", () => {
  const result =
    runListingProposalDryRun(
      buildFixtureListingProposalCase(
        "LISTING-GEN-001"
      )
    )
  const summary =
    formatDryRunSummary(result)

  assert.match(
    summary,
    /Listing state: LISTING_DRAFT_READY/
  )
  assert.match(
    summary,
    /QA state: QA_PASSED_FOR_HUMAN_REVIEW/
  )
  assert.match(
    summary,
    /Recommended decision: PROCEED_TO_HUMAN_REVIEW/
  )
  assert.match(
    summary,
    /Executive summary: Ready for human review\./
  )
  assert.match(
    summary,
    /Advisory only: true/
  )
  assert.match(
    summary,
    /Human review required: true/
  )
  assert.match(
    summary,
    /Marketplace API used: false/
  )
  assert.match(
    summary,
    /Real draft created: false/
  )
  assert.match(
    summary,
    /Live listing created: false/
  )
  assert.match(
    summary,
    /Listing mutated: false/
  )
  assert.doesNotMatch(
    summary,
    /supplierCost|supplierShippingCost|itemSpecifics|fullDescription|schemaVersion"\s*:/
  )
})

test("listing proposal dry-run runner: safety flags permanecen false para acciones reales", () => {
  const result =
    runListingProposalDryRun(
      buildFixtureListingProposalCase(
        "LISTING-GEN-004"
      )
    )

  assert.equal(
    result.proposal.safety.ebayApiUsed,
    false
  )
  assert.equal(
    result.proposal.safety.realDraftCreated,
    false
  )
  assert.equal(
    result.proposal.safety.publishedToEbay,
    false
  )
  assert.equal(
    result.proposal.safety.listingMutated,
    false
  )
})

test("listing proposal dry-run runner: modulo local sin red ni acciones reales", () => {
  const source =
    fs.readFileSync(
      "tools/ebay-listing-proposal-dry-run.mjs",
      "utf8"
    )

  assert.doesNotMatch(
    source,
    /fetch\(|createClient|supabase|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/i
  )
  assert.doesNotMatch(
    source,
    /callEbayApi|createDraft|createListing|publishListing|autoPublish|oa(?:uth)|to(?:ken)|draft real/i
  )
})

test("product selection integration: mapper convierte pipeline a candidato V1", () => {
  const radarProduct = {
    ...validRadarProduct,
    dimensions: {
      length: 8,
      width: 4,
      height: 3,
    },
  }
  const result =
    processRadarCandidate(
      radarProduct
    )

  const mapped =
    mapPipelineResultToProductSelectionCandidate({
      radarProduct,
      result,
      priceIntelligence: {
        recommended_sale_price:
          34,
        sold_median_price:
          32,
        confidence_score:
          0.82,
        active_count:
          6,
      },
    })

  assert.equal(
    mapped.productName,
    validRadarProduct.title
  )
  assert.equal(
    mapped.supplierName,
    "Luna Portex"
  )
  assert.equal(
    mapped.supplierSku,
    validRadarProduct.sku
  )
  assert.equal(
    mapped.internalSku,
    result.candidate.candidate_key
  )
  assert.equal(
    mapped.supplierCost,
    10
  )
  assert.equal(
    mapped.estimatedEbayPrice,
    34
  )
  assert.equal(
    mapped.stockAvailable,
    20
  )
  assert.deepEqual(
    mapped.dimensions,
    radarProduct.dimensions
  )
  assert.equal(
    mapped.marketConfidence,
    "high"
  )
})

test("product selection integration: price intelligence recomendado alimenta precio estimado", () => {
  const result =
    processRadarCandidate(
      validRadarProduct
    )

  const mapped =
    mapPipelineResultToProductSelectionCandidate({
      radarProduct:
        validRadarProduct,
      result,
      priceIntelligence: {
        recommended_sale_price:
          28.5,
        sold_median_price:
          27,
      },
    })

  assert.equal(
    mapped.estimatedEbayPrice,
    28.5
  )
  assert.equal(
    mapped.soldCompsMedianPrice,
    27
  )
})

test("product selection integration: producto bueno agrega advisory approve sin mutar estado", () => {
  const radarProduct = {
    ...validRadarProduct,
    dimensions: {
      length: 8,
      width: 4,
      height: 3,
    },
  }
  const result =
    processRadarCandidate(
      radarProduct
    )
  const originalState =
    result.candidate.state

  const advisor =
    buildPipelineProductSelectionDecision({
      radarProduct,
      result,
      priceIntelligence: {
        recommended_sale_price:
          34,
        sold_median_price:
          32,
        confidence_score:
          0.82,
      },
    })

  assert.equal(
    advisor.decision,
    "approve"
  )
  assert.equal(
    advisor.state,
    "APPROVED_FOR_DRAFT"
  )
  assert.equal(
    advisor.advisoryOnly,
    true
  )
  assert.equal(
    result.candidate.state,
    originalState
  )
  assert.notEqual(
    advisor.state,
    "APPROVED"
  )
  assert.notEqual(
    advisor.state,
    "DRAFT_CREATED"
  )
})

test("product selection integration: falta dimensiones queda advisory DATA_INCOMPLETE", () => {
  const result =
    processRadarCandidate(
      validRadarProduct
    )
  const originalState =
    result.candidate.state

  const advisor =
    buildPipelineProductSelectionDecision({
      radarProduct:
        validRadarProduct,
      result,
    })

  assert.equal(
    advisor.decision,
    "review"
  )
  assert.equal(
    advisor.state,
    "DATA_INCOMPLETE"
  )
  assert.equal(
    result.candidate.state,
    originalState
  )
})

test("product selection integration: sin stock bloquea advisory sin accion real", () => {
  const radarProduct = {
    ...validRadarProduct,
    dimensions: {
      length: 8,
      width: 4,
      height: 3,
    },
  }
  const result =
    processRadarCandidate(
      radarProduct
    )
  result.candidate.inventory_quantity =
    0
  result.candidate.state =
    "VALIDATED"

  const advisor =
    buildPipelineProductSelectionDecision({
      radarProduct,
      result,
    })

  assert.equal(
    advisor.decision,
    "blocked"
  )
  assert.equal(
    advisor.state,
    "BLOCKED"
  )
  assert.equal(
    result.candidate.state,
    "VALIDATED"
  )
  assert.equal(
    advisor.advisoryOnly,
    true
  )
  assert.doesNotMatch(
    JSON.stringify(advisor),
    /publish|created_draft|DRAFT_CREATED/i
  )
})

test("product selection visibility: read service extrae advisor desde normalized payload", () => {
  const advisor = {
    decision:
      "approve",
    state:
      "APPROVED_FOR_DRAFT",
    mainReason:
      "Candidate is ready for human review.",
    riskFlags: [],
    keyNumbers: {
      netProfit:
        8,
    },
    nextHumanAction:
      "Review before draft.",
    advisoryOnly:
      true,
  }

  assert.deepEqual(
    getProductSelectionAdvisorFromCandidate({
      normalized_payload: {
        product_selection_advisor:
          advisor,
      },
      source_payload: {
        product_selection_advisor: {
          decision:
            "review",
        },
      },
    }),
    advisor
  )
})

test("product selection visibility: read service usa fallback desde source payload", () => {
  const advisor = {
    decision:
      "review",
    state:
      "DATA_INCOMPLETE",
    advisoryOnly:
      true,
  }

  assert.deepEqual(
    getProductSelectionAdvisorFromCandidate({
      normalized_payload: {},
      source_payload: {
        product_selection_advisor:
          advisor,
      },
    }),
    advisor
  )
  assert.equal(
    getProductSelectionAdvisorFromCandidate({
      normalized_payload: {},
      source_payload: {},
    }),
    null
  )
})

test("product selection visibility: admin read service expone advisor en dashboard y detail", () => {
  const source =
    fs.readFileSync(
      path.resolve(
        "lib/ebay-winner-pipeline/admin-read-service.mjs"
      ),
      "utf8"
    )

  assert.match(
    source,
    /function getSafeAdminCandidate[\s\S]*productSelectionAdvisor/
  )
  assert.match(
    source,
    /candidates:[\s\S]*productSelectionAdvisor/
  )
  assert.match(
    source,
    /return \{[\s\S]*productSelectionAdvisor:[\s\S]*validation:/
  )
})

test("product selection visibility: UI muestra bloque read-only y empty state seguro", () => {
  const source =
    fs.readFileSync(
      path.resolve(
        "components/admin/ebay-winner-pipeline-panel.tsx"
      ),
      "utf8"
    )

  assert.match(
    source,
    /Selección de producto · Solo lectura/
  )
  assert.match(
    source,
    /Approve no publica ni crea draft real\. Requiere revisión humana\./
  )
  assert.match(
    source,
    /Evaluación de selección no disponible todavía\./
  )
  assert.match(
    source,
    /ProductSelectionSummary/
  )
  assert.match(
    source,
    /ProductSelectionDetail/
  )
  assert.match(
    source,
    /decision/
  )
  assert.match(
    source,
    /next_human_action/
  )
})

test("pipeline reactivation visibility: UI muestra ruta de desbloqueo operativa", () => {
  const source =
    fs.readFileSync(
      path.resolve(
        "components/admin/ebay-winner-pipeline-panel.tsx"
      ),
      "utf8"
    )

  assert.match(
    source,
    /Ruta de reactivacion del producto bloqueado/
  )
  assert.match(
    source,
    /Producto bloqueado reactivable/
  )
  assert.match(
    source,
    /Condiciones para desbloquear/
  )
  assert.match(
    source,
    /puede sacar este producto de bloqueado y continuar hacia paquete, listing, draft y publicacion/
  )
  assert.match(
    source,
    /getPipelineSignalLabel/
  )
  assert.match(
    source,
    /getRecoverySignalTypeLabel/
  )
  assert.match(
    source,
    /blocked_reactivation_review/
  )
})

test("product selection visibility: UI no agrega acciones reales nuevas", () => {
  const diffSource =
    fs.readFileSync(
      path.resolve(
        "components/admin/ebay-winner-pipeline-panel.tsx"
      ),
      "utf8"
    )

  assert.doesNotMatch(
    diffSource,
    /productSelection[\s\S]{0,600}(method:\s*["'](?:POST|PUT|PATCH|DELETE)["']|publishListing|createRealDraft|syncEbay|callEbayApi)/i
  )
})

test("product selection decision service: modulo puro sin IO ni escrituras", () => {
  const source =
    fs.readFileSync(
      path.resolve(
        "lib/ebay-winner-pipeline/product-selection-decision-service.mjs"
      ),
      "utf8"
    )

  assert.doesNotMatch(
    source,
    /fetch\(/
  )
  assert.doesNotMatch(
    source,
    /createClient|supabase/
  )
  assert.doesNotMatch(
    source,
    /\.(insert|update|delete|upsert|rpc)\(/
  )
  assert.doesNotMatch(
    source,
    /ebay.*api|oauth|token|publish/i
  )
})

test("market radar actionable ranking: producto nunca analizado aparece como accionable", () => {
  const result =
    getMarketRadarActionability({
      product:
        baseActionableRadarProduct,
      candidate:
        null,
      events:
        [],
    })

  assert.equal(result.radar_action_status, "actionable")
  assert.equal(
    result.actionable_reason,
    "new_product_not_reviewed"
  )
})

test("active listing risk read service: lee riesgos abiertos con limite seguro", async () => {
  const {
    supabase,
    calls,
    forbiddenWrites,
  } =
    createActiveListingRiskSupabaseMock(
      activeListingRiskRows
    )

  const risks =
    await getOpenActiveListingRisks({
      supabase,
    })

  assert.equal(
    risks.length,
    2
  )
  assert.equal(
    risks[0].risk_priority,
    "critical"
  )
  assert.equal(
    risks[0].risk_event_id,
    "risk-critical-new"
  )
  assert.deepEqual(
    calls.filter(call => call[0] === "is"),
    [
      [
        "is",
        "resolved_at",
        null,
      ],
    ]
  )
  assert.ok(
    calls.some(call =>
      call[0] === "limit" &&
      call[1] === 25
    )
  )
  assert.deepEqual(
    forbiddenWrites,
    []
  )
})

test("active listing risk read service: filtra por ebay sku y supplier sku", async () => {
  const ebaySkuMock =
    createActiveListingRiskSupabaseMock(
      activeListingRiskRows
    )

  await getRisksByEbaySku({
    supabase:
      ebaySkuMock.supabase,
    sku:
      " TEST-EBAY-SKU-1 ",
    limit:
      5,
  })

  assert.ok(
    ebaySkuMock.calls.some(call =>
      call[0] === "eq" &&
      call[1] === "active_listing.ebay_sku" &&
      call[2] === "TEST-EBAY-SKU-1"
    )
  )
  assert.ok(
    ebaySkuMock.calls.some(call =>
      call[0] === "limit" &&
      call[1] === 5
    )
  )

  const supplierSkuMock =
    createActiveListingRiskSupabaseMock(
      activeListingRiskRows
    )

  await getRisksBySupplierSku({
    supabase:
      supplierSkuMock.supabase,
    supplierSku:
      "TEST-SUPPLIER-SKU-1",
  })

  assert.ok(
    supplierSkuMock.calls.some(call =>
      call[0] === "eq" &&
      call[1] === "active_listing.supplier_sku" &&
      call[2] === "TEST-SUPPLIER-SKU-1"
    )
  )
  assert.deepEqual(
    ebaySkuMock.forbiddenWrites,
    []
  )
  assert.deepEqual(
    supplierSkuMock.forbiddenWrites,
    []
  )
})

test("active listing risk read service: summary cuenta prioridades y tipos", async () => {
  const {
    supabase,
    calls,
    forbiddenWrites,
  } =
    createActiveListingRiskSupabaseMock([
      {
        risk_type:
          "out_of_stock",
        risk_priority:
          "critical",
        resolved_at:
          null,
      },
      {
        risk_type:
          "price_up",
        risk_priority:
          "high",
        resolved_at:
          null,
      },
      {
        risk_type:
          "out_of_stock",
        risk_priority:
          "critical",
        resolved_at:
          null,
      },
    ])

  const summary =
    await getActiveListingRiskSummary({
      supabase,
    })

  assert.equal(
    summary.total_open,
    3
  )
  assert.equal(
    summary.by_priority.critical,
    2
  )
  assert.equal(
    summary.by_priority.high,
    1
  )
  assert.equal(
    summary.by_type.out_of_stock,
    2
  )
  assert.equal(
    summary.by_type.price_up,
    1
  )
  assert.ok(
    calls.some(call =>
      call[0] === "select" &&
      /risk_type/.test(call[2]) &&
      /risk_priority/.test(call[2])
    )
  )
  assert.ok(
    calls.some(call =>
      call[0] === "is" &&
      call[1] === "resolved_at" &&
      call[2] === null
    )
  )
  assert.deepEqual(
    forbiddenWrites,
    []
  )
})

test("active listing risk admin api: protege lectura y usa servicio read-only", () => {
  const source =
    fs.readFileSync(
      path.resolve(
        "app/api/admin/active-listing-risks/route.ts"
      ),
      "utf8"
    )

  assert.match(
    source,
    /export const runtime = "nodejs"/
  )
  assert.match(
    source,
    /validateAdminApiRequest\(req\)[\s\S]*if \(unauthorizedResponse\)[\s\S]*getSupabaseAdminClient\(\)/
  )
  assert.match(
    source,
    /getActiveListingRiskSummary/
  )
  assert.match(
    source,
    /getOpenActiveListingRisks/
  )
  assert.match(
    source,
    /getRisksByEbaySku/
  )
  assert.match(
    source,
    /getRisksBySupplierSku/
  )
  assert.match(
    source,
    /dryRunOnly:\s*true/
  )
  assert.doesNotMatch(
    source,
    new RegExp("\\.(insert|update|delete|upsert|rpc)\\(")
  )
})

test("active listing risk admin api: valida modos y queries ambiguas", () => {
  const source =
    fs.readFileSync(
      path.resolve(
        "app/api/admin/active-listing-risks/route.ts"
      ),
      "utf8"
    )

  assert.match(
    source,
    /const DEFAULT_LIMIT[\s\S]*25/
  )
  assert.match(
    source,
    /const MAX_LIMIT[\s\S]*100/
  )
  assert.match(
    source,
    /active_listing_risk_invalid_limit/
  )
  assert.match(
    source,
    /summary[\s\S]*sku[\s\S]*supplierSku[\s\S]*active_listing_risk_ambiguous_query/
  )
  assert.match(
    source,
    /sku[\s\S]*supplierSku[\s\S]*active_listing_risk_ambiguous_query/
  )
  assert.match(
    source,
    /mode:\s*"summary"/
  )
  assert.match(
    source,
    /mode:\s*"ebay_sku"/
  )
  assert.match(
    source,
    /mode:\s*"supplier_sku"/
  )
  assert.match(
    source,
    /mode:\s*"open"/
  )
})

test("active listing risk admin ui: muestra riesgos activos solo lectura", () => {
  const source =
    fs.readFileSync(
      path.resolve(
        "components/admin/ebay-winner-pipeline-panel.tsx"
      ),
      "utf8"
    )

  assert.match(
    source,
    /Riesgos de listings activos/
  )
  assert.match(
    source,
    /Solo lectura · No modifica eBay/
  )
  assert.match(
    source,
    /\/api\/admin\/active-listing-risks\?summary=true/
  )
  assert.match(
    source,
    /\/api\/admin\/active-listing-risks\?limit=10/
  )
  assert.match(
    source,
    /method:\s*"GET"[\s\S]*Authorization:\s*`Bearer \$\{token\}`/
  )
  assert.match(
    source,
    /No hay riesgos abiertos detectados\./
  )
  assert.match(
    source,
    /Cargando riesgos de listings activos/
  )
  assert.doesNotMatch(
    source,
    /ebay_active_listings|ebay_active_listing_risk_events/
  )
})

test("market radar actionable ranking: producto ya analizado sin evento nuevo no reaparece", () => {
  const result =
    getMarketRadarActionability({
      product:
        baseActionableRadarProduct,
      candidate: {
        id:
          "candidate-reviewed",
        state:
          "VALIDATED",
        last_evaluated_at:
          "2026-06-24T12:00:00.000Z",
      },
      events: [
        {
          event_type:
            "price_down",
          created_at:
            "2026-06-24T11:00:00.000Z",
        },
      ],
    })

  assert.equal(result.radar_action_status, "reviewed")
  assert.equal(
    result.actionable_reason,
    "reviewed_no_new_signal"
  )
})

test("market radar actionable ranking: candidato sin last_evaluated_at no se oculta", () => {
  const result =
    getMarketRadarActionability({
      product:
        baseActionableRadarProduct,
      candidate: {
        id:
          "candidate-not-evaluated",
        state:
          "DETECTED",
        updated_at:
          "2026-06-24T12:00:00.000Z",
      },
      events:
        [],
    })

  assert.equal(result.radar_action_status, "actionable")
  assert.equal(
    result.pipeline_last_evaluated_at,
    null
  )
  assert.equal(
    result.actionable_reason,
    "pipeline_candidate_not_evaluated"
  )
})

test("market radar actionable ranking: evento material anterior al analisis no reaparece", () => {
  const result =
    getMarketRadarActionability({
      product:
        baseActionableRadarProduct,
      candidate: {
        id:
          "candidate-old-event",
        state:
          "VALIDATED",
        last_evaluated_at:
          "2026-06-24T12:00:00.000Z",
      },
      events: [
        {
          event_type:
            "restocked",
          created_at:
            "2026-06-24T11:59:59.000Z",
        },
      ],
    })

  assert.equal(result.radar_action_status, "reviewed")
  assert.equal(
    result.has_material_change_since_pipeline_review,
    false
  )
})

test("market radar actionable ranking: price_down posterior vuelve accionable el producto", () => {
  const result =
    getMarketRadarActionability({
      product:
        baseActionableRadarProduct,
      candidate: {
        id:
          "candidate-price-down",
        state:
          "VALIDATED",
        last_evaluated_at:
          "2026-06-24T12:00:00.000Z",
      },
      events: [
        {
          event_type:
            "price_down",
          created_at:
            "2026-06-24T12:15:00.000Z",
        },
      ],
    })

  assert.equal(result.radar_action_status, "actionable")
  assert.equal(
    result.actionable_reason,
    "price_down_after_review"
  )
})

test("market radar actionable ranking: price_up solo es material en estados avanzados", () => {
  const needsDataResult =
    getMarketRadarActionability({
      product:
        baseActionableRadarProduct,
      candidate: {
        id:
          "candidate-price-up-needs-data",
        state:
          "NEEDS_DATA",
        last_evaluated_at:
          "2026-06-24T12:00:00.000Z",
      },
      events: [
        {
          event_type:
            "price_up",
          created_at:
            "2026-06-24T12:30:00.000Z",
        },
      ],
    })

  const validatedResult =
    getMarketRadarActionability({
      product:
        baseActionableRadarProduct,
      candidate: {
        id:
          "candidate-price-up-validated",
        state:
          "VALIDATED",
        last_evaluated_at:
          "2026-06-24T12:00:00.000Z",
      },
      events: [
        {
          event_type:
            "price_up",
          created_at:
            "2026-06-24T12:30:00.000Z",
        },
      ],
    })

  assert.equal(
    needsDataResult.radar_action_status,
    "reviewed"
  )
  assert.equal(
    validatedResult.radar_action_status,
    "actionable"
  )
  assert.equal(
    validatedResult.actionable_reason,
    "price_up_after_review"
  )
})

test("market radar actionable ranking: restocked posterior vuelve accionable el producto", () => {
  const result =
    getMarketRadarActionability({
      product:
        baseActionableRadarProduct,
      candidate: {
        id:
          "candidate-restocked",
        state:
          "BLOCKED",
        last_evaluated_at:
          "2026-06-24T12:00:00.000Z",
      },
      events: [
        {
          event_type:
            "restocked",
          created_at:
            "2026-06-24T12:20:00.000Z",
        },
      ],
    })

  assert.equal(result.radar_action_status, "actionable")
  assert.equal(
    result.actionable_reason,
    "restocked_after_review"
  )
})

test("market radar actionable ranking: solo variante con confianza alta cuenta como stock confirmado", () => {
  assert.equal(
    isConfirmedVariantStock(
      baseActionableRadarProduct
    ),
    true
  )

  assert.equal(
    isConfirmedVariantStock({
      ...baseActionableRadarProduct,
      inventory_scope:
        "availability_only",
      inventory_quantity:
        null,
    }),
    false
  )

  assert.equal(
    isConfirmedVariantStock({
      ...baseActionableRadarProduct,
      inventory_scope:
        "product_or_category_signal",
      product_available_quantity:
        50000,
    }),
    false
  )

  assert.equal(
    isConfirmedVariantStock({
      ...baseActionableRadarProduct,
      inventory_quantity:
        50000,
    }),
    false
  )

  assert.equal(
    isConfirmedVariantStock({
      ...baseActionableRadarProduct,
      inventory_quantity:
        8,
      inventory_source:
        "manual_admin_confirmation",
    }),
    true
  )
})

test("market radar manual stock confirmation: valida cantidades antes de guardar", () => {
  assert.equal(
    getManualStockQuantity(8),
    8
  )
  assert.equal(
    getManualStockQuantity("12"),
    12
  )
  assert.equal(
    getManualStockQuantity(0),
    null
  )
  assert.equal(
    getManualStockQuantity(-1),
    null
  )
  assert.equal(
    getManualStockQuantity("abc"),
    null
  )
  assert.equal(
    getManualStockQuantity(50000),
    null
  )
})

test("market radar actionable ranking: ya revisados muestra candidato sin cambios materiales", () => {
  const result =
    getMarketRadarActionability({
      product:
        baseActionableRadarProduct,
      candidate: {
        id:
          "candidate-reviewed-clean",
        state:
          "NEEDS_DATA",
        last_evaluated_at:
          "2026-06-24T12:00:00.000Z",
      },
      events: [
        {
          event_type:
            "discount_ended",
          created_at:
            "2026-06-24T12:30:00.000Z",
        },
      ],
    })

  assert.equal(result.radar_action_status, "reviewed")
  assert.equal(
    result.has_material_change_since_pipeline_review,
    false
  )
})

test("producto válido se evalúa completo y genera WhatsApp dryRun", () => {
  const result = processRadarCandidate(validRadarProduct)

  assert.equal(result.candidate.state, "VALIDATED")
  assert.equal(result.validation.status, "passed")
  assert.ok(result.profitScenario.net_profit >= 5)
  assert.ok(result.score.winner_score > 0)
  assert.equal(result.whatsappDryRunPayload.dryRun, true)
  assert.equal(result.whatsappDryRunPayload.enableRealSend, false)
  assert.equal(result.whatsappDryRunPayload.interactive.action.buttons.length, 4)
  assert.equal(
    result.whatsappDryRunPayload.interactive.action.buttons[0].reply.title,
    "Preparar draft"
  )
  assert.notEqual(
    result.whatsappDryRunPayload.interactive.action.buttons[0].reply.title,
    "Crear borrador"
  )
})

test("winner pipeline normaliza stock confirmado desde inventory_context", () => {
  const {
    inventory_quantity,
    ...productWithoutTopLevelQuantity
  } = validRadarProduct

  const result =
    processRadarCandidate({
      ...productWithoutTopLevelQuantity,
      raw: {
        inventory_context: {
          inventory_quantity:
            inventory_quantity,
          inventory_scope:
            "variant_level",
          inventory_confidence:
            "high",
          inventory_source:
            "manual_admin_confirmation",
        },
      },
    })

  assert.equal(
    result.candidate.stock,
    20
  )
  assert.equal(
    result.candidate.inventory_context.inventory_quantity,
    20
  )
  assert.equal(
    result.validation.status,
    "passed"
  )
})

test("radar advisor: out_of_stock + DRAFT_CREATED -> review_existing_draft_inventory critical", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "out_of_stock",
        new_value: {
          available:
            false,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          12,
      },
      {
        id:
          "candidate-1",
        state:
          "DRAFT_CREATED",
      }
    )

  assert.equal(alert.recommended_action, "review_existing_draft_inventory")
  assert.equal(alert.severity, "critical")
  assert.equal(alert.required_human_approval, true)
  assert.equal(alert.seller_action_label, "No listar")
  assert.equal(alert.seller_priority, "Urgente")
  assert.equal(alert.seller_reason, "Draft listo pero sin stock")
  assert.equal(alert.seller_next_step, "Confirmar stock antes de publicar.")
})

test("radar advisor: LISTED + out_of_stock prioriza riesgo de cancelacion", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "out_of_stock",
        new_value: {
          available:
            false,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          0,
      },
      {
        id:
          "candidate-listed-oos",
        state:
          "LISTED",
      }
    )

  assert.equal(alert.recommended_action, "prepare_pause_or_reduce_quantity")
  assert.equal(alert.severity, "critical")
  assert.equal(alert.required_human_approval, true)
  assert.equal(alert.seller_action_label, "No listar")
  assert.equal(alert.seller_priority, "Urgente")
  assert.equal(
    alert.seller_reason,
    "Riesgo de cancelacion por falta de stock"
  )
  assert.equal(
    alert.seller_next_step,
    "Confirmar stock manual y revisar publicacion."
  )
})

test("radar advisor: LISTED + low_stock prioriza validar antes de vender", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "low_stock",
        new_value: {
          inventory_quantity:
            3,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          3,
      },
      {
        id:
          "candidate-listed-low-stock",
        state:
          "LISTED",
      }
    )

  assert.equal(alert.recommended_action, "prepare_pause_or_reduce_quantity")
  assert.equal(alert.severity, "critical")
  assert.equal(alert.seller_action_label, "Validar stock")
  assert.equal(alert.seller_priority, "Urgente")
  assert.equal(alert.seller_reason, "Producto listado con stock bajo")
  assert.equal(
    alert.seller_next_step,
    "Confirmar disponibilidad antes de recibir venta."
  )
})

test("radar advisor: VALIDATED + out_of_stock sube prioridad por producto avanzado", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "out_of_stock",
        new_value: {
          available:
            false,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          0,
      },
      {
        id:
          "candidate-validated-oos",
        state:
          "VALIDATED",
      }
    )

  assert.equal(alert.seller_action_label, "Validar stock")
  assert.equal(alert.seller_priority, "Alta")
  assert.equal(
    alert.seller_reason,
    "Producto ya validado perdio disponibilidad"
  )
  assert.equal(
    alert.seller_next_step,
    "Reconfirmar proveedor antes de avanzar."
  )
})

test("radar advisor: restocked + BLOCKED -> reanalizar candidato", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "restocked",
        new_value: {
          available:
            true,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          12,
      },
      {
        id:
          "candidate-2",
        state:
          "BLOCKED",
      }
    )

  assert.equal(alert.recommended_action, "resurface_for_reanalysis")
  assert.equal(alert.severity, "medium")
  assert.equal(alert.seller_action_label, "Reanalizar candidato")
  assert.equal(alert.seller_priority, "Alta")
  assert.equal(
    alert.seller_reason,
    "Producto bloqueado con condicion comercial nueva"
  )
  assert.match(
    alert.seller_next_step,
    /puede salir de bloqueado/
  )
})

test("radar advisor: price_down -> reprocess_with_updated_cost", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "price_down",
        old_value: {
          price:
            30,
        },
        new_value: {
          price:
            20,
        },
      },
      baseRadarAdvisorProduct,
      null
    )

  assert.equal(alert.recommended_action, "reprocess_with_updated_cost")
  assert.equal(alert.severity, "medium")
  assert.equal(alert.seller_action_label, "Revisar oportunidad")
  assert.equal(alert.seller_priority, "Media")
  assert.equal(alert.seller_reason, "Bajo costo con stock disponible")
})

test("radar advisor playbook: price_down recalcula margen y reabre oportunidad", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "price_down",
        old_value: {
          price:
            30,
        },
        new_value: {
          price:
            20,
        },
      },
      baseRadarAdvisorProduct,
      null
    )

  assert.equal(alert.commercial_playbook.advisory_only, true)
  assert.equal(alert.commercial_playbook.label, "Bajo precio")
  assert.match(
    alert.commercial_playbook.recommendation,
    /Recalcular margen/
  )
  assert.match(
    alert.commercial_playbook.recommendation,
    /reabrir oportunidad/
  )
  assert.equal(
    alert.event_intelligence_label,
    "Oportunidad de revision"
  )
  assert.match(
    alert.event_intelligence_summary,
    /Precio bajo con stock disponible/
  )
  assert.equal(
    alert.event_intelligence_advisory_only,
    true
  )
})

test("radar event intelligence: out_of_stock marca riesgo de inventario", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "out_of_stock",
        new_value: {
          available:
            false,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          0,
        out_of_stock_count_7d:
          2,
      },
      null
    )

  assert.equal(
    alert.event_intelligence_label,
    "Riesgo de inventario"
  )
  assert.equal(
    alert.event_intelligence_severity,
    "critical"
  )
  assert.match(
    alert.event_intelligence_summary,
    /Stock agotado/
  )
})

test("radar event intelligence: stock ambiguo requiere validacion manual", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "new_product",
        new_value: {
          available:
            true,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          null,
        inventory_source:
          "luna_availability",
      },
      null
    )

  assert.equal(
    alert.event_intelligence_label,
    "Validacion manual"
  )
  assert.equal(
    alert.event_intelligence_severity,
    "high"
  )
  assert.equal(alert.severity, "high")
  assert.equal(
    alert.recommended_action,
    "validate_stock_before_review"
  )
  assert.match(
    alert.event_intelligence_summary,
    /Confirmar stock real/
  )
  assert.equal(alert.seller_action_label, "Validar stock")
  assert.equal(alert.seller_priority, "Alta")
  assert.equal(alert.seller_reason, "Stock no confirmado")
  assert.equal(
    alert.seller_next_step,
    "Confirmar disponibilidad antes de evaluar."
  )
})

test("radar advisor seller risk: detecta restricciones por tipo de producto", () => {
  const paintAlert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "new_product",
        new_value: {
          available:
            true,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        title:
          "Blue Rust-Oleum Professional Inverted Striping Paint Spray",
      },
      null
    )

  assert.equal(
    paintAlert.seller_risk_label,
    "Shipping restringido"
  )
  assert.equal(
    paintAlert.seller_action_label,
    "Revisar riesgo eBay"
  )
  assert.equal(
    paintAlert.seller_priority,
    "Alta"
  )
  assert.match(
    paintAlert.seller_risk_summary,
    /restricciones de envio/
  )

  const supplementAlert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "new_product",
        new_value: {
          available:
            true,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        title:
          "Green Hills Ginseng Herbal Supplement",
        product_type:
          "Supplements",
      },
      null
    )

  assert.equal(
    supplementAlert.seller_risk_label,
    "Compliance / claims"
  )
  assert.match(
    supplementAlert.seller_risk_summary,
    /restricciones eBay/
  )

  const brandAlert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "new_product",
        new_value: {
          available:
            true,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        title:
          "PowerA Clutch Bag for Nintendo Switch",
      },
      null
    )

  assert.equal(
    brandAlert.seller_risk_label,
    "Marca / compatibilidad"
  )
  assert.match(
    brandAlert.seller_risk_summary,
    /UPC/
  )
})

test("radar advisor: conserva supplier_variant_id para resolver acciones desde alertas", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "price_down",
        supplier_variant_id:
          "variant-alert-123",
        new_value: {
          price:
            20,
        },
      },
      baseRadarAdvisorProduct,
      null
    )

  assert.equal(
    alert.supplier_variant_id,
    "variant-alert-123"
  )
})

test("market radar panel: advisor alert action ubica producto sin analizarlo", () => {
  const source =
    fs.readFileSync(
      path.resolve(
        "components/admin/market-radar-panel.tsx"
      ),
      "utf8"
    )

  assert.match(
    source,
    /Buscar en Radar/
  )
  assert.match(
    source,
    /alert\.product_id[\s\S]*alert\.supplier_variant_id[\s\S]*alert\.supplier_sku[\s\S]*alert\.product_title/
  )
  assert.match(
    source,
    /const fallbackTerms[\s\S]*alert\.product_title/
  )
  assert.match(
    source,
    /preferredSearchTerm[\s\S]*getAdvisorAlertSearchTerms/
  )
  assert.match(
    source,
    /requestDashboard\(\{\s*search:\s*searchTerm/
  )
  assert.match(
    source,
    /const searchDashboard[\s\S]*await requestDashboard\(\{\s*search:\s*searchTerm[\s\S]*searchDashboard\.products\.find/
  )
  assert.match(
    source,
    /setFocusedRadarProductKey\([\s\S]*getProductEvaluationKey/
  )
  assert.match(
    source,
    /getAdvisorAlertPreferredSearchTerm[\s\S]*setRadarSearch[\s\S]*setActiveRadarSearch/
  )
  assert.match(
    source,
    /Producto encontrado en Radar\. Buscador listo con:/
  )
  assert.doesNotMatch(
    source,
    /reviewAdvisorAlertCandidate[\s\S]*evaluateInEbayPipeline\(\s*product\s*\)/
  )
  assert.match(
    source,
    /Buscando en Radar:/
  )
  assert.match(
    source,
    /getMarketRadarProductSearchRank[\s\S]*product\.supplier_variant_id[\s\S]*setFocusedRadarProductKey/
  )
  assert.match(
    source,
    /Busqueda ejecutada:/
  )
  assert.match(
    source,
    /Advisor del Vendedor/
  )
  assert.match(
    source,
    /Oportunidades encontradas/
  )
  assert.match(
    source,
    /Productos nuevos sin evaluacion previa/
  )
  assert.match(
    source,
    /isSalesDiscoveryOpportunity/
  )
  assert.match(
    source,
    /salesOpportunityScanCounts/
  )
  assert.match(
    source,
    /getSalesOpportunitySignalLabel/
  )
  assert.match(
    source,
    /getSalesOpportunitySignalClassName/
  )
  assert.match(
    source,
    /Este escaner evita repetir productos ya evaluados/
  )
  assert.match(
    source,
    /oportunidades conocidas con cambio de stock, precio o margen pasan al Centro de Venta eBay/
  )
  assert.match(
    source,
    /Siguiente accion/
  )
  assert.match(
    source,
    /getAdvisorSeverityLabel/
  )
  assert.doesNotMatch(
    source,
    /Solo busca en Radar/
  )
  assert.doesNotMatch(
    source,
    /No publica ni crea drafts/
  )
  assert.match(
    source,
    /Prioridad de venta/
  )
  assert.match(
    source,
    /advisorFilterCounts/
  )
  assert.match(
    source,
    /salesOpportunityAlerts/
  )
  assert.match(
    source,
    /formatCountLabel\([\s\S]*salesOpportunityAlerts\.length[\s\S]*"oportunidad encontrada"[\s\S]*"oportunidades encontradas"/
  )
  assert.match(
    source,
    /formatCountLabel\([\s\S]*advisorFilterCounts\.high \|\| 0[\s\S]*"oportunidad alta"[\s\S]*"oportunidades altas"/
  )
  assert.match(
    source,
    /{option\.label}{" "}[\s\S]*{advisorFilterCounts\[option\.value\] \|\| 0}/
  )
  assert.doesNotMatch(
    source,
    /Filtro activo/
  )
  assert.match(
    source,
    /getAdvisorSellerPriorityRank[\s\S]*seller_priority/
  )
  assert.match(
    source,
    /const maxQueueAlerts = 5/
  )
  assert.match(
    source,
    /seller_action_label[\s\S]*getAdvisorAlertSearchTerms[\s\S]*product_title/
  )
  assert.doesNotMatch(
    source,
    /Revisa el detalle completo debajo/
  )
  assert.match(
    source,
    /\+{hiddenAlertCount} alertas en detalle/
  )
  assert.match(
    source,
    /radarAdvisorReviewFilterOptions[\s\S]*Todas[\s\S]*Urgente[\s\S]*Alta/
  )
  assert.doesNotMatch(
    source,
    /radarAdvisorReviewFilterOptions[\s\S]*Stock[\s\S]*Margen[\s\S]*Riesgo/
  )
  assert.match(
    source,
    /matchesRadarAdvisorReviewFilter[\s\S]*seller_priority[\s\S]*seller_action_label/
  )
  assert.match(
    source,
    /Mostrando {filteredAdvisorAlerts\.length} de {salesOpportunityAlerts\.length}[\s\S]*getRadarAdvisorFilterResultTitle/
  )
  assert.match(
    source,
    /Sin oportunidades para este filtro/
  )
  assert.match(
    source,
    /Sin oportunidades encontradas por ahora/
  )
})

test("market radar panel: muestra catalog coverage parcial sin acciones nuevas", () => {
  const source =
    fs.readFileSync(
      path.resolve(
        "components/admin/market-radar-panel.tsx"
      ),
      "utf8"
    )

  assert.match(
    source,
    /ebay-luna-portex-catalog-coverage-audit-v1\.json/
  )
  assert.match(
    source,
    /ebay-market-radar-seller-command-center-mvp-v1\.json/
  )
  assert.match(
    source,
    /Centro de Venta eBay/
  )
  assert.match(
    source,
    /Primero protege productos revisados o listados/
  )
  assert.match(
    source,
    /Despues reevalua cambios de stock, precio o margen/
  )
  assert.match(
    source,
    /Recomendaciones de solo lectura/
  )
  assert.match(
    source,
    /Sin acciones automaticas/
  )
  assert.match(
    source,
    /Menu de trabajo/
  )
  assert.match(
    source,
    /openSellerCommandQueue/
  )
  assert.match(
    source,
    /Productos en esta cola/
  )
  assert.match(
    source,
    /activeSellerCommandProducts/
  )
  assert.match(
    source,
    /getRadarRankingFilterTitle/
  )
  assert.match(
    source,
    /Ver lista completa/
  )
  assert.match(
    source,
    /setFocusedRadarProductKey\([\s\S]*getProductEvaluationKey/
  )
  assert.match(
    source,
    /Producto seleccionado desde Centro de Venta:/
  )
  assert.match(
    source,
    /Proteger existentes/
  )
  assert.match(
    source,
    /Cambios precio\/margen/
  )
  assert.match(
    source,
    /Todo monitoreado/
  )
  assert.match(
    source,
    /Productos evaluados o vinculados/
  )
  assert.match(
    source,
    /price_margin_changes/
  )
  assert.match(
    source,
    /blocked_or_review/
  )
  assert.match(
    source,
    /Resultados actuales del Radar/
  )
  assert.match(
    source,
    /Escenarios de referencia/
  )
  assert.match(
    source,
    /Casos de decision del vendedor/
  )
  assert.match(
    source,
    /getSellerScenarioToneClassName/
  )
  assert.match(
    source,
    /sellerScenarioEventLabels/
  )
  assert.match(
    source,
    /sellerScenarioPipelineLabels/
  )
  assert.match(
    source,
    /sellerScenarioActionLabels/
  )
  assert.match(
    source,
    /Producto vinculado con riesgo de stock\. Revisarlo antes de buscar oportunidades nuevas/
  )
  assert.match(
    source,
    /Cobertura del catalogo/
  )
  assert.match(
    source,
    /Cobertura parcial: solo colecciones sincronizadas/
  )
  assert.match(
    source,
    /Detalle de cobertura/
  )
  assert.match(
    source,
    /Top 50 dentro del alcance sincronizado/
  )
  assert.match(
    source,
    /No afirmar escaneo completo de Luna Portex todavia/
  )
  assert.match(
    source,
    /Solo colecciones configuradas/
  )
  assert.match(
    source,
    /Falta revisar cobertura/
  )
  assert.match(
    source,
    /Alcance parcial confirmado/
  )
  assert.match(
    source,
    /No vender como catalogo completo/
  )
  assert.match(
    source,
    /Descubrimiento parcial: solo colecciones sincronizadas/
  )
  assert.match(
    source,
    /Monitoreo obligatorio para productos vinculados/
  )
  assert.match(
    source,
    /Primero proteger productos existentes/
  )
  assert.match(
    source,
    /Producto vinculado fuera del alcance sincronizado/
  )
  assert.match(
    source,
    /Revision manual en Luna Portex requerida/
  )
  assert.match(
    source,
    /Prioridad 1: listados con riesgo de stock o precio/
  )
  assert.match(
    source,
    /Prioridad 5: oportunidades nuevas del alcance parcial/
  )
  assert.match(
    source,
    /Proteger revisados o listados/
  )
  assert.match(
    source,
    /Revisar cambios de precio o margen/
  )
  assert.match(
    source,
    /Riesgo de stock/
  )
  assert.match(
    source,
    /isExistingStockRiskSignal/
  )
  assert.match(
    source,
    /status === "stock_needs_validation"[\s\S]*status === "out_of_stock"[\s\S]*confirmedQuantity <= 3/
  )
  assert.match(
    source,
    /Agotado, bajo o validar/
  )
  assert.match(
    source,
    /Agotado, bajo o sin cantidad confiable/
  )
  assert.match(
    source,
    /riesgo de stock y requieren validacion antes de vender/
  )
  assert.match(
    source,
    /Siguiente accion/
  )
  assert.match(
    source,
    /Cambios de margen/
  )
  assert.match(
    source,
    /Bloqueados o por revisar/
  )
  assert.match(
    source,
    /Verde: revisar para listar/
  )
  assert.match(
    source,
    /Amarillo: potencial con validacion pendiente/
  )
  assert.match(
    source,
    /Rojo: no listar/
  )
  assert.match(
    source,
    /Azul: revisado, monitorear/
  )
  assert.match(
    source,
    /Morado: evento nuevo, reanalizar/
  )
  assert.match(
    source,
    /Ejemplo vinculado con riesgo de stock/
  )
  assert.match(
    source,
    /Ejemplo vinculado fuera del alcance sincronizado/
  )
  assert.match(
    source,
    /Ejemplo bloqueado que volvio a stock/
  )
  assert.match(
    source,
    /Ejemplo revisado con mejor margen/
  )
  assert.match(
    source,
    /Ejemplo de oportunidad sincronizada/
  )

  const currentRadarResultsIndex =
    source.indexOf("Resultados actuales del Radar")
  const referenceScenariosIndex =
    source.indexOf("Escenarios de referencia")
  const catalogCoverageIndex =
    source.indexOf("Cobertura del catalogo")

  assert.ok(
    currentRadarResultsIndex >= 0,
    "Resultados actuales del Radar heading must exist"
  )
  assert.ok(
    referenceScenariosIndex >= 0,
    "Escenarios de referencia section must exist"
  )
  assert.ok(
    catalogCoverageIndex >= 0,
    "Cobertura del catalogo section must exist"
  )
  assert.ok(
    currentRadarResultsIndex < referenceScenariosIndex,
    "Resultados actuales must appear before reference scenarios"
  )
  assert.ok(
    referenceScenariosIndex < catalogCoverageIndex,
    "Coverage details must appear after reference scenarios"
  )

  const scenarioSectionStart =
    source.indexOf(
      "<section className=\"rounded-lg border border-emerald-300/15",
      currentRadarResultsIndex
    )
  const scenarioSectionEnd =
    source.indexOf("</section>", scenarioSectionStart)
  const scenarioBlock =
    source.slice(
      scenarioSectionStart,
      scenarioSectionEnd
    )

  assert.doesNotMatch(
    scenarioBlock,
    /Read-only Scenario Examples/
  )
  assert.doesNotMatch(
    scenarioBlock,
    /Pipeline state:/
  )
  assert.doesNotMatch(
    scenarioBlock,
    /product\.reason/
  )
})

test("market radar api: advisor alerts resuelven candidato por variante", () => {
  const source =
    fs.readFileSync(
      path.resolve(
        "app/api/admin/market-radar/route.ts"
      ),
      "utf8"
    )

  assert.match(
    source,
    /function getCandidateForMarketRadarEvent/
  )
  assert.match(
    source,
    /event\.supplier_variant_id[\s\S]*candidatesByVariantKey\.get[\s\S]*getPipelineCandidateVariantKey\([\s\S]*productId,[\s\S]*event\.supplier_variant_id/
  )
  assert.match(
    source,
    /event\.supplier_variant_id[\s\S]*\|\| null[\s\S]*fallbackCandidatesByProductId\.get\(productId\)/
  )
  assert.match(
    source,
    /getRadarAdvisorEvent\([\s\S]*getCandidateForMarketRadarEvent\({[\s\S]*event,[\s\S]*candidatesByVariantKey,[\s\S]*fallbackCandidatesByProductId/
  )
})

test("market radar panel: catalog coverage block no agrega llamadas ni mutaciones", () => {
  const source =
    fs.readFileSync(
      path.resolve(
        "components/admin/market-radar-panel.tsx"
      ),
      "utf8"
    )
  const copyStart =
    source.indexOf("const catalogCoverageAuditCopy")
  const copyEnd =
    source.indexOf("function getAbortErrorMessage", copyStart)
  const sectionStart =
    source.indexOf(
      "<section className=\"rounded-lg border border-amber-300/20",
      copyEnd
    )
  const sectionEnd =
    source.indexOf("</section>", sectionStart)

  assert.ok(
    copyStart >= 0,
    "catalogCoverageAuditCopy must exist"
  )
  assert.ok(
    copyEnd > copyStart,
    "catalogCoverageAuditCopy must end before helper functions"
  )
  assert.ok(
    sectionStart >= 0,
    "Catalog Coverage JSX section must exist"
  )
  assert.ok(
    sectionEnd > sectionStart,
    "Catalog Coverage JSX section must close"
  )

  const coverageBlock =
    `${source.slice(copyStart, copyEnd)}\n${source.slice(
      sectionStart,
      sectionEnd + "</section>".length
    )}`

  for (const forbiddenPattern of [
    /fetch\(/,
    /createClient/,
    /process\.env/,
    /http:\/\//,
    /https:\/\//,
    /\.insert\(/,
    /\.update\(/,
    /\.delete\(/,
    /\.upsert\(/,
    /\.rpc\(/,
  ]) {
    assert.doesNotMatch(
      coverageBlock,
      forbiddenPattern
    )
  }

  assert.doesNotMatch(
    coverageBlock,
    /catalogCoverageAudit\.coverageStatus/
  )
  assert.doesNotMatch(
    coverageBlock,
    /catalogCoverageAudit\.coverageDecision/
  )
})

test("market radar panel: seller command menu solo filtra UI local", () => {
  const source =
    fs.readFileSync(
      path.resolve(
        "components/admin/market-radar-panel.tsx"
      ),
      "utf8"
    )
  const menuStart =
    source.indexOf("{sellerCommandCenterCopy.commandMenu}")
  const menuEnd =
    source.indexOf(
      "<section className=\"rounded-lg border border-white/10 bg-white/[0.03]",
      menuStart
    )

  assert.ok(
    menuStart >= 0,
    "Seller command menu JSX must exist"
  )
  assert.ok(
    menuEnd > menuStart,
    "Seller command menu block must end before radar results"
  )

  const commandMenuBlock =
    source.slice(
      menuStart,
      menuEnd
    )

  assert.match(
    source,
    /setRankingFilter\(filter\)/
  )
  assert.match(
    commandMenuBlock,
    /openSellerCommandQueue/
  )
  assert.match(
    source,
    /searchResultsRef\.current\?\.scrollIntoView/
  )

  for (const forbiddenPattern of [
    /fetch\(/,
    /createClient/,
    /process\.env/,
    /http:\/\//,
    /https:\/\//,
    /\.insert\(/,
    /\.update\(/,
    /\.delete\(/,
    /\.upsert\(/,
    /\.rpc\(/,
  ]) {
    assert.doesNotMatch(
      commandMenuBlock,
      forbiddenPattern
    )
  }
})

test("market radar dashboard: busqueda evita conteos globales exactos", () => {
  const source =
    fs.readFileSync(
      path.resolve(
        "app/api/admin/market-radar/route.ts"
      ),
      "utf8"
    )

  assert.match(
    source,
    /const isSearchDashboard[\s\S]*sanitizeMarketRadarSearch/
  )
  assert.match(
    source,
    /if \(!useLightweightDashboard\) \{[\s\S]*count:\s*"exact"/
  )
  assert.match(
    source,
    /useLightweightDashboard[\s\S]*\.in\(\s*"product_id",\s*latestProductIds\s*\)/
  )
  assert.match(
    source,
    /supplier_variant_id[\s\S]*search/
  )
  assert.match(
    source,
    /function isUuidLike[\s\S]*const productIdSearchPromise[\s\S]*isUuidLike\(search\)[\s\S]*\.eq\(\s*"id",\s*search\s*\)/
  )
  assert.match(
    source,
    /sync[\s\S]*runLunaPortexMarketRadarSync[\s\S]*getMarketRadarDashboard\(\{\s*lightweight:\s*true/
  )
  assert.match(
    source,
    /export async function GET[\s\S]*getMarketRadarDashboard\(\{[\s\S]*lightweight:\s*true/
  )
})

test("radar advisor: low_stock -> prepare_pause_or_reduce_quantity", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "low_stock",
        new_value: {
          inventory_quantity:
            2,
        },
      },
      baseRadarAdvisorProduct,
      {
        id:
          "candidate-3",
        state:
          "VALIDATED",
      }
    )

  assert.equal(alert.recommended_action, "prepare_pause_or_reduce_quantity")
  assert.equal(alert.severity, "critical")
})

test("radar advisor inventory: quantity numerico se propaga", () => {
  const stockContext =
    getNormalizedInventoryContext({
      quantity:
        24,
      available:
        true,
    })

  assert.equal(stockContext.inventory_quantity, 24)
  assert.equal(stockContext.inventory_status, "in_stock")
  assert.equal(stockContext.inventory_source, "luna_numeric")
  assert.equal(stockContext.inventory_confidence, "high")
})

test("radar advisor inventory: quantity string se normaliza", () => {
  const stockContext =
    getNormalizedInventoryContext({
      stock:
        "18",
      available:
        true,
    })

  assert.equal(stockContext.inventory_quantity, 18)
  assert.equal(stockContext.inventory_source, "luna_numeric")
})

test("radar advisor inventory: quantity invalido no inventa cantidad", () => {
  const stockContext =
    getNormalizedInventoryContext({
      quantity:
        "18 unidades",
    })

  assert.equal(stockContext.inventory_quantity, null)
  assert.equal(stockContext.inventory_status, "unknown")
  assert.equal(stockContext.inventory_source, "not_exposed")
})

test("radar advisor inventory: available true sin quantity no inventa unidades", () => {
  const stockContext =
    getNormalizedInventoryContext({
      available:
        true,
    })

  assert.equal(stockContext.inventory_quantity, null)
  assert.equal(stockContext.inventory_status, "in_stock")
  assert.equal(stockContext.inventory_source, "luna_availability")
  assert.equal(stockContext.inventory_confidence, "medium")
})

test("radar advisor inventory: available false queda out_of_stock", () => {
  const stockContext =
    getNormalizedInventoryContext({
      available:
        false,
    })

  assert.equal(stockContext.inventory_quantity, 0)
  assert.equal(stockContext.inventory_status, "out_of_stock")
  assert.equal(stockContext.inventory_source, "luna_availability")
})

test("lunaportex inventory: html autenticado parsea unidades", async () => {
  const {
    getAuthenticatedHtmlInventoryQuantity,
  } =
    await getLunaPortexTestInternals()

  assert.equal(
    getAuthenticatedHtmlInventoryQuantity(
      "<div>422 units available</div>"
    ),
    422
  )
  assert.equal(
    getAuthenticatedHtmlInventoryQuantity(
      "<div>1,200 units available</div>"
    ),
    1200
  )
  assert.equal(
    getAuthenticatedHtmlInventoryQuantity(
      "<div>units available</div>"
    ),
    null
  )
  assert.equal(
    getAuthenticatedHtmlInventoryQuantity(
      "<div>available soon</div>"
    ),
    null
  )
})

test("lunaportex inventory: html autenticado aplica solo a producto monovariante", async () => {
  const {
    mergeAuthenticatedHtmlInventory,
    getNormalizedVariantInventory,
  } =
    await getLunaPortexTestInternals()

  const singleVariantProduct = {
    variants: [
      {
        id:
          "variant-1",
        sku:
          "ITEM3543",
        available:
          true,
      },
    ],
  }

  const jsonInventoryContext =
    getNormalizedVariantInventory({
      id:
        "variant-json",
      inventory_quantity:
        42,
      available:
        true,
    })

  assert.equal(
    jsonInventoryContext.inventory_quantity,
    42
  )
  assert.equal(
    jsonInventoryContext.inventory_source,
    "luna_numeric"
  )
  assert.equal(
    jsonInventoryContext.inventory_confidence,
    "high"
  )

  assert.equal(
    mergeAuthenticatedHtmlInventory(
      singleVariantProduct,
      "<section>422 units available</section>"
    ),
    true
  )
  assert.equal(
    singleVariantProduct.variants[0].inventory_quantity,
    422
  )

  const inventoryContext =
    getNormalizedVariantInventory(
      singleVariantProduct.variants[0]
    )

  assert.equal(
    inventoryContext.inventory_quantity,
    422
  )
  assert.equal(
    inventoryContext.inventory_source,
    "luna_authenticated_html"
  )
  assert.equal(
    inventoryContext.inventory_confidence,
    "high"
  )
  assert.equal(
    inventoryContext.inventory_scope,
    "variant_level"
  )

  const multiVariantProduct = {
    variants: [
      {
        id:
          "variant-1",
        available:
          true,
      },
      {
        id:
          "variant-2",
        available:
          true,
      },
    ],
  }

  assert.equal(
    mergeAuthenticatedHtmlInventory(
      multiVariantProduct,
      "<section>50000 units available</section>"
    ),
    true
  )
  assert.equal(
    multiVariantProduct.variants[0].inventory_quantity,
    undefined
  )
  assert.equal(
    multiVariantProduct.variants[1].inventory_quantity,
    undefined
  )

  const multiVariantContext =
    getNormalizedVariantInventory(
      multiVariantProduct.variants[0]
    )

  assert.equal(
    multiVariantContext.inventory_quantity,
    null
  )
  assert.equal(
    multiVariantContext.product_available_quantity,
    50000
  )
  assert.equal(
    multiVariantContext.inventory_scope,
    "product_or_category_signal"
  )
  assert.equal(
    multiVariantContext.inventory_source,
    "luna_authenticated_html"
  )
  assert.equal(
    multiVariantContext.inventory_confidence,
    "low"
  )

  const suspiciousSingleVariantProduct = {
    variants: [
      {
        id:
          "variant-high",
        available:
          true,
      },
    ],
  }

  assert.equal(
    mergeAuthenticatedHtmlInventory(
      suspiciousSingleVariantProduct,
      "<section>50000 units available</section>"
    ),
    true
  )

  const suspiciousContext =
    getNormalizedVariantInventory(
      suspiciousSingleVariantProduct.variants[0]
    )

  assert.equal(
    suspiciousContext.inventory_quantity,
    null
  )
  assert.equal(
    suspiciousContext.product_available_quantity,
    50000
  )
  assert.equal(
    suspiciousContext.inventory_scope,
    "product_or_category_signal"
  )
})

test("lunaportex inventory: html autenticado requiere sesion approved", () => {
  const source =
    fs.readFileSync(
      path.resolve(
        "lib/market-radar-lunaportex.ts"
      ),
      "utf8"
    )

  assert.match(
    source,
    /authState\.authState === "approved"[\s\S]*fetchAuthenticatedProductHtml/
  )
})

test("lunaportex sync: latest snapshots usa historial acotado para evitar timeout", () => {
  const source =
    fs.readFileSync(
      path.resolve(
        "lib/market-radar-lunaportex.ts"
      ),
      "utf8"
    )

  assert.match(
    source,
    /function getLatestSnapshots[\s\S]*\.from\("market_radar_snapshots"\)/
  )
  assert.match(
    source,
    /function getLatestSnapshots[\s\S]*historyLimit[\s\S]*\.limit\(\s*historyLimit\s*\)/
  )
  assert.doesNotMatch(
    source,
    /function getLatestSnapshots[\s\S]*\.from\("market_radar_latest_snapshots"\)/
  )
  assert.match(
    source,
    /function isStatementTimeoutError[\s\S]*57014[\s\S]*canceling statement due to statement timeout/
  )
  assert.match(
    source,
    /MARKET RADAR SNAPSHOT HISTORY LOOKUP TIMEOUT; CONTINUING WITHOUT PREVIOUS SNAPSHOTS FOR CHUNK/
  )
  assert.match(
    source,
    /MARKET RADAR RECENT EVENT LOOKUP TIMEOUT; CONTINUING WITH PARTIAL EVENT HISTORY/
  )
})

test("radar advisor inventory: unknown requiere validacion manual", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "new_product",
        new_value:
          {},
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          null,
        available:
          null,
      },
      null
    )

  assert.equal(alert.stock_context.inventory_status, "unknown")
  assert.equal(alert.required_human_approval, true)
})

test("radar advisor: new_product incluye stock_context", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "new_product",
        new_value: {
          available:
            true,
          inventory_quantity:
            12,
        },
      },
      baseRadarAdvisorProduct,
      null
    )

  assert.equal(alert.stock_context.inventory_quantity, 12)
  assert.equal(alert.stock_context.inventory_status, "in_stock")
})

test("radar advisor: low_stock sin quantity numerico se ignora", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "low_stock",
        new_value: {
          available:
            true,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          null,
      },
      null
    )

  assert.equal(alert, null)
})

test("radar advisor: availability-only requiere aprobacion y mensaje claro", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "discount_started",
        new_value: {
          available:
            true,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          null,
      },
      {
        id:
          "candidate-availability-only",
        state:
          "VALIDATED",
        product_type:
          "Coffee",
      }
    )

  assert.equal(alert.stock_context.inventory_status, "in_stock")
  assert.equal(alert.stock_context.inventory_source, "luna_availability")
  assert.equal(alert.stock_context.inventory_quantity, null)
  assert.equal(alert.required_human_approval, true)
  assert.equal(alert.severity, "high")
  assert.equal(
    alert.recommended_action,
    "validate_stock_before_review"
  )
  assert.equal(
    alert.advisor_message,
    "Disponible sin cantidad numerica."
  )
  assert.equal(
    alert.proposed_next_step,
    "Buscar SKU. Confirmar cantidad antes de listar o escalar."
  )
})

test("radar advisor: candidato bloqueado con stock ambiguo no se reabre", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "new_product",
        new_value: {
          available:
            true,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          null,
        inventory_source:
          "luna_availability",
      },
      {
        id:
          "candidate-blocked-stock",
        state:
          "BLOCKED",
      }
    )

  assert.equal(alert.severity, "high")
  assert.equal(
    alert.recommended_action,
    "keep_blocked_until_stock_confirmed"
  )
  assert.match(
    alert.proposed_next_step,
    /Mantener bloqueado/
  )
})

test("radar advisor: usa inventario actual del producto sobre stock_context viejo del evento", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "new_product",
        new_value: {
          available:
            true,
          stock_context: {
            inventory_quantity:
              null,
            inventory_status:
              "in_stock",
            inventory_source:
              "luna_availability",
            inventory_confidence:
              "medium",
            inventory_scope:
              "availability_only",
            stock_message:
              "Disponible, pero Luna no expone cantidad numérica.",
          },
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          10,
        inventory_status:
          "in_stock",
        inventory_source:
          "luna_authenticated_html",
        inventory_confidence:
          "high",
        inventory_scope:
          "variant_level",
      },
      null
    )

  assert.equal(alert.stock_context.inventory_quantity, 10)
  assert.equal(alert.stock_context.inventory_scope, "variant_level")
  assert.equal(alert.stock_context.inventory_source, "luna_authenticated_html")
  assert.equal(
    alert.stock_context.stock_message,
    "Stock disponible: 10 unidades."
  )
  assert.notEqual(
    alert.advisor_message,
    "Luna marca este producto como disponible, pero no expone unidades numéricas. Validar inventario real antes de listar, escalar campaña o crear packs grandes."
  )
})

test("radar advisor: quantity alta requiere aprobacion y no asume stock por variante", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "discount_started",
        new_value: {
          stock_context: {
            inventory_quantity:
              null,
            product_available_quantity:
              50000,
            inventory_status:
              "in_stock",
            inventory_source:
              "luna_authenticated_html",
            inventory_confidence:
              "low",
            inventory_scope:
              "product_or_category_signal",
            stock_message:
              "Luna muestra 50,000 unidades como señal general de disponibilidad. No se considera stock confirmado por variante.",
          },
        },
      },
      baseRadarAdvisorProduct,
      {
        id:
          "candidate-product-level",
        state:
          "VALIDATED",
        product_type:
          "Coffee",
      }
    )

  assert.equal(alert.stock_context.inventory_quantity, null)
  assert.equal(alert.stock_context.product_available_quantity, 50000)
  assert.equal(alert.stock_context.inventory_scope, "product_or_category_signal")
  assert.equal(alert.required_human_approval, true)
  assert.equal(
    alert.advisor_message,
    "Disponibilidad general; falta variante."
  )
  assert.equal(
    alert.proposed_next_step,
    "Buscar SKU. Confirmar variante antes de listar o escalar."
  )
  assert.equal(alert.recommended_action, "validate_stock_before_review")
})

test("radar advisor: low_stock con quantity alta se ignora", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "low_stock",
        new_value: {
          stock_context: {
            inventory_quantity:
              null,
            product_available_quantity:
              50000,
            inventory_status:
              "in_stock",
            inventory_source:
              "luna_authenticated_html",
            inventory_confidence:
              "low",
            inventory_scope:
              "product_or_category_signal",
          },
        },
      },
      baseRadarAdvisorProduct,
      null
    )

  assert.equal(alert, null)
})

test("radar advisor: discount_started + consumable signal -> evaluate_pack_strategy", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "discount_started",
        new_value: {
          price:
            15,
          compare_at_price:
            25,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          12,
      },
      {
        id:
          "candidate-4",
        state:
          "VALIDATED",
        product_type:
          "Coffee",
      }
    )

  assert.equal(alert.recommended_action, "evaluate_pack_strategy")
})

test("radar advisor: discount_started consumible sin stock suficiente no sugiere pack", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "discount_started",
        new_value: {
          price:
            15,
          compare_at_price:
            25,
          available:
            true,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          null,
      },
      {
        id:
          "candidate-4b",
        state:
          "VALIDATED",
        product_type:
          "Coffee",
      }
    )

  assert.equal(alert.recommended_action, "validate_stock_before_review")
})

test("pricing strategy: pack candidate requiere stock numerico", () => {
  const recommendation =
    getPricingStrategyRecommendation({
      candidate: {
        state:
          "VALIDATED",
        product_type:
          "Coffee",
        stock:
          null,
      },
      profitScenario:
        makeProfitScenario({
          salePrice:
            18,
          lunaCost:
            12,
        }),
      priceIntelligence:
        makePriceIntelligence({
          soldMedian:
            30,
          domesticLanded:
            30,
        }),
    })

  assert.notEqual(
    recommendation.launch_strategy,
    "pack_candidate"
  )
})

test("radar advisor: price_up + VALIDATED -> recalculate_before_listing", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "price_up",
        old_value: {
          price:
            20,
        },
        new_value: {
          price:
            30,
        },
      },
      baseRadarAdvisorProduct,
      {
        id:
          "candidate-5",
        state:
          "VALIDATED",
      }
    )

  assert.equal(alert.recommended_action, "recalculate_before_listing")
  assert.equal(alert.severity, "high")
  assert.equal(alert.seller_action_label, "Recalcular margen")
  assert.equal(alert.seller_priority, "Alta")
  assert.equal(
    alert.seller_reason,
    "Precio subio y puede romper rentabilidad"
  )
  assert.equal(
    alert.seller_next_step,
    "Revisar margen antes de publicar o vender."
  )
})

test("radar advisor: price_down + VALIDATED revisa oportunidad avanzada", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "price_down",
        old_value: {
          price:
            30,
        },
        new_value: {
          price:
            20,
        },
      },
      baseRadarAdvisorProduct,
      {
        id:
          "candidate-price-down-validated",
        state:
          "VALIDATED",
      }
    )

  assert.equal(alert.recommended_action, "reprocess_with_updated_cost")
  assert.equal(alert.seller_action_label, "Revisar oportunidad")
  assert.equal(alert.seller_priority, "Alta")
  assert.equal(alert.seller_reason, "Bajo costo en producto ya evaluado")
  assert.equal(alert.seller_next_step, "Reanalizar margen.")
})

test("radar advisor playbook: price_up revisa margen antes de escalar", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "price_up",
        old_value: {
          price:
            20,
        },
        new_value: {
          price:
            30,
        },
      },
      baseRadarAdvisorProduct,
      null
    )

  assert.equal(alert.commercial_playbook.label, "Subio precio")
  assert.match(
    alert.commercial_playbook.recommendation,
    /Revisar margen/
  )
  assert.match(
    alert.commercial_playbook.recommendation,
    /No avanzar/
  )
})

test("radar advisor playbook: out_of_stock bloquea listing pack y campana", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "out_of_stock",
        new_value: {
          available:
            false,
        },
      },
      baseRadarAdvisorProduct,
      null
    )

  assert.equal(alert.commercial_playbook.label, "Sin stock")
  assert.match(
    alert.commercial_playbook.recommendation,
    /No listar, no crear pack/
  )
  assert.match(
    alert.commercial_playbook.recommendation,
    /no activar campana/
  )
})

test("radar advisor playbook: restocked confirma cantidad y reanaliza", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "restocked",
        new_value: {
          available:
            true,
          inventory_quantity:
            8,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          8,
      },
      null
    )

  assert.equal(alert.commercial_playbook.label, "Volvio a stock")
  assert.match(
    alert.commercial_playbook.recommendation,
    /Confirmar cantidad disponible/
  )
  assert.match(
    alert.commercial_playbook.recommendation,
    /peso, dimensiones y comparables/
  )
})

test("radar advisor playbook: stock_increased prioriza revision", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "stock_increased",
        old_value: {
          inventory_quantity:
            2,
        },
        new_value: {
          inventory_quantity:
            12,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          12,
      },
      null
    )

  assert.equal(
    alert.commercial_playbook.label,
    "Rotacion o disponibilidad al alza"
  )
  assert.match(
    alert.commercial_playbook.recommendation,
    /Priorizar revision/
  )
})

test("radar advisor playbook: discount_started evalua margen y liquidacion", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "discount_started",
        new_value: {
          price:
            15,
          compare_at_price:
            25,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          12,
      },
      null
    )

  assert.equal(alert.commercial_playbook.label, "Descuento iniciado")
  assert.match(
    alert.commercial_playbook.recommendation,
    /riesgo de liquidacion/
  )
  assert.match(
    alert.commercial_playbook.recommendation,
    /oportunidad automatica/
  )
})

test("radar advisor playbook: inactive producto fuera de catalogo", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "price_down",
        new_value: {
          price:
            20,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        is_active:
          false,
      },
      null
    )

  assert.equal(alert.commercial_playbook.label, "Fuera de catalogo")
  assert.equal(alert.commercial_playbook.risk_level, "critical")
  assert.match(
    alert.commercial_playbook.recommendation,
    /Bloquear avance/
  )
  assert.match(
    alert.commercial_playbook.recommendation,
    /proveedor alternativo/
  )
})

test("radar advisor playbook: no acciones reales", () => {
  const alert =
    getRadarAdvisorEvent(
      {
        ...baseRadarEvent,
        event_type:
          "stock_increased",
        new_value: {
          inventory_quantity:
            12,
        },
      },
      {
        ...baseRadarAdvisorProduct,
        inventory_quantity:
          12,
      },
      null
    )

  assert.equal(alert.commercial_playbook.advisory_only, true)
  assert.match(
    alert.commercial_playbook.guardrail,
    /no publica/
  )
  assert.match(
    alert.commercial_playbook.guardrail,
    /no crea drafts/
  )
  assert.match(
    alert.commercial_playbook.guardrail,
    /no modifica listings/
  )
  assert.match(
    alert.commercial_playbook.guardrail,
    /no cambia estados/
  )
})

test("producto sin stock queda bloqueado", () => {
  const result = processRadarCandidate({
    ...validRadarProduct,
    sku: "LP-NOSTOCK-001",
    inventory_quantity: 0,
  })

  assert.equal(result.candidate.state, "BLOCKED")
  assert.ok(
    result.compliance.findings.some(finding =>
      finding.code === "stock_zero"
    )
  )
})

test("producto sin peso ni dimensiones queda en NEEDS_DATA", () => {
  const { weight, dimensions, ...product } = validRadarProduct
  const result = processRadarCandidate({
    ...product,
    sku: "LP-MISSING-SHIPPING-001",
  })

  assert.equal(result.candidate.state, "NEEDS_DATA")
  assert.ok(result.validation.missingFields.includes("weight_or_dimensions"))
  assert.match(result.explanation, /Producto necesita datos/)
  assert.doesNotMatch(result.explanation, /Producto recomendado/)
})

test("producto con margen bajo queda bloqueado", () => {
  const result = processRadarCandidate({
    ...validRadarProduct,
    sku: "LP-LOWMARGIN-001",
    price: 20,
    estimated_sale_price: 23,
  })

  assert.equal(result.candidate.state, "BLOCKED")
  assert.equal(result.profitScenario.passes_minimums, false)
  assert.ok(
    !result.compliance.findings.some(finding =>
      finding.code === "margin_below_minimum"
    )
  )
})

test("fee engine: categoria default usa 13.25% + fee fijo", () => {
  const result = calculateProfitScenario(
    {
      cost:
        1,
      estimated_sale_price:
        100,
      buyer_shipping_charge:
        10,
      shipping_cost:
        0,
      fulfillment_cost:
        0,
      packaging_cost:
        0,
      suggested_category_name:
        "Health & Beauty",
    },
    {
      defaultShippingCost:
        0,
      paymentFeePercent:
        0,
      advertisingPercent:
        0,
      returnReservePercent:
        0,
    }
  )

  assert.equal(result.assumptions.ebayFeePercent, 13.25)
  assert.equal(result.assumptions.ebay_fixed_fee, 0.3)
  assert.equal(result.assumptions.ebay_fee_source, "default_most_categories")
  assert.equal(result.assumptions.ebay_fee_confidence, "medium")
  assert.equal(result.estimated_ebay_fee, 14.88)
})

test("fee engine: books/media usa 14.95% + fee fijo", () => {
  const result = calculateProfitScenario(
    {
      cost:
        1,
      estimated_sale_price:
        100,
      shipping_cost:
        0,
      fulfillment_cost:
        0,
      packaging_cost:
        0,
      suggested_category_name:
        "Books, Movies & Music",
    },
    {
      defaultShippingCost:
        0,
      paymentFeePercent:
        0,
      advertisingPercent:
        0,
      returnReservePercent:
        0,
    }
  )

  assert.equal(result.assumptions.ebayFeePercent, 14.95)
  assert.equal(result.assumptions.ebay_fee_source, "category_rule")
  assert.equal(result.assumptions.ebay_fee_confidence, "high")
  assert.equal(result.estimated_ebay_fee, 15.25)
})

test("fee engine: guitars/basses usa 6.35% + fee fijo", () => {
  const result = calculateProfitScenario(
    {
      cost:
        1,
      estimated_sale_price:
        100,
      shipping_cost:
        0,
      fulfillment_cost:
        0,
      packaging_cost:
        0,
      suggested_category_name:
        "Guitars & Basses",
    },
    {
      defaultShippingCost:
        0,
      paymentFeePercent:
        0,
      advertisingPercent:
        0,
      returnReservePercent:
        0,
    }
  )

  assert.equal(result.assumptions.ebayFeePercent, 6.35)
  assert.equal(result.estimated_ebay_fee, 6.65)
})

test("fee engine: sneakers desde 150 usa 8% + fee fijo", () => {
  const result = calculateProfitScenario(
    {
      cost:
        1,
      estimated_sale_price:
        150,
      shipping_cost:
        0,
      fulfillment_cost:
        0,
      packaging_cost:
        0,
      suggested_category_name:
        "Sneakers",
    },
    {
      defaultShippingCost:
        0,
      paymentFeePercent:
        0,
      advertisingPercent:
        0,
      returnReservePercent:
        0,
    }
  )

  assert.equal(result.assumptions.ebayFeePercent, 8)
  assert.equal(result.assumptions.ebay_category_group, "sneakers_150_plus")
  assert.equal(result.estimated_ebay_fee, 12.3)
})

test("fee engine: categoria desconocida usa default con confianza media", () => {
  const result = calculateProfitScenario(
    {
      cost:
        1,
      estimated_sale_price:
        100,
      shipping_cost:
        0,
      fulfillment_cost:
        0,
      packaging_cost:
        0,
      suggested_category_name:
        "Unmapped Category",
    },
    {
      defaultShippingCost:
        0,
      paymentFeePercent:
        0,
      advertisingPercent:
        0,
      returnReservePercent:
        0,
    }
  )

  assert.equal(result.assumptions.ebayFeePercent, 13.25)
  assert.equal(result.assumptions.ebay_fee_source, "default_most_categories")
  assert.equal(result.assumptions.ebay_fee_confidence, "medium")
})

test("fee engine: insertion fee no se suma por defecto", () => {
  const result = calculateProfitScenario(
    {
      cost:
        1,
      estimated_sale_price:
        100,
      shipping_cost:
        0,
      fulfillment_cost:
        0,
      packaging_cost:
        0,
      suggested_category_name:
        "Health & Beauty",
    },
    {
      defaultShippingCost:
        0,
      paymentFeePercent:
        0,
      advertisingPercent:
        0,
      returnReservePercent:
        0,
    }
  )

  assert.match(
    result.assumptions.insertion_fee_assumption,
    /Insertion fee no aplicado/
  )
  assert.equal(result.total_estimated_cost, 14.55)
})

test("advisor advierte que categoria faltante puede cambiar fee eBay", () => {
  const { product_type, suggested_category_id, suggested_category_name, ...product } =
    validRadarProduct

  const result = processRadarCandidate({
    ...product,
    sku:
      "LP-MISSING-CATEGORY-FEE-001",
  })

  const advisor =
    getEbayProductDecisionAdvisor(
      result.candidate,
      result.profitScenario,
      null,
      result.validation,
      result.compliance
    )

  assert.ok(
    advisor.profit_reasons.includes(
      "La categoria final afecta el fee de eBay. Confirmar categoria antes de publicar."
    )
  )
})

test("strategic summary: rentable pero NEEDS_DATA queda pendiente operativo", () => {
  const { weight, dimensions, ...product } = validRadarProduct
  const result = processRadarCandidate({
    ...product,
    sku:
      "LP-STRATEGIC-NEEDS-DATA-001",
  })

  const advisor =
    getEbayProductDecisionAdvisor(
      result.candidate,
      result.profitScenario,
      {
        sold_median_price:
          35,
        source_confidence:
          "high",
      },
      result.validation,
      result.compliance
    )

  assert.equal(
    advisor.strategic_summary.commercial_status,
    "needs_operational_data"
  )
  assert.match(
    advisor.strategic_summary.headline,
    /prometedor/
  )
})

test("pricing strategy: rentable con NEEDS_DATA no lista organico todavia", () => {
  const result = processRadarCandidate({
    ...validRadarProduct,
    sku:
      "LP-STRATEGIC-NEEDS-DATA-LAUNCH-001",
    weight:
      undefined,
  })

  const advisor =
    getEbayProductDecisionAdvisor(
      result.candidate,
      result.profitScenario,
      {
        sold_median_price:
          35,
        source_confidence:
          "high",
      },
      result.validation,
      result.compliance
    )

  assert.equal(
    advisor.pricing_strategy.launch_strategy,
    "needs_data"
  )
  assert.equal(
    advisor.pricing_strategy.campaign_eligible,
    false
  )
  assert.equal(
    advisor.pricing_strategy.listing_price_role,
    "temporary_evaluation"
  )
  assert.match(
    advisor.pricing_strategy.reason,
    /pendiente de datos operativos/
  )
  assert.match(
    advisor.pricing_strategy.listing_price_note,
    /no accionable/i
  )
})

test("strategic summary: rentable y datos completos queda listo para preparar listing", () => {
  const result = processRadarCandidate(validRadarProduct)

  const advisor =
    getEbayProductDecisionAdvisor(
      result.candidate,
      result.profitScenario,
      {
        sold_median_price:
          35,
        source_confidence:
          "high",
      },
      result.validation,
      result.compliance
    )

  assert.equal(
    advisor.strategic_summary.commercial_status,
    "ready_to_prepare_listing"
  )
  assert.match(
    advisor.strategic_summary.seller_advisor_note,
    /organico/
  )
})

test("strategic summary: precio minimo rentable sobre mercado bloquea unidad", () => {
  const profitScenario =
    calculateProfitScenario(
      {
        cost:
          28,
        estimated_sale_price:
          30,
        shipping_cost:
          6.99,
        fulfillment_cost:
          1.5,
        packaging_cost:
          0.75,
        suggested_category_name:
          "Health & Beauty",
      },
      {
        defaultShippingCost:
          6.99,
      }
    )

  const advisor =
    getEbayProductDecisionAdvisor(
      {
        state:
          "BLOCKED",
        product_type:
          "Health & Beauty",
      },
      profitScenario,
      {
        sold_median_price:
          45,
        source_confidence:
          "high",
      },
      {
        missingFields:
          [],
      },
      {
        overall_status:
          "passed",
        findings:
          [],
      }
    )

  assert.equal(
    advisor.strategic_summary.commercial_status,
    "blocked_as_unit"
  )
})

test("strategic summary: proveedor actual caro con demanda sugiere buscar proveedor", () => {
  const profitScenario =
    calculateProfitScenario(
      {
        cost:
          24,
        estimated_sale_price:
          30,
        shipping_cost:
          6.99,
        fulfillment_cost:
          1.5,
        packaging_cost:
          0.75,
        suggested_category_name:
          "Health & Beauty",
      },
      {
        defaultShippingCost:
          6.99,
      }
    )

  const advisor =
    getEbayProductDecisionAdvisor(
      {
        state:
          "BLOCKED",
        product_type:
          "Health & Beauty",
      },
      profitScenario,
      {
        sold_median_price:
          45,
        source_confidence:
          "high",
      },
      {
        missingFields:
          [],
      },
      {
        overall_status:
          "passed",
        findings:
          [],
      }
    )

  assert.equal(
    advisor.strategic_summary.commercial_status,
    "supplier_not_competitive"
  )
  assert.equal(
    advisor.strategic_summary.supplier_strategy.supplier_strategy,
    "find_better_supplier"
  )
})

test("strategic summary: sin mercado y margen negativo pide Price Intelligence", () => {
  const profitScenario =
    calculateProfitScenario(
      {
        source_key:
          "lunaportex",
        cost:
          8,
        estimated_sale_price:
          15,
        shipping_cost:
          6.99,
        suggested_category_name:
          "Home Improvement",
      },
      {
        defaultShippingCost:
          6.99,
      }
    )

  const advisor =
    getEbayProductDecisionAdvisor(
      {
        state:
          "NEEDS_DATA",
        source_key:
          "lunaportex",
        product_type:
          "Home Improvement",
        needs_data: [
          "weight_or_dimensions",
          "authorized_images",
          "category_or_inference_data",
        ],
      },
      profitScenario,
      null,
      {
        missingFields: [
          "weight_or_dimensions",
          "authorized_images",
          "category_or_inference_data",
        ],
      },
      {
        overall_status:
          "passed",
        findings:
          [],
      }
    )

  assert.equal(
    advisor.strategic_summary.commercial_status,
    "needs_price_data"
  )
  assert.equal(
    advisor.pricing_strategy.listing_price_role,
    "temporary_evaluation"
  )
  assert.match(
    advisor.pricing_strategy.listing_price_note,
    /No usar como precio de publicacion/
  )
  assert.match(
    advisor.pricing_strategy.reason,
    /Falta precio de mercado/
  )
  assert.doesNotMatch(
    advisor.pricing_strategy.reason,
    /ajustar precio/i
  )
  assert.doesNotMatch(
    advisor.strategic_summary.headline,
    /prometedor/i
  )
  assert.match(
    advisor.strategic_summary.seller_advisor_note,
    /No publiques/
  )
})

test("cost model: margen deseado no se suma como costo real", () => {
  const result = calculateProfitScenario(
    {
      cost:
        10,
      estimated_sale_price:
        30,
      shipping_cost:
        0,
      fulfillment_cost:
        0,
      packaging_cost:
        0,
      suggested_category_name:
        "Health & Beauty",
    },
    {
      defaultShippingCost:
        0,
      paymentFeePercent:
        0,
      advertisingPercent:
        0,
      returnReservePercent:
        0,
      minimumNetMarginPercent:
        50,
    }
  )

  assert.equal(result.total_estimated_cost, 14.28)
})

test("cost model: eBay fee queda como assumption configurable", () => {
  const result = calculateProfitScenario(
    {
      cost:
        1,
      estimated_sale_price:
        100,
      shipping_cost:
        0,
      fulfillment_cost:
        0,
      packaging_cost:
        0,
    },
    {
      defaultShippingCost:
        0,
      ebayFeePercent:
        12,
      ebayFixedOrderFee:
        0.4,
      paymentFeePercent:
        0,
      advertisingPercent:
        0,
      returnReservePercent:
        0,
    }
  )

  assert.equal(result.assumptions.ebayFeePercent, 12)
  assert.equal(result.assumptions.ebay_fixed_fee, 0.4)
  assert.equal(result.estimated_ebay_fee, 12.4)
})

test("cost model: campana opcional no descuenta si advertisingPercent es 0", () => {
  const result = calculateProfitScenario(
    {
      cost:
        10,
      estimated_sale_price:
        30,
      shipping_cost:
        0,
      fulfillment_cost:
        0,
      packaging_cost:
        0,
      suggested_category_name:
        "Health & Beauty",
    },
    {
      defaultShippingCost:
        0,
      advertisingPercent:
        0,
      paymentFeePercent:
        0,
      returnReservePercent:
        0,
    }
  )

  assert.equal(result.estimated_advertising_cost, 0)
})

test("cost model: fulfillment y packaging pueden caer a 0", () => {
  const result = calculateProfitScenario(
    {
      cost:
        10,
      estimated_sale_price:
        30,
      shipping_cost:
        0,
      fulfillment_cost:
        0,
      packaging_cost:
        0,
      suggested_category_name:
        "Health & Beauty",
    },
    {
      defaultShippingCost:
        0,
    }
  )

  assert.equal(result.fulfillment_cost, 0)
  assert.equal(result.packaging_cost, 0)
})

test("cost model: Luna como proveedor directo no suma fulfillment por defecto", () => {
  const result = calculateProfitScenario(
    {
      source_key:
        "lunaportex",
      cost:
        8,
      estimated_sale_price:
        41.99,
      shipping_cost:
        6.99,
      suggested_category_name:
        "Home Improvement",
    },
    {
      defaultFulfillmentCost:
        1.5,
      defaultPackagingCost:
        0.75,
    }
  )

  assert.equal(result.supplier_model, "luna_as_supplier")
  assert.equal(result.fulfillment_cost, 0)
  assert.equal(result.packaging_cost, 0)
  assert.equal(
    result.fulfillment_cost_source,
    "included_in_luna_supplier_purchase"
  )
  assert.match(
    result.operating_cost_note,
    /proveedor directo/
  )
})

test("producto con marca riesgosa queda bloqueado", () => {
  const result = processRadarCandidate({
    ...validRadarProduct,
    sku: "LP-RISKY-BRAND-001",
    vendor: "Apple",
  })

  assert.equal(result.candidate.state, "BLOCKED")
  assert.ok(
    result.compliance.findings.some(finding =>
      finding.code === "risky_brand_or_vero"
    )
  )
})

test("ejecución duplicada con mismo supplier_sku conserva candidate_key", () => {
  const first = processRadarCandidate(validRadarProduct)
  const second = processRadarCandidate(validRadarProduct)

  assert.equal(first.candidate.candidate_key, second.candidate.candidate_key)
})

test("pipeline reanalysis: DRAFT_CREATED + price_down revisa draft sin degradar", () => {
  const advisor =
    getPipelineReanalysisAdvisor({
      existingCandidate: {
        state:
          "DRAFT_CREATED",
      },
      radarProduct:
        validRadarProduct,
      advisorEvents: [
        {
          event_type:
            "price_down",
        },
      ],
      inventoryContext: {
        inventory_quantity:
          10,
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
      },
    })

  assert.equal(advisor.action, "review_existing_draft")
  assert.equal(advisor.previous_state, "DRAFT_CREATED")
  assert.equal(advisor.required_human_approval, true)
  assert.match(
    advisor.reason,
    /ya tiene draft/i
  )
})

test("pipeline reanalysis: BLOCKED + restocked crea ruta de reactivacion", () => {
  const advisor =
    getPipelineReanalysisAdvisor({
      existingCandidate: {
        state:
          "BLOCKED",
      },
      radarProduct:
        validRadarProduct,
      advisorEvents: [
        {
          event_type:
            "restocked",
        },
      ],
      inventoryContext: {
        inventory_quantity:
          10,
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
      },
    })

  assert.equal(advisor.action, "blocked_reactivation_review")
  assert.equal(advisor.priority, "high")
  assert.equal(advisor.unlock_policy, "paused_until_blocker_changes")
  assert.equal(advisor.recovery_signal_type, "stock")
  assert.ok(
    advisor.unlock_conditions.some(condition =>
      /Stock confirmado/.test(condition)
    )
  )
  assert.match(
    advisor.reason,
    /No se desbloquea automaticamente/
  )
  assert.match(
    advisor.proposed_next_step,
    /puede salir de BLOCKED/
  )
  assert.match(
    advisor.success_path,
    /listing package, draft y publicacion/
  )
})

test("pipeline reanalysis: product_or_category_signal requiere validar inventario", () => {
  const advisor =
    getPipelineReanalysisAdvisor({
      existingCandidate: {
        state:
          "VALIDATED",
      },
      radarProduct:
        validRadarProduct,
      inventoryContext: {
        product_available_quantity:
          50000,
        inventory_scope:
          "product_or_category_signal",
        inventory_confidence:
          "low",
      },
    })

  assert.equal(advisor.action, "inventory_validation_required")
  assert.equal(advisor.inventory_scope, "product_or_category_signal")
  assert.equal(advisor.required_human_approval, true)
})

test("pipeline reanalysis: availability_only requiere aprobacion humana", () => {
  const advisor =
    getPipelineReanalysisAdvisor({
      existingCandidate: {
        state:
          "VALIDATED",
      },
      radarProduct:
        validRadarProduct,
      inventoryContext: {
        inventory_quantity:
          null,
        inventory_scope:
          "availability_only",
        inventory_confidence:
          "medium",
      },
    })

  assert.equal(advisor.action, "inventory_validation_required")
  assert.equal(advisor.required_human_approval, true)
})

test("pipeline reanalysis: variant_level confirmado permite analisis sin accion real", () => {
  const advisor =
    getPipelineReanalysisAdvisor({
      existingCandidate: {
        state:
          "VALIDATED",
      },
      radarProduct:
        validRadarProduct,
      advisorEvents: [
        {
          event_type:
            "price_down",
        },
      ],
      inventoryContext: {
        inventory_quantity:
          10,
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
      },
    })

  assert.equal(advisor.action, "needs_reanalysis")
  assert.equal(advisor.inventory_scope, "variant_level")
  assert.equal(advisor.required_human_approval, false)
})

test("pipeline reanalysis: sin cambios queda no_change", () => {
  const advisor =
    getPipelineReanalysisAdvisor({
      existingCandidate: {
        state:
          "VALIDATED",
      },
      radarProduct:
        validRadarProduct,
      advisorEvents: [],
      inventoryContext: {
        inventory_quantity:
          10,
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
      },
    })

  assert.equal(advisor.action, "no_change")
})

test("pipeline reanalysis: Luna auth no approved requiere aprobacion humana", () => {
  const advisor =
    getPipelineReanalysisAdvisor({
      existingCandidate: {
        state:
          "VALIDATED",
      },
      radarProduct:
        validRadarProduct,
      advisorEvents: [],
      inventoryContext: {
        inventory_quantity:
          10,
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
      },
      lunaAuthState:
        "restricted",
    })

  assert.equal(advisor.action, "no_change")
  assert.equal(advisor.required_human_approval, true)
})

test("pipeline reanalysis: Luna auth unknown aplica guardrails conservadores", () => {
  const inventoryContext = {
    inventory_quantity:
      24,
    inventory_scope:
      "variant_level",
    inventory_confidence:
      "high",
    luna_auth_state:
      "unknown",
  }

  const advisor =
    getPipelineReanalysisAdvisor({
      existingCandidate: {
        state:
          "VALIDATED",
      },
      radarProduct:
        validRadarProduct,
      advisorEvents: [],
      inventoryContext,
      lunaAuthState:
        "unknown",
    })

  const policy =
    getListingQuantityPolicy(
      inventoryContext
    )

  assert.equal(advisor.required_human_approval, true)
  assert.match(
    advisor.proposed_next_step,
    /Validar sesión Luna e inventario/i
  )
  assert.equal(policy.can_use_for_listing_quantity, false)
  assert.equal(policy.max_recommended_listing_quantity, 0)
  assert.equal(policy.pack_large_allowed, false)
  assert.equal(policy.campaign_scale_allowed, false)
})

test("pipeline reanalysis: Luna auth approved conserva inventario variant_level confirmado", () => {
  const inventoryContext = {
    inventory_quantity:
      24,
    inventory_scope:
      "variant_level",
    inventory_confidence:
      "high",
    luna_auth_state:
      "approved",
  }

  const advisor =
    getPipelineReanalysisAdvisor({
      existingCandidate: {
        state:
          "VALIDATED",
      },
      radarProduct:
        validRadarProduct,
      advisorEvents: [
        {
          event_type:
            "price_down",
        },
      ],
      inventoryContext,
      lunaAuthState:
        "approved",
    })

  const policy =
    getListingQuantityPolicy(
      inventoryContext
    )

  assert.equal(advisor.action, "needs_reanalysis")
  assert.equal(advisor.required_human_approval, false)
  assert.equal(policy.can_use_for_listing_quantity, true)
  assert.equal(policy.pack_large_allowed, true)
  assert.equal(policy.campaign_scale_allowed, true)
})

test("botón de WhatsApp duplicado produce la misma idempotency key", () => {
  const first = buildDecisionIdempotencyKey({
    candidateKey: "lunaportex:product:variant",
    messageId: "wamid.test",
    action: "create_draft",
  })

  const second = buildDecisionIdempotencyKey({
    candidateKey: "lunaportex:product:variant",
    messageId: "wamid.test",
    action: "create_draft",
  })

  assert.equal(first, second)
})

test("Price Intelligence usa total domestico USA con free shipping como referencia", () => {
  const advisor =
    getEbayProductDecisionAdvisor(
      {
        state:
          "BLOCKED",
        shipping_cost:
          6.99,
      },
      {
        estimated_sale_price:
          28.99,
        luna_cost:
          10,
        estimated_shipping_cost:
          6.99,
        fulfillment_cost:
          1.5,
        packaging_cost:
          0.75,
        net_profit:
          5,
        net_margin_percent:
          17,
        assumptions: {
          ebayFeePercent:
            13.25,
          paymentFeePercent:
            0,
          advertisingPercent:
            0,
          returnReservePercent:
            3,
          minimumNetMarginPercent:
            10,
        },
      },
      {
        raw_payload: {
          shipping_scope_evidence: {
            shipping_scope:
              "us_domestic",
            buyer_location_country:
              "US",
            competitor_item_price:
              28.99,
            competitor_domestic_shipping_price:
              0,
            competitor_domestic_landed_price:
              28.99,
            competitor_international_shipping_price:
              34.86,
            competitor_international_landed_price:
              63.85,
            landed_price_source:
              "manual_observed",
          },
        },
      },
      null,
      null
    )

  assert.equal(
    advisor.target_price.market_reference_price,
    28.99
  )
  assert.equal(
    advisor.target_price.market_reference_source,
    "competitor_domestic_landed_price"
  )
  assert.equal(
    advisor.target_price.domestic_free_shipping,
    true
  )
})

test("Price semantics: costo proveedor actual no se trata como precio de venta eBay", () => {
  const profitScenario =
    calculateProfitScenario(
      {
        cost:
          11,
        estimated_sale_price:
          19.99,
        buyer_shipping_charge:
          0,
        shipping_cost:
          1,
        fulfillment_cost:
          0.75,
        packaging_cost:
          0.5,
      },
      {
        defaultShippingCost:
          1,
        ebayFeePercent:
          13.25,
        returnReservePercent:
          3,
      }
    )

  const advisor =
    getEbayProductDecisionAdvisor(
      {
        state:
          "VALIDATED",
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
      },
      profitScenario,
      {
        recommended_sale_price:
          19.99,
        sold_median_price:
          25,
        source_confidence:
          "high",
        raw_payload: {
          shipping_scope_evidence: {
            shipping_scope:
              "us_domestic",
            buyer_location_country:
              "US",
            competitor_item_price:
              21.5,
            competitor_domestic_shipping_price:
              0,
            competitor_domestic_landed_price:
              21.5,
          },
        },
      },
      null,
      null
    )

  assert.notEqual(
    advisor.pricing_strategy.launch_strategy,
    "blocked"
  )
  assert.equal(
    advisor.target_price.supplier_unit_cost,
    11
  )
  assert.equal(
    advisor.target_price.evaluated_sale_price,
    19.99
  )
  assert.match(
    advisor.human_summary,
    /costo proveedor actual es \$11\.00/i
  )
  assert.doesNotMatch(
    advisor.human_summary,
    /precio actual \$11/i
  )
})

test("Price semantics: bloquea unidad cuando precio rentable supera mercado USA", () => {
  const profitScenario =
    calculateProfitScenario(
      {
        cost:
          11,
        estimated_sale_price:
          17.95,
        buyer_shipping_charge:
          0,
        shipping_cost:
          1,
        fulfillment_cost:
          0.75,
        packaging_cost:
          0.5,
      },
      {
        defaultShippingCost:
          1,
        ebayFeePercent:
          13.25,
        returnReservePercent:
          3,
      }
    )

  const advisor =
    getEbayProductDecisionAdvisor(
      {
        state:
          "VALIDATED",
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
      },
      profitScenario,
      {
        recommended_sale_price:
          17.95,
        sold_median_price:
          14,
        source_confidence:
          "high",
      },
      null,
      null
    )

  assert.equal(
    advisor.pricing_strategy.launch_strategy,
    "blocked"
  )
  assert.match(
    advisor.pricing_strategy.reason,
    /precio rentable por encima del mercado/i
  )
})

test("Price semantics: sin mercado pide datos y no usa costo proveedor como precio venta", () => {
  const result =
    processRadarCandidate({
      ...validRadarProduct,
      price:
        11,
      estimated_sale_price:
        null,
    })

  const advisor =
    getEbayProductDecisionAdvisor(
      result.candidate,
      result.profitScenario,
      null,
      result.validation,
      result.compliance
    )

  assert.equal(
    advisor.decision_label,
    "NEEDS_PRICE_DATA"
  )
  assert.notEqual(
    result.profitScenario.estimated_sale_price,
    11
  )
  assert.equal(
    result.profitScenario.assumptions.sale_price_basis,
    "generated_target_price"
  )
  assert.match(
    advisor.human_summary,
    /no usar el costo proveedor como precio de venta eBay/i
  )
})

test("Price semantics: listing real puede usar precio actual eBay explicito", () => {
  const profitScenario =
    calculateProfitScenario(
      {
        cost:
          11,
        current_listing_price:
          21.5,
        estimated_sale_price:
          21.5,
        buyer_shipping_charge:
          0,
        shipping_cost:
          1,
        fulfillment_cost:
          0.75,
        packaging_cost:
          0.5,
      },
      {
        defaultShippingCost:
          1,
        ebayFeePercent:
          13.25,
        returnReservePercent:
          3,
      }
    )

  const advisor =
    getEbayProductDecisionAdvisor(
      {
        state:
          "VALIDATED",
        current_listing_price:
          21.5,
      },
      profitScenario,
      {
        recommended_sale_price:
          21.5,
        sold_median_price:
          25,
        source_confidence:
          "high",
      },
      null,
      null
    )

  assert.equal(
    profitScenario.assumptions.sale_price_basis,
    "current_listing_price"
  )
  assert.equal(
    advisor.target_price.sale_price_basis,
    "current_listing_price"
  )
  assert.equal(
    advisor.target_price.evaluated_sale_price,
    21.5
  )
})

test("Price Intelligence no usa total internacional como referencia principal USA", () => {
  const advisor =
    getEbayProductDecisionAdvisor(
      {
        state:
          "BLOCKED",
        shipping_cost:
          6.99,
      },
      {
        estimated_sale_price:
          28.99,
        luna_cost:
          10,
        estimated_shipping_cost:
          6.99,
        fulfillment_cost:
          1.5,
        packaging_cost:
          0.75,
        net_profit:
          5,
        net_margin_percent:
          17,
        assumptions: {
          ebayFeePercent:
            13.25,
          paymentFeePercent:
            0,
          advertisingPercent:
            0,
          returnReservePercent:
            3,
          minimumNetMarginPercent:
            10,
        },
      },
      {
        recommended_sale_price:
          null,
        raw_payload: {
          shipping_scope_evidence: {
            shipping_scope:
              "international",
            buyer_location_country:
              "NI",
            competitor_item_price:
              28.99,
            competitor_international_shipping_price:
              34.86,
            competitor_international_landed_price:
              63.85,
            landed_price_source:
              "manual_observed",
          },
        },
      },
      null,
      null
    )

  assert.equal(
    advisor.target_price.market_reference_price,
    null
  )
  assert.notEqual(
    advisor.target_price.market_reference_price,
    63.85
  )
  assert.ok(
    advisor.market_price_reasons.some(reason =>
      reason.includes(
        "No usar como referencia principal"
      )
    )
  )
})

test("IMNOVA free shipping mantiene estimated_shipping_cost como costo interno", () => {
  const scenario =
    calculateProfitScenario(
      {
        cost:
          10,
        estimated_sale_price:
          28.99,
        buyer_shipping_charge:
          0,
        shipping_cost:
          6.99,
        fulfillment_cost:
          1.5,
        packaging_cost:
          0.75,
      },
      {
        defaultShippingCost:
          6.99,
        ebayFeePercent:
          13.25,
        paymentFeePercent:
          0,
        advertisingPercent:
          0,
        returnReservePercent:
          3,
      }
    )

  assert.equal(
    scenario.total_revenue,
    28.99
  )
  assert.equal(
    scenario.estimated_shipping_cost,
    6.99
  )
  assert.equal(
    scenario.net_profit,
    Number(
      (
        28.99 -
        (
          10 +
          1.5 +
          0.75 +
          6.99 +
          4.14 +
          0 +
          0 +
          0.87
        )
      ).toFixed(2)
    )
  )
})

function makeProfitScenario({
  salePrice = 50,
  lunaCost = 20,
  shippingCost = 6.99,
}) {
  return calculateProfitScenario(
    {
      cost:
        lunaCost,
      estimated_sale_price:
        salePrice,
      buyer_shipping_charge:
        0,
      shipping_cost:
        shippingCost,
      fulfillment_cost:
        1.5,
      packaging_cost:
        0.75,
    },
    {
      defaultShippingCost:
        6.99,
      ebayFeePercent:
        13.25,
      paymentFeePercent:
        0,
      advertisingPercent:
        0,
      returnReservePercent:
        3,
      minimumNetMarginPercent:
        10,
    }
  )
}

function makeLunaProfitScenario({
  salePrice = 50,
  lunaCost = 20,
  shippingCost = 6.99,
  assumptions = {},
} = {}) {
  const scenario =
    calculateProfitScenario(
      {
        cost:
          lunaCost,
        estimated_sale_price:
          salePrice,
        buyer_shipping_charge:
          0,
        shipping_cost:
          shippingCost,
        source:
          "lunaportex",
        supplier:
          "Luna Portex",
        product_url:
          "https://lunaportex.com/products/test-product",
      },
      {
        defaultShippingCost:
          6.99,
        ebayFeePercent:
          13.25,
        paymentFeePercent:
          0,
        advertisingPercent:
          0,
        returnReservePercent:
          3,
        minimumNetMarginPercent:
          10,
      }
    )

  return {
    ...scenario,
    assumptions: {
      ...scenario.assumptions,
      ...assumptions,
    },
  }
}

function makePriceIntelligence({
  soldMedian = 50,
  domesticLanded = 50,
  sourceConfidence = "high",
} = {}) {
  return {
    sold_median_price:
      soldMedian,
    source_confidence:
      sourceConfidence,
    recommended_sale_price:
      domesticLanded,
    raw_payload: {
      shipping_scope_evidence: {
        shipping_scope:
          "us_domestic",
        buyer_location_country:
          "US",
        competitor_item_price:
          domesticLanded,
        competitor_domestic_shipping_price:
          0,
        competitor_domestic_landed_price:
          domesticLanded,
      },
    },
  }
}

function makeSupplierSimulatorAdvisor({
  salePrice = 50,
  lunaCost = 20,
  shippingCost = 6.99,
  assumptions = {},
  candidate = {},
} = {}) {
  return getEbayProductDecisionAdvisor(
    {
      state:
        "VALIDATED",
      source:
        "lunaportex",
      supplier:
        "Luna Portex",
      product_url:
        "https://lunaportex.com/products/test-product",
      ...candidate,
    },
    makeLunaProfitScenario({
      salePrice,
      lunaCost,
      shippingCost,
      assumptions,
    }),
    makePriceIntelligence({
      soldMedian:
        salePrice,
      domesticLanded:
        salePrice,
    }),
    null,
    null
  )
}

test("supplier model simulator: luna_as_supplier no suma fulfillment ni empaque por default", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({})

  const currentScenario =
    advisor.supplier_model_simulator.scenarios[0]

  assert.equal(
    currentScenario.supplier_model,
    "luna_as_supplier"
  )
  assert.equal(
    currentScenario.fulfillment_cost,
    0
  )
  assert.equal(
    advisor.cost_breakdown.packaging_cost,
    0
  )
  assert.equal(
    advisor.supplier_model_simulator.recommended_strategy,
    "test_with_current_supplier"
  )
})

test("supplier model simulator: proveedor directo suma inbound y fulfillment cuando existen assumptions", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({
      assumptions: {
        supplier_model:
          "direct_brand_supplier",
        direct_supplier_unit_cost:
          10,
        inbound_shipping_to_luna:
          1.25,
        luna_receiving_fee:
          0.5,
        luna_storage_fee:
          0.25,
        luna_pick_pack_fee:
          1.1,
        luna_fulfillment_fee:
          2.2,
        luna_outbound_shipping:
          5,
        moq:
          24,
        lead_time_days:
          14,
      },
    })

  const directScenario =
    advisor.supplier_model_simulator.scenarios[1]

  assert.equal(
    directScenario.supplier_model,
    "direct_brand_supplier"
  )
  assert.equal(
    directScenario.supplier_landed_cost,
    12
  )
  assert.equal(
    directScenario.fulfillment_cost,
    3.3
  )
  assert.equal(
    directScenario.shipping_cost,
    5
  )
  assert.equal(
    directScenario.missing_inputs.length,
    0
  )
})

test("supplier model simulator: sin costo directo muestra missing_inputs y no recomienda escalar", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({
      assumptions: {
        inbound_shipping_to_luna:
          1.25,
        moq:
          24,
        lead_time_days:
          14,
      },
    })

  const directScenario =
    advisor.supplier_model_simulator.scenarios[1]

  assert.deepEqual(
    directScenario.missing_inputs,
    ["direct_supplier_unit_cost"]
  )
  assert.equal(
    directScenario.recommendation,
    "Datos insuficientes para comparar con confianza."
  )
  assert.notEqual(
    advisor.supplier_model_simulator.recommended_strategy,
    "scale_with_alternative_supplier"
  )
})

test("supplier model simulator: distributor_wholesale exige inbound antes de recomendar escalar", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({
      assumptions: {
        direct_supplier_unit_cost:
          10,
        moq:
          24,
        lead_time_days:
          14,
      },
    })

  const distributorScenario =
    advisor.supplier_model_simulator.scenarios[2]

  assert.equal(
    distributorScenario.supplier_model,
    "distributor_wholesale"
  )
  assert.ok(
    distributorScenario.missing_inputs.includes(
      "inbound_shipping_to_luna"
    )
  )
  assert.equal(
    distributorScenario.recommendation,
    "Datos insuficientes para comparar con confianza."
  )
  assert.notEqual(
    advisor.supplier_model_simulator.recommended_strategy,
    "scale_with_alternative_supplier"
  )
})

test("supplier model simulator: mercado favorable con proveedor caro recomienda buscar mejor proveedor", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({
      salePrice:
        50,
      lunaCost:
        42,
    })

  assert.equal(
    advisor.supplier_model_simulator.recommended_strategy,
    "find_better_supplier"
  )
  assert.match(
    advisor.supplier_model_simulator.summary,
    /Buscar mejor proveedor/i
  )
})

test("supplier model simulator: costo maximo proveedor baja cuando sube shipping", () => {
  const baseAdvisor =
    makeSupplierSimulatorAdvisor({
      shippingCost:
        6.99,
    })

  const highShippingAdvisor =
    makeSupplierSimulatorAdvisor({
      shippingCost:
        12.99,
    })

  const baseMax =
    baseAdvisor.supplier_model_simulator.scenarios[0]
      .max_supplier_landed_cost

  const highShippingMax =
    highShippingAdvisor.supplier_model_simulator.scenarios[0]
      .max_supplier_landed_cost

  assert.ok(
    highShippingMax < baseMax
  )
})

test("supplier model simulator: profit_gap no crea recomendacion falsa si faltan inputs", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({})

  const directScenario =
    advisor.supplier_model_simulator.scenarios[1]

  assert.equal(
    directScenario.profit_gap,
    null
  )
  assert.equal(
    directScenario.recommendation,
    "Datos insuficientes para comparar con confianza."
  )
})

test("supplier model simulator: Fee Engine V0 conserva porcentaje y fee fijo", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({})

  assert.equal(
    advisor.cost_breakdown.ebay_fee_percent,
    13.25
  )
  assert.equal(
    advisor.cost_breakdown.ebay_fixed_fee,
    0.3
  )
})

test("supplier model simulator: Campaign Advisor no cambia campaign_eligible", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({})

  assert.equal(
    advisor.pricing_strategy.campaign_eligible,
    false
  )
  assert.equal(
    advisor.pricing_strategy.campaign_observation_required,
    true
  )
})

test("multipack advisor: unidad no rentable por shipping sugiere validar pack antes de cambiar proveedor", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({
      candidate: {
        title:
          "John Frieda Sheer Blonde Highlight Activating Brightening Shampoo",
        state:
          "NEEDS_DATA",
        inventory_quantity:
          12,
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
        needs_data: [
          "weight_or_dimensions",
        ],
      },
      salePrice:
        15.09,
      lunaCost:
        4,
      shippingCost:
        6.99,
    })

  assert.equal(
    advisor.multipack_profit_advisor.is_multipack_candidate,
    true
  )
  assert.equal(
    advisor.strategic_summary.commercial_status,
    "multipack_candidate_needs_data"
  )
  assert.match(
    advisor.strategic_summary.recommended_action,
    /Confirmar stock, peso y comparables multipack/i
  )
})

test("multipack advisor: pack viable muestra escenarios y no recomienda publicar si faltan inputs", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({
      candidate: {
        title:
          "Oral-B Glide Gum Care Dental Floss Picks",
        state:
          "NEEDS_DATA",
        needs_data: [
          "confirmed_stock_quantity",
          "weight_or_dimensions",
        ],
      },
      salePrice:
        15.09,
      lunaCost:
        4,
      shippingCost:
        6.99,
    })

  const packThree =
    advisor.multipack_profit_advisor.scenarios.find(
      scenario => scenario.pack_quantity === 3
    )

  assert.ok(packThree)
  assert.equal(
    packThree.pass_10_percent_margin,
    true
  )
  assert.equal(
    packThree.stock_sufficient,
    false
  )
  assert.ok(
    packThree.missing_inputs.includes(
      "confirmed_stock_quantity"
    )
  )
  assert.ok(
    packThree.missing_inputs.includes(
      "weight_or_dimensions"
    )
  )
  assert.equal(
    advisor.multipack_profit_advisor.recommended_strategy,
    "validate_pack_inputs"
  )
  assert.equal(
    advisor.multipack_profit_advisor.best_pack,
    null
  )
  assert.ok(
    advisor.multipack_profit_advisor.best_pack_hypothesis
  )
  assert.ok(
    packThree.buyer_discount_percent > 0
  )
  assert.ok(
    packThree.unit_price_in_pack <
      packThree.unit_market_price
  )
})

test("multipack advisor: stock confirmado de una unidad bloquea packs 2 3 6 12", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({
      candidate: {
        title:
          "Glade Automatic Spray Refill Lavender Vanilla Value Pack",
        state:
          "NEEDS_DATA",
        inventory_quantity:
          1,
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
      },
      salePrice:
        13.64,
      lunaCost:
        4,
      shippingCost:
        6.99,
    })

  assert.equal(
    advisor.multipack_profit_advisor.best_pack,
    null
  )
  assert.equal(
    advisor.multipack_profit_advisor.recommended_strategy,
    "validate_pack_inputs"
  )
  assert.ok(
    advisor.multipack_profit_advisor.scenarios.every(
      scenario =>
        scenario.stock_sufficient === false &&
        scenario.status ===
          "blocked_insufficient_stock"
    )
  )
  assert.ok(
    advisor.multipack_profit_advisor.scenarios.every(
      scenario =>
        scenario.missing_inputs.includes(
          "stock_sufficient_for_pack"
        )
    )
  )
})

test("multipack advisor: producto barato con shipping alto muestra packs aunque ninguno sea viable", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({
      candidate: {
        title:
          "RAM RAM-B-111BU Mounting Plate Powder Coat Garmin GPSMAP",
        state:
          "NEEDS_DATA",
        inventory_quantity:
          8,
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
        needs_data: [
          "weight_or_dimensions",
        ],
      },
      salePrice:
        6,
      lunaCost:
        4,
      shippingCost:
        6.99,
    })

  assert.equal(
    advisor.multipack_profit_advisor.is_multipack_candidate,
    false
  )
  assert.equal(
    advisor.multipack_profit_advisor.best_pack,
    null
  )
  assert.equal(
    advisor.multipack_profit_advisor.best_pack_hypothesis,
    null
  )
  assert.equal(
    advisor.multipack_profit_advisor.scenarios.length,
    4
  )
  assert.equal(
    advisor.multipack_profit_advisor.recommended_strategy,
    "pack_not_enough_find_supplier"
  )
  assert.equal(
    advisor.strategic_summary.commercial_status,
    "pack_not_enough_find_supplier"
  )
  assert.match(
    advisor.strategic_summary.recommended_action,
    /No publicar como unidad ni como pack/
  )
  assert.ok(
    advisor.multipack_profit_advisor.scenarios.every(
      scenario =>
        scenario.pass_10_percent_margin === false
    )
  )
})

test("multipack advisor: no altera Fee Engine ni Campaign Advisor", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({
      candidate: {
        title:
          "Small consumable shampoo",
        state:
          "VALIDATED",
        inventory_quantity:
          12,
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
      },
      salePrice:
        15.09,
      lunaCost:
        4,
      shippingCost:
        6.99,
    })

  assert.equal(
    advisor.cost_breakdown.ebay_fee_percent,
    13.25
  )
  assert.equal(
    advisor.cost_breakdown.ebay_fixed_fee,
    0.3
  )
  assert.equal(
    advisor.pricing_strategy.campaign_eligible,
    false
  )
})

test("stock rotation integration: stock suficiente queda como senal read-only", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({
      candidate: {
        title:
          "Small consumable shampoo",
        state:
          "VALIDATED",
        inventory_quantity:
          12,
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
        weight:
          1,
      },
      salePrice:
        50,
      lunaCost:
        20,
    })

  assert.equal(
    advisor.stock_rotation_risk.status,
    "stock_sufficient"
  )
  assert.equal(
    advisor.stock_rotation_risk.message,
    "Stock suficiente para revision humana. No autoriza publicacion automatica."
  )
  assert.equal(
    advisor.stock_rotation_risk.campaign_blocked_by_stock,
    false
  )
  assert.equal(
    advisor.stock_rotation_risk.stock_guardrail.human_approval_required,
    true
  )
})

test("stock rotation integration: usa cantidad confirmada desde payload normalizado", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({
      candidate: {
        title:
          "AG Adhesive Guru AG 220 CA Glue & Activator",
        state:
          "NEEDS_DATA",
        normalized_payload: {
          stock:
            13,
          inventory_context: {
            inventory_quantity:
              13,
            inventory_scope:
              "variant_level",
            inventory_confidence:
              "high",
            inventory_source:
              "manual_admin_confirmation",
          },
        },
        needs_data: [
          "weight_or_dimensions",
          "authorized_images",
          "category_or_inference_data",
        ],
      },
      salePrice:
        21.99,
      lunaCost:
        4,
    })

  assert.equal(
    advisor.stock_rotation_risk.status,
    "stock_sufficient"
  )
  assert.equal(
    advisor.stock_rotation_risk.confirmed_stock,
    13
  )
  assert.equal(
    advisor.multipack_profit_advisor.recommended_strategy,
    "unit_first_pack_optional"
  )
  assert.equal(
    advisor.multipack_profit_advisor.best_pack_hypothesis.pack_quantity,
    6
  )
  assert.match(
    advisor.multipack_profit_advisor.summary,
    /Unidad organica primero/
  )

  const packTwelve =
    advisor.multipack_profit_advisor.scenarios.find(
      scenario => scenario.pack_quantity === 12
    )

  assert.equal(
    packTwelve.stock_available,
    13
  )
  assert.equal(
    packTwelve.stock_sufficient,
    true
  )
})

test("stock rotation integration: stock no confirmado bloquea escalamiento sin inventar cantidad", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({
      candidate: {
        title:
          "Small consumable shampoo",
        state:
          "VALIDATED",
      },
      salePrice:
        50,
      lunaCost:
        20,
    })

  assert.equal(
    advisor.stock_rotation_risk.status,
    "stock_unconfirmed"
  )
  assert.equal(
    advisor.stock_rotation_risk.confirmed_stock,
    null
  )
  assert.equal(
    advisor.stock_rotation_risk.message,
    "Stock no confirmado. Validar inventario antes de preparar listing, pack o campana."
  )
  assert.equal(
    advisor.stock_rotation_risk.campaign_blocked_by_stock,
    true
  )
  assert.ok(
    advisor.stock_rotation_risk.stock_guardrail.blocked_actions.includes(
      "campaign"
    )
  )
})

test("stock rotation integration: stock insuficiente bloquea pack campana y listing", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({
      candidate: {
        title:
          "Small consumable shampoo",
        state:
          "VALIDATED",
        inventory_quantity:
          0,
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
      },
      salePrice:
        50,
      lunaCost:
        20,
    })

  assert.equal(
    advisor.stock_rotation_risk.status,
    "stock_insufficient"
  )
  assert.equal(
    advisor.stock_rotation_risk.message,
    "Stock insuficiente. No escalar pack, campana ni listing hasta confirmar disponibilidad."
  )
  assert.equal(
    advisor.stock_rotation_risk.pack_blocked_by_stock,
    true
  )
  assert.ok(
    advisor.stock_rotation_risk.stock_guardrail.blocked_actions.includes(
      "publish_listing"
    )
  )
})

test("stock rotation integration: pack bloqueado por stock mantiene copy operativo", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({
      candidate: {
        title:
          "Glade Automatic Spray Refill Lavender Vanilla Value Pack",
        state:
          "VALIDATED",
        inventory_quantity:
          1,
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
        weight:
          1,
      },
      salePrice:
        13.64,
      lunaCost:
        4,
      shippingCost:
        6.99,
    })

  assert.equal(
    advisor.stock_rotation_risk.status,
    "pack_blocked_by_stock"
  )
  assert.equal(
    advisor.stock_rotation_risk.message,
    "Pack no es opcion operativa todavia por stock insuficiente."
  )
  assert.ok(
    advisor.multipack_profit_advisor.scenarios.every(
      scenario =>
        scenario.status === "blocked_insufficient_stock"
    )
  )
})

test("stock rotation integration: riesgo de rotacion no altera profit ni multipack math", () => {
  const stableAdvisor =
    makeSupplierSimulatorAdvisor({
      candidate: {
        title:
          "Small consumable shampoo",
        state:
          "VALIDATED",
        inventory_quantity:
          8,
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
        weight:
          1,
      },
      salePrice:
        50,
      lunaCost:
        20,
    })

  const rotationAdvisor =
    makeSupplierSimulatorAdvisor({
      candidate: {
        title:
          "Small consumable shampoo",
        state:
          "VALIDATED",
        inventory_quantity:
          8,
        previous_confirmed_stock:
          12,
        supplier_availability:
          "unstable",
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
        weight:
          1,
      },
      salePrice:
        50,
      lunaCost:
        20,
    })

  assert.equal(
    rotationAdvisor.stock_rotation_risk.status,
    "rotation_risk"
  )
  assert.equal(
    rotationAdvisor.stock_rotation_risk.message,
    "Riesgo de rotacion de stock. Revisar velocidad de venta, cantidad disponible y reposicion antes de escalar."
  )
  assert.equal(
    rotationAdvisor.cost_breakdown.net_profit,
    stableAdvisor.cost_breakdown.net_profit
  )
  assert.equal(
    rotationAdvisor.cost_breakdown.net_margin_percent,
    stableAdvisor.cost_breakdown.net_margin_percent
  )
  assert.equal(
    rotationAdvisor.multipack_profit_advisor.scenarios[0].net_profit,
    stableAdvisor.multipack_profit_advisor.scenarios[0].net_profit
  )
})

test("stock rotation integration: no genera acciones reales y PUBLISHED sigue sin ruta operativa", () => {
  const advisor =
    makeSupplierSimulatorAdvisor({
      candidate: {
        title:
          "Small consumable shampoo",
        state:
          "PUBLISHED",
        inventory_quantity:
          12,
        inventory_scope:
          "variant_level",
        inventory_confidence:
          "high",
        weight:
          1,
      },
      salePrice:
        50,
      lunaCost:
        20,
    })

  const serialized =
    JSON.stringify(
      advisor.stock_rotation_risk
    )

  assert.equal(
    advisor.recommended_next_action,
    "monitor"
  )
  assert.doesNotMatch(
    serialized,
    /create_real_ebay_draft|auto_publish_listing|publishListing|pauseListing|call_ebay_api/i
  )
  assert.equal(
    advisor.stock_rotation_risk.stock_guardrail.human_approval_required,
    true
  )
})

test("pricing strategy: organico rentable y competitivo -> list_organic", () => {
  const recommendation =
    getPricingStrategyRecommendation({
      candidate: {
        state:
          "VALIDATED",
      },
      profitScenario:
        makeProfitScenario({
          salePrice:
            50,
          lunaCost:
            20,
        }),
      priceIntelligence:
        makePriceIntelligence({
          soldMedian:
            50,
          domesticLanded:
            50,
        }),
    })

  assert.equal(
    recommendation.launch_strategy,
    "list_organic"
  )
  assert.equal(
    recommendation.reason,
    "Listar organico primero. Producto rentable y competitivo."
  )
})

test("pricing strategy: organico rentable pero campana rompe margen -> organic_only_no_campaign", () => {
  const recommendation =
    getPricingStrategyRecommendation({
      candidate: {
        state:
          "VALIDATED",
      },
      profitScenario:
        makeProfitScenario({
          salePrice:
            40,
          lunaCost:
            19.75,
        }),
      priceIntelligence:
        makePriceIntelligence({
          soldMedian:
            40,
          domesticLanded:
            40,
        }),
    })

  assert.equal(
    recommendation.launch_strategy,
    "organic_only_no_campaign"
  )
  assert.equal(
    recommendation.campaign_eligible,
    false
  )
})

test("pricing strategy: campana con margen requiere observar listing primero", () => {
  const recommendation =
    getPricingStrategyRecommendation({
      candidate: {
        state:
          "VALIDATED",
      },
      profitScenario:
        makeProfitScenario({
          salePrice:
            40,
          lunaCost:
            19,
        }),
      priceIntelligence:
        makePriceIntelligence({
          soldMedian:
            40,
          domesticLanded:
            40,
        }),
    })

  assert.equal(
    recommendation.launch_strategy,
    "list_organic"
  )
  assert.equal(
    recommendation.campaign_eligible,
    false
  )
  assert.equal(
    recommendation.campaign_financially_supported,
    true
  )
  assert.equal(
    recommendation.campaign_observation_required,
    true
  )
  assert.equal(
    recommendation.max_safe_campaign_percent,
    2
  )
  assert.match(
    recommendation.proposed_next_step,
    /medir impresiones, clicks, watchers y conversion/i
  )
})

test("pricing strategy: metricas en cero no cuentan como comportamiento observado", () => {
  const recommendation =
    getPricingStrategyRecommendation({
      candidate: {
        state:
          "VALIDATED",
        listing_metrics: {
          impressions:
            0,
          views:
            0,
          clicks:
            0,
          watchers:
            0,
          orders:
            0,
          days_live:
            0,
        },
      },
      profitScenario:
        makeProfitScenario({
          salePrice:
            40,
          lunaCost:
            19,
        }),
      priceIntelligence:
        makePriceIntelligence({
          soldMedian:
            40,
          domesticLanded:
            40,
        }),
    })

  assert.equal(
    recommendation.launch_strategy,
    "list_organic"
  )
  assert.equal(
    recommendation.campaign_eligible,
    false
  )
  assert.equal(
    recommendation.campaign_financially_supported,
    true
  )
  assert.equal(
    recommendation.campaign_observation_required,
    true
  )
})

test("pricing strategy: orden positiva cuenta como comportamiento aunque days_live sea bajo", () => {
  const recommendation =
    getPricingStrategyRecommendation({
      candidate: {
        state:
          "VALIDATED",
        listing_metrics: {
          impressions:
            0,
          views:
            0,
          clicks:
            0,
          watchers:
            0,
          orders:
            1,
          days_live:
            1,
        },
      },
      profitScenario:
        makeProfitScenario({
          salePrice:
            40,
          lunaCost:
            19,
        }),
      priceIntelligence:
        makePriceIntelligence({
          soldMedian:
            40,
          domesticLanded:
            40,
        }),
    })

  assert.equal(
    recommendation.launch_strategy,
    "list_with_small_campaign"
  )
  assert.equal(
    recommendation.campaign_eligible,
    true
  )
  assert.equal(
    recommendation.campaign_observation_required,
    false
  )
})

test("pricing strategy: comportamiento observado habilita campana pequena", () => {
  const recommendation =
    getPricingStrategyRecommendation({
      candidate: {
        state:
          "VALIDATED",
        listing_metrics: {
          impressions:
            120,
          clicks:
            6,
          watchers:
            1,
          days_live:
            4,
        },
      },
      profitScenario:
        makeProfitScenario({
          salePrice:
            40,
          lunaCost:
            19,
        }),
      priceIntelligence:
        makePriceIntelligence({
          soldMedian:
            40,
          domesticLanded:
            40,
        }),
    })

  assert.equal(
    recommendation.launch_strategy,
    "list_with_small_campaign"
  )
  assert.equal(
    recommendation.campaign_eligible,
    true
  )
  assert.equal(
    recommendation.campaign_observation_required,
    false
  )
})

test("pricing strategy: sin market data -> needs_market_data", () => {
  const recommendation =
    getPricingStrategyRecommendation({
      candidate: {
        state:
          "VALIDATED",
      },
      profitScenario:
        makeProfitScenario({}),
      priceIntelligence:
        null,
    })

  assert.equal(
    recommendation.launch_strategy,
    "needs_market_data"
  )
  assert.equal(
    recommendation.reason,
    "Validar Terapeak/eBay Research antes de publicar."
  )
})

test("pricing strategy: market data low confidence -> needs_market_data", () => {
  const recommendation =
    getPricingStrategyRecommendation({
      candidate: {
        state:
          "VALIDATED",
      },
      profitScenario:
        makeProfitScenario({}),
      priceIntelligence:
        makePriceIntelligence({
          sourceConfidence:
            "low",
        }),
    })

  assert.equal(
    recommendation.launch_strategy,
    "needs_market_data"
  )
})

test("pricing strategy: precio rentable por encima del mercado -> blocked", () => {
  const recommendation =
    getPricingStrategyRecommendation({
      candidate: {
        state:
          "BLOCKED",
      },
      profitScenario:
        makeProfitScenario({
          salePrice:
            40,
          lunaCost:
            30,
        }),
      priceIntelligence:
        makePriceIntelligence({
          soldMedian:
            30,
          domesticLanded:
            30,
        }),
    })

  assert.equal(
    recommendation.launch_strategy,
    "blocked"
  )
  assert.equal(
    recommendation.reason,
    "Bloqueado como unidad: precio rentable por encima del mercado."
  )
})

test("pricing strategy: internacional observado no se usa como mercado USA", () => {
  const advisor =
    getEbayProductDecisionAdvisor(
      {
        state:
          "VALIDATED",
      },
      makeProfitScenario({}),
      {
        raw_payload: {
          shipping_scope_evidence: {
            shipping_scope:
              "international",
            competitor_item_price:
              28.99,
            competitor_international_shipping_price:
              34.86,
            competitor_international_landed_price:
              63.85,
          },
        },
      },
      null,
      null
    )

  assert.equal(
    advisor.target_price.market_reference_price,
    null
  )
  assert.equal(
    advisor.pricing_strategy.launch_strategy,
    "needs_market_data"
  )
})

test("pricing strategy: campaign 5 se interpreta como 5%", () => {
  const recommendation =
    getPricingStrategyRecommendation({
      candidate: {
        state:
          "VALIDATED",
      },
      profitScenario:
        makeProfitScenario({
          salePrice:
            50,
          lunaCost:
            20,
        }),
      priceIntelligence:
        makePriceIntelligence({
          soldMedian:
            50,
          domesticLanded:
            50,
        }),
    })

  assert.equal(
    recommendation.max_safe_campaign_percent,
    5
  )
  assert.ok(
    recommendation.minimum_price_with_5_percent_campaign < 100
  )
})

test("stock rotation risk guardrail: stock 1 bloquea publicacion pack y campana", () => {
  const risk =
    evaluateStockRotationRisk({
      confirmed_stock:
        1,
      net_margin_percent:
        35,
      readiness_passed:
        true,
    })

  assert.equal(
    risk.stock_risk_level,
    "critical"
  )
  assert.equal(
    risk.stock_decision,
    "do_not_publish"
  )
  assert.deepEqual(
    risk.blocked_actions,
    [
      "publish_listing",
      "pack_review",
      "campaign",
    ]
  )
  assert.equal(
    risk.human_approval_required,
    true
  )
})

test("stock rotation risk guardrail: stock 2-3 bloquea pack y campana", () => {
  const risk =
    evaluateStockRotationRisk({
      confirmed_stock:
        3,
      readiness_passed:
        true,
    })

  assert.equal(
    risk.stock_risk_level,
    "high"
  )
  assert.equal(
    risk.stock_decision,
    "limited_organic_test"
  )
  assert.ok(
    risk.blocked_actions.includes("pack_review")
  )
  assert.ok(
    risk.blocked_actions.includes("campaign")
  )
  assert.ok(
    risk.allowed_actions.includes(
      "limited_organic_listing_max_quantity_1"
    )
  )
})

test("stock rotation risk guardrail: stock 4-5 permite solo prueba organica limitada", () => {
  const risk =
    evaluateStockRotationRisk({
      confirmed_stock:
        5,
      readiness_passed:
        true,
    })

  assert.equal(
    risk.stock_risk_level,
    "medium"
  )
  assert.equal(
    risk.stock_decision,
    "limited_organic_test"
  )
  assert.deepEqual(
    risk.allowed_actions,
    [
      "limited_organic_test",
    ]
  )
  assert.ok(
    risk.blocked_actions.includes("campaign")
  )
  assert.ok(
    risk.blocked_actions.includes("large_pack_review")
  )
})

test("stock rotation risk guardrail: stock 6+ permite evaluar listing si readiness pasa", () => {
  const risk =
    evaluateStockRotationRisk({
      confirmed_stock:
        8,
      previous_confirmed_stock:
        8,
      readiness_passed:
        true,
    })

  assert.equal(
    risk.stock_risk_level,
    "low"
  )
  assert.equal(
    risk.stock_decision,
    "eligible_for_listing_prep"
  )
  assert.deepEqual(
    risk.allowed_actions,
    [
      "organic_listing_prep",
    ]
  )
  assert.ok(
    risk.blocked_actions.includes(
      "scale_without_observation"
    )
  )
})

test("stock rotation risk guardrail: stock 12+ permite pack solo con datos completos", () => {
  const incomplete =
    evaluateStockRotationRisk({
      confirmed_stock:
        12,
      margin_passed:
        true,
      weight_passed:
        true,
      comparables_passed:
        true,
      shipping_passed:
        false,
    })

  const complete =
    evaluateStockRotationRisk({
      confirmed_stock:
        12,
      margin_passed:
        true,
      weight_passed:
        true,
      comparables_passed:
        true,
      shipping_passed:
        true,
    })

  assert.equal(
    incomplete.stock_decision,
    "eligible_for_listing_prep"
  )
  assert.ok(
    incomplete.blocked_actions.includes(
      "pack_review_until_margin_weight_comparables_shipping_pass"
    )
  )
  assert.equal(
    complete.stock_decision,
    "eligible_for_pack_review"
  )
  assert.deepEqual(
    complete.allowed_actions,
    [
      "pack_review",
    ]
  )
})

test("stock rotation risk guardrail: margen bueno no elimina riesgo de stock bajo", () => {
  const risk =
    evaluateStockRotationRisk({
      confirmed_stock:
        1,
      net_margin_percent:
        55,
      demand_level:
        "high",
      margin_passed:
        true,
    })

  assert.equal(
    risk.stock_risk_level,
    "critical"
  )
  assert.equal(
    risk.stock_decision,
    "do_not_publish"
  )
})

test("stock rotation risk guardrail: campana sigue bloqueada aunque sea rentable con stock bajo", () => {
  const risk =
    evaluateStockRotationRisk({
      confirmed_stock:
        2,
      net_margin_percent:
        40,
      readiness_passed:
        true,
      margin_passed:
        true,
    })

  assert.equal(
    risk.stock_decision,
    "limited_organic_test"
  )
  assert.ok(
    risk.blocked_actions.includes("campaign")
  )
})

test("stock rotation risk guardrail: output estable y aprobacion humana requerida", () => {
  const risk =
    evaluateStockRotationRisk({
      confirmed_stock:
        6,
      previous_confirmed_stock:
        9,
      supplier_availability:
        "unstable",
      shipping_days:
        10,
      net_margin_percent:
        8,
    })

  assert.deepEqual(
    Object.keys(risk),
    [
      "stock_risk_level",
      "stock_decision",
      "account_risk_notes",
      "blocked_actions",
      "allowed_actions",
      "next_safe_step",
      "human_approval_required",
    ]
  )
  assert.equal(
    risk.stock_risk_level,
    "medium"
  )
  assert.equal(
    risk.human_approval_required,
    true
  )
  assert.ok(
    risk.account_risk_notes.length >= 3
  )
})

test("listing seller advisor prompts: templates exportan contenido estable", () => {
  assert.equal(
    listingSellerAdvisorPromptsV0.id,
    "listing_seller_advisor_prompts_v0"
  )
  assert.equal(
    listingSellerAdvisorPromptsV0.principle,
    "Protect active eBay listings first; readiness before creativity for new opportunities."
  )
  assert.equal(
    listingSellerAdvisorPromptsV0.human_approval_required,
    true
  )
  assert.deepEqual(
    listingSellerAdvisorPromptsV0.templates.map(
      template => template.id
    ),
    [
      "listing_readiness_template_v0",
      "title_optimizer_template_v0",
      "image_conversion_template_v0",
      "description_converter_template_v0",
      "launch_observation_template_v0",
      "listing_strategy_template_v0",
    ]
  )
})

test("listing seller advisor prompts: readiness aparece antes que prompts creativos", () => {
  assert.equal(
    listingSellerAdvisorPromptsV0.templates[0],
    listingReadinessTemplate
  )
  assert.equal(
    listingSellerAdvisorPromptsV0.templates.indexOf(
      listingReadinessTemplate
    ) <
      listingSellerAdvisorPromptsV0.templates.indexOf(
        titleOptimizerTemplate
      ),
    true
  )
  assert.equal(
    listingSellerAdvisorPromptsV0.templates.indexOf(
      listingReadinessTemplate
    ) <
      listingSellerAdvisorPromptsV0.templates.indexOf(
        imageConversionTemplate
      ),
    true
  )
})

test("listing seller advisor prompts: readiness bloquea datos criticos", () => {
  assert.deepEqual(
    listingReadinessTemplate.required_inputs,
    [
      "active_ebay_listing_risk_review",
      "confirmed_stock",
      "weight_or_dimensions",
      "authorized_images",
      "category_and_item_specifics",
      "sufficient_margin",
      "reliable_shipping",
      "viable_supplier",
      "pack_strategy_if_applicable",
      "low_stock_or_cancellation_risk_review",
    ]
  )

  const blockedFields =
    listingReadinessTemplate.blocking_rules
      .filter(rule => rule.severity === "block")
      .map(rule => rule.field)

  assert.ok(
    blockedFields.includes(
      "active_ebay_listing_risk_review"
    )
  )
  assert.ok(
    blockedFields.includes("confirmed_stock")
  )
  assert.ok(
    blockedFields.includes("sufficient_margin")
  )
  assert.ok(
    blockedFields.includes("reliable_shipping")
  )
  assert.ok(
    blockedFields.includes(
      "low_stock_or_cancellation_risk_review"
    )
  )
})

test("listing seller advisor prompts: no contienen acciones reales ni eBay API", () => {
  const templatesJson =
    JSON.stringify(
      listingSellerAdvisorPromptsV0
    )

  assert.doesNotMatch(
    templatesJson,
    /fetch\(|createDraft|createListing|publishListing|pauseListing|ebayApi|TradingAPI|InventoryAPI/i
  )
  assert.ok(
    listingStrategyTemplate.forbidden_actions.includes(
      "auto_publish_listing"
    )
  )
  assert.ok(
    listingReadinessTemplate.forbidden_actions.includes(
      "create_real_ebay_draft"
    )
  )
  assert.ok(
    listingReadinessTemplate.forbidden_actions.includes(
      "call_ebay_api"
    )
  )
})

test("listing seller advisor prompts: title template exige titulos eBay conservadores", () => {
  assert.equal(
    titleOptimizerTemplate.output_count,
    3
  )
  assert.equal(
    titleOptimizerTemplate.target_length,
    "60-80 characters"
  )
  assert.ok(
    titleOptimizerTemplate.rules.some(rule =>
      /main buyer keyword/i.test(rule)
    )
  )
  assert.ok(
    titleOptimizerTemplate.rules.some(rule =>
      /unverified claims/i.test(rule)
    )
  )
  assert.ok(
    titleOptimizerTemplate.rules.some(rule =>
      /unauthorized brands/i.test(rule)
    )
  )
})

test("listing seller advisor prompts: image template planea siete imagenes con objeciones", () => {
  assert.equal(
    imageConversionTemplate.images.length,
    7
  )
  assert.ok(
    imageConversionTemplate.images.every(
      image =>
        image.commercial_goal &&
        image.buyer_objection_resolved &&
        image.suggested_visual_prompt &&
        image.must_not_include
    )
  )
  assert.deepEqual(
    imageConversionTemplate.images.map(
      image => image.role
    ),
    [
      "main_click_image",
      "trust_quality_material",
      "package_contents",
      "dimensions_size",
      "benefit_in_action",
      "lifestyle_context",
      "scale_hands_real_use",
    ]
  )
})

test("listing seller advisor prompts: description bloquea medical claims datos inventados y marcas no autorizadas", () => {
  assert.deepEqual(
    descriptionConverterTemplate.required_sections,
    [
      "What it is",
      "Who it is for",
      "Key benefits",
      "Features",
      "What is included",
      "Shipping/handling note",
      "Trust note",
    ]
  )
  assert.ok(
    descriptionConverterTemplate.forbidden_content.includes(
      "medical claims"
    )
  )
  assert.ok(
    descriptionConverterTemplate.forbidden_content.includes(
      "invented data"
    )
  )
  assert.ok(
    descriptionConverterTemplate.forbidden_content.includes(
      "unauthorized brands"
    )
  )
})

test("listing seller advisor prompts: lanzamiento es organico primero con campana apagada", () => {
  assert.equal(
    launchObservationTemplate.default_launch,
    "organic_first"
  )
  assert.equal(
    launchObservationTemplate.initial_campaign,
    "off"
  )
  assert.deepEqual(
    launchObservationTemplate.observe_metrics,
    [
      "impressions",
      "clicks",
      "watchers",
      "conversion",
      "sales",
    ]
  )
  assert.ok(
    launchObservationTemplate.campaign_rules.some(rule =>
      /1%-2% campaign/i.test(rule)
    )
  )
  assert.ok(
    launchObservationTemplate.campaign_rules.some(rule =>
      /stock is low/i.test(rule)
    )
  )
})

test("listing seller advisor prompts: estrategia combina decision readiness creatividad y riesgos", () => {
  assert.deepEqual(
    listingStrategyTemplate.combines,
    [
      "seller_decision",
      "readiness",
      "title",
      "images",
      "description",
      "item_specifics",
      "price",
      "shipping",
      "pack",
      "launch",
      "risks",
      "final_conclusion",
    ]
  )
  assert.equal(
    listingStrategyTemplate.conclusion_schema
      .human_approval_required,
    true
  )
  assert.equal(
    listingStrategyTemplate.conclusion_schema
      .active_listing_risk_status,
    "clear | needs_review | critical_blocker"
  )
  assert.match(
    listingStrategyTemplate.final_review_order[0],
    /active eBay listing risks first/i
  )
})

test("ebay listing admin read-only screen: human friendly copy and guardrails", () => {
  const source =
    fs.readFileSync(
      "app/admin/ebay-listings/page.tsx",
      "utf8"
    )

  for (const expectedText of [
    "Qué estás viendo",
    "Puede pasar a revisión humana",
    "Bloqueado: no avanzar",
    "Revisar precio, margen y ROI",
    "Confirmaciones de seguridad",
    "Acciones humanas requeridas",
    "Data source: simulated fixture",
    "EBAY_LISTING_ADMIN_READ_ONLY_DATA_CONTRACT_V1",
  ]) {
    assert.ok(
      source.includes(expectedText),
      `expected admin screen source to include ${expectedText}`
    )
  }

  for (const forbiddenPattern of [
    /fetch\(/,
    /createClient/,
    /\.insert\(/,
    /\.update\(/,
    /\.delete\(/,
    /\.upsert\(/,
    /\.rpc\(/,
  ]) {
    assert.doesNotMatch(
      source,
      forbiddenPattern
    )
  }
})
