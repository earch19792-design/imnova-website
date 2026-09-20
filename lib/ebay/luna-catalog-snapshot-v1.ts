import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import { fetchFreshLunaPortexStructuredCatalogV1 } from "../market-radar-lunaportex"
import { captureLunaExplicitProductFieldsV1 } from "../luna-product-source-fields-v1"
import { calculateEbayUnitEconomics } from "./ebay-unit-economics"
import { buildStructuredProductIdentityV1,
  type StructuredProductIdentityV1 } from
  "./seller-os-structured-product-identity-v1"

export const LUNA_CATALOG_SNAPSHOT_V1 = "LUNA_CATALOG_SNAPSHOT_V1" as const
export const LUNA_CATALOG_SNAPSHOT_IDENTITY_ENGINE_V1 =
  "SELLER_OS_STRUCTURED_PRODUCT_IDENTITY_V1_3" as const
export const LUNA_CATALOG_PREFLIGHT_CONTRACT_VERSION_V1 =
  "LUNA_CATALOG_PREFLIGHT_CONTRACT_V1" as const
export const LUNA_CATALOG_SOURCE_AUTHORITY_V1 =
  "LUNA_SHOPIFY_PRODUCTS_JSON_STRUCTURED_FEED" as const
export const LUNA_CATALOG_SNAPSHOT_MAX_WINDOW_MS = 5 * 60 * 1_000

export const LUNA_CATALOG_PREFLIGHT_STATUSES_V1 = [
  "PREFLIGHT_PASS", "SEMANTIC_IDENTITY_INCOMPLETE",
  "SOURCE_IDENTITY_BLOCKED", "CONTRADICTED",
] as const
export type LunaCatalogPreflightStatusV1 =
  typeof LUNA_CATALOG_PREFLIGHT_STATUSES_V1[number]

export const LUNA_CATALOG_MCP_TOOLS_V1 = Object.freeze([
  ["seller_os_get_luna_catalog_status", "Get Luna catalog snapshot status",
    "Read the latest complete structured Luna catalog snapshot and its bounded freshness and preflight counts."],
  ["seller_os_get_luna_catalog_delta", "Get Luna catalog delta",
    "Read NEW, CHANGED, UNCHANGED, and UNAVAILABLE_REMOVED rows from the latest complete Luna catalog snapshot."],
  ["seller_os_get_luna_preflight", "Get Luna identity preflight",
    "Read deterministic V1.3 identity preflight dispositions for the latest complete Luna snapshot."],
  ["seller_os_get_luna_candidates", "Get Luna catalog candidates",
    "Read only PREFLIGHT_PASS Luna candidates with conservative cost, availability, historical evidence, and economic floors."],
].map(([name, title, description]) => ({ name, title, description,
  annotations: { readOnlyHint: true as const, destructiveHint: false as const,
    openWorldHint: false as const, idempotentHint: true as const },
  securitySchemes: [{ type: "oauth2" as const, scopes: ["seller_os.read"] }],
  sideEffects: false as const })))

type JsonRecord = Record<string, unknown>
type SnapshotRow = JsonRecord & {
  product_id: string
  variant_id: string
  source_fingerprint: string
  preflight_status: LunaCatalogPreflightStatusV1
  preflight_reasons: string[]
  identity_result: JsonRecord
}

type PreviousSnapshot = {
  snapshot_id: string
  snapshot_completed_at: string
  identity_engine_version: string
  preflight_contract_version: string
  rows: SnapshotRow[]
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 500) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim()
  return normalized ? normalized.slice(0, maximum) : null
}

function identifier(value: unknown, maximum = 120) {
  if (typeof value !== "string" && typeof value !== "number") return null
  const normalized = String(value).trim()
  return normalized ? normalized.slice(0, maximum) : null
}

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function money(value: unknown) {
  const parsed = number(value)
  return parsed === null || parsed < 0 ? null : Math.round(parsed * 100) / 100
}

