import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { deriveCurrentCommercialCandidateIdentityV1 } = await import(
  "./ebay-current-commercial-candidate-identity-v1.ts")
const { certifyCurrentBatchShippingSlotReadbackV1,
  currentBatchShippingSlotBindingV1 } = await import(
  "./ebay-autonomous-stocking-shipping-slot-v1.ts")

const accountKey = `seller:${"a".repeat(64)}`
const commercial = {
  productId: "product-current",
  variantId: "variant-current",
  supplierSku: "SKU-CURRENT",
}
const candidateId = deriveCurrentCommercialCandidateIdentityV1({
  accountKey, ...commercial,
}).canonicalCandidateId
const waiting = {
  candidateId, opportunityId: "opportunity-current",
  listingPackageId: "package-current",
  lunaProductId: commercial.productId,
  lunaVariantId: commercial.variantId,
  supplierSku: commercial.supplierSku,
  reasonCode: "WAITING_BROWSER_WORKER",
  shippingJobIdentityMatch: true,
}

test("Seller OS order binds the first exact CURRENT Shipping candidate", () => {
  const second = { ...waiting,
    candidateId: deriveCurrentCommercialCandidateIdentityV1({ accountKey,
      productId: "product-second", variantId: "variant-second",
      supplierSku: "SKU-SECOND" }).canonicalCandidateId,
    opportunityId: "opportunity-second", listingPackageId: "package-second",
    lunaProductId: "product-second", lunaVariantId: "variant-second",
    supplierSku: "SKU-SECOND" }
  const slot = currentBatchShippingSlotBindingV1({ accountKey,
    factoryOutcomes: [waiting, second] })
  assert.equal(slot.canonicalCandidateId, candidateId)
  assert.equal(slot.foreignReceiptAdopted, false)
  assert.equal(slot.manualIdentityRebind, false)
  assert.equal(slot.codexRuntimeDependency, false)
})

test("existing CURRENT slot ignores other waiting candidates after progression", () => {
  const result = currentBatchShippingSlotBindingV1({ accountKey,
    factoryOutcomes: [{ ...waiting, candidateId:
      deriveCurrentCommercialCandidateIdentityV1({ accountKey,
        productId: "other", variantId: "other", supplierSku: "OTHER",
      }).canonicalCandidateId,
      lunaProductId: "other", lunaVariantId: "other", supplierSku: "OTHER" }],
    existingBinding: {
      canonicalCandidateId: candidateId,
      opportunityId: waiting.opportunityId,
      listingPackageId: waiting.listingPackageId,
      productId: commercial.productId,
      variantId: commercial.variantId,
      supplierSku: commercial.supplierSku,
    },
  })
  assert.equal(result, null)
})

test("existing CURRENT slot fails closed on same candidate binding drift", () => {
  assert.throws(() => currentBatchShippingSlotBindingV1({ accountKey,
    factoryOutcomes: [{ ...waiting, listingPackageId: "foreign-package" }],
    existingBinding: {
      canonicalCandidateId: candidateId,
      opportunityId: waiting.opportunityId,
      listingPackageId: waiting.listingPackageId,
      productId: commercial.productId,
      variantId: commercial.variantId,
      supplierSku: commercial.supplierSku,
    },
  }), /AUTONOMOUS_STOCKING_SHIPPING_SLOT_BINDING_CONTRADICTION/)
})

test("foreign receipt can never satisfy the CURRENT batch slot", () => {
  assert.throws(() => certifyCurrentBatchShippingSlotReadbackV1({
    slotPresent: true, canonicalCandidateId: candidateId,
    targetActiveCaptureCount: 0, shippingDuplicateCaptureCount: 0,
    shippingReady: true, currentExactBoundQuote: true,
    captureResultDurable: true, durableReadbackMatch: true,
    shippingReceiptCommercialIdentityMatch: true,
    targetCurrentShippingCaptureExecuted: true,
    exactDurableResultCount: 1, foreignReceiptAdopted: true,
    manualIdentityRebind: false, codexRuntimeDependency: false,
  }), /AUTONOMOUS_STOCKING_SHIPPING_SLOT_READBACK_INVALID/)
})

