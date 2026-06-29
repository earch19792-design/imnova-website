export const EBAY_LISTING_QA_RESULT_SCHEMA_VERSION =
  "EBAY_LISTING_QA_RESULT_V1"

export const QA_STATES = {
  INCOMPLETE:
    "QA_INCOMPLETE",
  REVIEW_REQUIRED:
    "QA_REVIEW_REQUIRED",
  BLOCKED:
    "QA_BLOCKED",
  PASSED_FOR_HUMAN_REVIEW:
    "QA_PASSED_FOR_HUMAN_REVIEW",
}

const REQUIRED_SAFETY_FLAGS = {
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

function uniqueItems(items) {
  return [
    ...new Set(
      items.filter(Boolean)
    ),
  ]
}

function hasPositiveNumber(value) {
  const numericValue =
    toNumber(value)

  return (
    numericValue !== null &&
    numericValue > 0
  )
}

function hasUsableWeight(value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return hasPositiveNumber(value.value)
  }

  return hasPositiveNumber(value)
}

function hasUsableDimensions(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      hasPositiveNumber(value.length) &&
      hasPositiveNumber(value.width) &&
      hasPositiveNumber(value.height)
  )
}

function getProposalBlock(proposal, key) {
  return proposal?.listingProposal?.[key] || {}
}

function makeCheck({
  name,
  passed = true,
  warnings = [],
  missingData = [],
  riskFlags = [],
  blockedReasons = [],
  requiredHumanActions = [],
}) {
  return {
    name,
    passed,
    warnings:
      uniqueItems(warnings),
    missingData:
      uniqueItems(missingData),
    riskFlags:
      uniqueItems(riskFlags),
    blockedReasons:
      uniqueItems(blockedReasons),
    requiredHumanActions:
      uniqueItems(requiredHumanActions),
  }
}

export function evaluateSourceQa(proposal = {}) {
  const source =
    proposal.source || {}

  const selectionDecision =
    cleanString(source.selectionDecision).toLowerCase()
  const selectionState =
    cleanString(source.selectionState)

  const blocked =
    selectionDecision === "blocked" ||
    selectionDecision === "reject" ||
    selectionState === "BLOCKED" ||
    selectionState === "REJECTED"

  const missingData = []

  if (
    !cleanString(source.sourceCaseId) &&
    !cleanString(source.productCandidateId)
  ) {
    missingData.push("source")
  }

  return makeCheck({
    name:
      "source",
    passed:
      !blocked && missingData.length === 0,
    missingData,
    blockedReasons:
      blocked
        ? ["source_not_eligible_for_listing"]
        : [],
    requiredHumanActions:
      missingData.length > 0
        ? ["Confirm source candidate identity."]
        : [],
  })
}

export function evaluateEconomicsQa(proposal = {}) {
  const price =
    getProposalBlock(
      proposal,
      "price"
    )

  const riskFlags = []
  const missingData = []

  if (!hasPositiveNumber(price.listingPrice)) {
    missingData.push("listingPrice")
  }

  if (price.priceReviewRequired === true) {
    riskFlags.push("price_review_required")
  }

  if (
    toNumber(price.estimatedProfit) !== null &&
    toNumber(price.estimatedProfit) < 5
  ) {
    riskFlags.push("profit_below_minimum")
  }

  if (
    toNumber(price.estimatedRoiPercent) !== null &&
    toNumber(price.estimatedRoiPercent) < 30
  ) {
    riskFlags.push("roi_below_minimum")
  }

  if (
    toNumber(price.estimatedNetMarginPercent) !== null &&
    toNumber(price.estimatedNetMarginPercent) < 20
  ) {
    riskFlags.push("margin_below_recommended")
  }

  return makeCheck({
    name:
      "economics",
    passed:
      missingData.length === 0 &&
      riskFlags.length === 0,
    missingData,
    riskFlags,
    requiredHumanActions:
      riskFlags.length > 0
        ? ["Review listing economics before any manual listing step."]
        : [],
  })
}

export function evaluateTitleQa(proposal = {}) {
  const title =
    getProposalBlock(
      proposal,
      "title"
    )

  const missingData = []
  const riskFlags = [
    ...(title.titleRiskFlags || []),
  ]

  if (!cleanString(title.value)) {
    missingData.push("title")
  }

  return makeCheck({
    name:
      "title",
    passed:
      missingData.length === 0 &&
      riskFlags.length === 0,
    missingData,
    riskFlags,
    requiredHumanActions:
      riskFlags.length > 0
        ? ["Review title copy for risky phrases or keyword stuffing."]
        : [],
  })
}

