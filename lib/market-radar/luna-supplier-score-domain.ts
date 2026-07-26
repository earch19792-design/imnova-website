import type { LunaSupplierRotationWindow } from "./luna-inventory-rotation-domain"

export const LUNA_SUPPLIER_SCORE_POLICY_VERSION =
  "LUNA_SUPPLIER_SCORE_V1_2026_07_26"

export function calculateLunaSupplierScores(input: {
  inventoryQuantity: number | null
  available: boolean | null
  supplierCost: number | null
  observedAt: string | null
  exactVariantIdentity: boolean
  inventorySource: string | null
  rotation: LunaSupplierRotationWindow | null
  now?: Date
}) {
  const now = input.now ?? new Date()
  const observedMs = input.observedAt ? Date.parse(input.observedAt) : Number.NaN
  const freshnessHours = Number.isFinite(observedMs)
    ? Math.max(0, (now.getTime() - observedMs) / 3_600_000)
    : null
  const numericInventory = input.inventoryQuantity !== null &&
    Number.isFinite(input.inventoryQuantity)
  const fresh = freshnessHours !== null && freshnessHours <= 36
  const exactNumericSource = [
    "luna_numeric",
    "luna_authenticated_html",
  ].includes(input.inventorySource ?? "")
  const blockers = [
    ...(input.exactVariantIdentity ? [] : ["LUNA_VARIANT_IDENTITY_REQUIRED"]),
    ...(Number.isFinite(input.supplierCost) && (input.supplierCost ?? 0) > 0
      ? []
      : ["LUNA_COST_REQUIRED"]),
    ...(numericInventory ? [] : ["LUNA_NUMERIC_STOCK_REQUIRED"]),
    ...(input.available === true && (input.inventoryQuantity ?? 0) > 0
      ? []
      : ["LUNA_STOCK_UNAVAILABLE"]),
    ...(fresh ? [] : ["LUNA_SUPPLY_EVIDENCE_STALE"]),
  ]
  return {
    policyVersion: LUNA_SUPPLIER_SCORE_POLICY_VERSION,
    supplierReadinessScore: Math.min(100,
      (input.exactVariantIdentity ? 25 : 0) +
      (Number.isFinite(input.supplierCost) && (input.supplierCost ?? 0) > 0 ? 20 : 0) +
      (numericInventory ? 20 : 0) +
      (input.available === true && (input.inventoryQuantity ?? 0) > 0 ? 15 : 0) +
      (fresh ? 15 : 0) +
      (exactNumericSource ? 5 : 0),
    ),
    supplierRotationScore: input.rotation?.supplierRotationScore ?? 0,
    riskScore: Math.min(100,
      (input.available === false || input.inventoryQuantity === 0 ? 60 : 0) +
      (!fresh ? 20 : 0) +
      (!numericInventory ? 15 : 0) +
      Math.min(20, (input.rotation?.supplierCostChangeCount ?? 0) * 4),
    ),
    confidenceScore: Math.min(100,
      (input.exactVariantIdentity ? 25 : 0) +
      (exactNumericSource ? 25 : 0) +
      (fresh ? 25 : 0) +
      Math.round((input.rotation?.confidenceScore ?? 0) * 0.25),
    ),
    hardGatePassed: blockers.length === 0,
    blockers,
    freshnessHours: freshnessHours === null ? null : Number(freshnessHours.toFixed(2)),
    unknownInputsEarnedPositivePoints: false,
  }
}
