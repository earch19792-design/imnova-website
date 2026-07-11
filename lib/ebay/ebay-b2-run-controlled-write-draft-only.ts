export const EBAY_B2_RUN_CONTROLLED_WRITE_DRAFT_ONLY_VERSION = "EBAY_B2_RUN_CONTROLLED_WRITE_DRAFT_ONLY_V1"

type Row = Record<string, unknown>
type Fixture = Row & {
  finalApprovalPhraseReceived?: Row; selectedProduct?: Row; writeModePolicy?: Row; requiredExecutionGates?: unknown[]
  exactEnvApproval?: Row; payloadPreview?: Row; routeOutcomes?: Row; forbiddenEbayActions?: unknown[]
  allowedFutureDraftOnlyActions?: unknown[]; safetyFlags?: Record<string, boolean>
}
export type ControlledWriteSimulation = {
  controlledWriteExecutionRequested?: boolean; runtimeChecksAllPassed?: boolean; environmentApproval?: string
  interactiveConfirmation?: string; authorizedImageAsset?: boolean; policyRuntimeReady?: boolean
  categoryRuntimeReady?: boolean; stockRuntimeReady?: boolean; priceRuntimeReady?: boolean; forbiddenPublishRequested?: boolean
}
const text = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback
const number = (value: unknown, fallback = 0) => { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? parsed : fallback }
const record = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {}
const bool = (value: unknown) => value === true

export function buildEbayB2RunControlledWriteDraftOnlyInput(fixture: Fixture, simulation: ControlledWriteSimulation = {}) {
  return {
    version: text(fixture.version, EBAY_B2_RUN_CONTROLLED_WRITE_DRAFT_ONLY_VERSION), status: text(fixture.status),
    sourceRoute: text(fixture.sourceRoute), finalApprovalPhraseReceived: fixture.finalApprovalPhraseReceived ?? {},
    selectedProduct: fixture.selectedProduct ?? {}, writeModePolicy: fixture.writeModePolicy ?? {},
    requiredExecutionGates: Array.isArray(fixture.requiredExecutionGates) ? fixture.requiredExecutionGates : [],
    exactEnvApproval: fixture.exactEnvApproval ?? {}, exactInteractiveConfirmation: text(fixture.exactInteractiveConfirmation),
    forbiddenEbayActions: Array.isArray(fixture.forbiddenEbayActions) ? fixture.forbiddenEbayActions.map(String) : [],
    allowedFutureDraftOnlyActions: Array.isArray(fixture.allowedFutureDraftOnlyActions) ? fixture.allowedFutureDraftOnlyActions.map(String) : [],
    payloadPreview: fixture.payloadPreview ?? {}, routeOutcomes: fixture.routeOutcomes ?? {}, safetyFlags: fixture.safetyFlags ?? {}, simulation,
  }
}

export function validateFinalApprovalPhraseForDraftOnly(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyInput>) {
  const approval = input.finalApprovalPhraseReceived
  const expected = text(record(input.exactEnvApproval).EBAY_B2_CONTROLLED_WRITE_APPROVED)
  const accepted = bool(approval.accepted) && typeof approval.value === "string" && approval.value === expected
  return { finalApprovalPhraseAccepted: accepted, approvalSource: text(approval.source), approvalScope: "UNPUBLISHED_DRAFT_ONLY", canPublish: false }
}

export function buildNoPublishEndpointGuard(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyInput>) {
  const forbidden = input.forbiddenEbayActions
  const allowed = input.allowedFutureDraftOnlyActions
  const forbiddenRequested = bool(input.simulation.forbiddenPublishRequested)
  const exactDraftOnlyAllowlist = new Set(["createOrReplaceInventoryItem", "createOfferUnpublishedOnly"])
  const allowedActionsSafe = allowed.length > 0 && allowed.every((action) => exactDraftOnlyAllowlist.has(action))
  return {
    publishEndpointGuardBuilt: true, publishOfferForbidden: forbidden.includes("publishOffer"),
    forbiddenPublishRequested: forbiddenRequested, allowedActionsSafe,
    noPublishEndpointGuardPassed: !forbiddenRequested && allowedActionsSafe,
    permittedFutureActions: allowed, canPublish: false,
  }
}

export function buildAuthorizedImageAssetGuard(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyInput>) {
  const preview = record(input.payloadPreview.imagePolicy)
  const policySafe = !bool(preview.competitorImageCopyAllowed) && !bool(preview.ebayImageUseAllowed)
    && !bool(preview.imageGenerationUsed) && !bool(preview.imageDownloadUsed)
  return {
    authorizedImageAssetGuardBuilt: true,
    authorizedImageAssetGuardPassed: bool(input.simulation.authorizedImageAsset) && policySafe,
    requiresAuthorizedImageUrlBeforeRealWrite: bool(preview.requiresAuthorizedImageUrlBeforeRealWrite),
    competitorImageCopyAllowed: false, ebayImageUseAllowed: false, imageGenerationUsed: false, imageDownloadUsed: false,
  }
}