export function evaluateDescriptionQa(proposal = {}) {
  const description =
    getProposalBlock(
      proposal,
      "description"
    )

  const missingData = []
  const riskFlags = [
    ...(description.copyRiskFlags || []),
  ]

  if (!cleanString(description.headline)) {
    missingData.push("description.headline")
  }

  if (!cleanString(description.fullDescription)) {
    missingData.push("description.fullDescription")
  }

  return makeCheck({
    name:
      "description",
    passed:
      missingData.length === 0 &&
      riskFlags.length === 0,
    missingData,
    riskFlags,
    requiredHumanActions:
      riskFlags.length > 0
        ? ["Review description copy before manual listing preparation."]
        : [],
  })
}

export function evaluateItemSpecificsQa(proposal = {}) {
  const itemSpecifics =
    getProposalBlock(
      proposal,
      "itemSpecifics"
    )

  const missingData =
    Array.isArray(itemSpecifics.missing)
      ? itemSpecifics.missing
      : []

  return makeCheck({
    name:
      "itemSpecifics",
    passed:
      missingData.length === 0,
    missingData,
    requiredHumanActions:
      missingData.length > 0
        ? ["Complete missing item specifics."]
        : [],
  })
}

export function evaluateImageQa(proposal = {}) {
  const listingProposal =
    proposal.listingProposal || {}
  const imagePlan =
    Array.isArray(listingProposal.imagePlan)
      ? listingProposal.imagePlan
      : []
  const compliance =
    listingProposal.compliance || {}

  const missingData = []
  const riskFlags = []
  const blockedReasons = []

  if (imagePlan.length === 0) {
    missingData.push("imagePlan")
  }

  const authorizationStatuses =
    imagePlan.map(item =>
      normalizeRisk(item.authorizationStatus)
    )

  if (
    normalizeRisk(compliance.imageAuthorizationStatus) === "unknown" ||
    authorizationStatuses.includes("unknown")
  ) {
    missingData.push("imageAuthorizationStatus")
    riskFlags.push("image_authorization_missing")
  }

  if (
    authorizationStatuses.includes("high") ||
    authorizationStatuses.includes("blocked")
  ) {
    blockedReasons.push("image_not_authorized")
  }

  return makeCheck({
    name:
      "images",
    passed:
      missingData.length === 0 &&
      blockedReasons.length === 0,
    missingData,
    riskFlags,
    blockedReasons,
    requiredHumanActions:
      missingData.length > 0 || blockedReasons.length > 0
        ? ["Confirm image rights before final listing review."]
        : [],
  })
}

export function evaluateShippingQa(proposal = {}) {
  const shippingPlan =
    getProposalBlock(
      proposal,
      "shippingPlan"
    )

  const missingData = []
  const riskFlags = [
    ...(shippingPlan.shippingRiskFlags || []),
  ].filter(flag =>
    ![
      "missing_weight",
      "missing_dimensions",
    ].includes(flag)
  )

  if (!hasUsableWeight(shippingPlan.weight)) {
    missingData.push("weight")
  }

  if (!hasUsableDimensions(shippingPlan.dimensions)) {
    missingData.push("dimensions")
  }

  return makeCheck({
    name:
      "shipping",
    passed:
      missingData.length === 0 &&
      riskFlags.length === 0,
    missingData,
    riskFlags,
    requiredHumanActions:
      missingData.length > 0 || riskFlags.length > 0
        ? ["Review shipping data before manual listing preparation."]
        : [],
  })
}

export function evaluateReturnQa(proposal = {}) {
  const returnPlan =
    getProposalBlock(
      proposal,
      "returnPlan"
    )

  const risk =
    normalizeRisk(returnPlan.returnRiskLevel)

  const riskFlags =
    ["medium", "high"].includes(risk)
      ? [`return_risk_${risk}`]
      : []

  return makeCheck({
    name:
      "returns",
    passed:
      riskFlags.length === 0,
    riskFlags,
    requiredHumanActions:
      riskFlags.length > 0
        ? ["Review return policy against product risk."]
        : [],
  })
}

export function evaluateComplianceQa(proposal = {}) {
  const compliance =
    getProposalBlock(
      proposal,
      "compliance"
    )

  const blockedReasons =
    uniqueItems([
      ...(compliance.blockedReasons || []),
      normalizeRisk(compliance.brandRisk) === "high" ||
      normalizeRisk(compliance.veroRisk) === "high"
        ? "brand_or_vero_high"
        : null,
      normalizeRisk(compliance.medicalClaimsRisk) === "high"
        ? "medical_claims_high"
        : null,
      normalizeRisk(compliance.restrictedProductRisk) === "high"
        ? "restricted_product_high"
        : null,
      cleanString(compliance.complianceStatus).toLowerCase() === "blocked"
        ? "compliance_blocked"
        : null,
    ])

  const missingData =
    normalizeRisk(compliance.imageAuthorizationStatus) === "unknown"
      ? ["imageAuthorizationStatus"]
      : []

  const riskFlags =
    cleanString(compliance.complianceStatus).toLowerCase() === "unresolved"
      ? ["compliance_unresolved"]
      : []

  return makeCheck({
    name:
      "compliance",
    passed:
      blockedReasons.length === 0 &&
      missingData.length === 0 &&
      riskFlags.length === 0,
    missingData,
    riskFlags,
    blockedReasons,
    requiredHumanActions:
      blockedReasons.length > 0 ||
      missingData.length > 0 ||
      riskFlags.length > 0
        ? ["Resolve compliance review before any listing step."]
        : [],
  })
}

