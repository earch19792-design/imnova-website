import {
  containsPrivateBuyerData,
  selectExactReadonlySupply,
  stableReadonlyCommercialKey,
} from "./commercial-monitor-readonly-utilities.mjs"
import type {
  AccountTrafficEvidenceV1,
  CanonicalCommercialTimeSeriesPointV1,
} from "./ebay-commercial-monitor-traffic-scope-v1"
import type { SellerOsSaleAlertsReadV1 } from "./ebay-sale-alerts-read-v1"

export const COMMERCIAL_MONITOR_READONLY_CONTRACT_VERSION =
  "COMMERCIAL_MONITOR_READONLY_FOUNDATION_V1" as const
export const COMMERCIAL_MONITOR_ASSISTANT_OPERATION =
  "commercial_monitor.get" as const
export const COMMERCIAL_MONITOR_ALERT_CONTRACT_VERSION =
  "COMMERCIAL_MONITOR_ALERT_CANDIDATE_V1" as const

export type ObservationAvailability =
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "UNKNOWN"
  | "ERROR"
  | "PARTIAL"
  | "MISSING"
  | "INSUFFICIENT_EVIDENCE"

export type ObservationCompleteness = "COMPLETE" | "PARTIAL" | "UNPROVEN"
export type EvidenceFreshnessStatus =
  | "FRESH"
  | "STALE"
  | "UNKNOWN"
  | "NOT_APPLICABLE"
export type EvidenceGrain =
  | "ACCOUNT"
  | "ITEM"
  | "VARIATION"
  | "ORDER"
  | "ORDER_LINE"
  | "COMPONENT"
  | "LISTING_COMPONENT"

export type MarketplaceContext = {
  marketplaceId: "EBAY_US"
  accountAlias: string | null
}

export type ListingEvidenceIdentity = {
  itemId: string | null
  variationKey: string | null
  sku: string | null
}

export type EvidenceReference = {
  reference: string
  source: string
  capturedAt: string | null
}

export type ReportingWindow = {
  start: string
  end: string
  timeZone: string
}

export type EvidenceFreshness = {
  status: EvidenceFreshnessStatus
  ageSeconds: number | null
  maximumAgeSeconds: number | null
}

export type ObservationSource = {
  system: string
  operation: string
  evidenceReference: string | null
}

export type Observation<T> = {
  value: T | null
  unit: string | null
  availability: ObservationAvailability
  completeness: ObservationCompleteness
  source: ObservationSource
  capturedAt: string | null
  marketplace: MarketplaceContext
  identity: ListingEvidenceIdentity
  grain: EvidenceGrain
  reportingWindow: ReportingWindow | null
  freshness: EvidenceFreshness
  limitationCode: string | null
  explicitAuthoritativeZero: boolean
}

export type CalculatedNumericObservation = Observation<number> & {
  calculation: {
    formula: string
    version: string
    inputEvidenceReferences: string[]
    inputs: Array<{
      name: string
      value: number
      unit: string | null
      source: ObservationSource & { evidenceReference: string }
      capturedAt: string
    }>
  }
}

export function createCalculatedNumericObservation(
  observation: Observation<number>,
  calculation: CalculatedNumericObservation["calculation"],
): CalculatedNumericObservation {
  if (observation.value === null || !calculation.formula.trim() ||
      !calculation.version.trim() || !calculation.inputs.length ||
      !calculation.inputEvidenceReferences.length) {
    throw new Error("COMMERCIAL_MONITOR_CALCULATION_INPUTS_REQUIRED")
  }
  const references = new Set(calculation.inputEvidenceReferences)
  for (const input of calculation.inputs) {
    if (!input.name.trim() || !Number.isFinite(input.value) ||
        !input.source.evidenceReference ||
        !references.has(input.source.evidenceReference) ||
        !Number.isFinite(Date.parse(input.capturedAt))) {
      throw new Error("COMMERCIAL_MONITOR_CALCULATION_INPUT_INVALID")
    }
  }
  return { ...observation, calculation }
}

const NULL_ONLY_AVAILABILITY = new Set<ObservationAvailability>([
  "UNAVAILABLE",
  "UNKNOWN",
  "ERROR",
  "MISSING",
  "INSUFFICIENT_EVIDENCE",
])

export function createObservation<T>(input: Omit<Observation<T>,
  "explicitAuthoritativeZero" | "unit"> & {
    explicitAuthoritativeZero?: boolean
    unit?: string | null
  }): Observation<T> {
  if (NULL_ONLY_AVAILABILITY.has(input.availability) && input.value !== null) {
    throw new Error("COMMERCIAL_MONITOR_UNAVAILABLE_VALUE_FORBIDDEN")
  }
  if (NULL_ONLY_AVAILABILITY.has(input.availability) &&
      input.completeness === "COMPLETE") {
    throw new Error("COMMERCIAL_MONITOR_UNPROVEN_COMPLETENESS_REQUIRED")
  }
  if (input.availability === "AVAILABLE" && input.value === null) {
    throw new Error("COMMERCIAL_MONITOR_AVAILABLE_VALUE_REQUIRED")
  }
  if (input.availability === "AVAILABLE" &&
      input.completeness !== "COMPLETE") {
    throw new Error("COMMERCIAL_MONITOR_AVAILABLE_COMPLETENESS_REQUIRED")
  }
  if (input.availability === "PARTIAL" && input.completeness !== "PARTIAL") {
    throw new Error("COMMERCIAL_MONITOR_PARTIAL_COMPLETENESS_REQUIRED")
  }
  if (typeof input.value === "number" && !Number.isFinite(input.value)) {
    throw new Error("COMMERCIAL_MONITOR_FINITE_NUMBER_REQUIRED")
  }
  const isNumericZero = typeof input.value === "number" && input.value === 0
  if (isNumericZero && input.explicitAuthoritativeZero !== true) {
    throw new Error("COMMERCIAL_MONITOR_ZERO_AUTHORITY_REQUIRED")
  }
  if (!isNumericZero && input.explicitAuthoritativeZero === true) {
    throw new Error("COMMERCIAL_MONITOR_ZERO_AUTHORITY_INVALID")
  }
  return {
    ...input,
    unit: input.unit ?? null,
    explicitAuthoritativeZero: isNumericZero,
  } satisfies Observation<T>
}

export function unavailableObservation<T>(input: {
  availability?: Exclude<ObservationAvailability, "AVAILABLE" | "PARTIAL">
  completeness?: ObservationCompleteness
  source: ObservationSource
  capturedAt?: string | null
  marketplace: MarketplaceContext
  identity: ListingEvidenceIdentity
  grain: EvidenceGrain
  reportingWindow?: ReportingWindow | null
  freshness?: EvidenceFreshness
  unit?: string | null
  limitationCode: string
}) {
  return createObservation<T>({
    value: null,
    availability: input.availability ?? "UNAVAILABLE",
    completeness: input.completeness ?? "UNPROVEN",
    source: input.source,
    capturedAt: input.capturedAt ?? null,
    marketplace: input.marketplace,
    identity: input.identity,
    grain: input.grain,
    reportingWindow: input.reportingWindow ?? null,
    unit: input.unit,
    freshness: input.freshness ?? {
      status: "UNKNOWN",
      ageSeconds: null,
      maximumAgeSeconds: null,
    },
    limitationCode: input.limitationCode,
  })
}

export function projectObservationToGrain<T>(
  observation: Observation<T>,
  targetGrain: EvidenceGrain,
) {
  if (observation.grain === targetGrain) {
    return { observation, issueCode: null as string | null }
  }
  if (observation.grain === "ITEM" && targetGrain === "VARIATION") {
    return {
      observation: unavailableObservation<T>({
        availability: "INSUFFICIENT_EVIDENCE",
        source: observation.source,
        capturedAt: observation.capturedAt,
        marketplace: observation.marketplace,
        identity: observation.identity,
        grain: targetGrain,
        reportingWindow: observation.reportingWindow,
        freshness: observation.freshness,
        limitationCode: "METRIC_GRAIN_MISMATCH",
      }),
      issueCode: "METRIC_GRAIN_MISMATCH" as const,
    }
  }
  return {
    observation: unavailableObservation<T>({
      availability: "INSUFFICIENT_EVIDENCE",
      source: observation.source,
      capturedAt: observation.capturedAt,
      marketplace: observation.marketplace,
      identity: observation.identity,
      grain: targetGrain,
      reportingWindow: observation.reportingWindow,
      freshness: observation.freshness,
      limitationCode: "METRIC_GRAIN_MISMATCH",
    }),
    issueCode: "METRIC_GRAIN_MISMATCH" as const,
  }
}

export type ProductCaseLink =
  | {
      status: "AVAILABLE"
      productCaseId: string
      versionId: string | null
      versionStatus: string | null
      source: EvidenceReference
      checkedAt: string
      blocker: null
    }
  | {
      status: "MISSING"
      source: EvidenceReference
      checkedAt: string
      blocker: "PRODUCT_CASE_LINK_MISSING"
    }
  | {
      status: "UNPROVEN"
      source: "PERSISTENT_PRODUCT_CASE_NOT_IMPLEMENTED"
      checkedAt: null
      blocker: "PRODUCT_CASE_LINK_UNPROVEN"
      reason: "AUTHORITATIVE_PRODUCT_CASE_LOOKUP_UNAVAILABLE"
    }

