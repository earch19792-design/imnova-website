"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"
import { mergeSellerOsQuickPickPresentationV1 } from
  "@/lib/ebay/seller-os-quick-pick-presentation-v1"
import { SellerOsMobileNav } from "../components/seller-os-mobile-nav"

type StageState = "WAITING" | "RUNNING" | "PASS" | "BLOCKED"
type QuickPickReceipt = {
  batchId: string
  ownerReference: string
  status: string
  rawInputCount: number | null
  urlDedupedCount: number | null
  rejectedInputCount: number | null
  durableOperationCount: number | null
  exactProductCount: number | null
}
type QuickPickCard = {
  sourceUrl: string
  canonicalUrl: string | null
  sourceSku: string | null
  lunaProductId: string | null
  lunaVariantId: string | null
  candidateId: string | null
  opportunityId: string | null
  candidateKey: string | null
  listingPackageId: string | null
  title: string | null
  state: "WAITING" | "RUNNING" | "BLOCKED" | "READY"
  lastStage: string
  disposition: string
  exactBlocker: string | null
  exactBlockers: string[]
  variantSelectionRequired: boolean
  variants: Array<{ lunaProductId: string; lunaVariantId: string
    supplierSku: string; title: string; available: boolean
    supplierCostUsd: number }>
  durableFamilyHit: boolean
  onDemandDemandDiscoveryRequired: boolean
  onDemandDemandDiscoveryExecuted: boolean
  soldComparableCount: number
  familyDemandStatus: string | null
  familyBindingCreatedOrReused: boolean
  demandEvidenceClass: string | null
  demandNegativeEvidencePresent: boolean
  marketTestPathEligible: boolean
  marketTestReady: boolean
  marketTestReview: Record<string, unknown> | null
  requiredItemSpecificsCount: number | null
  requiredItemSpecificsSatisfied: number | null
  requiredItemSpecificsReady: boolean | null
  unresolvedRequiredAspects: string[]
  conditionReady: boolean | null
  automaticResolutionExhausted: boolean
  exactUnresolvedFields: string[]
  ownerResidualActions: Array<{ productField: string
    bestProposal: string | null; proposalEvidence: string
    confidence: string; ownerAction: "CONFIRM" | "ENTER_FACT" }>
  nextOwnerAction: "CONFIRM" | "ENTER_FACT" | null
  ownerTruePublicationBlockers: Array<{
    specificName: string
    requirementClass: "REQUIRED_TO_LIST" | "CONDITIONALLY_REQUIRED"
    officialPolicySource: string
    currentFactStatus: string
    aiAutonomousResolutionAllowed: boolean
    ownerInputRequired: boolean
    blocksMinimumTruthfulListing: boolean
    mode: string
    maxLength: number | null
    dataType: string
    valuesComplete: boolean
    allowedValues: string[]
    bestProposal: string | null
    proposalEvidence: string | null
    factInvented: false
  }>
  ownerCapturedFacts: Array<{ specificName: string; exactValue: string
    normalizedMarketplaceValue: string; capturedAt: string
    evidenceDigest: string; correctionAllowedBeforePublication: boolean
    factInvented: false }>
  postPublishEnrichmentOpportunities: Array<{ specificName: string
    requirementClass: "RECOMMENDED" | "OPTIONAL" }>
  minimumTruthfulListingReady: boolean
  officialRequirementClassification: boolean
  requirementCounts: { requiredToList: number; conditionallyRequired: number
    recommended: number; optional: number; unproven: number }
  productIdentifierRequirementStatus: "PASS" | "BLOCKED_REQUIRED_FACT" |
    "UNPROVEN_CAPABILITY" | null
  safeResumeAfterOwnerFact: boolean
  deterministicResolvedCount: number
  marketplaceFallbackResolvedCount: number
  aiCallCount: number
  aiAspectsResolvedCount: number
  factInvented: false
  marketplaceReadinessReady: boolean
  shippingUsd: number | null
  rehydrated: boolean
  updatedAt: string | null
  stages: Record<string, StageState>
  dollarCheck: Record<string, unknown> | null
  elapsedMs: number
}

