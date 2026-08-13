export const SELLER_OS_UI_LANGUAGE_POLICY_V1 = Object.freeze({
  contractVersion: "SELLER_OS_UI_LANGUAGE_POLICY_V1",
  operatorLocale: "es",
  humanFacingText: "SPANISH_REQUIRED",
  technicalIdentifiers: "PRESERVE_SOURCE_CODE",
  technicalDisclosure: "PROGRESSIVE_DISCLOSURE",
} as const)

export const SELLER_OS_UI_TYPOGRAPHY_V1 = Object.freeze({
  pageTitle: "text-[28px] leading-tight font-black tracking-tight md:text-[32px]",
  pageSubtitle: "text-sm leading-6 text-slate-500 md:text-base",
  sectionEyebrow: "text-[13px] font-black uppercase tracking-[0.12em]",
  sectionTitle: "text-xl leading-tight font-black md:text-2xl",
  cardTitle: "text-[17px] leading-6 font-black md:text-lg",
  cardLabel: "text-[13px] leading-5 font-bold",
  body: "text-[15px] leading-6",
  helper: "text-[13px] leading-5",
  tablePrimary: "text-[15px] leading-5",
  tableSecondary: "text-[13px] leading-5",
  status: "text-[13px] leading-5 font-bold",
  button: "text-[15px] leading-5 font-bold",
} as const)

const HUMAN_LABELS: Readonly<Record<string, string>> = Object.freeze({
  AVAILABLE: "Disponible",
  COMPLETE: "Completo",
  UNAVAILABLE: "No disponible",
  UNAVAILABLE_AUTH_PENDING: "Autorización pendiente",
  UNAVAILABLE_NO_CURRENT_REPORT: "Sin informe vigente",
  AUTH_PENDING: "Autorización pendiente",
  UNPROVEN: "No comprobado",
  DEGRADED: "Degradado",
  PARTIAL: "Parcial",
  PARTIAL_CERTIFIED: "Certificado parcialmente",
  MISSING: "No disponible",
  ERROR: "Error de lectura",
  PASS: "Correcto",
  FAIL: "Requiere atención",
  TRIGGERED: "Requiere atención",
  MITIGATED: "Mitigado",
  ACTIVE_VIOLATION: "Incidencia activa",
  DETECTED_RISK: "Riesgo detectado",
  MITIGATED_BY_POLICY: "Mitigado",
  RECONCILED: "Reconciliado",
  ACCEPTED_EXCEPTION: "Excepción aceptada",
  HIGH: "Alta",
  MEDIUM: "Media",
  LOW: "Baja",
  CRITICAL: "Crítica",
  READY: "Listo",
  READY_FOR_REAL_SAMPLE: "Listo para una muestra real",
  READY_FOR_READONLY_RUNTIME: "Listo para lectura",
  READY_BUT_NOT_ACTIVATED: "Listo, aún no activado",
  HUMAN_ASSISTED_CSV_JSON_XLSX: "Importación asistida XLSX, CSV o JSON",
  RUNNING: "En curso",
  WAIT: "En espera",
  HEALTHY: "Saludable",
  UNKNOWN: "Desconocido",
  STALE: "Evidencia vencida",
  STALE_EVIDENCE: "Evidencia vencida",
  READ_ONLY: "Solo lectura",
  "READ-ONLY": "Solo lectura",
  DRY_RUN_ONLY: "Solo simulación",
  EVIDENCE_GATED: "Limitado por evidencia",
  CURRENT_LIVE_COHORT_SCOPE: "Publicaciones activas canónicas",
  ACCOUNT_TRAFFIC_SCOPE: "Tráfico de la cuenta",
  CRITICAL_OPERATIONAL: "Crítico operativo",
  ACTIONABLE_COMMERCIAL: "Acción comercial",
  RESEARCH_OR_EVIDENCE: "Investigación o evidencia",
  CAPABILITY_BLOCKED: "Capacidad bloqueada",
  HUMAN_REVIEW: "Revisión humana",
  DO_NOT_TOUCH: "No tocar",
  REPLACEMENT_CANDIDATE: "Candidato de reemplazo",
  DATA_QUALITY: "Calidad de datos",
  IDENTITY_UNPROVEN: "Identidad no comprobada",
  OUT_OF_STOCK_CONFIRMED: "Agotado comprobado",
  LOW_STOCK_CONFIRMED: "Stock bajo comprobado",
  SOURCE_CHANGED: "Fuente modificada",
  CONFLICT: "Evidencia en conflicto",
  OVERSELL_RISK: "Riesgo de sobreventa",
  NO_PROVEN_RISK: "Sin riesgo comprobado",
  STOCK_UNKNOWN: "Stock desconocido",
  IN_STOCK_SIGNAL: "Disponibilidad observada",
  OUT_OF_STOCK_SIGNAL: "Señal de agotado",
  SOURCE_FORMAT_CHANGED: "Formato de fuente modificado",
  STOCK_CONFLICTED: "Stock en conflicto",
  EXACT_PROVEN: "Exacto comprobado",
  impressions: "Impresiones",
  ebayViews: "Vistas",
  listingViews: "Vistas",
  ctr: "CTR",
  quantitySold: "Cantidad vendida",
  DUPLICATE_ITEM_ID: "Item ID duplicado",
  DUPLICATE_LIVE_SKU: "SKU duplicado",
  NON_LIVE_EVIDENCE_PRESENT_EXCLUDED: "Evidencia histórica excluida",
  NON_LIVE_ENTITY_IN_LIVE_DENOMINATOR: "Entidad no activa en el denominador",
  MISSING_REGISTRY_RELATIONSHIP: "Relación del registro pendiente",
  COUNT_PARITY_FAILURE: "Diferencia de conteo entre módulos",
  FALSE_ZERO_FROM_UNPROVEN_CAPABILITY: "Cero no respaldado por evidencia",
  CURRENT_LIVE_COHORT_RECONCILIATION: "Coherencia del portafolio activo",
  LIVE_SKU_UNIQUENESS_CHECK: "Unicidad de SKU activos",
  FALSE_ZERO_REPRESENTATION_GUARD: "Protección contra falsos ceros",
  STOCK_EVIDENCE_DEDUPLICATION_GUARD: "Duplicados de evidencia de stock",
  ACCOUNT_TRAFFIC_METADATA_VALIDATION_GUARD: "Metadatos de tráfico",
  ACCOUNT_TRAFFIC_SNAPSHOT_REUSE_GUARD: "Reutilización del snapshot de tráfico",
  REVIEW_BURDEN_AUTHORITY_MISMATCH_GUARD: "Coherencia de revisión humana",
  OPERATIONAL_REVIEW_FALSE_ZERO_GUARD: "Protección del conteo de revisión humana",
})

