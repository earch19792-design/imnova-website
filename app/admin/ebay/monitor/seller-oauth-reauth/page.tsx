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
  authorizationPreflight?: {
    rootCause?: string
    liveAccepted?: boolean
    scopeEncoding?: string
    stateAccepted?: boolean
  }
}

type PreflightState = {
  acceptedByAuthEndpoint?: "YES" | "NO"
  safeErrorCategory?: string
}

type Diagnosis = {
  rootCause?: string
  testBase?: PreflightState
  testBaseAccount?: PreflightState
  testBaseAccountInventory?: PreflightState
  testFullFourScopes?: PreflightState
  canonicalWithState?: PreflightState
  previousPlusEncodingWithState?: PreflightState
  runameSource?: string
  runameAppBinding?: string
  currentScopeEncoding?: string
  previousScopeEncoding?: string
  encodingCausesInvalidRequest?: string
  stateCausesInvalidRequest?: string
  stateFormatValid?: boolean
  scopeCount?: number
  externalCalls?: number
  ledgerRowsCreated?: number
  cookiesSet?: number
  humanRedirects?: number
  oauthConsentLaunched?: boolean
  authorizationCodeExchangeCalls?: number
  secretsReturned?: boolean
  startAllowed?: boolean
}

type DiagnosisPayload = {
  success?: boolean
  diagnosis?: Diagnosis
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
    return !value.includes("+") && !value.includes("%252F") &&
      /scope=[^&]+%20https%3A/.test(value) &&
      url.origin === "https://auth.ebay.com" &&
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
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setCallbackUrl(`${window.location.origin}${CALLBACK_PATH}`)
  }, [])

  async function adminBearer() {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("ADMIN_SESSION_REQUIRED")
    return data.session.access_token
  }

  async function diagnose() {
    setDiagnosing(true)
    setDiagnosis(null)
    setError("")
    try {
      const bearer = await adminBearer()
      const response = await fetch(START_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "diagnose" }),
      })
      const payload = await response.json() as DiagnosisPayload
      if (!response.ok || !payload.success || !payload.diagnosis) {
        throw new Error(payload.error || "OAUTH_DIAGNOSTIC_REJECTED")
      }
      setDiagnosis(payload.diagnosis)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "OAUTH_DIAGNOSTIC_REJECTED")
    } finally {
      setDiagnosing(false)
    }
  }

  async function begin() {
    setLoading(true)
    setError("")
    try {
      if (!diagnosis?.startAllowed ||
          diagnosis.rootCause !== "URL_SERIALIZATION") {
        throw new Error("AUTH_REQUEST_LIVE_PREFLIGHT_REQUIRED")
      }
      const bearer = await adminBearer()
      const response = await fetch(START_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "start" }),
      })
      const payload = await response.json() as StartPayload
      if (!response.ok || !payload.success || !payload.authorizationUrl ||
          payload.callbackPath !== CALLBACK_PATH ||
          payload.scopeCount !== REQUIRED_SCOPES.length ||
          payload.authorizationPreflight?.rootCause !== "URL_SERIALIZATION" ||
          payload.authorizationPreflight?.liveAccepted !== true ||
          payload.authorizationPreflight?.scopeEncoding !==
            "RFC3986_PERCENT20" ||
          payload.authorizationPreflight?.stateAccepted !== true ||
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

        <section className="rounded-3xl border border-cyan-300/25 bg-cyan-300/[0.06] p-6">
          <h2 className="font-black">Preflight no interactivo</h2>
          <p className="mt-3 text-sm leading-6 text-white/70">
            Comprueba Client ID/RuName, scopes, state y serialización directamente contra el
            endpoint de autorización. No inicia sesión, no crea ledger/cookie, no redirige y no
            intercambia códigos.
          </p>
          <button
            className="mt-4 rounded-2xl border border-cyan-300/50 px-5 py-2 text-sm font-black text-cyan-200 disabled:opacity-40"
            type="button"
            disabled={diagnosing || loading}
            onClick={diagnose}
          >
            {diagnosing ? "Diagnosticando…" : "Diagnosticar sin iniciar OAuth"}
          </button>
          {diagnosis ? (
            <dl className="mt-5 grid gap-2 text-xs text-white/75 sm:grid-cols-2">
              {[
                ["Root cause", diagnosis.rootCause],
                ["Base", `${diagnosis.testBase?.acceptedByAuthEndpoint ?? "NO"} · ${diagnosis.testBase?.safeErrorCategory ?? "UNKNOWN"}`],
                ["Base + Account", `${diagnosis.testBaseAccount?.acceptedByAuthEndpoint ?? "NO"} · ${diagnosis.testBaseAccount?.safeErrorCategory ?? "UNKNOWN"}`],
                ["Base + Account + Inventory", `${diagnosis.testBaseAccountInventory?.acceptedByAuthEndpoint ?? "NO"} · ${diagnosis.testBaseAccountInventory?.safeErrorCategory ?? "UNKNOWN"}`],
                ["Four scopes", `${diagnosis.testFullFourScopes?.acceptedByAuthEndpoint ?? "NO"} · ${diagnosis.testFullFourScopes?.safeErrorCategory ?? "UNKNOWN"}`],
                ["State", diagnosis.stateCausesInvalidRequest],
                ["Encoding +", diagnosis.previousPlusEncodingWithState?.safeErrorCategory],
                ["Encoding cause", diagnosis.encodingCausesInvalidRequest],
                ["RuName source", diagnosis.runameSource],
                ["RuName/app binding", diagnosis.runameAppBinding],
                ["Ledger rows", diagnosis.ledgerRowsCreated],
                ["Human redirects", diagnosis.humanRedirects],
              ].map(([label, value]) => (
                <div className="rounded-lg bg-black/20 p-3" key={String(label)}>
                  <dt className="font-bold text-white/50">{label}</dt>
                  <dd className="mt-1 break-all">{String(value ?? "UNPROVEN")}</dd>
                </div>
              ))}
            </dl>
          ) : null}
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
          disabled={!confirmed || loading || !callbackUrl ||
            !diagnosis?.startAllowed || diagnosis.rootCause !== "URL_SERIALIZATION"}
          aria-disabled={!diagnosis?.startAllowed ||
            diagnosis.rootCause !== "URL_SERIALIZATION"}
          onClick={begin}
        >
          {loading ? "Preparando…" : "Iniciar consentimiento eBay una vez"}
        </button>
      </div>
    </main>
  )
}
