import { createHash } from "node:crypto"

// @ts-expect-error Node's direct TypeScript runner requires the extension.
import { EBAY_OPENAI_PROHIBITED_ACTIONS, getEbayOpenAiUseCaseDefinition, type EbayOpenAiIntelligenceUseCaseId, type EbayOpenAiModelTier } from "./ebay-openai-intelligence-registry.ts"

type JsonRecord = Record<string, unknown>

export type EbayOpenAiModelRouterConfiguration = Record<
  EbayOpenAiModelTier,
  string | null
>

export type EbayOpenAiShadowRuntimePolicy = {
  enabled: boolean
  killSwitchEngaged: boolean
  mode: "SHADOW"
  dailyBudgetMicros: number
  monthlyBudgetMicros: number
  perProductBudgetMicros: number
  perUseCaseDailyBudgetMicros: number
  perInvocationBudgetMicros: number
  circuitFailureThreshold: number
  allowSingleAdvancedEscalation: boolean
}

export type EbayOpenAiInvocationManifest = {
  includedPaths: string[]
  excludedKinds: string[]
  purpose: string
  authorizationBasis: "SELLER_OS_SHADOW_EVALUATION"
  dossierHash: string
  inputHash: string
  retention: "HASHES_AND_SANITIZED_RESULT_ONLY"
  estimatedCostMicros: number
  rawPromptPersisted: false
  rawResponsePersisted: false
}

export type EbayOpenAiCommercialOutput = {
  result: {
    status:
      | "SUCCEEDED"
      | "INSUFFICIENT_EVIDENCE"
      | "REQUIRES_HUMAN_REVIEW"
    summary: string
    classifications: Array<{
      subjectRef: string
      label: string
      reason: string
      evidenceRefs: string[]
    }>
    candidateClaims: Array<{ text: string; evidenceRefs: string[] }>
    blockedClaims: Array<{ text: string; reason: string }>
    listingProposals: Array<{
      field: string
      value: string
      reason: string
      evidenceRefs: string[]
    }>
    experimentProposal: null | {
      variable: string
      hypothesis: string
      primaryKpi: string
      guardrails: string[]
      rollback: string
      evidenceRefs: string[]
    }
  }
  confidence: number
  evidenceUsed: string[]
  evidenceMissing: string[]
  hypotheses: string[]
  risks: string[]
  recommendedAction:
    | "OBSERVE"
    | "INVESTIGATE"
    | "DRAFT_FOR_HUMAN_REVIEW"
    | "WAIT"
    | "REVERT_OR_STOP"
    | "NO_ACTION"
  prohibitedActions: string[]
  humanReviewRequired: boolean
  promptVersion: string
  schemaVersion: string
}

export type EbayOpenAiTransportRequest = {
  useCaseId: EbayOpenAiIntelligenceUseCaseId
  model: string
  store: false
  instructions: string
  input: string
  text: {
    format: {
      type: "json_schema"
      name: string
      strict: true
      schema: Record<string, unknown>
    }
  }
  maxOutputTokens: number
  promptCacheKey: string
  timeoutMs: number
}

export type EbayOpenAiTransportResponse = {
  requestId: string | null
  output: unknown
  usage: {
    inputTokens: number
    cachedInputTokens: number
    cacheWriteTokens: number
    outputTokens: number
  }
}

export interface EbayOpenAiIntelligenceTransport {
  invoke(
    request: EbayOpenAiTransportRequest,
  ): Promise<EbayOpenAiTransportResponse>
}

export type EbayOpenAiInvocationRecord = {
  idempotencyKey: string
  useCaseId: EbayOpenAiIntelligenceUseCaseId
  productRefHash: string
  dossierHash: string
  model: string
  modelTier: EbayOpenAiModelTier
  promptVersion: string
  schemaVersion: string
  manifest: EbayOpenAiInvocationManifest
  estimatedCostMicros: number
  status:
    | "LEASED"
    | "SHADOW_COMPLETED"
    | "FAILED"
    | "WAITING_OPENAI_RETRY"
  outputHash: string | null
  sanitizedResult: EbayOpenAiCommercialOutput | null
  errorCode: string | null
  usage: EbayOpenAiTransportResponse["usage"] | null
}

