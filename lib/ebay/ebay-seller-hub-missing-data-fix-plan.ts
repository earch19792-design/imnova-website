export const EBAY_SELLER_HUB_MISSING_DATA_FIX_PLAN_VERSION =
  "EBAY_SELLER_HUB_MISSING_DATA_FIX_PLAN_RESUME_A4_V1"

const sourceDataClass =
  "EBAY_RESUME_A4_SELLER_HUB_MISSING_DATA_FIX_PLAN"

type RouteRecommendation =
  | "EBAY-RESUME-A3-RUN"
  | "EBAY-RESUME-B"
  | "EBAY-RESUME-C"
  | "EBAY-RESUME-HOLD"
  | "NEED_SELLER_HUB_FIXES"

type AccountRiskLevel =
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "UNKNOWN"

type EndpointAvailability = {
  available?: boolean | null
  count?: number | null
  errorType?: string | null
}

type FixPlanInput = {
  oauthAuthorizationSucceeded?: boolean | null
  businessPoliciesReadable?: boolean | null
  fulfillmentPoliciesCount?: number | null
  returnPoliciesCount?: number | null
  paymentPoliciesCount?: number | null
  inventoryLocationsCount?: number | null
  missingPolicyTypes?: string[] | null
  missingManualSellerHubData?: string[] | null
  endpointAvailability?: {
    fulfillmentPolicies?: EndpointAvailability | null
    returnPolicies?: EndpointAvailability | null
    paymentPolicies?: EndpointAvailability | null
    inventoryLocations?: EndpointAvailability | null
  } | null
  sellerAccountTypeCurrent?: string | null
  plannedFutureSellerAccountType?: string | null
  plannedBusinessConversionWindowDays?: number | null
  targetMarketplace?: string | null
  accountRiskStatus?: string | null
  manualPoliciesConfirmed?: boolean | null
  manualSellerHubChecksConfirmed?: boolean | null
}

