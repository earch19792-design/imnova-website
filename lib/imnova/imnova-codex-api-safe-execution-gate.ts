export const IMNOVA_CODEX_API_SAFE_EXECUTION_GATE_VERSION =
  "IMNOVA_CODEX_API_SAFE_EXECUTION_GATE_V1"

type RiskLevel =
  | "LOW"
  | "MEDIUM"
  | "HIGH"

type ConnectionConfigInput = {
  codexApiKeyStatus?: string
  codexApiEndpointStatus?: string
  executionMode?: string
  humanApprovalStatus?: string
  secretsPolicyStatus?: string
  externalNetworkAllowed?: boolean
  realCodexCallAllowed?: boolean
}

type SourceWorkOrder = {
  workOrderKey: string
  improvementKey: string
  objective: string
  proposedBranch: string
  filesToModify: string[]
  testsToRun: string[]
  promptPreview: string
  riskLevel: RiskLevel | string
  humanApprovalPresent: boolean
}

type GateInput = {
  connectionConfig?: ConnectionConfigInput
  sourceWorkOrders?: SourceWorkOrder[]
}

const prohibitedActions = [
  "CALL_CODEX_API",
  "CALL_OPENAI_API",
  "EXECUTE_CODE_CHANGE",
  "CREATE_BRANCH",
  "CREATE_PR",
  "MERGE_PR",
  "TOUCH_PRODUCTION",
  "WRITE_MAIN",
  "WRITE_STAGING_DB",
  "COMMIT_SECRET",
  "MODIFY_ENV",
  "RUN_EXTERNAL_NETWORK_CALL",
]

function clampScore(value: number) {
  return Math.max(
    0,
    Math.min(
      100,
      Number(value.toFixed(0)),
    ),
  )
}

function normalizeRiskLevel(value: string = "MEDIUM"): RiskLevel {
  if (value === "LOW" || value === "MEDIUM" || value === "HIGH") {
    return value
  }

  return "MEDIUM"
}

function normalizeLoop(value: string | undefined, fallback: string) {
  if (!value) {
    return fallback
  }

  return value.split(" ")[0]
}

export function buildCodexConnectionConfigInput(input: GateInput = {}) {
  const config =
    input.connectionConfig || {}

  return {
    codexApiKeyStatus:
      config.codexApiKeyStatus || "NOT_ALLOWED_IN_DRY_RUN",
    codexApiEndpointStatus:
      config.codexApiEndpointStatus || "NOT_ASSUMED",
    executionMode:
      config.executionMode || "DRY_RUN_ONLY",
    humanApprovalStatus:
      config.humanApprovalStatus || "MISSING",
    secretsPolicyStatus:
      config.secretsPolicyStatus || "PASS",
    externalNetworkAllowed:
      config.externalNetworkAllowed === true,
    realCodexCallAllowed:
      config.realCodexCallAllowed === true,
  }
}

export function validateCodexConnectionReadiness(input: GateInput = {}) {
  const config =
    buildCodexConnectionConfigInput(input)
  const blockedReasons =
    []
  const warnings =
    []

  if (config.codexApiKeyStatus !== "NOT_ALLOWED_IN_DRY_RUN") {
    blockedReasons.push("CODEX_CREDENTIAL_MUST_NOT_BE_USED_IN_DRY_RUN")
  }

  if (config.externalNetworkAllowed) {
    blockedReasons.push("EXTERNAL_NETWORK_DISABLED_IN_THIS_LOOP")
  }

  if (config.realCodexCallAllowed) {
    blockedReasons.push("REAL_CODEX_CALL_DISABLED_IN_THIS_LOOP")
  }

  if (config.humanApprovalStatus !== "APPROVED_FOR_DRY_RUN") {
    warnings.push("HUMAN_APPROVAL_REQUIRED_FOR_ANY_FUTURE_EXECUTION")
  }

  return {
    ...config,
    connectionReadyForDryRunPreview:
      blockedReasons.length === 0,
    blockedReasons,
    warnings,
    canCallCodexApi:
      false,
    canUseExternalNetwork:
      false,
  }
}

