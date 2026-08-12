import { createHash } from "node:crypto"

export const COMMERCIAL_OPERATIONAL_READINESS_VERSION =
  "SELLER_OS_COMMERCIAL_OPERATIONAL_READINESS_V1_2026_08_11"
export const LUNA_SOURCE_CONTRACT_VERSION = "LUNA_SOURCE_CONTRACT_V1"

function safeText(value: unknown, maximum = 300) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum) || null
    : null
}

function safeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function sourceAgeHours(observedAt: string, now: string) {
  return Math.max(0, (Date.parse(now) - Date.parse(observedAt)) / 3_600_000)
}

export type LunaStockStateV1 = "IN_STOCK_CONFIRMED" | "LOW_STOCK_CONFIRMED" |
  "OUT_OF_STOCK_CONFIRMED" | "STOCK_UNKNOWN" | "STALE_EVIDENCE" |
  "SOURCE_CHANGED" | "PARSE_ERROR"

export type LunaCaptureInputV1 = {
  sourceContractVersion: string
  parserVersion: string
  sourceUrl: string
  productId: string | null
  supplierSku: string | null
  variantId: string | null
  supplierTitle: string | null
  variantTitle: string | null
  regularPrice: number | null
  salePrice: number | null
  currency: string | null
  availability: boolean | null
  visibleStock: number | null
  stockQuantityAuthoritative: boolean
  explicitLowStock: boolean
  stockTextEvidence: string | null
  specifications: Record<string, string>
  packQuantity: number | null
  includedQuantity: number | null
  sourceNarrative: string | null
  marketingClaims: string[]
  imageReferences: string[]
  observedAt: string
}

export function captureLunaProductVariantV1(input: LunaCaptureInputV1, options?: {
  now?: string
  staleAfterHours?: number
}) {
  const now = options?.now ?? new Date().toISOString()
  const staleAfterHours = options?.staleAfterHours ?? 48
  let host: string | null = null
  let exactProductUrl = false
  try {
    const parsed = new URL(input.sourceUrl)
    host = parsed.hostname.toLowerCase()
    exactProductUrl = parsed.protocol === "https:" &&
      ["lunaportex.com", "www.lunaportex.com"].includes(host) &&
      /^\/products\/[^/]+\/?$/.test(parsed.pathname) && !parsed.username &&
      !parsed.password && !parsed.port && !parsed.search && !parsed.hash
  } catch { host = null }
  const identityValid = Boolean(safeText(input.productId, 100) &&
    safeText(input.variantId, 100) && safeText(input.supplierSku, 120) &&
    safeText(input.supplierTitle, 240))
  const timestampValid = Number.isFinite(Date.parse(input.observedAt)) && Number.isFinite(Date.parse(now))
  const sourceChanged = input.sourceContractVersion !== LUNA_SOURCE_CONTRACT_VERSION
  const parseError = !host || !exactProductUrl ||
    !identityValid || !timestampValid
  const explicitOut = input.availability === false ||
    /\b(out of stock|sold out|unavailable)\b/i.test(input.stockTextEvidence ?? "") ||
    (input.stockQuantityAuthoritative && input.visibleStock === 0)
  const explicitLow = input.explicitLowStock ||
    /\b(low stock|only\s+\d+\s+left)\b/i.test(input.stockTextEvidence ?? "")
  const stale = timestampValid && sourceAgeHours(input.observedAt, now) > staleAfterHours
  const stockState: LunaStockStateV1 = parseError ? "PARSE_ERROR"
    : sourceChanged ? "SOURCE_CHANGED"
      : stale ? "STALE_EVIDENCE"
        : explicitOut ? "OUT_OF_STOCK_CONFIRMED"
          : explicitLow ? "LOW_STOCK_CONFIRMED"
            : input.availability === true ? "IN_STOCK_CONFIRMED" : "STOCK_UNKNOWN"
  const safeImages = input.imageReferences.filter((value) => {
    try { return new URL(value).protocol === "https:" } catch { return false }
  }).slice(0, 12)
  return {
    contractVersion: COMMERCIAL_OPERATIONAL_READINESS_VERSION,
    source: "LUNA_PORTEX" as const,
    sourceContractVersion: input.sourceContractVersion,
    parserVersion: safeText(input.parserVersion, 80),
    sourceHealth: parseError ? "PARSE_ERROR" as const
      : sourceChanged ? "SOURCE_CHANGED" as const : stale ? "STALE" as const : "AVAILABLE" as const,
    productIdentity: {
      productId: safeText(input.productId, 100),
      supplierSku: safeText(input.supplierSku, 120),
      variantId: safeText(input.variantId, 100),
      supplierTitle: safeText(input.supplierTitle, 240),
      variantTitle: safeText(input.variantTitle, 160),
    },
    pricing: {
      regularPrice: safeNumber(input.regularPrice), salePrice: safeNumber(input.salePrice),
      currency: safeText(input.currency, 3),
    },
    stock: {
      state: stockState,
      visibleStock: input.stockQuantityAuthoritative ? safeNumber(input.visibleStock) : null,
      stockQuantityAuthoritative: input.stockQuantityAuthoritative,
      evidenceText: safeText(input.stockTextEvidence, 240),
      descriptiveMarketingTextUsedForStock: false as const,
    },
    specifications: Object.fromEntries(Object.entries(input.specifications).slice(0, 80)
      .map(([key, value]) => [safeText(key, 100), safeText(value, 240)])
      .filter(([key, value]) => key && value)),
    packing: { packQuantity: safeNumber(input.packQuantity),
      includedQuantity: safeNumber(input.includedQuantity) },
    sourceNarrative: safeText(input.sourceNarrative, 600),
    marketingClaims: input.marketingClaims.map((value) => safeText(value, 180)).filter(Boolean),
    imageReferences: safeImages,
    observedAt: timestampValid ? new Date(input.observedAt).toISOString() : null,
    sourceUrlFingerprint: `luna_url_${fingerprint(input.sourceUrl).slice(0, 24)}`,
    sourceFingerprint: `luna_capture_${fingerprint({ ...input, sourceUrl: undefined }).slice(0, 24)}`,
    rawSourceUrlExposed: false as const,
  }
}

