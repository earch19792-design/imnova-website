"use client"

import { useCallback, useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"
import { SellerOsMobileNav } from "../components/seller-os-mobile-nav"

type Child = { id: string; sequence_no: number; status: string
  supplier_sku: string | null; title: string | null; listing_id: string | null
  decision_profit: number | null; decision_margin: number | null
  official_readback_pass: boolean; idempotent_replay_confirmed: boolean }
type BatchRead = { status: string; batch: null | { id: string; status: string
  target_published_count: number; publication_write_count: number
  started_at: string; completed_at: string | null }; children: Child[] }

async function bearer() {
  const session = await supabase.auth.getSession()
  const token = session.data.session?.access_token
  if (!token) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.")
  return { Authorization: `Bearer ${token}` }
}

async function readJson(response: Response) {
  const body = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok || body?.success !== true) {
    throw new Error(String(body?.error ?? `HTTP_${response.status}`))
  }
  return body.result as BatchRead
}

export default function FastLunaBatchPage() {
  const [batch, setBatch] = useState<BatchRead | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const headers = await bearer()
      const response = await fetch("/api/admin/ebay/fast-luna-batch", {
        headers, cache: "no-store",
      })
      setBatch(await readJson(response))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo leer el lote.")
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (batch?.batch?.status !== "ACTIVE") return
    const timer = window.setInterval(() => void refresh(), 5_000)
    return () => window.clearInterval(timer)
  }, [batch?.batch?.status, refresh])

  async function publish(targetCount: number) {
    setBusy(true)
    setError(null)
    try {
      const headers = await bearer()
      const clientIdempotencyKey = `fast-luna:${crypto.randomUUID()}`
      const response = await fetch("/api/admin/ebay/fast-luna-batch", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ targetCount, clientIdempotencyKey,
          confirmation: `PUBLICAR ${targetCount} LISTINGS DE LUNA` }),
      })
      setBatch(await readJson(response))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo autorizar el lote.")
    } finally {
      setBusy(false)
    }
  }

  const active = batch?.batch?.status === "ACTIVE"
  return (
    <main className="min-h-screen bg-[#05070d] px-4 pb-28 pt-4 text-white sm:px-6">
      <section className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-3xl border border-emerald-200/20 bg-gradient-to-br from-emerald-200/[0.10] to-black p-5 sm:p-7">
          <a href="/admin/ebay-seller-os" className="text-sm font-black text-cyan-100">← Seller OS</a>
          <p className="mt-6 text-xs font-black uppercase tracking-[0.22em] text-emerald-100/60">Publicación rápida · Luna</p>
          <h1 className="mt-2 text-3xl font-black">Publicar un lote de prueba</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/65">Elige cuántos listings quieres. Seller OS toma productos disponibles del catálogo de Luna y continúa uno por uno hasta confirmar cada publicación en eBay.</p>
        </header>

        <section className="rounded-3xl border border-cyan-200/20 bg-cyan-200/[0.05] p-5">
          <h2 className="text-xl font-black">Un botón y listo</h2>
          <p className="mt-2 text-sm leading-6 text-white/65">No usamos demanda, vendidos ni competencia de eBay para elegir. Sí exigimos identidad, stock, costo completo, rentabilidad vigente, no duplicado, categoría, cumplimiento, imágenes y políticas de cuenta.</p>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map((count) => (
              <button key={count} type="button" disabled={busy || active}
                onClick={() => void publish(count)}
                className="min-h-16 rounded-2xl bg-white px-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? "Autorizando…" : `Publicar ${count}`}
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-white/50">Cantidad inicial por listing: 1. El trabajo es secuencial, con lectura oficial e idempotencia; una falla se detiene cerrada y muestra el bloqueo real.</p>
        </section>

        {error && <section className="rounded-2xl border border-rose-300/30 bg-rose-300/[0.08] p-4 text-sm font-bold text-rose-100">{error}</section>}

        <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs font-black uppercase tracking-widest text-white/45">Lote actual</p><h2 className="mt-1 text-xl font-black">{batch?.batch ? `${batch.batch.publication_write_count} de ${batch.batch.target_published_count} publicados` : "Todavía no hay un lote"}</h2></div>
            <button type="button" onClick={() => void refresh()} className="min-h-11 rounded-full border border-white/15 px-4 text-sm font-black">Actualizar</button>
          </div>
          {batch?.batch && <p className="mt-3 text-sm text-white/60">Estado: <strong className="text-white">{batch.batch.status}</strong></p>}
          <div className="mt-4 space-y-3">
            {batch?.children.map((child) => (
              <article key={child.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <div className="flex flex-wrap justify-between gap-2"><strong>Listing {child.sequence_no}</strong><span className="text-xs font-black text-cyan-100">{child.status}</span></div>
                <p className="mt-2 text-sm text-white/65">{child.title ?? child.supplier_sku ?? "Seleccionando producto de Luna…"}</p>
                {child.listing_id && <a className="mt-2 inline-block text-sm font-black text-emerald-200" href={`https://www.ebay.com/itm/${child.listing_id}`} target="_blank" rel="noreferrer">Ver en eBay · {child.listing_id}</a>}
                <p className="mt-2 text-xs text-white/45">Readback oficial: {child.official_readback_pass ? "confirmado" : "pendiente"} · Replay seguro: {child.idempotent_replay_confirmed ? "confirmado" : "pendiente"}</p>
              </article>
            ))}
          </div>
        </section>
      </section>
      <SellerOsMobileNav active="sales" />
    </main>
  )
}
