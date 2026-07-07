export const LUNA_PORTEX_ADVISOR_OS_CANDIDATE_REVIEW_VERSION =
  "LUNA_PORTEX_ADVISOR_OS_CANDIDATE_REVIEW_WHATSAPP_PRICING_V1"

const sourceDataClass =
  "LOOP_145_ADVISOR_OS_CANDIDATE_REVIEW"
const maxAdvisorCandidates =
  10
const prohibitedActions =
  [
    "PUBLISH_LISTING",
    "CREATE_EBAY_DRAFT",
    "SEND_REAL_WHATSAPP",
    "UPDATE_STAGING_DECISION",
    "TOUCH_PRODUCTION",
  ] as const

type WinnerScoreModelEntry = {
  candidateKey?: string | null
  input?: {
    title?: string | null
    soldPriceIntelligence?: {
      priceDataConfidence?: string | null
    } | null
    pricingPsychologyInputs?: {
      priceChangeGuidance?: string | null
    } | null
  } | null
  score?: {
    winnerScore?: number | null
    priceConfidenceScore?: number | null
    priceWarRiskScore?: number | null
    marginProtectionScore?: number | null
    perceivedValueScore?: number | null
    doNotRaceToBottom?: boolean | null
    lowestPriceNotRequired?: boolean | null
  } | null
  buyDirectOpportunity?: {
    buyDirectOpportunityScore?: number | null
    profitUpsidePerUnit?: number | null
    estimatedDirectBuyCost?: number | null
    lunaPortexCost?: number | null
    estimatedCapitalNeeded?: number | null
    capitalRiskLevel?: string | null
    directSourcingDecision?: string | null
    directSourcingReasons?: string[] | null
    minimumDataNeededBeforeBuyingDirect?: string[] | null
  } | null
  readiness?: {
    readyForAdvisorReview?: boolean | null
    readyForListingBuilder?: boolean | null
    blockedReasons?: string[] | null
    warnings?: string[] | null
    nextRecommendedAction?: string | null
  } | null
  sellerDecision?: string | null
}

type AdvisorOptions = {
  maxCandidates?: number | null
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback
}

function normalizeArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function hasBlockedReason(input: ReturnType<typeof buildAdvisorCandidateInput>, reason: string) {
  return input.blockers.includes(reason)
}

export function buildAdvisorCandidateInput(
  winnerScoreModel: WinnerScoreModelEntry,
  options: AdvisorOptions = {},
) {
  void options
  const score =
    winnerScoreModel.score ?? {}
  const buyDirectOpportunity =
    winnerScoreModel.buyDirectOpportunity ?? {}
  const readiness =
    winnerScoreModel.readiness ?? {}
  const input =
    winnerScoreModel.input ?? {}

  return {
    advisorVersion:
      LUNA_PORTEX_ADVISOR_OS_CANDIDATE_REVIEW_VERSION,
    sourceDataClass,
    candidateKey:
      normalizeText(winnerScoreModel.candidateKey) ?? "unknown-candidate",
    productTitle:
      normalizeText(input.title) ?? "Untitled Luna Portex candidate",
    winnerScore:
      normalizeNumber(score.winnerScore, 0),
    sellerDecision:
      normalizeText(winnerScoreModel.sellerDecision) ?? "REVIEW",
    nextRecommendedAction:
      normalizeText(readiness.nextRecommendedAction) ?? "WATCHLIST_MORE_DATA",
    blockers:
      normalizeArray(readiness.blockedReasons),
    warnings:
      normalizeArray(readiness.warnings),
    readyForAdvisorReview:
      readiness.readyForAdvisorReview === true,
    readyForListingBuilder:
      readiness.readyForListingBuilder === true,
    priceDataConfidence:
      normalizeText(input.soldPriceIntelligence?.priceDataConfidence) ?? "LOW",
    priceChangeGuidance:
      normalizeText(input.pricingPsychologyInputs?.priceChangeGuidance) ?? "do_not_lower_price_yet",
    priceConfidenceScore:
      normalizeNumber(score.priceConfidenceScore, 0),
    priceWarRiskScore:
      normalizeNumber(score.priceWarRiskScore, 0),
    marginProtectionScore:
      normalizeNumber(score.marginProtectionScore, 0),
    perceivedValueScore:
      normalizeNumber(score.perceivedValueScore, 0),
    doNotRaceToBottom:
      score.doNotRaceToBottom !== false,
    lowestPriceNotRequired:
      score.lowestPriceNotRequired !== false,
    buyDirectOpportunityScore:
      normalizeNumber(buyDirectOpportunity.buyDirectOpportunityScore, 0),
    profitUpsidePerUnit:
      normalizeNumber(buyDirectOpportunity.profitUpsidePerUnit, 0),
    estimatedDirectBuyCost:
      normalizeNumber(buyDirectOpportunity.estimatedDirectBuyCost, 0),
    lunaPortexCost:
      normalizeNumber(buyDirectOpportunity.lunaPortexCost, 0),
    estimatedCapitalNeeded:
      normalizeNumber(buyDirectOpportunity.estimatedCapitalNeeded, 0),
    capitalRiskLevel:
      normalizeText(buyDirectOpportunity.capitalRiskLevel) ?? "HIGH",
    directSourcingDecision:
      normalizeText(buyDirectOpportunity.directSourcingDecision) ?? "WATCHLIST",
    directSourcingReasons:
      normalizeArray(buyDirectOpportunity.directSourcingReasons),
    minimumDataNeededBeforeBuyingDirect:
      normalizeArray(buyDirectOpportunity.minimumDataNeededBeforeBuyingDirect),
  }
}