function canonicalUrl(handle: unknown) {
  const value = text(handle, 220)
  return value ? `https://lunaportex.com/products/${encodeURIComponent(value)}` : null
}

function images(value: unknown) {
  const source = Array.isArray(value) ? value : []
  return source.map((item) => text(record(item).src, 1_000) ?? text(item, 1_000))
    .filter((item): item is string => Boolean(item))
}

function sourceHtml(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.replace(/\u0000/g, "").trim()
  return normalized ? normalized.slice(0, 100_000) : null
}

function stableFingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

function variantRows(products: readonly JsonRecord[], observedAt: string,
  previous: PreviousSnapshot | null) {
  const previousByKey = new Map((previous?.rows ?? []).map((row) =>
    [`${row.product_id}:${row.variant_id}`, row]))
  const canReusePreviousPreflight = previous?.identity_engine_version ===
    LUNA_CATALOG_SNAPSHOT_IDENTITY_ENGINE_V1 &&
    previous.preflight_contract_version ===
    LUNA_CATALOG_PREFLIGHT_CONTRACT_VERSION_V1
  return products.flatMap((product) => {
    const productId = identifier(product.id, 80) ?? ""
    const url = canonicalUrl(product.handle)
    if (!productId || !url) return []
    const variants = Array.isArray(product.variants) && product.variants.length
      ? product.variants : [{ id: `manual_product_level:${productId}`,
        title: "Default Title" }]
    const productImages = images(product.images)
    return variants.map((variantValue) => {
      const variant = record(variantValue)
      const variantId = identifier(variant.id, 120) ?? `manual_product_level:${productId}`
      const title = text(product.title, 500) ?? ""
      const sku = text(variant.sku, 160)
      const options = Array.isArray(product.options) ? product.options : []
      const sourceFields = {
        ...captureLunaExplicitProductFieldsV1(product),
        body_html: sourceHtml(product.body_html),
        variant_title: text(variant.title, 220),
        collections: Array.isArray(product.collections) ? product.collections : [],
      }
      const sourceIdentityReasons: string[] = []
      if (!/^\d+$/.test(productId)) sourceIdentityReasons.push("PRODUCT_ID_MISSING_OR_INVALID")
      if (!/^\d+$/.test(variantId)) sourceIdentityReasons.push("VARIANT_ID_MISSING_OR_INVALID")
      if (!sku) sourceIdentityReasons.push("SKU_MISSING")
      const fingerprintPayload = {
        productId, variantId, sku, canonicalUrl: url, title,
        variantTitle: text(variant.title, 220), price: money(variant.price),
        compareAtPrice: money(variant.compare_at_price),
        availability: typeof variant.available === "boolean" ? variant.available : null,
        options, weight: number(variant.grams) ?? number(variant.weight),
        weightUnit: number(variant.grams) !== null ? "g" : text(variant.weight_unit, 20),
        images: productImages, productType: text(product.product_type, 220),
        barcodeGtin: text(variant.barcode, 120), sourceFields,
      }
      const sourceFingerprint = stableFingerprint(fingerprintPayload)
      const previousRow = previousByKey.get(`${productId}:${variantId}`)
      const unchanged = Boolean(canReusePreviousPreflight && previousRow &&
        previousRow.source_fingerprint === sourceFingerprint)
      const identity = unchanged
        ? previousRow!.identity_result as unknown as StructuredProductIdentityV1
        : buildStructuredProductIdentityV1({ title,
            variantTitle: text(variant.title, 220), productType: text(product.product_type, 220) })
      const semanticReasons = unchanged ? previousRow!.preflight_reasons
        : [...identity.insufficiencyReasons]
      const sourceComplete = sourceIdentityReasons.length === 0
      const reasons = sourceComplete ? semanticReasons : sourceIdentityReasons
      const preflightStatus: LunaCatalogPreflightStatusV1 = unchanged
        ? previousRow!.preflight_status
        : sourceComplete ? semanticReasons.length ? "SEMANTIC_IDENTITY_INCOMPLETE" : "PREFLIGHT_PASS"
          : "SOURCE_IDENTITY_BLOCKED"
      return {
        product_id: productId, variant_id: variantId, sku,
        canonical_url: url, title, price: money(variant.price),
        compare_at_price: money(variant.compare_at_price),
        availability: typeof variant.available === "boolean" ? variant.available : null,
        options, weight: number(variant.grams) ?? number(variant.weight),
        weight_unit: number(variant.grams) !== null ? "g" : text(variant.weight_unit, 20),
        images: productImages, product_type: text(product.product_type, 220),
        barcode_gtin: text(variant.barcode, 120), source_fields: sourceFields,
        source_fingerprint: sourceFingerprint, observed_at: observedAt,
        preflight_status: preflightStatus, preflight_reasons: reasons,
        identity_result: identity as unknown as JsonRecord,
      }
    })
  })
}

