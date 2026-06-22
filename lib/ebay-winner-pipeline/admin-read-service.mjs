import {
  getPriceIntelligenceForCandidate,
} from "./price-intelligence-service.mjs"

const CANDIDATE_STATES = new Set([
  "DETECTED",
  "ENRICHING",
  "NEEDS_DATA",
  "BLOCKED",
  "VALIDATED",
  "APPROVAL_PENDING",
  "APPROVED",
  "DRAFT_CREATED",
  "PAUSED",
  "REJECTED",
])

const COMPLIANCE_STATUSES = new Set([
  "passed",
  "blocked",
  "needs_review",
])

const DRAFT_STATUSES = new Set([
  "created",
  "paused",
  "rejected",
])

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50

function toPage(value) {
  const page =
    Number(value)

  return Number.isInteger(page) &&
    page >= 0
    ? page
    : 0
}

function toLimit(value) {
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

function sanitizeSearch(value) {
  return String(value || "")
    .trim()
    .replace(
      /[%_,]/g,
      " "
    )
    .slice(
      0,
      80
    )
}

function getSafeState(value) {
  const state =
    String(value || "")
      .trim()
      .toUpperCase()

  return CANDIDATE_STATES.has(state)
    ? state
    : ""
}

function getSafeComplianceStatus(value) {
  const status =
    String(value || "")
      .trim()

  return COMPLIANCE_STATUSES.has(status)
    ? status
    : ""
}

function getSafeDraftStatus(value) {
  const status =
    String(value || "")
      .trim()

  if (status === "no_draft") {
    return status
  }

  return DRAFT_STATUSES.has(status)
    ? status
    : ""
}

function getPagination(options = {}) {
  const limit =
    toLimit(
      options.limit
    )

  const page =
    toPage(
      options.page
    )

  return {
    page,
    limit,
    from:
      page * limit,
    to:
      page * limit + limit - 1,
  }
}

async function getCount(
  supabase,
  table,
  applyFilters
) {
  let query =
    supabase
      .from(table)
      .select(
        "id",
        {
          count: "exact",
          head: true,
        }
      )

  if (applyFilters) {
    query =
      applyFilters(query)
  }

  const {
    count,
    error,
  } =
    await query

  if (error) {
    throw new Error(
      error.message
    )
  }

  return count || 0
}

async function getCandidateIdsFromTable({
  supabase,
  table,
  applyFilters,
}) {
  let query =
    supabase
      .from(table)
      .select("candidate_id")
      .limit(1000)

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
      error.message
    )
  }

  return new Set(
    (data || [])
      .map(row => row.candidate_id)
      .filter(Boolean)
  )
}

function intersectSets(
  left,
  right
) {
  if (!left) {
    return right
  }

  return new Set(
    Array.from(left)
      .filter(value =>
        right.has(value)
      )
  )
}

async function getCandidateFilterIds({
  supabase,
  complianceStatus,
  draftStatus,
}) {
  let candidateIds = null

  if (complianceStatus) {
    const complianceIds =
      await getCandidateIdsFromTable({
        supabase,
        table:
          "ebay_compliance_checks",
        applyFilters:
          query =>
            query.eq(
              "overall_status",
              complianceStatus
            ),
      })

    candidateIds =
      intersectSets(
        candidateIds,
        complianceIds
      )
  }

  if (draftStatus && draftStatus !== "no_draft") {
    const draftIds =
      await getCandidateIdsFromTable({
        supabase,
        table:
          "ebay_listing_drafts",
        applyFilters:
          query =>
            query.eq(
              "draft_status",
              draftStatus
            ),
      })

    candidateIds =
      intersectSets(
        candidateIds,
        draftIds
      )
  }

  if (draftStatus === "no_draft") {
    const draftIds =
      await getCandidateIdsFromTable({
        supabase,
        table:
          "ebay_listing_drafts",
      })

    const {
      data,
      error,
    } =
      await supabase
        .from("ebay_product_candidates")
        .select("id")
        .limit(1000)

    if (error) {
      throw new Error(
        error.message
      )
    }

    const noDraftIds =
      new Set(
        (data || [])
          .map(row => row.id)
          .filter(id =>
            !draftIds.has(id)
          )
      )

    candidateIds =
      intersectSets(
        candidateIds,
        noDraftIds
      )
  }

  return candidateIds
}

function byLatestTimestamp(
  field
) {
  return (
    current,
    next
  ) => {
    if (!current) {
      return next
    }

    const currentTime =
      new Date(
        current[field] ||
          current.created_at ||
          0
      ).getTime()

    const nextTime =
      new Date(
        next[field] ||
          next.created_at ||
          0
      ).getTime()

    return nextTime > currentTime
      ? next
      : current
  }
}

function mapLatestByCandidate(
  rows,
  field
) {
  return (rows || [])
    .reduce(
      (map, row) => {
        const candidateId =
          row.candidate_id

        if (!candidateId) {
          return map
        }

        map.set(
          candidateId,
          byLatestTimestamp(field)(
            map.get(candidateId),
            row
          )
        )

        return map
      },
      new Map()
    )
}

