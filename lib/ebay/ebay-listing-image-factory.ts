import { createHash } from "node:crypto"

import sharp from "sharp"
import { z } from "zod"

// Node's native type stripping needs the explicit extension in direct tests.
// @ts-expect-error Next's bundler resolves the same TypeScript source at build time.
import { EBAY_IMAGE_OUTPUT_SIZE, optimizeAuthorizedEbayMainImage } from "./ebay-image-optimization-service.ts"
// @ts-expect-error Node's native TypeScript test runner needs the extension.
import { ebayImageMarketBriefSchema, type EbayImageMarketBrief } from "./ebay-image-market-brief.ts"

export const EBAY_LISTING_IMAGE_SET_VERSION =
  "EBAY_LISTING_IMAGE_COMPOSITION_SET_V1"
export const EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION =
  "EBAY_IMAGE_COMPOSITOR_DIVERSITY_V4_2026_07_21"
export const EBAY_OPENAI_BACKGROUND_PLATE_VERSION =
  "EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V2"
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
  marketVisualBrief: ebayImageMarketBriefSchema.nullable().default(null),
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
    layoutId: string
    compositorContractVersion: typeof EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION
    authorizedSourceIndex: number
    presentationMode: "AUTHORIZED_MULTI_SOURCE" | "SINGLE_SOURCE_INFORMATIONAL"
    authorizedSourceTreatment: "NORMALIZED_LIGHT_NEUTRAL" |
      "PRESERVED_FRAMED_SOURCE"
    generativeAiUsed: boolean
    originalPackagePixelsPreserved: true
    competitorImageUsed: false
    verifiedFactsOnly: true
    mainEncodingProfile?: "JPEG_Q93_444_MOZJPEG_V3"
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
    mainBackground: "PURE_WHITE" | "FRAMED_AUTHORIZED_SOURCE" |
      "NOT_APPLICABLE"
    humanApprovalRequired: true
    structuralDiversityVerified: true
    foregroundEdgeCoverage: number
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
  size: "1536x1024"
  sendsProductBytes: false
  sendsProductUrl: false
  sendsCompetitorData: false
  sendsVerifiedProductFacts: true
  sendsAggregatedMarketPatterns: boolean
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

const LISTING_FONT_FILE = `${process.cwd()}/public/fonts/DejaVuSans.ttf`

async function renderVerifiedText(input: {
  value: string
  width: number
  height: number
  size: number
  bold?: boolean
}) {
  const value = input.value.normalize("NFKC").trim()
  if (!value) throw new Error("EBAY_IMAGE_TEXT_REQUIRED")
  const fontDescription = `DejaVu Sans ${input.bold ? "Bold" : "Book"} ${input.size}`
  const output = await sharp({
    text: {
      text: `<span font_desc="${fontDescription}" foreground="#172033">${escapeXml(value)}</span>`,
      font: "DejaVu Sans",
      fontfile: LISTING_FONT_FILE,
      width: input.width,
      height: input.height,
      align: "centre",
      rgba: true,
      spacing: 8,
    },
  }).png().toBuffer()
  const rendered = await sharp(output).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true })
  let visiblePixels = 0
  for (let index = 3; index < rendered.data.length; index += rendered.info.channels) {
    if (rendered.data[index] > 24) visiblePixels += 1
  }
  const minimum = Math.max(32, Math.min(400, value.replace(/\s+/g, "").length * 4))
  if (visiblePixels < minimum) throw new Error("EBAY_IMAGE_TEXT_NOT_RENDERED")
  return output
}

function titleCase(value: string | null) {
  if (!value) return null
  return value.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-US"))
}

function isSingleCompleteSet(facts: EbayListingImageFactoryInput["facts"]) {
  return facts.packCount === 1 && Boolean(facts.unitCount && facts.unitCount > 1) &&
    /\b(?:set|kit)\b/iu.test(facts.normalizedProductName)
}

