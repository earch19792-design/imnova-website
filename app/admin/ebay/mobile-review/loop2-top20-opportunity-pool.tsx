"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"

type QueueItem = {
  id: string
  supplier_product_id: string
  supplier_variant_id: string
  supplier_sku: string
  discovery_strategy: "EBAY_FIRST" | "LUNA_FIRST"
  luna_match_status: string
  package_hash: string | null
  product_identity_fingerprint: string | null
  base_product_fingerprint: string | null
  offer_pack_fingerprint: string | null
  cohort: "READY_FOR_OPERATOR_APPROVAL" | "NEEDS_DATA" | "REJECTED"
  pool_rank: number | null
  rank: number | null
  ranking_score: number
  reason_codes: string[]
  evidence_snapshot: {
    product?: {
      name?: string | null
      lunaUrl?: string | null
      authorizedImageUrl?: string | null
      variant?: string | null
      capturedAt?: string | null
    }
    logistics?: {
      weight?: number | null
      weightUnit?: string | null
      dimensions?: { length?: number; width?: number; height?: number; unit?: string } | null
      supplierShippingCostStatus?: string
      supplierShippingReserveUsd?: number | null
    }
    evidence?: {
      activeExactCount?: number
      soldExactCount?: number
      estimatedDemandCount?: number
      confidence?: string
      scores?: { demandConfidence?: number; competitionPressure?: number }
    } | null
    economics?: {
      minimumSafePrice?: number | null
      targetPrice?: number | null
      estimatedProfit?: number | null
      roiPercent?: number | null
      netMarginPercent?: number | null
    } | null
    packStrategy?: {
      recommendedPack?: Pack | null
      alternativePack?: Pack | null
      matrix?: Pack[]
    } | null
    operatorConfirmationRequired?: boolean
    discovery?: {
      origin?: "EBAY_FIRST" | "LUNA_FIRST"
      lunaMatchStatus?: string
      ebayFirstEvidence?: {
        demandEvidence?: string
        demandConfidence?: number
        activeListingCount?: number | null
        sellerCount?: number | null
        observedAt?: string | null
      } | null
    }
  }
  operator_action: "APPROVED" | "DISCARDED" | null
  supplier_price_observed: number | null
  supplier_availability_confirmation: string | null
  supplier_unit_quantity: number | null
  stock_confidence: string | null
  recommended_pack_count: number | null
  available_offer_pack_capacity: number | null
  ebay_listing_quantity: number | null
  supplier_shipping_cost_status: string
  supplier_shipping_reserve_usd: number | null
  supplier_confirmed_at: string | null
  analyzed_at: string
}

type Pack = {
  packCount?: number
  totalUnitCount?: number | null
  medianLandedPrice?: number | null
  medianPricePerUnit?: number | null
  decision?: string
  evidenceConfidence?: string
  operationalRisk?: string[]
  economics?: {
    targetPrice?: number | null
    sellerProfit?: number | null
    roiPercent?: number | null
    netMarginPercent?: number | null
  }
}

type QueuePayload = {
  success?: boolean
  error?: string
  run?: {
    status: string
    automation_status?: string
    dispatch_status?: string
    phase?: string
    catalog_total: number
    catalog_examined: number
    candidates_analyzed: number
    preselected_count?: number
    ready_count: number
    go_count?: number
    go_with_changes_count?: number
    no_go_count?: number
    needs_data_count: number
    rejected_count: number
    retry_count: number
    identity_enriched_count?: number
    identity_conflict_count?: number
    catalog_read_count?: number
    browse_read_count?: number
    coverage_before?: Record<string, number>
    coverage_after?: Record<string, number>
    source_coverage?: Record<string, number>
    ebay_first_status?: string
    ebay_first_category_count?: number
    ebay_first_signal_count?: number
    ebay_first_exact_luna_match_count?: number
    ebay_first_match_counts?: Record<string, number>
    ebay_first_observed_at?: string | null
    exact_match_count?: number
    excluded_internal_count?: number
    current_batch?: number
    continuation_attempt_count?: number
    dispatch_attempt_count?: number
    dispatch_recovery_count?: number
    progress_percent?: number
    last_activity_at?: string | null
    last_checkpoint_at?: string | null
    next_continuation_at?: string | null
    last_error_code?: string | null
    error_recoverable?: boolean
    dispatch_diagnostic?: {
      errorClass?: string | null
      httpStatus?: number | null
      elapsedMs?: number | null
      observedAt?: string | null
      hostFingerprint?: string | null
      bypassConfigured?: boolean
      protectionCookiePresent?: boolean
      xVercelId?: string | null
      queueMessageFingerprint?: string | null
    }
    priority_counts?: Record<string, number>
    diagnostic_counts?: Record<string, number>
  } | null
  pool?: QueueItem[]
  ready?: QueueItem[]
  internalCounts?: {
    needsData: number
    rejected: number
    stale: number
    reanalysisRequired: number
  }
}

