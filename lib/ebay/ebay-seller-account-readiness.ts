export const EBAY_SELLER_ACCOUNT_READINESS_VERSION =
  "EBAY_SELLER_ACCOUNT_READINESS_RESUME_A_V1"

const sourceDataClass =
  "EBAY_RESUME_A_SELLER_ACCOUNT_READINESS"

type ChecklistStatus =
  | "confirmed"
  | "ready"
  | "configured"
  | "active"
  | "unknown"
  | "missing"
  | "blocked"
  | "suspended"
  | "verification_required"

type AccountStatus =
  | "READY_FOR_RESEARCH_ONLY"
  | "READY_FOR_SANDBOX_DRAFT"
  | "READY_FOR_MANUAL_LISTING_PREP"
  | "BLOCKED_ACCOUNT_SETUP"
  | "BLOCKED_PAYMENTS"
  | "BLOCKED_POLICIES"
  | "BLOCKED_LOGISTICS"
  | "BLOCKED_ACCOUNT_RISK"
  | "NEEDS_HUMAN_CONFIRMATION"

type AccountRiskLevel =
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "UNKNOWN"

type ResumeRoute =
  | "EBAY-RESUME-B"
  | "EBAY-RESUME-C"
  | "EBAY-RESUME-HOLD"
  | "NEED_MORE_SELLER_HUB_DATA"

type SellerAccountReadinessEntry = {
  sellerAccountActive?: string | boolean | null
  sellerHubAccessible?: string | boolean | null
  paymentsSetupStatus?: string | boolean | null
  payoutsSetupStatus?: string | boolean | null
  paymentMethodStatus?: string | boolean | null
  bankAccountStatus?: string | boolean | null
  itemLocationStatus?: string | boolean | null
  targetMarketplace?: string | null
  shippingPoliciesStatus?: string | boolean | null
  returnPoliciesStatus?: string | boolean | null
  handlingTimeStatus?: string | boolean | null
  sellerLimitsStatus?: string | boolean | null
  categoryPermissionStatus?: string | boolean | null
  warehouseLogisticsStatus?: string | boolean | null
  firstProductCandidateStatus?: string | boolean | null
  mainImageStatus?: string | boolean | null
  accountRiskStatus?: string | null
  preferredResumeStrategy?: string | null
}

