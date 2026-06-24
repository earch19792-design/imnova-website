export const EBAY_PIPELINE_STATES = [
  "DETECTED",
  "ENRICHING",
  "NEEDS_DATA",
  "BLOCKED",
  "VALIDATED",
  "APPROVAL_PENDING",
  "APPROVED",
  "DRAFT_CREATED",
  "PAUSED",
  "REJECTED",
]

export const DEFAULT_EBAY_PIPELINE_CONFIG = {
  minimumProfitUsd: 0,
  idealProfitUsd: 7,
  minimumRoiPercent: 0,
  minimumNetMarginPercent: 10,
  defaultFulfillmentCost: 1.5,
  defaultPackagingCost: 0.75,
  defaultShippingCost: 6.99,
  ebayFeePercent: 13.25,
  paymentFeePercent: 0,
  advertisingPercent: 0,
  returnReservePercent: 3,
  targetMarkupPercent: 45,
  minimumTargetPriceBuffer: 7,
  requireShippingDimensions: true,
  requireAuthorizedImages: true,
  riskyBrands: [
    "apple",
    "dyson",
    "lego",
    "nike",
    "sony",
    "stanley",
    "disney",
    "microsoft",
  ],
  riskyTerms: [
    "lithium",
    "battery",
    "bateria",
    "fragile",
    "glass",
    "crystal",
    "infant",
    "baby car seat",
    "helmet",
    "medical",
    "cure",
    "treats",
    "diagnose",
  ],
}

function isObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value)
  )
}

export function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null
  }

  const numericValue =
    typeof value === "number"
      ? value
      : Number(value)

  return Number.isFinite(numericValue)
    ? numericValue
    : null
}

function toInteger(value) {
  const numericValue = toNumber(value)

  if (numericValue === null) {
    return null
  }

  return Math.trunc(numericValue)
}

function toStringValue(value) {
  return typeof value === "string"
    ? value.trim()
    : ""
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .map(toStringValue)
        .filter(Boolean)
    )
  )
}

function hasAnyTerm(text, terms) {
  const normalizedText =
    text.toLowerCase()

  return terms.some(term =>
    normalizedText.includes(
      term.toLowerCase()
    )
  )
}

function roundMoney(value) {
  return Number(value.toFixed(2))
}

function roundUpCommercialPrice(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }

  return roundMoney(
    Math.ceil((value + 0.01) / 5) * 5 - 0.01
  )
}

function calculatePriceForTargetMargin({
  fixedCosts,
  variableRate,
  targetMarginRate,
}) {
  const denominator =
    1 - variableRate - targetMarginRate

  if (denominator <= 0) {
    return null
  }

  return roundMoney(
    fixedCosts / denominator
  )
}

function calculateTargetPriceAdvisor({
  estimatedSalePrice,
  netProfit,
  netMarginPercent,
  cost,
  fulfillmentCost,
  packagingCost,
  shippingCost,
  options,
}) {
  const minimumTargetMarginPercent =
    options.minimumNetMarginPercent

  const variableRate =
    (
      options.ebayFeePercent +
      options.paymentFeePercent +
      options.advertisingPercent +
      options.returnReservePercent
    ) / 100

  const fixedCosts =
    roundMoney(
      cost +
      shippingCost +
      fulfillmentCost +
      packagingCost
    )

  const minimumProfitablePrice =
    calculatePriceForTargetMargin({
      fixedCosts,
      variableRate,
      targetMarginRate:
        minimumTargetMarginPercent / 100,
    })

  const idealTargetMarginPercent =
    Math.max(
      minimumTargetMarginPercent + 5,
      15
    )

  const idealTargetPrice =
    calculatePriceForTargetMargin({
      fixedCosts,
      variableRate,
      targetMarginRate:
        idealTargetMarginPercent / 100,
    })

  const suggestedTargetPrice =
    minimumProfitablePrice === null
      ? null
      : roundUpCommercialPrice(
          minimumProfitablePrice
        )

  return {
    current_sale_price:
      estimatedSalePrice,
    current_net_profit:
      netProfit,
    current_net_margin_percent:
      netMarginPercent,
    minimum_target_margin_percent:
      minimumTargetMarginPercent,
    variable_rate_percent:
      roundMoney(
        variableRate * 100
      ),
    fixed_costs:
      fixedCosts,
    minimum_profitable_price:
      minimumProfitablePrice,
    suggested_target_price:
      suggestedTargetPrice,
    ideal_target_margin_percent:
      idealTargetMarginPercent,
    ideal_target_price:
      idealTargetPrice === null
        ? null
        : roundUpCommercialPrice(
            idealTargetPrice
          ),
  }
}

