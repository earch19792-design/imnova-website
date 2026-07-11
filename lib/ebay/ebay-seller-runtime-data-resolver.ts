export const EBAY_SELLER_RUNTIME_DATA_RESOLVER_VERSION = "EBAY_SELLER_RUNTIME_DATA_RESOLVER_B2_RUN_V1"

type Row = Record<string, unknown>
type Fixture = Row & { selectedProduct?: Row; runtimeDataRequired?: Row; resolverModes?: Row; exactOptionalReadOnlyApproval?: Row; forbiddenActions?: unknown[]; allowedInThisLoop?: unknown[]; safetyFlags?: Record<string, boolean> }
export type RuntimeResolverSimulation = {
  categoryIdResolved?: boolean; fulfillmentPolicyResolved?: boolean; returnPolicyResolved?: boolean; paymentPolicyResolved?: boolean
  finalStockResolved?: boolean; finalPriceResolved?: boolean; finalImageResolved?: boolean; targetEnvironmentResolved?: boolean
  targetEnvironment?: string; tokenPresenceChecked?: boolean; tokenPresentBooleanOnly?: boolean
  simulatedStock?: number; simulatedPrice?: number
}
const text = (value: unknown, fallback = "") => typeof value === "string" && value.length > 0 ? value : fallback
const number = (value: unknown, fallback = 0) => { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? parsed : fallback }
const record = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {}
const bool = (value: unknown) => value === true

export function buildEbaySellerRuntimeDataResolverInput(fixture: Fixture, simulation: RuntimeResolverSimulation = {}) {
  return {
    version: text(fixture.version, EBAY_SELLER_RUNTIME_DATA_RESOLVER_VERSION), status: text(fixture.status),
    sourceRoute: text(fixture.sourceRoute), selectedProduct: fixture.selectedProduct ?? {},
    runtimeDataRequired: fixture.runtimeDataRequired ?? {}, resolverModes: fixture.resolverModes ?? {},
    exactOptionalReadOnlyApproval: fixture.exactOptionalReadOnlyApproval ?? {},
    forbiddenActions: Array.isArray(fixture.forbiddenActions) ? fixture.forbiddenActions.map(String) : [],
    allowedInThisLoop: Array.isArray(fixture.allowedInThisLoop) ? fixture.allowedInThisLoop.map(String) : [],
    safetyFlags: fixture.safetyFlags ?? {}, simulation,
  }
}

export function buildCategoryRuntimeResolverAssessment(input: ReturnType<typeof buildEbaySellerRuntimeDataResolverInput>) {
  const configured = record(input.runtimeDataRequired.categoryId), resolved = bool(input.simulation.categoryIdResolved)
  return { categoryIdStatus: resolved ? "CONFIRMED" : text(configured.status, "PENDING"), categoryIdResolved: resolved, categoryId: resolved ? "RUNTIME_CONFIRMED_CATEGORY_ID" : null, source: text(configured.source) }
}

export function buildSellerPolicyRuntimeResolverAssessment(input: ReturnType<typeof buildEbaySellerRuntimeDataResolverInput>) {
  const assessment = (key: "fulfillmentPolicyResolved" | "returnPolicyResolved" | "paymentPolicyResolved", fixtureKey: string) => {
    const configured = record(input.runtimeDataRequired[fixtureKey]), resolved = bool(input.simulation[key])
    return { status: resolved ? "CONFIRMED" : text(configured.status, "PENDING"), resolved, value: resolved ? `RUNTIME_CONFIRMED_${fixtureKey.toUpperCase()}` : null }
  }
  const fulfillment = assessment("fulfillmentPolicyResolved", "fulfillmentPolicy")
  const returns = assessment("returnPolicyResolved", "returnPolicy")
  const payment = assessment("paymentPolicyResolved", "paymentPolicy")
  return { fulfillmentPolicyStatus: fulfillment.status, returnPolicyStatus: returns.status, paymentPolicyStatus: payment.status, fulfillmentPolicyResolved: fulfillment.resolved, returnPolicyResolved: returns.resolved, paymentPolicyResolved: payment.resolved, sellerPoliciesAllResolved: fulfillment.resolved && returns.resolved && payment.resolved }
}

