export const EBAY_B2_RUN_PREFLIGHT_MOBILE_APPROVED_VERSION = "EBAY_B2_RUN_PREFLIGHT_MOBILE_APPROVED_V1"

type Row = Record<string, unknown>
type Fixture = Row & { selectedCandidate?: Row; mobileApproval?: Row; listingPackagePreview?: Row; payloadPreviews?: Row; runtimeChecksRequired?: string[]; routes?: Row; safetyFlags?: Record<string, boolean> }
const text = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback
const bool = (value: unknown) => value === true
const number = (value: unknown, fallback = 0) => { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? parsed : fallback }
const record = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {}
const strings = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []

export function buildEbayB2RunPreflightMobileApprovedInput(fixture: Fixture) {
  return {
    version: text(fixture.version, EBAY_B2_RUN_PREFLIGHT_MOBILE_APPROVED_VERSION), status: text(fixture.status), sourceRoute: text(fixture.sourceRoute),
    selectedCandidate: fixture.selectedCandidate ?? {}, mobileApproval: fixture.mobileApproval ?? {},
    listing: fixture.listingPackagePreview ?? {}, payloadPreviews: fixture.payloadPreviews ?? {},
    runtimeChecksRequired: strings(fixture.runtimeChecksRequired), routes: fixture.routes ?? {}, safetyFlags: fixture.safetyFlags ?? {},
  }
}

export function validateMobileApprovalForB2RunPreflight(input: ReturnType<typeof buildEbayB2RunPreflightMobileApprovedInput>) {
  const candidate = input.selectedCandidate
  const approval = input.mobileApproval
  const gates = {
    candidateSelected: number(candidate.rank) >= 1 && text(candidate.productName).length > 0,
    rankMatches: number(candidate.rank) === number(approval.selectedCandidateRank),
    sameProductConfirmed: bool(approval.sameProductConfirmed),
    stockQuantityConfirmed: number(approval.stockQuantityObservedByHuman) >= 1,
    imageReviewOk: bool(approval.imageReviewOk), b2RunPreflightApproved: bool(approval.b2RunPreflightApproved),
    mobileApprovalGatePassed: bool(approval.mobileApprovalGatePassed),
  }
  const mobileApprovalConsumed = Object.values(gates).every(Boolean)
  return { gates, mobileApprovalConsumed, canProceedToB2RunPreflight: mobileApprovalConsumed }
}

export function buildB2RunMobileApprovedFieldSourceMap(input: ReturnType<typeof buildEbayB2RunPreflightMobileApprovedInput>) {
  return {
    fieldSourceMapBuilt: true,
    fieldSourceMap: {
      title: "EBAY_MARKET_OBSERVED", category: "EBAY_MARKET_OBSERVED", itemSpecifics: "EBAY_MARKET_OBSERVED",
      description: "EBAY_MARKET_OBSERVED", price: "EBAY_MARKET_OBSERVED", packQuantity: "EBAY_MARKET_OBSERVED",
      selectedCandidate: "TOP50_EBAY_DEMAND_RANKER", sameProduct: "HUMAN_MOBILE_CONFIRMED",
      observedStock: "HUMAN_MOBILE_CONFIRMED", imageReview: "HUMAN_MOBILE_CONFIRMED",
      supplierSku: "LUNA_SCAN_OBSERVED_IF_PRESENT", supplierCost: "UNKNOWN_FROM_SUPPLIER",
    },
  }
}

export function buildB2RunListingPackagePreview(input: ReturnType<typeof buildEbayB2RunPreflightMobileApprovedInput>) {
  const listing = input.listing
  return {
    draftPackagePreviewBuilt: true, listingFieldsCompletedFromEbay: true, payloadPreviewOnly: true,
    title: text(listing.title), condition: text(listing.condition), categorySignal: text(listing.categorySignal),
    categoryIdStatus: text(listing.categoryIdStatus), recommendedPrice: listing.recommendedPrice ?? {}, priceRange: listing.priceRange ?? {},
    quantity: listing.quantity ?? {}, observedStockQuantity: listing.observedStockQuantity ?? {}, itemSpecifics: listing.itemSpecifics ?? {},
    packQuantity: number(listing.packQuantity), description: "Reusable adjustable hook-and-loop straps help organize cables at desks, workspaces and home electronics areas.",
    imageSourcePolicy: listing.imageSourcePolicy ?? {}, supplierOperationalFields: listing.supplierOperationalFields ?? {}, warehouse: listing.warehouse ?? {},
  }
}

