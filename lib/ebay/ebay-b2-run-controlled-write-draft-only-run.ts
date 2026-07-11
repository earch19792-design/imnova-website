export const EBAY_B2_RUN_CONTROLLED_WRITE_DRAFT_ONLY_RUN_VERSION = "EBAY_B2_RUN_CONTROLLED_WRITE_DRAFT_ONLY_RUN_V1"

type Row = Record<string, unknown>
type Fixture = Row & { product?: Row; allowedEbayActions?: unknown[]; forbiddenEbayActions?: unknown[]; requiredRuntimeInputs?: unknown[]; requiredRuntimeChecks?: unknown[]; safetyFlags?: Record<string, boolean> }
export type DraftOnlyRunSimulation = {
  runRequested?: boolean; runApprovalPhrase?: string; environment?: string; accessTokenProvidedAtRuntime?: boolean
  marketplaceId?: string; writeRunId?: string; authorizedImageOrBypass?: boolean; interactiveConfirmation?: string
  categoryIdConfirmed?: boolean; fulfillmentPolicyConfirmed?: boolean; returnPolicyConfirmed?: boolean
  paymentPolicyConfirmed?: boolean; finalStockConfirmed?: boolean; finalPriceConfirmed?: boolean
  finalImageApprovedOrUnpublishedOnlyBypassConfirmed?: boolean; forbiddenPublishRequested?: boolean
  simulatedStock?: number; simulatedPrice?: number
}
const text = (value: unknown, fallback = "") => typeof value === "string" && value.length > 0 ? value : fallback
const number = (value: unknown, fallback = 0) => { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? parsed : fallback }
const record = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {}
const bool = (value: unknown) => value === true

export function buildEbayB2RunControlledWriteDraftOnlyRunInput(fixture: Fixture, simulation: DraftOnlyRunSimulation = {}) {
  return {
    version: text(fixture.version, EBAY_B2_RUN_CONTROLLED_WRITE_DRAFT_ONLY_RUN_VERSION), status: text(fixture.status),
    sourceRoute: text(fixture.sourceRoute), defaultMode: text(fixture.defaultMode, "SAFE_NO_WRITE"),
    realRunModeAvailableButHardGated: bool(fixture.realRunModeAvailableButHardGated), canPublish: false,
    publishOfferForbidden: bool(fixture.publishOfferForbidden), finalApprovalRequiredAgainForRealRun: bool(fixture.finalApprovalRequiredAgainForRealRun),
    exactRunApprovalPhrase: text(fixture.exactRunApprovalPhrase), exactInteractiveConfirmation: text(fixture.exactInteractiveConfirmation),
    allowedEbayActions: Array.isArray(fixture.allowedEbayActions) ? fixture.allowedEbayActions.map(String) : [],
    forbiddenEbayActions: Array.isArray(fixture.forbiddenEbayActions) ? fixture.forbiddenEbayActions.map(String) : [],
    requiredRuntimeInputs: Array.isArray(fixture.requiredRuntimeInputs) ? fixture.requiredRuntimeInputs.map(String) : [],
    requiredRuntimeChecks: Array.isArray(fixture.requiredRuntimeChecks) ? fixture.requiredRuntimeChecks.map(String) : [],
    product: fixture.product ?? {}, safetyFlags: fixture.safetyFlags ?? {}, simulation,
  }
}

export function validateControlledDraftOnlyRunApprovalPhrase(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyRunInput>) {
  const accepted = typeof input.simulation.runApprovalPhrase === "string" && input.simulation.runApprovalPhrase === input.exactRunApprovalPhrase
  return { runApprovalPhraseAccepted: accepted, finalApprovalRequiredAgainForRealRun: true, approvalScope: "CONTROLLED_DRAFT_ONLY_NO_PUBLICATION", canPublish: false }
}

export function validateControlledDraftOnlyRuntimeInputs(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyRunInput>) {
  const simulation = input.simulation
  const checks = [
    { id: "EBAY_ENVIRONMENT", present: simulation.environment === "SANDBOX" || simulation.environment === "PRODUCTION" },
    { id: "EBAY_ACCESS_TOKEN_PROVIDED_AT_RUNTIME", present: bool(simulation.accessTokenProvidedAtRuntime) },
    { id: "EBAY_MARKETPLACE_ID", present: simulation.marketplaceId === "EBAY_US" },
    { id: "EBAY_B2_CONTROLLED_WRITE_APPROVED", present: validateControlledDraftOnlyRunApprovalPhrase(input).runApprovalPhraseAccepted },
    { id: "EBAY_B2_WRITE_RUN_ID", present: typeof simulation.writeRunId === "string" && simulation.writeRunId.length >= 8 },
    { id: "AUTHORIZED_IMAGE_URL_OR_IMAGE_APPROVAL_BYPASS_FOR_UNPUBLISHED_ONLY", present: bool(simulation.authorizedImageOrBypass) },
  ]
  return {
    runtimeInputChecks: checks, runtimeInputsPresentCount: checks.filter((check) => check.present).length,
    runtimeInputsRequiredCount: checks.length, runtimeInputsPresent: checks.every((check) => check.present),
    accessTokenProvidedAtRuntime: bool(simulation.accessTokenProvidedAtRuntime), tokenStored: false, tokensPrinted: false,
  }
}

