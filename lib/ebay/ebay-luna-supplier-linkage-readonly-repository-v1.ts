import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { readLunaWatcherHumanApprovalContractV1 } from
  "./commercial-monitor-readonly-utilities.mjs"
import type {
  SellerOsLunaSupplierApprovalEvidenceV1,
  SellerOsLunaSupplierCandidateEvidenceV1,
  SellerOsLunaSupplierLinkageRepositoryEvidenceV1,
} from "./ebay-luna-supplier-linkage-certification-v1"
import { createSellerOsLunaIdentityVerificationTargetV1 } from
  "./ebay-luna-identity-verification-v1"

const MAXIMUM_CURRENT_ITEMS = 50
const MAXIMUM_SOURCE_ROWS = 250

type ActiveListingLinkRow = Readonly<{
  id: string
  ebay_item_id: string
  market_radar_product_id: string | null
  supplier_variant_id: string | null
  supplier_sku: string | null
  raw_payload: unknown
  updated_at: string | null
}>

type ManualListingLinkRow = Readonly<{
  id: string
  ebay_item_id: string
  candidate_key: string
  market_radar_product_id: string | null
  supplier_variant_id: string | null
  supplier_sku: string | null
  verification_status: string
  verification_method: string
  verification_reason: string
  verified_at: string | null
  last_verification_at: string | null
  updated_at: string | null
}>

type LunaVariantRow = Readonly<{
  product_id: string
  supplier_product_id: string
  product_url: string | null
  title: string | null
  snapshot_id: string
  supplier_variant_id: string
  variant_title: string | null
  sku: string | null
  captured_at: string | null
}>

type DurableLinkageDecisionRow = Readonly<{
  decision_id: string
  ebay_item_id: string
  ebay_sku: string | null
  listing_title: string | null
  linkage_id: string | null
  luna_product_id: string | null
  luna_variant_id: string | null
  luna_sku: string | null
  components: unknown
  supplier_quantity_required: number | null
  evidence_references: unknown
  evidence_digest: string
  decision: string
  decision_version: number
  decision_at: string
  decision_reference: string
  contract_version: string
  classification: string | null
  evidence_observed_at: string | null
}>

function text(value: unknown, maximum = 200) {
  if (typeof value !== "string") return null
  const result = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, maximum)
  return result || null
}

function timestamp(value: unknown) {
  const safe = text(value, 50)
  return safe && Number.isFinite(Date.parse(safe))
    ? new Date(safe).toISOString() : null
}

function reference(prefix: string, value: unknown) {
  const safe = text(value, 120)
  return safe && /^[A-Za-z0-9_.:-]{1,120}$/.test(safe)
    ? `${prefix}:${safe}` : prefix
}

function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 &&
    Number(value) <= 1_000_000 ? Number(value) : null
}

function boolean(value: unknown) {
  return typeof value === "boolean" ? value : false
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function durableComponents(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 24) return []
  const components = value.flatMap((entry) => {
    const row = object(entry)
    const lunaProductId = text(row.lunaProductId ?? row.luna_product_id, 100)
    const lunaVariantId = text(row.lunaVariantId ?? row.luna_variant_id, 100)
    const lunaSku = text(row.lunaSku ?? row.luna_sku, 120)
    const supplierQuantityRequired = positiveInteger(
      row.supplierQuantityRequired ?? row.supplier_quantity_required,
    )
    if (!lunaProductId || !lunaVariantId || !lunaSku ||
        !supplierQuantityRequired) return []
    return [Object.freeze({
      lunaProductId,
      lunaVariantId,
      lunaSku,
      productTitle: text(row.productTitle ?? row.product_title, 240),
      variantTitle: text(row.variantTitle ?? row.variant_title, 160),
      supplierQuantityRequired,
      variantPresence: new Set(["PRESENT", "MISSING", "UNPROVEN"]).has(
        String(row.variantPresence ?? row.variant_presence),
      ) ? String(row.variantPresence ?? row.variant_presence) as
        "PRESENT" | "MISSING" | "UNPROVEN" : "UNPROVEN" as const,
      exactProductIdentity: boolean(row.exactProductIdentity ??
        row.exact_product_identity),
      exactVariantIdentity: boolean(row.exactVariantIdentity ??
        row.exact_variant_identity),
      exactSupplierSku: boolean(row.exactSupplierSku ?? row.exact_supplier_sku),
      structuredVariantAttributesComplete: boolean(
        row.structuredVariantAttributesComplete ??
          row.structured_variant_attributes_complete,
      ),
      identityConflict: boolean(row.identityConflict ?? row.identity_conflict),
    })]
  })
  return components.length === value.length ? components : []
}

