const RESULT_VERSION =
  "IMAGE_GENERATION_DRY_RUN_RESULT_SCHEMA_V1"

const PROMPT_PLAN_VERSION =
  "IMAGE_GENERATION_PROMPT_PLAN_SCHEMA_V1"

const DEFAULT_EVALUATED_AT =
  "1970-01-01T00:00:00.000Z"

const TRUST_SIGNAL_LABELS = {
  freeShipping:
    "Free Shipping",
  shipsFromUsa:
    "Ships from USA",
  inStockInUsa:
    "In Stock in USA",
  usaFlag:
    "USA flag",
}

const PROHIBITED_FIELD_NAMES = new Set([
  "finalprompt",
  "productionprompt",
  "openaipayload",
  "apikey",
  "authorization",
  "token",
  "secret",
  "password",
  "base64image",
  "imageurl",
  "draftid",
  "listingid",
  "publishedlistingid",
])

const SAFE_OUTPUT_REQUIREMENTS = {
  intendedUse:
    "internal_review_only",
  mayGenerateImage:
    false,
  mayCallOpenAi:
    false,
  mayCreateRealDraft:
    false,
  mayPublish:
    false,
  mayMutateListing:
    false,
  requiresImageQaBeforeUse:
    true,
  requiresHumanReview:
    true,
}

const SAFE_SAFETY_FLAGS = {
  advisoryOnly:
    true,
  dryRunOnly:
    true,
  openAiApiUsed:
    false,
  imageGenerated:
    false,
  externalCallsMade:
    false,
  ebayApiUsed:
    false,
  realDraftCreated:
    false,
  publishedToEbay:
    false,
  listingMutated:
    false,
  reportPersisted:
    false,
  humanReviewRequired:
    true,
}

export function runImageGenerationDryRun(
  promptPlan,
  options = {}
) {
  const safePromptPlan =
    isRecord(promptPlan)
      ? promptPlan
      : {}

  const prohibitedFieldFindings =
    findProhibitedFieldsAndValues(
      safePromptPlan
    )

  const trustSignalEvaluation =
    buildTrustSignalEvaluation(
      safePromptPlan.trustSignals
    )

  const promptSafetyEvaluation =
    buildPromptSafetyEvaluation(
      safePromptPlan,
      prohibitedFieldFindings,
      trustSignalEvaluation
    )

  const missingData =
    buildMissingData(
      safePromptPlan,
      trustSignalEvaluation
    )

  const blockingReasons =
    buildBlockingReasons(
      safePromptPlan,
      prohibitedFieldFindings,
      promptSafetyEvaluation,
      trustSignalEvaluation
    )

  const decision =
    decideDryRunState(
      prohibitedFieldFindings,
      blockingReasons,
      missingData
    )

  return {
    resultVersion:
      RESULT_VERSION,
    caseId:
      stringOrFallback(
        safePromptPlan.caseId,
        "UNKNOWN-CASE"
      ),
    candidateName:
      stringOrFallback(
        safePromptPlan.candidateName,
        "Unnamed image generation prompt plan"
      ),
    evaluatedAt:
      stringOrFallback(
        options.evaluatedAt,
        stringOrFallback(
          safePromptPlan.generatedAt,
          DEFAULT_EVALUATED_AT
        )
      ),
    sourcePromptPlanVersion:
      PROMPT_PLAN_VERSION,
    imageRole:
      stringOrFallback(
        safePromptPlan.imageRole,
        "lifestyle_product_in_use"
      ),
    targetBuyer:
      "us_ebay_buyer",
    language:
      "en",
    dryRunStatus:
      decision.dryRunStatus,
    recommendedNextState:
      decision.recommendedNextState,
    decisionSummary:
      buildDecisionSummary(
        decision.dryRunStatus
      ),
    blockingReasons,
    missingData,
    verifiedFactsUsed:
      buildVerifiedFactsUsed(
        safePromptPlan
      ),
    unverifiedFacts:
      buildUnverifiedFacts(
        safePromptPlan,
        missingData,
        trustSignalEvaluation
      ),
    trustSignalEvaluation,
    promptSafetyEvaluation,
    humanReviewRequirements:
      buildHumanReviewRequirements(
        missingData,
        decision.dryRunStatus
      ),
    outputRequirements: {
      ...SAFE_OUTPUT_REQUIREMENTS,
    },
    safetyFlags: {
      ...SAFE_SAFETY_FLAGS,
    },
  }
}

