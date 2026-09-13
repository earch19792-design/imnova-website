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
  currentBatchShippingSlotBindingV1,
  currentBatchShippingSlotRolloverV1,
  hydrateCurrentBatchShippingWaitingPackagesV1,
  resolveCurrentBatchSlotExactPackageV1 } = await import(
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

test("terminal commercial outcome rolls the exact ready slot to the next normal candidate", () => {
  const nextCommercial = { productId: "product-next",
    variantId: "variant-next", supplierSku: "SKU-NEXT" }
  const nextCandidateId = deriveCurrentCommercialCandidateIdentityV1({
    accountKey, ...nextCommercial,
  }).canonicalCandidateId
  const result = currentBatchShippingSlotRolloverV1({ accountKey,
    readySlotReadback: { shippingReady: true,
      canonicalCandidateId: candidateId },
    factoryOutcomes: [{ ...waiting, status: "PARKED",
      listingReady: false, reasonCode: "MARKET_SUPPORT_NOT_PROVEN" }, {
      ...waiting, candidateId: nextCandidateId,
      opportunityId: "opportunity-next", listingPackageId: "package-next",
      lunaProductId: nextCommercial.productId,
      lunaVariantId: nextCommercial.variantId,
      supplierSku: nextCommercial.supplierSku,
    }],
  })
  assert.equal(result.priorCandidateId, candidateId)
  assert.equal(result.retirementStatus, "PARKED")
  assert.equal(result.next.canonicalCandidateId, nextCandidateId)
})

test("ambiguous or exceptional prior outcome cannot roll the exact slot", () => {
  for (const prior of [
    null,
    { ...waiting, status: "EXCEPTION", listingReady: false,
      reasonCode: "RUNTIME_FAILURE" },
    { ...waiting, status: "PARKED", listingReady: false, reasonCode: "" },
  ]) {
    const outcomes = prior ? [prior, waiting] : [waiting]
    assert.equal(currentBatchShippingSlotRolloverV1({ accountKey,
      readySlotReadback: { shippingReady: true,
        canonicalCandidateId: candidateId }, factoryOutcomes: outcomes,
    }), null)
  }
})

test("commercial rollover archives the exact receipt and never rebinds it", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260913094719_autonomous_stocking_shipping_slot_commercial_rollover_v1.sql",
    import.meta.url), "utf8")
  const batch = readFileSync(new URL(
    "./ebay-autonomous-stocking-batch-server-v1.ts", import.meta.url), "utf8")
  assert.match(migration,
    /seller_os_autonomous_stocking_shipping_slot_attempts_v1[\s\S]*capture_session_id[\s\S]*frontier_id[\s\S]*shipping_amount/)
  assert.match(migration,
    /shipping_status='SHIPPING_DURABLY_PERSISTED'[\s\S]*candidateId[^]*captureSessionId[^]*luna_product_id=v_slot\.product_id/)
  assert.match(migration,
    /status='WAITING_CAPTURE',capture_session_id=null,frontier_id=null,[\s\S]*shipping_amount=null,exact_durable_result_count=0/)
  assert.match(migration, /AUTONOMOUS_STOCKING_SHIPPING_ATTEMPT_APPEND_ONLY/)
  assert.match(batch, /rollover_autonomous_stocking_batch_shipping_slot_v1/)
  assert.doesNotMatch(migration,
    /9220841603296|48809653469408|FL-FULLBLACK-APPLEWATCH-CASE-BAND|f072df3f/)
})

test("waiting Shipping outcome hydrates only one exact CURRENT package", () => {
  const hydrated = hydrateCurrentBatchShippingWaitingPackagesV1({
    accountKey, factoryOutcomes: [{ ...waiting, listingPackageId: null }],
    packageRows: [{ id: "package-current",
      opportunity_id: "opportunity-current", account_key: accountKey }],
  })
  assert.equal(hydrated[0].listingPackageId, "package-current")
  assert.throws(() => hydrateCurrentBatchShippingWaitingPackagesV1({
    accountKey, factoryOutcomes: [{ ...waiting, listingPackageId: null }],
    packageRows: [{ id: "one", opportunity_id: "opportunity-current",
      account_key: accountKey }, { id: "two",
      opportunity_id: "opportunity-current", account_key: accountKey }],
  }), /AUTONOMOUS_STOCKING_SHIPPING_PACKAGE_AMBIGUOUS/)
})

