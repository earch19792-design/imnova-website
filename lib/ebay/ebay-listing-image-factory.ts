import { createHash } from "node:crypto"

import sharp from "sharp"
import { z } from "zod"

// Node's native type stripping needs the explicit extension in direct tests.
// @ts-expect-error Next's bundler resolves the same TypeScript source at build time.
import { EBAY_IMAGE_OUTPUT_SIZE, optimizeAuthorizedEbayMainImage } from "./ebay-image-optimization-service.ts"

export const EBAY_LISTING_IMAGE_SET_VERSION =
  "EBAY_LISTING_IMAGE_COMPOSITION_SET_V1"
export const EBAY_OPENAI_BACKGROUND_PLATE_VERSION =
  "EBAY_OPENAI_BACKGROUND_PLATE_V1"
export const EBAY_OPENAI_IMAGE_PREVIEW_BRANCH =
  "feature/centralize-ebay-mobile-command-center"

const OPENAI_IMAGE_GENERATION_ENDPOINT =
  "https://api.openai.com/v1/images/generations"
const OPENAI_BACKGROUND_PLATE_MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const OPENAI_IMAGE_MODELS = new Set(["gpt-image-2"])

export const EBAY_LISTING_IMAGE_SLOTS = [
  "MAIN_WHITE_BACKGROUND",
  "PACK_AND_COUNT",
  "KEY_FEATURES",
  "SIZE_AND_CONTENT",
  "USE_CONTEXT",
  "PACKAGE_CONTENTS",
] as const

export type EbayListingImageSlot = typeof EBAY_LISTING_IMAGE_SLOTS[number]

const briefSchema = z.object({
  slot: z.enum(EBAY_LISTING_IMAGE_SLOTS),
  objective: z.string().trim().min(1).max(500),
  overlayText: z.string().trim().max(100).nullable(),
  preserveOriginalPackage: z.literal(true),
  sourcePolicy: z.literal("AUTHORIZED_PRODUCT_IMAGE_ONLY"),
}).strict()

const inputSchema = z.object({
  identityFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  facts: z.object({
    manufacturerBrand: z.string().trim().min(1).max(120).nullable(),
    normalizedProductName: z.string().trim().min(1).max(300),
    packCount: z.number().int().positive().nullable(),
    unitCount: z.number().int().positive().nullable(),
    size: z.string().trim().min(1).max(100).nullable(),
    color: z.string().trim().min(1).max(100).nullable(),
    scent: z.string().trim().min(1).max(100).nullable(),
    variant: z.string().trim().min(1).max(100).nullable(),
    condition: z.string().trim().min(1).max(100).nullable(),
  }).strict(),
  briefs: z.array(briefSchema).length(6),
}).strict()

export type EbayListingImageFactoryInput = z.infer<typeof inputSchema>

export type EbayListingImageComposition = {
  slot: EbayListingImageSlot
  output: Buffer
  outputSha256: string
  sourceSha256: string
  width: 1600
  height: 1600
  bytes: number
  transformation: {
    version: string
    slot: EbayListingImageSlot
    generativeAiUsed: boolean
    originalPackagePixelsPreserved: true
    competitorImageUsed: false
    verifiedFactsOnly: true
    backgroundPlateVersion?: string
    backgroundPlateRequestHash?: string
    backgroundPlateOutputSha256?: string
    backgroundPlateProviderRequestId?: string | null
  }
  qa: {
    automaticStatus: "PASSED" | "PARTIAL"
    format: "jpeg"
    dimensionsValid: true
    sourceHashRecorded: true
    outputHashRecorded: true
    textDerivedFromVerifiedFacts: true
    mainBackground: "PURE_WHITE" | "NOT_APPLICABLE"
    humanApprovalRequired: true
    manualChecksRequired: string[]
  }
}