type ConfirmationDraft = {
  priceObserved: string
  availability: "EXACT_QUANTITY_VISIBLE" | "AVAILABLE_QUANTITY_NOT_SHOWN" | "OUT_OF_STOCK"
  exactQuantity: string
}

function money(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "N/D"
}

function percent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "N/D"
}

function availabilityLabel(value: ConfirmationDraft["availability"]) {
  if (value === "EXACT_QUANTITY_VISIBLE") return "Cantidad exacta visible"
  if (value === "AVAILABLE_QUANTITY_NOT_SHOWN") return "Disponible, cantidad no visible"
  return "Agotado"
}

function reason(code: string) {
  const labels: Record<string, string> = {
    AUTHORIZED_IMAGE_PROVENANCE_REQUIRED: "Falta confirmar automáticamente la autorización de la imagen Luna.",
    PACKAGE_DIMENSIONS_REQUIRED: "Luna no entregó dimensiones estructuradas.",
    PACKAGE_WEIGHT_REQUIRED: "Luna no entregó peso estructurado.",
    STRONG_PRODUCT_IDENTIFIER_REQUIRED: "Falta GTIN válido o Brand + MPN/model verificable.",
    EXACT_CONTENTS_REQUIRED: "Falta el contenido exacto estructurado del paquete.",
    PACK_COUNT_REQUIRED: "Falta el número exacto de unidades del pack.",
    EBAY_CATEGORY_REQUIRED: "Falta categoría eBay oficial.",
    REQUIRED_ASPECTS_REQUIRED: "Faltan item specifics requeridos.",
    APPROVED_KEYWORDS_REQUIRED: "Faltan keywords verificadas por evidencia.",
    PACKAGING_COST_REQUIRED: "Falta costo automático de empaque.",
    FIXED_FULFILLMENT_COST_REQUIRED: "Falta costo operativo fijo configurado.",
    OUTBOUND_SHIPPING_ESTIMATE_REQUIRED: "Falta estimación automática de envío al comprador.",
    LUNA_OUT_OF_STOCK: "Luna reporta el producto agotado.",
    LUNA_OUT_OF_STOCK_OBSERVATION: "Agotado: movido a observación; el siguiente candidato ocupa su lugar.",
    LOOP1_NO_GO: "Loop 1 determinó NO_GO.",
    PROFIT_BELOW_5_USD: "Beneficio menor a US$5.",
    ROI_BELOW_30_PERCENT: "ROI menor a 30%.",
    NET_MARGIN_BELOW_20_PERCENT: "Margen neto menor a 20%.",
    COMPLIANCE_BLOCKED: "Producto bloqueado por compliance.",
    TOP20_CONTINUATION_DISPATCH_FAILED: "La continuación automática está pausada; el checkpoint permanece guardado.",
  }
  return labels[code] ?? code.replaceAll("_", " ")
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error("AUTH_REQUIRED")
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? "TOP20_REQUEST_FAILED")
  return payload
}

function requestKey(action: string, id: string) {
  return `${action}:${id}:${crypto.randomUUID()}`
}

