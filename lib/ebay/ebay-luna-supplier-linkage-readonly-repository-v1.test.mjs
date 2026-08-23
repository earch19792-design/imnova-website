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

const { readSellerOsLunaSupplierLinkageEvidenceV1,
  resolveSellerOsCurrentLunaIdentityTargetsV1 } = await import(
  "./ebay-luna-supplier-linkage-readonly-repository-v1.ts"
)
const { sellerOsLunaIdentityProductJsonUrlV1 } = await import(
  "./ebay-luna-identity-verification-v1.ts"
)

const ITEM = "366584348898"
const OBSERVED_AT = "2026-08-21T12:00:00.000Z"

function supabaseFixture(results) {
  const calls = []
  return {
    calls,
    client: {
      from(table) {
        calls.push({ method: "from", table })
        const builder = {
          select(columns) { calls.push({ method: "select", table, columns }); return builder },
          eq(column, value) { calls.push({ method: "eq", table, column, value }); return builder },
          in(column, values) { calls.push({ method: "in", table, column, values }); return builder },
          order(column) { calls.push({ method: "order", table, column }); return builder },
          limit(value) { calls.push({ method: "limit", table, value }); return builder },
          then(resolve, reject) {
            return Promise.resolve(results[table] ?? { data: [], error: null })
              .then(resolve, reject)
          },
        }
        return builder
      },
    },
  }
}

test("repository reuses exact approval envelope and current Luna variant without leaking raw evidence", async () => {
  const fixture = supabaseFixture({
    ebay_active_listings: { data: [{
      id: "active-row-1", ebay_item_id: ITEM,
      market_radar_product_id: "178f272d-2eeb-4a9a-ab55-6595ce30f3f4",
      supplier_variant_id: "variant-black", supplier_sku: "LUNA-Z6-BLACK",
      updated_at: OBSERVED_AT,
      raw_payload: { seller_os_luna_watcher_v1: {
        contractVersion: "LUNA_SUPPLIER_STOCK_WATCHER_V1_2026_08_12",
        classification: "EXACT_PROVEN", humanApproved: true,
        ebayItemId: ITEM, supplierProductId: "supplier-product-z6",
        supplierVariantId: "variant-black", supplierSku: "LUNA-Z6-BLACK",
        canonicalSourceUrl: "https://lunaportex.com/products/z6-translator",
        approvedAt: OBSERVED_AT,
        approvalProvenance: "HUMAN_APPROVED_LUNA_LINKAGE",
        hiddenAccessToken: "must-never-leave-raw-payload",
      } },
    }], error: null },
    ebay_manual_listing_links: { data: [], error: null },
    market_radar_latest_variants: { data: [{
      product_id: "178f272d-2eeb-4a9a-ab55-6595ce30f3f4", supplier_product_id: "supplier-product-z6",
      product_url: "https://www.lunaportex.com/products/z6-translator",
      title: "Translator Z6", snapshot_id: "snapshot-black",
      supplier_variant_id: "variant-black", variant_title: "Black",
      sku: "LUNA-Z6-BLACK", captured_at: OBSERVED_AT,
    }], error: null },
  })
  const result = await readSellerOsLunaSupplierLinkageEvidenceV1(
    fixture.client, "seller:account-fingerprint", [ITEM], OBSERVED_AT,
  )
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.approvalEvidence.length, 1)
  assert.equal(result.approvalEvidence[0].variantPresence, "PRESENT")
  assert.equal(result.approvalEvidence[0].lunaVariantId, "variant-black")
  assert.equal(result.candidateEvidence.length, 1)
  assert.equal(result.candidateEvidence[0].lunaProductHasVariants, true)
  assert.equal(result.candidateEvidence[0].lunaProductId,
    "supplier-product-z6")
  assert.notEqual(result.candidateEvidence[0].lunaProductId,
    "178f272d-2eeb-4a9a-ab55-6595ce30f3f4")
  assert.equal(result.candidateEvidence[0].exactSupplierSku, true)
  assert.equal(result.candidateEvidence[0].exactVariantAttributes, true)
  assert.doesNotMatch(JSON.stringify(result),
    /must-never-leave|hiddenAccessToken|canonicalSourceUrl|https?:\/\//i)
  assert.deepEqual([...new Set(fixture.calls.filter((call) =>
    call.method === "from").map((call) => call.table))].sort(), [
    "ebay_active_listings", "ebay_manual_listing_links",
    "market_radar_latest_variants", "seller_os_luna_linkage_decisions",
  ])
  assert.equal(fixture.calls.some((call) => ["insert", "update", "upsert",
    "delete", "rpc"].includes(call.method)), false)
})