async function readLatestSnapshot(supabase: SupabaseClient) {
  const latest = await supabase.from("luna_catalog_snapshots_v1")
    .select("snapshot_id,snapshot_completed_at,identity_engine_version,preflight_contract_version")
    .eq("snapshot_status", "COMPLETE")
    .order("snapshot_completed_at", { ascending: false }).limit(1).maybeSingle()
  if (latest.error) throw new Error("LUNA_CATALOG_PREVIOUS_SNAPSHOT_READ_FAILED")
  if (!latest.data) return null
  const rows: SnapshotRow[] = []
  for (let offset = 0; ; offset += 500) {
    const page = await supabase.from("luna_catalog_snapshot_variants_v1")
      .select("*").eq("snapshot_id", latest.data.snapshot_id)
      .order("product_id").order("variant_id").range(offset, offset + 499)
    if (page.error) throw new Error("LUNA_CATALOG_PREVIOUS_ROWS_READ_FAILED")
    rows.push(...(page.data ?? []) as SnapshotRow[])
    if ((page.data ?? []).length < 500) break
  }
  return { ...latest.data, rows } as PreviousSnapshot
}

function applyDelta(current: readonly SnapshotRow[], previous: readonly SnapshotRow[]) {
  const prior = new Map(previous.map((row) => [`${row.product_id}:${row.variant_id}`, row]))
  const seen = new Set<string>()
  const delta: Array<{
    product_id: string
    variant_id: string
    delta_status: "NEW" | "CHANGED" | "UNCHANGED" | "UNAVAILABLE_REMOVED"
    previous_source_fingerprint: string | null
    current_source_fingerprint: string | null
    observed_at: string
  }> = []
  delta.push(...current.map((row) => {
    const key = `${row.product_id}:${row.variant_id}`
    seen.add(key)
    const old = prior.get(key)
    const deltaStatus: "NEW" | "CHANGED" | "UNCHANGED" = !old
      ? "NEW" : old.source_fingerprint === row.source_fingerprint
        ? "UNCHANGED" : "CHANGED"
    return { product_id: row.product_id, variant_id: row.variant_id,
      delta_status: deltaStatus,
      previous_source_fingerprint: old?.source_fingerprint ?? null,
      current_source_fingerprint: row.source_fingerprint,
      observed_at: String(row.observed_at) }
  }))
  for (const old of previous) if (!seen.has(`${old.product_id}:${old.variant_id}`)) {
    delta.push({ product_id: old.product_id, variant_id: old.variant_id,
      delta_status: "UNAVAILABLE_REMOVED", previous_source_fingerprint: old.source_fingerprint,
      current_source_fingerprint: null,
      observed_at: String(current[0]?.observed_at ?? old.observed_at) })
  }
  return delta
}

async function insertBatches(supabase: SupabaseClient, table: string,
  rows: readonly JsonRecord[], size = 100) {
  for (let index = 0; index < rows.length; index += size) {
    const result = await supabase.from(table).insert(rows.slice(index, index + size))
    if (result.error) throw new Error(`LUNA_CATALOG_${table.toUpperCase()}_WRITE_FAILED`)
  }
}

