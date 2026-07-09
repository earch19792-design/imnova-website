export const LUNA_PORTEX_AMAZON_CATALOG_MATCHER_VERSION =
  "LUNA_PORTEX_AMAZON_CATALOG_MATCHER_V1"

const sourceDataClass =
  "LOOP_149C_LUNA_PORTEX_AMAZON_CATALOG_MATCHER"

const maxCatalogCandidatesPerProduct =
  10

type MatchType =
  | "EXACT_UPC_GTIN_MATCH"
  | "STRONG_BRAND_MODEL_PART_MATCH"
  | "STRONG_BRAND_MODEL_SIZE_MATCH"
  | "POSSIBLE_TITLE_SIZE_MATCH"
  | "WEAK_TITLE_ONLY_MATCH"
  | "NO_MATCH"
  | "CONFLICTING_MATCH"

type AsinStrategyRecommendation =
  | "SELL_ON_EXISTING_ASIN"
  | "HUMAN_REVIEW_EXISTING_ASIN"
  | "CREATE_NEW_ASIN_CANDIDATE"
  | "NEED_GTIN_OR_EXEMPTION"
  | "NEED_MORE_PRODUCT_DATA"
  | "REJECT_FOR_NOW"
  | "WATCHLIST"

type RiskLevel =
  | "LOW"
  | "MEDIUM"
  | "HIGH"

type SupplierProduct = {
  supplierSku?: string | null
  productTitle?: string | null
  title?: string | null
  brand?: string | null
  partNumber?: string | null
  modelNumber?: string | null
  manufacturerPartNumber?: string | null
  mpn?: string | null
  upc?: string | null
  gtin?: string | null
  ean?: string | null
  productType?: string | null
  size?: string | null
  packCount?: number | string | null
  color?: string | null
  dimensions?: string | null
  category?: string | null
  categoryRisk?: string | null
}

type AmazonCatalogCandidate = {
  amazonCandidateAsin?: string | null
  title?: string | null
  brand?: string | null
  modelNumber?: string | null
  partNumber?: string | null
  manufacturerPartNumber?: string | null
  upc?: string | null
  gtin?: string | null
  ean?: string | null
  size?: string | null
  packCount?: number | string | null
  color?: string | null
  category?: string | null
  productType?: string | null
  marketplace?: string | null
  listingRiskNotes?: string[] | null
  source?: string | null
}

type CatalogMatcherFixture = {
  supplierProducts?: SupplierProduct[] | null
  amazonCatalogCandidates?: AmazonCatalogCandidate[] | null
}

type CatalogMatcherOptions = {
  maxCandidatesPerProduct?: number | null
}

function normalizeTextValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed =
      Number(value)

    return Number.isFinite(parsed)
      ? parsed
      : fallback
  }

  return fallback
}

function normalizeArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function average(values: number[]) {
  return values.length > 0
    ? Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2))
    : 0
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function normalizeRisk(value: RiskLevel | string): RiskLevel {
  const text =
    normalizeCatalogText(value)

  if (text === "low" || text === "medium" || text === "high") {
    return text.toUpperCase() as RiskLevel
  }

  return "MEDIUM"
}

function textTokens(value: string | null) {
  return (value ?? "")
    .split(" ")
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !["and", "the", "for", "with"].includes(token))
}

function hasValue(value: string | null) {
  return value !== null && value.length > 0 && value !== "unknown"
}

export function normalizeCatalogIdentifier(value: unknown) {
  const text =
    normalizeTextValue(value)

  if (!text || /^unknown$/i.test(text) || /^missing$/i.test(text)) {
    return null
  }

  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim() || null
}

export function normalizeCatalogText(value: unknown) {
  const text =
    normalizeTextValue(value)

  if (!text || /^unknown$/i.test(text) || /^missing$/i.test(text)) {
    return null
  }

  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null
}

