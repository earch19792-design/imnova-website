import { createHash } from "node:crypto"

export const WHATSAPP_ALERT_ENGINE_VERSION = "SELLER_OS_WHATSAPP_ALERT_ENGINE_V1_2026_08_12"

export type WhatsAppAlertFamilyV1 = "COMPONENT_OUT_OF_STOCK" | "OVERSELL_RISK" |
  "ORDER_AFFECTED_BY_STOCK" | "LOW_STOCK_OR_STALE_EVIDENCE" |
  "PACK_IMAGE_COMPOSITION_INCONSISTENCY" | "HIGH_IMPRESSIONS_LOW_CTR" |
  "EXPERIMENT_READY_TO_EVALUATE" | "DAILY_SUMMARY"
export type WhatsAppSeverityV1 = "CRITICAL" | "IMPORTANT" | "OPPORTUNITY" |
  "EXPERIMENT_RESULT" | "DAILY_DIGEST"

const TEMPLATE_ROWS = [
  ["COMPONENT_OUT_OF_STOCK", "seller_os_component_out_of_stock", "UTILITY",
    "Componente sin stock confirmado", ["subject", "affectedListings", "safeCapacity", "observedAt", "deepLink"]],
  ["OVERSELL_RISK", "seller_os_oversell_risk", "UTILITY",
    "Riesgo de sobreventa", ["subject", "publishedQuantity", "safeCapacity", "limitingComponent", "deepLink"]],
  ["ORDER_AFFECTED_BY_STOCK", "seller_os_order_stock_risk", "UTILITY",
    "Orden afectada por stock", ["safeOrderReference", "subject", "stockState", "recommendedAction", "deepLink"]],
  ["LOW_STOCK_OR_STALE_EVIDENCE", "seller_os_low_stock_or_stale", "UTILITY",
    "Stock bajo o evidencia vencida", ["subject", "evidenceState", "evidenceDetail", "observedAt", "deepLink"]],
  ["PACK_IMAGE_COMPOSITION_INCONSISTENCY", "seller_os_composition_issue", "UTILITY",
    "Inconsistencia de composición", ["subject", "issue", "evidence", "recommendedAction", "deepLink"]],
  ["HIGH_IMPRESSIONS_LOW_CTR", "seller_os_ctr_opportunity", "MARKETING",
    "Oportunidad de CTR", ["subject", "impressions", "ctr", "hypothesis", "deepLink"]],
  ["EXPERIMENT_READY_TO_EVALUATE", "seller_os_experiment_result", "UTILITY",
    "Experimento listo para evaluar", ["subject", "experimentId", "metricDelta", "outcome", "deepLink"]],
  ["DAILY_SUMMARY", "seller_os_daily_summary", "UTILITY",
    "Resumen diario Seller OS", ["criticalCount", "reviewCount", "experimentCount", "dataBlockers", "deepLink"]],
] as const

