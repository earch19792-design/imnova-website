export type CommercialTraceEventV1 = Readonly<{
  sequence: number
  stage: string
  status: string
  narrative: string
  evidence: Record<string, unknown>
  observed_at: string
}>

export type CommercialTraceRecordV1 = Readonly<{
  trace_id: string
  state: "RUNNING" | "COMPLETED" | "FAILED"
  current_stage: string
  result: Record<string, unknown>
  product_url: string
  started_at: string
  updated_at: string
  completed_at: string | null
}>

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function unique(values: readonly (string | null)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function latest(events: readonly CommercialTraceEventV1[], stage: string) {
  return [...events].reverse().find((event) => event.stage === stage) ?? null
}

function evidence(events: readonly CommercialTraceEventV1[], stage: string) {
  return record(latest(events, stage)?.evidence)
}

export const COMMERCIAL_ANALYSIS_STEPS_V1 = Object.freeze([
  { id: "product", label: "Identificando producto",
    stages: ["PRODUCT_TRUTH"] },
  { id: "truth", label: "Validando información",
    stages: ["CLAIM_CONFLICTS", "COMPLIANCE", "STOCK"] },
  { id: "cost", label: "Calculando costo real",
    stages: ["PRODUCT_COST", "SHIPPING_QTY1", "LANDED_COST"] },
  { id: "market", label: "Buscando mercado en eBay",
    stages: ["MARKET_SEARCH_PROGRESS", "PRIMARY_KEYWORD_FAMILY",
      "SECONDARY_KEYWORDS", "KEYWORD_INTELLIGENCE"] },
  { id: "comparables", label: "Revisando productos comparables",
    stages: ["ACCEPTED_COMPARABLES", "NEAR_EXACT_SOLD_ENRICHMENT",
      "EXCLUDED_COMPARABLES"] },
  { id: "demand", label: "Midiendo demanda",
    stages: ["DEMAND_CLASSIFICATION"] },
  { id: "pricing", label: "Calculando precio",
    stages: ["PRICE_RANGE", "PRICING_EVIDENCE_QUALITY",
      "RECOMMENDED_PRICE"] },
  { id: "economics", label: "Evaluando margen",
    stages: ["ECONOMICS"] },
  { id: "decision", label: "Preparando recomendación",
    stages: ["FINAL_DECISION", "DECISION_LOOP"] },
] as const)

const CODE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  GTIN_CONFLICT: "Descartado: corresponde a otra identidad de producto",
  STRUCTURED_MODEL_CONFLICT: "Descartado: el modelo declarado no coincide",
  HOLD_DEMAND_UNPROVEN: "Esperar: todavía no hay suficiente evidencia de ventas",
  HOLD_SHIPPING_UNPROVEN: "Esperar: falta confirmar el costo de envío",
  HOLD_CLAIM_CONFLICTS: "Esperar: la identidad o los claims aún no son seguros",
  HOLD_ECONOMICS_UNPROVEN: "Esperar: el margen todavía no está demostrado",
  HOLD_INSUFFICIENT_EVIDENCE: "Esperar: falta evidencia comercial suficiente",
  HOLD_PRICING_EVIDENCE_QUALITY:
    "Esperar: la autoridad de pricing todavía no tiene calidad suficiente",
  NEAR_EXACT_SOLD_ENRICHMENT_NOT_COMPLETED:
    "Falta completar el historial SOLD de los productos más similares",
  PRODUCT_TRUTH_SUFFICIENT: "Falta completar la identidad segura del producto",
  SAFE_CLAIMS_PRESENT: "Faltan claims seguros para construir el listing",
  STOCK_VALID: "El stock disponible todavía no está validado",
  SHIPPING_QTY1_FRESH: "Falta shipping qty=1 exacto y fresco",
  MARKET_AUTHORITY_SUFFICIENT: "Falta evidencia de mercado suficiente",
  PRICING_AUTHORITY_SUFFICIENT:
    "La autoridad de pricing aún no está confirmada entre vendedores",
  ECONOMICS_PASS: "La economía completa todavía no pasa sus floors",
  PRIMARY_KEYWORD_COMPLETE: "Falta una familia principal respaldada",
  TITLE_COMPLETE: "Falta un título construido solo con claims seguros",
  ITEM_SPECIFICS_COMPLETE: "Faltan item specifics confirmados",
  IMAGES_VALID: "Falta un conjunto de imágenes válido",
  COMPLIANCE_CLEAR: "Existe un blocker de cumplimiento",
  IP_CLEAR: "Existe un blocker de propiedad intelectual",
  REJECT_ECONOMICS: "Descartar por ahora: el mercado no sostiene el margen requerido",
  REJECT_COMPLIANCE: "Descartar: existe un riesgo de cumplimiento",
  ADVANCE_TO_OWNER_COMMERCIAL_REVIEW:
    "Listo para revisión comercial del Owner",
  DO_NOT_USE: "No usar este dato en el listing",
  CLAIM_CONFLICT: "Información inconsistente; se usará solo el dato seguro",
  BOUNDED_LIMIT_REACHED: "Se completó la muestra máxima prevista",
  COMPARABLES_OBSERVED_DEMAND_UNPROVEN:
    "Hay productos comparables, pero las ventas todavía no están suficientemente demostradas",
  INSUFFICIENT_COMPARABLE_EVIDENCE:
    "Todavía no hay suficientes productos comparables confiables",
  ESTIMATED_MULTI_SELLER_DEMAND:
    "Señal de demanda estimada observada en varios vendedores",
  VERIFIED_MULTI_SELLER_DEMAND:
    "Demanda confirmada con ventas de varios vendedores",
  DEMAND_NOT_PROVEN: "La demanda todavía no está demostrada",
  EBAY_SOLD_HISTORY_LIMITED_RELEASE:
    "eBay ofrece historial de ventas limitado para esta consulta",
  EBAY_RESULT_SET_BOUNDED_BY_GATEWAY_SAMPLE:
    "Se revisó una muestra representativa y acotada del mercado",
  EXACT_EBAY_CATEGORY_FEE_UNPROVEN:
    "La tarifa exacta de la categoría de eBay aún no está confirmada",
  EXACT_SUPPLIER_QUANTITY_UNPROVEN:
    "El proveedor confirma disponibilidad, pero no una cantidad exacta",
  CONFLICTING_VIDEO_RESOLUTION_CLAIMS:
    "La fuente presenta resoluciones de video incompatibles",
  CONFLICTING_MICROPHONE_DIRECTIONALITY_CLAIMS:
    "La fuente describe de forma distinta la dirección del micrófono",
  DESCRIPTION_MENTIONS_UNCONFIRMED_RING_LIGHT_MODEL:
    "El ring light no está suficientemente confirmado",
})

