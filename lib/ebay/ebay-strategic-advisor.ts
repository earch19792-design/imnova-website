import { createHash } from "node:crypto"

import { z } from "zod"

export const EBAY_STRATEGIC_ADVISOR_CONTRACT_VERSION =
  "SELLER_OS_STRATEGIC_ADVISOR_V1"
export const EBAY_STRATEGIC_ADVISOR_PROMPT_VERSION =
  "SELLER_OS_STRATEGIC_ADVISOR_PROMPT_V1"
export const EBAY_STRATEGIC_ADVISOR_OUTPUT_SCHEMA_VERSION =
  "SELLER_OS_STRATEGIC_ADVISOR_OUTPUT_V1"

export const EBAY_STRATEGIC_ADVISOR_STATES = [
  "SIGNAL_DETECTED",
  "DETERMINISTIC_EVIDENCE_READY",
  "AWAITING_OPERATOR_APPROVAL_TO_CALL",
  "OPENAI_CALL_QUEUED",
  "PROPOSAL_READY",
  "AWAITING_IMPROVEMENT_APPROVAL",
  "APPROVED_FOR_MANUAL_EXPERIMENT",
  "REJECTED",
] as const

export type EbayStrategicAdvisorState =
  typeof EBAY_STRATEGIC_ADVISOR_STATES[number]

export const EBAY_STRATEGIC_ADVISOR_VARIABLES = [
  "CATEGORY",
  "MAIN_IMAGE",
  "TOTAL_OFFER_PRICE",
  "SHIPPING_OFFER",
  "LISTING_QUANTITY",
] as const

export type EbayStrategicAdvisorVariable =
  typeof EBAY_STRATEGIC_ADVISOR_VARIABLES[number]

export const EBAY_STRATEGIC_ADVISOR_FACT_KEYS = [
  "exactProductName",
  "brand",
  "manufacturer",
  "gtin",
  "upc",
  "ean",
  "mpn",
  "model",
  "variant",
  "scent",
  "flavor",
  "color",
  "formulation",
  "material",
  "unitCount",
  "unitCountType",
  "netContent",
  "netContentUnit",
  "condition",
  "offerPackCount",
  "unitsPerPack",
  "totalUnitCount",
  "totalNetContent",
  "packConfiguration",
  "categoryId",
  "conditionId",
  "currentTitle",
  "currentPrice",
  "minimumSafePrice",
  "targetPrice",
  "currentQuantity",
  "currentImageCount",
  "shippingCost",
  "handlingTimeDays",
] as const

export type EbayStrategicAdvisorFactKey =
  typeof EBAY_STRATEGIC_ADVISOR_FACT_KEYS[number]

export const EBAY_STRATEGIC_ADVISOR_PERFORMANCE_METRICS = [
  "impressions",
  "views",
  "clickThroughRate",
  "transactions",
  "conversionRate",
  "watchers",
  "confirmedUnitsSold",
  "netMarginPercent",
  "stockAvailable",
] as const

const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const safeTextSchema = z.string().trim().min(1).max(240).superRefine((value, context) => {
  if (
    /https?:\/\/|www\.|data:image|base64|<\/?[a-z][^>]*>|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\bcompetitor\b|\bcompetidor(?:a|es)?\b/i.test(value)
  ) {
    context.addIssue({ code: "custom", message: "STRATEGIC_ADVISOR_RAW_OR_PII_TEXT_FORBIDDEN" })
  }
})

const factValueSchema = z.union([
  safeTextSchema,
  z.number().finite(),
  z.boolean(),
])

export const strategicAdvisorVerifiedFactSchema = z.object({
  factKey: z.enum(EBAY_STRATEGIC_ADVISOR_FACT_KEYS),
  value: factValueSchema,
  unit: safeTextSchema.nullable(),
  verificationStatus: z.enum(["VERIFIED", "CORROBORATED", "DERIVED_VERIFIED"]),
  sourceAuthority: z.enum([
    "LUNA_EXACT_VARIANT",
    "MANUFACTURER_OFFICIAL",
    "OFFICIAL_LABEL",
    "EBAY_CATALOG",
    "EBAY_TAXONOMY",
    "FULFILLMENT_CONFIRMED",
    "PHYSICAL_MEASUREMENT",
    "OWN_LISTING_READONLY",
    "INTERNAL_LEDGER_VERIFIED",
  ]),
  evidenceHash: hashSchema,
}).strict()

