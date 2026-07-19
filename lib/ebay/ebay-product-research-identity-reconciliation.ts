import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { buildProductIdentityFingerprint, normalizeProductIdentity } from "./ebay-winner-evidence-v2.ts"
import type { ProductIdentityInput } from "./ebay-winner-evidence-v2"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { detectProductResearchOfferFacts, targetFromCatalogRow, targetFromVerifiedActiveListingLink, type ProductResearchCaptureTarget } from "./ebay-product-research-browser-capture.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { extractLunaOfficialDescriptionIdentity } from "./luna-official-description-identity.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { readEbayTradingItemIdentityReadonly } from "./ebay-trading-item-identity-readonly.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { createTop20ContinuationToken, hashTop20ContinuationToken } from "./ebay-listing-ai-top20-automation.ts"
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { getEbayReadonlyRateLimitMetadata } from "./ebay-readonly-rate-limit.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { selectCatalogIdentityMatches, type CatalogIdentityProduct } from "./ebay-luna-product-identity-enrichment.ts"

export const PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION =
  "PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_V2_2026_07_18"

export type ProductIdentityReconciliationClassification =
  | "EXACT_LUNA_MATCH"
  | "SAME_PRODUCT_DIFFERENT_PACK"
  | "SAME_PRODUCT_DIFFERENT_SIZE"
  | "DIFFERENT_VARIANT"
  | "AMBIGUOUS"
  | "NO_LUNA_MATCH"
  | "CONFLICTED"

type JsonRecord = Record<string, unknown>

type TradingReader = (itemId: string) => Promise<unknown>
type BrowseReader = (input: {
  productName?: string | null
  packQuantity?: number | null
  size?: string | null
  gtin?: string | null
  brand?: string | null
  mpn?: string | null
  model?: string | null
}) => Promise<unknown>
type CatalogReader = (input: {
  query: string
  gtin?: string | null
  mpn?: string | null
  categoryId?: string | null
}) => Promise<unknown>
type TaxonomyReader = (query: string, categoryId?: string | null) => Promise<unknown>

type Observation = {
  id: string
  capture_batch_id: string
  source_listing_id: string | null
  normalized_identity: JsonRecord
  detected_offer_pack_count: number | null
  detected_unit_count: number | null
  detected_size: string | null
  detected_variant: string | null
  keyword_signals: string[]
  match_classification: string
  matched_supplier_variant_id: string | null
  confirmed_sold_quantity: number
  last_sold_date: string
}

export type OfficialIdentityFacts = {
  productName: string | null
  brand: string | null
  manufacturer: string | null
  gtin: string | null
  mpn: string | null
  model: string | null
  size: string | null
  color: string | null
  scent: string | null
  variant: string | null
  packCount: number | null
  unitCount: number | null
  condition: string | null
  categoryId: string | null
}

export type ProductIdentityReconciliationDecision = {
  classification: ProductIdentityReconciliationClassification
  confidence: number
  target: ProductResearchCaptureTarget | null
  matchedAttributes: JsonRecord
  conflictingAttributes: JsonRecord
  baseProductFingerprint: string
  lunaVariantFingerprint: string | null
  observedOfferPackFingerprint: string
  candidateOfferPackFingerprint: string | null
  evidenceClass: "CONFIRMED_SOLD_EXACT" | "CONFIRMED_SOLD_RELATED_PACK" |
    "CONFIRMED_SOLD_RELATED_SIZE" | "NON_QUALIFYING"
  affectsSoldExactCount: boolean
  affectsPackIntelligence: boolean
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 300) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
  return normalized || null
}

function integer(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value as JsonRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`
  return JSON.stringify(value)
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(
    typeof value === "string" ? value : canonicalJson(value),
  ).digest("hex")}`
}

const STOP_WORDS = new Set([
  "and", "the", "for", "with", "from", "new", "free", "shipping", "lot", "pack",
  "count", "set", "each", "per", "item", "items", "of", "ct", "qty", "quantity",
])

function tokens(value: unknown) {
  return [...new Set((text(value)?.toLocaleLowerCase("en-US").match(/[a-z0-9]+/g) ?? [])
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token) && !/^\d+$/.test(token)))]
}

function tokenSimilarity(left: string[], rightValue: unknown) {
  const right = tokens(rightValue)
  if (!left.length || !right.length) return 0
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  const intersection = [...rightSet].filter((token) => leftSet.has(token)).length
  const union = new Set([...leftSet, ...rightSet]).size
  return (intersection / rightSet.size) * .7 + (intersection / union) * .3
}

function normalized(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return text(value)?.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim() ?? null
}

function sameFact(left: unknown, right: unknown) {
  const a = normalized(left)
  const b = normalized(right)
  return Boolean(a && b && a === b)
}

function explicitConflict(left: unknown, right: unknown) {
  const a = normalized(left)
  const b = normalized(right)
  return Boolean(a && b && a !== b)
}

function aspectValue(aspects: unknown, names: string[]) {
  const wanted = new Set(names.map((name) => name.toLocaleLowerCase("en-US")))
  for (const raw of Array.isArray(aspects) ? aspects : []) {
    const aspect = record(raw)
    const name = text(aspect.name)?.toLocaleLowerCase("en-US")
    const value = text(aspect.value)
    if (name && value && wanted.has(name)) return value
  }
  return null
}

function comparableAspectValue(row: JsonRecord, names: string[]) {
  return aspectValue(row.localizedAspects, names)
}

function jsonStringArray(value: unknown) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((entry) => text(entry)).filter((entry): entry is string => Boolean(entry)))]
}

function catalogProduct(value: unknown): CatalogIdentityProduct {
  const product = record(value)
  return {
    epid: text(product.epid) ?? null,
    title: text(product.title) ?? null,
    brand: text(product.brand) ?? null,
    gtins: jsonStringArray(product.gtins),
    mpns: jsonStringArray(product.mpns),
    aspects: (Array.isArray(product.aspects) ? product.aspects : []).map(record)
      .map((aspect) => ({ name: text(aspect.name) ?? "", values: jsonStringArray(aspect.values) }))
      .filter((aspect) => Boolean(aspect.name) && aspect.values.length > 0),
    categoryId: text(product.categoryId) ?? null,
  }
}

function identityAnchor(input: ProductIdentityInput) {
  return normalizeProductIdentity(input)
}