export function humanCommercialCodeV1(value: unknown) {
  const code = text(value)
  if (!code) return "Sin observaciones"
  return CODE_LABELS[code] ?? "Dato técnico disponible para revisión"
}

export function humanDecisionV1(value: unknown) {
  const code = text(value) ?? ""
  if (code === "ADVANCE_TO_OWNER_COMMERCIAL_REVIEW") return Object.freeze({
    label: "TEST APPROVE", tone: "APPROVE",
    explanation: "La evidencia permite avanzar a revisión del Owner para una prueba controlada. Esto no autoriza publicación.",
  })
  if (code.includes("STRONG_APPROVE")) return Object.freeze({
    label: "STRONG APPROVE", tone: "APPROVE",
    explanation: "La evidencia comercial es fuerte, pero la publicación sigue requiriendo autorización del Owner.",
  })
  if (code.startsWith("REJECT")) return Object.freeze({
    label: "REJECT", tone: "REJECT", explanation: humanCommercialCodeV1(code),
  })
  if (code.startsWith("HOLD") || code === "FAIL_CLOSED") return Object.freeze({
    label: "HOLD", tone: "HOLD", explanation: humanCommercialCodeV1(code),
  })
  return Object.freeze({ label: "EN REVISIÓN", tone: "RUNNING",
    explanation: "Seller OS todavía está reuniendo evidencia." })
}

