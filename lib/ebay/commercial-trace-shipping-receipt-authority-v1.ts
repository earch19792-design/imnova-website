import { LUNA_HTTP_SHIPPING_SOURCE } from
  "./ebay-luna-authoritative-shipping-v1"
import { LIVE_LISTING_SHIPPING_MAXIMUM_AGE_SECONDS } from
  "./ebay-live-listing-shipping-evidence-v1"
import { LUNA_SHIPPING_QUOTE_CAPTURE_VERSION } from
  "./ebay-luna-chrome-shipping-capture-v1"

const RECEIPT_VERSION = "SELLER_OS_COMMERCIAL_TRACE_LUNA_SHIPPING_RECEIPT_V1"
const SHA256 = /^sha256:[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type JsonRecord = Record<string, unknown>
const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}

/** The event ledger is the durable receipt. A frontier calculation timestamp
 * is never allowed to renew the age of the underlying supplier observation. */
export function certifyCommercialTraceShippingReceiptV1(input: Readonly<{
  receipt: unknown
  receiptId: unknown
  capturedAt: unknown
  expected: Readonly<{
    traceId: string
    candidateId: string
    lunaProductId: string
    lunaVariantId: string
    supplierSku: string
    sourceFingerprint: string
    fieldTruthEvidenceDigest: string
    destinationProfileDigest: string
  }>
  allowCrossTraceReuse?: boolean
  now?: number
}>) {
  const receipt = record(input.receipt)
  const now = input.now ?? Date.now()
  const observedAt = String(receipt.observedAt ?? "")
  const observed = Date.parse(observedAt)
  const capturedAt = String(input.capturedAt ?? "")
  const captured = Date.parse(capturedAt)
  const maximumAgeMs = LIVE_LISTING_SHIPPING_MAXIMUM_AGE_SECONDS * 1_000
  const shippingUsd = typeof receipt.shippingUsd === "number" ||
    typeof receipt.shippingUsd === "string" &&
      /^\d+(?:\.\d{1,2})?$/.test(receipt.shippingUsd)
    ? Number(receipt.shippingUsd) : Number.NaN
  if (!UUID.test(String(input.receiptId ?? "")) ||
      receipt.contractVersion !== RECEIPT_VERSION ||
      receipt.shippingContractVersion !== LUNA_SHIPPING_QUOTE_CAPTURE_VERSION ||
      (!input.allowCrossTraceReuse && receipt.traceId !== input.expected.traceId) ||
      !UUID.test(String(receipt.traceId ?? "")) ||
      receipt.candidateId !== input.expected.candidateId ||
      receipt.lunaProductId !== input.expected.lunaProductId ||
      receipt.lunaVariantId !== input.expected.lunaVariantId ||
      receipt.supplierSku !== input.expected.supplierSku ||
      receipt.sourceFingerprint !== input.expected.sourceFingerprint ||
      receipt.fieldTruthEvidenceDigest !==
        input.expected.fieldTruthEvidenceDigest ||
      receipt.destinationProfileDigest !== input.expected.destinationProfileDigest ||
      receipt.canonicalDestinationMatch !== true ||
      receipt.quantity !== 1 || receipt.currency !== "USD" ||
      receipt.acquisitionMethod !== LUNA_HTTP_SHIPPING_SOURCE ||
      receipt.noPurchase !== true || receipt.noCredentials !== true ||
      receipt.noRawDestinationAddress !== true ||
      !SHA256.test(String(receipt.evidenceDigest ?? "")) ||
      !Number.isFinite(shippingUsd) || shippingUsd < 0 ||
      !Number.isFinite(observed) || observed > now + 60_000 ||
      observed + maximumAgeMs <= now ||
      !Number.isFinite(captured) || captured + 60_000 < observed ||
      captured > now + 60_000) {
    return null
  }
  return Object.freeze({ amountUsd: shippingUsd, observedAt,
    capturedAt, freshUntil: new Date(observed + maximumAgeMs).toISOString(),
    durableReceiptId: String(input.receiptId),
    sourceTraceId: String(receipt.traceId),
    evidenceDigest: String(receipt.evidenceDigest),
    sourceFingerprint: input.expected.sourceFingerprint,
    fieldTruthEvidenceDigest: input.expected.fieldTruthEvidenceDigest,
    acquisitionMethod: LUNA_HTTP_SHIPPING_SOURCE,
    canonicalDestinationMatch: true as const,
    canonicalDestinationCountryClass: "US" as const,
    destinationProfileDigest: input.expected.destinationProfileDigest,
    quantity: 1 as const, noPurchase: true as const,
    noCredentials: true as const, rawAddressPersisted: false as const,
    shippingServiceStatus: "UNKNOWN" as const,
    shippingService: null, marketplaceWrites: 0 as const })
}
