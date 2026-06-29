export const EBAY_LISTING_PROPOSAL_REVIEW_REPORT_VERSION =
  "EBAY_LISTING_PROPOSAL_REVIEW_REPORT_V1"

export const REVIEW_REPORT_DECISIONS = {
  PROCEED_TO_HUMAN_REVIEW:
    "PROCEED_TO_HUMAN_REVIEW",
  COMPLETE_MISSING_DATA:
    "COMPLETE_MISSING_DATA",
  REVIEW_ECONOMICS:
    "REVIEW_ECONOMICS",
  REVIEW_COMPLIANCE:
    "REVIEW_COMPLIANCE",
  BLOCK_DO_NOT_ADVANCE:
    "BLOCK_DO_NOT_ADVANCE",
  DISCARD_CANDIDATE:
    "DISCARD_CANDIDATE",
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

const ECONOMICS_RISK_FLAGS = new Set([
  "price_review_required",
  "profit_below_minimum",
  "roi_below_minimum",
  "margin_below_recommended",
])

const COMPLIANCE_RISK_FLAGS = new Set([
  "brand_or_vero_high",
  "medical_claims_high",
  "restricted_product_high",
  "restricted_product_risk",
  "compliance_blocked",
  "compliance_unresolved",
  "image_authorization_missing",
  "image_not_authorized",
  "unauthorized_images",
])

function cleanString(value) {
  return typeof value === "string"
    ? value.trim()
    : ""
}

function uniqueItems(items = []) {
  return [
    ...new Set(
      items.filter(Boolean)
    ),
  ]
}

function isPlainObject(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value)
}

function getProposalOutput(input = {}) {
  return input.listingProposalOutput || {}
}

function getListingProposal(input = {}) {
  return getProposalOutput(input).listingProposal || {}
}

function getReview(input = {}) {
  return getProposalOutput(input).review || {}
}

function getQaResult(input = {}) {
  return input.qaResult || {}
}

function getCandidate(input = {}) {
  return input.candidate || {}
}

function getSafety(input = {}) {
  return {
    ...REQUIRED_SAFETY_FLAGS,
    ...(getProposalOutput(input).safety || {}),
    ...(getQaResult(input).safety || {}),
  }
}

function hasAny(items = [], candidates = new Set()) {
  return items.some(item =>
    candidates.has(item)
  )
}

function getSource(input = {}) {
  return getProposalOutput(input).source || {}
}

export function buildReportHeader(input = {}, options = {}) {
  const proposalOutput =
    getProposalOutput(input)
  const review =
    getReview(input)
  const qa =
    getQaResult(input)
  const listingProposal =
    getListingProposal(input)

  return {
    reportVersion:
      EBAY_LISTING_PROPOSAL_REVIEW_REPORT_VERSION,
    generatedAt:
      options.generatedAt ?? null,
    caseId:
      cleanString(input.caseId) ||
      cleanString(getSource(input).sourceCaseId) ||
      null,
    candidateName:
      cleanString(input.name) ||
      cleanString(getCandidate(input).name) ||
      cleanString(getCandidate(input).title) ||
      null,
    schemaVersion:
      proposalOutput.schemaVersion || null,
    listingState:
      review.listingState || null,
    qaState:
      qa.qaState || null,
    advisoryOnly:
      listingProposal.advisoryOnly === true,
    humanReviewRequired:
      listingProposal.humanReviewRequired === true ||
      qa.humanReviewRequired === true,
  }
}

