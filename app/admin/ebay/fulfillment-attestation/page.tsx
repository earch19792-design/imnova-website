"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

const questions = [
  ["containsBattery", "¿Contiene batería?"],
  ["containsLiquid", "¿Contiene líquido?"],
  ["containsAerosol", "¿Contiene aerosol?"],
  ["containsFlammableMaterial", "¿Contiene material inflamable?"],
  ["containsPressurizedMaterial", "¿Contiene material presurizado?"],
  ["knownSpecialTransportRestriction",
    "¿Conoces alguna restricción especial de transporte?"],
] as const

type Key = typeof questions[number][0]
type Choice = "" | "YES" | "NO" | "UNKNOWN"
type Response = {
  success?: boolean
  error?: string
  identity?: { accountKey: string; marketplace: string;
    opportunityId: string; candidateKey: string; sku: string;
    productId: string; variantId: string }
  fulfillmentReceiptId?: string | null
  fulfillmentAuthorityStatus?: string
  classification?: string
  restrictionStatus?: string
  ownerConfirmedAt?: string | null
  historyCount?: number
  specializedRestrictedGoodsAuthorityRequired?: boolean
}

const blank = (): Record<Key, Choice> => Object.fromEntries(
  questions.map(([key]) => [key, ""])) as Record<Key, Choice>

export default function FulfillmentAttestationPage() {
  const [opportunityId, setOpportunityId] = useState("")
  const [answers, setAnswers] = useState<Record<Key, Choice>>(blank)
  const [state, setState] = useState<Response | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function request(method: "GET" | "POST", id: string,
    fields?: Record<Key, boolean | "UNKNOWN">) {
    const session = await supabase.auth.getSession()
    if (!session.data.session) throw new Error("OWNER_SELLER_OS_AUTH_REQUIRED")
    const url = `/api/admin/ebay/fulfillment-attestation?${
      new URLSearchParams({ opportunityId: id })}`
    const response = await fetch(url, {
      method, cache: "no-store",
      headers: { Authorization: `Bearer ${session.data.session.access_token}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: method === "POST" ? JSON.stringify({ opportunityId: id,
        fields }) : undefined,
    })
    const result = await response.json() as Response
    if (!response.ok || !result.success) throw new Error(result.error ??
      "OWNER_FULFILLMENT_REQUEST_FAILED")
    return result
  }

  useEffect(() => {
    const id = new URLSearchParams(window.location.search)
      .get("opportunityId") ?? ""
    setOpportunityId(id)
    if (!id) return
    void request("GET", id).then(setState).catch((caught) =>
      setError(caught instanceof Error ? caught.message :
        "OWNER_FULFILLMENT_READ_FAILED"))
  }, [])

  async function load() {
    setBusy(true); setError("")
    try { setState(await request("GET", opportunityId.trim())) }
    catch (caught) { setError(caught instanceof Error ? caught.message :
      "OWNER_FULFILLMENT_READ_FAILED") }
    finally { setBusy(false) }
  }

  async function confirm() {
    if (questions.some(([key]) => !answers[key])) return
    setBusy(true); setError("")
    try {
      const fields = Object.fromEntries(questions.map(([key]) => [key,
        answers[key] === "UNKNOWN" ? "UNKNOWN" : answers[key] === "YES"])) as Record<Key, boolean | "UNKNOWN">
      const result = await request("POST", opportunityId.trim(), fields)
      setState(result)
      setAnswers(blank())
    } catch (caught) { setError(caught instanceof Error ? caught.message :
      "OWNER_FULFILLMENT_CONFIRMATION_FAILED") }
    finally { setBusy(false) }
  }

  return <main className="mx-auto max-w-2xl space-y-5 p-5 text-white">
    <h1 className="text-2xl font-black">Confirmación OWNER de fulfillment</h1>
    <p className="text-sm text-white/65">Confirma cada dato para la variante exacta. Una respuesta “Sí” o “No sé” exige revisión especializada y no certifica fulfillment irrestricto.</p>
    <label className="block text-sm font-bold">Opportunity ID
      <input value={opportunityId}
        onChange={(event) => { setOpportunityId(event.target.value.trim())
          setState(null); setAnswers(blank()) }}
        placeholder="00000000-0000-4000-8000-000000000000"
        className="mt-2 w-full rounded-xl border border-white/20 bg-black p-3 font-mono text-xs" />
    </label>
    <button type="button" onClick={() => void load()}
      disabled={busy || !/^[0-9a-f-]{36}$/i.test(opportunityId)}
      className="rounded-xl border border-white/30 px-4 py-2 text-sm font-bold disabled:opacity-50">
      Verificar identidad canónica
    </button>
    {state?.identity && <section className="rounded-2xl border border-white/15 p-4 text-sm">
      <p>Cuenta: <strong className="break-all">{state.identity.accountKey}</strong></p>
      <p>Marketplace: <strong>{state.identity.marketplace}</strong></p>
      <p>SKU: <strong>{state.identity.sku}</strong></p>
      <p>Producto / variante: <strong>{state.identity.productId} / {state.identity.variantId}</strong></p>
      <p className="mt-2">Autoridad actual: <strong>{state.fulfillmentAuthorityStatus ?? "UNKNOWN"}</strong></p>
      <p>Recibo actual: {state.fulfillmentReceiptId ?? "ninguno"}</p>
      <p>Atestaciones anteriores: {state.historyCount ?? 0}</p>
    </section>}
    {state?.identity && <section className="space-y-4 rounded-2xl border border-amber-200/30 p-4">
      <h2 className="font-bold">Respuestas explícitas del OWNER</h2>
      {questions.map(([key, label]) => <label key={key}
        className="block text-sm font-semibold">{label}
        <select value={answers[key]}
          onChange={(event) => setAnswers((current) => ({ ...current,
            [key]: event.target.value as Choice }))}
          className="mt-2 w-full rounded-xl border border-white/20 bg-slate-950 p-3">
          <option value="">Selecciona una respuesta</option>
          <option value="YES">Sí</option>
          <option value="NO">No</option>
          <option value="UNKNOWN">No sé</option>
        </select>
      </label>)}
      <button type="button" onClick={() => void confirm()}
        disabled={busy || questions.some(([key]) => !answers[key])}
        className="w-full rounded-xl bg-amber-300 p-3 font-black text-slate-950 disabled:opacity-50">
        {busy ? "Guardando…" : "Confirmar y guardar atestación"}
      </button>
    </section>}
    {state?.specializedRestrictedGoodsAuthorityRequired &&
      <p role="status" className="rounded-xl border border-amber-300/40 p-3 text-sm text-amber-100">Se requiere autoridad especializada para mercancías restringidas.</p>}
    {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
  </main>
}
