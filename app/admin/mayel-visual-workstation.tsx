"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Clipboard, ShieldCheck, Upload, X } from
  "lucide-react"

import { supabase } from "@/lib/supabase"
import type { MayelCommercialIntelligenceV1 } from
  "@/lib/ebay/ebay-mayel-commercial-intelligence-v1"

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
    managementObservedAt?: string
    accountIdentityProven?: boolean
    listingIdentityProven?: boolean
    correctEbayApi?: "INVENTORY_API" | "TRADING_API" | null
    correctEbayApiResolved?: boolean
    officialReadStatus?: "PASS" | "FAILED"
    officialReadFailureClass?: string | null
    currentImageSetProven?: boolean
    mayelManifestValid?: boolean
    visualOnlyDiff?: boolean
    unauthorizedFieldDiffCount?: number | null
    safeToExecuteVisualChange?: boolean
    readyForMayelPhysicalCanary?: boolean
    applicationStatus?: "WAITING_FOR_EBAY" | "READY" | "BLOCKED"
    applicationReason?: string | null
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
    accountIdentityCurrent?: boolean
    accountIdentityAuthority?: { status?: string; sourceAuthority?: string;
      observedAt?: string } | null
    legacyAccountMismatchSuppressed?: boolean
    historicalBlocker?: string | null
    executorCredentialProfileReady?: boolean
    execution?: { executionId?: string; phase?: string;
      marketplaceWriteCount?: number; appliedAndOfficiallyVerified?: boolean } | null
  }
}

type DelegationPredicate = {
  code: string
  pass: boolean | null
  requiredForDelegation: boolean
  humanMessage: string
}

type VisualDelegation = {
  authorizationButtonRendered: boolean
  authorizationButtonDisabled: boolean
  authorizationButtonEnabled: boolean
  disableReason: string | null
  firstBlockingPredicate: string | null
  predicates: DelegationPredicate[]
  fullVisualDelegationActive: boolean
  active: { status: string; ownerConfirmedAt: string | null;
    mainImageAuthority: boolean; ownerPerImageApproval: boolean;
    ownerPerListingVisualApproval: boolean } | null
  scope: { allowedActions: string[]; forbiddenActions: string[];
    mainImageAuthority: boolean; ownerPerImageApproval: boolean;
    ownerPerListingVisualApproval: boolean }
  taskExecutionReadinessIsSeparate: boolean
  globalDelegationEligible: boolean
  globalAccountIdentityProven: boolean
  authorityStorageReady: boolean
  revocationReady: boolean
  accountIdentity: { status: string; sourceAuthority: string;
    observedAt: string; marketplaceId: string; liveReadStatus?: string;
    liveReadFailureClass?: string | null } | null
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

const visualScopeLabels: Record<string, string> = {
  MAIN_IMAGE: "imagen principal",
  SECONDARY_IMAGES: "imágenes secundarias",
  IMAGE_REPLACEMENT: "sustituir imágenes",
  IMAGE_REMOVAL: "retirar imágenes",
  IMAGE_REORDER: "orden visual",
  CROP: "recorte",
  BACKGROUND: "fondo",
  LIGHTING: "iluminación",
  COLOR_CORRECTION: "corrección de color",
  QUALITY_ENHANCEMENT: "mejora de calidad",
  DETAIL_IMAGES: "imágenes de detalle",
  SCALE_IMAGES: "imágenes de escala",
  LIFESTYLE_IMAGES: "imágenes de contexto",
  PACKAGE_CONTENT_IMAGES: "contenido del paquete",
  VISUAL_SEQUENCE_OPTIMIZATION: "secuencia visual",
  LIVE_LISTING_VISUAL_OPTIMIZATION: "optimización visual de listings LIVE",
}

const authorityCheckLabels: Record<string, string> = {
  OWNER_AUTHENTICATED: "Sesión owner",
  ACCOUNT_IDENTITY_PROVEN: "Cuenta eBay",
  MAYEL_WORKSPACE_READY: "Workspace Mayel",
  DELEGATION_SCOPE_VALID: "Alcance visual",
  AUTHORITY_STORAGE_READY: "Persistencia de autoridad",
  REVOCATION_READY: "Revocación",
}

type TaskCommercialTab = "VISUAL" | "MERCADO" | "RENTABILIDAD" |
  "RECOMENDACIONES"

function commercialMoney(value: number | null) {
  return value === null ? "Por comprobar" : new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
  }).format(value)
}

function commercialDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Por comprobar"
  return new Intl.DateTimeFormat("es-NI", { dateStyle: "medium",
    timeZone: "America/Managua" }).format(new Date(value))
}

function TaskCommercialContext({ intelligence }: {
  intelligence?: MayelCommercialIntelligenceV1
}) {
  const [tab, setTab] = useState<TaskCommercialTab>("VISUAL")
  const tabs = [["VISUAL", "Visual"], ["MERCADO", "Mercado"],
    ["RENTABILIDAD", "Rentabilidad"],
    ["RECOMENDACIONES", "Recomendaciones eBay"]] as const
  const position: Record<string, string> = {
    DENTRO_DEL_MERCADO: "Dentro del mercado",
    POR_ENCIMA_DEL_MERCADO: "Por encima del mercado",
    POR_DEBAJO_DEL_MERCADO: "Por debajo del mercado",
    MERCADO_POR_COMPROBAR: "Mercado por comprobar",
    EVIDENCIA_VENCIDA: "Evidencia vencida",
  }
  return <section className="mt-6 rounded-2xl border border-[#cbd9d4] bg-[#f8fbf9] p-4"
    data-commercial-feed-blocks-visual="false">
    <div className="flex flex-wrap gap-2" role="tablist"
      aria-label="Contexto comercial de la tarea visual">
      {tabs.map(([key, label]) => <button key={key} type="button"
        role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
        className={`min-h-11 rounded-xl px-3 text-xs font-semibold ${
          tab === key ? "bg-[#1d5961] text-white" :
            "border border-[#d9e2de] bg-white text-[#4f5b55]"}`}>
        {label}
      </button>)}
    </div>
    {tab === "VISUAL" && <div className="mt-4 text-sm leading-6 text-[#4f5752]">
      <p className="font-semibold text-[#292d29]">Estación visual disponible</p>
      <p>La falta temporal de datos comerciales no bloquea upload, QA ni preparación del manifest.</p>
    </div>}
    {tab === "MERCADO" && <div className="mt-4 space-y-3 text-sm text-[#4f5752]">
      {!intelligence ? <p className="rounded-xl bg-white p-3">Mercado por comprobar. La autoridad comercial LIVE no está disponible ahora; no se atribuye el problema a imágenes.</p> : <>
        <div className="grid gap-2 sm:grid-cols-2">
          <p className="rounded-xl bg-white p-3">Última revisión<br/><strong>{commercialDate(intelligence.market.lastResearchAt)}</strong></p>
          <p className="rounded-xl bg-white p-3">Comparables vendidos<br/><strong>{intelligence.market.soldComparableCount ?? "Por comprobar"}</strong></p>
          <p className="rounded-xl bg-white p-3">Rango sold<br/><strong>{intelligence.market.soldPriceMinimum === null || intelligence.market.soldPriceMaximum === null ? "Por comprobar" : `${commercialMoney(intelligence.market.soldPriceMinimum)}–${commercialMoney(intelligence.market.soldPriceMaximum)}`}</strong></p>
          <p className="rounded-xl bg-white p-3">Posición del precio<br/><strong>{position[intelligence.pricePosition.status] ?? "Mercado por comprobar"}</strong></p>
        </div>
        <p className="rounded-xl bg-[#edf3f1] p-3">{intelligence.interpretation.explanation}</p>
      </>}
      <button type="button" disabled
        title="El enlace durable desde un listing LIVE al plan Product Research aún no está comprobado"
        className="min-h-11 rounded-xl border border-[#1d5961]/30 px-4 font-semibold text-[#1d5961] opacity-55">
        Revalidar mercado
      </button>
      <p className="text-xs">Solicitud visible; ejecución cerrada hasta comprobar el conector durable. Seller OS elegirá queries, páginas y filtros.</p>
    </div>}
    {tab === "RENTABILIDAD" && <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      {[["Precio LIVE", intelligence?.economics.livePrice.value ?? null],
        ["Costo proveedor", intelligence?.economics.supplierCost.value ?? null],
        ["Shipping", intelligence?.economics.shippingCost.value ?? null],
        ["Fees eBay", intelligence?.economics.ebayFees.value ?? null],
        ["Otros/reservas", intelligence?.economics.otherCostsOrReserves.value ?? null],
        ["Profit esperado", intelligence?.economics.expectedProfit.value ?? null],
        ["Margen", intelligence?.economics.marginPercent.value ?? null],
        ["ROI", intelligence?.economics.roi.value ?? null]].map(([label, value]) =>
        <p key={String(label)} className="rounded-xl bg-white p-3">
          <span className="text-xs text-[#73766f]">{label}</span><br/>
          <strong>{["Margen", "ROI"].includes(String(label)) && value !== null
            ? `${value}%` : commercialMoney(value as number | null)}</strong>
        </p>)}
    </div>}
    {tab === "RECOMENDACIONES" && <div className="mt-4 space-y-2 text-sm text-[#4f5752]">
      {(intelligence?.ebayRecommendations.officialListingQuality ?? []).map(
        (row, index) => <article key={`${row.type}-${index}`}
          className="rounded-xl bg-white p-3">
          <strong>{row.category}</strong><p>{row.exactPlatformWording ??
            "eBay no proporcionó texto adicional."}</p>
          <p className="mt-1 text-xs">Señal oficial; no autoriza ejecución.</p>
        </article>)}
      {!intelligence?.ebayRecommendations.officialListingQuality.length &&
        <p className="rounded-xl bg-white p-3">No hay una recomendación oficial exacta disponible para esta tarea ahora.</p>}
      <p className="text-xs">Recomendación eBay ≠ Product Truth ≠ autoridad para cambiar precio, promoción u ofertas.</p>
    </div>}
  </section>
}

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