export function buildCodexExecutionGateInput(input: GateInput = {}) {
  return {
    version:
      IMNOVA_CODEX_API_SAFE_EXECUTION_GATE_VERSION,
    connectionReadiness:
      validateCodexConnectionReadiness(input),
    workOrders:
      Array.isArray(input.sourceWorkOrders)
        ? input.sourceWorkOrders.map(workOrder => ({
          ...workOrder,
          filesToModify:
            [...workOrder.filesToModify],
          testsToRun:
            [...workOrder.testsToRun],
        }))
        : [],
    mode:
      "LOCAL_DRY_RUN_CODEX_GATE_ONLY",
  }
}

export function sanitizeCodexExecutionPayload(text: string) {
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
    ["auth", "orization code"].join("")
  const bearerPattern =
    ["bearer", " token"].join("")
  const envPattern =
    ["\\.e", "nv"].join("")

  const sensitivePatterns = [
    {
      label:
        "API_KEY_PREFIX",
      pattern:
        new RegExp(["s", "k-"].join("") + "[A-Za-z0-9_-]+", "g"),
    },
    {
      label:
        "SUPABASE_SECRET",
      pattern:
        new RegExp(`${sbSecretPattern}[A-Za-z0-9_-]*`, "gi"),
    },
    {
      label:
        "ACCESS_TOKEN",
      pattern:
        new RegExp(`${accessTokenPattern}\\s*[:=]\\s*[A-Za-z0-9._-]+`, "gi"),
    },
    {
      label:
        "REFRESH_TOKEN",
      pattern:
        new RegExp(`${refreshTokenPattern}\\s*[:=]\\s*[A-Za-z0-9._-]+`, "gi"),
    },
    {
      label:
        "CLIENT_SECRET",
      pattern:
        new RegExp(`${clientSecretPattern}\\s*[:=]\\s*[A-Za-z0-9._-]+`, "gi"),
    },
    {
      label:
        "OPENAI_KEY",
      pattern:
        new RegExp(`${openAiKeyPattern}\\s*[:=]\\s*[A-Za-z0-9._-]+`, "g"),
    },
    {
      label:
        "CODEX_KEY",
      pattern:
        new RegExp(`${codexKeyPattern}\\s*[:=]\\s*[A-Za-z0-9._-]+`, "g"),
    },
    {
      label:
        "AUTHORIZATION_CODE",
      pattern:
        new RegExp(`${authCodePattern}\\s*[:=]\\s*[A-Za-z0-9._-]+`, "gi"),
    },
    {
      label:
        "BEARER_TOKEN",
      pattern:
        new RegExp(`${bearerPattern}\\s*[:=]\\s*[A-Za-z0-9._-]+`, "gi"),
    },
    {
      label:
        "ENV_CONTENT",
      pattern:
        new RegExp(`${envPattern}\\s+[A-Z0-9_]+\\s*=\\s*[^\\s]+`, "gi"),
    },
    {
      label:
        "LONG_TOKEN",
      pattern:
        /\b(?=[A-Za-z0-9]{40,}\b)(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9]{40,}\b/g,
    },
  ]

  let sanitizedText =
    text
  let redactionCount =
    0
  const blockedPatterns =
    new Set<string>()

  for (const sensitivePattern of sensitivePatterns) {
    sanitizedText =
      sanitizedText.replace(
        sensitivePattern.pattern,
        () => {
          redactionCount += 1
          blockedPatterns.add(sensitivePattern.label)
          return "[REDACTED_SECRET]"
        },
      )
  }

  return {
    sanitizedText,
    secretsDetected:
      redactionCount > 0,
    redactionCount,
    blockedPatterns:
      [...blockedPatterns],
  }
}