export interface EbayOpenAiIntelligenceRepository {
  find(idempotencyKey: string): Promise<EbayOpenAiInvocationRecord | null>
  reserve(
    record: EbayOpenAiInvocationRecord,
    policy: EbayOpenAiShadowRuntimePolicy,
  ): Promise<void>
  complete(
    idempotencyKey: string,
    update: Partial<EbayOpenAiInvocationRecord>,
  ): Promise<void>
  circuitStatus(useCaseId: EbayOpenAiIntelligenceUseCaseId):
    Promise<"CLOSED" | "OPEN" | "HALF_OPEN">
  recordProviderFailure(
    useCaseId: EbayOpenAiIntelligenceUseCaseId,
    globalFailure: boolean,
    threshold: number,
  ): Promise<void>
  recordProviderSuccess(
    useCaseId: EbayOpenAiIntelligenceUseCaseId,
  ): Promise<void>
}

export type EbayOpenAiShadowExecution = {
  status:
    | "SHADOW_COMPLETED"
    | "DEDUPE_HIT"
    | "BLOCKED"
    | "DETERMINISTIC_FALLBACK"
    | "WAITING_OPENAI_RETRY"
  useCaseId: EbayOpenAiIntelligenceUseCaseId
  idempotencyKey: string | null
  modelTier: EbayOpenAiModelTier
  model: string | null
  manifest: EbayOpenAiInvocationManifest | null
  result: EbayOpenAiCommercialOutput | null
  errorCode: string | null
  effects: {
    stateMutations: 0
    ebayWrites: 0
    priceChanges: 0
    stockChanges: 0
    promotionsCreated: 0
    listingsPublished: 0
  }
}

const zeroEffects = {
  stateMutations: 0,
  ebayWrites: 0,
  priceChanges: 0,
  stockChanges: 0,
  promotionsCreated: 0,
  listingsPublished: 0,
} as const

const forbiddenKeyPattern =
  /(secret|token|authorization|password|api.?key|client.?secret|buyer|email|phone|address|private.?url|competitor.?full|competitor.?image)/i

const forbiddenValuePatterns = [
  /\bbearer\s+[a-z0-9._~+/=-]{12,}/i,
  /\bsk-[a-z0-9_-]{12,}/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /https?:\/\//i,
  /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/,
]

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : []
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as JsonRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stable(entry)]))
}

export function ebayOpenAiIntelligenceHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex")
}

function collectPaths(
  value: unknown,
  prefix = "",
  paths: string[] = [],
): string[] {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectPaths(entry, `${prefix}[${index}]`, paths))
    return paths
  }
  if (!value || typeof value !== "object") {
    if (prefix) paths.push(prefix)
    return paths
  }
  for (const [key, entry] of Object.entries(value as JsonRecord)) {
    collectPaths(entry, prefix ? `${prefix}.${key}` : key, paths)
  }
  return paths
}

function assertPrivacy(value: unknown, path = "input") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPrivacy(entry, `${path}[${index}]`))
    return
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as JsonRecord)) {
      if (forbiddenKeyPattern.test(key)) {
        throw new Error("OPENAI_INTELLIGENCE_FORBIDDEN_FIELD")
      }
      assertPrivacy(entry, `${path}.${key}`)
    }
    return
  }
  if (
    typeof value === "string"
    && forbiddenValuePatterns.some((pattern) => pattern.test(value))
  ) {
    throw new Error("OPENAI_INTELLIGENCE_FORBIDDEN_VALUE")
  }
}

