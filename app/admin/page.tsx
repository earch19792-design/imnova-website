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
    <main className="min-h-screen bg-[#05070d] px-4 pb-28 pt-4 text-white sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[16rem_1fr]">
        <aside className="hidden rounded-3xl border border-white/10 bg-white/[0.035] p-4 lg:block">
          <p className="px-3 text-xs font-black tracking-[0.24em] text-cyan-200">SELLER OS</p>
          <nav aria-label="Áreas principales de Seller OS" className="mt-6 space-y-2">{SELLER_OS_NAVIGATION.map((item) => <a key={item.id} href={item.href} title={item.description} className={`block rounded-2xl p-3 ${item.id === "home" ? "bg-white text-black" : "text-white/65 hover:bg-white/10 hover:text-white"}`}><span className="mr-3" aria-hidden="true">{item.icon}</span><span className="text-sm font-black">{item.label}</span></a>)}</nav>
        </aside>

        <section>
          <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-200/[0.10] via-white/[0.03] to-emerald-200/[0.06] p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-100/60">Inicio operativo</p><h1 className="mt-2 text-3xl font-black">¿Qué necesita atención ahora?</h1></div><span className={`rounded-full px-3 py-2 text-xs font-black ${state === "READY" ? "bg-emerald-200 text-black" : "border border-amber-200/30 text-amber-100"}`}>{state === "LOADING" ? "VALIDANDO SESIÓN" : state === "READY" ? "SESIÓN PROTEGIDA" : "REVISAR CONEXIÓN"}</span></div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">Seller OS coordina el piloto de hoy con trabajo automático y confirmaciones humanas puntuales. La publicación continúa siendo manual en Seller Hub; producción y escrituras eBay permanecen intactas.</p>
          </header>

          <TodayLaunchPanel />

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([title, status, detail]) => <article key={title} className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"><p className="text-xs font-black uppercase tracking-wider text-white/45">{title}</p><h2 className="mt-3 text-lg font-black">{status}</h2><p className="mt-2 text-sm leading-6 text-white/55">{detail}</p></article>)}</div>
        </section>
      </div>
      <SellerOsMobileNav active="home" />
    </main>
  )
}
