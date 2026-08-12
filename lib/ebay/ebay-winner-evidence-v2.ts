import { createHash } from "node:crypto"

export const EBAY_WINNER_EVIDENCE_V2_VERSION =
  "EBAY_WINNER_EVIDENCE_PRODUCT_DECISION_VISUAL_V2_6_2026_07_17"
export const PRODUCT_IDENTITY_FINGERPRINT_VERSION =
  "EBAY_PRODUCT_IDENTITY_FINGERPRINT_V2"
export const WINNER_ECONOMICS_CONFIG_VERSION =
  "EBAY_WINNER_ECONOMICS_US_V3_2026_07_18"

export const WINNER_ECONOMICS_CONFIG = Object.freeze({
  minimumProfitUsd: 5,
  idealProfitUsd: 7,
  minimumRoiPercent: 30,
  minimumNetMarginPercent: 20,
  estimatedEbayFeeRate: 0.153,
  fixedOrderFee: 0.40,
  returnsReserveRate: 0.04,
  promotedListingsReserveRate: 0.05,
})

export type WinnerComparableClassification =
  | "EXACT_MATCH"
  | "NEAR_MATCH"
  | "DIFFERENT_PACK"
  | "DIFFERENT_VARIANT"
  | "INSUFFICIENT_EVIDENCE"
  | "INVALID_COMPARABLE"

export type WinnerEvidenceCohort =
  | "ACTIVE_EXACT_MATCHES"
  | "SOLD_OR_COMPLETED_EXACT_MATCHES"
  | "ESTIMATED_DEMAND_SIGNALS"

export type WinnerComparableSource =
  | "EBAY_BROWSE_ACTIVE_LISTING"
  | "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY"
  | "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE"
  | "EBAY_OFFICIAL_CSV_IMPORT"
  | "EBAY_OFFICIAL_JSON_IMPORT"
  | "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE"
  | "HUMAN_REVIEWED_IMPORT"

export type WinnerVisualEvidenceSourceType =
  | "OFFICIAL_EBAY_METADATA"
  | "OFFICIAL_EBAY_CSV_IMPORT"
  | "OFFICIAL_EBAY_JSON_IMPORT"
  | "OFFICIAL_EBAY_BROWSER_CAPTURE"
  | "HUMAN_REVIEWED_OBSERVATION"

export type WinnerComparableVisualEvidence = {
  imageCount?: number | null
  mainImageBackground?: "WHITE" | "LIGHT_NEUTRAL" | "COLORED" | "LIFESTYLE" | "UNKNOWN" | null
  productCoverageEstimate?: number | null
  fullPackVisible?: boolean | null
  unitCountVisible?: boolean | null
  packageFrontVisible?: boolean | null
  textDensity?: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN" | null
  infographicPresence?: boolean | null
  dimensionsImage?: boolean | null
  contentsImage?: boolean | null
  lifestyleImage?: boolean | null
  useContextImage?: boolean | null
  handsOrPeoplePresent?: boolean | null
  visibleClaims?: string[] | null
  visualClutter?: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN" | null
  imageConsistency?: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN" | null
  mainImageClarity?: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN" | null
  observableVisualRisks?: string[] | null
  evidenceLevel?: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT" | null
  observedAt?: string | null
  sourceType?: WinnerVisualEvidenceSourceType | null
}

export type ProductIdentityInput = {
  manufacturerBrand?: string | null
  distributor?: string | null
  vendor?: string | null
  gtin?: string | null
  mpn?: string | null
  model?: string | null
  productName?: string | null
  packCount?: number | null
  unitCount?: number | null
  size?: string | null
  color?: string | null
  scent?: string | null
  variant?: string | null
  condition?: string | null
}

export type WinnerComparableInput = {
  source: WinnerComparableSource
  sourceListingId?: string | null
  observedAt?: string | null
  identity: ProductIdentityInput
  itemPrice?: number | null
  shippingCost?: number | null
  currency?: string | null
  confirmedSoldQuantity?: number | null
  estimatedSoldQuantity?: number | null
  keywords?: string[] | null
  shippingPattern?: string | null
  returnsPattern?: string | null
  imageCount?: number | null
  visualEvidence?: WinnerComparableVisualEvidence | null
  evidenceReviewed?: boolean | null
  evidenceScope?: "MARKET_WIDE_SOLD_EVIDENCE" | "OWN_ACCOUNT_SOLD_EVIDENCE" | null
}

export type WinnerEvidenceInput = {
  marketplaceAccountKey: string
  candidateId?: string | null
  supplierSku: string
  supplierVariantId?: string | null
  identity: ProductIdentityInput
  comparables?: WinnerComparableInput[] | null
  supplierPackageCost?: number | null
  packagingCost?: number | null
  outboundShippingCost?: number | null
  fixedFulfillmentCost?: number | null
  authorizedKeywords?: string[] | null
  requiredKeywordCount?: number | null
  complianceBlocked?: boolean | null
  complianceFindings?: string[] | null
  stockAvailable?: number | null
  stockObservedAt?: string | null
  costObservedAt?: string | null
  listingAiIntake?: {
    approvedKeywords?: string[] | null
    category?: { id?: string | null; name?: string | null } | null
    requiredAspects?: Array<{ name?: string | null; value?: string | null }> | null
    optionalAspects?: Array<{ name?: string | null; value?: string | null }> | null
    pricingScenarioName?: string | null
    includedContents?: string[] | null
    complianceRestrictions?: string[] | null
    blockedClaims?: string[] | null
    allowedImageFacts?: string[] | null
    allowedClaims?: string[] | null
    missingFacts?: string[] | null
    titleStructurePatterns?: string[] | null
    unsupportedTerms?: string[] | null
    sellerPatterns?: {
      activeSellerCount?: number | null
      verifiedSoldSellerCount?: number | null
      freeShippingPrevalencePercent?: number | null
      returnsPrevalencePercent?: number | null
      sellerConcentrationPercent?: number | null
      handlingPatterns?: string[] | null
      quantityDiscountPatterns?: string[] | null
      offerPatterns?: string[] | null
      visibleTrustElements?: string[] | null
    } | null
    locale?: string | null
  } | null
  marketEvidence?: {
    activeSellerCount?: number | null
    verifiedSoldSellerCount?: number | null
    estimatedSoldSellerCount?: number | null
    totalVerifiedSoldQuantity?: number | null
    totalEstimatedSoldQuantity?: number | null
    evidenceBasis?: string | null
    discoveryOrigin?: "EBAY_FIRST" | "LUNA_FIRST" | null
    ebayFirstDemandEvidence?: string | null
    crossSourceCorroborated?: boolean | null
    activeAndSoldSeparated?: boolean | null
  } | null
  packStrategyEvidence?: {
    offers?: Array<{
      packCount?: number | null
      unitCountPerItem?: number | null
      exactContents?: string[] | null
      offerGtin?: string | null
      offerGtinVerified?: boolean | null
      cost?: number | null
      shippingCost?: number | null
      fees?: number | null
      minimumSafePrice?: number | null
      idealSafePrice?: number | null
      competitivePrice?: number | null
      targetPrice?: number | null
      premiumPrice?: number | null
      estimatedProfit?: number | null
      estimatedRoiPercent?: number | null
      estimatedNetMarginPercent?: number | null
      stockRequired?: number | null
      stockAvailable?: number | null
      packageWeight?: number | null
      packageDimensions?: {
        length?: number | null
        width?: number | null
        height?: number | null
        unit?: "in" | "cm" | null
      } | null
    }> | null
  } | null
  now?: string | Date | null
}

