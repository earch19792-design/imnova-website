// @ts-expect-error Node's native TypeScript test runner needs the extension.
import { parseAuthoritativeFactsInputPackage } from "./ebay-product-facts-readiness.ts"
// @ts-expect-error Node's native TypeScript test runner needs the extension.
import { EBAY_LISTING_IMAGE_SLOTS, validateListingImageFactoryInput, type EbayListingImageFactoryInput, type EbayListingImageSlot } from "./ebay-listing-image-factory.ts"
// @ts-expect-error Node's native TypeScript test runner needs the extension.
import { SAME_DAY_MANUAL_HANDOFF_VERSION } from "./ebay-same-day-manual-handoff.ts"

export const SAME_DAY_IMAGE_FACTORY_INPUT_VERSION =
  "SAME_DAY_FACT_ONLY_IMAGE_FACTORY_INPUT_V1_2026_07_18"
export const VERIFIED_ACTIVE_HISTORICAL_HANDOFF_VERSION =
  "SELLER_HUB_FACTS_ONLY_V7_2026_07_20"

type JsonRecord = Record<string, unknown>

export type CurrentSameDayImageFactBinding = {
  candidateId: string
  factRunId: string
  factPackageHash: string
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function safeText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ")
    .slice(0, maximum)
  if (!normalized || /(?:https?:\/\/|data:|blob:|base64)/i.test(normalized)) return null
  return normalized
}

function positiveInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function scalarText(value: unknown, maximum: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value).slice(0, maximum)
  }
  return safeText(value, maximum)
}

function objectiveForSlot(slot: EbayListingImageSlot) {
  return ({
    MAIN_WHITE_BACKGROUND:
      "Preserve the exact authorized product and package on a pure white background.",
    PACK_AND_COUNT:
      "Present only the verified offer pack and unit count without adding, removing or redrawing units.",
    KEY_FEATURES:
      "Present only verified product facts while preserving the exact authorized package.",
    SIZE_AND_CONTENT:
      "Clarify only verified size and content facts without changing the product presentation.",
    USE_CONTEXT:
      "Place the unchanged authorized product in a neutral context that makes no performance claim.",
    PACKAGE_CONTENTS:
      "Show exactly what the verified offer contains and no additional product or accessory.",
  } satisfies Record<EbayListingImageSlot, string>)[slot]
}

/**
 * Builds the strict six-slot image-factory input from the current same-day
 * facts boundary. It intentionally does not read image URLs, product bytes,
 * marketplace observations or listing-generation output. The authorized
 * source image remains a separate, rights-checked input to the compositor.
 */
