export const EBAY_LUNA_PORTEX_MATCH_ENRICHMENT_VERSION =
  "EBAY_LUNA_PORTEX_MATCH_ENRICHMENT_B2A_LUNA_MATCH_V1"

type UnknownRecord = Record<string, unknown>

type Fixture = UnknownRecord & {
  marketObservedDataFromEbay?: UnknownRecord
  packSignalsFromEbay?: UnknownRecord
  lunaPortexCandidateData?: UnknownRecord
  warehouse?: UnknownRecord
  safetyFlags?: Record<string, boolean>
}

const text = (value: unknown, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback
const number = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const bool = (value: unknown) => value === true
const strings = (value: unknown) => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
  : []
const record = (value: unknown): UnknownRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {}
const known = (value: unknown) => value !== undefined && value !== null && value !== "" && value !== "runtime_required"
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)))

export function normalizeEbayDetectedPackSizes(value: unknown) {
  const rawPackSizesDetected = Array.isArray(value)
    ? value.map((entry) => number(entry, Number.NaN)).filter(Number.isFinite)
    : []
  const invalidPackSizesRemoved = [...new Set(rawPackSizesDetected.filter((size) => !Number.isInteger(size) || size <= 0))]
  const normalizedPackSizesDetected = [...new Set(rawPackSizesDetected.filter((size) => Number.isInteger(size) && size > 0))]
  return {
    rawPackSizesDetected,
    normalizedPackSizesDetected,
    invalidPackSizesRemoved,
    noPackSignalDetected: rawPackSizesDetected.includes(0),
    dominantPackSizeCanNeverBeZero: true,
  }
}

export function buildEbayLunaPortexMatchInput(fixture: Fixture, supplierOverride?: UnknownRecord) {
  const market = fixture.marketObservedDataFromEbay ?? {}
  const packs = fixture.packSignalsFromEbay ?? {}
  const supplier = supplierOverride ?? fixture.lunaPortexCandidateData ?? {}
  const warehouse = fixture.warehouse ?? {}
  return {
    matchVersion: text(fixture.matchVersion, EBAY_LUNA_PORTEX_MATCH_ENRICHMENT_VERSION),
    status: text(fixture.status), mode: text(fixture.mode), sourceRoute: text(fixture.sourceRoute),
    storeName: text(fixture.storeName), targetMarketplace: text(fixture.targetMarketplace, "EBAY_US"),
    warehouse: {
      warehouseAlias: text(warehouse.warehouseAlias), city: text(warehouse.city), state: text(warehouse.state),
      postalCode: text(warehouse.postalCode), country: text(warehouse.country),
      fullWarehouseStreetAddressCommitted: bool(warehouse.fullWarehouseStreetAddressCommitted),
    },
    market, packs, supplier, safetyFlags: fixture.safetyFlags ?? {},
  }
}

export function buildEbayMarketObservedDataPackage(input: ReturnType<typeof buildEbayLunaPortexMatchInput>) {
  const market = input.market
  const priceRange = record(market.priceRange)
  const itemSpecifics = record(market.suggestedItemSpecifics)
  return {
    sourceMarketDataReady: number(market.comparableListingsAnalyzed) > 0 && bool(market.winningKeywordsConfirmed)
      && bool(market.priceRangeConfirmed) && bool(market.categorySignalConfirmed) && bool(market.itemSpecificsSignalConfirmed),
    comparableListingsAnalyzed: number(market.comparableListingsAnalyzed),
    marketObservedKeywords: strings(market.keywords),
    marketObservedTitleCandidate: text(market.optimizedTitleCandidate),
    marketObservedPriceRange: { min: number(priceRange.min), max: number(priceRange.max), currency: text(priceRange.currency, "USD") },
    recommendedPrice: number(market.recommendedPrice),
    marketObservedCategory: text(market.suggestedCategory),
    marketObservedItemSpecifics: itemSpecifics,
    soldDataResolved: bool(market.soldDataResolved),
    soldDataUnavailableReason: text(market.soldDataUnavailableReason),
  }
}

export function buildLunaPortexCandidateMatchQuery(input: ReturnType<typeof buildEbayLunaPortexMatchInput>) {
  const market = buildEbayMarketObservedDataPackage(input)
  return {
    productNameQuery: text(input.supplier.productNameCandidate),
    keywordQuery: market.marketObservedKeywords,
    categoryQuery: market.marketObservedCategory,
    specificsQuery: market.marketObservedItemSpecifics,
    realLunaCatalogApiUsed: bool(input.supplier.realLunaCatalogApiUsed),
  }
}

