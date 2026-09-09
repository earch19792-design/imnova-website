"use client"
import { useState } from "react"
import Image from "next/image"
import { supabase } from "@/lib/supabase"
import type { readMayelImageWorkspaceV1 } from "@/lib/seller-os/mayel-image-workspace-v1"
type Proposal = Awaited<ReturnType<typeof readMayelImageWorkspaceV1>>["proposals"][number]
const button = "min-h-11 rounded-xl border border-[#c7d0c3] bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
const checks = ["productIdentityPreserved", "colorPreserved", "shapePreserved", "partCountPreserved", "visibleLogosPreserved", "noInventedAccessories", "noUnsupportedClaims", "noUnauthorizedText", "roleMatchesOutput"]

export function MayelImageWorkspace({ itemIds }: { itemIds: string[] }) {
  const [rows, setRows] = useState<Proposal[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [reviewed, setReviewed] = useState<string[]>([])
  async function act(mode: "READ" | "PREPARE_REVIEW" | "CONFIRM_QUEUE", proposal?: Proposal) {
    if (busy) return
    setBusy(true); setError("")
    try {
      const { data } = await supabase.auth.getSession()
      if (!data.session) throw Error("AUTH_REQUIRED")
      const body = mode === "READ" ? { mode, itemIds } : { mode, itemId: proposal?.itemId, taskId: proposal?.taskId,
        assetId: proposal?.assetId, ...(mode === "PREPARE_REVIEW" ? { experimentId: proposal?.experimentId } : {
          replaceMainImage: true, expectedSourceDigest: proposal?.sourceImageSetDigest,
          humanQa: Object.fromEntries(checks.map(key => [key, Boolean(proposal && reviewed.includes(proposal.assetId))])) }) }
      const response = await fetch("/api/admin/ebay/assistant/image-workspace", { method: "POST", cache: "no-store",
        signal: AbortSignal.timeout(65000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(body) })
      const result = await response.json()
      if (!response.ok || !result.success) throw Error(`${result.error ?? "REQUEST_FAILED"} · ${result.traceId ?? ""}`)
      setRows(old => mode === "READ" ? result.proposals : [...(old ?? []).filter(r => r.itemId !== proposal?.itemId), ...result.proposals])
      setReviewed([])
    } catch (e) { setError(e instanceof Error ? e.message : "REQUEST_FAILED") }
    finally { setBusy(false) }
  }
  return <section className="space-y-3 rounded-2xl bg-white p-5" aria-label="Mejoras guardadas">
    <h3 className="font-semibold">Continúa con tus imágenes guardadas</h3>
    <p className="text-sm">Puedes revisar propuestas y confirmar su envío aunque eBay esté temporalmente sin consultas disponibles. Las imágenes confirmadas se conservan y se enviarán cuando el sistema verifique de nuevo el listing.</p>
    <button className={button} disabled={busy || !itemIds.length} onClick={() => void act("READ")}>{busy ? "Guardando o consultando…" : rows ? "Actualizar propuestas" : "Abrir mejoras guardadas"}</button>
    {rows?.length === 0 && <p>No hay propuestas de imagen preparadas para esta selección. No se ha solicitado una nueva generación.</p>}
    {rows?.map(row => <article key={row.assetId} className="space-y-3 rounded-xl border p-4">
      <p>Listing {row.itemId} · {row.status === "APPLIED" ? "Actualizado y verificado en eBay" : row.status === "QUEUED" ? "Confirmado · pendiente de sincronización" : row.status === "SUPERSEDED" ? "Conservado en el historial" : "Borrador guardado"}</p>
      <p className="text-sm">Preparado: {row.generatedAt ? new Date(row.generatedAt).toLocaleString("es") : "Fecha por comprobar"}. Antes de enviarlo se comprobará el estado actual.</p>
      <div className="grid gap-3 sm:grid-cols-2">{[[row.beforeUrl, "Imagen anterior guardada"], [row.previewUrl, "Propuesta de imagen principal"]].map(([url, label]) => typeof url === "string" && <figure key={String(label)}>
        <Image src={url} alt={String(label)} width={360} height={360} unoptimized /><figcaption>{String(label)}</figcaption></figure>)}</div>
      {row.status === "DRAFT" && row.editable && !row.imported && <button className={button} disabled={busy} onClick={() => void act("PREPARE_REVIEW", row)}>Preparar esta imagen para revisión</button>}
      {row.status === "DRAFT" && row.editable && row.imported && <>
        <label className="flex gap-2"><input type="checkbox" checked={reviewed.includes(row.assetId)} onChange={e => setReviewed(old => e.target.checked ? [...old, row.assetId] : old.filter(id => id !== row.assetId))} />
          <span>He comparado las imágenes: es el mismo producto, con su color, forma, piezas y logos. No añade accesorios, promesas ni texto sin respaldo. Quiero usarla como imagen principal y conservar las demás imágenes.</span></label>
        <button className={button} disabled={busy || !reviewed.includes(row.assetId)} onClick={() => void act("CONFIRM_QUEUE", row)}>Confirmar y enviar cuando eBay esté disponible</button>
      </>}
      {row.status === "DRAFT" && !row.editable && <p>La propuesta está guardada. Su revisión necesita la tarea visual asignada al operador de este listing.</p>}
      <details><summary>Ver detalles</summary><pre className="overflow-auto text-xs">{JSON.stringify(row.diagnostics, null, 2)}</pre></details>
    </article>)}
    {error && <div role="alert"><p>No se completó el paso. La propuesta sigue guardada; no aparece como enviada.</p><details><summary>Ver detalles</summary><p>{error}</p></details></div>}
  </section>
}