async function fetchRelatedRows({
  supabase,
  table,
  candidateIds,
  select,
  orderBy,
  limit,
}) {
  if (candidateIds.length === 0) {
    return []
  }

  let query =
    supabase
      .from(table)
      .select(select)
      .in(
        "candidate_id",
        candidateIds
      )

  if (orderBy) {
    query =
      query.order(
        orderBy,
        {
          ascending: false,
          nullsFirst: false,
        }
      )
  }

  if (limit) {
    query =
      query.limit(limit)
  }

  const {
    data,
    error,
  } =
    await query

  if (error) {
    throw new Error(
      error.message
    )
  }

  return data || []
}

async function getSummary(
  supabase
) {
  const [
    totalCandidates,
    validated,
    draftCreated,
    blocked,
    needsData,
    localDrafts,
    realEbayDraftsDetected,
  ] =
    await Promise.all([
      getCount(
        supabase,
        "ebay_product_candidates"
      ),
      getCount(
        supabase,
        "ebay_product_candidates",
        query =>
          query.eq(
            "state",
            "VALIDATED"
          )
      ),
      getCount(
        supabase,
        "ebay_product_candidates",
        query =>
          query.eq(
            "state",
            "DRAFT_CREATED"
          )
      ),
      getCount(
        supabase,
        "ebay_product_candidates",
        query =>
          query.eq(
            "state",
            "BLOCKED"
          )
      ),
      getCount(
        supabase,
        "ebay_product_candidates",
        query =>
          query.eq(
            "state",
            "NEEDS_DATA"
          )
      ),
      getCount(
        supabase,
        "ebay_listing_drafts",
        query =>
          query.eq(
            "dry_run_only",
            true
          )
      ),
      getCount(
        supabase,
        "ebay_listing_drafts",
        query =>
          query.not(
            "ebay_draft_id",
            "is",
            null
          )
      ),
    ])

  return {
    dryRunOnly: true,
    totalCandidates,
    validated,
    draftCreated,
    blockedNeedsData:
      blocked + needsData,
    localDrafts,
    realEbayDraftsDetected,
  }
}

export async function getEbayWinnerAdminDashboard({
  supabase,
  filters = {},
  page = 0,
  limit = DEFAULT_LIMIT,
} = {}) {
  const pagination =
    getPagination({
      page,
      limit,
    })

  const state =
    getSafeState(
      filters.state
    )

  const complianceStatus =
    getSafeComplianceStatus(
      filters.complianceStatus
    )

  const draftStatus =
    getSafeDraftStatus(
      filters.draftStatus
    )

  const search =
    sanitizeSearch(
      filters.search
    )

  const candidateFilterIds =
    await getCandidateFilterIds({
      supabase,
      complianceStatus,
      draftStatus,
    })

  if (
    candidateFilterIds &&
    candidateFilterIds.size === 0
  ) {
    return {
      summary:
        await getSummary(supabase),
      candidates: [],
      pagination: {
        page:
          pagination.page,
        limit:
          pagination.limit,
        total:
          0,
        hasNextPage:
          false,
      },
      filters: {
        state,
        complianceStatus,
        draftStatus,
        search,
      },
    }
  }

  let query =
    supabase
      .from("ebay_product_candidates")
      .select(
        `
          id,
          candidate_key,
          supplier_sku,
          title,
          product_url,
          brand,
          product_type,
          state,
          last_evaluated_at,
          blocked_reason,
          needs_data,
          created_at,
          updated_at
        `,
        {
          count: "exact",
        }
      )
      .order(
        "last_evaluated_at",
        {
          ascending: false,
          nullsFirst: false,
        }
      )
      .order(
        "updated_at",
        {
          ascending: false,
          nullsFirst: false,
        }
      )

  if (state) {
    query =
      query.eq(
        "state",
        state
      )
  }

  if (candidateFilterIds) {
    query =
      query.in(
        "id",
        Array.from(candidateFilterIds)
      )
  }

  if (search) {
    const pattern =
      `%${search}%`

    query =
      query.or(
        [
          `supplier_sku.ilike.${pattern}`,
          `title.ilike.${pattern}`,
          `candidate_key.ilike.${pattern}`,
        ].join(",")
      )
  }

  const {
    data,
    error,
    count,
  } =
    await query.range(
      pagination.from,
      pagination.to
    )

  if (error) {
    throw new Error(
      error.message
    )
  }

  const candidates =
    data || []

  const candidateIds =
    candidates.map(
      candidate =>
        candidate.id
    )

  const [
    scores,
    profitScenarios,
    complianceChecks,
    drafts,
    summary,
  ] =
    await Promise.all([
      fetchRelatedRows({
        supabase,
        table:
          "ebay_candidate_scores",
        candidateIds,
        select:
          "candidate_id,winner_score,demand_score,profitability_score,competition_score,stock_stability_score,data_quality_score,inverse_operational_risk_score,explanation,calculated_at",
        orderBy:
          "calculated_at",
      }),
      fetchRelatedRows({
        supabase,
        table:
          "ebay_profit_scenarios",
        candidateIds,
        select:
          "candidate_id,estimated_sale_price,luna_cost,total_estimated_cost,net_profit,net_margin_percent,roi_percent,passes_minimums,calculated_at",
        orderBy:
          "calculated_at",
      }),
      fetchRelatedRows({
        supabase,
        table:
          "ebay_compliance_checks",
        candidateIds,
        select:
          "candidate_id,overall_status,blocker_count,checked_at",
        orderBy:
          "checked_at",
      }),
      fetchRelatedRows({
        supabase,
        table:
          "ebay_listing_drafts",
        candidateIds,
        select:
          "candidate_id,draft_status,dry_run_only,ebay_draft_id,created_at,updated_at",
        orderBy:
          "updated_at",
      }),
      getSummary(supabase),
    ])

  const scoreByCandidate =
    mapLatestByCandidate(
      scores,
      "calculated_at"
    )

  const profitByCandidate =
    mapLatestByCandidate(
      profitScenarios,
      "calculated_at"
    )

  const complianceByCandidate =
    mapLatestByCandidate(
      complianceChecks,
      "checked_at"
    )

  const draftByCandidate =
    mapLatestByCandidate(
      drafts,
      "updated_at"
    )

  return {
    summary,
    candidates:
      candidates.map(candidate => ({
        ...candidate,
        score:
          scoreByCandidate.get(
            candidate.id
          ) || null,
        profitScenario:
          profitByCandidate.get(
            candidate.id
          ) || null,
        compliance:
          complianceByCandidate.get(
            candidate.id
          ) || null,
        draft:
          draftByCandidate.get(
            candidate.id
          ) || null,
      })),
    pagination: {
      page:
        pagination.page,
      limit:
        pagination.limit,
      total:
        count || 0,
      hasNextPage:
        pagination.to + 1 <
        (count || 0),
    },
    filters: {
      state,
      complianceStatus,
      draftStatus,
      search,
    },
  }
}

