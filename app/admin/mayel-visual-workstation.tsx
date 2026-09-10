"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, Clipboard, ShieldCheck,
  Trash2, Upload, X } from
  "lucide-react"

import { MayelVisualAssetProgress } from "./ebay/mayel/visual-asset-progress"
import { visualAssetStatusV1 } from "@/lib/seller-os/mayel-visual-asset-status-v1"
import { proposalSlotLabelV1 } from "@/lib/seller-os/mayel-gallery-presentation-v1"
import { scopedVisualTasksV1, friendlyVisualSyncV1 } from "@/lib/seller-os/mayel-visual-scope-v1"
import { supabase } from "@/lib/supabase"
import type { MayelCommercialIntelligenceV1 } from
  "@/lib/ebay/ebay-mayel-commercial-intelligence-v1"
import type { RemoteLiveOperatorListingV1 } from
  "@/lib/ebay/ebay-remote-live-optimization-operator-v1"

import type { useMayelLocalFirstV1 } from "./ebay/mayel/local-first"
import { autosaveLocalImageSelectionV1, readLocalImageSelectionV1, readLocalImageBlobV1, saveLocalImageSelectionV1, type LocalImageSelection } from "@/lib/seller-os/ipad-local-outbox-v1"
type VisualLocalOutbox = Pick<ReturnType<typeof useMayelLocalFirstV1>, "actorId" | "rows" | "saveDraft">

type VisualRole = "DETAIL" | "PACKAGE_CONTENTS" | "DIMENSIONS" |
  "PRIMARY_BENEFIT" | "LIFESTYLE" | "HUMAN_USE"

type VisualOutput = {
  id: string
  discarded?: boolean
  status: string
  mayel_output_role: VisualRole
  output_sha256: string
  output_width: number
  output_height: number
  qa_result: Record<string, unknown>
  mayel_approval_status: string
  owner_approval_status: string
  previewUrl: string | null
  sync?: { autonomousOptimization?: boolean; state: string; approvedForEbaySync: boolean; generation: string; idempotencyKey: string; serverReceiptPresent: boolean; officialReadback?: boolean; savedToSellerOS?: boolean }
}

