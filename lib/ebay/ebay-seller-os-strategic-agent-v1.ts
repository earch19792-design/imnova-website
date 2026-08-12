import OpenAI from "openai"
import { Agent, OpenAIProvider, Runner, tool } from "@openai/agents"
import { z } from "zod"

// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { containsSensitiveAssistantMaterial, sanitizeMonitorText, type CommercialMonitorGetDto } from "./commercial-monitor-readonly-contract.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { executeSellerOsAssistantToolV1, SELLER_OS_ASSISTANT_TOOLS_V1 } from "./ebay-seller-os-assistant-gateway-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { buildDailyStrategicBriefFallbackV1, createAssistantFindingV1, evaluateAiBudgetPolicyV1, evaluateHighImpactConsensusPolicyV1, prefilterStrategicReviewV1, resolveModelPolicyV1, type AiUsageObservationV1, type SellerOsAiWorkload } from "./ebay-seller-os-ai-strategic-intelligence-v1.ts"

export const SELLER_OS_STRATEGIC_AGENT_VERSION =
  "SELLER_OS_STRATEGIC_AGENT_V1_2026_08_12"

type AgentContextV1 = { monitor: CommercialMonitorGetDto }

export type SellerOsCopilotContextRefV1 = {
  surface: "PORTFOLIO" | "LISTING" | "OPPORTUNITY" | "STOCK" |
    "EXPERIMENT" | "DECISION"
  itemId?: string | null
  opportunityCaseId?: string | null
  experimentId?: string | null
  exceptionId?: string | null
}

const MAX_PROMPT_CHARACTERS = 2_000
const MAX_CONTEXT_REFERENCE_CHARACTERS = 120
const BUYER_PII_OR_SECRET_VALUE = /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\+?\d[\s().-]*){8,}\b|\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b|(?:authorization|cookie|password|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*\S+)/i
const LABELED_EBAY_ITEM_ID = /\b(?:(?:eBay\s+)?Item\s*ID|itemId|listing\s*ID)\s*[:=#-]?\s*\d{9,19}\b/gi

function containsProhibitedFreeText(value: string) {
  // Only explicitly labeled Item IDs are exempted. An unlabeled 9–19 digit
  // sequence may be buyer PII and therefore fails closed.
  return BUYER_PII_OR_SECRET_VALUE.test(value.replace(LABELED_EBAY_ITEM_ID, "[ITEM_ID]"))
}

const agentOutputSchema = z.object({
  summary: z.string().min(1).max(2_000),
  evidenceRefs: z.array(z.string().min(1).max(160)).max(20),
  recommendations: z.array(z.object({
    action: z.string().min(1).max(300),
    reason: z.string().min(1).max(500),
    priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
    humanApprovalRequired: z.boolean(),
  })).max(10),
  missingEvidence: z.array(z.string().min(1).max(200)).max(10),
  doNotTouch: z.array(z.string().min(1).max(200)).max(10),
  findings: z.array(z.object({
    findingType: z.enum(["DECISION_CONFLICT", "CANONICAL_TRUTH_CONFLICT",
      "HIGH_MANUAL_REVIEW_RATE", "FALSE_INTERVENTION_SPIKE",
      "DUPLICATE_EXCEPTION_SPIKE", "STALE_EVIDENCE_SPIKE", "SUPPLIER_RISK",
      "OPPORTUNITY_STRENGTHENING", "OPPORTUNITY_WEAKENING", "REPLACEMENT_CANDIDATE",
      "EXPERIMENT_READY", "QUALITY_GUIDANCE_CONFLICT", "KEYWORD_QUALITY_ANOMALY",
      "PRICE_DISTRIBUTION_ANOMALY", "PORTFOLIO_CONCENTRATION_RISK",
      "CAPABILITY_BLOCKER", "AUTOMATION_FAILURE", "SCHEDULER_LATENCY",
      "AI_COST_ANOMALY", "MODEL_FALLBACK_SPIKE", "HIGH_HUMAN_OVERRIDE_RATE"]),
    severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
    module: z.string().min(1).max(80),
    entityRefs: z.array(z.string().max(120)).max(20),
    evidenceRefs: z.array(z.string().max(160)).max(20),
    summary: z.string().min(1).max(500),
    whyItMatters: z.string().min(1).max(700),
    recommendedImprovement: z.string().min(1).max(700),
    automationCandidate: z.boolean(),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW", "UNPROVEN"]),
  })).max(10),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW", "UNPROVEN"]),
})

function boundedReference(value: unknown) {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9:_-]/g, "")
    .slice(0, MAX_CONTEXT_REFERENCE_CHARACTERS) || null : null
}

