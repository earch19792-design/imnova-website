import {
  getEbaySellerAccountScopeConfiguration,
} from "./ebay-seller-account-scope"

function publicSellerUserId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return normalized
    && normalized.length <= 200
    && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : null
}

export function getEbayPublicStorefront(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const scope = getEbaySellerAccountScopeConfiguration(environment)
  const sellerUserId = publicSellerUserId(scope.identity.expectedUserId)
  if (!scope.configured || !sellerUserId) {
    return {
      configured: false as const,
      marketplaceId: "EBAY_US" as const,
      reason: !scope.configured
        ? scope.reason ?? "EBAY_ACCOUNT_SCOPE_NOT_CONFIGURED"
        : "EBAY_PUBLIC_SELLER_USER_ID_REQUIRED",
      preferredShareUrl: null,
      sellerItemsUrl: null,
      sellerProfileUrl: null,
    }
  }
  const encodedSeller = encodeURIComponent(sellerUserId)
  const sellerItemsUrl =
    `https://www.ebay.com/sch/i.html?_ssn=${encodedSeller}`
  const sellerProfileUrl =
    `https://www.ebay.com/usr/${encodedSeller}`
  return {
    configured: true as const,
    marketplaceId: "EBAY_US" as const,
    reason: null,
    preferredShareUrl: sellerItemsUrl,
    sellerItemsUrl,
    sellerProfileUrl,
  }
}
