import assert from "node:assert/strict"
import test from "node:test"
import {
  buildDecisionIdempotencyKey,
  calculateProfitScenario,
  processRadarCandidate,
} from "../lib/ebay-winner-pipeline/core.mjs"
import {
  getEbayProductDecisionAdvisor,
  getPricingStrategyRecommendation,
} from "../lib/ebay-winner-pipeline/decision-advisor.mjs"
import {
  getRadarAdvisorEvent,
  getNormalizedInventoryContext,
} from "../lib/radar-advisor-events.mjs"

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
  assert.equal(
    alert.advisor_message,
    "Luna marca este producto como disponible, pero no expone unidades numéricas. Validar inventario real antes de listar, escalar campaña o crear packs grandes."
  )
  assert.equal(
    alert.proposed_next_step,
    "Validar inventario real del SKU antes de listar o escalar."
  )
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

  assert.equal(alert.recommended_action, "recalculate_profit")
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
          3.84 +
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
            20,
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
            19.26,
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
