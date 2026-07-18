import type { SupabaseClient } from "@supabase/supabase-js"

import {
  getEbayTaxonomyListingIntelligence,
  runEbaySellerKeywordDemandValidation,
  searchEbayCatalogIdentity,
} from "./ebay-seller-keyword-demand-gateway"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { productIdentityReconciliationBoundary } from "./ebay-product-research-identity-reconciliation.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { readEbayTradingItemIdentityReadonly } from "./ebay-trading-item-identity-readonly.ts"
import {
  PRODUCT_FACTS_RESOLVER_VERSION,
  PRODUCT_FACTS_SCHEMA_VERSION,
  buildOpenAiFactsInputPackage,
  calculateReadiness,
  createShippingEstimate,
  deriveOfferPackFacts,
  factObservationKey,
  mapTaxonomyRequirements,
  normalizeGtin,
  productFactsHash,
  resolveProductFacts,
  safeSourceReference,
  targetedFactException,
  type FactObservation,
  type FactScope,
  type FactSourceType,
  type FactVerificationStatus,
  type ResolvedFact,
} from "./ebay-product-facts-readiness"
import { getEbayReadonlyRateLimitMetadata } from "./ebay-readonly-rate-limit"

export const PRODUCT_FACTS_ENGINE_VERSION = "PRODUCT_FACTS_ENGINE_V1_2026_07_17"
const MARKETPLACE = "EBAY_US"
const MAX_CANDIDATES = 20
type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}
function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum) : ""
}
function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function integer(value: unknown) {
  const parsed = number(value)
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}
function array(value: unknown) { return Array.isArray(value) ? value : [] }
function safeCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_:-]+$/.test(value) ? value : "REQUEST_FAILED"
}
function safeFactValue(value: unknown): string | number | boolean | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return null
  const sanitized = text(value)
  return /(https?:\/\/|data:image|base64|<html|(?:cookie|authorization|password|api[_ -]?token)\s*[:=])/i.test(sanitized)
    ? null : sanitized || null
}
function unitCountFromText(value: unknown) {
  const match = text(value).match(/\b(\d{1,4})\s*(?:ct|count|capsules?|tablets?|pieces?|pcs?)\b/i)
  return integer(match?.[1])
}
function packCountFromText(value: unknown) {
  const match = text(value).match(/\b(?:pack|set|lot|case)\s+(?:of\s+)?(\d{1,3})\b/i) ??
    text(value).match(/\b(\d{1,3})\s*(?:pack|pk)\b/i)
  return integer(match?.[1])
}
function fromMetadata(metadata: JsonRecord, keys: string[]) {
  for (const entry of keys) if (metadata[entry] !== undefined && metadata[entry] !== null && metadata[entry] !== "") return metadata[entry]
  return null
}
function factKeyValue(facts: ResolvedFact[], scope: FactScope, factKey: string) {
  return facts.find((fact) => fact.factScope === scope && fact.factKey === factKey)?.selectedValue ?? null
}
function observation(input: {
  candidateId: string; lunaVariantId: string | null; scope: FactScope; key: string; value: unknown; unit?: string | null
  sourceType?: FactSourceType; authority?: FactObservation["sourceAuthority"]; status?: FactVerificationStatus; confidence?: number
  observedAt: string; sourceReference: string; adapterVersion?: string
}): FactObservation {
  const sanitizedValue = safeFactValue(input.value)
  const entry: FactObservation = {
    candidateId: input.candidateId, lunaVariantId: input.lunaVariantId, factScope: input.scope, factKey: input.key,
    rawValue: sanitizedValue, normalizedValue: sanitizedValue, normalizedUnit: input.unit ?? null,
    sourceType: input.sourceType ?? "LUNA_EXACT_VARIANT", sourceReference: input.sourceReference,
    sourceAuthority: input.authority ?? "SUPPLIER", sourceObservedAt: input.observedAt, fetchedAt: new Date().toISOString(),
    expiresAt: null, confidence: sanitizedValue === null && input.value !== null && input.value !== undefined ? 0 : input.confidence ?? .82,
    verificationStatus: sanitizedValue === null && input.value !== null && input.value !== undefined ? "REJECTED" : input.status ?? "VERIFIED",
    adapterVersion: input.adapterVersion ?? PRODUCT_FACTS_ENGINE_VERSION,
  }
  entry.evidenceHash = factObservationKey(entry)
  return entry
}