export function validateControlledDraftOnlyRuntimeChecks(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyRunInput>) {
  const simulation = input.simulation, product = input.product, price = record(product.price)
  const stock = simulation.simulatedStock === undefined ? number(product.observedStockQuantity) : number(simulation.simulatedStock)
  const finalPrice = simulation.simulatedPrice === undefined ? number(price.value) : number(simulation.simulatedPrice)
  const checks = [
    { id: "categoryIdConfirmed", passed: bool(simulation.categoryIdConfirmed) },
    { id: "fulfillmentPolicyConfirmed", passed: bool(simulation.fulfillmentPolicyConfirmed) },
    { id: "returnPolicyConfirmed", passed: bool(simulation.returnPolicyConfirmed) },
    { id: "paymentPolicyConfirmed", passed: bool(simulation.paymentPolicyConfirmed) },
    { id: "finalStockConfirmed", passed: bool(simulation.finalStockConfirmed) && stock > 0 },
    { id: "finalPriceConfirmed", passed: bool(simulation.finalPriceConfirmed) && finalPrice > 0 },
    { id: "finalImageApprovedOrUnpublishedOnlyBypassConfirmed", passed: bool(simulation.finalImageApprovedOrUnpublishedOnlyBypassConfirmed) },
    { id: "finalInteractiveConfirmation", passed: simulation.interactiveConfirmation === input.exactInteractiveConfirmation },
  ]
  return {
    runtimeCheckItems: checks, runtimeChecksPassedCount: checks.filter((check) => check.passed).length,
    runtimeChecksRequiredCount: checks.length, runtimeChecksPassed: checks.every((check) => check.passed),
    finalStock: stock, finalPrice,
  }
}

export function buildNoPublishActionGuard(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyRunInput>) {
  const exactAllowlist = new Set(["createOrReplaceInventoryItem", "createOfferUnpublishedOnly"])
  const allowedActionsSafe = input.allowedEbayActions.length === 2 && input.allowedEbayActions.every((action) => exactAllowlist.has(action))
  const forbiddenSetComplete = ["publishOffer", "publish", "createActiveListing", "reviseActiveListing", "bulkPublish"].every((action) => input.forbiddenEbayActions.includes(action))
  return {
    noPublishActionGuardBuilt: true, noPublishActionGuardPassed: allowedActionsSafe && forbiddenSetComplete && !bool(input.simulation.forbiddenPublishRequested),
    publishOfferForbidden: forbiddenSetComplete && input.publishOfferForbidden, allowedEbayActions: input.allowedEbayActions,
    forbiddenPublishRequested: bool(input.simulation.forbiddenPublishRequested), canPublish: false,
  }
}

export function buildControlledDraftOnlyInventoryItemPayload(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyRunInput>) {
  const product = input.product
  return {
    inventoryItemPayloadBuilt: true, payloadExecutionAllowedInThisImplementation: false,
    inventoryItemPayload: { sku: text(product.sku), title: text(product.title), condition: text(product.condition, "New"), quantity: number(product.quantityPreview, 1), imageUrls: [] },
  }
}

export function buildControlledDraftOnlyOfferPayload(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyRunInput>) {
  const product = input.product, price = record(product.price)
  return {
    unpublishedOfferPayloadBuilt: true, payloadExecutionAllowedInThisImplementation: false,
    unpublishedOfferPayload: { sku: text(product.sku), marketplaceId: "EBAY_US", format: "FIXED_PRICE", categoryId: null, policyIds: "RUNTIME_REQUIRED", price: { value: number(price.value), currency: text(price.currency, "USD") }, requiredState: "UNPUBLISHED" },
  }
}

export function buildEbayWriteClientPlan(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyRunInput>) {
  return {
    ebayWriteClientPlanBuilt: true, realRunImplementationReady: true, realRunExecutionDisabledLocally: true,
    localDisableFlag: "LOCAL_REAL_WRITE_EXECUTION_DISABLED", tokenHandling: "RUNTIME_PRESENCE_ONLY_NEVER_PRINT_OR_STORE",
    environmentPreference: input.simulation.environment === "PRODUCTION" ? "PRODUCTION_REQUIRES_SEPARATE_EXPLICIT_AUTHORIZATION" : "SANDBOX_PREFERRED",
    endpointAllowlistPlan: ["CREATE_OR_REPLACE_INVENTORY_ITEM", "CREATE_UNPUBLISHED_OFFER"], publishEndpointIncluded: false,
  }
}

export function buildControlledDraftOnlyRunGate(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyRunInput>) {
  const approval = validateControlledDraftOnlyRunApprovalPhrase(input), runtimeInputs = validateControlledDraftOnlyRuntimeInputs(input)
  const runtimeChecks = validateControlledDraftOnlyRuntimeChecks(input), guard = buildNoPublishActionGuard(input)
  const runRequested = bool(input.simulation.runRequested)
  return { runRequested, ...approval, ...runtimeInputs, ...runtimeChecks, ...guard, runGatePassed: runRequested && approval.runApprovalPhraseAccepted && runtimeInputs.runtimeInputsPresent && runtimeChecks.runtimeChecksPassed && guard.noPublishActionGuardPassed }
}