function mergeConfig(config = {}) {
  return {
    ...DEFAULT_EBAY_PIPELINE_CONFIG,
    ...config,
    riskyBrands:
      config.riskyBrands ||
      DEFAULT_EBAY_PIPELINE_CONFIG.riskyBrands,
    riskyTerms:
      config.riskyTerms ||
      DEFAULT_EBAY_PIPELINE_CONFIG.riskyTerms,
  }
}

export function getCandidateKey(candidate) {
  const sourceKey =
    candidate.source?.key ||
    candidate.source_key ||
    "unknown"

  return [
    sourceKey,
    candidate.market_radar_product_id ||
      candidate.product_id ||
      candidate.supplier_product_id ||
      "unknown-product",
    candidate.supplier_variant_id ||
      candidate.supplier_sku ||
      "default-variant",
  ].join(":")
}

export function normalizeRadarProductToEbayCandidate(radarProduct) {
  const imageUrls =
    normalizeStringArray(
      radarProduct.image_urls
    )

  const featuredImageUrl =
    toStringValue(
      radarProduct.featured_image_url
    )

  const allImageUrls =
    normalizeStringArray([
      featuredImageUrl,
      ...imageUrls,
    ])

  const raw =
    isObject(radarProduct.raw)
      ? radarProduct.raw
      : {}

  const rawInventoryContext =
    isObject(raw.inventory_context)
      ? raw.inventory_context
      : null

  const legacyInventoryQuantity =
    toInteger(
      radarProduct.inventory_quantity ??
        rawInventoryContext?.inventory_quantity
    )

  const inventoryContext = {
    inventory_quantity:
      legacyInventoryQuantity,
    product_available_quantity:
      toInteger(
        radarProduct.product_available_quantity ??
          rawInventoryContext?.product_available_quantity
      ),
    inventory_status:
      toStringValue(
        radarProduct.inventory_status ??
          rawInventoryContext?.inventory_status
      ) ||
      (
        legacyInventoryQuantity !== null
          ? legacyInventoryQuantity > 0
            ? "in_stock"
            : "out_of_stock"
          : "unknown"
      ),
    inventory_source:
      toStringValue(
        radarProduct.inventory_source ??
          rawInventoryContext?.inventory_source
      ) ||
      (
        legacyInventoryQuantity !== null
          ? "luna_numeric"
          : "not_exposed"
      ),
    inventory_confidence:
      toStringValue(
        radarProduct.inventory_confidence ??
          rawInventoryContext?.inventory_confidence
      ) ||
      (
        legacyInventoryQuantity !== null
          ? "high"
          : "low"
      ),
    inventory_scope:
      toStringValue(
        radarProduct.inventory_scope ??
          rawInventoryContext?.inventory_scope
      ) ||
      (
        legacyInventoryQuantity !== null
          ? "variant_level"
          : "unknown"
      ),
    luna_auth_state:
      toStringValue(
        radarProduct.luna_auth_state ??
          radarProduct.lunaAuthState ??
          rawInventoryContext?.luna_auth_state
      ) || null,
  }

  const confirmedVariantStock =
    inventoryContext.inventory_scope === "variant_level"
      ? inventoryContext.inventory_quantity
      : null

  const candidate = {
    source: {
      key:
        toStringValue(
          radarProduct.source_key
        ) || "lunaportex",
      name:
        toStringValue(
          radarProduct.source_name
        ) || "Luna Portex",
    },
    source_id:
      radarProduct.source_id ||
      null,
    market_radar_product_id:
      radarProduct.product_id ||
      radarProduct.market_radar_product_id ||
      null,
    market_radar_snapshot_id:
      radarProduct.snapshot_id ||
      radarProduct.market_radar_snapshot_id ||
      null,
    supplier_product_id:
      toStringValue(
        radarProduct.supplier_product_id
      ),
    supplier_variant_id:
      toStringValue(
        radarProduct.supplier_variant_id
      ) || "default",
    supplier_sku:
      toStringValue(
        radarProduct.sku
      ),
    title:
      toStringValue(
        radarProduct.title
      ),
    variant_title:
      toStringValue(
        radarProduct.variant_title
      ),
    product_url:
      toStringValue(
        radarProduct.product_url
      ),
    brand:
      toStringValue(
        radarProduct.vendor
      ),
    product_type:
      toStringValue(
        radarProduct.product_type
      ),
    tags:
      normalizeStringArray(
        radarProduct.tags
      ),
    cost:
      toNumber(
        radarProduct.price
      ),
    estimated_sale_price:
      toNumber(
        radarProduct.estimated_sale_price
      ),
    fulfillment_cost:
      toNumber(
        radarProduct.fulfillment_cost
      ),
    packaging_cost:
      toNumber(
        radarProduct.packaging_cost
      ),
    shipping_cost:
      toNumber(
        radarProduct.shipping_cost
      ),
    compare_at_price:
      toNumber(
        radarProduct.compare_at_price
      ),
    available:
      radarProduct.available === true,
    stock:
      confirmedVariantStock,
    inventory_context:
      inventoryContext,
    inventory_scope:
      inventoryContext.inventory_scope,
    inventory_source:
      inventoryContext.inventory_source,
    inventory_confidence:
      inventoryContext.inventory_confidence,
    product_available_quantity:
      inventoryContext.product_available_quantity,
    listing_quantity_policy:
      getListingQuantityPolicy(
        inventoryContext
      ),
    collections:
      normalizeStringArray(
        radarProduct.collections
      ),
    image_urls:
      allImageUrls,
    images_authorized:
      radarProduct.images_authorized === true,
    suggested_category_id:
      toStringValue(
        radarProduct.suggested_category_id
      ),
    suggested_category_name:
      toStringValue(
        radarProduct.suggested_category_name
      ),
    weight:
      toNumber(
        radarProduct.weight ||
          raw.weight
      ),
    dimensions:
      isObject(radarProduct.dimensions)
        ? radarProduct.dimensions
        : isObject(raw.dimensions)
          ? raw.dimensions
          : null,
    opportunity_score:
      toNumber(
        radarProduct.opportunity_score
      ) || 0,
    restock_count_7d:
      toInteger(
        radarProduct.restock_count_7d
      ) || 0,
    out_of_stock_count_7d:
      toInteger(
        radarProduct.out_of_stock_count_7d
      ) || 0,
    event_count_7d:
      toInteger(
        radarProduct.event_count_7d
      ) || 0,
    last_captured_at:
      radarProduct.last_captured_at ||
      null,
    raw,
  }

  return {
    ...candidate,
    candidate_key:
      getCandidateKey(candidate),
  }
}

