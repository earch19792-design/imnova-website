import { createHash } from "node:crypto"

export const FINAL_BATCH_PLAN_VERSION =
  "REFERENCE_GUIDED_FINAL_POSITIONS_2_6_V1_2026_07_22"
export const FINAL_BATCH_STATUS = "AWAITING_HUMAN_BATCH_AUTHORIZATION"
export const FINAL_BATCH_MAX_CONCURRENCY = 2
export const FINAL_BATCH_AUTOMATIC_RETRIES = false

type JsonRecord = Record<string, unknown>

export type PersistedFinalBatchJob = {
  position: number
  commercial_role: string
  prompt_hash: string
  allowed_product_facts: unknown[]
  allowed_generated_context: string[]
  prohibited_claims: string[]
}

const POSITION_DEFINITIONS = [
  { position: 2, assetRole: "SECONDARY_PACKAGE_CONTENTS",
    commercialObjective: "CONFIRMED_PACKAGE_CONTENTS",
    mode: "DETERMINISTIC", plannedProviderCalls: 0 },
  { position: 3, assetRole: "SECONDARY_SCALE_CAPACITY",
    commercialObjective: "SCALE_AND_CAPACITY_CONTEXT",
    mode: "PROVIDER", plannedProviderCalls: 1 },
  { position: 4, assetRole: "SECONDARY_USE_CONTEXT",
    commercialObjective: "PRIMARY_BENEFIT_IN_ACTION",
    mode: "PROVIDER", plannedProviderCalls: 1 },
  { position: 5, assetRole: "SECONDARY_ASPIRATIONAL_LIFESTYLE",
    commercialObjective: "ASPIRATIONAL_LIFESTYLE",
    mode: "PROVIDER", plannedProviderCalls: 1 },
  { position: 6, assetRole: "SECONDARY_HUMAN_CONTEXT",
    commercialObjective: "REAL_HUMAN_USE",
    mode: "PROVIDER", plannedProviderCalls: 1 },
] as const

const COMMON_PROHIBITED = [
  "No text, captions, measurements, badges, watermarks, or new logos.",
  "No invented dimensions, shipping weight, package dimensions, capacity, accessories, included food, or package contents.",
  "No invented product parts, geometry, handles, rim, base, perforations, coating, color, proportions, or hidden surfaces.",
  "No performance, drainage speed, durability, strength, heat resistance, ergonomics, health, safety, or professional-use claims.",
  "No competitor imagery and no reference other than the authorized protected MAIN and SIDE sources declared for the position.",
  "Research and category signals may guide only framing, environment, lighting, and commercial strategy; they are never product facts or benefits.",
]

const HUMAN_QA: Record<number, string[]> = {
  2: [
    "Confirm exactly one product unit is visible and the SIDE angle is materially distinct from PRIMARY_MAIN.",
    "Confirm the complete product is unclipped and no box, manual, food, utensils, accessories, props, or text appear.",
    "Confirm handles, rim, base, perforations, white enamel, and proportions match the protected SIDE source.",
  ],
  3: [
    "Confirm the scale/capacity composition communicates only the exact canonical 1.5-quart fact without invented measurements.",
    "Confirm any food or kitchen object is plainly scene context, not included contents or performance evidence.",
    "Confirm identity-critical form, handles, rim, base, perforations, white enamel, and proportions remain faithful.",
  ],
  4: [
    "Confirm the ordinary-use scene does not imply drainage speed, strength, durability, ergonomics, or another performance benefit.",
    "Confirm hands, water, food, and props are context only and do not obscure identity-critical features.",
    "Confirm exact product identity and proportions against both protected references.",
  ],
  5: [
    "Confirm the aspirational setting is commercially distinct and all food/props remain non-included context.",
    "Confirm no premium-performance, professional endorsement, health, or lifestyle benefit is implied.",
    "Confirm exact product identity and proportions against both protected references.",
  ],
  6: [
    "Confirm human interaction is natural, does not obscure identity-critical features, and makes no comfort, safety, speed, or performance claim.",
    "Confirm nearby food and kitchen objects are context only and are not included with the offer.",
    "Confirm exact product identity and proportions against both protected references.",
  ],
}

