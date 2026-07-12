export const EBAY_PRODUCT_RESTRICTION_GUARDS_VERSION =
  "EBAY-MARKET-VALIDATION-WITH-RESTRICTION-GUARDS-V1"

export type ProductRestrictionGuard =
  | "NEED_SHIPPING_RESTRICTION_REVIEW"
  | "NEED_HAZMAT_OR_AEROSOL_REVIEW"
  | "NEED_BRAND_REVIEW"
  | "NEED_HEALTH_CLAIMS_REVIEW"
  | "NEED_BABY_PRODUCT_REVIEW"
  | "NEED_BATTERY_OR_LITHIUM_REVIEW"
  | "NEED_CHEMICAL_PRODUCT_REVIEW"

export type ProductRestrictionRiskType =
  | "PAINT_SPRAY_OR_FLAMMABLE"
  | "AEROSOL_OR_SPRAY"
  | "BATTERY_OR_LITHIUM_REVIEW"
  | "BABY_PRODUCT_REVIEW"
  | "HEALTH_CLAIMS_REVIEW"
  | "CHEMICAL_PRODUCT_REVIEW"
  | "BRAND_OR_COMPATIBILITY_REVIEW"

export type ProductRestrictionTextInput = {
  title?: string | null
  productName?: string | null
  category?: string | null
  categoryText?: string | null
  categoryName?: string | null
  handle?: string | null
  productType?: string | null
  description?: string | null
  imageAlt?: string | null
  imageReference?: string | null
}

const guardPriority: ProductRestrictionGuard[] = [
  "NEED_SHIPPING_RESTRICTION_REVIEW",
  "NEED_HAZMAT_OR_AEROSOL_REVIEW",
  "NEED_BRAND_REVIEW",
  "NEED_HEALTH_CLAIMS_REVIEW",
  "NEED_BABY_PRODUCT_REVIEW",
  "NEED_BATTERY_OR_LITHIUM_REVIEW",
  "NEED_CHEMICAL_PRODUCT_REVIEW",
]

