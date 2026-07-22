import { createHash } from "node:crypto"

export const REFERENCE_GUIDED_COMPOSITION_MANIFEST_VERSION =
  "REFERENCE_GUIDED_COMPOSITION_MANIFEST_V2"
export const REFERENCE_GUIDED_EXACT_PROMPT_TEMPLATE_VERSION =
  "REFERENCE_GUIDED_EXACT_PROMPT_V2_2026_07_22"
export const REFERENCE_GUIDED_STRATEGY_VERSION = "VISUAL_STRATEGY_V3"
export const REFERENCE_GUIDED_REVISION_CONTRACT =
  "REFERENCE_GUIDED_PRODUCT_GENERATION_V1"

type JsonRecord = Record<string, unknown>

export type ReferenceGuidedAllowedFact = {
  key: string
  value: string | number | boolean
  unit: string | null
  scope: "PRODUCT_UNIT" | "OFFER_PACK"
}

export type ReferenceGuidedV3ManifestJob = {
  position: number
  commercialObjective: string
  promptTemplateVersion: typeof REFERENCE_GUIDED_EXACT_PROMPT_TEMPLATE_VERSION
  allowedProductFacts: ReferenceGuidedAllowedFact[]
  allowedGeneratedContext: string[]
  prohibitedClaims: string[]
  exactPromptText: string
  promptHash: string
}