export function getListingQuantityPolicy(
  inventoryContext = {}
) {
  const inventoryQuantity =
    toInteger(
      inventoryContext.inventory_quantity
    )

  const inventoryScope =
    toStringValue(
      inventoryContext.inventory_scope
    ) || "unknown"

  const inventoryConfidence =
    toStringValue(
      inventoryContext.inventory_confidence
    ) || "low"

  const lunaAuthState =
    toStringValue(
      inventoryContext.luna_auth_state ||
        inventoryContext.lunaAuthState
    )

  const lunaAuthBlocksInventory =
    Boolean(
      lunaAuthState &&
      lunaAuthState !== "approved"
    )

  if (lunaAuthBlocksInventory) {
    return {
      can_use_for_listing_quantity:
        false,
      max_recommended_listing_quantity:
        0,
      pack_large_allowed:
        false,
      campaign_scale_allowed:
        false,
      required_human_approval:
        true,
      reason:
        "La sesión Luna no está confirmada como aprobada. Validar sesión e inventario antes de listar, crear pack o escalar campaña.",
    }
  }

  if (
    inventoryScope === "variant_level" &&
    inventoryQuantity !== null &&
    inventoryQuantity > 0
  ) {
    return {
      can_use_for_listing_quantity:
        true,
      max_recommended_listing_quantity:
        Math.min(
          inventoryQuantity,
          3
        ),
      pack_large_allowed:
        inventoryQuantity >= 12 &&
        inventoryConfidence === "high",
      campaign_scale_allowed:
        inventoryConfidence === "high",
      required_human_approval:
        false,
      reason:
        "Inventario confirmado por variante/SKU.",
    }
  }

  if (
    inventoryScope === "product_or_category_signal"
  ) {
    return {
      can_use_for_listing_quantity:
        false,
      max_recommended_listing_quantity:
        0,
      pack_large_allowed:
        false,
      campaign_scale_allowed:
        false,
      required_human_approval:
        true,
      reason:
        "Luna muestra disponibilidad general, pero no confirma stock por variante.",
    }
  }

  if (inventoryScope === "availability_only") {
    return {
      can_use_for_listing_quantity:
        false,
      max_recommended_listing_quantity:
        0,
      pack_large_allowed:
        false,
      campaign_scale_allowed:
        false,
      required_human_approval:
        true,
      reason:
        "Luna confirma disponibilidad sin cantidad numérica.",
    }
  }

  if (inventoryScope === "product_level") {
    return {
      can_use_for_listing_quantity:
        false,
      max_recommended_listing_quantity:
        0,
      pack_large_allowed:
        false,
      campaign_scale_allowed:
        false,
      required_human_approval:
        true,
      reason:
        "Cantidad disponible a nivel producto; validar SKU/variante antes de listar.",
    }
  }

  return {
    can_use_for_listing_quantity:
      false,
    max_recommended_listing_quantity:
      0,
    pack_large_allowed:
      false,
    campaign_scale_allowed:
      false,
    required_human_approval:
      true,
    reason:
      "Inventario no confirmado.",
  }
}