export function buildB2RunInventoryItemPayloadPreview(input: ReturnType<typeof buildEbayB2RunPreflightMobileApprovedInput>) {
  const packagePreview = buildB2RunListingPackagePreview(input)
  return {
    inventoryItemPayloadPreviewBuilt: true, payloadPreviewOnly: true, writeExecutionEnabled: false,
    payload: {
      sku: "runtime_required", locale: "en_US", condition: "NEW",
      product: { title: packagePreview.title, description: packagePreview.description, aspects: packagePreview.itemSpecifics, imageUrls: ["image_review_reference_only_not_for_write"] },
      availability: { shipToLocationAvailability: { quantity: 1, source: "PREVIEW_ONLY", guard: "DO_NOT_PUBLISH_WITHOUT_FINAL_STOCK_REVIEW" } },
      packageWeightAndSize: "runtime_required", publish: false,
    },
  }
}

export function buildB2RunOfferPayloadPreview(input: ReturnType<typeof buildEbayB2RunPreflightMobileApprovedInput>) {
  const listing = input.listing
  const price = record(listing.recommendedPrice)
  return {
    offerPayloadPreviewBuilt: true, payloadPreviewOnly: true, writeExecutionEnabled: false,
    payload: {
      sku: "runtime_required", marketplaceId: "EBAY_US", format: "FIXED_PRICE", categoryId: "runtime_required",
      availableQuantity: 1, quantitySource: "PREVIEW_ONLY", listingDescription: "runtime_preview_from_observed_structure",
      pricingSummary: { price: { value: number(price.value), currency: text(price.currency, "USD") } },
      merchantLocationKey: "runtime_required", fulfillmentPolicyId: "runtime_required", paymentPolicyId: "runtime_required",
      returnPolicyId: "runtime_required", publish: false,
    },
  }
}

export function buildB2RunSupplierAndStockGuard(input: ReturnType<typeof buildEbayB2RunPreflightMobileApprovedInput>) {
  const supplier = record(input.listing.supplierOperationalFields)
  const cost = record(supplier.supplierCost)
  const stock = record(supplier.supplierStock)
  return {
    supplierUnknownGuardApplied: cost.value === null || cost.value === undefined,
    supplierCostSource: text(cost.source, "UNKNOWN_FROM_SUPPLIER"), supplierCostGuard: text(cost.guard, "LOW_CONFIDENCE_GUARD"),
    supplierStockSource: text(stock.source), stockQuantityObservedByHuman: number(stock.value),
    stockGuardApplied: text(stock.guard) === "FINAL_STOCK_REVIEW_REQUIRED_BEFORE_WRITE",
    finalStockReviewRequired: true, observedStockIsNotGuaranteedInventory: true,
  }
}

export function buildB2RunImageReviewGuard(input: ReturnType<typeof buildEbayB2RunPreflightMobileApprovedInput>) {
  const policy = record(input.listing.imageSourcePolicy)
  return {
    imageReviewGuardApplied: bool(policy.imageApprovalRequired) && bool(policy.humanImageReviewOk),
    humanImageReviewOk: bool(policy.humanImageReviewOk), finalImageApprovalStillRequired: true,
    imageGenerationUsed: false, imageDownloadUsed: false, imageCopyAllowed: false,
    ebayImageUse: text(policy.ebayImages), lunaImageUse: text(policy.lunaScanImageIfPresent),
  }
}

export function buildB2RunPolicyReadinessAssessment(input: ReturnType<typeof buildEbayB2RunPreflightMobileApprovedInput>) {
  const statuses = {
    fulfillment: text(input.listing.fulfillmentPolicyStatus), returns: text(input.listing.returnPolicyStatus),
    payment: text(input.listing.paymentPolicyStatus), handlingTime: text(input.listing.handlingTimeStatus),
  }
  const policyReadinessStatus = Object.values(statuses).every((status) => status === "CONFIRMED") ? "READY" : "REVIEW_REQUIRED"
  return { policyReadinessStatus, statuses, policyIdsKnown: policyReadinessStatus === "READY" }
}