type FixtureLike = {
  oauthAuthorizationSucceeded?: boolean | null
  targetMarketplace?: string | null
  sellerAccountTypeCurrent?: string | null
  plannedFutureSellerAccountType?: string | null
  plannedBusinessConversionWindowDays?: number | null
  a3SanitizedAuditResult?: FixPlanInput | null
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

function normalizeList(value: unknown) {
  return Array.isArray(value)
    ? value.map(item => normalizeText(item)).filter((item): item is string => item !== null)
    : []
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function isPolicyMissing(input: ReturnType<typeof buildEbaySellerHubMissingDataFixPlanInput>, type: string, count: number) {
  return input.missingPolicyTypes.includes(type) || count <= 0
}

function endpointHasScopeGap(endpoint: EndpointAvailability) {
  return endpoint.available === false &&
    normalizeText(endpoint.errorType)?.includes("unavailable_or_scope_missing") === true
}

export function buildEbaySellerHubMissingDataFixPlanInput(
  entry: FixPlanInput = {},
  fixture?: FixtureLike | null,
) {
  const source =
    {
      ...fixture?.a3SanitizedAuditResult,
      ...entry,
    }
  const endpointAvailability =
    source.endpointAvailability ?? {}

  return {
    fixPlanVersion:
      EBAY_SELLER_HUB_MISSING_DATA_FIX_PLAN_VERSION,
    sourceDataClass,
    sourceAudit:
      "EBAY-RESUME-A3-RUN",
    oauthAuthorizationSucceeded:
      normalizeBoolean(source.oauthAuthorizationSucceeded ?? fixture?.oauthAuthorizationSucceeded),
    businessPoliciesReadable:
      normalizeBoolean(source.businessPoliciesReadable),
    fulfillmentPoliciesCount:
      normalizeNumber(source.fulfillmentPoliciesCount, 0),
    returnPoliciesCount:
      normalizeNumber(source.returnPoliciesCount, 0),
    paymentPoliciesCount:
      normalizeNumber(source.paymentPoliciesCount, 0),
    inventoryLocationsCount:
      normalizeNumber(source.inventoryLocationsCount, 0),
    missingPolicyTypes:
      normalizeList(source.missingPolicyTypes),
    missingManualSellerHubData:
      normalizeList(source.missingManualSellerHubData),
    endpointAvailability:
      {
        fulfillmentPolicies:
          endpointAvailability.fulfillmentPolicies ?? {},
        returnPolicies:
          endpointAvailability.returnPolicies ?? {},
        paymentPolicies:
          endpointAvailability.paymentPolicies ?? {},
        inventoryLocations:
          endpointAvailability.inventoryLocations ?? {},
      },
    sellerAccountTypeCurrent:
      normalizeText(source.sellerAccountTypeCurrent ?? fixture?.sellerAccountTypeCurrent) ?? "PERSONAL",
    plannedFutureSellerAccountType:
      normalizeText(source.plannedFutureSellerAccountType ?? fixture?.plannedFutureSellerAccountType) ?? "BUSINESS",
    plannedBusinessConversionWindowDays:
      normalizeNumber(source.plannedBusinessConversionWindowDays ?? fixture?.plannedBusinessConversionWindowDays, 15),
    targetMarketplace:
      normalizeText(source.targetMarketplace ?? fixture?.targetMarketplace) ?? "EBAY_US",
    accountRiskStatus:
      normalizeText(source.accountRiskStatus) ?? "unknown",
    manualPoliciesConfirmed:
      normalizeBoolean(source.manualPoliciesConfirmed),
    manualSellerHubChecksConfirmed:
      normalizeBoolean(source.manualSellerHubChecksConfirmed),
  }
}

export function buildEbayFulfillmentPolicyRecommendation() {
  return {
    policyType:
      "fulfillment_policy",
    missing:
      true,
    sellerHubArea:
      "Seller Hub > Account settings > Business policies > Shipping/Fulfillment",
    recommendedSetup:
      [
        "USA domestic shipping only for the first phase",
        "Handling time: 2 business days",
        "Use a tracked shipping service",
        "Avoid international shipping until account stability is confirmed",
        "Start with Buy It Now, 1 unit quantity, and low-risk categories",
      ],
    blocksListingUntilConfirmed:
      true,
  }
}

export function buildEbayReturnPolicyRecommendation() {
  return {
    policyType:
      "return_policy",
    missing:
      true,
    sellerHubArea:
      "Seller Hub > Account settings > Business policies > Return policy",
    recommendedSetup:
      [
        "30-day returns",
        "Buyer pays return shipping at the start, unless a commercial strategy says otherwise",
        "Avoid restocking fees unless clearly allowed and appropriate",
        "Keep return wording simple and aligned with eBay policy",
      ],
    blocksListingUntilConfirmed:
      true,
  }
}

export function buildEbayPaymentPolicyRecommendation() {
  return {
    policyType:
      "payment_policy",
    missing:
      true,
    sellerHubArea:
      "Seller Hub > Account settings > Business policies > Payment policy",
    recommendedSetup:
      [
        "Confirm managed payments are approved",
        "Confirm payouts and bank account are active",
        "Use immediate payment for Buy It Now when available",
        "Do not list until payment and payout readiness are clear",
      ],
    blocksListingUntilConfirmed:
      true,
  }
}

export function buildEbayInventoryLocationRecommendation(input: ReturnType<typeof buildEbaySellerHubMissingDataFixPlanInput>) {
  const missing =
    input.inventoryLocationsCount <= 0

  return {
    policyType:
      "inventory_location",
    missing,
    sellerHubArea:
      "Seller Hub > Business policies / Inventory location / Item location",
    recommendedSetup:
      [
        "Confirm item location is in the United States marketplace flow",
        "Confirm whether Luna Portex can be used as item location or warehouse",
        "Confirm shipping origin, handling time, and logistics document",
        "Do not use a warehouse location that cannot ship within the stated handling time",
      ],
    blocksListingUntilConfirmed:
      missing,
  }
}

export function buildEbayPolicyFixPlan(input: ReturnType<typeof buildEbaySellerHubMissingDataFixPlanInput>) {
  const fulfillmentPolicyMissing =
    isPolicyMissing(input, "fulfillment_policy", input.fulfillmentPoliciesCount)
  const returnPolicyMissing =
    isPolicyMissing(input, "return_policy", input.returnPoliciesCount)
  const paymentPolicyMissing =
    isPolicyMissing(input, "payment_policy", input.paymentPoliciesCount)
  const fixes =
    [
      fulfillmentPolicyMissing ? buildEbayFulfillmentPolicyRecommendation() : null,
      returnPolicyMissing ? buildEbayReturnPolicyRecommendation() : null,
      paymentPolicyMissing ? buildEbayPaymentPolicyRecommendation() : null,
    ].filter((fix): fix is NonNullable<typeof fix> => fix !== null)

  return {
    fulfillmentPolicyMissing,
    returnPolicyMissing,
    paymentPolicyMissing,
    policyFixesRequiredCount:
      fixes.length,
    fixes,
  }
}

export function buildEbayManualSellerHubChecklistPlan(input: ReturnType<typeof buildEbaySellerHubMissingDataFixPlanInput>) {
  if (input.manualSellerHubChecksConfirmed) {
    return {
      manualSellerHubChecklist:
        [],
      manualSellerHubChecksRequiredCount:
        0,
      paymentsPayoutsNeedsManualCheck:
        false,
      accountAlertsNeedManualCheck:
        false,
      identityVerificationNeedsManualCheck:
        false,
      sellerLimitsNeedManualCheck:
        false,
      businessConversionNeedsManualCheck:
        false,
    }
  }

  const baseChecks =
    input.missingManualSellerHubData.length > 0
      ? input.missingManualSellerHubData
      : [
        "Seller Hub account alerts",
        "Identity verification status",
        "Payments and payouts final approval",
        "Seller limits",
        "eBay messages",
        "Personal-to-business conversion status",
        "Manual Seller Hub checklist confirmation",
      ]
  const checklist =
    baseChecks.map(item => ({
      item,
      required:
        true,
      sellerHubArea:
        item.includes("Payments") || item.includes("payouts")
          ? "Seller Hub > Payments"
          : item.includes("limits")
            ? "Seller Hub > Overview / Selling limits"
            : item.includes("messages")
              ? "Seller Hub > Messages"
              : item.includes("business")
                ? "Account settings > Personal to business conversion"
                : "Seller Hub account overview",
      blocksPublication:
        true,
    }))

  return {
    manualSellerHubChecklist:
      checklist,
    manualSellerHubChecksRequiredCount:
      checklist.length,
    paymentsPayoutsNeedsManualCheck:
      checklist.some(check => check.item.includes("Payments") || check.item.includes("payouts")),
    accountAlertsNeedManualCheck:
      checklist.some(check => check.item.includes("alerts")),
    identityVerificationNeedsManualCheck:
      checklist.some(check => check.item.includes("Identity")),
    sellerLimitsNeedManualCheck:
      checklist.some(check => check.item.includes("limits")),
    businessConversionNeedsManualCheck:
      checklist.some(check => check.item.includes("business")),
  }
}

export function buildEbayEndpointScopeGapAssessment(input: ReturnType<typeof buildEbaySellerHubMissingDataFixPlanInput>) {
  const endpointMap =
    [
      {
        key:
          "fulfillmentPolicies",
        label:
          "Fulfillment policies",
        endpoint:
          input.endpointAvailability.fulfillmentPolicies,
        action:
          "Confirm sell.account.readonly scope and manually check whether a shipping/fulfillment policy exists",
      },
      {
        key:
          "returnPolicies",
        label:
          "Return policies",
        endpoint:
          input.endpointAvailability.returnPolicies,
        action:
          "Confirm sell.account.readonly scope and manually check whether a return policy exists",
      },
      {
        key:
          "paymentPolicies",
        label:
          "Payment policies",
        endpoint:
          input.endpointAvailability.paymentPolicies,
        action:
          "Confirm sell.account.readonly scope and manually check whether a payment policy exists",
      },
      {
        key:
          "inventoryLocations",
        label:
          "Inventory locations",
        endpoint:
          input.endpointAvailability.inventoryLocations,
        action:
          "Confirm item location because API read succeeded but returned zero locations",
      },
    ]
  const gaps =
    endpointMap
      .filter(item => endpointHasScopeGap(item.endpoint) || (item.key === "inventoryLocations" && input.inventoryLocationsCount <= 0))
      .map(item => ({
        key:
          item.key,
        label:
          item.label,
        errorType:
          normalizeText(item.endpoint.errorType) ?? (item.key === "inventoryLocations" ? "available_but_zero_count" : "unknown"),
        action:
          item.action,
      }))

  return {
    endpointScopeGapAssessment:
      gaps,
    endpointScopeGapsCount:
      gaps.length,
  }
}

export function buildEbaySellerHubRiskAssessment(input: ReturnType<typeof buildEbaySellerHubMissingDataFixPlanInput>) {
  const riskText =
    input.accountRiskStatus.toLowerCase()
  const accountRiskLevel: AccountRiskLevel =
    riskText.includes("suspend") ||
    riskText.includes("restriction") ||
    riskText.includes("blocked") ||
    riskText.includes("verification_required")
      ? "HIGH"
      : riskText === "confirmed" || riskText === "low"
        ? "LOW"
        : "UNKNOWN"

  return {
    accountRiskLevel,
    blockers:
      [
        accountRiskLevel === "HIGH" ? "Resolve account suspension, verification, or selling restriction before listing work" : "",
      ].filter(Boolean),
    warnings:
      [
        accountRiskLevel === "UNKNOWN" ? "Seller Hub account risk still needs manual confirmation" : "",
        input.sellerAccountTypeCurrent === "PERSONAL" ? `Personal account is temporary; business conversion is planned in about ${input.plannedBusinessConversionWindowDays} days` : "",
      ].filter(Boolean),
  }
}

export function buildEbaySellerHubFixRouteRecommendation(values: {
  accountRiskLevel: AccountRiskLevel
  policyFixesRequiredCount: number
  manualSellerHubChecksRequiredCount: number
  inventoryLocationMissing: boolean
  endpointScopeGapsCount: number
  manualPoliciesConfirmed: boolean
  manualSellerHubChecksConfirmed: boolean
}): RouteRecommendation {
  if (values.accountRiskLevel === "HIGH") {
    return "EBAY-RESUME-HOLD"
  }

  if (
    values.policyFixesRequiredCount > 0 ||
    values.manualSellerHubChecksRequiredCount > 0 ||
    values.inventoryLocationMissing
  ) {
    return "NEED_SELLER_HUB_FIXES"
  }

  if (values.endpointScopeGapsCount > 0) {
    return "EBAY-RESUME-A3-RUN"
  }

  if (values.manualPoliciesConfirmed && values.manualSellerHubChecksConfirmed) {
    return "EBAY-RESUME-C"
  }

  return "NEED_SELLER_HUB_FIXES"
}

function buildLowRiskFirstListingRecommendation() {
  return {
    listingFormat:
      "Buy It Now",
    initialQuantity:
      1,
    dailyListingLimitRecommendation:
      "1-3 listings per day maximum for the first phase",
    categoryStrategy:
      "Use low-risk categories only",
    avoidProductTypes:
      [
        "supplements",
        "medical claims",
        "batteries",
        "aerosols",
        "perfumes",
        "restricted brands",
        "complex electronics",
        "VERO/IP risk products",
      ],
  }
}

function buildFixPlanScore(values: {
  policyFixesRequiredCount: number
  manualSellerHubChecksRequiredCount: number
  endpointScopeGapsCount: number
  inventoryLocationMissing: boolean
  accountRiskLevel: AccountRiskLevel
}) {
  const score =
    100 -
    values.policyFixesRequiredCount * 18 -
    values.manualSellerHubChecksRequiredCount * 6 -
    values.endpointScopeGapsCount * 5 -
    (values.inventoryLocationMissing ? 15 : 0) -
    (values.accountRiskLevel === "HIGH" ? 50 : 0) -
    (values.accountRiskLevel === "UNKNOWN" ? 10 : 0)

  return clampScore(score)
}

export function buildEbaySellerHubMissingDataFixPlanReport(
  entry: FixPlanInput = {},
  fixture?: FixtureLike | null,
) {
  const input =
    buildEbaySellerHubMissingDataFixPlanInput(entry, fixture)
  const policyPlan =
    buildEbayPolicyFixPlan(input)
  const inventoryLocationPlan =
    buildEbayInventoryLocationRecommendation(input)
  const manualPlan =
    buildEbayManualSellerHubChecklistPlan(input)
  const endpointScopeGap =
    buildEbayEndpointScopeGapAssessment(input)
  const risk =
    buildEbaySellerHubRiskAssessment(input)
  const inventoryLocationMissing =
    inventoryLocationPlan.missing
  const blockers =
    unique([
      ...risk.blockers,
      policyPlan.policyFixesRequiredCount > 0 ? "Business policies are missing or not confirmed" : "",
      inventoryLocationMissing ? "Inventory location/item location is missing or not confirmed" : "",
      manualPlan.paymentsPayoutsNeedsManualCheck ? "Payments and payouts require manual confirmation before publishing" : "",
    ])
  const warnings =
    unique([
      ...risk.warnings,
      endpointScopeGap.endpointScopeGapsCount > 0 ? "Some read-only endpoints returned unavailable_or_scope_missing or zero count; verify scopes and Seller Hub manually" : "",
      "Use conservative seller settings for a new account",
      "Do not list sensitive or restricted products during the first phase",
    ])
  const nextRecommendedRoute =
    buildEbaySellerHubFixRouteRecommendation({
      accountRiskLevel: risk.accountRiskLevel,
      policyFixesRequiredCount: policyPlan.policyFixesRequiredCount,
      manualSellerHubChecksRequiredCount: manualPlan.manualSellerHubChecksRequiredCount,
      inventoryLocationMissing,
      endpointScopeGapsCount: endpointScopeGap.endpointScopeGapsCount,
      manualPoliciesConfirmed: input.manualPoliciesConfirmed,
      manualSellerHubChecksConfirmed: input.manualSellerHubChecksConfirmed,
    })
  const fixPlanScore =
    buildFixPlanScore({
      policyFixesRequiredCount: policyPlan.policyFixesRequiredCount,
      manualSellerHubChecksRequiredCount: manualPlan.manualSellerHubChecksRequiredCount,
      endpointScopeGapsCount: endpointScopeGap.endpointScopeGapsCount,
      inventoryLocationMissing,
      accountRiskLevel: risk.accountRiskLevel,
    })

  return {
    fixPlanVersion:
      EBAY_SELLER_HUB_MISSING_DATA_FIX_PLAN_VERSION,
    sourceDataClass,
    fixPlanBuilt:
      true,
    fixPlanScore,
    oauthAuthorizationSucceededFromA3:
      input.oauthAuthorizationSucceeded,
    policyFixesRequiredCount:
      policyPlan.policyFixesRequiredCount,
    manualSellerHubChecksRequiredCount:
      manualPlan.manualSellerHubChecksRequiredCount,
    endpointScopeGapsCount:
      endpointScopeGap.endpointScopeGapsCount,
    fulfillmentPolicyPlan:
      policyPlan.fulfillmentPolicyMissing ? buildEbayFulfillmentPolicyRecommendation() : null,
    returnPolicyPlan:
      policyPlan.returnPolicyMissing ? buildEbayReturnPolicyRecommendation() : null,
    paymentPolicyPlan:
      policyPlan.paymentPolicyMissing ? buildEbayPaymentPolicyRecommendation() : null,
    inventoryLocationPlan,
    manualSellerHubChecklist:
      manualPlan.manualSellerHubChecklist,
    endpointScopeGapAssessment:
      endpointScopeGap.endpointScopeGapAssessment,
    lowRiskFirstListingRecommendation:
      buildLowRiskFirstListingRecommendation(),
    accountRiskLevel:
      risk.accountRiskLevel,
    blockers,
    warnings,
    canProceedToSandboxDraft:
      false,
    canProceedToManualListingPrep:
      false,
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
    fulfillmentPolicyMissing:
      policyPlan.fulfillmentPolicyMissing,
    returnPolicyMissing:
      policyPlan.returnPolicyMissing,
    paymentPolicyMissing:
      policyPlan.paymentPolicyMissing,
    inventoryLocationMissing,
    accountAlertsNeedManualCheck:
      manualPlan.accountAlertsNeedManualCheck,
    identityVerificationNeedsManualCheck:
      manualPlan.identityVerificationNeedsManualCheck,
    paymentsPayoutsNeedsManualCheck:
      manualPlan.paymentsPayoutsNeedsManualCheck,
    sellerLimitsNeedManualCheck:
      manualPlan.sellerLimitsNeedManualCheck,
    businessConversionNeedsManualCheck:
      manualPlan.businessConversionNeedsManualCheck,
  }
}

export function summarizeEbaySellerHubMissingDataFixPlan(report: ReturnType<typeof buildEbaySellerHubMissingDataFixPlanReport>) {
  return {
    fixPlanBuilt:
      report.fixPlanBuilt,
    fixPlanScore:
      report.fixPlanScore,
    oauthAuthorizationSucceededFromA3:
      report.oauthAuthorizationSucceededFromA3,
    policyFixesRequiredCount:
      report.policyFixesRequiredCount,
    manualSellerHubChecksRequiredCount:
      report.manualSellerHubChecksRequiredCount,
    endpointScopeGapsCount:
      report.endpointScopeGapsCount,
    fulfillmentPolicyMissing:
      report.fulfillmentPolicyMissing,
    returnPolicyMissing:
      report.returnPolicyMissing,
    paymentPolicyMissing:
      report.paymentPolicyMissing,
    inventoryLocationMissing:
      report.inventoryLocationMissing,
    accountAlertsNeedManualCheck:
      report.accountAlertsNeedManualCheck,
    identityVerificationNeedsManualCheck:
      report.identityVerificationNeedsManualCheck,
    paymentsPayoutsNeedsManualCheck:
      report.paymentsPayoutsNeedsManualCheck,
    sellerLimitsNeedManualCheck:
      report.sellerLimitsNeedManualCheck,
    businessConversionNeedsManualCheck:
      report.businessConversionNeedsManualCheck,
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

export function getEbaySellerHubMissingDataFixChecklist() {
  return [
    "Create or confirm fulfillment/shipping policy in Seller Hub",
    "Create or confirm return policy in Seller Hub",
    "Create or confirm payment policy in Seller Hub",
    "Confirm item location or inventory location",
    "Review Seller Hub alerts",
    "Confirm identity verification",
    "Confirm payments and payouts",
    "Review seller limits",
    "Review eBay messages",
    "Confirm personal-to-business conversion status",
    "Re-run A3 read-only OAuth audit after fixes",
  ]
}

export function buildEbaySellerHubMissingDataFixPlanFromFixture(fixture: FixtureLike) {
  return buildEbaySellerHubMissingDataFixPlanReport(
    fixture.a3SanitizedAuditResult ?? {},
    fixture,
  )
}