type CanonicalIdentity = {
  manufacturerBrand: string | null
  distributor: string | null
  vendor: string | null
  gtin: string | null
  gtinValid: boolean
  mpn: string | null
  model: string | null
  normalizedProductName: string | null
  packCount: number | null
  unitCount: number | null
  size: string | null
  color: string | null
  scent: string | null
  variant: string | null
  condition: string | null
}

function normalizedText(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ")
  return normalized || null
}

function identityText(value: unknown) {
  return normalizedText(value)?.toLocaleLowerCase("en-US") ?? null
}

function normalizedListingAiIntake(value: WinnerEvidenceInput["listingAiIntake"]) {
  if (!value) return null
  const normalizeArray = (entries: unknown) => [...new Set(
    (Array.isArray(entries) ? entries : [])
      .map(normalizedText)
      .filter((entry): entry is string => Boolean(entry)),
  )]
  const normalizeAspects = (entries: unknown) => (Array.isArray(entries) ? entries : [])
    .map((entry) => entry && typeof entry === "object" && !Array.isArray(entry)
      ? entry as Record<string, unknown> : {})
    .map((entry) => ({ name: normalizedText(entry.name), value: normalizedText(entry.value) }))
    .filter((entry): entry is { name: string; value: string } => Boolean(entry.name && entry.value))
  const category = value.category ?? null
  return {
    approvedKeywords: normalizeArray(value.approvedKeywords),
    category: {
      id: normalizedText(category?.id),
      name: normalizedText(category?.name),
    },
    requiredAspects: normalizeAspects(value.requiredAspects),
    optionalAspects: normalizeAspects(value.optionalAspects),
    pricingScenarioName: normalizedText(value.pricingScenarioName),
    includedContents: normalizeArray(value.includedContents),
    complianceRestrictions: normalizeArray(value.complianceRestrictions),
    blockedClaims: normalizeArray(value.blockedClaims),
    allowedImageFacts: normalizeArray(value.allowedImageFacts),
    allowedClaims: normalizeArray(value.allowedClaims),
    missingFacts: normalizeArray(value.missingFacts),
    titleStructurePatterns: normalizeArray(value.titleStructurePatterns),
    unsupportedTerms: normalizeArray(value.unsupportedTerms),
    sellerPatterns: value.sellerPatterns ? {
      activeSellerCount: finiteNonNegative(value.sellerPatterns.activeSellerCount),
      verifiedSoldSellerCount: finiteNonNegative(value.sellerPatterns.verifiedSoldSellerCount),
      freeShippingPrevalencePercent: normalizedPercent(
        value.sellerPatterns.freeShippingPrevalencePercent,
      ),
      returnsPrevalencePercent: normalizedPercent(value.sellerPatterns.returnsPrevalencePercent),
      sellerConcentrationPercent: normalizedPercent(value.sellerPatterns.sellerConcentrationPercent),
      handlingPatterns: normalizeArray(value.sellerPatterns.handlingPatterns),
      quantityDiscountPatterns: normalizeArray(value.sellerPatterns.quantityDiscountPatterns),
      offerPatterns: normalizeArray(value.sellerPatterns.offerPatterns),
      visibleTrustElements: normalizeArray(value.sellerPatterns.visibleTrustElements),
      sellerIdentitiesIncluded: false,
    } : null,
    locale: normalizedText(value.locale),
  }
}

function normalizedMarketEvidence(value: WinnerEvidenceInput["marketEvidence"]) {
  return {
    activeSellerCount: finiteNonNegative(value?.activeSellerCount),
    verifiedSoldSellerCount: finiteNonNegative(value?.verifiedSoldSellerCount),
    estimatedSoldSellerCount: finiteNonNegative(value?.estimatedSoldSellerCount),
    totalVerifiedSoldQuantity: finiteNonNegative(value?.totalVerifiedSoldQuantity),
    totalEstimatedSoldQuantity: finiteNonNegative(value?.totalEstimatedSoldQuantity),
    evidenceBasis: normalizedText(value?.evidenceBasis),
    discoveryOrigin: value?.discoveryOrigin === "EBAY_FIRST" ? "EBAY_FIRST" as const
      : value?.discoveryOrigin === "LUNA_FIRST" ? "LUNA_FIRST" as const : null,
    ebayFirstDemandEvidence: normalizedText(value?.ebayFirstDemandEvidence),
    crossSourceCorroborated: value?.crossSourceCorroborated === true,
    activeAndSoldSeparated: value?.activeAndSoldSeparated !== false,
    competitorSellerIdentitiesStored: false,
  }
}

function normalizedPackStrategyEvidence(value: WinnerEvidenceInput["packStrategyEvidence"]) {
  const offers = Array.isArray(value?.offers) ? value.offers : []
  return {
    offers: offers.slice(0, 30).map((offer) => {
      const dimensions = offer.packageDimensions
      const dimensionUnit = dimensions?.unit === "in" || dimensions?.unit === "cm"
        ? dimensions.unit : null
      const exactContents = [...new Set((offer.exactContents ?? [])
        .map(normalizedText).filter((entry): entry is string => Boolean(entry)))].slice(0, 30)
      return {
        packCount: normalizedPositiveInteger(offer.packCount),
        unitCountPerItem: normalizedPositiveInteger(offer.unitCountPerItem),
        exactContents,
        offerGtin: normalizedText(offer.offerGtin),
        offerGtinVerified: offer.offerGtinVerified === true,
        cost: finiteNonNegative(offer.cost),
        shippingCost: finiteNonNegative(offer.shippingCost),
        fees: finiteNonNegative(offer.fees),
        minimumSafePrice: finiteNonNegative(offer.minimumSafePrice),
        idealSafePrice: finiteNonNegative(offer.idealSafePrice),
        competitivePrice: finiteNonNegative(offer.competitivePrice),
        targetPrice: finiteNonNegative(offer.targetPrice),
        premiumPrice: finiteNonNegative(offer.premiumPrice),
        estimatedProfit: finiteNonNegative(offer.estimatedProfit),
        estimatedRoiPercent: finiteNonNegative(offer.estimatedRoiPercent),
        estimatedNetMarginPercent: finiteNonNegative(offer.estimatedNetMarginPercent),
        stockRequired: normalizedPositiveInteger(offer.stockRequired),
        stockAvailable: finiteNonNegative(offer.stockAvailable),
        packageWeight: finiteNonNegative(offer.packageWeight),
        packageDimensions: dimensionUnit && dimensions &&
          finiteNonNegative(dimensions.length) && finiteNonNegative(dimensions.width) &&
          finiteNonNegative(dimensions.height)
          ? {
              length: finiteNonNegative(dimensions.length),
              width: finiteNonNegative(dimensions.width),
              height: finiteNonNegative(dimensions.height),
              unit: dimensionUnit,
            }
          : null,
      }
    }).filter((offer) => offer.packCount !== null),
  }
}

function normalizedPositiveInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function normalizeWinnerComparableOfferCounts(input: {
  title?: string | null
  packCount?: number | string | null
  unitCount?: number | string | null
}) {
  const title = normalizedText(input.title)?.toLocaleLowerCase("en-US") ?? ""
  const explicitPack = title.match(/\b(?:pack|set|case)\s+of\s+(\d{1,3})\b/) ??
    title.match(/\b(\d{1,3})\s*(?:-|\s)?(?:pack|pk|pieces?|pcs?|set)\b/)
  const explicitUnitCount = title.match(/\b(\d{1,4})\s*(?:count|ct)\b/)
  return {
    // With no multipack signal, the listing represents one marketplace offer.
    packCount: normalizedPositiveInteger(explicitPack?.[1]) ??
      normalizedPositiveInteger(input.packCount) ?? 1,
    unitCount: normalizedPositiveInteger(input.unitCount) ??
      normalizedPositiveInteger(explicitUnitCount?.[1]),
  }
}

