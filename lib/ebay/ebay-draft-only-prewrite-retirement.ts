type JsonRecord = Record<string, unknown>

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

const RETIRABLE_APPROVAL_STATUSES = new Set([
  "expired",
  "revoked",
  "SUPERSEDED_BY_RECONCILIATION",
])

export function canRetireSupersededSkuPreflight(
  execution: JsonRecord,
  approval: JsonRecord,
  nowMs = Date.now(),
) {
  const leaseExpiresAt = text(execution.lease_expires_at)
  const leaseTimestamp = leaseExpiresAt ? Date.parse(leaseExpiresAt) : null
  const leaseInactive = leaseTimestamp === null
    || (Number.isFinite(leaseTimestamp) && leaseTimestamp <= nowMs)
  const sanitizedResult = record(execution.sanitized_result)

  return execution.phase === "claimed"
    && execution.last_error_code === "EBAY_SKU_PREFLIGHT_UNAVAILABLE"
    && execution.inventory_http_status == null
    && execution.inventory_confirmed_at == null
    && execution.offer_create_started_at == null
    && execution.offer_http_status == null
    && execution.offer_id == null
    && execution.completed_at == null
    && sanitizedResult.collision === false
    && sanitizedResult.inventoryOwnershipVerified === false
    && RETIRABLE_APPROVAL_STATUSES.has(text(approval.status))
    && leaseInactive
}
