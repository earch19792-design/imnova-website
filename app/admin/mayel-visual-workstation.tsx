"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Clipboard, ShieldCheck, Upload, X } from
  "lucide-react"

import { supabase } from "@/lib/supabase"
import type { MayelCommercialIntelligenceV1 } from
  "@/lib/ebay/ebay-mayel-commercial-intelligence-v1"
import type { RemoteLiveOperatorListingV1 } from
  "@/lib/ebay/ebay-remote-live-optimization-operator-v1"

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
    "READY_FACT_RESTRICTED"; requiredEvidence: string;
    creativeWorkAllowed: boolean; factClaimRestricted: boolean }[]
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

type PriceDelegation = {
  fullValidatedPriceDelegationActive: boolean
  ownerPerPriceChangeApproval: false
  authorizationButtonEnabled: boolean
  firstBlockingPredicate: string | null
  active: { status: string; ownerConfirmedAt: string | null } | null
  validationPolicy: Record<string, boolean>
  mayelDirectPriceWrite: false
  sellerOsValidatedPriceExecutionOnly: true
}

type CommercialDelegation = {
  fullListingCommercialDelegationActive: boolean
  mayelContentOptimizationAuthority: boolean
  mayelKeywordOptimizationAuthority: boolean
  mayelMarketRevalidationAuthority: boolean
  ownerPerListingApproval: false
  authorizationButtonEnabled: boolean
  firstBlockingPredicate: string | null
  active: { status: string; ownerConfirmedAt: string | null } | null
  categoryRecommendationOnlyUntilCertified: true
}