export function buildCodexWorkOrderExecutionPlan(
  workOrder: SourceWorkOrder,
  connectionReadiness = validateCodexConnectionReadiness(),
) {
  const riskLevel =
    normalizeRiskLevel(workOrder.riskLevel)
  const sanitizedPrompt =
    sanitizeCodexExecutionPayload(workOrder.promptPreview)
  const blockedReasons =
    [...connectionReadiness.blockedReasons]
  const warnings =
    []

  if (!workOrder.humanApprovalPresent) {
    blockedReasons.push("MISSING_HUMAN_APPROVAL")
  }

  if (sanitizedPrompt.secretsDetected) {
    blockedReasons.push("SECRET_PATTERN_DETECTED")
  }

  if (riskLevel === "HIGH") {
    blockedReasons.push("HIGH_RISK_WORK_ORDER_REQUIRES_REVISION")
  }

  if (
    workOrder.proposedBranch === "main" ||
    workOrder.proposedBranch.startsWith("main/") ||
    workOrder.proposedBranch.includes("production")
  ) {
    blockedReasons.push("PRODUCTION_OR_MAIN_RISK")
  }

  if (riskLevel === "MEDIUM") {
    warnings.push("MEDIUM_RISK_REQUIRES_HUMAN_REVIEW")
  }

  return {
    workOrderKey:
      workOrder.workOrderKey,
    improvementKey:
      workOrder.improvementKey,
    objective:
      workOrder.objective,
    proposedBranch:
      workOrder.proposedBranch,
    filesToModify:
      [...workOrder.filesToModify],
    testsToRun:
      [...workOrder.testsToRun],
    promptPreview:
      workOrder.promptPreview,
    sanitizedPromptPreview:
      sanitizedPrompt.sanitizedText,
    secretsDetected:
      sanitizedPrompt.secretsDetected,
    redactionCount:
      sanitizedPrompt.redactionCount,
    blockedPatterns:
      sanitizedPrompt.blockedPatterns,
    riskLevel,
    humanApprovalRequired:
      true,
    humanApprovalPresent:
      workOrder.humanApprovalPresent === true,
    canExecuteDryRun:
      blockedReasons.length === 0,
    canCallCodexApi:
      false,
    canCreateBranch:
      false,
    canCreatePr:
      false,
    canMerge:
      false,
    canTouchProduction:
      false,
    canTouchMain:
      false,
    blockedReasons,
    warnings,
    prohibitedActions:
      [...prohibitedActions],
    nextRecommendedAction:
      blockedReasons.length === 0
        ? "READY_FOR_FUTURE_CODEX_API_GATE"
        : "NEEDS_WORK_ORDER_REVISION",
  }
}

export function buildCodexSafetyAssessment(
  plan: ReturnType<typeof buildCodexWorkOrderExecutionPlan>,
) {
  const riskPenalty =
    plan.riskLevel === "HIGH"
      ? 45
      : plan.riskLevel === "MEDIUM"
        ? 20
        : 6
  const blockerPenalty =
    plan.blockedReasons.length * 18
  const secretPenalty =
    plan.secretsDetected
      ? 35
      : 0
  const approvalPenalty =
    plan.humanApprovalPresent
      ? 0
      : 35

  return {
    safetyScore:
      clampScore(100 - riskPenalty - blockerPenalty - secretPenalty - approvalPenalty),
    isSafeForDryRunPreview:
      plan.canExecuteDryRun,
    unsafePromptBlocked:
      plan.secretsDetected,
    blockedReasons:
      [...plan.blockedReasons],
    warnings:
      [...plan.warnings],
  }
}

export function buildCodexExecutionDecision(
  plan: ReturnType<typeof buildCodexWorkOrderExecutionPlan>,
) {
  if (plan.blockedReasons.includes("SECRET_PATTERN_DETECTED")) {
    return "BLOCKED_SECRET_DETECTED"
  }

  if (plan.blockedReasons.includes("MISSING_HUMAN_APPROVAL")) {
    return "BLOCKED_MISSING_HUMAN_APPROVAL"
  }

  if (plan.blockedReasons.includes("HIGH_RISK_WORK_ORDER_REQUIRES_REVISION")) {
    return "BLOCKED_HIGH_RISK"
  }

  if (plan.blockedReasons.includes("PRODUCTION_OR_MAIN_RISK")) {
    return "BLOCKED_PRODUCTION_OR_MAIN_RISK"
  }

  if (plan.canExecuteDryRun) {
    return "APPROVED_FOR_LOCAL_DRY_RUN_PREVIEW"
  }

  return "BLOCKED_REAL_CODEX_API_DISABLED"
}

export function buildCodexDryRunExecutionPreview(
  plan: ReturnType<typeof buildCodexWorkOrderExecutionPlan>,
) {
  return {
    previewOnly:
      true,
    simulatedPayload:
      {
        objective:
          plan.objective,
        branch:
          plan.proposedBranch,
        files:
          [...plan.filesToModify],
        tests:
          [...plan.testsToRun],
        prompt:
          plan.sanitizedPromptPreview,
      },
    wouldCallCodexApi:
      false,
    wouldCreateBranch:
      false,
    wouldCreatePr:
      false,
    wouldMerge:
      false,
    wouldTouchProduction:
      false,
    wouldTouchMain:
      false,
  }
}