export async function runLunaCatalogSnapshotV1(input: Readonly<{
  supabase: SupabaseClient
}>) {
  const started = new Date()
  const startedAt = started.toISOString()
  const claim = await input.supabase.rpc("start_luna_catalog_snapshot_v1", {
    p_source_key: "lunaportex",
    p_source_authority: LUNA_CATALOG_SOURCE_AUTHORITY_V1,
    p_identity_engine_version: LUNA_CATALOG_SNAPSHOT_IDENTITY_ENGINE_V1,
    p_preflight_contract_version: LUNA_CATALOG_PREFLIGHT_CONTRACT_VERSION_V1,
    p_lease_seconds: 600,
  })
  if (claim.error) throw new Error("LUNA_CATALOG_SNAPSHOT_CREATE_FAILED")
  const claimData = record(claim.data)
  if (claimData.status === "ALREADY_RUNNING") {
    return Object.freeze({ status: "ALREADY_RUNNING" as const,
      snapshotId: identifier(claimData.snapshotId),
      activeStartedAt: claimData.activeStartedAt ?? null,
      leaseExpiresAt: claimData.leaseExpiresAt ?? null,
      safety: { marketplaceWrites: 0, publicationWrites: 0, purchases: 0,
        commercialTraces: 0, eBayResearchCalls: 0, shippingCaptures: 0 } })
  }
  const snapshotId = identifier(claimData.snapshotId, 80)
  if (claimData.status !== "STARTED" || !snapshotId) {
    throw new Error("LUNA_CATALOG_SNAPSHOT_CREATE_FAILED")
  }
  let failureState: "FAILED" | "PARTIAL" | "INCOMPLETE" = "FAILED"
  try {
    const feed = await fetchFreshLunaPortexStructuredCatalogV1()
    const completedAt = new Date().toISOString()
    if (Date.now() - started.getTime() > LUNA_CATALOG_SNAPSHOT_MAX_WINDOW_MS) {
      throw new Error("LUNA_CATALOG_SNAPSHOT_WINDOW_EXCEEDED")
    }
    const rawProducts = feed.products as unknown as JsonRecord[]
    const sourceProductIds = rawProducts.map((product) => identifier(product.id, 80))
    if (sourceProductIds.some((productId) => !productId) ||
      new Set(sourceProductIds).size !== rawProducts.length) {
      throw new Error("LUNA_CATALOG_SOURCE_INCOMPLETE")
    }
    const previous = await readLatestSnapshot(input.supabase)
    const priorByKey = new Map((previous?.rows ?? []).map((row) =>
      [`${row.product_id}:${row.variant_id}`, row]))
    const rawRows = variantRows(rawProducts, completedAt, previous) as SnapshotRow[]
    if (feed.products.length === 0 || rawRows.length === 0) {
      throw new Error("LUNA_CATALOG_SOURCE_EMPTY")
    }
    if (new Set(rawRows.map((row) => row.product_id)).size !== rawProducts.length) {
      throw new Error("LUNA_CATALOG_SOURCE_INCOMPLETE")
    }
    const signatures = new Map<string, string>()
    const rows = rawRows.map((row) => {
      const key = `${row.product_id}:${row.variant_id}`
      const prior = signatures.get(key)
      if (prior && prior !== row.source_fingerprint) {
        return { ...row, preflight_status: "CONTRADICTED" as const,
          preflight_reasons: ["SOURCE_VARIANT_CONTRADICTED"] }
      }
      signatures.set(key, row.source_fingerprint)
      return row
    })
    const effectiveRows = rows.map((row) => {
      const old = priorByKey.get(`${row.product_id}:${row.variant_id}`)
      const reuseAuthorityValid = previous?.identity_engine_version ===
        LUNA_CATALOG_SNAPSHOT_IDENTITY_ENGINE_V1 &&
        previous.preflight_contract_version ===
        LUNA_CATALOG_PREFLIGHT_CONTRACT_VERSION_V1
      if (!reuseAuthorityValid || !old ||
        old.source_fingerprint !== row.source_fingerprint) return row
      return { ...row, preflight_status: old.preflight_status,
        preflight_reasons: old.preflight_reasons,
        identity_result: old.identity_result }
    })
    failureState = "PARTIAL"
    await insertBatches(input.supabase, "luna_catalog_snapshot_variants_v1",
      effectiveRows.map((row) => ({ ...row, snapshot_id: snapshotId })))
    const delta = applyDelta(effectiveRows, previous?.rows ?? [])
    await insertBatches(input.supabase, "luna_catalog_snapshot_delta_v1",
      delta.map((row) => ({ ...row, snapshot_id: snapshotId })))
    const counts = effectiveRows.reduce((acc, row) => {
      acc[row.preflight_status] += 1; return acc
    }, { PREFLIGHT_PASS: 0, SEMANTIC_IDENTITY_INCOMPLETE: 0,
      SOURCE_IDENTITY_BLOCKED: 0, CONTRADICTED: 0 } as Record<string, number>)
    const complete = await input.supabase.rpc("complete_luna_catalog_snapshot_v1", {
      p_snapshot_id: snapshotId,
      p_completed_at: completedAt,
      p_expected_product_count: new Set(effectiveRows.map((row) => row.product_id)).size,
      p_expected_variant_count: effectiveRows.length,
      p_expected_delta_count: delta.length,
      p_preflight_counts: counts,
    })
    if (complete.error) throw new Error("LUNA_CATALOG_SNAPSHOT_COMPLETE_WRITE_FAILED")
    return Object.freeze({ status: "COMPLETE" as const, snapshotId, snapshotStartedAt: startedAt,
      snapshotCompletedAt: completedAt, sourceAuthority: feed.sourceAuthority,
      sourceProductCount: new Set(effectiveRows.map((row) => row.product_id)).size,
      sourceVariantCount: effectiveRows.length, delta: {
        new: delta.filter((row) => row.delta_status === "NEW").length,
        changed: delta.filter((row) => row.delta_status === "CHANGED").length,
        unchanged: delta.filter((row) => row.delta_status === "UNCHANGED").length,
        unavailableRemoved: delta.filter((row) => row.delta_status === "UNAVAILABLE_REMOVED").length,
      }, preflight: counts, reusedPreflightCount: effectiveRows.filter((row) =>
        priorByKey.has(`${row.product_id}:${row.variant_id}`) &&
        previous?.identity_engine_version === LUNA_CATALOG_SNAPSHOT_IDENTITY_ENGINE_V1 &&
        previous.preflight_contract_version === LUNA_CATALOG_PREFLIGHT_CONTRACT_VERSION_V1 &&
        priorByKey.get(`${row.product_id}:${row.variant_id}`)?.source_fingerprint === row.source_fingerprint).length,
      safety: { marketplaceWrites: 0, publicationWrites: 0, purchases: 0,
        commercialTraces: 0, eBayResearchCalls: 0, shippingCaptures: 0 } })
  } catch (error) {
    const errorCode = error instanceof Error &&
      /^[A-Z][A-Z0-9_]{2,119}$/.test(error.message) ? error.message : "SNAPSHOT_FAILED"
    if (errorCode === "LUNA_CATALOG_SOURCE_EMPTY" ||
      errorCode === "LUNA_CATALOG_SOURCE_INCOMPLETE") failureState = "INCOMPLETE"
    await input.supabase.rpc("fail_luna_catalog_snapshot_v1", {
      p_snapshot_id: snapshotId, p_failure_state: failureState,
      p_error_code: errorCode,
    })
    throw error
  }
}