type PromotionDelegation = {
  promotionSpendDelegationActive: boolean
  ownerPerPromotionApproval: false
  ownerCeilingsRequired: true
  authorizationButtonEnabled: boolean
  firstBlockingPredicate: string | null
  active: { status: string; ownerConfirmedAt: string | null; ceilings: {
    maxAdSpendPerListing: number
    maxAdSpendPerDay: number
    maxPortfolioAdSpendPerDay: number
    maxAdRatePercent: number
    minExpectedProfitAfterAds: number
    minMarginAfterAdsPercent: number
    minRoiAfterAdsPercent: number
  } } | null
  recommendationOnlyWhenCapabilityUnproven: true
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

type MarketRevalidationStatus = Readonly<{
  connectorAvailable: boolean
  state: "READY_TO_REQUEST" | "WAITING_FOR_WORKER" | "PENDING_RESUME" |
    "COMPLETED"
  planId: string | null
  result: Readonly<{
    exactComparableCount?: number | null
    rejectedComparableCount?: number | null
    marketPriceAuthority?: string | null
    soldPriceRange?: { minimum?: number | null; median?: number | null;
      maximum?: number | null } | null
    livePricePosition?: string | null
    economics?: { supplierCost?: number | null; shipping?: number | null;
      ebayFees?: number | null; otherCosts?: number | null;
      expectedProfit?: number | null; margin?: number | null } | null
    completedAt?: string | null
  }> | null
  ownerActionRequired: false
  mayelManualResearchRequired: false
  marketplaceWrites: 0
}>

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

function portfolioTaskStatus(task: VisualTask,
  market?: MarketRevalidationStatus) {
  if (task.phaseB?.execution?.appliedAndOfficiallyVerified) return "APLICADO"
  if (task.phaseB?.applicationStatus === "WAITING_FOR_EBAY") {
    return "ESPERANDO EBAY"
  }
  if (market?.state === "WAITING_FOR_WORKER") {
    return "LISTO PARA REVALIDAR"
  }
  if (market?.state === "PENDING_RESUME") {
    return "REVALIDACIÓN PENDIENTE"
  }
  if (task.phaseB?.safeToExecuteVisualChange) return "LISTO PARA APLICAR"
  return "MEJORANDO"
}

function TaskCommercialContext({ intelligence, revalidationStatus, ebayItemId,
  canOperate }: {
  intelligence?: MayelCommercialIntelligenceV1
  revalidationStatus?: MarketRevalidationStatus
  ebayItemId: string
  canOperate: boolean
}) {
  const [tab, setTab] = useState<TaskCommercialTab>("VISUAL")
  const [revalidationBusy, setRevalidationBusy] = useState(false)
  const [revalidationMessage, setRevalidationMessage] = useState("")
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
  async function revalidateMarket() {
    if (!canOperate || revalidationBusy ||
        revalidationStatus?.connectorAvailable !== true ||
        ["WAITING_FOR_WORKER", "PENDING_RESUME"].includes(
          revalidationStatus.state)) return
    setRevalidationBusy(true)
    setRevalidationMessage("")
    try {
      const payload = await visualRequest(
        "/api/admin/ebay/live-optimization-operator", {
          method: "POST",
          headers: { "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ action: "START_MARKET_REVALIDATION",
            ebayItemId }),
        })
      const result = payload.result as { continuationUrl?: unknown } | undefined
      if (typeof result?.continuationUrl !== "string" ||
          !result.continuationUrl.startsWith(
            "/admin/ebay/opportunity-queue/research?")) {
        throw new Error("MARKET_REVALIDATION_CONTINUATION_INVALID")
      }
      window.location.assign(result.continuationUrl)
    } catch (error) {
      setRevalidationMessage(error instanceof Error ? error.message :
        "No se pudo iniciar la investigación automática.")
      setRevalidationBusy(false)
    }
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
      {!intelligence && revalidationStatus?.state !== "COMPLETED" ?
        <p className="rounded-xl bg-white p-3">Mercado por comprobar. La autoridad comercial LIVE no está disponible ahora; no se atribuye el problema a imágenes.</p> : <>
        <div className="grid gap-2 sm:grid-cols-2">
          <p className="rounded-xl bg-white p-3">Última revisión<br/><strong>{commercialDate(intelligence?.market.lastResearchAt ?? revalidationStatus?.result?.completedAt)}</strong></p>
          <p className="rounded-xl bg-white p-3">Comparables vendidos<br/><strong>{intelligence?.market.soldComparableCount ?? revalidationStatus?.result?.exactComparableCount ?? "Por comprobar"}</strong></p>
          <p className="rounded-xl bg-white p-3">Rango sold<br/><strong>{(() => {
            const minimum = intelligence?.market.soldPriceMinimum ??
              revalidationStatus?.result?.soldPriceRange?.minimum ?? null
            const maximum = intelligence?.market.soldPriceMaximum ??
              revalidationStatus?.result?.soldPriceRange?.maximum ?? null
            return minimum === null || maximum === null ? "Por comprobar" :
              `${commercialMoney(minimum)}–${commercialMoney(maximum)}`
          })()}</strong></p>
          <p className="rounded-xl bg-white p-3">Posición del precio<br/><strong>{position[intelligence?.pricePosition.status ?? revalidationStatus?.result?.livePricePosition ?? ""] ?? "Mercado por comprobar"}</strong></p>
        </div>
        <p className="rounded-xl bg-[#edf3f1] p-3">{intelligence?.interpretation.explanation ??
          (revalidationStatus?.result?.marketPriceAuthority === "UNPROVEN"
            ? "No hubo comparables exactos suficientes; Seller OS no fabricó un precio."
            : "Seller OS completó la investigación automática y guardó el resultado.")}</p>
      </>}
      {revalidationStatus?.state === "WAITING_FOR_WORKER" &&
        <p className="rounded-xl bg-[#edf3f1] p-3">Plan listo y guardado. Product Research lo tomará cuando su worker esté disponible.</p>}
      {revalidationStatus?.state === "PENDING_RESUME" &&
        <p className="rounded-xl bg-[#f7e9de] p-3">La investigación quedó guardada y Seller OS debe reanudarla de forma segura.</p>}
      <button type="button"
        disabled={!canOperate || revalidationBusy ||
          revalidationStatus?.connectorAvailable !== true ||
          ["WAITING_FOR_WORKER", "PENDING_RESUME"].includes(
            revalidationStatus.state)}
        onClick={() => void revalidateMarket()}
        title={!canOperate ? "Disponible para Mayel dentro de su workspace" :
          revalidationStatus?.connectorAvailable !== true
            ? "Seller OS todavía no tiene autoridad suficiente para crear el plan"
            : "Seller OS elegirá y ejecutará el plan de investigación"}
        className="min-h-11 rounded-xl border border-[#1d5961]/30 px-4 font-semibold text-[#1d5961] disabled:opacity-55">
        {revalidationBusy ? "Iniciando investigación…" : "Revalidar mercado"}
      </button>
      <p className="text-xs">Seller OS elige queries, páginas y filtros Sold; Mayel no realiza investigación manual ni cambia eBay.</p>
      {revalidationMessage && <p role="alert"
        className="rounded-xl bg-[#f7e9de] p-3 text-xs text-[#704d3c]">
        {revalidationMessage}
      </p>}
    </div>}
    {tab === "RENTABILIDAD" && <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      {[["Precio LIVE", intelligence?.economics.livePrice.value ?? null],
        ["Costo proveedor", intelligence?.economics.supplierCost.value ?? revalidationStatus?.result?.economics?.supplierCost ?? null],
        ["Shipping", intelligence?.economics.shippingCost.value ?? revalidationStatus?.result?.economics?.shipping ?? null],
        ["Fees eBay", intelligence?.economics.ebayFees.value ?? revalidationStatus?.result?.economics?.ebayFees ?? null],
        ["Otros/reservas", intelligence?.economics.otherCostsOrReserves.value ?? revalidationStatus?.result?.economics?.otherCosts ?? null],
        ["Profit esperado", intelligence?.economics.expectedProfit.value ?? revalidationStatus?.result?.economics?.expectedProfit ?? null],
        ["Margen", intelligence?.economics.marginPercent.value ?? revalidationStatus?.result?.economics?.margin ?? null],
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
    slot.creativeWorkAllowed === true && !task.outputs.some((output) =>
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
    <p className="mt-2 rounded-xl bg-white p-3 text-xs leading-5 text-[#5f645e]">
      La falta de un dato factual no bloquea el trabajo visual general. En los
      slots marcados “crear sin claim factual”, no afirmes medidas, materiales,
      accesorios incluidos, funciones ni beneficios no demostrados.
    </p>
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

function ValidatedPriceDelegationPanel({ delegation, owner, busy, onDone }: {
  delegation: PriceDelegation | null
  owner: boolean
  busy: boolean
  onDone: () => Promise<void>
}) {
  const active = delegation?.fullValidatedPriceDelegationActive === true
  const [message, setMessage] = useState("")
  async function submit(action: "AUTHORIZE_VALIDATED_PRICE_DELEGATION" |
    "REVOKE_VALIDATED_PRICE_DELEGATION") {
    setMessage("")
    try {
      await visualRequest("/api/admin/ebay/mayel-visual-workstation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmation: action ===
          "AUTHORIZE_VALIDATED_PRICE_DELEGATION"
          ? "AUTORIZAR MAYEL OPTIMIZACION VALIDADA DE PRECIO"
          : "REVOCAR DELEGACION DE PRECIO DE MAYEL" }),
      })
      await onDone()
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "No se pudo actualizar la delegación de precio.")
    }
  }
  return <section className="mt-5 rounded-[28px] border border-[#d9d1c4] bg-[#fffdf8] p-5 sm:p-7">
    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8b6c3f]">Autoridad comercial separada</p>
    <h3 className="mt-2 font-serif text-2xl font-semibold">Optimización validada de precio</h3>
    <p className="mt-2 text-sm leading-6 text-[#64675f]">Mayel recomienda. Seller OS calcula el precio ejecutable sólo con evidencia Sold fresca, economía completa, stock seguro y sin conflicto de experimento. El margen objetivo nunca inventa el precio de mercado.</p>
    <p className="mt-3 text-sm font-semibold">{active
      ? "Delegación activa · no requiere aprobación por cada cambio de precio"
      : "Todavía no autorizada · ningún precio puede cambiar automáticamente"}</p>
    {owner && !active && <button type="button" disabled={busy ||
      delegation?.authorizationButtonEnabled !== true}
      onClick={() => void submit("AUTHORIZE_VALIDATED_PRICE_DELEGATION")}
      className="mt-4 min-h-11 rounded-xl bg-[#8b6c3f] px-4 text-sm font-semibold text-white disabled:opacity-40">
      Autorizar optimización validada de precio
    </button>}
    {owner && active && <button type="button" disabled={busy}
      onClick={() => void submit("REVOKE_VALIDATED_PRICE_DELEGATION")}
      className="mt-4 min-h-11 rounded-xl border border-[#8b6c3f] px-4 text-sm font-semibold text-[#7b5d34] disabled:opacity-40">
      Revocar delegación de precio
    </button>}
    {!active && delegation?.firstBlockingPredicate &&
      <p className="mt-3 text-xs text-[#704d3c]">Bloqueo: {delegation.firstBlockingPredicate}</p>}
    <p className="mt-3 text-xs text-[#777a73]">Fuera de alcance: cantidad, categoría, condición, policies, promociones, Send Offers y comunicaciones.</p>
    {message && <p className="mt-3 text-sm text-[#8b4937]">{message}</p>}
  </section>
}