export function blockUnsafeCodexExecution(
  plan: ReturnType<typeof buildCodexWorkOrderExecutionPlan>,
) {
  return {
    blocked:
      !plan.canExecuteDryRun || plan.secretsDetected,
    blockedReasons:
      [...plan.blockedReasons],
    canCallCodexApi:
      false,
    canExecuteCodeChange:
      false,
    canCreateBranch:
      false,
    canCreatePr:
      false,
    canMerge:
      false,
  }
}

export function buildCodexSafeExecutionGateReport(
  workOrder: SourceWorkOrder,
  connectionReadiness = validateCodexConnectionReadiness(),
) {
  const executionPlan =
    buildCodexWorkOrderExecutionPlan(
      workOrder,
      connectionReadiness,
    )
  const safetyAssessment =
    buildCodexSafetyAssessment(executionPlan)
  const executionDecision =
    buildCodexExecutionDecision(executionPlan)

  return {
    executionPlan,
    safetyAssessment,
    executionDecision,
    dryRunPreview:
      buildCodexDryRunExecutionPreview(executionPlan),
    unsafeExecutionBlock:
      blockUnsafeCodexExecution(executionPlan),
  }
}

export function buildCodexSafeExecutionGateQueue(input: GateInput = {}) {
  const gateInput =
    buildCodexExecutionGateInput(input)

  return gateInput.workOrders.map(workOrder =>
    buildCodexSafeExecutionGateReport(
      workOrder,
      gateInput.connectionReadiness,
    ),
  )
}

export function summarizeCodexSafeExecutionGateQueue(
  queue = buildCodexSafeExecutionGateQueue(),
  input: GateInput & {
    nextLoop?: string
    futureLoop?: string
  } = {},
) {
  const plans =
    queue.map(item => item.executionPlan)
  const decisions =
    queue.map(item => item.executionDecision)

  return {
    codexGateBuilt:
      true,
    workOrdersEvaluated:
      plans.length,
    executionPlansBuilt:
      plans.length,
    approvedForDryRunPreview:
      decisions.filter(decision => decision === "APPROVED_FOR_LOCAL_DRY_RUN_PREVIEW").length,
    blockedMissingHumanApproval:
      decisions.filter(decision => decision === "BLOCKED_MISSING_HUMAN_APPROVAL").length,
    blockedSecretDetected:
      decisions.filter(decision => decision === "BLOCKED_SECRET_DETECTED").length,
    blockedHighRisk:
      decisions.filter(decision => decision === "BLOCKED_HIGH_RISK").length,
    blockedProductionOrMainRisk:
      decisions.filter(decision => decision === "BLOCKED_PRODUCTION_OR_MAIN_RISK").length,
    readyForFutureCodexApiGate:
      plans.filter(plan => plan.nextRecommendedAction === "READY_FOR_FUTURE_CODEX_API_GATE").length,
    promptsSanitized:
      plans.every(plan => typeof plan.sanitizedPromptPreview === "string"),
    secretsDetected:
      plans.some(plan => plan.secretsDetected),
    redactionCount:
      plans.reduce(
        (total, plan) => total + plan.redactionCount,
        0,
      ),
    humanApprovalRequired:
      plans.every(plan => plan.humanApprovalRequired),
    realCodexApiCallExecuted:
      false,
    openAiApiUsed:
      false,
    externalNetworkCallExecuted:
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
    tokenStored:
      false,
    uiRoute:
      "/admin/self-improvement/codex-gate",
    nextLoop:
      normalizeLoop(input.nextLoop, "149G"),
    futureLoop:
      normalizeLoop(input.futureLoop, "149CODEX-C"),
  }
}

export function getCodexApiSafeExecutionGateChecklist() {
  return [
    "Mantener Codex API desactivada en este loop.",
    "Mantener OpenAI API desactivada en este loop.",
    "Validar aprobacion humana antes de cualquier futura ejecucion.",
    "Sanitizar prompts y bloquear secretos antes de cualquier envio futuro.",
    "Bloquear Production, main, branch automation, PR automation y merge automation.",
    "Construir solo previews locales de ejecucion.",
    "Reportar dry-run y mantener git status limpio.",
  ]
}
