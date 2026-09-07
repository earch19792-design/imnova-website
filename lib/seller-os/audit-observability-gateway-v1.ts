import type { SupabaseClient } from "@supabase/supabase-js"

export const SELLER_OS_AUDIT_OBSERVABILITY_GATEWAY_V1 =
  "SELLER_OS_AUDIT_OBSERVABILITY_GATEWAY_V1" as const
export const SELLER_OS_PRODUCT_CASE_AUDIT_V1 =
  "SELLER_OS_PRODUCT_CASE_AUDIT_V1" as const
export const SELLER_OS_PUBLICATION_EXECUTION_AUDIT_V1 =
  "SELLER_OS_PUBLICATION_EXECUTION_AUDIT_V1" as const

export const SELLER_OS_AUDIT_OBSERVABILITY_TOOLS_V1 = Object.freeze([
  Object.freeze({
    name: "seller_os_get_product_case",
    title: "Get Seller OS product case",
    description: "Resolve one bounded product identity and return its existing end-to-end evidence, provenance, freshness, unknowns and next revenue blocker. Read-only; never synthesizes product truth.",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
    annotations: { readOnlyHint: true, destructiveHint: false,
      openWorldHint: false, idempotentHint: true },
    securitySchemes: [{ type: "oauth2" as const,
      scopes: ["seller_os.read"] }], sideEffects: false as const,
  }),
  Object.freeze({
    name: "seller_os_get_publication_execution",
    title: "Get Seller OS publication execution",
    description: "Return one bounded read-only Publisher flight recorder from existing package, authorization, execution, Offer and official-readback receipts. Historical ambiguity remains unproven.",
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
    annotations: { readOnlyHint: true, destructiveHint: false,
      openWorldHint: false, idempotentHint: true },
    securitySchemes: [{ type: "oauth2" as const,
      scopes: ["seller_os.read"] }], sideEffects: false as const,
  }),
])

export type SellerOsAuditDetailModeV1 = "SUMMARY" | "EVIDENCE" | "TRACE"
export type SellerOsAuditEvidenceStatusV1 = "PROVEN" | "UNPROVEN" |
  "STALE" | "UNAVAILABLE" | "MISSING" | "CONTRADICTED" |
  "NOT_APPLICABLE"
export type SellerOsProductCaseIdentityTypeV1 = "PRODUCT_CASE_ID" |
  "LUNA_PRODUCT_ID" | "SUPPLIER_SKU" | "EBAY_ITEM_ID" |
  "LISTING_PACKAGE_ID"

type Row = Record<string, unknown>
type ReadResult = Readonly<{ data: unknown; error: unknown }>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const JOURNEY_STAGES = Object.freeze([
  "LUNA_SOURCE", "PRODUCT_TRUTH", "MARKET_RESEARCH", "RADAR", "PRICING",
  "ECONOMICS", "EBAY_IDENTITY", "CATEGORY", "ASPECTS", "LISTING_PACKAGE",
  "OWNER_AUTHORIZATION", "PUBLISHER", "OFFICIAL_EBAY_READBACK",
  "CURRENT_LIVE", "STOCK", "ANALYTICS", "ORDERS", "MAYEL",
])

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row : {}
}
function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(record) : []
}
function text(value: unknown, max = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().slice(0, max) : null
}
function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function dateValue(value: unknown) {
  const parsed = text(value, 80)
  return parsed && Number.isFinite(Date.parse(parsed))
    ? new Date(parsed).toISOString() : null
}
function first(...values: unknown[]) {
  return values.find((value) => value !== null && value !== undefined &&
    value !== "") ?? null
}
function assertRead(code: string, result: ReadResult) {
  if (result.error) throw new Error(`AUDIT_GATEWAY_${code}_READ_FAILED`)
}
function distinct(values: readonly (string | null)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}
function latest(values: readonly Row[]) {
  return [...values].sort((a, b) => Date.parse(String(first(b.updated_at,
    b.created_at, b.observed_at) ?? "")) - Date.parse(String(first(a.updated_at,
    a.created_at, a.observed_at) ?? "")))[0] ?? null
}
function freshness(observedAt: string | null, freshUntil: string | null,
  now: Date) {
  if (!observedAt) return "UNKNOWN" as const
  if (freshUntil && Date.parse(freshUntil) <= now.getTime()) return "STALE" as const
  return "CURRENT" as const
}
function phaseStatus(value: unknown): SellerOsAuditEvidenceStatusV1 {
  if (value === "COMPROBADO") return "PROVEN"
  if (value === "TIENE_UN_FALLO") return "CONTRADICTED"
  if (value === "FALTA_COMPROBAR") return "UNPROVEN"
  if (value === "EN_PROCESO" || value === "PENDIENTE") return "MISSING"
  return "UNPROVEN"
}
function cleanDetailMode(value: unknown): SellerOsAuditDetailModeV1 {
  return value === "EVIDENCE" || value === "TRACE" ? value : "SUMMARY"
}
function field(input: Readonly<{ field: string; value: unknown;
  source: string; authority: string; observedAt?: unknown; freshUntil?: unknown;
  evidenceId?: unknown; consumers: readonly string[];
  status?: SellerOsAuditEvidenceStatusV1; contradiction?: string | null }>,
  now: Date) {
  const observedAt = dateValue(input.observedAt)
  const freshUntil = dateValue(input.freshUntil)
  const hasValue = input.value !== null && input.value !== undefined &&
    input.value !== ""
  const temporal = freshness(observedAt, freshUntil, now)
  const status = input.status ?? (!hasValue ? "MISSING" :
    temporal === "STALE" ? "STALE" : "PROVEN")
  return Object.freeze({ FIELD: input.field, VALUE: hasValue ? input.value : null,
    EVIDENCE_STATUS: status, SOURCE: input.source,
    SOURCE_AUTHORITY: input.authority, CAPTURED_AT: observedAt,
    OBSERVED_AT: observedAt, FRESH_UNTIL: freshUntil, FRESHNESS: temporal,
    EVIDENCE_ID: text(input.evidenceId, 180),
    DOWNSTREAM_CONSUMERS: Object.freeze([...input.consumers]),
    CONTRADICTION: input.contradiction ?? null })
}