export function buildPricingAdvisorRecommendation(
  input: ReturnType<typeof buildAdvisorCandidateInput>,
  options: AdvisorOptions = {},
) {
  void options
  const pricingWarnings =
    unique(
      [
        input.priceWarRiskScore >= 70 ? "price war risk elevated" : null,
        input.priceDataConfidence === "LOW" ? "sold price confidence is low" : null,
        input.marginProtectionScore < 45 ? "margin protection is low" : null,
        hasBlockedReason(input, "missing image") ? "image package should be improved before price changes" : null,
      ].filter((entry): entry is string => entry !== null),
    )
  const priceAction =
    input.priceChangeGuidance === "reject_if_margin_destroyed" || input.marginProtectionScore < 25
      ? "REJECT_IF_MARGIN_DESTROYED"
      : hasBlockedReason(input, "missing image")
        ? "IMPROVE_IMAGE_OR_TITLE_FIRST"
        : input.priceDataConfidence === "LOW"
          ? "NEED_MORE_SOLD_DATA"
          : input.marginProtectionScore >= 70
            ? "KEEP_PRICE_IF_MARGIN_HEALTHY"
            : input.priceWarRiskScore >= 70
              ? "HOLD_PRICE"
              : "ADJUST_GRADUALLY_7_10_DAYS"
  const recommendedPricePosition =
    input.priceDataConfidence === "LOW"
      ? "wait_for_more_data"
      : input.marginProtectionScore >= 70 && input.perceivedValueScore >= 65
        ? "premium_if_listing_quality_strong"
        : "market_aligned"

  return {
    recommendedPricePosition,
    pricingGuidance:
      priceAction === "IMPROVE_IMAGE_OR_TITLE_FIRST"
        ? "Improve images or title before changing price."
        : priceAction === "NEED_MORE_SOLD_DATA"
          ? "Collect more sold data before changing price."
          : priceAction === "REJECT_IF_MARGIN_DESTROYED"
            ? "Reject or watchlist; margin does not support a price war."
            : priceAction === "KEEP_PRICE_IF_MARGIN_HEALTHY"
              ? "Keep price if margin remains healthy."
              : priceAction === "HOLD_PRICE"
                ? "Hold price and avoid matching weak competitors."
                : "Adjust gradually and measure over 7 to 10 days.",
    priceConfidenceScore:
      input.priceConfidenceScore,
    priceWarRiskScore:
      input.priceWarRiskScore,
    marginProtectionScore:
      input.marginProtectionScore,
    perceivedValueScore:
      input.perceivedValueScore,
    doNotRaceToBottom:
      true,
    lowestPriceNotRequired:
      true,
    pricingWarnings,
    priceAction,
  }
}

