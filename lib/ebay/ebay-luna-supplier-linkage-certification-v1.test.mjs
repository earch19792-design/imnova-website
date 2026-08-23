import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier)
    if (value.startsWith(".") && !/\.(?:ts|mjs|js|json)$/.test(value)) {
      return nextResolve(`${value}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const {
  SELLER_OS_LUNA_SUPPLIER_LINKAGE_RESOURCE_V1,
  buildSellerOsLunaSupplierLinkageStatusV1,
} = await import("./ebay-luna-supplier-linkage-certification-v1.ts")

const OBSERVED_AT = "2026-08-21T12:00:00.000Z"
const ACCOUNT = "seller:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

function listing(overrides = {}) {
  return {
    itemId: "366584348898",
    sku: "IMN-LST-000010",
    title: "Translator Z6 Black",
    listingType: "INDIVIDUAL",
    observedAt: OBSERVED_AT,
    evidenceReferences: ["live-listing:366584348898"],
    ...overrides,
  }
}

function candidate(overrides = {}) {
  return {
    ebayItemId: "366584348898",
    lunaProductId: "luna-product-z6",
    lunaVariantId: "z6-black",
    lunaProductHasVariants: true,
    lunaSku: "LUNA-Z6-BLACK",
    lunaModel: "Z6",
    productTitle: "Translator Z6",
    variantTitle: "Black",
    observedAt: OBSERVED_AT,
    sourceUpdatedAt: OBSERVED_AT,
    evidenceReferences: ["luna-current-variant:snapshot-z6-black"],
    exactSupplierSku: true,
    exactModelNumber: false,
    exactVariantAttributes: true,
    titleSimilarityOnly: false,
    colorMatch: true,
    sizeMatch: null,
    packCountMatch: true,
    listingPackCount: 1,
    supplierUnitCount: 1,
    supplierQuantityPerSale: 1,
    supplierComponents: [],
    historicalApprovedRelationship: false,
    variantPresence: "PRESENT",
    humanDecision: null,
    ...overrides,
  }
}

function approval(overrides = {}) {
  return {
    ebayItemId: "366584348898",
    lunaProductId: "luna-external-product-z6",
    lunaVariantId: "z6-black",
    lunaSku: "LUNA-Z6-BLACK",
    approvedAt: OBSERVED_AT,
    approvalProvenance: "HUMAN_APPROVED_LUNA_LINKAGE",
    decisionReference: "luna-approval:approval-z6-black",
    sourceUpdatedAt: OBSERVED_AT,
    variantPresence: "PRESENT",
    productTitle: "Translator Z6",
    variantTitle: "Black",
    evidenceReferences: ["luna-current-variant:snapshot-z6-black"],
    ...overrides,
  }
}

function build(options = {}) {
  const listings = options.listings ?? [listing()]
  return buildSellerOsLunaSupplierLinkageStatusV1({
    accountKey: ACCOUNT,
    accountAlias: "seller",
    accountBindingMatched: true,
    scope: {
      identityStatus: "CERTIFIED",
      scopeId: "current-live:test",
      observedAt: OBSERVED_AT,
      itemIds: options.itemIds ?? listings.map((row) => row.itemId),
      historicalOrNonliveCount: options.historicalOrNonliveCount ?? 0,
    },
    listings,
    conflicts: options.conflicts ?? [],
    repositoryEvidence: {
      status: options.repositoryStatus ?? "AVAILABLE",
      observedAt: OBSERVED_AT,
      approvalEvidence: options.approvals ?? [],
      candidateEvidence: options.candidates ?? [],
      decisionEvidence: options.decisions ?? [],
      rowsRead: 1,
      truncated: options.truncated ?? false,
      limitationCodes: options.limitationCodes ?? [],
    },
  })
}

test("exact supplier SKU plus exact variant is a strong candidate, never auto-certified", () => {
  const result = build({ candidates: [candidate()] })
  assert.equal(result.counts.candidate, 1)
  assert.equal(result.counts.certified, 0)
  assert.equal(result.entries[0].status, "CANDIDATE")
  assert.equal(result.entries[0].confidence, "HIGH")
  assert.equal(result.entries[0].humanReview.required, true)
  assert.equal(result.entries[0].stockCertification.status, "NOT_EVALUATED")
})

test("title-only similarity stays UNPROVEN and cannot auto-certify", () => {
  const result = build({ candidates: [candidate({
    exactSupplierSku: false, exactVariantAttributes: false,
    titleSimilarityOnly: true,
  })] })
  assert.equal(result.entries[0].status, "UNPROVEN")
  assert.ok(result.entries[0].humanReview.reasonCodes.includes(
    "TITLE_SIMILARITY_NOT_AUTHORITY"))
})

for (const [name, field] of [["color", "colorMatch"], ["size", "sizeMatch"],
  ["pack count", "packCountMatch"]]) {
  test(`${name} mismatch requires human review`, () => {
    const result = build({ candidates: [candidate({ [field]: false })] })
    assert.equal(result.entries[0].status, "HUMAN_REVIEW")
    assert.ok(result.entries[0].humanReview.reasonCodes.includes(
      "STRUCTURED_VARIANT_ATTRIBUTE_MISMATCH"))
  })
}

test("bundle identity requires an explicit structured multiplier", () => {
  const withoutMultiplier = build({ listings: [listing({ listingType: "PACK" })],
    candidates: [candidate({ listingPackCount: 3, supplierUnitCount: null,
      supplierQuantityPerSale: null })] })
  assert.equal(withoutMultiplier.entries[0].status, "HUMAN_REVIEW")
  assert.ok(withoutMultiplier.entries[0].humanReview.reasonCodes.includes(
    "SUPPLIER_QUANTITY_MULTIPLIER_REQUIRED"))
  const withMultiplier = build({ listings: [listing({ listingType: "PACK" })],
    candidates: [candidate({ listingPackCount: 3, supplierUnitCount: 1,
      supplierQuantityPerSale: 3 })] })
  assert.equal(withMultiplier.entries[0].status, "CANDIDATE")
  assert.equal(withMultiplier.entries[0].supplierQuantityPerSale, 3)
  assert.equal(withMultiplier.entries[0].bundleSemantics.mode,
    "SINGLE_COMPONENT_MULTIPLIER")
  assert.equal(withMultiplier.entries[0].bundleSemantics.inferredFromTitle, false)
})

test("multi-component bundle preserves exact Luna component identities and BOM quantities", () => {
  const components = [{
    lunaProductId: "luna-product-z6",
    lunaVariantId: "z6-black",
    lunaProductHasVariants: true,
    lunaSku: "LUNA-Z6-BLACK",
    productTitle: "Translator Z6",
    variantTitle: "Black",
    supplierQuantityRequired: 2,
    variantPresence: "PRESENT",
    evidenceReferences: ["luna-current-variant:z6-black"],
    exactSupplierSku: true,
    exactVariantAttributes: true,
    colorMatch: true,
    sizeMatch: null,
    packCountMatch: true,
  }, {
    lunaProductId: "luna-product-case",
    lunaVariantId: "case-black",
    lunaProductHasVariants: true,
    lunaSku: "LUNA-CASE-BLACK",
    productTitle: "Translator Case",
    variantTitle: "Black",
    supplierQuantityRequired: 1,
    variantPresence: "PRESENT",
    evidenceReferences: ["luna-current-variant:case-black"],
    exactSupplierSku: true,
    exactVariantAttributes: true,
    colorMatch: true,
    sizeMatch: null,
    packCountMatch: true,
  }]
  const pending = build({
    listings: [listing({ listingType: "BUNDLE" })],
    candidates: [candidate({ supplierComponents: components })],
  })
  assert.equal(pending.entries[0].status, "CANDIDATE")
  assert.equal(pending.entries[0].lunaIdentity.variantSemantics,
    "MULTI_COMPONENT_BOM")
  assert.equal(pending.entries[0].lunaIdentity.productId, null)
  assert.equal(pending.entries[0].supplierQuantityPerSale, null)
  assert.equal(pending.entries[0].bundleSemantics.mode,
    "MULTI_COMPONENT_BOM")
  assert.deepEqual(pending.entries[0].bundleSemantics.components.map((row) =>
    [row.sku, row.supplierQuantityRequired]), [
    ["LUNA-CASE-BLACK", 1], ["LUNA-Z6-BLACK", 2],
  ])
  assert.equal(pending.entries[0].lunaComponents.length, 2)
  assert.equal(new Set(pending.entries[0].lunaComponents.map((row) =>
    row.componentIdentityId)).size, 2)

  const decision = { status: "APPROVED", decidedAt: OBSERVED_AT,
    decisionReference: "human-review:bundle-z6-case",
    version: "P2_I01_DECISION_V1" }
  const approved = build({
    listings: [listing({ listingType: "BUNDLE" })],
    candidates: [candidate({ supplierComponents: components,
      humanDecision: decision })],
  })
  assert.equal(approved.entries[0].status, "CERTIFIED")
  assert.equal(approved.entries[0].linkageId,
    build({ listings: [listing({ listingType: "BUNDLE" })],
      candidates: [candidate({ supplierComponents: [...components].reverse(),
        humanDecision: decision })] }).entries[0].linkageId)
})

test("persisted single-component approval cannot certify an unapproved bundle BOM", () => {
  const result = build({
    listings: [listing({ listingType: "PACK" })],
    approvals: [approval()],
    candidates: [candidate({ supplierQuantityPerSale: 3,
      listingPackCount: 3, supplierUnitCount: 1 })],
  })
  assert.equal(result.entries[0].status, "HUMAN_REVIEW")
  assert.ok(result.entries[0].humanReview.reasonCodes.includes(
    "BUNDLE_BOM_HUMAN_APPROVAL_REQUIRED"))
})

test("explicit approved exact mapping becomes CERTIFIED with deterministic linkage", () => {
  const decision = { status: "APPROVED", decidedAt: OBSERVED_AT,
    decisionReference: "human-review:decision-z6", version: "P2_I01_DECISION_V1" }
  const first = build({ candidates: [candidate({ humanDecision: decision })] })
  const second = build({ candidates: [candidate({ humanDecision: decision })] })
  assert.equal(first.entries[0].status, "CERTIFIED")
  assert.match(first.entries[0].linkageId, /^luna-linkage-v1:sha256:[a-f0-9]{64}$/)
  assert.equal(first.entries[0].linkageId, second.entries[0].linkageId)
  assert.equal(first.entries[0].humanReview.contractVersion,
    "SELLER_OS_HUMAN_REVIEW_GATE_V1")
})

test("canonical persisted approval is authoritative and replay-safe 100 times", () => {
  const identities = new Set(Array.from({ length: 100 }, () => build({
    approvals: [approval()], candidates: [candidate()],
  }).entries[0].linkageId))
  assert.equal(identities.size, 1)
  const result = build({ approvals: [approval()], candidates: [candidate()] })
  assert.equal(result.entries[0].status, "CERTIFIED")
  assert.equal(result.entries[0].provenance.authorityClass,
    "DURABLY_PERSISTED_FACT")
})

test("duplicate evidence for one identity never creates a duplicate link", () => {
  const result = build({ candidates: [candidate(), candidate({
    evidenceReferences: ["duplicate:same-identity"],
  })] })
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].status, "CANDIDATE")
})

test("listing title changes preserve listing and linkage identities", () => {
  const first = build({ candidates: [candidate()] })
  const second = build({ listings: [listing({ title: "Z6 Translator Black Updated" })],
    candidates: [candidate()] })
  assert.equal(first.entries[0].listingIdentityId,
    second.entries[0].listingIdentityId)
  assert.equal(first.entries[0].linkageId, second.entries[0].linkageId)
})

test("a certified Luna variant that disappears becomes STALE, never OOS", () => {
  const result = build({ approvals: [approval({ variantPresence: "MISSING" })] })
  assert.equal(result.entries[0].status, "STALE")
  assert.equal(result.entries[0].stockCertification.outOfStock, null)
  assert.equal(result.entries[0].stockCertification.automaticPauseAllowed, false)
})

test("a never-approved candidate with a missing Luna variant stays UNPROVEN", () => {
  const result = build({ candidates: [candidate({
    exactSupplierSku: false,
    exactVariantAttributes: false,
    variantPresence: "MISSING",
  })] })
  assert.equal(result.entries[0].status, "UNPROVEN")
  assert.ok(result.entries[0].humanReview.reasonCodes.includes(
    "LUNA_CANDIDATE_VARIANT_NOT_CURRENTLY_PRESENT"))
  assert.equal(result.entries[0].stockCertification.outOfStock, null)
})

test("historical/non-live rows are excluded from the live denominator", () => {
  const result = build({ historicalOrNonliveCount: 9,
    approvals: [approval()] })
  assert.equal(result.counts.currentLive, 1)
  assert.equal(result.scope.historicalOrNonliveEvidenceCount, 9)
  assert.equal(result.scope.historicalOrNonliveIncludedInDenominator, false)
  assert.equal(result.coveragePercent, 100)
})

test("conflicting listing representation forces HUMAN_REVIEW", () => {
  const result = build({ approvals: [approval()], conflicts: [{
    itemId: "366584348898",
    evidenceReferences: ["representation:a", "representation:b"],
    titleRepresentations: ["Lysol 3 Pack", "Lysol Travel Wipes"],
    skuRepresentations: ["SKU-A", "SKU-B"],
    identityRepresentationConflict: true,
  }] })
  assert.equal(result.entries[0].status, "HUMAN_REVIEW")
  assert.ok(result.entries[0].humanReview.reasonCodes.includes(
    "LISTING_IDENTITY_REPRESENTATION_CONFLICT"))
})

test("two equally plausible Luna variants require HUMAN_REVIEW", () => {
  const result = build({ candidates: [candidate(), candidate({
    lunaVariantId: "z6-white", lunaSku: "LUNA-Z6-WHITE",
    variantTitle: "White", evidenceReferences: ["luna-current-variant:white"],
  })] })
  assert.equal(result.entries[0].status, "HUMAN_REVIEW")
  assert.ok(result.entries[0].humanReview.reasonCodes.includes(
    "MULTIPLE_EQUALLY_PLAUSIBLE_LUNA_CANDIDATES"))
})

test("missing Luna evidence stays UNPROVEN and UNKNOWN never becomes ZERO", () => {
  const result = build()
  assert.equal(result.entries[0].status, "UNPROVEN")
  assert.equal(result.entries[0].stockCertification.outOfStock, null)
  assert.equal(result.entries[0].stockCertification.safeCapacity, null)
  assert.equal(result.entries[0].stockCertification.unknownIsZero, false)
})

test("rejected candidate is distinct from unproven and certified", () => {
  const result = build({ candidates: [candidate({ humanDecision: {
    status: "REJECTED", decidedAt: OBSERVED_AT,
    decisionReference: "human-review:rejected-z6", version: "P2_I01_DECISION_V1",
  } })] })
  assert.equal(result.entries[0].status, "REJECTED")
  assert.equal(result.entries[0].humanReview.decisionStatus, "REJECTED")
})

test("durable KEEP_UNPROVEN remains explicitly unproven", () => {
  const result = build({ candidates: [candidate()],
    decisions: [{
      ebayItemId: "366584348898", status: "KEPT_UNPROVEN",
      decidedAt: OBSERVED_AT, decisionReference: "human-review:kept-z6",
      version: "1", evidenceDigest: `sha256:${"a".repeat(64)}`,
    }] })
  assert.equal(result.entries[0].status, "UNPROVEN")
  assert.equal(result.entries[0].humanReview.decisionStatus,
    "KEPT_UNPROVEN")
  assert.ok(result.entries[0].humanReview.reasonCodes.includes(
    "LUNA_LINKAGE_KEPT_UNPROVEN_BY_HUMAN"))
})

test("product without variants uses explicit NO_VARIANT semantics", () => {
  const result = build({ candidates: [candidate({ lunaProductHasVariants: false,
    lunaVariantId: null })] })
  assert.equal(result.entries[0].lunaIdentity.variantSemantics,
    "PRODUCT_HAS_NO_VARIANTS")
  assert.match(result.entries[0].linkageId, /^luna-linkage-v1:sha256:/)
})

test("contract is bounded, PII/secret-free, and performs no side effects", () => {
  const result = build({ candidates: [candidate()] })
  const serialized = JSON.stringify(result)
  assert.equal(result.contractVersion,
    "SELLER_OS_LUNA_SUPPLIER_LINKAGE_STATUS_V1")
  assert.equal(result.bounded, true)
  assert.equal(result.maximumEntries, 50)
  assert.equal(SELLER_OS_LUNA_SUPPLIER_LINKAGE_RESOURCE_V1.id,
    "seller-os://phase-2/luna-supplier-linkage")
  assert.doesNotMatch(serialized,
    /"buyerName"\s*:|"buyerEmail"\s*:|"shippingAddress"\s*:|"accessToken"\s*:|"refreshToken"\s*:|"clientSecret"\s*:|"authorizationHeader"\s*:|Bearer\s+[A-Za-z0-9]|"cookie"\s*:|process\.env|"rawPayload"\s*:|https?:\/\//i)
  assert.equal(result.safety.buyerPiiIncluded, false)
  assert.equal(result.safety.credentialsIncluded, false)
  assert.equal(result.safety.environmentValuesIncluded, false)
  assert.equal(result.safety.arbitrarySupplierUrlAllowed, false)
  assert.equal(result.safety.arbitraryUrlFetchAllowed, false)
  assert.equal(result.safety.arbitraryAccountAllowed, false)
  assert.equal(result.safety.arbitrarySqlAllowed, false)
  assert.equal(result.safety.marketplaceWritesByThisRead, 0)
  assert.equal(result.safety.inventoryWritesByThisRead, 0)
  assert.equal(result.safety.lunaLinkMutationsByThisRead, 0)
  assert.equal(result.safety.whatsappSendsByThisRead, 0)
  assert.equal(result.safety.buyerMessageSendsByThisRead, 0)
  assert.equal(result.safety.paymentTransactionsByThisRead, 0)
})
