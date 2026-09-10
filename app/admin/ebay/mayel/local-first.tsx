"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import type { MayelShippingSnapshotV1 } from "@/lib/seller-os/mayel-shipping-visibility-v1"
import { supabase } from "@/lib/supabase"
import { flushLocalOutboxV1, readLocalOutboxV1, readLocalImageBlobV1, readLocalImageSelectionsV1, saveLocalOutboxDraftV1, saveLocalOutboxReceiptV1,
  saveMayelLocalWorkspaceV1, readMayelLocalWorkspaceV1, type DraftInput, type LocalOutboxRecord, type MayelLocalWorkspace } from "@/lib/seller-os/ipad-local-outbox-v1"
import { type OutboxIntent, type DurableOutboxReceipt } from "@/lib/seller-os/ipad-outbox-contract-v1"
async function transport(action: "PUT" | "READ", value: OutboxIntent | string[], shippingItemIds?: string[]) {
 const { data } = await supabase.auth.getSession()
 if (!data.session) throw Error("OUTBOX_SESSION_REQUIRED")
 if (action === "PUT" && !Array.isArray(value) && value.kind === "IMAGE_UPLOAD") {
   for (const file of value.requestedChanges.files!) {
     const blob = await readLocalImageBlobV1(data.session.user.id, file.id)
     if (!blob || blob.size !== file.bytes || blob.type !== file.mimeType) throw Error("OUTBOX_LOCAL_IMAGE_MISSING")
     const chunkBytes = 1024 * 1024
     for (let n = 0; n <= Math.ceil(blob.size / chunkBytes); n++) {
       const final = n === Math.ceil(blob.size / chunkBytes)
       const form = new FormData()
       form.set("action", final ? "IPAD_VISUAL_FILE" : "IPAD_VISUAL_CHUNK")
       form.set("intent", JSON.stringify(value)); form.set("fileId", file.id)
       if (!final) { form.set("chunkIndex", String(n)); form.set("chunk", blob.slice(n * chunkBytes, (n + 1) * chunkBytes), "image.part") }
       const r = await fetch("/api/admin/ebay/mayel-visual-workstation", { method: "POST", body: form,
         headers: { Authorization: `Bearer ${data.session.access_token}` }, signal: AbortSignal.timeout(110000) })
       const response = await r.json()
       if (!r.ok || !response.success) throw Error(response.error ?? "OUTBOX_IMAGE_UPLOAD_FAILED")
       if (response.stored) break
     }
   }
 }
 const r = await fetch("/api/admin/ebay/assistant/revenue-engine", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
   headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
   body: JSON.stringify({ mode: "IPAD_OUTBOX", action, ...(action === "PUT" ? { intent: value } : { keys: value, ...(shippingItemIds ? { shippingItemIds } : {}) }) }) })
 const result = await r.json()
 if (!r.ok || !result.success) throw Error(result.error ?? "OUTBOX_SERVER_UNREACHABLE")
 return result
}
export function useMayelLocalFirstV1(workspace: Omit<MayelLocalWorkspace, "actorId">, restore: (w: MayelLocalWorkspace) => void) {
 const [actorId, setActorId] = useState("")
 const [ready, setReady] = useState(false)
 const [rows, setRows] = useState<LocalOutboxRecord[]>([])
 const [error, setError] = useState("")
 const [shipping, setShipping] = useState<MayelShippingSnapshotV1 | null>(null)
 const visibleItems = useRef<string[]>([])
 visibleItems.current = workspace.listings.map(row => row.itemId).slice(0, 20)
 const [serverError, setServerError] = useState("")
 const [localImagesPending, setLocalImagesPending] = useState(false)
 const restoring = useRef(restore); restoring.current = restore
 const writeChain = useRef(Promise.resolve())
 const inFlight = useRef<Promise<void> | null>(null)
 const flushAgain = useRef(false)
 const flush = useCallback(async () => {
   if (!actorId) return
   if (inFlight.current) { flushAgain.current = true; return inFlight.current }
   const operation = (async () => {
     try {
       const saved = await flushLocalOutboxV1(actorId, async intent => (await transport("PUT", intent)).receipt as DurableOutboxReceipt)
       // Reuse the existing visible-page receipt cycle for durable Shipping status.
       // An empty receipt batch still reads status; no extra scheduler/heartbeat.
       for (let start = 0; start < Math.max(1, saved.length); start += 100) {
         const batch = saved.slice(start, start + 100)
         const response = await transport("READ", batch.map(r => r.intent.idempotencyKey), start === 0 ? visibleItems.current : undefined)
         if (response.shipping) setShipping(response.shipping)
         for (const receipt of response.receipts as DurableOutboxReceipt[]) {
           const row = batch.find(r => r.intent.idempotencyKey === receipt.idempotencyKey)
           if (row) await saveLocalOutboxReceiptV1(row, receipt)
         }
       }
       setRows(await readLocalOutboxV1(actorId)); setServerError("")
     } catch (e) { setServerError(e instanceof Error ? e.message : "OUTBOX_SERVER_UNREACHABLE") }
   })()
   inFlight.current = operation
   await operation
   inFlight.current = null
   if (flushAgain.current) { flushAgain.current = false; void flush() }
 }, [actorId])
 useEffect(() => {
   let active = true
   void (async () => {
     try {
       const { data } = await supabase.auth.getSession()
       if (!data.session) throw Error("OUTBOX_SESSION_REQUIRED")
       const actor = data.session.user.id
       const [saved, intents] = await Promise.all([readMayelLocalWorkspaceV1(actor), readLocalOutboxV1(actor)])
       if (!active) return
       if (saved) restoring.current(saved)
       setActorId(actor); setRows(intents); setReady(true)
     } catch (e) { if (active) { setError(e instanceof Error ? e.message : "IPAD_LOCAL_STORAGE_UNAVAILABLE"); setReady(true) } }
   })()
   return () => { active = false }
 }, [])
 const serialized = JSON.stringify(workspace)
 useEffect(() => {
   if (!ready || !actorId) return
   const snapshot = JSON.parse(serialized) as Omit<MayelLocalWorkspace, "actorId">
   writeChain.current = writeChain.current.catch(() => undefined).then(async () => {
     await saveMayelLocalWorkspaceV1({ ...snapshot, actorId }); setError("")
   }).catch(e => { setError(e instanceof Error ? e.message : "IPAD_LOCAL_STORAGE_FAILED") })
 }, [serialized, ready, actorId])
 useEffect(() => {
   if (!actorId) return
   const resume = () => { if (document.visibilityState !== "hidden") void flush() }
   resume()
   window.addEventListener("online", resume); window.addEventListener("focus", resume); document.addEventListener("visibilitychange", resume)
   const timer = window.setInterval(resume, 15000)
   return () => { clearInterval(timer); window.removeEventListener("online", resume); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume) }
 }, [actorId, flush])
 useEffect(() => {
   if (!actorId) return
   let active = true
   const read = async () => {
     try {
       const selections = await readLocalImageSelectionsV1(actorId)
       if (active) setLocalImagesPending(selections.some(s => !s.queuedKey || !rows.some(r => r.intent.idempotencyKey === s.queuedKey && r.receipt)))
     } catch { if (active) setError("IPAD_LOCAL_STORAGE_FAILED") }
   }
   void read(); window.addEventListener("mayel-local-images-changed", read)
   return () => { active = false; window.removeEventListener("mayel-local-images-changed", read) }
 }, [actorId, rows])
 const saveDraft = useCallback(async (input: DraftInput, requireReceipt = false) => {
   if (!actorId) throw Error("IPAD_LOCAL_STORAGE_UNAVAILABLE")
   const row = await saveLocalOutboxDraftV1(actorId, input)
   setRows(await readLocalOutboxV1(actorId)); setError("")
   if (requireReceipt && !row.receipt) {
     const receipt = (await transport("PUT", row.intent)).receipt as DurableOutboxReceipt
     await saveLocalOutboxReceiptV1(row, receipt)
     setRows(await readLocalOutboxV1(actorId))
   } else void flush()
   return row
 }, [actorId, flush])
 return { ready, actorId, rows, error, serverError, saveDraft, localImagesPending, shipping }
}
export function MayelLocalSaveStatus({ local }: { local: ReturnType<typeof useMayelLocalFirstV1> }) {
 const latest = [...new Map([...local.rows].sort((a,b) => a.intent.createdAt.localeCompare(b.intent.createdAt)).map(r => [`${r.intent.itemId}:${r.intent.kind}`, r])).values()]
 const state = local.error || latest.some(r => r.receipt?.state === "REQUIERE_ATENCION" || (r.lastError && !/FAILED|UNREACHABLE|TIMEOUT|SESSION/.test(r.lastError))) ? "REQUIERE_ATENCION" :
   local.localImagesPending || latest.some(r => !r.receipt || r.receipt.state === "PENDIENTE_DE_SINCRONIZAR") ? "PENDIENTE_DE_SINCRONIZAR" :
   latest.length && latest.every(r => r.receipt?.state === "SINCRONIZADO") ? "SINCRONIZADO" : "GUARDADO"
 if (!local.ready) return null
 return <aside aria-label="Guardado automático de Mayel" className="rounded-xl border bg-white p-3">
   <p role="status">{state}</p>
   <details><summary>Ver detalles</summary>
     <p className="text-sm">{local.error ? "No se pudo guardar en este navegador. Mantén la página abierta mientras se recupera el almacenamiento." :
       !local.localImagesPending && latest.length && latest.every(r => r.receipt) ? "Seller OS recibió tus borradores. Puedes cerrar el iPad; las operaciones autorizadas continúan en el servidor cuando eBay y las comprobaciones lo permitan." :
       "El trabajo está guardado en este navegador. Al recuperar conexión con Seller OS, se enviará automáticamente."}</p>
     <pre className="max-h-64 overflow-auto text-xs">{JSON.stringify({ localError: local.error || null, serverError: local.serverError || null,
       receipts: latest.map(r => ({ itemId: r.intent.itemId, kind: r.intent.kind, receipt: r.receipt, handoffError: r.lastError })) }, null, 2)}</pre>
   </details>
 </aside>
}