export function buildFinalStockRuntimeResolverAssessment(input: ReturnType<typeof buildEbaySellerRuntimeDataResolverInput>) {
  const configured = record(input.runtimeDataRequired.finalStockReview), productStock = record(input.selectedProduct.observedStockQuantity)
  const stock = input.simulation.simulatedStock === undefined ? number(productStock.value) : number(input.simulation.simulatedStock)
  const minimum = number(configured.minimumRequiredQuantity, 1)
  const resolved = bool(input.simulation.finalStockResolved) && stock >= minimum
  return { finalStockReviewStatus: resolved ? "CONFIRMED" : bool(input.simulation.finalStockResolved) ? "BLOCKED" : text(configured.status, "PENDING"), finalStockResolved: resolved, finalStockQuantity: stock, minimumRequiredQuantity: minimum }
}

export function buildFinalPriceRuntimeResolverAssessment(input: ReturnType<typeof buildEbaySellerRuntimeDataResolverInput>) {
  const configured = record(input.runtimeDataRequired.finalPriceReview), productPrice = record(input.selectedProduct.price)
  const price = input.simulation.simulatedPrice === undefined ? number(productPrice.value) : number(input.simulation.simulatedPrice)
  const resolved = bool(input.simulation.finalPriceResolved) && price > 0
  return { finalPriceReviewStatus: resolved ? "CONFIRMED" : bool(input.simulation.finalPriceResolved) ? "BLOCKED" : text(configured.status, "PENDING"), finalPriceResolved: resolved, finalPrice: price, currency: text(productPrice.currency, "USD") }
}

export function buildFinalImageAssetRuntimeResolverAssessment(input: ReturnType<typeof buildEbaySellerRuntimeDataResolverInput>) {
  const configured = record(input.runtimeDataRequired.finalImageAssetReview)
  const policySafe = !bool(configured.imageGenerationUsed) && !bool(configured.imageDownloadUsed) && !bool(configured.imageCopyAllowed)
  const resolved = bool(input.simulation.finalImageResolved) && policySafe
  return { finalImageAssetReviewStatus: resolved ? "CONFIRMED_OR_UNPUBLISHED_ONLY_BYPASS" : text(configured.status, "PENDING"), finalImageResolved: resolved, allowUnpublishedOnlyBypass: bool(configured.allowUnpublishedOnlyBypass), imageGenerationUsed: false, imageDownloadUsed: false, imageCopyAllowed: false }
}

export function buildRuntimeTokenPresenceAssessment(input: ReturnType<typeof buildEbaySellerRuntimeDataResolverInput>) {
  const checked = bool(input.simulation.tokenPresenceChecked), present = checked && bool(input.simulation.tokenPresentBooleanOnly)
  return { tokenPresenceChecked: checked, tokenPresentBooleanOnly: present, tokenPresenceStatus: !checked ? "NOT_CHECKED" : present ? "PRESENT_BOOLEAN_ONLY" : "MISSING", tokenStored: false, tokenPrinted: false }
}

export function buildRuntimeEnvironmentAssessment(input: ReturnType<typeof buildEbaySellerRuntimeDataResolverInput>) {
  const configured = record(input.runtimeDataRequired.targetEnvironment)
  const allowed = Array.isArray(configured.allowedValues) ? configured.allowedValues.map(String) : ["SANDBOX", "PRODUCTION"]
  const environment = text(input.simulation.targetEnvironment)
  const resolved = bool(input.simulation.targetEnvironmentResolved) && allowed.includes(environment)
  return { targetEnvironmentStatus: resolved ? "CONFIRMED" : text(configured.status, "PENDING"), targetEnvironmentResolved: resolved, targetEnvironment: resolved ? environment : null, preferredBeforeProduction: text(configured.preferredBeforeProduction, "SANDBOX") }
}