export type EbayOpenAiBackgroundPlatePlan = {
  version: typeof EBAY_OPENAI_BACKGROUND_PLATE_VERSION
  context: "CLEAN_TECHNICAL_WORKBENCH" | "NEUTRAL_VANITY" |
    "CLEAN_HOME_SHELF" | "CLEAN_KITCHEN_COUNTER" | "NEUTRAL_STUDIO"
  prompt: string
  promptHash: string
  requestHash: string
  model: string
  imageCount: 1
  quality: "low"
  size: "1024x1024"
  sendsProductBytes: false
  sendsProductUrl: false
  sendsCompetitorData: false
}

export type EbayOpenAiBackgroundPlate = {
  output: Buffer
  outputSha256: string
  providerRequestId: string | null
  usage: {
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
  }
  plan: EbayOpenAiBackgroundPlatePlan
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character)
}

function titleCase(value: string | null) {
  if (!value) return null
  return value.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-US"))
}

function verifiedLines(
  slot: Exclude<EbayListingImageSlot, "MAIN_WHITE_BACKGROUND">,
  facts: EbayListingImageFactoryInput["facts"],
) {
  const pack = facts.packCount ? `${facts.packCount} Pack` : null
  const units = facts.unitCount ? `${facts.unitCount} Count Each` : null
  const size = titleCase(facts.size)
  const variant = titleCase(facts.scent ?? facts.color ?? facts.variant)
  const product = titleCase(facts.normalizedProductName) ?? facts.normalizedProductName
  const values: Record<typeof slot, Array<string | null>> = {
    PACK_AND_COUNT: [pack, units],
    KEY_FEATURES: [titleCase(facts.manufacturerBrand), variant, titleCase(facts.condition)],
    SIZE_AND_CONTENT: [size, units, pack],
    USE_CONTEXT: [product, "Product shown exactly as supplied"],
    PACKAGE_CONTENTS: ["You receive", pack, units, variant],
  }
  return values[slot].filter((value): value is string => Boolean(value)).slice(0, 4)
}

function wrap(value: string, maxCharacters = 30) {
  const words = value.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  for (const word of words) {
    const current = lines.at(-1)
    if (!current || `${current} ${word}`.length > maxCharacters) lines.push(word)
    else lines[lines.length - 1] = `${current} ${word}`
  }
  return lines.slice(0, 3)
}

function labelForSlot(slot: Exclude<EbayListingImageSlot, "MAIN_WHITE_BACKGROUND">) {
  return ({
    PACK_AND_COUNT: "PACK & COUNT",
    KEY_FEATURES: "VERIFIED PRODUCT FACTS",
    SIZE_AND_CONTENT: "SIZE & CONTENT",
    USE_CONTEXT: "PRODUCT VIEW",
    PACKAGE_CONTENTS: "PACKAGE CONTENTS",
  } satisfies Record<typeof slot, string>)[slot]
}

function infoCardSvg(
  slot: Exclude<EbayListingImageSlot, "MAIN_WHITE_BACKGROUND">,
  facts: EbayListingImageFactoryInput["facts"],
) {
  const lines = verifiedLines(slot, facts).flatMap((value) => wrap(value))
  const lineElements = lines.map((line, index) =>
    `<text x="800" y="${1180 + index * 78}" text-anchor="middle" ` +
    `font-family="Arial,Helvetica,sans-serif" font-size="48" font-weight="600" ` +
    `fill="#172033">${escapeXml(line)}</text>`,
  ).join("")
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600">` +
    `<rect width="1600" height="1600" rx="0" fill="#f7f9fc"/>` +
    `<rect x="130" y="1010" width="1340" height="470" rx="44" fill="#ffffff" ` +
    `stroke="#d8e0ed" stroke-width="4"/>` +
    `<text x="800" y="1100" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" ` +
    `font-size="34" font-weight="700" letter-spacing="3" fill="#4c5b73">` +
    `${escapeXml(labelForSlot(slot))}</text>${lineElements}</svg>`,
  )
}

