"use client"

import {
  SELLER_OS_MOBILE_NAVIGATION,
  SELLER_OS_PRIMARY_NAVIGATION,
  SELLER_OS_SYSTEM_NAVIGATION,
  type SellerOsAreaId,
} from "@/lib/seller-os/navigation"
import { Activity, Home, Menu, PackageCheck, Sparkles,
  type LucideIcon } from "lucide-react"

const icons: Partial<Record<SellerOsAreaId, LucideIcon>> = {
  home: Home,
  publish: PackageCheck,
  opportunities: Sparkles,
  live: Activity,
}

export function SellerOsMobileNav({ active, onNavigate,
  hideOnDesktop = false }: { active: SellerOsAreaId;
  onNavigate?: (destination: SellerOsAreaId) => boolean | void;
  hideOnDesktop?: boolean }) {
  const overflow = [...SELLER_OS_PRIMARY_NAVIGATION.slice(4),
    ...SELLER_OS_SYSTEM_NAVIGATION]
  const activePrimary = SELLER_OS_PRIMARY_NAVIGATION.find((item) =>
    item.id === active)
  const activeTopLevelChildren = activePrimary &&
      !overflow.some((item) => item.id === active)
    ? activePrimary.children : []
  return (
    <nav aria-label="Navegación principal móvil de Seller OS"
      className={`fixed inset-x-2 bottom-2 z-50 rounded-[1.35rem] border border-white/15 bg-[#111722]/95 px-1 pb-[env(safe-area-inset-bottom)] pt-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl sm:inset-x-4 ${hideOnDesktop ? "xl:hidden" : ""}`}>
      <div className="mx-auto grid max-w-3xl grid-cols-5 gap-0.5">
        {SELLER_OS_MOBILE_NAVIGATION.map((destination) => {
          const selected = active === destination.id
          const Icon = icons[destination.id] ?? Home
          return <a key={destination.id} href={destination.href}
            aria-current={selected ? "page" : undefined}
            aria-label={destination.label} title={destination.description}
            onClick={(event) => {
              if (onNavigate?.(destination.id)) event.preventDefault()
            }}
            className={`relative flex min-h-16 min-w-0 flex-col items-center justify-center rounded-xl px-1 text-center text-[11px] font-black leading-tight transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 sm:text-[13px] ${selected ? "bg-white text-black" : "text-white/65 hover:bg-white/[0.06] hover:text-white"}`}>
            <Icon aria-hidden="true" size={20}
              strokeWidth={selected ? 2.7 : 2} className="mb-1 shrink-0" />
            <span className="block max-w-full truncate">
              {destination.mobileLabel}
            </span>
          </a>
        })}
        <details className="group relative min-w-0">
          <summary className={`flex min-h-16 cursor-pointer list-none flex-col items-center justify-center rounded-xl px-1 text-center text-[11px] font-black text-white/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200 sm:text-[13px] ${overflow.some((item) => item.id === active) ? "bg-white text-black" : ""}`}>
            <Menu aria-hidden="true" size={20} className="mb-1" />Más
          </summary>
          <div className="absolute bottom-[4.65rem] right-0 w-[min(88vw,320px)] rounded-2xl border border-white/15 bg-[#101b2c] p-2 shadow-2xl">
            {activeTopLevelChildren.length > 0 && <section
              aria-label={`Secciones de ${activePrimary?.label ?? "Seller OS"}`}
              className="mb-2 border-b border-white/10 pb-2">
              <p className="px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-200/70">
                Secciones de {activePrimary?.label}
              </p>
              {activeTopLevelChildren.map((child) => <a key={child.id}
                href={child.href}
                className="flex min-h-10 items-center justify-between rounded-lg px-3 text-xs font-semibold text-white/65 hover:bg-white/[0.05] hover:text-white">
                {child.label}
                {child.status === "PAUSED" && <span
                  className="text-[9px] uppercase text-amber-200">Pausa</span>}
              </a>)}
            </section>}
            {overflow.map((item) => <div key={item.id}>
              <a href={item.href}
                aria-current={item.id === active ? "page" : undefined}
                className="flex min-h-11 items-center justify-between rounded-xl px-3 text-sm font-black text-white/80 hover:bg-white/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">
                {item.label}<span className="text-white/35">→</span>
              </a>
              {item.id === active && item.children.length > 0 && <div
                className="mb-2 ml-3 border-l border-white/10 pl-2">
                {item.children.map((child) => <a key={child.id}
                  href={child.href}
                  className="flex min-h-10 items-center rounded-lg px-2 text-xs font-semibold text-white/55 hover:bg-white/[0.05] hover:text-white">
                  {child.label}
                </a>)}
              </div>}
            </div>)}
          </div>
        </details>
      </div>
    </nav>
  )
}
