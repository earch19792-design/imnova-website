export const IMNOVA_SELF_IMPROVEMENT_CODEX_HANDOFF_VERSION =
  "IMNOVA_SELF_IMPROVEMENT_CODEX_HANDOFF_V1"

type RiskLevel =
  | "LOW"
  | "MEDIUM"
  | "HIGH"

type ImprovementSignal = {
  improvementKey: string
  title: string
  sourceModule: string
  problemStatement: string
  whyItMatters: string
  expectedImpact: RiskLevel | string
  implementationRisk: RiskLevel | string
  suggestedBranchName: string
  suggestedFiles: string[]
  suggestedTests: string[]
}

type SelfImprovementInput = {
  improvementSignals?: ImprovementSignal[]
}

const prohibitedCommands = [
  "/review",
  "Summarize recent commits",
  "Write tests for @filename",
]

const prohibitedActions = [
  "TOUCH_PRODUCTION",
  "WRITE_MAIN",
  "COMMIT_SECRETS",
  "CALL_CODEX_API",
  "CALL_OPENAI_API",
  "AUTO_MERGE",
  "AUTO_PR",
  "MODIFY_ENV",
  "EXECUTE_REAL_API",
]

const baselineGuardrails = [
  "No Production touch.",
  "No Staging DB write.",
  "No Codex API real.",
  "No OpenAI API.",
  "No automatic code changes.",
  "No branch automation.",
  "No PR automation.",
  "No merge automation.",
  "No secrets, tokens, auth codes, or .env content in prompts.",
  "Human approval required before implementation.",
]

const forbiddenFiles = [
  ".env",
  ".env.local",
  ".env.*",
  "Production database",
  "Staging database",
  "secrets",
  "tokens",
  "dumps",
  "backups",
]

function impactValue(level: RiskLevel) {
  if (level === "HIGH") {
    return 90
  }

  if (level === "MEDIUM") {
    return 65
  }

  return 35
}

function riskPenalty(level: RiskLevel) {
  if (level === "HIGH") {
    return 35
  }

  if (level === "MEDIUM") {
    return 18
  }

  return 6
}

function normalizeRiskLevel(value: string): RiskLevel {
  if (value === "HIGH" || value === "MEDIUM" || value === "LOW") {
    return value
  }

  return "MEDIUM"
}

function clampScore(value: number) {
  return Math.max(
    0,
    Math.min(
      100,
      Number(value.toFixed(0)),
    ),
  )
}

function normalizeSignals(input: SelfImprovementInput = {}) {
  return Array.isArray(input.improvementSignals)
    ? input.improvementSignals
    : []
}

export function buildSelfImprovementSignalInput(input: SelfImprovementInput = {}) {
  return {
    version:
      IMNOVA_SELF_IMPROVEMENT_CODEX_HANDOFF_VERSION,
    signals:
      normalizeSignals(input).map(signal => ({
        ...signal,
        suggestedFiles:
          [...signal.suggestedFiles],
        suggestedTests:
          [...signal.suggestedTests],
      })),
    mode:
      "LOCAL_DRY_RUN_HANDOFF_ONLY",
  }
}

export function buildSelfImprovementOpportunity(signal: ImprovementSignal) {
  const expectedImpact =
    normalizeRiskLevel(signal.expectedImpact)
  const implementationRisk =
    normalizeRiskLevel(signal.implementationRisk)
  const priorityScore =
    clampScore(
      impactValue(expectedImpact) -
      riskPenalty(implementationRisk) +
      12,
    )

  return {
    improvementKey:
      signal.improvementKey,
    title:
      signal.title,
    sourceModule:
      signal.sourceModule,
    problemStatement:
      signal.problemStatement,
    whyItMatters:
      signal.whyItMatters,
    expectedImpact:
      expectedImpact,
    implementationRisk:
      implementationRisk,
    priorityScore,
    suggestedBranchName:
      signal.suggestedBranchName,
    suggestedFiles:
      [...signal.suggestedFiles],
    suggestedTests:
      [...signal.suggestedTests],
  }
}

