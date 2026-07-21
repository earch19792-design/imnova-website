"use client"

import { useEffect, useRef, useState } from "react"

import { supabase } from "@/lib/supabase"

const EBAY_PRODUCT_RESEARCH_ORIGIN = "https://www.ebay.com"
const CAPTURE_MESSAGE = "IMNOVA_PRODUCT_RESEARCH_VISIBLE_CAPTURE_V1"
const RECEIVER_READY_MESSAGE = "IMNOVA_PRODUCT_RESEARCH_RECEIVER_READY_V1"
const CAPTURE_RESULT_MESSAGE = "IMNOVA_PRODUCT_RESEARCH_CAPTURE_RESULT_V1"
const RECEIVER_HEARTBEAT_MS = 1_000

type SafeResult = {
  captureAlreadyProcessed?: boolean
  captureQueryCorrected?: boolean
  navigationOnly?: boolean
  officialNoSoldResults?: boolean
  rowCount?: number
  validCount?: number
  importedCount?: number
  duplicateCount?: number
  rejectedCount?: number
  candidatesEnriched?: number
  matchCounts?: {
    exactLuna?: number
    differentPack?: number
    differentSize?: number
    differentVariant?: number
    ambiguous?: number
    noLunaMatch?: number
  }
  scan?: { status?: string }
  queryPlan?: {
    status?: string
    queryCount?: number
    capturedCount?: number
    pendingCount?: number
    nextQuery?: {
      ordinal?: number
      searchQuery?: string
      candidateCount?: number
    } | null
  } | null
}

function safeCode(value: unknown) {
  return typeof value === "string" && /^[A-Z0-9_:.-]+$/.test(value)
    ? value : "PRODUCT_RESEARCH_CAPTURE_FAILED"
}

function captureErrorMessage(code: string) {
  const messages: Record<string, string> = {
    PRODUCT_RESEARCH_QUERY_PLAN_NEXT_QUERY_REQUIRED:
      "La captura pertenece a otra búsqueda. Regresa a Seller OS y abre la consulta preparada para este producto.",
    PRODUCT_RESEARCH_QUERY_PLAN_NO_PENDING_TASK:
      "El plan ya no tiene una consulta pendiente. Actualiza Seller OS antes de volver a capturar.",
    PRODUCT_RESEARCH_CAPTURE_ADMIN_SESSION_REQUIRED:
      "Tu sesión de administrador venció. Inicia sesión nuevamente y repite la captura.",
  }
  return messages[code] ?? "Seller OS no pudo validar esta captura. Regresa al panel y vuelve a intentarlo."
}

