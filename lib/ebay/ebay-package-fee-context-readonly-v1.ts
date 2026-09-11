import { getSupabaseAdminClient } from "../supabase-admin"
import { getEbaySellerAccountScopeConfiguration } from "./ebay-seller-account-scope"
import { readEbaySellerStoreSubscriptionReadonly } from "./ebay-account-policy-readonly-gateway"
import { readEbayFeePerformanceReadonlyV1 } from "./ebay-seller-analytics-readonly-gateway"
import { readCurrentOfficialFeePolicyV1 } from "./ebay-fee-policy-readonly-v1"
import { readSellingFeeTaxPolicyV1 } from "./ebay-selling-fee-tax-policy-v1"
import { resolveEbayFeeStoreContextV1, feeContextSafeErrorV1 } from "./ebay-fee-context-domain-v1"

// Account authority is read in its existing authenticated runtime, without a
// fabricated ItemID or a GetItem for an unrelated LIVE product. No writes.
export async function readEbayPackageFeeContextReadonlyV1(packageId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(packageId)) throw Error("EXACT_PACKAGE_REQUIRED")
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) throw Error("EBAY_FEE_ACCOUNT_BINDING_REQUIRED")
  const db = getSupabaseAdminClient()
  const p = await db.from("ebay_listing_packages").select("id,account_key,opportunity_id,category:package_data->>categoryId,price:package_data->pricing->targetPrice")
    .eq("id", packageId).eq("account_key", accountKey).limit(1).abortSignal(AbortSignal.timeout(8000)).maybeSingle()
  if (p.error || !p.data) throw Error("EXACT_PACKAGE_UNAVAILABLE")
  const q = await db.from("ebay_luna_opportunity_queue").select("supplier_product_id,supplier_variant_id,supplier_sku")
    .eq("id", p.data.opportunity_id).limit(1).abortSignal(AbortSignal.timeout(8000)).maybeSingle()
  if (q.error || !q.data) throw Error("EXACT_PRODUCT_UNAVAILABLE")
  const results = await Promise.allSettled([readEbaySellerStoreSubscriptionReadonly(), readEbayFeePerformanceReadonlyV1(),
    readCurrentOfficialFeePolicyV1(), readSellingFeeTaxPolicyV1()])
  const component = (i: number) => { const r = results[i]; return r.status === "fulfilled" ? r.value :
    { status: "UNPROVEN", errorCode: feeContextSafeErrorV1(r.reason) } }
  return { contractVersion: "SELLER_OS_PACKAGE_FEE_CONTEXT_READONLY_V1", packageId, marketplaceAccountKey: accountKey,
    observedAt: new Date().toISOString(), identity: { itemId: null, packageId, sku: q.data.supplier_sku,
      productId: q.data.supplier_product_id, variantId: q.data.supplier_variant_id, marketplace: "EBAY_US" },
    listing: { categoryId: p.data.category, price: p.data.price, currency: "USD", saleFormat: "FIXED_PRICE" },
    resolvedStoreContext: resolveEbayFeeStoreContextV1(component(0), component(1)), subscription: component(0),
    accountPerformance: component(1), officialFeePolicySnapshot: component(2), feeTaxPolicy: component(3),
    status: "CONTEXT_ONLY_NOT_FEE_AUTHORITY", safety: { readOnly: true, marketplaceWrites: 0, databaseWrites: 0 } }
}