function normalizeProduct(product: SupplierProduct) {
  return {
    supplierSku:
      normalizeTextValue(product.supplierSku) ?? "unknown-luna-portex-sku",
    productTitle:
      normalizeTextValue(product.productTitle) ?? normalizeTextValue(product.title) ?? "Untitled Luna Portex product",
    brand:
      normalizeCatalogText(product.brand),
    partNumber:
      normalizeCatalogIdentifier(product.partNumber),
    modelNumber:
      normalizeCatalogIdentifier(product.modelNumber),
    manufacturerPartNumber:
      normalizeCatalogIdentifier(product.manufacturerPartNumber ?? product.mpn ?? product.partNumber ?? product.modelNumber),
    upc:
      normalizeCatalogIdentifier(product.upc),
    gtin:
      normalizeCatalogIdentifier(product.gtin ?? product.ean),
    productType:
      normalizeCatalogText(product.productType),
    size:
      normalizeCatalogText(product.size),
    packCount:
      normalizeNumber(product.packCount, 1),
    color:
      normalizeCatalogText(product.color),
    dimensions:
      normalizeCatalogText(product.dimensions),
    category:
      normalizeCatalogText(product.category),
    categoryRisk:
      normalizeRisk(product.categoryRisk ?? "MEDIUM"),
  }
}

function normalizeCandidate(candidate: AmazonCatalogCandidate) {
  return {
    amazonCandidateAsin:
      normalizeCatalogIdentifier(candidate.amazonCandidateAsin) ?? "B0SANITIZEDUNKNOWN",
    title:
      normalizeTextValue(candidate.title) ?? "Untitled Amazon catalog candidate",
    normalizedTitle:
      normalizeCatalogText(candidate.title),
    brand:
      normalizeCatalogText(candidate.brand),
    modelNumber:
      normalizeCatalogIdentifier(candidate.modelNumber),
    partNumber:
      normalizeCatalogIdentifier(candidate.partNumber),
    manufacturerPartNumber:
      normalizeCatalogIdentifier(candidate.manufacturerPartNumber ?? candidate.partNumber ?? candidate.modelNumber),
    upc:
      normalizeCatalogIdentifier(candidate.upc),
    gtin:
      normalizeCatalogIdentifier(candidate.gtin ?? candidate.ean),
    size:
      normalizeCatalogText(candidate.size),
    packCount:
      normalizeNumber(candidate.packCount, 1),
    color:
      normalizeCatalogText(candidate.color),
    category:
      normalizeCatalogText(candidate.category),
    productType:
      normalizeCatalogText(candidate.productType),
    marketplace:
      normalizeCatalogText(candidate.marketplace) ?? "unknown",
    listingRiskNotes:
      normalizeArray(candidate.listingRiskNotes),
    source:
      normalizeTextValue(candidate.source) ?? "SANITIZED_FIXTURE_ONLY",
  }
}

export function buildLunaPortexAmazonCatalogMatcherInput(
  fixture: CatalogMatcherFixture,
  options: CatalogMatcherOptions = {},
) {
  void options

  return {
    catalogMatcherVersion:
      LUNA_PORTEX_AMAZON_CATALOG_MATCHER_VERSION,
    sourceDataClass,
    supplierProducts:
      (fixture.supplierProducts ?? []).map(normalizeProduct),
    amazonCatalogCandidates:
      (fixture.amazonCatalogCandidates ?? []).map(normalizeCandidate),
  }
}

export function buildIdentifierMatchSignals(
  product: ReturnType<typeof normalizeProduct>,
  candidate: ReturnType<typeof normalizeCandidate>,
) {
  const productIds =
    [product.upc, product.gtin].filter((entry): entry is string => hasValue(entry))
  const candidateIds =
    [candidate.upc, candidate.gtin].filter((entry): entry is string => hasValue(entry))
  const exactUpcGtinMatch =
    productIds.length > 0 && candidateIds.some(candidateId => productIds.includes(candidateId))

  return {
    exactUpcGtinMatch,
    identifierScore:
      exactUpcGtinMatch ? 100 : productIds.length === 0 ? 0 : 20,
    missingUpcGtin:
      productIds.length === 0,
  }
}

export function buildBrandMatchSignal(
  product: ReturnType<typeof normalizeProduct>,
  candidate: ReturnType<typeof normalizeCandidate>,
) {
  const brandMatch =
    hasValue(product.brand) && product.brand === candidate.brand

  return {
    brandMatch,
    brandScore:
      brandMatch ? 100 : hasValue(product.brand) && hasValue(candidate.brand) ? 0 : 25,
    missingBrand:
      !hasValue(product.brand),
  }
}