type SellerAccountReadinessFixture = {
  sellerAccountChecklist?: SellerAccountReadinessEntry | null
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeStatus(value: unknown): ChecklistStatus {
  if (value === true) {
    return "confirmed"
  }

  if (value === false) {
    return "missing"
  }

  const status =
    normalizeText(value)?.toLowerCase().replace(/\s+/g, "_")

  if (
    status === "confirmed" ||
    status === "ready" ||
    status === "configured" ||
    status === "active" ||
    status === "unknown" ||
    status === "missing" ||
    status === "blocked" ||
    status === "suspended" ||
    status === "verification_required"
  ) {
    return status
  }

  return "unknown"
}

function isReady(status: ChecklistStatus) {
  return status === "confirmed" ||
    status === "ready" ||
    status === "configured" ||
    status === "active"
}

function isUnknown(status: ChecklistStatus) {
  return status === "unknown"
}

function isBlocked(status: ChecklistStatus) {
  return status === "missing" ||
    status === "blocked" ||
    status === "suspended" ||
    status === "verification_required"
}

function boolReady(status: ChecklistStatus) {
  return isReady(status)
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function buildEbaySellerAccountReadinessInput(entry: SellerAccountReadinessEntry) {
  return {
    readinessVersion:
      EBAY_SELLER_ACCOUNT_READINESS_VERSION,
    sourceDataClass,
    sellerAccountActive:
      normalizeStatus(entry.sellerAccountActive),
    sellerHubAccessible:
      normalizeStatus(entry.sellerHubAccessible),
    paymentsSetupStatus:
      normalizeStatus(entry.paymentsSetupStatus),
    payoutsSetupStatus:
      normalizeStatus(entry.payoutsSetupStatus),
    paymentMethodStatus:
      normalizeStatus(entry.paymentMethodStatus),
    bankAccountStatus:
      normalizeStatus(entry.bankAccountStatus),
    itemLocationStatus:
      normalizeStatus(entry.itemLocationStatus),
    targetMarketplace:
      normalizeText(entry.targetMarketplace) ?? "EBAY_US",
    shippingPoliciesStatus:
      normalizeStatus(entry.shippingPoliciesStatus),
    returnPoliciesStatus:
      normalizeStatus(entry.returnPoliciesStatus),
    handlingTimeStatus:
      normalizeStatus(entry.handlingTimeStatus),
    sellerLimitsStatus:
      normalizeStatus(entry.sellerLimitsStatus),
    categoryPermissionStatus:
      normalizeStatus(entry.categoryPermissionStatus),
    warehouseLogisticsStatus:
      normalizeStatus(entry.warehouseLogisticsStatus),
    firstProductCandidateStatus:
      normalizeStatus(entry.firstProductCandidateStatus),
    mainImageStatus:
      normalizeStatus(entry.mainImageStatus),
    accountRiskStatus:
      normalizeStatus(entry.accountRiskStatus),
    preferredResumeStrategy:
      normalizeText(entry.preferredResumeStrategy)?.toUpperCase() ?? "UNKNOWN",
  }
}

export function buildEbaySellerAccountCoreReadiness(input: ReturnType<typeof buildEbaySellerAccountReadinessInput>) {
  const sellerAccountReady =
    boolReady(input.sellerAccountActive)
  const marketplaceReady =
    input.targetMarketplace === "EBAY_US"
  const blocked =
    isBlocked(input.sellerAccountActive) || !marketplaceReady
  const unknown =
    isUnknown(input.sellerAccountActive)

  return {
    sellerAccountReady,
    marketplaceReady,
    coreReady:
      sellerAccountReady && marketplaceReady,
    blockers:
      [
        blocked ? "Seller account active status or target marketplace is not ready" : "",
      ].filter(Boolean),
    warnings:
      [
        unknown ? "Seller account active status must be confirmed manually" : "",
        !marketplaceReady ? "Target marketplace must be confirmed as USA / EBAY_US" : "",
      ].filter(Boolean),
  }
}

export function buildEbaySellerHubReadiness(input: ReturnType<typeof buildEbaySellerAccountReadinessInput>) {
  return {
    sellerHubAccessible:
      boolReady(input.sellerHubAccessible),
    blockers:
      [
        isBlocked(input.sellerHubAccessible) ? "Seller Hub is not accessible" : "",
      ].filter(Boolean),
    warnings:
      [
        isUnknown(input.sellerHubAccessible) ? "Seller Hub access is unknown" : "",
      ].filter(Boolean),
  }
}

export function buildEbayPaymentsReadiness(input: ReturnType<typeof buildEbaySellerAccountReadinessInput>) {
  const paymentsReady =
    boolReady(input.paymentsSetupStatus) &&
    boolReady(input.payoutsSetupStatus) &&
    boolReady(input.paymentMethodStatus)
  const payoutsReady =
    boolReady(input.payoutsSetupStatus) &&
    (boolReady(input.bankAccountStatus) || input.bankAccountStatus === "unknown")

  return {
    paymentsReady,
    payoutsReady,
    blockers:
      [
        isBlocked(input.paymentsSetupStatus) ? "Payments setup is blocked or missing" : "",
        isBlocked(input.payoutsSetupStatus) ? "Payouts setup is blocked or missing" : "",
        isBlocked(input.paymentMethodStatus) ? "Payment method is blocked or missing" : "",
        isBlocked(input.bankAccountStatus) ? "Bank or payout account is blocked or missing" : "",
      ].filter(Boolean),
    warnings:
      [
        isUnknown(input.paymentsSetupStatus) ? "Payments setup must be confirmed" : "",
        isUnknown(input.payoutsSetupStatus) ? "Payouts setup must be confirmed" : "",
        isUnknown(input.paymentMethodStatus) ? "Payment method must be confirmed" : "",
        isUnknown(input.bankAccountStatus) ? "Bank or payout account status must be confirmed if required" : "",
      ].filter(Boolean),
  }
}

export function buildEbayPolicyReadiness(input: ReturnType<typeof buildEbaySellerAccountReadinessInput>) {
  const policiesReady =
    boolReady(input.shippingPoliciesStatus) &&
    boolReady(input.returnPoliciesStatus) &&
    boolReady(input.handlingTimeStatus) &&
    boolReady(input.sellerLimitsStatus) &&
    boolReady(input.categoryPermissionStatus)

  return {
    policiesReady,
    blockers:
      [
        isBlocked(input.shippingPoliciesStatus) ? "Shipping policy is missing or blocked" : "",
        isBlocked(input.returnPoliciesStatus) ? "Return policy is missing or blocked" : "",
        isBlocked(input.handlingTimeStatus) ? "Handling time is missing or blocked" : "",
        isBlocked(input.sellerLimitsStatus) ? "Seller limits are blocked or missing" : "",
        isBlocked(input.categoryPermissionStatus) ? "Category permissions are blocked or missing" : "",
      ].filter(Boolean),
    warnings:
      [
        isUnknown(input.shippingPoliciesStatus) ? "Shipping policy status must be confirmed" : "",
        isUnknown(input.returnPoliciesStatus) ? "Return policy status must be confirmed" : "",
        isUnknown(input.handlingTimeStatus) ? "Handling time must be confirmed" : "",
        isUnknown(input.sellerLimitsStatus) ? "Seller limits must be checked" : "",
        isUnknown(input.categoryPermissionStatus) ? "Allowed categories must be checked" : "",
      ].filter(Boolean),
  }
}

export function buildEbayLogisticsReadiness(input: ReturnType<typeof buildEbaySellerAccountReadinessInput>) {
  const logisticsReady =
    boolReady(input.itemLocationStatus) &&
    boolReady(input.warehouseLogisticsStatus)

  return {
    logisticsReady,
    blockers:
      [
        isBlocked(input.itemLocationStatus) ? "Item location is missing or blocked" : "",
        isBlocked(input.warehouseLogisticsStatus) ? "Luna Portex warehouse/logistics status is missing or blocked" : "",
      ].filter(Boolean),
    warnings:
      [
        isUnknown(input.itemLocationStatus) ? "Item location must be confirmed" : "",
        isUnknown(input.warehouseLogisticsStatus) ? "Luna Portex item location / warehouse readiness must be confirmed" : "",
      ].filter(Boolean),
  }
}

export function buildEbayListingPrerequisiteReadiness(input: ReturnType<typeof buildEbaySellerAccountReadinessInput>) {
  const listingPrerequisitesReady =
    boolReady(input.firstProductCandidateStatus) &&
    boolReady(input.mainImageStatus)

  return {
    listingPrerequisitesReady,
    blockers:
      [
        isBlocked(input.firstProductCandidateStatus) ? "First low-risk product candidate is missing or blocked" : "",
        isBlocked(input.mainImageStatus) ? "Real main image is missing or blocked" : "",
      ].filter(Boolean),
    warnings:
      [
        isUnknown(input.firstProductCandidateStatus) ? "First low-risk product candidate must be selected" : "",
        isUnknown(input.mainImageStatus) ? "Real main image availability must be confirmed" : "",
      ].filter(Boolean),
  }
}

export function buildEbaySellerRiskAssessment(input: ReturnType<typeof buildEbaySellerAccountReadinessInput>) {
  const accountRiskLevel: AccountRiskLevel =
    input.accountRiskStatus === "suspended" || input.accountRiskStatus === "verification_required" || input.accountRiskStatus === "blocked"
      ? "HIGH"
      : input.accountRiskStatus === "unknown"
        ? "UNKNOWN"
        : "LOW"

  return {
    accountRiskLevel,
    blockers:
      [
        accountRiskLevel === "HIGH" ? "Account suspension, verification, or risk must be resolved before any listing" : "",
      ].filter(Boolean),
    warnings:
      [
        accountRiskLevel === "UNKNOWN" ? "Account risk status must be confirmed manually" : "",
      ].filter(Boolean),
  }
}

function buildReadinessScore(values: {
  coreReady: boolean
  sellerHubAccessible: boolean
  paymentsReady: boolean
  payoutsReady: boolean
  policiesReady: boolean
  logisticsReady: boolean
  listingPrerequisitesReady: boolean
  accountRiskLevel: AccountRiskLevel
}) {
  const base =
    [
      values.coreReady,
      values.sellerHubAccessible,
      values.paymentsReady,
      values.payoutsReady,
      values.policiesReady,
      values.logisticsReady,
      values.listingPrerequisitesReady,
    ].filter(Boolean).length * 13
  const riskAdjustment =
    values.accountRiskLevel === "LOW"
      ? 9
      : values.accountRiskLevel === "UNKNOWN"
        ? 0
        : -25

  return clampScore(base + riskAdjustment)
}

function buildAccountStatus(values: {
  coreReady: boolean
  sellerHubAccessible: boolean
  paymentsReady: boolean
  policiesReady: boolean
  logisticsReady: boolean
  listingPrerequisitesReady: boolean
  accountRiskLevel: AccountRiskLevel
  blockers: string[]
  unknownChecklistItems: string[]
}): AccountStatus {
  if (values.accountRiskLevel === "HIGH") {
    return "BLOCKED_ACCOUNT_RISK"
  }

  if (values.blockers.some(blocker => blocker.toLowerCase().includes("payment") || blocker.toLowerCase().includes("payout") || blocker.toLowerCase().includes("bank"))) {
    return "BLOCKED_PAYMENTS"
  }

  if (values.blockers.some(blocker => blocker.toLowerCase().includes("policy") || blocker.toLowerCase().includes("handling") || blocker.toLowerCase().includes("limits") || blocker.toLowerCase().includes("category"))) {
    return "BLOCKED_POLICIES"
  }

  if (values.blockers.some(blocker => blocker.toLowerCase().includes("location") || blocker.toLowerCase().includes("warehouse"))) {
    return "BLOCKED_LOGISTICS"
  }

  if (!values.coreReady || !values.sellerHubAccessible) {
    return values.unknownChecklistItems.length > 0
      ? "NEEDS_HUMAN_CONFIRMATION"
      : "BLOCKED_ACCOUNT_SETUP"
  }

  if (values.unknownChecklistItems.length > 0) {
    return "NEEDS_HUMAN_CONFIRMATION"
  }

  if (values.paymentsReady && values.policiesReady && values.logisticsReady && values.listingPrerequisitesReady) {
    return "READY_FOR_SANDBOX_DRAFT"
  }

  return "READY_FOR_RESEARCH_ONLY"
}

export function buildEbayResumeRouteRecommendation(values: {
  accountStatus: AccountStatus
  preferredResumeStrategy: string
  unknownChecklistItems: string[]
}): ResumeRoute {
  if (values.accountStatus === "BLOCKED_ACCOUNT_RISK") {
    return "EBAY-RESUME-HOLD"
  }

  if (values.unknownChecklistItems.length > 0 || values.accountStatus === "NEEDS_HUMAN_CONFIRMATION") {
    return "NEED_MORE_SELLER_HUB_DATA"
  }

  if (values.accountStatus === "READY_FOR_SANDBOX_DRAFT") {
    return values.preferredResumeStrategy === "MANUAL_LISTING_FIRST"
      ? "EBAY-RESUME-C"
      : "EBAY-RESUME-B"
  }

  if (values.accountStatus === "READY_FOR_MANUAL_LISTING_PREP") {
    return "EBAY-RESUME-C"
  }

  return "NEED_MORE_SELLER_HUB_DATA"
}

export function getEbaySellerAccountReadinessChecklist() {
  return [
    "Cuenta eBay vendedor activa y sin suspensión",
    "Seller Hub accesible",
    "Payments configurado",
    "Payouts configurado",
    "Método de pago configurado",
    "Banco/payout account configurado si aplica",
    "Dirección / item location",
    "Mercado objetivo USA",
    "Shipping policy",
    "Return policy",
    "Handling time",
    "Seller limits",
    "Categorías permitidas",
    "Luna Portex item location / warehouse",
    "Documento de almacén/logística si aplica",
    "Primer producto candidato de bajo riesgo",
    "Imagen principal real disponible",
    "Aprobación humana antes de avanzar",
  ]
}

function buildUnknownChecklistItems(input: ReturnType<typeof buildEbaySellerAccountReadinessInput>) {
  const entries =
    [
      ["sellerAccountActive", input.sellerAccountActive],
      ["sellerHubAccessible", input.sellerHubAccessible],
      ["paymentsSetupStatus", input.paymentsSetupStatus],
      ["payoutsSetupStatus", input.payoutsSetupStatus],
      ["paymentMethodStatus", input.paymentMethodStatus],
      ["bankAccountStatus", input.bankAccountStatus],
      ["itemLocationStatus", input.itemLocationStatus],
      ["shippingPoliciesStatus", input.shippingPoliciesStatus],
      ["returnPoliciesStatus", input.returnPoliciesStatus],
      ["handlingTimeStatus", input.handlingTimeStatus],
      ["sellerLimitsStatus", input.sellerLimitsStatus],
      ["categoryPermissionStatus", input.categoryPermissionStatus],
      ["warehouseLogisticsStatus", input.warehouseLogisticsStatus],
      ["firstProductCandidateStatus", input.firstProductCandidateStatus],
      ["mainImageStatus", input.mainImageStatus],
      ["accountRiskStatus", input.accountRiskStatus],
    ] as const

  return entries
    .filter(([, status]) => status === "unknown")
    .map(([key]) => key)
}

export function buildEbaySellerAccountReadinessReport(entry: SellerAccountReadinessEntry) {
  const input =
    buildEbaySellerAccountReadinessInput(entry)
  const core =
    buildEbaySellerAccountCoreReadiness(input)
  const sellerHub =
    buildEbaySellerHubReadiness(input)
  const payments =
    buildEbayPaymentsReadiness(input)
  const policies =
    buildEbayPolicyReadiness(input)
  const logistics =
    buildEbayLogisticsReadiness(input)
  const listingPrerequisites =
    buildEbayListingPrerequisiteReadiness(input)
  const risk =
    buildEbaySellerRiskAssessment(input)
  const blockers =
    unique([
      ...core.blockers,
      ...sellerHub.blockers,
      ...payments.blockers,
      ...policies.blockers,
      ...logistics.blockers,
      ...listingPrerequisites.blockers,
      ...risk.blockers,
    ])
  const warnings =
    unique([
      ...core.warnings,
      ...sellerHub.warnings,
      ...payments.warnings,
      ...policies.warnings,
      ...logistics.warnings,
      ...listingPrerequisites.warnings,
      ...risk.warnings,
      "Do not publish until human approval",
      "Do not mix Amazon 149G into eBay resume work",
      "Do not bring old local eBay LOOP 149 without rebuilding from current PRE/Staging",
    ])
  const unknownChecklistItems =
    buildUnknownChecklistItems(input)
  const readinessScore =
    buildReadinessScore({
      ...core,
      ...sellerHub,
      ...payments,
      ...policies,
      ...logistics,
      ...listingPrerequisites,
      ...risk,
    })
  const accountStatus =
    buildAccountStatus({
      ...core,
      ...sellerHub,
      ...payments,
      ...policies,
      ...logistics,
      ...listingPrerequisites,
      ...risk,
      blockers,
      unknownChecklistItems,
    })
  const nextRecommendedRoute =
    buildEbayResumeRouteRecommendation({
      accountStatus,
      preferredResumeStrategy:
        input.preferredResumeStrategy,
      unknownChecklistItems,
    })
  const allRequiredConfirmed =
    unknownChecklistItems.length === 0 &&
    blockers.length === 0 &&
    risk.accountRiskLevel === "LOW"

  return {
    readinessVersion:
      EBAY_SELLER_ACCOUNT_READINESS_VERSION,
    sourceDataClass,
    readinessReportBuilt:
      true,
    readinessScore,
    accountStatus,
    sellerHubAccessible:
      sellerHub.sellerHubAccessible,
    paymentsReady:
      payments.paymentsReady,
    payoutsReady:
      payments.payoutsReady,
    policiesReady:
      policies.policiesReady,
    logisticsReady:
      logistics.logisticsReady,
    listingPrerequisitesReady:
      listingPrerequisites.listingPrerequisitesReady,
    accountRiskLevel:
      risk.accountRiskLevel,
    blockers,
    warnings,
    manualChecklist:
      getEbaySellerAccountReadinessChecklist(),
    unknownChecklistItems,
    canProceedToSandboxDraft:
      allRequiredConfirmed && nextRecommendedRoute === "EBAY-RESUME-B",
    canProceedToManualListingPrep:
      allRequiredConfirmed && (nextRecommendedRoute === "EBAY-RESUME-B" || nextRecommendedRoute === "EBAY-RESUME-C"),
    canPublish:
      false,
    requiresHumanApproval:
      true,
    nextRecommendedRoute,
    productionTouched:
      false,
    mainTouched:
      false,
    stagingWriteExecuted:
      false,
    ebayApiUsed:
      false,
    ebayProductionApiUsed:
      false,
    oauthUsed:
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

export function summarizeEbaySellerAccountReadiness(report: ReturnType<typeof buildEbaySellerAccountReadinessReport>) {
  return {
    readinessReportBuilt:
      report.readinessReportBuilt,
    readinessScore:
      report.readinessScore,
    accountStatus:
      report.accountStatus,
    sellerHubAccessible:
      report.sellerHubAccessible,
    paymentsReady:
      report.paymentsReady,
    payoutsReady:
      report.payoutsReady,
    policiesReady:
      report.policiesReady,
    logisticsReady:
      report.logisticsReady,
    listingPrerequisitesReady:
      report.listingPrerequisitesReady,
    accountRiskLevel:
      report.accountRiskLevel,
    blockersCount:
      report.blockers.length,
    warningsCount:
      report.warnings.length,
    manualChecklistItems:
      report.manualChecklist.length,
    unknownChecklistItems:
      report.unknownChecklistItems.length,
    canProceedToSandboxDraft:
      report.canProceedToSandboxDraft,
    canProceedToManualListingPrep:
      report.canProceedToManualListingPrep,
    canPublish:
      report.canPublish,
    requiresHumanApproval:
      report.requiresHumanApproval,
    nextRecommendedRoute:
      report.nextRecommendedRoute,
    productionTouched:
      report.productionTouched,
    mainTouched:
      report.mainTouched,
    stagingWriteExecuted:
      report.stagingWriteExecuted,
    ebayApiUsed:
      report.ebayApiUsed,
    ebayProductionApiUsed:
      report.ebayProductionApiUsed,
    oauthUsed:
      report.oauthUsed,
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

export function buildEbaySellerAccountReadinessFromFixture(fixture: SellerAccountReadinessFixture) {
  return buildEbaySellerAccountReadinessReport(fixture.sellerAccountChecklist ?? {})
}
