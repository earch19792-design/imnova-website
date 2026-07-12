export const EBAY_SELLER_KEYWORD_DEMAND_VALIDATION_VERSION =
  "EBAY-SELLER-KEYWORD-DEMAND-VALIDATION-V1"

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
  source: EbaySalesEvidenceSource
}

export type EbaySellerKeywordCandidate = {
  productName?: string | null
  productTitle?: string | null
  variantTitle?: string | null
  supplierSku?: string | null
  categoryId?: string | null
}

export type EbaySellerKeywordDemandInput = {
  candidate: EbaySellerKeywordCandidate
  comparables?: EbaySellerComparableInput[] | null
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

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function numberOrZero(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function normalize(value: unknown) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9.]+/g, " ")
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
    url.pathname === "/buy/marketplace-insights/v1_beta/item_sales/search"
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
  return unique([...unigrams, ...bigrams])
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
  const comparables = (input.comparables ?? []).map((entry, index) => {
    const title = cleanText(entry.title)
    const identity = buildIdentityAssessment(candidateText, title)
    const verifiedSoldQuantity =
      entry.source === "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY"
        ? numberOrZero(entry.totalSoldQuantity)
        : 0
    const estimatedSoldQuantity =
      entry.source === "EBAY_BROWSE_ESTIMATED_SALES"
        ? numberOrZero(entry.estimatedSoldQuantity)
        : 0
    const salesQuantity = verifiedSoldQuantity || estimatedSoldQuantity
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
      estimatedSoldQuantity,
      salesQuantity,
      lastSoldDate: cleanText(entry.lastSoldDate) || null,
      evidenceSource: entry.source,
      identityMatchScore: identity.score,
      identityMatchQuality: identity.matchQuality,
      identityConflicts: identity.conflicts,
      eligibleComparable:
        Boolean(title) &&
        identity.conflicts.length === 0 &&
        ["EXACT", "STRONG"].includes(identity.matchQuality),
      exactTitleCopied: false,
      imageCopied: false,
    }
  })

  const eligible = comparables.filter((entry) => entry.eligibleComparable)
  const soldEvidence = eligible.filter((entry) => entry.verifiedSoldQuantity > 0)
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
        activeListings: 0,
      }
      current.verifiedSoldQuantity += comparable.verifiedSoldQuantity
      current.estimatedSoldQuantity += comparable.estimatedSoldQuantity
      current.comparableIds.add(comparable.comparableId)
      current.sellerIds.add(comparable.sellerUsername)
      if (comparable.salesQuantity > 0) {
        current.salesSellerIds.add(comparable.sellerUsername)
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
      activeListingCount: entry.activeListings,
      evidenceSource: entry.verifiedSoldQuantity > 0
        ? "VERIFIED_SOLD_HISTORY"
        : entry.estimatedSoldQuantity > 0
          ? "ACTIVE_LISTING_ESTIMATED_SALES"
          : "ACTIVE_LISTING_FREQUENCY",
      crossSellerSignal: (entry.salesSellerIds.size || entry.sellerIds.size) >= 2,
    }))
    .sort((left, right) =>
      right.verifiedSoldQuantity - left.verifiedSoldQuantity ||
      right.estimatedSoldQuantity - left.estimatedSoldQuantity ||
      right.sellerCount - left.sellerCount ||
      right.comparableListingCount - left.comparableListingCount ||
      right.term.length - left.term.length
    )
    .slice(0, 12)

  const topSellingListings = [...eligible]
    .sort((left, right) =>
      right.verifiedSoldQuantity - left.verifiedSoldQuantity ||
      right.estimatedSoldQuantity - left.estimatedSoldQuantity ||
      right.identityMatchScore - left.identityMatchScore ||
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
  const demandValidationPassed =
    (soldEvidence.length >= 2 && totalVerifiedSoldQuantity >= 3) ||
    (estimatedEvidence.length >= 2 && totalEstimatedSoldQuantity >= 3)
  const pendingGuards = [
    !eligible.length ? "NEED_EBAY_COMPARABLE_LISTINGS" : "",
    !demandValidationPassed ? "NEED_EBAY_SALES_EVIDENCE" : "",
    !topSellingListings.some((entry) => entry.identityMatchQuality === "EXACT")
      ? "NEED_EBAY_IDENTITY_REFERENCE"
      : "",
  ].filter(Boolean)
  const insightsAvailability = input.insightsAvailability ?? "NOT_CONFIGURED"
  const marketplaceInsightsStatus = insightsAvailability === "AVAILABLE"
    ? "MARKETPLACE_INSIGHTS_AUTHORIZED"
    : insightsAvailability === "REQUEST_FAILED"
      ? "MARKETPLACE_INSIGHTS_REQUEST_FAILED"
      : "MARKETPLACE_INSIGHTS_NOT_AUTHORIZED"

  return {
    validationVersion: EBAY_SELLER_KEYWORD_DEMAND_VALIDATION_VERSION,
    candidateName,
    searchQuery: buildEbaySellerKeywordSearchQuery(input.candidate),
    evidenceLevel,
    insightsAvailability,
    marketplaceInsightsStatus,
    soldHistoryIsLimitedRelease: true,
    listingsAnalyzed: comparables.length,
    eligibleComparableListings: eligible.length,
    sellersAnalyzed: new Set(eligible.map((entry) => entry.sellerUsername)).size,
    totalVerifiedSoldQuantity,
    totalEstimatedSoldQuantity,
    salesEvidenceAvailable: soldEvidence.length > 0 || estimatedEvidence.length > 0,
    demandValidationPassed,
    topSellingListings,
    keywordsBringingSales: keywords.filter((entry) => entry.salesQuantity > 0),
    activeListingKeywords: keywords,
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
