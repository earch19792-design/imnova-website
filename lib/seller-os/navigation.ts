export type SellerOsAreaId =
  | "monitor"
  | "listings"
  | "opportunities"
  | "experiments"
  | "inventory"
  | "orders"
  | "decisions"
  | "learning"
  | "system-status"
export type SellerOsNavStatus = "ACTIVE" | "LIMITED" | "PAUSED"
export type SellerOsNavigationGroupId =
  | "COMMAND"
  | "SALES"
  | "GROWTH"
  | "OPERATIONS"
  | "INTELLIGENCE"
  | "SYSTEM"

export type SellerOsNavigationItem = Readonly<{
  id: SellerOsAreaId
  label: string
  mobileLabel: string
  description: string
  objective: string
  icon: "monitor" | "file" | "sparkles" | "flask" | "inventory" |
    "orders" | "decisions" | "learning" | "system"
  href: string
  group: SellerOsNavigationGroupId
  mobilePrimary: boolean
  section: "SELLER_OS"
  permission: "ADMIN"
  featureRequirement: string | null
  visibility: "AUTHENTICATED_ADMIN"
  order: number
  status: SellerOsNavStatus
}>

export const SELLER_OS_NAVIGATION: readonly SellerOsNavigationItem[] = Object.freeze([
  { id: "monitor", label: "Inicio", mobileLabel: "Inicio", description: "Aquí ves qué necesita atención y entras a cada herramienta de Seller OS.", objective: "Decidir y actuar desde un único punto de entrada.", icon: "monitor", href: "/admin", group: "COMMAND", mobilePrimary: true, section: "SELLER_OS", permission: "ADMIN", featureRequirement: "EBAY_READ_ONLY", visibility: "AUTHENTICATED_ADMIN", order: 1, status: "ACTIVE" },
  { id: "listings", label: "Publicaciones", mobileLabel: "Publicaciones", description: "Aquí preparas, revisas y continúas publicaciones y borradores.", objective: "Publicar información correcta sólo después de completar las verificaciones.", icon: "file", href: "/admin/ebay/listing-workspace", group: "SALES", mobilePrimary: true, section: "SELLER_OS", permission: "ADMIN", featureRequirement: "EBAY_LISTING_WORKSPACE", visibility: "AUTHENTICATED_ADMIN", order: 2, status: "LIMITED" },
  { id: "opportunities", label: "Oportunidades", mobileLabel: "Oportunidades", description: "Aquí investigas productos, mercado, precio y referencias comparables.", objective: "Encontrar qué merece validación de proveedor antes de invertir tiempo o capital.", icon: "sparkles", href: "/admin/ebay/opportunity-queue/research", group: "GROWTH", mobilePrimary: true, section: "SELLER_OS", permission: "ADMIN", featureRequirement: "EBAY_READ_ONLY", visibility: "AUTHENTICATED_ADMIN", order: 3, status: "ACTIVE" },
  { id: "experiments", label: "Experimentos", mobileLabel: "Experimentos", description: "Aquí observas pruebas activas, variables protegidas y resultados listos.", objective: "Aprender qué mejora funciona sin cambiar varias cosas a la vez.", icon: "flask", href: "/admin/ebay/experiments", group: "GROWTH", mobilePrimary: false, section: "SELLER_OS", permission: "ADMIN", featureRequirement: "EXPERIMENT_GUARDIAN", visibility: "AUTHENTICATED_ADMIN", order: 4, status: "ACTIVE" },
  { id: "inventory", label: "Inventario", mobileLabel: "Inventario", description: "Aquí revisas stock, vínculos de proveedor y evidencia de Luna Portex.", objective: "Detectar faltantes y evidencia vencida sin confundir desconocido con riesgo.", icon: "inventory", href: "/admin/ebay/stock-guard", group: "OPERATIONS", mobilePrimary: true, section: "SELLER_OS", permission: "ADMIN", featureRequirement: "SELLER_OPERATIONS", visibility: "AUTHENTICATED_ADMIN", order: 5, status: "ACTIVE" },
  { id: "orders", label: "Órdenes", mobileLabel: "Órdenes", description: "Aquí das seguimiento a órdenes, fulfillment y excepciones operativas.", objective: "Resolver lo urgente sin exponer datos del comprador ni ejecutar cambios inseguros.", icon: "orders", href: "/admin/ebay-seller-os#operacion", group: "OPERATIONS", mobilePrimary: false, section: "SELLER_OS", permission: "ADMIN", featureRequirement: "SELLER_OPERATIONS", visibility: "AUTHENTICATED_ADMIN", order: 6, status: "LIMITED" },
  { id: "decisions", label: "Decisiones", mobileLabel: "Decisiones", description: "Aquí encuentras prioridades, excepciones y la siguiente acción recomendada.", objective: "Separar acciones reales de evidencia pendiente y evitar trabajo innecesario.", icon: "decisions", href: "/admin/ebay/decisions", group: "INTELLIGENCE", mobilePrimary: false, section: "SELLER_OS", permission: "ADMIN", featureRequirement: "SELLER_INTELLIGENCE", visibility: "AUTHENTICATED_ADMIN", order: 7, status: "ACTIVE" },
  { id: "learning", label: "Aprendizaje", mobileLabel: "Aprendizaje", description: "Aquí ves resultados comprobados que podrían reutilizarse con seguridad.", objective: "Transferir sólo aprendizajes respaldados por resultados comparables.", icon: "learning", href: "/admin/ebay/learning", group: "INTELLIGENCE", mobilePrimary: false, section: "SELLER_OS", permission: "ADMIN", featureRequirement: "SELLER_INTELLIGENCE", visibility: "AUTHENTICATED_ADMIN", order: 8, status: "ACTIVE" },
  { id: "system-status", label: "Estado del sistema", mobileLabel: "Sistema", description: "Aquí revisas conexiones, capacidades limitadas y controles de seguridad.", objective: "Saber qué puede hacer Seller OS, qué está bloqueado y por qué.", icon: "system", href: "/admin/ebay/operational-readiness", group: "SYSTEM", mobilePrimary: true, section: "SELLER_OS", permission: "ADMIN", featureRequirement: "SELLER_CONFIGURATION", visibility: "AUTHENTICATED_ADMIN", order: 9, status: "ACTIVE" },
])

export const SELLER_OS_NAVIGATION_GROUPS: ReadonlyArray<Readonly<{
  id: SellerOsNavigationGroupId
  label: string
}>> = Object.freeze([
  { id: "COMMAND", label: "INICIO" },
  { id: "SALES", label: "VENTAS" },
  { id: "GROWTH", label: "CRECIMIENTO" },
  { id: "OPERATIONS", label: "OPERACIÓN" },
  { id: "INTELLIGENCE", label: "INTELIGENCIA" },
  { id: "SYSTEM", label: "SISTEMA" },
])

export const SELLER_OS_MOBILE_NAVIGATION = Object.freeze(
  SELLER_OS_NAVIGATION.filter((item) => item.mobilePrimary),
)

export function sellerOsNavigationItem(id: SellerOsAreaId) {
  return SELLER_OS_NAVIGATION.find((item) => item.id === id) ?? SELLER_OS_NAVIGATION[0]
}

export function sellerOsBreadcrumbs(id: SellerOsAreaId) {
  const item = sellerOsNavigationItem(id)
  return [{ label: "Seller OS", href: "/admin" }, { label: item.label, href: item.href }]
}