export function buildInventoryItemPayloadPreview(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyInput>) {
  const payload = input.payloadPreview, quantity = record(payload.quantity)
  return {
    inventoryItemPayloadPreviewBuilt: true, payloadPreviewOnly: true,
    inventoryItemPayloadPreview: {
      sku: text(payload.sku), title: text(payload.title), condition: text(payload.condition, "New"),
      quantity: number(quantity.previewQuantity, 1), stockObserved: number(quantity.stockObserved),
      imageUrls: [], availabilityGuard: "FINAL_RUNTIME_STOCK_REQUIRED",
    },
  }
}

export function buildUnpublishedOfferPayloadPreview(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyInput>) {
  const payload = input.payloadPreview, price = record(payload.price)
  return {
    unpublishedOfferPayloadPreviewBuilt: true, payloadPreviewOnly: true,
    unpublishedOfferPayloadPreview: {
      sku: text(payload.sku), marketplaceId: "EBAY_US", format: "FIXED_PRICE",
      categoryId: null, categoryStatus: text(payload.categoryStatus, "RUNTIME_REQUIRED"),
      price: { value: number(price.value), currency: text(price.currency, "USD") },
      listingStatusRequired: "UNPUBLISHED", policyIds: "RUNTIME_REQUIRED",
    },
  }
}

export function validateControlledWriteExecutionGates(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyInput>) {
  const approval = validateFinalApprovalPhraseForDraftOnly(input)
  const publishGuard = buildNoPublishEndpointGuard(input)
  const imageGuard = buildAuthorizedImageAssetGuard(input)
  const expectedEnvironmentApproval = text(record(input.exactEnvApproval).EBAY_B2_CONTROLLED_WRITE_APPROVED)
  const checks = [
    { id: "finalApprovalPhraseExact", passed: approval.finalApprovalPhraseAccepted },
    { id: "runtimeChecksAllPassed", passed: bool(input.simulation.runtimeChecksAllPassed) },
    { id: "executeControlledWriteFlag", passed: bool(input.simulation.controlledWriteExecutionRequested) },
    { id: "explicitEnvironmentApproval", passed: input.simulation.environmentApproval === expectedEnvironmentApproval },
    { id: "interactiveConfirmation", passed: input.simulation.interactiveConfirmation === input.exactInteractiveConfirmation },
    { id: "noPublishEndpointGuard", passed: publishGuard.noPublishEndpointGuardPassed },
    { id: "imageAssetAllowedGuard", passed: imageGuard.authorizedImageAssetGuardPassed },
    { id: "policyRuntimeReady", passed: bool(input.simulation.policyRuntimeReady) },
    { id: "categoryRuntimeReady", passed: bool(input.simulation.categoryRuntimeReady) },
    { id: "stockRuntimeReady", passed: bool(input.simulation.stockRuntimeReady) && number(input.selectedProduct.stockObserved) > 0 },
    { id: "priceRuntimeReady", passed: bool(input.simulation.priceRuntimeReady) && number(record(input.payloadPreview.price).value) > 0 },
  ]
  return { executionGateChecks: checks, executionGatesPassedCount: checks.filter((check) => check.passed).length, executionGatesRequiredCount: checks.length, controlledWriteGatePassed: checks.every((check) => check.passed) }
}

export function buildControlledWriteDraftOnlyGate(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyInput>) {
  return { controlledWriteGateBuilt: true, ...validateControlledWriteExecutionGates(input), controlledWriteExecutionRequested: bool(input.simulation.controlledWriteExecutionRequested) }
}

export function buildControlledWriteDryRunPlan(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyInput>) {
  return { controlledWriteDryRunPlanBuilt: true, ...buildInventoryItemPayloadPreview(input), ...buildUnpublishedOfferPayloadPreview(input), ...buildNoPublishEndpointGuard(input), ...buildAuthorizedImageAssetGuard(input), realEbayWriteExecuted: false }
}

export function buildFutureControlledWriteExecutionPlan(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyInput>) {
  const gate = buildControlledWriteDraftOnlyGate(input)
  return {
    futureControlledWriteExecutionPlanBuilt: true, futureControlledWriteReady: gate.controlledWriteGatePassed,
    futureExecutionScope: gate.controlledWriteGatePassed ? "INVENTORY_ITEM_AND_UNPUBLISHED_OFFER_ONLY" : "NONE",
    runnerImplementationRequired: true, realEbayWriteExecuted: false, canPublish: false,
  }
}

export function buildControlledWriteResultSanitizer() {
  return { sanitizerBuilt: true, allowedResultFields: ["runId", "inventoryItemCreated", "unpublishedOfferCreated", "offerIdMasked", "nextRecommendedRoute"], tokensAllowed: false, rawResponseAllowed: false }
}