function lunaObservations(input: { candidateId: string; lunaVariantId: string | null; variant: JsonRecord; item: JsonRecord; now: Date }) {
  const metadata = record(input.variant.metadata)
  const snapshot = record(input.item.evidence_snapshot)
  const pack = record(record(snapshot.packStrategy).recommendedPack)
  const title = text(input.variant.title) || text(record(snapshot.product).name)
  const variantTitle = text(input.variant.variant_title)
  const observedAt = text(input.variant.captured_at) || input.now.toISOString()
  const sourceReference = safeSourceReference("LUNA_EXACT_VARIANT", `${input.variant.product_id}:${input.lunaVariantId ?? ""}:${input.variant.snapshot_id ?? ""}`)
  const entries: FactObservation[] = []
  const add = (scope: FactScope, key: string, value: unknown, unit?: string | null, status: FactVerificationStatus = "VERIFIED") => {
    if (value === null || value === undefined || value === "") return
    entries.push(observation({ candidateId: input.candidateId, lunaVariantId: input.lunaVariantId, scope, key, value,
      unit, status, observedAt, sourceReference }))
  }
  add("PRODUCT_UNIT", "exactProductName", title)
  add("PRODUCT_UNIT", "brand", fromMetadata(metadata, ["brand", "manufacturerBrand"]) ?? input.variant.vendor)
  add("PRODUCT_UNIT", "manufacturer", fromMetadata(metadata, ["manufacturer", "brand"]) ?? input.variant.vendor)
  const barcode = normalizeGtin(input.variant.barcode ?? fromMetadata(metadata, ["upc", "ean", "gtin", "barcode"]))
  if (barcode) add("PRODUCT_UNIT", "gtin", barcode)
  add("PRODUCT_UNIT", "upc", normalizeGtin(fromMetadata(metadata, ["upc"])) ?? null)
  add("PRODUCT_UNIT", "ean", normalizeGtin(fromMetadata(metadata, ["ean"])) ?? null)
  add("PRODUCT_UNIT", "mpn", fromMetadata(metadata, ["mpn", "manufacturerPartNumber", "manufacturer_part_number"]))
  add("PRODUCT_UNIT", "model", fromMetadata(metadata, ["model"]))
  add("PRODUCT_UNIT", "variant", fromMetadata(metadata, ["variant"]) ?? variantTitle)
  add("PRODUCT_UNIT", "scent", fromMetadata(metadata, ["scent", "fragrance"]))
  add("PRODUCT_UNIT", "flavor", fromMetadata(metadata, ["flavor"]))
  add("PRODUCT_UNIT", "color", fromMetadata(metadata, ["color", "colour"]))
  add("PRODUCT_UNIT", "formulation", fromMetadata(metadata, ["formulation", "form"]))
  add("PRODUCT_UNIT", "material", fromMetadata(metadata, ["material"]))
  add("PRODUCT_UNIT", "unitCount", integer(fromMetadata(metadata, ["unitCount", "unit_count", "count"])) ?? unitCountFromText(title), "count")
  add("PRODUCT_UNIT", "netContent", fromMetadata(metadata, ["netContent", "net_content", "size"]))
  add("PRODUCT_UNIT", "condition", fromMetadata(metadata, ["condition"]) ?? "New")
  add("PRODUCT_UNIT", "ingredients", fromMetadata(metadata, ["ingredients"]), null, "CORROBORATED")
  add("PRODUCT_UNIT", "warnings", fromMetadata(metadata, ["warnings", "warning"]), null, "CORROBORATED")
  add("PRODUCT_UNIT", "directions", fromMetadata(metadata, ["directions", "instructions"]), null, "CORROBORATED")
  add("PRODUCT_UNIT", "hazardousMaterialStatus", fromMetadata(metadata, ["hazardousMaterialStatus", "hazmat", "hazardous_material_status"]), null, "CORROBORATED")
  add("PRODUCT_UNIT", "regulatoryIdentifiers", fromMetadata(metadata, ["epaRegistration", "epa_registration", "regulatoryIdentifiers"]), null, "CORROBORATED")
  add("PRODUCT_UNIT", "unitGrossWeight", number(input.variant.weight), text(input.variant.weight_unit) || null)
  const offerCount = integer(pack.packCount) ?? integer(input.item.recommended_pack_count) ?? packCountFromText(title)
  if (offerCount) {
    entries.push(observation({ candidateId: input.candidateId, lunaVariantId: input.lunaVariantId, scope: "OFFER_PACK", key: "offerPackCount",
      value: offerCount, unit: "count", sourceType: "INTERNAL_DERIVATION", authority: "INTERNAL", status: "DERIVED_VERIFIED",
      confidence: .8, observedAt, sourceReference: safeSourceReference("INTERNAL_DERIVATION", `${input.candidateId}:offerPack`) }))
    entries.push(observation({ candidateId: input.candidateId, lunaVariantId: input.lunaVariantId, scope: "OFFER_PACK", key: "unitsPerPack",
      value: 1, unit: "count", sourceType: "INTERNAL_DERIVATION", authority: "INTERNAL", status: "DERIVED_VERIFIED",
      confidence: .8, observedAt, sourceReference: safeSourceReference("INTERNAL_DERIVATION", `${input.candidateId}:unitsPerPack`) }))
  }
  return { entries, title, metadata, observedAt, sourceReference }
}

function catalogObservations(input: { candidateId: string; lunaVariantId: string | null; catalog: JsonRecord; observedAt: string }) {
  const product = record(array(input.catalog.products)[0])
  if (!Object.keys(product).length) return [] as FactObservation[]
  const sourceReference = safeSourceReference("EBAY_CATALOG_OFFICIAL_READONLY", text(product.epid) || text(product.title))
  const add = (key: string, value: unknown) => value === null || value === undefined || value === "" ? null : observation({
    candidateId: input.candidateId, lunaVariantId: input.lunaVariantId, scope: "PRODUCT_UNIT", key, value,
    sourceType: "EBAY_CATALOG_OFFICIAL_READONLY", authority: "CORROBORATION", status: "CORROBORATED",
    confidence: .72, observedAt: input.observedAt, sourceReference,
  })
  const aspects = array(product.aspects).map(record)
  const aspect = (names: string[]) => aspects.find((entry) => names.includes(text(entry.name).toLowerCase()))?.values
  return [add("exactProductName", product.title), add("brand", product.brand),
    add("gtin", normalizeGtin(array(product.gtins)[0])), add("mpn", array(product.mpns)[0]),
    add("color", array(aspect(["color", "colour"]))[0]), add("scent", array(aspect(["scent", "fragrance"]))[0])]
    .filter((entry): entry is FactObservation => Boolean(entry))
}

function tradingObservations(input: { candidateId: string; lunaVariantId: string | null; trading: JsonRecord; observedAt: string }) {
  const sourceReference = safeSourceReference("EBAY_TRADING_GET_ITEM_READONLY", text(input.trading.itemId))
  const add = (key: string, value: unknown) => value === null || value === undefined || value === "" ? null : observation({
    candidateId: input.candidateId, lunaVariantId: input.lunaVariantId, scope: "PRODUCT_UNIT", key, value,
    sourceType: "EBAY_TRADING_GET_ITEM_READONLY", authority: "CORROBORATION", status: "CORROBORATED",
    confidence: .68, observedAt: input.observedAt, sourceReference,
  })
  return [add("exactProductName", input.trading.title), add("brand", input.trading.brand), add("manufacturer", input.trading.manufacturer),
    add("gtin", normalizeGtin(input.trading.gtin)), add("mpn", input.trading.mpn), add("model", input.trading.model),
    add("color", input.trading.color), add("scent", input.trading.scent), add("variant", input.trading.variant),
    add("unitCount", input.trading.unitCount), add("condition", input.trading.condition)]
    .filter((entry): entry is FactObservation => Boolean(entry))
}

function regulatedCandidate(variant: JsonRecord, metadata: JsonRecord) {
  const haystack = [variant.product_type, variant.title, variant.variant_title, metadata.regulated, metadata.epaRegistration,
    metadata.hazmat, ...(array(variant.tags))].map((entry) => text(entry)).join(" ").toLowerCase()
  return /\b(epa|pesticide|insecticide|hazmat|aerosol|chemical|medical device|supplement)\b/.test(haystack)
}

async function latestQueueRun(supabase: SupabaseClient, accountKey: string) {
  const { data, error } = await supabase.from("marketplace_listing_approval_queue_runs").select("id")
    .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE).order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error("PRODUCT_FACT_QUEUE_RUN_READ_FAILED")
  return data
}