export function buildLunaPortexFuzzyMatchAssessment(input: ReturnType<typeof buildEbayLunaPortexMatchInput>) {
  const status = text(input.supplier.matchStatus, "NEEDS_LUNA_CONFIRMATION")
  const confidence = number(input.supplier.matchConfidence)
  const confirmed = status === "CONFIRMED" && confidence >= 0.8
  return { supplierConfirmedProductMatch: confirmed, supplierMatchConfidence: confidence, matchStatus: status }
}

export function buildLunaPortexSupplierConfirmedDataPackage(input: ReturnType<typeof buildEbayLunaPortexMatchInput>) {
  const supplier = input.supplier
  const match = buildLunaPortexFuzzyMatchAssessment(input)
  const availablePackSizes = Array.isArray(supplier.availablePackSizes)
    ? normalizeEbayDetectedPackSizes(supplier.availablePackSizes).normalizedPackSizesDetected : []
  return {
    ...match,
    supplierProductName: text(supplier.productNameCandidate),
    supplierSku: known(supplier.sku) ? text(supplier.sku) : null,
    supplierCost: known(supplier.cost) ? number(supplier.cost) : null,
    supplierStockAvailable: known(supplier.quantityAvailable) ? number(supplier.quantityAvailable) : null,
    supplierAvailablePackSizes: availablePackSizes,
    supplierColor: known(supplier.color) ? text(supplier.color) : null,
    supplierMaterial: known(supplier.material) ? text(supplier.material) : null,
    supplierWeight: known(supplier.weight) ? supplier.weight : null,
    supplierDimensions: known(supplier.dimensions) ? supplier.dimensions : null,
    supplierImageAvailable: supplier.imageAvailable === true,
    humanApprovalConfirmed: bool(supplier.humanApprovalConfirmed),
    accountRiskKnown: bool(supplier.accountRiskKnown),
  }
}

export function buildLunaPackAvailabilityAssessment(input: ReturnType<typeof buildEbayLunaPortexMatchInput>) {
  const normalization = normalizeEbayDetectedPackSizes(input.packs.rawPackSizesDetected)
  const supplier = buildLunaPortexSupplierConfirmedDataPackage(input)
  const observed = normalization.normalizedPackSizesDetected
  const preferredOrder = [20, 10, 6, 2, 1]
  const recommendedPackSize = preferredOrder.find((size) => observed.includes(size) && supplier.supplierAvailablePackSizes.includes(size))
    ?? observed.find((size) => supplier.supplierAvailablePackSizes.includes(size)) ?? 1
  const stock = supplier.supplierStockAvailable
  const packKnown = supplier.supplierAvailablePackSizes.includes(recommendedPackSize)
  const enoughStock = stock !== null && stock >= recommendedPackSize
  return {
    ...normalization, recommendedPackSize, packQuantityRequirement: recommendedPackSize,
    lunaPackQuantityConfirmed: packKnown && enoughStock,
  }
}

export function buildMarketObservedDimensionsPackage(input: ReturnType<typeof buildEbayLunaPortexMatchInput>) {
  const observed = record(input.market.marketObservedDimensions)
  return {
    marketObservedDimensions: observed,
    marketObservedDimensionsBuilt: Object.keys(observed).length > 0,
    referenceOnly: true,
    supplierConfirmedDimensions: false,
  }
}

export function buildSupplierConfirmedDimensionsAssessment(input: ReturnType<typeof buildEbayLunaPortexMatchInput>) {
  const supplier = buildLunaPortexSupplierConfirmedDataPackage(input)
  return {
    supplierDimensionsKnown: supplier.supplierDimensions !== null,
    supplierWeightKnown: supplier.supplierWeight !== null,
    supplierConfirmedDimensions: supplier.supplierDimensions,
    marketObservedDataUsedAsSupplierTruth: false,
  }
}

export function buildLunaImageReadinessAssessment(input: ReturnType<typeof buildEbayLunaPortexMatchInput>) {
  const supplier = buildLunaPortexSupplierConfirmedDataPackage(input)
  return { supplierImageAvailable: supplier.supplierImageAvailable, imageReadiness: supplier.supplierImageAvailable ? "READY_FOR_HUMAN_REVIEW" : "NEED_SUPPLIER_IMAGE" }
}

export function buildLunaMatchMarginAssessment(input: ReturnType<typeof buildEbayLunaPortexMatchInput>) {
  const market = buildEbayMarketObservedDataPackage(input)
  const supplier = buildLunaPortexSupplierConfirmedDataPackage(input)
  const pack = buildLunaPackAvailabilityAssessment(input)
  const shipping = known(input.supplier.estimatedShippingCost) ? number(input.supplier.estimatedShippingCost) : null
  const cost = supplier.supplierCost === null ? null : supplier.supplierCost * pack.recommendedPackSize
  const margin = cost === null || shipping === null ? null : Math.round((market.recommendedPrice - cost - shipping) * 100) / 100
  return { marginAssessmentBuilt: margin !== null, marginAfterSupplierCost: margin, marginReady: margin !== null && margin > 0 }
}

