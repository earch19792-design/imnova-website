export type SellerOsAreaId = "dashboard" | "opportunities" | "listings" |
  "stockguard" | "orders" | "analytics" | "settings" |
  // Compatibility IDs used by older screens while their routes remain active.
  "home" | "publish" | "live" | "sales" | "post-sale" | "mayel" |
  "administration" | "experiments"
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
  icon: "dashboard" | "opportunities" | "listings" | "stockguard" |
    "orders" | "analytics" | "settings"
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

const child = (id: string, label: string, href: string): SellerOsNavigationChild =>
  ({ id, label, href, capability: id.toUpperCase().replaceAll("-", "_"),
    status: "ACTIVE" })
const item = (id: SellerOsNavigationItem["icon"], label: string,
  href: string, description: string, objective: string, order: number,
  children: readonly SellerOsNavigationChild[] = []): SellerOsNavigationItem =>
  ({ id, label, mobileLabel: label, description, objective, icon: id, href,
    tier: "PRIMARY", children, section: "SELLER_OS", permission: "ADMIN",
    featureRequirement: null, visibility: "AUTHENTICATED_ADMIN", order,
    status: "ACTIVE" })

export const SELLER_OS_NAVIGATION: readonly SellerOsNavigationItem[] = Object.freeze([
  item("dashboard", "Dashboard", "/admin",
    "Estado operativo y siguientes acciones respaldadas por evidencia.",
    "Ver el estado comercial y los bloqueos actuales.", 1),
  item("opportunities", "Opportunities", "/admin/ebay/opportunity-queue/research",
    "Investigación previa, Radar y coincidencias exactas de Luna.",
    "Examinar oportunidades antes de preparar una publicación.", 2, [
      child("pre-research", "Pre-Research", "/admin/ebay/opportunity-queue/research"),
      child("radar", "Radar", "/admin/ebay/mobile-review"),
      child("luna-matches", "Matches Luna", "/admin/ebay/opportunity-queue"),
      child("preparation", "Preparación", "/admin/ebay/quick-pick"),
    ]),
  item("listings", "Listings", "/admin/ebay/listings",
    "Registro canónico, importación y reconciliación de publicaciones eBay.",
    "Resolver la identidad y el siguiente bloqueo de cada Item ID.", 3, [
      child("identity-review", "Identity Review", "/admin/ebay/listings#identity-review"),
      child("publication", "Publicación", "/admin/ebay/publish"),
      child("quality", "Listing Quality", "/admin/ebay/listing-quality"),
    ]),
  item("stockguard", "StockGuard", "/admin/ebay/stock-guard",
    "Vínculos exactos, vigilancia de stock y excepciones.",
    "Supervisar publicaciones vinculadas sin autorizar cantidades nuevas.", 4),
  item("orders", "Orders", "/admin/ebay/sales",
    "Órdenes, fulfillment, tracking y excepciones posventa.",
    "Seguir los pedidos con evidencia oficial.", 5, [
      child("orders", "Órdenes", "/admin/ebay/sales?view=orders"),
      child("fulfillment", "Fulfillment", "/admin/ebay/sales?view=fulfillment"),
      child("post-sale", "Postventa", "/admin/ebay/post-sale"),
    ]),
  item("analytics", "Analytics", "/admin/ebay/seller-performance",
    "Rendimiento de cuenta y análisis comerciales.",
    "Leer desempeño sin alterar publicaciones existentes.", 6),
  item("settings", "Settings", "/admin/ebay/operational-readiness",
    "Cuenta, políticas, extensiones y diagnósticos.",
    "Administrar los controles técnicos fuera del flujo comercial.", 7, [
      child("mayel", "Mayel", "/admin/ebay/mayel"),
      child("experiments", "Experimentos", "/admin/ebay/experiments"),
      child("diagnostics", "Diagnóstico", "/admin/ebay/operational-readiness"),
    ]),
])

export const SELLER_OS_PRIMARY_NAVIGATION = SELLER_OS_NAVIGATION
export const SELLER_OS_SYSTEM_NAVIGATION: readonly SellerOsNavigationItem[] =
  Object.freeze([])
export const SELLER_OS_MOBILE_NAVIGATION = Object.freeze(
  SELLER_OS_PRIMARY_NAVIGATION.slice(0, 4),
)

const legacyArea: Partial<Record<SellerOsAreaId, SellerOsNavigationItem["icon"]>> = {
  home: "dashboard", publish: "opportunities", live: "listings",
  sales: "orders", "post-sale": "orders", mayel: "settings",
  administration: "settings", experiments: "settings",
}
export function canonicalSellerOsArea(id: SellerOsAreaId): SellerOsNavigationItem["icon"] {
  return legacyArea[id] ?? id as SellerOsNavigationItem["icon"]
}
export function sellerOsNavigationItem(id: SellerOsAreaId) {
  return SELLER_OS_NAVIGATION.find((entry) => entry.id === canonicalSellerOsArea(id)) ??
    SELLER_OS_NAVIGATION[0]
}
export function sellerOsBreadcrumbs(id: SellerOsAreaId) {
  const selected = sellerOsNavigationItem(id)
  return [{ label: "Seller OS", href: "/admin" },
    { label: selected.label, href: selected.href }]
}