function browseIdentityFields(row: JsonRecord) {
  return {
    gtin: text(row.gtin),
    brand: text(row.brand) ?? comparableAspectValue(row, ["brand"]),
    mpn: text(row.mpn) ?? comparableAspectValue(row, ["mpn", "manufacturer part number"]),
    model: text(row.model) ?? comparableAspectValue(row, ["model", "model number"]),
    packCount: integer(row.lotSize) ?? integer(comparableAspectValue(row,
      ["number in pack", "pack quantity", "pack size"])),
    size: text(row.size) ?? comparableAspectValue(row, ["size", "unit size", "capacity", "volume"]),
    color: text(row.color) ?? comparableAspectValue(row, ["color", "colour"]),
    scent: comparableAspectValue(row, ["scent", "fragrance"]),
    variant: comparableAspectValue(row, ["variant", "variation"]),
  }
}

function hasConflictList(value: unknown) {
  return Array.isArray(value) && value.some((entry) => Boolean(text(entry)))
}

function browseCompatibleWithAnchor(row: JsonRecord, anchor: ReturnType<typeof identityAnchor>) {
  if (row.eligibleComparable !== true || row.identifierExact !== true ||
    !["EXACT_IDENTIFIER", "EXACT"].includes(text(row.identityMatchQuality) ?? "") ||
    hasConflictList(row.identityConflicts)) return false
  const identity = browseIdentityFields(row)
  const normalizedIdentity = normalizeProductIdentity({
    manufacturerBrand: identity.brand, gtin: identity.gtin, mpn: identity.mpn,
    model: identity.model, packCount: identity.packCount, size: identity.size,
    color: identity.color, scent: identity.scent, variant: identity.variant,
  })
  if (anchor.gtinValid && (!normalizedIdentity.gtinValid || anchor.gtin !== normalizedIdentity.gtin)) return false
  const anchorPart = anchor.mpn ?? anchor.model
  const observedPart = normalizedIdentity.mpn ?? normalizedIdentity.model
  if (!anchor.gtinValid && anchor.manufacturerBrand && anchorPart &&
    (anchor.manufacturerBrand !== normalizedIdentity.manufacturerBrand || anchorPart !== observedPart)) return false
  if (anchor.packCount && (normalizedIdentity.packCount !== anchor.packCount || row.offerPackResolved !== true)) return false
  for (const [expected, observed] of [
    [anchor.size, normalizedIdentity.size], [anchor.color, normalizedIdentity.color],
    [anchor.scent, normalizedIdentity.scent], [anchor.variant, normalizedIdentity.variant],
  ]) if (expected && observed && expected !== observed) return false
  return true
}

function catalogCompatibleWithAnchor(product: CatalogIdentityProduct,
  anchor: ReturnType<typeof identityAnchor>) {
  const gtins = product.gtins.map((gtin) => normalizeProductIdentity({ gtin }).gtin).filter(Boolean)
  const mpns = product.mpns.map((mpn) => normalizeProductIdentity({ mpn }).mpn).filter(Boolean)
  if (anchor.gtinValid && !gtins.includes(anchor.gtin)) return false
  if (anchor.manufacturerBrand && product.brand &&
    normalized(product.brand) !== anchor.manufacturerBrand) return false
  const anchorPart = anchor.mpn ?? anchor.model
  if (!anchor.gtinValid && anchor.manufacturerBrand && anchorPart &&
    (!product.brand || normalized(product.brand) !== anchor.manufacturerBrand ||
      !mpns.includes(anchorPart))) return false
  const productPack = integer(aspectValue(product.aspects.flatMap((aspect) =>
    aspect.values.map((value) => ({ name: aspect.name, value }))),
  ["number in pack", "pack size", "pack quantity"]))
  if (anchor.packCount && productPack && anchor.packCount !== productPack) return false
  return true
}

/**
 * Selects product identity evidence without ever merging arbitrary search rows.
 * Browse contributes one exact, eligible offer. Catalog contributes exactly one
 * validated product; ambiguous result sets contribute no identity fields.
 */
export function selectOfficialProductIdentityEvidence(input: {
  anchor: ProductIdentityInput
  browse: JsonRecord | null
  catalog: JsonRecord | null
}) {
  const anchor = identityAnchor(input.anchor)
  const exactBrowse = (Array.isArray(input.browse?.comparableEvidence)
    ? input.browse.comparableEvidence : []).map(record)
    .filter((row) => browseCompatibleWithAnchor(row, anchor))
    .sort((left, right) =>
      Number(right.identityMatchScore ?? 0) - Number(left.identityMatchScore ?? 0) ||
      (text(left.comparableId) ?? "").localeCompare(text(right.comparableId) ?? ""))
  const catalogCandidates = (Array.isArray(input.catalog?.products) ? input.catalog.products : [])
    .map(catalogProduct)
  const catalogSelection = selectCatalogIdentityMatches({
    title: anchor.normalizedProductName,
    gtin: anchor.gtinValid ? anchor.gtin : null,
    brand: anchor.manufacturerBrand,
    mpn: anchor.mpn ?? anchor.model,
    packCount: anchor.packCount,
  }, catalogCandidates)
  const selectedCatalog = catalogSelection.products.length === 1 &&
    ["EXACT_GTIN", "EXACT_BRAND_MPN"].includes(catalogSelection.matchRule) &&
    catalogCompatibleWithAnchor(catalogSelection.products[0], anchor) &&
    Boolean(catalogSelection.products[0].epid ||
      catalogSelection.products[0].gtins.some((value) => normalizeProductIdentity({ gtin: value }).gtinValid) ||
      catalogSelection.products[0].brand && catalogSelection.products[0].mpns.length)
    ? catalogSelection.products[0] : null
  return {
    browseComparable: exactBrowse[0] ?? null,
    browseExactEligibleCount: exactBrowse.length,
    catalogProduct: selectedCatalog,
    catalogSelectionRule: selectedCatalog ? catalogSelection.matchRule : "AMBIGUOUS_OR_UNVALIDATED",
    catalogCandidateCount: catalogCandidates.length,
  }
}