export function determineRecommendedDecision(input = {}) {
  const review =
    getReview(input)
  const qa =
    getQaResult(input)
  const riskFlags =
    uniqueItems([
      ...(review.riskFlags || []),
      ...(qa.riskFlags || []),
    ])

  if (
    review.listingState === "LISTING_BLOCKED" ||
    qa.qaState === "QA_BLOCKED" ||
    (qa.blockedReasons || []).length > 0
  ) {
    return REVIEW_REPORT_DECISIONS.BLOCK_DO_NOT_ADVANCE
  }

  if (qa.qaState === "QA_INCOMPLETE") {
    return REVIEW_REPORT_DECISIONS.COMPLETE_MISSING_DATA
  }

  if (qa.qaState === "QA_REVIEW_REQUIRED") {
    if (hasAny(riskFlags, ECONOMICS_RISK_FLAGS)) {
      return REVIEW_REPORT_DECISIONS.REVIEW_ECONOMICS
    }

    if (hasAny(riskFlags, COMPLIANCE_RISK_FLAGS)) {
      return REVIEW_REPORT_DECISIONS.REVIEW_COMPLIANCE
    }

    return REVIEW_REPORT_DECISIONS.REVIEW_COMPLIANCE
  }

  if (
    review.listingState === "LISTING_DRAFT_READY" &&
    qa.qaState === "QA_PASSED_FOR_HUMAN_REVIEW"
  ) {
    return REVIEW_REPORT_DECISIONS.PROCEED_TO_HUMAN_REVIEW
  }

  return REVIEW_REPORT_DECISIONS.COMPLETE_MISSING_DATA
}

export function buildExecutiveSummary(input = {}, options = {}) {
  const decision =
    options.recommendedDecision ||
    determineRecommendedDecision(input)
  const qa =
    getQaResult(input)
  const review =
    getReview(input)
  const missingData =
    uniqueItems([
      ...(review.missingData || []),
      ...(qa.missingData || []),
    ])
  const riskFlags =
    uniqueItems([
      ...(review.riskFlags || []),
      ...(qa.riskFlags || []),
    ])
  const blockedReasons =
    uniqueItems([
      ...(getListingProposal(input).compliance?.blockedReasons || []),
      ...(qa.blockedReasons || []),
    ])

  let summary =
    "Review required."

  if (decision === REVIEW_REPORT_DECISIONS.PROCEED_TO_HUMAN_REVIEW) {
    summary =
      "Ready for human review."
  } else if (decision === REVIEW_REPORT_DECISIONS.COMPLETE_MISSING_DATA) {
    summary =
      `Incomplete: missing ${missingData.join(", ") || "required data"}.`
  } else if (decision === REVIEW_REPORT_DECISIONS.REVIEW_ECONOMICS) {
    summary =
      "Review required: weak margin or price above market."
  } else if (decision === REVIEW_REPORT_DECISIONS.REVIEW_COMPLIANCE) {
    summary =
      "Review required: compliance or risk review needed."
  } else if (decision === REVIEW_REPORT_DECISIONS.BLOCK_DO_NOT_ADVANCE) {
    summary =
      `Blocked: ${blockedReasons.join(", ") || riskFlags.join(", ") || "critical risk"}.`
  }

  return {
    summary,
    canProceedToHumanReview:
      decision === REVIEW_REPORT_DECISIONS.PROCEED_TO_HUMAN_REVIEW,
    isIncomplete:
      decision === REVIEW_REPORT_DECISIONS.COMPLETE_MISSING_DATA,
    requiresReview:
      [
        REVIEW_REPORT_DECISIONS.REVIEW_ECONOMICS,
        REVIEW_REPORT_DECISIONS.REVIEW_COMPLIANCE,
      ].includes(decision),
    isBlocked:
      decision === REVIEW_REPORT_DECISIONS.BLOCK_DO_NOT_ADVANCE,
    primaryReason:
      blockedReasons[0] ||
      missingData[0] ||
      riskFlags[0] ||
      "none",
  }
}

export function buildCandidateSourceSection(input = {}) {
  const source =
    getSource(input)

  return {
    sourceType:
      source.sourceType || null,
    sourceCaseId:
      source.sourceCaseId || input.caseId || null,
    selectionDecision:
      source.selectionDecision || null,
    selectionState:
      source.selectionState || null,
    productCandidateId:
      source.productCandidateId || null,
    notes:
      source.notes || null,
  }
}

