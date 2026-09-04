"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Clipboard, ShieldCheck, Upload, X } from
  "lucide-react"

import { supabase } from "@/lib/supabase"

type VisualRole = "DETAIL" | "PACKAGE_CONTENTS" | "DIMENSIONS" |
  "PRIMARY_BENEFIT" | "LIFESTYLE" | "HUMAN_USE"

type VisualOutput = {
  id: string
  status: string
  mayel_output_role: VisualRole
  output_sha256: string
  output_width: number
  output_height: number
  qa_result: Record<string, unknown>
  mayel_approval_status: string
  owner_approval_status: string
  previewUrl: string | null
}

type VisualTask = {
  visualTaskId: string
  ebayItemId: string
  sku: string
  productTitle: string
  status: string
  evidencePack: Record<string, unknown>
  prompt: string
  promptVersion: string
  promptDigest: string
  promptSlots: { role: VisualRole; status: "READY" |
    "BLOCKED_MISSING_EVIDENCE"; requiredEvidence: string }[]
  sourceImageSetDigest: string
  productTruthDigest: string
  sourceImages: { referenceId: string; sha256: string; url: string | null;
    storagePath: string | null; authority: string; position: number }[]
  currentImages: string[]
  outputs: VisualOutput[]
  visualManifest: Record<string, unknown> | null
  visualManifestDigest: string | null
  phaseB?: {
    visualManifestId?: string | null
    visualManifestDigest?: string | null
    ownerAuthorizationDigest?: string | null
    currentOfficialImageSetDigest?: string | null
    currentImages?: string[]
    currentMainImage?: string | null
    currentSecondaryImages?: string[]
    newMayelSecondaryImages?: string[]
    proposedFinalImages?: string[]
    finalOrder?: { position: number; url: string; role: string }[]
    fieldsToChange?: string[]
    mainImageProtected?: boolean
    mainImageChanged?: boolean
    account?: string
    marketplace?: string
    managementModel?: string
    managementModelAuthority?: string
    managementDiagnostics?: {
      inventoryHttpStatus?: number
      offersHttpStatus?: number
      inventoryItemPresent?: boolean
      inventoryItemAuthoritativelyAbsent?: boolean
      offersReadComplete?: boolean
      exactPublishedOfferCount?: number
      groupedInventoryItem?: boolean
    }
    safeRebaseAvailable?: boolean
    rebaseEligible?: boolean
    imageSetChangeClassification?: string
    currentOfficialImageCount?: number
    manifestBoundImageCount?: number
    mayelAssetPreserved?: boolean
    mayelReworkRequired?: boolean
    rebaseBlocker?: string | null
    ownerCtaAvailable?: boolean
    blocker?: string | null
    execution?: { executionId?: string; phase?: string;
      marketplaceWriteCount?: number; appliedAndOfficiallyVerified?: boolean } | null
  }
}

const labels: Record<VisualRole, string> = {
  DETAIL: "Detalle", PACKAGE_CONTENTS: "Contenido del paquete",
  DIMENSIONS: "Dimensiones", PRIMARY_BENEFIT: "Beneficio principal",
  LIFESTYLE: "Lifestyle / contexto aspiracional", HUMAN_USE: "Uso humano",
}

const rejectionReasons = [
  ["IDENTITY_DRIFT", "El producto cambió"],
  ["INCORRECT_COLOR", "Color incorrecto"],
  ["INVENTED_ACCESSORY", "Accesorio inventado"],
  ["INCORRECT_TEXT", "Texto incorrecto"],
  ["INCORRECT_DIMENSION", "Dimensión incorrecta"],
  ["LOW_QUALITY", "Calidad insuficiente"],
  ["ROLE_MISMATCH", "No corresponde al tipo de imagen"],
  ["OTHER_SAFE_REASON", "Otra razón segura"],
] as const

async function visualRequest(path: string, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error("SESSION_REQUIRED")
  const response = await fetch(path, { ...init, cache: "no-store",
    headers: { ...(init?.headers ?? {}),
      Authorization: `Bearer ${data.session.access_token}` } })
  const payload = await response.json().catch(() => null) as
    Record<string, unknown> | null
  if (!response.ok || payload?.success !== true) {
    throw new Error(String(payload?.operatorMessage ??
      "No pudimos completar esta acción visual."))
  }
  return payload
}