function findProhibitedFieldsAndValues(value) {
  const findings = []

  collectProhibitedFindings(
    value,
    [],
    findings
  )

  return findings
}

function collectProhibitedFindings(
  value,
  path,
  findings
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectProhibitedFindings(
        item,
        [
          ...path,
          String(index),
        ],
        findings
      )
    })
    return
  }

  if (isRecord(value)) {
    for (const [
      key,
      childValue,
    ] of Object.entries(value)) {
      const normalizedKey =
        key.toLowerCase()

      if (
        PROHIBITED_FIELD_NAMES.has(
          normalizedKey
        )
      ) {
        findings.push({
          type:
            "prohibited_field",
          field:
            key,
          path:
            [
              ...path,
              key,
            ].join("."),
        })
      }

      collectProhibitedFindings(
        childValue,
        [
          ...path,
          key,
        ],
        findings
      )
    }
    return
  }

  if (
    typeof value === "string" &&
    /https?:\/\//i.test(value)
  ) {
    findings.push({
      type:
        "real_url_value",
      field:
        path[path.length - 1] || "value",
      path:
        path.join("."),
    })
  }
}

function buildTrustSignalEvaluation(trustSignals) {
  return Object.fromEntries(
    Object.entries(TRUST_SIGNAL_LABELS).map(([
      signalName,
      label,
    ]) => {
      const signal =
        isRecord(trustSignals)
          ? trustSignals[signalName]
          : null

      return [
        signalName,
        evaluateTrustSignal(
          signal,
          label
        ),
      ]
    })
  )
}

function evaluateTrustSignal(
  signal,
  label
) {
  const signalRecord =
    isRecord(signal)
      ? signal
      : {}

  const allowed =
    signalRecord.allowed === true

  const verified =
    signalRecord.verified === true

  const requested =
    allowed ||
    verified ||
    signalRecord.requested === true ||
    typeof signalRecord.claimText === "string" ||
    typeof signalRecord.label === "string" ||
    typeof signalRecord.purpose === "string"

  if (
    allowed &&
    verified
  ) {
    return {
      requested,
      allowed,
      verified,
      decision:
        "allowed",
      reason:
        `${label} is allowed only because it is verified.`,
    }
  }

  if (
    requested ||
    Object.keys(signalRecord).length > 0
  ) {
    return {
      requested,
      allowed:
        false,
      verified,
      decision:
        "needs_data",
      reason:
        `${label} is not verified and must not be used in a final prompt.`,
    }
  }

  return {
    requested:
      false,
    allowed:
      false,
    verified:
      false,
    decision:
      "not_requested",
    reason:
      `${label} was not requested.`,
  }
}

function buildPromptSafetyEvaluation(
  promptPlan,
  prohibitedFieldFindings,
  trustSignalEvaluation
) {
  const text =
    collectStringValues(promptPlan)
      .join(" ")
      .toLowerCase()

  const hasProhibitedField = fieldName =>
    prohibitedFieldFindings.some(
      finding =>
        finding.type === "prohibited_field" &&
        finding.field.toLowerCase() ===
          fieldName.toLowerCase()
    )

  return {
    promptPlanBasedOnVerifiedFacts:
      promptPlan.productFacts?.factsVerified === true,
    containsFinalProductionPrompt:
      hasProhibitedField("finalPrompt") ||
      hasProhibitedField("productionPrompt"),
    containsOpenAiPayload:
      hasProhibitedField("openAiPayload"),
    containsApiKeyOrSecret:
      [
        "apiKey",
        "authorization",
        "token",
        "secret",
        "password",
      ].some(hasProhibitedField),
    containsBase64Image:
      hasProhibitedField("base64Image"),
    containsRealImageUrl:
      hasProhibitedField("imageUrl") ||
      prohibitedFieldFindings.some(
        finding =>
          finding.type === "real_url_value"
      ),
    containsUnauthorizedBrandOrLogo:
      /unauthorized (brand|logo) requested|brand\/logo requested/.test(text),
    containsMedicalClaim:
      /medical claim requested|cures|heals|treats|medical benefit claim/.test(text),
    containsGuaranteedResultClaim:
      /guaranteed result claim requested|guaranteed outcome requested|guaranteed results requested/.test(text),
    containsUnverifiedTrustSignal:
      Object.values(trustSignalEvaluation).some(
        signal =>
          signal.verified === false &&
          signal.decision !== "not_requested"
      ),
    containsUnverifiedDimensions:
      !hasVerifiedDimensions(promptPlan),
    containsUnverifiedMaterial:
      !hasVerifiedMaterial(promptPlan),
    containsPersonOrModel:
      promptPlan.imageRole === "lifestyle_product_in_use",
    requiresModelRelease:
      promptPlan.imageRole === "lifestyle_product_in_use",
    safeForInternalReviewOnly:
      true,
  }
}

