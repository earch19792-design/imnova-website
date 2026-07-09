export const AMAZON_SELLER_ACCOUNT_CATEGORY_GATE_VERSION =
  "AMAZON_SELLER_ACCOUNT_SETUP_CATEGORY_GATE_V1"

const sourceDataClass =
  "LOOP_149B_AMAZON_SELLER_ACCOUNT_CATEGORY_GATE"

const maxProductCategoryGates =
  25

type ReadinessStatus =
  | "SET"
  | "MISSING"
  | "PARTIAL"
  | "UNKNOWN"

type TriState =
  | true
  | false
  | "unknown"

type CategoryRiskLevel =
  | "LOW"
  | "MEDIUM"
  | "HIGH"

type CategoryGateDecision =
  | "ACCOUNT_READY_FOR_RESEARCH_ONLY"
  | "ACCOUNT_READY_FOR_MANUAL_LISTING_PREP"
  | "ACCOUNT_BLOCKED_IDENTITY"
  | "ACCOUNT_BLOCKED_TAX_BANK"
  | "ACCOUNT_BLOCKED_MARKETPLACE_SETUP"
  | "SAFE_TO_CONTINUE_RESEARCH"
  | "NEED_SELLER_CENTRAL_CATEGORY_CHECK"
  | "NEED_CATEGORY_APPROVAL"
  | "NEED_BRAND_APPROVAL"
  | "NEED_SUPPLIER_INVOICE"
  | "NEED_GTIN_OR_EXEMPTION"
  | "NEED_HAZMAT_REVIEW"
  | "NEED_ELECTRICAL_COMPLIANCE_REVIEW"
  | "NEED_CHEMICAL_COMPLIANCE_REVIEW"
  | "DO_NOT_LIST_YET"
  | "WATCHLIST"

type SellerAccountFixture = {
  sellerAccountId?: string | null
  identityVerificationStatus?: string | null
  businessType?: string | null
  marketplaceTarget?: string | null
  professionalPlanRecommended?: boolean | null
  bankAccountStatus?: string | null
  chargeMethodStatus?: string | null
  taxInterviewStatus?: string | null
  addressStatus?: string | null
  phoneStatus?: string | null
  returnAddressStatus?: string | null
  sellerProfileStatus?: string | null
  twoStepVerificationStatus?: string | null
  accountHealthBaseline?: string | null
  apiReadinessStatus?: string | null
  documents?: {
    identityDocument?: string | null
    businessInformation?: string | null
    taxInformation?: string | null
    bankStatement?: string | null
    chargeMethod?: string | null
    addressVerification?: string | null
    returnAddress?: string | null
    phoneVerification?: string | null
    twoStepVerification?: string | null
  } | null
  missingAccountItems?: string[] | null
}

type ProductCategoryGateFixture = {
  productKey?: string | null
  productTitle?: string | null
  supplierSku?: string | null
  partNumber?: string | null
  modelNumber?: string | null
  brand?: string | null
  productType?: string | null
  possibleAmazonCategory?: string | null
  categoryRiskLevel?: string | null
  categoryApprovalLikelyRequired?: TriState | null
  brandApprovalLikelyRequired?: TriState | null
  invoiceLikelyRequired?: TriState | null
  gtinOrExemptionRequired?: TriState | null
  hazmatReviewRequired?: TriState | null
  electricalSafetyReviewRequired?: TriState | null
  chemicalComplianceReviewRequired?: TriState | null
  expirationOrLotTrackingRequired?: TriState | null
  sellerCentralCategoryCheckCompleted?: boolean | null
  humanCategoryReviewCompleted?: boolean | null
  knownApprovedCategory?: boolean | null
  missingData?: string[] | null
}

type CategoryGateOptions = {
  maxProductCategoryGates?: number | null
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
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

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function average(values: number[]) {
  return values.length > 0
    ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2))
    : 0
}

function normalizeStatus(value: unknown): ReadinessStatus {
  const text =
    normalizeText(value)?.toUpperCase()

  return text === "SET" || text === "MISSING" || text === "PARTIAL" || text === "UNKNOWN"
    ? text
    : "UNKNOWN"
}

function statusScore(status: ReadinessStatus) {
  if (status === "SET") {
    return 100
  }

  if (status === "PARTIAL") {
    return 55
  }

  if (status === "MISSING") {
    return 0
  }

  return 25
}