const metricSchema = z.number().finite().nonnegative().nullable()

export const strategicAdvisorOwnPerformanceSchema = z.object({
  source: z.enum([
    "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
    "EBAY_ORDERS_READONLY",
    "EBAY_BROWSE_OWN_LISTING_READONLY",
    "SELLER_OS_INTERNAL_LEDGER",
  ]),
  completeness: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  observedAt: z.string().datetime(),
  impressions: metricSchema,
  views: metricSchema,
  clickThroughRate: metricSchema,
  transactions: metricSchema,
  conversionRate: metricSchema,
  watchers: metricSchema,
  confirmedUnitsSold: metricSchema,
  netMarginPercent: z.number().finite().nullable(),
  stockAvailable: metricSchema,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.windowEnd) < Date.parse(value.windowStart)) {
    context.addIssue({ code: "custom", message: "STRATEGIC_ADVISOR_PERFORMANCE_WINDOW_INVALID" })
  }
})

export const strategicAdvisorEvidenceSchema = z.object({
  contractVersion: z.literal(EBAY_STRATEGIC_ADVISOR_CONTRACT_VERSION),
  listingFingerprint: hashSchema,
  signal: z.object({
    eventType: z.enum([
      "LISTING_ZERO_VISIBILITY_REVIEW",
      "LISTING_IMPRESSIONS_NO_ENGAGEMENT_REVIEW",
      "LISTING_ENGAGEMENT_NO_CONVERSION_REVIEW",
      "LISTING_WATCHERS_NO_SALE_REVIEW",
      "LISTING_SALE_MARGIN_OR_STOCK_RISK",
    ]),
    classification: z.enum([
      "ZERO_VISIBILITY_AFTER_COMPLETE_WINDOW",
      "IMPRESSIONS_WITHOUT_ENGAGEMENT",
      "ENGAGEMENT_WITHOUT_CONVERSION",
      "WATCHERS_WITHOUT_SALE",
      "SALE_WITH_MARGIN_OR_STOCK_RISK",
    ]),
    authorizedVariable: z.enum(EBAY_STRATEGIC_ADVISOR_VARIABLES),
    detectedAt: z.string().datetime(),
    deterministicRulesetVersion: safeTextSchema,
  }).strict(),
  verifiedFacts: z.array(strategicAdvisorVerifiedFactSchema).min(1).max(60),
  ownListingPerformance: strategicAdvisorOwnPerformanceSchema,
}).strict().superRefine((value, context) => {
  const keys = value.verifiedFacts.map((fact) => fact.factKey)
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", message: "STRATEGIC_ADVISOR_DUPLICATE_FACT_KEY" })
  }
})

export type EbayStrategicAdvisorEvidence =
  z.infer<typeof strategicAdvisorEvidenceSchema>

const actionForVariable = {
  CATEGORY: "REVIEW_VERIFIED_CATEGORY_MAPPING",
  MAIN_IMAGE: "TEST_AUTHORIZED_MAIN_IMAGE_CLARITY",
  TOTAL_OFFER_PRICE: "REVIEW_INTERNAL_PRICE_POLICY",
  SHIPPING_OFFER: "TEST_VERIFIED_SHIPPING_PRESENTATION",
  LISTING_QUANTITY: "REVIEW_VERIFIED_STOCK_QUANTITY_POLICY",
} as const satisfies Record<EbayStrategicAdvisorVariable, string>

const actionSchema = z.enum([
  "REVIEW_VERIFIED_CATEGORY_MAPPING",
  "TEST_AUTHORIZED_MAIN_IMAGE_CLARITY",
  "REVIEW_INTERNAL_PRICE_POLICY",
  "TEST_VERIFIED_SHIPPING_PRESENTATION",
  "REVIEW_VERIFIED_STOCK_QUANTITY_POLICY",
  "DO_NOT_TEST",
])

