import { readManualListingFromTradingApi } from "./ebay-manual-listing-trading-readonly"
import { readEbaySellerStoreSubscriptionReadonly } from "./ebay-account-policy-readonly-gateway"
import { readEbayFeePerformanceReadonlyV1 } from "./ebay-seller-analytics-readonly-gateway"
import { feeContextSafeErrorV1, resolveEbayFeeStoreContextV1 } from "./ebay-fee-context-domain-v1"
import { getEbaySellerAccountScopeConfiguration } from "./ebay-seller-account-scope"

/** Internal diagnostic: fixed read-only sources for one verified LIVE listing. */
export async function readEbayFeeContextReadonlyV1(itemId: string) {
  if (!/^\d{9,19}$/.test(itemId)) throw new Error("EBAY_FEE_ITEM_ID_REQUIRED")
  const account = getEbaySellerAccountScopeConfiguration()
  if (!account.accountKey) throw new Error("EBAY_FEE_ACCOUNT_BINDING_REQUIRED")
  const listing = await readManualListingFromTradingApi(itemId)
  if (listing.ownership !== "verified" || listing.itemId !== itemId || !listing.ebaySku) {
    throw new Error("EBAY_FEE_EXACT_LIVE_BINDING_REQUIRED")
  }
  const results = await Promise.allSettled([
    readEbaySellerStoreSubscriptionReadonly(), readEbayFeePerformanceReadonlyV1(),
  ])
  const component = (index: number) => {
    const result = results[index]
    return result.status === "fulfilled" ? result.value :
      { status: "UNPROVEN", errorCode: feeContextSafeErrorV1(result.reason) }
  }
  return {
    contractVersion: "SELLER_OS_EBAY_FEE_CONTEXT_READONLY_V1",
    status: "CONTEXT_ONLY_NOT_FEE_AUTHORITY", observedAt: new Date().toISOString(),
    identity: { itemId, sku: listing.ebaySku, accountBindingExact: true, marketplace: "EBAY_US" },
    listing: { categoryId: listing.safeDefaults.categoryId ?? null,
      price: listing.price, currency: listing.currency, observedAt: listing.observedAt,
      buyerShippingCharge: listing.buyerShippingCharge, buyerShippingCurrency: listing.buyerShippingCurrency,
      buyerShippingChargeStatus: listing.buyerShippingChargeStatus, buyerShippingChargeBasis: listing.buyerShippingChargeBasis,
      source: "EBAY_TRADING_GET_ITEM" },
    subscription: { source: "https://api.ebay.com/sell/account/v1/subscription", evidence: component(0) },
    resolvedStoreContext: resolveEbayFeeStoreContextV1(component(0), component(1)),
    accountPerformance: component(1),
    feeAmount: null, preSaleFeeEstimateProven: false,
    safety: { readOnly: true, databaseWrites: 0, marketplaceWrites: 0, ebayAdsWrites: 0,
      credentialsIncluded: false, buyerPiiIncluded: false, rawPayloadIncluded: false },
  }
}
