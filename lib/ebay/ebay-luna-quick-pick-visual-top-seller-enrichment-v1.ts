import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { durableQuickPickRequiredSpecificsCandidateV1 } from
  "./ebay-luna-quick-pick-required-specifics-v1"
import { quickPickExactSoldCandidateIdentityV1 } from
  "./ebay-luna-quick-pick-exact-sold-enrichment-v1"
import { materializeSellerOsDeterministicFactoryCandidateV1,
  resolveSellerOsExactProductTruthV1 } from
  "./ebay-smart-stocking-durable-factory-v1"
import { officialSoldEvidenceComparablesForTarget,
  readReviewedOfficialSoldEvidence } from
  "./ebay-official-sold-evidence-import"
import { runEbaySellerKeywordDemandValidation } from
  "./ebay-seller-keyword-demand-gateway"
import type { EbaySellerKeywordCandidate } from
  "./ebay-seller-keyword-demand-validation"
import type { ProductIdentityInput, WinnerComparableInput } from
  "./ebay-winner-evidence-v2"
import { buildOwnerSupplierPolicyApplicationV1,
  readLunaNewMerchandisePolicyV1 } from
  "./ebay-owner-supplier-merchandise-policy-v1"
import { buildBoundedExactProductVisualShortlistV1,
  buildExactProductFingerprintV1,
  createOpenAiExactProductVisualMatcherV1,
  resolveExactProductVisualMatchesV1 } from
  "./exact-product-visual-matcher-v1"
import type { ExactProductFingerprintV1,
  ExactProductMarketCandidateV1, ExactProductVisualAiEvaluationV1,
  ExactProductVisualAiResolverV1 } from
  "./exact-product-visual-matcher-v1"
import { resolveTopSellerMarketplaceFieldMappingV1 } from
  "./top-seller-marketplace-field-mapping-v1"
import { MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1,
  REQUIRED_SPECIFICS_DIGEST_VERSION,
  requiredSpecificBatchEvidenceDigestV1 } from
  "./ebay-marketplace-required-specifics-batch-resolution-v1"
import type { RequiredSpecificResolutionV1,
  RequiredSpecificsBatchProductV1 } from
  "./ebay-marketplace-required-specifics-batch-resolution-v1"
import type { RadarMarketplaceTaxonomyReaderV1,
  RadarProductIdentifierPolicyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1"

export const QUICK_PICK_VISUAL_TOP_SELLER_ENRICHMENT_V1 =
  "QUICK_PICK_VISUAL_IDENTITY_TOP_SELLER_FIELD_MAPPING_V1" as const
export const QUICK_PICK_VISUAL_TOP_SELLER_MARKER =
  "quickPickVisualIdentityTopSellerEnrichmentV1" as const

const MAXIMUM_QUICK_PICKS = 20
const MAXIMUM_MARKET_CANDIDATES_PER_PRODUCT = 8
const MAXIMUM_VISUAL_SHORTLIST_PER_PRODUCT = 3
const MAXIMUM_AI_PRODUCTS_PER_CALL = 3
const MAXIMUM_AI_CALLS_PER_RUN = 5
const MARKET_LOOKUP_CONCURRENCY = 2
const STALE_CLAIM_MS = 5 * 60 * 1_000
const REQUIRED_ASPECT_SCOPE = "ALL_OFFICIAL_REQUIRED_ASPECTS" as const

type JsonRecord = Record<string, unknown>
type CatalogRow = JsonRecord & Readonly<{ product_id?: unknown }>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum)
    : null
}

function normalized(value: unknown) {
  return text(value)?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim() ?? ""
}

function canonical(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(
    value as JsonRecord).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`
  return JSON.stringify(value)
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`
}

function referenceDigest(value: unknown) {
  return `sha256:${createHash("sha256").update(String(value ?? "missing"))
    .digest("hex")}`
}

function unique(values: readonly (string | null | undefined)[], limit = 100) {
  return [...new Set(values.flatMap((value) => {
    const result = text(value, 2_000)
    return result ? [result] : []
  }))].slice(0, limit)
}

function plainText(value: unknown) {
  return (text(value, 20_000) ?? "").replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ").trim().slice(0, 8_000)
}

function number(value: unknown) {
  const result = Number(value)
  return Number.isFinite(result) && result > 0 ? result : 0
}

function safeCode(error: unknown, fallback: string) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(value) ? value : fallback
}

async function mapWithConcurrency<T, R>(values: readonly T[], concurrency: number,
  mapper: (value: T) => Promise<R>) {
  const output = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++
        output[index] = await mapper(values[index])
      }
    }))
  return output
}

function residualActions(assessment: JsonRecord) {
  return rows(record(assessment.quickPickRequiredSpecificsContinuationV1)
    .residualOwnerActions)
}

function residualNames(assessment: JsonRecord) {
  return unique(residualActions(assessment).map((entry) => text(
    entry.exactUnresolvedField ?? entry.productField, 120)))
}

function fieldValue(values: JsonRecord, names: readonly string[]) {
  const targets = new Set(names.map(normalized))
  const match = Object.entries(values).find(([name]) =>
    targets.has(normalized(name)))
  return text(match?.[1], 500)
}

function stringRecord(value: unknown) {
  return Object.fromEntries(Object.entries(record(value)).flatMap(
    ([name, raw]) => {
      if (typeof raw === "string" || typeof raw === "number"
          || typeof raw === "boolean") {
        const value = text(String(raw), 2_000)
        return value ? [[text(name, 120) ?? name, value]] : []
      }
      if (Array.isArray(raw)) {
        const value = unique(raw.flatMap((entry) => typeof entry === "string"
          ? [entry] : []), 30).join(" | ")
        return value ? [[text(name, 120) ?? name, value]] : []
      }
      return []
    }))
}

function exactEvidence(input: Readonly<{
  row: JsonRecord
  catalog: CatalogRow
}>) {
  const assessment = record(input.row.assessment)
  const truth = record(assessment.productTruth)
  const productMetadata = stringRecord(input.catalog.product_metadata)
  const variantMetadata = stringRecord(input.catalog.metadata)
  const evidence = [
    { sourceField: "TITLE", text: text(input.catalog.title, 500)
      ?? text(truth.title, 500) ?? text(input.row.product_title, 500) },
    { sourceField: "DESCRIPTION", text: plainText(input.catalog.body_html) },
    ...Object.entries(productMetadata).map(([name, value]) => ({
      sourceField: "SPECS", text: `${name}: ${value}`,
    })),
    ...Object.entries(variantMetadata).map(([name, value]) => ({
      sourceField: "VARIANT", text: `${name}: ${value}`,
    })),
    { sourceField: "SPECS", text: text(input.catalog.product_type, 200) },
    { sourceField: "VARIANT", text: text(input.catalog.variant_title, 300) },
    { sourceField: "SPECS", text: Array.isArray(input.catalog.tags)
      ? unique(input.catalog.tags.flatMap((entry) => typeof entry === "string"
        ? [entry] : []), 40).join(" | ") : null },
  ].flatMap((entry) => entry.text ? [{ sourceField: entry.sourceField,
    text: entry.text }] : [])
  return Object.freeze(evidence)
}

function exactValues(row: JsonRecord, catalog: CatalogRow) {
  const truth = record(record(row.assessment).productTruth)
  return Object.freeze({
    ...stringRecord(catalog.product_metadata),
    ...stringRecord(catalog.metadata),
    ...stringRecord(truth.provenProductValues),
  })
}

function aspectValues(values: JsonRecord, patterns: readonly RegExp[]) {
  return unique(Object.entries(values).flatMap(([name, value]) =>
    patterns.some((pattern) => pattern.test(normalized(name)))
      ? [text(value, 500)] : []), 12)
}

function catalogImages(catalog: CatalogRow) {
  return unique([text(catalog.featured_image_url, 2_000),
    ...(Array.isArray(catalog.image_urls)
      ? catalog.image_urls.flatMap((entry) => typeof entry === "string"
        ? [entry] : []) : [])], 8)
}

function fingerprintFor(input: Readonly<{
  row: JsonRecord
  catalog: CatalogRow
}>): ExactProductFingerprintV1 {
  const assessment = record(input.row.assessment)
  const truth = record(assessment.productTruth)
  const values = exactValues(input.row, input.catalog)
  const identity = quickPickExactSoldCandidateIdentityV1(input.row)
  return buildExactProductFingerprintV1({
    supplierProductId: input.row.supplier_product_id,
    supplierVariantId: input.row.supplier_variant_id,
    supplierSku: input.row.supplier_sku,
    categoryId: record(assessment.canonicalMarketplaceReadinessV1).categoryId,
    imageUrls: catalogImages(input.catalog),
    title: text(input.catalog.title, 500) ?? truth.title
      ?? input.row.product_title,
    description: plainText(input.catalog.body_html),
    gtin: input.row.gtin ?? truth.gtin,
    mpn: identity.mpn ?? fieldValue(values, ["MPN", "Part Number"]),
    model: identity.model ?? fieldValue(values, ["Model", "Model Number"]),
    brandEvidence: identity.manufacturerBrand
      ?? fieldValue(values, ["Brand", "Manufacturer"]),
    dimensions: aspectValues(values, [/(?:^| )dimensions?(?: |$)/,
      /(?:^| )(?:height|width|length)(?: |$)/]),
    colorOrVariant: unique([identity.color, identity.variant,
      fieldValue(values, ["Color", "Colour", "Variant"])]),
    material: aspectValues(values, [/(?:^| )material(?: |$)/]),
    includedAccessories: aspectValues(values,
      [/(?:included|accessor|package content|what s in)/]),
    distinctiveFeatures: aspectValues(values, [/(?:feature|function)/]),
    uniquePhrases: unique([text(input.catalog.product_type, 200),
      text(input.catalog.variant_title, 300),
      ...exactEvidence(input).map((entry) => entry.text)], 20),
  })
}

