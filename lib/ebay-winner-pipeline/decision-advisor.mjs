function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null
  }

  const number =
    typeof value === "number"
      ? value
      : Number(value)

  return Number.isFinite(number)
    ? number
    : null
}

function roundMoney(value) {
  return Math.round(
    (value + 1e-8) * 100
  ) / 100
}

function roundUpMarketPrice(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }

  return roundMoney(
    Math.ceil((value + 0.01) / 5) * 5 - 0.01
  )
}

function stringList(value) {
  if (!value) {
    return []
  }

  if (Array.isArray(value)) {
    return value
      .map(item =>
        typeof item === "string"
          ? item
          : JSON.stringify(item)
      )
      .filter(Boolean)
  }

  if (typeof value === "string") {
    return [
      value,
    ]
  }

  return [
    JSON.stringify(value),
  ]
}

function complianceMessages(compliance) {
  const findings =
    compliance?.findings

  if (!Array.isArray(findings)) {
    return stringList(findings)
  }

  return findings
    .map(finding => {
      if (
        finding &&
        typeof finding === "object"
      ) {
        return finding.message ||
          finding.code ||
          JSON.stringify(finding)
      }

      return String(finding)
    })
    .filter(Boolean)
}

function getProfitAssumptions(profitScenario) {
  return profitScenario?.assumptions &&
    typeof profitScenario.assumptions === "object"
    ? profitScenario.assumptions
    : {}
}

function getAssumptionPercent(
  assumptions,
  key,
  fallback = 0
) {
  return toNumber(
    assumptions[key]
  ) ?? fallback
}

function getCandidateShippingSource(candidate) {
  if (
    toNumber(candidate?.shipping_cost) !== null
  ) {
    return "product_specific"
  }

  return "default"
}

function getDimensionValues(dimensions) {
  if (
    !dimensions ||
    typeof dimensions !== "object" ||
    Array.isArray(dimensions)
  ) {
    return []
  }

  return Object.values(dimensions)
    .map(toNumber)
    .filter(value => value !== null)
}

function getShippingNote(candidate) {
  const weight =
    toNumber(candidate?.weight)

  const dimensionValues =
    getDimensionValues(
      candidate?.dimensions
    )

  const maxDimension =
    dimensionValues.length > 0
      ? Math.max(
          ...dimensionValues
        )
      : null

  if (
    (weight !== null && weight >= 5) ||
    (maxDimension !== null && maxDimension >= 18)
  ) {
    return {
      shipping_note:
        "Revisar envio antes de listar: el peso o dimensiones pueden cambiar el costo.",
      shipping_review_required:
        true,
    }
  }

  return {
    shipping_note:
      "Envio estimado estandar; ajustar si el producto requiere transporte especial.",
    shipping_review_required:
      false,
  }
}

