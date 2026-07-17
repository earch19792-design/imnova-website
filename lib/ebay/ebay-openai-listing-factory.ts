import { createHash } from "node:crypto"

import { z } from "zod"

export const OPENAI_LISTING_FACTORY_SCHEMA_VERSION =
  "OPENAI_EBAY_LISTING_FACTORY_OUTPUT_V1"
export const OPENAI_LISTING_FACTORY_DEFAULT_PROMPT_VERSION =
  "OPENAI_EBAY_LISTING_FACTORY_PROMPT_V1"

const FACTUAL_BLOCKED_TERMS = [
  "fda approved",
  "guaranteed",
  "cures",
  "treats disease",
  "medical grade",
  "official product",
  "authenticity guaranteed",
]

const imageSlotSchema = z.enum([
  "MAIN_WHITE_BACKGROUND",
  "PACK_AND_COUNT",
  "KEY_FEATURES",
  "SIZE_AND_CONTENT",
  "USE_CONTEXT",
  "PACKAGE_CONTENTS",
])

export const listingFactoryOutputSchema = z.object({
  schemaVersion: z.literal(OPENAI_LISTING_FACTORY_SCHEMA_VERSION),
  keywordMap: z.array(z.object({
    keyword: z.string().trim().min(1).max(80),
    intent: z.enum(["PRIMARY", "SECONDARY", "ATTRIBUTE", "EXPERIMENTAL"]),
    evidence: z.enum(["AUTHORIZED_INPUT", "EXACT_COMPARABLE_PATTERN", "CATEGORY_ASPECT"]),
  }).strict()).min(1).max(30),
  titleCandidates: z.array(z.string().trim().min(1).max(80)).length(3),
  itemSpecifics: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(200),
  }).strict()).min(1).max(40),
  description: z.string().trim().min(50).max(5_000),
  factualBullets: z.array(z.string().trim().min(1).max(300)).min(3).max(8),
  faq: z.array(z.object({
    question: z.string().trim().min(1).max(240),
    answer: z.string().trim().min(1).max(500),
  }).strict()).min(2).max(6),
  imageBriefs: z.array(z.object({
    slot: imageSlotSchema,
    objective: z.string().trim().min(1).max(500),
    overlayText: z.string().trim().max(100).nullable(),
    preserveOriginalPackage: z.literal(true),
    sourcePolicy: z.literal("AUTHORIZED_PRODUCT_IMAGE_ONLY"),
  }).strict()).length(6),
  imageText: z.array(z.string().trim().max(100)).max(6),
  complianceNotes: z.array(z.string().trim().min(1).max(500)).max(20),
  pricePresentation: z.object({
    price: z.number().finite().positive(),
    currency: z.literal("USD"),
    minimumSafePrice: z.number().finite().positive(),
  }).strict(),
  experimentAlternatives: z.object({
    titleAlternatives: z.array(z.string().trim().min(1).max(80)).max(3),
    priceExperimentAllowed: z.literal(false),
    analyticsDependency: z.literal("SUSPENDED_IF_DIVERGENCE"),
  }).strict(),
  factAssertions: z.object({
    manufacturerBrand: z.string().nullable(),
    gtin: z.string().nullable(),
    mpn: z.string().nullable(),
    model: z.string().nullable(),
    normalizedProductName: z.string().min(1),
    packCount: z.number().int().positive().nullable(),
    unitCount: z.number().int().positive().nullable(),
    size: z.string().nullable(),
    color: z.string().nullable(),
    scent: z.string().nullable(),
    variant: z.string().nullable(),
    condition: z.string().nullable(),
  }).strict(),
}).strict()

export type ListingFactoryOutput = z.infer<typeof listingFactoryOutputSchema>

