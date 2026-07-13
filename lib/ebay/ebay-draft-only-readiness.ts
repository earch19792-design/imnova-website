import { createHash } from "node:crypto"

export const EBAY_DRAFT_ONLY_APPROVAL_PHRASE = "CREAR DRAFT NO PUBLICADO"
export const EBAY_DRAFT_ONLY_APPROVAL_TTL_MINUTES = 15
export const EBAY_DRAFT_ONLY_SOURCE_MAX_AGE_MINUTES = 360
export const EBAY_DRAFT_ONLY_TAXONOMY_MAX_AGE_MINUTES = 1_440

export type JsonRecord = Record<string, unknown>

export type DraftOnlyReadinessInput = {
  listingPackage: JsonRecord
  opportunity: JsonRecord
  draftConfiguration: JsonRecord
  activeSkuCollision?: boolean
  ledgerSkuCollision?: boolean
  now?: Date
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function strings(value: unknown, limit = 100) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, limit)
    : []
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function recent(value: unknown, maxAgeMinutes: number, now: Date) {
  const timestamp = Date.parse(text(value))
  if (!Number.isFinite(timestamp)) return false
  const age = now.getTime() - timestamp
  return age >= 0 && age <= maxAgeMinutes * 60_000
}

function configuredMinutes(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0
    ? Math.min(Math.trunc(value), maximum)
    : fallback
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  )
}

export function hashEbayDraftOnlyPayload(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")
}

function normalizeAspects(value: unknown) {
  const input = record(value)
  const output: Record<string, string[]> = {}
  for (const [name, raw] of Object.entries(input)) {
    const key = name.trim()
    const values = Array.isArray(raw)
      ? raw.map((item) => text(item)).filter(Boolean)
      : [text(raw)].filter(Boolean)
    if (key && values.length) output[key] = unique(values).slice(0, 30)
  }
  return output
}

function normalizeImageUrls(value: unknown) {
  return unique(strings(value, 24).map((item) => item.trim())).filter((item) => {
    try {
      return new URL(item).protocol === "https:"
    } catch {
      return false
    }
  })
}

function sourceEvidence(opportunity: JsonRecord) {
  return {
    opportunityId: text(opportunity.id),
    candidateKey: text(opportunity.candidate_key),
    queueStatus: text(opportunity.queue_status),
    hardGates: strings(opportunity.hard_gates),
    evidenceGuards: strings(opportunity.evidence_guards),
    supplierAvailable: opportunity.supplier_available === true,
    supplierInventoryQuantity: numberOrNull(opportunity.supplier_inventory_quantity),
    supplierPrice: numberOrNull(opportunity.supplier_price),
    supplierSnapshotAt: text(opportunity.supplier_snapshot_at),
    lastScannedAt: text(opportunity.last_scanned_at),
    identityScore: numberOrNull(opportunity.identity_score),
    assessment: record(opportunity.assessment),
  }
}