export function sanitizeCopilotContextRefV1(input?: SellerOsCopilotContextRefV1 | null) {
  const surface = input?.surface ?? "PORTFOLIO"
  const itemId = /^\d{9,19}$/.test(input?.itemId ?? "") ? input!.itemId! : null
  return { surface, itemId,
    opportunityCaseId: boundedReference(input?.opportunityCaseId),
    experimentId: boundedReference(input?.experimentId),
    exceptionId: boundedReference(input?.exceptionId) }
}

export function validateSellerOsAgentInputV1(prompt: unknown) {
  if (typeof prompt === "string" && (containsProhibitedFreeText(prompt) ||
      containsSensitiveAssistantMaterial(prompt))) {
    return { ok: false as const, error: "COPILOT_SENSITIVE_INPUT_REJECTED" }
  }
  const sanitized = sanitizeMonitorText(prompt, MAX_PROMPT_CHARACTERS)
  if (!sanitized) return { ok: false as const, error: "COPILOT_PROMPT_REQUIRED" }
  if (containsProhibitedFreeText(sanitized) || containsSensitiveAssistantMaterial(sanitized)) {
    return { ok: false as const, error: "COPILOT_SENSITIVE_INPUT_REJECTED" }
  }
  return { ok: true as const, prompt: sanitized }
}

export function getSellerOsAiRuntimeStatusV1(environment: NodeJS.ProcessEnv = process.env) {
  const gatewayOidcPresent = Boolean(environment.VERCEL_OIDC_TOKEN?.trim())
  const gatewayApiKeyPresent = Boolean(environment.AI_GATEWAY_API_KEY?.trim())
  const openAiApiKeyPresent = Boolean(environment.OPENAI_API_KEY?.trim())
  const gatewayAvailable = gatewayOidcPresent || gatewayApiKeyPresent
  return {
    contractVersion: "SELLER_OS_AI_RUNTIME_STATUS_V1_2026_08_12",
    status: gatewayAvailable || openAiApiKeyPresent ? "READY" as const :
      "READY_FOR_CREDENTIAL_ACTIVATION" as const,
    preferredProvider: "VERCEL_AI_GATEWAY" as const,
    activeProvider: gatewayAvailable ? "VERCEL_AI_GATEWAY" as const
      : openAiApiKeyPresent ? "OPENAI_DIRECT" as const : "NONE" as const,
    gatewayAuthenticationMode: gatewayOidcPresent ? "VERCEL_OIDC" as const
      : gatewayApiKeyPresent ? "AI_GATEWAY_API_KEY" as const : "UNAVAILABLE" as const,
    openAiApiKeyPresent,
    openAiApiKeyServerOnly: openAiApiKeyPresent,
    openAiApiKeyValueExposed: false as const,
    environmentChanged: false as const,
    providerRouting: true as const,
    tokenUsageObservable: true as const,
    latencyObservable: true as const,
    fallbackVisibility: gatewayAvailable ? "GATEWAY_WHEN_REPORTED" as const : "UNPROVEN" as const,
    costVisibility: "UNPROVEN_UNTIL_AUTHORITATIVE_USAGE_EVIDENCE" as const,
    imageGenerationEnabled: false as const,
  }
}

function createProvider(environment: NodeJS.ProcessEnv, workload: SellerOsAiWorkload) {
  const status = getSellerOsAiRuntimeStatusV1(environment)
  if (status.activeProvider === "NONE") return null
  const gatewayCredential = environment.VERCEL_OIDC_TOKEN?.trim() ||
    environment.AI_GATEWAY_API_KEY?.trim()
  const apiKey = status.activeProvider === "VERCEL_AI_GATEWAY" ? gatewayCredential
    : environment.OPENAI_API_KEY?.trim()
  if (!apiKey) return null
  const baseURL = status.activeProvider === "VERCEL_AI_GATEWAY"
    ? "https://ai-gateway.vercel.sh/v1" : undefined
  const vercelHost = /^[a-z0-9.-]+$/i.test(environment.VERCEL_URL?.trim() ?? "")
    ? environment.VERCEL_URL!.trim() : "seller-os.invalid"
  const client = new OpenAI({ apiKey, baseURL, maxRetries: 1, timeout: 25_000,
    defaultHeaders: { "http-referer": `https://${vercelHost}`,
      "x-title": `Seller OS · ${workload}`, "x-seller-os-workload": workload } })
  return { status, provider: new OpenAIProvider({ openAIClient: client, useResponses: true }) }
}

