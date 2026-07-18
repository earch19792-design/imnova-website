"use client"

import { SELLER_OS_NAVIGATION, type SellerOsAreaId } from "@/lib/seller-os/navigation"

export function SellerOsMobileNav({ active, operationCount = 0, onNavigate }: { active: SellerOsAreaId; operationCount?: number; onNavigate?: (destination: SellerOsAreaId) => boolean | void }) {
  return (
    <nav aria-label="Cinco áreas principales de Seller OS" className="fixed inset-x-0 bottom-0 z-50 border-t border-white/15 bg-[#070b12]/95 px-1 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur">
      <div className="mx-auto grid max-w-3xl grid-cols-5 gap-1">
        {SELLER_OS_NAVIGATION.map((destination) => {
          const selected = active === destination.id
          return <a key={destination.id} href={destination.href} aria-current={selected ? "page" : undefined} title={destination.description} onClick={(event) => { if (onNavigate?.(destination.id)) event.preventDefault() }} className={`relative flex min-h-16 flex-col items-center justify-center rounded-xl px-1 text-center text-[9px] font-black leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 sm:text-[11px] ${selected ? "bg-white text-black" : "text-white/65"}`}>
            <span aria-hidden="true" className="mb-1 text-base">{destination.icon}</span>{destination.label}
            {destination.id === "operations" && operationCount > 0 && <span className="absolute right-1 top-1 rounded-full bg-rose-500 px-1.5 text-[9px] text-white">{operationCount}</span>}
          </a>
        })}
      </div>
    </nav>
  )
}
