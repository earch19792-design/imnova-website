export const AMAZON_RESTRICTION_CATEGORY_BRAND_GTIN_GATE_VERSION =
  "AMAZON_RESTRICTION_CATEGORY_BRAND_GTIN_GATE_V1"

const sourceDataClass =
  "LOOP_149D_AMAZON_RESTRICTION_CATEGORY_BRAND_GTIN_GATE"

type RiskLevel =
  | "LOW"
  | "MEDIUM"
  | "HIGH"

type TriState =
  | true
  | false
  | "unknown"

type RestrictionDecision =
  | "SAFE_TO_CONTINUE_TO_FEES_ROI"
  | "CONTINUE_RESEARCH_ONLY"
  | "NEED_SELLER_CENTRAL_MANUAL_CHECK"
  | "NEED_CATEGORY_APPROVAL"
  | "NEED_BRAND_APPROVAL"
  | "NEED_SUPPLIER_INVOICE"
  | "NEED_GTIN_OR_EXEMPTION"
  | "NEED_HAZMAT_REVIEW"
  | "NEED_CHEMICAL_COMPLIANCE_REVIEW"
  | "NEED_ELECTRICAL_COMPLIANCE_REVIEW"
  | "WATCHLIST"
  | "REJECT_FOR_NOW"
  | "DO_NOT_LIST_YET"

type RestrictionGateEntry = {
  supplierSku?: string | null
  productTitle?: string | null
  brand?: string | null
  asinStrategyRecommendation?: string | null
  catalogMatchType?: string | null
  matchConfidenceScore?: number | null
  productType?: string | null
  possibleAmazonCategory?: string | null
  wrongAsinRisk?: string | null
  duplicateAsinRisk?: string | null
  missingUpcGtin?: boolean | null
  hasSupplierInvoice?: boolean | null
  brandAuthorizationStatus?: string | null
  categoryApprovalLikelyRequired?: TriState | null
  brandApprovalLikelyRequired?: TriState | null
  invoiceLikelyRequired?: TriState | null
  gtinOrExemptionRequired?: TriState | null
  hazmatReviewRequired?: TriState | null
  chemicalComplianceReviewRequired?: TriState | null
  electricalSafetyReviewRequired?: TriState | null
  claimsRiskPresent?: boolean | null
  ipRiskPresent?: boolean | null
  sellerCentralManualCheckRequired?: boolean | null
  categoryRestrictionRisk?: string | null
  notes?: string[] | null
}

type RestrictionGateFixture = {
  catalogMatches?: RestrictionGateEntry[] | null
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback
}

function normalizeBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean"
    ? value
    : fallback
}

function normalizeArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

function normalizeRisk(value: unknown, fallback: RiskLevel = "MEDIUM"): RiskLevel {
  const text =
    normalizeText(value)?.toUpperCase()

  return text === "LOW" || text === "MEDIUM" || text === "HIGH"
    ? text
    : fallback
}

function normalizeTriState(value: unknown): TriState {
  if (value === true || value === false) {
    return value
  }

  return "unknown"
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function average(values: number[]) {
  return values.length > 0
    ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2))
    : 0
}

