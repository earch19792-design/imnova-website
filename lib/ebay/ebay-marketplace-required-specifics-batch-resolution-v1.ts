import { createHash } from "node:crypto"

export const MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1 =
  "MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1" as const
export const REQUIRED_SPECIFICS_DIGEST_VERSION =
  "CANONICAL_JSON_V2_POLICY_FALLBACKS" as const

type JsonRecord = Record<string, unknown>

export type RequiredSpecificAspectDefinitionV1 = Readonly<{
  name: string
  dataType: string | null
  mode: string
  cardinality: string
  freeTextAllowed: boolean
  allowedValues: readonly string[]
  allowedValueCount: number
  allowedValuesComplete: boolean
  source: "EBAY_TAXONOMY_OFFICIAL_READONLY"
}>

export type RequiredSpecificsBatchProductV1 = Readonly<{
  radarCandidateId: string
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  marketplaceId: "EBAY_US"
  categoryId: string
  exactProductIdentityProven: boolean
  exactProductTitle: string
  exactDescription: string
  exactSpecs: Readonly<Record<string, string>>
  exactVariantData: Readonly<Record<string, string>>
  exactImageUrls: readonly string[]
  unresolvedRequiredAspects: readonly string[]
  officialAspectDefinitions: readonly RequiredSpecificAspectDefinitionV1[]
  inputEvidenceDigest: string
}>

export type RequiredSpecificResolutionV1 = Readonly<{
  aspectName: string
  resolvedValue: string | null
  resolutionClass: "EXPLICIT_PRODUCT_TRUTH" | "DETERMINISTIC_DERIVATION" |
    "MARKETPLACE_ALLOWED_FALLBACK" | "AI_CLASSIFICATION" |
    "AI_NORMALIZATION" | "AI_MAPPING" | "HUMAN_REVIEW"
  sourceEvidence: Readonly<{
    sourceField: "TITLE" | "DESCRIPTION" | "SPECS" | "VARIANT" |
      "IMAGE" | "MARKETPLACE_POLICY" | "NONE"
    sourceExcerpt: string | null
    imageIndex: number | null
  }>
  confidence: "HIGH" | "MEDIUM" | "LOW"
  factInvented: false
  humanReviewRequired: boolean
}>

export type RequiredSpecificsBatchCandidateResultV1 = Readonly<{
  radarCandidateId: string
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  marketplaceId: "EBAY_US"
  categoryId: string
  inputEvidenceDigest: string
  resolutions: readonly RequiredSpecificResolutionV1[]
}>

export type RequiredSpecificsAiBatchV1 = (
  input: Readonly<{
    stage: "TEXT" | "VISION"
    marketplaceId: "EBAY_US"
    categoryId: string
    products: readonly RequiredSpecificsBatchProductV1[]
  }>,
) => Promise<Readonly<{
  candidates: readonly RequiredSpecificsBatchCandidateResultV1[]
  inputTokens: number | null
  outputTokens: number | null
  model: string
}>>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum)
    : ""
}

function key(value: unknown) {
  return text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim()
}

function canonical(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, entry]) => `${JSON.stringify(name)}:${canonical(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function requiredSpecificBatchEvidenceDigestV1(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(canonical(value)).digest("hex")}`
}

function officialValue(
  definition: RequiredSpecificAspectDefinitionV1,
  proposed: unknown,
) {
  const normalized = text(proposed, 500)
  if (!normalized) return null
  if (definition.freeTextAllowed || !definition.allowedValuesComplete) {
    return normalized
  }
  return definition.allowedValues.find((entry) => key(entry) === key(normalized))
    ?? null
}

const ABSENCE_MARKERS = new Set([
  "unbranded", "does not apply", "not applicable", "none",
])

const EBAY_US_PRODUCT_IDENTIFIER_UNAVAILABLE = "Does not apply" as const
const EXPLICIT_MPN_FIELD_KEYS = new Set([
  "mpn", "manufacturer part number", "manufacturer part no",
  "manufacturer part #", "part number", "part no",
])

