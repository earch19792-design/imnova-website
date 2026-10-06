import { createHash } from "node:crypto"

export const SELLER_OS_888LOTS_SOURCE_KEY = "888lots" as const
export const SELLER_OS_888LOTS_IMPORT_CONTRACT_V1 =
  "SELLER_OS_888LOTS_AUTHORIZED_EXPORT_PREVIEW_V1" as const
export const SELLER_OS_888LOTS_CONDITION_GATE_V1 =
  "SELLER_OS_888LOTS_CONDITION_GATE_V1" as const
export const SELLER_OS_888LOTS_DUAL_MARKET_SOURCING_V1 =
  "SELLER_OS_888LOTS_DUAL_MARKET_SOURCING_V1" as const
export const SELLER_OS_888LOTS_INVENTORY_FRESHNESS_MINUTES = 360
export const SELLER_OS_888LOTS_MAX_PREVIEW_ROWS = 500

export const SELLER_OS_888LOTS_TEMPLATE_HEADERS_V1 = [
  "supplier_sku",
  "supplier_product_id",
  "supplier_variant_id",
  "title",
  "brand",
  "model",
  "upc",
  "ean",
  "asin",
  "condition",
  "available_quantity",
  "minimum_order_quantity",
  "unit_cost_usd",
  "delivered_unit_cost_usd",
  "lot_id",
  "category",
  "product_url",
  "image_urls",
  "restock_status",
  "source_updated_at",
] as const

type JsonRecord = Record<string, unknown>

export type SellerOs888LotsConditionV1 =
  | "BRAND_NEW"
  | "DISTRIBUTION_STOCK"
  | "REFURBISHED"
  | "INSPECTED_CUSTOMER_RETURN"
  | "BOX_DAMAGED"
  | "UNPROVEN"

export type SellerOs888LotsInventoryModeV1 =
  | "REPEATABLE_STOCK"
  | "ONE_OFF_LIQUIDATION"
  | "LOT_ALLOCATION"
  | "UNPROVEN"

export type SellerOs888LotsNextEvidenceActionV1 =
  | "VERIFY_PRODUCT_FIT"
  | "VERIFY_CONDITION"
  | "WAIT_UPSTREAM"
  | "CAPTURE_DELIVERED_COST"
  | "GET_EXACT_SOLD"

export type SellerOs888LotsDualMarketNextActionV1 =
  | "VERIFY_PRODUCT_FIT"
  | "VERIFY_CONDITION"
  | "CAPTURE_DELIVERED_COST"
  | "VERIFY_AMAZON_ASIN"
  | "GET_EBAY_EXACT_SOLD"
  | "GET_AMAZON_DEMAND"
  | "COMPLETE_EBAY_ECONOMICS"
  | "COMPLETE_AMAZON_ECONOMICS"
  | "RESOLVE_DUPLICATE"
  | "VERIFY_AMAZON_ELIGIBILITY"
  | "WAIT_UPSTREAM"
  | "READY_FOR_OWNER_BUY_REVIEW"

const FIELD_ALIASES: Record<string, readonly string[]> = {
  supplierSku: ["supplier_sku", "item_sku", "sku", "888_sku"],
  supplierProductId: ["supplier_product_id", "product_id", "item_id"],
  supplierVariantId: ["supplier_variant_id", "variant_id"],
  title: ["title", "product_title", "item_title", "product_name", "name"],
  brand: ["brand", "manufacturer", "vendor"],
  model: ["model", "mpn", "model_number", "manufacturer_part_number"],
  upc: ["upc", "upc_code"],
  ean: ["ean", "ean_code"],
  asin: ["asin", "amazon_asin"],
  condition: ["condition", "item_condition", "inventory_condition"],
  availableQuantity: ["available_quantity", "inventory_quantity", "quantity", "qty", "stock"],
  minimumOrderQuantity: ["minimum_order_quantity", "minimum_quantity", "moq"],
  unitCostUsd: ["unit_cost_usd", "unit_cost", "price", "cost"],
  deliveredUnitCostUsd: ["delivered_unit_cost_usd", "landed_unit_cost_usd", "delivered_cost"],
  lotId: ["lot_id", "lot_number", "lot"],
  category: ["category", "product_category"],
  productUrl: ["product_url", "item_url", "url"],
  imageUrls: ["image_urls", "image_url", "images"],
  restockStatus: ["restock_status", "inventory_mode", "stock_type"],
  sourceUpdatedAt: ["source_updated_at", "updated_at", "last_updated"],
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, maximum = 500) {
  if (typeof value !== "string") return null
  const normalized = value.trim().replace(/\s+/g, " ")
  return normalized ? normalized.slice(0, maximum) : null
}

function headerKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

function normalizedRow(value: unknown) {
  const source = record(value)
  return new Map(Object.entries(source).map(([key, entry]) => [headerKey(key), entry]))
}

function field(row: Map<string, unknown>, name: keyof typeof FIELD_ALIASES) {
  for (const alias of FIELD_ALIASES[name]) {
    const key = headerKey(alias)
    if (row.has(key)) return row.get(key)
  }
  return undefined
}

function money(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const normalized = typeof value === "string"
    ? value.replace(/[$,\s]/g, "")
    : value
  const numeric = Number(normalized)
  return Number.isFinite(numeric) && numeric >= 0
    ? Number(numeric.toFixed(2))
    : null
}

