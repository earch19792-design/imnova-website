import type { MayelCommercialIntelligenceV1 } from
  "./ebay-mayel-commercial-intelligence-v1"

export const MAYEL_FULL_LISTING_COMMERCIAL_OPTIMIZATION_VERSION =
  "MAYEL_FULL_LISTING_COMMERCIAL_OPTIMIZATION_V1" as const

export type MayelListingOpportunityClassV1 =
  "VISUAL_OPPORTUNITY" | "CONTENT_OPPORTUNITY" |
  "KEYWORD_OPPORTUNITY" | "MARKET_REVALIDATION_REQUIRED" |
  "PRICE_OPPORTUNITY" | "PROMOTION_OPPORTUNITY" |
  "PERFORMANCE_PROBLEM" | "HEALTHY" | "INSUFFICIENT_EVIDENCE"

export type MayelListingOptimizationStatusV1 = "MEJORANDO" |
  "REVALIDANDO" | "LISTO_PARA_APLICAR" | "APLICADO" |
  "OBSERVANDO_RESULTADO" | "BLOQUEADO_POR_ECONOMIA" | "POR_COMPROBAR"

export type MayelVisualEligibilityV1 = "ELIGIBLE" | "BLOCKED_IDENTITY" |
  "BLOCKED_POLICY" | "BLOCKED_RIGHTS" | "BLOCKED_UNSAFE_EXECUTION"
export type MayelVisualPriorityV1 = "HIGH" | "MEDIUM" | "NORMAL"

type Guidance = Readonly<{ category: string; recommendation: string
  exactListingAssociation: boolean }>

type OptimizationInput = Readonly<{
  exactListingIdentity: boolean
  productTruthSupported: boolean
  currentLiveReadback: boolean
  attentionClass: "NEEDS_ATTENTION" | "CAN_IMPROVE" | "ENRICH" | "WAIT"
  metrics: Readonly<{ impressions: number | null; views: number | null
    ctrPercent: number | null; orders: number | null; unitsSold: number | null }>
  commercialIntelligence: MayelCommercialIntelligenceV1
  visualFindings: readonly unknown[]
  ebayGuidance: readonly Guidance[]
  durableVisualProposalPresent: boolean
  durableVisualChangeApplied: boolean
  highVisualPriority?: boolean
}>

function guidanceText(input: readonly Guidance[]) {
  return input.filter((row) => row.exactListingAssociation)
    .map((row) => `${row.category} ${row.recommendation}`.toUpperCase())
    .join(" ")
}

function pushUnique(
  values: MayelListingOpportunityClassV1[],
  value: MayelListingOpportunityClassV1,
) {
  if (!values.includes(value)) values.push(value)
}

function priorityScore(values: readonly MayelListingOpportunityClassV1[]) {
  const weights: Record<MayelListingOpportunityClassV1, number> = {
    PERFORMANCE_PROBLEM: 90,
    INSUFFICIENT_EVIDENCE: 80,
    MARKET_REVALIDATION_REQUIRED: 70,
    PRICE_OPPORTUNITY: 65,
    PROMOTION_OPPORTUNITY: 55,
    CONTENT_OPPORTUNITY: 50,
    KEYWORD_OPPORTUNITY: 45,
    VISUAL_OPPORTUNITY: 40,
    HEALTHY: 10,
  }
  return Math.max(...values.map((value) => weights[value]), 0)
}