function exactSources(product: RequiredSpecificsBatchProductV1) {
  return {
    TITLE: product.exactProductTitle,
    DESCRIPTION: product.exactDescription,
    SPECS: Object.entries(product.exactSpecs)
      .map(([name, value]) => `${name}: ${value}`).join("\n"),
    VARIANT: Object.entries(product.exactVariantData)
      .map(([name, value]) => `${name}: ${value}`).join("\n"),
  } as const
}

function explicitManufacturerPartNumber(
  product: RequiredSpecificsBatchProductV1,
  definition: RequiredSpecificAspectDefinitionV1,
) {
  const structured = [...Object.entries(product.exactSpecs),
    ...Object.entries(product.exactVariantData)].flatMap(([name, value]) => {
    if (!EXPLICIT_MPN_FIELD_KEYS.has(key(name))) return []
    const resolved = officialValue(definition, value)
    return resolved ? [resolved] : []
  })
  const labeledText = [product.exactProductTitle, product.exactDescription]
    .flatMap((source) => {
      const match = source.match(
        /(?:manufacturer\s+part\s+(?:number|no\.?|#)|\bmpn)\s*[:#=-]\s*([a-z0-9][a-z0-9._/-]{1,79})/iu,
      )
      const resolved = match ? officialValue(definition, match[1]) : null
      return resolved ? [resolved] : []
    })
  const values = [...new Set([...structured, ...labeledText])]
  return values.length === 1 ? values[0] : null
}

function deterministicResolution(
  product: RequiredSpecificsBatchProductV1,
  definition: RequiredSpecificAspectDefinitionV1,
): RequiredSpecificResolutionV1 | null {
  const directSpec = [...Object.entries(product.exactSpecs),
    ...Object.entries(product.exactVariantData)]
    .filter(([name, value]) => key(name) === key(definition.name) && text(value))
  const directValues = [...new Set(directSpec.map(([, value]) =>
    officialValue(definition, value)).filter((value): value is string =>
      Boolean(value)))]
  if (directValues.length === 1) {
    return Object.freeze({
      aspectName: definition.name,
      resolvedValue: directValues[0],
      resolutionClass: "EXPLICIT_PRODUCT_TRUTH",
      sourceEvidence: Object.freeze({
        sourceField: "SPECS", sourceExcerpt: directSpec[0][1], imageIndex: null,
      }),
      confidence: "HIGH", factInvented: false,
      humanReviewRequired: false,
    })
  }
  if (key(definition.name) === "mpn") {
    const explicitMpn = explicitManufacturerPartNumber(product, definition)
    if (explicitMpn) {
      return Object.freeze({
        aspectName: definition.name,
        resolvedValue: explicitMpn,
        resolutionClass: "EXPLICIT_PRODUCT_TRUTH",
        sourceEvidence: Object.freeze({ sourceField: "SPECS",
          sourceExcerpt: explicitMpn, imageIndex: null }),
        confidence: "HIGH", factInvented: false,
        humanReviewRequired: false,
      })
    }
  }
  // Brand follows a stricter hierarchy than ordinary categorizations: only an
  // explicit exact Luna/Product Truth field can establish a brand. Otherwise
  // the projection may use eBay's official Unbranded value, without changing
  // Product Truth or asking text/vision AI to infer a brand.
  if (key(definition.name) === "brand") {
    if (product.exactProductIdentityProven !== true) {
      return humanReview(definition.name)
    }
    const unbranded = definition.allowedValues.find((value) =>
      key(value) === "unbranded")
    if (!unbranded) return humanReview(definition.name)
    return Object.freeze({
      aspectName: definition.name,
      resolvedValue: unbranded,
      resolutionClass: "MARKETPLACE_ALLOWED_FALLBACK",
      sourceEvidence: Object.freeze({ sourceField: "MARKETPLACE_POLICY",
        sourceExcerpt:
          "OFFICIAL_UNBRANDED_VALUE_WITH_EXACT_LUNA_IDENTITY_AND_NO_EXPLICIT_BRAND",
        imageIndex: null }),
      confidence: "HIGH", factInvented: false,
      humanReviewRequired: false,
    })
  }
  // MPN is a manufacturer identifier, never a supplier SKU, ASIN, barcode, or
  // model-looking title fragment. eBay US provides a marketplace substitute
  // when that identifier is unavailable. This closes only the marketplace
  // projection after exact Product Truth fields have been checked above; it
  // never writes an MPN into Product Truth.
  if (key(definition.name) === "mpn"
      && product.exactProductIdentityProven === true
      && definition.freeTextAllowed === true) {
    return Object.freeze({
      aspectName: definition.name,
      resolvedValue: EBAY_US_PRODUCT_IDENTIFIER_UNAVAILABLE,
      resolutionClass: "MARKETPLACE_ALLOWED_FALLBACK",
      sourceEvidence: Object.freeze({ sourceField: "MARKETPLACE_POLICY",
        sourceExcerpt:
          "EBAY_US_PRODUCT_IDENTIFIER_UNAVAILABLE_AFTER_EXACT_MPN_SWEEP",
        imageIndex: null }),
      confidence: "HIGH", factInvented: false,
      humanReviewRequired: false,
    })
  }
  const corpus = exactSources(product)
  const matches = definition.allowedValues.flatMap((value) => {
    const needle = key(value)
    if (!needle || ABSENCE_MARKERS.has(needle)) return []
    return (Object.entries(corpus) as [keyof typeof corpus, string][])
      .filter(([, source]) => ` ${key(source)} `.includes(` ${needle} `))
      .map(([sourceField]) => ({ value, sourceField }))
  })
  const uniqueMatches = [...new Map(matches.map((match) =>
    [key(match.value), match])).values()]
  if (uniqueMatches.length === 1) {
    const match = uniqueMatches[0]
    return Object.freeze({
      aspectName: definition.name,
      resolvedValue: match.value,
      resolutionClass: "DETERMINISTIC_DERIVATION",
      sourceEvidence: Object.freeze({
        sourceField: match.sourceField,
        sourceExcerpt: match.value,
        imageIndex: null,
      }),
      confidence: "HIGH", factInvented: false,
      humanReviewRequired: false,
    })
  }
  const absenceValues = definition.allowedValues.filter((value) =>
    ABSENCE_MARKERS.has(key(value)))
  // A fallback can close deterministically only when the exact evidence set is
  // complete enough to exclude a visual contradiction. Products with images
  // remain residual for one shared vision batch.
  if (uniqueMatches.length === 0 && absenceValues.length === 1
      && product.exactImageUrls.length === 0) {
    return Object.freeze({
      aspectName: definition.name,
      resolvedValue: absenceValues[0],
      resolutionClass: "MARKETPLACE_ALLOWED_FALLBACK",
      sourceEvidence: Object.freeze({ sourceField: "MARKETPLACE_POLICY",
        sourceExcerpt: "OFFICIAL_ABSENCE_VALUE_WITH_COMPLETE_TEXT_EVIDENCE",
        imageIndex: null }),
      confidence: "HIGH", factInvented: false,
      humanReviewRequired: false,
    })
  }
  return null
}

function humanReview(aspectName: string, proposal?: Readonly<{
  resolvedValue: string
  sourceEvidence: RequiredSpecificResolutionV1["sourceEvidence"]
  confidence: RequiredSpecificResolutionV1["confidence"]
}>): RequiredSpecificResolutionV1 {
  return Object.freeze({
    aspectName,
    resolvedValue: proposal?.resolvedValue ?? null,
    resolutionClass: "HUMAN_REVIEW",
    sourceEvidence: proposal?.sourceEvidence ?? Object.freeze({
      sourceField: "NONE", sourceExcerpt: null, imageIndex: null }),
    confidence: proposal?.confidence ?? "LOW", factInvented: false,
    humanReviewRequired: true,
  })
}

function validatedAiEvidence(input: Readonly<{
  stage: "TEXT" | "VISION"
  product: RequiredSpecificsBatchProductV1
  evidence: RequiredSpecificResolutionV1["sourceEvidence"]
  resolutionClass: RequiredSpecificResolutionV1["resolutionClass"]
}>) {
  const evidence = input.evidence
  if (evidence.sourceField === "IMAGE") {
    return input.stage === "VISION" && evidence.imageIndex !== null
      && evidence.imageIndex >= 0
      && evidence.imageIndex < input.product.exactImageUrls.length
  }
  if (["TITLE", "DESCRIPTION", "SPECS", "VARIANT"]
      .includes(evidence.sourceField)) {
    const sources = exactSources(input.product)
    const source = sources[evidence.sourceField as keyof typeof sources] ?? ""
    return Boolean(evidence.sourceExcerpt && key(source).includes(
      key(evidence.sourceExcerpt)))
  }
  return evidence.sourceField === "MARKETPLACE_POLICY"
    && input.resolutionClass === "MARKETPLACE_ALLOWED_FALLBACK"
    && input.product.exactImageUrls.length === 0
}

function validateAiResolution(input: Readonly<{
  stage: "TEXT" | "VISION"
  product: RequiredSpecificsBatchProductV1
  raw: RequiredSpecificResolutionV1
}>) {
  const definition = input.product.officialAspectDefinitions.find((entry) =>
    key(entry.name) === key(input.raw.aspectName))
  if (!definition || !input.product.unresolvedRequiredAspects.some((entry) =>
    key(entry) === key(definition.name)) || input.raw.factInvented !== false) {
    return humanReview(input.raw.aspectName)
  }
  if (!input.raw.resolvedValue) return humanReview(definition.name)
  const value = officialValue(definition, input.raw.resolvedValue)
  if (!value) return humanReview(definition.name)
  const evidence = input.raw.sourceEvidence
  if (!validatedAiEvidence({ stage: input.stage, product: input.product,
    evidence, resolutionClass: input.raw.resolutionClass })) {
    return humanReview(definition.name)
  }
  if (input.raw.resolutionClass === "MARKETPLACE_ALLOWED_FALLBACK"
      && !ABSENCE_MARKERS.has(key(value))) return humanReview(definition.name)
  if (input.raw.humanReviewRequired) return humanReview(definition.name, {
    resolvedValue: value, sourceEvidence: evidence,
    confidence: input.raw.confidence,
  })
  return Object.freeze({ ...input.raw, aspectName: definition.name,
    resolvedValue: value, factInvented: false as const })
}

function chunkProducts(products: readonly RequiredSpecificsBatchProductV1[],
  maximumChars: number, maximumProducts: number) {
  const chunks: RequiredSpecificsBatchProductV1[][] = []
  let current: RequiredSpecificsBatchProductV1[] = []
  let size = 0
  for (const product of products) {
    const productSize = JSON.stringify(product).length
    if (current.length && (current.length >= maximumProducts
        || size + productSize > maximumChars)) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(product)
    size += productSize
  }
  if (current.length) chunks.push(current)
  return chunks
}

export async function resolveMarketplaceRequiredSpecificsBatchV1(input:
Readonly<{
  products: readonly RequiredSpecificsBatchProductV1[]
  aiResolver?: RequiredSpecificsAiBatchV1 | null
  aiStages?: readonly ("TEXT" | "VISION")[]
}>) {
  const grouped = new Map<string, RequiredSpecificsBatchProductV1[]>()
  for (const product of input.products) {
    const groupKey = `${product.marketplaceId}:${product.categoryId}`
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), product])
  }
  const candidateResults = new Map<string,
    RequiredSpecificsBatchCandidateResultV1>()
  let deterministicResolvedCount = 0
  let marketplaceFallbackResolvedCount = 0
  let aiResolutionRequiredCount = 0
  let aiCallCount = 0
  let aiInputTokens = 0
  let aiOutputTokens = 0
  const batchSummaries: JsonRecord[] = []
  for (const products of grouped.values()) {
    const groupDeterministicStart = deterministicResolvedCount
    const groupFallbackStart = marketplaceFallbackResolvedCount
    const groupAiRequiredStart = aiResolutionRequiredCount
    const groupAiCallsStart = aiCallCount
    const pending: RequiredSpecificsBatchProductV1[] = []
    for (const product of products) {
      const resolutions: RequiredSpecificResolutionV1[] = []
      const unresolved: string[] = []
      for (const name of product.unresolvedRequiredAspects) {
        const definition = product.officialAspectDefinitions.find((entry) =>
          key(entry.name) === key(name))
        const resolution = definition
          ? deterministicResolution(product, definition) : null
        if (!resolution) unresolved.push(name)
        else {
          resolutions.push(resolution)
          if (resolution.resolutionClass === "MARKETPLACE_ALLOWED_FALLBACK") {
            marketplaceFallbackResolvedCount += 1
          } else if (!resolution.humanReviewRequired) {
            deterministicResolvedCount += 1
          }
        }
      }
      candidateResults.set(product.radarCandidateId, Object.freeze({
        radarCandidateId: product.radarCandidateId,
        lunaProductId: product.lunaProductId,
        lunaVariantId: product.lunaVariantId,
        supplierSku: product.supplierSku,
        marketplaceId: product.marketplaceId,
        categoryId: product.categoryId,
        inputEvidenceDigest: product.inputEvidenceDigest,
        resolutions: Object.freeze(resolutions),
      }))
      if (unresolved.length) {
        aiResolutionRequiredCount += unresolved.length
        pending.push(Object.freeze({ ...product,
          unresolvedRequiredAspects: Object.freeze(unresolved) }))
      }
    }
    const applyAi = async (stage: "TEXT" | "VISION",
      candidates: readonly RequiredSpecificsBatchProductV1[]) => {
      if (candidates.length === 0) return []
      if (!input.aiResolver) {
        throw new Error("REQUIRED_SPECIFICS_AI_CONFIGURATION_MISSING")
      }
      const maximumChars = stage === "TEXT" ? 60_000 : 36_000
      const maximumProducts = stage === "TEXT" ? 20 : 8
      const unresolvedForNext: RequiredSpecificsBatchProductV1[] = []
      for (const chunk of chunkProducts(candidates, maximumChars,
        maximumProducts)) {
        const output = await input.aiResolver({ stage,
          marketplaceId: chunk[0].marketplaceId,
          categoryId: chunk[0].categoryId, products: chunk })
        aiCallCount += 1
        aiInputTokens += output.inputTokens ?? 0
        aiOutputTokens += output.outputTokens ?? 0
        for (const product of chunk) {
          const rawCandidate = output.candidates.find((candidate) =>
            candidate.radarCandidateId === product.radarCandidateId
            && candidate.lunaProductId === product.lunaProductId
            && candidate.lunaVariantId === product.lunaVariantId
            && candidate.supplierSku === product.supplierSku
            && candidate.categoryId === product.categoryId
            && candidate.inputEvidenceDigest === product.inputEvidenceDigest)
          const current = candidateResults.get(product.radarCandidateId)!
          const resolved = product.unresolvedRequiredAspects.map((name) => {
            const raw = rawCandidate?.resolutions.find((entry) =>
              key(entry.aspectName) === key(name))
            return raw ? validateAiResolution({ stage, product, raw })
              : humanReview(name)
          })
          candidateResults.set(product.radarCandidateId, Object.freeze({
            ...current,
            resolutions: Object.freeze([
              ...current.resolutions.filter((entry) => !resolved.some(
                (replacement) => key(replacement.aspectName) ===
                  key(entry.aspectName))),
              ...resolved,
            ]),
          }))
          const residual = resolved.filter((entry) =>
            entry.humanReviewRequired).map((entry) => entry.aspectName)
          if (stage === "TEXT" && residual.length
              && product.exactImageUrls.length) {
            unresolvedForNext.push(Object.freeze({ ...product,
              unresolvedRequiredAspects: Object.freeze(residual) }))
          }
        }
      }
      return unresolvedForNext
    }
    const aiStages = input.aiStages === undefined
      ? ["TEXT", "VISION"] as const : [...new Set(input.aiStages)]
    let stagePending = pending
    for (const stage of aiStages) {
      stagePending = await applyAi(stage, stagePending)
    }
    for (const product of stagePending) {
      const current = candidateResults.get(product.radarCandidateId)!
      const residual = product.unresolvedRequiredAspects.map((aspectName) =>
        humanReview(aspectName))
      candidateResults.set(product.radarCandidateId, Object.freeze({
        ...current,
        resolutions: Object.freeze([
          ...current.resolutions.filter((entry) => !residual.some(
            (replacement) => key(replacement.aspectName) ===
              key(entry.aspectName))),
          ...residual,
        ]),
      }))
    }
    batchSummaries.push(Object.freeze({
      marketplaceId: products[0].marketplaceId,
      categoryId: products[0].categoryId,
      productCount: products.length,
      unresolvedAspectCount: products.reduce((sum, product) =>
        sum + product.unresolvedRequiredAspects.length, 0),
      deterministicResolvedCount:
        deterministicResolvedCount - groupDeterministicStart,
      marketplaceFallbackResolvedCount:
        marketplaceFallbackResolvedCount - groupFallbackStart,
      aiResolutionRequiredCount:
        aiResolutionRequiredCount - groupAiRequiredStart,
      aiCallCount: aiCallCount - groupAiCallsStart,
    }))
  }
  const candidates = [...candidateResults.values()].map((candidate) => {
    const core = { ...candidate,
      resolutions: candidate.resolutions.map((entry) => ({ ...entry })) }
    return Object.freeze({ ...candidate,
      evidenceDigest: requiredSpecificBatchEvidenceDigestV1(core) })
  })
  return Object.freeze({
    contractVersion: MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1,
    authority: "SELLER_OS_DETERMINISTIC_FACTORY",
    groupingAuthority: "EBAY_MARKETPLACE_PLUS_CATEGORY_ID",
    productCount: input.products.length,
    unresolvedAspectCount: input.products.reduce((sum, product) =>
      sum + product.unresolvedRequiredAspects.length, 0),
    deterministicResolvedCount,
    marketplaceFallbackResolvedCount,
    aiResolutionRequiredCount,
    aiCallCount,
    aiInputTokens,
    aiOutputTokens,
    batches: Object.freeze(batchSummaries),
    candidates: Object.freeze(candidates),
    marketplaceWrites: 0 as const,
  })
}