async function queueRunForCandidateIds(supabase: SupabaseClient, accountKey: string, candidateIds: string[]) {
  const boundedIds = [...new Set(candidateIds)].slice(0, MAX_CANDIDATES)
  const { data: items, error: itemError } = await supabase
    .from("marketplace_listing_approval_queue_items")
    .select("id,run_id")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .in("id", boundedIds)
  if (itemError) throw new Error("PRODUCT_FACT_CANDIDATE_QUEUE_RUN_READ_FAILED")
  if ((items ?? []).length !== boundedIds.length) throw new Error("PRODUCT_FACT_CANDIDATE_QUEUE_RUN_MISSING")
  const runIds = [...new Set((items ?? []).map((item) => text(item.run_id)).filter(Boolean))]
  if (runIds.length !== 1) throw new Error("PRODUCT_FACT_CANDIDATES_CROSS_QUEUE_RUN_BLOCKED")
  const { data: run, error: runError } = await supabase
    .from("marketplace_listing_approval_queue_runs")
    .select("id")
    .eq("id", runIds[0])
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .maybeSingle()
  if (runError) throw new Error("PRODUCT_FACT_CANDIDATE_QUEUE_RUN_READ_FAILED")
  if (!run?.id) throw new Error("PRODUCT_FACT_CANDIDATE_QUEUE_RUN_MISSING")
  return run
}

async function eligibleCandidates(supabase: SupabaseClient, accountKey: string, runId: string, candidateIds?: string[]) {
  let query = supabase.from("marketplace_listing_approval_queue_items")
    .select("id,market_radar_product_id,supplier_variant_id,recommended_pack_count,evidence_snapshot,luna_match_status,cohort,internal_status,pool_rank,rank")
    .eq("run_id", runId).eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
    .eq("luna_match_status", "EXACT_LUNA_MATCH").in("cohort", ["READY_FOR_OPERATOR_APPROVAL", "READY_FOR_OPENAI_APPROVAL"])
  if (candidateIds?.length) query = query.in("id", candidateIds.slice(0, MAX_CANDIDATES))
  const { data, error } = await query.order("pool_rank", { ascending: true, nullsFirst: false }).limit(MAX_CANDIDATES)
  if (error) throw new Error("PRODUCT_FACT_CANDIDATE_READ_FAILED")
  return (data ?? []).map(record)
}

async function variantForCandidate(supabase: SupabaseClient, candidate: JsonRecord) {
  const { data, error } = await supabase.from("market_radar_latest_variants")
    .select("product_id,supplier_variant_id,snapshot_id,sku,barcode,title,variant_title,vendor,product_type,tags,metadata,weight,weight_unit,captured_at")
    .eq("source_key", "lunaportex").eq("product_id", candidate.market_radar_product_id)
    .eq("supplier_variant_id", candidate.supplier_variant_id).maybeSingle()
  if (error) throw new Error("PRODUCT_FACT_LUNA_VARIANT_READ_FAILED")
  return data ? record(data) : null
}