const stages = [
  ["IDENTITY", "Producto identificado"],
  ["DUPLICATE", "Comprobando si ya está publicado"],
  ["STOCK", "Stock disponible"],
  ["DEMAND", "Buscando demanda"],
  ["SHIPPING", "Calculando envío"],
  ["ECONOMICS", "Comprobando margen"],
  ["PRODUCT_TRUTH", "Verificando producto exacto"],
  ["LISTING_PACKAGE", "Preparando eBay"],
  ["REQUIRED_SPECIFICS", "Comprobando datos requeridos"],
  ["MARKETPLACE_READINESS", "Comprobando requisitos eBay"],
  ["LISTING_READY", "Listo para publicar"],
] as const

function money(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number)
    ? new Intl.NumberFormat("es-US", { style: "currency", currency: "USD" })
      .format(number) : "No comprobado"
}

function percent(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? `${number.toFixed(2)}%` : "No comprobado"
}

function stateTone(state: QuickPickCard["state"]) {
  if (state === "READY") return "border-emerald-200/40 bg-emerald-200/[0.08]"
  if (state === "BLOCKED") return "border-amber-200/35 bg-amber-200/[0.07]"
  if (state === "RUNNING") return "border-cyan-200/35 bg-cyan-200/[0.07]"
  return "border-white/15 bg-white/[0.04]"
}

function stageIcon(state: StageState | undefined) {
  if (state === "PASS") return "✅"
  if (state === "RUNNING") return "…"
  if (state === "BLOCKED") return "⚠️"
  return "○"
}

function cardBlockers(card: QuickPickCard) {
  return [...new Set(card.exactBlockers?.length
    ? card.exactBlockers
    : card.exactBlocker ? [card.exactBlocker] : [])]
}