export function officialFactsFromSources(input: {
  capture: OfficialIdentityFacts
  trading: JsonRecord | null
  browse: JsonRecord | null
  catalog: JsonRecord | null
  taxonomy: JsonRecord | null
  anchor?: ProductIdentityInput | null
}) {
  const selection = selectOfficialProductIdentityEvidence({
    anchor: input.anchor ?? {
      manufacturerBrand: input.capture.brand, gtin: input.capture.gtin,
      mpn: input.capture.mpn, model: input.capture.model,
      productName: input.capture.productName, packCount: input.capture.packCount,
      unitCount: input.capture.unitCount, size: input.capture.size,
      color: input.capture.color, scent: input.capture.scent,
      variant: input.capture.variant, condition: input.capture.condition,
    },
    browse: input.browse, catalog: input.catalog,
  })
  const comparable = selection.browseComparable ?? {}
  const comparableIdentity = browseIdentityFields(comparable)
  const catalogProduct = selection.catalogProduct
  const catalogAspects = catalogProduct?.aspects.flatMap((aspect) =>
    aspect.values.map((value) => ({ name: aspect.name, value }))) ?? []
  const trading = input.trading ?? {}
  const capture = input.capture
  const facts: OfficialIdentityFacts = {
    productName: text(trading.title) ?? capture.productName,
    brand: text(trading.brand) ?? comparableIdentity.brand ?? catalogProduct?.brand ?? null,
    manufacturer: text(trading.manufacturer),
    gtin: text(trading.gtin) ?? comparableIdentity.gtin ?? catalogProduct?.gtins[0] ?? null,
    mpn: text(trading.mpn) ?? comparableIdentity.mpn ?? catalogProduct?.mpns[0] ?? null,
    model: text(trading.model) ?? comparableIdentity.model ??
      aspectValue(catalogAspects, ["model", "model number"]),
    size: text(trading.size) ?? capture.size ?? comparableIdentity.size ??
      aspectValue(catalogAspects, ["size", "unit size"]),
    color: text(trading.color) ?? comparableIdentity.color ??
      aspectValue(catalogAspects, ["color"]),
    scent: text(trading.scent) ?? comparableIdentity.scent ??
      aspectValue(catalogAspects, ["scent", "fragrance"]),
    variant: text(trading.variant) ?? capture.variant,
    packCount: integer(trading.packCount) ?? capture.packCount,
    unitCount: integer(trading.unitCount) ?? capture.unitCount,
    condition: text(trading.condition) ?? capture.condition ?? "new",
    categoryId: text(trading.categoryId) ?? text(input.taxonomy?.categoryId) ??
      text(comparable.categoryId) ?? catalogProduct?.categoryId ?? null,
  }
  // Product Research does not prove that a UPC shown around a multipack is a
  // separately assigned offer GTIN; never inherit the unit GTIN automatically.
  if (facts.packCount !== 1) facts.gtin = null
  return facts
}

function baseFingerprint(identity: OfficialIdentityFacts) {
  return sha256({ version: PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION,
    brand: normalized(identity.brand), gtin: normalized(identity.gtin),
    mpn: normalized(identity.mpn), model: normalized(identity.model),
    productName: normalized(identity.productName), size: normalized(identity.size),
    color: normalized(identity.color), scent: normalized(identity.scent),
    variant: normalized(identity.variant), condition: normalized(identity.condition) })
}

function offerFingerprint(base: string, identity: OfficialIdentityFacts) {
  return sha256({ version: PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION,
    baseProductFingerprint: base, packCount: identity.packCount,
    unitCountPerItem: identity.unitCount, size: normalized(identity.size),
    color: normalized(identity.color), scent: normalized(identity.scent),
    variant: normalized(identity.variant),
    // A unit GTIN is deliberately excluded from an observed multipack offer.
    offerGtin: identity.packCount === 1 ? normalized(identity.gtin) : null })
}

function decisionSemantics(classification: ProductIdentityReconciliationClassification) {
  if (classification === "EXACT_LUNA_MATCH") return {
    evidenceClass: "CONFIRMED_SOLD_EXACT" as const,
    affectsSoldExactCount: true, affectsPackIntelligence: false,
  }
  if (classification === "SAME_PRODUCT_DIFFERENT_PACK") return {
    evidenceClass: "CONFIRMED_SOLD_RELATED_PACK" as const,
    affectsSoldExactCount: false, affectsPackIntelligence: true,
  }
  if (classification === "SAME_PRODUCT_DIFFERENT_SIZE") return {
    evidenceClass: "CONFIRMED_SOLD_RELATED_SIZE" as const,
    affectsSoldExactCount: false, affectsPackIntelligence: true,
  }
  return { evidenceClass: "NON_QUALIFYING" as const,
    affectsSoldExactCount: false, affectsPackIntelligence: false }
}