export function buildNoWriteResolverGuard(input: ReturnType<typeof buildEbaySellerRuntimeDataResolverInput>) {
  const requiredForbidden = ["createOrReplaceInventoryItem", "createOffer", "publishOffer", "publish", "createActiveListing", "reviseActiveListing", "bulkPublish"]
  const allowedExact = new Set(["localChecklistBuild", "localReadinessAssessment", "optionalReadOnlyPolicyLookupFuture", "tokenPresenceBooleanCheck"])
  const forbiddenComplete = requiredForbidden.every((action) => input.forbiddenActions.includes(action))
  const allowlistSafe = input.allowedInThisLoop.length === 4 && input.allowedInThisLoop.every((action) => allowedExact.has(action))
  return { noWriteResolverGuardBuilt: true, noWriteResolverGuardPassed: forbiddenComplete && allowlistSafe, publishOfferForbidden: input.forbiddenActions.includes("publishOffer"), canExecuteEbayWrite: false, canPublish: false }
}

export function buildSellerRuntimeDataChecklist(input: ReturnType<typeof buildEbaySellerRuntimeDataResolverInput>) {
  const category = buildCategoryRuntimeResolverAssessment(input), policies = buildSellerPolicyRuntimeResolverAssessment(input)
  const stock = buildFinalStockRuntimeResolverAssessment(input), price = buildFinalPriceRuntimeResolverAssessment(input)
  const image = buildFinalImageAssetRuntimeResolverAssessment(input), environment = buildRuntimeEnvironmentAssessment(input)
  const items = [
    { id: "categoryId", resolved: category.categoryIdResolved },
    { id: "fulfillmentPolicy", resolved: policies.fulfillmentPolicyResolved },
    { id: "returnPolicy", resolved: policies.returnPolicyResolved },
    { id: "paymentPolicy", resolved: policies.paymentPolicyResolved },
    { id: "finalStockReview", resolved: stock.finalStockResolved },
    { id: "finalPriceReview", resolved: price.finalPriceResolved },
    { id: "finalImageAssetReview", resolved: image.finalImageResolved },
    { id: "targetEnvironment", resolved: environment.targetEnvironmentResolved },
  ]
  return { runtimeDataChecklistBuilt: true, runtimeDataChecklist: items, runtimeDataResolvedCount: items.filter((item) => item.resolved).length, runtimeDataRequiredCount: items.length, runtimeDataAllResolved: items.every((item) => item.resolved) }
}

export function buildSellerRuntimeReadinessGate(input: ReturnType<typeof buildEbaySellerRuntimeDataResolverInput>) {
  const checklist = buildSellerRuntimeDataChecklist(input), token = buildRuntimeTokenPresenceAssessment(input), guard = buildNoWriteResolverGuard(input)
  return { ...checklist, ...token, controlledWriteRunReady: checklist.runtimeDataAllResolved && token.tokenPresentBooleanOnly && guard.noWriteResolverGuardPassed, canExecuteEbayWrite: false, canPublish: false }
}

export function buildSellerRuntimeDataResolverRouteRecommendation(input: ReturnType<typeof buildEbaySellerRuntimeDataResolverInput>) {
  const category = buildCategoryRuntimeResolverAssessment(input), policies = buildSellerPolicyRuntimeResolverAssessment(input)
  const stock = buildFinalStockRuntimeResolverAssessment(input), price = buildFinalPriceRuntimeResolverAssessment(input)
  const image = buildFinalImageAssetRuntimeResolverAssessment(input), environment = buildRuntimeEnvironmentAssessment(input)
  const token = buildRuntimeTokenPresenceAssessment(input), readiness = buildSellerRuntimeReadinessGate(input)
  let nextRecommendedRoute = "READY_FOR_CONTROLLED_DRAFT_ONLY_REAL_RUN"
  if (!category.categoryIdResolved) nextRecommendedRoute = "NEED_CATEGORY_RUNTIME_CONFIRMATION"
  else if (!policies.sellerPoliciesAllResolved) nextRecommendedRoute = "NEED_SELLER_POLICY_RUNTIME_CONFIRMATION"
  else if (!stock.finalStockResolved) nextRecommendedRoute = "NEED_FINAL_STOCK_REVIEW"
  else if (!price.finalPriceResolved) nextRecommendedRoute = "NEED_FINAL_PRICE_REVIEW"
  else if (!image.finalImageResolved) nextRecommendedRoute = "NEED_FINAL_IMAGE_ASSET"
  else if (!environment.targetEnvironmentResolved) nextRecommendedRoute = "NEED_RUNTIME_ENVIRONMENT"
  else if (!token.tokenPresentBooleanOnly) nextRecommendedRoute = "NEED_RUNTIME_EBAY_ACCESS_TOKEN"
  else if (!readiness.controlledWriteRunReady) nextRecommendedRoute = "EBAY-RESUME-HOLD"
  return { nextRecommendedRoute, canExecuteEbayWrite: false, canPublish: false }
}

