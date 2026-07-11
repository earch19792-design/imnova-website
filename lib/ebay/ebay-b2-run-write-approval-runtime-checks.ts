export const EBAY_B2_RUN_WRITE_APPROVAL_RUNTIME_CHECKS_VERSION = "EBAY_B2_RUN_WRITE_APPROVAL_RUNTIME_CHECKS_V1"

type Row = Record<string, unknown>
type Fixture = Row & { selectedCandidate?: Row; listingPackage?: Row; runtimeChecks?: Row; approvalPolicy?: Row; routes?: Row; safetyFlags?: Record<string, boolean> }
export type RuntimeSimulation = { runtimeChecksPassed?: boolean; finalWriteApprovalPhrase?: string; simulatedStock?: number }
const text = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback
const number = (value: unknown, fallback = 0) => { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? parsed : fallback }
const record = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {}
const bool = (value: unknown) => value === true

export function buildEbayB2RunWriteApprovalRuntimeChecksInput(fixture: Fixture, simulation: RuntimeSimulation = {}) {
  return {
    version: text(fixture.version, EBAY_B2_RUN_WRITE_APPROVAL_RUNTIME_CHECKS_VERSION), status: text(fixture.status), sourceRoute: text(fixture.sourceRoute),
    selectedCandidate: fixture.selectedCandidate ?? {}, listingPackage: fixture.listingPackage ?? {},
    runtimeChecks: fixture.runtimeChecks ?? {}, approvalPolicy: fixture.approvalPolicy ?? {}, routes: fixture.routes ?? {},
    safetyFlags: fixture.safetyFlags ?? {}, simulation,
  }
}

export function buildCategoryRuntimeCheckAssessment(input: ReturnType<typeof buildEbayB2RunWriteApprovalRuntimeChecksInput>) {
  const check = record(input.runtimeChecks.categoryId)
  const confirmed = bool(input.simulation.runtimeChecksPassed)
  return {
    categoryRuntimeCheckStatus: confirmed ? "CONFIRMED" : text(check.status, "PENDING_RUNTIME_CONFIRMATION"),
    categoryId: confirmed ? "MODELED_RUNTIME_CATEGORY_ID" : check.value ?? null,
    categorySignal: text(input.listingPackage.categorySignal), source: confirmed ? "LOCAL_RUNTIME_SIMULATION" : text(check.source),
    passed: confirmed,
  }
}

export function buildSellerPolicyRuntimeCheckAssessment(input: ReturnType<typeof buildEbayB2RunWriteApprovalRuntimeChecksInput>) {
  const confirmed = bool(input.simulation.runtimeChecksPassed)
  const assessment = (name: string) => {
    const check = record(input.runtimeChecks[name])
    return { status: confirmed ? "CONFIRMED" : text(check.status, "REVIEW_REQUIRED"), value: confirmed ? `MODELED_${name.toUpperCase()}_ID` : check.value ?? null, source: confirmed ? "LOCAL_RUNTIME_SIMULATION" : text(check.source) }
  }
  const fulfillment = assessment("fulfillmentPolicy"), returns = assessment("returnPolicy"), payment = assessment("paymentPolicy")
  return {
    fulfillmentPolicyStatus: fulfillment.status, returnPolicyStatus: returns.status, paymentPolicyStatus: payment.status,
    policies: { fulfillment, returns, payment }, sellerPoliciesPassed: confirmed,
  }
}

export function buildFinalStockReviewAssessment(input: ReturnType<typeof buildEbayB2RunWriteApprovalRuntimeChecksInput>) {
  const check = record(input.runtimeChecks.finalStockReview)
  const hasOverride = input.simulation.simulatedStock !== undefined
  const stock = hasOverride ? number(input.simulation.simulatedStock) : number(check.observedStockQuantity)
  const minimum = number(check.minimumRequiredQuantityForDraft, 1)
  const explicitlyConfirmed = bool(input.simulation.runtimeChecksPassed) || hasOverride
  const passed = explicitlyConfirmed && stock >= minimum
  return {
    finalStockReviewStatus: passed ? "CONFIRMED" : explicitlyConfirmed ? "BLOCKED" : text(check.status, "PENDING"),
    finalStockQuantity: stock, minimumRequiredQuantityForDraft: minimum, source: text(check.source), passed,
  }
}

