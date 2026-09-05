export type SellerOsAreaId =
  | "home"
  | "publish"
  | "opportunities"
  | "live"
  | "sales"
  | "post-sale"
  | "mayel"
  | "stockguard"
  | "administration"
  | "experiments"

export type SellerOsNavigationTier = "PRIMARY" | "SYSTEM"
export type SellerOsNavStatus = "ACTIVE" | "LIMITED" | "PAUSED"

export type SellerOsNavigationChild = Readonly<{
  id: string
  label: string
  href: string
  capability: string
  status: SellerOsNavStatus
}>

export type SellerOsNavigationItem = Readonly<{
  id: SellerOsAreaId
  label: string
  mobileLabel: string
  description: string
  objective: string
  icon: "home" | "publish" | "opportunities" | "live" | "sales" |
    "post-sale" | "mayel" | "stockguard" | "administration" |
    "experiments"
  href: string
  tier: SellerOsNavigationTier
  children: readonly SellerOsNavigationChild[]
  section: "SELLER_OS"
  permission: "ADMIN"
  featureRequirement: string | null
  visibility: "AUTHENTICATED_ADMIN"
  order: number
  status: SellerOsNavStatus
}>

const children = (...items: SellerOsNavigationChild[]) => Object.freeze(items)

export const SELLER_OS_NAVIGATION: readonly SellerOsNavigationItem[] =
  Object.freeze([
    { id: "home", label: "Inicio", mobileLabel: "Inicio",
      description: "Aquí ves únicamente lo que necesita atención ahora y el estado operativo comprobado.",
      objective: "Elegir la siguiente acción comercial desde una autoridad común.",
      icon: "home", href: "/admin", tier: "PRIMARY",
      children: children(), section: "SELLER_OS", permission: "ADMIN",
      featureRequirement: "EBAY_READ_ONLY",
      visibility: "AUTHENTICATED_ADMIN", order: 1, status: "ACTIVE" },
    { id: "publish", label: "Publicar", mobileLabel: "Publicar",
      description: "Aquí Seller OS prepara productos, separa los listos de los bloqueados y conserva el historial.",
      objective: "Llevar cada producto por una preparación canónica antes de cualquier autorización comercial.",
      icon: "publish", href: "/admin/ebay/quick-pick", tier: "PRIMARY",
      children: children(
        { id: "publish-prepare", label: "Preparar productos",
          href: "/admin/ebay/quick-pick", capability: "QUICK_PICK_PREPARATION",
          status: "ACTIVE" },
        { id: "publish-ready", label: "Listos",
          href: "/admin/ebay/quick-pick?view=ready",
          capability: "OWNER_READY_REVIEW", status: "ACTIVE" },
        { id: "publish-needs-data", label: "Datos por confirmar",
          href: "/admin/ebay/quick-pick?view=needs-data",
          capability: "OWNER_FACT_EXCEPTIONS", status: "ACTIVE" },
        { id: "publish-batch", label: "Publicación por lote",
          href: "/admin/ebay/listing-workspace?view=batch",
          capability: "BATCH_PUBLISHER", status: "PAUSED" },
        { id: "publish-history", label: "Historial",
          href: "/admin/ebay/quick-pick?view=history",
          capability: "PUBLISH_PREPARATION_HISTORY", status: "ACTIVE" },
      ), section: "SELLER_OS", permission: "ADMIN",
      featureRequirement: "SELLER_OPERATIONS",
      visibility: "AUTHENTICATED_ADMIN", order: 2, status: "LIMITED" },
    { id: "opportunities", label: "Oportunidades",
      mobileLabel: "Oportunidades",
      description: "Aquí comparas Radar, investigación oficial y coincidencias exactas de Luna.",
      objective: "Encontrar oportunidades sin mezclar señales familiares con productos listos.",
      icon: "opportunities", href: "/admin/ebay/opportunity-queue/research",
      tier: "PRIMARY", children: children(
        { id: "opportunities-radar", label: "Radar",
          href: "/admin/ebay/mobile-review", capability: "MARKET_RADAR",
          status: "ACTIVE" },
        { id: "opportunities-research", label: "Research",
          href: "/admin/ebay/opportunity-queue/research",
          capability: "PRODUCT_RESEARCH", status: "ACTIVE" },
        { id: "opportunities-luna", label: "Matches Luna",
          href: "/admin/ebay/opportunity-queue",
          capability: "LUNA_MATCHES", status: "ACTIVE" },
      ), section: "SELLER_OS", permission: "ADMIN",
      featureRequirement: "EBAY_READ_ONLY",
      visibility: "AUTHENTICATED_ADMIN", order: 3, status: "ACTIVE" },
    { id: "live", label: "Listings LIVE", mobileLabel: "LIVE",
      description: "Aquí ves el portafolio oficial, sus alertas y la calidad de publicación.",
      objective: "Operar únicamente sobre el conjunto LIVE confirmado por eBay.",
      icon: "live", href: "/admin/ebay/monitor", tier: "PRIMARY",
      children: children(
        { id: "live-portfolio", label: "Portfolio",
          href: "/admin/ebay/monitor", capability: "LIVE_PORTFOLIO",
          status: "ACTIVE" },
        { id: "live-monitor", label: "Monitoreo",
          href: "/admin/ebay/listing-optimization",
          capability: "LIVE_MONITORING", status: "ACTIVE" },
        { id: "live-quality", label: "Listing Quality",
          href: "/admin/ebay/listing-quality",
          capability: "LISTING_QUALITY", status: "ACTIVE" },
      ), section: "SELLER_OS", permission: "ADMIN",
      featureRequirement: "EBAY_READ_ONLY",
      visibility: "AUTHENTICATED_ADMIN", order: 4, status: "ACTIVE" },
    { id: "sales", label: "Ventas", mobileLabel: "Ventas",
      description: "Aquí sigues órdenes, fulfillment y tracking desde receipts oficiales.",
      objective: "Cumplir pedidos sin confundir ausencia de evidencia con cero ventas.",
      icon: "sales", href: "/admin/ebay/sales", tier: "PRIMARY",
      children: children(
        { id: "sales-orders", label: "Órdenes",
          href: "/admin/ebay/sales?view=orders", capability: "OFFICIAL_ORDERS",
          status: "ACTIVE" },
        { id: "sales-fulfillment", label: "Fulfillment",
          href: "/admin/ebay/sales?view=fulfillment",
          capability: "FULFILLMENT", status: "ACTIVE" },
        { id: "sales-tracking", label: "Tracking",
          href: "/admin/ebay/sales?view=tracking", capability: "TRACKING",
          status: "ACTIVE" },
      ), section: "SELLER_OS", permission: "ADMIN",
      featureRequirement: "SELLER_OPERATIONS",
      visibility: "AUTHENTICATED_ADMIN", order: 5, status: "ACTIVE" },
    { id: "post-sale", label: "Postventa", mobileLabel: "Postventa",
      description: "Aquí se concentran comunicación, alertas y excepciones posteriores a la venta.",
      objective: "Distinguir mecanismos armados de entregas comprobadas y casos que requieren owner.",
      icon: "post-sale", href: "/admin/ebay/post-sale", tier: "PRIMARY",
      children: children(
        { id: "post-sale-communication", label: "Comunicación",
          href: "/admin/ebay/post-sale?view=communication",
          capability: "BUYER_COMMUNICATION", status: "ACTIVE" },
        { id: "post-sale-alerts", label: "Alertas",
          href: "/admin/ebay/post-sale?view=alerts",
          capability: "OWNER_SALE_ALERTS", status: "ACTIVE" },
        { id: "post-sale-exceptions", label: "Excepciones",
          href: "/admin/ebay/post-sale?view=exceptions",
          capability: "POST_SALE_EXCEPTIONS", status: "ACTIVE" },
        { id: "post-sale-owner", label: "Casos owner",
          href: "/admin/ebay/post-sale?view=owner",
          capability: "OWNER_POST_SALE_CASES", status: "ACTIVE" },
        { id: "post-sale-history", label: "Historial",
          href: "/admin/ebay/post-sale?view=history",
          capability: "POST_SALE_HISTORY", status: "ACTIVE" },
      ), section: "SELLER_OS", permission: "ADMIN",
      featureRequirement: "SELLER_OPERATIONS",
      visibility: "AUTHENTICATED_ADMIN", order: 6, status: "ACTIVE" },
    { id: "mayel", label: "Mayel", mobileLabel: "Mayel",
      description: "Aquí vive el trabajo visual delegado, separado de las decisiones owner.",
      objective: "Dar a Mayel una cola propia y devolver resultados durables para revisión.",
      icon: "mayel", href: "/admin/ebay/mayel", tier: "PRIMARY",
      children: children(
        { id: "mayel-work", label: "Trabajo delegado",
          href: "/admin/ebay/mayel?view=work", capability: "MAYEL_WORK",
          status: "ACTIVE" },
        { id: "mayel-images", label: "Imágenes",
          href: "/admin/ebay/mayel?view=images", capability: "MAYEL_IMAGES",
          status: "ACTIVE" },
        { id: "mayel-results", label: "Resultados",
          href: "/admin/ebay/mayel?view=results", capability: "MAYEL_RESULTS",
          status: "ACTIVE" },
      ), section: "SELLER_OS", permission: "ADMIN",
      featureRequirement: "SELLER_OPERATIONS",
      visibility: "AUTHENTICATED_ADMIN", order: 7, status: "ACTIVE" },
    { id: "stockguard", label: "StockGuard", mobileLabel: "Stock",
      description: "Aquí ves vínculos exactos, vigencia y riesgos comprobados de stock.",
      objective: "Proteger el portafolio LIVE sin convertir desconocido en riesgo.",
      icon: "stockguard", href: "/admin/ebay/stock-guard", tier: "SYSTEM",
      children: children(), section: "SELLER_OS", permission: "ADMIN",
      featureRequirement: "SELLER_OPERATIONS",
      visibility: "AUTHENTICATED_ADMIN", order: 8, status: "ACTIVE" },
    { id: "administration", label: "Administración", mobileLabel: "Sistema",
      description: "Aquí están cuenta, policies, extensiones, runtime y diagnóstico técnico.",
      objective: "Mantener controles técnicos fuera de la operación comercial cotidiana.",
      icon: "administration", href: "/admin/ebay/operational-readiness",
      tier: "SYSTEM", children: children(
        { id: "admin-account", label: "Cuenta y policies",
          href: "/admin/ebay/operational-readiness#account",
          capability: "ACCOUNT_AND_POLICIES", status: "ACTIVE" },
        { id: "admin-extensions", label: "Extensiones",
          href: "/admin/ebay/operational-readiness#extensions",
          capability: "EXTENSIONS", status: "ACTIVE" },
        { id: "admin-runtime", label: "Runtime",
          href: "/admin/ebay/operational-readiness#runtime",
          capability: "RUNTIME", status: "ACTIVE" },
        { id: "admin-diagnostics", label: "Diagnóstico",
          href: "/admin/ebay/operational-readiness#diagnostics",
          capability: "DIAGNOSTICS", status: "ACTIVE" },
      ), section: "SELLER_OS", permission: "ADMIN",
      featureRequirement: "SELLER_CONFIGURATION",
      visibility: "AUTHENTICATED_ADMIN", order: 9, status: "ACTIVE" },
    { id: "experiments", label: "Experimentos", mobileLabel: "Experimentos",
      description: "Aquí observas pruebas aisladas, variables protegidas y resultados.",
      objective: "Aprender sin cambiar varias variables ni confundir preparación con publicación.",
      icon: "experiments", href: "/admin/ebay/experiments", tier: "SYSTEM",
      children: children(), section: "SELLER_OS", permission: "ADMIN",
      featureRequirement: "EXPERIMENT_GUARDIAN",
      visibility: "AUTHENTICATED_ADMIN", order: 10, status: "ACTIVE" },
  ])

export const SELLER_OS_PRIMARY_NAVIGATION = Object.freeze(
  SELLER_OS_NAVIGATION.filter((item) => item.tier === "PRIMARY"),
)

export const SELLER_OS_SYSTEM_NAVIGATION = Object.freeze(
  SELLER_OS_NAVIGATION.filter((item) => item.tier === "SYSTEM"),
)

// Four direct touch targets plus a fifth “Más” disclosure keep the mobile bar
// usable while preserving all seven primary areas in the same source of truth.
export const SELLER_OS_MOBILE_NAVIGATION = Object.freeze(
  SELLER_OS_PRIMARY_NAVIGATION.slice(0, 4),
)

export function sellerOsNavigationItem(id: SellerOsAreaId) {
  return SELLER_OS_NAVIGATION.find((item) => item.id === id) ??
    SELLER_OS_NAVIGATION[0]
}

export function sellerOsBreadcrumbs(id: SellerOsAreaId) {
  const item = sellerOsNavigationItem(id)
  return [{ label: "Seller OS", href: "/admin" },
    { label: item.label, href: item.href }]
}