export const strategicAdvisorOutputSchema = z.object({
  schemaVersion: z.literal(EBAY_STRATEGIC_ADVISOR_OUTPUT_SCHEMA_VERSION),
  authorizedVariable: z.enum(EBAY_STRATEGIC_ADVISOR_VARIABLES),
  recommendation: z.object({
    decision: z.enum(["TEST", "DO_NOT_TEST"]),
    actionCode: actionSchema,
    rationale: safeTextSchema,
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  }).strict(),
  evidenceReferences: z.object({
    verifiedFactKeys: z.array(z.enum(EBAY_STRATEGIC_ADVISOR_FACT_KEYS)).max(20),
    ownPerformanceMetrics: z.array(
      z.enum(EBAY_STRATEGIC_ADVISOR_PERFORMANCE_METRICS),
    ).min(1).max(9),
  }).strict(),
  experiment: z.object({
    changeCount: z.literal(1),
    measurementWindow: z.enum(["SEVEN_COMPLETE_DAYS", "FOURTEEN_COMPLETE_DAYS"]),
    primaryMetric: z.enum(EBAY_STRATEGIC_ADVISOR_PERFORMANCE_METRICS),
    successRule: z.enum([
      "IMPROVE_PRIMARY_WITHOUT_MARGIN_REGRESSION",
      "IMPROVE_PRIMARY_WITHOUT_CONVERSION_REGRESSION",
      "REDUCE_OPERATIONAL_RISK_WITHOUT_VISIBILITY_REGRESSION",
    ]),
    automaticExecutionAllowed: z.literal(false),
    manualOperatorActionRequired: z.literal(true),
  }).strict(),
  safety: z.object({
    verifiedFactsOnly: z.literal(true),
    ownListingPerformanceOnly: z.literal(true),
    competitorDataUsed: z.literal(false),
    causalConclusionAllowed: z.literal(false),
    automaticPriceChangeAllowed: z.literal(false),
    automaticListingChangeAllowed: z.literal(false),
    ebayWriteAllowed: z.literal(false),
    selfModificationAllowed: z.literal(false),
    secondOperatorApprovalRequired: z.literal(true),
  }).strict(),
}).strict()

export type EbayStrategicAdvisorProposal =
  z.infer<typeof strategicAdvisorOutputSchema>