export function getPipelineReanalysisAdvisor({
  existingCandidate = null,
  radarProduct = null,
  latestSnapshot = null,
  advisorEvents = [],
  inventoryContext = null,
  lunaAuthState = null,
} = {}) {
  const previousState =
    toStringValue(
      existingCandidate?.state
    ) || null

  const normalizedInventoryContext =
    inventoryContext ||
    normalizeRadarProductToEbayCandidate(
      radarProduct || latestSnapshot || {}
    ).inventory_context

  const inventoryScope =
    normalizedInventoryContext.inventory_scope || "unknown"

  const inventoryConfidence =
    normalizedInventoryContext.inventory_confidence || "low"

  const eventTypes =
    advisorEvents
      .map(event =>
        toStringValue(
          event?.event_type || event?.eventType
        )
      )
      .filter(Boolean)

  const hasReanalysisSignal =
    eventTypes.some(eventType =>
      [
        "restocked",
        "price_down",
        "discount_started",
      ].includes(eventType)
    )

  const normalizedLunaAuthState =
    toStringValue(lunaAuthState)

  const authNotApproved =
    Boolean(
      normalizedLunaAuthState &&
      normalizedLunaAuthState !== "approved"
    )

  const base = {
    action:
      "no_change",
    reason:
      "No hay señales nuevas que requieran acción operativa.",
    previous_state:
      previousState,
    new_signals:
      eventTypes,
    inventory_scope:
      inventoryScope,
    inventory_confidence:
      inventoryConfidence,
    required_human_approval:
      authNotApproved,
    priority:
      "low",
    proposed_next_step:
      authNotApproved
        ? "Validar sesión Luna e inventario antes de listar, crear pack o escalar campaña."
        : "Mantener monitoreo.",
  }

  if (previousState === "DRAFT_CREATED") {
    return {
      ...base,
      action:
        "review_existing_draft",
      reason:
        "Este producto ya tiene draft. Revisar inventario y cambios antes de recalcular o cambiar estado.",
      required_human_approval:
        true,
      priority:
        "high",
      proposed_next_step:
        "Revisar el draft existente, inventario y cambios de mercado antes de reanalizar.",
    }
  }

  if (
    inventoryScope === "product_or_category_signal"
  ) {
    return {
      ...base,
      action:
        "inventory_validation_required",
      reason:
        "Luna muestra disponibilidad general, pero no confirma stock por variante. Validar SKU antes de listar, hacer pack o escalar.",
      required_human_approval:
        true,
      priority:
        "high",
      proposed_next_step:
        "Validar inventario real del SKU/variante antes de listar, crear pack o escalar campaña.",
    }
  }

  if (inventoryScope === "availability_only") {
    return {
      ...base,
      action:
        "inventory_validation_required",
      reason:
        "Luna confirma disponibilidad, pero no expone cantidad numérica por variante.",
      required_human_approval:
        true,
      priority:
        "medium",
      proposed_next_step:
        "Validar unidades reales antes de listar cantidad alta, hacer pack grande o activar campaña fuerte.",
    }
  }

  if (
    previousState === "BLOCKED" &&
    hasReanalysisSignal
  ) {
    return {
      ...base,
      action:
        "resurface_blocked",
      reason:
        "Producto previamente bloqueado, pero apareció una señal nueva. Recomiendo reanalizar.",
      required_human_approval:
        true,
      priority:
        "high",
      proposed_next_step:
        "Reprocesar con Price Intelligence e inventario actual antes de decidir.",
    }
  }

  if (hasReanalysisSignal) {
    return {
      ...base,
      action:
        "needs_reanalysis",
      reason:
        "El Radar detectó señales nuevas que pueden cambiar margen, inventario o estrategia.",
      required_human_approval:
        authNotApproved,
      priority:
        inventoryScope === "variant_level"
          ? "medium"
          : "high",
      proposed_next_step:
        "Revisar profit, inventario y mercado antes de avanzar.",
    }
  }

  return base
}