function normalizeTriState(value: unknown): TriState {
  if (value === true || value === false) {
    return value
  }

  return "unknown"
}

function normalizeRiskLevel(value: unknown): CategoryRiskLevel {
  const text =
    normalizeText(value)?.toUpperCase()

  return text === "LOW" || text === "MEDIUM" || text === "HIGH"
    ? text
    : "MEDIUM"
}

function riskScore(level: CategoryRiskLevel) {
  if (level === "LOW") {
    return 25
  }

  if (level === "MEDIUM") {
    return 60
  }

  return 90
}

function isSet(status: ReadinessStatus) {
  return status === "SET"
}

function isIncomplete(status: ReadinessStatus) {
  return status === "MISSING" || status === "UNKNOWN"
}

function triStateRequiresReview(value: TriState) {
  return value === true || value === "unknown"
}

function unique(values: string[]) {
  return [...new Set(values)]
}

export function buildAmazonSellerAccountInput(
  sellerAccount: SellerAccountFixture,
  options: CategoryGateOptions = {},
) {
  void options

  const documents =
    sellerAccount.documents ?? {}

  return {
    sellerAccountGateVersion:
      AMAZON_SELLER_ACCOUNT_CATEGORY_GATE_VERSION,
    sourceDataClass,
    sellerAccountId:
      normalizeText(sellerAccount.sellerAccountId) ?? "sanitized-amazon-seller-account",
    identityVerificationStatus:
      normalizeStatus(sellerAccount.identityVerificationStatus),
    businessType:
      normalizeText(sellerAccount.businessType) ?? "unknown",
    marketplaceTarget:
      normalizeText(sellerAccount.marketplaceTarget) ?? "US",
    professionalPlanRecommended:
      normalizeBoolean(sellerAccount.professionalPlanRecommended, true),
    bankAccountStatus:
      normalizeStatus(sellerAccount.bankAccountStatus),
    chargeMethodStatus:
      normalizeStatus(sellerAccount.chargeMethodStatus),
    taxInterviewStatus:
      normalizeStatus(sellerAccount.taxInterviewStatus),
    addressStatus:
      normalizeStatus(sellerAccount.addressStatus),
    phoneStatus:
      normalizeStatus(sellerAccount.phoneStatus),
    returnAddressStatus:
      normalizeStatus(sellerAccount.returnAddressStatus),
    sellerProfileStatus:
      normalizeStatus(sellerAccount.sellerProfileStatus),
    twoStepVerificationStatus:
      normalizeStatus(sellerAccount.twoStepVerificationStatus),
    accountHealthBaseline:
      normalizeStatus(sellerAccount.accountHealthBaseline),
    apiReadinessStatus:
      normalizeStatus(sellerAccount.apiReadinessStatus),
    documents:
      {
        identityDocument:
          normalizeStatus(documents.identityDocument),
        businessInformation:
          normalizeStatus(documents.businessInformation),
        taxInformation:
          normalizeStatus(documents.taxInformation),
        bankStatement:
          normalizeStatus(documents.bankStatement),
        chargeMethod:
          normalizeStatus(documents.chargeMethod),
        addressVerification:
          normalizeStatus(documents.addressVerification),
        returnAddress:
          normalizeStatus(documents.returnAddress),
        phoneVerification:
          normalizeStatus(documents.phoneVerification),
        twoStepVerification:
          normalizeStatus(documents.twoStepVerification),
      },
    missingAccountItems:
      normalizeArray(sellerAccount.missingAccountItems),
  }
}

export function buildAmazonIdentityReadiness(input: ReturnType<typeof buildAmazonSellerAccountInput>) {
  const identityScore =
    average([
      statusScore(input.identityVerificationStatus),
      statusScore(input.addressStatus),
      statusScore(input.phoneStatus),
      statusScore(input.twoStepVerificationStatus),
      statusScore(input.documents.identityDocument),
      statusScore(input.documents.addressVerification),
      statusScore(input.documents.phoneVerification),
      statusScore(input.documents.twoStepVerification),
    ])
  const blockers =
    [
      isIncomplete(input.identityVerificationStatus) ? "identity verification incomplete" : null,
      isIncomplete(input.addressStatus) ? "address verification incomplete" : null,
      isIncomplete(input.phoneStatus) ? "phone verification incomplete" : null,
      isIncomplete(input.twoStepVerificationStatus) ? "two step verification incomplete" : null,
    ].filter((entry): entry is string => entry !== null)

  return {
    identityReadinessScore:
      clampScore(identityScore),
    identityBlockers:
      blockers,
  }
}