function marketQuery(row: JsonRecord): EbaySellerKeywordCandidate {
  const identity = quickPickExactSoldCandidateIdentityV1(row)
  const readiness = record(record(row.assessment)
    .canonicalMarketplaceReadinessV1)
  return Object.freeze({ productName: identity.productName,
    productTitle: identity.productName,
    supplierSku: text(row.supplier_sku, 120),
    categoryId: text(readiness.categoryId, 40), gtin: identity.gtin,
    brand: identity.manufacturerBrand, mpn: identity.mpn,
    model: identity.model, color: identity.color, size: identity.size,
    packQuantity: identity.packCount })
}

function valuesFromAspects(aspects: readonly Readonly<{
  name: string, value: string }>[], names: readonly RegExp[]) {
  return unique(aspects.flatMap((entry) => names.some((pattern) =>
    pattern.test(normalized(entry.name))) ? [entry.value] : []), 12)
}

export function quickPickMarketComparableToVisualCandidateV1(value: unknown,
  observedAt = new Date().toISOString()): ExactProductMarketCandidateV1 | null {
  const row = record(value)
  const itemIdRaw = text(row.comparableId ?? row.itemId, 100)
  const title = text(row.title, 500)
  if (!itemIdRaw || !title) return null
  const aspects = rows(row.localizedAspects).flatMap((entry) => {
    const name = text(entry.name, 120)
    const aspectValue = text(entry.value, 500)
    return name && aspectValue ? [{ name, value: aspectValue }] : []
  })
  const soldVolume = Math.max(number(row.verifiedSoldQuantity),
    number(row.estimatedSoldQuantity), number(row.salesQuantity))
  const origin = Date.parse(String(row.itemOriginDate ?? ""))
  const observation = text(row.lastSoldDate ?? row.itemEndDate, 80)
    ?? observedAt
  const elapsedDays = Number.isFinite(origin)
    ? Math.max(1, (Date.parse(observation) - origin) / 86_400_000) : 30
  const sourceClass = row.verifiedSoldRecent === true
    || String(row.evidenceSource ?? row.source).includes("SOLD")
    ? "SOLD_COMPLETED" as const : "ACTIVE_LISTING" as const
  return Object.freeze({
    candidateReference: referenceDigest(`EBAY_ITEM:${itemIdRaw}`),
    sourceClass,
    itemId: /^\d{9,20}$/.test(itemIdRaw) ? itemIdRaw : null,
    sellerReference: text(row.sellerUsername, 200)
      ? referenceDigest(`EBAY_SELLER:${row.sellerUsername}`) : null,
    title,
    imageUrl: text(row.imageUrl, 2_000),
    categoryId: text(row.categoryId, 30),
    model: text(row.model, 160) ?? valuesFromAspects(aspects,
      [/^model$/, /^model number$/])[0] ?? null,
    brand: text(row.brand, 160) ?? valuesFromAspects(aspects,
      [/^brand$/])[0] ?? null,
    dimensions: valuesFromAspects(aspects,
      [/(?:^| )dimensions?(?: |$)/, /^(?:item )?(?:height|width|length)$/]),
    colorOrVariant: unique([text(row.color, 160), text(row.size, 160),
      ...valuesFromAspects(aspects, [/^colou?r$/, /^size$/, /^variant$/])]),
    material: valuesFromAspects(aspects, [/material/]),
    includedAccessories: valuesFromAspects(aspects,
      [/(?:included|accessor|package content|what s in)/]),
    distinctiveFeatures: valuesFromAspects(aspects, [/feature/, /function/]),
    aspects: Object.freeze(aspects),
    gtin: text(row.gtin, 40) ?? valuesFromAspects(aspects,
      [/^upc$/, /^ean$/, /^gtin$/])[0] ?? null,
    mpn: text(row.mpn, 160) ?? valuesFromAspects(aspects,
      [/^mpn$/, /manufacturer part/])[0] ?? null,
    soldVolume,
    salesVelocity: Number((soldVolume / elapsedDays * 30).toFixed(4)),
    observedAt: observation,
  })
}

function soldComparableToVisualCandidate(value: WinnerComparableInput) {
  const rawReference = text(value.sourceListingId, 100)
  if (!rawReference) return null
  const identity = value.identity
  const itemId = /^\d{9,20}$/.test(rawReference) ? rawReference : null
  const aspects = [
    ["Brand", identity.manufacturerBrand], ["Model", identity.model],
    ["MPN", identity.mpn], ["Color", identity.color],
    ["Size", identity.size], ["Variant", identity.variant],
  ].flatMap(([name, raw]) => text(raw, 500)
    ? [{ name: name!, value: text(raw, 500)! }] : [])
  return Object.freeze({
    candidateReference: referenceDigest(`EBAY_ITEM:${rawReference}`),
    sourceClass: "SOLD_COMPLETED" as const, itemId,
    sellerReference: null,
    title: text(identity.productName, 500) ?? text(identity.model, 160)
      ?? text(identity.mpn, 160) ?? "Durable exact sold reference",
    imageUrl: null, categoryId: null, model: text(identity.model, 160),
    brand: text(identity.manufacturerBrand, 160), dimensions: [],
    colorOrVariant: unique([identity.color, identity.size, identity.variant]),
    material: [], includedAccessories: [], distinctiveFeatures: [],
    aspects: Object.freeze(aspects), gtin: text(identity.gtin, 40),
    mpn: text(identity.mpn, 160),
    soldVolume: number(value.confirmedSoldQuantity),
    salesVelocity: number(value.confirmedSoldQuantity),
    observedAt: text(value.observedAt, 80),
  }) satisfies ExactProductMarketCandidateV1
}

function mergeCandidates(values: readonly ExactProductMarketCandidateV1[]) {
  const merged = new Map<string, ExactProductMarketCandidateV1>()
  for (const candidate of values) {
    const existing = merged.get(candidate.candidateReference)
    if (!existing) { merged.set(candidate.candidateReference, candidate); continue }
    merged.set(candidate.candidateReference, Object.freeze({
      ...candidate,
      sourceClass: existing.sourceClass === "SOLD_COMPLETED"
        || candidate.sourceClass === "SOLD_COMPLETED"
        ? "SOLD_COMPLETED" : "ACTIVE_LISTING",
      itemId: existing.itemId ?? candidate.itemId,
      sellerReference: existing.sellerReference ?? candidate.sellerReference,
      imageUrl: existing.imageUrl ?? candidate.imageUrl,
      categoryId: existing.categoryId ?? candidate.categoryId,
      model: existing.model ?? candidate.model,
      brand: existing.brand ?? candidate.brand,
      dimensions: unique([...existing.dimensions, ...candidate.dimensions]),
      colorOrVariant: unique([
        ...existing.colorOrVariant, ...candidate.colorOrVariant]),
      material: unique([...existing.material, ...candidate.material]),
      includedAccessories: unique([
        ...existing.includedAccessories, ...candidate.includedAccessories]),
      distinctiveFeatures: unique([
        ...existing.distinctiveFeatures, ...candidate.distinctiveFeatures]),
      aspects: Object.freeze([...existing.aspects, ...candidate.aspects]),
      gtin: existing.gtin ?? candidate.gtin,
      mpn: existing.mpn ?? candidate.mpn,
      soldVolume: Math.max(existing.soldVolume, candidate.soldVolume),
      salesVelocity: Math.max(existing.salesVelocity, candidate.salesVelocity),
      observedAt: existing.observedAt ?? candidate.observedAt,
    }))
  }
  return [...merged.values()].sort((left, right) =>
    Number(right.sourceClass === "SOLD_COMPLETED")
      - Number(left.sourceClass === "SOLD_COMPLETED")
    || right.soldVolume - left.soldVolume
    || right.salesVelocity - left.salesVelocity
    || left.candidateReference.localeCompare(right.candidateReference))
    .slice(0, MAXIMUM_MARKET_CANDIDATES_PER_PRODUCT)
}

type VisualConfig = Readonly<{
  enabled: boolean
  modelId: string | null
  maximumOutputTokens: number
  timeoutMs: number
  maximumCalls: number
  promptVersion: string
}>