export function buildControlledDraftOnlyExecutionPlan(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyRunInput>) {
  const gate = buildControlledDraftOnlyRunGate(input)
  return { controlledDraftOnlyExecutionPlanBuilt: true, executionPlanReady: gate.runGatePassed, executionDisabledLocally: true, allowedExecutionSteps: gate.runGatePassed ? ["CREATE_OR_REPLACE_INVENTORY_ITEM", "CREATE_UNPUBLISHED_OFFER"] : [], publicationStepPresent: false, realEbayApiUsed: false, realEbayWriteExecuted: false }
}

export function buildControlledDraftOnlyResultSanitizer() {
  return { resultSanitizerBuilt: true, allowedFields: ["runId", "inventoryItemStatus", "unpublishedOfferStatus", "sanitizedOfferId", "nextRecommendedRoute"], rawResponseAllowed: false, tokenOutputAllowed: false, buyerDataAllowed: false }
}

export function buildControlledDraftOnlyRunRouteRecommendation(input: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyRunInput>) {
  const gate = buildControlledDraftOnlyRunGate(input)
  let nextRecommendedRoute = "SAFE_NO_WRITE"
  if (gate.forbiddenPublishRequested) nextRecommendedRoute = "EBAY-RESUME-HOLD"
  else if (!gate.runRequested) nextRecommendedRoute = "SAFE_NO_WRITE"
  else if (!gate.accessTokenProvidedAtRuntime) nextRecommendedRoute = "NEED_RUNTIME_EBAY_ACCESS_TOKEN"
  else if (!gate.runtimeInputsPresent || !gate.runtimeChecksPassed || !gate.runApprovalPhraseAccepted) nextRecommendedRoute = "NEED_RUNTIME_GATES"
  else if (gate.runGatePassed) nextRecommendedRoute = "READY_FOR_REAL_RUN_COMMAND"
  return { nextRecommendedRoute, canPublish: false }
}

export function buildEbayB2RunControlledWriteDraftOnlyRunReport(fixture: Fixture, simulation: DraftOnlyRunSimulation = {}) {
  const input = buildEbayB2RunControlledWriteDraftOnlyRunInput(fixture, simulation), gate = buildControlledDraftOnlyRunGate(input)
  return {
    controlledDraftOnlyRunReportBuilt: true, ...gate, ...buildControlledDraftOnlyInventoryItemPayload(input),
    ...buildControlledDraftOnlyOfferPayload(input), ...buildEbayWriteClientPlan(input), ...buildControlledDraftOnlyExecutionPlan(input),
    ...buildControlledDraftOnlyResultSanitizer(), ...buildControlledDraftOnlyRunRouteRecommendation(input),
    realEbayApiUsed: false, realEbayWriteExecuted: false, inventoryItemCreated: false, unpublishedOfferCreated: false,
    listingCreated: false, publicationExecuted: false, canPublish: false, tokenStored: false, tokensPrinted: false,
    productionDeploymentWriteTouched: false, mainTouched: false, stagingDbWriteExecuted: false, supabaseWriteExecuted: false,
    imageGenerationUsed: false, imageDownloadUsed: false, imageCopyAllowed: false, scraperUsed: false,
    amazonTrackTouched: false, whatsappRealSendUsed: false, smsRealSendUsed: false, openAiUsed: false,
    fullWarehouseStreetAddressCommitted: false,
  }
}

export function summarizeEbayB2RunControlledWriteDraftOnlyRun(report: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyRunReport>) {
  const keys = ["controlledDraftOnlyRunReportBuilt", "runRequested", "runApprovalPhraseAccepted", "runtimeInputsPresent", "runtimeChecksPassed", "runGatePassed", "inventoryItemPayloadBuilt", "unpublishedOfferPayloadBuilt", "noPublishActionGuardPassed", "publishOfferForbidden", "realRunImplementationReady", "realRunExecutionDisabledLocally", "realEbayApiUsed", "realEbayWriteExecuted", "canPublish", "nextRecommendedRoute"] as const
  return Object.fromEntries(keys.map((key) => [key, report[key]]))
}

export function getEbayB2RunControlledWriteDraftOnlyRunChecklist(report: ReturnType<typeof buildEbayB2RunControlledWriteDraftOnlyRunReport>) {
  return [
    { id: "payloads", passed: report.inventoryItemPayloadBuilt && report.unpublishedOfferPayloadBuilt },
    { id: "no-publish", passed: report.publishOfferForbidden && !report.canPublish && !report.publicationExecuted },
    { id: "local-disable", passed: report.realRunExecutionDisabledLocally && !report.realEbayApiUsed && !report.realEbayWriteExecuted },
    { id: "token-hygiene", passed: !report.tokenStored && !report.tokensPrinted },
  ]
}