function evidenceValues(pack: Record<string, unknown>, key: string) {
  const value = pack[key]
  return Array.isArray(value)
    ? value.map(String).map((entry) => entry.trim()).filter(Boolean)
    : typeof value === "string" && value.trim() ? [value.trim()] : []
}

function OwnerPreview({ task, canOwnerAuthorize, delegation }: {
  task: VisualTask
  canOwnerAuthorize: boolean
  delegation: VisualDelegation | null
}) {
  if (!task.visualManifest) return null
  const phaseB = task.phaseB
  const proposed = Array.isArray(task.visualManifest.proposedOrderedImages)
    ? task.visualManifest.proposedOrderedImages as Record<string, unknown>[] : []
  const factRows = [
    { label: "Producto", values: [task.productTitle] },
    { label: "Variante exacta",
      values: evidenceValues(task.evidencePack, "lunaVariantId") },
    { label: "Tipo",
      values: evidenceValues(task.evidencePack, "productType") },
    { label: "Marca", values: evidenceValues(task.evidencePack, "brand") },
    { label: "Color", values: evidenceValues(task.evidencePack, "color") },
    { label: "Material",
      values: evidenceValues(task.evidencePack, "materialsProven") },
    { label: "Contenido del paquete",
      values: evidenceValues(task.evidencePack, "packageContentsProven") },
    { label: "Dimensiones",
      values: evidenceValues(task.evidencePack, "dimensionsProven") },
  ]
  const delegationActive = delegation?.fullVisualDelegationActive === true
  const accountIdentityCurrent =
    phaseB?.accountIdentityProven === true ||
    delegation?.globalAccountIdentityProven === true
  const phase = phaseB?.execution?.phase
  const applied = phaseB?.execution?.appliedAndOfficiallyVerified === true
  return <section className="rounded-2xl border border-[#74866d]/35 bg-[#f4f7f1] p-5">
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#617159]">Vista previa del owner · publicación activa</p>
    <h4 className="mt-2 font-serif text-xl font-semibold">Imágenes actuales y propuesta</h4>
    <p className="mt-2 text-sm text-[#5f645e]">Item {task.ebayItemId} · {task.productTitle}</p>
    <p className="mt-2 text-sm text-[#5f645e]">Campos que cambiarían: imágenes solamente. La propuesta histórica conserva la principal actual; la delegación global también permite que Mayel proponga sustituirla.</p>
    <p className="mt-2 text-xs text-[#617159]">Control de calidad de Mayel: {task.outputs.filter((output) => output.status === "approved").length} aprobada(s) · {delegationActive ? "cubierta por delegación visual global" : "esperando delegación visual global"}.</p>
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{proposed.map((entry, index) =>
      <figure key={`${entry.assetId ?? "current"}-${index}`}
        className="rounded-xl border border-[#d6dfd1] bg-white p-2">
        <img src={String(entry.publicUrl ?? "")} alt="Imagen propuesta para revisión del owner"
          className="aspect-square w-full rounded-lg object-contain" />
        <figcaption className="mt-2 text-[10px] font-semibold text-[#617159]">{index === 0 ? "Principal actual · conservada en esta propuesta" : labels[entry.role as VisualRole] ?? "Secundaria actual"}</figcaption>
      </figure>)}</div>
    <div className="mt-4 grid gap-2 rounded-xl bg-white p-3 text-xs text-[#5f645e] sm:grid-cols-2">
      <p>Cuenta eBay: {accountIdentityCurrent ? "comprobada" : "por comprobar"}</p>
      <p>Marketplace: {phaseB?.marketplace ?? "EBAY_US"}</p>
      <p>Modelo de gestión: {phaseB?.managementModel === "INVENTORY_API_MANAGED"
        ? "Inventory API" : phaseB?.managementModel ===
          "TRADING_MANAGED" ? "Trading" : "por comprobar"}</p>
      <p>Imagen principal: {delegationActive
        ? "Mayel puede modificarla bajo delegación activa"
        : "incluida en la delegación visual pendiente"}</p>
    </div>
    <div className="mt-3 grid gap-2 rounded-xl border border-[#d6dfd1] bg-white p-3 text-xs text-[#5f645e] sm:grid-cols-2">
      <p>Identidad del listing: {phaseB?.listingIdentityProven
        ? "comprobada oficialmente" : "por comprobar"}</p>
      <p>API correcta: {phaseB?.correctEbayApi === "INVENTORY_API"
        ? "Inventory API" : phaseB?.correctEbayApi === "TRADING_API"
          ? "Trading API" : "por resolver"}</p>
      <p>Imágenes oficiales actuales: {phaseB?.currentImageSetProven
        ? "comprobadas" : "por comprobar"}</p>
      <p>Manifest de Mayel: {phaseB?.mayelManifestValid
        ? "listo" : "requiere reconciliación"}</p>
      <p>Cambio propuesto: {phaseB?.visualOnlyDiff
        && phaseB?.unauthorizedFieldDiffCount === 0
        ? "sólo visual · otros campos protegidos" : "no comprobado"}</p>
      <p>Aplicación en eBay: {phaseB?.applicationStatus === "WAITING_FOR_EBAY"
        ? "EN ESPERA" : phaseB?.applicationStatus === "READY"
          ? "LISTA" : "BLOQUEADA"}</p>
    </div>
    {phaseB?.applicationReason &&
      <p className="mt-3 rounded-xl bg-[#f7e9de] p-3 text-sm font-semibold text-[#704d3c]">
        {phaseB.applicationReason}
      </p>}
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
    <details className="mt-3 rounded-xl bg-white p-3 text-xs text-[#5f645e]">
      <summary className="cursor-pointer font-semibold">Verdad certificada del producto utilizada</summary>
      <ul className="mt-2 space-y-1">{factRows.map((entry) =>
        <li key={entry.label}><strong>{entry.label}:</strong>{" "}
          {entry.values.length ? entry.values.join(" · ") :
            `No hay evidencia suficiente para ${entry.label.toLowerCase()}.`}
        </li>)}</ul>
    </details>
    {canOwnerAuthorize && !phase && <p className="mt-4 rounded-xl bg-white p-3 text-sm text-[#5f645e]">
      La delegación visual general se administra arriba. Seller OS ejecutará
      esta propuesta sólo cuando la validación específica del listing esté
      completa; no necesitas aprobarla imagen por imagen.
    </p>}
    {canOwnerAuthorize && !phase && phaseB?.mayelAssetPreserved &&
      <p className="mt-2 text-xs text-[#617159]">La imagen aprobada por Mayel permanece conservada; no requiere volver a subirla ni aprobarla.</p>}
    {phase && <p className={`mt-4 rounded-xl p-3 text-sm font-semibold ${applied ? "bg-[#e3ebe1] text-[#425143]" : "bg-[#f7e9de] text-[#704d3c]"}`}>
      {applied ? "Imágenes aplicadas y verificadas oficialmente ✓" :
        `Estado de la actualización: ${phase.replaceAll("_", " ")}`}
    </p>}
    {canOwnerAuthorize && !phaseB?.ownerCtaAvailable && !phase &&
      !phaseB?.applicationReason &&
      <p className="mt-3 text-xs font-semibold text-[#704d3c]">
        {phaseB?.managementModel === "MANAGEMENT_MODEL_UNPROVEN"
          ? "Mayel puede trabajar la propuesta visual. Seller OS todavía debe comprobar cómo está gestionado este listing antes de aplicar cambios en eBay."
          : phaseB?.blocker === "MAYEL_VISUAL_CURRENT_OFFICIAL_IMAGE_SET_CHANGED"
            ? "Mayel puede trabajar la propuesta visual. Seller OS debe reconciliar primero el conjunto vigente de imágenes oficiales."
            : "La ejecución permanece bloqueada hasta completar la validación específica del listing."}
      </p>}
    {!canOwnerAuthorize && <p className="mt-2 text-xs font-semibold text-[#704d3c]">Mayel decide y aprueba los cambios visuales dentro de su delegación. Seller OS los valida y aplica de forma segura.</p>}
  </section>
}

