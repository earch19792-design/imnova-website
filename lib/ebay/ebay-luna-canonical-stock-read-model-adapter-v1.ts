import { createHash } from "node:crypto"

import {
  createObservation,
  unavailableObservation,
  type CompositionReadModel,
  type EvidenceFreshness,
  type EvidenceReference,
  type ListingEvidenceIdentity,
  type MarketplaceContext,
  type StockReadModel,
} from
// @ts-expect-error Node's direct TypeScript test runner requires the extension.
  "./commercial-monitor-readonly-contract.ts"

export const SELLER_OS_LUNA_CANONICAL_STOCK_READ_SOURCE_V1 =
  "LUNA_PORTEX_PUBLIC_EXACT_PRODUCT_STOCK" as const

export type ReadonlyLunaLinkageDecisionRowV1 = Readonly<{
  decision_id: string
  decision_version: number | string
  decision: string
  decision_at: string
  ebay_item_id: string
  ebay_sku: string | null
  linkage_id: string
  components: unknown
  evidence_digest: string
  evidence_references: unknown
}>

export type ReadonlyLunaStockJobRowV1 = Readonly<{
  stock_check_job_id: string
  linkage_id: string
  ebay_item_id: string
  observation_window_start: string
  observation_window_end: string
  workflow_state: string
  attempt_count: number | string
  success_receipt_digest: string | null
}>

export type ReadonlyLunaStockObservationRowV1 = Readonly<{
  observation_id: string
  stock_check_job_id: string
  linkage_id: string
  ebay_item_id: string
  component_identity_id: string
  luna_product_id: string
  luna_variant_id: string | null
  luna_sku: string
  supplier_quantity_required: number | string
  observation_state: string
  source_status: string
  observed_availability: boolean | null
  observed_supplier_quantity: number | string | null
  evidence_class: string
  evidence_digest: string
  acquisition_method: string
  attempt_number: number | string
  observed_at: string
  maximum_age_seconds: number | string
  limitations: unknown
}>

type SourceRows<T> = Readonly<{
  status: "AVAILABLE" | "PARTIAL" | "ERROR"
  rows: readonly T[]
}>

type Component = Readonly<{
  componentIdentityId: string
  productId: string
  variantId: string | null
  sku: string
  quantityRequired: number
}>

type Projection = Readonly<{
  applied: boolean
  supplierLinkageStatus: "CERTIFIED" | "UNPROVEN"
  composition: CompositionReadModel | null
  stock: StockReadModel | null
  limitationCode: string | null
}>

const LINKAGE_ID = /^luna-linkage-v1:sha256:[0-9a-f]{64}$/
const COMPONENT_ID = /^luna-component-identity-v1:sha256:[0-9a-f]{64}$/
const DIGEST = /^luna-stock-evidence-v1:sha256:[0-9a-f]{64}$/

function stableIdentity(prefix: string, parts: readonly unknown[]) {
  return `${prefix}:sha256:${createHash("sha256")
    .update(JSON.stringify(parts)).digest("hex")}`
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function text(value: unknown, maximum = 240) {
  return typeof value === "string" && value.length > 0 &&
      value.length <= maximum ? value : null
}

function integer(value: unknown, minimum = 0, maximum = 1_000_000) {
  const numeric = typeof value === "number" ? value
    : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(numeric) && numeric >= minimum &&
      numeric <= maximum ? numeric : null
}

function iso(value: unknown) {
  const candidate = text(value, 50)
  return candidate && Number.isFinite(Date.parse(candidate))
    ? new Date(candidate).toISOString() : null
}

function bool(value: unknown) {
  return value === true
}

function codes(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string =>
      typeof entry === "string" && /^[A-Z0-9_]{1,80}$/.test(entry))
    : []
}

