"use client"

import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

type State = "LOADING" | "READY" | "APPROVING" | "PREFLIGHTING" | "FAILED"
type Capability = Readonly<{ command_client_id: string; enabled: boolean;
  created_at: string; disabled_at: string | null }>
type MarketplaceInsightsPreflight = Readonly<{
  TOKEN_PREFLIGHT: "PASS" | "FAIL" | "NOT_EXECUTED"
  TOKEN_HTTP_STATUS: number | null
  INVALID_CLIENT: "YES" | "NO"
  SCOPE_ACCEPTED: "YES" | "NO"
  MARKETPLACE_INSIGHTS_ENDPOINT_PREFLIGHT: "PASS" | "FAIL" | "NOT_EXECUTED"
  ENDPOINT_HTTP_STATUS: number | null
  ENTITLEMENT_STATUS: string
  MARKETPLACE_INSIGHTS_READY: "YES" | "NO"
  SAFE_TO_ENABLE: "YES" | "NO"
}>
const CONTROL_CLIENT_ID = "9ab58207-f8b2-4c8a-9f10-047efc97b325"

export function ControlOAuthConsent() {
  const [state, setState] = useState<State>("LOADING")
  const [csrf, setCsrf] = useState("")
  const [authorizationId, setAuthorizationId] = useState("")
  const [message, setMessage] = useState("Validando la autorización…")
  const [capabilities, setCapabilities] = useState<Capability[]>([])
  const [traceCapabilities, setTraceCapabilities] = useState<Capability[]>([])
  const [marketplaceInsightsPreflight, setMarketplaceInsightsPreflight] =
    useState<MarketplaceInsightsPreflight | null>(null)

  useEffect(() => {
    const id = new URLSearchParams(window.location.search)
      .get("authorization_id") ?? ""
    setAuthorizationId(id)
    void supabase.auth.getSession().then(async ({ data }) => {
      const accessToken = data.session?.access_token
      if (!accessToken) {
        const returnTo = `${window.location.pathname}${window.location.search}`
        window.location.replace(`/admin/login?returnTo=${encodeURIComponent(returnTo)}`)
        return
      }
      const response = await fetch(
        "/api/admin/ebay/pre-research-control/capability", {
          headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store",
        })
      const payload = await response.json().catch(() => ({})) as {
        csrf?: { csrfToken?: string }; error?: string; capabilities?: Capability[];
        traceCapabilities?: Capability[]
      }
      if (!response.ok || !payload.csrf?.csrfToken) {
        setState("FAILED")
        setMessage(payload.error ?? "No se pudo validar OWNER_ADMIN.")
        return
      }
      setCsrf(payload.csrf.csrfToken)
      setCapabilities(payload.capabilities ?? [])
      setTraceCapabilities(payload.traceCapabilities ?? [])
      setState("READY")
      setMessage(id
        ? "Autoriza solo lotes NORMAL Pre-Research V2 de hasta 50 candidatos."
        : "Administra las autorizaciones acotadas existentes.")
    })
  }, [])

  async function approve() {
    setState("APPROVING")
    const session = await supabase.auth.getSession()
    const accessToken = session.data.session?.access_token
    if (!accessToken) { setState("FAILED"); setMessage("Sesión OWNER_ADMIN requerida."); return }
    const response = await fetch("/api/admin/ebay/pre-research-control/capability", {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json", "X-Seller-OS-CSRF": csrf },
      body: JSON.stringify({ action: "AUTHORIZE", authorizationId }),
    })
    const payload = await response.json().catch(() => ({})) as {
      redirectUrl?: string; error?: string
    }
    if (!response.ok || !payload.redirectUrl) {
      setState("FAILED")
      setMessage(payload.error ?? "La autorización falló de forma segura.")
      return
    }
    window.location.assign(payload.redirectUrl)
  }

  async function authorizeCommercialTrace() {
    setState("APPROVING")
    const session = await supabase.auth.getSession()
    const accessToken = session.data.session?.access_token
    if (!accessToken) { setState("FAILED"); setMessage("Sesión OWNER_ADMIN requerida."); return }
    const response = await fetch("/api/admin/ebay/pre-research-control/capability", {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json", "X-Seller-OS-CSRF": csrf },
      body: JSON.stringify({ action: "AUTHORIZE_COMMERCIAL_TRACE",
        commandClientId: CONTROL_CLIENT_ID }),
    })
    if (response.ok) window.location.reload()
    else {
      const payload = await response.json().catch(() => ({})) as { error?: string }
      setState("FAILED")
      setMessage(payload.error ?? "La autorización Trace falló de forma segura.")
    }
  }

  async function disable(commandClientId: string) {
    const session = await supabase.auth.getSession()
    const accessToken = session.data.session?.access_token
    if (!accessToken) return
    const response = await fetch("/api/admin/ebay/pre-research-control/capability", {
      method: "DELETE", headers: { Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json", "X-Seller-OS-CSRF": csrf },
      body: JSON.stringify({ action: "DISABLE", commandClientId }),
    })
    if (response.ok) window.location.reload()
    else { setState("FAILED"); setMessage("La revocación falló de forma segura.") }
  }

  async function disableTrace(commandClientId: string) {
    const session = await supabase.auth.getSession()
    const accessToken = session.data.session?.access_token
    if (!accessToken) return
    const response = await fetch("/api/admin/ebay/pre-research-control/capability", {
      method: "DELETE", headers: { Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json", "X-Seller-OS-CSRF": csrf },
      body: JSON.stringify({ action: "DISABLE_COMMERCIAL_TRACE", commandClientId }),
    })
    if (response.ok) window.location.reload()
    else { setState("FAILED"); setMessage("La revocación Trace falló de forma segura.") }
  }

  async function verifyMarketplaceInsights() {
    setState("PREFLIGHTING")
    const session = await supabase.auth.getSession()
    const accessToken = session.data.session?.access_token
    if (!accessToken) {
      setState("FAILED")
      setMessage("Sesión OWNER_ADMIN requerida.")
      return
    }
    const response = await fetch(
      "/api/admin/ebay/pre-research-control/capability", {
        method: "POST", headers: { Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json", "X-Seller-OS-CSRF": csrf },
        body: JSON.stringify({ action: "PREFLIGHT_MARKETPLACE_INSIGHTS" }),
      })
    const payload = await response.json().catch(() => ({})) as {
      error?: string; preflight?: MarketplaceInsightsPreflight
      csrf?: { csrfToken?: string }
    }
    if (!response.ok || !payload.preflight || !payload.csrf?.csrfToken) {
      setState("FAILED")
      setMessage(payload.error ?? "El preflight falló de forma segura.")
      return
    }
    setCsrf(payload.csrf.csrfToken)
    setMarketplaceInsightsPreflight(payload.preflight)
    setState("READY")
    setMessage("Preflight Marketplace Insights completado sin habilitar la función.")
  }

  return <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
    <section className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-slate-900 p-8 shadow-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
        IMNOVA Seller OS · Control
      </p>
      <h1 className="mt-3 text-2xl font-semibold">Autorizar Teo Pre-Research</h1>
      <p className="mt-4 text-sm leading-6 text-slate-300">{message}</p>
      <ul className="mt-5 space-y-2 text-sm text-slate-400">
        <li>Solo crea, consulta y reanuda lotes NORMAL Pre-Research V2.</li>
        <li>Pre-Research no incluye Trace. Commercial Trace requiere una segunda autorización OWNER explícita.</li>
        <li>Ninguna autorización incluye Publisher, SQL, URLs arbitrarias ni escrituras de marketplace.</li>
        <li>La autorización queda vinculada a tu usuario y al cliente OAuth exacto.</li>
      </ul>
      <button type="button" onClick={() => void approve()}
        disabled={state !== "READY" || !authorizationId}
        className="mt-7 min-h-11 rounded-xl bg-cyan-400 px-5 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
        {state === "APPROVING" ? "Autorizando…" : "Autorizar control acotado"}
      </button>
      <div className="mt-8 border-t border-white/10 pt-6">
        <h2 className="text-sm font-semibold">Marketplace Insights</h2>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          Verifica credenciales, scope y entitlement mediante el preflight oficial acotado. No habilita Marketplace Insights ni escribe en eBay.
        </p>
        <button type="button" onClick={() => void verifyMarketplaceInsights()}
          disabled={state !== "READY"}
          className="mt-4 min-h-11 rounded-xl border border-emerald-400/50 px-4 text-sm font-semibold text-emerald-200 disabled:opacity-40">
          {state === "PREFLIGHTING"
            ? "Verificando Marketplace Insights…"
            : "Verificar Marketplace Insights"}
        </button>
        {marketplaceInsightsPreflight && <dl
          className="mt-4 grid gap-2 rounded-xl bg-slate-950/70 p-4 text-xs sm:grid-cols-2">
          {Object.entries(marketplaceInsightsPreflight).map(([label, value]) =>
            <div key={label} className="min-w-0">
              <dt className="break-all text-slate-500">{label}</dt>
              <dd className="mt-1 break-words font-semibold text-slate-200">
                {value === null ? "NOT_OBSERVED" : String(value)}
              </dd>
            </div>)}
        </dl>}
      </div>
      {capabilities.length > 0 && <div className="mt-8 border-t border-white/10 pt-6">
        <h2 className="text-sm font-semibold">Autorizaciones durables</h2>
        {capabilities.map((capability) => <div key={capability.command_client_id}
          className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-slate-950/70 p-3 text-xs">
          <span className="truncate text-slate-400">{capability.command_client_id}</span>
          {capability.enabled ? <button type="button"
            onClick={() => void disable(capability.command_client_id)}
            className="rounded-lg border border-red-400/40 px-3 py-2 text-red-300">
            Revocar
          </button> : <span className="text-slate-500">Revocada</span>}
        </div>)}
      </div>}
      {capabilities.some((capability) => capability.enabled &&
        capability.command_client_id === CONTROL_CLIENT_ID) &&
        !traceCapabilities.some((capability) => capability.enabled &&
          capability.command_client_id === CONTROL_CLIENT_ID) &&
        <div className="mt-8 border-t border-white/10 pt-6">
          <h2 className="text-sm font-semibold">Commercial Trace acotado</h2>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Autoriza por separado solo la ejecución y lectura idempotente de Commercial Trace para Product Truth canónico. No concede Publisher ni escrituras de marketplace.
          </p>
          <button type="button" onClick={() => void authorizeCommercialTrace()}
            disabled={state !== "READY"}
            className="mt-4 min-h-11 rounded-xl border border-cyan-400/50 px-4 text-sm font-semibold text-cyan-200 disabled:opacity-40">
            Autorizar Commercial Trace acotado
          </button>
        </div>}
      {traceCapabilities.length > 0 && <div className="mt-8 border-t border-white/10 pt-6">
        <h2 className="text-sm font-semibold">Autorizaciones Commercial Trace</h2>
        {traceCapabilities.map((capability) => <div
          key={`trace-${capability.command_client_id}`}
          className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-slate-950/70 p-3 text-xs">
          <span className="truncate text-slate-400">{capability.command_client_id}</span>
          {capability.enabled ? <button type="button"
            onClick={() => void disableTrace(capability.command_client_id)}
            className="rounded-lg border border-red-400/40 px-3 py-2 text-red-300">
            Revocar Trace
          </button> : <span className="text-slate-500">Revocada</span>}
        </div>)}
      </div>}
    </section>
  </main>
}