function calculateCostScenario({
  salePrice,
  lunaCost,
  shippingCost,
  fulfillmentCost,
  packagingCost,
  ebayFeePercent,
  paymentFeePercent,
  promotionPercent,
  returnReservePercent,
  targetMarginPercent,
}) {
  const cappedPromotionPercent =
    Math.min(
      Math.max(
        promotionPercent,
        0
      ),
      5
    )

  const safeShippingCost =
    Math.max(
      6.99,
      shippingCost
    )

  const ebayFeeAmount =
    roundMoney(
      salePrice * (ebayFeePercent / 100)
    )

  const paymentFeeAmount =
    roundMoney(
      salePrice * (paymentFeePercent / 100)
    )

  const promotionAmount =
    roundMoney(
      salePrice * (cappedPromotionPercent / 100)
    )

  const returnReserveAmount =
    roundMoney(
      salePrice * (returnReservePercent / 100)
    )

  const directCost =
    roundMoney(
      lunaCost + safeShippingCost
    )

  const marketplaceCost =
    roundMoney(
      ebayFeeAmount +
      paymentFeeAmount +
      promotionAmount
    )

  const operatingCost =
    roundMoney(
      fulfillmentCost +
      packagingCost +
      returnReserveAmount
    )

  const totalEstimatedCost =
    roundMoney(
      directCost +
      marketplaceCost +
      operatingCost
    )

  const netProfit =
    roundMoney(
      salePrice - totalEstimatedCost
    )

  const netMarginPercent =
    salePrice > 0
      ? roundMoney(
          (netProfit / salePrice) * 100
        )
      : 0

  const roiPercent =
    lunaCost > 0
      ? roundMoney(
          (netProfit / lunaCost) * 100
        )
      : 0

  const variableRate =
    (
      ebayFeePercent +
      paymentFeePercent +
      cappedPromotionPercent +
      returnReservePercent
    ) / 100

  const fixedCosts =
    lunaCost +
    safeShippingCost +
    fulfillmentCost +
    packagingCost

  const breakEvenPrice =
    1 - variableRate > 0
      ? roundMoney(
          fixedCosts / (1 - variableRate)
        )
      : null

  const minimumPriceForMargin =
    1 - variableRate - targetMarginPercent / 100 > 0
      ? roundMoney(
          fixedCosts /
            (1 - variableRate - targetMarginPercent / 100)
        )
      : null

  return {
    sale_price:
      salePrice,
    luna_cost:
      lunaCost,
    shipping_cost:
      safeShippingCost,
    ebay_fee_percent:
      ebayFeePercent,
    ebay_fee_amount:
      ebayFeeAmount,
    payment_fee_percent:
      paymentFeePercent,
    payment_fee_amount:
      paymentFeeAmount,
    promotion_percent:
      cappedPromotionPercent,
    promotion_amount:
      promotionAmount,
    fulfillment_cost:
      fulfillmentCost,
    packaging_cost:
      packagingCost,
    return_reserve_percent:
      returnReservePercent,
    return_reserve_amount:
      returnReserveAmount,
    direct_cost:
      directCost,
    marketplace_cost:
      marketplaceCost,
    operating_cost:
      operatingCost,
    total_estimated_cost:
      totalEstimatedCost,
    net_profit:
      netProfit,
    net_margin_percent:
      netMarginPercent,
    roi_percent:
      roiPercent,
    break_even_price:
      breakEvenPrice,
    minimum_price_for_10_percent_margin:
      minimumPriceForMargin,
    suggested_target_price:
      minimumPriceForMargin === null
        ? null
        : roundUpMarketPrice(
            minimumPriceForMargin
          ),
    pass_10_percent_margin:
      netProfit > 0 &&
      netMarginPercent >= targetMarginPercent,
  }
}

function calculateCostBreakdown(candidate, profitScenario) {
  const assumptions =
    getProfitAssumptions(profitScenario)

  const salePrice =
    toNumber(
      profitScenario?.estimated_sale_price
    ) || 0

  const lunaCost =
    toNumber(profitScenario?.luna_cost) || 0

  const shippingCost =
    toNumber(
      profitScenario?.estimated_shipping_cost
    ) || 0

  const fulfillmentCost =
    toNumber(
      profitScenario?.fulfillment_cost
    ) || 0

  const packagingCost =
    toNumber(
      profitScenario?.packaging_cost
    ) || 0

  const ebayFeePercent =
    getAssumptionPercent(
      assumptions,
      "ebayFeePercent"
    )

  const paymentFeePercent =
    getAssumptionPercent(
      assumptions,
      "paymentFeePercent"
    )

  const currentPromotionPercent =
    Math.min(
      getAssumptionPercent(
        assumptions,
        "advertisingPercent"
      ),
      5
    )

  const returnReservePercent =
    getAssumptionPercent(
      assumptions,
      "returnReservePercent"
    )

  const targetMarginPercent =
    getAssumptionPercent(
      assumptions,
      "minimumNetMarginPercent",
      10
    )

  const shippingInfo =
    getShippingNote(candidate)

  const sharedInput = {
    salePrice,
    lunaCost,
    shippingCost,
    fulfillmentCost,
    packagingCost,
    ebayFeePercent,
    paymentFeePercent,
    returnReservePercent,
    targetMarginPercent,
  }

  const scenarioCurrent =
    calculateCostScenario({
      ...sharedInput,
      promotionPercent:
        currentPromotionPercent,
    })

  const scenarioWithoutPromotion =
    calculateCostScenario({
      ...sharedInput,
      promotionPercent:
        0,
    })

  const scenarioWithMaxPromotion =
    calculateCostScenario({
      ...sharedInput,
      promotionPercent:
        5,
    })

  return {
    ...scenarioCurrent,
    shipping_source:
      getCandidateShippingSource(candidate),
    shipping_note:
      shippingInfo.shipping_note,
    shipping_review_required:
      shippingInfo.shipping_review_required,
    minimum_target_margin_percent:
      targetMarginPercent,
    scenario_current:
      scenarioCurrent,
    scenario_without_promotion:
      scenarioWithoutPromotion,
    scenario_with_max_promotion:
      scenarioWithMaxPromotion,
  }
}

