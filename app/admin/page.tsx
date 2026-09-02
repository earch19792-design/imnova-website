"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { validateSellerOsSession } from "@/lib/admin-auth"
import {
  SELLER_OS_ACCESS_ROLES,
  type SellerOsAccessRole,
} from "@/lib/seller-os-access-control"
import { SellerOsDesktopNavigation } from "./ebay/components/seller-os-desktop-navigation"
import { SellerOsMobileNav } from "./ebay/components/seller-os-mobile-nav"
import { RemoteLiveOptimizationOperator } from
  "./remote-live-optimization-operator"
import { RemoteOperatorEnrollmentControl } from
  "./remote-operator-enrollment-control"
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
  const [role, setRole] = useState<SellerOsAccessRole | null>(null)
  const [remoteLiveOpen, setRemoteLiveOpen] = useState(false)

  useEffect(() => {
    let active = true
    validateSellerOsSession().then(async (result) => {
      if (!active) return
      if (!result.authorized || !result.role ||
          !result.session?.access_token) {
        router.replace("/admin/login?returnTo=/admin")
        return
      }
      const response = await fetch("/api/admin/session", { method: "POST", headers: { Authorization: `Bearer ${result.session.access_token}` } })
      if (!active) return
      if (response.ok) setRole(result.role)
      setState(response.ok ? "READY" : "UNAVAILABLE")
    }).catch(() => { if (active) setState("UNAVAILABLE") })
    return () => { active = false }
  }, [router])

  if (state !== "READY" || !role) {
    return <main className="flex min-h-screen items-center justify-center bg-[#05070d] px-5 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.035] p-6 text-center">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/60">Seller OS</p>
        <h1 className="mt-2 text-xl font-black">{state === "UNAVAILABLE"
          ? "No pude abrir la sesión" : "Preparando tu espacio…"}</h1>
        <p className="mt-2 text-sm leading-6 text-white/55">{state === "UNAVAILABLE"
          ? "La sesión no pudo verificarse. No se cargó ninguna herramienta y no necesitas hacer nada técnico."
          : "Validando tu acceso y preparando únicamente las herramientas de tu rol."}</p>
        {state === "UNAVAILABLE" && <button type="button"
          onClick={() => window.location.reload()}
          className="mt-5 min-h-12 rounded-xl border border-cyan-200/30 px-5 text-sm font-black text-cyan-100">
          REINTENTAR
        </button>}
      </section>
    </main>
  }

  if (state === "READY" && role ===
      SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator) {
    return <RemoteLiveOptimizationOperator />
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#05070d] px-4 pb-28 pt-4 text-white sm:px-6">
      <SellerOsDesktopNavigation active="monitor" />
      <div className="mx-auto max-w-7xl xl:pl-[232px]">
        <section className="min-w-0 xl:pl-5">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 py-3 sm:py-4">
            <div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-100/60">Hoy</p><h1 className="mt-1 text-2xl font-black leading-tight sm:text-3xl">Seller OS</h1><p className="mt-1 text-sm text-white/55">Publica, atiende y comprueba el sistema desde aquí.</p></div>
            <span className="shrink-0 rounded-full bg-emerald-200 px-3 py-2 text-xs font-black text-black">SESIÓN PROTEGIDA</span>
          </header>

          <section aria-labelledby="today-heading" className="mt-4">
            <h2 id="today-heading" className="sr-only">Operación de hoy</h2>
            <SellerOsOperationalDashboard />
          </section>

          <details className="mt-5 rounded-3xl border border-violet-200/15 bg-violet-200/[0.035] p-4 sm:p-5"
            onToggle={(event) => setRemoteLiveOpen(event.currentTarget.open)}>
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 font-black text-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-200">
              <span>Remote LIVE Optimization</span>
              <span className="text-xs text-white/45">Vista operadora</span>
            </summary>
            <p className="mt-2 text-sm leading-6 text-white/55">Previsualiza la experiencia LIVE acotada. Publicaciones nuevas, postventa, credenciales, fin de listings y gasto sin aprobar permanecen owner-only.</p>
            <RemoteOperatorEnrollmentControl />
            {remoteLiveOpen && <RemoteLiveOptimizationOperator embeddedForOwner />}
          </details>

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