async function resolveProductIdentity(input: Readonly<{ supabase: SupabaseClient;
  accountKey: string; identityType: SellerOsProductCaseIdentityTypeV1;
  identity: string }>) {
  const identity = input.identity.normalize("NFKC").trim()
  if (!identity || identity.length > 220) throw new Error("AUDIT_IDENTITY_INVALID")
  let queueRows: Row[] = []
  let packageRow: Row = {}
  let activeRow: Row = {}
  let productCaseRow: Row = {}
  if (input.identityType === "PRODUCT_CASE_ID") {
    const read = await input.supabase.from("seller_os_prelinked_launch_candidates")
      .select("*").eq("product_case_id", identity).limit(2)
    assertRead("PRODUCT_CASE", read)
    const matches = rows(read.data)
    if (matches.length !== 1) return { contradiction: matches.length > 1
      ? "PRODUCT_CASE_ID_NOT_UNIQUE" : "PRODUCT_CASE_ID_NOT_FOUND" }
    productCaseRow = matches[0]
    const candidate = text(productCaseRow.opportunity_candidate_key, 100)
    if (candidate) {
      const queueRead = await input.supabase.from("ebay_luna_opportunity_queue")
        .select("*").eq("candidate_key", candidate).limit(2)
      assertRead("QUEUE", queueRead); queueRows = rows(queueRead.data)
    }
  } else if (input.identityType === "LUNA_PRODUCT_ID" ||
      input.identityType === "SUPPLIER_SKU") {
    const column = input.identityType === "LUNA_PRODUCT_ID"
      ? "supplier_product_id" : "supplier_sku"
    const read = await input.supabase.from("ebay_luna_opportunity_queue")
      .select("*").eq(column, identity).order("updated_at", { ascending: false })
      .limit(3)
    assertRead("QUEUE", read); queueRows = rows(read.data)
  } else if (input.identityType === "LISTING_PACKAGE_ID") {
    if (!UUID.test(identity)) throw new Error("AUDIT_PACKAGE_ID_INVALID")
    const read = await input.supabase.from("ebay_listing_packages").select("*")
      .eq("id", identity).eq("account_key", input.accountKey).limit(1)
      .maybeSingle()
    assertRead("PACKAGE", read); packageRow = record(read.data)
    const candidate = text(packageRow.candidate_key, 100)
    if (candidate) {
      const queueRead = await input.supabase.from("ebay_luna_opportunity_queue")
        .select("*").eq("candidate_key", candidate).limit(2)
      assertRead("QUEUE", queueRead); queueRows = rows(queueRead.data)
    }
  } else {
    if (!/^\d{9,19}$/.test(identity)) throw new Error("AUDIT_ITEM_ID_INVALID")
    const read = await input.supabase.from("ebay_active_listings").select("*")
      .eq("account_key", input.accountKey).eq("ebay_item_id", identity).limit(1)
      .maybeSingle()
    assertRead("ACTIVE_LISTING", read); activeRow = record(read.data)
    const variantId = text(activeRow.supplier_variant_id, 100)
    const supplierSku = text(activeRow.supplier_sku, 180)
    if (variantId || supplierSku) {
      let query = input.supabase.from("ebay_luna_opportunity_queue").select("*")
      query = variantId ? query.eq("supplier_variant_id", variantId)
        : query.eq("supplier_sku", supplierSku as string)
      const queueRead = await query.order("updated_at", { ascending: false }).limit(3)
      assertRead("QUEUE", queueRead); queueRows = rows(queueRead.data)
    }
  }
  const candidateIds = distinct(queueRows.map((row) => text(row.candidate_key, 100)))
  if (candidateIds.length !== 1) return { contradiction: candidateIds.length > 1
    ? "IDENTITY_RESOLUTION_AMBIGUOUS" : "CANONICAL_PRODUCT_IDENTITY_NOT_FOUND" }
  const queue = queueRows.find((row) => row.candidate_key === candidateIds[0]) ?? {}
  if (!Object.keys(packageRow).length) {
    const read = await input.supabase.from("ebay_listing_packages").select("*")
      .eq("account_key", input.accountKey).eq("candidate_key", candidateIds[0])
      .order("updated_at", { ascending: false }).limit(1).maybeSingle()
    assertRead("PACKAGE", read); packageRow = record(read.data)
  }
  if (!Object.keys(activeRow).length) {
    const sku = text(queue.supplier_sku, 180)
    if (sku) {
      const read = await input.supabase.from("ebay_active_listings").select("*")
        .eq("account_key", input.accountKey).eq("supplier_sku", sku)
        .order("last_ebay_sync_at", { ascending: false }).limit(1).maybeSingle()
      assertRead("ACTIVE_LISTING", read); activeRow = record(read.data)
    }
  }
  return { contradiction: null, queue, packageRow, activeRow, productCaseRow,
    candidateId: candidateIds[0] }
}

