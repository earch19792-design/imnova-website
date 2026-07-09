export const MARKETPLACE_OS_DASHBOARD_VERSION =
  "IMNOVA_MARKETPLACE_OS_DASHBOARD_AMAZON_DECISION_CENTER_V1"

type SemanticStatus =
  | "GREEN"
  | "YELLOW"
  | "RED"

type ProductDecisionRow = {
  supplierSku: string
  productTitle: string
  brand: string
  catalogMatchType: string
  matchConfidenceScore: number
  restrictionRisk: SemanticStatus
  profitGuardDecision: string
  netProfitEstimate: number
  netMarginPercent: number
  roiPercent: number
  finalAsinRouteDecision: string
  canProceedToAmazonListingPackage: boolean
  sellerCentralWriteReady: boolean
  published: boolean
  blockedReasons: string[]
  warnings: string[]
  nextRecommendedAction: string
  semanticStatus: SemanticStatus
  statusColor: string
}

const productRows: ProductDecisionRow[] = [
  {
    supplierSku: "luna-portex:first_real_mini_scan:dm0628n",
    productTitle: "Glisten Dishwasher Detergent Booster & Freshener 28 oz",
    brand: "Glisten",
    catalogMatchType: "STRONG_BRAND_MODEL_SIZE_MATCH",
    matchConfidenceScore: 97,
    restrictionRisk: "YELLOW",
    profitGuardDecision: "LOW_MARGIN_WATCHLIST",
    netProfitEstimate: 3.58,
    netMarginPercent: 15.57,
    roiPercent: 49.72,
    finalAsinRouteDecision: "WATCHLIST_EXISTING_ASIN",
    canProceedToAmazonListingPackage: false,
    sellerCentralWriteReady: false,
    published: false,
    blockedReasons: [
      "hazmat review required",
      "chemical compliance review required",
      "manual Seller Central eligibility check required",
      "listing package blocked until margin watchlist is reviewed",
    ],
    warnings: [
      "missing UPC/GTIN",
      "existing ASIN match does not prove sell eligibility",
      "positive ROI cannot override compliance gates",
    ],
    nextRecommendedAction: "WATCHLIST_EXISTING_ASIN",
    semanticStatus: "YELLOW",
    statusColor: "amber",
  },
  {
    supplierSku: "luna-portex:first_real_mini_scan:gg-16000tsm",
    productTitle: "GoGreen Power 6-Outlet Side-Mount Wall Tap Adapter White GG-16000TSM",
    brand: "GoGreen Power",
    catalogMatchType: "CONFLICTING_MATCH",
    matchConfidenceScore: 78,
    restrictionRisk: "RED",
    profitGuardDecision: "BLOCKED_BY_RESTRICTION_GATE",
    netProfitEstimate: -1.05,
    netMarginPercent: -7.78,
    roiPercent: -18.75,
    finalAsinRouteDecision: "NEED_SELLER_CENTRAL_ELIGIBILITY_CHECK",
    canProceedToAmazonListingPackage: false,
    sellerCentralWriteReady: false,
    published: false,
    blockedReasons: [
      "conflicting catalog match requires human review",
      "wrong ASIN risk high",
      "electrical safety review required",
    ],
    warnings: [
      "missing UPC/GTIN",
      "invoice and compliance evidence needed",
    ],
    nextRecommendedAction: "NEED_SELLER_CENTRAL_ELIGIBILITY_CHECK",
    semanticStatus: "RED",
    statusColor: "rose",
  },
  {
    supplierSku: "luna-portex:first_real_mini_scan:rustoleum-spray-sanitized",
    productTitle: "Sanitized Rust-Oleum aerosol spray paint candidate 12 oz",
    brand: "Rust-Oleum",
    catalogMatchType: "NO_MATCH",
    matchConfidenceScore: 15,
    restrictionRisk: "RED",
    profitGuardDecision: "BLOCKED_BY_RESTRICTION_GATE",
    netProfitEstimate: -4.48,
    netMarginPercent: -34.49,
    roiPercent: -92.37,
    finalAsinRouteDecision: "REJECT_FOR_NOW",
    canProceedToAmazonListingPackage: false,
    sellerCentralWriteReady: false,
    published: false,
    blockedReasons: [
      "high hazmat risk",
      "category approval likely required",
      "brand approval likely required",
      "new ASIN blocked by GTIN and duplicate risk",
    ],
    warnings: [
      "aerosol paint candidate is high risk",
      "do not route to listing package",
    ],
    nextRecommendedAction: "REJECT_FOR_NOW",
    semanticStatus: "RED",
    statusColor: "rose",
  },
]