function finiteNonNegative(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function roundScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100))
}

function roundPercent(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
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

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
}

export function validateGtinChecksum(value: unknown) {
  const gtin = typeof value === "string" ? value.replace(/[\s-]/g, "") : ""
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) return false
  const digits = [...gtin].map(Number)
  const check = digits.pop() ?? -1
  let sum = 0
  for (let index = digits.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += digits[index] * (position % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10 === check
}

export function normalizeProductIdentity(input: ProductIdentityInput): CanonicalIdentity {
  const rawGtin = normalizedText(input.gtin)?.replace(/[\s-]/g, "") ?? null
  const gtinValid = validateGtinChecksum(rawGtin)
  return {
    manufacturerBrand: identityText(input.manufacturerBrand),
    distributor: identityText(input.distributor),
    vendor: identityText(input.vendor),
    gtin: gtinValid ? rawGtin : null,
    gtinValid,
    mpn: identityText(input.mpn),
    model: identityText(input.model),
    normalizedProductName: identityText(input.productName),
    packCount: normalizedPositiveInteger(input.packCount),
    unitCount: normalizedPositiveInteger(input.unitCount),
    size: identityText(input.size),
    color: identityText(input.color),
    scent: identityText(input.scent),
    variant: identityText(input.variant),
    condition: identityText(input.condition),
  }
}

export function buildProductIdentityFingerprint(input: ProductIdentityInput) {
  const identity = normalizeProductIdentity(input)
  const fingerprintPayload = {
    version: PRODUCT_IDENTITY_FINGERPRINT_VERSION,
    manufacturerBrand: identity.manufacturerBrand,
    gtin: identity.gtin,
    mpn: identity.mpn,
    model: identity.model,
    normalizedProductName: identity.normalizedProductName,
    packCount: identity.packCount,
    unitCount: identity.unitCount,
    size: identity.size,
    color: identity.color,
    scent: identity.scent,
    variant: identity.variant,
    condition: identity.condition,
  }
  return {
    version: PRODUCT_IDENTITY_FINGERPRINT_VERSION,
    fingerprint: sha256(fingerprintPayload),
    identity,
    excludesCommercialFields: true,
  }
}

function sameNullable(left: unknown, right: unknown) {
  return left === right || (left === null && right === null)
}

function explicitConflict(left: unknown, right: unknown) {
  return left !== null && right !== null && left !== right
}

function identityTokens(value: string | null) {
  return new Set((value?.match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 1))
}

function identityNameSimilarity(left: string | null, right: string | null) {
  const leftTokens = identityTokens(left)
  const rightTokens = identityTokens(right)
  if (!leftTokens.size || !rightTokens.size) return 0
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length
  return intersection / new Set([...leftTokens, ...rightTokens]).size
}

function identityStrength(identity: CanonicalIdentity) {
  const exactIdentifier = identity.gtinValid || Boolean(
    identity.manufacturerBrand && (identity.mpn || identity.model),
  )
  const productFacts = [
    identity.normalizedProductName,
    identity.packCount,
    identity.unitCount,
    identity.size,
    identity.variant,
    identity.condition,
  ].filter((value) => value !== null).length
  return {
    strong: exactIdentifier && Boolean(identity.packCount && identity.condition) && productFacts >= 4,
    exactIdentifier,
    productFacts,
  }
}

export function classifyWinnerComparable(
  targetInput: ProductIdentityInput,
  comparableInput: ProductIdentityInput,
): { classification: WinnerComparableClassification; reasons: string[] } {
  const target = normalizeProductIdentity(targetInput)
  const comparable = normalizeProductIdentity(comparableInput)
  if (!target.normalizedProductName || !comparable.normalizedProductName) {
    return { classification: "INVALID_COMPARABLE", reasons: ["PRODUCT_NAME_REQUIRED"] }
  }
  if (target.condition && comparable.condition && target.condition !== comparable.condition) {
    return { classification: "INVALID_COMPARABLE", reasons: ["CONDITION_MISMATCH"] }
  }
  if (
    explicitConflict(target.packCount, comparable.packCount) ||
    explicitConflict(target.unitCount, comparable.unitCount)
  ) return { classification: "DIFFERENT_PACK", reasons: ["PACK_OR_UNIT_COUNT_MISMATCH"] }
  const variantFields = ["size", "color", "scent", "variant"] as const
  const variantConflicts = variantFields.filter((field) => explicitConflict(target[field], comparable[field]))
  if (variantConflicts.length) {
    return {
      classification: "DIFFERENT_VARIANT",
      reasons: variantConflicts.map((field) => `${field.toUpperCase()}_MISMATCH`),
    }
  }
  if (target.gtin && comparable.gtin && target.gtin !== comparable.gtin) {
    return { classification: "INVALID_COMPARABLE", reasons: ["GTIN_CONFLICT"] }
  }
  if (target.mpn && comparable.mpn && target.mpn !== comparable.mpn) {
    return { classification: "INVALID_COMPARABLE", reasons: ["MPN_CONFLICT"] }
  }
  if (target.model && comparable.model && target.model !== comparable.model) {
    return { classification: "INVALID_COMPARABLE", reasons: ["MODEL_CONFLICT"] }
  }
  const gtinExact = Boolean(target.gtin && comparable.gtin && target.gtin === comparable.gtin)
  const brandExact = Boolean(
    target.manufacturerBrand && comparable.manufacturerBrand &&
    target.manufacturerBrand === comparable.manufacturerBrand,
  )
  const modelExact = Boolean(
    (target.mpn && comparable.mpn && target.mpn === comparable.mpn) ||
    (target.model && comparable.model && target.model === comparable.model),
  )
  const nameExact = target.normalizedProductName === comparable.normalizedProductName
  const nameSimilarity = identityNameSimilarity(
    target.normalizedProductName,
    comparable.normalizedProductName,
  )
  const packComplete = target.packCount !== null && comparable.packCount !== null &&
    sameNullable(target.packCount, comparable.packCount)
  const targetIdentifierCorroborated = identityStrength(target).exactIdentifier &&
    brandExact && nameSimilarity >= 0.82
  const exact = (gtinExact || (brandExact && modelExact) || targetIdentifierCorroborated) && packComplete &&
    !variantFields.some((field) => explicitConflict(target[field], comparable[field]))
  if (exact) {
    return {
      classification: "EXACT_MATCH",
      reasons: [
        gtinExact
          ? "GTIN_EXACT"
          : brandExact && modelExact
            ? "BRAND_MODEL_EXACT"
            : "TARGET_IDENTIFIER_PLUS_BRAND_NAME_PACK",
        nameExact ? "NAME_EXACT" : "NAME_COMPATIBLE",
      ],
    }
  }
  if ((brandExact || modelExact) && (nameExact || nameSimilarity >= 0.58)) {
    return { classification: "NEAR_MATCH", reasons: ["IDENTIFIER_OR_PACK_EVIDENCE_INCOMPLETE"] }
  }
  return { classification: "INSUFFICIENT_EVIDENCE", reasons: ["IDENTITY_EVIDENCE_INSUFFICIENT"] }
}

function comparableCohort(source: WinnerComparableSource): WinnerEvidenceCohort | null {
  if (source === "EBAY_BROWSE_ACTIVE_LISTING") return "ACTIVE_EXACT_MATCHES"
  if ([
    "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
    "EBAY_OFFICIAL_CSV_IMPORT",
    "EBAY_OFFICIAL_JSON_IMPORT",
    "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
    "HUMAN_REVIEWED_IMPORT",
  ].includes(source)) return "SOLD_OR_COMPLETED_EXACT_MATCHES"
  if (source === "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE") return "ESTIMATED_DEMAND_SIGNALS"
  return null
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function weightedMedian(rows: Array<{ value: number; weight: number }>) {
  const usable = rows.filter((row) => Number.isFinite(row.value) && row.value >= 0 && row.weight > 0)
    .sort((left, right) => left.value - right.value)
  if (!usable.length) return null
  const total = usable.reduce((sum, row) => sum + row.weight, 0)
  let accumulated = 0
  for (const row of usable) {
    accumulated += row.weight
    if (accumulated >= total / 2) return row.value
  }
  return usable.at(-1)?.value ?? null
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const position = Math.max(0, Math.min(1, ratio)) * (sorted.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function economicsAtPrice(price: number | null, totalBaseCost: number | null) {
  if (price === null || price <= 0 || totalBaseCost === null) return null
  const variableRate = WINNER_ECONOMICS_CONFIG.estimatedEbayFeeRate +
    WINNER_ECONOMICS_CONFIG.returnsReserveRate +
    WINNER_ECONOMICS_CONFIG.promotedListingsReserveRate
  const variableFees = price * variableRate
  const appliedFixedOrderFee = price <= 10 ? 0.30 : WINNER_ECONOMICS_CONFIG.fixedOrderFee
  const profit = price - totalBaseCost - appliedFixedOrderFee - variableFees
  const margin = (profit / price) * 100
  const roi = totalBaseCost > 0 ? (profit / totalBaseCost) * 100 : null
  return {
    price: roundMoney(price),
    estimatedProfit: roundMoney(profit),
    estimatedNetMarginPercent: roundPercent(margin),
    estimatedRoiPercent: roi === null ? null : roundPercent(roi),
    passes: profit >= WINNER_ECONOMICS_CONFIG.minimumProfitUsd &&
      margin >= WINNER_ECONOMICS_CONFIG.minimumNetMarginPercent &&
      roi !== null && roi >= WINNER_ECONOMICS_CONFIG.minimumRoiPercent,
  }
}

function safePriceForProfit(totalBaseCost: number, profit: number) {
  const variableRate = WINNER_ECONOMICS_CONFIG.estimatedEbayFeeRate +
    WINNER_ECONOMICS_CONFIG.returnsReserveRate +
    WINNER_ECONOMICS_CONFIG.promotedListingsReserveRate
  const profitFloor = (totalBaseCost + WINNER_ECONOMICS_CONFIG.fixedOrderFee + profit) /
    (1 - variableRate)
  const marginFloor = (totalBaseCost + WINNER_ECONOMICS_CONFIG.fixedOrderFee) /
    (1 - variableRate - WINNER_ECONOMICS_CONFIG.minimumNetMarginPercent / 100)
  const roiFloor = (
    totalBaseCost + WINNER_ECONOMICS_CONFIG.fixedOrderFee +
    totalBaseCost * WINNER_ECONOMICS_CONFIG.minimumRoiPercent / 100
  ) / (1 - variableRate)
  return roundMoney(Math.ceil(Math.max(profitFloor, marginFloor, roiFloor) * 100) / 100)
}

function normalizedKeywords(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .map(identityText)
    .filter((entry): entry is string => Boolean(entry)))]
}

function normalizedBoolean(value: unknown) {
  return value === true ? true : value === false ? false : null
}

function normalizedEnum<T extends string>(value: unknown, allowed: readonly T[]) {
  const candidate = normalizedText(value)?.toUpperCase() as T | undefined
  return candidate && allowed.includes(candidate) ? candidate : null
}

function normalizedPercent(value: unknown) {
  const parsed = finiteNonNegative(value)
  return parsed === null ? null : Math.min(100, roundScore(parsed))
}

function safeObservationList(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(normalizedText)
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => entry.slice(0, 160)))]
    .slice(0, 20)
}