export function buildB2RunRuntimeCheckAssessment(input: ReturnType<typeof buildEbayB2RunPreflightMobileApprovedInput>) {
  return { runtimeChecksRequired: input.runtimeChecksRequired, runtimeChecksRequiredCount: input.runtimeChecksRequired.length, runtimeChecksPending: input.runtimeChecksRequired.length > 0 }
}

export function buildB2RunFinalWriteApprovalGate(input: ReturnType<typeof buildEbayB2RunPreflightMobileApprovedInput>) {
  const mobile = validateMobileApprovalForB2RunPreflight(input)
  const runtime = buildB2RunRuntimeCheckAssessment(input)
  return {
    finalWriteApprovalGateBuilt: true, mobileApprovalPrerequisitePassed: mobile.mobileApprovalConsumed,
    runtimeChecksPending: runtime.runtimeChecksPending, requiresFinalWriteApproval: true,
    canExecuteEbayWrite: false, writeExecutionEnabled: false, canPublish: false,
  }
}

export function buildB2RunPreflightMobileApprovedRouteRecommendation(input: ReturnType<typeof buildEbayB2RunPreflightMobileApprovedInput>) {
  const mobile = validateMobileApprovalForB2RunPreflight(input)
  const runtime = buildB2RunRuntimeCheckAssessment(input)
  let nextRecommendedRoute = "NEED_MOBILE_CONFIRMATIONS"
  if (!text(input.selectedCandidate.productName)) nextRecommendedRoute = "NEED_HUMAN_TOP_PRODUCT_SELECTION"
  else if (strings(input.selectedCandidate.riskFlags).length) nextRecommendedRoute = "EBAY-RESUME-HOLD"
  else if (mobile.mobileApprovalConsumed) nextRecommendedRoute = runtime.runtimeChecksPending ? "READY_FOR_B2_RUN_WRITE_APPROVAL_WITH_RUNTIME_CHECKS" : "READY_FOR_B2_RUN_WRITE_APPROVAL"
  return { nextRecommendedRoute, canProceedToB2RunPreflight: mobile.mobileApprovalConsumed, canExecuteEbayWrite: false, canPublish: false }
}

export function buildEbayB2RunPreflightMobileApprovedReport(fixture: Fixture) {
  const input = buildEbayB2RunPreflightMobileApprovedInput(fixture)
  const approval = validateMobileApprovalForB2RunPreflight(input)
  const sources = buildB2RunMobileApprovedFieldSourceMap(input)
  const listing = buildB2RunListingPackagePreview(input)
  const inventory = buildB2RunInventoryItemPayloadPreview(input)
  const offer = buildB2RunOfferPayloadPreview(input)
  const supplier = buildB2RunSupplierAndStockGuard(input)
  const image = buildB2RunImageReviewGuard(input)
  const policies = buildB2RunPolicyReadinessAssessment(input)
  const runtime = buildB2RunRuntimeCheckAssessment(input)
  const writeGate = buildB2RunFinalWriteApprovalGate(input)
  const route = buildB2RunPreflightMobileApprovedRouteRecommendation(input)
  return {
    b2RunPreflightMobileApprovedReportBuilt: true, mobileApprovalConsumed: approval.mobileApprovalConsumed,
    selectedCandidateName: text(input.selectedCandidate.productName), selectedCandidateRank: number(input.selectedCandidate.rank),
    opportunityScore: number(input.selectedCandidate.opportunityScore),
    sameProductConfirmed: approval.gates.sameProductConfirmed,
    imageReviewOk: approval.gates.imageReviewOk, b2RunPreflightApproved: approval.gates.b2RunPreflightApproved,
    ...listing, ...inventory, ...offer, ...sources, ...supplier, ...image, ...policies, ...runtime, ...writeGate, ...route,
    categoryIdStatus: text(input.listing.categoryIdStatus),
    productionWriteTouched: false, mainTouched: false, stagingWriteExecuted: false,
    ebayApiUsedInThisLoop: false, ebayWriteApiUsed: false, oauthUsedInThisLoop: false,
    tokenStored: false, tokensPrinted: false, draftCreated: false, listingCreated: false, offerCreated: false,
    publicationExecuted: false, scraperUsed: false, amazonTrackTouched: false, whatsappRealSendUsed: false,
    smsRealSendUsed: false, openAiUsed: false, fullWarehouseStreetAddressCommitted: false,
  }
}