export function evaluateSafetyQa(proposal = {}) {
  const safety =
    proposal.safety || {}

  const blockedReasons = []

  for (const [key, expectedValue] of Object.entries(REQUIRED_SAFETY_FLAGS)) {
    if (safety[key] !== expectedValue) {
      blockedReasons.push(`invalid_safety_${key}`)
    }
  }

  if (proposal.listingProposal?.advisoryOnly !== true) {
    blockedReasons.push("invalid_listing_advisoryOnly")
  }

  if (proposal.listingProposal?.humanReviewRequired !== true) {
    blockedReasons.push("invalid_listing_humanReviewRequired")
  }

  return makeCheck({
    name:
      "safety",
    passed:
      blockedReasons.length === 0,
    blockedReasons,
    requiredHumanActions:
      blockedReasons.length > 0
        ? ["Block proposal because V1 safety flags were violated."]
        : [],
  })
}

function evaluateProposalReviewQa(proposal = {}) {
  const review =
    proposal.review || {}

  return makeCheck({
    name:
      "proposalReview",
    passed:
      (review.missingData || []).length === 0 &&
      (review.riskFlags || []).length === 0,
    missingData:
      review.missingData || [],
    riskFlags:
      review.riskFlags || [],
    requiredHumanActions:
      review.requiredHumanActions || [],
  })
}

export function determineQaState(checkResults = []) {
  const blockedReasons =
    checkResults.flatMap(check =>
      check.blockedReasons || []
    )
  const missingData =
    checkResults.flatMap(check =>
      check.missingData || []
    )
  const riskFlags =
    checkResults.flatMap(check =>
      check.riskFlags || []
    )

  if (blockedReasons.length > 0) {
    return QA_STATES.BLOCKED
  }

  if (missingData.length > 0) {
    return QA_STATES.INCOMPLETE
  }

  if (riskFlags.length > 0) {
    return QA_STATES.REVIEW_REQUIRED
  }

  return QA_STATES.PASSED_FOR_HUMAN_REVIEW
}

export function buildQaResult(proposal = {}, checkResults = [], options = {}) {
  const qaState =
    options.qaState ||
    determineQaState(checkResults)

  return {
    schemaVersion:
      EBAY_LISTING_QA_RESULT_SCHEMA_VERSION,
    qaState,
    advisoryOnly:
      true,
    humanReviewRequired:
      true,
    passedChecks:
      checkResults
        .filter(check =>
          check.passed
        )
        .map(check =>
          check.name
        ),
    failedChecks:
      checkResults
        .filter(check =>
          !check.passed
        )
        .map(check =>
          check.name
        ),
    warnings:
      uniqueItems(
        checkResults.flatMap(check =>
          check.warnings || []
        )
      ),
    missingData:
      uniqueItems(
        checkResults.flatMap(check =>
          check.missingData || []
        )
      ),
    riskFlags:
      uniqueItems(
        checkResults.flatMap(check =>
          check.riskFlags || []
        )
      ),
    blockedReasons:
      uniqueItems(
        checkResults.flatMap(check =>
          check.blockedReasons || []
        )
      ),
    requiredHumanActions:
      uniqueItems([
        ...checkResults.flatMap(check =>
          check.requiredHumanActions || []
        ),
        "Human review required before any manual listing step.",
      ]),
    safety: {
      ...REQUIRED_SAFETY_FLAGS,
    },
  }
}

export function evaluateListingProposalQa(proposal = {}, options = {}) {
  const checkResults = [
    evaluateSourceQa(
      proposal,
      options
    ),
    evaluateEconomicsQa(
      proposal,
      options
    ),
    evaluateTitleQa(
      proposal,
      options
    ),
    evaluateDescriptionQa(
      proposal,
      options
    ),
    evaluateItemSpecificsQa(
      proposal,
      options
    ),
    evaluateImageQa(
      proposal,
      options
    ),
    evaluateShippingQa(
      proposal,
      options
    ),
    evaluateReturnQa(
      proposal,
      options
    ),
    evaluateComplianceQa(
      proposal,
      options
    ),
    evaluateProposalReviewQa(
      proposal,
      options
    ),
    evaluateSafetyQa(
      proposal,
      options
    ),
  ]

  return buildQaResult(
    proposal,
    checkResults,
    options
  )
}