export function validateCandidateData(candidate, config = {}) {
  const options =
    mergeConfig(config)

  const missingFields = []
  const criticalReasons = []

  if (!candidate.supplier_sku) {
    missingFields.push("supplier_sku")
  }

  if (!candidate.title) {
    missingFields.push("title")
  }

  if (
    candidate.cost === null ||
    candidate.cost === undefined ||
    candidate.cost <= 0
  ) {
    missingFields.push("cost")
  }

  if (
    candidate.stock === null ||
    candidate.stock === undefined
  ) {
    missingFields.push("confirmed_stock_quantity")
  }

  if (candidate.stock !== null && candidate.stock <= 0) {
    criticalReasons.push("stock_zero")
  }

  if (
    options.requireShippingDimensions &&
    !candidate.weight &&
    !candidate.dimensions
  ) {
    missingFields.push("weight_or_dimensions")
  }

  if (
    options.requireAuthorizedImages &&
    (
      !candidate.images_authorized ||
      candidate.image_urls.length === 0
    )
  ) {
    missingFields.push("authorized_images")
  }

  if (
    !candidate.suggested_category_id &&
    !candidate.suggested_category_name &&
    !candidate.product_type
  ) {
    missingFields.push("category_or_inference_data")
  }

  return {
    status:
      criticalReasons.length > 0
        ? "blocked"
        : missingFields.length > 0
          ? "needs_data"
          : "passed",
    missingFields,
    criticalReasons,
  }
}

