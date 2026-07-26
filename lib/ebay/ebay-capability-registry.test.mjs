import assert from "node:assert/strict"
import test from "node:test"

import {
  EBAY_CAPABILITY_IMPLEMENTATION_STATES,
  EBAY_CAPABILITY_REGISTRY,
  calculateEbayCapabilityImplementationPercentages,
  getEbayCapabilityRegistryAdminProjection,
} from "./ebay-capability-registry.ts"

test("every real write declares flags, ledger and reconciliation", () => {
  const writes = EBAY_CAPABILITY_REGISTRY.filter((entry) =>
    entry.access === "WRITE")
  assert.ok(writes.length > 0)
  for (const entry of writes) {
    assert.equal(entry.implementationState, "REAL", entry.id)
    assert.ok(entry.requiredFlags.length > 0, `${entry.id}: flags`)
    assert.ok(entry.ledgers.length > 0, `${entry.id}: ledger`)
    assert.ok(entry.reconciliation.trim().length > 0, `${entry.id}: reconciliation`)
  }
})

test("admin projection is sanitized and declares every implementation state", () => {
  const projection = getEbayCapabilityRegistryAdminProjection(
    "2026-07-26T00:00:00.000Z",
  )
  assert.deepEqual(
    new Set(projection.capabilities.map((entry) => entry.implementationState)),
    new Set(EBAY_CAPABILITY_IMPLEMENTATION_STATES),
  )
  assert.deepEqual(projection.safety, {
    credentialValuesIncluded: false,
    tokenValuesIncluded: false,
    secretValuesIncluded: false,
  })
  const serialized = JSON.stringify(projection)
  assert.doesNotMatch(
    serialized,
    /"(?:access_token|refresh_token|client_secret|authorization_code)"\s*:/i,
  )
  assert.doesNotMatch(serialized, /\bbearer\s+[a-z0-9._~-]+/i)
})

test("implementation percentages use the documented complete denominator", () => {
  const result = calculateEbayCapabilityImplementationPercentages()
  assert.equal(result.denominator, EBAY_CAPABILITY_REGISTRY.length)
  assert.match(result.formula, /count\(status\) \/ total_capabilities \* 100/)
  for (const status of EBAY_CAPABILITY_IMPLEMENTATION_STATES) {
    const expected = Math.round(
      result.counts[status] / result.denominator * 1_000,
    ) / 10
    assert.equal(result.percentages[status], expected, status)
  }
  const totalCount = Object.values(result.counts)
    .reduce((sum, value) => sum + value, 0)
  assert.equal(totalCount, result.denominator)
})
