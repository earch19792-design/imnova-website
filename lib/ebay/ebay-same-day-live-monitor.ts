type Row = Record<string, unknown>

export type SameDayLiveMonitorStatus =
  | "NOT_STARTED"
  | "WORKING"
  | "QUEUED"
  | "WAITING_OPERATOR"
  | "PAUSED_EBAY"
  | "READY_TO_PUBLISH"
  | "BLOCKED"
  | "COMPLETED"

export type SameDayLiveTimelineStep = {
  id: string
  label: string
  status: "DONE" | "CURRENT" | "NEXT"
}

export type SameDayCandidateRejectionSummary = {
  candidateId: string
  ordinal: number | null
  productTitle: string
  headline: string
  details: string[]
  disposition: "CORRECTION_PENDING" | "REJECTED"
  controlledRiskOverride: {
    available: boolean
    blockers: string[]
    minimumRiskPrice: number | null
    maximumCompetitivePrice: number | null
    confirmedSoldExactQuantity: number
    referenceConfidence: string | null
  }
}

export type SameDayLiveMonitor = {
  status: SameDayLiveMonitorStatus
  businessLabel: string
  headline: string
  detail: string
  activityEvidence: string
  shouldAnimate: boolean
  batch: {
    total: number
    completed: number
    blocked: number
    active: number
    queued: number
    currentOrdinal: number | null
  }
  timeline: SameDayLiveTimelineStep[]
  nextAutomaticAction: string
  nextHumanAction: string
  blockerSummary: string | null
  rejectionSummaries: SameDayCandidateRejectionSummary[]
}

const TERMINAL_STATES = new Set(["REJECTED", "BLOCKED", "VERIFIED_ACTIVE", "COMPLETED"])
const READY_STATES = new Set(["READY_FOR_MANUAL_PUBLICATION", "WAITING_ITEM_ID"])

const TIMELINE = [
  { id: "selection", label: "Selección", states: ["RUN_CREATED", "LOCAL_FILTERING", "CANDIDATE_SELECTION"] },
  { id: "research", label: "Product Research", states: ["PRODUCT_RESEARCH_PLAN_READY", "WAITING_PRODUCT_RESEARCH_CAPTURE", "IMPORTING_SOLD_EVIDENCE"] },
  { id: "identity", label: "Identidad", states: ["RECONCILING_IDENTITY", "MATCHING_LUNA", "RUNNING_LOOP_1"] },
  { id: "economics", label: "Luna y economía", states: ["CALCULATING_ECONOMICS", "WAITING_LUNA_CONFIRMATION"] },
  { id: "facts", label: "Ficha y cumplimiento", states: ["ENRICHING_PRODUCT_FACTS", "VALIDATING_TAXONOMY", "VALIDATING_REGULATION", "BUILDING_OPENAI_INPUT", "WAITING_PRODUCT_APPROVAL"] },
  { id: "creative", label: "Contenido e imágenes", states: ["GENERATING_LISTING_CONTENT", "VALIDATING_LISTING_CONTENT", "PREPARING_IMAGE_PACKAGE", "WAITING_IMAGE_APPROVAL", "BUILDING_SELLER_HUB_HANDOFF"] },
  { id: "publish", label: "Publicación y monitor", states: ["READY_FOR_MANUAL_PUBLICATION", "WAITING_ITEM_ID", "VERIFYING_PUBLISHED_LISTING", "REGISTERING_COMMERCIAL_MONITOR", "VERIFIED_ACTIVE"] },
] as const