export function buildControlledWriteDraftOnlyRouteRecommendation(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyInput>) {
  const approval = validateFinalApprovalPhraseForDraftOnly(input), gate = buildControlledWriteDraftOnlyGate(input)
  const publishGuard = buildNoPublishEndpointGuard(input), image = buildAuthorizedImageAssetGuard(input)
  let nextRecommendedRoute = "CONTROLLED_WRITE_DRAFT_ONLY_READY_BUT_NOT_EXECUTED"
  if (!approval.finalApprovalPhraseAccepted) nextRecommendedRoute = "NEED_FINAL_WRITE_APPROVAL"
  else if (publishGuard.forbiddenPublishRequested) nextRecommendedRoute = "EBAY-RESUME-HOLD"
  else if (input.simulation.controlledWriteExecutionRequested && !bool(input.simulation.runtimeChecksAllPassed)) nextRecommendedRoute = "NEED_RUNTIME_CHECKS"
  else if (input.simulation.controlledWriteExecutionRequested && !image.authorizedImageAssetGuardPassed) nextRecommendedRoute = "NEED_FINAL_IMAGE_ASSET"
  else if (input.simulation.controlledWriteExecutionRequested && !bool(input.simulation.policyRuntimeReady)) nextRecommendedRoute = "NEED_SELLER_POLICY_RUNTIME_CONFIRMATION"
  else if (input.simulation.controlledWriteExecutionRequested && !bool(input.simulation.categoryRuntimeReady)) nextRecommendedRoute = "NEED_CATEGORY_RUNTIME_CONFIRMATION"
  else if (gate.controlledWriteGatePassed) nextRecommendedRoute = "READY_FOR_CONTROLLED_WRITE_RUNNER_EXECUTION"
  return { nextRecommendedRoute, canPublish: false }
}

export function buildEbayB2RunControlledWriteDraftOnlyReport(fixture: Fixture, simulation: ControlledWriteSimulation = {}) {
  const input = buildEbayB2RunControlledWriteDraftOnlyInput(fixture, simulation)
  const approval = validateFinalApprovalPhraseForDraftOnly(input), dryRun = buildControlledWriteDryRunPlan(input)
  const gate = buildControlledWriteDraftOnlyGate(input), future = buildFutureControlledWriteExecutionPlan(input)
  const route = buildControlledWriteDraftOnlyRouteRecommendation(input)
  return {
    controlledWriteDraftOnlyReportBuilt: true, ...approval, runtimeChecksAllPassed: bool(simulation.runtimeChecksAllPassed),
    ...gate, ...dryRun, ...future, ...buildControlledWriteResultSanitizer(), ...route,
    selectedProductName: text(input.selectedProduct.name), selectedProductRank: number(input.selectedProduct.rank),
    realEbayApiUsedInImplementation: false, realEbayWriteExecuted: false, draftCreatedInImplementation: false,
    inventoryItemCreatedInImplementation: false, unpublishedOfferCreatedInImplementation: false,
    listingCreated: false, publicationExecuted: false, canPublish: false,
    productionWriteTouched: false, mainTouched: false, stagingWriteExecuted: false, supabaseWriteExecuted: false,
    oauthUsedInImplementation: false, tokenStored: false, tokensPrinted: false, imageGenerationUsed: false,
    imageDownloadUsed: false, imageCopyAllowed: false, scraperUsed: false, amazonTrackTouched: false,
    whatsappRealSendUsed: false, smsRealSendUsed: false, openAiUsed: false, fullWarehouseStreetAddressCommitted: false,
  }
}

export function summarizeEbayB2RunControlledWriteDraftOnly(report: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyReport>) {
  const keys = ["controlledWriteDraftOnlyReportBuilt", "finalApprovalPhraseAccepted", "runtimeChecksAllPassed", "controlledWriteExecutionRequested", "controlledWriteGatePassed", "inventoryItemPayloadPreviewBuilt", "unpublishedOfferPayloadPreviewBuilt", "publishEndpointGuardBuilt", "publishOfferForbidden", "authorizedImageAssetGuardPassed", "realEbayApiUsedInImplementation", "realEbayWriteExecuted", "draftCreatedInImplementation", "inventoryItemCreatedInImplementation", "unpublishedOfferCreatedInImplementation", "listingCreated", "publicationExecuted", "canPublish", "futureControlledWriteReady", "nextRecommendedRoute"] as const
  return Object.fromEntries(keys.map((key) => [key, report[key]]))
}

export function getEbayB2RunControlledWriteDraftOnlyChecklist(report: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyReport>) {
  return [
    { id: "approval-scope", passed: report.finalApprovalPhraseAccepted && !report.canPublish },
    { id: "payload-previews", passed: report.inventoryItemPayloadPreviewBuilt && report.unpublishedOfferPayloadPreviewBuilt },
    { id: "publish-blocked", passed: report.publishEndpointGuardBuilt && report.publishOfferForbidden && !report.publicationExecuted },
    { id: "implementation-no-write", passed: !report.realEbayApiUsedInImplementation && !report.realEbayWriteExecuted },
  ]
}
