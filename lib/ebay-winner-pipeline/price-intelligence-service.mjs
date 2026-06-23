const SOURCE_TYPES = new Set([
  "manual",
  "aiprice",
  "terapeak",
  "zik",
  "ebay_api",
  "other",
])

const SOURCE_CONFIDENCES = new Set([
  "low",
  "medium",
  "high",
])

const PRODUCT_MATCH_TYPES = new Set([
  "exact",
  "same_model",
  "similar",
  "category_only",
  "unknown",
])

const SHIPPING_SCOPES = new Set([
  "us_domestic",
  "international",
  "unknown",
])

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50
const PRICE_FIELDS = [
  "sold_avg_price",
  "sold_median_price",
  "sold_min_price",
  "sold_max_price",
  "active_avg_price",
  "active_min_price",
  "active_max_price",
  "estimated_shipping_cost",
  "recommended_sale_price",
]

const COUNT_FIELDS = [
  "sold_comp_count",
  "active_comp_count",
]

const DECIMAL_PATTERN =
  /^\d+(?:\.\d+)?$/

const INTEGER_PATTERN =
  /^\d+$/

function toCleanString(value) {
  return typeof value === "string"
    ? value.trim()
    : ""
}

function toNullableString(value, maxLength = 500) {
  const text =
    toCleanString(value)

  return text
    ? text.slice(0, maxLength)
    : null
}

