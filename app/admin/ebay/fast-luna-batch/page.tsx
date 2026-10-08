"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"
import { SellerOsMobileNav } from "../components/seller-os-mobile-nav"

type RequestedProduct = { requestReference: string; productId: string
  variantId: string; supplierSku: string; sourceUrl: string | null }
type Child = { id: string; sequence_no: number; status: string
  supplier_sku: string | null; title: string | null; listing_id: string | null
  decision_profit: number | null; decision_margin: number | null
  official_readback_pass: boolean; idempotent_replay_confirmed: boolean }
type BatchRead = { status: string; batch: null | { id: string; status: string
  target_published_count: number; publication_write_count: number
  started_at: string; completed_at: string | null }; children: Child[]
  selectionPolicy?: { mode?: "EXACT_OWNER_SELECTION" | "AUTOMATIC"
    requestedProducts?: RequestedProduct[] } }

const FRIENDLY_ERRORS: Record<string, string> = {
  UNIVERSAL_LUNA_PRODUCT_NOT_FOUND:
    "No encontré uno de esos SKU/ITEM o enlaces en el catálogo actual de Luna.",
  UNIVERSAL_LUNA_PRODUCT_AMBIGUOUS:
    "Una referencia coincide con más de una variante. Usa el SKU exacto.",
  UNIVERSAL_LUNA_PRODUCT_OUT_OF_STOCK:
    "Uno de los productos ya no tiene stock confirmado en Luna.",
  UNIVERSAL_LUNA_PRODUCT_STALE:
    "El stock de uno de los productos está vencido y debe refrescarse.",
  UNIVERSAL_LUNA_PRODUCT_COST_UNPROVEN:
    "Falta un costo vigente y trazable para uno de los productos.",
  FAST_LUNA_TEST_BATCH_ALREADY_ACTIVE:
    "Ya hay una publicación en curso. Esta terminará antes de iniciar otra.",
}

async function bearer() {
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token
  if (!token) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.")
  return { Authorization: `Bearer ${token}` }
}

async function readJson(response: Response) {
  const body = await response.json().catch(() => null) as
    Record<string, unknown> | null
  if (!response.ok || body?.success !== true) {
    const code = String(body?.error ?? `HTTP_${response.status}`)
    throw new Error(FRIENDLY_ERRORS[code] ?? code)
  }
  return body.result as BatchRead
}

function parseReferences(value: string) {
  return [...new Set(value.split(/[\n,]+/).map((entry) => entry.trim())
    .filter(Boolean))]
}

function childLabel(status: string) {
  if (status === "COMPLETED") return "Confirmado por eBay"
  if (status === "FAILED" || status === "BLOCKED") {
    return "Detenido con evidencia"
  }
  if (status === "PUBLISHING") return "Publicando en eBay"
  if (status === "VERIFYING") return "Leyendo confirmación oficial"
  if (status === "SELECTING") return "Validando producto y economía"
  return status.replaceAll("_", " ")
}