const resolutionSchema = {
  type: "object", additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: { type: "array", maxItems: 20, items: {
      type: "object", additionalProperties: false,
      required: ["radarCandidateId", "lunaProductId", "lunaVariantId",
        "supplierSku", "marketplaceId", "categoryId", "inputEvidenceDigest",
        "resolutions"],
      properties: {
        radarCandidateId: { type: "string" }, lunaProductId: { type: "string" },
        lunaVariantId: { type: "string" }, supplierSku: { type: "string" },
        marketplaceId: { type: "string", enum: ["EBAY_US"] },
        categoryId: { type: "string" }, inputEvidenceDigest: { type: "string" },
        resolutions: { type: "array", maxItems: 50, items: {
          type: "object", additionalProperties: false,
          required: ["aspectName", "resolvedValue", "resolutionClass",
            "sourceEvidence", "confidence", "factInvented",
            "humanReviewRequired"],
          properties: {
            aspectName: { type: "string" },
            resolvedValue: { type: ["string", "null"] },
            resolutionClass: { type: "string", enum: [
              "EXPLICIT_PRODUCT_TRUTH", "DETERMINISTIC_DERIVATION",
              "MARKETPLACE_ALLOWED_FALLBACK", "AI_CLASSIFICATION",
              "AI_NORMALIZATION", "AI_MAPPING", "HUMAN_REVIEW",
            ] },
            sourceEvidence: { type: "object", additionalProperties: false,
              required: ["sourceField", "sourceExcerpt", "imageIndex"],
              properties: {
                sourceField: { type: "string", enum: ["TITLE", "DESCRIPTION",
                  "SPECS", "VARIANT", "IMAGE", "MARKETPLACE_POLICY", "NONE"] },
                sourceExcerpt: { type: ["string", "null"] },
                imageIndex: { type: ["integer", "null"] },
              } },
            confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
            factInvented: { type: "boolean", enum: [false] },
            humanReviewRequired: { type: "boolean" },
          },
        } },
      },
    } },
  },
} as const