async function latestSnapshotId(supabase: SupabaseClient) {
  const result = await supabase.from("luna_catalog_snapshots_v1")
    .select("snapshot_id,snapshot_completed_at,source_product_count,source_variant_count,preflight_pass_count,semantic_identity_incomplete_count,source_identity_blocked_count,contradicted_count,identity_engine_version")
    .eq("snapshot_status", "COMPLETE").order("snapshot_completed_at", { ascending: false })
    .limit(1).maybeSingle()
  if (result.error) throw new Error("LUNA_CATALOG_STATUS_READ_FAILED")
  return result.data
}

export async function getLunaCatalogStatusV1(supabase: SupabaseClient) {
  const latest = await latestSnapshotId(supabase)
  return Object.freeze({ contractVersion: LUNA_CATALOG_SNAPSHOT_V1,
    status: latest ? "AVAILABLE" : "UNAVAILABLE", latestSnapshot: latest,
    source: { authority: LUNA_CATALOG_SOURCE_AUTHORITY_V1,
      barcodeGtinLimitation: "SOURCE_FIELD_NOT_EXPOSED_DO_NOT_CONCLUDE_CATALOG_WIDE_ABSENCE" },
    safety: { readOnly: true, marketplaceWrites: 0, publicationWrites: 0,
      purchases: 0, researchCalls: 0, shippingCaptures: 0 } })
}