const EXAMPLE_VALUES: Record<WhatsAppAlertFamilyV1, Record<string, string>> = {
  COMPONENT_OUT_OF_STOCK: { subject: "Producto de ejemplo", affectedListings: "2 listings",
    safeCapacity: "0 unidades", observedAt: "fecha de evidencia", deepLink: "/admin/ebay/stock-guard" },
  OVERSELL_RISK: { subject: "Listing de ejemplo", publishedQuantity: "5", safeCapacity: "2",
    limitingComponent: "componente verificado", deepLink: "/admin/ebay/stock-guard" },
  ORDER_AFFECTED_BY_STOCK: { safeOrderReference: "ORDER-SAFE-EXAMPLE", subject: "Producto de ejemplo",
    stockState: "OUT_OF_STOCK_CONFIRMED", recommendedAction: "Revisar cumplimiento",
    deepLink: "/admin/ebay/stock-guard" },
  LOW_STOCK_OR_STALE_EVIDENCE: { subject: "Listing de ejemplo", evidenceState: "STALE_EVIDENCE",
    evidenceDetail: "Disponibilidad actual no confirmada", observedAt: "fecha de evidencia",
    deepLink: "/admin/ebay/stock-guard" },
  PACK_IMAGE_COMPOSITION_INCONSISTENCY: { subject: "Listing de ejemplo", issue: "Composición inconsistente",
    evidence: "Evidencia autorizada", recommendedAction: "Revisión humana", deepLink: "/admin/ebay/monitor" },
  HIGH_IMPRESSIONS_LOW_CTR: { subject: "Listing de ejemplo", impressions: "1,500", ctr: "0.4%",
    hypothesis: "Probar una variable controlada", deepLink: "/admin/ebay/monitor" },
  EXPERIMENT_READY_TO_EVALUATE: { subject: "Listing de ejemplo", experimentId: "EXP-SAFE-EXAMPLE",
    metricDelta: "+0.2 puntos", outcome: "INCONCLUSIVE", deepLink: "/admin/ebay/monitor" },
  DAILY_SUMMARY: { criticalCount: "1", reviewCount: "3", experimentCount: "0",
    dataBlockers: "2", deepLink: "/admin/ebay/monitor" },
}

const LOW_STOCK_REVIEW_EXAMPLE = { subject: "Listing de ejemplo",
  evidenceState: "LOW_STOCK_CONFIRMED", evidenceDetail: "2 unidades confirmadas; 1 publicada",
  observedAt: "fecha de evidencia", deepLink: "/admin/ebay/stock-guard" }