function createReadOnlyAgentTools(monitor: CommercialMonitorGetDto) {
  return SELLER_OS_ASSISTANT_TOOLS_V1.map((descriptor) => {
    const itemTool = descriptor.name === "seller_os_get_listing_intelligence"
    const caseTool = descriptor.name === "seller_os_get_opportunity_case"
    const parameters = itemTool ? z.object({ itemId: z.string().regex(/^\d{9,19}$/),
      limit: z.number().int().min(1).max(100).optional() })
      : caseTool ? z.object({ opportunityCaseId: z.string().min(1).max(120),
        limit: z.number().int().min(1).max(100).optional() })
        : z.object({ limit: z.number().int().min(1).max(100).optional() })
    return tool({ name: descriptor.name, description: descriptor.description,
      parameters, strict: true, timeoutMs: 10_000, needsApproval: false,
      errorFunction: () => JSON.stringify({ status: "SELLER_OS_TOOL_FAILED_CLOSED",
        credentialsIncluded: false, buyerPiiIncluded: false, marketplaceWrites: 0 }),
      execute: async (args) => executeSellerOsAssistantToolV1({ toolName: descriptor.name,
        arguments: args as Record<string, unknown>, monitor }) })
  })
}

function assertSafeAgentOutput(value: unknown, monitor: CommercialMonitorGetDto) {
  const knownItemIds = new Set(monitor.listings.map((row) => row.identity.itemId))
  const normalized = [...knownItemIds].reduce((serialized, itemId) =>
    serialized.replaceAll(itemId, "[ITEM_ID]"), JSON.stringify(value))
  if (containsSensitiveAssistantMaterial(value) || containsProhibitedFreeText(normalized)) {
    throw new Error("SELLER_OS_AGENT_OUTPUT_SANITIZATION_FAILED")
  }
  return value
}

function constrainAgentEvidenceRefsV1(
  output: z.infer<typeof agentOutputSchema>,
  monitor: CommercialMonitorGetDto,
) {
  const itemIds = new Set(monitor.listings.map((row) => row.identity.itemId))
  const listingKeys = new Set(monitor.listings.map((row) => row.key))
  const reasonCodes = new Set<string>(monitor.backend.decisions.flatMap((row) => row.reasonCodes))
  const toolNames = new Set(SELLER_OS_ASSISTANT_TOOLS_V1.map((row) => row.name))
  const supported = (ref: string) => itemIds.has(ref) || listingKeys.has(ref) ||
    reasonCodes.has(ref) || toolNames.has(ref) || ref === monitor.generatedAt ||
    /^(?:CANONICAL_OPPORTUNITY_RESULT_V2|DECISION_TAXONOMY_V2|COMMERCIAL_MONITOR|strategic-signal-v1:|exception_)/
      .test(ref) || [...itemIds].some((itemId) => ref.includes(itemId))
  const evidenceRefs = output.evidenceRefs.filter(supported)
  const findings = output.findings.flatMap((finding) => {
    const groundedEvidence = finding.evidenceRefs.filter(supported)
    const groundedEntities = finding.entityRefs.filter((ref) =>
      itemIds.has(ref) || listingKeys.has(ref))
    return groundedEvidence.length || groundedEntities.length
      ? [{ ...finding, evidenceRefs: groundedEvidence, entityRefs: groundedEntities }] : []
  })
  return { ...output, evidenceRefs, findings,
    missingEvidence: evidenceRefs.length || output.recommendations.length === 0
      ? output.missingEvidence
      : [...new Set([...output.missingEvidence,
        "SELLER_OS_EVIDENCE_REFERENCE_REQUIRED"])].slice(0, 10),
    confidence: evidenceRefs.length || output.recommendations.length === 0
      ? output.confidence : "UNPROVEN" as const }
}

export function buildSellerOsAgentRuntimePlanV1(input: {
  workload: SellerOsAiWorkload
  environment?: NodeJS.ProcessEnv
  authoritativeSpendUsd?: number | null
  impact?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  evidenceConflict?: boolean
}) {
  const runtime = getSellerOsAiRuntimeStatusV1(input.environment ?? process.env)
  const budget = evaluateAiBudgetPolicyV1({ authoritativeSpendUsd: input.authoritativeSpendUsd })
  const model = resolveModelPolicyV1({ workload: input.workload, budgetState: budget.state,
    impact: input.impact, evidenceConflict: input.evidenceConflict,
    providerMode: runtime.activeProvider === "VERCEL_AI_GATEWAY"
      ? "VERCEL_AI_GATEWAY" : "OPENAI_DIRECT" })
  const consensus = evaluateHighImpactConsensusPolicyV1({ impact: input.impact ?? "MEDIUM",
    evidenceConflict: input.evidenceConflict ?? false,
    portfolioOrCapitalRisk: input.impact === "CRITICAL", changesSystemPolicy:
      input.workload === "seller_os.system_coherence", budgetState: budget.state })
  return { runtime, budget, model, consensus, workloadTagPresent: true as const,
    readOnlyToolsOnly: true as const, arbitrarySqlAllowed: false as const,
    arbitraryUrlFetchAllowed: false as const, imageGenerationEnabled: false as const }
}