const productTruthDigest = `sha256:${"b".repeat(64)}`
const exactSlotBinding = {
  canonicalCandidateId: candidateId,
  opportunityId: waiting.opportunityId,
  listingPackageId: waiting.listingPackageId,
  productId: commercial.productId,
  variantId: commercial.variantId,
  supplierSku: commercial.supplierSku,
}
const opportunity = {
  id: waiting.opportunityId,
  candidate_key: "storage-candidate-key",
  supplier_product_id: commercial.productId,
  supplier_variant_id: commercial.variantId,
  supplier_sku: commercial.supplierSku,
  assessment: {
    productTruth: { evidenceDigest: productTruthDigest,
      authorityClass: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
      canonicalCandidateId: candidateId,
      lunaProductId: commercial.productId,
      lunaVariantId: commercial.variantId,
      supplierSku: commercial.supplierSku,
      title: "Current product", gtin: null, supplierPriceUsd: 20,
      imageCount: 3, stock: { state: "IN_STOCK_SUPPLIER_STATED",
        supplierStatedQuantity: null, safeCapacity: null } },
    currentCommercialCandidateIdentityV1: {
      contractVersion: "CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_V1",
      canonicalCandidateId: candidateId,
      accountKey,
      productId: commercial.productId,
      variantId: commercial.variantId,
      supplierSku: commercial.supplierSku,
      storageCandidateKey: "storage-candidate-key",
    },
  },
}
function packageRow(id, marker = "CURRENT") {
  const current = marker === "HISTORICAL" ? undefined : {
    version: "SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1",
    authorityPolicy: "CURRENT_ONLY",
    reuseLegacyPreparation: false,
    packageId: id,
    accountKey,
    generation: `generation-${id}`,
    productId: commercial.productId,
    variantId: commercial.variantId,
    supplierSku: commercial.supplierSku,
    ...(marker === "SUPERSEDED" ? { status: "SUPERSEDED",
      supersededByPackageId: waiting.listingPackageId } :
      { status: "WAITING_FOR_CURRENT_AUTHORITIES" }),
    historicalReferences: id === waiting.listingPackageId ? [{
      packageId: "package-history", use: "AUDIT_LINEAGE_DEDUP_ONLY",
    }] : [],
  }
  return { id, opportunity_id: waiting.opportunityId,
    candidate_key: opportunity.candidate_key, account_key: accountKey,
    package_data: current ? { currentPublicationFactoryV1: current } : {} }
}

test("exact slot package plus historical sibling resolves only exact CURRENT authority", () => {
  const result = resolveCurrentBatchSlotExactPackageV1({ accountKey,
    slotBinding: exactSlotBinding, opportunity,
    packageRows: [packageRow(waiting.listingPackageId),
      packageRow("package-history", "HISTORICAL")],
  })
  assert.equal(result.listingPackageId, waiting.listingPackageId)
  assert.equal(result.exactSlotPackageResolution, true)
  assert.equal(result.currentAuthoritativePackageCount, 1)
  assert.equal(result.historicalPackageReusedAsAuthority, false)
  assert.equal(result.siblingClassifications[0].classification,
    "HISTORICAL_LINEAGE_ONLY")
})

test("exact slot package plus superseded sibling resolves exact package", () => {
  const result = resolveCurrentBatchSlotExactPackageV1({ accountKey,
    slotBinding: exactSlotBinding, opportunity,
    packageRows: [packageRow(waiting.listingPackageId),
      packageRow("package-superseded", "SUPERSEDED")],
  })
  assert.equal(result.currentAuthoritativePackageCount, 1)
  assert.equal(result.siblingClassifications[0].classification,
    "SUPERSEDED_NON_AUTHORITATIVE")
})

