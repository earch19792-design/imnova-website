import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { buildProductIdentityFingerprint, normalizeProductIdentity } from "./ebay-winner-evidence-v2.ts"
import type { ProductIdentityInput } from "./ebay-winner-evidence-v2"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { targetFromCatalogRow, targetFromVerifiedActiveListingLink, type ProductResearchCaptureTarget } from "./ebay-product-research-browser-capture.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { readEbayTradingItemIdentityReadonly } from "./ebay-trading-item-identity-readonly.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { createTop20ContinuationToken, hashTop20ContinuationToken } from "./ebay-listing-ai-top20-automation.ts"

export const PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION =
  "PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_V1_2026_07_17"

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

type OfficialIdentityFacts = {
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

function mostFrequent(values: Array<string | null>) {
  const counts = new Map<string, { value: string; count: number }>()
  for (const value of values) {
    const key = normalized(value)
    if (!key || !value) continue
    const current = counts.get(key)
    counts.set(key, { value, count: (current?.count ?? 0) + 1 })
  }
  return [...counts.values()].sort((left, right) => right.count - left.count)[0] ?? null
}

function officialFactsFromSources(input: {
  capture: OfficialIdentityFacts
  trading: JsonRecord | null
  browse: JsonRecord | null
  catalog: JsonRecord | null
  taxonomy: JsonRecord | null
}) {
  const comparables = (Array.isArray(input.browse?.comparableEvidence)
    ? input.browse.comparableEvidence : []).map(record)
  const catalogProducts = (Array.isArray(input.catalog?.products) ? input.catalog.products : []).map(record)
  const catalogAspects = catalogProducts.flatMap((product) =>
    (Array.isArray(product.aspects) ? product.aspects : []).map(record).flatMap((aspect) => {
      const name = text(aspect.name)
      return (Array.isArray(aspect.values) ? aspect.values : []).map((value) => ({ name, value }))
    }))
  const frequent = (values: Array<string | null>) => {
    const result = mostFrequent(values)
    return result && (result.count >= 2 || values.filter(Boolean).length === 1) ? result.value : null
  }
  const trading = input.trading ?? {}
  const capture = input.capture
  const facts: OfficialIdentityFacts = {
    productName: text(trading.title) ?? capture.productName,
    brand: text(trading.brand) ?? frequent([
      ...comparables.map((row) => text(row.brand)),
      ...catalogProducts.map((row) => text(row.brand)),
    ]),
    manufacturer: text(trading.manufacturer),
    gtin: text(trading.gtin) ?? frequent([
      ...comparables.map((row) => text(row.gtin)),
      ...catalogProducts.flatMap((row) => (Array.isArray(row.gtins) ? row.gtins : []).map(text)),
    ]),
    mpn: text(trading.mpn) ?? frequent([
      ...comparables.map((row) => text(row.mpn)),
      ...catalogProducts.flatMap((row) => (Array.isArray(row.mpns) ? row.mpns : []).map(text)),
    ]),
    model: text(trading.model) ?? aspectValue(catalogAspects, ["model", "model number"]),
    size: text(trading.size) ?? capture.size ?? frequent(comparables.map((row) => text(row.size))) ??
      aspectValue(catalogAspects, ["size", "unit size"]),
    color: text(trading.color) ?? frequent(comparables.map((row) => text(row.color))) ??
      aspectValue(catalogAspects, ["color"]),
    scent: text(trading.scent) ?? aspectValue(catalogAspects, ["scent", "fragrance"]),
    variant: text(trading.variant) ?? capture.variant,
    packCount: integer(trading.packCount) ?? capture.packCount,
    unitCount: integer(trading.unitCount) ?? capture.unitCount,
    condition: text(trading.condition) ?? capture.condition ?? "new",
    categoryId: text(trading.categoryId) ?? text(input.taxonomy?.categoryId) ??
      frequent(comparables.map((row) => text(row.categoryId))) ??
      frequent(catalogProducts.map((row) => text(row.categoryId))),
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
  else if (packMismatch) classification = "SAME_PRODUCT_DIFFERENT_PACK"
  else if (sizeMismatch) classification = "SAME_PRODUCT_DIFFERENT_SIZE"
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

async function loadTargets(supabase: SupabaseClient, accountKey: string) {
  const [catalogResult, linksResult] = await Promise.all([
    supabase.from("market_radar_latest_variants")
      .select("product_id,supplier_product_id,supplier_variant_id,sku,barcode,title,variant_title,metadata")
      .eq("source_key", "lunaportex").limit(5_000),
    supabase.from("ebay_manual_listing_links")
      .select("id,opportunity_id,supplier_variant_id,supplier_sku,verification_status,verification_method")
      .eq("account_key", accountKey).eq("marketplace_id", "EBAY_US")
      .eq("verification_status", "verified").limit(1_000),
  ])
  if (catalogResult.error || linksResult.error) throw new Error("PRODUCT_IDENTITY_RECONCILIATION_TARGET_READ_FAILED")
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
  const catalog = (catalogResult.data ?? []).map((row) => targetFromCatalogRow(record(row)))
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
      next_retry_at: null, last_error_code: null, updated_at: now.toISOString() })
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
  const [targets, previousByObservation] = await Promise.all([
    loadTargets(input.supabase, input.accountKey), latestEvents(input.supabase, input.accountKey),
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
    const outcomes: JsonRecord = { capture: "READY" }
    let trading: JsonRecord | null = null
    if (observation.source_listing_id) {
      try { trading = record(await tradingReader(observation.source_listing_id)); outcomes.trading = "READY" }
      catch (error) { outcomes.trading = safeReaderStatus(error) }
    } else outcomes.trading = "NOT_APPLICABLE_ITEM_ID_MISSING"
    let browse: JsonRecord | null = null
    sourcesConsulted.push("EBAY_BROWSE_OFFICIAL_READONLY")
    try {
      browse = record(await browseReader({ productName: queryText,
        packQuantity: captured.packCount, size: captured.size }))
      outcomes.browse = "READY"
      outcomes.browseComparableCount = Array.isArray(browse.comparableEvidence)
        ? browse.comparableEvidence.length : 0
    } catch (error) { outcomes.browse = safeReaderStatus(error) }
    let catalog: JsonRecord | null = null
    sourcesConsulted.push("EBAY_CATALOG_OFFICIAL_READONLY")
    try {
      catalog = record(await catalogReader({ query: queryText,
        gtin: captured.gtin, mpn: captured.mpn }))
      outcomes.catalog = text(catalog.status) ?? "UNAVAILABLE"
      outcomes.catalogProductCount = Array.isArray(catalog.products) ? catalog.products.length : 0
    } catch (error) { outcomes.catalog = safeReaderStatus(error) }
    const preliminary = officialFactsFromSources({ capture: captured, trading, browse, catalog, taxonomy: null })
    let taxonomy: JsonRecord | null = null
    sourcesConsulted.push("EBAY_TAXONOMY_OFFICIAL_READONLY")
    try {
      taxonomy = record(await taxonomyReader(preliminary.productName ?? queryText, preliminary.categoryId))
      outcomes.taxonomy = text(taxonomy.status) ?? "UNAVAILABLE"
    } catch (error) { outcomes.taxonomy = safeReaderStatus(error) }
    const facts = officialFactsFromSources({ capture: captured, trading, browse, catalog, taxonomy })
    const decision = reconcileProductResearchIdentity({ observation: facts, queryTokens, targets })
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
      soldExactCountImpact: decision.affectsSoldExactCount
        ? observation.confirmed_sold_quantity : 0,
      packIntelligenceImpact: decision.affectsPackIntelligence
        ? observation.confirmed_sold_quantity : 0,
      eventAppended: !alreadySame })
  }
  const version = sha256({ reconciliationVersion: PRODUCT_RESEARCH_IDENTITY_RECONCILIATION_VERSION,
    eventKeys: eventKeys.sort() })
  const reanalysis = await reopenTop20RunForReconciledVariants({
    supabase: input.supabase, accountKey: input.accountKey,
    supplierVariantIds: [...affectedVariants], soldEvidenceVersion: version, now,
  })
  return { observationsProcessed: observations.length, results, reanalysis,
    aggregates: aggregateProductIdentityReconciliation(results),
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