test("ambiguous active captures fail closed", () => {
  assert.throws(() => certifyCurrentBatchShippingSlotReadbackV1({
    slotPresent: true, canonicalCandidateId: candidateId,
    targetActiveCaptureCount: 2, shippingDuplicateCaptureCount: 0,
    shippingReady: false, foreignReceiptAdopted: false,
    manualIdentityRebind: false, codexRuntimeDependency: false,
  }), /AUTONOMOUS_STOCKING_SHIPPING_SLOT_READBACK_INVALID/)
})

test("exact durable receipt certifies ready and replay remains duplicate-free", () => {
  const result = certifyCurrentBatchShippingSlotReadbackV1({
    slotPresent: true, canonicalCandidateId: candidateId,
    targetActiveCaptureCount: 0, shippingDuplicateCaptureCount: 0,
    shippingReady: true, currentExactBoundQuote: true,
    captureResultDurable: true, durableReadbackMatch: true,
    shippingReceiptCommercialIdentityMatch: true,
    targetCurrentShippingCaptureExecuted: true,
    exactDurableResultCount: 1, shippingAmount: 4.25,
    foreignReceiptAdopted: false, manualIdentityRebind: false,
    codexRuntimeDependency: false,
  })
  assert.equal(result.shippingReady, true)
  assert.equal(result.priorityCandidateId, null)
})

test("runtime and ledger enforce exact claim plus receipt commercial identity", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260913084305_autonomous_stocking_batch_shipping_identity_scope_v1.sql",
    import.meta.url), "utf8")
  const batch = readFileSync(new URL(
    "./ebay-autonomous-stocking-batch-server-v1.ts", import.meta.url), "utf8")
  const shipping = readFileSync(new URL(
    "./ebay-luna-chrome-shipping-capture-server-v1.ts", import.meta.url), "utf8")
  assert.match(migration,
    /candidate_id=v_slot\.canonical_candidate_id[\s\S]*captureSessionId[\s\S]*luna_product_id=v_slot\.product_id[\s\S]*luna_variant_id=v_slot\.variant_id[\s\S]*luna_sku=v_slot\.supplier_sku/)
  assert.match(migration, /foreign_receipt_adopted boolean not null default false/)
  assert.match(migration, /targetActiveCaptureCount/)
  assert.match(batch, /bind_autonomous_stocking_batch_shipping_slot_v1/)
  assert.doesNotMatch(batch,
    /eq\("status", "COMPLETED"\)[\s\S]*gt\("expired_recovery_count", 0\)/)
  assert.match(shipping,
    /batchPriorityCandidateIds[\s\S]*candidateIds: batchPriorityCandidateIds/)
  assert.match(shipping,
    /const economic = batchPriorityCandidateIds[\s\S]*jobs: Object\.freeze\(\[\]\)/)
  assert.doesNotMatch(migration,
    /9220845895904|53002124984544|FL-DIAMOND-4LINE-ANKLET|f072df3f/)
})

test("SHIPPING_READY replay preserves the exact slot and revalidates receipt", () => {
  const replay = readFileSync(new URL(
    "../../supabase/migrations/20260913093649_autonomous_stocking_shipping_slot_replay_readback_v1.sql",
    import.meta.url), "utf8")
  assert.match(replay,
    /v_exact_count=1 and v_slot\.status='SHIPPING_READY'[\s\S]*READY_REPLAY_CONTRADICTION/)
  assert.match(replay,
    /v_exact_count=1 and v_slot\.status<>'SHIPPING_READY'[\s\S]*returning \* into v_slot/)
  assert.doesNotMatch(replay,
    /9220841603296|48809653469408|FL-FULLBLACK-APPLEWATCH-CASE-BAND|f072df3f/)
})