export type AuthoritativeProductCaseLookup =
  | {
      completed: true
      found: true
      productCaseId: string
      versionId?: string | null
      versionStatus?: string | null
      evidence: EvidenceReference
      checkedAt: string
    }
  | {
      completed: true
      found: false
      evidence: EvidenceReference
      checkedAt: string
    }
  | { completed: false }

export function resolveProductCaseLink(
  lookup?: AuthoritativeProductCaseLookup,
): ProductCaseLink {
  if (!lookup?.completed) {
    return {
      status: "UNPROVEN",
      source: "PERSISTENT_PRODUCT_CASE_NOT_IMPLEMENTED",
      checkedAt: null,
      blocker: "PRODUCT_CASE_LINK_UNPROVEN",
      reason: "AUTHORITATIVE_PRODUCT_CASE_LOOKUP_UNAVAILABLE",
    }
  }
  if (!lookup.found) {
    return {
      status: "MISSING",
      source: lookup.evidence,
      checkedAt: lookup.checkedAt,
      blocker: "PRODUCT_CASE_LINK_MISSING",
    }
  }
  const productCaseId = lookup.productCaseId.trim()
  if (!productCaseId) {
    throw new Error("COMMERCIAL_MONITOR_PRODUCT_CASE_ID_REQUIRED")
  }
  return {
    status: "AVAILABLE",
    productCaseId,
    versionId: lookup.versionId?.trim() || null,
    versionStatus: lookup.versionStatus?.trim() || null,
    source: lookup.evidence,
    checkedAt: lookup.checkedAt,
    blocker: null,
  }
}

export type ExperimentReadModel =
  | {
      status: "AVAILABLE"
      experimentId: string
      accountKey?: string
      marketplace?: "EBAY_US"
      ebayItemId?: string
      sku?: string | null
      lifecycleState: string
      testedVariable: string
      hypothesis?: string
      diagnosisClass?: string
      experimentType?: string
      t0: string
      postChangeT0: string | null
      frozenVariables: string[]
      checkpointGate: string | null
      minimumObservationDurationHours?: number
      minimumEvidenceMetric?: string
      minimumEvidenceValue?: number
      currentEvidenceValue?: number | null
      nextReviewAt?: string | null
      externalSignalCodes?: string[]
      evidenceTimestamp: string
      dataQualityStatus: ObservationAvailability
      commercialAction: "NO_TOCAR" | "HUMAN_REVIEW_ONLY"
      source: EvidenceReference
    }
  | {
      status: "MISSING"
      checkedAt: string
      commercialAction: "HUMAN_REVIEW_ONLY"
      source: EvidenceReference
    }
  | {
      status: "UNPROVEN"
      checkedAt: null
      commercialAction: "HUMAN_REVIEW_ONLY"
      reason: "AUTHORITATIVE_EXPERIMENT_REGISTRY_UNAVAILABLE"
      source: "EXPERIMENT_REGISTRY_NOT_IMPLEMENTED"
    }

export type AuthoritativeExperimentLookup =
  | {
      completed: true
      found: true
      experimentId: string
      accountKey?: string
      marketplace?: "EBAY_US"
      ebayItemId?: string
      sku?: string | null
      lifecycleState: string
      testedVariable: string
      hypothesis?: string
      diagnosisClass?: string
      experimentType?: string
      t0: string
      postChangeT0?: string | null
      frozenVariables: string[]
      checkpointGate?: string | null
      minimumObservationDurationHours?: number
      minimumEvidenceMetric?: string
      minimumEvidenceValue?: number
      currentEvidenceValue?: number | null
      nextReviewAt?: string | null
      externalSignalCodes?: string[]
      evidenceTimestamp: string
      dataQualityStatus: ObservationAvailability
      evidence: EvidenceReference
    }
  | {
      completed: true
      found: false
      checkedAt: string
      evidence: EvidenceReference
    }
  | { completed: false }

export function resolveExperiment(
  lookup?: AuthoritativeExperimentLookup,
): ExperimentReadModel {
  if (!lookup?.completed) {
    return {
      status: "UNPROVEN",
      checkedAt: null,
      commercialAction: "HUMAN_REVIEW_ONLY",
      reason: "AUTHORITATIVE_EXPERIMENT_REGISTRY_UNAVAILABLE",
      source: "EXPERIMENT_REGISTRY_NOT_IMPLEMENTED",
    }
  }
  if (!lookup.found) {
    return {
      status: "MISSING",
      checkedAt: lookup.checkedAt,
      commercialAction: "HUMAN_REVIEW_ONLY",
      source: lookup.evidence,
    }
  }
  return {
    status: "AVAILABLE",
    experimentId: lookup.experimentId,
    accountKey: lookup.accountKey,
    marketplace: lookup.marketplace,
    ebayItemId: lookup.ebayItemId,
    sku: lookup.sku ?? null,
    lifecycleState: lookup.lifecycleState,
    testedVariable: lookup.testedVariable,
    hypothesis: lookup.hypothesis,
    diagnosisClass: lookup.diagnosisClass,
    experimentType: lookup.experimentType,
    t0: lookup.t0,
    postChangeT0: lookup.postChangeT0 ?? null,
    frozenVariables: [...lookup.frozenVariables],
    checkpointGate: lookup.checkpointGate ?? null,
    minimumObservationDurationHours: lookup.minimumObservationDurationHours,
    minimumEvidenceMetric: lookup.minimumEvidenceMetric,
    minimumEvidenceValue: lookup.minimumEvidenceValue,
    currentEvidenceValue: lookup.currentEvidenceValue ?? null,
    nextReviewAt: lookup.nextReviewAt ?? null,
    externalSignalCodes: [...(lookup.externalSignalCodes ?? [])],
    evidenceTimestamp: lookup.evidenceTimestamp,
    dataQualityStatus: lookup.dataQualityStatus,
    commercialAction: lookup.lifecycleState === "RUNNING"
      ? "NO_TOCAR"
      : "HUMAN_REVIEW_ONLY",
    source: lookup.evidence,
  }
}

export type StockState =
  | "IN_STOCK_SIGNAL"
  | "OUT_OF_STOCK_SIGNAL"
  | "CERTIFIED_OOS"
  | "STOCK_UNKNOWN"
  | "STOCK_CONFLICTED"
  | "STALE"
  | "SOURCE_FORMAT_CHANGED"

export type ListingOfferType =
  | "INDIVIDUAL"
  | "PACK"
  | "BUNDLE"
  | "KIT"
  | "UNKNOWN"

export type CompositionStatus =
  | "AVAILABLE"
  | "MISSING"
  | "UNPROVEN"
  | "CONFLICTED"

export type CommercialComponent = {
  componentId: string
  supplierSku: string | null
  quantityRequired: number
  evidenceReferences: EvidenceReference[]
}

export type CompositionReadModel = {
  status: CompositionStatus
  listingType: ListingOfferType
  components: CommercialComponent[]
  limitingComponentId: string | null
  sharedAllocationKnown: boolean
  bundleCapacity: Observation<number>
  limitationCode: string | null
}

export function unprovenComposition(input: {
  marketplace: MarketplaceContext
  identity: ListingEvidenceIdentity
  listingType?: ListingOfferType
}) : CompositionReadModel {
  return {
    status: "UNPROVEN",
    listingType: input.listingType ?? "UNKNOWN",
    components: [],
    limitingComponentId: null,
    sharedAllocationKnown: false,
    bundleCapacity: unavailableObservation<number>({
      availability: "UNKNOWN",
      source: {
        system: "SELLER_OS",
        operation: "COMPOSITION_REGISTRY_LOOKUP",
        evidenceReference: null,
      },
      marketplace: input.marketplace,
      identity: input.identity,
      grain: "LISTING_COMPONENT",
      unit: "LISTING_UNIT",
      limitationCode: "UNKNOWN_SHARED_ALLOCATION",
    }),
    limitationCode: "AUTHORITATIVE_COMPOSITION_REGISTRY_UNAVAILABLE",
  }
}

export type SupplyEvidence = {
  productId: string | null
  supplierVariantId: string | null
  sku: string | null
  sourceKey: string | null
  snapshotId: string | null
  available: boolean | null
  inventoryQuantity: number | null
  price: number | null
  capturedAt: string | null
  parserHealth: string | null
  sourceContractReference: string | null
  sourceContractCapturedAt: string | null
}

export type StockReadModel = {
  state: StockState
  sourceContractStatus: "HEALTHY" | "UNPROVEN" | "ERROR"
  supplierLinkageStatus?: "CERTIFIED" | "EXACT_PROVEN" | "UNPROVEN"
  supplierProductId: string | null
  supplierVariantId: string | null
  supplierSku: string | null
  available: boolean | null
  quantity: Observation<number>
  currentSupplierCost: Observation<number>
  freshness: EvidenceFreshness
  evidenceReferences: EvidenceReference[]
  limitationCode: string | null
}