export function linkSupplierToEbayIdentityV1(input: {
  accountKey: string
  ebayItemId: string
  ebaySku: string | null
  supplierProductId: string | null
  supplierSku: string | null
  supplierVariantId: string | null
  evidenceType: "EXPLICIT_APPROVED_MAPPING" | "SKU_EXACT_ONLY" |
    "TITLE_SIMILARITY_ONLY" | "CONFLICTING_MAPPING" | "NONE"
  observedAt: string
  provenance: string
}) {
  const identityComplete = /^\d{9,19}$/.test(input.ebayItemId) &&
    Boolean(safeText(input.supplierProductId, 100) && safeText(input.supplierVariantId, 100) &&
      safeText(input.supplierSku, 120) && safeText(input.accountKey, 120) &&
      safeText(input.provenance, 160) && Number.isFinite(Date.parse(input.observedAt)))
  const classification = input.evidenceType === "CONFLICTING_MAPPING" ? "CONFLICT" as const
    : input.evidenceType === "EXPLICIT_APPROVED_MAPPING" && identityComplete
      ? "EXACT_PROVEN" as const
      : input.evidenceType === "SKU_EXACT_ONLY" && identityComplete
        ? "STRONG_CANDIDATE_HUMAN_REVIEW" as const : "UNPROVEN" as const
  return {
    contractVersion: COMMERCIAL_OPERATIONAL_READINESS_VERSION,
    accountKey: safeText(input.accountKey, 120),
    ebayItemId: input.ebayItemId,
    ebaySku: safeText(input.ebaySku, 120),
    supplierProductId: safeText(input.supplierProductId, 100),
    supplierSku: safeText(input.supplierSku, 120),
    supplierVariantId: safeText(input.supplierVariantId, 100),
    classification,
    provenance: safeText(input.provenance, 160),
    observedAt: Number.isFinite(Date.parse(input.observedAt))
      ? new Date(input.observedAt).toISOString() : null,
    titleSimilarityAuthorizedAutomaticLink: false as const,
  }
}

export type SupplierEbayIdentityLinkV1 = ReturnType<typeof linkSupplierToEbayIdentityV1>
export type StockRiskClassV2 = "NO_PROVEN_RISK" | "LOW_STOCK_CONFIRMED" |
  "OUT_OF_STOCK_CONFIRMED" | "OVERSELL_RISK" | "STALE_EVIDENCE" |
  "STOCK_UNKNOWN" | "IDENTITY_UNPROVEN"

