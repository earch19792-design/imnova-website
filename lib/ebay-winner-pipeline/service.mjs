import {
  buildDecisionIdempotencyKey,
  getPipelineReanalysisAdvisor,
  normalizeDecisionAction,
  processRadarCandidate,
} from "./core.mjs"
import {
  getPriceIntelligenceForCandidate,
} from "./price-intelligence-service.mjs"

const PIPELINE_VERSION = "v1"

function getBlockedReason(result) {
  return result.compliance.findings[0]?.code ||
    result.validation.criticalReasons[0] ||
    null
}

function getNeedsData(result) {
  return result.validation.missingFields
}

function getCandidateUpsertPayload(
  result,
  radarProduct,
  {
    existingCandidate = null,
    reanalysisAdvisor = null,
  } = {}
) {
  const protectedState =
    existingCandidate?.state === "DRAFT_CREATED"
      ? "DRAFT_CREATED"
      : result.candidate.state

  const normalizedPayload = {
    ...result.candidate,
    state:
      protectedState,
    pipeline_reanalysis_advisor:
      reanalysisAdvisor,
  }

  return {
    candidate_key:
      result.candidate.candidate_key,
    source_id:
      result.candidate.source_id,
    market_radar_product_id:
      result.candidate.market_radar_product_id,
    market_radar_snapshot_id:
      result.candidate.market_radar_snapshot_id,
    supplier_product_id:
      result.candidate.supplier_product_id ||
        null,
    supplier_variant_id:
      result.candidate.supplier_variant_id,
    supplier_sku:
      result.candidate.supplier_sku ||
        null,
    title:
      result.candidate.title ||
        "Producto sin titulo",
    product_url:
      result.candidate.product_url ||
        null,
    brand:
      result.candidate.brand ||
        null,
    product_type:
      result.candidate.product_type ||
        null,
    source_payload:
      {
        ...radarProduct,
        pipeline_reanalysis_advisor:
          reanalysisAdvisor,
      },
    normalized_payload:
      normalizedPayload,
    state:
      protectedState,
    last_evaluated_at:
      new Date().toISOString(),
    blocked_reason:
      getBlockedReason(result),
    needs_data:
      getNeedsData(result),
  }
}

async function getExistingCandidateByKey(
  supabase,
  candidateKey
) {
  if (!candidateKey) {
    return null
  }

  const {
    data,
    error,
  } =
    await supabase
      .from("ebay_product_candidates")
      .select("*")
      .eq(
        "candidate_key",
        candidateKey
      )
      .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data || null
}

function getRadarProductInventoryContext(
  radarProduct = {}
) {
  return {
    inventory_quantity:
      radarProduct.inventory_quantity ?? null,
    product_available_quantity:
      radarProduct.product_available_quantity ?? null,
    inventory_status:
      radarProduct.inventory_status || "unknown",
    inventory_source:
      radarProduct.inventory_source || "not_exposed",
    inventory_confidence:
      radarProduct.inventory_confidence || "low",
    inventory_scope:
      radarProduct.inventory_scope || "unknown",
    luna_auth_state:
      radarProduct.luna_auth_state ||
      radarProduct.lunaAuthState ||
      null,
  }
}

function getProfitScenarioUpsertPayload(profitScenario = {}) {
  const {
    buyer_shipping_charge,
    total_revenue,
    assumptions,
    ...schemaPayload
  } =
    profitScenario

  return {
    ...schemaPayload,
    assumptions: {
      ...(assumptions || {}),
      buyer_shipping_charge:
        buyer_shipping_charge ?? null,
      total_revenue:
        total_revenue ?? null,
    },
  }
}

