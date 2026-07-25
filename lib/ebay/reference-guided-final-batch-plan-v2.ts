import { createHash } from "node:crypto"

import type { PersistedFinalBatchJob } from
  "./reference-guided-final-batch-plan.ts"

export const SUCCESSOR_BATCH_PLAN_VERSION =
  "REFERENCE_GUIDED_FINAL_POSITIONS_2_6_V2_2026_07_22"
export const SUCCESSOR_BATCH_PLAN_STATUS =
  "AWAITING_POSITION_2_DETERMINISTIC_EXECUTION_AUTHORIZATION"

const sha256 = (value: string) => createHash("sha256")
  .update(Buffer.from(value, "utf8")).digest("hex")

const COMMON_MUST_EXCLUDE = [
  "MUST NOT add text, captions, badges, measurements, watermarks, or new logos.",
  "MUST NOT invent dimensions, shipping weight, package dimensions, included accessories, included food, or product claims.",
  "MUST NOT alter product form, handles, metal rim, pedestal base, perforations, white enamel finish, or proportions.",
  "MUST NOT use competitor imagery or any product reference other than the declared protected MAIN and SIDE sources.",
]

const DISTINCTNESS_GATE = [
  "MUST reject position 3 if it resembles a lifestyle composition.",
  "MUST reject position 4 unless it visibly shows ordinary colander use.",
  "MUST reject position 5 unless it is a lifestyle composition without human interaction.",
  "MUST reject position 6 unless two human hands visibly hold both handles.",
  "MUST reject the batch if any two positions are essentially the same visual and semantic scene.",
]

