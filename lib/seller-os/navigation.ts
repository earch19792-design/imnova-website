export type SellerOsAreaId =
  | "home"
  | "opportunities"
  | "products"
  | "operations"
  | "monitoring"

export type SellerOsUtilityId =
  | "decisions"
  | "alerts"
  | "quarantine"
  | "settings"

export type SellerOsNavigationItem = Readonly<{
  id: SellerOsAreaId
  label: string
  mobileLabel: string
  description: string
  icon: string
  href: string
  section: "SELLER_OS"
  permission: "ADMIN"
  featureRequirement: string | null
  visibility: "AUTHENTICATED_ADMIN"
  order: number
}>

export const SELLER_OS_NAVIGATION: readonly SellerOsNavigationItem[] = Object.freeze([
  { id: "home", label: "Inicio", mobileLabel: "Inicio", description: "Estado actual, decisiones y próxima acción.", icon: "home", href: "/admin", section: "SELLER_OS", permission: "ADMIN", featureRequirement: null, visibility: "AUTHENTICATED_ADMIN", order: 1 },
  { id: "opportunities", label: "Oportunidades", mobileLabel: "Oportunidades", description: "Productos candidatos, evidencia de mercado y priorización.", icon: "search", href: "/admin/ebay/mobile-review", section: "SELLER_OS", permission: "ADMIN", featureRequirement: "EBAY_READ_ONLY", visibility: "AUTHENTICATED_ADMIN", order: 2 },
  { id: "products", label: "Productos", mobileLabel: "Productos", description: "Preparación, listing, imágenes y expediente del producto.", icon: "file", href: "/admin/ebay/listing-workspace", section: "SELLER_OS", permission: "ADMIN", featureRequirement: "EBAY_LISTING_WORKSPACE", visibility: "AUTHENTICATED_ADMIN", order: 3 },
  { id: "operations", label: "Operación", mobileLabel: "Operación", description: "Lotes, checkpoints, excepciones y trabajo en curso.", icon: "package", href: "/admin/ebay-seller-os#operacion", section: "SELLER_OS", permission: "ADMIN", featureRequirement: "SELLER_OPERATIONS", visibility: "AUTHENTICATED_ADMIN", order: 4 },
  { id: "monitoring", label: "Monitoreo", mobileLabel: "Monitoreo", description: "Rendimiento, señales comerciales y recuperación.", icon: "activity", href: "/admin/ebay/seller-performance", section: "SELLER_OS", permission: "ADMIN", featureRequirement: "EBAY_READ_ONLY", visibility: "AUTHENTICATED_ADMIN", order: 5 },
])

export type SellerOsUtilityNavigationItem = Readonly<{
  id: SellerOsUtilityId
  label: string
  href: string
  description: string
}>

export const SELLER_OS_UTILITY_NAVIGATION: readonly SellerOsUtilityNavigationItem[] =
  Object.freeze([
    {
      id: "decisions",
      label: "Decisiones",
      href: "/admin/ebay/mobile-review?section=commercial-monitor",
      description: "Recomendaciones comerciales pendientes de revisión.",
    },
    {
      id: "alerts",
      label: "Alertas",
      href: "/admin/ebay/mobile-review?section=alerts",
      description: "Alertas operativas y comerciales confirmadas.",
    },
    {
      id: "quarantine",
      label: "Cuarentena",
      href: "/admin/ebay-seller-os#operacion",
      description: "Productos aislados con checkpoint preservado.",
    },
    {
      id: "settings",
      label: "Configuración",
      href: "/admin/ebay-seller-os#salud",
      description: "Integraciones, límites, controles y diagnóstico.",
    },
  ])

export function sellerOsNavigationItem(id: SellerOsAreaId) {
  return SELLER_OS_NAVIGATION.find((item) => item.id === id) ?? SELLER_OS_NAVIGATION[0]
}

export function sellerOsBreadcrumbs(id: SellerOsAreaId, currentLabel?: string) {
  const item = sellerOsNavigationItem(id)
  const base = [{ label: "Seller OS", href: "/admin" }, { label: item.label, href: item.href }]
  return currentLabel && currentLabel !== item.label
    ? [...base, { label: currentLabel, href: null }]
    : base
}