function FullVisualDelegationPanel({ delegation, owner, busy, onDone }: {
  delegation: VisualDelegation | null
  owner: boolean
  busy: boolean
  onDone: () => Promise<void>
}) {
  const [message, setMessage] = useState("")
  const active = delegation?.fullVisualDelegationActive === true
  async function submit(action: "AUTHORIZE_FULL_VISUAL_DELEGATION" |
    "REVOKE_FULL_VISUAL_DELEGATION") {
    setMessage("")
    try {
      await visualRequest("/api/admin/ebay/mayel-visual-workstation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmation: action ===
          "AUTHORIZE_FULL_VISUAL_DELEGATION"
          ? "AUTORIZAR MAYEL CONTROL VISUAL"
          : "REVOCAR DELEGACION VISUAL DE MAYEL" }),
      })
      await onDone()
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "No pudimos guardar la delegación visual.")
    }
  }
  return <section className="mt-6 rounded-[28px] border border-[#b8c8bc] bg-[#f4f7f1] p-5 shadow-[0_18px_50px_rgba(55,45,32,0.06)] sm:p-7">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#617159]">Delegación owner</p>
        <h3 className="mt-2 font-serif text-2xl font-semibold">Control visual completo de Mayel</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#5f645e]">
          Una sola autorización reutilizable para que Mayel decida y prepare
          mejoras visuales. Seller OS conserva la validación del producto,
          la seguridad del listing y el readback oficial.
        </p>
      </div>
      <span className={`rounded-full px-3 py-2 text-xs font-semibold ${active
        ? "bg-[#dce9df] text-[#36533d]" : "bg-[#eee9e1] text-[#6f6253]"}`}>
        {active ? "DELEGACIÓN ACTIVA" : "ESPERANDO DELEGACIÓN"}
      </span>
    </div>
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl bg-white p-4">
        <h4 className="text-sm font-semibold">Mayel puede decidir</h4>
        <p className="mt-2 text-xs leading-5 text-[#64675f]">
          {(delegation?.scope.allowedActions ?? []).map((action) =>
            visualScopeLabels[action] ?? action).join(" · ") ||
            "Cargando alcance visual…"}
        </p>
      </div>
      <div className="rounded-2xl bg-white p-4">
        <h4 className="text-sm font-semibold">Siempre protegido</h4>
        <p className="mt-2 text-xs leading-5 text-[#64675f]">
          Precio, cantidad, categoría, condición, policies, identidad del
          producto, publicación, pedidos, mensajes, devoluciones y gasto.
        </p>
      </div>
    </div>
    <div className="mt-4 rounded-2xl border border-[#d6dfd1] bg-white p-4 text-sm">
      <p><strong>Imagen principal:</strong> incluida en la delegación visual.</p>
      <p className="mt-1"><strong>Aprobaciones rutinarias:</strong> no se pedirán por imagen ni por listing.</p>
      <p className="mt-1"><strong>Ejecución:</strong> cada cambio seguirá exigiendo producto/variante exactos, derechos, compliance, modelo de gestión y readback oficial.</p>
    </div>
    {!active && delegation?.disableReason && <p className="mt-4 rounded-xl bg-[#f7e9de] p-3 text-sm font-semibold text-[#704d3c]">
      {delegation.disableReason}
    </p>}
    {owner && !active && <button type="button"
      disabled={busy || delegation?.authorizationButtonEnabled !== true}
      onClick={() => void submit("AUTHORIZE_FULL_VISUAL_DELEGATION")}
      className="mt-4 min-h-12 w-full rounded-xl bg-[#1d5961] px-4 text-sm font-semibold text-white disabled:opacity-40">
      AUTORIZAR MAYEL · CONTROL VISUAL
    </button>}
    {owner && active && <button type="button" disabled={busy}
      onClick={() => void submit("REVOKE_FULL_VISUAL_DELEGATION")}
      className="mt-4 min-h-12 w-full rounded-xl border border-[#9a5a4a] bg-white px-4 text-sm font-semibold text-[#8b4937] disabled:opacity-40">
      Revocar delegación
    </button>}
    {!owner && <p className="mt-4 text-xs font-semibold text-[#704d3c]">
      Sólo el owner puede conceder o revocar esta delegación.
    </p>}
    <details className="mt-4 rounded-xl border border-[#d6dfd1] bg-white p-3 text-xs text-[#64675f]">
      <summary className="cursor-pointer font-semibold">Ver comprobaciones de autoridad</summary>
      <ul className="mt-3 space-y-2">{(delegation?.predicates ?? [])
        .map((predicate) => <li key={predicate.code}
          className="rounded-lg bg-[#f7f5f0] p-3">
          <span className="flex items-start justify-between gap-3">
            <strong>{authorityCheckLabels[predicate.code] ?? predicate.code}</strong>
            <span className="shrink-0 font-semibold">{predicate.pass === true
              ? predicate.code === "MAYEL_WORKSPACE_READY" ? "Listo"
                : predicate.code === "DELEGATION_SCOPE_VALID" ? "Válido"
                  : predicate.code === "AUTHORITY_STORAGE_READY" ? "Lista"
                    : predicate.code === "REVOCATION_READY" ? "Disponible"
                      : "Comprobada"
              : "Por comprobar"}</span>
          </span>
          {predicate.pass !== true && <span className="mt-1 block text-[#704d3c]">
            {predicate.humanMessage}
          </span>}
        </li>)}</ul>
    </details>
    {message && <p className="mt-3 text-sm text-[#8b4937]">{message}</p>}
  </section>
}