function freshnessFor(
  capturedAt: string | null,
  now: Date,
  maximumAgeSeconds: number,
): EvidenceFreshness {
  const captured = Date.parse(capturedAt ?? "")
  if (!Number.isFinite(captured)) {
    return { status: "UNKNOWN", ageSeconds: null, maximumAgeSeconds }
  }
  const ageSeconds = Math.floor((now.getTime() - captured) / 1_000)
  if (ageSeconds < -300) {
    return { status: "UNKNOWN", ageSeconds: null, maximumAgeSeconds }
  }
  return {
    status: ageSeconds <= maximumAgeSeconds ? "FRESH" : "STALE",
    ageSeconds: Math.max(0, ageSeconds),
    maximumAgeSeconds,
  }
}

function supplierSource(capturedAt: string | null, reference: string | null) {
  return {
    system: "LUNA_PORTEX_MARKET_RADAR",
    operation: "LATEST_EXACT_VARIANT_SNAPSHOT",
    evidenceReference: reference,
  } satisfies ObservationSource
}

export function resolveStockEvidence(input: {
  productId: string | null
  supplierVariantId: string | null
  supplierSku: string | null
  identityLimitationCode?: string | null
  supplies: SupplyEvidence[]
  marketplace: MarketplaceContext
  identity: ListingEvidenceIdentity
  now?: Date
  maximumAgeSeconds?: number
}): StockReadModel {
  const now = input.now ?? new Date()
  const maximumAgeSeconds = Math.max(300, input.maximumAgeSeconds ?? 36 * 60 * 60)
  const unknownSource = supplierSource(null, null)
  const unknownQuantity = (limitationCode: string, state: StockState) => ({
    state,
    sourceContractStatus: state === "SOURCE_FORMAT_CHANGED" ? "ERROR" as const : "UNPROVEN" as const,
    supplierLinkageStatus: input.productId && input.supplierVariantId &&
      input.supplierSku ? "EXACT_PROVEN" as const : "UNPROVEN" as const,
    supplierProductId: input.productId,
    supplierVariantId: input.supplierVariantId,
    supplierSku: input.supplierSku,
    available: null,
    quantity: unavailableObservation<number>({
      availability: state === "SOURCE_FORMAT_CHANGED" ? "ERROR" : "UNKNOWN",
      source: unknownSource,
      marketplace: input.marketplace,
      identity: input.identity,
      grain: "COMPONENT",
      unit: "UNIT",
      limitationCode,
    }),
    currentSupplierCost: unavailableObservation<number>({
      availability: state === "SOURCE_FORMAT_CHANGED" ? "ERROR" : "UNKNOWN",
      source: unknownSource,
      marketplace: input.marketplace,
      identity: input.identity,
      grain: "COMPONENT",
      limitationCode,
    }),
    freshness: { status: "UNKNOWN" as const, ageSeconds: null, maximumAgeSeconds },
    evidenceReferences: [],
    limitationCode,
  })

  if (!input.productId || !input.supplierVariantId || !input.supplierSku) {
    return unknownQuantity(input.identityLimitationCode ??
      "SUPPLIER_IDENTITY_INCOMPLETE", "STOCK_UNKNOWN")
  }
  const exact = input.supplies.filter((row) =>
    row.productId === input.productId &&
    row.supplierVariantId === input.supplierVariantId &&
    row.sku === input.supplierSku &&
    row.sourceKey === "lunaportex"
  )
  if (exact.length > 1) {
    return unknownQuantity("SUPPLIER_IDENTITY_AMBIGUOUS", "STOCK_CONFLICTED")
  }
  const supply = selectExactReadonlySupply({
    productId: input.productId,
    variantId: input.supplierVariantId,
    sku: input.supplierSku,
  }, exact.map((row) => ({
    productId: row.productId,
    variantId: row.supplierVariantId,
    sku: row.sku,
    value: row,
  })))
  if (!supply) {
    return unknownQuantity("EXACT_LUNA_VARIANT_NOT_FOUND", "STOCK_UNKNOWN")
  }
  const evidenceReference = supply.snapshotId
    ? `MARKET_RADAR_SNAPSHOT:${supply.snapshotId}`
    : null
  const source = supplierSource(supply.capturedAt, evidenceReference)
  const freshness = freshnessFor(supply.capturedAt, now, maximumAgeSeconds)
  const references = evidenceReference ? [{
    reference: evidenceReference,
    source: "LUNA_PORTEX_MARKET_RADAR",
    capturedAt: supply.capturedAt,
  }] : []
  const sourceContractFreshness = freshnessFor(
    supply.sourceContractCapturedAt,
    now,
    maximumAgeSeconds,
  )
  if (supply.sourceContractReference) {
    references.push({
      reference: supply.sourceContractReference,
      source: "EBAY_TARGETED_LUNA_MONITOR",
      capturedAt: supply.sourceContractCapturedAt,
    })
  }
  const matchedUnknown = (
    limitationCode: string,
    state: StockState,
    availability: "UNKNOWN" | "ERROR" = "UNKNOWN",
  ) => ({
    ...unknownQuantity(limitationCode, state),
    supplierProductId: supply.productId,
    supplierVariantId: supply.supplierVariantId,
    supplierSku: supply.sku,
    freshness,
    evidenceReferences: references,
    quantity: unavailableObservation<number>({
      availability,
      source,
      capturedAt: supply.capturedAt,
      marketplace: input.marketplace,
      identity: input.identity,
      grain: "COMPONENT",
      unit: "UNIT",
      freshness,
      limitationCode,
    }),
    currentSupplierCost: unavailableObservation<number>({
      availability,
      source,
      capturedAt: supply.capturedAt,
      marketplace: input.marketplace,
      identity: input.identity,
      grain: "COMPONENT",
      freshness,
      limitationCode,
    }),
  })
  if (!evidenceReference) {
    return matchedUnknown(
      "SUPPLIER_EVIDENCE_REFERENCE_MISSING",
      "STOCK_UNKNOWN",
    )
  }
  if (freshness.status === "UNKNOWN") {
    return matchedUnknown("SUPPLIER_TIMESTAMP_INVALID", "STOCK_UNKNOWN")
  }
  if (freshness.status === "STALE") {
    return matchedUnknown("STALE_SUPPLIER_EVIDENCE", "STALE")
  }
  const parserFailed = ["SOURCE_FORMAT_CHANGED", "PARSER_ERROR", "ERROR"]
    .includes(supply.parserHealth ?? "")
  if (parserFailed) {
    return matchedUnknown(
      "SOURCE_FORMAT_CHANGED",
      "SOURCE_FORMAT_CHANGED",
      "ERROR",
    )
  }
  if (!supply.sourceContractReference ||
      sourceContractFreshness.status !== "FRESH" ||
      Date.parse(supply.sourceContractCapturedAt ?? "") <
        Date.parse(supply.capturedAt ?? "")) {
    return matchedUnknown(
      "SOURCE_CONTRACT_EVIDENCE_UNPROVEN",
      "STOCK_UNKNOWN",
    )
  }
  if (!supply.parserHealth || !["HEALTHY", "OK", "VALID"]
      .includes(supply.parserHealth)) {
    return matchedUnknown(
      "SOURCE_CONTRACT_HEALTH_UNPROVEN",
      "STOCK_UNKNOWN",
    )
  }
  const quantityValid = supply.inventoryQuantity === null || (
    Number.isInteger(supply.inventoryQuantity) && supply.inventoryQuantity >= 0
  )
  const costValid = supply.price === null || (
    Number.isFinite(supply.price) && supply.price >= 0
  )
  const contradictory = !quantityValid || !costValid ||
    (supply.available === false && supply.inventoryQuantity !== null &&
      supply.inventoryQuantity > 0) ||
    (supply.available === true && supply.inventoryQuantity === 0)
  if (contradictory) {
    return matchedUnknown(
      "SUPPLIER_AVAILABILITY_CONFLICT",
      "STOCK_CONFLICTED",
    )
  }
  if (supply.available === null) {
    return matchedUnknown(
      "SUPPLIER_AVAILABILITY_UNKNOWN",
      "STOCK_UNKNOWN",
    )
  }
  const quantity = supply.inventoryQuantity === null
      ? unavailableObservation<number>({
          availability: "UNKNOWN",
          source,
          capturedAt: supply.capturedAt,
          marketplace: input.marketplace,
          identity: input.identity,
          grain: "COMPONENT",
          unit: "UNIT",
          freshness,
          limitationCode: supply.available === false
            ? "OUT_OF_STOCK_WITHOUT_NUMERIC_QUANTITY"
            : "SUPPLIER_QUANTITY_NOT_REPORTED",
        })
      : createObservation<number>({
          value: supply.inventoryQuantity,
          availability: "AVAILABLE",
          completeness: "COMPLETE",
          source,
          capturedAt: supply.capturedAt,
          marketplace: input.marketplace,
          identity: input.identity,
          grain: "COMPONENT",
          unit: "UNIT",
          reportingWindow: null,
          freshness,
          limitationCode: null,
          explicitAuthoritativeZero: supply.inventoryQuantity === 0,
        })
  const currentSupplierCost = supply.price === null
    ? unavailableObservation<number>({
        availability: "UNKNOWN",
        source,
        capturedAt: supply.capturedAt,
        marketplace: input.marketplace,
        identity: input.identity,
        grain: "COMPONENT",
        freshness,
        limitationCode: "SUPPLIER_COST_NOT_REPORTED",
      })
    : createObservation<number>({
        value: supply.price,
        availability: "PARTIAL",
        completeness: "PARTIAL",
        source,
        capturedAt: supply.capturedAt,
        marketplace: input.marketplace,
        identity: input.identity,
        grain: "COMPONENT",
        reportingWindow: null,
        freshness,
        limitationCode: "SUPPLIER_COST_CURRENCY_UNPROVEN",
        explicitAuthoritativeZero: supply.price === 0,
      })
  return {
    state: supply.available ? "IN_STOCK_SIGNAL" : "OUT_OF_STOCK_SIGNAL",
    sourceContractStatus: "HEALTHY",
    supplierLinkageStatus: "EXACT_PROVEN" as const,
    supplierProductId: supply.productId,
    supplierVariantId: supply.supplierVariantId,
    supplierSku: supply.sku,
    available: supply.available,
    quantity,
    currentSupplierCost,
    freshness,
    evidenceReferences: references,
    limitationCode: null,
  }
}

