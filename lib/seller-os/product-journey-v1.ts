export const SELLER_OS_PRODUCT_JOURNEY_V1 =
  "SELLER_OS_PRODUCT_JOURNEY_V1" as const
export const SELLER_OS_PRODUCT_JOURNEY_RECOVERY_POLICY_V1 =
  "SELLER_OS_PRODUCT_JOURNEY_RECOVERY_POLICY_V1" as const

export type ProductJourneyStageStatusV1 = "COMPROBADO" | "EN_PROCESO" |
  "FALTA_COMPROBAR" | "TIENE_UN_FALLO" | "PENDIENTE"
export type ProductJourneyMechanismCertificationV1 = "NOT_CERTIFIED" |
  "INTERNAL_PASS" | "PHYSICAL_PASS" | "FAILED"
export type ProductJourneyFreshnessV1 = "FRESH" | "STALE" | "UNKNOWN" |
  "NOT_APPLICABLE"

type Row = Record<string, unknown>

export type ProductJourneyEvidenceV1 = Readonly<{
  now?: string
  queue: Row
  card?: Row | null
  listingPackage?: Row | null
  approval?: Row | null
  execution?: Row | null
  publication?: Row | null
  batchChild?: Row | null
  activeListing?: Row | null
  frontier?: Row | null
  radarObservation?: Row | null
  shippingClaim?: Row | null
  research?: Readonly<{
    planCount: number
    taskCount: number
    completedTaskCount: number
    failedTaskCount: number
    captureBatchCount: number
    sourceRowCount: number
    acceptedComparableCount: number
    rejectedComparableCount: number
    dedupedComparableCount: number
    queries: readonly string[]
    rejectionReasons: readonly string[]
    capturedAt: string | null
    confirmedSoldQuantity: number
    lastSoldAt: string | null
    minimumSoldPrice: number | null
    maximumSoldPrice: number | null
    itemIdDedupeProven: boolean
    soldDatesPresent: boolean
    conditionCoverageProven: boolean
    shippingTreatmentProven: boolean
  }> | null
  queueEvents?: readonly Row[]
}>

