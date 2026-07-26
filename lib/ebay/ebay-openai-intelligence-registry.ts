export const EBAY_OPENAI_INTELLIGENCE_USE_CASE_IDS = [
  "DOSSIER_DISTILLATION",
  "COMPARABLE_CLASSIFICATION",
  "LISTING_GENERATION",
  "LISTING_REVIEW",
  "PERFORMANCE_DIAGNOSIS",
  "EXPERIMENT_ANALYSIS",
  "QUARANTINE_TRIAGE",
  "DAILY_EXECUTIVE_SUMMARY",
  "IMAGE_GENERATION",
  "SEMANTIC_EMBEDDING",
] as const

export type EbayOpenAiIntelligenceUseCaseId =
  typeof EBAY_OPENAI_INTELLIGENCE_USE_CASE_IDS[number]

export type EbayOpenAiModelTier =
  | "ECONOMY"
  | "BALANCED"
  | "ADVANCED"
  | "IMAGE"
  | "EMBEDDING"

export type EbayOpenAiUseCaseDefinition = {
  id: EbayOpenAiIntelligenceUseCaseId
  version: string
  purpose: string
  currentCapability: string
  currentEndToEndState:
    | "OPERATIONAL_PREVIEW"
    | "MANUAL_ONLY"
    | "DESIGNED_NOT_CONNECTED"
    | "NOT_IMPLEMENTED"
  inputSchemaVersion: string
  outputSchemaVersion: string
  promptVersion: string
  allowedInputRoots: readonly string[]
  prohibitedInputKinds: readonly string[]
  allowedProposalFields: readonly string[]
  modelTier: EbayOpenAiModelTier
  maximumOutputTokens: number
  timeoutMs: number
  maximumRetries: number
  fallback:
    | "DETERMINISTIC"
    | "WAITING_OPENAI_RETRY"
    | "HUMAN_EXCEPTION"
  risk: "LOW" | "MEDIUM" | "HIGH"
  approvalRequired: boolean
  retention: "HASHES_AND_SANITIZED_RESULT_ONLY"
  shadowRequired: boolean
  newCallsEnabled: false
  qualityMetrics: readonly string[]
  evalSuite: string
  outputSchema: Record<string, unknown>
}

export const EBAY_OPENAI_PROHIBITED_ACTIONS = [
  "PUBLISH_EBAY_LISTING",
  "CHANGE_PRICE",
  "CHANGE_STOCK",
  "CREATE_PROMOTION",
  "SEND_OFFER",
  "CONFIRM_IDENTITY",
  "AUTHORIZE_CLAIM",
  "MODIFY_HARD_GATE",
  "MODIFY_BUDGET",
  "MODIFY_PROMPT",
  "MODIFY_CODE",
  "DEPLOY",
  "APPLY_MIGRATION",
] as const

const evidenceRefsSchema = {
  type: "array",
  items: { type: "string", minLength: 1, maxLength: 160 },
  maxItems: 40,
} as const

