import {
  buildEbayLunaCatalogIngestReport,
  normalizeLunaCatalog,
// @ts-expect-error Node executes the existing TypeScript module directly in local tooling.
} from "./ebay-luna-catalog-ingest.ts"

export const EBAY_LUNA_CATALOG_RUNNER_VERSION = "EBAY_LUNA_CATALOG_RUNNER_B2A_LUNA_CATALOG_RUN_V1"

type Row = Record<string, unknown>
type RunnerFixture = Row & { marketObservedDataFromEbay?: Row; snapshotPolicy?: Row; safetyFlags?: Record<string, boolean> }

const text = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback
const bool = (value: unknown) => value === true
const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
const number = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const record = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {}

export function buildEbayLunaCatalogRunnerInput(fixture: RunnerFixture) {
  return {
    runnerVersion: text(fixture.runnerVersion, EBAY_LUNA_CATALOG_RUNNER_VERSION),
    status: text(fixture.status), mode: text(fixture.mode), sourceRoute: text(fixture.sourceRoute),
    targetMarketplace: text(fixture.targetMarketplace, "EBAY_US"), storeName: text(fixture.storeName),
    warehouseAlias: text(fixture.warehouseAlias),
    fullWarehouseStreetAddressCommitted: bool(fixture.fullWarehouseStreetAddressCommitted),
    realCatalogFileUsedInThisLoop: bool(fixture.realCatalogFileUsedInThisLoop),
    sampleCatalogUsedInDryRun: bool(fixture.sampleCatalogUsedInDryRun),
    requiredCatalogColumns: strings(fixture.requiredCatalogColumns),
    marketObservedDataFromEbay: fixture.marketObservedDataFromEbay ?? {},
    snapshotPolicy: {
      maxCatalogAgeHours: number(fixture.snapshotPolicy?.maxCatalogAgeHours, 24),
      minimumGrossMargin: number(fixture.snapshotPolicy?.minimumGrossMargin, 1),
      catalogSource: text(fixture.snapshotPolicy?.catalogSource, "LOCAL_CATALOG_FILE"),
      logicalSnapshotOnly: fixture.snapshotPolicy?.logicalSnapshotOnly !== false,
      snapshotFileWriteEnabled: bool(fixture.snapshotPolicy?.snapshotFileWriteEnabled),
    },
    safetyFlags: fixture.safetyFlags ?? {},
  }
}

export function detectCatalogFileType(filePath: string) {
  const lower = filePath.toLowerCase()
  if (lower.endsWith(".csv")) return "CSV"
  if (lower.endsWith(".json")) return "JSON"
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "XLSX"
  return "UNSUPPORTED"
}

export function buildLocalCatalogFileGate(fixture: RunnerFixture, options: { filePath?: string; approved?: boolean; cliConfirmed?: boolean } = {}) {
  const catalogFileType = options.filePath ? detectCatalogFileType(options.filePath) : "NONE"
  const fileTypeSupported = ["CSV", "JSON", "XLSX"].includes(catalogFileType)
  return {
    catalogFileType, filePathProvided: Boolean(options.filePath), fileTypeSupported,
    environmentApproved: options.approved === true, cliConfirmed: options.cliConfirmed === true,
    gateReady: Boolean(options.filePath) && fileTypeSupported && options.approved === true && options.cliConfirmed === true,
  }
}

function parseCsvLine(line: string) {
  const values: string[] = []
  let current = ""
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && line[index + 1] === '"' && quoted) { current += '"'; index += 1 }
    else if (char === '"') quoted = !quoted
    else if (char === "," && !quoted) { values.push(current.trim()); current = "" }
    else current += char
  }
  values.push(current.trim())
  return values
}

function decodeCell(value: string) {
  if (!value) return null
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
    try { return JSON.parse(value) } catch { return value }
  }
  return value
}

export function parseLocalLunaCatalogCsv(csvText: string) {
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0])
  return lines.slice(1).map((line) => Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index], decodeCell(value)])))
}

export function parseLocalLunaCatalogJson(jsonText: string) {
  const parsed = JSON.parse(jsonText)
  if (!Array.isArray(parsed)) throw new Error("CATALOG_JSON_MUST_BE_ARRAY")
  return parsed.filter((row): row is Row => row !== null && typeof row === "object" && !Array.isArray(row))
}

