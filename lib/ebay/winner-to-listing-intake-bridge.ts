type ListingIntakeInput = {
  pipelineId?: string | null
  productId?: string | null
  productSlug?: string | null
  winnerScore?: string | null
  pipelineDecision?: string | null
  profitStatus?: string | null
  riskStatus?: string | null
}

function normalizeContextValue(value?: string | null) {
  if (typeof value !== "string") {
    return null
  }

  const trimmed =
    value.trim()

  return trimmed.length > 0
    ? trimmed
    : null
}

function appendQueryParam(
  params: string[],
  key: string,
  value?: string | null
) {
  const normalizedValue =
    normalizeContextValue(value)

  if (!normalizedValue) {
    return
  }

  params.push(
    `${encodeURIComponent(key)}=${encodeURIComponent(normalizedValue)}`
  )
}

export function buildListingIntakeUrl(input: ListingIntakeInput = {}) {
  const params = [
    "source=pipeline",
  ]

  appendQueryParam(
    params,
    "pipelineId",
    input.pipelineId
  )
  appendQueryParam(
    params,
    "productId",
    input.productId
  )
  appendQueryParam(
    params,
    "productSlug",
    input.productSlug
  )
  appendQueryParam(
    params,
    "winnerScore",
    input.winnerScore
  )
  appendQueryParam(
    params,
    "pipelineDecision",
    input.pipelineDecision
  )
  appendQueryParam(
    params,
    "profitStatus",
    input.profitStatus
  )
  appendQueryParam(
    params,
    "riskStatus",
    input.riskStatus
  )

  return `/admin/ebay-listing-package?${params.join("&")}`
}

export function getPipelineCommercialSignalByReference() {
  return {
    signalMode:
      "PIPELINE_DECISION_BY_REFERENCE",
    source:
      "eBay Winner Pipeline",
    listingUsesPipelineDecisionByReference:
      true,
    listingDuplicatesProfitabilityTruth:
      false,
    pipelineDecidesIfWorthSelling:
      true,
    listingRecalculatesProfitability:
      false,
    fieldsCarriedByReference: [
      "pipelineId",
      "productId",
      "productSlug",
      "winnerScore",
      "pipelineDecision",
      "profitStatus",
      "estimatedMargin",
      "estimatedProfit",
      "riskStatus",
      "missingPipelineData",
      "pipelineRecommendation",
    ],
  }
}

export function buildHumanFriendlyListingIntakeSummary(
  input: ListingIntakeInput = {}
) {
  return {
    humanFlowLabel:
      "From winning product to prepared listing",
    productContext:
      normalizeContextValue(input.productSlug) ||
      normalizeContextValue(input.productId) ||
      "Producto ganador pendiente",
    source:
      "eBay Winner Pipeline",
    pipelineDecision:
      normalizeContextValue(input.pipelineDecision) ||
      "Decision pendiente del Pipeline",
    profitStatus:
      normalizeContextValue(input.profitStatus) ||
      "Estado comercial pendiente del Pipeline",
    winnerScore:
      normalizeContextValue(input.winnerScore) ||
      "Score pendiente del Pipeline",
    riskStatus:
      normalizeContextValue(input.riskStatus) ||
      "Riesgo pendiente del Pipeline",
    referenceRule:
      "Listing uses Pipeline decision by reference. Listing does not duplicate profitability truth.",
  }
}