function durableDecisionStatus(value: unknown) {
  if (value === "APPROVE_EXACT_LINKAGE") return "APPROVED" as const
  if (value === "REJECT_CANDIDATE") return "REJECTED" as const
  if (value === "KEEP_UNPROVEN") return "KEPT_UNPROVEN" as const
  return null
}

function candidateFromDurableDecision(row: DurableLinkageDecisionRow):
SellerOsLunaSupplierCandidateEvidenceV1 | null {
  const decision = durableDecisionStatus(row.decision)
  const components = durableComponents(row.components)
  const decidedAt = timestamp(row.decision_at)
  const decisionReference = text(row.decision_reference, 240)
  if (!decision || !components.length || !decidedAt || !decisionReference ||
      !Number.isSafeInteger(row.decision_version) || row.decision_version < 1) {
    return null
  }
  const single = components.length === 1 ? components[0] : null
  const allPresent = components.every((component) =>
    component.variantPresence === "PRESENT")
  const anyMissing = components.some((component) =>
    component.variantPresence === "MISSING")
  return Object.freeze({
    ebayItemId: row.ebay_item_id,
    lunaProductId: single?.lunaProductId ?? null,
    lunaVariantId: single?.lunaVariantId ?? null,
    lunaProductHasVariants: single ? true : null,
    lunaSku: single?.lunaSku ?? null,
    lunaModel: null,
    productTitle: single?.productTitle ?? null,
    variantTitle: single?.variantTitle ?? null,
    observedAt: decidedAt,
    sourceUpdatedAt: timestamp(row.evidence_observed_at),
    evidenceReferences: Object.freeze(Array.isArray(row.evidence_references)
      ? row.evidence_references.flatMap((value) => {
          const safe = text(value, 240)
          return safe ? [safe] : []
        }).slice(0, 64)
      : [reference("luna-linkage-decision", row.decision_id)]),
    exactSupplierSku: components.every((component) =>
      component.exactSupplierSku),
    exactModelNumber: false,
    exactVariantAttributes: components.every((component) =>
      component.exactProductIdentity && component.exactVariantIdentity &&
      component.structuredVariantAttributesComplete &&
      !component.identityConflict),
    titleSimilarityOnly: false,
    colorMatch: null,
    sizeMatch: null,
    packCountMatch: null,
    listingPackCount: null,
    supplierUnitCount: null,
    supplierQuantityPerSale: single?.supplierQuantityRequired ?? null,
    supplierComponents: Object.freeze(components.map((component) =>
      Object.freeze({
        lunaProductId: component.lunaProductId,
        lunaVariantId: component.lunaVariantId,
        lunaProductHasVariants: true,
        lunaSku: component.lunaSku,
        productTitle: component.productTitle,
        variantTitle: component.variantTitle,
        supplierQuantityRequired: component.supplierQuantityRequired,
        variantPresence: component.variantPresence,
        evidenceReferences: Object.freeze([
          reference("luna-linkage-decision", row.decision_id),
        ]),
        exactSupplierSku: component.exactSupplierSku,
        exactVariantAttributes: component.exactProductIdentity &&
          component.exactVariantIdentity &&
          component.structuredVariantAttributesComplete &&
          !component.identityConflict,
        colorMatch: null,
        sizeMatch: null,
        packCountMatch: null,
      }))),
    historicalApprovedRelationship: false,
    variantPresence: allPresent ? "PRESENT" as const
      : anyMissing ? "MISSING" as const : "UNPROVEN" as const,
    humanDecision: Object.freeze({
      status: decision,
      decidedAt,
      decisionReference,
      version: String(row.decision_version),
    }),
  })
}