export function reconcileProductResearchIdentity(input: {
  observation: OfficialIdentityFacts
  queryTokens: string[]
  targets: ProductResearchCaptureTarget[]
}): ProductIdentityReconciliationDecision {
  const observedBase = baseFingerprint(input.observation)
  const observedOffer = offerFingerprint(observedBase, input.observation)
  const candidates = input.targets.map((target) => {
    const identity = normalizeProductIdentity(target.identity)
    const identifierExact = Boolean(
      input.observation.gtin && identity.gtin && sameFact(input.observation.gtin, identity.gtin) ||
      input.observation.brand && identity.manufacturerBrand &&
        sameFact(input.observation.brand, identity.manufacturerBrand) &&
        ((input.observation.mpn && identity.mpn && sameFact(input.observation.mpn, identity.mpn)) ||
          (input.observation.model && identity.model && sameFact(input.observation.model, identity.model))),
    )
    const nameScore = tokenSimilarity(input.queryTokens, target.productName)
    const officialLinkBoost = target.officialLinkVerified ? .22 : 0
    const identifierBoost = identifierExact ? .35 : 0
    return { target, identity, identifierExact,
      score: Math.min(1, nameScore + officialLinkBoost + identifierBoost) }
  }).filter((entry) => entry.score >= .5)
    .sort((left, right) => right.score - left.score)
  if (!candidates.length) {
    return { classification: "NO_LUNA_MATCH", confidence: .2, target: null,
      matchedAttributes: {}, conflictingAttributes: {}, baseProductFingerprint: observedBase,
      lunaVariantFingerprint: null, observedOfferPackFingerprint: observedOffer,
      candidateOfferPackFingerprint: null, ...decisionSemantics("NO_LUNA_MATCH") }
  }
  const best = candidates[0]
  if (candidates[1] && best.score - candidates[1].score < .08 &&
    !(best.target.officialLinkVerified && !candidates[1].target.officialLinkVerified)) {
    return { classification: "AMBIGUOUS", confidence: Math.max(.25, best.score - .2), target: null,
      matchedAttributes: {}, conflictingAttributes: { candidateCount: candidates.length },
      baseProductFingerprint: observedBase, lunaVariantFingerprint: null,
      observedOfferPackFingerprint: observedOffer, candidateOfferPackFingerprint: null,
      ...decisionSemantics("AMBIGUOUS") }
  }
  const targetFacts: OfficialIdentityFacts = {
    productName: best.target.productName,
    brand: best.identity.manufacturerBrand, manufacturer: null, gtin: best.identity.gtin,
    mpn: best.identity.mpn, model: best.identity.model, size: best.identity.size,
    color: best.identity.color, scent: best.identity.scent, variant: best.identity.variant,
    packCount: best.identity.packCount, unitCount: best.identity.unitCount,
    condition: best.identity.condition, categoryId: null,
  }
  const matchedAttributes: JsonRecord = {}
  const conflictingAttributes: JsonRecord = {}
  for (const key of ["brand", "gtin", "mpn", "model", "size", "color", "scent", "variant",
    "packCount", "unitCount", "condition"] as const) {
    if (sameFact(input.observation[key], targetFacts[key])) matchedAttributes[key] = normalized(input.observation[key])
    else if (explicitConflict(input.observation[key], targetFacts[key])) {
      conflictingAttributes[key] = { observation: normalized(input.observation[key]),
        luna: normalized(targetFacts[key]) }
    }
  }
  const hardConflict = ["gtin", "mpn", "model"].some((key) => key in conflictingAttributes) ||
    "brand" in conflictingAttributes && best.score >= .7
  const variantMismatch = ["color", "scent", "variant"].some((key) => key in conflictingAttributes)
  const packMismatch = "packCount" in conflictingAttributes
  const sizeMismatch = "unitCount" in conflictingAttributes || "size" in conflictingAttributes
  const exactOfferFactsPresent = input.observation.packCount !== null && targetFacts.packCount !== null
  let classification: ProductIdentityReconciliationClassification
  if (hardConflict) classification = "CONFLICTED"
  else if (variantMismatch) classification = "DIFFERENT_VARIANT"
  // A different presentation is useful only after the base product has an
  // exact identifier link. Similar titles alone must never manufacture pack
  // intelligence for another product.
  else if (packMismatch && best.identifierExact) classification = "SAME_PRODUCT_DIFFERENT_PACK"
  else if (sizeMismatch && best.identifierExact) classification = "SAME_PRODUCT_DIFFERENT_SIZE"
  else if (packMismatch || sizeMismatch) classification = "AMBIGUOUS"
  else if (best.identifierExact && exactOfferFactsPresent) classification = "EXACT_LUNA_MATCH"
  else classification = "AMBIGUOUS"
  if (!["AMBIGUOUS", "NO_LUNA_MATCH"].includes(classification) && !best.target.supplierSku) {
    classification = "AMBIGUOUS"
    conflictingAttributes.supplierSku = "LUNA_MAPPING_INCOMPLETE"
  }
  const boundTarget = ["AMBIGUOUS", "NO_LUNA_MATCH"].includes(classification) ? null : best.target
  const candidateBase = baseFingerprint(targetFacts)
  const semantics = decisionSemantics(classification)
  return {
    classification,
    confidence: Math.round(Math.max(.2, Math.min(.99,
      best.score + (best.identifierExact ? .15 : 0) - (classification === "AMBIGUOUS" ? .2 : 0),
    )) * 100_000) / 100_000,
    target: boundTarget,
    matchedAttributes,
    conflictingAttributes,
    baseProductFingerprint: observedBase,
    lunaVariantFingerprint: boundTarget
      ? buildProductIdentityFingerprint(boundTarget.identity).fingerprint : null,
    observedOfferPackFingerprint: observedOffer,
    candidateOfferPackFingerprint: boundTarget ? offerFingerprint(candidateBase, targetFacts) : null,
    ...semantics,
  }
}

function captureFacts(row: Observation, query: string): OfficialIdentityFacts {
  const identity = normalizeProductIdentity(row.normalized_identity as ProductIdentityInput)
  return {
    productName: query || identity.normalizedProductName,
    brand: identity.manufacturerBrand, manufacturer: null, gtin: identity.gtin,
    mpn: identity.mpn, model: identity.model,
    size: row.detected_size ?? identity.size, color: identity.color, scent: identity.scent,
    variant: row.detected_variant ?? identity.variant,
    packCount: row.detected_offer_pack_count ?? identity.packCount,
    unitCount: row.detected_unit_count ?? identity.unitCount,
    condition: identity.condition ?? "new", categoryId: null,
  }
}

function safeReaderStatus(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  if (code.includes("429") || code.includes("RATE_LIMIT")) return "RATE_LIMITED"
  if (code.includes("NOT_CONFIGURED") || code.includes("ENV_MISSING")) return "NOT_CONFIGURED"
  if (code.includes("ITEM_ID_INVALID")) return "ITEM_ID_INVALID"
  return "UNAVAILABLE"
}

function readerStatusOrThrow(error: unknown) {
  // A 429 is control-plane state, not an ordinary missing source. Stop the
  // current batch immediately so the durable worker can persist Retry-After
  // and resume this exact checkpoint without consuming more calls.
  if (getEbayReadonlyRateLimitMetadata(error)) throw error
  return safeReaderStatus(error)
}

export function normalizeProductResearchTargetVariantScope(values: unknown) {
  if (!Array.isArray(values)) return null
  return [...new Set(values.map((value) => text(value, 160))
    .filter((value): value is string => Boolean(value)))].slice(0, 100)
}