async function composeInformationImage(
  normalizedMain: Buffer,
  slot: Exclude<EbayListingImageSlot, "MAIN_WHITE_BACKGROUND">,
  facts: EbayListingImageFactoryInput["facts"],
) {
  const packageLayer = await sharp(normalizedMain)
    .resize(880, 880, { fit: "contain", background: "#ffffff" })
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
    .toBuffer()
  return sharp(infoCardSvg(slot, facts))
    .composite([{ input: packageLayer, left: 360, top: 70 }])
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer()
}

function safeContextForFacts(facts: EbayListingImageFactoryInput["facts"]) {
  const identity = facts.normalizedProductName.toLocaleLowerCase("en-US")
  if (/battery|switch|adapter|connector|charger|cable|automotive|marine/.test(identity)) {
    return "CLEAN_TECHNICAL_WORKBENCH" as const
  }
  if (/skin|face|beauty|cosmetic|hair|shave|derma/.test(identity)) {
    return "NEUTRAL_VANITY" as const
  }
  if (/clean|wipe|household|laundry|kitchen|home/.test(identity)) {
    return "CLEAN_HOME_SHELF" as const
  }
  if (/food|coffee|drink|nutrition|supplement|snack/.test(identity)) {
    return "CLEAN_KITCHEN_COUNTER" as const
  }
  return "NEUTRAL_STUDIO" as const
}

function contextDescription(context: EbayOpenAiBackgroundPlatePlan["context"]) {
  return ({
    CLEAN_TECHNICAL_WORKBENCH:
      "a clean neutral technical workbench with soft daylight",
    NEUTRAL_VANITY:
      "a clean neutral vanity surface with soft natural daylight",
    CLEAN_HOME_SHELF:
      "a clean neutral home shelf with soft natural daylight",
    CLEAN_KITCHEN_COUNTER:
      "a clean neutral kitchen counter with soft natural daylight",
    NEUTRAL_STUDIO:
      "a clean neutral commercial studio surface with soft daylight",
  } satisfies Record<EbayOpenAiBackgroundPlatePlan["context"], string>)[context]
}

export function buildSafeOpenAiBackgroundPlatePlan(
  value: unknown,
  model: string,
) {
  const input = validateListingImageFactoryInput(value)
  if (!OPENAI_IMAGE_MODELS.has(model)) {
    throw new Error("EBAY_IMAGE_OPENAI_MODEL_NOT_ALLOWED")
  }
  const context = safeContextForFacts(input.facts)
  // Intentionally omit product name, brand, pack, variant and all source data.
  // The provider creates only an empty scene; authorized product pixels are
  // composited locally after the response is discarded.
  const prompt = [
    "Create a square unbranded commercial-photography BACKGROUND PLATE ONLY.",
    `Scene: ${contextDescription(context)}.`,
    "Keep the central 60 percent empty with a matte-white display surface.",
    "Do not include any product, package, container, label, logo, brand, text,",
    "symbol, watermark, person, hand, food, medicine, claim, measurement or quantity.",
    "Use realistic neutral lighting and a restrained professional composition.",
    "An exact authorized product photograph will be composited locally later.",
  ].join(" ")
  const promptHash = sha256Text(prompt)
  const requestHash = sha256Text(JSON.stringify({
    version: EBAY_OPENAI_BACKGROUND_PLATE_VERSION,
    identityFingerprint: input.identityFingerprint,
    context,
    model,
    promptHash,
    imageCount: 1,
    quality: "low",
    size: "1024x1024",
  }))
  return {
    version: EBAY_OPENAI_BACKGROUND_PLATE_VERSION,
    context,
    prompt,
    promptHash,
    requestHash,
    model,
    imageCount: 1,
    quality: "low",
    size: "1024x1024",
    sendsProductBytes: false,
    sendsProductUrl: false,
    sendsCompetitorData: false,
  } satisfies EbayOpenAiBackgroundPlatePlan
}

function finiteUsage(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null
}

