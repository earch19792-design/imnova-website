import { createHash } from "node:crypto"

import sharp from "sharp"
import { z } from "zod"

// Node's native type stripping needs the explicit extension in direct tests.
// @ts-expect-error Next's bundler resolves the same TypeScript source at build time.
import { EBAY_IMAGE_OUTPUT_SIZE, optimizeAuthorizedEbayMainImage } from "./ebay-image-optimization-service.ts"

export const EBAY_LISTING_IMAGE_SET_VERSION =
  "EBAY_LISTING_IMAGE_COMPOSITION_SET_V1"

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
    generativeAiUsed: false
    originalPackagePixelsPreserved: true
    competitorImageUsed: false
    verifiedFactsOnly: true
  }
  qa: {
    automaticStatus: "PASSED"
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

function sha256(value: Buffer) {
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
): Promise<EbayListingImageComposition[]> {
  const input = validateListingImageFactoryInput(value)
  const main = await optimizeAuthorizedEbayMainImage(source)
  const outputs: EbayListingImageComposition[] = []
  for (const slot of EBAY_LISTING_IMAGE_SLOTS) {
    const output = slot === "MAIN_WHITE_BACKGROUND"
      ? main.output
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
        generativeAiUsed: false,
        originalPackagePixelsPreserved: true,
        competitorImageUsed: false,
        verifiedFactsOnly: true,
      },
      qa: {
        automaticStatus: "PASSED",
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
  const keyPresent = Boolean(environment.OPENAI_API_KEY?.trim())
  const enabled = environment.OPENAI_IMAGE_FACTORY_ENABLED?.trim() === "true"
  const modelPresent = Boolean(environment.OPENAI_IMAGE_MODEL?.trim())
  return {
    deterministicComposition: preview && staging ? "READY" as const : "BLOCKED" as const,
    aiGeneration: preview && staging && keyPresent && enabled && modelPresent
      ? "READY" as const
      : enabled ? "MISSING" as const : "DISABLED" as const,
    openAiKey: keyPresent ? "PRESENT" as const : "MISSING" as const,
    model: modelPresent ? "PRESENT" as const : "MISSING" as const,
    preview,
    staging,
    sourceRequired: true,
    humanApprovalRequired: true,
    competitorImagesAllowed: false,
    brandedPackageGenerationFromScratchAllowed: false,
    ebayWrites: 0,
    secretsReturned: false,
  }
}