function defaultVisualSource(source: WinnerComparableSource): WinnerVisualEvidenceSourceType {
  if (source === "EBAY_OFFICIAL_CSV_IMPORT") return "OFFICIAL_EBAY_CSV_IMPORT"
  if (source === "EBAY_OFFICIAL_JSON_IMPORT") return "OFFICIAL_EBAY_JSON_IMPORT"
  if (source === "HUMAN_REVIEWED_IMPORT") return "HUMAN_REVIEWED_OBSERVATION"
  return "OFFICIAL_EBAY_METADATA"
}

function normalizeVisualEvidence(comparable: WinnerComparableInput) {
  const input = comparable.visualEvidence ?? {}
  const imageCount = normalizedPositiveInteger(input.imageCount ?? comparable.imageCount)
  const hasStructuredEvidence = [
    input.mainImageBackground,
    input.productCoverageEstimate,
    input.fullPackVisible,
    input.unitCountVisible,
    input.packageFrontVisible,
    input.textDensity,
    input.infographicPresence,
    input.dimensionsImage,
    input.contentsImage,
    input.lifestyleImage,
    input.useContextImage,
    input.handsOrPeoplePresent,
    input.visualClutter,
    input.imageConsistency,
    input.mainImageClarity,
  ].some((value) => value !== null && value !== undefined) ||
    safeObservationList(input.visibleClaims).length > 0 ||
    safeObservationList(input.observableVisualRisks).length > 0
  const evidenceLevel = normalizedEnum(input.evidenceLevel, [
    "HIGH", "MEDIUM", "LOW", "INSUFFICIENT",
  ] as const) ?? (hasStructuredEvidence ? "LOW" : imageCount !== null ? "LOW" : "INSUFFICIENT")
  return {
    imageCount,
    mainImageBackground: normalizedEnum(input.mainImageBackground, [
      "WHITE", "LIGHT_NEUTRAL", "COLORED", "LIFESTYLE", "UNKNOWN",
    ] as const),
    productCoverageEstimate: normalizedPercent(input.productCoverageEstimate),
    fullPackVisible: normalizedBoolean(input.fullPackVisible),
    unitCountVisible: normalizedBoolean(input.unitCountVisible),
    packageFrontVisible: normalizedBoolean(input.packageFrontVisible),
    textDensity: normalizedEnum(input.textDensity, [
      "NONE", "LOW", "MEDIUM", "HIGH", "UNKNOWN",
    ] as const),
    infographicPresence: normalizedBoolean(input.infographicPresence),
    dimensionsImage: normalizedBoolean(input.dimensionsImage),
    contentsImage: normalizedBoolean(input.contentsImage),
    lifestyleImage: normalizedBoolean(input.lifestyleImage),
    useContextImage: normalizedBoolean(input.useContextImage),
    handsOrPeoplePresent: normalizedBoolean(input.handsOrPeoplePresent),
    visibleClaims: safeObservationList(input.visibleClaims),
    visualClutter: normalizedEnum(input.visualClutter, [
      "LOW", "MEDIUM", "HIGH", "UNKNOWN",
    ] as const),
    imageConsistency: normalizedEnum(input.imageConsistency, [
      "LOW", "MEDIUM", "HIGH", "UNKNOWN",
    ] as const),
    mainImageClarity: normalizedEnum(input.mainImageClarity, [
      "LOW", "MEDIUM", "HIGH", "UNKNOWN",
    ] as const),
    observableVisualRisks: safeObservationList(input.observableVisualRisks),
    evidenceLevel,
    observedAt: normalizedText(input.observedAt) ?? normalizedText(comparable.observedAt),
    sourceType: normalizedEnum(input.sourceType, [
      "OFFICIAL_EBAY_METADATA",
      "OFFICIAL_EBAY_CSV_IMPORT",
      "OFFICIAL_EBAY_JSON_IMPORT",
      "HUMAN_REVIEWED_OBSERVATION",
    ] as const) ?? defaultVisualSource(comparable.source),
    rawImageStored: false,
    imageUrlStored: false,
    imageDownloaded: false,
    competitorImageCopied: false,
    usable: evidenceLevel !== "INSUFFICIENT" && (hasStructuredEvidence || imageCount !== null),
  }
}

