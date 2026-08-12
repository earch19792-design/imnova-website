// @ts-check

import { createHash } from "node:crypto"

const PRIVATE_BUYER_KEYS = new Set([
  "buyer",
  "buyercheckoutnotes",
  "buyerusername",
  "email",
  "phone",
  "phonenumber",
  "address",
  "addressline1",
  "addressline2",
  "city",
  "county",
  "postalcode",
  "stateorprovince",
  "recipient",
  "shipto",
  "shippingaddress",
  "contactaddress",
  "fullname",
])

/** @type {"LUNA_SUPPLIER_STOCK_WATCHER_V1_2026_08_12"} */
export const LUNA_WATCHER_APPROVAL_CONTRACT_VERSION_V1 =
  "LUNA_SUPPLIER_STOCK_WATCHER_V1_2026_08_12"
/** @type {"seller_os_luna_watcher_v1"} */
export const LUNA_WATCHER_APPROVAL_RAW_PAYLOAD_KEY_V1 =
  "seller_os_luna_watcher_v1"

/** @param {unknown} value */
function readonlyRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {}
}

/** @param {unknown} value @param {number} [maximum] */
function readonlySafeText(value, maximum = 200) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum) || null
    : null
}

/**
 * Canonical URL accepted by the Luna approval contract. Credentials, query
 * parameters, fragments, non-HTTPS URLs, and non-product paths fail closed.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function canonicalLunaApprovalSourceUrlV1(value) {
  const raw = readonlySafeText(value, 500)
  if (!raw) return null
  try {
    const source = new URL(raw)
    if (
      source.protocol !== "https:" ||
      !["lunaportex.com", "www.lunaportex.com"].includes(source.hostname) ||
      !/^\/products\/[^/]+\/?$/.test(source.pathname) ||
      source.username || source.password || source.port || source.search ||
      source.hash
    ) return null
    return `${source.origin}${source.pathname.replace(/\/$/, "")}`
  } catch {
    return null
  }
}

/**
 * @typedef {object} LunaWatcherStoredHumanApprovalV1
 * @property {"LUNA_SUPPLIER_STOCK_WATCHER_V1_2026_08_12"} contractVersion
 * @property {"EXACT_PROVEN"} classification
 * @property {true} humanApproved
 * @property {string} ebayItemId
 * @property {string} supplierProductId
 * @property {string} supplierVariantId
 * @property {string} supplierSku
 * @property {string} canonicalSourceUrl
 * @property {string} approvedAt
 * @property {string} approvalProvenance
 */

/**
 * Pure, read-only approval-envelope parser shared by the canonical monitor and
 * the Luna scheduler. Every listing-bound identity field must agree exactly.
 *
 * @param {{rawPayload: unknown, ebayItemId: string | null,
 * supplierVariantId: string | null, supplierSku: string | null}} input
 * @returns {LunaWatcherStoredHumanApprovalV1 | null}
 */
export function readLunaWatcherHumanApprovalContractV1(input) {
  const payload = readonlyRecord(input.rawPayload)
  const approval = readonlyRecord(
    payload[LUNA_WATCHER_APPROVAL_RAW_PAYLOAD_KEY_V1],
  )
  const ebayItemId = readonlySafeText(approval.ebayItemId, 30)
  const supplierProductId = readonlySafeText(approval.supplierProductId, 100)
  const supplierVariantId = readonlySafeText(approval.supplierVariantId, 100)
  const supplierSku = readonlySafeText(approval.supplierSku, 120)
  const canonicalSourceUrl = canonicalLunaApprovalSourceUrlV1(
    approval.canonicalSourceUrl,
  )
  const approvedAt = readonlySafeText(approval.approvedAt, 50)
  const approvalProvenance = readonlySafeText(
    approval.approvalProvenance,
    200,
  )
  if (
    approval.contractVersion !== LUNA_WATCHER_APPROVAL_CONTRACT_VERSION_V1 ||
    approval.classification !== "EXACT_PROVEN" ||
    approval.humanApproved !== true ||
    !ebayItemId || ebayItemId !== readonlySafeText(input.ebayItemId, 30) ||
    !supplierProductId || !supplierVariantId ||
    supplierVariantId !== readonlySafeText(input.supplierVariantId, 100) ||
    !supplierSku || supplierSku !== readonlySafeText(input.supplierSku, 120) ||
    !canonicalSourceUrl || !approvedAt ||
    !Number.isFinite(Date.parse(approvedAt)) || !approvalProvenance
  ) return null
  return {
    contractVersion: LUNA_WATCHER_APPROVAL_CONTRACT_VERSION_V1,
    classification: "EXACT_PROVEN",
    humanApproved: true,
    ebayItemId,
    supplierProductId,
    supplierVariantId,
    supplierSku,
    canonicalSourceUrl,
    approvedAt,
    approvalProvenance,
  }
}

/**
 * Extracted without semantic change from commercial-monitor-domain so the
 * canonical read-only graph does not import its rule engine, pack inference,
 * persistence-oriented summaries, or dispatch formatting.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function containsPrivateBuyerData(value) {
  if (Array.isArray(value)) return value.some(containsPrivateBuyerData)
  if (!value || typeof value !== "object") return false
  return Object.entries(/** @type {Record<string, unknown>} */ (value))
    .some(([key, nested]) =>
      PRIVATE_BUYER_KEYS.has(key.toLowerCase()) ||
      containsPrivateBuyerData(nested)
    )
}

/**
 * Exact unique reconciliation; missing and ambiguous matches both fail closed.
 *
 * @template T
 * @param {{productId: string, variantId: string, sku: string}} listing
 * @param {Array<{productId: string | null, variantId: string | null, sku: string | null, value: T}>} supplies
 * @returns {T | null}
 */