function SourceGallery({ task }: { task: VisualTask }) {
  const sources = task.sourceImages.filter((source) => source.url)
  return <div>
    <h4 className="text-sm font-semibold text-[#343834]">Imágenes fuente autorizadas</h4>
    <p className="mt-1 text-xs leading-5 text-[#6f736c]">Carga estas imágenes originales en la conversación nueva de ChatGPT. Vuelve a usarlas como referencia en cada generación.</p>
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {sources.map((source) => <figure key={source.referenceId}
        className="overflow-hidden rounded-2xl border border-[#ddd5ca] bg-white p-2">
        <img src={source.url ?? ""} alt="Imagen fuente autorizada del producto"
          className="aspect-square w-full rounded-xl object-contain" />
        <figcaption className="mt-2 truncate text-[10px] text-[#777a73]">Fuente {source.position + 1}</figcaption>
        <a href={source.url ?? ""} target="_blank" rel="noreferrer"
          className="mt-2 block text-xs font-semibold text-[#1d5961] underline">Abrir fuente</a>
      </figure>)}
    </div>
  </div>
}

function HumanQa({ task, output, busy, onDone }: {
  task: VisualTask
  output: VisualOutput
  busy: boolean
  onDone: () => Promise<void>
}) {
  const baseChecks = useMemo(() => [
    ["productIdentityPreserved", "Es el mismo producto"],
    ["colorPreserved", "Conserva el color"],
    ["shapePreserved", "Conserva la forma"],
    ["partCountPreserved", "Conserva la cantidad de piezas"],
    ["visibleLogosPreserved", "Conserva correctamente los logos visibles"],
    ["noInventedAccessories", "No inventa accesorios"],
    ["noUnsupportedClaims", "No agrega promesas no comprobadas"],
    ["noUnauthorizedText", "No agrega texto no autorizado"],
    ["roleMatchesOutput", `Sí corresponde a: ${labels[output.mayel_output_role]}`],
    ...(output.mayel_output_role === "DIMENSIONS" ? [[
      "dimensionTextMatchesProductTruth", "Las dimensiones coinciden con la verdad certificada del producto",
    ]] : []),
  ] as string[][], [output.mayel_output_role])
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [reason, setReason] = useState("")
  const [message, setMessage] = useState("")
  const complete = baseChecks.every(([key]) => checks[key] === true)

  async function submit(decision: "APPROVE" | "REJECT") {
    setMessage("")
    try {
      await visualRequest("/api/admin/ebay/mayel-visual-workstation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REVIEW_OUTPUT",
          visualTaskId: task.visualTaskId, assetId: output.id, decision,
          humanQa: decision === "APPROVE" ? checks : undefined,
          rejectionReason: decision === "REJECT" ? reason : undefined }),
      })
      await onDone()
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "No pudimos guardar la revisión.")
    }
  }

  return <article className="rounded-2xl border border-[#ddd5ca] bg-white p-4">
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#74866d]">Original</p>
        <img src={task.currentImages[0] ?? ""}
          alt="Imagen fuente original del producto"
          className="mt-2 aspect-square w-full rounded-xl bg-[#f4efe7] object-contain" />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#1d5961]">Resultado ChatGPT · {labels[output.mayel_output_role]}</p>
        <img src={output.previewUrl ?? ""} alt="Resultado subido por Mayel"
          className="mt-2 aspect-square w-full rounded-xl bg-[#f4efe7] object-contain" />
      </div>
    </div>
    {output.status === "pending_review" && <div className="mt-4">
      <p className="text-sm font-semibold">Comparación humana obligatoria</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">{baseChecks.map(([key, label]) =>
        <label key={key} className="flex min-h-11 items-start gap-2 rounded-xl bg-[#f4efe7] p-3 text-xs leading-5">
          <input type="checkbox" checked={checks[key] === true}
            onChange={(event) => setChecks((current) => ({ ...current,
              [key]: event.target.checked }))} className="mt-1" />{label}
        </label>)}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><label className="text-xs font-semibold" htmlFor={`reason-${output.id}`}>Si la rechazas</label>
          <select id={`reason-${output.id}`} value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-[#cfc7ba] bg-white px-3 text-sm">
            <option value="">Elige una razón</option>
            {rejectionReasons.map(([value, label]) => <option key={value}
              value={value}>{label}</option>)}
          </select></div>
        <div className="flex items-end gap-2">
          <button type="button" disabled={busy || !reason}
            onClick={() => void submit("REJECT")}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[#b75d43] px-3 text-sm font-semibold text-[#8b4937] disabled:opacity-40"><X className="h-4 w-4" />Rechazar</button>
          <button type="button" disabled={busy || !complete}
            onClick={() => void submit("APPROVE")}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#1d5961] px-3 text-sm font-semibold text-white disabled:opacity-40"><Check className="h-4 w-4" />Aprobar</button>
        </div>
      </div>
      {message && <p className="mt-3 text-sm text-[#8b4937]">{message}</p>}
    </div>}
    {output.status === "approved" && <p className="mt-4 rounded-xl bg-[#e3ebe1] p-3 text-sm font-semibold text-[#425143]">Control de calidad aprobado por Mayel · recurso canónico creado ✓</p>}
    {output.status === "rejected" && <p className="mt-4 rounded-xl bg-[#f7e9de] p-3 text-sm font-semibold text-[#704d3c]">Resultado rechazado</p>}
  </article>
}