function unavailable(observedAt: string, code: string):
SellerOsLunaSupplierLinkageRepositoryEvidenceV1 {
  return Object.freeze({
    status: "UNAVAILABLE" as const,
    observedAt,
    approvalEvidence: Object.freeze([]),
    candidateEvidence: Object.freeze([]),
    rowsRead: 0,
    truncated: false,
    limitationCodes: Object.freeze([code]),
  })
}

function currentVariantByExactIdentity(rows: readonly LunaVariantRow[], input: {
  productId: string | null
  variantId: string | null
  sku: string | null
}) {
  if (!input.productId || !input.variantId || !input.sku) return null
  const matches = rows.filter((row) => (
    row.product_id === input.productId ||
    row.supplier_product_id === input.productId
  ) &&
    row.supplier_variant_id === input.variantId && row.sku === input.sku)
  return matches.length === 1 ? matches[0] : null
}

function candidateFromIdentity(input: Readonly<{
  ebayItemId: string
  internalMarketRadarProductId: string | null
  variantId: string | null
  sku: string | null
  observedAt: string | null
  evidenceReference: string
  historicalApprovedRelationship: boolean
  variants: readonly LunaVariantRow[]
  variantReadAvailable: boolean
}>): SellerOsLunaSupplierCandidateEvidenceV1 | null {
  const internalProductId = text(input.internalMarketRadarProductId, 100)
  const variantId = text(input.variantId, 100)
  const sku = text(input.sku, 120)
  if (!internalProductId && !variantId && !sku) return null
  const productRows = internalProductId
    ? input.variants.filter((row) => row.product_id === internalProductId ||
      row.supplier_product_id === internalProductId) : []
  const exact = currentVariantByExactIdentity(input.variants, {
    productId: internalProductId, variantId, sku,
  })
  // product_id is Seller OS / Market Radar infrastructure identity. It may
  // locate the catalog row, but it must never escape as Luna supplier truth.
  const externalLunaProductId = exact
    ? text(exact.supplier_product_id, 100) : null
  return Object.freeze({
    ebayItemId: input.ebayItemId,
    lunaProductId: externalLunaProductId,
    lunaVariantId: variantId,
    lunaProductHasVariants: productRows.length ? true : null,
    lunaSku: sku,
    lunaModel: null,
    productTitle: exact ? text(exact.title) : null,
    variantTitle: exact ? text(exact.variant_title) : null,
    observedAt: timestamp(input.observedAt),
    sourceUpdatedAt: exact ? timestamp(exact.captured_at) : null,
    evidenceReferences: Object.freeze([
      input.evidenceReference,
      ...(exact ? [reference("luna-current-variant", exact.snapshot_id)] : []),
    ]),
    exactSupplierSku: Boolean(exact && sku === exact.sku),
    exactModelNumber: false,
    exactVariantAttributes: Boolean(exact && variantId ===
      exact.supplier_variant_id),
    titleSimilarityOnly: false,
    colorMatch: null,
    sizeMatch: null,
    packCountMatch: null,
    listingPackCount: null,
    supplierUnitCount: null,
    supplierQuantityPerSale: null,
    supplierComponents: Object.freeze([]),
    historicalApprovedRelationship: input.historicalApprovedRelationship,
    variantPresence: !input.variantReadAvailable ? "UNPROVEN" as const
      : exact ? "PRESENT" as const : "MISSING" as const,
    humanDecision: null,
  })
}

/**
 * Fixed-account, fixed-table, bounded reads only. The repository never returns
 * raw_payload, product URLs, credentials, Luna session material, or stock.
 */
