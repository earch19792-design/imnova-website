import {
  calculateProductEconomics,
} from "./product-selection-decision-service.mjs"

export const EBAY_LISTING_DRAFT_SCHEMA_VERSION =
  "EBAY_LISTING_DRAFT_SCHEMA_V1"

const LISTING_STATES = {
  DATA_INCOMPLETE:
    "LISTING_DATA_INCOMPLETE",
  REVIEW_REQUIRED:
    "LISTING_REVIEW_REQUIRED",
  BLOCKED:
    "LISTING_BLOCKED",
  DRAFT_READY:
    "LISTING_DRAFT_READY",
}

const RISK_WORDS = [
  "cure",
  "cures",
  "treats",
  "prevents disease",
  "fda approved",
  "guaranteed",
  "100% safe",
  "best in the world",
]

function cleanString(value) {
  return typeof value === "string"
    ? value.trim()
    : ""
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

function normalizeRisk(value) {
  const text =
    cleanString(value).toLowerCase()

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
      "authorized",
      "approved",
    ].includes(text) ||
    value === false
  ) {
    return "low"
  }

  return text || "unknown"
}

function hasPositiveNumber(value) {
  const numericValue =
    toNumber(value)

  return (
    numericValue !== null &&
    numericValue > 0
  )
}

function hasDimensions(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      hasPositiveNumber(value.length) &&
      hasPositiveNumber(value.width) &&
      hasPositiveNumber(value.height)
  )
}

function normalizeWeight(value, unit) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return {
      value:
        toNumber(value.value),
      unit:
        cleanString(value.unit) || "lb",
    }
  }

  return {
    value:
      toNumber(value),
    unit:
      cleanString(unit) || "lb",
  }
}

function normalizeDimensions(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null
  }

  return {
    length:
      toNumber(value.length),
    width:
      toNumber(value.width),
    height:
      toNumber(value.height),
    unit:
      cleanString(value.unit) || "in",
  }
}

function uniqueItems(items) {
  return [
    ...new Set(
      items.filter(Boolean)
    ),
  ]
}

function getCandidateTitle(candidate) {
  return (
    cleanString(candidate.title) ||
    cleanString(candidate.productName) ||
    "Untitled Product Candidate"
  )
}

function sanitizeTitle(value) {
  const title =
    cleanString(value)
      .replace(/[!]{2,}/g, "")
      .replace(/\s+/g, " ")

  const lowerTitle =
    title.toLowerCase()

  const risky =
    RISK_WORDS.some(word =>
      lowerTitle.includes(word)
    )

  if (risky) {
    return title
      .replace(/cures?/gi, "")
      .replace(/treats/gi, "")
      .replace(/prevents disease/gi, "")
      .replace(/fda approved/gi, "")
      .replace(/guaranteed/gi, "")
      .replace(/100% safe/gi, "")
      .replace(/best in the world/gi, "")
      .replace(/\s+/g, " ")
      .trim() ||
      "Product Candidate"
  }

  return title
}

function getTitleKeywords(title) {
  return uniqueItems(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(word =>
        word.length >= 4
      )
      .slice(0, 6)
  )
}

function getTitleRiskFlags(title) {
  const lowerTitle =
    title.toLowerCase()

  const flags = []

  if (
    new Set(
      lowerTitle
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
    ).size <
      lowerTitle
        .split(/[^a-z0-9]+/)
        .filter(Boolean).length - 2
  ) {
    flags.push("possible_keyword_stuffing")
  }

  for (const word of RISK_WORDS) {
    if (lowerTitle.includes(word)) {
      flags.push(
        `risky_phrase_${word.replace(/\s+/g, "_")}`
      )
    }
  }

  return uniqueItems(flags)
}

function getMissingItemSpecifics(candidate) {
  const missing = []

  if (!cleanString(candidate.brand)) {
    missing.push("Brand")
  }

  if (!cleanString(candidate.model)) {
    missing.push("Model")
  }

  if (!cleanString(candidate.mpn)) {
    missing.push("MPN")
  }

  if (!cleanString(candidate.material)) {
    missing.push("Material")
  }

  return missing
}

function getBlockingRiskFlags(candidate) {
  const flags = []

  if (
    normalizeRisk(candidate.brandRisk) === "high" ||
    normalizeRisk(candidate.veroRisk) === "high"
  ) {
    flags.push("brand_or_vero_high")
  }

  if (
    normalizeRisk(candidate.medicalClaimsRisk) === "high"
  ) {
    flags.push("medical_claims_high")
  }

  if (
    normalizeRisk(candidate.restrictedProductRisk) === "high"
  ) {
    flags.push("restricted_product_high")
  }

  return flags
}