function UploadPanel({ task, busy, onDone }: { task: VisualTask;
  busy: boolean; onDone: () => Promise<void> }) {
  const [uploads, setUploads] = useState<{ file: File; role: VisualRole }[]>([])
  const [rights, setRights] = useState(false)
  const [message, setMessage] = useState("")
  const availableSlots = task.promptSlots.filter((slot) =>
    slot.status === "READY" && !task.outputs.some((output) =>
      output.mayel_output_role === slot.role && output.status !== "rejected"))

  const selectionValid = uploads.length > 0 &&
    new Set(uploads.map((entry) => entry.role)).size === uploads.length &&
    uploads.every((entry) => availableSlots.some((slot) =>
      slot.role === entry.role))

  async function upload() {
    if (!rights || !selectionValid) return
    setMessage("")
    try {
      for (const entry of uploads) {
        const form = new FormData()
        form.set("action", "UPLOAD_OUTPUT")
        form.set("visualTaskId", task.visualTaskId)
        form.set("outputRole", entry.role)
        form.set("rightsConfirmed", "true")
        form.set("file", entry.file)
        await visualRequest("/api/admin/ebay/mayel-visual-workstation",
          { method: "POST", body: form })
      }
      setUploads([])
      setRights(false)
      await onDone()
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "No pudimos subir esta imagen.")
    }
  }

  if (!availableSlots.length) return null
  return <section className="rounded-2xl border border-dashed border-[#1d5961]/45 bg-[#f0f5f3] p-5">
    <div className="flex items-center gap-2"><Upload className="h-5 w-5 text-[#1d5961]" />
      <h4 className="font-semibold">Subir imágenes creadas por Mayel</h4></div>
    <p className="mt-2 text-sm leading-6 text-[#5f645e]">El producto ya está ligado por la tarea. No escribas un SKU. Cada archivo entra primero a cuarentena privada.</p>
    <label className="mt-4 block rounded-xl border-2 border-dashed border-[#1d5961]/35 bg-white p-4 text-xs font-semibold">Arrastra o elige hasta seis archivos JPG, PNG o WebP
      <input type="file" multiple accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const chosen = Array.from(event.target.files ?? [])
            .slice(0, Math.min(6, availableSlots.length))
          setUploads(chosen.map((file, index) => ({ file,
            role: availableSlots[index]?.role ?? "DETAIL" })))
        }}
        className="mt-2 block min-h-12 w-full rounded-xl border border-[#cfc7ba] bg-white p-2 text-sm" />
    </label>
    {uploads.length > 0 && <div className="mt-3 space-y-2">{uploads.map((entry, index) =>
      <div key={`${entry.file.name}-${index}`}
        className="grid gap-2 rounded-xl bg-white p-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
        <span className="truncate text-xs text-[#555a54]">{entry.file.name}</span>
        <select value={entry.role} onChange={(event) =>
          setUploads((current) => current.map((candidate, candidateIndex) =>
            candidateIndex === index ? { ...candidate,
              role: event.target.value as VisualRole } : candidate))}
          className="min-h-11 rounded-xl border border-[#cfc7ba] bg-white px-3 text-sm">
          {availableSlots.map((slot) => <option key={slot.role}
            value={slot.role}>{labels[slot.role]}</option>)}
        </select>
      </div>)}</div>}
    {uploads.length > 1 && !selectionValid && <p className="mt-2 text-xs font-semibold text-[#8b4937]">Asigna un tipo distinto a cada archivo.</p>}
    <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-[#555a54]">
      <input type="checkbox" checked={rights}
        onChange={(event) => setRights(event.target.checked)} className="mt-1" />
      Confirmo que este archivo fue creado en mi propia suscripción de ChatGPT para esta tarea y puedo subirlo a Seller OS.
    </label>
    <button type="button" disabled={busy || !rights || !selectionValid}
      onClick={() => void upload()}
      className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#1d5961] px-4 text-sm font-semibold text-white disabled:opacity-40"><Upload className="h-4 w-4" />Subir a cuarentena</button>
    {message && <p className="mt-3 text-sm text-[#8b4937]">{message}</p>}
  </section>
}