async function upsertByKey(supabase, table, payload, keyColumn = "idempotency_key") {
  const { data, error } =
    await supabase
      .from(table)
      .upsert(
        payload,
        {
          onConflict:
            keyColumn,
        }
      )
      .select("*")
      .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

async function insertAuditLog(
  supabase,
  candidateId,
  eventType,
  toState,
  payload,
  options = {}
) {
  return upsertByKey(
    supabase,
    "ebay_pipeline_audit_log",
    {
      candidate_id:
        candidateId,
      event_type:
        eventType,
      from_state:
        options.fromState ||
        null,
      to_state:
        toState,
      actor:
        "system",
      payload,
      idempotency_key:
        options.idempotencyKey ||
        `${eventType}:${candidateId}:${PIPELINE_VERSION}:${toState}`,
    }
  )
}

function isObject(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
}

function toFiniteNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null
  }

  const number =
    typeof value === "number"
      ? value
      : Number(value)

  return Number.isFinite(number)
    ? number
    : null
}

function getCandidateSourceKey(candidate) {
  const normalizedPayload =
    isObject(candidate.normalized_payload)
      ? candidate.normalized_payload
      : {}

  const source =
    isObject(normalizedPayload.source)
      ? normalizedPayload.source
      : {}

  return source.key ||
    candidate.candidate_key?.split(":")[0] ||
    "lunaportex"
}

function buildRadarProductFromCandidate(
  candidate,
  recommendedSalePrice
) {
  const sourcePayload =
    isObject(candidate.source_payload)
      ? candidate.source_payload
      : {}

  const normalizedPayload =
    isObject(candidate.normalized_payload)
      ? candidate.normalized_payload
      : {}

  const source =
    isObject(normalizedPayload.source)
      ? normalizedPayload.source
      : {}

  return {
    ...sourcePayload,
    source_key:
      sourcePayload.source_key ||
      source.key ||
      getCandidateSourceKey(candidate),
    source_name:
      sourcePayload.source_name ||
      source.name ||
      "Luna Portex",
    source_id:
      sourcePayload.source_id ||
      candidate.source_id ||
      normalizedPayload.source_id ||
      null,
    product_id:
      sourcePayload.product_id ||
      candidate.market_radar_product_id ||
      normalizedPayload.market_radar_product_id ||
      null,
    market_radar_product_id:
      candidate.market_radar_product_id ||
      normalizedPayload.market_radar_product_id ||
      sourcePayload.market_radar_product_id ||
      sourcePayload.product_id ||
      null,
    snapshot_id:
      sourcePayload.snapshot_id ||
      candidate.market_radar_snapshot_id ||
      normalizedPayload.market_radar_snapshot_id ||
      null,
    market_radar_snapshot_id:
      candidate.market_radar_snapshot_id ||
      normalizedPayload.market_radar_snapshot_id ||
      sourcePayload.market_radar_snapshot_id ||
      sourcePayload.snapshot_id ||
      null,
    supplier_product_id:
      sourcePayload.supplier_product_id ||
      candidate.supplier_product_id ||
      normalizedPayload.supplier_product_id ||
      candidate.market_radar_product_id ||
      candidate.id,
    supplier_variant_id:
      sourcePayload.supplier_variant_id ||
      candidate.supplier_variant_id ||
      normalizedPayload.supplier_variant_id ||
      "default",
    sku:
      sourcePayload.sku ||
      candidate.supplier_sku ||
      normalizedPayload.supplier_sku ||
      "",
    title:
      sourcePayload.title ||
      candidate.title,
    product_url:
      sourcePayload.product_url ||
      candidate.product_url ||
      normalizedPayload.product_url ||
      null,
    vendor:
      sourcePayload.vendor ||
      normalizedPayload.brand ||
      candidate.brand ||
      null,
    product_type:
      sourcePayload.product_type ||
      normalizedPayload.product_type ||
      candidate.product_type ||
      null,
    tags:
      sourcePayload.tags ||
      normalizedPayload.tags ||
      [],
    price:
      sourcePayload.price ??
      normalizedPayload.cost ??
      0,
    compare_at_price:
      sourcePayload.compare_at_price ??
      normalizedPayload.compare_at_price ??
      null,
    available:
      sourcePayload.available ??
      normalizedPayload.available ??
      true,
    inventory_quantity:
      sourcePayload.inventory_quantity ??
      normalizedPayload.stock ??
      null,
    product_available_quantity:
      sourcePayload.product_available_quantity ??
      normalizedPayload.product_available_quantity ??
      normalizedPayload.inventory_context?.product_available_quantity ??
      null,
    inventory_status:
      sourcePayload.inventory_status ??
      normalizedPayload.inventory_context?.inventory_status ??
      null,
    inventory_source:
      sourcePayload.inventory_source ??
      normalizedPayload.inventory_source ??
      normalizedPayload.inventory_context?.inventory_source ??
      null,
    inventory_confidence:
      sourcePayload.inventory_confidence ??
      normalizedPayload.inventory_confidence ??
      normalizedPayload.inventory_context?.inventory_confidence ??
      null,
    inventory_scope:
      sourcePayload.inventory_scope ??
      normalizedPayload.inventory_scope ??
      normalizedPayload.inventory_context?.inventory_scope ??
      null,
    collections:
      sourcePayload.collections ||
      normalizedPayload.collections ||
      [],
    featured_image_url:
      sourcePayload.featured_image_url ||
      normalizedPayload.featured_image_url ||
      null,
    image_urls:
      sourcePayload.image_urls ||
      normalizedPayload.image_urls ||
      [],
    estimated_sale_price:
      recommendedSalePrice,
  }
}