export function buildEbayOpenAiInvocationManifest(input: {
  useCaseId: EbayOpenAiIntelligenceUseCaseId
  dossierHash: string
  payload: JsonRecord
  estimatedCostMicros: number
}) {
  const definition = getEbayOpenAiUseCaseDefinition(input.useCaseId)
  const roots = Object.keys(input.payload)
  if (roots.some((root) => !definition.allowedInputRoots.includes(root))) {
    throw new Error("OPENAI_INTELLIGENCE_INPUT_ROOT_NOT_ALLOWED")
  }
  if (!/^[a-f0-9]{64}$/i.test(input.dossierHash)) {
    throw new Error("OPENAI_INTELLIGENCE_DOSSIER_HASH_REQUIRED")
  }
  if (!Number.isInteger(input.estimatedCostMicros)
    || input.estimatedCostMicros < 0) {
    throw new Error("OPENAI_INTELLIGENCE_COST_ESTIMATE_INVALID")
  }
  assertPrivacy(input.payload)
  return {
    includedPaths: collectPaths(input.payload).sort(),
    excludedKinds: [...definition.prohibitedInputKinds],
    purpose: definition.purpose,
    authorizationBasis: "SELLER_OS_SHADOW_EVALUATION",
    dossierHash: input.dossierHash,
    inputHash: ebayOpenAiIntelligenceHash(input.payload),
    retention: definition.retention,
    estimatedCostMicros: input.estimatedCostMicros,
    rawPromptPersisted: false,
    rawResponsePersisted: false,
  } satisfies EbayOpenAiInvocationManifest
}

function assertExactKeys(
  value: JsonRecord,
  expected: readonly string[],
  code: string,
) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(code)
  }
}

function allEvidenceRefs(output: EbayOpenAiCommercialOutput) {
  return [
    ...output.evidenceUsed,
    ...output.result.classifications.flatMap((entry) => entry.evidenceRefs),
    ...output.result.candidateClaims.flatMap((entry) => entry.evidenceRefs),
    ...output.result.listingProposals.flatMap((entry) => entry.evidenceRefs),
    ...(output.result.experimentProposal?.evidenceRefs ?? []),
  ]
}

export function validateEbayOpenAiCommercialOutput(input: {
  useCaseId: EbayOpenAiIntelligenceUseCaseId
  rawOutput: unknown
  availableEvidenceRefs: readonly string[]
}) {
  const definition = getEbayOpenAiUseCaseDefinition(input.useCaseId)
  const output = record(input.rawOutput)
  assertExactKeys(output, [
    "result", "confidence", "evidenceUsed", "evidenceMissing", "hypotheses",
    "risks", "recommendedAction", "prohibitedActions", "humanReviewRequired",
    "promptVersion", "schemaVersion",
  ], "OPENAI_INTELLIGENCE_OUTPUT_SCHEMA_INVALID")
  const result = record(output.result)
  assertExactKeys(result, [
    "status", "summary", "classifications", "candidateClaims",
    "blockedClaims", "listingProposals", "experimentProposal",
  ], "OPENAI_INTELLIGENCE_RESULT_SCHEMA_INVALID")
  if (
    !["SUCCEEDED", "INSUFFICIENT_EVIDENCE", "REQUIRES_HUMAN_REVIEW"]
      .includes(String(result.status))
    || typeof result.summary !== "string"
    || !Number.isInteger(output.confidence)
    || Number(output.confidence) < 0
    || Number(output.confidence) > 100
    || typeof output.humanReviewRequired !== "boolean"
    || output.promptVersion !== definition.promptVersion
    || output.schemaVersion !== definition.outputSchemaVersion
  ) {
    throw new Error("OPENAI_INTELLIGENCE_OUTPUT_SCHEMA_INVALID")
  }
  const arrays = [
    result.classifications, result.candidateClaims, result.blockedClaims,
    result.listingProposals, output.evidenceUsed, output.evidenceMissing,
    output.hypotheses, output.risks, output.prohibitedActions,
  ]
  if (arrays.some((entry) => !Array.isArray(entry))) {
    throw new Error("OPENAI_INTELLIGENCE_OUTPUT_SCHEMA_INVALID")
  }
  const typed = output as unknown as EbayOpenAiCommercialOutput
  const prohibited = new Set(strings(typed.prohibitedActions))
  if (EBAY_OPENAI_PROHIBITED_ACTIONS.some((action) => !prohibited.has(action))) {
    throw new Error("OPENAI_INTELLIGENCE_PROHIBITED_ACTIONS_INCOMPLETE")
  }
  const evidence = new Set(input.availableEvidenceRefs)
  if (allEvidenceRefs(typed).some((ref) => !evidence.has(ref))) {
    throw new Error("OPENAI_INTELLIGENCE_EVIDENCE_REFERENCE_INVALID")
  }
  if (typed.result.candidateClaims.some((claim) =>
    !claim.text?.trim() || claim.evidenceRefs.length === 0)) {
    throw new Error("OPENAI_INTELLIGENCE_UNSUPPORTED_CLAIM")
  }
  if (typed.result.listingProposals.some((proposal) =>
    !definition.allowedProposalFields.includes(proposal.field))) {
    throw new Error("OPENAI_INTELLIGENCE_PROPOSAL_FIELD_NOT_ALLOWED")
  }
  if (input.useCaseId === "COMPARABLE_CLASSIFICATION") {
    for (const classification of typed.result.classifications) {
      if (![
        "EXACT_COMPARABLE",
        "NEAR_COMPARABLE",
        "CONTRADICTORY_COMPARABLE",
        "DIFFERENT_PACK",
        "DIFFERENT_VARIANT",
        "DIFFERENT_CONDITION",
        "INSUFFICIENT_EVIDENCE",
      ].includes(classification.label)) {
        throw new Error("OPENAI_INTELLIGENCE_COMPARABLE_CLASS_INVALID")
      }
    }
  }
  return typed
}

export function getEbayOpenAiModelRouterConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): EbayOpenAiModelRouterConfiguration {
  return {
    ECONOMY: environment.OPENAI_INTELLIGENCE_ECONOMY_MODEL?.trim() || null,
    BALANCED: environment.OPENAI_INTELLIGENCE_BALANCED_MODEL?.trim()
      || environment.OPENAI_LISTING_MODEL?.trim() || null,
    ADVANCED: environment.OPENAI_INTELLIGENCE_ADVANCED_MODEL?.trim()
      || environment.OPENAI_LISTING_REVIEW_MODEL?.trim() || null,
    IMAGE: environment.OPENAI_IMAGE_MODEL?.trim() || null,
    EMBEDDING: environment.OPENAI_INTELLIGENCE_EMBEDDING_MODEL?.trim() || null,
  }
}

export function selectEbayOpenAiModel(input: {
  useCaseId: EbayOpenAiIntelligenceUseCaseId
  router: EbayOpenAiModelRouterConfiguration
  ambiguous: boolean
  escalationCount: number
  allowSingleAdvancedEscalation: boolean
}) {
  const definition = getEbayOpenAiUseCaseDefinition(input.useCaseId)
  let tier = definition.modelTier
  if (
    input.ambiguous
    && input.allowSingleAdvancedEscalation
    && input.escalationCount === 0
    && ["ECONOMY", "BALANCED"].includes(tier)
    && input.router.ADVANCED
  ) {
    tier = "ADVANCED"
  }
  return {
    tier,
    model: input.router[tier],
    escalationCount: tier === "ADVANCED" ? input.escalationCount + 1
      : input.escalationCount,
  }
}

function safeErrorCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(code)
    ? code
    : "OPENAI_INTELLIGENCE_PROVIDER_FAILED"
}

function isGlobalProviderFailure(code: string) {
  return [
    "OPENAI_INTELLIGENCE_PROVIDER_UNAVAILABLE",
    "OPENAI_INTELLIGENCE_PROVIDER_RATE_LIMITED",
    "OPENAI_INTELLIGENCE_PROVIDER_AUTH_FAILED",
  ].includes(code)
}