export function assessStockGuardV2(input: {
  listing: { ebayItemId: string; publishedQuantity: number | null; live: boolean }
  link: SupplierEbayIdentityLinkV1
  supplierCapture: ReturnType<typeof captureLunaProductVariantV1>
  bundleComponents?: Array<{
    componentId: string
    unitsPerSale: number | null
    availableUnits: number | null
    authoritative: boolean
  }>
  experimentActive?: boolean
  criticalSignals?: string[]
}) {
  const components = input.bundleComponents ?? []
  const compositionProven = components.length === 0 || components.every((row) =>
    row.authoritative && Number.isInteger(row.unitsPerSale) && (row.unitsPerSale ?? 0) > 0 &&
    Number.isInteger(row.availableUnits) && (row.availableUnits ?? -1) >= 0)
  const componentCapacity = compositionProven && components.length
    ? Math.min(...components.map((row) => Math.floor(
      (row.availableUnits as number) / (row.unitsPerSale as number)))) : null
  const directCapacity = input.supplierCapture.stock.stockQuantityAuthoritative
    ? input.supplierCapture.stock.visibleStock : null
  const safeCapacity = components.length ? componentCapacity : directCapacity
  const limitingComponent = components.length && compositionProven
    ? [...components].sort((left, right) =>
      Math.floor((left.availableUnits as number) / (left.unitsPerSale as number)) -
      Math.floor((right.availableUnits as number) / (right.unitsPerSale as number)))[0]?.componentId ?? null
    : null
  const stockState = input.supplierCapture.stock.state
  let riskClass: StockRiskClassV2
  if (input.link.classification !== "EXACT_PROVEN" ||
      input.link.ebayItemId !== input.listing.ebayItemId) riskClass = "IDENTITY_UNPROVEN"
  else if (stockState === "STALE_EVIDENCE" || input.supplierCapture.sourceHealth === "STALE") {
    riskClass = "STALE_EVIDENCE"
  } else if (stockState === "OUT_OF_STOCK_CONFIRMED") riskClass = "OUT_OF_STOCK_CONFIRMED"
  else if (stockState === "LOW_STOCK_CONFIRMED") riskClass = "LOW_STOCK_CONFIRMED"
  else if (stockState === "STOCK_UNKNOWN" || stockState === "SOURCE_CHANGED" ||
      stockState === "PARSE_ERROR" || !compositionProven || safeCapacity === null) {
    riskClass = "STOCK_UNKNOWN"
  } else if (input.listing.publishedQuantity !== null &&
      input.listing.publishedQuantity > safeCapacity) riskClass = "OVERSELL_RISK"
  else riskClass = "NO_PROVEN_RISK"
  const hardSignals = new Set(["LISTING_NOT_LIVE", "POLICY_COMPLIANCE_CRITICAL",
    "IDENTITY_CORRUPTION", "ORDER_FULFILLMENT_RISK"])
  const hardOverride = riskClass === "OUT_OF_STOCK_CONFIRMED" || riskClass === "OVERSELL_RISK" ||
    !input.listing.live || (input.criticalSignals ?? []).some((value) => hardSignals.has(value))
  return {
    contractVersion: "STOCK_GUARD_V2",
    ebayItemId: input.listing.ebayItemId,
    stockState,
    supplierStock: input.supplierCapture.stock.visibleStock,
    publishedQuantity: input.listing.publishedQuantity,
    safeSellableCapacity: safeCapacity,
    limitingComponent,
    evidenceFreshness: input.supplierCapture.sourceHealth,
    compositionProven,
    riskClass,
    recommendedAction: riskClass === "NO_PROVEN_RISK" ? "MONITOR" as const
      : riskClass === "IDENTITY_UNPROVEN" ? "HUMAN_REVIEW_IDENTITY" as const
        : riskClass === "STOCK_UNKNOWN" || riskClass === "STALE_EVIDENCE"
          ? "REFRESH_EVIDENCE" as const : "HUMAN_REVIEW_STOCK" as const,
    hardOverrideState: input.experimentActive && hardOverride ? "HARD_OVERRIDE" as const
      : input.experimentActive ? "DO_NOT_TOUCH" as const : "NONE" as const,
    experimentOperationalAction: input.experimentActive && hardOverride
      ? "PAUSE_FOR_EXTERNAL_SIGNAL" as const
      : input.experimentActive ? "WAIT" as const : "NOT_APPLICABLE" as const,
    humanReviewRequired: hardOverride || riskClass === "IDENTITY_UNPROVEN",
    ebayMutationAllowed: false as const,
  }
}