export function humanConflictExplanationV1(conflict: JsonRecord,
  safeClaims: readonly JsonRecord[]) {
  const code = text(conflict.code) ?? ""
  if (code === "CONFLICTING_VIDEO_RESOLUTION_CLAIMS") {
    const safeResolution = safeClaims.find((claim) =>
      claim.kind === "SPECIFICATION")?.value
    return safeResolution
      ? `La fuente menciona resoluciones diferentes. Para evitar información incorrecta, Seller OS usará ${safeResolution} y no anunciará las demás.`
      : "La fuente menciona resoluciones diferentes. Seller OS no anunciará ninguna hasta contar con evidencia consistente."
  }
  if (code === "CONFLICTING_MICROPHONE_DIRECTIONALITY_CLAIMS") {
    return "La dirección del micrófono no es consistente entre las fuentes. Se podrá indicar que incluye micrófono, pero no afirmar su patrón direccional."
  }
  if (code === "DESCRIPTION_MENTIONS_UNCONFIRMED_RING_LIGHT_MODEL") {
    return "El ring light no está suficientemente confirmado y no se incluirá en el listing ni en sus imágenes."
  }
  return text(conflict.evidence) ??
    "La información es inconsistente; Seller OS conservará únicamente el dato seguro."
}

export function humanComparableReasonV1(item: JsonRecord) {
  const rejected = text(item.rejectionReason)
  if (rejected) return humanCommercialCodeV1(rejected)
  if (item.comparableClass === "EXACT_MODEL_COMPARABLE") {
    return "Aceptado: coincide con el modelo investigado y no presenta una identidad incompatible."
  }
  if (item.comparableClass === "NEAR_EXACT_PRODUCT") {
    if (item.pricingAuthorityClass === "BRANDED_CATEGORY_SIGNAL_ONLY") {
      return "Aceptado como producto del mismo formato físico, pero su marca solo aporta señal de categoría y no autoridad de precio para un producto genérico."
    }
    return "Aceptado como producto del mismo formato: comparte los rasgos materiales observados sin afirmar una identidad exacta."
  }
  if (item.comparableClass === "FUNCTIONAL_COMPARABLE") {
    if (item.pricingAuthorityClass === "BRANDED_CATEGORY_SIGNAL_ONLY") {
      return "Aceptado como señal de demanda de categoría; al declarar una marca propia, no determina el precio del producto genérico."
    }
    return "Aceptado como equivalente funcional: atiende la misma intención de compra y pasó los controles de identidad."
  }
  return "Conservado como contexto de mercado; no determina por sí solo la recomendación."
}

function eventLists(result: JsonRecord,
  events: readonly CommercialTraceEventV1[]) {
  const acceptedEvidence = evidence(events, "ACCEPTED_COMPARABLES")
  const excludedEvidence = evidence(events, "EXCLUDED_COMPARABLES")
  const accepted = records(result.ACCEPTED_COMPARABLES).length
    ? records(result.ACCEPTED_COMPARABLES)
    : records(acceptedEvidence.acceptedComparables)
  const excluded = records(result.EXCLUDED_COMPARABLES).length
    ? records(result.EXCLUDED_COMPARABLES)
    : records(excludedEvidence.excludedComparables)
  const exact = records(result.EXACT_MODEL_ACCEPTED).length
    ? records(result.EXACT_MODEL_ACCEPTED)
    : records(acceptedEvidence.exactModelAccepted).length
      ? records(acceptedEvidence.exactModelAccepted)
      : accepted.filter((item) =>
        item.comparableClass === "EXACT_MODEL_COMPARABLE")
  const functional = records(result.FUNCTIONAL_ACCEPTED).length
    ? records(result.FUNCTIONAL_ACCEPTED)
    : records(acceptedEvidence.functionalAccepted).length
      ? records(acceptedEvidence.functionalAccepted)
      : accepted.filter((item) =>
        item.comparableClass === "FUNCTIONAL_COMPARABLE")
  const nearExact = records(result.NEAR_EXACT_ACCEPTED).length
    ? records(result.NEAR_EXACT_ACCEPTED)
    : records(acceptedEvidence.nearExactAccepted).length
      ? records(acceptedEvidence.nearExactAccepted)
      : accepted.filter((item) =>
        item.comparableClass === "NEAR_EXACT_PRODUCT")
  return { accepted, excluded, exact, nearExact, functional }
}