export function buildEbayDraftOnlyPayload(
  listingPackage: JsonRecord,
  opportunity: JsonRecord,
  draftConfiguration: JsonRecord,
) {
  const packageData = record(listingPackage.package_data)
  const pricing = record(packageData.pricing)
  const policies = record(draftConfiguration.businessPolicies)
  const packageWeightAndSize = record(draftConfiguration.packageWeightAndSize)
  const dimensions = record(packageWeightAndSize.dimensions)
  const weight = record(packageWeightAndSize.weight)
  const sku = text(draftConfiguration.sku).slice(0, 50)
  const quantity = Math.max(0, Math.trunc(numberOrNull(draftConfiguration.quantity) ?? 0))
  const condition = text(draftConfiguration.condition).toUpperCase()
  const imageUrls = normalizeImageUrls(packageData.imageUrls)
  const price = numberOrNull(pricing.targetPrice)
  const aspects = normalizeAspects(packageData.aspects)
  const categoryId = text(packageData.categoryId)

  const inventoryItemPayload = {
    availability: { shipToLocationAvailability: { quantity } },
    condition,
    product: {
      title: text(packageData.title).slice(0, 80),
      description: text(packageData.description).slice(0, 100_000),
      aspects,
      imageUrls,
    },
    packageWeightAndSize: {
      dimensions: {
        height: numberOrNull(dimensions.height),
        length: numberOrNull(dimensions.length),
        width: numberOrNull(dimensions.width),
        unit: text(dimensions.unit).toUpperCase(),
      },
      weight: {
        value: numberOrNull(weight.value),
        unit: text(weight.unit).toUpperCase(),
      },
    },
  }
  const offerPayload = {
    sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: quantity,
    categoryId,
    merchantLocationKey: text(draftConfiguration.merchantLocationKey),
    listingPolicies: {
      fulfillmentPolicyId: text(policies.fulfillmentPolicyId),
      paymentPolicyId: text(policies.paymentPolicyId),
      returnPolicyId: text(policies.returnPolicyId),
    },
    pricingSummary: {
      price: { value: price === null ? "" : price.toFixed(2), currency: "USD" },
    },
  }
  return {
    version: 1,
    listingPackage: {
      id: text(listingPackage.id),
      candidateKey: text(listingPackage.candidate_key),
      sourceObservedAt: text(listingPackage.source_observed_at),
      packageData,
    },
    sourceEvidence: sourceEvidence(opportunity),
    compliance: {
      imageAuthorization: record(draftConfiguration.imageAuthorization),
      aspectValidation: record(draftConfiguration.aspectValidation),
      skuCollisionCheck: record(draftConfiguration.skuCollisionCheck),
    },
    sku,
    inventoryItemPayload,
    offerPayload,
    safety: {
      target: "SANDBOX",
      unpublishedOnly: true,
      publishOfferPresent: false,
      permittedOperations: ["createOrReplaceInventoryItem", "createOffer"],
    },
  }
}

