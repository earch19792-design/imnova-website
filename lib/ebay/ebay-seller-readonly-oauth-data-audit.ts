// @ts-ignore Node's native TypeScript test runner requires the explicit extension.
import { EBAY_READONLY_SCOPES } from "./ebay-capability-registry.ts"

export {
  EBAY_CAPABILITY_IMPLEMENTATION_STATES,
  EBAY_CAPABILITY_REGISTRY,
  EBAY_CAPABILITY_REGISTRY_VERSION,
  EBAY_READONLY_SCOPES,
  calculateEbayCapabilityImplementationPercentages,
  getEbayCapabilityRegistryAdminProjection,
// @ts-ignore Node's native TypeScript test runner requires the explicit extension.
} from "./ebay-capability-registry.ts"

export const EBAY_SELLER_READONLY_OAUTH_DATA_AUDIT_VERSION =
  "EBAY_SELLER_READONLY_OAUTH_DATA_AUDIT_RESUME_A3_V1"

const sourceDataClass =
  "EBAY_RESUME_A3_SELLER_READONLY_OAUTH_DATA_AUDIT"

export const EBAY_READONLY_OAUTH_APPROVAL_PHRASE =
  "YES_I_APPROVE_READ_ONLY_AUDIT"

export const EBAY_READONLY_CLI_CONFIRMATION_PHRASE =
  "READ_ONLY_AUDIT_APPROVED"

