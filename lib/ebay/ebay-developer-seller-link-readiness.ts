export const EBAY_DEVELOPER_SELLER_LINK_READINESS_VERSION =
  "EBAY_DEVELOPER_SELLER_LINK_READINESS_RESUME_A2_V1"

const sourceDataClass =
  "EBAY_RESUME_A2_DEVELOPER_SELLER_LINK_READINESS"

type LinkStatus =
  | "confirmed"
  | "configured"
  | "available"
  | "ready"
  | "unknown"
  | "missing"
  | "blocked"
  | "partial_or_manual_required"
  | "unknown_or_manual_required"
  | "NEED_MORE_SELLER_HUB_DATA"

type RouteRecommendation =
  | "EBAY-RESUME-A3"
  | "EBAY-RESUME-B"
  | "EBAY-RESUME-C"
  | "EBAY-RESUME-HOLD"
  | "NEED_MORE_DEVELOPER_SELLER_LINK_DATA"

type SellerAccountType =
  | "PERSONAL"
  | "BUSINESS"
  | "UNKNOWN"

type DeveloperSellerLinkEntry = {
  sellerAccountTypeCurrent?: string | null
  plannedFutureSellerAccountType?: string | null
  plannedBusinessConversionWindowDays?: number | null
  targetMarketplace?: string | null
  developerAccountCreated?: string | boolean | null
  developerApplicationCreated?: string | boolean | null
  productionKeysAvailable?: string | boolean | null
  sandboxKeysAvailable?: string | boolean | null
  redirectUriConfigured?: string | boolean | null
  sellerPersonalAccountCreated?: string | boolean | null
  sellerAccountAuthorizationStatus?: string | boolean | null
  sellerHubManualChecklistStatus?: string | null
  businessPoliciesReadableViaApi?: string | boolean | null
  fulfillmentPoliciesReadableViaApi?: string | boolean | null
  returnPoliciesReadableViaApi?: string | boolean | null
  paymentPoliciesReadableViaApi?: string | boolean | null
  inventoryLocationsReadableViaApi?: string | boolean | null
  sellerLimitsReadableViaApi?: string | boolean | null
  paymentsPayoutsReadableViaApi?: string | boolean | null
  accountAlertsReadableViaApi?: string | boolean | null
  businessConversionPlanned?: boolean | null
  businessConversionDays?: number | null
  accountRiskStatus?: string | null
  humanApprovalForReadOnlyOauthAudit?: boolean | null
}

type DeveloperSellerLinkFixture = {
  sellerAccountTypeCurrent?: string | null
  plannedFutureSellerAccountType?: string | null
  plannedBusinessConversionWindowDays?: number | null
  targetMarketplace?: string | null
  developerSellerLinkChecklist?: DeveloperSellerLinkEntry | null
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

function normalizeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback
}

function normalizeStatus(value: unknown): LinkStatus {
  if (value === true) {
    return "confirmed"
  }

  if (value === false) {
    return "missing"
  }

  const status =
    normalizeText(value)

  if (status === "NEED_MORE_SELLER_HUB_DATA") {
    return status
  }

  const normalized =
    status?.toLowerCase().replace(/\s+/g, "_")

  if (
    normalized === "confirmed" ||
    normalized === "configured" ||
    normalized === "available" ||
    normalized === "ready" ||
    normalized === "unknown" ||
    normalized === "missing" ||
    normalized === "blocked" ||
    normalized === "partial_or_manual_required" ||
    normalized === "unknown_or_manual_required"
  ) {
    return normalized
  }

  return "unknown"
}

function normalizeSellerAccountType(value: unknown): SellerAccountType {
  const text =
    normalizeText(value)?.toUpperCase()

  return text === "PERSONAL" || text === "BUSINESS"
    ? text
    : "UNKNOWN"
}

function isReady(status: LinkStatus) {
  return status === "confirmed" ||
    status === "configured" ||
    status === "available" ||
    status === "ready"
}

function isUnknown(status: LinkStatus) {
  return status === "unknown" ||
    status === "unknown_or_manual_required" ||
    status === "partial_or_manual_required" ||
    status === "NEED_MORE_SELLER_HUB_DATA"
}