export function buildAmazonBusinessReadiness(input: ReturnType<typeof buildAmazonSellerAccountInput>) {
  const businessTypeReady =
    input.businessType !== "unknown"
  const score =
    average([
      businessTypeReady ? 100 : 25,
      statusScore(input.sellerProfileStatus),
      statusScore(input.returnAddressStatus),
      statusScore(input.documents.businessInformation),
      statusScore(input.documents.returnAddress),
    ])

  return {
    businessReadinessScore:
      clampScore(score),
    businessWarnings:
      [
        businessTypeReady ? null : "business type needs confirmation",
        isIncomplete(input.sellerProfileStatus) ? "seller profile incomplete" : null,
        isIncomplete(input.returnAddressStatus) ? "return address incomplete" : null,
      ].filter((entry): entry is string => entry !== null),
  }
}

export function buildAmazonTaxAndBankReadiness(input: ReturnType<typeof buildAmazonSellerAccountInput>) {
  const score =
    average([
      statusScore(input.bankAccountStatus),
      statusScore(input.chargeMethodStatus),
      statusScore(input.taxInterviewStatus),
      statusScore(input.documents.bankStatement),
      statusScore(input.documents.chargeMethod),
      statusScore(input.documents.taxInformation),
    ])
  const blockers =
    [
      isIncomplete(input.bankAccountStatus) ? "bank account incomplete" : null,
      isIncomplete(input.chargeMethodStatus) ? "charge method incomplete" : null,
      isIncomplete(input.taxInterviewStatus) ? "tax interview incomplete" : null,
    ].filter((entry): entry is string => entry !== null)

  return {
    taxAndBankReadinessScore:
      clampScore(score),
    taxBankBlockers:
      blockers,
  }
}

export function buildAmazonMarketplaceReadiness(input: ReturnType<typeof buildAmazonSellerAccountInput>) {
  const marketplaceReady =
    input.marketplaceTarget === "US" || input.marketplaceTarget === "USA"
  const score =
    clampScore(
      (marketplaceReady ? 80 : 25) +
      (input.professionalPlanRecommended ? 10 : 0) +
      (isSet(input.accountHealthBaseline) ? 10 : 0),
    )

  return {
    marketplaceReadinessScore:
      score,
    marketplaceTarget:
      input.marketplaceTarget,
    marketplaceBlockers:
      marketplaceReady ? [] : ["marketplace target not confirmed for USA"],
    marketplaceWarnings:
      [
        input.professionalPlanRecommended ? null : "professional plan should be evaluated for repeat selling",
        isIncomplete(input.accountHealthBaseline) ? "account health baseline not established" : null,
      ].filter((entry): entry is string => entry !== null),
  }
}

export function buildAmazonFulfillmentReadiness(input: ReturnType<typeof buildAmazonSellerAccountInput>) {
  const score =
    average([
      statusScore(input.returnAddressStatus),
      statusScore(input.addressStatus),
      statusScore(input.sellerProfileStatus),
    ])

  return {
    fulfillmentReadinessScore:
      clampScore(score),
    fulfillmentWarnings:
      [
        isIncomplete(input.returnAddressStatus) ? "return address required before live selling" : null,
        isIncomplete(input.addressStatus) ? "ship-from address should be confirmed" : null,
      ].filter((entry): entry is string => entry !== null),
  }
}

export function buildAmazonSellerPolicyReadiness(input: ReturnType<typeof buildAmazonSellerAccountInput>) {
  const score =
    average([
      statusScore(input.accountHealthBaseline),
      statusScore(input.sellerProfileStatus),
      statusScore(input.apiReadinessStatus),
    ])

  return {
    sellerPolicyReadinessScore:
      clampScore(score),
    sellerPolicyWarnings:
      [
        isIncomplete(input.accountHealthBaseline) ? "account health baseline must be reviewed manually" : null,
        input.apiReadinessStatus !== "MISSING" ? "API readiness is informational only in this loop" : null,
      ].filter((entry): entry is string => entry !== null),
  }
}

