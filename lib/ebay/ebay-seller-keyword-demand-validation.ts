export const EBAY_SELLER_KEYWORD_DEMAND_VALIDATION_VERSION =
  "EBAY-PROFESSIONAL-KEYWORD-CLASSIFICATION-V2"

export type EbaySalesEvidenceSource =
  | "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY"
  | "EBAY_BROWSE_ESTIMATED_SALES"
  | "EBAY_BROWSE_ACTIVE_LISTING"

export type EbaySellerComparableInput = {
  itemId?: string | null
  title?: string | null
  itemWebUrl?: string | null
  imageUrl?: string | null
  price?: number | string | null
  currency?: string | null
  categoryId?: string | null
  categoryName?: string | null
  sellerUsername?: string | null
  sellerFeedbackScore?: number | null
  sellerFeedbackPercentage?: number | string | null
  totalSoldQuantity?: number | null
  estimatedSoldQuantity?: number | null
  lastSoldDate?: string | null
  gtin?: string | null
  brand?: string | null
  mpn?: string | null
  color?: string | null
  size?: string | null
  shortDescription?: string | null
  localizedAspects?: Array<{
    name?: string | null
    value?: string | null
  }> | null
  shippingCost?: number | string | null
  returnsAccepted?: boolean | null
  itemOriginDate?: string | null
  itemEndDate?: string | null
  visualEvidence?: {
    imageCount?: number | null
    mainImageBackground?: string | null
    productCoverageEstimate?: number | null
    fullPackVisible?: boolean | null
    unitCountVisible?: boolean | null
    packageFrontVisible?: boolean | null
    textDensity?: string | null
    infographicPresence?: boolean | null
    dimensionsImage?: boolean | null
    contentsImage?: boolean | null
    lifestyleImage?: boolean | null
    useContextImage?: boolean | null
    handsOrPeoplePresent?: boolean | null
    visibleClaims?: string[] | null
    visualClutter?: string | null
    imageConsistency?: string | null
    mainImageClarity?: string | null
    observableVisualRisks?: string[] | null
    evidenceLevel?: string | null
    observedAt?: string | null
    sourceType?: string | null
  } | null
  source: EbaySalesEvidenceSource
}

export type EbaySellerKeywordCandidate = {
  productName?: string | null
  productTitle?: string | null
  variantTitle?: string | null
  supplierSku?: string | null
  categoryId?: string | null
  gtin?: string | null
  brand?: string | null
  mpn?: string | null
  color?: string | null
  size?: string | null
  packQuantity?: number | null
  productType?: string | null
  description?: string | null
}

export type EbaySellerKeywordDemandInput = {
  candidate: EbaySellerKeywordCandidate
  comparables?: EbaySellerComparableInput[] | null
  candidateFoundCount?: number | null
  returnedCandidateCount?: number | null
  enrichedSampleCount?: number | null
  asOf?: string | Date | null
  soldRecencyDays?: number | null
  insightsAvailability?:
    | "AVAILABLE"
    | "NOT_CONFIGURED"
    | "NOT_ENTITLED"
    | "REQUEST_FAILED"
}

const STOP_WORDS = new Set([
  "a", "an", "and", "at", "authentic", "best", "brand", "by", "fast",
  "for", "free", "from", "genuine", "in", "is", "item", "new", "of",
  "on", "original", "sale", "seller", "shipping", "the", "to", "with",
  "your", "usa", "us",
])

const UNIT_ALIASES: Record<string, string> = {
  ounce: "oz",
  ounces: "oz",
  oz: "oz",
  count: "ct",
  counts: "ct",
  ct: "ct",
  pack: "pack",
  packs: "pack",
  pk: "pack",
  piece: "pc",
  pieces: "pc",
  pc: "pc",
  pcs: "pc",
  ml: "ml",
  liter: "l",
  liters: "l",
  l: "l",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  inch: "in",
  inches: "in",
}

const COLOR_TERMS = new Set([
  "black", "blue", "brown", "clear", "gold", "gray", "green", "grey",
  "orange", "pink", "purple", "red", "silver", "tan", "white", "yellow",
])

const PACKAGING_TERMS = new Set([
  "bag", "bottle", "box", "bundle", "can", "case", "jar", "pack", "pouch",
  "set", "tube",
])

const BUYER_INTENT_TERMS = new Set([
  "clean", "cleaner", "cleaning", "control", "fill", "filler", "filling", "fix", "hold",
  "holder", "maintain", "maintenance", "organize", "organizer", "patch",
  "refill", "repair", "replacement", "restore", "seal", "spray", "storage", "treat",
])

const GENERIC_LOW_SIGNAL_TERMS = new Set([
  "bottle", "box", "brand", "item", "new", "original", "pack", "sale", "set",
])

const UNIT_TERMS = new Set(Object.values(UNIT_ALIASES))

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function numberOrZero(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function buildOfficialEbayVisualMetadata(
  value: unknown,
  observedAt = new Date().toISOString(),
) {
  const item = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  const primary = item.image && typeof item.image === "object" && !Array.isArray(item.image)
    ? cleanText((item.image as Record<string, unknown>).imageUrl) : ""
  const additional = (Array.isArray(item.additionalImages) ? item.additionalImages : [])
    .map((entry) => entry && typeof entry === "object" && !Array.isArray(entry)
      ? cleanText((entry as Record<string, unknown>).imageUrl) : "")
    .filter(Boolean)
  const imageCount = new Set([primary, ...additional].filter(Boolean)).size
  return {
    imageCount: imageCount || null,
    evidenceLevel: imageCount ? "LOW" as const : "INSUFFICIENT" as const,
    observedAt: Number.isFinite(Date.parse(observedAt))
      ? new Date(Date.parse(observedAt)).toISOString() : null,
    sourceType: "OFFICIAL_EBAY_METADATA" as const,
    rawImageStored: false,
    imageDownloaded: false,
    imageCopied: false,
    pixelAnalysisPerformed: false,
  }
}

function booleanOrNull(value: unknown) {
  return value === true ? true : value === false ? false : null
}

function normalizedIdentifier(value: unknown) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, "")
}

