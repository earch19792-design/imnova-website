export type SellerOsAvailability =
  | "LOADING"
  | "AVAILABLE"
  | "PARTIAL"
  | "UNAVAILABLE"
  | "ERROR"

export type SellerOsFreshness = "FRESH" | "STALE" | "UNKNOWN"

export type SellerOsVisualState =
  | "NOT_STARTED"
  | "QUEUED"
  | "WORKING"
  | "WAITING_DEPENDENCY"
  | "WAITING_HUMAN"
  | "RETRYING"
  | "QUARANTINED"
  | "SAFETY_BLOCKED"
  | "READY_TO_PUBLISH"
  | "PUBLISHED_MONITORED"
  | "COMPLETED"
  | "PARTIAL"

export type SellerOsStatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"

export type SellerOsStatusPresentation = {
  label: string
  description: string
  tone: SellerOsStatusTone
}

const PRESENTATIONS: Record<SellerOsVisualState, SellerOsStatusPresentation> = {
  NOT_STARTED: {
    label: "No iniciado",
    description: "Seller OS todavía no creó trabajo durable para este recorrido.",
    tone: "neutral",
  },
  QUEUED: {
    label: "En cola",
    description: "El trabajo está preservado, pero no hay ejecución viva confirmada.",
    tone: "info",
  },
  WORKING: {
    label: "Trabajando",
    description: "Existe una ejecución durable y vigente.",
    tone: "info",
  },
  WAITING_DEPENDENCY: {
    label: "Esperando dependencia",
    description: "El checkpoint está preservado hasta que la dependencia se recupere.",
    tone: "warning",
  },
  WAITING_HUMAN: {
    label: "Esperando tu decisión",
    description: "Seller OS necesita una decisión humana concreta para continuar.",
    tone: "warning",
  },
  RETRYING: {
    label: "Reintentando",
    description: "Un error conocido se reintentará con una política controlada.",
    tone: "warning",
  },
  QUARANTINED: {
    label: "En cuarentena",
    description: "El producto quedó aislado y su evidencia fue preservada.",
    tone: "danger",
  },
  SAFETY_BLOCKED: {
    label: "Bloqueado por seguridad",
    description: "Una compuerta impide avanzar hasta resolver el riesgo.",
    tone: "danger",
  },
  READY_TO_PUBLISH: {
    label: "Listo para publicar",
    description: "El paquete está preparado y requiere autorización humana.",
    tone: "success",
  },
  PUBLISHED_MONITORED: {
    label: "Publicado y monitoreado",
    description: "El listing fue verificado y está bajo monitoreo comercial.",
    tone: "success",
  },
  COMPLETED: {
    label: "Completado",
    description: "Las fases obligatorias de esta ejecución terminaron.",
    tone: "success",
  },
  PARTIAL: {
    label: "Información parcial",
    description: "Hay datos útiles, pero falta una parte de la lectura operativa.",
    tone: "warning",
  },
}

function normalizedState(value: unknown) {
  return typeof value === "string"
    ? value.trim().toUpperCase()
    : ""
}

export function getSellerOsStatusPresentation(
  state: SellerOsVisualState,
): SellerOsStatusPresentation {
  return PRESENTATIONS[state]
}

export function deriveSellerOsVisualState(input: {
  durableState?: unknown
  activeExecutionConfirmed?: boolean
  hasOpenHumanDecision?: boolean
  quarantineCount?: number | null
}): SellerOsVisualState {
  const state = normalizedState(input.durableState)

  if (
    state.includes("QUARANTIN") ||
    (input.quarantineCount != null && input.quarantineCount > 0 &&
      state === "COMPLETED_WITH_QUARANTINE")
  ) return "QUARANTINED"

  if (input.hasOpenHumanDecision === true ||
    state.includes("WAITING_HUMAN") ||
    state.includes("WAITING_OPERATOR") ||
    state.includes("APPROVAL_REQUIRED") ||
    state.includes("READY_FOR_OPERATOR")) {
    return "WAITING_HUMAN"
  }

  if (
    state.includes("WAITING_EXTERNAL") ||
    state.includes("WAITING_DEPENDENCY") ||
    state.includes("PAUSED_BY_GLOBAL_DEPENDENCY") ||
    state.includes("PAUSED_EBAY")
  ) return "WAITING_DEPENDENCY"

  if (state.includes("RETRY")) return "RETRYING"

  if (
    state.includes("HOLD") ||
    state.includes("BLOCKED") ||
    state.includes("REJECTED") ||
    state === "CANCELLED"
  ) return "SAFETY_BLOCKED"

  if (
    state.includes("COMMERCIAL_MONITORING") ||
    state.includes("POST_PUBLISH_VERIFIED") ||
    state.includes("MONITOR_REGISTERED") ||
    state.includes("VERIFIED_ACTIVE")
  ) return "PUBLISHED_MONITORED"

  if (
    state.includes("READY_TO_PUBLISH") ||
    state.includes("READY_FOR_MANUAL_PUBLICATION") ||
    state.includes("APPROVED_TO_PUBLISH")
  ) return "READY_TO_PUBLISH"

  if (
    state === "COMPLETED" ||
    state === "COMPLETED_WITH_HOLDS" ||
    state === "PARTIAL_SUCCESS"
  ) return state === "PARTIAL_SUCCESS" ? "PARTIAL" : "COMPLETED"

  if (state === "NOT_STARTED" || !state) return "NOT_STARTED"

  if (input.activeExecutionConfirmed === true) return "WORKING"

  return "QUEUED"
}

function validTimestamp(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "")
  return Number.isFinite(parsed) ? parsed : null
}

export function shouldAnimateSellerOsState(input: {
  visualState: SellerOsVisualState
  heartbeatAt?: string | null
  leaseExpiresAt?: string | null
  now?: Date
  heartbeatMaximumAgeMs?: number
  documentVisible?: boolean
  prefersReducedMotion?: boolean
}) {
  if (
    input.visualState !== "WORKING" ||
    input.documentVisible !== true ||
    input.prefersReducedMotion === true
  ) return false

  const nowMs = (input.now ?? new Date()).getTime()
  const heartbeatAt = validTimestamp(input.heartbeatAt)
  const leaseExpiresAt = validTimestamp(input.leaseExpiresAt)
  const heartbeatMaximumAgeMs = input.heartbeatMaximumAgeMs ?? 3 * 60_000

  return heartbeatAt != null &&
    heartbeatAt <= nowMs + 30_000 &&
    nowMs - heartbeatAt <= heartbeatMaximumAgeMs &&
    leaseExpiresAt != null &&
    leaseExpiresAt > nowMs
}
