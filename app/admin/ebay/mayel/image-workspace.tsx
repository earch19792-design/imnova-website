"use client"
import { MayelVisualAssetProgress } from "./visual-asset-progress"
import { AUTONOMOUS_VISUAL_COPY_V1 } from "@/lib/seller-os/mayel-visual-asset-status-v1"
import { friendlyVisualSyncV1 } from "@/lib/seller-os/mayel-visual-scope-v1"
import { useState } from "react"
import Image from "next/image"
import { supabase } from "@/lib/supabase"
import type { DraftInput, LocalOutboxRecord } from "@/lib/seller-os/ipad-local-outbox-v1"
import type { readMayelImageWorkspaceV1 } from "@/lib/seller-os/mayel-image-workspace-v1"
type Proposal = Awaited<ReturnType<typeof readMayelImageWorkspaceV1>>["proposals"][number]
const button = "min-h-11 rounded-xl border border-[#c7d0c3] bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
const checks = ["productIdentityPreserved", "colorPreserved", "shapePreserved", "partCountPreserved", "visibleLogosPreserved", "noInventedAccessories", "noUnsupportedClaims", "noUnauthorizedText", "roleMatchesOutput"]

export function MayelImageWorkspace({ itemIds, titles = {}, saveDraft, owner = false }: { itemIds: string[]; titles?: Record<string, string>; owner?: boolean; saveDraft: (input: DraftInput, requireReceipt?: boolean) => Promise<LocalOutboxRecord> }) {
  const [rows, setRows] = useState<Proposal[] | null>(null)
  const [autonomous, setAutonomous] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [reviewed, setReviewed] = useState<string[]>([])
  async function autosave(proposal: Proposal, requireReceipt = false, explicitPrepare = false) {
    if (!itemIds.includes(proposal.itemId)) throw Error("VISUAL_ITEM_SCOPE_MISMATCH")
    if (!proposal.taskId || (!proposal.editable && !explicitPrepare)) return
    await saveDraft({ kind: "IMAGE_DRAFT", itemId: proposal.itemId, listingTitle: titles[proposal.itemId] ?? proposal.itemId,
      generationId: proposal.assetId, baseVersionHash: proposal.sourceImageSetDigest, baseObservedAt: proposal.generatedAt,
      requestedChanges: { ...(explicitPrepare ? { prepareReview: true } : {}), taskId: proposal.taskId, assetId: proposal.assetId, experimentId: proposal.experimentId,
        ...(typeof proposal.diagnostics.manifestDigest === "string" ? { manifestDigest: proposal.diagnostics.manifestDigest } : {}) } }, requireReceipt)
  }
  async function act(mode: "READ" | "PREPARE_REVIEW" | "CONFIRM_QUEUE", proposal?: Proposal) {
    if (busy) return
    setBusy(true); setError("")
    try {
      if (proposal) await autosave(proposal, mode === "CONFIRM_QUEUE", mode === "PREPARE_REVIEW")
      const { data } = await supabase.auth.getSession()
      if (!data.session) throw Error("AUTH_REQUIRED")
      const body = mode === "READ" ? { mode, itemIds } : { mode, itemId: proposal?.itemId, taskId: proposal?.taskId,
        assetId: proposal?.assetId, ...(mode === "PREPARE_REVIEW" ? { experimentId: proposal?.experimentId } : {
          replaceMainImage: true, authorizeDraftSync: proposal?.diagnostics.executionScope === "DRAFT_ONLY", expectedSourceDigest: proposal?.sourceImageSetDigest,
          humanQa: Object.fromEntries(checks.map(key => [key, Boolean(proposal && reviewed.includes(proposal.assetId))])) }) }
      const response = await fetch("/api/admin/ebay/assistant/revenue-engine", { method: "POST", cache: "no-store",
        signal: AbortSignal.timeout(65000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ ...body, mode: "IMAGE_WORKSPACE", action: mode }) })
      const result = await response.json()
      if (!response.ok || !result.success) throw Error(`${result.error ?? "REQUEST_FAILED"} · ${result.traceId ?? ""}`)
      if (!Array.isArray(result.proposals) || result.proposals.some((row: Proposal) => !itemIds.includes(row.itemId))) throw Error("VISUAL_ITEM_SCOPE_MISMATCH")
      setAutonomous(result.autonomousOptimization === true)
      for (const row of result.proposals as Proposal[]) await autosave(row)
      setRows(old => mode === "READ" ? result.proposals : [...(old ?? []).filter(r => r.itemId !== proposal?.itemId), ...result.proposals])
      setReviewed([])
    } catch (e) { setError(e instanceof Error ? e.message : "REQUEST_FAILED") }
    finally { setBusy(false) }
  }
  return <section className="space-y-3 rounded-2xl bg-white p-5" aria-label="Mejoras guardadas">
    <h3 className="font-semibold">Continúa con tus imágenes guardadas</h3>
    <p className="text-sm">{autonomous ? AUTONOMOUS_VISUAL_COPY_V1 : autonomous === false ? "Las propuestas quedan guardadas. Completa la revisión requerida por la autoridad de tu cuenta antes de sincronizar." : "Las propuestas quedan guardadas. Mayel comprueba la autoridad y la evidencia de cada mejora."}</p>
    <button className={button} disabled={busy || !itemIds.length} onClick={() => void act("READ")}>{busy ? "Guardando o consultando…" : rows ? "Actualizar propuestas" : "Abrir mejoras guardadas"}</button>
    {rows?.length === 0 && <p>No hay propuestas de imagen preparadas para esta selección. No se ha solicitado una nueva generación.</p>}
    {rows?.filter(row => itemIds.includes(row.itemId)).map(row => <article key={row.assetId} className="space-y-3 rounded-xl border p-4">
      <h4 className="font-semibold">{titles[row.itemId] ?? "Propuesta de imagen"}</h4>
      <MayelVisualAssetProgress status={friendlyVisualSyncV1(row.sync ?? undefined)} />
      {friendlyVisualSyncV1(row.sync).ownerCtaPresent && row.sync?.state === "OWNER_APPROVAL_REQUIRED" && !row.autonomousOptimization && <p>Pendiente de aprobación OWNER. Esta imagen todavía no está autorizada para sincronizar.</p>}
      <p className="text-sm">Preparado: {row.generatedAt ? new Date(row.generatedAt).toLocaleString("es") : "Fecha por comprobar"}. Antes de enviarlo se comprobará el estado actual.</p>
      <div className="grid gap-3 sm:grid-cols-2">{[[row.beforeUrl, "Imagen anterior guardada"], [row.previewUrl, "Propuesta de imagen principal"]].map(([url, label]) => typeof url === "string" && <figure key={String(label)}>
        <Image src={url} alt={String(label)} width={360} height={360} unoptimized /><figcaption>{String(label)}</figcaption></figure>)}</div>
      {row.status === "DRAFT" && (row.editable || row.canAssignAndPrepare) && !row.imported && <button className={button} disabled={busy} onClick={() => void act("PREPARE_REVIEW", row)}>{row.canAssignAndPrepare ? "Asignarme y preparar esta imagen" : "Preparar esta imagen para revisión"}</button>}
      {row.diagnostics.imageQaPassed && <p role="status">Borrador preparado y verificado. La propuesta está incluida en el Preview guardado; no se ha solicitado su envío a eBay.</p>}
      {friendlyVisualSyncV1(row.sync).ownerCtaPresent && row.status === "DRAFT" && row.editable && row.imported && owner && !row.autonomousOptimization && <>
        <label className="flex gap-2"><input type="checkbox" checked={reviewed.includes(row.assetId)} onChange={e => setReviewed(old => e.target.checked ? [...old, row.assetId] : old.filter(id => id !== row.assetId))} />
          <span>He comparado las imágenes: es el mismo producto, con su color, forma, piezas y logos. No añade accesorios, promesas ni texto sin respaldo. Quiero usarla como imagen principal y conservar las demás imágenes.</span></label>
        <button className={button} disabled={busy || !reviewed.includes(row.assetId)} onClick={() => void act("CONFIRM_QUEUE", row)}>Autorizar esta propuesta según la revisión de tu cuenta</button>
      </>}
      {row.status === "DRAFT" && !row.editable && !row.canAssignAndPrepare && <p>La propuesta está guardada. Su revisión necesita la tarea visual asignada al operador de este listing.</p>}
      <details><summary>Ver detalles</summary><pre className="overflow-auto text-xs">{JSON.stringify({ itemId: row.itemId, ...row.diagnostics, sync: row.sync }, null, 2)}</pre></details>
    </article>)}
    {error && <div role="alert"><p>No se completó el paso. La propuesta sigue guardada; no aparece como enviada.</p><details><summary>Ver detalles</summary><p>{error}</p></details></div>}
  </section>
}
