export const EBAY_LUNA_CATALOG_INGEST_VERSION = "EBAY_LUNA_CATALOG_INGEST_B2A_LUNA_CATALOG_V1"

type Row = Record<string, unknown>
type Fixture = Row & { warehouse?: Row; marketObservedDataFromEbay?: Row; safetyFlags?: Record<string, boolean> }

const text = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback
const num = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const bool = (value: unknown) => value === true
const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : []
const record = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {}
const known = (value: unknown) => value !== undefined && value !== null && value !== "" && value !== "runtime_required"
const words = (value: string) => [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1))]
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)))

export function buildEbayLunaCatalogIngestInput(fixture: Fixture, catalogRows: Row[]) {
  const warehouse = fixture.warehouse ?? {}
  return {
    ingestVersion: text(fixture.ingestVersion, EBAY_LUNA_CATALOG_INGEST_VERSION),
    status: text(fixture.status), mode: text(fixture.mode), sourceRoute: text(fixture.sourceRoute),
    storeName: text(fixture.storeName), targetMarketplace: text(fixture.targetMarketplace, "EBAY_US"),
    warehouse: {
      warehouseAlias: text(warehouse.warehouseAlias), city: text(warehouse.city), state: text(warehouse.state),
      postalCode: text(warehouse.postalCode), country: text(warehouse.country),
      fullWarehouseStreetAddressCommitted: bool(warehouse.fullWarehouseStreetAddressCommitted),
    },
    catalogInputTypesSupported: strings(fixture.catalogInputTypesSupported),
    requiredCatalogColumns: strings(fixture.requiredCatalogColumns),
    realCatalogFileUsed: bool(fixture.realCatalogFileUsedInThisLoop),
    sampleCatalogUsed: bool(fixture.localSampleCatalogUsed),
    humanApprovalConfirmed: bool(fixture.humanApprovalConfirmed),
    market: fixture.marketObservedDataFromEbay ?? {}, catalogRows,
    safetyFlags: fixture.safetyFlags ?? {},
  }
}

export function buildLunaCatalogRequiredColumnMap(input: ReturnType<typeof buildEbayLunaCatalogIngestInput>) {
  return {
    requiredCatalogColumns: input.requiredCatalogColumns,
    requiredCatalogColumnsCount: input.requiredCatalogColumns.length,
    operationallyCritical: ["sku", "productName", "cost", "stockAvailable", "packQuantity", "weight", "dimensions", "imageUrl"],
  }
}

export function normalizeLunaCatalogProduct(row: Row, index = 0) {
  const packQuantity = num(row.packQuantity)
  return {
    rowId: `catalog-row-${index + 1}`, sku: known(row.sku) ? text(row.sku) : null,
    productName: text(row.productName), description: text(row.description), brand: text(row.brand, "Unbranded"),
    upcOrGtin: known(row.upcOrGtin) ? text(row.upcOrGtin) : null,
    cost: known(row.cost) ? num(row.cost) : null,
    stockAvailable: known(row.stockAvailable) ? num(row.stockAvailable) : null,
    packQuantity: known(row.packQuantity) && packQuantity > 0 ? packQuantity : null,
    color: known(row.color) ? text(row.color) : null, material: known(row.material) ? text(row.material) : null,
    weight: known(row.weight) ? row.weight : null, dimensions: known(row.dimensions) ? row.dimensions : null,
    imageUrl: known(row.imageUrl) ? text(row.imageUrl) : null, category: text(row.category),
    handlingTime: known(row.handlingTime) ? num(row.handlingTime) : null, shippingNotes: text(row.shippingNotes),
  }
}

export function normalizeLunaCatalog(rows: Row[]) {
  return rows.map(normalizeLunaCatalogProduct)
}

export function buildLunaCatalogMatchQueryFromEbayMarketData(input: ReturnType<typeof buildEbayLunaCatalogIngestInput>) {
  const range = record(input.market.priceRange)
  return {
    marketObservedKeywords: strings(input.market.keywords),
    titleCandidate: text(input.market.optimizedTitleCandidate), category: text(input.market.suggestedCategory),
    recommendedPrice: num(input.market.recommendedPrice),
    priceRange: { min: num(range.min), max: num(range.max), currency: text(range.currency, "USD") },
    recommendedPackSizes: Array.isArray(input.market.normalizedPackSizesDetected)
      ? input.market.normalizedPackSizesDetected.map((v) => num(v)).filter((v) => v > 0) : [],
  }
}

