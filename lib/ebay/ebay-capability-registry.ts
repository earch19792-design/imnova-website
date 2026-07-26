export const EBAY_CAPABILITY_REGISTRY_VERSION =
  "EBAY_CAPABILITY_REGISTRY_V1_2026_07_26" as const

export const EBAY_OAUTH_BASE_SCOPE =
  "https://api.ebay.com/oauth/api_scope" as const
export const EBAY_ACCOUNT_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly" as const
export const EBAY_INVENTORY_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly" as const
export const EBAY_INVENTORY_WRITE_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.inventory" as const
export const EBAY_MARKETING_WRITE_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.marketing" as const
export const EBAY_IDENTITY_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly" as const
export const EBAY_FULFILLMENT_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly" as const
export const EBAY_FULFILLMENT_WRITE_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment" as const
export const EBAY_ANALYTICS_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly" as const
export const EBAY_MARKETPLACE_INSIGHTS_SCOPE =
  "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights" as const

export const EBAY_READONLY_SCOPES = [
  EBAY_OAUTH_BASE_SCOPE,
  EBAY_ACCOUNT_READONLY_SCOPE,
  EBAY_INVENTORY_READONLY_SCOPE,
] as const

export const EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES = [
  EBAY_OAUTH_BASE_SCOPE,
  EBAY_FULFILLMENT_READONLY_SCOPE,
] as const

export const EBAY_PUBLICATION_OAUTH_SCOPES = [
  EBAY_OAUTH_BASE_SCOPE,
  EBAY_INVENTORY_WRITE_SCOPE,
  EBAY_MARKETING_WRITE_SCOPE,
  EBAY_ACCOUNT_READONLY_SCOPE,
  EBAY_IDENTITY_READONLY_SCOPE,
] as const

export const EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES = [
  EBAY_OAUTH_BASE_SCOPE,
  EBAY_FULFILLMENT_WRITE_SCOPE,
] as const

export const EBAY_SELLER_ANALYTICS_READONLY_OAUTH_SCOPES = [
  EBAY_OAUTH_BASE_SCOPE,
  EBAY_ANALYTICS_READONLY_SCOPE,
] as const

export const EBAY_CAPABILITY_IMPLEMENTATION_STATES = [
  "REAL",
  "PREFLIGHT_ONLY",
  "FIXTURE",
  "NOT_IMPLEMENTED",
] as const

export type EbayCapabilityImplementationState =
  typeof EBAY_CAPABILITY_IMPLEMENTATION_STATES[number]

type CapabilityFreshnessPolicy = {
  maxAgeMinutes: number | null
  basis:
    | "LAST_SUCCESSFUL_OFFICIAL_OBSERVATION"
    | "EFFECT_BOUND_PREFLIGHT"
    | "NOT_APPLICABLE"
}

type CommonCapability = {
  id: string
  label: string
  implementationState: EbayCapabilityImplementationState
  apiFamily: string
  endpointTemplates: readonly string[]
  requiredScopes: readonly string[]
  freshnessPolicy: CapabilityFreshnessPolicy
  producer: string
  consumers: readonly string[]
}

type ReadCapability = CommonCapability & {
  access: "READ"
  requiredFlags: readonly string[]
  ledgers: readonly string[]
  reconciliation: string | null
}

type WriteCapability = CommonCapability & {
  access: "WRITE"
  requiredFlags: readonly [string, ...string[]]
  ledgers: readonly [string, ...string[]]
  reconciliation: string
}

export type EbayCapabilityRegistryEntry =
  | ReadCapability
  | WriteCapability

const observed = (maxAgeMinutes: number): CapabilityFreshnessPolicy => ({
  maxAgeMinutes,
  basis: "LAST_SUCCESSFUL_OFFICIAL_OBSERVATION",
})

const effectBound = (): CapabilityFreshnessPolicy => ({
  maxAgeMinutes: null,
  basis: "EFFECT_BOUND_PREFLIGHT",
})

const notApplicable = (): CapabilityFreshnessPolicy => ({
  maxAgeMinutes: null,
  basis: "NOT_APPLICABLE",
})

