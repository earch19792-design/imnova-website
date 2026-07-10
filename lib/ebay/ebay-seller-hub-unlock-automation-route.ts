export const EBAY_SELLER_HUB_UNLOCK_AUTOMATION_ROUTE_VERSION =
  "EBAY_SELLER_HUB_UNLOCK_AUTOMATION_ROUTE_RESUME_A5_V1"

const sourceDataClass =
  "EBAY_RESUME_A5_SELLER_HUB_UNLOCK_AUTOMATION_ROUTE"

type RouteRecommendation =
  | "EBAY-RESUME-C-AUTO"
  | "EBAY-RESUME-B2"
  | "EBAY-RESUME-A3-RUN"
  | "EBAY-RESUME-HOLD"
  | "NEED_AUTOMATED_LISTING_CANDIDATE"

type UnlockRouteInput = {
  storeName?: string | null
  warehouse?: {
    warehouseAlias?: string | null
    city?: string | null
    state?: string | null
    postalCode?: string | null
    country?: string | null
    streetAddressStoredInGit?: boolean | null
    shipFromConfiguredManually?: boolean | null
    returnAddressConfiguredManually?: boolean | null
  } | null
  sellerHubFindings?: {
    sellerHubAccessible?: boolean | null
    accountCriticalAlertsVisible?: boolean | null
    messagesCritical?: boolean | null
    paymentMethodCardVisibleInAccount?: boolean | null
    payoutMethodMayUnlockAfterListingOrFirstSale?: boolean | null
    businessPoliciesMayUnlockDuringListingFlow?: boolean | null
    payoutNotTreatedAsPermanentBlocker?: boolean | null
    listingStillRequiresHumanApproval?: boolean | null
  } | null
  automationSignals?: {
    benchmarkPipelineAvailable?: boolean | null
    candidateScoringAvailable?: boolean | null
    listingPackageBuilderPlanned?: boolean | null
    ebayPayloadPreparationPlanned?: boolean | null
    gatedDraftOrUnpublishedOfferPlanned?: boolean | null
    productCandidateExists?: boolean | null
    accountRiskVisible?: boolean | null
  } | null
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean"
    ? value
    : fallback
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function buildEbaySellerHubUnlockRouteInput(input: UnlockRouteInput = {}) {
  const warehouse =
    input.warehouse ?? {}
  const sellerHubFindings =
    input.sellerHubFindings ?? {}
  const automationSignals =
    input.automationSignals ?? {}

  return {
    routeVersion:
      EBAY_SELLER_HUB_UNLOCK_AUTOMATION_ROUTE_VERSION,
    sourceDataClass,
    storeName:
      normalizeText(input.storeName) ?? "",
    warehouse:
      {
        warehouseAlias:
          normalizeText(warehouse.warehouseAlias) ?? "",
        city:
          normalizeText(warehouse.city) ?? "",
        state:
          normalizeText(warehouse.state) ?? "",
        postalCode:
          normalizeText(warehouse.postalCode) ?? "",
        country:
          normalizeText(warehouse.country) ?? "",
        streetAddressStoredInGit:
          normalizeBoolean(warehouse.streetAddressStoredInGit),
        shipFromConfiguredManually:
          normalizeBoolean(warehouse.shipFromConfiguredManually),
        returnAddressConfiguredManually:
          normalizeBoolean(warehouse.returnAddressConfiguredManually),
      },
    sellerHubFindings:
      {
        sellerHubAccessible:
          normalizeBoolean(sellerHubFindings.sellerHubAccessible),
        accountCriticalAlertsVisible:
          normalizeBoolean(sellerHubFindings.accountCriticalAlertsVisible),
        messagesCritical:
          normalizeBoolean(sellerHubFindings.messagesCritical),
        paymentMethodCardVisibleInAccount:
          normalizeBoolean(sellerHubFindings.paymentMethodCardVisibleInAccount),
        payoutMethodMayUnlockAfterListingOrFirstSale:
          normalizeBoolean(sellerHubFindings.payoutMethodMayUnlockAfterListingOrFirstSale),
        businessPoliciesMayUnlockDuringListingFlow:
          normalizeBoolean(sellerHubFindings.businessPoliciesMayUnlockDuringListingFlow),
        payoutNotTreatedAsPermanentBlocker:
          normalizeBoolean(sellerHubFindings.payoutNotTreatedAsPermanentBlocker),
        listingStillRequiresHumanApproval:
          normalizeBoolean(sellerHubFindings.listingStillRequiresHumanApproval),
      },
    automationSignals:
      {
        benchmarkPipelineAvailable:
          normalizeBoolean(automationSignals.benchmarkPipelineAvailable),
        candidateScoringAvailable:
          normalizeBoolean(automationSignals.candidateScoringAvailable),
        listingPackageBuilderPlanned:
          normalizeBoolean(automationSignals.listingPackageBuilderPlanned),
        ebayPayloadPreparationPlanned:
          normalizeBoolean(automationSignals.ebayPayloadPreparationPlanned),
        gatedDraftOrUnpublishedOfferPlanned:
          normalizeBoolean(automationSignals.gatedDraftOrUnpublishedOfferPlanned),
        productCandidateExists:
          normalizeBoolean(automationSignals.productCandidateExists),
        accountRiskVisible:
          normalizeBoolean(automationSignals.accountRiskVisible),
      },
  }
}

export function buildEbaySellerHubUnlockModel(input: ReturnType<typeof buildEbaySellerHubUnlockRouteInput>) {
  return {
    sellerHubAccessible:
      input.sellerHubFindings.sellerHubAccessible,
    storeNameConfigured:
      input.storeName.length > 0,
    payoutUnlockModelDetected:
      input.sellerHubFindings.payoutMethodMayUnlockAfterListingOrFirstSale &&
      input.sellerHubFindings.payoutNotTreatedAsPermanentBlocker,
    businessPoliciesUnlockModelDetected:
      input.sellerHubFindings.businessPoliciesMayUnlockDuringListingFlow,
    accountRiskVisible:
      input.sellerHubFindings.accountCriticalAlertsVisible ||
      input.sellerHubFindings.messagesCritical ||
      input.automationSignals.accountRiskVisible,
    warnings:
      [
        input.sellerHubFindings.payoutMethodMayUnlockAfterListingOrFirstSale ? "Payout setup may unlock through first listing or first sale onboarding" : "",
        input.sellerHubFindings.businessPoliciesMayUnlockDuringListingFlow ? "Business policy setup may unlock in the first listing flow" : "",
        input.sellerHubFindings.listingStillRequiresHumanApproval ? "Listing remains gated by human approval" : "",
      ].filter(Boolean),
  }
}

export function buildEbayWarehouseAliasModel(input: ReturnType<typeof buildEbaySellerHubUnlockRouteInput>) {
  const warehouse =
    input.warehouse
  const warehouseAliasConfigured =
    warehouse.warehouseAlias === "LUNA_PORTEX_BOCA_RATON" &&
    warehouse.city === "Boca Raton" &&
    warehouse.state === "FL" &&
    warehouse.postalCode === "33487" &&
    warehouse.country === "US"

  return {
    warehouseAliasConfigured,
    fullWarehouseStreetAddressCommitted:
      warehouse.streetAddressStoredInGit,
    shipFromConfiguredManually:
      warehouse.shipFromConfiguredManually,
    returnAddressConfiguredManually:
      warehouse.returnAddressConfiguredManually,
    safeWarehouseReference:
      {
        warehouseAlias:
          warehouse.warehouseAlias,
        city:
          warehouse.city,
        state:
          warehouse.state,
        postalCode:
          warehouse.postalCode,
        country:
          warehouse.country,
      },
    blockers:
      [
        warehouse.streetAddressStoredInGit ? "Full warehouse street address must not be committed" : "",
        !warehouseAliasConfigured ? "Warehouse alias/city/state/postal/country must be configured safely" : "",
      ].filter(Boolean),
  }
}

export function buildEbayManualVsAutomatedBoundary() {
  return {
    manualStepsRemaining:
      [
        "human approval before listing package moves forward",
        "identity verification",
        "payout and bank setup",
        "payment method confirmation",
        "tax/business conversion confirmation",
        "final listing review",
      ],
    automationStepsReady:
      [
        "benchmark research",
        "competitor sold-listing analysis",
        "winner score",
        "title generation",
        "item specifics mapping",
        "pricing guard",
        "margin guard",
        "policy recommendation",
        "image checklist",
        "eBay API payload preparation",
        "draft/unpublished offer builder behind gate",
      ],
  }
}

export function buildEbayBenchmarkToListingAutomationPlan(input: ReturnType<typeof buildEbaySellerHubUnlockRouteInput>) {
  const automationSteps =
    buildEbayManualVsAutomatedBoundary().automationStepsReady
  const benchmarkAutomationRouteReady =
    input.automationSignals.benchmarkPipelineAvailable &&
    input.automationSignals.candidateScoringAvailable &&
    input.automationSignals.listingPackageBuilderPlanned &&
    input.automationSignals.ebayPayloadPreparationPlanned
  const canProceedToAutomatedListingPackage =
    benchmarkAutomationRouteReady &&
    input.automationSignals.productCandidateExists &&
    !input.automationSignals.accountRiskVisible

  return {
    benchmarkAutomationRouteReady,
    canProceedToAutomatedListingPackage,
    automationStepsReady:
      automationSteps,
    automationStepsReadyCount:
      automationSteps.length,
    candidateRequired:
      !input.automationSignals.productCandidateExists,
  }
}

export function buildEbayAutomationRouteReconciliation(input: ReturnType<typeof buildEbaySellerHubUnlockRouteInput>) {
  const manualBoundary =
    buildEbayManualVsAutomatedBoundary()
  const automationPlan =
    buildEbayBenchmarkToListingAutomationPlan(input)

  return {
    manualStepsRemaining:
      manualBoundary.manualStepsRemaining,
    automationStepsReady:
      automationPlan.automationStepsReady,
    manualStepsRemainingCount:
      manualBoundary.manualStepsRemaining.length,
    automationStepsReadyCount:
      automationPlan.automationStepsReadyCount,
    routeCorrection:
      "Manual means approvals and sensitive account setup; automation remains the target for research, package building, payload preparation, and gated draft work.",
  }
}

export function buildEbayFirstListingGateModel(input: ReturnType<typeof buildEbaySellerHubUnlockRouteInput>) {
  return {
    canProceedToEbayDraftWrite:
      false,
    canPublish:
      false,
    requiresHumanApproval:
      true,
    firstListingGate:
      [
        "automated listing package must be reviewed",
        "payload must remain dry-run until the gated write loop",
        "human must approve before any draft/unpublished offer",
        "publication remains blocked",
      ],
    listingStillRequiresHumanApproval:
      input.sellerHubFindings.listingStillRequiresHumanApproval,
  }
}

export function buildEbaySellerHubUnlockRiskAssessment(input: ReturnType<typeof buildEbaySellerHubUnlockRouteInput>) {
  const accountRisk =
    input.sellerHubFindings.accountCriticalAlertsVisible ||
    input.sellerHubFindings.messagesCritical ||
    input.automationSignals.accountRiskVisible
  const blockers =
    [
      accountRisk ? "Resolve account alerts, verification, or critical eBay messages before listing work" : "",
      input.warehouse.streetAddressStoredInGit ? "Full warehouse street address cannot be committed" : "",
    ].filter(Boolean)

  return {
    accountRisk,
    blockers,
    warnings:
      [
        "Continue to avoid sensitive categories for the first listings",
        "Keep publication blocked until the final human approval gate",
      ],
  }
}

export function buildEbaySellerHubUnlockRouteRecommendation(values: {
  accountRisk: boolean
  productCandidateExists: boolean
  canProceedToAutomatedListingPackage: boolean
  fullWarehouseStreetAddressCommitted: boolean
}): RouteRecommendation {
  if (values.accountRisk || values.fullWarehouseStreetAddressCommitted) {
    return "EBAY-RESUME-HOLD"
  }

  if (!values.productCandidateExists) {
    return "NEED_AUTOMATED_LISTING_CANDIDATE"
  }

  if (values.canProceedToAutomatedListingPackage) {
    return "EBAY-RESUME-C-AUTO"
  }

  return "EBAY-RESUME-A3-RUN"
}

function buildRouteScore(values: {
  sellerHubAccessible: boolean
  storeNameConfigured: boolean
  warehouseAliasConfigured: boolean
  payoutUnlockModelDetected: boolean
  businessPoliciesUnlockModelDetected: boolean
  benchmarkAutomationRouteReady: boolean
  canProceedToAutomatedListingPackage: boolean
  blockersCount: number
}) {
  const score =
    (values.sellerHubAccessible ? 15 : 0) +
    (values.storeNameConfigured ? 10 : 0) +
    (values.warehouseAliasConfigured ? 15 : 0) +
    (values.payoutUnlockModelDetected ? 10 : 0) +
    (values.businessPoliciesUnlockModelDetected ? 10 : 0) +
    (values.benchmarkAutomationRouteReady ? 20 : 0) +
    (values.canProceedToAutomatedListingPackage ? 20 : 0) -
    values.blockersCount * 25

  return clampScore(score)
}

export function buildEbaySellerHubUnlockAutomationRouteReport(rawInput: UnlockRouteInput = {}) {
  const input =
    buildEbaySellerHubUnlockRouteInput(rawInput)
  const unlockModel =
    buildEbaySellerHubUnlockModel(input)
  const warehouseModel =
    buildEbayWarehouseAliasModel(input)
  const automationPlan =
    buildEbayBenchmarkToListingAutomationPlan(input)
  const routeReconciliation =
    buildEbayAutomationRouteReconciliation(input)
  const firstListingGate =
    buildEbayFirstListingGateModel(input)
  const risk =
    buildEbaySellerHubUnlockRiskAssessment(input)
  const blockers =
    [
      ...warehouseModel.blockers,
      ...risk.blockers,
    ]
  const nextRecommendedRoute =
    buildEbaySellerHubUnlockRouteRecommendation({
      accountRisk:
        risk.accountRisk,
      productCandidateExists:
        input.automationSignals.productCandidateExists,
      canProceedToAutomatedListingPackage:
        automationPlan.canProceedToAutomatedListingPackage,
      fullWarehouseStreetAddressCommitted:
        warehouseModel.fullWarehouseStreetAddressCommitted,
    })
  const routeScore =
    buildRouteScore({
      sellerHubAccessible:
        unlockModel.sellerHubAccessible,
      storeNameConfigured:
        unlockModel.storeNameConfigured,
      warehouseAliasConfigured:
        warehouseModel.warehouseAliasConfigured,
      payoutUnlockModelDetected:
        unlockModel.payoutUnlockModelDetected,
      businessPoliciesUnlockModelDetected:
        unlockModel.businessPoliciesUnlockModelDetected,
      benchmarkAutomationRouteReady:
        automationPlan.benchmarkAutomationRouteReady,
      canProceedToAutomatedListingPackage:
        automationPlan.canProceedToAutomatedListingPackage,
      blockersCount:
        blockers.length,
    })

  return {
    routeVersion:
      EBAY_SELLER_HUB_UNLOCK_AUTOMATION_ROUTE_VERSION,
    sourceDataClass,
    routeReconciliationBuilt:
      true,
    routeScore,
    sellerHubAccessible:
      unlockModel.sellerHubAccessible,
    storeNameConfigured:
      unlockModel.storeNameConfigured,
    warehouseAliasConfigured:
      warehouseModel.warehouseAliasConfigured,
    fullWarehouseStreetAddressCommitted:
      warehouseModel.fullWarehouseStreetAddressCommitted,
    shipFromConfiguredManually:
      warehouseModel.shipFromConfiguredManually,
    returnAddressConfiguredManually:
      warehouseModel.returnAddressConfiguredManually,
    payoutUnlockModelDetected:
      unlockModel.payoutUnlockModelDetected,
    businessPoliciesUnlockModelDetected:
      unlockModel.businessPoliciesUnlockModelDetected,
    manualStepsRemaining:
      routeReconciliation.manualStepsRemaining,
    automationStepsReady:
      routeReconciliation.automationStepsReady,
    manualStepsRemainingCount:
      routeReconciliation.manualStepsRemainingCount,
    automationStepsReadyCount:
      routeReconciliation.automationStepsReadyCount,
    benchmarkAutomationRouteReady:
      automationPlan.benchmarkAutomationRouteReady,
    canProceedToAutomatedListingPackage:
      automationPlan.canProceedToAutomatedListingPackage,
    canProceedToEbayDraftWrite:
      firstListingGate.canProceedToEbayDraftWrite,
    canPublish:
      firstListingGate.canPublish,
    requiresHumanApproval:
      firstListingGate.requiresHumanApproval,
    nextRecommendedRoute,
    safeWarehouseReference:
      warehouseModel.safeWarehouseReference,
    routeCorrection:
      routeReconciliation.routeCorrection,
    blockers,
    warnings:
      [
        ...unlockModel.warnings,
        ...risk.warnings,
      ],
    productionWriteTouched:
      false,
    mainTouched:
      false,
    stagingWriteExecuted:
      false,
    ebayApiUsedInThisLoop:
      false,
    ebayWriteApiUsed:
      false,
    oauthUsedInThisLoop:
      false,
    tokenStored:
      false,
    tokensPrinted:
      false,
    draftCreated:
      false,
    listingCreated:
      false,
    publicationExecuted:
      false,
    amazonTrackTouched:
      false,
    whatsappRealSendUsed:
      false,
    openAiUsed:
      false,
    scraperUsed:
      false,
  }
}

export function summarizeEbaySellerHubUnlockAutomationRoute(report: ReturnType<typeof buildEbaySellerHubUnlockAutomationRouteReport>) {
  return {
    routeReconciliationBuilt:
      report.routeReconciliationBuilt,
    routeScore:
      report.routeScore,
    sellerHubAccessible:
      report.sellerHubAccessible,
    storeNameConfigured:
      report.storeNameConfigured,
    warehouseAliasConfigured:
      report.warehouseAliasConfigured,
    fullWarehouseStreetAddressCommitted:
      report.fullWarehouseStreetAddressCommitted,
    shipFromConfiguredManually:
      report.shipFromConfiguredManually,
    returnAddressConfiguredManually:
      report.returnAddressConfiguredManually,
    payoutUnlockModelDetected:
      report.payoutUnlockModelDetected,
    businessPoliciesUnlockModelDetected:
      report.businessPoliciesUnlockModelDetected,
    manualStepsRemainingCount:
      report.manualStepsRemainingCount,
    automationStepsReadyCount:
      report.automationStepsReadyCount,
    benchmarkAutomationRouteReady:
      report.benchmarkAutomationRouteReady,
    canProceedToAutomatedListingPackage:
      report.canProceedToAutomatedListingPackage,
    canProceedToEbayDraftWrite:
      report.canProceedToEbayDraftWrite,
    canPublish:
      report.canPublish,
    requiresHumanApproval:
      report.requiresHumanApproval,
    nextRecommendedRoute:
      report.nextRecommendedRoute,
    productionWriteTouched:
      report.productionWriteTouched,
    mainTouched:
      report.mainTouched,
    stagingWriteExecuted:
      report.stagingWriteExecuted,
    ebayApiUsedInThisLoop:
      report.ebayApiUsedInThisLoop,
    ebayWriteApiUsed:
      report.ebayWriteApiUsed,
    oauthUsedInThisLoop:
      report.oauthUsedInThisLoop,
    tokenStored:
      report.tokenStored,
    tokensPrinted:
      report.tokensPrinted,
    draftCreated:
      report.draftCreated,
    listingCreated:
      report.listingCreated,
    publicationExecuted:
      report.publicationExecuted,
    amazonTrackTouched:
      report.amazonTrackTouched,
    whatsappRealSendUsed:
      report.whatsappRealSendUsed,
    openAiUsed:
      report.openAiUsed,
    scraperUsed:
      report.scraperUsed,
  }
}

export function getEbaySellerHubUnlockAutomationChecklist() {
  return [
    "Confirm Seller Hub remains accessible",
    "Use ShopEliteCart as operational store name",
    "Use only Luna Portex alias plus city/state/postal/country",
    "Do not commit full warehouse street address",
    "Treat payouts and policies as possible onboarding unlocks, not permanent blockers",
    "Keep manual gates for identity, payouts, bank, tax, and final approval",
    "Automate benchmark, scoring, listing package, item specifics, pricing, and payload preparation",
    "Keep eBay draft/unpublished offer writes behind a future gate",
    "Keep publication blocked",
  ]
}

export function buildEbaySellerHubUnlockAutomationRouteFromFixture(fixture: UnlockRouteInput) {
  return buildEbaySellerHubUnlockAutomationRouteReport(fixture)
}