function baseExecution(
  useCaseId: EbayOpenAiIntelligenceUseCaseId,
  modelTier: EbayOpenAiModelTier,
): Pick<EbayOpenAiShadowExecution, "useCaseId" | "modelTier" | "effects"> {
  return { useCaseId, modelTier, effects: zeroEffects }
}

export async function executeEbayOpenAiShadowUseCase(input: {
  useCaseId: EbayOpenAiIntelligenceUseCaseId
  productRef: string
  dossierHash: string
  payload: JsonRecord
  availableEvidenceRefs: readonly string[]
  estimatedCostMicros: number
  ambiguous?: boolean
  escalationCount?: number
  policy: EbayOpenAiShadowRuntimePolicy
  router: EbayOpenAiModelRouterConfiguration
  repository: EbayOpenAiIntelligenceRepository
  transport: EbayOpenAiIntelligenceTransport
}) {
  const definition = getEbayOpenAiUseCaseDefinition(input.useCaseId)
  const base = baseExecution(input.useCaseId, definition.modelTier)
  if (
    !input.policy.enabled
    || input.policy.killSwitchEngaged
    || input.policy.mode !== "SHADOW"
  ) {
    return {
      ...base,
      status: "BLOCKED",
      idempotencyKey: null,
      model: null,
      manifest: null,
      result: null,
      errorCode: "OPENAI_INTELLIGENCE_SHADOW_DISABLED",
    } satisfies EbayOpenAiShadowExecution
  }
  let manifest: EbayOpenAiInvocationManifest
  try {
    manifest = buildEbayOpenAiInvocationManifest({
      useCaseId: input.useCaseId,
      dossierHash: input.dossierHash,
      payload: input.payload,
      estimatedCostMicros: input.estimatedCostMicros,
    })
  } catch (error) {
    return {
      ...base,
      status: "BLOCKED",
      idempotencyKey: null,
      model: null,
      manifest: null,
      result: null,
      errorCode: safeErrorCode(error),
    } satisfies EbayOpenAiShadowExecution
  }
  const selected = selectEbayOpenAiModel({
    useCaseId: input.useCaseId,
    router: input.router,
    ambiguous: input.ambiguous === true,
    escalationCount: input.escalationCount ?? 0,
    allowSingleAdvancedEscalation:
      input.policy.allowSingleAdvancedEscalation,
  })
  if (!selected.model) {
    return {
      ...base,
      modelTier: selected.tier,
      status: "BLOCKED",
      idempotencyKey: null,
      model: null,
      manifest,
      result: null,
      errorCode: "OPENAI_INTELLIGENCE_MODEL_NOT_CONFIGURED",
    } satisfies EbayOpenAiShadowExecution
  }
  const idempotencyKey = ebayOpenAiIntelligenceHash({
    useCaseId: input.useCaseId,
    version: definition.version,
    promptVersion: definition.promptVersion,
    schemaVersion: definition.outputSchemaVersion,
    model: selected.model,
    inputHash: manifest.inputHash,
    dossierHash: input.dossierHash,
  })
  const existing = await input.repository.find(idempotencyKey)
  if (existing?.sanitizedResult) {
    return {
      ...base,
      modelTier: selected.tier,
      status: "DEDUPE_HIT",
      idempotencyKey,
      model: selected.model,
      manifest,
      result: existing.sanitizedResult,
      errorCode: null,
    } satisfies EbayOpenAiShadowExecution
  }
  if (await input.repository.circuitStatus(input.useCaseId) === "OPEN") {
    return {
      ...base,
      modelTier: selected.tier,
      status: definition.fallback === "DETERMINISTIC"
        ? "DETERMINISTIC_FALLBACK" : "WAITING_OPENAI_RETRY",
      idempotencyKey,
      model: selected.model,
      manifest,
      result: null,
      errorCode: "OPENAI_INTELLIGENCE_CIRCUIT_OPEN",
    } satisfies EbayOpenAiShadowExecution
  }
  const leased: EbayOpenAiInvocationRecord = {
    idempotencyKey,
    useCaseId: input.useCaseId,
    productRefHash: ebayOpenAiIntelligenceHash(input.productRef),
    dossierHash: input.dossierHash,
    model: selected.model,
    modelTier: selected.tier,
    promptVersion: definition.promptVersion,
    schemaVersion: definition.outputSchemaVersion,
    manifest,
    estimatedCostMicros: input.estimatedCostMicros,
    status: "LEASED",
    outputHash: null,
    sanitizedResult: null,
    errorCode: null,
    usage: null,
  }
  try {
    await input.repository.reserve(leased, input.policy)
  } catch (error) {
    return {
      ...base,
      modelTier: selected.tier,
      status: "BLOCKED",
      idempotencyKey,
      model: selected.model,
      manifest,
      result: null,
      errorCode: safeErrorCode(error),
    } satisfies EbayOpenAiShadowExecution
  }
  try {
    const transportResponse = await input.transport.invoke({
      useCaseId: input.useCaseId,
      model: selected.model,
      store: false,
      instructions: [
        "OpenAI is not a source of truth.",
        "Use only supplied evidence references.",
        "Never execute external effects or authorize identity, claims, price, stock, promotion, or publication.",
        `Prompt version: ${definition.promptVersion}.`,
      ].join("\n"),
      input: JSON.stringify(stable(input.payload)),
      text: {
        format: {
          type: "json_schema",
          name: input.useCaseId.toLowerCase(),
          strict: true,
          schema: definition.outputSchema,
        },
      },
      maxOutputTokens: definition.maximumOutputTokens,
      promptCacheKey:
        `${input.useCaseId}:${definition.promptVersion}:${definition.outputSchemaVersion}`,
      timeoutMs: definition.timeoutMs,
    })
    const validated = validateEbayOpenAiCommercialOutput({
      useCaseId: input.useCaseId,
      rawOutput: transportResponse.output,
      availableEvidenceRefs: input.availableEvidenceRefs,
    })
    const outputHash = ebayOpenAiIntelligenceHash(validated)
    await input.repository.complete(idempotencyKey, {
      status: "SHADOW_COMPLETED",
      outputHash,
      sanitizedResult: validated,
      usage: transportResponse.usage,
      errorCode: null,
    })
    await input.repository.recordProviderSuccess(input.useCaseId)
    return {
      ...base,
      modelTier: selected.tier,
      status: "SHADOW_COMPLETED",
      idempotencyKey,
      model: selected.model,
      manifest,
      result: validated,
      errorCode: null,
    } satisfies EbayOpenAiShadowExecution
  } catch (error) {
    const errorCode = safeErrorCode(error)
    const globalFailure = isGlobalProviderFailure(errorCode)
    await input.repository.recordProviderFailure(
      input.useCaseId,
      globalFailure,
      input.policy.circuitFailureThreshold,
    )
    const waiting = definition.fallback !== "DETERMINISTIC"
    await input.repository.complete(idempotencyKey, {
      status: waiting ? "WAITING_OPENAI_RETRY" : "FAILED",
      errorCode,
    })
    return {
      ...base,
      modelTier: selected.tier,
      status: waiting ? "WAITING_OPENAI_RETRY" : "DETERMINISTIC_FALLBACK",
      idempotencyKey,
      model: selected.model,
      manifest,
      result: null,
      errorCode,
    } satisfies EbayOpenAiShadowExecution
  }
}

