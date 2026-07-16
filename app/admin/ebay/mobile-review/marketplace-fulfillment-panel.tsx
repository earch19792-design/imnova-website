"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"

type Task = {
  id: string
  marketplace_order_id: string
  marketplace_line_item_id: string
  listing_id: string
  marketplace_listing_sku: string | null
  supplier_sku: string | null
  supplier_variant_id: string | null
  product_title: string
  quantity: number
  workflow_state: string
  lock_version: number
  priority: number
  next_action_at: string | null
  last_error_code: string | null
  source_product_url: string | null
  seller_order_url: string | null
  estimated_supplier_cost: number | null
  estimated_profit: number | null
  stock_available: number | null
  ship_by_at: string | null
  purchase_confirmed_at: string | null
  tracking_payload_hash: string | null
  current_shipment_id: string | null
}

type Event = {
  id: string
  fulfillment_task_id: string
  sequence_number: number
  event_type: string
  from_state: string | null
  to_state: string
  actor_type: string
  evidence: Record<string, unknown>
  occurred_at: string
}

type Purchase = {
  id: string
  fulfillment_task_id: string
  supplier_order_id: string
  product_cost: number
  shipping_cost: number
  tax_amount: number
  total_paid: number
  currency: string
  purchased_at: string
}

type Shipment = {
  id: string
  primary_fulfillment_task_id: string
  tracking_number: string
  suggested_carrier: string | null
  confirmed_carrier: string
  shipped_at: string
  partial_shipment: boolean
  normalized_payload: Record<string, unknown>
  payload_hash: string
  approval_status: string
  superseded_at: string | null
}

type Submission = {
  id: string
  fulfillment_task_id: string
  shipment_id: string
  payload_hash: string
  adapter: string
  status: string
  attempts: number
  max_attempts: number
  last_error_code: string | null
  due_at: string
}

type Dashboard = {
  enabled: boolean
  tasks: Task[]
  events?: Event[]
  purchases?: Purchase[]
  shipments?: Shipment[]
  submissions?: Submission[]
  config?: {
    simulatorEnabled?: boolean
    realSubmitterEnabled?: boolean
    ebayTrackingWriteEnabled?: boolean
    adapter?: string
  }
  safety?: { ebayWrites?: number; buyerPiiReturned?: boolean; cardDataStored?: boolean }
}

type ApiPayload = {
  success?: boolean
  dashboard?: Dashboard
  result?: unknown
  error?: string
}

type PurchaseForm = {
  lunaOrderId: string
  productCost: string
  shippingCost: string
  taxAmount: string
  totalPaid: string
  currency: string
  purchasedAt: string
}

type TrackingForm = {
  trackingNumber: string
  suggestedCarrier: string
  confirmedCarrier: string
  shippedDate: string
  quantity: string
}

function localDateTimeValue(date = new Date()) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—"
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat("es-GT", { dateStyle: "medium", timeStyle: "short" }).format(parsed) : "—"
}

function money(value: number | null | undefined, currency = "USD") {
  return value === null || value === undefined ? "—" : new Intl.NumberFormat("es-GT", { style: "currency", currency }).format(value)
}

function stateLabel(value: string) {
  return value.replaceAll("_", " ")
}

function nextAction(task: Task) {
  if (task.workflow_state === "PENDING_MANUAL_PURCHASE") return "Comprar manualmente en Luna y confirmar la compra."
  if (["LUNA_ORDER_PLACED", "WAITING_FOR_TRACKING"].includes(task.workflow_state)) return "Pegar y validar el tracking cuando Luna lo proporcione."
  if (task.workflow_state === "TRACKING_READY_FOR_SUBMISSION") return "Revisar el payload exacto y aprobar la simulación."
  if (task.workflow_state === "TRACKING_SUBMISSION_QUEUED") return "Esperar al adapter simulado; no se escribirá en eBay."
  if (["TRACKING_SUBMITTED_SIMULATED", "SHIPPED_SIMULATED"].includes(task.workflow_state)) return "Simulación completada; V1A no cierra ni entrega automáticamente."
  if (task.workflow_state === "MANUAL_REVIEW_REQUIRED") return "Resolver manualmente el error antes de continuar."
  return "Revisar el historial de la tarea."
}

