"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

type CategoryState = {
  identity?: { opportunityId: string; candidateKey: string; sku: string;
    productId: string; variantId: string }
  categoryAuthorityStatus?: string
  categoryReceiptId?: string | null
  categoryId?: string | null
  exactCategoryPath?: string | null
  taxonomyVersion?: string | null
  feePolicyStatus?: string
  applicableFvfRule?: { ruleId: string; method: string;
    percentageTiers: { ratePct: number; upTo: number | null }[] } | null
  perOrderFeeRule?: { threshold: number; atOrBelow: number; above: number } | null
  readyForEconomics?: boolean
  error?: string
}

export default function OpportunityCategoryPage() {
  const [opportunityId, setOpportunityId] = useState("")
  const [candidateKey, setCandidateKey] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [state, setState] = useState<CategoryState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function request(method: "GET" | "POST", opportunity: string,
    candidate: string, category: string) {
    const session = await supabase.auth.getSession()
    if (!session.data.session) throw Error("OWNER_SELLER_OS_AUTH_REQUIRED")
    const params = new URLSearchParams({ opportunityId: opportunity,
      candidateKey: candidate })
    const response = await fetch(
      `/api/admin/ebay/opportunity-category?${params.toString()}`,
      { method, cache: "no-store", headers: {
        Authorization: `Bearer ${session.data.session.access_token}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      }, body: method === "POST" ? JSON.stringify({ opportunityId: opportunity,
        candidateKey: candidate, categoryId: category }) : undefined },
    )
    const result = await response.json() as CategoryState & { success?: boolean }
    if (!response.ok || !result.success) throw Error(result.error ??
      "OPPORTUNITY_CATEGORY_REQUEST_FAILED")
    return result
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const opportunity = params.get("opportunityId") ?? ""
    const candidate = params.get("candidateKey") ?? ""
    setOpportunityId(opportunity)
    setCandidateKey(candidate)
    if (!opportunity || !candidate) return
    void request("GET", opportunity, candidate, "")
      .then((result) => { setState(result)
        if (result.categoryId) setCategoryId(result.categoryId) })
      .catch((caught) => setError(caught instanceof Error ? caught.message
        : "OPPORTUNITY_CATEGORY_READ_FAILED"))
  }, [])

  async function confirm() {
    setBusy(true); setError("")
    try {
      const result = await request("POST", opportunityId, candidateKey,
        categoryId.trim())
      setState(result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message
        : "OPPORTUNITY_CATEGORY_WRITE_FAILED")
    } finally { setBusy(false) }
  }

  return <main className="mx-auto max-w-2xl space-y-5 p-5 text-white">
    <h1 className="text-2xl font-black">Categoría de oportunidad eBay</h1>
    <p className="text-sm text-white/65">Confirma una categoría hoja para esta identidad Luna. Seller OS verificará la ruta exacta con eBay y conservará el recibo en la oportunidad antes de calcular fees o crear el paquete.</p>
    {state?.identity && <dl className="rounded-2xl border border-white/15 p-4 text-sm">
      <dt>SKU</dt><dd className="font-bold">{state.identity.sku}</dd>
      <dt className="mt-2">Producto / variante</dt>
      <dd className="font-bold">{state.identity.productId} / {state.identity.variantId}</dd>
      <dt className="mt-2">Marketplace</dt><dd className="font-bold">EBAY_US</dd>
    </dl>}
    <label className="block text-sm font-bold">ID de categoría hoja eBay
      <input value={categoryId} onChange={(event) => setCategoryId(event.target.value)}
        inputMode="numeric" pattern="[0-9]+" maxLength={20}
        className="mt-2 block w-full rounded-xl border border-white/20 bg-black p-3" />
    </label>
    <button type="button" onClick={() => void confirm()}
      disabled={busy || !/^\d{1,20}$/.test(categoryId) || !state?.identity}
      className="w-full rounded-xl bg-cyan-200 p-3 font-black text-black disabled:opacity-50">
      {busy ? "Verificando…" : "Confirmar categoría y guardar recibo"}
    </button>
    {error && <p role="alert" className="text-rose-200">{error}</p>}
    {state && <section className="rounded-2xl border border-white/15 p-4 text-sm">
      <p>Autoridad: <strong>{state.categoryAuthorityStatus ?? "MISSING"}</strong></p>
      {state.categoryReceiptId && <p className="break-all">Recibo: {state.categoryReceiptId}</p>}
      {state.exactCategoryPath && <p>Ruta exacta: {state.exactCategoryPath.replaceAll(":", " > ")}</p>}
      <p>Taxonomía: {state.taxonomyVersion ?? "pendiente"}</p>
      <p>Política NO_STORE: <strong>{state.feePolicyStatus ?? "MISSING"}</strong></p>
      {state.applicableFvfRule && <p>Regla: {state.applicableFvfRule.ruleId}</p>}
      <p>Lista para economía: {state.readyForEconomics ? "sí" : "no"}</p>
    </section>}
  </main>
}
