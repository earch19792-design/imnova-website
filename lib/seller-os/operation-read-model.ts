import {
  deriveSellerOsVisualState,
  type SellerOsAvailability,
  type SellerOsVisualState,
} from "./status-presentation"

type Row = Record<string, unknown>

export type SellerOsMetric<T> = {
  availability: "AVAILABLE" | "UNAVAILABLE"
  value: T | null
  source: string
  observedAt: string | null
}

export type SellerOsBatchActivity = {
  runId: string
  operationDate: string | null
  durableStatus: string
  visualState: SellerOsVisualState
  activeExecutionConfirmed: false
  targetSlots: 5
  selectedCount: SellerOsMetric<number>
  completedCount: SellerOsMetric<number>
  holdCount: SellerOsMetric<number>
  quarantineCount: SellerOsMetric<number>
  currentProduct: SellerOsMetric<{ id: string; title: string; sku: string }>
  currentPhase: SellerOsMetric<string>
  pendingHumanDecisions: SellerOsMetric<number>
  lastHeartbeatAt: SellerOsMetric<string>
  lastConfirmedSuccessAt: SellerOsMetric<string>
}

export type SellerOsOperationReadModel = {
  availability: SellerOsAvailability
  source: "ebay_listing_factory_run_metrics_v1"
  consultedAt: string | null
  message: string
  batch: SellerOsBatchActivity | null
  openQuarantineCount: SellerOsMetric<number>
  openCircuitCount: SellerOsMetric<number>
}

const SOURCE = "ebay_listing_factory_run_metrics_v1"

function row(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : null
}

function rows(value: unknown): Row[] | null {
  return Array.isArray(value)
    ? value.filter((item): item is Row => Boolean(row(item)))
    : null
}

function text(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null
}

function number(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function availableMetric<T>(
  value: T,
  observedAt: string | null,
): SellerOsMetric<T> {
  return {
    availability: "AVAILABLE",
    value,
    source: SOURCE,
    observedAt,
  }
}

function unavailableMetric<T>(): SellerOsMetric<T> {
  return {
    availability: "UNAVAILABLE",
    value: null,
    source: SOURCE,
    observedAt: null,
  }
}

function numericMetric(
  value: unknown,
  observedAt: string | null,
): SellerOsMetric<number> {
  const parsed = number(value)
  return parsed == null
    ? unavailableMetric<number>()
    : availableMetric(parsed, observedAt)
}

function isTerminalRun(status: string) {
  return [
    "COMPLETED",
    "COMPLETED_WITH_HOLDS",
    "COMPLETED_WITH_QUARANTINE",
    "PARTIAL_SUCCESS",
    "CANCELLED",
  ].includes(status)
}

export function loadingSellerOsOperationReadModel(): SellerOsOperationReadModel {
  return {
    availability: "LOADING",
    source: SOURCE,
    consultedAt: null,
    message: "Consultando actividad durable de Seller OS.",
    batch: null,
    openQuarantineCount: unavailableMetric<number>(),
    openCircuitCount: unavailableMetric<number>(),
  }
}

export function errorSellerOsOperationReadModel(
  message = "No fue posible consultar la actividad de Seller OS.",
): SellerOsOperationReadModel {
  return {
    availability: "ERROR",
    source: SOURCE,
    consultedAt: null,
    message,
    batch: null,
    openQuarantineCount: unavailableMetric<number>(),
    openCircuitCount: unavailableMetric<number>(),
  }
}

export function buildSellerOsOperationReadModel(
  payload: unknown,
  consultedAt = new Date().toISOString(),
): SellerOsOperationReadModel {
  const root = row(payload)
  if (!root) {
    return {
      ...errorSellerOsOperationReadModel("La respuesta operativa no tiene un formato válido."),
      availability: "UNAVAILABLE",
      consultedAt,
    }
  }

  if (root.success === false) {
    return {
      ...errorSellerOsOperationReadModel("Seller OS rechazó la consulta operativa."),
      consultedAt,
    }
  }

  const factory = row(root.resilientFactory)
  if (!factory) {
    return {
      ...errorSellerOsOperationReadModel("La fuente de actividad no está disponible."),
      availability: "UNAVAILABLE",
      consultedAt,
    }
  }

  const runRows = rows(factory.runs)
  const quarantineRows = rows(factory.quarantine)
  const circuitRows = rows(factory.circuits)
  const partial = factory.migrationReady === false || Boolean(factory.error) ||
    runRows == null || quarantineRows == null || circuitRows == null
  const availableRuns = runRows ?? []
  const latestRun = availableRuns.find((candidate) =>
    !isTerminalRun(text(candidate.status)?.toUpperCase() ?? "")
  ) ?? availableRuns[0] ?? null

  const openQuarantineCount = quarantineRows == null
    ? unavailableMetric<number>()
    : availableMetric(quarantineRows.length, consultedAt)
  const openCircuitCount = circuitRows == null
    ? unavailableMetric<number>()
    : availableMetric(circuitRows.length, consultedAt)

  if (!latestRun) {
    return {
      availability: partial ? "PARTIAL" : "AVAILABLE",
      source: SOURCE,
      consultedAt,
      message: partial
        ? "La consulta fue parcial y no confirmó un lote."
        : "No existe un lote registrado en esta fuente.",
      batch: null,
      openQuarantineCount,
      openCircuitCount,
    }
  }

  const runId = text(latestRun.run_id)
  const durableStatus = text(latestRun.status)?.toUpperCase() ?? "UNKNOWN"
  const operationDate = text(latestRun.operation_date)
  const batchQuarantineCount = numericMetric(
    latestRun.products_quarantined,
    operationDate,
  )

  return {
    availability: partial ? "PARTIAL" : "AVAILABLE",
    source: SOURCE,
    consultedAt,
    message: partial
      ? "La actividad está disponible parcialmente."
      : "Actividad agregada consultada correctamente.",
    batch: runId
      ? {
          runId,
          operationDate,
          durableStatus,
          visualState: deriveSellerOsVisualState({
            durableState: durableStatus,
            activeExecutionConfirmed: false,
            quarantineCount: batchQuarantineCount.value,
          }),
          activeExecutionConfirmed: false,
          targetSlots: 5,
          selectedCount: numericMetric(latestRun.products_selected, operationDate),
          completedCount: numericMetric(latestRun.products_completed, operationDate),
          holdCount: numericMetric(latestRun.products_on_hold, operationDate),
          quarantineCount: batchQuarantineCount,
          currentProduct: unavailableMetric(),
          currentPhase: unavailableMetric(),
          pendingHumanDecisions: unavailableMetric(),
          lastHeartbeatAt: unavailableMetric(),
          lastConfirmedSuccessAt: text(latestRun.factory_last_success_at)
            ? availableMetric(text(latestRun.factory_last_success_at)!, operationDate)
            : unavailableMetric(),
        }
      : null,
    openQuarantineCount,
    openCircuitCount,
  }
}
