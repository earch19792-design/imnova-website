import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  if (String(specifier).startsWith(".") && !/\.(?:ts|mjs|js)$/.test(specifier)) {
    try { return nextResolve(`${specifier}.ts`, context) } catch { /* continue */ }
  }
  return nextResolve(specifier, context)
} })

const { evaluateStockguardOosTriggerV1,
  stockguardOosActionFromOfficialQuantityV1,
  classifyStockguardOosReadbackV1,
  projectStockguardOosProtectionStatusV1 } = await import(
  "./stockguard-oos-quantity-protection-v1.ts")

const now = new Date("2026-09-24T21:00:00Z")
const row = { itemId: "366683469296", liveStatus: "LIVE_ACTIVE",
  supplierLinkage: "CERTIFIED", identityQuarantine: null,
  conflictingSupplierItemIds: [],
  components: [{ supplierSku: "ITEM5827",
    supplierProductId: "9220805492960",
    supplierVariantId: "48809607364832" }],
  stockFreshness: "FRESH", stockObservedAt: "2026-09-24T20:30:00Z",
  stockFreshUntil: "2026-09-25T02:30:00Z",
  stockGuardState: "CERTIFIED_OOS", supplierAvailability: "OUT_OF_STOCK" }
const receipt = { observation_id: "luna-stock-observation-v1:sha256:" + "a".repeat(64),
  account_key: "seller:account", ebay_item_id: row.itemId,
  luna_sku: "ITEM5827", luna_product_id: "9220805492960",
  luna_variant_id: "48809607364832",
  observation_state: "OBSERVED_OUT_OF_STOCK", source_status: "AVAILABLE",
  observed_availability: false, evidence_class: "SUPPLIER_STATED",
  acquisition_method: "CANONICAL_SERVER_READ",
  limitations: ["PUBLIC_EXACT_CERTIFIED_OOS"],
  observed_at: row.stockObservedAt, maximum_age_seconds: 21600 }
const gate = (patch = {}) => evaluateStockguardOosTriggerV1({
  cohortComplete: true, currentLiveState: "CURRENT_FRESH",
  row, receipt, accountKey: "seller:account", now, ...patch })

test("only fresh exact certified public OOS source is eligible", () => {
  assert.equal(gate(), null)
  assert.equal(gate({ row: { ...row, stockFreshness: "STALE" } }),
    "FRESH_STOCK_EVIDENCE_REQUIRED")
  assert.equal(gate({ row: { ...row, stockFreshness: "UNKNOWN" } }),
    "FRESH_STOCK_EVIDENCE_REQUIRED")
  assert.equal(gate({ row: { ...row, supplierLinkage: "UNPROVEN" } }),
    "EXACT_CERTIFIED_SUPPLIER_LINK_REQUIRED")
  assert.equal(gate({ row: { ...row, identityQuarantine: "AMBIGUOUS" } }),
    "EXACT_CERTIFIED_SUPPLIER_LINK_REQUIRED")
  assert.equal(gate({ row: { ...row,
    conflictingSupplierItemIds: ["366672496176"] } }),
    "EXACT_CERTIFIED_SUPPLIER_LINK_REQUIRED")
  assert.equal(gate({ row: { ...row, stockGuardState: "OWNER_VERIFIED_OUT_OF_STOCK" } }),
    "EXPLICIT_PROVEN_OUT_OF_STOCK_REQUIRED")
  assert.equal(gate({ receipt: { ...receipt,
    limitations: [] } }), "EXACT_DURABLE_OOS_SOURCE_RECEIPT_REQUIRED")
  assert.equal(gate({ cohortComplete: false }), "CURRENT_LIVE_COHORT_UNPROVEN")
})

test("zero is a no-op and readback never claims an unconfirmed write", () => {
  assert.equal(stockguardOosActionFromOfficialQuantityV1(0), "NO_OP")
  assert.equal(stockguardOosActionFromOfficialQuantityV1(3), "WRITE_ZERO")
  assert.equal(stockguardOosActionFromOfficialQuantityV1(null), "BLOCKED")
  const exact = { writeAccepted: true, beforeItemId: row.itemId,
    afterItemId: row.itemId, beforeSku: "ITEM5827", afterSku: "ITEM5827",
    beforeTitle: "Exact listing", afterTitle: "Exact listing",
    afterOwnership: "verified", afterQuantity: 0 }
  assert.equal(classifyStockguardOosReadbackV1(exact), "APPLIED_CONFIRMED")
  assert.equal(classifyStockguardOosReadbackV1({ ...exact,
    writeAccepted: false }), "PROTECTION_WRITE_UNCONFIRMED")
  assert.equal(classifyStockguardOosReadbackV1({ ...exact,
    afterQuantity: 1 }), "PROTECTION_WRITE_UNCONFIRMED")
  assert.equal(classifyStockguardOosReadbackV1({ ...exact,
    afterSku: "OTHER" }), "PROTECTION_WRITE_UNCONFIRMED")
})

test("in-stock after protection requires review and never implies restock", () => {
  assert.equal(projectStockguardOosProtectionStatusV1({
    receiptStatus: "APPLIED_CONFIRMED", freshness: "FRESH",
    supplierAvailability: "IN_STOCK" }), "RESTOCK_REVIEW_REQUIRED")
  assert.equal(projectStockguardOosProtectionStatusV1({
    receiptStatus: "APPLIED_CONFIRMED", freshness: "STALE",
    supplierAvailability: "UNKNOWN" }), "PROTECTED_OUT_OF_STOCK")
  assert.equal(projectStockguardOosProtectionStatusV1({
    receiptStatus: null, freshness: "UNKNOWN",
    supplierAvailability: "UNKNOWN" }), "NOT_PROTECTED")
})

test("active cron invokes quantity zero protection without its old EndItem path", () => {
  const cron = readFileSync(new URL("../../app/api/cron/ebay-active-listing-luna-monitor/route.ts", import.meta.url), "utf8")
  const service = readFileSync(new URL("./stockguard-oos-quantity-protection-v1.ts", import.meta.url), "utf8")
  assert.match(cron, /runStockguardOosQuantityProtectionV1/)
  assert.doesNotMatch(cron, /runAutomaticCertifiedOosProtectionV1/)
  assert.doesNotMatch(cron, /endLiveInvariantViolationNotAvailableV1|EndFixedPriceItem/)
  assert.match(service, /<ReviseInventoryStatusRequest/)
  assert.match(service, /<Quantity>0<\/Quantity>/)
  assert.doesNotMatch(service, /EndFixedPriceItem|<StartPrice>|PictureDetails/)
})