export function buildFinalPriceReviewAssessment(input: ReturnType<typeof buildEbayB2RunWriteApprovalRuntimeChecksInput>) {
  const check = record(input.runtimeChecks.finalPriceReview)
  const passed = bool(input.simulation.runtimeChecksPassed) && number(check.recommendedPrice) > 0
  return { finalPriceReviewStatus: passed ? "CONFIRMED" : text(check.status, "PENDING"), finalPrice: number(check.recommendedPrice), currency: text(check.currency, "USD"), source: text(check.source), passed }
}

export function buildFinalImageReviewAssessment(input: ReturnType<typeof buildEbayB2RunWriteApprovalRuntimeChecksInput>) {
  const check = record(input.runtimeChecks.finalImageReview)
  const passed = bool(input.simulation.runtimeChecksPassed) && bool(check.humanImageReviewOkFromMobile)
    && !bool(check.imageCopyAllowed) && !bool(check.imageGenerationUsed) && !bool(check.imageDownloadUsed)
  return {
    finalImageReviewStatus: passed ? "CONFIRMED" : text(check.status, "PENDING"), passed,
    humanImageReviewOkFromMobile: bool(check.humanImageReviewOkFromMobile), imageCopyAllowed: false,
    imageGenerationUsed: false, imageDownloadUsed: false, finalOwnOrAuthorizedImageRequired: true,
  }
}

export function buildFinalHumanWriteApprovalCard(input: ReturnType<typeof buildEbayB2RunWriteApprovalRuntimeChecksInput>) {
  const check = record(input.runtimeChecks.finalHumanWriteApproval)
  return {
    finalHumanWriteApprovalCardBuilt: true, exactApprovalPhrase: text(check.exactApprovalPhrase),
    enteredApprovalPhrase: input.simulation.finalWriteApprovalPhrase ?? null,
    warning: "Approval is limited to a future controlled unpublished draft or offer. Active publication remains forbidden.",
    publishAllowedByThisApproval: false,
  }
}

export function validateFinalWriteApprovalPhrase(input: ReturnType<typeof buildEbayB2RunWriteApprovalRuntimeChecksInput>) {
  const card = buildFinalHumanWriteApprovalCard(input)
  const accepted = typeof card.enteredApprovalPhrase === "string" && card.enteredApprovalPhrase === card.exactApprovalPhrase
  return { finalWriteApprovalPhraseAccepted: accepted, finalHumanWriteApprovalStatus: accepted ? "CONFIRMED" : "PENDING", approvalScope: "UNPUBLISHED_DRAFT_ONLY", canPublish: false }
}

export function buildRuntimeCheckChecklist(input: ReturnType<typeof buildEbayB2RunWriteApprovalRuntimeChecksInput>) {
  const category = buildCategoryRuntimeCheckAssessment(input)
  const policies = buildSellerPolicyRuntimeCheckAssessment(input)
  const stock = buildFinalStockReviewAssessment(input)
  const price = buildFinalPriceReviewAssessment(input)
  const image = buildFinalImageReviewAssessment(input)
  const approval = validateFinalWriteApprovalPhrase(input)
  const items = [
    { id: "categoryId", status: category.categoryRuntimeCheckStatus, passed: category.passed },
    { id: "fulfillmentPolicy", status: policies.fulfillmentPolicyStatus, passed: policies.fulfillmentPolicyStatus === "CONFIRMED" },
    { id: "returnPolicy", status: policies.returnPolicyStatus, passed: policies.returnPolicyStatus === "CONFIRMED" },
    { id: "paymentPolicy", status: policies.paymentPolicyStatus, passed: policies.paymentPolicyStatus === "CONFIRMED" },
    { id: "finalStockReview", status: stock.finalStockReviewStatus, passed: stock.passed },
    { id: "finalPriceReview", status: price.finalPriceReviewStatus, passed: price.passed },
    { id: "finalImageReview", status: image.finalImageReviewStatus, passed: image.passed },
    { id: "finalHumanWriteApproval", status: approval.finalHumanWriteApprovalStatus, passed: approval.finalWriteApprovalPhraseAccepted },
  ]
  return { runtimeChecksBuilt: true, runtimeChecks: items, runtimeChecksPassedCount: items.filter((item) => item.passed).length, runtimeChecksRequiredCount: items.length, runtimeChecksAllPassed: items.every((item) => item.passed) }
}

