"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

const START_PATH = "/api/admin/ebay/monitor/seller-oauth-reauth"
const CALLBACK_PATH = "/api/admin/ebay/monitor/seller-oauth-reauth"
const REQUIRED_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
] as const

type StartPayload = {
  success?: boolean
  authorizationUrl?: string
  callbackPath?: string
  scopeCount?: number
  error?: string
}

function validAuthorizationUrl(value: string) {
  try {
    const url = new URL(value)
    const scopes = url.searchParams.get("scope")?.split(/\s+/)
      .filter(Boolean) ?? []
    const exactScopeSet = scopes.length === REQUIRED_SCOPES.length &&
      REQUIRED_SCOPES.every((scope) => scopes.includes(scope)) &&
      scopes.every((scope) => REQUIRED_SCOPES.includes(
        scope as typeof REQUIRED_SCOPES[number],
      ))
    return url.origin === "https://auth.ebay.com" &&
      url.pathname === "/oauth2/authorize" &&
      url.searchParams.get("response_type") === "code" &&
      Boolean(url.searchParams.get("client_id")) &&
      Boolean(url.searchParams.get("redirect_uri")) &&
      /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("state") ?? "") &&
      [...url.searchParams.keys()].sort().join(",") ===
        "client_id,redirect_uri,response_type,scope,state" &&
      exactScopeSet
  } catch {
    return false
  }
}

export default function EbaySellerOAuthReauthPage() {
  const [callbackUrl, setCallbackUrl] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    setCallbackUrl(`${window.location.origin}${CALLBACK_PATH}`)
  }, [])

  async function begin() {
    setLoading(true)
    setError("")
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !data.session) throw new Error("ADMIN_SESSION_REQUIRED")
      const response = await fetch(START_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      })
      const payload = await response.json() as StartPayload
      if (!response.ok || !payload.success || !payload.authorizationUrl ||
          payload.callbackPath !== CALLBACK_PATH ||
          payload.scopeCount !== REQUIRED_SCOPES.length ||
          !validAuthorizationUrl(payload.authorizationUrl)) {
        throw new Error(payload.error || "OAUTH_START_REJECTED")
      }
      window.location.assign(payload.authorizationUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "OAUTH_START_REJECTED")
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#07111f] px-5 py-10 text-white">
      <div className="mx-auto max-w-3xl space-y-7">
        <Link className="text-sm text-cyan-300 underline" href="/admin/ebay/monitor">
          Volver al Commercial Monitor
        </Link>
        <header>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-300">
            Helper temporal · Preview canónico solamente
          </p>
          <h1 className="mt-3 text-3xl font-black">
            Reautorizar OAuth seller genérico
          </h1>
          <p className="mt-3 text-sm leading-6 text-white/65">
            Este flujo guarda únicamente un hash de estado no secreto. Nunca guarda códigos,
            tokens, cookies, identidad del seller ni datos de negocio.
          </p>
        </header>

        <section className="rounded-3xl border border-amber-300/30 bg-amber-300/10 p-6">
          <h2 className="font-black">Antes de iniciar</h2>
          <p className="mt-3 text-sm leading-6">
            En eBay Developer, el Auth Accepted URL del RuName Production debe ser exactamente:
          </p>
          <code className="mt-3 block break-all rounded-xl bg-black/30 p-3 text-xs">
            {callbackUrl || "Cargando alias canónico…"}
          </code>
          <p className="mt-3 text-sm leading-6">
            No continúe si todavía apunta al callback histórico de Commercial Orders.
          </p>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-6">
          <h2 className="font-black">Scopes exactos</h2>
          <ul className="mt-3 space-y-2 text-xs text-white/70">
            {REQUIRED_SCOPES.map((scope) => (
              <li className="break-all" key={scope}>{scope}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-white/60">
            Fulfillment, Marketing y todos los scopes write están excluidos.
          </p>
        </section>

        <section className="rounded-3xl border border-red-300/25 bg-red-300/[0.06] p-6 text-sm leading-6">
          <strong>Entrega no recuperable:</strong> el estado se reclama atómicamente antes del
          exchange. Si la respuesta se pierde, debe iniciar una ceremonia completamente nueva.
          Reload o Back nunca rearman el estado.
        </section>

        <label className="flex items-start gap-3 rounded-2xl border border-white/10 p-4 text-sm">
          <input
            className="mt-1"
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          Confirmo que el Auth Accepted URL coincide exactamente con el callback mostrado y que
          usaré la misma cuenta seller Production certificada.
        </label>

        {error ? (
          <p className="rounded-xl bg-red-500/15 p-4 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        <button
          className="rounded-2xl bg-cyan-300 px-6 py-3 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          disabled={!confirmed || loading || !callbackUrl}
          onClick={begin}
        >
          {loading ? "Preparando…" : "Iniciar consentimiento eBay una vez"}
        </button>
      </div>
    </main>
  )
}