function getMissingData(candidate, listingProposal) {
  const missing = []

  if (!hasPositiveNumber(candidate.weight)) {
    missing.push("weight")
  }

  if (!hasDimensions(candidate.dimensions)) {
    missing.push("dimensions")
  }

  if (
    normalizeRisk(candidate.imageAuthorizationStatus) === "unknown"
  ) {
    missing.push("imageAuthorizationStatus")
  }

  if (
    candidate.stockAvailable === null ||
    candidate.stockAvailable === undefined ||
    cleanString(candidate.stockStatus).toLowerCase() === "unknown"
  ) {
    missing.push("stock")
  }

  return uniqueItems([
    ...missing,
    ...listingProposal.itemSpecifics.missing,
  ])
}

function getMarketPriceReview(candidate) {
  const estimatedPrice =
    toNumber(candidate.estimatedEbayPrice)

  const soldMedian =
    toNumber(candidate.soldCompsMedianPrice)

  if (
    estimatedPrice === null ||
    soldMedian === null ||
    soldMedian <= 0
  ) {
    return false
  }

  return estimatedPrice > soldMedian * 1.1
}

function getListingState({
  blockingRiskFlags,
  missingData,
  priceProposal,
  listingProposal,
}) {
  if (blockingRiskFlags.length > 0) {
    return LISTING_STATES.BLOCKED
  }

  if (missingData.length > 0) {
    return LISTING_STATES.DATA_INCOMPLETE
  }

  if (
    priceProposal.priceReviewRequired ||
    listingProposal.category.requiresHumanConfirmation ||
    listingProposal.description.copyRiskFlags.length > 0
  ) {
    return LISTING_STATES.REVIEW_REQUIRED
  }

  return LISTING_STATES.DRAFT_READY
}

export function buildSourceBlock(candidate = {}, options = {}) {
  return {
    productCandidateId:
      cleanString(
        options.productCandidateId ||
          candidate.productCandidateId ||
          candidate.internalSku
      ) || null,
    sourceCaseId:
      cleanString(
        options.sourceCaseId ||
          candidate.caseId
      ) || null,
    sourceType:
      cleanString(
        options.sourceType ||
          candidate.sourceType
      ) || "local_candidate",
    selectionDecision:
      cleanString(
        options.selectionDecision ||
          candidate.selectionDecision
      ) || null,
    selectionState:
      cleanString(
        options.selectionState ||
          candidate.selectionState
      ) || null,
    selectedAt:
      options.selectedAt ?? null,
    notes:
      cleanString(options.notes) ||
      "Generated from a local dry-run candidate.",
  }
}

export function buildTitleProposal(candidate = {}, options = {}) {
  const title =
    sanitizeTitle(
      options.title ||
        getCandidateTitle(candidate)
    )

  return {
    value:
      title,
    keywordsUsed:
      getTitleKeywords(title),
    excludedKeywords:
      [],
    titleRiskFlags:
      getTitleRiskFlags(title),
    notes:
      "Generated from candidate title. Human review required.",
  }
}

export function buildCategoryProposal(candidate = {}, options = {}) {
  const categoryName =
    cleanString(
      options.categoryName ||
        candidate.category ||
        candidate.categoryGuess ||
        candidate.productType
    )

  return {
    categoryName:
      categoryName || null,
    categoryId:
      cleanString(
        options.categoryId ||
          candidate.categoryId
      ) || null,
    categoryConfidence:
      cleanString(
        options.categoryConfidence ||
          candidate.categoryConfidence
      ) || (categoryName ? "medium" : "unknown"),
    categoryNotes:
      categoryName
        ? "Category is estimated and requires human confirmation."
        : "Category missing. Human confirmation required.",
    requiresHumanConfirmation:
      !cleanString(
        options.categoryId ||
          candidate.categoryId
      ),
  }
}

export function buildPriceProposal(candidate = {}, options = {}) {
  const economics =
    calculateProductEconomics(
      candidate,
      options.productSelectionConfig || {}
    )

  const marketPriceReview =
    getMarketPriceReview(candidate)

  const priceReviewRequired =
    marketPriceReview ||
    economics.netProfit < economics.thresholds.minimumProfitUsd ||
    economics.roiPercent < economics.thresholds.minimumRoiPercent ||
    economics.netMarginPercent <
      economics.thresholds.recommendedNetMarginPercent

  return {
    listingPrice:
      economics.estimatedEbayPrice,
    currency:
      cleanString(candidate.currency) || "USD",
    soldCompsMedianPrice:
      toNumber(candidate.soldCompsMedianPrice),
    supplierCost:
      economics.supplierCost,
    supplierShippingCost:
      economics.estimatedShippingCost,
    buyerShippingCharge:
      economics.buyerShippingCharge,
    estimatedFees:
      economics.estimatedEbayFees,
    estimatedProfit:
      economics.netProfit,
    estimatedRoiPercent:
      economics.roiPercent,
    estimatedNetMarginPercent:
      economics.netMarginPercent,
    priceReviewRequired,
    priceNotes:
      marketPriceReview
        ? "Listing price is more than 10% above sold comps median."
        : "Economics generated locally for dry-run review.",
  }
}

