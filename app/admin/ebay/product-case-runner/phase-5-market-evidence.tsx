"use client"

import { useEffect, useMemo, useState } from "react"

import {
  deleteGeneralMarketComparable,
  deleteGeneralMarketResearchSession,
  deriveGeneralComparableMarketPhaseStatus,
  GENERAL_PRODUCT_COMPARABLE_MARKET_EVIDENCE_CONTRACT_VERSION,
  saveGeneralMarketComparable,
  saveGeneralMarketResearchSession,
  type ProductCaseDocument,
  type ProductCaseGeneralComparable,
  type ProductCaseGeneralMarketResearchSession,
  type ProductCaseManualMarketSourceType,
} from "@/lib/ebay/product-case-runner"

type MetricKey =
  | "totalSold"
  | "sellThroughRate"
  | "averageSoldPrice"
  | "minimumSoldPrice"
  | "maximumSoldPrice"
  | "activeListingCount"

type MetricDraft = { originalLabel: string; rawValue: string; currency: string }
type SessionDraft = {
  researcher: string
  marketplace: "EBAY_US"
  sourceType: ProductCaseManualMarketSourceType
  query: string
  researchPeriodDays: "30" | "90" | "365"
  conditionFilter: string
  buyingFormatFilter: string
  categoryFilter: string
  priceFilter: string
  itemLocationFilter: string
  sourceReference: string
  rawVisibleResearchText: string
  humanNotes: string
  manuallyReadConfirmed: boolean
  sellOneLikeThisNotUsedConfirmed: boolean
  generalComparisonOnlyConfirmed: boolean
  metrics: Record<MetricKey, MetricDraft>
  shippingIncludedInMetric: "UNKNOWN" | "TRUE" | "FALSE"
}

type ComparableDraft = {
  comparableId: string
  researchSessionId: string
  sourceType: ProductCaseManualMarketSourceType
  ebayItemId: string
  listingUrl: string
  title: string
  listingState: "SOLD" | "ACTIVE" | "UNKNOWN"
  price: string
  currency: string
  shippingPrice: string
  condition: string
  category: string
  soldDate: string
  observedAttributes: string
  differencesFromSupplierProduct: string
  humanDecision:
    | "INCLUDE_AS_GENERAL_COMPARABLE"
    | "EXCLUDE_NOT_COMPARABLE"
    | "NEEDS_MORE_EVIDENCE"
  humanReason: string
}

type Props = {
  document: ProductCaseDocument
  onUpdated: (updatedDocument: ProductCaseDocument, notice: string) => void
  onReturnToBlocker: () => void
}

const inputClass =
  "min-h-11 w-full rounded-xl border border-white/15 bg-black/30 px-3 text-sm text-white outline-none focus:border-cyan-200/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
const areaClass = `${inputClass} min-h-24 resize-y py-3 font-mono text-xs leading-5`
const buttonClass =
  "min-h-11 rounded-xl border border-cyan-200/25 px-4 text-xs font-black disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"

const metricLabels: Record<MetricKey, string> = {
  totalSold: "Total vendidos — totalSold",
  sellThroughRate: "Tasa de venta — sellThroughRate",
  averageSoldPrice: "Precio vendido promedio — averageSoldPrice",
  minimumSoldPrice: "Precio vendido mínimo — minimumSoldPrice",
  maximumSoldPrice: "Precio vendido máximo — maximumSoldPrice",
  activeListingCount: "Listings activos — activeListingCount",
}

const emptyMetrics = (): Record<MetricKey, MetricDraft> => ({
  totalSold: { originalLabel: "Total sold", rawValue: "", currency: "" },
  sellThroughRate: { originalLabel: "Sell-through rate", rawValue: "", currency: "" },
  averageSoldPrice: { originalLabel: "Average sold price", rawValue: "", currency: "USD" },
  minimumSoldPrice: { originalLabel: "Minimum sold price", rawValue: "", currency: "USD" },
  maximumSoldPrice: { originalLabel: "Maximum sold price", rawValue: "", currency: "USD" },
  activeListingCount: { originalLabel: "Active listings", rawValue: "", currency: "" },
})

const emptySessionDraft = (): SessionDraft => ({
  researcher: "",
  marketplace: "EBAY_US",
  sourceType: "EBAY_PRODUCT_RESEARCH_MANUAL",
  query: "",
  researchPeriodDays: "90",
  conditionFilter: "",
  buyingFormatFilter: "",
  categoryFilter: "",
  priceFilter: "",
  itemLocationFilter: "",
  sourceReference: "",
  rawVisibleResearchText: "",
  humanNotes: "",
  manuallyReadConfirmed: false,
  sellOneLikeThisNotUsedConfirmed: false,
  generalComparisonOnlyConfirmed: false,
  metrics: emptyMetrics(),
  shippingIncludedInMetric: "UNKNOWN",
})