function average(values: number[]) {
  return values.length > 0
    ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2))
    : 0
}

export function buildAmazonTrackStatusSummary() {
  return {
    status: "ACTIVE_LOCAL_DECISION_ENGINE",
    completedLoops: [
      "149A",
      "149B",
      "149C",
      "149D",
      "149E",
      "149F",
    ],
    nextRecommendedLoop: "149G",
    optionalUiLoop: "149UI",
    description: "Amazon Track is active as a local decision layer with no API usage, no Seller Central writes, and no publication.",
  }
}

export function buildEbayTrackStatusSummary() {
  return {
    status: "PAUSED_YELLOW_OPERATIONAL",
    reason: "eBay seller account suspended / unresolved",
    currentLoop: "149 YELLOW foundation",
    nextAction: "resolve eBay account before LOOP 150",
  }
}

export function buildAmazonDecisionCenterRows() {
  return productRows.map(row => ({
    ...row,
    blockedReasons:
      [...row.blockedReasons],
    warnings:
      [...row.warnings],
  }))
}

export function buildMarketplaceNextActions() {
  return [
    "Build 149CODEX-A Self-Improvement Backlog + Codex Handoff before connecting any Codex API.",
    "Review Seller Central eligibility for existing ASIN candidates.",
    "Validate hazmat, chemical, and electrical requirements before listing package work.",
    "Request supplier invoice where brand/category or compliance evidence is needed.",
    "Verify GTIN, UPC, or exemption before any new ASIN path.",
    "Continue to 149G only when a product is approved for listing package preparation.",
  ]
}

export function buildMarketplaceOsDashboardViewModel() {
  const rows =
    buildAmazonDecisionCenterRows()
  const amazonTrack =
    buildAmazonTrackStatusSummary()
  const ebayTrack =
    buildEbayTrackStatusSummary()

  return {
    dashboardVersion:
      MARKETPLACE_OS_DASHBOARD_VERSION,
    marketplaceOsStatus:
      "LOCAL_READ_ONLY_DECISION_CENTER",
    ebayTrack,
    amazonTrack,
    production:
      {
        status:
          "FROZEN_CORE_ONLY",
      },
    metrics:
      {
        productsEvaluated:
          rows.length,
        productsBlockedFromListingPackage:
          rows.filter(row => !row.canProceedToAmazonListingPackage).length,
        productsRequiringHumanReview:
          rows.filter(row => row.blockedReasons.length > 0 || row.warnings.length > 0).length,
        watchlistExistingAsinCandidates:
          rows.filter(row => row.finalAsinRouteDecision === "WATCHLIST_EXISTING_ASIN").length,
        rejectedCandidates:
          rows.filter(row => row.finalAsinRouteDecision === "REJECT_FOR_NOW").length,
        averageAsinDecisionScore:
          22.33,
        averageNetMarginPercent:
          average(rows.map(row => row.netMarginPercent)),
        averageRoiPercent:
          average(rows.map(row => row.roiPercent)),
      },
    productRows:
      rows,
    codexSelfImprovement:
      {
        status:
          "PLANNED_SAFE_HANDOFF_ONLY",
        currentMode:
          "ROADMAP_ONLY_NO_API",
        nextPlannedLoop:
          "149CODEX-A — IMNOVA Self-Improvement Backlog + Codex Handoff Builder",
        futureApiLoop:
          "149CODEX-B — Codex API Connection Layer + Safe Execution Gate",
        guardrails:
          {
            noCodexApiUsed:
              true,
            noAutomaticCodeChanges:
              true,
            humanApprovalRequired:
              true,
            noMainBranchWrites:
              true,
            noProductionWrites:
              true,
            noSecretsInPrompts:
              true,
          },
      },
    recommendedStrategicNextStep:
      "149CODEX-A",
    thenContinueToAmazonListingPackageBuilder:
      "149G",
    roadmap:
      [
        {
          name: "Codex Self-Improvement Engine",
          status: "planned safe handoff only",
          safety: "IMNOVA can suggest improvements, but human approval is required before Codex work.",
        },
        {
          name: "Codex Handoff Layer",
          status: "149CODEX-A next strategic loop",
          safety: "Generates work orders/prompts only; no Codex API, no automatic code changes.",
        },
        {
          name: "Self-Improvement Backlog",
          status: "planned",
          safety: "Backlog entries must avoid secrets and cannot write to main or Production.",
        },
        {
          name: "Codex API Connection Layer",
          status: "future gated loop",
          safety: "149CODEX-B can only proceed after safe execution gates are defined.",
        },
        {
          name: "WhatsApp Remote Control",
          status: "planned / previews only",
          safety: "No real WhatsApp send.",
        },
        {
          name: "Marketplace Automation Engine",
          status: "planned",
          safety: "No automated marketplace writes.",
        },
        {
          name: "Amazon SP-API Connection",
          status: "later",
          safety: "No credentials or API calls in this loop.",
        },
        {
          name: "Amazon Listing Package Builder",
          status: "next after UI",
          safety: "Only after gates approve listing package work.",
        },
      ],
    nextActions:
      buildMarketplaceNextActions(),
    safety:
      {
        amazonApiUsed:
          false,
        spApiUsed:
          false,
        sellerCentralWriteExecuted:
          false,
        asinCreationExecuted:
          false,
        listingCreationExecuted:
          false,
        publicationExecuted:
          false,
        stagingWriteExecuted:
          false,
        whatsappRealSendUsed:
          false,
        codexApiUsed:
          false,
        automaticCodeChangesExecuted:
          false,
        openAiUsed:
          false,
        scraperUsed:
          false,
      },
    uiRoute:
      "/admin/marketplace-os",
    nextLoop:
      "149G",
  }
}