export function buildItemSpecificsProposal(candidate = {}) {
  const required = {}
  const recommended = {}

  if (cleanString(candidate.brand)) {
    required.Brand =
      cleanString(candidate.brand)
  }

  if (cleanString(candidate.productType)) {
    required.Type =
      cleanString(candidate.productType)
  }

  if (cleanString(candidate.color)) {
    required.Color =
      cleanString(candidate.color)
  }

  if (cleanString(candidate.material)) {
    recommended.Material =
      cleanString(candidate.material)
  }

  if (cleanString(candidate.size)) {
    recommended.Size =
      cleanString(candidate.size)
  }

  if (cleanString(candidate.model)) {
    recommended.Model =
      cleanString(candidate.model)
  }

  if (cleanString(candidate.mpn)) {
    recommended.MPN =
      cleanString(candidate.mpn)
  }

  if (Array.isArray(candidate.features)) {
    recommended.Features =
      candidate.features
        .map(cleanString)
        .filter(Boolean)
  }

  return {
    required,
    recommended,
    missing:
      getMissingItemSpecifics(candidate),
    notes:
      "Only candidate-provided item specifics are included. Missing fields require human confirmation.",
  }
}

export function buildDescriptionProposal(candidate = {}, options = {}) {
  const title =
    sanitizeTitle(
      options.title ||
        getCandidateTitle(candidate)
    )

  const copyRiskFlags =
    getTitleRiskFlags(title)

  const technicalDetails = []

  if (hasPositiveNumber(candidate.weight)) {
    const weight =
      normalizeWeight(
        candidate.weight,
        candidate.weightUnit
      )
    technicalDetails.push(
      `Weight: ${weight.value} ${weight.unit}`
    )
  }

  if (hasDimensions(candidate.dimensions)) {
    const dimensions =
      normalizeDimensions(candidate.dimensions)
    technicalDetails.push(
      `Dimensions: ${dimensions.length} x ${dimensions.width} x ${dimensions.height} ${dimensions.unit}`
    )
  }

  return {
    headline:
      `${title} for everyday use.`,
    benefitBullets:
      [
        "Practical design for routine organization and storage.",
        "Candidate details require human review before any real listing step.",
        "Generated as internal dry-run copy only.",
      ],
    technicalDetails,
    packageIncludes:
      cleanString(candidate.packageIncludes)
        ? [cleanString(candidate.packageIncludes)]
        : ["Package contents require human confirmation."],
    recommendedUse:
      cleanString(candidate.recommendedUse) ||
      "General household or workspace use, pending human review.",
    safetyNotes:
      [],
    shippingAndReturnsSummary:
      "Shipping and returns require human confirmation before any real listing step.",
    fullDescription:
      `${title}. This internal proposal uses only local candidate data and requires human review before any manual preparation.`,
    copyRiskFlags,
  }
}

export function buildImagePlan(candidate = {}) {
  const authorizationStatus =
    cleanString(candidate.imageAuthorizationStatus) ||
    "unknown"

  return [
    {
      slot:
        1,
      purpose:
        "main",
      imageStatus:
        authorizationStatus === "authorized"
          ? "needed"
          : "pending_authorization",
      authorizationStatus,
      notes:
        authorizationStatus === "authorized"
          ? "Use only authorized or original images."
          : "Image authorization must be confirmed before final listing review.",
    },
  ]
}

export function buildShippingPlan(candidate = {}) {
  return {
    weight:
      normalizeWeight(
        candidate.weight,
        candidate.weightUnit
      ),
    dimensions:
      normalizeDimensions(candidate.dimensions),
    shippingMethod:
      cleanString(candidate.shippingMethod) ||
      "standard_review_required",
    estimatedShippingCost:
      toNumber(candidate.supplierShippingCost),
    handlingTime:
      cleanString(candidate.handlingTime) ||
      "requires human confirmation",
    shippingRiskFlags:
      uniqueItems([
        normalizeRisk(candidate.fragilityRisk) === "high"
          ? "fragility_high"
          : null,
        normalizeRisk(candidate.shippingSpeedRisk) === "high"
          ? "shipping_speed_high"
          : null,
        !hasPositiveNumber(candidate.weight)
          ? "missing_weight"
          : null,
        !hasDimensions(candidate.dimensions)
          ? "missing_dimensions"
          : null,
      ]),
    shippingNotes:
      "Shipping plan generated locally and requires human confirmation.",
  }
}

