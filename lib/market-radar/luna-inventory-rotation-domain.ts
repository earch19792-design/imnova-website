export const LUNA_SUPPLIER_ROTATION_POLICY_VERSION =
  "LUNA_SUPPLIER_ROTATION_V1_2026_07_26"

export type LunaSupplierMovementClass =
  | "SUPPLIER_STOCK_MOVEMENT_CONFIRMED"
  | "SUPPLIER_STOCK_MOVEMENT_ESTIMATED"
  | "RESTOCK_CONFIRMED"
  | "AVAILABILITY_ONLY"
  | "UNKNOWN"

export type LunaInventoryObservation = {
  observedAt: string
  inventoryQuantity: number | null
  available: boolean | null
  supplierCost: number | null
  compareAtPrice?: number | null
  inventorySource?: string | null
  restockConfirmed?: boolean
  stockMovementConfirmed?: boolean
}

export type LunaSupplierRotationWindow = {
  windowDays: 7 | 30 | 90
  observationCount: number
  numericObservationCount: number
  initialInventory: number | null
  finalInventory: number | null
  reductionEventCount: number
  estimatedUnitsOut: number
  observedIncreaseCount: number
  observedIncreaseUnits: number
  confirmedRestockCount: number
  daysWithStock: number
  daysOutOfStock: number
  inventoryVolatility: number | null
  availabilityStability: number | null
  supplierCostChangeCount: number
  discountDependency: number | null
  freshestObservationAt: string | null
  freshnessHours: number | null
  evidenceClass: LunaSupplierMovementClass
  confidenceScore: number
  supplierRotationScore: number
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.sqrt(values.reduce(
    (sum, value) => sum + ((value - mean) ** 2),
    0,
  ) / values.length)
}

export function calculateLunaSupplierRotationWindows(
  observations: LunaInventoryObservation[],
  now = new Date(),
) {
  const ordered = observations
    .filter(observation => Number.isFinite(Date.parse(observation.observedAt)))
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt))
  return ([7, 30, 90] as const).map(windowDays => {
    const cutoff = now.getTime() - windowDays * 86_400_000
    const window = ordered.filter(observation => {
      const observedAt = Date.parse(observation.observedAt)
      return observedAt >= cutoff && observedAt <= now.getTime()
    })
    const numeric = window.filter(
      observation => finiteNumber(observation.inventoryQuantity) !== null,
    )
    let reductionEventCount = 0
    let estimatedUnitsOut = 0
    let observedIncreaseCount = 0
    let observedIncreaseUnits = 0
    let confirmedRestockCount = 0
    let confirmedMovementCount = 0
    let supplierCostChangeCount = 0
    for (let index = 1; index < window.length; index += 1) {
      const previous = window[index - 1]
      const current = window[index]
      const previousQuantity = finiteNumber(previous.inventoryQuantity)
      const currentQuantity = finiteNumber(current.inventoryQuantity)
      if (previousQuantity !== null && currentQuantity !== null) {
        const delta = currentQuantity - previousQuantity
        if (delta < 0) {
          reductionEventCount += 1
          estimatedUnitsOut += Math.abs(delta)
          if (current.stockMovementConfirmed) confirmedMovementCount += 1
        } else if (delta > 0) {
          observedIncreaseCount += 1
          observedIncreaseUnits += delta
          if (current.restockConfirmed) confirmedRestockCount += 1
        }
      }
      const previousCost = finiteNumber(previous.supplierCost)
      const currentCost = finiteNumber(current.supplierCost)
      if (previousCost !== null && currentCost !== null && previousCost !== currentCost) {
        supplierCostChangeCount += 1
      }
    }
    const dayStates = new Map<string, boolean>()
    for (const observation of window) {
      const observedAt = Date.parse(observation.observedAt)
      if (!Number.isFinite(observedAt)) continue
      const day = new Date(observedAt).toISOString().slice(0, 10)
      const quantity = finiteNumber(observation.inventoryQuantity)
      dayStates.set(day, quantity !== null ? quantity > 0 : observation.available === true)
    }
    const daysWithStock = [...dayStates.values()].filter(Boolean).length
    const daysOutOfStock = [...dayStates.values()].filter(value => !value).length
    const numericValues = numeric
      .map(observation => finiteNumber(observation.inventoryQuantity))
      .filter((value): value is number => value !== null)
    const freshestObservationAt = window.at(-1)?.observedAt ?? null
    const freshnessHours = freshestObservationAt
      ? Math.max(0, (now.getTime() - Date.parse(freshestObservationAt)) / 3_600_000)
      : null
    const evidenceClass: LunaSupplierMovementClass = confirmedMovementCount > 0
      ? "SUPPLIER_STOCK_MOVEMENT_CONFIRMED"
      : confirmedRestockCount > 0
        ? "RESTOCK_CONFIRMED"
        : reductionEventCount > 0 || observedIncreaseCount > 0
          ? "SUPPLIER_STOCK_MOVEMENT_ESTIMATED"
          : window.some(observation => observation.available !== null)
            ? "AVAILABILITY_ONLY"
            : "UNKNOWN"
    const confidenceScore = Math.min(
      100,
      Math.min(55, numeric.length * 4) +
      Math.min(20, Math.max(0, reductionEventCount + observedIncreaseCount - 1) * 5) +
      (freshnessHours !== null && freshnessHours <= 36 ? 20
        : freshnessHours !== null && freshnessHours <= 168 ? 8 : 0) +
      (window.some(observation => [
        "luna_numeric",
        "luna_authenticated_html",
      ].includes(observation.inventorySource ?? "")) ? 5 : 0),
    )
    const availabilityStability = dayStates.size
      ? Number((Math.max(daysWithStock, daysOutOfStock) / dayStates.size).toFixed(4))
      : null
    const movementScore = Math.min(35, reductionEventCount * 6 + observedIncreaseCount * 3)
    const stockCoverageScore = dayStates.size
      ? Math.round((daysWithStock / dayStates.size) * 30)
      : 0
    const stabilityScore = availabilityStability === null
      ? 0
      : Math.round(availabilityStability * 20)
    const supplierRotationScore = Math.max(0, Math.min(100, Math.round(
      (movementScore + stockCoverageScore + stabilityScore -
        Math.min(20, supplierCostChangeCount * 4)) * (confidenceScore / 100),
    )))
    const discountedCount = window.filter(observation => {
      const cost = finiteNumber(observation.supplierCost)
      const compareAt = finiteNumber(observation.compareAtPrice)
      return cost !== null && compareAt !== null && compareAt > cost
    }).length
    return {
      windowDays,
      observationCount: window.length,
      numericObservationCount: numeric.length,
      initialInventory: numericValues.at(0) ?? null,
      finalInventory: numericValues.at(-1) ?? null,
      reductionEventCount,
      estimatedUnitsOut,
      observedIncreaseCount,
      observedIncreaseUnits,
      confirmedRestockCount,
      daysWithStock,
      daysOutOfStock,
      inventoryVolatility: standardDeviation(numericValues),
      availabilityStability,
      supplierCostChangeCount,
      discountDependency: window.length
        ? Number((discountedCount / window.length).toFixed(4))
        : null,
      freshestObservationAt,
      freshnessHours: freshnessHours === null ? null : Number(freshnessHours.toFixed(2)),
      evidenceClass,
      confidenceScore,
      supplierRotationScore,
    } satisfies LunaSupplierRotationWindow
  })
}