export function buildModelPartNumberMatchSignal(
  product: ReturnType<typeof normalizeProduct>,
  candidate: ReturnType<typeof normalizeCandidate>,
) {
  const productNumbers =
    unique([product.modelNumber, product.partNumber, product.manufacturerPartNumber].filter((entry): entry is string => hasValue(entry)))
  const candidateNumbers =
    unique([candidate.modelNumber, candidate.partNumber, candidate.manufacturerPartNumber].filter((entry): entry is string => hasValue(entry)))
  const modelPartNumberMatch =
    productNumbers.length > 0 && candidateNumbers.some(candidateNumber => productNumbers.includes(candidateNumber))

  return {
    modelPartNumberMatch,
    modelPartNumberScore:
      modelPartNumberMatch ? 100 : productNumbers.length === 0 ? 10 : 0,
    comparedProductIdentifiers:
      productNumbers,
    comparedCandidateIdentifiers:
      candidateNumbers,
  }
}

export function buildTitleSimilaritySignal(
  product: ReturnType<typeof normalizeProduct>,
  candidate: ReturnType<typeof normalizeCandidate>,
) {
  const productTitle =
    normalizeCatalogText(product.productTitle)
  const candidateTitle =
    candidate.normalizedTitle
  const productTokens =
    textTokens(productTitle)
  const candidateTokens =
    textTokens(candidateTitle)
  const overlap =
    productTokens.filter(token => candidateTokens.includes(token)).length
  const denominator =
    Math.max(1, Math.max(productTokens.length, candidateTokens.length))
  const titleSimilarityScore =
    clampScore((overlap / denominator) * 100)

  return {
    titleSimilarityScore,
    titleOnlyPossible:
      titleSimilarityScore >= 45,
  }
}

export function buildSizePackColorMatchSignal(
  product: ReturnType<typeof normalizeProduct>,
  candidate: ReturnType<typeof normalizeCandidate>,
) {
  const sizeMatch =
    hasValue(product.size) && product.size === candidate.size
  const packCountMatch =
    product.packCount === candidate.packCount
  const colorMatch =
    hasValue(product.color) && product.color === candidate.color
  const sizeMismatch =
    hasValue(product.size) && hasValue(candidate.size) && product.size !== candidate.size
  const colorMismatch =
    hasValue(product.color) && hasValue(candidate.color) && product.color !== candidate.color

  return {
    sizeMatch,
    packCountMatch,
    colorMatch,
    sizeMismatch,
    colorMismatch,
    sizePackColorScore:
      clampScore((sizeMatch ? 45 : 0) + (packCountMatch ? 35 : 0) + (colorMatch ? 20 : 0)),
  }
}

export function buildCategoryCompatibilitySignal(
  product: ReturnType<typeof normalizeProduct>,
  candidate: ReturnType<typeof normalizeCandidate>,
) {
  const categoryMatch =
    hasValue(product.category) && product.category === candidate.category
  const productTypeMatch =
    hasValue(product.productType) && product.productType === candidate.productType
  const categoryMismatch =
    hasValue(product.category) && hasValue(candidate.category) && product.category !== candidate.category && !productTypeMatch

  return {
    categoryMatch,
    productTypeMatch,
    categoryMismatch,
    categoryCompatibilityScore:
      categoryMatch || productTypeMatch ? 100 : categoryMismatch ? 0 : 45,
  }
}

export function buildAmazonCatalogMatchScore(
  product: ReturnType<typeof normalizeProduct>,
  candidate: ReturnType<typeof normalizeCandidate>,
) {
  const identifiers =
    buildIdentifierMatchSignals(product, candidate)
  const brand =
    buildBrandMatchSignal(product, candidate)
  const modelPart =
    buildModelPartNumberMatchSignal(product, candidate)
  const title =
    buildTitleSimilaritySignal(product, candidate)
  const sizePackColor =
    buildSizePackColorMatchSignal(product, candidate)
  const category =
    buildCategoryCompatibilitySignal(product, candidate)
  const mismatchPenalty =
    (sizePackColor.sizeMismatch ? 22 : 0) +
    (sizePackColor.colorMismatch ? 8 : 0) +
    (category.categoryMismatch ? 20 : 0) +
    (candidate.marketplace !== "amazon us" && candidate.marketplace !== "us" ? 20 : 0)
  const matchConfidenceScore =
    identifiers.exactUpcGtinMatch
      ? clampScore(95 + (brand.brandMatch ? 5 : 0) - mismatchPenalty)
      : clampScore(
        brand.brandScore * 0.22 +
        modelPart.modelPartNumberScore * 0.32 +
        title.titleSimilarityScore * 0.16 +
        sizePackColor.sizePackColorScore * 0.16 +
        category.categoryCompatibilityScore * 0.14 -
        mismatchPenalty,
      )

  return {
    ...identifiers,
    ...brand,
    ...modelPart,
    ...title,
    ...sizePackColor,
    ...category,
    matchConfidenceScore,
  }
}