test("verified legacy manual link is candidate evidence and never an approval", async () => {
  const fixture = supabaseFixture({
    ebay_active_listings: { data: [], error: null },
    ebay_manual_listing_links: { data: [{
      id: "manual-row-1", ebay_item_id: ITEM, candidate_key: "candidate-1",
      market_radar_product_id: "178f272d-2eeb-4a9a-ab55-6595ce30f3f4",
      supplier_variant_id: "variant-black", supplier_sku: "LUNA-Z6-BLACK",
      verification_status: "verified",
      verification_method: "EBAY_TRADING_GET_ITEM_READONLY",
      verification_reason: "VERIFIED", verified_at: OBSERVED_AT,
      last_verification_at: OBSERVED_AT, updated_at: OBSERVED_AT,
    }], error: null },
    market_radar_latest_variants: { data: [{
      product_id: "178f272d-2eeb-4a9a-ab55-6595ce30f3f4", supplier_product_id: "supplier-product-z6",
      product_url: "https://www.lunaportex.com/products/z6-translator",
      title: "Translator Z6", snapshot_id: "snapshot-black",
      supplier_variant_id: "variant-black", variant_title: "Black",
      sku: "LUNA-Z6-BLACK", captured_at: OBSERVED_AT,
    }], error: null },
  })
  const result = await readSellerOsLunaSupplierLinkageEvidenceV1(
    fixture.client, "seller:account-fingerprint", [ITEM], OBSERVED_AT,
  )
  assert.equal(result.approvalEvidence.length, 0)
  assert.equal(result.candidateEvidence.length, 1)
  assert.equal(result.candidateEvidence[0].historicalApprovedRelationship, true)
  assert.equal(result.candidateEvidence[0].humanDecision, null)
  assert.equal(result.candidateEvidence[0].lunaProductId,
    "supplier-product-z6")
})

test("durable V2 human decision is read productively with external IDs and BOM multiplier", async () => {
  const fixture = supabaseFixture({
    ebay_active_listings: { data: [], error: null },
    ebay_manual_listing_links: { data: [], error: null },
    seller_os_luna_linkage_decisions: { data: [{
      decision_id: `luna-linkage-decision-v1:sha256:${"d".repeat(64)}`,
      ebay_item_id: ITEM, ebay_sku: "IMN-LST-000010",
      listing_title: "Translator Z6 Black 3 Pack",
      linkage_id: `luna-linkage-v1:sha256:${"e".repeat(64)}`,
      luna_product_id: "9220805755104",
      luna_variant_id: "48809607659744", luna_sku: "ITEM5810",
      components: [{
        lunaProductId: "9220805755104",
        lunaVariantId: "48809607659744", lunaSku: "ITEM5810",
        productTitle: "Translator Z6", variantTitle: "Black",
        supplierQuantityRequired: 3,
        quantityBasis: "HUMAN_CONFIRMATION_REQUIRED",
        variantPresence: "PRESENT", exactProductIdentity: true,
        exactVariantIdentity: true, exactSupplierSku: true,
        structuredVariantAttributesComplete: true, identityConflict: false,
      }],
      supplier_quantity_required: 3,
      evidence_references: ["luna-current-identity:identity-z6"],
      evidence_digest: `sha256:${"a".repeat(64)}`,
      decision: "APPROVE_EXACT_LINKAGE", decision_version: 1,
      decision_at: OBSERVED_AT,
      decision_reference: `luna-linkage-decision-v1:sha256:${"d".repeat(64)}`,
      contract_version: "SELLER_OS_LUNA_LINKAGE_DECISION_V1",
      classification: "EXACT_UNIQUE_MATCH",
      evidence_observed_at: OBSERVED_AT,
    }], error: null },
  })
  const result = await readSellerOsLunaSupplierLinkageEvidenceV1(
    fixture.client, "seller:account-fingerprint", [ITEM], OBSERVED_AT,
  )
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.decisionEvidence.length, 1)
  assert.equal(result.decisionEvidence[0].status, "APPROVED")
  assert.match(result.decisionEvidence[0].decisionReference,
    /luna-linkage-decision-v1:sha256:/)
  assert.equal(result.candidateEvidence.length, 1)
  assert.equal(result.candidateEvidence[0].lunaProductId, "9220805755104")
  assert.equal(result.candidateEvidence[0].supplierQuantityPerSale, 3)
  assert.equal(result.candidateEvidence[0].humanDecision.status, "APPROVED")
  assert.equal(result.candidateEvidence[0].supplierComponents[0]
    .supplierQuantityRequired, 3)
})

test("repository failures remain bounded and fail closed", async () => {
  const fixture = supabaseFixture({
    ebay_active_listings: { data: null, error: { message: "private database error" } },
    ebay_manual_listing_links: { data: null, error: { message: "private database error" } },
  })
  const result = await readSellerOsLunaSupplierLinkageEvidenceV1(
    fixture.client, "seller:account-fingerprint", [ITEM], OBSERVED_AT,
  )
  assert.equal(result.status, "UNAVAILABLE")
  assert.equal(result.rowsRead, 0)
  assert.deepEqual(result.approvalEvidence, [])
  assert.deepEqual(result.candidateEvidence, [])
  assert.doesNotMatch(JSON.stringify(result), /private database error/i)
})

