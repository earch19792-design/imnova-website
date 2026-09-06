import { createHash } from "node:crypto"

export const SELLER_OS_ECONOMIC_EVIDENCE_REFRESH_V1 =
  "SELLER_OS_ECONOMIC_EVIDENCE_REFRESH_V1" as const
export const SELLER_OS_LIVE_PRICE_ECONOMICS_V1 =
  "SELLER_OS_LIVE_PRICE_ECONOMICS_V1" as const

export const ECONOMIC_EVIDENCE_TYPES_V1 = Object.freeze([
  "EBAY_LIVE_PRICE",
  "LUNA_CURRENT_COST",
  "LUNA_CURRENT_SHIPPING",
  "EXPECTED_EBAY_FEE",
  "OTHER_EXPLICIT_COSTS",
] as const)

export type EconomicEvidenceTypeV1 =
  typeof ECONOMIC_EVIDENCE_TYPES_V1[number]
export type EconomicRefreshStatusV1 = "FRESH" | "STALE" | "MISSING" |
  "WAITING_FOR_WORKER" | "REFRESHING" | "SOURCE_UNAVAILABLE" |
  "FAILED_RETRYABLE" | "FAILED_TERMINAL"

export const ECONOMIC_EVIDENCE_MAXIMUM_AGE_SECONDS_V1 = Object.freeze({
  EBAY_LIVE_PRICE: 60 * 60,
  LUNA_CURRENT_COST: 6 * 60 * 60,
  LUNA_CURRENT_SHIPPING: 6 * 60 * 60,
  EXPECTED_EBAY_FEE: 24 * 60 * 60,
  OTHER_EXPLICIT_COSTS: 24 * 60 * 60,
} satisfies Record<EconomicEvidenceTypeV1, number>)

type JsonRecord = Record<string, unknown>

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"))
      .map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}