function extractResponseText(payload: JsonRecord) {
  if (typeof payload.output_text === "string") return payload.output_text
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    for (const content of Array.isArray(record(item).content)
      ? record(item).content as unknown[] : []) {
      const entry = record(content)
      if (entry.type === "output_text" && typeof entry.text === "string") {
        return entry.text
      }
    }
  }
  return ""
}

export function createOpenAiRequiredSpecificsBatchResolverV1(
  environment: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): RequiredSpecificsAiBatchV1 | null {
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? ""
  const model = environment.OPENAI_LISTING_REVIEW_MODEL?.trim()
    || environment.OPENAI_LISTING_MODEL?.trim() || "gpt-5.6-terra"
  if (!apiKey || !model) return null
  return async (input) => {
    const safeProducts = input.products.map((product) => ({
      ...product,
      exactImageUrls: input.stage === "VISION"
        ? product.exactImageUrls.map((_, index) => `EXACT_IMAGE_${index}`) : [],
    }))
    const instructions = [
      "Resolve eBay required item specifics for multiple exact products.",
      "You may only CLASSIFY, NORMALIZE, or MAP evidence supplied here.",
      "Never create a product fact. FACT_INVENTED must always be false.",
      "Use official allowed values and aspect semantics for the exact category.",
      "A marketplace absence value is not Product Truth; use MARKETPLACE_ALLOWED_FALLBACK only when official and no contradictory exact evidence is visible.",
      "If evidence is insufficient or conflicting, return HUMAN_REVIEW with null value.",
      `Stage=${input.stage}. Return every unresolved aspect for every product.`,
    ].join("\n")
    const content: JsonRecord[] = [{ type: "input_text",
      text: JSON.stringify(safeProducts) }]
    if (input.stage === "VISION") {
      for (const product of input.products) {
        product.exactImageUrls.slice(0, 4).forEach((imageUrl, imageIndex) => {
          content.push({ type: "input_text", text: JSON.stringify({
            radarCandidateId: product.radarCandidateId, imageIndex,
          }) })
          content.push({ type: "input_image", image_url: imageUrl,
            detail: "high" })
        })
      }
    }
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json" },
      body: JSON.stringify({ model, store: false, max_output_tokens: 6_000,
        input: [
          { role: "system", content: instructions },
          { role: "user", content },
        ], text: { format: {
          type: "json_schema", name: "required_specifics_batch_v1",
          strict: true, schema: resolutionSchema,
        } } }),
      cache: "no-store",
      signal: AbortSignal.timeout(55_000),
    })
    if (!response.ok) {
      throw new Error(`REQUIRED_SPECIFICS_AI_HTTP_${response.status}`)
    }
    const payload = await response.json() as JsonRecord
    const outputText = extractResponseText(payload)
    if (!outputText) throw new Error("REQUIRED_SPECIFICS_AI_OUTPUT_MISSING")
    let parsed: JsonRecord
    try { parsed = JSON.parse(outputText) as JsonRecord } catch {
      throw new Error("REQUIRED_SPECIFICS_AI_OUTPUT_INVALID")
    }
    const usage = record(payload.usage)
    return Object.freeze({
      candidates: (Array.isArray(parsed.candidates) ? parsed.candidates : []) as
        RequiredSpecificsBatchCandidateResultV1[],
      inputTokens: Number.isFinite(Number(usage.input_tokens))
        ? Number(usage.input_tokens) : null,
      outputTokens: Number.isFinite(Number(usage.output_tokens))
        ? Number(usage.output_tokens) : null,
      model,
    })
  }
}