function OwnerPreview({ task, canOwnerAuthorize, busy, onDone }: {
  task: VisualTask
  canOwnerAuthorize: boolean
  busy: boolean
  onDone: () => Promise<void>
}) {
  const [message, setMessage] = useState("")
  if (!task.visualManifest) return null
  const phaseB = task.phaseB
  const proposed = Array.isArray(task.visualManifest.proposedOrderedImages)
    ? task.visualManifest.proposedOrderedImages as Record<string, unknown>[] : []
  const factEntries = ["productType", "brand", "color", "materialsProven",
    "packageContentsProven", "quantityOrPackCount", "dimensionsProven",
    "allowedProductBenefits", "allowedUseCases"].flatMap((key) => {
      const values = Array.isArray(task.evidencePack[key])
        ? task.evidencePack[key] as unknown[] : []
      return values.length ? [`${key}: ${values.join(" · ")}`] : []
    })
  async function authorize() {
    if (!phaseB?.ownerCtaAvailable || !phaseB.visualManifestDigest) return
    setMessage("")
    try {
      await visualRequest("/api/admin/ebay/mayel-visual-workstation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPLY_VISUAL_MANIFEST",
          visualTaskId: task.visualTaskId,
          visualManifestDigest: phaseB.visualManifestDigest,
          confirmation: "AUTORIZAR ACTUALIZACION DE IMAGENES" }),
      })
      await onDone()
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "No se pudo ejecutar la actualización autorizada.")
    }
  }
  async function rebasePreview() {
    const digest = phaseB?.visualManifestDigest ?? task.visualManifestDigest
    if (!phaseB?.safeRebaseAvailable || !digest) return
    setMessage("")
    try {
      await visualRequest("/api/admin/ebay/mayel-visual-workstation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REBASE_VISUAL_MANIFEST",
          visualTaskId: task.visualTaskId,
          expectedVisualManifestDigest: digest }),
      })
      await onDone()
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "No se pudo actualizar la vista previa con el estado vigente de eBay.")
    }
  }
  const phase = phaseB?.execution?.phase
  const applied = phaseB?.execution?.appliedAndOfficiallyVerified === true
  return <section className="rounded-2xl border border-[#74866d]/35 bg-[#f4f7f1] p-5">
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#617159]">Vista previa del owner · publicación activa</p>
    <h4 className="mt-2 font-serif text-xl font-semibold">Imágenes actuales y propuesta</h4>
    <p className="mt-2 text-sm text-[#5f645e]">Item {task.ebayItemId} · {task.productTitle}</p>
    <p className="mt-2 text-sm text-[#5f645e]">Campos que cambiarían: imágenes solamente. La imagen principal actual permanece protegida.</p>
    <p className="mt-2 text-xs text-[#617159]">Control de calidad de Mayel: {task.outputs.filter((output) => output.status === "approved").length} aprobada(s) · aprobación del owner pendiente.</p>
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{proposed.map((entry, index) =>
      <figure key={`${entry.assetId ?? "current"}-${index}`}
        className="rounded-xl border border-[#d6dfd1] bg-white p-2">
        <img src={String(entry.publicUrl ?? "")} alt="Imagen propuesta para revisión del owner"
          className="aspect-square w-full rounded-lg object-contain" />
        <figcaption className="mt-2 text-[10px] font-semibold text-[#617159]">{index === 0 ? "Principal actual · preservada" : labels[entry.role as VisualRole] ?? "Secundaria actual"}</figcaption>
      </figure>)}</div>
    <div className="mt-4 grid gap-2 rounded-xl bg-white p-3 text-xs text-[#5f645e] sm:grid-cols-2">
      <p>Cuenta: {phaseB?.account ?? "Cuenta eBay vinculada"}</p>
      <p>Marketplace: {phaseB?.marketplace ?? "EBAY_US"}</p>
      <p>Modelo de gestión: {phaseB?.managementModel ?? "Por verificar"}</p>
      <p>Imagen principal protegida: {phaseB?.mainImageProtected === false ? "No" : "Sí"}</p>
    </div>
    {phaseB?.managementModel === "MANAGEMENT_MODEL_UNPROVEN" &&
      <details className="mt-3 rounded-xl bg-white p-3 text-xs text-[#5f645e]">
        <summary className="cursor-pointer font-semibold">Por qué el modelo de gestión sigue pendiente</summary>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          <p>Inventory Item: {phaseB.managementDiagnostics?.inventoryItemPresent
            ? "encontrado" : phaseB.managementDiagnostics?.inventoryItemAuthoritativelyAbsent
              ? "ausencia confirmada" : "lectura no concluyente"}</p>
          <p>Inventory HTTP: {phaseB.managementDiagnostics?.inventoryHttpStatus ?? "sin lectura"}</p>
          <p>Offers: {phaseB.managementDiagnostics?.offersReadComplete
            ? "lectura completa" : "lectura no concluyente"}</p>
          <p>Offers HTTP: {phaseB.managementDiagnostics?.offersHttpStatus ?? "sin lectura"}</p>
          <p>Offer publicado exacto: {phaseB.managementDiagnostics?.exactPublishedOfferCount ?? 0}</p>
          <p>Grupo de variantes: {phaseB.managementDiagnostics?.groupedInventoryItem ? "sí" : "no"}</p>
        </div>
      </details>}
    <p className="mt-4 break-all text-[10px] text-[#777a73]">Manifest: {phaseB?.visualManifestDigest ?? task.visualManifestDigest}</p>
    {factEntries.length > 0 && <details className="mt-3 rounded-xl bg-white p-3 text-xs text-[#5f645e]">
      <summary className="cursor-pointer font-semibold">Verdad certificada del producto utilizada</summary>
      <ul className="mt-2 space-y-1">{factEntries.map((entry) =>
        <li key={entry}>{entry}</li>)}</ul>
    </details>}
    {canOwnerAuthorize && !phase && <button type="button"
      disabled={busy || phaseB?.ownerCtaAvailable !== true}
      onClick={() => void authorize()}
      className="mt-4 min-h-12 w-full rounded-xl bg-[#1d5961] px-4 text-sm font-semibold text-white disabled:opacity-40">
      Autorizar actualización de imágenes
    </button>}
    {canOwnerAuthorize && !phase && phaseB?.safeRebaseAvailable &&
      <button type="button" disabled={busy}
        onClick={() => void rebasePreview()}
        className="mt-3 min-h-12 w-full rounded-xl border border-[#1d5961] bg-white px-4 text-sm font-semibold text-[#1d5961] disabled:opacity-40">
        Actualizar vista previa con las imágenes vigentes de eBay
      </button>}
    {canOwnerAuthorize && !phase && phaseB?.mayelAssetPreserved &&
      <p className="mt-2 text-xs text-[#617159]">La imagen aprobada por Mayel permanece conservada; no requiere volver a subirla ni aprobarla.</p>}
    {phase && <p className={`mt-4 rounded-xl p-3 text-sm font-semibold ${applied ? "bg-[#e3ebe1] text-[#425143]" : "bg-[#f7e9de] text-[#704d3c]"}`}>
      {applied ? "Imágenes aplicadas y verificadas oficialmente ✓" :
        `Estado de la actualización: ${phase.replaceAll("_", " ")}`}
    </p>}
    {canOwnerAuthorize && !phaseB?.ownerCtaAvailable && !phase &&
      <p className="mt-3 text-xs font-semibold text-[#704d3c]">La actualización permanece bloqueada de forma segura: {phaseB?.blocker ?? "preflight no disponible"}.</p>}
    {!canOwnerAuthorize && <p className="mt-2 text-xs font-semibold text-[#704d3c]">Mayel prepara y aprueba los recursos. La decisión final pertenece al owner.</p>}
    {message && <p className="mt-3 text-sm text-[#8b4937]">{message}</p>}
  </section>
}