export function buildReturnPlan(candidate = {}) {
  return {
    returnsAccepted:
      candidate.returnsAccepted ?? true,
    returnWindowDays:
      toNumber(candidate.returnWindowDays) ?? 30,
    buyerPaysReturnShipping:
      candidate.buyerPaysReturnShipping ?? false,
    returnRiskLevel:
      normalizeRisk(candidate.returnRisk),
    returnNotes:
      "Return plan generated locally and requires human confirmation.",
  }
}

export function buildComplianceBlock(candidate = {}) {
  const blockedReasons =
    getBlockingRiskFlags(candidate)

  const imageAuthorizationStatus =
    cleanString(candidate.imageAuthorizationStatus) ||
    "unknown"

  return {
    brandRisk:
      normalizeRisk(candidate.brandRisk),
    veroRisk:
      normalizeRisk(candidate.veroRisk),
    medicalClaimsRisk:
      normalizeRisk(candidate.medicalClaimsRisk),
    restrictedProductRisk:
      normalizeRisk(candidate.restrictedProductRisk),
    imageAuthorizationStatus,
    complianceStatus:
      blockedReasons.length > 0
        ? "blocked"
        : imageAuthorizationStatus === "unknown"
          ? "incomplete"
          : "pending_human_review",
    complianceNotes:
      blockedReasons.length > 0
        ? ["Critical risk requires human review before any listing step."]
        : ["Compliance generated from local candidate risk fields."],
    blockedReasons,
  }
}

export function buildSafetyBlock() {
  return {
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
}

export function buildReviewBlock(candidate = {}, listingProposal = {}, options = {}) {
  const blockingRiskFlags =
    getBlockingRiskFlags(candidate)

  const missingData =
    getMissingData(
      candidate,
      listingProposal
    )

  const riskFlags =
    uniqueItems([
      ...blockingRiskFlags,
      ...listingProposal.title.titleRiskFlags,
      ...listingProposal.description.copyRiskFlags,
      ...listingProposal.shippingPlan.shippingRiskFlags,
      listingProposal.price.priceReviewRequired
        ? "price_review_required"
        : null,
      normalizeRisk(candidate.imageAuthorizationStatus) === "unknown"
        ? "image_authorization_missing"
        : null,
      normalizeRisk(candidate.returnRisk) === "high"
        ? "return_risk_high"
        : null,
    ])

  const listingState =
    getListingState({
      blockingRiskFlags,
      missingData,
      priceProposal:
        listingProposal.price,
      listingProposal,
    })

  return {
    listingState,
    reviewStatus:
      listingState === LISTING_STATES.BLOCKED
        ? "blocked"
        : listingState === LISTING_STATES.DATA_INCOMPLETE
          ? "data_incomplete"
          : "pending_human_review",
    requiredHumanActions:
      uniqueItems([
        "Review generated proposal before any manual listing step.",
        listingProposal.category.requiresHumanConfirmation
          ? "Confirm eBay category."
          : null,
        missingData.length > 0
          ? "Complete missing listing data."
          : null,
        riskFlags.length > 0
          ? "Review risk flags."
          : null,
        "Confirm image rights.",
      ]),
    missingData,
    riskFlags,
    approvalNotes:
      options.approvalNotes ?? null,
    reviewedBy:
      null,
    reviewedAt:
      null,
  }
}

export function buildListingProposalFromCandidate(candidate = {}, options = {}) {
  const title =
    buildTitleProposal(
      candidate,
      options
    )

  const listingProposal = {
    title,
    subtitle:
      cleanString(candidate.subtitle) || null,
    category:
      buildCategoryProposal(
        candidate,
        options
      ),
    condition:
      cleanString(candidate.condition) || "New",
    price:
      buildPriceProposal(
        candidate,
        options
      ),
    quantity:
      Math.max(
        0,
        Math.min(
          toNumber(candidate.stockAvailable) ?? 1,
          1
        )
      ),
    itemSpecifics:
      buildItemSpecificsProposal(candidate),
    description:
      buildDescriptionProposal(candidate, {
        ...options,
        title:
          title.value,
      }),
    shippingPlan:
      buildShippingPlan(candidate),
    returnPlan:
      buildReturnPlan(candidate),
    imagePlan:
      buildImagePlan(candidate),
    complianceNotes:
      buildComplianceBlock(candidate).complianceNotes,
    humanReviewRequired:
      true,
    advisoryOnly:
      true,
  }

  const compliance =
    buildComplianceBlock(candidate)

  const review =
    buildReviewBlock(
      candidate,
      listingProposal,
      options
    )

  return {
    schemaVersion:
      EBAY_LISTING_DRAFT_SCHEMA_VERSION,
    source:
      buildSourceBlock(
        candidate,
        options
      ),
    listingProposal: {
      ...listingProposal,
      compliance,
    },
    review,
    safety:
      buildSafetyBlock(),
  }
}