function safeListingTitle(claims: readonly JsonRecord[]) {
  const byKind = (kind: string) => text(claims.find((claim) =>
    claim.kind === kind)?.value)
  const identity = byKind("PRODUCT_IDENTITY")
  const specification = byKind("SPECIFICATION")
  const model = byKind("MODEL")
  const differentiators = claims.filter((claim) =>
    claim.kind === "FUNCTIONAL_DIFFERENTIATOR").map((claim) => text(claim.value))
    .filter((value): value is string => Boolean(value)).slice(0, 2)
  if (!identity) return null
  const base = `${specification ? `${specification} ` : ""}${identity}`
  const differentiated = differentiators.length
    ? `${base} with ${differentiators.join(" and ")}` : base
  return `${differentiated}${model ? ` ${model}` : ""}`.slice(0, 80)
}

function marketPosition(priceRange: JsonRecord, landedCost: number | null) {
  const minimum = number(priceRange.minimum)
  const median = number(priceRange.median)
  const maximum = number(priceRange.maximum)
  if (landedCost === null || maximum === null) {
    return "La posición competitiva no puede cerrarse hasta demostrar mercado y costo puesto."
  }
  if (landedCost > maximum) {
    return `El costo puesto supera el precio más alto de la evidencia utilizable; competir sin perder margen no está demostrado.`
  }
  if (median !== null && landedCost > median) {
    return "El costo puesto queda por encima de la mediana observada; el producto necesitaría diferenciación o un precio premium demostrado."
  }
  if (minimum !== null) {
    return "El costo puesto permanece dentro del rango observado; la viabilidad final depende de fees y margen neto."
  }
  return "La posición competitiva permanece en revisión."
}

function statusForStep(stepIndex: number, currentIndex: number,
  trace: CommercialTraceRecordV1 | null,
  matching: readonly CommercialTraceEventV1[]) {
  if (!trace) return "PENDING"
  if (matching.some((event) => event.status === "FAIL")) return "FAIL"
  if (trace.state === "RUNNING" && stepIndex === currentIndex) return "RUNNING"
  if (matching.some((event) => event.status === "BLOCKED")) return "WARN"
  if (trace.state === "COMPLETED" || stepIndex < currentIndex) return "PASS"
  if (trace.state === "FAILED" && stepIndex === currentIndex) return "FAIL"
  return "PENDING"
}

