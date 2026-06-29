const PRODUCT_SELECTION_DECISIONS = new Set([
  "approve",
  "review",
  "reject",
  "blocked",
])

const PRODUCT_SELECTION_STATES = new Set([
  "NEW_CANDIDATE",
  "DATA_INCOMPLETE",
  "MARGIN_REVIEW",
  "RISK_REVIEW",
  "APPROVED_FOR_DRAFT",
  "BLOCKED",
  "REJECTED",
])

export const DEFAULT_PRODUCT_SELECTION_CONFIG = {
  ebayFeePercent: 13.25,
  ebayFixedFee: 0.3,
  defaultShippingCost: 6.99,
  minimumProfitUsd: 5,
  idealProfitUsd: 7,
  minimumRoiPercent: 30,
  recommendedNetMarginPercent: 20,
  marketPriceReviewBufferPercent: 10,
  slowShippingDays: 7,
}

function mergeConfig(config = {}) {
  return {
    ...DEFAULT_PRODUCT_SELECTION_CONFIG,
    ...config,
  }
}

function toNumber(value) {
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

function roundMoney(value) {
  return Math.round(
    (value + 1e-8) * 100
  ) / 100
}

function roundPercent(value) {
  return Math.round(
    (value + 1e-8) * 100
  ) / 100
}

function cleanString(value) {
  return typeof value === "string"
    ? value.trim()
    : ""
}

function normalizeRisk(value) {
  const text =
    cleanString(value)
      .toLowerCase()

  if (
    [
      "high",
      "critical",
      "blocked",
      "blocker",
    ].includes(text) ||
    value === true
  ) {
    return "high"
  }

  if (
    [
      "medium",
      "review",
      "moderate",
    ].includes(text)
  ) {
    return "medium"
  }

  if (
    [
      "low",
      "none",
      "clear",
      "approved",
      "authorized",
    ].includes(text) ||
    value === false
  ) {
    return "low"
  }

  return text || "unknown"
}

function hasDimensions(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false
  }

  return [
    value.length,
    value.width,
    value.height,
  ].some(item =>
    toNumber(item) !== null &&
    toNumber(item) > 0
  )
}

function createRiskFlag({
  code,
  severity,
  message,
}) {
  return {
    code,
    severity,
    message,
  }
}

function hasBlockingRisk(evaluation) {
  return [
    ...evaluation.operationalRisk.riskFlags,
    ...evaluation.ebayRisk.riskFlags,
  ].some(flag => flag.severity === "blocker")
}

function hasDataIncompleteRisk(evaluation) {
  return evaluation.operationalRisk.riskFlags
    .some(flag =>
      [
        "stock_unknown",
        "missing_weight",
        "missing_dimensions",
        "image_authorization_missing",
      ].includes(flag.code)
    ) ||
    evaluation.ebayRisk.riskFlags
      .some(flag =>
        flag.code === "image_authorization_missing"
      )
}

function getMarketPriceReview(evaluation, config) {
  const estimatedEbayPrice =
    toNumber(
      evaluation.normalizedCandidate.estimatedEbayPrice
    )

  const soldCompsMedianPrice =
    toNumber(
      evaluation.normalizedCandidate.soldCompsMedianPrice
    )

  if (
    estimatedEbayPrice === null ||
    soldCompsMedianPrice === null ||
    soldCompsMedianPrice <= 0
  ) {
    return null
  }

  const maxCompetitivePrice =
    soldCompsMedianPrice *
      (1 + config.marketPriceReviewBufferPercent / 100)

  if (estimatedEbayPrice > maxCompetitivePrice) {
    return createRiskFlag({
      code: "price_above_market",
      severity: "review",
      message:
        "Estimated eBay price is more than 10% above sold comps median.",
    })
  }

  return null
}

