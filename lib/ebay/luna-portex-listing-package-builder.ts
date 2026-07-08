export const LUNA_PORTEX_LISTING_PACKAGE_BUILDER_VERSION =
  "LUNA_PORTEX_LISTING_PACKAGE_BUILDER_VALUE_PRICING_V1"

const sourceDataClass =
  "LOOP_146_LISTING_PACKAGE_BUILDER"
const maxListingPackages =
  10
const prohibitedActions =
  [
    "CREATE_EBAY_DRAFT",
    "PUBLISH_LISTING",
    "SEND_REAL_WHATSAPP",
    "UPDATE_STAGING_DECISION",
    "TOUCH_PRODUCTION",
  ] as const

type AdvisorReviewEntry = {
  candidateKey?: string | null
  productTitle?: string | null
  advisorRecommendation?: string | null
  sellerDecision?: string | null
  executiveSummary?: string | null
  keyReasons?: string[] | null
  blockers?: string[] | null
  warnings?: string[] | null
  nextRecommendedAction?: string | null
  confidenceLevel?: string | null
  winnerScore?: number | null
  canMoveToListingBuilder?: boolean | null
  canCreateEbayDraft?: boolean | null
  canPublishRealListing?: boolean | null
  requiresHumanApproval?: boolean | null
  pricingAdvisor?: {
    recommendedPricePosition?: string | null
    pricingGuidance?: string | null
    priceConfidenceScore?: number | null
    priceWarRiskScore?: number | null
    marginProtectionScore?: number | null
    perceivedValueScore?: number | null
    doNotRaceToBottom?: boolean | null
    lowestPriceNotRequired?: boolean | null
    pricingWarnings?: string[] | null
    priceAction?: string | null
  } | null
  sourcingRecommendation?: {
    directSourcingDecision?: string | null
    buyDirectOpportunityScore?: number | null
    profitUpsidePerUnit?: number | null
    estimatedCapitalNeeded?: number | null
    capitalRiskLevel?: string | null
    sourcingAction?: string | null
    sourcingReasons?: string[] | null
    minimumDataNeededBeforeBuyingDirect?: string[] | null
  } | null
}

