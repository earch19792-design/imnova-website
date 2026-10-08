import { sellerOsRoiMarginPolicyContractV2 } from
  "../marketplace/seller-os-roi-margin-policy-v2"

export const SELLER_OS_MARKETPLACE_COMMERCIAL_PORTFOLIO_V1 =
  "SELLER_OS_MARKETPLACE_COMMERCIAL_PORTFOLIO_V1" as const

type Json = Record<string, unknown>

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Json : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum) : null
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value : null
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => text(item, 80) ? [String(item)] : []) : []
}

function amazonProduct(cardValue: unknown) {
  const card = record(cardValue)
  const observation = record(card.observation)
  const product = record(observation.product)
  const performance = record(observation.performance)
  const listing = record(observation.amazonListing)
  const supplier = record(observation.supplier)
  const gate = record(card.purchaseGate)
  const gateProduct = record(gate.product)
  const authoritative = performance.authoritative === true
  return Object.freeze({
    productKey: text(product.asin, 20) ?? text(listing.sellerSku, 160) ??
      text(card.id, 160) ?? "AMAZON_PRODUCT_UNIDENTIFIED",
    title: text(product.title) ?? text(card.title) ?? "Producto sin título",
    categoryId: text(product.category, 160) ?? "UNMAPPED",
    categoryName: text(product.category, 160) ?? "Sin mapear",
    asin: text(product.asin, 20), sellerSku: text(listing.sellerSku, 160),
    upc: text(product.upc, 40),
    identityKeys: Object.freeze(text(product.upc, 40)
      ? [`GTIN:${String(product.upc).replace(/\D/g, "")}`] : []),
    listingState: text(listing.state, 40) ?? "UNKNOWN",
    supplierName: text(supplier.name, 160),
    supplierSku: text(supplier.sku, 240),
    unitsSold: authoritative ? number(performance.observedUnitsSold) : null,
    grossSalesUsd: authoritative ? number(performance.grossSalesUsd) : null,
    actualNetProfitUsd: authoritative
      ? finiteNumber(performance.actualNetProfitUsd) : null,
    actualNetProfitPerUnitUsd: authoritative
      ? finiteNumber(performance.actualNetProfitPerUnitUsd) : null,
    velocityUnitsPerDay: authoritative
      ? number(performance.velocityUnitsPerDay) : null,
    observationWindowDays: authoritative
      ? number(performance.observationWindowDays) : null,
    performanceFreshness: text(performance.freshness, 40) ?? "UNKNOWN",
    performanceAuthority: authoritative,
    falseZeroGuard: text(performance.falseZeroGuard, 80) ?? "UNKNOWN",
    purchaseDecision: text(gate.decision, 40) ?? "WAIT",
    recommendedPurchaseQuantity: number(gate.recommendedPurchaseQuantity),
    maximumSupplierUnitCostUsd: number(record(gate.economics)
      .maximumSupplierUnitCostUsd),
    nextBestEvidence: record(gate.nextBestEvidence),
    sourceHref: "/admin/marketplace/amazon/connie",
  })
}

function amazonCategories(products: readonly ReturnType<
  typeof amazonProduct>[]) {
  const groups = new Map<string, {
    name: string; products: number; measured: number; units: number
    gross: number; profit: number; grossComplete: boolean; profitComplete: boolean
  }>()
  for (const product of products) {
    const key = product.categoryId
    const current = groups.get(key) ?? { name: product.categoryName,
      products: 0, measured: 0, units: 0, gross: 0, profit: 0,
      grossComplete: true, profitComplete: true }
    current.products += 1
    if (product.performanceAuthority) current.measured += 1
    if (product.unitsSold !== null) current.units += product.unitsSold
    if (product.grossSalesUsd === null) current.grossComplete = false
    else current.gross += product.grossSalesUsd
    if (product.actualNetProfitUsd === null) current.profitComplete = false
    else current.profit += product.actualNetProfitUsd
    groups.set(key, current)
  }
  return Object.freeze([...groups].map(([categoryId, item]) => Object.freeze({
    categoryId, categoryName: item.name, productCount: item.products,
    measuredProductCount: item.measured,
    evidenceCoverage: item.products > 0 ? item.measured / item.products : null,
    unitsSold: item.measured > 0 ? item.units : null,
    grossSalesUsd: item.measured > 0 && item.grossComplete ? item.gross : null,
    actualNetProfitUsd: item.measured > 0 && item.profitComplete
      ? item.profit : null,
    mappingStatus: categoryId === "UNMAPPED" ? "UNMAPPED" : "MAPPED",
  })).sort((left, right) =>
    (right.unitsSold ?? -1) - (left.unitsSold ?? -1) ||
    (right.grossSalesUsd ?? -1) - (left.grossSalesUsd ?? -1)))
}

type QueueEntry = Readonly<{
  key: string; priority: number; marketplace: "EBAY_US" | "AMAZON_US"
  action: string; label: string; detail: string; productKey: string
  title: string; categoryName: string | null; href: string
  recommendedPurchaseQuantity: number | null
  maximumSupplierUnitCostUsd: number | null
  evidenceState: "PROVEN" | "UNPROVEN" | "UNAVAILABLE"
  automaticExecutionAllowed: false
}>