function buildMissingData(
  promptPlan,
  trustSignalEvaluation
) {
  const missingData = []

  if (!hasVerifiedDimensions(promptPlan)) {
    missingData.push(
      "verified dimensions required"
    )
  }

  if (!hasVerifiedMaterial(promptPlan)) {
    missingData.push(
      "verified material required"
    )
  }

  for (const [
    signalName,
    signal,
  ] of Object.entries(trustSignalEvaluation)) {
    if (
      signal.verified === false &&
      signal.decision !== "not_requested"
    ) {
      missingData.push(
        trustSignalMissingDataText(
          signalName
        )
      )
    }
  }

  if (promptPlan.imageRole === "lifestyle_product_in_use") {
    missingData.push(
      "model/image authorization review required"
    )
  }

  return uniqueStrings(missingData)
}

function buildBlockingReasons(
  promptPlan,
  prohibitedFieldFindings,
  promptSafetyEvaluation,
  trustSignalEvaluation
) {
  const blockingReasons = []

  for (const finding of prohibitedFieldFindings) {
    if (finding.type === "prohibited_field") {
      blockingReasons.push(
        `prohibited field detected: ${finding.field}`
      )
    }

    if (finding.type === "real_url_value") {
      blockingReasons.push(
        "real URL is not allowed in dry run"
      )
    }
  }

  for (const [
    signalName,
    signal,
  ] of Object.entries(trustSignalEvaluation)) {
    if (
      signal.decision === "needs_data" &&
      signal.requested === true &&
      promptPlan.trustSignals?.[signalName]?.allowed === true
    ) {
      blockingReasons.push(
        `unverified ${TRUST_SIGNAL_LABELS[signalName]} cannot be used`
      )
    }
  }

  if (promptSafetyEvaluation.containsUnauthorizedBrandOrLogo) {
    blockingReasons.push(
      "unauthorized brand/logo requested"
    )
  }

  if (promptSafetyEvaluation.containsMedicalClaim) {
    blockingReasons.push(
      "medical claim requested"
    )
  }

  if (promptSafetyEvaluation.containsGuaranteedResultClaim) {
    blockingReasons.push(
      "guaranteed result claim requested"
    )
  }

  return uniqueStrings(blockingReasons)
}

function decideDryRunState(
  prohibitedFieldFindings,
  blockingReasons,
  missingData
) {
  if (prohibitedFieldFindings.length > 0) {
    return {
      dryRunStatus:
        "DRY_RUN_REJECTED",
      recommendedNextState:
        "BLOCK_IMAGE_GENERATION",
    }
  }

  if (blockingReasons.length > 0) {
    return {
      dryRunStatus:
        "DRY_RUN_BLOCKED",
      recommendedNextState:
        blockingReasons.some(reason =>
          /trust/i.test(reason)
        )
          ? "REQUEST_TRUST_SIGNAL_VERIFICATION"
          : "BLOCK_IMAGE_GENERATION",
    }
  }

  if (missingData.length > 0) {
    return {
      dryRunStatus:
        "DRY_RUN_NEEDS_DATA",
      recommendedNextState:
        missingData.some(missing =>
          /model\/image authorization/i.test(missing)
        ) &&
        missingData.length === 1
          ? "REQUEST_MODEL_OR_IMAGE_AUTHORIZATION"
          : "REQUEST_MORE_PRODUCT_DATA",
    }
  }

  return {
    dryRunStatus:
      "DRY_RUN_READY_FOR_HUMAN_REVIEW",
    recommendedNextState:
      "READY_FOR_PROMPT_HUMAN_REVIEW",
  }
}