export async function getEbayWinnerCandidateDetail({
  supabase,
  candidateId,
}) {
  if (!candidateId) {
    throw new Error(
      "candidate_id_required"
    )
  }

  const {
    data: candidate,
    error: candidateError,
  } =
    await supabase
      .from("ebay_product_candidates")
      .select("*")
      .eq(
        "id",
        candidateId
      )
      .maybeSingle()

  if (candidateError) {
    throw new Error(
      candidateError.message
    )
  }

  if (!candidate) {
    return null
  }

  const [
    validations,
    profitScenarios,
    complianceChecks,
    scores,
    decisions,
    drafts,
    auditLog,
    priceIntelligenceSnapshots,
  ] =
    await Promise.all([
      fetchRelatedRows({
        supabase,
        table:
          "ebay_candidate_validations",
        candidateIds: [
          candidateId,
        ],
        select:
          "*",
        orderBy:
          "validated_at",
        limit:
          20,
      }),
      fetchRelatedRows({
        supabase,
        table:
          "ebay_profit_scenarios",
        candidateIds: [
          candidateId,
        ],
        select:
          "*",
        orderBy:
          "calculated_at",
        limit:
          20,
      }),
      fetchRelatedRows({
        supabase,
        table:
          "ebay_compliance_checks",
        candidateIds: [
          candidateId,
        ],
        select:
          "*",
        orderBy:
          "checked_at",
        limit:
          20,
      }),
      fetchRelatedRows({
        supabase,
        table:
          "ebay_candidate_scores",
        candidateIds: [
          candidateId,
        ],
        select:
          "*",
        orderBy:
          "calculated_at",
        limit:
          20,
      }),
      fetchRelatedRows({
        supabase,
        table:
          "ebay_candidate_decisions",
        candidateIds: [
          candidateId,
        ],
        select:
          "*",
        orderBy:
          "decided_at",
        limit:
          50,
      }),
      fetchRelatedRows({
        supabase,
        table:
          "ebay_listing_drafts",
        candidateIds: [
          candidateId,
        ],
        select:
          "*",
        orderBy:
          "updated_at",
        limit:
          10,
      }),
      fetchRelatedRows({
        supabase,
        table:
          "ebay_pipeline_audit_log",
        candidateIds: [
          candidateId,
        ],
        select:
          "*",
        orderBy:
          "created_at",
        limit:
          100,
      }),
      getPriceIntelligenceForCandidate({
        supabase,
        candidateId,
        supplierSku:
          candidate.supplier_sku,
        marketRadarProductId:
          candidate.market_radar_product_id,
      }),
    ])

  return {
    candidate,
    validation:
      validations[0] || null,
    validations,
    profitScenario:
      profitScenarios[0] || null,
    profitScenarios,
    compliance:
      complianceChecks[0] || null,
    complianceChecks,
    score:
      scores[0] || null,
    scores,
    decisions,
    localDraft:
      drafts[0] || null,
    drafts,
    priceIntelligence:
      priceIntelligenceSnapshots[0] || null,
    priceIntelligenceSnapshots,
    auditLog,
  }
}