export async function parseLocalLunaCatalogXlsxIfAvailable(
  data: Uint8Array,
  loader?: () => Promise<{ read: (data: Uint8Array, options: Row) => { SheetNames: string[]; Sheets: Record<string, unknown> }; utils: { sheet_to_json: (sheet: unknown) => Row[] } }>,
) {
  if (!loader) return { rows: [] as Row[], parserAvailable: false, error: "XLSX_PARSER_UNAVAILABLE" }
  try {
    const xlsx = await loader()
    const workbook = xlsx.read(data, { type: "array" })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    return { rows: xlsx.utils.sheet_to_json(sheet), parserAvailable: true, error: null }
  } catch {
    return { rows: [] as Row[], parserAvailable: false, error: "XLSX_PARSER_UNAVAILABLE" }
  }
}

export function sanitizeLunaCatalogRowsForReport(rows: Row[]) {
  return {
    catalogRowsLoaded: rows.length,
    catalogFieldPresence: {
      sku: rows.filter((row) => Boolean(row.sku)).length,
      cost: rows.filter((row) => row.cost !== null && row.cost !== undefined).length,
      stock: rows.filter((row) => row.stockAvailable !== null && row.stockAvailable !== undefined).length,
      image: rows.filter((row) => Boolean(row.imageUrl)).length,
    },
    rawRowsPrinted: false,
    fullCatalogPrinted: false,
  }
}

function stableCatalogPayload(rows: Row[]) {
  return normalizeLunaCatalog(rows)
    .map((row) => ({
      sku: row.sku, productName: row.productName, cost: row.cost, stockAvailable: row.stockAvailable,
      packQuantity: row.packQuantity, weight: row.weight, dimensions: row.dimensions,
      imageAvailable: Boolean(row.imageUrl), discontinued: Boolean((rows.find((source) => source.sku === row.sku) ?? {}).discontinued),
    }))
    .sort((a, b) => String(a.sku).localeCompare(String(b.sku)))
}