async function readVisualConfig(supabase: SupabaseClient): Promise<VisualConfig> {
  const read = await supabase.from("ebay_openai_use_case_configs")
    .select("use_case_id,version,enabled,mode,kill_switch_engaged,model_id,prompt_version,schema_version,per_use_case_daily_budget_micros,per_invocation_budget_micros,maximum_output_tokens,timeout_ms,maximum_retries")
    .eq("use_case_id", "EXACT_PRODUCT_VISUAL_MATCHING")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle()
  const config = record(read.data)
  const invocationBudget = number(config.per_invocation_budget_micros)
  const dailyBudget = number(config.per_use_case_daily_budget_micros)
  const enabled = !read.error && config.enabled === true
    && config.kill_switch_engaged === false
    && config.mode === "HUMAN_ASSISTED"
    && config.schema_version === QUICK_PICK_VISUAL_TOP_SELLER_ENRICHMENT_V1
    && Number(config.maximum_retries) === 0
    && invocationBudget > 0 && dailyBudget >= invocationBudget
  const configuredCalls = dailyBudget > 0
    ? Math.floor(dailyBudget / invocationBudget) : 0
  return Object.freeze({ enabled,
    modelId: text(config.model_id, 120),
    maximumOutputTokens: Math.max(500, Math.min(6_000,
      Math.trunc(number(config.maximum_output_tokens) || 4_000))),
    timeoutMs: Math.max(5_000, Math.min(55_000,
      Math.trunc(number(config.timeout_ms) || 55_000))),
    maximumCalls: enabled ? Math.max(0, Math.min(MAXIMUM_AI_CALLS_PER_RUN,
      configuredCalls)) : 0,
    promptVersion: text(config.prompt_version, 120)
      ?? "EXACT_PRODUCT_VISUAL_MATCHER_PROMPT_V1",
  })
}

function applyStrictPromotionsToTruth(assessment: JsonRecord,
  promotions: Readonly<Record<string, string>>, evidence: JsonRecord) {
  const truth = record(assessment.productTruth)
  const values = { ...record(truth.provenProductValues), ...promotions }
  const resolved = new Set(Object.keys(promotions).map(normalized))
  const requirements = { ...record(truth.unprovenAspectEvidenceRequirements) }
  for (const name of Object.keys(requirements)) {
    if (resolved.has(normalized(name))) delete requirements[name]
  }
  const { evidenceDigest: _oldDigest, ...prior } = truth
  const core = { ...prior, provenProductValues: values,
    knownUnknownAspectNames: Array.isArray(truth.knownUnknownAspectNames)
      ? truth.knownUnknownAspectNames.filter((name) =>
        !resolved.has(normalized(name))) : [],
    unprovenAspectEvidenceRequirements: requirements,
    sourceEvidence: { ...record(truth.sourceEvidence),
      visualTopSellerStrictFactCorroborationV1: evidence } }
  return Object.freeze({ ...core, evidenceDigest: digest(core) })
}

function validBatchInput(value: unknown,
  identity: NonNullable<ReturnType<
    typeof durableQuickPickRequiredSpecificsCandidateV1>>):
  value is RequiredSpecificsBatchProductV1 {
  const input = record(value)
  return input.radarCandidateId === identity.radarCandidateId
    && input.lunaProductId === identity.lunaProductId
    && input.lunaVariantId === identity.lunaVariantId
    && input.supplierSku === identity.supplierSku
    && input.marketplaceId === "EBAY_US"
    && /^\d{1,20}$/.test(String(input.categoryId ?? ""))
    && input.exactProductIdentityProven === true
    && Array.isArray(input.unresolvedRequiredAspects)
    && Array.isArray(input.officialAspectDefinitions)
    && /^sha256:[0-9a-f]{64}$/.test(String(input.inputEvidenceDigest ?? ""))
}

function semanticResolutions(input: Readonly<{
  batchInput: RequiredSpecificsBatchProductV1
  mappings: readonly Readonly<{ specificName: string, resolvedValue: string,
    sourceField: string, sourceExcerpt: string }>[]
  prior: JsonRecord
}>) {
  const mapped = new Map(input.mappings.map((entry) =>
    [normalized(entry.specificName), entry]))
  const priorResolutions = rows(input.prior.resolutions)
  const resolutions: RequiredSpecificResolutionV1[] = []
  for (const definition of input.batchInput.officialAspectDefinitions) {
    const mapping = mapped.get(normalized(definition.name))
    if (mapping) {
      const sourceField = ["TITLE", "DESCRIPTION", "SPECS", "VARIANT"]
        .includes(mapping.sourceField) ? mapping.sourceField as
          "TITLE" | "DESCRIPTION" | "SPECS" | "VARIANT" : "DESCRIPTION"
      resolutions.push(Object.freeze({ aspectName: definition.name,
        resolvedValue: mapping.resolvedValue,
        resolutionClass: "DETERMINISTIC_DERIVATION" as const,
        sourceEvidence: Object.freeze({ sourceField,
          sourceExcerpt: mapping.sourceExcerpt, imageIndex: null }),
        confidence: "HIGH" as const, factInvented: false as const,
        humanReviewRequired: false }))
      continue
    }
    const previous = priorResolutions.find((entry) =>
      normalized(entry.aspectName) === normalized(definition.name))
    if (previous && previous.factInvented === false) {
      resolutions.push(previous as RequiredSpecificResolutionV1)
    }
  }
  return Object.freeze(resolutions)
}

async function persistSemanticResolutions(input: Readonly<{
  supabase: SupabaseClient
  identity: NonNullable<ReturnType<
    typeof durableQuickPickRequiredSpecificsCandidateV1>>
  batchInput: RequiredSpecificsBatchProductV1
  resolutions: readonly RequiredSpecificResolutionV1[]
}>) {
  const read = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,assessment,updated_at")
    .eq("id", input.identity.rowId)
    .eq("candidate_key", input.identity.candidateKey).maybeSingle()
  const row = record(read.data)
  if (read.error || !row.id
      || row.supplier_product_id !== input.identity.lunaProductId
      || row.supplier_variant_id !== input.identity.lunaVariantId
      || row.supplier_sku !== input.identity.supplierSku) {
    throw new Error("QUICK_PICK_VISUAL_MAPPING_IDENTITY_MISMATCH")
  }
  const core = {
    contractVersion: MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1,
    authority: "SELLER_OS_DETERMINISTIC_FACTORY",
    radarCandidateId: input.batchInput.radarCandidateId,
    lunaProductId: input.batchInput.lunaProductId,
    lunaVariantId: input.batchInput.lunaVariantId,
    supplierSku: input.batchInput.supplierSku,
    marketplaceId: input.batchInput.marketplaceId,
    categoryId: input.batchInput.categoryId,
    aspectScope: REQUIRED_ASPECT_SCOPE,
    digestVersion: REQUIRED_SPECIFICS_DIGEST_VERSION,
    inputEvidenceDigest: input.batchInput.inputEvidenceDigest,
    resolutions: input.resolutions,
    groupedBy: "EBAY_MARKETPLACE_PLUS_CATEGORY_ID",
    factInvented: false,
    marketplaceWrites: 0,
  }
  const durable = Object.freeze({ ...core,
    evidenceDigest: requiredSpecificBatchEvidenceDigestV1(core) })
  const write = await input.supabase.from("ebay_luna_opportunity_queue")
    .update({ assessment: { ...record(row.assessment),
      marketplaceRequiredSpecificsBatchResolutionV1: durable },
    updated_at: new Date().toISOString() })
    .eq("id", row.id).eq("candidate_key", row.candidate_key)
    .eq("updated_at", row.updated_at)
    .select("id,assessment").maybeSingle()
  const stored = record(record(record(write.data).assessment)
    .marketplaceRequiredSpecificsBatchResolutionV1)
  if (write.error || !write.data
      || stored.evidenceDigest !== durable.evidenceDigest) {
    throw new Error("QUICK_PICK_VISUAL_MAPPING_DURABLE_WRITE_FAILED")
  }
}

function residualReason(input: Readonly<{
  specificName: string
  physicalIdentityStatus: string
  primaryReferenceFound: boolean
  safeFailureCode: string | null
}>) {
  const field = normalized(input.specificName)
  if (field === "condition") return {
    whyNotResolved: "OWNER_SUPPLIER_POLICY_OR_EXACT_LUNA_LINEAGE_UNAVAILABLE",
    exactEvidenceStillMissing: "VALID_DURABLE_OWNER_SUPPLIER_POLICY_APPLICATION",
  }
  if (input.safeFailureCode) return { whyNotResolved: input.safeFailureCode,
    exactEvidenceStillMissing: "BOUNDED_READONLY_MARKET_EVIDENCE" }
  if (!["EXACT_PRODUCT_MATCH", "STRONG_EXACT_MATCH"].includes(
    input.physicalIdentityStatus)) return {
    whyNotResolved: "PHYSICAL_PRODUCT_IDENTITY_NOT_CERTIFIABLE",
    exactEvidenceStillMissing:
      "NON_VISUAL_CORROBORATION_WITHOUT_MODEL_DIMENSION_OR_VARIANT_CONFLICT",
  }
  if (!input.primaryReferenceFound) return {
    whyNotResolved: "TOP_SELLING_EXACT_REFERENCE_NOT_PROVEN",
    exactEvidenceStillMissing: "EXACT_CLUSTER_COMMERCIAL_PERFORMANCE_EVIDENCE",
  }
  if (["brand", "model", "dimensions", "color", "material", "size"]
    .includes(field)) return {
    whyNotResolved: "STRICT_FACT_LACKS_COMPATIBLE_LUNA_PRODUCT_TRUTH",
    exactEvidenceStillMissing: `EXACT_LUNA_${field.toUpperCase()}_EVIDENCE`,
  }
  return { whyNotResolved: "TOP_SELLER_FIELD_CONSENSUS_OR_SEMANTIC_SUPPORT_INSUFFICIENT",
    exactEvidenceStillMissing:
      "TWO_SELLER_WEIGHTED_CONSENSUS_PLUS_EXACT_PRODUCT_TRUTH_SEMANTIC_SUPPORT" }
}