export function isProvenSupplierLinkageV1(stock: StockReadModel) {
  return stock.supplierLinkageStatus === "CERTIFIED" ||
    stock.supplierLinkageStatus === "EXACT_PROVEN" || Boolean(
      stock.supplierProductId && stock.supplierVariantId && stock.supplierSku)
}

export const COMMERCIAL_MONITOR_METRIC_KEYS = [
  "listing_price",
  "impressions",
  "ebay_views",
  "external_views",
  "ctr_reported",
  "ctr_calculated",
  "watchers",
  "transactions",
  "orders",
  "units_sold",
  "conversion",
  "revenue",
  "fees",
  "promoted_fees",
  "supplier_cost",
  "shipping",
  "contribution",
  "net_profit",
  "margin",
  "roi",
] as const

export type CommercialMetricKey = typeof COMMERCIAL_MONITOR_METRIC_KEYS[number]
export type CommercialMetrics = Record<CommercialMetricKey,
  Observation<number> | CalculatedNumericObservation>

export type DataQualityCode =
  | "LISTING_DISCOVERY_INCOMPLETE"
  | "REGISTRY_RECONCILIATION_FAILED"
  | "PRODUCT_CASE_LINK_MISSING"
  | "PRODUCT_CASE_LINK_UNPROVEN"
  | "SOURCE_UNAVAILABLE"
  | "STALE_SUPPLIER_EVIDENCE"
  | "SOURCE_FORMAT_CHANGED"
  | "METRIC_GRAIN_MISMATCH"
  | "PARTIAL_REPORTING_WINDOW"
  | "MISSING_COMPOSITION"
  | "COMPOSITION_UNPROVEN"
  | "UNKNOWN_SHARED_ALLOCATION"
  | "ACTIVE_EXPERIMENT_CONFLICT"
  | "EXPERIMENT_STATE_UNPROVEN"
  | "ECONOMICS_INCOMPLETE"
  | "COLLECTOR_ERROR"
  | "LISTING_IDENTITY_UNPROVEN"
  | "DUPLICATE_LISTING_IDENTITY"
  | "SUPPLIER_IDENTITY_CONFLICT"
  | "REPORT_NOT_UPDATED_YET"
  | "REGISTRY_RESULT_LIMIT_REACHED"

export type DataQualityIssue = {
  code: DataQualityCode
  domain: "DISCOVERY" | "IDENTITY" | "PRODUCT_CASE" | "METRICS" |
    "STOCK" | "COMPOSITION" | "EXPERIMENT" | "ECONOMICS" | "COLLECTOR"
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
  blocking: boolean
  source: string
  evidenceReferences: string[]
  sanitizedReasonCode: string
  detectedAt: string
}

export type InformationalNextAction =
  | "NO_TOCAR"
  | "RECONCILE_LISTING_REGISTRY"
  | "REVIEW_PRODUCT_CASE_LINK"
  | "CONFIRM_COMPOSITION"
  | "REVIEW_STOCK_EVIDENCE"
  | "REVIEW_METRIC_COVERAGE"
  | "REVIEW_ECONOMICS_INPUTS"
  | "HUMAN_REVIEW_ONLY"
  | "NONE"

export type AlertReason =
  | "COMPONENT_OUT_OF_STOCK_CONFIRMED"
  | "OVERSELL_RISK"
  | "PAID_ORDER_STOCK_RISK"
  | "STOCK_STALE_OR_LOW"
  | "LISTING_COMPOSITION_INTEGRITY_MISMATCH"
  | "HIGH_IMPRESSIONS_LOW_CTR_CHECKPOINT"
  | "EXPERIMENT_CHECKPOINT_OR_COMPLETION"
  | "DATA_COVERAGE_FAILURE"

export type AlertCandidate = {
  contractVersion: typeof COMMERCIAL_MONITOR_ALERT_CONTRACT_VERSION
  eventKey: string
  reasonCode: AlertReason
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
  listingReference: {
    scope: "ACCOUNT" | "LISTING"
    marketplaceId: "EBAY_US"
    accountAlias: string | null
    itemId: string | null
    variationKey: string | null
    sku: string | null
  }
  componentReference: { componentId: string; sku: string | null } | null
  supportingEvidence: EvidenceReference[]
  freshness: { status: EvidenceFreshnessStatus; capturedAt: string | null }
  recommendedHumanDestination:
    | "SELLER_OS_MONITOR"
    | "SELLER_OS_ORDERS"
    | "PRODUCT_CASE_REVIEW"
    | "EXPERIMENT_REVIEW"
  candidateOnly: true
  dispatchAllowed: false
  whatsappCalled: false
  deliveryAttempted: false
}

export function createAlertCandidate(input: {
  accountScopeKey: string
  marketplace: MarketplaceContext
  itemId: string | null
  variationKey: string | null
  sku: string | null
  componentReference?: { componentId: string; sku: string | null } | null
  reasonCode: AlertReason
  severity: AlertCandidate["severity"]
  supportingEvidence: EvidenceReference[]
  freshness: AlertCandidate["freshness"]
  recommendedHumanDestination: AlertCandidate["recommendedHumanDestination"]
}) : AlertCandidate {
  if (!input.supportingEvidence.length) {
    throw new Error("COMMERCIAL_MONITOR_ALERT_EVIDENCE_REQUIRED")
  }
  const evidenceEpisode = input.supportingEvidence
    .map((evidence) => `${evidence.reference}:${evidence.capturedAt ?? "UNKNOWN"}`)
    .sort()
  return {
    contractVersion: COMMERCIAL_MONITOR_ALERT_CONTRACT_VERSION,
    eventKey: stableReadonlyCommercialKey(
      COMMERCIAL_MONITOR_ALERT_CONTRACT_VERSION,
      input.accountScopeKey,
      input.itemId,
      input.variationKey,
      input.componentReference?.componentId,
      input.reasonCode,
      evidenceEpisode.join("|"),
    ),
    reasonCode: input.reasonCode,
    severity: input.severity,
    listingReference: {
      scope: input.itemId ? "LISTING" : "ACCOUNT",
      marketplaceId: "EBAY_US",
      accountAlias: input.marketplace.accountAlias,
      itemId: input.itemId,
      variationKey: input.variationKey,
      sku: input.sku,
    },
    componentReference: input.componentReference ?? null,
    supportingEvidence: [...input.supportingEvidence],
    freshness: input.freshness,
    recommendedHumanDestination: input.recommendedHumanDestination,
    candidateOnly: true,
    dispatchAllowed: false,
    whatsappCalled: false,
    deliveryAttempted: false,
  }
}

export type DiscoveryCoverage = {
  status: "COMPLETE" | "PARTIAL" | "UNPROVEN"
  sources: string[]
  observedAt: string | null
  knownGapCodes: string[]
  accountAlertReasons?: string[]
  dimensions?: {
    liveEnumeration: {
      status: "COMPLETE" | "PARTIAL" | "UNPROVEN"
      observedLiveItemCount: number | null
      observedAt: string | null
      source: "EBAY_TRADING_GET_MY_EBAY_SELLING"
    }
    marketplaceCertification: {
      status: "COMPLETE" | "PARTIAL" | "UNPROVEN"
      getItemRequestedCount: number | null
      certifiedUsCount: number | null
      certifiedNonUsCount: number | null
      unresolvedCount: number | null
      errorCount: number | null
      itemIdMismatchCount: number | null
      budgetExhaustedCount: number | null
    }
    inventoryCapability: {
      status: "AVAILABLE" | "UNAVAILABLE" | "ERROR"
      sourceReadStatus: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "ERROR"
      readErrorCount: number
      oauthSafeErrorCategory:
        | "INVALID_SCOPE"
        | "INVALID_GRANT"
        | "INVALID_CLIENT"
        | "INVALID_REQUEST"
        | "UNSUPPORTED_GRANT_TYPE"
        | "OAUTH_ERROR_UNCLASSIFIED"
        | null
    }
    inventoryRepresentation: {
      status: "COMPLETE" | "PARTIAL" | "UNPROVEN"
      representedCount: number | null
      notRepresentedCount: number | null
      identityUnresolvedCount: number | null
      sourceUnprovenCount: number | null
      classificationGrain: "ITEM_SKU"
    }
    registryCoverage: {
      status: "COMPLETE" | "PARTIAL" | "UNPROVEN"
      evidenceFreshness: EvidenceFreshnessStatus
    }
    historicalDiscoveryEvidence: {
      freshness: EvidenceFreshnessStatus
    }
    analytics: {
      status: "COMPLETE" | "PARTIAL" | "UNPROVEN"
      requestedCount: number | null
      representedCount: number | null
      missingCount: number | null
    }
  }
  reconciliation?: {
    sellerWide: {
      status: "COMPLETE" | "PARTIAL" | "UNPROVEN"
      reportedItemCount: number | null
      parsedItemCount: number | null
      partitionedItemCount: number | null
      unambiguousEnumeratedIdentityCount: number | null
      representedUsItemCount: number | null
      ambiguousIdentityCount: number | null
      reportedParsedInvariant: "PASS" | "FAIL" | "UNPROVEN"
      partitionInvariant: "PASS" | "FAIL" | "UNPROVEN"
      itemGrain: "ITEM_ID"
      identityGrain: "ITEM_SKU_VARIATION"
    }
    inventory: {
      status: "COMPLETE" | "PARTIAL" | "UNPROVEN"
      publishedListingIdCount: number | null
      publishedOfferIdentityCount: number | null
      representedCount: number | null
      notRepresentedCount: number | null
      identityUnresolvedCount: number | null
      sourceUnprovenCount: number | null
      inventoryOffersNotInSellerWideEnumerationCount: number | null
      liveUsCertifiedNotInInventoryCount: number | null
      comparisonGrain: "ITEM_SKU"
    }
    registry: {
      status: "COMPLETE" | "PARTIAL" | "UNPROVEN"
      activeRegistryItemCount: number | null
      activeRegistryIdentityCount: number | null
      activeRegistryItemsNotInSellerWideEnumerationCount: number | null
      liveUsCertifiedItemsNotInRegistryCount: number | null
      activeRegistryIdentitiesNotInSellerWideEnumerationCount: number | null
      liveUsCertifiedIdentitiesNotInRegistryCount: number | null
      itemGrain: "ITEM_ID"
      identityGrain: "ITEM_SKU_VARIATION"
    }
  }
}