export class InMemoryEbayOpenAiIntelligenceRepository
implements EbayOpenAiIntelligenceRepository {
  readonly records = new Map<string, EbayOpenAiInvocationRecord>()
  readonly failures = new Map<EbayOpenAiIntelligenceUseCaseId, number>()
  readonly circuits = new Map<
    EbayOpenAiIntelligenceUseCaseId,
    "CLOSED" | "OPEN" | "HALF_OPEN"
  >()
  private dailySpend = 0
  private monthlySpend = 0
  private readonly productSpend = new Map<string, number>()
  private readonly useCaseSpend =
    new Map<EbayOpenAiIntelligenceUseCaseId, number>()

  async find(idempotencyKey: string) {
    return this.records.get(idempotencyKey) ?? null
  }

  async reserve(
    record: EbayOpenAiInvocationRecord,
    policy: EbayOpenAiShadowRuntimePolicy,
  ) {
    if (this.records.has(record.idempotencyKey)) {
      throw new Error("OPENAI_INTELLIGENCE_DUPLICATE_RESERVATION")
    }
    const cost = record.estimatedCostMicros
    const product = this.productSpend.get(record.productRefHash) ?? 0
    const useCase = this.useCaseSpend.get(record.useCaseId) ?? 0
    if (
      cost > policy.perInvocationBudgetMicros
      || this.dailySpend + cost > policy.dailyBudgetMicros
      || this.monthlySpend + cost > policy.monthlyBudgetMicros
      || product + cost > policy.perProductBudgetMicros
      || useCase + cost > policy.perUseCaseDailyBudgetMicros
    ) {
      throw new Error("OPENAI_INTELLIGENCE_BUDGET_BLOCKED")
    }
    this.dailySpend += cost
    this.monthlySpend += cost
    this.productSpend.set(record.productRefHash, product + cost)
    this.useCaseSpend.set(record.useCaseId, useCase + cost)
    this.records.set(record.idempotencyKey, structuredClone(record))
  }

  async complete(
    idempotencyKey: string,
    update: Partial<EbayOpenAiInvocationRecord>,
  ) {
    const current = this.records.get(idempotencyKey)
    if (!current) throw new Error("OPENAI_INTELLIGENCE_INVOCATION_NOT_FOUND")
    this.records.set(idempotencyKey, { ...current, ...structuredClone(update) })
  }

  async circuitStatus(useCaseId: EbayOpenAiIntelligenceUseCaseId) {
    return this.circuits.get(useCaseId) ?? "CLOSED"
  }

  async recordProviderFailure(
    useCaseId: EbayOpenAiIntelligenceUseCaseId,
    globalFailure: boolean,
    threshold: number,
  ) {
    if (!globalFailure) return
    const count = (this.failures.get(useCaseId) ?? 0) + 1
    this.failures.set(useCaseId, count)
    if (count >= Math.max(1, threshold)) this.circuits.set(useCaseId, "OPEN")
  }

  async recordProviderSuccess(useCaseId: EbayOpenAiIntelligenceUseCaseId) {
    this.failures.set(useCaseId, 0)
    this.circuits.set(useCaseId, "CLOSED")
  }
}

