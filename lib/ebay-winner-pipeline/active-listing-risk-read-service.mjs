const RISK_PRIORITIES = [
  "critical",
  "high",
  "medium",
  "low",
]

const RISK_TYPES = [
  "out_of_stock",
  "stock_unknown",
  "price_up",
  "margin_review",
  "listing_stale",
  "manual_review",
]

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100
const SUMMARY_LIMIT = 1000

const OPEN_RISK_SELECT = `
  id,
  active_listing_id,
  risk_type,
  risk_priority,
  risk_summary,
  recommended_action,
  created_at,
  resolved_at,
  active_listing:ebay_active_listings!inner(
    id,
    ebay_item_id,
    ebay_sku,
    supplier_sku,
    title,
    listing_status,
    ebay_quantity,
    ebay_price,
    currency
  )
`

function toCleanString(value, maxLength = 160) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : ""
}

function getLimit(value) {
  const limit =
    Number(value)

  if (
    !Number.isInteger(limit) ||
    limit <= 0
  ) {
    return DEFAULT_LIMIT
  }

  return Math.min(
    limit,
    MAX_LIMIT
  )
}

function getPriorityRank(value) {
  const index =
    RISK_PRIORITIES.indexOf(
      value
    )

  return index === -1
    ? RISK_PRIORITIES.length
    : index
}

function getTimestamp(value) {
  const timestamp =
    Date.parse(
      value || ""
    )

  return Number.isFinite(timestamp)
    ? timestamp
    : 0
}

function sortOpenRisks(left, right) {
  const priorityDelta =
    getPriorityRank(
      left.risk_priority
    ) -
    getPriorityRank(
      right.risk_priority
    )

  if (priorityDelta !== 0) {
    return priorityDelta
  }

  return getTimestamp(
    right.created_at
  ) -
    getTimestamp(
      left.created_at
    )
}

function normalizeActiveListingRisk(row) {
  const listing =
    row.active_listing ||
    row.ebay_active_listings ||
    {}

  return {
    active_listing_id:
      row.active_listing_id ||
      listing.id ||
      null,
    risk_event_id:
      row.id || null,
    ebay_item_id:
      listing.ebay_item_id || null,
    ebay_sku:
      listing.ebay_sku || null,
    supplier_sku:
      listing.supplier_sku || null,
    title:
      listing.title || null,
    listing_status:
      listing.listing_status || null,
    ebay_quantity:
      listing.ebay_quantity ?? null,
    ebay_price:
      listing.ebay_price ?? null,
    currency:
      listing.currency || null,
    risk_type:
      row.risk_type || null,
    risk_priority:
      row.risk_priority || null,
    risk_summary:
      row.risk_summary || null,
    recommended_action:
      row.recommended_action || null,
    created_at:
      row.created_at || null,
    resolved_at:
      row.resolved_at || null,
  }
}

async function fetchOpenRiskRows({
  supabase,
  limit,
  applyFilters,
}) {
  if (!supabase) {
    throw new Error(
      "supabase_client_required"
    )
  }

  const safeLimit =
    getLimit(limit)

  let query =
    supabase
      .from("ebay_active_listing_risk_events")
      .select(OPEN_RISK_SELECT)
      .is(
        "resolved_at",
        null
      )
      .order(
        "created_at",
        {
          ascending:
            false,
        }
      )
      .limit(
        safeLimit
      )

  if (applyFilters) {
    query =
      applyFilters(query)
  }

  const {
    data,
    error,
  } =
    await query

  if (error) {
    throw new Error(
      error.message ||
      "active_listing_risk_read_failed"
    )
  }

  return (data || [])
    .map(
      normalizeActiveListingRisk
    )
    .sort(
      sortOpenRisks
    )
}

export async function getOpenActiveListingRisks({
  supabase,
  limit = DEFAULT_LIMIT,
} = {}) {
  return fetchOpenRiskRows({
    supabase,
    limit,
  })
}

export async function getRisksByEbaySku({
  supabase,
  sku,
  limit = DEFAULT_LIMIT,
} = {}) {
  const safeSku =
    toCleanString(
      sku
    )

  if (!safeSku) {
    return []
  }

  return fetchOpenRiskRows({
    supabase,
    limit,
    applyFilters:
      query =>
        query.eq(
          "active_listing.ebay_sku",
          safeSku
        ),
  })
}

export async function getRisksBySupplierSku({
  supabase,
  supplierSku,
  limit = DEFAULT_LIMIT,
} = {}) {
  const safeSku =
    toCleanString(
      supplierSku
    )

  if (!safeSku) {
    return []
  }

  return fetchOpenRiskRows({
    supabase,
    limit,
    applyFilters:
      query =>
        query.eq(
          "active_listing.supplier_sku",
          safeSku
        ),
  })
}

export async function getActiveListingRiskSummary({
  supabase,
  limit = SUMMARY_LIMIT,
} = {}) {
  if (!supabase) {
    throw new Error(
      "supabase_client_required"
    )
  }

  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) || SUMMARY_LIMIT,
        1
      ),
      SUMMARY_LIMIT
    )

  const {
    data,
    error,
  } =
    await supabase
      .from("ebay_active_listing_risk_events")
      .select(
        "risk_type,risk_priority,resolved_at"
      )
      .is(
        "resolved_at",
        null
      )
      .limit(
        safeLimit
      )

  if (error) {
    throw new Error(
      error.message ||
      "active_listing_risk_summary_failed"
    )
  }

  const summary = {
    total_open:
      0,
    by_priority:
      Object.fromEntries(
        RISK_PRIORITIES.map(priority => [
          priority,
          0,
        ])
      ),
    by_type:
      Object.fromEntries(
        RISK_TYPES.map(type => [
          type,
          0,
        ])
      ),
  }

  for (const row of data || []) {
    summary.total_open += 1

    if (
      Object.hasOwn(
        summary.by_priority,
        row.risk_priority
      )
    ) {
      summary.by_priority[
        row.risk_priority
      ] += 1
    }

    if (
      Object.hasOwn(
        summary.by_type,
        row.risk_type
      )
    ) {
      summary.by_type[
        row.risk_type
      ] += 1
    }
  }

  return summary
}