function getMarketReferenceFromPriceIntelligence(
  priceIntelligence
) {
  if (!priceIntelligence) {
    return {
      marketReferencePrice:
        null,
      soldMinPrice:
        null,
      soldMaxPrice:
        null,
    }
  }

  const soldMedian =
    toFiniteNumber(
      priceIntelligence.sold_median_price
    )

  const soldAvg =
    toFiniteNumber(
      priceIntelligence.sold_avg_price
    )

  const activeAvg =
    toFiniteNumber(
      priceIntelligence.active_avg_price
    )

  return {
    marketReferencePrice:
      soldMedian ??
      soldAvg ??
      activeAvg,
    soldMinPrice:
      toFiniteNumber(
        priceIntelligence.sold_min_price
      ),
    soldMaxPrice:
      toFiniteNumber(
        priceIntelligence.sold_max_price
      ),
  }
}

function isSuggestedPriceMarketCompetitive(
  suggestedPrice,
  priceIntelligence
) {
  const market =
    getMarketReferenceFromPriceIntelligence(
      priceIntelligence
    )

  if (
    market.soldMinPrice !== null &&
    market.soldMaxPrice !== null
  ) {
    return suggestedPrice >= market.soldMinPrice &&
      suggestedPrice <= market.soldMaxPrice
  }

  if (market.marketReferencePrice !== null) {
    return suggestedPrice <=
      market.marketReferencePrice * 1.1
  }

  return false
}