function componentRows(value: unknown): Component[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return []
  const components = value.flatMap((raw) => {
    const row = record(raw)
    const productId = text(row.lunaProductId ?? row.luna_product_id, 100)
    const variantId = text(row.lunaVariantId ?? row.luna_variant_id, 100)
    const sku = text(row.lunaSku ?? row.luna_sku, 120)
    const storedComponentIdentityId = text(
      row.componentIdentityId ?? row.component_identity_id,
      160,
    )
    const quantityRequired = integer(
      row.supplierQuantityRequired ?? row.supplier_quantity_required,
      1,
      10_000,
    )
    const exact = bool(row.exactProductIdentity ?? row.exact_product_identity) &&
      bool(row.exactVariantIdentity ?? row.exact_variant_identity) &&
      bool(row.exactSupplierSku ?? row.exact_supplier_sku) &&
      bool(row.structuredVariantAttributesComplete ??
        row.structured_variant_attributes_complete) &&
      (row.identityConflict ?? row.identity_conflict) !== true
    if (!productId || !variantId || !sku || !quantityRequired || !exact) {
      return []
    }
    const componentIdentityId = storedComponentIdentityId ?? stableIdentity(
      "luna-component-identity-v1",
      [productId, variantId, sku],
    )
    if (!COMPONENT_ID.test(componentIdentityId)) return []
    return [{ componentIdentityId, productId, variantId, sku,
      quantityRequired }]
  })
  const identities = new Set(components.map((component) =>
    component.componentIdentityId))
  return components.length === value.length && identities.size === value.length
    ? components : []
}

function evidenceReference(
  reference: string,
  source: string,
  capturedAt: string | null,
): EvidenceReference {
  return { reference, source, capturedAt }
}

function source(input: {
  operation: string
  evidenceReference: string | null
}) {
  return {
    system: SELLER_OS_LUNA_CANONICAL_STOCK_READ_SOURCE_V1,
    operation: input.operation,
    evidenceReference: input.evidenceReference,
  }
}

function unknownProjection(input: {
  limitationCode: string
  supplierLinkageStatus?: "CERTIFIED" | "UNPROVEN"
  composition?: CompositionReadModel | null
  marketplace: MarketplaceContext
  identity: ListingEvidenceIdentity
  components?: readonly Component[]
  evidenceReferences?: EvidenceReference[]
  freshness?: EvidenceFreshness
}): Projection {
  if (input.supplierLinkageStatus !== "CERTIFIED") {
    return {
      applied: false,
      supplierLinkageStatus: "UNPROVEN",
      composition: null,
      stock: null,
      limitationCode: input.limitationCode,
    }
  }
  const evidenceReferences = input.evidenceReferences ?? []
  const observationSource = source({
    operation: "CERTIFIED_COMPONENT_STOCK_OBSERVATION_LOOKUP",
    evidenceReference: evidenceReferences[0]?.reference ?? null,
  })
  return {
    applied: true,
    supplierLinkageStatus: "CERTIFIED",
    composition: input.composition ?? null,
    stock: {
      state: "STOCK_UNKNOWN",
      sourceContractStatus: "UNPROVEN",
      supplierLinkageStatus: "CERTIFIED",
      supplierProductId: input.components?.length === 1
        ? input.components[0].productId : null,
      supplierVariantId: input.components?.length === 1
        ? input.components[0].variantId : null,
      supplierSku: input.components?.length === 1
        ? input.components[0].sku : null,
      available: null,
      quantity: unavailableObservation<number>({
        availability: "UNKNOWN",
        source: observationSource,
        marketplace: input.marketplace,
        identity: input.identity,
        grain: "COMPONENT",
        unit: "UNIT",
        freshness: input.freshness,
        limitationCode: input.limitationCode,
      }),
      currentSupplierCost: unavailableObservation<number>({
        availability: "UNKNOWN",
        source: observationSource,
        marketplace: input.marketplace,
        identity: input.identity,
        grain: "COMPONENT",
        freshness: input.freshness,
        limitationCode: "SUPPLIER_COST_NOT_PROJECTED_BY_STOCK_ADAPTER",
      }),
      freshness: input.freshness ?? {
        status: "UNKNOWN",
        ageSeconds: null,
        maximumAgeSeconds: null,
      },
      evidenceReferences,
      limitationCode: input.limitationCode,
    },
    limitationCode: input.limitationCode,
  }
}