async function loadTargets(
  supabase: SupabaseClient,
  accountKey: string,
  targetSupplierVariantIds?: string[],
) {
  const targetScope = normalizeProductResearchTargetVariantScope(targetSupplierVariantIds)
  // An explicitly requested but empty scope must never fall back to comparing
  // against the full Luna catalog. The caller planned a candidate-specific
  // reconciliation and no deterministic target is currently available.
  if (targetScope?.length === 0) return []
  let catalogQuery = supabase.from("market_radar_latest_variants")
    .select("product_id,supplier_product_id,supplier_variant_id,sku,barcode,title,variant_title,metadata")
    .eq("source_key", "lunaportex").limit(5_000)
  let linksQuery = supabase.from("ebay_manual_listing_links")
    .select("id,opportunity_id,supplier_variant_id,supplier_sku,verification_status,verification_method")
    .eq("account_key", accountKey).eq("marketplace_id", "EBAY_US")
    .eq("verification_status", "verified").limit(1_000)
  if (targetScope) {
    catalogQuery = catalogQuery.in("supplier_variant_id", targetScope)
    linksQuery = linksQuery.in("supplier_variant_id", targetScope)
  }
  const [catalogResult, linksResult] = await Promise.all([catalogQuery, linksQuery])
  if (catalogResult.error || linksResult.error) throw new Error("PRODUCT_IDENTITY_RECONCILIATION_TARGET_READ_FAILED")
  const catalogRows = (catalogResult.data ?? []).map(record)
  const productIds = [...new Set(catalogRows.map((row) => text(row.product_id, 160))
    .filter((value): value is string => Boolean(value)))]
  const descriptionResult = productIds.length
    ? await supabase.from("market_radar_products").select("id,body_html")
      .in("id", productIds).limit(5_000)
    : { data: [], error: null }
  if (descriptionResult.error) throw new Error("PRODUCT_IDENTITY_RECONCILIATION_TARGET_READ_FAILED")
  // Luna's official public product description is decoded only in memory. We
  // keep explicit labelled facts and a provenance hash; raw HTML/text never
  // enters the target, event, response, or database payload.
  const descriptionByProductId = new Map((descriptionResult.data ?? []).map((row) => {
    const productId = text(row.id, 160)
    if (!productId) return ["", null] as const
    return [productId, row.body_html] as const
  }).filter(([productId]) => Boolean(productId)))
  const opportunityIds = [...new Set((linksResult.data ?? []).map((row) => text(row.opportunity_id))
    .filter((value): value is string => Boolean(value)))]
  const opportunitiesResult = opportunityIds.length
    ? await supabase.from("ebay_luna_opportunity_queue")
      .select("id,supplier_product_id,product_title,variant_title,gtin,assessment")
      .in("id", opportunityIds)
    : { data: [], error: null }
  if (opportunitiesResult.error) throw new Error("PRODUCT_IDENTITY_RECONCILIATION_TARGET_READ_FAILED")
  const opportunities = new Map((opportunitiesResult.data ?? []).map((row) => [row.id, record(row)] as const))
  const verified = (linksResult.data ?? []).map((link) => targetFromVerifiedActiveListingLink({
    link: record(link), opportunity: opportunities.get(link.opportunity_id) ?? {},
  })).filter((target): target is ProductResearchCaptureTarget => Boolean(target))
  const catalog = catalogRows.map((row) => {
    const metadata = record(row.metadata)
    const offer = detectProductResearchOfferFacts(`${text(row.title) ?? ""} ${text(row.variant_title) ?? ""}`)
    const extracted = extractLunaOfficialDescriptionIdentity({
      bodyHtml: descriptionByProductId.get(text(row.product_id, 160) ?? "") ?? null,
      nativePackCount: integer(metadata.packCount) ?? offer.packCount,
    })
    const facts = extracted.facts
    const existingBrand = text(metadata.manufacturerBrand ?? metadata.brand, 100)
    const existingMpn = text(metadata.mpn ?? metadata.manufacturerPartNumber, 100)
    const existingModel = text(metadata.model ?? metadata.modelNumber, 100)
    const existingBarcode = text(row.barcode, 32)
    const descriptionUsed = Boolean(
      !existingBarcode && facts.gtin ||
      !existingBrand && facts.brand ||
      !existingMpn && facts.mpn ||
      !existingModel && facts.model,
    )
    return targetFromCatalogRow({ ...row,
      barcode: existingBarcode ?? facts.gtin,
      metadata: {
        ...metadata,
        manufacturerBrand: existingBrand ?? facts.brand,
        mpn: existingMpn ?? facts.mpn,
        model: existingModel ?? facts.model,
        packCount: integer(metadata.packCount) ?? facts.packCount,
        size: text(metadata.size, 100) ?? facts.size,
        identityEvidenceSource: descriptionUsed && extracted.evidenceHash
          ? "LUNA_OFFICIAL_PRODUCT_DESCRIPTION" : "LUNA_STRUCTURED_CATALOG",
        identityEvidenceHash: descriptionUsed ? extracted.evidenceHash : null,
      },
    })
  })
    .filter((target): target is ProductResearchCaptureTarget => Boolean(target))
  const byVariant = new Map<string, ProductResearchCaptureTarget>()
  for (const target of verified) byVariant.set(target.supplierVariantId, target)
  for (const target of catalog) if (!byVariant.has(target.supplierVariantId)) {
    byVariant.set(target.supplierVariantId, target)
  }
  return [...byVariant.values()]
}

async function latestEvents(supabase: SupabaseClient, accountKey: string) {
  const { data, error } = await supabase.from("marketplace_product_identity_reconciliation_events")
    .select("*").eq("marketplace_account_key", accountKey).eq("marketplace", "EBAY_US")
    .order("reconciled_at", { ascending: false }).limit(5_000)
  if (error) throw new Error("PRODUCT_IDENTITY_RECONCILIATION_EVENT_READ_FAILED")
  const byObservation = new Map<string, JsonRecord>()
  for (const row of data ?? []) if (!byObservation.has(row.observation_id)) {
    byObservation.set(row.observation_id, record(row))
  }
  return byObservation
}

export function productIdentityReconciliationBoundary(environment: NodeJS.ProcessEnv = process.env) {
  const branch = environment.VERCEL_GIT_COMMIT_REF?.trim() ?? ""
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ""
  return {
    preview: environment.VERCEL_ENV === "preview",
    staging: supabaseUrl.includes("vsfthqydfrdzulldbfbe"),
    branchMatch: branch === "feature/centralize-ebay-mobile-command-center",
    productionBlocked: true as const,
    openAiCalls: 0 as const,
    ebayWrites: 0 as const,
  }
}