export function buildCurrentSameDayImageFactoryInput(input: {
  handoffPackage: unknown
  authoritativeFactsPackage: unknown
  currentBinding: CurrentSameDayImageFactBinding
  allowVerifiedActiveHistoricalHandoff?: boolean
}): EbayListingImageFactoryInput {
  const handoff = record(input.handoffPackage)
  const safety = record(handoff.safety)
  const images = record(handoff.images)
  const candidateId = safeText(input.currentBinding.candidateId, 200)
  const factRunId = safeText(input.currentBinding.factRunId, 200)
  const expectedHash = safeText(input.currentBinding.factPackageHash, 80)

  if (!candidateId || !factRunId || !expectedHash ||
    !/^sha256:[0-9a-f]{64}$/.test(expectedHash)) {
    throw new Error("SAME_DAY_IMAGE_CURRENT_BINDING_INVALID")
  }
  const handoffVersionCurrent = handoff.version === SAME_DAY_MANUAL_HANDOFF_VERSION
  const historicalMaintenanceAllowed =
    input.allowVerifiedActiveHistoricalHandoff === true &&
    handoff.version === VERIFIED_ACTIVE_HISTORICAL_HANDOFF_VERSION
  if ((!handoffVersionCurrent && !historicalMaintenanceAllowed) ||
    safeText(handoff.candidateId, 200) !== candidateId ||
    safeText(handoff.factRunId, 200) !== factRunId) {
    throw new Error("SAME_DAY_IMAGE_HANDOFF_STALE")
  }
  if (safety.factsOnly !== true || safety.openAiCalls !== 0 ||
    safety.ebayWrites !== 0 || safety.competitorContentUsed !== false) {
    throw new Error("SAME_DAY_IMAGE_HANDOFF_SAFETY_INVALID")
  }
  if (images.source !== "LUNA_AUTHORIZED_CATALOG" ||
    images.competitorImages !== 0 || !positiveInteger(images.count)) {
    throw new Error("SAME_DAY_IMAGE_AUTHORIZED_SOURCE_REQUIRED")
  }

  const factsPackage = parseAuthoritativeFactsInputPackage(
    input.authoritativeFactsPackage,
  )
  if (!factsPackage) throw new Error("SAME_DAY_IMAGE_FACT_PACKAGE_INVALID")
  if (factsPackage.factPackageHash !== expectedHash ||
    safety.authoritativeFactPackageHash !== expectedHash) {
    throw new Error("SAME_DAY_IMAGE_FACT_PACKAGE_STALE")
  }

  const fact = (scope: string, ...keys: string[]) => factsPackage.facts.find(
    (entry) => entry.scope === scope && keys.some((key) =>
      entry.key.toLocaleLowerCase("en-US") === key.toLocaleLowerCase("en-US")),
  )
  const factText = (scope: string, maximum: number, ...keys: string[]) =>
    safeText(fact(scope, ...keys)?.value, maximum)
  const factInteger = (scope: string, ...keys: string[]) =>
    positiveInteger(fact(scope, ...keys)?.value)

  const normalizedProductName = factText(
    "PRODUCT_UNIT",
    300,
    "exactProductName",
  )
  const manufacturerBrand = factText("PRODUCT_UNIT", 120, "brand")
  const condition = factText("PRODUCT_UNIT", 100, "condition")
  const packCount = factInteger("OFFER_PACK", "offerPackCount")
  const unitCount = factInteger("PRODUCT_UNIT", "unitCount") ??
    factInteger("OFFER_PACK", "unitsPerPack")
  const totalUnitCount = factInteger("OFFER_PACK", "totalUnitCount")
  if (!normalizedProductName || !manufacturerBrand || !condition ||
    !packCount || !unitCount || !totalUnitCount ||
    totalUnitCount !== packCount * unitCount) {
    throw new Error("SAME_DAY_IMAGE_EXACT_PRODUCT_FACTS_REQUIRED")
  }

  const netContent = fact("PRODUCT_UNIT", "netContent")
  const netContentValue = scalarText(netContent?.value, 60)
  const netContentUnit = safeText(netContent?.unit, 30) ??
    factText("PRODUCT_UNIT", 30, "netContentUnit")
  const size = netContentValue
    ? netContentUnit && /^\d+(?:\.\d+)?$/.test(netContentValue)
      ? `${netContentValue} ${netContentUnit}`.slice(0, 100)
      : netContentValue
    : null

  return validateListingImageFactoryInput({
    // The immutable authoritative package hash binds the exact unit, variant
    // and offer pack without relying on a content-generation record.
    identityFingerprint: factsPackage.factPackageHash,
    facts: {
      manufacturerBrand,
      normalizedProductName,
      packCount,
      unitCount,
      size,
      color: factText("PRODUCT_UNIT", 100, "color"),
      scent: factText("PRODUCT_UNIT", 100, "scent"),
      variant: factText(
        "PRODUCT_UNIT",
        100,
        "variant",
        "formulation",
        "flavor",
      ),
      condition,
    },
    briefs: EBAY_LISTING_IMAGE_SLOTS.map((slot) => ({
      slot,
      objective: objectiveForSlot(slot),
      overlayText: null,
      preserveOriginalPackage: true as const,
      sourcePolicy: "AUTHORIZED_PRODUCT_IMAGE_ONLY" as const,
    })),
  })
}