export function calculateProfitScenario(candidate, config = {}) {
  const options =
    mergeConfig(config)

  const cost =
    toNumber(candidate.cost) || 0

  const targetPriceBase =
    Math.max(
      cost * (1 + options.targetMarkupPercent / 100),
      cost + options.minimumTargetPriceBuffer
    )

  const estimatedSalePrice =
    roundMoney(
      toNumber(candidate.estimated_sale_price) ||
      targetPriceBase
    )

  const buyerShippingCharge =
    roundMoney(
      toNumber(candidate.buyer_shipping_charge) || 0
    )

  const totalRevenue =
    roundMoney(
      estimatedSalePrice +
        buyerShippingCharge
    )

  const fulfillmentCost =
    roundMoney(
      toNumber(candidate.fulfillment_cost) ??
        options.defaultFulfillmentCost
    )

  const packagingCost =
    roundMoney(
      toNumber(candidate.packaging_cost) ??
        options.defaultPackagingCost
    )

  const shippingCost =
    roundMoney(
      Math.max(
        options.defaultShippingCost,
        toNumber(candidate.shipping_cost) ??
          options.defaultShippingCost
      )
    )

  const ebayFee =
    roundMoney(
      estimatedSalePrice *
        (options.ebayFeePercent / 100)
    )

  const paymentFee =
    roundMoney(
      estimatedSalePrice *
        (options.paymentFeePercent / 100)
    )

  const advertisingCost =
    roundMoney(
      estimatedSalePrice *
        (options.advertisingPercent / 100)
    )

  const returnReserve =
    roundMoney(
      estimatedSalePrice *
        (options.returnReservePercent / 100)
    )

  const totalCost =
    roundMoney(
      cost +
        fulfillmentCost +
        packagingCost +
        shippingCost +
        ebayFee +
        paymentFee +
        advertisingCost +
        returnReserve
    )

  const netProfit =
    roundMoney(
      totalRevenue - totalCost
    )

  const netMarginPercent =
    totalRevenue > 0
      ? roundMoney(
          (netProfit / totalRevenue) * 100
        )
      : 0

  const roiPercent =
    cost > 0
      ? roundMoney(
          (netProfit / cost) * 100
        )
      : 0

  const passesMinimums =
    netProfit > options.minimumProfitUsd &&
    netMarginPercent >= options.minimumNetMarginPercent

  const targetPriceAdvisor =
    calculateTargetPriceAdvisor({
      estimatedSalePrice,
      netProfit,
      netMarginPercent,
      cost,
      fulfillmentCost,
      packagingCost,
      shippingCost,
      options,
    })

  return {
    estimated_sale_price:
      estimatedSalePrice,
    buyer_shipping_charge:
      buyerShippingCharge,
    total_revenue:
      totalRevenue,
    luna_cost:
      roundMoney(cost),
    fulfillment_cost:
      fulfillmentCost,
    packaging_cost:
      packagingCost,
    estimated_shipping_cost:
      shippingCost,
    estimated_ebay_fee:
      ebayFee,
    estimated_payment_fee:
      paymentFee,
    estimated_advertising_cost:
      advertisingCost,
    return_reserve:
      returnReserve,
    total_estimated_cost:
      totalCost,
    net_profit:
      netProfit,
    net_margin_percent:
      netMarginPercent,
    roi_percent:
      roiPercent,
    passes_minimums:
      passesMinimums,
    assumptions: {
      minimumProfitUsd:
        options.minimumProfitUsd,
      idealProfitUsd:
        options.idealProfitUsd,
      minimumRoiPercent:
        options.minimumRoiPercent,
      minimumNetMarginPercent:
        options.minimumNetMarginPercent,
      roiBlocksMinimums:
        false,
      ebayFeePercent:
        options.ebayFeePercent,
      paymentFeePercent:
        options.paymentFeePercent,
      advertisingPercent:
        options.advertisingPercent,
      returnReservePercent:
        options.returnReservePercent,
      targetPriceAdvisor,
    },
  }
}