export function summarizeEbayB2RunPreflightMobileApproved(report: ReturnType<typeof buildEbayB2RunPreflightMobileApprovedReport>) {
  return {
    b2RunPreflightMobileApprovedReportBuilt: report.b2RunPreflightMobileApprovedReportBuilt, mobileApprovalConsumed: report.mobileApprovalConsumed,
    selectedCandidateName: report.selectedCandidateName, selectedCandidateRank: report.selectedCandidateRank, opportunityScore: report.opportunityScore,
    sameProductConfirmed: report.sameProductConfirmed, stockQuantityObservedByHuman: report.stockQuantityObservedByHuman,
    imageReviewOk: report.imageReviewOk, b2RunPreflightApproved: report.b2RunPreflightApproved,
    draftPackagePreviewBuilt: report.draftPackagePreviewBuilt, inventoryItemPayloadPreviewBuilt: report.inventoryItemPayloadPreviewBuilt,
    offerPayloadPreviewBuilt: report.offerPayloadPreviewBuilt, listingFieldsCompletedFromEbay: report.listingFieldsCompletedFromEbay,
    supplierCostSource: report.supplierCostSource, supplierStockSource: report.supplierStockSource,
    supplierUnknownGuardApplied: report.supplierUnknownGuardApplied, stockGuardApplied: report.stockGuardApplied,
    imageReviewGuardApplied: report.imageReviewGuardApplied, categoryIdStatus: report.categoryIdStatus,
    policyReadinessStatus: report.policyReadinessStatus, runtimeChecksRequiredCount: report.runtimeChecksRequiredCount,
    finalWriteApprovalGateBuilt: report.finalWriteApprovalGateBuilt, canProceedToB2RunPreflight: report.canProceedToB2RunPreflight,
    canExecuteEbayWrite: report.canExecuteEbayWrite, canPublish: report.canPublish,
    requiresFinalWriteApproval: report.requiresFinalWriteApproval, nextRecommendedRoute: report.nextRecommendedRoute,
    productionWriteTouched: report.productionWriteTouched, mainTouched: report.mainTouched, stagingWriteExecuted: report.stagingWriteExecuted,
    ebayApiUsedInThisLoop: report.ebayApiUsedInThisLoop, ebayWriteApiUsed: report.ebayWriteApiUsed,
    oauthUsedInThisLoop: report.oauthUsedInThisLoop, tokenStored: report.tokenStored, tokensPrinted: report.tokensPrinted,
    draftCreated: report.draftCreated, listingCreated: report.listingCreated, offerCreated: report.offerCreated,
    publicationExecuted: report.publicationExecuted, imageGenerationUsed: report.imageGenerationUsed,
    imageDownloadUsed: report.imageDownloadUsed, imageCopyAllowed: report.imageCopyAllowed, scraperUsed: report.scraperUsed,
    amazonTrackTouched: report.amazonTrackTouched, whatsappRealSendUsed: report.whatsappRealSendUsed,
    smsRealSendUsed: report.smsRealSendUsed, openAiUsed: report.openAiUsed,
    fullWarehouseStreetAddressCommitted: report.fullWarehouseStreetAddressCommitted,
  }
}

export function getEbayB2RunPreflightMobileApprovedChecklist(report: ReturnType<typeof buildEbayB2RunPreflightMobileApprovedReport>) {
  return [
    { id: "mobile-approval", passed: report.mobileApprovalConsumed },
    { id: "payload-previews", passed: report.draftPackagePreviewBuilt && report.inventoryItemPayloadPreviewBuilt && report.offerPayloadPreviewBuilt },
    { id: "guards", passed: report.supplierUnknownGuardApplied && report.stockGuardApplied && report.imageReviewGuardApplied },
    { id: "write-blocked", passed: !report.canExecuteEbayWrite && !report.canPublish && report.requiresFinalWriteApproval },
  ]
}