const CONTRACTS = {
  2: {
    assetRole: "SECONDARY_PACKAGE_CONTENTS",
    commercialObjective: "CONFIRMED_PACKAGE_CONTENTS",
    mode: "DETERMINISTIC",
    phase: "PHASE_A_DETERMINISTIC_FIRST",
    plannedProviderCalls: 0,
    mustInclude: [
      "MUST show exactly one product unit.",
      "MUST use only the protected SIDE source.",
      "MUST use a pure #FFFFFF background.",
      "MUST show the complete product without clipping and with safe margins.",
      "MUST preserve the SIDE viewing angle so the composition is distinct from PRIMARY_MAIN.",
    ],
    mustExclude: [
      "MUST NOT show a box, manual, food, utensils, props, accessories, duplicate units, or text.",
      "MUST NOT call a provider or reconstruct product pixels generatively.",
    ],
    cameraAndFraming: [
      "MUST center the complete SIDE-view product on the square canvas with safe margins.",
      "MUST keep the SIDE angle visually distinct from the approved frontal PRIMARY_MAIN.",
    ],
    requiredProductVisibility: [
      "MUST keep the complete product, both handles, rim, perforations, body, and base visible.",
    ],
    contextualObjectsNotIncluded: [] as string[],
    researchGuidance: [
      "Environment orientation is limited to the pure-white studio canvas.",
      "Camera and lighting orientation must preserve the protected SIDE pixels and clean catalog presentation.",
    ],
    automaticChecks: [
      "MUST verify deterministic transform provenance from the protected SIDE hash.",
      "MUST verify 1600x1600 PNG, #FFFFFF background, exactly one foreground product, safe margins, no clipping, and no detected text.",
      "MUST verify zero provider calls, zero generated product pixels, and visual distinction from PRIMARY_MAIN.",
    ],
    humanChecks: [
      "MUST confirm exactly one complete unit, SIDE angle, safe margins, and no box, manual, food, utensils, props, accessories, or text.",
      "MUST confirm handles, rim, base, perforations, enamel, and proportions match SIDE.",
    ],
  },
  3: {
    assetRole: "SECONDARY_SCALE_CAPACITY",
    commercialObjective: "SCALE_AND_CAPACITY_CONTEXT",
    mode: "PROVIDER",
    phase: "BLOCKED_UNTIL_POSITION_5_HUMAN_APPROVAL",
    plannedProviderCalls: 1,
    mustInclude: [
      "MUST show the exact complete product, empty and dominant, on a clean counter.",
      "MUST place exactly one ordinary everyday scale reference beside the product, never inside it; a common lemon is preferred.",
      "MUST keep the comparison strictly non-metric.",
      "MUST communicate everyday scale without asserting measurements.",
    ],
    mustExclude: [
      "MUST NOT show hands or water.",
      "MUST NOT display or write any capacity value.",
      "MUST NOT infer or depict dimensions, rulers, scales, measurement marks, or package dimensions.",
      "MUST NOT imply the contextual scale object is included with the purchase.",
      "MUST NOT use a lifestyle composition.",
    ],
    cameraAndFraming: [
      "MUST use a clean counter, a dominant complete product, and one adjacent everyday object with clear separation.",
      "MUST frame the scene as a neutral scale comparison rather than editorial lifestyle imagery.",
    ],
    requiredProductVisibility: [
      "MUST keep the complete empty product, both handles, rim, perforations, body, and base recognizable.",
    ],
    contextualObjectsNotIncluded: [
      "MUST treat the single adjacent everyday scale object as scene context that is not included with the purchase.",
    ],
    researchGuidance: [
      "Environment orientation: clean kitchen counter.",
      "Camera orientation: dominant complete product with one clearly separated adjacent scale reference.",
      "Lighting orientation: neutral natural studio-kitchen light.",
    ],
    automaticChecks: [
      "MUST detect one complete empty product and exactly one adjacent everyday scale object outside the product.",
      "MUST detect no hands, water, text, capacity value, ruler, measurement marks, or lifestyle composition.",
      "MUST verify identity fidelity and DISTINCT_COMMERCIAL_COMPOSITION against positions 4, 5, and 6.",
    ],
    humanChecks: [
      "MUST confirm non-metric everyday scale, an empty product, one adjacent object, and no implied inclusion.",
      "MUST reject any lifestyle reading, measurement implication, hands, water, or identity drift.",
    ],
  },
  4: {
    assetRole: "SECONDARY_USE_CONTEXT",
    commercialObjective: "PRIMARY_BENEFIT_IN_ACTION",
    mode: "PROVIDER",
    phase: "BLOCKED_UNTIL_POSITION_5_HUMAN_APPROVAL",
    plannedProviderCalls: 1,
    mustInclude: [
      "MUST show the exact product in unmistakable ordinary colander use.",
      "MUST place a moderate quantity of generic fruit or vegetables inside the colander.",
      "MUST show gentle rinse water without dramatic splashing.",
      "MUST keep the complete product, handles, rim, perforations, and base recognizable.",
      "MUST explain use visually without demonstrating a performance claim.",
    ],
    mustExclude: [
      "MUST NOT include text.",
      "MUST NOT assert speed, performance, drainage efficiency, strength, durability, or another technical benefit.",
      "MUST NOT imply the food or water is included with the purchase.",
    ],
    cameraAndFraming: [
      "MUST frame the full product during an ordinary gentle rinse with the use action immediately understandable.",
      "MUST avoid dramatic action, excessive water, or framing that hides identity-critical features.",
    ],
    requiredProductVisibility: [
      "MUST keep the complete product, both handles, rim, perforations, body, and pedestal base recognizable during use.",
    ],
    contextualObjectsNotIncluded: [
      "MUST treat all fruit, vegetables, water, and kitchen surroundings as non-included scene context.",
    ],
    researchGuidance: [
      "Environment orientation: ordinary clean kitchen use setting.",
      "Camera orientation: immediately legible use while preserving complete product identity.",
      "Lighting orientation: natural, restrained, and non-dramatic.",
    ],
    automaticChecks: [
      "MUST detect moderate generic produce inside the product and gentle visible rinse water.",
      "MUST verify complete recognizable handles, rim, perforations, and base with no text or performance indicators.",
      "MUST verify DISTINCT_COMMERCIAL_COMPOSITION as ordinary use rather than scale, lifestyle, or human-holding context.",
    ],
    humanChecks: [
      "MUST confirm unmistakable ordinary colander use, moderate produce, gentle rinse water, and complete product visibility.",
      "MUST reject performance claims, dramatic splashing, implied inclusion, or identity drift.",
    ],
  },
  5: {
    assetRole: "SECONDARY_ASPIRATIONAL_LIFESTYLE",
    commercialObjective: "ASPIRATIONAL_LIFESTYLE",
    mode: "PROVIDER",
    phase: "PHASE_B_SINGLE_PROVIDER_VALIDATION_AFTER_POSITION_2_HUMAN_APPROVAL",
    plannedProviderCalls: 1,
    mustInclude: [
      "MUST show the exact empty product as the protagonist.",
      "MUST use a modern, bright, clean kitchen.",
      "MUST use soft natural light.",
      "MUST use a lightly blurred background.",
      "MUST keep props minimal and physically separated from the product.",
      "MUST create an editorial composition clearly distinct from positions 3, 4, and 6.",
      "MUST communicate desire and premium presentation without claims.",
    ],
    mustExclude: [
      "MUST NOT show hands, water, or food inside the product.",
      "MUST NOT imply professional endorsement, health outcomes, premium performance, or included props.",
      "MUST NOT show product interaction.",
    ],
    cameraAndFraming: [
      "MUST use editorial hero framing, soft natural light, and shallow background focus in a modern clean kitchen.",
      "MUST keep the empty product dominant and visually separate from minimal props.",
    ],
    requiredProductVisibility: [
      "MUST keep the empty product complete with both handles, rim, perforations, body, and base visible.",
    ],
    contextualObjectsNotIncluded: [
      "MUST treat every separated minimal prop and the kitchen environment as non-included scene context.",
    ],
    researchGuidance: [
      "Environment orientation: modern, bright, clean kitchen.",
      "Camera orientation: editorial protagonist framing with a lightly blurred background.",
      "Lighting orientation: soft natural light and restrained premium presentation.",
    ],
    automaticChecks: [
      "MUST detect an empty complete product, modern bright kitchen, soft natural light, and lightly blurred background.",
      "MUST detect no hands, water, food inside the product, interaction, text, or attached props.",
      "MUST verify DISTINCT_COMMERCIAL_COMPOSITION as lifestyle without interaction and distinct from positions 3, 4, and 6.",
    ],
    humanChecks: [
      "MUST confirm premium editorial desire, empty product, no interaction, minimal separated props, and exact identity.",
      "MUST reject use-context, scale-comparison, human-holding, included-prop, or performance readings.",
    ],
  },
  6: {
    assetRole: "SECONDARY_HUMAN_CONTEXT",
    commercialObjective: "REAL_HUMAN_USE",
    mode: "PROVIDER",
    phase: "BLOCKED_UNTIL_POSITION_5_HUMAN_APPROVAL",
    plannedProviderCalls: 1,
    mustInclude: [
      "MUST show two real human hands holding the two handles.",
      "MUST show the exact product empty, complete, and clearly visible.",
      "MUST use a natural kitchen scene.",
      "MUST keep hands free of conspicuous jewelry and prevent them from hiding the rim, perforations, or base.",
      "MUST communicate human scale and grip form without converting either into a benefit.",
    ],
    mustExclude: [
      "MUST NOT show water, food, or utensils inside the product.",
      "MUST NOT assert comfort, ergonomics, safety, ease, speed, or performance.",
      "MUST NOT let hands obscure identity-critical product features.",
    ],
    cameraAndFraming: [
      "MUST frame both hands, both handles, and the complete empty product naturally in a kitchen.",
      "MUST keep the rim, perforations, body, and base clearly visible between and below the hands.",
    ],
    requiredProductVisibility: [
      "MUST keep the complete empty product, both handles, rim, perforations, body, and base clearly visible.",
    ],
    contextualObjectsNotIncluded: [
      "MUST treat the hands and kitchen environment as non-included human-scale context.",
    ],
    researchGuidance: [
      "Environment orientation: natural ordinary kitchen scene.",
      "Camera orientation: human-scale framing that clearly shows both hands on both handles and the complete product.",
      "Lighting orientation: natural and documentary rather than aspirational editorial lighting.",
    ],
    automaticChecks: [
      "MUST detect exactly two hands holding the two handles and a complete empty product.",
      "MUST detect no water, food, utensils, conspicuous jewelry, text, or obscured rim, perforations, or base.",
      "MUST verify DISTINCT_COMMERCIAL_COMPOSITION as human context rather than scale, use, or no-interaction lifestyle.",
    ],
    humanChecks: [
      "MUST confirm two natural hands on both handles, complete empty product visibility, and human-scale communication only.",
      "MUST reject jewelry distraction, obscured features, contents, or comfort, ergonomics, safety, ease, or performance claims.",
    ],
  },
} as const