export async function readSellerOsProductCaseAuditV1(input: Readonly<{
  supabase: SupabaseClient; accountKey: string;
  identityType: SellerOsProductCaseIdentityTypeV1; identity: string;
  detailMode?: SellerOsAuditDetailModeV1; now?: Date }>) {
  const now = input.now ?? new Date()
  const mode = cleanDetailMode(input.detailMode)
  const resolved = await resolveProductIdentity(input)
  if (resolved.contradiction) return Object.freeze({
    AUDIT_CONTRACT_VERSION: SELLER_OS_PRODUCT_CASE_AUDIT_V1,
    OBSERVED_AT: now.toISOString(), DETAIL_MODE: mode,
    INPUT_IDENTITY: { type: input.identityType, value: input.identity },
    RESOLVED_CANONICAL_IDENTITY: null, STATUS: "CONTRADICTED",
    CONTRADICTION: resolved.contradiction,
    KNOWN: [], STALE: [], UNPROVEN: ["EXACT_PRODUCT_IDENTITY"],
    UNAVAILABLE: [], MISSING: [], CONTRADICTED: [resolved.contradiction],
    NEXT_BLOCKING_STAGE: "LUNA_SOURCE", BUSINESS_IMPACT: "REVENUE_BLOCKING",
    safety: { readOnly: true, arbitrarySql: false, arbitraryUrl: false,
      credentialsIncluded: false, buyerPiiIncluded: false,
      databaseBusinessWrites: 0, marketplaceWrites: 0 },
  })
  const queue = resolved.queue ?? {}
  const packageRow = resolved.packageRow ?? {}
  const active = resolved.activeRow ?? {}
  const candidateId = resolved.candidateId as string
  const journey = /^sha256:[0-9a-f]{64}$/.test(candidateId)
    ? record(await (async () => {
        // Loaded only for a resolved case so catalog discovery remains cheap.
        // @ts-expect-error Node's direct TypeScript runner requires the suffix.
        const module = await import("./product-journey-read-model-v1.ts")
        return module.readSellerOsProductJourneyV1({ supabase: input.supabase,
          accountKey: input.accountKey, candidateId, now })
      })()) : {}
  const phases = rows(journey.phases)
  const phaseBy = new Map(phases.map((phase) => [String(phase.code), phase]))
  const stageSource: Record<string, string> = {
    LUNA_SOURCE: "PRODUCT_TRUTH", PRODUCT_TRUTH: "PRODUCT_TRUTH",
    MARKET_RESEARCH: "PRODUCT_RESEARCH", RADAR: "RADAR",
    PRICING: "ECONOMICS", ECONOMICS: "ECONOMICS",
    EBAY_IDENTITY: "LISTING_PACKAGE", CATEGORY: "LISTING_PACKAGE",
    ASPECTS: "LISTING_PACKAGE", LISTING_PACKAGE: "LISTING_PACKAGE",
    OWNER_AUTHORIZATION: "OWNER_AUTHORIZATION", PUBLISHER: "PUBLISHER",
    OFFICIAL_EBAY_READBACK: "OFFICIAL_EBAY_READBACK",
    CURRENT_LIVE: "LIVE_MONITORING", STOCK: "LIVE_MONITORING",
    ANALYTICS: "LIVE_MONITORING", ORDERS: "LIVE_MONITORING",
    MAYEL: "LIVE_MONITORING",
  }
  const orderedJourney = JOURNEY_STAGES.map((code) => {
    const phase = phaseBy.get(stageSource[code])
    const status = phase ? phaseStatus(phase.status) : "UNPROVEN"
    return Object.freeze({ STAGE: code, STATUS: status,
      TEMPORAL_SCOPE: phase && record(phase.freshness).status === "STALE"
        ? "STALE" : "CURRENT", SOURCE_AUTHORITY: text(phase?.sourceAuthority, 180)
          ?? "NO_CURRENT_AUTHORITY_PROVEN",
      OBSERVED_AT: dateValue(record(phase?.freshness).observedAt),
      FRESH_UNTIL: dateValue(record(phase?.freshness).expiresAt),
      FAILURE_CLASS: text(phase?.failureClass, 180),
      RECEIPT_REFERENCES: mode === "TRACE"
        ? (Array.isArray(record(phase?.technicalEvidence).receiptReferences)
            ? record(phase?.technicalEvidence).receiptReferences : []) : undefined })
  })
  const assessment = record(queue.assessment)
  const productTruth = record(first(assessment.productTruth,
    assessment.productTruthV1, assessment.lunaProductTruthV1))
  const packageData = record(packageRow.package_data)
  const economics = record(record(journey.economicEvidenceRefresh).economics)
  const queueObserved = first(queue.source_observed_at, queue.updated_at,
    queue.created_at)
  const packageObserved = first(packageRow.updated_at, packageRow.created_at)
  const activeObserved = first(active.last_ebay_sync_at, active.updated_at,
    active.created_at)
  const fieldTruth = [
    field({ field: "LUNA_PRODUCT_ID", value: queue.supplier_product_id,
      source: "LUNA", authority: "ebay_luna_opportunity_queue",
      observedAt: queueObserved, evidenceId: queue.id,
      consumers: ["PRODUCT_TRUTH", "LISTING_PACKAGE"] }, now),
    field({ field: "LUNA_VARIANT_ID", value: queue.supplier_variant_id,
      source: "LUNA", authority: "ebay_luna_opportunity_queue",
      observedAt: queueObserved, evidenceId: queue.id,
      consumers: ["SHIPPING", "ECONOMICS", "PUBLISHER"] }, now),
    field({ field: "SUPPLIER_SKU", value: queue.supplier_sku,
      source: "LUNA", authority: "ebay_luna_opportunity_queue",
      observedAt: queueObserved, evidenceId: queue.id,
      consumers: ["IDENTITY", "CURRENT_LIVE"] }, now),
    field({ field: "TITLE", value: first(productTruth.title, queue.title,
      packageData.title), source: "LUNA_PRODUCT_TRUTH",
      authority: "ebay_luna_opportunity_queue.assessment.productTruth",
      observedAt: queueObserved, evidenceId: queue.id,
      consumers: ["LISTING_PACKAGE", "PUBLISHER"] }, now),
    ...["brand", "model", "material", "color", "dimensions", "weight",
      "packageContents", "gtin", "mpn"].map((name) => field({
        field: name.toUpperCase(), value: first(productTruth[name],
          assessment[name], packageData[name]), source: "PRODUCT_TRUTH",
        authority: "ebay_luna_opportunity_queue.assessment",
        observedAt: queueObserved, evidenceId: queue.id,
        consumers: ["LISTING_PACKAGE", "PUBLISHER"] }, now)),
    field({ field: "IMAGES", value: first(packageData.imageUrls,
      packageData.images, productTruth.images), source: "PRODUCT_TRUTH_AND_PACKAGE",
      authority: "ebay_listing_packages.package_data",
      observedAt: packageObserved, evidenceId: packageRow.id,
      consumers: ["OWNER_AUTHORIZATION", "PUBLISHER", "MAYEL"] }, now),
    field({ field: "SUPPLIER_COST", value: first(economics.luna_cost,
      queue.supplier_price, record(assessment.economics).supplierCost),
      source: "LUNA", authority: economics.luna_cost !== undefined
        ? "seller_os_live_economics_readbacks_v1" : "ebay_luna_opportunity_queue",
      observedAt: first(economics.calculated_at, queueObserved),
      evidenceId: queue.id, consumers: ["ECONOMICS"] }, now),
    field({ field: "SUPPLIER_STOCK", value: first(queue.supplier_inventory,
      queue.supplier_availability), source: "LUNA",
      authority: "ebay_luna_opportunity_queue", observedAt: queueObserved,
      evidenceId: queue.id, consumers: ["STOCK", "PUBLISHER"] }, now),
    field({ field: "SUPPLIER_SHIPPING", value: first(economics.luna_shipping,
      record(packageData.shipping).amount), source: "LUNA_SHIPPING",
      authority: economics.luna_shipping !== undefined
        ? "seller_os_live_economics_readbacks_v1"
        : "ebay_listing_packages.package_data.shipping",
      observedAt: first(economics.calculated_at, packageObserved),
      evidenceId: packageRow.id, consumers: ["ECONOMICS"] }, now),
    field({ field: "EBAY_ITEM_ID", value: first(active.ebay_item_id,
      record(journey.identity).itemId), source: "EBAY",
      authority: "ebay_active_listings", observedAt: activeObserved,
      evidenceId: active.id, consumers: ["CURRENT_LIVE", "STOCK", "ORDERS"] }, now),
    field({ field: "EBAY_LIVE_PRICE", value: first(economics.live_price,
      active.current_price), source: "EBAY_OFFICIAL_READ",
      authority: economics.live_price !== undefined
        ? "seller_os_live_economics_readbacks_v1" : "ebay_active_listings",
      observedAt: first(economics.calculated_at, activeObserved),
      evidenceId: active.id, consumers: ["ECONOMICS", "MAYEL"] }, now),
    ...[["EXPECTED_EBAY_FEE", "expected_ebay_fee"],
      ["OTHER_EXPLICIT_COSTS", "other_explicit_costs"],
      ["EXPECTED_PROFIT", "expected_profit"], ["MARGIN", "margin_percent"],
      ["ROI", "roi_percent"]].map(([name, key]) => field({ field: name,
        value: economics[key], source: "SELLER_OS_ECONOMICS",
        authority: "seller_os_live_economics_readbacks_v1",
        observedAt: economics.calculated_at, evidenceId: active.ebay_item_id,
        consumers: ["READINESS", "MAYEL"] }, now)),
    field({ field: "CATEGORY", value: first(packageData.categoryId,
      packageRow.category_id), source: "EBAY_TAXONOMY",
      authority: "ebay_listing_packages.package_data", observedAt: packageObserved,
      evidenceId: packageRow.id, consumers: ["ASPECTS", "PUBLISHER"] }, now),
    field({ field: "REQUIRED_ASPECTS", value: first(packageData.aspects,
      packageData.itemSpecifics), source: "EBAY_TAXONOMY_AND_PRODUCT_TRUTH",
      authority: "ebay_listing_packages.package_data", observedAt: packageObserved,
      evidenceId: packageRow.id, consumers: ["PUBLISHER"] }, now),
    field({ field: "PACKAGE_STATE", value: packageRow.status,
      source: "SELLER_OS", authority: "ebay_listing_packages",
      observedAt: packageObserved, evidenceId: packageRow.id,
      consumers: ["OWNER_AUTHORIZATION", "PUBLISHER"] }, now),
    field({ field: "PACKAGE_DIGEST", value: first(packageRow.package_digest,
      packageRow.payload_hash, packageData.packageDigest), source: "SELLER_OS",
      authority: "ebay_listing_packages", observedAt: packageObserved,
      evidenceId: packageRow.id, consumers: ["OWNER_AUTHORIZATION", "PUBLISHER"] }, now),
  ]
  const groups: Record<string, string[]> = { KNOWN: [], STALE: [], UNPROVEN: [],
    UNAVAILABLE: [], MISSING: [], CONTRADICTED: [] }
  for (const truth of fieldTruth) {
    const status = truth.EVIDENCE_STATUS
    if (status === "PROVEN") groups.KNOWN.push(truth.FIELD)
    else if (status in groups) groups[status].push(truth.FIELD)
    else groups.UNPROVEN.push(truth.FIELD)
  }
  const firstBlocker = orderedJourney.find((stage) =>
    stage.STATUS !== "PROVEN" && stage.STATUS !== "NOT_APPLICABLE")
  const blocker = firstBlocker?.STAGE ?? null
  const impact = blocker === "ANALYTICS" ? "LEARNING_BLINDNESS"
    : blocker === "MAYEL" ? "CONVERSION_RISK"
      : blocker === "STOCK" ? "OVERSALE_RISK"
        : blocker === "MARKET_RESEARCH" || blocker === "RADAR"
          ? "OPPORTUNITY_BLINDNESS"
          : blocker === "ECONOMICS" || blocker === "PRICING"
            ? "MARGIN_RISK" : blocker ? "REVENUE_BLOCKING" : "NONE"
  return Object.freeze({ AUDIT_CONTRACT_VERSION: SELLER_OS_PRODUCT_CASE_AUDIT_V1,
    OBSERVED_AT: now.toISOString(), DETAIL_MODE: mode,
    INPUT_IDENTITY: { type: input.identityType, value: input.identity },
    RESOLVED_CANONICAL_IDENTITY: { candidateId,
      productCaseId: text(resolved.productCaseRow?.product_case_id, 180),
      lunaProductId: text(queue.supplier_product_id, 180),
      lunaVariantId: text(queue.supplier_variant_id, 180),
      supplierSku: text(queue.supplier_sku, 180),
      ebaySku: text(active.sku, 180), ebayItemId: text(active.ebay_item_id, 30),
      packageId: text(packageRow.id, 80) },
    PRODUCT_JOURNEY: orderedJourney,
    FIELD_TRUTH: mode === "SUMMARY"
      ? fieldTruth.filter((entry) => ["LUNA_PRODUCT_ID", "LUNA_VARIANT_ID",
          "SUPPLIER_SKU", "EBAY_ITEM_ID", "EBAY_LIVE_PRICE", "SUPPLIER_COST",
          "SUPPLIER_SHIPPING", "EXPECTED_PROFIT", "PACKAGE_STATE",
          "PACKAGE_DIGEST"].includes(entry.FIELD)) : fieldTruth,
    ...groups, NEXT_BLOCKING_STAGE: blocker, BUSINESS_IMPACT: impact,
    TECHNICAL_TRACE: mode === "TRACE" ? {
      journeyActivity: journey.activity ?? [], evidenceInventory:
        journey.evidenceInventory ?? null } : undefined,
    safety: { readOnly: true, arbitrarySql: false, arbitraryUrl: false,
      arbitraryPath: false, arbitraryShell: false, credentialsIncluded: false,
      buyerPiiIncluded: false, databaseBusinessWrites: 0,
      marketplaceWrites: 0, productPatches: 0, taskAdvancements: 0 },
  })
}