export function buildAmazonSellerAccountReadiness(sellerAccount: SellerAccountFixture) {
  const input =
    buildAmazonSellerAccountInput(sellerAccount)
  const identity =
    buildAmazonIdentityReadiness(input)
  const business =
    buildAmazonBusinessReadiness(input)
  const taxBank =
    buildAmazonTaxAndBankReadiness(input)
  const marketplace =
    buildAmazonMarketplaceReadiness(input)
  const fulfillment =
    buildAmazonFulfillmentReadiness(input)
  const policy =
    buildAmazonSellerPolicyReadiness(input)
  const documentReadinessScore =
    clampScore(
      average(Object.values(input.documents).map(status => statusScore(status))),
    )
  const accountBlockers =
    unique([
      ...identity.identityBlockers,
      ...taxBank.taxBankBlockers,
      ...marketplace.marketplaceBlockers,
      ...input.missingAccountItems.map(item => `missing account item: ${item}`),
    ])
  const accountWarnings =
    unique([
      ...business.businessWarnings,
      ...marketplace.marketplaceWarnings,
      ...fulfillment.fulfillmentWarnings,
      ...policy.sellerPolicyWarnings,
    ])
  const accountReadinessScore =
    clampScore(
      average([
        identity.identityReadinessScore,
        business.businessReadinessScore,
        taxBank.taxAndBankReadinessScore,
        marketplace.marketplaceReadinessScore,
        fulfillment.fulfillmentReadinessScore,
        policy.sellerPolicyReadinessScore,
        documentReadinessScore,
      ]) - accountBlockers.length * 5,
    )
  const decision: CategoryGateDecision =
    identity.identityBlockers.length > 0
      ? "ACCOUNT_BLOCKED_IDENTITY"
      : taxBank.taxBankBlockers.length > 0
        ? "ACCOUNT_BLOCKED_TAX_BANK"
        : marketplace.marketplaceBlockers.length > 0
          ? "ACCOUNT_BLOCKED_MARKETPLACE_SETUP"
          : accountReadinessScore >= 85
            ? "ACCOUNT_READY_FOR_MANUAL_LISTING_PREP"
            : "ACCOUNT_READY_FOR_RESEARCH_ONLY"

  return {
    sellerAccountGateVersion:
      AMAZON_SELLER_ACCOUNT_CATEGORY_GATE_VERSION,
    sourceDataClass,
    input,
    ...identity,
    ...business,
    ...taxBank,
    ...marketplace,
    ...fulfillment,
    ...policy,
    documentReadinessScore,
    accountReadinessScore,
    missingAccountItems:
      input.missingAccountItems,
    accountBlockers,
    accountWarnings,
    decision,
    accountReadyForResearch:
      accountReadinessScore >= 50 && identity.identityBlockers.length === 0,
    accountReadyForManualListingPrep:
      decision === "ACCOUNT_READY_FOR_MANUAL_LISTING_PREP",
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
  }
}

export function buildAmazonCategoryGateInput(
  product: ProductCategoryGateFixture,
  options: CategoryGateOptions = {},
) {
  void options

  return {
    sellerAccountGateVersion:
      AMAZON_SELLER_ACCOUNT_CATEGORY_GATE_VERSION,
    sourceDataClass,
    productKey:
      normalizeText(product.productKey) ?? "unknown-amazon-product",
    productTitle:
      normalizeText(product.productTitle) ?? "Untitled Amazon product",
    supplierSku:
      normalizeText(product.supplierSku),
    partNumber:
      normalizeText(product.partNumber),
    modelNumber:
      normalizeText(product.modelNumber),
    brand:
      normalizeText(product.brand) ?? "unbranded",
    productType:
      normalizeText(product.productType) ?? "unknown",
    possibleAmazonCategory:
      normalizeText(product.possibleAmazonCategory) ?? "unknown",
    categoryRiskLevel:
      normalizeRiskLevel(product.categoryRiskLevel),
    categoryApprovalLikelyRequired:
      normalizeTriState(product.categoryApprovalLikelyRequired),
    brandApprovalLikelyRequired:
      normalizeTriState(product.brandApprovalLikelyRequired),
    invoiceLikelyRequired:
      normalizeTriState(product.invoiceLikelyRequired),
    gtinOrExemptionRequired:
      normalizeTriState(product.gtinOrExemptionRequired),
    hazmatReviewRequired:
      normalizeTriState(product.hazmatReviewRequired),
    electricalSafetyReviewRequired:
      normalizeTriState(product.electricalSafetyReviewRequired),
    chemicalComplianceReviewRequired:
      normalizeTriState(product.chemicalComplianceReviewRequired),
    expirationOrLotTrackingRequired:
      normalizeTriState(product.expirationOrLotTrackingRequired),
    sellerCentralCategoryCheckCompleted:
      normalizeBoolean(product.sellerCentralCategoryCheckCompleted),
    humanCategoryReviewCompleted:
      normalizeBoolean(product.humanCategoryReviewCompleted),
    knownApprovedCategory:
      normalizeBoolean(product.knownApprovedCategory),
    missingData:
      normalizeArray(product.missingData),
  }
}