export const WHATSAPP_TEMPLATE_DEFINITIONS_V1 = Object.freeze(TEMPLATE_ROWS.map(
  ([internalTemplateKey, intendedMetaTemplateName, categorySuggestion, humanTitle, variableSchema]) => ({
    internalTemplateKey: internalTemplateKey as WhatsAppAlertFamilyV1,
    intendedMetaTemplateName, language: "es" as const, categorySuggestion, humanTitle,
    variableSchema: [...variableSchema],
    examplePayload: { classification: "NON_OPERATIONAL_TEMPLATE_EXAMPLE" as const,
      values: EXAMPLE_VALUES[internalTemplateKey] },
    humanReviewStates: internalTemplateKey === "LOW_STOCK_OR_STALE_EVIDENCE" ? [
      { state: "LOW_STOCK_CONFIRMED" as const, classification:
        "NON_OPERATIONAL_TEMPLATE_EXAMPLE" as const, values: LOW_STOCK_REVIEW_EXAMPLE },
      { state: "STALE_EVIDENCE" as const, classification:
        "NON_OPERATIONAL_TEMPLATE_EXAMPLE" as const, values: EXAMPLE_VALUES[internalTemplateKey] },
    ] : [],
    maximumSafeContentLength: 900,
    fallbackText: "Seller OS detectó evidencia que requiere revisión protegida.",
    deepLinkVariable: "deepLink", piiClassification: "NO_BUYER_PII" as const,
    approvalStatus: "NOT_SUBMITTED" as const, dispatchAllowed: false as const,
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
  experiment?: { experimentId: string; transition: "READY_TO_EVALUATE" | "COMPLETED" | "OTHER";
    evidenceSufficient: boolean; outcome?: string | null } | null
  stock?: { riskClass: string; exactIdentity: boolean; publishedQuantity?: number | null;
    safeCapacity?: number | null; supplierQuantity?: number | null;
    limitingComponent?: string | null } | null
  analytics?: { impressions: number | null; ctr: number | null; evidenceSufficient: boolean } | null
  compositionEvidenceAuthoritative?: boolean
  dailySummary?: Array<{ eventKey: string; meaningful: boolean }> | null
  deepLinkPath: string
  previousDelivery?: { dedupeKey: string; severity: WhatsAppSeverityV1; sentAt: string } | null
  now?: string
  cooldownHours?: number
  previewClassification?: "OPERATIONAL_EVIDENCE" | "TEMPLATE_EXAMPLE_PREVIEW"
}

const PII = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\+?\d[\d .()-]{8,}\d)\b|street|address|buyer|recipient/i

function hash(value: string) { return createHash("sha256").update(value).digest("hex") }
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
  if (input.family === "COMPONENT_OUT_OF_STOCK") return input.stock?.riskClass ===
    "OUT_OF_STOCK_CONFIRMED" && input.stock.exactIdentity
  if (input.family === "OVERSELL_RISK") return input.stock?.riskClass === "OVERSELL_RISK" &&
    input.stock.exactIdentity && input.stock.publishedQuantity !== null && input.stock.safeCapacity !== null
  if (input.family === "ORDER_AFFECTED_BY_STOCK") return input.order?.capabilityAvailable === true &&
    Boolean(input.order.safeReference) && ["OUT_OF_STOCK_CONFIRMED", "OVERSELL_RISK"]
      .includes(input.stock?.riskClass ?? "")
  if (input.family === "LOW_STOCK_OR_STALE_EVIDENCE") {
    return input.stock?.exactIdentity === true &&
      ["LOW_STOCK_CONFIRMED", "STALE_EVIDENCE"].includes(input.stock?.riskClass ?? "")
  }
  if (input.family === "PACK_IMAGE_COMPOSITION_INCONSISTENCY") {
    return input.compositionEvidenceAuthoritative === true
  }
  if (input.family === "HIGH_IMPRESSIONS_LOW_CTR") return input.analytics?.evidenceSufficient === true &&
    (input.analytics.impressions ?? 0) > 0 && input.analytics.ctr !== null
  if (input.family === "EXPERIMENT_READY_TO_EVALUATE") {
    return input.experiment?.evidenceSufficient === true &&
      ["READY_TO_EVALUATE", "COMPLETED"].includes(input.experiment.transition)
  }
  return new Set((input.dailySummary ?? []).filter((row) => row.meaningful)
    .map((row) => row.eventKey)).size > 0
}

function humanMessage(input: AlertInput, title: string, deepLink: string, eligible: boolean) {
  if (!eligible) return { title: "Evidencia insuficiente", subject: title,
    problem: `No se genera alerta ${input.family.replaceAll("_", " ").toLowerCase()}.`,
    evidence: "Los requisitos autoritativos de la familia no están completos.",
    recommendedAction: "Completar evidencia antes de notificar.", observedAt: input.observedAt,
    deepLinkLabel: "Revisar en Seller OS", deepLink }
  const risk = input.stock?.riskClass
  if (input.family === "LOW_STOCK_OR_STALE_EVIDENCE" && risk === "STALE_EVIDENCE") return {
    title: "Evidencia de stock vencida", subject: title,
    problem: "La disponibilidad actual no está confirmada.",
    evidence: `Estado: STALE_EVIDENCE · observación ${input.observedAt}`,
    recommendedAction: "Actualizar la evidencia Luna antes de tomar una decisión de stock.",
    observedAt: input.observedAt, deepLinkLabel: "Abrir Stock Guard", deepLink }
  if (input.family === "LOW_STOCK_OR_STALE_EVIDENCE") return {
    title: "Stock bajo confirmado", subject: title,
    problem: "La variante exacta tiene evidencia autoritativa de stock bajo.",
    evidence: ["Estado: LOW_STOCK_CONFIRMED",
      input.stock?.supplierQuantity !== null && input.stock?.supplierQuantity !== undefined
        ? `stock proveedor ${input.stock.supplierQuantity}` : null,
      input.stock?.publishedQuantity !== null && input.stock?.publishedQuantity !== undefined
        ? `cantidad publicada ${input.stock.publishedQuantity}` : null,
      input.stock?.safeCapacity !== null && input.stock?.safeCapacity !== undefined
        ? `capacidad segura ${input.stock.safeCapacity}` : null,
      `observación ${input.observedAt}`].filter(Boolean).join(" · "),
    recommendedAction: input.stock?.publishedQuantity !== null &&
      input.stock?.publishedQuantity !== undefined && input.stock?.safeCapacity !== null &&
      input.stock?.safeCapacity !== undefined && input.stock.publishedQuantity > input.stock.safeCapacity
      ? "La exposición supera la capacidad segura; revisar cantidad publicada sin ejecutar cambios automáticos."
      : "Revisar exposición publicada y capacidad segura.",
    observedAt: input.observedAt, deepLinkLabel: "Abrir Stock Guard", deepLink }
  const labels: Record<WhatsAppAlertFamilyV1, [string, string, string]> = {
    COMPONENT_OUT_OF_STOCK: ["Componente sin stock confirmado", "Un componente exacto limita listings activos.", "Revisar listings afectados y capacidad segura."],
    OVERSELL_RISK: ["Riesgo de sobreventa", "La exposición publicada supera la capacidad segura probada.", "Revisar cantidad publicada sin ejecutar cambios automáticos."],
    ORDER_AFFECTED_BY_STOCK: ["Orden afectada por stock", "Una orden segura coincide con riesgo de stock probado.", "Revisar cumplimiento sin exponer datos del comprador."],
    LOW_STOCK_OR_STALE_EVIDENCE: ["Evidencia de stock", "Revisión de stock requerida.", "Abrir Stock Guard."],
    PACK_IMAGE_COMPOSITION_INCONSISTENCY: ["Inconsistencia de composición", "La evidencia autorizada no reconcilia pack, imagen o componentes.", "Enviar a revisión humana."],
    HIGH_IMPRESSIONS_LOW_CTR: ["Oportunidad de CTR", "Hay impresiones suficientes y CTR bajo en la ventana observada.", "Preparar un experimento controlado de una variable."],
    EXPERIMENT_READY_TO_EVALUATE: ["Experimento listo para evaluar", "La transición y evidencia cumplen el contrato.", "Evaluar resultado antes de tocar variables congeladas."],
    DAILY_SUMMARY: ["Resumen diario Seller OS", "Se agruparon únicamente estados operativos significativos.", "Priorizar críticos y revisiones humanas."],
  }
  const [messageTitle, problem, recommendedAction] = labels[input.family]
  return { title: messageTitle, subject: title, problem,
    evidence: `Causa: ${clean(input.rootCause, 160) ?? "EVIDENCE_REVIEW_REQUIRED"} · observación ${input.observedAt}`,
    recommendedAction, observedAt: input.observedAt, deepLinkLabel: "Revisar en Seller OS", deepLink }
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
  const deepLink = input.deepLinkPath.startsWith("/admin/ebay/")
    ? input.deepLinkPath : "/admin/ebay/operational-readiness"
  const humanPreview = humanMessage(input, title, deepLink, eligible)
  const renderedContent = `${humanPreview.title}\n${humanPreview.subject}\n${humanPreview.problem}\n${humanPreview.evidence}\n${humanPreview.recommendedAction}\n${humanPreview.deepLinkLabel}: ${deepLink}`
  if (PII.test(renderedContent)) throw new Error("WHATSAPP_BUYER_PII_REJECTED")
  return { contractVersion: WHATSAPP_ALERT_ENGINE_VERSION, family: input.family,
    previewClassification: input.previewClassification ?? "OPERATIONAL_EVIDENCE",
    template: WHATSAPP_TEMPLATE_DEFINITIONS_V1.find((row) => row.internalTemplateKey === input.family),
    severity: currentSeverity, qualifies: eligible, humanPreview, renderedContent, deepLink, dedupeKey,
    cooldownState: inCooldown && !escalation ? "SUPPRESSED_UNCHANGED_EVIDENCE" as const
      : escalation ? "SEVERITY_ESCALATION_BYPASS" as const : "ELIGIBLE" as const,
    dispatchAllowed: false as const, realSendAttempted: false as const,
    buyerPiiIncluded: false as const }
}
