import { createHash } from "node:crypto"

import { calculateEbayUnitEconomics } from "./ebay-unit-economics"
import { MINIMUM_TRUTHFUL_LISTING_READINESS_V1 } from
  "./ebay-minimum-truthful-listing-readiness-v1"

export const QUICK_PICK_MARKET_TEST_PACKAGE_AND_REMOTE_OWNER_REVIEW_V1 =
  "QUICK_PICK_MARKET_TEST_PACKAGE_AND_REMOTE_OWNER_REVIEW_V1" as const
export const QUICK_PICK_REMOTE_OWNER_REVIEW_V1 =
  "QUICK_PICK_REMOTE_OWNER_REVIEW_V1" as const

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 1_000) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, maximum)
    : null
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function money(value: unknown) {
  const parsed = number(value)
  return parsed === null ? null : Math.round(parsed * 100) / 100
}

function positiveMoney(value: unknown) {
  const parsed = money(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

function unique(values: Array<string | null>, maximum = 40) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
    .slice(0, maximum)
}

function normalized(value: unknown) {
  return String(value ?? "").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ").trim()
}

function plainText(value: unknown, maximum = 5_000) {
  const raw = text(value, maximum * 3)
  return raw ? raw.replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ").trim().slice(0, maximum) : null
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value)).digest("hex")}`
}

function supportedProductTerm(term: string, exactEvidence: string) {
  const evidenceTokens = new Set(normalized(exactEvidence).split(" ")
    .filter((value) => value.length >= 2))
  const termTokens = normalized(term).split(" ")
    .filter((value) => value.length >= 2)
  return termTokens.length > 0 && termTokens.every((value) =>
    evidenceTokens.has(value))
}

function resolvedMarketplaceAspects(input: Readonly<{
  packageData: JsonRecord
  assessment: JsonRecord
}>) {
  const readiness = record(input.assessment.canonicalMarketplaceReadinessV1)
  const taxonomy = record(readiness.taxonomyPreflight)
  const truth = record(readiness.requiredItemSpecificsTruth)
  const truthResolutions = record(truth.resolutions)
  const durableResolution = record(
    input.assessment.marketplaceRequiredSpecificsBatchResolutionV1)
  const resolved: JsonRecord = { ...record(input.packageData.aspects),
    ...record(taxonomy.resolvedAspects) }
  const evidence = new Map<string, JsonRecord>()
  for (const [aspect, raw] of Object.entries(truthResolutions)) {
    const resolution = record(raw)
    const value = text(resolution.value ?? resolution.resolvedValue, 500)
    if (!value) continue
    resolved[aspect] = value
    evidence.set(aspect, resolution)
  }
  for (const raw of rows(durableResolution.resolutions)) {
    if (raw.humanReviewRequired === true) continue
    const aspect = text(raw.aspectName ?? raw.aspect, 120)
    const value = text(raw.resolvedValue ?? raw.value, 500)
    if (!aspect || !value) continue
    resolved[aspect] = value
    evidence.set(aspect, raw)
  }
  return Object.freeze({ values: Object.freeze(resolved), evidence })
}

function optimizedTitle(input: Readonly<{
  exactTitle: string
  primaryPhrase: string | null
  aspects: JsonRecord
  exactEvidence: string
}>) {
  const type = text(input.aspects.Type, 120)
  const productPhrase = input.primaryPhrase &&
    normalized(input.primaryPhrase) !== normalized(input.exactTitle) &&
    supportedProductTerm(input.primaryPhrase, input.exactEvidence)
    ? input.primaryPhrase : null
  const lead = productPhrase ?? (type && supportedProductTerm(
    type, input.exactEvidence) ? type : null)
  const exactWords = input.exactTitle.split(/\s+/).filter(Boolean)
  const leadTokens = new Set(normalized(lead).split(" ").filter(Boolean))
  const boilerplate = new Set([
    "made", "from", "color", "most", "for", "with",
  ])
  const remainder = lead ? exactWords.filter((word) =>
    !leadTokens.has(normalized(word)) && !boilerplate.has(normalized(word)))
    : exactWords.filter((word) => !boilerplate.has(normalized(word)))
  const confirmedTail = ["Material", "Color", "Features", "Size"]
    .flatMap((key) => {
      const value = text(input.aspects[key], 80)
      return value && supportedProductTerm(value, input.exactEvidence)
        ? [value] : []
    })
  const blocks = unique([lead, ...remainder, ...confirmedTail], 80)
  let candidate = blocks.join(" ").replace(/\s+/g, " ").trim()
  if (!candidate) candidate = input.exactTitle
  candidate = candidate.replace(/\s+\d+(?:\.\d+)?$/, "").trim()
  if (candidate.length > 80) {
    candidate = candidate.slice(0, 80).replace(/\s+\S*$/, "").trim()
  }
  return Object.freeze({ value: candidate,
    method: lead
      ? "EXISTING_TITLE_STRATEGY_PLUS_EXACT_PRODUCT_FACTS"
      : "EXACT_PRODUCT_TITLE_DETERMINISTIC_NORMALIZATION",
    rawSupplierTitleCopiedWithoutOptimization: false as const })
}

function keywordEvidence(input: Readonly<{
  titleStrategy: JsonRecord
  aspects: JsonRecord
  aspectEvidence: Map<string, JsonRecord>
  exactEvidence: string
  marketTest: boolean
}>) {
  const candidates: Array<Readonly<{ term: string | null; source: string,
    productRelevance: "EXACT_PRODUCT" | "UNPROVEN" }>> = []
  candidates.push({ term: text(input.titleStrategy.primarySearchPhrase, 120),
    source: "EXISTING_LISTING_INTELLIGENCE_TITLE_STRATEGY",
    productRelevance: "EXACT_PRODUCT" })
  for (const term of Array.isArray(input.titleStrategy.secondarySearchTerms)
    ? input.titleStrategy.secondarySearchTerms : []) {
    candidates.push({ term: text(term, 120),
      source: "EXISTING_LISTING_INTELLIGENCE_TITLE_STRATEGY",
      productRelevance: "EXACT_PRODUCT" })
  }
  for (const [aspect, raw] of Object.entries(input.aspects)) {
    if (["Brand", "MPN"].includes(aspect)) continue
    const value = text(raw, 120)
    const resolution = input.aspectEvidence.get(aspect)
    const fallback = resolution?.resolutionClass ===
      "MARKETPLACE_ALLOWED_FALLBACK"
    candidates.push({ term: value,
      source: fallback ? "MARKETPLACE_ALLOWED_FALLBACK"
        : "EXACT_PRODUCT_ITEM_SPECIFIC",
      productRelevance: fallback ? "UNPROVEN" : "EXACT_PRODUCT" })
  }
  const seen = new Set<string>()
  return Object.freeze(candidates.flatMap((candidate) => {
    const term = candidate.term
    const key = normalized(term)
    if (!term || !key || seen.has(key)) return []
    const relevant = candidate.productRelevance === "EXACT_PRODUCT" &&
      supportedProductTerm(term, input.exactEvidence)
    if (candidate.source === "EXISTING_LISTING_INTELLIGENCE_TITLE_STRATEGY"
        && !relevant) return []
    seen.add(key)
    return [Object.freeze({ term,
      productRelevance: relevant ? "EXACT_PRODUCT" as const
        : "MARKETPLACE_PROJECTION" as const,
      demandEvidenceClass: input.marketTest
        ? "UNPROVEN_INSUFFICIENT_MARKET_EVIDENCE" as const
        : "EXISTING_FAMILY_DEMAND_EVIDENCE" as const,
      source: candidate.source,
      exactProductDemandClaimed: false as const })]
  }).slice(0, 12))
}

function listingDescription(input: Readonly<{
  packageDescription: string | null
  exactPublicDescription: string | null
  exactTitle: string
  aspects: JsonRecord
  conditionLabel: string | null
}>) {
  if (input.packageDescription) return Object.freeze({
    value: input.packageDescription,
    source: "EXISTING_LISTING_PACKAGE_DESCRIPTION" as const,
  })
  if (input.exactPublicDescription) return Object.freeze({
    value: input.exactPublicDescription,
    source: "EXACT_PUBLIC_LUNA_PRODUCT_DESCRIPTION" as const,
  })
  const facts = Object.entries(input.aspects).flatMap(([key, raw]) => {
    const value = text(raw, 300)
    return value ? [`${key}: ${value}.`] : []
  }).slice(0, 12)
  return Object.freeze({ value: [input.exactTitle,
    input.conditionLabel ? `Condition: ${input.conditionLabel}.` : null,
    ...facts].filter(Boolean).join(" ").slice(0, 5_000),
  source: "DETERMINISTIC_EXACT_FACT_SUMMARY" as const })
}

function authoritativeCategoryName(input: Readonly<{
  exactTitle: string
  names: readonly unknown[]
}>) {
  return input.names.map((value) => text(value, 240)).find((value) =>
    value && normalized(value) !== normalized(input.exactTitle)) ?? null
}

export function buildQuickPickMarketTestListingReviewV1(input: Readonly<{
  opportunity: JsonRecord
  listingPackage: JsonRecord
  frontier?: JsonRecord | null
  catalogRow?: JsonRecord | null
  catalogProduct?: JsonRecord | null
}>) {
  const assessment = record(input.opportunity.assessment)
  const packageData = record(input.listingPackage.package_data)
  const intelligence = record(assessment.listingIntelligencePackage)
  const titleStrategy = record(intelligence.titleStrategy)
  const readiness = record(assessment.canonicalMarketplaceReadinessV1)
  const minimumReadiness = record(
    assessment.minimumTruthfulListingReadinessV1)
  const minimumContractCurrent = minimumReadiness.contractVersion ===
      MINIMUM_TRUTHFUL_LISTING_READINESS_V1
    && minimumReadiness.candidateKey === input.opportunity.candidate_key
    && minimumReadiness.opportunityId === input.opportunity.id
  const taxonomy = record(readiness.taxonomyPreflight)
  const marketTestReview = record(assessment.quickPickMarketTestReviewV1)
  const catalog = record(input.catalogRow)
  const product = record(input.catalogProduct)
  const truth = record(assessment.productTruth)
  const aspects = resolvedMarketplaceAspects({ packageData, assessment })
  const exactTitle = text(catalog.title, 350) ?? text(truth.title, 350)
    ?? text(input.opportunity.product_title, 350) ?? "Producto Luna"
  const publicDescription = plainText(product.body_html)
  const exactEvidence = [exactTitle, publicDescription,
    text(catalog.variant_title, 240), text(catalog.product_type, 160),
    ...(Array.isArray(catalog.tags) ? catalog.tags.map((value) =>
      text(value, 120)) : []), ...Object.values(aspects.values).map((value) =>
      text(value, 300))].filter(Boolean).join(" ")
  const marketTest = minimumContractCurrent
    ? minimumReadiness.marketTestReady === true
    : marketTestReview.finalDecision === "MARKET_TEST_READY"
      || input.opportunity.decision === "MARKET_TEST_READY"
  const generatedTitle = optimizedTitle({ exactTitle,
    primaryPhrase: text(titleStrategy.primarySearchPhrase, 160),
    aspects: aspects.values, exactEvidence })
  const ownerReview = record(packageData.quickPickOwnerReviewV1)
  const priorProjection = record(packageData.quickPickMarketTestPackageV1)
  const ownerEdits = record(ownerReview.authorizedEdits)
  const persistedReviewedTitle = Object.keys(ownerReview).length > 0
    ? text(packageData.title, 80) : null
  const title = persistedReviewedTitle ?? text(ownerEdits.title, 80)
    ?? text(priorProjection.title, 80) ?? generatedTitle.value
  const conditionId = text(packageData.conditionId, 30)
    ?? text(readiness.conditionId, 30)
  const conditionLabel = text(packageData.conditionLabel, 80)
    ?? text(readiness.conditionLabel, 80)
  const description = listingDescription({
    packageDescription: Object.keys(ownerReview).length > 0
      ? text(packageData.description, 5_000)
      : text(ownerEdits.description, 5_000)
        ?? text(packageData.description, 5_000),
    exactPublicDescription: publicDescription,
    exactTitle, aspects: aspects.values, conditionLabel,
  })
  const frontier = record(input.frontier)
  const targetPrice = positiveMoney(ownerEdits.targetPrice)
    ?? positiveMoney(record(packageData.pricing).targetPrice)
    ?? positiveMoney(marketTestReview.testPrice)
  const supplierCost = money(marketTestReview.supplierCost)
    ?? money(record(packageData.pricing).supplierCost)
  const shipping = money(marketTestReview.shipping)
    ?? money(frontier.shippingValue)
  const ebayFees = money(marketTestReview.ebayFees)
  const profit = money(marketTestReview.profit)
  const margin = money(marketTestReview.margin)
  const roi = money(marketTestReview.roi)
  const canonicalEconomics = targetPrice !== null && supplierCost !== null &&
    shipping !== null ? calculateEbayUnitEconomics({ salePrice: targetPrice,
      supplierCost }, { estimatedOutboundShipping: shipping }) : null
  const breakEven = money(frontier.breakEvenSellingPrice)
    ?? money(canonicalEconomics?.contributionBreakEvenPrice)
  const minimumProfitablePrice = money(
    canonicalEconomics?.minimumProfitablePrice)
  const categoryId = text(packageData.categoryId, 30)
    ?? text(readiness.categoryId, 30)
  const categoryName = authoritativeCategoryName({ exactTitle, names: [
    taxonomy.categoryName, packageData.categoryName, readiness.categoryName,
  ] })
  const keywords = keywordEvidence({ titleStrategy, aspects: aspects.values,
    aspectEvidence: aspects.evidence, exactEvidence, marketTest })
  const itemSpecificsReady = minimumContractCurrent
    ? rows(minimumReadiness.ownerLastMileActions).length === 0
      && Number(minimumReadiness.unprovenRequirementCount ?? 0) === 0
    : readiness.requiredItemSpecificsReady === true
  const marketplaceReady = minimumContractCurrent
    ? minimumReadiness.minimumTruthfulListingReady === true
    : readiness.ready === true
  const identityExact = truth.exact === true ||
    text(truth.lunaProductId, 80) === input.opportunity.supplier_product_id
  const packageReady = Boolean(identityExact && title && description.value
    && categoryId && conditionId && itemSpecificsReady && marketplaceReady
    && targetPrice !== null && supplierCost !== null && shipping !== null
    && ebayFees !== null && profit !== null && margin !== null && roi !== null
    && breakEven !== null)
  const sourceTerms = keywords.map((entry) => entry.term)
  const exactGtin = text(input.opportunity.gtin, 32)
    ?? text(record(packageData.productIdentifiers).upc, 32)
  const productIdentifiers = Object.freeze({
    upc: exactGtin,
    evidenceClass: exactGtin
      ? "EXACT_PRODUCT_IDENTITY" : "UNPROVEN",
  })
  const currentListingPackageId = text(input.listingPackage.id, 80)
  const opportunityId = text(input.opportunity.id, 80)
  const candidateKey = text(input.opportunity.candidate_key, 120)
  const supplierSku = text(input.opportunity.supplier_sku, 160)
  const lunaProductId = text(input.opportunity.supplier_product_id, 80)
  const lunaVariantId = text(input.opportunity.supplier_variant_id, 80)
  const quantity = Math.max(1, Math.trunc(number(packageData.quantity) ?? 1))
  const imageUrls = unique((Array.isArray(packageData.imageUrls)
    ? packageData.imageUrls : []).map((value) => text(value, 2_000)), 24)
  const imagesDigest = digest(imageUrls)
  const persistedItemSpecifics = Object.keys(ownerReview).length > 0
    ? record(packageData.aspects) : aspects.values
  const packageShipping = money(record(packageData.shipping)
    .supplierShippingEconomicsUsd) ?? shipping
  const materialPackage = Object.freeze({
    contractVersion: "QUICK_PICK_MATERIAL_PACKAGE_DIGEST_V1",
    listingPackageId: currentListingPackageId,
    opportunityId,
    candidateKey,
    exactProductLineage: Object.freeze({ supplierSku, lunaProductId,
      lunaVariantId,
      productTruthDigest: text(truth.evidenceDigest, 100) }),
    title, description: description.value, itemSpecifics: persistedItemSpecifics,
    categoryId, categoryName, conditionId, conditionLabel,
    price: targetPrice, quantity, imageUrls,
    shipping: packageShipping, supplierCost, ebayFees, profit, margin, roi,
    ...(exactGtin ? { productIdentifiers } : {}),
  })
  const packageDigest = digest(materialPackage)
  const persistedPackageDigest = text(priorProjection.packageDigest, 100)
  const persistedPricing = record(packageData.pricing)
  const persistedShipping = record(packageData.shipping)
  const persistedCommercialEconomicsComplete = Boolean(
    positiveMoney(persistedPricing.targetPrice) !== null
    && money(persistedPricing.supplierCost) !== null
    && money(persistedPricing.estimatedEbayFees) !== null
    && money(persistedPricing.estimatedOutboundShipping) !== null
    && money(persistedPricing.estimatedNetProfit) !== null
    && money(persistedPricing.estimatedNetMarginPercent) !== null
    && money(persistedPricing.estimatedRoiPercent) !== null
    && money(persistedPricing.contributionBreakEvenPrice) !== null
    && money(persistedShipping.supplierShippingEconomicsUsd) !== null)
  const persistedMaterialPackageCurrent = packageReady
    && persistedPackageDigest === packageDigest
    && persistedCommercialEconomicsComplete
  const ownerReviewConfirmed = ownerReview.status === "CONFIRMED" &&
    ownerReview.readyForOwnerPublishAuthorization === true
  const reviewedPackageDigest = text(ownerReview.reviewedPackageDigest, 100)
  const boundLineage = record(ownerReview.exactProductLineage)
  const finalListingPackageMatch = ownerReviewConfirmed &&
    reviewedPackageDigest === packageDigest && Boolean(currentListingPackageId) &&
    ownerReview.authorizedPackageId === currentListingPackageId &&
    ownerReview.authorizedSku === supplierSku &&
    boundLineage.lunaProductId === lunaProductId &&
    boundLineage.lunaVariantId === lunaVariantId
  const listingReady = !marketTest && (minimumContractCurrent
    ? minimumReadiness.listingReady === true
    : input.opportunity.decision === "LISTING_READY")
  const publishableAsMarketTest = marketTest && packageReady
  const publishableReadiness = packageReady &&
    (listingReady || publishableAsMarketTest)
  const ownerPublicationDecisionReady = publishableReadiness
  const readyForOwnerPublishAuthorization = publishableReadiness &&
    ownerReviewConfirmed && finalListingPackageMatch
  return Object.freeze({
    contractVersion: QUICK_PICK_MARKET_TEST_PACKAGE_AND_REMOTE_OWNER_REVIEW_V1,
    listingPackageId: currentListingPackageId,
    finalListingPackageReady: packageReady,
    titleReady: Boolean(title), title,
    titleSource: text(ownerEdits.title)
      ? "OWNER_AUTHORIZED_EDIT" : generatedTitle.method,
    rawSupplierTitleCopiedWithoutOptimization:
      generatedTitle.rawSupplierTitleCopiedWithoutOptimization,
    keywords, keywordEvidenceReconciled: sourceTerms.length > 0,
    itemSpecifics: aspects.values,
    description: description.value, descriptionSource: description.source,
    category: Object.freeze({ id: categoryId, name: categoryName,
      source: text(readiness.categorySource, 120)
        ?? "EXISTING_CANONICAL_MARKETPLACE_READINESS" }),
    condition: Object.freeze({ id: conditionId, label: conditionLabel,
      source: text(readiness.conditionSource, 160)
        ?? "EXISTING_CANONICAL_MARKETPLACE_READINESS" }),
    productIdentifiers,
    shipping: Object.freeze({ amount: shipping, currency: "USD",
      source: "DURABLE_LUNA_SHIPPING_EVIDENCE" }),
    demand: Object.freeze({ status: marketTest
      ? "UNPROVEN_INSUFFICIENT_MARKET_EVIDENCE" : "PROVEN_OR_SUPPORTED",
    exactProductDemandClaimed: false,
    soldEvidenceCount: number(record(assessment.market).soldComparableCount)
      ?? number(input.opportunity.active_comparables) ?? 0,
    soldEvidenceReused: true,
    demandIntelligenceReused: true }),
    supportedPriceBand: Object.freeze({ status: marketTest ? "UNPROVEN"
      : "AVAILABLE", minimum: marketTest ? null
        : money(frontier.marketPriceMin), median: marketTest ? null
          : money(frontier.marketPriceMedian), maximum: marketTest ? null
            : money(frontier.marketPriceMax) }),
    dollarCheck: Object.freeze({ ready: packageReady, supplierCost, shipping,
      ebayFees, targetPrice, expectedContribution: profit,
      expectedMargin: margin, expectedRoi: roi, breakEvenPrice: breakEven,
      minimumProfitablePrice,
      currency: "USD", evidenceClass: marketTest
        ? "MARKET_TEST_MINIMUM_MARGIN_SAFE_PRICE" : "CANONICAL_ECONOMICS",
      calculationSource: canonicalEconomics?.calculationSource ?? null }),
    ownerReview: Object.freeze({ status: text(ownerReview.status, 80)
      ?? "PENDING", reviewedAt: text(ownerReview.reviewedAt, 80),
    ownerReviewConfirmed,
    confirmedPackageId: finalListingPackageMatch
      ? currentListingPackageId : null,
    currentListingPackageId,
    packageMatch: finalListingPackageMatch,
    reviewedPackageDigestMatch: finalListingPackageMatch,
    persistedReadyForOwnerPublishAuthorization:
      ownerReview.readyForOwnerPublishAuthorization === true,
    readyForOwnerPublishAuthorization }),
    publishAuthorizationHandoff: Object.freeze({
      contractVersion:
        "QUICK_PICK_OWNER_CONFIRM_TO_PUBLISH_AUTHORIZATION_HANDOFF_V1",
      publishAuthorizationEligibilityBefore:
        "OWNER_CONFIRMATION_DURABLE_BUT_DASHBOARD_CTA_ABSENT_AND_GENERIC_LISTING_READY_VISUALLY_BLOCKED_MARKET_TEST",
      marketTestReadiness: marketTest && packageReady ? "PASS" as const
        : "BLOCKED" as const,
      demandProven: listingReady,
      listingReady,
      publishableAsMarketTest,
      publishableReadiness,
      ownerPublicationDecisionReady,
      ownerDecisionCtaVisible: ownerPublicationDecisionReady,
      secondNightPassRequired: false as const,
      timeWaitBeforeOwnerDecisionSeconds: 0 as const,
      ownerReviewConfirmed,
      confirmedPackageId: finalListingPackageMatch
        ? currentListingPackageId : null,
      currentListingPackageId,
      finalListingPackageMatch,
      readyForOwnerPublishAuthorization,
      publishCtaVisible: readyForOwnerPublishAuthorization,
      publishCtaEnabled: readyForOwnerPublishAuthorization,
      demandUnprovenDoesNotBlockMarketTest: marketTest,
      falseListingReadyRequirement: false as const,
      falseGenericReadyBlocker: false as const,
      goldenPathRestarted: false as const,
      marketplaceWriteAuthorized: false as const,
    }),
    authorizationBinding: Object.freeze({
      contractVersion: "QUICK_PICK_MATERIAL_PACKAGE_DIGEST_V1",
      packageId: currentListingPackageId,
      packageDigest,
      sku: supplierSku,
      exactProductLineage: materialPackage.exactProductLineage,
      quantity,
      imageCount: imageUrls.length,
      imagesDigest,
      materialPackageChangeInvalidatesAuthorization: true as const,
    }),
    runtimeMaterialization: Object.freeze({
      contractVersion: "QUICK_PICK_RUNTIME_PACKAGE_MATERIALIZATION_V1",
      persistedPackageDigest,
      projectedPackageDigest: packageDigest,
      materialPackageCurrent: persistedMaterialPackageCurrent,
      persistedCommercialEconomicsComplete,
      ownerActionPathAvailable: ownerPublicationDecisionReady
        && persistedMaterialPackageCurrent,
      batchEligibilityRequiresCurrentPackage: true as const,
      marketplaceWrites: 0 as const,
    }),
    reuseAudit: Object.freeze({ demandIntelligenceReused: true,
      soldEvidenceReused: true, intelligentTitleFactoryReused: true,
      listingPackageReused: true, dollarCheckReused: true,
      ownerAuthorizationPathReused: true, publishPathReused: true,
      liveReadbackPathReused: true,
      referenceListingCapabilityFound: true,
      referenceListingUsedAsProductTruth: false }),
    packageDigest,
    factInvented: false as const,
    aiFreeformDemandInvention: false as const,
    marketplaceWrites: 0 as const,
    listingPublications: 0 as const,
  })
}

export function buildQuickPickRuntimeMaterializedPackageDataV1(input: Readonly<{
  currentPackageData: JsonRecord
  review: ReturnType<typeof buildQuickPickMarketTestListingReviewV1>
  now: string
}>) {
  const currentOwnerReview = record(
    input.currentPackageData.quickPickOwnerReviewV1)
  const reviewedDigest = text(currentOwnerReview.reviewedPackageDigest, 100)
  const sameDigest = reviewedDigest === input.review.packageDigest
  const ownerReview = Object.keys(currentOwnerReview).length === 0 || sameDigest
    ? currentOwnerReview
    : Object.freeze({ ...currentOwnerReview,
      status: "INVALIDATED_MATERIAL_PACKAGE_CHANGE",
      readyForOwnerPublishAuthorization: false,
      marketplaceWriteAuthorized: false,
      invalidatedAt: input.now,
      invalidatedBy:
        "QUICK_PICK_RUNTIME_PACKAGE_MATERIALIZATION_V1" })
  const invalidation = record(
    input.currentPackageData.categoryDerivedStateInvalidationV1)
  return Object.freeze({ ...input.currentPackageData,
    title: input.review.title,
    description: input.review.description,
    categoryId: input.review.category.id,
    categoryName: input.review.category.name,
    conditionId: input.review.condition.id,
    conditionLabel: input.review.condition.label,
    quantity: input.review.authorizationBinding.quantity,
    aspects: input.review.itemSpecifics,
    shipping: { ...record(input.currentPackageData.shipping),
      supplierShippingEconomicsUsd: input.review.shipping.amount,
      currency: input.review.shipping.currency,
      supplierShippingEvidenceClass: input.review.shipping.source,
      supplierShippingIsBuyerFacing: false },
    pricing: { ...record(input.currentPackageData.pricing),
      currency: "USD", supplierCost: input.review.dollarCheck.supplierCost,
      targetPrice: input.review.dollarCheck.targetPrice,
      estimatedEbayFees: input.review.dollarCheck.ebayFees,
      estimatedOutboundShipping: input.review.dollarCheck.shipping,
      estimatedNetProfit: input.review.dollarCheck.expectedContribution,
      estimatedNetMarginPercent: input.review.dollarCheck.expectedMargin,
      estimatedRoiPercent: input.review.dollarCheck.expectedRoi,
      contributionBreakEvenPrice: input.review.dollarCheck.breakEvenPrice,
      minimumProfitablePrice:
        input.review.dollarCheck.minimumProfitablePrice,
      calculationSource: input.review.dollarCheck.evidenceClass,
      marketPriceSupport: input.review.supportedPriceBand.status,
      exactFeeClaimed: false },
    quickPickMarketTestPackageV1: input.review,
    ...(Object.keys(ownerReview).length > 0
      ? { quickPickOwnerReviewV1: ownerReview } : {}),
    ...(invalidation.contractVersion ===
        "SELLER_OS_CATEGORY_DERIVED_STATE_INVALIDATION_V1"
      ? { categoryDerivedStateInvalidationV1: { ...invalidation,
        packageRematerializedByRuntime: true,
        downstreamCommercialPackageRematerializedAt: input.now,
        marketplaceWrites: 0 } } : {}),
    quickPickRuntimePackageMaterializationV1: Object.freeze({
      contractVersion: "QUICK_PICK_RUNTIME_PACKAGE_MATERIALIZATION_V1",
      packageDigest: input.review.packageDigest,
      materializedAt: input.now,
      ownerAuthorizationCreated: false,
      ownerAuthorizationInvalidated: Object.keys(currentOwnerReview).length > 0
        && !sameDigest,
      marketplaceWrites: 0,
    }),
  })
}

export function buildQuickPickOwnerReviewPackageDataV1(input: Readonly<{
  currentPackageData: JsonRecord
  review: ReturnType<typeof buildQuickPickMarketTestListingReviewV1>
  actorUserId: string
  action: "EDIT" | "CONFIRM"
  edits?: JsonRecord
  now: string
}>) {
  const currentMarker = record(input.currentPackageData.quickPickOwnerReviewV1)
  const previousEdits = record(currentMarker.authorizedEdits)
  const requested = record(input.edits)
  const title = input.action === "EDIT"
    ? text(requested.title, 80) : null
  const description = input.action === "EDIT"
    ? text(requested.description, 5_000) : null
  const authorizedEdits = Object.freeze({ ...previousEdits,
    ...(title ? { title } : {}), ...(description ? { description } : {}) })
  const nextReview = Object.freeze({
    contractVersion: QUICK_PICK_REMOTE_OWNER_REVIEW_V1,
    status: input.action === "CONFIRM" ? "CONFIRMED"
      : "EDITED_PENDING_CONFIRMATION",
    reviewedBy: input.actorUserId, reviewedAt: input.now,
    authorizedEdits,
    reviewedPackageDigest: input.review.packageDigest,
    authorizedPackageId: input.review.authorizationBinding.packageId,
    authorizedSku: input.review.authorizationBinding.sku,
    authorizedQuantity: input.review.authorizationBinding.quantity,
    exactProductLineage: input.review.authorizationBinding.exactProductLineage,
    materialPackageDigestVersion:
      input.review.authorizationBinding.contractVersion,
    materialPackageChangeInvalidatesAuthorization: true,
    readyForOwnerPublishAuthorization: input.action === "CONFIRM",
    marketplaceWriteAuthorized: false,
    marketplaceWrites: 0,
  })
  return Object.freeze({ ...input.currentPackageData,
    title: text(authorizedEdits.title, 80) ?? input.review.title,
    description: text(authorizedEdits.description, 5_000)
      ?? input.review.description,
    categoryId: input.review.category.id,
    categoryName: input.review.category.name,
    conditionId: input.review.condition.id,
    conditionLabel: input.review.condition.label,
    quantity: input.review.authorizationBinding.quantity,
    aspects: input.review.itemSpecifics,
    shipping: { ...record(input.currentPackageData.shipping),
      supplierShippingEconomicsUsd: input.review.shipping.amount,
      currency: input.review.shipping.currency,
      supplierShippingEvidenceClass: input.review.shipping.source,
      supplierShippingIsBuyerFacing: false },
    pricing: { ...record(input.currentPackageData.pricing),
      currency: "USD", supplierCost: input.review.dollarCheck.supplierCost,
      targetPrice: input.review.dollarCheck.targetPrice,
      estimatedEbayFees: input.review.dollarCheck.ebayFees,
      estimatedOutboundShipping: input.review.dollarCheck.shipping,
      estimatedNetProfit: input.review.dollarCheck.expectedContribution,
      estimatedNetMarginPercent: input.review.dollarCheck.expectedMargin,
      estimatedRoiPercent: input.review.dollarCheck.expectedRoi,
      contributionBreakEvenPrice: input.review.dollarCheck.breakEvenPrice,
      minimumProfitablePrice:
        input.review.dollarCheck.minimumProfitablePrice,
      calculationSource: input.review.dollarCheck.evidenceClass,
      marketPriceSupport: input.review.supportedPriceBand.status,
      exactFeeClaimed: false },
    quickPickMarketTestPackageV1: input.review,
    quickPickOwnerReviewV1: nextReview,
  })
}