export function buildSourcingRecommendation(
  input: ReturnType<typeof buildAdvisorCandidateInput>,
  options: AdvisorOptions = {},
) {
  void options
  const sourcingAction =
    input.directSourcingDecision === "REQUEST_DIRECT_SUPPLIER_QUOTE"
      ? "REQUEST_DIRECT_SUPPLIER_QUOTE"
      : input.directSourcingDecision === "BUY_DIRECT_SMALL_BATCH"
        ? "BUY_DIRECT_SMALL_BATCH_LATER"
        : input.directSourcingDecision === "REJECT"
          ? "REJECT_DIRECT_BUY"
          : input.buyDirectOpportunityScore >= 45
            ? "WATCHLIST_FOR_VOLUME"
            : "KEEP_SELLING_VIA_LUNA_PORTEX"

  return {
    directSourcingDecision:
      input.directSourcingDecision,
    buyDirectOpportunityScore:
      input.buyDirectOpportunityScore,
    profitUpsidePerUnit:
      input.profitUpsidePerUnit,
    estimatedCapitalNeeded:
      input.estimatedCapitalNeeded,
    capitalRiskLevel:
      input.capitalRiskLevel,
    sourcingAction,
    sourcingReasons:
      input.directSourcingReasons.length > 0
        ? [...input.directSourcingReasons]
        : ["direct sourcing signal requires more data"],
    minimumDataNeededBeforeBuyingDirect:
      [...input.minimumDataNeededBeforeBuyingDirect],
    whatsappSourcingAlertPreview:
      input.buyDirectOpportunityScore >= 55
        ? `Sourcing opportunity: ${input.productTitle} may justify a supplier quote.`
        : `Keep ${input.productTitle} in Luna Portex resale review.`,
  }
}

export function buildAdvisorCandidateReview(
  input: ReturnType<typeof buildAdvisorCandidateInput>,
  options: AdvisorOptions = {},
) {
  const pricingAdvisor =
    buildPricingAdvisorRecommendation(input, options)
  const sourcingRecommendation =
    buildSourcingRecommendation(input, options)
  const advisorRecommendation =
    hasBlockedReason(input, "compliance review required")
      ? "NEEDS_COMPLIANCE_REVIEW"
      : hasBlockedReason(input, "missing image")
        ? "REQUEST_IMAGE_PACKAGE"
        : input.directSourcingDecision === "REQUEST_DIRECT_SUPPLIER_QUOTE"
          ? "REQUEST_SUPPLIER_QUOTE"
          : input.priceDataConfidence === "LOW"
            ? "NEEDS_MORE_DATA"
            : input.sellerDecision === "REJECT"
              ? "REJECT_FOR_NOW"
              : input.sellerDecision === "WATCHLIST"
                ? "MOVE_TO_WATCHLIST"
                : "APPROVE_FOR_ADVISOR_REVIEW"
  const confidenceLevel =
    input.priceDataConfidence === "LOW" || input.winnerScore < 45
      ? "LOW"
      : input.priceDataConfidence === "MEDIUM" && input.winnerScore >= 60
        ? "HIGH"
        : "MEDIUM"
  const blockers =
    unique([...input.blockers])
  const warnings =
    unique([
      ...input.warnings,
      ...pricingAdvisor.pricingWarnings,
      ...input.minimumDataNeededBeforeBuyingDirect.map(entry => `direct buy needs ${entry}`),
    ])

  return {
    advisorVersion:
      LUNA_PORTEX_ADVISOR_OS_CANDIDATE_REVIEW_VERSION,
    sourceDataClass,
    candidateKey:
      input.candidateKey,
    productTitle:
      input.productTitle,
    advisorRecommendation,
    sellerDecision:
      input.sellerDecision,
    executiveSummary:
      `${input.productTitle}: ${advisorRecommendation} with Winner Score ${input.winnerScore}.`,
    keyReasons:
      unique([
        `winner score ${input.winnerScore}`,
        `price confidence ${input.priceConfidenceScore}`,
        `margin protection ${input.marginProtectionScore}`,
        sourcingRecommendation.sourcingAction,
      ]),
    blockers,
    warnings,
    nextRecommendedAction:
      advisorRecommendation === "REQUEST_IMAGE_PACKAGE"
        ? "REQUEST_IMAGE_PACKAGE"
        : advisorRecommendation === "REQUEST_SUPPLIER_QUOTE"
          ? "REQUEST_DIRECT_SUPPLIER_QUOTE"
          : advisorRecommendation === "NEEDS_COMPLIANCE_REVIEW"
            ? "NEEDS_COMPLIANCE_REVIEW"
            : advisorRecommendation === "REJECT_FOR_NOW"
              ? "REJECT_FOR_NOW"
              : advisorRecommendation === "NEEDS_MORE_DATA"
                ? "NEEDS_MORE_DATA"
                : "SEND_TO_ADVISOR_OS",
    confidenceLevel,
    canMoveToListingBuilder:
      false,
    canCreateEbayDraft:
      false,
    canPublishRealListing:
      false,
    requiresHumanApproval:
      true,
    winnerScore:
      input.winnerScore,
    pricingAdvisor,
    sourcingRecommendation,
  }
}