const BLOCKER_LABELS: Record<string, string> = {
  AUTHORIZED_CAPTURE_OBSERVATIONS_MISSING: "La captura no aportó referencias vendidas válidas para este producto.",
  CANDIDATE_CAPTURE_REFERENCES_MISSING: "No se encontraron referencias compatibles para reconciliar este producto.",
  OFFICIAL_IDENTITY_RECONCILIATION_NOT_EXACT: "La identidad, variante o presentación no coincide con suficiente precisión.",
  IDENTITY_QUERY_TOO_GENERIC: "Luna no tiene aún GTIN ni marca + MPN/modelo para preparar una búsqueda exacta.",
  GTIN_INVALID_OR_UNVERIFIED: "El GTIN disponible no superó la validación y no puede usarse para unir productos.",
  OFFER_PACK_IDENTITY_MISSING: "Falta identificar la presentación nativa que Luna vende.",
  CUSTOM_PRESENTATION_ECONOMICS_REQUIRED: "Se encontró el mismo producto en otro pack; falta calcular el costo completo de esa presentación.",
  LUNA_PACKAGING_CONFIGURATION_REQUIRED: "Falta confirmar si Luna preparará el pack en polybag o caja y qué material requiere.",
  RELATED_SIZE_IS_NOT_EXACT_OFFER: "La evidencia corresponde a otro tamaño de la misma familia, no a la oferta exacta.",
  EXACT_PRODUCT_PRESENTATION_REQUIRED: "Debe definirse la presentación exacta antes de calcular el listing.",
  LOOP1_EXACT_IDENTITY_NOT_CONFIRMED: "No se confirmó que la evidencia corresponda al producto y presentación exactos.",
  LUNA_OUT_OF_STOCK: "Luna fue confirmada sin inventario disponible.",
  LUNA_AVAILABILITY_QUANTITY_CONFLICT: "El snapshot automático de Luna muestra disponibilidad y cantidad contradictorias; confirma esos dos datos en la página exacta del producto.",
  LUNA_COST_REQUIRED_FOR_ECONOMICS: "Falta confirmar el costo actual de Luna para calcular la rentabilidad.",
  MISSING_BLOCKING: "Faltan aspectos obligatorios de eBay que deben resolverse antes de publicar.",
  MARKET_PRICE_BELOW_MINIMUM_SAFE_PRICE: "El precio mínimo seguro supera una referencia exacta verificable del mercado.",
  EXACT_TOP20_QUEUE_IDENTITY_MISSING: "Falta una identidad exacta y trazable en la cola comercial.",
  CURRENT_PRODUCT_FACT_RUN_INCOMPLETE: "La ficha técnica automatizada dejó datos críticos sin verificar.",
  PRODUCT_FACTS_PARTIAL_OR_EXCLUDED: "La ficha técnica no alcanzó la cobertura segura requerida para hoy.",
  EBAY_REQUIRED_ASPECTS_NOT_READY_TODAY: "Faltan aspectos obligatorios de la categoría de eBay.",
  EBAY_ASPECTS_READY_FALSE: "Los aspectos obligatorios de eBay todavía no están resueltos.",
  EBAY_TAXONOMY_NOT_READY: "Falta resolver la categoría hoja y sus requisitos oficiales de eBay.",
  PRODUCT_UNIT_FACTS_REQUIRED: "Falta verificar un dato esencial de identidad, marca o condición.",
  OFFER_PACK_FACTS_REQUIRED: "Falta resolver la presentación exacta y el total incluido en la oferta.",
  SHIPPING_ESTIMATE_REQUIRED_FOR_CONTENT: "Falta una estimación conservadora de envío para calcular la economía.",
  SHIPPING_CONFIRMATION_DEFERRED_TO_PUBLICATION: "El contenido puede avanzar; las medidas se confirmarán antes de una publicación que las requiera.",
  REGULATORY_NOT_READY_TODAY: "La validación regulatoria no está lista para publicar este producto.",
  REGULATORY_READY_FALSE: "Falta evidencia regulatoria autorizada.",
  PRODUCT_FACTS_NOT_READY_TODAY: "La ficha técnica aún contiene un dato crítico pendiente o conflictivo.",
  OPENAI_INPUT_NOT_READY: "El paquete de facts verificados todavía no está listo para generar contenido.",
  NEED_AUTHORIZED_PRODUCT_IMAGES: "Faltan imágenes propias o autorizadas del producto exacto.",
  PRODUCT_REJECTED_BY_OPERATOR: "El producto fue rechazado durante la revisión humana.",
  IMAGES_REJECTED_BY_OPERATOR: "Las imágenes fueron rechazadas durante la revisión humana.",
  LOOP1_REANALYSIS_TIMEOUT: "El reanálisis comercial no terminó dentro de la ventana segura.",
}