function action(entry: Omit<QueueEntry, "automaticExecutionAllowed">) {
  return Object.freeze({ ...entry, automaticExecutionAllowed: false as const })
}

function queueForAmazon(product: ReturnType<typeof amazonProduct>) {
  const decision = product.purchaseDecision
  const nextEvidence = text(product.nextBestEvidence.action, 80) ??
    "WAIT_UPSTREAM"
  if (decision === "BUY") return action({ key: `AMAZON:${product.productKey}`,
    priority: 1, marketplace: "AMAZON_US", action: "REVIEW_REORDER",
    label: "Revisar recompra Amazon", title: product.title,
    productKey: product.productKey, categoryName: product.categoryName,
    detail: "Movimiento y utilidad comprobados; la compra requiere aprobación.",
    href: product.sourceHref,
    recommendedPurchaseQuantity: product.recommendedPurchaseQuantity,
    maximumSupplierUnitCostUsd: product.maximumSupplierUnitCostUsd,
    evidenceState: "PROVEN" })
  if (decision === "SMALL_TEST") return action({
    key: `AMAZON:${product.productKey}`, priority: 2,
    marketplace: "AMAZON_US", action: "REVIEW_SMALL_TEST",
    label: "Revisar prueba pequeña Amazon", title: product.title,
    productKey: product.productKey, categoryName: product.categoryName,
    detail: "La evidencia permite una prueba limitada, no una compra automática.",
    href: product.sourceHref,
    recommendedPurchaseQuantity: product.recommendedPurchaseQuantity,
    maximumSupplierUnitCostUsd: product.maximumSupplierUnitCostUsd,
    evidenceState: "PROVEN" })
  return action({ key: `AMAZON:${product.productKey}`, priority:
    decision === "REJECT" ? 6 : 5, marketplace: "AMAZON_US",
    action: nextEvidence, label: decision === "REJECT"
      ? "Revisar descarte Amazon" : "Completar evidencia Amazon",
    title: product.title, productKey: product.productKey,
    categoryName: product.categoryName,
    detail: `Siguiente evidencia: ${nextEvidence}.`, href: product.sourceHref,
    recommendedPurchaseQuantity: null, maximumSupplierUnitCostUsd:
      product.maximumSupplierUnitCostUsd,
    evidenceState: nextEvidence === "WAIT_UPSTREAM" ? "UNAVAILABLE"
      : "UNPROVEN" })
}

function normalizedEbayProducts(ebay: Json) {
  const products = record(ebay.products)
  return Array.isArray(products.windows) ? products.windows.map(record) : []
}