export function buildMobileDecisionActions(
  advisorReview: ReturnType<typeof buildAdvisorCandidateReview>,
  options: AdvisorOptions = {},
) {
  void options
  const actions =
    [
      "VIEW_ANALYSIS",
      advisorReview.advisorRecommendation === "REQUEST_IMAGE_PACKAGE" ? "REQUEST_IMAGE_PACKAGE" : null,
      advisorReview.advisorRecommendation === "REQUEST_SUPPLIER_QUOTE" ? "REQUEST_SUPPLIER_QUOTE" : null,
      advisorReview.advisorRecommendation === "NEEDS_COMPLIANCE_REVIEW" ? "NEEDS_COMPLIANCE_REVIEW" : null,
      advisorReview.advisorRecommendation === "REJECT_FOR_NOW" ? "DISCARD_PRODUCT" : null,
      advisorReview.advisorRecommendation === "MOVE_TO_WATCHLIST" || advisorReview.advisorRecommendation === "NEEDS_MORE_DATA" ? "MOVE_TO_WATCHLIST" : null,
      advisorReview.advisorRecommendation === "APPROVE_FOR_ADVISOR_REVIEW" ? "APPROVE_PRODUCT_FOR_NEXT_STEP" : null,
      advisorReview.pricingAdvisor.priceAction === "HOLD_PRICE" || advisorReview.pricingAdvisor.priceAction === "KEEP_PRICE_IF_MARGIN_HEALTHY" ? "HOLD_PRICE" : null,
    ].filter((entry): entry is string => entry !== null)

  return unique(actions)
}

export function buildWhatsAppMobileApprovalPreview(
  advisorReview: ReturnType<typeof buildAdvisorCandidateReview>,
  options: AdvisorOptions = {},
) {
  void options
  const messageType =
    advisorReview.advisorRecommendation === "REQUEST_IMAGE_PACKAGE"
      ? "IMAGE_REQUIRED"
      : advisorReview.advisorRecommendation === "REQUEST_SUPPLIER_QUOTE"
        ? "SOURCING_OPPORTUNITY"
        : advisorReview.advisorRecommendation === "NEEDS_COMPLIANCE_REVIEW"
          ? "COMPLIANCE_REVIEW"
          : advisorReview.pricingAdvisor.pricingWarnings.length > 0
            ? "PRICING_ADVISOR"
            : "CANDIDATE_REVIEW"

  return {
    messageType,
    title:
      `Advisor OS: ${advisorReview.productTitle}`,
    body:
      `${advisorReview.executiveSummary} Next: ${advisorReview.nextRecommendedAction}.`,
    candidateKey:
      advisorReview.candidateKey,
    winnerScore:
      advisorReview.winnerScore,
    sellerDecision:
      advisorReview.sellerDecision,
    mainRecommendation:
      advisorReview.advisorRecommendation,
    riskLevel:
      advisorReview.confidenceLevel === "LOW"
        ? "HIGH"
        : advisorReview.confidenceLevel === "MEDIUM"
          ? "MEDIUM"
          : "LOW",
    buttons:
      buildMobileDecisionActions(advisorReview, options),
    previewOnly:
      true,
    realSendUsed:
      false,
  }
}