function getMainReason({
  decision,
  state,
  riskFlags,
  economics,
  marketReview,
  config,
}) {
  const blocker =
    riskFlags.find(flag =>
      flag.severity === "blocker"
    )

  if (blocker) {
    return blocker.message
  }

  if (state === "DATA_INCOMPLETE") {
    return "Required product data is incomplete before any next step."
  }

  if (marketReview) {
    return marketReview.message
  }

  if (
    economics.netProfit < config.minimumProfitUsd
  ) {
    return `Net profit is below the $${config.minimumProfitUsd} minimum.`
  }

  if (
    economics.netMarginPercent < config.recommendedNetMarginPercent
  ) {
    return `Net margin is below the ${config.recommendedNetMarginPercent}% recommended minimum.`
  }

  if (
    economics.roiPercent < config.minimumRoiPercent
  ) {
    return `ROI is below the ${config.minimumRoiPercent}% minimum.`
  }

  if (decision === "approve") {
    return "Product passes V1 economics, data, stock, and risk checks."
  }

  return "Product requires human review before moving forward."
}

function getNextHumanAction({
  decision,
  state,
  riskFlags,
}) {
  const codes =
    new Set(
      riskFlags.map(flag => flag.code)
    )

  if (decision === "blocked") {
    return "Do not move this candidate forward unless a future audited admin review clears the blocker."
  }

  if (state === "DATA_INCOMPLETE") {
    if (
      codes.has("missing_weight") ||
      codes.has("missing_dimensions")
    ) {
      return "Confirm weight and dimensions before any listing-prep decision."
    }

    if (codes.has("stock_unknown")) {
      return "Confirm real supplier stock before any listing-prep decision."
    }

    return "Complete required product data before review."
  }

  if (state === "MARGIN_REVIEW") {
    return "Review price, supplier cost, shipping, fees, and sold comps before deciding."
  }

  if (state === "RISK_REVIEW") {
    return "Review eBay policy, brand, image, and operational risks before deciding."
  }

  if (decision === "approve") {
    return "Human may consider this candidate for a future internal listing-prep workflow."
  }

  return "Reject or revisit only if costs, stock, or market evidence improve."
}

export function calculateProductEconomics(candidate = {}, config = {}) {
  const options =
    mergeConfig(config)

  const supplierCost =
    toNumber(candidate.supplierCost) || 0

  const estimatedEbayPrice =
    toNumber(candidate.estimatedEbayPrice) || 0

  const buyerShippingCharge =
    toNumber(candidate.buyerShippingCharge) || 0

  const totalRevenue =
    roundMoney(
      estimatedEbayPrice +
        buyerShippingCharge
    )

  const estimatedShippingCost =
    roundMoney(
      toNumber(candidate.supplierShippingCost) ??
        options.defaultShippingCost
    )

  const explicitEbayFees =
    toNumber(candidate.estimatedEbayFees)

  const estimatedEbayFees =
    roundMoney(
      explicitEbayFees ??
        (
          totalRevenue *
            (options.ebayFeePercent / 100) +
          options.ebayFixedFee
        )
    )

  const totalCost =
    roundMoney(
      supplierCost +
        estimatedShippingCost +
        estimatedEbayFees
    )

  const netProfit =
    roundMoney(
      totalRevenue - totalCost
    )

  const roiPercent =
    supplierCost > 0
      ? roundPercent(
          (netProfit / supplierCost) * 100
        )
      : 0

  const netMarginPercent =
    totalRevenue > 0
      ? roundPercent(
          (netProfit / totalRevenue) * 100
        )
      : 0

  return {
    supplierCost:
      roundMoney(supplierCost),
    estimatedEbayPrice:
      roundMoney(estimatedEbayPrice),
    buyerShippingCharge:
      roundMoney(buyerShippingCharge),
    totalRevenue,
    estimatedShippingCost,
    estimatedEbayFees,
    totalCost,
    netProfit,
    roiPercent,
    netMarginPercent,
    thresholds: {
      minimumProfitUsd:
        options.minimumProfitUsd,
      idealProfitUsd:
        options.idealProfitUsd,
      minimumRoiPercent:
        options.minimumRoiPercent,
      recommendedNetMarginPercent:
        options.recommendedNetMarginPercent,
    },
  }
}