type VisualTask = {
  visualTaskId: string
  autonomousOptimization?: boolean
  latestOptimization?: { state: string; officialReadback: boolean; label: string } | null
  visualStationState?: string
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
  currentGallerySynced?: boolean
  currentGalleryProven?: boolean
  currentGalleryObservedAt?: string | null
  currentGalleryDigest?: string | null
  galleryRebaseRequired?: boolean
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
      {(intelligence?.economics.refresh?.length ?? 0) > 0 &&
        <div className="col-span-2 rounded-xl border border-[#d9d1c4] bg-[#f8f6f1] p-3 sm:col-span-4">
          <p className="font-semibold">Actualización automática</p>
          <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
            {intelligence!.economics.refresh.map((row) =>
              <p key={row.evidenceType}>{({ EBAY_LIVE_PRICE: "Precio eBay",
                LUNA_CURRENT_COST: "Costo Luna",
                LUNA_CURRENT_SHIPPING: "Envío",
                EXPECTED_EBAY_FEE: "Fee eBay",
                OTHER_EXPLICIT_COSTS: "Otros costos" } as Record<string,string>)[row.evidenceType] ?? row.evidenceType} · {row.humanStatus}</p>)}
          </div>
          <p className="mt-2 text-xs">Utilidad · {intelligence!.economics.utilityHumanStatus}. Seller OS reintenta lo recuperable sin clic técnico.</p>
        </div>}
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

function HumanQa({ task, output, busy, onDone, owner = false }: {
  task: VisualTask
  output: VisualOutput
  busy: boolean
  onDone: () => Promise<void>
  owner?: boolean
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
  const [approvingSync, setApprovingSync] = useState(false)
  const [intent, setIntent] = useState<"" | "REPLACE_MAIN" | "REPLACE_SLOT" | "ADD_SECONDARY">("")
  const [replacementPosition, setReplacementPosition] = useState(1)
  const [savingIntent, setSavingIntent] = useState(false)
  const intents = Array.isArray(task.visualManifest?.visualIntents) ? task.visualManifest.visualIntents as
    { assetId: string; visualIntent: string; targetImagePosition: number }[] : []
  const appliedIntent = intents.find(i => i.assetId === output.id)
  const addPosition = task.currentImages.length + intents.filter(i => i.visualIntent === "ADD_SECONDARY" && i.assetId !== output.id).length
  const targetPosition = intent === "REPLACE_MAIN" ? 0 : intent === "REPLACE_SLOT" ? replacementPosition : addPosition
  const beforePosition = appliedIntent?.targetImagePosition ?? (intent ? targetPosition : 0)
  const status = visualAssetStatusV1({ generated: Boolean(output.previewUrl),
    qaPassed: output.qa_result.automaticStatus === "PASSED" && output.mayel_approval_status === "APPROVED",
    savedToSellerOS: output.sync?.savedToSellerOS === true, ownerApproved: output.sync?.approvedForEbaySync === true, autonomousOptimization: output.sync?.autonomousOptimization === true,
    serverReceiptPresent: output.sync?.serverReceiptPresent === true, officialReadback: output.sync?.officialReadback === true,
    state: output.sync?.state ?? (output.status === "rejected" ? "REQUIRES_ATTENTION" : "DRAFT") })
  async function saveIntent() {
    if (!intent || savingIntent) return
    setSavingIntent(true); setMessage("")
    try {
      await visualRequest("/api/admin/ebay/mayel-visual-workstation", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SAVE_ASSET_INTENT", visualTaskId: task.visualTaskId, assetId: output.id,
          visualIntent: intent, targetImagePosition: targetPosition, expectedVisualManifestDigest: task.visualManifestDigest }) })
      await onDone(); setMessage(task.autonomousOptimization ? "Intención guardada. Mayel comprobará la evidencia y sincronizará cuando sea segura." : "Intención guardada. Revisa el Preview antes de aprobar.")
    } catch { setMessage("No pudimos guardar el cambio. Revisa que la posición esté disponible.") }
    finally { setSavingIntent(false) }
  }
  const complete = baseChecks.every(([key]) => checks[key] === true)

  async function submit(decision: "APPROVE" | "REJECT") {
    setMessage("")
    try {
      await visualRequest("/api/admin/ebay/mayel-visual-workstation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REVIEW_OUTPUT",
          visualTaskId: task.visualTaskId, assetId: output.id, decision,
          visualIntent: intent || undefined, targetImagePosition: intent ? targetPosition : undefined,
          humanQa: decision === "APPROVE" ? checks : undefined,
          expectedGalleryDigest: task.currentGalleryDigest,
          rejectionReason: decision === "REJECT" ? reason : undefined }),
      })
      await onDone()
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "No pudimos guardar la revisión.")
    }
  }

  async function approveSync() {
    if (!output.sync || approvingSync) return
    setApprovingSync(true); setMessage("")
    try {
      await visualRequest("/api/admin/ebay/mayel-visual-workstation", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "APPROVE_ASSET_SYNC",
          visualTaskId: task.visualTaskId, assetId: output.id, generation: output.sync.generation,
          confirmation: "APPROVE_THIS_ASSET_FOR_EBAY_SYNC_V1" }) })
      await onDone()
    } catch { setMessage("No se guardó la autorización. La imagen sigue guardada para revisión.") }
    finally { setApprovingSync(false) }
  }

  return <article className="rounded-2xl border border-[#ddd5ca] bg-white p-4">
    <MayelVisualAssetProgress status={status} />
    {appliedIntent && <p className="mb-3 text-sm">{appliedIntent.visualIntent === "ADD_SECONDARY" ? "Añadir secundaria" : "Reemplazar"} · Posición {appliedIntent.targetImagePosition + 1}{appliedIntent.targetImagePosition === 0 ? " · Principal" : ""}</p>}
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#74866d]">Antes{beforePosition >= task.currentImages.length ? " · posición nueva" : ""}</p>
        <img src={task.currentImages[beforePosition] ?? ""}
          alt="Imagen fuente original del producto"
          className="mt-2 aspect-square w-full rounded-xl bg-[#f4efe7] object-contain" />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#1d5961]">Resultado ChatGPT · {labels[output.mayel_output_role]}</p>
        <img src={output.previewUrl ?? ""} alt="Resultado subido por Mayel"
          className="mt-2 aspect-square w-full rounded-xl bg-[#f4efe7] object-contain" />
      </div>
    </div>
    {(!task.autonomousOptimization || !owner) && !status.synced && output.status !== "rejected" && <div className="mt-4">
      <label className="block text-sm font-semibold">¿Qué cambio quieres preparar?
        <select value={intent} onChange={e => setIntent(e.target.value as typeof intent)} className="mt-2 min-h-11 w-full rounded-xl border p-3">
          <option value="">Selecciona la intención</option><option value="REPLACE_MAIN">Reemplazar sólo la imagen principal</option>
          <option value="REPLACE_SLOT" disabled={task.currentImages.length < 2}>Reemplazar una imagen secundaria</option>
          <option value="ADD_SECONDARY" disabled={addPosition >= 24}>Añadir secundaria · posición {addPosition + 1}</option>
        </select></label>
      {intent === "REPLACE_SLOT" && <label className="mt-2 block text-sm">Posición exacta
        <select value={replacementPosition} onChange={e => setReplacementPosition(Number(e.target.value))} className="mt-2 min-h-11 w-full rounded-xl border p-3">
          {task.currentImages.slice(1).map((_,i) => <option key={i+1} value={i+1}>Imagen {i+2}</option>)}
        </select></label>}
      {output.status === "approved" && <button type="button" disabled={busy || savingIntent || !intent} onClick={() => void saveIntent()}
        className="mt-2 min-h-11 rounded-xl border px-4 disabled:opacity-40">Guardar intención y Preview</button>}
      <p className="mt-2 text-sm">{task.autonomousOptimization ? "Conserva las demás posiciones. Mayel aplica la delegación sólo después de validar QA y evidencia." : "Conserva las demás posiciones. Guardar la intención no autoriza sincronizar."}</p>
    </div>}
    {output.status === "pending_review" && <div className="mt-4">
      <p className="text-sm font-semibold">{task.autonomousOptimization ? "QA de identidad pendiente" : "Comparación humana obligatoria"}</p>
      {task.autonomousOptimization && <p className="mt-2 text-sm">Mayel continúa automáticamente cuando la evaluación semántica está guardada y es segura. La delegación no aprueba cambios en la identidad ni datos sin evidencia.</p>}
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
          <button type="button" disabled={busy || !complete || (!task.autonomousOptimization && !intent)}
            onClick={() => void submit("APPROVE")}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#1d5961] px-3 text-sm font-semibold text-white disabled:opacity-40"><Check className="h-4 w-4" />{task.autonomousOptimization ? "Guardar evaluación QA" : "Aprobar"}</button>
        </div>
      </div>
      {message && <p className="mt-3 text-sm text-[#8b4937]">{message}</p>}
    </div>}
    {output.sync && <div className="mt-4 rounded-xl bg-[#f4efe7] p-3 text-sm">

      {output.status === "approved" && output.sync.state === "OWNER_APPROVAL_REQUIRED" && !output.sync.autonomousOptimization && owner &&
        <button type="button" disabled={busy || approvingSync} onClick={() => void approveSync()}
          className="mt-3 min-h-11 rounded-xl bg-[#1d5961] px-4 py-2 font-semibold text-white disabled:opacity-40">Aprobar esta imagen para sincronizar con eBay</button>}
      <p className="mt-2 text-xs">{output.sync.autonomousOptimization ? "Mayel sincroniza automáticamente las mejoras seguras dentro de tu delegación. Las fuentes originales siguen guardadas." : "Cada imagen necesita su propia aprobación. Las fuentes originales guardadas siguen disponibles para las otras propuestas."}</p>
      <details className="mt-2"><summary>Ver detalles</summary><pre className="overflow-auto text-xs">{JSON.stringify(output.sync, null, 2)}</pre></details>
    </div>}

    {output.status !== "pending_review" && message && <p role="alert">{message}</p>}
    {output.status === "rejected" && <p className="mt-4 rounded-xl bg-[#f7e9de] p-3 text-sm font-semibold text-[#704d3c]">Resultado rechazado</p>}
  </article>
}