export default function FastLunaBatchPage() {
  const [batch, setBatch] = useState<BatchRead | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [referencesText, setReferencesText] = useState("")
  const [overlayOpen, setOverlayOpen] = useState(false)
  const references = useMemo(() => parseReferences(referencesText),
    [referencesText])

  const refresh = useCallback(async () => {
    try {
      const headers = await bearer()
      const response = await fetch("/api/admin/ebay/fast-luna-batch", {
        headers, cache: "no-store",
      })
      setBatch(await readJson(response))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message :
        "No se pudo leer el lote.")
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (batch?.batch?.status !== "ACTIVE") return
    setOverlayOpen(true)
    const timer = window.setInterval(() => void refresh(), 3_000)
    return () => window.clearInterval(timer)
  }, [batch?.batch?.status, refresh])

  async function publish(targetCount: number,
      productReferences: string[] = []) {
    setBusy(true)
    setOverlayOpen(true)
    setError(null)
    try {
      const headers = await bearer()
      const clientIdempotencyKey = `universal-luna:${crypto.randomUUID()}`
      const response = await fetch("/api/admin/ebay/fast-luna-batch", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ targetCount, productReferences,
          clientIdempotencyKey }),
      })
      setBatch(await readJson(response))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message :
        "No se pudo autorizar el lote.")
    } finally {
      setBusy(false)
    }
  }

  const active = batch?.batch?.status === "ACTIVE"
  const completed = batch?.batch?.publication_write_count ?? 0
  const target = batch?.batch?.target_published_count ?? 0
  const progress = target > 0 ? Math.min(100, completed / target * 100) : 0
  const canPublishExact = references.length >= 1 && references.length <= 4

  return (
    <main className="min-h-screen bg-[#05070d] px-4 pb-28 pt-4 text-white sm:px-6">
      <section className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-3xl border border-emerald-200/20 bg-gradient-to-br from-emerald-200/[0.10] to-black p-5 sm:p-7">
          <a href="/admin/ebay-seller-os" className="text-sm font-black text-cyan-100">← Seller OS</a>
          <p className="mt-6 text-xs font-black uppercase tracking-[0.22em] text-emerald-100/60">Universal Luna Direct Publisher V1</p>
          <h1 className="mt-2 text-3xl font-black">Publicar productos de Luna</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/65">Elige 1–4 productos automáticamente o pega los SKU/ITEM/enlaces exactos. Seller OS los recorre uno por uno y sólo termina cuando eBay confirma la publicación.</p>
        </header>

        <section className="rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.05] p-5">
          <h2 className="text-xl font-black">TEO, publícame…</h2>
          <p className="mt-2 text-sm leading-6 text-white/65">Selección automática del catálogo fresco de Luna, sin exigir demanda ni vendidos de eBay.</p>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map((count) => (
              <button key={count} type="button" disabled={busy || active}
                onClick={() => void publish(count)}
                className="min-h-16 rounded-2xl bg-white px-3 text-sm font-black text-black transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? "Autorizando…" : `Publicar ${count}`}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-violet-300/20 bg-violet-300/[0.05] p-5">
          <h2 className="text-xl font-black">O publica productos exactos</h2>
          <p className="mt-2 text-sm leading-6 text-white/65">Pega hasta cuatro SKU/ITEM o enlaces de Luna, uno por línea. El orden escrito será el orden de publicación.</p>
          <textarea value={referencesText}
            onChange={(event) => setReferencesText(event.target.value)}
            placeholder={"ITEM5919\nITEM1234\nhttps://lunaportex.com/products/…"}
            className="mt-4 min-h-32 w-full rounded-2xl border border-white/15 bg-black/35 p-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-violet-200/60" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className={`text-xs font-bold ${references.length > 4
              ? "text-rose-200" : "text-white/50"}`}>{references.length} de 4 referencias</p>
            <button type="button"
              disabled={busy || active || !canPublishExact}
              onClick={() => void publish(references.length, references)}
              className="min-h-12 rounded-full bg-violet-200 px-6 text-sm font-black text-violet-950 disabled:cursor-not-allowed disabled:opacity-40">
              Publicar estos {references.length || ""} productos
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-amber-200/20 bg-amber-100/[0.05] p-4 text-xs leading-5 text-amber-50/70">
          Publicación rápida no significa publicación ciega: stock confirmado, costos completos, ROI estimado ≥30%, margen de contribución ≥15%, no duplicado, imágenes, categoría, políticas y permiso de eBay siguen siendo obligatorios. Un dato desconocido nunca cuenta como cero.
        </section>

        {error && <section className="rounded-2xl border border-rose-300/30 bg-rose-300/[0.08] p-4 text-sm font-bold text-rose-100">{error}</section>}

        <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs font-black uppercase tracking-widest text-white/45">Último lote</p><h2 className="mt-1 text-xl font-black">{batch?.batch ? `${completed} de ${target} publicados` : "Todavía no hay un lote"}</h2></div>
            <button type="button" onClick={() => void refresh()} className="min-h-11 rounded-full border border-white/15 px-4 text-sm font-black">Actualizar</button>
          </div>
          {batch?.batch && <p className="mt-3 text-sm text-white/60">Estado: <strong className="text-white">{batch.batch.status}</strong> · Selección: <strong className="text-white">{batch.selectionPolicy?.mode === "EXACT_OWNER_SELECTION" ? "productos exactos" : "automática"}</strong></p>}
          <div className="mt-4 space-y-3">
            {batch?.children.map((child) => (
              <article key={child.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <div className="flex flex-wrap justify-between gap-2"><strong>Listing {child.sequence_no}</strong><span className="text-xs font-black text-cyan-100">{childLabel(child.status)}</span></div>
                <p className="mt-2 text-sm text-white/65">{child.title ?? child.supplier_sku ?? "Seleccionando producto de Luna…"}</p>
                {child.listing_id && <a className="mt-2 inline-block text-sm font-black text-emerald-200" href={`https://www.ebay.com/itm/${child.listing_id}`} target="_blank" rel="noreferrer">Ver en eBay · {child.listing_id}</a>}
                <p className="mt-2 text-xs text-white/45">Readback oficial: {child.official_readback_pass ? "confirmado" : "pendiente"} · Replay seguro: {child.idempotent_replay_confirmed ? "confirmado" : "pendiente"}</p>
              </article>
            ))}
          </div>
        </section>
      </section>

      {overlayOpen && (busy || batch?.batch) && <div role="dialog" aria-modal="true" aria-label="Progreso de publicación en eBay" className="publisher-overlay fixed inset-0 z-[100] overflow-y-auto bg-[#02040b]/95 px-4 py-8 backdrop-blur-xl">
        <div className="relative mx-auto flex min-h-full max-w-4xl items-center justify-center">
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <div className="scan-grid absolute inset-0 opacity-25" />
            <div className="energy-orb absolute left-1/2 top-24 h-72 w-72 -translate-x-1/2 rounded-full border border-cyan-200/30" />
            <div className="energy-orb energy-orb-two absolute left-1/2 top-32 h-56 w-56 -translate-x-1/2 rounded-full border border-violet-200/30" />
          </div>
          <section className="relative w-full rounded-[2rem] border border-cyan-200/25 bg-[#07101d]/90 p-5 shadow-[0_0_80px_rgba(34,211,238,0.16)] sm:p-8">
            {!active && !busy && <button type="button" onClick={() => setOverlayOpen(false)} className="absolute right-4 top-4 min-h-10 rounded-full border border-white/15 px-4 text-xs font-black">Cerrar</button>}
            <div className="text-center">
              <p className="text-xs font-black uppercase tracking-[0.32em] text-cyan-200/70">Seller OS · Enlace eBay</p>
              <h2 className="mt-3 text-2xl font-black sm:text-4xl">{busy ? "Autorizando publicación segura" : active ? "Publicando en eBay" : batch?.batch?.status === "COMPLETED" ? "Lote confirmado" : "Proceso detenido con evidencia"}</h2>
              <p aria-live="polite" className="mt-3 text-sm text-white/60">{busy ? "Resolviendo identidades, stock y autoridad…" : `${completed} de ${target} listings confirmados oficialmente`}</p>
            </div>
            <div className="mt-8 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="progress-glow h-full rounded-full bg-gradient-to-r from-violet-400 via-cyan-300 to-emerald-300 transition-[width] duration-700" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {busy && !batch?.batch && <article className="signal-card rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.06] p-4"><strong>Preparando lote durable</strong><p className="mt-2 text-xs text-white/50">Sin marketplace writes todavía</p></article>}
              {batch?.children.map((child) => <article key={child.id} className="signal-card rounded-2xl border border-white/10 bg-black/25 p-4">
                <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-widest text-white/40">Canal {String(child.sequence_no).padStart(2, "0")}</p><strong className="mt-1 block">{child.title ?? child.supplier_sku ?? "Producto Luna"}</strong></div><span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${child.official_readback_pass ? "bg-emerald-300 shadow-[0_0_18px_#6ee7b7]" : "status-pulse bg-cyan-300 shadow-[0_0_18px_#67e8f9]"}`} /></div>
                <p className="mt-3 text-xs font-bold text-cyan-100/70">{childLabel(child.status)}</p>
                {child.listing_id && <p className="mt-2 text-xs text-emerald-200">eBay {child.listing_id}</p>}
              </article>)}
            </div>
            <p className="mt-7 text-center text-xs leading-5 text-white/40">La animación refleja estados durables reales. Seller OS avanza secuencialmente y se detiene si stock, economía o eBay no permiten publicar.</p>
          </section>
        </div>
      </div>}

      <SellerOsMobileNav active="sales" />
      <style jsx>{`
        .scan-grid { background-image: linear-gradient(rgba(103,232,249,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(103,232,249,.1) 1px, transparent 1px); background-size: 44px 44px; animation: grid-drift 8s linear infinite; }
        .energy-orb { animation: orbit 4s ease-in-out infinite; box-shadow: 0 0 70px rgba(34,211,238,.12), inset 0 0 50px rgba(34,211,238,.08); }
        .energy-orb-two { animation-delay: -2s; animation-direction: reverse; }
        .signal-card { animation: signal-in .5s ease both; }
        .status-pulse { animation: pulse 1.3s ease-in-out infinite; }
        .progress-glow { box-shadow: 0 0 24px rgba(103,232,249,.65); }
        @keyframes grid-drift { to { transform: translateY(44px); } }
        @keyframes orbit { 50% { transform: translate(-50%, 8px) rotate(180deg) scale(1.05); } 100% { transform: translate(-50%, 0) rotate(360deg); } }
        @keyframes signal-in { from { opacity: 0; transform: translateY(8px); } }
        @keyframes pulse { 50% { opacity: .35; transform: scale(.7); } }
        @media (prefers-reduced-motion: reduce) { .scan-grid, .energy-orb, .signal-card, .status-pulse { animation: none !important; } }
      `}</style>
    </main>
  )
}
