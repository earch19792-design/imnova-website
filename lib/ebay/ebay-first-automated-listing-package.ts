export const EBAY_FIRST_AUTOMATED_LISTING_PACKAGE_VERSION =
  "EBAY_FIRST_AUTOMATED_LISTING_PACKAGE_RESUME_C_AUTO_V1"

type Candidate = {
  candidateId?: string
  productName?: string
  brand?: string
  modelOrSku?: string
  source?: string
  productType?: string
  categorySuggestion?: string
  condition?: string
  sizeClass?: string
  benchmarkSignals?: Record<string, unknown>
  winnerScore?: number
  unitCost?: number
  estimatedMarketplaceFees?: number
  estimatedShippingCost?: number
  recommendedPrice?: number
  isSupplement?: boolean
  isAerosol?: boolean
  hasBattery?: boolean
  isMedicalProduct?: boolean
  hasMedicalClaims?: boolean
  restrictedBrandApparent?: boolean
  veroOrIpRiskApparent?: boolean
  isFragile?: boolean
  isHazmat?: boolean
  criticalItemSpecifics?: string[]
  knownItemSpecifics?: Record<string, string>
  authorizedImageAvailable?: boolean
  imageSource?: string
}

type PackageFixture = {
  packageVersion?: string
  status?: string
  mode?: string
  storeName?: string
  targetMarketplace?: string
  warehouse?: Record<string, unknown>
  routeInputs?: Record<string, unknown>
  accountRiskVisible?: boolean
  candidates?: Candidate[]
  safetyFlags?: Record<string, boolean>
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function number(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : word)
    .join(" ")
}

