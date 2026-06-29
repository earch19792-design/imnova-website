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
  buildPipelineProductSelectionDecision,
  mapPipelineResultToProductSelectionCandidate,
} from "../lib/ebay-winner-pipeline/service.mjs"
import {
  getActiveListingRiskSummary,
  getOpenActiveListingRisks,
  getRisksByEbaySku,
  getRisksBySupplierSku,
} from "../lib/ebay-winner-pipeline/active-listing-risk-read-service.mjs"
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

test("radar advisor: restocked + BLOCKED -> resurface_for_reanalysis", () => {
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
  assert.equal(alert.seller_reason, "Producto volvio a stock")
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
    /Buscar SKU en Radar/
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
    /Solo lectura · No ejecuta acciones reales/
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
    /Cola Advisor/
  )
  assert.match(
    source,
    /Resumen vendedor/
  )
  assert.match(
    source,
    /Cancelacion[\s\S]*Stock[\s\S]*Margen[\s\S]*Riesgo eBay[\s\S]*Oportunidad/
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
    /radarAdvisorReviewFilterOptions[\s\S]*Stock[\s\S]*Margen[\s\S]*Riesgo/
  )
  assert.match(
    source,
    /matchesRadarAdvisorReviewFilter[\s\S]*seller_priority[\s\S]*seller_action_label/
  )
  assert.match(
    source,
    /Productos filtrados[\s\S]*getRadarAdvisorFilterResultTitle/
  )
  assert.match(
    source,
    /{filteredAdvisorAlerts\.length}\/{advisorAlerts\.length}/
  )
  assert.match(
    source,
    /Sin alertas para este filtro/
  )
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

test("pipeline reanalysis: BLOCKED + restocked resurface_blocked", () => {
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

  assert.equal(advisor.action, "resurface_blocked")
  assert.equal(advisor.priority, "high")
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