const riskyTerms = ["aerosol", "battery", "supplement", "medical", "restricted", "hazmat", "perfume"]

export function buildLunaCatalogRiskAssessment(product: ReturnType<typeof normalizeLunaCatalogProduct>) {
  const source = `${product.productName} ${product.description} ${product.brand} ${product.material} ${product.shippingNotes}`.toLowerCase()
  const riskSignals = riskyTerms.filter((term) => source.includes(term))
  return { riskLevel: riskSignals.length ? "HIGH" : "LOW", riskSignals, rejectedForRisk: riskSignals.length > 0 }
}

export function scoreLunaCatalogProductMatch(query: ReturnType<typeof buildLunaCatalogMatchQueryFromEbayMarketData>, product: ReturnType<typeof normalizeLunaCatalogProduct>) {
  const haystack = words(`${product.productName} ${product.description} ${product.category} ${product.color} ${product.material}`)
  const queryWords = words(`${query.titleCandidate} ${query.marketObservedKeywords.join(" ")} ${query.category}`)
  const overlap = queryWords.filter((word) => haystack.includes(word))
  const lexicalScore = queryWords.length ? overlap.length / queryWords.length * 60 : 0
  const categoryScore = product.category.toLowerCase() === query.category.toLowerCase() ? 15 : 0
  const packScore = product.packQuantity !== null && query.recommendedPackSizes.includes(product.packQuantity) ? 15 : 0
  const specificsScore = product.color?.toLowerCase() === "black" && product.material?.toLowerCase() === "silicone" ? 10 : 0
  const risk = buildLunaCatalogRiskAssessment(product)
  const matchScore = clamp(lexicalScore + categoryScore + packScore + specificsScore - (risk.rejectedForRisk ? 70 : 0))
  return { product, matchScore, matchedKeywords: overlap, riskAssessment: risk, strongMatch: matchScore >= 70 && !risk.rejectedForRisk }
}

export function buildLunaCatalogAutomatedMatchAssessment(input: ReturnType<typeof buildEbayLunaCatalogIngestInput>) {
  const query = buildLunaCatalogMatchQueryFromEbayMarketData(input)
  const normalized = normalizeLunaCatalog(input.catalogRows)
  const candidates = normalized.map((product) => scoreLunaCatalogProductMatch(query, product))
    .sort((a, b) => b.matchScore - a.matchScore)
  return { matchCandidatesEvaluated: candidates.length, matchCandidates: candidates, bestSupplierMatch: candidates[0] ?? null, bestSupplierMatchScore: candidates[0]?.matchScore ?? 0 }
}

export function buildLunaCatalogPackAvailabilityAssessment(input: ReturnType<typeof buildEbayLunaCatalogIngestInput>, product: ReturnType<typeof normalizeLunaCatalogProduct>) {
  const query = buildLunaCatalogMatchQueryFromEbayMarketData(input)
  const recommendedPackSize = query.recommendedPackSizes.find((size) => size === product.packQuantity) ?? query.recommendedPackSizes[0] ?? 1
  const lunaPackQuantityConfirmed = product.packQuantity !== null && product.stockAvailable !== null
    && product.packQuantity === recommendedPackSize && product.stockAvailable >= recommendedPackSize
  return { recommendedPackSize, packQuantityRequirement: recommendedPackSize, lunaPackQuantityConfirmed }
}

export function buildLunaCatalogMarginAssessment(input: ReturnType<typeof buildEbayLunaCatalogIngestInput>, product: ReturnType<typeof normalizeLunaCatalogProduct>) {
  const price = num(input.market.recommendedPrice)
  const shippingReserve = 4.25
  const estimatedGrossMargin = product.cost === null ? null : Math.round((price - product.cost - shippingReserve) * 100) / 100
  return { marginAssessmentBuilt: estimatedGrossMargin !== null, estimatedGrossMargin, marginPositive: estimatedGrossMargin !== null && estimatedGrossMargin > 0 }
}

export function buildLunaCatalogShippingReadiness(product: ReturnType<typeof normalizeLunaCatalogProduct>) {
  const ready = product.weight !== null && product.dimensions !== null
  return { shippingReadiness: ready ? "READY" : "NEED_SUPPLIER_DIMENSIONS", supplierWeightKnown: product.weight !== null, supplierDimensionsKnown: product.dimensions !== null }
}

export function buildLunaCatalogImageReadiness(product: ReturnType<typeof normalizeLunaCatalogProduct>) {
  return { supplierImageAvailable: product.imageUrl !== null, imageReadiness: product.imageUrl ? "READY_FOR_HUMAN_REVIEW" : "NEED_SUPPLIER_IMAGE" }
}