export function economicEvidenceDigestV1(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value))).digest("hex")}`
}

function money(value: number) {
  return Number((Math.round((value + Number.EPSILON) * 10_000) / 10_000)
    .toFixed(4))
}

function validMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

export function economicRefreshJobKeyV1(input: Readonly<{
  accountKey: string
  marketplaceId: "EBAY_US"
  itemId: string
  evidenceType: EconomicEvidenceTypeV1
}>) {
  return `economic-refresh-v1:${economicEvidenceDigestV1({
    contract: SELLER_OS_ECONOMIC_EVIDENCE_REFRESH_V1,
    ...input,
  })}`
}

export function buildEconomicEvidenceV1(input: Readonly<{
  accountKey: string
  itemId: string
  evidenceType: EconomicEvidenceTypeV1
  value: number | null
  sourceAuthority: string
  sourceEntityId: string
  capturedAt: string
  status: EconomicRefreshStatusV1
  limitationCode?: string | null
  metadata?: JsonRecord
}>) {
  if (!/^\d{9,20}$/.test(input.itemId) ||
      !Number.isFinite(Date.parse(input.capturedAt)) ||
      (input.value !== null && !validMoney(input.value)) ||
      (input.status === "FRESH" && input.value === null)) {
    throw new Error("SELLER_OS_ECONOMIC_EVIDENCE_INVALID")
  }
  const capturedAt = new Date(input.capturedAt).toISOString()
  const freshUntil = input.status === "FRESH"
    ? new Date(Date.parse(capturedAt) +
      ECONOMIC_EVIDENCE_MAXIMUM_AGE_SECONDS_V1[input.evidenceType] * 1_000)
      .toISOString()
    : null
  const body = Object.freeze({
    contractVersion: SELLER_OS_ECONOMIC_EVIDENCE_REFRESH_V1,
    marketplaceAccountKey: input.accountKey,
    marketplaceId: "EBAY_US" as const,
    ebayItemId: input.itemId,
    evidenceType: input.evidenceType,
    valueAmount: input.value === null ? null : money(input.value),
    valueCurrency: input.value === null ? null : "USD" as const,
    sourceAuthority: input.sourceAuthority,
    sourceEntityId: input.sourceEntityId,
    capturedAt,
    freshUntil,
    freshnessStatus: input.status,
    limitationCode: input.limitationCode ?? null,
    evidenceMetadata: input.metadata ?? {},
  })
  const evidenceDigest = economicEvidenceDigestV1(body)
  return Object.freeze({
    evidence_id: `economic-evidence-v1:${evidenceDigest}`,
    marketplace_account_key: input.accountKey,
    marketplace_id: "EBAY_US" as const,
    ebay_item_id: input.itemId,
    evidence_type: input.evidenceType,
    value_amount: body.valueAmount,
    value_currency: body.valueCurrency,
    source_authority: input.sourceAuthority,
    source_entity_id: input.sourceEntityId,
    captured_at: capturedAt,
    fresh_until: freshUntil,
    freshness_status: input.status,
    limitation_code: body.limitationCode,
    evidence_digest: evidenceDigest,
    evidence_metadata: body.evidenceMetadata,
  })
}

export type LatestEconomicEvidenceV1 = Readonly<{
  evidence_id: string
  evidence_type: EconomicEvidenceTypeV1
  value_amount: number | string | null
  fresh_until: string | null
  freshness_status: EconomicRefreshStatusV1
}>

export function evidenceIsFreshV1(
  evidence: LatestEconomicEvidenceV1 | null | undefined,
  now = Date.now(),
) {
  return evidence?.freshness_status === "FRESH" &&
    evidence.value_amount !== null &&
    validMoney(Number(evidence.value_amount)) &&
    Boolean(evidence.fresh_until) &&
    Number.isFinite(Date.parse(evidence.fresh_until!)) &&
    Date.parse(evidence.fresh_until!) >= now
}

export function calculateLiveEconomicsV1(input: Readonly<{
  accountKey: string
  itemId: string
  evidence: Partial<Record<EconomicEvidenceTypeV1,
    LatestEconomicEvidenceV1 | null>>
  calculatedAt?: string
}>) {
  const required = ECONOMIC_EVIDENCE_TYPES_V1
  const missing = required.filter((type) =>
    !evidenceIsFreshV1(input.evidence[type],
      Date.parse(input.calculatedAt ?? new Date().toISOString())))
  const rawValues = Object.fromEntries(required.map((type) => [type,
    missing.includes(type) ? null : Number(input.evidence[type]!.value_amount)]))
  const values = rawValues as Record<EconomicEvidenceTypeV1, number | null>
  const status = missing.length === 0 ? "PROVEN" as const
    : missing.length === required.length ? "UNPROVEN" as const
      : "PARTIAL" as const
  const livePrice = values.EBAY_LIVE_PRICE
  const lunaCost = values.LUNA_CURRENT_COST
  const shipping = values.LUNA_CURRENT_SHIPPING
  const fee = values.EXPECTED_EBAY_FEE
  const other = values.OTHER_EXPLICIT_COSTS
  const expectedProfit = status === "PROVEN"
    ? money(livePrice! - lunaCost! - shipping! - fee! - other!) : null
  const margin = status === "PROVEN" && livePrice! > 0
    ? money(expectedProfit! / livePrice! * 100) : null
  const invested = status === "PROVEN" ? lunaCost! + shipping! + other! : null
  const roi = status === "PROVEN" && invested! > 0
    ? money(expectedProfit! / invested! * 100) : null
  const calculatedAt = new Date(input.calculatedAt ?? Date.now()).toISOString()
  const inputEvidenceIds = Object.fromEntries(required.map((type) =>
    [type, input.evidence[type]?.evidence_id ?? null]))
  const body = Object.freeze({
    formulaVersion: SELLER_OS_LIVE_PRICE_ECONOMICS_V1,
    marketplaceAccountKey: input.accountKey,
    marketplaceId: "EBAY_US",
    ebayItemId: input.itemId,
    livePrice, lunaCost, lunaShipping: shipping,
    expectedEbayFee: fee, otherExplicitCosts: other,
    expectedProfit, marginPercent: margin, roiPercent: roi,
    inputEvidenceIds, missingEconomicInputs: missing,
    marketPriceStatus: "UNPROVEN",
    pricePositionStatus: "POR_COMPROBAR",
  })
  const digest = economicEvidenceDigestV1(body)
  return Object.freeze({
    readback_id: `live-economics-v1:${digest}`,
    marketplace_account_key: input.accountKey,
    marketplace_id: "EBAY_US" as const,
    ebay_item_id: input.itemId,
    status,
    live_price: livePrice,
    luna_cost: lunaCost,
    luna_shipping: shipping,
    expected_ebay_fee: fee,
    other_explicit_costs: other,
    expected_profit: expectedProfit,
    margin_percent: margin,
    roi_percent: roi,
    input_evidence_ids: inputEvidenceIds,
    missing_economic_inputs: missing,
    formula_version: SELLER_OS_LIVE_PRICE_ECONOMICS_V1,
    market_price_status: "UNPROVEN" as const,
    price_position_status: "POR_COMPROBAR" as const,
    calculated_at: calculatedAt,
    calculation_digest: digest,
  })
}

export function ownerEconomicStatusV1(status: EconomicRefreshStatusV1) {
  if (status === "FRESH") return "actualizado" as const
  if (status === "REFRESHING") return "actualizando" as const
  if (status === "WAITING_FOR_WORKER") return "esperando worker" as const
  if (status === "STALE") return "evidencia vencida" as const
  if (status === "MISSING") return "por comprobar" as const
  if (status === "SOURCE_UNAVAILABLE") return "fuente no disponible" as const
  if (status === "FAILED_RETRYABLE") return "recuperando" as const
  return "no disponible" as const
}