function visualFacts(position: number, facts: unknown[]) {
  if (position !== 3) return facts
  return facts.filter((value) => {
    const key = value && typeof value === "object" && !Array.isArray(value)
      ? String((value as Record<string, unknown>).key ?? "") : ""
    return key === "type"
  })
}

function exactPrompt(input: {
  attemptId: string
  revisionId: string
  position: number
  contract: typeof CONTRACTS[keyof typeof CONTRACTS]
  authorizedSources: Array<{ sourceImageId: string; sha256: string }>
  visualFacts: unknown[]
}) {
  const c = input.contract
  return [
    "FINAL VISUAL ASSET SUCCESSOR PLAN V2",
    `PLAN_TEMPLATE_VERSION=${SUCCESSOR_BATCH_PLAN_VERSION}`,
    `ATTEMPT_ID=${input.attemptId}`,
    `REVISION_ID=${input.revisionId}`,
    `POSITION=${input.position}`,
    `ASSET_ROLE=${c.assetRole}`,
    `COMMERCIAL_OBJECTIVE=${c.commercialObjective}`,
    `MODE=${c.mode}`,
    `EXECUTION_PHASE=${c.phase}`,
    "CONTRACT=REFERENCE_GUIDED_PRODUCT_GENERATION_V1",
    `AUTHORIZED_REFERENCES_JSON=${JSON.stringify(input.authorizedSources)}`,
    `VISUAL_PRODUCT_FACTS_JSON=${JSON.stringify(input.visualFacts)}`,
    `POSITION_MUST_INCLUDE_JSON=${JSON.stringify(c.mustInclude)}`,
    `POSITION_MUST_EXCLUDE_JSON=${JSON.stringify([...c.mustExclude, ...COMMON_MUST_EXCLUDE])}`,
    `CAMERA_AND_FRAMING_JSON=${JSON.stringify(c.cameraAndFraming)}`,
    `REQUIRED_PRODUCT_VISIBILITY_JSON=${JSON.stringify(c.requiredProductVisibility)}`,
    `CONTEXTUAL_OBJECTS_NOT_INCLUDED_JSON=${JSON.stringify(c.contextualObjectsNotIncluded)}`,
    `RESEARCH_GUIDANCE_ONLY_JSON=${JSON.stringify(c.researchGuidance)}`,
    "CONTRACT_PRIORITY=POSITION_MUST_INCLUDE MUST take priority over Market Visual Brief, research, category signals, and global creative direction.",
    "RESEARCH_SCOPE=Research MUST guide only environment, camera, illumination, and composition. Research MUST NOT become a product feature, fact, included item, measurement, or benefit.",
    "IDENTITY_LOCK=The output MUST preserve the exact protected product form, two handles, metal rim, pedestal base, perforation pattern, white enamel finish, and proportions.",
    `DISTINCT_COMMERCIAL_COMPOSITION_JSON=${JSON.stringify(DISTINCTNESS_GATE)}`,
    c.mode === "DETERMINISTIC"
      ? "EXECUTION=The later authorized execution MUST use deterministic protected SIDE pixels only and MUST make zero provider calls."
      : "EXECUTION=The later separately authorized execution MUST make at most one provider call for this position, MUST send MAIN first and SIDE second, and MUST NOT retry automatically.",
    "OUTPUT_CONSTRAINTS=The output MUST be one 1600x1600 PNG, MUST contain no added text or new logo, and MUST remain pending human review.",
  ].join("\n")
}

