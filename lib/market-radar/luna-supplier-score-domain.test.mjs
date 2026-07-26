import assert from "node:assert/strict"
import test from "node:test"

import { calculateLunaSupplierScores } from "./luna-supplier-score-domain.ts"

test("unknown supply facts earn no neutral positive points", () => {
  const result = calculateLunaSupplierScores({
    inventoryQuantity: null, available: null, supplierCost: null,
    observedAt: null, exactVariantIdentity: false, inventorySource: null,
    rotation: null, now: new Date("2026-07-26T00:00:00.000Z"),
  })
  assert.equal(result.supplierReadinessScore, 0)
  assert.equal(result.supplierRotationScore, 0)
  assert.equal(result.confidenceScore, 0)
  assert.equal(result.hardGatePassed, false)
})
