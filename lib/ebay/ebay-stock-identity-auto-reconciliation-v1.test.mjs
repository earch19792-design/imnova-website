import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      try { return nextResolve(`${value}.ts`, context) } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const { resolveSellerOsExactStockIdentityV1,
  selectCanonicalStockAuthoritySeedsP0 } = await import(
  "./ebay-stock-identity-auto-reconciliation-v1.ts")

const certified = [{ productId: "9220805755104",
  variantId: "48809607659744", sku: "ITEM5810", quantityRequired: 1 }]
const identity = { supplier_product_id: "9220805755104",
  supplier_variant_id: "48809607659744", sku: "ITEM5810",
  product_url: "https://lunaportex.com/products/exact-product" }

test("exact product variant and supplier SKU resolves exactly once", () => {
  const result = resolveSellerOsExactStockIdentityV1({
    certifiedComponents: certified, availableIdentities: [identity],
  })
  assert.equal(result.status, "AUTO_RESOLVED")
  assert.equal(result.components.length, 1)
  assert.match(result.components[0].componentIdentityId,
    /^luna-component-identity-v1:sha256:[0-9a-f]{64}$/)
})

test("zero matches stays fail closed", () => {
  const result = resolveSellerOsExactStockIdentityV1({
    certifiedComponents: certified, availableIdentities: [],
  })
  assert.equal(result.status, "NO_MATCH")
  assert.equal(result.components.length, 0)
})

test("multiple tuple matches stay ambiguous", () => {
  const result = resolveSellerOsExactStockIdentityV1({
    certifiedComponents: certified,
    availableIdentities: [identity, { ...identity }],
  })
  assert.equal(result.status, "AMBIGUOUS")
})

test("SKU or variant mismatch is never normalized into a match", () => {
  const result = resolveSellerOsExactStockIdentityV1({
    certifiedComponents: certified,
    availableIdentities: [{ ...identity, sku: "item5810" }],
  })
  assert.equal(result.status, "NO_MATCH")
})

test("stock refresh seeds require one ACTIVE authority and no quarantine", () => {
  const authority={authority_id:'authority',ebay_item_id:'366666581320',
    ebay_sku:'IMN-LST-000027',linkage_id:'luna-linkage-v1:sha256:'+'a'.repeat(64),
    components:[{lunaProductId:certified[0].productId,
      lunaVariantId:certified[0].variantId,lunaSku:certified[0].sku,
      supplierQuantityRequired:1,exactProductIdentity:true,
      exactVariantIdentity:true,exactSupplierSku:true,
      structuredVariantAttributesComplete:true,identityConflict:false}],
    evidence_maximum_age_seconds:21600,lifecycle_state:'ACTIVE'}
  const input={targets:['366666581320'],liveSkus:new Map([
    ['366666581320','IMN-LST-000027']]),authorities:[authority],quarantines:[]}
  assert.equal(selectCanonicalStockAuthoritySeedsP0(input).length,1)
  assert.equal(selectCanonicalStockAuthoritySeedsP0({...input,
    quarantines:[{ebay_item_id:'366666581320',quarantine_state:'ACTIVE'}]}).length,0)
  assert.equal(selectCanonicalStockAuthoritySeedsP0({...input,
    authorities:[{...authority,lifecycle_state:'INVALIDATED'}]}).length,0)
  assert.equal(selectCanonicalStockAuthoritySeedsP0({...input,
    liveSkus:new Map([['366666581320','OTHER']])}).length,0)
})

test("existing scheduler and persistence paths are reused", () => {
  const route = readFileSync(new URL(
    "../../app/api/cron/ebay-active-listing-luna-monitor/route.ts",
    import.meta.url), "utf8")
  const source = readFileSync(new URL(
    "./ebay-stock-identity-auto-reconciliation-v1.ts", import.meta.url),
  "utf8")
  assert.match(route, /reconcileSellerOsStockIdentityV1/)
  assert.match(source, /createSellerOsLunaStockObservationRepositoryV1/)
  assert.match(source, /createSellerOsLunaPublicExactStockAuthorityV1/)
  assert.match(source, /seller_os_listing_product_link_authorities_v1/)
  assert.match(source, /seller_os_listing_identity_quarantines_v1/)
  assert.doesNotMatch(source, /from\("seller_os_luna_linkage_decisions"\)/)
  assert.match(route, /LUNA_PRODUCTION_POLL_INTERVAL_SECONDS = 900/)
  assert.match(route, /maximumAttempts: 3/)
  assert.match(route, /maximumConcurrency: 4/)
  assert.match(route, /selectSellerOsLunaStockFreshnessRenewalsV1/)
  assert.doesNotMatch(route, /LUNA_PRODUCTION_POLLING_CANARY_ITEM_ID/)
  assert.match(route, /CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH/)
  assert.doesNotMatch(source, /EndFixedPriceItem|ReviseFixedPriceItem/)
})
