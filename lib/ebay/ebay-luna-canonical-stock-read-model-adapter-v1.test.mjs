import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

import { projectSellerOsCanonicalLunaStockReadModelV1 } from
  "./ebay-luna-canonical-stock-read-model-adapter-v1.ts"

const ITEM_ID = "366569086086"
const LINKAGE_ID = `luna-linkage-v1:sha256:${"a".repeat(64)}`
const NOW = new Date("2026-08-24T01:00:00.000Z")
const MARKETPLACE = { marketplaceId: "EBAY_US", accountAlias: "primary" }
const IDENTITY = { itemId: ITEM_ID, variationKey: null, sku: "IMN-LST-000001" }
const source = readFileSync(new URL(
  "./ebay-luna-canonical-stock-read-model-adapter-v1.ts", import.meta.url,
), "utf8")

function identity(productId, variantId, sku) {
  return `luna-component-identity-v1:sha256:${createHash("sha256")
    .update(JSON.stringify([productId, variantId, sku])).digest("hex")}`
}

function component(productId, variantId, sku, overrides = {}) {
  return { lunaProductId: productId, lunaVariantId: variantId, lunaSku: sku,
    supplierQuantityRequired: 1, exactProductIdentity: true,
    exactVariantIdentity: true, exactSupplierSku: true,
    structuredVariantAttributesComplete: true, identityConflict: false,
    ...overrides }
}

const backpack = component("9220832362720", "48809643409632", "ITEM3752")
const sunglasses = component("9220864704736", "48809680437472", "FL-WF01-BLK")

function decision(components = [backpack, sunglasses], overrides = {}) {
  return { decision_id: "decision-1", decision_version: 1,
    decision: "APPROVE_EXACT_LINKAGE", decision_at: "2026-08-23T23:00:00Z",
    ebay_item_id: ITEM_ID, ebay_sku: "IMN-LST-000001", linkage_id: LINKAGE_ID,
    components, evidence_digest: `sha256:${"b".repeat(64)}`,
    evidence_references: ["WO:1"], ...overrides }
}

function job(overrides = {}) {
  return { stock_check_job_id: `luna-stock-check-v1:sha256:${"c".repeat(64)}`,
    linkage_id: LINKAGE_ID, ebay_item_id: ITEM_ID,
    observation_window_start: "2026-08-24T00:00:00Z",
    observation_window_end: "2026-08-24T01:00:00Z",
    workflow_state: "SUCCEEDED", attempt_count: 1,
    success_receipt_digest: `luna-stock-package-v1:sha256:${"d".repeat(64)}`,
    ...overrides }
}

function observation(componentValue, state, availability, quantity,
  overrides = {}) {
  const componentId = identity(componentValue.lunaProductId,
    componentValue.lunaVariantId, componentValue.lunaSku)
  return { observation_id: `luna-stock-observation-v1:sha256:${
      createHash("sha256").update(componentId).digest("hex")}`,
    stock_check_job_id: job().stock_check_job_id, linkage_id: LINKAGE_ID,
    ebay_item_id: ITEM_ID, component_identity_id: componentId,
    luna_product_id: componentValue.lunaProductId,
    luna_variant_id: componentValue.lunaVariantId,
    luna_sku: componentValue.lunaSku, supplier_quantity_required: 1,
    observation_state: state, source_status: "AVAILABLE",
    observed_availability: availability, observed_supplier_quantity: quantity,
    evidence_class: "SUPPLIER_STATED",
    evidence_digest: `luna-stock-evidence-v1:sha256:${"e".repeat(64)}`,
    acquisition_method: "CANONICAL_SERVER_READ", attempt_number: 1,
    observed_at: "2026-08-24T00:30:00Z", maximum_age_seconds: 21600,
    limitations: ["LUNA_PORTEX_PUBLIC_EXACT_PRODUCT_STOCK",
      "PUBLIC_EXACT_IDENTITY_MATCHED",
      ...(state === "OBSERVED_OUT_OF_STOCK"
        ? ["PUBLIC_EXACT_CERTIFIED_OOS"] : [])], ...overrides }
}

function project(overrides = {}) {
  return projectSellerOsCanonicalLunaStockReadModelV1({ itemId: ITEM_ID,
    marketplace: MARKETPLACE, identity: IDENTITY, now: NOW,
    decisions: { status: "AVAILABLE", rows: [decision()] },
    jobs: { status: "AVAILABLE", rows: [job()] },
    observations: { status: "AVAILABLE", rows: [
      observation(backpack, "OBSERVED_OUT_OF_STOCK", false, null),
      observation(sunglasses, "OBSERVED_IN_STOCK", true, null),
    ] }, ...overrides })
}

test("certified single-product linkage projects as proven", () => {
  const result = project({ decisions: { status: "AVAILABLE",
    rows: [decision([backpack])] }, observations: { status: "AVAILABLE",
    rows: [observation(backpack, "OBSERVED_QUANTITY", true, 5)] } })
  assert.equal(result.supplierLinkageStatus, "CERTIFIED")
  assert.equal(result.stock.supplierProductId, backpack.lunaProductId)
})

test("certified bundle linkage projects as proven", () => {
  const result = project()
  assert.equal(result.supplierLinkageStatus, "CERTIFIED")
  assert.equal(result.composition.status, "AVAILABLE")
  assert.equal(result.composition.components.length, 2)
})

test("mandatory certified OOS component projects safe capacity zero", () => {
  assert.equal(project().composition.bundleCapacity.value, 0)
  assert.equal(project().composition.bundleCapacity.availability, "AVAILABLE")
  assert.equal(project().composition.bundleCapacity.completeness, "COMPLETE")
})