export function projectSellerOsHistoricalMismatchFieldV1(batchChild: Row) {
  const mismatch = Array.isArray(batchChild.mismatch_fields)
    ? batchChild.mismatch_fields.filter((value) => typeof value === "string" && value)
    : []
  return mismatch.length ? mismatch : "UNPROVEN"
}

export async function readSellerOsPublicationExecutionAuditV1(input: Readonly<{
  supabase: SupabaseClient; accountKey: string; publicationExecutionId: string;
  packageId?: string; detailMode?: SellerOsAuditDetailModeV1; now?: Date }>) {
  if (!UUID.test(input.publicationExecutionId) ||
      (input.packageId && !UUID.test(input.packageId))) {
    throw new Error("AUDIT_PUBLICATION_EXECUTION_ID_INVALID")
  }
  const now = input.now ?? new Date()
  const mode = cleanDetailMode(input.detailMode)
  const executionRead = await input.supabase.from("ebay_draft_only_execution_ledger")
    .select("*").eq("id", input.publicationExecutionId).limit(1).maybeSingle()
  assertRead("EXECUTION", executionRead)
  const execution = record(executionRead.data)
  if (!text(execution.id, 80)) throw new Error("AUDIT_PUBLICATION_EXECUTION_NOT_FOUND")
  const resolvedPackageId = text(execution.listing_package_id, 80)
  if (input.packageId && input.packageId !== resolvedPackageId) {
    throw new Error("AUDIT_PUBLICATION_PACKAGE_LINEAGE_CONTRADICTED")
  }
  const packageRead = await input.supabase.from("ebay_listing_packages")
    .select("*").eq("id", resolvedPackageId).eq("account_key", input.accountKey)
    .limit(1).maybeSingle()
  assertRead("PACKAGE", packageRead)
  const packageRow = record(packageRead.data)
  if (!text(packageRow.id, 80)) throw new Error("AUDIT_PUBLICATION_ACCOUNT_SCOPE_MISMATCH")
  const [approvalRead, publicationRead, childRead] = await Promise.all([
    input.supabase.from("ebay_draft_only_approvals").select("*")
      .eq("id", execution.approval_id).limit(1).maybeSingle(),
    input.supabase.from("ebay_authorized_listing_publications").select("*")
      .eq("draft_execution_id", execution.id).order("updated_at",
        { ascending: false }).limit(2),
    input.supabase.from("seller_os_publisher_batch_children_v1").select("*")
      .eq("marketplace_account_key", input.accountKey).eq("execution_id", execution.id)
      .order("updated_at", { ascending: false }).limit(2),
  ])
  for (const [code, result] of [["APPROVAL", approvalRead],
    ["PUBLICATION", publicationRead], ["BATCH_CHILD", childRead]] as const) {
    assertRead(code, result)
  }
  const approval = record(approvalRead.data)
  const publication = latest(rows(publicationRead.data)) ?? {}
  const child = latest(rows(childRead.data)) ?? {}
  const packageData = record(packageRow.package_data)
  const itemId = text(first(publication.active_listing_id, publication.listing_id,
    child.item_id), 30)
  let active: Row = {}
  if (itemId) {
    const activeRead = await input.supabase.from("ebay_active_listings").select("*")
      .eq("account_key", input.accountKey).eq("ebay_item_id", itemId)
      .limit(1).maybeSingle()
    assertRead("ACTIVE_LISTING", activeRead); active = record(activeRead.data)
  }
  const step = (name: string, start: unknown, complete: unknown, result: unknown,
    write = false, readback = false, receipt?: unknown) => Object.freeze({
      STEP: name, OPERATION_CLASS: write ? "MARKETPLACE_WRITE" : "READ_ONLY_OR_INTERNAL",
      STARTED_AT: dateValue(start), COMPLETED_AT: dateValue(complete),
      RESULT: text(result, 180) ?? "UNPROVEN", HTTP_CLASS: numberValue(
        first(publication.last_http_status, child.http_status)),
      EBAY_ERROR_ID: text(first(child.ebay_error_id, publication.last_ebay_error_id), 80),
      ERROR_CLASS: text(first(child.error_class, execution.last_error_code,
        publication.last_error_code), 180), RECEIPT_ID: text(receipt, 180),
      MARKETPLACE_WRITE_OCCURRED: write,
      OFFICIAL_READBACK_OCCURRED: readback })
  const steps = [
    step("OWNER_AUTHORIZATION", approval.created_at, approval.approved_at,
      approval.status, false, false, approval.id),
    step("EXECUTION_CLAIM", execution.started_at, execution.updated_at,
      execution.phase, false, false, execution.id),
    ...(execution.inventory_item_status || execution.inventory_item_completed_at
      ? [step("INVENTORY_ITEM_UPSERT", execution.inventory_item_started_at,
          execution.inventory_item_completed_at, execution.inventory_item_status,
          true, false, execution.id)] : []),
    ...(execution.offer_status || execution.offer_completed_at
      ? [step("OFFER_CREATE_OR_REUSE", execution.offer_started_at,
          execution.offer_completed_at, execution.offer_status, true, false,
          execution.offer_id)] : []),
    ...(text(publication.id, 80) ? [step("PUBLISH", publication.started_at,
      publication.completed_at, publication.phase, (numberValue(
        publication.publish_write_count) ?? 0) > 0, false, publication.id)] : []),
    ...(itemId || child.official_readback_state ? [step("OFFICIAL_FINAL_READBACK",
      child.updated_at, child.completed_at, first(child.official_readback_state,
        active.listing_status), false, true, child.receipt_id)] : []),
  ]
  const officialState = text(child.official_readback_state, 100)
  const finalState = itemId && (officialState === "PUBLISHED_CONFIRMED" ||
      ["Active", "ACTIVE", "LIVE"].includes(String(active.listing_status)))
    ? "APPLIED_AND_OFFICIALLY_VERIFIED"
    : text(child.result, 100) === "FAILED_BLOCKED" ? "FAILED"
      : numberValue(publication.publish_write_count) && !itemId
        ? "PUBLISH_ATTEMPTED" : text(execution.phase, 100) === "completed"
          ? "OFFER_READY" : text(execution.phase, 100) ? "PREFLIGHT_BLOCKED"
            : "NOT_STARTED"
  const retrySafety = text(first(child.retry_safety, child.retrySafety), 100)
  const safeToResume: boolean | "UNPROVEN" = retrySafety &&
      /SAFE|RETRYABLE/.test(retrySafety) && !/UNSAFE|AMBIGUOUS/.test(retrySafety)
    ? true : retrySafety && /UNSAFE|TERMINAL/.test(retrySafety) ? false : "UNPROVEN"
  const writeCount = numberValue(child.marketplace_write_count)
  const postAuthMutation = numberValue(first(child.post_auth_package_mutation_count,
    record(child.sanitized_result).postAuthPackageMutationCount))
  return Object.freeze({
    AUDIT_CONTRACT_VERSION: SELLER_OS_PUBLICATION_EXECUTION_AUDIT_V1,
    OBSERVED_AT: now.toISOString(), DETAIL_MODE: mode,
    PUBLICATION_EXECUTION_ID: execution.id,
    PRODUCT_ID: first(packageRow.opportunity_id, packageRow.candidate_key),
    SUPPLIER_SKU: first(execution.supplier_sku, packageData.supplierSku),
    EBAY_SKU: execution.sku, PACKAGE_ID: packageRow.id,
    AUTHORIZED_PACKAGE_DIGEST: first(approval.payload_hash,
      child.authorized_package_digest), OWNER_AUTHORIZATION_ID: approval.id,
    AUTHORIZATION_STATUS: approval.status, AUTHORIZED_AT: approval.approved_at,
    MANAGEMENT_MODEL: first(child.management_model,
      record(execution.sanitized_result).managementModel, "UNPROVEN"),
    PREWRITE_STATE: mode === "SUMMARY" ? text(child.stage, 100) : {
      packageStatus: packageRow.status, executionPhase: execution.phase,
      authorizationStatus: approval.status },
    INVENTORY_ITEM_STATE: first(execution.inventory_item_status, "UNPROVEN"),
    OFFER_STATE: first(execution.offer_status, child.offer_status, "UNPROVEN"),
    SELF_LINEAGE_STATE: first(child.self_lineage_state, "UNPROVEN"),
    INTENDED_WRITE_PLAN: mode === "SUMMARY" ? undefined :
      (Array.isArray(execution.permitted_operations)
        ? execution.permitted_operations : []),
    STEP_TRACE: mode === "TRACE" ? steps : steps.map((entry) => ({ STEP: entry.STEP,
      RESULT: entry.RESULT, MARKETPLACE_WRITE_OCCURRED:
        entry.MARKETPLACE_WRITE_OCCURRED,
      OFFICIAL_READBACK_OCCURRED: entry.OFFICIAL_READBACK_OCCURRED,
      ERROR_CLASS: entry.ERROR_CLASS, RECEIPT_ID: entry.RECEIPT_ID })),
    OFFER_ID: first(publication.offer_id, execution.offer_id, child.offer_id),
    LISTING_ID: itemId, FINAL_STATE: finalState,
    LAST_PROVEN_STEP: [...steps].reverse().find((entry) => entry.RESULT !== "UNPROVEN")
      ?.STEP ?? "UNPROVEN",
    BLOCKER_CODE: first(child.error_class, child.blocker_code,
      execution.last_error_code, publication.last_error_code),
    EXACT_MISMATCH_FIELD: projectSellerOsHistoricalMismatchFieldV1(child),
    SAFE_TO_RESUME: safeToResume,
    RETRY_POLICY: first(child.recovery_policy, retrySafety, "UNPROVEN"),
    POST_AUTH_PACKAGE_MUTATION_COUNT: postAuthMutation ?? "UNPROVEN",
    MARKETPLACE_WRITE_COUNT: writeCount ?? "UNPROVEN",
    OFFICIAL_FINAL_READBACK: officialState ? { state: officialState,
      itemId, observedAt: first(child.completed_at, child.updated_at,
        active.last_ebay_sync_at) } : "UNPROVEN",
    safety: { readOnly: true, arbitrarySql: false, arbitraryUrl: false,
      credentialsIncluded: false, buyerPiiIncluded: false,
      databaseBusinessWrites: 0, marketplaceWrites: 0,
      historicalAmbiguityPreserved: true },
  })
}