function verifiedLines(
  slot: Exclude<EbayListingImageSlot, "MAIN_WHITE_BACKGROUND">,
  facts: EbayListingImageFactoryInput["facts"],
) {
  const completeSet = isSingleCompleteSet(facts)
  const pack = facts.packCount
    ? completeSet ? "1 Complete Set" : `${facts.packCount} Pack`
    : null
  const units = facts.unitCount
    ? completeSet ? `${facts.unitCount} Pieces Total` : `${facts.unitCount} Count Each`
    : null
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

function labelForSlot(
  slot: Exclude<EbayListingImageSlot, "MAIN_WHITE_BACKGROUND">,
  facts: EbayListingImageFactoryInput["facts"],
) {
  if (slot === "SIZE_AND_CONTENT" && !titleCase(facts.size)) {
    return isSingleCompleteSet(facts) ? "SET CONTENTS" : "PRODUCT CONTENTS"
  }
  return ({
    PACK_AND_COUNT: "PACK & COUNT",
    KEY_FEATURES: "VERIFIED PRODUCT FACTS",
    SIZE_AND_CONTENT: "SIZE & CONTENT",
    USE_CONTEXT: "PRODUCT VIEW",
    PACKAGE_CONTENTS: "PACKAGE CONTENTS",
  } satisfies Record<typeof slot, string>)[slot]
}

async function canonicalizeMainForV3(normalizedMain: Buffer) {
  return sharp(normalizedMain)
    .jpeg({ quality: 93, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer()
}

type InformationSlot = Exclude<EbayListingImageSlot, "MAIN_WHITE_BACKGROUND">

const INFORMATION_LAYOUTS = {
  PACK_AND_COUNT: {
    id: "PACK_COUNT_SPLIT_V2", packageSize: 980, packageLeft: 50, packageTop: 310,
    textLeft: 990, textTop: 340, textWidth: 520, textHeight: 760,
  },
  KEY_FEATURES: {
    id: "FEATURES_ASYMMETRIC_V2", packageSize: 1120, packageLeft: 500, packageTop: 230,
    textLeft: 70, textTop: 270, textWidth: 520, textHeight: 820,
  },
  SIZE_AND_CONTENT: {
    id: "SIZE_CONTENT_DIAGONAL_V2", packageSize: 900, packageLeft: 650, packageTop: 590,
    textLeft: 100, textTop: 120, textWidth: 760, textHeight: 650,
  },
  USE_CONTEXT: {
    id: "NEUTRAL_STUDIO_CONTEXT_V2", packageSize: 820, packageLeft: 390, packageTop: 260,
    textLeft: 250, textTop: 1190, textWidth: 1100, textHeight: 300,
  },
  PACKAGE_CONTENTS: {
    id: "PACKAGE_CONTENTS_OVERVIEW_V2", packageSize: 1030, packageLeft: 285, packageTop: 80,
    textLeft: 210, textTop: 1130, textWidth: 1180, textHeight: 360,
  },
} satisfies Record<InformationSlot, {
  id: string
  packageSize: number
  packageLeft: number
  packageTop: number
  textLeft: number
  textTop: number
  textWidth: number
  textHeight: number
}>

function informationCanvasSvg(
  slot: InformationSlot,
  facts: EbayListingImageFactoryInput["facts"],
) {
  const indicatorCount = facts.packCount && facts.packCount <= 12
    ? facts.packCount
    : 0
  const columns = Math.min(indicatorCount, 6)
  const spacing = columns > 1 ? 900 / (columns - 1) : 0
  const startX = columns > 1 ? 350 : 800
  const packIndicators = Array.from({ length: indicatorCount }, (_, index) => {
    const column = index % 6
    const row = Math.floor(index / 6)
    return `<circle cx="${startX + column * spacing}" cy="${1260 + row * 160}" r="48" fill="#d9c6aa"/>`
  }).join("")
  const artwork = ({
    PACK_AND_COUNT:
      '<rect width="1600" height="1600" fill="#f5efe4"/><circle cx="480" cy="800" r="610" fill="#fff"/><rect x="950" y="250" width="590" height="1100" rx="70" fill="#e7d6bd"/>',
    KEY_FEATURES:
      '<rect width="1600" height="1600" fill="#eaf2f4"/><circle cx="1230" cy="760" r="720" fill="#fff"/><rect x="55" y="210" width="575" height="980" rx="56" fill="#d7e6e8"/>',
    SIZE_AND_CONTENT:
      '<rect width="1600" height="1600" fill="#f1f4ee"/><path d="M0 0h1180L0 1180z" fill="#dbe7d7"/><circle cx="1110" cy="1080" r="500" fill="#fff"/>',
    USE_CONTEXT:
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#edf2f2"/><stop offset="1" stop-color="#d7dfdc"/></linearGradient></defs><rect width="1600" height="1600" fill="url(#g)"/><ellipse cx="800" cy="1115" rx="500" ry="95" fill="#9aa7a3" opacity=".28"/><rect x="245" y="1040" width="1110" height="170" rx="70" fill="#f9faf8"/>',
    PACKAGE_CONTENTS:
      '<rect width="1600" height="1600" fill="#f7f3ee"/><rect x="120" y="60" width="1360" height="1080" rx="72" fill="#fff"/>' + packIndicators,
  } satisfies Record<InformationSlot, string>)[slot]
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600">${artwork}</svg>`)
}

async function composeInformationImage(
  normalizedMain: Buffer,
  slot: InformationSlot,
  facts: EbayListingImageFactoryInput["facts"],
  sceneBackground: Buffer | null = null,
) {
  const layout = INFORMATION_LAYOUTS[slot]
  const packageLayer = await sharp(normalizedMain)
    .resize(layout.packageSize, layout.packageSize, { fit: "contain", background: "#ffffff" })
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
    .toBuffer()
  const lines = verifiedLines(slot, facts).flatMap((value) => wrap(value))
  const header = await renderVerifiedText({
    value: labelForSlot(slot, facts), width: layout.textWidth, height: 100, size: 30, bold: true,
  })
  const body = await renderVerifiedText({
    value: lines.join("\n"), width: layout.textWidth,
    height: Math.max(140, layout.textHeight - 130), size: 42, bold: true,
  })
  const textBackdrop = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.textWidth}" height="${layout.textHeight}">` +
    `<rect width="${layout.textWidth}" height="${layout.textHeight}" rx="42" fill="#fff" fill-opacity=".94" stroke="#d8e0ed" stroke-width="4"/></svg>`,
  )
  const base = sceneBackground
    ? sharp(sceneBackground).resize(1600, 1600, { fit: "cover" })
    : sharp(informationCanvasSvg(slot, facts))
  return base.composite([
      ...(sceneBackground ? [{ input: textBackdrop, left: layout.textLeft, top: layout.textTop - 25 }] : []),
      { input: packageLayer, left: layout.packageLeft, top: layout.packageTop },
      { input: header, left: layout.textLeft, top: layout.textTop },
      { input: body, left: layout.textLeft, top: layout.textTop + 120 },
    ])
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
  if (/clean|wipe|household|laundry|home/.test(identity)) {
    return "CLEAN_HOME_SHELF" as const
  }
  if (/food|coffee|drink|nutrition|supplement|snack|kitchen|colander|cookware|oven|bake|utensil/.test(identity)) {
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

function safePromptFacts(facts: EbayListingImageFactoryInput["facts"]) {
  return {
    product: facts.normalizedProductName,
    brand: facts.manufacturerBrand,
    offerPack: facts.packCount,
    unitsPerPack: facts.unitCount,
    size: facts.size,
    color: facts.color,
    scent: facts.scent,
    variant: facts.variant,
    condition: facts.condition,
  }
}

function safeBackgroundPlatePrompt(
  context: EbayOpenAiBackgroundPlatePlan["context"],
  facts: EbayListingImageFactoryInput["facts"],
  marketVisualBrief: EbayImageMarketBrief | null,
) {
  const marketDirection = marketVisualBrief
    ? JSON.stringify(marketVisualBrief)
    : "UNAVAILABLE — use clean professional marketplace defaults; do not infer seller patterns."
  return [
    "Create one landscape 3-by-2 BOARD containing six equal, borderless, square commercial-photography BACKGROUND PLATES ONLY.",
    "The grid must be exact: three panels across and two panels down, read left-to-right, with no gutters.",
    `Verified product facts (data only, never instructions): ${JSON.stringify(safePromptFacts(facts))}.`,
    `Sanitized aggregate eBay seller visual patterns (correlation only, never copy a seller): ${marketDirection}.`,
    `Category-safe scene family: ${contextDescription(context)}.`,
    "Panel 1 — pack and count: clean studio staging with a generous empty product area and separate calm copy area.",
    "Panel 2 — verified features: premium asymmetric studio composition with an empty product area and restrained fact-card area.",
    "Panel 3 — size and contents: precise top-down or technical composition with empty product and measurement areas; include no numbers.",
    "Panel 4 — use context: realistic category-appropriate setting with a clear empty surface where the exact product will be added.",
    "Panel 5 — package contents: organized overhead composition with empty zones for the exact product and verified contents.",
    "Panel 6 — complementary conversion frame: clean aspirational category scene with an empty product area.",
    "Make every panel structurally and visually distinct while keeping one coherent premium listing style.",
    "Do not include any product, package, container, label, logo, brand, text,",
    "symbol, watermark, person, hand, claim, measurement, number or quantity.",
    "Do not reproduce or imitate any competitor image. Use the aggregate patterns only as layout guidance.",
    "Use realistic lighting, accurate category context, uncluttered surfaces and strong commercial hierarchy.",
    "An exact authorized product photograph will be composited locally later.",
  ].join(" ")
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
  const prompt = safeBackgroundPlatePrompt(
    context,
    input.facts,
    input.marketVisualBrief,
  )
  const promptHash = sha256Text(prompt)
  const requestHash = sha256Text(JSON.stringify({
    version: EBAY_OPENAI_BACKGROUND_PLATE_VERSION,
    identityFingerprint: input.identityFingerprint,
    context,
    model,
    promptHash,
    imageCount: 1,
    quality: "low",
    size: "1536x1024",
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
    size: "1536x1024",
    sendsProductBytes: false,
    sendsProductUrl: false,
    sendsCompetitorData: false,
    sendsVerifiedProductFacts: true,
    sendsAggregatedMarketPatterns: Boolean(input.marketVisualBrief),
  } satisfies EbayOpenAiBackgroundPlatePlan
}

function finiteUsage(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null
}

function validOpenAiApiKey(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : ""

  return (
    normalized.length >= 20 &&
    normalized.length <= 4_096 &&
    !/[\u0000-\u0020\u007f-\u009f\u00a0\u200b-\u200f\u2028-\u202f\u2060\ufeff]/u.test(
      normalized,
    )
  )
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
  if (
    input.plan.version !== EBAY_OPENAI_BACKGROUND_PLATE_VERSION
    || input.plan.promptHash !== sha256Text(input.plan.prompt)
    || input.plan.imageCount !== 1
    || input.plan.quality !== "low"
    || input.plan.size !== "1536x1024"
    || input.plan.sendsProductBytes !== false
    || input.plan.sendsProductUrl !== false
    || input.plan.sendsCompetitorData !== false
    || input.plan.sendsVerifiedProductFacts !== true
  ) {
    throw new Error("EBAY_IMAGE_OPENAI_PLAN_NOT_ALLOWED")
  }
  if (!validOpenAiApiKey(input.apiKey)) {
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
          size: "1536x1024",
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
      if (metadata.width !== 1536 || metadata.height !== 1024) {
        throw new Error("EBAY_IMAGE_OPENAI_OUTPUT_INVALID")
      }
      output = await sharp(raw)
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

async function composeContextImage(
  normalizedMain: Buffer,
  facts: EbayListingImageFactoryInput["facts"],
  background: Buffer,
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
  const productText = await renderVerifiedText({
    value: wrap(titleCase(facts.normalizedProductName) ?? facts.normalizedProductName).join("\n"),
    width: 1160, height: 220, size: 38, bold: true,
  })
  return sharp(background)
    .composite([
      { input: productPanel, left: 300, top: 130 },
      { input: packageLayer, left: 370, top: 200 },
      { input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1260" height="280"><rect width="1260" height="280" rx="40" fill="#fff" fill-opacity=".96" stroke="#d8e0ed" stroke-width="4"/></svg>'), left: 170, top: 1260 },
      { input: productText, left: 220, top: 1290 },
    ])
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer()
}

const SCENE_BOARD_PANEL_INDEX = {
  PACK_AND_COUNT: 0,
  KEY_FEATURES: 1,
  SIZE_AND_CONTENT: 2,
  USE_CONTEXT: 3,
  PACKAGE_CONTENTS: 4,
} satisfies Record<InformationSlot, number>

async function sceneBoardPanel(
  sceneBoard: EbayOpenAiBackgroundPlate,
  slot: InformationSlot,
) {
  const index = SCENE_BOARD_PANEL_INDEX[slot]
  const left = index % 3 * 512
  const top = Math.floor(index / 3) * 512
  return sharp(sceneBoard.output)
    .extract({ left, top, width: 512, height: 512 })
    .resize(1600, 1600, { fit: "cover" })
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer()
}

type StructuralSignature = {
  pixels: Buffer
  edges: Uint8Array
  edgeCoverage: number
}

async function structuralSignature(value: Buffer): Promise<StructuralSignature> {
  const size = 64
  const pixels = await sharp(value).resize(size, size, { fit: "fill" })
    .greyscale().raw().toBuffer()
  const edges = new Uint8Array(pixels.length)
  let visibleEdges = 0
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const index = y * size + x
      const horizontal = Math.abs(pixels[index + 1] - pixels[index - 1])
      const vertical = Math.abs(pixels[index + size] - pixels[index - size])
      const magnitude = Math.min(255, horizontal + vertical)
      edges[index] = magnitude
      if (magnitude >= 24) visibleEdges += 1
    }
  }
  const edgeCoverage = visibleEdges / ((size - 2) * (size - 2))
  if (edgeCoverage < 0.004) {
    pixels.fill(0)
    edges.fill(0)
    throw new Error("EBAY_IMAGE_SET_FOREGROUND_STRUCTURE_MISSING")
  }
  return { pixels, edges, edgeCoverage }
}

function structuralDistance(left: StructuralSignature, right: StructuralSignature) {
  let pixelDifference = 0
  let edgeDifference = 0
  let edgeIntersection = 0
  let edgeUnion = 0
  for (let index = 0; index < left.pixels.length; index += 1) {
    pixelDifference += Math.abs(left.pixels[index] - right.pixels[index])
    edgeDifference += Math.abs(left.edges[index] - right.edges[index])
    const leftEdge = left.edges[index] >= 24
    const rightEdge = right.edges[index] >= 24
    if (leftEdge && rightEdge) edgeIntersection += 1
    if (leftEdge || rightEdge) edgeUnion += 1
  }
  return {
    pixelMae: pixelDifference / left.pixels.length,
    edgeMae: edgeDifference / left.edges.length,
    edgeOverlap: edgeUnion ? edgeIntersection / edgeUnion : 1,
  }
}

function sourceIndexForSlot(slot: EbayListingImageSlot, sourceCount: number) {
  const preferred = ({
    MAIN_WHITE_BACKGROUND: 0,
    PACK_AND_COUNT: 0,
    KEY_FEATURES: 1,
    SIZE_AND_CONTENT: 2,
    USE_CONTEXT: 1,
    PACKAGE_CONTENTS: 2,
  } satisfies Record<EbayListingImageSlot, number>)[slot]
  return Math.min(preferred, sourceCount - 1)
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
  source: Buffer | Buffer[],
  value: unknown,
  backgroundPlate: EbayOpenAiBackgroundPlate | null = null,
): Promise<EbayListingImageComposition[]> {
  const input = validateListingImageFactoryInput(value)
  const sources = (Array.isArray(source) ? source : [source]).slice(0, 3)
  if (!sources.length || sources.some((entry) => !Buffer.isBuffer(entry) || !entry.length)) {
    throw new Error("EBAY_IMAGE_AUTHORIZED_SOURCES_INVALID")
  }
  const mains = await Promise.all(sources.map((entry) =>
    optimizeAuthorizedEbayMainImage(entry)))
  const outputs: EbayListingImageComposition[] = []
  const signatures: StructuralSignature[] = []
  const presentationMode = sources.length > 1
    ? "AUTHORIZED_MULTI_SOURCE" as const
    : "SINGLE_SOURCE_INFORMATIONAL" as const
  for (const slot of EBAY_LISTING_IMAGE_SLOTS) {
    const authorizedSourceIndex = sourceIndexForSlot(slot, mains.length)
    const main = mains[authorizedSourceIndex]
    const framedAuthorizedSource =
      main.transformation.backgroundMethod === "AUTHORIZED_SOURCE_FRAMED_CONTAIN"
    const generatedPanel = slot !== "MAIN_WHITE_BACKGROUND" && backgroundPlate
      ? await sceneBoardPanel(backgroundPlate, slot)
      : null
    const output = slot === "MAIN_WHITE_BACKGROUND"
      ? await canonicalizeMainForV3(main.output)
      : slot === "USE_CONTEXT" && generatedPanel
        ? await composeContextImage(main.output, input.facts, generatedPanel)
        : await composeInformationImage(
          main.output,
          slot,
          input.facts,
          generatedPanel,
        )
    generatedPanel?.fill(0)
    const metadata = await sharp(output).metadata()
    if (
      metadata.format !== "jpeg" ||
      metadata.width !== EBAY_IMAGE_OUTPUT_SIZE ||
      metadata.height !== EBAY_IMAGE_OUTPUT_SIZE
    ) throw new Error("EBAY_IMAGE_SET_OUTPUT_INVALID")
    const signature = await structuralSignature(output)
    for (const previous of signatures) {
      const distance = structuralDistance(signature, previous)
      if (distance.pixelMae < 5 || distance.edgeMae < 2 ||
        distance.edgeOverlap > 0.94) {
        signature.pixels.fill(0)
        signature.edges.fill(0)
        for (const stored of signatures) {
          stored.pixels.fill(0)
          stored.edges.fill(0)
        }
        throw new Error("EBAY_IMAGE_SET_PERCEPTUALLY_DUPLICATED")
      }
    }
    const layoutId = slot === "MAIN_WHITE_BACKGROUND"
      ? "MAIN_WHITE_BACKGROUND_CANONICAL_V3"
      : backgroundPlate
        ? `OPENAI_COMMERCIAL_SCENE_${slot}_V4`
        : INFORMATION_LAYOUTS[slot].id
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
        layoutId,
        compositorContractVersion: EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION,
        authorizedSourceIndex,
        presentationMode,
        authorizedSourceTreatment: framedAuthorizedSource
          ? "PRESERVED_FRAMED_SOURCE"
          : "NORMALIZED_LIGHT_NEUTRAL",
        generativeAiUsed: slot !== "MAIN_WHITE_BACKGROUND" && Boolean(backgroundPlate),
        originalPackagePixelsPreserved: true,
        competitorImageUsed: false,
        verifiedFactsOnly: true,
        ...(slot === "MAIN_WHITE_BACKGROUND" ? {
          mainEncodingProfile: "JPEG_Q93_444_MOZJPEG_V3" as const,
        } : {}),
        ...(slot !== "MAIN_WHITE_BACKGROUND" && backgroundPlate ? {
          backgroundPlateVersion: backgroundPlate.plan.version,
          backgroundPlateRequestHash: backgroundPlate.plan.requestHash,
          backgroundPlateOutputSha256: backgroundPlate.outputSha256,
          backgroundPlateProviderRequestId: backgroundPlate.providerRequestId,
        } : {}),
      },
      qa: {
        automaticStatus: framedAuthorizedSource ||
          (slot !== "MAIN_WHITE_BACKGROUND" && backgroundPlate)
          ? "PARTIAL"
          : "PASSED",
        format: "jpeg",
        dimensionsValid: true,
        sourceHashRecorded: true,
        outputHashRecorded: true,
        textDerivedFromVerifiedFacts: true,
        mainBackground: slot === "MAIN_WHITE_BACKGROUND"
          ? framedAuthorizedSource ? "FRAMED_AUTHORIZED_SOURCE" : "PURE_WHITE"
          : "NOT_APPLICABLE",
        humanApprovalRequired: true,
        structuralDiversityVerified: true,
        foregroundEdgeCoverage: signature.edgeCoverage,
        manualChecksRequired: [
          "MANUFACTURER_BRAND_MATCH",
          "PACK_AND_UNIT_COUNT_MATCH",
          "COLOR_SCENT_AND_VARIANT_MATCH",
          "NO_LABEL_OR_LOGO_ALTERATION",
          "NO_UNINCLUDED_ELEMENTS",
          "CLAIMS_AND_TEXT_APPROVED",
          ...(slot !== "MAIN_WHITE_BACKGROUND" && backgroundPlate
            ? ["GENERATED_BACKGROUND_HAS_NO_PRODUCT_BRAND_TEXT_OR_PEOPLE"]
            : []),
          ...(presentationMode === "SINGLE_SOURCE_INFORMATIONAL"
            ? ["SINGLE_SOURCE_INFORMATIONAL_PANELS_NOT_MULTIPLE_PRODUCT_VIEWS"]
            : []),
          ...(framedAuthorizedSource ? [
            "AUTHORIZED_SOURCE_FRAME_PRESERVED_WITHOUT_BACKGROUND_REMOVAL",
            "FRAMED_MAIN_BACKGROUND_HUMAN_ACCEPTANCE",
          ] : []),
        ],
      },
    })
    signatures.push(signature)
  }
  for (const signature of signatures) {
    signature.pixels.fill(0)
    signature.edges.fill(0)
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
  const keyPresent = validOpenAiApiKey(environment.OPENAI_API_KEY)
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