export const strategicAdvisorOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion", "authorizedVariable", "recommendation",
    "evidenceReferences", "experiment", "safety",
  ],
  properties: {
    schemaVersion: { type: "string", const: EBAY_STRATEGIC_ADVISOR_OUTPUT_SCHEMA_VERSION },
    authorizedVariable: { type: "string", enum: EBAY_STRATEGIC_ADVISOR_VARIABLES },
    recommendation: {
      type: "object",
      additionalProperties: false,
      required: ["decision", "actionCode", "rationale", "confidence"],
      properties: {
        decision: { type: "string", enum: ["TEST", "DO_NOT_TEST"] },
        actionCode: {
          type: "string",
          enum: [
            "REVIEW_VERIFIED_CATEGORY_MAPPING",
            "TEST_AUTHORIZED_MAIN_IMAGE_CLARITY",
            "REVIEW_INTERNAL_PRICE_POLICY",
            "TEST_VERIFIED_SHIPPING_PRESENTATION",
            "REVIEW_VERIFIED_STOCK_QUANTITY_POLICY",
            "DO_NOT_TEST",
          ],
        },
        rationale: { type: "string", minLength: 1, maxLength: 240 },
        confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
      },
    },
    evidenceReferences: {
      type: "object",
      additionalProperties: false,
      required: ["verifiedFactKeys", "ownPerformanceMetrics"],
      properties: {
        verifiedFactKeys: {
          type: "array", maxItems: 20, uniqueItems: true,
          items: { type: "string", enum: EBAY_STRATEGIC_ADVISOR_FACT_KEYS },
        },
        ownPerformanceMetrics: {
          type: "array", minItems: 1, maxItems: 9, uniqueItems: true,
          items: { type: "string", enum: EBAY_STRATEGIC_ADVISOR_PERFORMANCE_METRICS },
        },
      },
    },
    experiment: {
      type: "object",
      additionalProperties: false,
      required: [
        "changeCount", "measurementWindow", "primaryMetric", "successRule",
        "automaticExecutionAllowed", "manualOperatorActionRequired",
      ],
      properties: {
        changeCount: { type: "integer", const: 1 },
        measurementWindow: {
          type: "string", enum: ["SEVEN_COMPLETE_DAYS", "FOURTEEN_COMPLETE_DAYS"],
        },
        primaryMetric: {
          type: "string", enum: EBAY_STRATEGIC_ADVISOR_PERFORMANCE_METRICS,
        },
        successRule: {
          type: "string",
          enum: [
            "IMPROVE_PRIMARY_WITHOUT_MARGIN_REGRESSION",
            "IMPROVE_PRIMARY_WITHOUT_CONVERSION_REGRESSION",
            "REDUCE_OPERATIONAL_RISK_WITHOUT_VISIBILITY_REGRESSION",
          ],
        },
        automaticExecutionAllowed: { type: "boolean", const: false },
        manualOperatorActionRequired: { type: "boolean", const: true },
      },
    },
    safety: {
      type: "object",
      additionalProperties: false,
      required: [
        "verifiedFactsOnly", "ownListingPerformanceOnly", "competitorDataUsed",
        "causalConclusionAllowed", "automaticPriceChangeAllowed",
        "automaticListingChangeAllowed", "ebayWriteAllowed",
        "selfModificationAllowed", "secondOperatorApprovalRequired",
      ],
      properties: {
        verifiedFactsOnly: { type: "boolean", const: true },
        ownListingPerformanceOnly: { type: "boolean", const: true },
        competitorDataUsed: { type: "boolean", const: false },
        causalConclusionAllowed: { type: "boolean", const: false },
        automaticPriceChangeAllowed: { type: "boolean", const: false },
        automaticListingChangeAllowed: { type: "boolean", const: false },
        ebayWriteAllowed: { type: "boolean", const: false },
        selfModificationAllowed: { type: "boolean", const: false },
        secondOperatorApprovalRequired: { type: "boolean", const: true },
      },
    },
  },
} as const

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function ebayStrategicAdvisorHash(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
}

export function prepareEbayStrategicAdvisorEvidence(value: unknown) {
  const parsed = strategicAdvisorEvidenceSchema.parse(value)
  const verifiedFacts = [...parsed.verifiedFacts]
    .sort((left, right) => left.factKey.localeCompare(right.factKey))
  const evidence: EbayStrategicAdvisorEvidence = { ...parsed, verifiedFacts }
  const evidenceHash = ebayStrategicAdvisorHash(evidence)
  const inputHash = ebayStrategicAdvisorHash({
    contractVersion: evidence.contractVersion,
    evidenceHash,
    promptVersion: EBAY_STRATEGIC_ADVISOR_PROMPT_VERSION,
  })
  return {
    evidence,
    evidenceHash,
    inputHash,
    deduplicationKey: ebayStrategicAdvisorHash({
      listingFingerprint: evidence.listingFingerprint,
      eventType: evidence.signal.eventType,
      evidenceHash,
    }),
  }
}

const allowedTransitions = new Map<EbayStrategicAdvisorState, Set<EbayStrategicAdvisorState>>([
  ["SIGNAL_DETECTED", new Set(["DETERMINISTIC_EVIDENCE_READY", "REJECTED"])],
  ["DETERMINISTIC_EVIDENCE_READY", new Set(["AWAITING_OPERATOR_APPROVAL_TO_CALL", "REJECTED"])],
  ["AWAITING_OPERATOR_APPROVAL_TO_CALL", new Set(["OPENAI_CALL_QUEUED", "REJECTED"])],
  ["OPENAI_CALL_QUEUED", new Set(["PROPOSAL_READY", "REJECTED"])],
  ["PROPOSAL_READY", new Set(["AWAITING_IMPROVEMENT_APPROVAL", "REJECTED"])],
  ["AWAITING_IMPROVEMENT_APPROVAL", new Set(["APPROVED_FOR_MANUAL_EXPERIMENT", "REJECTED"])],
  ["APPROVED_FOR_MANUAL_EXPERIMENT", new Set()],
  ["REJECTED", new Set()],
])

