"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { validateAdminSession } from "@/lib/admin-auth"

import { TodayLaunchPanel } from "./today-launch-panel"

type HomeState = "LOADING" | "READY" | "UNAVAILABLE"

const operatingPrinciples = [
  {
    title: "Seller OS observa",
    detail:
      "Las lecturas, checkpoints y evidencias continúan en el servidor aunque cambies de pantalla.",
  },
  {
    title: "Seller OS explica",
    detail:
      "Cada bloqueo debe indicar qué ocurrió, qué información se conserva y qué sucederá después.",
  },
  {
    title: "Tú autorizas lo crítico",
    detail:
      "Publicar, cambiar precio, activar promociones y resolver excepciones sensibles conserva revisión humana.",
  },
] as const

export default function SellerOsAdminHome() {
  const router = useRouter()
  const [state, setState] = useState<HomeState>("LOADING")

  useEffect(() => {
    let active = true
    validateAdminSession()
      .then(async (result) => {
        if (!active) return
        if (!result.isAdmin || !result.session?.access_token) {
          router.replace("/admin/login?returnTo=/admin")
          return
        }
        const response = await fetch("/api/admin/session", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${result.session.access_token}`,
          },
        })
        if (!active) return
        setState(response.ok ? "READY" : "UNAVAILABLE")
      })
      .catch(() => {
        if (active) setState("UNAVAILABLE")
      })
    return () => {
      active = false
    }
  }, [router])

  return (
    <div className="space-y-5">
      <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-200/[0.10] via-white/[0.03] to-emerald-200/[0.06] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-100/60">
              Inicio operativo
            </p>
            <h1 className="mt-2 text-2xl font-black leading-tight sm:text-3xl">
              Tu siguiente decisión, sin ruido
            </h1>
          </div>
          <span
            role="status"
            className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${
              state === "READY"
                ? "bg-emerald-200 text-black"
                : "border border-amber-200/30 text-amber-100"
            }`}
          >
            {state === "LOADING"
              ? "VALIDANDO SESIÓN"
              : state === "READY"
                ? "SESIÓN PROTEGIDA"
                : "CONEXIÓN NO DISPONIBLE"}
          </span>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
          La actividad global muestra únicamente trabajo confirmado por datos
          durables. Una espera, un error o una fuente no disponible nunca se
          presentan como progreso.
        </p>
      </header>

      <TodayLaunchPanel />

      <section
        aria-labelledby="seller-os-operating-model"
        className="rounded-3xl border border-white/10 bg-white/[0.025] p-4 sm:p-5"
      >
        <h2
          id="seller-os-operating-model"
          className="text-lg font-black text-white"
        >
          Cómo trabaja Seller OS
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {operatingPrinciples.map((principle) => (
            <article
              key={principle.title}
              className="rounded-2xl border border-white/10 bg-black/20 p-4"
            >
              <h3 className="text-sm font-black text-cyan-50">
                {principle.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-white/55">
                {principle.detail}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