export function runComplianceChecks(candidate, profitScenario, config = {}) {
  const options =
    mergeConfig(config)

  const text = [
    candidate.title,
    candidate.brand,
    candidate.product_type,
    ...(candidate.tags || []),
  ].join(" ")

  const findings = []

  if (
    candidate.brand &&
    options.riskyBrands.some(brand =>
      candidate.brand.toLowerCase() ===
        brand.toLowerCase()
    )
  ) {
    findings.push({
      code: "risky_brand_or_vero",
      severity: "blocker",
      message:
        "Marca marcada como riesgosa o posible VeRO.",
    })
  }

  if (hasAnyTerm(text, ["lithium", "battery", "bateria"])) {
    findings.push({
      code: "integrated_lithium_battery",
      severity: "blocker",
      message:
        "Posible batería de litio integrada.",
    })
  }

  if (hasAnyTerm(text, ["fragile", "glass", "crystal"])) {
    findings.push({
      code: "fragile_product",
      severity: "blocker",
      message:
        "Producto potencialmente frágil.",
    })
  }

  if (hasAnyTerm(text, ["infant", "baby car seat", "helmet"])) {
    findings.push({
      code: "child_safety_product",
      severity: "blocker",
      message:
        "Producto asociado a seguridad infantil.",
    })
  }

  if (hasAnyTerm(text, ["medical", "cure", "treats", "diagnose"])) {
    findings.push({
      code: "strong_medical_claims",
      severity: "blocker",
      message:
        "Producto con posible reclamo médico fuerte.",
    })
  }

  if (candidate.stock !== null && candidate.stock <= 0) {
    findings.push({
      code: "stock_zero",
      severity: "blocker",
      message:
        "Stock cero o no disponible.",
    })
  }

  if (!profitScenario.passes_minimums) {
    findings.push({
      code: "margin_below_minimum",
      severity: "blocker",
      message:
        "Profit neto o margen por debajo del minimo.",
    })
  }

  const blockerCount =
    findings.filter(finding =>
      finding.severity === "blocker"
    ).length

  return {
    overall_status:
      blockerCount > 0
        ? "blocked"
        : "passed",
    blocker_count:
      blockerCount,
    findings,
  }
}

function scorePercent(value, maxValue) {
  if (maxValue <= 0) {
    return 0
  }

  return Math.max(
    0,
    Math.min(
      1,
      value / maxValue
    )
  )
}

export function calculateWinnerScore(candidate, validation, profitScenario, compliance) {
  const demandScore =
    25 * scorePercent(
      candidate.opportunity_score || 0,
      100
    )

  const profitQuality =
    (
      scorePercent(profitScenario.net_profit, 10) +
      scorePercent(profitScenario.roi_percent, 60) +
      scorePercent(profitScenario.net_margin_percent, 35)
    ) / 3

  const profitabilityScore =
    25 * profitQuality

  const competitionScore =
    15 * 0.5

  const stockPenalty =
    Math.min(
      1,
      (candidate.out_of_stock_count_7d || 0) / 3
    )

  const stabilityScore =
    15 * Math.max(
      0,
      1 - stockPenalty
    )

  const requiredFieldCount = 6
  const missingCount =
    validation.missingFields.length

  const dataQualityScore =
    10 * Math.max(
      0,
      1 - missingCount / requiredFieldCount
    )

  const riskScore =
    10 * Math.max(
      0,
      1 - compliance.blocker_count / 4
    )

  const total =
    demandScore +
    profitabilityScore +
    competitionScore +
    stabilityScore +
    dataQualityScore +
    riskScore

  return {
    winner_score:
      Math.round(
        Math.max(0, Math.min(100, total))
      ),
    breakdown: {
      demand:
        roundMoney(demandScore),
      profitability:
        roundMoney(profitabilityScore),
      competition:
        roundMoney(competitionScore),
      stock_stability:
        roundMoney(stabilityScore),
      data_quality:
        roundMoney(dataQualityScore),
      inverse_operational_risk:
        roundMoney(riskScore),
    },
  }
}

export function decideCandidateState(validation, profitScenario, compliance) {
  if (
    validation.criticalReasons.length > 0 ||
    compliance.overall_status === "blocked"
  ) {
    return "BLOCKED"
  }

  if (
    validation.status === "needs_data"
  ) {
    return "NEEDS_DATA"
  }

  if (!profitScenario.passes_minimums) {
    return "BLOCKED"
  }

  return "VALIDATED"
}