function UploadPanel({ task, busy, onDone, localOutbox }: { task: VisualTask;
  busy: boolean; onDone: () => Promise<void>; localOutbox?: VisualLocalOutbox }) {
  const [uploads, setUploads] = useState<File[]>([])
  const [rights, setRights] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState("")
  const [selection, setSelection] = useState<LocalImageSelection | null>(null)
  const [saving, setSaving] = useState(false)
  const [recovered, setRecovered] = useState(!localOutbox)
  const done = useRef(onDone); done.current = onDone
  const savedReceipt = localOutbox?.rows.find(r => r.intent.idempotencyKey === selection?.queuedKey)?.receipt
  useEffect(() => {
    if (!localOutbox?.actorId) return
    let active = true
    void (async () => {
      try {
        const saved = await readLocalImageSelectionV1(localOutbox.actorId, task.visualTaskId)
        if (saved?.files.length) {
          const files = await Promise.all(saved.files.map(async (f, n) => {
            const blob = await readLocalImageBlobV1(localOutbox.actorId, f.id)
            if (!blob) throw Error("OUTBOX_LOCAL_IMAGE_MISSING")
            return new File([blob], saved.names[n], { type: f.mimeType })
          }))
          const queued = localOutbox.rows.find(row => row.intent.kind === "IMAGE_UPLOAD" &&
            row.intent.requestedChanges.taskId === task.visualTaskId &&
            JSON.stringify(row.intent.requestedChanges.files) === JSON.stringify(saved.files))
          const restored = queued ? { ...saved, queuedKey: queued.intent.idempotencyKey } : saved
          if (active) { setSelection(restored); setUploads(files) }
        }
      } catch (e) { if (active) setMessage(e instanceof Error ? e.message : "IPAD_LOCAL_STORAGE_FAILED") }
      finally { if (active) setRecovered(true) }
    })()
    return () => { active = false }
  }, [localOutbox?.actorId, task.visualTaskId])
  useEffect(() => {
    if (!savedReceipt || !selection?.queuedKey || !localOutbox?.actorId) return
    let active = true
    void saveLocalImageSelectionV1(localOutbox.actorId, task.visualTaskId, { files: [], names: [], queuedKey: null }).then(async () => {
      if (!active) return
      setSelection(null); setUploads([]); setRights(false); setMessage("GUARDADO")
      await done.current()
    }).catch(() => { if (active) setMessage("REQUIERE_ATENCION") })
    return () => { active = false }
  }, [savedReceipt, selection?.queuedKey, localOutbox?.actorId, task.visualTaskId])
  async function choose(files: File[]) {
    setUploads(files); setMessage(""); setRights(false)
    if (!localOutbox) return
    setSaving(true)
    try { setSelection(await autosaveLocalImageSelectionV1(localOutbox.actorId, task.visualTaskId, files)); setMessage("GUARDADO") }
    catch (e) { setSelection(null); setMessage(e instanceof Error ? e.message : "IPAD_LOCAL_STORAGE_FAILED") }
    finally { setSaving(false) }
  }
  const activeCount = task.outputs.filter((output) =>
    output.status !== "rejected").length
  const remaining = Math.max(0, 6 - activeCount)
  const selectionValid = uploads.length > 0 && uploads.length <= remaining

  async function upload() {
    if (uploading || saving || !rights || !selectionValid || selection?.queuedKey) return
    setUploading(true)
    setMessage("")
    try {
      if (localOutbox) {
        if (!selection?.files.length) throw Error("IPAD_LOCAL_STORAGE_FAILED")
        const row = await localOutbox.saveDraft({ kind: "IMAGE_UPLOAD", itemId: task.ebayItemId,
          listingTitle: task.productTitle, generationId: task.visualTaskId,
          baseVersionHash: task.sourceImageSetDigest, baseObservedAt: null,
          requestedChanges: { taskId: task.visualTaskId, files: selection.files, rightsConfirmed: true } })
        const queued = { ...selection, queuedKey: row.intent.idempotencyKey }
        await saveLocalImageSelectionV1(localOutbox.actorId, task.visualTaskId, queued)
        setSelection(queued); setMessage("PENDIENTE_DE_SINCRONIZAR")
        return
      }
      const form = new FormData()
      form.set("action", "UPLOAD_OUTPUT_BATCH")
      form.set("visualTaskId", task.visualTaskId)
      form.set("rightsConfirmed", "true")
      uploads.forEach((file) => form.append("files", file))
      await visualRequest("/api/admin/ebay/mayel-visual-workstation",
        { method: "POST", body: form })
      setUploads([])
      setRights(false)
      await onDone()
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "No pudimos subir esta imagen.")
    } finally {
      setUploading(false)
    }
  }

  if (remaining < 1) return null
  return <section className="rounded-2xl border border-dashed border-[#1d5961]/45 bg-[#f0f5f3] p-5">
    <div className="flex items-center gap-2"><Upload className="h-5 w-5 text-[#1d5961]" />
      <h4 className="font-semibold">Subir imágenes creadas por Mayel</h4></div>
    <p className="mt-2 text-xs font-semibold text-[#1d5961]">Carga disponible · {remaining} de 6 espacios libres</p>
    <p className="mt-2 text-sm leading-6 text-[#5f645e]">El producto ya está ligado por la tarea. No escribas un SKU. Cada archivo entra primero a cuarentena privada.</p>
    <p className="mt-2 rounded-xl bg-white p-3 text-xs leading-5 text-[#5f645e]">
      La falta de un dato factual no bloquea el trabajo visual general. En los
      slots marcados “crear sin claim factual”, no afirmes medidas, materiales,
      accesorios incluidos, funciones ni beneficios no demostrados.
    </p>
    <label className="mt-4 block rounded-xl border-2 border-dashed border-[#1d5961]/35 bg-white p-4 text-xs font-semibold">Arrastra o elige hasta seis archivos JPG, PNG o WebP
      <input type="file" multiple accept="image/jpeg,image/png,image/webp"
        disabled={saving || !recovered || Boolean(selection?.queuedKey)}
        onChange={(event) => {
          const chosen = Array.from(event.target.files ?? [])
            .slice(0, Math.min(6, remaining))
          void choose(chosen)
        }}
        className="mt-2 block min-h-12 w-full rounded-xl border border-[#cfc7ba] bg-white p-2 text-sm" />
    </label>
    {uploads.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{uploads.map((file, index) =>
      <div key={`${file.name}-${index}`}
        className="rounded-xl bg-white p-3">
        <span className="block truncate text-xs font-semibold text-[#555a54]">{index + 1}. {file.name}</span>
        <span className="mt-1 block text-[11px] text-[#777a73]">Subiendo → cuarentena → revisión automática</span>
      </div>)}</div>}
    <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-[#555a54]">
      <input type="checkbox" checked={rights}
        onChange={(event) => setRights(event.target.checked)} className="mt-1" />
      Confirmo que este archivo fue creado en mi propia suscripción de ChatGPT para esta tarea y puedo subirlo a Seller OS.
    </label>
    <button type="button" disabled={busy || uploading || saving || !recovered || Boolean(selection?.queuedKey) || !rights || !selectionValid}
      onClick={() => void upload()}
      className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#1d5961] px-4 text-sm font-semibold text-white disabled:opacity-40"><Upload className="h-4 w-4" />{uploading ? "Subiendo…" : "Subir imágenes"}</button>
    {message && <p role="status" className="mt-3 text-sm text-[#8b4937]">{["GUARDADO", "PENDIENTE_DE_SINCRONIZAR"].includes(message) ? message : "REQUIERE_ATENCION"}</p>}
    {localOutbox && <details className="mt-2 text-xs"><summary>Ver detalles</summary>
      <p>{selection?.queuedKey ? "Enviando los archivos guardados. Puedes cerrar el iPad cuando Seller OS confirme que los recibió." : "Los archivos elegidos se guardan automáticamente en este navegador. Subir imágenes confirma sus derechos y entrega el trabajo a Seller OS."}</p>
      {message && !["GUARDADO", "PENDIENTE_DE_SINCRONIZAR"].includes(message) && <p>{message}</p>}
    </details>}
  </section>
}