export function buildLunaCatalogB2RunReadiness(input: ReturnType<typeof buildEbayLunaCatalogIngestInput>, candidate = buildLunaCatalogAutomatedMatchAssessment(input).bestSupplierMatch) {
  if (!candidate) return { missingBeforeB2Run: ["supplierMatch"], canProceedToB2Run: false, nextRecommendedRoute: "NEED_LUNA_MATCH" }
  const product = candidate.product
  const risk = buildLunaCatalogRiskAssessment(product)
  const pack = buildLunaCatalogPackAvailabilityAssessment(input, product)
  const margin = buildLunaCatalogMarginAssessment(input, product)
  const shipping = buildLunaCatalogShippingReadiness(product)
  const image = buildLunaCatalogImageReadiness(product)
  const missingBeforeB2Run = [
    !candidate.strongMatch && "supplierMatch", !product.sku && "supplierSku", product.cost === null && "supplierCost",
    product.stockAvailable === null && "supplierStock", product.packQuantity === null && "supplierPackQuantity",
    !pack.lunaPackQuantityConfirmed && "supplierPackQuantityConfirmation", !shipping.supplierWeightKnown && "supplierWeight",
    !shipping.supplierDimensionsKnown && "supplierDimensions", !image.supplierImageAvailable && "supplierImage",
    !margin.marginPositive && "positiveMargin", !input.humanApprovalConfirmed && "humanApproval",
  ].filter((v): v is string => Boolean(v))
  let nextRecommendedRoute = "NEED_HUMAN_APPROVAL"
  if (risk.riskLevel === "HIGH" || (margin.marginAssessmentBuilt && !margin.marginPositive)) nextRecommendedRoute = "EBAY-RESUME-HOLD"
  else if (!candidate.strongMatch) nextRecommendedRoute = "NEED_LUNA_MATCH"
  else if (product.cost === null || product.stockAvailable === null) nextRecommendedRoute = "NEED_LUNA_MATCH"
  else if (!pack.lunaPackQuantityConfirmed) nextRecommendedRoute = "NEED_LUNA_PACK_QUANTITY_CONFIRMATION"
  else if (!shipping.supplierWeightKnown || !shipping.supplierDimensionsKnown) nextRecommendedRoute = "NEED_SUPPLIER_DIMENSIONS"
  else if (!image.supplierImageAvailable) nextRecommendedRoute = "NEED_SUPPLIER_IMAGE"
  else if (!input.realCatalogFileUsed) nextRecommendedRoute = "NEED_REAL_LUNA_CATALOG_FILE"
  else if (input.humanApprovalConfirmed) nextRecommendedRoute = "EBAY-RESUME-B2-RUN"
  return { missingBeforeB2Run, canProceedToB2Run: nextRecommendedRoute === "EBAY-RESUME-B2-RUN", nextRecommendedRoute }
}

export function buildEbayLunaCatalogIngestReport(fixture: Fixture, catalogRows: Row[]) {
  const input = buildEbayLunaCatalogIngestInput(fixture, catalogRows)
  const normalized = normalizeLunaCatalog(catalogRows)
  const assessment = buildLunaCatalogAutomatedMatchAssessment(input)
  const best = assessment.bestSupplierMatch
  const product = best?.product ?? normalizeLunaCatalogProduct({})
  const pack = buildLunaCatalogPackAvailabilityAssessment(input, product)
  const margin = buildLunaCatalogMarginAssessment(input, product)
  const shipping = buildLunaCatalogShippingReadiness(product)
  const image = buildLunaCatalogImageReadiness(product)
  const risk = buildLunaCatalogRiskAssessment(product)
  const readiness = buildLunaCatalogB2RunReadiness(input, best)
  const sampleMatchOnly = input.sampleCatalogUsed && !input.realCatalogFileUsed && Boolean(best?.strongMatch)
  const ingestScore = clamp(20 + (best?.strongMatch ? 25 : 0) + (pack.lunaPackQuantityConfirmed ? 10 : 0)
    + (margin.marginPositive ? 10 : 0) + (shipping.supplierWeightKnown ? 10 : 0)
    + (shipping.supplierDimensionsKnown ? 10 : 0) + (image.supplierImageAvailable ? 10 : 0) + (input.realCatalogFileUsed ? 5 : 0))
  return {
    catalogIngestReportBuilt: true, ingestScore, catalogInputTypesSupported: input.catalogInputTypesSupported,
    requiredCatalogColumns: input.requiredCatalogColumns, catalogProductsLoaded: catalogRows.length,
    catalogProductsNormalized: normalized.length, marketObservedKeywords: strings(input.market.keywords),
    ...assessment, supplierProductName: product.productName, supplierSku: product.sku, supplierCost: product.cost,
    supplierStockAvailable: product.stockAvailable, supplierPackQuantity: product.packQuantity,
    supplierColor: product.color, supplierMaterial: product.material, supplierWeight: product.weight,
    supplierDimensions: product.dimensions, ...image, ...pack, ...margin, ...shipping,
    riskAssessment: risk, ...readiness, sampleMatchOnly, realCatalogFileUsed: input.realCatalogFileUsed,
    sampleCatalogUsed: input.sampleCatalogUsed, canPublish: false, requiresHumanApproval: true,
    productionWriteTouched: false, mainTouched: false, stagingWriteExecuted: false, ebayApiUsedInThisLoop: false,
    ebayWriteApiUsed: false, oauthUsedInThisLoop: false, tokenStored: false, tokensPrinted: false,
    draftCreated: false, listingCreated: false, offerCreated: false, publicationExecuted: false,
    imageGenerationUsed: false, scraperUsed: false, amazonTrackTouched: false,
    whatsappRealSendUsed: false, openAiUsed: false, fullWarehouseStreetAddressCommitted: false,
  }
}