export type ProductJourneyPhaseV1 = Readonly<{
  ordinal: number
  code: string
  label: string
  status: ProductJourneyStageStatusV1
  mechanismCertification: ProductJourneyMechanismCertificationV1
  startedAt: string | null
  completedAt: string | null
  trigger: string
  sourceAuthority: string
  freshness: Readonly<{
    status: ProductJourneyFreshnessV1
    observedAt: string | null
    expiresAt: string | null
  }>
  attempted: string
  found: readonly string[]
  missing: readonly string[]
  result: string
  decision: string
  failureClass: string | null
  retrySafety: string
  nextAction: string
  ownerIntervention: string
  databaseWriteCount: number | null
  marketplaceWriteCount: number | null
  technicalEvidence: Readonly<{
    inputReferences: readonly string[]
    outputReferences: readonly string[]
    receiptReferences: readonly string[]
  }>
}>

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row : {}
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 500): string | null {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().slice(0, maximum) : null
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

function date(value: unknown): string | null {
  const parsed = text(value, 80)
  return parsed && Number.isFinite(Date.parse(parsed))
    ? new Date(parsed).toISOString() : null
}

function unique(values: readonly (string | null | undefined)[]) {
  return Object.freeze([...new Set(values.filter((value): value is string =>
    Boolean(value)))])
}

function ref(label: string, value: unknown) {
  const parsed = text(value, 220)
  return parsed ? `${label}: ${parsed}` : null
}

function money(label: string, value: unknown, currency = "USD") {
  const parsed = numberValue(value)
  return parsed === null ? null : `${label}: ${currency} ${parsed.toFixed(2)}`
}

function freshness(input: Readonly<{ observedAt?: unknown; expiresAt?: unknown;
  maximumAgeSeconds?: unknown; explicit?: unknown; durable?: boolean }>,
  now: Date) {
  const observedAt = date(input.observedAt)
  const maximumAgeSeconds = numberValue(input.maximumAgeSeconds)
  const expiresAt = date(input.expiresAt) ?? (observedAt &&
      maximumAgeSeconds !== null && maximumAgeSeconds > 0
    ? new Date(Date.parse(observedAt) + maximumAgeSeconds * 1_000)
      .toISOString() : null)
  const explicit = text(input.explicit, 40)?.toUpperCase()
  let status: ProductJourneyFreshnessV1 = "UNKNOWN"
  if (input.durable) status = "NOT_APPLICABLE"
  else if (expiresAt) status = Date.parse(expiresAt) > now.getTime()
    ? "FRESH" : "STALE"
  else if (explicit === "FRESH") status = "FRESH"
  else if (explicit === "STALE") status = "STALE"
  return Object.freeze({ status, observedAt, expiresAt })
}

type ProductJourneyPhaseInputV1 = Omit<ProductJourneyPhaseV1,
  "found" | "missing" | "technicalEvidence"> & Readonly<{
    found: readonly (string | null | undefined)[]
    missing: readonly (string | null | undefined)[]
    technicalEvidence: Readonly<{
      inputReferences: readonly (string | null | undefined)[]
      outputReferences: readonly (string | null | undefined)[]
      receiptReferences: readonly (string | null | undefined)[]
    }>
  }>

function phase(input: ProductJourneyPhaseInputV1): ProductJourneyPhaseV1 {
  return Object.freeze({ ...input, found: unique(input.found),
    missing: unique(input.missing), technicalEvidence: Object.freeze({
      inputReferences: unique(input.technicalEvidence.inputReferences),
      outputReferences: unique(input.technicalEvidence.outputReferences),
      receiptReferences: unique(input.technicalEvidence.receiptReferences),
    }) })
}

function worstStatus(values: readonly ProductJourneyStageStatusV1[]) {
  for (const status of ["TIENE_UN_FALLO", "EN_PROCESO", "FALTA_COMPROBAR",
    "PENDIENTE", "COMPROBADO"] as const) {
    if (values.includes(status)) return status
  }
  return "PENDIENTE" as const
}

function packageDigest(packageData: Row, card: Row) {
  const marketTest = record(packageData.quickPickMarketTestPackageV1)
  const ownerReview = record(packageData.quickPickOwnerReviewV1)
  return text(marketTest.packageDigest, 100)
    ?? text(ownerReview.reviewedPackageDigest, 100)
    ?? text(record(card.listingReview).packageDigest, 100)
}

function imagesDigest(packageData: Row, card: Row) {
  const marketTest = record(packageData.quickPickMarketTestPackageV1)
  const binding = record(marketTest.authorizationBinding)
  return text(binding.imagesDigest, 100)
    ?? text(record(record(card.listingReview).authorizationBinding)
      .imagesDigest, 100)
}

export function buildSellerOsProductJourneyV1(
  input: ProductJourneyEvidenceV1,
) {
  const now = new Date(date(input.now) ?? new Date().toISOString())
  const queue = record(input.queue)
  const assessment = record(queue.assessment)
  const card = record(input.card)
  const productTruth = record(assessment.productTruth)
  const productEvidence = record(record(productTruth.sourceEvidence)
    .requiredItemSpecificsTruthV1)
  const exactEvidence = record(productEvidence.lunaExactProductEvidenceSetV1)
  const sectionCoverage = record(exactEvidence.sectionCoverage)
  const imageReview = record(assessment.lunaFullPageImageReviewV1)
  const operation = record(assessment.lunaQuickPickOperationV1)
  const market = record(assessment.market)
  const radar = record(assessment.radarFactoryCandidateV1)
  const minimumReadiness = record(
    assessment.minimumTruthfulListingReadinessV1)
  const marketTest = record(assessment.quickPickMarketTestReviewV1)
  const shipping = record(
    assessment.radarAutomaticLunaShippingContinuationV1)
  const listingPackage = record(input.listingPackage)
  const packageData = record(listingPackage.package_data)
  const packagePricing = record(packageData.pricing)
  const packageShipping = record(packageData.shipping)
  const packageMarketTest = record(packageData.quickPickMarketTestPackageV1)
  const materialization = record(
    packageData.quickPickRuntimePackageMaterializationV1)
  const approval = record(input.approval)
  const execution = record(input.execution)
  const publication = record(input.publication)
  const batchChild = record(input.batchChild)
  const activeListing = record(input.activeListing)
  const frontier = record(input.frontier)
  const radarObservation = record(input.radarObservation)
  const shippingClaim = record(input.shippingClaim)
  const research = input.research ?? null
  const digest = packageDigest(packageData, card)
  const imageSetDigest = imagesDigest(packageData, card)
  const productTruthDigest = text(productTruth.evidenceDigest, 100)
  const candidateId = text(queue.candidate_key, 120)
  const packageId = text(listingPackage.id, 80)
  const supplierSku = text(queue.supplier_sku, 160)
  const productId = text(queue.supplier_product_id, 80)
  const variantId = text(queue.supplier_variant_id, 80)
  const itemId = text(batchChild.item_id, 80)
    ?? text(publication.listing_id, 80)
    ?? text(activeListing.ebay_item_id, 80)
  const offerId = text(batchChild.offer_id, 80)
    ?? text(publication.offer_id, 80) ?? text(execution.offer_id, 80)
  const marketplaceWrites = numberValue(batchChild.marketplace_write_count)
    ?? numberValue(publication.marketplace_write_count)
  const productStartedAt = date(operation.firstObservedAt)
    ?? date(queue.first_detected_at)
  const productCompletedAt = date(imageReview.reviewedAt)
  const exactIdentity = bool(record(assessment.identity)
    .exactIdentityConfirmed) === true
  const galleryReviewed = imageReview.allExactProductImagesReviewed === true
    && numberValue(imageReview.reviewedImageCount) !== null
    && numberValue(imageReview.reviewedImageCount) ===
      numberValue(imageReview.exactImageCount)
  const productProven = exactIdentity && Boolean(productTruthDigest)
    && galleryReviewed
  const productMissing = [
    !productId ? "ID del producto exacto" : null,
    !variantId ? "ID de la variante exacta" : null,
    !supplierSku ? "SKU del proveedor" : null,
    sectionCoverage.productFeaturesSection ===
      "NOT_PRESENT_ON_EXACT_LUNA_PAGE" ?
      "Luna no proporciona una sección de características" : null,
    sectionCoverage.materialsAndCareSection ===
      "NOT_PRESENT_ON_EXACT_LUNA_PAGE" ?
      "Luna no proporciona materiales y cuidados" : null,
    !galleryReviewed ? "Revisión completa de la galería exacta" : null,
  ]
  const productPhase = phase({
    ordinal: 1, code: "PRODUCT_TRUTH", label: "Producto / Luna",
    status: productProven ? "COMPROBADO" : productStartedAt
      ? "EN_PROCESO" : "FALTA_COMPROBAR",
    mechanismCertification: productProven ? "PHYSICAL_PASS"
      : exactIdentity ? "INTERNAL_PASS" : "NOT_CERTIFIED",
    startedAt: productStartedAt, completedAt: productProven
      ? productCompletedAt ?? date(queue.updated_at) : null,
    trigger: text(operation.contractVersion) ?? "INGRESO_DEL_PRODUCTO",
    sourceAuthority: text(productTruth.authorityClass)
      ?? "NO_AUTHORITY_AVAILABLE",
    freshness: freshness({ observedAt: queue.supplier_snapshot_at,
      explicit: record(productTruth.stock).freshness }, now),
    attempted: "Comprobar el producto y la variante exactos en Luna, incluida su galería.",
    found: [ref("Producto", productId), ref("Variante", variantId),
      ref("SKU", supplierSku), ref("Título", productTruth.title),
      numberValue(productTruth.imageCount) === null ? null
        : `Galería: ${numberValue(productTruth.imageCount)} imágenes; ${
          numberValue(imageReview.reviewedImageCount) ?? 0} revisadas.`],
    missing: productMissing,
    result: productProven ? "Producto exacto y galería comprobados."
      : "La identidad o la cobertura completa de evidencia aún no está demostrada.",
    decision: productProven ? "USAR_PRODUCT_TRUTH_EXACTO"
      : "CONSERVAR_FAIL_CLOSED",
    failureClass: exactIdentity === false ? "EXACT_PRODUCT_IDENTITY_UNPROVEN"
      : galleryReviewed ? null : "FULL_GALLERY_REVIEW_UNPROVEN",
    retrySafety: productProven ? "NOT_APPLICABLE"
      : "SAFE_IDEMPOTENT_RUNTIME_RESUME",
    nextAction: productProven ? "Continuar con evidencia de mercado."
      : "Seller OS debe completar la captura/revisión faltante.",
    ownerIntervention: "Ninguna intervención técnica.",
    databaseWriteCount: null,
    marketplaceWriteCount: numberValue(productTruth.marketplaceWrites),
    technicalEvidence: { inputReferences: [ref("candidate", candidateId),
      ref("source", operation.canonicalUrl ?? operation.sourceUrl)],
      outputReferences: [ref("productTruthDigest", productTruthDigest),
        ref("imageSetDigest", imageReview.imageSetDigest)],
      receiptReferences: [ref("imageReviewReceipt",
        imageReview.evidenceDigest)] },
  })

  const soldReviewed = queue.sold_evidence_reviewed === true
  const researchExecuted = soldReviewed || (research?.completedTaskCount ?? 0) > 0
    || (research?.captureBatchCount ?? 0) > 0
  const researchFailed = (research?.failedTaskCount ?? 0) > 0
  const researchFreshness = freshness({
    observedAt: queue.sold_evidence_observed_at ?? research?.capturedAt,
    expiresAt: queue.sold_evidence_expires_at,
  }, now)
  const researchCurrent = researchExecuted &&
    researchFreshness.status !== "STALE"
  const researchCertificationComplete = researchCurrent && research !== null
    && research.itemIdDedupeProven && research.soldDatesPresent
    && research.conditionCoverageProven
    && research.shippingTreatmentProven
  const researchCertificationMissing = researchExecuted &&
    !researchCertificationComplete
  const comparableCount = numberValue(queue.sold_exact_comparable_count)
    ?? research?.acceptedComparableCount ?? null
  const researchPhase = phase({
    ordinal: 2, code: "PRODUCT_RESEARCH", label: "Mercado / Product Research",
    status: researchFailed || researchCertificationMissing
      ? "TIENE_UN_FALLO" : researchCurrent
        ? "COMPROBADO" : researchExecuted ? "FALTA_COMPROBAR"
        : "FALTA_COMPROBAR",
    mechanismCertification: researchFailed || researchCertificationMissing
      ? "FAILED" : researchExecuted ? "PHYSICAL_PASS" : "NOT_CERTIFIED",
    startedAt: research?.capturedAt ?? date(queue.sold_evidence_observed_at),
    completedAt: researchCurrent
      ? date(queue.sold_evidence_observed_at) ?? research?.capturedAt ?? null
      : null,
    trigger: research?.planCount ? "PRODUCT_RESEARCH_QUERY_PLAN"
      : "DEMAND_EVIDENCE_REQUIREMENT",
    sourceAuthority: research?.captureBatchCount
      ? "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE"
      : soldReviewed ? "DURABLE_EBAY_SOLD_EVIDENCE"
        : "NO_AUTHORITY_AVAILABLE",
    freshness: researchFreshness,
    attempted: "Buscar y revisar comparables vendidos reales en eBay.",
    found: [comparableCount === null ? null
      : `Comparables vendidos aceptados: ${comparableCount}.`,
      research ? `Consultas ejecutadas: ${research.completedTaskCount} de ${
        research.taskCount}.` : null,
      research ? `Comparables rechazados: ${research.rejectedComparableCount}.`
        : null, research && research.confirmedSoldQuantity > 0
        ? `Unidades vendidas confirmadas: ${research.confirmedSoldQuantity}.`
        : null, research?.lastSoldAt
        ? `Venta comparable más reciente: ${new Date(
          research.lastSoldAt).toISOString()}.` : null,
      research?.minimumSoldPrice === null || research?.minimumSoldPrice ===
        undefined ? null : `Precio vendido mínimo: USD ${
          research.minimumSoldPrice.toFixed(2)}.`,
      research?.maximumSoldPrice === null || research?.maximumSoldPrice ===
        undefined ? null : `Precio vendido máximo: USD ${
          research.maximumSoldPrice.toFixed(2)}.`],
    missing: [!researchExecuted ? "Ejecución durable de Product Research"
      : null, researchFreshness.status === "STALE"
        ? "Evidencia vendida vigente" : null,
      researchCertificationMissing && !research?.itemIdDedupeProven
        ? "Dedupe durable de Item ID" : null,
      researchCertificationMissing && !research?.soldDatesPresent
        ? "Fecha de venta de cada comparable aceptado" : null,
      researchCertificationMissing && !research?.conditionCoverageProven
        ? "Condición de cada comparable aceptado" : null,
      researchCertificationMissing && !research?.shippingTreatmentProven
        ? "Tratamiento de shipping de cada comparable aceptado" : null],
    result: researchCertificationComplete
      ? comparableCount && comparableCount > 0
        ? "Mercado comprobado con comparables vendidos."
        : "La investigación terminó sin evidencia vendida suficiente."
      : researchCertificationMissing
        ? "La investigación existe, pero no reúne todos los campos exigidos para certificación física."
      : researchFailed ? "Product Research registró un fallo."
        : "No hay investigación vigente demostrada para este producto.",
    decision: researchCertificationComplete && comparableCount && comparableCount > 0
      ? "SOLD_DEMAND_AVAILABLE" : researchCurrent
        ? "INSUFFICIENT_SOLD_EVIDENCE" : "RESEARCH_REQUIRED",
    failureClass: researchFailed ? "PRODUCT_RESEARCH_EXECUTION_FAILED"
      : researchFreshness.status === "STALE" ? "SOLD_EVIDENCE_STALE"
        : researchCertificationMissing
          ? "PRODUCT_RESEARCH_CERTIFICATION_FIELDS_MISSING"
        : researchExecuted ? null : "PRODUCT_RESEARCH_NOT_EXECUTED",
    retrySafety: researchCertificationComplete ? "NOT_APPLICABLE"
      : "SAFE_IDEMPOTENT_RUNTIME_RESUME",
    nextAction: researchCertificationComplete ? "Entregar la evidencia a Radar."
      : "Seller OS debe ejecutar o renovar Product Research.",
    ownerIntervention: "Ninguna. Seller OS genera y ejecuta el plan.",
    databaseWriteCount: null, marketplaceWriteCount: 0,
    technicalEvidence: {
      inputReferences: research?.queries.map((query) => `query: ${query}`) ?? [],
      outputReferences: [ref("soldEvidenceDigest",
        queue.sold_evidence_digest), comparableCount === null ? null
        : `acceptedComparables: ${comparableCount}`],
      receiptReferences: [research?.captureBatchCount
        ? `captureBatches: ${research.captureBatchCount}` : null,
      research?.dedupedComparableCount === undefined ? null
        : `dedupedComparables: ${research.dedupedComparableCount}`],
    },
  })

  const radarPresent = Boolean(text(radar.contractVersion))
  const demandStatus = text(radarObservation.family_demand_status)
    ?? text(market.familyDemandStatus)
  const radarNeedsResearch = demandStatus?.includes("UNPROVEN") === true
    || demandStatus === "RESEARCH_REQUIRED"
  const nextResearchPlanPresent = Boolean(research?.planCount)
  const radarLoopBroken = radarPresent && radarNeedsResearch
    && !nextResearchPlanPresent
  const radarPhase = phase({
    ordinal: 3, code: "RADAR", label: "Radar / interpretación de demanda",
    status: radarLoopBroken ? "TIENE_UN_FALLO" : radarPresent
      ? "COMPROBADO" : "PENDIENTE",
    mechanismCertification: radarLoopBroken ? "FAILED"
      : radarPresent ? "PHYSICAL_PASS" : "NOT_CERTIFIED",
    startedAt: date(radarObservation.observation_window_start),
    completedAt: radarPresent ? date(radarObservation.evidence_observed_at)
      ?? date(queue.updated_at) : null,
    trigger: text(radar.contractVersion) ?? "WAITING_FOR_MARKET_EVIDENCE",
    sourceAuthority: text(radarObservation.source_contract_version)
      ?? text(radar.authority) ?? "NO_AUTHORITY_AVAILABLE",
    freshness: freshness({ observedAt:
      radarObservation.evidence_observed_at,
      explicit: radarObservation.fresh === true ? "FRESH"
        : radarObservation.fresh === false ? "STALE" : null,
      expiresAt: radarObservation.evidence_observed_at &&
        numberValue(radarObservation.maximum_age_seconds) !== null
        ? new Date(Date.parse(String(radarObservation.evidence_observed_at)) +
          Number(radarObservation.maximum_age_seconds) * 1000).toISOString()
        : null }, now),
    attempted: "Interpretar la demanda de la familia sin atribuirla al producto exacto.",
    found: [ref("Resultado de demanda", demandStatus),
      ref("Familia", radar.familyId),
      numberValue(radarObservation.sold_comparable_count) === null ? null
        : `Comparables vendidos de familia: ${
          numberValue(radarObservation.sold_comparable_count)}.`],
    missing: [radarLoopBroken ?
      "Plan de investigación para cerrar la evidencia faltante" : null],
    result: radarPresent ? radarNeedsResearch
      ? "Radar determinó que necesita evidencia adicional."
      : "Radar produjo una interpretación durable de demanda."
      : "Radar todavía no ha producido un resultado durable.",
    decision: radarNeedsResearch ? "RESEARCH_REQUIRED"
      : demandStatus ?? "PENDING",
    failureClass: radarLoopBroken
      ? "RADAR_RESEARCH_REQUIRED_WITHOUT_NEXT_RESEARCH_PLAN" : null,
    retrySafety: radarLoopBroken ? "SAFE_IDEMPOTENT_RUNTIME_RESUME"
      : "NOT_APPLICABLE",
    nextAction: radarLoopBroken
      ? "Seller OS debe crear y enlazar el siguiente plan de Research."
      : radarNeedsResearch ? "Ejecutar el plan de Research ya enlazado."
        : "Continuar con rentabilidad.",
    ownerIntervention: "Ninguna intervención técnica.",
    databaseWriteCount: null,
    marketplaceWriteCount: numberValue(radar.marketplaceWrites),
    technicalEvidence: { inputReferences: [ref("demandEvidenceDigest",
      radarObservation.demand_evidence_digest)],
      outputReferences: [ref("opportunityCase",
        radarObservation.opportunity_case_id), ref("demandStatus", demandStatus)],
      receiptReferences: [ref("observationId",
        radarObservation.observation_id), ref("radarContract",
        radar.contractVersion)] },
  })

  const supplierCost = numberValue(packagePricing.supplierCost)
    ?? numberValue(marketTest.supplierCost)
  const shippingCost = numberValue(packagePricing.estimatedOutboundShipping)
    ?? numberValue(marketTest.shipping)
  const fees = numberValue(packagePricing.estimatedEbayFees)
    ?? numberValue(marketTest.ebayFees)
  const profit = numberValue(packagePricing.estimatedNetProfit)
    ?? numberValue(marketTest.profit)
  const margin = numberValue(packagePricing.estimatedNetMarginPercent)
    ?? numberValue(marketTest.margin)
  const roi = numberValue(packagePricing.estimatedRoiPercent)
    ?? numberValue(marketTest.roi)
  const targetPrice = numberValue(packagePricing.targetPrice)
    ?? numberValue(marketTest.testPrice)
  const marketPriceSupport = text(packagePricing.marketPriceSupport)
    ?? text(marketTest.marketPriceSupport)
  const costStackComplete = [supplierCost, shippingCost, fees, profit, margin,
    roi, targetPrice].every((value) => value !== null)
  const marketPriceProven = marketPriceSupport !== null
    && !marketPriceSupport.includes("UNPROVEN")
  const economicsPhase = phase({
    ordinal: 4, code: "ECONOMICS", label: "Pricing / rentabilidad",
    status: costStackComplete && marketPriceProven ? "COMPROBADO"
      : costStackComplete ? "FALTA_COMPROBAR" : "PENDIENTE",
    mechanismCertification: costStackComplete ? "INTERNAL_PASS"
      : "NOT_CERTIFIED",
    startedAt: date(frontier.source_updated_at),
    completedAt: costStackComplete ? date(frontier.calculated_at)
      ?? date(materialization.materializedAt) : null,
    trigger: text(packagePricing.calculationSource)
      ?? "FRESH_SOLD_EVIDENCE_REQUIRED",
    sourceAuthority: marketPriceProven
      ? text(frontier.market_price_evidence_reference)
        ?? "DURABLE_MARKET_PRICE_EVIDENCE"
      : "MARKET_PRICE_UNPROVEN",
    freshness: freshness({ observedAt: frontier.source_updated_at,
      expiresAt: null }, now),
    attempted: "Comprobar precio de mercado y calcular el stack completo de costos.",
    found: [money("Precio propuesto", targetPrice),
      money("Costo proveedor", supplierCost), money("Shipping", shippingCost),
      money("Fees estimados", fees), money("Beneficio esperado", profit),
      margin === null ? null : `Margen esperado: ${margin.toFixed(2)}%.`,
      roi === null ? null : `ROI esperado: ${roi.toFixed(2)}%.`],
    missing: [!marketPriceProven ? "Precio/banda de mercado demostrada"
      : null, !costStackComplete ? "Stack económico completo" : null],
    result: marketPriceProven && costStackComplete
      ? "Precio y rentabilidad comprobados."
      : costStackComplete
        ? "El costo está calculado, pero el precio de mercado sigue sin demostrar."
        : "La rentabilidad todavía no puede comprobarse.",
    decision: marketPriceProven && costStackComplete ? "ECONOMICS_ELIGIBLE"
      : "MARKET_PRICE_UNPROVEN",
    failureClass: null,
    retrySafety: marketPriceProven && costStackComplete ? "NOT_APPLICABLE"
      : "SAFE_IDEMPOTENT_RUNTIME_RESUME",
    nextAction: marketPriceProven ? "Continuar al anuncio."
      : "Seller OS debe obtener evidencia vendida antes de afirmar competitividad.",
    ownerIntervention: "Ninguna intervención técnica.",
    databaseWriteCount: null,
    marketplaceWriteCount: numberValue(marketTest.marketplaceWrites),
    technicalEvidence: { inputReferences: [ref("marketEvidence",
      frontier.market_price_evidence_digest), ref("economicPolicy",
        frontier.economic_policy_digest)],
      outputReferences: [ref("frontierDigest", frontier.frontier_digest),
        ref("packageDigest", digest)],
      receiptReferences: [ref("frontierId", frontier.frontier_id)] },
  })

  const shippingAmount = numberValue(packageShipping
    .supplierShippingEconomicsUsd) ?? numberValue(frontier.shipping_value)
  const shippingCapture = record(frontier.shipping_capture_evidence)
  const shippingDurable = shipping.shippingJobStatus ===
      "SHIPPING_EVIDENCE_DURABLE" || frontier.shipping_status ===
      "SHIPPING_DURABLY_PERSISTED"
  const shippingIdentityExact = shippingCapture.candidateId === candidateId
    && shippingCapture.lunaProductId === productId
    && shippingCapture.lunaVariantId === variantId
    && shippingCapture.supplierSku === supplierSku
  const shippingPhysicalReceipt = shippingDurable && shippingIdentityExact
    && numberValue(shippingCapture.subtotalUsd) !== null
    && numberValue(shippingCapture.shippingUsd) !== null
    && numberValue(shippingCapture.totalUsd) !== null
    && text(shippingCapture.canonicalDestinationAuthority) !== null
    && text(shippingCapture.canonicalDestinationFingerprint) !== null
    && shippingCapture.canonicalDestinationMatch === true
    && shippingCapture.noPurchase === true
    && text(shippingCapture.evidenceDigest, 100) !== null
    && date(shippingCapture.observedAt) !== null
  const shippingFailure = shippingDurable && !shippingPhysicalReceipt
  const shippingFreshness = freshness({
    observedAt: shippingCapture.observedAt ?? frontier.source_updated_at,
    expiresAt: shippingCapture.expiresAt,
    maximumAgeSeconds: shippingCapture.maximumAgeSeconds,
  }, now)
  const shippingCurrent = shippingPhysicalReceipt &&
    shippingFreshness.status === "FRESH"
  const shippingPhase = phase({
    ordinal: 5, code: "SHIPPING", label: "Shipping",
    status: shippingFailure ? "TIENE_UN_FALLO" : shippingCurrent
      ? "COMPROBADO" : shippingPhysicalReceipt ? "FALTA_COMPROBAR"
        : shipping.shippingJobStatus === "WAITING_BROWSER_WORKER"
        ? "EN_PROCESO" : "FALTA_COMPROBAR",
    mechanismCertification: shippingFailure ? "FAILED"
      : shippingPhysicalReceipt ? "PHYSICAL_PASS" : "NOT_CERTIFIED",
    startedAt: date(shippingClaim.claimed_at),
    completedAt: shippingPhysicalReceipt ? date(shippingClaim.completed_at)
      ?? date(shippingCapture.observedAt) ?? date(frontier.calculated_at)
      : null,
    trigger: text(shipping.contractVersion) ?? "SHIPPING_REQUIRED",
    sourceAuthority: text(packageShipping.supplierShippingEvidenceClass)
      ?? text(frontier.shipping_status) ?? "NO_AUTHORITY_AVAILABLE",
    freshness: shippingFreshness,
    attempted: "Obtener el costo exacto de envío para la variante y destino autorizados.",
    found: [money("Subtotal", shippingCapture.subtotalUsd),
      money("Shipping", shippingAmount), money("Total", shippingCapture.totalUsd),
      shippingCapture.canonicalDestinationMatch === true
        ? "Destino canónico verificado; fingerprint presente y oculto." : null,
      shipping.purchaseBoundaryEnforced === true
        ? "Límite de compra protegido; no se completó ninguna compra." : null,
      shipping.rawAddressPersisted === false
        ? "No se persistió la dirección en el receipt." : null],
    missing: [!shippingDurable ? "Receipt durable de Shipping" : null,
      shippingFailure && !shippingIdentityExact
        ? "Binding exacto producto/variante del capture" : null,
      shippingFailure && text(shippingCapture.canonicalDestinationFingerprint)
        === null ? "Autoridad de destino canónico" : null,
      shippingFailure && [shippingCapture.subtotalUsd,
        shippingCapture.shippingUsd, shippingCapture.totalUsd].some((value) =>
        numberValue(value) === null) ? "Subtotal, shipping y total" : null,
      shippingPhysicalReceipt && !shippingCurrent
        ? "Freshness vigente del Shipping" : null],
    result: shippingCurrent
      ? "Shipping obtenido y persistido sin completar una compra."
      : shippingPhysicalReceipt
        ? "El capture físico existe, pero su vigencia actual no está demostrada."
      : shippingFailure ? "Existe un resumen durable, pero el receipt físico de Shipping está incompleto."
        : "Shipping aún no está comprobado.",
    decision: shippingCurrent ? "SHIPPING_PROVEN"
      : "SHIPPING_REQUIRED",
    failureClass: shippingFailure ? "SHIPPING_PHYSICAL_RECEIPT_INCOMPLETE"
      : shippingPhysicalReceipt && shippingFreshness.status === "STALE"
        ? "SHIPPING_EVIDENCE_STALE"
        : shippingPhysicalReceipt ? "SHIPPING_FRESHNESS_UNPROVEN" : null,
    retrySafety: shippingCurrent ? "NOT_APPLICABLE"
      : "SAFE_IDEMPOTENT_RUNTIME_RESUME",
    nextAction: shippingCurrent ? "Usar el monto en economía y package."
      : "Seller OS debe adquirir el job durable de Shipping.",
    ownerIntervention: "Ninguna. Nunca se completa una compra.",
    databaseWriteCount: null,
    marketplaceWriteCount: numberValue(shipping.marketplaceWrites),
    technicalEvidence: { inputReferences: [ref("candidate", candidateId),
      ref("shippingSnapshot", shippingClaim.snapshot_digest)],
      outputReferences: [ref("frontierDigest", frontier.frontier_digest),
        ref("shippingEvidenceDigest", shippingCapture.evidenceDigest),
        shippingAmount === null ? null : `shippingUsd: ${shippingAmount}`],
      receiptReferences: [ref("captureSession",
        shippingClaim.capture_session_id)] },
  })

  const materialPackageCurrent = materialization.materialPackageCurrent === true
    || packageMarketTest.finalListingPackageReady === true
  const packageImages = Array.isArray(packageData.imageUrls)
    ? packageData.imageUrls.length : rows(packageData.imageAssetManifest).length
  const packageComplete = Boolean(packageId && digest && imageSetDigest
    && packageImages > 0 && materialPackageCurrent)
  const packagePhase = phase({
    ordinal: 6, code: "LISTING_PACKAGE", label: "Listing package",
    status: packageComplete ? "COMPROBADO" : packageId
      ? "EN_PROCESO" : "PENDIENTE",
    mechanismCertification: packageComplete ? "INTERNAL_PASS"
      : "NOT_CERTIFIED",
    startedAt: date(listingPackage.created_at),
    completedAt: packageComplete ? date(materialization.materializedAt)
      ?? date(listingPackage.updated_at) : null,
    trigger: text(materialization.contractVersion)
      ?? "LISTING_PACKAGE_REQUIRED",
    sourceAuthority: packageComplete
      ? "CURRENT_IMMUTABLE_LISTING_PACKAGE" : "NO_AUTHORITY_AVAILABLE",
    freshness: freshness({ observedAt: listingPackage.source_observed_at,
      durable: packageComplete }, now),
    attempted: "Construir el anuncio con hechos, economía e imágenes autorizadas.",
    found: [ref("Título", packageData.title),
      ref("Categoría", packageData.categoryName ?? packageData.categoryId),
      ref("Condición", packageData.conditionLabel ?? packageData.conditionId),
      targetPrice === null ? null : money("Precio", targetPrice),
      numberValue(packageData.quantity) === null ? null
        : `Cantidad: ${numberValue(packageData.quantity)}.`,
      packageImages ? `Imágenes: ${packageImages}, con orden persistido.` : null,
      `Item specifics persistidos: ${Object.keys(record(packageData.aspects)).length}.`],
    missing: [!digest ? "Digest del package" : null,
      !imageSetDigest ? "Digest de imágenes" : null,
      packageImages < 1 ? "Imágenes autorizadas" : null],
    result: packageComplete ? "Listing package materializado y comprobado."
      : "El listing package aún no está completo.",
    decision: packageComplete ? "PACKAGE_CURRENT" : "PACKAGE_PREPARATION_REQUIRED",
    failureClass: packageId && !packageComplete
      ? "LISTING_PACKAGE_INCOMPLETE" : null,
    retrySafety: packageComplete ? "NOT_APPLICABLE"
      : "SAFE_IDEMPOTENT_RUNTIME_RESUME",
    nextAction: packageComplete ? "Esperar autorización comercial exacta."
      : "Seller OS debe rematerializar antes de pedir autorización.",
    ownerIntervention: "Ninguna hasta que el package esté listo.",
    databaseWriteCount: null,
    marketplaceWriteCount: numberValue(materialization.marketplaceWrites),
    technicalEvidence: { inputReferences: [ref("productTruthDigest",
      productTruthDigest), ref("frontierDigest", frontier.frontier_digest)],
      outputReferences: [ref("packageDigest", digest),
        ref("imagesDigest", imageSetDigest)],
      receiptReferences: [ref("packageId", packageId),
        ref("materialization", materialization.contractVersion)] },
  })

  const authorizedPackageId = text(batchChild.package_id, 80)
    ?? text(approval.listing_package_id, 80)
  const authorizedDigest = text(batchChild.package_digest, 100)
    ?? text(approval.payload_hash, 100)
  const batchBinding = record(batchChild.authorization_binding)
  const bindingDigest = text(batchBinding.packageDigest, 100)
    ?? (typeof authorizedDigest === "string" && authorizedDigest.startsWith(
      "sha256:") ? authorizedDigest : null)
  const authorizationPresent = Boolean(text(approval.id, 80)
    || text(batchChild.id, 80))
  const authorizationExact = authorizationPresent && authorizedPackageId ===
    packageId && (text(batchChild.package_digest, 100) ?? bindingDigest) === digest
  const authorizationFailed = authorizationPresent && !authorizationExact
  const authorizationPhase = phase({
    ordinal: 7, code: "OWNER_AUTHORIZATION", label: "Tu aprobación",
    status: authorizationFailed ? "TIENE_UN_FALLO" : authorizationExact
      ? "COMPROBADO" : packageComplete ? "PENDIENTE" : "FALTA_COMPROBAR",
    mechanismCertification: authorizationFailed ? "FAILED"
      : authorizationExact ? "PHYSICAL_PASS" : "NOT_CERTIFIED",
    startedAt: date(approval.approved_at) ?? date(batchChild.created_at),
    completedAt: authorizationExact ? date(approval.approved_at)
      ?? date(batchChild.created_at) : null,
    trigger: authorizationPresent ? "OWNER_COMMERCIAL_AUTHORIZATION"
      : "WAITING_FOR_EXACT_PACKAGE",
    sourceAuthority: authorizationExact
      ? "EXACT_OWNER_AUTHORIZATION_BINDING" : "NO_AUTHORITY_AVAILABLE",
    freshness: freshness({ observedAt: approval.approved_at,
      expiresAt: approval.expires_at, durable: authorizationExact &&
        text(batchChild.id, 80) !== null }, now),
    attempted: "Vincular la decisión comercial al producto, package y digest exactos.",
    found: authorizationExact ? [ref("Producto", candidateId),
      ref("Package", packageId), ref("Digest autorizado", digest),
      targetPrice === null ? null : money("Precio", targetPrice),
      `Cantidad: ${numberValue(packageData.quantity) ?? "no comprobada"}.`,
      `Imágenes: ${packageImages}.`] : [],
    missing: [!authorizationPresent ? "Autorización comercial" : null,
      authorizationFailed ? "Binding exacto al digest actual" : null],
    result: authorizationExact
      ? "El owner autorizó el conjunto comercial exacto."
      : authorizationFailed
        ? "La autorización no coincide con el package actual y no puede reutilizarse."
        : "Aún no existe autorización comercial para este package.",
    decision: authorizationExact ? "EXACT_PACKAGE_AUTHORIZED"
      : authorizationFailed ? "AUTHORIZATION_INVALID"
        : "OWNER_AUTHORIZATION_PENDING",
    failureClass: authorizationFailed ? "AUTHORIZED_DIGEST_MISMATCH" : null,
    retrySafety: authorizationFailed ? "OWNER_COMMERCIAL_AUTHORIZATION_REQUIRED"
      : authorizationExact ? "NOT_APPLICABLE"
        : "OWNER_COMMERCIAL_AUTHORIZATION_REQUIRED",
    nextAction: authorizationExact ? "Publisher puede hacer preflight read-only."
      : packageComplete ? "Presentar este conjunto exacto al owner."
        : "Terminar el package antes de pedir aprobación.",
    ownerIntervention: authorizationExact ? "Ninguna adicional para este digest."
      : packageComplete ? "Decisión comercial cuando Seller OS presente el lote."
        : "Ninguna todavía.",
    databaseWriteCount: null, marketplaceWriteCount: 0,
    technicalEvidence: { inputReferences: [ref("packageDigest", digest),
      ref("imagesDigest", imageSetDigest)],
      outputReferences: [ref("authorizedDigest", text(batchChild.package_digest,
        100) ?? bindingDigest)],
      receiptReferences: [ref("approvalId", approval.id),
        ref("batchChildId", batchChild.id),
        ref("batchAuthorizationId", batchChild.batch_authorization_id)] },
  })

  const batchStatus = text(batchChild.status, 80)
  const publisherFailure = text(batchChild.error_class, 160)
    ?? text(execution.last_error_code, 160)
    ?? text(publication.last_error_code, 160)
  const publisherFailed = Boolean(publisherFailure) || ["FAILED_BLOCKED",
    "AMBIGUOUS_FAIL_CLOSED"].includes(batchStatus ?? "")
  const publisherWorking = ["AUTHORIZED", "CLAIMED", "RUNNING",
    "FAILED_RETRY_SAFE"].includes(batchStatus ?? "")
    || ["claimed", "running"].includes(text(execution.phase, 40) ?? "")
  const publicationComplete = Boolean(itemId) && ["PUBLISHED_CONFIRMED",
    "ACTIVE_CONFIRMED"].includes(text(batchChild.official_readback_state, 80)
      ?? "")
  const offerPrepared = Boolean(offerId) && ["completed", "preview_ready",
    "monitor_registered"].includes(text(execution.phase, 80)
      ?? text(publication.phase, 80) ?? "")
  const publisherPhase = phase({
    ordinal: 8, code: "PUBLISHER", label: "Publisher",
    status: publisherFailed ? "TIENE_UN_FALLO" : publicationComplete
      ? "COMPROBADO" : publisherWorking || offerPrepared
        ? "EN_PROCESO" : authorizationExact ? "PENDIENTE"
          : "FALTA_COMPROBAR",
    mechanismCertification: publisherFailed ? "FAILED"
      : publicationComplete || offerPrepared ? "PHYSICAL_PASS"
        : text(execution.id, 80) ? "INTERNAL_PASS" : "NOT_CERTIFIED",
    startedAt: date(execution.created_at) ?? date(batchChild.created_at),
    completedAt: publicationComplete ? date(publication.published_at)
      ?? date(batchChild.updated_at) : offerPrepared
        ? date(execution.completed_at) ?? date(execution.updated_at) : null,
    trigger: authorizationExact ? "EXACT_OWNER_AUTHORIZATION"
      : "WAITING_FOR_AUTHORIZATION",
    sourceAuthority: text(batchChild.receipt_digest, 100)
      ? "SELLER_OS_PUBLISHER_BATCH_CHILD_RECEIPT"
      : text(execution.id, 80) ? "EBAY_DRAFT_ONLY_EXECUTION_LEDGER"
        : "NO_AUTHORITY_AVAILABLE",
    freshness: freshness({ observedAt: batchChild.updated_at
      ?? execution.updated_at, durable: true }, now),
    attempted: "Ejecutar preflight read-only, reutilizar o crear Offer y publicar idempotentemente.",
    found: [ref("Offer", offerId), ref("Etapa",
      batchChild.stage ?? publication.phase ?? execution.phase),
      marketplaceWrites === null ? null
        : `Escrituras marketplace registradas: ${marketplaceWrites}.`],
    missing: [!offerId && authorizationExact ? "Offer comprobado" : null,
      !publicationComplete ? "Publicación y readback LIVE" : null],
    result: publisherFailed ? "Publisher registró un fallo exacto y quedó fail-closed."
      : publicationComplete ? "Publisher completó la publicación."
        : offerPrepared ? "Offer preparado; la publicación aún no está confirmada LIVE."
          : "Publisher aún no ha ejecutado este producto.",
    decision: publisherFailed ? "FAIL_CLOSED" : publicationComplete
      ? "PUBLISHED" : offerPrepared ? "OFFER_PREPARED" : "PENDING",
    failureClass: publisherFailed ? publisherFailure
      ?? "PUBLISHER_FAILED_BLOCKED" : null,
    retrySafety: text(batchChild.retry_safety, 100)
      ?? (publisherFailed ? "ENGINEERING_REQUIRED" : "NOT_APPLICABLE"),
    nextAction: publisherFailed ? "Seller OS debe aplicar la recuperación genérica clasificada."
      : publicationComplete ? "Verificar estado LIVE."
        : authorizationExact ? "Seller OS continúa por el runtime normal."
          : "Esperar autorización exacta.",
    ownerIntervention: publisherFailed ? "Ninguna recuperación técnica."
      : "Sólo la decisión comercial legítima cuando corresponda.",
    databaseWriteCount: null, marketplaceWriteCount: marketplaceWrites,
    technicalEvidence: { inputReferences: [ref("authorizedDigest", digest)],
      outputReferences: [ref("offerId", offerId), ref("itemId", itemId)],
      receiptReferences: [ref("executionId", execution.id),
        ref("publicationId", publication.id),
        ref("receiptDigest", batchChild.receipt_digest)] },
  })

  const officialState = text(batchChild.official_readback_state, 100)
    ?? text(publication.phase, 100)
  const officialReadbackPassed = Boolean(itemId) && ["PUBLISHED_CONFIRMED",
    "ACTIVE_CONFIRMED", "monitor_registered"].includes(officialState ?? "")
  const officialReadbackFailed = publisherFailed && (publisherFailure
    ?.includes("READBACK") === true || publisherFailure
      ?.includes("AMBIGUOUS") === true)
  const readbackPhase = phase({
    ordinal: 9, code: "OFFICIAL_EBAY_READBACK",
    label: "Readback oficial de eBay",
    status: officialReadbackFailed ? "TIENE_UN_FALLO"
      : officialReadbackPassed ? "COMPROBADO" : offerId
        ? "PENDIENTE" : "FALTA_COMPROBAR",
    mechanismCertification: officialReadbackFailed ? "FAILED"
      : officialReadbackPassed ? "PHYSICAL_PASS" : offerPrepared
        ? "INTERNAL_PASS" : "NOT_CERTIFIED",
    startedAt: date(publication.publish_started_at),
    completedAt: officialReadbackPassed ? date(publication.verified_active_at)
      ?? date(publication.monitor_registered_at) ?? date(batchChild.updated_at)
      : null,
    trigger: "POST_PUBLISH_OFFICIAL_READBACK",
    sourceAuthority: officialReadbackPassed
      ? "OFFICIAL_EBAY_ACTIVE_READBACK" : offerId
        ? "OFFICIAL_EBAY_OFFER_READBACK_ONLY" : "NO_AUTHORITY_AVAILABLE",
    freshness: freshness({ observedAt: publication.verified_active_at
      ?? batchChild.updated_at, durable: officialReadbackPassed }, now),
    attempted: "Confirmar oficialmente Item, Offer, precio, cantidad y estado LIVE.",
    found: [ref("Offer", offerId), ref("Item", itemId),
      ref("Estado oficial", officialState)],
    missing: [!itemId ? "Item ID oficial" : null,
      !officialReadbackPassed ? "Confirmación oficial LIVE" : null],
    result: officialReadbackPassed
      ? "eBay confirmó oficialmente la publicación activa."
      : offerId ? "Existe Offer, pero no hay readback oficial LIVE."
        : "No existe todavía un resultado de publicación para releer.",
    decision: officialReadbackPassed ? "PUBLISHED_CONFIRMED"
      : "NOT_PUBLISHED_CONFIRMED",
    failureClass: officialReadbackFailed ? publisherFailure : null,
    retrySafety: officialReadbackFailed ? text(batchChild.retry_safety, 100)
      ?? "ENGINEERING_REQUIRED" : "SAFE_READ_ONLY_RECONCILIATION",
    nextAction: officialReadbackPassed ? "Registrar monitoreo LIVE."
      : offerId ? "Seller OS debe releer eBay antes de afirmar éxito."
        : "Esperar ejecución Publisher.",
    ownerIntervention: "Ninguna intervención técnica.",
    databaseWriteCount: null, marketplaceWriteCount: 0,
    technicalEvidence: { inputReferences: [ref("offerId", offerId)],
      outputReferences: [ref("itemId", itemId), ref("officialState",
        officialState)], receiptReferences: [ref("publicationId",
          publication.id), ref("activeListingId", activeListing.id)] },
  })

  const listingStatus = text(activeListing.listing_status, 80)
  const live = Boolean(itemId) && ["ACTIVE", "LIVE"].includes(
    listingStatus?.toUpperCase() ?? "")
  const liveIssues = [
    itemId && !text(activeListing.supplier_variant_id, 80)
      ? "SUPPLIER_LINK_MISSING" : null,
    itemId && !date(activeListing.last_ebay_sync_at)
      ? "READBACK_STALE" : null,
  ].filter((value): value is string => Boolean(value))
  const livePhase = phase({
    ordinal: 10, code: "LIVE_MONITORING", label: "LIVE / monitoreo",
    status: liveIssues.length ? "TIENE_UN_FALLO" : live
      ? "COMPROBADO" : "PENDIENTE",
    mechanismCertification: liveIssues.length ? "FAILED"
      : live ? "PHYSICAL_PASS" : "NOT_CERTIFIED",
    startedAt: date(publication.verified_active_at),
    completedAt: live ? date(activeListing.last_ebay_sync_at)
      ?? date(publication.monitor_registered_at) : null,
    trigger: "OFFICIAL_LIVE_CONFIRMATION",
    sourceAuthority: live ? "EBAY_ACTIVE_LISTING_OFFICIAL_READBACK"
      : "NO_AUTHORITY_AVAILABLE",
    freshness: freshness({ observedAt: activeListing.last_ebay_sync_at }, now),
    attempted: "Vigilar stock, ventas, calidad, evidencia y linkage después de LIVE.",
    found: [ref("Item", itemId), ref("Estado", listingStatus),
      ref("SKU", activeListing.ebay_sku ?? supplierSku)],
    missing: live ? liveIssues : ["Listing LIVE confirmado"],
    result: liveIssues.length ? "El listing está visible pero tiene una excepción de monitoreo."
      : live ? "Listing LIVE y enlazado al monitoreo."
        : "El producto todavía no está LIVE.",
    decision: liveIssues[0] ?? (live ? "LIVE_MONITORING_ACTIVE" : "PENDING"),
    failureClass: liveIssues[0] ?? null,
    retrySafety: liveIssues.length ? "SAFE_READ_ONLY_RECONCILIATION"
      : "NOT_APPLICABLE",
    nextAction: liveIssues.length
      ? "Seller OS debe reconciliar la autoridad de monitoreo."
      : live ? "Continuar StockGuard, Orders y Listing Quality."
        : "Esperar publicación confirmada.",
    ownerIntervention: "Sólo si una excepción se clasifica como decisión comercial.",
    databaseWriteCount: null, marketplaceWriteCount: 0,
    technicalEvidence: { inputReferences: [ref("itemId", itemId)],
      outputReferences: [ref("listingStatus", listingStatus)],
      receiptReferences: [ref("activeListingId", activeListing.id),
        ref("lastSyncAt", activeListing.last_ebay_sync_at)] },
  })

  const phases = Object.freeze([productPhase, researchPhase, radarPhase,
    economicsPhase, shippingPhase, packagePhase, authorizationPhase,
    publisherPhase, readbackPhase, livePhase])
  const groups = [
    ["PRODUCTO", "Producto", [1]],
    ["MERCADO", "Mercado", [2, 3]],
    ["RENTABILIDAD", "Rentabilidad", [4, 5]],
    ["ANUNCIO", "Anuncio", [6]],
    ["OWNER_AUTHORIZATION", "Tu aprobación", [7]],
    ["PUBLICACION", "Publicación", [8, 9]],
    ["LIVE", "LIVE", [10]],
  ] as const
  const ownerFlow = Object.freeze(groups.map(([code, label, ordinals]) => {
    const grouped = phases.filter((entry) =>
      (ordinals as readonly number[]).includes(entry.ordinal))
    return Object.freeze({ code, label,
      status: worstStatus(grouped.map((entry) => entry.status)) })
  }))
  const activity = Object.freeze([
    productStartedAt ? { occurredAt: productStartedAt,
      label: "Producto identificado", phase: "PRODUCT_TRUTH",
      authority: text(operation.contractVersion) ?? "DURABLE_QUEUE" } : null,
    productCompletedAt ? { occurredAt: productCompletedAt,
      label: "Producto y galería comprobados", phase: "PRODUCT_TRUTH",
      authority: text(imageReview.evidenceDigest) ?? "IMAGE_REVIEW_RECEIPT" }
      : null,
    research?.capturedAt ? { occurredAt: research.capturedAt,
      label: researchCurrent ? "Research completado"
        : "Research necesita renovación", phase: "PRODUCT_RESEARCH",
      authority: "PRODUCT_RESEARCH_CAPTURE_RECEIPT" } : null,
    radarPhase.completedAt ? { occurredAt: radarPhase.completedAt,
      label: radarNeedsResearch ? "Radar requiere más evidencia"
        : "Radar interpretó la demanda", phase: "RADAR",
      authority: text(radarObservation.observation_id)
        ?? text(radar.contractVersion) ?? "RADAR_RECEIPT" } : null,
    shippingPhase.completedAt ? { occurredAt: shippingPhase.completedAt,
      label: "Shipping obtenido", phase: "SHIPPING",
      authority: shippingPhase.sourceAuthority } : null,
    packagePhase.completedAt ? { occurredAt: packagePhase.completedAt,
      label: "Listing preparado", phase: "LISTING_PACKAGE",
      authority: digest ?? "PACKAGE_RECEIPT" } : null,
    authorizationPhase.completedAt ? { occurredAt:
      authorizationPhase.completedAt, label: "Autorización exacta registrada",
      phase: "OWNER_AUTHORIZATION", authority:
        text(batchChild.id, 80) ?? text(approval.id, 80) ?? "AUTH_RECEIPT" }
      : null,
    publisherPhase.startedAt ? { occurredAt: publisherPhase.startedAt,
      label: publisherFailed ? "Publicación bloqueada"
        : "Publicación iniciada", phase: "PUBLISHER",
      authority: text(execution.id, 80) ?? text(batchChild.id, 80)
        ?? "PUBLISHER_RECEIPT" } : null,
    readbackPhase.completedAt ? { occurredAt: readbackPhase.completedAt,
      label: "Readback oficial confirmado", phase: "OFFICIAL_EBAY_READBACK",
      authority: text(publication.id, 80) ?? "OFFICIAL_READBACK" } : null,
    livePhase.completedAt ? { occurredAt: livePhase.completedAt,
      label: "Listing LIVE", phase: "LIVE_MONITORING",
      authority: text(activeListing.id, 80) ?? "ACTIVE_LISTING_READBACK" }
      : null,
  ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => Date.parse(right.occurredAt) -
      Date.parse(left.occurredAt)))

  const violations = [] as Row[]
  for (const current of phases) {
    if (!current.sourceAuthority) violations.push({
      invariantCode: "EVERY_STAGE_HAS_SOURCE_AUTHORITY",
      failureClass: "PRODUCT_JOURNEY_SOURCE_AUTHORITY_MISSING",
      phase: current.code,
    })
    if (!current.freshness.status) violations.push({
      invariantCode: "EVERY_STAGE_HAS_FRESHNESS",
      failureClass: "PRODUCT_JOURNEY_FRESHNESS_MISSING",
      phase: current.code,
    })
    if (current.status === "COMPROBADO" &&
        current.technicalEvidence.outputReferences.length === 0) {
      violations.push({ invariantCode: "NO_FAKE_COMPLETED",
        failureClass: "PRODUCT_JOURNEY_FALSE_COMPLETED",
        phase: current.code })
    }
  }
  if (radarLoopBroken) violations.push({
    invariantCode: "RADAR_RESEARCH_REQUIRED_REQUIRES_NEXT_RESEARCH_PLAN",
    failureClass: "RADAR_RESEARCH_REQUIRED_WITHOUT_NEXT_RESEARCH_PLAN",
    phase: "RADAR",
  })
  const nextPhase = phases.find((entry) => entry.status !== "COMPROBADO")
    ?? phases.at(-1)!
  return Object.freeze({
    contractVersion: SELLER_OS_PRODUCT_JOURNEY_V1,
    mechanismVersion: SELLER_OS_PRODUCT_JOURNEY_V1,
    recoveryPolicyVersion: SELLER_OS_PRODUCT_JOURNEY_RECOVERY_POLICY_V1,
    observedAt: now.toISOString(),
    identity: Object.freeze({ candidateId, productId, variantId, supplierSku,
      title: text(queue.product_title) ?? text(productTruth.title), packageId,
      offerId, itemId, sourceUrl: text(operation.canonicalUrl
        ?? operation.sourceUrl, 2_000), provenance: text(record(card.provenance)
          .label) ?? (text(operation.batchId) ? "Origen · Luna"
          : "Origen · Por determinar") }),
    overall: Object.freeze({ status: worstStatus(phases.map((entry) =>
      entry.status)), completedPhaseCount: phases.filter((entry) =>
      entry.status === "COMPROBADO").length, totalPhaseCount: phases.length,
      nextAction: nextPhase.nextAction,
      ownerIntervention: nextPhase.ownerIntervention }),
    ownerFlow, phases, activity,
    integrity: Object.freeze({
      productJourneyTraceAvailable: true,
      everyStageHasHumanStatus: phases.every((entry) => Boolean(entry.status)),
      everyStageHasSourceAuthority: phases.every((entry) =>
        Boolean(entry.sourceAuthority)),
      everyStageHasFreshness: phases.every((entry) =>
        Boolean(entry.freshness.status)),
      everyStageHasOutputOrExplicitFailure: phases.every((entry) =>
        entry.technicalEvidence.outputReferences.length > 0
        || entry.status !== "COMPROBADO" || Boolean(entry.failureClass)),
      technicalDetailsSecondary: true,
      noFalseZero: true,
      noFakeCompleted: !violations.some((entry) =>
        entry.invariantCode === "NO_FAKE_COMPLETED"),
      noNewParallelRuntime: true,
      noOwnerTechnicalRecovery: phases.every((entry) =>
        !entry.ownerIntervention.toLowerCase().includes("técnic")
        || entry.ownerIntervention.toLowerCase().includes("ninguna")),
      marketplaceWritesForObservability: 0,
      databaseMutationsFromRead: 0,
      violations: Object.freeze(violations),
    }),
  })
}
