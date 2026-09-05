"use client"

import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import type { SellerOsAreaId } from "@/lib/seller-os/navigation"
import { sellerOsNavigationItem } from "@/lib/seller-os/navigation"
import { SellerOsDesktopNavigation } from "./components/seller-os-desktop-navigation"
import { SellerOsMobileNav } from "./components/seller-os-mobile-nav"

function activeArea(pathname: string): SellerOsAreaId {
  if (pathname.includes("/quick-pick") ||
      pathname.includes("/listing-workspace") ||
      pathname.includes("/listings/register")) return "publish"
  if (pathname.includes("/opportunity") ||
      pathname.includes("/mobile-review")) return "opportunities"
  if (pathname.includes("/listing-quality") ||
      pathname.includes("/listing-optimization") ||
      pathname.includes("/seller-performance") ||
      pathname.endsWith("/monitor")) return "live"
  if (pathname.includes("/post-sale")) return "post-sale"
  if (pathname.includes("/mayel")) return "mayel"
  if (pathname.includes("/sales")) return "sales"
  if (pathname.includes("/experiments")) return "experiments"
  if (pathname.includes("/stock-guard") ||
      pathname.includes("/luna-supplier-linkage-review")) return "stockguard"
  if (pathname.includes("/operational-readiness") ||
      pathname.includes("/luna-capture") ||
      pathname.includes("/luna-protected-session") ||
      pathname.includes("/luna-shipping-capture") ||
      pathname.includes("/decisions") || pathname.includes("/learning") ||
      pathname.includes("/copilot") || pathname.includes("/strategic-review")) {
    return "administration"
  }
  return "home"
}

export default function SellerOsEbayLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const captureOnly = pathname.includes("/product-research-capture")
  if (captureOnly) return children
  // These compatibility workspaces already render the same canonical desktop
  // and mobile navigation components. Keeping the shell out here prevents two
  // simultaneous menus without coupling their existing runtimes to a route
  // deletion or rewrite.
  const pageOwnsNavigation = [
    "/admin/ebay/quick-pick",
    "/admin/ebay/mobile-review",
    "/admin/ebay/listing-optimization",
    "/admin/ebay/seller-performance",
    "/admin/ebay/monitor",
    "/admin/ebay/listings/register",
  ].includes(pathname)
  if (pageOwnsNavigation) return children
  const area = activeArea(pathname)
  const activeItem = sellerOsNavigationItem(area)

  return (
    <div className="min-h-screen xl:pl-[272px]">
      <SellerOsDesktopNavigation active={area} />
      <section aria-label={`Ayuda de ${activeItem.label}`} className="border-b border-cyan-200/20 bg-[#101b2c] px-4 py-3 text-white xl:hidden">
        <p className="text-[13px] font-black uppercase tracking-[0.1em] text-cyan-200">Estás en {activeItem.label}</p>
        <p className="mt-1 text-[13px] leading-5 text-slate-300">{activeItem.description} <strong className="text-white">Objetivo:</strong> {activeItem.objective}</p>
      </section>
      {children}
      <SellerOsMobileNav active={area} hideOnDesktop />
    </div>
  )
}