function composition(input: {
  components: readonly Component[]
  capacity: number | null
  limitationCode: string | null
  marketplace: MarketplaceContext
  identity: ListingEvidenceIdentity
  capturedAt: string | null
  freshness: EvidenceFreshness
  evidenceReferences: EvidenceReference[]
  limitingComponentId: string | null
}) : CompositionReadModel {
  const firstReference = input.evidenceReferences[0]?.reference ?? null
  const observationSource = source({
    operation: "BUNDLE_SAFE_CAPACITY_FROM_CERTIFIED_COMPONENTS",
    evidenceReference: firstReference,
  })
  return {
    status: "AVAILABLE",
    listingType: input.components.length === 1 ? "INDIVIDUAL" : "BUNDLE",
    components: input.components.map((component) => ({
      componentId: component.componentIdentityId,
      supplierSku: component.sku,
      quantityRequired: component.quantityRequired,
      evidenceReferences: input.evidenceReferences,
    })),
    limitingComponentId: input.limitingComponentId,
    sharedAllocationKnown: true,
    bundleCapacity: input.capacity === null
      ? unavailableObservation<number>({
          availability: "UNKNOWN",
          source: observationSource,
          capturedAt: input.capturedAt,
          marketplace: input.marketplace,
          identity: input.identity,
          grain: "LISTING_COMPONENT",
          unit: "LISTING_UNIT",
          freshness: input.freshness,
          limitationCode: input.limitationCode ??
            "CERTIFIED_COMPONENT_CAPACITY_UNPROVEN",
        })
      : createObservation<number>({
          value: input.capacity,
          availability: "AVAILABLE",
          completeness: "COMPLETE",
          source: observationSource,
          capturedAt: input.capturedAt,
          marketplace: input.marketplace,
          identity: input.identity,
          grain: "LISTING_COMPONENT",
          unit: "LISTING_UNIT",
          reportingWindow: null,
          freshness: input.freshness,
          limitationCode: null,
          explicitAuthoritativeZero: input.capacity === 0,
        }),
    limitationCode: input.limitationCode,
  }
}