export function getHumanFriendlyEbayFlowSteps() {
  return [
    {
      step:
        1,
      label:
        "Buscar productos ganadores",
      description:
        "Encuentra oportunidades rentables antes de crear un listing.",
      status:
        "Pipeline decide si vale la pena vender.",
    },
    {
      step:
        2,
      label:
        "Confirmar producto",
      description:
        "Products confirma qué es el producto.",
      status:
        "Products must confirm.",
    },
    {
      step:
        3,
      label:
        "Preparar listing",
      description:
        "Listing prepara cómo se vende.",
      status:
        "Listing decides how the product sells on eBay.",
    },
    {
      step:
        4,
      label:
        "Revisar y aprobar",
      description:
        "Review aprueba si puede avanzar.",
      status:
        "Gates must approve.",
    },
    {
      step:
        5,
      label:
        "Preparar imágenes",
      description:
        "Usa imagen catálogo Luna Portex como fuente visual de verdad.",
      status:
        "Next phase.",
    },
    {
      step:
        6,
      label:
        "Conectar eBay",
      description:
        "OAuth, Sandbox, draft real y publicación.",
      status:
        "acciones eBay bloqueadas por seguridad",
    },
  ]
}

export function getWinnerToListingIntakeBridge() {
  return {
    bridgeVersion:
      "EBAY_WINNER_TO_LISTING_INTAKE_BRIDGE_V1",
    flowStatus:
      "WINNER_TO_LISTING_INTAKE_FLOW_READY",
    sourceStage:
      "EBAY_WINNER_PIPELINE",
    targetStage:
      "LISTING_PACKAGE",
    humanFlowLabel:
      "From winning product to prepared listing",
    pipelineDecisionRule:
      "Pipeline decides if the product is worth selling.",
    productsDecisionRule:
      "Products confirms what the product is.",
    listingDecisionRule:
      "Listing prepares how the product sells on eBay.",
    reviewDecisionRule:
      "Review approves whether the listing can advance.",
    intakeAction:
      "PREPARE_LISTING_PACKAGE",
    intakeMode:
      "READ_ONLY_CONTEXT_PASS_THROUGH",
    mutationImpact:
      "DO_NOT_MUTATE_PIPELINE_OR_PRODUCT",
    draftImpact:
      "DO_NOT_CREATE_EBAY_DRAFT",
    publicationImpact:
      "DO_NOT_PUBLISH",
    supportedContext: [
      "pipelineId",
      "productId",
      "productSlug",
      "winnerScore",
      "pipelineDecision",
      "profitStatus",
      "estimatedMargin",
      "estimatedProfit",
      "riskStatus",
      "missingPipelineData",
      "pipelineRecommendation",
      "source=pipeline",
    ],
    pipelineCommercialSignal:
      getPipelineCommercialSignalByReference(),
    businessRules: {
      pipelineRule:
        "Pipeline decides if the product is worth selling.",
      productsRule:
        "Products confirms what the product is.",
      listingRule:
        "Listing prepares how the product sells on eBay.",
      reviewRule:
        "Review and Gates approve whether the listing can advance.",
      profitabilityTruthRule:
        "Listing uses Pipeline decision by reference. Listing does not duplicate profitability truth.",
    },
    flowSteps:
      getHumanFriendlyEbayFlowSteps(),
    safetyFlags: {
      readOnly:
        true,
      listingUsesPipelineDecisionByReference:
        true,
      listingDuplicatesProfitabilityTruth:
        false,
      listingRecalculatesProfitability:
        false,
      pipelineMutationUsed:
        false,
      productMutationUsed:
        false,
      listingMutationUsed:
        false,
      ebayApiUsed:
        false,
      oauthUsed:
        false,
      tokensUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
    },
  }
}

export function getBlockedWinnerToListingIntakeResponse() {
  return {
    bridgeVersion:
      "EBAY_WINNER_TO_LISTING_INTAKE_BRIDGE_V1",
    flowStatus:
      "WINNER_TO_LISTING_INTAKE_FLOW_READY",
    intakeAction:
      "PREPARE_LISTING_PACKAGE",
    intakeMode:
      "READ_ONLY_CONTEXT_PASS_THROUGH",
    mutationImpact:
      "DO_NOT_MUTATE_PIPELINE_OR_PRODUCT",
    draftImpact:
      "DO_NOT_CREATE_EBAY_DRAFT",
    publicationImpact:
      "DO_NOT_PUBLISH",
    readOnly:
      true,
    canCreateEbayDraft:
      false,
    canPublishToEbay:
      false,
  }
}