export function buildAmazonCatalogMatchType(
  score: ReturnType<typeof buildAmazonCatalogMatchScore>,
  conflictingStrongCandidates = false,
): MatchType {
  if (conflictingStrongCandidates) {
    return "CONFLICTING_MATCH"
  }

  if (score.exactUpcGtinMatch && score.matchConfidenceScore >= 85) {
    return "EXACT_UPC_GTIN_MATCH"
  }

  if (score.brandMatch && score.modelPartNumberMatch && score.matchConfidenceScore >= 75) {
    return score.sizeMatch
      ? "STRONG_BRAND_MODEL_SIZE_MATCH"
      : "STRONG_BRAND_MODEL_PART_MATCH"
  }

  if (score.titleSimilarityScore >= 55 && (score.sizeMatch || score.packCountMatch) && score.matchConfidenceScore >= 45) {
    return "POSSIBLE_TITLE_SIZE_MATCH"
  }

  if (score.titleSimilarityScore >= 45 && score.matchConfidenceScore >= 30) {
    return "WEAK_TITLE_ONLY_MATCH"
  }

  return "NO_MATCH"
}

function riskFromMatch(matchType: MatchType, score: ReturnType<typeof buildAmazonCatalogMatchScore>): {
  duplicateAsinRisk: RiskLevel
  wrongAsinRisk: RiskLevel
} {
  if (matchType === "EXACT_UPC_GTIN_MATCH" || matchType === "STRONG_BRAND_MODEL_SIZE_MATCH") {
    return {
      duplicateAsinRisk: "LOW",
      wrongAsinRisk: score.categoryMismatch ? "MEDIUM" : "LOW",
    }
  }

  if (matchType === "CONFLICTING_MATCH") {
    return {
      duplicateAsinRisk: "HIGH",
      wrongAsinRisk: "HIGH",
    }
  }

  if (matchType === "NO_MATCH") {
    return {
      duplicateAsinRisk: "HIGH",
      wrongAsinRisk: "LOW",
    }
  }

  return {
    duplicateAsinRisk: "MEDIUM",
    wrongAsinRisk: score.categoryMismatch || score.sizeMismatch ? "HIGH" : "MEDIUM",
  }
}

export function buildAmazonAsinStrategyRecommendation(
  matchType: MatchType,
  score: ReturnType<typeof buildAmazonCatalogMatchScore> | null,
  product: ReturnType<typeof normalizeProduct>,
): AsinStrategyRecommendation {
  if (matchType === "EXACT_UPC_GTIN_MATCH" || matchType === "STRONG_BRAND_MODEL_SIZE_MATCH") {
    return "SELL_ON_EXISTING_ASIN"
  }

  if (matchType === "STRONG_BRAND_MODEL_PART_MATCH" || matchType === "POSSIBLE_TITLE_SIZE_MATCH" || matchType === "CONFLICTING_MATCH") {
    return "HUMAN_REVIEW_EXISTING_ASIN"
  }

  if (matchType === "NO_MATCH" && (!hasValue(product.upc) && !hasValue(product.gtin))) {
    return hasValue(product.brand) && (hasValue(product.modelNumber) || hasValue(product.partNumber))
      ? "NEED_GTIN_OR_EXEMPTION"
      : "NEED_MORE_PRODUCT_DATA"
  }

  if (matchType === "NO_MATCH") {
    return "CREATE_NEW_ASIN_CANDIDATE"
  }

  if (score && score.matchConfidenceScore < 25) {
    return "REJECT_FOR_NOW"
  }

  return "WATCHLIST"
}

