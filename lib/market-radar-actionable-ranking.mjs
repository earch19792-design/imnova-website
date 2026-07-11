const TRUSTED_STOCK_SOURCES =
  new Set([
    "luna_numeric",
    "luna_authenticated_html",
    "manual_admin_confirmation",
  ])

const MATERIAL_EVENT_REASONS = {
  price_down:
    "price_down_after_review",
  discount_started:
    "discount_started_after_review",
  restocked:
    "restocked_after_review",
  stock_increased:
    "stock_increased_after_review",
  stock_decreased_fast:
    "quantity_changed_after_review",
  entered_collection:
    "collection_changed_after_review",
  exited_collection:
    "collection_changed_after_review",
}

const PRICE_UP_MATERIAL_STATES =
  new Set([
    "VALIDATED",
    "DRAFT_CREATED",
    "LISTED",
    "PUBLISHED",
  ])

export const MANUAL_STOCK_CONFIRMATION_TTL_HOURS = 24
export const MISSING_SCAN_STALE_THRESHOLD = 2

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null
  }

  const numeric =
    Number(value)

  return Number.isFinite(numeric)
    ? numeric
    : null
}

function toTime(value) {
  if (!value) {
    return null
  }

  const timestamp =
    new Date(value).getTime()

  return Number.isFinite(timestamp)
    ? timestamp
    : null
}

export function getRadarFreshnessState(
  product,
  {
    sourceLastSuccessAt = null,
    pollIntervalMinutes = 15,
    now = new Date().toISOString(),
  } = {}
) {
  const lastSeenTime =
    toTime(product?.last_seen_at)
  const sourceSuccessTime =
    toTime(sourceLastSuccessAt)
  const intervalMs =
    Math.max(1, Number(pollIntervalMinutes) || 15) * 60 * 1000
  const missingScans =
    lastSeenTime !== null &&
    sourceSuccessTime !== null &&
    sourceSuccessTime > lastSeenTime
      ? Math.max(
          1,
          Math.floor(
            (sourceSuccessTime - lastSeenTime) /
            intervalMs
          )
        )
      : 0
  const observationStatus =
    missingScans >= MISSING_SCAN_STALE_THRESHOLD
      ? "stale_missing_from_source"
      : missingScans > 0
        ? "not_observed_latest_scan"
        : "observed"
  const manualConfirmation =
    product?.inventory_source ===
      "manual_admin_confirmation"
  const confirmationTime =
    toTime(product?.last_captured_at)
  const nowTime =
    toTime(now)
  const confirmationAgeHours =
    manualConfirmation &&
    confirmationTime !== null &&
    nowTime !== null
      ? Math.max(
          0,
          (nowTime - confirmationTime) /
          (60 * 60 * 1000)
        )
      : null
  const stockConfirmationStatus =
    !manualConfirmation
      ? "not_applicable"
      : confirmationAgeHours === null ||
          confirmationAgeHours >=
            MANUAL_STOCK_CONFIRMATION_TTL_HOURS
        ? "stale_reconfirmation_required"
        : "fresh"

  return {
    observation_status:
      observationStatus,
    consecutive_missing_scans_estimate:
      missingScans,
    stock_confirmation_status:
      stockConfirmationStatus,
    stock_confirmation_age_hours:
      confirmationAgeHours,
    stock_reconfirmation_required:
      observationStatus !== "observed" ||
      stockConfirmationStatus ===
        "stale_reconfirmation_required",
  }
}

function getCandidateReviewedAt(candidate) {
  return candidate?.last_evaluated_at || null
}

export function isSuspiciousInventoryQuantity(value) {
  const quantity =
    toNumber(value)

  return Boolean(
    quantity !== null &&
    quantity >= 10000
  )
}

export function getManualStockQuantity(value) {
  if (
    typeof value !== "number" &&
    typeof value !== "string"
  ) {
    return null
  }

  const quantity =
    toNumber(value)

  if (
    quantity === null ||
    !Number.isInteger(quantity) ||
    quantity < 0 ||
    isSuspiciousInventoryQuantity(quantity)
  ) {
    return null
  }

  return quantity
}

export function isConfirmedVariantStock(product) {
  const quantity =
    toNumber(
      product?.inventory_quantity
    )

  return Boolean(
    product?.available === true &&
    quantity !== null &&
    quantity > 0 &&
    !isSuspiciousInventoryQuantity(quantity) &&
    product?.inventory_scope === "variant_level" &&
    product?.inventory_confidence === "high" &&
    TRUSTED_STOCK_SOURCES.has(
      product?.inventory_source
    )
  )
}