function calculateMinimumPriceForMargin(profitScenario) {
  const assumptions =
    getProfitAssumptions(profitScenario)

  const lunaCost =
    toNumber(profitScenario?.luna_cost) || 0

  const shipping =
    Math.max(
      6.99,
      toNumber(profitScenario?.estimated_shipping_cost) || 0
    )

  const fulfillment =
    toNumber(profitScenario?.fulfillment_cost) || 0

  const packaging =
    toNumber(profitScenario?.packaging_cost) || 0

  const fixedCosts =
    roundMoney(
      lunaCost +
      shipping +
      fulfillment +
      packaging
    )

  const ebayFeePercent =
    getAssumptionPercent(
      assumptions,
      "ebayFeePercent"
    )

  const paymentFeePercent =
    getAssumptionPercent(
      assumptions,
      "paymentFeePercent"
    )

  const advertisingPercent =
    Math.min(
      getAssumptionPercent(
        assumptions,
        "advertisingPercent"
      ),
      5
    )

  const returnReservePercent =
    getAssumptionPercent(
      assumptions,
      "returnReservePercent"
    )

  const minimumTargetMarginPercent =
    toNumber(
      assumptions.minimumNetMarginPercent
    ) || 10

  const variableRate =
    (
      ebayFeePercent +
      paymentFeePercent +
      advertisingPercent +
      returnReservePercent
    ) / 100

  const targetMargin =
    minimumTargetMarginPercent / 100

  const denominator =
    1 - variableRate - targetMargin

  const minimumPrice =
    denominator > 0
      ? roundMoney(
          fixedCosts / denominator
        )
      : null

  return {
    fixed_costs:
      fixedCosts,
    variable_rate_percent:
      roundMoney(
        variableRate * 100
      ),
    minimum_target_margin_percent:
      minimumTargetMarginPercent,
    minimum_price_for_10_percent_margin:
      minimumPrice,
    suggested_target_price:
      minimumPrice === null
        ? null
        : roundUpMarketPrice(minimumPrice),
    ideal_target_price:
      minimumPrice === null
        ? null
        : roundUpMarketPrice(
            minimumPrice * 1.08
          ),
  }
}

function getMarketReference(priceIntelligence) {
  if (!priceIntelligence) {
    return {
      market_reference_price:
        null,
      market_reference_source:
        null,
      market_confidence:
        null,
      has_sold_evidence:
        false,
      sold_min_price:
        null,
      sold_max_price:
        null,
    }
  }

  const soldMedian =
    toNumber(
      priceIntelligence.sold_median_price
    )

  const soldAvg =
    toNumber(
      priceIntelligence.sold_avg_price
    )

  const activeAvg =
    toNumber(
      priceIntelligence.active_avg_price
    )

  return {
    market_reference_price:
      soldMedian ??
      soldAvg ??
      activeAvg,
    market_reference_source:
      soldMedian !== null
        ? "sold_median_price"
        : soldAvg !== null
          ? "sold_avg_price"
          : activeAvg !== null
            ? "active_avg_price"
            : null,
    market_confidence:
      priceIntelligence.source_confidence ||
      priceIntelligence.confidence_score ||
      null,
    has_sold_evidence:
      soldMedian !== null ||
      soldAvg !== null,
    sold_min_price:
      toNumber(
        priceIntelligence.sold_min_price
      ),
    sold_max_price:
      toNumber(
        priceIntelligence.sold_max_price
      ),
  }
}

function getLandedPriceEvidence(
  priceIntelligence
) {
  if (!priceIntelligence) {
    return {
      competitor_item_price:
        null,
      competitor_shipping_price:
        null,
      competitor_landed_price:
        null,
      shipping_strategy:
        "unknown",
    }
  }

  const rawPayload =
    priceIntelligence.raw_payload &&
    typeof priceIntelligence.raw_payload === "object" &&
    !Array.isArray(priceIntelligence.raw_payload)
      ? priceIntelligence.raw_payload
      : {}

  const landedPayload =
    rawPayload.landed_price_evidence &&
    typeof rawPayload.landed_price_evidence === "object" &&
    !Array.isArray(rawPayload.landed_price_evidence)
      ? rawPayload.landed_price_evidence
      : null

  if (!landedPayload) {
    return {
      competitor_item_price:
        null,
      competitor_shipping_price:
        null,
      competitor_landed_price:
        null,
      shipping_strategy:
        "unknown",
    }
  }

  const itemPrice =
    toNumber(
      landedPayload.competitor_item_price
    )

  const shippingPrice =
    toNumber(
      landedPayload.competitor_shipping_price
    )

  const landedPrice =
    toNumber(
      landedPayload.competitor_landed_price
    )

  const inferredStrategy =
    shippingPrice === null
      ? "unknown"
      : shippingPrice === 0
        ? "free_shipping"
        : itemPrice !== null &&
          shippingPrice >= itemPrice * 0.75
          ? "high_shipping"
          : "paid_shipping"

  return {
    competitor_item_price:
      itemPrice,
    competitor_shipping_price:
      shippingPrice,
    competitor_landed_price:
      landedPrice,
    shipping_strategy:
      typeof landedPayload.shipping_strategy === "string"
        ? landedPayload.shipping_strategy
        : inferredStrategy,
  }
}