export type EconomicsEvidenceV1 = {
  value: number
  currency: string
  source: string
  observedAt: string
  inputReference: string
}

export function calculateCommercialEconomicsV1(input: {
  revenue?: EconomicsEvidenceV1 | null
  supplierCost?: EconomicsEvidenceV1 | null
  shippingCost?: EconomicsEvidenceV1 | null
  ebayFees?: EconomicsEvidenceV1 | null
  promotedFees?: EconomicsEvidenceV1 | null
}) {
  const entries = [input.revenue, input.supplierCost, input.shippingCost,
    input.ebayFees, input.promotedFees]
  const complete = entries.every((row) => row && Number.isFinite(row.value) && row.value >= 0 &&
    row.currency && row.source && Number.isFinite(Date.parse(row.observedAt)) && row.inputReference)
  const currencies = new Set(entries.filter(Boolean).map((row) => row?.currency))
  if (!complete || currencies.size !== 1 || !input.revenue || input.revenue.value <= 0 ||
      !input.supplierCost || !input.shippingCost || !input.ebayFees || !input.promotedFees) {
    return { contractVersion: "ECONOMICS_FOUNDATION_V1", status: "INSUFFICIENT_EVIDENCE" as const,
      revenue: null, supplierCost: null, shippingCost: null, ebayFees: null,
      promotedFees: null, contribution: null, netProfit: null, margin: null, roi: null,
      missingInputsDefaultedToZero: false as const }
  }
  const contribution = input.revenue.value - input.supplierCost.value - input.shippingCost.value
  const netProfit = contribution - input.ebayFees.value - input.promotedFees.value
  const invested = input.supplierCost.value + input.shippingCost.value
  const metric = (value: number, formula: string) => ({
    value: Math.round(value * 100) / 100,
    currency: input.revenue?.currency ?? null,
    formulaVersion: "COMMERCIAL_ECONOMICS_FORMULA_V1",
    formula,
    inputReferences: entries.map((row) => row?.inputReference).filter(Boolean),
    completeness: "COMPLETE" as const,
  })
  return {
    contractVersion: "ECONOMICS_FOUNDATION_V1",
    status: "AVAILABLE" as const,
    revenue: metric(input.revenue.value, "REVENUE"),
    supplierCost: metric(input.supplierCost.value, "SUPPLIER_COST"),
    shippingCost: metric(input.shippingCost.value, "SHIPPING_COST"),
    ebayFees: metric(input.ebayFees.value, "EBAY_FEES"),
    promotedFees: metric(input.promotedFees.value, "PROMOTED_FEES"),
    contribution: metric(contribution, "REVENUE-SUPPLIER_COST-SHIPPING_COST"),
    netProfit: metric(netProfit, "CONTRIBUTION-EBAY_FEES-PROMOTED_FEES"),
    margin: metric((netProfit / input.revenue.value) * 100, "NET_PROFIT/REVENUE*100"),
    roi: invested > 0 ? metric((netProfit / invested) * 100,
      "NET_PROFIT/(SUPPLIER_COST+SHIPPING_COST)*100") : null,
    missingInputsDefaultedToZero: false as const,
  }
}

export function assessProductCaseOperationalReadinessV1(input: {
  marketResearchReady: boolean
  supplierCaptureReady: boolean
  supplierIdentityReady: boolean
  stockGuardReady: boolean
  economicsReady: boolean
  qualityReportReady: boolean
  ordersReady: boolean
  whatsappDryRunReady: boolean
  experimentOverrideReady: boolean
}) {
  const core = input.marketResearchReady && input.supplierCaptureReady && input.stockGuardReady &&
    input.whatsappDryRunReady && input.experimentOverrideReady
  const externalLimitations = !input.qualityReportReady || !input.ordersReady ||
    !input.supplierIdentityReady || !input.economicsReady
  return {
    ...input,
    productCaseOperationalReadiness: !core ? "NOT_READY" as const
      : externalLimitations ? "READY_WITH_CERTIFIED_EXTERNAL_LIMITATIONS" as const
        : "READY" as const,
    productCaseResumed: false as const,
  }
}