export function MarketplaceFulfillmentPanel() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyTask, setBusyTask] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [purchaseForms, setPurchaseForms] = useState<Record<string, PurchaseForm>>({})
  const [trackingForms, setTrackingForms] = useState<Record<string, TrackingForm>>({})

  const authenticatedRequest = useCallback(async (path: string, init?: RequestInit) => {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !data.session) throw new Error("AUTH_REQUIRED")
    const response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    })
    const payload = await response.json() as ApiPayload
    if (!response.ok || !payload.success) throw new Error(payload.error ?? "FULFILLMENT_REQUEST_FAILED")
    return payload
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const payload = await authenticatedRequest("/api/admin/marketplace/fulfillment/tasks")
      setDashboard(payload.dashboard ?? null)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "FULFILLMENT_DASHBOARD_FAILED")
    } finally {
      setLoading(false)
    }
  }, [authenticatedRequest])

  useEffect(() => { void load() }, [load])

  const purchases = useMemo(() => new Map((dashboard?.purchases ?? []).map((row) => [row.fulfillment_task_id, row])), [dashboard])
  const shipments = useMemo(() => new Map((dashboard?.shipments ?? []).filter((row) => !row.superseded_at).map((row) => [row.primary_fulfillment_task_id, row])), [dashboard])
  const submissions = useMemo(() => new Map((dashboard?.submissions ?? []).map((row) => [row.fulfillment_task_id, row])), [dashboard])

  const purchaseForm = (task: Task): PurchaseForm => purchaseForms[task.id] ?? {
    lunaOrderId: "",
    productCost: task.estimated_supplier_cost?.toFixed(2) ?? "",
    shippingCost: "0.00",
    taxAmount: "0.00",
    totalPaid: task.estimated_supplier_cost?.toFixed(2) ?? "",
    currency: "USD",
    purchasedAt: localDateTimeValue(),
  }
  const trackingForm = (task: Task): TrackingForm => trackingForms[task.id] ?? {
    trackingNumber: "",
    suggestedCarrier: "USPS",
    confirmedCarrier: "USPS",
    shippedDate: localDateTimeValue(),
    quantity: String(task.quantity),
  }

  const submit = useCallback(async (task: Task, action: "purchase" | "tracking" | "approve") => {
    setBusyTask(task.id)
    setError("")
    setMessage("")
    try {
      let path = ""
      let body: Record<string, unknown> = {}
      if (action === "purchase") {
        const form = purchaseForm(task)
        path = `/api/admin/marketplace/fulfillment/tasks/${encodeURIComponent(task.id)}/confirm-purchase`
        body = { ...form, lockVersion: task.lock_version, purchasedAt: new Date(form.purchasedAt).toISOString() }
      } else if (action === "tracking") {
        const form = trackingForm(task)
        path = `/api/admin/marketplace/fulfillment/tasks/${encodeURIComponent(task.id)}/tracking`
        body = {
          trackingNumber: form.trackingNumber,
          suggestedCarrier: form.suggestedCarrier,
          confirmedCarrier: form.confirmedCarrier,
          shippedDate: new Date(form.shippedDate).toISOString(),
          lockVersion: task.lock_version,
          items: [{
            lineItemId: task.marketplace_line_item_id,
            quantity: Number(form.quantity),
          }],
        }
      } else {
        const shipment = shipments.get(task.id)
        if (!shipment || !task.tracking_payload_hash) throw new Error("FULFILLMENT_SHIPMENT_NOT_APPROVABLE")
        const confirmed = window.confirm(
          `Confirmo que revisé el payload ${task.tracking_payload_hash}. Esta acción sólo encolará una submission simulada y no escribirá tracking en eBay. ¿Continuar?`,
        )
        if (!confirmed) return
        path = `/api/admin/marketplace/fulfillment/tasks/${encodeURIComponent(task.id)}/approve-tracking-submission`
        body = { confirmed: true, payloadHash: shipment.payload_hash, lockVersion: task.lock_version }
      }
      await authenticatedRequest(path, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      })
      setMessage(action === "purchase" ? "Compra manual registrada." : action === "tracking" ? "Tracking validado; revisa el payload antes de aprobar." : "Submission simulada encolada. No se llamó a eBay.")
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "FULFILLMENT_REQUEST_FAILED")
    } finally {
      setBusyTask(null)
    }
  }, [authenticatedRequest, load, purchaseForms, trackingForms, shipments])

  if (!loading && dashboard && !dashboard.enabled) return null

  return <section aria-labelledby="fulfillment-v1a-heading" className="space-y-4 rounded-3xl border border-violet-200/25 bg-violet-200/[0.06] p-4">
    <header>
      <p className="text-xs font-black uppercase tracking-widest text-violet-100/65">Preview · staging · V1A</p>
      <h2 id="fulfillment-v1a-heading" className="mt-1 text-xl font-black">Fulfillment manual y tracking simulado</h2>
      <p className="mt-2 text-sm text-white/70">Compra manual en Luna, tracking con aprobación humana y adapter exclusivamente simulado. Escrituras eBay: 0.</p>
    </header>

    {loading && <p role="status" className="rounded-2xl border border-white/10 p-4 text-sm">Cargando cola de fulfillment…</p>}
    {error && <p role="alert" className="rounded-2xl border border-rose-200/25 bg-rose-200/[0.08] p-3 text-sm font-bold text-rose-50">{error}</p>}
    {message && <p role="status" className="rounded-2xl border border-emerald-200/25 bg-emerald-200/[0.08] p-3 text-sm font-bold text-emerald-50">{message}</p>}

    {dashboard?.enabled && <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      <div className="rounded-2xl bg-black/25 p-3"><span className="text-white/50">Tareas</span><strong className="mt-1 block text-lg">{dashboard.tasks.length}</strong></div>
      <div className="rounded-2xl bg-black/25 p-3"><span className="text-white/50">Adapter</span><strong className="mt-1 block uppercase">{dashboard.config?.adapter ?? "—"}</strong></div>
      <div className="rounded-2xl bg-black/25 p-3"><span className="text-white/50">Escrituras eBay</span><strong className="mt-1 block text-lg">{dashboard.safety?.ebayWrites ?? 0}</strong></div>
      <div className="rounded-2xl bg-black/25 p-3"><span className="text-white/50">PII / tarjeta</span><strong className="mt-1 block">NO</strong></div>
    </div>}

    {dashboard?.enabled && dashboard.tasks.length === 0 && <p className="rounded-2xl border border-white/10 p-5 text-center text-white/65">No hay ventas que requieran fulfillment.</p>}

    {dashboard?.tasks.map((task) => {
      const purchase = purchases.get(task.id)
      const shipment = shipments.get(task.id)
      const submission = submissions.get(task.id)
      const taskEvents = (dashboard.events ?? []).filter((event) => event.fulfillment_task_id === task.id)
      const pForm = purchaseForm(task)
      const tForm = trackingForm(task)
      return <article key={task.id} className="rounded-3xl border border-white/15 bg-black/25 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-black uppercase text-violet-100">{stateLabel(task.workflow_state)}</p><h3 className="mt-1 font-black">{task.product_title}</h3><p className="mt-1 text-xs text-white/50">Ship-by: {formatDate(task.ship_by_at)} · prioridad {task.priority}</p></div>
          <span className="rounded-full border border-white/15 px-3 py-1 text-xs font-black">Cantidad {task.quantity}</span>
        </div>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <div><dt className="text-white/45">Item ID</dt><dd className="font-mono">{task.listing_id}</dd></div>
          <div><dt className="text-white/45">Custom Label</dt><dd className="font-mono">{task.marketplace_listing_sku ?? "—"}</dd></div>
          <div><dt className="text-white/45">Supplier SKU / variant</dt><dd className="font-mono">{task.supplier_sku ?? "—"} / {task.supplier_variant_id ?? "—"}</dd></div>
          <div><dt className="text-white/45">Costo estimado</dt><dd>{money(task.estimated_supplier_cost)}</dd></div>
          <div><dt className="text-white/45">Utilidad estimada</dt><dd>{money(task.estimated_profit)}</dd></div>
          <div><dt className="text-white/45">Stock observado</dt><dd>{task.stock_available ?? "N/D"}</dd></div>
        </dl>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {task.source_product_url && <a href={task.source_product_url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-violet-200 px-3 text-center font-black text-black">Abrir producto en Luna</a>}
          {task.seller_order_url && <a href={task.seller_order_url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/20 px-3 text-center font-black">Abrir orden oficial en eBay</a>}
        </div>

        {task.workflow_state === "PENDING_MANUAL_PURCHASE" && <form className="mt-4 grid gap-3 rounded-2xl border border-white/10 p-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void submit(task, "purchase") }}>
          <label className="text-xs">Luna Order ID<input required value={pForm.lunaOrderId} onChange={(event) => setPurchaseForms((current) => ({ ...current, [task.id]: { ...pForm, lunaOrderId: event.target.value } }))} className="mt-1 min-h-11 w-full rounded-xl bg-black/35 px-3" /></label>
          <label className="text-xs">Costo producto<input required type="number" min="0" step="0.01" value={pForm.productCost} onChange={(event) => setPurchaseForms((current) => ({ ...current, [task.id]: { ...pForm, productCost: event.target.value } }))} className="mt-1 min-h-11 w-full rounded-xl bg-black/35 px-3" /></label>
          <label className="text-xs">Envío<input required type="number" min="0" step="0.01" value={pForm.shippingCost} onChange={(event) => setPurchaseForms((current) => ({ ...current, [task.id]: { ...pForm, shippingCost: event.target.value } }))} className="mt-1 min-h-11 w-full rounded-xl bg-black/35 px-3" /></label>
          <label className="text-xs">Impuesto<input type="number" min="0" step="0.01" value={pForm.taxAmount} onChange={(event) => setPurchaseForms((current) => ({ ...current, [task.id]: { ...pForm, taxAmount: event.target.value } }))} className="mt-1 min-h-11 w-full rounded-xl bg-black/35 px-3" /></label>
          <label className="text-xs">Total pagado<input required type="number" min="0" step="0.01" value={pForm.totalPaid} onChange={(event) => setPurchaseForms((current) => ({ ...current, [task.id]: { ...pForm, totalPaid: event.target.value } }))} className="mt-1 min-h-11 w-full rounded-xl bg-black/35 px-3" /></label>
          <label className="text-xs">Comprado en<input required type="datetime-local" value={pForm.purchasedAt} onChange={(event) => setPurchaseForms((current) => ({ ...current, [task.id]: { ...pForm, purchasedAt: event.target.value } }))} className="mt-1 min-h-11 w-full rounded-xl bg-black/35 px-3" /></label>
          <button disabled={busyTask === task.id} className="min-h-12 rounded-xl bg-emerald-200 px-3 font-black text-black sm:col-span-2">Confirmar compra manual</button>
        </form>}

        {purchase && <p className="mt-3 rounded-xl bg-emerald-200/[0.07] p-3 text-xs">Compra Luna {purchase.supplier_order_id} · {money(purchase.total_paid, purchase.currency)} · {formatDate(purchase.purchased_at)}</p>}

        {["WAITING_FOR_TRACKING", "TRACKING_READY_FOR_SUBMISSION", "TRACKING_SUBMISSION_QUEUED"].includes(task.workflow_state) && <form className="mt-4 grid gap-3 rounded-2xl border border-white/10 p-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void submit(task, "tracking") }}>
          <label className="text-xs">Tracking number<input required value={tForm.trackingNumber} onChange={(event) => setTrackingForms((current) => ({ ...current, [task.id]: { ...tForm, trackingNumber: event.target.value } }))} className="mt-1 min-h-11 w-full rounded-xl bg-black/35 px-3 font-mono" /></label>
          <label className="text-xs">Cantidad del paquete<input required type="number" min="1" max={task.quantity} value={tForm.quantity} onChange={(event) => setTrackingForms((current) => ({ ...current, [task.id]: { ...tForm, quantity: event.target.value } }))} className="mt-1 min-h-11 w-full rounded-xl bg-black/35 px-3" /></label>
          <label className="text-xs">Carrier sugerido<select value={tForm.suggestedCarrier} onChange={(event) => setTrackingForms((current) => ({ ...current, [task.id]: { ...tForm, suggestedCarrier: event.target.value } }))} className="mt-1 min-h-11 w-full rounded-xl bg-black/35 px-3"><option>USPS</option><option>UPS</option><option>FEDEX</option><option>DHL</option><option>ONTRAC</option><option>ESTAFETA</option></select></label>
          <label className="text-xs">Carrier confirmado<select value={tForm.confirmedCarrier} onChange={(event) => setTrackingForms((current) => ({ ...current, [task.id]: { ...tForm, confirmedCarrier: event.target.value } }))} className="mt-1 min-h-11 w-full rounded-xl bg-black/35 px-3"><option>USPS</option><option>UPS</option><option>FEDEX</option><option>DHL</option><option>ONTRAC</option><option>ESTAFETA</option></select></label>
          <label className="text-xs sm:col-span-2">Fecha de despacho<input required type="datetime-local" value={tForm.shippedDate} onChange={(event) => setTrackingForms((current) => ({ ...current, [task.id]: { ...tForm, shippedDate: event.target.value } }))} className="mt-1 min-h-11 w-full rounded-xl bg-black/35 px-3" /></label>
          <button disabled={busyTask === task.id} className="min-h-12 rounded-xl bg-cyan-200 px-3 font-black text-black sm:col-span-2">Validar tracking y preparar payload</button>
        </form>}

        {shipment && <div className="mt-3 rounded-2xl border border-cyan-200/20 bg-cyan-200/[0.06] p-3 text-xs"><p className="font-black">Payload normalizado · {shipment.approval_status}</p><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-cyan-50/80">{JSON.stringify(shipment.normalized_payload, null, 2)}</pre><p className="mt-2 break-all font-mono">{shipment.payload_hash}</p>{task.workflow_state === "TRACKING_READY_FOR_SUBMISSION" && <button type="button" disabled={busyTask === task.id} onClick={() => void submit(task, "approve")} className="mt-3 min-h-12 w-full rounded-xl bg-amber-100 px-3 font-black text-black">Aprobar submission simulada</button>}</div>}
        {submission && <p className="mt-3 rounded-xl bg-violet-200/[0.08] p-3 text-xs">Outbox {submission.status} · adapter {submission.adapter} · intentos {submission.attempts}/{submission.max_attempts}{submission.last_error_code ? ` · ${submission.last_error_code}` : ""}</p>}
        <p className="mt-3 text-sm"><strong>Siguiente acción:</strong> {nextAction(task)}</p>
        {task.last_error_code && <p className="mt-2 text-xs font-bold text-rose-100">Error sanitizado: {task.last_error_code}</p>}

        <details className="mt-3 rounded-2xl border border-white/10 p-3"><summary className="cursor-pointer text-sm font-black">Historial append-only ({taskEvents.length})</summary><ol className="mt-3 space-y-2 text-xs">{taskEvents.map((event) => <li key={event.id} className="rounded-xl bg-black/25 p-2"><strong>#{event.sequence_number} {stateLabel(event.to_state)}</strong><span className="mt-1 block text-white/50">{formatDate(event.occurred_at)} · {event.actor_type}</span></li>)}</ol></details>
      </article>
    })}
  </section>
}
