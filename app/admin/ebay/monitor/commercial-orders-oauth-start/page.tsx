"use client"

import { useEffect, useRef, useState } from "react"

import { supabase } from "@/lib/supabase"

const ACTIVATE_PATH =
  "/api/admin/ebay/commercial-orders-oauth/browser-start"
const CALLBACK_PATH = "/api/admin/ebay/monitor/seller-oauth-reauth"
const REQUIRED_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.message",
] as const

type ActivationPayload = {
  success?: boolean
  authorizationUrl?: string
  error?: string
  ceremony?: {
    contractVersion?: string
    startHostMatchesCallbackHost?: boolean
    startTicketMinted?: boolean
    startTicketUnconsumed?: boolean
    clientExchangePathReady?: boolean
    stateCookieCanBeIssued?: boolean
    transport?: string
    actorBound?: boolean
    deploymentBound?: boolean
    stateCookieIssued?: boolean
    stateHashPersisted?: boolean
    rawStatePersisted?: boolean
    runameResolvesToExpectedCallback?: boolean
    requestedScopes?: unknown
    exactScopeContract?: boolean
    secretsReturned?: boolean
  }
}

function validAuthorizationUrl(value: string) {
  try {
    const url = new URL(value)
    const scopes = url.searchParams.get("scope")?.split(/\s+/).filter(Boolean)
      ?? []
    return url.origin === "https://auth.ebay.com" &&
      url.pathname === "/oauth2/authorize" &&
      !url.username && !url.password && !url.hash &&
      [...url.searchParams.keys()].sort().join(",") ===
        "client_id,redirect_uri,response_type,scope,state" &&
      url.searchParams.get("response_type") === "code" &&
      /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("state") ?? "") &&
      scopes.length === REQUIRED_SCOPES.length &&
      REQUIRED_SCOPES.every((scope) => scopes.includes(scope)) &&
      scopes.every((scope) => REQUIRED_SCOPES.includes(
        scope as typeof REQUIRED_SCOPES[number],
      ))
  } catch {
    return false
  }
}

function validActivation(payload: ActivationPayload) {
  return payload.success === true &&
    typeof payload.authorizationUrl === "string" &&
    validAuthorizationUrl(payload.authorizationUrl) &&
    payload.ceremony?.contractVersion ===
      "EBAY_COMMERCIAL_ORDERS_BROWSER_CEREMONY_V2" &&
    payload.ceremony.startHostMatchesCallbackHost === true &&
    payload.ceremony.startTicketMinted === true &&
    payload.ceremony.startTicketUnconsumed === false &&
    payload.ceremony.clientExchangePathReady === true &&
    payload.ceremony.stateCookieCanBeIssued === true &&
    payload.ceremony.transport ===
      "SEALED_QUERY_TO_SAME_ORIGIN_CLIENT_POST" &&
    payload.ceremony.actorBound === true &&
    payload.ceremony.deploymentBound === true &&
    payload.ceremony.stateCookieIssued === true &&
    payload.ceremony.stateHashPersisted === true &&
    payload.ceremony.rawStatePersisted === false &&
    payload.ceremony.runameResolvesToExpectedCallback === true &&
    payload.ceremony.exactScopeContract === true &&
    payload.ceremony.secretsReturned === false &&
    JSON.stringify(payload.ceremony.requestedScopes) ===
      JSON.stringify(REQUIRED_SCOPES)
}

export default function CommercialOrdersOAuthStartPage() {
  const started = useRef(false)
  const [status, setStatus] = useState("Preparando autorización segura…")

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      const startTicket = new URL(window.location.href)
        .searchParams.get("ticket") ?? ""
      window.history.replaceState(null, "", window.location.pathname)
      if (!/^[A-Za-z0-9._-]{80,2048}$/.test(startTicket)) {
        setStatus(
          "EBAY_COMMERCIAL_ORDERS_BROWSER_START_CLIENT_EXCHANGE_NOT_EXECUTED",
        )
        return
      }
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error || !data.session) throw new Error("ADMIN_SESSION_REQUIRED")
        const response = await fetch(ACTIVATE_PATH, {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ startTicket }),
        })
        const payload = await response.json() as ActivationPayload
        if (!response.ok || !validActivation(payload)) {
          throw new Error(payload.error ?? "OAUTH_START_REJECTED")
        }
        setStatus("Redirigiendo a la autorización oficial de eBay…")
        window.location.replace(payload.authorizationUrl ?? "")
      } catch (cause) {
        setStatus(cause instanceof Error ? cause.message : "OAUTH_START_REJECTED")
      }
    })()
  }, [])

  return (
    <main className="min-h-screen bg-[#07111f] px-5 py-16 text-white">
      <div className="mx-auto max-w-xl rounded-2xl border border-cyan-400/30 bg-slate-950 p-8">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
          Seller OS · OAuth Preview ceremony
        </p>
        <h1 className="mt-3 text-2xl font-black">
          eBay Commercial Orders + buyer messaging
        </h1>
        <p className="mt-5 text-sm text-slate-300">{status}</p>
        <p className="mt-4 text-xs text-slate-500">
          Callback protegido: {CALLBACK_PATH}. No se muestran tokens ni cookies.
        </p>
      </div>
    </main>
  )
}
