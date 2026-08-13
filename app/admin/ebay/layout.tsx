"use client"

import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import type { SellerOsAreaId } from "@/lib/seller-os/navigation"
import { sellerOsNavigationItem } from "@/lib/seller-os/navigation"
import { SellerOsDesktopNavigation } from "./components/seller-os-desktop-navigation"

function activeArea(pathname: string): SellerOsAreaId {
  if (pathname.includes("/listing")) return "listings"
  if (pathname.includes("/opportunity") || pathname.includes("/mobile-review")) return "opportunities"
  if (pathname.includes("/experiments")) return "experiments"
  if (pathname.includes("/stock-guard") || pathname.includes("/luna-capture")) return "inventory"
  if (pathname.includes("/decisions")) return "decisions"
  if (pathname.includes("/learning")) return "learning"
  if (pathname.includes("/operational-readiness")) return "system-status"
  return "monitor"
}

export default function SellerOsEbayLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const captureOnly = pathname.includes("/product-research-capture")
  if (captureOnly) return children
  const area = activeArea(pathname)
  const activeItem = sellerOsNavigationItem(area)

  return (
    <div className="min-h-screen xl:pl-[232px]">
      <SellerOsDesktopNavigation active={area} />
      <section aria-label={`Ayuda de ${activeItem.label}`} className="border-b border-cyan-200/20 bg-[#101b2c] px-4 py-3 text-white xl:hidden">
        <p className="text-[13px] font-black uppercase tracking-[0.1em] text-cyan-200">Estás en {activeItem.label}</p>
        <p className="mt-1 text-[13px] leading-5 text-slate-300">{activeItem.description} <strong className="text-white">Objetivo:</strong> {activeItem.objective}</p>
      </section>
      {children}
    </div>
  )
}
