"use client"

import type { SellerOsAreaId } from "@/lib/seller-os/navigation"

type LegacySellerOsAreaId =
  | "ebay-opportunities"
  | "listings"
  | "health-settings"

/**
 * Puente temporal para consumidores anteriores al shell.
 * PrimaryNavigation es el único propietario de SELLER_OS_NAVIGATION.map y del DOM.
 */
export function SellerOsMobileNav(_props: {
  active: SellerOsAreaId | LegacySellerOsAreaId
  operationCount?: number
  onNavigate?: (destination: SellerOsAreaId | LegacySellerOsAreaId) => boolean | void
  hideOnDesktop?: boolean
}) {
  return null
}
