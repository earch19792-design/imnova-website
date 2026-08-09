import {
  containsPrivateBuyerData,
  selectExactReadonlySupply,
  stableReadonlyCommercialKey,
} from "./commercial-monitor-readonly-utilities.mjs"

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
      lifecycleState: string
      testedVariable: string
      t0: string
      postChangeT0: string | null
      frozenVariables: string[]
      checkpointGate: string | null
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
      lifecycleState: string
      testedVariable: string
      t0: string
      postChangeT0?: string | null
      frozenVariables: string[]
      checkpointGate?: string | null
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
    lifecycleState: lookup.lifecycleState,
    testedVariable: lookup.testedVariable,
    t0: lookup.t0,
    postChangeT0: lookup.postChangeT0 ?? null,
    frozenVariables: [...lookup.frozenVariables],
    checkpointGate: lookup.checkpointGate ?? null,
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
    return unknownQuantity("SUPPLIER_IDENTITY_INCOMPLETE", "STOCK_UNKNOWN")
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
    ...(input.reconciliation
      ? { reconciliation: { ...input.reconciliation } }
      : {}),
  }
}

export type ListingDiscovery = {
  registryStatus: "REGISTERED" | "UNREGISTERED_DISCOVERY"
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
  listingState: string
  listingType: ListingOfferType
  listingFormat: string | null
  startTime: string | null
  gtin: string | null
  brand: string | null
  mpn: string | null
  listedQuantity: number | null
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