async function readOpenAiResponseWithLimit(response: Response) {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > OPENAI_BACKGROUND_PLATE_MAX_RESPONSE_BYTES) {
    throw new Error("EBAY_IMAGE_OPENAI_RESPONSE_TOO_LARGE")
  }
  if (!response.body) throw new Error("EBAY_IMAGE_OPENAI_RESPONSE_MISSING")
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      total += value.byteLength
      if (total > OPENAI_BACKGROUND_PLATE_MAX_RESPONSE_BYTES) {
        await reader.cancel("EBAY_IMAGE_OPENAI_RESPONSE_TOO_LARGE")
        throw new Error("EBAY_IMAGE_OPENAI_RESPONSE_TOO_LARGE")
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total).toString("utf8")
}

export async function requestSafeOpenAiBackgroundPlate(input: {
  plan: EbayOpenAiBackgroundPlatePlan
  apiKey: string
  fetchImpl?: typeof fetch
}) {
  if (!OPENAI_IMAGE_MODELS.has(input.plan.model)) {
    throw new Error("EBAY_IMAGE_OPENAI_MODEL_NOT_ALLOWED")
  }
  if (!/^sk-[A-Za-z0-9_-]{8,}$/.test(input.apiKey.trim())) {
    throw new Error("EBAY_IMAGE_OPENAI_KEY_MISSING")
  }
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort("EBAY_IMAGE_OPENAI_TIMEOUT"),
    130_000,
  )
  try {
    const response = await (input.fetchImpl ?? fetch)(
      OPENAI_IMAGE_GENERATION_ENDPOINT,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${input.apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: input.plan.model,
          prompt: input.plan.prompt,
          n: 1,
          size: "1024x1024",
          quality: "low",
          output_format: "jpeg",
          output_compression: 85,
          background: "opaque",
          moderation: "auto",
        }),
        signal: controller.signal,
      },
    )
    const responseText = await readOpenAiResponseWithLimit(response)
    if (!response.ok) {
      throw new Error(`EBAY_IMAGE_OPENAI_HTTP_${response.status}`)
    }
    let payload: unknown
    try {
      payload = JSON.parse(responseText)
    } catch {
      throw new Error("EBAY_IMAGE_OPENAI_RESPONSE_INVALID")
    }
    const responseRecord = payload && typeof payload === "object"
      ? payload as Record<string, unknown>
      : {}
    const data = Array.isArray(responseRecord.data) ? responseRecord.data : []
    const first = data[0] && typeof data[0] === "object"
      ? data[0] as Record<string, unknown>
      : {}
    if (data.length !== 1 || typeof first.b64_json !== "string" || first.url) {
      throw new Error("EBAY_IMAGE_OPENAI_RESPONSE_INVALID")
    }
    const raw = Buffer.from(first.b64_json, "base64")
    if (!raw.length || raw.length > 12 * 1024 * 1024) {
      raw.fill(0)
      throw new Error("EBAY_IMAGE_OPENAI_OUTPUT_INVALID")
    }
    let output: Buffer
    try {
      const metadata = await sharp(raw).metadata()
      if (!metadata.width || !metadata.height || metadata.width !== metadata.height) {
        throw new Error("EBAY_IMAGE_OPENAI_OUTPUT_INVALID")
      }
      output = await sharp(raw)
        .resize(1600, 1600, { fit: "cover" })
        .jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toBuffer()
    } finally {
      raw.fill(0)
    }
    const usage = responseRecord.usage && typeof responseRecord.usage === "object"
      ? responseRecord.usage as Record<string, unknown>
      : {}
    const providerRequestId = response.headers.get("x-request-id")
    return {
      output,
      outputSha256: sha256(output),
      providerRequestId: providerRequestId && /^[A-Za-z0-9_-]{1,200}$/.test(providerRequestId)
        ? providerRequestId
        : null,
      usage: {
        inputTokens: finiteUsage(usage.input_tokens),
        outputTokens: finiteUsage(usage.output_tokens),
        totalTokens: finiteUsage(usage.total_tokens),
      },
      plan: input.plan,
    } satisfies EbayOpenAiBackgroundPlate
  } catch (error) {
    if (controller.signal.aborted) throw new Error("EBAY_IMAGE_OPENAI_TIMEOUT")
    if (error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)) {
      throw error
    }
    throw new Error("EBAY_IMAGE_OPENAI_NETWORK_FAILED")
  } finally {
    clearTimeout(timeout)
  }
}