type ListingPackageOptions = {
  maxPackages?: number | null
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

function stripUnsafeTitleWords(title: string) {
  return title
    .replace(/\b(best|guaranteed|official)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
}

function titleCaseWord(word: string) {
  if (/^[A-Z0-9-]{3,}$/.test(word)) {
    return word
  }

  return word.length > 0
    ? `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`
    : word
}

function normalizeListingTitle(title: string) {
  const cleaned =
    stripUnsafeTitleWords(title)
      .replace(/[^\w\s.-]/g, "")
      .replace(/\bLuna Portex\b/gi, "")
      .replace(/\bsanitized\b/gi, "")
      .replace(/\bcandidate\b/gi, "")
      .replace(/\s+/g, " ")
      .trim()
  const words =
    cleaned.split(" ").filter(Boolean)
  const titled =
    words.map(titleCaseWord).join(" ")
  const withCondition =
    /\bnew\b/i.test(titled)
      ? titled
      : `${titled} New`

  return withCondition.length <= 80
    ? withCondition
    : withCondition.slice(0, 80).replace(/\s+\S*$/, "").trim()
}

function hasAnyText(input: ReturnType<typeof buildListingPackageInput>, values: string[]) {
  const searchable =
    `${input.candidateKey} ${input.productTitle} ${input.blockers.join(" ")} ${input.warnings.join(" ")}`.toLowerCase()

  return values.some(value => searchable.includes(value.toLowerCase()))
}

function needsImagePackage(input: ReturnType<typeof buildListingPackageInput>) {
  return (
    input.blockers.includes("missing image") ||
    input.advisorRecommendation === "REQUEST_IMAGE_PACKAGE"
  )
}

export function buildListingPackageInput(
  advisorReview: AdvisorReviewEntry,
  options: ListingPackageOptions = {},
) {
  void options
  const pricingAdvisor =
    advisorReview.pricingAdvisor ?? {}
  const sourcingRecommendation =
    advisorReview.sourcingRecommendation ?? {}

  return {
    listingPackageVersion:
      LUNA_PORTEX_LISTING_PACKAGE_BUILDER_VERSION,
    sourceDataClass,
    candidateKey:
      normalizeText(advisorReview.candidateKey) ?? "unknown-candidate",
    productTitle:
      normalizeText(advisorReview.productTitle) ?? "Untitled Luna Portex candidate",
    advisorRecommendation:
      normalizeText(advisorReview.advisorRecommendation) ?? "NEEDS_MORE_DATA",
    sellerDecision:
      normalizeText(advisorReview.sellerDecision) ?? "REVIEW",
    keyReasons:
      normalizeArray(advisorReview.keyReasons),
    blockers:
      normalizeArray(advisorReview.blockers),
    warnings:
      normalizeArray(advisorReview.warnings),
    confidenceLevel:
      normalizeText(advisorReview.confidenceLevel) ?? "LOW",
    winnerScore:
      normalizeNumber(advisorReview.winnerScore, 0),
    nextRecommendedAction:
      normalizeText(advisorReview.nextRecommendedAction) ?? "NEEDS_MORE_DATA",
    recommendedPricePosition:
      normalizeText(pricingAdvisor.recommendedPricePosition) ?? "wait_for_more_data",
    pricingGuidance:
      normalizeText(pricingAdvisor.pricingGuidance) ?? "Collect more pricing data before changing price.",
    priceConfidenceScore:
      normalizeNumber(pricingAdvisor.priceConfidenceScore, 0),
    priceWarRiskScore:
      normalizeNumber(pricingAdvisor.priceWarRiskScore, 0),
    marginProtectionScore:
      normalizeNumber(pricingAdvisor.marginProtectionScore, 0),
    perceivedValueScore:
      normalizeNumber(pricingAdvisor.perceivedValueScore, 0),
    doNotRaceToBottom:
      pricingAdvisor.doNotRaceToBottom !== false,
    lowestPriceNotRequired:
      pricingAdvisor.lowestPriceNotRequired !== false,
    pricingWarnings:
      normalizeArray(pricingAdvisor.pricingWarnings),
    priceAction:
      normalizeText(pricingAdvisor.priceAction) ?? "NEED_MORE_SOLD_DATA",
    sourcingAction:
      normalizeText(sourcingRecommendation.sourcingAction) ?? "KEEP_SELLING_VIA_LUNA_PORTEX",
    directSourcingDecision:
      normalizeText(sourcingRecommendation.directSourcingDecision) ?? "SELL_VIA_LUNA_PORTEX",
    buyDirectOpportunityScore:
      normalizeNumber(sourcingRecommendation.buyDirectOpportunityScore, 0),
    profitUpsidePerUnit:
      normalizeNumber(sourcingRecommendation.profitUpsidePerUnit, 0),
    estimatedCapitalNeeded:
      normalizeNumber(sourcingRecommendation.estimatedCapitalNeeded, 0),
    capitalRiskLevel:
      normalizeText(sourcingRecommendation.capitalRiskLevel) ?? "HIGH",
    sourcingReasons:
      normalizeArray(sourcingRecommendation.sourcingReasons),
    minimumDataNeededBeforeBuyingDirect:
      normalizeArray(sourcingRecommendation.minimumDataNeededBeforeBuyingDirect),
  }
}

export function buildEbayListingTitle(
  input: ReturnType<typeof buildListingPackageInput>,
  options: ListingPackageOptions = {},
) {
  void options
  return normalizeListingTitle(input.productTitle)
}

export function buildListingBullets(
  input: ReturnType<typeof buildListingPackageInput>,
  options: ListingPackageOptions = {},
) {
  void options
  const bullets =
    [
      `New ${input.productTitle} prepared for eBay review.`,
      "Value-based pricing review keeps margin protection ahead of lowest-price matching.",
      "Trust-focused package requires clear images, honest specifics, and shipping clarity.",
      input.sourcingAction === "REQUEST_DIRECT_SUPPLIER_QUOTE"
        ? "Direct supplier quote should be requested before larger volume decisions."
        : "Luna Portex resale path remains under review before sourcing changes.",
      needsImagePackage(input)
        ? "Image package is required before any eBay draft can be considered."
        : "Image package should be checked before draft creation in a later loop.",
    ]

  return unique(bullets)
}

export function buildListingDescription(
  input: ReturnType<typeof buildListingPackageInput>,
  options: ListingPackageOptions = {},
) {
  void options

  return [
    `${input.productTitle} is prepared as a professional eBay listing package for human review.`,
    "The package focuses on clear buyer expectations, honest condition language, item specifics, shipping clarity, and margin-aware pricing.",
    needsImagePackage(input)
      ? "Images are still required before the product can move toward a draft workflow."
      : "Images should be reviewed for clarity, scale, packaging, and buyer confidence before any draft workflow.",
    hasAnyText(input, ["aerosol", "hazmat", "electrical", "battery", "spray"])
      ? "Compliance handling must be reviewed before any marketplace draft or publication step."
      : "No marketplace publication is allowed in this loop.",
  ].join(" ")
}

export function buildItemSpecifics(
  input: ReturnType<typeof buildListingPackageInput>,
  options: ListingPackageOptions = {},
) {
  void options
  const model =
    input.candidateKey.split(":").at(-1)?.toUpperCase() ?? "UNCONFIRMED"

  return {
    Brand:
      "Unconfirmed",
    MPN:
      model,
    Condition:
      "New",
    Type:
      "Unconfirmed",
    "Compatible Model":
      "Verify before listing",
    "Seller Notes":
      needsImagePackage(input)
        ? "Image package required before draft."
        : "Specifics require human verification before draft.",
  }
}

export function buildCategoryRecommendation(
  input: ReturnType<typeof buildListingPackageInput>,
  options: ListingPackageOptions = {},
) {
  void options
  const complianceHeavy =
    hasAnyText(input, ["aerosol", "spray", "paint", "finish"])

  return {
    suggestedCategory:
      complianceHeavy
        ? "Home Improvement > Paint, Stain & Varnish"
        : "Business & Industrial > Other Business & Industrial",
    confidence:
      complianceHeavy ? "MEDIUM" : "LOW",
    requiresHumanCategoryReview:
      true,
  }
}

export function buildValueBasedPricingRecommendation(
  input: ReturnType<typeof buildListingPackageInput>,
  options: ListingPackageOptions = {},
) {
  void options
  const pricingAction =
    needsImagePackage(input)
      ? "IMPROVE_IMAGE_OR_TITLE_FIRST"
      : input.priceAction === "REJECT_IF_MARGIN_DESTROYED" || input.marginProtectionScore < 25
        ? "REJECT_IF_MARGIN_DESTROYED"
        : input.priceConfidenceScore < 45
          ? "NEED_MORE_SOLD_DATA"
          : input.marginProtectionScore >= 70
            ? "KEEP_PRICE_IF_MARGIN_HEALTHY"
            : "ADJUST_GRADUALLY_7_10_DAYS"
  const midpoint =
    Math.max(12, Math.round(input.winnerScore * 0.75 + input.marginProtectionScore * 0.35))
  const low =
    pricingAction === "NEED_MORE_SOLD_DATA"
      ? null
      : Math.max(1, Number((midpoint * 0.94).toFixed(2)))
  const high =
    pricingAction === "NEED_MORE_SOLD_DATA"
      ? null
      : Number((midpoint * 1.08).toFixed(2))

  return {
    recommendedPricePosition:
      input.recommendedPricePosition,
    recommendedPriceRange:
      {
        low,
        high,
        currency:
          "USD",
      },
    pricingAction,
    pricingGuidance:
      pricingAction === "IMPROVE_IMAGE_OR_TITLE_FIRST"
        ? "Improve image package and title trust before changing price."
        : pricingAction === "NEED_MORE_SOLD_DATA"
          ? "Collect more sold data before setting a rigid price."
          : pricingAction === "REJECT_IF_MARGIN_DESTROYED"
            ? "Reject or watchlist instead of lowering into an unhealthy margin."
            : pricingAction === "KEEP_PRICE_IF_MARGIN_HEALTHY"
              ? "Keep price if margin remains healthy and listing quality is strong."
              : "Adjust gradually and measure performance over 7 to 10 days.",
    pricingConfidence:
      input.priceConfidenceScore >= 70
        ? "HIGH"
        : input.priceConfidenceScore >= 45
          ? "MEDIUM"
          : "LOW",
    doNotRaceToBottom:
      true,
    lowestPriceNotRequired:
      true,
    valueBasedPricing:
      true,
  }
}

export function buildTrustOptimizationChecklist(
  input: ReturnType<typeof buildListingPackageInput>,
  options: ListingPackageOptions = {},
) {
  void options
  return {
    imageQualityRequired:
      true,
    clearTitleRequired:
      true,
    honestDescriptionRequired:
      true,
    returnPolicyRequired:
      true,
    shippingClarityRequired:
      true,
    itemSpecificsRequired:
      true,
    complianceReviewRequired:
      hasAnyText(input, ["aerosol", "hazmat", "electrical", "battery", "spray"]),
  }
}

export function buildListingReadinessGates(
  input: ReturnType<typeof buildListingPackageInput>,
  listingPackage: {
    trustSignals: ReturnType<typeof buildTrustOptimizationChecklist>
    pricingRecommendation: ReturnType<typeof buildValueBasedPricingRecommendation>
    imageRequirements: string[]
    complianceWarnings: string[]
  },
  options: ListingPackageOptions = {},
) {
  void options
  const blockedReasons =
    unique([
      ...input.blockers,
      listingPackage.imageRequirements.length > 0 ? "image package required" : null,
      listingPackage.complianceWarnings.length > 0 ? "compliance review required" : null,
      listingPackage.pricingRecommendation.pricingAction === "NEED_MORE_SOLD_DATA" ? "pricing data required" : null,
      listingPackage.pricingRecommendation.pricingAction === "REJECT_IF_MARGIN_DESTROYED" ? "margin protection failed" : null,
    ].filter((entry): entry is string => entry !== null))
  const readyForImageWorkflow =
    listingPackage.imageRequirements.length > 0 ||
    (blockedReasons.length <= 2 && input.winnerScore >= 45)
  const readyForListingApproval =
    input.advisorRecommendation === "APPROVE_FOR_ADVISOR_REVIEW" &&
    listingPackage.complianceWarnings.length === 0 &&
    listingPackage.pricingRecommendation.pricingAction !== "REJECT_IF_MARGIN_DESTROYED"

  return {
    readyForImageWorkflow,
    readyForListingApproval,
    readyForEbaySandboxDraft:
      false,
    readyForRealListing:
      false,
    canCreateEbayDraft:
      false,
    canPublishRealListing:
      false,
    requiresHumanApproval:
      true,
    blockedReasons,
    warnings:
      unique([
        ...input.warnings,
        ...input.pricingWarnings,
      ]),
    nextRecommendedAction:
      listingPackage.complianceWarnings.length > 0
        ? "REQUEST_COMPLIANCE_REVIEW"
        : listingPackage.imageRequirements.length > 0
          ? "REQUEST_IMAGE_PACKAGE"
          : readyForListingApproval
            ? "APPROVE_LISTING_PACKAGE_FOR_IMAGE_WORKFLOW"
            : listingPackage.pricingRecommendation.pricingAction === "NEED_MORE_SOLD_DATA"
              ? "REQUEST_PRICE_REVIEW"
              : "MOVE_TO_WATCHLIST",
  }
}

export function buildWhatsAppListingApprovalPreview(
  listingPackage: ReturnType<typeof buildListingPackage>,
  options: ListingPackageOptions = {},
) {
  void options
  return {
    messageType:
      "LISTING_PACKAGE_REVIEW",
    title:
      `Listing package: ${listingPackage.productTitle}`,
    body:
      `${listingPackage.listingTitle} is ready for internal review. Next: ${listingPackage.nextRecommendedAction}.`,
    candidateKey:
      listingPackage.candidateKey,
    listingTitle:
      listingPackage.listingTitle,
    recommendedPriceRange:
      listingPackage.pricingRecommendation.recommendedPriceRange,
    readinessStatus:
      listingPackage.readiness.readyForListingApproval
        ? "READY_FOR_INTERNAL_APPROVAL"
        : "BLOCKED_FOR_NOW",
    mainBlockers:
      [...listingPackage.blockedReasons],
    buttons:
      buildListingMobileDecisionActions(listingPackage),
    previewOnly:
      true,
    realSendUsed:
      false,
  }
}

function buildListingMobileDecisionActions(
  listingPackage: ReturnType<typeof buildListingPackage>,
) {
  const actions =
    [
      "VIEW_FULL_LISTING_PACKAGE",
      listingPackage.readiness.readyForListingApproval ? "APPROVE_LISTING_PACKAGE_FOR_IMAGE_WORKFLOW" : null,
      listingPackage.requiresImagePackage ? "REQUEST_IMAGE_PACKAGE" : null,
      listingPackage.requiresComplianceReview ? "REQUEST_COMPLIANCE_REVIEW" : null,
      listingPackage.pricingRecommendation.pricingAction === "NEED_MORE_SOLD_DATA" ? "REQUEST_PRICE_REVIEW" : null,
      listingPackage.blockedReasons.includes("margin protection failed") ? "MOVE_TO_WATCHLIST" : null,
      listingPackage.blockedReasons.includes("margin protection failed") ? "REJECT_LISTING_PACKAGE" : null,
      listingPackage.listingTitle.length > 72 ? "REQUEST_TITLE_CHANGES" : null,
    ].filter((entry): entry is string => entry !== null)

  return unique(actions)
}

export function buildListingPackage(
  advisorReview: AdvisorReviewEntry,
  options: ListingPackageOptions = {},
) {
  const input =
    buildListingPackageInput(advisorReview, options)
  const listingTitle =
    buildEbayListingTitle(input, options)
  const pricingRecommendation =
    buildValueBasedPricingRecommendation(input, options)
  const trustSignals =
    buildTrustOptimizationChecklist(input, options)
  const complianceWarnings =
    trustSignals.complianceReviewRequired
      ? ["compliance review required before eBay draft"]
      : []
  const imageRequirements =
    needsImagePackage(input)
      ? ["primary product image required", "packaging or label image required", "scale or detail image recommended"]
      : ["verify image clarity before eBay draft"]
  const partialPackage =
    {
      trustSignals,
      pricingRecommendation,
      imageRequirements,
      complianceWarnings,
    }
  const readiness =
    buildListingReadinessGates(input, partialPackage, options)
  const blockedReasons =
    readiness.blockedReasons

  return {
    listingPackageVersion:
      LUNA_PORTEX_LISTING_PACKAGE_BUILDER_VERSION,
    sourceDataClass,
    candidateKey:
      input.candidateKey,
    productTitle:
      input.productTitle,
    listingTitle,
    titleKeywords:
      listingTitle.split(" ").filter(word => word.length > 2),
    listingBullets:
      buildListingBullets(input, options),
    listingDescription:
      buildListingDescription(input, options),
    itemSpecifics:
      buildItemSpecifics(input, options),
    categoryRecommendation:
      buildCategoryRecommendation(input, options),
    condition:
      "New",
    pricingRecommendation,
    shippingPolicyRecommendation:
      "Use tracked shipping with clear handling time and no unverified delivery promises.",
    returnPolicyRecommendation:
      "Use a clear returns policy that matches seller operations and category rules.",
    trustSignals,
    complianceWarnings,
    imageRequirements,
    blockedReasons,
    warnings:
      readiness.warnings,
    canCreateEbayDraft:
      false,
    canPublishRealListing:
      false,
    requiresHumanApproval:
      true,
    requiresImagePackage:
      imageRequirements.length > 0,
    requiresComplianceReview:
      complianceWarnings.length > 0,
    readyForImageWorkflow:
      readiness.readyForImageWorkflow,
    readyForListingApproval:
      readiness.readyForListingApproval,
    readyForRealListing:
      false,
    nextRecommendedAction:
      readiness.nextRecommendedAction,
    readiness,
  }
}

export function buildListingPackageQueue(
  advisorReviews: AdvisorReviewEntry[] = [],
  options: ListingPackageOptions = {},
) {
  const limit =
    Math.min(
      Math.max(normalizeNumber(options.maxPackages, maxListingPackages), 0),
      maxListingPackages,
    )
  const packages =
    advisorReviews
      .slice(0, limit)
      .map(review => buildListingPackage(review, options))
  const whatsappListingApprovalPreviews =
    packages.map(listingPackage => buildWhatsAppListingApprovalPreview(listingPackage, options))
  const mobileDecisionActions =
    unique(whatsappListingApprovalPreviews.flatMap(preview => preview.buttons))
  const prohibitedActionsDetected =
    mobileDecisionActions.filter(action => prohibitedActions.includes(action as (typeof prohibitedActions)[number]))

  return {
    listingPackageVersion:
      LUNA_PORTEX_LISTING_PACKAGE_BUILDER_VERSION,
    sourceDataClass,
    inputAdvisorReviews:
      advisorReviews.slice(0, limit).length,
    listingPackagesBuilt:
      packages.length,
    packages,
    whatsappListingApprovalPreviews,
    mobileDecisionActions,
    prohibitedActionsDetected,
    stagingWriteExecuted:
      false,
    ebayApiUsed:
      false,
    whatsappRealSendUsed:
      false,
    nextLoop:
      "147",
  }
}

export function summarizeListingPackageQueue(
  queue: ReturnType<typeof buildListingPackageQueue>,
) {
  return {
    inputAdvisorReviews:
      queue.inputAdvisorReviews,
    listingPackagesBuilt:
      queue.listingPackagesBuilt,
    readyForImageWorkflow:
      queue.packages.filter(listingPackage => listingPackage.readyForImageWorkflow).length,
    readyForListingApproval:
      queue.packages.filter(listingPackage => listingPackage.readyForListingApproval).length,
    blockedByImages:
      queue.packages.filter(listingPackage => listingPackage.requiresImagePackage).length,
    blockedByCompliance:
      queue.packages.filter(listingPackage => listingPackage.requiresComplianceReview).length,
    blockedByPricingData:
      queue.packages.filter(listingPackage => listingPackage.pricingRecommendation.pricingAction === "NEED_MORE_SOLD_DATA").length,
    valueBasedPricingPackages:
      queue.packages.filter(listingPackage => listingPackage.pricingRecommendation.valueBasedPricing).length,
    trustOptimizationWarnings:
      queue.packages.reduce((total, listingPackage) => total + listingPackage.warnings.length + listingPackage.complianceWarnings.length, 0),
    whatsappListingApprovalPreviews:
      queue.whatsappListingApprovalPreviews.length,
    mobileDecisionActions:
      queue.mobileDecisionActions.length,
    prohibitedActionsDetected:
      [...queue.prohibitedActionsDetected],
    canCreateEbayDraft:
      queue.packages.some(listingPackage => listingPackage.canCreateEbayDraft),
    canPublishRealListing:
      queue.packages.some(listingPackage => listingPackage.canPublishRealListing),
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

export function getListingPackageBuilderChecklist() {
  return [
    "confirm Advisor OS inputs are local and sanitized",
    "confirm listing packages are previews only",
    "confirm titles, descriptions, item specifics, pricing, trust signals, and blockers are generated",
    "confirm WhatsApp listing approval is preview and intents only",
    "confirm no eBay API, OAuth, Supabase, WhatsApp real send, draft, publication, or Production touch",
    "confirm next loop is 147 — Image Package Workflow",
  ]
}