function integer(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const normalized = typeof value === "string" ? value.replace(/[,\s]/g, "") : value
  const numeric = Number(normalized)
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null
}

function iso(value: unknown) {
  if (!value) return null
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function safeHttpsUrl(value: unknown) {
  const candidate = text(value, 2_000)
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    return url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

function imageUrls(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string" ? value.split(/[|;\n]+/) : []
  return [...new Set(values.map(safeHttpsUrl).filter((url): url is string => Boolean(url)))].slice(0, 24)
}

function digits(value: unknown) {
  const candidate = text(value, 40)
  return candidate ? candidate.replace(/[^0-9]/g, "") : null
}

function validGtin(value: string | null) {
  if (!value || ![8, 12, 13, 14].includes(value.length)) return false
  const numbers = [...value].map(Number)
  const check = numbers.pop()
  if (check === undefined) return false
  const sum = numbers.reverse().reduce((total, number, index) =>
    total + number * (index % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

export function normalize888LotsConditionV1(value: unknown): SellerOs888LotsConditionV1 {
  const normalized = headerKey(text(value) ?? "")
  if (["brandnew", "new", "newtier1", "tier1brandnew"].includes(normalized)) {
    return "BRAND_NEW"
  }
  if (["distributionstock", "distribution"].includes(normalized)) {
    return "DISTRIBUTION_STOCK"
  }
  if (["refurbished", "renewed"].includes(normalized)) return "REFURBISHED"
  if (["inspectedcustomerreturn", "inspectedcustomerreturns", "inspectedreturn"].includes(normalized)) {
    return "INSPECTED_CUSTOMER_RETURN"
  }
  if (["boxdamaged", "damagedbox", "packagingdamaged"].includes(normalized)) {
    return "BOX_DAMAGED"
  }
  return "UNPROVEN"
}

export function canonical888LotsSkuV1(value: unknown) {
  const raw = text(value, 240)?.toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!raw) return null
  const direct = `888L-${raw}`
  if (direct.length <= 50) return direct
  const suffix = createHash("sha256").update(raw).digest("hex").slice(0, 10).toUpperCase()
  return `888L-${raw.slice(0, 33)}-${suffix}`
}

function conditionGate(condition: SellerOs888LotsConditionV1) {
  if (condition === "BRAND_NEW") return {
    contractVersion: SELLER_OS_888LOTS_CONDITION_GATE_V1,
    status: "SUPPORTED" as const,
    initialPilotEligible: true,
    reasonCode: null,
  }
  if (condition === "UNPROVEN") return {
    contractVersion: SELLER_OS_888LOTS_CONDITION_GATE_V1,
    status: "UNPROVEN" as const,
    initialPilotEligible: false,
    reasonCode: "SUPPLIER_CONDITION_UNPROVEN",
  }
  return {
    contractVersion: SELLER_OS_888LOTS_CONDITION_GATE_V1,
    status: "HOLD" as const,
    initialPilotEligible: false,
    reasonCode: condition === "DISTRIBUTION_STOCK"
      ? "DISTRIBUTION_STOCK_MARKETPLACE_CONDITION_REVIEW_REQUIRED"
      : "NON_NEW_INITIAL_PILOT_EXCLUDED",
  }
}

function inventoryMode(input: {
  availableQuantity: number | null
  minimumOrderQuantity: number | null
  lotId: string | null
  restockStatus: string | null
}): SellerOs888LotsInventoryModeV1 {
  if (input.lotId) return "LOT_ALLOCATION"
  if (input.availableQuantity !== null && input.availableQuantity <= 2) {
    return "ONE_OFF_LIQUIDATION"
  }
  const restock = headerKey(input.restockStatus ?? "")
  if (
    input.availableQuantity !== null && input.availableQuantity >= 3 &&
    input.minimumOrderQuantity !== null && input.availableQuantity >= input.minimumOrderQuantity &&
    ["repeatablestock", "repeatable", "restockeligible", "recurring"].includes(restock)
  ) {
    return "REPEATABLE_STOCK"
  }
  return "UNPROVEN"
}

export function normalize888LotsCatalogRowV1(value: unknown, options: {
  capturedAt: string
  now?: Date
  sourceFileDigest?: string | null
  rowNumber?: number
}) {
  const row = normalizedRow(value)
  const capturedAt = iso(options.capturedAt)
  if (!capturedAt) throw new Error("SELLER_OS_888LOTS_CAPTURED_AT_REQUIRED")
  const now = options.now ?? new Date()
  const supplierSku = text(field(row, "supplierSku"), 240)
  const canonicalSku = canonical888LotsSkuV1(supplierSku)
  const supplierProductId = text(field(row, "supplierProductId"), 240) ?? supplierSku
  const supplierVariantId = text(field(row, "supplierVariantId"), 240) ?? supplierSku
  const title = text(field(row, "title"), 500)
  const brand = text(field(row, "brand"), 240)
  const model = text(field(row, "model"), 240)
  const upc = digits(field(row, "upc"))
  const ean = digits(field(row, "ean"))
  const asinRaw = text(field(row, "asin"), 20)?.toUpperCase() ?? null
  const asin = asinRaw && /^[A-Z0-9]{10}$/.test(asinRaw) ? asinRaw : null
  const rawCondition = text(field(row, "condition"), 240)
  const condition = normalize888LotsConditionV1(rawCondition)
  const conditionAuthority = conditionGate(condition)
  const availableQuantity = integer(field(row, "availableQuantity"))
  const minimumOrderQuantity = integer(field(row, "minimumOrderQuantity"))
  const unitCostUsd = money(field(row, "unitCostUsd"))
  const deliveredUnitCostUsd = money(field(row, "deliveredUnitCostUsd"))
  const lotId = text(field(row, "lotId"), 240)
  const restockStatus = text(field(row, "restockStatus"), 120)
  const sourceUpdatedAt = iso(field(row, "sourceUpdatedAt"))
  const productUrl = safeHttpsUrl(field(row, "productUrl"))
  const images = imageUrls(field(row, "imageUrls"))
  const mode = inventoryMode({ availableQuantity, minimumOrderQuantity, lotId, restockStatus })
  const costsSupported = unitCostUsd !== null && unitCostUsd > 0 &&
    deliveredUnitCostUsd !== null && deliveredUnitCostUsd >= unitCostUsd
  const freshUntil = new Date(Date.parse(capturedAt) +
    SELLER_OS_888LOTS_INVENTORY_FRESHNESS_MINUTES * 60_000).toISOString()
  const freshness = Date.parse(capturedAt) <= now.getTime() &&
    Date.parse(freshUntil) > now.getTime() ? "FRESH" : "STALE"

  const blockers: string[] = []
  if (!supplierSku || !canonicalSku || !supplierProductId || !supplierVariantId || !title || !brand) {
    blockers.push("SUPPLIER_CORE_IDENTITY_UNPROVEN")
  }
  const gtinSupplied = Boolean(upc || ean)
  if (gtinSupplied && ![upc, ean].some((candidate) => validGtin(candidate))) {
    blockers.push("SUPPLIER_GTIN_INVALID")
  }
  if (!gtinSupplied && !model && !asin) blockers.push("EXACT_PRODUCT_IDENTIFIER_UNPROVEN")
  if (conditionAuthority.reasonCode) blockers.push(conditionAuthority.reasonCode)
  if (availableQuantity === null) blockers.push("SUPPLIER_AVAILABLE_QUANTITY_UNPROVEN")
  if (availableQuantity === 0) blockers.push("SUPPLIER_OUT_OF_STOCK")
  if (minimumOrderQuantity === null || minimumOrderQuantity < 1) {
    blockers.push("SUPPLIER_MOQ_UNPROVEN")
  } else if (availableQuantity !== null && minimumOrderQuantity > availableQuantity) {
    blockers.push("SUPPLIER_MOQ_EXCEEDS_AVAILABLE_QUANTITY")
  }
  if (mode === "UNPROVEN") blockers.push("REPEATABLE_STOCK_AUTHORITY_UNPROVEN")
  if (mode === "ONE_OFF_LIQUIDATION") blockers.push("ONE_OFF_NOT_REPLACEMENT_ELIGIBLE")
  if (mode === "LOT_ALLOCATION") blockers.push("LOT_ALLOCATION_REQUIRED")
  if (unitCostUsd === null || unitCostUsd <= 0) blockers.push("SUPPLIER_UNIT_COST_UNPROVEN")
  if (!costsSupported) {
    blockers.push("DELIVERED_UNIT_COST_UNPROVEN")
  }
  if (freshness !== "FRESH") blockers.push("SUPPLIER_INVENTORY_STALE")

  let nextBestEvidence: {
    action: SellerOs888LotsNextEvidenceActionV1
    priority: 1
    reasonCode: string
    authority: string
    inventedEvidence: false
  }
  if (blockers.some((code) => ["SUPPLIER_CORE_IDENTITY_UNPROVEN", "SUPPLIER_GTIN_INVALID",
    "EXACT_PRODUCT_IDENTIFIER_UNPROVEN"].includes(code))) {
    nextBestEvidence = { action: "VERIFY_PRODUCT_FIT", priority: 1,
      reasonCode: "EXACT_SUPPLIER_PRODUCT_IDENTITY_REQUIRED",
      authority: "888LOTS_AUTHORIZED_EXPORT_OR_OWNER_EVIDENCE", inventedEvidence: false }
  } else if (conditionAuthority.status !== "SUPPORTED") {
    nextBestEvidence = { action: "VERIFY_CONDITION", priority: 1,
      reasonCode: conditionAuthority.reasonCode ?? "SUPPLIER_CONDITION_REQUIRED",
      authority: "888LOTS_AUTHORIZED_EXPORT_OR_RECEIVING_INSPECTION", inventedEvidence: false }
  } else if (freshness !== "FRESH" || availableQuantity === null || minimumOrderQuantity === null ||
    mode === "UNPROVEN") {
    nextBestEvidence = { action: "WAIT_UPSTREAM", priority: 1,
      reasonCode: mode === "UNPROVEN" ? "REPEATABLE_STOCK_AUTHORITY_REQUIRED"
        : "FRESH_SUPPLIER_INVENTORY_AND_MOQ_REQUIRED",
      authority: "888LOTS_AUTHORIZED_EXPORT", inventedEvidence: false }
  } else if (!costsSupported) {
    nextBestEvidence = { action: "CAPTURE_DELIVERED_COST", priority: 1,
      reasonCode: "DELIVERED_UNIT_COST_REQUIRED",
      authority: "888LOTS_CART_OR_INVOICE", inventedEvidence: false }
  } else {
    nextBestEvidence = { action: "GET_EXACT_SOLD", priority: 1,
      reasonCode: "EXACT_EBAY_SOLD_EVIDENCE_REQUIRED",
      authority: "EBAY_SOLD_READONLY", inventedEvidence: false }
  }

  const normalized = {
    contractVersion: SELLER_OS_888LOTS_IMPORT_CONTRACT_V1,
    sourceKey: SELLER_OS_888LOTS_SOURCE_KEY,
    rowNumber: options.rowNumber ?? null,
    sourceFileDigest: options.sourceFileDigest ?? null,
    candidate: { supplierSku, canonicalSku, supplierProductId, supplierVariantId,
      title, brand, model, upc: validGtin(upc) ? upc : null,
      ean: validGtin(ean) ? ean : null, asin,
      category: text(field(row, "category"), 240), productUrl, imageUrls: images },
    condition: { raw: rawCondition, normalized: condition, ...conditionAuthority },
    inventory: { availableQuantity, minimumOrderQuantity, mode,
      restockStatus, lotId, capturedAt, sourceUpdatedAt, freshUntil, freshness,
      replacementEligible: false },
    costs: { currency: "USD", unitCostUsd, deliveredUnitCostUsd,
      status: costsSupported ? "SUPPORTED" : "UNPROVEN" },
    blockers: [...new Set(blockers)],
    nextBestEvidence,
    goldenPath: { demand: "UNPROVEN", duplicateGate: "UNPROVEN",
      shipping: "UNPROVEN", fee: "UNPROVEN", economics: "UNPROVEN",
      decision: "UNPROVEN", minimumNetProfitUsd: 4, failClosed: true },
    safety: { scrapeRequests: 0, databaseWrites: 0, supplierPurchases: 0,
      marketplaceWrites: 0, publications: 0, repricing: 0, canPublish: false },
  }
  return { ...normalized, evidenceDigest: digest(normalized) }
}

export function preview888LotsAuthorizedExportV1(input: {
  rows: unknown
  capturedAt: string
  now?: Date
  sourceFileDigest?: string | null
}) {
  if (!Array.isArray(input.rows) || input.rows.length < 1 ||
    input.rows.length > SELLER_OS_888LOTS_MAX_PREVIEW_ROWS) {
    throw new Error("SELLER_OS_888LOTS_PREVIEW_ROWS_INVALID")
  }
  const normalized = input.rows.map((row, index) => normalize888LotsCatalogRowV1(row, {
    capturedAt: input.capturedAt,
    now: input.now,
    sourceFileDigest: input.sourceFileDigest,
    rowNumber: index + 2,
  }))
  const skuCounts = new Map<string, number>()
  for (const row of normalized) {
    const sku = row.candidate.canonicalSku
    if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1)
  }
  const candidates = normalized.map((row) => {
    const duplicate = row.candidate.canonicalSku &&
      (skuCounts.get(row.candidate.canonicalSku) ?? 0) > 1
    if (!duplicate) return row
    const next = { ...row,
      blockers: [...new Set([...row.blockers, "DUPLICATE_SUPPLIER_SKU_IN_IMPORT"])],
      nextBestEvidence: { action: "VERIFY_PRODUCT_FIT" as const, priority: 1 as const,
        reasonCode: "DUPLICATE_SUPPLIER_SKU_IN_IMPORT",
        authority: "888LOTS_AUTHORIZED_EXPORT", inventedEvidence: false as const } }
    return { ...next, evidenceDigest: digest(next) }
  })
  const result = {
    contractVersion: SELLER_OS_888LOTS_IMPORT_CONTRACT_V1,
    sourceKey: SELLER_OS_888LOTS_SOURCE_KEY,
    capturedAt: iso(input.capturedAt),
    rowCount: candidates.length,
    summary: {
      brandNew: candidates.filter((row) => row.condition.normalized === "BRAND_NEW").length,
      repeatableStockSupported: candidates.filter((row) => row.inventory.mode === "REPEATABLE_STOCK").length,
      oneOff: candidates.filter((row) => row.inventory.mode === "ONE_OFF_LIQUIDATION").length,
      lotAllocation: candidates.filter((row) => row.inventory.mode === "LOT_ALLOCATION").length,
      unprovenInventoryMode: candidates.filter((row) => row.inventory.mode === "UNPROVEN").length,
      duplicateSupplierSkus: candidates.filter((row) =>
        row.blockers.includes("DUPLICATE_SUPPLIER_SKU_IN_IMPORT")).length,
      exactSoldRequired: candidates.filter((row) =>
        row.nextBestEvidence.action === "GET_EXACT_SOLD").length,
    },
    candidates,
    status: "PREVIEW_ONLY" as const,
    safety: { scrapeRequests: 0, databaseWrites: 0, supplierPurchases: 0,
      marketplaceWrites: 0, publications: 0, repricing: 0, canPublish: false },
  }
  return { ...result, evidenceDigest: digest(result) }
}

type DualMarketEvidenceStateV1 =
  | "PROVEN"
  | "SUPPORTED"
  | "UNPROVEN"
  | "UNAVAILABLE"
  | "STALE"

type DualMarketEvidenceRowV1 = {
  marketplace?: unknown
  marketplaceProductId?: unknown
  exactProductMatch?: unknown
  identityState?: unknown
  demandState?: unknown
  observedUnitsSold?: unknown
  observationWindowDays?: unknown
  salePriceState?: unknown
  buyerLandedSalePriceUsd?: unknown
  feeState?: unknown
  marketplaceFeeUsd?: unknown
  fulfillmentState?: unknown
  fulfillmentCostUsd?: unknown
  promotionState?: unknown
  promotionCostUsd?: unknown
  returnsReserveState?: unknown
  returnsReserveUsd?: unknown
  otherVariableCostState?: unknown
  otherVariableCostUsd?: unknown
  eligibilityState?: unknown
  eligibleToSell?: unknown
  capturedAt?: unknown
  authorityContract?: unknown
}

const DUAL_MARKET_EVIDENCE_FRESHNESS_MINUTES = 1_440
const MINIMUM_NET_PROFIT_USD = 4
const INITIAL_BUY_COVERAGE_DAYS = 14
const INITIAL_BUY_CAPTURE_RATE = 0.1
const INITIAL_BUY_MAX_UNITS = 12

function evidenceState(value: unknown): DualMarketEvidenceStateV1 {
  const normalized = text(value, 40)?.toUpperCase()
  return ["PROVEN", "SUPPORTED", "UNAVAILABLE", "STALE"].includes(normalized ?? "")
    ? normalized as DualMarketEvidenceStateV1
    : "UNPROVEN"
}

function positiveInteger(value: unknown) {
  const parsed = integer(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

function marketplaceProductId(marketplace: "EBAY_US" | "AMAZON_US", value: unknown) {
  const normalized = text(value, 40)?.toUpperCase() ?? null
  if (!normalized) return null
  if (marketplace === "EBAY_US") return /^\d{9,20}$/.test(normalized) ? normalized : null
  return /^[A-Z0-9]{10}$/.test(normalized) ? normalized : null
}

function normalizeDualMarketEvidenceRowV1(value: DualMarketEvidenceRowV1, now: Date) {
  const marketplace = text(value.marketplace, 40)?.toUpperCase()
  if (marketplace !== "EBAY_US" && marketplace !== "AMAZON_US") return null
  const capturedAt = iso(value.capturedAt)
  const freshUntil = capturedAt
    ? new Date(Date.parse(capturedAt) + DUAL_MARKET_EVIDENCE_FRESHNESS_MINUTES * 60_000).toISOString()
    : null
  const freshness = capturedAt && Date.parse(capturedAt) <= now.getTime() && freshUntil &&
    Date.parse(freshUntil) > now.getTime() ? "FRESH" as const : "STALE" as const
  const productId = marketplaceProductId(marketplace, value.marketplaceProductId)
  const identityState = evidenceState(value.identityState)
  const demandState = evidenceState(value.demandState)
  const salePriceState = evidenceState(value.salePriceState)
  const feeState = evidenceState(value.feeState)
  const fulfillmentState = evidenceState(value.fulfillmentState)
  const promotionState = evidenceState(value.promotionState)
  const returnsReserveState = evidenceState(value.returnsReserveState)
  const otherVariableCostState = evidenceState(value.otherVariableCostState)
  const eligibilityState = evidenceState(value.eligibilityState)
  const observedUnitsSold = integer(value.observedUnitsSold)
  const observationWindowDays = positiveInteger(value.observationWindowDays)
  const buyerLandedSalePriceUsd = money(value.buyerLandedSalePriceUsd)
  const marketplaceFeeUsd = money(value.marketplaceFeeUsd)
  const fulfillmentCostUsd = money(value.fulfillmentCostUsd)
  const promotionCostUsd = money(value.promotionCostUsd)
  const returnsReserveUsd = money(value.returnsReserveUsd)
  const otherVariableCostUsd = money(value.otherVariableCostUsd)
  const stateSupported = (state: DualMarketEvidenceStateV1) =>
    state === "PROVEN" || state === "SUPPORTED"
  const identitySupported = freshness === "FRESH" && stateSupported(identityState) &&
    value.exactProductMatch === true && Boolean(productId)
  const demandSupported = freshness === "FRESH" && stateSupported(demandState) &&
    observedUnitsSold !== null && observationWindowDays !== null
  const economicsSupported = freshness === "FRESH" &&
    [salePriceState, feeState, fulfillmentState, promotionState,
      returnsReserveState, otherVariableCostState].every(stateSupported) &&
    buyerLandedSalePriceUsd !== null && buyerLandedSalePriceUsd > 0 &&
    [marketplaceFeeUsd, fulfillmentCostUsd, promotionCostUsd,
      returnsReserveUsd, otherVariableCostUsd].every((entry) => entry !== null)
  const eligibilitySupported = freshness === "FRESH" &&
    stateSupported(eligibilityState) && typeof value.eligibleToSell === "boolean"
  const variableCostUsd = economicsSupported
    ? Number(((marketplaceFeeUsd ?? 0) + (fulfillmentCostUsd ?? 0) +
      (promotionCostUsd ?? 0) + (returnsReserveUsd ?? 0) +
      (otherVariableCostUsd ?? 0)).toFixed(2))
    : null
  return {
    marketplace,
    marketplaceProductId: productId,
    exactProductMatch: value.exactProductMatch === true,
    authorityContract: text(value.authorityContract, 160),
    capturedAt,
    freshUntil,
    freshness,
    identity: { state: identityState, supported: identitySupported },
    demand: { state: demandState, observedUnitsSold, observationWindowDays,
      supported: demandSupported,
      velocityUnitsPerDay: demandSupported
        ? Number(((observedUnitsSold ?? 0) / (observationWindowDays ?? 1)).toFixed(4))
        : null,
      authoritativeZero: freshness === "FRESH" && demandState === "PROVEN" &&
        observedUnitsSold === 0 },
    economics: { salePriceState, buyerLandedSalePriceUsd, feeState,
      marketplaceFeeUsd, fulfillmentState, fulfillmentCostUsd, promotionState,
      promotionCostUsd, returnsReserveState, returnsReserveUsd,
      otherVariableCostState, otherVariableCostUsd, variableCostUsd,
      supported: economicsSupported },
    eligibility: { state: eligibilityState,
      eligibleToSell: typeof value.eligibleToSell === "boolean"
        ? value.eligibleToSell : null, supported: eligibilitySupported },
  }
}

function evaluateDualMarketChannelV1(
  evidence: NonNullable<ReturnType<typeof normalizeDualMarketEvidenceRowV1>> | null,
  deliveredUnitCostUsd: number | null,
  inboundCostPerUnitUsd: number | null,
) {
  const identityReady = evidence?.identity.supported === true
  const demandReady = evidence?.demand.supported === true
  const economicsReady = evidence?.economics.supported === true
  const eligibilityReady = evidence?.eligibility.supported === true
  const provenZeroDemand = demandReady && evidence?.demand.authoritativeZero === true
  const positiveDemand = demandReady && (evidence?.demand.observedUnitsSold ?? 0) > 0
  const knownIneligible = eligibilityReady && evidence?.eligibility.eligibleToSell === false
  const maxDeliveredUnitCostUsd = economicsReady
    ? Number(((evidence?.economics.buyerLandedSalePriceUsd ?? 0) -
      (evidence?.economics.variableCostUsd ?? 0) - MINIMUM_NET_PROFIT_USD).toFixed(2))
    : null
  const maxSupplierUnitCostUsd = maxDeliveredUnitCostUsd !== null &&
    inboundCostPerUnitUsd !== null
    ? Number((maxDeliveredUnitCostUsd - inboundCostPerUnitUsd).toFixed(2))
    : null
  const expectedNetProfitUsd = economicsReady && deliveredUnitCostUsd !== null
    ? Number(((evidence?.economics.buyerLandedSalePriceUsd ?? 0) -
      (evidence?.economics.variableCostUsd ?? 0) - deliveredUnitCostUsd).toFixed(2))
    : null
  const economicsPass = expectedNetProfitUsd !== null &&
    expectedNetProfitUsd >= MINIMUM_NET_PROFIT_USD &&
    maxDeliveredUnitCostUsd !== null && maxDeliveredUnitCostUsd >= 0
  const decision = provenZeroDemand || knownIneligible ||
    (economicsReady && deliveredUnitCostUsd !== null && !economicsPass)
    ? "REJECT" as const
    : identityReady && positiveDemand && economicsReady && eligibilityReady &&
      evidence?.eligibility.eligibleToSell === true && economicsPass
      ? "GO" as const : "UNPROVEN" as const
  return { evidence, decision, expectedNetProfitUsd, maxDeliveredUnitCostUsd,
    maxSupplierUnitCostUsd, minimumNetProfitUsd: MINIMUM_NET_PROFIT_USD,
    evidenceComplete: identityReady && demandReady && economicsReady && eligibilityReady }
}

export function preview888LotsDualMarketplaceSourcingV1(input: {
  supplierRow: unknown
  capturedAt: string
  marketplaceEvidence: unknown
  now?: Date
  sourceFileDigest?: string | null
}) {
  const now = input.now ?? new Date()
  const candidate = normalize888LotsCatalogRowV1(input.supplierRow, {
    capturedAt: input.capturedAt,
    now,
    sourceFileDigest: input.sourceFileDigest,
    rowNumber: 2,
  })
  const evidenceRows = Array.isArray(input.marketplaceEvidence)
    ? input.marketplaceEvidence.map((entry) =>
      normalizeDualMarketEvidenceRowV1(record(entry) as DualMarketEvidenceRowV1, now))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    : []
  const uniqueEvidence = (marketplace: "EBAY_US" | "AMAZON_US") => {
    const rows = evidenceRows.filter((entry) => entry.marketplace === marketplace)
    return rows.length === 1 ? rows[0] : null
  }
  const unitCostUsd = candidate.costs.unitCostUsd
  const deliveredUnitCostUsd = candidate.costs.status === "SUPPORTED"
    ? candidate.costs.deliveredUnitCostUsd : null
  const inboundCostPerUnitUsd = unitCostUsd !== null && deliveredUnitCostUsd !== null
    ? Number((deliveredUnitCostUsd - unitCostUsd).toFixed(2)) : null
  const ebay = evaluateDualMarketChannelV1(uniqueEvidence("EBAY_US"),
    deliveredUnitCostUsd, inboundCostPerUnitUsd)
  const amazon = evaluateDualMarketChannelV1(uniqueEvidence("AMAZON_US"),
    deliveredUnitCostUsd, inboundCostPerUnitUsd)
  const conservativeMaxSupplierUnitCostUsd = ebay.maxSupplierUnitCostUsd !== null &&
    amazon.maxSupplierUnitCostUsd !== null
    ? Number(Math.min(ebay.maxSupplierUnitCostUsd,
      amazon.maxSupplierUnitCostUsd).toFixed(2)) : null
  const currentCostWithinDualMarketCeiling = unitCostUsd !== null &&
    conservativeMaxSupplierUnitCostUsd !== null
    ? unitCostUsd <= conservativeMaxSupplierUnitCostUsd : null
  const inventoryReady = candidate.inventory.mode === "REPEATABLE_STOCK" &&
    candidate.inventory.freshness === "FRESH" &&
    (candidate.inventory.availableQuantity ?? 0) > 0
  const bothGo = ebay.decision === "GO" && amazon.decision === "GO"
  const anyReject = ebay.decision === "REJECT" || amazon.decision === "REJECT"
  const combinedVelocityUnitsPerDay = bothGo
    ? Number(((ebay.evidence?.demand.velocityUnitsPerDay ?? 0) +
      (amazon.evidence?.demand.velocityUnitsPerDay ?? 0)).toFixed(4)) : null
  const demandBasedInitialUnits = combinedVelocityUnitsPerDay !== null
    ? Math.floor(combinedVelocityUnitsPerDay * INITIAL_BUY_COVERAGE_DAYS *
      INITIAL_BUY_CAPTURE_RATE) : null
  const recommendedPurchaseQuantity = demandBasedInitialUnits !== null &&
    candidate.inventory.availableQuantity !== null
    ? Math.min(demandBasedInitialUnits, candidate.inventory.availableQuantity,
      INITIAL_BUY_MAX_UNITS) : null
  const quantityPassesMoq = recommendedPurchaseQuantity !== null &&
    candidate.inventory.minimumOrderQuantity !== null &&
    recommendedPurchaseQuantity >= candidate.inventory.minimumOrderQuantity &&
    recommendedPurchaseQuantity > 0
  const decision = anyReject || currentCostWithinDualMarketCeiling === false
    ? "REJECT" as const
    : bothGo && inventoryReady && currentCostWithinDualMarketCeiling === true &&
      candidate.condition.status === "SUPPORTED" && quantityPassesMoq
      ? "READY_FOR_OWNER_BUY_REVIEW" as const : "HOLD" as const

  let nextBestEvidence: { action: SellerOs888LotsDualMarketNextActionV1,
    priority: 1, reasonCode: string, authority: string, inventedEvidence: false }
  if (candidate.nextBestEvidence.action === "VERIFY_PRODUCT_FIT") {
    nextBestEvidence = { action: "VERIFY_PRODUCT_FIT", priority: 1,
      reasonCode: "EXACT_SUPPLIER_PRODUCT_IDENTITY_REQUIRED",
      authority: "888LOTS_AUTHORIZED_EXPORT_OR_OWNER_EVIDENCE", inventedEvidence: false }
  } else if (candidate.nextBestEvidence.action === "VERIFY_CONDITION") {
    nextBestEvidence = { action: "VERIFY_CONDITION", priority: 1,
      reasonCode: candidate.nextBestEvidence.reasonCode,
      authority: candidate.nextBestEvidence.authority, inventedEvidence: false }
  } else if (candidate.nextBestEvidence.action === "CAPTURE_DELIVERED_COST") {
    nextBestEvidence = { action: "CAPTURE_DELIVERED_COST", priority: 1,
      reasonCode: candidate.nextBestEvidence.reasonCode,
      authority: candidate.nextBestEvidence.authority, inventedEvidence: false }
  } else if (candidate.nextBestEvidence.action === "WAIT_UPSTREAM") {
    nextBestEvidence = { action: "WAIT_UPSTREAM", priority: 1,
      reasonCode: candidate.nextBestEvidence.reasonCode,
      authority: candidate.nextBestEvidence.authority, inventedEvidence: false }
  } else if (!ebay.evidence?.identity.supported) {
    nextBestEvidence = { action: "VERIFY_PRODUCT_FIT", priority: 1,
      reasonCode: "EXACT_EBAY_PRODUCT_IDENTITY_REQUIRED",
      authority: "CANONICAL_OPPORTUNITY_RESULT_V2", inventedEvidence: false }
  } else if (!amazon.evidence?.identity.supported) {
    nextBestEvidence = { action: "VERIFY_AMAZON_ASIN", priority: 1,
      reasonCode: "EXACT_AMAZON_ASIN_IDENTITY_REQUIRED",
      authority: "AMAZON_CATALOG_ITEMS_READONLY", inventedEvidence: false }
  } else if (!ebay.evidence.demand.supported) {
    nextBestEvidence = { action: "GET_EBAY_EXACT_SOLD", priority: 1,
      reasonCode: "EXACT_EBAY_SOLD_DEMAND_REQUIRED",
      authority: "CANONICAL_OPPORTUNITY_RESULT_V2", inventedEvidence: false }
  } else if (!amazon.evidence.demand.supported) {
    nextBestEvidence = { action: "GET_AMAZON_DEMAND", priority: 1,
      reasonCode: "AMAZON_DEMAND_EVIDENCE_REQUIRED",
      authority: "AMAZON_PRODUCT_OPPORTUNITY_EXPLORER_OR_AUTHORIZED_REPORT",
      inventedEvidence: false }
  } else if (!ebay.evidence.economics.supported) {
    nextBestEvidence = { action: "COMPLETE_EBAY_ECONOMICS", priority: 1,
      reasonCode: "EBAY_PRICE_FEE_AND_FULFILLMENT_REQUIRED",
      authority: "SELLER_OS_COMMERCIAL_GOLDEN_PATH_V1", inventedEvidence: false }
  } else if (!ebay.evidence.eligibility.supported) {
    nextBestEvidence = { action: "RESOLVE_DUPLICATE", priority: 1,
      reasonCode: "EBAY_DUPLICATE_AND_LISTING_ELIGIBILITY_REQUIRED",
      authority: "SELLER_OS_DUPLICATE_GATE", inventedEvidence: false }
  } else if (!amazon.evidence.economics.supported) {
    nextBestEvidence = { action: "COMPLETE_AMAZON_ECONOMICS", priority: 1,
      reasonCode: "AMAZON_PRICE_FEES_AND_FULFILLMENT_REQUIRED",
      authority: "AMAZON_FEES_PROFIT_GUARD_ROI_V1", inventedEvidence: false }
  } else if (!amazon.evidence.eligibility.supported) {
    nextBestEvidence = { action: "VERIFY_AMAZON_ELIGIBILITY", priority: 1,
      reasonCode: "AMAZON_ASIN_CATEGORY_BRAND_ELIGIBILITY_REQUIRED",
      authority: "AMAZON_RESTRICTION_CATEGORY_BRAND_GTIN_GATE_V1", inventedEvidence: false }
  } else if (decision === "READY_FOR_OWNER_BUY_REVIEW") {
    nextBestEvidence = { action: "READY_FOR_OWNER_BUY_REVIEW", priority: 1,
      reasonCode: "DUAL_MARKET_DEMAND_AND_ECONOMICS_SUPPORTED_FOR_REVIEW",
      authority: SELLER_OS_888LOTS_DUAL_MARKET_SOURCING_V1, inventedEvidence: false }
  } else {
    nextBestEvidence = { action: "WAIT_UPSTREAM", priority: 1,
      reasonCode: anyReject ? "DUAL_MARKET_GATE_REJECTED" :
        "SUPPLIER_OR_MARKET_EVIDENCE_NOT_READY",
      authority: SELLER_OS_888LOTS_DUAL_MARKET_SOURCING_V1, inventedEvidence: false }
  }

  const result = {
    contractVersion: SELLER_OS_888LOTS_DUAL_MARKET_SOURCING_V1,
    sourceKey: SELLER_OS_888LOTS_SOURCE_KEY,
    candidate,
    marketplaces: { ebay, amazon },
    sourcing: { decision, conservativeMaxSupplierUnitCostUsd,
      currentSupplierUnitCostUsd: unitCostUsd, currentDeliveredUnitCostUsd: deliveredUnitCostUsd,
      inboundCostPerUnitUsd, currentCostWithinDualMarketCeiling,
      combinedVelocityUnitsPerDay, recommendedPurchaseQuantity,
      quantityPassesMoq,
      quantityReasonCode: recommendedPurchaseQuantity === null
        ? "DUAL_MARKET_DEMAND_REQUIRED"
        : recommendedPurchaseQuantity < 1
          ? "CONSERVATIVE_INITIAL_DEMAND_BELOW_ONE_UNIT"
          : quantityPassesMoq
            ? "CONSERVATIVE_14_DAY_10_PERCENT_CAPTURE_CAPPED_12"
            : "CONSERVATIVE_INITIAL_BUY_BELOW_SUPPLIER_MOQ",
      purchasePolicy: { contractVersion: "SELLER_OS_888LOTS_INITIAL_BUY_POLICY_V1",
        coverageDays: INITIAL_BUY_COVERAGE_DAYS,
        marketCaptureRate: INITIAL_BUY_CAPTURE_RATE,
        maximumInitialUnits: INITIAL_BUY_MAX_UNITS,
        supplierAvailabilityCap: true, supplierMoqRequired: true } },
    nextBestEvidence,
    reusedAuthorities: ["CANONICAL_OPPORTUNITY_RESULT_V2",
      "SELLER_OS_COMMERCIAL_GOLDEN_PATH_V1",
      "AMAZON_CATALOG_ITEMS_READONLY",
      "AMAZON_RESTRICTION_CATEGORY_BRAND_GTIN_GATE_V1",
      "AMAZON_FEES_PROFIT_GUARD_ROI_V1"],
    status: "PREVIEW_ONLY" as const,
    authorization: { canPurchase: false, canPublishEbay: false,
      canPublishAmazon: false, canCreateAmazonAsin: false, canReprice: false },
    safety: { scrapeRequests: 0, databaseWrites: 0, supplierPurchases: 0,
      ebayWrites: 0, amazonWrites: 0, publications: 0, repricing: 0 },
  }
  return { ...result, evidenceDigest: digest(result) }
}
