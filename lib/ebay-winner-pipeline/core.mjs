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
  minimumProfitUsd: 5,
  idealProfitUsd: 7,
  minimumRoiPercent: 30,
  minimumNetMarginPercent: 20,
  defaultFulfillmentCost: 1.5,
  defaultPackagingCost: 0.75,
  defaultShippingCost: 5.5,
  ebayFeePercent: 13.25,
  paymentFeePercent: 0,
  advertisingPercent: 5,
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
      toInteger(
        radarProduct.inventory_quantity
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
    missingFields.push("stock")
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
      toNumber(candidate.shipping_cost) ??
        options.defaultShippingCost
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
      estimatedSalePrice - totalCost
    )

  const netMarginPercent =
    estimatedSalePrice > 0
      ? roundMoney(
          (netProfit / estimatedSalePrice) * 100
        )
      : 0

  const roiPercent =
    cost > 0
      ? roundMoney(
          (netProfit / cost) * 100
        )
      : 0

  const passesMinimums =
    netProfit >= options.minimumProfitUsd &&
    roiPercent >= options.minimumRoiPercent &&
    netMarginPercent >= options.minimumNetMarginPercent

  return {
    estimated_sale_price:
      estimatedSalePrice,
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
      ebayFeePercent:
        options.ebayFeePercent,
      advertisingPercent:
        options.advertisingPercent,
      returnReservePercent:
        options.returnReservePercent,
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
        "Profit, margen o ROI por debajo del mínimo.",
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
