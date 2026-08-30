type JsonRecord = Record<string, unknown>

const MARKETPLACE_ID = "EBAY_US"

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

export function parseEbaySellerStoreSubscriptionReadonly(value: unknown) {
  const body = record(value)
  const subscriptions = Array.isArray(body.subscriptions)
    ? body.subscriptions.map(record)
    : []
  const storeSubscriptions = subscriptions.flatMap((item) => {
    const marketplaceId = String(item.marketplaceId ?? "").trim().toUpperCase()
    const subscriptionType = String(item.subscriptionType ?? "").trim().toUpperCase()
    const subscriptionLevel = String(item.subscriptionLevel ?? "").trim().toUpperCase()
    if (marketplaceId !== MARKETPLACE_ID || subscriptionType !== "STORE") return []
    if (!/^(STARTER|BASIC|PREMIUM|ANCHOR|ENTERPRISE)$/.test(subscriptionLevel)) {
      return [{ marketplaceId, subscriptionType, subscriptionLevel: "UNPROVEN" as const }]
    }
    return [{ marketplaceId, subscriptionType, subscriptionLevel }]
  })
  if (storeSubscriptions.length > 1) {
    return {
      status: "AMBIGUOUS" as const,
      marketplaceId: MARKETPLACE_ID,
      storeSubscriptionLevel: null,
      matchingSubscriptionCount: storeSubscriptions.length,
    }
  }
  if (storeSubscriptions.length === 0) {
    return {
      status: "NO_STORE" as const,
      marketplaceId: MARKETPLACE_ID,
      storeSubscriptionLevel: "NO_STORE" as const,
      matchingSubscriptionCount: 0,
    }
  }
  const level = storeSubscriptions[0]?.subscriptionLevel ?? "UNPROVEN"
  return {
    status: level === "UNPROVEN" ? "UNPROVEN" as const : "AVAILABLE" as const,
    marketplaceId: MARKETPLACE_ID,
    storeSubscriptionLevel: level,
    matchingSubscriptionCount: 1,
  }
}
