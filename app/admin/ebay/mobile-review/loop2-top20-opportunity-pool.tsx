"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { supabase } from "@/lib/supabase"

type QueueItem = {
  id: string
  supplier_product_id: string
  supplier_variant_id: string
  supplier_sku: string
  discovery_strategy: "EBAY_FIRST" | "LUNA_FIRST"
  luna_match_status: string
  package_hash: string | null
  product_identity_fingerprint: string | null
  base_product_fingerprint: string | null
  offer_pack_fingerprint: string | null
  cohort: "READY_FOR_OPERATOR_APPROVAL" | "NEEDS_DATA" | "REJECTED"
  pool_rank: number | null
  rank: number | null
  ranking_score: number
  reason_codes: string[]
  evidence_snapshot: {
    product?: {
      name?: string | null
      lunaUrl?: string | null
      authorizedImageUrl?: string | null
      variant?: string | null
      capturedAt?: string | null
    }
    logistics?: {
      weight?: number | null
      weightUnit?: string | null
      dimensions?: { length?: number; width?: number; height?: number; unit?: string } | null
      supplierShippingCostStatus?: string
      supplierShippingReserveUsd?: number | null
    }
    evidence?: {
      activeExactCount?: number
      soldExactCount?: number
      estimatedDemandCount?: number
      confidence?: string
      scores?: { demandConfidence?: number; competitionPressure?: number }
    } | null
    economics?: {
      minimumSafePrice?: number | null
      targetPrice?: number | null
      estimatedProfit?: number | null
      roiPercent?: number | null
      netMarginPercent?: number | null
    } | null
    packStrategy?: {
      recommendedPack?: Pack | null
      alternativePack?: Pack | null
      matrix?: Pack[]
    } | null
    operatorConfirmationRequired?: boolean
    discovery?: {
      origin?: "EBAY_FIRST" | "LUNA_FIRST"
      lunaMatchStatus?: string
      ebayFirstEvidence?: {
        demandEvidence?: string
        demandConfidence?: number
        activeListingCount?: number | null
        sellerCount?: number | null
        observedAt?: string | null
      } | null
    }
    strategicIntelligence?: {
      evidenceClass?: string
      score?: number
      confirmedSoldEvidence?: boolean
      estimatedMovementSeparated?: boolean
      ebayFirstCorroborated?: boolean
      causalityClaimed?: false
    } | null
    optimizationEvidence?: {
      marketEvidence?: {
        activeSellerCount?: number | null
        verifiedSoldSellerCount?: number | null
        estimatedSoldSellerCount?: number | null
        evidenceBasis?: string | null
      }
      sellerPatterns?: {
        freeShippingPrevalencePercent?: number | null
        returnsPrevalencePercent?: number | null
      }
      titleStructurePatterns?: string[]
      visualEvidence?: {
        status?: string
        activeExactSampleSize?: number
        soldExactSampleSize?: number
        usableSampleSize?: number
        confidence?: string
        imageMetadataOnly?: boolean
        competitorImagesDownloaded?: 0
        competitorImagesCopied?: 0
      }
    } | null
  }
  operator_action: "APPROVED" | "DISCARDED" | null
  supplier_price_observed: number | null
  supplier_availability_confirmation: string | null
  supplier_unit_quantity: number | null
  stock_confidence: string | null
  recommended_pack_count: number | null
  available_offer_pack_capacity: number | null
  ebay_listing_quantity: number | null
  supplier_shipping_cost_status: string
  supplier_shipping_reserve_usd: number | null
  supplier_confirmed_at: string | null
  analyzed_at: string
}

type Pack = {
  packCount?: number
  totalUnitCount?: number | null
  medianLandedPrice?: number | null
  medianPricePerUnit?: number | null
  decision?: string
  evidenceConfidence?: string
  operationalRisk?: string[]
  economics?: {
    targetPrice?: number | null
    sellerProfit?: number | null
    roiPercent?: number | null
    netMarginPercent?: number | null
  }
}

type QueuePayload = {
  success?: boolean
  error?: string
  run?: {
    status: string
    automation_status?: string
    dispatch_status?: string
    phase?: string
    catalog_total: number
    catalog_examined: number
    candidates_analyzed: number
    preselected_count?: number
    ready_count: number
    go_count?: number
    go_with_changes_count?: number
    no_go_count?: number
    needs_data_count: number
    rejected_count: number
    retry_count: number
    identity_enriched_count?: number
    identity_conflict_count?: number
    catalog_read_count?: number
    browse_read_count?: number
    coverage_before?: Record<string, number>
    coverage_after?: Record<string, number>
    source_coverage?: Record<string, number>
    ebay_first_status?: string
    ebay_first_category_count?: number
    ebay_first_signal_count?: number
    ebay_first_exact_luna_match_count?: number
    ebay_first_match_counts?: Record<string, number>
    ebay_first_observed_at?: string | null
    exact_match_count?: number
    excluded_internal_count?: number
    current_batch?: number
    continuation_attempt_count?: number
    dispatch_attempt_count?: number
    dispatch_recovery_count?: number
    progress_percent?: number
    last_activity_at?: string | null
    last_checkpoint_at?: string | null
    next_continuation_at?: string | null
    last_error_code?: string | null
    rate_limit?: {
      consecutiveCount: number
      retryAfterSeconds: number | null
      backoffSeconds: number | null
      source: string | null
      observedAt: string | null
    }
    error_recoverable?: boolean
    dispatch_diagnostic?: {
      errorClass?: string | null
      httpStatus?: number | null
      elapsedMs?: number | null
      observedAt?: string | null
      hostFingerprint?: string | null
      bypassConfigured?: boolean
      protectionCookiePresent?: boolean
      xVercelId?: string | null
      queueMessageFingerprint?: string | null
    }
    priority_counts?: Record<string, number>
    diagnostic_counts?: Record<string, number>
  } | null
  pool?: QueueItem[]
  ready?: QueueItem[]
  internalCounts?: {
    needsData: number
    rejected: number
    stale: number
    reanalysisRequired: number
  }
  productFacts?: ProductFactsStatus
}

type ProductFactsCandidateStatus = {
  gates?: Record<string, boolean>
  counts?: Record<string, number>
  requirements?: Record<string, number>
  exception?: {
    fieldRequired?: string
    whyItMatters?: string
    sourcesAlreadyChecked?: string[]
    exactEvidenceNeeded?: string
    blockingStatus?: string
  } | null
  observedAt?: string | null
}

type ProductFactsStatus = {
  version: string
  latestRun: {
    id: string
    status: string
    candidatesRequested: number
    candidatesProcessed: number
    candidatesExcluded: number
    sourceReads: Record<string, number>
    completedAt: string | null
  } | null
  byCandidate: Record<string, ProductFactsCandidateStatus>
  coverage: { candidates: number; openAiInputReady: number; publicationFactsReady: number }
  safety: { openAiCalls: 0; ebayWrites: 0; productionChanged: false; cookiesStored: false; sourceUrlsStored: false; rawPagesStored: false; competitorImagesStored: false; piiStored: false }
}

type ConfirmationDraft = {
  priceObserved: string
  availability: "EXACT_QUANTITY_VISIBLE" | "AVAILABLE_QUANTITY_NOT_SHOWN" | "OUT_OF_STOCK"
  exactQuantity: string
}

type SoldEvidenceStatus = {
  configured: boolean
  reviewedObservationCount: number
  latest: {
    id: string
    source_type: string
    source_export_type: string
    evidence_scope: "MARKET_WIDE_SOLD_EVIDENCE" | "OWN_ACCOUNT_SOLD_EVIDENCE"
    market_wide_schema_confirmed: boolean
    source_row_count: number
    valid_count: number
    confirmed_sale_count: number
    completed_without_sale_count: number
    imported_count: number
    duplicate_count: number
    rejected_count: number
    source_observed_start: string | null
    source_observed_end: string | null
    imported_at: string
  } | null
  coverage: {
    exactMatches: number
    ambiguousMatches: number
    withoutLunaMatch: number
    top20CandidatesEnriched: number
  }
  maxRows: number
  recencyDays: number
  rawFilesStored: false
  competitorTitlesStored: false
  sellerIdentitiesStored: false
  competitorImageUrlsStored: false
  piiStored: false
  openAiCalls: 0
  ebayWrites: 0
}