type NormalizedVisualEvidence = ReturnType<typeof normalizeVisualEvidence>

type NormalizedComparable = {
  cohort: WinnerEvidenceCohort | null
  classification: WinnerComparableClassification
  visualEvidence: NormalizedVisualEvidence
}

function countBoolean(rows: NormalizedComparable[], field: keyof NormalizedVisualEvidence) {
  const observed = rows.filter((row) => typeof row.visualEvidence[field] === "boolean")
  const count = observed.filter((row) => row.visualEvidence[field] === true).length
  return { count, observed: observed.length, percent: observed.length ? roundScore(count / observed.length * 100) : null }
}

function countEnum(rows: NormalizedComparable[], field: keyof NormalizedVisualEvidence, value: string) {
  const observed = rows.filter((row) => {
    const entry = row.visualEvidence[field]
    return typeof entry === "string" && entry !== "UNKNOWN"
  })
  const count = observed.filter((row) => row.visualEvidence[field] === value).length
  return { count, observed: observed.length, percent: observed.length ? roundScore(count / observed.length * 100) : null }
}

function averageNumber(rows: NormalizedComparable[], field: keyof NormalizedVisualEvidence) {
  const values = rows.map((row) => row.visualEvidence[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  return {
    average: values.length ? roundScore(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    observed: values.length,
  }
}

function visualPattern(
  pattern: string,
  sold: ReturnType<typeof countBoolean>,
  active: ReturnType<typeof countBoolean>,
) {
  const difference = sold.percent === null || active.percent === null
    ? null
    : roundScore(sold.percent - active.percent)
  return {
    pattern,
    soldOrCompletedExactMatches: sold,
    activeExactMatches: active,
    percentagePointDifference: difference,
    interpretation: difference === null
      ? "N/D"
      : difference > 10
        ? "PATTERN_ASSOCIATED_MORE_WITH_SOLD_OR_COMPLETED_EXACT_MATCHES"
        : difference < -10
          ? "PATTERN_ASSOCIATED_MORE_WITH_ACTIVE_EXACT_MATCHES"
          : "NO_MEANINGFUL_OBSERVED_DIFFERENCE",
    causalityClaimed: false,
  }
}

function buildVisualWinnerEvidenceAnalysis(rows: NormalizedComparable[]) {
  const soldAll = rows.filter((row) => row.cohort === "SOLD_OR_COMPLETED_EXACT_MATCHES")
  const activeAll = rows.filter((row) => row.cohort === "ACTIVE_EXACT_MATCHES")
  const sold = soldAll.filter((row) => row.visualEvidence.usable)
  const active = activeAll.filter((row) => row.visualEvidence.usable)
  const usable = sold.length + active.length
  const balancedSample = Math.min(sold.length, active.length)
  const confidenceScore = usable === 0
    ? null
    : roundScore(Math.min(70, usable * 9) + Math.min(30, balancedSample * 8))
  const confidenceLevel = confidenceScore === null
    ? "INSUFFICIENT"
    : usable < 3 || balancedSample === 0
      ? "LOW"
      : usable < 8 || confidenceScore < 70
        ? "MEDIUM"
        : "HIGH"
  const mainImagePatterns = [
    visualPattern("WHITE_OR_LIGHT_NEUTRAL_MAIN", {
      count: sold.filter((row) => ["WHITE", "LIGHT_NEUTRAL"].includes(row.visualEvidence.mainImageBackground ?? "")).length,
      observed: sold.filter((row) => row.visualEvidence.mainImageBackground && row.visualEvidence.mainImageBackground !== "UNKNOWN").length,
      percent: null,
    }, {
      count: active.filter((row) => ["WHITE", "LIGHT_NEUTRAL"].includes(row.visualEvidence.mainImageBackground ?? "")).length,
      observed: active.filter((row) => row.visualEvidence.mainImageBackground && row.visualEvidence.mainImageBackground !== "UNKNOWN").length,
      percent: null,
    }),
    visualPattern("FULL_PACK_VISIBLE", countBoolean(sold, "fullPackVisible"), countBoolean(active, "fullPackVisible")),
    visualPattern("UNIT_COUNT_VISIBLE", countBoolean(sold, "unitCountVisible"), countBoolean(active, "unitCountVisible")),
    visualPattern("PACKAGE_FRONT_VISIBLE", countBoolean(sold, "packageFrontVisible"), countBoolean(active, "packageFrontVisible")),
    visualPattern("LOW_OR_NO_TEXT_DENSITY", {
      count: sold.filter((row) => ["NONE", "LOW"].includes(row.visualEvidence.textDensity ?? "")).length,
      observed: sold.filter((row) => row.visualEvidence.textDensity && row.visualEvidence.textDensity !== "UNKNOWN").length,
      percent: null,
    }, {
      count: active.filter((row) => ["NONE", "LOW"].includes(row.visualEvidence.textDensity ?? "")).length,
      observed: active.filter((row) => row.visualEvidence.textDensity && row.visualEvidence.textDensity !== "UNKNOWN").length,
      percent: null,
    }),
    visualPattern("LOW_VISUAL_CLUTTER", countEnum(sold, "visualClutter", "LOW"), countEnum(active, "visualClutter", "LOW")),
    visualPattern("HIGH_IMAGE_CONSISTENCY", countEnum(sold, "imageConsistency", "HIGH"), countEnum(active, "imageConsistency", "HIGH")),
    visualPattern("HIGH_MAIN_IMAGE_CLARITY", countEnum(sold, "mainImageClarity", "HIGH"), countEnum(active, "mainImageClarity", "HIGH")),
  ].map((pattern) => {
    const soldMetric = pattern.soldOrCompletedExactMatches
    const activeMetric = pattern.activeExactMatches
    const soldPercent = soldMetric.observed ? roundScore(soldMetric.count / soldMetric.observed * 100) : null
    const activePercent = activeMetric.observed ? roundScore(activeMetric.count / activeMetric.observed * 100) : null
    const difference = soldPercent === null || activePercent === null ? null : roundScore(soldPercent - activePercent)
    return {
      ...pattern,
      soldOrCompletedExactMatches: { ...soldMetric, percent: soldPercent },
      activeExactMatches: { ...activeMetric, percent: activePercent },
      percentagePointDifference: difference,
      interpretation: difference === null ? "N/D" : difference > 10
        ? "PATTERN_ASSOCIATED_MORE_WITH_SOLD_OR_COMPLETED_EXACT_MATCHES"
        : difference < -10 ? "PATTERN_ASSOCIATED_MORE_WITH_ACTIVE_EXACT_MATCHES"
          : "NO_MEANINGFUL_OBSERVED_DIFFERENCE",
    }
  })
  const secondaryImagePatterns = [
    ["INFOGRAPHIC_PRESENT", "infographicPresence"],
    ["DIMENSIONS_IMAGE", "dimensionsImage"],
    ["CONTENTS_IMAGE", "contentsImage"],
    ["LIFESTYLE_IMAGE", "lifestyleImage"],
    ["USE_CONTEXT_IMAGE", "useContextImage"],
    ["HANDS_OR_PEOPLE_PRESENT", "handsOrPeoplePresent"],
  ].map(([label, field]) => visualPattern(
    label,
    countBoolean(sold, field as keyof NormalizedVisualEvidence),
    countBoolean(active, field as keyof NormalizedVisualEvidence),
  ))
  const activeHighClutter = countEnum(active, "visualClutter", "HIGH")
  const activeLowConsistency = countEnum(active, "imageConsistency", "LOW")
  const activeLowClarity = countEnum(active, "mainImageClarity", "LOW")
  const visualWeaknesses = [
    activeHighClutter.count ? { weakness: "HIGH_VISUAL_CLUTTER_IN_ACTIVE_EXACT_MATCHES", ...activeHighClutter } : null,
    activeLowConsistency.count ? { weakness: "LOW_IMAGE_CONSISTENCY_IN_ACTIVE_EXACT_MATCHES", ...activeLowConsistency } : null,
    activeLowClarity.count ? { weakness: "LOW_MAIN_IMAGE_CLARITY_IN_ACTIVE_EXACT_MATCHES", ...activeLowClarity } : null,
  ].filter((value) => value !== null)
  const associatedSoldPatterns = [...mainImagePatterns, ...secondaryImagePatterns]
    .filter((pattern) => (pattern.percentagePointDifference ?? 0) > 10)
    .map((pattern) => pattern.pattern)
  const differentiationOpportunities = [
    ...associatedSoldPatterns.map((pattern) => ({
      opportunity: `ORIGINAL_EXECUTION_OF_${pattern}`,
      evidenceBasis: "PATTERN_ASSOCIATED_WITH_SOLD_OR_COMPLETED_EXACT_MATCHES",
      copyCompetitorLayout: false,
    })),
    ...visualWeaknesses.map((weakness) => ({
      opportunity: `AVOID_${weakness.weakness}`,
      evidenceBasis: "OBSERVED_ACTIVE_EXACT_MATCH_WEAKNESS",
      copyCompetitorLayout: false,
    })),
  ]
  const recommendedSixImageStrategy = [
    ["MAIN_WHITE_BACKGROUND", "Clear original product and full pack on white; no promotional text."],
    ["PACK_AND_COUNT", "Make verified pack and unit count immediately legible."],
    ["KEY_FEATURES", "Present only verified facts in an original layout."],
    ["SIZE_AND_CONTENT", "Show verified dimensions, size and contents."],
    ["USE_CONTEXT", "Use an authorized, truthful context without adding unverified items."],
    ["PACKAGE_CONTENTS", "Show exactly what the buyer receives."],
  ].map(([slot, strategy], index) => ({
    position: index + 1,
    slot,
    strategy,
    evidenceAssociation: associatedSoldPatterns.length ? associatedSoldPatterns : ["INSUFFICIENT_FOR_PATTERN_RANKING"],
    originalExecutionRequired: true,
    competitorImageInputAllowed: false,
  }))
  const unsupportedVisualHypotheses = [
    ...(usable === 0 ? ["NO_USABLE_STRUCTURED_VISUAL_OBSERVATIONS"] : []),
    ...(sold.length === 0 ? ["SOLD_OR_COMPLETED_VISUAL_ASSOCIATION_UNAVAILABLE"] : []),
    ...(active.length === 0 ? ["ACTIVE_VISUAL_BASELINE_UNAVAILABLE"] : []),
    ...(confidenceLevel === "LOW" ? ["SAMPLE_TOO_SMALL_FOR_STRONG_VISUAL_GENERALIZATION"] : []),
    "VISUAL_PATTERNS_DO_NOT_PROVE_CAUSALITY_OR_SALES_LIFT",
  ]
  const opportunityScore = usable === 0 ? null : roundScore(
    40 + Math.min(30, differentiationOpportunities.length * 6) +
    Math.min(30, (confidenceScore ?? 0) * 0.3),
  )
  return {
    status: usable ? "AVAILABLE" as const : "N/D" as const,
    visualEvidenceSummary: {
      soldOrCompletedExactSampleSize: soldAll.length,
      activeExactSampleSize: activeAll.length,
      soldOrCompletedWithUsableVisualEvidence: sold.length,
      activeWithUsableVisualEvidence: active.length,
      exactMatchesExcludedForMissingVisualEvidence: soldAll.length + activeAll.length - usable,
      productCoverageEstimate: {
        soldOrCompletedExactMatches: averageNumber(sold, "productCoverageEstimate"),
        activeExactMatches: averageNumber(active, "productCoverageEstimate"),
      },
      imageCount: {
        soldOrCompletedExactMatches: averageNumber(sold, "imageCount"),
        activeExactMatches: averageNumber(active, "imageCount"),
      },
      visibleClaimObservationCount: {
        soldOrCompletedExactMatches: sold.reduce((sum, row) => sum + row.visualEvidence.visibleClaims.length, 0),
        activeExactMatches: active.reduce((sum, row) => sum + row.visualEvidence.visibleClaims.length, 0),
      },
      observableVisualRiskCount: {
        soldOrCompletedExactMatches: sold.reduce((sum, row) => sum + row.visualEvidence.observableVisualRisks.length, 0),
        activeExactMatches: active.reduce((sum, row) => sum + row.visualEvidence.observableVisualRisks.length, 0),
      },
      differentPackAndVariantComparablesIncluded: 0,
      comparison: "SOLD_OR_COMPLETED_EXACT_MATCHES_VS_ACTIVE_EXACT_MATCHES_ONLY",
      language: "ASSOCIATION_NOT_CAUSATION",
    },
    mainImagePatterns,
    secondaryImagePatterns,
    commonGallerySequence: recommendedSixImageStrategy.map(({ position, slot }) => ({ position, slot })),
    visualWeaknesses,
    differentiationOpportunities,
    recommendedSixImageStrategy,
    visualPatternConfidence: {
      level: confidenceLevel,
      score: confidenceScore,
      sampleSize: usable,
      smallSamplePenaltyApplied: usable > 0 && (usable < 3 || balancedSample === 0),
    },
    visualOpportunityScore: opportunityScore,
    unsupportedVisualHypotheses,
    safeguards: {
      causalityClaimed: false,
      competitorImagesCopied: 0,
      competitorImagesDownloaded: 0,
      competitorImagesUsedAsGenerativeInput: 0,
      competitorLayoutsReproduced: 0,
      imageGenerationStarted: false,
      ebayWrites: 0,
    },
  }
}

export function buildWinnerEvidenceDecisionPackage(input: WinnerEvidenceInput) {
  const now = input.now ? new Date(input.now) : new Date()
  if (!Number.isFinite(now.getTime())) throw new Error("WINNER_EVIDENCE_NOW_INVALID")
  const marketplaceAccountKey = normalizedText(input.marketplaceAccountKey)
  const supplierSku = normalizedText(input.supplierSku)
  if (!marketplaceAccountKey || !supplierSku) throw new Error("WINNER_EVIDENCE_SCOPE_REQUIRED")
  const fingerprint = buildProductIdentityFingerprint(input.identity)
  const strength = identityStrength(fingerprint.identity)
  const normalizedComparables = (input.comparables ?? []).map((comparable, index) => {
    const classification = classifyWinnerComparable(input.identity, comparable.identity)
    const itemPrice = finiteNonNegative(comparable.itemPrice)
    const shippingCost = finiteNonNegative(comparable.shippingCost)
    const landedPrice = itemPrice === null || shippingCost === null
      ? null
      : roundMoney(itemPrice + shippingCost)
    const comparableIdentity = normalizeProductIdentity(comparable.identity)
    const totalUnits = comparableIdentity.packCount && comparableIdentity.unitCount
      ? comparableIdentity.packCount * comparableIdentity.unitCount
      : null
    const packageCount = comparableIdentity.packCount
    const cohort = classification.classification === "EXACT_MATCH"
      ? comparableCohort(comparable.source)
      : null
    const reviewedImport = [
      "EBAY_OFFICIAL_CSV_IMPORT",
      "EBAY_OFFICIAL_JSON_IMPORT",
      "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
      "HUMAN_REVIEWED_IMPORT",
    ].includes(comparable.source)
    const sourceAccepted = !reviewedImport || comparable.evidenceReviewed === true
    const confirmedSoldQuantity = finiteNonNegative(comparable.confirmedSoldQuantity)
    const visualEvidence = normalizeVisualEvidence(comparable)
    return {
      comparableKey: sha256({
        source: comparable.source,
        sourceListingId: normalizedText(comparable.sourceListingId) ?? `row-${index + 1}`,
        identity: comparableIdentity,
        observedAt: normalizedText(comparable.observedAt),
      }),
      source: comparable.source,
      evidenceScope: comparable.evidenceScope === "MARKET_WIDE_SOLD_EVIDENCE" ||
        comparable.evidenceScope === "OWN_ACCOUNT_SOLD_EVIDENCE"
        ? comparable.evidenceScope
        : null,
      sourceListingId: normalizedText(comparable.sourceListingId),
      observedAt: normalizedText(comparable.observedAt),
      classification: sourceAccepted ? classification.classification : "INVALID_COMPARABLE" as const,
      classificationReasons: sourceAccepted
        ? classification.reasons
        : ["IMPORTED_EVIDENCE_REQUIRES_HUMAN_REVIEW"],
      cohort: sourceAccepted ? cohort : null,
      identity: {
        ...comparableIdentity,
        distributor: null,
        vendor: null,
        normalizedProductName: null,
      },
      pricing: {
        currency: normalizedText(comparable.currency) ?? "USD",
        itemPrice: itemPrice === null ? null : roundMoney(itemPrice),
        shippingCost: shippingCost === null ? null : roundMoney(shippingCost),
        landedPrice,
        packagePrice: landedPrice === null || packageCount === null
          ? null
          : roundMoney(landedPrice / packageCount),
        unitPrice: landedPrice === null || totalUnits === null
          ? null
          : roundMoney(landedPrice / totalUnits),
      },
      confirmedSoldQuantity: comparable.source === "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE"
        ? null
        : confirmedSoldQuantity,
      estimatedSoldQuantity: comparable.source === "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE"
        ? finiteNonNegative(comparable.estimatedSoldQuantity)
        : null,
      keywords: normalizedKeywords(comparable.keywords),
      patterns: {
        shipping: normalizedText(comparable.shippingPattern),
        returns: normalizedText(comparable.returnsPattern),
        imageCount: visualEvidence.imageCount,
      },
      visualEvidence,
      competitorTitleStored: false,
      competitorDescriptionStored: false,
      competitorImagesStored: false,
      sellerIdentityStored: false,
    }
  })
  const activeExact = normalizedComparables.filter((row) => row.cohort === "ACTIVE_EXACT_MATCHES")
  const soldExact = normalizedComparables.filter((row) => row.cohort === "SOLD_OR_COMPLETED_EXACT_MATCHES")
  const estimatedSignals = normalizedComparables.filter((row) => row.cohort === "ESTIMATED_DEMAND_SIGNALS")
  const visualEvidenceAnalysis = buildVisualWinnerEvidenceAnalysis(normalizedComparables)
  const activePrices = activeExact.map((row) => row.pricing.landedPrice)
    .filter((value): value is number => value !== null)
  const soldPrices = soldExact.map((row) => ({
    value: row.pricing.landedPrice,
    weight: row.confirmedSoldQuantity ?? 1,
  })).filter((row): row is { value: number; weight: number } => row.value !== null)
  const weightedSoldMedian = weightedMedian(soldPrices)
  const activeMarketMedian = median(activePrices)
  const supplierPackageCost = finiteNonNegative(input.supplierPackageCost)
  const ancillaryCosts = [input.packagingCost, input.outboundShippingCost, input.fixedFulfillmentCost]
    .map(finiteNonNegative)
  const totalBaseCost = supplierPackageCost === null || ancillaryCosts.some((cost) => cost === null)
    ? null
    : roundMoney(supplierPackageCost + ancillaryCosts.reduce<number>((sum, cost) => sum + (cost ?? 0), 0))
  const minimumSafePrice = totalBaseCost === null
    ? null
    : safePriceForProfit(totalBaseCost, WINNER_ECONOMICS_CONFIG.minimumProfitUsd)
  const idealSafePrice = totalBaseCost === null
    ? null
    : safePriceForProfit(totalBaseCost, WINNER_ECONOMICS_CONFIG.idealProfitUsd)
  const evidenceAnchor = weightedSoldMedian ?? activeMarketMedian
  const aggressiveLaunchPrice = minimumSafePrice === null || evidenceAnchor === null
    ? null
    : roundMoney(Math.max(minimumSafePrice, evidenceAnchor * 0.97))
  const competitivePrice = minimumSafePrice === null || activeMarketMedian === null
    ? null
    : roundMoney(Math.max(minimumSafePrice, activeMarketMedian))
  const targetPrice = idealSafePrice === null || evidenceAnchor === null
    ? null
    : roundMoney(Math.max(idealSafePrice, evidenceAnchor))
  const premiumAnchor = percentile(
    [...activePrices, ...soldPrices.map((row) => row.value)],
    0.75,
  )
  const premiumPrice = idealSafePrice === null || premiumAnchor === null
    ? null
    : roundMoney(Math.max(idealSafePrice, premiumAnchor))
  const targetEconomics = economicsAtPrice(targetPrice, totalBaseCost)
  const marketSupportsMinimumSafePrice = minimumSafePrice === null || evidenceAnchor === null
    ? null
    : evidenceAnchor >= minimumSafePrice
  const minimumSafePriceMarketGap = minimumSafePrice === null || evidenceAnchor === null
    ? null
    : roundMoney(evidenceAnchor - minimumSafePrice)
  const economicsViable = targetEconomics?.passes === true &&
    marketSupportsMinimumSafePrice === true
  const keywordSet = new Set(normalizedComparables.flatMap((row) => row.keywords))
  const authorizedKeywords = normalizedKeywords(input.authorizedKeywords)
  const requiredKeywordCount = Math.max(1, normalizedPositiveInteger(input.requiredKeywordCount) ?? 5)
  const keywordCoverage = authorizedKeywords.length
    ? authorizedKeywords.filter((keyword) => keywordSet.has(keyword)).length / requiredKeywordCount
    : 0
  const confirmedSoldUnits = soldExact.reduce(
    (sum, row) => sum + (row.confirmedSoldQuantity ?? 0),
    0,
  )
  const demandConfidence = roundScore(
    Math.min(65, soldExact.length * 22) +
    Math.min(20, Math.log10(confirmedSoldUnits + 1) * 20) +
    Math.min(15, activeExact.length * 3),
  )
  const competitionPressure = roundScore(
    Math.min(70, activeExact.length * 8) +
    (activePrices.length >= 2 && activeMarketMedian
      ? Math.min(30, ((Math.max(...activePrices) - Math.min(...activePrices)) / activeMarketMedian) * 50)
      : 0),
  )
  const marginSafety = economicsViable
    ? roundScore(60 + Math.min(40, (targetEconomics.estimatedProfit - WINNER_ECONOMICS_CONFIG.minimumProfitUsd) * 8))
    : 0
  const keywordOpportunity = roundScore(keywordCoverage * 100)
  const listingReadiness = roundScore(
    (strength.strong ? 35 : strength.exactIdentifier ? 20 : 0) +
    (economicsViable ? 30 : 0) +
    (activeExact.length || soldExact.length ? 20 : 0) +
    (input.complianceBlocked === true ? 0 : 10) +
    (finiteNonNegative(input.stockAvailable) !== null ? 5 : 0),
  )
  const overallOpportunity = roundScore(
    demandConfidence * 0.25 +
    (100 - competitionPressure) * 0.10 +
    marginSafety * 0.25 +
    keywordOpportunity * 0.15 +
    listingReadiness * 0.25,
  )
  const evidenceSufficientForGo = soldExact.length >= 1
  const evidenceSufficientForConditionalGo = evidenceSufficientForGo || activeExact.length >= 2
  const blockers = [
    !strength.strong ? "PRODUCT_IDENTITY_NOT_STRONG" : null,
    input.complianceBlocked === true ? "COMPLIANCE_BLOCKED" : null,
    !targetEconomics?.passes ? "ECONOMICS_NOT_VIABLE" : null,
    marketSupportsMinimumSafePrice === false ? "MARKET_PRICE_BELOW_MINIMUM_SAFE_PRICE" : null,
    !evidenceSufficientForConditionalGo ? "EXACT_EVIDENCE_INSUFFICIENT" : null,
  ].filter((value): value is string => Boolean(value))
  const verdict = blockers.length
    ? "NO_GO" as const
    : evidenceSufficientForGo && listingReadiness >= 75
      ? "GO" as const
      : "GO_WITH_CHANGES" as const
  const recommendedAction = verdict === "GO"
    ? "APPROVE_DECISION_PACKAGE_FOR_LISTING_FACTORY"
    : verdict === "GO_WITH_CHANGES"
      ? "REVIEW_REQUIRED_CHANGES_BEFORE_LISTING_FACTORY"
      : "RESOLVE_BLOCKERS_OR_SELECT_ANOTHER_PRODUCT"
  const packagePayload = {
    packageVersion: EBAY_WINNER_EVIDENCE_V2_VERSION,
    generatedAt: now.toISOString(),
    marketplace: "EBAY_US" as const,
    marketplaceAccountKey,
    candidateId: normalizedText(input.candidateId),
    supplierSku,
    supplierVariantId: normalizedText(input.supplierVariantId),
    productIdentity: fingerprint,
    comparables: {
      classified: normalizedComparables,
      cohorts: {
        ACTIVE_EXACT_MATCHES: activeExact,
        SOLD_OR_COMPLETED_EXACT_MATCHES: soldExact,
        ESTIMATED_DEMAND_SIGNALS: estimatedSignals,
      },
      counts: {
        activeExact: activeExact.length,
        soldOrCompletedExact: soldExact.length,
        confirmedSoldExact: soldExact.length,
        marketWideSoldExact: soldExact.filter((row) =>
          row.evidenceScope === "MARKET_WIDE_SOLD_EVIDENCE").length,
        ownAccountSoldExact: soldExact.filter((row) =>
          row.evidenceScope === "OWN_ACCOUNT_SOLD_EVIDENCE").length,
        estimatedDemandSignals: estimatedSignals.length,
        excludedOrNonExact: normalizedComparables.length - activeExact.length - soldExact.length - estimatedSignals.length,
      },
      sources: {
        active: "EBAY_BROWSE_API",
        soldOrCompleted: soldExact.some((row) => row.source === "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY")
          ? "EBAY_MARKETPLACE_INSIGHTS"
          : soldExact.length
            ? "REVIEWED_IMPORT"
            : "UNAVAILABLE",
        completedWithoutConfirmedSaleIncluded: false,
        scrapingUsed: false,
        browserAutomationUsed: false,
      },
    },
    visualEvidenceAnalysis,
    economics: {
      configVersion: WINNER_ECONOMICS_CONFIG_VERSION,
      config: WINNER_ECONOMICS_CONFIG,
      currency: "USD",
      supplierPackageCost,
      totalBaseCost,
      minimumSafePrice,
      idealSafePrice,
      aggressiveLaunchPrice,
      competitivePrice,
      targetPrice,
      premiumPrice,
      weightedSoldMedian: weightedSoldMedian === null ? null : roundMoney(weightedSoldMedian),
      activeMarketMedian: activeMarketMedian === null ? null : roundMoney(activeMarketMedian),
      evidenceMarketAnchor: evidenceAnchor === null ? null : roundMoney(evidenceAnchor),
      marketSupportsMinimumSafePrice,
      minimumSafePriceMarketGap,
      viable: economicsViable,
      targetEconomics,
      unavailableValuesRenderAs: "N/D",
    },
    scores: {
      demandConfidence,
      competitionPressure,
      marginSafety,
      keywordOpportunity,
      listingReadiness,
      overallOpportunity,
    },
    compliance: {
      blocked: input.complianceBlocked === true,
      findings: (input.complianceFindings ?? []).map(normalizedText).filter(Boolean),
    },
    inventoryEvidence: {
      stockAvailable: finiteNonNegative(input.stockAvailable),
      stockObservedAt: normalizedText(input.stockObservedAt),
      costObservedAt: normalizedText(input.costObservedAt),
    },
    listingAiIntake: normalizedListingAiIntake(input.listingAiIntake),
    marketEvidence: normalizedMarketEvidence(input.marketEvidence),
    packStrategyEvidence: normalizedPackStrategyEvidence(input.packStrategyEvidence),
    decision: {
      verdict,
      blockers,
      evidenceSufficientForGo,
      evidenceSufficientForConditionalGo,
      recommendedAction,
      humanApprovalRequired: true,
    },
    safety: {
      advisoryOnly: true,
      officialReadOnlySourcesOnly: true,
      manualEvidenceNeverPresentedAsOfficialApi: true,
      soldAndEstimatedSignalsSeparated: true,
      competitorContentCopied: false,
      competitorImagesCopied: false,
      piiStored: false,
      ebayWrites: 0,
      canPublish: false,
    },
  }
  const inputHash = sha256({ ...input, now: undefined })
  return {
    ...packagePayload,
    inputHash,
    packageHash: sha256({ ...packagePayload, generatedAt: undefined }),
  }
}

export type WinnerEvidenceDecisionPackage = ReturnType<
  typeof buildWinnerEvidenceDecisionPackage
>

export function verifyWinnerEvidenceDecisionPackageIntegrity(
  value: WinnerEvidenceDecisionPackage,
) {
  const {
    inputHash: _inputHash,
    packageHash,
    ...packagePayload
  } = value
  return packageHash === sha256({
    ...packagePayload,
    generatedAt: undefined,
  })
}
