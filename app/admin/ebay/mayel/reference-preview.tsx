"use client"
import { Suspense, useEffect, useRef, useState } from "react"
import Image from "next/image"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import type { readSellOneLikeThisV1 } from "@/lib/seller-os/sell-one-like-this-runtime-v1"

type Result = Awaited<ReturnType<typeof readSellOneLikeThisV1>>
async function request(body: unknown, signal?: AbortSignal) {
  const session = await supabase.auth.getSession()
  if (!session.data.session) throw Error("Inicia sesión para preparar el borrador.")
  const response = await fetch("/api/admin/ebay/assistant/revenue-engine", { method: "POST", signal, cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.data.session.access_token}` }, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok || !data.success) throw Error(data.error ?? "REFERENCE_UNAVAILABLE")
  return data
}
function ReferencePreview() {
  const params = useSearchParams()
  const [packageId, setPackage] = useState(params.get("packageId") ?? "")
  const [reference, setReference] = useState(params.get("referenceItemId") ?? "")
  const [choices, setChoices] = useState<{ id: string; title: string }[]>([])
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState("")
  const activeRequest = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void request({ mode: "REFERENCE_CHOICES" }, controller.signal).then(r => setChoices(r.choices))
      .catch(e => { if (!controller.signal.aborted) setError(String(e.message)) })
    return () => { controller.abort(); activeRequest.current?.abort() }
  }, [])
  function edit(action: () => void) { activeRequest.current?.abort(); setBusy(false); setResult(null); setError(""); action() }
  async function prepare() {
    if (busy) return
    const controller = new AbortController(); activeRequest.current = controller
    setBusy(true); setError(""); setResult(null)
    try {
      const value = reference.trim()
      let itemId = value
      if (!/^\d{9,19}$/.test(value)) {
        const url = new URL(value)
        if (url.protocol !== "https:" || !/^(www\.)?ebay\.com$/.test(url.hostname)) throw Error("Utiliza el Item ID o un enlace de ebay.com.")
        itemId = url.pathname.match(/\/(\d{9,19})\/?$/)?.[1] ?? ""
      }
      if (!/^\d{9,19}$/.test(itemId)) throw Error("Revisa el Item ID de referencia.")
      const r = await request({ mode: "REFERENCE_IMPORT", packageId, referenceItemId: itemId }, controller.signal)
      if (!controller.signal.aborted) {
        setResult(r.result)
        const url = new URL(window.location.href); url.searchParams.set("packageId", packageId); url.searchParams.set("referenceItemId", itemId)
        window.history.replaceState(null, "", url)
      }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "REFERENCE_UNAVAILABLE") }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const preview = result?.preview
  return <section className="mt-5 space-y-5 rounded-xl border p-5" aria-label="Borrador por referencia">
    <h2 className="text-xl font-semibold">Preparar con una referencia eBay</h2>
    <p>La referencia orienta la estructura. El borrador utiliza los datos y las imágenes autorizadas de tu producto.</p>
    <label className="block">Tu producto
      <select className="block w-full rounded border p-3 text-black" value={packageId} onChange={e => edit(() => setPackage(e.target.value))}>
        <option value="">Selecciona un borrador</option>
        {choices.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select>
    </label>
    <label className="block">Listing de referencia
      <input className="block w-full rounded border p-3 text-black" value={reference} onChange={e => edit(() => setReference(e.target.value))} placeholder="Item ID o enlace eBay" />
    </label>
    <p className="text-sm">Utiliza una referencia ya guardada en la investigación de este producto. No se inicia una nueva búsqueda.</p>
    <button className="rounded border px-5 py-3 disabled:opacity-50" disabled={busy || !packageId || !reference} onClick={() => void prepare()}>
      {busy ? "Preparando borrador…" : "Preparar Preview"}
    </button>
    {error && <div role="alert"><p>No se pudo preparar el borrador. Revisa la referencia y tu acceso.</p><details><summary>Ver detalles</summary>{error}</details></div>}
    {result && <>
      <p role="status">{result.previewPass ? "Borrador preparado para revisar" : "Esperando datos del producto o de su referencia"}</p>
      <p>Envío: {result.shippingStatus === "SHIPPING_PROVEN" ? `$${Number(result.commercialEnvelope.components.shipping.value).toFixed(2)} · Vigente` : "Esperando actualización. Puedes revisar el borrador mientras llega."}</p>
      <p>Esta preparación no autoriza una publicación.</p>
      {preview && <article className="space-y-4 rounded border p-5" aria-label="Preview del producto propio">
        <h2 className="text-xl font-semibold">{preview.title}</h2>
        <p className="whitespace-pre-wrap">{preview.description}</p>
        <p>Categoría: {String(preview.categoryId)}</p>
        <dl>{Object.entries(preview.itemSpecifics).map(([k,v]) => <div key={k}><dt className="font-semibold">{k}</dt><dd>{v}</dd></div>)}</dl>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{preview.imageUrls.map((url,i) => <Image unoptimized key={url} src={url} alt={`Imagen autorizada ${i+1}`} width={300} height={300} className="h-auto w-full object-contain" />)}</div>
        <p>Precio propuesto: {typeof preview.price === "number" ? `$${preview.price.toFixed(2)}` : "Esperando datos"}</p>
        <p>Economía: {result.commercialEnvelope.components.feeAuthority.status === "PROVEN" ? "Revisar evidencia" : "Esperando fees vigentes"}</p>
      </article>}
      <details className="rounded border p-4"><summary>Ver detalles</summary>
        <p>Referencia: {result.referenceItemId}</p>
        <p>Estructura transferible: {result.referenceImport.counts.TRANSFERABLE} · Requiere corroboración: {result.referenceImport.counts.REQUIRES_CORROBORATION} · Rechazado: {result.referenceImport.counts.REJECTED}</p>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(result, null, 2)}</pre>
      </details>
    </>}
  </section>
}
export function MayelReferencePreview() { return <Suspense fallback={<p>Cargando borradores…</p>}><ReferencePreview /></Suspense> }