export function buildHumanExplanation(candidate, profitScenario, compliance, score) {
  if (compliance.overall_status === "blocked") {
    const reason =
      compliance.findings[0]?.message ||
      "riesgo operativo o de cumplimiento."

    return `Producto bloqueado: ${reason} Profit estimado $${profitScenario.net_profit.toFixed(2)}, margen ${profitScenario.net_margin_percent.toFixed(0)}%, score ${score.winner_score}.`
  }

  if (
    candidate.stock === null ||
    candidate.stock === undefined
  ) {
    return `Producto necesita datos: el proveedor indica ${candidate.available ? "disponibilidad" : "disponibilidad sin confirmar"}, pero no expone cantidad disponible confirmada. Profit estimado $${profitScenario.net_profit.toFixed(2)}, margen ${profitScenario.net_margin_percent.toFixed(0)}%, score ${score.winner_score}.`
  }

  return `Producto recomendado porque tiene stock ${candidate.stock ?? "sin dato"}, profit estimado de $${profitScenario.net_profit.toFixed(2)}, margen de ${profitScenario.net_margin_percent.toFixed(0)}%, ROI de ${profitScenario.roi_percent.toFixed(0)}%, riesgo bajo y demanda derivada del Radar IMNOVA.`
}

export function buildWhatsAppDryRunPayload(candidate, profitScenario, score, explanation) {
  return {
    dryRun: true,
    enableRealSend: false,
    messaging_product: "whatsapp",
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: [
          `Candidato eBay: ${candidate.title}`,
          `Winner Score: ${score.winner_score}/100`,
          `Profit: $${profitScenario.net_profit.toFixed(2)} | Margen: ${profitScenario.net_margin_percent.toFixed(0)}% | ROI: ${profitScenario.roi_percent.toFixed(0)}%`,
          explanation,
        ].join("\n"),
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: `create_draft:${candidate.candidate_key}`,
              title: "Crear borrador",
            },
          },
          {
            type: "reply",
            reply: {
              id: `reject:${candidate.candidate_key}`,
              title: "Rechazar",
            },
          },
          {
            type: "reply",
            reply: {
              id: `review_data:${candidate.candidate_key}`,
              title: "Revisar datos",
            },
          },
          {
            type: "reply",
            reply: {
              id: `postpone:${candidate.candidate_key}`,
              title: "Posponer",
            },
          },
        ],
      },
    },
  }
}

export function processRadarCandidate(radarProduct, config = {}) {
  const candidate =
    normalizeRadarProductToEbayCandidate(
      radarProduct
    )

  const validation =
    validateCandidateData(
      candidate,
      config
    )

  const profitScenario =
    calculateProfitScenario(
      candidate,
      config
    )

  const compliance =
    runComplianceChecks(
      candidate,
      profitScenario,
      config
    )

  const score =
    calculateWinnerScore(
      candidate,
      validation,
      profitScenario,
      compliance
    )

  const state =
    decideCandidateState(
      validation,
      profitScenario,
      compliance
    )

  const explanation =
    buildHumanExplanation(
      candidate,
      profitScenario,
      compliance,
      score
    )

  const whatsappDryRunPayload =
    buildWhatsAppDryRunPayload(
      candidate,
      profitScenario,
      score,
      explanation
    )

  return {
    candidate: {
      ...candidate,
      state,
    },
    validation,
    profitScenario,
    compliance,
    score,
    explanation,
    whatsappDryRunPayload,
  }
}

export function normalizeDecisionAction(action) {
  const actionMap = {
    create_draft: "DRAFT_CREATED",
    reject: "REJECTED",
    review_data: "NEEDS_DATA",
    postpone: "PAUSED",
  }

  return actionMap[action] || null
}

export function buildDecisionIdempotencyKey({
  candidateKey,
  messageId,
  action,
}) {
  return [
    "decision",
    candidateKey,
    messageId || "dry-run-message",
    action,
  ].join(":")
}
