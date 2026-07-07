export const LUNA_PORTEX_FIRST_REAL_MINI_SCAN_VERSION =
  "LUNA_PORTEX_FIRST_REAL_MINI_SCAN_AUTOMATIC_FOUNDATION_V1"

export const LUNA_PORTEX_MINI_SCAN_SOURCE_DATA_CLASS =
  "LOOP_142_FIRST_REAL_LUNA_PORTEX_MINI_SCAN"

const maxMiniScanProducts =
  10
const scanType =
  "FIRST_REAL_LUNA_PORTEX_MINI_SCAN"

type LunaPortexMiniScanItem = {
  supplierProductId?: string | null
  supplierVariantId?: string | null
  supplierSku?: string | null
  title?: string | null
  productUrl?: string | null
  brand?: string | null
  productType?: string | null
  category?: string | null
  cost?: number | null
  currency?: string | null
  stockQuantity?: number | null
  stockStatus?: string | null
  weight?: string | null
  dimensions?: string | null
  imageUrls?: string[] | null
  updatedAt?: string | null
  [key: string]: unknown
}

type MiniScanOptions = {
  scanRunId?: string | null
  maxProducts?: number | null
  inputSource?: string | null
}

type NormalizedMiniScanItem = {
  sourceIndex: number
  supplierProductId: string | null
  supplierVariantId: string | null
  supplierSku: string | null
  title: string | null
  productUrl: string | null
  brand: string | null
  productType: string | null
  category: string | null
  cost: number | null
  currency: string
  stockQuantity: number | null
  stockStatus: string
  weight: string | null
  dimensions: string | null
  imageCount: number
  updatedAt: string | null
  needsData: string[]
  warnings: string[]
  blockedReason: string | null
  writeEligible: boolean
  rawSanitizedItem: LunaPortexMiniScanItem
}

type CandidateRow = {
  candidate_key: string
  supplier_product_id: string | null
  supplier_variant_id: string
  supplier_sku: string | null
  title: string
  product_url: string | null
  brand: string | null
  product_type: string | null
  source_payload: Record<string, unknown>
  normalized_payload: Record<string, unknown>
  state: "DETECTED"
  needs_data: string[]
  blocked_reason: string | null
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null
}