function sha256ExactUtf8(value: string) {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex")
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function exactPrompt(input: {
  attemptId: string
  revisionId: string
  position: number
  assetRole: string
  commercialObjective: string
  mode: string
  authorizedSources: Array<{ sourceImageId: string; sha256: string }>
  canonicalFacts: unknown[]
  researchGuidanceOnly: string[]
  prohibited: string[]
}) {
  const execution = input.mode === "DETERMINISTIC"
    ? "Use the protected SIDE pixels only. Produce a deterministic crop/contain/translation composition on #FFFFFF. Show exactly one complete unit from the SIDE angle, distinct from PRIMARY_MAIN, with safe margins. Do not call a provider and do not reconstruct product pixels generatively."
    : "Make at most one provider request for this position, with MAIN first and SIDE second. No automatic retry. Generate only compatible surrounding context; the product identity is locked to the protected references."
  return [
    "FINAL VISUAL ASSET PLAN",
    `PLAN_TEMPLATE_VERSION=${FINAL_BATCH_PLAN_VERSION}`,
    `ATTEMPT_ID=${input.attemptId}`,
    `REVISION_ID=${input.revisionId}`,
    `POSITION=${input.position}`,
    `ASSET_ROLE=${input.assetRole}`,
    `COMMERCIAL_OBJECTIVE=${input.commercialObjective}`,
    `MODE=${input.mode}`,
    "CONTRACT=REFERENCE_GUIDED_PRODUCT_GENERATION_V1",
    `AUTHORIZED_REFERENCES_JSON=${JSON.stringify(input.authorizedSources)}`,
    `CANONICAL_PRODUCT_FACTS_JSON=${JSON.stringify(input.canonicalFacts)}`,
    `RESEARCH_GUIDANCE_ONLY_JSON=${JSON.stringify(input.researchGuidanceOnly)}`,
    "RESEARCH_SCOPE=Research and Market Visual Brief guidance may affect only framing, environment, illumination, and commercial strategy. It must not become a product feature, included item, measurement, or benefit.",
    "IDENTITY_LOCK=Preserve exactly the product form, two handles, metal rim, pedestal base, perforation pattern, white powder-coated enamel finish, and proportions visible in the authorized references.",
    `PROHIBITED_ELEMENTS_AND_CLAIMS_JSON=${JSON.stringify(input.prohibited)}`,
    `EXECUTION=${execution}`,
    "OUTPUT_CONSTRAINTS=One square 1600x1600 PNG; no text; no new logo; no invented product content; human visual approval required before any publication use.",
  ].join("\n")
}

export function buildReferenceGuidedFinalBatchPlan(input: {
  attemptId: string
  revisionId: string
  compositionManifestHash: string
  productDossierHash: string
  marketVisualBriefHash: string
  mainSourceHash: string
  sideSourceHash: string
  approvedPrimarySha256: string
  approvedMaterialDetailSha256: string
  jobs: PersistedFinalBatchJob[]
}) {
  if (!/^[0-9a-f-]{36}$/.test(input.attemptId) ||
    !/^[0-9a-f-]{36}$/.test(input.revisionId) ||
    !/^sha256:[0-9a-f]{64}$/.test(input.productDossierHash) ||
    ![input.compositionManifestHash, input.marketVisualBriefHash,
      input.mainSourceHash, input.sideSourceHash, input.approvedPrimarySha256,
      input.approvedMaterialDetailSha256].every((value) =>
      /^[0-9a-f]{64}$/.test(value)) || input.jobs.length !== 5) {
    throw new Error("FINAL_BATCH_PLAN_INPUT_INVALID")
  }
  const jobsByPosition = new Map(input.jobs.map((job) => [job.position, job]))
  const positions = POSITION_DEFINITIONS.map((definition) => {
    const persisted = jobsByPosition.get(definition.position)
    if (!persisted || persisted.commercial_role !==
      definition.commercialObjective || !Array.isArray(
      persisted.allowed_product_facts) || !Array.isArray(
      persisted.allowed_generated_context) || !Array.isArray(
      persisted.prohibited_claims)) {
      throw new Error("FINAL_BATCH_PLAN_JOB_BINDING_INVALID")
    }
    const authorizedSources = definition.mode === "DETERMINISTIC"
      ? [{ sourceImageId: "SIDE", sha256: input.sideSourceHash }]
      : [
        { sourceImageId: "MAIN", sha256: input.mainSourceHash },
        { sourceImageId: "SIDE", sha256: input.sideSourceHash },
      ]
    const prohibited = unique([
      ...persisted.prohibited_claims,
      ...COMMON_PROHIBITED,
      ...(definition.position === 2 ? [
        "No box, manual, food, utensils, accessories, props, duplicate unit, or text.",
        "Do not alter source pixels except deterministic scaling, crop, canvas placement, and PNG encoding.",
      ] : []),
    ])
    const exactPromptText = exactPrompt({
      attemptId: input.attemptId,
      revisionId: input.revisionId,
      position: definition.position,
      assetRole: definition.assetRole,
      commercialObjective: definition.commercialObjective,
      mode: definition.mode,
      authorizedSources,
      canonicalFacts: persisted.allowed_product_facts,
      researchGuidanceOnly: persisted.allowed_generated_context,
      prohibited,
    })
    const automaticQa = [
      "Verify exact UTF-8 prompt hash before execution.",
      "Verify a 1600x1600 PNG, no detected text, no new logo, and no competitor imagery.",
      "Verify the declared protected source hashes and identity-critical form, handles, rim, base, perforations, white enamel, and proportions.",
      definition.mode === "DETERMINISTIC"
        ? "Verify deterministic transform manifest, #FFFFFF background, exactly one foreground product, complete safe framing, and zero provider calls."
        : "Verify exactly one reserved provider call at most, no automatic retry, and references ordered MAIN then SIDE.",
    ]
    return {
      ...definition,
      canonicalFacts: persisted.allowed_product_facts,
      researchGuidanceOnly: persisted.allowed_generated_context,
      prohibitedElementsAndClaims: prohibited,
      exactPromptText,
      promptHash: sha256ExactUtf8(exactPromptText),
      priorJobPromptHash: persisted.prompt_hash,
      authorizedSources,
      automaticQa,
      humanQa: HUMAN_QA[definition.position],
    }
  })
  if (positions.reduce((sum, position) =>
    sum + position.plannedProviderCalls, 0) !== 4) {
    throw new Error("FINAL_BATCH_PLAN_PROVIDER_BUDGET_INVALID")
  }
  const plan = {
    version: FINAL_BATCH_PLAN_VERSION,
    status: FINAL_BATCH_STATUS,
    attemptId: input.attemptId,
    revisionId: input.revisionId,
    compositionManifestHash: input.compositionManifestHash,
    productDossierHash: input.productDossierHash,
    marketVisualBriefHash: input.marketVisualBriefHash,
    approvedAssets: {
      primaryMainSha256: input.approvedPrimarySha256,
      secondaryMaterialDetailSha256: input.approvedMaterialDetailSha256,
    },
    lifetimeProviderBudgetUsed: 2,
    lifetimeProviderBudgetMax: 6,
    lifetimeProviderBudgetRemaining: 4,
    plannedNewProviderCalls: 4,
    maxConcurrency: FINAL_BATCH_MAX_CONCURRENCY,
    automaticRetries: FINAL_BATCH_AUTOMATIC_RETRIES,
    positions,
  }
  const planText = JSON.stringify(plan)
  return { plan, planText, planHash: sha256ExactUtf8(planText) }
}