export const SELLER_OS_CODEX_AUDIT_PROTOCOL_V1 = Object.freeze([
  "seller_os_get_system_review_bundle",
  "seller_os_get_product_case",
  "seller_os_get_publication_execution when Publisher-related",
  "inspect only the identified shared mechanism",
  "correct the shared root cause",
  "verify through Seller OS readback",
])

export async function enrichSellerOsSystemReviewAuditDrilldownV1(input: Readonly<{
  supabase: SupabaseClient; accountKey: string; bundle: unknown }>) {
  const runRead = await input.supabase.from("seller_os_operational_integrity_runs_v1")
    .select("id,status,mechanism_version,observed_at,audit_receipt")
    .eq("marketplace_account_key", input.accountKey)
    .in("mechanism_version", ["SELLER_OS_RUNTIME_CAPABILITY_ASSURANCE_V1",
      "SELLER_OS_RUNTIME_HEALTH_V1", "SELLER_OS_OPERATIONAL_INTEGRITY_AUDITOR_V1"])
    .order("observed_at", { ascending: false }).limit(12)
  assertRead("SYSTEM_REVIEW_RUNTIME_RECEIPTS", runRead)
  const incidentRead = await input.supabase.from(
    "seller_os_operational_learning_ledger_v1")
    .select("id,failure_class,invariant_code,retry_safety,last_observed_at,mechanism_version")
    .eq("marketplace_account_key", input.accountKey).eq("status", "OPEN")
    .order("last_observed_at", { ascending: false }).limit(20)
  assertRead("SYSTEM_REVIEW_INCIDENTS", incidentRead)
  const runs = rows(runRead.data)
  const byMechanism = (name: string) => runs.find((row) =>
    row.mechanism_version === name) ?? null
  const assurance = byMechanism("SELLER_OS_RUNTIME_CAPABILITY_ASSURANCE_V1")
  const localHealth = byMechanism("SELLER_OS_RUNTIME_HEALTH_V1")
  const integrity = byMechanism("SELLER_OS_OPERATIONAL_INTEGRITY_AUDITOR_V1")
  const incidents = rows(incidentRead.data)
  const top = incidents.find((row) => row.failure_class) ?? null
  return Object.freeze({ ...record(input.bundle), auditDrilldown: Object.freeze({
    contractVersion: SELLER_OS_AUDIT_OBSERVABILITY_GATEWAY_V1,
    currentRevenuePathStatus: top ? "BLOCKED_OR_DEGRADED" : "NO_OPEN_BLOCKER_PROVEN",
    topBlockingCapability: top ? { failureClass: top.failure_class,
      invariantCode: top.invariant_code, observedAt: top.last_observed_at } : null,
    productCaseRefs: Object.freeze([]),
    publicationExecutionRefs: Object.freeze([]),
    openRuntimeIncidents: Object.freeze(incidents),
    sourceFreshnessLimitations: Object.freeze(incidents.filter((row) =>
      /STALE|FRESH|SOURCE|OUTPUT|WORKER/.test(String(row.failure_class ?? "")))),
    runtimeAssuranceVisibility: Object.freeze({
      LOCAL_RUNTIME_REALITY: Object.freeze({
        authority: "SELLER_OS_RUNTIME_HEALTH_V1",
        currentReadTool: "seller_os_get_runtime_health",
        receiptId: localHealth?.id ?? null,
        observedAt: localHealth?.observed_at ?? null,
        status: localHealth?.status ?? "UNAVAILABLE",
      }),
      LOCAL_HEALTH_RECEIPT: localHealth ? Object.freeze({ id: localHealth.id,
        observedAt: localHealth.observed_at, status: localHealth.status }) : null,
      CLOUD_ASSURANCE_PROJECTION: assurance ? Object.freeze({ id: assurance.id,
        observedAt: assurance.observed_at, status: assurance.status }) : null,
      OPERATIONAL_INTEGRITY_RECEIPT: integrity ? Object.freeze({ id: integrity.id,
        observedAt: integrity.observed_at, status: integrity.status }) : null,
    }),
    preferredAuditProtocol: SELLER_OS_CODEX_AUDIT_PROTOCOL_V1,
    bounded: true, sourceAuthorityCreated: false,
  }) })
}
