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

export type SellerOsOperationalState =
  | "LOADING"
  | "AVAILABLE"
  | "NO_RUN"
  | "SOURCE_UNAVAILABLE"
  | "ACCOUNT_SCOPE_MISMATCH"

export type SellerOsOperationSource =
  | "ebay_listing_factory_run_metrics_v1"
  | "ebay_same_day_pilot_runs"

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
  operationalState: SellerOsOperationalState
  source: SellerOsOperationSource
  consultedAt: string | null
  message: string
  batch: SellerOsBatchActivity | null
  openQuarantineCount: SellerOsMetric<number>
  openCircuitCount: SellerOsMetric<number>
}

const SOURCE = "ebay_listing_factory_run_metrics_v1"
const SAME_DAY_SOURCE = "ebay_same_day_pilot_runs"

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
  source: SellerOsOperationSource = SOURCE,
): SellerOsMetric<T> {
  return {
    availability: "AVAILABLE",
    value,
    source,
    observedAt,
  }
}

function unavailableMetric<T>(
  source: SellerOsOperationSource = SOURCE,
): SellerOsMetric<T> {
  return {
    availability: "UNAVAILABLE",
    value: null,
    source,
    observedAt: null,
  }
}

function numericMetric(
  value: unknown,
  observedAt: string | null,
  source: SellerOsOperationSource = SOURCE,
): SellerOsMetric<number> {
  const parsed = number(value)
  return parsed == null
    ? unavailableMetric<number>(source)
    : availableMetric(parsed, observedAt, source)
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
    operationalState: "LOADING",
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
    operationalState: "SOURCE_UNAVAILABLE",
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
  const sameDay = row(root.operationalActivity)
  const sameDayState = text(sameDay?.status)?.toUpperCase() ?? null
  const sameDayRun = sameDayState === "AVAILABLE"
    ? row(sameDay?.run)
    : null
  const runRows = factory ? rows(factory.runs) : null
  const quarantineRows = factory ? rows(factory.quarantine) : null
  const circuitRows = factory ? rows(factory.circuits) : null
  const factoryPartial = !factory || factory.migrationReady === false ||
    Boolean(factory.error) ||
    runRows == null || quarantineRows == null || circuitRows == null
  const availableRuns = runRows ?? []
  const latestFactoryRun = availableRuns.find((candidate) =>
    !isTerminalRun(text(candidate.status)?.toUpperCase() ?? "")
  ) ?? availableRuns[0] ?? null
  const usingSameDay = !latestFactoryRun && Boolean(sameDayRun)
  const latestRun = latestFactoryRun ?? sameDayRun
  const source: SellerOsOperationSource = usingSameDay
    ? SAME_DAY_SOURCE
    : SOURCE
  const partial = usingSameDay
    ? factoryPartial && Boolean(factory?.error)
    : factoryPartial || sameDayState === "SOURCE_UNAVAILABLE"

  const openQuarantineCount = usingSameDay
    ? numericMetric(sameDayRun?.products_quarantined, consultedAt, source)
    : quarantineRows == null
      ? unavailableMetric<number>()
      : availableMetric(quarantineRows.length, consultedAt)
  const openCircuitCount = circuitRows == null
    ? unavailableMetric<number>()
    : availableMetric(circuitRows.length, consultedAt)

  if (!latestRun) {
    const operationalState: SellerOsOperationalState =
      sameDayState === "ACCOUNT_SCOPE_MISMATCH"
        ? "ACCOUNT_SCOPE_MISMATCH"
        : sameDayState === "SOURCE_UNAVAILABLE" || (!factory && !sameDay)
          ? "SOURCE_UNAVAILABLE"
          : "NO_RUN"
    return {
      availability: operationalState === "ACCOUNT_SCOPE_MISMATCH" ||
          operationalState === "SOURCE_UNAVAILABLE"
        ? "UNAVAILABLE"
        : partial ? "PARTIAL" : "AVAILABLE",
      operationalState,
      source,
      consultedAt,
      message: operationalState === "ACCOUNT_SCOPE_MISMATCH"
        ? "La cuenta configurada no coincide con el alcance operativo de Seller OS."
        : operationalState === "SOURCE_UNAVAILABLE"
          ? "La fuente durable del lote no está disponible."
          : partial
            ? "La consulta fue parcial y confirmó que no hay un lote disponible."
            : "No existe un lote operativo para esta cuenta.",
      batch: null,
      openQuarantineCount,
      openCircuitCount,
    }
  }

  const runId = text(latestRun.run_id)
  const durableStatus = text(latestRun.status)?.toUpperCase() ?? "UNKNOWN"
  const operationDate = text(latestRun.operation_date)
  const observedAt = text(latestRun.observed_at) ?? operationDate
  const batchQuarantineCount = numericMetric(
    latestRun.products_quarantined,
    observedAt,
    source,
  )

  return {
    availability: partial ? "PARTIAL" : "AVAILABLE",
    operationalState: "AVAILABLE",
    source,
    consultedAt,
    message: usingSameDay
      ? factory?.error
        ? "Lote confirmado por Same-Day; la proyección Listing Factory no está disponible."
        : "Lote confirmado por Same-Day; Listing Factory todavía no publicó su proyección."
      : partial
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
          selectedCount: numericMetric(latestRun.products_selected, observedAt, source),
          completedCount: numericMetric(latestRun.products_completed, observedAt, source),
          holdCount: numericMetric(latestRun.products_on_hold, observedAt, source),
          quarantineCount: batchQuarantineCount,
          currentProduct: unavailableMetric(source),
          currentPhase: unavailableMetric(source),
          pendingHumanDecisions: numericMetric(
            latestRun.pending_human_decisions,
            observedAt,
            source,
          ),
          lastHeartbeatAt: unavailableMetric(source),
          lastConfirmedSuccessAt: text(
              latestRun.factory_last_success_at ||
                latestRun.last_confirmed_success_at,
            )
            ? availableMetric(text(
                latestRun.factory_last_success_at ||
                  latestRun.last_confirmed_success_at,
              )!, observedAt, source)
            : unavailableMetric(source),
        }
      : null,
    openQuarantineCount,
    openCircuitCount,
  }
}
