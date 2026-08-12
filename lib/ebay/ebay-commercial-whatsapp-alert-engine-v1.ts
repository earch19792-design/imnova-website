import { createHash } from "node:crypto"

export const WHATSAPP_ALERT_ENGINE_VERSION = "SELLER_OS_WHATSAPP_ALERT_ENGINE_V1_2026_08_11"

export type WhatsAppAlertFamilyV1 = "COMPONENT_OUT_OF_STOCK" | "OVERSELL_RISK" |
  "ORDER_AFFECTED_BY_STOCK" | "LOW_STOCK_OR_STALE_EVIDENCE" |
  "PACK_IMAGE_COMPOSITION_INCONSISTENCY" | "HIGH_IMPRESSIONS_LOW_CTR" |
  "EXPERIMENT_READY_TO_EVALUATE" | "DAILY_SUMMARY"
export type WhatsAppSeverityV1 = "CRITICAL" | "IMPORTANT" | "OPPORTUNITY" |
  "EXPERIMENT_RESULT" | "DAILY_DIGEST"

export const WHATSAPP_TEMPLATE_DEFINITIONS_V1 = Object.freeze([
  ["COMPONENT_OUT_OF_STOCK", "seller_os_component_out_of_stock", "UTILITY"],
  ["OVERSELL_RISK", "seller_os_oversell_risk", "UTILITY"],
  ["ORDER_AFFECTED_BY_STOCK", "seller_os_order_stock_risk", "UTILITY"],
  ["LOW_STOCK_OR_STALE_EVIDENCE", "seller_os_low_stock_or_stale", "UTILITY"],
  ["PACK_IMAGE_COMPOSITION_INCONSISTENCY", "seller_os_composition_issue", "UTILITY"],
  ["HIGH_IMPRESSIONS_LOW_CTR", "seller_os_ctr_opportunity", "MARKETING"],
  ["EXPERIMENT_READY_TO_EVALUATE", "seller_os_experiment_result", "UTILITY"],
  ["DAILY_SUMMARY", "seller_os_daily_summary", "UTILITY"],
].map(([internalTemplateKey, intendedMetaTemplateName, categorySuggestion]) => ({
  internalTemplateKey: internalTemplateKey as WhatsAppAlertFamilyV1,
  intendedMetaTemplateName,
  language: "es" as const,
  categorySuggestion,
  variableSchema: ["subject", "state", "evidence", "recommendedAction", "deepLink"],
  examplePayload: null,
  maximumSafeContentLength: 900,
  fallbackText: "Seller OS detectó evidencia que requiere revisión protegida.",
  deepLinkVariable: "deepLink",
  piiClassification: "NO_BUYER_PII" as const,
  approvalStatus: "NOT_SUBMITTED" as const,
})))

type AlertInput = {
  accountKey: string
  family: WhatsAppAlertFamilyV1
  evidenceFingerprint: string
  stateVersion: string
  observedAt: string
  rootCause: string
  listing?: { itemId: string; title?: string | null }
  order?: { safeReference: string; capabilityAvailable: boolean } | null
  experiment?: {
    experimentId: string
    transition: "READY_TO_EVALUATE" | "COMPLETED" | "OTHER"
    evidenceSufficient: boolean
    outcome?: string | null
  } | null
  stock?: {
    riskClass: string
    exactIdentity: boolean
    publishedQuantity?: number | null
    safeCapacity?: number | null
    limitingComponent?: string | null
  } | null
  analytics?: { impressions: number | null; ctr: number | null; evidenceSufficient: boolean } | null
  compositionEvidenceAuthoritative?: boolean
  dailySummary?: Array<{ eventKey: string; meaningful: boolean }> | null
  deepLinkPath: string
  previousDelivery?: { dedupeKey: string; severity: WhatsAppSeverityV1; sentAt: string } | null
  now?: string
  cooldownHours?: number
}

const PII = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\+?\d[\d .()-]{8,}\d)\b|street|address|buyer|recipient/i

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function clean(value: unknown, maximum = 180) {
  if (typeof value !== "string") return null
  const text = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, maximum)
  if (PII.test(text)) throw new Error("WHATSAPP_BUYER_PII_REJECTED")
  return text || null
}

function severity(input: AlertInput): WhatsAppSeverityV1 {
  if (["COMPONENT_OUT_OF_STOCK", "OVERSELL_RISK", "ORDER_AFFECTED_BY_STOCK"]
    .includes(input.family)) return "CRITICAL"
  if (["LOW_STOCK_OR_STALE_EVIDENCE", "PACK_IMAGE_COMPOSITION_INCONSISTENCY"]
    .includes(input.family)) return "IMPORTANT"
  if (input.family === "HIGH_IMPRESSIONS_LOW_CTR") return "OPPORTUNITY"
  if (input.family === "EXPERIMENT_READY_TO_EVALUATE") return "EXPERIMENT_RESULT"
  return "DAILY_DIGEST"
}