export function classifyOperationalRisk(candidate = {}, config = {}) {
  const options =
    mergeConfig(config)

  const riskFlags = []
  const stockAvailable =
    toNumber(candidate.stockAvailable)
  const stockStatus =
    cleanString(candidate.stockStatus)
      .toLowerCase()

  if (
    stockAvailable !== null &&
    stockAvailable <= 0
  ) {
    riskFlags.push(
      createRiskFlag({
        code: "stock_zero",
        severity: "blocker",
        message:
          "No stock is available.",
      })
    )
  } else if (
    stockAvailable === null ||
    [
      "unknown",
      "unconfirmed",
      "not_confirmed",
    ].includes(stockStatus)
  ) {
    riskFlags.push(
      createRiskFlag({
        code: "stock_unknown",
        severity: "review",
        message:
          "Supplier stock is unknown or unconfirmed.",
      })
    )
  }

  if (
    toNumber(candidate.weight) === null
  ) {
    riskFlags.push(
      createRiskFlag({
        code: "missing_weight",
        severity: "review",
        message:
          "Weight is missing.",
      })
    )
  }

  if (!hasDimensions(candidate.dimensions)) {
    riskFlags.push(
      createRiskFlag({
        code: "missing_dimensions",
        severity: "review",
        message:
          "Dimensions are missing.",
      })
    )
  }

  const shippingTimeDays =
    toNumber(candidate.shippingTimeDays)

  if (
    shippingTimeDays !== null &&
    shippingTimeDays > options.slowShippingDays
  ) {
    riskFlags.push(
      createRiskFlag({
        code: "shipping_slow",
        severity: "review",
        message:
          "Shipping time is slow and needs review.",
      })
    )
  }

  if (candidate.fragile === true) {
    riskFlags.push(
      createRiskFlag({
        code: "fragile_product",
        severity: "review",
        message:
          "Product fragility increases operational risk.",
      })
    )
  }

  if (
    normalizeRisk(candidate.returnRisk) === "high"
  ) {
    riskFlags.push(
      createRiskFlag({
        code: "return_risk_high",
        severity: "review",
        message:
          "Return risk is high.",
      })
    )
  }

  return {
    riskLevel:
      riskFlags.some(flag => flag.severity === "blocker")
        ? "critical"
        : riskFlags.length > 0
          ? "review"
          : "low",
    riskFlags,
  }
}

export function classifyEbayRisk(candidate = {}) {
  const riskFlags = []

  if (
    normalizeRisk(candidate.brandRisk) === "high" ||
    normalizeRisk(candidate.veroRisk) === "high"
  ) {
    riskFlags.push(
      createRiskFlag({
        code: "brand_or_vero_high",
        severity: "blocker",
        message:
          "High brand, IP, or VeRO risk.",
      })
    )
  }

  if (
    normalizeRisk(candidate.medicalClaimsRisk) === "high"
  ) {
    riskFlags.push(
      createRiskFlag({
        code: "medical_claims_high",
        severity: "blocker",
        message:
          "Strong medical or health claims risk.",
      })
    )
  } else if (
    normalizeRisk(candidate.medicalClaimsRisk) === "medium"
  ) {
    riskFlags.push(
      createRiskFlag({
        code: "medical_claims_review",
        severity: "review",
        message:
          "Medical or health claims need review.",
      })
    )
  }

  if (
    normalizeRisk(candidate.categoryRisk) === "high"
  ) {
    riskFlags.push(
      createRiskFlag({
        code: "category_risk_high",
        severity: "review",
        message:
          "Category risk needs review.",
      })
    )
  }

  const imageStatus =
    cleanString(candidate.imageAuthorizationStatus)
      .toLowerCase()

  if (
    imageStatus &&
    ![
      "authorized",
      "approved",
      "owned",
      "clear",
    ].includes(imageStatus)
  ) {
    riskFlags.push(
      createRiskFlag({
        code: "image_authorization_missing",
        severity: "review",
        message:
          "Image authorization is not confirmed.",
      })
    )
  }

  return {
    riskLevel:
      riskFlags.some(flag => flag.severity === "blocker")
        ? "critical"
        : riskFlags.length > 0
          ? "review"
          : "low",
    riskFlags,
  }
}