export async function processRadarCandidateWithPersistence({
  supabase,
  radarProduct,
  config = {},
}) {
  const result =
    processRadarCandidate(
      radarProduct,
      config
    )

  const existingCandidate =
    await getExistingCandidateByKey(
      supabase,
      result.candidate.candidate_key
    )

  const reanalysisAdvisor =
    getPipelineReanalysisAdvisor({
      existingCandidate,
      radarProduct,
      advisorEvents:
        radarProduct.advisor_events ||
        radarProduct.advisorEvents ||
        [],
      inventoryContext:
        getRadarProductInventoryContext(
          radarProduct
        ),
      lunaAuthState:
        radarProduct.luna_auth_state ||
        radarProduct.lunaAuthState ||
        null,
    })

  const candidatePayload =
    getCandidateUpsertPayload(
      result,
      radarProduct,
      {
        existingCandidate,
        reanalysisAdvisor,
      }
    )

  const candidate =
    await upsertByKey(
      supabase,
      "ebay_product_candidates",
      candidatePayload,
      "candidate_key"
    )

  const candidateId =
    candidate.id

  const validation =
    await upsertByKey(
      supabase,
      "ebay_candidate_validations",
      {
        candidate_id:
          candidateId,
        validation_version:
          PIPELINE_VERSION,
        validation_status:
          result.validation.status,
        required_fields: [
          "supplier_sku",
          "title",
          "cost",
          "stock",
          "weight_or_dimensions",
          "authorized_images",
          "category_or_inference_data",
        ],
        missing_fields:
          result.validation.missingFields,
        critical_reasons:
          result.validation.criticalReasons,
        idempotency_key:
          `validation:${candidateId}:${PIPELINE_VERSION}`,
      }
    )

  const profitScenario =
    await upsertByKey(
      supabase,
      "ebay_profit_scenarios",
      {
        candidate_id:
          candidateId,
        scenario_version:
          PIPELINE_VERSION,
        ...getProfitScenarioUpsertPayload(
          result.profitScenario
        ),
        idempotency_key:
          `profit:${candidateId}:${PIPELINE_VERSION}`,
      }
    )

  const compliance =
    await upsertByKey(
      supabase,
      "ebay_compliance_checks",
      {
        candidate_id:
          candidateId,
        check_version:
          PIPELINE_VERSION,
        overall_status:
          result.compliance.overall_status,
        blocker_count:
          result.compliance.blocker_count,
        findings:
          result.compliance.findings,
        idempotency_key:
          `compliance:${candidateId}:${PIPELINE_VERSION}`,
      }
    )

  const score =
    await upsertByKey(
      supabase,
      "ebay_candidate_scores",
      {
        candidate_id:
          candidateId,
        score_version:
          PIPELINE_VERSION,
        winner_score:
          result.score.winner_score,
        demand_score:
          result.score.breakdown.demand,
        profitability_score:
          result.score.breakdown.profitability,
        competition_score:
          result.score.breakdown.competition,
        stock_stability_score:
          result.score.breakdown.stock_stability,
        data_quality_score:
          result.score.breakdown.data_quality,
        inverse_operational_risk_score:
          result.score.breakdown.inverse_operational_risk,
        explanation:
          result.explanation,
        score_payload:
          result.score,
        idempotency_key:
          `score:${candidateId}:${PIPELINE_VERSION}`,
      }
    )

  const auditLog =
    await insertAuditLog(
      supabase,
      candidateId,
      "candidate_evaluated",
      result.candidate.state,
      {
        candidate_key:
          result.candidate.candidate_key,
        dry_run:
          true,
        pipeline_reanalysis_advisor:
          reanalysisAdvisor,
      }
    )

  return {
    ...result,
    pipelineReanalysisAdvisor:
      reanalysisAdvisor,
    persisted: {
      candidate,
      validation,
      profitScenario,
      compliance,
      score,
      auditLog,
    },
  }
}