function contextOverlaySvg(facts: EbayListingImageFactoryInput["facts"]) {
  const product = wrap(titleCase(facts.normalizedProductName) ?? facts.normalizedProductName)
  const lines = product.map((line, index) =>
    `<text x="800" y="${1370 + index * 58}" text-anchor="middle" ` +
    `font-family="Arial,Helvetica,sans-serif" font-size="42" font-weight="600" ` +
    `fill="#172033">${escapeXml(line)}</text>`,
  ).join("")
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600">` +
    `<rect x="170" y="1260" width="1260" height="280" rx="40" fill="#ffffff" ` +
    `fill-opacity="0.96" stroke="#d8e0ed" stroke-width="4"/>${lines}</svg>`,
  )
}

async function composeContextImage(
  normalizedMain: Buffer,
  facts: EbayListingImageFactoryInput["facts"],
  background: EbayOpenAiBackgroundPlate,
) {
  const packageLayer = await sharp(normalizedMain)
    .resize(860, 860, { fit: "contain", background: "#ffffff" })
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
    .toBuffer()
  const productPanel = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000">' +
    '<rect x="0" y="0" width="1000" height="1000" rx="52" fill="#ffffff" ' +
    'fill-opacity="0.96" stroke="#d8e0ed" stroke-width="4"/></svg>',
  )
  return sharp(background.output)
    .composite([
      { input: productPanel, left: 300, top: 130 },
      { input: packageLayer, left: 370, top: 200 },
      { input: contextOverlaySvg(facts), left: 0, top: 0 },
    ])
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer()
}

export function validateListingImageFactoryInput(value: unknown) {
  const input = inputSchema.parse(value)
  const slots = input.briefs.map((brief) => brief.slot)
  if (new Set(slots).size !== EBAY_LISTING_IMAGE_SLOTS.length) {
    throw new Error("EBAY_IMAGE_SET_SLOTS_DUPLICATED")
  }
  for (const required of EBAY_LISTING_IMAGE_SLOTS) {
    if (!slots.includes(required)) throw new Error("EBAY_IMAGE_SET_SLOT_MISSING")
  }
  return input
}

export async function composeAuthorizedEbayListingImageSet(
  source: Buffer,
  value: unknown,
  backgroundPlate: EbayOpenAiBackgroundPlate | null = null,
): Promise<EbayListingImageComposition[]> {
  const input = validateListingImageFactoryInput(value)
  const main = await optimizeAuthorizedEbayMainImage(source)
  const outputs: EbayListingImageComposition[] = []
  for (const slot of EBAY_LISTING_IMAGE_SLOTS) {
    const output = slot === "MAIN_WHITE_BACKGROUND"
      ? main.output
      : slot === "USE_CONTEXT" && backgroundPlate
        ? await composeContextImage(main.output, input.facts, backgroundPlate)
        : await composeInformationImage(main.output, slot, input.facts)
    const metadata = await sharp(output).metadata()
    if (
      metadata.format !== "jpeg" ||
      metadata.width !== EBAY_IMAGE_OUTPUT_SIZE ||
      metadata.height !== EBAY_IMAGE_OUTPUT_SIZE
    ) throw new Error("EBAY_IMAGE_SET_OUTPUT_INVALID")
    outputs.push({
      slot,
      output,
      outputSha256: sha256(output),
      sourceSha256: main.sourceSha256,
      width: 1600,
      height: 1600,
      bytes: output.length,
      transformation: {
        version: EBAY_LISTING_IMAGE_SET_VERSION,
        slot,
        generativeAiUsed: slot === "USE_CONTEXT" && Boolean(backgroundPlate),
        originalPackagePixelsPreserved: true,
        competitorImageUsed: false,
        verifiedFactsOnly: true,
        ...(slot === "USE_CONTEXT" && backgroundPlate ? {
          backgroundPlateVersion: backgroundPlate.plan.version,
          backgroundPlateRequestHash: backgroundPlate.plan.requestHash,
          backgroundPlateOutputSha256: backgroundPlate.outputSha256,
          backgroundPlateProviderRequestId: backgroundPlate.providerRequestId,
        } : {}),
      },
      qa: {
        automaticStatus: slot === "USE_CONTEXT" && backgroundPlate
          ? "PARTIAL"
          : "PASSED",
        format: "jpeg",
        dimensionsValid: true,
        sourceHashRecorded: true,
        outputHashRecorded: true,
        textDerivedFromVerifiedFacts: true,
        mainBackground: slot === "MAIN_WHITE_BACKGROUND" ? "PURE_WHITE" : "NOT_APPLICABLE",
        humanApprovalRequired: true,
        manualChecksRequired: [
          "MANUFACTURER_BRAND_MATCH",
          "PACK_AND_UNIT_COUNT_MATCH",
          "COLOR_SCENT_AND_VARIANT_MATCH",
          "NO_LABEL_OR_LOGO_ALTERATION",
          "NO_UNINCLUDED_ELEMENTS",
          "CLAIMS_AND_TEXT_APPROVED",
          ...(slot === "USE_CONTEXT" && backgroundPlate
            ? ["GENERATED_BACKGROUND_HAS_NO_PRODUCT_BRAND_TEXT_OR_PEOPLE"]
            : []),
        ],
      },
    })
  }
  return outputs
}