export function buildAmazonCategoryRiskAssessment(input: ReturnType<typeof buildAmazonCategoryGateInput>) {
  const typeText =
    `${input.productType} ${input.possibleAmazonCategory}`.toLowerCase()
  const cleaningSignal =
    typeText.includes("clean") || typeText.includes("chemical")
  const electricalSignal =
    typeText.includes("electrical") || typeText.includes("lighting") || typeText.includes("lamp")
  const categoryRiskScore =
    clampScore(
      riskScore(input.categoryRiskLevel) +
      (triStateRequiresReview(input.categoryApprovalLikelyRequired) ? 12 : 0) +
      (triStateRequiresReview(input.brandApprovalLikelyRequired) ? 10 : 0) +
      (triStateRequiresReview(input.invoiceLikelyRequired) ? 8 : 0) +
      (triStateRequiresReview(input.gtinOrExemptionRequired) ? 8 : 0) +
      (triStateRequiresReview(input.hazmatReviewRequired) ? 12 : 0) +
      (triStateRequiresReview(input.electricalSafetyReviewRequired) ? 10 : 0) +
      (triStateRequiresReview(input.chemicalComplianceReviewRequired) ? 10 : 0) +
      input.missingData.length * 5,
    )
  const categoryApprovedBySellerCentralOrHuman =
    input.knownApprovedCategory &&
    (input.sellerCentralCategoryCheckCompleted || input.humanCategoryReviewCompleted)

  return {
    categoryRiskScore,
    cleaningSignal,
    electricalSignal,
    categoryApprovedBySellerCentralOrHuman,
    cannotClaimRealCategoryApproval:
      !categoryApprovedBySellerCentralOrHuman,
  }
}

