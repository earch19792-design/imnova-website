import assert from "node:assert/strict"
import test from "node:test"

import { evaluateLunaTraceProductTruthGateV1,
  LUNA_FIELD_TRUTH_RECEIPT_FIELDS_V1,
  LUNA_TRACE_REQUIRED_PRODUCT_TRUTH_FIELDS_V1 } from
  "./luna-trace-product-truth-gate-v1.ts"

const digest = (character) => `sha256:${character.repeat(64)}`
const observedAt = "2026-09-20T19:25:37.539Z"

function field(name, value, overrides = {}) {
  return { FIELD: name, VALUE: value, SEMANTIC_CLASS: "FACT",
    EVIDENCE_STATUS: "PROVEN", SOURCE_AUTHORITY: "SUPPLIER",
    EVIDENCE_ID: digest("b"), SOURCE_EVIDENCE: [{ EVIDENCE_ID: digest("c") }],
    OBSERVED_AT: observedAt, FRESH_UNTIL: null, CONTRADICTION: false,
    ...overrides }
}

function fixture(overrides = {}) {
  const binding = { snapshotId: "5de76d1b-46ad-4516-bb96-57339c412719",
    productId: "9220790976736", variantId: "48809590227168",
    supplierSku: "ITEM6952",
    sourceFingerprint: digest("a"),
    canonicalUrl: "https://lunaportex.com/products/water-filter-kit",
    exactSingleVariantBinding: true, supplierCost: 8,
    supplierAvailability: true, ...overrides.binding }
  const values = { LUNA_PRODUCT_ID: binding.productId,
    LUNA_VARIANT_ID: binding.variantId, SUPPLIER_SKU: binding.supplierSku,
    TITLE: "CFS Replacement Water Filters 7pk For Watts Premier WPRL-58",
    SUPPLIER_COST: 8, SUPPLIER_AVAILABILITY: "AVAILABLE" }
  const productReceipt = `luna_catalog:${binding.snapshotId}:${binding.productId}`
  const variantReceipt = `${productReceipt}:${binding.variantId}`
  const productFields = new Set(["LUNA_PRODUCT_ID", "TITLE"])
  const fields = LUNA_FIELD_TRUTH_RECEIPT_FIELDS_V1.map((name) => {
    if (!LUNA_TRACE_REQUIRED_PRODUCT_TRUTH_FIELDS_V1.includes(name)) {
      return field(name, null, { SEMANTIC_CLASS: "MISSING",
        EVIDENCE_STATUS: "MISSING", EVIDENCE_ID: null, SOURCE_EVIDENCE: [] })
    }
    return field(name, values[name], {
      SOURCE_EVIDENCE: [{ EVIDENCE_ID: digest("c"),
        SOURCE_RECEIPT_ID: productFields.has(name)
          ? productReceipt : variantReceipt }],
      FRESH_UNTIL: ["SUPPLIER_COST", "SUPPLIER_AVAILABILITY"].includes(name)
        ? "2026-09-21T19:25:37.539Z" : null,
    })
  })
  const receipt = { contractVersion: "LUNA_FIELD_PRODUCT_TRUTH_V1",
    sourceAuthorityContract: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
    sourceSnapshotId: binding.snapshotId, sourceProductId: binding.productId,
    sourceVariantId: binding.variantId, sourceSupplierSku: binding.supplierSku,
    sourceCatalogFingerprint: binding.sourceFingerprint,
    evidenceDigest: digest("d"), status: "PARTIAL",
    fields,
    ...overrides.receipt }
  return { binding, receipt }
}

for (const [name, changes] of [
  ["ITEM6952", {}],
  ["ITEM5789", { binding: { productId: "9220805886176",
    variantId: "48809607790816", supplierSku: "ITEM5789", supplierCost: 2.5 },
    receipt: {} }],
]) {
  test(`${name}-style PARTIAL truth is sufficient for Trace`, () => {
    const base = fixture(changes)
    if (name === "ITEM5789") {
      base.receipt.sourceProductId = base.binding.productId
      base.receipt.sourceVariantId = base.binding.variantId
      base.receipt.sourceSupplierSku = base.binding.supplierSku
      for (const entry of base.receipt.fields) {
        if (entry.FIELD === "LUNA_PRODUCT_ID") entry.VALUE = base.binding.productId
        if (entry.FIELD === "LUNA_VARIANT_ID") entry.VALUE = base.binding.variantId
        if (entry.FIELD === "SUPPLIER_SKU") entry.VALUE = base.binding.supplierSku
        if (entry.FIELD === "SUPPLIER_COST") entry.VALUE = base.binding.supplierCost
      }
    }
    const result = evaluateLunaTraceProductTruthGateV1({ ...base,
      now: new Date("2026-09-20T20:00:00Z") })
    assert.equal(result.productTruthStatusPreserved, "PARTIAL")
    assert.equal(result.traceProductTruthSufficient, true)
    assert.equal(result.traceCompatible, true)
  })
}

for (const missing of ["SUPPLIER_COST", "SUPPLIER_AVAILABILITY"]) {
  test(`missing ${missing} rejects Trace entry`, () => {
    const base = fixture()
    base.receipt.fields = base.receipt.fields.filter((entry) =>
      entry.FIELD !== missing)
    const result = evaluateLunaTraceProductTruthGateV1({ ...base,
      now: new Date("2026-09-20T20:00:00Z") })
    assert.equal(result.traceProductTruthSufficient, false)
    assert.ok(result.rejectedFields.includes(missing))
  })
}

test("contradicted required identity rejects Trace entry", () => {
  const base = fixture()
  const identity = base.receipt.fields.find((entry) =>
    entry.FIELD === "LUNA_VARIANT_ID")
  Object.assign(identity, { SEMANTIC_CLASS: "CONTRADICTED",
    EVIDENCE_STATUS: "CONTRADICTED", CONTRADICTION: true })
  assert.equal(evaluateLunaTraceProductTruthGateV1({ ...base,
    now: new Date("2026-09-20T20:00:00Z") })
    .traceProductTruthSufficient, false)
})

test("ambiguous multi-variant binding rejects Trace entry", () => {
  const base = fixture({ binding: { exactSingleVariantBinding: false } })
  assert.equal(evaluateLunaTraceProductTruthGateV1({ ...base,
    now: new Date("2026-09-20T20:00:00Z") })
    .traceProductTruthSufficient, false)
})

test("optional missing field does not reject Trace entry", () => {
  const base = fixture()
  assert.equal(evaluateLunaTraceProductTruthGateV1({ ...base,
    now: new Date("2026-09-20T20:00:00Z") })
    .traceProductTruthSufficient, true)
})

test("stale required commercial evidence is not downstream consumable", () => {
  const base = fixture()
  const cost = base.receipt.fields.find((entry) =>
    entry.FIELD === "SUPPLIER_COST")
  cost.FRESH_UNTIL = "2026-09-20T19:30:00Z"
  const result = evaluateLunaTraceProductTruthGateV1({ ...base,
    now: new Date("2026-09-20T20:00:00Z") })
  assert.equal(result.traceProductTruthSufficient, false)
  assert.ok(result.rejectedFields.includes("SUPPLIER_COST"))
})