export function buildSellerOsMarketplaceCommercialPortfolioV1(input: {
  ebayInsights: unknown
  amazonPerformance: unknown | null
  amazonAuthorityAvailable: boolean
  amazonUnavailableReason?: string | null
}) {
  const ebay = record(input.ebayInsights)
  const ebaySales = record(ebay.sales)
  const ebayCategories = record(ebay.categories)
  const ebayProductWindows = normalizedEbayProducts(ebay)
  const amazon = record(input.amazonPerformance)
  const amazonProducts = (Array.isArray(amazon.cards) ? amazon.cards : [])
    .map(amazonProduct).sort((left, right) =>
      (right.unitsSold ?? -1) - (left.unitsSold ?? -1) ||
      (right.actualNetProfitUsd ?? -1) - (left.actualNetProfitUsd ?? -1))
  const amazonCategoryRanking = amazonCategories(amazonProducts)
  const queue = new Map<string, QueueEntry>()
  const put = (entry: QueueEntry) => {
    const current = queue.get(entry.key)
    if (!current || entry.priority < current.priority) queue.set(entry.key, entry)
  }
  for (const product of amazonProducts) put(queueForAmazon(product))

  const repairQueue = Array.isArray(record(ebay.products).mappingRepairQueue)
    ? record(ebay.products).mappingRepairQueue as unknown[] : []
  for (const value of repairQueue) {
    const product = record(value)
    const productKey = text(product.productKey, 160) ?? "EBAY_UNIDENTIFIED"
    put(action({ key: `EBAY:${productKey}`, priority: 3,
      marketplace: "EBAY_US", action: "RESOLVE_CATEGORY",
      label: "Mapear categoría eBay", productKey,
      title: text(product.title) ?? `Listing ${productKey}`,
      categoryName: null,
      detail: "Tiene ventas oficiales, pero la categoría canónica falta.",
      href: "/admin/ebay/listings",
      recommendedPurchaseQuantity: null, maximumSupplierUnitCostUsd: null,
      evidenceState: "UNPROVEN" }))
  }

  const longestWindow = [...ebayProductWindows].sort((left, right) =>
    Number(right.days ?? 0) - Number(left.days ?? 0))[0] ?? {}
  const ebayProducts = Array.isArray(longestWindow.products)
    ? longestWindow.products.map(record) : []
  for (const product of ebayProducts) {
    const productKey = text(product.productKey, 160) ?? "EBAY_UNIDENTIFIED"
    if (product.supplierLinkStatus === "MISSING") put(action({
      key: `EBAY:${productKey}`, priority: 4, marketplace: "EBAY_US",
      action: "RESOLVE_SUPPLIER_LINK", label: "Vincular proveedor eBay",
      productKey, title: text(product.title) ?? `Listing ${productKey}`,
      categoryName: text(product.categoryName, 160),
      detail: "El producto vende, pero no puede evaluarse la recompra sin proveedor exacto.",
      href: "/admin/ebay/listings", recommendedPurchaseQuantity: null,
      maximumSupplierUnitCostUsd: null, evidenceState: "UNPROVEN" }))
  }

  const ebayByIdentity = new Map<string, Json>()
  for (const product of ebayProducts) for (const identity of
    strings(product.identityKeys)) ebayByIdentity.set(identity, product)
  for (const amazonProductItem of amazonProducts) {
    const match = amazonProductItem.identityKeys.map((identity) =>
      ebayByIdentity.get(identity)).find(Boolean)
    if (!match) continue
    const ebayUnits = number(match.unitsSold)
    if (ebayUnits !== null && ebayUnits > 0 &&
        amazonProductItem.listingState !== "ACTIVE") {
      put(action({ key: `AMAZON:${amazonProductItem.productKey}`, priority: 3,
        marketplace: "AMAZON_US", action: "REVIEW_CROSS_LIST_AMAZON",
        label: "Revisar oportunidad eBay → Amazon",
        productKey: amazonProductItem.productKey,
        title: amazonProductItem.title,
        categoryName: amazonProductItem.categoryName,
        detail: "UPC exacto y ventas eBay comprobadas; validar elegibilidad y economics Amazon.",
        href: amazonProductItem.sourceHref, recommendedPurchaseQuantity: null,
        maximumSupplierUnitCostUsd: amazonProductItem.maximumSupplierUnitCostUsd,
        evidenceState: "PROVEN" }))
    }
    if ((amazonProductItem.unitsSold ?? 0) > 0 &&
        match.listingStatus !== "ACTIVE") {
      const ebayKey = text(match.productKey, 160) ?? "EBAY_UNIDENTIFIED"
      put(action({ key: `EBAY:${ebayKey}`, priority: 3,
        marketplace: "EBAY_US", action: "REVIEW_CROSS_LIST_EBAY",
        label: "Revisar oportunidad Amazon → eBay", productKey: ebayKey,
        title: text(match.title) ?? amazonProductItem.title,
        categoryName: text(match.categoryName, 160),
        detail: "UPC exacto y movimiento Amazon comprobado; validar demanda y economics eBay.",
        href: "/admin/ebay/quick-pick", recommendedPurchaseQuantity: null,
        maximumSupplierUnitCostUsd: null, evidenceState: "PROVEN" }))
    }
  }

  return Object.freeze({
    contractVersion: SELLER_OS_MARKETPLACE_COMMERCIAL_PORTFOLIO_V1,
    economicPolicy: sellerOsRoiMarginPolicyContractV2(),
    ebay: Object.freeze({ marketplace: "EBAY_US" as const,
      status: text(ebaySales.status, 40) ?? "UNAVAILABLE",
      freshness: text(ebaySales.freshness, 40) ?? "UNKNOWN",
      sourceUpdatedAt: text(ebaySales.sourceUpdatedAt, 80),
      productWindows: Object.freeze(ebayProductWindows),
      categoryWindows: Object.freeze(Array.isArray(ebayCategories.windows)
        ? ebayCategories.windows : []),
      categoryStatus: text(ebayCategories.status, 40) ?? "UNAVAILABLE",
      categoryUnmappedCount: number(ebayCategories.unmappedCount),
    }),
    amazon: Object.freeze({ marketplace: "AMAZON_US" as const,
      status: !input.amazonAuthorityAvailable ? "UNAVAILABLE" as const
        : amazonProducts.some((product) => !product.performanceAuthority)
          ? "PARTIAL" as const : "AVAILABLE" as const,
      unavailableReason: input.amazonAuthorityAvailable ? null
        : input.amazonUnavailableReason ?? "AMAZON_AUTHORITY_UNAVAILABLE",
      products: Object.freeze(amazonProducts),
      categories: amazonCategoryRanking,
      summary: record(amazon.summary),
    }),
    actionQueue: Object.freeze([...queue.values()].sort((left, right) =>
      left.priority - right.priority || left.title.localeCompare(right.title))
      .slice(0, 20)),
    crossMarketplace: Object.freeze({
      identityRule: "EXACT_UPC_ONLY" as const,
      titleSimilarityUsed: false as const,
      verifiedOpportunityCount: [...queue.values()].filter((entry) =>
        entry.action.startsWith("REVIEW_CROSS_LIST_")).length,
      absenceWithoutExactIdentityRemainsUnproven: true as const,
    }),
    safety: Object.freeze({ readOnly: true as const, marketplaceWrites: 0,
      supplierPurchases: 0, automaticReorders: 0,
      roiMarginPolicyPreserved: true as const,
      falseZeroGuard: true as const }),
  })
}