export async function getLunaCatalogDeltaV1(supabase: SupabaseClient,
  limit = 100) {
  const latest = await latestSnapshotId(supabase)
  if (!latest) return { status: "UNAVAILABLE", rows: [], snapshot: null }
  const rows = await supabase.from("luna_catalog_snapshot_delta_v1")
    .select("product_id,variant_id,delta_status,previous_source_fingerprint,current_source_fingerprint,observed_at")
    .eq("snapshot_id", latest.snapshot_id).order("delta_status").order("product_id")
    .limit(Math.min(500, Math.max(1, limit)))
  if (rows.error) throw new Error("LUNA_CATALOG_DELTA_READ_FAILED")
  return { status: "AVAILABLE", snapshot: latest, rows: rows.data ?? [],
    safety: { readOnly: true, marketplaceWrites: 0, publicationWrites: 0 } }
}

export async function getLunaCatalogPreflightV1(supabase: SupabaseClient,
  input: Readonly<{ status?: LunaCatalogPreflightStatusV1; limit?: number }> = {}) {
  const latest = await latestSnapshotId(supabase)
  if (!latest) return { status: "UNAVAILABLE", snapshot: null, rows: [] }
  let query = supabase.from("luna_catalog_snapshot_variants_v1").select(
    "product_id,variant_id,sku,canonical_url,title,preflight_status,preflight_reasons,identity_result,source_fingerprint,observed_at")
    .eq("snapshot_id", latest.snapshot_id).order("product_id").order("variant_id")
  if (input.status) query = query.eq("preflight_status", input.status)
  const rows = await query.limit(Math.min(500, Math.max(1, input.limit ?? 100)))
  if (rows.error) throw new Error("LUNA_CATALOG_PREFLIGHT_READ_FAILED")
  return { status: "AVAILABLE", snapshot: latest, rows: rows.data ?? [],
    safety: { readOnly: true, marketplaceWrites: 0, publicationWrites: 0 } }
}