export type ReferenceGuidedV3CompositionManifest = {
  version: typeof REFERENCE_GUIDED_COMPOSITION_MANIFEST_VERSION
  revisionId: string
  strategyVersion: typeof REFERENCE_GUIDED_STRATEGY_VERSION
  revisionContract: typeof REFERENCE_GUIDED_REVISION_CONTRACT
  productDossierHash: string
  marketVisualBriefHash: string
  sourcePackManifestHash: string
  mainSourceHash: string
  sideSourceHash: string
  promptTemplateVersion: typeof REFERENCE_GUIDED_EXACT_PROMPT_TEMPLATE_VERSION
  jobs: ReferenceGuidedV3ManifestJob[]
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

export function sha256ExactUtf8(value: string) {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex")
}

export function verifyExactReferenceGuidedPrompt(
  exactPromptText: string,
  expectedHash: string,
) {
  return sha256ExactUtf8(exactPromptText) === expectedHash
}

function exactAllowedFacts(value: unknown, expectedDossierHash: string) {
  const factsPackage = record(value)
  if (factsPackage.ready !== true ||
    factsPackage.factPackageHash !== expectedDossierHash ||
    !Array.isArray(factsPackage.facts)) {
    throw new Error("REFERENCE_GUIDED_PRODUCT_DOSSIER_MISMATCH")
  }
  const facts = factsPackage.facts.flatMap((item) => {
    const fact = record(item)
    const key = typeof fact.key === "string" ? fact.key : ""
    const scope = fact.scope
    const verification = fact.verificationStatus
    const factValue = fact.value
    if (!key || !["PRODUCT_UNIT", "OFFER_PACK"].includes(String(scope)) ||
      !["VERIFIED", "DERIVED_VERIFIED"].includes(String(verification)) ||
      !["string", "number", "boolean"].includes(typeof factValue)) return []
    return [{
      key,
      value: factValue as string | number | boolean,
      unit: typeof fact.unit === "string" ? fact.unit : null,
      scope: scope as "PRODUCT_UNIT" | "OFFER_PACK",
    }]
  })
  return new Map(facts.map((fact) => [fact.key, fact]))
}

const COMMON_PROHIBITED_CLAIMS = [
  "Do not invent or alter product parts, geometry, color, material, labels, logos, packaging, quantity, or included accessories.",
  "Do not invent dimensions, shipping weight, a different capacity, technical benefits, durability, performance, or test results.",
  "Do not present hands, food, water, kitchen objects, or scene props as included product contents or as proof of performance.",
  "Do not add text, captions, measurements, badges, watermarks, or competitor imagery to the image.",
]

const JOB_DEFINITIONS = [
  {
    commercialObjective: "MATERIAL_AND_FINISH_DETAIL",
    factKeys: ["exactProductName", "brand", "color", "condition", "material", "mpn", "type"],
    context: [
      "A restrained neutral kitchen or studio surface may surround the unchanged product.",
      "Lighting and camera crop may emphasize only finish and detail already visible in MAIN or SIDE.",
    ],
    prohibited: ["Do not synthesize a new coating, texture, edge, opening, handle, or hidden surface."],
  },
  {
    commercialObjective: "CONFIRMED_PACKAGE_CONTENTS",
    factKeys: ["exactProductName", "offerPackCount", "unitsPerPack", "totalUnitCount", "unitCount"],
    context: [
      "An uncluttered neutral surface may frame the exact single offer.",
      "Shadows and empty scene space may organize the composition without implying included objects.",
    ],
    prohibited: ["Do not duplicate the product or add boxes, inserts, utensils, accessories, or other included contents."],
  },
  {
    commercialObjective: "SCALE_AND_CAPACITY_CONTEXT",
    factKeys: ["exactProductName", "type", "netContent", "unitGrossWeight"],
    context: [
      "A normal kitchen counter and generic food may provide non-measuring visual context.",
      "Any food or kitchen object is generated scene dressing only and is not included with the offer.",
    ],
    prohibited: ["Do not add rulers, dimensions, package dimensions, shipping weight, or imply a capacity other than the exact allowed fact."],
  },
  {
    commercialObjective: "PRIMARY_BENEFIT_IN_ACTION",
    factKeys: ["exactProductName", "type", "material", "color"],
    context: [
      "Hands, water, and generic food may show ordinary category use in a kitchen while leaving the exact product unobscured.",
      "Hands, food, water, and kitchen props are contextual generation only; they are not included and do not prove performance.",
    ],
    prohibited: ["Do not claim drainage speed, strength, heat resistance, durability, ergonomics, or any other unverified technical benefit."],
  },
  {
    commercialObjective: "ASPIRATIONAL_LIFESTYLE",
    factKeys: ["exactProductName", "brand", "type", "material", "color"],
    context: [
      "A clean, aspirational kitchen setting with generic food and restrained props may surround the exact product.",
      "All food and props are generated scene dressing only and are not included with the offer.",
    ],
    prohibited: ["Do not imply professional endorsement, health outcomes, premium performance, or included lifestyle props."],
  },
  {
    commercialObjective: "REAL_HUMAN_USE",
    factKeys: ["exactProductName", "type", "material", "color", "netContent"],
    context: [
      "Human hands may hold or use the exact product naturally in an ordinary kitchen scene.",
      "Hands and nearby food or kitchen objects are generated context only; they are not offer contents or performance evidence.",
    ],
    prohibited: ["Do not obscure identity-critical product features or claim comfort, safety, speed, capacity, or performance from the depicted use."],
  },
] as const

function requireFacts(
  allFacts: Map<string, ReferenceGuidedAllowedFact>,
  keys: readonly string[],
) {
  return keys.map((key) => {
    const fact = allFacts.get(key)
    if (!fact) throw new Error(`REFERENCE_GUIDED_REQUIRED_FACT_MISSING:${key}`)
    return fact
  })
}

function exactPrompt(input: {
  commercialObjective: string
  allowedProductFacts: ReferenceGuidedAllowedFact[]
  allowedGeneratedContext: string[]
  prohibitedClaims: string[]
}) {
  return [
    "REFERENCE-GUIDED PRODUCT GENERATION V2",
    `PROMPT_TEMPLATE_VERSION=${REFERENCE_GUIDED_EXACT_PROMPT_TEMPLATE_VERSION}`,
    `COMMERCIAL_OBJECTIVE=${input.commercialObjective}`,
    "Use the supplied MAIN and SIDE images only as product identity references. Preserve the exact product and generate only the surrounding scene and explicitly allowed context.",
    `ALLOWED_PRODUCT_FACTS_JSON=${JSON.stringify(input.allowedProductFacts)}`,
    `ALLOWED_GENERATED_CONTEXT_JSON=${JSON.stringify(input.allowedGeneratedContext)}`,
    "CONTEXT_SEPARATION=Generated hands, food, water, surfaces, lighting, and kitchen props are scene context only. They are not included product facts, package contents, accessories, or evidence of technical performance.",
    `PROHIBITED_CLAIMS_JSON=${JSON.stringify(input.prohibitedClaims)}`,
    "OUTPUT_CONSTRAINTS=Return one 1600x1600 PNG with no added text. Keep the product faithful to both references, fully recognizable, commercially useful, and distinct from the other five objectives.",
  ].join("\n")
}

export function buildReferenceGuidedV3CompositionManifest(input: {
  revisionId: string
  strategyVersion: string
  revisionContract: string
  productDossierHash: string
  marketVisualBriefHash: string
  sourcePackManifestHash: string
  mainSourceHash: string
  sideSourceHash: string
  authoritativeFactsPackage: unknown
}) {
  if (input.strategyVersion !== REFERENCE_GUIDED_STRATEGY_VERSION ||
    input.revisionContract !== REFERENCE_GUIDED_REVISION_CONTRACT ||
    !/^sha256:[0-9a-f]{64}$/.test(input.productDossierHash) ||
    !/^[0-9a-f]{64}$/.test(input.marketVisualBriefHash) ||
    !/^[0-9a-f]{64}$/.test(input.sourcePackManifestHash) ||
    !/^[0-9a-f]{64}$/.test(input.mainSourceHash) ||
    !/^[0-9a-f]{64}$/.test(input.sideSourceHash) ||
    input.mainSourceHash === input.sideSourceHash) {
    throw new Error("REFERENCE_GUIDED_PERSISTED_REVISION_INVALID")
  }
  const facts = exactAllowedFacts(
    input.authoritativeFactsPackage,
    input.productDossierHash,
  )
  const jobs = JOB_DEFINITIONS.map((definition, index) => {
    const allowedProductFacts = requireFacts(facts, definition.factKeys)
    const allowedGeneratedContext = [...definition.context]
    const prohibitedClaims = [
      ...COMMON_PROHIBITED_CLAIMS,
      ...definition.prohibited,
    ]
    const exactPromptText = exactPrompt({
      commercialObjective: definition.commercialObjective,
      allowedProductFacts,
      allowedGeneratedContext,
      prohibitedClaims,
    })
    return {
      position: index + 1,
      commercialObjective: definition.commercialObjective,
      promptTemplateVersion: REFERENCE_GUIDED_EXACT_PROMPT_TEMPLATE_VERSION as
        typeof REFERENCE_GUIDED_EXACT_PROMPT_TEMPLATE_VERSION,
      allowedProductFacts,
      allowedGeneratedContext,
      prohibitedClaims,
      exactPromptText,
      promptHash: sha256ExactUtf8(exactPromptText),
    }
  })
  if (jobs.length !== 6 ||
    new Set(jobs.map((job) => job.commercialObjective)).size !== 6) {
    throw new Error("REFERENCE_GUIDED_JOB_OBJECTIVES_INVALID")
  }
  const manifest: ReferenceGuidedV3CompositionManifest = {
    version: REFERENCE_GUIDED_COMPOSITION_MANIFEST_VERSION,
    revisionId: input.revisionId,
    strategyVersion: REFERENCE_GUIDED_STRATEGY_VERSION,
    revisionContract: REFERENCE_GUIDED_REVISION_CONTRACT,
    productDossierHash: input.productDossierHash,
    marketVisualBriefHash: input.marketVisualBriefHash,
    sourcePackManifestHash: input.sourcePackManifestHash,
    mainSourceHash: input.mainSourceHash,
    sideSourceHash: input.sideSourceHash,
    promptTemplateVersion: REFERENCE_GUIDED_EXACT_PROMPT_TEMPLATE_VERSION,
    jobs,
  }
  const compositionManifestText = JSON.stringify(manifest)
  return {
    manifest,
    compositionManifestText,
    compositionManifestHash: sha256ExactUtf8(compositionManifestText),
  }
}
