"use client"

import { useEffect, useRef, useState } from "react"

import { supabase } from "@/lib/supabase"

const ACTIVATE_PATH =
  "/api/admin/ebay/commercial-orders-oauth/browser-start"
const START_PATH = "/api/admin/ebay/commercial-orders-oauth/start"
const BROWSER_START_PATH =
  "/admin/ebay/monitor/commercial-orders-oauth-start"
const CALLBACK_PATH = "/api/admin/ebay/monitor/seller-oauth-reauth"
const READONLY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
] as const
const LEGACY_SCOPES = [
  ...READONLY_SCOPES,
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
    scopeProfile?: string
    secretsReturned?: boolean
  }
}

function pemFromSpki(spki: ArrayBuffer) {
  const bytes = new Uint8Array(spki)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const encoded = window.btoa(binary)
  const body = encoded.match(/.{1,64}/g)?.join("\n") ?? ""
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`
}

function validStartUrl(value: unknown) {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value)
    return url.origin === window.location.origin &&
      url.pathname === BROWSER_START_PATH &&
      /^[A-Za-z0-9._-]{80,2048}$/.test(
        url.searchParams.get("ticket") ?? "",
      ) &&
      [...url.searchParams.keys()].join(",") === "ticket" &&
      !url.hash && !url.username && !url.password
  } catch {
    return false
  }
}

function validAuthorizationUrl(value: string) {
  try {
    const url = new URL(value)
    const scopes = url.searchParams.get("scope")?.split(/\s+/).filter(Boolean)
      ?? []
    const expectedScopes = scopes.length === READONLY_SCOPES.length
      ? READONLY_SCOPES
      : LEGACY_SCOPES
    return url.origin === "https://auth.ebay.com" &&
      url.pathname === "/oauth2/authorize" &&
      !url.username && !url.password && !url.hash &&
      [...url.searchParams.keys()].sort().join(",") ===
        "client_id,redirect_uri,response_type,scope,state" &&
      url.searchParams.get("response_type") === "code" &&
      /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("state") ?? "") &&
      scopes.length === expectedScopes.length &&
      expectedScopes.every((scope) => scopes.includes(scope)) &&
      scopes.every((scope) => expectedScopes.some(
        (expected) => expected === scope,
      ))
  } catch {
    return false
  }
}

function validActivation(payload: ActivationPayload) {
  const expectedScopes = payload.ceremony?.scopeProfile ===
      "COMMERCIAL_ORDERS_READONLY"
    ? READONLY_SCOPES
    : payload.ceremony?.scopeProfile ===
        "COMMERCIAL_ORDERS_AND_BUYER_MESSAGE"
      ? LEGACY_SCOPES
      : null
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
    payload.ceremony.secretsReturned === false && expectedScopes !== null &&
    JSON.stringify(payload.ceremony.requestedScopes) ===
      JSON.stringify(expectedScopes)
}

export default function CommercialOrdersOAuthStartPage() {
  const started = useRef(false)
  const [status, setStatus] = useState("Preparando autorización segura…")
  const [operatorStartAvailable, setOperatorStartAvailable] = useState(false)
  const [operatorStartBusy, setOperatorStartBusy] = useState(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      const startTicket = new URL(window.location.href)
        .searchParams.get("ticket") ?? ""
      window.history.replaceState(null, "", window.location.pathname)
      if (!/^[A-Za-z0-9._-]{80,2048}$/.test(startTicket)) {
        setStatus("Listo para preparar la autorización oficial read-only.")
        setOperatorStartAvailable(true)
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

  async function beginReadonlyAuthorization() {
    if (operatorStartBusy) return
    setOperatorStartBusy(true)
    setStatus("Preparando state firmado y handoff de un solo uso…")
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session) throw new Error("ADMIN_SESSION_REQUIRED")
      const keyPair = await window.crypto.subtle.generateKey(
        {
          name: "RSA-OAEP",
          modulusLength: 4096,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt"],
      )
      const publicKeyPem = pemFromSpki(
        await window.crypto.subtle.exportKey("spki", keyPair.publicKey),
      )
      const response = await fetch(START_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ publicKeyPem }),
      })
      const payload = await response.json() as {
        success?: boolean
        startUrl?: unknown
        error?: string
        ceremony?: { requestedScopes?: unknown; scopeProfile?: unknown }
      }
      if (!response.ok || payload.success !== true ||
          !validStartUrl(payload.startUrl) ||
          payload.ceremony?.scopeProfile !== "COMMERCIAL_ORDERS_READONLY" ||
          JSON.stringify(payload.ceremony.requestedScopes) !==
            JSON.stringify(READONLY_SCOPES)) {
        throw new Error(
          payload.error ?? "COMMERCIAL_ORDERS_READONLY_START_REJECTED",
        )
      }
      setStatus("Continuando a la ceremonia firmada…")
      window.location.assign(payload.startUrl as string)
    } catch (cause) {
      setStatus(cause instanceof Error
        ? cause.message
        : "COMMERCIAL_ORDERS_READONLY_START_REJECTED")
      setOperatorStartBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#07111f] px-5 py-16 text-white">
      <div className="mx-auto max-w-xl rounded-2xl border border-cyan-400/30 bg-slate-950 p-8">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
          Seller OS · OAuth protected ceremony
        </p>
        <h1 className="mt-3 text-2xl font-black">
          eBay Commercial Orders authorization
        </h1>
        <p className="mt-5 text-sm text-slate-300">{status}</p>
        {operatorStartAvailable ? (
          <>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Se solicitarán únicamente base y Fulfillment readonly. No se
              reemplaza EBAY_SELLER_REFRESH_TOKEN ni se concede ningún scope de
              escritura.
            </p>
            <ul className="mt-4 space-y-2 text-xs text-slate-400">
              {READONLY_SCOPES.map((scope) => <li key={scope}>{scope}</li>)}
            </ul>
            <button
              className="mt-6 rounded-2xl border border-cyan-300/60 px-5 py-3 text-sm font-black text-cyan-100 disabled:opacity-40"
              type="button"
              disabled={operatorStartBusy}
              onClick={beginReadonlyAuthorization}
            >
              {operatorStartBusy ? "Preparando…" : "Continuar a eBay"}
            </button>
          </>
        ) : null}
        <p className="mt-4 text-xs text-slate-500">
          Callback protegido: {CALLBACK_PATH}. No se muestran tokens ni cookies.
        </p>
      </div>
    </main>
  )
}