export function createDiscoveryCoverage(input: {
  universalCoverageProven: boolean
  sourceCoverageAvailable: boolean
  sources: string[]
  observedAt: string | null
  knownGapCodes: string[]
  accountAlertReasons?: string[]
  dimensions?: DiscoveryCoverage["dimensions"]
  reconciliation?: DiscoveryCoverage["reconciliation"]
}): DiscoveryCoverage {
  const knownGapCodes = [...new Set(input.knownGapCodes.filter(Boolean))]
  return {
    status: input.universalCoverageProven && knownGapCodes.length === 0
      ? "COMPLETE"
      : input.sourceCoverageAvailable
        ? "PARTIAL"
        : "UNPROVEN",
    sources: [...new Set(input.sources.filter(Boolean))].sort(),
    observedAt: input.observedAt,
    knownGapCodes,
    ...(input.accountAlertReasons
      ? { accountAlertReasons: [...new Set(input.accountAlertReasons)] }
      : {}),
    ...(input.dimensions
      ? { dimensions: { ...input.dimensions } }
      : {}),
    ...(input.reconciliation
      ? { reconciliation: { ...input.reconciliation } }
      : {}),
  }
}

export type ListingDiscovery = {
  registryStatus: "REGISTERED" | "UNREGISTERED_DISCOVERY" | "UNPROVEN"
  livePresence: {
    status:
      | "LIVE_ACTIVE"
      | "STORED_ONLY_NOT_IN_CURRENT_LIVE_ENUMERATION"
      | "UNPROVEN"
    source: "EBAY_TRADING_GET_MY_EBAY_SELLING" | null
    observedAt: string | null
  }
  coverage: DiscoveryCoverage
  observations: Array<{
    source: string
    listingStatus: string
    observedAt: string | null
    freshness: EvidenceFreshness
    evidenceReference: string
  }>
}

export type CommercialListingIdentity = {
  marketplace: MarketplaceContext
  itemId: string
  variationKey: string | null
  sku: string | null
  customLabel: string | null
  supplierSku: string | null
  title: string | null
  primaryImageUrl: string | null
  primaryImageSource:
    | "EBAY_TRADING_GET_MY_EBAY_SELLING"
    | "EBAY_TRADING_GET_ITEM"
    | null
  listingState: string
  listingType: ListingOfferType
  listingFormat: string | null
  startTime: string | null
  gtin: string | null
  brand: string | null
  mpn: string | null
  listedQuantity: number | null
  listedPrice?: number | null
  currency: string | null
  marketplaceCertification:
    | {
        status: "US_CERTIFIED"
        source: "EBAY_TRADING_GET_ITEM"
        observedAt: string
        grain: "ITEM"
      }
    | {
        status: "UNPROVEN"
        source: null
        observedAt: null
        grain: "ITEM"
      }
  source: string
  lastObservedAt: string | null
  freshness: EvidenceFreshness
}

export type CommercialListingReadModel = {
  key: string
  identity: CommercialListingIdentity
  discovery: ListingDiscovery
  productCase: ProductCaseLink
  composition: CompositionReadModel
  stock: StockReadModel
  metrics: CommercialMetrics
  experiment: ExperimentReadModel
  dataQualityIssues: DataQualityIssue[]
  blockers: DataQualityIssue[]
  informationalNextAction: InformationalNextAction
  evidenceReferences: EvidenceReference[]
  alertCandidateKeys: string[]
}

export type SourceReaderStatus = {
  source: string
  status: ObservationAvailability
  observedAt: string | null
  limitationCode: string | null
}

export type EbayLiveCertificationReadModel = {
  status: "CERTIFIED" | "PARTIAL" | "BLOCKED"
  environment: "PRODUCTION"
  marketplaceId: "EBAY_US"
  account: {
    accountAlias: string | null
    bindingConfigured: boolean
    bindingMatched: boolean
    observedAt: string | null
    source: string
    limitationCode: string | null
  }
  oauth: {
    status: ObservationAvailability
    tokenReceived: boolean
    tokenPersisted: false
    tokenReturned: false
    expiryKnown: boolean
    earliestAccessTokenExpiryAt: string | null
    scopes: Array<{
      scope: string
      classifications: Array<
        "READ_REQUIRED" | "READ_AVAILABLE" |
        "WRITE_CAPABLE_BUT_NOT_USED" | "MISSING"
      >
      evidenceOperation: string | null
    }>
  }
  discovery: {
    status: ObservationAvailability
    coverage: "COMPLETE" | "PARTIAL" | "UNPROVEN"
    observedAt: string | null
    source: string
    pagesRead: number
    totalPages: number | null
    totalEntries: number | null
    sellerWideItemsReported: number | null
    sellerWideItemsParsed: number | null
    sellerWideItemsMarketplaceCertifiedUs: number | null
    sellerWideItemsMarketplaceCertifiedNonUs: number | null
    sellerWideItemsMarketplaceUnresolved: number | null
    sellerWideItemsMarketplaceError: number | null
    sellerWideItemsMarketplaceBudgetExhausted: number | null
    sellerWideItemsMarketplaceItemIdMismatch: number | null
    sellerWideItemsRepresented: number | null
    representedItemCount: number | null
    variationRowCount: number | null
    gapCodes: string[]
  }
  inventory: {
    status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "ERROR"
    capabilityStatus: "AVAILABLE" | "UNAVAILABLE" | "ERROR"
    observedAt: string | null
    inventorySkuCount: number | null
    publishedListingCount: number | null
    oauthSafeErrorCategory:
      | "INVALID_SCOPE"
      | "INVALID_GRANT"
      | "INVALID_CLIENT"
      | "INVALID_REQUEST"
      | "UNSUPPORTED_GRANT_TYPE"
      | "OAUTH_ERROR_UNCLASSIFIED"
      | null
    representation: {
      status: "COMPLETE" | "PARTIAL" | "UNPROVEN"
      representedCount: number | null
      notRepresentedCount: number | null
      identityUnresolvedCount: number | null
      sourceUnprovenCount: number | null
      classificationGrain: "ITEM_SKU"
    }
    gapCodes: string[]
  }
  analytics: {
    status: "CERTIFIED" | "PARTIAL" | "UNAVAILABLE"
    observedAt: string | null
    windowStart: string | null
    windowEnd: string | null
    analyticsRequestedItemCount: number | null
    analyticsRepresentedItemCount: number | null
    analyticsMissingItemCount: number | null
    analyticsCoverageStatus: "COMPLETE" | "PARTIAL" | "UNPROVEN"
    representedItemCount: number | null
    gapCodes: string[]
  }
  orders: {
    status: "CERTIFIED" | "PARTIAL" | "UNAVAILABLE"
    observedAt: string | null
    windowStart: string | null
    windowEnd: string | null
    sanitizedOrderCount: number | null
    gapCodes: string[]
  }
  calls: Array<{
    operation: string
    method: "GET" | "POST"
    endpoint: string
    status: "SUCCEEDED" | "FAILED"
    httpStatus: number | null
    observedAt: string
    marketplaceMutation: false
    persisted: false
  }>
  safety: {
    marketplaceWrites: 0
    databaseWrites: 0
    inventoryWrites: 0
    listingRevisions: 0
    listingEnds: 0
    fulfillmentWrites: 0
    buyerMessages: 0
    whatsappCalls: 0
    tokensReturned: false
    rawPayloadsReturned: false
    buyerPiiReturned: false
  }
}