test("mandatory certified OOS component projects listing CERTIFIED_OOS", () => {
  const result = project()
  assert.equal(result.stock.state, "CERTIFIED_OOS")
  assert.equal(result.stock.sourceContractStatus, "HEALTHY")
})

test("in-stock component without numeric quantity does not block bundle zero", () => {
  assert.equal(project().composition.bundleCapacity.value, 0)
})

test("missing certified linkage remains unproven", () => {
  const result = project({ decisions: { status: "AVAILABLE", rows: [] } })
  assert.equal(result.applied, false)
  assert.equal(result.supplierLinkageStatus, "UNPROVEN")
})

test("incomplete composition fails closed to unknown", () => {
  const result = project({ decisions: { status: "AVAILABLE", rows: [
    decision([component("1", "2", "SKU", { exactVariantIdentity: false })]),
  ] } })
  assert.equal(result.applied, false)
  assert.equal(result.supplierLinkageStatus, "UNPROVEN")
  assert.equal(result.stock, null)
  assert.equal(result.limitationCode, "CERTIFIED_LUNA_COMPOSITION_INCOMPLETE")
})

test("stale component evidence fails closed to unknown", () => {
  const stale = "2026-08-22T00:00:00Z"
  const result = project({ observations: { status: "AVAILABLE", rows: [
    observation(backpack, "OBSERVED_OUT_OF_STOCK", false, null,
      { observed_at: stale }),
    observation(sunglasses, "OBSERVED_IN_STOCK", true, null,
      { observed_at: stale }),
  ] } })
  assert.equal(result.stock.state, "STOCK_UNKNOWN")
  assert.equal(result.stock.freshness.status, "STALE")
})

test("component identity mismatch fails closed to unknown", () => {
  const result = project({ observations: { status: "AVAILABLE", rows: [
    observation(backpack, "OBSERVED_OUT_OF_STOCK", false, null,
      { luna_sku: "WRONG" }),
    observation(sunglasses, "OBSERVED_IN_STOCK", true, null),
  ] } })
  assert.equal(result.stock.state, "STOCK_UNKNOWN")
  assert.equal(result.limitationCode,
    "CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH")
})

test("unique complete tuple reconciles a historical component hash", () => {
  const result = project({ observations: { status: "AVAILABLE", rows: [
    observation(backpack, "OBSERVED_QUANTITY", true, 5,
      { component_identity_id: `luna-component-identity-v1:sha256:${"1".repeat(64)}` }),
    observation(sunglasses, "OBSERVED_QUANTITY", true, 4),
  ] } })
  assert.equal(result.stock.state, "IN_STOCK_SIGNAL")
  assert.equal(result.limitationCode, null)
})

test("multiple complete tuple matches remain identity mismatch", () => {
  const duplicate = observation(backpack, "OBSERVED_QUANTITY", true, 5,
    { component_identity_id: `luna-component-identity-v1:sha256:${"2".repeat(64)}`,
      observation_id: `luna-stock-observation-v1:sha256:${"3".repeat(64)}` })
  const result = project({ observations: { status: "AVAILABLE", rows: [
    observation(backpack, "OBSERVED_QUANTITY", true, 5,
      { component_identity_id: `luna-component-identity-v1:sha256:${"1".repeat(64)}` }),
    duplicate,
    observation(sunglasses, "OBSERVED_QUANTITY", true, 4),
  ] } })
  assert.equal(result.stock.state, "STOCK_UNKNOWN")
  assert.equal(result.limitationCode,
    "CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH")
})

test("public source unavailable never becomes OOS", () => {
  const result = project({ observations: { status: "AVAILABLE", rows: [
    observation(backpack, "SOURCE_UNAVAILABLE", null, null,
      { source_status: "UNAVAILABLE" }),
    observation(sunglasses, "OBSERVED_IN_STOCK", true, null),
  ] } })
  assert.equal(result.stock.state, "STOCK_UNKNOWN")
  assert.notEqual(result.stock.state, "CERTIFIED_OOS")
  assert.equal(result.limitationCode,
    "CERTIFIED_COMPONENT_STOCK_SOURCE_UNAVAILABLE")
})

test("certified persisted evidence is applicable before any legacy source", () => {
  const result = project()
  assert.equal(result.applied, true)
  assert.equal(result.stock.state, "CERTIFIED_OOS")
})

test("bundle component identities are not flattened into a singular supplier", () => {
  const result = project()
  assert.equal(result.stock.supplierProductId, null)
  assert.equal(result.stock.supplierVariantId, null)
  assert.equal(result.stock.supplierSku, null)
  assert.equal(result.composition.components.length, 2)
})

test("projected linkage is countable without a fake singular supplier identity", () => {
  const result = project()
  assert.equal(result.stock.supplierLinkageStatus, "CERTIFIED")
  assert.equal(result.stock.supplierProductId, null)
})

test("adapter performs no persistence writes", () => {
  assert.doesNotMatch(source, /\.(?:insert|upsert|delete|rpc)\(/)
  assert.doesNotMatch(source, /\.from\([^)]*\)[\s\S]{0,120}\.update\(/)
})

test("adapter performs no marketplace or Luna writes", () => {
  assert.doesNotMatch(source, /ReviseItem|EndItem|sendWhatsApp|marketplaceWrites:\s*[1-9]/)
})

test("non-target listings retain fallback semantics", () => {
  const result = project({ itemId: "366574069492" })
  assert.equal(result.applied, false)
  assert.equal(result.limitationCode, "LUNA_HUMAN_APPROVED_LINK_REQUIRED")
})