export function buildLunaPortexAmazonCatalogMatch(
  supplierProduct: SupplierProduct,
  amazonCatalogCandidates: AmazonCatalogCandidate[],
  options: CatalogMatcherOptions = {},
) {
  const product =
    normalizeProduct(supplierProduct)
  const maxCandidates =
    Math.max(1, Math.min(maxCatalogCandidatesPerProduct, Math.trunc(normalizeNumber(options.maxCandidatesPerProduct, maxCatalogCandidatesPerProduct))))
  const candidateMatches =
    amazonCatalogCandidates
      .map(normalizeCandidate)
      .slice(0, maxCandidates)
      .map(candidate => {
        const score =
          buildAmazonCatalogMatchScore(product, candidate)

        return {
          ...candidate,
          ...score,
          matchType:
            buildAmazonCatalogMatchType(score),
        }
      })
      .sort((left, right) => right.matchConfidenceScore - left.matchConfidenceScore)
  const strongCandidates =
    candidateMatches.filter(candidate => candidate.matchConfidenceScore >= 72)
  const conflictingCandidates =
    strongCandidates.length > 1 &&
    new Set(strongCandidates.map(candidate => candidate.amazonCandidateAsin)).size > 1
  const bestMatch =
    candidateMatches[0] ?? null
  const matchType =
    bestMatch
      ? buildAmazonCatalogMatchType(bestMatch, conflictingCandidates)
      : "NO_MATCH"
  const risk =
    bestMatch
      ? riskFromMatch(matchType, bestMatch)
      : {
        duplicateAsinRisk: "HIGH" as RiskLevel,
        wrongAsinRisk: "LOW" as RiskLevel,
      }
  const asinStrategyRecommendation =
    buildAmazonAsinStrategyRecommendation(matchType, bestMatch, product)
  const warnings =
    unique([
      !hasValue(product.upc) && !hasValue(product.gtin) ? "missing UPC/GTIN" : "",
      !hasValue(product.brand) ? "missing brand" : "",
      bestMatch?.sizeMismatch ? "size mismatch with best candidate" : "",
      bestMatch?.categoryMismatch ? "category mismatch with best candidate" : "",
      matchType === "WEAK_TITLE_ONLY_MATCH" ? "title-only match cannot approve existing ASIN" : "",
      conflictingCandidates ? "multiple strong candidates require human review" : "",
    ].filter(Boolean))
  const blockedReasons =
    unique([
      matchType === "CONFLICTING_MATCH" ? "conflicting ASIN candidates" : "",
      risk.wrongAsinRisk === "HIGH" ? "wrong ASIN risk high" : "",
      asinStrategyRecommendation === "NEED_MORE_PRODUCT_DATA" ? "more product identifiers required" : "",
      "listing prep blocked until restriction gate and human review",
    ].filter(Boolean))
  const humanReviewRequired =
    matchType !== "EXACT_UPC_GTIN_MATCH" ||
    risk.wrongAsinRisk !== "LOW" ||
    warnings.length > 0 ||
    conflictingCandidates
  const canProceedToRestrictionGate =
    asinStrategyRecommendation !== "REJECT_FOR_NOW" &&
    matchType !== "CONFLICTING_MATCH" &&
    matchType !== "WEAK_TITLE_ONLY_MATCH"

  return {
    catalogMatcherVersion:
      LUNA_PORTEX_AMAZON_CATALOG_MATCHER_VERSION,
    sourceDataClass,
    supplierSku:
      product.supplierSku,
    productTitle:
      product.productTitle,
    brand:
      product.brand,
    partNumber:
      product.partNumber,
    modelNumber:
      product.modelNumber,
    manufacturerPartNumber:
      product.manufacturerPartNumber,
    upc:
      product.upc,
    gtin:
      product.gtin,
    candidateMatches,
    bestMatch,
    bestMatchAsin:
      bestMatch?.amazonCandidateAsin ?? null,
    matchConfidenceScore:
      bestMatch?.matchConfidenceScore ?? 0,
    matchType,
    asinStrategyRecommendation,
    duplicateAsinRisk:
      risk.duplicateAsinRisk,
    wrongAsinRisk:
      risk.wrongAsinRisk,
    humanReviewRequired,
    canProceedToRestrictionGate,
    canProceedToListingPrep:
      false,
    blockedReasons,
    warnings,
    nextRecommendedAction:
      asinStrategyRecommendation,
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    scraperUsed:
      false,
  }
}