export function projectSellerOsCanonicalLunaStockReadModelV1(input: Readonly<{
  itemId: string
  marketplace: MarketplaceContext
  identity: ListingEvidenceIdentity
  now: Date
  decisions: SourceRows<ReadonlyLunaLinkageDecisionRowV1>
  jobs: SourceRows<ReadonlyLunaStockJobRowV1>
  observations: SourceRows<ReadonlyLunaStockObservationRowV1>
}>): Projection {
  if (input.decisions.status === "ERROR") {
    return unknownProjection({
      limitationCode: "CERTIFIED_LUNA_LINKAGE_READ_UNAVAILABLE",
      marketplace: input.marketplace,
      identity: input.identity,
    })
  }
  const decisions = input.decisions.rows.filter((row) =>
    row.ebay_item_id === input.itemId).sort((left, right) => {
      const rightVersion = integer(right.decision_version, 1)
      const leftVersion = integer(left.decision_version, 1)
      return (rightVersion === null ? -1 : rightVersion) -
        (leftVersion === null ? -1 : leftVersion)
    })
  const decision = decisions[0]
  if (!decision || decision.decision !== "APPROVE_EXACT_LINKAGE" ||
      !LINKAGE_ID.test(decision.linkage_id)) {
    return unknownProjection({
      limitationCode: "LUNA_HUMAN_APPROVED_LINK_REQUIRED",
      marketplace: input.marketplace,
      identity: input.identity,
    })
  }
  const components = componentRows(decision.components)
  if (!components.length) {
    return unknownProjection({
      limitationCode: "CERTIFIED_LUNA_COMPOSITION_INCOMPLETE",
      marketplace: input.marketplace,
      identity: input.identity,
    })
  }
  const decisionAt = iso(decision.decision_at)
  const decisionReference = `LUNA_LINKAGE_DECISION:${decision.decision_id}`
  const decisionEvidence = evidenceReference(
    decisionReference,
    "SELLER_OS_LUNA_LINKAGE_DECISIONS_V1",
    decisionAt,
  )
  const preliminaryFreshness: EvidenceFreshness = {
    status: "UNKNOWN",
    ageSeconds: null,
    maximumAgeSeconds: null,
  }
  const preliminaryComposition = composition({
    components,
    capacity: null,
    limitationCode: "CERTIFIED_COMPONENT_STOCK_NOT_AVAILABLE",
    marketplace: input.marketplace,
    identity: input.identity,
    capturedAt: decisionAt,
    freshness: preliminaryFreshness,
    evidenceReferences: [decisionEvidence],
    limitingComponentId: null,
  })
  if (input.jobs.status !== "AVAILABLE" ||
      input.observations.status !== "AVAILABLE") {
    return unknownProjection({
      limitationCode: "CERTIFIED_COMPONENT_STOCK_READ_UNAVAILABLE",
      supplierLinkageStatus: "CERTIFIED",
      composition: preliminaryComposition,
      marketplace: input.marketplace,
      identity: input.identity,
      components,
      evidenceReferences: [decisionEvidence],
      freshness: preliminaryFreshness,
    })
  }
  const jobs = input.jobs.rows.filter((row) =>
    row.ebay_item_id === input.itemId &&
    row.linkage_id === decision.linkage_id &&
    row.workflow_state === "SUCCEEDED" &&
    Boolean(text(row.success_receipt_digest, 120)) &&
    iso(row.observation_window_end)).sort((left, right) =>
      Date.parse(right.observation_window_end) -
      Date.parse(left.observation_window_end))
  const job = jobs[0]
  if (!job) {
    return unknownProjection({
      limitationCode: "CERTIFIED_COMPONENT_STOCK_NOT_AVAILABLE",
      supplierLinkageStatus: "CERTIFIED",
      composition: preliminaryComposition,
      marketplace: input.marketplace,
      identity: input.identity,
      components,
      evidenceReferences: [decisionEvidence],
      freshness: preliminaryFreshness,
    })
  }
  const attemptNumber = integer(job.attempt_count, 1, 100)
  const matching = input.observations.rows.filter((row) =>
    row.stock_check_job_id === job.stock_check_job_id &&
    row.linkage_id === decision.linkage_id &&
    row.ebay_item_id === input.itemId &&
    integer(row.attempt_number, 1, 100) === attemptNumber)
  const selected = components.map((component) => {
    const canonicalIdentityMatches = matching.filter((row) =>
      row.component_identity_id === component.componentIdentityId)
    if (canonicalIdentityMatches.length) return canonicalIdentityMatches
    // Historical observers can carry an earlier component hash while still
    // preserving the complete certified tuple. Reconcile only an exact,
    // unique tuple; zero or multiple matches remain fail-closed.
    return matching.filter((row) =>
      row.luna_product_id === component.productId &&
      row.luna_variant_id === component.variantId &&
      row.luna_sku === component.sku &&
      integer(row.supplier_quantity_required, 1, 10_000) ===
        component.quantityRequired)
  })
  if (!attemptNumber || selected.some((rows) => rows.length !== 1)) {
    return unknownProjection({
      limitationCode: "CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH",
      supplierLinkageStatus: "CERTIFIED",
      composition: preliminaryComposition,
      marketplace: input.marketplace,
      identity: input.identity,
      components,
      evidenceReferences: [decisionEvidence],
      freshness: preliminaryFreshness,
    })
  }
  const rows = selected.map((values) => values[0])
  const identitiesMatch = rows.every((row, index) => {
    const component = components[index]
    return row.luna_product_id === component.productId &&
      row.luna_variant_id === component.variantId &&
      row.luna_sku === component.sku &&
      integer(row.supplier_quantity_required, 1, 10_000) ===
        component.quantityRequired &&
      DIGEST.test(row.evidence_digest)
  })
  if (!identitiesMatch) {
    return unknownProjection({
      limitationCode: "CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH",
      supplierLinkageStatus: "CERTIFIED",
      composition: preliminaryComposition,
      marketplace: input.marketplace,
      identity: input.identity,
      components,
      evidenceReferences: [decisionEvidence],
      freshness: preliminaryFreshness,
    })
  }
  const approvedSourceLineage = rows.every((row) =>
    codes(row.limitations).includes(
      SELLER_OS_LUNA_CANONICAL_STOCK_READ_SOURCE_V1))
  if (!approvedSourceLineage) {
    return unknownProjection({
      limitationCode: "CERTIFIED_COMPONENT_STOCK_SOURCE_UNAPPROVED",
      supplierLinkageStatus: "CERTIFIED",
      composition: preliminaryComposition,
      marketplace: input.marketplace,
      identity: input.identity,
      components,
      evidenceReferences: [decisionEvidence],
      freshness: preliminaryFreshness,
    })
  }
  if (rows.some((row) => row.source_status !== "AVAILABLE")) {
    return unknownProjection({
      limitationCode: "CERTIFIED_COMPONENT_STOCK_SOURCE_UNAVAILABLE",
      supplierLinkageStatus: "CERTIFIED",
      composition: preliminaryComposition,
      marketplace: input.marketplace,
      identity: input.identity,
      components,
      evidenceReferences: [decisionEvidence],
      freshness: preliminaryFreshness,
    })
  }
  const observedAt = rows.map((row) => iso(row.observed_at))
  const maximumAges = rows.map((row) =>
    integer(row.maximum_age_seconds, 60, 604_800))
  if (observedAt.some((value) => !value) ||
      maximumAges.some((value) => !value)) {
    return unknownProjection({
      limitationCode: "CERTIFIED_COMPONENT_STOCK_EVIDENCE_MALFORMED",
      supplierLinkageStatus: "CERTIFIED",
      composition: preliminaryComposition,
      marketplace: input.marketplace,
      identity: input.identity,
      components,
      evidenceReferences: [decisionEvidence],
      freshness: preliminaryFreshness,
    })
  }
  const ages = observedAt.map((value) =>
    Math.floor((input.now.getTime() - Date.parse(value as string)) / 1_000))
  const stale = ages.some((age, index) => age < -300 ||
    age > (maximumAges[index] as number))
  const aggregateFreshness: EvidenceFreshness = {
    status: stale ? "STALE" : "FRESH",
    ageSeconds: stale && ages.some((age) => age < -300)
      ? null : Math.max(0, ...ages),
    maximumAgeSeconds: Math.min(...maximumAges.map(Number)),
  }
  const stockEvidence = rows.map((row) => evidenceReference(
    `LUNA_STOCK_OBSERVATION:${row.observation_id}`,
    SELLER_OS_LUNA_CANONICAL_STOCK_READ_SOURCE_V1,
    iso(row.observed_at),
  ))
  const allEvidence = [decisionEvidence, ...stockEvidence]
  if (stale) {
    const staleComposition = composition({
      components,
      capacity: null,
      limitationCode: "CERTIFIED_COMPONENT_STOCK_STALE",
      marketplace: input.marketplace,
      identity: input.identity,
      capturedAt: observedAt.sort()[0] as string,
      freshness: aggregateFreshness,
      evidenceReferences: allEvidence,
      limitingComponentId: null,
    })
    return unknownProjection({
      limitationCode: "CERTIFIED_COMPONENT_STOCK_STALE",
      supplierLinkageStatus: "CERTIFIED",
      composition: staleComposition,
      marketplace: input.marketplace,
      identity: input.identity,
      components,
      evidenceReferences: allEvidence,
      freshness: aggregateFreshness,
    })
  }
  const certifiedOos = rows.filter((row) =>
    row.observation_state === "OBSERVED_OUT_OF_STOCK" &&
    row.observed_availability === false &&
    codes(row.limitations).includes("PUBLIC_EXACT_CERTIFIED_OOS"))
  const invalidState = rows.some((row) => ![
    "OBSERVED_OUT_OF_STOCK",
    "OBSERVED_IN_STOCK",
    "OBSERVED_QUANTITY",
  ].includes(row.observation_state) ||
    (row.observation_state === "OBSERVED_OUT_OF_STOCK" &&
      !codes(row.limitations).includes("PUBLIC_EXACT_CERTIFIED_OOS")))
  if (invalidState) {
    const unknownComposition = composition({
      components,
      capacity: null,
      limitationCode: "CERTIFIED_COMPONENT_STOCK_UNPROVEN",
      marketplace: input.marketplace,
      identity: input.identity,
      capturedAt: observedAt.sort()[0] as string,
      freshness: aggregateFreshness,
      evidenceReferences: allEvidence,
      limitingComponentId: null,
    })
    return unknownProjection({
      limitationCode: "CERTIFIED_COMPONENT_STOCK_UNPROVEN",
      supplierLinkageStatus: "CERTIFIED",
      composition: unknownComposition,
      marketplace: input.marketplace,
      identity: input.identity,
      components,
      evidenceReferences: allEvidence,
      freshness: aggregateFreshness,
    })
  }
  const numericCapacities = rows.map((row, index) => {
    const quantity = integer(row.observed_supplier_quantity, 0)
    return quantity === null ? null
      : Math.floor(quantity / components[index].quantityRequired)
  })
  const capacity = certifiedOos.length ? 0
    : numericCapacities.every((value) => value !== null)
      ? Math.min(...numericCapacities.map(Number)) : null
  const limitingComponentId = certifiedOos[0]?.component_identity_id ??
    (capacity === null ? null : components[numericCapacities.indexOf(capacity)]
      ?.componentIdentityId ?? null)
  const listingComposition = composition({
    components,
    capacity,
    limitationCode: capacity === null
      ? "CERTIFIED_COMPONENT_NUMERIC_CAPACITY_UNPROVEN" : null,
    marketplace: input.marketplace,
    identity: input.identity,
    capturedAt: observedAt.sort()[0] as string,
    freshness: aggregateFreshness,
    evidenceReferences: allEvidence,
    limitingComponentId,
  })
  const firstReference = stockEvidence[0]?.reference ?? null
  const observationSource = source({
    operation: "FRESH_CERTIFIED_COMPONENT_STOCK_OBSERVATIONS",
    evidenceReference: firstReference,
  })
  const stockState = certifiedOos.length ? "CERTIFIED_OOS" as const
    : "IN_STOCK_SIGNAL" as const
  return {
    applied: true,
    supplierLinkageStatus: "CERTIFIED",
    composition: listingComposition,
    stock: {
      state: stockState,
      sourceContractStatus: "HEALTHY",
      supplierLinkageStatus: "CERTIFIED",
      supplierProductId: components.length === 1 ? components[0].productId : null,
      supplierVariantId: components.length === 1 ? components[0].variantId : null,
      supplierSku: components.length === 1 ? components[0].sku : null,
      available: certifiedOos.length ? false : true,
      quantity: unavailableObservation<number>({
        availability: "UNKNOWN",
        source: observationSource,
        capturedAt: observedAt.sort()[0] as string,
        marketplace: input.marketplace,
        identity: input.identity,
        grain: "COMPONENT",
        unit: "UNIT",
        freshness: aggregateFreshness,
        limitationCode: "LISTING_LEVEL_QUANTITY_NOT_FLATTENED_FROM_COMPONENTS",
      }),
      currentSupplierCost: unavailableObservation<number>({
        availability: "UNKNOWN",
        source: observationSource,
        capturedAt: observedAt.sort()[0] as string,
        marketplace: input.marketplace,
        identity: input.identity,
        grain: "COMPONENT",
        freshness: aggregateFreshness,
        limitationCode: "SUPPLIER_COST_NOT_PROJECTED_BY_STOCK_ADAPTER",
      }),
      freshness: aggregateFreshness,
      evidenceReferences: allEvidence,
      limitationCode: null,
    },
    limitationCode: null,
  }
}
