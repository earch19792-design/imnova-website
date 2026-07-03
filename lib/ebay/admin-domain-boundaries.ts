type DomainBoundary = {
  name: string
  humanLabel: string
  responsibility: string[]
  mustNotDo: string[]
  currentHeavyFiles: string[]
  recommendedFutureRoute: string
  recommendedFutureComponentsPath: string
  recommendedFutureLibPath: string
}

const queuePriority =
  "Sin stock → Proteger → Revisar stock → Margen → Bloqueados → Vender ahora → Monitorear"

const marketRadarBoundary: DomainBoundary = {
  name: "Market Radar",
  humanLabel: "Descubrir oportunidades",
  responsibility: [
    "Discover market signals.",
    "Track stock, out of stock, discounts and price changes.",
    "Surface alerts and possible candidates.",
  ],
  mustNotDo: [
    "Prepare listings.",
    "Decide title or description.",
    "Publish.",
    "Create drafts.",
    "Recalculate listing readiness.",
  ],
  currentHeavyFiles: [
    "app/api/admin/market-radar/route.ts",
    "components/admin/market-radar-panel.tsx",
    "app/admin/page.tsx",
  ],
  recommendedFutureRoute: "/admin/market-radar",
  recommendedFutureComponentsPath:
    "components/admin/market-radar",
  recommendedFutureLibPath:
    "lib/market-radar",
}

const ebaySellerOsBoundary: DomainBoundary = {
  name: "eBay Seller OS",
  humanLabel: "Operar colas del vendedor",
  responsibility: [
    "Run the seller operating flow.",
    `Organize queues: ${queuePriority}.`,
    "Route sell now, stock review, margin review, blocked, protect, monitor and rescue decisions.",
  ],
  mustNotDo: [
    "Generate full listing content.",
    "Recalculate product facts.",
    "Publish.",
    "Create drafts.",
  ],
  currentHeavyFiles: [
    "components/admin/ebay-winner-pipeline-panel.tsx",
    "lib/ebay-winner-pipeline",
    "tools/ebay-winner-pipeline-tests.mjs",
  ],
  recommendedFutureRoute: "/admin/ebay-seller-os",
  recommendedFutureComponentsPath:
    "components/admin/ebay-seller-os",
  recommendedFutureLibPath:
    "lib/ebay/seller-os",
}

const ebayListingBoundary: DomainBoundary = {
  name: "eBay Listing",
  humanLabel: "Preparar listing",
  responsibility: [
    "Prepare title, description and item specifics.",
    "Plan main image and six secondary images.",
    "Prepare image prompts, payload dry run, blockers and review gates.",
  ],
  mustNotDo: [
    "Decide if the product is profitable.",
    "Duplicate profitability truth.",
    "Recalculate margin, demand or competition.",
    "Publish.",
    "Create a real draft.",
  ],
  currentHeavyFiles: [
    "app/admin/ebay-listing-package/page.tsx",
    "lib/ebay",
    "lib/ebay-listing-prompts",
    "tools/ebay-winner-pipeline-tests.mjs",
  ],
  recommendedFutureRoute: "/admin/ebay-listing",
  recommendedFutureComponentsPath:
    "components/admin/ebay-listing",
  recommendedFutureLibPath:
    "lib/ebay/listing",
}

export function getMarketRadarBoundary() {
  return marketRadarBoundary
}

export function getEbaySellerOsBoundary() {
  return ebaySellerOsBoundary
}

export function getEbayListingBoundary() {
  return ebayListingBoundary
}

export function getEbayDomainMigrationPlan() {
  return [
    "A. Documentation + lightweight hubs.",
    "B. Navigation separation.",
    "C. Extract UI subcomponents.",
    "D. Move pure modules by domain.",
    "E. Split tests by domain.",
    "F. Disk IO optimization with summary endpoints/views.",
  ]
}

export function getEbayAdminDomainBoundaries() {
  return {
    domainBoundaryVersion:
      "EBAY_ADMIN_DOMAIN_BOUNDARIES_V1",
    status:
      "DOMAIN_BOUNDARIES_DOCUMENTED_LIGHTWEIGHT_HUBS_READY",
    migrationMode:
      "NO_HEAVY_LOGIC_MOVED_YET",
    performanceRule:
      "Each module should read only what it needs.",
    domains: [
      marketRadarBoundary,
      ebaySellerOsBoundary,
      ebayListingBoundary,
    ],
    lightweightHubs: {
      "/admin/market-radar": {
        lightweight: true,
        loadsHeavyPanels: false,
        performsSupabaseRead: false,
      },
      "/admin/ebay-seller-os": {
        lightweight: true,
        loadsHeavyPanels: false,
        performsSupabaseRead: false,
      },
      "/admin/ebay-listing": {
        lightweight: true,
        loadsHeavyPanels: false,
        performsSupabaseRead: false,
      },
    },
    safetyFlags: {
      documentationOnlyPlusLightweightHubs: true,
      heavyLogicMoved: false,
      heavyPanelsImportedIntoHubs: false,
      supabaseWriteUsed: false,
      migrationCreated: false,
      ebayApiUsed: false,
      realDraftCreated: false,
      publishedToEbay: false,
    },
  }
}

export function getBlockedDomainSeparationResponse() {
  return {
    status:
      "DOMAIN_SEPARATION_BLOCKED_FOR_HEAVY_LOGIC",
    reason:
      "This loop documents boundaries and adds lightweight hubs only.",
    heavyLogicMoved: false,
    heavyPanelsImportedIntoHubs: false,
    queuePriority,
  }
}