export function buildReferenceGuidedFinalBatchSuccessorV2(input: {
  attemptId: string
  revisionId: string
  predecessorPlanId: string
  predecessorPlanHash: string
  compositionManifestHash: string
  productDossierHash: string
  marketVisualBriefHash: string
  mainSourceHash: string
  sideSourceHash: string
  approvedPrimarySha256: string
  approvedMaterialDetailSha256: string
  jobs: PersistedFinalBatchJob[]
}) {
  const jobs = new Map(input.jobs.map((job) => [job.position, job]))
  const positions = ([2, 3, 4, 5, 6] as const).map((position) => {
    const job = jobs.get(position)
    const contract = CONTRACTS[position]
    if (!job || job.commercial_role !== contract.commercialObjective) {
      throw new Error("SUCCESSOR_BATCH_PLAN_JOB_BINDING_INVALID")
    }
    const authorizedSources = position === 2
      ? [{ sourceImageId: "SIDE", sha256: input.sideSourceHash }]
      : [{ sourceImageId: "MAIN", sha256: input.mainSourceHash },
        { sourceImageId: "SIDE", sha256: input.sideSourceHash }]
    const promptFacts = visualFacts(position, job.allowed_product_facts)
    const exactPromptText = exactPrompt({ attemptId: input.attemptId,
      revisionId: input.revisionId, position, contract, authorizedSources,
      visualFacts: promptFacts })
    if (/\bmay\b/i.test(exactPromptText) ||
      (position === 3 && /unitGrossWeight|454|1\.5 quart/i.test(exactPromptText))) {
      throw new Error("SUCCESSOR_BATCH_PLAN_OPTIONAL_OR_FORBIDDEN_PROMPT")
    }
    return {
      position,
      assetRole: contract.assetRole,
      commercialObjective: contract.commercialObjective,
      mode: contract.mode,
      executionPhase: contract.phase,
      plannedProviderCalls: contract.plannedProviderCalls,
      mustInclude: contract.mustInclude,
      mustExclude: [...contract.mustExclude, ...COMMON_MUST_EXCLUDE],
      cameraAndFraming: contract.cameraAndFraming,
      requiredProductVisibility: contract.requiredProductVisibility,
      contextualObjectsNotIncluded: contract.contextualObjectsNotIncluded,
      visualProductFacts: promptFacts,
      researchGuidanceOnly: contract.researchGuidance,
      exactPromptText,
      exactPromptHash: sha256(exactPromptText),
      authorizedSources,
      automaticChecks: contract.automaticChecks,
      humanChecks: contract.humanChecks,
      distinctCommercialComposition: DISTINCTNESS_GATE,
    }
  })
  const plan = {
    version: SUCCESSOR_BATCH_PLAN_VERSION,
    status: SUCCESSOR_BATCH_PLAN_STATUS,
    attemptId: input.attemptId,
    revisionId: input.revisionId,
    predecessorPlanId: input.predecessorPlanId,
    predecessorPlanHash: input.predecessorPlanHash,
    compositionManifestHash: input.compositionManifestHash,
    productDossierHash: input.productDossierHash,
    marketVisualBriefHash: input.marketVisualBriefHash,
    approvedAssets: { primaryMainSha256: input.approvedPrimarySha256,
      secondaryMaterialDetailSha256: input.approvedMaterialDetailSha256 },
    lifetimeProviderBudgetUsed: 2,
    lifetimeProviderBudgetMax: 6,
    lifetimeProviderBudgetRemaining: 4,
    plannedProviderCalls: 4,
    maxConcurrency: 2,
    automaticRetries: false,
    executionSequence: [
      "PHASE_A: MUST execute only deterministic position 2 after separate human authorization.",
      "GATE_A: MUST obtain human approval of position 2 before Phase B authorization.",
      "PHASE_B: MUST authorize at most one provider call for position 5 as validation of the V2 contract.",
      "GATE_B: MUST keep positions 3, 4, and 6 unauthorized until position 5 receives human visual approval.",
      "NO_AUTOMATIC_RETRY: MUST stop after every provider outcome without automatic retry.",
    ],
    positions,
  }
  const planText = JSON.stringify(plan)
  return { plan, planText, planHash: sha256(planText) }
}