export function buildEbaySellerRuntimeDataResolverReport(fixture: Fixture, simulation: RuntimeResolverSimulation = {}) {
  const input = buildEbaySellerRuntimeDataResolverInput(fixture, simulation)
  return {
    sellerRuntimeDataResolverReportBuilt: true, selectedProductSku: text(input.selectedProduct.sku),
    selectedProductTitle: text(input.selectedProduct.title), ...buildCategoryRuntimeResolverAssessment(input),
    ...buildSellerPolicyRuntimeResolverAssessment(input), ...buildFinalStockRuntimeResolverAssessment(input),
    ...buildFinalPriceRuntimeResolverAssessment(input), ...buildFinalImageAssetRuntimeResolverAssessment(input),
    ...buildRuntimeEnvironmentAssessment(input), ...buildNoWriteResolverGuard(input),
    ...buildSellerRuntimeReadinessGate(input), ...buildSellerRuntimeDataResolverRouteRecommendation(input),
    realEbayApiUsed: false, ebayWriteApiUsed: false, oauthUsedInThisLoop: false, tokenExchangeExecuted: false,
    draftCreated: false, inventoryItemCreated: false, offerCreated: false, listingCreated: false, publicationExecuted: false,
    productionWriteTouched: false, mainTouched: false, stagingWriteExecuted: false, supabaseWriteExecuted: false,
    imageGenerationUsed: false, imageDownloadUsed: false, imageCopyAllowed: false, scraperUsed: false,
    amazonTrackTouched: false, whatsappRealSendUsed: false, smsRealSendUsed: false, openAiUsed: false,
    fullWarehouseStreetAddressCommitted: false, canExecuteEbayWrite: false, canPublish: false,
  }
}

export function summarizeEbaySellerRuntimeDataResolver(report: ReturnType<typeof buildEbaySellerRuntimeDataResolverReport>) {
  const keys = ["sellerRuntimeDataResolverReportBuilt", "selectedProductSku", "selectedProductTitle", "runtimeDataChecklistBuilt", "categoryIdStatus", "fulfillmentPolicyStatus", "returnPolicyStatus", "paymentPolicyStatus", "finalStockReviewStatus", "finalPriceReviewStatus", "finalImageAssetReviewStatus", "tokenPresenceChecked", "tokenPresentBooleanOnly", "tokenStored", "tokenPrinted", "targetEnvironmentStatus", "runtimeDataResolvedCount", "runtimeDataRequiredCount", "runtimeDataAllResolved", "controlledWriteRunReady", "canExecuteEbayWrite", "canPublish", "nextRecommendedRoute"] as const
  return Object.fromEntries(keys.map((key) => [key, report[key]]))
}

export function getEbaySellerRuntimeDataResolverChecklist(report: ReturnType<typeof buildEbaySellerRuntimeDataResolverReport>) {
  return [
    { id: "eight-runtime-items", passed: report.runtimeDataRequiredCount === 8 },
    { id: "token-boolean-only", passed: !report.tokenStored && !report.tokenPrinted },
    { id: "no-write", passed: report.noWriteResolverGuardPassed && !report.canExecuteEbayWrite && !report.canPublish },
    { id: "readiness-consistent", passed: !report.controlledWriteRunReady || (report.runtimeDataAllResolved && report.tokenPresentBooleanOnly) },
  ]
}