export function buildRuntimeChecksGateAssessment(input: ReturnType<typeof buildEbayB2RunWriteApprovalRuntimeChecksInput>) {
  const checklist = buildRuntimeCheckChecklist(input)
  const phrase = validateFinalWriteApprovalPhrase(input)
  return { ...checklist, ...phrase, gatePassed: checklist.runtimeChecksAllPassed && phrase.finalWriteApprovalPhraseAccepted }
}

export function buildControlledWriteReadinessForNextLoop(input: ReturnType<typeof buildEbayB2RunWriteApprovalRuntimeChecksInput>) {
  const gate = buildRuntimeChecksGateAssessment(input)
  return {
    controlledWriteReadyForNextLoop: gate.gatePassed, requiresControlledWriteRunNext: gate.gatePassed,
    canExecuteEbayWriteInThisLoop: false, canCreateDraftInThisLoop: false, canPublish: false,
    allowedFutureScope: gate.gatePassed ? "CONTROLLED_UNPUBLISHED_DRAFT_OR_OFFER_ONLY" : "NONE",
  }
}

export function buildB2RunWriteApprovalRouteRecommendation(input: ReturnType<typeof buildEbayB2RunWriteApprovalRuntimeChecksInput>) {
  const category = buildCategoryRuntimeCheckAssessment(input)
  const policies = buildSellerPolicyRuntimeCheckAssessment(input)
  const stock = buildFinalStockReviewAssessment(input)
  const price = buildFinalPriceReviewAssessment(input)
  const image = buildFinalImageReviewAssessment(input)
  const approval = validateFinalWriteApprovalPhrase(input)
  let nextRecommendedRoute = "READY_FOR_CONTROLLED_B2_WRITE_DRAFT_ONLY"
  if (Array.isArray(input.selectedCandidate.riskFlags) && input.selectedCandidate.riskFlags.length) nextRecommendedRoute = "EBAY-RESUME-HOLD"
  else if (input.simulation.simulatedStock !== undefined && !stock.passed) nextRecommendedRoute = "NEED_FINAL_STOCK_REVIEW"
  else if (!category.passed) nextRecommendedRoute = "NEED_CATEGORY_RUNTIME_CONFIRMATION"
  else if (!policies.sellerPoliciesPassed) nextRecommendedRoute = "NEED_SELLER_POLICY_RUNTIME_CONFIRMATION"
  else if (!stock.passed) nextRecommendedRoute = "NEED_FINAL_STOCK_REVIEW"
  else if (!price.passed) nextRecommendedRoute = "NEED_FINAL_PRICE_REVIEW"
  else if (!image.passed) nextRecommendedRoute = "NEED_FINAL_IMAGE_REVIEW"
  else if (!approval.finalWriteApprovalPhraseAccepted) nextRecommendedRoute = "NEED_FINAL_WRITE_APPROVAL"
  return { nextRecommendedRoute, canExecuteEbayWriteInThisLoop: false, canPublish: false }
}

