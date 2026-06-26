import {
  calculateEbayFee,
  resolveEbayFeeRule,
} from "./core.mjs"
import {
  evaluateStockRotationRisk,
} from "./stock-risk-guardrail.mjs"

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

function uniqueStrings(values) {
  return [
    ...new Set(
      values.filter(Boolean)
    ),
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
        if (finding.code === "margin_below_minimum") {
          return ""
        }

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
  buyerShippingCharge,
  lunaCost,
  shippingCost,
  fulfillmentCost,
  packagingCost,
  ebayFeePercent,
  ebayFixedOrderFee,
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

  const totalRevenue =
    roundMoney(
      salePrice +
        buyerShippingCharge
    )

  const ebayFeeAmount =
    calculateEbayFee(
      totalRevenue,
      {
        final_value_fee_percent:
          ebayFeePercent,
        fixed_order_fee:
          ebayFixedOrderFee,
      }
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
      totalRevenue - totalEstimatedCost
    )

  const netMarginPercent =
    totalRevenue > 0
      ? roundMoney(
          (netProfit / totalRevenue) * 100
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
    packagingCost +
    ebayFixedOrderFee

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
    buyer_shipping_charge:
      buyerShippingCharge,
    total_revenue:
      totalRevenue,
    luna_cost:
      lunaCost,
    shipping_cost:
      safeShippingCost,
    ebay_fee_percent:
      ebayFeePercent,
    ebay_fixed_fee:
      ebayFixedOrderFee,
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

  const buyerShippingCharge =
    (
      toNumber(
        profitScenario?.buyer_shipping_charge
      ) ??
      toNumber(
        assumptions.buyer_shipping_charge
      )
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

  const totalRevenue =
    roundMoney(
      salePrice +
        buyerShippingCharge
    )

  const ebayFeeRule =
    resolveEbayFeeRule(
      candidate,
      totalRevenue,
      assumptions
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
    buyerShippingCharge,
    lunaCost,
    shippingCost,
    fulfillmentCost,
    packagingCost,
    ebayFeePercent:
      ebayFeeRule.final_value_fee_percent,
    ebayFixedOrderFee:
      ebayFeeRule.fixed_order_fee,
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
    supplier_unit_cost:
      lunaCost,
    supplier_model:
      profitScenario?.supplier_model ||
      assumptions.supplier_model ||
      "luna_as_supplier",
    fulfillment_cost_source:
      profitScenario?.fulfillment_cost_source ||
      assumptions.fulfillment_cost_source,
    packaging_cost_source:
      profitScenario?.packaging_cost_source ||
      assumptions.packaging_cost_source,
    operating_cost_note:
      profitScenario?.operating_cost_note ||
      assumptions.operating_cost_note,
    sale_price_basis:
      assumptions.sale_price_basis ||
      assumptions.sale_price_source ||
      (
        candidate?.current_listing_price
          ? "current_listing_price"
          : "evaluated_sale_price"
      ),
    shipping_source:
      getCandidateShippingSource(candidate),
    ebay_fee_source:
      ebayFeeRule.fee_source,
    ebay_fee_confidence:
      ebayFeeRule.confidence,
    ebay_category_group:
      ebayFeeRule.category_group,
    ebay_category_match:
      ebayFeeRule.category_match,
    ebay_category_confirmed:
      ebayFeeRule.category_confirmed,
    insertion_fee:
      ebayFeeRule.insertion_fee,
    insertion_fee_after_free_allowance:
      ebayFeeRule.insertion_fee_after_free_allowance,
    free_listing_allowance:
      ebayFeeRule.free_listing_allowance,
    insertion_fee_assumption:
      `Insertion fee no aplicado. Primeros ${ebayFeeRule.free_listing_allowance} anuncios pueden ser gratis; despues $${ebayFeeRule.insertion_fee_after_free_allowance.toFixed(2)}.`,
    ebay_fee_note:
      ebayFeeRule.notes,
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

function getConsumableSignal(candidate) {
  const text =
    [
      candidate?.title,
      candidate?.product_type,
      candidate?.brand,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()

  const consumableTerms = [
    "shampoo",
    "soap",
    "jabon",
    "deodorant",
    "desodorante",
    "razor",
    "rasuradora",
    "refill",
    "repuesto",
    "floss",
    "hilo dental",
    "toothbrush",
    "cepillo",
    "filter",
    "filtro",
    "cleaner",
    "limpieza",
    "cream",
    "crema",
    "hygiene",
    "higiene",
  ]

  return consumableTerms.some(term =>
    text.includes(term)
  )
}

function hasPackCandidateSignal(candidate, costBreakdown) {
  const inventoryScope =
    getInventoryScope(candidate)

  if (
    inventoryScope &&
    inventoryScope !== "variant_level"
  ) {
    return false
  }

  const lunaCost =
    toNumber(
      costBreakdown?.luna_cost
    ) || 0

  const shippingCost =
    toNumber(
      costBreakdown?.shipping_cost
    ) || 0

  const stock =
    getCandidateStockQuantity(candidate)

  const shippingHigh =
    lunaCost > 0 &&
    (
      shippingCost >= lunaCost ||
      shippingCost / (lunaCost + shippingCost) >= 0.35
    )

  const enoughStockForPack =
    stock !== null &&
    stock >= 3

  return enoughStockForPack &&
    (
      shippingHigh ||
      getConsumableSignal(candidate)
    )
}

function getCandidateStockQuantity(candidate) {
  return toNumber(
    candidate?.confirmed_stock ??
      candidate?.confirmedStock ??
      candidate?.stock_confirmed ??
      candidate?.stockConfirmed ??
      candidate?.inventory_quantity ??
      candidate?.inventoryQuantity ??
      candidate?.inventory_context?.inventory_quantity ??
      candidate?.inventoryContext?.inventoryQuantity ??
      candidate?.normalized_payload?.inventory_quantity ??
      candidate?.normalized_payload?.inventory_context?.inventory_quantity ??
      candidate?.normalized_payload?.stock ??
      candidate?.source_payload?.inventory_quantity ??
      candidate?.source_payload?.inventory_context?.inventory_quantity ??
      candidate?.source_payload?.raw?.inventory_context?.inventory_quantity ??
      candidate?.stock ??
      candidate?.quantity ??
      candidate?.available_quantity ??
      candidate?.availableQuantity ??
      candidate?.on_hand ??
      candidate?.onHand
  )
}

function getInventoryScope(candidate) {
  return (
    candidate?.inventory_scope ||
    candidate?.inventory_context?.inventory_scope ||
    candidate?.inventoryContext?.inventoryScope ||
    candidate?.normalized_payload?.inventory_scope ||
    candidate?.normalized_payload?.inventory_context?.inventory_scope ||
    candidate?.source_payload?.inventory_scope ||
    candidate?.source_payload?.inventory_context?.inventory_scope ||
    candidate?.source_payload?.raw?.inventory_context?.inventory_scope ||
    null
  )
}

function getInventoryConfidence(candidate) {
  return (
    candidate?.inventory_confidence ||
    candidate?.inventory_context?.inventory_confidence ||
    candidate?.inventoryContext?.inventoryConfidence ||
    candidate?.normalized_payload?.inventory_confidence ||
    candidate?.normalized_payload?.inventory_context?.inventory_confidence ||
    candidate?.source_payload?.inventory_confidence ||
    candidate?.source_payload?.inventory_context?.inventory_confidence ||
    candidate?.source_payload?.raw?.inventory_context?.inventory_confidence ||
    null
  )
}

function getMinimumPriceForCampaign(costBreakdown, promotionPercent) {
  const scenario =
    calculateCostScenario({
      salePrice:
        toNumber(
          costBreakdown?.sale_price
        ) || 0,
      buyerShippingCharge:
        toNumber(
          costBreakdown?.buyer_shipping_charge
        ) || 0,
      lunaCost:
        toNumber(
          costBreakdown?.luna_cost
        ) || 0,
      shippingCost:
        toNumber(
          costBreakdown?.shipping_cost
        ) || 0,
      fulfillmentCost:
        toNumber(
          costBreakdown?.fulfillment_cost
        ) || 0,
      packagingCost:
        toNumber(
          costBreakdown?.packaging_cost
        ) || 0,
      ebayFeePercent:
        toNumber(
          costBreakdown?.ebay_fee_percent
        ) || 0,
      ebayFixedOrderFee:
        toNumber(
          costBreakdown?.ebay_fixed_fee
        ) ?? 0.3,
      paymentFeePercent:
        toNumber(
          costBreakdown?.payment_fee_percent
        ) || 0,
      promotionPercent,
      returnReservePercent:
        toNumber(
          costBreakdown?.return_reserve_percent
        ) || 0,
      targetMarginPercent:
        toNumber(
          costBreakdown?.minimum_target_margin_percent
        ) || 10,
    })

  return scenario.minimum_price_for_10_percent_margin
}

function getCampaignScenario(costBreakdown, promotionPercent) {
  return calculateCostScenario({
    salePrice:
      toNumber(
        costBreakdown?.sale_price
      ) || 0,
    buyerShippingCharge:
      toNumber(
        costBreakdown?.buyer_shipping_charge
      ) || 0,
    lunaCost:
      toNumber(
        costBreakdown?.luna_cost
      ) || 0,
    shippingCost:
      toNumber(
        costBreakdown?.shipping_cost
      ) || 0,
    fulfillmentCost:
      toNumber(
        costBreakdown?.fulfillment_cost
      ) || 0,
    packagingCost:
      toNumber(
        costBreakdown?.packaging_cost
      ) || 0,
    ebayFeePercent:
      toNumber(
        costBreakdown?.ebay_fee_percent
      ) || 0,
    ebayFixedOrderFee:
      toNumber(
        costBreakdown?.ebay_fixed_fee
      ) ?? 0.3,
    paymentFeePercent:
      toNumber(
        costBreakdown?.payment_fee_percent
      ) || 0,
    promotionPercent,
    returnReservePercent:
      toNumber(
        costBreakdown?.return_reserve_percent
      ) || 0,
    targetMarginPercent:
      toNumber(
        costBreakdown?.minimum_target_margin_percent
      ) || 10,
  })
}

function hasReliableMarketConfidence(marketReference) {
  const confidence =
    typeof marketReference?.market_confidence === "string"
      ? marketReference.market_confidence.toLowerCase()
      : null

  return confidence !== "low"
}

function hasListingBehaviorEvidence(candidate) {
  const behavior =
    candidate?.listing_behavior ||
    candidate?.listing_metrics ||
    candidate?.performance_metrics ||
    candidate?.ebay_listing_metrics ||
    candidate?.raw?.listing_behavior ||
    candidate?.raw?.listing_metrics ||
    null

  const metrics =
    behavior && typeof behavior === "object"
      ? behavior
      : candidate || {}

  const orders =
    toNumber(metrics?.orders) ??
    toNumber(metrics?.sales) ??
    toNumber(metrics?.conversions) ??
    0

  if (orders > 0) {
    return true
  }

  const daysLive =
    toNumber(metrics?.days_live) ??
    toNumber(metrics?.live_days) ??
    0

  if (daysLive < 2) {
    return false
  }

  const positiveSignals = [
    "impressions",
    "views",
    "clicks",
    "watchers",
    "watch_count",
  ]

  return positiveSignals.some(key =>
    (toNumber(metrics?.[key]) ?? 0) > 0
  )
}

export function getPricingStrategyRecommendation({
  candidate,
  profitScenario,
  priceIntelligence,
  costBreakdown,
  market,
  isTargetPriceCompetitive,
  multipackAdvisor,
}) {
  const safeCostBreakdown =
    costBreakdown ||
    calculateCostBreakdown(
      candidate,
      profitScenario
    )

  const marketReference =
    market ||
    getMarketReference(
      priceIntelligence
    )

  const hasMarketData =
    Boolean(
      priceIntelligence &&
      marketReference.market_reference_price !== null &&
      hasReliableMarketConfidence(marketReference)
    )

  const hasMarketReference =
    Boolean(
      priceIntelligence &&
      marketReference.market_reference_price !== null
    )

  const organicScenario =
    getCampaignScenario(
      safeCostBreakdown,
      0
    )

  const campaignScenarios =
    [1, 2, 3, 5].map(percent => ({
      percent,
      scenario:
        getCampaignScenario(
          safeCostBreakdown,
          percent
        ),
    }))

  const inventoryConfidence =
    candidate?.inventory_confidence ||
    candidate?.inventory_context?.inventory_confidence ||
    "unknown"

  const campaignInventoryConfirmed =
    !candidate?.inventory_scope ||
    (
      candidate.inventory_scope === "variant_level" &&
      inventoryConfidence === "high"
    )

  const maxSafeCampaign =
    campaignInventoryConfirmed
      ? campaignScenarios
        .filter(({ scenario }) =>
          scenario.net_margin_percent >= 10
        )
        .map(({ percent }) => percent)
        .sort((a, b) => b - a)[0] || 0
      : 0

  const targetPrice =
    calculateMinimumPriceForMargin(
      profitScenario
    )

  const recommendedListingPrice =
    toNumber(
      priceIntelligence?.recommended_sale_price
    ) ??
    toNumber(
      profitScenario?.estimated_sale_price
    ) ??
    safeCostBreakdown.sale_price

  const minimumProfitablePrice =
    targetPrice.minimum_price_for_10_percent_margin

  const priceAboveMarket =
    hasMarketData &&
    minimumProfitablePrice !== null &&
    marketReference.market_reference_price !== null &&
    minimumProfitablePrice >
      marketReference.market_reference_price * 1.1

  const targetCompetitive =
    isTargetPriceCompetitive ??
    isTargetCompetitive(
      targetPrice.suggested_target_price,
      marketReference
    )

  const organicPasses =
    organicScenario.net_margin_percent >= 10

  const campaignOnePasses =
    campaignScenarios.some(({ percent, scenario }) =>
      percent === 1 &&
      scenario.net_margin_percent >= 10
    )

  const campaignTwoPasses =
    campaignScenarios.some(({ percent, scenario }) =>
      percent === 2 &&
      scenario.net_margin_percent >= 10
    )

  const hasOperationalBlockers =
    candidate?.state === "NEEDS_DATA"

  const hasBehaviorEvidence =
    hasListingBehaviorEvidence(
      candidate
    )

  const campaignFinanciallySupported =
    maxSafeCampaign >= 1

  const campaignObservationRequired =
    !hasOperationalBlockers &&
    campaignFinanciallySupported &&
    !hasBehaviorEvidence

  const campaignEligible =
    !hasOperationalBlockers &&
    campaignFinanciallySupported &&
    hasBehaviorEvidence

  const packSignal =
    !organicPasses &&
    (
      multipackAdvisor?.is_multipack_candidate ||
      hasPackCandidateSignal(
        candidate,
        safeCostBreakdown
      )
    )

  let launchStrategy =
    "needs_market_data"

  let reason =
    "Validar Terapeak/eBay Research antes de publicar."

  let proposedNextStep =
    "Agregar evidencia de precio USA domestico antes de decidir."

  let riskLevel =
    "medium"

  if (candidate?.state === "NEEDS_DATA") {
    launchStrategy =
      "needs_data"
    reason =
      !hasMarketReference
        ? "Falta precio de mercado. No hay precio comercial recomendado todavia."
        : organicPasses
        ? "Producto prometedor con precio de mercado estimado, pero pendiente de datos operativos antes de publicar."
        : "Completar datos operativos y ajustar precio antes de publicar."
    proposedNextStep =
      !hasMarketReference
        ? "Agregar Price Intelligence y completar peso/dimensiones, imagenes autorizadas y categoria final."
        : "Completar peso/dimensiones, imagenes autorizadas y categoria final antes de preparar listing."
    riskLevel =
      organicPasses
        ? "medium"
        : "high"
  } else if (!hasMarketData) {
    launchStrategy =
      "needs_market_data"
    if (
      priceIntelligence &&
      marketReference.market_reference_price !== null
    ) {
      reason =
        "Price Intelligence existe, pero requiere validacion de mercado mas fuerte."
      proposedNextStep =
        "Validar mas comparables vendidos en Terapeak/eBay Research antes de publicar."
    }
  } else if (priceAboveMarket) {
    launchStrategy =
      "blocked"
    reason =
      "Bloqueado como unidad: precio rentable por encima del mercado."
    proposedNextStep =
      "No listar como unidad; revisar costo, precio o estrategia de pack."
    riskLevel =
      "high"
  } else if (packSignal) {
    launchStrategy =
      "pack_candidate"
    reason =
      "Como unidad no conviene; evaluar pack de 3, 6 o 12."
    proposedNextStep =
      "Simular multipack y validar demanda en Terapeak/eBay Research."
    riskLevel =
      "medium"
  } else if (!organicPasses) {
    launchStrategy =
      "needs_price_adjustment"
    reason =
      "El precio evaluado actual no alcanza margen minimo como unidad."
    proposedNextStep =
      targetPrice.suggested_target_price
        ? "Reevaluar con el precio sugerido o con Price Intelligence antes de decidir."
        : "Ajustar precio o buscar mejor evidencia de mercado antes de publicar."
    riskLevel =
      "high"
  } else if (
    organicPasses &&
    !campaignOnePasses &&
    !campaignTwoPasses
  ) {
    launchStrategy =
      "organic_only_no_campaign"
    reason =
      "No recomiendo campana todavia; el margen no la soporta."
    proposedNextStep =
      "Listar solo organico si el listing cumple el resto de controles."
    riskLevel =
      "medium"
  } else if (
    organicPasses &&
    targetCompetitive &&
    campaignOnePasses &&
    campaignTwoPasses &&
    maxSafeCampaign <= 2 &&
    hasBehaviorEvidence
  ) {
    launchStrategy =
      "list_with_small_campaign"
    reason =
      "El listing ya tiene comportamiento observado y margen para campana pequena si necesita visibilidad."
    proposedNextStep =
      "Campana pequena posible: 1%-2% con aprobacion humana."
    riskLevel =
      "medium"
  } else if (
    organicPasses &&
    targetCompetitive
  ) {
    launchStrategy =
      "list_organic"
    reason =
      "Listar organico primero. Producto rentable y competitivo."
    proposedNextStep =
      campaignObservationRequired
        ? "Medir impresiones, clicks, watchers y conversion antes de invertir en promocion."
        : "Preparar listing organico y monitorear antes de promocionar."
    riskLevel =
      "low"
  }

  return {
    launch_strategy:
      launchStrategy,
    recommended_listing_price:
      recommendedListingPrice,
    listing_price_role:
      hasMarketData &&
      !hasOperationalBlockers &&
      organicPasses &&
      targetCompetitive
        ? "commercial_recommendation"
        : "temporary_evaluation",
    listing_price_note:
      hasMarketData &&
      !hasOperationalBlockers &&
      organicPasses &&
      targetCompetitive
        ? "Precio comercial estimado con evidencia de mercado."
        : hasOperationalBlockers && hasMarketData
        ? "Precio evaluado con evidencia de mercado, pero no accionable hasta completar datos operativos. No usar como precio de publicacion hasta cerrar los datos faltantes."
        : hasOperationalBlockers
        ? "Precio evaluado temporal. No usar como precio de publicacion hasta tener mercado y completar datos operativos."
        : "Precio evaluado temporal. No usar como precio de publicacion hasta tener mercado y margen positivo.",
    minimum_profitable_price:
      minimumProfitablePrice,
    minimum_price_with_1_percent_campaign:
      getMinimumPriceForCampaign(
        safeCostBreakdown,
        1
      ),
    minimum_price_with_2_percent_campaign:
      getMinimumPriceForCampaign(
        safeCostBreakdown,
        2
      ),
    minimum_price_with_3_percent_campaign:
      getMinimumPriceForCampaign(
        safeCostBreakdown,
        3
      ),
    minimum_price_with_5_percent_campaign:
      getMinimumPriceForCampaign(
        safeCostBreakdown,
        5
      ),
    campaign_eligible:
      campaignEligible,
    campaign_financially_supported:
      campaignFinanciallySupported,
    campaign_observation_required:
      campaignObservationRequired,
    campaign_observation_note:
      campaignObservationRequired
        ? "El margen soporta campana, pero primero hay que observar el comportamiento del listing."
        : null,
    max_safe_campaign_percent:
      maxSafeCampaign,
    reason,
    evidence: [
      `Organic margin: ${organicScenario.net_margin_percent.toFixed(2)}%.`,
      `Max safe campaign: ${maxSafeCampaign}%.`,
      marketReference.market_reference_price !== null
        ? `USA market reference: $${marketReference.market_reference_price.toFixed(2)}.`
        : "No USA market reference.",
    ],
    risk_level:
      riskLevel,
    required_human_approval:
      true,
    proposed_next_step:
      proposedNextStep,
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

  const ebayFixedOrderFee =
    (
      toNumber(assumptions.ebay_fixed_fee) ??
      toNumber(assumptions.ebayFixedOrderFee) ??
      0
    )

  const fixedCosts =
    roundMoney(
      lunaCost +
      shipping +
      fulfillment +
      packaging +
      ebayFixedOrderFee
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

  const landedEvidence =
    getLandedPriceEvidence(
      priceIntelligence
    )

  const domesticLandedPrice =
    landedEvidence.shipping_scope === "us_domestic"
      ? landedEvidence.competitor_domestic_landed_price
      : null

  return {
    market_reference_price:
      soldMedian ??
      soldAvg ??
      domesticLandedPrice ??
      activeAvg,
    market_reference_source:
      soldMedian !== null
        ? "sold_median_price"
        : soldAvg !== null
          ? "sold_avg_price"
          : domesticLandedPrice !== null
            ? "competitor_domestic_landed_price"
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
  const emptyEvidence = {
    shipping_scope:
      "unknown",
    buyer_location_country:
      null,
    competitor_item_price:
      null,
    competitor_shipping_price:
      null,
    competitor_landed_price:
      null,
    competitor_domestic_shipping_price:
      null,
    competitor_domestic_landed_price:
      null,
    competitor_international_shipping_price:
      null,
    competitor_international_landed_price:
      null,
    shipping_strategy:
      "unknown",
    domestic_free_shipping:
      false,
  }

  if (!priceIntelligence) {
    return emptyEvidence
  }

  const rawPayload =
    priceIntelligence.raw_payload &&
    typeof priceIntelligence.raw_payload === "object" &&
    !Array.isArray(priceIntelligence.raw_payload)
      ? priceIntelligence.raw_payload
      : {}

  const scopedPayload =
    rawPayload.shipping_scope_evidence &&
    typeof rawPayload.shipping_scope_evidence === "object" &&
    !Array.isArray(rawPayload.shipping_scope_evidence)
      ? rawPayload.shipping_scope_evidence
      : null

  const landedPayload =
    scopedPayload ||
    (
      rawPayload.landed_price_evidence &&
      typeof rawPayload.landed_price_evidence === "object" &&
      !Array.isArray(rawPayload.landed_price_evidence)
        ? rawPayload.landed_price_evidence
        : null
    )

  if (!landedPayload) {
    return emptyEvidence
  }

  const rawShippingScope =
    typeof landedPayload.shipping_scope === "string"
      ? landedPayload.shipping_scope
      : "unknown"

  const shippingScope =
    [
      "us_domestic",
      "international",
      "unknown",
    ].includes(rawShippingScope)
      ? rawShippingScope
      : "unknown"

  const itemPrice =
    toNumber(
      landedPayload.competitor_item_price
    )

  const legacyShippingPrice =
    toNumber(
      landedPayload.competitor_shipping_price
    )

  const legacyLandedPrice =
    toNumber(
      landedPayload.competitor_landed_price
    )

  const domesticShippingPrice =
    toNumber(
      landedPayload.competitor_domestic_shipping_price
    ) ??
    (
      shippingScope === "us_domestic"
        ? legacyShippingPrice
        : null
    )

  const internationalShippingPrice =
    toNumber(
      landedPayload.competitor_international_shipping_price
    ) ??
    (
      shippingScope === "international"
        ? legacyShippingPrice
        : null
    )

  const domesticLandedPrice =
    toNumber(
      landedPayload.competitor_domestic_landed_price
    ) ??
    (
      shippingScope === "us_domestic" &&
      legacyLandedPrice !== null
        ? legacyLandedPrice
        : (
          shippingScope === "us_domestic" ||
          toNumber(
            landedPayload.competitor_domestic_shipping_price
          ) !== null
        ) &&
          (
            itemPrice !== null ||
            domesticShippingPrice !== null
          )
          ? roundMoney(
              (itemPrice || 0) +
                (domesticShippingPrice || 0)
            )
          : null
    )

  const internationalLandedPrice =
    toNumber(
      landedPayload.competitor_international_landed_price
    ) ??
    (
      shippingScope === "international" &&
      legacyLandedPrice !== null
        ? legacyLandedPrice
        : itemPrice !== null ||
          internationalShippingPrice !== null
          ? roundMoney(
              (itemPrice || 0) +
                (internationalShippingPrice || 0)
            )
          : null
    )

  const competitorShippingPrice =
    shippingScope === "us_domestic"
      ? domesticShippingPrice
      : shippingScope === "international"
        ? internationalShippingPrice
        : legacyShippingPrice

  const competitorLandedPrice =
    shippingScope === "us_domestic"
      ? domesticLandedPrice
      : shippingScope === "international"
        ? internationalLandedPrice
        : legacyLandedPrice

  const inferredStrategy =
    domesticShippingPrice === null
      ? "unknown"
      : domesticShippingPrice === 0
        ? "free_shipping"
        : itemPrice !== null &&
          domesticShippingPrice >= itemPrice * 0.75
          ? "high_shipping"
          : "paid_shipping"

  return {
    shipping_scope:
      shippingScope,
    buyer_location_country:
      typeof landedPayload.buyer_location_country === "string"
        ? landedPayload.buyer_location_country
        : null,
    competitor_item_price:
      itemPrice,
    competitor_shipping_price:
      competitorShippingPrice,
    competitor_landed_price:
      competitorLandedPrice,
    competitor_domestic_shipping_price:
      domesticShippingPrice,
    competitor_domestic_landed_price:
      domesticLandedPrice,
    competitor_international_shipping_price:
      internationalShippingPrice,
    competitor_international_landed_price:
      internationalLandedPrice,
    shipping_strategy:
      typeof landedPayload.shipping_strategy === "string"
        ? landedPayload.shipping_strategy
        : inferredStrategy,
    domestic_free_shipping:
      domesticShippingPrice === 0,
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
    return targetPrice <= market.sold_max_price * 1.1
  }

  if (market.market_reference_price !== null) {
    return targetPrice <=
      market.market_reference_price * 1.1
  }

  return false
}

function calculateSupplierStrategy({
  costBreakdown,
  netProfit,
  netMargin,
  minimumMarginPercent,
  hasMarketDemand,
}) {
  const totalRevenue =
    toNumber(costBreakdown?.total_revenue) || 0

  const variableRate =
    (
      (toNumber(costBreakdown?.ebay_fee_percent) || 0) +
      (toNumber(costBreakdown?.payment_fee_percent) || 0) +
      (toNumber(costBreakdown?.promotion_percent) || 0) +
      (toNumber(costBreakdown?.return_reserve_percent) || 0)
    ) / 100

  const fixedNonSupplierCosts =
    (toNumber(costBreakdown?.shipping_cost) || 0) +
    (toNumber(costBreakdown?.fulfillment_cost) || 0) +
    (toNumber(costBreakdown?.packaging_cost) || 0) +
    (toNumber(costBreakdown?.ebay_fixed_fee) || 0)

  const maxSupplierLandedCost =
    totalRevenue > 0
      ? roundMoney(
          totalRevenue *
            (
              1 -
              variableRate -
              minimumMarginPercent / 100
            ) -
            fixedNonSupplierCosts
        )
      : null

  const currentSupplierLandedCost =
    toNumber(costBreakdown?.luna_cost)

  const profitGap =
    maxSupplierLandedCost !== null &&
    currentSupplierLandedCost !== null
      ? roundMoney(
          currentSupplierLandedCost -
            maxSupplierLandedCost
        )
      : null

  const supplierStrategy =
    hasMarketDemand &&
    (
      netProfit === null ||
      netProfit <= 0 ||
      (
        netMargin !== null &&
        netMargin < minimumMarginPercent
      )
    )
      ? "find_better_supplier"
      : hasMarketDemand
        ? "test_with_current_supplier"
        : "validate_market_before_supplier_change"

  return {
    supplier_model:
      "luna_as_supplier",
    current_supplier:
      "Luna Portex",
    current_supplier_landed_cost:
      currentSupplierLandedCost,
    max_supplier_landed_cost:
      maxSupplierLandedCost,
    profit_gap:
      profitGap !== null && profitGap > 0
        ? profitGap
        : 0,
    supplier_strategy:
      supplierStrategy,
    note:
      "Proveedor actual: Luna Portex. Este costo no es precio de venta eBay.",
  }
}

function getScenarioInputValue({
  candidate,
  profitScenario,
  assumptions,
  key,
}) {
  return (
    assumptions?.[key] ??
    profitScenario?.[key] ??
    candidate?.[key] ??
    null
  )
}

function getScenarioInputNumber(input, key) {
  return toNumber(
    getScenarioInputValue({
      ...input,
      key,
    })
  )
}

function hasScenarioInput(input, key) {
  const value =
    getScenarioInputValue({
      ...input,
      key,
    })

  return value !== null &&
    value !== undefined &&
    value !== ""
}

function calculateMaxSupplierLandedCost({
  totalRevenue,
  ebayFeePercent,
  paymentFeePercent,
  promotionPercent,
  returnReservePercent,
  shippingCost,
  fulfillmentCost,
  packagingCost,
  ebayFixedOrderFee,
  targetMarginPercent,
}) {
  const revenue =
    toNumber(totalRevenue) || 0

  if (revenue <= 0) {
    return null
  }

  const variableRate =
    (
      (toNumber(ebayFeePercent) || 0) +
      (toNumber(paymentFeePercent) || 0) +
      (toNumber(promotionPercent) || 0) +
      (toNumber(returnReservePercent) || 0) +
      (toNumber(targetMarginPercent) || 0)
    ) / 100

  const fixedNonSupplierCosts =
    (toNumber(shippingCost) || 0) +
    (toNumber(fulfillmentCost) || 0) +
    (toNumber(packagingCost) || 0) +
    (toNumber(ebayFixedOrderFee) || 0)

  return roundMoney(
    revenue *
      (1 - variableRate) -
      fixedNonSupplierCosts
  )
}

function buildSupplierScenario({
  supplierModel,
  label,
  supplierLandedCost,
  fulfillmentCost,
  packagingCost,
  shippingCost,
  sharedInput,
  missingInputs = [],
  recommendation,
  sellerNote,
}) {
  const maxSupplierLandedCost =
    calculateMaxSupplierLandedCost({
      ...sharedInput,
      shippingCost,
      fulfillmentCost,
      packagingCost,
    })

  const profitGap =
    maxSupplierLandedCost !== null &&
    supplierLandedCost !== null
      ? roundMoney(
          supplierLandedCost -
            maxSupplierLandedCost
        )
      : null

  if (missingInputs.length > 0 || supplierLandedCost === null) {
    return {
      supplier_model:
        supplierModel,
      label,
      supplier_landed_cost:
        supplierLandedCost,
      fulfillment_cost:
        fulfillmentCost,
      shipping_cost:
        shippingCost,
      total_estimated_cost:
        null,
      net_profit:
        null,
      net_margin_percent:
        null,
      max_supplier_landed_cost:
        maxSupplierLandedCost,
      profit_gap:
        profitGap,
      missing_inputs:
        uniqueStrings(missingInputs),
      recommendation:
        "Datos insuficientes para comparar con confianza.",
      seller_note:
        sellerNote,
    }
  }

  const scenario =
    calculateCostScenario({
      ...sharedInput,
      lunaCost:
        supplierLandedCost,
      fulfillmentCost:
        fulfillmentCost || 0,
      packagingCost:
        packagingCost || 0,
      shippingCost:
        shippingCost || 0,
    })

  return {
    supplier_model:
      supplierModel,
    label,
    supplier_landed_cost:
      supplierLandedCost,
    fulfillment_cost:
      fulfillmentCost,
    shipping_cost:
      shippingCost,
    total_estimated_cost:
      scenario.total_estimated_cost,
    net_profit:
      scenario.net_profit,
    net_margin_percent:
      scenario.net_margin_percent,
    max_supplier_landed_cost:
      maxSupplierLandedCost,
    profit_gap:
      profitGap,
    missing_inputs:
      [],
    recommendation:
      recommendation ||
      (
        scenario.net_margin_percent >=
        (toNumber(sharedInput.targetMarginPercent) || 10)
          ? "Con este costo, IMNOVA puede competir."
          : "El proveedor actual no deja margen suficiente. Buscar mejor proveedor antes de escalar."
      ),
    seller_note:
      sellerNote,
  }
}

function buildSupplierModelSimulatorV0({
  candidate,
  profitScenario,
  costBreakdown,
  market,
}) {
  const assumptions =
    getProfitAssumptions(profitScenario)

  const input = {
    candidate,
    profitScenario,
    assumptions,
  }

  const targetMarginPercent =
    toNumber(
      costBreakdown?.minimum_target_margin_percent
    ) || 10

  const sharedInput = {
    salePrice:
      toNumber(costBreakdown?.sale_price) || 0,
    buyerShippingCharge:
      toNumber(costBreakdown?.buyer_shipping_charge) || 0,
    totalRevenue:
      toNumber(costBreakdown?.total_revenue) || 0,
    ebayFeePercent:
      toNumber(costBreakdown?.ebay_fee_percent) || 0,
    ebayFixedOrderFee:
      toNumber(costBreakdown?.ebay_fixed_fee) || 0,
    paymentFeePercent:
      toNumber(costBreakdown?.payment_fee_percent) || 0,
    promotionPercent:
      toNumber(costBreakdown?.promotion_percent) || 0,
    returnReservePercent:
      toNumber(costBreakdown?.return_reserve_percent) || 0,
    targetMarginPercent,
  }

  const currentSupplierCost =
    toNumber(costBreakdown?.luna_cost) ??
    getScenarioInputNumber(input, "luna_cost") ??
    getScenarioInputNumber(input, "supplier_unit_cost")

  const currentFulfillmentCost =
    toNumber(costBreakdown?.fulfillment_cost) || 0

  const currentPackagingCost =
    toNumber(costBreakdown?.packaging_cost) || 0

  const currentShippingCost =
    toNumber(costBreakdown?.shipping_cost) || 0

  const currentScenario =
    buildSupplierScenario({
      supplierModel:
        "luna_as_supplier",
      label:
        "Modelo A: Luna Portex como proveedor",
      supplierLandedCost:
        currentSupplierCost,
      fulfillmentCost:
        currentFulfillmentCost,
      packagingCost:
        currentPackagingCost,
      shippingCost:
        currentShippingCost,
      sharedInput,
      missingInputs:
        currentSupplierCost === null
          ? ["supplier_unit_cost"]
          : [],
      recommendation:
        "Luna puede servir para probar demanda si el margen se mantiene.",
      sellerNote:
        "Luna puede servir para probar demanda; para escalar conviene comparar proveedor directo o mayorista.",
    })

  const directSupplierCost =
    getScenarioInputNumber(
      input,
      "direct_supplier_unit_cost"
    )

  const inboundShippingToLuna =
    getScenarioInputNumber(
      input,
      "inbound_shipping_to_luna"
    )

  const lunaReceivingFee =
    getScenarioInputNumber(
      input,
      "luna_receiving_fee"
    )

  const lunaStorageFee =
    getScenarioInputNumber(
      input,
      "luna_storage_fee"
    )

  const lunaPickPackFee =
    getScenarioInputNumber(
      input,
      "luna_pick_pack_fee"
    )

  const lunaFulfillmentFee =
    getScenarioInputNumber(
      input,
      "luna_fulfillment_fee"
    )

  const lunaOutboundShipping =
    getScenarioInputNumber(
      input,
      "luna_outbound_shipping"
    )

  const directMissingInputs = []

  if (directSupplierCost === null) {
    directMissingInputs.push(
      "direct_supplier_unit_cost"
    )
  }

  if (!hasScenarioInput(input, "inbound_shipping_to_luna")) {
    directMissingInputs.push(
      "inbound_shipping_to_luna"
    )
  }

  if (!hasScenarioInput(input, "moq")) {
    directMissingInputs.push("moq")
  }

  if (!hasScenarioInput(input, "lead_time_days")) {
    directMissingInputs.push(
      "lead_time_days"
    )
  }

  const directScenario =
    buildSupplierScenario({
      supplierModel:
        assumptions?.supplier_model ===
        "manufacturer_direct"
          ? "manufacturer_direct"
          : "direct_brand_supplier",
      label:
        "Modelo B: Proveedor directo + Luna fulfillment",
      supplierLandedCost:
        directSupplierCost === null
          ? null
          : roundMoney(
              directSupplierCost +
                (inboundShippingToLuna || 0) +
                (lunaReceivingFee || 0) +
                (lunaStorageFee || 0)
            ),
      fulfillmentCost:
        roundMoney(
          (lunaPickPackFee || 0) +
            (lunaFulfillmentFee || 0)
        ),
      packagingCost:
        0,
      shippingCost:
        lunaOutboundShipping ?? currentShippingCost,
      sharedInput,
      missingInputs:
        directMissingInputs,
      sellerNote:
        directMissingInputs.length > 0
          ? "Falta costo directo, inbound, MOQ o lead time antes de comparar."
          : "Proveedor directo puede mejorar margen si el costo landed queda bajo el maximo permitido.",
    })

  const distributorMissingInputs = []

  if (directSupplierCost === null) {
    distributorMissingInputs.push(
      "direct_supplier_unit_cost"
    )
  }

  if (!hasScenarioInput(input, "inbound_shipping_to_luna")) {
    distributorMissingInputs.push(
      "inbound_shipping_to_luna"
    )
  }

  if (!hasScenarioInput(input, "moq")) {
    distributorMissingInputs.push("moq")
  }

  if (!hasScenarioInput(input, "lead_time_days")) {
    distributorMissingInputs.push(
      "lead_time_days"
    )
  }

  const distributorScenario =
    buildSupplierScenario({
      supplierModel:
        "distributor_wholesale",
      label:
        "Modelo C: Mayorista + fulfillment",
      supplierLandedCost:
        directSupplierCost === null
          ? null
          : roundMoney(
              directSupplierCost +
                (inboundShippingToLuna || 0)
            ),
      fulfillmentCost:
        lunaFulfillmentFee ??
        currentFulfillmentCost,
      packagingCost:
        currentPackagingCost,
      shippingCost:
        lunaOutboundShipping ?? currentShippingCost,
      sharedInput,
      missingInputs:
        distributorMissingInputs,
      sellerNote:
        distributorMissingInputs.length > 0
          ? "Falta costo directo, inbound, MOQ y lead time antes de decidir proveedor."
          : "Mayorista puede servir para escalar si el MOQ y el lead time no amarran demasiado capital.",
    })

  const scenarios = [
    currentScenario,
    directScenario,
    distributorScenario,
  ]

  const hasMarketDemand =
    Boolean(
      market?.has_sold_evidence ||
      market?.market_reference_price !== null
    )

  const currentMargin =
    toNumber(currentScenario.net_margin_percent)

  const completeAlternatives =
    scenarios
      .slice(1)
      .filter(
        scenario =>
          scenario.missing_inputs.length === 0 &&
          toNumber(
            scenario.net_margin_percent
          ) !== null
      )

  const bestAlternative =
    completeAlternatives
      .sort(
        (a, b) =>
          (toNumber(b.net_margin_percent) || -999) -
          (toNumber(a.net_margin_percent) || -999)
      )[0]

  let recommendedStrategy =
    "complete_supplier_inputs"

  if (
    bestAlternative &&
    (toNumber(bestAlternative.net_margin_percent) || 0) >=
      targetMarginPercent &&
    (
      currentMargin === null ||
      (toNumber(bestAlternative.net_margin_percent) || 0) >
        currentMargin + 2
    )
  ) {
    recommendedStrategy =
      "scale_with_alternative_supplier"
  } else if (
    hasMarketDemand &&
    (
      currentMargin === null ||
      currentMargin < targetMarginPercent
    )
  ) {
    recommendedStrategy =
      "find_better_supplier"
  } else if (
    currentMargin !== null &&
    currentMargin >= targetMarginPercent
  ) {
    recommendedStrategy =
      "test_with_current_supplier"
  }

  const currentModel =
    costBreakdown?.supplier_model ||
    assumptions?.supplier_model ||
    "luna_as_supplier"

  const summary =
    recommendedStrategy ===
    "scale_with_alternative_supplier"
      ? "El producto puede tener demanda, pero el proveedor actual puede no ser el mejor para escalar."
      : recommendedStrategy === "find_better_supplier"
        ? "El proveedor actual no deja margen suficiente. Buscar mejor proveedor antes de escalar."
        : recommendedStrategy === "test_with_current_supplier"
          ? "Luna puede servir para probar demanda; para escalar conviene comparar proveedor directo o mayorista."
          : "Falta costo directo, MOQ y lead time antes de decidir proveedor."

  return {
    recommended_strategy:
      recommendedStrategy,
    current_model:
      currentModel,
    summary,
    scenarios,
  }
}

function buildMultipackProfitAdvisorV0({
  candidate,
  costBreakdown,
  market,
}) {
  const unitSalePrice =
    toNumber(costBreakdown?.sale_price) || 0

  const marketUnitPrice =
    toNumber(market?.market_reference_price) ||
    unitSalePrice

  const unitSupplierCost =
    toNumber(costBreakdown?.luna_cost) || 0

  const unitShippingCost =
    toNumber(costBreakdown?.shipping_cost) || 0

  const unitMargin =
    toNumber(costBreakdown?.net_margin_percent)

  const targetMarginPercent =
    toNumber(
      costBreakdown?.minimum_target_margin_percent
    ) || 10

  const shippingShare =
    unitSupplierCost + unitShippingCost > 0
      ? unitShippingCost /
        (unitSupplierCost + unitShippingCost)
      : 0

  const stock =
    getCandidateStockQuantity(candidate)

  const inventoryScope =
    getInventoryScope(candidate)

  const inventoryConfidence =
    getInventoryConfidence(candidate)

  const hasConfirmedStock =
    stock !== null &&
    stock > 0 &&
    inventoryScope === "variant_level" &&
    inventoryConfidence === "high"

  const hasConsumableSignal =
    getConsumableSignal(candidate)

  const hasPackSignal =
    unitSalePrice > 0 &&
    unitSupplierCost > 0 &&
    (
      hasConsumableSignal ||
      shippingShare >= 0.35
    )

  const missingInputs = []

  if (!hasConfirmedStock) {
    missingInputs.push(
      "confirmed_stock_quantity"
    )
  }

  if (
    !candidate?.weight &&
    !candidate?.dimensions
  ) {
    missingInputs.push(
      "weight_or_dimensions"
    )
  }

  if (!hasPackSignal) {
    return {
      recommended_strategy:
        "not_pack_candidate",
      is_multipack_candidate:
        false,
      summary:
        "El formato pack no es la primera hipotesis para este producto.",
      unit_economics_note:
        "Revisar como unidad antes de simular pack.",
      missing_inputs:
        uniqueStrings(missingInputs),
      scenarios:
        [],
    }
  }

  const packQuantities = [2, 3, 6, 12]

  const packDiscountByQuantity = {
    2: 0,
    3: 0.03,
    6: 0.05,
    12: 0.08,
  }

  const shippingMultiplierByQuantity = {
    2: 1,
    3: 1,
    6: 1.25,
    12: 1.5,
  }

  const scenarios =
    packQuantities.map(quantity => {
      const discount =
        packDiscountByQuantity[quantity] || 0

      const stockSufficient =
        hasConfirmedStock &&
        stock >= quantity

      const scenarioMissingInputs =
        uniqueStrings([
          ...missingInputs,
          ...(!stockSufficient
            ? ["stock_sufficient_for_pack"]
            : []),
        ])

      const salePrice =
        roundMoney(
          marketUnitPrice *
            quantity *
            (1 - discount)
        )

      const shippingCost =
        roundMoney(
          unitShippingCost *
            (shippingMultiplierByQuantity[quantity] || 1)
        )

      const unitPriceInPack =
        roundMoney(
          salePrice / quantity
        )

      const scenario =
        calculateCostScenario({
          salePrice,
          buyerShippingCharge:
            toNumber(costBreakdown?.buyer_shipping_charge) || 0,
          lunaCost:
            roundMoney(
              unitSupplierCost * quantity
            ),
          shippingCost,
          fulfillmentCost:
            toNumber(costBreakdown?.fulfillment_cost) || 0,
          packagingCost:
            toNumber(costBreakdown?.packaging_cost) || 0,
          ebayFeePercent:
            toNumber(costBreakdown?.ebay_fee_percent) || 0,
          ebayFixedOrderFee:
            toNumber(costBreakdown?.ebay_fixed_fee) ?? 0.3,
          paymentFeePercent:
            toNumber(costBreakdown?.payment_fee_percent) || 0,
          promotionPercent:
            toNumber(costBreakdown?.promotion_percent) || 0,
          returnReservePercent:
            toNumber(costBreakdown?.return_reserve_percent) || 0,
          targetMarginPercent,
        })

      const profitLift =
        toNumber(costBreakdown?.net_profit) !== null
          ? roundMoney(
              scenario.net_profit -
                toNumber(costBreakdown?.net_profit)
            )
          : null

      return {
        pack_quantity:
          quantity,
        label:
          `Pack de ${quantity}`,
        estimated_pack_price:
          salePrice,
        unit_price_in_pack:
          unitPriceInPack,
        unit_market_price:
          marketUnitPrice,
        buyer_discount_percent:
          roundMoney(
            discount * 100
          ),
        stock_required:
          quantity,
        stock_available:
          hasConfirmedStock
            ? stock
            : null,
        stock_sufficient:
          stockSufficient,
        supplier_cost:
          scenario.luna_cost,
        shipping_cost:
          scenario.shipping_cost,
        total_estimated_cost:
          scenario.total_estimated_cost,
        net_profit:
          scenario.net_profit,
        net_margin_percent:
          scenario.net_margin_percent,
        pass_10_percent_margin:
          scenario.pass_10_percent_margin,
        profit_lift_vs_unit:
          profitLift,
        missing_inputs:
          scenarioMissingInputs,
        status:
          !stockSufficient
            ? "blocked_insufficient_stock"
            : scenarioMissingInputs.length > 0
              ? "needs_pack_inputs"
              : scenario.pass_10_percent_margin
                ? "pack_hypothesis_viable"
                : "pack_not_profitable",
        recommendation:
          !stockSufficient
            ? "Sin stock suficiente para este pack. Confirmar cantidad real o esperar reposicion."
            : scenarioMissingInputs.length > 0
            ? "Validar cantidad, peso y comparables antes de publicar pack."
            : scenario.pass_10_percent_margin
              ? "Hipotesis de pack viable para revisar contra comparables eBay."
              : "El pack todavia no alcanza margen suficiente.",
        seller_note:
          "Simulacion, no publicacion. El pack debe ofrecer mejor precio por unidad al comprador y validarse contra comparables multipack.",
      }
    })

  const viableScenarios =
    scenarios.filter(
      scenario =>
        scenario.pass_10_percent_margin &&
        scenario.stock_sufficient &&
        scenario.missing_inputs.length === 0
    )

  const packHypotheses =
    scenarios.filter(
      scenario =>
        scenario.pass_10_percent_margin
    )

  const bestScenario =
    viableScenarios
      .sort(
        (a, b) =>
          (toNumber(b.net_margin_percent) || -999) -
          (toNumber(a.net_margin_percent) || -999)
      )[0] || null

  const bestHypothesis =
    packHypotheses
      .sort(
        (a, b) =>
          (toNumber(b.net_margin_percent) || -999) -
          (toNumber(a.net_margin_percent) || -999)
      )[0] || null

  const recommendedStrategy =
    bestScenario
      ? "evaluate_multipack_listing"
      : bestHypothesis
        ? "validate_pack_inputs"
        : unitMargin !== null &&
          unitMargin < targetMarginPercent
          ? "pack_not_enough_find_supplier"
          : "unit_first"

  const unitMarginHealthy =
    unitMargin !== null &&
    unitMargin >= targetMarginPercent

  const summary =
    bestHypothesis
      ? !hasConfirmedStock
        ? "Pack bloqueado por stock. Solo simulacion financiera hasta confirmar stock suficiente."
        : unitMarginHealthy
        ? "Unidad prometedora. El pack es solo una hipotesis adicional para revisar con datos completos."
        : "La unidad queda debil con estos datos; el pack puede ayudar a diluir el envio fijo."
      : "El pack no mejora suficiente con los datos actuales; revisar proveedor o precio."

  return {
    recommended_strategy:
      recommendedStrategy,
    is_multipack_candidate:
      Boolean(bestHypothesis),
    summary,
    unit_economics_note:
      unitMarginHealthy
        ? "Margen estimado saludable. Completar datos operativos antes de preparar listing."
        : "Producto pequeno o consumible: evaluar pack antes de descartar el proveedor.",
    missing_inputs:
      uniqueStrings(missingInputs),
    best_pack:
      bestScenario,
    best_pack_hypothesis:
      bestHypothesis,
    scenarios,
  }
}

function buildStockRotationSignal({
  candidate,
  profitScenario,
  costBreakdown,
  multipackAdvisor,
}) {
  const stock =
    getCandidateStockQuantity(candidate)

  const inventoryScope =
    getInventoryScope(candidate)

  const inventoryConfidence =
    getInventoryConfidence(candidate)

  const scenarios =
    multipackAdvisor?.scenarios || []

  const packBlockedByStock =
    scenarios.length > 0 &&
    scenarios.every(
      scenario =>
        scenario.status === "blocked_insufficient_stock" ||
        scenario.stock_sufficient === false
    )

  const hasPackViableHypothesis =
    Boolean(
      multipackAdvisor?.best_pack ||
        multipackAdvisor?.best_pack_hypothesis
    )

  const stockRisk =
    evaluateStockRotationRisk({
      ...candidate,
      confirmed_stock:
        stock,
      net_margin_percent:
        profitScenario?.net_margin_percent,
      margin_passed:
        toNumber(profitScenario?.net_margin_percent) !== null &&
        toNumber(profitScenario?.net_margin_percent) >=
          (
            toNumber(
              costBreakdown?.minimum_target_margin_percent
            ) || 10
          ),
      readiness_passed:
        candidate?.state !== "NEEDS_DATA",
      weight_passed:
        Boolean(
          candidate?.weight ||
            candidate?.dimensions
        ),
      comparables_passed:
        hasPackViableHypothesis,
      shipping_passed:
        costBreakdown?.shipping_review_required !== true,
    })

  const notes =
    Array.isArray(stockRisk.account_risk_notes)
      ? stockRisk.account_risk_notes
      : []

  const hasRotationRisk =
    notes.length > 0 ||
    stockRisk.stock_risk_level === "medium" &&
      stock !== null &&
      stock < 12

  if (stock === null) {
    return {
      status:
        "stock_unconfirmed",
      label:
        "Stock no confirmado",
      message:
        "Stock no confirmado. Validar inventario antes de preparar listing, pack o campana.",
      tone:
        "warning",
      confirmed_stock:
        null,
      inventory_scope:
        inventoryScope,
      inventory_confidence:
        inventoryConfidence,
      pack_blocked_by_stock:
        packBlockedByStock,
      campaign_blocked_by_stock:
        true,
      stock_guardrail:
        stockRisk,
    }
  }

  if (
    stock <= 0 ||
    (
      stockRisk.stock_decision === "do_not_publish" &&
      !packBlockedByStock
    )
  ) {
    return {
      status:
        "stock_insufficient",
      label:
        "Stock insuficiente",
      message:
        "Stock insuficiente. No escalar pack, campana ni listing hasta confirmar disponibilidad.",
      tone:
        "danger",
      confirmed_stock:
        stock,
      inventory_scope:
        inventoryScope,
      inventory_confidence:
        inventoryConfidence,
      pack_blocked_by_stock:
        true,
      campaign_blocked_by_stock:
        true,
      stock_guardrail:
        stockRisk,
    }
  }

  if (packBlockedByStock) {
    return {
      status:
        "pack_blocked_by_stock",
      label:
        "Pack bloqueado por stock",
      message:
        "Pack no es opcion operativa todavia por stock insuficiente.",
      tone:
        "danger",
      confirmed_stock:
        stock,
      inventory_scope:
        inventoryScope,
      inventory_confidence:
        inventoryConfidence,
      pack_blocked_by_stock:
        true,
      campaign_blocked_by_stock:
        stockRisk.blocked_actions.includes("campaign"),
      stock_guardrail:
        stockRisk,
    }
  }

  if (hasRotationRisk) {
    return {
      status:
        "rotation_risk",
      label:
        "Riesgo de rotacion",
      message:
        "Riesgo de rotacion de stock. Revisar velocidad de venta, cantidad disponible y reposicion antes de escalar.",
      tone:
        "warning",
      confirmed_stock:
        stock,
      inventory_scope:
        inventoryScope,
      inventory_confidence:
        inventoryConfidence,
      pack_blocked_by_stock:
        false,
      campaign_blocked_by_stock:
        stockRisk.blocked_actions.includes("campaign"),
      stock_guardrail:
        stockRisk,
    }
  }

  return {
    status:
      "stock_sufficient",
    label:
      "Stock suficiente",
    message:
      "Stock suficiente para revision humana. No autoriza publicacion automatica.",
    tone:
      "success",
    confirmed_stock:
      stock,
    inventory_scope:
      inventoryScope,
    inventory_confidence:
      inventoryConfidence,
    pack_blocked_by_stock:
      false,
    campaign_blocked_by_stock:
      stockRisk.blocked_actions.includes("campaign"),
    stock_guardrail:
      stockRisk,
  }
}

function buildStrategicSummary({
  state,
  netProfit,
  netMargin,
  missingData,
  targetPrice,
  market,
  costBreakdown,
  pricingStrategy,
  multipackAdvisor,
}) {
  const minimumMarginPercent =
    toNumber(
      costBreakdown?.minimum_target_margin_percent
    ) || 10

  const hasOperationalMissingData =
    missingData.length > 0 ||
    state === "NEEDS_DATA"

  const hasMarketDemand =
    Boolean(
      market?.has_sold_evidence ||
      market?.market_reference_price !== null
    )

  const marketReferencePrice =
    toNumber(
      market?.market_reference_price
    )

  const minimumProfitablePrice =
    toNumber(
      targetPrice?.minimum_price_for_10_percent_margin
    )

  const priceAboveMarket =
    minimumProfitablePrice !== null &&
    marketReferencePrice !== null &&
    minimumProfitablePrice >
      marketReferencePrice * 1.1

  const profitable =
    netProfit !== null &&
    netProfit > 0 &&
    netMargin !== null &&
    netMargin >= minimumMarginPercent

  const supplierStrategy =
    calculateSupplierStrategy({
      costBreakdown,
      netProfit,
      netMargin,
      minimumMarginPercent,
      hasMarketDemand,
    })

  if (
    hasMarketDemand &&
    !profitable &&
    multipackAdvisor?.is_multipack_candidate
  ) {
    return {
      commercial_status:
        "multipack_candidate_needs_data",
      headline:
        "Como unidad no compite; evaluar pack antes de cambiar proveedor.",
      why:
        "El envio fijo pesa demasiado en la unidad, pero un pack puede diluir ese costo.",
      recommended_action:
        "Confirmar stock, peso y comparables multipack antes de descartar el producto.",
      next_step:
        "Simular pack de 3, 6 o 12 y validar si el mercado eBay acepta ese formato.",
      risk:
        "unit_economics",
      seller_advisor_note:
        "No publiques unidad si el pack mejora margen. Primero confirma cantidad real y peso.",
      supplier_strategy:
        {
          ...supplierStrategy,
          supplier_strategy:
            "test_with_pack_before_supplier_change",
        },
    }
  }

  if (
    hasMarketDemand &&
    !profitable &&
    multipackAdvisor?.recommended_strategy ===
      "pack_not_enough_find_supplier"
  ) {
    return {
      commercial_status:
        "pack_not_enough_find_supplier",
      headline:
        "Pack evaluado, pero no salva el margen.",
      why:
        "La unidad no compite y los packs simulados siguen por debajo del margen minimo.",
      recommended_action:
        "No publicar como unidad ni como pack con el proveedor actual.",
      next_step:
        "Buscar mejor proveedor, negociar costo o descartar hasta que el mercado cambie.",
      risk:
        "supplier_cost",
      seller_advisor_note:
        "El advisor ya reviso la ruta de pack. No fuerces listing si ni unidad ni pack compiten.",
      supplier_strategy:
        {
          ...supplierStrategy,
          supplier_strategy:
            "find_better_supplier",
        },
    }
  }

  if (priceAboveMarket) {
    return {
      commercial_status:
        "blocked_as_unit",
      headline:
        "Bloqueado como unidad: el precio rentable queda por encima del mercado.",
      why:
        "El costo total exige un precio superior al rango competitivo observado.",
      recommended_action:
        "No publicar como unidad con el proveedor actual; revisar costo, pack o proveedor alternativo.",
      next_step:
        "Comparar proveedor directo o simular pack antes de preparar listing.",
      risk:
        "supplier_cost",
      seller_advisor_note:
        "No fuerces el listing si el precio necesario no compite. Busca mejor costo o cambia estrategia.",
      supplier_strategy:
        {
          ...supplierStrategy,
          supplier_strategy:
            "find_better_supplier",
        },
    }
  }

  if (
    hasMarketDemand &&
    !profitable
  ) {

    return {
      commercial_status:
        "supplier_not_competitive",
      headline:
        "Hay senal de mercado, pero el proveedor actual no deja margen suficiente.",
      why:
        "La demanda existe, pero el costo actual comprime el profit bajo los minimos.",
      recommended_action:
        "Buscar proveedor directo o renegociar costo antes de publicar.",
      next_step:
        "Calcular costo proveedor maximo y validar alternativa de abastecimiento.",
      risk:
        "supplier_cost",
      seller_advisor_note:
        "Luna puede servir para test, pero no escales si el margen depende de un costo mejor.",
      supplier_strategy:
        {
          ...supplierStrategy,
          supplier_strategy:
            "find_better_supplier",
        },
    }
  }

  if (
    profitable &&
    hasOperationalMissingData
  ) {
    return {
      commercial_status:
        "needs_operational_data",
      headline:
        "Producto prometedor, pero todavía no listo para publicar.",
      why:
        "Tiene margen estimado saludable y senal de mercado, pero faltan datos operativos.",
      recommended_action:
        "Completar peso/dimensiones, confirmar imagenes autorizadas y categoria antes de preparar listing organico.",
      next_step:
        "Completar datos faltantes y mantener campana apagada hasta observar comportamiento.",
      risk:
        "operational_data",
      seller_advisor_note:
        "No actives campana todavia. Primero valida logistica y prepara un listing organico fuerte.",
      supplier_strategy:
        supplierStrategy,
    }
  }

  if (pricingStrategy?.launch_strategy === "pack_candidate") {
    return {
      commercial_status:
        "pack_candidate",
      headline:
        "Producto mejor evaluado como pack.",
      why:
        "Como unidad el margen o shipping puede quedar debil, pero el formato multipack puede absorber costos.",
      recommended_action:
        "Simular pack de 3, 6 o 12 y validar ventas comparables.",
      next_step:
        "Recalcular costo y precio por pack antes de preparar listing.",
      risk:
        "unit_economics",
      seller_advisor_note:
        "No publiques unidad si el pack mejora margen y conversion.",
      supplier_strategy:
        supplierStrategy,
    }
  }

  if (profitable) {
    return {
      commercial_status:
        "ready_to_prepare_listing",
      headline:
        "Producto listo para preparar listing organico.",
      why:
        "Cumple minimos de profit y no tiene bloqueos operativos criticos.",
      recommended_action:
        "Preparar listing organico y monitorear antes de activar campana.",
      next_step:
        "Validar copy, imagenes, categoria final e inventario antes de enviar a borrador.",
      risk:
        "market_execution",
      seller_advisor_note:
        "La campana es opcional. Primero publica organico si el listing esta completo.",
      supplier_strategy:
        supplierStrategy,
    }
  }

  if (!hasMarketDemand) {
    return {
      commercial_status:
        "needs_price_data",
      headline:
        "Producto pendiente de precio de mercado.",
      why:
        profitable
          ? "El margen estimado parece viable, pero falta evidencia de mercado para decidir con seguridad."
          : "Con el precio evaluado actual no hay margen suficiente y todavia no existe evidencia de mercado para saber si puede venderse mas alto.",
      recommended_action:
        "Agregar Price Intelligence con precio vendido USA antes de decidir.",
      next_step:
        "Buscar comparables vendidos en Terapeak/eBay Research y reevaluar con el precio de mercado.",
      risk:
        "missing_market_price",
      seller_advisor_note:
        "No publiques ni lo marques prometedor hasta tener precio de mercado y margen positivo.",
      supplier_strategy:
        supplierStrategy,
    }
  }

  return {
    commercial_status:
      "needs_reanalysis",
    headline:
      "Producto en revision estratégica.",
    why:
      "Aun falta confirmar si el margen y los datos operativos sostienen una publicacion segura.",
    recommended_action:
      "Completar evidencia y revisar costeo antes de avanzar.",
    next_step:
      "Reevaluar con datos completos.",
    risk:
      "incomplete_evidence",
    seller_advisor_note:
      "No publiques hasta que el advisor muestre profit, mercado y datos operativos alineados.",
    supplier_strategy:
      supplierStrategy,
  }
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
    market

  const isTargetPriceCompetitive =
    isTargetCompetitive(
      targetPrice.suggested_target_price,
      marketForCompetitiveness
    )

  const multipackProfitAdvisor =
    buildMultipackProfitAdvisorV0({
      candidate,
      costBreakdown,
      market,
    })

  const stockRotationRisk =
    buildStockRotationSignal({
      candidate,
      profitScenario,
      costBreakdown,
      multipackAdvisor:
        multipackProfitAdvisor,
    })

  const pricingStrategy =
    getPricingStrategyRecommendation({
      candidate,
      profitScenario,
      priceIntelligence,
      costBreakdown,
      market,
      isTargetPriceCompetitive,
      multipackAdvisor:
        multipackProfitAdvisor,
    })

  const missingData = uniqueStrings([
    ...stringList(
      candidate?.needs_data
    ),
    ...stringList(
      validation?.missing_fields ??
        validation?.missingFields
    ),
  ])

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
      "El envio estimado pesa mucho frente al costo proveedor; validar peso/dimensiones antes de listar."
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

  if (
    missingData.includes(
      "category_or_inference_data"
    )
  ) {
    profitReasons.push(
      "La categoria final afecta el fee de eBay. Confirmar categoria antes de publicar."
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
    if (compliance?.overall_status === "blocked") {
      blockReasons.push(
        "Bloqueado por riesgo compliance."
      )
    }

    blockReasons.push(
      ...complianceReasons
    )
  }

  if (!priceIntelligence) {
    marketPriceReasons.push(
      "Falta evidencia de precio de mercado. Recomendado: buscar en Terapeak/eBay Research antes de decidir."
    )
  } else if (
    landedEvidence.competitor_domestic_landed_price !== null
  ) {
    marketPriceReasons.push(
      `Mercado USA: item $${(landedEvidence.competitor_item_price || 0).toFixed(2)} + envio domestico $${(landedEvidence.competitor_domestic_shipping_price || 0).toFixed(2)} = $${landedEvidence.competitor_domestic_landed_price.toFixed(2)}.`
    )

    if (!market.has_sold_evidence) {
      marketPriceReasons.push(
        "Precio domestico activo observado; validar ventas reales en Terapeak/eBay Research."
      )
    }

    if (
      landedEvidence.shipping_strategy === "high_shipping"
    ) {
      marketPriceReasons.push(
        "Competidor usa envio domestico alto; validar ventas reales antes de copiar esa estrategia."
      )
    }
  } else if (
    landedEvidence.competitor_international_landed_price !== null
  ) {
    marketPriceReasons.push(
      `Observacion internacional: total observado $${landedEvidence.competitor_international_landed_price.toFixed(2)}. No usar como referencia principal si vendes dentro de EE. UU.`
    )
    marketPriceReasons.push(
      "Este precio incluye envio internacional. Para competir dentro de EE. UU., valida el precio domestico/free shipping."
    )
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
  } else if (state === "NEEDS_DATA") {
    decisionLabel =
      "NEEDS_DATA"
    recommendedNextAction =
      "complete_missing_data"
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

  const lunaCost =
    toNumber(profitScenario?.luna_cost)

  const evaluatedSalePrice =
    toNumber(profitScenario?.estimated_sale_price)

  const marketReferencePrice =
    marketForCompetitiveness.market_reference_price

  const humanSummary =
    !priceIntelligence
      ? `El costo proveedor actual es $${(lunaCost || 0).toFixed(2)}. Falta precio de mercado USA; no usar el costo proveedor como precio de venta eBay.`
      : state === "BLOCKED" &&
        isTargetPriceCompetitive
        ? `Producto potencialmente viable. El costo proveedor actual es $${(lunaCost || 0).toFixed(2)}. El precio minimo para 10% margen es $${targetPrice.minimum_price_for_10_percent_margin?.toFixed(2) || "0.00"} y el mercado esta alrededor de $${marketReferencePrice?.toFixed(2) || "0.00"}. Evaluar lanzamiento cerca de $${targetPrice.suggested_target_price?.toFixed(2) || "0.00"}${landedEvidence.competitor_domestic_landed_price !== null ? `-$${landedEvidence.competitor_domestic_landed_price.toFixed(2)}` : ""}.`
        : state === "BLOCKED"
          ? `Bloqueado como unidad: el precio minimo rentable esta por encima del mercado o faltan controles criticos. El costo proveedor actual es $${(lunaCost || 0).toFixed(2)}; no se trata como precio de venta eBay.`
          : state === "VALIDATED"
            ? `Producto potencialmente viable. El costo proveedor actual es $${(lunaCost || 0).toFixed(2)} y el precio de venta evaluado es $${(evaluatedSalePrice || 0).toFixed(2)}. Revisar que la evidencia de mercado respalde el lanzamiento.`
            : "El producto requiere revision de datos antes de decidir."

  const strategicSummary =
    buildStrategicSummary({
      state,
      netProfit,
      netMargin,
      missingData,
      targetPrice,
      market,
      costBreakdown,
      pricingStrategy,
      multipackAdvisor:
        multipackProfitAdvisor,
    })

  const supplierModelSimulator =
    buildSupplierModelSimulatorV0({
      candidate,
      profitScenario,
      costBreakdown,
      market,
    })

  return {
    decision_label:
      decisionLabel,
    strategic_summary:
      strategicSummary,
    human_summary:
      humanSummary,
    block_reasons:
      uniqueStrings(blockReasons),
    missing_data:
      uniqueStrings(missingData),
    profit_reasons:
      uniqueStrings(profitReasons),
    market_price_reasons:
      uniqueStrings(marketPriceReasons),
    target_price: {
      current_sale_price:
        evaluatedSalePrice,
      evaluated_sale_price:
        evaluatedSalePrice,
      sale_price_basis:
        costBreakdown.sale_price_basis,
      supplier_unit_cost:
        lunaCost,
      luna_cost:
        lunaCost,
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
      competitor_domestic_shipping_price:
        landedEvidence.competitor_domestic_shipping_price,
      competitor_domestic_landed_price:
        landedEvidence.competitor_domestic_landed_price,
      competitor_international_shipping_price:
        landedEvidence.competitor_international_shipping_price,
      competitor_international_landed_price:
        landedEvidence.competitor_international_landed_price,
      shipping_scope:
        landedEvidence.shipping_scope,
      buyer_location_country:
        landedEvidence.buyer_location_country,
      domestic_free_shipping:
        landedEvidence.domestic_free_shipping,
      shipping_strategy:
        landedEvidence.shipping_strategy,
    },
    cost_breakdown:
      costBreakdown,
    supplier_model_simulator:
      supplierModelSimulator,
    multipack_profit_advisor:
      multipackProfitAdvisor,
    stock_rotation_risk:
      stockRotationRisk,
    pricing_strategy:
      pricingStrategy,
    recommended_next_action:
      recommendedNextAction,
  }
}