const emptyComparableDraft = (comparableId = ""): ComparableDraft => ({
  comparableId,
  researchSessionId: "",
  sourceType: "EBAY_PRODUCT_RESEARCH_MANUAL",
  ebayItemId: "",
  listingUrl: "",
  title: "",
  listingState: "UNKNOWN",
  price: "",
  currency: "USD",
  shippingPrice: "",
  condition: "",
  category: "",
  soldDate: "",
  observedAttributes: "",
  differencesFromSupplierProduct: "",
  humanDecision: "NEEDS_MORE_EVIDENCE",
  humanReason: "",
})

function nextComparableId(comparables: ProductCaseGeneralComparable[]) {
  const used = new Set(comparables.map((entry) => entry.comparableId))
  let index = 1
  while (used.has(`general-comparable-${String(index).padStart(3, "0")}`)) index += 1
  return `general-comparable-${String(index).padStart(3, "0")}`
}

function sessionDraftFrom(session: ProductCaseGeneralMarketResearchSession): SessionDraft {
  const raw = session.rawHumanInput
  const metric = (key: MetricKey): MetricDraft => ({
    originalLabel: raw.metrics[key].originalLabel,
    rawValue: raw.metrics[key].rawValue,
    currency: raw.metrics[key].currency,
  })
  return {
    researcher: raw.researcher,
    marketplace: "EBAY_US",
    sourceType: session.sourceType,
    query: raw.query,
    researchPeriodDays: String(session.researchPeriodDays) as SessionDraft["researchPeriodDays"],
    conditionFilter: raw.conditionFilter,
    buyingFormatFilter: raw.buyingFormatFilter,
    categoryFilter: raw.categoryFilter,
    priceFilter: raw.priceFilter,
    itemLocationFilter: raw.itemLocationFilter,
    sourceReference: raw.sourceReference,
    rawVisibleResearchText: raw.rawVisibleResearchText,
    humanNotes: raw.humanNotes,
    manuallyReadConfirmed: raw.manuallyReadConfirmed,
    sellOneLikeThisNotUsedConfirmed: raw.sellOneLikeThisNotUsedConfirmed,
    generalComparisonOnlyConfirmed: raw.generalComparisonOnlyConfirmed,
    metrics: {
      totalSold: metric("totalSold"),
      sellThroughRate: metric("sellThroughRate"),
      averageSoldPrice: metric("averageSoldPrice"),
      minimumSoldPrice: metric("minimumSoldPrice"),
      maximumSoldPrice: metric("maximumSoldPrice"),
      activeListingCount: metric("activeListingCount"),
    },
    shippingIncludedInMetric: String(raw.shippingIncludedInMetric).toUpperCase() as SessionDraft["shippingIncludedInMetric"],
  }
}

function comparableDraftFrom(comparable: ProductCaseGeneralComparable): ComparableDraft {
  const raw = comparable.rawHumanInput
  return {
    comparableId: comparable.comparableId,
    researchSessionId: comparable.researchSessionId,
    sourceType: comparable.sourceType,
    ebayItemId: raw.ebayItemId,
    listingUrl: raw.listingUrl,
    title: raw.title,
    listingState: comparable.listingState,
    price: raw.price,
    currency: raw.currency,
    shippingPrice: raw.shippingPrice,
    condition: raw.condition,
    category: raw.category,
    soldDate: raw.soldDate,
    observedAttributes: raw.observedAttributes,
    differencesFromSupplierProduct: raw.differencesFromSupplierProduct,
    humanDecision: comparable.humanDecision,
    humanReason: raw.humanReason,
  }
}

function focusElement(id: string) {
  window.requestAnimationFrame(() => {
    const target = document.getElementById(id)
    target?.scrollIntoView({ behavior: "smooth", block: "start" })
    target?.focus({ preventScroll: true })
  })
}