async function runAgent(input: {
  monitor: CommercialMonitorGetDto
  prompt: string
  workload: SellerOsAiWorkload
  impact?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  evidenceConflict?: boolean
  authoritativeSpendUsd?: number | null
  environment?: NodeJS.ProcessEnv
}) {
  const environment = input.environment ?? process.env
  const plan = buildSellerOsAgentRuntimePlanV1(input)
  if (plan.runtime.activeProvider === "NONE") return { status: "AI_CREDENTIAL_UNAVAILABLE" as const,
    plan, output: null, usage: null }
  if (!plan.model.aiCallAllowed || !plan.model.model) return { status: "DEFERRED_BY_BUDGET" as const,
    plan, output: null, usage: null }
  const provider = createProvider(environment, input.workload)
  if (!provider) return { status: "AI_CREDENTIAL_UNAVAILABLE" as const,
    plan, output: null, usage: null }
  const agent = new Agent<AgentContextV1, typeof agentOutputSchema>({
    name: "Seller OS Strategic Read-only Agent",
    instructions: [
      "Reason only from Seller OS tool evidence and the bounded context supplied.",
      "Canonical Opportunity Result V2, Decisions V2, Experiment Guardian, Stock Guard, and evidence-gated Learning remain authoritative.",
      "Never invent demand, sales probability, cost, health, identity, or system findings.",
      "Preserve UNPROVEN, UNKNOWN, and unavailable states. UNKNOWN is not risk.",
      "Cite stable entity/evidence references in every material recommendation.",
      "You may inspect, compare, explain, prioritize, and recommend only.",
      "Never request or expose credentials, buyer PII, cookies, authorization headers, or secret values.",
      "Never execute or recommend that this agent execute marketplace or business mutations.",
      "Use focused tools after summary context; do not request the entire portfolio repeatedly.",
    ].join(" "),
    model: plan.model.model,
    modelSettings: { reasoning: { effort: plan.model.reasoningEffort },
      text: { verbosity: "low" }, toolChoice: "auto" },
    tools: createReadOnlyAgentTools(input.monitor),
    outputType: agentOutputSchema,
  })
  const runner = new Runner({ modelProvider: provider.provider,
    tracingDisabled: true, traceIncludeSensitiveData: false,
    workflowName: input.workload,
    traceMetadata: { workload: input.workload, safety: "READ_ONLY" } })
  const startedAt = Date.now()
  try {
    const result = await runner.run(agent, input.prompt, { context: { monitor: input.monitor },
      maxTurns: 4, signal: AbortSignal.timeout(28_000) })
    const rawOutput = result.finalOutput
    if (!rawOutput) throw new Error("SELLER_OS_AGENT_EMPTY_OUTPUT")
    assertSafeAgentOutput(rawOutput, input.monitor)
    const output = constrainAgentEvidenceRefsV1(rawOutput, input.monitor)
    const usage: AiUsageObservationV1 = { requestCount: result.state.usage.requests,
      inputTokens: result.state.usage.inputTokens, outputTokens: result.state.usage.outputTokens,
      latencyMs: Date.now() - startedAt, model: plan.model.model,
      fallbackUsed: null, workload: input.workload, observedAt: new Date().toISOString(),
      actualCostUsd: null, costEvidence: "UNPROVEN" }
    return { status: "COMPLETED" as const, plan, output, usage }
  } catch {
    return { status: "AI_RUNTIME_FAILED_CLOSED" as const, plan, output: null,
      usage: { requestCount: 0, inputTokens: null, outputTokens: null,
        latencyMs: Date.now() - startedAt, model: plan.model.model, fallbackUsed: null,
        workload: input.workload, observedAt: new Date().toISOString(), actualCostUsd: null,
        costEvidence: "UNPROVEN" as const } }
  } finally {
    await provider.provider.close().catch(() => undefined)
  }
}