function isTargetCompetitive(targetPrice, market) {
  if (targetPrice === null) {
    return false
  }

  if (
    market.sold_min_price !== null &&
    market.sold_max_price !== null
  ) {
    return targetPrice >= market.sold_min_price &&
      targetPrice <= market.sold_max_price
  }

  if (market.market_reference_price !== null) {
    return targetPrice <=
      market.market_reference_price * 1.1
  }

  return false
}

export function getEbayProductDecisionAdvisor(
  candidate,
  profitScenario,
  priceIntelligence,
  validation,
  compliance
) {
  const state =
    candidate?.state ||
    "DETECTED"

  const netProfit =
    toNumber(
      profitScenario?.net_profit
    )

  const netMargin =
    toNumber(
      profitScenario?.net_margin_percent
    )

  const costBreakdown =
    calculateCostBreakdown(
      candidate,
      profitScenario
    )

  const targetPrice =
    calculateMinimumPriceForMargin(
      profitScenario
    )

  const market =
    getMarketReference(
      priceIntelligence
    )

  const landedEvidence =
    getLandedPriceEvidence(
      priceIntelligence
    )

  const marketForCompetitiveness =
    landedEvidence.competitor_landed_price !== null &&
    !market.has_sold_evidence
      ? {
          ...market,
          market_reference_price:
            landedEvidence.competitor_landed_price,
          market_reference_source:
            "competitor_landed_price",
          sold_min_price:
            null,
          sold_max_price:
            null,
        }
      : market

  const isTargetPriceCompetitive =
    isTargetCompetitive(
      targetPrice.suggested_target_price,
      marketForCompetitiveness
    )

  const missingData = [
    ...stringList(
      candidate?.needs_data
    ),
    ...stringList(
      validation?.missing_fields
    ),
  ]

  const blockReasons = []
  const profitReasons = []
  const marketPriceReasons = []

  if (netProfit !== null && netProfit <= 0) {
    blockReasons.push(
      "Bloqueado porque la ganancia neta es negativa o cero."
    )
    profitReasons.push(
      `Net profit actual: $${netProfit.toFixed(2)}.`
    )
  }

  if (netMargin !== null && netMargin < 10) {
    blockReasons.push(
      "Bloqueado porque el margen es menor al 10%."
    )
    profitReasons.push(
      `Margen neto actual: ${netMargin.toFixed(2)}%.`
    )
  }

  if (
    costBreakdown.total_estimated_cost >=
    costBreakdown.sale_price
  ) {
    profitReasons.push(
      "El precio de venta no cubre el costo total estimado."
    )
  }

  if (
    costBreakdown.shipping_cost >
    costBreakdown.luna_cost * 0.35
  ) {
    profitReasons.push(
      "El envio estimado esta afectando el margen."
    )
  }

  if (costBreakdown.shipping_review_required) {
    profitReasons.push(
      costBreakdown.shipping_note
    )
  }

  if (
    costBreakdown.scenario_without_promotion.pass_10_percent_margin &&
    !costBreakdown.scenario_with_max_promotion.pass_10_percent_margin
  ) {
    profitReasons.push(
      "Sin promocion pasa minimo, pero con promocion 5% queda debil."
    )
  }

  if (
    !costBreakdown.scenario_with_max_promotion.pass_10_percent_margin
  ) {
    profitReasons.push(
      "Con promocion 5%, el producto no alcanza 10% de margen."
    )
  }

  if (missingData.length > 0) {
    blockReasons.push(
      "Bloqueado o pendiente porque faltan datos requeridos."
    )
  }

  if (compliance?.overall_status === "blocked") {
    blockReasons.push(
      "Bloqueado por riesgo compliance."
    )
  }

  const complianceReasons =
    complianceMessages(compliance)

  if (complianceReasons.length > 0) {
    blockReasons.push(
      ...complianceReasons
    )
  }

  if (!priceIntelligence) {
    marketPriceReasons.push(
      "Falta evidencia de precio de mercado. Recomendado: buscar en Terapeak/eBay Research antes de decidir."
    )
  } else if (
    landedEvidence.competitor_landed_price !== null
  ) {
    marketPriceReasons.push(
      `Comparar contra total comprador: item $${(landedEvidence.competitor_item_price || 0).toFixed(2)} + envio $${(landedEvidence.competitor_shipping_price || 0).toFixed(2)} = $${landedEvidence.competitor_landed_price.toFixed(2)}.`
    )

    if (!market.has_sold_evidence) {
      marketPriceReasons.push(
        "Precio activo observado; validar ventas reales en Terapeak/eBay Research."
      )
    }

    if (
      landedEvidence.shipping_strategy === "high_shipping"
    ) {
      marketPriceReasons.push(
        "Competidor usa envio alto; validar ventas reales antes de copiar esa estrategia."
      )
    }
  } else if (!market.has_sold_evidence) {
    marketPriceReasons.push(
      "Solo hay precios activos; usarlos como senal de competencia, no como demanda confirmada."
    )
  } else if (isTargetPriceCompetitive) {
    marketPriceReasons.push(
      "El precio sugerido esta dentro del rango de mercado o cerca de ventas reales."
    )
  } else {
    marketPriceReasons.push(
      "El precio necesario para profit esta por encima del mercado; no competitivo."
    )
  }

  let decisionLabel =
    state

  let recommendedNextAction =
    "monitor"

  if (!priceIntelligence) {
    decisionLabel =
      "NEEDS_PRICE_DATA"
    recommendedNextAction =
      "add_price_intelligence"
  } else if (
    state === "BLOCKED" &&
    isTargetPriceCompetitive
  ) {
    decisionLabel =
      "NEEDS_REVIEW"
    recommendedNextAction =
      "adjust_target_price"
  } else if (
    state === "BLOCKED" &&
    priceIntelligence?.recommended_sale_price
  ) {
    decisionLabel =
      "NEEDS_REVIEW"
    recommendedNextAction =
      "reprocess_with_price_intelligence"
  } else if (state === "BLOCKED") {
    decisionLabel =
      "BLOCKED"
    recommendedNextAction =
      "discard"
  } else if (
    state === "VALIDATED" &&
    market.has_sold_evidence &&
    netMargin !== null &&
    netMargin >= 15
  ) {
    decisionLabel =
      "STRONG_CANDIDATE"
    recommendedNextAction =
      "monitor"
  } else if (state === "VALIDATED") {
    decisionLabel =
      "VALIDATED"
    recommendedNextAction =
      "monitor"
  }

  const humanSummary =
    state === "BLOCKED"
      ? `Esta bloqueado porque a $${toNumber(profitScenario?.estimated_sale_price)?.toFixed(2) || "0.00"} el profit/margen no cumplen o faltan datos. Para lograr 10% de margen neto necesita vender cerca de $${targetPrice.suggested_target_price?.toFixed(2) || "0.00"}.`
      : state === "VALIDATED"
        ? "El producto pasa las reglas actuales; revisar que la evidencia de mercado respalde el precio."
        : "El producto requiere revision de datos antes de decidir."

  return {
    decision_label:
      decisionLabel,
    human_summary:
      humanSummary,
    block_reasons:
      blockReasons,
    missing_data:
      missingData,
    profit_reasons:
      profitReasons,
    market_price_reasons:
      marketPriceReasons,
    target_price: {
      current_sale_price:
        toNumber(
          profitScenario?.estimated_sale_price
        ),
      current_net_profit:
        netProfit,
      current_net_margin_percent:
        netMargin,
      minimum_price_for_10_percent_margin:
        targetPrice.minimum_price_for_10_percent_margin,
      suggested_target_price:
        targetPrice.suggested_target_price,
      ideal_target_price:
        targetPrice.ideal_target_price,
      is_target_price_competitive:
        isTargetPriceCompetitive,
      market_reference_price:
        marketForCompetitiveness.market_reference_price,
      market_reference_source:
        marketForCompetitiveness.market_reference_source,
      market_confidence:
        market.market_confidence,
      competitor_item_price:
        landedEvidence.competitor_item_price,
      competitor_shipping_price:
        landedEvidence.competitor_shipping_price,
      competitor_landed_price:
        landedEvidence.competitor_landed_price,
      shipping_strategy:
        landedEvidence.shipping_strategy,
    },
    cost_breakdown:
      costBreakdown,
    recommended_next_action:
      recommendedNextAction,
  }
}