export function buildListingProposalSummary(input = {}) {
  const listingProposal =
    getListingProposal(input)
  const review =
    getReview(input)

  return {
    title:
      listingProposal.title?.value || null,
    category:
      listingProposal.category?.categoryName || null,
    condition:
      listingProposal.condition || null,
    listingPrice:
      listingProposal.price?.listingPrice ?? null,
    quantity:
      listingProposal.quantity ?? null,
    listingState:
      review.listingState || null,
    humanReviewRequired:
      listingProposal.humanReviewRequired === true,
    advisoryOnly:
      listingProposal.advisoryOnly === true,
  }
}

export function buildQaResultSummary(input = {}) {
  const qa =
    getQaResult(input)

  return {
    qaState:
      qa.qaState || null,
    passedChecks:
      qa.passedChecks || [],
    failedChecks:
      qa.failedChecks || [],
    warnings:
      qa.warnings || [],
    missingData:
      qa.missingData || [],
    riskFlags:
      qa.riskFlags || [],
    blockedReasons:
      qa.blockedReasons || [],
    requiredHumanActions:
      qa.requiredHumanActions || [],
  }
}

export function buildEconomicsReview(input = {}) {
  const price =
    getListingProposal(input).price || {}
  const riskFlags =
    uniqueItems([
      ...(getReview(input).riskFlags || []),
      ...(getQaResult(input).riskFlags || []),
    ])

  return {
    listingPrice:
      price.listingPrice ?? null,
    supplierCost:
      price.supplierCost ?? null,
    supplierShippingCost:
      price.supplierShippingCost ?? null,
    buyerShippingCharge:
      price.buyerShippingCharge ?? null,
    estimatedFees:
      price.estimatedFees ?? null,
    estimatedProfit:
      price.estimatedProfit ?? null,
    estimatedRoiPercent:
      price.estimatedRoiPercent ?? null,
    estimatedNetMarginPercent:
      price.estimatedNetMarginPercent ?? null,
    soldCompsMedianPrice:
      price.soldCompsMedianPrice ?? null,
    economicsStatus:
      price.priceReviewRequired ||
      hasAny(riskFlags, ECONOMICS_RISK_FLAGS)
        ? "review_required"
        : "acceptable",
  }
}

export function buildMissingDataSection(input = {}) {
  return uniqueItems([
    ...(getReview(input).missingData || []),
    ...(getQaResult(input).missingData || []),
  ])
}

export function buildRiskFlagsSection(input = {}) {
  return uniqueItems([
    ...(getReview(input).riskFlags || []),
    ...(getQaResult(input).riskFlags || []),
  ])
}

export function buildBlockedReasonsSection(input = {}) {
  return uniqueItems([
    ...(getListingProposal(input).compliance?.blockedReasons || []),
    ...(getQaResult(input).blockedReasons || []),
  ])
}

export function buildComplianceReview(input = {}) {
  const compliance =
    getListingProposal(input).compliance || {}

  return {
    brandRisk:
      compliance.brandRisk || "unknown",
    veroRisk:
      compliance.veroRisk || "unknown",
    medicalClaimsRisk:
      compliance.medicalClaimsRisk || "unknown",
    restrictedProductRisk:
      compliance.restrictedProductRisk || "unknown",
    imageAuthorizationStatus:
      compliance.imageAuthorizationStatus || "unknown",
    complianceStatus:
      compliance.complianceStatus || "unknown",
    complianceNotes:
      compliance.complianceNotes || [],
    blockedReasons:
      compliance.blockedReasons || [],
  }
}

export function buildCopywritingReview(input = {}) {
  const listingProposal =
    getListingProposal(input)

  return {
    title:
      listingProposal.title?.value || null,
    titleRiskFlags:
      listingProposal.title?.titleRiskFlags || [],
    copyRiskFlags:
      listingProposal.description?.copyRiskFlags || [],
    benefitBullets:
      listingProposal.description?.benefitBullets || [],
    descriptionConsistentWithItemSpecifics:
      true,
    notes:
      "Copy is generated for internal dry-run review and requires human confirmation.",
  }
}