export async function runSellerOsCopilotV1(input: {
  monitor: CommercialMonitorGetDto
  prompt: unknown
  contextRef?: SellerOsCopilotContextRefV1 | null
  authoritativeSpendUsd?: number | null
  environment?: NodeJS.ProcessEnv
}) {
  const validated = validateSellerOsAgentInputV1(input.prompt)
  if (!validated.ok) return { status: validated.error, response: null,
    safety: { readOnly: true, marketplaceWrites: 0, buyerPiiIncluded: false,
      credentialsIncluded: false } }
  const contextRef = sanitizeCopilotContextRefV1(input.contextRef)
  const result = await runAgent({ monitor: input.monitor, workload: "seller_os.copilot",
    authoritativeSpendUsd: input.authoritativeSpendUsd, environment: input.environment,
    impact: "MEDIUM", prompt: `COPILOT QUESTION:\n${validated.prompt}\n\nBOUNDED CONTEXT REFERENCE:\n${JSON.stringify(contextRef)}\nUse a summary-first approach and call only the focused read-only Seller OS tools needed.` })
  return { ...result, response: result.output, contextRef,
    conversationScope: "SELLER_OS_COPILOT_NOT_CHATGPT_SESSION" as const,
    safety: { readOnly: true as const, marketplaceWrites: 0 as const,
      buyerPiiIncluded: false as const, credentialsIncluded: false as const,
      arbitrarySqlAllowed: false as const, arbitraryUrlFetchAllowed: false as const } }
}

export async function runSellerOsStrategicReviewV1(input: {
  monitor: CommercialMonitorGetDto
  bundle: Parameters<typeof prefilterStrategicReviewV1>[0]["bundle"]
  previousMaterialFingerprint?: string | null
  authoritativeSpendUsd?: number | null
  environment?: NodeJS.ProcessEnv
}) {
  const prefilter = prefilterStrategicReviewV1({ bundle: input.bundle,
    previousMaterialFingerprint: input.previousMaterialFingerprint })
  const fallback = buildDailyStrategicBriefFallbackV1({ bundle: input.bundle })
  if (!prefilter.shouldCallAi) return { status: "DETERMINISTIC_BRIEF_ONLY" as const,
    prefilter, dailyBrief: fallback, findings: [], usage: null,
    aiCallCount: 0 as const, marketplaceWrites: 0 as const }
  const critical = input.bundle.strategicReviewQueue.entries.some((row) =>
    row.severity === "CRITICAL")
  const result = await runAgent({ monitor: input.monitor,
    workload: "seller_os.strategic_review", impact: critical ? "CRITICAL" : "HIGH",
    evidenceConflict: input.bundle.strategicReviewQueue.entries.some((row) =>
      ["DECISION_CONFLICT", "CANONICAL_TRUTH_CONFLICT"].includes(row.signalType)),
    authoritativeSpendUsd: input.authoritativeSpendUsd, environment: input.environment,
    prompt: `Perform one bounded strategic review. Every finding must map to a deterministic signal in this payload. Do not invent findings. Produce an executive answer covering what matters, proof, next action, and what not to touch.\n\n${JSON.stringify(prefilter.boundedPayload)}` })
  const createdAt = new Date().toISOString()
  const deterministicSignals = input.bundle.strategicReviewQueue.entries
  const findings = result.output?.findings.flatMap((finding) => {
    const source = deterministicSignals.find((signal) => signal.signalType === finding.findingType &&
      (finding.evidenceRefs.some((ref) => signal.evidenceRefs.includes(ref) ||
        ref === signal.signalId) ||
        finding.entityRefs.some((ref) => signal.entityRefs.includes(ref))))
    if (!source) return []
    const automationCandidate = input.bundle.automationCandidates.entries.some((candidate) =>
      candidate.evidenceRefs.some((ref) => source.evidenceRefs.includes(ref)))
    return [createAssistantFindingV1({ ...finding, severity: source.severity,
      module: source.module, entityRefs: source.entityRefs,
      evidenceRefs: source.evidenceRefs, automationCandidate,
      confidence: source.confidence, createdAt })]
  }) ?? []
  return { status: result.status, prefilter,
    dailyBrief: result.output ? { contractVersion: "DAILY_STRATEGIC_BRIEF_V1_2026_08_12",
      generatedAt: createdAt, generatedBy: "OPENAI_STRATEGIC_REVIEW" as const,
      summary: result.output.summary, evidenceRefs: result.output.evidenceRefs,
      recommendations: result.output.recommendations,
      missingEvidence: result.output.missingEvidence,
      doNotTouch: result.output.doNotTouch,
      confidence: result.output.confidence,
      deterministicFallback: fallback,
    } : fallback,
    findings, usage: result.usage,
    aiCallCount: result.usage?.requestCount ?? 0, marketplaceWrites: 0 as const }
}
