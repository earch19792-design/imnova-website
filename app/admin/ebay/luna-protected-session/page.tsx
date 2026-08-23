"use client"

import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  LockKeyhole,
  MonitorUp,
  ShieldCheck,
} from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

const ENDPOINT = "/api/admin/ebay/luna-protected-session"

type StatusPayload = {
  success?: boolean
  error?: string
  prerequisites?: {
    lunaProtectedSessionStatus?: string
    canonicalServerReadReadiness?: string
    schemaArtifactStatus?: string
    schemaAppliedStatus?: string
    storageReadiness?: string
    humanBootstrapRequired?: boolean
  }
  browserRuntime?: {
    status?: string
    browserWorker?: string
    browserVisibleToHuman?: boolean
    profile?: string
    profileReuse?: boolean
    remoteDebuggingPublic?: boolean
  }
  ceremony?: {
    phase?: string
    failureCode?: string | null
    expiresAt?: string
    blockedHost?: string | null
    storedAt?: string | null
    sessionDigest?: string | null
    postLoginHost?: string | null
    postLoginPathClass?: string | null
    authenticatedStateProven?: boolean
  } | null
  operatorAction?: {
    status?: string
    instructionCode?: string | null
    acceptsCallerCredentials?: boolean
    acceptsCallerCookies?: boolean
    ceremonyReady?: boolean
    csrfReadyForCurrentAdmin?: boolean
    csrfToken?: string | null
    csrfExpiresAt?: string | null
    csrfSingleUse?: boolean | null
    csrfAdminSessionBound?: boolean | null
    csrfCeremonyInstanceBound?: boolean | null
    csrfOriginBound?: boolean | null
    csrfCeremonyStateBound?: boolean | null
  }
}

async function adminToken() {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error("AUTH_REQUIRED")
  return data.session.access_token
}

