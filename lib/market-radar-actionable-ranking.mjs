const TRUSTED_STOCK_SOURCES =
  new Set([
    "luna_numeric",
    "luna_authenticated_html",
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
    return {
      pipeline_candidate_id:
        null,
      pipeline_candidate_state:
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