export function buildImageReview(input = {}) {
  const imagePlan =
    Array.isArray(getListingProposal(input).imagePlan)
      ? getListingProposal(input).imagePlan
      : []

  return {
    imagePlan,
    mainImage:
      imagePlan.find(item =>
        item.purpose === "main"
      ) || null,
    authorizationStatuses:
      uniqueItems(
        imagePlan.map(item =>
          item.authorizationStatus
        )
      ),
    notes:
      imagePlan.map(item =>
        item.notes
      ).filter(Boolean),
  }
}

export function buildShippingReturnsReview(input = {}) {
  const listingProposal =
    getListingProposal(input)

  return {
    weight:
      listingProposal.shippingPlan?.weight || null,
    dimensions:
      listingProposal.shippingPlan?.dimensions || null,
    shippingMethod:
      listingProposal.shippingPlan?.shippingMethod || null,
    handlingTime:
      listingProposal.shippingPlan?.handlingTime || null,
    estimatedShippingCost:
      listingProposal.shippingPlan?.estimatedShippingCost ?? null,
    returnPolicy: {
      returnsAccepted:
        listingProposal.returnPlan?.returnsAccepted ?? null,
      returnWindowDays:
        listingProposal.returnPlan?.returnWindowDays ?? null,
      buyerPaysReturnShipping:
        listingProposal.returnPlan?.buyerPaysReturnShipping ?? null,
    },
    returnRisk:
      listingProposal.returnPlan?.returnRiskLevel || "unknown",
    shippingRiskFlags:
      listingProposal.shippingPlan?.shippingRiskFlags || [],
  }
}

export function buildSafetyFlagsSection(input = {}) {
  const safety =
    getSafety(input)

  return {
    advisoryOnly:
      safety.advisoryOnly === true,
    localOnly:
      safety.localOnly === true,
    externalCallsMade:
      safety.externalCallsMade === true,
    ebayApiUsed:
      safety.ebayApiUsed === true,
    realDraftCreated:
      safety.realDraftCreated === true,
    publishedToEbay:
      safety.publishedToEbay === true,
    listingMutated:
      safety.listingMutated === true,
    requiresHumanReview:
      safety.requiresHumanReview === true,
  }
}

export function buildRequiredHumanActions(input = {}) {
  return uniqueItems([
    ...(getReview(input).requiredHumanActions || []),
    ...(getQaResult(input).requiredHumanActions || []),
  ])
}

export function buildListingProposalReviewReport(input = {}, options = {}) {
  if (!isPlainObject(input)) {
    throw new TypeError("Review report input must be an object.")
  }

  const recommendedDecision =
    determineRecommendedDecision(input, options)

  return {
    reportVersion:
      EBAY_LISTING_PROPOSAL_REVIEW_REPORT_VERSION,
    header:
      buildReportHeader(
        input,
        options
      ),
    executiveSummary:
      buildExecutiveSummary(
        input,
        {
          ...options,
          recommendedDecision,
        }
      ),
    candidateSource:
      buildCandidateSourceSection(input, options),
    listingProposalSummary:
      buildListingProposalSummary(input, options),
    qaResultSummary:
      buildQaResultSummary(input, options),
    economicsReview:
      buildEconomicsReview(input, options),
    missingData:
      buildMissingDataSection(input, options),
    riskFlags:
      buildRiskFlagsSection(input, options),
    blockedReasons:
      buildBlockedReasonsSection(input, options),
    complianceReview:
      buildComplianceReview(input, options),
    copywritingReview:
      buildCopywritingReview(input, options),
    imageReview:
      buildImageReview(input, options),
    shippingReturnsReview:
      buildShippingReturnsReview(input, options),
    safetyFlags:
      buildSafetyFlagsSection(input, options),
    requiredHumanActions:
      buildRequiredHumanActions(input, options),
    recommendedDecision,
    reviewerNotes:
      Array.isArray(options.reviewerNotes)
        ? options.reviewerNotes
        : [],
  }
}