export async function getLunaCatalogCandidatesV1(supabase: SupabaseClient,
  limit = 50) {
  const latest = await latestSnapshotId(supabase)
  if (!latest) return { status: "UNAVAILABLE", candidates: [], snapshot: null }
  const read = await supabase.from("luna_catalog_snapshot_variants_v1")
    .select("product_id,variant_id,sku,canonical_url,title,price,availability,weight,weight_unit,images,product_type,source_fingerprint,observed_at,identity_result")
    .eq("snapshot_id", latest.snapshot_id).eq("preflight_status", "PREFLIGHT_PASS")
    .order("product_id").order("variant_id").limit(Math.min(100, Math.max(1, limit)))
  if (read.error) throw new Error("LUNA_CATALOG_CANDIDATES_READ_FAILED")
  const rows = (read.data ?? []) as JsonRecord[]
  const productIds = [...new Set(rows.map((row) => String(row.product_id)))]
  const variants = [...new Set(rows.map((row) => String(row.variant_id)))]
  const [opportunities, shipping] = await Promise.all([
    productIds.length ? supabase.from("ebay_luna_opportunity_queue").select(
      "supplier_product_id,supplier_variant_id,supplier_sku,queue_status,decision,opportunity_score,demand_evidence_class,sold_exact_units,sold_exact_seller_count,sold_exact_comparable_count,sold_evidence_reviewed,exact_identity,median_total_buyer_price,supplier_price,supplier_available,supplier_snapshot_at,demand_validation_passed,dashboard_minimum_market_test_ready").in("supplier_product_id", productIds).limit(500) : Promise.resolve({ data: [], error: null }),
    productIds.length ? supabase.from("seller_os_live_listing_shipping_evidence").select(
      "luna_product_id,luna_variant_id,source_sku,shipping_cost,shipping_currency,observed_at,maximum_age_seconds,source_authority,purchase_performed,payment_performed").in("luna_product_id", productIds).in("luna_variant_id", variants).order("observed_at", { ascending: false }).limit(500) : Promise.resolve({ data: [], error: null }),
  ])
  if (opportunities.error) throw new Error("LUNA_CATALOG_CANDIDATE_MARKET_EVIDENCE_READ_FAILED")
  if (shipping.error) throw new Error("LUNA_CATALOG_CANDIDATE_SHIPPING_EVIDENCE_READ_FAILED")
  const opportunityMap = new Map((opportunities.data ?? []).map((row) =>
    [`${row.supplier_product_id}:${row.supplier_variant_id}`, row]))
  const shippingMap = new Map((shipping.data ?? []).map((row) =>
    [`${row.luna_product_id}:${row.luna_variant_id}`, row]))
  const candidates = rows.map((row) => {
    const key = `${row.product_id}:${row.variant_id}`
    const opportunity = opportunityMap.get(key) ?? null
    const shippingEvidence = shippingMap.get(key) ?? null
    const supplierCost = money(row.price)
    const marketPrice = money(opportunity?.median_total_buyer_price)
    const exactShipping = money(shippingEvidence?.shipping_cost)
    const landedCost = supplierCost !== null && exactShipping !== null
      ? Math.round((supplierCost + exactShipping) * 100) / 100 : null
    const economics = marketPrice !== null && supplierCost !== null
      ? calculateEbayUnitEconomics({ salePrice: marketPrice, supplierCost },
          exactShipping === null ? {} : { estimatedOutboundShipping: exactShipping })
      : null
    const evidenceSufficient = Boolean(opportunity?.demand_validation_passed === true &&
      opportunity?.exact_identity === true && Number(opportunity?.sold_exact_units ?? 0) >= 3)
    return { productId: row.product_id, variantId: row.variant_id, sku: row.sku,
      canonicalUrl: row.canonical_url, title: row.title, price: supplierCost,
      availability: row.availability, quantity: { status: "UNPROVEN", value: null },
      freshness: { observedAt: row.observed_at, sourceFingerprint: row.source_fingerprint,
        snapshotId: latest.snapshot_id }, shipping: { historicalOrFresh: shippingEvidence,
          status: shippingEvidence ? "EVIDENCE_AVAILABLE" : "UNPROVEN" },
      landedCost: { value: landedCost, status: landedCost === null ? "UNPROVEN" : "DEMONSTRATED" },
      economicFloors: economics, historicalCommercialEvidence: opportunity,
      priority: opportunity ? "PRE_SCREEN_PRIORITY" : "NOT_PRIORITIZED",
      opportunityStatus: evidenceSufficient
        ? "COMMERCIAL_TRACE_APPROVED_OPPORTUNITY" : "PRE_SCREEN_ONLY",
      safety: { readOnly: true, marketplaceWrites: 0, publicationWrites: 0,
        purchases: 0, eBayResearchCalls: 0, shippingCaptures: 0 } }
  })
  return { status: "AVAILABLE", snapshot: latest, candidates,
    safety: { readOnly: true, marketplaceWrites: 0, publicationWrites: 0,
      purchases: 0, eBayResearchCalls: 0, shippingCaptures: 0 } }
}