const normalize = (value: unknown) =>
  typeof value === "string"
    ? value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[_/.-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : ""

function buildSearchText(input: ProductRestrictionTextInput) {
  return [
    input.title,
    input.productName,
    input.category,
    input.categoryText,
    input.categoryName,
    input.handle,
    input.productType,
    input.description,
    input.imageAlt,
    input.imageReference,
  ]
    .map(normalize)
    .filter(Boolean)
    .join(" | ")
}

const has = (text: string, pattern: RegExp) => pattern.test(text)

export function detectEbayProductRestrictionGuards(
  input: ProductRestrictionTextInput
) {
  const searchText = buildSearchText(input)
  const paintSpray = has(
    searchText,
    /\b(?:paint|striping|marking)\b.{0,48}\b(?:spray|aerosol)\b|\b(?:spray|aerosol)\b.{0,48}\bpaint\b/
  )
  const aerosolOrSpray = has(
    searchText,
    /\b(?:aerosol|hair\s*spray|hairspray|spray|pressurized)\b/
  )
  const flammable = has(searchText, /\bflammable\b/)
  const batteryOrLithium = has(
    searchText,
    /\b(?:battery|batteries|lithium|li\s*ion|lithium\s*ion)\b/
  )
  const babyProduct = has(
    searchText,
    /\b(?:baby|infant|newborn|sterilizer|bottle\s*warmer|baby\s*monitor)\b/
  )
  const healthClaims = has(
    searchText,
    /\b(?:supplement|vitamin|suppository|medical|therapeutic|treats?|cures?|diagnos(?:e|is|tic)|immune\s*support|health\s*claim)\b/
  )
  const chemicalProduct = has(
    searchText,
    /\b(?:chemical|cleaner|cleaning\s*solution|detergent|pesticide|insecticide|herbicide|degreaser|solvent|bleach|liquid)\b/
  )
  const brandOrCompatibility = has(
    searchText,
    /\b(?:ram\s*(?:mounts?|holder)?|compatible\s+with|fits\s+(?:iphone|ipad|samsung|galaxy)|replacement\s+for)\b/
  )

  const matchedSignals: string[] = []
  const pendingRestrictionGuards = new Set<ProductRestrictionGuard>()
  let restrictionRiskType: ProductRestrictionRiskType | null = null

  if (paintSpray || flammable) {
    restrictionRiskType = "PAINT_SPRAY_OR_FLAMMABLE"
    matchedSignals.push(paintSpray ? "paint_spray" : "flammable")
    pendingRestrictionGuards.add("NEED_SHIPPING_RESTRICTION_REVIEW")
    pendingRestrictionGuards.add("NEED_HAZMAT_OR_AEROSOL_REVIEW")
  } else if (aerosolOrSpray) {
    restrictionRiskType = "AEROSOL_OR_SPRAY"
    matchedSignals.push("aerosol_or_spray")
    pendingRestrictionGuards.add("NEED_SHIPPING_RESTRICTION_REVIEW")
    pendingRestrictionGuards.add("NEED_HAZMAT_OR_AEROSOL_REVIEW")
  } else if (batteryOrLithium) {
    restrictionRiskType = "BATTERY_OR_LITHIUM_REVIEW"
  } else if (babyProduct) {
    restrictionRiskType = "BABY_PRODUCT_REVIEW"
  } else if (healthClaims) {
    restrictionRiskType = "HEALTH_CLAIMS_REVIEW"
  } else if (chemicalProduct) {
    restrictionRiskType = "CHEMICAL_PRODUCT_REVIEW"
  } else if (brandOrCompatibility) {
    restrictionRiskType = "BRAND_OR_COMPATIBILITY_REVIEW"
  }

  if (batteryOrLithium) {
    matchedSignals.push("battery_or_lithium")
    pendingRestrictionGuards.add("NEED_BATTERY_OR_LITHIUM_REVIEW")
    pendingRestrictionGuards.add("NEED_SHIPPING_RESTRICTION_REVIEW")
    pendingRestrictionGuards.add("NEED_HAZMAT_OR_AEROSOL_REVIEW")
  }
  if (babyProduct) {
    matchedSignals.push("baby_or_electrical_baby_device")
    pendingRestrictionGuards.add("NEED_BABY_PRODUCT_REVIEW")
  }
  if (healthClaims) {
    matchedSignals.push("health_claim_or_ingestible")
    pendingRestrictionGuards.add("NEED_HEALTH_CLAIMS_REVIEW")
  }
  if (chemicalProduct) {
    matchedSignals.push("chemical_or_liquid")
    pendingRestrictionGuards.add("NEED_CHEMICAL_PRODUCT_REVIEW")
    pendingRestrictionGuards.add("NEED_SHIPPING_RESTRICTION_REVIEW")
  }
  if (brandOrCompatibility) {
    matchedSignals.push("brand_or_compatibility")
    pendingRestrictionGuards.add("NEED_BRAND_REVIEW")
  }

  const orderedGuards = guardPriority.filter((guard) =>
    pendingRestrictionGuards.has(guard)
  )
  const productRestrictionRiskDetected = orderedGuards.length > 0
  const shippingRestrictionReviewRequired = orderedGuards.includes(
    "NEED_SHIPPING_RESTRICTION_REVIEW"
  )
  const hazmatReviewRequired = orderedGuards.includes(
    "NEED_HAZMAT_OR_AEROSOL_REVIEW"
  )

  return {
    restrictionGuardVersion: EBAY_PRODUCT_RESTRICTION_GUARDS_VERSION,
    productRestrictionRiskDetected,
    restrictionRiskType,
    matchedSignals: [...new Set(matchedSignals)],
    pendingRestrictionGuards: orderedGuards,
    shippingRestrictionReviewRequired,
    hazmatReviewRequired,
    nextRequiredGuard: orderedGuards[0] ?? null,
    canProceedToListingPackage: !productRestrictionRiskDetected,
    canProceedToB2RunPreflight: false,
    canPublish: false,
    textInspectionOnly: true,
    imageDownloaded: false,
    externalApiUsed: false,
  }
}