export function buildAmazonProductCategoryGate(
  product: ProductCategoryGateFixture,
  accountReadiness: ReturnType<typeof buildAmazonSellerAccountReadiness>,
  options: CategoryGateOptions = {},
) {
  const input =
    buildAmazonCategoryGateInput(product, options)
  const risk =
    buildAmazonCategoryRiskAssessment(input)
  const blockedReasons =
    unique([
      accountReadiness.accountReadyForManualListingPrep ? "" : "seller account not ready for listing prep",
      input.categoryApprovalLikelyRequired === true ? "category approval likely required" : "",
      input.brandApprovalLikelyRequired === true ? "brand approval likely required" : "",
      input.invoiceLikelyRequired === true ? "supplier invoice likely required" : "",
      input.gtinOrExemptionRequired === true ? "GTIN or exemption required" : "",
      input.hazmatReviewRequired === true ? "hazmat review required" : "",
      input.electricalSafetyReviewRequired === true ? "electrical safety review required" : "",
      input.chemicalComplianceReviewRequired === true ? "chemical compliance review required" : "",
      risk.cleaningSignal && triStateRequiresReview(input.chemicalComplianceReviewRequired) ? "cleaning chemical compliance not cleared" : "",
      risk.electricalSignal && triStateRequiresReview(input.electricalSafetyReviewRequired) ? "electrical compliance not cleared" : "",
      risk.cannotClaimRealCategoryApproval ? "category not approved by Seller Central or human review" : "",
    ].filter(Boolean))
  const warnings =
    unique([
      ...input.missingData.map(item => `missing product data: ${item}`),
      input.categoryApprovalLikelyRequired === "unknown" ? "category approval requirement unknown" : "",
      input.brandApprovalLikelyRequired === "unknown" ? "brand approval requirement unknown" : "",
      input.invoiceLikelyRequired === "unknown" ? "invoice requirement unknown" : "",
      input.gtinOrExemptionRequired === "unknown" ? "GTIN or exemption requirement unknown" : "",
      input.expirationOrLotTrackingRequired === true ? "expiration or lot tracking may be required" : "",
    ].filter(Boolean))
  const humanReviewRequired =
    input.categoryRiskLevel !== "LOW" ||
    warnings.length > 0 ||
    blockedReasons.length > 0 ||
    risk.cleaningSignal ||
    risk.electricalSignal
  const canProceedToCatalogMatcher =
    accountReadiness.accountReadyForResearch &&
    risk.categoryRiskScore < 95 &&
    input.categoryRiskLevel !== "HIGH"
  const canProceedToListingPrep =
    accountReadiness.accountReadyForManualListingPrep &&
    input.categoryRiskLevel === "LOW" &&
    risk.categoryApprovedBySellerCentralOrHuman &&
    blockedReasons.length === 0
  const nextRecommendedAction: CategoryGateDecision =
    input.hazmatReviewRequired === true || (risk.cleaningSignal && triStateRequiresReview(input.hazmatReviewRequired))
      ? "NEED_HAZMAT_REVIEW"
      : input.chemicalComplianceReviewRequired === true || (risk.cleaningSignal && triStateRequiresReview(input.chemicalComplianceReviewRequired))
        ? "NEED_CHEMICAL_COMPLIANCE_REVIEW"
        : input.electricalSafetyReviewRequired === true || (risk.electricalSignal && triStateRequiresReview(input.electricalSafetyReviewRequired))
          ? "NEED_ELECTRICAL_COMPLIANCE_REVIEW"
          : input.categoryApprovalLikelyRequired === true
            ? "NEED_CATEGORY_APPROVAL"
            : input.brandApprovalLikelyRequired === true
              ? "NEED_BRAND_APPROVAL"
              : input.invoiceLikelyRequired === true
                ? "NEED_SUPPLIER_INVOICE"
                : triStateRequiresReview(input.gtinOrExemptionRequired)
                  ? "NEED_GTIN_OR_EXEMPTION"
                  : risk.cannotClaimRealCategoryApproval
                    ? "NEED_SELLER_CENTRAL_CATEGORY_CHECK"
                    : canProceedToListingPrep
                      ? "ACCOUNT_READY_FOR_MANUAL_LISTING_PREP"
                      : canProceedToCatalogMatcher
                        ? "SAFE_TO_CONTINUE_RESEARCH"
                        : "DO_NOT_LIST_YET"
  const decision: CategoryGateDecision =
    canProceedToListingPrep
      ? "ACCOUNT_READY_FOR_MANUAL_LISTING_PREP"
      : canProceedToCatalogMatcher
        ? "SAFE_TO_CONTINUE_RESEARCH"
        : nextRecommendedAction === "NEED_SELLER_CENTRAL_CATEGORY_CHECK"
          ? "WATCHLIST"
          : "DO_NOT_LIST_YET"

  return {
    ...input,
    ...risk,
    canProceedToCatalogMatcher,
    canProceedToListingPrep,
    humanReviewRequired,
    blockedReasons,
    warnings,
    nextRecommendedAction,
    decision,
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
  }
}

export function buildAmazonSellerAccountCategoryGateReport(
  sellerAccount: SellerAccountFixture,
  products: ProductCategoryGateFixture[],
  options: CategoryGateOptions = {},
) {
  const accountReadiness =
    buildAmazonSellerAccountReadiness(sellerAccount)
  const productCategoryGates =
    products.map(product => buildAmazonProductCategoryGate(product, accountReadiness, options))

  return {
    sellerAccountGateVersion:
      AMAZON_SELLER_ACCOUNT_CATEGORY_GATE_VERSION,
    sourceDataClass,
    accountReadiness,
    productCategoryGates,
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    nextLoop:
      "149C",
  }
}

