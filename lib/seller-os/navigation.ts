export type SellerOsAreaId = "home" | "ebay-opportunities" | "listings" | "operations" | "health-settings"
export type SellerOsNavStatus = "ACTIVE" | "LIMITED" | "PAUSED"

export type SellerOsNavigationItem = Readonly<{
  id: SellerOsAreaId
  label: string
  description: string
  icon: string
  href: string
  section: "SELLER_OS"
  permission: "ADMIN"
  featureRequirement: string | null
  visibility: "AUTHENTICATED_ADMIN"
  order: number
  status: SellerOsNavStatus
}>

export const SELLER_OS_NAVIGATION: readonly SellerOsNavigationItem[] = Object.freeze([
  { id: "home", label: "Inicio", description: "Estado, piloto, alertas y próxima acción.", icon: "⌂", href: "/admin", section: "SELLER_OS", permission: "ADMIN", featureRequirement: null, visibility: "AUTHENTICATED_ADMIN", order: 1, status: "ACTIVE" },
  { id: "ebay-opportunities", label: "Oportunidades eBay", description: "Discovery, Radar eBay, Product Research, Top 20 y aprobación.", icon: "⌕", href: "/admin/ebay/mobile-review", section: "SELLER_OS", permission: "ADMIN", featureRequirement: "EBAY_READ_ONLY", visibility: "AUTHENTICATED_ADMIN", order: 2, status: "ACTIVE" },
  { id: "listings", label: "Listings", description: "Preparación, contenido, imágenes, drafts, revisión e historial.", icon: "▤", href: "/admin/ebay/listing-workspace", section: "SELLER_OS", permission: "ADMIN", featureRequirement: "EBAY_LISTING_WORKSPACE", visibility: "AUTHENTICATED_ADMIN", order: 3, status: "LIMITED" },
  { id: "operations", label: "Operación", description: "Órdenes, Luna, fulfillment, inventario, costos y excepciones.", icon: "▦", href: "/admin/ebay-seller-os#operacion", section: "SELLER_OS", permission: "ADMIN", featureRequirement: "SELLER_OPERATIONS", visibility: "AUTHENTICATED_ADMIN", order: 4, status: "ACTIVE" },
  { id: "health-settings", label: "Salud y configuración", description: "Conexiones, jobs, pausas, límites, cumplimiento y auditoría.", icon: "⚙", href: "/admin/ebay-seller-os#salud", section: "SELLER_OS", permission: "ADMIN", featureRequirement: "SELLER_CONFIGURATION", visibility: "AUTHENTICATED_ADMIN", order: 5, status: "ACTIVE" },
])

export function sellerOsNavigationItem(id: SellerOsAreaId) {
  return SELLER_OS_NAVIGATION.find((item) => item.id === id) ?? SELLER_OS_NAVIGATION[0]
}

export function sellerOsBreadcrumbs(id: SellerOsAreaId) {
  const item = sellerOsNavigationItem(id)
  return [{ label: "Seller OS", href: "/admin" }, { label: item.label, href: item.href }]
}