test("invalid account and unbounded item selection are not accepted", async () => {
  const fixture = supabaseFixture({})
  const missingAccount = await readSellerOsLunaSupplierLinkageEvidenceV1(
    fixture.client, "", [ITEM], OBSERVED_AT,
  )
  assert.equal(missingAccount.status, "UNAVAILABLE")
  assert.equal(fixture.calls.length, 0)

  const manyItems = Array.from({ length: 80 }, (_, index) =>
    String(100000000 + index))
  const boundedFixture = supabaseFixture({
    ebay_active_listings: { data: [], error: null },
    ebay_manual_listing_links: { data: [], error: null },
  })
  const bounded = await readSellerOsLunaSupplierLinkageEvidenceV1(
    boundedFixture.client, "seller:account-fingerprint", manyItems, OBSERVED_AT,
  )
  assert.equal(bounded.truncated, true)
  const itemFilters = boundedFixture.calls.filter((call) =>
    call.method === "in" && call.column === "ebay_item_id")
  assert.equal(itemFilters.every((call) => call.values.length === 50), true)
})

test("identity target resolver accepts only a current item and server-owned external Luna identity", async () => {
  const fixture = supabaseFixture({
    ebay_active_listings: { data: [{
      id: "active-row-1", ebay_item_id: ITEM,
      market_radar_product_id: "178f272d-2eeb-4a9a-ab55-6595ce30f3f4",
      supplier_variant_id: "48809607659744", supplier_sku: "ITEM5810",
      updated_at: OBSERVED_AT,
    }], error: null },
    ebay_manual_listing_links: { data: [], error: null },
    market_radar_latest_variants: { data: [{
      product_id: "178f272d-2eeb-4a9a-ab55-6595ce30f3f4",
      supplier_product_id: "9220805755104",
      product_url: "https://www.lunaportex.com/products/z6-translator",
      title: "Translator Z6", snapshot_id: "snapshot-z6",
      supplier_variant_id: "48809607659744", variant_title: "Black",
      sku: "ITEM5810", captured_at: OBSERVED_AT,
    }], error: null },
  })
  const targets = await resolveSellerOsCurrentLunaIdentityTargetsV1(
    fixture.client, {
      accountKey: "seller:account-fingerprint",
      currentCohortId: "current-live:EBAY_US:certified-scope",
      currentItemIds: [ITEM], ebayItemId: ITEM,
    },
  )
  assert.equal(targets.length, 1)
  assert.equal(targets[0].lunaProductId, "9220805755104")
  assert.notEqual(targets[0].lunaProductId,
    "178f272d-2eeb-4a9a-ab55-6595ce30f3f4")
  assert.equal(sellerOsLunaIdentityProductJsonUrlV1(targets[0]),
    "https://www.lunaportex.com/products/z6-translator.js")
  assert.doesNotMatch(JSON.stringify(targets), /lunaportex\.com/)

  await assert.rejects(() => resolveSellerOsCurrentLunaIdentityTargetsV1(
    fixture.client, {
      accountKey: "seller:account-fingerprint",
      currentCohortId: "current-live:EBAY_US:certified-scope",
      currentItemIds: [], ebayItemId: ITEM,
    },
  ), /LUNA_IDENTITY_CURRENT_COHORT_ITEM_REQUIRED/)
  await assert.rejects(() => resolveSellerOsCurrentLunaIdentityTargetsV1(
    fixture.client, {
      accountKey: "seller:account-fingerprint",
      currentCohortId: "current-live:EBAY_US:certified-scope",
      currentItemIds: [ITEM], ebayItemId: ITEM,
      lunaProductId: "caller-injected",
    },
  ), /LUNA_IDENTITY_CALLER_INPUT_REJECTED/)
})

test("identity target resolver preserves a legacy external Luna product ID without treating it as Market Radar identity", async () => {
  const fixture = supabaseFixture({
    ebay_active_listings: { data: [{
      id: "active-row-external", ebay_item_id: ITEM,
      market_radar_product_id: "9220805755104",
      supplier_variant_id: "48809607659744", supplier_sku: "ITEM5810",
      updated_at: OBSERVED_AT,
    }], error: null },
    ebay_manual_listing_links: { data: [], error: null },
    market_radar_latest_variants: { data: [{
      product_id: "178f272d-2eeb-4a9a-ab55-6595ce30f3f4",
      supplier_product_id: "9220805755104",
      product_url: "https://www.lunaportex.com/products/z6-translator",
      title: "Translator Z6", snapshot_id: "snapshot-z6",
      supplier_variant_id: "48809607659744", variant_title: "Black",
      sku: "ITEM5810", captured_at: OBSERVED_AT,
    }], error: null },
  })
  const targets = await resolveSellerOsCurrentLunaIdentityTargetsV1(
    fixture.client, {
      accountKey: "seller:account-fingerprint",
      currentCohortId: "current-live:EBAY_US:certified-scope",
      currentItemIds: [ITEM], ebayItemId: ITEM,
    },
  )
  assert.equal(targets.length, 1)
  assert.equal(targets[0].lunaProductId, "9220805755104")
  assert.equal(fixture.calls.some((call) => call.method === "in" &&
    call.column === "supplier_product_id" &&
    call.values.includes("9220805755104")), true)
  assert.equal(fixture.calls.some((call) => call.method === "in" &&
    call.column === "product_id"), false)
})