function evidenceValues(pack: Record<string, unknown>, key: string) {
  const value = pack[key]
  return Array.isArray(value)
    ? value.map(String).map((entry) => entry.trim()).filter(Boolean)
    : typeof value === "string" && value.trim() ? [value.trim()] : []
}

type OrderedGalleryEntry = {
  key: string
  kind: "CURRENT_OFFICIAL" | "MAYEL_ASSET"
  publicUrl: string
  assetId: string | null
}

function OrderedGalleryManager({ task, busy, onDone, owner }: { task: VisualTask
  owner: boolean; busy: boolean; onDone: () => Promise<void> }) {
  const approved = task.outputs.filter(o => !o.discarded && o.status === "approved" && o.previewUrl)
  const [selected, setSelected] = useState<Record<number, string>>({})
  const [message, setMessage] = useState("")
  const [saving, setSaving] = useState(false)
  const manifestSlots = !task.currentGallerySynced && task.visualManifest?.galleryPolicy === "REPLACE_APPROVED_SLOTS_ONLY" &&
    Array.isArray(task.visualManifest.slotReplacements) ? task.visualManifest.slotReplacements as
      { targetImagePosition: number; assetId: string }[] : []
  const slotKey = JSON.stringify(manifestSlots)
  useEffect(() => { setSelected(Object.fromEntries((JSON.parse(slotKey) as
    { targetImagePosition: number; assetId: string }[]).map(r => [r.targetImagePosition, r.assetId]))) }, [slotKey])
  async function save() {
    setSaving(true); setMessage("")
    try {
      await visualRequest("/api/admin/ebay/mayel-visual-workstation", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SAVE_GALLERY_SLOTS",
          visualTaskId: task.visualTaskId, expectedVisualManifestDigest: task.visualManifestDigest,
          expectedCurrentImages: task.currentImages,
          slotReplacements: Object.entries(selected).filter(([,id]) => Boolean(id)).map(([position,assetId]) =>
            ({ targetImagePosition: Number(position), assetId })) }) })
      await onDone(); setMessage("Preview guardado. Revisa cada posición antes de confirmar la sincronización.")
    } catch (error) { await onDone(); setMessage(error instanceof Error ? error.message : "No pudimos guardar el Preview.") }
    finally { setSaving(false) }
  }
  async function confirmPreview() {
    setSaving(true); setMessage("")
    try {
      await visualRequest("/api/admin/ebay/mayel-visual-workstation", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CONFIRM_GALLERY_PREVIEW", visualTaskId: task.visualTaskId,
          expectedVisualManifestDigest: task.visualManifestDigest, confirmation: "CONFIRM_FULL_GALLERY_PREVIEW_V1" }) })
      setMessage("Pendiente de sincronizar. Seller OS recibió el Preview confirmado; puedes cerrar el iPad.")
      await onDone()
    } catch (error) { setMessage(error instanceof Error ? error.message : "No pudimos confirmar el Preview.") }
    finally { setSaving(false) }
  }
  const fullDecisions = task.visualManifest?.galleryMutationContract === "MAYEL_FULL_GALLERY_MUTATION_V1" && Array.isArray(task.visualManifest.galleryDecisions)
    ? task.visualManifest.galleryDecisions as { action: string; sourcePosition: number | null; targetPosition: number | null; visualRole: string; intentReason: string; beforeImage: string | null; afterImage: string | null }[] : []
  if (fullDecisions.length) return <section className="mt-7 rounded-2xl border p-5" aria-label="Antes y después de la galería completa">
    <h4 className="text-xl font-semibold">Orden que Mayel preparó para eBay</h4>
    <p className="mt-2 text-sm">Mayel comprueba la galería actual antes de sincronizar. Cada cambio conserva su posición exacta.</p>
    {task.galleryRebaseRequired && <p role="status">La galería cambió. Mayel debe reevaluar estas posiciones.</p>}
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[...fullDecisions].sort((a,b) => (a.targetPosition ?? 25)-(b.targetPosition ?? 25)).map((d,i) =>
      <article key={i} className="rounded-xl border bg-white p-3" data-image-position={d.targetPosition ?? undefined}>
        <p className="font-semibold">{d.targetPosition === null ? `Retirar imagen ${d.sourcePosition! + 1}` : d.targetPosition === 0 ? "Principal" : `Imagen ${d.targetPosition + 1}`}</p>
        <p className="text-sm">{({ KEEP: "Conservar", REPLACE: "Reemplazar", REMOVE: "Eliminar", ADD: "Agregar", REORDER: "Mover", REPLACE_MAIN: "Reemplazar principal" } as Record<string,string>)[d.action]} · {({ MAIN: "Principal", PRIMARY_BENEFIT: "Beneficio", DETAIL: "Detalle", DIMENSIONS: "Dimensiones", PACKAGE_CONTENTS: "Contenido", LIFESTYLE: "Uso / Lifestyle", CURRENT: "Imagen actual" } as Record<string,string>)[d.visualRole] ?? "Imagen del producto"}</p>
        {d.sourcePosition !== null && d.targetPosition !== null && d.sourcePosition !== d.targetPosition && <p className="text-xs">Imagen {d.sourcePosition + 1} → Imagen {d.targetPosition + 1}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2"><figure>{d.beforeImage ? <img src={d.beforeImage} alt="Antes" className="aspect-square w-full object-contain"/> : <p>Posición nueva</p>}<figcaption>Antes</figcaption></figure>
          <figure>{d.afterImage ? <img src={d.afterImage} alt="Después" className="aspect-square w-full object-contain"/> : <p>Se elimina</p>}<figcaption>Después</figcaption></figure></div>
        <p className="mt-2 text-sm">{d.intentReason}</p>
      </article>)}</div>
    <p className="mt-3 text-sm">{task.currentGallerySynced ? "Sincronizada con eBay: orden confirmado oficialmente." : "Preparada. La sincronización requiere confirmar todas las posiciones en eBay."}</p>
  </section>
  const explicitPreview = task.visualManifest?.intentContract === "MAYEL_VISUAL_INTENT_V1" && Array.isArray(task.visualManifest.slotPreview)
    ? task.visualManifest.slotPreview as { targetImagePosition: number; before: string | null; after: string; action: string; assetId: string | null }[] : []
  if (explicitPreview.some(p => p.action === "ADD")) return <section className="mt-7 rounded-2xl border p-5" aria-label="Preview completo de la galería">
    <h4 className="text-xl font-semibold">Preview completo de la galería</h4>
    <p className="mt-2">Se conservan las imágenes actuales en su orden. Sólo se añaden o reemplazan las posiciones indicadas.</p>
    {!task.currentGalleryProven && <p>Esperando la galería oficial completa. La propuesta sigue guardada.</p>}
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{explicitPreview.map(p => <article key={p.targetImagePosition} className="rounded-xl border p-3">
      <p>Posición {p.targetImagePosition + 1}{p.targetImagePosition === 0 ? " · Principal" : ""} · {p.action === "ADD" ? "Añadir" : p.action === "REPLACE" ? "Reemplazar" : "Conservar"}</p>
      <div className="mt-2 grid grid-cols-2 gap-2"><figure>{p.before ? <img src={p.before} alt="Antes" className="aspect-square w-full object-contain"/> : <p>Posición nueva</p>}<figcaption>Antes</figcaption></figure>
        <figure><img src={p.after} alt="Después" className="aspect-square w-full object-contain"/><figcaption>Después</figcaption></figure></div>
    </article>)}</div>
    {owner && !task.autonomousOptimization && <button type="button" disabled={busy || saving || !task.currentGalleryProven || task.galleryRebaseRequired ||
      explicitPreview.some(p => p.assetId && !task.outputs.find(o => o.id === p.assetId)?.sync?.approvedForEbaySync)}
      onClick={() => void confirmPreview()} className="mt-4 min-h-11 rounded-xl border px-4 disabled:opacity-40">Confirmar este Preview para sincronizar con eBay</button>}
    {message && <p role="status" className="mt-3">{message}</p>}
  </section>
  return <section className="mt-7 rounded-2xl border border-[#cbd9d4] bg-[#f8fbf9] p-5"
    data-mayel-ordered-six-image-workflow data-full-official-gallery>
    <h4 className="font-serif text-xl font-semibold">Galería actual de eBay</h4>
    <p className="mt-2 text-sm">{task.currentGalleryProven ? `${task.currentImages.length} imágenes en su orden oficial.` :
      "Esperando la galería oficial completa. Tus propuestas siguen guardadas."} Sólo cambia la posición que selecciones.</p>
    {task.currentGallerySynced && <p role="status" className="mt-2 text-sm">Sincronizado. eBay confirma estas {task.currentImages.length} posiciones.</p>}
    {task.galleryRebaseRequired && <p role="status" className="mt-2 text-sm">La galería cambió. Revisa el nuevo Preview; la sincronización está detenida.</p>}
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{task.currentImages.map((before, position) => {
      const asset = approved.find(o => o.id === selected[position])
      const after = asset?.previewUrl ?? before
      return <article key={`${position}:${before}`} data-image-position={position} className="rounded-xl border bg-white p-3">
        <p className="font-semibold">{position === 0 ? "Principal" : `Imagen ${position + 1}`}</p>
        <div className="mt-2 grid grid-cols-2 gap-2"><figure><img src={before} alt={`Antes · posición ${position + 1}`} className="aspect-square w-full object-contain"/><figcaption>Antes</figcaption></figure>
          <figure><img src={after} alt={`Después · posición ${position + 1}`} className="aspect-square w-full object-contain"/><figcaption>Después</figcaption></figure></div>
        <p className="mt-2 text-sm">{asset ? "Reemplazar" : "Conservar"}</p>
        <label className="mt-2 block text-xs">Tratamiento de esta posición
          <select aria-label={`Tratamiento posición ${position + 1}`} value={selected[position] ?? ""}
            disabled={busy || saving || !task.currentGalleryProven}
            onChange={e => setSelected(current => ({ ...current, [position]: e.target.value }))}
            className="mt-1 min-h-11 w-full rounded-lg border px-2">
            <option value="">Conservar</option>{approved.map(o => <option key={o.id} value={o.id}
              disabled={Object.entries(selected).some(([p,id]) => Number(p) !== position && id === o.id)}>
              Reemplazar con propuesta · {labels[o.mayel_output_role]}</option>)}
          </select></label>
        <button type="button" disabled={busy || saving} onClick={() => void navigator.clipboard.writeText(
          `${task.prompt}\nTARGET_IMAGE_POSITION=${position}\nMejora sólo esta posición usando las fuentes autorizadas. Conserva la identidad del producto. Imagen de referencia: ${before}`)
          .then(() => setMessage(`Prompt de mejora copiado para la posición ${position + 1}. Las otras posiciones se conservan.`))}
          className="mt-2 min-h-11 rounded-lg border px-3 text-xs">Crear mejora de esta posición</button>
      </article>
    })}</div>
    <button type="button" disabled={busy || saving || !task.currentGalleryProven || !Object.values(selected).some(Boolean)}
      onClick={() => void save()} className="mt-4 min-h-11 rounded-xl bg-[#1d5961] px-4 text-sm font-semibold text-white disabled:opacity-40">Guardar Preview de estas posiciones</button>
    {owner && !task.autonomousOptimization && manifestSlots.length > 0 && <button type="button" disabled={busy || saving || task.galleryRebaseRequired ||
      !task.currentGalleryProven || JSON.stringify(selected) !== JSON.stringify(Object.fromEntries(manifestSlots.map(r => [r.targetImagePosition,r.assetId])))}
      onClick={() => void confirmPreview()} className="ml-2 mt-4 min-h-11 rounded-xl border border-[#1d5961] px-4 text-sm font-semibold disabled:opacity-40">Confirmar este Preview para sincronizar</button>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </section>
}