export function Loop2Top20OpportunityPool() {
  const [payload, setPayload] = useState<QueuePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState("")
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [drafts, setDrafts] = useState<Record<string, ConfirmationDraft>>({})
  const [evidenceId, setEvidenceId] = useState("")

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError("")
    try {
      setPayload(await adminFetch<QueuePayload>("/api/admin/ebay/listing-ai/approval-queue"))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "TOP20_STATUS_UNAVAILABLE")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  const scanActive = ["RUNNING", "PARTIAL_AUTO_CONTINUING"].includes(payload?.run?.status ?? "")
  useEffect(() => {
    if (!scanActive) return
    const timer = window.setInterval(() => void load(true), 2_500)
    return () => window.clearInterval(timer)
  }, [load, scanActive])

  const pool = payload?.pool ?? []
  const counts = useMemo(() => ({
    ready: payload?.ready?.length ?? 0,
    managedInternally: (payload?.internalCounts?.needsData ?? 0) +
      (payload?.internalCounts?.rejected ?? 0) +
      (payload?.internalCounts?.stale ?? 0) +
      (payload?.internalCounts?.reanalysisRequired ?? 0),
  }), [payload])

  const scan = async () => {
    setWorkingId("scan"); setError(""); setMessage("")
    try {
      await adminFetch("/api/admin/ebay/listing-ai/approval-queue", {
        method: "POST", body: JSON.stringify({ action: "scan" }),
      })
      await load()
      setMessage("Escaneo iniciado. Puedes cerrar esta página; Seller OS continuará automáticamente.")
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "TOP20_SCAN_FAILED")
    } finally {
      setWorkingId("")
    }
  }

  const updateDraft = (id: string, patch: Partial<ConfirmationDraft>) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] ?? {
        priceObserved: "", availability: "AVAILABLE_QUANTITY_NOT_SHOWN", exactQuantity: "",
      }), ...patch },
    }))
  }

  const confirmLuna = async (item: QueueItem) => {
    const draft = drafts[item.id] ?? { priceObserved: "", availability: "AVAILABLE_QUANTITY_NOT_SHOWN", exactQuantity: "" }
    setWorkingId(item.id); setError(""); setMessage("")
    try {
      await adminFetch(`/api/admin/ebay/listing-ai/approval-queue/${encodeURIComponent(item.id)}/confirm-luna`, {
        method: "POST",
        headers: { "Idempotency-Key": requestKey("confirm-luna", item.id) },
        body: JSON.stringify({
          priceObserved: Number(draft.priceObserved), availability: draft.availability,
          exactQuantity: draft.availability === "EXACT_QUANTITY_VISIBLE" ? Number(draft.exactQuantity) : null,
        }),
      })
      await load()
      setMessage(draft.availability === "OUT_OF_STOCK"
        ? "Producto movido a observación; el ranking promovió el siguiente candidato."
        : "Precio y disponibilidad confirmados; economía y ranking recalculados.")
    } catch (confirmationError) {
      setError(confirmationError instanceof Error ? confirmationError.message : "LUNA_CONFIRMATION_FAILED")
    } finally {
      setWorkingId("")
    }
  }

  const approve = async (item: QueueItem) => {
    if (!item.package_hash || !window.confirm("Aprobar este paquete y pack exactos para una única generación OpenAI posterior? No se llamará OpenAI ahora.")) return
    setWorkingId(item.id); setError(""); setMessage("")
    try {
      await adminFetch(`/api/admin/ebay/listing-ai/approval-queue/${encodeURIComponent(item.id)}/approve`, {
        method: "POST", headers: { "Idempotency-Key": requestKey("approve", item.id) },
        body: JSON.stringify({ packageHash: item.package_hash, confirmed: true }),
      })
      await load(); setMessage("Paquete fijado y aprobado para una única generación posterior. OpenAI calls: 0.")
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : "TOP20_APPROVAL_FAILED")
    } finally {
      setWorkingId("")
    }
  }

  const discard = async (item: QueueItem) => {
    setWorkingId(item.id); setError(""); setMessage("")
    try {
      await adminFetch(`/api/admin/ebay/listing-ai/approval-queue/${encodeURIComponent(item.id)}/discard`, {
        method: "POST", headers: { "Idempotency-Key": requestKey("discard", item.id) },
      })
      await load(); setMessage("Candidato descartado; el pool fue reordenado automáticamente.")
    } catch (discardError) {
      setError(discardError instanceof Error ? discardError.message : "TOP20_DISCARD_FAILED")
    } finally {
      setWorkingId("")
    }
  }

  return (
    <section aria-labelledby="top20-heading" className="space-y-4 rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.06] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-black uppercase tracking-widest text-cyan-100/65">Discovery → Loop 1 automático → Top 20</p><h3 id="top20-heading" className="text-lg font-black">Top 20 automatizado</h3></div>
        <button type="button" onClick={() => void scan()} disabled={workingId === "scan" || scanActive} className="min-h-11 rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-40">{workingId === "scan" ? "Iniciando…" : scanActive ? "Análisis en progreso" : "Analizar y actualizar oportunidades"}</button>
      </div>
      {loading ? <p role="status">Cargando pool…</p> : (
        <>
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Catálogo / examinados</dt><dd className="text-lg font-black">{payload?.run?.catalog_total ?? 0} / {payload?.run?.catalog_examined ?? 0}</dd></div>
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Preseleccionados</dt><dd className="text-lg font-black">{payload?.run?.preselected_count ?? 0}</dd></div>
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Procesados por Loop 1</dt><dd className="text-lg font-black">{payload?.run?.candidates_analyzed ?? 0}</dd></div>
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Top 20 READY</dt><dd className="text-lg font-black">{counts.ready}</dd></div>
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">GO</dt><dd className="text-lg font-black">{payload?.run?.go_count ?? 0}</dd></div>
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">GO_WITH_CHANGES</dt><dd className="text-lg font-black">{payload?.run?.go_with_changes_count ?? 0}</dd></div>
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">NO_GO internos</dt><dd className="text-lg font-black">{payload?.run?.no_go_count ?? 0}</dd></div>
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Excluidos internos</dt><dd className="text-lg font-black">{payload?.run?.excluded_internal_count ?? counts.managedInternally}</dd></div>
          </dl>
          <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
            <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-200 transition-[width]" style={{ width: `${payload?.run?.progress_percent ?? 0}%` }} /></div>
            <p>Estado de análisis: <strong>{payload?.run?.status ?? "NOT_STARTED"}</strong> · fase {payload?.run?.phase ?? "NOT_STARTED"} · progreso {payload?.run?.progress_percent ?? 0}% · lote {payload?.run?.current_batch ?? 0}</p>
            <p className="text-white/55">Último checkpoint: {payload?.run?.last_checkpoint_at ? new Date(payload.run.last_checkpoint_at).toLocaleString("es") : "N/D"} · última actividad: {payload?.run?.last_activity_at ? new Date(payload.run.last_activity_at).toLocaleString("es") : "N/D"}</p>
            <p className="text-white/55">Continuación: {payload?.run?.dispatch_status ?? "NOT_SCHEDULED"} · intentos {payload?.run?.dispatch_attempt_count ?? 0} · recuperaciones {payload?.run?.dispatch_recovery_count ?? 0} · próxima: {payload?.run?.next_continuation_at ? new Date(payload.run.next_continuation_at).toLocaleString("es") : "N/D"}</p>
            {scanActive && <p className="font-bold text-cyan-50">Puedes cerrar esta página. Seller OS continuará automáticamente.</p>}
            {payload?.run?.status === "PAUSED_RATE_LIMIT" && <p className="font-bold text-amber-100">Pausado por límite oficial de eBay. Reanuda cuando llegue la próxima continuación indicada.</p>}
            {payload?.run?.status === "PAUSED_DISPATCH_RECOVERABLE" && <p className="font-bold text-amber-100">El análisis está pausado y su progreso está guardado. Seller OS reanudará desde el último checkpoint al usar el mismo botón.</p>}
            {payload?.run?.dispatch_diagnostic?.errorClass && <p className="text-white/55">Diagnóstico de continuación: {payload.run.dispatch_diagnostic.errorClass} · HTTP {payload.run.dispatch_diagnostic.httpStatus ?? "N/D"} · {payload.run.dispatch_diagnostic.elapsedMs ?? 0} ms.</p>}
            {payload?.run?.last_error_code && <p className="text-rose-100">Error sanitizado: {reason(payload.run.last_error_code)}</p>}
          </div>
          {payload?.run && <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
            <p className="font-black">Cobertura automática por fuentes autorizadas</p>
            <p className="mt-1 text-white/65">Enriquecidos: {payload.run.identity_enriched_count ?? 0} · conflictos excluidos: {payload.run.identity_conflict_count ?? 0} · Browse: {payload.run.browse_read_count ?? 0} · Catalog: {payload.run.catalog_read_count ?? 0}</p>
            <p className="mt-1 text-white/65">eBay-first: {payload.run.ebay_first_status ?? "NOT_STARTED"} · categorías {payload.run.ebay_first_category_count ?? 0} · señales {payload.run.ebay_first_signal_count ?? 0} · coincidencias Luna exactas {payload.run.ebay_first_exact_luna_match_count ?? 0}</p>
            <p className="mt-1 text-white/55">Brand {payload.run.coverage_before?.brand ?? 0} → {payload.run.coverage_after?.brand ?? 0} · GTIN/MPN {payload.run.coverage_before?.gtinOrMpn ?? 0} → {payload.run.coverage_after?.gtinOrMpn ?? 0} · pack {payload.run.coverage_before?.pack ?? 0} → {payload.run.coverage_after?.pack ?? 0} · peso {payload.run.coverage_before?.weight ?? 0} → {payload.run.coverage_after?.weight ?? 0} · dimensiones {payload.run.coverage_before?.dimensions ?? 0} → {payload.run.coverage_after?.dimensions ?? 0}</p>
          </div>}
          {pool.length ? <div className="space-y-3">{pool.map((item) => {
            const product = item.evidence_snapshot.product ?? {}
            const economics = item.evidence_snapshot.economics
            const evidence = item.evidence_snapshot.evidence
            const pack = item.evidence_snapshot.packStrategy?.recommendedPack
            const alternative = item.evidence_snapshot.packStrategy?.alternativePack
            const draft = drafts[item.id] ?? { priceObserved: item.supplier_price_observed?.toString() ?? "", availability: "AVAILABLE_QUANTITY_NOT_SHOWN" as const, exactQuantity: "" }
            const ready = item.cohort === "READY_FOR_OPERATOR_APPROVAL"
            const confirmationReady = ready && Boolean(item.supplier_confirmed_at) && (item.available_offer_pack_capacity ?? 0) >= 1
            const exactQuantityMissing = draft.availability === "EXACT_QUANTITY_VISIBLE" &&
              (!draft.exactQuantity || Number(draft.exactQuantity) < 0 || !Number.isInteger(Number(draft.exactQuantity)))
            const confirmationBlockedReason = !draft.priceObserved
              ? "Ingresa el precio Luna observado."
              : exactQuantityMissing
                ? "Ingresa la cantidad exacta visible como número entero."
                : null
            return <article key={item.id} className="rounded-2xl border border-white/15 bg-black/20 p-3">
              <div className="flex gap-3">{product.authorizedImageUrl ? <img src={product.authorizedImageUrl} alt="Producto autorizado de Luna" className="h-20 w-20 rounded-xl bg-white object-contain" /> : <div className="grid h-20 w-20 place-items-center rounded-xl bg-black/30 text-xs text-white/40">Sin imagen autorizada</div>}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>#{item.pool_rank} · {product.name ?? "Producto Luna"}</strong><span className="rounded-full border border-white/20 px-2 py-1 text-[10px] font-black">{item.supplier_confirmed_at ? "READY_FOR_OPENAI_APPROVAL" : "LISTO PARA CONFIRMAR"}</span><span className="rounded-full border border-cyan-100/25 px-2 py-1 text-[10px] font-black">{item.discovery_strategy}</span></div><p className="mt-1 text-xs text-white/55">SKU {item.supplier_sku} · variante {item.supplier_variant_id} · match Luna {item.luna_match_status}</p><p className="text-xs text-white/55">Analizado {new Date(item.analyzed_at).toLocaleString("es")}</p></div></div>
              {ready && !item.supplier_confirmed_at && !item.operator_action && <div className="mt-3 space-y-3 rounded-xl border border-cyan-200/20 p-3">{product.lunaUrl && <a href={product.lunaUrl} target="_blank" rel="noreferrer" className="grid min-h-11 place-items-center rounded-xl border border-cyan-200/25 font-black">Abrir en Luna</a>}<p className="font-black">Confirmar precio y disponibilidad</p><label className="block text-xs">Precio Luna observado<input type="number" min="0" step="0.01" value={draft.priceObserved} onChange={(event) => updateDraft(item.id, { priceObserved: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-white/20 bg-black/30 px-3" /></label><fieldset className="space-y-2 text-xs"><legend className="font-bold">Disponibilidad</legend>{(["EXACT_QUANTITY_VISIBLE", "AVAILABLE_QUANTITY_NOT_SHOWN", "OUT_OF_STOCK"] as const).map((value) => <label key={value} className="flex min-h-9 items-center gap-2"><input type="radio" name={`availability-${item.id}`} checked={draft.availability === value} onChange={() => updateDraft(item.id, { availability: value })} />{availabilityLabel(value)}</label>)}</fieldset>{draft.availability === "EXACT_QUANTITY_VISIBLE" && <label className="block text-xs">Cantidad exacta visible<input type="number" min="0" step="1" value={draft.exactQuantity} onChange={(event) => updateDraft(item.id, { exactQuantity: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-white/20 bg-black/30 px-3" /></label>}<button type="button" disabled={Boolean(confirmationBlockedReason) || workingId === item.id} onClick={() => void confirmLuna(item)} className="min-h-11 w-full rounded-xl bg-cyan-100 font-black text-black disabled:opacity-40">Confirmar y recalcular</button>{confirmationBlockedReason && <p className="text-xs text-amber-100">{confirmationBlockedReason}</p>}<p className="text-xs text-white/55">Cantidad no visible: máximo 1 offer pack; se exige nueva comprobación después de una venta.</p></div>}
              {item.supplier_confirmed_at && <><p className="mt-3 text-xs text-emerald-100">Precio/disponibilidad confirmados · confianza {item.stock_confidence} · capacidad {item.available_offer_pack_capacity ?? 0} offer pack · cantidad eBay {item.ebay_listing_quantity ?? 0}.</p><dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5"><div><dt className="text-white/45">Pack / alternativo</dt><dd>{pack?.packCount ?? "N/D"} / {alternative?.packCount ?? "N/D"}</dd></div><div><dt className="text-white/45">Precio / unidad</dt><dd>{money(economics?.targetPrice)} / {money(pack?.medianPricePerUnit)}</dd></div><div><dt className="text-white/45">Beneficio</dt><dd>{money(economics?.estimatedProfit)}</dd></div><div><dt className="text-white/45">ROI / margen</dt><dd>{percent(economics?.roiPercent)} / {percent(economics?.netMarginPercent)}</dd></div><div><dt className="text-white/45">Demanda / competencia</dt><dd>{evidence?.scores?.demandConfidence?.toFixed(0) ?? "N/D"} / {evidence?.scores?.competitionPressure?.toFixed(0) ?? "N/D"}</dd></div></dl><p className="mt-2 text-xs text-white/60">Activos exactos: {evidence?.activeExactCount ?? "N/D"} · vendidos exactos: {evidence?.soldExactCount ?? "N/D"} · confianza: {evidence?.confidence ?? "N/D"}</p><div className="mt-3 grid gap-2 sm:grid-cols-3"><button type="button" disabled={!confirmationReady || item.operator_action === "APPROVED" || workingId === item.id} onClick={() => void approve(item)} className="min-h-12 rounded-xl bg-fuchsia-200 font-black text-black disabled:opacity-40">{item.operator_action === "APPROVED" ? "Aprobado para OpenAI" : "Aprobar para OpenAI"}</button><button type="button" disabled={!item.package_hash || workingId === item.id} onClick={() => void discard(item)} className="min-h-11 rounded-xl border border-rose-200/25 font-black text-rose-50 disabled:opacity-40">Rechazar</button><button type="button" onClick={() => setEvidenceId((value) => value === item.id ? "" : item.id)} className="min-h-11 rounded-xl border border-white/20 font-black">Ver evidencia</button></div>{!confirmationReady && <p className="mt-1 text-xs text-white/55">La economía recalculada no conserva todos los hard gates; no se puede aprobar para OpenAI.</p>}</>}
              {item.supplier_confirmed_at && evidenceId === item.id && <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/35 p-3 text-xs">{JSON.stringify({ identityFingerprint: item.product_identity_fingerprint, baseProductFingerprint: item.base_product_fingerprint, offerPackFingerprint: item.offer_pack_fingerprint, evidence: item.evidence_snapshot, reasons: item.reason_codes, canPublish: false, openAiCalls: 0, ebayWrites: 0 }, null, 2)}</pre>}
            </article>
          })}</div> : <p className="rounded-xl bg-black/20 p-3 text-sm text-white/65">Todavía no existen productos completamente analizados y listos. Seller OS continuará con otros candidatos; no necesitas investigar datos técnicos.</p>}
        </>
      )}
      {error && <p role="alert" className="rounded-xl border border-rose-200/30 p-3 text-sm text-rose-50">{reason(error)}</p>}
      {message && <p role="status" className="rounded-xl border border-emerald-200/25 p-3 text-sm text-emerald-50">{message}</p>}
      <p className="text-xs text-white/50">Un clic orquesta Discovery + Loop 1 + ranking · sólo precio y disponibilidad requieren confirmación humana · cron permanente OFF · OpenAI calls: 0 · eBay writes: 0.</p>
    </section>
  )
}