export function assertEbayStrategicAdvisorTransition(
  previousState: EbayStrategicAdvisorState,
  nextState: EbayStrategicAdvisorState,
) {
  if (!allowedTransitions.get(previousState)?.has(nextState)) {
    throw new Error("STRATEGIC_ADVISOR_STATE_TRANSITION_INVALID")
  }
}

export function validateEbayStrategicAdvisorProposal(
  value: unknown,
  evidence: EbayStrategicAdvisorEvidence,
) {
  const proposal = strategicAdvisorOutputSchema.parse(value)
  if (proposal.authorizedVariable !== evidence.signal.authorizedVariable) {
    throw new Error("STRATEGIC_ADVISOR_VARIABLE_CHANGED")
  }
  const expectedAction = actionForVariable[evidence.signal.authorizedVariable]
  if (
    proposal.recommendation.decision === "TEST" &&
    proposal.recommendation.actionCode !== expectedAction
  ) {
    throw new Error("STRATEGIC_ADVISOR_ACTION_OUTSIDE_AUTHORIZED_VARIABLE")
  }
  if (
    proposal.recommendation.decision === "DO_NOT_TEST" &&
    proposal.recommendation.actionCode !== "DO_NOT_TEST"
  ) {
    throw new Error("STRATEGIC_ADVISOR_DO_NOT_TEST_ACTION_INVALID")
  }
  const availableFactKeys = new Set(evidence.verifiedFacts.map((fact) => fact.factKey))
  if (proposal.evidenceReferences.verifiedFactKeys.some((key) => !availableFactKeys.has(key))) {
    throw new Error("STRATEGIC_ADVISOR_UNSUPPORTED_FACT_REFERENCE")
  }
  return proposal
}

export type EbayStrategicAdvisorBudget = {
  estimatedInputTokens: number
  maxInputTokens: number
  maxOutputTokens: number
  estimatedCallCostMicros: number
  maxCallCostMicros: number
  spentTodayMicros: number
  dailyBudgetMicros: number
}