export async function reprocessCandidateWithPriceIntelligence({
  supabase,
  candidateId,
  supplierSku,
  candidateKey,
  priceIntelligenceSnapshotId,
  actor = "admin",
  config = {},
}) {
  let candidateQuery =
    supabase
      .from("ebay_product_candidates")
      .select("*")

  if (candidateId) {
    candidateQuery =
      candidateQuery.eq(
        "id",
        candidateId
      )
  } else if (candidateKey) {
    candidateQuery =
      candidateQuery.eq(
        "candidate_key",
        candidateKey
      )
  } else if (supplierSku) {
    candidateQuery =
      candidateQuery.eq(
        "supplier_sku",
        supplierSku
      )
  } else {
    throw new Error(
      "candidate_identifier_required"
    )
  }

  const {
    data: candidate,
    error: candidateError,
  } =
    await candidateQuery
      .order(
        "last_evaluated_at",
        {
          ascending: false,
          nullsFirst: false,
        }
      )
      .limit(1)
      .maybeSingle()

  if (candidateError) {
    throw new Error(
      candidateError.message
    )
  }

  if (!candidate) {
    throw new Error(
      "candidate_not_found"
    )
  }

  let priceIntelligence = null

  if (priceIntelligenceSnapshotId) {
    const {
      data,
      error,
    } =
      await supabase
        .from("ebay_price_intelligence_snapshots")
        .select("*")
        .eq(
          "id",
          priceIntelligenceSnapshotId
        )
        .maybeSingle()

    if (error) {
      throw new Error(
        error.message
      )
    }

    priceIntelligence =
      data || null
  } else {
    const snapshots =
      await getPriceIntelligenceForCandidate({
        supabase,
        candidateId:
          candidate.id,
        supplierSku:
          supplierSku ||
          candidate.supplier_sku,
        marketRadarProductId:
          candidate.market_radar_product_id,
      })

    priceIntelligence =
      snapshots[0] || null
  }

  if (!priceIntelligence) {
    throw new Error(
      "price_intelligence_snapshot_not_found"
    )
  }

  const snapshotMatchesCandidate =
    (
      priceIntelligence.candidate_id &&
      priceIntelligence.candidate_id === candidate.id
    ) ||
    (
      priceIntelligence.supplier_sku &&
      priceIntelligence.supplier_sku === candidate.supplier_sku
    ) ||
    (
      priceIntelligence.market_radar_product_id &&
      priceIntelligence.market_radar_product_id ===
        candidate.market_radar_product_id
    )

  if (!snapshotMatchesCandidate) {
    throw new Error(
      "price_intelligence_snapshot_mismatch"
    )
  }

  const recommendedSalePrice =
    toFiniteNumber(
      priceIntelligence.recommended_sale_price
    )

  if (
    recommendedSalePrice === null ||
    recommendedSalePrice <= 0
  ) {
    throw new Error(
      "price_intelligence_missing_recommended_price"
    )
  }

  const radarProduct =
    buildRadarProductFromCandidate(
      candidate,
      recommendedSalePrice
    )

  const result =
    processRadarCandidate(
      radarProduct,
      config
    )

  result.candidate.candidate_key =
    candidate.candidate_key
  result.candidate.source_id =
    candidate.source_id
  result.candidate.market_radar_product_id =
    candidate.market_radar_product_id
  result.candidate.market_radar_snapshot_id =
    candidate.market_radar_snapshot_id

  const reanalysisAdvisor =
    getPipelineReanalysisAdvisor({
      existingCandidate:
        candidate,
      radarProduct,
      advisorEvents: [
        {
          event_type:
            "price_down",
        },
      ],
      inventoryContext:
        getRadarProductInventoryContext(
          radarProduct
        ),
    })

  const candidatePayload =
    getCandidateUpsertPayload(
      result,
      radarProduct,
      {
        existingCandidate:
          candidate,
        reanalysisAdvisor,
      }
    )

  const persistedCandidate =
    await upsertByKey(
      supabase,
      "ebay_product_candidates",
      candidatePayload,
      "candidate_key"
    )

  const persistedCandidateId =
    persistedCandidate.id

  const validation =
    await upsertByKey(
      supabase,
      "ebay_candidate_validations",
      {
        candidate_id:
          persistedCandidateId,
        validation_version:
          PIPELINE_VERSION,
        validation_status:
          result.validation.status,
        required_fields: [
          "supplier_sku",
          "title",
          "cost",
          "stock",
          "weight_or_dimensions",
          "authorized_images",
          "category_or_inference_data",
        ],
        missing_fields:
          result.validation.missingFields,
        critical_reasons:
          result.validation.criticalReasons,
        validated_at:
          new Date().toISOString(),
        idempotency_key:
          `validation:${persistedCandidateId}:${PIPELINE_VERSION}`,
      }
    )

  const profitScenario =
    await upsertByKey(
      supabase,
      "ebay_profit_scenarios",
      {
        candidate_id:
          persistedCandidateId,
        scenario_version:
          PIPELINE_VERSION,
        ...getProfitScenarioUpsertPayload(
          result.profitScenario
        ),
        calculated_at:
          new Date().toISOString(),
        idempotency_key:
          `profit:${persistedCandidateId}:${PIPELINE_VERSION}`,
      }
    )

  const compliance =
    await upsertByKey(
      supabase,
      "ebay_compliance_checks",
      {
        candidate_id:
          persistedCandidateId,
        check_version:
          PIPELINE_VERSION,
        overall_status:
          result.compliance.overall_status,
        blocker_count:
          result.compliance.blocker_count,
        findings:
          result.compliance.findings,
        checked_at:
          new Date().toISOString(),
        idempotency_key:
          `compliance:${persistedCandidateId}:${PIPELINE_VERSION}`,
      }
    )

  const score =
    await upsertByKey(
      supabase,
      "ebay_candidate_scores",
      {
        candidate_id:
          persistedCandidateId,
        score_version:
          PIPELINE_VERSION,
        winner_score:
          result.score.winner_score,
        demand_score:
          result.score.breakdown.demand,
        profitability_score:
          result.score.breakdown.profitability,
        competition_score:
          result.score.breakdown.competition,
        stock_stability_score:
          result.score.breakdown.stock_stability,
        data_quality_score:
          result.score.breakdown.data_quality,
        inverse_operational_risk_score:
          result.score.breakdown.inverse_operational_risk,
        explanation:
          result.explanation,
        score_payload:
          result.score,
        calculated_at:
          new Date().toISOString(),
        idempotency_key:
          `score:${persistedCandidateId}:${PIPELINE_VERSION}`,
      }
    )

  const auditLog =
    await insertAuditLog(
      supabase,
      persistedCandidateId,
      "candidate_reprocessed_with_price_intelligence",
      result.candidate.state,
      {
        candidate_id:
          persistedCandidateId,
        snapshot_id:
          priceIntelligence.id,
        recommended_sale_price:
          recommendedSalePrice,
        source_type:
          priceIntelligence.source_type,
        confidence_score:
          priceIntelligence.confidence_score,
        action:
          "reprocess_with_price_intelligence",
        pipeline_reanalysis_advisor:
          reanalysisAdvisor,
      },
      {
        fromState:
          candidate.state,
        idempotencyKey:
          `candidate_reprocessed_with_price_intelligence:${persistedCandidateId}:${priceIntelligence.id}:${Date.now()}`,
      }
    )

  return {
    ...result,
    pipelineReanalysisAdvisor:
      reanalysisAdvisor,
    priceIntelligence,
    persisted: {
      candidate:
        persistedCandidate,
      validation,
      profitScenario,
      compliance,
      score,
      auditLog,
    },
  }
}