export const EBAY_CAPABILITY_REGISTRY = [
  {
    id: "MARKET_RESEARCH_BROWSE",
    label: "Browse market research",
    implementationState: "REAL",
    access: "READ",
    apiFamily: "BUY_BROWSE",
    endpointTemplates: [
      "/buy/browse/v1/item_summary/search",
      "/buy/browse/v1/item/{itemId}",
    ],
    requiredScopes: [EBAY_OAUTH_BASE_SCOPE],
    freshnessPolicy: observed(1_440),
    producer: "ebay-seller-keyword-demand-gateway",
    consumers: ["market-radar", "competitor-watch", "product-facts"],
    requiredFlags: [],
    ledgers: ["marketplace_product_fact_source_snapshots"],
    reconciliation: null,
  },
  {
    id: "MARKET_RESEARCH_CATALOG_TAXONOMY",
    label: "Catalog and Taxonomy research",
    implementationState: "REAL",
    access: "READ",
    apiFamily: "COMMERCE_CATALOG_TAXONOMY",
    endpointTemplates: [
      "/commerce/catalog/v1_beta/product_summary/search",
      "/commerce/taxonomy/v1/get_default_category_tree_id",
      "/commerce/taxonomy/v1/category_tree/{treeId}/get_category_suggestions",
      "/commerce/taxonomy/v1/category_tree/{treeId}/get_item_aspects_for_category",
    ],
    requiredScopes: [EBAY_OAUTH_BASE_SCOPE],
    freshnessPolicy: observed(10_080),
    producer: "ebay-seller-keyword-demand-gateway",
    consumers: ["product-facts", "listing-package", "final-qa"],
    requiredFlags: [],
    ledgers: ["marketplace_product_fact_source_snapshots"],
    reconciliation: null,
  },
  {
    id: "MARKETPLACE_INSIGHTS_SOLD_SEARCH",
    label: "Marketplace Insights sold search",
    implementationState: "PREFLIGHT_ONLY",
    access: "READ",
    apiFamily: "BUY_MARKETPLACE_INSIGHTS",
    endpointTemplates: [
      "/buy/marketplace-insights/v1_beta/item_sales/search",
    ],
    requiredScopes: [
      EBAY_OAUTH_BASE_SCOPE,
      EBAY_MARKETPLACE_INSIGHTS_SCOPE,
    ],
    freshnessPolicy: observed(1_440),
    producer: "ebay-marketplace-insights-preflight",
    consumers: ["oauth-preflight"],
    requiredFlags: ["PREVIEW_OR_STAGING_ONLY"],
    ledgers: [],
    reconciliation: null,
  },
  {
    id: "SELLER_ACCOUNT_POLICY_READ",
    label: "Seller account and policy read",
    implementationState: "REAL",
    access: "READ",
    apiFamily: "SELL_ACCOUNT",
    endpointTemplates: [
      "/sell/account/v1/program/get_opted_in_programs",
      "/sell/account/v1/privilege",
      "/sell/account/v1/fulfillment_policy",
      "/sell/account/v1/payment_policy",
      "/sell/account/v1/return_policy",
      "/sell/inventory/v1/location",
    ],
    requiredScopes: EBAY_READONLY_SCOPES,
    freshnessPolicy: observed(1_440),
    producer: "ebay-account-policy-readonly-gateway",
    consumers: ["account-policy-profile", "listing-preflight"],
    requiredFlags: [],
    ledgers: ["ebay_account_policy_profiles"],
    reconciliation: null,
  },
  {
    id: "ACTIVE_LISTING_SYNC",
    label: "Active listing inventory and offer sync",
    implementationState: "REAL",
    access: "READ",
    apiFamily: "SELL_INVENTORY_TRADING",
    endpointTemplates: [
      "/sell/inventory/v1/inventory_item",
      "/sell/inventory/v1/offer",
      "/ws/api.dll#GetUser",
    ],
    requiredScopes: EBAY_READONLY_SCOPES,
    freshnessPolicy: observed(60),
    producer: "ebay-active-listing-readonly-sync",
    consumers: ["active-listings", "listing-protection", "commercial-monitor"],
    requiredFlags: [],
    ledgers: ["ebay_active_listing_sync_runs", "ebay_active_listings"],
    reconciliation: null,
  },
  {
    id: "SELLER_TRAFFIC_ANALYTICS",
    label: "Seller traffic analytics",
    implementationState: "REAL",
    access: "READ",
    apiFamily: "SELL_ANALYTICS",
    endpointTemplates: ["/sell/analytics/v1/traffic_report"],
    requiredScopes: EBAY_SELLER_ANALYTICS_READONLY_OAUTH_SCOPES,
    freshnessPolicy: observed(360),
    producer: "ebay-seller-analytics-readonly-gateway",
    consumers: ["commercial-monitor", "category-performance-learning"],
    requiredFlags: [],
    ledgers: ["listing_commercial_snapshots"],
    reconciliation: null,
  },
  {
    id: "SELLER_ORDERS_READ",
    label: "Seller orders read",
    implementationState: "REAL",
    access: "READ",
    apiFamily: "SELL_FULFILLMENT",
    endpointTemplates: [
      "/sell/fulfillment/v1/order",
      "/sell/fulfillment/v1/order/{orderId}",
    ],
    requiredScopes: EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES,
    freshnessPolicy: observed(5),
    producer: "ebay-commercial-readers",
    consumers: ["commercial-monitor", "fulfillment-tasks", "immediate-alerts"],
    requiredFlags: [],
    ledgers: ["ebay_commercial_orders", "ebay_commercial_order_lines"],
    reconciliation: null,
  },
  {
    id: "TRADING_IDENTITY_WATCHERS_MESSAGES",
    label: "Trading identity, watchers and messages",
    implementationState: "REAL",
    access: "READ",
    apiFamily: "TRADING",
    endpointTemplates: [
      "/ws/api.dll#GetUser",
      "/ws/api.dll#GetItem",
      "/ws/api.dll#GetMemberMessages",
    ],
    requiredScopes: [EBAY_OAUTH_BASE_SCOPE],
    freshnessPolicy: observed(10),
    producer: "ebay-commercial-readers",
    consumers: ["identity-verification", "commercial-monitor"],
    requiredFlags: [],
    ledgers: ["ebay_listing_identity_verifications", "commercial_events"],
    reconciliation: null,
  },
  {
    id: "INVENTORY_ITEM_OFFER_DRAFT_WRITE",
    label: "Inventory Item and unpublished Offer write",
    implementationState: "REAL",
    access: "WRITE",
    apiFamily: "SELL_INVENTORY",
    endpointTemplates: [
      "/sell/inventory/v1/inventory_item/{sku}",
      "/sell/inventory/v1/offer",
    ],
    requiredScopes: EBAY_PUBLICATION_OAUTH_SCOPES,
    freshnessPolicy: effectBound(),
    producer: "ebay-draft-only-gateway",
    consumers: ["draft-only-admin"],
    requiredFlags: [
      "EBAY_DRAFT_ONLY_WRITES_ENABLED",
      "EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED",
      "PREVIEW_BRANCH_ALLOWLIST",
    ],
    ledgers: ["ebay_draft_only_execution_ledger"],
    reconciliation: "GET Inventory Item and Offer by exact account and SKU before retry",
  },
  {
    id: "PUBLISH_OFFER_WRITE",
    label: "Publish Offer",
    implementationState: "REAL",
    access: "WRITE",
    apiFamily: "SELL_INVENTORY",
    endpointTemplates: ["/sell/inventory/v1/offer/{offerId}/publish"],
    requiredScopes: EBAY_PUBLICATION_OAUTH_SCOPES,
    freshnessPolicy: effectBound(),
    producer: "ebay-draft-only-gateway",
    consumers: ["authorized-publication-admin", "commercial-monitor"],
    requiredFlags: [
      "EBAY_DRAFT_ONLY_WRITES_ENABLED",
      "EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED",
      "EXACT_HUMAN_PUBLICATION_CONFIRMATION",
    ],
    ledgers: ["ebay_authorized_listing_publications"],
    reconciliation: "Read Offer, Inventory Item and listing identity; never blind-republish",
  },
  {
    id: "MERCHANT_LOCATION_WRITE",
    label: "One-shot merchant location write",
    implementationState: "REAL",
    access: "WRITE",
    apiFamily: "SELL_INVENTORY",
    endpointTemplates: ["/sell/inventory/v1/location/{merchantLocationKey}"],
    requiredScopes: [
      EBAY_OAUTH_BASE_SCOPE,
      EBAY_INVENTORY_WRITE_SCOPE,
    ],
    freshnessPolicy: effectBound(),
    producer: "ebay-merchant-location-one-shot-gateway",
    consumers: ["listing-preflight"],
    requiredFlags: [
      "ONE_SHOT_ADMIN_CONFIRMATION",
      "PREVIEW_ENVIRONMENT_BOUNDARY",
    ],
    ledgers: ["EBAY_MERCHANT_LOCATION_ONE_SHOT_OAUTH_HANDOFF"],
    reconciliation: "Exact GET readback for merchant location key after POST",
  },
  {
    id: "ACTIVE_LISTING_REVISION_WRITE",
    label: "Active listing title, image and commercial revision",
    implementationState: "REAL",
    access: "WRITE",
    apiFamily: "TRADING",
    endpointTemplates: [
      "/ws/api.dll#ReviseFixedPriceItem",
      "/ws/api.dll#EndFixedPriceItem",
      "/ws/api.dll#UploadSiteHostedPictures",
    ],
    requiredScopes: [EBAY_OAUTH_BASE_SCOPE],
    freshnessPolicy: effectBound(),
    producer: "active-listing-revision-services",
    consumers: ["seller-command-center", "commercial-monitor"],
    requiredFlags: [
      "EXACT_ADMIN_CONFIRMATION",
      "PREVIEW_ENVIRONMENT_BOUNDARY",
    ],
    ledgers: [
      "ebay_active_listing_title_revision_executions",
      "ebay_active_listing_image_revision_executions",
      "ebay_commercial_improvement_executions",
    ],
    reconciliation: "Trading GetItem exact pre/post comparison; uncertain outcome is not retried blind",
  },
  {
    id: "SELLER_MARKETING_PROMOTION_WRITE",
    label: "Seller Marketing promotion write",
    implementationState: "REAL",
    access: "WRITE",
    apiFamily: "SELL_MARKETING",
    endpointTemplates: [
      "/sell/marketing/v1/ad_campaign",
      "/sell/marketing/v1/ad_campaign/{campaignId}/ad",
    ],
    requiredScopes: [
      EBAY_OAUTH_BASE_SCOPE,
      EBAY_MARKETING_WRITE_SCOPE,
    ],
    freshnessPolicy: effectBound(),
    producer: "ebay-commercial-improvement-action-service",
    consumers: ["commercial-monitor-admin"],
    requiredFlags: [
      "EXACT_ADMIN_CONFIRMATION",
      "CONTROLLED_RISK_POLICY",
      "PREVIEW_ENVIRONMENT_BOUNDARY",
    ],
    ledgers: ["ebay_commercial_improvement_executions"],
    reconciliation: "Find campaign and ad by exact listing reference before retry",
  },
  {
    id: "FULFILLMENT_TRACKING_WRITE",
    label: "Fulfillment tracking write",
    implementationState: "REAL",
    access: "WRITE",
    apiFamily: "SELL_FULFILLMENT",
    endpointTemplates: [
      "/sell/fulfillment/v1/order/{orderId}/shipping_fulfillment",
      "/sell/fulfillment/v1/order/{orderId}/shipping_fulfillment/{fulfillmentId}",
    ],
    requiredScopes: EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES,
    freshnessPolicy: effectBound(),
    producer: "ebay-fulfillment-tracking-adapter",
    consumers: ["fulfillment-v1b-submitter", "fulfillment-v1b-reconciler"],
    requiredFlags: [
      "EBAY_FULFILLMENT_TRACKING_OAUTH_ENABLED",
      "EBAY_FULFILLMENT_TRACKING_WRITE_ENABLED",
      "MARKETPLACE_FULFILLMENT_REAL_ADAPTER_ENABLED",
    ],
    ledgers: ["marketplace_fulfillment_tasks", "marketplace_fulfillment_shipments"],
    reconciliation: "GET order fulfillment by exact order and fulfillment identity before retry",
  },
  {
    id: "B2_CONTROLLED_DRAFT_FIXTURE",
    label: "B2 controlled draft fixture",
    implementationState: "FIXTURE",
    access: "READ",
    apiFamily: "LOCAL_FIXTURE",
    endpointTemplates: [],
    requiredScopes: [],
    freshnessPolicy: notApplicable(),
    producer: "ebay-b2-run-controlled-write-draft-only-run",
    consumers: ["dry-run-tests"],
    requiredFlags: [],
    ledgers: [],
    reconciliation: null,
  },
  {
    id: "FULFILLMENT_V1A_SIMULATOR",
    label: "Fulfillment V1A simulator",
    implementationState: "FIXTURE",
    access: "READ",
    apiFamily: "LOCAL_SIMULATOR",
    endpointTemplates: [],
    requiredScopes: [],
    freshnessPolicy: notApplicable(),
    producer: "marketplace-fulfillment-v1a-service",
    consumers: ["fulfillment-tests"],
    requiredFlags: [],
    ledgers: [],
    reconciliation: null,
  },
  {
    id: "EBAY_NOTIFICATION_WEBHOOK",
    label: "eBay notification webhook",
    implementationState: "NOT_IMPLEMENTED",
    access: "READ",
    apiFamily: "COMMERCE_NOTIFICATION",
    endpointTemplates: [],
    requiredScopes: [],
    freshnessPolicy: notApplicable(),
    producer: "none",
    consumers: ["polling-remains-canonical"],
    requiredFlags: [],
    ledgers: [],
    reconciliation: null,
  },
] as const satisfies readonly EbayCapabilityRegistryEntry[]

