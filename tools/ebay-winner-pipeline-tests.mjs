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
  getRadarAdvisorEvent,
  getNormalizedInventoryContext,
} from "../lib/radar-advisor-events.mjs"

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
    "Luna muestra una disponibilidad alta a nivel producto/categoría, pero no confirma cantidad exacta por variante."
  )
  assert.equal(
    alert.proposed_next_step,
    "Confirmar inventario real del SKU/variante antes de listar, crear pack o escalar campaña."
  )
  assert.equal(alert.recommended_action, "recalculate_profit")
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