export async function readSellerOsLunaSupplierLinkageEvidenceV1(
  supabase: Pick<SupabaseClient, "from">,
  accountKey: string,
  currentItemIds: readonly string[],
  observedAt = new Date().toISOString(),
): Promise<SellerOsLunaSupplierLinkageRepositoryEvidenceV1> {
  const safeAccount = text(accountKey, 200)
  const items = [...new Set(currentItemIds.filter((itemId) =>
    /^\d{9,19}$/.test(itemId)))].sort()
    .slice(0, MAXIMUM_CURRENT_ITEMS)
  if (!safeAccount) {
    return unavailable(observedAt,
      "CANONICAL_SELLER_ACCOUNT_BINDING_UNAVAILABLE")
  }
  if (items.length === 0) {
    return Object.freeze({
      status: "AVAILABLE" as const,
      observedAt,
      approvalEvidence: Object.freeze([]),
      candidateEvidence: Object.freeze([]),
      rowsRead: 0,
      truncated: false,
      limitationCodes: Object.freeze([]),
    })
  }

  const [activeRead, manualRead, decisionRead] = await Promise.all([
    supabase.from("ebay_active_listings")
      .select("id,ebay_item_id,market_radar_product_id,supplier_variant_id,supplier_sku,raw_payload,updated_at")
      .eq("account_key", safeAccount)
      .in("ebay_item_id", items)
      .order("updated_at", { ascending: false })
      .limit(MAXIMUM_SOURCE_ROWS + 1),
    supabase.from("ebay_manual_listing_links")
      .select("id,ebay_item_id,candidate_key,market_radar_product_id,supplier_variant_id,supplier_sku,verification_status,verification_method,verification_reason,verified_at,last_verification_at,updated_at")
      .eq("account_key", safeAccount)
      .eq("marketplace_id", "EBAY_US")
      .in("ebay_item_id", items)
      .order("updated_at", { ascending: false })
      .limit(MAXIMUM_SOURCE_ROWS + 1),
    supabase.from("seller_os_luna_linkage_decisions")
      .select("decision_id,ebay_item_id,ebay_sku,listing_title,linkage_id,luna_product_id,luna_variant_id,luna_sku,components,supplier_quantity_required,evidence_references,evidence_digest,decision,decision_version,decision_at,decision_reference,contract_version,classification,evidence_observed_at")
      .eq("account_key", safeAccount)
      .eq("marketplace_id", "EBAY_US")
      .in("ebay_item_id", items)
      .order("decision_version", { ascending: false })
      .limit(MAXIMUM_SOURCE_ROWS + 1),
  ])
  const limitationCodes: string[] = []
  if (activeRead.error) limitationCodes.push("LUNA_LINKAGE_REGISTRY_READ_FAILED")
  if (manualRead.error) limitationCodes.push(
    "LUNA_LINKAGE_HISTORICAL_MAPPING_READ_FAILED")
  if (decisionRead.error) limitationCodes.push(
    "LUNA_LINKAGE_DURABLE_DECISION_READ_UNAVAILABLE")
  const activeRows = activeRead.error ? []
    : (activeRead.data ?? []) as ActiveListingLinkRow[]
  const manualRows = manualRead.error ? []
    : (manualRead.data ?? []) as ManualListingLinkRow[]
  const decisionRows = decisionRead.error ? []
    : (decisionRead.data ?? []) as DurableLinkageDecisionRow[]
  const productIds = [...new Set([...activeRows, ...manualRows]
    .map((row) => text(row.market_radar_product_id, 100))
    .filter((value): value is string => Boolean(value)))]

  let variants: LunaVariantRow[] = []
  let variantReadAvailable = true
  if (productIds.length) {
    const internalIds = productIds.filter((value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value))
    const externalIds = productIds.filter((value) => /^\d{1,30}$/.test(value))
    const reads = await Promise.all([
      ...(internalIds.length ? [supabase.from("market_radar_latest_variants")
        .select("product_id,supplier_product_id,product_url,title,snapshot_id,supplier_variant_id,variant_title,sku,captured_at")
        .eq("source_key", "lunaportex")
        .in("product_id", internalIds)
        .limit(MAXIMUM_SOURCE_ROWS + 1)] : []),
      ...(externalIds.length ? [supabase.from("market_radar_latest_variants")
        .select("product_id,supplier_product_id,product_url,title,snapshot_id,supplier_variant_id,variant_title,sku,captured_at")
        .eq("source_key", "lunaportex")
        .in("supplier_product_id", externalIds)
        .limit(MAXIMUM_SOURCE_ROWS + 1)] : []),
    ])
    if (!reads.length || reads.some((read) => read.error)) {
      variantReadAvailable = false
      limitationCodes.push("LUNA_CURRENT_VARIANT_IDENTITY_READ_FAILED")
    } else {
      variants = [...new Map(reads.flatMap((read) =>
        (read.data ?? []) as LunaVariantRow[]).map((row) => [
          JSON.stringify([row.product_id, row.supplier_product_id,
            row.supplier_variant_id, row.sku, row.snapshot_id]), row,
        ])).values()]
    }
  }

  const approvalEvidence: SellerOsLunaSupplierApprovalEvidenceV1[] = []
  const candidateEvidence: SellerOsLunaSupplierCandidateEvidenceV1[] = []
  const decisionEvidence: NonNullable<
    SellerOsLunaSupplierLinkageRepositoryEvidenceV1["decisionEvidence"]>[number][] = []
  for (const row of activeRows.slice(0, MAXIMUM_SOURCE_ROWS)) {
    const approval = readLunaWatcherHumanApprovalContractV1({
      rawPayload: row.raw_payload,
      ebayItemId: row.ebay_item_id,
      supplierVariantId: row.supplier_variant_id,
      supplierSku: row.supplier_sku,
    })
    const exact = currentVariantByExactIdentity(variants, {
      productId: row.market_radar_product_id,
      variantId: row.supplier_variant_id,
      sku: row.supplier_sku,
    })
    if (approval) {
      const externalIdentityMatched = exact &&
        exact.supplier_product_id === approval.supplierProductId
      approvalEvidence.push(Object.freeze({
        ebayItemId: approval.ebayItemId,
        lunaProductId: approval.supplierProductId,
        lunaVariantId: approval.supplierVariantId,
        lunaSku: approval.supplierSku,
        approvedAt: approval.approvedAt,
        approvalProvenance: approval.approvalProvenance,
        decisionReference: reference("luna-approval", row.id),
        sourceUpdatedAt: timestamp(exact?.captured_at),
        variantPresence: !variantReadAvailable ? "UNPROVEN" as const
          : externalIdentityMatched ? "PRESENT" as const : "MISSING" as const,
        productTitle: externalIdentityMatched ? text(exact?.title) : null,
        variantTitle: externalIdentityMatched
          ? text(exact?.variant_title) : null,
        evidenceReferences: Object.freeze([
          reference("ebay-active-listing", row.id),
          ...(externalIdentityMatched
            ? [reference("luna-current-variant", exact.snapshot_id)] : []),
        ]),
      }))
    }
    const candidate = candidateFromIdentity({
      ebayItemId: row.ebay_item_id,
      internalMarketRadarProductId: row.market_radar_product_id,
      variantId: row.supplier_variant_id,
      sku: row.supplier_sku,
      observedAt: row.updated_at,
      evidenceReference: reference("ebay-active-listing", row.id),
      historicalApprovedRelationship: false,
      variants,
      variantReadAvailable,
    })
    if (candidate) candidateEvidence.push(candidate)
  }
  for (const row of manualRows.slice(0, MAXIMUM_SOURCE_ROWS)) {
    const candidate = candidateFromIdentity({
      ebayItemId: row.ebay_item_id,
      internalMarketRadarProductId: row.market_radar_product_id,
      variantId: row.supplier_variant_id,
      sku: row.supplier_sku,
      observedAt: row.last_verification_at ?? row.updated_at,
      evidenceReference: reference("historical-manual-link", row.id),
      historicalApprovedRelationship: row.verification_status === "verified",
      variants,
      variantReadAvailable,
    })
    if (candidate) candidateEvidence.push(candidate)
  }
  const latestDecisionByItem = new Map<string, DurableLinkageDecisionRow>()
  for (const row of decisionRows.slice(0, MAXIMUM_SOURCE_ROWS)) {
    if (!latestDecisionByItem.has(row.ebay_item_id)) {
      latestDecisionByItem.set(row.ebay_item_id, row)
    }
  }
  for (const row of latestDecisionByItem.values()) {
    const status = durableDecisionStatus(row.decision)
    const decidedAt = timestamp(row.decision_at)
    const decisionReference = text(row.decision_reference, 240)
    const evidenceDigest = text(row.evidence_digest, 120)
    if (!status || !decidedAt || !decisionReference || !evidenceDigest ||
        !Number.isSafeInteger(row.decision_version) ||
        row.decision_version < 1) continue
    decisionEvidence.push(Object.freeze({
      ebayItemId: row.ebay_item_id,
      status,
      decidedAt,
      decisionReference,
      version: String(row.decision_version),
      evidenceDigest,
    }))
    const candidate = candidateFromDurableDecision(row)
    if (candidate) candidateEvidence.push(candidate)
  }

  const truncated = activeRows.length > MAXIMUM_SOURCE_ROWS ||
    manualRows.length > MAXIMUM_SOURCE_ROWS ||
    decisionRows.length > MAXIMUM_SOURCE_ROWS ||
    variants.length > MAXIMUM_SOURCE_ROWS ||
    currentItemIds.length > MAXIMUM_CURRENT_ITEMS
  if (truncated) limitationCodes.push("LUNA_LINKAGE_SOURCE_RESULTS_TRUNCATED")
  const rowsRead = Math.min(activeRows.length, MAXIMUM_SOURCE_ROWS) +
    Math.min(manualRows.length, MAXIMUM_SOURCE_ROWS) +
    Math.min(decisionRows.length, MAXIMUM_SOURCE_ROWS) +
    Math.min(variants.length, MAXIMUM_SOURCE_ROWS)
  const allUnavailable = Boolean(activeRead.error && manualRead.error)
  return Object.freeze({
    status: allUnavailable ? "UNAVAILABLE" as const
      : limitationCodes.length ? "PARTIAL" as const : "AVAILABLE" as const,
    observedAt,
    approvalEvidence: Object.freeze(approvalEvidence),
    candidateEvidence: Object.freeze(candidateEvidence),
    decisionEvidence: Object.freeze(decisionEvidence),
    rowsRead,
    truncated,
    limitationCodes: Object.freeze([...new Set(limitationCodes)].sort()),
  })
}