test("two compatible CURRENT authoritative packages fail closed ambiguous", () => {
  assert.throws(() => resolveCurrentBatchSlotExactPackageV1({ accountKey,
    slotBinding: exactSlotBinding, opportunity,
    packageRows: [packageRow(waiting.listingPackageId),
      packageRow("package-second-current")],
  }), /AUTONOMOUS_STOCKING_SHIPPING_PACKAGE_AMBIGUOUS/)
})

test("missing exact slot package fails closed", () => {
  assert.throws(() => resolveCurrentBatchSlotExactPackageV1({ accountKey,
    slotBinding: exactSlotBinding, opportunity,
    packageRows: [packageRow("package-history", "HISTORICAL")],
  }), /AUTONOMOUS_STOCKING_EXACT_SLOT_PACKAGE_NOT_FOUND/)
})

test("identity or material digest mismatch fails closed", () => {
  assert.throws(() => resolveCurrentBatchSlotExactPackageV1({ accountKey,
    slotBinding: exactSlotBinding,
    opportunity: { ...opportunity, supplier_variant_id: "wrong" },
    packageRows: [packageRow(waiting.listingPackageId)],
  }), /AUTONOMOUS_STOCKING_EXACT_PACKAGE_IDENTITY_MISMATCH/)
  const first = resolveCurrentBatchSlotExactPackageV1({ accountKey,
    slotBinding: exactSlotBinding, opportunity,
    packageRows: [packageRow(waiting.listingPackageId)] })
  assert.throws(() => resolveCurrentBatchSlotExactPackageV1({ accountKey,
    slotBinding: exactSlotBinding,
    opportunity: { ...opportunity, assessment: { ...opportunity.assessment,
      productTruth: { ...opportunity.assessment.productTruth,
        title: "Materially changed product" } } },
    packageRows: [packageRow(waiting.listingPackageId)],
    priorResolution: first,
  }), /AUTONOMOUS_STOCKING_EXACT_PACKAGE_MATERIAL_MISMATCH/)
})

test("exact package replay preserves binding and creates no duplicate", () => {
  const packageRows = [packageRow(waiting.listingPackageId),
    packageRow("package-history", "HISTORICAL")]
  const first = resolveCurrentBatchSlotExactPackageV1({ accountKey,
    slotBinding: exactSlotBinding, opportunity, packageRows })
  const replay = resolveCurrentBatchSlotExactPackageV1({ accountKey,
    slotBinding: exactSlotBinding,
    opportunity: { ...opportunity, assessment: { ...opportunity.assessment,
      productTruth: { ...opportunity.assessment.productTruth,
        evidenceDigest: `sha256:${"c".repeat(64)}`,
        stock: { ...opportunity.assessment.productTruth.stock,
          observedAt: "later", freshness: "FRESH" } } } }, packageRows,
    priorResolution: first })
  assert.equal(replay.listingPackageId, first.listingPackageId)
  assert.equal(replay.materialBindingDigest, first.materialBindingDigest)
  assert.equal(replay.currentAuthoritativePackageCount, 1)
  assert.equal(packageRows.length, 2)
})

test("exact package resolver is general and runtime-owned", () => {
  const resolver = readFileSync(new URL(
    "./ebay-autonomous-stocking-shipping-slot-v1.ts", import.meta.url), "utf8")
  const batchRuntime = readFileSync(new URL(
    "./ebay-autonomous-stocking-batch-server-v1.ts", import.meta.url), "utf8")
  const source = `${resolver}\n${batchRuntime}`
  assert.doesNotMatch(source,
    /2d4d0934-dab9-4a43-b8d1-330c5900a8ec|cf9ff65a-139f-4e8c-a155-8ea13c413736|f072df3f-5434-4e05-98b8-99c2bd87b5b9/)
  assert.match(batchRuntime,
    /readCurrentBatchExactPackageResolutionV1[\s\S]*resumeRadarFactoryCandidateAfterShippingV1/)
  assert.match(batchRuntime,
    /AUTONOMOUS_STOCKING_SHIPPING_PACKAGE_AMBIGUOUS[\s\S]*exactPackageResolution/)
})