export function evaluateEbayStrategicAdvisorBudget(budget: EbayStrategicAdvisorBudget) {
  const integers = Object.values(budget)
  if (integers.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error("STRATEGIC_ADVISOR_BUDGET_INVALID")
  }
  if (budget.estimatedCallCostMicros === 0) {
    throw new Error("STRATEGIC_ADVISOR_COST_ESTIMATE_REQUIRED")
  }
  if (budget.estimatedInputTokens > budget.maxInputTokens) {
    throw new Error("STRATEGIC_ADVISOR_INPUT_TOKEN_BUDGET_EXCEEDED")
  }
  if (budget.maxOutputTokens === 0) {
    throw new Error("STRATEGIC_ADVISOR_OUTPUT_TOKEN_BUDGET_REQUIRED")
  }
  if (budget.estimatedCallCostMicros > budget.maxCallCostMicros) {
    throw new Error("STRATEGIC_ADVISOR_CALL_COST_BUDGET_EXCEEDED")
  }
  if (budget.spentTodayMicros + budget.estimatedCallCostMicros > budget.dailyBudgetMicros) {
    throw new Error("STRATEGIC_ADVISOR_DAILY_BUDGET_EXCEEDED")
  }
  return { allowed: true as const, remainingAfterMicros:
    budget.dailyBudgetMicros - budget.spentTodayMicros - budget.estimatedCallCostMicros }
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

const STRATEGIC_ADVISOR_STAGING_REF = "vsfthqydfrdzulldbfbe"

export function getEbayStrategicAdvisorConfiguration(environment = process.env) {
  let detectedRef: string | null = null
  try {
    detectedRef = new URL(environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "")
      .hostname.split(".")[0] || null
  } catch {
    detectedRef = null
  }
  const preview = environment.VERCEL_ENV === "preview"
  const staging = detectedRef === STRATEGIC_ADVISOR_STAGING_REF
  const enabled = environment.EBAY_STRATEGIC_ADVISOR_OPENAI_ENABLED?.trim() === "true"
  const keyPresent = Boolean(environment.OPENAI_API_KEY?.trim())
  const modelPresent = Boolean(environment.EBAY_STRATEGIC_ADVISOR_MODEL?.trim())
  const maxInputTokens = boundedInteger(
    environment.EBAY_STRATEGIC_ADVISOR_MAX_INPUT_TOKENS, 3_000, 500, 8_000,
  )
  const maxOutputTokens = boundedInteger(
    environment.EBAY_STRATEGIC_ADVISOR_MAX_OUTPUT_TOKENS, 1_200, 200, 3_000,
  )
  const maxCallCostMicros = boundedInteger(
    environment.EBAY_STRATEGIC_ADVISOR_MAX_CALL_COST_MICROS, 0, 0, 10_000_000,
  )
  const dailyBudgetMicros = boundedInteger(
    environment.EBAY_STRATEGIC_ADVISOR_DAILY_BUDGET_MICROS, 0, 0, 100_000_000,
  )
  const estimatedCallCostMicros = boundedInteger(
    environment.EBAY_STRATEGIC_ADVISOR_ESTIMATED_CALL_COST_MICROS, 0, 0, 10_000_000,
  )
  const realReady = preview && staging && enabled && keyPresent && modelPresent &&
    maxCallCostMicros > 0 && dailyBudgetMicros > 0 && estimatedCallCostMicros > 0
  return {
    status: realReady ? "READY" as const : enabled ? "MISSING" as const : "DISABLED" as const,
    preview,
    staging,
    enabled,
    key: keyPresent ? "PRESENT" as const : "MISSING" as const,
    model: modelPresent ? "PRESENT" as const : "MISSING" as const,
    maxInputTokens,
    maxOutputTokens,
    maxCallCostMicros,
    dailyBudgetMicros,
    estimatedCallCostMicros,
    realReady,
    storeResponses: false as const,
    toolsEnabled: false as const,
    selfModificationAllowed: false as const,
    ebayWritesAllowed: false as const,
    secretsReturned: false as const,
  }
}

function buildPrompt() {
  return [
    "You are Seller OS Strategic Advisor for a seller-owned eBay listing.",
    "Use only the verified structured facts and seller-owned performance metrics provided.",
    "Never infer missing facts or use competitor content, prices, images, URLs, PII, or raw source data.",
    "Do not claim causality. Do not propose automatic repricing or any automatic eBay change.",
    "The deterministic engine already selected exactly one authorized experiment variable; never replace it.",
    "Return only the strict JSON schema. A second operator approval is mandatory before a manual experiment.",
    "Never suggest modifying code, prompts, models, policies, permissions, budgets, or this control plane.",
  ].join(" ")
}

export function buildEbayStrategicAdvisorResponsesRequest(input: {
  model: string
  evidence: EbayStrategicAdvisorEvidence
  maxOutputTokens: number
}) {
  const prepared = prepareEbayStrategicAdvisorEvidence(input.evidence)
  return {
    model: input.model,
    store: false as const,
    max_output_tokens: input.maxOutputTokens,
    tools: [] as const,
    input: [
      { role: "system" as const, content: buildPrompt() },
      { role: "user" as const, content: canonicalJson(prepared.evidence) },
    ],
    text: {
      format: {
        type: "json_schema" as const,
        name: "seller_os_strategic_advisor_v1",
        strict: true as const,
        schema: strategicAdvisorOutputJsonSchema,
      },
    },
  }
}

function extractOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text
  const output = Array.isArray(payload.output) ? payload.output : []
  for (const item of output) {
    if (!item || typeof item !== "object") continue
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as unknown[] : []
    for (const entry of content) {
      if (!entry || typeof entry !== "object") continue
      const record = entry as Record<string, unknown>
      if (record.type === "output_text" && typeof record.text === "string") return record.text
    }
  }
  return null
}

