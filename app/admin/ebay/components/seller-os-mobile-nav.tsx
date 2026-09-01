"use client"

import { SELLER_OS_MOBILE_NAVIGATION, type SellerOsAreaId } from "@/lib/seller-os/navigation"
import { Bolt, FileText, FlaskConical, LayoutDashboard, Search, type LucideIcon } from "lucide-react"

const icons: Partial<Record<SellerOsAreaId, LucideIcon>> = {
  monitor: LayoutDashboard,
  "quick-pick": Bolt,
  opportunities: Search,
  listings: FileText,
  experiments: FlaskConical,
}

export function SellerOsMobileNav({ active, onNavigate, hideOnDesktop = false }: { active: SellerOsAreaId; onNavigate?: (destination: SellerOsAreaId) => boolean | void; hideOnDesktop?: boolean }) {
  return (
    <nav aria-label="Navegación principal móvil de Seller OS" className={`fixed inset-x-2 bottom-2 z-50 rounded-[1.35rem] border border-white/15 bg-[#111722]/90 px-1 pb-[env(safe-area-inset-bottom)] pt-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl sm:inset-x-4 ${hideOnDesktop ? "xl:hidden" : ""}`}>
      <div className="mx-auto grid max-w-3xl grid-cols-5 gap-0.5">
        {SELLER_OS_MOBILE_NAVIGATION.map((destination) => {
          const selected = active === destination.id
          const Icon = icons[destination.id] ?? LayoutDashboard
          return <a key={destination.id} href={destination.href} aria-current={selected ? "page" : undefined} aria-label={destination.label} title={destination.description} onClick={(event) => { if (onNavigate?.(destination.id)) event.preventDefault() }} className={`relative flex min-h-16 min-w-0 flex-col items-center justify-center rounded-xl px-1 text-center text-[11px] font-black leading-tight transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 sm:text-[13px] ${selected ? "bg-white text-black" : "text-white/65 hover:bg-white/[0.06] hover:text-white"}`}>
            <Icon aria-hidden="true" size={20} strokeWidth={selected ? 2.7 : 2} className="mb-1 shrink-0" /><span className="block max-w-full truncate">{destination.mobileLabel}</span>
          </a>
        })}
      </div>
    </nav>
  )
}