export function summarizeMarketplaceOsDashboard(viewModel = buildMarketplaceOsDashboardViewModel()) {
  return {
    dashboardBuilt:
      true,
    ebayTrackStatus:
      viewModel.ebayTrack.status,
    amazonTrackStatus:
      viewModel.amazonTrack.status,
    completedAmazonLoops:
      viewModel.amazonTrack.completedLoops.length,
    productRowsBuilt:
      viewModel.productRows.length,
    productsBlockedFromListingPackage:
      viewModel.metrics.productsBlockedFromListingPackage,
    productsRequiringHumanReview:
      viewModel.metrics.productsRequiringHumanReview,
    watchlistExistingAsinCandidates:
      viewModel.metrics.watchlistExistingAsinCandidates,
    rejectedCandidates:
      viewModel.metrics.rejectedCandidates,
    averageAsinDecisionScore:
      viewModel.metrics.averageAsinDecisionScore,
    codexSelfImprovementRoadmapVisible:
      viewModel.codexSelfImprovement.status === "PLANNED_SAFE_HANDOFF_ONLY",
    codexApiUsed:
      false,
    automaticCodeChangesExecuted:
      false,
    humanApprovalRequiredForCodex:
      viewModel.codexSelfImprovement.guardrails.humanApprovalRequired,
    recommendedStrategicNextStep:
      viewModel.recommendedStrategicNextStep,
    thenNextAmazonLoop:
      viewModel.thenContinueToAmazonListingPackageBuilder,
    nextRecommendedLoop:
      viewModel.amazonTrack.nextRecommendedLoop,
    uiRoute:
      viewModel.uiRoute,
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    asinCreationExecuted:
      false,
    listingCreationExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    whatsappRealSendUsed:
      false,
    openAiUsed:
      false,
    scraperUsed:
      false,
    nextLoop:
      viewModel.nextLoop,
  }
}

export function getMarketplaceOsDashboardChecklist() {
  return [
    "Render Marketplace Seller OS status as a local read-only decision center.",
    "Show eBay Track paused/YELLOW while Amazon Track remains active.",
    "Summarize Amazon loops 149A through 149F and point to 149G.",
    "Show Codex Self-Improvement, Codex Handoff, and Self-Improvement Backlog as roadmap-only future work.",
    "Show product-level route, blocks, warnings, ROI, match confidence, and next action.",
    "Keep WhatsApp Remote Control and Marketplace Automation as roadmap previews only.",
    "Keep the dashboard local only: no API calls, no Codex API, no automatic code changes, no Seller Central writes, no ASIN creation, no listing creation, no publication.",
  ]
}