export function MayelVisualWorkstation({ canOperate,
  canOwnerAuthorize = false, commercialIntelligenceByItemId = {} }: {
  canOperate: boolean
  canOwnerAuthorize?: boolean
  commercialIntelligenceByItemId?: Readonly<Record<string,
    MayelCommercialIntelligenceV1>>
}) {
  const [tasks, setTasks] = useState<VisualTask[]>([])
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState("")
  const [canaryAvailable, setCanaryAvailable] = useState<boolean | null>(null)
  const [delegation, setDelegation] = useState<VisualDelegation | null>(null)

  const load = useCallback(async () => {
    const payload = await visualRequest(
      "/api/admin/ebay/mayel-visual-workstation")
    const workstation = payload.workstation as { tasks?: VisualTask[] } | undefined
    setTasks(workstation?.tasks ?? [])
    setDelegation((payload.delegation as VisualDelegation | undefined) ?? null)
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      setBusy(true)
      try {
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

  async function acquireNextDelegatedTask() {
    if (!canOperate || busy) return
    setBusy(true)
    setMessage("")
    try {
      const result = await visualRequest(
        "/api/admin/ebay/mayel-visual-workstation", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ENSURE_NEXT_TASK" }),
        })
      setCanaryAvailable(result.phaseACanaryAvailable === true)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "No pudimos reclamar el siguiente trabajo delegado.")
    } finally {
      setBusy(false)
    }
  }

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
    <FullVisualDelegationPanel delegation={delegation}
      owner={canOwnerAuthorize} busy={busy} onDone={refresh} />
    {canOperate && <button type="button"
      onClick={() => void acquireNextDelegatedTask()} disabled={busy}
      data-mayel-explicit-work-acquisition
      className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#1d5961] px-4 text-sm font-semibold text-white disabled:opacity-40">
      Buscar siguiente trabajo delegado
    </button>}
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
      <TaskCommercialContext intelligence={
        commercialIntelligenceByItemId[task.ebayItemId]} />
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
        canOwnerAuthorize={canOwnerAuthorize} delegation={delegation} /></div>
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
      La delegación incluye la imagen principal, pero nunca sustituye la
      comprobación de producto/variante, derechos, compliance, gestión del
      listing ni readback oficial antes y después de cada cambio.
    </footer>
  </section>
}