export function determineProductSelectionDecision(evaluation = {}) {
  const config =
    mergeConfig(evaluation.config)
  const economics =
    evaluation.economics || {}
  const riskFlags = [
    ...(evaluation.operationalRisk?.riskFlags || []),
    ...(evaluation.ebayRisk?.riskFlags || []),
  ]
  const marketReview =
    evaluation.marketReview || null

  let decision = "approve"
  let state = "APPROVED_FOR_DRAFT"

  if (hasBlockingRisk(evaluation)) {
    decision = "blocked"
    state = "BLOCKED"
  } else if (hasDataIncompleteRisk(evaluation)) {
    decision = "review"
    state = "DATA_INCOMPLETE"
  } else if (marketReview) {
    decision = "review"
    state = "MARGIN_REVIEW"
  } else if (
    economics.netProfit <= 0
  ) {
    decision = "reject"
    state = "REJECTED"
  } else if (
    economics.netProfit < config.minimumProfitUsd ||
    economics.netMarginPercent < config.recommendedNetMarginPercent ||
    economics.roiPercent < config.minimumRoiPercent
  ) {
    decision = "review"
    state = "MARGIN_REVIEW"
  } else if (
    riskFlags.some(flag => flag.severity === "review")
  ) {
    decision = "review"
    state = "RISK_REVIEW"
  }

  return {
    decision,
    state,
  }
}

export function buildProductSelectionAdvisorOutput(evaluation = {}) {
  const config =
    mergeConfig(evaluation.config)
  const decisionResult =
    evaluation.decisionResult ||
    determineProductSelectionDecision(evaluation)

  const riskFlags = [
    ...(evaluation.operationalRisk?.riskFlags || []),
    ...(evaluation.ebayRisk?.riskFlags || []),
    ...(evaluation.marketReview ? [evaluation.marketReview] : []),
  ]

  const output = {
    decision:
      decisionResult.decision,
    state:
      decisionResult.state,
    mainReason:
      getMainReason({
        decision:
          decisionResult.decision,
        state:
          decisionResult.state,
        riskFlags,
        economics:
          evaluation.economics,
        marketReview:
          evaluation.marketReview,
        config,
      }),
    riskFlags,
    keyNumbers: {
      netProfit:
        evaluation.economics.netProfit,
      roiPercent:
        evaluation.economics.roiPercent,
      netMarginPercent:
        evaluation.economics.netMarginPercent,
      estimatedEbayFees:
        evaluation.economics.estimatedEbayFees,
      estimatedShippingCost:
        evaluation.economics.estimatedShippingCost,
    },
    nextHumanAction:
      getNextHumanAction({
        decision:
          decisionResult.decision,
        state:
          decisionResult.state,
        riskFlags,
      }),
    advisoryOnly:
      true,
  }

  if (
    !PRODUCT_SELECTION_DECISIONS.has(output.decision) ||
    !PRODUCT_SELECTION_STATES.has(output.state)
  ) {
    throw new Error(
      "invalid_product_selection_decision_output"
    )
  }

  return output
}

export function evaluateProductSelectionCandidate(candidate = {}, options = {}) {
  const config =
    mergeConfig(options)

  const normalizedCandidate = {
    ...candidate,
  }

  const economics =
    calculateProductEconomics(
      normalizedCandidate,
      config
    )

  const operationalRisk =
    classifyOperationalRisk(
      normalizedCandidate,
      config
    )

  const ebayRisk =
    classifyEbayRisk(
      normalizedCandidate,
      config
    )

  const baseEvaluation = {
    normalizedCandidate,
    config,
    economics,
    operationalRisk,
    ebayRisk,
    marketReview:
      null,
  }

  const marketReview =
    getMarketPriceReview(
      baseEvaluation,
      config
    )

  const evaluation = {
    ...baseEvaluation,
    marketReview,
  }

  const decisionResult =
    determineProductSelectionDecision(
      evaluation
    )

  return buildProductSelectionAdvisorOutput({
    ...evaluation,
    decisionResult,
  })
}
