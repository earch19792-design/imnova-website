export type SellerOsRouteClass = "OPERATOR_PRIMARY" | "OWNER_PRIMARY" |
  "TECHNICAL_ADMIN" | "LEGACY" | "INTERNAL_ONLY"

export type SellerOsUserFacingRoute = Readonly<{
  href: string
  label: string
  classification: SellerOsRouteClass
  dashboardReachable: boolean
}>

export const SELLER_OS_USER_FACING_ROUTES: readonly SellerOsUserFacingRoute[] =
  Object.freeze([
    { href: "/admin/ebay/quick-pick", label: "Quick Pick Luna", classification: "OPERATOR_PRIMARY", dashboardReachable: true },
    { href: "/admin/ebay/opportunity-queue/research", label: "Product Research", classification: "OPERATOR_PRIMARY", dashboardReachable: true },
    { href: "/admin/ebay/listing-workspace", label: "Listing Workspace", classification: "OPERATOR_PRIMARY", dashboardReachable: true },
    { href: "/admin/ebay/listing-optimization", label: "Command Center", classification: "OPERATOR_PRIMARY", dashboardReachable: true },
    { href: "/admin/ebay/experiments", label: "Experimentos", classification: "OPERATOR_PRIMARY", dashboardReachable: true },
    { href: "/admin/ebay/stock-guard", label: "Inventario y StockGuard", classification: "OPERATOR_PRIMARY", dashboardReachable: true },
    { href: "/admin/ebay/mobile-review", label: "Portfolio LIVE", classification: "OPERATOR_PRIMARY", dashboardReachable: true },
    { href: "/admin/ebay/monitor", label: "Monitor comercial", classification: "OWNER_PRIMARY", dashboardReachable: true },
    { href: "/admin/ebay/decisions", label: "Decisiones", classification: "OWNER_PRIMARY", dashboardReachable: true },
    { href: "/admin/ebay/learning", label: "Aprendizaje", classification: "OWNER_PRIMARY", dashboardReachable: true },
    { href: "/admin/ebay/seller-performance", label: "Rendimiento", classification: "OWNER_PRIMARY", dashboardReachable: true },
    { href: "/admin/ebay/copilot", label: "Copilot", classification: "OWNER_PRIMARY", dashboardReachable: true },
    { href: "/admin/ebay/strategic-review", label: "Revisión estratégica", classification: "OWNER_PRIMARY", dashboardReachable: true },
    { href: "/admin/ebay/listings/register", label: "Vincular listing LIVE", classification: "OWNER_PRIMARY", dashboardReachable: true },
    { href: "/admin/ebay/luna-capture", label: "Luna Capture", classification: "TECHNICAL_ADMIN", dashboardReachable: true },
    { href: "/admin/ebay/luna-protected-session", label: "Luna Owner Session Handoff", classification: "TECHNICAL_ADMIN", dashboardReachable: true },
    { href: "/admin/ebay/luna-shipping-capture", label: "Luna Shipping Capture", classification: "TECHNICAL_ADMIN", dashboardReachable: true },
    { href: "/admin/ebay/luna-supplier-linkage-review", label: "Luna linkage review", classification: "TECHNICAL_ADMIN", dashboardReachable: true },
    { href: "/admin/ebay/operational-readiness", label: "System Review", classification: "TECHNICAL_ADMIN", dashboardReachable: true },
    { href: "/admin/ebay/monitor/seller-oauth-reauth", label: "eBay OAuth", classification: "TECHNICAL_ADMIN", dashboardReachable: true },
    { href: "/admin/ebay/opportunity-queue", label: "Cola legacy", classification: "LEGACY", dashboardReachable: true },
    { href: "/admin/ebay/mobile-review/product-research-capture", label: "Product Research Capture legacy", classification: "LEGACY", dashboardReachable: true },
    { href: "/admin/ebay/monitor/commercial-orders-oauth-start", label: "OAuth callback interno", classification: "INTERNAL_ONLY", dashboardReachable: false },
  ])

export const SELLER_OS_ROUTE_AUDIT = Object.freeze({
  totalUserFacingRoutes: SELLER_OS_USER_FACING_ROUTES.length,
  orphanOperationalRouteCountBefore: 7,
  orphanOperationalRouteCountAfter: SELLER_OS_USER_FACING_ROUTES.filter(
    (route) => ["OPERATOR_PRIMARY", "OWNER_PRIMARY"].includes(
      route.classification) && !route.dashboardReachable).length,
  operatorPrimaryCount: SELLER_OS_USER_FACING_ROUTES.filter((route) =>
    route.classification === "OPERATOR_PRIMARY").length,
  ownerPrimaryCount: SELLER_OS_USER_FACING_ROUTES.filter((route) =>
    route.classification === "OWNER_PRIMARY").length,
  technicalAdminCount: SELLER_OS_USER_FACING_ROUTES.filter((route) =>
    route.classification === "TECHNICAL_ADMIN").length,
  legacyCount: SELLER_OS_USER_FACING_ROUTES.filter((route) =>
    route.classification === "LEGACY").length,
})

export const SELLER_OS_TECHNICAL_AND_LEGACY_ROUTES = Object.freeze(
  SELLER_OS_USER_FACING_ROUTES.filter((route) =>
    route.classification === "TECHNICAL_ADMIN" ||
    route.classification === "LEGACY"),
)