export function buildCommercialTracePresentationV1(input: Readonly<{
  trace: CommercialTraceRecordV1 | null
  events: readonly CommercialTraceEventV1[]
}>) {
  const { trace, events } = input
  const result = record(trace?.result)
  const lists = eventLists(result, events)
  const marketEvidence = evidence(events, "MARKET_SEARCH_PROGRESS")
  const productEvidence = evidence(events, "PRODUCT_TRUTH")
  const claimEvidence = evidence(events, "CLAIM_CONFLICTS")
  const productTruth = Object.keys(record(result.PRODUCT_TRUTH)).length
    ? record(result.PRODUCT_TRUTH) : productEvidence
  const safeClaims = records(result.SAFE_CLAIM_SUBSET).length
    ? records(result.SAFE_CLAIM_SUBSET) : records(claimEvidence.safeClaims)
  const doNotUseClaims = records(result.DO_NOT_USE_CLAIMS).length
    ? records(result.DO_NOT_USE_CLAIMS) : records(claimEvidence.doNotUseClaims)
  const conflicts = records(result.CLAIM_CONFLICTS).length
    ? records(result.CLAIM_CONFLICTS) : records(claimEvidence.conflicts)
  const found = number(marketEvidence.candidateFoundCount) ?? 0
  const returned = number(marketEvidence.returnedCandidateCount) ?? 0
  const enriched = number(marketEvidence.enrichedSampleCount) ?? 0
  const reviewed = lists.accepted.length + lists.excluded.length
  const acceptedCount = lists.exact.length + lists.nearExact.length +
    lists.functional.length
  const reconciled = reviewed === acceptedCount + lists.excluded.length
  const acceptedWithConfirmed = lists.accepted.filter((item) =>
    (number(item.confirmedSoldQuantity) ?? 0) > 0)
  const acceptedWithEstimated = lists.accepted.filter((item) =>
    (number(item.confirmedSoldQuantity) ?? 0) === 0 &&
    (number(item.estimatedSoldQuantity) ?? 0) > 0)
  const confirmedSales = acceptedWithConfirmed.reduce((sum, item) =>
    sum + (number(item.confirmedSoldQuantity) ?? 0), 0)
  const estimatedSales = acceptedWithEstimated.reduce((sum, item) =>
    sum + (number(item.estimatedSoldQuantity) ?? 0), 0)
  const currentIndex = Math.max(0, COMMERCIAL_ANALYSIS_STEPS_V1.findIndex(
    (step) => step.stages.includes(trace?.current_stage as never)))
  const progress = !trace ? 0 : trace.state === "COMPLETED" ? 100
    : Math.min(96, Math.round(((currentIndex + 0.45) /
      COMMERCIAL_ANALYSIS_STEPS_V1.length) * 100))
  const decision = humanDecisionV1(result.FINAL_DECISION)
  const secondaryEvidence = evidence(events, "SECONDARY_KEYWORDS")
  const secondaryKeywords = Array.isArray(result.SECONDARY_KEYWORDS)
    ? result.SECONDARY_KEYWORDS.filter((entry): entry is string =>
      typeof entry === "string")
    : Array.isArray(secondaryEvidence.secondaryKeywords)
      ? secondaryEvidence.secondaryKeywords.filter((entry): entry is string =>
        typeof entry === "string") : []
  const cost = number(result.PRODUCT_COST) ??
    number(evidence(events, "PRODUCT_COST").productCostUsd)
  const shipping = number(result.SHIPPING_QTY1) ??
    number(evidence(events, "SHIPPING_QTY1").amountUsd)
  const landed = number(result.LANDED_COST) ??
    number(evidence(events, "LANDED_COST").landedCostUsd)
  const stock = Object.keys(record(result.STOCK)).length
    ? record(result.STOCK) : evidence(events, "STOCK")
  const priceRange = record(result.PRICE_RANGE)
  const economicsEvidence = evidence(events, "ECONOMICS")
  const economics = Object.keys(record(result.ECONOMICS)).length
    ? record(result.ECONOMICS) : record(economicsEvidence.economics)
  const shippingAuthority = record(result.SHIPPING_AUTHORITY)
  const feeAuthority = record(result.FEE_AUTHORITY)
  const economicsAuthority = record(result.ECONOMICS_AUTHORITY)
  const shippingFreshUntil = text(shippingAuthority.freshUntil)
  const shippingStatus = shippingAuthority.status === "PROVEN" &&
    (!shippingFreshUntil || !Number.isFinite(Date.parse(shippingFreshUntil)) ||
      Date.parse(shippingFreshUntil) <= Date.now())
    ? "STALE" : text(shippingAuthority.status) ?? "UNKNOWN"
  const finalAuthorizedPrice = number(result.FINAL_AUTHORIZED_PRICE)
  const priceAuthorized = result.PRICE_AUTHORIZED === true &&
    shippingStatus === "PROVEN" && feeAuthority.status === "PROVEN" &&
    economicsAuthority.status === "PROVEN" &&
    finalAuthorizedPrice !== null && finalAuthorizedPrice > 0
  const economicFloor = Object.keys(record(result.ECONOMIC_FLOOR_EXPLANATION)).length
    ? record(result.ECONOMIC_FLOOR_EXPLANATION)
    : record(economicsEvidence.economicFloorExplanation)
  const pricingEvidence = evidence(events, "RECOMMENDED_PRICE")
  const recommendedPrice = number(result.RECOMMENDED_PRICE)
  const minimumMarginSafePrice = number(result.MINIMUM_MARGIN_SAFE_PRICE) ??
    number(pricingEvidence.minimumMarginSafePriceUsd)
  const safeClaimValues = safeClaims.map((claim) => text(claim.value))
    .filter((value): value is string => Boolean(value))
  const conflictExplanations = conflicts.map((conflict) =>
    humanConflictExplanationV1(conflict, safeClaims))
  const uncertaintyExplanations = (Array.isArray(result.KNOWN_UNCERTAINTIES)
    ? result.KNOWN_UNCERTAINTIES : []).map(humanCommercialCodeV1)
  const riskStatements = unique([
    ...conflictExplanations,
    ...uncertaintyExplanations,
    lists.excluded.length
      ? `${lists.excluded.length} resultados se descartaron por identidad, modelo u oferta incompatible.`
      : null,
  ])
  const shippingEvidence = evidence(events, "SHIPPING_QTY1")
  const exactQuery = text(result.EXACT_MODEL_SEARCH_QUERY) ??
    text(marketEvidence.exactModelSearchQuery)
  const functionalQuery = text(result.FUNCTIONAL_SEARCH_QUERY) ??
    text(marketEvidence.functionalSearchQuery)
  const model = text(productTruth.model) ?? text(safeClaims.find((claim) =>
    claim.kind === "MODEL")?.value)
  const gtin = text(productTruth.gtin) ?? text(productTruth.sourceUnitBarcode)
  const grossSpread = recommendedPrice !== null && landed !== null
    ? Math.round((recommendedPrice - landed) * 100) / 100 : null
  const technicalThresholds = record(marketEvidence.commercialSamplingPolicy)
  const marketSearches = record(marketEvidence.marketSearches)
  const pricingEvidenceQuality = record(result.PRICING_EVIDENCE_QUALITY)
  const decisionLoop = record(result.DECISION_LOOP)
  const listingPackage = record(result.LISTING_PACKAGE)

  const steps = COMMERCIAL_ANALYSIS_STEPS_V1.map((step, index) => {
    const matching = events.filter((event) =>
      step.stages.includes(event.stage as never))
    const lastEvent = matching.at(-1)
    let message = lastEvent?.narrative ?? "Esta etapa comenzará cuando corresponda."
    if (step.id === "comparables" && reviewed > 0) {
      message = `Revisé ${reviewed} resultados: acepté ${acceptedCount} (${lists.exact.length} del modelo, ${lists.nearExact.length} del mismo formato y ${lists.functional.length} equivalentes funcionales) y descarté ${lists.excluded.length}.`
    } else if (step.id === "market" && found > 0) {
      message = reviewed > 0 && reviewed === enriched
        ? `Encontré ${found} resultados de mercado y completé la revisión detallada de ${reviewed}.`
        : `Encontré ${found} resultados y seleccioné ${enriched} para revisión detallada; ${reviewed} ya están clasificados.`
    } else if (step.id === "demand" && result.DEMAND_CLASSIFICATION) {
      message = humanCommercialCodeV1(result.DEMAND_CLASSIFICATION)
    } else if (step.id === "decision" && result.FINAL_DECISION) {
      message = decision.explanation
    }
    return Object.freeze({ ...step, status: statusForStep(index, currentIndex,
      trace, matching), message, eventCount: matching.length })
  })

  const dossier = Object.freeze({
    generated: trace?.state === "COMPLETED",
    executiveSummary: decision.explanation,
    decision,
    confidence: text(result.CONFIDENCE),
    product: Object.freeze({
      title: text(productTruth.title),
      sku: text(productTruth.supplierSku), model, gtin,
      variant: text(productTruth.variantTitle),
      stockAvailable: stock.available === true,
      stockQuantity: number(stock.quantity ?? stock.inventoryQuantity),
      identityConfirmed: safeClaims.some((claim) =>
        claim.kind === "PRODUCT_IDENTITY") &&
        record(result.COMPLIANCE).status !== "BLOCKED",
    }),
    productTruth: Object.freeze({ safeClaims, doNotUseClaims, conflicts,
      conflictExplanations }),
    market: Object.freeze({ found, returned, reviewed,
      accepted: acceptedCount, exact: lists.exact.length,
      nearExact: lists.nearExact.length,
      functional: lists.functional.length, excluded: lists.excluded.length,
      reconciled, confirmedSales, estimatedSales,
      confirmedListings: acceptedWithConfirmed.length,
      estimatedListings: acceptedWithEstimated.length,
      demand: humanCommercialCodeV1(result.DEMAND_CLASSIFICATION),
      exactQuery, functionalQuery, acceptedComparables: lists.accepted,
      excludedComparables: lists.excluded,
      limitations: uncertaintyExplanations,
      competitivePosition: marketPosition(priceRange, landed),
    }),
    keywords: Object.freeze({ primary: text(result.PRIMARY_KEYWORD_FAMILY),
      finalEbayTitle: text(result.FINAL_EBAY_TITLE) ?? text(listingPackage.title),
      secondary: secondaryKeywords,
      longTail: Array.isArray(result.LONG_TAIL_KEYWORDS)
        ? result.LONG_TAIL_KEYWORDS.filter((entry): entry is string =>
          typeof entry === "string") : [],
      differentiators: Array.isArray(result.PRODUCT_DIFFERENTIATORS)
        ? result.PRODUCT_DIFFERENTIATORS.filter((entry): entry is string =>
          typeof entry === "string") : [],
      unsupportedOrExcluded: Array.isArray(result.UNSUPPORTED_OR_EXCLUDED_TERMS)
        ? result.UNSUPPORTED_OR_EXCLUDED_TERMS.filter((entry): entry is string =>
          typeof entry === "string") : [],
      provenance: record(result.KEYWORD_PROVENANCE),
      purchaseIntent: text(result.PRIMARY_KEYWORD_FAMILY)
        ? `Personas que buscan y comparan ${text(result.PRIMARY_KEYWORD_FAMILY)} antes de comprar.`
        : null }),
    economics: Object.freeze({ productCost: cost, shipping, landed,
      feeEstimate: number(economics.estimatedEbayFees), grossSpread,
      netProfit: number(economics.estimatedNetProfit),
      marginPercent: number(economics.estimatedNetMarginPercent),
      roiPercent: number(economics.estimatedRoiPercent),
      feesExact: economicsEvidence.feePolicyExact === true,
      shippingStatus,
      shippingReceiptId: text(shippingAuthority.durableReceiptId),
      shippingFreshUntil,
      feeAuthorityStatus: text(feeAuthority.status) ?? "UNKNOWN",
      feePolicyAuthority: record(result.FEE_POLICY_AUTHORITY),
      feeAmountAuthority: record(result.FEE_AMOUNT_AUTHORITY),
      conservativeFeeAuthority:
        record(result.PRELISTING_CONSERVATIVE_FEE_AUTHORITY),
      conservativeEconomics:
        record(result.PRELISTING_CONSERVATIVE_ECONOMICS),
      finalStatus: text(economicsAuthority.status) ?? "INCOMPLETE",
      finalValues: Object.keys(record(economicsAuthority.economics)).length
        ? record(economicsAuthority.economics) : null,
      finalProfitabilityGate: record(economicsAuthority.profitabilityGate),
      ownerPricePolicyAuthority:
        record(result.OWNER_PRICE_POLICY_AUTHORITY),
      promotedListingsPolicy:
        record(result.PROMOTED_LISTINGS_AUTHORITY),
      returnsReservePolicy: record(result.RETURNS_RESERVE_AUTHORITY),
      otherExplicitCostsPolicy: record(result.OTHER_EXPLICIT_COSTS_AUTHORITY),
      fulfillmentAuthority: record(result.FULFILLMENT_COST_AUTHORITY),
      floor: economicFloor }),
    pricing: Object.freeze({ range: priceRange, recommendedPrice,
      priceAuthorized,
      finalAuthorizedPrice: priceAuthorized
        ? finalAuthorizedPrice : null,
      authorizationBlockers: Array.isArray(result.PRICE_AUTHORIZATION_BLOCKERS)
        ? result.PRICE_AUTHORIZATION_BLOCKERS.filter((entry): entry is string =>
          typeof entry === "string").slice(0, 12) : [],
      fallbackPrice: decision.tone === "APPROVE" ? minimumMarginSafePrice : null,
      minimumMarginSafePrice,
      rationale: recommendedPrice !== null
        ? "Objetivo preliminar: combina evidencia de mercado con un piso económico estimado; no es un precio final autorizado."
        : "No se propone precio porque mercado y piso económico no sostienen todavía una recomendación segura.",
      evidenceQuality: pricingEvidenceQuality }),
    listingStrategy: Object.freeze({
      recommendedTitle: text(listingPackage.title) ?? safeListingTitle(safeClaims),
      category: text(listingPackage.categoryId),
      itemSpecifics: safeClaims.filter((claim) =>
        claim.kind !== "PRODUCT_IDENTITY" && claim.kind !== "MODEL"),
      safeClaims: safeClaimValues,
      claimsToAvoid: doNotUseClaims.map((claim) => text(claim.value))
        .filter((value): value is string => Boolean(value)),
      shipping: shipping !== null
        ? `Usar como referencia el shipping qty=1 verificado de $${shipping.toFixed(2)}; validar nuevamente si pierde frescura.`
        : "No asumir envío gratis ni shipping cero hasta verificar qty=1.",
      positioning: "Describir primero la identidad y los diferenciadores confirmados; omitir cualquier claim no verificado.",
    }),
    visualStrategy: Object.freeze({
      hero: "Mostrar claramente el producto exacto sobre fondo limpio, sin añadir accesorios o funciones no verificadas.",
      secondaryThemes: safeClaimValues.filter((_, index) => index > 0),
      informationGraphics: safeClaimValues.filter((value) =>
        /speaker|microphone|usb|1080|720|2k|4k/i.test(value)),
      avoid: doNotUseClaims.map((claim) => text(claim.value))
        .filter((value): value is string => Boolean(value)),
    }),
    risks: riskStatements,
    recommendation: decision.explanation,
    provenance: Object.freeze({
      product: productEvidence.source ? "FRESH_QUERY" : null,
      market: exactQuery || functionalQuery ? "FRESH_QUERY" : null,
      shipping: shippingEvidence.reusedDurableEvidence === true
        ? "DURABLE_REUSE" : null,
      durableSoldCount: lists.accepted.filter((item) =>
        item.soldHistorySource === "CONFIRMED_DURABLE_SOLD").length,
    }),
    technical: Object.freeze({ traceId: trace?.trace_id ?? null,
      gtin, mpn: text(productTruth.mpn), model,
      rawDecisionCode: text(result.FINAL_DECISION),
      thresholds: technicalThresholds, marketSearches,
      rawKeywordEvidence: record(result.RAW_KEYWORD_EVIDENCE),
      nearExactSoldEnrichment: record(result.NEAR_EXACT_SOLD_ENRICHMENT) }),
    decisionLoop,
  })

  return Object.freeze({ trace, events, result, steps, progress,
    currentStage: steps[currentIndex]?.label ?? "Preparando análisis",
    decision, marketFunnel: dossier.market, product: dossier.product,
    productTruth: dossier.productTruth, economics: dossier.economics,
    pricing: dossier.pricing, keywords: dossier.keywords,
    dossier, accepted: lists.accepted, excluded: lists.excluded })
}