export function summarizeEbayLunaCatalogIngest(report: ReturnType<typeof buildEbayLunaCatalogIngestReport>) {
  return {
    catalogIngestReportBuilt: report.catalogIngestReportBuilt, ingestScore: report.ingestScore,
    catalogInputTypesSupported: report.catalogInputTypesSupported, requiredCatalogColumnsCount: report.requiredCatalogColumns.length,
    catalogProductsLoaded: report.catalogProductsLoaded, catalogProductsNormalized: report.catalogProductsNormalized,
    realCatalogFileUsed: report.realCatalogFileUsed, sampleCatalogUsed: report.sampleCatalogUsed,
    matchCandidatesEvaluated: report.matchCandidatesEvaluated, bestSupplierMatchScore: report.bestSupplierMatchScore,
    supplierProductName: report.supplierProductName, supplierSkuKnown: report.supplierSku !== null,
    supplierCostKnown: report.supplierCost !== null, supplierStockKnown: report.supplierStockAvailable !== null,
    supplierPackQuantityKnown: report.supplierPackQuantity !== null, supplierWeightKnown: report.supplierWeightKnown,
    supplierDimensionsKnown: report.supplierDimensionsKnown, supplierImageAvailable: report.supplierImageAvailable,
    recommendedPackSize: report.recommendedPackSize, lunaPackQuantityConfirmed: report.lunaPackQuantityConfirmed,
    marginAssessmentBuilt: report.marginAssessmentBuilt, shippingReadiness: report.shippingReadiness,
    imageReadiness: report.imageReadiness, missingBeforeB2RunCount: report.missingBeforeB2Run.length,
    sampleMatchOnly: report.sampleMatchOnly, canProceedToB2Run: report.canProceedToB2Run,
    canPublish: false, requiresHumanApproval: true, nextRecommendedRoute: report.nextRecommendedRoute,
    productionWriteTouched: false, mainTouched: false, stagingWriteExecuted: false, ebayApiUsedInThisLoop: false,
    ebayWriteApiUsed: false, oauthUsedInThisLoop: false, tokenStored: false, tokensPrinted: false,
    draftCreated: false, listingCreated: false, offerCreated: false, publicationExecuted: false,
    imageGenerationUsed: false, scraperUsed: false, amazonTrackTouched: false,
    whatsappRealSendUsed: false, openAiUsed: false, fullWarehouseStreetAddressCommitted: false,
  }
}

export function getEbayLunaCatalogIngestChecklist(report: ReturnType<typeof buildEbayLunaCatalogIngestReport>) {
  return {
    catalogLoaded: report.catalogProductsLoaded > 0, catalogNormalized: report.catalogProductsLoaded === report.catalogProductsNormalized,
    strongMatchFound: report.bestSupplierMatchScore >= 70, realCatalogConfirmed: report.realCatalogFileUsed,
    sampleCannotEnableRealExecution: !report.sampleMatchOnly || !report.canProceedToB2Run,
    publicationBlocked: report.canPublish === false, readyForB2Run: report.canProceedToB2Run,
  }
}