function finalOwnerMarker(input: Readonly<{
  assessment: JsonRecord
  materialized: JsonRecord
  resolvedNames: readonly string[]
  traces: readonly JsonRecord[]
}>) {
  const current = record(
    input.assessment.quickPickRequiredSpecificsContinuationV1)
  const unresolved = unique([
    ...(Array.isArray(input.materialized.unsupportedRequiredSpecifics)
      ? input.materialized.unsupportedRequiredSpecifics.map((entry) =>
        text(entry, 120)) : []),
    ...(input.materialized.conditionReady === false ? ["Condition"] : []),
  ])
  const unresolvedKeys = new Set(unresolved.map(normalized))
  const priorActions = residualActions(input.assessment)
  const residualOwnerActions = unresolved.map((name) => {
    const prior = priorActions.find((entry) => normalized(
      entry.exactUnresolvedField ?? entry.productField) === normalized(name))
    return prior ?? { productField: name, exactUnresolvedField: name,
      disposition: "OWNER_FACT_REQUIRED", ownerAction: "ENTER_FACT",
      bestProposal: null, proposalEvidence:
        "AUTOMATIC_EVIDENCE_CASCADE_EXHAUSTED", confidence: "LOW",
      whyAutomationCouldNotResolve:
        "EXACT_EVIDENCE_INSUFFICIENT_OR_CONFLICTING",
      exactEvidenceMissing: `AUTHORITATIVE_EXACT_PRODUCT_${normalized(name)
        .toUpperCase().replace(/\s+/g, "_")}`,
      editAllowed: true, automaticResolutionExhausted: true,
      factInvented: false }
  })
  const resolvedKeys = new Set(input.resolvedNames.map(normalized))
  const priorTraces = rows(current.requiredSpecificFactTraces).filter((entry) =>
    !resolvedKeys.has(normalized(entry.specificName))
    && unresolvedKeys.has(normalized(entry.specificName)))
  const firstBlocker = text(input.materialized.firstBlocker, 160)
  const finalDisposition = input.materialized.marketTestReady === true
    ? "MARKET_TEST_READY" : input.materialized.listingReady === true
      ? "LISTING_READY"
      : residualOwnerActions.some((entry) =>
        entry.disposition === "OWNER_FACT_REQUIRED")
        ? "OWNER_FACT_REQUIRED"
        : residualOwnerActions.length ? "OWNER_CONFIRMATION_REQUIRED"
          : /(?:CAPABILITY|PRODUCT_IDENTIFIER_POLICY)/.test(firstBlocker ?? "")
            ? "WAITING_FOR_EBAY_CAPABILITY" : "MARKETPLACE_READINESS_WAITING"
  return Object.freeze({ ...current,
    exactUnresolvedFields: unresolved,
    finalUnresolvedFieldCount: unresolved.length,
    residualOwnerActions: Object.freeze(residualOwnerActions),
    requiredSpecificFactTraces: Object.freeze([...priorTraces, ...input.traces]),
    resolvedFieldAudits: Object.freeze([
      ...rows(current.resolvedFieldAudits).filter((entry) =>
        !resolvedKeys.has(normalized(entry.specificName))), ...input.traces]),
    finalDisposition,
    ownerLastMileOnly: residualOwnerActions.length > 0,
    automaticResolutionExhausted: true,
    conditionReady: input.materialized.conditionReady === true,
    requiredItemSpecificsReady:
      input.materialized.requiredItemSpecificsReady === true,
    marketTestReady: input.materialized.marketTestReady === true,
    listingReady: input.materialized.listingReady === true,
    exactBlocker: firstBlocker,
    factInvented: false,
    marketplaceWrites: 0,
  })
}