function OwnerPreview({ task, canOwnerAuthorize, delegation, canOperate, busy, onDone }: {
  task: VisualTask
  canOwnerAuthorize: boolean
  delegation: VisualDelegation | null
  canOperate: boolean
  busy: boolean
  onDone: () => Promise<void>
}) {
  const [discarding, setDiscarding] = useState<string | null>(null)
  const [discardMessage, setDiscardMessage] = useState("")
  async function discard(assetId: string) {
    if (discarding || busy || !canOperate) return
    setDiscarding(assetId); setDiscardMessage("")
    try {
      await visualRequest("/api/admin/ebay/mayel-visual-workstation", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DISCARD_PROPOSALS_V1", visualTaskId: task.visualTaskId, expectedItemId: task.ebayItemId,
          expectedVisualManifestDigest: task.visualManifestDigest, assetIds: [assetId] }) })
      await onDone(); setDiscardMessage("Propuesta descartada. Las fotos de eBay no cambiaron.")
    } catch (error) {
      setDiscardMessage(error instanceof Error && /RECONCILIATION|IN_PROGRESS/.test(error.message)
        ? "Esta propuesta tiene un envío en curso. Primero hay que confirmar su estado en eBay."
        : "No se descartó la propuesta. La vista pudo cambiar; actualiza y vuelve a intentarlo.")
    } finally { setDiscarding(null) }
  }
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
  const syncState = task.outputs.some(o => o.sync?.state === "REQUIRES_ATTENTION") ? "REQUIRES_ATTENTION" :
    task.outputs.every(o => o.sync?.state === "SYNCED") && task.outputs.length ? "SYNCED" :
    task.outputs.some(o => o.sync?.approvedForEbaySync) ? "PENDING_EBAY_SYNC" : "OWNER_APPROVAL_REQUIRED"
  const friendly = friendlyVisualSyncV1(syncState)
  return <section className="rounded-2xl border border-[#74866d]/35 bg-[#f4f7f1] p-5">
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#617159]">Listing existente · cambios de imágenes</p>
    <h4 className="mt-2 font-serif text-xl font-semibold">Galería de eBay y propuesta de Mayel</h4>
    <p className="mt-2 text-sm text-[#5f645e]">Item {task.ebayItemId} · {task.productTitle}</p>
    <p className="mt-2 text-sm text-[#5f645e]">Campos que cambiarían: imágenes solamente. Mayel decide la principal y el orden exacto dentro de la delegación visual activa.</p>
    <p className="mt-2 text-xs text-[#617159]">Calidad revisada: {task.outputs.filter((output) => !output.discarded && output.status === "approved").length} · Autorizadas para sincronizar: {task.outputs.filter(output => output.sync?.approvedForEbaySync).length}. {task.autonomousOptimization ? "Mayel trabaja con tu delegación permanente." : "Cada propuesta requiere aprobación individual."}</p>
    <section className="mt-5 rounded-xl border bg-white p-3" aria-label="Última galería verificada de eBay">
      <h5 className="font-semibold">ANTES · Última galería verificada de eBay · {task.currentImages.length} fotos</h5>
      <p className="mt-1 text-sm">Es la última lectura guardada. Se comprobará otra vez antes de sincronizar.</p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{task.currentImages.map((url,p) => <figure key={`${p}:${url}`}>
        <img src={url} alt={`Foto de eBay ${p+1}`} className="aspect-square w-full rounded-lg object-contain" />
        <figcaption className="text-sm font-semibold">{p === 0 ? "Principal" : `Imagen ${p+1}`} · eBay</figcaption>
      </figure>)}</div>
    </section>
    <h5 className="mt-6 font-semibold">DESPUÉS · Preview de Mayel · {proposed.length} posiciones</h5>
    <p className="mt-1 text-sm">Esta numeración pertenece a la propuesta. No confirma que las imágenes ya estén en eBay.</p>
    <p className="mt-1 text-sm">Descartar una propuesta cancela su cambio y conserva la foto original; no elimina fotos publicadas.</p>
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{proposed.map((entry, index) => {
      const output = task.outputs.find(o => o.id === entry.assetId)
      const slot = (Array.isArray(task.visualManifest?.slotPreview) ? task.visualManifest.slotPreview as Record<string,unknown>[] : [])
        .find(p => p.targetImagePosition === index || p.targetPosition === index)
      const action = String(slot?.action ?? (entry.assetId ? index >= task.currentImages.length ? "ADD" : "REPLACE" : "KEEP"))
      const label = proposalSlotLabelV1(index, typeof slot?.sourcePosition === "number" ? slot.sourcePosition : index < task.currentImages.length ? index : null, action)
      return <figure key={`${entry.assetId ?? "current"}-${index}`}
        className="rounded-xl border border-[#d6dfd1] bg-white p-2">
        <img src={String(entry.publicUrl ?? "")} alt="Imagen propuesta para revisión del owner"
          className="aspect-square w-full rounded-lg object-contain" />
        <figcaption className="mt-2 text-sm font-semibold text-[#617159]">{label.slot} · {entry.assetId ? "Propuesta Mayel" : "Foto original"}</figcaption>
        <p className="mt-1 text-sm">{output ? labels[output.mayel_output_role] : "Imagen actual"} · {label.action}</p>
        {Boolean(entry.assetId) && canOperate && !output?.discarded && <button type="button" disabled={busy || Boolean(discarding) || applied || output?.sync?.officialReadback === true}
          onClick={() => void discard(String(entry.assetId))} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#a65742] px-2 py-2 text-sm text-[#893c2b] disabled:opacity-50"
          aria-label={`Descartar propuesta ${index+1}`}><Trash2 className="h-4 w-4" />{discarding === entry.assetId ? "Descartando…" : "Descartar propuesta"}</button>}
      </figure>})}</div>
    {discardMessage && <p role="status" className="mt-3 rounded-lg bg-white p-3 text-sm">{discardMessage}</p>}
    <p role="status" className="mt-4 font-semibold">{friendly.label}</p><p className="mt-2 text-sm">{friendly.action}</p>
    <details className="mt-4"><summary>Ver detalles</summary>
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
      <p>Galería de Mayel: {phaseB?.mayelManifestValid
        ? "lista" : phaseB?.safeRebaseAvailable
          ? "reconciliándose automáticamente" : "preparando cambio"}</p>
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
    <p className="mt-4 break-all text-[10px] text-[#777a73]">Manifest: {phaseB?.visualManifestDigest ?? task.visualManifestDigest}</p></details>
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
      completa y cada imagen tenga tu aprobación individual para sincronizar.
    </p>}
    {canOwnerAuthorize && !phase && phaseB?.mayelAssetPreserved &&
      <p className="mt-2 text-xs text-[#617159]">La imagen aprobada por Mayel permanece conservada; no requiere volver a subirla. Su autorización de sincronización se comprueba por separado.</p>}
    {phase && <p className={`mt-4 rounded-xl p-3 text-sm font-semibold ${applied ? "bg-[#e3ebe1] text-[#425143]" : "bg-[#f7e9de] text-[#704d3c]"}`}>
      {applied ? "Imágenes aplicadas y verificadas oficialmente ✓" :
        friendly.label}
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

function PortfolioOverview({ listings, canOperate, busy, onOpen }: {
  listings: readonly RemoteLiveOperatorListingV1[]
  canOperate: boolean
  busy: boolean
  onOpen: (itemId: string) => Promise<void>
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
  const visualEligible = listings.filter((listing) =>
    listing.optimization.visualEligibility === "ELIGIBLE").length
  const visualPriority = listings.filter((listing) =>
    listing.optimization.visualPriority === "HIGH").length
  return <section className="mt-7 rounded-[28px] border border-[#cbd9d4] bg-[#f8fbf9] p-5 sm:p-7"
    data-all-live-listings-visible-to-mayel={listings.length > 0}>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1d5961]">Portfolio LIVE completo</p>
        <h3 className="mt-2 font-serif text-2xl font-semibold">Optimización comercial continua</h3>
        <p className="mt-2 text-sm text-[#64675f]">Todos los listings LIVE ({listings.length}) · {visualEligible} elegibles para enriquecimiento visual.</p>
        <p className="mt-1 text-sm font-semibold text-[#1d5961]">Prioridad para mejorar ahora ({visualPriority})</p>
        <p className="mt-1 text-xs text-[#777a73]">Mercado y economía ordenan la prioridad; no bloquean el trabajo visual. {needsMarket} requieren mercado fresco · {needsEvidence} tienen facts restringidos.</p></div>
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
            <span className="rounded-full bg-[#dceee9] px-2.5 py-1 text-[11px] font-semibold text-[#1d5961]">{listing.optimization.visualEligibility === "ELIGIBLE" ? "Elegible visual" : "Bloqueado visual"}</span>
            <span className="rounded-full bg-[#f7e9de] px-2.5 py-1 text-[11px] font-semibold text-[#704d3c]">Prioridad {listing.optimization.visualPriority === "HIGH" ? "alta" : listing.optimization.visualPriority === "MEDIUM" ? "media" : "normal"}</span>
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
      {canOperate && listing.optimization.visualEligibility === "ELIGIBLE" &&
        <button type="button" disabled={busy}
          onClick={() => void onOpen(listing.ebayItemId)}
          className="mt-4 min-h-11 rounded-xl bg-[#1d5961] px-4 text-sm font-semibold text-white disabled:opacity-40">Abrir en Estación visual</button>}
    </details>)}</div>
  </section>
}