function isBlocked(status: LinkStatus) {
  return status === "missing" || status === "blocked"
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function buildEbayDeveloperSellerLinkReadinessInput(
  entry: DeveloperSellerLinkEntry,
  fixture?: DeveloperSellerLinkFixture | null,
) {
  return {
    readinessVersion:
      EBAY_DEVELOPER_SELLER_LINK_READINESS_VERSION,
    sourceDataClass,
    sellerAccountTypeCurrent:
      normalizeSellerAccountType(entry.sellerAccountTypeCurrent ?? fixture?.sellerAccountTypeCurrent),
    plannedFutureSellerAccountType:
      normalizeSellerAccountType(entry.plannedFutureSellerAccountType ?? fixture?.plannedFutureSellerAccountType),
    plannedBusinessConversionWindowDays:
      normalizeNumber(entry.plannedBusinessConversionWindowDays ?? fixture?.plannedBusinessConversionWindowDays, 0),
    targetMarketplace:
      normalizeText(entry.targetMarketplace ?? fixture?.targetMarketplace) ?? "EBAY_US",
    developerAccountCreated:
      normalizeStatus(entry.developerAccountCreated),
    developerApplicationCreated:
      normalizeStatus(entry.developerApplicationCreated),
    productionKeysAvailable:
      normalizeStatus(entry.productionKeysAvailable),
    sandboxKeysAvailable:
      normalizeStatus(entry.sandboxKeysAvailable),
    redirectUriConfigured:
      normalizeStatus(entry.redirectUriConfigured),
    sellerPersonalAccountCreated:
      normalizeStatus(entry.sellerPersonalAccountCreated),
    sellerAccountAuthorizationStatus:
      normalizeStatus(entry.sellerAccountAuthorizationStatus),
    sellerHubManualChecklistStatus:
      normalizeStatus(entry.sellerHubManualChecklistStatus),
    businessPoliciesReadableViaApi:
      normalizeStatus(entry.businessPoliciesReadableViaApi),
    fulfillmentPoliciesReadableViaApi:
      normalizeStatus(entry.fulfillmentPoliciesReadableViaApi),
    returnPoliciesReadableViaApi:
      normalizeStatus(entry.returnPoliciesReadableViaApi),
    paymentPoliciesReadableViaApi:
      normalizeStatus(entry.paymentPoliciesReadableViaApi),
    inventoryLocationsReadableViaApi:
      normalizeStatus(entry.inventoryLocationsReadableViaApi),
    sellerLimitsReadableViaApi:
      normalizeStatus(entry.sellerLimitsReadableViaApi),
    paymentsPayoutsReadableViaApi:
      normalizeStatus(entry.paymentsPayoutsReadableViaApi),
    accountAlertsReadableViaApi:
      normalizeStatus(entry.accountAlertsReadableViaApi),
    businessConversionPlanned:
      normalizeBoolean(entry.businessConversionPlanned),
    businessConversionDays:
      normalizeNumber(entry.businessConversionDays, 0),
    accountRiskStatus:
      normalizeStatus(entry.accountRiskStatus),
    humanApprovalForReadOnlyOauthAudit:
      normalizeBoolean(entry.humanApprovalForReadOnlyOauthAudit),
  }
}

export function buildEbayDeveloperAppReadiness(input: ReturnType<typeof buildEbayDeveloperSellerLinkReadinessInput>) {
  const developerAppReady =
    isReady(input.developerAccountCreated) &&
    isReady(input.developerApplicationCreated) &&
    isReady(input.redirectUriConfigured) &&
    (isReady(input.sandboxKeysAvailable) || isReady(input.productionKeysAvailable))

  return {
    developerAppReady,
    blockers:
      [
        isBlocked(input.developerAccountCreated) ? "Developer account is missing or blocked" : "",
        isBlocked(input.developerApplicationCreated) ? "Developer application is missing or blocked" : "",
        isBlocked(input.redirectUriConfigured) ? "Redirect URI is missing or blocked" : "",
      ].filter(Boolean),
    warnings:
      [
        isUnknown(input.developerAccountCreated) ? "Developer account creation must be confirmed" : "",
        isUnknown(input.developerApplicationCreated) ? "Developer application creation must be confirmed" : "",
        isUnknown(input.productionKeysAvailable) ? "Production key availability must be confirmed, without copying secrets" : "",
        isUnknown(input.sandboxKeysAvailable) ? "Sandbox key availability must be confirmed, without copying secrets" : "",
        isUnknown(input.redirectUriConfigured) ? "Redirect URI configuration must be confirmed" : "",
      ].filter(Boolean),
  }
}

export function buildEbaySellerAuthorizationReadiness(input: ReturnType<typeof buildEbayDeveloperSellerLinkReadinessInput>) {
  const personalSellerModeAllowed =
    input.sellerAccountTypeCurrent === "PERSONAL" &&
    input.targetMarketplace === "EBAY_US"
  const sellerAuthorizationReady =
    isReady(input.sellerPersonalAccountCreated) &&
    isReady(input.sellerAccountAuthorizationStatus)

  return {
    personalSellerModeAllowed,
    sellerAuthorizationReady,
    blockers:
      [
        isBlocked(input.sellerPersonalAccountCreated) ? "Personal seller account is missing or blocked" : "",
        isBlocked(input.sellerAccountAuthorizationStatus) ? "Seller authorization is blocked" : "",
      ].filter(Boolean),
    warnings:
      [
        personalSellerModeAllowed ? "Personal seller account can be used temporarily, but business conversion must be planned" : "",
        isUnknown(input.sellerAccountAuthorizationStatus) ? "Seller account authorization status must be confirmed before OAuth audit" : "",
        input.targetMarketplace !== "EBAY_US" ? "Target marketplace must be EBAY_US" : "",
      ].filter(Boolean),
  }
}

export function buildEbayOAuthSafetyChecklist(input: ReturnType<typeof buildEbayDeveloperSellerLinkReadinessInput>) {
  const oauthSafetyReady =
    input.humanApprovalForReadOnlyOauthAudit &&
    isReady(input.redirectUriConfigured)

  return {
    oauthSafetyReady,
    checklist:
      [
        "Do not perform real token exchange in EBAY-RESUME-A2",
        "Do not store access_token",
        "Do not store refresh_token",
        "Do not store client_secret",
        "Do not print tokens",
        "Use read-only audit only in EBAY-RESUME-A3 after human approval",
      ],
    warnings:
      [
        !input.humanApprovalForReadOnlyOauthAudit ? "Human approval for read-only OAuth audit is missing" : "",
        !isReady(input.redirectUriConfigured) ? "Redirect URI must be confirmed before any future OAuth audit" : "",
      ].filter(Boolean),
  }
}

export function buildEbayReadableDataMap(input: ReturnType<typeof buildEbayDeveloperSellerLinkReadinessInput>) {
  return [
    { key: "oauthAuthorizationStatus", label: "OAuth authorization status", status: input.sellerAccountAuthorizationStatus },
    { key: "developerAppReadiness", label: "Developer app readiness", status: input.developerApplicationCreated },
    { key: "marketplaceTarget", label: "Marketplace target", status: input.targetMarketplace === "EBAY_US" ? "confirmed" : "unknown" },
    { key: "businessPolicies", label: "Business policies if API access is permitted", status: input.businessPoliciesReadableViaApi },
    { key: "fulfillmentPolicies", label: "Fulfillment/shipping policies if API access is permitted", status: input.fulfillmentPoliciesReadableViaApi },
    { key: "returnPolicies", label: "Return policies if API access is permitted", status: input.returnPoliciesReadableViaApi },
    { key: "paymentPolicies", label: "Payment policy if API access is permitted", status: input.paymentPoliciesReadableViaApi },
    { key: "inventoryLocations", label: "Inventory locations if API access is permitted", status: input.inventoryLocationsReadableViaApi },
    { key: "sandboxDraftReadiness", label: "Technical readiness for later sandbox draft", status: input.sandboxKeysAvailable },
  ]
}

export function buildEbayManualSellerHubDataMap(input: ReturnType<typeof buildEbayDeveloperSellerLinkReadinessInput>) {
  return [
    { key: "internalAlerts", label: "Internal Seller Hub alerts", status: input.accountAlertsReadableViaApi },
    { key: "suspensionRestriction", label: "Suspension or selling restriction", status: input.accountRiskStatus },
    { key: "identityVerification", label: "Identity verification", status: input.accountRiskStatus },
    { key: "paymentsApproved", label: "Payments really approved", status: input.paymentsPayoutsReadableViaApi },
    { key: "payoutBankApproved", label: "Payout bank really approved", status: input.paymentsPayoutsReadableViaApi },
    { key: "sellerLimits", label: "Seller limits if not available by API", status: input.sellerLimitsReadableViaApi },
    { key: "ebayMessages", label: "eBay account messages", status: "manual_required" },
    { key: "personalToBusinessChange", label: "Personal to business conversion steps", status: input.businessConversionPlanned ? "manual_required" : "unknown" },
    { key: "humanListingApproval", label: "Human approval before listing", status: "manual_required" },
  ]
}

export function buildEbayPersonalToBusinessTransitionChecklist(input: ReturnType<typeof buildEbayDeveloperSellerLinkReadinessInput>) {
  return [
    "Confirm whether eBay allows upgrade from account settings",
    "Prepare LLC/legal business name",
    "Prepare EIN/tax info if applicable",
    "Prepare beneficial owner information",
    "Prepare business address",
    "Prepare business bank/payout account",
    "Review whether policies and item location remain correct",
    "Reauthorize OAuth if eBay requires new consent",
    "Run readiness again after the business conversion",
    "Do not publish sensitive products during transition",
    `Planned conversion window: ${input.businessConversionDays} days`,
  ]
}

export function buildEbayDeveloperSellerLinkRiskAssessment(input: ReturnType<typeof buildEbayDeveloperSellerLinkReadinessInput>) {
  const accountRiskHigh =
    input.accountRiskStatus === "blocked" ||
    normalizeText(input.accountRiskStatus)?.toLowerCase() === "suspended" ||
    normalizeText(input.accountRiskStatus)?.toLowerCase() === "verification_required"
  const personalAccountRisk =
    input.sellerAccountTypeCurrent === "PERSONAL" && input.businessConversionPlanned

  return {
    accountRiskHigh,
    personalAccountRisk,
    blockers:
      [
        accountRiskHigh ? "Account suspension, verification, or restriction must be resolved before OAuth/listing work" : "",
      ].filter(Boolean),
    warnings:
      [
        personalAccountRisk ? "Personal account is temporary; re-check readiness after business conversion" : "",
        input.businessConversionDays > 0 ? `Business conversion planned in about ${input.businessConversionDays} days` : "",
      ].filter(Boolean),
  }
}

function buildReadinessScore(values: {
  developerAppReady: boolean
  sellerAuthorizationReady: boolean
  oauthSafetyReady: boolean
  personalSellerModeAllowed: boolean
  apiReadableDataCategories: ReturnType<typeof buildEbayReadableDataMap>
  manualOnlyDataCategories: ReturnType<typeof buildEbayManualSellerHubDataMap>
  blockers: string[]
}) {
  const apiKnown =
    values.apiReadableDataCategories.filter(item => !isUnknown(normalizeStatus(item.status))).length
  const manualKnown =
    values.manualOnlyDataCategories.filter(item => !isUnknown(normalizeStatus(item.status))).length
  const score =
    (values.developerAppReady ? 25 : 0) +
    (values.sellerAuthorizationReady ? 20 : 0) +
    (values.oauthSafetyReady ? 15 : 0) +
    (values.personalSellerModeAllowed ? 10 : 0) +
    apiKnown * 3 +
    manualKnown * 2 -
    values.blockers.length * 15

  return clampScore(score)
}

export function buildEbayDeveloperSellerLinkRouteRecommendation(values: {
  developerAppReady: boolean
  sellerAuthorizationReady: boolean
  oauthSafetyReady: boolean
  sellerHubManualChecklistStatus: LinkStatus
  accountRiskHigh: boolean
  humanApprovalForReadOnlyOauthAudit: boolean
}): RouteRecommendation {
  if (values.accountRiskHigh) {
    return "EBAY-RESUME-HOLD"
  }

  if (values.developerAppReady && values.sellerAuthorizationReady && values.oauthSafetyReady && values.humanApprovalForReadOnlyOauthAudit) {
    return "EBAY-RESUME-A3"
  }

  if (values.developerAppReady && values.sellerAuthorizationReady && values.sellerHubManualChecklistStatus === "confirmed") {
    return "EBAY-RESUME-B"
  }

  return "NEED_MORE_DEVELOPER_SELLER_LINK_DATA"
}

export function getEbayDeveloperSellerLinkChecklist() {
  return [
    "Confirm eBay Developer account exists",
    "Confirm eBay Developer application exists",
    "Confirm Sandbox keys exist without copying secrets",
    "Confirm Production keys exist without copying secrets",
    "Confirm redirect URI is configured",
    "Confirm personal seller account exists",
    "Confirm seller authorization readiness",
    "Confirm human approval before any read-only OAuth audit",
    "Confirm Seller Hub checklist still needs manual review",
    "Prepare personal to business conversion checklist",
  ]
}

export function buildEbayDeveloperSellerLinkReadinessReport(
  entry: DeveloperSellerLinkEntry,
  fixture?: DeveloperSellerLinkFixture | null,
) {
  const input =
    buildEbayDeveloperSellerLinkReadinessInput(entry, fixture)
  const developerApp =
    buildEbayDeveloperAppReadiness(input)
  const sellerAuthorization =
    buildEbaySellerAuthorizationReadiness(input)
  const oauthSafety =
    buildEbayOAuthSafetyChecklist(input)
  const apiReadableDataCategories =
    buildEbayReadableDataMap(input)
  const manualOnlyDataCategories =
    buildEbayManualSellerHubDataMap(input)
  const risk =
    buildEbayDeveloperSellerLinkRiskAssessment(input)
  const blockers =
    unique([
      ...developerApp.blockers,
      ...sellerAuthorization.blockers,
      ...risk.blockers,
    ])
  const warnings =
    unique([
      ...developerApp.warnings,
      ...sellerAuthorization.warnings,
      ...oauthSafety.warnings,
      ...risk.warnings,
      "No real token exchange is allowed in EBAY-RESUME-A2",
      "Do not store or print access_token, refresh_token, or client_secret",
      "Seller Hub manual confirmation remains required",
      "Do not mix Amazon 149G or old eBay LOOP 149 into this branch",
    ])
  const nextRecommendedRoute =
    buildEbayDeveloperSellerLinkRouteRecommendation({
      developerAppReady: developerApp.developerAppReady,
      sellerAuthorizationReady: sellerAuthorization.sellerAuthorizationReady,
      oauthSafetyReady: oauthSafety.oauthSafetyReady,
      sellerHubManualChecklistStatus: input.sellerHubManualChecklistStatus,
      accountRiskHigh: risk.accountRiskHigh,
      humanApprovalForReadOnlyOauthAudit: input.humanApprovalForReadOnlyOauthAudit,
    })
  const readinessScore =
    buildReadinessScore({
      ...developerApp,
      ...sellerAuthorization,
      ...oauthSafety,
      apiReadableDataCategories,
      manualOnlyDataCategories,
      blockers,
    })

  return {
    readinessVersion:
      EBAY_DEVELOPER_SELLER_LINK_READINESS_VERSION,
    sourceDataClass,
    readinessReportBuilt:
      true,
    readinessScore,
    developerAppReady:
      developerApp.developerAppReady,
    sellerAuthorizationReady:
      sellerAuthorization.sellerAuthorizationReady,
    oauthSafetyReady:
      oauthSafety.oauthSafetyReady,
    personalSellerModeAllowed:
      sellerAuthorization.personalSellerModeAllowed,
    businessConversionPlanned:
      input.businessConversionPlanned,
    businessConversionDays:
      input.businessConversionDays,
    businessConversionChecklist:
      buildEbayPersonalToBusinessTransitionChecklist(input),
    apiReadableDataCategories,
    manualOnlyDataCategories,
    blockers,
    warnings,
    nextRecommendedRoute,
    canProceedToRealOAuthAudit:
      developerApp.developerAppReady &&
      sellerAuthorization.sellerAuthorizationReady &&
      oauthSafety.oauthSafetyReady &&
      input.humanApprovalForReadOnlyOauthAudit,
    canProceedToSandboxDraft:
      false,
    canProceedToManualListingPrep:
      false,
    canPublish:
      false,
    requiresHumanApproval:
      true,
    productionTouched:
      false,
    mainTouched:
      false,
    stagingWriteExecuted:
      false,
    ebayApiUsed:
      false,
    ebayProductionWriteUsed:
      false,
    realTokenExchangeExecuted:
      false,
    accessTokenStored:
      false,
    refreshTokenStored:
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

export function summarizeEbayDeveloperSellerLinkReadiness(report: ReturnType<typeof buildEbayDeveloperSellerLinkReadinessReport>) {
  return {
    readinessReportBuilt:
      report.readinessReportBuilt,
    readinessScore:
      report.readinessScore,
    developerAppReady:
      report.developerAppReady,
    sellerAuthorizationReady:
      report.sellerAuthorizationReady,
    oauthSafetyReady:
      report.oauthSafetyReady,
    personalSellerModeAllowed:
      report.personalSellerModeAllowed,
    businessConversionPlanned:
      report.businessConversionPlanned,
    businessConversionDays:
      report.businessConversionDays,
    apiReadableDataCategoriesCount:
      report.apiReadableDataCategories.length,
    manualOnlyDataCategoriesCount:
      report.manualOnlyDataCategories.length,
    blockersCount:
      report.blockers.length,
    warningsCount:
      report.warnings.length,
    canProceedToRealOAuthAudit:
      report.canProceedToRealOAuthAudit,
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
    ebayProductionWriteUsed:
      report.ebayProductionWriteUsed,
    realTokenExchangeExecuted:
      report.realTokenExchangeExecuted,
    accessTokenStored:
      report.accessTokenStored,
    refreshTokenStored:
      report.refreshTokenStored,
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

export function buildEbayDeveloperSellerLinkReadinessFromFixture(fixture: DeveloperSellerLinkFixture) {
  return buildEbayDeveloperSellerLinkReadinessReport(
    fixture.developerSellerLinkChecklist ?? {},
    fixture,
  )
}