type ProductResearchCaptureStatus = {
  configured: boolean
  source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE"
  latest: {
    source_row_count: number
    valid_count: number
    imported_count: number
    duplicate_count: number
    rejected_count: number
    exact_luna_match_count: number
    different_pack_count: number
    different_size_count: number
    different_variant_count: number
    ambiguous_count: number
    no_luna_match_count: number
    candidates_enriched_count: number
    captured_at: string
  } | null
  readyResultCount: number
  queryPlan?: {
    status: "ACTIVE" | "COMPLETED" | "SUPERSEDED"
    queryCount: number
    candidateCount: number
    capturedCount: number
    pendingCount: number
    nextQuery: {
      ordinal: number
      searchQuery: string
      categoryId: string | null
      candidateCount: number
    } | null
    tasks: Array<{
      id: string
      ordinal: number
      search_query: string
      category_id: string | null
      candidate_count: number
      status: string
    }>
  } | null
  browseQuota?: {
    status: "AVAILABLE" | "UNAVAILABLE"
    limit: number | null
    count: number | null
    remaining: number | null
    resetAt: string | null
    observedAt: string
    payloadStored: false
    secretsExposed: false
    ebayWrites: 0
  }
  rawHtmlStored: false
  temporaryTitlesStored: false
  competitorImagesDownloaded: 0
  piiStored: false
  openAiCalls: 0
  ebayWrites: 0
}

type ProductIdentityReconciliationStatus = {
  version: string
  aggregates: {
    reconciled: number
    exact: number
    differentPack: number
    differentSize: number
    differentVariant: number
    ambiguous: number
    withoutLunaMatch: number
    conflicted: number
    candidatesEnriched: number
  }
  readyResultCount: number
  latestReconciledAt: string | null
  customLabelComparedToSupplierSku: false
  competitorSkuComparedToSupplierSku: false
  rawObservationsChanged: false
  piiStored: false
  competitorImagesDownloaded: 0
  openAiCalls: 0
  ebayWrites: 0
  productionChanged: false
}

type MarketplaceInsightsPreflight = {
  environment: "PREVIEW" | "BLOCKED"
  preview: boolean
  staging: boolean
  branchMatch: boolean
  clientPair: "PRESENT" | "MISSING"
  configuredFlag: "TRUE" | "FALSE"
  requestedScope: "BUY_MARKETPLACE_INSIGHTS"
  scopeConfirmed: boolean
  tokenStatus: string
  entitlement: string
  historyRequest: "AVAILABLE" | "REJECTED" | "NOT_EXECUTED"
  httpStatus: number | null
  observedAt: string
  safety: {
    payloadStored: false
    payloadReturned: false
    secretsExposed: false
    piiExposed: false
    openAiCalls: 0
    ebayWrites: 0
    productionChanged: false
  }
}

function rateLimitWaitLabel(nextAt: string | null | undefined, nowMs: number) {
  const nextMs = Date.parse(nextAt ?? "")
  if (!Number.isFinite(nextMs) || !nowMs) return null
  const remainingMinutes = Math.max(0, Math.ceil((nextMs - nowMs) / 60_000))
  const hours = Math.floor(remainingMinutes / 60)
  const minutes = remainingMinutes % 60
  const now = new Date(nowMs)
  const next = new Date(nextMs)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const nextDay = new Date(next.getFullYear(), next.getMonth(), next.getDate()).getTime()
  const day = nextDay === today ? "hoy" : nextDay - today === 86_400_000 ? "mañana" :
    next.toLocaleDateString("es")
  return {
    remaining: hours ? `${hours} h ${minutes} min` : `${minutes} min`,
    day,
    ready: nextMs <= nowMs,
  }
}

function money(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "N/D"
}

function percent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "N/D"
}

function availabilityLabel(value: ConfirmationDraft["availability"]) {
  if (value === "EXACT_QUANTITY_VISIBLE") return "Cantidad exacta visible"
  if (value === "AVAILABLE_QUANTITY_NOT_SHOWN") return "Disponible, cantidad no visible"
  return "Agotado"
}

function reason(code: string) {
  const labels: Record<string, string> = {
    AUTHORIZED_IMAGE_PROVENANCE_REQUIRED: "Falta confirmar automáticamente la autorización de la imagen Luna.",
    PACKAGE_DIMENSIONS_REQUIRED: "Luna no entregó dimensiones estructuradas.",
    PACKAGE_WEIGHT_REQUIRED: "Luna no entregó peso estructurado.",
    STRONG_PRODUCT_IDENTIFIER_REQUIRED: "Falta GTIN válido o Brand + MPN/model verificable.",
    EXACT_CONTENTS_REQUIRED: "Falta el contenido exacto estructurado del paquete.",
    PACK_COUNT_REQUIRED: "Falta el número exacto de unidades del pack.",
    EBAY_CATEGORY_REQUIRED: "Falta categoría eBay oficial.",
    REQUIRED_ASPECTS_REQUIRED: "Faltan item specifics requeridos.",
    APPROVED_KEYWORDS_REQUIRED: "Faltan keywords verificadas por evidencia.",
    PACKAGING_COST_REQUIRED: "Falta costo automático de empaque.",
    FIXED_FULFILLMENT_COST_REQUIRED: "Falta costo operativo fijo configurado.",
    OUTBOUND_SHIPPING_ESTIMATE_REQUIRED: "Falta estimación automática de envío al comprador.",
    LUNA_OUT_OF_STOCK: "Luna reporta el producto agotado.",
    LUNA_OUT_OF_STOCK_OBSERVATION: "Agotado: movido a observación; el siguiente candidato ocupa su lugar.",
    LOOP1_NO_GO: "Loop 1 determinó NO_GO.",
    PROFIT_BELOW_5_USD: "Beneficio menor a US$5.",
    ROI_BELOW_30_PERCENT: "ROI menor a 30%.",
    NET_MARGIN_BELOW_20_PERCENT: "Margen neto menor a 20%.",
    COMPLIANCE_BLOCKED: "Producto bloqueado por compliance.",
    TOP20_CONTINUATION_DISPATCH_FAILED: "La continuación automática está pausada; el checkpoint permanece guardado.",
    SOLD_EVIDENCE_PII_COLUMNS_REJECTED: "El archivo contiene columnas de comprador, pedido o contacto y fue rechazado completo.",
    SOLD_EVIDENCE_NO_VALID_ROWS: "El archivo no contiene filas vendidas con identificador fuerte, pack y fecha verificables.",
    SOLD_EVIDENCE_OPERATOR_ATTESTATION_REQUIRED: "Confirma que el archivo proviene de una exportación oficial de eBay.",
    SOLD_EVIDENCE_FILE_SIZE_INVALID: "El archivo está vacío o supera el límite seguro de 2 MB.",
    SOLD_EVIDENCE_ROW_LIMIT_EXCEEDED: "El archivo supera 2,000 filas; divídelo en exports oficiales más pequeños.",
  }
  return labels[code] ?? code.replaceAll("_", " ")
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error("AUTH_REQUIRED")
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? "TOP20_REQUEST_FAILED")
  return payload
}

function requestKey(action: string, id: string) {
  return `${action}:${id}:${crypto.randomUUID()}`
}