export function MayelVisualWorkstation({ canOperate,
  canOwnerAuthorize = false, commercialIntelligenceByItemId = {},
  livePortfolio = [], focusedItemId = null, localOutbox }: {
  canOperate: boolean
  focusedItemId?: string | null
  localOutbox?: VisualLocalOutbox
  canOwnerAuthorize?: boolean
  commercialIntelligenceByItemId?: Readonly<Record<string,
    MayelCommercialIntelligenceV1>>
  livePortfolio?: readonly RemoteLiveOperatorListingV1[]
}) {
  const [tasks, setTasks] = useState<VisualTask[]>([])
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState("")
  const [delegation, setDelegation] = useState<VisualDelegation | null>(null)
  const [priceDelegation, setPriceDelegation] =
    useState<PriceDelegation | null>(null)
  const [commercialDelegation, setCommercialDelegation] =
    useState<CommercialDelegation | null>(null)
  const [promotionDelegation, setPromotionDelegation] =
    useState<PromotionDelegation | null>(null)
  const [marketRevalidationByItemId, setMarketRevalidationByItemId] =
    useState<Record<string, MarketRevalidationStatus>>({})
  const [selectedVisualTaskId, setSelectedVisualTaskId] =
    useState<string | null>(null)

  const loadGeneration = useRef(0)
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    const payload = await visualRequest(
      focusedItemId ? `/api/admin/ebay/mayel-visual-workstation?savedOnly=1&itemId=${encodeURIComponent(focusedItemId)}` : "/api/admin/ebay/mayel-visual-workstation")
    const workstation = payload.workstation as { tasks?: VisualTask[] } | undefined
    if (generation !== loadGeneration.current) return
    const nextTasks = scopedVisualTasksV1(workstation?.tasks ?? [], focusedItemId)
    setTasks(nextTasks)
    if (focusedItemId) setSelectedVisualTaskId(nextTasks.find(t => t.ebayItemId === focusedItemId)?.visualTaskId ?? null)
    setDelegation((payload.delegation as VisualDelegation | undefined) ?? null)
    setPriceDelegation((payload.priceDelegation as PriceDelegation |
      undefined) ?? null)
    setCommercialDelegation((payload.commercialDelegation as
      CommercialDelegation | undefined) ?? null)
    setPromotionDelegation((payload.promotionDelegation as
      PromotionDelegation | undefined) ?? null)
  }, [focusedItemId])

  useEffect(() => {
    if (!selectedVisualTaskId) return
    let active = true
    const refreshGallery = () => {
      if (document.visibilityState !== "visible") return
      void visualRequest("/api/admin/ebay/mayel-visual-workstation", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          action: "READ_CURRENT_GALLERY", visualTaskId: selectedVisualTaskId }) })
        .then(() => { if (active) return load() }).catch(() => {})
    }
    refreshGallery()
    document.addEventListener("visibilitychange", refreshGallery)
    return () => { active = false; document.removeEventListener("visibilitychange", refreshGallery) }
  }, [selectedVisualTaskId, load])

  const selectedMarketItemId = tasks.find(task => task.visualTaskId === selectedVisualTaskId)?.ebayItemId
  useEffect(() => {
    if (focusedItemId || !selectedMarketItemId) return
    let active = true
    void visualRequest("/api/admin/ebay/live-optimization-operator", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "READ_MARKET_REVALIDATION_STATUS",
        ebayItemId: selectedMarketItemId }),
    }).then((payload) => {
      const status = payload.result as MarketRevalidationStatus | undefined
      if (active && status?.connectorAvailable === true) {
        setMarketRevalidationByItemId((current) => ({ ...current,
          [selectedMarketItemId]: status }))
      }
    }).catch(() => {
      // Commercial intelligence is best-effort and never blocks visual work.
    })
    return () => { active = false }
  }, [selectedMarketItemId, focusedItemId])

  useEffect(() => {
    if (!selectedVisualTaskId) return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`mayel-task-${selectedVisualTaskId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectedVisualTaskId])

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
    return () => { active = false; ++loadGeneration.current }
  }, [canOperate, load])

  async function openVisualListing(ebayItemId: string) {
    if (!canOperate || busy || (focusedItemId && ebayItemId !== focusedItemId)) return
    setBusy(true)
    setMessage("")
    try {
      const payload = await visualRequest(
        "/api/admin/ebay/mayel-visual-workstation", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ENSURE_VISUAL_TASK", ebayItemId }),
        })
      const visualTaskId = typeof payload.visualTaskId === "string"
        ? payload.visualTaskId : null
      if (!visualTaskId) throw new Error(
        "Este listing todavía no tiene una tarea visual elegible.")
      await load()
      setSelectedVisualTaskId(visualTaskId)
    } catch (error) {
      setMessage(error instanceof Error ? error.message :
        "No pudimos abrir este listing en la Estación visual.")
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

  async function refreshSavedTask(task: VisualTask) {
    const payload = await visualRequest(`/api/admin/ebay/mayel-visual-workstation?savedOnly=1&itemId=${encodeURIComponent(task.ebayItemId)}`)
    const saved = (payload.workstation as { tasks?: VisualTask[] } | undefined)?.tasks?.find(t => t.visualTaskId === task.visualTaskId && t.ebayItemId === task.ebayItemId)
    if (!saved) throw Error("No pudimos recuperar la propuesta guardada.")
    ++loadGeneration.current
    setTasks(current => current.map(t => t.visualTaskId === task.visualTaskId ? saved : t))
  }

  return <section aria-labelledby="visual-workstation-heading">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1d5961]">Operación visual humana</p>
    <h2 id="visual-workstation-heading" className="mt-2 font-serif text-3xl font-semibold">Estación visual</h2>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-[#64675f]">Seller OS prepara la evidencia y el prompt. Tú generas las imágenes manualmente en tu propia suscripción de ChatGPT y las devuelves aquí para revisión segura.</p>
    <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
      <span className="rounded-full bg-[#e3ebe1] px-3 py-2 text-[#425143]">ChatGPT manual</span>
      <span className="rounded-full bg-[#e3ebe1] px-3 py-2 text-[#425143]">Hasta seis propuestas por listing</span>
    </div>
    {!focusedItemId && <><FullVisualDelegationPanel delegation={delegation}
      owner={canOwnerAuthorize} busy={busy} onDone={refresh} />
    <CommercialOptimizationDelegationPanel delegation={commercialDelegation}
      owner={canOwnerAuthorize} busy={busy} onDone={refresh} />
    <ValidatedPriceDelegationPanel delegation={priceDelegation}
      owner={canOwnerAuthorize} busy={busy} onDone={refresh} />
    <PromotionSpendDelegationPanel delegation={promotionDelegation}
      owner={canOwnerAuthorize} busy={busy} onDone={refresh} />
    <PortfolioOverview listings={livePortfolio} canOperate={canOperate}
      busy={busy} onOpen={openVisualListing} /></>}
    {message && <div className="mt-4 rounded-xl bg-[#f7e9de] p-4 text-sm text-[#704d3c]"><p>Requiere atención. Revisa el estado de tu propuesta guardada.</p><details><summary>Ver detalles</summary><p>{message}</p></details></div>}
    {!busy && !tasks.length && <div className="mt-6 rounded-[28px] border border-[#d9d1c4] bg-[#fffdf8] p-7">
      <h3 className="font-serif text-2xl font-semibold">No hay una oportunidad visual lista</h3>
      <p className="mt-2 text-sm leading-6 text-[#64675f]">Seller OS no fabricará una tarea. Aparecerá aquí cuando una publicación activa tenga identidad, verdad del producto, imágenes autorizadas y una oportunidad visual demostrada.</p>
    </div>}
    {selectedVisualTaskId && <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#e3ebe1] p-4 text-sm text-[#425143]">
      <strong>Trabajando ahora · tarea visual abierta</strong>
      {!focusedItemId && <button type="button" onClick={() => setSelectedVisualTaskId(null)}
        className="min-h-10 rounded-xl border border-[#82947d] bg-white px-3 text-xs font-semibold">Ver todas las tareas</button>}
    </div>}
    <div className="mt-6 space-y-7">{scopedVisualTasksV1(tasks, focusedItemId, selectedVisualTaskId)
      .map((task) => <article
      key={task.visualTaskId}
      id={`mayel-task-${task.visualTaskId}`}
      data-selected-visual-task={task.visualTaskId === selectedVisualTaskId}
      className="scroll-mt-6 rounded-[28px] border border-[#d9d1c4] bg-[#fffdf8] p-5 shadow-[0_18px_50px_rgba(55,45,32,0.07)] sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#74866d]">Tarea visual · {task.sku}</p>
          <h3 className="mt-2 font-serif text-2xl font-semibold">{task.productTitle}</h3>
          {task.latestOptimization && <p className="mt-2 text-sm font-medium" role="status">
            {task.latestOptimization.state === "SYNCED" && task.latestOptimization.officialReadback
              ? `🟢 ${task.latestOptimization.label}: sincronizado con eBay`
              : task.latestOptimization.state === "REQUIRES_ATTENTION" ? `🔴 ${task.latestOptimization.label}: requiere atención`
              : `🟠 ${task.latestOptimization.label}: guardado · Sincronizando con eBay`}
          </p>}
          <p className="mt-1 text-xs text-[#777a73]">Publicación eBay {task.ebayItemId}</p></div>
        <span className="rounded-full bg-[#e3ebe1] px-3 py-2 text-xs font-semibold text-[#425143]">{focusedItemId ? friendlyVisualSyncV1(task.visualStationState).label : portfolioTaskStatus(task,
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
        <details className="mt-4"><summary>Ver detalles</summary>
        <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-black/20 p-4 text-xs leading-5 text-white/85">{task.prompt}</pre></details>
        <button type="button" onClick={() => void navigator.clipboard.writeText(task.prompt)}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[#26312d]"><Clipboard className="h-4 w-4" />Copiar prompt</button>
      </section>}
      <section className="mt-6" aria-label="Checklist creativo del listing">
        <div className="flex items-center gap-2"><Check className="h-5 w-5 text-[#1d5961]" />
          <h4 className="font-semibold">Checklist creativo del listing</h4></div>
        <p className="mt-1 text-xs leading-5 text-[#6f736c]">Aquí ves qué puedes crear. Después de subir cada imagen aparecerá su checklist de control de calidad.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">{task.promptSlots.map((slot) =>
        <div key={slot.role} className={`rounded-xl p-3 text-xs ${slot.status === "READY" ? "bg-[#e3ebe1] text-[#425143]" : "bg-[#f7e9de] text-[#704d3c]"}`}>
          <strong>{labels[slot.role]}</strong><span className="mt-1 block">{slot.status === "READY" ? "Libre para crear" : "Crear sin claim factual"}</span>
          {slot.factClaimRestricted && <span className="mt-1 block">Evidencia factual pendiente; el trabajo visual continúa.</span>}
        </div>)}</div>
      </section>
      {canOperate && <div className="mt-6"><UploadPanel key={task.visualTaskId} task={task} busy={busy} localOutbox={localOutbox}
        onDone={refresh} /></div>}
      {task.outputs.length > 0 && <section className="mt-7">
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-[#1d5961]" />
          <h4 className="font-semibold">Control de calidad y revisión de Mayel</h4></div>
        <div className="mt-4 space-y-4">{task.outputs.filter(o => !o.discarded).map((output) =>
          <HumanQa key={output.id} task={task} output={output} busy={busy} owner={canOwnerAuthorize}
            onDone={refresh} />)}</div>
      </section>}
      {canOperate && <details className="mt-5 rounded-xl border p-3"><summary className="cursor-pointer min-h-11 py-2 font-semibold">Ajustar posiciones de las propuestas</summary>
        <OrderedGalleryManager task={task} owner={canOwnerAuthorize} busy={busy} onDone={refresh} /></details>}
      <div className="mt-6"><OwnerPreview task={task}
        canOwnerAuthorize={canOwnerAuthorize} delegation={delegation} canOperate={canOperate} busy={busy} onDone={() => refreshSavedTask(task)} /></div>
      {task.outputs.some(o => o.discarded) && <details className="mt-5 rounded-xl border p-3"><summary className="cursor-pointer min-h-11 py-2 font-semibold">Propuestas descartadas · historial</summary>
        <p className="text-sm">Se conservan como historial y no se enviarán a eBay.</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{task.outputs.filter(o => o.discarded).map(o => <figure key={o.id}>
          {o.previewUrl && <img src={o.previewUrl} alt={`Propuesta descartada: ${labels[o.mayel_output_role]}`} className="aspect-square w-full object-contain" />}
          <figcaption className="text-sm">{labels[o.mayel_output_role]} · Descartada</figcaption></figure>)}</div>
      </details>}
      <details className="mt-5 rounded-xl border border-[#e0d9ce] p-3 text-xs text-[#6f736c]">
        <summary className="cursor-pointer py-2 font-semibold">Ver detalles</summary>
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