function CommercialOptimizationDelegationPanel({ delegation, owner, busy,
  onDone }: { delegation: CommercialDelegation | null; owner: boolean
    busy: boolean; onDone: () => Promise<void> }) {
  const active = delegation?.fullListingCommercialDelegationActive === true
  const [message, setMessage] = useState("")
  async function submit(action: "AUTHORIZE_COMMERCIAL_OPTIMIZATION_DELEGATION" |
    "REVOKE_COMMERCIAL_OPTIMIZATION_DELEGATION") {
    setMessage("")
    try {
      await visualRequest("/api/admin/ebay/mayel-visual-workstation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmation: action ===
          "AUTHORIZE_COMMERCIAL_OPTIMIZATION_DELEGATION"
          ? "AUTORIZAR MAYEL OPTIMIZACION COMERCIAL DE LISTINGS"
          : "REVOCAR DELEGACION COMERCIAL DE MAYEL" }),
      })
      await onDone()
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "No se pudo actualizar la delegación comercial.")
    }
  }
  return <section className="mt-5 rounded-[28px] border border-[#d9d1c4] bg-[#fffdf8] p-5 sm:p-7">
    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d5961]">Contenido y búsqueda</p>
    <h3 className="mt-2 font-serif text-2xl font-semibold">Optimización comercial del listing</h3>
    <p className="mt-2 text-sm leading-6 text-[#64675f]">Permite a Mayel optimizar título, descripción, item specifics y keywords únicamente en campos reales de eBay. Seller OS bloquea cualquier fact no demostrado y mantiene categoría como recomendación hasta su certificación separada.</p>
    <p className="mt-3 text-sm font-semibold">{active
      ? "Delegación activa · no requiere aprobación rutinaria por listing"
      : "Esperando una delegación reusable del owner"}</p>
    {owner && !active && <button type="button" disabled={busy ||
      delegation?.authorizationButtonEnabled !== true}
      onClick={() => void submit("AUTHORIZE_COMMERCIAL_OPTIMIZATION_DELEGATION")}
      className="mt-4 min-h-11 rounded-xl bg-[#1d5961] px-4 text-sm font-semibold text-white disabled:opacity-40">
      Autorizar optimización de contenido
    </button>}
    {owner && active && <button type="button" disabled={busy}
      onClick={() => void submit("REVOKE_COMMERCIAL_OPTIMIZATION_DELEGATION")}
      className="mt-4 min-h-11 rounded-xl border border-[#1d5961] px-4 text-sm font-semibold text-[#1d5961] disabled:opacity-40">
      Revocar delegación de contenido
    </button>}
    {!active && delegation?.firstBlockingPredicate &&
      <p className="mt-3 text-xs text-[#704d3c]">Bloqueo: {delegation.firstBlockingPredicate}</p>}
    <p className="mt-3 text-xs text-[#777a73]">Product Truth obligatorio · keywords sólo en title/item specifics/description · un write acotado · readback oficial.</p>
    {message && <p className="mt-3 text-sm text-[#8b4937]">{message}</p>}
  </section>
}