export function Loop2Top20OpportunityPool() {
  const [payload, setPayload] = useState<QueuePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState("")
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [drafts, setDrafts] = useState<Record<string, ConfirmationDraft>>({})
  const [evidenceId, setEvidenceId] = useState("")
  const [soldEvidenceStatus, setSoldEvidenceStatus] = useState<SoldEvidenceStatus | null>(null)
  const [soldEvidenceFile, setSoldEvidenceFile] = useState<File | null>(null)
  const [soldEvidenceSource, setSoldEvidenceSource] = useState(
    "EBAY_PRODUCT_RESEARCH_EXPORT",
  )
  const [soldEvidenceAttested, setSoldEvidenceAttested] = useState(false)
  const [browserCaptureStatus, setBrowserCaptureStatus] =
    useState<ProductResearchCaptureStatus | null>(null)
  const [identityReconciliationStatus, setIdentityReconciliationStatus] =
    useState<ProductIdentityReconciliationStatus | null>(null)
  const [marketplaceInsightsPreflight, setMarketplaceInsightsPreflight] =
    useState<MarketplaceInsightsPreflight | null>(null)
  const [clockMs, setClockMs] = useState(0)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError("")
    try {
      setPayload(await adminFetch<QueuePayload>("/api/admin/ebay/listing-ai/approval-queue"))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "TOP20_STATUS_UNAVAILABLE")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  const loadSoldEvidence = useCallback(async () => {
    try {
      const result = await adminFetch<{ status: SoldEvidenceStatus }>(
        "/api/admin/ebay/listing-ai/sold-evidence",
      )
      setSoldEvidenceStatus(result.status)
    } catch {
      setSoldEvidenceStatus(null)
    }
  }, [])

  const loadBrowserCapture = useCallback(async () => {
    try {
      const result = await adminFetch<{ status: ProductResearchCaptureStatus }>(
        "/api/admin/ebay/listing-ai/product-research-capture",
      )
      setBrowserCaptureStatus(result.status)
    } catch {
      setBrowserCaptureStatus(null)
    }
  }, [])

  const loadIdentityReconciliation = useCallback(async () => {
    try {
      const result = await adminFetch<{ status: ProductIdentityReconciliationStatus }>(
        "/api/admin/ebay/listing-ai/product-research-reconciliation",
      )
      setIdentityReconciliationStatus(result.status)
    } catch {
      setIdentityReconciliationStatus(null)
    }
  }, [])

  useEffect(() => { void load(); void loadSoldEvidence(); void loadBrowserCapture(); void loadIdentityReconciliation() },
    [load, loadSoldEvidence, loadBrowserCapture, loadIdentityReconciliation])
  const scanActive = ["RUNNING", "PARTIAL_AUTO_CONTINUING"].includes(payload?.run?.status ?? "")
  const rateLimitPaused = payload?.run?.status === "PAUSED_RATE_LIMIT"
  useEffect(() => {
    if (!scanActive) return
    const timer = window.setInterval(() => void load(true), 2_500)
    return () => window.clearInterval(timer)
  }, [load, scanActive])
  useEffect(() => {
    if (!rateLimitPaused) return
    setClockMs(Date.now())
    const timer = window.setInterval(() => setClockMs(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [rateLimitPaused])
  const productResearchPlanActive = (browserCaptureStatus?.queryPlan?.pendingCount ?? 0) > 0
  useEffect(() => {
    if (!productResearchPlanActive) return
    const timer = window.setInterval(() => void loadBrowserCapture(), 8_000)
    return () => window.clearInterval(timer)
  }, [loadBrowserCapture, productResearchPlanActive])

  const pool = payload?.pool ?? []
  const discoveryDiagnostics = payload?.run?.diagnostic_counts ?? {}
  const invalidEmptyCompletion = payload?.run?.status === "COMPLETED" &&
    (payload.run.catalog_examined ?? 0) >= (payload.run.catalog_total ?? 0) &&
    (payload.run.preselected_count ?? 0) === 0 &&
    (payload.run.candidates_analyzed ?? 0) === 0 &&
    Number(discoveryDiagnostics.PRESELECTION_POLICY_V2 ?? 0) !== 1
  const counts = useMemo(() => ({
    ready: payload?.ready?.length ?? 0,
    managedInternally: (payload?.internalCounts?.needsData ?? 0) +
      (payload?.internalCounts?.rejected ?? 0) +
      (payload?.internalCounts?.stale ?? 0) +
      (payload?.internalCounts?.reanalysisRequired ?? 0),
  }), [payload])
  const rateLimitWait = rateLimitWaitLabel(payload?.run?.next_continuation_at, clockMs)

  const scan = async () => {
    setWorkingId("scan"); setError(""); setMessage("")
    try {
      const response = await adminFetch<{ result: { status: string } }>(
        "/api/admin/ebay/listing-ai/approval-queue", {
        method: "POST", body: JSON.stringify({ action: "scan" }),
      })
      await load()
      setMessage(response.result.status === "PAUSED_RATE_LIMIT"
        ? "La pausa oficial continúa. El checkpoint está guardado y Seller OS no repetirá productos."
        : "Escaneo iniciado. Puedes cerrar esta página; Seller OS continuará automáticamente.")
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "TOP20_SCAN_FAILED")
    } finally {
      setWorkingId("")
    }
  }

  const enrichProductFacts = async () => {
    setWorkingId("product-facts"); setError(""); setMessage("")
    try {
      const response = await adminFetch<{ result: {
        candidatesRequested: number; candidatesProcessed: number; candidatesExcluded: number
      } }>("/api/admin/ebay/listing-ai/product-facts", {
        method: "POST", headers: { "Idempotency-Key": requestKey("product-facts", "top20") },
        body: JSON.stringify({ action: "enrich" }),
      })
      await load()
      setMessage(`Ficha técnica automatizada: ${response.result.candidatesProcessed} candidato(s) enriquecido(s), ${response.result.candidatesExcluded} excluido(s) de forma segura. Discovery no se repitió; OpenAI 0 y escrituras eBay 0.`)
    } catch (factsError) {
      setError(factsError instanceof Error ? factsError.message : "PRODUCT_FACT_ENRICHMENT_FAILED")
    } finally {
      setWorkingId("")
    }
  }

  const verifyMarketplaceInsights = async () => {
    setWorkingId("marketplace-insights-preflight"); setError(""); setMessage("")
    try {
      const response = await adminFetch<{ result: MarketplaceInsightsPreflight }>(
        "/api/admin/ebay/marketplace-insights/preflight",
        {
          method: "POST",
          headers: {
            "Idempotency-Key": requestKey("marketplace-insights-preflight", "entitlement"),
          },
        },
      )
      setMarketplaceInsightsPreflight(response.result)
      setMessage(response.result.entitlement === "AUTHORIZED"
        ? "Marketplace Insights está autorizado para evidencia oficial de ventas."
        : "Preflight completado sin secretos. Revisa el resultado oficial antes de cambiar el flujo.")
    } catch (preflightError) {
      setError(preflightError instanceof Error
        ? preflightError.message
        : "MARKETPLACE_INSIGHTS_PREFLIGHT_FAILED")
    } finally {
      setWorkingId("")
    }
  }

  const copyResearchQuery = async (query: string) => {
    try {
      await navigator.clipboard.writeText(query)
      setMessage("Consulta agrupada copiada. Ejecútala en Product Research y usa Capturar y continuar.")
    } catch {
      setError("PRODUCT_RESEARCH_QUERY_COPY_FAILED")
    }
  }

  const reconcileProductResearch = async () => {
    setWorkingId("identity-reconciliation"); setError(""); setMessage("")
    try {
      const response = await adminFetch<{ result: {
        observationsProcessed: number
        aggregates: ProductIdentityReconciliationStatus["aggregates"]
        reanalysis: { affectedTargets: number; dispatchStatus: string | null }
      } }>("/api/admin/ebay/listing-ai/product-research-reconciliation", {
        method: "POST",
        headers: { "Idempotency-Key": requestKey("identity-reconciliation", "all") },
        body: JSON.stringify({ action: "reconcile" }),
      })
      await Promise.all([load(), loadBrowserCapture(), loadIdentityReconciliation()])
      setMessage(`Reconciliación automática completada: ${response.result.observationsProcessed} observaciones; ` +
        `${response.result.aggregates.exact} exactas; ${response.result.aggregates.differentPack} de pack relacionado; ` +
        `${response.result.aggregates.differentSize} de tamaño relacionado. ` +
        `Loop 1 reanaliza sólo ${response.result.reanalysis.affectedTargets} target(s); Discovery no se repite.`)
    } catch (reconciliationError) {
      setError(reconciliationError instanceof Error
        ? reconciliationError.message : "PRODUCT_IDENTITY_RECONCILIATION_FAILED")
    } finally {
      setWorkingId("")
    }
  }

  const importSoldEvidence = async () => {
    if (!soldEvidenceFile || !soldEvidenceAttested) return
    setWorkingId("sold-evidence"); setError(""); setMessage("")
    try {
      const extension = soldEvidenceFile.name.split(".").at(-1)?.toLocaleLowerCase("en-US")
      if (extension !== "csv" && extension !== "json") throw new Error("SOLD_EVIDENCE_FORMAT_INVALID")
      const content = await soldEvidenceFile.text()
      const result = await adminFetch<{ result: {
        duplicate: boolean
        importedCount: number
        duplicateCount: number
        rejectedCount: number
        rowCount: number
        validCount: number
        confirmedSaleCount: number
        completedWithoutSaleCount: number
        evidenceScope: "MARKET_WIDE_SOLD_EVIDENCE" | "OWN_ACCOUNT_SOLD_EVIDENCE"
        scan: { status?: string } | null
      } }>("/api/admin/ebay/listing-ai/sold-evidence", {
        method: "POST",
        headers: { "Idempotency-Key": requestKey("sold-evidence", soldEvidenceFile.name) },
        body: JSON.stringify({
          action: "import",
          format: extension.toLocaleUpperCase("en-US"),
          sourceExportType: soldEvidenceSource,
          content,
          operatorAttested: true,
        }),
      })
      setSoldEvidenceFile(null); setSoldEvidenceAttested(false)
      await Promise.all([load(), loadSoldEvidence()])
      setMessage(result.result.duplicate
        ? "Este archivo oficial ya había sido importado; no se duplicó evidencia ni trabajo."
        : `Archivo amplio procesado: ${result.result.rowCount} filas; válidas ${result.result.validCount}; ventas confirmadas ${result.result.confirmedSaleCount}; completados sin venta ${result.result.completedWithoutSaleCount}; importadas ${result.result.importedCount}; duplicadas ${result.result.duplicateCount}; rechazadas ${result.result.rejectedCount}. Seller OS reanalizará el mismo run automáticamente.`)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "SOLD_EVIDENCE_IMPORT_FAILED")
    } finally {
      setWorkingId("")
    }
  }

  const updateDraft = (id: string, patch: Partial<ConfirmationDraft>) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] ?? {
        priceObserved: "", availability: "AVAILABLE_QUANTITY_NOT_SHOWN", exactQuantity: "",
      }), ...patch },
    }))
  }

  const confirmLuna = async (item: QueueItem) => {
    const draft = drafts[item.id] ?? { priceObserved: "", availability: "AVAILABLE_QUANTITY_NOT_SHOWN", exactQuantity: "" }
    setWorkingId(item.id); setError(""); setMessage("")
    try {
      await adminFetch(`/api/admin/ebay/listing-ai/approval-queue/${encodeURIComponent(item.id)}/confirm-luna`, {
        method: "POST",
        headers: { "Idempotency-Key": requestKey("confirm-luna", item.id) },
        body: JSON.stringify({
          priceObserved: Number(draft.priceObserved), availability: draft.availability,
          exactQuantity: draft.availability === "EXACT_QUANTITY_VISIBLE" ? Number(draft.exactQuantity) : null,
        }),
      })
      await load()
      setMessage(draft.availability === "OUT_OF_STOCK"
        ? "Producto movido a observación; el ranking promovió el siguiente candidato."
        : "Precio y disponibilidad confirmados; economía y ranking recalculados.")
    } catch (confirmationError) {
      setError(confirmationError instanceof Error ? confirmationError.message : "LUNA_CONFIRMATION_FAILED")
    } finally {
      setWorkingId("")
    }
  }

  const approve = async (item: QueueItem) => {
    if (!item.package_hash || !window.confirm("Aprobar este paquete y pack exactos para una única generación OpenAI posterior? No se llamará OpenAI ahora.")) return
    setWorkingId(item.id); setError(""); setMessage("")
    try {
      await adminFetch(`/api/admin/ebay/listing-ai/approval-queue/${encodeURIComponent(item.id)}/approve`, {
        method: "POST", headers: { "Idempotency-Key": requestKey("approve", item.id) },
        body: JSON.stringify({ packageHash: item.package_hash, confirmed: true }),
      })
      await load(); setMessage("Paquete fijado y aprobado para una única generación posterior. OpenAI calls: 0.")
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : "TOP20_APPROVAL_FAILED")
    } finally {
      setWorkingId("")
    }
  }

  const discard = async (item: QueueItem) => {
    setWorkingId(item.id); setError(""); setMessage("")
    try {
      await adminFetch(`/api/admin/ebay/listing-ai/approval-queue/${encodeURIComponent(item.id)}/discard`, {
        method: "POST", headers: { "Idempotency-Key": requestKey("discard", item.id) },
      })
      await load(); setMessage("Candidato descartado; el pool fue reordenado automáticamente.")
    } catch (discardError) {
      setError(discardError instanceof Error ? discardError.message : "TOP20_DISCARD_FAILED")
    } finally {
      setWorkingId("")
    }
  }

  return (
    <section aria-labelledby="top20-heading" className="space-y-4 rounded-2xl border border-cyan-200/25 bg-cyan-200/[0.06] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-black uppercase tracking-widest text-cyan-100/65">Discovery → Loop 1 automático → Top 20</p><h3 id="top20-heading" className="text-lg font-black">Top 20 automatizado</h3></div>
        <button type="button" onClick={() => void scan()}
          disabled={workingId === "scan" || scanActive || Boolean(rateLimitWait && !rateLimitWait.ready)}
          className="min-h-11 rounded-2xl bg-cyan-200 px-4 font-black text-black disabled:opacity-40">{workingId === "scan" ? "Iniciando…" : scanActive ? "Análisis en progreso" : rateLimitWait && !rateLimitWait.ready ? `Pausa eBay · ${rateLimitWait.remaining}` : rateLimitPaused ? "Reanudar desde checkpoint" : "Analizar y actualizar oportunidades"}</button>
      </div>
      {loading ? <p role="status">Cargando pool…</p> : (
        <>
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Catálogo / examinados</dt><dd className="text-lg font-black">{payload?.run?.catalog_total ?? 0} / {payload?.run?.catalog_examined ?? 0}</dd></div>
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Preseleccionados</dt><dd className="text-lg font-black">{payload?.run?.preselected_count ?? 0}</dd></div>
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Procesados por Loop 1</dt><dd className="text-lg font-black">{payload?.run?.candidates_analyzed ?? 0}</dd></div>
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Top 20 READY</dt><dd className="text-lg font-black">{counts.ready}</dd></div>
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">GO</dt><dd className="text-lg font-black">{payload?.run?.go_count ?? 0}</dd></div>
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">GO_WITH_CHANGES</dt><dd className="text-lg font-black">{payload?.run?.go_with_changes_count ?? 0}</dd></div>
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">NO_GO internos</dt><dd className="text-lg font-black">{payload?.run?.no_go_count ?? 0}</dd></div>
            <div className="rounded-xl bg-black/25 p-2"><dt className="text-white/50">Excluidos internos</dt><dd className="text-lg font-black">{payload?.run?.excluded_internal_count ?? counts.managedInternally}</dd></div>
          </dl>
          <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
            <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-200 transition-[width]" style={{ width: `${payload?.run?.progress_percent ?? 0}%` }} /></div>
            <p>Estado de análisis: <strong>{payload?.run?.status ?? "NOT_STARTED"}</strong> · fase {payload?.run?.phase ?? "NOT_STARTED"} · progreso {payload?.run?.progress_percent ?? 0}% · lote {payload?.run?.current_batch ?? 0}</p>
            <p className="text-white/55">Último checkpoint: {payload?.run?.last_checkpoint_at ? new Date(payload.run.last_checkpoint_at).toLocaleString("es") : "N/D"} · última actividad: {payload?.run?.last_activity_at ? new Date(payload.run.last_activity_at).toLocaleString("es") : "N/D"}</p>
            <p className="text-white/55">Continuación: {payload?.run?.dispatch_status ?? "NOT_SCHEDULED"} · intentos {payload?.run?.dispatch_attempt_count ?? 0} · recuperaciones {payload?.run?.dispatch_recovery_count ?? 0} · próxima: {payload?.run?.next_continuation_at ? new Date(payload.run.next_continuation_at).toLocaleString("es") : "N/D"}</p>
            {scanActive && <p className="font-bold text-cyan-50">Puedes cerrar esta página. Seller OS continuará automáticamente.</p>}
            {payload?.run?.status === "PAUSED_RATE_LIMIT" && <div className="space-y-1 font-bold text-amber-100">
              <p>Pausa ordenada por eBay, no fallo de Seller OS. El progreso está guardado y no se repetirán productos ya procesados.</p>
              {rateLimitWait && <p>{rateLimitWait.ready
                ? "El tiempo indicado por eBay ya terminó; usa el mismo botón para reanudar desde el checkpoint."
                : `eBay indicó reanudar ${rateLimitWait.day}. Faltan aproximadamente ${rateLimitWait.remaining}; Seller OS no hará llamadas antes.`}</p>}
              <p>Backoff adaptativo: {payload.run.rate_limit?.backoffSeconds
                ? `${Math.ceil(payload.run.rate_limit.backoffSeconds / 60)} min` : "N/D"} · fuente {payload.run.rate_limit?.source ?? "N/D"} · intentos consecutivos {payload.run.rate_limit?.consecutiveCount ?? 0}.</p>
            </div>}
            {payload?.run?.status === "PAUSED_DISPATCH_RECOVERABLE" && <p className="font-bold text-amber-100">El análisis está pausado y su progreso está guardado. Seller OS reanudará desde el último checkpoint al usar el mismo botón.</p>}
            {payload?.run?.dispatch_diagnostic?.errorClass && <p className="text-white/55">Diagnóstico de continuación: {payload.run.dispatch_diagnostic.errorClass} · HTTP {payload.run.dispatch_diagnostic.httpStatus ?? "N/D"} · {payload.run.dispatch_diagnostic.elapsedMs ?? 0} ms.</p>}
            {payload?.run?.last_error_code && <p className="text-rose-100">Error sanitizado: {reason(payload.run.last_error_code)}</p>}
          </div>
          {payload?.run && <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
            <p className="font-black">Cobertura automática por fuentes autorizadas</p>
            <p className="mt-1 text-white/65">Discovery con candidatos eBay: {discoveryDiagnostics.DISCOVERY_WITH_CANDIDATES ?? "pendiente"} · aptos para Loop 1: {discoveryDiagnostics.DISCOVERY_PRESELECTED ?? payload.run.preselected_count ?? 0}</p>
            <p className="mt-1 text-white/65">Loop 1 enriquecido: {payload.run.identity_enriched_count ?? 0} · conflictos excluidos: {payload.run.identity_conflict_count ?? 0} · Browse detallado: {payload.run.browse_read_count ?? 0} · Catalog: {payload.run.catalog_read_count ?? 0}</p>
            <p className="mt-1 text-white/65">eBay-first: {payload.run.ebay_first_status ?? "NOT_STARTED"} · categorías {payload.run.ebay_first_category_count ?? 0} · señales {payload.run.ebay_first_signal_count ?? 0} · coincidencias Luna exactas {payload.run.ebay_first_exact_luna_match_count ?? 0}</p>
            <p className="mt-1 text-white/55">Brand {payload.run.coverage_before?.brand ?? 0} → {payload.run.coverage_after?.brand ?? 0} · GTIN/MPN {payload.run.coverage_before?.gtinOrMpn ?? 0} → {payload.run.coverage_after?.gtinOrMpn ?? 0} · pack {payload.run.coverage_before?.pack ?? 0} → {payload.run.coverage_after?.pack ?? 0} · peso {payload.run.coverage_before?.weight ?? 0} → {payload.run.coverage_after?.weight ?? 0} · dimensiones {payload.run.coverage_before?.dimensions ?? 0} → {payload.run.coverage_after?.dimensions ?? 0}</p>
          </div>}
          <section aria-labelledby="product-facts-heading" className="space-y-3 rounded-xl border border-violet-200/20 bg-violet-100/[0.04] p-3 text-xs">
            <div>
              <h4 id="product-facts-heading" className="font-black">Ficha técnica automatizada</h4>
              <p className="mt-1 text-white/60">Procesa sólo los candidatos exactos Luna del Top 20: unidad física, oferta, paquete de envío y requisitos oficiales eBay. No abre Discovery, no llama OpenAI y no escribe en eBay.</p>
            </div>
            <button type="button" onClick={() => void enrichProductFacts()}
              disabled={workingId === "product-facts" || scanActive || !pool.length}
              className="min-h-11 w-full rounded-xl bg-violet-100 font-black text-violet-950 disabled:opacity-40">
              {workingId === "product-facts" ? "Corroborando hechos…" : "Completar ficha técnica automáticamente"}
            </button>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div><dt className="text-white/45">Último run</dt><dd>{payload?.productFacts?.latestRun?.status ?? "PENDIENTE"}</dd></div>
              <div><dt className="text-white/45">Procesados / solicitados</dt><dd>{payload?.productFacts?.latestRun?.candidatesProcessed ?? 0} / {payload?.productFacts?.latestRun?.candidatesRequested ?? 0}</dd></div>
              <div><dt className="text-white/45">OpenAI input ready</dt><dd>{payload?.productFacts?.coverage.openAiInputReady ?? 0}</dd></div>
              <div><dt className="text-white/45">Publication facts ready</dt><dd>{payload?.productFacts?.coverage.publicationFactsReady ?? 0}</dd></div>
            </dl>
            <p className="text-white/45">Fuentes: Luna exact variant, eBay Catalog y Taxonomy oficiales; Browse/GetItem sólo se conservan como corroboración de identidad ya autorizada. Sin cookies, URLs fuente, HTML, imágenes, PII ni secretos.</p>
          </section>
          <section aria-labelledby="marketplace-insights-preflight-heading" className="space-y-3 rounded-xl border border-emerald-200/20 bg-emerald-100/[0.04] p-3 text-xs">
            <div>
              <h4 id="marketplace-insights-preflight-heading" className="font-black">API oficial de ventas de mercado</h4>
              <p className="mt-1 text-white/60">Comprueba si el keyset de Seller OS tiene acceso a Marketplace Insights. Hace una sola consulta oficial GET en Preview; no guarda ni devuelve resultados, tokens o payloads.</p>
            </div>
            <button
              type="button"
              disabled={workingId === "marketplace-insights-preflight" || scanActive}
              onClick={() => void verifyMarketplaceInsights()}
              className="min-h-11 w-full rounded-xl bg-emerald-100 px-4 font-black text-emerald-950 disabled:opacity-40"
            >
              {workingId === "marketplace-insights-preflight"
                ? "Verificando acceso oficial…"
                : "Verificar Marketplace Insights"}
            </button>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div><dt className="text-white/45">Client pair</dt><dd className="font-black">{marketplaceInsightsPreflight?.clientPair ?? "SIN VERIFICAR"}</dd></div>
              <div><dt className="text-white/45">Scope</dt><dd className="font-black">{marketplaceInsightsPreflight?.scopeConfirmed ? "CONFIRMADO" : marketplaceInsightsPreflight ? "NO" : "SIN VERIFICAR"}</dd></div>
              <div><dt className="text-white/45">Token OAuth</dt><dd>{marketplaceInsightsPreflight?.tokenStatus ?? "SIN VERIFICAR"}</dd></div>
              <div><dt className="text-white/45">Entitlement</dt><dd className="font-black">{marketplaceInsightsPreflight?.entitlement ?? "SIN VERIFICAR"}</dd></div>
              <div><dt className="text-white/45">Historial oficial</dt><dd>{marketplaceInsightsPreflight?.historyRequest ?? "SIN VERIFICAR"}</dd></div>
              <div><dt className="text-white/45">Preview / staging</dt><dd>{marketplaceInsightsPreflight ? `${marketplaceInsightsPreflight.preview ? "SÍ" : "NO"} / ${marketplaceInsightsPreflight.staging ? "SÍ" : "NO"}` : "SIN VERIFICAR"}</dd></div>
              <div><dt className="text-white/45">Rama</dt><dd>{marketplaceInsightsPreflight ? (marketplaceInsightsPreflight.branchMatch ? "MATCH" : "MISMATCH") : "SIN VERIFICAR"}</dd></div>
              <div><dt className="text-white/45">HTTP sanitizado</dt><dd>{marketplaceInsightsPreflight?.httpStatus ?? "N/D"}</dd></div>
            </dl>
            {marketplaceInsightsPreflight && <p className="text-white/55">Observado {new Date(marketplaceInsightsPreflight.observedAt).toLocaleString("es")} · payload guardado NO · secretos expuestos NO · OpenAI 0 · escrituras eBay 0 · Production sin cambios.</p>}
            <p className="text-white/45">La verificación no activa el adapter ni modifica variables. Si el entitlement es NOT_ENTITLED, Product Research seguirá siendo accesible sólo mediante las vías oficialmente habilitadas para la cuenta.</p>
          </section>
          <section aria-labelledby="product-research-capture-heading" className="space-y-3 rounded-xl border border-cyan-200/20 bg-cyan-100/[0.04] p-3 text-xs">
            <div>
              <h4 id="product-research-capture-heading" className="font-black">Captura oficial desde Product Research</h4>
              <p className="mt-1 text-white/60">Para cuentas sin export CSV/JSON: la extensión captura con un clic únicamente la tabla visible en la página oficial autenticada. No comparte cookies ni credenciales con Seller OS.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <a href="/seller-os-tools/ebay-product-research-capture-extension-v1.2.6.zip" download className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-cyan-100 px-4 font-black text-cyan-950">Descargar extensión asistida v1.2.6</a>
              <a href="https://www.ebay.com/sh/research" target="_blank" rel="noreferrer" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-white/20 px-4 font-black text-white">Abrir Product Research</a>
            </div>
            <p className="text-white/55">Instálala localmente una vez. La versión 1.2.6 reutiliza una sola sesión segura durante el lote, avanza automáticamente y resalta únicamente la acción que corresponde.</p>
            <div className="rounded-xl border border-amber-100/20 bg-amber-100/[0.04] p-3">
              <p className="font-black">Cuota oficial Browse</p>
              <p className="mt-1 text-white/55">Estado {browserCaptureStatus?.browseQuota?.status ?? "SIN VERIFICAR"} · restantes {browserCaptureStatus?.browseQuota?.remaining ?? "N/D"} de {browserCaptureStatus?.browseQuota?.limit ?? "N/D"} · reset {browserCaptureStatus?.browseQuota?.resetAt ? new Date(browserCaptureStatus.browseQuota.resetAt).toLocaleString("es") : "N/D"}.</p>
              <p className="mt-1 text-white/45">Seller OS reserva llamadas y pausa antes de agotar la cuota cuando eBay publica estos datos.</p>
            </div>
            {browserCaptureStatus?.queryPlan && <div className="space-y-2 rounded-xl border border-cyan-100/20 bg-black/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="font-black">Plan de consultas agrupadas</p><p className="text-white/55">{browserCaptureStatus.queryPlan.capturedCount} de {browserCaptureStatus.queryPlan.queryCount} capturadas · {browserCaptureStatus.queryPlan.candidateCount} candidatos cubiertos</p></div>
                <span className="rounded-full border border-white/20 px-2 py-1 font-black">{browserCaptureStatus.queryPlan.status}</span>
              </div>
              {browserCaptureStatus.queryPlan.nextQuery ? <>
                <div className="rounded-xl border border-violet-200/25 bg-violet-200/[0.07] p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-violet-100/65">Familia cubierta</p>
                  <p className="mt-1 font-black text-violet-50">Familia de {browserCaptureStatus.queryPlan.nextQuery.candidateCount} candidato(s)</p>
                </div>
                <label className="block rounded-xl border border-cyan-200/30 bg-cyan-200/[0.07] p-3 text-cyan-100/75">Consulta exacta que se enviará · #{browserCaptureStatus.queryPlan.nextQuery.ordinal}
                  <input readOnly value={browserCaptureStatus.queryPlan.nextQuery.searchQuery}
                    onFocus={(event) => event.currentTarget.select()}
                    className="mt-1 min-h-11 w-full rounded-xl border border-cyan-100/25 bg-black/30 px-3 font-bold text-cyan-50" />
                </label>
                <p className="text-white/45">Categoría {browserCaptureStatus.queryPlan.nextQuery.categoryId ?? "general"}.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <a href={`https://www.ebay.com/sh/research#seller-os-query=${encodeURIComponent(browserCaptureStatus.queryPlan.nextQuery.searchQuery)}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-cyan-100 px-4 text-center font-black text-cyan-950">Abrir Product Research</a>
                  <button type="button" onClick={() => void copyResearchQuery(browserCaptureStatus.queryPlan!.nextQuery!.searchQuery)}
                    className="min-h-11 w-full rounded-xl border border-cyan-100/35 px-4 text-center font-black text-cyan-50">Copiar consulta exacta</button>
                </div>
                <p className="text-white/45">1. Abre Product Research. 2. Espera los resultados nuevos. 3. Captura cuando la extensión lo habilite. Copiar es únicamente un respaldo visible.</p>
              </> : <p className="font-bold text-emerald-100">Todas las consultas agrupadas del plan fueron capturadas.</p>}
            </div>}
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div><dt className="text-white/45">Filas / válidas</dt><dd className="font-black">{browserCaptureStatus?.latest?.source_row_count ?? 0} / {browserCaptureStatus?.latest?.valid_count ?? 0}</dd></div>
              <div><dt className="text-white/45">Duplicadas / rechazadas</dt><dd>{browserCaptureStatus?.latest?.duplicate_count ?? 0} / {browserCaptureStatus?.latest?.rejected_count ?? 0}</dd></div>
              <div><dt className="text-white/45">Match exacto Luna</dt><dd>{browserCaptureStatus?.latest?.exact_luna_match_count ?? 0}</dd></div>
              <div><dt className="text-white/45">Pack diferente</dt><dd>{browserCaptureStatus?.latest?.different_pack_count ?? 0}</dd></div>
              <div><dt className="text-white/45">Tamaño diferente</dt><dd>{browserCaptureStatus?.latest?.different_size_count ?? 0}</dd></div>
              <div><dt className="text-white/45">Ambiguas / sin Luna</dt><dd>{browserCaptureStatus?.latest?.ambiguous_count ?? 0} / {browserCaptureStatus?.latest?.no_luna_match_count ?? 0}</dd></div>
              <div><dt className="text-white/45">Candidatos enriquecidos</dt><dd>{browserCaptureStatus?.latest?.candidates_enriched_count ?? 0}</dd></div>
              <div><dt className="text-white/45">READY resultantes</dt><dd>{browserCaptureStatus?.readyResultCount ?? 0}</dd></div>
            </dl>
            <div className="space-y-2 rounded-xl border border-emerald-200/20 bg-emerald-100/[0.04] p-3">
              <div>
                <p className="font-black">Reconciliación automática de identidad</p>
                <p className="mt-1 text-white/55">Cruza la evidencia vendida con GetItem cuando existe Item ID, Browse, Catalog y Taxonomy. Custom Label o SKU de competidores nunca se compara con el supplier SKU Luna.</p>
              </div>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div><dt className="text-white/45">Reconciliadas</dt><dd className="font-black">{identityReconciliationStatus?.aggregates.reconciled ?? 0}</dd></div>
                <div><dt className="text-white/45">Exactas</dt><dd>{identityReconciliationStatus?.aggregates.exact ?? 0}</dd></div>
                <div><dt className="text-white/45">Pack diferente</dt><dd>{identityReconciliationStatus?.aggregates.differentPack ?? 0}</dd></div>
                <div><dt className="text-white/45">Tamaño diferente</dt><dd>{identityReconciliationStatus?.aggregates.differentSize ?? 0}</dd></div>
                <div><dt className="text-white/45">Variante diferente</dt><dd>{identityReconciliationStatus?.aggregates.differentVariant ?? 0}</dd></div>
                <div><dt className="text-white/45">Ambiguas</dt><dd>{identityReconciliationStatus?.aggregates.ambiguous ?? 0}</dd></div>
                <div><dt className="text-white/45">Sin Luna / conflicto</dt><dd>{identityReconciliationStatus?.aggregates.withoutLunaMatch ?? 0} / {identityReconciliationStatus?.aggregates.conflicted ?? 0}</dd></div>
                <div><dt className="text-white/45">Candidatos enriquecidos</dt><dd>{identityReconciliationStatus?.aggregates.candidatesEnriched ?? 0}</dd></div>
              </dl>
              <button type="button" onClick={() => void reconcileProductResearch()}
                disabled={workingId === "identity-reconciliation" || scanActive ||
                  (browserCaptureStatus?.latest?.imported_count ?? 0) === 0}
                className="min-h-11 w-full rounded-xl bg-emerald-100 font-black text-emerald-950 disabled:opacity-40">
                {workingId === "identity-reconciliation" ? "Reconciliando…" : "Reconciliar evidencia automáticamente"}
              </button>
              <p className="text-white/45">La captura nueva ejecuta este paso automáticamente. Este botón reprocesa de forma idempotente evidencia ya existente y conserva sus observaciones originales.</p>
            </div>
            <p className="text-white/45">Privacidad: PII 0 · HTML 0 · títulos completos persistidos 0 · imágenes descargadas 0 · OpenAI 0 · escrituras eBay 0.</p>
          </section>
          <section aria-labelledby="sold-evidence-import-heading" className="space-y-3 rounded-xl border border-amber-200/20 bg-amber-100/[0.04] p-3 text-xs">
            <div>
              <h4 id="sold-evidence-import-heading" className="font-black">Evidencia oficial de ventas confirmadas</h4>
              <p className="mt-1 text-white/60">Importación masiva, temporal y ocasional de un solo export oficial amplio. No es investigación producto por producto y no llama OpenAI.</p>
            </div>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div><dt className="text-white/45">Observaciones revisadas</dt><dd className="font-black">{soldEvidenceStatus?.reviewedObservationCount ?? 0}</dd></div>
              <div><dt className="text-white/45">Último import</dt><dd>{soldEvidenceStatus?.latest?.imported_at ? new Date(soldEvidenceStatus.latest.imported_at).toLocaleString("es") : "N/D"}</dd></div>
              <div><dt className="text-white/45">Ventana admitida</dt><dd>{soldEvidenceStatus?.recencyDays ?? 90} días</dd></div>
              <div><dt className="text-white/45">Privacidad</dt><dd>PII 0 · raw files 0</dd></div>
              <div><dt className="text-white/45">Filas totales / válidas</dt><dd>{soldEvidenceStatus?.latest?.source_row_count ?? 0} / {soldEvidenceStatus?.latest?.valid_count ?? 0}</dd></div>
              <div><dt className="text-white/45">Ventas confirmadas</dt><dd>{soldEvidenceStatus?.latest?.confirmed_sale_count ?? 0}</dd></div>
              <div><dt className="text-white/45">Completados sin venta</dt><dd>{soldEvidenceStatus?.latest?.completed_without_sale_count ?? 0}</dd></div>
              <div><dt className="text-white/45">Duplicadas / rechazadas</dt><dd>{soldEvidenceStatus?.latest?.duplicate_count ?? 0} / {soldEvidenceStatus?.latest?.rejected_count ?? 0}</dd></div>
              <div><dt className="text-white/45">Match exacto Luna</dt><dd>{soldEvidenceStatus?.coverage.exactMatches ?? 0}</dd></div>
              <div><dt className="text-white/45">Ambiguas</dt><dd>{soldEvidenceStatus?.coverage.ambiguousMatches ?? 0}</dd></div>
              <div><dt className="text-white/45">Sin match Luna</dt><dd>{soldEvidenceStatus?.coverage.withoutLunaMatch ?? 0}</dd></div>
              <div><dt className="text-white/45">Top 20 enriquecidos</dt><dd>{soldEvidenceStatus?.coverage.top20CandidatesEnriched ?? 0}</dd></div>
            </dl>
            <p className="text-white/55">Semántica de la última fuente: {soldEvidenceStatus?.latest?.evidence_scope === "MARKET_WIDE_SOLD_EVIDENCE" ? "mercado completo" : soldEvidenceStatus?.latest ? "ventas de la cuenta propia" : "N/D"}. Un listing finalizado sin venta nunca se registra como CONFIRMED_SOLD.</p>
            <label className="block">Tipo de export oficial
              <select value={soldEvidenceSource} onChange={(event) => setSoldEvidenceSource(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-white/20 bg-black/30 px-3">
                <option value="EBAY_PRODUCT_RESEARCH_EXPORT">eBay Product Research</option>
                <option value="EBAY_SELLER_HUB_EXPORT">eBay Seller Hub (cuenta propia por defecto)</option>
                <option value="EBAY_MARKETPLACE_INSIGHTS_EXPORT">eBay Marketplace Insights</option>
              </select>
            </label>
            <label className="block">Archivo CSV o JSON
              <input type="file" accept=".csv,.json,text/csv,application/json" onChange={(event) => setSoldEvidenceFile(event.target.files?.[0] ?? null)} className="mt-1 block min-h-11 w-full rounded-xl border border-white/20 bg-black/30 p-2" />
            </label>
            <label className="flex items-start gap-2"><input type="checkbox" checked={soldEvidenceAttested} onChange={(event) => setSoldEvidenceAttested(event.target.checked)} /><span>Confirmo que es una exportación oficial de eBay sin datos de comprador, pedido, dirección, teléfono ni email.</span></label>
            <button type="button" disabled={!soldEvidenceFile || !soldEvidenceAttested || workingId === "sold-evidence" || scanActive} onClick={() => void importSoldEvidence()} className="min-h-11 w-full rounded-xl bg-amber-100 font-black text-black disabled:opacity-40">{workingId === "sold-evidence" ? "Validando e importando…" : "Importar evidencia y reanalizar"}</button>
            {!soldEvidenceFile && <p className="text-white/50">Selecciona un export oficial. Seller OS descartará filas sin identificador fuerte, pack o fecha.</p>}
            <p className="text-white/45">No se guardan archivos, títulos completos, vendedores ni URLs/imágenes de competidores. Sólo identidad normalizada, métricas agregables, hashes y patrones estructurados.</p>
          </section>
          {pool.length ? <div className="space-y-3">{pool.map((item) => {
            const product = item.evidence_snapshot.product ?? {}
            const economics = item.evidence_snapshot.economics
            const evidence = item.evidence_snapshot.evidence
            const pack = item.evidence_snapshot.packStrategy?.recommendedPack
            const alternative = item.evidence_snapshot.packStrategy?.alternativePack
            const strategic = item.evidence_snapshot.strategicIntelligence
            const optimization = item.evidence_snapshot.optimizationEvidence
            const productFacts = payload?.productFacts?.byCandidate[item.id]
            const draft = drafts[item.id] ?? { priceObserved: item.supplier_price_observed?.toString() ?? "", availability: "AVAILABLE_QUANTITY_NOT_SHOWN" as const, exactQuantity: "" }
            const ready = item.cohort === "READY_FOR_OPERATOR_APPROVAL"
            const confirmationReady = ready && Boolean(item.supplier_confirmed_at) && (item.available_offer_pack_capacity ?? 0) >= 1
            const exactQuantityMissing = draft.availability === "EXACT_QUANTITY_VISIBLE" &&
              (!draft.exactQuantity || Number(draft.exactQuantity) < 0 || !Number.isInteger(Number(draft.exactQuantity)))
            const confirmationBlockedReason = !draft.priceObserved
              ? "Ingresa el precio Luna observado."
              : exactQuantityMissing
                ? "Ingresa la cantidad exacta visible como número entero."
                : null
            return <article key={item.id} className="rounded-2xl border border-white/15 bg-black/20 p-3">
              <div className="flex gap-3">{product.authorizedImageUrl ? <img src={product.authorizedImageUrl} alt="Producto autorizado de Luna" className="h-20 w-20 rounded-xl bg-white object-contain" /> : <div className="grid h-20 w-20 place-items-center rounded-xl bg-black/30 text-xs text-white/40">Sin imagen autorizada</div>}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>#{item.pool_rank} · {product.name ?? "Producto Luna"}</strong><span className="rounded-full border border-white/20 px-2 py-1 text-[10px] font-black">{item.supplier_confirmed_at ? "READY_FOR_OPENAI_APPROVAL" : "LISTO PARA CONFIRMAR"}</span><span className="rounded-full border border-cyan-100/25 px-2 py-1 text-[10px] font-black">{item.discovery_strategy}</span></div><p className="mt-1 text-xs text-white/55">SKU {item.supplier_sku} · variante {item.supplier_variant_id} · match Luna {item.luna_match_status}</p><p className="text-xs text-white/55">Analizado {new Date(item.analyzed_at).toLocaleString("es")}</p></div></div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                <div><dt className="text-white/45">Pack recomendado</dt><dd>{pack?.packCount ?? "N/D"}</dd></div>
                <div><dt className="text-white/45">Precio objetivo</dt><dd>{money(economics?.targetPrice)}</dd></div>
                <div><dt className="text-white/45">Beneficio</dt><dd>{money(economics?.estimatedProfit)}</dd></div>
                <div><dt className="text-white/45">ROI / margen</dt><dd>{percent(economics?.roiPercent)} / {percent(economics?.netMarginPercent)}</dd></div>
                <div><dt className="text-white/45">Activos / vendidos exactos</dt><dd>{evidence?.activeExactCount ?? "N/D"} / {evidence?.soldExactCount ?? "N/D"}</dd></div>
              </dl>
              <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-2 text-xs text-white/65">
                <p><strong>Inteligencia cruzada:</strong> {strategic?.evidenceClass ?? "INSUFFICIENT_EVIDENCE"} · score {strategic?.score?.toFixed(0) ?? "N/D"}</p>
                <p>Vendedores activos exactos: {optimization?.marketEvidence?.activeSellerCount ?? "N/D"} · evidencia: {optimization?.marketEvidence?.evidenceBasis ?? "N/D"}.</p>
                <p>Patrón visual oficial: {optimization?.visualEvidence?.status ?? "N/D"} · muestra útil {optimization?.visualEvidence?.usableSampleSize ?? 0} · confianza {optimization?.visualEvidence?.confidence ?? "INSUFFICIENT"}.</p>
                <p className="text-white/45">Sólo metadatos oficiales: imágenes de competidores descargadas 0 · copiadas 0 · causalidad no afirmada.</p>
              </div>
              <div className="mt-2 rounded-xl border border-violet-200/20 bg-violet-100/[0.04] p-2 text-xs text-white/70">
                <p className="font-black text-violet-50">Ficha técnica automatizada</p>
                {productFacts ? <>
                  <dl className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <div><dt className="text-white/45">Facts</dt><dd>{productFacts.counts?.total ?? 0}</dd></div>
                    <div><dt className="text-white/45">Verificados / corroborados</dt><dd>{productFacts.counts?.VERIFIED ?? 0} / {productFacts.counts?.CORROBORATED ?? 0}</dd></div>
                    <div><dt className="text-white/45">Derivados / estimados</dt><dd>{productFacts.counts?.DERIVED_VERIFIED ?? 0} / {productFacts.counts?.ESTIMATED_INTERNAL ?? 0}</dd></div>
                    <div><dt className="text-white/45">Aspects obligatorios</dt><dd>{(productFacts.requirements?.SATISFIED_VERIFIED ?? 0) + (productFacts.requirements?.SATISFIED_CORROBORATED ?? 0)} / {productFacts.requirements?.total ?? 0}</dd></div>
                    <div><dt className="text-white/45">Readiness</dt><dd>{productFacts.gates?.OPENAI_INPUT_READY ? "OPENAI_INPUT_READY" : "BLOQUEADO SEGURO"}</dd></div>
                  </dl>
                  <p className="mt-1 text-white/55">Unidad: {productFacts.gates?.PRODUCT_FACTS_READY ? "lista" : "pendiente"} · Oferta: {productFacts.gates?.OFFER_PACK_READY ? "lista" : "pendiente"} · Envío: {productFacts.gates?.SHIPPING_CONFIRMED ? "confirmado" : productFacts.gates?.SHIPPING_ESTIMATE_READY ? "estimado, no publicable" : "pendiente"} · Regulación: {productFacts.gates?.REGULATORY_READY ? "resuelta" : "pendiente"}.</p>
                  {productFacts.exception && <p className="mt-2 rounded-lg border border-amber-100/20 bg-amber-100/[0.06] p-2 text-amber-50"><strong>{productFacts.exception.fieldRequired}:</strong> {productFacts.exception.whyItMatters} {productFacts.exception.exactEvidenceNeeded} Fuentes revisadas: {productFacts.exception.sourcesAlreadyChecked?.join(", ")}.</p>}
                </> : <p className="mt-1 text-white/55">Pendiente de enriquecimiento automático. No se te pedirá completar una ficha técnica completa.</p>}
              </div>
              {ready && !item.supplier_confirmed_at && !item.operator_action && <div className="mt-3 space-y-3 rounded-xl border border-cyan-200/20 p-3">{product.lunaUrl && <a href={product.lunaUrl} target="_blank" rel="noreferrer" className="grid min-h-11 place-items-center rounded-xl border border-cyan-200/25 font-black">Abrir en Luna</a>}<p className="font-black">Confirmar precio y disponibilidad</p><label className="block text-xs">Precio Luna observado<input type="number" min="0" step="0.01" value={draft.priceObserved} onChange={(event) => updateDraft(item.id, { priceObserved: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-white/20 bg-black/30 px-3" /></label><fieldset className="space-y-2 text-xs"><legend className="font-bold">Disponibilidad</legend>{(["EXACT_QUANTITY_VISIBLE", "AVAILABLE_QUANTITY_NOT_SHOWN", "OUT_OF_STOCK"] as const).map((value) => <label key={value} className="flex min-h-9 items-center gap-2"><input type="radio" name={`availability-${item.id}`} checked={draft.availability === value} onChange={() => updateDraft(item.id, { availability: value })} />{availabilityLabel(value)}</label>)}</fieldset>{draft.availability === "EXACT_QUANTITY_VISIBLE" && <label className="block text-xs">Cantidad exacta visible<input type="number" min="0" step="1" value={draft.exactQuantity} onChange={(event) => updateDraft(item.id, { exactQuantity: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-white/20 bg-black/30 px-3" /></label>}<button type="button" disabled={Boolean(confirmationBlockedReason) || workingId === item.id} onClick={() => void confirmLuna(item)} className="min-h-11 w-full rounded-xl bg-cyan-100 font-black text-black disabled:opacity-40">Confirmar y recalcular</button>{confirmationBlockedReason && <p className="text-xs text-amber-100">{confirmationBlockedReason}</p>}<p className="text-xs text-white/55">Cantidad no visible: máximo 1 offer pack; se exige nueva comprobación después de una venta.</p></div>}
              {item.supplier_confirmed_at && <><p className="mt-3 text-xs text-emerald-100">Precio/disponibilidad confirmados · confianza {item.stock_confidence} · capacidad {item.available_offer_pack_capacity ?? 0} offer pack · cantidad eBay {item.ebay_listing_quantity ?? 0}.</p><dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5"><div><dt className="text-white/45">Pack / alternativo</dt><dd>{pack?.packCount ?? "N/D"} / {alternative?.packCount ?? "N/D"}</dd></div><div><dt className="text-white/45">Precio / unidad</dt><dd>{money(economics?.targetPrice)} / {money(pack?.medianPricePerUnit)}</dd></div><div><dt className="text-white/45">Beneficio</dt><dd>{money(economics?.estimatedProfit)}</dd></div><div><dt className="text-white/45">ROI / margen</dt><dd>{percent(economics?.roiPercent)} / {percent(economics?.netMarginPercent)}</dd></div><div><dt className="text-white/45">Demanda / competencia</dt><dd>{evidence?.scores?.demandConfidence?.toFixed(0) ?? "N/D"} / {evidence?.scores?.competitionPressure?.toFixed(0) ?? "N/D"}</dd></div></dl><p className="mt-2 text-xs text-white/60">Activos exactos: {evidence?.activeExactCount ?? "N/D"} · vendidos exactos: {evidence?.soldExactCount ?? "N/D"} · confianza: {evidence?.confidence ?? "N/D"}</p><div className="mt-3 grid gap-2 sm:grid-cols-3"><button type="button" disabled={!confirmationReady || !productFacts?.gates?.OPENAI_INPUT_READY || item.operator_action === "APPROVED" || workingId === item.id} onClick={() => void approve(item)} className="min-h-12 rounded-xl bg-fuchsia-200 font-black text-black disabled:opacity-40">{item.operator_action === "APPROVED" ? "Aprobado para OpenAI" : "Aprobar para OpenAI"}</button><button type="button" disabled={!item.package_hash || workingId === item.id} onClick={() => void discard(item)} className="min-h-11 rounded-xl border border-rose-200/25 font-black text-rose-50 disabled:opacity-40">Rechazar</button><button type="button" onClick={() => setEvidenceId((value) => value === item.id ? "" : item.id)} className="min-h-11 rounded-xl border border-white/20 font-black">Ver evidencia y fuentes</button></div>{!confirmationReady && <p className="mt-1 text-xs text-white/55">La economía recalculada no conserva todos los hard gates; no se puede aprobar para OpenAI.</p>}{confirmationReady && !productFacts?.gates?.OPENAI_INPUT_READY && <p className="mt-1 text-xs text-amber-100">La ficha técnica aún tiene un bloqueo verificable. No se aprobará para OpenAI.</p>}</>}
              {item.supplier_confirmed_at && evidenceId === item.id && <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/35 p-3 text-xs">{JSON.stringify({ identityFingerprint: item.product_identity_fingerprint, baseProductFingerprint: item.base_product_fingerprint, offerPackFingerprint: item.offer_pack_fingerprint, evidence: item.evidence_snapshot, reasons: item.reason_codes, canPublish: false, openAiCalls: 0, ebayWrites: 0 }, null, 2)}</pre>}
            </article>
          })}</div> : invalidEmptyCompletion
            ? <p className="rounded-xl border border-amber-200/30 bg-amber-200/10 p-3 text-sm text-amber-50">El recorrido Discovery terminó, pero ningún candidato llegó a Loop 1 por una política de preselección anterior. El resultado vacío no representa el mercado. Usa “Analizar y actualizar oportunidades” una vez para reutilizar la evidencia guardada y continuar desde Loop 1.</p>
            : <p className="rounded-xl bg-black/20 p-3 text-sm text-white/65">{scanActive
              ? "Seller OS sigue analizando. Las tarjetas aparecerán cuando finalice Loop 1 y existan candidatos que superen todos los hard gates."
              : "No existen candidatos READY después del análisis completo. Revisa los conteos y causas agregadas; no necesitas investigar datos técnicos."}</p>}
        </>
      )}
      {error && <p role="alert" className="rounded-xl border border-rose-200/30 p-3 text-sm text-rose-50">{reason(error)}</p>}
      {message && <p role="status" className="rounded-xl border border-emerald-200/25 p-3 text-sm text-emerald-50">{message}</p>}
      <p className="text-xs text-white/50">Un clic orquesta Discovery + Loop 1 + ranking · sólo precio y disponibilidad requieren confirmación humana · cron permanente OFF · OpenAI calls: 0 · eBay writes: 0.</p>
    </section>
  )
}