export async function reprocessCandidateWithSuggestedPrice({
  supabase,
  candidateId,
  supplierSku,
  candidateKey,
  suggestedTargetPrice,
  actor = "admin",
  config = {},
}) {
  const targetPrice =
    toFiniteNumber(
      suggestedTargetPrice
    )

  if (
    targetPrice === null ||
    targetPrice <= 0
  ) {
    throw new Error(
      "suggested_target_price_required"
    )
  }

  let candidateQuery =
    supabase
      .from("ebay_product_candidates")
      .select("*")

  if (candidateId) {
    candidateQuery =
      candidateQuery.eq(
        "id",
        candidateId
      )
  } else if (candidateKey) {
    candidateQuery =
      candidateQuery.eq(
        "candidate_key",
        candidateKey
      )
  } else if (supplierSku) {
    candidateQuery =
      candidateQuery.eq(
        "supplier_sku",
        supplierSku
      )
  } else {
    throw new Error(
      "candidate_identifier_required"
    )
  }

  const {
    data: candidate,
    error: candidateError,
  } =
    await candidateQuery
      .order(
        "last_evaluated_at",
        {
          ascending: false,
          nullsFirst: false,
        }
      )
      .limit(1)
      .maybeSingle()

  if (candidateError) {
    throw new Error(
      candidateError.message
    )
  }

  if (!candidate) {
    throw new Error(
      "candidate_not_found"
    )
  }

  const priceIntelligenceSnapshots =
    await getPriceIntelligenceForCandidate({
      supabase,
      candidateId:
        candidate.id,
      supplierSku:
        candidate.supplier_sku,
      marketRadarProductId:
        candidate.market_radar_product_id,
    })

  const latestPriceIntelligence =
    priceIntelligenceSnapshots[0] ||
    null

  if (!latestPriceIntelligence) {
    throw new Error(
      "suggested_target_price_requires_market_evidence"
    )
  }

  if (
    !isSuggestedPriceMarketCompetitive(
      targetPrice,
      latestPriceIntelligence
    )
  ) {
    throw new Error(
      "suggested_target_price_not_competitive"
    )
  }

  const previousSalePrice =
    toFiniteNumber(
      isObject(candidate.normalized_payload)
        ? candidate.normalized_payload.estimated_sale_price
        : null
    )

  const radarProduct =
    buildRadarProductFromCandidate(
      candidate,
      targetPrice
    )

  const result =
    processRadarCandidate(
      radarProduct,
      config
    )

  result.candidate.candidate_key =
    candidate.candidate_key
  result.candidate.source_id =
    candidate.source_id
  result.candidate.market_radar_product_id =
    candidate.market_radar_product_id
  result.candidate.market_radar_snapshot_id =
    candidate.market_radar_snapshot_id

  const reanalysisAdvisor =
    getPipelineReanalysisAdvisor({
      existingCandidate:
        candidate,
      radarProduct,
      advisorEvents: [
        {
          event_type:
            "price_down",
        },
      ],
      inventoryContext:
        getRadarProductInventoryContext(
          radarProduct
        ),
    })

  const candidatePayload =
    getCandidateUpsertPayload(
      result,
      radarProduct,
      {
        existingCandidate:
          candidate,
        reanalysisAdvisor,
      }
    )

  const persistedCandidate =
    await upsertByKey(
      supabase,
      "ebay_product_candidates",
      candidatePayload,
      "candidate_key"
    )

  const persistedCandidateId =
    persistedCandidate.id

  const validation =
    await upsertByKey(
      supabase,
      "ebay_candidate_validations",
      {
        candidate_id:
          persistedCandidateId,
        validation_version:
          PIPELINE_VERSION,
        validation_status:
          result.validation.status,
        required_fields: [
          "supplier_sku",
          "title",
          "cost",
          "stock",
          "weight_or_dimensions",
          "authorized_images",
          "category_or_inference_data",
        ],
        missing_fields:
          result.validation.missingFields,
        critical_reasons:
          result.validation.criticalReasons,
        validated_at:
          new Date().toISOString(),
        idempotency_key:
          `validation:${persistedCandidateId}:${PIPELINE_VERSION}`,
      }
    )

  const profitScenario =
    await upsertByKey(
      supabase,
      "ebay_profit_scenarios",
      {
        candidate_id:
          persistedCandidateId,
        scenario_version:
          PIPELINE_VERSION,
        ...getProfitScenarioUpsertPayload(
          result.profitScenario
        ),
        calculated_at:
          new Date().toISOString(),
        idempotency_key:
          `profit:${persistedCandidateId}:${PIPELINE_VERSION}`,
      }
    )

  const compliance =
    await upsertByKey(
      supabase,
      "ebay_compliance_checks",
      {
        candidate_id:
          persistedCandidateId,
        check_version:
          PIPELINE_VERSION,
        overall_status:
          result.compliance.overall_status,
        blocker_count:
          result.compliance.blocker_count,
        findings:
          result.compliance.findings,
        checked_at:
          new Date().toISOString(),
        idempotency_key:
          `compliance:${persistedCandidateId}:${PIPELINE_VERSION}`,
      }
    )

  const score =
    await upsertByKey(
      supabase,
      "ebay_candidate_scores",
      {
        candidate_id:
          persistedCandidateId,
        score_version:
          PIPELINE_VERSION,
        winner_score:
          result.score.winner_score,
        demand_score:
          result.score.breakdown.demand,
        profitability_score:
          result.score.breakdown.profitability,
        competition_score:
          result.score.breakdown.competition,
        stock_stability_score:
          result.score.breakdown.stock_stability,
        data_quality_score:
          result.score.breakdown.data_quality,
        inverse_operational_risk_score:
          result.score.breakdown.inverse_operational_risk,
        explanation:
          result.explanation,
        score_payload:
          result.score,
        calculated_at:
          new Date().toISOString(),
        idempotency_key:
          `score:${persistedCandidateId}:${PIPELINE_VERSION}`,
      }
    )

  const auditLog =
    await insertAuditLog(
      supabase,
      persistedCandidateId,
      "candidate_reprocessed_with_suggested_price",
      result.candidate.state,
      {
        candidate_id:
          persistedCandidateId,
        suggested_target_price:
          targetPrice,
        minimum_target_margin_percent:
          result.profitScenario.assumptions?.targetPriceAdvisor
            ?.minimum_target_margin_percent,
        previous_sale_price:
          previousSalePrice,
        source:
          "target_price_advisor",
        pipeline_reanalysis_advisor:
          reanalysisAdvisor,
      },
      {
        fromState:
          candidate.state,
        idempotencyKey:
          `candidate_reprocessed_with_suggested_price:${persistedCandidateId}:${targetPrice}:${Date.now()}`,
      }
    )

  return {
    ...result,
    pipelineReanalysisAdvisor:
      reanalysisAdvisor,
    persisted: {
      candidate:
        persistedCandidate,
      validation,
      profitScenario,
      compliance,
      score,
      auditLog,
    },
  }
}