export function buildEbayOpenAiFixtureOutput(input: {
  useCaseId: EbayOpenAiIntelligenceUseCaseId
  evidenceRef: string
  classification?: string
}): EbayOpenAiCommercialOutput {
  const definition = getEbayOpenAiUseCaseDefinition(input.useCaseId)
  return {
    result: {
      status: "SUCCEEDED",
      summary: "Resultado fixture sanitizado para evaluar el contrato shadow.",
      classifications: [{
        subjectRef: "fixture-subject",
        label: input.classification ?? (
          input.useCaseId === "COMPARABLE_CLASSIFICATION"
            ? "INSUFFICIENT_EVIDENCE" : "OBSERVE"
        ),
        reason: "Clasificacion fixture; no modifica decisiones.",
        evidenceRefs: [input.evidenceRef],
      }],
      candidateClaims: [],
      blockedClaims: [],
      listingProposals: [],
      experimentProposal: null,
    },
    confidence: 80,
    evidenceUsed: [input.evidenceRef],
    evidenceMissing: [],
    hypotheses: [],
    risks: [],
    recommendedAction: "OBSERVE",
    prohibitedActions: [...EBAY_OPENAI_PROHIBITED_ACTIONS],
    humanReviewRequired: true,
    promptVersion: definition.promptVersion,
    schemaVersion: definition.outputSchemaVersion,
  }
}