function safeTitle(candidate: ReturnType<typeof normalizeCandidate>) {
  const raw = `${candidate.productName} ${candidate.modelOrSku}`
    .replace(/\b(best|official|authentic|fda|guaranteed)\b/gi, "")
    .replace(/[^a-zA-Z0-9 -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const normalized = titleCase(raw)
  return normalized.length <= 80
    ? normalized
    : normalized.slice(0, 80).replace(/\s+\S*$/, "")
}

function normalizeCandidate(candidate: Candidate) {
  return {
    candidateId: text(candidate.candidateId, "unknown-candidate"),
    productName: text(candidate.productName, "Unknown product"),
    brand: text(candidate.brand, "Unbranded"),
    modelOrSku: text(candidate.modelOrSku, "Unknown"),
    source: text(candidate.source, "LOCAL_BENCHMARK"),
    productType: text(candidate.productType, "product"),
    categorySuggestion: text(candidate.categorySuggestion, "Everything Else"),
    condition: text(candidate.condition, "New"),
    sizeClass: text(candidate.sizeClass, "UNKNOWN"),
    benchmarkSignals: candidate.benchmarkSignals ?? {},
    winnerScore: number(candidate.winnerScore),
    unitCost: number(candidate.unitCost),
    estimatedMarketplaceFees: number(candidate.estimatedMarketplaceFees),
    estimatedShippingCost: number(candidate.estimatedShippingCost),
    recommendedPrice: number(candidate.recommendedPrice),
    isSupplement: candidate.isSupplement === true,
    isAerosol: candidate.isAerosol === true,
    hasBattery: candidate.hasBattery === true,
    isMedicalProduct: candidate.isMedicalProduct === true,
    hasMedicalClaims: candidate.hasMedicalClaims === true,
    restrictedBrandApparent: candidate.restrictedBrandApparent === true,
    veroOrIpRiskApparent: candidate.veroOrIpRiskApparent === true,
    isFragile: candidate.isFragile === true,
    isHazmat: candidate.isHazmat === true,
    criticalItemSpecifics: Array.isArray(candidate.criticalItemSpecifics) ? candidate.criticalItemSpecifics : [],
    knownItemSpecifics: candidate.knownItemSpecifics ?? {},
    authorizedImageAvailable: candidate.authorizedImageAvailable === true,
    imageSource: text(candidate.imageSource, "authorized product image required"),
  }
}

export function buildEbayFirstAutomatedListingPackageInput(fixture: PackageFixture) {
  return {
    packageVersion: text(fixture.packageVersion, EBAY_FIRST_AUTOMATED_LISTING_PACKAGE_VERSION),
    status: text(fixture.status),
    mode: text(fixture.mode),
    storeName: text(fixture.storeName),
    targetMarketplace: text(fixture.targetMarketplace, "EBAY_US"),
    warehouse: fixture.warehouse ?? {},
    routeInputs: fixture.routeInputs ?? {},
    accountRiskVisible: fixture.accountRiskVisible === true,
    candidates: (fixture.candidates ?? []).map(normalizeCandidate),
    safetyFlags: fixture.safetyFlags ?? {},
  }
}

export function buildEbayFirstListingRiskAssessment(candidate: ReturnType<typeof normalizeCandidate>) {
  const rejectionReasons = unique([
    candidate.isSupplement ? "Supplement is unsuitable for the first listing" : "",
    candidate.isAerosol ? "Aerosol shipping and compliance risk" : "",
    candidate.hasBattery ? "Battery handling risk" : "",
    candidate.isMedicalProduct ? "Medical product risk" : "",
    candidate.hasMedicalClaims ? "Medical claims require compliance review" : "",
    candidate.restrictedBrandApparent ? "Restricted brand risk appears unresolved" : "",
    candidate.veroOrIpRiskApparent ? "VERO or intellectual-property risk appears unresolved" : "",
    candidate.isHazmat ? "Hazardous-material handling risk" : "",
  ])
  const riskReasons = unique([
    ...rejectionReasons,
    candidate.isFragile ? "Fragility increases damage and return risk" : "",
    !candidate.authorizedImageAvailable ? "Authorized product image is missing" : "",
    candidate.sizeClass === "LARGE" ? "Large parcel handling risk" : "",
  ])
  const riskLevel = rejectionReasons.length > 0
    ? "HIGH"
    : riskReasons.length > 0
      ? "MEDIUM"
      : "LOW"
  return { riskLevel, riskReasons, rejectionReasons }
}

export function buildEbayBenchmarkCandidateSelection(input: ReturnType<typeof buildEbayFirstAutomatedListingPackageInput>) {
  const assessed = input.candidates.map((candidate) => ({
    candidate,
    risk: buildEbayFirstListingRiskAssessment(candidate),
  }))
  const eligible = assessed
    .filter(({ risk }) => risk.riskLevel === "LOW")
    .sort((a, b) => b.candidate.winnerScore - a.candidate.winnerScore)
  return {
    candidatesEvaluated: assessed.length,
    selectedCandidateId: eligible[0]?.candidate.candidateId ?? null,
    recommendedCandidateSelected: eligible.length > 0,
    benchmarkSignalsUsed: assessed.filter(({ candidate }) => Object.keys(candidate.benchmarkSignals).length > 0).length,
    winnerScoreUsed: assessed.some(({ candidate }) => candidate.winnerScore > 0),
    assessed,
  }
}

export function buildEbayFirstListingPricingPackage(candidate: ReturnType<typeof normalizeCandidate>) {
  const estimatedNetProfit = roundMoney(
    candidate.recommendedPrice - candidate.unitCost - candidate.estimatedMarketplaceFees - candidate.estimatedShippingCost,
  )
  const estimatedMarginPercent = candidate.recommendedPrice > 0
    ? roundMoney((estimatedNetProfit / candidate.recommendedPrice) * 100)
    : 0
  return {
    format: "BUY_IT_NOW",
    recommendedPrice: candidate.recommendedPrice,
    currency: "USD",
    benchmarkMedianPrice: number(candidate.benchmarkSignals.medianSoldPrice),
    costEstimate: candidate.unitCost,
    marketplaceFeeEstimate: candidate.estimatedMarketplaceFees,
    shippingCostEstimate: candidate.estimatedShippingCost,
    marginEstimate: { estimatedNetProfit, estimatedMarginPercent, positive: estimatedNetProfit > 0 },
    priceRequiresHumanApproval: true,
  }
}

export function buildEbayFirstListingTitlePackage(candidate: ReturnType<typeof normalizeCandidate>) {
  const titleCandidate = safeTitle(candidate)
  return {
    titleCandidate,
    characterCount: titleCandidate.length,
    copiedFromCompetitor: false,
    usesBenchmarkPatternsOnly: true,
  }
}

export function buildEbayFirstListingDescriptionPackage(candidate: ReturnType<typeof normalizeCandidate>) {
  return {
    descriptionCandidate: [
      `${candidate.productName} offered in new condition for practical everyday organization.`,
      `Package includes the item described by model or SKU ${candidate.modelOrSku}.`,
      "Review the authorized product images, dimensions, included components, and item specifics before approval.",
      "Shipping, returns, price, and product details remain subject to human confirmation.",
    ].join(" "),
    medicalClaimsIncluded: false,
    unsupportedPromisesIncluded: false,
  }
}

export function buildEbayFirstListingItemSpecificsPackage(candidate: ReturnType<typeof normalizeCandidate>) {
  const missingItemSpecifics = candidate.criticalItemSpecifics.filter(
    (specific) => !text(candidate.knownItemSpecifics[specific]),
  )
  return {
    itemSpecifics: candidate.knownItemSpecifics,
    missingItemSpecifics,
    readiness: missingItemSpecifics.length === 0 ? "COMPLETE_FOR_REVIEW" : "PARTIAL",
  }
}

export function buildEbayFirstListingImagePackage(candidate: ReturnType<typeof normalizeCandidate>) {
  return {
    imageGenerationUsed: false,
    competitorImagesCopied: false,
    authorizedImageAvailable: candidate.authorizedImageAvailable,
    imageApprovalRequired: true,
    imageSource: candidate.imageSource,
    mainImageNeeded: "Clear authorized front product image on a neutral background",
    requiredViews: ["front", "back or packaging", "scale or dimensions", "included quantity"],
    readyForHumanReview: candidate.authorizedImageAvailable,
  }
}

export function buildEbayFirstListingPolicyRecommendation(candidate: ReturnType<typeof normalizeCandidate>) {
  const risk = buildEbayFirstListingRiskAssessment(candidate)
  return {
    shippingRecommendation: candidate.isFragile
      ? "Calculated or guarded shipping with protective packaging confirmation"
      : "Tracked economy shipping from the configured warehouse alias; verify handling time",
    returnRecommendation: "30-day buyer-paid returns unless Seller Hub policy requires another approved option",
    paymentRecommendation: "Use the eBay-managed payment policy unlocked in Seller Hub onboarding",
    policyReadiness: risk.riskLevel === "LOW" ? "RECOMMENDATIONS_READY_FOR_HUMAN_REVIEW" : "HUMAN_REVIEW_REQUIRED",
    policyIdsAssigned: false,
  }
}

export function buildEbayFirstListingHumanApprovalChecklist(candidate: ReturnType<typeof normalizeCandidate>) {
  return [
    `Confirm product identity and SKU ${candidate.modelOrSku}`,
    "Confirm inventory availability and initial quantity of 1",
    "Confirm authorized main image and all required views",
    "Confirm title, category, item specifics, description, and condition",
    "Confirm price, estimated margin, shipping, return, and payment recommendations",
    "Confirm no VERO, intellectual-property, brand, hazmat, or unsupported-claim issue",
    "Approve movement to the gated draft builder; do not approve publication in this loop",
  ]
}

export function buildEbayFirstListingPayloadPreview(candidate: ReturnType<typeof normalizeCandidate>) {
  const title = buildEbayFirstListingTitlePackage(candidate)
  const pricing = buildEbayFirstListingPricingPackage(candidate)
  const specifics = buildEbayFirstListingItemSpecificsPackage(candidate)
  const description = buildEbayFirstListingDescriptionPackage(candidate)
  return {
    previewOnly: true,
    executionAllowed: false,
    sku: candidate.modelOrSku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    quantity: 1,
    condition: candidate.condition,
    categorySuggestion: candidate.categorySuggestion,
    title: title.titleCandidate,
    price: { value: pricing.recommendedPrice, currency: pricing.currency },
    itemSpecifics: specifics.itemSpecifics,
    description: description.descriptionCandidate,
  }
}

function buildCandidatePackage(candidate: ReturnType<typeof normalizeCandidate>) {
  const risk = buildEbayFirstListingRiskAssessment(candidate)
  const pricing = buildEbayFirstListingPricingPackage(candidate)
  const title = buildEbayFirstListingTitlePackage(candidate)
  const description = buildEbayFirstListingDescriptionPackage(candidate)
  const specifics = buildEbayFirstListingItemSpecificsPackage(candidate)
  const imagePackage = buildEbayFirstListingImagePackage(candidate)
  const policies = buildEbayFirstListingPolicyRecommendation(candidate)
  const canProceedToDraftBuilder =
    risk.riskLevel === "LOW" &&
    pricing.marginEstimate.positive &&
    specifics.missingItemSpecifics.length === 0 &&
    imagePackage.authorizedImageAvailable
  return {
    candidateId: candidate.candidateId,
    productName: candidate.productName,
    brand: candidate.brand,
    modelOrSku: candidate.modelOrSku,
    source: candidate.source,
    benchmarkSignals: candidate.benchmarkSignals,
    winnerScore: candidate.winnerScore,
    riskLevel: risk.riskLevel,
    riskReasons: risk.riskReasons,
    rejectionReasons: risk.rejectionReasons,
    recommendedCategory: candidate.categorySuggestion,
    titleCandidate: title.titleCandidate,
    priceRecommendation: pricing,
    marginEstimate: pricing.marginEstimate,
    quantityRecommendation: 1,
    condition: candidate.condition,
    itemSpecifics: specifics.itemSpecifics,
    missingItemSpecifics: specifics.missingItemSpecifics,
    descriptionCandidate: description.descriptionCandidate,
    imagePackage,
    shippingRecommendation: policies.shippingRecommendation,
    returnRecommendation: policies.returnRecommendation,
    paymentRecommendation: policies.paymentRecommendation,
    policyReadiness: policies.policyReadiness,
    payloadPreview: buildEbayFirstListingPayloadPreview(candidate),
    humanApprovalChecklist: buildEbayFirstListingHumanApprovalChecklist(candidate),
    canProceedToDraftBuilder,
    canPublish: false,
    nextRecommendedAction: canProceedToDraftBuilder
      ? "EBAY-RESUME-B2"
      : risk.riskLevel === "HIGH"
        ? "REJECT_HIGH_RISK_CANDIDATE"
        : "NEED_PRODUCT_CANDIDATE_DATA",
  }
}

export function buildEbayFirstAutomatedListingPackageReport(fixture: PackageFixture) {
  const input = buildEbayFirstAutomatedListingPackageInput(fixture)
  const selection = buildEbayBenchmarkCandidateSelection(input)
  const candidatePackages = input.candidates.map(buildCandidatePackage)
  const recommendedCandidate = candidatePackages.find(
    (candidate) => candidate.candidateId === selection.selectedCandidateId && candidate.canProceedToDraftBuilder,
  ) ?? null
  const nextRecommendedRoute = input.accountRiskVisible
    ? "EBAY-RESUME-HOLD"
    : recommendedCandidate
      ? "EBAY-RESUME-B2"
      : "NEED_PRODUCT_CANDIDATE_DATA"
  return {
    packageVersion: EBAY_FIRST_AUTOMATED_LISTING_PACKAGE_VERSION,
    automatedListingPackageBuilt: true,
    storeName: input.storeName,
    targetMarketplace: input.targetMarketplace,
    warehouse: input.warehouse,
    candidatesEvaluated: candidatePackages.length,
    candidatePackages,
    recommendedCandidate,
    recommendedCandidateSelected: recommendedCandidate !== null,
    rejectedCandidates: candidatePackages.filter((candidate) => candidate.riskLevel === "HIGH").length,
    watchlistCandidates: candidatePackages.filter((candidate) => candidate.riskLevel === "MEDIUM").length,
    benchmarkSignalsUsed: selection.benchmarkSignalsUsed,
    winnerScoreUsed: selection.winnerScoreUsed,
    listingTitleBuilt: Boolean(recommendedCandidate?.titleCandidate),
    pricingPackageBuilt: Boolean(recommendedCandidate?.priceRecommendation),
    imagePackageBuilt: Boolean(recommendedCandidate?.imagePackage),
    payloadPreviewBuilt: Boolean(recommendedCandidate?.payloadPreview),
    humanApprovalChecklistBuilt: Boolean(recommendedCandidate?.humanApprovalChecklist.length),
    canProceedToDraftBuilder: recommendedCandidate?.canProceedToDraftBuilder === true,
    canPublish: false,
    requiresHumanApproval: true,
    nextRecommendedRoute,
  }
}

export function summarizeEbayFirstAutomatedListingPackage(report: ReturnType<typeof buildEbayFirstAutomatedListingPackageReport>) {
  return {
    automatedListingPackageBuilt: report.automatedListingPackageBuilt,
    candidatesEvaluated: report.candidatesEvaluated,
    recommendedCandidateSelected: report.recommendedCandidateSelected,
    recommendedCandidate: report.recommendedCandidate ? {
      candidateId: report.recommendedCandidate.candidateId,
      productName: report.recommendedCandidate.productName,
      riskLevel: report.recommendedCandidate.riskLevel,
      titleCandidate: report.recommendedCandidate.titleCandidate,
      recommendedPrice: report.recommendedCandidate.priceRecommendation.recommendedPrice,
      marginEstimate: report.recommendedCandidate.marginEstimate,
    } : null,
    rejectedCandidates: report.rejectedCandidates,
    watchlistCandidates: report.watchlistCandidates,
    benchmarkSignalsUsed: report.benchmarkSignalsUsed,
    winnerScoreUsed: report.winnerScoreUsed,
    listingTitleBuilt: report.listingTitleBuilt,
    pricingPackageBuilt: report.pricingPackageBuilt,
    imagePackageBuilt: report.imagePackageBuilt,
    payloadPreviewBuilt: report.payloadPreviewBuilt,
    humanApprovalChecklistBuilt: report.humanApprovalChecklistBuilt,
    canProceedToDraftBuilder: report.canProceedToDraftBuilder,
    canPublish: false,
    requiresHumanApproval: true,
    nextRecommendedRoute: report.nextRecommendedRoute,
    productionWriteTouched: false,
    mainTouched: false,
    stagingWriteExecuted: false,
    ebayApiUsedInThisLoop: false,
    ebayWriteApiUsed: false,
    oauthUsedInThisLoop: false,
    tokenStored: false,
    tokensPrinted: false,
    draftCreated: false,
    listingCreated: false,
    publicationExecuted: false,
    imageGenerationUsed: false,
    amazonTrackTouched: false,
    whatsappRealSendUsed: false,
    openAiUsed: false,
    scraperUsed: false,
    fullWarehouseStreetAddressCommitted: false,
  }
}

export function getEbayFirstAutomatedListingPackageChecklist() {
  return [
    "Use benchmark patterns and pricing signals without copying sold listings",
    "Prefer the lowest-risk complete candidate with positive estimated margin",
    "Require authorized product imagery and human image approval",
    "Require human approval of product, price, policies, risk, and payload preview",
    "Keep publication disabled and all marketplace execution outside this loop",
    "Keep only the safe Luna Portex warehouse alias and regional fields in versioned data",
  ]
}