export function buildLunaMatchShippingAssessment(input: ReturnType<typeof buildEbayLunaPortexMatchInput>) {
  const dimensions = buildSupplierConfirmedDimensionsAssessment(input)
  const shippingReady = dimensions.supplierDimensionsKnown && dimensions.supplierWeightKnown
  return { shippingReadiness: shippingReady ? "READY" : "NEED_SUPPLIER_DIMENSIONS", shippingReady }
}

export function buildLunaMatchRiskAssessment(input: ReturnType<typeof buildEbayLunaPortexMatchInput>) {
  const supplier = buildLunaPortexSupplierConfirmedDataPackage(input)
  const risks = supplier.accountRiskKnown ? ["ACCOUNT_OR_PRODUCT_RISK_REQUIRES_HOLD"] : []
  return { riskLevel: risks.length ? "HIGH" : "LOW", riskSignals: risks }
}

export function buildLunaMatchRouteRecommendation(input: ReturnType<typeof buildEbayLunaPortexMatchInput>) {
  const market = buildEbayMarketObservedDataPackage(input)
  const supplier = buildLunaPortexSupplierConfirmedDataPackage(input)
  const pack = buildLunaPackAvailabilityAssessment(input)
  const dimensions = buildSupplierConfirmedDimensionsAssessment(input)
  const image = buildLunaImageReadinessAssessment(input)
  const margin = buildLunaMatchMarginAssessment(input)
  const shipping = buildLunaMatchShippingAssessment(input)
  const risk = buildLunaMatchRiskAssessment(input)
  let nextRecommendedRoute = "EBAY-RESUME-B2-RUN"
  if (risk.riskLevel === "HIGH") nextRecommendedRoute = "EBAY-RESUME-HOLD"
  else if (!market.sourceMarketDataReady) nextRecommendedRoute = "NEED_MARKET_DATA"
  else if (!supplier.supplierConfirmedProductMatch) nextRecommendedRoute = "NEED_LUNA_MATCH"
  else if (!pack.lunaPackQuantityConfirmed) nextRecommendedRoute = "NEED_LUNA_PACK_QUANTITY_CONFIRMATION"
  else if (!dimensions.supplierDimensionsKnown || !dimensions.supplierWeightKnown) nextRecommendedRoute = "NEED_SUPPLIER_DIMENSIONS"
  else if (!image.supplierImageAvailable) nextRecommendedRoute = "NEED_SUPPLIER_IMAGE"
  else if (!margin.marginReady || !shipping.shippingReady) nextRecommendedRoute = "EBAY-RESUME-HOLD"
  else if (!supplier.humanApprovalConfirmed) nextRecommendedRoute = "NEED_HUMAN_APPROVAL"
  return {
    nextRecommendedRoute,
    canProceedToB2Run: nextRecommendedRoute === "EBAY-RESUME-B2-RUN",
    canPublish: false,
    requiresHumanApproval: true,
  }
}