function comparableAspectValue(
  aspects: EbaySellerComparableInput["localizedAspects"],
  names: string[]
) {
  const expected = new Set(names.map(normalizedIdentifier))
  return cleanText(aspects?.find((aspect) =>
    expected.has(normalizedIdentifier(aspect?.name))
  )?.value)
}

function normalizedSeller(value: unknown) {
  // Missing seller identity must never manufacture cross-seller evidence.
  return normalize(value) || "unknown-seller"
}

function isRecentDate(value: unknown, asOf: Date, recencyDays: number) {
  const raw = cleanText(value)
  if (!raw) return false
  const observed = new Date(raw)
  if (!Number.isFinite(observed.getTime())) return false
  const ageDays = (asOf.getTime() - observed.getTime()) / 86_400_000
  return ageDays >= -1 && ageDays <= recencyDays
}

function normalize(value: unknown) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\.(?=\s|$)/g, "")
    .trim()
}

function tokens(value: unknown) {
  return normalize(value)
    .split(/\s+/)
    .map((token) => UNIT_ALIASES[token] ?? token)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

function unique<T>(values: T[]) {
  return [...new Set(values)]
}

function safeEbayUrl(value: unknown) {
  const raw = cleanText(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    const ebayHost = url.hostname === "ebay.com" || url.hostname.endsWith(".ebay.com")
    return url.protocol === "https:" && ebayHost ? url.href : null
  } catch {
    return null
  }
}

function safeEbayImageUrl(value: unknown) {
  const raw = cleanText(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    const ebayImageHost =
      url.hostname === "i.ebayimg.com" || url.hostname.endsWith(".ebayimg.com")
    return url.protocol === "https:" && ebayImageHost ? url.href : null
  } catch {
    return null
  }
}

export function assertEbaySellerKeywordReadonlyRequest(
  urlValue: string,
  method: string
) {
  const url = new URL(urlValue)
  const allowedPath =
    url.pathname === "/buy/browse/v1/item_summary/search" ||
    url.pathname.startsWith("/buy/browse/v1/item/") ||
    url.pathname === "/buy/marketplace-insights/v1_beta/item_sales/search" ||
    url.pathname === "/buy/marketing/v1_beta/merchandised_product" ||
    url.pathname === "/commerce/catalog/v1_beta/product_summary/search" ||
    url.pathname === "/commerce/taxonomy/v1/get_default_category_tree_id" ||
    /^\/commerce\/taxonomy\/v1\/category_tree\/[^/]+\/(get_category_suggestions|get_item_aspects_for_category)$/.test(url.pathname)
  if (method !== "GET" || url.origin !== "https://api.ebay.com" || !allowedPath) {
    throw new Error("BLOCKED_NON_READONLY_EBAY_REQUEST")
  }
}

function getFacts(value: unknown) {
  const source = normalize(value)
  const facts = new Map<string, string>()
  for (const match of source.matchAll(/\b(\d+(?:\.\d+)?)\s*(oz|ounce|ounces|ml|l|liter|liters|lb|lbs|pound|pounds|ct|count|counts|pack|packs|pk|pc|pcs|piece|pieces|in|inch|inches)\b/g)) {
    const unit = UNIT_ALIASES[match[2]] ?? match[2]
    facts.set(unit, `${Number(match[1])}`)
  }
  const packOf = source.match(/\bpack\s+of\s+(\d+)\b/)
  if (packOf) facts.set("pack", `${Number(packOf[1])}`)
  return facts
}

function getColors(value: unknown) {
  return new Set(tokens(value).filter((token) => COLOR_TERMS.has(token)))
}

function buildIdentityAssessment(candidateText: string, listingTitle: string) {
  const candidateTokens = unique(tokens(candidateText))
  const listingTokens = new Set(tokens(listingTitle))
  const matchedTokens = candidateTokens.filter((token) => listingTokens.has(token))
  const coverage = candidateTokens.length ? matchedTokens.length / candidateTokens.length : 0
  const candidateFacts = getFacts(candidateText)
  const listingFacts = getFacts(listingTitle)
  const conflicts: string[] = []
  for (const [unit, value] of candidateFacts) {
    const observed = listingFacts.get(unit)
    if (observed && observed !== value) conflicts.push(`${unit}:${value}!=${observed}`)
  }
  const candidateColors = getColors(candidateText)
  const listingColors = getColors(listingTitle)
  if (
    candidateColors.size > 0 &&
    listingColors.size > 0 &&
    ![...candidateColors].some((color) => listingColors.has(color))
  ) {
    conflicts.push(`color:${[...candidateColors].join("|")}!=${[...listingColors].join("|")}`)
  }
  const factsMatched = [...candidateFacts].filter(([unit, value]) => listingFacts.get(unit) === value).length
  const factsCoverage = candidateFacts.size ? factsMatched / candidateFacts.size : 1
  const score = Math.max(
    0,
    Math.min(100, Math.round(coverage * 75 + factsCoverage * 25 - conflicts.length * 35))
  )
  const matchQuality = conflicts.length
    ? "CONFLICT"
    : score >= 78
      ? "EXACT"
      : score >= 58
        ? "STRONG"
        : "WEAK"
  return { score, matchQuality, matchedTokens, conflicts }
}

function keywordTerms(title: string) {
  const titleTokens = tokens(title)
  const unigrams = titleTokens.filter((token) => !/^\d+$/.test(token))
  const bigrams = titleTokens
    .slice(0, -1)
    .map((token, index) => `${token} ${titleTokens[index + 1]}`)
    .filter((term) => term.length <= 40)
  const trigrams = titleTokens
    .slice(0, -2)
    .map((token, index) => `${token} ${titleTokens[index + 1]} ${titleTokens[index + 2]}`)
    .filter((term) => term.length <= 56)
  return unique([...unigrams, ...bigrams, ...trigrams])
}

function classifyKeywordRole(term: string) {
  const termTokens = tokens(term)
  const hasNumber = termTokens.some((token) => /^\d+(?:\.\d+)?$/.test(token))
  const hasUnit = termTokens.some((token) => UNIT_TERMS.has(token))
  if (hasNumber || hasUnit) return "CONFIRMED_SPECIFICATION_OR_QUANTITY"
  if (termTokens.some((token) => COLOR_TERMS.has(token))) return "PRODUCT_ATTRIBUTE"
  if (termTokens.some((token) => PACKAGING_TERMS.has(token))) return "PACKAGING_OR_FORMAT"
  if (termTokens.some((token) => BUYER_INTENT_TERMS.has(token))) return "BUYER_INTENT_OR_USE_CASE"
  if (termTokens.length >= 2) return "CORE_PRODUCT_PHRASE"
  if (termTokens.some((token) => GENERIC_LOW_SIGNAL_TERMS.has(token))) return "GENERIC_LOW_SIGNAL"
  return "PRODUCT_IDENTITY_TOKEN"
}

function termIsConfirmedByCandidate(term: string, candidateText: string) {
  const candidateTokens = new Set(tokens(candidateText))
  const termTokens = tokens(term)
  return termTokens.length > 0 && termTokens.every((token) => candidateTokens.has(token))
}

function buildBuyerIntentType(terms: string[]) {
  const searchable = terms.join(" ")
  if (/\b(?:repair|fix|patch|filler|filling|seal|restore|joint|crack)\b/.test(searchable)) {
    return {
      intentType: "PROBLEM_SOLUTION_REPAIR",
      buyerProfileLabel: "Comprador con necesidad inmediata de reparación o mantenimiento",
    }
  }
  if (/\b(?:replacement|refill)\b/.test(searchable)) {
    return {
      intentType: "REPLACEMENT_OR_REFILL",
      buyerProfileLabel: "Comprador que ya conoce el producto y busca reemplazo o reposición",
    }
  }
  if (/\b(?:organizer|holder|storage|organize)\b/.test(searchable)) {
    return {
      intentType: "ORGANIZATION_OR_STORAGE",
      buyerProfileLabel: "Comprador que busca resolver una necesidad de organización o almacenamiento",
    }
  }
  if (/\b(?:clean|cleaner|cleaning|detergent|maintenance)\b/.test(searchable)) {
    return {
      intentType: "CLEANING_OR_MAINTENANCE",
      buyerProfileLabel: "Comprador orientado a limpieza y mantenimiento recurrente",
    }
  }
  if (/\b(?:hair|beauty|spray|control|care)\b/.test(searchable)) {
    return {
      intentType: "PERSONAL_CARE_RESULT",
      buyerProfileLabel: "Comprador que busca un resultado específico de cuidado personal",
    }
  }
  return {
    intentType: "PRODUCT_SPECIFIC_PURCHASE",
    buyerProfileLabel: "Comprador con intención específica de adquirir este tipo de producto",
  }
}

export function buildEbaySellerKeywordSearchQuery(
  candidate: EbaySellerKeywordCandidate
) {
  const source = [candidate.productName ?? candidate.productTitle, candidate.variantTitle]
    .filter(Boolean)
    .join(" ")
  return unique(tokens(source)).slice(0, 12).join(" ").slice(0, 180)
}

export function buildEbaySellerKeywordDemandValidation(
  input: EbaySellerKeywordDemandInput
) {
  const candidateName = cleanText(
    input.candidate.productName ?? input.candidate.productTitle
  )
  const candidateText = [candidateName, input.candidate.variantTitle]
    .filter(Boolean)
    .join(" ")
  const requestedAsOf = input.asOf ? new Date(input.asOf) : new Date()
  const asOf = Number.isFinite(requestedAsOf.getTime()) ? requestedAsOf : new Date()
  const soldRecencyDays = Math.max(1, numberOrZero(input.soldRecencyDays) || 90)
  const candidateGtin = normalizedIdentifier(input.candidate.gtin)
  const candidateBrand = normalizedIdentifier(input.candidate.brand)
  const candidateMpn = normalizedIdentifier(input.candidate.mpn)
  const comparables = (input.comparables ?? []).map((entry, index) => {
    const title = cleanText(entry.title)
    const identity = buildIdentityAssessment(candidateText, title)
    const listingGtin = normalizedIdentifier(entry.gtin)
    const listingBrand = normalizedIdentifier(entry.brand) ||
      normalizedIdentifier(comparableAspectValue(entry.localizedAspects, ["brand"]))
    const listingMpn = normalizedIdentifier(entry.mpn) ||
      normalizedIdentifier(comparableAspectValue(entry.localizedAspects, ["mpn", "model"]))
    const exactGtin = Boolean(candidateGtin && listingGtin && candidateGtin === listingGtin)
    const exactBrandMpn = Boolean(
      candidateBrand && listingBrand && candidateBrand === listingBrand &&
      candidateMpn && listingMpn && candidateMpn === listingMpn
    )
    const gtinConflict = Boolean(candidateGtin && listingGtin && candidateGtin !== listingGtin)
    const softBrandConflict = Boolean(
      exactGtin && candidateBrand && listingBrand && candidateBrand !== listingBrand
    )
    const identifierExact = !gtinConflict && (exactGtin || exactBrandMpn)
    const verifiedSoldQuantity =
      entry.source === "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY"
        ? numberOrZero(entry.totalSoldQuantity)
        : 0
    const verifiedSoldRecent = verifiedSoldQuantity > 0 && isRecentDate(
      entry.lastSoldDate ?? entry.itemEndDate,
      asOf,
      soldRecencyDays,
    )
    const estimatedSoldQuantity =
      entry.source === "EBAY_BROWSE_ESTIMATED_SALES"
        ? numberOrZero(entry.estimatedSoldQuantity)
        : 0
    const salesQuantity = (verifiedSoldRecent ? verifiedSoldQuantity : 0) || estimatedSoldQuantity
    const eligibleComparable = Boolean(title) && !gtinConflict &&
      identity.conflicts.length === 0 &&
      (identifierExact || ["EXACT", "STRONG"].includes(identity.matchQuality))
    const identityEvidenceClass = identifierExact
      ? exactGtin
        ? "IDENTIFIER_EXACT_GTIN"
        : "IDENTIFIER_EXACT_BRAND_MPN"
      : eligibleComparable
        ? "STRONG_SIMILAR_NO_IDENTIFIER"
        : gtinConflict || identity.conflicts.length
          ? "IDENTITY_CONFLICT"
          : "CANDIDATE_ONLY"
    return {
      comparableId: cleanText(entry.itemId) || `ebay-comparable-${index + 1}`,
      title,
      itemWebUrl: safeEbayUrl(entry.itemWebUrl),
      imageUrl: safeEbayImageUrl(entry.imageUrl),
      price: numberOrZero(entry.price),
      currency: cleanText(entry.currency) || "USD",
      categoryId: cleanText(entry.categoryId) || null,
      categoryName: cleanText(entry.categoryName) || null,
      sellerUsername: cleanText(entry.sellerUsername) || "Vendedor eBay",
      sellerFeedbackScore: numberOrZero(entry.sellerFeedbackScore),
      sellerFeedbackPercentage: numberOrZero(entry.sellerFeedbackPercentage),
      verifiedSoldQuantity,
      verifiedSoldRecent,
      soldEvidenceAgeLimitDays: soldRecencyDays,
      estimatedSoldQuantity,
      salesQuantity,
      lastSoldDate: cleanText(entry.lastSoldDate) || null,
      gtin: cleanText(entry.gtin) || null,
      brand: cleanText(entry.brand) || null,
      mpn: cleanText(entry.mpn) || null,
      color: cleanText(entry.color) || null,
      size: cleanText(entry.size) || null,
      shortDescription: cleanText(entry.shortDescription) || null,
      localizedAspects: Array.isArray(entry.localizedAspects)
        ? entry.localizedAspects
            .map((aspect) => ({
              name: cleanText(aspect?.name) || null,
              value: cleanText(aspect?.value) || null,
            }))
            .filter((aspect) => aspect.name && aspect.value)
        : [],
      shippingCost: numberOrZero(entry.shippingCost),
      returnsAccepted: entry.returnsAccepted === true,
      itemOriginDate: cleanText(entry.itemOriginDate) || null,
      itemEndDate: cleanText(entry.itemEndDate) || null,
      visualEvidence: entry.visualEvidence && typeof entry.visualEvidence === "object"
        ? {
            imageCount: numberOrNull(entry.visualEvidence.imageCount),
            mainImageBackground: cleanText(entry.visualEvidence.mainImageBackground) || null,
            productCoverageEstimate: numberOrNull(entry.visualEvidence.productCoverageEstimate),
            fullPackVisible: booleanOrNull(entry.visualEvidence.fullPackVisible),
            unitCountVisible: booleanOrNull(entry.visualEvidence.unitCountVisible),
            packageFrontVisible: booleanOrNull(entry.visualEvidence.packageFrontVisible),
            textDensity: cleanText(entry.visualEvidence.textDensity) || null,
            infographicPresence: booleanOrNull(entry.visualEvidence.infographicPresence),
            dimensionsImage: booleanOrNull(entry.visualEvidence.dimensionsImage),
            contentsImage: booleanOrNull(entry.visualEvidence.contentsImage),
            lifestyleImage: booleanOrNull(entry.visualEvidence.lifestyleImage),
            useContextImage: booleanOrNull(entry.visualEvidence.useContextImage),
            handsOrPeoplePresent: booleanOrNull(entry.visualEvidence.handsOrPeoplePresent),
            visibleClaims: Array.isArray(entry.visualEvidence.visibleClaims)
              ? entry.visualEvidence.visibleClaims.map(cleanText).filter(Boolean).slice(0, 20)
              : [],
            visualClutter: cleanText(entry.visualEvidence.visualClutter) || null,
            imageConsistency: cleanText(entry.visualEvidence.imageConsistency) || null,
            mainImageClarity: cleanText(entry.visualEvidence.mainImageClarity) || null,
            observableVisualRisks: Array.isArray(entry.visualEvidence.observableVisualRisks)
              ? entry.visualEvidence.observableVisualRisks.map(cleanText).filter(Boolean).slice(0, 20)
              : [],
            evidenceLevel: cleanText(entry.visualEvidence.evidenceLevel) || null,
            observedAt: cleanText(entry.visualEvidence.observedAt) || null,
            sourceType: cleanText(entry.visualEvidence.sourceType) || null,
            rawImageStored: false,
            imageDownloaded: false,
          }
        : null,
      evidenceSource: entry.source,
      identityMatchScore: identifierExact ? 100 : identity.score,
      identityMatchQuality: identifierExact ? "EXACT_IDENTIFIER" : identity.matchQuality,
      identityEvidenceClass,
      identifierMatchType: exactGtin ? "GTIN" : exactBrandMpn ? "BRAND_MPN" : null,
      identifierExact,
      softIdentityConflicts: softBrandConflict ? ["BRAND_CONFLICT_OVERRIDDEN_BY_EXACT_GTIN"] : [],
      identityConflicts: [
        ...identity.conflicts,
        ...(gtinConflict ? ["GTIN_CONFLICT"] : []),
      ],
      eligibleComparable,
      exactTitleCopied: false,
      imageCopied: false,
    }
  })

  const eligible = comparables.filter((entry) => entry.eligibleComparable)
  const soldEvidence = eligible.filter((entry) => entry.verifiedSoldRecent)
  const staleSoldEvidence = eligible.filter((entry) =>
    entry.verifiedSoldQuantity > 0 && !entry.verifiedSoldRecent
  )
  const estimatedEvidence = eligible.filter((entry) => entry.estimatedSoldQuantity > 0)
  const evidenceLevel = soldEvidence.length
    ? "VERIFIED_SOLD_HISTORY"
    : estimatedEvidence.length
      ? "ACTIVE_LISTING_ESTIMATED_SALES"
      : eligible.length
        ? "ACTIVE_LISTINGS_ONLY"
        : "NO_COMPARABLE_EVIDENCE"

  const keywordMap = new Map<
    string,
    {
      term: string
      verifiedSoldQuantity: number
      estimatedSoldQuantity: number
      comparableIds: Set<string>
      sellerIds: Set<string>
      salesSellerIds: Set<string>
      verifiedSellerIds: Set<string>
      estimatedSellerIds: Set<string>
      activeListings: number
    }
  >()
  for (const comparable of eligible) {
    for (const term of keywordTerms(comparable.title)) {
      const current = keywordMap.get(term) ?? {
        term,
        verifiedSoldQuantity: 0,
        estimatedSoldQuantity: 0,
        comparableIds: new Set<string>(),
        sellerIds: new Set<string>(),
        salesSellerIds: new Set<string>(),
        verifiedSellerIds: new Set<string>(),
        estimatedSellerIds: new Set<string>(),
        activeListings: 0,
      }
      current.verifiedSoldQuantity += comparable.verifiedSoldRecent
        ? comparable.verifiedSoldQuantity
        : 0
      current.estimatedSoldQuantity += comparable.estimatedSoldQuantity
      current.comparableIds.add(comparable.comparableId)
      const sellerKey = normalizedSeller(comparable.sellerUsername)
      current.sellerIds.add(sellerKey)
      if (comparable.salesQuantity > 0) {
        current.salesSellerIds.add(sellerKey)
      }
      if (comparable.verifiedSoldRecent) {
        current.verifiedSellerIds.add(sellerKey)
      }
      if (comparable.estimatedSoldQuantity > 0) {
        current.estimatedSellerIds.add(sellerKey)
      }
      current.activeListings += 1
      keywordMap.set(term, current)
    }
  }

  const keywords = [...keywordMap.values()]
    .map((entry) => ({
      term: entry.term,
      verifiedSoldQuantity: entry.verifiedSoldQuantity,
      estimatedSoldQuantity: entry.estimatedSoldQuantity,
      salesQuantity: entry.verifiedSoldQuantity || entry.estimatedSoldQuantity,
      comparableListingCount: entry.comparableIds.size,
      sellerCount: entry.salesSellerIds.size || entry.sellerIds.size,
      verifiedSellerCount: entry.verifiedSellerIds.size,
      estimatedSellerCount: entry.estimatedSellerIds.size,
      activeListingCount: entry.activeListings,
      evidenceSource: entry.verifiedSoldQuantity > 0
        ? "VERIFIED_SOLD_HISTORY"
        : entry.estimatedSoldQuantity > 0
          ? "ACTIVE_LISTING_ESTIMATED_SALES"
          : "ACTIVE_LISTING_FREQUENCY",
      crossSellerSignal: (entry.salesSellerIds.size || entry.sellerIds.size) >= 2,
      keywordRole: classifyKeywordRole(entry.term),
      candidateConfirmed: termIsConfirmedByCandidate(entry.term, candidateText),
      professionalEvidenceClass: entry.verifiedSoldQuantity > 0 && entry.verifiedSellerIds.size >= 2
        ? "VERIFIED_HISTORICAL_MULTI_SELLER"
        : entry.estimatedSoldQuantity > 0 && entry.estimatedSellerIds.size >= 2
          ? "ESTIMATED_MULTI_SELLER_SIGNAL"
          : (entry.verifiedSoldQuantity > 0 || entry.estimatedSoldQuantity > 0)
            ? "SINGLE_SELLER_OBSERVATION"
            : "ACTIVE_LISTING_FREQUENCY_ONLY",
      safeToCallVerifiedSalesKeyword:
        entry.verifiedSoldQuantity > 0 && entry.verifiedSellerIds.size >= 2,
      safeToCallEstimatedOpportunity:
        entry.estimatedSoldQuantity > 0 && entry.estimatedSellerIds.size >= 2,
    }))
    .sort((left, right) =>
      right.verifiedSoldQuantity - left.verifiedSoldQuantity ||
      right.estimatedSoldQuantity - left.estimatedSoldQuantity ||
      right.sellerCount - left.sellerCount ||
      right.comparableListingCount - left.comparableListingCount ||
      right.term.length - left.term.length
    )
    .slice(0, 30)

  const verifiedHistoricalMultiSellerKeywords = keywords.filter(
    (entry) => entry.professionalEvidenceClass === "VERIFIED_HISTORICAL_MULTI_SELLER"
  )
  const estimatedMultiSellerKeywords = keywords.filter(
    (entry) => entry.professionalEvidenceClass === "ESTIMATED_MULTI_SELLER_SIGNAL"
  )
  const singleSellerKeywordObservations = keywords.filter(
    (entry) => entry.professionalEvidenceClass === "SINGLE_SELLER_OBSERVATION"
  )
  const activeListingKeywordObservations = keywords.filter(
    (entry) => entry.professionalEvidenceClass === "ACTIVE_LISTING_FREQUENCY_ONLY"
  )
  const strategyEvidencePool = verifiedHistoricalMultiSellerKeywords.length
    ? verifiedHistoricalMultiSellerKeywords
    : estimatedMultiSellerKeywords
  const primaryKeywordCandidates = strategyEvidencePool
    .filter((entry) =>
      entry.candidateConfirmed &&
      ["BUYER_INTENT_OR_USE_CASE", "CORE_PRODUCT_PHRASE"].includes(entry.keywordRole) &&
      entry.term.includes(" ")
    )
    .sort((left, right) =>
      Number(right.keywordRole === "BUYER_INTENT_OR_USE_CASE") -
        Number(left.keywordRole === "BUYER_INTENT_OR_USE_CASE") ||
      right.term.split(" ").length - left.term.split(" ").length ||
      right.salesQuantity - left.salesQuantity
    )
  const primarySearchPhrase = primaryKeywordCandidates[0]?.term ?? null
  const secondarySearchTerms = strategyEvidencePool
    .filter((entry) =>
      entry.candidateConfirmed &&
      entry.term !== primarySearchPhrase &&
      !["PRODUCT_ATTRIBUTE", "PACKAGING_OR_FORMAT", "CONFIRMED_SPECIFICATION_OR_QUANTITY", "GENERIC_LOW_SIGNAL"].includes(entry.keywordRole)
    )
    .map((entry) => entry.term)
    .filter((term) => !primarySearchPhrase?.includes(term))
    .slice(0, 5)
  const confirmedAttributes = keywords
    .filter((entry) =>
      entry.candidateConfirmed &&
      ["PRODUCT_ATTRIBUTE", "PACKAGING_OR_FORMAT", "CONFIRMED_SPECIFICATION_OR_QUANTITY"].includes(entry.keywordRole)
    )
    .map((entry) => entry.term)
    .slice(0, 6)
  const termsToKeepExploratory = unique([
    ...singleSellerKeywordObservations.map((entry) => entry.term),
    ...strategyEvidencePool
      .filter((entry) =>
        !entry.candidateConfirmed ||
        ["PRODUCT_ATTRIBUTE", "PACKAGING_OR_FORMAT", "GENERIC_LOW_SIGNAL"].includes(entry.keywordRole)
      )
      .map((entry) => entry.term),
  ]).slice(0, 8)
  const buyerIntent = buildBuyerIntentType([
    primarySearchPhrase ?? "",
    ...secondarySearchTerms,
  ])
  const strategyConfidence = verifiedHistoricalMultiSellerKeywords.length
    ? "HIGH_VERIFIED_HISTORY"
    : estimatedMultiSellerKeywords.length
      ? "MEDIUM_ESTIMATED_MULTI_SELLER"
      : "LOW_INSUFFICIENT_EVIDENCE"

  const maxSalesSignal = Math.max(0, ...eligible.map((entry) => entry.salesQuantity))
  const topSellingListings = eligible
    .map((entry) => {
      const salesSignalScore = maxSalesSignal > 0
        ? Math.round((entry.salesQuantity / maxSalesSignal) * 100)
        : 0
      const evidenceQualityScore = entry.verifiedSoldRecent
        ? 100
        : entry.verifiedSoldQuantity > 0
          ? 25
        : entry.estimatedSoldQuantity > 0
          ? 65
          : 15
      const professionalReferenceScore = Math.round(
        entry.identityMatchScore * 0.6 +
        salesSignalScore * 0.25 +
        evidenceQualityScore * 0.15
      )
      return {
        ...entry,
        professionalReferenceScore,
        salesSignalScore,
        referenceRecommendation: ["EXACT", "EXACT_IDENTIFIER"].includes(entry.identityMatchQuality)
          ? "PREFERRED_IDENTITY_REFERENCE"
          : "POSSIBLE_REFERENCE_REQUIRES_HUMAN_CONFIRMATION",
      }
    })
    .sort((left, right) =>
      right.professionalReferenceScore - left.professionalReferenceScore ||
      right.identityMatchScore - left.identityMatchScore ||
      right.verifiedSoldQuantity - left.verifiedSoldQuantity ||
      right.estimatedSoldQuantity - left.estimatedSoldQuantity ||
      right.sellerFeedbackScore - left.sellerFeedbackScore
    )
    .slice(0, 5)
  const totalVerifiedSoldQuantity = soldEvidence.reduce(
    (sum, entry) => sum + entry.verifiedSoldQuantity,
    0
  )
  const totalEstimatedSoldQuantity = estimatedEvidence.reduce(
    (sum, entry) => sum + entry.estimatedSoldQuantity,
    0
  )
  const verifiedSoldSellerCount = new Set(
    soldEvidence.map((entry) => normalizedSeller(entry.sellerUsername))
  ).size
  const estimatedSoldSellerCount = new Set(
    estimatedEvidence.map((entry) => normalizedSeller(entry.sellerUsername))
  ).size
  const demandValidationPassed =
    (verifiedSoldSellerCount >= 2 && totalVerifiedSoldQuantity >= 3) ||
    (estimatedSoldSellerCount >= 2 && totalEstimatedSoldQuantity >= 3)
  const demandValidationBasis = verifiedSoldSellerCount >= 2 && totalVerifiedSoldQuantity >= 3
    ? "VERIFIED_HISTORICAL_MULTI_SELLER"
    : estimatedSoldSellerCount >= 2 && totalEstimatedSoldQuantity >= 3
      ? "ESTIMATED_MULTI_SELLER_SIGNAL"
      : "INSUFFICIENT_EVIDENCE"
  const pendingGuards = [
    !eligible.length ? "NEED_EBAY_COMPARABLE_LISTINGS" : "",
    !demandValidationPassed ? "NEED_EBAY_SALES_EVIDENCE" : "",
    !topSellingListings.some((entry) =>
      ["EXACT", "EXACT_IDENTIFIER"].includes(entry.identityMatchQuality)
    )
      ? "NEED_EBAY_IDENTITY_REFERENCE"
      : "",
  ].filter(Boolean)
  const insightsAvailability = input.insightsAvailability ?? "NOT_CONFIGURED"
  const marketplaceInsightsStatus = insightsAvailability === "AVAILABLE"
    ? "MARKETPLACE_INSIGHTS_AUTHORIZED"
    : insightsAvailability === "NOT_CONFIGURED"
      ? "MARKETPLACE_INSIGHTS_NOT_ENABLED"
      : insightsAvailability === "NOT_ENTITLED"
        ? "MARKETPLACE_INSIGHTS_NOT_AUTHORIZED"
    : insightsAvailability === "REQUEST_FAILED"
      ? "MARKETPLACE_INSIGHTS_REQUEST_FAILED"
      : "MARKETPLACE_INSIGHTS_STATUS_UNKNOWN"
  const keywordEvidenceHeading = verifiedHistoricalMultiSellerKeywords.length
    ? "Keywords con ventas históricas verificadas entre vendedores"
    : estimatedMultiSellerKeywords.length
      ? "Keywords con señal de ventas estimada entre vendedores"
      : "Keywords observadas sin evidencia de ventas suficiente"

  return {
    validationVersion: EBAY_SELLER_KEYWORD_DEMAND_VALIDATION_VERSION,
    candidateName,
    searchQuery: buildEbaySellerKeywordSearchQuery(input.candidate),
    evidenceLevel,
    insightsAvailability,
    marketplaceInsightsStatus,
    soldHistoryIsLimitedRelease: true,
    listingsAnalyzed: comparables.length,
    evidenceAsOf: asOf.toISOString(),
    soldRecencyDays,
    eligibleComparableListings: eligible.length,
    sellersAnalyzed: new Set(eligible.map((entry) => normalizedSeller(entry.sellerUsername))).size,
    totalVerifiedSoldQuantity,
    totalEstimatedSoldQuantity,
    verifiedSoldSellerCount,
    estimatedSoldSellerCount,
    staleVerifiedSoldListingCount: staleSoldEvidence.length,
    freshestVerifiedSoldAt: soldEvidence
      .map((entry) => entry.lastSoldDate ?? entry.itemEndDate)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null,
    evidenceBuckets: {
      candidateFoundCount: Math.max(
        0,
        Math.trunc(input.candidateFoundCount === null || input.candidateFoundCount === undefined
          ? comparables.length
          : numberOrZero(input.candidateFoundCount)),
      ),
      returnedCandidateCount: Math.max(
        0,
        Math.trunc(input.returnedCandidateCount === null || input.returnedCandidateCount === undefined
          ? comparables.length
          : numberOrZero(input.returnedCandidateCount)),
      ),
      enrichedSampleCount: Math.max(
        0,
        Math.trunc(input.enrichedSampleCount === null || input.enrichedSampleCount === undefined
          ? comparables.length
          : numberOrZero(input.enrichedSampleCount)),
      ),
      strongSimilarCount: eligible.filter((entry) => !entry.identifierExact).length,
      identifierExactActiveCount: eligible.filter((entry) =>
        entry.identifierExact && entry.evidenceSource !== "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY"
      ).length,
      identifierExactRecentSoldCount: soldEvidence.filter((entry) => entry.identifierExact).length,
      identifierExactRecentSoldQuantity: soldEvidence
        .filter((entry) => entry.identifierExact)
        .reduce((sum, entry) => sum + entry.verifiedSoldQuantity, 0),
      identifierExactRecentSoldSellerCount: new Set(
        soldEvidence
          .filter((entry) => entry.identifierExact)
          .map((entry) => normalizedSeller(entry.sellerUsername))
      ).size,
      identifierExactStaleSoldCount: staleSoldEvidence.filter((entry) => entry.identifierExact).length,
      conflictingCount: comparables.filter((entry) =>
        entry.identityEvidenceClass === "IDENTITY_CONFLICT"
      ).length,
    },
    comparableEvidence: comparables,
    salesEvidenceAvailable: soldEvidence.length > 0 || estimatedEvidence.length > 0,
    demandValidationPassed,
    demandValidationBasis,
    topSellingListings,
    keywordEvidenceHeading,
    keywordEvidenceGroups: {
      verifiedHistoricalMultiSeller: verifiedHistoricalMultiSellerKeywords,
      estimatedMultiSellerSignal: estimatedMultiSellerKeywords,
      singleSellerObservations: singleSellerKeywordObservations,
      activeListingFrequencyOnly: activeListingKeywordObservations,
    },
    keywordsBringingSales: verifiedHistoricalMultiSellerKeywords,
    keywordsWithEstimatedSalesSignal: estimatedMultiSellerKeywords,
    singleSellerKeywordObservations,
    activeListingKeywords: keywords,
    recommendedListingKeywordStructure: {
      strategyConfidence,
      primarySearchPhrase,
      secondarySearchTerms,
      confirmedAttributes,
      termsToKeepExploratory,
      titleFormula:
        "Marca confirmada + frase principal + beneficio/uso relevante + variante + tamaño/cantidad confirmados",
      exactCompetitorTitleCopied: false,
      humanTitleReviewRequired: true,
    },
    highestPotentialBuyerIntent: {
      ...buyerIntent,
      highestPotentialSearchIntent: primarySearchPhrase,
      supportingIntentTerms: secondarySearchTerms,
      potentialLevel: verifiedHistoricalMultiSellerKeywords.length
        ? "HIGH_WITH_VERIFIED_HISTORY"
        : estimatedMultiSellerKeywords.length
          ? "MEDIUM_WITH_ESTIMATED_SIGNAL"
          : "LOW_UNVERIFIED",
      evidenceBasis: demandValidationBasis,
      explanation: primarySearchPhrase
        ? `La intención con mayor señal es “${primarySearchPhrase}”; se prioriza por coincidencia con Luna y evidencia entre vendedores.`
        : "No existe todavía una frase multi-vendedor suficientemente confiable para definir la intención principal.",
      usesPersonalBuyerData: false,
    },
    professionalReferenceGuidance: {
      recommendedComparableId: topSellingListings[0]?.comparableId ?? null,
      recommendedComparableScore: topSellingListings[0]?.professionalReferenceScore ?? 0,
      selectionRule:
        "Priorizar identidad exacta, evidencia de ventas, consistencia de variante y reputación; nunca elegir sólo por cantidad estimada.",
      finalHumanConfirmationRequired: true,
    },
    pendingGuards,
    nextRecommendedRoute: demandValidationPassed
      ? "NEED_HUMAN_EBAY_IDENTITY_CONFIRMATION"
      : "NEED_EBAY_SALES_EVIDENCE",
    evidenceDisclaimer:
      evidenceLevel === "VERIFIED_SOLD_HISTORY"
        ? "Ventas históricas oficiales de eBay; se analizaron sólo comparables equivalentes."
        : evidenceLevel === "ACTIVE_LISTING_ESTIMATED_SALES"
          ? "Cantidad vendida estimada por eBay en listings activos; no equivale al historial completo de Product Research."
          : "Estos son listings activos. Su posición o frecuencia no demuestra ventas.",
    exactCompetitorTitleCopied: false,
    ebayImagesCopied: false,
    ebayApiMode: "READ_ONLY",
    ebayWriteUsed: false,
    supabaseWriteUsed: false,
    canProceedToB2RunPreflight: false,
    canPublish: false,
  }
}

export type EbaySellerKeywordDemandReport = ReturnType<
  typeof buildEbaySellerKeywordDemandValidation
>

export function getEbaySellerKeywordDemandGatewaySafety() {
  return {
    officialEbayReadOnlyGetOnly: true,
    allowedEndpoints: [
      "/buy/browse/v1/item_summary/search",
      "/buy/browse/v1/item/{item_id}",
      "/buy/marketplace-insights/v1_beta/item_sales/search",
      "/buy/marketing/v1_beta/merchandised_product",
      "/commerce/taxonomy/v1/get_default_category_tree_id",
      "/commerce/taxonomy/v1/category_tree/{tree_id}/get_category_suggestions",
      "/commerce/taxonomy/v1/category_tree/{tree_id}/get_item_aspects_for_category",
    ],
    tokenStored: false,
    tokenReturnedToBrowser: false,
    exactCompetitorTitleCopied: false,
    ebayImageCopied: false,
    ebayWriteUsed: false,
    supabaseWriteUsed: false,
    canPublish: false,
  }
}