export function selectExactReadonlySupply(listing, supplies) {
  const matches = supplies.filter((row) =>
    row.productId === listing.productId &&
    row.variantId === listing.variantId &&
    row.sku === listing.sku
  )
  return matches.length === 1 ? matches[0].value : null
}

/**
 * Extracted SHA-256 event-key behavior; only the digest leaves the server.
 *
 * @param {...(string | number | null | undefined)} parts
 */
export function stableReadonlyCommercialKey(...parts) {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex")
  return `commercial-readonly-v1:${digest}`
}

/** @param {unknown} value */
function timestamp(value) {
  const parsed = Date.parse(typeof value === "string" ? value : "")
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Validates the persisted Analytics envelope before any numeric value is used.
 * A reporting window and capture timestamp are mandatory even for PARTIAL data.
 *
 * @param {{sourceAnalytics: unknown, completenessStatus: unknown,
 * observedAt: unknown, windowStart: unknown, windowEnd: unknown,
 * syntheticFallbackUsed: unknown, fixtureEvidenceUsed: unknown,
 * now: Date, maximumAgeSeconds: number}} input
 */
export function classifyStoredAnalyticsEvidence(input) {
  const observedAt = timestamp(input.observedAt)
  const windowStart = timestamp(input.windowStart)
  const windowEnd = timestamp(input.windowEnd)
  if (input.sourceAnalytics !== "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT") {
    return { usable: false, limitationCode: "ANALYTICS_SOURCE_PROVENANCE_UNAVAILABLE" }
  }
  if (input.syntheticFallbackUsed === true || input.fixtureEvidenceUsed === true) {
    return { usable: false, limitationCode: "SYNTHETIC_OR_FIXTURE_EVIDENCE_FORBIDDEN" }
  }
  const maximumClockSkewMs = 300_000
  if (observedAt === null || windowStart === null || windowEnd === null ||
      windowStart > windowEnd || windowEnd > observedAt + maximumClockSkewMs ||
      windowEnd > input.now.getTime() + maximumClockSkewMs ||
      observedAt > input.now.getTime() + maximumClockSkewMs) {
    return { usable: false, limitationCode: "ANALYTICS_REPORTING_WINDOW_UNPROVEN" }
  }
  if (!["complete", "incomplete"].includes(String(input.completenessStatus))) {
    return { usable: false, limitationCode: "ANALYTICS_COMPLETENESS_UNPROVEN" }
  }
  const ageSeconds = Math.max(0, Math.floor(
    (input.now.getTime() - observedAt) / 1_000,
  ))
  return {
    usable: true,
    limitationCode: null,
    availability: input.completenessStatus === "complete" ? "AVAILABLE" : "PARTIAL",
    completeness: input.completenessStatus === "complete" ? "COMPLETE" : "PARTIAL",
    freshnessStatus: ageSeconds <= input.maximumAgeSeconds ? "FRESH" : "STALE",
    ageSeconds,
    reportingWindow: {
      start: new Date(windowStart).toISOString(),
      end: new Date(windowEnd).toISOString(),
      timeZone: "UTC",
    },
  }
}

/**
 * A global targeted heartbeat is usable only for an exact mapping that was
 * active and unchanged when that complete run finished.
 *
 * @param {{sourceStatus: unknown, syncStatus: unknown, sourceActive: unknown,
 * targetedSuccessAt: unknown, targetedErrorAt: unknown, targetedRunId: unknown,
 * listingStatus: unknown, listingUpdatedAt: unknown, snapshotCapturedAt: unknown,
 * identityExact: boolean, now: Date, maximumAgeSeconds: number}} input
 */
export function classifyTargetedLunaSnapshotContract(input) {
  const successAt = timestamp(input.targetedSuccessAt)
  const errorAt = timestamp(input.targetedErrorAt)
  const listingUpdatedAt = timestamp(input.listingUpdatedAt)
  const snapshotCapturedAt = timestamp(input.snapshotCapturedAt)
  const runId = typeof input.targetedRunId === "string"
    ? input.targetedRunId.trim()
    : ""
  const reference = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(runId)
    ? `EBAY_TARGETED_LUNA_MONITOR_RUN:${runId}`
    : null
  const ageSeconds = successAt === null
    ? null
    : Math.floor((input.now.getTime() - successAt) / 1_000)
  const valid = input.sourceStatus === "AVAILABLE" &&
    input.syncStatus === "AVAILABLE" && input.sourceActive === true &&
    reference !== null && successAt !== null && ageSeconds !== null &&
    ageSeconds >= -300 && ageSeconds <= input.maximumAgeSeconds &&
    (errorAt === null || successAt >= errorAt) &&
    String(input.listingStatus).toLowerCase() === "active" &&
    listingUpdatedAt !== null && listingUpdatedAt <= successAt &&
    snapshotCapturedAt !== null && snapshotCapturedAt <= successAt &&
    input.identityExact
  return {
    status: valid ? "VALID" : "UNPROVEN",
    reference,
    capturedAt: successAt === null
      ? null
      : new Date(successAt).toISOString(),
  }
}

/** @param {unknown} value */
export function isAuthoritativeReadonlyOrderSource(value) {
  return value === "EBAY_SELL_FULFILLMENT_GET_ORDERS"
}

/**
 * Returns the oldest valid input timestamp. A calculated observation is only
 * as fresh as its stalest indispensable input.
 *
 * @param {...unknown} values
 * @returns {string | null}
 */
export function oldestRequiredEvidenceTimestamp(...values) {
  const parsed = values
    .map((value) => timestamp(value))
    .filter((value) => value !== null)
  if (parsed.length !== values.length || !parsed.length) return null
  return new Date(Math.min(...parsed)).toISOString()
}
