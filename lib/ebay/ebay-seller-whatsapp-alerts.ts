import type { SupabaseClient } from "@supabase/supabase-js"

import {
  classifySellerWhatsAppAlert,
  nextSellerWhatsAppDigestAt,
  sellerWhatsAppPriorityRank,
  type SellerWhatsAppAlertFacts,
  type SellerWhatsAppAlertType,
  type SellerWhatsAppDeliveryClass,
  type SellerWhatsAppPriority,
} from "@/lib/ebay/ebay-seller-whatsapp-alert-policy"
import {
  getSellerWhatsAppGatewayConfiguration,
  preflightSellerWhatsAppGateway,
  sendSellerWhatsAppApprovedTemplate,
  type SellerWhatsAppTemplateMessage,
} from "@/lib/ebay/ebay-seller-whatsapp-gateway"

type FetchLike = typeof fetch

type AlertOutboxRow = {
  id: string
  alert_type: string
  priority: SellerWhatsAppPriority
  entity_type: string
  entity_id: string
  candidate_key: string | null
  status: string
  payload: Record<string, unknown> | null
  due_at: string
  attempts: number
  delivery_class: SellerWhatsAppDeliveryClass | null
  dedupe_key: string | null
  created_at?: string
}

export type EnqueueSellerWhatsAppAlertInput = {
  alertType: SellerWhatsAppAlertType
  entityType: string
  entityId: string
  candidateKey?: string | null
  title: string
  summary: string
  mobileUrl?: string | null
  facts?: SellerWhatsAppAlertFacts
}

function text(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}