export const EBAY_OPENAI_COMMERCIAL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "result",
    "confidence",
    "evidenceUsed",
    "evidenceMissing",
    "hypotheses",
    "risks",
    "recommendedAction",
    "prohibitedActions",
    "humanReviewRequired",
    "promptVersion",
    "schemaVersion",
  ],
  properties: {
    result: {
      type: "object",
      additionalProperties: false,
      required: [
        "status",
        "summary",
        "classifications",
        "candidateClaims",
        "blockedClaims",
        "listingProposals",
        "experimentProposal",
      ],
      properties: {
        status: {
          type: "string",
          enum: [
            "SUCCEEDED",
            "INSUFFICIENT_EVIDENCE",
            "REQUIRES_HUMAN_REVIEW",
          ],
        },
        summary: { type: "string", minLength: 1, maxLength: 1800 },
        classifications: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["subjectRef", "label", "reason", "evidenceRefs"],
            properties: {
              subjectRef: { type: "string", minLength: 1, maxLength: 160 },
              label: { type: "string", minLength: 1, maxLength: 80 },
              reason: { type: "string", minLength: 1, maxLength: 800 },
              evidenceRefs: evidenceRefsSchema,
            },
          },
        },
        candidateClaims: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "evidenceRefs"],
            properties: {
              text: { type: "string", minLength: 1, maxLength: 500 },
              evidenceRefs: evidenceRefsSchema,
            },
          },
        },
        blockedClaims: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "reason"],
            properties: {
              text: { type: "string", minLength: 1, maxLength: 500 },
              reason: { type: "string", minLength: 1, maxLength: 500 },
            },
          },
        },
        listingProposals: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["field", "value", "reason", "evidenceRefs"],
            properties: {
              field: { type: "string", minLength: 1, maxLength: 80 },
              value: { type: "string", minLength: 1, maxLength: 3000 },
              reason: { type: "string", minLength: 1, maxLength: 800 },
              evidenceRefs: evidenceRefsSchema,
            },
          },
        },
        experimentProposal: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: [
                "variable",
                "hypothesis",
                "primaryKpi",
                "guardrails",
                "rollback",
                "evidenceRefs",
              ],
              properties: {
                variable: { type: "string", minLength: 1, maxLength: 100 },
                hypothesis: { type: "string", minLength: 1, maxLength: 800 },
                primaryKpi: { type: "string", minLength: 1, maxLength: 120 },
                guardrails: {
                  type: "array",
                  items: { type: "string", minLength: 1, maxLength: 300 },
                  maxItems: 20,
                },
                rollback: { type: "string", minLength: 1, maxLength: 800 },
                evidenceRefs: evidenceRefsSchema,
              },
            },
          ],
        },
      },
    },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    evidenceUsed: evidenceRefsSchema,
    evidenceMissing: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 300 },
      maxItems: 40,
    },
    hypotheses: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 600 },
      maxItems: 30,
    },
    risks: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 500 },
      maxItems: 30,
    },
    recommendedAction: {
      type: "string",
      enum: [
        "OBSERVE",
        "INVESTIGATE",
        "DRAFT_FOR_HUMAN_REVIEW",
        "WAIT",
        "REVERT_OR_STOP",
        "NO_ACTION",
      ],
    },
    prohibitedActions: {
      type: "array",
      items: {
        type: "string",
        enum: EBAY_OPENAI_PROHIBITED_ACTIONS,
      },
      minItems: EBAY_OPENAI_PROHIBITED_ACTIONS.length,
      maxItems: EBAY_OPENAI_PROHIBITED_ACTIONS.length,
    },
    humanReviewRequired: { type: "boolean" },
    promptVersion: { type: "string", minLength: 1, maxLength: 80 },
    schemaVersion: { type: "string", minLength: 1, maxLength: 80 },
  },
} satisfies Record<string, unknown>

const commonAllowedRoots = [
  "productRef",
  "dossierHash",
  "facts",
  "evidence",
] as const

const commonProhibitedKinds = [
  "SECRETS",
  "EBAY_TOKENS",
  "BUYER_PII",
  "FULL_ADDRESSES",
  "PRIVATE_URLS",
  "FULL_COMPETITOR_CONTENT",
  "COMPETITOR_IMAGES",
] as const

const listingProposalFields = [
  "title",
  "keywords",
  "itemSpecifics",
  "description",
  "faq",
  "differentiation",
  "pricePresentation",
  "visualBriefs",
] as const

function definition(
  input: Omit<EbayOpenAiUseCaseDefinition,
    | "version"
    | "inputSchemaVersion"
    | "outputSchemaVersion"
    | "promptVersion"
    | "prohibitedInputKinds"
    | "retention"
    | "shadowRequired"
    | "newCallsEnabled"
    | "outputSchema"
  >,
): EbayOpenAiUseCaseDefinition {
  return {
    ...input,
    version: "OPENAI_INTELLIGENCE_V1",
    inputSchemaVersion: "OPENAI_INTELLIGENCE_INPUT_V1",
    outputSchemaVersion: "OPENAI_INTELLIGENCE_OUTPUT_V1",
    promptVersion: `${input.id}_PROMPT_V1`,
    prohibitedInputKinds: commonProhibitedKinds,
    retention: "HASHES_AND_SANITIZED_RESULT_ONLY",
    shadowRequired: true,
    newCallsEnabled: false,
    outputSchema: EBAY_OPENAI_COMMERCIAL_OUTPUT_SCHEMA,
  }
}