export type CommercialLearningReadModel = {
  status: ObservationAvailability
  source: string
  evidenceTimestamp: string | null
  modelVersions: string[]
  categoryAdjustments: Array<{
    categoryId: string
    status: string
    eligible: boolean
    completeness: ObservationCompleteness
    adjustmentPoints: number
    sampleListingCount: number
    totalImpressions: number
    minimumObservationDays: number
    computedAt: string
    source: string
    evidenceReference: string
  }>
  limitationCode: string | null
}

export type TimelineEntry = {
  at: string
  kind: "DISCOVERY" | "IDENTITY" | "METRICS" | "SUPPLIER" |
    "ORDER" | "ALERT" | "LEARNING"
  listingReference: { itemId: string | null; variationKey: string | null }
  evidenceReferences: string[]
  sanitizedReasonCode: string | null
}

export type CommercialMonitorCapabilityStatus =
  | "AVAILABLE"
  | "COMPLETE"
  | "PARTIAL"
  | "PARTIAL_CERTIFIED"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "UNAVAILABLE_AUTH_PENDING"
  | "UNAVAILABLE_NO_CURRENT_REPORT"
  | "AUTH_PENDING"
  | "MISSING"
  | "UNPROVEN"
  | "ERROR"

export type CommercialDecisionClass =
  | "VISIBILITY"
  | "CTR"
  | "CONVERSION"
  | "DATA_QUALITY"
  | "HEALTHY_WAIT"

export type CommercialDecisionAction =
  | "WAIT"
  | "IMPROVE_VISIBILITY"
  | "IMPROVE_CTR"
  | "IMPROVE_CONVERSION"
  | "FIX_DATA_QUALITY"
  | "REVIEW_EBAY_GUIDANCE"
  | "START_CONTROLLED_EXPERIMENT"
  | "HUMAN_REVIEW"

export type CommercialDecisionReason =
  | "AUTHORITATIVE_ZERO_IMPRESSIONS"
  | "LOW_CTR_WITH_SUFFICIENT_IMPRESSIONS"
  | "TRAFFIC_WITHOUT_CONVERSION"
  | "INSUFFICIENT_TRAFFIC"
  | "INSUFFICIENT_ANALYTICS_EVIDENCE"
  | "BLOCKING_DATA_QUALITY_ISSUE"
  | "ACTIVE_EXPERIMENT_PROTECTS_VARIABLE"
  | "WAIT_ACTIVE_EXPERIMENT"
  | "WAIT_MINIMUM_TIME"
  | "WAIT_MINIMUM_EVIDENCE"
  | "REVIEW_EXPERIMENT_RESULT"
  | "EXTERNAL_SIGNAL_REVIEW"
  | "HARD_OVERRIDE_REQUIRES_HUMAN_REVIEW"
  | "HEALTHY_EVIDENCE_WAIT_FOR_NEXT_REVIEW"

export type EbayGuidanceComparisonReason =
  | "LIVE_ANALYTICS_CONTRADICTS_GUIDANCE"
  | "GUIDANCE_SUPPORTED_BY_DATA_QUALITY_GAP"
  | "ACTIVE_EXPERIMENT_PROTECTS_VARIABLE"
  | "INSUFFICIENT_TRAFFIC"
  | "INSUFFICIENT_CONVERSION_EVIDENCE"
  | "BENCHMARK_SUPPORTS_GUIDANCE"
  | "BENCHMARK_NOT_AVAILABLE"
  | "GUIDANCE_NOT_AVAILABLE"

export type EbayListingQualityRecommendation = {
  source: "EBAY_LISTING_QUALITY_REPORT"
  sourceVersion: string
  listingKey: string | null
  associationStatus: "ITEM_ID_CERTIFIED" | "SKU_UNIQUE" | "UNPROVEN"
  recommendationCategory: string
  recommendationType: string
  recommendationText: string | null
  reportedBenchmark: number | null
  topCategoryBenchmark: number | null
  observedAt: string
  importedAt: string
}

export type CommercialListingDecisionV1 = {
  listingKey: string
  classification: CommercialDecisionClass
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
  evidenceStatus: "AVAILABLE" | "PARTIAL" | "UNPROVEN"
  reasonCodes: CommercialDecisionReason[]
  recommendedAction: CommercialDecisionAction
  actionBlockedByInsufficientEvidence: boolean
  experimentRunning: boolean
  variableFrozen: boolean
  protectionState: "DO_NOT_TOUCH" | "NONE" | "UNPROVEN"
  experimentOperationalState:
    | "RUNNING"
    | "WAITING_FOR_EVIDENCE"
    | "READY_TO_EVALUATE"
    | "PAUSED_FOR_EXTERNAL_SIGNAL"
    | "INACTIVE"
    | "UNPROVEN"
  frozenVariables: string[]
  nextReviewEvidenceRemaining: number | null
  externalSignalCount: number | null
  nextReviewCondition: string | null
  nextReviewAt: string | null
  actionExecutionAllowed: false
}

export type EbayGuidanceComparisonV1 = {
  listingKey: string
  ebayGuidanceStatus: "AVAILABLE" | "MISSING" | "UNPROVEN"
  sellerOsDiagnosisStatus: "AVAILABLE" | "UNPROVEN"
  conclusion:
    | "AGREE"
    | "PARTIALLY_AGREE"
    | "DISAGREE"
    | "INSUFFICIENT_EVIDENCE"
  reasonCodes: EbayGuidanceComparisonReason[]
  automaticExecutionAllowed: false
}

export type LivePortfolioScopeType = "CURRENT_LIVE_COHORT_SCOPE"

export type LivePortfolioInvariantCode =
  | "DUPLICATE_ITEM_ID"
  | "DUPLICATE_LIVE_SKU"
  | "NON_LIVE_ENTITY_IN_LIVE_DENOMINATOR"
  | "NON_LIVE_EVIDENCE_PRESENT_EXCLUDED"
  | "MISSING_REGISTRY_RELATIONSHIP"
  | "COUNT_PARITY_FAILURE"
  | "FALSE_ZERO_FROM_UNPROVEN_CAPABILITY"
  | "HISTORICAL_OR_NONLIVE_SALES_ATTRIBUTION_REQUIRED"

export type LivePortfolioInvariantLifecycle =
  | "DETECTED_RISK"
  | "ACTIVE_VIOLATION"
  | "MITIGATED_BY_POLICY"
  | "RECONCILED"
  | "ACCEPTED_EXCEPTION"

export type DeterministicIntegrityGuardCode =
  | "LIVE_SKU_UNIQUENESS_CHECK"
  | "FALSE_ZERO_REPRESENTATION_GUARD"
  | "STOCK_EVIDENCE_DEDUPLICATION_GUARD"
  | "CURRENT_LIVE_COHORT_RECONCILIATION"
  | "ACCOUNT_TRAFFIC_METADATA_VALIDATION_GUARD"
  | "ACCOUNT_TRAFFIC_SNAPSHOT_REUSE_GUARD"
  | "REVIEW_BURDEN_AUTHORITY_MISMATCH_GUARD"
  | "OPERATIONAL_REVIEW_FALSE_ZERO_GUARD"

export type LivePortfolioInvariantFindingV1 = {
  invariantCode: LivePortfolioInvariantCode
  lifecycle: LivePortfolioInvariantLifecycle
  strategicClassification:
    | "ACTIVE_VIOLATION"
    | "MITIGATED_CONDITION"
    | "UNRESOLVED_HUMAN_IDENTITY"
    | "CAPABILITY_BLOCKER"
    | "DETECTED_RISK"
  guardCode: DeterministicIntegrityGuardCode | null
  guardAlwaysOn: boolean
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
  module: string
  entityType: string
  entityRefs: string[]
  observedNumerator: number | null
  observedDenominator: number | null
  scopeId: string
  scopeType: LivePortfolioScopeType | "ACCOUNT_TRAFFIC_SCOPE" |
    "EVIDENCE_ENTITY_SCOPE" | "REGISTRY_PARTITION_SCOPE"
  evidenceRefs: string[]
  deterministic: true
  humanApprovalRequired: boolean
  autoMutationAllowed: false
  recommendedAction: string
  blockingImpact: string
  observedAt: string | null
}

export type CanonicalCurrentLiveCohortV1 = {
  contractVersion: "CANONICAL_CURRENT_LIVE_COHORT_V1_2026_08_13"
  scopeId: string
  scopeType: LivePortfolioScopeType
  observedAt: string | null
  authoritativeSource:
    "EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION"
  listingCount: number
  itemIds: string[]
  dedupeApplied: boolean
  identityStatus: "CERTIFIED" | "PARTIAL" | "UNPROVEN"
}

export type CurrentLiveAuthorityReadModelV1 = {
  contractVersion: "SELLER_OS_CURRENT_LIVE_AUTHORITY_RECOVERY_V1"
  currentState: "CURRENT_FRESH" | "CURRENT_UNAVAILABLE"
  currentListingCount: number | null
  currentItemIds: readonly string[]
  currentObservedAt: string | null
  authoritativeZero: boolean
  lastCertifiedState: "LAST_CERTIFIED_AVAILABLE" |
    "LAST_CERTIFIED_STALE" | "NO_CERTIFIED_HISTORY"
  lastCertifiedListingCount: number | null
  lastCertifiedItemIds: readonly string[]
  lastCertifiedAt: string | null
  lastCertifiedFreshUntil: string | null
  scopeId: string | null
  sourceAuthority:
    "EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION" | null
  sourceFailureCode: string | null
  nextRetryAt: string | null
  ownerActionRequired: false
  marketplaceWrites: 0
}