export function buildSelfImprovementBacklogItem(signal: ImprovementSignal) {
  const opportunity =
    buildSelfImprovementOpportunity(signal)

  return {
    ...opportunity,
    guardrails:
      [...baselineGuardrails],
    humanApprovalRequired:
      true,
    canSendToCodex:
      false,
    codexHandoffMode:
      "MANUAL_COPY_ONLY",
    status:
      opportunity.priorityScore >= 70
        ? "READY_FOR_HUMAN_REVIEW"
        : "BACKLOG",
  }
}

export function buildSelfImprovementBacklog(input: SelfImprovementInput = {}) {
  return buildSelfImprovementSignalInput(input).signals.map(signal =>
    buildSelfImprovementBacklogItem(signal),
  )
}

export function buildCodexWorkOrder(backlogItem: ReturnType<typeof buildSelfImprovementBacklogItem>) {
  return {
    workOrderKey:
      `work-order:${backlogItem.improvementKey}`,
    linkedImprovementKey:
      backlogItem.improvementKey,
    objective:
      backlogItem.title,
    branchName:
      backlogItem.suggestedBranchName,
    filesToCreateOrModify:
      [...backlogItem.suggestedFiles],
    filesForbidden:
      [...forbiddenFiles],
    testsToRun:
      [...backlogItem.suggestedTests],
    dryRunRequired:
      true,
    safetyBoundaries:
      [...baselineGuardrails],
    definitionOfDone:
      [
        "Scope remains limited to the approved work order.",
        "All requested tests pass.",
        "Dry-run output is reported.",
        "No prohibited action is executed.",
        "Git status is clean after commit.",
      ],
    humanExplanationRequired:
      true,
    prohibitedCommands:
      [...prohibitedCommands],
    prohibitedActions:
      [...prohibitedActions],
    humanApprovalRequired:
      true,
    codexHandoffMode:
      "MANUAL_COPY_ONLY",
  }
}

export function buildCodexHandoffPrompt(workOrder: ReturnType<typeof buildCodexWorkOrder>) {
  return [
    "Estamos trabajando IMNOVA OS / Marketplace Seller OS.",
    "",
    `Objetivo: ${workOrder.objective}`,
    `Branch sugerida: ${workOrder.branchName}`,
    "",
    "Archivos permitidos:",
    ...workOrder.filesToCreateOrModify.map(file => `- ${file}`),
    "",
    "Archivos prohibidos:",
    ...workOrder.filesForbidden.map(file => `- ${file}`),
    "",
    "Tests requeridos:",
    ...workOrder.testsToRun.map(testCommand => `- ${testCommand}`),
    "",
    "Guardrails:",
    ...workOrder.safetyBoundaries.map(boundary => `- ${boundary}`),
    "",
    "Comandos prohibidos:",
    ...workOrder.prohibitedCommands.map(command => `- ${command}`),
    "",
    "Acciones prohibidas:",
    ...workOrder.prohibitedActions.map(action => `- ${action}`),
    "",
    "Definition of Done:",
    ...workOrder.definitionOfDone.map(item => `- ${item}`),
    "",
    "Explicacion humana requerida: explicar que se hizo, por que, que se protegio, que NO se toco y que sigue.",
    "Modo de handoff: MANUAL_COPY_ONLY. No Codex API. No ejecucion automatica.",
  ].join("\n")
}