function PromotionSpendDelegationPanel({ delegation, owner, busy, onDone }: {
  delegation: PromotionDelegation | null; owner: boolean; busy: boolean
  onDone: () => Promise<void>
}) {
  const active = delegation?.promotionSpendDelegationActive === true
  const [message, setMessage] = useState("")
  const [limits, setLimits] = useState({ maxAdSpendPerListing: "",
    maxAdSpendPerDay: "", maxPortfolioAdSpendPerDay: "",
    maxAdRatePercent: "", minExpectedProfitAfterAds: "",
    minMarginAfterAdsPercent: "", minRoiAfterAdsPercent: "" })
  const parsed = Object.fromEntries(Object.entries(limits).map(([key, value]) =>
    [key, value.trim() === "" ? null : Number(value)])) as Record<string,
      number | null>
  const valid = Object.values(parsed).every((value) => value !== null &&
    Number.isFinite(value)) && Number(parsed.maxAdSpendPerListing) > 0 &&
    Number(parsed.maxAdSpendPerDay) > 0 &&
    Number(parsed.maxPortfolioAdSpendPerDay) > 0 &&
    Number(parsed.maxAdRatePercent) > 0 &&
    Number(parsed.maxAdRatePercent) <= 100 &&
    Number(parsed.minExpectedProfitAfterAds) >= 0 &&
    Number(parsed.minMarginAfterAdsPercent) >= 0 &&
    Number(parsed.minMarginAfterAdsPercent) <= 100 &&
    Number(parsed.minRoiAfterAdsPercent) >= 0
  async function submit(action: "AUTHORIZE_PROMOTION_SPEND_DELEGATION" |
    "REVOKE_PROMOTION_SPEND_DELEGATION") {
    setMessage("")
    try {
      await visualRequest("/api/admin/ebay/mayel-visual-workstation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmation: action ===
          "AUTHORIZE_PROMOTION_SPEND_DELEGATION"
          ? "AUTORIZAR MAYEL PROMOCION DENTRO DE LIMITES"
          : "REVOCAR DELEGACION DE PROMOCION DE MAYEL",
        ceilings: action === "AUTHORIZE_PROMOTION_SPEND_DELEGATION"
          ? parsed : undefined }),
      })
      await onDone()
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "No se pudo actualizar la delegación de promoción.")
    }
  }
  const fields = [
    ["maxAdSpendPerListing", "Máximo por listing · USD"],
    ["maxAdSpendPerDay", "Máximo por día · USD"],
    ["maxPortfolioAdSpendPerDay", "Máximo portfolio/día · USD"],
    ["maxAdRatePercent", "Tasa máxima · %"],
    ["minExpectedProfitAfterAds", "Profit mínimo después de ads · USD"],
    ["minMarginAfterAdsPercent", "Margen mínimo después de ads · %"],
    ["minRoiAfterAdsPercent", "ROI mínimo después de ads · %"],
  ] as const
  return <section className="mt-5 rounded-[28px] border border-[#d9d1c4] bg-[#fffdf8] p-5 sm:p-7">
    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8b6c3f]">Promoción y gasto</p>
    <h3 className="mt-2 font-serif text-2xl font-semibold">Promoted Listings dentro de límites</h3>
    <p className="mt-2 text-sm leading-6 text-[#64675f]">Sin esta autoridad Seller OS sólo recomienda. La activación exige capacidad oficial, economía completa, ausencia de conflicto y límites explícitos del owner.</p>
    {active && delegation?.active && <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <p className="rounded-xl bg-[#e3ebe1] p-3">Por listing<br/><strong>{commercialMoney(delegation.active.ceilings.maxAdSpendPerListing)}</strong></p>
      <p className="rounded-xl bg-[#e3ebe1] p-3">Portfolio/día<br/><strong>{commercialMoney(delegation.active.ceilings.maxPortfolioAdSpendPerDay)}</strong></p>
      <p className="rounded-xl bg-[#e3ebe1] p-3">Tasa máxima<br/><strong>{delegation.active.ceilings.maxAdRatePercent}%</strong></p>
      <p className="rounded-xl bg-[#e3ebe1] p-3">Profit mínimo<br/><strong>{commercialMoney(delegation.active.ceilings.minExpectedProfitAfterAds)}</strong></p>
    </div>}
    {owner && !active && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map(([key, label]) => <label key={key}
        className="text-xs font-semibold text-[#555e58]">{label}
        <input type="number" min="0" step="0.01" value={limits[key]}
          onChange={(event) => setLimits((current) => ({ ...current,
            [key]: event.target.value }))}
          className="mt-1 min-h-11 w-full rounded-xl border border-[#d9d1c4] bg-white px-3 text-sm font-normal" />
      </label>)}
    </div>}
    {owner && !active && <button type="button" disabled={busy || !valid ||
      delegation?.authorizationButtonEnabled !== true}
      onClick={() => void submit("AUTHORIZE_PROMOTION_SPEND_DELEGATION")}
      className="mt-4 min-h-11 rounded-xl bg-[#8b6c3f] px-4 text-sm font-semibold text-white disabled:opacity-40">
      Autorizar promoción dentro de estos límites
    </button>}
    {owner && active && <button type="button" disabled={busy}
      onClick={() => void submit("REVOKE_PROMOTION_SPEND_DELEGATION")}
      className="mt-4 min-h-11 rounded-xl border border-[#8b6c3f] px-4 text-sm font-semibold text-[#7b5d34] disabled:opacity-40">
      Revocar delegación de promoción
    </button>}
    {!active && <p className="mt-3 text-xs text-[#704d3c]">Promoción: sólo recomendación. Ningún límite se inventa y ningún gasto está autorizado.</p>}
    {message && <p className="mt-3 text-sm text-[#8b4937]">{message}</p>}
  </section>
}