function oneDecimal(value: number) {
  return Math.round(value * 10) / 10
}

/**
 * Each status percentage is count(status) / total registered capabilities * 100.
 * The denominator includes REAL, PREFLIGHT_ONLY, FIXTURE and NOT_IMPLEMENTED so
 * a fixture cannot inflate production coverage. Results are rounded to 1 decimal.
 */
export function calculateEbayCapabilityImplementationPercentages(
  entries: readonly Pick<EbayCapabilityRegistryEntry, "implementationState">[] =
    EBAY_CAPABILITY_REGISTRY,
) {
  const denominator = entries.length
  const counts = Object.fromEntries(
    EBAY_CAPABILITY_IMPLEMENTATION_STATES.map((status) => [
      status,
      entries.filter((entry) => entry.implementationState === status).length,
    ]),
  ) as Record<EbayCapabilityImplementationState, number>
  const percentages = Object.fromEntries(
    EBAY_CAPABILITY_IMPLEMENTATION_STATES.map((status) => [
      status,
      denominator === 0 ? 0 : oneDecimal(counts[status] / denominator * 100),
    ]),
  ) as Record<EbayCapabilityImplementationState, number>
  return {
    denominator,
    counts,
    percentages,
    formula:
      "count(status) / total_capabilities * 100; all registry states are in the denominator; rounded to 1 decimal",
  }
}

export function getEbayCapabilityRegistryAdminProjection(
  generatedAt = new Date().toISOString(),
) {
  const implementation = calculateEbayCapabilityImplementationPercentages()
  return {
    registryVersion: EBAY_CAPABILITY_REGISTRY_VERSION,
    generatedAt,
    totalCapabilities: implementation.denominator,
    percentageFormula: implementation.formula,
    statusCounts: implementation.counts,
    statusPercentages: implementation.percentages,
    capabilities: EBAY_CAPABILITY_REGISTRY.map((entry) => ({
      ...entry,
      endpointTemplates: [...entry.endpointTemplates],
      requiredScopes: [...entry.requiredScopes],
      consumers: [...entry.consumers],
      requiredFlags: [...entry.requiredFlags],
      ledgers: [...entry.ledgers],
    })),
    safety: {
      credentialValuesIncluded: false,
      tokenValuesIncluded: false,
      secretValuesIncluded: false,
    },
  }
}
