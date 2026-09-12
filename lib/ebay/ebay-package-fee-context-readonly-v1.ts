import { readPublicationPayoutCurrencyV1, inspectPublicationPayoutGrantV1, PAYOUT_GRANT_DIAGNOSTIC_V2, resolvePayoutGrantWithFundsReadV1 } from './ebay-publication-fee-supplement-v1'
import { readCurrentCategoryServiceMetricsV1 } from './ebay-seller-analytics-readonly-gateway'
import { getSupabaseAdminClient } from "../supabase-admin"
import { getEbaySellerAccountScopeConfiguration } from "./ebay-seller-account-scope"
import { preflightEbayAccountPoliciesReadonly, readEbaySellerStoreSubscriptionReadonly } from "./ebay-account-policy-readonly-gateway"
import { readEbayFeePerformanceReadonlyV1 } from "./ebay-seller-analytics-readonly-gateway"
import { readCurrentOfficialFeePolicyV1 } from "./ebay-fee-policy-readonly-v1"
import { readSellingFeeTaxPolicyV1 } from "./ebay-selling-fee-tax-policy-v1"
import { resolveEbayFeeStoreContextV1, feeContextSafeErrorV1 } from "./ebay-fee-context-domain-v1"
import { getEbayBaseApplicationTokenV1 } from "./ebay-seller-keyword-demand-gateway"
import { keywordRecord as record } from "../seller-os/keyword-intelligence-handoff-v1"
import { exactCategoryAncestryV1, currentCategoryAncestryV1, reusablePackageFeeContextV1 } from "./ebay-package-category-fee-binding-v1"
import { knownBuyerShippingV1 } from "../seller-os/publication-prevalidation-boundary-v1"

