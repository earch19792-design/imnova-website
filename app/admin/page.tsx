"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { SELLER_OS_NAVIGATION } from "@/lib/seller-os/navigation"
import { validateAdminSession } from "@/lib/admin-auth"
import { SellerOsMobileNav } from "./ebay/components/seller-os-mobile-nav"
import { TodayLaunchPanel } from "./today-launch-panel"

type HomeState = "LOADING" | "READY" | "UNAVAILABLE"

const cards = [
  ["Estado del sistema", "Protecciones activas", "OpenAI y publicaciones continúan apagados."],
  ["Piloto 1/3", "Loop 2 activo", "Ficha técnica en pausa durante el aislamiento del dominio."],
  ["Acción requerida", "Validar aislamiento", "Revisar portada, acceso, menú y llamadas de red en staging."],
  ["Oportunidades activas", "Top 20 protegido", "Discovery y Product Research conservan su evidencia."],
  ["Listings en proceso", "Preparación controlada", "Ningún listing se publica desde esta pantalla."],
  ["Órdenes y fulfillment", "Sólo monitoreo", "Compra Luna, tracking y excepciones permanecen bajo revisión."],
  ["Monitoreo comercial 24 h", "Configurado", "Las alertas operativas se mantienen separadas del dominio público."],
  ["Jobs y pausas", "Automatización restringida", "Los procesos sensibles requieren autorización explícita."],
  ["Riesgos de cuenta", "Sin escritura eBay", "Cero cambios de producción desde esta depuración."],
  ["Actividad reciente", "Aislamiento en curso", "Portada, autenticación y navegación Seller OS actualizadas."],
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
      <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[16rem_1fr]">
        <aside className="hidden self-start rounded-3xl border border-white/10 bg-white/[0.035] p-4 lg:sticky lg:top-4 lg:block">
          <p className="px-3 text-xs font-black tracking-[0.24em] text-cyan-200">SELLER OS</p>
          <nav aria-label="Áreas principales de Seller OS" className="mt-6 space-y-2">{SELLER_OS_NAVIGATION.map((item) => <a key={item.id} href={item.href} aria-current={item.id === "home" ? "page" : undefined} title={item.description} className={`flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 ${item.id === "home" ? "bg-white text-black" : "text-white/65 hover:bg-white/10 hover:text-white"}`}><span className={`flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-black ${item.id === "home" ? "bg-black/10" : "bg-white/[0.06] text-cyan-100"}`} aria-hidden="true">0{item.order}</span><span className="min-w-0"><span className="block text-sm font-black leading-5">{item.label}</span><span className={`mt-0.5 block text-[10px] font-bold uppercase tracking-wider ${item.id === "home" ? "text-black/55" : "text-white/35"}`}>{item.status === "ACTIVE" ? "Disponible" : "Limitado"}</span></span></a>)}</nav>
        </aside>

        <section className="min-w-0">
          <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-200/[0.10] via-white/[0.03] to-emerald-200/[0.06] p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-100/60">Inicio operativo</p><h1 className="mt-2 text-2xl font-black leading-tight sm:text-3xl">Tu siguiente decisión, sin ruido</h1></div><span className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${state === "READY" ? "bg-emerald-200 text-black" : "border border-amber-200/30 text-amber-100"}`}>{state === "LOADING" ? "VALIDANDO SESIÓN" : state === "READY" ? "SESIÓN PROTEGIDA" : "REVISAR CONEXIÓN"}</span></div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">Seller OS permanece en análisis read-only durante Pilot Mode. Toda automatización y cambio externo continúa bloqueado.</p>
          </header>

          <TodayLaunchPanel />

          <details className="mt-5 rounded-3xl border border-white/10 bg-white/[0.025] p-4 sm:p-5">
            <summary className="flex min-h-11 cursor-pointer items-center font-black text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200">Ver resumen de las demás áreas</summary>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([title, status, detail]) => <article key={title} className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-xs font-black uppercase tracking-wider text-white/45">{title}</p><h2 className="mt-2 break-words text-base font-black">{status}</h2><p className="mt-2 text-sm leading-6 text-white/55">{detail}</p></article>)}</div>
          </details>
        </section>
      </div>
      <SellerOsMobileNav active="home" hideOnDesktop />
    </main>
  )
}