export type ListingFactoryInput = {
  decisionPackageId: string
  decisionPackageHash: string
  identityFingerprint: string
  verdict: "GO" | "GO_WITH_CHANGES"
  productFacts: ListingFactoryOutput["factAssertions"]
  economics: {
    minimumSafePrice: number
    targetPrice: number
    premiumPrice: number | null
    estimatedProfit: number
    estimatedRoiPercent: number | null
    estimatedNetMarginPercent: number
  }
  evidence: {
    activeExactCount: number
    soldOrCompletedExactCount: number
    estimatedDemandSignalCount: number
    weightedSoldMedian: number | null
    activeMarketMedian: number | null
  }
  authorizedKeywords: string[]
  category: {
    categoryId: string
    categoryName: string
    requiredAspects: Array<{ name: string; value: string }>
  }
  complianceRestrictions: string[]
  shipping: {
    policyName: string
    handlingTimeDays: number
  }
  returns: {
    policyName: string
    returnsAccepted: boolean
    returnPeriodDays: number | null
  }
}

export type ListingFactoryAdapterResult = {
  output: unknown
  model: string
  provider: "OPENAI" | "FAKE"
  responseFingerprint: string | null
  usage: {
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
    estimatedCostUsd: null
    costStatus: "NOT_CALCULATED"
  }
}

export type ListingFactoryAdapter = {
  generate(input: ListingFactoryInput, context: {
    promptVersion: string
    revision: number
    validationErrors: string[]
  }): Promise<ListingFactoryAdapterResult>
}

const LISTING_FACTORY_STAGING_REF = "vsfthqydfrdzulldbfbe"