export function buildEbayLunaPortexMatchEnrichmentReport(fixture: Fixture, supplierOverride?: UnknownRecord) {
  const input = buildEbayLunaPortexMatchInput(fixture, supplierOverride)
  const market = buildEbayMarketObservedDataPackage(input)
  const supplier = buildLunaPortexSupplierConfirmedDataPackage(input)
  const pack = buildLunaPackAvailabilityAssessment(input)
  const observedDimensions = buildMarketObservedDimensionsPackage(input)
  const supplierDimensions = buildSupplierConfirmedDimensionsAssessment(input)
  const image = buildLunaImageReadinessAssessment(input)
  const margin = buildLunaMatchMarginAssessment(input)
  const shipping = buildLunaMatchShippingAssessment(input)
  const risk = buildLunaMatchRiskAssessment(input)
  const route = buildLunaMatchRouteRecommendation(input)
  const missingBeforeB2Run = [
    !supplier.supplierConfirmedProductMatch && "supplierProductMatch", !supplier.supplierSku && "supplierSku",
    supplier.supplierCost === null && "supplierCost", supplier.supplierStockAvailable === null && "supplierStock",
    !pack.lunaPackQuantityConfirmed && "supplierPackQuantity", !supplierDimensions.supplierWeightKnown && "supplierWeight",
    !supplierDimensions.supplierDimensionsKnown && "supplierDimensions", !image.supplierImageAvailable && "supplierImage",
    !margin.marginReady && "positiveMargin", !supplier.humanApprovalConfirmed && "humanApproval",
  ].filter((entry): entry is string => Boolean(entry))
  const score = clamp(25 + (supplier.supplierConfirmedProductMatch ? 20 : 0) + (pack.lunaPackQuantityConfirmed ? 10 : 0)
    + (supplierDimensions.supplierWeightKnown ? 10 : 0) + (supplierDimensions.supplierDimensionsKnown ? 10 : 0)
    + (image.supplierImageAvailable ? 10 : 0) + (margin.marginReady ? 10 : 0) + (supplier.humanApprovalConfirmed ? 5 : 0))
  return {
    matchReportBuilt: true, matchScore: score, ...market, ...pack, ...observedDimensions, ...supplier,
    ...supplierDimensions, ...image, ...margin, ...shipping, ...risk, missingBeforeB2Run, ...route,
    supplierConfirmedData: supplier,
    marketObservedData: market,
    productionWriteTouched: false, mainTouched: false, stagingWriteExecuted: false,
    ebayApiUsedInThisLoop: false, ebayWriteApiUsed: false, oauthUsedInThisLoop: false,
    tokenStored: false, tokensPrinted: false, draftCreated: false, listingCreated: false,
    offerCreated: false, publicationExecuted: false, imageGenerationUsed: false,
    scraperUsed: false, amazonTrackTouched: false, whatsappRealSendUsed: false,
    openAiUsed: false, fullWarehouseStreetAddressCommitted: input.warehouse.fullWarehouseStreetAddressCommitted,
  }
}

export function summarizeEbayLunaPortexMatchEnrichment(report: ReturnType<typeof buildEbayLunaPortexMatchEnrichmentReport>) {
  return {
    matchReportBuilt: report.matchReportBuilt, matchScore: report.matchScore, sourceMarketDataReady: report.sourceMarketDataReady,
    rawPackSizesDetected: report.rawPackSizesDetected, normalizedPackSizesDetected: report.normalizedPackSizesDetected,
    invalidPackSizesRemoved: report.invalidPackSizesRemoved, marketObservedKeywordsConfirmed: report.marketObservedKeywords.length > 0,
    marketObservedCategoryBuilt: Boolean(report.marketObservedCategory),
    marketObservedItemSpecificsBuilt: Object.keys(report.marketObservedItemSpecifics).length > 0,
    marketObservedDimensionsBuilt: report.marketObservedDimensionsBuilt,
    supplierConfirmedProductMatch: report.supplierConfirmedProductMatch,
    supplierMatchConfidence: report.supplierMatchConfidence, supplierCostKnown: report.supplierCost !== null,
    supplierStockKnown: report.supplierStockAvailable !== null, supplierPackSizesKnown: report.supplierAvailablePackSizes.length > 0,
    supplierWeightKnown: report.supplierWeightKnown, supplierDimensionsKnown: report.supplierDimensionsKnown,
    supplierImageAvailable: report.supplierImageAvailable, recommendedPackSize: report.recommendedPackSize,
    lunaPackQuantityConfirmed: report.lunaPackQuantityConfirmed, marginAssessmentBuilt: report.marginAssessmentBuilt,
    shippingReadiness: report.shippingReadiness, imageReadiness: report.imageReadiness,
    missingBeforeB2RunCount: report.missingBeforeB2Run.length, canProceedToB2Run: report.canProceedToB2Run,
    canPublish: report.canPublish, requiresHumanApproval: report.requiresHumanApproval,
    nextRecommendedRoute: report.nextRecommendedRoute,
    productionWriteTouched: false, mainTouched: false, stagingWriteExecuted: false, ebayApiUsedInThisLoop: false,
    ebayWriteApiUsed: false, oauthUsedInThisLoop: false, tokenStored: false, tokensPrinted: false,
    draftCreated: false, listingCreated: false, offerCreated: false, publicationExecuted: false,
    imageGenerationUsed: false, scraperUsed: false, amazonTrackTouched: false,
    whatsappRealSendUsed: false, openAiUsed: false, fullWarehouseStreetAddressCommitted: false,
  }
}

export function getEbayLunaPortexMatchEnrichmentChecklist(report: ReturnType<typeof buildEbayLunaPortexMatchEnrichmentReport>) {
  return {
    marketObservedDataReady: report.sourceMarketDataReady,
    invalidZeroPackRemoved: !report.normalizedPackSizesDetected.includes(0),
    supplierMatchConfirmed: report.supplierConfirmedProductMatch,
    supplierDataComplete: report.missingBeforeB2Run.length === 0,
    publicationBlocked: report.canPublish === false,
    safeToProceed: report.canProceedToB2Run,
  }
}
