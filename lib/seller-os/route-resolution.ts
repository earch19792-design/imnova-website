import {
  sellerOsBreadcrumbs,
  type SellerOsAreaId,
  type SellerOsUtilityId,
} from "./navigation"

export type SellerOsRouteInput = {
  pathname: string
  search?: string
  hash?: string
}

export type SellerOsResolvedRoute = {
  area: SellerOsAreaId
  utility: SellerOsUtilityId | null
  pageLabel: string
  breadcrumbs: ReturnType<typeof sellerOsBreadcrumbs>
}

function normalizedPart(value: string | undefined, marker: "?" | "#") {
  if (!value) return ""
  return value.startsWith(marker) ? value.slice(1) : value
}

function productRoute(pathname: string) {
  return pathname.startsWith("/admin/ebay/listing-workspace") ||
    pathname.startsWith("/admin/ebay/listing-optimization") ||
    pathname.startsWith("/admin/ebay/listings/register")
}

export function resolveSellerOsRoute({
  pathname,
  search,
  hash,
}: SellerOsRouteInput): SellerOsResolvedRoute {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/"
  const params = new URLSearchParams(normalizedPart(search, "?"))
  const normalizedHash = normalizedPart(hash, "#").toLowerCase()
  const section = params.get("section")?.toLowerCase() ?? ""
  const hasImprovement = Boolean(params.get("improvement"))

  let area: SellerOsAreaId = "home"
  let utility: SellerOsUtilityId | null = null
  let pageLabel = "Inicio"

  if (normalizedPath === "/admin") {
    area = "home"
  } else if (
    normalizedPath.startsWith("/admin/ebay/seller-performance") ||
    (normalizedPath.startsWith("/admin/ebay/mobile-review") &&
      (section === "commercial-monitor" || hasImprovement))
  ) {
    area = "monitoring"
    pageLabel = hasImprovement ? "Decisión comercial" : "Monitoreo comercial"
    utility = hasImprovement || section === "commercial-monitor" ? "decisions" : null
  } else if (productRoute(normalizedPath)) {
    area = "products"
    pageLabel = normalizedPath.includes("listing-optimization")
      ? "Optimización del listing"
      : normalizedPath.includes("/listings/register")
        ? "Vincular listing"
        : "Preparación de productos"
  } else if (normalizedPath.startsWith("/admin/ebay-seller-os")) {
    area = "operations"
    pageLabel = normalizedHash === "salud" ? "Configuración" : "Operación"
    utility = normalizedHash === "salud"
      ? "settings"
      : normalizedHash.includes("quarantine")
        ? "quarantine"
        : null
  } else if (
    normalizedPath.startsWith("/admin/ebay/mobile-review") ||
    normalizedPath.startsWith("/admin/ebay/opportunity-queue")
  ) {
    area = normalizedHash === "listing-optimization-tasks-heading"
      ? "products"
      : "opportunities"
    pageLabel = normalizedHash === "competitor-watch-heading"
      ? "Observación de competidores"
      : section === "alerts"
        ? "Alertas"
        : "Oportunidades para revisar"
    utility = section === "alerts" ? "alerts" : null
  } else if (normalizedPath.startsWith("/admin/ebay")) {
    area = "operations"
    pageLabel = "Operación"
  }

  return {
    area,
    utility,
    pageLabel,
    breadcrumbs: sellerOsBreadcrumbs(area, pageLabel),
  }
}