export function getOpenAiListingFactoryConfiguration(environment = process.env) {
  let detectedRef: string | null = null
  try {
    detectedRef = new URL(environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "")
      .hostname.split(".")[0] || null
  } catch {
    detectedRef = null
  }
  const preview = environment.VERCEL_ENV === "preview"
  const staging = detectedRef === LISTING_FACTORY_STAGING_REF
  const keyPresent = Boolean(environment.OPENAI_API_KEY?.trim())
  const enabled = environment.OPENAI_LISTING_FACTORY_ENABLED?.trim() === "true"
  const modelPresent = Boolean(environment.OPENAI_LISTING_MODEL?.trim())
  const promptVersionPresent = Boolean(environment.OPENAI_LISTING_PROMPT_VERSION?.trim())
  const realReady = preview && staging && keyPresent && enabled && modelPresent && promptVersionPresent
  return {
    status: realReady ? "READY" as const : enabled ? "MISSING" as const : "DISABLED" as const,
    key: keyPresent ? "PRESENT" as const : "MISSING" as const,
    enabled,
    model: modelPresent ? "PRESENT" as const : "MISSING" as const,
    promptVersion: promptVersionPresent ? "PRESENT" as const : "MISSING" as const,
    preview,
    staging,
    realReady,
    fakeAdapterReady: preview && staging,
    secretsReturnedToBrowser: false,
    apiKeyReturnedToBrowser: false,
  }
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function listingFactoryHash(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function normalized(value: unknown) {
  return text(value).normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ")
}

function safeTitle(value: string) {
  const compact = value.normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s&+.,'()/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (compact.length <= 80) return compact
  return compact.slice(0, 80).replace(/\s+\S*$/, "").trim()
}

function display(value: string | null) {
  if (!value) return ""
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function factSpecifics(facts: ListingFactoryInput["productFacts"]) {
  const values: Array<[string, string | number | null]> = [
    ["Brand", facts.manufacturerBrand],
    ["UPC/GTIN", facts.gtin],
    ["MPN", facts.mpn],
    ["Model", facts.model],
    ["Pack Count", facts.packCount],
    ["Unit Count", facts.unitCount],
    ["Size", facts.size],
    ["Color", facts.color],
    ["Scent", facts.scent],
    ["Variant", facts.variant],
    ["Condition", facts.condition],
  ]
  return values.filter((entry): entry is [string, string | number] => entry[1] !== null)
    .map(([name, value]) => ({ name, value: String(value) }))
}

export function createFakeListingFactoryOutput(input: ListingFactoryInput): ListingFactoryOutput {
  const facts = input.productFacts
  const brand = display(facts.manufacturerBrand) || "Unbranded"
  const product = display(facts.normalizedProductName)
  const pack = facts.packCount ? `${facts.packCount} Pack` : ""
  const units = facts.unitCount ? `${facts.unitCount} Count` : ""
  const variant = display(facts.scent ?? facts.color ?? facts.variant)
  const titleCandidates = [
    safeTitle(`${brand} ${product} ${variant} ${units} ${pack}`),
    safeTitle(`${brand} ${product} ${pack} ${units} ${variant}`),
    safeTitle(`${product} by ${brand} ${variant} ${pack} ${units}`),
  ]
  const uniqueTitles = [...new Set(titleCandidates)]
  while (uniqueTitles.length < 3) uniqueTitles.push(
    safeTitle(`${titleCandidates[0]} Option ${uniqueTitles.length + 1}`),
  )
  const included = [
    facts.packCount ? `${facts.packCount} package units` : null,
    facts.unitCount ? `${facts.unitCount} units per package` : null,
    facts.size ? `size ${facts.size}` : null,
    facts.scent ? `scent ${facts.scent}` : null,
    facts.color ? `color ${facts.color}` : null,
  ].filter(Boolean).join(", ")
  return {
    schemaVersion: OPENAI_LISTING_FACTORY_SCHEMA_VERSION,
    keywordMap: input.authorizedKeywords.slice(0, 30).map((keyword, index) => ({
      keyword,
      intent: index === 0 ? "PRIMARY" : index < 4 ? "SECONDARY" : "ATTRIBUTE",
      evidence: "AUTHORIZED_INPUT",
    })),
    titleCandidates: uniqueTitles.slice(0, 3),
    itemSpecifics: factSpecifics(facts),
    description: `${brand} ${product} in ${display(facts.condition) || "New"} condition. ` +
      `Verified package facts: ${included || "review the approved item specifics"}. ` +
      `The listing includes only the product and quantity shown in the authorized product photographs. ` +
      `${input.shipping.policyName}; handling time is ${input.shipping.handlingTimeDays} day(s). ` +
      `${input.returns.returnsAccepted ? input.returns.policyName : "Returns are not accepted under the selected policy"}.`,
    factualBullets: [
      `Manufacturer brand: ${brand}`,
      `Product: ${product}`,
      `Package: ${pack || "single verified package"}${units ? `, ${units}` : ""}`,
      `Condition: ${display(facts.condition) || "New"}`,
    ],
    faq: [
      {
        question: "What is included?",
        answer: `Only the verified ${product} package shown in the authorized images is included.`,
      },
      {
        question: "What condition is the item in?",
        answer: `The verified condition is ${display(facts.condition) || "New"}.`,
      },
    ],
    imageBriefs: [
      ["MAIN_WHITE_BACKGROUND", "Show the unchanged real package centered on pure white.", null],
      ["PACK_AND_COUNT", "Clarify the verified package and unit count without altering packaging.", pack || units || null],
      ["KEY_FEATURES", "Present only verified product facts around the original package photograph.", null],
      ["SIZE_AND_CONTENT", "Show verified size and contents using the original package as source.", facts.size],
      ["USE_CONTEXT", "Place the unchanged package in a truthful, non-misleading use context.", null],
      ["PACKAGE_CONTENTS", "Show exactly what the buyer receives; add no unverified items.", pack || null],
    ].map(([slot, objective, overlayText]) => ({
      slot: slot as z.infer<typeof imageSlotSchema>,
      objective: String(objective),
      overlayText: overlayText ? String(overlayText) : null,
      preserveOriginalPackage: true as const,
      sourcePolicy: "AUTHORIZED_PRODUCT_IMAGE_ONLY" as const,
    })),
    imageText: [pack, units, facts.size, facts.scent, facts.color]
      .filter((value): value is string => Boolean(value)),
    complianceNotes: [
      "Use only verified product facts.",
      "Do not alter brand, packaging, quantity, variant or certifications.",
    ],
    pricePresentation: {
      price: input.economics.targetPrice,
      currency: "USD",
      minimumSafePrice: input.economics.minimumSafePrice,
    },
    experimentAlternatives: {
      titleAlternatives: uniqueTitles.slice(1, 3),
      priceExperimentAllowed: false,
      analyticsDependency: "SUSPENDED_IF_DIVERGENCE",
    },
    factAssertions: { ...facts },
  }
}

export function buildListingFactoryPrompt(
  input: ListingFactoryInput,
  context: { promptVersion: string; revision: number; validationErrors: string[] },
) {
  return {
    promptVersion: context.promptVersion,
    system: [
      "Create an original eBay US listing package from verified facts only.",
      "Never invent claims, compatibility, identifiers, pack, variant or certifications.",
      "Never copy competitor titles, descriptions or images.",
      "Use only authorized keywords. Keep every title at 80 characters or fewer.",
      "Price must never be below minimumSafePrice.",
      "Image briefs must preserve the original branded package and use authorized images only.",
      `Prompt version: ${context.promptVersion}.`,
    ].join(" "),
    user: canonicalJson({
      input,
      revision: context.revision,
      validationErrors: context.validationErrors,
    }),
    competitorContentIncluded: false,
  }
}

function flattenedContent(output: ListingFactoryOutput) {
  return [
    ...output.titleCandidates,
    output.description,
    ...output.factualBullets,
    ...output.faq.flatMap((entry) => [entry.question, entry.answer]),
    ...output.imageText,
    ...output.imageBriefs.flatMap((entry) => [entry.objective, entry.overlayText ?? ""]),
  ].join("\n").toLowerCase()
}

export function validateListingFactoryOutput(input: ListingFactoryInput, value: unknown) {
  const parsed = listingFactoryOutputSchema.safeParse(value)
  if (!parsed.success) return {
    valid: false,
    output: null,
    factualErrors: ["LISTING_FACTORY_SCHEMA_INVALID"],
    complianceErrors: [] as string[],
  }
  const output = parsed.data
  const factualErrors: string[] = []
  const expected = input.productFacts
  const asserted = output.factAssertions
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    const left = typeof expected[key] === "string" ? normalized(expected[key]) : expected[key]
    const right = typeof asserted[key] === "string" ? normalized(asserted[key]) : asserted[key]
    if (left !== right) factualErrors.push(`FACT_ASSERTION_${String(key).toUpperCase()}_MISMATCH`)
  }
  if (output.pricePresentation.price < input.economics.minimumSafePrice) {
    factualErrors.push("PRICE_BELOW_MINIMUM_SAFE_PRICE")
  }
  if (output.pricePresentation.minimumSafePrice !== input.economics.minimumSafePrice) {
    factualErrors.push("MINIMUM_SAFE_PRICE_CHANGED")
  }
  if (new Set(output.titleCandidates.map(normalized)).size !== 3) {
    factualErrors.push("TITLE_CANDIDATES_NOT_UNIQUE")
  }
  const content = flattenedContent(output)
  const complianceErrors = [
    ...FACTUAL_BLOCKED_TERMS,
    ...input.complianceRestrictions.map(normalized),
  ].filter(Boolean).filter((term) => content.includes(normalized(term)))
    .map((term) => `BLOCKED_TERM:${term}`)
  const inputGtin = expected.gtin
  const generatedGtins = content.match(/\b\d{8,14}\b/g) ?? []
  if (generatedGtins.some((value) => value !== inputGtin)) {
    factualErrors.push("UNVERIFIED_NUMERIC_IDENTIFIER")
  }
  return {
    valid: factualErrors.length === 0 && complianceErrors.length === 0,
    output,
    factualErrors: [...new Set(factualErrors)],
    complianceErrors: [...new Set(complianceErrors)],
  }
}

export function createFakeListingFactoryAdapter(): ListingFactoryAdapter {
  return {
    async generate(input) {
      const output = createFakeListingFactoryOutput(input)
      return {
        output,
        model: "fake-listing-factory-v1",
        provider: "FAKE",
        responseFingerprint: listingFactoryHash(output),
        usage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          estimatedCostUsd: null,
          costStatus: "NOT_CALCULATED",
        },
      }
    },
  }
}

const listingFactoryJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion", "keywordMap", "titleCandidates", "itemSpecifics", "description",
    "factualBullets", "faq", "imageBriefs", "imageText", "complianceNotes",
    "pricePresentation", "experimentAlternatives", "factAssertions",
  ],
  properties: {
    schemaVersion: { type: "string", enum: [OPENAI_LISTING_FACTORY_SCHEMA_VERSION] },
    keywordMap: {
      type: "array", minItems: 1, maxItems: 30,
      items: {
        type: "object", additionalProperties: false,
        required: ["keyword", "intent", "evidence"],
        properties: {
          keyword: { type: "string" },
          intent: { type: "string", enum: ["PRIMARY", "SECONDARY", "ATTRIBUTE", "EXPERIMENTAL"] },
          evidence: { type: "string", enum: ["AUTHORIZED_INPUT", "EXACT_COMPARABLE_PATTERN", "CATEGORY_ASPECT"] },
        },
      },
    },
    titleCandidates: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
    itemSpecifics: {
      type: "array", minItems: 1, maxItems: 40,
      items: {
        type: "object", additionalProperties: false,
        required: ["name", "value"],
        properties: { name: { type: "string" }, value: { type: "string" } },
      },
    },
    description: { type: "string" },
    factualBullets: { type: "array", minItems: 3, maxItems: 8, items: { type: "string" } },
    faq: {
      type: "array", minItems: 2, maxItems: 6,
      items: {
        type: "object", additionalProperties: false,
        required: ["question", "answer"],
        properties: { question: { type: "string" }, answer: { type: "string" } },
      },
    },
    imageBriefs: {
      type: "array", minItems: 6, maxItems: 6,
      items: {
        type: "object", additionalProperties: false,
        required: ["slot", "objective", "overlayText", "preserveOriginalPackage", "sourcePolicy"],
        properties: {
          slot: { type: "string", enum: imageSlotSchema.options },
          objective: { type: "string" },
          overlayText: { type: ["string", "null"] },
          preserveOriginalPackage: { type: "boolean", enum: [true] },
          sourcePolicy: { type: "string", enum: ["AUTHORIZED_PRODUCT_IMAGE_ONLY"] },
        },
      },
    },
    imageText: { type: "array", maxItems: 6, items: { type: "string" } },
    complianceNotes: { type: "array", maxItems: 20, items: { type: "string" } },
    pricePresentation: {
      type: "object", additionalProperties: false,
      required: ["price", "currency", "minimumSafePrice"],
      properties: {
        price: { type: "number" }, currency: { type: "string", enum: ["USD"] },
        minimumSafePrice: { type: "number" },
      },
    },
    experimentAlternatives: {
      type: "object", additionalProperties: false,
      required: ["titleAlternatives", "priceExperimentAllowed", "analyticsDependency"],
      properties: {
        titleAlternatives: { type: "array", maxItems: 3, items: { type: "string" } },
        priceExperimentAllowed: { type: "boolean", enum: [false] },
        analyticsDependency: { type: "string", enum: ["SUSPENDED_IF_DIVERGENCE"] },
      },
    },
    factAssertions: {
      type: "object", additionalProperties: false,
      required: [
        "manufacturerBrand", "gtin", "mpn", "model", "normalizedProductName",
        "packCount", "unitCount", "size", "color", "scent", "variant", "condition",
      ],
      properties: {
        manufacturerBrand: { type: ["string", "null"] },
        gtin: { type: ["string", "null"] },
        mpn: { type: ["string", "null"] },
        model: { type: ["string", "null"] },
        normalizedProductName: { type: "string" },
        packCount: { type: ["integer", "null"] },
        unitCount: { type: ["integer", "null"] },
        size: { type: ["string", "null"] },
        color: { type: ["string", "null"] },
        scent: { type: ["string", "null"] },
        variant: { type: ["string", "null"] },
        condition: { type: ["string", "null"] },
      },
    },
  },
} as const

function extractResponseOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text
  const output = Array.isArray(payload.output) ? payload.output : []
  for (const item of output) {
    if (!item || typeof item !== "object") continue
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as unknown[]
      : []
    for (const entry of content) {
      if (!entry || typeof entry !== "object") continue
      const value = entry as Record<string, unknown>
      if (value.type === "output_text" && typeof value.text === "string") return value.text
    }
  }
  return null
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

export function createOpenAiListingFactoryAdapter(environment = process.env): ListingFactoryAdapter {
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? ""
  const model = environment.OPENAI_LISTING_MODEL?.trim() ?? ""
  const timeoutMs = boundedInteger(environment.OPENAI_LISTING_TIMEOUT_MS, 25_000, 5_000, 55_000)
  const maxRetries = boundedInteger(environment.OPENAI_LISTING_MAX_RETRIES, 1, 0, 2)
  if (!apiKey || !model) throw new Error("OPENAI_LISTING_CONFIGURATION_MISSING")
  return {
    async generate(input, context) {
      const prompt = buildListingFactoryPrompt(input, context)
      let lastCode = "OPENAI_LISTING_REQUEST_FAILED"
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              store: false,
              max_output_tokens: 6_000,
              input: [
                { role: "system", content: prompt.system },
                { role: "user", content: prompt.user },
              ],
              text: {
                format: {
                  type: "json_schema",
                  name: "ebay_listing_factory_v1",
                  strict: true,
                  schema: listingFactoryJsonSchema,
                },
              },
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(timeoutMs),
          })
          if (!response.ok) {
            lastCode = `OPENAI_LISTING_HTTP_${response.status}`
            if (![429, 500, 502, 503, 504].includes(response.status) || attempt === maxRetries) {
              throw new Error(lastCode)
            }
            continue
          }
          const payload = await response.json() as Record<string, unknown>
          if (payload.status !== "completed") throw new Error("OPENAI_LISTING_RESPONSE_INCOMPLETE")
          const outputText = extractResponseOutputText(payload)
          if (!outputText) throw new Error("OPENAI_LISTING_OUTPUT_MISSING")
          let output: unknown
          try {
            output = JSON.parse(outputText)
          } catch {
            throw new Error("OPENAI_LISTING_OUTPUT_JSON_INVALID")
          }
          const usage = payload.usage && typeof payload.usage === "object"
            ? payload.usage as Record<string, unknown>
            : {}
          return {
            output,
            model,
            provider: "OPENAI",
            responseFingerprint: typeof payload.id === "string"
              ? listingFactoryHash(payload.id)
              : null,
            usage: {
              inputTokens: Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null,
              outputTokens: Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null,
              totalTokens: Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : null,
              estimatedCostUsd: null,
              costStatus: "NOT_CALCULATED",
            },
          }
        } catch (error) {
          const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : "OPENAI_LISTING_REQUEST_FAILED"
          lastCode = code
          if (attempt === maxRetries || ![
            "OPENAI_LISTING_REQUEST_FAILED",
            "OPENAI_LISTING_HTTP_429",
            "OPENAI_LISTING_HTTP_500",
            "OPENAI_LISTING_HTTP_502",
            "OPENAI_LISTING_HTTP_503",
            "OPENAI_LISTING_HTTP_504",
          ].includes(code)) throw new Error(code)
        }
      }
      throw new Error(lastCode)
    },
  }
}