async function officialCapturedItemId(supabase: SupabaseClient, accountKey: string, supplierVariantId: string) {
  const { data, error } = await supabase.from("marketplace_product_research_capture_observations")
    .select("source_listing_id").eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
    .eq("matched_supplier_variant_id", supplierVariantId).eq("match_classification", "EXACT_LUNA_MATCH")
    .not("source_listing_id", "is", null).order("last_sold_date", { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error("PRODUCT_FACT_TRADING_ITEM_LOOKUP_FAILED")
  const itemId = text(data?.source_listing_id)
  return /^\d{9,20}$/.test(itemId) ? itemId : null
}

function snapshot(input: { runId: string; candidateId: string; lunaVariantId: string | null; sourceType: FactSourceType; authority: string; observedAt: string | null; status: string; payload: JsonRecord }) {
  return { fact_run_id: input.runId, queue_item_id: input.candidateId, luna_variant_id: input.lunaVariantId,
    marketplace_account_key: "", marketplace: MARKETPLACE, source_type: input.sourceType,
    source_reference_hash: safeSourceReference(input.sourceType, `${input.candidateId}:${input.sourceType}:${input.observedAt ?? ""}`),
    source_authority: input.authority, source_observed_at: input.observedAt, fetched_at: new Date().toISOString(),
    expires_at: null, snapshot_status: input.status, sanitized_snapshot: input.payload,
    evidence_hash: productFactsHash({ candidateId: input.candidateId, source: input.sourceType, observedAt: input.observedAt, status: input.status, payload: input.payload }),
    adapter_version: PRODUCT_FACTS_ENGINE_VERSION }
}

function persistenceObservation(runId: string, accountKey: string, entry: FactObservation) {
  return { fact_run_id: runId, queue_item_id: entry.candidateId, luna_variant_id: entry.lunaVariantId,
    marketplace_account_key: accountKey, marketplace: MARKETPLACE, fact_scope: entry.factScope, fact_key: entry.factKey,
    raw_value: entry.rawValue === undefined ? null : entry.rawValue, normalized_value: entry.normalizedValue === undefined ? null : entry.normalizedValue,
    normalized_unit: entry.normalizedUnit, source_type: entry.sourceType, source_reference: entry.sourceReference,
    source_authority: entry.sourceAuthority, source_observed_at: entry.sourceObservedAt, fetched_at: entry.fetchedAt,
    expires_at: entry.expiresAt, confidence: entry.confidence, verification_status: entry.verificationStatus,
    evidence_hash: entry.evidenceHash ?? factObservationKey(entry), adapter_version: entry.adapterVersion, derivation: entry.derivation ?? null }
}

async function insertIgnoringDuplicates(supabase: SupabaseClient, table: string, rows: JsonRecord[]) {
  if (!rows.length) return
  const { error } = await supabase.from(table).upsert(rows, { onConflict: table === "marketplace_product_fact_observations"
    ? "queue_item_id,evidence_hash" : table === "marketplace_product_fact_resolutions" ? "queue_item_id,resolution_hash" :
      table === "marketplace_product_fact_conflicts" ? "queue_item_id,conflict_hash" :
        table === "marketplace_product_fact_requirements" ? "queue_item_id,requirement_hash" :
          table === "marketplace_offer_pack_fact_profiles" || table === "marketplace_shipping_package_profiles" ? "queue_item_id,profile_hash" :
            table === "marketplace_product_fact_readiness_events" ? "queue_item_id,event_hash" : "queue_item_id,evidence_hash", ignoreDuplicates: true })
  if (error) throw new Error(`PRODUCT_FACT_${table.toUpperCase()}_PERSIST_FAILED`)
}

export async function runProductFactsEnrichment(input: { supabase: SupabaseClient; accountKey: string; candidateIds?: string[]; now?: Date; environment?: NodeJS.ProcessEnv }) {
  const boundary = productIdentityReconciliationBoundary(input.environment ?? process.env)
  if (!boundary.preview || !boundary.staging || !boundary.branchMatch) throw new Error("PRODUCT_FACTS_PREVIEW_STAGING_REQUIRED")
  const now = input.now ?? new Date()
  // Durable orchestrators keep queue-item IDs across human gates. Resolve the
  // owning run from those IDs instead of silently jumping to a newer queue run.
  const queueRun = input.candidateIds?.length
    ? await queueRunForCandidateIds(input.supabase, input.accountKey, input.candidateIds)
    : await latestQueueRun(input.supabase, input.accountKey)
  if (!queueRun?.id) throw new Error("PRODUCT_FACT_QUEUE_RUN_MISSING")
  const candidates = await eligibleCandidates(input.supabase, input.accountKey, queueRun.id, input.candidateIds)
  const candidateResults: Array<{
    candidateId: string
    status: string
    openAiInputReady: boolean
    reason?: string
    gates?: Record<string, boolean>
    exception?: JsonRecord | null
    factCounts?: JsonRecord
    requirementCounts?: JsonRecord
    resolvedFacts?: Array<{ scope: string; key: string; value: unknown; unit: string | null; status: string }>
    resolvedRequirements?: Array<{ aspectName: string; required: boolean; status: string; selectedValue: string | null; allowedValues: string[] }>
    taxonomy?: { status: string; categoryId: string | null; categoryTreeId: string | null; observedAt: string | null }
    evidenceBinding?: { factRunId: string; currentRunBound: boolean; sourceSnapshotLinks: number;
      observationLinks: number; resolutionLinks: number; requirementLinks: number; readinessEventLinks: number }
  }> = []
  const prepared: Array<{ candidate: JsonRecord; variant: JsonRecord; observations: FactObservation[]; facts: ResolvedFact[]; requirements: ReturnType<typeof mapTaxonomyRequirements>; readiness: ReturnType<typeof calculateReadiness>; exception: ReturnType<typeof targetedFactException>; sourceSnapshots: JsonRecord[]; taxonomy: JsonRecord; sourceAttempts: JsonRecord }> = []
  for (const candidate of candidates) {
    try {
      const variant = await variantForCandidate(input.supabase, candidate)
      if (!variant) { candidateResults.push({ candidateId: text(candidate.id), status: "EXCLUDED_LUNA_VARIANT_MISSING", openAiInputReady: false }); continue }
      const base = lunaObservations({ candidateId: text(candidate.id), lunaVariantId: text(candidate.supplier_variant_id) || null, variant, item: candidate, now })
      const catalog = await searchEbayCatalogIdentity({ query: base.title, gtin: normalizeGtin(variant.barcode),
        mpn: text(fromMetadata(base.metadata, ["mpn", "manufacturerPartNumber"])), categoryId: text(record(record(candidate.evidence_snapshot).product).categoryId) || null })
      const taxonomy = await getEbayTaxonomyListingIntelligence(base.title, text(record(record(candidate.evidence_snapshot).product).categoryId) || undefined)
      const catalogRecord = record(catalog)
      const taxonomyRecord = record(taxonomy)
      const recommendedPack = record(record(candidate.evidence_snapshot).packStrategy).recommendedPack
      const browsePackQuantity = integer(record(recommendedPack).packCount)
      let browseStatus = "SKIPPED"
      let browseComparableCount = 0
      try {
        const browse = record(await runEbaySellerKeywordDemandValidation({ productName: base.title, productTitle: base.title,
          variantTitle: text(variant.variant_title) || null, supplierSku: text(variant.sku) || null,
          categoryId: text(taxonomyRecord.categoryId) || null, gtin: normalizeGtin(variant.barcode),
          brand: text(variant.vendor) || null, mpn: text(fromMetadata(base.metadata, ["mpn", "manufacturerPartNumber"])) || null,
          size: text(fromMetadata(base.metadata, ["size", "netContent"])) || null,
          packQuantity: browsePackQuantity,
          productType: text(variant.product_type) || null }))
        browseStatus = "AVAILABLE"
        browseComparableCount = array(browse.comparableEvidence).length
      } catch (error) {
        if (getEbayReadonlyRateLimitMetadata(error)) throw error
        browseStatus = safeCode(error)
      }
      let trading: JsonRecord | null = null
      let tradingStatus = "NOT_APPLICABLE_ITEM_ID_MISSING"
      const tradingItemId = await officialCapturedItemId(input.supabase, input.accountKey, text(candidate.supplier_variant_id))
      if (tradingItemId) {
        try { trading = record(await readEbayTradingItemIdentityReadonly(tradingItemId)); tradingStatus = "AVAILABLE" }
        catch (error) {
          if (getEbayReadonlyRateLimitMetadata(error)) throw error
          tradingStatus = safeCode(error)
        }
      }
      const sourceSnapshots = [
        snapshot({ runId: "", candidateId: text(candidate.id), lunaVariantId: text(candidate.supplier_variant_id) || null,
          sourceType: "LUNA_EXACT_VARIANT", authority: "SUPPLIER", observedAt: base.observedAt, status: "AVAILABLE",
          payload: { structuredVariant: true, fieldsObserved: base.entries.map((entry) => entry.factKey) } }),
        snapshot({ runId: "", candidateId: text(candidate.id), lunaVariantId: text(candidate.supplier_variant_id) || null,
          sourceType: "EBAY_CATALOG_OFFICIAL_READONLY", authority: "CORROBORATION", observedAt: text(catalogRecord.observedAt) || null,
          status: text(catalogRecord.status) || "REQUEST_FAILED", payload: { productCount: array(catalogRecord.products).length } }),
        snapshot({ runId: "", candidateId: text(candidate.id), lunaVariantId: text(candidate.supplier_variant_id) || null,
          sourceType: "EBAY_TAXONOMY_OFFICIAL_READONLY", authority: "EBAY_TAXONOMY", observedAt: text(taxonomyRecord.observedAt) || null,
          status: text(taxonomyRecord.status) || "REQUEST_FAILED", payload: { categoryId: text(taxonomyRecord.categoryId) || null,
            requiredAspectCount: array(taxonomyRecord.requiredAspects).length } }),
        snapshot({ runId: "", candidateId: text(candidate.id), lunaVariantId: text(candidate.supplier_variant_id) || null,
          sourceType: "EBAY_BROWSE_OFFICIAL_READONLY", authority: "CORROBORATION", observedAt: now.toISOString(), status: browseStatus,
          payload: { comparableCount: browseComparableCount, contentUsedAsCriticalAuthority: false } }),
        snapshot({ runId: "", candidateId: text(candidate.id), lunaVariantId: text(candidate.supplier_variant_id) || null,
          sourceType: "EBAY_TRADING_GET_ITEM_READONLY", authority: "CORROBORATION", observedAt: trading ? text(trading.observedAt) || now.toISOString() : null,
          status: tradingStatus, payload: { validOfficialItemId: Boolean(tradingItemId), contentUsedAsCriticalAuthority: false } }),
        snapshot({ runId: "", candidateId: text(candidate.id), lunaVariantId: text(candidate.supplier_variant_id) || null,
          sourceType: "MANUFACTURER_OFFICIAL_PUBLIC", authority: "MANUFACTURER_OR_LABEL", observedAt: null, status: "NOT_CONFIGURED",
          payload: { allowlistedOfficialDomainConfigured: false, externalPageFetched: false } }),
        snapshot({ runId: "", candidateId: text(candidate.id), lunaVariantId: text(candidate.supplier_variant_id) || null,
          sourceType: "REGULATOR_OFFICIAL", authority: "REGULATOR", observedAt: null, status: "NOT_CONFIGURED",
          payload: { regulatedOnly: true, externalPageFetched: false } }),
      ]
      const initial = [...base.entries, ...catalogObservations({ candidateId: text(candidate.id), lunaVariantId: text(candidate.supplier_variant_id) || null,
        catalog: catalogRecord, observedAt: text(catalogRecord.observedAt) || now.toISOString() }),
      ...(trading ? tradingObservations({ candidateId: text(candidate.id), lunaVariantId: text(candidate.supplier_variant_id) || null,
        trading, observedAt: text(trading.observedAt) || now.toISOString() }) : [])]
      const firstResolution = resolveProductFacts(initial, now)
      const derived = deriveOfferPackFacts({ candidateId: text(candidate.id), lunaVariantId: text(candidate.supplier_variant_id) || null, facts: firstResolution.facts, now })
      const estimate = createShippingEstimate({ candidateId: text(candidate.id), lunaVariantId: text(candidate.supplier_variant_id) || null,
        unitGrossWeight: number(factKeyValue(firstResolution.facts, "PRODUCT_UNIT", "unitGrossWeight")),
        offerPackCount: number(factKeyValue(firstResolution.facts, "OFFER_PACK", "offerPackCount")), now })
      const observations = [...initial, ...derived, ...(estimate ? [estimate.observation] : [])]
      const resolved = resolveProductFacts(observations, now)
      const requiredAspectNames = new Set(array(taxonomyRecord.requiredAspects).map(record)
        .map((aspect) => text(aspect.name).toLocaleLowerCase()).filter(Boolean))
      const taxonomySourceReady = text(taxonomyRecord.status) === "AVAILABLE" && /^\d+$/.test(text(taxonomyRecord.categoryId)) &&
        array(taxonomyRecord.aspects).length > 0
      const taxonomyAspects = taxonomySourceReady ? array(taxonomyRecord.aspects) : []
      const requirements = mapTaxonomyRequirements(taxonomyAspects.map(record).map((aspect) => ({
        name: text(aspect.name), required: aspect.required === true || requiredAspectNames.has(text(aspect.name).toLocaleLowerCase()),
        values: array(aspect.suggestedValues).map((value) => text(value)).filter(Boolean), aspectMode: text(aspect.mode) || null,
      })).filter((aspect) => aspect.name), resolved.facts)
      const readiness = calculateReadiness({ identityExact: candidate.luna_match_status === "EXACT_LUNA_MATCH", facts: resolved.facts,
        requirements, regulated: regulatedCandidate(variant, base.metadata), taxonomySourceReady })
      const exception = targetedFactException({ readiness, requirements })
      prepared.push({ candidate, variant, observations, facts: resolved.facts, requirements, readiness,
        exception, sourceSnapshots, taxonomy: taxonomyRecord,
        sourceAttempts: { catalog: text(catalogRecord.status) || "REQUEST_FAILED", taxonomy: text(taxonomyRecord.status) || "REQUEST_FAILED",
          browse: browseStatus, trading: tradingStatus } })
      const factCounts = resolved.facts.reduce<JsonRecord>((counts, fact) => {
        counts.total = Number(counts.total ?? 0) + 1
        counts[fact.verificationStatus] = Number(counts[fact.verificationStatus] ?? 0) + 1
        return counts
      }, {})
      const requirementCounts = requirements.reduce<JsonRecord>((counts, requirement) => {
        counts.total = Number(counts.total ?? 0) + 1
        counts[requirement.status] = Number(counts[requirement.status] ?? 0) + 1
        return counts
      }, {})
      candidateResults.push({ candidateId: text(candidate.id), status: "PREPARED",
        openAiInputReady: readiness.gates.OPENAI_INPUT_READY, gates: readiness.gates,
        exception: exception ? record(exception) : null, factCounts, requirementCounts,
        resolvedFacts: resolved.facts.filter((fact) => ["VERIFIED", "CORROBORATED", "DERIVED_VERIFIED"].includes(fact.verificationStatus))
          .map((fact) => ({ scope: fact.factScope, key: fact.factKey, value: fact.selectedValue,
            unit: fact.selectedUnit, status: fact.verificationStatus })),
        resolvedRequirements: requirements.map((requirement) => ({ aspectName: requirement.aspectName,
          required: requirement.required, status: requirement.status, selectedValue: requirement.selectedValue,
          allowedValues: requirement.allowedValues })),
        taxonomy: { status: text(taxonomyRecord.status), categoryId: text(taxonomyRecord.categoryId) || null,
          categoryTreeId: text(taxonomyRecord.categoryTreeId) || null, observedAt: text(taxonomyRecord.observedAt) || null } })
    } catch (error) {
      if (getEbayReadonlyRateLimitMetadata(error)) throw error
      candidateResults.push({ candidateId: text(candidate.id), status: "PARTIAL", openAiInputReady: false, reason: safeCode(error) })
    }
  }
  const sourceReads = { lunaExactVariant: prepared.length,
    ebayCatalog: prepared.filter((entry) => ["AVAILABLE", "NO_MATCH"].includes(text(entry.sourceAttempts.catalog))).length,
    ebayTaxonomy: prepared.filter((entry) => text(entry.sourceAttempts.taxonomy) === "AVAILABLE").length,
    ebayBrowse: prepared.filter((entry) => entry.sourceAttempts.browse === "AVAILABLE").length,
    ebayTradingGetItem: prepared.filter((entry) => entry.sourceAttempts.trading === "AVAILABLE").length,
    manufacturerOfficial: 0, regulatorOfficial: 0 }
  const { data: run, error: runError } = await input.supabase.from("marketplace_product_fact_runs").insert({
    queue_run_id: queueRun.id, marketplace_account_key: input.accountKey, marketplace: MARKETPLACE, engine_version: PRODUCT_FACTS_ENGINE_VERSION,
    candidate_limit: MAX_CANDIDATES, candidates_requested: candidates.length, candidates_processed: 0,
    candidates_excluded: 0, source_reads: {}, status: "RUNNING",
    openai_calls: 0, ebay_writes: 0, production_changed: false, started_at: now.toISOString(), completed_at: null,
  }).select("id").single()
  if (runError || !run) throw new Error("PRODUCT_FACT_RUN_PERSIST_FAILED")
  try {
    for (const entry of prepared) {
    const candidateId = text(entry.candidate.id)
    const sourceRows = entry.sourceSnapshots.map((row) => ({ ...row, fact_run_id: run.id, marketplace_account_key: input.accountKey }))
    await insertIgnoringDuplicates(input.supabase, "marketplace_product_fact_source_snapshots", sourceRows)
    const sourceHashes = [...new Set(sourceRows.map((row) => text(record(row).evidence_hash)).filter(Boolean))]
    const { data: persistedSources, error: sourceReadError } = await input.supabase.from("marketplace_product_fact_source_snapshots")
      .select("id,evidence_hash,fact_run_id").eq("queue_item_id", candidateId).in("evidence_hash", sourceHashes)
    if (sourceReadError) throw new Error("PRODUCT_FACT_SOURCE_SNAPSHOT_LOOKUP_FAILED")
    await insertIgnoringDuplicates(input.supabase, "marketplace_product_fact_observations", entry.observations.map((row) => persistenceObservation(run.id, input.accountKey, row)))
    const observationHashes = [...new Set(entry.observations.map((row) => row.evidenceHash ?? factObservationKey(row)))]
    const { data: persisted, error: observationReadError } = await input.supabase.from("marketplace_product_fact_observations")
      .select("id,evidence_hash,fact_run_id").eq("queue_item_id", candidateId).in("evidence_hash", observationHashes)
    if (observationReadError) throw new Error("PRODUCT_FACT_OBSERVATION_LOOKUP_FAILED")
    const ids = new Map((persisted ?? []).map((row) => [row.evidence_hash, row.id] as const))
    const resolutions = entry.facts.map((fact) => ({ fact_run_id: run.id, queue_item_id: candidateId, marketplace_account_key: input.accountKey,
      marketplace: MARKETPLACE, fact_scope: fact.factScope, fact_key: fact.factKey, selected_value: fact.selectedValue,
      selected_unit: fact.selectedUnit, supporting_observation_ids: fact.supportingObservationIds.map((id) => ids.get(id)).filter(Boolean),
      conflicting_observation_ids: fact.conflictingObservationIds.map((id) => ids.get(id)).filter(Boolean), resolution_rule: fact.resolutionRule,
      confidence: fact.confidence, verification_status: fact.verificationStatus, resolved_at: fact.resolvedAt,
      resolver_version: fact.resolverVersion, resolution_hash: productFactsHash({ candidateId, fact: { scope: fact.factScope, key: fact.factKey,
        value: fact.selectedValue, unit: fact.selectedUnit, status: fact.verificationStatus, rule: fact.resolutionRule } }) }))
    await insertIgnoringDuplicates(input.supabase, "marketplace_product_fact_resolutions", resolutions)
    const resolutionHashes = [...new Set(resolutions.map((row) => text(row.resolution_hash)).filter(Boolean))]
    const { data: persistedResolutions, error: resolutionReadError } = await input.supabase.from("marketplace_product_fact_resolutions")
      .select("id,resolution_hash,fact_run_id").eq("queue_item_id", candidateId).in("resolution_hash", resolutionHashes)
    if (resolutionReadError) throw new Error("PRODUCT_FACT_RESOLUTION_LOOKUP_FAILED")
    const conflicts = resolveProductFacts(entry.observations, now).conflicts.map((conflict) => ({ fact_run_id: run.id, queue_item_id: candidateId,
      marketplace_account_key: input.accountKey, marketplace: MARKETPLACE, fact_scope: conflict.factScope, fact_key: conflict.factKey,
      observation_ids: conflict.observationIds.map((id) => ids.get(id)).filter(Boolean), conflicting_value_hashes: conflict.values.map(productFactsHash),
      conflict_status: "CONFLICTED_BLOCKING", detected_at: now.toISOString(), resolver_version: PRODUCT_FACTS_RESOLVER_VERSION,
      conflict_hash: productFactsHash({ candidateId, conflict }) }))
    await insertIgnoringDuplicates(input.supabase, "marketplace_product_fact_conflicts", conflicts)
    const requirementRows = entry.requirements.map((requirement) => ({ fact_run_id: run.id, queue_item_id: candidateId,
      marketplace_account_key: input.accountKey, marketplace: MARKETPLACE, category_tree_id: text(entry.taxonomy.categoryTreeId) || null,
      category_id: text(entry.taxonomy.categoryId) || null, aspect_name: requirement.aspectName, required: requirement.required,
      mapped_fact_key: requirement.mappedFactKey, selected_value: requirement.selectedValue, allowed_values: requirement.allowedValues,
      requirement_status: requirement.status, taxonomy_observed_at: text(entry.taxonomy.observedAt) || null,
      requirement_hash: productFactsHash({ candidateId, requirement }) }))
    await insertIgnoringDuplicates(input.supabase, "marketplace_product_fact_requirements", requirementRows)
    const requirementHashes = [...new Set(requirementRows.map((row) => text(row.requirement_hash)).filter(Boolean))]
    const { data: persistedRequirements, error: requirementReadError } = requirementHashes.length
      ? await input.supabase.from("marketplace_product_fact_requirements").select("id,requirement_hash,fact_run_id")
        .eq("queue_item_id", candidateId).in("requirement_hash", requirementHashes)
      : { data: [], error: null }
    if (requirementReadError) throw new Error("PRODUCT_FACT_REQUIREMENT_LOOKUP_FAILED")
    const offerProfile = { fact_run_id: run.id, queue_item_id: candidateId, marketplace_account_key: input.accountKey, marketplace: MARKETPLACE,
      offer_pack_count: number(factKeyValue(entry.facts, "OFFER_PACK", "offerPackCount")), units_per_pack: number(factKeyValue(entry.facts, "OFFER_PACK", "unitsPerPack")),
      total_unit_count: number(factKeyValue(entry.facts, "OFFER_PACK", "totalUnitCount")), manufacturer_multipack: null, seller_created_multipack: true,
      multipack_gtin: null, unit_gtin_reference: null, pack_labeling_requirements: [],
      profile_status: entry.readiness.gates.OFFER_PACK_READY ? "READY" : entry.readiness.conflicted ? "CONFLICTED" : "MISSING",
      profile_hash: productFactsHash({ candidateId, scope: "OFFER_PACK", facts: entry.facts.filter((fact) => fact.factScope === "OFFER_PACK") }) }
    await insertIgnoringDuplicates(input.supabase, "marketplace_offer_pack_fact_profiles", [offerProfile])
    const shipping = entry.facts.find((fact) => fact.factScope === "SHIPPING_PACKAGE" && fact.factKey === "shippingWeight")
    const shippingProfile = { fact_run_id: run.id, queue_item_id: candidateId, marketplace_account_key: input.accountKey, marketplace: MARKETPLACE,
      package_type: null, shipping_weight: number(shipping?.selectedValue), shipping_weight_unit: shipping?.selectedUnit ?? null,
      shipping_length: null, shipping_width: null, shipping_height: null, dimension_unit: null, dimensional_weight: null,
      packaging_material: null, packaging_allowance: shipping?.verificationStatus === "ESTIMATED_INTERNAL" ? { pounds: .35 } : {},
      fulfillment_source: null, measurement_source: shipping?.verificationStatus === "ESTIMATED_INTERNAL" ? "INTERNAL_ESTIMATE" : null,
      measurement_status: shipping?.verificationStatus === "ESTIMATED_INTERNAL" ? "ESTIMATED_INTERNAL" : entry.readiness.gates.SHIPPING_CONFIRMED ? "ACTUAL_CONFIRMED" : "MISSING",
      estimation_model_version: shipping?.verificationStatus === "ESTIMATED_INTERNAL" ? "SHIPPING_ESTIMATE_V1_2026_07_17" : null,
      assumptions: shipping?.verificationStatus === "ESTIMATED_INTERNAL" ? { publishable: false } : {},
      maximum_error_tolerance_percent: shipping?.verificationStatus === "ESTIMATED_INTERNAL" ? 20 : null,
      profile_hash: productFactsHash({ candidateId, scope: "SHIPPING_PACKAGE", fact: shipping ?? null }) }
    await insertIgnoringDuplicates(input.supabase, "marketplace_shipping_package_profiles", [shippingProfile])
    const blockers = Object.entries(entry.readiness.gates).filter(([, ready]) => !ready).map(([gate]) => `${gate}_NOT_READY`)
    const gateRows = Object.entries(entry.readiness.gates).map(([gate, ready]) => ({ fact_run_id: run.id, queue_item_id: candidateId,
      marketplace_account_key: input.accountKey, marketplace: MARKETPLACE, gate_name: gate, ready, blocking_reason_codes: ready ? [] : blockers,
      exception: ready ? null : entry.exception, resolver_version: PRODUCT_FACTS_RESOLVER_VERSION,
      event_hash: productFactsHash({ candidateId, gate, ready, blockers, exception: ready ? null : entry.exception }), observed_at: now.toISOString(),
      openai_calls: 0, ebay_writes: 0, production_changed: false }))
    await insertIgnoringDuplicates(input.supabase, "marketplace_product_fact_readiness_events", gateRows)
    const readinessEventHashes = [...new Set(gateRows.map((row) => text(row.event_hash)).filter(Boolean))]
    const { data: persistedReadinessEvents, error: readinessEventReadError } = await input.supabase
      .from("marketplace_product_fact_readiness_events").select("id,event_hash,fact_run_id")
      .eq("queue_item_id", candidateId).in("event_hash", readinessEventHashes)
    if (readinessEventReadError) throw new Error("PRODUCT_FACT_READINESS_EVENT_LOOKUP_FAILED")
    if ((persistedSources ?? []).length !== sourceHashes.length || (persisted ?? []).length !== observationHashes.length ||
      (persistedResolutions ?? []).length !== resolutionHashes.length ||
      (persistedRequirements ?? []).length !== requirementHashes.length ||
      (persistedReadinessEvents ?? []).length !== readinessEventHashes.length) {
      throw new Error("PRODUCT_FACT_CURRENT_RUN_EVIDENCE_INCOMPLETE")
    }
    const linkBase = { fact_run_id: run.id, queue_item_id: candidateId,
      marketplace_account_key: input.accountKey, marketplace: MARKETPLACE }
    const evidenceLinks = [
      ...(persistedSources ?? []).map((row) => ({ ...linkBase, artifact_type: "SOURCE_SNAPSHOT",
        source_snapshot_id: row.id, canonical_fact_run_id: row.fact_run_id, artifact_hash: row.evidence_hash })),
      ...(persisted ?? []).map((row) => ({ ...linkBase, artifact_type: "OBSERVATION",
        observation_id: row.id, canonical_fact_run_id: row.fact_run_id, artifact_hash: row.evidence_hash })),
      ...(persistedResolutions ?? []).map((row) => ({ ...linkBase, artifact_type: "RESOLUTION",
        resolution_id: row.id, canonical_fact_run_id: row.fact_run_id, artifact_hash: row.resolution_hash })),
      ...(persistedRequirements ?? []).map((row) => ({ ...linkBase, artifact_type: "REQUIREMENT",
        requirement_id: row.id, canonical_fact_run_id: row.fact_run_id, artifact_hash: row.requirement_hash })),
      ...(persistedReadinessEvents ?? []).map((row) => ({ ...linkBase, artifact_type: "READINESS_EVENT",
        readiness_event_id: row.id, canonical_fact_run_id: row.fact_run_id, artifact_hash: row.event_hash })),
    ]
    const { error: evidenceLinkError } = await input.supabase.from("marketplace_product_fact_run_evidence_links")
      .upsert(evidenceLinks, { onConflict: "fact_run_id,artifact_type,artifact_hash", ignoreDuplicates: true })
    if (evidenceLinkError) throw new Error("PRODUCT_FACT_CURRENT_RUN_EVIDENCE_LINK_FAILED")
    const expectedHashes = [...sourceHashes, ...observationHashes, ...resolutionHashes, ...requirementHashes, ...readinessEventHashes]
    const { data: linkedEvidence, error: linkedEvidenceError } = await input.supabase.from("marketplace_product_fact_run_evidence_links")
      .select("artifact_type,artifact_hash").eq("fact_run_id", run.id).eq("queue_item_id", candidateId)
      .in("artifact_hash", expectedHashes)
    if (linkedEvidenceError) throw new Error("PRODUCT_FACT_CURRENT_RUN_EVIDENCE_LINK_READ_FAILED")
    const linked = (artifactType: string) => new Set((linkedEvidence ?? [])
      .filter((row) => row.artifact_type === artifactType).map((row) => row.artifact_hash))
    const linkedSources = linked("SOURCE_SNAPSHOT")
    const linkedObservations = linked("OBSERVATION")
    const linkedResolutions = linked("RESOLUTION")
    const linkedRequirements = linked("REQUIREMENT")
    const linkedReadinessEvents = linked("READINESS_EVENT")
    const currentRunBound = sourceHashes.every((hash) => linkedSources.has(hash)) &&
      observationHashes.every((hash) => linkedObservations.has(hash)) && resolutionHashes.every((hash) => linkedResolutions.has(hash)) &&
      requirementHashes.every((hash) => linkedRequirements.has(hash)) && readinessEventHashes.every((hash) => linkedReadinessEvents.has(hash))
    if (!currentRunBound) throw new Error("PRODUCT_FACT_CURRENT_RUN_EVIDENCE_INCOMPLETE")
      const candidateResult = candidateResults.find((result) => result.candidateId === candidateId)
      if (candidateResult) candidateResult.evidenceBinding = { factRunId: run.id, currentRunBound,
        sourceSnapshotLinks: linkedSources.size, observationLinks: linkedObservations.size,
        resolutionLinks: linkedResolutions.size, requirementLinks: linkedRequirements.size,
        readinessEventLinks: linkedReadinessEvents.size }
    }
  } catch (error) {
    const candidatesWithCompleteEvidence = candidateResults.filter((result) => result.evidenceBinding?.currentRunBound === true).length
    const { error: failureFinalizeError } = await input.supabase.rpc("finalize_product_fact_run_v1", {
      p_run_id: run.id, p_status: "FAILED", p_candidates_processed: candidatesWithCompleteEvidence,
      p_candidates_excluded: candidates.length - prepared.length, p_source_reads: sourceReads,
      p_completed_at: new Date().toISOString(),
    })
    if (failureFinalizeError) throw new Error("PRODUCT_FACT_RUN_FAILURE_FINALIZATION_FAILED")
    throw error
  }
  const terminalStatus = candidateResults.some((result) => result.status === "PARTIAL") ? "PARTIAL" : "COMPLETED"
  const { error: finalizeError } = await input.supabase.rpc("finalize_product_fact_run_v1", {
    p_run_id: run.id, p_status: terminalStatus, p_candidates_processed: prepared.length,
    p_candidates_excluded: candidates.length - prepared.length, p_source_reads: sourceReads,
    p_completed_at: new Date().toISOString(),
  })
  if (finalizeError) throw new Error("PRODUCT_FACT_RUN_FINALIZATION_FAILED")
  return { runId: run.id, candidatesRequested: candidates.length, candidatesProcessed: prepared.length,
    candidatesExcluded: candidates.length - prepared.length, sourceReads, candidateResults, openAiCalls: 0, ebayWrites: 0,
    productionChanged: false, discoveryRepeated: false }
}

export async function getProductFactsStatus(input: { supabase: SupabaseClient; accountKey: string; candidateIds?: string[] }) {
  const runQuery = input.supabase.from("marketplace_product_fact_runs").select("*").eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", MARKETPLACE).order("created_at", { ascending: false }).limit(1).maybeSingle()
  const { data: run, error: runError } = await runQuery
  if (runError) throw new Error("PRODUCT_FACT_STATUS_RUN_READ_FAILED")
  let readinessQuery = input.supabase.from("marketplace_product_fact_readiness_events")
    .select("queue_item_id,gate_name,ready,blocking_reason_codes,exception,observed_at").eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", MARKETPLACE).order("observed_at", { ascending: false }).limit(2_000)
  if (input.candidateIds?.length) readinessQuery = readinessQuery.in("queue_item_id", input.candidateIds)
  let requirementQuery = input.supabase.from("marketplace_product_fact_requirements").select("queue_item_id,requirement_status")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE).order("created_at", { ascending: false }).limit(3_000)
  let observationQuery = input.supabase.from("marketplace_product_fact_observations").select("queue_item_id,verification_status,fact_scope,source_type,created_at")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", MARKETPLACE).order("created_at", { ascending: false }).limit(5_000)
  if (input.candidateIds?.length) {
    requirementQuery = requirementQuery.in("queue_item_id", input.candidateIds)
    observationQuery = observationQuery.in("queue_item_id", input.candidateIds)
  }
  const [{ data: events, error: eventError }, { data: requirements, error: requirementError }, { data: observations, error: observationError }] = await Promise.all([
    readinessQuery,
    requirementQuery,
    observationQuery,
  ])
  if (eventError || requirementError || observationError) throw new Error("PRODUCT_FACT_STATUS_READ_FAILED")
  const byCandidate: Record<string, JsonRecord> = {}
  for (const row of events ?? []) {
    const candidateId = text(row.queue_item_id)
    if (!candidateId) continue
    const current = byCandidate[candidateId] ?? { gates: {}, exception: null, observedAt: null }
    const gates = record(current.gates)
    if (gates[row.gate_name] === undefined) gates[row.gate_name] = row.ready === true
    current.gates = gates
    if (!current.exception && row.exception) current.exception = row.exception
    current.observedAt = current.observedAt ?? row.observed_at
    byCandidate[candidateId] = current
  }
  for (const row of observations ?? []) {
    const current = byCandidate[text(row.queue_item_id)] ?? { gates: {}, exception: null, observedAt: null }
    const counts = record(current.counts)
    const status = text(row.verification_status) || "MISSING"
    counts.total = Number(counts.total ?? 0) + 1
    counts[status] = Number(counts[status] ?? 0) + 1
    current.counts = counts
    byCandidate[text(row.queue_item_id)] = current
  }
  for (const row of requirements ?? []) {
    const current = byCandidate[text(row.queue_item_id)] ?? { gates: {}, exception: null, observedAt: null }
    const counts = record(current.requirements)
    const status = text(row.requirement_status) || "MISSING_OPTIONAL"
    counts.total = Number(counts.total ?? 0) + 1
    counts[status] = Number(counts[status] ?? 0) + 1
    current.requirements = counts
    byCandidate[text(row.queue_item_id)] = current
  }
  const values = Object.values(byCandidate)
  return { version: PRODUCT_FACTS_SCHEMA_VERSION, latestRun: run ? { id: run.id, status: run.status,
      candidatesRequested: Number(run.candidates_requested ?? 0), candidatesProcessed: Number(run.candidates_processed ?? 0),
      candidatesExcluded: Number(run.candidates_excluded ?? 0), sourceReads: record(run.source_reads), completedAt: run.completed_at } : null,
    byCandidate, coverage: { candidates: values.length, openAiInputReady: values.filter((value) => record(value.gates).OPENAI_INPUT_READY === true).length,
      publicationFactsReady: values.filter((value) => record(value.gates).PUBLICATION_FACTS_READY === true).length },
    safety: { openAiCalls: 0, ebayWrites: 0, productionChanged: false, cookiesStored: false, sourceUrlsStored: false,
      rawPagesStored: false, competitorImagesStored: false, piiStored: false } }
}

export async function productFactsOpenAiReady(supabase: SupabaseClient, accountKey: string, itemId: string) {
  const { data, error } = await supabase.from("marketplace_product_fact_readiness_events")
    .select("ready,observed_at").eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
    .eq("queue_item_id", itemId).eq("gate_name", "OPENAI_INPUT_READY").order("observed_at", { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error("PRODUCT_FACT_OPENAI_GATE_READ_FAILED")
  return data?.ready === true
}

export async function assertProductFactsOpenAiReady(supabase: SupabaseClient, accountKey: string, itemId: string) {
  if (!await productFactsOpenAiReady(supabase, accountKey, itemId)) {
    throw new Error("PRODUCT_FACTS_OPENAI_INPUT_NOT_READY")
  }
}

export function safeOpenAiFactsForCandidate(facts: ResolvedFact[], readiness: ReturnType<typeof calculateReadiness>) {
  return buildOpenAiFactsInputPackage({ facts, readiness })
}