function normalizeImageUrls(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

export function classifyLunaPortexStockStatus(item: LunaPortexMiniScanItem = {}) {
  const stockStatus =
    normalizeText(item.stockStatus)?.toLowerCase() ?? null
  const stockQuantity =
    normalizeNumber(item.stockQuantity)

  if (stockStatus === "out_of_stock" || stockQuantity === 0) {
    return "out_of_stock"
  }

  if (stockStatus === "in_stock" || (stockQuantity !== null && stockQuantity > 5)) {
    return "in_stock"
  }

  if (stockStatus === "low_stock" || (stockQuantity !== null && stockQuantity > 0)) {
    return "low_stock"
  }

  return "unknown"
}

export function buildLunaPortexCandidateKey(
  normalizedItem: Pick<NormalizedMiniScanItem, "supplierVariantId" | "supplierSku">,
  options: MiniScanOptions = {},
) {
  void options
  const stableId =
    normalizeText(normalizedItem.supplierVariantId) ??
    normalizeText(normalizedItem.supplierSku) ??
    "missing-supplier-variant"

  return `luna-portex:first_real_mini_scan:${stableId}`.toLowerCase()
}

export function normalizeLunaPortexMiniScanItem(
  item: LunaPortexMiniScanItem = {},
  options: MiniScanOptions & { sourceIndex?: number | null } = {},
): NormalizedMiniScanItem {
  const supplierProductId =
    normalizeText(item.supplierProductId)
  const supplierVariantId =
    normalizeText(item.supplierVariantId)
  const supplierSku =
    normalizeText(item.supplierSku)
  const title =
    normalizeText(item.title)
  const cost =
    normalizeNumber(item.cost)
  const stockStatus =
    classifyLunaPortexStockStatus(item)
  const imageUrls =
    normalizeImageUrls(item.imageUrls)
  const needsData: string[] = []
  const warnings: string[] = []

  if (supplierVariantId === null) {
    needsData.push("missing supplierVariantId")
  }

  if (title === null) {
    needsData.push("missing title")
  }

  if (cost === null) {
    needsData.push("missing cost")
  }

  if (stockStatus === "unknown") {
    needsData.push("missing stock")
  }

  if (imageUrls.length === 0) {
    needsData.push("missing image")
  }

  if (stockStatus === "low_stock") {
    warnings.push("low stock")
  }

  const blockedReason =
    stockStatus === "out_of_stock"
      ? "out_of_stock"
      : needsData.length > 0
        ? "needs_data"
        : null

  return {
    sourceIndex:
      options.sourceIndex ?? 0,
    supplierProductId,
    supplierVariantId,
    supplierSku,
    title,
    productUrl:
      normalizeText(item.productUrl),
    brand:
      normalizeText(item.brand),
    productType:
      normalizeText(item.productType),
    category:
      normalizeText(item.category),
    cost,
    currency:
      normalizeText(item.currency) ?? "USD",
    stockQuantity:
      normalizeNumber(item.stockQuantity),
    stockStatus,
    weight:
      normalizeText(item.weight),
    dimensions:
      normalizeText(item.dimensions),
    imageCount:
      imageUrls.length,
    updatedAt:
      normalizeText(item.updatedAt),
    needsData,
    warnings,
    blockedReason,
    writeEligible:
      supplierVariantId !== null &&
      title !== null,
    rawSanitizedItem:
      {
        ...item,
        imageUrls,
      },
  }
}

export function buildLunaPortexMiniScanRun(
  inputItems: LunaPortexMiniScanItem[] = [],
  options: MiniScanOptions = {},
) {
  const limit =
    Math.min(
      Math.max(options.maxProducts ?? maxMiniScanProducts, 0),
      maxMiniScanProducts,
    )
  const scanRunId =
    normalizeText(options.scanRunId) ?? "loop142-first-real-mini-scan-v1"
  const limitedItems =
    Array.isArray(inputItems) ? inputItems.slice(0, limit) : []
  const normalizedItems =
    limitedItems.map((item, index) =>
      normalizeLunaPortexMiniScanItem(item, {
        ...options,
        sourceIndex:
          index,
      }),
    )
  const writeEligibleCandidates =
    normalizedItems.filter(item => item.writeEligible).length
  const blockedCandidates =
    normalizedItems.filter(item => item.blockedReason !== null).length
  const outOfStockCandidates =
    normalizedItems.filter(item => item.blockedReason === "out_of_stock").length
  const needsDataCandidates =
    normalizedItems.filter(item => item.needsData.length > 0).length
  const warnings =
    normalizedItems.flatMap(item =>
      [
        ...item.warnings.map(warning => `${item.supplierVariantId ?? item.supplierSku ?? "unknown"}: ${warning}`),
        ...item.needsData.map(reason => `${item.supplierVariantId ?? item.supplierSku ?? "unknown"}: ${reason}`),
      ],
    )

  return {
    scanVersion:
      LUNA_PORTEX_FIRST_REAL_MINI_SCAN_VERSION,
    scanRunId,
    scanType,
    sourceDataClass:
      LUNA_PORTEX_MINI_SCAN_SOURCE_DATA_CLASS,
    inputSource:
      normalizeText(options.inputSource) ?? "sanitized-fixture",
    inputProducts:
      limitedItems.length,
    normalizedProducts:
      normalizedItems.length,
    writeEligibleCandidates,
    blockedCandidates,
    outOfStockCandidates,
    needsDataCandidates,
    warnings,
    normalizedItems,
    maxProducts:
      limit,
    stagingWriteExecuted:
      false,
  }
}

export function buildLunaPortexMiniScanCandidateRows(
  scanRun: ReturnType<typeof buildLunaPortexMiniScanRun>,
  options: MiniScanOptions = {},
) {
  void options

  return scanRun.normalizedItems
    .filter(item => item.writeEligible)
    .map((item): CandidateRow => ({
      candidate_key:
        buildLunaPortexCandidateKey(item),
      supplier_product_id:
        item.supplierProductId,
      supplier_variant_id:
        item.supplierVariantId ?? "missing-supplier-variant",
      supplier_sku:
        item.supplierSku,
      title:
        item.title ?? "Luna Portex candidate needs title",
      product_url:
        item.productUrl,
      brand:
        item.brand,
      product_type:
        item.productType,
      source_payload:
        {
          rawSanitizedItem:
            item.rawSanitizedItem,
          metadata:
            {
              sourceDataClass:
                LUNA_PORTEX_MINI_SCAN_SOURCE_DATA_CLASS,
              scanRunId:
                scanRun.scanRunId,
              scanType,
              listableInEbay:
                false,
              publishable:
                false,
            },
        },
      normalized_payload:
        {
          supplierProductId:
            item.supplierProductId,
          supplierVariantId:
            item.supplierVariantId,
          supplierSku:
            item.supplierSku,
          title:
            item.title,
          category:
            item.category,
          stockStatus:
            item.stockStatus,
          stockQuantity:
            item.stockQuantity,
          cost:
            item.cost,
          currency:
            item.currency,
          imageCount:
            item.imageCount,
          sourceDataClass:
            LUNA_PORTEX_MINI_SCAN_SOURCE_DATA_CLASS,
          scanRunId:
            scanRun.scanRunId,
          automaticScanFoundation:
            {
              snapshotPrepared:
                true,
              diffModelPrepared:
                true,
              changeEventsPrepared:
                true,
            },
          listableInEbay:
            false,
          publishable:
            false,
        },
      state:
        "DETECTED",
      needs_data:
        [...item.needsData],
      blocked_reason:
        item.blockedReason,
    }))
}

export function validateLunaPortexMiniScanCandidateRow(row: Partial<CandidateRow> = {}) {
  const errors: string[] = []

  if (normalizeText(row.candidate_key) === null) {
    errors.push("candidate_key required")
  }

  if (normalizeText(row.supplier_variant_id) === null) {
    errors.push("supplier_variant_id required")
  }

  if (normalizeText(row.title) === null) {
    errors.push("title required")
  }

  if (row.state !== "DETECTED") {
    errors.push("state must be DETECTED")
  }

  if (!Array.isArray(row.needs_data)) {
    errors.push("needs_data must be an array")
  }

  if (typeof row.source_payload !== "object" || row.source_payload === null) {
    errors.push("source_payload required")
  }

  if (typeof row.normalized_payload !== "object" || row.normalized_payload === null) {
    errors.push("normalized_payload required")
  }

  return {
    valid:
      errors.length === 0,
    errors,
  }
}

export function buildLunaPortexAutomaticScanFoundation(
  scanRun: ReturnType<typeof buildLunaPortexMiniScanRun>,
  options: MiniScanOptions = {},
) {
  void options

  return {
    included:
      true,
    scanRunId:
      scanRun.scanRunId,
    snapshotModel:
      {
        prepared:
          true,
        itemCount:
          scanRun.normalizedProducts,
      },
    diffModel:
      {
        prepared:
          true,
        comparesCandidateKeyAndStockCost:
          true,
      },
    changeEvents:
      [
        "new_candidate_detected",
        "stock_status_changed",
        "cost_changed",
        "candidate_needs_data",
      ],
    futureCadence:
      {
        catalogSnapshot:
          "daily",
        stockAndCostWatch:
          "every_4_to_6_hours",
        activeListingStockGuard:
          "every_1_to_2_hours_after_loop_152",
      },
    schedulerCreated:
      false,
    realWhatsappAlerts:
      false,
  }
}

export function summarizeLunaPortexMiniScan(
  scanResult: ReturnType<typeof buildLunaPortexMiniScanRun> & {
    candidateRows?: CandidateRow[]
    automaticScanFoundation?: ReturnType<typeof buildLunaPortexAutomaticScanFoundation>
  },
) {
  return {
    scanVersion:
      scanResult.scanVersion,
    scanRunId:
      scanResult.scanRunId,
    inputProducts:
      scanResult.inputProducts,
    normalizedProducts:
      scanResult.normalizedProducts,
    candidateRowsPlanned:
      scanResult.candidateRows?.length ?? 0,
    writeEligibleCandidates:
      scanResult.writeEligibleCandidates,
    blockedCandidates:
      scanResult.blockedCandidates,
    outOfStockCandidates:
      scanResult.outOfStockCandidates,
    needsDataCandidates:
      scanResult.needsDataCandidates,
    warnings:
      [...scanResult.warnings],
    automaticScanFoundationReady:
      scanResult.automaticScanFoundation?.included === true,
    schedulerCreated:
      scanResult.automaticScanFoundation?.schedulerCreated === true,
    stagingWriteExecuted:
      false,
  }
}

export function getLunaPortexMiniScanChecklist() {
  return [
    "confirm Production remains off-limits",
    "confirm input is local JSON and not committed if real",
    "confirm max 10 products",
    "confirm only ebay_product_candidates is writable in LOOP 142",
    "confirm no scores, validations, or profit scenarios are written",
    "confirm automatic scan foundation has no scheduler",
    "confirm no eBay API, OAuth, WhatsApp, OpenAI, or uploads",
    "confirm next loop is 143 — Benchmark Data Model",
  ]
}