export async function reopenTop20RunForReconciledVariants(input: {
  supabase: SupabaseClient
  accountKey: string
  supplierVariantIds: string[]
  soldEvidenceVersion: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const variants = [...new Set(input.supplierVariantIds.filter(Boolean))]
  if (!variants.length) return { runId: null, affectedTargets: 0, shouldSchedule: false,
    continuationGeneration: 0, expectedBatch: 0, discoveryRepeated: false }
  const { data: run, error: runError } = await input.supabase
    .from("marketplace_listing_approval_queue_runs").select("*")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (runError) throw new Error("PRODUCT_IDENTITY_RECONCILIATION_RUN_READ_FAILED")
  if (!run) return { runId: null, affectedTargets: 0, shouldSchedule: false,
    continuationGeneration: 0, expectedBatch: 0, discoveryRepeated: false }
  const { data: targets, error: targetReadError } = await input.supabase
    .from("marketplace_listing_approval_queue_scan_targets")
    .select("id,supplier_variant_id,status").eq("run_id", run.id)
    .eq("marketplace_account_key", input.accountKey).in("supplier_variant_id", variants)
  if (targetReadError) throw new Error("PRODUCT_IDENTITY_RECONCILIATION_TARGET_READ_FAILED")
  const targetIds = (targets ?? []).filter((target) => target.status !== "CLAIMED").map((target) => target.id)
  if (!targetIds.length) return { runId: run.id, affectedTargets: 0, shouldSchedule: false,
    continuationGeneration: Number(run.continuation_generation ?? 0),
    expectedBatch: Number(run.current_batch ?? 0) + 1, discoveryRepeated: false }
  const { error: restoreError } = await input.supabase
    .from("marketplace_listing_approval_queue_scan_targets")
    .update({ status: "PRESELECTED", preselected: true, processing_phase: null,
      lease_owner: null, lease_expires_at: null, processed_at: null,
      next_retry_at: null, last_error_code: null,
      evidence_reanalysis_priority: 100,
      evidence_reanalysis_version: input.soldEvidenceVersion,
      evidence_reanalysis_requested_at: now.toISOString(),
      evidence_reanalysis_completed_at: null,
      updated_at: now.toISOString() })
    .in("id", targetIds).eq("run_id", run.id)
  if (restoreError) throw new Error("PRODUCT_IDENTITY_RECONCILIATION_TARGET_RESTORE_FAILED")
  await input.supabase.from("marketplace_listing_approval_queue_items")
    .update({ internal_status: "REANALYSIS_REQUIRED", updated_at: now.toISOString() })
    .eq("run_id", run.id).eq("marketplace_account_key", input.accountKey)
    .in("supplier_variant_id", variants)
  const token = createTop20ContinuationToken()
  const generation = Number(run.continuation_generation ?? 0) + 1
  const { data: updated, error: updateError } = await input.supabase
    .from("marketplace_listing_approval_queue_runs").update({
      status: "PARTIAL", automation_status: "PARTIAL_AUTO_CONTINUING",
      scan_phase: "LOOP1_ANALYSIS", continuation_token_hash: hashTop20ContinuationToken(token),
      continuation_generation: generation, continuation_dispatch_status: "RETRY_SCHEDULED",
      sold_evidence_version: input.soldEvidenceVersion, next_continuation_at: now.toISOString(),
      lease_owner: null, lease_expires_at: null, last_error_code: null, completed_at: null,
      last_activity_at: now.toISOString(), updated_at: now.toISOString(),
      lock_version: Number(run.lock_version ?? 0) + 1,
    }).eq("id", run.id).eq("lock_version", run.lock_version).select("id,current_batch").maybeSingle()
  if (updateError || !updated) throw new Error("PRODUCT_IDENTITY_RECONCILIATION_RUN_REOPEN_FAILED")
  return { runId: run.id, affectedTargets: targetIds.length, shouldSchedule: true,
    continuationGeneration: generation, expectedBatch: Number(updated.current_batch ?? 0) + 1,
    discoveryRepeated: false }
}

export async function reconcileProductResearchObservations(input: {
  supabase: SupabaseClient
  accountKey: string
  observationIds?: string[]
  targetSupplierVariantIds?: string[]
  tradingObservationIds?: string[]
  maxTradingReadsPerBatch?: number
  now?: Date
  environment?: NodeJS.ProcessEnv
  tradingReader?: TradingReader
  browseReader?: BrowseReader
  catalogReader?: CatalogReader
  taxonomyReader?: TaxonomyReader
}) {
  const boundary = productIdentityReconciliationBoundary(input.environment ?? process.env)
  if (!boundary.preview || !boundary.staging || !boundary.branchMatch) {
    throw new Error("PRODUCT_IDENTITY_RECONCILIATION_PREVIEW_STAGING_REQUIRED")
  }
  const now = input.now ?? new Date()
  let query = input.supabase.from("marketplace_product_research_capture_observations")
    .select("id,capture_batch_id,source_listing_id,normalized_identity,detected_offer_pack_count,detected_unit_count,detected_size,detected_variant,keyword_signals,match_classification,matched_supplier_variant_id,confirmed_sold_quantity,last_sold_date")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .eq("evidence_reviewed", true).order("created_at", { ascending: true }).limit(200)
  if (input.observationIds?.length) query = query.in("id", input.observationIds)
  const { data: rows, error: observationError } = await query
  if (observationError) throw new Error("PRODUCT_IDENTITY_RECONCILIATION_OBSERVATION_READ_FAILED")
  const observations = (rows ?? []) as Observation[]
  const batchIds = [...new Set(observations.map((row) => row.capture_batch_id))]
  const { data: batches, error: batchError } = batchIds.length
    ? await input.supabase.from("marketplace_product_research_capture_batches")
      .select("id,search_keyword_patterns").in("id", batchIds)
    : { data: [], error: null }
  if (batchError) throw new Error("PRODUCT_IDENTITY_RECONCILIATION_BATCH_READ_FAILED")
  const batchTokens = new Map((batches ?? []).map((batch) =>
    [batch.id, Array.isArray(batch.search_keyword_patterns) ? batch.search_keyword_patterns : []] as const))
  const targetScope = normalizeProductResearchTargetVariantScope(input.targetSupplierVariantIds)
  const [targets, previousByObservation] = await Promise.all([
    loadTargets(input.supabase, input.accountKey, targetScope ?? undefined),
    latestEvents(input.supabase, input.accountKey),
  ])
  let gateway: {
    runEbaySellerKeywordDemandValidation: BrowseReader
    searchEbayCatalogIdentity: CatalogReader
    getEbayTaxonomyListingIntelligence: TaxonomyReader
  } | null = null
  if (!input.browseReader || !input.catalogReader || !input.taxonomyReader) {
    // @ts-expect-error Node's native TypeScript runner requires explicit extensions.
    gateway = await import("./ebay-seller-keyword-demand-gateway.ts")
  }
  const tradingReader = input.tradingReader ?? readEbayTradingItemIdentityReadonly
  const browseReader = input.browseReader ?? gateway!.runEbaySellerKeywordDemandValidation
  const catalogReader = input.catalogReader ?? gateway!.searchEbayCatalogIdentity
  const taxonomyReader = input.taxonomyReader ?? gateway!.getEbayTaxonomyListingIntelligence
  const requestedTradingIds = Array.isArray(input.tradingObservationIds)
    ? new Set(input.tradingObservationIds.map((value) => text(value, 80)).filter(Boolean))
    : null
  const maximumTradingReadsPerBatch = Math.max(0, Math.min(2,
    Number.isInteger(input.maxTradingReadsPerBatch) ? Number(input.maxTradingReadsPerBatch) : 2,
  ))
  const tradingReadsByBatch = new Map<string, number>()
  const officialCallBudget = { trading: 0, browse: 0, catalog: 0, taxonomy: 0 }
  type SharedOfficialEvidence = {
    browse: JsonRecord | null
    catalog: JsonRecord | null
    taxonomy: JsonRecord | null
    outcomes: JsonRecord
  }
  const sharedEvidenceByBatch = new Map<string, Promise<SharedOfficialEvidence>>()
  const plannedTarget = targets.length === 1 ? targets[0] : null
  const plannedIdentity = plannedTarget
    ? normalizeProductIdentity(plannedTarget.identity) : null
  const sharedOfficialEvidence = (
    observation: Observation,
    captured: OfficialIdentityFacts,
    fallbackQueryText: string,
  ) => {
    const existing = sharedEvidenceByBatch.get(observation.capture_batch_id)
    if (existing) return existing
    const plannedTokens = [...new Set((batchTokens.get(observation.capture_batch_id) ?? [])
      .flatMap(tokens))]
    // Shared market readers use only the durable planned-query tokens. Row
    // keywords can vary and must not multiply Browse/Catalog/Taxonomy calls.
    const sharedQueryText = plannedTokens.join(" ").slice(0, 240) || fallbackQueryText
    const pending = (async (): Promise<SharedOfficialEvidence> => {
      const outcomes: JsonRecord = {}
      const browsePromise = (async () => {
        try {
          officialCallBudget.browse += 1
          const result = record(await browseReader({ productName: sharedQueryText,
            packQuantity: plannedIdentity?.packCount ?? null,
            size: plannedIdentity?.size ?? null,
            gtin: plannedIdentity?.gtinValid ? plannedIdentity.gtin : null,
            brand: plannedIdentity?.manufacturerBrand ?? null,
            mpn: plannedIdentity?.mpn ?? null,
            model: plannedIdentity?.model ?? null }))
          outcomes.browse = "READY"
          outcomes.browseQueryStrategy = plannedIdentity?.gtinValid ? "GTIN"
            : plannedIdentity?.manufacturerBrand && (plannedIdentity.mpn || plannedIdentity.model)
              ? "BRAND_MPN" : "PLANNED_NORMALIZED_IDENTITY"
          outcomes.browseComparableCount = Array.isArray(result.comparableEvidence)
            ? result.comparableEvidence.length : 0
          return result
        } catch (error) {
          outcomes.browse = readerStatusOrThrow(error)
          return null
        }
      })()
      const catalogPromise = (async () => {
        try {
          officialCallBudget.catalog += 1
          const result = record(await catalogReader({ query: sharedQueryText,
            gtin: plannedIdentity?.gtinValid ? plannedIdentity.gtin : null,
            mpn: plannedIdentity?.mpn ?? plannedIdentity?.model ?? null }))
          outcomes.catalog = text(result.status) ?? "UNAVAILABLE"
          outcomes.catalogProductCount = Array.isArray(result.products) ? result.products.length : 0
          return result
        } catch (error) {
          outcomes.catalog = readerStatusOrThrow(error)
          return null
        }
      })()
      const [browse, catalog] = await Promise.all([browsePromise, catalogPromise])
      const preliminary = officialFactsFromSources({
        capture: { ...captured, productName: sharedQueryText },
        trading: null,
        browse,
        catalog,
        taxonomy: null,
        anchor: plannedTarget?.identity ?? null,
      })
      let taxonomy: JsonRecord | null = null
      try {
        officialCallBudget.taxonomy += 1
        taxonomy = record(await taxonomyReader(
          preliminary.productName ?? sharedQueryText,
          preliminary.categoryId,
        ))
        outcomes.taxonomy = text(taxonomy.status) ?? "UNAVAILABLE"
      } catch (error) {
        outcomes.taxonomy = readerStatusOrThrow(error)
      }
      return { browse, catalog, taxonomy, outcomes }
    })()
    // Cache the in-flight promise as well as its resolution/rejection so a
    // batch can never fan out duplicate shared reads within one attempt.
    sharedEvidenceByBatch.set(observation.capture_batch_id, pending)
    return pending
  }
  const results: JsonRecord[] = []
  const affectedVariants = new Set<string>()
  const eventKeys: string[] = []
  for (const observation of observations) {
    const queryTokens = [...new Set([...(batchTokens.get(observation.capture_batch_id) ?? []),
      ...observation.keyword_signals].flatMap(tokens))]
    const queryText = queryTokens.join(" ").slice(0, 240)
    const captured = captureFacts(observation, queryText)
    const sourcesConsulted = [
      "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
      "EBAY_TRADING_GET_ITEM_READONLY",
    ]
    const outcomes: JsonRecord = { capture: "READY",
      targetScope: targetScope ? "PLANNED_CANDIDATES" : "LATEST_LUNA_CATALOG",
      targetScopeCandidateCount: targetScope?.length ?? targets.length }
    let trading: JsonRecord | null = null
    const tradingReads = tradingReadsByBatch.get(observation.capture_batch_id) ?? 0
    const tradingSelected = observation.source_listing_id && tradingReads < maximumTradingReadsPerBatch &&
      (!requestedTradingIds || requestedTradingIds.has(observation.id))
    if (tradingSelected && observation.source_listing_id) {
      try {
        officialCallBudget.trading += 1
        tradingReadsByBatch.set(observation.capture_batch_id, tradingReads + 1)
        trading = record(await tradingReader(observation.source_listing_id))
        outcomes.trading = "READY"
      } catch (error) { outcomes.trading = readerStatusOrThrow(error) }
    } else if (!observation.source_listing_id) outcomes.trading = "NOT_APPLICABLE_ITEM_ID_MISSING"
    else outcomes.trading = "NOT_SELECTED_BOUNDED_DETAIL_BUDGET"
    const shared = await sharedOfficialEvidence(observation, captured, queryText)
    const browse = shared.browse
    const catalog = shared.catalog
    const taxonomy = shared.taxonomy
    sourcesConsulted.push("EBAY_BROWSE_OFFICIAL_READONLY")
    sourcesConsulted.push("EBAY_CATALOG_OFFICIAL_READONLY")
    sourcesConsulted.push("EBAY_TAXONOMY_OFFICIAL_READONLY")
    Object.assign(outcomes, shared.outcomes)
    const facts = officialFactsFromSources({
      capture: captured, trading, browse, catalog, taxonomy,
      anchor: plannedTarget?.identity ?? null,
    })
    const decision = reconcileProductResearchIdentity({ observation: facts, queryTokens, targets })
    if (decision.target?.identityEvidenceSource === "LUNA_OFFICIAL_PRODUCT_DESCRIPTION") {
      sourcesConsulted.push("LUNA_OFFICIAL_PRODUCT_DESCRIPTION")
      outcomes.lunaIdentity = "EXPLICIT_LABELLED_FACTS_READY"
    } else outcomes.lunaIdentity = "STRUCTURED_CATALOG_ONLY"
    const previous = previousByObservation.get(observation.id) ?? null
    const deduplicationKey = sha256({ observationId: observation.id,
      version: PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION,
      classification: decision.classification,
      target: decision.target?.supplierVariantId ?? null,
      observedOffer: decision.observedOfferPackFingerprint,
      candidateOffer: decision.candidateOfferPackFingerprint,
      sources: outcomes })
    eventKeys.push(deduplicationKey)
    const event = {
      marketplace_account_key: input.accountKey, marketplace: "EBAY_US",
      observation_id: observation.id,
      reconciliation_version: PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION,
      previous_reconciliation_event_id: previous?.id ?? null,
      source_listing_id: observation.source_listing_id,
      luna_supplier_product_id: decision.target?.supplierProductId ?? null,
      luna_supplier_variant_id: decision.target?.supplierVariantId ?? null,
      supplier_sku: decision.target?.supplierSku ?? null,
      classification: decision.classification, evidence_class: decision.evidenceClass,
      confidence: decision.confidence, matched_attributes: decision.matchedAttributes,
      conflicting_attributes: decision.conflictingAttributes,
      sources_consulted: sourcesConsulted, source_outcomes: outcomes,
      base_product_fingerprint: decision.baseProductFingerprint,
      luna_variant_fingerprint: decision.lunaVariantFingerprint,
      observed_offer_pack_fingerprint: decision.observedOfferPackFingerprint,
      candidate_offer_pack_fingerprint: decision.candidateOfferPackFingerprint,
      affects_sold_exact_count: decision.affectsSoldExactCount,
      affects_pack_intelligence: decision.affectsPackIntelligence,
      observation_observed_at: observation.last_sold_date,
      reconciled_at: now.toISOString(), deduplication_key: deduplicationKey,
      pii_stored: false, raw_competitor_content_stored: false,
      competitor_images_downloaded: 0, openai_calls: 0, ebay_writes: 0,
    }
    const alreadySame = previous?.deduplication_key === deduplicationKey
    if (!alreadySame) {
      const { error: insertError } = await input.supabase
        .from("marketplace_product_identity_reconciliation_events").insert(event)
      if (insertError && insertError.code !== "23505") {
        throw new Error("PRODUCT_IDENTITY_RECONCILIATION_EVENT_PERSIST_FAILED")
      }
    }
    if (decision.target && (decision.affectsSoldExactCount || decision.affectsPackIntelligence)) {
      affectedVariants.add(decision.target.supplierVariantId)
    }
    results.push({ observationId: observation.id,
      previousClassification: previous?.classification ?? observation.match_classification,
      classification: decision.classification, confidence: decision.confidence,
      sourcesUsed: sourcesConsulted, sourceOutcomes: outcomes,
      supplierVariantId: decision.target?.supplierVariantId ?? null,
      supplierSku: decision.target?.supplierSku ?? null,
      observedPackCount: facts.packCount,
      candidatePackCount: decision.target?.identity.packCount ?? null,
      confirmedSoldQuantity: observation.confirmed_sold_quantity,
      soldExactCountImpact: decision.affectsSoldExactCount
        ? observation.confirmed_sold_quantity : 0,
      packIntelligenceImpact: decision.affectsPackIntelligence
        ? observation.confirmed_sold_quantity : 0,
      eventAppended: !alreadySame })
  }
  const version = sha256({ reconciliationVersion: PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION,
    targetScope: targetScope?.map((variantId) => sha256(variantId)).sort() ?? null,
    eventKeys: eventKeys.sort() })
  const reanalysis = await reopenTop20RunForReconciledVariants({
    supabase: input.supabase, accountKey: input.accountKey,
    supplierVariantIds: [...affectedVariants], soldEvidenceVersion: version, now,
  })
  return { observationsProcessed: observations.length, results, reanalysis,
    aggregates: aggregateProductIdentityReconciliation(results),
    officialCallBudget: { ...officialCallBudget,
      total: Object.values(officialCallBudget).reduce((sum, value) => sum + value, 0),
      maximumTradingReadsPerBatch,
      sharedQueryReadsPerBatch: true,
      unit: "READER_INVOCATIONS_NOT_HTTP_REQUESTS" },
    rawObservationChanged: false, customLabelComparedToSupplierSku: false,
    competitorSkuComparedToSupplierSku: false, piiStored: false,
    competitorImagesDownloaded: 0, openAiCalls: 0, ebayWrites: 0,
    productionChanged: false }
}

export function aggregateProductIdentityReconciliation(rows: JsonRecord[]) {
  const count = (classification: ProductIdentityReconciliationClassification) =>
    rows.filter((row) => row.classification === classification).length
  return {
    reconciled: rows.length,
    exact: count("EXACT_LUNA_MATCH"),
    differentPack: count("SAME_PRODUCT_DIFFERENT_PACK"),
    differentSize: count("SAME_PRODUCT_DIFFERENT_SIZE"),
    differentVariant: count("DIFFERENT_VARIANT"),
    ambiguous: count("AMBIGUOUS"),
    withoutLunaMatch: count("NO_LUNA_MATCH"),
    conflicted: count("CONFLICTED"),
    candidatesEnriched: new Set(rows.map((row) => row.supplierVariantId).filter(Boolean)).size,
  }
}

export async function getProductIdentityReconciliationStatus(input: {
  supabase: SupabaseClient
  accountKey: string
}) {
  const [{ data: events, error: eventError }, { data: run, error: runError }] = await Promise.all([
    input.supabase.from("marketplace_product_identity_reconciliation_events")
      .select("observation_id,classification,luna_supplier_variant_id,reconciled_at")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .order("reconciled_at", { ascending: false }).limit(5_000),
    input.supabase.from("marketplace_listing_approval_queue_runs").select("id,ready_count")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ])
  if (eventError || runError) throw new Error("PRODUCT_IDENTITY_RECONCILIATION_STATUS_READ_FAILED")
  const latest = new Map<string, JsonRecord>()
  for (const row of events ?? []) if (!latest.has(row.observation_id)) latest.set(row.observation_id, record(row))
  const rows = [...latest.values()].map((row) => ({ classification: row.classification,
    supplierVariantId: row.luna_supplier_variant_id }))
  return { version: PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION,
    aggregates: aggregateProductIdentityReconciliation(rows),
    readyResultCount: Number(run?.ready_count ?? 0), latestReconciledAt: events?.[0]?.reconciled_at ?? null,
    customLabelComparedToSupplierSku: false, competitorSkuComparedToSupplierSku: false,
    rawObservationsChanged: false, piiStored: false, competitorImagesDownloaded: 0,
    openAiCalls: 0, ebayWrites: 0, productionChanged: false }
}