export default function LunaProtectedSessionPage() {
  const [payload, setPayload] = useState<StatusPayload | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const token = await adminToken()
      const response = await fetch(ENDPOINT, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Authorization: `Bearer ${token}` },
      })
      const result = await response.json() as StatusPayload
      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "LUNA_SESSION_STATUS_FAILED")
      }
      setPayload(result)
      setError("")
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message : "LUNA_SESSION_STATUS_FAILED")
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!payload?.ceremony || !["LAUNCHING", "AWAITING_HUMAN_LOGIN",
      "COMPLETING"].includes(payload.ceremony.phase ?? "")) return
    const timer = window.setInterval(() => { void refresh() }, 4_000)
    return () => window.clearInterval(timer)
  }, [payload?.ceremony, refresh])

  const act = useCallback(async (action: "START" | "COMPLETE" | "CANCEL") => {
    setBusy(true)
    setError("")
    try {
      const csrfToken = payload?.operatorAction?.csrfToken
      if (!csrfToken) throw new Error("LUNA_CEREMONY_CSRF_UNAVAILABLE")
      const token = await adminToken()
      const response = await fetch(ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Seller-OS-CSRF": csrfToken,
        },
        body: JSON.stringify({ action }),
      })
      const result = await response.json() as StatusPayload
      if (!response.ok || !result.success) {
        const message = result.error ?? "LUNA_CEREMONY_ACTION_FAILED"
        await refresh()
        throw new Error(message)
      }
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message : "LUNA_CEREMONY_ACTION_FAILED")
    } finally {
      setBusy(false)
    }
  }, [payload?.operatorAction?.csrfToken, refresh])

  const status = payload?.prerequisites
  const phase = payload?.ceremony?.phase ?? "NOT_STARTED"
  const active = ["LAUNCHING", "AWAITING_HUMAN_LOGIN", "COMPLETING"]
    .includes(phase)
  const runtimeReady = payload?.browserRuntime?.status === "READY" &&
    payload?.operatorAction?.ceremonyReady === true &&
    payload?.operatorAction?.csrfReadyForCurrentAdmin === true
  const configured = status?.lunaProtectedSessionStatus === "SESSION_READY"

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-950">
      <div className="mx-auto max-w-3xl">
        <Link href="/admin/ebay/operational-readiness"
          className="inline-flex items-center gap-2 text-xs font-bold text-cyan-800">
          <ArrowLeft size={14} /> Operational Readiness
        </Link>
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <LockKeyhole className="text-cyan-700" />
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">
                Seller OS · Luna protected session
              </p>
              <h1 className="text-2xl font-black">Ceremonia server-owned</h1>
            </div>
          </div>

          {error && <div className="mt-5 flex gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
            <CircleX size={18} className="shrink-0" /> {error}
          </div>}

          {!payload ? <p className="mt-5 text-sm text-slate-500">
            Leyendo estado seguro…
          </p> : <div className="mt-6 space-y-5">
            <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Session</dt>
                <dd className="font-black">{status?.lunaProtectedSessionStatus}</dd></div>
              <div><dt className="text-slate-500">Server read</dt>
                <dd className="font-black">{status?.canonicalServerReadReadiness}</dd></div>
              <div><dt className="text-slate-500">Vault schema</dt>
                <dd className="font-black">{status?.schemaAppliedStatus}</dd></div>
              <div><dt className="text-slate-500">Browser worker</dt>
                <dd className="font-black">{payload.browserRuntime?.status}</dd></div>
              <div><dt className="text-slate-500">Ceremony</dt>
                <dd className="font-black">{phase}</dd></div>
              <div><dt className="text-slate-500">Profile</dt>
                <dd className="font-black">{payload.browserRuntime?.profile}</dd></div>
            </dl>

            <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-5">
              <h2 className="font-black text-cyan-950">Flujo humano seguro</h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-cyan-950">
                <li>Inicia la ceremonia. Seller OS abrirá una ventana Chromium efímera y visible.</li>
                <li>En esa ventana, usa únicamente el formulario normal de Luna. Escribe allí tu correo y contraseña; nunca aquí.</li>
                <li>No uses “Sign in with Shop” ni un proveedor social. Esas rutas están bloqueadas.</li>
                <li>Cuando veas tu cuenta Luna autenticada, vuelve a esta pantalla y pulsa “Completar y verificar”.</li>
              </ol>
            </div>

            {payload.ceremony?.failureCode &&
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-black">{payload.ceremony.failureCode}</p>
                {payload.ceremony.blockedHost && <p className="mt-1">
                  Host bloqueado para revisión: {payload.ceremony.blockedHost}
                </p>}
              </div>}

            {configured && <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <CircleCheck size={18} className="shrink-0" />
              <p>La sesión está almacenada en Vault y la lectura autenticada acotada fue reconocida.</p>
            </div>}

            <div className="flex flex-wrap gap-3">
              {!active && !configured && <button type="button"
                disabled={busy || !runtimeReady}
                onClick={() => { void act("START") }}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-800 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
                <MonitorUp size={18} /> Iniciar ceremonia
              </button>}
              {phase === "AWAITING_HUMAN_LOGIN" && <button type="button"
                disabled={busy}
                onClick={() => { void act("COMPLETE") }}
                className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:opacity-50">
                Completar y verificar
              </button>}
              {active && <button type="button" disabled={busy}
                onClick={() => { void act("CANCEL") }}
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-800 disabled:opacity-50">
                Cancelar y destruir browser
              </button>}
              <button type="button" disabled={busy}
                onClick={() => { void refresh() }}
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-800 disabled:opacity-50">
                Actualizar estado
              </button>
            </div>

            <div className="flex gap-2 text-sm text-emerald-800">
              <ShieldCheck size={18} className="shrink-0" />
              <p>Vault es el único destino. No hay captura de campos, screenshots, perfil reusable, polling ni acciones eBay.</p>
            </div>
          </div>}
        </section>
      </div>
    </main>
  )
}