export function getListingImageFactoryConfiguration(environment = process.env) {
  let staging = false
  try {
    staging = new URL(environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "")
      .hostname.startsWith("vsfthqydfrdzulldbfbe.")
  } catch {
    staging = false
  }
  const preview = environment.VERCEL_ENV === "preview"
  const authorizedBranch =
    environment.VERCEL_GIT_COMMIT_REF === EBAY_OPENAI_IMAGE_PREVIEW_BRANCH
  const keyPresent = Boolean(environment.OPENAI_API_KEY?.trim())
  const enabled = environment.OPENAI_IMAGE_FACTORY_ENABLED?.trim() === "true"
    && environment.OPENAI_IMAGE_CONTEXT_PLATE_ENABLED?.trim() === "true"
  const model = environment.OPENAI_IMAGE_MODEL?.trim() ?? ""
  const modelPresent = Boolean(model)
  const modelAllowed = OPENAI_IMAGE_MODELS.has(model)
  const parsedDailyLimit = Number(environment.OPENAI_IMAGE_DAILY_CALL_LIMIT)
  const dailyCallLimit = Number.isInteger(parsedDailyLimit)
    ? Math.min(20, Math.max(1, parsedDailyLimit))
    : 5
  const aiGeneration = !enabled
    ? "DISABLED" as const
    : !preview || !staging || !authorizedBranch
      ? "BLOCKED_ENVIRONMENT" as const
      : !keyPresent || !modelAllowed
        ? "MISSING" as const
        : "READY" as const
  return {
    deterministicComposition: preview && staging ? "READY" as const : "BLOCKED" as const,
    aiGeneration,
    openAiKey: keyPresent ? "PRESENT" as const : "MISSING" as const,
    model: modelPresent
      ? modelAllowed ? "ALLOWED" as const : "NOT_ALLOWED" as const
      : "MISSING" as const,
    dailyCallLimit,
    maxContextPlatesPerSet: 1,
    imageQuality: "low" as const,
    contextPlateFeatureEnabled: enabled,
    preview,
    staging,
    authorizedBranch,
    expectedBranch: EBAY_OPENAI_IMAGE_PREVIEW_BRANCH,
    sourceRequired: true,
    humanApprovalRequired: true,
    competitorImagesAllowed: false,
    brandedPackageGenerationFromScratchAllowed: false,
    ebayWrites: 0,
    secretsReturned: false,
  }
}