export function buildEbayB2RunWriteApprovalRuntimeChecksReport(fixture: Fixture, simulation: RuntimeSimulation = {}) {
  const input = buildEbayB2RunWriteApprovalRuntimeChecksInput(fixture, simulation)
  const category = buildCategoryRuntimeCheckAssessment(input), policies = buildSellerPolicyRuntimeCheckAssessment(input)
  const stock = buildFinalStockReviewAssessment(input), price = buildFinalPriceReviewAssessment(input)
  const image = buildFinalImageReviewAssessment(input), approvalCard = buildFinalHumanWriteApprovalCard(input)
  const gate = buildRuntimeChecksGateAssessment(input), readiness = buildControlledWriteReadinessForNextLoop(input)
  const route = buildB2RunWriteApprovalRouteRecommendation(input)
  return {
    b2RunWriteApprovalRuntimeChecksReportBuilt: true, selectedCandidateName: text(input.selectedCandidate.productName),
    selectedCandidateRank: number(input.selectedCandidate.rank), opportunityScore: number(input.selectedCandidate.opportunityScore),
    ...category, ...policies, ...stock, ...price, ...image, ...approvalCard, ...gate, ...readiness, ...route,
    productionWriteTouched: false, mainTouched: false, stagingWriteExecuted: false, supabaseWriteExecuted: false,
    ebayApiUsedInThisLoop: false, ebayWriteApiUsed: false, oauthUsedInThisLoop: false, tokenStored: false, tokensPrinted: false,
    draftCreated: false, listingCreated: false, offerCreated: false, publicationExecuted: false,
    scraperUsed: false, amazonTrackTouched: false, whatsappRealSendUsed: false, smsRealSendUsed: false,
    openAiUsed: false, fullWarehouseStreetAddressCommitted: false,
  }
}

export function summarizeEbayB2RunWriteApprovalRuntimeChecks(report: ReturnType<typeof buildEbayB2RunWriteApprovalRuntimeChecksReport>) {
  return {
    b2RunWriteApprovalRuntimeChecksReportBuilt: report.b2RunWriteApprovalRuntimeChecksReportBuilt,
    selectedCandidateName: report.selectedCandidateName, selectedCandidateRank: report.selectedCandidateRank,
    runtimeChecksBuilt: report.runtimeChecksBuilt, categoryRuntimeCheckStatus: report.categoryRuntimeCheckStatus,
    fulfillmentPolicyStatus: report.fulfillmentPolicyStatus, returnPolicyStatus: report.returnPolicyStatus,
    paymentPolicyStatus: report.paymentPolicyStatus, finalStockReviewStatus: report.finalStockReviewStatus,
    finalPriceReviewStatus: report.finalPriceReviewStatus, finalImageReviewStatus: report.finalImageReviewStatus,
    finalHumanWriteApprovalStatus: report.finalHumanWriteApprovalStatus, runtimeChecksPassedCount: report.runtimeChecksPassedCount,
    runtimeChecksRequiredCount: report.runtimeChecksRequiredCount, runtimeChecksAllPassed: report.runtimeChecksAllPassed,
    finalWriteApprovalPhraseAccepted: report.finalWriteApprovalPhraseAccepted,
    controlledWriteReadyForNextLoop: report.controlledWriteReadyForNextLoop,
    canExecuteEbayWriteInThisLoop: report.canExecuteEbayWriteInThisLoop, canCreateDraftInThisLoop: report.canCreateDraftInThisLoop,
    canPublish: report.canPublish, requiresControlledWriteRunNext: report.requiresControlledWriteRunNext,
    nextRecommendedRoute: report.nextRecommendedRoute, productionWriteTouched: report.productionWriteTouched,
    mainTouched: report.mainTouched, stagingWriteExecuted: report.stagingWriteExecuted, supabaseWriteExecuted: report.supabaseWriteExecuted,
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

export function getEbayB2RunWriteApprovalRuntimeChecksChecklist(report: ReturnType<typeof buildEbayB2RunWriteApprovalRuntimeChecksReport>) {
  return [
    { id: "eight-checks", passed: report.runtimeChecksRequiredCount === 8 },
    { id: "future-readiness", passed: !report.controlledWriteReadyForNextLoop || report.runtimeChecksAllPassed },
    { id: "write-blocked", passed: !report.canExecuteEbayWriteInThisLoop && !report.canCreateDraftInThisLoop && !report.canPublish },
  ]
}