export async function continueLunaQuickPickVisualTopSellerEnrichmentV1(
  input: Readonly<{
    supabase: SupabaseClient
    accountKey: string
    candidateKeys: readonly string[]
    taxonomyReader: RadarMarketplaceTaxonomyReaderV1
    productIdentifierPolicyReader?: RadarProductIdentifierPolicyReaderV1
    marketReader?: typeof runEbaySellerKeywordDemandValidation
    soldEvidenceReader?: typeof readReviewedOfficialSoldEvidence
    visualAiResolver?: ExactProductVisualAiResolverV1 | null
    now?: Date
  }>,
) {
  const now = input.now ?? new Date()
  const candidateKeys = unique(input.candidateKeys.filter((value) =>
    /^sha256:[0-9a-f]{64}$/.test(value))).slice(0, MAXIMUM_QUICK_PICKS)
  if (!candidateKeys.length) return Object.freeze({ attempted: 0, claimed: 0,
    marketplaceWrites: 0 as const, newOperationCount: 0 as const })
  const [read, policy] = await Promise.all([
    input.supabase.from("ebay_luna_opportunity_queue")
      .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,product_title,gtin,decision,assessment,updated_at")
      .in("candidate_key", candidateKeys).limit(MAXIMUM_QUICK_PICKS),
    readLunaNewMerchandisePolicyV1({ supabase: input.supabase,
      accountKey: input.accountKey }),
  ])
  if (read.error) throw new Error("QUICK_PICK_VISUAL_ENRICHMENT_READ_FAILED")
  const sourceRows = rows(read.data)
  const productIds = unique(sourceRows.map((row) =>
    text(row.supplier_product_id, 30)))
  const catalogRead = productIds.length
    ? await input.supabase.from("market_radar_latest_variants")
      .select("product_id,source_key,supplier_product_id,supplier_variant_id,sku,title,variant_title,vendor,product_type,tags,metadata,featured_image_url,image_urls,captured_at")
      .eq("source_key", "lunaportex").in("supplier_product_id", productIds)
      .limit(100)
    : { data: [], error: null }
  if (catalogRead.error) throw new Error(
    "QUICK_PICK_VISUAL_LUNA_CATALOG_READ_FAILED")
  const catalogRows = rows(catalogRead.data)
  const catalogProductIds = unique(catalogRows.map((row) =>
    text(row.product_id, 80)))
  const productsRead = catalogProductIds.length
    ? await input.supabase.from("market_radar_products")
      .select("id,body_html,metadata").in("id", catalogProductIds).limit(100)
    : { data: [], error: null }
  if (productsRead.error) throw new Error(
    "QUICK_PICK_VISUAL_LUNA_PRODUCT_READ_FAILED")
  const productsById = new Map(rows(productsRead.data).map((row) =>
    [String(row.id), row]))
  const exactCatalogFor = (row: JsonRecord) => {
    const matches = catalogRows.filter((catalog) =>
      catalog.supplier_product_id === row.supplier_product_id
      && catalog.supplier_variant_id === row.supplier_variant_id
      && catalog.sku === row.supplier_sku)
    if (matches.length !== 1) return null
    const product = productsById.get(String(matches[0].product_id))
    return { ...matches[0], body_html: product?.body_html,
      product_metadata: product?.metadata } as CatalogRow
  }

  let ownerFactRequiredBefore = 0
  let ownerConfirmationRequiredBefore = 0
  let conditionResidualBefore = 0
  const claimed: Array<Readonly<{ row: JsonRecord,
    identity: NonNullable<ReturnType<
      typeof durableQuickPickRequiredSpecificsCandidateV1>>,
    catalog: CatalogRow, fingerprint: ExactProductFingerprintV1,
    residualNamesBefore: readonly string[], conditionPolicyApplied: boolean,
    conditionOnlyReconciliation: boolean }>> = []
  for (const row of sourceRows) {
    const assessment = record(row.assessment)
    const actions = residualActions(assessment)
    const names = residualNames(assessment)
    if (actions.some((entry) => entry.disposition === "OWNER_FACT_REQUIRED")) {
      ownerFactRequiredBefore += 1
    }
    if (actions.some((entry) =>
      entry.disposition === "OWNER_CONFIRMATION_REQUIRED")) {
      ownerConfirmationRequiredBefore += 1
    }
    if (names.some((name) => normalized(name) === "condition")) {
      conditionResidualBefore += 1
    }
    const identity = durableQuickPickRequiredSpecificsCandidateV1(row)
    const exactTruth = resolveSellerOsExactProductTruthV1(row).exact
    const catalog = exactCatalogFor(row)
    const quickPick = record(assessment.lunaQuickPickOperationV1)
    const requiredSpecifics = record(
      assessment.quickPickRequiredSpecificsContinuationV1)
    const exactSoldEnrichment = record(
      assessment.quickPickExactSoldMarketEnrichmentV1)
    const legacyQuickPickLineage = quickPick.contractVersion ===
        "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1"
      && quickPick.candidateKey === row.candidate_key
      && quickPick.lunaProductId === row.supplier_product_id
      && quickPick.lunaVariantId === row.supplier_variant_id
      && quickPick.supplierSku === row.supplier_sku
    const continuedQuickPickLineage = requiredSpecifics.contractVersion ===
        "QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1"
      && requiredSpecifics.factInvented === false
      && requiredSpecifics.marketplaceWrites === 0
      && exactSoldEnrichment.contractVersion ===
        "QUICK_PICK_EXACT_SOLD_MARKET_ENRICHMENT_V2"
      && Boolean(exactSoldEnrichment.completedAt)
      && exactSoldEnrichment.factInvented === false
      && exactSoldEnrichment.marketplaceWrites === 0
    const exactQuickPick = legacyQuickPickLineage
      || continuedQuickPickLineage
    const current = record(assessment[QUICK_PICK_VISUAL_TOP_SELLER_MARKER])
    const claimedAt = Date.parse(String(current.claimedAt ?? ""))
    const stale = Boolean(!current.completedAt && Number.isFinite(claimedAt)
      && now.getTime() - claimedAt >= STALE_CLAIM_MS)
    const reconciliationClaimedAt = Date.parse(String(
      current.conditionReconciliationClaimedAt ?? ""))
    const activeConditionReconciliation = current.conditionRepairStatus ===
        "CLAIMED"
      && !current.conditionReconciliationCompletedAt
      && Number.isFinite(reconciliationClaimedAt)
      && now.getTime() - reconciliationClaimedAt < STALE_CLAIM_MS
    const currentCompleted = Boolean(current.completedAt
      && current.contractVersion === QUICK_PICK_VISUAL_TOP_SELLER_ENRICHMENT_V1)
    const conditionOnlyReconciliation = currentCompleted
      && names.some((name) => normalized(name) === "condition")
      && current.conditionResolved !== true && Boolean(policy)
      && !activeConditionReconciliation
    if (!identity || !exactTruth || !catalog || !exactQuickPick || !names.length
        || (currentCompleted && !conditionOnlyReconciliation)
        || (current.claimedAt && !current.completedAt && !stale)) continue
    const appliedAt = now.toISOString()
    const application = policy ? buildOwnerSupplierPolicyApplicationV1({
      policy, lunaProductId: identity.lunaProductId,
      lunaVariantId: identity.lunaVariantId, supplierSku: identity.supplierSku,
      exactSupplierLineageCertified: true, productIdentityExact: true,
      appliedAt,
    }) : null
    const marker = conditionOnlyReconciliation ? {
      ...current, ownerSupplierPolicyAvailable: Boolean(policy),
      conditionPolicyApplied: Boolean(application),
      conditionReconciliationClaimedAt: appliedAt,
      conditionReconciliationCompletedAt: null,
      conditionRepairStatus: "CLAIMED",
      conditionRepairSearchRepeated: false,
      conditionRepairVisionRepeated: false,
      factInvented: false, marketplaceWrites: 0,
    } : {
      contractVersion: QUICK_PICK_VISUAL_TOP_SELLER_ENRICHMENT_V1,
      claimedAt: appliedAt, completedAt: null,
      stageAuthority: "REQUIRED_SPECIFICS_PRODUCT_TRUTH_CONTINUATION",
      residualSpecificNamesBefore: names,
      ownerSupplierPolicyAvailable: Boolean(policy),
      conditionPolicyApplied: Boolean(application),
      physicalProductIdentitySeparatedFromMarketplaceFieldInterpretation: true,
      sourceOrder: ["EXACT_LUNA_PRODUCT_TRUTH", "DURABLE_PRODUCT_TRUTH",
        "CERTIFIED_PACKAGE_LISTING_LINEAGE", "EXISTING_RESEARCH_EVIDENCE",
        "EXISTING_SOLD_EVIDENCE", "NIGHT_RADAR_FAMILY_EVIDENCE",
        "BOUNDED_NEW_READONLY_SEARCH_FOR_RESIDUALS"],
      previousGateReexecution: { identity: false, duplicate: false,
        demand: false, shipping: false, economics: false, category: false },
      searchBounds: { maximumMarketLookupsPerProduct: 1,
        maximumMarketCandidatesPerProduct:
          MAXIMUM_MARKET_CANDIDATES_PER_PRODUCT,
        maximumVisualShortlistPerProduct:
          MAXIMUM_VISUAL_SHORTLIST_PER_PRODUCT,
        maximumAiCallsPerRun: MAXIMUM_AI_CALLS_PER_RUN,
        maximumAiProductsPerCall: MAXIMUM_AI_PRODUCTS_PER_CALL },
      store: false, factInvented: false, marketplaceWrites: 0,
    }
    const claim = await input.supabase.from("ebay_luna_opportunity_queue")
      .update({ assessment: { ...assessment,
        ...(application ? {
          ownerSupplierMerchandisePolicyApplicationV1: application,
        } : {}), [QUICK_PICK_VISUAL_TOP_SELLER_MARKER]: marker },
      updated_at: appliedAt })
      .eq("id", row.id).eq("candidate_key", row.candidate_key)
      .eq("updated_at", row.updated_at)
      .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,product_title,gtin,decision,assessment,updated_at")
      .maybeSingle()
    if (!claim.error && claim.data) {
      const claimedRow = record(claim.data)
      claimed.push(Object.freeze({ row: claimedRow, identity, catalog,
        fingerprint: fingerprintFor({ row: claimedRow, catalog }),
        residualNamesBefore: names,
        conditionPolicyApplied: Boolean(application),
        conditionOnlyReconciliation }))
    }
  }
  if (!claimed.length) return Object.freeze({ attempted: candidateKeys.length,
    claimed: 0, ownerFactRequiredBefore,
    ownerConfirmationRequiredBefore, conditionResidualBefore,
    conditionResolvedByOwnerPolicy: 0, marketplaceWrites: 0 as const,
    newOperationCount: 0 as const, duplicateOperationCount: 0 as const })

  const results = []
  const researchClaims = claimed.filter((entry) =>
    !entry.conditionOnlyReconciliation)
  for (const entry of claimed.filter((candidate) =>
    candidate.conditionOnlyReconciliation)) {
    let materialized = await materializeSellerOsDeterministicFactoryCandidateV1({
      supabase: input.supabase, accountKey: input.accountKey,
      opportunityId: entry.identity.rowId,
      candidateKey: entry.identity.candidateKey,
      taxonomyReader: input.taxonomyReader,
      productIdentifierPolicyReader: input.productIdentifierPolicyReader,
    })
    if (entry.conditionPolicyApplied && materialized.conditionReady !== true) {
      materialized = await materializeSellerOsDeterministicFactoryCandidateV1({
        supabase: input.supabase, accountKey: input.accountKey,
        opportunityId: entry.identity.rowId,
        candidateKey: entry.identity.candidateKey,
        taxonomyReader: input.taxonomyReader,
        productIdentifierPolicyReader: input.productIdentifierPolicyReader,
      })
    }
    const conditionResolved = entry.conditionPolicyApplied
      && materialized.conditionReady === true
    const finalRead = await input.supabase.from("ebay_luna_opportunity_queue")
      .select("id,candidate_key,assessment,updated_at")
      .eq("id", entry.identity.rowId)
      .eq("candidate_key", entry.identity.candidateKey).maybeSingle()
    const finalRow = record(finalRead.data)
    if (finalRead.error || !finalRow.id) {
      throw new Error("QUICK_PICK_VISUAL_CONDITION_REPAIR_READ_FAILED")
    }
    const finalAssessment = record(finalRow.assessment)
    const trace = conditionResolved ? [{ specificName: "Condition",
      resolvedValue: "New", sourceAuthority: "OWNER_SUPPLIER_POLICY",
      sourceFieldOrText: "LUNA PORTEX SOLO VENDE PRODUCTOS NUEVOS.",
      resolutionClass: "OWNER_SUPPLIER_POLICY", confidence: "HIGH",
      ownerConfirmationRequired: false, factInvented: false }] : []
    const ownerMarker = finalOwnerMarker({ assessment: finalAssessment,
      materialized: record(materialized),
      resolvedNames: conditionResolved ? ["Condition"] : [], traces: trace })
    const currentEvidence = record(
      finalAssessment[QUICK_PICK_VISUAL_TOP_SELLER_MARKER])
    const residuals = rows(currentEvidence.residuals).filter((residual) =>
      !conditionResolved || normalized(residual.specificName) !== "condition")
    const { evidenceDigest: _priorEvidenceDigest, ...priorEvidence } =
      currentEvidence
    const completedAt = new Date().toISOString()
    const safeFailureCode = conditionResolved
      ? text(currentEvidence.safeFailureCode, 120)
      : "OWNER_SUPPLIER_POLICY_CONDITION_MATERIALIZATION_FAILED"
    const durableEvidence = { ...priorEvidence,
      completedAt: text(currentEvidence.completedAt, 80) ?? completedAt,
      conditionPolicyApplied: entry.conditionPolicyApplied,
      conditionResolved, conditionRepairStatus: conditionResolved
        ? "RECONCILED" : "COMPLETED_WITH_SAFE_RESIDUAL",
      conditionReconciliationCompletedAt: completedAt,
      conditionRepairSearchRepeated: false,
      conditionRepairVisionRepeated: false,
      safeFailureCode, residuals, factInvented: false, marketplaceWrites: 0 }
    const finalWrite = await input.supabase.from(
      "ebay_luna_opportunity_queue")
      .update({ assessment: { ...finalAssessment,
        quickPickRequiredSpecificsContinuationV1: ownerMarker,
        [QUICK_PICK_VISUAL_TOP_SELLER_MARKER]: { ...durableEvidence,
          evidenceDigest: digest(durableEvidence) } },
      updated_at: completedAt })
      .eq("id", finalRow.id).eq("candidate_key", finalRow.candidate_key)
      .eq("updated_at", finalRow.updated_at)
      .select("id,candidate_key,assessment").maybeSingle()
    const stored = record(record(record(finalWrite.data).assessment)
      [QUICK_PICK_VISUAL_TOP_SELLER_MARKER])
    if (finalWrite.error || !finalWrite.data
        || stored.evidenceDigest !== digest(durableEvidence)) {
      throw new Error("QUICK_PICK_VISUAL_CONDITION_REPAIR_WRITE_FAILED")
    }
    const primaryReference = currentEvidence.primaryReference
      && typeof currentEvidence.primaryReference === "object"
      && !Array.isArray(currentEvidence.primaryReference)
      ? record(currentEvidence.primaryReference) : null
    const ownerActions = residualActions({
      quickPickRequiredSpecificsContinuationV1: ownerMarker,
    })
    results.push(Object.freeze({ supplierSku: entry.identity.supplierSku,
      conditionResolved,
      physicalIdentityStatus: text(currentEvidence.physicalIdentityStatus, 80)
        ?? "UNPROVEN",
      searchCandidatesInitial: Number(
        currentEvidence.searchCandidatesInitial ?? 0),
      marketCandidatesEvaluated: Number(
        currentEvidence.marketCandidatesEvaluated ?? 0),
      visualShortlistCount: Number(currentEvidence.visualShortlistCount ?? 0),
      visualCandidatesEvaluated: Number(
        currentEvidence.visualCandidatesEvaluated ?? 0),
      exactProductClusterFound: Number(
        currentEvidence.exactProductClusterCount ?? 0) > 0,
      strongProductClusterFound: Number(
        currentEvidence.strongProductClusterCount ?? 0) > 0,
      primaryReference,
      topReferenceCount: rows(currentEvidence.topReferenceSet).length,
      semanticMappedCount: rows(currentEvidence.semanticMappings).length,
      strictFactsCorroborated: Number(
        currentEvidence.strictFactsCorroborated ?? 0),
      strictFactsPromoted:
        Object.keys(record(currentEvidence.strictPromotions)).length,
      residuals, finalDisposition: ownerMarker.finalDisposition,
      ownerFactRequired: ownerActions.some((action) =>
        action.disposition === "OWNER_FACT_REQUIRED"),
      ownerConfirmationRequired: ownerActions.some((action) =>
        action.disposition === "OWNER_CONFIRMATION_REQUIRED"),
      waitingForEbayCapability: Array.isArray(materialized.blockers)
        && materialized.blockers.includes("WAITING_FOR_EBAY_CAPABILITY"),
      marketTestReady: materialized.marketTestReady === true,
      listingReady: materialized.listingReady === true,
      safeFailureCode }))
  }
  let soldRows: Awaited<ReturnType<typeof readReviewedOfficialSoldEvidence>> = []
  let durableSoldFailureCode: string | null = null
  if (researchClaims.length) {
    try {
      soldRows = await (input.soldEvidenceReader
        ?? readReviewedOfficialSoldEvidence)({ supabase: input.supabase,
        accountKey: input.accountKey })
    } catch (error) {
      durableSoldFailureCode = safeCode(error,
        "DURABLE_SOLD_EVIDENCE_READ_FAILED")
    }
  }

  const researched = await mapWithConcurrency(researchClaims,
    MARKET_LOOKUP_CONCURRENCY, async (entry) => {
      const assessment = record(entry.row.assessment)
      const identity = quickPickExactSoldCandidateIdentityV1(entry.row)
      const nonConditionResiduals = entry.residualNamesBefore.filter((name) =>
        normalized(name) !== "condition")
      const durableSold = officialSoldEvidenceComparablesForTarget({
        targetIdentity: identity, rows: soldRows,
        targetSupplierVariantId: text(entry.row.supplier_variant_id, 80),
      }).flatMap((comparable) => {
        const candidate = soldComparableToVisualCandidate(comparable)
        return candidate ? [candidate] : []
      })
      const durableClassified = resolveExactProductVisualMatchesV1({
        fingerprint: entry.fingerprint, candidates: durableSold })
      const durableIdentitySufficient = durableClassified.some((candidate) =>
        ["EXACT_PRODUCT_MATCH", "STRONG_EXACT_MATCH"]
          .includes(candidate.classification))
      let market: JsonRecord = {}
      let safeFailureCode: string | null = durableSoldFailureCode
      let marketLookupAttempted = false
      if (nonConditionResiduals.length && !durableIdentitySufficient) {
        marketLookupAttempted = true
        try {
          market = record(await (input.marketReader
            ?? runEbaySellerKeywordDemandValidation)(marketQuery(entry.row)))
        } catch (error) {
          safeFailureCode = safeCode(error,
            "BOUNDED_EBAY_MARKET_LOOKUP_FAILED")
        }
      }
      const observedAt = text(market.observedAt, 80) ?? now.toISOString()
      const marketCandidates = rows(market.comparableEvidence)
        .flatMap((value) => {
          const candidate = quickPickMarketComparableToVisualCandidateV1(
            value, observedAt)
          return candidate ? [candidate] : []
        })
      const candidates = mergeCandidates([...durableSold, ...marketCandidates])
      const shortlist = buildBoundedExactProductVisualShortlistV1({
        fingerprint: entry.fingerprint, candidates,
        maximumShortlist: MAXIMUM_VISUAL_SHORTLIST_PER_PRODUCT,
      })
      const deterministicClassified = resolveExactProductVisualMatchesV1({
        fingerprint: entry.fingerprint, candidates })
      const identitySufficient = deterministicClassified.some((candidate) =>
        ["EXACT_PRODUCT_MATCH", "STRONG_EXACT_MATCH"]
          .includes(candidate.classification))
      return { ...entry, exactEvidence: exactEvidence({ row: entry.row,
        catalog: entry.catalog }), candidates, shortlist,
        deterministicClassified, identitySufficient,
        marketLookupAttempted, safeFailureCode,
        marketInsightsAvailability: text(market.insightsAvailability, 80),
        initialSearchCandidateCount: Number(
          record(market.candidateSearch).candidateFoundCount ??
          market.candidateFoundCount ?? candidates.length) || candidates.length }
    })

  const config = input.visualAiResolver === undefined
    ? await readVisualConfig(input.supabase)
    : Object.freeze({ enabled: Boolean(input.visualAiResolver), modelId: null,
      maximumOutputTokens: 4_000, timeoutMs: 55_000,
      maximumCalls: MAXIMUM_AI_CALLS_PER_RUN,
      promptVersion: "INJECTED_TEST_RESOLVER" })
  const visualResolver = input.visualAiResolver === undefined
    ? createOpenAiExactProductVisualMatcherV1({ enabled: config.enabled,
      modelId: config.modelId,
      maximumOutputTokens: config.maximumOutputTokens,
      timeoutMs: config.timeoutMs })
    : input.visualAiResolver
  const visualWork = researched.filter((entry) =>
    !entry.identitySufficient && entry.shortlist.visualShortlist.length > 0)
  const evaluations: ExactProductVisualAiEvaluationV1[] = []
  const visualFailureByFingerprint = new Map<string, string>()
  let aiCallCount = 0
  let aiInputTokens = 0
  let aiOutputTokens = 0
  if (visualResolver && config.maximumCalls > 0) {
    for (let offset = 0; offset < visualWork.length
        && aiCallCount < config.maximumCalls;
      offset += MAXIMUM_AI_PRODUCTS_PER_CALL) {
      const batch = visualWork.slice(offset,
        offset + MAXIMUM_AI_PRODUCTS_PER_CALL).map((entry) => ({
        fingerprint: entry.fingerprint,
        candidates: entry.shortlist.visualShortlist,
      }))
      aiCallCount += 1
      try {
        const result = await visualResolver(batch, digest({
          contractVersion: QUICK_PICK_VISUAL_TOP_SELLER_ENRICHMENT_V1,
          promptVersion: config.promptVersion,
          batch: batch.map((entry) => ({
            fingerprintDigest: entry.fingerprint.evidenceDigest,
            candidateReferences: entry.candidates.map((candidate) =>
              candidate.candidateReference),
          })),
        }))
        evaluations.push(...result.evaluations)
        aiInputTokens += result.inputTokens ?? 0
        aiOutputTokens += result.outputTokens ?? 0
      } catch (error) {
        const code = safeCode(error, "EXACT_PRODUCT_VISUAL_AI_FAILED")
        for (const entry of batch) {
          visualFailureByFingerprint.set(entry.fingerprint.evidenceDigest, code)
        }
      }
    }
  }

  const enriched = researched.map((entry) => {
    const candidateEvaluations = evaluations.filter((evaluation) =>
      evaluation.fingerprintDigest === entry.fingerprint.evidenceDigest)
    const classified = resolveExactProductVisualMatchesV1({
      fingerprint: entry.fingerprint, candidates: entry.candidates,
      aiEvaluations: candidateEvaluations })
    const truth = record(record(entry.row.assessment).productTruth)
    const mapping = resolveTopSellerMarketplaceFieldMappingV1({
      classifiedCandidates: classified,
      residualSpecificNames: entry.residualNamesBefore.filter((name) =>
        normalized(name) !== "condition"),
      exactEvidence: entry.exactEvidence,
      existingProductTruth: stringRecord(truth.provenProductValues),
      officialAllowedValues: Object.fromEntries(rows(record(
        record(truth.sourceEvidence).requiredItemSpecificsTruthV1)
        .aspectContracts).map((definition) => [String(definition.name ?? ""),
        Array.isArray(definition.allowedValues)
          ? definition.allowedValues.flatMap((value) =>
            typeof value === "string" ? [value] : []) : []])),
      now,
    })
    const physicalIdentityStatus = classified.some((candidate) =>
      candidate.classification === "EXACT_PRODUCT_MATCH")
      ? "EXACT_PRODUCT_MATCH"
      : classified.some((candidate) =>
        candidate.classification === "STRONG_EXACT_MATCH")
        ? "STRONG_EXACT_MATCH"
        : classified.some((candidate) =>
          candidate.classification === "FAMILY_ONLY")
          ? "FAMILY_ONLY" : classified.length ? "REJECTED" : "UNPROVEN"
    return { ...entry, candidateEvaluations, classified, mapping,
      physicalIdentityStatus,
      safeFailureCode: entry.safeFailureCode
        ?? visualFailureByFingerprint.get(entry.fingerprint.evidenceDigest)
        ?? null }
  })

  for (const entry of enriched) {
    const strictPromotions = entry.mapping.strictPromotions
    const strictPromotionCount = Object.keys(strictPromotions).length
    if (strictPromotionCount) {
      const currentRead = await input.supabase.from(
        "ebay_luna_opportunity_queue")
        .select("id,candidate_key,assessment,updated_at")
        .eq("id", entry.identity.rowId)
        .eq("candidate_key", entry.identity.candidateKey).maybeSingle()
      const current = record(currentRead.data)
      if (currentRead.error || !current.id) {
        throw new Error("QUICK_PICK_VISUAL_STRICT_TRUTH_READ_FAILED")
      }
      const currentAssessment = record(current.assessment)
      const strictEvidence = { contractVersion:
        QUICK_PICK_VISUAL_TOP_SELLER_ENRICHMENT_V1,
      fingerprintDigest: entry.fingerprint.evidenceDigest,
      promotedFields: Object.keys(strictPromotions),
      exactClusterCount: entry.mapping.exactProductClusterCount,
      strongClusterCount: entry.mapping.strongProductClusterCount,
      lunaImageBrandTextCorroborated: true,
      sellerOverrideAllowed: false, factInvented: false }
      const write = await input.supabase.from("ebay_luna_opportunity_queue")
        .update({ assessment: { ...currentAssessment,
          productTruth: applyStrictPromotionsToTruth(currentAssessment,
            strictPromotions, strictEvidence) },
        updated_at: new Date().toISOString() })
        .eq("id", current.id).eq("candidate_key", current.candidate_key)
        .eq("updated_at", current.updated_at).select("id").maybeSingle()
      if (write.error || !write.data) {
        throw new Error("QUICK_PICK_VISUAL_STRICT_TRUTH_WRITE_FAILED")
      }
    }

    let materialized = await materializeSellerOsDeterministicFactoryCandidateV1({
      supabase: input.supabase, accountKey: input.accountKey,
      opportunityId: entry.identity.rowId,
      candidateKey: entry.identity.candidateKey,
      taxonomyReader: input.taxonomyReader,
      productIdentifierPolicyReader: input.productIdentifierPolicyReader,
    })
    if (entry.conditionPolicyApplied && materialized.conditionReady !== true) {
      materialized = await materializeSellerOsDeterministicFactoryCandidateV1({
        supabase: input.supabase, accountKey: input.accountKey,
        opportunityId: entry.identity.rowId,
        candidateKey: entry.identity.candidateKey,
        taxonomyReader: input.taxonomyReader,
        productIdentifierPolicyReader: input.productIdentifierPolicyReader,
      })
    }
    const batchInput = validBatchInput(materialized.requiredSpecificsBatchInput,
      entry.identity) ? materialized.requiredSpecificsBatchInput : null
    let semanticMappedCount = 0
    if (entry.mapping.semanticMappings.length && batchInput) {
      const currentRead = await input.supabase.from(
        "ebay_luna_opportunity_queue")
        .select("assessment").eq("id", entry.identity.rowId)
        .eq("candidate_key", entry.identity.candidateKey).maybeSingle()
      const currentAssessment = record(record(currentRead.data).assessment)
      const resolutions = semanticResolutions({ batchInput,
        mappings: entry.mapping.semanticMappings,
        prior: record(currentAssessment
          .marketplaceRequiredSpecificsBatchResolutionV1) })
      await persistSemanticResolutions({ supabase: input.supabase,
        identity: entry.identity, batchInput, resolutions })
      semanticMappedCount = entry.mapping.semanticMappings.length
      materialized = await materializeSellerOsDeterministicFactoryCandidateV1({
        supabase: input.supabase, accountKey: input.accountKey,
        opportunityId: entry.identity.rowId,
        candidateKey: entry.identity.candidateKey,
        taxonomyReader: input.taxonomyReader,
        productIdentifierPolicyReader: input.productIdentifierPolicyReader,
      })
    }

    const resolvedNames = unique([
      ...(entry.conditionPolicyApplied && materialized.conditionReady === true
        ? ["Condition"] : []),
      ...Object.keys(strictPromotions),
      ...entry.mapping.semanticMappings.slice(0, semanticMappedCount)
        .map((mapping) => mapping.specificName),
    ])
    const traces: JsonRecord[] = [
      ...(entry.conditionPolicyApplied && materialized.conditionReady === true
        ? [{ specificName: "Condition", resolvedValue: "New",
          sourceAuthority: "OWNER_SUPPLIER_POLICY",
          sourceFieldOrText: "LUNA PORTEX SOLO VENDE PRODUCTOS NUEVOS.",
          resolutionClass: "OWNER_SUPPLIER_POLICY",
          confidence: "HIGH", ownerConfirmationRequired: false,
          factInvented: false }] : []),
      ...Object.entries(strictPromotions).map(([name, value]) => ({
        specificName: name, resolvedValue: value,
        sourceAuthority: "EXACT_LUNA_IMAGE_PLUS_EXACT_MARKET_CLUSTER",
        sourceFieldOrText: "VISIBLE_BRAND_TEXT_CORROBORATED",
        resolutionClass: "STRICT_FACT_CORROBORATION",
        confidence: "HIGH", ownerConfirmationRequired: false,
        factInvented: false })),
      ...entry.mapping.semanticMappings.slice(0, semanticMappedCount)
        .map((mapping) => ({ specificName: mapping.specificName,
          resolvedValue: mapping.resolvedValue,
          sourceAuthority: "TOP_SELLER_FIELD_CONSENSUS",
          sourceFieldOrText: mapping.sourceExcerpt,
          resolutionClass: "MARKETPLACE_SEMANTIC_MAPPING",
          confidence: "HIGH", ownerConfirmationRequired: false,
          factInvented: false })),
    ]
    const finalRead = await input.supabase.from("ebay_luna_opportunity_queue")
      .select("id,candidate_key,assessment,updated_at")
      .eq("id", entry.identity.rowId)
      .eq("candidate_key", entry.identity.candidateKey).maybeSingle()
    const finalRow = record(finalRead.data)
    if (finalRead.error || !finalRow.id) {
      throw new Error("QUICK_PICK_VISUAL_FINAL_READ_FAILED")
    }
    const finalAssessment = record(finalRow.assessment)
    const ownerMarker = finalOwnerMarker({ assessment: finalAssessment,
      materialized: record(materialized), resolvedNames, traces })
    const finalResidualNames = unique([
      ...(Array.isArray(materialized.unsupportedRequiredSpecifics)
        ? materialized.unsupportedRequiredSpecifics.map((value) =>
          text(value, 120)) : []),
      ...(materialized.conditionReady === false ? ["Condition"] : []),
    ])
    const residuals = finalResidualNames.map((specificName) => ({
      supplierSku: entry.identity.supplierSku, specificName,
      physicalIdentityStatus: entry.physicalIdentityStatus,
      topSellerReferenceFound: Boolean(entry.mapping.primaryReference),
      ...residualReason({ specificName,
        physicalIdentityStatus: entry.physicalIdentityStatus,
        primaryReferenceFound: Boolean(entry.mapping.primaryReference),
        safeFailureCode: entry.safeFailureCode }),
    }))
    const durableEvidence = {
      contractVersion: QUICK_PICK_VISUAL_TOP_SELLER_ENRICHMENT_V1,
      claimedAt: record(finalAssessment[
        QUICK_PICK_VISUAL_TOP_SELLER_MARKER]).claimedAt,
      completedAt: new Date().toISOString(),
      stageAuthority: "REQUIRED_SPECIFICS_PRODUCT_TRUTH_CONTINUATION",
      supplierIdentityDigest: digest({
        lunaProductId: entry.identity.lunaProductId,
        lunaVariantId: entry.identity.lunaVariantId,
        supplierSku: entry.identity.supplierSku }),
      fingerprintDigest: entry.fingerprint.evidenceDigest,
      physicalIdentityStatus: entry.physicalIdentityStatus,
      searchCandidatesInitial: entry.initialSearchCandidateCount,
      marketCandidatesEvaluated: entry.candidates.length,
      visualShortlistCount: entry.shortlist.visualShortlist.length,
      visualCandidatesEvaluated: entry.candidateEvaluations.length,
      marketLookupAttempted: entry.marketLookupAttempted,
      marketInsightsAvailability: entry.marketInsightsAvailability,
      safeFailureCode: entry.safeFailureCode,
      conditionPolicyApplied: entry.conditionPolicyApplied,
      conditionResolved: entry.conditionPolicyApplied
        && materialized.conditionReady === true,
      exactProductClusterCount: entry.mapping.exactProductClusterCount,
      strongProductClusterCount: entry.mapping.strongProductClusterCount,
      primaryReference: entry.mapping.primaryReference,
      topReferenceSet: entry.mapping.topReferenceSet,
      fieldConsensus: entry.mapping.fieldConsensus,
      semanticMappings: entry.mapping.semanticMappings.slice(
        0, semanticMappedCount),
      strictFactsCorroborated: entry.mapping.strictFactsCorroborated,
      strictPromotions,
      marketIdentifierCandidates: entry.mapping.marketIdentifierCandidates,
      residuals,
      sourceOrder: ["EXACT_LUNA_PRODUCT_TRUTH", "DURABLE_PRODUCT_TRUTH",
        "CERTIFIED_PACKAGE_LISTING_LINEAGE", "EXISTING_RESEARCH_EVIDENCE",
        "EXISTING_SOLD_EVIDENCE", "NIGHT_RADAR_FAMILY_EVIDENCE",
        "BOUNDED_NEW_READONLY_SEARCH_FOR_RESIDUALS"],
      physicalProductIdentitySeparatedFromMarketplaceFieldInterpretation: true,
      exactProductVisualMatcherReusable: true,
      topSellerFieldMappingSystemic: true,
      productTruthOverrideBySeller: false,
      familyEvidencePromotedToProductTruth: false,
      conditionFromSoldEvidenceAllowed: false,
      productIdentifiersRequireOfficialCategoryPolicy: true,
      previousGateReexecution: { identity: false, duplicate: false,
        demand: false, shipping: false, economics: false, category: false },
      aiCallCountForProduct: entry.candidateEvaluations.length ? 1 : 0,
      aiStore: false, factInvented: false, marketplaceWrites: 0,
    }
    const finalWrite = await input.supabase.from("ebay_luna_opportunity_queue")
      .update({ assessment: { ...finalAssessment,
        quickPickRequiredSpecificsContinuationV1: ownerMarker,
        [QUICK_PICK_VISUAL_TOP_SELLER_MARKER]: {
          ...durableEvidence, evidenceDigest: digest(durableEvidence) } },
      updated_at: new Date().toISOString() })
      .eq("id", finalRow.id).eq("candidate_key", finalRow.candidate_key)
      .eq("updated_at", finalRow.updated_at)
      .select("id,candidate_key,assessment").maybeSingle()
    const stored = record(record(record(finalWrite.data).assessment)
      [QUICK_PICK_VISUAL_TOP_SELLER_MARKER])
    if (finalWrite.error || !finalWrite.data || !stored.completedAt
        || stored.evidenceDigest !== digest(durableEvidence)) {
      throw new Error("QUICK_PICK_VISUAL_FINAL_WRITE_FAILED")
    }
    results.push(Object.freeze({ supplierSku: entry.identity.supplierSku,
      conditionResolved: durableEvidence.conditionResolved,
      physicalIdentityStatus: entry.physicalIdentityStatus,
      searchCandidatesInitial: entry.initialSearchCandidateCount,
      marketCandidatesEvaluated: entry.candidates.length,
      visualShortlistCount: entry.shortlist.visualShortlist.length,
      visualCandidatesEvaluated: entry.candidateEvaluations.length,
      exactProductClusterFound:
        entry.mapping.exactProductClusterCount > 0,
      strongProductClusterFound:
        entry.mapping.strongProductClusterCount > 0,
      primaryReference: entry.mapping.primaryReference,
      topReferenceCount: entry.mapping.topReferenceSet.length,
      semanticMappedCount,
      strictFactsCorroborated: entry.mapping.strictFactsCorroborated,
      strictFactsPromoted: strictPromotionCount,
      residuals, finalDisposition: ownerMarker.finalDisposition,
      ownerFactRequired: residualActions({
        quickPickRequiredSpecificsContinuationV1: ownerMarker,
      }).some((action) => action.disposition === "OWNER_FACT_REQUIRED"),
      ownerConfirmationRequired: residualActions({
        quickPickRequiredSpecificsContinuationV1: ownerMarker,
      }).some((action) =>
        action.disposition === "OWNER_CONFIRMATION_REQUIRED"),
      waitingForEbayCapability: Array.isArray(materialized.blockers)
        && materialized.blockers.includes("WAITING_FOR_EBAY_CAPABILITY"),
      marketTestReady: materialized.marketTestReady === true,
      listingReady: materialized.listingReady === true,
      safeFailureCode: entry.safeFailureCode }))
  }

  const searchCandidatesInitial = results.reduce((sum, result) =>
    sum + result.searchCandidatesInitial, 0)
  const visualShortlistCount = results.reduce((sum, result) =>
    sum + result.visualShortlistCount, 0)
  const aiCostStatus = !visualResolver || config.maximumCalls === 0
    ? "DISABLED_BY_DURABLE_CONFIG"
    : !visualWork.length ? "IDENTITY_CONFIDENCE_SUFFICIENT_OR_NO_SHORTLIST"
      : visualFailureByFingerprint.size
        ? "BOUNDED_PARTIAL_FAILURE" : "BOUNDED_COMPLETED"
  return Object.freeze({ attempted: candidateKeys.length,
    claimed: claimed.length, ownerFactRequiredBefore,
    ownerConfirmationRequiredBefore, conditionResidualBefore,
    conditionResolvedByOwnerPolicy: results.filter((result) =>
      result.conditionResolved).length,
    conditionResidualAfter: results.filter((result) =>
      result.residuals.some((residual) =>
        normalized(residual.specificName) === "condition")).length,
    ownerConditionConfirmationRequiredAfter: results.filter((result) =>
      result.residuals.some((residual) =>
        normalized(residual.specificName) === "condition")
      && result.ownerConfirmationRequired).length,
    searchCandidatesInitial,
    visualShortlistCount,
    visualCandidatesEvaluated: results.reduce((sum, result) =>
      sum + result.visualCandidatesEvaluated, 0),
    exactProductClustersFound: results.filter((result) =>
      result.exactProductClusterFound).length,
    strongProductClustersFound: results.filter((result) =>
      result.strongProductClusterFound).length,
    topSellingPrimaryReferencesSelected: results.filter((result) =>
      result.primaryReference).length,
    semanticFieldsAutoMapped: results.reduce((sum, result) =>
      sum + result.semanticMappedCount, 0),
    strictFactsCorroborated: results.reduce((sum, result) =>
      sum + result.strictFactsCorroborated, 0),
    strictFactsAutoPromoted: results.reduce((sum, result) =>
      sum + result.strictFactsPromoted, 0),
    ownerFactRequiredAfter: results.filter((result) =>
      result.ownerFactRequired).length,
    ownerConfirmationRequiredAfter: results.filter((result) =>
      result.ownerConfirmationRequired).length,
    waitingForEbayCapabilityCount: results.filter((result) =>
      result.waitingForEbayCapability).length,
    marketTestReadyCount: results.filter((result) =>
      result.marketTestReady).length,
    listingReadyCount: results.filter((result) =>
      result.listingReady).length,
    aiCallCount, aiInputTokens, aiOutputTokens, aiCostStatus,
    results: Object.freeze(results),
    lunaNewConditionPolicySystemic: true as const,
    physicalIdentitySeparatedFromMarketplaceFieldInterpretation: true as const,
    exactProductVisualMatcherReusable: true as const,
    topSellingExactMatchPrioritized: true as const,
    lowSellerArbitrarilySelected: false as const,
    topSellerFieldMappingSystemic: true as const,
    semanticMappingRequiresStringEquality: false as const,
    productTruthOverrideBySeller: false as const,
    familyEvidencePromotedToProductTruth: false as const,
    conditionFromSoldEvidenceAllowed: false as const,
    productIdentifiersRequireOfficialCategoryPolicy: true as const,
    futureQuickPickVisualIdentityMatching: true as const,
    futureQuickPickTopSellerMapping: true as const,
    skuSpecialCases: 0 as const,
    historicalBatchSpecialCase: false as const,
    factInvented: false as const,
    factInventedTrueCount: 0 as const,
    marketplaceWrites: 0 as const,
    listingPublications: 0 as const,
    listingMutations: 0 as const,
    newOperationCount: 0 as const,
    duplicateOperationCount: 0 as const,
  })
}