export function getStockValidationStatus(product) {
  if (
    product?.stock_reconfirmation_required === true ||
    product?.observation_status ===
      "stale_missing_from_source" ||
    product?.stock_confirmation_status ===
      "stale_reconfirmation_required"
  ) {
    return "stock_needs_validation"
  }

  if (isConfirmedVariantStock(product)) {
    return "stock_confirmed"
  }

  if (
    product?.available === false ||
    product?.inventory_status === "out_of_stock" ||
    toNumber(product?.inventory_quantity) === 0
  ) {
    return "out_of_stock"
  }

  if (
    product?.available === true ||
    product?.inventory_status === "in_stock" ||
    product?.inventory_scope === "availability_only" ||
    product?.inventory_scope === "product_or_category_signal" ||
    product?.inventory_confidence === "low"
  ) {
    return "stock_needs_validation"
  }

  return "stock_unknown"
}

export function getMaterialChangeAfterReview({
  candidate,
  events = [],
}) {
  const reviewedAt =
    getCandidateReviewedAt(candidate)

  const reviewedTime =
    toTime(reviewedAt)

  if (
    !candidate?.id ||
    reviewedTime === null
  ) {
    return {
      has_material_change_since_pipeline_review:
        false,
      actionable_reason:
        null,
      event:
        null,
    }
  }

  const sortedEvents =
    [...events].sort(
      (left, right) =>
        (toTime(right?.created_at) || 0) -
        (toTime(left?.created_at) || 0)
    )

  for (const event of sortedEvents) {
    const eventTime =
      toTime(event?.created_at)

    if (
      eventTime === null ||
      eventTime <= reviewedTime
    ) {
      continue
    }

    const eventType =
      event?.event_type

    if (
      eventType === "price_up" &&
      PRICE_UP_MATERIAL_STATES.has(
        candidate.state
      )
    ) {
      return {
        has_material_change_since_pipeline_review:
          true,
        actionable_reason:
          "price_up_after_review",
        event,
      }
    }

    const reason =
      MATERIAL_EVENT_REASONS[eventType]

    if (reason) {
      return {
        has_material_change_since_pipeline_review:
          true,
        actionable_reason:
          reason,
        event,
      }
    }
  }

  return {
    has_material_change_since_pipeline_review:
      false,
    actionable_reason:
      null,
    event:
      null,
  }
}

export function getMarketRadarActionability({
  product,
  candidate = null,
  events = [],
}) {
  const stockValidationStatus =
    getStockValidationStatus(product)

  if (!candidate?.id) {
    if (stockValidationStatus === "out_of_stock") {
      return {
        pipeline_candidate_id:
          null,
        pipeline_candidate_state:
          null,
        pipeline_blocked_reason:
          null,
        pipeline_last_evaluated_at:
          null,
        has_material_change_since_pipeline_review:
          false,
        actionable_reason:
          "out_of_stock_not_listable",
        stock_validation_status:
          stockValidationStatus,
        radar_action_status:
          "reviewed",
      }
    }

    return {
      pipeline_candidate_id:
        null,
      pipeline_candidate_state:
        null,
      pipeline_blocked_reason:
        null,
      pipeline_last_evaluated_at:
        null,
      has_material_change_since_pipeline_review:
        false,
      actionable_reason:
        "new_product_not_reviewed",
      stock_validation_status:
        stockValidationStatus,
      radar_action_status:
        "actionable",
    }
  }

  const candidateReviewedAt =
    getCandidateReviewedAt(candidate)

  if (!candidateReviewedAt) {
    return {
      pipeline_candidate_id:
        candidate.id,
      pipeline_candidate_state:
        candidate.state || null,
      pipeline_blocked_reason:
        candidate.blocked_reason || null,
      pipeline_last_evaluated_at:
        null,
      has_material_change_since_pipeline_review:
        false,
      actionable_reason:
        "pipeline_candidate_not_evaluated",
      stock_validation_status:
        stockValidationStatus,
      radar_action_status:
        "actionable",
    }
  }

  const materialChange =
    getMaterialChangeAfterReview({
      candidate,
      events,
    })

  if (
    materialChange
      .has_material_change_since_pipeline_review
  ) {
    return {
      pipeline_candidate_id:
        candidate.id,
      pipeline_candidate_state:
        candidate.state || null,
      pipeline_blocked_reason:
        candidate.blocked_reason || null,
      pipeline_last_evaluated_at:
        candidateReviewedAt,
      has_material_change_since_pipeline_review:
        true,
      actionable_reason:
        materialChange.actionable_reason,
      stock_validation_status:
        stockValidationStatus,
      radar_action_status:
        "actionable",
    }
  }

  return {
    pipeline_candidate_id:
      candidate.id,
    pipeline_candidate_state:
      candidate.state || null,
    pipeline_blocked_reason:
      candidate.blocked_reason || null,
    pipeline_last_evaluated_at:
      candidateReviewedAt,
    has_material_change_since_pipeline_review:
      false,
    actionable_reason:
      "reviewed_no_new_signal",
    stock_validation_status:
      stockValidationStatus,
    radar_action_status:
      "reviewed",
  }
}

export function decorateMarketRadarProductActionability({
  product,
  candidate = null,
  events = [],
}) {
  return {
    ...product,
    ...getMarketRadarActionability({
      product,
      candidate,
      events,
    }),
  }
}