function riskToScore(risk: RiskLevel) {
  return risk === "LOW" ? 20 : risk === "MEDIUM" ? 55 : 90
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function textIncludesAny(value: string, keywords: string[]) {
  const lowered =
    value.toLowerCase()

  return keywords.some(keyword => lowered.includes(keyword))
}

export function buildAmazonRestrictionGateInput(entry: RestrictionGateEntry) {
  return {
    restrictionGateVersion:
      AMAZON_RESTRICTION_CATEGORY_BRAND_GTIN_GATE_VERSION,
    sourceDataClass,
    supplierSku:
      normalizeText(entry.supplierSku) ?? "unknown-supplier-sku",
    productTitle:
      normalizeText(entry.productTitle) ?? "Untitled Amazon restriction candidate",
    brand:
      normalizeText(entry.brand) ?? "unbranded",
    asinStrategyRecommendation:
      normalizeText(entry.asinStrategyRecommendation) ?? "NEED_MORE_PRODUCT_DATA",
    catalogMatchType:
      normalizeText(entry.catalogMatchType) ?? "NO_MATCH",
    matchConfidenceScore:
      clampScore(normalizeNumber(entry.matchConfidenceScore, 0)),
    productType:
      normalizeText(entry.productType) ?? "unknown",
    possibleAmazonCategory:
      normalizeText(entry.possibleAmazonCategory) ?? "unknown",
    wrongAsinRisk:
      normalizeRisk(entry.wrongAsinRisk, "LOW"),
    duplicateAsinRisk:
      normalizeRisk(entry.duplicateAsinRisk, "MEDIUM"),
    missingUpcGtin:
      normalizeBoolean(entry.missingUpcGtin),
    hasSupplierInvoice:
      normalizeBoolean(entry.hasSupplierInvoice),
    brandAuthorizationStatus:
      normalizeText(entry.brandAuthorizationStatus) ?? "unknown",
    categoryApprovalLikelyRequired:
      normalizeTriState(entry.categoryApprovalLikelyRequired),
    brandApprovalLikelyRequired:
      normalizeTriState(entry.brandApprovalLikelyRequired),
    invoiceLikelyRequired:
      normalizeTriState(entry.invoiceLikelyRequired),
    gtinOrExemptionRequired:
      normalizeTriState(entry.gtinOrExemptionRequired),
    hazmatReviewRequired:
      normalizeTriState(entry.hazmatReviewRequired),
    chemicalComplianceReviewRequired:
      normalizeTriState(entry.chemicalComplianceReviewRequired),
    electricalSafetyReviewRequired:
      normalizeTriState(entry.electricalSafetyReviewRequired),
    claimsRiskPresent:
      normalizeBoolean(entry.claimsRiskPresent),
    ipRiskPresent:
      normalizeBoolean(entry.ipRiskPresent),
    sellerCentralManualCheckRequired:
      normalizeBoolean(entry.sellerCentralManualCheckRequired, true),
    categoryRestrictionRisk:
      normalizeRisk(entry.categoryRestrictionRisk, "MEDIUM"),
    notes:
      normalizeArray(entry.notes),
  }
}

export function buildAmazonCategoryRestrictionSignal(input: ReturnType<typeof buildAmazonRestrictionGateInput>) {
  const risk =
    input.categoryApprovalLikelyRequired === true
      ? "HIGH"
      : input.categoryApprovalLikelyRequired === "unknown"
        ? "MEDIUM"
        : input.categoryRestrictionRisk

  return {
    categoryRestrictionRisk:
      normalizeRisk(risk),
    categoryApprovalLikelyRequired:
      input.categoryApprovalLikelyRequired,
  }
}

export function buildAmazonBrandRestrictionSignal(input: ReturnType<typeof buildAmazonRestrictionGateInput>) {
  const requiresBrandApproval =
    input.brandApprovalLikelyRequired === true ||
    input.brandAuthorizationStatus === "unknown"
  const brandRestrictionRisk: RiskLevel =
    requiresBrandApproval ? "HIGH" : input.brandApprovalLikelyRequired === "unknown" ? "MEDIUM" : "LOW"

  return {
    brandRestrictionRisk,
    brandApprovalLikelyRequired:
      input.brandApprovalLikelyRequired,
  }
}

export function buildAmazonGtinRequirementSignal(input: ReturnType<typeof buildAmazonRestrictionGateInput>) {
  const creatingNewAsin =
    input.asinStrategyRecommendation === "CREATE_NEW_ASIN_CANDIDATE"
  const gtinOrExemptionRequired: TriState =
    input.gtinOrExemptionRequired === true || (creatingNewAsin && input.missingUpcGtin)
      ? true
      : input.missingUpcGtin
        ? "unknown"
        : input.gtinOrExemptionRequired
  const gtinRequirementRisk: RiskLevel =
    gtinOrExemptionRequired === true ? "HIGH" : gtinOrExemptionRequired === "unknown" ? "MEDIUM" : "LOW"

  return {
    gtinRequirementRisk,
    gtinOrExemptionRequired,
  }
}

export function buildAmazonInvoiceRequirementSignal(input: ReturnType<typeof buildAmazonRestrictionGateInput>) {
  const invoiceLikelyRequired: TriState =
    input.invoiceLikelyRequired === true || !input.hasSupplierInvoice
      ? true
      : input.invoiceLikelyRequired
  const invoiceRequirementRisk: RiskLevel =
    invoiceLikelyRequired === true ? "HIGH" : invoiceLikelyRequired === "unknown" ? "MEDIUM" : "LOW"

  return {
    invoiceRequirementRisk,
    invoiceLikelyRequired,
  }
}

export function buildAmazonHazmatRestrictionSignal(input: ReturnType<typeof buildAmazonRestrictionGateInput>) {
  const text =
    `${input.productTitle} ${input.productType} ${input.possibleAmazonCategory}`
  const inferredHazmat =
    textIncludesAny(text, ["aerosol", "spray paint", "paint", "chemical", "cleaner", "detergent"])
  const hazmatReviewRequired: TriState =
    input.hazmatReviewRequired === true || inferredHazmat
      ? true
      : input.hazmatReviewRequired
  const hazmatRisk: RiskLevel =
    textIncludesAny(text, ["aerosol", "spray paint", "paint"])
      ? "HIGH"
      : hazmatReviewRequired === true
        ? "MEDIUM"
        : "LOW"

  return {
    hazmatRisk,
    hazmatReviewRequired,
  }
}

export function buildAmazonChemicalComplianceSignal(input: ReturnType<typeof buildAmazonRestrictionGateInput>) {
  const text =
    `${input.productTitle} ${input.productType} ${input.possibleAmazonCategory}`
  const inferredChemical =
    textIncludesAny(text, ["cleaning", "cleaner", "chemical", "detergent", "freshener"])
  const chemicalComplianceReviewRequired: TriState =
    input.chemicalComplianceReviewRequired === true || inferredChemical
      ? true
      : input.chemicalComplianceReviewRequired
  const chemicalComplianceRisk: RiskLevel =
    chemicalComplianceReviewRequired === true ? "HIGH" : chemicalComplianceReviewRequired === "unknown" ? "MEDIUM" : "LOW"

  return {
    chemicalComplianceRisk,
    chemicalComplianceReviewRequired,
  }
}

export function buildAmazonElectricalComplianceSignal(input: ReturnType<typeof buildAmazonRestrictionGateInput>) {
  const text =
    `${input.productTitle} ${input.productType} ${input.possibleAmazonCategory}`
  const inferredElectrical =
    textIncludesAny(text, ["electrical", "outlet", "adapter", "wall tap", "power"])
  const electricalSafetyReviewRequired: TriState =
    input.electricalSafetyReviewRequired === true || inferredElectrical
      ? true
      : input.electricalSafetyReviewRequired
  const electricalComplianceRisk: RiskLevel =
    electricalSafetyReviewRequired === true ? "HIGH" : electricalSafetyReviewRequired === "unknown" ? "MEDIUM" : "LOW"

  return {
    electricalComplianceRisk,
    electricalSafetyReviewRequired,
  }
}

export function buildAmazonClaimsAndIpRiskSignal(input: ReturnType<typeof buildAmazonRestrictionGateInput>) {
  const claimsIpRisk: RiskLevel =
    input.claimsRiskPresent || input.ipRiskPresent
      ? "HIGH"
      : input.brandAuthorizationStatus === "unknown"
        ? "MEDIUM"
        : "LOW"

  return {
    claimsIpRisk,
    claimsRiskPresent:
      input.claimsRiskPresent,
    ipRiskPresent:
      input.ipRiskPresent,
  }
}

export function buildAmazonRestrictionRiskScore(signals: {
  categoryRestrictionRisk: RiskLevel
  brandRestrictionRisk: RiskLevel
  gtinRequirementRisk: RiskLevel
  invoiceRequirementRisk: RiskLevel
  hazmatRisk: RiskLevel
  chemicalComplianceRisk: RiskLevel
  electricalComplianceRisk: RiskLevel
  claimsIpRisk: RiskLevel
}) {
  return clampScore(
    riskToScore(signals.categoryRestrictionRisk) * 0.14 +
    riskToScore(signals.brandRestrictionRisk) * 0.12 +
    riskToScore(signals.gtinRequirementRisk) * 0.1 +
    riskToScore(signals.invoiceRequirementRisk) * 0.12 +
    riskToScore(signals.hazmatRisk) * 0.16 +
    riskToScore(signals.chemicalComplianceRisk) * 0.13 +
    riskToScore(signals.electricalComplianceRisk) * 0.13 +
    riskToScore(signals.claimsIpRisk) * 0.1,
  )
}

export function buildAmazonRestrictionGateDecision(
  input: ReturnType<typeof buildAmazonRestrictionGateInput>,
  signals: ReturnType<typeof buildAmazonCategoryRestrictionSignal> &
    ReturnType<typeof buildAmazonBrandRestrictionSignal> &
    ReturnType<typeof buildAmazonGtinRequirementSignal> &
    ReturnType<typeof buildAmazonInvoiceRequirementSignal> &
    ReturnType<typeof buildAmazonHazmatRestrictionSignal> &
    ReturnType<typeof buildAmazonChemicalComplianceSignal> &
    ReturnType<typeof buildAmazonElectricalComplianceSignal> &
    ReturnType<typeof buildAmazonClaimsAndIpRiskSignal> &
    { overallRestrictionRiskScore: number },
): RestrictionDecision {
  if (signals.hazmatRisk === "HIGH" && input.productType.toLowerCase().includes("aerosol")) {
    return "REJECT_FOR_NOW"
  }

  if (signals.hazmatReviewRequired === true) {
    return "NEED_HAZMAT_REVIEW"
  }

  if (signals.chemicalComplianceReviewRequired === true) {
    return "NEED_CHEMICAL_COMPLIANCE_REVIEW"
  }

  if (signals.electricalSafetyReviewRequired === true) {
    return "NEED_ELECTRICAL_COMPLIANCE_REVIEW"
  }

  if (signals.categoryApprovalLikelyRequired === true) {
    return "NEED_CATEGORY_APPROVAL"
  }

  if (signals.brandApprovalLikelyRequired === true) {
    return "NEED_BRAND_APPROVAL"
  }

  if (signals.invoiceLikelyRequired === true) {
    return "NEED_SUPPLIER_INVOICE"
  }

  if (signals.gtinOrExemptionRequired === true) {
    return "NEED_GTIN_OR_EXEMPTION"
  }

  if (input.sellerCentralManualCheckRequired) {
    return "NEED_SELLER_CENTRAL_MANUAL_CHECK"
  }

  if (signals.overallRestrictionRiskScore >= 70) {
    return "WATCHLIST"
  }

  return "SAFE_TO_CONTINUE_TO_FEES_ROI"
}

export function buildAmazonRestrictionGateAssessment(entry: RestrictionGateEntry) {
  const input =
    buildAmazonRestrictionGateInput(entry)
  const category =
    buildAmazonCategoryRestrictionSignal(input)
  const brand =
    buildAmazonBrandRestrictionSignal(input)
  const gtin =
    buildAmazonGtinRequirementSignal(input)
  const invoice =
    buildAmazonInvoiceRequirementSignal(input)
  const hazmat =
    buildAmazonHazmatRestrictionSignal(input)
  const chemical =
    buildAmazonChemicalComplianceSignal(input)
  const electrical =
    buildAmazonElectricalComplianceSignal(input)
  const claimsIp =
    buildAmazonClaimsAndIpRiskSignal(input)
  const overallRestrictionRiskScore =
    buildAmazonRestrictionRiskScore({
      ...category,
      ...brand,
      ...gtin,
      ...invoice,
      ...hazmat,
      ...chemical,
      ...electrical,
      ...claimsIp,
    })
  const signals =
    {
      ...category,
      ...brand,
      ...gtin,
      ...invoice,
      ...hazmat,
      ...chemical,
      ...electrical,
      ...claimsIp,
      overallRestrictionRiskScore,
    }
  const nextRecommendedAction =
    buildAmazonRestrictionGateDecision(input, signals)
  const highRisk =
    overallRestrictionRiskScore >= 70 ||
    hazmat.hazmatRisk === "HIGH" ||
    input.wrongAsinRisk === "HIGH" ||
    input.catalogMatchType === "CONFLICTING_MATCH"
  const sellerCentralManualCheckRequired =
    input.sellerCentralManualCheckRequired ||
    category.categoryApprovalLikelyRequired !== false ||
    brand.brandApprovalLikelyRequired !== false
  const humanReviewRequired =
    highRisk ||
    sellerCentralManualCheckRequired ||
    nextRecommendedAction !== "SAFE_TO_CONTINUE_TO_FEES_ROI"
  const canProceedToFeesRoi =
    !highRisk &&
    nextRecommendedAction !== "REJECT_FOR_NOW" &&
    nextRecommendedAction !== "DO_NOT_LIST_YET"
  const blockedReasons =
    unique([
      input.catalogMatchType === "CONFLICTING_MATCH" ? "conflicting catalog match requires human review" : "",
      input.wrongAsinRisk === "HIGH" ? "wrong ASIN risk high from catalog matcher" : "",
      category.categoryApprovalLikelyRequired === true ? "category approval likely required" : "",
      brand.brandApprovalLikelyRequired === true ? "brand approval likely required" : "",
      invoice.invoiceLikelyRequired === true ? "supplier invoice likely required" : "",
      gtin.gtinOrExemptionRequired === true ? "GTIN or exemption required" : "",
      hazmat.hazmatReviewRequired === true ? "hazmat review required" : "",
      chemical.chemicalComplianceReviewRequired === true ? "chemical compliance review required" : "",
      electrical.electricalSafetyReviewRequired === true ? "electrical safety review required" : "",
      "listing package blocked until restrictions are resolved",
    ].filter(Boolean))
  const warnings =
    unique([
      input.missingUpcGtin ? "missing UPC/GTIN" : "",
      input.asinStrategyRecommendation === "SELL_ON_EXISTING_ASIN" ? "existing ASIN match does not prove sell eligibility" : "",
      sellerCentralManualCheckRequired ? "Seller Central manual check required before listing" : "",
      claimsIp.claimsIpRisk !== "LOW" ? "claims or IP risk needs review" : "",
      ...input.notes,
    ].filter(Boolean))

  return {
    restrictionGateVersion:
      AMAZON_RESTRICTION_CATEGORY_BRAND_GTIN_GATE_VERSION,
    sourceDataClass,
    supplierSku:
      input.supplierSku,
    productTitle:
      input.productTitle,
    brand:
      input.brand,
    asinStrategyRecommendation:
      input.asinStrategyRecommendation,
    catalogMatchType:
      input.catalogMatchType,
    matchConfidenceScore:
      input.matchConfidenceScore,
    productType:
      input.productType,
    possibleAmazonCategory:
      input.possibleAmazonCategory,
    ...signals,
    sellerCentralManualCheckRequired,
    canProceedToFeesRoi,
    canProceedToListingPackage:
      false,
    canProceedToSellerCentral:
      false,
    humanReviewRequired,
    blockedReasons,
    warnings,
    nextRecommendedAction,
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
    scraperUsed:
      false,
  }
}

export function buildAmazonRestrictionGateQueue(fixture: RestrictionGateFixture) {
  const catalogMatches =
    fixture.catalogMatches ?? []
  const assessments =
    catalogMatches.map(buildAmazonRestrictionGateAssessment)

  return {
    restrictionGateVersion:
      AMAZON_RESTRICTION_CATEGORY_BRAND_GTIN_GATE_VERSION,
    sourceDataClass,
    inputCatalogMatches:
      catalogMatches.length,
    restrictionGateAssessmentsBuilt:
      assessments.length,
    assessments,
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
    scraperUsed:
      false,
    nextLoop:
      "149E",
  }
}

export function summarizeAmazonRestrictionGateQueue(queue: ReturnType<typeof buildAmazonRestrictionGateQueue>) {
  const assessments =
    queue.assessments

  return {
    inputCatalogMatches:
      queue.inputCatalogMatches,
    restrictionGateAssessmentsBuilt:
      queue.restrictionGateAssessmentsBuilt,
    safeToContinueToFeesRoiCandidates:
      assessments.filter(entry => entry.nextRecommendedAction === "SAFE_TO_CONTINUE_TO_FEES_ROI").length,
    continueResearchOnlyCandidates:
      assessments.filter(entry => entry.nextRecommendedAction === "CONTINUE_RESEARCH_ONLY").length,
    sellerCentralManualCheckRequiredCandidates:
      assessments.filter(entry => entry.sellerCentralManualCheckRequired).length,
    categoryApprovalLikelyRequiredCandidates:
      assessments.filter(entry => entry.categoryApprovalLikelyRequired === true).length,
    brandApprovalLikelyRequiredCandidates:
      assessments.filter(entry => entry.brandApprovalLikelyRequired === true).length,
    invoiceLikelyRequiredCandidates:
      assessments.filter(entry => entry.invoiceLikelyRequired === true).length,
    gtinOrExemptionRequiredCandidates:
      assessments.filter(entry => entry.gtinOrExemptionRequired === true || entry.gtinOrExemptionRequired === "unknown").length,
    hazmatReviewRequiredCandidates:
      assessments.filter(entry => entry.hazmatReviewRequired === true || entry.hazmatReviewRequired === "unknown").length,
    chemicalComplianceReviewRequiredCandidates:
      assessments.filter(entry => entry.chemicalComplianceReviewRequired === true || entry.chemicalComplianceReviewRequired === "unknown").length,
    electricalSafetyReviewRequiredCandidates:
      assessments.filter(entry => entry.electricalSafetyReviewRequired === true || entry.electricalSafetyReviewRequired === "unknown").length,
    highOverallRestrictionRiskCandidates:
      assessments.filter(entry => entry.overallRestrictionRiskScore >= 70).length,
    productsBlockedFromListingPackage:
      assessments.filter(entry => !entry.canProceedToListingPackage).length,
    productsAllowedToFeesRoi:
      assessments.filter(entry => entry.canProceedToFeesRoi).length,
    productsRequiringHumanReview:
      assessments.filter(entry => entry.humanReviewRequired).length,
    rejectedCandidates:
      assessments.filter(entry => entry.nextRecommendedAction === "REJECT_FOR_NOW").length,
    watchlistCandidates:
      assessments.filter(entry => entry.nextRecommendedAction === "WATCHLIST").length,
    averageOverallRestrictionRiskScore:
      average(assessments.map(entry => entry.overallRestrictionRiskScore)),
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
    scraperUsed:
      false,
    nextLoop:
      "149E",
  }
}

export function getAmazonRestrictionCategoryBrandGtinGateChecklist() {
  return [
    "Treat catalog match as research evidence only; it does not prove sell eligibility.",
    "Confirm category approval, brand approval, invoice requirements, and GTIN/exemption before listing package.",
    "Route cleaning and chemical products through compliance and hazmat review.",
    "Route electrical products through safety review.",
    "Block aerosol or paint products from listing package until hazmat status is resolved.",
    "Keep LOOP 149D local only: no Amazon connection, no Selling Partner API, no Seller Central mutation, no scraper, no publication.",
  ]
}