export function Phase5MarketEvidence({ document, onUpdated, onReturnToBlocker }: Props) {
  const research = document.marketEvidence.generalProductComparableResearch
  const [sessionDraft, setSessionDraft] = useState<SessionDraft>(emptySessionDraft)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [comparableDraft, setComparableDraft] = useState<ComparableDraft>(() => emptyComparableDraft(nextComparableId(research.comparables)))
  const [editingComparableId, setEditingComparableId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setSessionDraft(emptySessionDraft())
    setEditingSessionId(null)
    setComparableDraft(emptyComparableDraft(nextComparableId(research.comparables)))
    setEditingComparableId(null)
    setError("")
  }, [research])

  const phaseStatus = deriveGeneralComparableMarketPhaseStatus(document)
  const counters = useMemo(() => ({
    included: research.comparables.filter((entry) => entry.humanDecision === "INCLUDE_AS_GENERAL_COMPARABLE").length,
    excluded: research.comparables.filter((entry) => entry.humanDecision === "EXCLUDE_NOT_COMPARABLE").length,
    pending: research.comparables.filter((entry) => entry.humanDecision === "NEEDS_MORE_EVIDENCE" || entry.reviewRequiredAfterSessionChange).length,
  }), [research.comparables])

  const fail = (caught: unknown, fallback: string) => {
    setError(caught instanceof Error ? caught.message : fallback)
    focusElement("market-evidence-form-error")
  }

  async function saveSession() {
    setBusy(true)
    setError("")
    try {
      const result = await saveGeneralMarketResearchSession({
        document,
        replaceSessionId: editingSessionId ?? undefined,
        capturedAt: new Date().toISOString(),
        researcher: sessionDraft.researcher,
        marketplace: sessionDraft.marketplace,
        sourceType: sessionDraft.sourceType,
        query: sessionDraft.query,
        researchPeriodDays: Number(sessionDraft.researchPeriodDays) as 30 | 90 | 365,
        conditionFilter: sessionDraft.conditionFilter,
        buyingFormatFilter: sessionDraft.buyingFormatFilter,
        categoryFilter: sessionDraft.categoryFilter,
        priceFilter: sessionDraft.priceFilter,
        itemLocationFilter: sessionDraft.itemLocationFilter,
        sourceReference: sessionDraft.sourceReference,
        rawVisibleResearchText: sessionDraft.rawVisibleResearchText,
        humanNotes: sessionDraft.humanNotes,
        manuallyReadConfirmed: sessionDraft.manuallyReadConfirmed,
        sellOneLikeThisNotUsedConfirmed: sessionDraft.sellOneLikeThisNotUsedConfirmed,
        generalComparisonOnlyConfirmed: sessionDraft.generalComparisonOnlyConfirmed,
        metrics: {
          ...sessionDraft.metrics,
          shippingIncludedInMetric: sessionDraft.shippingIncludedInMetric === "TRUE"
            ? true
            : sessionDraft.shippingIncludedInMetric === "FALSE" ? false : "UNKNOWN",
        },
      })
      onUpdated(result.updatedDocument, editingSessionId
        ? "Sesión manual actualizada; sus comparables vinculados requieren revisión si cambió la búsqueda o los filtros."
        : "Sesión de Product Research guardada sólo en este navegador; no se llamó a eBay ni a otro servicio.")
    } catch (caught) {
      fail(caught, "GENERAL_MARKET_RESEARCH_SESSION_INVALID")
    } finally {
      setBusy(false)
    }
  }

  async function removeSession(sessionId: string) {
    setBusy(true)
    setError("")
    try {
      const updated = await deleteGeneralMarketResearchSession({ document, sessionId })
      onUpdated(updated, "Sesión y comparables vinculados eliminados localmente; resúmenes derivados quedaron invalidados.")
    } catch (caught) {
      fail(caught, "GENERAL_MARKET_RESEARCH_SESSION_DELETE_INVALID")
    } finally {
      setBusy(false)
    }
  }

  async function saveComparable() {
    setBusy(true)
    setError("")
    try {
      const result = await saveGeneralMarketComparable({
        document,
        replaceComparableId: editingComparableId ?? undefined,
        ...comparableDraft,
        price: comparableDraft.price,
        shippingPrice: comparableDraft.shippingPrice,
        observedAttributes: comparableDraft.observedAttributes,
        differencesFromSupplierProduct: comparableDraft.differencesFromSupplierProduct,
        exactMatchConfirmed: false,
        updatedAt: new Date().toISOString(),
      })
      onUpdated(result.updatedDocument, editingComparableId
        ? "Comparable general actualizado localmente; sigue sin afirmar identidad exacta."
        : "Comparable general guardado localmente; no se copiaron imágenes, descripciones ni claims.")
    } catch (caught) {
      fail(caught, "GENERAL_MARKET_COMPARABLE_INVALID")
    } finally {
      setBusy(false)
    }
  }

  async function removeComparable(comparableId: string) {
    setBusy(true)
    setError("")
    try {
      const updated = await deleteGeneralMarketComparable({ document, comparableId })
      onUpdated(updated, "Comparable eliminado localmente; resúmenes y decisiones derivadas quedaron invalidados.")
    } catch (caught) {
      fail(caught, "GENERAL_MARKET_COMPARABLE_DELETE_INVALID")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="PHASE_5_MARKET_EVIDENCE" className="mt-4 grid gap-4">
      <section
        id="MARKET_EVIDENCE_SUMMARY"
        aria-labelledby="market-evidence-summary-heading"
        className="rounded-2xl border border-emerald-200/20 bg-emerald-200/[0.035] p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-100/60">
              MARKET_EVIDENCE_SUMMARY
            </p>
            <h4 id="market-evidence-summary-heading" className="mt-1 font-black">
              {GENERAL_PRODUCT_COMPARABLE_MARKET_EVIDENCE_CONTRACT_VERSION}
            </h4>
          </div>
          <span className="rounded-full border border-amber-200/30 px-3 py-2 text-xs font-black text-amber-100">
            {phaseStatus}
          </span>
        </div>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-white/45">Sesiones</dt><dd className="mt-1 font-black">{research.sessions.length}</dd></div>
          <div><dt className="text-white/45">Incluidos</dt><dd className="mt-1 font-black">{counters.included}</dd></div>
          <div><dt className="text-white/45">Excluidos</dt><dd className="mt-1 font-black">{counters.excluded}</dd></div>
          <div><dt className="text-white/45">Pendientes</dt><dd className="mt-1 font-black">{counters.pending}</dd></div>
        </dl>
        <p className="mt-3 text-xs leading-5 text-white/55">
          Regla {research.sufficiencyRuleVersion}: se requieren al menos {research.minimumIncludedComparables} comparables generales incluidos para triangulación mínima. Si eBay muestra menos, conserva NEEDS_MORE_EVIDENCE y documenta el motivo; nunca inventes resultados.
        </p>
        <dl className="mt-3 grid gap-2 rounded-xl border border-white/10 p-3 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-white/45">productIdentity</dt><dd className="font-mono">PARTIAL</dd></div>
          <div><dt className="text-white/45">identityConfidence</dt><dd className="font-mono">LOW</dd></div>
          <div><dt className="text-white/45">identityBasis</dt><dd className="font-mono">SUPPLIER_CATALOG_OFFER</dd></div>
          <div><dt className="text-white/45">supplierCatalogCompleteness</dt><dd className="font-mono">EXHAUSTED_BY_HUMAN_ATTESTATION</dd></div>
          <div><dt className="text-white/45">researchEligibility</dt><dd className="font-mono">ALLOWED_WITH_LIMITATIONS</dd></div>
          <div><dt className="text-white/45">comparisonMode</dt><dd className="font-mono">GENERAL_PRODUCT_COMPARABLES_ONLY</dd></div>
          <div><dt className="text-white/45">exactMarketplaceMatchAllowed</dt><dd className="font-mono">false</dd></div>
          <div><dt className="text-white/45">canTreatComparableAsSameProduct</dt><dd className="font-mono">false</dd></div>
          <div><dt className="text-white/45">strategy</dt><dd className="font-mono">HOLD_IDENTITY</dd></div>
          <div><dt className="text-white/45">productType confirmado</dt><dd className="font-mono">{document.identityReview.humanReview?.productType ?? "MISSING"}</dd></div>
          <div><dt className="text-white/45">packQuantity confirmado</dt><dd className="font-mono">{document.identityReview.humanReview?.packQuantity ?? "MISSING"}</dd></div>
        </dl>
        <p className="mt-3 rounded-xl border border-amber-200/20 p-3 text-xs font-black text-amber-50">
          Browser-only · external requests:0 · mutating requests:0 · machine vision:0 · Sell One Like This:0 · drafts/listings creados:0
        </p>
      </section>

      <section
        id="MARKET_EVIDENCE_BLOCKERS"
        aria-labelledby="market-evidence-blockers-heading"
        className="rounded-2xl border border-rose-200/20 bg-rose-200/[0.035] p-4"
      >
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-100/60">
          MARKET_EVIDENCE_BLOCKERS
        </p>
        <h4 id="market-evidence-blockers-heading" className="mt-1 font-black">
          Separación de bloqueos
        </h4>
        <div className="mt-3 grid gap-3 text-xs lg:grid-cols-2">
          <div className="rounded-xl border border-emerald-200/20 p-3">
            <p className="font-black text-emerald-100">Para investigación</p>
            <p className="mt-2 font-mono">NONE — CAPTURE_GENERAL_PRODUCT_COMPARABLE_MARKET_EVIDENCE</p>
          </div>
          <div className="rounded-xl border border-rose-200/20 p-3">
            <p className="font-black text-rose-100">Para estrategia y publicación</p>
            <p className="mt-2 font-mono">EXACT_IDENTITY_REQUIRED · REAL_COSTS_REQUIRED · BRAND_IP_REVIEW_REQUIRED · PACKAGE_AND_HANDOFF_BLOCKED</p>
          </div>
        </div>
        <button type="button" onClick={onReturnToBlocker} className={`${buttonClass} mt-3 border-rose-200/25`}>
          Volver al bloqueo
        </button>
      </section>

      {error && (
        <p
          id="market-evidence-form-error"
          role="alert"
          tabIndex={-1}
          className="scroll-mt-28 rounded-xl border border-rose-200/30 bg-rose-200/[0.08] p-3 font-mono text-xs text-rose-50 outline-none"
        >
          {error}
        </p>
      )}

      <section
        id="MARKET_RESEARCH_SESSION_FORM"
        aria-labelledby="market-research-session-form-heading"
        className="scroll-mt-28 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.035] p-4"
      >
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100/60">MARKET_RESEARCH_SESSION_FORM</p>
        <h4 id="market-research-session-form-heading" tabIndex={-1} className="mt-1 scroll-mt-28 font-black outline-none">
          {editingSessionId ? "Editar sesión manual" : "Nueva sesión manual de investigación"}
        </h4>
        <p className="mt-2 text-xs leading-5 text-white/55">
          Introduce sólo datos que hayas leído visiblemente en eBay. No pegues HTML completo, cookies, tokens, credenciales, pagos ni datos personales. Los campos métricos vacíos se guardan como MISSING, nunca como cero.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-black">
            Investigador — researcher · requerido
            <input className={inputClass} value={sessionDraft.researcher} onChange={(event) => setSessionDraft((current) => ({ ...current, researcher: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-xs font-black">
            Marketplace
            <select className={inputClass} value={sessionDraft.marketplace} disabled><option value="EBAY_US">EBAY_US</option></select>
          </label>
          <label className="grid gap-1 text-xs font-black">
            Tipo de fuente — sourceType
            <select className={inputClass} value={sessionDraft.sourceType} onChange={(event) => setSessionDraft((current) => ({ ...current, sourceType: event.target.value as ProductCaseManualMarketSourceType }))}>
              <option value="EBAY_PRODUCT_RESEARCH_MANUAL">EBAY_PRODUCT_RESEARCH_MANUAL</option>
              <option value="EBAY_ACTIVE_LISTING_MANUAL">EBAY_ACTIVE_LISTING_MANUAL</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-black">
            Periodo — researchPeriodDays
            <select className={inputClass} value={sessionDraft.researchPeriodDays} onChange={(event) => setSessionDraft((current) => ({ ...current, researchPeriodDays: event.target.value as SessionDraft["researchPeriodDays"] }))}>
              <option value="30">30 días</option><option value="90">90 días</option><option value="365">365 días</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-black sm:col-span-2">
            Consulta — query · requerida
            <input className={inputClass} value={sessionDraft.query} onChange={(event) => setSessionDraft((current) => ({ ...current, query: event.target.value }))} />
          </label>
          {([
            ["conditionFilter", "Condición — conditionFilter"],
            ["buyingFormatFilter", "Formato de compra — buyingFormatFilter"],
            ["categoryFilter", "Categoría — categoryFilter"],
            ["priceFilter", "Precio — priceFilter"],
            ["itemLocationFilter", "Ubicación — itemLocationFilter"],
          ] as const).map(([field, label]) => (
            <label key={field} className="grid gap-1 text-xs font-black">
              {label}
              <input className={inputClass} value={sessionDraft[field]} onChange={(event) => setSessionDraft((current) => ({ ...current, [field]: event.target.value }))} />
            </label>
          ))}
          <label className="grid gap-1 text-xs font-black sm:col-span-2">
            Referencia o URL HTTPS opcional — sourceReference
            <input className={inputClass} value={sessionDraft.sourceReference} onChange={(event) => setSessionDraft((current) => ({ ...current, sourceReference: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-xs font-black sm:col-span-2">
            Texto visible sin transformar — rawVisibleResearchText · opcional
            <textarea className={areaClass} value={sessionDraft.rawVisibleResearchText} onChange={(event) => setSessionDraft((current) => ({ ...current, rawVisibleResearchText: event.target.value }))} />
          </label>
          <label className="grid gap-1 text-xs font-black sm:col-span-2">
            Notas humanas — humanNotes
            <textarea className={areaClass} value={sessionDraft.humanNotes} onChange={(event) => setSessionDraft((current) => ({ ...current, humanNotes: event.target.value }))} />
          </label>
        </div>

        <fieldset className="mt-4 rounded-xl border border-white/10 p-3">
          <legend className="px-2 text-xs font-black">Métricas visibles de Product Research</legend>
          <div className="grid gap-3 lg:grid-cols-2">
            {(Object.keys(metricLabels) as MetricKey[]).map((key) => (
              <div key={key} className="rounded-xl border border-white/10 p-3">
                <p className="text-xs font-black">{metricLabels[key]}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_7rem]">
                  <label className="grid gap-1 text-[10px] font-black">Etiqueta original<input className={inputClass} value={sessionDraft.metrics[key].originalLabel} onChange={(event) => setSessionDraft((current) => ({ ...current, metrics: { ...current.metrics, [key]: { ...current.metrics[key], originalLabel: event.target.value } } }))} /></label>
                  <label className="grid gap-1 text-[10px] font-black">rawValue · vacío = MISSING<input className={inputClass} inputMode="decimal" value={sessionDraft.metrics[key].rawValue} onChange={(event) => setSessionDraft((current) => ({ ...current, metrics: { ...current.metrics, [key]: { ...current.metrics[key], rawValue: event.target.value } } }))} /></label>
                  <label className="grid gap-1 text-[10px] font-black">Moneda<input className={inputClass} value={sessionDraft.metrics[key].currency} onChange={(event) => setSessionDraft((current) => ({ ...current, metrics: { ...current.metrics, [key]: { ...current.metrics[key], currency: event.target.value } } }))} /></label>
                </div>
              </div>
            ))}
          </div>
          <label className="mt-3 grid gap-1 text-xs font-black">
            ¿La métrica incluye envío? — shippingIncludedInMetric
            <select className={inputClass} value={sessionDraft.shippingIncludedInMetric} onChange={(event) => setSessionDraft((current) => ({ ...current, shippingIncludedInMetric: event.target.value as SessionDraft["shippingIncludedInMetric"] }))}>
              <option value="UNKNOWN">UNKNOWN</option><option value="TRUE">true</option><option value="FALSE">false</option>
            </select>
          </label>
        </fieldset>

        <fieldset className="mt-4 grid gap-2 rounded-xl border border-white/10 p-3">
          <legend className="px-2 text-xs font-black">Confirmaciones humanas obligatorias</legend>
          {([
            ["manuallyReadConfirmed", "Confirmo que leí manualmente los datos visibles."],
            ["sellOneLikeThisNotUsedConfirmed", "Confirmo que no usé Sell One Like This."],
            ["generalComparisonOnlyConfirmed", "Confirmo que los comparables no se trataron como identidad exacta."],
          ] as const).map(([field, label]) => (
            <label key={field} className="flex min-h-11 items-center gap-3 rounded-xl border border-white/10 p-3 text-xs font-black">
              <input type="checkbox" checked={sessionDraft[field]} onChange={(event) => setSessionDraft((current) => ({ ...current, [field]: event.target.checked }))} className="size-4" />{label}
            </label>
          ))}
        </fieldset>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void saveSession()} className={buttonClass}>
            {editingSessionId ? "Guardar edición de sesión" : "Guardar sesión manual"}
          </button>
          {editingSessionId && <button type="button" disabled={busy} onClick={() => { setEditingSessionId(null); setSessionDraft(emptySessionDraft()); focusElement("market-research-session-form-heading") }} className={buttonClass}>Cancelar edición</button>}
        </div>
      </section>

      <section id="MARKET_RESEARCH_SESSION_CARD" aria-labelledby="market-research-session-card-heading" className="grid gap-3">
        <h4 id="market-research-session-card-heading" className="font-black">MARKET_RESEARCH_SESSION_CARD · {research.sessions.length}</h4>
        {research.sessions.length === 0 && <p className="rounded-xl border border-white/10 p-3 text-xs text-white/55">No hay sesiones guardadas.</p>}
        {research.sessions.map((session) => (
          <article key={session.sessionId} className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-black">{session.query}</p><p className="mt-1 break-all font-mono text-[10px] text-white/55">{session.sessionId} · {session.contentHash}</p></div><span className="rounded-full border border-white/15 px-3 py-1 text-[10px] font-black">{session.sourceType}</span></div>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-white/45">Researcher</dt><dd>{session.researcher}</dd></div><div><dt className="text-white/45">Periodo</dt><dd>{session.researchPeriodDays} días</dd></div><div><dt className="text-white/45">Captured</dt><dd>{session.capturedAt}</dd></div><div><dt className="text-white/45">Referencia</dt><dd className="break-all">{session.sourceReference ?? "MISSING"}</dd></div></dl>
            <dl className="mt-3 grid gap-2 rounded-xl border border-white/10 p-3 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
              <div><dt className="text-white/45">conditionFilter</dt><dd>{session.conditionFilter ?? "MISSING"}</dd></div>
              <div><dt className="text-white/45">buyingFormatFilter</dt><dd>{session.buyingFormatFilter ?? "MISSING"}</dd></div>
              <div><dt className="text-white/45">categoryFilter</dt><dd>{session.categoryFilter ?? "MISSING"}</dd></div>
              <div><dt className="text-white/45">priceFilter</dt><dd>{session.priceFilter ?? "MISSING"}</dd></div>
              <div><dt className="text-white/45">itemLocationFilter</dt><dd>{session.itemLocationFilter ?? "MISSING"}</dd></div>
              <div><dt className="text-white/45">shippingIncludedInMetric</dt><dd>{String(session.metrics.shippingIncludedInMetric)}</dd></div>
            </dl>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(metricLabels) as MetricKey[]).map((key) => {
                const metric = session.metrics[key]
                return (
                  <dl key={key} className="rounded-xl border border-white/10 p-3 text-[11px]">
                    <div><dt className="text-white/45">{metric.originalLabel}</dt><dd className="mt-1 font-black">{metric.status}</dd></div>
                    <div className="mt-2"><dt className="text-white/45">rawValue</dt><dd className="whitespace-pre-wrap font-mono">{metric.rawValue || "(vacío)"}</dd></div>
                    <div className="mt-2"><dt className="text-white/45">normalized · currency</dt><dd>{metric.normalizedValue ?? "MISSING"} · {metric.currency ?? "MISSING"}</dd></div>
                    <div className="mt-2"><dt className="text-white/45">Procedencia</dt><dd className="font-mono">{metric.provenance}</dd></div>
                  </dl>
                )
              })}
            </div>
            <p className="mt-3 whitespace-pre-wrap rounded-xl border border-white/10 p-3 text-xs text-white/60">{session.rawVisibleResearchText || "rawVisibleResearchText: MISSING"}</p>
            <p className="mt-2 text-xs text-white/60">{session.humanNotes || "humanNotes: MISSING"}</p>
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" aria-label={`Editar sesión ${session.sessionId}`} disabled={busy} className={buttonClass} onClick={() => { setEditingSessionId(session.sessionId); setSessionDraft(sessionDraftFrom(session)); focusElement("market-research-session-form-heading") }}>Editar</button><button type="button" aria-label={`Eliminar sesión ${session.sessionId}`} disabled={busy} className={`${buttonClass} border-rose-200/25`} onClick={() => void removeSession(session.sessionId)}>Eliminar</button></div>
          </article>
        ))}
      </section>

      <section id="GENERAL_COMPARABLE_FORM" aria-labelledby="general-comparable-form-heading" className="scroll-mt-28 rounded-2xl border border-violet-200/20 bg-violet-200/[0.035] p-4">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-100/60">GENERAL_COMPARABLE_FORM</p>
        <h4 id="general-comparable-form-heading" tabIndex={-1} className="mt-1 scroll-mt-28 font-black outline-none">{editingComparableId ? "Editar comparable general" : "Agregar comparable general"}</h4>
        <p className="mt-2 text-xs leading-5 text-white/55">El título se conserva sólo como evidencia de mercado. No se convierte en título eBay ni sobrescribe hechos, precios, stock o especificaciones de Luna.</p>
        <fieldset disabled={research.sessions.length === 0 || busy} className="mt-4 grid gap-3 sm:grid-cols-2 disabled:opacity-50">
          <label className="grid gap-1 text-xs font-black">ID estable — comparableId<input className={inputClass} disabled={Boolean(editingComparableId)} value={comparableDraft.comparableId} onChange={(event) => setComparableDraft((current) => ({ ...current, comparableId: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-black">Sesión vinculada — researchSessionId<select className={inputClass} value={comparableDraft.researchSessionId} onChange={(event) => { const session = research.sessions.find((entry) => entry.sessionId === event.target.value); setComparableDraft((current) => ({ ...current, researchSessionId: event.target.value, sourceType: session?.sourceType ?? current.sourceType })) }}><option value="">Seleccionar…</option>{research.sessions.map((session) => <option key={session.sessionId} value={session.sessionId}>{session.query} · {session.sessionId}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-black">sourceType<select className={inputClass} value={comparableDraft.sourceType} disabled><option value="EBAY_PRODUCT_RESEARCH_MANUAL">EBAY_PRODUCT_RESEARCH_MANUAL</option><option value="EBAY_ACTIVE_LISTING_MANUAL">EBAY_ACTIVE_LISTING_MANUAL</option></select></label>
          <label className="grid gap-1 text-xs font-black">eBay Item ID · opcional<input className={inputClass} value={comparableDraft.ebayItemId} onChange={(event) => setComparableDraft((current) => ({ ...current, ebayItemId: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-black sm:col-span-2">URL HTTPS · opcional<input className={inputClass} value={comparableDraft.listingUrl} onChange={(event) => setComparableDraft((current) => ({ ...current, listingUrl: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-black sm:col-span-2">Título visible — title<input className={inputClass} value={comparableDraft.title} onChange={(event) => setComparableDraft((current) => ({ ...current, title: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-black">Estado — listingState<select className={inputClass} value={comparableDraft.listingState} onChange={(event) => setComparableDraft((current) => ({ ...current, listingState: event.target.value as ComparableDraft["listingState"] }))}><option value="SOLD">SOLD</option><option value="ACTIVE">ACTIVE</option><option value="UNKNOWN">UNKNOWN</option></select></label>
          <label className="grid gap-1 text-xs font-black">Precio — price<input className={inputClass} inputMode="decimal" value={comparableDraft.price} onChange={(event) => setComparableDraft((current) => ({ ...current, price: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-black">Moneda — currency<input className={inputClass} value={comparableDraft.currency} onChange={(event) => setComparableDraft((current) => ({ ...current, currency: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-black">Envío — vacío = MISSING<input className={inputClass} inputMode="decimal" value={comparableDraft.shippingPrice} onChange={(event) => setComparableDraft((current) => ({ ...current, shippingPrice: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-black">Condición<input className={inputClass} value={comparableDraft.condition} onChange={(event) => setComparableDraft((current) => ({ ...current, condition: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-black">Categoría<input className={inputClass} value={comparableDraft.category} onChange={(event) => setComparableDraft((current) => ({ ...current, category: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-black">Fecha vendido · opcional<input type="date" className={inputClass} value={comparableDraft.soldDate} onChange={(event) => setComparableDraft((current) => ({ ...current, soldDate: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-black">Decisión humana<select className={inputClass} value={comparableDraft.humanDecision} onChange={(event) => setComparableDraft((current) => ({ ...current, humanDecision: event.target.value as ComparableDraft["humanDecision"] }))}><option value="INCLUDE_AS_GENERAL_COMPARABLE">INCLUDE_AS_GENERAL_COMPARABLE</option><option value="EXCLUDE_NOT_COMPARABLE">EXCLUDE_NOT_COMPARABLE</option><option value="NEEDS_MORE_EVIDENCE">NEEDS_MORE_EVIDENCE</option></select></label>
          <label className="grid gap-1 text-xs font-black sm:col-span-2">Atributos observados · uno por línea<textarea className={areaClass} value={comparableDraft.observedAttributes} onChange={(event) => setComparableDraft((current) => ({ ...current, observedAttributes: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-black sm:col-span-2">Diferencias con producto del proveedor · una por línea<textarea className={areaClass} value={comparableDraft.differencesFromSupplierProduct} onChange={(event) => setComparableDraft((current) => ({ ...current, differencesFromSupplierProduct: event.target.value }))} /></label>
          <label className="grid gap-1 text-xs font-black sm:col-span-2">Motivo humano — humanReason · requerido<textarea className={areaClass} value={comparableDraft.humanReason} onChange={(event) => setComparableDraft((current) => ({ ...current, humanReason: event.target.value }))} /></label>
          <p className="rounded-xl border border-amber-200/20 p-3 text-xs font-black sm:col-span-2">exactMatchConfirmed: false · inmutable · GENERAL_PRODUCT_COMPARABLE, nunca EXACT_PRODUCT_MATCH.</p>
        </fieldset>
        {research.sessions.length === 0 && <p className="mt-3 text-xs font-black text-amber-100">Guarda primero una sesión manual válida.</p>}
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy || research.sessions.length === 0} onClick={() => void saveComparable()} className={buttonClass}>{editingComparableId ? "Guardar edición del comparable" : "Guardar comparable general"}</button>{editingComparableId && <button type="button" disabled={busy} onClick={() => { setEditingComparableId(null); setComparableDraft(emptyComparableDraft(nextComparableId(research.comparables))); focusElement("general-comparable-form-heading") }} className={buttonClass}>Cancelar edición</button>}</div>
      </section>

      <section id="GENERAL_COMPARABLE_CARD" aria-labelledby="general-comparable-card-heading" className="grid gap-3">
        <h4 id="general-comparable-card-heading" className="font-black">GENERAL_COMPARABLE_CARD · {research.comparables.length}</h4>
        {research.comparables.length === 0 && <p className="rounded-xl border border-white/10 p-3 text-xs text-white/55">No hay comparables guardados.</p>}
        {research.comparables.map((comparable) => (
          <article key={comparable.comparableId} className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-black">{comparable.title}</p><p className="mt-1 break-all font-mono text-[10px] text-white/55">{comparable.comparableId} · {comparable.evidenceId} · {comparable.contentHash}</p></div><div className="flex flex-wrap gap-2"><span className="rounded-full border border-cyan-200/25 px-3 py-1 text-[10px] font-black">GENERAL_PRODUCT_COMPARABLE</span><span className="rounded-full border border-violet-200/25 px-3 py-1 text-[10px] font-black">{comparable.humanDecision}</span></div></div>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-white/45">sourceType</dt><dd>{comparable.sourceType}</dd></div><div><dt className="text-white/45">Estado</dt><dd>{comparable.listingState}</dd></div><div><dt className="text-white/45">Precio</dt><dd>{comparable.price} {comparable.currency}</dd></div><div><dt className="text-white/45">Envío</dt><dd>{comparable.shippingPrice.status === "MISSING" ? "MISSING" : `${comparable.shippingPrice.normalizedValue} ${comparable.currency}`}</dd></div><div><dt className="text-white/45">eBay Item ID</dt><dd>{comparable.ebayItemId ?? "MISSING"}</dd></div><div><dt className="text-white/45">Condición</dt><dd>{comparable.condition || "MISSING"}</dd></div><div><dt className="text-white/45">Categoría</dt><dd>{comparable.category || "MISSING"}</dd></div><div><dt className="text-white/45">Sold date</dt><dd>{comparable.soldDate ?? "MISSING"}</dd></div><div><dt className="text-white/45">Exact match</dt><dd>false</dd></div><div><dt className="text-white/45">Created</dt><dd>{comparable.createdAt}</dd></div><div><dt className="text-white/45">Updated</dt><dd>{comparable.updatedAt}</dd></div><div><dt className="text-white/45">Listing URL</dt><dd className="break-all">{comparable.listingUrl ?? "MISSING"}</dd></div></dl>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div className="rounded-xl border border-white/10 p-3"><p className="font-black">Atributos observados</p><p className="mt-2 whitespace-pre-wrap text-white/60">{comparable.observedAttributes.join("\n") || "MISSING"}</p></div><div className="rounded-xl border border-white/10 p-3"><p className="font-black">Diferencias con Luna</p><p className="mt-2 whitespace-pre-wrap text-white/60">{comparable.differencesFromSupplierProduct.join("\n") || "MISSING"}</p></div></div>
            {comparable.reviewRequiredAfterSessionChange && <p className="mt-3 rounded-xl border border-amber-200/25 p-3 text-xs font-black text-amber-100">La sesión vinculada cambió; vuelve a revisar este comparable.</p>}
            <p className="mt-3 text-xs leading-5 text-white/60">{comparable.humanReason}</p>
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" aria-label={`Editar comparable ${comparable.comparableId}`} disabled={busy} className={buttonClass} onClick={() => { setEditingComparableId(comparable.comparableId); setComparableDraft(comparableDraftFrom(comparable)); focusElement("general-comparable-form-heading") }}>Editar</button><button type="button" aria-label={`Eliminar comparable ${comparable.comparableId}`} disabled={busy} className={`${buttonClass} border-rose-200/25`} onClick={() => void removeComparable(comparable.comparableId)}>Eliminar</button></div>
          </article>
        ))}
      </section>
    </div>
  )
}