export function evaluateEbayDraftOnlyReadiness(input: DraftOnlyReadinessInput) {
  const now = input.now ?? new Date()
  const listingPackage = input.listingPackage
  const opportunity = input.opportunity
  const configuration = input.draftConfiguration
  const packageData = record(listingPackage.package_data)
  const pricing = record(packageData.pricing)
  const policies = record(configuration.businessPolicies)
  const authorization = record(configuration.imageAuthorization)
  const taxonomy = record(configuration.aspectValidation)
  const dimensions = record(record(configuration.packageWeightAndSize).dimensions)
  const weight = record(record(configuration.packageWeightAndSize).weight)
  const aspects = normalizeAspects(packageData.aspects)
  const images = normalizeImageUrls(packageData.imageUrls)
  const authorizedImages = normalizeImageUrls(authorization.approvedImageUrls)
  const requiredAspects = strings(taxonomy.requiredAspects)
  const hardGates = strings(opportunity.hard_gates)
  const evidenceGuards = strings(opportunity.evidence_guards)
  const supplierPrice = numberOrNull(opportunity.supplier_price)
  const supplierStock = numberOrNull(opportunity.supplier_inventory_quantity)
  const price = numberOrNull(pricing.targetPrice)
  const estimatedProfit = numberOrNull(pricing.estimatedNetProfit)
    ?? numberOrNull(opportunity.estimated_net_profit)
  const marginPercent = price && estimatedProfit !== null ? (estimatedProfit / price) * 100 : null
  const minimumMargin = configuredMinutes("EBAY_DRAFT_ONLY_MIN_MARGIN_PERCENT", 15, 80)
  const sourceMaxAge = configuredMinutes(
    "EBAY_DRAFT_ONLY_SOURCE_MAX_AGE_MINUTES",
    EBAY_DRAFT_ONLY_SOURCE_MAX_AGE_MINUTES,
    1_440,
  )
  const taxonomyMaxAge = configuredMinutes(
    "EBAY_DRAFT_ONLY_TAXONOMY_MAX_AGE_MINUTES",
    EBAY_DRAFT_ONLY_TAXONOMY_MAX_AGE_MINUTES,
    10_080,
  )
  const sku = text(configuration.sku)
  const quantity = Math.trunc(numberOrNull(configuration.quantity) ?? 0)
  const categoryId = text(packageData.categoryId)
  const condition = text(configuration.condition).toUpperCase()
  const rightsBasis = text(authorization.rightsBasis).toLowerCase()
  const imageSource = text(authorization.source).toLowerCase()
  const assessment = record(opportunity.assessment)
  const identity = record(assessment.identity)
  const scores = record(assessment.scores)
  const exactIdentityConfirmed = identity.exactIdentityConfirmed === true
  const potentialScore = numberOrNull(scores.potentialScore) ?? numberOrNull(opportunity.opportunity_score) ?? 0
  const confidenceScore = numberOrNull(scores.confidenceScore) ?? numberOrNull(opportunity.identity_score) ?? 0
  const imageEvidenceReady = authorization.approved === true
    && images.length > 0
    && images.every((url) => authorizedImages.includes(url))
    && ['supplier_authorized', 'owned', 'licensed'].includes(rightsBasis)
    && ['luna', 'supplier', 'owned', 'licensed_asset'].includes(imageSource)
  const taxonomyEvidenceReady = taxonomy.validated === true
    && text(taxonomy.categoryId) === categoryId
    && requiredAspects.every((name) => Boolean(aspects[name]?.length))
  const dimensionsEvidenceReady = numberOrNull(dimensions.height)! > 0
    && numberOrNull(dimensions.length)! > 0
    && numberOrNull(dimensions.width)! > 0
  const weightEvidenceReady = numberOrNull(weight.value)! > 0
  const resolvablePackageGates = new Set([
    ...(imageEvidenceReady ? ["NEED_AUTHORIZED_PRODUCT_IMAGES"] : []),
    ...(weightEvidenceReady ? ["NEED_PACKAGE_WEIGHT"] : []),
    ...(dimensionsEvidenceReady ? ["NEED_PACKAGE_DIMENSIONS"] : []),
    ...(weightEvidenceReady && dimensionsEvidenceReady ? ["NEED_PACKAGE_WEIGHT_AND_DIMENSIONS"] : []),
    ...(taxonomyEvidenceReady ? ["NEED_REQUIRED_EBAY_ITEM_ASPECTS"] : []),
  ])
  const remainingHardGates = hardGates.filter((gate) => !resolvablePackageGates.has(gate))
  const blockers: string[] = []

  if (!text(listingPackage.id) || text(listingPackage.candidate_key) !== text(opportunity.candidate_key)) blockers.push("PACKAGE_OPPORTUNITY_MISMATCH")
  if (!['draft', 'ready_for_review', 'approved'].includes(text(listingPackage.status))) blockers.push("PACKAGE_NOT_READY_FOR_APPROVAL")
  if (['hold', 'rejected', 'listed', 'archived'].includes(text(opportunity.queue_status))) blockers.push("OPPORTUNITY_STATUS_BLOCKED")
  if (!exactIdentityConfirmed) blockers.push("EXACT_IDENTITY_REQUIRED")
  if (potentialScore < 70) blockers.push("POTENTIAL_SCORE_BELOW_70")
  if (confidenceScore < 70) blockers.push("CONFIDENCE_SCORE_BELOW_70")
  blockers.push(...remainingHardGates.map((gate) => `HARD_GATE:${gate}`))
  blockers.push(...evidenceGuards.map((guard) => `EVIDENCE_GUARD:${guard}`))
  if (opportunity.supplier_available !== true || supplierStock === null || supplierStock <= 0) blockers.push("LUNA_STOCK_UNAVAILABLE")
  if (supplierPrice === null || supplierPrice <= 0) blockers.push("LUNA_COST_REQUIRED")
  if (!recent(opportunity.supplier_snapshot_at ?? opportunity.last_scanned_at, sourceMaxAge, now)) blockers.push("LUNA_SNAPSHOT_STALE")
  if (!recent(listingPackage.source_observed_at, sourceMaxAge, now)) blockers.push("PACKAGE_SOURCE_STALE")
  if (!text(packageData.title) || text(packageData.title).length > 80) blockers.push("TITLE_INVALID")
  if (!/^\d{1,12}$/.test(categoryId)) blockers.push("CATEGORY_ID_REQUIRED")
  if (!text(packageData.description)) blockers.push("DESCRIPTION_REQUIRED")
  if (!Object.keys(aspects).length) blockers.push("ASPECTS_REQUIRED")
  if (taxonomy.validated !== true || text(taxonomy.categoryId) !== categoryId || !recent(taxonomy.validatedAt, taxonomyMaxAge, now)) blockers.push("CATEGORY_ASPECTS_NOT_VALIDATED")
  for (const name of requiredAspects) if (!aspects[name]?.length) blockers.push(`REQUIRED_ASPECT_MISSING:${name}`)
  if (!images.length || images.length !== strings(packageData.imageUrls, 24).length) blockers.push("HTTPS_IMAGES_REQUIRED")
  if (authorization.approved !== true || !recent(authorization.approvedAt, sourceMaxAge, now)) blockers.push("IMAGE_AUTHORIZATION_REQUIRED")
  if (!['supplier_authorized', 'owned', 'licensed'].includes(rightsBasis)) blockers.push("IMAGE_RIGHTS_BASIS_INVALID")
  if (!['luna', 'supplier', 'owned', 'licensed_asset'].includes(imageSource)) blockers.push("IMAGE_SOURCE_INVALID")
  if (images.some((url) => !authorizedImages.includes(url))) blockers.push("IMAGE_NOT_AUTHORIZED")
  if (!/^[A-Za-z0-9._-]{1,50}$/.test(sku)) blockers.push("SKU_INVALID")
  if (input.activeSkuCollision || input.ledgerSkuCollision) blockers.push("SKU_COLLISION")
  if (!Number.isInteger(quantity) || quantity < 1 || supplierStock === null || quantity > supplierStock) blockers.push("QUANTITY_EXCEEDS_FRESH_STOCK")
  if (!['NEW', 'NEW_OTHER', 'NEW_WITH_DEFECTS', 'USED_EXCELLENT', 'USED_GOOD', 'USED_ACCEPTABLE'].includes(condition)) blockers.push("CONDITION_INVALID")
  if (price === null || price <= 0) blockers.push("PRICE_REQUIRED")
  if (estimatedProfit === null || estimatedProfit <= 0 || marginPercent === null || marginPercent < minimumMargin) blockers.push("MINIMUM_NET_MARGIN_NOT_MET")
  if (!(numberOrNull(dimensions.height)! > 0 && numberOrNull(dimensions.length)! > 0 && numberOrNull(dimensions.width)! > 0)) blockers.push("PACKAGE_DIMENSIONS_REQUIRED")
  if (!['INCH', 'CENTIMETER'].includes(text(dimensions.unit).toUpperCase())) blockers.push("PACKAGE_DIMENSION_UNIT_INVALID")
  if (!(numberOrNull(weight.value)! > 0) || !['POUND', 'KILOGRAM', 'OUNCE', 'GRAM'].includes(text(weight.unit).toUpperCase())) blockers.push("PACKAGE_WEIGHT_REQUIRED")
  for (const [key, value] of Object.entries({
    FULFILLMENT_POLICY_REQUIRED: policies.fulfillmentPolicyId,
    PAYMENT_POLICY_REQUIRED: policies.paymentPolicyId,
    RETURN_POLICY_REQUIRED: policies.returnPolicyId,
    MERCHANT_LOCATION_REQUIRED: configuration.merchantLocationKey,
  })) if (!/^[A-Za-z0-9_-]{1,80}$/.test(text(value))) blockers.push(key)

  const payload = buildEbayDraftOnlyPayload(listingPackage, opportunity, configuration)
  const uniqueBlockers = unique(blockers)
  return {
    ready: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    warnings: ["SANDBOX_ONLY", "OFFER_REMAINS_UNPUBLISHED", "HUMAN_APPROVAL_EXPIRES_AND_IS_ONE_TIME", "EBAY_SKU_PREFLIGHT_RUNS_AT_EXECUTION"],
    economics: { targetPrice: price, supplierPrice, estimatedNetProfit: estimatedProfit, marginPercent, minimumMarginPercent: minimumMargin },
    payloadHash: hashEbayDraftOnlyPayload(payload),
    payload,
    safety: { canCreateUnpublishedDraft: uniqueBlockers.length === 0, canPublish: false, target: "SANDBOX" },
  }
}

export function approvalExpiresAt(now = new Date()) {
  const ttl = configuredMinutes(
    "EBAY_DRAFT_ONLY_APPROVAL_TTL_MINUTES",
    EBAY_DRAFT_ONLY_APPROVAL_TTL_MINUTES,
    60,
  )
  return new Date(now.getTime() + ttl * 60_000).toISOString()
}