function logicalChecksum(value: unknown) {
  const source = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`
}

export function buildLunaCatalogLogicalSnapshot(rows: Row[], options: { importedAt?: string; catalogSource?: string } = {}) {
  const products = stableCatalogPayload(rows)
  const costs = products.map((row) => row.cost).filter((value): value is number => typeof value === "number")
  const stocks = products.map((row) => row.stockAvailable).filter((value): value is number => typeof value === "number")
  const checksum = logicalChecksum(products)
  const importedAt = options.importedAt ?? new Date().toISOString()
  return {
    snapshotId: `luna-${importedAt.replace(/[^0-9]/g, "").slice(0, 14)}-${checksum.slice(-8)}`,
    importedAt, catalogSource: options.catalogSource ?? "LOCAL_CATALOG_FILE",
    productCount: products.length, skuCount: new Set(products.map((row) => row.sku).filter(Boolean)).size,
    checksum,
    stockSummary: {
      totalUnits: stocks.reduce((sum, value) => sum + value, 0),
      inStockProducts: products.filter((row) => typeof row.stockAvailable === "number" && row.stockAvailable > 0).length,
      outOfStockProducts: products.filter((row) => row.stockAvailable === 0).length,
      unknownStockProducts: products.filter((row) => row.stockAvailable === null).length,
    },
    priceCostSummary: {
      productsWithCost: costs.length,
      minimumCost: costs.length ? Math.min(...costs) : null,
      maximumCost: costs.length ? Math.max(...costs) : null,
      averageCost: costs.length ? Math.round(costs.reduce((sum, value) => sum + value, 0) / costs.length * 100) / 100 : null,
    },
    products,
    logicalSnapshotOnly: true,
    snapshotFileWritten: false,
  }
}

function changed(a: unknown, b: unknown) {
  return JSON.stringify(a) !== JSON.stringify(b)
}

export function compareLunaCatalogSnapshots(
  current: ReturnType<typeof buildLunaCatalogLogicalSnapshot>,
  previous?: ReturnType<typeof buildLunaCatalogLogicalSnapshot> | null,
) {
  const currentMap = new Map(current.products.map((row) => [row.sku, row]))
  const previousMap = new Map((previous?.products ?? []).map((row) => [row.sku, row]))
  const currentSkus = [...currentMap.keys()].filter(Boolean)
  const previousSkus = [...previousMap.keys()].filter(Boolean)
  const common = currentSkus.filter((sku) => previousMap.has(sku))
  const skuFor = (predicate: (now: (typeof current.products)[number], before: (typeof current.products)[number]) => boolean) =>
    common.filter((sku) => predicate(currentMap.get(sku)!, previousMap.get(sku)!))
  return {
    previousSnapshotAvailable: Boolean(previous),
    currentSnapshotId: current.snapshotId,
    previousSnapshotId: previous?.snapshotId ?? null,
    newProductsDetected: currentSkus.filter((sku) => !previousMap.has(sku)),
    removedProductsDetected: previousSkus.filter((sku) => !currentMap.has(sku)),
    stockChangedProducts: skuFor((now, before) => changed(now.stockAvailable, before.stockAvailable)),
    outOfStockProducts: currentSkus.filter((sku) => currentMap.get(sku)?.stockAvailable === 0),
    restockedProducts: skuFor((now, before) => number(before.stockAvailable) <= 0 && number(now.stockAvailable) > 0),
    costChangedProducts: skuFor((now, before) => changed(now.cost, before.cost)),
    packChangedProducts: skuFor((now, before) => changed(now.packQuantity, before.packQuantity)),
    weightChangedProducts: skuFor((now, before) => changed(now.weight, before.weight)),
    dimensionsChangedProducts: skuFor((now, before) => changed(now.dimensions, before.dimensions)),
    imageChangedProducts: skuFor((now, before) => changed(now.imageAvailable, before.imageAvailable)),
    discontinuedProducts: currentSkus.filter((sku) => currentMap.get(sku)?.discontinued === true),
  }
}

export function buildLunaCatalogProductOperationalStates(
  current: ReturnType<typeof buildLunaCatalogLogicalSnapshot>,
  comparison: ReturnType<typeof compareLunaCatalogSnapshots>,
) {
  return current.products.map((product) => {
    let status = "LISTABLE"
    if (product.discontinued) status = "DELIST_OR_PAUSE_REQUIRED"
    else if (product.stockAvailable === 0) status = "STOCK_HOLD"
    else if (product.stockAvailable === null || product.cost === null || !product.weight || !product.dimensions || !product.imageAvailable) status = "NEED_SUPPLIER_CONFIRMATION"
    else if (comparison.costChangedProducts.includes(product.sku)) status = "REPRICE_REQUIRED"
    else if (comparison.packChangedProducts.includes(product.sku)) status = "PRICE_REVIEW"
    else if (comparison.newProductsDetected.includes(product.sku)) status = "NEW_OPPORTUNITY"
    else if (typeof product.stockAvailable === "number" && product.stockAvailable < number(product.packQuantity, 1)) status = "WATCHLIST"
    return { sku: product.sku, status }
  })
}

export function buildLunaCatalogPrePublishGuard(input: {
  snapshot: ReturnType<typeof buildLunaCatalogLogicalSnapshot>
  product?: (ReturnType<typeof buildLunaCatalogLogicalSnapshot>["products"])[number]
  requiredQuantity: number
  estimatedGrossMargin: number | null
  minimumGrossMargin?: number
  now?: string
  highRisk?: boolean
  humanApprovalConfirmed?: boolean
}) {
  const now = new Date(input.now ?? new Date().toISOString()).getTime()
  const imported = new Date(input.snapshot.importedAt).getTime()
  const catalogAgeHours = Number.isFinite(now) && Number.isFinite(imported) ? Math.max(0, Math.round((now - imported) / 36000) / 100) : Number.POSITIVE_INFINITY
  const product = input.product
  const catalogFreshnessPassed = catalogAgeHours <= 24
  const stockPassed = typeof product?.stockAvailable === "number" && product.stockAvailable >= input.requiredQuantity
  const supplierCostStillValid = typeof product?.cost === "number" && product.cost >= 0
  const marginPassed = typeof input.estimatedGrossMargin === "number" && input.estimatedGrossMargin >= (input.minimumGrossMargin ?? 1)
  const packQuantityStillAvailable = typeof product?.packQuantity === "number" && product.packQuantity === input.requiredQuantity
  const dimensionsPassed = Boolean(product?.weight && product?.dimensions)
  const imagePassed = product?.imageAvailable === true
  const discontinuedPassed = product?.discontinued !== true
  const riskPassed = input.highRisk !== true
  let nextRecommendedRoute = input.humanApprovalConfirmed ? "EBAY-RESUME-B2-RUN" : "NEED_HUMAN_APPROVAL"
  if (!catalogFreshnessPassed) nextRecommendedRoute = "NEED_FRESH_LUNA_CATALOG"
  else if (!stockPassed || !discontinuedPassed) nextRecommendedRoute = "STOCK_HOLD"
  else if (!supplierCostStillValid || !marginPassed) nextRecommendedRoute = "PRICE_REVIEW"
  else if (!packQuantityStillAvailable) nextRecommendedRoute = "NEED_LUNA_PACK_QUANTITY_CONFIRMATION"
  else if (!dimensionsPassed) nextRecommendedRoute = "NEED_SUPPLIER_DIMENSIONS"
  else if (!imagePassed) nextRecommendedRoute = "NEED_SUPPLIER_IMAGE"
  else if (!riskPassed) nextRecommendedRoute = "EBAY-RESUME-HOLD"
  return {
    catalogFreshnessPassed, catalogAgeHours, maxCatalogAgeHours: 24, stockPassed,
    supplierCostStillValid, marginPassed, packQuantityStillAvailable, dimensionsPassed,
    imagePassed, discontinuedPassed, riskPassed,
    prePublishGuardPassed: ["NEED_HUMAN_APPROVAL", "EBAY-RESUME-B2-RUN"].includes(nextRecommendedRoute),
    canProceedToB2Run: nextRecommendedRoute === "EBAY-RESUME-B2-RUN", canPublish: false, nextRecommendedRoute,
  }
}

function requiredColumnsAssessment(rows: Row[], required: string[]) {
  const headers = new Set(rows.flatMap((row) => Object.keys(row)))
  const missingRequiredColumns = required.filter((column) => !headers.has(column))
  return { requiredColumnsPresent: missingRequiredColumns.length === 0, missingRequiredColumns }
}

function ingestFixture(input: ReturnType<typeof buildEbayLunaCatalogRunnerInput>, real: boolean, approved: boolean) {
  return {
    status: "EBAY_LUNA_CATALOG_INGEST_READY", catalogInputTypesSupported: ["CSV", "XLSX", "JSON"],
    requiredCatalogColumns: input.requiredCatalogColumns, realCatalogFileUsedInThisLoop: real,
    localSampleCatalogUsed: !real, humanApprovalConfirmed: approved,
    marketObservedDataFromEbay: input.marketObservedDataFromEbay,
    warehouse: { warehouseAlias: input.warehouseAlias, fullWarehouseStreetAddressCommitted: false },
  }
}

export function buildRealLunaCatalogIngestReport(fixture: RunnerFixture, rows: Row[], options: {
  realCatalogFileUsed?: boolean
  humanApprovalConfirmed?: boolean
  catalogFileType?: string
  importedAt?: string
  now?: string
  previousSnapshot?: ReturnType<typeof buildLunaCatalogLogicalSnapshot> | null
} = {}) {
  const input = buildEbayLunaCatalogRunnerInput(fixture)
  const columns = requiredColumnsAssessment(rows, input.requiredCatalogColumns)
  const realCatalogFileUsed = options.realCatalogFileUsed === true
  const ingest = buildEbayLunaCatalogIngestReport(ingestFixture(input, realCatalogFileUsed, options.humanApprovalConfirmed === true), rows)
  const snapshot = buildLunaCatalogLogicalSnapshot(rows, { importedAt: options.importedAt, catalogSource: input.snapshotPolicy.catalogSource })
  const snapshotComparison = compareLunaCatalogSnapshots(snapshot, options.previousSnapshot)
  const productStates = buildLunaCatalogProductOperationalStates(snapshot, snapshotComparison)
  const snapshotProduct = snapshot.products.find((product) => product.sku === ingest.supplierSku)
  const prePublishGuard = buildLunaCatalogPrePublishGuard({
    snapshot, product: snapshotProduct, requiredQuantity: ingest.recommendedPackSize,
    estimatedGrossMargin: ingest.estimatedGrossMargin, minimumGrossMargin: input.snapshotPolicy.minimumGrossMargin,
    now: options.now, highRisk: ingest.riskAssessment.riskLevel === "HIGH",
    humanApprovalConfirmed: options.humanApprovalConfirmed === true,
  })
  const route = buildRealLunaCatalogRouteRecommendation({
    realCatalogFileUsed, requiredColumnsPresent: columns.requiredColumnsPresent, ingest,
    prePublishGuard,
  })
  return {
    catalogRunnerBuilt: true, runnerScore: columns.requiredColumnsPresent ? ingest.ingestScore : Math.min(ingest.ingestScore, 30),
    catalogFileType: options.catalogFileType ?? "NONE", realCatalogFileUsed,
    catalogRowsLoaded: rows.length, catalogRowsNormalized: normalizeLunaCatalog(rows).length,
    ...columns, bestSupplierMatch: ingest.supplierProductName || null,
    bestSupplierMatchScore: ingest.bestSupplierMatchScore,
    supplierSkuKnown: ingest.supplierSku !== null, supplierCostKnown: ingest.supplierCost !== null,
    supplierStockKnown: ingest.supplierStockAvailable !== null, supplierPackQuantityKnown: ingest.supplierPackQuantity !== null,
    supplierWeightKnown: ingest.supplierWeightKnown, supplierDimensionsKnown: ingest.supplierDimensionsKnown,
    supplierImageAvailable: ingest.supplierImageAvailable, recommendedPackSize: ingest.recommendedPackSize,
    marginAssessmentBuilt: ingest.marginAssessmentBuilt, shippingReadiness: ingest.shippingReadiness,
    imageReadiness: ingest.imageReadiness, sampleMatchOnly: !realCatalogFileUsed,
    snapshot, snapshotComparison, productStates, prePublishGuard,
    missingBeforeB2Run: [...ingest.missingBeforeB2Run, ...columns.missingRequiredColumns.map((column) => `requiredColumn:${column}`)],
    ...route, canPublish: false, requiresHumanApproval: true,
    catalogReadExecuted: realCatalogFileUsed, ebayApiUsed: false, oauthUsed: false,
    draftCreated: false, listingCreated: false, offerCreated: false, publicationExecuted: false,
    scraperUsed: false, filesystemWriteExecuted: false, realCatalogCommitted: false,
  }
}

export function buildRealLunaCatalogMatchSummary(report: ReturnType<typeof buildRealLunaCatalogIngestReport>) {
  return {
    bestSupplierMatch: report.bestSupplierMatch, bestSupplierMatchScore: report.bestSupplierMatchScore,
    supplierSkuKnown: report.supplierSkuKnown, supplierCostKnown: report.supplierCostKnown,
    supplierStockKnown: report.supplierStockKnown, supplierPackQuantityKnown: report.supplierPackQuantityKnown,
    supplierWeightKnown: report.supplierWeightKnown, supplierDimensionsKnown: report.supplierDimensionsKnown,
    supplierImageAvailable: report.supplierImageAvailable, recommendedPackSize: report.recommendedPackSize,
  }
}

export function buildRealLunaCatalogRouteRecommendation(input: {
  realCatalogFileUsed: boolean
  requiredColumnsPresent: boolean
  ingest: ReturnType<typeof buildEbayLunaCatalogIngestReport>
  prePublishGuard?: ReturnType<typeof buildLunaCatalogPrePublishGuard>
}) {
  let nextRecommendedRoute = input.ingest.nextRecommendedRoute
  if (!input.realCatalogFileUsed) nextRecommendedRoute = "NEED_REAL_LUNA_CATALOG_FILE"
  else if (!input.requiredColumnsPresent) nextRecommendedRoute = "NEED_REAL_LUNA_CATALOG_FILE"
  else if (input.prePublishGuard && !input.prePublishGuard.prePublishGuardPassed) nextRecommendedRoute = input.prePublishGuard.nextRecommendedRoute
  else if (input.prePublishGuard) nextRecommendedRoute = input.prePublishGuard.nextRecommendedRoute
  return { nextRecommendedRoute, canProceedToB2Run: nextRecommendedRoute === "EBAY-RESUME-B2-RUN" }
}

export function summarizeEbayLunaCatalogRunner(report: ReturnType<typeof buildRealLunaCatalogIngestReport>, mode = "dry-run") {
  return {
    catalogRunnerBuilt: report.catalogRunnerBuilt, runnerScore: report.runnerScore, mode,
    sampleCatalogUsed: report.sampleMatchOnly, realCatalogFileUsed: report.realCatalogFileUsed,
    catalogFileType: report.catalogFileType, catalogRowsLoaded: report.catalogRowsLoaded,
    catalogRowsNormalized: report.catalogRowsNormalized, requiredColumnsPresent: report.requiredColumnsPresent,
    missingRequiredColumns: report.missingRequiredColumns, bestSupplierMatch: report.bestSupplierMatch,
    bestSupplierMatchScore: report.bestSupplierMatchScore, supplierSkuKnown: report.supplierSkuKnown,
    supplierCostKnown: report.supplierCostKnown, supplierStockKnown: report.supplierStockKnown,
    supplierPackQuantityKnown: report.supplierPackQuantityKnown, supplierWeightKnown: report.supplierWeightKnown,
    supplierDimensionsKnown: report.supplierDimensionsKnown, supplierImageAvailable: report.supplierImageAvailable,
    recommendedPackSize: report.recommendedPackSize, marginAssessmentBuilt: report.marginAssessmentBuilt,
    shippingReadiness: report.shippingReadiness, imageReadiness: report.imageReadiness,
    snapshotId: report.snapshot.snapshotId, snapshotImportedAt: report.snapshot.importedAt,
    snapshotCatalogSource: report.snapshot.catalogSource, snapshotChecksum: report.snapshot.checksum,
    snapshotProductCount: report.snapshot.productCount, snapshotSkuCount: report.snapshot.skuCount,
    snapshotStockSummary: report.snapshot.stockSummary,
    snapshotPriceCostSummary: report.snapshot.priceCostSummary,
    catalogFreshnessPassed: report.prePublishGuard.catalogFreshnessPassed,
    catalogAgeHours: report.prePublishGuard.catalogAgeHours,
    prePublishGuardPassed: report.prePublishGuard.prePublishGuardPassed,
    snapshotChangeSummary: {
      newProductsDetected: report.snapshotComparison.newProductsDetected.length,
      removedProductsDetected: report.snapshotComparison.removedProductsDetected.length,
      stockChangedProducts: report.snapshotComparison.stockChangedProducts.length,
      outOfStockProducts: report.snapshotComparison.outOfStockProducts.length,
      restockedProducts: report.snapshotComparison.restockedProducts.length,
      costChangedProducts: report.snapshotComparison.costChangedProducts.length,
      packChangedProducts: report.snapshotComparison.packChangedProducts.length,
      weightChangedProducts: report.snapshotComparison.weightChangedProducts.length,
      dimensionsChangedProducts: report.snapshotComparison.dimensionsChangedProducts.length,
      imageChangedProducts: report.snapshotComparison.imageChangedProducts.length,
      discontinuedProducts: report.snapshotComparison.discontinuedProducts.length,
    },
    sampleMatchOnly: report.sampleMatchOnly, canProceedToB2Run: report.canProceedToB2Run,
    canPublish: false, requiresHumanApproval: true, nextRecommendedRoute: report.nextRecommendedRoute,
    catalogReadExecuted: report.catalogReadExecuted, ebayApiUsed: false, oauthUsed: false,
    draftCreated: false, listingCreated: false, offerCreated: false, publicationExecuted: false,
    scraperUsed: false, filesystemWriteExecuted: false, realCatalogCommitted: false,
  }
}

export function getEbayLunaCatalogRunnerChecklist(report: ReturnType<typeof buildRealLunaCatalogIngestReport>) {
  return {
    localFileReadOnly: report.filesystemWriteExecuted === false,
    realCatalogNotCommitted: report.realCatalogCommitted === false,
    requiredColumnsReady: report.requiredColumnsPresent,
    publicationBlocked: report.canPublish === false,
    readyForB2Run: report.canProceedToB2Run,
  }
}
