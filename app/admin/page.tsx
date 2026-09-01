"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { validateAdminSession } from "@/lib/admin-auth"
import { SellerOsDesktopNavigation } from "./ebay/components/seller-os-desktop-navigation"
import { SellerOsMobileNav } from "./ebay/components/seller-os-mobile-nav"
import { SellerOsOperationalDashboard } from "./seller-os-operational-dashboard"
import { SELLER_OS_TECHNICAL_AND_LEGACY_ROUTES } from
  "@/lib/seller-os/user-facing-route-inventory"

type HomeState = "LOADING" | "READY" | "UNAVAILABLE"

const ownerTools = [
  ["/admin/ebay/listing-workspace", "Listing Workspace"],
  ["/admin/ebay/listing-optimization", "Command Center"],
  ["/admin/ebay/monitor", "Monitor comercial"],
  ["/admin/ebay/decisions", "Decisiones"],
  ["/admin/ebay/seller-performance", "Rendimiento"],
  ["/admin/ebay/copilot", "Copilot"],
  ["/admin/ebay/learning", "Aprendizaje"],
  ["/admin/ebay/strategic-review", "Revisión estratégica"],
  ["/admin/ebay/listings/register", "Vincular listing LIVE"],
] as const

export default function SellerOsAdminHome() {
  const router = useRouter()
  const [state, setState] = useState<HomeState>("LOADING")

  useEffect(() => {
    let active = true
    validateAdminSession().then(async (result) => {
      if (!active) return
      if (!result.isAdmin || !result.session?.access_token) {
        router.replace("/admin/login?returnTo=/admin")
        return
      }
      const response = await fetch("/api/admin/session", { method: "POST", headers: { Authorization: `Bearer ${result.session.access_token}` } })
      if (!active) return
      setState(response.ok ? "READY" : "UNAVAILABLE")
    }).catch(() => { if (active) setState("UNAVAILABLE") })
    return () => { active = false }
  }, [router])

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#05070d] px-4 pb-28 pt-4 text-white sm:px-6">
      <SellerOsDesktopNavigation active="monitor" />
      <div className="mx-auto max-w-7xl xl:pl-[232px]">
        <section className="min-w-0 xl:pl-5">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 py-3 sm:py-4">
            <div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-100/60">Hoy</p><h1 className="mt-1 text-2xl font-black leading-tight sm:text-3xl">Seller OS</h1><p className="mt-1 text-sm text-white/55">Publica, atiende y comprueba el sistema desde aquí.</p></div>
            <span className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${state === "READY" ? "bg-emerald-200 text-black" : "border border-amber-200/30 text-amber-100"}`}>{state === "LOADING" ? "VALIDANDO SESIÓN" : state === "READY" ? "SESIÓN PROTEGIDA" : "REVISAR CONEXIÓN"}</span>
          </header>

          <section aria-labelledby="today-heading" className="mt-4">
            <h2 id="today-heading" className="sr-only">Operación de hoy</h2>
            <SellerOsOperationalDashboard />
          </section>

          <details className="mt-5 rounded-3xl border border-white/10 bg-white/[0.025] p-4 sm:p-5">
            <summary className="flex min-h-11 cursor-pointer items-center font-black text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Owner / Sistema / Herramientas técnicas</summary>
            <p className="mt-3 text-sm leading-6 text-white/55">Operación avanzada, diagnóstico, certificación, OAuth y páginas legacy. No compiten con el recorrido comercial diario.</p>
            <h2 className="mt-4 text-sm font-black uppercase tracking-widest text-white/45">Owner</h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{ownerTools.map(([href, label]) => <a key={href} href={href} className="inline-flex min-h-12 items-center rounded-2xl border border-white/10 bg-black/20 px-4 text-sm font-black text-white/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">{label} →</a>)}</div>
            <h2 className="mt-5 text-sm font-black uppercase tracking-widest text-white/45">Sistema y legacy</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{SELLER_OS_TECHNICAL_AND_LEGACY_ROUTES.map((route) => <a key={route.href} href={route.href} className="inline-flex min-h-12 items-center rounded-2xl border border-white/10 bg-black/20 px-4 text-sm font-bold text-white/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">{route.label} →</a>)}</div>
          </details>
        </section>
      </div>
      <SellerOsMobileNav active="monitor" hideOnDesktop />
    </main>
  )
}