export type EbayStrategicAdvisorTransport = (request: {
  url: string
  apiKey: string
  body: ReturnType<typeof buildEbayStrategicAdvisorResponsesRequest>
}) => Promise<{ ok: boolean; status: number; json(): Promise<Record<string, unknown>> }>

const defaultTransport: EbayStrategicAdvisorTransport = async ({ url, apiKey, body }) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  })
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json() as Promise<Record<string, unknown>>,
  }
}

export async function invokeApprovedEbayStrategicAdvisor(input: {
  state: EbayStrategicAdvisorState
  spendApproval: {
    approved: boolean
    evidenceHash: string
    idempotencyKeyHash: string
  }
  evidence: EbayStrategicAdvisorEvidence
  spentTodayMicros: number
  environment?: NodeJS.ProcessEnv
  transport?: EbayStrategicAdvisorTransport
}) {
  const prepared = prepareEbayStrategicAdvisorEvidence(input.evidence)
  if (input.state !== "OPENAI_CALL_QUEUED") {
    throw new Error("STRATEGIC_ADVISOR_OPENAI_SPEND_APPROVAL_REQUIRED")
  }
  if (!input.spendApproval.approved || input.spendApproval.evidenceHash !== prepared.evidenceHash) {
    throw new Error("STRATEGIC_ADVISOR_OPENAI_SPEND_APPROVAL_MISMATCH")
  }
  hashSchema.parse(input.spendApproval.idempotencyKeyHash)
  const environment = input.environment ?? process.env
  const configuration = getEbayStrategicAdvisorConfiguration(environment)
  if (!configuration.realReady) throw new Error("STRATEGIC_ADVISOR_OPENAI_DISABLED")
  const estimatedInputTokens = Math.ceil(canonicalJson(prepared.evidence).length / 4) + 500
  evaluateEbayStrategicAdvisorBudget({
    estimatedInputTokens,
    maxInputTokens: configuration.maxInputTokens,
    maxOutputTokens: configuration.maxOutputTokens,
    estimatedCallCostMicros: configuration.estimatedCallCostMicros,
    maxCallCostMicros: configuration.maxCallCostMicros,
    spentTodayMicros: input.spentTodayMicros,
    dailyBudgetMicros: configuration.dailyBudgetMicros,
  })
  const model = environment.EBAY_STRATEGIC_ADVISOR_MODEL?.trim() ?? ""
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? ""
  const body = buildEbayStrategicAdvisorResponsesRequest({
    model, evidence: prepared.evidence, maxOutputTokens: configuration.maxOutputTokens,
  })
  const response = await (input.transport ?? defaultTransport)({
    url: "https://api.openai.com/v1/responses", apiKey, body,
  })
  if (!response.ok) throw new Error(`STRATEGIC_ADVISOR_OPENAI_HTTP_${response.status}`)
  const payload = await response.json()
  if (payload.status !== "completed") throw new Error("STRATEGIC_ADVISOR_OPENAI_INCOMPLETE")
  const outputText = extractOutputText(payload)
  if (!outputText) throw new Error("STRATEGIC_ADVISOR_OPENAI_OUTPUT_MISSING")
  let rawProposal: unknown
  try {
    rawProposal = JSON.parse(outputText)
  } catch {
    throw new Error("STRATEGIC_ADVISOR_OPENAI_OUTPUT_JSON_INVALID")
  }
  const proposal = validateEbayStrategicAdvisorProposal(rawProposal, prepared.evidence)
  const usage = payload.usage && typeof payload.usage === "object"
    ? payload.usage as Record<string, unknown> : {}
  return {
    proposal,
    outputHash: ebayStrategicAdvisorHash(proposal),
    responseIdHash: typeof payload.id === "string"
      ? ebayStrategicAdvisorHash(payload.id) : null,
    usage: {
      inputTokens: Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null,
      outputTokens: Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null,
    },
    safety: {
      store: false as const,
      competitorDataUsed: false as const,
      piiUsed: false as const,
      rawDataUsed: false as const,
      ebayWrites: 0 as const,
      automaticChangeAllowed: false as const,
      secondOperatorApprovalRequired: true as const,
    },
  }
}