function safeUrl(value: unknown) {
  const candidate = text(value, 500)
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    return url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function safeFacts(facts: SellerWhatsAppAlertFacts) {
  return {
    potentialScore: numeric(facts.potentialScore),
    confidenceScore: numeric(facts.confidenceScore),
    currentStock: numeric(facts.currentStock),
    previousStock: numeric(facts.previousStock),
    estimatedMarginPct: numeric(facts.estimatedMarginPct),
    estimatedNetProfit: numeric(facts.estimatedNetProfit),
    costChangePct: numeric(facts.costChangePct),
    hasExactEvidence: facts.hasExactEvidence === true,
    hasActiveListing: facts.hasActiveListing === true,
    terminalFailure: facts.terminalFailure === true,
    hoursUntilExpiration: numeric(facts.hoursUntilExpiration),
  }
}

function digestHourUtc() {
  const configured = Number(
    process.env.EBAY_SELLER_WHATSAPP_DIGEST_HOUR_UTC ?? "14",
  )
  return Number.isFinite(configured) ? configured : 14
}

export async function enqueueSellerWhatsAppAlert(
  supabase: SupabaseClient,
  input: EnqueueSellerWhatsAppAlertInput,
) {
  const facts = safeFacts(input.facts ?? {})
  const decision = classifySellerWhatsAppAlert(input.alertType, facts)
  if (!decision.eligible) {
    return {
      enqueued: false,
      alertId: null,
      reason: decision.reason,
      decision,
    }
  }

  const entityType = text(input.entityType, 80)
  const entityId = text(input.entityId, 200)
  if (!entityType || !entityId) throw new Error("SELLER_WHATSAPP_ENTITY_REQUIRED")
  const candidateKey = text(input.candidateKey, 300) || null
  const dedupeKey = [
    "seller-whatsapp-v1",
    input.alertType,
    entityType,
    entityId,
    candidateKey ?? "none",
  ].join(":")
  const dueAt = decision.deliveryClass === "digest"
    ? nextSellerWhatsAppDigestAt(new Date(), digestHourUtc()).toISOString()
    : new Date().toISOString()
  const payload = {
    policyVersion: "EBAY_SELLER_WHATSAPP_ALERT_POLICY_V1",
    title: text(input.title, 120),
    summary: text(input.summary, 360),
    recommendedAction: text(decision.recommendedAction, 300),
    mobileUrl: safeUrl(input.mobileUrl),
    facts,
  }
  const { data, error } = await supabase.rpc(
    "enqueue_ebay_seller_whatsapp_alert",
    {
      p_dedupe_key: dedupeKey,
      p_alert_type: input.alertType,
      p_priority: decision.priority,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_candidate_key: candidateKey,
      p_delivery_class: decision.deliveryClass,
      p_payload: payload,
      p_due_at: dueAt,
      p_cooldown_seconds: decision.cooldownSeconds,
    },
  )
  if (error) throw new Error("SELLER_WHATSAPP_ENQUEUE_FAILED")
  const result = (Array.isArray(data) ? data[0] : data) as {
    alert_id?: string | null
    enqueued?: boolean
    reason?: string
    due_at?: string
  } | null
  return {
    enqueued: result?.enqueued === true,
    alertId: result?.alert_id ?? null,
    reason: result?.reason ?? "unknown",
    dueAt: result?.due_at ?? dueAt,
    decision,
  }
}

export async function resolveSellerWhatsAppAlert(
  supabase: SupabaseClient,
  input: Pick<EnqueueSellerWhatsAppAlertInput,
    "alertType" | "entityType" | "entityId" | "candidateKey">
) {
  const dedupeKey = [
    "seller-whatsapp-v1",
    input.alertType,
    text(input.entityType, 80),
    text(input.entityId, 200),
    text(input.candidateKey, 300) || "none",
  ].join(":")
  const { data, error } = await supabase.rpc(
    "resolve_ebay_seller_whatsapp_alert",
    { p_dedupe_key: dedupeKey },
  )
  if (error) throw new Error("SELLER_WHATSAPP_RESOLVE_FAILED")
  return data === true
}

function payload(row: AlertOutboxRow) {
  return row.payload && typeof row.payload === "object" ? row.payload : {}
}

function priorityLabel(priority: SellerWhatsAppPriority) {
  if (priority === "critical") return "CRÍTICA · actuar ahora"
  if (priority === "high") return "ALTA · revisar pronto"
  if (priority === "medium") return "RESUMEN · revisar hoy"
  return "INFORMATIVA"
}

export function renderSellerWhatsAppAlert(
  row: AlertOutboxRow,
): SellerWhatsAppTemplateMessage {
  const data = payload(row)
  const url = safeUrl(data.mobileUrl) || safeUrl(
    process.env.EBAY_SELLER_COMMAND_CENTER_URL,
  )
  const action = text(data.recommendedAction, 320)
  return {
    deliveryClass: row.delivery_class === "digest" ? "digest" : "immediate",
    priorityLabel: priorityLabel(row.priority),
    title: text(data.title || row.alert_type, 120),
    summary: text(data.summary || "Alerta del Seller Command Center.", 500),
    action: text([action, url].filter(Boolean).join(" "), 500),
  }
}

function renderDigest(rows: AlertOutboxRow[]): SellerWhatsAppTemplateMessage {
  const summaries = rows.slice(0, 12).map((row, index) => {
    const rendered = renderSellerWhatsAppAlert(row)
    return `${index + 1}. ${rendered.title}: ${rendered.summary}`
  })
  const commandCenterUrl = safeUrl(process.env.EBAY_SELLER_COMMAND_CENTER_URL)
  return {
    deliveryClass: "digest",
    priorityLabel: "RESUMEN DIARIO",
    title: `${rows.length} alertas para revisar`,
    summary: text(summaries.join(" | "), 500),
    action: text(
      `Priorizar margen, stock y evidencia antes de aprobar.${commandCenterUrl ? ` ${commandCenterUrl}` : ""}`,
      500,
    ),
  }
}

export async function previewSellerWhatsAppAlerts(
  supabase: SupabaseClient,
  limit = 20,
) {
  const { data, error } = await supabase
    .from("ebay_seller_alert_outbox")
    .select("id,alert_type,priority,entity_type,entity_id,candidate_key,status,payload,due_at,attempts,delivery_class,dedupe_key,created_at")
    .eq("channel", "whatsapp")
    .in("status", ["pending", "failed"])
    .order("due_at", { ascending: true })
    .limit(50)
  if (error) throw new Error("SELLER_WHATSAPP_PREVIEW_FAILED")
  return ((data ?? []) as AlertOutboxRow[])
    .sort((left, right) =>
      sellerWhatsAppPriorityRank(left.priority) - sellerWhatsAppPriorityRank(right.priority) ||
      Date.parse(left.due_at) - Date.parse(right.due_at)
    )
    .slice(0, Math.max(1, Math.min(limit, 50)))
    .map((row) => ({
    alertId: row.id,
    alertType: row.alert_type,
    priority: row.priority,
    deliveryClass: row.delivery_class ?? "immediate",
    dueAt: row.due_at,
    attempts: row.attempts,
    message: renderSellerWhatsAppAlert(row),
  }))
}

async function recordSuccess(
  supabase: SupabaseClient,
  row: AlertOutboxRow,
  providerMessageId: string | null,
  responseCode: number | null,
) {
  const { data, error } = await supabase.rpc("complete_ebay_seller_whatsapp_alert", {
    p_alert_id: row.id,
    p_attempt_number: row.attempts,
    p_provider_message_id: providerMessageId,
    p_response_code: responseCode === null ? null : String(responseCode),
  })
  if (error || data !== true) throw new Error("SELLER_WHATSAPP_DELIVERY_RECORD_FAILED")
}

async function recordFailure(
  supabase: SupabaseClient,
  row: AlertOutboxRow,
  errorCode: string,
  responseCode: number | null,
) {
  const { data, error } = await supabase.rpc("fail_ebay_seller_whatsapp_alert", {
    p_alert_id: row.id,
    p_attempt_number: row.attempts,
    p_error_code: text(errorCode, 120) || "SELLER_WHATSAPP_DELIVERY_FAILED",
    p_response_code: responseCode === null ? null : String(responseCode),
  })
  if (error || data !== true) throw new Error("SELLER_WHATSAPP_FAILURE_RECORD_FAILED")
}

export async function deliverSellerWhatsAppAlerts(
  supabase: SupabaseClient,
  options: {
    workerId: string
    limit?: number
    dryRun?: boolean
    fetchImpl?: FetchLike
  },
) {
  const configuration = getSellerWhatsAppGatewayConfiguration()
  if (options.dryRun !== false || !configuration.deliveryAttemptAllowed) {
    return {
      mode: "preview" as const,
      configuration,
      claimed: 0,
      delivered: 0,
      failed: 0,
      previews: await previewSellerWhatsAppAlerts(supabase, options.limit),
    }
  }

  const preflight = await preflightSellerWhatsAppGateway({
    fetchImpl: options.fetchImpl,
  })
  if (!preflight.success) {
    return {
      mode: "blocked" as const,
      configuration: getSellerWhatsAppGatewayConfiguration(),
      preflight,
      claimed: 0,
      delivered: 0,
      failed: 0,
    }
  }

  const { data, error } = await supabase.rpc("claim_ebay_seller_whatsapp_alerts", {
    p_worker_id: text(options.workerId, 120),
    p_limit: Math.max(1, Math.min(options.limit ?? 20, 50)),
    p_lease_seconds: 120,
  })
  if (error) throw new Error("SELLER_WHATSAPP_CLAIM_FAILED")
  const rows = (data ?? []) as AlertOutboxRow[]
  const immediate = rows.filter((row) => row.delivery_class !== "digest")
  const digest = rows.filter((row) => row.delivery_class === "digest")
  let delivered = 0
  let failed = 0
  let digestMessages = 0

  for (const row of immediate) {
    const result = await sendSellerWhatsAppApprovedTemplate(
      renderSellerWhatsAppAlert(row),
      { fetchImpl: options.fetchImpl },
    )
    if (result.success) {
      await recordSuccess(
        supabase,
        row,
        result.providerMessageId,
        result.statusCode,
      )
      delivered += 1
    } else {
      await recordFailure(
        supabase,
        row,
        result.errorCode ?? "SELLER_WHATSAPP_DELIVERY_FAILED",
        result.statusCode,
      )
      failed += 1
    }
  }

  for (let index = 0; index < digest.length; index += 12) {
    const digestGroup = digest.slice(index, index + 12)
    const result = await sendSellerWhatsAppApprovedTemplate(
      renderDigest(digestGroup),
      { fetchImpl: options.fetchImpl },
    )
    digestMessages += 1
    for (const row of digestGroup) {
      if (result.success) {
        await recordSuccess(
          supabase,
          row,
          result.providerMessageId,
          result.statusCode,
        )
        delivered += 1
      } else {
        await recordFailure(
          supabase,
          row,
          result.errorCode ?? "SELLER_WHATSAPP_DELIVERY_FAILED",
          result.statusCode,
        )
        failed += 1
      }
    }
  }

  return {
    mode: "delivery" as const,
    configuration,
    claimed: rows.length,
    delivered,
    failed,
    digestMessages,
  }
}