const CONTROLLED_RISK_BLOCKER_LABELS: Record<string, string> = {
  CONFIRMED_SOLD_EXACT_REQUIRED: "No existen ventas exactas confirmadas para esta presentación.",
  EXACT_SOLD_COMPETITIVE_REFERENCE_REQUIRED: "Falta un precio vendido exacto que permita comprobar competitividad.",
  TEN_PERCENT_MARGIN_NOT_COMPETITIVE: "El precio mínimo para conservar 10% de margen supera la referencia exacta vendida.",
  EXACT_IDENTITY_REQUIRED: "La identidad exacta todavía no está confirmada.",
  EXACT_OFFER_PACK_REQUIRED: "La presentación exacta todavía no está confirmada.",
  LUNA_AVAILABILITY_REQUIRED: "Luna no está confirmada como disponible.",
  FRESH_EVIDENCE_REQUIRED: "La evidencia comercial está vencida.",
  FRESH_DECISION_PACKAGE_REQUIRED: "La decisión comercial está vencida.",
  DECISION_PACKAGE_HASH_MISMATCH: "La decisión ya no coincide con la evidencia actual.",
  VERIFIED_PRODUCT_FACTS_REQUIRED: "La ficha técnica o los aspectos obligatorios no están listos.",
  SHIPPING_ESTIMATE_REQUIRED: "Falta una estimación conservadora del envío.",
  NON_ECONOMIC_DECISION_BLOCKER: "Existe un bloqueo de identidad, cumplimiento o logística que no puede exceptuarse.",
  ECONOMICS_ONLY_NO_GO_REQUIRED: "Esta excepción sólo aplica cuando el único bloqueo es económico.",
  CONTROLLED_RISK_REQUIRES_NO_GO_DECISION: "La decisión comercial original no corresponde a un NO_GO económico.",
  CONTROLLED_RISK_PRICE_FLOOR_UNAVAILABLE: "No fue posible calcular el piso interno de 10%.",
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((entry): entry is Row =>
    Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)) : []
}

function dateMs(value: unknown) {
  const parsed = Date.parse(text(value))
  return Number.isFinite(parsed) ? parsed : null
}

function numeric(value: unknown) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function usd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