export function sanitizeCodexHandoffPrompt(prompt: string) {
  const openAiKeyPattern =
    ["OPENAI", "_API_KEY"].join("")
  const codexKeyPattern =
    ["CODEX", "_API_KEY"].join("")
  const accessTokenPattern =
    ["access", "_token"].join("")
  const refreshTokenPattern =
    ["refresh", "_token"].join("")
  const clientSecretPattern =
    ["client", "_secret"].join("")
  const sbSecretPattern =
    ["sb", "_secret"].join("")
  const authCodePattern =
    ["auth", " code"].join("")

  const sensitivePatterns = [
    new RegExp(["s", "k-"].join("") + "[A-Za-z0-9_-]+", "g"),
    new RegExp(`${sbSecretPattern}[A-Za-z0-9_-]*`, "gi"),
    new RegExp(`${accessTokenPattern}\\s*[:=]\\s*[A-Za-z0-9._-]+`, "gi"),
    new RegExp(`${refreshTokenPattern}\\s*[:=]\\s*[A-Za-z0-9._-]+`, "gi"),
    new RegExp(`${clientSecretPattern}\\s*[:=]\\s*[A-Za-z0-9._-]+`, "gi"),
    new RegExp(`${openAiKeyPattern}\\s*[:=]\\s*[A-Za-z0-9._-]+`, "g"),
    new RegExp(`${codexKeyPattern}\\s*[:=]\\s*[A-Za-z0-9._-]+`, "g"),
    new RegExp(`${authCodePattern}\\s*[:=]\\s*[A-Za-z0-9._-]+`, "gi"),
    /\b(?=[A-Za-z0-9]{40,}\b)(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9]{40,}\b/g,
  ]

  let sanitizedPrompt =
    prompt
  let redactionsApplied =
    0

  for (const pattern of sensitivePatterns) {
    sanitizedPrompt =
      sanitizedPrompt.replace(
        pattern,
        () => {
          redactionsApplied += 1
          return "[REDACTED_SECRET]"
        },
      )
  }

  return {
    prompt:
      sanitizedPrompt,
    secretsDetected:
      redactionsApplied > 0,
    redactionsApplied,
    sanitized:
      true,
  }
}

export function buildCodexHandoffPackage(backlogItem: ReturnType<typeof buildSelfImprovementBacklogItem>) {
  const workOrder =
    buildCodexWorkOrder(backlogItem)
  const rawPrompt =
    buildCodexHandoffPrompt(workOrder)
  const sanitizedPrompt =
    sanitizeCodexHandoffPrompt(rawPrompt)

  return {
    backlogItem,
    workOrder,
    handoffPrompt:
      sanitizedPrompt.prompt,
    promptSanitized:
      sanitizedPrompt.sanitized,
    secretsDetected:
      sanitizedPrompt.secretsDetected,
    redactionsApplied:
      sanitizedPrompt.redactionsApplied,
    manualHandoffOnly:
      true,
    humanApprovalRequired:
      true,
    canSendToCodex:
      false,
  }
}

export function buildCodexHandoffQueue(input: SelfImprovementInput = {}) {
  return buildSelfImprovementBacklog(input).map(item =>
    buildCodexHandoffPackage(item),
  )
}

export function summarizeCodexHandoffQueue(queue = buildCodexHandoffQueue()) {
  const backlogItems =
    queue.map(item => item.backlogItem)

  return {
    selfImprovementBacklogBuilt:
      true,
    backlogItemsBuilt:
      backlogItems.length,
    highPriorityItems:
      backlogItems.filter(item => item.expectedImpact === "HIGH").length,
    mediumPriorityItems:
      backlogItems.filter(item => item.expectedImpact === "MEDIUM").length,
    lowPriorityItems:
      backlogItems.filter(item => item.expectedImpact === "LOW").length,
    codexWorkOrdersBuilt:
      queue.length,
    codexHandoffPromptsBuilt:
      queue.length,
    promptsSanitized:
      queue.every(item => item.promptSanitized),
    secretsDetected:
      queue.some(item => item.secretsDetected),
    manualHandoffOnly:
      queue.every(item => item.manualHandoffOnly),
    humanApprovalRequired:
      queue.every(item => item.humanApprovalRequired),
    codexApiUsed:
      false,
    openAiApiUsed:
      false,
    automaticCodeChangesExecuted:
      false,
    branchCreationExecuted:
      false,
    pullRequestCreationExecuted:
      false,
    mergeExecuted:
      false,
    productionTouched:
      false,
    mainTouched:
      false,
    stagingWriteExecuted:
      false,
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    whatsappRealSendUsed:
      false,
    scraperUsed:
      false,
    uiRoute:
      "/admin/self-improvement",
    nextLoop:
      "149CODEX-B",
    thenNextAmazonLoop:
      "149G",
  }
}

export function getSelfImprovementCodexHandoffChecklist() {
  return [
    "Construir backlog local de oportunidades de mejora.",
    "Generar work orders con branch sugerida, archivos, tests y guardrails.",
    "Generar prompts seguros para handoff manual a Codex.",
    "Sanitizar secretos, tokens, auth codes y valores sensibles.",
    "Exigir aprobacion humana antes de cualquier implementacion.",
    "Mantener Codex API, OpenAI API, branch automation, PR automation y merge automation desactivados.",
  ]
}