export function MayelVisualWorkstation({ canOperate, canOwnerAuthorize = false }: {
  canOperate: boolean
  canOwnerAuthorize?: boolean
}) {
  const [tasks, setTasks] = useState<VisualTask[]>([])
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState("")
  const [canaryAvailable, setCanaryAvailable] = useState<boolean | null>(null)

  const load = useCallback(async () => {
    const payload = await visualRequest(
      "/api/admin/ebay/mayel-visual-workstation")
    const workstation = payload.workstation as { tasks?: VisualTask[] } | undefined
    setTasks(workstation?.tasks ?? [])
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      setBusy(true)
      try {
        if (canOperate) {
          const result = await visualRequest(
            "/api/admin/ebay/mayel-visual-workstation", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "ENSURE_NEXT_TASK" }),
            })
          if (active) setCanaryAvailable(
            result.phaseACanaryAvailable === true)
        }
        await load()
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message :
          "No pudimos abrir la estación visual.")
      } finally {
        if (active) setBusy(false)
      }
    })()
    return () => { active = false }
  }, [canOperate, load])

  async function refresh() {
    setBusy(true)
    try { await load(); setMessage("") }
    catch (error) { setMessage(error instanceof Error ? error.message :
      "No pudimos actualizar.") }
    finally { setBusy(false) }
  }

  return <section aria-labelledby="visual-workstation-heading">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1d5961]">Operación visual humana</p>
    <h2 id="visual-workstation-heading" className="mt-2 font-serif text-3xl font-semibold">Estación visual</h2>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-[#64675f]">Seller OS prepara la evidencia y el prompt. Tú generas las imágenes manualmente en tu propia suscripción de ChatGPT y las devuelves aquí para revisión segura.</p>
    <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
      <span className="rounded-full bg-[#e3ebe1] px-3 py-2 text-[#425143]">ChatGPT manual</span>
      <span className="rounded-full bg-[#e3ebe1] px-3 py-2 text-[#425143]">Cero API de imágenes</span>
      <span className="rounded-full bg-[#f7e9de] px-3 py-2 text-[#704d3c]">eBay sólo con autorización owner</span>
    </div>
    {message && <p className="mt-4 rounded-xl bg-[#f7e9de] p-4 text-sm text-[#704d3c]">{message}</p>}
    {!busy && !tasks.length && <div className="mt-6 rounded-[28px] border border-[#d9d1c4] bg-[#fffdf8] p-7">
      <h3 className="font-serif text-2xl font-semibold">No hay una oportunidad visual lista</h3>
      <p className="mt-2 text-sm leading-6 text-[#64675f]">Seller OS no fabricará una tarea. Aparecerá aquí cuando una publicación activa tenga identidad, verdad del producto, imágenes autorizadas y una oportunidad visual demostrada.</p>
      {canaryAvailable === false && <p className="mt-3 text-xs font-semibold text-[#74866d]">Prueba física de Fase A no disponible por ahora.</p>}
    </div>}
    <div className="mt-6 space-y-7">{tasks.map((task) => <article
      key={task.visualTaskId}
      className="rounded-[28px] border border-[#d9d1c4] bg-[#fffdf8] p-5 shadow-[0_18px_50px_rgba(55,45,32,0.07)] sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#74866d]">Tarea visual · {task.sku}</p>
          <h3 className="mt-2 font-serif text-2xl font-semibold">{task.productTitle}</h3>
          <p className="mt-1 text-xs text-[#777a73]">Publicación eBay {task.ebayItemId}</p></div>
        <span className="rounded-full bg-[#e3ebe1] px-3 py-2 text-xs font-semibold text-[#425143]">{task.status === "OWNER_PREVIEW_READY" ? "Lista para vista previa del owner" : "Trabajo de Mayel"}</span>
      </div>
      <div className="mt-6"><SourceGallery task={task} /></div>
      {canOperate && <section className="mt-6 rounded-2xl bg-[#26312d] p-5 text-white">
        <div className="flex items-start gap-3"><Clipboard className="mt-1 h-5 w-5 shrink-0 text-[#acd2ca]" />
          <div><h4 className="font-semibold">Prompt individual listo para copiar</h4>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-white/70">
              <li>Abre una conversación nueva en ChatGPT para este producto.</li>
              <li>Carga únicamente las imágenes fuente proporcionadas por Seller OS.</li>
              <li>Copia y pega este prompt completo.</li>
              <li>Compara cada resultado contra las imágenes originales antes de aprobarlo.</li>
            </ol></div></div>
        <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-black/20 p-4 text-xs leading-5 text-white/85">{task.prompt}</pre>
        <button type="button" onClick={() => void navigator.clipboard.writeText(task.prompt)}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[#26312d]"><Clipboard className="h-4 w-4" />Copiar prompt</button>
      </section>}
      <div className="mt-6 grid gap-2 sm:grid-cols-3">{task.promptSlots.map((slot) =>
        <div key={slot.role} className={`rounded-xl p-3 text-xs ${slot.status === "READY" ? "bg-[#e3ebe1] text-[#425143]" : "bg-[#eee9e1] text-[#777a73]"}`}>
          <strong>{labels[slot.role]}</strong><span className="mt-1 block">{slot.status === "READY" ? "Lista" : "Bloqueada: falta evidencia"}</span>
        </div>)}</div>
      {canOperate && <div className="mt-6"><UploadPanel task={task} busy={busy}
        onDone={refresh} /></div>}
      {task.outputs.length > 0 && <section className="mt-7">
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-[#1d5961]" />
          <h4 className="font-semibold">Control de calidad y revisión de Mayel</h4></div>
        <div className="mt-4 space-y-4">{task.outputs.map((output) =>
          <HumanQa key={output.id} task={task} output={output} busy={busy}
            onDone={refresh} />)}</div>
      </section>}
      <div className="mt-6"><OwnerPreview task={task}
        canOwnerAuthorize={canOwnerAuthorize} busy={busy} onDone={refresh} /></div>
      <details className="mt-5 rounded-xl border border-[#e0d9ce] p-3 text-xs text-[#6f736c]">
        <summary className="cursor-pointer py-2 font-semibold">Provenance técnica</summary>
        <p className="mt-2 break-all">Visual Task ID: {task.visualTaskId}</p>
        <p className="mt-1 break-all">Product Truth: {task.productTruthDigest}</p>
        <p className="mt-1 break-all">Source set: {task.sourceImageSetDigest}</p>
        <p className="mt-1">Prompt: {task.promptVersion}</p>
      </details>
    </article>)}</div>
    {busy && <p className="mt-6 rounded-2xl border border-[#d9d1c4] bg-[#fffdf8] p-6 text-sm text-[#6f736c]">Preparando la estación visual…</p>}
    <footer className="mt-7 rounded-2xl border border-[#d6bca8] bg-[#f7e9de] p-4 text-xs leading-5 text-[#704d3c]">
      La imagen principal sigue protegida. La Fase B sólo puede cambiar imágenes después de una autorización owner exacta y de una lectura oficial concordante.
    </footer>
  </section>
}