export function explainSameDayRejectedCandidate(candidate: Row): SameDayCandidateRejectionSummary {
  const decision = candidate.commercial_decision_summary &&
    typeof candidate.commercial_decision_summary === "object"
    ? candidate.commercial_decision_summary as Row : {}
  const decisionEconomics = decision.economics && typeof decision.economics === "object"
    ? decision.economics as Row : {}
  const decisionEvidence = decision.evidence && typeof decision.evidence === "object"
    ? decision.evidence as Row : {}
  const currentEconomics = candidate.economics_summary && typeof candidate.economics_summary === "object"
    ? candidate.economics_summary as Row : {}
  const facts = candidate.product_facts_summary && typeof candidate.product_facts_summary === "object"
    ? candidate.product_facts_summary as Row : {}
  const gates = facts.gates && typeof facts.gates === "object" ? facts.gates as Row : {}
  const controlledRisk = candidate.controlled_risk_override_preview &&
    typeof candidate.controlled_risk_override_preview === "object"
    ? candidate.controlled_risk_override_preview as Row : {}
  const economicsConfig = currentEconomics.config && typeof currentEconomics.config === "object"
    ? currentEconomics.config as Row : {}
  const feePolicy = currentEconomics.feePolicy && typeof currentEconomics.feePolicy === "object"
    ? currentEconomics.feePolicy as Row : {}
  const marketMedian = numeric(decisionEconomics.activeMarketMedian)
  const safePrice = numeric(decisionEconomics.minimumSafePrice)
  const currentFloor = numeric(currentEconomics.minimumOperatorPrice)
  const soldExact = numeric(decisionEvidence.confirmedSoldExact) ??
    numeric((candidate.evidence_summary as Row | undefined)?.soldExactCount) ?? 0
  const activeExact = numeric(decisionEvidence.activeExactCount) ?? 0
  const candidateEvidence = candidate.evidence_summary &&
    typeof candidate.evidence_summary === "object" ? candidate.evidence_summary as Row : {}
  const evidenceTiers = candidateEvidence.evidenceTiers &&
    typeof candidateEvidence.evidenceTiers === "object" ? candidateEvidence.evidenceTiers as Row : {}
  const reconciliationCoverage = candidateEvidence.reconciliationCoverage &&
    typeof candidateEvidence.reconciliationCoverage === "object"
    ? candidateEvidence.reconciliationCoverage as Row : {}
  const missingRequiredAspects = rows(facts.resolvedRequirements)
    .filter((requirement) => text(requirement.status) === "MISSING_BLOCKING")
    .map((requirement) => text(requirement.aspectName)).filter(Boolean)
  const details: string[] = []
  const candidateBlockers = Array.isArray(candidate.blockers)
    ? candidate.blockers.map((blocker) => text(blocker)).filter(Boolean) : []
  let headline = translateSameDayPilotBlocker(candidateBlockers[0]) ??
    "El candidato no superó las puertas de publicación."
  const correctionOnlyBlockers = new Set([
    "MISSING_BLOCKING", "EBAY_REQUIRED_ASPECTS_NOT_READY_TODAY",
    "EBAY_ASPECTS_READY_FALSE", "EBAY_TAXONOMY_NOT_READY",
    "PRODUCT_UNIT_FACTS_REQUIRED", "OFFER_PACK_FACTS_REQUIRED",
    "SHIPPING_ESTIMATE_REQUIRED_FOR_CONTENT", "OPENAI_INPUT_NOT_READY",
    "PRODUCT_FACTS_NOT_READY_TODAY", "REGULATORY_NOT_READY_TODAY",
    "REGULATORY_READY_FALSE", "SHIPPING_CONFIRMATION_DEFERRED_TO_PUBLICATION",
  ])
  const correctionPending = missingRequiredAspects.length > 0 ||
    (candidateBlockers.length > 0 && candidateBlockers.every((blocker) =>
      correctionOnlyBlockers.has(blocker)))
  if (correctionPending) {
    headline = missingRequiredAspects.length
      ? "Ficha pendiente: faltan datos obligatorios que deben agotarse automáticamente y, como última instancia, confirmarse manualmente."
      : "Ficha pendiente de corrección verificable; el producto no ha sido descartado."
  }
  const marketPriceIsCurrentBlocker = candidateBlockers.includes("MARKET_PRICE_BELOW_MINIMUM_SAFE_PRICE")

  if (marketPriceIsCurrentBlocker && text(decision.verdict) === "NO_GO" &&
    marketMedian !== null && marketMedian > 0 &&
    safePrice !== null && activeExact > 0 &&
    decisionEconomics.marketSupportsMinimumSafePrice !== true) {
    headline = `No se publica: el precio seguro completo ${usd(safePrice)} supera la mediana eBay ${usd(marketMedian)}.`
    if (currentFloor !== null) {
      const currentGap = currentFloor - marketMedian
      details.push(`Incluso el piso preliminar actual ${usd(currentFloor)} queda ${usd(Math.abs(currentGap))} ${currentGap >= 0 ? "por encima" : "por debajo"} del mercado mediano.`)
    }
  } else if (marketPriceIsCurrentBlocker && text(decision.verdict) === "NO_GO" &&
    activeExact === 0) {
    headline = "No se publica todavía: no existe una mediana eBay exacta para esta presentación."
  }
  const supplierCost = numeric(currentEconomics.confirmedLunaPrice ?? currentEconomics.supplierCost)
  const outboundShipping = numeric(economicsConfig.estimatedOutboundShipping)
  const ebayFeeRate = numeric(economicsConfig.estimatedEbayFeeRate)
  const fixedOrderFee = numeric(feePolicy.appliedFixedOrderFee ?? economicsConfig.fixedOrderFee)
  const returnsRate = numeric(economicsConfig.returnsReserveRate)
  const promotedRate = numeric(economicsConfig.promotedListingsReserveRate)
  if ([currentFloor, supplierCost, outboundShipping, ebayFeeRate, fixedOrderFee, returnsRate, promotedRate]
    .every((value) => value !== null)) {
    const salePrice = currentFloor as number
    const ebayFee = salePrice * (ebayFeeRate as number) + (fixedOrderFee as number)
    const returnsReserve = salePrice * (returnsRate as number)
    const promotedReserve = salePrice * (promotedRate as number)
    const profit = salePrice - (supplierCost as number) - (outboundShipping as number) - ebayFee -
      returnsReserve - promotedReserve
    const margin = salePrice > 0 ? profit / salePrice * 100 : 0
    const roi = (supplierCost as number) > 0 ? profit / (supplierCost as number) * 100 : 0
    details.push(`A ${usd(salePrice)}: Luna ${usd(supplierCost as number)}, envío ${usd(outboundShipping as number)}, eBay estimado ${usd(ebayFee)}, devoluciones ${usd(returnsReserve)}, publicidad ${usd(promotedReserve)}; utilidad ${usd(profit)}, margen ${margin.toFixed(2)}% y ROI ${roi.toFixed(2)}%.`)
  }
  details.push(soldExact > 0
    ? `${soldExact} venta(s) exacta(s) confirmada(s) en la evidencia disponible.`
    : "No hay ventas exactas confirmadas para esta presentación; esto no descarta ni bloquea comercialmente el producto.")
  const reviewedObservations = numeric(reconciliationCoverage.reviewedObservations)
  const relatedPackReferences = numeric(evidenceTiers.confirmedSoldRelatedPack) ?? 0
  const relatedSizeReferences = numeric(evidenceTiers.confirmedSoldRelatedSize) ?? 0
  if (reviewedObservations !== null) {
    details.push(`Product Research revisó ${reviewedObservations} fila(s) de la ventana oficial capturada: ${numeric(evidenceTiers.confirmedSoldExact) ?? 0} referencia(s) exacta(s), ${relatedPackReferences} de otro pack y ${relatedSizeReferences} de otro tamaño.`)
  }
  if (missingRequiredAspects.length) {
    details.push(`Aspectos obligatorios pendientes: ${missingRequiredAspects.join(", ")}.`)
  }
  if (gates.SHIPPING_CONFIRMED === false) {
    details.push("El peso o las dimensiones del paquete aún deben confirmarse antes de publicar si la política de envío los requiere.")
  }
  if (decision.fresh === false) {
    details.push("La decisión comercial anterior está vencida y debe recalcularse antes de reconsiderar este producto.")
  }

  return {
    candidateId: text(candidate.id),
    ordinal: Number.isInteger(Number(candidate.ordinal)) ? Number(candidate.ordinal) : null,
    productTitle: text(candidate.product_title) || "Producto sin nombre",
    headline,
    details: [...new Set(details)],
    disposition: correctionPending ? "CORRECTION_PENDING" : "REJECTED",
    controlledRiskOverride: {
      available: controlledRisk.available === true,
      blockers: Array.isArray(controlledRisk.blockers)
        ? controlledRisk.blockers.map((blocker) => CONTROLLED_RISK_BLOCKER_LABELS[text(blocker)] ??
          "La excepción controlada no supera todos los controles obligatorios.")
        : [],
      minimumRiskPrice: numeric(controlledRisk.minimumRiskPrice),
      maximumCompetitivePrice: numeric(controlledRisk.maximumCompetitivePrice),
      confirmedSoldExactQuantity: Math.max(0,
        numeric(controlledRisk.confirmedSoldExactQuantity) ?? 0),
      referenceConfidence: text((controlledRisk.exactSoldReference as Row | undefined)?.confidence) || null,
    },
  }
}