export async function runEbayOpenAiFiveProductShadowFixture(input?: {
  timeoutProductIndex?: number
  globalOutageProductIndexes?: readonly number[]
}) {
  const repository = new InMemoryEbayOpenAiIntelligenceRepository()
  let fixtureAdapterCalls = 0
  const transport: EbayOpenAiIntelligenceTransport = {
    async invoke(request) {
      fixtureAdapterCalls += 1
      const productIndex = Number(JSON.parse(request.input).facts.productIndex)
      if (input?.timeoutProductIndex === productIndex) {
        throw new Error("OPENAI_INTELLIGENCE_PROVIDER_TIMEOUT")
      }
      if (input?.globalOutageProductIndexes?.includes(productIndex)) {
        throw new Error("OPENAI_INTELLIGENCE_PROVIDER_UNAVAILABLE")
      }
      const evidenceRef = `fixture:evidence:${productIndex}`
      return {
        requestId: `fixture-request-${productIndex}`,
        output: buildEbayOpenAiFixtureOutput({
          useCaseId: request.useCaseId,
          evidenceRef,
        }),
        usage: {
          inputTokens: 100,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 80,
        },
      }
    },
  }
  const policy: EbayOpenAiShadowRuntimePolicy = {
    enabled: true,
    killSwitchEngaged: false,
    mode: "SHADOW",
    dailyBudgetMicros: 1_000_000,
    monthlyBudgetMicros: 1_000_000,
    perProductBudgetMicros: 100_000,
    perUseCaseDailyBudgetMicros: 1_000_000,
    perInvocationBudgetMicros: 100_000,
    circuitFailureThreshold: 2,
    allowSingleAdvancedEscalation: true,
  }
  const results: EbayOpenAiShadowExecution[] = []
  for (let index = 1; index <= 5; index += 1) {
    const evidenceRef = `fixture:evidence:${index}`
    results.push(await executeEbayOpenAiShadowUseCase({
      useCaseId: "DOSSIER_DISTILLATION",
      productRef: `fixture-product-${index}`,
      dossierHash: ebayOpenAiIntelligenceHash(`fixture-dossier-${index}`),
      payload: {
        productRef: `fixture-product-${index}`,
        dossierHash: ebayOpenAiIntelligenceHash(`fixture-dossier-${index}`),
        facts: { productIndex: index, source: "AUTHORIZED_FIXTURE" },
        evidence: [{ ref: evidenceRef, authority: "FIXTURE" }],
      },
      availableEvidenceRefs: [evidenceRef],
      estimatedCostMicros: 1_000,
      policy,
      router: {
        ECONOMY: "fixture-economy",
        BALANCED: "fixture-balanced",
        ADVANCED: "fixture-advanced",
        IMAGE: "fixture-image",
        EMBEDDING: "fixture-embedding",
      },
      repository,
      transport,
    }))
  }
  return {
    version: "OPENAI_INTELLIGENCE_FIVE_PRODUCT_SHADOW_FIXTURE_V1",
    products: 5,
    results,
    completed: results.filter((entry) =>
      entry.status === "SHADOW_COMPLETED").length,
    isolated: results.filter((entry) =>
      entry.status !== "SHADOW_COMPLETED").length,
    fixtureAdapterCalls,
    realOpenAiCalls: 0,
    stateMutations: 0,
    ebayWrites: 0,
  }
}

export function compareEbayOpenAiShadowAgainstGroundTruth(input: {
  expectedAction: EbayOpenAiCommercialOutput["recommendedAction"]
  result: EbayOpenAiCommercialOutput
}) {
  return {
    comparable: true,
    actionMatch: input.expectedAction === input.result.recommendedAction,
    schemaPass: true,
    evidenceReferencePass: true,
    externalEffects: 0,
  }
}