export type CrossModuleLivePortfolioIntegrityV1 = {
  contractVersion: "CROSS_MODULE_LIVE_PORTFOLIO_INTEGRITY_V1_2026_08_13"
  hardeningVersion: "CROSS_MODULE_INTEGRITY_HARDENING_V2_2026_08_13"
  canonicalCohort: CanonicalCurrentLiveCohortV1
  stockCohort: {
    scopeId: string
    scopeType: LivePortfolioScopeType
    scopeCount: number
    observedAt: string | null
    grain: "STOCK_EVIDENCE_ROW"
    evidenceRowCount: number
    currentLiveItemCount: number
    currentLiveEvidenceRowCount: number
    nonLiveEvidenceRowCount: number
    nonLiveItemIds: string[]
    missingCurrentLiveItemIds: string[]
    duplicateItemIds: Array<{
      itemId: string
      rowCount: number
      evidenceRows: Array<{
        evidenceRowId: string
        evidenceFingerprint: string
        title: string | null
        sku: string | null
        customLabel: string | null
        source: string
        capturedAt: string | null
        evidenceReference: string
        cohortClassification: "CURRENT_LIVE" | "HISTORICAL_OR_NONLIVE"
        representationHash: string
      }>
      evidenceRowsTruncated: boolean
      titleRepresentations: string[]
      skuRepresentations: string[]
      identityRepresentationConflict: boolean
    }>
    dedupeApplied: boolean
  }
  liveSkuUniqueness: {
    status: "PASS" | "FAIL" | "UNPROVEN"
    scopeId: string
    scopeType: LivePortfolioScopeType
    scopeCount: number
    observedAt: string | null
    grain: "LIVE_CUSTOM_LABEL_SKU"
    collisionCount: number | null
    collisions: Array<{
      sku: string
      itemIds: string[]
      titles: string[]
      humanApprovalRequired: true
    }>
  }
  findings: LivePortfolioInvariantFindingV1[]
  deterministicGuards: Array<{
    guardCode: DeterministicIntegrityGuardCode
    status: "PASS" | "TRIGGERED" | "MITIGATED" | "UNPROVEN" |
      "DEGRADED" | "FAIL"
    scopeId: string
    scopeType: LivePortfolioScopeType | "ACCOUNT_TRAFFIC_SCOPE"
    scopeCount: number | null
    observedAt: string | null
    grain: string
    evidenceCount: number
    reasonCode: string
    guardAlwaysOn: true
    independentOfAutomationThreshold: true
    autoMutationAllowed: false
  }>
  lifecyclePolicy: {
    statuses: LivePortfolioInvariantLifecycle[]
    reconciliationRequiresAuthoritativeEvidence: true
    acceptedExceptionRequiresHumanApproval: true
    automaticLifecycleMutationAllowed: false
  }
  denominatorPolicy: {
    currentLiveRatesUseCanonicalItemIds: true
    nonLiveEvidenceExcludedFromLiveRates: true
    registryPartitionsExcludedFromListingRates: true
  }
  readOnly: true
}

export type OperationalReviewBurdenV2 = {
  contractVersion: "OPERATIONAL_REVIEW_BURDEN_V2_2026_08_13"
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "UNPROVEN"
  value: number | null
  numerator: number | null
  denominator: number | null
  authority: "DECISION_TAXONOMY_V2"
  scopeId: string
  scopeType: LivePortfolioScopeType
  scopeCount: number
  observedAt: string | null
  grain: "EBAY_LIVE_LISTING"
  entityType: "EBAY_LIVE_LISTING"
  zeroIsAuthoritative: boolean
  reasonCode:
    | "OPERATIONAL_REVIEW_AUTHORITATIVE_COUNT"
    | "OPERATIONAL_REVIEW_AUTHORITATIVE_ZERO"
    | "OPERATIONAL_REVIEW_DECISION_COVERAGE_INCOMPLETE"
    | "OPERATIONAL_REVIEW_DEPENDENCY_UNAVAILABLE"
    | "CURRENT_LIVE_COHORT_PARTIAL"
    | "CURRENT_LIVE_COHORT_UNPROVEN"
  dependencyStatus: {
    currentLiveIdentity: "AVAILABLE" | "PARTIAL" | "UNPROVEN"
    decisions: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "UNPROVEN"
    registry: CommercialMonitorCapabilityStatus
    unresolvedListingCount: number
    registryUnavailableMayBecomeZero: false
  }
  falseZeroGuard: {
    guardCode: "OPERATIONAL_REVIEW_FALSE_ZERO_GUARD"
    status: "PASS" | "TRIGGERED"
    authority: "DECISION_TAXONOMY_V2"
    scopeType: LivePortfolioScopeType
    scopeCount: number
    reasonCode:
      | "AUTHORITATIVE_OPERATIONAL_ZERO"
      | "AUTHORITATIVE_OPERATIONAL_REVIEW_COUNT"
      | "UNPROVEN_OPERATIONAL_REVIEW_REMAINS_NULL"
      | "UNAVAILABLE_DEPENDENCY_WOULD_CREATE_FALSE_ZERO"
    zeroIsAuthoritative: boolean
    dependencyStatus: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "UNPROVEN"
    observedAt: string | null
    autoMutationAllowed: false
  }
}

