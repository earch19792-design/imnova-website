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
  sellerStatusLabel: string
  sellerRouteLabel: string
  sellerNextActionLabel: string
  sellerBlockSummary: string
  sellerProfitLabel: string
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
    sellerStatusLabel: "Revisar antes de vender",
    sellerRouteLabel: "Posible venta sobre ASIN existente",
    sellerNextActionLabel: "Validar hazmat/quimico y elegibilidad en Seller Central",
    sellerBlockSummary: "No listar hasta resolver compliance, Seller Central y margen.",
    sellerProfitLabel: "Margen positivo, pero estrecho",
    canProceedToAmazonListingPackage: false,
    sellerCentralWriteReady: false,
    published: false,
    blockedReasons: [
      "requiere revision hazmat",
      "requiere revision quimica/compliance",
      "requiere revision manual de elegibilidad en Seller Central",
      "listing bloqueado hasta revisar margen watchlist",
    ],
    warnings: [
      "falta UPC/GTIN",
      "un ASIN probable no confirma permiso de venta",
      "ROI positivo no elimina los bloqueos de compliance",
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
    sellerStatusLabel: "Bloqueado para listing",
    sellerRouteLabel: "Requiere revision por ASIN/conflicto",
    sellerNextActionLabel: "Revisar elegibilidad, factura y seguridad electrica",
    sellerBlockSummary: "No vender hasta resolver ASIN correcto y compliance electrico.",
    sellerProfitLabel: "Margen negativo en estimacion",
    canProceedToAmazonListingPackage: false,
    sellerCentralWriteReady: false,
    published: false,
    blockedReasons: [
      "match de catalogo conflictivo requiere revision humana",
      "riesgo alto de ASIN equivocado",
      "requiere revision de seguridad electrica",
    ],
    warnings: [
      "falta UPC/GTIN",
      "requiere factura y evidencia de compliance",
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
    sellerStatusLabel: "No vender por ahora",
    sellerRouteLabel: "Rechazar o dejar fuera del pipeline",
    sellerNextActionLabel: "No avanzar sin nueva evidencia y aprobaciones",
    sellerBlockSummary: "Riesgo alto por aerosol/hazmat, marca y GTIN.",
    sellerProfitLabel: "No rentable en estimacion",
    canProceedToAmazonListingPackage: false,
    sellerCentralWriteReady: false,
    published: false,
    blockedReasons: [
      "riesgo hazmat alto",
      "probable aprobacion de categoria requerida",
      "probable aprobacion de marca requerida",
      "ASIN nuevo bloqueado por GTIN y riesgo de duplicado",
    ],
    warnings: [
      "producto aerosol/pintura es de alto riesgo",
      "no enviar a preparacion de listing",
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
    description: "Amazon esta activo como centro local de decisiones, sin API, sin writes a Seller Central y sin publicacion.",
  }
}

export function buildEbayTrackStatusSummary() {
  return {
    status: "PAUSED_YELLOW_OPERATIONAL",
    reason: "cuenta eBay suspendida / sin resolver",
    currentLoop: "149 YELLOW foundation",
    nextAction: "resolver cuenta eBay antes de LOOP 150",
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
    "Revisar elegibilidad en Seller Central antes de vender sobre un ASIN existente.",
    "Validar hazmat, quimico y electrico antes de preparar listings.",
    "Pedir factura del proveedor cuando falte evidencia de marca, categoria o compliance.",
    "Confirmar GTIN, UPC o exencion antes de cualquier ASIN nuevo.",
    "Construir 149CODEX-A como backlog de mejoras antes de conectar cualquier Codex API.",
    "Continuar a 149G solo cuando un producto este aprobado para preparar listing.",
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
    sellerExperience:
      {
        navigationMode:
          "SELLER_FRIENDLY_OPERATION_CENTER",
        primaryQuestion:
          "Que producto puedo vender, cual esta bloqueado y que hago ahora?",
        menuLabel:
          "Marketplace OS",
        menuDescription:
          "Productos, bloqueos, margen y proxima accion.",
        technicalLanguageReduced:
          true,
        sellerDecisionLanguageEnabled:
          true,
      },
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
        productsReadyForListingPackage:
          rows.filter(row => row.canProceedToAmazonListingPackage).length,
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
          name: "Motor de automejora con Codex",
          status: "planificado como handoff seguro",
          safety: "IMNOVA puede sugerir mejoras, pero requiere aprobacion humana antes de trabajar con Codex.",
        },
        {
          name: "Capa de handoff a Codex",
          status: "149CODEX-A como siguiente loop estrategico",
          safety: "Solo genera work orders/prompts; sin Codex API ni cambios automaticos de codigo.",
        },
        {
          name: "Backlog de automejora",
          status: "planificado",
          safety: "Las tareas no pueden incluir secretos ni escribir en main o Produccion.",
        },
        {
          name: "Conexion futura Codex API",
          status: "loop futuro con gates",
          safety: "149CODEX-B solo avanza cuando existan gates de ejecucion segura.",
        },
        {
          name: "WhatsApp Remote Control",
          status: "planificado / solo preview",
          safety: "Sin envio real de WhatsApp.",
        },
        {
          name: "Marketplace Automation Engine",
          status: "planificado",
          safety: "Sin writes automaticos a marketplaces.",
        },
        {
          name: "Conexion Amazon SP-API",
          status: "mas adelante",
          safety: "Sin credenciales ni llamadas API en este loop.",
        },
        {
          name: "Amazon Listing Package Builder",
          status: "siguiente despues de UX",
          safety: "Solo despues de aprobar los gates para preparar listing.",
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
    sellerFriendlyNavigationEnabled:
      viewModel.sellerExperience.navigationMode === "SELLER_FRIENDLY_OPERATION_CENTER",
    sellerFriendlyDecisionLanguageEnabled:
      viewModel.sellerExperience.sellerDecisionLanguageEnabled,
    productsReadyForListingPackage:
      viewModel.metrics.productsReadyForListingPackage,
    primarySellerQuestion:
      viewModel.sellerExperience.primaryQuestion,
    adminMenuLabel:
      viewModel.sellerExperience.menuLabel,
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
    "Mostrar Marketplace Seller OS como centro local read-only.",
    "Mostrar eBay pausado/YELLOW mientras Amazon sigue activo.",
    "Resumir Amazon 149A a 149F y apuntar a 149G.",
    "Usar lenguaje de vendedor para estado, ruta, bloqueo, margen y proxima accion.",
    "Mostrar automejora con Codex, handoff y backlog solo como roadmap futuro.",
    "Mostrar ruta, bloqueos, alertas, ROI, confianza de match y proxima accion por producto.",
    "Mantener WhatsApp Remote Control y Marketplace Automation como previews de roadmap.",
    "Mantener el dashboard local: sin APIs, sin Codex API, sin cambios automaticos, sin Seller Central writes, sin ASIN creation, sin listing creation y sin publicacion.",
  ]
}