export const EBAY_OPENAI_INTELLIGENCE_USE_CASES =
  EBAY_OPENAI_INTELLIGENCE_USE_CASE_IDS.map((id) => {
    const shared = {
      id,
      allowedInputRoots: commonAllowedRoots,
      allowedProposalFields: [] as readonly string[],
      maximumOutputTokens: 1800,
      timeoutMs: 25_000,
      maximumRetries: 1,
      approvalRequired: false,
    }
    if (id === "DOSSIER_DISTILLATION") return definition({
      ...shared,
      purpose: "Separar hechos, inferencias, contradicciones y faltantes sin modificar el expediente.",
      currentCapability: "La destilacion existente es determinista y alimenta Listing Factory V2.",
      currentEndToEndState: "DESIGNED_NOT_CONNECTED",
      modelTier: "ECONOMY",
      fallback: "DETERMINISTIC",
      risk: "LOW",
      qualityMetrics: ["schema_pass", "evidence_reference_pass", "compression_ratio"],
      evalSuite: "DOSSIER_DISTILLATION_EVAL_V1",
    })
    if (id === "COMPARABLE_CLASSIFICATION") return definition({
      ...shared,
      purpose: "Clasificar candidatos semanticos sin reemplazar las reglas de identidad exacta.",
      currentCapability: "Solo existen comparadores deterministas.",
      currentEndToEndState: "NOT_IMPLEMENTED",
      modelTier: "ECONOMY",
      fallback: "DETERMINISTIC",
      risk: "MEDIUM",
      qualityMetrics: ["false_exact_comparable_rate", "evidence_reference_pass"],
      evalSuite: "COMPARABLE_CLASSIFICATION_EVAL_V1",
    })
    if (id === "LISTING_GENERATION") return definition({
      ...shared,
      allowedInputRoots: [...commonAllowedRoots, "economicsGuardrails"],
      allowedProposalFields: listingProposalFields,
      purpose: "Proponer copy y estructura de listing con trazabilidad y validacion determinista posterior.",
      currentCapability: "V1 y V2 llaman Responses manualmente; V2 no tiene consumidor posterior.",
      currentEndToEndState: "MANUAL_ONLY",
      modelTier: "BALANCED",
      maximumOutputTokens: 6000,
      fallback: "HUMAN_EXCEPTION",
      risk: "HIGH",
      approvalRequired: true,
      qualityMetrics: ["unsupported_claim_rate", "attribute_invention_rate", "listing_utility"],
      evalSuite: "LISTING_GENERATION_EVAL_V1",
    })
    if (id === "LISTING_REVIEW") return definition({
      ...shared,
      allowedInputRoots: [...commonAllowedRoots, "candidateListing", "economicsGuardrails"],
      purpose: "Revisar independientemente un listing candidato y bloquear claims o atributos sin evidencia.",
      currentCapability: "El review model V2 esta configurado pero no se invoca.",
      currentEndToEndState: "DESIGNED_NOT_CONNECTED",
      modelTier: "BALANCED",
      fallback: "HUMAN_EXCEPTION",
      risk: "HIGH",
      approvalRequired: true,
      qualityMetrics: ["unsupported_claim_recall", "identity_contradiction_recall"],
      evalSuite: "LISTING_REVIEW_EVAL_V1",
    })
    if (id === "PERFORMANCE_DIAGNOSIS") return definition({
      ...shared,
      allowedInputRoots: [...commonAllowedRoots, "metrics", "economicsGuardrails"],
      purpose: "Proponer un experimento para listings activos usando solo metricas verificadas.",
      currentCapability: "Strategic Advisor llega a cola, pero no existe worker consumidor.",
      currentEndToEndState: "DESIGNED_NOT_CONNECTED",
      modelTier: "BALANCED",
      fallback: "DETERMINISTIC",
      risk: "MEDIUM",
      approvalRequired: true,
      qualityMetrics: ["recommendation_utility", "guardrail_pass", "causality_overclaim_rate"],
      evalSuite: "PERFORMANCE_DIAGNOSIS_EVAL_V1",
    })
    if (id === "EXPERIMENT_ANALYSIS") return definition({
      ...shared,
      allowedInputRoots: [...commonAllowedRoots, "experiment", "metrics"],
      purpose: "Interpretar un experimento sin afirmar causalidad cuando la muestra es insuficiente.",
      currentCapability: "No existe analista OpenAI conectado.",
      currentEndToEndState: "NOT_IMPLEMENTED",
      modelTier: "BALANCED",
      fallback: "DETERMINISTIC",
      risk: "MEDIUM",
      qualityMetrics: ["sample_sufficiency_accuracy", "causality_overclaim_rate"],
      evalSuite: "EXPERIMENT_ANALYSIS_EVAL_V1",
    })
    if (id === "QUARANTINE_TRIAGE") return definition({
      ...shared,
      allowedInputRoots: [...commonAllowedRoots, "errorEnvelope"],
      purpose: "Agrupar errores sanitizados y proponer playbooks sin ejecutar replays ni cambiar codigo.",
      currentCapability: "La cuarentena existe, pero no tiene clasificador OpenAI.",
      currentEndToEndState: "NOT_IMPLEMENTED",
      modelTier: "ECONOMY",
      fallback: "HUMAN_EXCEPTION",
      risk: "MEDIUM",
      approvalRequired: true,
      qualityMetrics: ["fingerprint_precision", "playbook_utility"],
      evalSuite: "QUARANTINE_TRIAGE_EVAL_V1",
    })
    if (id === "DAILY_EXECUTIVE_SUMMARY") return definition({
      ...shared,
      allowedInputRoots: ["dossierHash", "facts", "evidence", "metrics"],
      purpose: "Agrupar actividad operativa sin enviar notificaciones ni duplicar incidentes.",
      currentCapability: "El digest comercial es determinista.",
      currentEndToEndState: "NOT_IMPLEMENTED",
      modelTier: "ECONOMY",
      fallback: "DETERMINISTIC",
      risk: "LOW",
      qualityMetrics: ["factuality", "incident_deduplication", "summary_utility"],
      evalSuite: "DAILY_EXECUTIVE_SUMMARY_EVAL_V1",
    })
    if (id === "IMAGE_GENERATION") return definition({
      ...shared,
      allowedInputRoots: ["productRef", "dossierHash", "facts", "evidence", "visualBrief"],
      purpose: "Registrar la capacidad visual existente bajo controles comunes sin alterar su runtime durable.",
      currentCapability: "Images API opera en Preview con aprobacion y composicion determinista.",
      currentEndToEndState: "OPERATIONAL_PREVIEW",
      modelTier: "IMAGE",
      maximumOutputTokens: 1,
      timeoutMs: 230_000,
      fallback: "WAITING_OPENAI_RETRY",
      risk: "HIGH",
      approvalRequired: true,
      qualityMetrics: ["identity_fidelity", "visual_qa_pass", "human_acceptance"],
      evalSuite: "IMAGE_GENERATION_EVAL_V1",
    })
    return definition({
      ...shared,
      allowedInputRoots: ["productRef", "dossierHash", "facts", "evidence", "historicalLearning"],
      purpose: "Recuperar referencias historicas; nunca reemplazar relaciones, constraints o identidad.",
      currentCapability: "No hay embeddings ni pgvector implementados.",
      currentEndToEndState: "NOT_IMPLEMENTED",
      modelTier: "EMBEDDING",
      maximumOutputTokens: 1,
      fallback: "DETERMINISTIC",
      risk: "LOW",
      qualityMetrics: ["retrieval_precision", "retrieval_recall", "commercial_utility"],
      evalSuite: "SEMANTIC_EMBEDDING_EVAL_V1",
    })
  })