const ebayReadOnlyEndpoints = [
  {
    key:
      "fulfillmentPolicies",
    label:
      "Fulfillment policies",
    path:
      "/sell/account/v1/fulfillment_policy",
    method:
      "GET",
    requiredScope:
      "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  },
  {
    key:
      "returnPolicies",
    label:
      "Return policies",
    path:
      "/sell/account/v1/return_policy",
    method:
      "GET",
    requiredScope:
      "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  },
  {
    key:
      "paymentPolicies",
    label:
      "Payment policies",
    path:
      "/sell/account/v1/payment_policy",
    method:
      "GET",
    requiredScope:
      "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  },
  {
    key:
      "inventoryLocations",
    label:
      "Inventory locations",
    path:
      "/sell/inventory/v1/location",
    method:
      "GET",
    requiredScope:
      "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
  },
] as const

type AuditStatus =
  | "confirmed"
  | "configured"
  | "available"
  | "ready"
  | "unknown"
  | "missing"
  | "blocked"
  | "unavailable_or_scope_missing"
  | "manual_required"

type RouteRecommendation =
  | "EBAY-RESUME-B"
  | "EBAY-RESUME-C"
  | "EBAY-RESUME-A4"
  | "EBAY-RESUME-HOLD"
  | "NEED_MORE_OAUTH_AUDIT_DATA"

type AccountRiskLevel =
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "UNKNOWN"

type AuditInput = {
  sellerAccountTypeCurrent?: string | null
  plannedFutureSellerAccountType?: string | null
  plannedBusinessConversionWindowDays?: number | null
  targetMarketplace?: string | null
  developerAccountCreated?: string | boolean | null
  developerApplicationCreated?: string | boolean | null
  sandboxKeysAvailable?: string | boolean | null
  productionKeysAvailable?: string | boolean | null
  redirectUriConfigured?: string | boolean | null
  sellerPersonalAccountCreated?: string | boolean | null
  sellerHubAccessible?: string | boolean | null
  humanApprovalForReadOnlyOauthAudit?: boolean | null
  sellerAuthorizationStatus?: string | boolean | null
  oauthEnvironment?: string | null
  requestedScopes?: string[] | string | null
  fulfillmentPoliciesCount?: number | null
  returnPoliciesCount?: number | null
  paymentPoliciesCount?: number | null
  inventoryLocationsCount?: number | null
  accountRiskStatus?: string | null
  manualSellerHubDataStatus?: string | null
  oauthAuthorizationSucceeded?: boolean | null
}

type FixtureLike = {
  sellerAccountTypeCurrent?: string | null
  plannedFutureSellerAccountType?: string | null
  plannedBusinessConversionWindowDays?: number | null
  targetMarketplace?: string | null
  dryRunAuditInput?: AuditInput | null
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
    ? Math.max(0, Math.round(value))
    : fallback
}

function normalizeStatus(value: unknown): AuditStatus {
  if (value === true) {
    return "confirmed"
  }

  if (value === false) {
    return "missing"
  }

  const normalized =
    normalizeText(value)?.toLowerCase().replace(/\s+/g, "_")

  if (
    normalized === "confirmed" ||
    normalized === "configured" ||
    normalized === "available" ||
    normalized === "ready" ||
    normalized === "unknown" ||
    normalized === "missing" ||
    normalized === "blocked" ||
    normalized === "unavailable_or_scope_missing" ||
    normalized === "manual_required"
  ) {
    return normalized
  }

  return "unknown"
}

function normalizeScopes(scopes: AuditInput["requestedScopes"]) {
  const rawScopes =
    Array.isArray(scopes)
      ? scopes
      : typeof scopes === "string"
        ? scopes.split(/[,\s]+/)
        : [...EBAY_READONLY_SCOPES]

  return [...new Set(
    rawScopes
      .map(scope => normalizeText(scope))
      .filter((scope): scope is string => scope !== null),
  )]
}

function isReady(status: AuditStatus) {
  return status === "confirmed" ||
    status === "configured" ||
    status === "available" ||
    status === "ready"
}

function isWriteScope(scope: string) {
  const lowered =
    scope.toLowerCase()

  return (
    lowered.includes("sell.account") &&
    !lowered.includes("readonly")
  ) ||
    (
      lowered.includes("sell.inventory") &&
      !lowered.includes("readonly")
    ) ||
    lowered.includes("sell.fulfillment") ||
    lowered.includes("sell.finances") ||
    lowered.includes("commerce.identity") && !lowered.includes("readonly")
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function buildEbaySellerReadOnlyOauthAuditInput(
  entry: AuditInput = {},
  fixture?: FixtureLike | null,
) {
  const source =
    {
      ...fixture?.dryRunAuditInput,
      ...entry,
    }

  return {
    auditVersion:
      EBAY_SELLER_READONLY_OAUTH_DATA_AUDIT_VERSION,
    sourceDataClass,
    sellerAccountTypeCurrent:
      normalizeText(source.sellerAccountTypeCurrent ?? fixture?.sellerAccountTypeCurrent) ?? "PERSONAL",
    plannedFutureSellerAccountType:
      normalizeText(source.plannedFutureSellerAccountType ?? fixture?.plannedFutureSellerAccountType) ?? "BUSINESS",
    plannedBusinessConversionWindowDays:
      normalizeNumber(source.plannedBusinessConversionWindowDays ?? fixture?.plannedBusinessConversionWindowDays, 15),
    targetMarketplace:
      normalizeText(source.targetMarketplace ?? fixture?.targetMarketplace) ?? "EBAY_US",
    developerAccountCreated:
      normalizeStatus(source.developerAccountCreated),
    developerApplicationCreated:
      normalizeStatus(source.developerApplicationCreated),
    sandboxKeysAvailable:
      normalizeStatus(source.sandboxKeysAvailable),
    productionKeysAvailable:
      normalizeStatus(source.productionKeysAvailable),
    redirectUriConfigured:
      normalizeStatus(source.redirectUriConfigured),
    sellerPersonalAccountCreated:
      normalizeStatus(source.sellerPersonalAccountCreated),
    sellerHubAccessible:
      normalizeStatus(source.sellerHubAccessible),
    humanApprovalForReadOnlyOauthAudit:
      normalizeBoolean(source.humanApprovalForReadOnlyOauthAudit),
    sellerAuthorizationStatus:
      normalizeStatus(source.sellerAuthorizationStatus),
    oauthEnvironment:
      normalizeText(source.oauthEnvironment)?.toUpperCase() ?? "UNKNOWN",
    requestedScopes:
      normalizeScopes(source.requestedScopes),
    fulfillmentPoliciesCount:
      normalizeNumber(source.fulfillmentPoliciesCount, 0),
    returnPoliciesCount:
      normalizeNumber(source.returnPoliciesCount, 0),
    paymentPoliciesCount:
      normalizeNumber(source.paymentPoliciesCount, 0),
    inventoryLocationsCount:
      normalizeNumber(source.inventoryLocationsCount, 0),
    accountRiskStatus:
      normalizeStatus(source.accountRiskStatus),
    manualSellerHubDataStatus:
      normalizeStatus(source.manualSellerHubDataStatus),
    oauthAuthorizationSucceeded:
      normalizeBoolean(source.oauthAuthorizationSucceeded),
  }
}

export function buildEbayReadOnlyOauthGate(input: ReturnType<typeof buildEbaySellerReadOnlyOauthAuditInput>) {
  const developerReady =
    isReady(input.developerAccountCreated) &&
    isReady(input.developerApplicationCreated) &&
    isReady(input.redirectUriConfigured) &&
    (isReady(input.productionKeysAvailable) || isReady(input.sandboxKeysAvailable))
  const sellerReady =
    isReady(input.sellerPersonalAccountCreated) &&
    isReady(input.sellerHubAccessible)
  const environmentReady =
    input.oauthEnvironment === "PRODUCTION" ||
    input.oauthEnvironment === "SANDBOX"
  const oauthGateReady =
    developerReady &&
    sellerReady &&
    environmentReady &&
    input.humanApprovalForReadOnlyOauthAudit

  return {
    oauthGateReady,
    developerReady,
    sellerReady,
    environmentReady,
    blockers:
      [
        !developerReady ? "Developer app, keys, or redirect URI are not fully confirmed" : "",
        !sellerReady ? "Seller account and Seller Hub access are not fully confirmed" : "",
        !environmentReady ? "OAuth environment must be explicitly PRODUCTION or SANDBOX" : "",
        !input.humanApprovalForReadOnlyOauthAudit ? "Human approval for read-only OAuth audit is missing" : "",
      ].filter(Boolean),
    warnings:
      [
        "Runner default mode performs no OAuth and no API call",
        "Real OAuth is allowed only in the gated runner with exact approval",
      ],
  }
}

export function buildEbayReadOnlyScopePlan(input: ReturnType<typeof buildEbaySellerReadOnlyOauthAuditInput>) {
  const writeScopes =
    input.requestedScopes.filter(isWriteScope)
  const missingRecommendedScopes =
    EBAY_READONLY_SCOPES.filter(scope => !input.requestedScopes.includes(scope))
  const readOnlyScopesReady =
    writeScopes.length === 0 &&
    missingRecommendedScopes.length === 0

  return {
    readOnlyScopesReady,
    requestedScopes:
      [...input.requestedScopes],
    recommendedScopes:
      [...EBAY_READONLY_SCOPES],
    writeScopesRejected:
      writeScopes,
    missingRecommendedScopes,
    warnings:
      [
        missingRecommendedScopes.length > 0 ? "Some recommended read-only scopes must be confirmed in eBay Developer Portal" : "",
      ].filter(Boolean),
    blockers:
      [
        writeScopes.length > 0 ? "Write scopes are not allowed in EBAY-RESUME-A3" : "",
      ].filter(Boolean),
  }
}

export function buildEbaySellerAccountPolicyAudit(input: ReturnType<typeof buildEbaySellerReadOnlyOauthAuditInput>) {
  const businessPoliciesReadable =
    input.fulfillmentPoliciesCount > 0 &&
    input.returnPoliciesCount > 0 &&
    input.paymentPoliciesCount > 0

  return {
    businessPoliciesReadable,
    missingPolicyTypes:
      [
        input.fulfillmentPoliciesCount <= 0 ? "fulfillment_policy" : "",
        input.returnPoliciesCount <= 0 ? "return_policy" : "",
        input.paymentPoliciesCount <= 0 ? "payment_policy" : "",
      ].filter(Boolean),
  }
}

export function buildEbayFulfillmentPolicyAudit(input: ReturnType<typeof buildEbaySellerReadOnlyOauthAuditInput>) {
  return {
    fulfillmentPoliciesCount:
      input.fulfillmentPoliciesCount,
    readable:
      input.fulfillmentPoliciesCount > 0,
  }
}

export function buildEbayReturnPolicyAudit(input: ReturnType<typeof buildEbaySellerReadOnlyOauthAuditInput>) {
  return {
    returnPoliciesCount:
      input.returnPoliciesCount,
    readable:
      input.returnPoliciesCount > 0,
  }
}

export function buildEbayPaymentPolicyAudit(input: ReturnType<typeof buildEbaySellerReadOnlyOauthAuditInput>) {
  return {
    paymentPoliciesCount:
      input.paymentPoliciesCount,
    readable:
      input.paymentPoliciesCount > 0,
  }
}

export function buildEbayInventoryLocationAudit(input: ReturnType<typeof buildEbaySellerReadOnlyOauthAuditInput>) {
  return {
    inventoryLocationsCount:
      input.inventoryLocationsCount,
    readable:
      input.inventoryLocationsCount > 0,
  }
}

export function buildEbayManualSellerHubAuditGap(input: ReturnType<typeof buildEbaySellerReadOnlyOauthAuditInput>) {
  if (input.manualSellerHubDataStatus === "confirmed") {
    return {
      missingManualSellerHubData:
        [],
      manualReviewStillRequired:
        false,
    }
  }

  const missingManualSellerHubData =
    [
      "Seller Hub account alerts",
      "Identity verification status",
      "Payments and payouts final approval",
      "Seller limits",
      "eBay messages",
      "Personal-to-business conversion status",
      "Manual Seller Hub checklist confirmation",
    ].filter(Boolean)

  return {
    missingManualSellerHubData,
    manualReviewStillRequired:
      missingManualSellerHubData.length > 0,
  }
}

export function buildEbayReadOnlyOauthRiskAssessment(input: ReturnType<typeof buildEbaySellerReadOnlyOauthAuditInput>) {
  const text =
    input.accountRiskStatus
  const highRisk =
    text === "blocked"
  const mediumRisk =
    text === "manual_required" ||
    text === "unavailable_or_scope_missing"
  const accountRiskLevel: AccountRiskLevel =
    highRisk
      ? "HIGH"
      : mediumRisk
        ? "MEDIUM"
        : text === "confirmed"
          ? "LOW"
          : "UNKNOWN"

  return {
    accountRiskLevel,
    blockers:
      [
        highRisk ? "Seller account risk, suspension, or verification must be resolved before any listing path" : "",
      ].filter(Boolean),
    warnings:
      [
        accountRiskLevel === "UNKNOWN" ? "Seller account risk must still be checked manually in Seller Hub" : "",
        input.sellerAccountTypeCurrent === "PERSONAL" ? "Personal account is temporary; rerun readiness after business conversion" : "",
      ].filter(Boolean),
  }
}

export function buildEbaySellerReadOnlyAuditRouteRecommendation(values: {
  accountRiskLevel: AccountRiskLevel
  oauthGateReady: boolean
  readOnlyScopesReady: boolean
  businessPoliciesReadable: boolean
  inventoryLocationsCount: number
  missingManualSellerHubDataCount: number
  oauthAuthorizationSucceeded: boolean
}): RouteRecommendation {
  if (values.accountRiskLevel === "HIGH") {
    return "EBAY-RESUME-HOLD"
  }

  if (!values.oauthGateReady || !values.readOnlyScopesReady || !values.oauthAuthorizationSucceeded) {
    return "NEED_MORE_OAUTH_AUDIT_DATA"
  }

  if (!values.businessPoliciesReadable || values.inventoryLocationsCount <= 0 || values.missingManualSellerHubDataCount > 0) {
    return "EBAY-RESUME-A4"
  }

  return "EBAY-RESUME-B"
}

function buildAuditScore(values: {
  oauthGateReady: boolean
  readOnlyScopesReady: boolean
  businessPoliciesReadable: boolean
  fulfillmentPoliciesCount: number
  returnPoliciesCount: number
  paymentPoliciesCount: number
  inventoryLocationsCount: number
  blockers: string[]
}) {
  const score =
    (values.oauthGateReady ? 25 : 0) +
    (values.readOnlyScopesReady ? 20 : 0) +
    (values.businessPoliciesReadable ? 20 : 0) +
    Math.min(values.fulfillmentPoliciesCount, 2) * 5 +
    Math.min(values.returnPoliciesCount, 2) * 5 +
    Math.min(values.paymentPoliciesCount, 2) * 5 +
    Math.min(values.inventoryLocationsCount, 2) * 5 -
    values.blockers.length * 15

  return clampScore(score)
}

export function buildEbaySellerReadOnlyOauthDataAuditReport(
  entry: AuditInput = {},
  fixture?: FixtureLike | null,
) {
  const input =
    buildEbaySellerReadOnlyOauthAuditInput(entry, fixture)
  const oauthGate =
    buildEbayReadOnlyOauthGate(input)
  const scopePlan =
    buildEbayReadOnlyScopePlan(input)
  const policyAudit =
    buildEbaySellerAccountPolicyAudit(input)
  const fulfillment =
    buildEbayFulfillmentPolicyAudit(input)
  const returnPolicy =
    buildEbayReturnPolicyAudit(input)
  const payment =
    buildEbayPaymentPolicyAudit(input)
  const inventory =
    buildEbayInventoryLocationAudit(input)
  const manualGap =
    buildEbayManualSellerHubAuditGap(input)
  const risk =
    buildEbayReadOnlyOauthRiskAssessment(input)
  const blockers =
    unique([
      ...oauthGate.blockers,
      ...scopePlan.blockers,
      ...risk.blockers,
    ])
  const warnings =
    unique([
      ...oauthGate.warnings,
      ...scopePlan.warnings,
      ...risk.warnings,
      "Do not store or print tokens",
      "Do not create drafts, listings, or publications",
      "Seller Hub manual review remains required",
    ])
  const nextRecommendedRoute =
    buildEbaySellerReadOnlyAuditRouteRecommendation({
      accountRiskLevel: risk.accountRiskLevel,
      oauthGateReady: oauthGate.oauthGateReady,
      readOnlyScopesReady: scopePlan.readOnlyScopesReady,
      businessPoliciesReadable: policyAudit.businessPoliciesReadable,
      inventoryLocationsCount: inventory.inventoryLocationsCount,
      missingManualSellerHubDataCount: manualGap.missingManualSellerHubData.length,
      oauthAuthorizationSucceeded: input.oauthAuthorizationSucceeded,
    })
  const auditScore =
    buildAuditScore({
      oauthGateReady: oauthGate.oauthGateReady,
      readOnlyScopesReady: scopePlan.readOnlyScopesReady,
      businessPoliciesReadable: policyAudit.businessPoliciesReadable,
      fulfillmentPoliciesCount: fulfillment.fulfillmentPoliciesCount,
      returnPoliciesCount: returnPolicy.returnPoliciesCount,
      paymentPoliciesCount: payment.paymentPoliciesCount,
      inventoryLocationsCount: inventory.inventoryLocationsCount,
      blockers,
    })

  return {
    auditVersion:
      EBAY_SELLER_READONLY_OAUTH_DATA_AUDIT_VERSION,
    sourceDataClass,
    auditReportBuilt:
      true,
    auditScore,
    oauthGateReady:
      oauthGate.oauthGateReady,
    readOnlyScopesReady:
      scopePlan.readOnlyScopesReady,
    sellerAuthorizationStatus:
      input.sellerAuthorizationStatus,
    businessPoliciesReadable:
      policyAudit.businessPoliciesReadable,
    fulfillmentPoliciesCount:
      fulfillment.fulfillmentPoliciesCount,
    returnPoliciesCount:
      returnPolicy.returnPoliciesCount,
    paymentPoliciesCount:
      payment.paymentPoliciesCount,
    inventoryLocationsCount:
      inventory.inventoryLocationsCount,
    missingPolicyTypes:
      policyAudit.missingPolicyTypes,
    missingManualSellerHubData:
      manualGap.missingManualSellerHubData,
    accountRiskLevel:
      risk.accountRiskLevel,
    blockers,
    warnings,
    canProceedToSandboxDraft:
      nextRecommendedRoute === "EBAY-RESUME-B",
    canProceedToManualListingPrep:
      nextRecommendedRoute === "EBAY-RESUME-C" ||
      nextRecommendedRoute === "EBAY-RESUME-B",
    canPublish:
      false,
    requiresHumanApproval:
      true,
    nextRecommendedRoute,
    productionWriteTouched:
      false,
    mainTouched:
      false,
    stagingWriteExecuted:
      false,
    ebayReadOnlyApiUsed:
      false,
    ebayWriteApiUsed:
      false,
    realTokenExchangeExecuted:
      false,
    accessTokenStored:
      false,
    refreshTokenStored:
      false,
    clientSecretStored:
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
    readOnlyEndpoints:
      ebayReadOnlyEndpoints.map(endpoint => ({ ...endpoint })),
  }
}

export function summarizeEbaySellerReadOnlyOauthDataAudit(report: ReturnType<typeof buildEbaySellerReadOnlyOauthDataAuditReport>) {
  return {
    auditReportBuilt:
      report.auditReportBuilt,
    auditScore:
      report.auditScore,
    oauthGateReady:
      report.oauthGateReady,
    readOnlyScopesReady:
      report.readOnlyScopesReady,
    sellerAuthorizationStatus:
      report.sellerAuthorizationStatus,
    businessPoliciesReadable:
      report.businessPoliciesReadable,
    fulfillmentPoliciesCount:
      report.fulfillmentPoliciesCount,
    returnPoliciesCount:
      report.returnPoliciesCount,
    paymentPoliciesCount:
      report.paymentPoliciesCount,
    inventoryLocationsCount:
      report.inventoryLocationsCount,
    missingPolicyTypesCount:
      report.missingPolicyTypes.length,
    missingManualSellerHubDataCount:
      report.missingManualSellerHubData.length,
    accountRiskLevel:
      report.accountRiskLevel,
    blockersCount:
      report.blockers.length,
    warningsCount:
      report.warnings.length,
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
    productionWriteTouched:
      report.productionWriteTouched,
    mainTouched:
      report.mainTouched,
    stagingWriteExecuted:
      report.stagingWriteExecuted,
    ebayReadOnlyApiUsed:
      report.ebayReadOnlyApiUsed,
    ebayWriteApiUsed:
      report.ebayWriteApiUsed,
    realTokenExchangeExecuted:
      report.realTokenExchangeExecuted,
    accessTokenStored:
      report.accessTokenStored,
    refreshTokenStored:
      report.refreshTokenStored,
    clientSecretStored:
      report.clientSecretStored,
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

export function getEbaySellerReadOnlyOauthDataAuditChecklist() {
  return [
    "Confirm Developer Account, app, keys, and redirect URI",
    "Use only read-only scopes",
    "Run runner default mode before any real OAuth audit",
    "Require exact approval flag and CLI confirmation for real audit",
    "Never store or print access_token, refresh_token, or client_secret",
    "Read only account policies and inventory locations",
    "Keep Seller Hub manual review for alerts, verification, limits, payments, and business conversion",
    "Never create draft, listing, publication, or any eBay write",
  ]
}

export function buildEbaySellerReadOnlyOauthDataAuditFromFixture(fixture: FixtureLike) {
  return buildEbaySellerReadOnlyOauthDataAuditReport(
    fixture.dryRunAuditInput ?? {},
    fixture,
  )
}

export function getEbayReadOnlyEndpointAllowlist() {
  return ebayReadOnlyEndpoints.map(endpoint => ({ ...endpoint }))
}
