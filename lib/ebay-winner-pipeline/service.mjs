import {
  buildDecisionIdempotencyKey,
  normalizeDecisionAction,
  processRadarCandidate,
} from "./core.mjs"

const PIPELINE_VERSION = "v1"

function getBlockedReason(result) {
  return result.compliance.findings[0]?.code ||
    result.validation.criticalReasons[0] ||
    null
}

function getNeedsData(result) {
  return result.validation.missingFields
}

function getCandidateUpsertPayload(result, radarProduct) {
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
      radarProduct,
    normalized_payload:
      result.candidate,
    state:
      result.candidate.state,
    last_evaluated_at:
      new Date().toISOString(),
    blocked_reason:
      getBlockedReason(result),
    needs_data:
      getNeedsData(result),
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

async function insertAuditLog(supabase, candidateId, eventType, toState, payload) {
  return upsertByKey(
    supabase,
    "ebay_pipeline_audit_log",
    {
      candidate_id:
        candidateId,
      event_type:
        eventType,
      from_state:
        null,
      to_state:
        toState,
      actor:
        "system",
      payload,
      idempotency_key:
        `${eventType}:${candidateId}:${PIPELINE_VERSION}:${toState}`,
    }
  )
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

  const candidatePayload =
    getCandidateUpsertPayload(
      result,
      radarProduct
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
        ...result.profitScenario,
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
      }
    )

  return {
    ...result,
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
            normalizedPayload.estimated_sale_price ||
            null,
          quantity:
            normalizedPayload.stock ||
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
