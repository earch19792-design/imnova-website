export type EbayRejectedCategoryRepairPublication =
  Record<string, unknown>

const INVALID_CATEGORY_ERROR_ID = "25005"

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function rejectedCategoryErrorId(
  publication: EbayRejectedCategoryRepairPublication,
) {
  const sanitized = object(publication.sanitized_result)
  const details = object(sanitized.details)
  const errors = Array.isArray(details.errors) ? details.errors : []
  return text(object(errors[0]).errorId)
}

export function inspectRejectedCategoryRepair(
  publication: EbayRejectedCategoryRepairPublication | null | undefined,
) {
  const value = object(publication)
  const preview = object(value.preview)
  const offer = object(preview.offerPayload)
  const oldCategoryId = text(offer.categoryId)
  const errorId = rejectedCategoryErrorId(value)
  const eligible = value.phase === "terminal_failure"
    && Number(value.publish_http_status) === 400
    && value.last_error_code === "EBAY_PUBLISH_WRITE_REJECTED"
    && !text(value.listing_id)
    && Number(value.publish_attempt_count) === 1
    && Number(value.publish_recovery_count) <= 1
    && errorId === INVALID_CATEGORY_ERROR_ID
    && /^\d{1,12}$/.test(oldCategoryId)
  return {
    eligible,
    errorId: errorId || null,
    oldCategoryId: oldCategoryId || null,
    reason: eligible
      ? null
      : "EBAY_REJECTED_CATEGORY_REPAIR_NOT_ELIGIBLE",
  }
}

export const EBAY_INVALID_CATEGORY_ERROR_ID = INVALID_CATEGORY_ERROR_ID
