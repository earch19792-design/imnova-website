import assert from "node:assert/strict"
import test from "node:test"

import { calculateLunaSupplierRotationWindows } from "./luna-inventory-rotation-domain.ts"

test("stock reduction remains estimated supplier movement, never a sale", () => {
  const result = calculateLunaSupplierRotationWindows([
    { observedAt: "2026-07-24T00:00:00.000Z", inventoryQuantity: 10,
      available: true, supplierCost: 8, inventorySource: "luna_numeric" },
    { observedAt: "2026-07-25T00:00:00.000Z", inventoryQuantity: 7,
      available: true, supplierCost: 8, inventorySource: "luna_numeric" },
  ], new Date("2026-07-26T00:00:00.000Z"))[0]
  assert.equal(result.evidenceClass, "SUPPLIER_STOCK_MOVEMENT_ESTIMATED")
  assert.equal(result.estimatedUnitsOut, 3)
  assert.equal("sales" in result, false)
  assert.ok(result.confidenceScore < 100)
})

test("availability-only observations cannot invent numeric rotation", () => {
  const result = calculateLunaSupplierRotationWindows([
    { observedAt: "2026-07-25T00:00:00.000Z", inventoryQuantity: null,
      available: true, supplierCost: 8, inventorySource: "luna_availability" },
  ], new Date("2026-07-26T00:00:00.000Z"))[0]
  assert.equal(result.evidenceClass, "AVAILABILITY_ONLY")
  assert.equal(result.numericObservationCount, 0)
  assert.equal(result.estimatedUnitsOut, 0)
})