export default function ProductResearchCaptureReceiverPage() {
  const [status, setStatus] = useState<"WAITING" | "IMPORTING" | "READY" | "ERROR">("WAITING")
  const [error, setError] = useState("")
  const [result, setResult] = useState<SafeResult | null>(null)
  const inFlightCaptureIds = useRef(new Set<string>())
  const completedCaptureResults = useRef(new Map<string, Record<string, unknown>>())

  useEffect(() => {
    const opener = window.opener
    if (!opener) {
      setStatus("ERROR")
      setError("PRODUCT_RESEARCH_CAPTURE_OPENER_REQUIRED")
      return
    }
    let active = true
    let readyTimer: number | null = null
    const announceReady = () => opener.postMessage({
      type: RECEIVER_READY_MESSAGE,
      reusableReceiver: true,
    }, EBAY_PRODUCT_RESEARCH_ORIGIN)
    const stopReadyHeartbeat = () => {
      if (readyTimer !== null) window.clearInterval(readyTimer)
      readyTimer = null
    }
    const startReadyHeartbeat = () => {
      if (!active || readyTimer !== null) return
      announceReady()
      readyTimer = window.setInterval(announceReady, RECEIVER_HEARTBEAT_MS)
    }
    const postCaptureResult = (message: Record<string, unknown>) => {
      opener.postMessage(message, EBAY_PRODUCT_RESEARCH_ORIGIN)
    }
    const cacheCaptureResult = (captureId: string, message: Record<string, unknown>) => {
      completedCaptureResults.current.set(captureId, message)
      // A same-day batch is bounded, but keep a small replay window so a lost
      // postMessage can be answered without repeating an import or network call.
      if (completedCaptureResults.current.size > 10) {
        const oldest = completedCaptureResults.current.keys().next().value
        if (typeof oldest === "string") completedCaptureResults.current.delete(oldest)
      }
    }
    startReadyHeartbeat()

    const receive = async (event: MessageEvent) => {
      if (!active || event.origin !== EBAY_PRODUCT_RESEARCH_ORIGIN || event.source !== opener) return
      const message = event.data && typeof event.data === "object"
        ? event.data as Record<string, unknown> : {}
      if (message.type !== CAPTURE_MESSAGE || !message.capture ||
        typeof message.capture !== "object") return
      const capture = message.capture as Record<string, unknown>
      const captureId = typeof capture.captureId === "string" ? capture.captureId : ""
      if (!/^[0-9a-f-]{36}$/i.test(captureId)) return
      const completed = completedCaptureResults.current.get(captureId)
      if (completed) {
        postCaptureResult(completed)
        return
      }
      if (inFlightCaptureIds.current.has(captureId)) return
      inFlightCaptureIds.current.add(captureId)
      stopReadyHeartbeat()
      setStatus("IMPORTING")
      setError("")
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error("PRODUCT_RESEARCH_CAPTURE_ADMIN_SESSION_REQUIRED")
        const response = await fetch("/api/admin/ebay/listing-ai/product-research-capture", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "Idempotency-Key": `product-research-capture:${captureId}`,
          },
          body: JSON.stringify({ action: "capture", capture }),
        })
        const payload = await response.json() as { success?: boolean; error?: string; result?: SafeResult }
        if (!response.ok || !payload.success || !payload.result) {
          throw new Error(safeCode(payload.error))
        }
        setResult(payload.result)
        setStatus("READY")
        const navigationCorrection = payload.result.navigationOnly === true &&
          payload.result.captureQueryCorrected === true
        const successMessage = { type: CAPTURE_RESULT_MESSAGE,
          success: true, captureId, importedCount: payload.result.importedCount ?? 0,
          validCount: payload.result.validCount ?? 0,
          duplicateCount: payload.result.duplicateCount ?? 0,
          rejectedCount: payload.result.rejectedCount ?? 0,
          navigationOnly: payload.result.navigationOnly === true,
          captureQueryCorrected: payload.result.captureQueryCorrected === true,
          exactLunaMatches: payload.result.matchCounts?.exactLuna ?? 0,
          // Only a stale/wrong table is corrected in place. A valid capture
          // returns control to Seller OS, which is the authority for the next
          // product in this exact five-candidate batch.
          nextQuery: navigationCorrection
            ? payload.result.queryPlan?.nextQuery?.searchQuery ?? null : null,
          nextQueryOrdinal: navigationCorrection
            ? payload.result.queryPlan?.nextQuery?.ordinal ?? null : null,
          queryCount: navigationCorrection
            ? payload.result.queryPlan?.queryCount ?? null : null,
          returnToSellerOs: !navigationCorrection }
        cacheCaptureResult(captureId, successMessage)
        postCaptureResult(successMessage)
        if (navigationCorrection && payload.result.queryPlan?.nextQuery) {
          window.setTimeout(() => opener.focus(), 250)
        }
      } catch (captureError) {
        const code = safeCode(captureError instanceof Error ? captureError.message : "")
        setStatus("ERROR")
        setError(code)
        const errorMessage = { type: CAPTURE_RESULT_MESSAGE,
          success: false, captureId, error: code }
        cacheCaptureResult(captureId, errorMessage)
        postCaptureResult(errorMessage)
      } finally {
        inFlightCaptureIds.current.delete(captureId)
        // The receiver stays open for the entire batch. Re-arm the handshake
        // after every capture so the same authenticated window can accept the
        // next captureId without navigation or another login.
        startReadyHeartbeat()
      }
    }
    window.addEventListener("message", receive)
    return () => {
      active = false
      stopReadyHeartbeat()
      window.removeEventListener("message", receive)
    }
  }, [])

  return <main className="min-h-screen bg-[#07111a] px-4 py-10 text-white">
    <section className="mx-auto max-w-xl rounded-3xl border border-white/15 bg-white/[0.05] p-6 shadow-2xl">
      <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-100">Seller OS · Loop 2</p>
      <h1 className="mt-3 text-2xl font-black">Recepción segura de Product Research</h1>
      <p className="mt-2 text-sm text-white/65">Esta ventana sólo acepta una tabla visible enviada desde la página oficial de Product Research. Nunca recibe cookies, contraseñas, HTML completo ni imágenes.</p>
      <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4">
        <p className="text-xs uppercase tracking-widest text-white/50">Estado</p>
        <p className="mt-2 text-lg font-black">{status === "WAITING" ? "Esperando captura oficial…" : status === "IMPORTING" ? "Validando e importando…" : status === "READY" ? result?.captureQueryCorrected ? "CONSULTA CORREGIDA" : result?.captureAlreadyProcessed ? "TABLA YA PROCESADA" : "CAPTURA COMPLETADA" : "CAPTURA RECHAZADA"}</p>
        {error && <div className="mt-3 rounded-xl border border-rose-300/25 bg-rose-400/10 p-3">
          <p className="text-sm font-semibold text-rose-50">{captureErrorMessage(error)}</p>
          <details className="mt-2 text-xs text-rose-100/65">
            <summary className="cursor-pointer">Ver detalle técnico</summary>
            <code className="mt-1 block break-all">{error}</code>
          </details>
        </div>}
      </div>
      {result?.captureQueryCorrected && <p className="mt-5 rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.07] p-4 text-sm leading-6 text-cyan-50">La tabla de esta pestaña no correspondía a la consulta pendiente y no fue guardada. Seller OS está enviando la consulta correcta a la extensión; espera los resultados nuevos antes de capturar.</p>}
      {result?.captureAlreadyProcessed && <p className="mt-5 rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.07] p-4 text-sm leading-6 text-emerald-50">Esta tabla ya estaba guardada. No se importó ni duplicó nuevamente. Seller OS está enviando la próxima consulta validada a la extensión.</p>}
      {result && !result.captureAlreadyProcessed && !result.captureQueryCorrected && <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        {result.officialNoSoldResults && <div className="col-span-2 rounded-xl border border-amber-200/25 bg-amber-200/[0.07] p-3"><dt className="text-amber-100">Resultado oficial</dt><dd className="font-black text-amber-50">Cero ventas recientes para la familia preparada</dd></div>}
        <div><dt className="text-white/50">Filas / válidas</dt><dd className="font-black">{result.rowCount ?? 0} / {result.validCount ?? 0}</dd></div>
        <div><dt className="text-white/50">Importadas</dt><dd className="font-black">{result.importedCount ?? 0}</dd></div>
        <div><dt className="text-white/50">Duplicadas / rechazadas</dt><dd>{result.duplicateCount ?? 0} / {result.rejectedCount ?? 0}</dd></div>
        <div><dt className="text-white/50">Match exacto Luna</dt><dd>{result.matchCounts?.exactLuna ?? 0}</dd></div>
        <div><dt className="text-white/50">Pack / tamaño distinto</dt><dd>{result.matchCounts?.differentPack ?? 0} / {result.matchCounts?.differentSize ?? 0}</dd></div>
        <div><dt className="text-white/50">Candidatos enriquecidos</dt><dd>{result.candidatesEnriched ?? 0}</dd></div>
        <div><dt className="text-white/50">Consultas agrupadas</dt><dd>{result.queryPlan
          ? `${result.queryPlan.capturedCount ?? 0} / ${result.queryPlan.queryCount ?? 0}` : "N/D"}</dd></div>
        <div><dt className="text-white/50">Próxima consulta</dt><dd>{result.queryPlan?.nextQuery
          ? `#${result.queryPlan.nextQuery.ordinal ?? "—"} · ${result.queryPlan.nextQuery.candidateCount ?? 0} candidatos`
          : result.queryPlan?.status === "COMPLETED" ? "PLAN COMPLETADO" : "N/D"}</dd></div>
        <div><dt className="text-white/50">OpenAI</dt><dd>0 llamadas</dd></div>
        <div><dt className="text-white/50">Escrituras eBay</dt><dd>0</dd></div>
      </dl>}
      {result && !result.captureQueryCorrected && <a href="/admin#today-launch" target="sellerOsDashboard" rel="noopener" className="mt-6 grid min-h-12 w-full place-items-center rounded-2xl bg-emerald-200 px-4 text-sm font-black text-emerald-950">CONTINUAR CON EL SIGUIENTE PRODUCTO</a>}
      <p className="mt-6 text-xs text-white/45">{result?.queryPlan?.status === "COMPLETED" ? "El plan terminó. Regresa a Seller OS para revisar el resultado y la siguiente acción." : result && !result.captureQueryCorrected ? "La captura quedó guardada para este lote. Regresa a Seller OS: allí verás el siguiente producto antes de abrir otra consulta." : "Sesión segura del lote activa. Déjala abierta para conservar la autenticación durante las capturas autorizadas."}</p>
    </section>
  </main>
}