export function buildAdvisorDecisionQueue(
  winnerScoreModels: WinnerScoreModelEntry[] = [],
  options: AdvisorOptions = {},
) {
  const limit =
    Math.min(
      Math.max(normalizeNumber(options.maxCandidates, maxAdvisorCandidates), 0),
      maxAdvisorCandidates,
    )
  const advisorReviews =
    winnerScoreModels
      .slice(0, limit)
      .map(model => buildAdvisorCandidateReview(buildAdvisorCandidateInput(model, options), options))
  const whatsappPreviews =
    advisorReviews.map(review => buildWhatsAppMobileApprovalPreview(review, options))
  const mobileDecisionActions =
    unique(advisorReviews.flatMap(review => buildMobileDecisionActions(review, options)))
  const prohibitedActionsDetected =
    mobileDecisionActions.filter(action => prohibitedActions.includes(action as (typeof prohibitedActions)[number]))

  return {
    advisorVersion:
      LUNA_PORTEX_ADVISOR_OS_CANDIDATE_REVIEW_VERSION,
    sourceDataClass,
    inputWinnerScoreModels:
      winnerScoreModels.slice(0, limit).length,
    advisorReviewsBuilt:
      advisorReviews.length,
    advisorReviews,
    whatsappPreviews,
    mobileDecisionActions,
    prohibitedActionsDetected,
    stagingWriteExecuted:
      false,
    ebayApiUsed:
      false,
    whatsappRealSendUsed:
      false,
    nextLoop:
      "146",
  }
}

export function summarizeAdvisorDecisionQueue(
  queue: ReturnType<typeof buildAdvisorDecisionQueue>
) {
  return {
    inputWinnerScoreModels:
      queue.inputWinnerScoreModels,
    advisorReviewsBuilt:
      queue.advisorReviewsBuilt,
    approveForNextStepCandidates:
      queue.advisorReviews.filter(review => review.advisorRecommendation === "APPROVE_FOR_ADVISOR_REVIEW").length,
    imagePackageRequiredCandidates:
      queue.advisorReviews.filter(review => review.advisorRecommendation === "REQUEST_IMAGE_PACKAGE").length,
    supplierQuoteRecommendedCandidates:
      queue.advisorReviews.filter(review => review.advisorRecommendation === "REQUEST_SUPPLIER_QUOTE").length,
    watchlistCandidates:
      queue.advisorReviews.filter(review => review.advisorRecommendation === "MOVE_TO_WATCHLIST").length,
    rejectCandidates:
      queue.advisorReviews.filter(review => review.advisorRecommendation === "REJECT_FOR_NOW").length,
    pricingAdvisorWarnings:
      queue.advisorReviews.reduce((total, review) => total + review.pricingAdvisor.pricingWarnings.length, 0),
    whatsappPreviewMessages:
      queue.whatsappPreviews.length,
    mobileDecisionActions:
      queue.mobileDecisionActions.length,
    prohibitedActionsDetected:
      [...queue.prohibitedActionsDetected],
    readyForListingBuilder:
      queue.advisorReviews.filter(review => review.canMoveToListingBuilder).length,
    canCreateEbayDraft:
      queue.advisorReviews.some(review => review.canCreateEbayDraft),
    canPublishRealListing:
      queue.advisorReviews.some(review => review.canPublishRealListing),
    stagingWriteExecuted:
      false,
    ebayApiUsed:
      false,
    whatsappRealSendUsed:
      false,
    nextLoop:
      queue.nextLoop,
  }
}

export function getAdvisorOsCandidateReviewChecklist() {
  return [
    "confirm Winner Score V2 inputs are local and sanitized",
    "confirm WhatsApp output is preview and intents only",
    "confirm prohibited actions are absent",
    "confirm no eBay API, OAuth, Supabase, WhatsApp real send, draft, or publication",
    "confirm human approval remains required",
    "confirm next loop is 146 — Listing Package Builder",
  ]
}