function buildDecisionSummary(dryRunStatus) {
  if (dryRunStatus === "DRY_RUN_REJECTED") {
    return "The PromptPlan was rejected because it contains fields or values that are not allowed in a dry run."
  }

  if (dryRunStatus === "DRY_RUN_BLOCKED") {
    return "Image generation is blocked because the PromptPlan contains a safety issue that must be resolved first."
  }

  if (dryRunStatus === "DRY_RUN_NEEDS_DATA") {
    return "Image generation cannot proceed yet because critical product data, trust signal verification, or human authorization review is still required."
  }

  return "The PromptPlan is ready for human review, but the dry run still does not generate images or call external services."
}

function buildVerifiedFactsUsed(promptPlan) {
  return [
    promptPlan.caseId &&
      `caseId ${promptPlan.caseId}`,
    promptPlan.imageRole &&
      `imageRole ${promptPlan.imageRole}`,
    "targetBuyer us_ebay_buyer",
    "language en",
    "intendedUse internal_review_only",
  ].filter(Boolean)
}

function buildUnverifiedFacts(
  promptPlan,
  missingData,
  trustSignalEvaluation
) {
  const unverifiedFacts =
    missingData.map(missing =>
      missing
        .replace(" required", "")
        .replace(" verification", "")
        .replace(" review", "")
    )

  if (promptPlan.productFacts?.factsVerified !== true) {
    unverifiedFacts.push(
      "product facts"
    )
  }

  for (const [
    signalName,
    signal,
  ] of Object.entries(trustSignalEvaluation)) {
    if (
      signal.verified === false &&
      signal.decision !== "not_requested"
    ) {
      unverifiedFacts.push(
        TRUST_SIGNAL_LABELS[signalName]
      )
    }
  }

  return uniqueStrings(unverifiedFacts)
}

function buildHumanReviewRequirements(
  missingData,
  dryRunStatus
) {
  const requirements =
    missingData.map(missing =>
      `Resolve ${missing} before any future image generation.`
    )

  if (dryRunStatus === "DRY_RUN_REJECTED") {
    requirements.push(
      "Remove prohibited dry run fields or values before retrying."
    )
  }

  if (dryRunStatus === "DRY_RUN_BLOCKED") {
    requirements.push(
      "Resolve blocked safety issues before any future image generation."
    )
  }

  requirements.push(
    "Keep the result in internal human review before any future OpenAI image generation."
  )

  return uniqueStrings(requirements)
}

function hasVerifiedDimensions(promptPlan) {
  const dimensions =
    promptPlan.productFacts?.dimensions

  return (
    isRecord(dimensions) &&
    dimensions.verified === true
  )
}

function hasVerifiedMaterial(promptPlan) {
  const productFacts =
    promptPlan.productFacts

  if (!isRecord(productFacts)) {
    return false
  }

  if (productFacts.materialVerified === true) {
    return true
  }

  return (
    typeof productFacts.material === "string" &&
    productFacts.material.trim().length > 0 &&
    !/not[_ -]?verified|unknown|tbd/i.test(productFacts.material)
  )
}

function trustSignalMissingDataText(signalName) {
  if (signalName === "freeShipping") {
    return "free shipping verification required"
  }

  if (signalName === "shipsFromUsa") {
    return "ships from USA verification required"
  }

  if (signalName === "inStockInUsa") {
    return "in stock in USA verification required"
  }

  return "USA flag verification required"
}

function collectStringValues(value, values = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(
        item,
        values
      )
    }
    return values
  }

  if (isRecord(value)) {
    for (const childValue of Object.values(value)) {
      collectStringValues(
        childValue,
        values
      )
    }
    return values
  }

  if (typeof value === "string") {
    values.push(value)
  }

  return values
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
}

function stringOrFallback(value, fallback) {
  return (
    typeof value === "string" &&
    value.length > 0
  )
    ? value
    : fallback
}

function uniqueStrings(values) {
  return [
    ...new Set(
      values.filter(value =>
        typeof value === "string" &&
        value.length > 0
      )
    ),
  ]
}
