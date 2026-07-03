type SellerFlowScenarioInput = {
  stockStatus?: string | null
  stockConfirmed?: boolean | null
  profitStatus?: string | null
  riskStatus?: string | null
  pipelineDecision?: string | null
}

type SellerFlowScenarioResult = {
  primaryQueue: string
  listingAllowed: boolean
  onePrimaryQueue: true
  externalEbayActionsBlocked: true
  reason: string
}

const sellerFlowQueuePriority = [
  "Sin stock",
  "Proteger",
  "Revisar stock",
  "Margen",
  "Bloqueados",
  "Vender ahora",
  "Monitorear",
]

const sellerFlowSmokeTestScenarios = [
  {
    scenarioId:
      "kerasys_out_of_stock_confirmed",
    productName:
      "Kerasys",
    stockStatus:
      "out_of_stock",
    stockConfirmed:
      false,
    pipelineDecision:
      "do_not_sell_now",
    expectedPrimaryQueue:
      "Sin stock",
  },
  {
    scenarioId:
      "stock_confirmed_profitable_sell_now",
    productName:
      "Storage Organizer",
    stockStatus:
      "in_stock",
    stockConfirmed:
      true,
    profitStatus:
      "margin_ok",
    pipelineDecision:
      "candidate_for_listing",
    expectedPrimaryQueue:
      "Vender ahora",
  },
  {
    scenarioId:
      "unknown_stock_needs_review",
    productName:
      "Catalog Product Unknown Stock",
    stockStatus:
      "unknown",
    stockConfirmed:
      false,
    pipelineDecision:
      "needs_stock_review",
    expectedPrimaryQueue:
      "Revisar stock",
  },
  {
    scenarioId:
      "margin_missing_needs_margin_review",
    productName:
      "Margin Review Product",
    stockStatus:
      "in_stock",
    stockConfirmed:
      true,
    profitStatus:
      "missing_margin_data",
    pipelineDecision:
      "needs_margin_review",
    expectedPrimaryQueue:
      "Margen",
  },
  {
    scenarioId:
      "risk_blocked_product",
    productName:
      "Risk Blocked Product",
    riskStatus:
      "blocked",
    pipelineDecision:
      "blocked",
    expectedPrimaryQueue:
      "Bloqueados",
  },
  {
    scenarioId:
      "monitor_only_product",
    productName:
      "Monitor Only Product",
    stockStatus:
      "in_stock",
    stockConfirmed:
      true,
    profitStatus:
      "low_signal",
    pipelineDecision:
      "monitor",
    expectedPrimaryQueue:
      "Monitorear",
  },
]

function toScenarioInput(
  input: unknown
): SellerFlowScenarioInput {
  if (!input || typeof input !== "object") {
    return {}
  }

  return input as SellerFlowScenarioInput
}

export function getSellerFlowQueuePriority() {
  return sellerFlowQueuePriority
}

export function getSellerFlowSmokeTestScenarios() {
  return sellerFlowSmokeTestScenarios
}

export function evaluateSellerFlowScenario(
  input: unknown
): SellerFlowScenarioResult {
  const scenario =
    toScenarioInput(input)

  if (scenario.stockStatus === "out_of_stock") {
    return {
      primaryQueue:
        "Sin stock",
      listingAllowed:
        false,
      onePrimaryQueue:
        true,
      externalEbayActionsBlocked:
        true,
      reason:
        "Confirmed out_of_stock always wins over sell-now signals.",
    }
  }

  if (scenario.riskStatus === "listing_risk") {
    return {
      primaryQueue:
        "Proteger",
      listingAllowed:
        false,
      onePrimaryQueue:
        true,
      externalEbayActionsBlocked:
        true,
      reason:
        "Active listing risk must be protected before selling.",
    }
  }

  if (scenario.stockConfirmed !== true) {
    return {
      primaryQueue:
        "Revisar stock",
      listingAllowed:
        false,
      onePrimaryQueue:
        true,
      externalEbayActionsBlocked:
        true,
      reason:
        "Sell-now requires stock_confirmed.",
    }
  }

  if (scenario.profitStatus === "missing_margin_data") {
    return {
      primaryQueue:
        "Margen",
      listingAllowed:
        false,
      onePrimaryQueue:
        true,
      externalEbayActionsBlocked:
        true,
      reason:
        "Missing margin data blocks sell-now.",
    }
  }

  if (
    scenario.riskStatus === "blocked" ||
    scenario.pipelineDecision === "blocked"
  ) {
    return {
      primaryQueue:
        "Bloqueados",
      listingAllowed:
        false,
      onePrimaryQueue:
        true,
      externalEbayActionsBlocked:
        true,
      reason:
        "Risk or compliance blocker prevents advancement.",
    }
  }

  if (
    scenario.profitStatus === "margin_ok" &&
    scenario.pipelineDecision === "candidate_for_listing"
  ) {
    return {
      primaryQueue:
        "Vender ahora",
      listingAllowed:
        true,
      onePrimaryQueue:
        true,
      externalEbayActionsBlocked:
        true,
      reason:
        "Confirmed stock and Pipeline candidate allow internal listing preparation.",
    }
  }

  return {
    primaryQueue:
      "Monitorear",
    listingAllowed:
      false,
    onePrimaryQueue:
      true,
    externalEbayActionsBlocked:
      true,
    reason:
      "Default safe route is monitor-only.",
  }
}

export function getSellerFlowOperationalSmokeTest() {
  return {
    smokeTestVersion:
      "EBAY_SELLER_FLOW_OPERATIONAL_SMOKE_TEST_V1",
    smokeTestStatus:
      "SELLER_FLOW_OPERATIONAL_SMOKE_TEST_READY",
    flowMode:
      "INTERNAL_READ_ONLY_SMOKE_TEST",
    testedFlow:
      "Market Radar → eBay Pipeline → Products → Listing → Review/Gates",
    queuePriorityRule:
      sellerFlowQueuePriority.join(" → "),
    externalEbayStatus:
      "EBAY_EXTERNAL_ACTIONS_BLOCKED",
    scenarios:
      sellerFlowSmokeTestScenarios.map((scenario) => ({
        ...scenario,
        result:
          evaluateSellerFlowScenario(scenario),
      })),
    safetyFlags: {
      internalSmokeTestOnly:
        true,
      readOnly:
        true,
      pipelineDecisionByReference:
        true,
      listingDuplicatesProfitabilityTruth:
        false,
      ebayApiUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
      imageGenerationUsed:
        false,
      imageUploadUsed:
        false,
    },
  }
}

export function getBlockedSellerFlowSmokeTestResponse() {
  return {
    smokeTestStatus:
      "SELLER_FLOW_OPERATIONAL_SMOKE_TEST_BLOCKED",
    externalEbayStatus:
      "EBAY_EXTERNAL_ACTIONS_BLOCKED",
    draftImpact:
      "DO_NOT_CREATE_EBAY_DRAFT",
    publicationImpact:
      "DO_NOT_PUBLISH",
    blockingReason:
      "Smoke test is advisory and read-only. External eBay actions remain blocked.",
  }
}