function isRecent(value: unknown, nowMs: number, maximumAgeMs: number) {
  const observedAt = dateMs(value)
  return observedAt != null && observedAt <= nowMs + 30_000 && nowMs - observedAt <= maximumAgeMs
}

function phaseForState(state: string) {
  const index = TIMELINE.findIndex((step) => (step.states as readonly string[]).includes(state))
  return index < 0 ? 0 : index
}

function timelineForState(state: string): SameDayLiveTimelineStep[] {
  const current = phaseForState(state)
  return TIMELINE.map((step, index) => ({
    id: step.id,
    label: step.label,
    status: index < current ? "DONE" : index === current ? "CURRENT" : "NEXT",
  }))
}

export function translateSameDayPilotBlocker(value: unknown) {
  const code = text(value)
  if (!code) return null
  return BLOCKER_LABELS[code]
    ?? (code.startsWith("NEED_PACKAGE_WEIGHT")
      ? "Falta confirmar el peso o las dimensiones reales del paquete de envío."
      : code.startsWith("CONFLICTED")
        ? "Existe un dato crítico conflictivo que requiere evidencia autorizada."
        : "El candidato necesita una revisión verificable antes de continuar.")
}

export function deriveSameDayLiveMonitor(input: {
  run?: Row | null
  candidates?: unknown
  tasks?: unknown
  jobs?: unknown
  quotaPaused?: boolean
  now?: Date
}): SameDayLiveMonitor {
  const now = input.now ?? new Date()
  const nowMs = now.getTime()
  const run = input.run ?? null
  const candidates = rows(input.candidates)
  const tasks = rows(input.tasks)
  const jobs = rows(input.jobs)
  const openTasks = tasks.filter((task) => text(task.status) === "OPEN")
  const blockedCandidates = candidates.filter((candidate) => TERMINAL_STATES.has(text(candidate.machine_state))
    && ["BLOCKED", "REJECTED"].includes(text(candidate.machine_state)))
  const completedCandidates = candidates.filter((candidate) =>
    ["VERIFIED_ACTIVE", "COMPLETED"].includes(text(candidate.machine_state)))
  const readyCandidates = candidates.filter((candidate) => READY_STATES.has(text(candidate.machine_state)))
  const activeCandidates = candidates.filter((candidate) => !TERMINAL_STATES.has(text(candidate.machine_state))
    && !READY_STATES.has(text(candidate.machine_state)) && text(candidate.machine_state) !== "RUN_CREATED")
  const queuedCandidates = candidates.filter((candidate) => text(candidate.machine_state) === "RUN_CREATED")
  const currentCandidate = activeCandidates[0] ?? readyCandidates[0] ?? queuedCandidates[0] ?? candidates[0]
  const currentState = text(currentCandidate?.machine_state) || text(run?.stage) || "RUN_CREATED"
  const currentOrdinal = Number(currentCandidate?.ordinal)

  const leasedJobs = jobs.filter((job) => text(job.status) === "LEASED")
  const pendingJobs = jobs.filter((job) => ["PENDING", "WAITING_RETRY"].includes(text(job.status)))
  const freshHeartbeat = isRecent(run?.last_worker_heartbeat_at, nowMs, 3 * 60_000)
  const activeWorkerLease = (dateMs(run?.worker_lease_expires_at) ?? 0) > nowMs
  const freshLeasedJob = leasedJobs.some((job) => isRecent(job.updated_at, nowMs, 6 * 60_000))
  // A visual pulse is earned only by a current durable execution signal. A
  // merely PENDING job is intentionally rendered as queued, never as working.
  const activeExecution = (freshHeartbeat && (activeWorkerLease || leasedJobs.length > 0))
    || (activeWorkerLease && freshLeasedJob)

  const runStatus = text(run?.status)
  let status: SameDayLiveMonitorStatus
  if (!run) status = "NOT_STARTED"
  else if (runStatus === "COMPLETED") status = "COMPLETED"
  else if (openTasks.length > 0) status = "WAITING_OPERATOR"
  else if (input.quotaPaused === true || jobs.some((job) => text(job.status) === "WAITING_RETRY")) status = "PAUSED_EBAY"
  else if (readyCandidates.length > 0 || runStatus === "READY_FOR_OPERATOR") status = "READY_TO_PUBLISH"
  else if (runStatus === "BLOCKED" || (candidates.length > 0 && blockedCandidates.length === candidates.length)) status = "BLOCKED"
  else if (activeExecution) status = "WORKING"
  else if (pendingJobs.length > 0 || activeCandidates.length > 0 || queuedCandidates.length > 0) status = "QUEUED"
  else status = "QUEUED"

  const labels: Record<SameDayLiveMonitorStatus, { business: string; headline: string; detail: string }> = {
    NOT_STARTED: { business: "NO INICIADO", headline: "El lanzamiento está listo para comenzar", detail: "Seller OS todavía no ha creado un lote." },
    WORKING: { business: "TRABAJANDO", headline: "Seller OS está procesando el lote", detail: "Existe un lease o latido reciente del worker durable." },
    QUEUED: { business: "EN COLA", headline: "El trabajo está preparado y preservado", detail: "No hay ejecución activa confirmada ahora; el siguiente turno retomará el checkpoint." },
    WAITING_OPERATOR: { business: "ESPERANDO TU CONFIRMACIÓN", headline: "Seller OS necesita una sola acción tuya", detail: "Las etapas automáticas posteriores permanecen bloqueadas hasta completar el gate visible." },
    PAUSED_EBAY: { business: "PAUSADO POR EBAY", headline: "La lane de eBay espera su ventana segura", detail: "El checkpoint está preservado y no se harán reintentos agresivos." },
    READY_TO_PUBLISH: { business: "LISTO PARA PUBLICAR", headline: "Hay un paquete preparado para Seller Hub", detail: "La publicación continúa siendo manual y requiere tu aprobación." },
    BLOCKED: { business: "BLOQUEADO", headline: "Este lote no puede avanzar de forma segura", detail: "Seller OS preservó la evidencia y no forzará una publicación." },
    COMPLETED: { business: "PUBLICADO Y VERIFICADO", headline: "El listing fue verificado y registrado", detail: "Seller OS cerró el recorrido durable de este candidato." },
  }
  const label = labels[status]
  const rejectionSummaries = blockedCandidates.map(explainSameDayRejectedCandidate)
  const firstBlocker = blockedCandidates.flatMap((candidate) =>
    Array.isArray(candidate.blockers) ? candidate.blockers : [])[0]
  const blockerSummary = rejectionSummaries[0]?.headline ?? translateSameDayPilotBlocker(firstBlocker)
  const heartbeatAt = dateMs(run?.last_worker_heartbeat_at)
  const activityEvidence = status === "WORKING"
    ? heartbeatAt != null
      ? `Latido confirmado ${new Intl.DateTimeFormat("es-NI", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(heartbeatAt))}.`
      : "Job con lease vigente confirmado."
    : status === "QUEUED"
      ? `${pendingJobs.length} trabajo(s) en cola; no se simula actividad mientras esperan.`
      : status === "WAITING_OPERATOR"
        ? `${openTasks.length} tarea(s) humana(s) abiertas; sólo se muestra la primera.`
        : label.detail

  return {
    status,
    businessLabel: label.business,
    headline: label.headline,
    detail: label.detail,
    activityEvidence,
    shouldAnimate: status === "WORKING",
    batch: {
      total: candidates.length,
      completed: completedCandidates.length,
      blocked: blockedCandidates.length,
      active: activeCandidates.length,
      queued: queuedCandidates.length,
      currentOrdinal: Number.isInteger(currentOrdinal) && currentOrdinal > 0 ? currentOrdinal : null,
    },
    timeline: timelineForState(currentState),
    nextAutomaticAction: text(run?.next_automated_action) || text(currentCandidate?.next_automated_action) || "Preservar el checkpoint y esperar la siguiente señal.",
    nextHumanAction: openTasks.length
      ? text(openTasks[0]?.title) || "Completar la tarea visible."
      : text(run?.next_human_action) || text(currentCandidate?.next_human_action) || "Ninguna.",
    blockerSummary,
    rejectionSummaries,
  }
}