const SEVERITY_RANK: Record<WhatsAppSeverityV1, number> = {
  DAILY_DIGEST: 1, OPPORTUNITY: 2, IMPORTANT: 3, EXPERIMENT_RESULT: 3, CRITICAL: 4,
}

function qualifies(input: AlertInput) {
  if (input.family === "COMPONENT_OUT_OF_STOCK") {
    return input.stock?.riskClass === "OUT_OF_STOCK_CONFIRMED" && input.stock.exactIdentity
  }
  if (input.family === "OVERSELL_RISK") {
    return input.stock?.riskClass === "OVERSELL_RISK" && input.stock.exactIdentity &&
      input.stock.publishedQuantity !== null && input.stock.safeCapacity !== null
  }
  if (input.family === "ORDER_AFFECTED_BY_STOCK") {
    return input.order?.capabilityAvailable === true && Boolean(input.order.safeReference) &&
      ["OUT_OF_STOCK_CONFIRMED", "OVERSELL_RISK"].includes(input.stock?.riskClass ?? "")
  }
  if (input.family === "LOW_STOCK_OR_STALE_EVIDENCE") {
    return ["LOW_STOCK_CONFIRMED", "STALE_EVIDENCE"].includes(input.stock?.riskClass ?? "")
  }
  if (input.family === "PACK_IMAGE_COMPOSITION_INCONSISTENCY") {
    return input.compositionEvidenceAuthoritative === true
  }
  if (input.family === "HIGH_IMPRESSIONS_LOW_CTR") {
    return input.analytics?.evidenceSufficient === true &&
      (input.analytics.impressions ?? 0) > 0 && input.analytics.ctr !== null
  }
  if (input.family === "EXPERIMENT_READY_TO_EVALUATE") {
    return input.experiment?.evidenceSufficient === true &&
      ["READY_TO_EVALUATE", "COMPLETED"].includes(input.experiment.transition)
  }
  return new Set((input.dailySummary ?? []).filter((row) => row.meaningful)
    .map((row) => row.eventKey)).size > 0
}

export function renderCommercialWhatsAppAlertDryRunV1(input: AlertInput) {
  const currentSeverity = severity(input)
  const identity = input.listing?.itemId ?? input.order?.safeReference ??
    input.experiment?.experimentId ?? "ACCOUNT"
  const dedupeKey = `wa_${hash([input.accountKey, identity, input.family, input.rootCause,
    input.evidenceFingerprint, input.stateVersion].join(":")).slice(0, 32)}`
  const now = new Date(input.now ?? new Date().toISOString())
  const previous = input.previousDelivery
  const cooldownHours = input.cooldownHours ?? 24
  const inCooldown = Boolean(previous && previous.dedupeKey === dedupeKey &&
    Number.isFinite(now.getTime()) && Number.isFinite(Date.parse(previous.sentAt)) &&
    (now.getTime() - Date.parse(previous.sentAt)) / 3_600_000 < cooldownHours)
  const escalation = Boolean(previous && SEVERITY_RANK[currentSeverity] >
    SEVERITY_RANK[previous.severity])
  const eligible = qualifies(input)
  const title = clean(input.listing?.title, 120) ??
    (input.listing ? `Item ${input.listing.itemId}` : input.order?.safeReference ?? "Seller OS")
  const rootCause = clean(input.rootCause, 160) ?? "EVIDENCE_REVIEW_REQUIRED"
  const deepLink = input.deepLinkPath.startsWith("/admin/ebay/")
    ? input.deepLinkPath : "/admin/ebay/operational-readiness"
  const renderedContent = eligible
    ? `${title} · ${input.family.replaceAll("_", " ")} · ${rootCause} · Revisar en Seller OS: ${deepLink}`
    : `No alert generated: ${input.family.replaceAll("_", " ")} evidence is insufficient.`
  if (PII.test(renderedContent)) throw new Error("WHATSAPP_BUYER_PII_REJECTED")
  return {
    contractVersion: WHATSAPP_ALERT_ENGINE_VERSION,
    family: input.family,
    template: WHATSAPP_TEMPLATE_DEFINITIONS_V1.find((row) =>
      row.internalTemplateKey === input.family),
    severity: currentSeverity,
    qualifies: eligible,
    renderedContent,
    deepLink,
    dedupeKey,
    cooldownState: inCooldown && !escalation ? "SUPPRESSED_UNCHANGED_EVIDENCE" as const
      : escalation ? "SEVERITY_ESCALATION_BYPASS" as const : "ELIGIBLE" as const,
    dispatchAllowed: false as const,
    realSendAttempted: false as const,
    buyerPiiIncluded: false as const,
  }
}
