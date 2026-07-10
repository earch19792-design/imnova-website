export const EBAY_GATED_DRAFT_UNPUBLISHED_OFFER_BUILDER_VERSION =
  "EBAY_GATED_DRAFT_UNPUBLISHED_OFFER_BUILDER_RESUME_B2_V1"

type Fixture = {
  builderVersion?: string
  status?: string
  mode?: string
  sourcePackage?: string
  storeName?: string
  targetMarketplace?: string
  warehouse?: Record<string, unknown>
  recommendedCandidate?: Record<string, unknown>
  routeInputs?: Record<string, unknown>
  policyUnlockModel?: Record<string, unknown>
  accountRiskKnown?: boolean
  safetyFlags?: Record<string, boolean>
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function number(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown) {
  return value === true
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function stringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, string>
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function buildEbayGatedDraftBuilderInput(fixture: Fixture) {
  const candidate = fixture.recommendedCandidate ?? {}
  const warehouse = fixture.warehouse ?? {}
  const policy = fixture.policyUnlockModel ?? {}
  const route = fixture.routeInputs ?? {}
  return {
    builderVersion: text(fixture.builderVersion, EBAY_GATED_DRAFT_UNPUBLISHED_OFFER_BUILDER_VERSION),
    status: text(fixture.status),
    mode: text(fixture.mode),
    sourcePackage: text(fixture.sourcePackage),
    storeName: text(fixture.storeName),
    targetMarketplace: text(fixture.targetMarketplace, "EBAY_US"),
    warehouse: {
      warehouseAlias: text(warehouse.warehouseAlias),
      city: text(warehouse.city),
      state: text(warehouse.state),
      postalCode: text(warehouse.postalCode),
      country: text(warehouse.country),
      fullWarehouseStreetAddressCommitted: bool(warehouse.fullWarehouseStreetAddressCommitted),
    },
    candidate: {
      candidateId: text(candidate.candidateId),
      productName: text(candidate.productName),
      riskLevel: text(candidate.riskLevel, "UNKNOWN"),
      titleCandidate: text(candidate.titleCandidate),
      buyItNowPrice: number(candidate.buyItNowPrice),
      currency: text(candidate.currency, "USD"),
      estimatedProfit: number(candidate.estimatedProfit),
      estimatedMarginPercent: number(candidate.estimatedMarginPercent),
      condition: text(candidate.condition, "New"),
      quantity: number(candidate.quantity, 1),
      listingFormat: text(candidate.listingFormat, "FIXED_PRICE"),
      canProceedToDraftBuilder: bool(candidate.canProceedToDraftBuilder),
      descriptionCandidate: text(candidate.descriptionCandidate),
      suggestedCategory: text(candidate.suggestedCategory),
      finalCategoryIdKnown: bool(candidate.finalCategoryIdKnown),
      itemSpecifics: stringRecord(candidate.itemSpecifics),
      missingItemSpecifics: stringArray(candidate.missingItemSpecifics),
      authorizedImageAvailable: bool(candidate.authorizedImageAvailable),
      imageApprovalRequired: bool(candidate.imageApprovalRequired),
      mainImageRequirement: text(candidate.mainImageRequirement),
      packageWeightAndSizeKnown: bool(candidate.packageWeightAndSizeKnown),
      humanApprovalChecklistExists: bool(candidate.humanApprovalChecklistExists),
      payloadPreviewComplete: bool(candidate.payloadPreviewComplete),
    },
    route: {
      a5Integrated: route["EBAY-RESUME-A5"] === "integrated",
      cAutoIntegrated: route["EBAY-RESUME-C-AUTO"] === "integrated",
      canProceedToAutomatedListingPackage: bool(route.canProceedToAutomatedListingPackage),
      canProceedToDraftBuilder: bool(route.canProceedToDraftBuilder),
    },
    policy: {
      payoutUnlockModelDetected: bool(policy.payoutUnlockModelDetected),
      businessPoliciesUnlockModelDetected: bool(policy.businessPoliciesUnlockModelDetected),
      policyIdsKnown: bool(policy.policyIdsKnown),
      paymentPolicyIdKnown: bool(policy.paymentPolicyIdKnown),
      fulfillmentPolicyIdKnown: bool(policy.fulfillmentPolicyIdKnown),
      returnPolicyIdKnown: bool(policy.returnPolicyIdKnown),
      inventoryLocationKeyKnown: bool(policy.inventoryLocationKeyKnown),
    },
    accountRiskKnown: bool(fixture.accountRiskKnown),
    safetyFlags: fixture.safetyFlags ?? {},
  }
}

export function buildEbayPolicyDependencyMap(input: ReturnType<typeof buildEbayGatedDraftBuilderInput>) {
  return {
    payoutUnlockModelDetected: input.policy.payoutUnlockModelDetected,
    businessPoliciesUnlockModelDetected: input.policy.businessPoliciesUnlockModelDetected,
    fulfillmentPolicyId: input.policy.fulfillmentPolicyIdKnown ? "known_at_runtime" : "runtime_required",
    paymentPolicyId: input.policy.paymentPolicyIdKnown ? "known_at_runtime" : "runtime_required",
    returnPolicyId: input.policy.returnPolicyIdKnown ? "known_at_runtime" : "runtime_required",
    missingRuntimeDependencies: [
      !input.policy.fulfillmentPolicyIdKnown ? "fulfillmentPolicyId" : "",
      !input.policy.paymentPolicyIdKnown ? "paymentPolicyId" : "",
      !input.policy.returnPolicyIdKnown ? "returnPolicyId" : "",
    ].filter(Boolean),
    ignored: false,
  }
}

export function buildEbayLocationDependencyMap(input: ReturnType<typeof buildEbayGatedDraftBuilderInput>) {
  const safeAliasReady =
    input.warehouse.warehouseAlias === "LUNA_PORTEX_BOCA_RATON" &&
    !input.warehouse.fullWarehouseStreetAddressCommitted
  return {
    safeWarehouseAlias: input.warehouse.warehouseAlias,
    safeAliasReady,
    merchantLocationKey: input.policy.inventoryLocationKeyKnown ? input.warehouse.warehouseAlias : "runtime_required",
    inventoryLocationKeyKnown: input.policy.inventoryLocationKeyKnown,
    missingRuntimeDependencies: input.policy.inventoryLocationKeyKnown ? [] : ["merchantLocationKey"],
  }
}

export function buildEbayImageDependencyMap(input: ReturnType<typeof buildEbayGatedDraftBuilderInput>) {
  return {
    authorizedImageAvailable: input.candidate.authorizedImageAvailable,
    imageApprovalRequired: true,
    mainImageRequirement: input.candidate.mainImageRequirement || "Authorized product image required",
    competitorImagesAllowed: false,
    imageGenerationAllowed: false,
    payloadImageReference: "image_required_or_pending",
    blocksControlledExecution: !input.candidate.authorizedImageAvailable,
  }
}

export function buildEbayCategoryAndSpecificsDependencyMap(input: ReturnType<typeof buildEbayGatedDraftBuilderInput>) {
  return {
    suggestedCategory: input.candidate.suggestedCategory,
    categoryId: input.candidate.finalCategoryIdKnown ? "known_at_runtime" : "unknown_or_suggested",
    finalCategoryIdKnown: input.candidate.finalCategoryIdKnown,
    itemSpecifics: input.candidate.itemSpecifics,
    missingItemSpecifics: input.candidate.missingItemSpecifics,
    criticalSpecificsReady: input.candidate.missingItemSpecifics.length === 0,
    missingRuntimeDependencies: input.candidate.finalCategoryIdKnown ? [] : ["finalCategoryId"],
  }
}

export function buildEbayInventoryItemPayloadPreview(input: ReturnType<typeof buildEbayGatedDraftBuilderInput>) {
  const category = buildEbayCategoryAndSpecificsDependencyMap(input)
  const image = buildEbayImageDependencyMap(input)
  return {
    previewOnly: true,
    executionAllowed: false,
    sku: input.candidate.candidateId,
    marketplaceId: input.targetMarketplace,
    condition: "NEW",
    availability: { shipToLocationAvailability: { quantity: input.candidate.quantity } },
    title: input.candidate.titleCandidate,
    description: input.candidate.descriptionCandidate,
    categoryId: category.categoryId,
    aspects: input.candidate.itemSpecifics,
    images: image.payloadImageReference,
    packageWeightAndSize: input.candidate.packageWeightAndSizeKnown ? "known_at_runtime" : "pending_if_unknown",
    publish: false,
  }
}

export function buildEbayOfferPayloadPreview(input: ReturnType<typeof buildEbayGatedDraftBuilderInput>) {
  const policy = buildEbayPolicyDependencyMap(input)
  const location = buildEbayLocationDependencyMap(input)
  const category = buildEbayCategoryAndSpecificsDependencyMap(input)
  return {
    previewOnly: true,
    executionAllowed: false,
    sku: input.candidate.candidateId,
    marketplaceId: input.targetMarketplace,
    format: input.candidate.listingFormat,
    availableQuantity: input.candidate.quantity,
    categoryId: category.categoryId,
    merchantLocationKey: location.merchantLocationKey,
    listingPolicies: {
      fulfillmentPolicyId: policy.fulfillmentPolicyId,
      paymentPolicyId: policy.paymentPolicyId,
      returnPolicyId: policy.returnPolicyId,
    },
    pricingSummary: { price: { value: input.candidate.buyItNowPrice, currency: input.candidate.currency } },
    publish: false,
  }
}

export function buildEbayDraftExecutionGateChecklist(input: ReturnType<typeof buildEbayGatedDraftBuilderInput>) {
  return [
    { gate: "source listing package ready", passed: input.route.cAutoIntegrated && input.candidate.canProceedToDraftBuilder },
    { gate: "candidate risk is LOW", passed: input.candidate.riskLevel === "LOW" },
    { gate: "title, price, and description exist", passed: Boolean(input.candidate.titleCandidate && input.candidate.buyItNowPrice > 0 && input.candidate.descriptionCandidate) },
    { gate: "critical item specifics complete", passed: input.candidate.missingItemSpecifics.length === 0 },
    { gate: "authorized image available for approval", passed: input.candidate.authorizedImageAvailable },
    { gate: "human approval checklist exists", passed: input.candidate.humanApprovalChecklistExists },
    { gate: "account risk is clear", passed: !input.accountRiskKnown },
    { gate: "payload preview complete enough", passed: input.candidate.payloadPreviewComplete },
    { gate: "runtime policy and location dependencies explicit", passed: true },
    { gate: "real marketplace execution disabled in B2", passed: true },
  ]
}

export function buildEbayDraftBuilderRiskAssessment(input: ReturnType<typeof buildEbayGatedDraftBuilderInput>) {
  const blockers = [
    input.accountRiskKnown ? "Known account risk blocks draft execution" : "",
    input.candidate.riskLevel !== "LOW" ? "Candidate is not LOW risk" : "",
    !input.candidate.authorizedImageAvailable ? "Authorized product image is missing" : "",
    input.candidate.missingItemSpecifics.length > 0 ? "Critical item specifics are missing" : "",
    !input.candidate.payloadPreviewComplete ? "Source payload preview is incomplete" : "",
  ].filter(Boolean)
  const warnings = [
    !input.candidate.finalCategoryIdKnown ? "Final eBay category ID requires runtime resolution" : "",
    !input.candidate.packageWeightAndSizeKnown ? "Package weight and dimensions require confirmation" : "",
    input.candidate.imageApprovalRequired ? "Authorized main image still requires Ernesto approval" : "",
  ].filter(Boolean)
  return { blockers, warnings, riskLevel: blockers.length ? "BLOCKED" : warnings.length ? "GATED" : "LOW" }
}

export function buildEbayDraftReadinessGate(input: ReturnType<typeof buildEbayGatedDraftBuilderInput>) {
  const checklist = buildEbayDraftExecutionGateChecklist(input)
  const risk = buildEbayDraftBuilderRiskAssessment(input)
  const sourceListingPackageReady = input.route.cAutoIntegrated && input.candidate.canProceedToDraftBuilder
  const passed = checklist.filter((item) => item.passed).length
  const draftReadinessScore = clampScore((passed / checklist.length) * 100)
  const canProceedToControlledDraftExecution =
    sourceListingPackageReady && risk.blockers.length === 0 && passed === checklist.length
  return { draftReadinessScore, sourceListingPackageReady, canProceedToControlledDraftExecution, checklist, ...risk }
}

export function buildEbayDraftBuilderRouteRecommendation(input: ReturnType<typeof buildEbayGatedDraftBuilderInput>) {
  if (input.accountRiskKnown) return "EBAY-RESUME-HOLD"
  const gate = buildEbayDraftReadinessGate(input)
  if (!gate.sourceListingPackageReady) return "NEED_DRAFT_EXECUTION_DATA"
  if (gate.blockers.length > 0) return "NEED_DRAFT_EXECUTION_DATA"
  if (!input.policy.payoutUnlockModelDetected || !input.policy.businessPoliciesUnlockModelDetected) return "EBAY-RESUME-A4"
  return gate.canProceedToControlledDraftExecution ? "EBAY-RESUME-B2-RUN" : "NEED_DRAFT_EXECUTION_DATA"
}

export function buildEbayGatedDraftUnpublishedOfferBuilderReport(fixture: Fixture) {
  const input = buildEbayGatedDraftBuilderInput(fixture)
  const readiness = buildEbayDraftReadinessGate(input)
  const policyDependencyMap = buildEbayPolicyDependencyMap(input)
  const locationDependencyMap = buildEbayLocationDependencyMap(input)
  const imageDependencyMap = buildEbayImageDependencyMap(input)
  const categoryAndSpecificsDependencyMap = buildEbayCategoryAndSpecificsDependencyMap(input)
  const missingForRealDraftExecution = [
    ...policyDependencyMap.missingRuntimeDependencies,
    ...locationDependencyMap.missingRuntimeDependencies,
    ...categoryAndSpecificsDependencyMap.missingRuntimeDependencies,
    !input.candidate.packageWeightAndSizeKnown ? "packageWeightAndSize" : "",
    input.candidate.imageApprovalRequired ? "humanApprovedMainImage" : "",
    "explicitHumanApprovalForControlledExecution",
  ].filter(Boolean)
  return {
    draftBuilderReportBuilt: true,
    draftReadinessScore: readiness.draftReadinessScore,
    sourceListingPackageReady: readiness.sourceListingPackageReady,
    recommendedCandidate: input.candidate,
    inventoryItemPayloadPreview: buildEbayInventoryItemPayloadPreview(input),
    offerPayloadPreview: buildEbayOfferPayloadPreview(input),
    policyDependencyMap,
    locationDependencyMap,
    imageDependencyMap,
    categoryAndSpecificsDependencyMap,
    executionGateChecklist: readiness.checklist,
    blockers: readiness.blockers,
    warnings: readiness.warnings,
    missingForRealDraftExecution,
    canProceedToControlledDraftExecution: readiness.canProceedToControlledDraftExecution,
    canCreateDraftNow: false,
    canCreateOfferNow: false,
    canPublish: false,
    requiresHumanApproval: true,
    nextRecommendedRoute: buildEbayDraftBuilderRouteRecommendation(input),
  }
}

export function summarizeEbayGatedDraftUnpublishedOfferBuilder(report: ReturnType<typeof buildEbayGatedDraftUnpublishedOfferBuilderReport>) {
  return {
    draftBuilderReportBuilt: report.draftBuilderReportBuilt,
    draftReadinessScore: report.draftReadinessScore,
    sourceListingPackageReady: report.sourceListingPackageReady,
    recommendedCandidateName: report.recommendedCandidate.productName,
    recommendedCandidateRiskLevel: report.recommendedCandidate.riskLevel,
    inventoryItemPayloadPreviewBuilt: Boolean(report.inventoryItemPayloadPreview),
    offerPayloadPreviewBuilt: Boolean(report.offerPayloadPreview),
    policyDependencyMapBuilt: Boolean(report.policyDependencyMap),
    locationDependencyMapBuilt: Boolean(report.locationDependencyMap),
    imageDependencyMapBuilt: Boolean(report.imageDependencyMap),
    categoryAndSpecificsDependencyMapBuilt: Boolean(report.categoryAndSpecificsDependencyMap),
    executionGateChecklistBuilt: report.executionGateChecklist.length > 0,
    missingForRealDraftExecutionCount: report.missingForRealDraftExecution.length,
    missingForRealDraftExecution: report.missingForRealDraftExecution,
    canProceedToControlledDraftExecution: report.canProceedToControlledDraftExecution,
    canCreateDraftNow: false,
    canCreateOfferNow: false,
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
    offerCreated: false,
    publicationExecuted: false,
    imageGenerationUsed: false,
    amazonTrackTouched: false,
    whatsappRealSendUsed: false,
    openAiUsed: false,
    scraperUsed: false,
    fullWarehouseStreetAddressCommitted: false,
  }
}

export function getEbayGatedDraftUnpublishedOfferBuilderChecklist() {
  return [
    "Confirm C-AUTO candidate identity, LOW risk, price, margin, and quantity",
    "Resolve final category, policy IDs, and merchant location key only inside a future gated runtime",
    "Confirm authorized main image, package weight, dimensions, and item specifics",
    "Inspect sanitized inventory-item and offer previews before any marketplace action",
    "Require Ernesto approval and keep creation and publication disabled in B2",
    "Keep sensitive warehouse, credential, and account data outside versioned files",
  ]
}