export function buildAmazonSellerAccountCategoryGateQueue(
  sellerAccounts: SellerAccountFixture[],
  products: ProductCategoryGateFixture[],
  options: CategoryGateOptions = {},
) {
  const productLimit =
    Math.max(1, Math.min(maxProductCategoryGates, Math.trunc(normalizeNumber(options.maxProductCategoryGates, maxProductCategoryGates))))
  const limitedProducts =
    products.slice(0, productLimit)
  const reports =
    sellerAccounts.map(sellerAccount => buildAmazonSellerAccountCategoryGateReport(sellerAccount, limitedProducts, options))

  return {
    sellerAccountGateVersion:
      AMAZON_SELLER_ACCOUNT_CATEGORY_GATE_VERSION,
    sourceDataClass,
    reports,
    sellerAccountsAssessed:
      reports.length,
    marketplaceTargetsAssessed:
      unique(reports.map(report => report.accountReadiness.marketplaceTarget)).length,
    productCategoryGatesBuilt:
      reports.reduce((total, report) => total + report.productCategoryGates.length, 0),
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    nextLoop:
      "149C",
  }
}

export function summarizeAmazonSellerAccountCategoryGate(
  queue: ReturnType<typeof buildAmazonSellerAccountCategoryGateQueue>,
) {
  const accountReadiness =
    queue.reports.map(report => report.accountReadiness)
  const productGates =
    queue.reports.flatMap(report => report.productCategoryGates)

  return {
    sellerAccountsAssessed:
      queue.sellerAccountsAssessed,
    marketplaceTargetsAssessed:
      queue.marketplaceTargetsAssessed,
    accountReadyForResearch:
      accountReadiness.filter(entry => entry.accountReadyForResearch).length,
    accountReadyForManualListingPrep:
      accountReadiness.filter(entry => entry.accountReadyForManualListingPrep).length,
    accountBlockedByIdentity:
      accountReadiness.filter(entry => entry.decision === "ACCOUNT_BLOCKED_IDENTITY").length,
    accountBlockedByTaxBank:
      accountReadiness.filter(entry => entry.decision === "ACCOUNT_BLOCKED_TAX_BANK").length,
    accountBlockedByMarketplaceSetup:
      accountReadiness.filter(entry => entry.decision === "ACCOUNT_BLOCKED_MARKETPLACE_SETUP").length,
    averageAccountReadinessScore:
      average(accountReadiness.map(entry => entry.accountReadinessScore)),
    productCategoryGatesBuilt:
      queue.productCategoryGatesBuilt,
    lowRiskCategoryCandidates:
      productGates.filter(entry => entry.categoryRiskLevel === "LOW").length,
    categoryApprovalRequiredCandidates:
      productGates.filter(entry => entry.categoryApprovalLikelyRequired === true).length,
    brandApprovalRequiredCandidates:
      productGates.filter(entry => entry.brandApprovalLikelyRequired === true).length,
    invoiceRequiredCandidates:
      productGates.filter(entry => entry.invoiceLikelyRequired === true).length,
    gtinOrExemptionRequiredCandidates:
      productGates.filter(entry => triStateRequiresReview(entry.gtinOrExemptionRequired)).length,
    hazmatReviewRequiredCandidates:
      productGates.filter(entry => triStateRequiresReview(entry.hazmatReviewRequired)).length,
    electricalReviewRequiredCandidates:
      productGates.filter(entry => triStateRequiresReview(entry.electricalSafetyReviewRequired)).length,
    chemicalReviewRequiredCandidates:
      productGates.filter(entry => triStateRequiresReview(entry.chemicalComplianceReviewRequired)).length,
    productsAllowedToContinueResearch:
      productGates.filter(entry => entry.canProceedToCatalogMatcher).length,
    productsBlockedFromListing:
      productGates.filter(entry => !entry.canProceedToListingPrep).length,
    productsRequiringHumanReview:
      productGates.filter(entry => entry.humanReviewRequired).length,
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    nextLoop:
      "149C",
  }
}

export function getAmazonSellerAccountCategoryGateChecklist() {
  return [
    "Confirm identity, address, phone, and two-step verification before any listing prep.",
    "Confirm bank account, charge method, and tax interview before any real selling workflow.",
    "Treat marketplace USA setup as a separate gate from product category eligibility.",
    "Use Seller Central or human review to confirm category restrictions; do not infer approval from Amazon search results.",
    "Send cleaning and chemical products through hazmat and chemical compliance review before listing.",
    "Send electrical products through safety and compliance review before listing.",
    "Require brand approval, invoice, GTIN, or exemption evidence before ASIN/listing decisions.",
    "Keep LOOP 149B local only: no Amazon API use, no Selling Partner API use, no Seller Central mutation, no publication, no staging mutation.",
  ]
}
