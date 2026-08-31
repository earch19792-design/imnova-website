"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { validateAdminSession } from "@/lib/admin-auth"
import { SellerOsDesktopNavigation } from "./ebay/components/seller-os-desktop-navigation"
import { SellerOsMobileNav } from "./ebay/components/seller-os-mobile-nav"
import { QuickPickDashboardSummary } from "./quick-pick-dashboard-summary"
import { TodayLaunchPanel } from "./today-launch-panel"
import { SELLER_OS_TECHNICAL_AND_LEGACY_ROUTES } from
  "@/lib/seller-os/user-facing-route-inventory"

type HomeState = "LOADING" | "READY" | "UNAVAILABLE"

const commercialAreas = [
  { href: "/admin/ebay/opportunity-queue/research", eyebrow: "💰 Oportunidades para publicar", title: "Night Radar + Quick Pick", copy: "Revisa LISTING_READY y 🟡 Pruebas de mercado con su Dollar Check, sin mezclar demanda probada con evidencia insuficiente." },
  { href: "/admin/ebay/mobile-review", eyebrow: "📦 Listings LIVE", title: "Portfolio y atención", copy: "Abre los listings activos, riesgos reales de stock/economics y la futura superficie del Assistant." },
  { href: "/admin/ebay/experiments", eyebrow: "🧪 Experimentos", title: "Pruebas y resultados", copy: "Compara variantes, protege variables activas y revisa cuándo existe evidencia suficiente para decidir." },
  { href: "/admin/ebay/stock-guard", eyebrow: "Inventario / Stock", title: "Una sola autoridad de stock", copy: "Consulta StockGuard y evidencia Luna sin duplicar alertas en varias pantallas." },
] as const

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
          <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-200/[0.10] via-white/[0.03] to-emerald-200/[0.06] p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-100/60">Inicio operativo</p><h1 className="mt-2 text-2xl font-black leading-tight sm:text-3xl">Tu siguiente decisión, sin ruido</h1></div><span className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${state === "READY" ? "bg-emerald-200 text-black" : "border border-amber-200/30 text-amber-100"}`}>{state === "LOADING" ? "VALIDANDO SESIÓN" : state === "READY" ? "SESIÓN PROTEGIDA" : "REVISAR CONEXIÓN"}</span></div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">Seller OS trabaja en segundo plano, se detiene sólo ante una decisión indispensable y te muestra qué continuará después.</p>
          </header>

          <section aria-labelledby="today-heading" className="mt-5 space-y-4">
            <div><p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-100/60">Hoy</p><h2 id="today-heading" className="mt-1 text-2xl font-black">Tu operación en un solo lugar</h2><p className="mt-2 text-sm leading-6 text-white/60">Empieza un Quick Pick, revisa oportunidades listas o atiende el portfolio LIVE. Las herramientas técnicas quedan separadas.</p></div>
            <QuickPickDashboardSummary />
            <div className="grid gap-3 sm:grid-cols-2">{commercialAreas.map((area) => <a key={area.href} href={area.href} className="block min-h-44 rounded-3xl border border-white/10 bg-white/[0.035] p-5 transition active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"><p className="text-xs font-black uppercase tracking-widest text-white/50">{area.eyebrow}</p><h3 className="mt-2 text-xl font-black">{area.title}</h3><p className="mt-2 text-sm leading-6 text-white/60">{area.copy}</p><span className="mt-4 inline-flex min-h-11 items-center font-black text-cyan-100">Abrir →</span></a>)}</div>
          </section>

          <TodayLaunchPanel />

          <section aria-labelledby="owner-tools-heading" className="mt-5 rounded-3xl border border-white/10 bg-white/[0.025] p-4 sm:p-5"><h2 id="owner-tools-heading" className="text-xl font-black">Owner · Operación y análisis</h2><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{ownerTools.map(([href, label]) => <a key={href} href={href} className="inline-flex min-h-12 items-center rounded-2xl border border-white/10 bg-black/20 px-4 text-sm font-black text-white/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">{label} →</a>)}</div></section>

          <details className="mt-5 rounded-3xl border border-white/10 bg-white/[0.025] p-4 sm:p-5">
            <summary className="flex min-h-11 cursor-pointer items-center font-black text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Owner / Sistema / Herramientas técnicas</summary>
            <p className="mt-3 text-sm leading-6 text-white/55">Diagnóstico, certificación, OAuth y páginas legacy. No forman parte del recorrido comercial normal.</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{SELLER_OS_TECHNICAL_AND_LEGACY_ROUTES.map((route) => <a key={route.href} href={route.href} className="inline-flex min-h-12 items-center rounded-2xl border border-white/10 bg-black/20 px-4 text-sm font-bold text-white/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">{route.label} →</a>)}</div>
          </details>
        </section>
      </div>
      <SellerOsMobileNav active="monitor" hideOnDesktop />
    </main>
  )
}