export type CommercialMonitorBackendV1 = {
  contractVersion: "COMMERCIAL_MONITOR_BACKEND_V1"
  mode: "READ_ONLY"
  currentLiveAuthority: CurrentLiveAuthorityReadModelV1
  capabilities: {
    sellerAccountBinding: CommercialMonitorCapabilityStatus
    tradingDiscovery: CommercialMonitorCapabilityStatus
    marketplaceCertification: CommercialMonitorCapabilityStatus
    analytics: CommercialMonitorCapabilityStatus
    registry: {
      status: CommercialMonitorCapabilityStatus
      currentLiveCount: number | null
      matchedCount: number | null
      humanReviewCount: number | null
      coveragePercent: number | null
      limitationCodes: string[]
    }
    ordersFulfillment: CommercialMonitorCapabilityStatus
    listingQualityReport: CommercialMonitorCapabilityStatus
    inventory: {
      status: "DEGRADED"
      oauthCapability: "AVAILABLE"
      locationsCapability: "AVAILABLE"
      inventoryItemsResource: "EBAY_REJECTED_25709_UNRESOLVED"
      representation: "UNPROVEN"
    }
  }
  kpis: {
    activeListings: { status: CommercialMonitorCapabilityStatus; value: number | null }
    impressions: { status: CommercialMonitorCapabilityStatus; value: number | null }
    ebayViews: { status: CommercialMonitorCapabilityStatus; value: number | null }
    averageCtr: { status: CommercialMonitorCapabilityStatus; value: number | null }
    quantitySold: { status: CommercialMonitorCapabilityStatus; value: number | null }
    orders: { status: CommercialMonitorCapabilityStatus; value: number | null }
  }
  trafficScopes: {
    reconciliation: "EXPLICIT_SCOPE_SEPARATION"
    sellerHubEquivalence: "CONDITIONAL_ON_WINDOW_TIMEZONE_SCOPE_AND_REPORTING_LAG"
    accountTraffic: AccountTrafficEvidenceV1
    currentLivePortfolio: {
      scope: "CURRENT_LIVE_PORTFOLIO"
      scopeId: string
      scopeType: LivePortfolioScopeType
      scopeCount: number
      scopeObservedAt: string | null
      grain: "LISTING_WINDOW_AGGREGATE"
      source: "EBAY_TRADING_PLUS_SELL_ANALYTICS"
      windowStart: string | null
      windowEnd: string | null
      timeZone: "UTC"
      observedAt: string | null
      completeness: CommercialMonitorCapabilityStatus
      analyticsStatus: "CURRENT" | "LAST_KNOWN_GOOD" | "UNAVAILABLE"
      currentSourceStatus: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE_429" |
        "UNAVAILABLE_OTHER"
      snapshotDataStatus: "AVAILABLE_CURRENT" | "AVAILABLE_STALE" |
        "UNAVAILABLE"
      snapshotCapturedAt: string | null
      snapshotAgeSeconds: number | null
      activeListings: number | null
      impressions: number | null
      listingViews: number | null
      quantitySold: number | null
      ctr: number | null
    }
  }
  livePortfolioIntegrity: CrossModuleLivePortfolioIntegrityV1
  orders: {
    status: CommercialMonitorCapabilityStatus
    orderCount: number | null
    lineItemCount: number | null
    quantitySold: number | null
    latestOrderCreationAt: string | null
    orderStatuses: string[]
    fulfillmentStatuses: string[]
    trackingAvailability: "AVAILABLE" | "MISSING" | "UNPROVEN"
    buyerPiiIncluded: false
  }
  orderSourceHealth: {
    contractVersion: "ORDER_SOURCE_HEALTH_V1"
    detectionPolicyVersion: "ORDER_DETECTION_POLICY_V1"
    capability: "EBAY_SELL_FULFILLMENT_GET_ORDERS"
    permissionStatus: "PROVEN" | "UNPROVEN" | "UNAVAILABLE"
    detectionMode: "POLLING"
    eventDrivenStatus: "OFFICIAL_CAPABILITY_UNPROVEN_NOT_CONFIGURED"
    status: "AVAILABLE" | "PARTIAL" | "UNPROVEN" | "UNAVAILABLE"
    pollIntervalMinutes: number
    expectedDetectionLatency: string
    observedAt: string | null
    lastSuccessfulReadAt: string | null
    limitationCodes: readonly string[]
    bounded: true
    idempotent: true
    incrementalCursor: true
    overlapMinutes: 5
  }
  recentSales: {
    contractVersion: "RECENT_SALES_FEED_V1"
    status: CommercialMonitorCapabilityStatus
    resultCount: number | null
    entries: Array<{
      orderId: string
      orderLineItemIds: string[]
      itemIds: string[]
      listingTitle: string | null
      quantity: number | null
      orderTotal: number | null
      currency: string | null
      soldAt: string
      paymentState: string
      fulfillmentState: string
      attributionStatus: "PROVEN" | "PARTIAL" | "AMBIGUOUS" |
        "UNPROVEN" | "UNAVAILABLE"
      buyerMessageStatus: "SENT" | "SKIPPED" | "FAILED" | "BLOCKED" |
        "UNPROVEN" | "UNAVAILABLE"
      whatsappNotificationStatus: "QUEUED" | "ACCEPTED_BY_META" |
        "FAILED" | "DEFERRED" | "UNPROVEN" | "UNAVAILABLE"
      supplierStockStatus: "REFRESH_REQUEST_READY" |
        "SUPPLIER_RECHECK_PENDING_LINK" | "BLOCKED" | "UNPROVEN" |
        "UNAVAILABLE"
      evidenceReference: string
      buyerPiiIncluded: false
    }>
    maximumEntries: 10
    truncated: boolean
    limitationCodes: string[]
    source: "PERSISTED_OFFICIAL_EBAY_ORDER_EVENTS"
    buyerPiiIncluded: false
  }
  saleAlerts: SellerOsSaleAlertsReadV1
  monitorCoverage: {
    contractVersion: "MONITOR_COVERAGE_TRANSPARENCY_V1"
    status: "AVAILABLE" | "PARTIAL" | "UNPROVEN"
    currentLiveScopeId: string
    currentLiveScopeType: "CURRENT_LIVE_COHORT_SCOPE"
    currentLiveScopeCount: number | null
    currentLiveObservedAt: string | null
    monitoredItemIds: readonly string[]
    visiblePriorityItemIds: readonly string[]
    visiblePriorityRowCount: number
    monitoredOutsideVisibleCount: number | null
    visibleRowsEqualMonitoredScope: boolean | null
    visibleRowsArePresentationSubset: true
    notVisibleDoesNotMeanNotMonitored: true
  }
  listingQualityReport: {
    status: CommercialMonitorCapabilityStatus
    source: "EBAY_LISTING_QUALITY_REPORT"
    persistenceStatus: "IN_MEMORY_READ_ONLY" | "NEW_DDL_REQUIRED"
    limitationCode: string | null
    recommendations: EbayListingQualityRecommendation[]
  }
  decisions: CommercialListingDecisionV1[]
  guidanceVsSellerOs: EbayGuidanceComparisonV1[]
  operationalHealth: {
    manualReview: OperationalReviewBurdenV2
    needIntervention: { status: CommercialMonitorCapabilityStatus; count: number | null }
    runningExperiments: { status: CommercialMonitorCapabilityStatus; count: number | null }
    doNotTouch: { status: CommercialMonitorCapabilityStatus; count: number | null }
    readyToEvaluate: { status: CommercialMonitorCapabilityStatus; count: number | null }
    externalSignalReview: { status: CommercialMonitorCapabilityStatus; count: number | null }
    stockRisk: { status: CommercialMonitorCapabilityStatus; count: number | null }
    stockUnknown: { status: CommercialMonitorCapabilityStatus; count: number | null }
    dataQuality: { status: CommercialMonitorCapabilityStatus; count: number | null }
    ebayRecommendations: { status: CommercialMonitorCapabilityStatus; count: number | null }
    waitingHealthy: { status: CommercialMonitorCapabilityStatus; count: number | null }
    criticalAlerts: { status: CommercialMonitorCapabilityStatus; count: number | null }
    priorityActionPlan: Array<{
      listingKey: string
      classification: CommercialDecisionClass
      priority: CommercialListingDecisionV1["priority"]
      recommendedAction: CommercialDecisionAction
    }>
    upcomingReviews: Array<{
      listingKey: string
      condition: string
      reviewAt: string | null
    }>
    performanceSeries: {
      status: "AVAILABLE" | "PARTIAL" | "MISSING"
      points: CanonicalCommercialTimeSeriesPointV1[]
      limitationCode: string | null
    }
    statusDistribution: Array<{ classification: CommercialDecisionClass; count: number }>
    categoryBenchmarks: Array<{
      recommendationCategory: string
      benchmark: number
      source: "EBAY_LISTING_QUALITY_REPORT"
    }>
  }
  safety: {
    marketplaceWrites: 0
    registryWrites: 0
    fulfillmentWrites: 0
    buyerMessages: 0
    guidanceAutoExecution: false
    decisionExecution: false
    syntheticChartData: false
  }
}

export type CommercialMonitorGetDto = {
  contractVersion: typeof COMMERCIAL_MONITOR_READONLY_CONTRACT_VERSION
  operation: typeof COMMERCIAL_MONITOR_ASSISTANT_OPERATION
  mode: "READ_ONLY"
  generatedAt: string
  marketplace: MarketplaceContext
  connection: {
    status: ObservationAvailability
    readers: SourceReaderStatus[]
  }
  liveCertification: EbayLiveCertificationReadModel
  discoveryCoverage: DiscoveryCoverage
  listings: CommercialListingReadModel[]
  alertCandidates: AlertCandidate[]
  accountDataQualityIssues: DataQualityIssue[]
  learning: CommercialLearningReadModel
  timeline: TimelineEntry[]
  backend: CommercialMonitorBackendV1
  productCaseOperatingState: {
    status: "PAUSED_FOR_MONITORING_MILESTONE"
    reset: false
    resumePolicy: "RESUME_FROM_LAST_VERIFIED_GATE"
    manualGoldenPath: "PRESERVE"
  }
  capabilities: {
    canPublishAutomatically: false
    canReviseInventoryAutomatically: false
    canPauseListingAutomatically: false
    canReactivateListingAutomatically: false
    ebayBuyerMessageAutoSend: false
    ebayTrackingWriteEnabled: false
    whatsappSaleAlertEnabled: false
    postSaleShadowMode: true
  }
  safety: {
    marketplaceWritesAllowed: false
    dispatchAllowed: false
    whatsappCalled: false
    buyerMessagesAllowed: false
    sanitized: true
    containsSecrets: false
    containsTokens: false
    containsAuthorizationHeaders: false
    containsCookies: false
    buyerPiiIncluded: false
  }
}

const SENSITIVE_KEY = /^(?:authorization|proxy[_-]?authorization|cookie|cookies|set[_-]?cookie|password|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|client[_-]?secret|service[_-]?role(?:[_-]?key)?|supabase[_-]?key)$/i
const SENSITIVE_VALUE = /(?:bearer\s+[^\s]+|authorization\s*[:=]|set-cookie\s*[:=]|cookie\s*[:=]|access[_-]?token\s*[:=]|refresh[_-]?token\s*[:=]|api[_-]?key\s*[:=]|client[_-]?secret\s*[:=]|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b)/i
const DECLARED_NEGATIVE_SAFETY_KEYS = new Set([
  "containsSecrets",
  "containsTokens",
  "containsAuthorizationHeaders",
  "containsCookies",
  "buyerPiiIncluded",
])
const DECLARED_POSITIVE_SAFETY_KEYS = new Set(["sanitized"])

export function containsSensitiveAssistantMaterial(value: unknown): boolean {
  if (typeof value === "string") return SENSITIVE_VALUE.test(value)
  if (Array.isArray(value)) return value.some(containsSensitiveAssistantMaterial)
  if (!value || typeof value !== "object") return false
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => {
    if (DECLARED_NEGATIVE_SAFETY_KEYS.has(key)) return nested !== false
    if (DECLARED_POSITIVE_SAFETY_KEYS.has(key)) return nested !== true
    return SENSITIVE_KEY.test(key) || containsSensitiveAssistantMaterial(nested)
  })
}

export function assertCommercialMonitorAssistantDtoSafe(
  value: CommercialMonitorGetDto,
) {
  if (containsPrivateBuyerData(value) || containsSensitiveAssistantMaterial(value)) {
    throw new Error("COMMERCIAL_MONITOR_ASSISTANT_DTO_SANITIZATION_FAILED")
  }
  return value
}

export function sanitizeMonitorText(value: unknown, maximum = 240) {
  if (typeof value !== "string") return null
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/Bearer\s+[^\s"'<]+/gi, "[REDACTED]")
    .replace(/(?:access[_-]?token|refresh[_-]?token|authorization|cookie|password|client[_-]?secret)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
  return sanitized ? sanitized.slice(0, maximum) : null
}