export async function recordCandidateDecision({
  supabase,
  candidateId,
  candidateKey,
  action,
  messageId,
  decidedBy = "admin",
  payload = {},
}) {
  const toState =
    normalizeDecisionAction(action)

  if (!toState) {
    throw new Error("decision_action_not_supported")
  }

  const idempotencyKey =
    buildDecisionIdempotencyKey({
      candidateKey,
      messageId,
      action,
    })

  const decision =
    await upsertByKey(
      supabase,
      "ebay_candidate_decisions",
      {
        candidate_id:
          candidateId,
        decision:
          action,
        decision_channel:
          "whatsapp_dry_run",
        message_id:
          messageId || null,
        decided_by:
          decidedBy,
        decision_payload:
          payload,
        idempotency_key:
          idempotencyKey,
      }
    )

  const { data: candidate, error } =
    await supabase
      .from("ebay_product_candidates")
      .update({
        state:
          toState,
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", candidateId)
      .select("*")
      .single()

  if (error) {
    throw new Error(error.message)
  }

  let listingDraft = null

  if (action === "create_draft") {
    const normalizedPayload =
      candidate.normalized_payload ||
      {}

    listingDraft =
      await upsertByKey(
        supabase,
        "ebay_listing_drafts",
        {
          candidate_id:
            candidateId,
          draft_status:
            "created",
          title:
            candidate.title,
          description_html:
            normalizedPayload.product_url
              ? `<p>Draft local generado desde Radar IMNOVA. Revisar datos antes de conectar eBay.</p><p>Fuente: ${normalizedPayload.product_url}</p>`
              : "<p>Draft local generado desde Radar IMNOVA. Revisar datos antes de conectar eBay.</p>",
          category_id:
            normalizedPayload.suggested_category_id ||
            null,
          condition_id:
            null,
          price:
            normalizedPayload.estimated_sale_price ??
            null,
          quantity:
            normalizedPayload.stock ??
            null,
          supplier_sku:
            candidate.supplier_sku ||
            null,
          brand:
            candidate.brand ||
            null,
          image_urls:
            normalizedPayload.image_urls ||
            [],
          aspects: {},
          shipping_policy: {},
          return_policy: {},
          payment_policy: {},
          dry_run_only:
            true,
          ebay_draft_id:
            null,
        },
        "candidate_id"
      )
  }

  const auditLog =
    await insertAuditLog(
      supabase,
      candidateId,
      "candidate_decision_recorded",
      toState,
      {
        action,
        messageId:
          messageId || null,
        idempotencyKey,
        localDraftCreated:
          Boolean(listingDraft),
      }
    )

  return {
    decision,
    candidate,
    listingDraft,
    auditLog,
  }
}