/**
 * Resolves Luna read targets exclusively from the fixed current cohort and
 * server-owned catalog rows. No Luna identity or URL is accepted from the
 * caller. The returned branded targets are intended only for the identity
 * verifier and must never be serialized into an Admin/MCP response.
 */
export async function resolveSellerOsCurrentLunaIdentityTargetsV1(
  supabase: Pick<SupabaseClient, "from">,
  input: Readonly<{
    accountKey: string
    currentCohortId: string
    currentItemIds: readonly string[]
    ebayItemId: string
  }>,
) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).sort().join(",") !== [
        "accountKey", "currentCohortId", "currentItemIds", "ebayItemId",
      ].sort().join(",")) {
    throw new Error("LUNA_IDENTITY_CALLER_INPUT_REJECTED")
  }
  const accountKey = text(input.accountKey, 200)
  const itemIds = [...new Set(input.currentItemIds.filter((itemId) =>
    /^\d{9,19}$/.test(itemId)))].slice(0, MAXIMUM_CURRENT_ITEMS)
  if (!accountKey || !/^\d{9,19}$/.test(input.ebayItemId) ||
      !itemIds.includes(input.ebayItemId)) {
    throw new Error("LUNA_IDENTITY_CURRENT_COHORT_ITEM_REQUIRED")
  }
  const [activeRead, manualRead] = await Promise.all([
    supabase.from("ebay_active_listings")
      .select("id,ebay_item_id,market_radar_product_id,supplier_variant_id,supplier_sku,updated_at")
      .eq("account_key", accountKey)
      .eq("ebay_item_id", input.ebayItemId)
      .order("updated_at", { ascending: false })
      .limit(24),
    supabase.from("ebay_manual_listing_links")
      .select("id,ebay_item_id,market_radar_product_id,supplier_variant_id,supplier_sku,updated_at")
      .eq("account_key", accountKey)
      .eq("marketplace_id", "EBAY_US")
      .eq("ebay_item_id", input.ebayItemId)
      .order("updated_at", { ascending: false })
      .limit(24),
  ])
  if (activeRead.error && manualRead.error) {
    throw new Error("LUNA_IDENTITY_CANDIDATE_SOURCE_UNAVAILABLE")
  }
  const sourceRows = [
    ...((activeRead.error ? [] : activeRead.data ?? []) as ActiveListingLinkRow[]),
    ...((manualRead.error ? [] : manualRead.data ?? []) as ManualListingLinkRow[]),
  ]
  const uniqueSources = [...new Map(sourceRows.flatMap((row) => {
    const internalProductId = text(row.market_radar_product_id, 100)
    const variantId = text(row.supplier_variant_id, 100)
    const sku = text(row.supplier_sku, 120)
    if (!internalProductId || !variantId || !sku) return []
    return [[JSON.stringify([internalProductId, variantId, sku]), Object.freeze({
      internalProductId, variantId, sku,
    })] as const]
  })).values()]
  if (!uniqueSources.length) return Object.freeze([])
  const storedProductIds = [...new Set(uniqueSources.map((row) =>
    row.internalProductId))]
  const internalProductIds = storedProductIds.filter((value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value))
  const externalProductIds = storedProductIds.filter((value) =>
    /^\d{1,30}$/.test(value))
  const variantReads = await Promise.all([
    ...(internalProductIds.length ? [supabase
      .from("market_radar_latest_variants")
      .select("product_id,supplier_product_id,product_url,title,snapshot_id,supplier_variant_id,variant_title,sku,captured_at")
      .eq("source_key", "lunaportex")
      .in("product_id", internalProductIds)
      .limit(MAXIMUM_SOURCE_ROWS + 1)] : []),
    ...(externalProductIds.length ? [supabase
      .from("market_radar_latest_variants")
      .select("product_id,supplier_product_id,product_url,title,snapshot_id,supplier_variant_id,variant_title,sku,captured_at")
      .eq("source_key", "lunaportex")
      .in("supplier_product_id", externalProductIds)
      .limit(MAXIMUM_SOURCE_ROWS + 1)] : []),
  ])
  if (!variantReads.length || variantReads.some((read) => read.error)) {
    throw new Error("LUNA_IDENTITY_CANONICAL_CATALOG_UNAVAILABLE")
  }
  const variants = [...new Map(variantReads.flatMap((read) =>
    (read.data ?? []) as LunaVariantRow[]).map((row) => [
      JSON.stringify([row.product_id, row.supplier_product_id,
        row.supplier_variant_id, row.sku, row.snapshot_id]), row,
    ])).values()]
  const targets = uniqueSources.flatMap((source) => {
    const exact = currentVariantByExactIdentity(variants, {
      productId: source.internalProductId,
      variantId: source.variantId,
      sku: source.sku,
    })
    if (!exact?.product_url) return []
    const subject = [accountKey, "EBAY_US", input.currentCohortId,
      input.ebayItemId, exact.supplier_product_id,
      exact.supplier_variant_id, exact.sku, exact.snapshot_id]
    const hash = createHash("sha256").update(JSON.stringify(subject))
      .digest("hex")
    try {
      return [createSellerOsLunaIdentityVerificationTargetV1({
        currentCohortId: input.currentCohortId,
        candidateId: `luna-linkage-review-candidate-v1:sha256:${hash}`,
        candidateEvidenceDigest: `sha256:${hash}`,
        ebayItemId: input.ebayItemId,
        lunaProductId: exact.supplier_product_id,
        lunaVariantId: exact.supplier_variant_id,
        lunaSku: exact.sku ?? "",
        canonicalSourceUrl: exact.product_url,
      })]
    } catch {
      return []
    }
  })
  return Object.freeze(targets)
}