function toNullableNumber(value, fieldName) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${fieldName}_invalid`)
    }

    if (value < 0) {
      throw new Error(`${fieldName}_negative`)
    }

    return Number(value.toFixed(2))
  }

  if (
    typeof value !== "string" ||
    !DECIMAL_PATTERN.test(value)
  ) {
    throw new Error(`${fieldName}_invalid`)
  }

  const numericValue =
    Number(value)

  return Number(numericValue.toFixed(2))
}

function toNullableInteger(value, fieldName) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null
  }

  if (typeof value === "number") {
    if (
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      throw new Error(`${fieldName}_invalid`)
    }

    return value
  }

  if (
    typeof value !== "string" ||
    !INTEGER_PATTERN.test(value)
  ) {
    throw new Error(`${fieldName}_invalid`)
  }

  return Number(value)
}

function getPage(value) {
  const page =
    Number(value)

  return Number.isInteger(page) &&
    page >= 0
    ? page
    : 0
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

function getRecommendedSalePrice(input) {
  return input.recommended_sale_price ??
    input.sold_median_price ??
    input.sold_avg_price ??
    input.active_avg_price ??
    null
}

function getShippingScope(input) {
  const scope =
    toCleanString(
      input.shipping_scope ||
        input.shippingScope
    )

  return SHIPPING_SCOPES.has(scope)
    ? scope
    : "unknown"
}

function getShippingScopeEvidencePayload(input) {
  const shippingScope =
    getShippingScope(input)

  const buyerLocationCountry =
    toNullableString(
      input.buyer_location_country ||
        input.buyerLocationCountry,
      2
    )

  const competitorItemPrice =
    toNullableNumber(
      input.competitor_item_price ??
        input.competitorItemPrice,
      "competitor_item_price"
    )

  const legacyShippingPrice =
    toNullableNumber(
      input.competitor_shipping_price ??
        input.competitorShippingPrice,
      "competitor_shipping_price"
    )

  const legacyLandedPrice =
    toNullableNumber(
      input.competitor_landed_price ??
        input.competitorLandedPrice,
      "competitor_landed_price"
    )

  const explicitDomesticShippingPrice =
    toNullableNumber(
      input.competitor_domestic_shipping_price ??
        input.competitorDomesticShippingPrice,
      "competitor_domestic_shipping_price"
    )

  const explicitDomesticLandedPrice =
    toNullableNumber(
      input.competitor_domestic_landed_price ??
        input.competitorDomesticLandedPrice,
      "competitor_domestic_landed_price"
    )

  const explicitInternationalShippingPrice =
    toNullableNumber(
      input.competitor_international_shipping_price ??
        input.competitorInternationalShippingPrice,
      "competitor_international_shipping_price"
    )

  const explicitInternationalLandedPrice =
    toNullableNumber(
      input.competitor_international_landed_price ??
        input.competitorInternationalLandedPrice,
      "competitor_international_landed_price"
    )

  const competitorDomesticShippingPrice =
    explicitDomesticShippingPrice ??
    (
      shippingScope === "us_domestic"
        ? legacyShippingPrice
        : null
    )

  const competitorInternationalShippingPrice =
    explicitInternationalShippingPrice ??
    (
      shippingScope === "international"
        ? legacyShippingPrice
        : null
    )

  const competitorDomesticLandedPrice =
    explicitDomesticLandedPrice ??
    (
      shippingScope === "us_domestic" &&
      legacyLandedPrice !== null
        ? legacyLandedPrice
        : (
          shippingScope === "us_domestic" ||
          explicitDomesticShippingPrice !== null
        ) &&
          (
            competitorItemPrice !== null ||
            competitorDomesticShippingPrice !== null
          )
        ? Number(
            (
              (competitorItemPrice || 0) +
              (competitorDomesticShippingPrice || 0)
            ).toFixed(2)
          )
        : null
    )

  const competitorInternationalLandedPrice =
    explicitInternationalLandedPrice ??
    (
      shippingScope === "international" &&
      legacyLandedPrice !== null
        ? legacyLandedPrice
        : competitorItemPrice !== null ||
          competitorInternationalShippingPrice !== null
        ? Number(
            (
              (competitorItemPrice || 0) +
              (competitorInternationalShippingPrice || 0)
            ).toFixed(2)
          )
        : null
    )

  if (
    competitorItemPrice === null &&
    competitorDomesticShippingPrice === null &&
    competitorDomesticLandedPrice === null &&
    competitorInternationalShippingPrice === null &&
    competitorInternationalLandedPrice === null
  ) {
    return null
  }

  return {
    shipping_scope:
      shippingScope,
    buyer_location_country:
      buyerLocationCountry,
    competitor_item_price:
      competitorItemPrice,
    competitor_domestic_shipping_price:
      competitorDomesticShippingPrice,
    competitor_domestic_landed_price:
      competitorDomesticLandedPrice,
    competitor_international_shipping_price:
      competitorInternationalShippingPrice,
    competitor_international_landed_price:
      competitorInternationalLandedPrice,
    landed_price_source:
      "manual_observed",
  }
}

function buildSafeRawPayload(normalized, input) {
  const shippingScopeEvidence =
    getShippingScopeEvidencePayload(input)

  return {
    schema:
      "price_intelligence_manual_v1",
    source_type:
      normalized.source_type,
    marketplace:
      normalized.marketplace,
    search_query:
      normalized.search_query,
    product_match_type:
      normalized.product_match_type,
    sold_comp_count:
      normalized.sold_comp_count,
    active_comp_count:
      normalized.active_comp_count,
    recommended_sale_price:
      normalized.recommended_sale_price,
    confidence_score:
      normalized.confidence_score,
    source_confidence:
      normalized.source_confidence,
    category_id:
      normalized.category_id,
    category_name:
      normalized.category_name,
    evidence_url:
      normalized.evidence_url,
    shipping_scope_evidence:
      shippingScopeEvidence,
    landed_price_evidence:
      shippingScopeEvidence,
  }
}

function normalizeSnapshotInput(input = {}, actor = "admin") {
  const supplierSku =
    toNullableString(
      input.supplier_sku ||
        input.supplierSku,
      160
    )

  if (!supplierSku) {
    throw new Error("supplier_sku_required")
  }

  const sourceType =
    toCleanString(
      input.source_type ||
        input.sourceType ||
        "manual"
    )

  if (!SOURCE_TYPES.has(sourceType)) {
    throw new Error("source_type_invalid")
  }

  const marketplace =
    toCleanString(
      input.marketplace ||
        "ebay"
    )

  if (marketplace !== "ebay") {
    throw new Error("marketplace_invalid")
  }

  const sourceConfidence =
    toNullableString(
      input.source_confidence ||
        input.sourceConfidence,
      20
    )

  if (
    sourceConfidence &&
    !SOURCE_CONFIDENCES.has(sourceConfidence)
  ) {
    throw new Error("source_confidence_invalid")
  }

  const productMatchType =
    toNullableString(
      input.product_match_type ||
        input.productMatchType,
      40
    )

  if (
    productMatchType &&
    !PRODUCT_MATCH_TYPES.has(productMatchType)
  ) {
    throw new Error("product_match_type_invalid")
  }

  const normalized = {
    candidate_id:
      toNullableString(
        input.candidate_id ||
          input.candidateId,
        80
      ),
    market_radar_product_id:
      toNullableString(
        input.market_radar_product_id ||
          input.marketRadarProductId,
        80
      ),
    supplier_sku:
      supplierSku,
    candidate_key:
      toNullableString(
        input.candidate_key ||
          input.candidateKey,
        300
      ),
    source_type:
      sourceType,
    marketplace,
    search_query:
      toNullableString(
        input.search_query ||
          input.searchQuery,
        500
      ),
    product_match_type:
      productMatchType,
    source_confidence:
      sourceConfidence,
    category_id:
      toNullableString(
        input.category_id ||
          input.categoryId,
        120
      ),
    category_name:
      toNullableString(
        input.category_name ||
          input.categoryName,
        240
      ),
    evidence_url:
      toNullableString(
        input.evidence_url ||
          input.evidenceUrl,
        1000
      ),
    evidence_notes:
      toNullableString(
        input.evidence_notes ||
          input.evidenceNotes,
        4000
      ),
    raw_payload: {},
    created_by:
      toNullableString(
        actor,
        160
      ),
  }

  for (const field of PRICE_FIELDS) {
    normalized[field] =
      toNullableNumber(
        input[field],
        field
      )
  }

  for (const field of COUNT_FIELDS) {
    normalized[field] =
      toNullableInteger(
        input[field],
        field
      )
  }

  normalized.confidence_score =
    toNullableNumber(
      input.confidence_score ??
        input.confidenceScore,
      "confidence_score"
    )

  if (
    normalized.confidence_score !== null &&
    normalized.confidence_score > 100
  ) {
    throw new Error("confidence_score_invalid")
  }

  normalized.recommended_sale_price =
    getRecommendedSalePrice(
      normalized
    )

  normalized.raw_payload =
    buildSafeRawPayload(
      normalized,
      input
    )

  return normalized
}

export async function createPriceIntelligenceSnapshot({
  supabase,
  input,
  actor = "admin",
}) {
  const payload =
    normalizeSnapshotInput(
      input,
      actor
    )

  const {
    data,
    error,
  } =
    await supabase
      .from("ebay_price_intelligence_snapshots")
      .insert(payload)
      .select("*")
      .single()

  if (error) {
    throw new Error(
      error.message
    )
  }

  return data
}

export async function getLatestPriceIntelligenceForSku({
  supabase,
  supplierSku,
}) {
  const sku =
    toNullableString(
      supplierSku,
      160
    )

  if (!sku) {
    return null
  }

  const {
    data,
    error,
  } =
    await supabase
      .from("ebay_price_intelligence_snapshots")
      .select("*")
      .eq(
        "supplier_sku",
        sku
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      )
      .limit(1)
      .maybeSingle()

  if (error) {
    throw new Error(
      error.message
    )
  }

  return data || null
}

export async function getLatestPriceIntelligenceForMarketRadarProduct({
  supabase,
  marketRadarProductId,
}) {
  const productId =
    toNullableString(
      marketRadarProductId,
      80
    )

  if (!productId) {
    return null
  }

  const {
    data,
    error,
  } =
    await supabase
      .from("ebay_price_intelligence_snapshots")
      .select("*")
      .eq(
        "market_radar_product_id",
        productId
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      )
      .limit(1)
      .maybeSingle()

  if (error) {
    throw new Error(
      error.message
    )
  }

  return data || null
}

function sortSnapshotsByCreatedAt(snapshots) {
  return snapshots.sort((left, right) =>
    new Date(right.created_at || 0).getTime() -
    new Date(left.created_at || 0).getTime()
  )
}

function dedupeSnapshots(snapshots) {
  const seen = new Set()

  return snapshots.filter(snapshot => {
    if (!snapshot?.id || seen.has(snapshot.id)) {
      return false
    }

    seen.add(snapshot.id)
    return true
  })
}

export async function getPriceIntelligenceForCandidate({
  supabase,
  candidateId,
  supplierSku,
  marketRadarProductId,
}) {
  const id =
    toNullableString(
      candidateId,
      80
    )

  const snapshots = []

  if (id) {
    const {
      data,
      error,
    } =
      await supabase
        .from("ebay_price_intelligence_snapshots")
        .select("*")
        .eq(
          "candidate_id",
          id
        )
        .order(
          "created_at",
          {
            ascending: false,
          }
        )
        .limit(20)

    if (error) {
      throw new Error(
        error.message
      )
    }

    snapshots.push(
      ...(data || [])
    )
  }

  const latestBySku =
    await getLatestPriceIntelligenceForSku({
      supabase,
      supplierSku,
    })

  if (latestBySku) {
    snapshots.push(
      latestBySku
    )
  }

  const latestByMarketRadarProduct =
    await getLatestPriceIntelligenceForMarketRadarProduct({
      supabase,
      marketRadarProductId,
    })

  if (latestByMarketRadarProduct) {
    snapshots.push(
      latestByMarketRadarProduct
    )
  }

  return sortSnapshotsByCreatedAt(
    dedupeSnapshots(
      snapshots
    )
  )
}

export async function listPriceIntelligenceSnapshots({
  supabase,
  filters = {},
  page = 0,
  limit = DEFAULT_LIMIT,
} = {}) {
  const safePage =
    getPage(page)

  const safeLimit =
    getLimit(limit)

  const from =
    safePage * safeLimit

  const to =
    from + safeLimit - 1

  let query =
    supabase
      .from("ebay_price_intelligence_snapshots")
      .select(
        "*",
        {
          count: "exact",
        }
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      )

  const supplierSku =
    toNullableString(
      filters.supplierSku ||
        filters.supplier_sku,
      160
    )

  const candidateId =
    toNullableString(
      filters.candidateId ||
        filters.candidate_id,
      80
    )

  if (supplierSku) {
    query =
      query.eq(
        "supplier_sku",
        supplierSku
      )
  }

  if (candidateId) {
    query =
      query.eq(
        "candidate_id",
        candidateId
      )
  }

  const {
    data,
    error,
    count,
  } =
    await query.range(
      from,
      to
    )

  if (error) {
    throw new Error(
      error.message
    )
  }

  return {
    snapshots:
      data || [],
    pagination: {
      page:
        safePage,
      limit:
        safeLimit,
      total:
        count || 0,
      hasNextPage:
        to + 1 < (count || 0),
    },
  }
}
