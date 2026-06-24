import assert from "node:assert/strict"
import test from "node:test"
import {
  buildDecisionIdempotencyKey,
  calculateEbayFee,
  calculateProfitScenario,
  processRadarCandidate,
  resolveEbayFeeRule,
} from "../lib/ebay-winner-pipeline/core.mjs"
import {
  getEbayProductDecisionAdvisor,
  getPricingStrategyRecommendation,
} from "../lib/ebay-winner-pipeline/decision-advisor.mjs"

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
})

test("producto con margen bajo queda bloqueado", () => {
  const result = processRadarCandidate({
    ...validRadarProduct,
    sku: "LP-LOWMARGIN-001",
    price: 20,
    estimated_sale_price: 23,
  })

  assert.equal(result.candidate.state, "BLOCKED")
  assert.ok(
    result.compliance.findings.some(finding =>
      finding.code === "margin_below_minimum"
    )
  )
})

test("Fee Engine V0: categoria default usa 13.25% + fee fijo", () => {
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

test("Fee Engine V0: books/media usa 14.95% + fee fijo", () => {
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

test("Fee Engine V0: guitars/basses usa 6.35% + fee fijo", () => {
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

test("Fee Engine V0: sneakers desde 150 usa 8% + fee fijo", () => {
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

test("Fee Engine V0: categoria desconocida usa default con confianza media", () => {
  const rule =
    resolveEbayFeeRule(
      {},
      100,
      {}
    )

  assert.equal(rule.final_value_fee_percent, 13.25)
  assert.equal(rule.fixed_order_fee, 0.3)
  assert.equal(rule.fee_source, "default_most_categories")
  assert.equal(rule.confidence, "medium")
})

test("Fee Engine V0: insertion fee no se suma por defecto", () => {
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
      paymentFeePercent:
        0,
      advertisingPercent:
        0,
      returnReservePercent:
        0,
    }
  )

  assert.equal(result.estimated_ebay_fee, 13.55)
  assert.match(
    result.assumptions.insertion_fee_assumption,
    /Primeros 250 anuncios/
  )
})

test("Fee Engine V0: fee fijo se suma separado del payment fee", () => {
  assert.equal(
    calculateEbayFee(
      100,
      {
        final_value_fee_percent:
          13.25,
        fixed_order_fee:
          0.3,
      }
    ),
    13.55
  )
})

test("Fee Engine V0: Advisor advierte si falta category_or_inference_data", () => {
  const profitScenario =
    calculateProfitScenario(
      {
        cost:
          8,
        estimated_sale_price:
          31.5,
        shipping_cost:
          6.99,
        fulfillment_cost:
          0,
        packaging_cost:
          0,
      }
    )

  const advisor =
    getEbayProductDecisionAdvisor(
      {
        state:
          "NEEDS_DATA",
        needs_data: [
          "category_or_inference_data",
        ],
      },
      {
        validation_status:
          "needs_data",
        missing_fields: [
          "category_or_inference_data",
        ],
      },
      profitScenario,
      {
        overall_status:
          "passed",
      },
      null,
      {
        winner_score:
          70,
      }
    )

  assert.ok(
    advisor.profit_reasons.some(reason =>
      reason.includes("categoria final afecta el fee de eBay")
    )
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

test("pricing strategy: campana 1%-2% mantiene margen -> list_with_small_campaign", () => {
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
    "list_with_small_campaign"
  )
  assert.equal(
    recommendation.campaign_eligible,
    true
  )
  assert.equal(
    recommendation.max_safe_campaign_percent,
    2
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
