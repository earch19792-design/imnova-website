import { createHash } from "node:crypto"

import { verifyEbayDraftOnlyPreflightSnapshot } from "./ebay-draft-only-preflight-snapshot"
import {
  calculateEbayUnitEconomics,
  DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG,
  normalizeEbayUnitEconomicsConfig,
  type EbayUnitEconomicsConfig,
} from "./ebay-unit-economics"

export type EbayDraftOnlyTarget = "SANDBOX" | "PRODUCTION"

export const EBAY_DRAFT_ONLY_APPROVAL_PHRASE = "CREAR DRAFT NO PUBLICADO"
export const EBAY_DRAFT_ONLY_PRODUCTION_APPROVAL_PHRASE =
  "CREAR DRAFT NO PUBLICADO EN PRODUCCIÓN"
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
  identityCollisionReasons?: string[]
  economicsConfig?: Partial<EbayUnitEconomicsConfig>
  target?: EbayDraftOnlyTarget
  accountFingerprint?: string | null
  now?: Date
}

export function ebayDraftOnlyApprovalPhrase(target: EbayDraftOnlyTarget) {
  return target === "PRODUCTION"
    ? EBAY_DRAFT_ONLY_PRODUCTION_APPROVAL_PHRASE
    : EBAY_DRAFT_ONLY_APPROVAL_PHRASE
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

function configuredNumber(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = Number(process.env[name])
  return Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback
}

export function ebayDraftOnlyEconomicsConfig(
  overrides: Partial<EbayUnitEconomicsConfig> = {},
) {
  return normalizeEbayUnitEconomicsConfig({
    estimatedEbayFeeRate: configuredNumber(
      "EBAY_DRAFT_ONLY_ESTIMATED_EBAY_FEE_RATE",
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.estimatedEbayFeeRate,
      0,
      0.50,
    ),
    fixedOrderFee: configuredNumber(
      "EBAY_DRAFT_ONLY_FIXED_ORDER_FEE",
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.fixedOrderFee,
      0,
      25,
    ),
    estimatedOutboundShipping: configuredNumber(
      "EBAY_DRAFT_ONLY_ESTIMATED_OUTBOUND_SHIPPING",
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.estimatedOutboundShipping,
      0,
      500,
    ),
    returnsReserveRate: configuredNumber(
      "EBAY_DRAFT_ONLY_RETURNS_RESERVE_RATE",
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.returnsReserveRate,
      0,
      0.50,
    ),
    promotedListingsReserveRate: configuredNumber(
      "EBAY_DRAFT_ONLY_PROMOTED_LISTINGS_RESERVE_RATE",
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.promotedListingsReserveRate,
      0,
      0.50,
    ),
    minimumNetProfit: configuredNumber(
      "EBAY_DRAFT_ONLY_MIN_NET_PROFIT",
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.minimumNetProfit,
      0,
      10_000,
    ),
    minimumNetMarginPercent: configuredNumber(
      "EBAY_DRAFT_ONLY_MIN_MARGIN_PERCENT",
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.minimumNetMarginPercent,
      0,
      95,
    ),
    minimumRoiPercent: configuredNumber(
      "EBAY_DRAFT_ONLY_MIN_ROI_PERCENT",
      DEFAULT_EBAY_UNIT_ECONOMICS_CONFIG.minimumRoiPercent,
      0,
      10_000,
    ),
    ...overrides,
  })
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function preflightSnapshotSecret(target: EbayDraftOnlyTarget) {
  return target === "PRODUCTION"
    ? process.env.EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET?.trim() || ""
    : process.env.EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_SNAPSHOT_SECRET?.trim() || ""
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

export function expectedEbayDraftOnlySku(listingPackage: JsonRecord) {
  const packageId = text(listingPackage.id).replace(/[^A-Za-z0-9]/g, "").toUpperCase()
  return packageId.length >= 16 ? `IMNOVA-${packageId.slice(0, 32)}` : ""
}

function normalizeAspects(value: unknown) {
  const input = record(value)
  const output: Record<string, string[]> = {}
  for (const [name, raw] of Object.entries(input)) {
    const key = name.trim()
    const values = Array.isArray(raw)
      ? raw.map((item) => text(item)).filter(Boolean)
      : [text(raw)].filter(Boolean)
    if (key && values.length) output[key] = unique(values)
  }
  return output
}

function taxonomyBlockerName(value: unknown) {
  return text(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "UNKNOWN"
}

function validCalendarDate(value: string, format: string) {
  if (format === "YYYY") return /^\d{4}$/.test(value)
  const match = format === "YYYYMM"
    ? /^(\d{4})(\d{2})$/.exec(value)
    : format === "YYYYMMDD"
      ? /^(\d{4})(\d{2})(\d{2})$/.exec(value)
      : null
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = format === "YYYYMMDD" ? Number(match[3]) : 1
  if (month < 1 || month > 12) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function validDouble(value: string) {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
    && Number.isFinite(Number(value))
}

function validateTaxonomyTypedValue(
  value: string,
  dataType: string,
  format: string,
  advancedDataType: string,
) {
  if (advancedDataType) {
    if (advancedDataType !== "NUMERIC_RANGE" || dataType !== "NUMBER") {
      return "UNSUPPORTED"
    }
    if (format && format !== "double") return "UNSUPPORTED"
    const range = /^(\d{1,3}(?:\.\d)?)-(\d{1,3}(?:\.\d)?)$/.exec(value)
    return range && Number(range[1]) <= Number(range[2]) ? "VALID" : "INVALID"
  }
  if (dataType === "STRING") return format ? "UNSUPPORTED" : "VALID"
  if (dataType === "NUMBER") {
    if (!format || format === "double") return validDouble(value) ? "VALID" : "INVALID"
    if (format === "int32") {
      if (!/^[+-]?\d+$/.test(value)) return "INVALID"
      const parsed = Number(value)
      return Number.isSafeInteger(parsed)
        && parsed >= -2_147_483_648
        && parsed <= 2_147_483_647
        ? "VALID"
        : "INVALID"
    }
    return "UNSUPPORTED"
  }
  if (dataType === "DATE") {
    if (!["YYYY", "YYYYMM", "YYYYMMDD"].includes(format)) return "UNSUPPORTED"
    return validCalendarDate(value, format) ? "VALID" : "INVALID"
  }
  return "UNSUPPORTED"
}

export function validateEbayTaxonomyAspectValues(
  aspects: Record<string, string[]>,
  aspectValidation: JsonRecord,
) {
  const blockers: string[] = []
  const constraints = Array.isArray(aspectValidation.aspectConstraints)
    ? aspectValidation.aspectConstraints.map(record)
    : []
  const officialSnapshotReady = text(aspectValidation.source) === "EBAY_TAXONOMY_OFFICIAL_READONLY"
    && text(aspectValidation.constraintSnapshotStatus) === "AVAILABLE"
    && Boolean(text(aspectValidation.categoryTreeId))
    && Boolean(text(aspectValidation.categoryTreeVersion))
  if (!officialSnapshotReady) return ["ASPECT_CONSTRAINTS_UNVERIFIABLE"]

  const byName = new Map<string, JsonRecord>()
  for (const constraint of constraints) {
    const name = text(constraint.name)
    if (!name || byName.has(name)) {
      blockers.push("ASPECT_CONSTRAINTS_UNVERIFIABLE")
      continue
    }
    byName.set(name, constraint)
  }

  for (const [name, selectedValues] of Object.entries(aspects)) {
    const blockerName = taxonomyBlockerName(name)
    const constraint = byName.get(name)
    if (!constraint) {
      blockers.push(`ASPECT_CONSTRAINT_UNAVAILABLE:${blockerName}`)
      continue
    }
    const mode = text(constraint.mode).toUpperCase()
    const cardinality = text(constraint.cardinality).toUpperCase()
    const dataType = text(constraint.dataType).toUpperCase()
    const format = text(constraint.format)
    const advancedDataType = text(constraint.advancedDataType).toUpperCase()
    const maxLength = numberOrNull(constraint.maxLength)
    const valuesComplete = constraint.valuesComplete === true
    const constraintsComplete = constraint.constraintsComplete === true
    const allowedValues = Array.isArray(constraint.values)
      ? constraint.values.map(record)
      : []

    if (!["FREE_TEXT", "SELECTION_ONLY"].includes(mode)) {
      blockers.push(`ASPECT_MODE_UNSUPPORTED:${blockerName}`)
    }
    if (!["SINGLE", "MULTI"].includes(cardinality)) {
      blockers.push(`ASPECT_CARDINALITY_UNSUPPORTED:${blockerName}`)
    } else if (cardinality === "SINGLE" && selectedValues.length !== 1) {
      blockers.push(`ASPECT_SINGLE_VALUE_REQUIRED:${blockerName}`)
    } else if (cardinality === "MULTI" && selectedValues.length > 30) {
      blockers.push(`ASPECT_VALUE_LIMIT_EXCEEDED:${blockerName}`)
    }
    if (!constraintsComplete) {
      blockers.push(`ASPECT_VALUE_CONSTRAINTS_UNVERIFIABLE:${blockerName}`)
    }
    if (mode === "SELECTION_ONLY" && (!valuesComplete || !allowedValues.length)) {
      blockers.push(`ASPECT_SELECTION_VALUES_UNVERIFIABLE:${blockerName}`)
    }

    for (const selectedValue of selectedValues) {
      if (maxLength !== null && (
        !Number.isInteger(maxLength)
        || maxLength <= 0
        || Array.from(selectedValue).length > maxLength
      )) blockers.push(`ASPECT_MAX_LENGTH_EXCEEDED:${blockerName}`)

      const typedValueStatus = validateTaxonomyTypedValue(
        selectedValue,
        dataType,
        format,
        advancedDataType,
      )
      if (typedValueStatus === "UNSUPPORTED") {
        blockers.push(`ASPECT_TYPE_FORMAT_UNVERIFIABLE:${blockerName}`)
      } else if (typedValueStatus === "INVALID") {
        blockers.push(`ASPECT_VALUE_FORMAT_INVALID:${blockerName}`)
      }

      const selectedDefinition = allowedValues.find((entry) => text(entry.value) === selectedValue)
      if (mode === "SELECTION_ONLY" && !selectedDefinition) {
        blockers.push(`ASPECT_SELECTION_VALUE_INVALID:${blockerName}`)
        continue
      }
      if (!selectedDefinition) continue
      const dependencies = Array.isArray(selectedDefinition.valueConstraints)
        ? selectedDefinition.valueConstraints.map(record)
        : []
      const dependencyValues = new Map<string, Set<string>>()
      for (const dependency of dependencies) {
        const controlName = text(dependency.applicableForAspectName)
        const controlValues = Array.isArray(dependency.applicableForAspectValues)
          ? dependency.applicableForAspectValues.map(text).filter(Boolean)
          : []
        if (!controlName || !controlValues.length) {
          blockers.push(`ASPECT_VALUE_CONSTRAINTS_UNVERIFIABLE:${blockerName}`)
          continue
        }
        const accepted = dependencyValues.get(controlName) ?? new Set<string>()
        for (const controlValue of controlValues) accepted.add(controlValue)
        dependencyValues.set(controlName, accepted)
      }
      for (const [controlName, accepted] of dependencyValues) {
        const actual = aspects[controlName] ?? []
        if (!actual.some((entry) => accepted.has(entry))) {
          blockers.push(`ASPECT_VALUE_CONSTRAINT_NOT_MET:${blockerName}`)
        }
      }
    }
  }
  return unique(blockers)
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
    supplierSku: text(opportunity.supplier_sku),
    supplierVariantId: text(opportunity.supplier_variant_id),
    marketRadarProductId: text(opportunity.market_radar_product_id),
    gtin: text(opportunity.gtin),
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
  target: EbayDraftOnlyTarget = "SANDBOX",
  accountFingerprint = "",
  economicsConfig: Partial<EbayUnitEconomicsConfig> = {},
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
  const economics = calculateEbayUnitEconomics({
    salePrice: price,
    supplierCost: opportunity.supplier_price,
  }, ebayDraftOnlyEconomicsConfig(economicsConfig))
  const canonicalPackageData = {
    ...packageData,
    pricing: {
      ...pricing,
      targetPrice: price,
      supplierCost: economics.supplierCost,
      estimatedEbayFees: economics.estimatedEbayFees,
      estimatedOutboundShipping: economics.estimatedOutboundShipping,
      returnsReserve: economics.returnsReserve,
      promotedListingsReserve: economics.promotedListingsReserve,
      estimatedNetProfit: economics.estimatedNetProfit,
      estimatedNetMarginPercent: economics.estimatedNetMarginPercent,
      estimatedRoiPercent: economics.estimatedRoiPercent,
      minimumProfitablePrice: economics.minimumProfitablePrice,
      passesProfitGate: economics.passesProfitGate,
      calculationSource: economics.calculationSource,
      costAssumptions: economics.config,
    },
  }
  const aspects = normalizeAspects(packageData.aspects)
  const categoryId = text(packageData.categoryId)
  const dimensionValues = [dimensions.height, dimensions.length, dimensions.width]
    .map(numberOrNull)
  const dimensionUnit = text(dimensions.unit).toUpperCase()
  const weightValue = numberOrNull(weight.value)
  const weightUnit = text(weight.unit).toUpperCase()
  const packageMeasurementsReady = dimensionValues.every((value) => value !== null && value > 0)
    && ['INCH', 'CENTIMETER'].includes(dimensionUnit)
    && weightValue !== null
    && weightValue > 0
    && ['POUND', 'KILOGRAM', 'OUNCE', 'GRAM'].includes(weightUnit)

  const inventoryItemPayload = {
    availability: { shipToLocationAvailability: { quantity } },
    condition,
    product: {
      title: text(packageData.title).slice(0, 80),
      description: text(packageData.description).slice(0, 100_000),
      aspects,
      imageUrls,
    },
    ...(packageMeasurementsReady ? { packageWeightAndSize: {
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
    } } : {}),
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
      packageData: canonicalPackageData,
    },
    sourceEvidence: sourceEvidence(opportunity),
    compliance: {
      imageAuthorization: record(draftConfiguration.imageAuthorization),
      aspectValidation: record(draftConfiguration.aspectValidation),
      skuCollisionCheck: record(draftConfiguration.skuCollisionCheck),
      ebayPreflightSnapshot: text(draftConfiguration.ebayPreflightSnapshot).slice(0, 4_096),
    },
    sku,
    inventoryItemPayload,
    offerPayload,
    safety: {
      target,
      accountFingerprint,
      unpublishedOnly: true,
      publishOfferPresent: false,
      permittedOperations: ["createOrReplaceInventoryItem", "createOffer"],
    },
  }
}

export function evaluateEbayDraftOnlyReadiness(input: DraftOnlyReadinessInput) {
  const now = input.now ?? new Date()
  const target = input.target ?? "SANDBOX"
  const accountFingerprint = text(input.accountFingerprint)
  const listingPackage = input.listingPackage
  const opportunity = input.opportunity
  const configuration = input.draftConfiguration
  const packageData = record(listingPackage.package_data)
  const pricing = record(packageData.pricing)
  const policies = record(configuration.businessPolicies)
  const preflightSnapshot = text(configuration.ebayPreflightSnapshot)
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
  const economicsConfig = ebayDraftOnlyEconomicsConfig(input.economicsConfig)
  const economics = calculateEbayUnitEconomics({
    salePrice: price,
    supplierCost: supplierPrice,
  }, economicsConfig)
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
  const requiredSku = expectedEbayDraftOnlySku(listingPackage)
  const quantity = Math.trunc(numberOrNull(configuration.quantity) ?? 0)
  const categoryId = text(packageData.categoryId)
  const condition = text(configuration.condition).toUpperCase()
  const weightUnit = text(weight.unit).toUpperCase()
  const dimensionUnit = text(dimensions.unit).toUpperCase()
  const dimensionValues = [dimensions.height, dimensions.length, dimensions.width]
    .map(numberOrNull)
  const weightValue = numberOrNull(weight.value)
  const validWeightUnit = ['POUND', 'KILOGRAM', 'OUNCE', 'GRAM'].includes(weightUnit)
  const validDimensionUnit = ['INCH', 'CENTIMETER'].includes(dimensionUnit)
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
  const aspectConstraintBlockers = validateEbayTaxonomyAspectValues(aspects, taxonomy)
  const taxonomyEvidenceReady = taxonomy.validated === true
    && text(taxonomy.categoryId) === categoryId
    && requiredAspects.every((name) => Boolean(aspects[name]?.length))
    && aspectConstraintBlockers.length === 0
  const packageMeasurementsProvided = dimensionValues.some((value) => value !== null)
    || Boolean(dimensionUnit)
    || weightValue !== null
    || Boolean(weightUnit)
  const dimensionsEvidenceReady = dimensionValues.every((value) => value !== null && value > 0)
    && validDimensionUnit
  const weightEvidenceReady = weightValue !== null && weightValue > 0 && validWeightUnit
  const resolvablePackageGates = new Set([
    ...(imageEvidenceReady ? ["NEED_AUTHORIZED_PRODUCT_IMAGES"] : []),
    ...(weightEvidenceReady ? ["NEED_PACKAGE_WEIGHT"] : []),
    ...(dimensionsEvidenceReady ? ["NEED_PACKAGE_DIMENSIONS"] : []),
    ...(weightEvidenceReady && dimensionsEvidenceReady ? ["NEED_PACKAGE_WEIGHT_AND_DIMENSIONS"] : []),
    ...(taxonomyEvidenceReady ? ["NEED_EBAY_TAXONOMY_CATEGORY", "NEED_REQUIRED_EBAY_ITEM_ASPECTS"] : []),
  ])
  const optionalFlatPolicyMeasurementGates = new Set([
    "NEED_PACKAGE_WEIGHT",
    "NEED_PACKAGE_DIMENSIONS",
    "NEED_PACKAGE_WEIGHT_AND_DIMENSIONS",
  ])
  const remainingHardGates = hardGates.filter((gate) =>
    !resolvablePackageGates.has(gate) && !optionalFlatPolicyMeasurementGates.has(gate)
  )
  const blockers: string[] = []

  if (!/^[0-9a-f]{64}$/.test(accountFingerprint)) blockers.push("EBAY_ACCOUNT_FINGERPRINT_REQUIRED")

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
  if (requiredAspects.length > 0 && !Object.keys(aspects).length) {
    blockers.push("ASPECTS_REQUIRED")
  }
  if (taxonomy.validated !== true || text(taxonomy.categoryId) !== categoryId || !recent(taxonomy.validatedAt, taxonomyMaxAge, now)) blockers.push("CATEGORY_ASPECTS_NOT_VALIDATED")
  blockers.push(...aspectConstraintBlockers)
  for (const name of requiredAspects) if (!aspects[name]?.length) blockers.push(`REQUIRED_ASPECT_MISSING:${name}`)
  if (!images.length || images.length !== strings(packageData.imageUrls, 24).length) blockers.push("HTTPS_IMAGES_REQUIRED")
  if (authorization.approved !== true || !recent(authorization.approvedAt, sourceMaxAge, now)) blockers.push("IMAGE_AUTHORIZATION_REQUIRED")
  if (authorization.approved === true && !images.length) blockers.push("IMAGE_AUTHORIZATION_WITHOUT_SOURCE_IMAGE")
  if (!['supplier_authorized', 'owned', 'licensed'].includes(rightsBasis)) blockers.push("IMAGE_RIGHTS_BASIS_INVALID")
  if (!['luna', 'supplier', 'owned', 'licensed_asset'].includes(imageSource)) blockers.push("IMAGE_SOURCE_INVALID")
  if (images.some((url) => !authorizedImages.includes(url))) blockers.push("IMAGE_NOT_AUTHORIZED")
  if (!requiredSku || sku !== requiredSku || !/^IMNOVA-[A-Z0-9]{16,32}$/.test(sku)) {
    blockers.push("SKU_NAMESPACE_OR_OWNERSHIP_INVALID")
  }
  if (input.activeSkuCollision || input.ledgerSkuCollision) blockers.push("SKU_COLLISION")
  const identityCollisionReasons = unique(
    strings(input.identityCollisionReasons, 20).map((value) =>
      value.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 80)
    ).filter(Boolean),
  )
  if (identityCollisionReasons.length) {
    blockers.push("PRODUCT_IDENTITY_COLLISION")
    blockers.push(...identityCollisionReasons.map((reason) => `PRODUCT_IDENTITY_COLLISION:${reason}`))
  }
  if (!Number.isInteger(quantity) || quantity < 1 || supplierStock === null || quantity > supplierStock) blockers.push("QUANTITY_EXCEEDS_FRESH_STOCK")
  if (target === "PRODUCTION" && quantity !== 1) blockers.push("PRODUCTION_QUANTITY_MUST_EQUAL_ONE")
  if (!['NEW', 'NEW_OTHER', 'NEW_WITH_DEFECTS', 'USED_EXCELLENT', 'USED_GOOD', 'USED_ACCEPTABLE'].includes(condition)) blockers.push("CONDITION_INVALID")
  if (price === null || price <= 0) blockers.push("PRICE_REQUIRED")
  if (!economics.ready || !economics.passesProfitGate) blockers.push("MINIMUM_NET_MARGIN_NOT_MET")
  if (packageMeasurementsProvided && !dimensionsEvidenceReady) {
    if (!dimensionValues.every((value) => value !== null && value > 0)) blockers.push("PACKAGE_DIMENSIONS_REQUIRED")
    if (!validDimensionUnit) blockers.push("PACKAGE_DIMENSION_UNIT_INVALID")
  }
  if (packageMeasurementsProvided && !weightEvidenceReady) {
    if (weightValue === null || weightValue <= 0) blockers.push("PACKAGE_WEIGHT_REQUIRED")
    if (!validWeightUnit) blockers.push("PACKAGE_WEIGHT_UNIT_REQUIRED")
  }
  for (const [key, value] of Object.entries({
    FULFILLMENT_POLICY_REQUIRED: policies.fulfillmentPolicyId,
    PAYMENT_POLICY_REQUIRED: policies.paymentPolicyId,
    RETURN_POLICY_REQUIRED: policies.returnPolicyId,
    MERCHANT_LOCATION_REQUIRED: configuration.merchantLocationKey,
  })) if (!/^[A-Za-z0-9_-]{1,80}$/.test(text(value))) blockers.push(key)

  const snapshotVerification = verifyEbayDraftOnlyPreflightSnapshot(
    preflightSnapshot,
    {
      target,
      accountFingerprint,
      marketplaceId: "EBAY_US",
      fulfillmentPolicyId: text(policies.fulfillmentPolicyId),
      paymentPolicyId: text(policies.paymentPolicyId),
      returnPolicyId: text(policies.returnPolicyId),
      merchantLocationKey: text(configuration.merchantLocationKey),
    },
    preflightSnapshotSecret(target),
    now,
  )
  if (!snapshotVerification.valid) blockers.push(snapshotVerification.blocker)

  const payload = buildEbayDraftOnlyPayload(
    listingPackage,
    opportunity,
    configuration,
    target,
    accountFingerprint,
    economicsConfig,
  )
  const uniqueBlockers = unique(blockers)
  return {
    ready: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    warnings: [
      target === "PRODUCTION" ? "PRODUCTION_SELLER_ACCOUNT_WRITE" : "SANDBOX_ONLY",
      "OFFER_REMAINS_UNPUBLISHED",
      "HUMAN_APPROVAL_EXPIRES_AND_IS_ONE_TIME",
      "EBAY_SKU_PREFLIGHT_RUNS_AT_EXECUTION",
      "EBAY_PREFLIGHT_SNAPSHOT_EXPIRES_IN_5_MINUTES",
      ...(!packageMeasurementsProvided ? ["OPTIONAL_PACKAGE_MEASUREMENTS_OMITTED"] : []),
    ],
    economics: {
      targetPrice: price,
      supplierPrice,
      estimatedEbayFees: economics.estimatedEbayFees,
      estimatedOutboundShipping: economics.estimatedOutboundShipping,
      returnsReserve: economics.returnsReserve,
      promotedListingsReserve: economics.promotedListingsReserve,
      estimatedNetProfit: economics.estimatedNetProfit,
      marginPercent: economics.estimatedNetMarginPercent,
      roiPercent: economics.estimatedRoiPercent,
      minimumProfitablePrice: economics.minimumProfitablePrice,
      minimumNetProfit: economicsConfig.minimumNetProfit,
      minimumMarginPercent: economicsConfig.minimumNetMarginPercent,
      minimumRoiPercent: economicsConfig.minimumRoiPercent,
      passesProfitGate: economics.passesProfitGate,
      calculationSource: economics.calculationSource,
    },
    payloadHash: hashEbayDraftOnlyPayload(payload),
    requiredSku,
    payload,
    safety: {
      canCreateUnpublishedDraft: uniqueBlockers.length === 0,
      canPublish: false,
      target,
      accountFingerprint: accountFingerprint || null,
    },
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