const CAPABILITY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  qualityReport: "Informe de calidad",
  qualityReportAcquisition: "Importación del informe de calidad",
  orders: "Órdenes",
  lunaCapture: "Captura de Luna Portex",
  stockGuard: "Stock Guard",
  economics: "Economía",
  whatsapp: "WhatsApp",
})

export function presentSellerOsCode(value: string | null | undefined) {
  if (!value) return "No comprobado"
  return HUMAN_LABELS[value] ?? value
    .replaceAll(/([a-záéíóúñ0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLocaleLowerCase("es")
}

export function presentSellerOsStatus(value: string | null | undefined) {
  return presentSellerOsCode(value)
}

export function presentSellerOsCapability(value: string) {
  return CAPABILITY_LABELS[value] ?? value.replaceAll(/([A-Z])/g, " $1").trim()
}

export function sellerOsStatusTone(value: string | null | undefined) {
  if (["AVAILABLE", "COMPLETE", "PASS", "READY", "HEALTHY"].includes(value ?? "")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800"
  }
  if (["PARTIAL_CERTIFIED", "MITIGATED", "MITIGATED_BY_POLICY", "RECONCILED"].includes(value ?? "")) {
    return "border-cyan-200 bg-cyan-50 text-cyan-800"
  }
  if (["CRITICAL", "ERROR", "FAIL", "TRIGGERED", "ACTIVE_VIOLATION"].includes(value ?? "")) {
    return "border-rose-200 bg-rose-50 text-rose-800"
  }
  if (["PARTIAL", "DEGRADED", "UNPROVEN", "HIGH", "DETECTED_RISK"].includes(value ?? "")) {
    return "border-amber-200 bg-amber-50 text-amber-800"
  }
  if (["AUTH_PENDING", "UNAVAILABLE_AUTH_PENDING"].includes(value ?? "")) {
    return "border-violet-200 bg-violet-50 text-violet-800"
  }
  return "border-slate-200 bg-slate-50 text-slate-700"
}

export function sellerOsCapabilityBucket(value: string) {
  if (["AVAILABLE", "COMPLETE", "READY", "PARTIAL_CERTIFIED"].includes(value)) {
    return "AVAILABLE" as const
  }
  if (["UNAVAILABLE", "UNAVAILABLE_AUTH_PENDING", "UNAVAILABLE_NO_CURRENT_REPORT", "MISSING", "ERROR"].includes(value)) {
    return "UNAVAILABLE" as const
  }
  return "LIMITED" as const
}

export function presentSellerOsCapabilitySummary(counts: {
  AVAILABLE: number
  LIMITED: number
  UNAVAILABLE: number
}) {
  const availableLabel = counts.AVAILABLE === 1
    ? "capacidad disponible"
    : "capacidades disponibles"
  const limitedLabel = counts.LIMITED === 1 ? "limitada" : "limitadas"
  const unavailableLabel = counts.UNAVAILABLE === 1
    ? "no disponible"
    : "no disponibles"
  return `${counts.AVAILABLE} ${availableLabel} · ${counts.LIMITED} ${limitedLabel} · ${counts.UNAVAILABLE} ${unavailableLabel}`
}
