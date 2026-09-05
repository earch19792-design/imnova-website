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
import { SellerOsHomeDashboardV1 } from "./seller-os-home-dashboard-v1"

type HomeState = "LOADING" | "READY" | "UNAVAILABLE"

export default function SellerOsAdminHome() {
  const router = useRouter()
  const [state, setState] = useState<HomeState>("LOADING")
  const [role, setRole] = useState<SellerOsAccessRole | null>(null)

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
      <SellerOsDesktopNavigation active="home" />
      <div className="mx-auto max-w-7xl xl:pl-[272px]">
        <section className="min-w-0 xl:pl-5">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 py-3 sm:py-4">
            <div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-100/60">Inicio</p><h1 className="mt-1 text-2xl font-black leading-tight sm:text-3xl">¿Qué necesita atención ahora?</h1><p className="mt-1 text-sm text-white/55">Una autoridad operacional común; desconocido nunca se presenta como cero.</p></div>
            <span className="shrink-0 rounded-full bg-emerald-200 px-3 py-2 text-xs font-black text-black">SESIÓN PROTEGIDA</span>
          </header>

          <section aria-labelledby="today-heading" className="mt-4">
            <h2 id="today-heading" className="sr-only">Operación de hoy</h2>
            <SellerOsHomeDashboardV1 />
          </section>
        </section>
      </div>
      <SellerOsMobileNav active="home" hideOnDesktop />
    </main>
  )
}