export default function LunaQuickPickPage() {
  const [input, setInput] = useState("")
  const [cards, setCards] = useState<QuickPickCard[]>([])
  const [error, setError] = useState("")
  const [rehydrating, setRehydrating] = useState(true)
  const [receipt, setReceipt] = useState<QuickPickReceipt | null>(null)
  const [factDrafts, setFactDrafts] = useState<Record<string, string>>({})
  const [factBusy, setFactBusy] = useState<Record<string, boolean>>({})
  const [factFeedback, setFactFeedback] = useState<Record<string, string>>({})

  const candidateKeys = useMemo(() => cards.flatMap((card) =>
    card.candidateKey ? [card.candidateKey] : []), [cards])

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("ADMIN_AUTH_REQUIRED")
    const response = await fetch(path, { ...init, cache: "no-store",
      headers: { ...(init?.headers ?? {}),
        Authorization: `Bearer ${data.session.access_token}` } })
    const payload = await response.json()
    if (!response.ok || !payload.success) throw new Error(payload.error ||
      "LUNA_QUICK_PICK_REQUEST_FAILED")
    return payload
  }, [])

  const mergeCards = useCallback((incoming: QuickPickCard[]) => {
    setCards((current) => [...mergeSellerOsQuickPickPresentationV1(
      current, incoming)])
  }, [])

  const processLinks = useCallback(async (urls: string[],
    selectedVariants: Record<string, string> = {}) => {
    setError("")
    let batchAccepted = false
    mergeCards(urls.map((sourceUrl) => ({ sourceUrl, canonicalUrl: null,
      sourceSku: null, lunaProductId: null, lunaVariantId: null,
      candidateId: null, opportunityId: null, candidateKey: null,
      listingPackageId: null, title: null, state: "RUNNING",
      lastStage: "IDENTITY", disposition: "RUNNING", exactBlocker: null,
      exactBlockers: [],
      variantSelectionRequired: false, variants: [], stages: {
        IDENTITY: "RUNNING" }, durableFamilyHit: false,
      onDemandDemandDiscoveryRequired: false,
      onDemandDemandDiscoveryExecuted: false, soldComparableCount: 0,
      familyDemandStatus: null, familyBindingCreatedOrReused: false,
      demandEvidenceClass: null, demandNegativeEvidencePresent: false,
      marketTestPathEligible: false, marketTestReady: false,
      marketTestReview: null,
      requiredItemSpecificsCount: null,
      requiredItemSpecificsSatisfied: null,
      requiredItemSpecificsReady: null, unresolvedRequiredAspects: [],
      conditionReady: null, automaticResolutionExhausted: false,
      exactUnresolvedFields: [], ownerResidualActions: [],
      ownerTruePublicationBlockers: [], ownerCapturedFacts: [],
      postPublishEnrichmentOpportunities: [],
      nextOwnerAction: null, deterministicResolvedCount: 0,
      marketplaceFallbackResolvedCount: 0, aiCallCount: 0,
      aiAspectsResolvedCount: 0, factInvented: false,
      marketplaceReadinessReady: false,
      minimumTruthfulListingReady: false,
      officialRequirementClassification: false,
      requirementCounts: { requiredToList: 0, conditionallyRequired: 0,
        recommended: 0, optional: 0, unproven: 0 },
      productIdentifierRequirementStatus: null,
      safeResumeAfterOwnerFact: false,
      shippingUsd: null, rehydrated: false, updatedAt: null,
      dollarCheck: null, elapsedMs: 0 })))
    try {
      const received = await request("/api/admin/ebay/luna-quick-pick", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RECEIVE", urls }),
      })
      batchAccepted = true
      setReceipt(received.receipt)
      mergeCards(received.receipt.cards ?? [])
      const payload = await request("/api/admin/ebay/luna-quick-pick", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PROCESS",
          batchId: received.receipt.batchId, urls, selectedVariants }),
      })
      mergeCards(payload.result.cards)
      setReceipt(payload.receipt ?? received.receipt)
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : ""
      setError(batchAccepted
        ? "Lote recibido · reconciliando el progreso durable"
        : message || "LUNA_QUICK_PICK_REQUEST_FAILED")
      if (batchAccepted) return
      setCards((current) => current.map((card) => urls.includes(card.sourceUrl)
        && card.state === "RUNNING" ? { ...card, state: "BLOCKED",
          disposition: "BLOCKED", exactBlocker: message,
          exactBlockers: message ? [message] : [],
          stages: { ...card.stages, [card.lastStage]: "BLOCKED" } } : card))
    }
  }, [mergeCards, request])

  async function submit() {
    const urls = input.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
    if (!urls.length) return
    setInput("")
    await processLinks(urls)
  }

  async function chooseVariant(card: QuickPickCard, variantId: string) {
    if (!card.canonicalUrl) return
    await processLinks([card.sourceUrl], { [card.canonicalUrl]: variantId })
  }

  const ownerFactKey = (card: QuickPickCard, specificName: string) =>
    `${card.candidateKey ?? "unknown"}:${specificName}`

  async function saveOwnerFact(card: QuickPickCard,
    blocker: Readonly<{ specificName: string; bestProposal?: string | null }>,
    explicitValue?: string) {
    if (!card.candidateKey || !card.listingPackageId) return
    const key = ownerFactKey(card, blocker.specificName)
    const exactValue = (explicitValue ?? factDrafts[key] ??
      blocker.bestProposal ?? "").trim()
    if (!exactValue) {
      setFactFeedback((current) => ({ ...current,
        [key]: "Escribe el dato exacto antes de guardar." }))
      return
    }
    setFactBusy((current) => ({ ...current, [key]: true }))
    setFactFeedback((current) => ({ ...current, [key]: "" }))
    try {
      const payload = await request("/api/admin/ebay/luna-quick-pick", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "OWNER_FACT_CAPTURE",
          candidateKey: card.candidateKey,
          listingPackageId: card.listingPackageId,
          specificName: blocker.specificName,
          exactValue }),
      })
      mergeCards(payload.progress ?? [])
      setFactFeedback((current) => ({ ...current,
        [key]: "Dato guardado. Seller OS continuó desde este punto ✓" }))
    } catch (caught) {
      setFactFeedback((current) => ({ ...current,
        [key]: caught instanceof Error
          ? "No se pudo guardar. Tu producto no avanzó y puedes intentarlo de nuevo."
          : "No se pudo guardar este dato." }))
    } finally {
      setFactBusy((current) => ({ ...current, [key]: false }))
    }
  }

  useEffect(() => {
    let cancelled = false
    request("/api/admin/ebay/luna-quick-pick").then((payload) => {
      if (!cancelled) {
        mergeCards(payload.progress ?? [])
        if (payload.receipt) setReceipt(payload.receipt)
      }
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message :
        "LUNA_QUICK_PICK_REHYDRATION_FAILED")
    }).finally(() => { if (!cancelled) setRehydrating(false) })
    return () => { cancelled = true }
  }, [mergeCards, request])

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const params = new URLSearchParams()
        candidateKeys.forEach((key) => params.append("candidate", key))
        const payload = await request(`/api/admin/ebay/luna-quick-pick?${params}`)
        if (cancelled) return
        mergeCards(payload.progress ?? [])
        if (payload.receipt) setReceipt(payload.receipt)
        setError("")
      } catch {
        setError("No pude cargar el estado del lote · reintentando")
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2_500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [candidateKeys.join("\n"), mergeCards, request])

  const sections = useMemo(() => [
    { id: "in-progress", title: "En proceso",
      copy: "Seller OS continúa automáticamente cuando llega nueva evidencia durable.",
      cards: cards.filter((card) => card.state === "RUNNING") },
    { id: "ready", title: "Listos para revisar",
      copy: "Dollar Check y pruebas de mercado que esperan una decisión del owner.",
      cards: cards.filter((card) => card.state === "READY") },
    { id: "blocked", title: "Bloqueados",
      copy: "Cada producto conserva su avance y muestra solamente el blocker real.",
      cards: cards.filter((card) => card.state === "BLOCKED") },
    { id: "completed", title: "Completados / Publicados",
      copy: "Aparecerán aquí después de una publicación autorizada y readback LIVE.",
      cards: [] as QuickPickCard[] },
  ], [cards])

  const ownerLastMileCards = useMemo(() => cards.filter((card) =>
    card.ownerTruePublicationBlockers?.length > 0)
    .sort((left, right) =>
      left.ownerTruePublicationBlockers.length
        - right.ownerTruePublicationBlockers.length
      || String(left.sourceSku ?? "").localeCompare(
        String(right.sourceSku ?? ""))), [cards])
  const ownerLastMileFactCount = ownerLastMileCards.reduce((total, card) =>
    total + card.ownerTruePublicationBlockers.length, 0)

  return <main className="min-h-screen bg-[#080b11] px-4 pb-28 pt-6 text-white">
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="rounded-3xl border border-cyan-200/25 bg-cyan-200/[0.06] p-5">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-100/65">Seller OS · Fast Listing Path</p>
        <h1 className="mt-2 text-3xl font-black">⚡ Quick Pick Luna</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">Pega productos Luna. Cada uno avanza de forma independiente por identidad, stock, demanda, envío, economía y preparación eBay. Nada se publica sin tu clic final.</p>
      </header>

      <section className="rounded-3xl border border-white/15 bg-white/[0.04] p-4">
        <label className="block"><span className="font-black">Pegar uno o varios links Luna</span>
          <textarea value={input} onChange={(event) => setInput(event.target.value)}
            placeholder="https://www.lunaportex.com/products/...&#10;https://www.lunaportex.com/products/..."
            rows={5} className="mt-3 w-full rounded-2xl border border-white/20 bg-black/30 p-4 text-sm outline-none focus:border-cyan-200" /></label>
        <button type="button" onClick={() => void submit()} disabled={!input.trim()}
          className="mt-3 min-h-12 w-full rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-40">Procesar ahora</button>
        <p className="mt-2 text-xs text-white/45">Puedes agregar más links mientras los anteriores continúan. Máximo 20 por envío; concurrencia bounded de 4 productos.</p>
        {error && <p role="alert" className="mt-3 rounded-xl border border-rose-200/30 bg-rose-200/[0.08] p-3 text-sm text-rose-50">{error}</p>}
      </section>

      {receipt && <section aria-live="polite"
        className="rounded-3xl border border-emerald-200/30 bg-emerald-200/[0.07] p-4">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100/70">Lote recibido · {receipt.ownerReference}</p>
        <p className="mt-2 text-lg font-black">{receipt.rawInputCount ?? "—"} links recibidos · {receipt.urlDedupedCount ?? "—"} únicos · {receipt.rejectedInputCount ?? "—"} rechazados · {receipt.durableOperationCount ?? "—"} productos materializados</p>
        <p className="mt-1 text-sm text-white/55">Seller OS conserva este lote y actualiza sus productos automáticamente.</p>
      </section>}

      {rehydrating && <p aria-live="polite" className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.05] p-4 text-sm text-cyan-50">Recuperando tus Quick Picks guardados…</p>}

      {ownerLastMileCards.length > 0 && <section
        aria-labelledby="owner-last-mile-title"
        className="rounded-3xl border border-sky-200/35 bg-sky-200/[0.07] p-4 sm:p-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-100/70">Tu última revisión</p>
        <h2 id="owner-last-mile-title" className="mt-1 text-xl font-black">
          {ownerLastMileCards.length} productos necesitan tu atención
        </h2>
        <p className="mt-1 text-sm text-white/65">
          {ownerLastMileFactCount} datos en total. Aquí aparecen únicamente los datos que eBay exige para poder continuar.
        </p>
        <div className="mt-4 grid gap-3">
          {ownerLastMileCards.map((card) => <article
            key={`owner:${card.candidateKey}`}
            className="rounded-2xl border border-white/15 bg-black/20 p-4">
            <p className="text-xs font-black uppercase tracking-wider text-white/45">{card.sourceSku}</p>
            <h3 className="mt-1 font-black">{card.title}</h3>
            <p className="mt-2 text-sm text-sky-50">
              Falta {card.ownerTruePublicationBlockers.length === 1
                ? "1 dato" : `${card.ownerTruePublicationBlockers.length} datos`} para poder publicar.
            </p>
            <div className="mt-3 grid gap-3">
              {card.ownerTruePublicationBlockers.map((blocker) => {
                const fieldKey = ownerFactKey(card, blocker.specificName)
                const draft = factDrafts[fieldKey] ?? ""
                const busy = factBusy[fieldKey] === true
                return <div key={blocker.specificName}
                  className="rounded-xl border border-sky-100/15 bg-white/[0.04] p-3">
                  <p className="text-xs font-black uppercase tracking-wider text-sky-100/65">Campo</p>
                  <p className="mt-1 font-black">{blocker.specificName}</p>
                  <p className="mt-2 text-sm leading-5 text-white/65">
                    Seller OS revisó la información disponible pero no pudo demostrar este dato con suficiente evidencia. eBay lo exige para continuar.
                  </p>
                  {blocker.bestProposal && <div className="mt-3 rounded-xl border border-emerald-200/20 bg-emerald-200/[0.06] p-3">
                    <p className="text-sm">Seller OS propone: <strong>{blocker.bestProposal}</strong></p>
                    <button type="button" disabled={busy}
                      onClick={() => void saveOwnerFact(card, blocker,
                        blocker.bestProposal ?? undefined)}
                      className="mt-2 min-h-11 rounded-xl bg-emerald-200 px-4 font-black text-black disabled:opacity-40">
                      {busy ? "Guardando…" : "Confirmar"}
                    </button>
                  </div>}
                  <label className="mt-3 block">
                    <span className="text-xs font-black text-white/65">
                      {blocker.bestProposal ? "Editar valor" : "Dato exacto"}
                    </span>
                    {blocker.mode === "SELECTION_ONLY"
                        && blocker.valuesComplete
                        && blocker.allowedValues.length > 0
                      ? <select value={draft}
                        onChange={(event) => setFactDrafts((current) => ({
                          ...current, [fieldKey]: event.target.value }))}
                        className="mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-[#101722] px-3 outline-none focus:border-sky-200">
                        <option value="">Selecciona el valor exacto</option>
                        {blocker.allowedValues.map((value) => <option
                          key={value} value={value}>{value}</option>)}
                      </select>
                      : <input value={draft}
                        maxLength={blocker.maxLength ?? 500}
                        onChange={(event) => setFactDrafts((current) => ({
                          ...current, [fieldKey]: event.target.value }))}
                        placeholder={`Escribe ${blocker.specificName}`}
                        className="mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-black/30 px-3 outline-none focus:border-sky-200" />}
                  </label>
                  <button type="button" disabled={busy || !draft.trim()}
                    onClick={() => void saveOwnerFact(card, blocker)}
                    className="mt-2 min-h-11 w-full rounded-xl bg-sky-200 px-4 font-black text-black disabled:opacity-40">
                    {busy ? "Guardando…" : blocker.bestProposal
                      ? "Guardar edición" : "Guardar y continuar"}
                  </button>
                  {factFeedback[fieldKey] && <p aria-live="polite"
                    className="mt-2 text-xs text-sky-50">
                    {factFeedback[fieldKey]}
                  </p>}
                </div>
              })}
            </div>
          </article>)}
        </div>
      </section>}

      {sections.map((section) => <section key={section.id}
        aria-labelledby={`quick-pick-${section.id}`} className="space-y-3">
        <div><h2 id={`quick-pick-${section.id}`} className="text-xl font-black">{section.title}</h2>
          <p className="mt-1 text-sm text-white/55">{section.copy}</p></div>
        {section.cards.length === 0 ? <p className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm text-white/45">No hay productos en esta sección.</p> : <div className="grid gap-4 lg:grid-cols-2">
        {section.cards.map((card) => <article key={card.opportunityId ??
          card.candidateKey ?? `${card.lunaProductId ?? "pending"}:${
            card.lunaVariantId ?? card.sourceUrl}`}
          className={`rounded-3xl border p-4 ${card.marketTestReady
            ? "border-amber-200/45 bg-amber-200/[0.09]" : stateTone(card.state)}`}>
          <div className="flex items-start justify-between gap-3"><div>
            <p className="text-xs font-black uppercase tracking-widest text-white/45">{card.sourceSku ?? "Identificando…"}</p>
            <h2 className="mt-1 font-black">{card.title ?? "Producto Luna"}</h2>
          </div><span className="rounded-full border border-white/20 px-3 py-1 text-xs font-black">{card.state}</span></div>

          {card.variantSelectionRequired && <div className="mt-4 rounded-2xl border border-amber-200/30 bg-black/20 p-3">
            <strong>Elige la variante exacta</strong>
            <div className="mt-2 grid gap-2">{card.variants.map((variant) =>
              <button key={variant.lunaVariantId} type="button"
                onClick={() => void chooseVariant(card, variant.lunaVariantId)}
                className="rounded-xl border border-white/15 p-3 text-left text-sm hover:border-cyan-200">
                <strong>{variant.title}</strong><span className="block text-xs text-white/55">{variant.supplierSku} · {money(variant.supplierCostUsd)} · {variant.available ? "Disponible" : "Sin stock"}</span>
              </button>)}</div>
          </div>}

          <ol className="mt-4 space-y-1.5 text-sm">{stages.map(([key, label]) =>
            <li key={key} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${card.stages[key] === "RUNNING" ? "bg-cyan-200/[0.08] text-cyan-50" : card.stages[key] === "BLOCKED" ? "text-amber-100" : "text-white/65"}`}>
              <span aria-hidden="true">{stageIcon(card.stages[key])}</span><span>{label}</span>
            </li>)}</ol>

          {card.stages.SHIPPING === "PASS" && <p className="mt-3 rounded-xl border border-emerald-200/20 bg-emerald-200/[0.06] p-2 text-sm text-emerald-50">Envío comprobado{card.shippingUsd !== null ? ` · ${money(card.shippingUsd)}` : ""}</p>}
          {card.stages.SHIPPING === "RUNNING" && <p className="mt-3 rounded-xl border border-cyan-200/20 bg-cyan-200/[0.06] p-2 text-sm text-cyan-50">Esperando worker Luna. Seller OS reanudará este producto automáticamente.</p>}

          {card.ownerTruePublicationBlockers.length > 0 && <p
            className="mt-3 rounded-xl border border-sky-200/20 bg-sky-200/[0.06] p-3 text-sm text-sky-50">
            Este producto está incluido en “Tu última revisión” para completar únicamente lo que eBay exige.
          </p>}
          {card.ownerTruePublicationBlockers.length === 0
              && card.productIdentifierRequirementStatus ===
                "UNPROVEN_CAPABILITY" && <p
            className="mt-3 rounded-xl border border-cyan-200/20 bg-cyan-200/[0.06] p-3 text-sm text-cyan-50">
            Esperando que eBay permita comprobar su política de identificadores. Tu avance está guardado.
          </p>}

          {!card.officialRequirementClassification
              && (card.ownerResidualActions ?? []).length > 0 && <section
            className="mt-3 rounded-xl border border-sky-200/20 bg-sky-200/[0.06] p-3 text-sm text-sky-50">
            <strong>{card.nextOwnerAction === "ENTER_FACT"
              ? "Último dato del owner requerido"
              : "Confirmación final del owner requerida"}</strong>
            <ul className="mt-2 space-y-1 text-xs">
              {(card.ownerResidualActions ?? []).map((action) => <li
                key={action.productField}>
                {action.productField}: {action.bestProposal
                  ? `confirmar “${action.bestProposal}” o editar`
                  : "ingresar el hecho exacto"}
              </li>)}
            </ul>
          </section>}

          {card.ownerCapturedFacts.length > 0 && <details
            className="mt-3 rounded-xl border border-white/10 p-3 text-sm text-white/65">
            <summary className="flex min-h-11 cursor-pointer items-center font-black">
              Corregir datos que confirmaste
            </summary>
            <div className="mt-2 grid gap-3">
              {card.ownerCapturedFacts.map((fact) => {
                const fieldKey = ownerFactKey(card, fact.specificName)
                const value = factDrafts[fieldKey] ?? fact.exactValue
                return <label key={fact.evidenceDigest} className="block">
                  <span className="text-xs font-black">{fact.specificName}</span>
                  <input value={value} onChange={(event) =>
                    setFactDrafts((current) => ({ ...current,
                      [fieldKey]: event.target.value }))}
                    className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-black/25 px-3" />
                  <button type="button" disabled={factBusy[fieldKey] === true
                      || !value.trim()}
                    onClick={() => void saveOwnerFact(card, {
                      specificName: fact.specificName,
                    }, value)}
                    className="mt-2 min-h-11 rounded-xl border border-white/20 px-4 font-black disabled:opacity-40">
                    {factBusy[fieldKey] ? "Guardando…" : "Guardar corrección"}
                  </button>
                  {factFeedback[fieldKey] && <span className="mt-2 block text-xs text-sky-50">{factFeedback[fieldKey]}</span>}
                </label>
              })}
            </div>
          </details>}

          {card.state === "READY" && card.dollarCheck && <section
            className={`mt-4 rounded-2xl border p-3 ${card.marketTestReady
              ? "border-amber-200/35 bg-amber-200/[0.08]"
              : "border-emerald-200/30 bg-emerald-200/[0.08]"}`}>
            <h3 className={`font-black ${card.marketTestReady
              ? "text-amber-50" : "text-emerald-50"}`}>{card.marketTestReady
              ? "🟡 PRUEBA DE MERCADO" : "Dollar Check"}</h3>
            {card.marketTestReady && <p className="mt-2 text-sm leading-5 text-amber-50">No encontramos suficiente historial de demanda en eBay. El producto pasa stock, costos y preparación del listing. Puedes probarlo con riesgo comercial explícito.</p>}
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div><dt>{card.marketTestReady ? "Test price" : "Precio"}</dt><dd className="font-black">{money(card.marketTestReady ? card.marketTestReview?.testPrice : card.dollarCheck.targetPrice)}</dd></div>
              <div><dt>Supplier cost</dt><dd className="font-black">{money(card.dollarCheck.supplierCost)}</dd></div>
              <div><dt>Shipping</dt><dd className="font-black">{money(card.dollarCheck.shipping)}</dd></div>
              <div><dt>eBay fees</dt><dd className="font-black">{money(card.dollarCheck.ebayFees)}</dd></div>
              <div><dt>Profit</dt><dd className="font-black">{money(card.dollarCheck.profit)}</dd></div>
              <div><dt>Margin</dt><dd className="font-black">{percent(card.dollarCheck.margin)}</dd></div>
              <div><dt>ROI</dt><dd className="font-black">{percent(card.dollarCheck.roi)}</dd></div>
              <div><dt>Stock</dt><dd className="font-black">Seguro</dd></div>
            </dl>
            {card.marketTestReady ? <button type="button"
              className="mt-3 min-h-12 w-full rounded-xl bg-amber-200 px-4 font-black text-black">REVISAR PRUEBA DE MERCADO</button> : card.opportunityId && card.candidateKey && <a
              href={`/admin/ebay/listing-workspace?opportunity=${encodeURIComponent(card.opportunityId)}&candidate=${encodeURIComponent(card.candidateKey)}`}
              className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-200 px-4 font-black text-black">PUBLICAR EN EBAY</a>}
            <p className={`mt-2 text-xs ${card.marketTestReady
              ? "text-amber-50/70" : "text-emerald-50/65"}`}>{card.marketTestReady
              ? "Demanda = UNPROVEN. Precio competitivo = UNPROVEN. Requiere autorización explícita del owner."
              : "Abre la autoridad de publicación existente. Este Quick Pick no publica automáticamente."}</p>
          </section>}

          <details className="mt-3 rounded-xl border border-white/10 p-2 text-xs text-white/55"><summary className="flex min-h-11 cursor-pointer items-center font-black">Ver evidencia técnica</summary><dl className="mt-2 space-y-1"><div>Product ID: {card.lunaProductId ?? "—"}</div><div>Variant ID: {card.lunaVariantId ?? "—"}</div><div>Operación rehidratada: {card.rehydrated ? "sí" : "no"}</div><div>Demanda durable previa: {card.durableFamilyHit ? "sí" : "no"}</div><div>Discovery bajo demanda: {card.onDemandDemandDiscoveryExecuted ? "ejecutado" : card.onDemandDemandDiscoveryRequired ? "requerido" : "no requerido"}</div><div>Estado demanda: {card.familyDemandStatus ?? "—"}</div><div>Comparables sold: {card.soldComparableCount}</div><div>Binding familia: {card.familyBindingCreatedOrReused ? "creado/reutilizado" : "—"}</div><div>Specifics requeridos: {card.requiredItemSpecificsCount ?? "—"}</div><div>Specifics satisfechos: {card.requiredItemSpecificsSatisfied ?? "—"}</div><div>Specifics listos: {card.requiredItemSpecificsReady === null ? "—" : card.requiredItemSpecificsReady ? "sí" : "no"}</div><div>Specifics pendientes: {card.unresolvedRequiredAspects.length ? card.unresolvedRequiredAspects.join(", ") : "ninguno"}</div><div>Condición lista: {card.conditionReady === null ? "—" : card.conditionReady ? "sí" : "no"}</div><div>Blockers: {cardBlockers(card).length ? cardBlockers(card).join(" · ") : "ninguno"}</div><div>Resueltos determinísticamente: {card.deterministicResolvedCount}</div><div>Fallbacks marketplace: {card.marketplaceFallbackResolvedCount}</div><div>Llamadas IA: {card.aiCallCount}</div><div>Aspectos resueltos por IA: {card.aiAspectsResolvedCount}</div><div>Fact inventado: no</div><div>Última etapa: {card.lastStage}</div><div>Disposición: {card.disposition}</div><div>Actualizado: {card.updatedAt ? new Date(card.updatedAt).toLocaleString("es-NI") : "—"}</div><div>Tiempo: {card.elapsedMs} ms</div></dl></details>
        </article>)}
        </div>}
      </section>)}
    </div>
    <SellerOsMobileNav active="quick-pick" />
  </main>
}