async function readCategoryAncestry(categoryId: string, query: string) {
  const token=await getEbayBaseApplicationTokenV1()
  const read=async(url: URL)=>{
    const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`,"Accept-Language":"en-US"},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000)})
    if(!r.ok)throw Error(`EBAY_CATEGORY_ANCESTRY_${r.status}`)
    const text=await r.text();if(text.length>500000)throw Error("CATEGORY_ANCESTRY_NOT_BOUNDED")
    return JSON.parse(text)
  }
  const tree=await read(new URL("https://api.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US"))
  if(!/^\d+$/.test(String(tree.categoryTreeId)))return null
  const url=new URL(`https://api.ebay.com/commerce/taxonomy/v1/category_tree/${tree.categoryTreeId}/get_category_suggestions`)
  url.searchParams.set("q",query.slice(0,350))
  return exactCategoryAncestryV1(await read(url),categoryId,String(tree.categoryTreeId),new Date())
}

// Account authority is read in its existing authenticated runtime, without a
// fabricated ItemID or a GetItem for an unrelated LIVE product. No writes.
export async function readEbayPackageFeeContextReadonlyV1(packageId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(packageId)) throw Error("EXACT_PACKAGE_REQUIRED")
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) throw Error("EBAY_FEE_ACCOUNT_BINDING_REQUIRED")
  const db = getSupabaseAdminClient()
  const p = await db.from("ebay_listing_packages").select("id,account_key,opportunity_id,title:package_data->>title,category:package_data->>categoryId,price:package_data->pricing->targetPrice")
    .eq("id", packageId).eq("account_key", accountKey).limit(1).abortSignal(AbortSignal.timeout(8000)).maybeSingle()
  if (p.error || !p.data) throw Error("EXACT_PACKAGE_UNAVAILABLE")
  const q = await db.from("ebay_luna_opportunity_queue").select("supplier_product_id,supplier_variant_id,supplier_sku,product_title,assessment")
    .eq("id", p.data.opportunity_id).limit(1).abortSignal(AbortSignal.timeout(8000)).maybeSingle()
  if (q.error || !q.data) throw Error("EXACT_PRODUCT_UNAVAILABLE")
  const head = await db.from("seller_os_ebay_fee_bindings_v1").select("authority_id")
    .eq("binding_key", `${accountKey}:package:${packageId}`).limit(1).abortSignal(AbortSignal.timeout(8000)).maybeSingle()
  const prior = head.data?.authority_id ? await db.from("seller_os_ebay_fee_authorities_v1").select("authority")
    .eq("marketplace_account_key",accountKey).eq("authority_id",head.data.authority_id).limit(1)
    .abortSignal(AbortSignal.timeout(8000)).maybeSingle() : null
  const cached = reusablePackageFeeContextV1(record(prior?.data?.authority).preSaleSourceContextV1,
    {accountKey,packageId,productId:q.data.supplier_product_id,variantId:q.data.supplier_variant_id,
      sku:q.data.supplier_sku,categoryId:String(p.data.category),price:p.data.price},new Date())
  const productTruthTitle=String(record(record(q.data.assessment).productTruth).title ?? q.data.product_title ?? "").trim()
  if(!productTruthTitle)throw Error("CURRENT_PRODUCT_TRUTH_TITLE_REQUIRED")
  const canonical=record(record(q.data.assessment).canonicalMarketplaceReadinessV1)
  const results = await Promise.allSettled([cached ? cached.subscription : readEbaySellerStoreSubscriptionReadonly(),
    cached ? cached.accountPerformance : readEbayFeePerformanceReadonlyV1(),
    cached ? cached.officialFeePolicySnapshot : readCurrentOfficialFeePolicyV1(),
    cached ? cached.feeTaxPolicy : readSellingFeeTaxPolicyV1(),
    cached && currentCategoryAncestryV1(cached.categoryAuthority,p.data.category,new Date()) ? cached.categoryAuthority :
      readCategoryAncestry(String(p.data.category),productTruthTitle),
    preflightEbayAccountPoliciesReadonly({
      fulfillmentPolicyId:String(canonical.fulfillmentPolicyId??""),
      paymentPolicyId:String(canonical.paymentPolicyId??""),
      returnPolicyId:String(canonical.returnPolicyId??""),
      merchantLocationKey:String(canonical.merchantLocationKey??""),
    })])
  const component = (i: number) => { const r = results[i]; return r.status === "fulfilled" ? r.value :
    { status: "UNPROVEN", errorCode: feeContextSafeErrorV1(r.reason) } }
  const categoryAuthority=record(component(4))
  const freshSupplement=(value:unknown)=>{const d=Date.parse(String(record(value).observedAt));return Number.isFinite(d)&&d<=Date.now()&&Date.now()-d<6*3600000}
  const pending=await Promise.allSettled([cached && freshSupplement(cached.payoutCurrencyAuthority)?cached.payoutCurrencyAuthority:readPublicationPayoutCurrencyV1(),
    cached && freshSupplement(cached.currentCategoryServiceAuthority)?cached.currentCategoryServiceAuthority:currentCategoryAncestryV1(categoryAuthority,p.data.category,new Date())
      ? readCurrentCategoryServiceMetricsV1(String(p.data.category),categoryAuthority.ancestorIds as string[]) : null])
  const payoutResult=pending[0].status==='fulfilled'?pending[0].value:null
  const payoutAudit=record(payoutResult).oauthError==='invalid_scope' &&
    (!freshSupplement(record(payoutResult).scopeAudit)||record(record(payoutResult).scopeAudit).version!==PAYOUT_GRANT_DIAGNOSTIC_V2)
    ? {...record(payoutResult),scopeAudit:await inspectPublicationPayoutGrantV1()} : payoutResult
  const auditedPayout=record(record(payoutAudit).scopeAudit).payout
  const resolvedPayout=record(auditedPayout).status==='PROVEN'?{...record(auditedPayout),scopeAudit:record(payoutAudit).scopeAudit}:payoutAudit
  const payout={...record(resolvedPayout),scopeAudit:resolvePayoutGrantWithFundsReadV1(record(resolvedPayout).scopeAudit,resolvedPayout)}
  const service=pending[1].status==='fulfilled'?pending[1].value:null
  const policyPreflight=record(component(5))
  const fulfillmentFeeBasis=record(policyPreflight.fulfillmentFeeBasis)
  const buyerShippingCharge=knownBuyerShippingV1(fulfillmentFeeBasis)
  return { contractVersion: "SELLER_OS_PACKAGE_FEE_CONTEXT_READONLY_V1", packageId,
    payoutCurrencyAuthority:payout,currentCategoryServiceAuthority:service, marketplaceAccountKey: accountKey,
    observedAt: cached?.observedAt ?? new Date().toISOString(), accountContextReused: Boolean(cached), identity: { itemId: null, packageId, sku: q.data.supplier_sku,
      productId: q.data.supplier_product_id, variantId: q.data.supplier_variant_id, marketplace: "EBAY_US" },
    listing: { categoryId: p.data.category, price: p.data.price, currency: "USD", saleFormat: "FIXED_PRICE",
      buyerShippingCharge,buyerShippingCurrency:buyerShippingCharge===null?null:"USD",
      buyerShippingChargeStatus:buyerShippingCharge===null?"UNPROVEN":"AVAILABLE",
      buyerShippingChargeBasis:buyerShippingCharge===null?null:"EXACT_OFFICIAL_FULFILLMENT_POLICY" },
    fulfillmentFeeBasis,
    resolvedStoreContext: resolveEbayFeeStoreContextV1(component(0), component(1)), subscription: component(0),
    accountPerformance: service && record(service).httpStatus===200 ? {...record(component(1)),serviceMetrics:record(service).profile} : component(1), officialFeePolicySnapshot: component(2), feeTaxPolicy: component(3), categoryAuthority: component(4),
    status: "CONTEXT_ONLY_NOT_FEE_AUTHORITY", safety: { readOnly: true, marketplaceWrites: 0, databaseWrites: 0 } }
}