const opportunityLabels: Record<string, string> = {
  VISUAL_OPPORTUNITY: "Visual", CONTENT_OPPORTUNITY: "Contenido",
  KEYWORD_OPPORTUNITY: "Keywords", MARKET_REVALIDATION_REQUIRED: "Revalidar mercado",
  PRICE_OPPORTUNITY: "Precio", PROMOTION_OPPORTUNITY: "Promoción",
  PERFORMANCE_PROBLEM: "Performance", HEALTHY: "Sano",
  INSUFFICIENT_EVIDENCE: "Evidencia insuficiente",
}

function PortfolioOverview({ listings }: {
  listings: readonly RemoteLiveOperatorListingV1[]
}) {
  const [filter, setFilter] = useState("TODOS")
  const [search, setSearch] = useState("")
  const visible = useMemo(() => listings.filter((listing) =>
    (filter === "TODOS" || listing.optimization.opportunities.includes(
      filter as never)) && (!search.trim() ||
      `${listing.title} ${listing.sku ?? ""} ${listing.ebayItemId}`
        .toLowerCase().includes(search.trim().toLowerCase()))),
  [filter, listings, search])
  const needsEvidence = listings.filter((listing) =>
    listing.optimization.opportunities.includes("INSUFFICIENT_EVIDENCE")).length
  const needsMarket = listings.filter((listing) =>
    listing.optimization.opportunities.includes(
      "MARKET_REVALIDATION_REQUIRED")).length
  return <section className="mt-7 rounded-[28px] border border-[#cbd9d4] bg-[#f8fbf9] p-5 sm:p-7"
    data-all-live-listings-visible-to-mayel={listings.length > 0}>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d5961]">Portfolio LIVE completo</p>
        <h3 className="mt-2 font-serif text-2xl font-semibold">Optimización comercial continua</h3>
        <p className="mt-2 text-sm text-[#64675f]">{listings.length} listings LIVE visibles · {needsMarket} requieren mercado fresco · {needsEvidence} requieren más autoridad.</p></div>
      <div className="flex flex-wrap gap-2">
        <input value={search} onChange={(event) => setSearch(event.target.value)}
          aria-label="Buscar listing LIVE" placeholder="Buscar listing"
          className="min-h-11 rounded-xl border border-[#cbd9d4] bg-white px-3 text-sm" />
        <select value={filter} onChange={(event) => setFilter(event.target.value)}
          aria-label="Filtrar oportunidad" className="min-h-11 rounded-xl border border-[#cbd9d4] bg-white px-3 text-sm">
          <option value="TODOS">Todos</option>
          {Object.entries(opportunityLabels).map(([key, label]) =>
            <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
    </div>
    {!listings.length && <p className="mt-5 rounded-xl bg-white p-4 text-sm text-[#704d3c]">La autoridad LIVE no está disponible. No se muestra un cero falso.</p>}
    <div className="mt-5 space-y-3">{visible.map((listing) => <details
      key={listing.ebayItemId} className="rounded-2xl border border-[#d9e2de] bg-white p-4">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="font-semibold text-[#26312d]">{listing.title}</p>
            <p className="mt-1 text-xs text-[#777a73]">{listing.sku ?? "SKU por comprobar"} · eBay {listing.ebayItemId}</p></div>
          <div className="flex flex-wrap gap-1.5"><span className="rounded-full bg-[#26312d] px-2.5 py-1 text-[11px] font-semibold text-white">{listing.optimization.status.replaceAll("_", " ")}</span>
            {listing.optimization.opportunities.map((value) => <span key={value}
              className="rounded-full bg-[#e3ebe1] px-2.5 py-1 text-[11px] font-semibold text-[#425143]">{opportunityLabels[value]}</span>)}</div>
        </div>
      </summary>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <p className="rounded-xl bg-[#f8fbf9] p-3"><strong>Qué encontró Seller OS</strong><br/>{listing.optimization.whatSellerOsFound}</p>
        <p className="rounded-xl bg-[#f8fbf9] p-3"><strong>Qué cambió Mayel</strong><br/>{listing.optimization.mayelChanged}</p>
        <p className="rounded-xl bg-[#f8fbf9] p-3"><strong>Por qué</strong><br/>{listing.optimization.why}</p>
        <p className="rounded-xl bg-[#f8fbf9] p-3"><strong>Impacto esperado</strong><br/>{listing.optimization.expectedImpact}</p>
      </div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <p className="rounded-xl border border-[#e0e5e2] p-3"><strong>Visual</strong><br/>{listing.visualReview.findings.length ? `${listing.visualReview.findings.length} hallazgos` : "Sin oportunidad visual demostrada"}</p>
        <p className="rounded-xl border border-[#e0e5e2] p-3"><strong>Contenido</strong><br/>{listing.ebayGuidance.length ? `${listing.ebayGuidance.length} señales oficiales` : "Por comprobar"}</p>
        <p className="rounded-xl border border-[#e0e5e2] p-3"><strong>Keywords / Search</strong><br/>Title · Item specifics · Description</p>
        <p className="rounded-xl border border-[#e0e5e2] p-3"><strong>Mercado</strong><br/>{listing.commercialIntelligence.market.freshness.replaceAll("_", " ")}</p>
        <p className="rounded-xl border border-[#e0e5e2] p-3"><strong>Precio</strong><br/>{commercialMoney(listing.commercialIntelligence.pricePosition.livePrice)} · {listing.commercialIntelligence.pricePosition.status.replaceAll("_", " ")}</p>
        <p className="rounded-xl border border-[#e0e5e2] p-3"><strong>Rentabilidad</strong><br/>Profit {commercialMoney(listing.commercialIntelligence.economics.expectedProfit.value)} · margen {listing.commercialIntelligence.economics.marginPercent.value ?? "Por comprobar"}{listing.commercialIntelligence.economics.marginPercent.value === null ? "" : "%"}</p>
        <p className="rounded-xl border border-[#e0e5e2] p-3"><strong>Performance</strong><br/>{listing.metrics.impressions ?? "Por comprobar"} impresiones · {listing.metrics.orders ?? "Por comprobar"} órdenes</p>
        <p className="rounded-xl border border-[#e0e5e2] p-3"><strong>Recomendaciones eBay</strong><br/>{listing.ebayGuidance.length ? "Disponibles para revisión" : "No demostradas"}</p>
        <p className="rounded-xl border border-[#e0e5e2] p-3"><strong>Promoción</strong><br/>{listing.optimization.opportunities.includes("PROMOTION_OPPORTUNITY") ? "Recomendación oficial disponible" : "Sin recomendación oficial demostrada"}</p>
      </div>
    </details>)}</div>
  </section>
}

export function MayelVisualWorkstation({ canOperate,
  canOwnerAuthorize = false, commercialIntelligenceByItemId = {},
  livePortfolio = [] }: {
  canOperate: boolean
  canOwnerAuthorize?: boolean
  commercialIntelligenceByItemId?: Readonly<Record<string,
    MayelCommercialIntelligenceV1>>
  livePortfolio?: readonly RemoteLiveOperatorListingV1[]
}) {
  const [tasks, setTasks] = useState<VisualTask[]>([])
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState("")
  const [canaryAvailable, setCanaryAvailable] = useState<boolean | null>(null)
  const [delegation, setDelegation] = useState<VisualDelegation | null>(null)
  const [priceDelegation, setPriceDelegation] =
    useState<PriceDelegation | null>(null)
  const [commercialDelegation, setCommercialDelegation] =
    useState<CommercialDelegation | null>(null)
  const [promotionDelegation, setPromotionDelegation] =
    useState<PromotionDelegation | null>(null)
  const [marketRevalidationByItemId, setMarketRevalidationByItemId] =
    useState<Record<string, MarketRevalidationStatus>>({})

  const load = useCallback(async () => {
    const payload = await visualRequest(
      "/api/admin/ebay/mayel-visual-workstation")
    const workstation = payload.workstation as { tasks?: VisualTask[] } | undefined
    const nextTasks = workstation?.tasks ?? []
    setTasks(nextTasks)
    setDelegation((payload.delegation as VisualDelegation | undefined) ?? null)
    setPriceDelegation((payload.priceDelegation as PriceDelegation |
      undefined) ?? null)
    setCommercialDelegation((payload.commercialDelegation as
      CommercialDelegation | undefined) ?? null)
    setPromotionDelegation((payload.promotionDelegation as
      PromotionDelegation | undefined) ?? null)
    const reads = await Promise.allSettled(nextTasks.map(async (task) => {
      const statusPayload = await visualRequest(
        "/api/admin/ebay/live-optimization-operator", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "READ_MARKET_REVALIDATION_STATUS",
            ebayItemId: task.ebayItemId }),
        })
      return [task.ebayItemId,
        statusPayload.result as MarketRevalidationStatus] as const
    }))
    const nextStatuses: Record<string, MarketRevalidationStatus> = {}
    for (const read of reads) {
      if (read.status === "fulfilled" &&
          read.value[1]?.connectorAvailable === true) {
        nextStatuses[read.value[0]] = read.value[1]
      }
    }
    setMarketRevalidationByItemId(nextStatuses)
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
      <span className="rounded-full bg-[#f7e9de] px-3 py-2 text-[#704d3c]">eBay sólo con autoridad vigente y readback</span>
    </div>
    <FullVisualDelegationPanel delegation={delegation}
      owner={canOwnerAuthorize} busy={busy} onDone={refresh} />
    <CommercialOptimizationDelegationPanel delegation={commercialDelegation}
      owner={canOwnerAuthorize} busy={busy} onDone={refresh} />
    <ValidatedPriceDelegationPanel delegation={priceDelegation}
      owner={canOwnerAuthorize} busy={busy} onDone={refresh} />
    <PromotionSpendDelegationPanel delegation={promotionDelegation}
      owner={canOwnerAuthorize} busy={busy} onDone={refresh} />
    <PortfolioOverview listings={livePortfolio} />
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
        <span className="rounded-full bg-[#e3ebe1] px-3 py-2 text-xs font-semibold text-[#425143]">{portfolioTaskStatus(task,
          marketRevalidationByItemId[task.ebayItemId])}</span>
      </div>
      <div className="mt-6"><SourceGallery task={task} /></div>
      <TaskCommercialContext intelligence={
        commercialIntelligenceByItemId[task.ebayItemId]}
        revalidationStatus={marketRevalidationByItemId[task.ebayItemId]}
        ebayItemId={task.ebayItemId} canOperate={canOperate} />
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
        <div key={slot.role} className={`rounded-xl p-3 text-xs ${slot.status === "READY" ? "bg-[#e3ebe1] text-[#425143]" : "bg-[#f7e9de] text-[#704d3c]"}`}>
          <strong>{labels[slot.role]}</strong><span className="mt-1 block">{slot.status === "READY" ? "Libre para crear" : "Crear sin claim factual"}</span>
          {slot.factClaimRestricted && <span className="mt-1 block">Evidencia factual pendiente; el trabajo visual continúa.</span>}
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
