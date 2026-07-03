export const EBAY_PRO_SUITE_MODULE_VERSION =
  "EBAY_PRO_STAGING_LAB_MODULE_IDENTITY_V1"

const primaryRoutes = [
  "/admin/ebay-pro",
  "/admin/market-radar",
  "/admin/ebay-seller-os",
  "/admin/ebay-listing",
  "/admin/ebay-listing-package",
  "/admin/ebay-listings",
  "/admin/ebay-image-generator",
]

const apiRoutes = [
  "/api/admin/market-radar",
  "/api/admin/ebay-winner-pipeline",
  "/api/admin/active-listing-risks",
  "/api/admin/ebay/oauth",
]

const modules = [
  "Market Radar eBay",
  "eBay Seller OS",
  "eBay Listing",
  "eBay Listing Package",
  "WhatsApp Seller Alerts future",
  "eBay Image Workflow future",
  "eBay Benchmark Intelligence future",
  "eBay Sandbox future",
]

const whatsappSellerAlertEvents = [
  "candidate_winner_detected",
  "product_out_of_stock",
  "review_margin",
  "evaluate_pack",
  "pack_candidate_ready",
  "listing_ready_for_review",
  "active_risk",
  "seller_action_required",
]

export function getEbayProSuiteRoutes() {
  return {
    primaryRoutes,
    apiRoutes,
  }
}

export function getEbayProSuiteDataBoundaries() {
  return {
    imnovaCore:
      "Products, community, store, campaigns and general analytics remain IMNOVA Core.",
    ebayPro:
      "Radar, Seller OS, Listing, candidates, snapshots and future benchmark/image/sandbox workflows remain eBay Pro.",
    sharedMinimum: [
      "product_id",
      "slug",
      "product_facts",
      "status_summary",
    ],
    forbiddenForEbayPro: [
      "pii",
      "full_community_data",
      "subscribers",
      "whatsapp_logs",
      "email_logs",
      "customer_data",
      "secrets",
    ],
  }
}

export function getEbayProSuiteRuntimePolicy() {
  return {
    production:
      "blocked",
    staging:
      "allowed",
    lab:
      "allowed",
    localVm:
      "allowed_for_heavy_processing_later_not_connected_in_this_loop",
    dryRunDefault:
      true,
    realDraftsAllowed:
      false,
    publicationAllowed:
      false,
  }
}

export function getEbayProSuiteCommunicationPolicy() {
  return {
    whatsapp:
      {
        channelType:
          "shared_controlled_communication_channel",
        coreAllowedInProduction:
          true,
        ebayProAllowedInProduction:
          false,
        ebayProAllowedInStagingLab:
          true,
        dryRunDefault:
          true,
        realSendAllowedInThisLoop:
          false,
        metaTemplateChangesAllowed:
          false,
        secretsDuplicated:
          false,
        realApiCallUsed:
          false,
        futureSellerAlertEvents:
          whatsappSellerAlertEvents,
      },
  }
}

export function getEbayProSuiteManifest() {
  return {
    moduleVersion:
      EBAY_PRO_SUITE_MODULE_VERSION,
    name:
      "eBay Professional Seller Suite",
    independentOperationalModule:
      true,
    physicallySeparateDatabase:
      false,
    separateRepo:
      false,
    stagingLabOnly:
      true,
    modules,
    routes:
      getEbayProSuiteRoutes(),
    runtimePolicy:
      getEbayProSuiteRuntimePolicy(),
    communicationPolicy:
      getEbayProSuiteCommunicationPolicy(),
    dataBoundaries:
      getEbayProSuiteDataBoundaries(),
    rules: [
      "Production does not execute eBay Pro.",
      "Staging validates eBay Pro in controlled dry-run mode.",
      "Local VM processes heavy load in a future phase.",
      "eBay Pro depends on IMNOVA Core only through minimum product facts.",
      "eBay Pro must not load community or PII.",
      "eBay Pro must not publish.",
      "eBay Pro must not create real drafts.",
      "WhatsApp stays a shared controlled channel for IMNOVA Core and future eBay Pro seller alerts.",
      "eBay Pro WhatsApp seller alerts are staging/lab-only and dry-run by default.",
    ],
  }
}