export function getEbayOpenAiUseCaseDefinition(
  id: EbayOpenAiIntelligenceUseCaseId,
) {
  const result = EBAY_OPENAI_INTELLIGENCE_USE_CASES.find(
    (entry) => entry.id === id,
  )
  if (!result) throw new Error("OPENAI_INTELLIGENCE_USE_CASE_UNKNOWN")
  return result
}

export function getEbayOpenAiIntelligenceRegistryProjection() {
  return {
    version: "OPENAI_INTELLIGENCE_REGISTRY_V1",
    useCases: EBAY_OPENAI_INTELLIGENCE_USE_CASES.map((entry) => ({
      id: entry.id,
      version: entry.version,
      purpose: entry.purpose,
      currentCapability: entry.currentCapability,
      currentEndToEndState: entry.currentEndToEndState,
      modelTier: entry.modelTier,
      risk: entry.risk,
      shadowRequired: entry.shadowRequired,
      newCallsEnabled: entry.newCallsEnabled,
      promptVersion: entry.promptVersion,
      schemaVersion: entry.outputSchemaVersion,
      budgetConfiguredInDatabase: true,
      killSwitchIndependent: true,
      evalSuite: entry.evalSuite,
      qualityMetrics: entry.qualityMetrics,
    })),
    authority: {
      openAiIsSourceOfTruth: false,
      externalEffectsAllowed: false,
      ebayWritesAllowed: false,
      criticalStateMutationsAllowed: false,
    },
  }
}