export function buildMayelFullListingOptimizationStateV1(
  input: OptimizationInput,
) {
  const opportunities: MayelListingOpportunityClassV1[] = []
  const intelligence = input.commercialIntelligence
  const exactAuthority = input.exactListingIdentity &&
    input.currentLiveReadback
  if (!exactAuthority || !input.productTruthSupported) {
    pushUnique(opportunities, "INSUFFICIENT_EVIDENCE")
  }
  if (input.visualFindings.length > 0 ||
      input.durableVisualProposalPresent) {
    pushUnique(opportunities, "VISUAL_OPPORTUNITY")
  }
  const guidance = guidanceText(input.ebayGuidance)
  if (/TITLE|DESCRIPTION|ITEM.SPECIFIC|IDENTIFIER|LISTING.QUALITY/.test(
    guidance)) pushUnique(opportunities, "CONTENT_OPPORTUNITY")
  if (/TITLE|KEYWORD|SEARCH|ITEM.SPECIFIC/.test(guidance)) {
    pushUnique(opportunities, "KEYWORD_OPPORTUNITY")
  }
  if (intelligence.market.freshness !== "FRESH" ||
      intelligence.pricePosition.marketPriceAuthority === "UNPROVEN") {
    pushUnique(opportunities, "MARKET_REVALIDATION_REQUIRED")
  }
  if (intelligence.pricePosition.marketPriceAuthority ===
        "FRESH_CONFIRMED_SOLD_EVIDENCE" &&
      ["POR_ENCIMA_DEL_MERCADO", "POR_DEBAJO_DEL_MERCADO"].includes(
        intelligence.pricePosition.status)) {
    pushUnique(opportunities, "PRICE_OPPORTUNITY")
  }
  const officialPromotionRecommendation =
    intelligence.ebayRecommendations.officialListingQuality.some((row) =>
      /PROMOT/.test(`${row.type ?? ""} ${row.category ?? ""} ${
        row.exactPlatformWording ?? ""}`.toUpperCase()))
  if (officialPromotionRecommendation) {
    pushUnique(opportunities, "PROMOTION_OPPORTUNITY")
  }
  const performanceEvidencePresent = Object.values(input.metrics)
    .some((value) => value !== null)
  if (performanceEvidencePresent && input.attentionClass ===
      "NEEDS_ATTENTION") {
    pushUnique(opportunities, "PERFORMANCE_PROBLEM")
  }
  if (!opportunities.length) pushUnique(opportunities, "HEALTHY")

  const economicsProven = intelligence.economics.status === "AVAILABLE"
  const marketRevalidationRequired = opportunities.includes(
    "MARKET_REVALIDATION_REQUIRED")
  const commercialWriteOpportunity = opportunities.some((value) =>
    ["CONTENT_OPPORTUNITY", "KEYWORD_OPPORTUNITY", "PRICE_OPPORTUNITY",
      "PROMOTION_OPPORTUNITY"].includes(value))
  const status: MayelListingOptimizationStatusV1 =
    input.durableVisualChangeApplied ? "APLICADO" :
      opportunities.includes("INSUFFICIENT_EVIDENCE") ? "POR_COMPROBAR" :
      marketRevalidationRequired ? "REVALIDANDO" :
      opportunities.some((value) => ["PRICE_OPPORTUNITY",
        "PROMOTION_OPPORTUNITY"].includes(value)) && !economicsProven
        ? "BLOQUEADO_POR_ECONOMIA" :
        input.durableVisualProposalPresent || commercialWriteOpportunity
          ? "LISTO_PARA_APLICAR" :
          opportunities.includes("HEALTHY")
            ? "OBSERVANDO_RESULTADO" : "MEJORANDO"
  const whatSellerOsFound = opportunities.includes("HEALTHY")
    ? "No existe una oportunidad demostrada que justifique cambiar este listing."
    : opportunities.includes("INSUFFICIENT_EVIDENCE")
      ? "El listing está LIVE, pero falta autoridad suficiente para ejecutar cambios comerciales."
      : `Oportunidades demostradas: ${opportunities.join(", ")}.`
  const mayelChanged = input.durableVisualChangeApplied
    ? "Cambio visual aplicado y confirmado por readback oficial."
    : input.durableVisualProposalPresent
      ? "Existe una propuesta visual durable pendiente de las guardas de ejecución."
      : "Todavía no existe un cambio durable para este listing."
  const why = marketRevalidationRequired
    ? "La evidencia Sold debe estar fresca antes de decidir precio o atribuir el problema a la presentación."
    : intelligence.interpretation.explanation
  const expectedImpact = opportunities.includes("INSUFFICIENT_EVIDENCE")
    ? "Por comprobar; Seller OS no atribuye ni estima impacto sin evidencia."
    : opportunities.includes("HEALTHY")
      ? "Mantener y observar sin introducir variables innecesarias."
      : "Mejorar la presentación o competitividad sin debilitar Product Truth ni economía."
  return Object.freeze({
    contractVersion: MAYEL_FULL_LISTING_COMMERCIAL_OPTIMIZATION_VERSION,
    opportunities: Object.freeze(opportunities),
    priorityScore: priorityScore(opportunities), status,
    visualEligibility: (exactAuthority ? "ELIGIBLE" :
      "BLOCKED_IDENTITY") as MayelVisualEligibilityV1,
    visualPriority: (input.highVisualPriority ? "HIGH" :
      input.visualFindings.length > 0 ? "MEDIUM" :
        "NORMAL") as MayelVisualPriorityV1,
    evidenceMissingBlocksGeneralVisualWork: false as const,
    factClaimRestrictedWhenUnproven: !input.productTruthSupported,
    whatSellerOsFound, mayelChanged, why, expectedImpact,
    economicImpact: Object.freeze({
      status: intelligence.economics.status,
      expectedProfit: intelligence.economics.expectedProfit.value,
      marginPercent: intelligence.economics.marginPercent.value,
      roi: intelligence.economics.roi.value,
      unknownRenderedAsZero: false as const,
    }),
    supportedKeywordFields: Object.freeze([
      "TITLE", "ITEM_SPECIFICS", "DESCRIPTION",
    ] as const),
    fakeKeywordFieldAllowed: false as const,
    categoryRecommendationOnly: true as const,
    productTruthProtected: true as const,
    executionContract: Object.freeze({
      managementModelMustBeResolved: true as const,
      freshOfficialPrewriteReadbackRequired: true as const,
      authorizedDiffRequired: true as const,
      maxMarketplaceWritesPerExecution: 1 as const,
      officialPostwriteReadbackRequired: true as const,
      ambiguousWriteAutoRetry: false as const,
    }),
  })
}
