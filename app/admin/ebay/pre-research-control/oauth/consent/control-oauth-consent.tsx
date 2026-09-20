"use client"

import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"

type State = "LOADING" | "READY" | "APPROVING" | "FAILED"
type Capability = Readonly<{ command_client_id: string; enabled: boolean;
  created_at: string; disabled_at: string | null }>

export function ControlOAuthConsent() {
  const [state, setState] = useState<State>("LOADING")
  const [csrf, setCsrf] = useState("")
  const [authorizationId, setAuthorizationId] = useState("")
  const [message, setMessage] = useState("Validando la autorización…")
  const [capabilities, setCapabilities] = useState<Capability[]>([])

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
        csrf?: { csrfToken?: string }; error?: string; capabilities?: Capability[]
      }
      if (!response.ok || !payload.csrf?.csrfToken) {
        setState("FAILED")
        setMessage(payload.error ?? "No se pudo validar OWNER_ADMIN.")
        return
      }
      setCsrf(payload.csrf.csrfToken)
      setCapabilities(payload.capabilities ?? [])
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

  return <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
    <section className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-slate-900 p-8 shadow-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
        IMNOVA Seller OS · Control
      </p>
      <h1 className="mt-3 text-2xl font-semibold">Autorizar Teo Pre-Research</h1>
      <p className="mt-4 text-sm leading-6 text-slate-300">{message}</p>
      <ul className="mt-5 space-y-2 text-sm text-slate-400">
        <li>Solo crea, consulta y reanuda lotes NORMAL Pre-Research V2.</li>
        <li>No incluye Publisher, Trace, SQL, URLs arbitrarias ni escrituras de marketplace.</li>
        <li>La autorización queda vinculada a tu usuario y al cliente OAuth exacto.</li>
      </ul>
      <button type="button" onClick={() => void approve()}
        disabled={state !== "READY" || !authorizationId}
        className="mt-7 min-h-11 rounded-xl bg-cyan-400 px-5 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
        {state === "APPROVING" ? "Autorizando…" : "Autorizar control acotado"}
      </button>
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
    </section>
  </main>
}