export function buildLunaPortexAmazonCatalogMatchQueue(
  fixture: CatalogMatcherFixture,
  options: CatalogMatcherOptions = {},
) {
  const input =
    buildLunaPortexAmazonCatalogMatcherInput(fixture, options)
  const catalogMatches =
    input.supplierProducts.map(product => buildLunaPortexAmazonCatalogMatch(product, input.amazonCatalogCandidates, options))

  return {
    catalogMatcherVersion:
      LUNA_PORTEX_AMAZON_CATALOG_MATCHER_VERSION,
    sourceDataClass,
    inputSupplierProducts:
      input.supplierProducts.length,
    amazonCatalogCandidates:
      input.amazonCatalogCandidates.length,
    catalogMatchesBuilt:
      catalogMatches.length,
    catalogMatches,
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    scraperUsed:
      false,
    nextLoop:
      "149D",
  }
}

export function summarizeLunaPortexAmazonCatalogMatcherQueue(
  queue: ReturnType<typeof buildLunaPortexAmazonCatalogMatchQueue>,
) {
  const matches =
    queue.catalogMatches

  return {
    inputSupplierProducts:
      queue.inputSupplierProducts,
    amazonCatalogCandidates:
      queue.amazonCatalogCandidates,
    catalogMatchesBuilt:
      queue.catalogMatchesBuilt,
    exactUpcGtinMatches:
      matches.filter(match => match.matchType === "EXACT_UPC_GTIN_MATCH").length,
    strongBrandModelPartMatches:
      matches.filter(match => match.matchType === "STRONG_BRAND_MODEL_PART_MATCH" || match.matchType === "STRONG_BRAND_MODEL_SIZE_MATCH").length,
    possibleTitleSizeMatches:
      matches.filter(match => match.matchType === "POSSIBLE_TITLE_SIZE_MATCH").length,
    weakTitleOnlyMatches:
      matches.filter(match => match.matchType === "WEAK_TITLE_ONLY_MATCH").length,
    conflictingMatches:
      matches.filter(match => match.matchType === "CONFLICTING_MATCH").length,
    noMatches:
      matches.filter(match => match.matchType === "NO_MATCH").length,
    sellOnExistingAsinCandidates:
      matches.filter(match => match.asinStrategyRecommendation === "SELL_ON_EXISTING_ASIN").length,
    humanReviewExistingAsinCandidates:
      matches.filter(match => match.asinStrategyRecommendation === "HUMAN_REVIEW_EXISTING_ASIN").length,
    createNewAsinCandidates:
      matches.filter(match => match.asinStrategyRecommendation === "CREATE_NEW_ASIN_CANDIDATE").length,
    needGtinOrExemptionCandidates:
      matches.filter(match => match.asinStrategyRecommendation === "NEED_GTIN_OR_EXEMPTION").length,
    needMoreProductDataCandidates:
      matches.filter(match => match.asinStrategyRecommendation === "NEED_MORE_PRODUCT_DATA").length,
    rejectedCandidates:
      matches.filter(match => match.asinStrategyRecommendation === "REJECT_FOR_NOW").length,
    duplicateAsinRiskHighCandidates:
      matches.filter(match => match.duplicateAsinRisk === "HIGH").length,
    wrongAsinRiskHighCandidates:
      matches.filter(match => match.wrongAsinRisk === "HIGH").length,
    productsAllowedToProceedToRestrictionGate:
      matches.filter(match => match.canProceedToRestrictionGate).length,
    productsBlockedFromListingPrep:
      matches.filter(match => !match.canProceedToListingPrep).length,
    productsRequiringHumanReview:
      matches.filter(match => match.humanReviewRequired).length,
    averageMatchConfidenceScore:
      average(matches.map(match => match.matchConfidenceScore)),
    amazonApiUsed:
      false,
    spApiUsed:
      false,
    sellerCentralWriteExecuted:
      false,
    publicationExecuted:
      false,
    stagingWriteExecuted:
      false,
    scraperUsed:
      false,
    nextLoop:
      "149D",
  }
}

export function getLunaPortexAmazonCatalogMatcherChecklist() {
  return [
    "Compare UPC, GTIN, EAN, part number, model number, MPN, brand, title, product type, size, pack count, color, dimensions, and category.",
    "Treat Luna Portex part number and model number as MPN-style identifiers when ASIN is missing.",
    "Use title similarity as research only; title-only matches cannot approve an existing ASIN.",
    "Do not create duplicate ASINs when an existing exact product appears likely.",
    "Do not sell on a similar ASIN when brand, model, size, or category conflict.",
    "Keep every result local and dry-run only: no Amazon connection, no Selling Partner API, no Seller Central mutation, no scraper, no publication.",
  ]
}
