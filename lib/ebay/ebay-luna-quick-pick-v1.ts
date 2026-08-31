import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  fetchDirectedLunaProduct,
  parseDirectedLunaProductUrl,
  type DirectedLunaProduct,
} from
  // @ts-expect-error Node direct TypeScript tests require the explicit extension;
  // the production bundler resolves the same source module.
  "./ebay-luna-directed-product-import.ts"
import {
  buildRadarRevenueFactoryCandidateBatchV1,
  ensureRadarCandidateEconomicsPreflightsV1,
  materializeRadarRevenueFactoryCandidateBatchV1,
  readAlreadyLiveExactLunaIdentitiesV1,
  readRadarRevenueFactoryLunaCatalogV1,
  type RadarRevenueFactoryCandidateV1,
} from
  // @ts-expect-error Node direct TypeScript tests require the explicit extension;
  // the production bundler resolves the same source module.
  "./ebay-opportunity-radar-revenue-factory-adapter-v1.ts"
import type { RadarMarketplaceTaxonomyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1.ts"

export const LUNA_QUICK_PICK_FAST_LISTING_V1 =
  "LUNA_QUICK_PICK_FAST_LISTING_V1" as const
export const LUNA_QUICK_PICK_MAX_INPUTS = 20
export const LUNA_QUICK_PICK_CONCURRENCY = 4

type JsonRecord = Record<string, unknown>
type RadarBatch = ReturnType<typeof buildRadarRevenueFactoryCandidateBatchV1>

export type LunaQuickPickVariantV1 = Readonly<{
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  title: string
  available: boolean
  supplierCostUsd: number
}>

export type LunaQuickPickCardV1 = Readonly<{
  sourceUrl: string
  canonicalUrl: string | null
  sourceSku: string | null
  lunaProductId: string | null
  lunaVariantId: string | null
  candidateId: string | null
  opportunityId: string | null
  candidateKey: string | null
  listingPackageId: string | null
  title: string | null
  state: "WAITING" | "RUNNING" | "BLOCKED" | "READY"
  lastStage: string
  disposition: string
  exactBlocker: string | null
  variantSelectionRequired: boolean
  variants: readonly LunaQuickPickVariantV1[]
  alreadyLive: boolean
  linkedLiveItemIds: readonly string[]
  stages: Readonly<Record<string, "WAITING" | "RUNNING" | "PASS" | "BLOCKED">>
  dollarCheck: JsonRecord | null
  elapsedMs: number
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().slice(0, maximum) : null
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

function identityKey(productId: string, variantId: string, sku: string) {
  return `${productId}\n${variantId}\n${sku}`
}

function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(code)
    ? code : "LUNA_QUICK_PICK_PROCESSING_FAILED"
}

function canonicalRowUrl(row: JsonRecord) {
  try {
    return parseDirectedLunaProductUrl(row.product_url).canonicalUrl
  } catch {
    return null
  }
}

function explicitVariantId(value: string) {
  try {
    const variant = new URL(value).searchParams.get("variant")?.trim() ?? ""
    return /^\d{1,30}$/.test(variant) ? variant : null
  } catch {
    return null
  }
}

export function normalizeLunaQuickPickUrlsV1(value: unknown) {
  const collected = collectLunaQuickPickInputsV1(value)
  if (collected.invalid.length) throw new Error("LUNA_QUICK_PICK_URL_INVALID")
  return collected.urls
}

function collectLunaQuickPickInputsV1(value: unknown): Readonly<{
  urls: readonly string[]
  invalid: readonly Readonly<{ sourceUrl: string; blocker: string }>[]
}> {
  const input = Array.isArray(value) ? value : typeof value === "string"
    ? value.split(/\r?\n/) : []
  const normalized = new Map<string, string>()
  const invalid: Readonly<{ sourceUrl: string; blocker: string }>[] = []
  for (const entry of input) {
    const source = text(entry, 2_000)
    if (!source) continue
    if (normalized.size + invalid.length >= LUNA_QUICK_PICK_MAX_INPUTS) {
      throw new Error("LUNA_QUICK_PICK_INPUT_LIMIT_EXCEEDED")
    }
    try {
      const parsed = parseDirectedLunaProductUrl(source)
      const variant = explicitVariantId(source)
      const key = `${parsed.canonicalUrl}\n${variant ?? ""}`
      if (!normalized.has(key)) normalized.set(key, source)
    } catch {
      invalid.push(Object.freeze({ sourceUrl: source,
        blocker: "LUNA_QUICK_PICK_URL_INVALID" }))
    }
  }
  if (!normalized.size && !invalid.length) {
    throw new Error("LUNA_QUICK_PICK_URL_REQUIRED")
  }
  return Object.freeze({ urls: Object.freeze([...normalized.values()]),
    invalid: Object.freeze(invalid) })
}

function publicProductRows(product: DirectedLunaProduct, observedAt: string) {
  return product.variants.map((variant) => ({
    product_id: product.productId,
    supplier_product_id: product.productId,
    supplier_variant_id: variant.id,
    sku: variant.sku,
    title: product.title,
    variant_title: variant.title,
    product_type: product.productType,
    tags: [], metadata: {}, price: variant.sourceUnitPrice,
    available: variant.available,
    inventory_quantity: variant.sourceInventoryQuantityExplicit
      ? variant.sourceInventoryQuantity : null,
    product_url: product.canonicalUrl,
    image_urls: product.imageUrls,
    barcode: variant.sourceUnitBarcode,
    captured_at: observedAt,
  }))
}

async function mapBounded<T, R>(values: readonly T[], concurrency: number,
  operation: (value: T) => Promise<R>) {
  const result: R[] = new Array(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++
        result[index] = await operation(values[index])
      }
    }))
  return result
}

type ResolvedInput = Readonly<{
  sourceUrl: string
  canonicalUrl: string
  title: string
  variants: readonly LunaQuickPickVariantV1[]
  selected: LunaQuickPickVariantV1 | null
  selectedRow: JsonRecord | null
  blocker: string | null
  sourceClass: "DURABLE_LUNA_CATALOG_EXACT_ROW" |
    "PUBLIC_LUNA_PRODUCT_JSON_EXACT_READBACK"
}>

type ResolutionAttempt = Readonly<{
  result: ResolvedInput | null
  error: string | null
}>

export async function resolveLunaQuickPickInputV1(input: Readonly<{
  sourceUrl: string
  catalogRows: readonly JsonRecord[]
  selectedVariantId?: string | null
  fetchImpl?: typeof fetch
}>): Promise<ResolvedInput> {
  const parsed = parseDirectedLunaProductUrl(input.sourceUrl)
  let matchingRows = input.catalogRows.filter((row) =>
    canonicalRowUrl(row) === parsed.canonicalUrl)
  let sourceClass: ResolvedInput["sourceClass"] =
    "DURABLE_LUNA_CATALOG_EXACT_ROW"
  if (!matchingRows.length) {
    const product = await fetchDirectedLunaProduct(input.sourceUrl,
      input.fetchImpl ?? fetch)
    matchingRows = publicProductRows(product, new Date().toISOString())
    sourceClass = "PUBLIC_LUNA_PRODUCT_JSON_EXACT_READBACK"
  }
  const variants = matchingRows.flatMap((row) => {
    const productId = text(row.supplier_product_id) ?? text(row.product_id)
    const variantId = text(row.supplier_variant_id)
    const sku = text(row.sku, 120)
    const price = number(row.price)
    if (!productId || !variantId || !/^\d{1,30}$/.test(productId) ||
        !/^\d{1,30}$/.test(variantId) || !sku || price === null || price <= 0) {
      return []
    }
    return [Object.freeze({ lunaProductId: productId,
      lunaVariantId: variantId, supplierSku: sku,
      title: text(row.variant_title, 200) ?? "Variante general",
      available: row.available === true &&
        (number(row.inventory_quantity) === null ||
          Number(row.inventory_quantity) > 0),
      supplierCostUsd: price })]
  })
  const unique = [...new Map(variants.map((variant) => [
    identityKey(variant.lunaProductId, variant.lunaVariantId,
      variant.supplierSku), variant])).values()]
  const requestedVariant = input.selectedVariantId ??
    explicitVariantId(input.sourceUrl)
  let selected = requestedVariant
    ? unique.find((variant) => variant.lunaVariantId === requestedVariant) ?? null
    : null
  if (requestedVariant && !selected) return Object.freeze({
    sourceUrl: input.sourceUrl, canonicalUrl: parsed.canonicalUrl,
    title: text(matchingRows[0]?.title, 350) ?? parsed.handle,
    variants: Object.freeze(unique), selected: null, selectedRow: null,
    blocker: "LUNA_QUICK_PICK_EXPLICIT_VARIANT_MISMATCH", sourceClass,
  })
  const available = unique.filter((variant) => variant.available)
  if (!selected && available.length === 1) selected = available[0]
  if (!selected && unique.length === 1) selected = unique[0]
  const selectedRow = selected ? matchingRows.find((row) =>
    (text(row.supplier_product_id) ?? text(row.product_id)) ===
      selected!.lunaProductId &&
    text(row.supplier_variant_id) === selected!.lunaVariantId &&
    text(row.sku, 120) === selected!.supplierSku) ?? null : null
  return Object.freeze({ sourceUrl: input.sourceUrl,
    canonicalUrl: parsed.canonicalUrl,
    title: text(matchingRows[0]?.title, 350) ?? parsed.handle,
    variants: Object.freeze(unique), selected, selectedRow,
    blocker: selected ? null : "LUNA_QUICK_PICK_VARIANT_SELECTION_REQUIRED",
    sourceClass })
}

function emptyStages(overrides: Record<string, "WAITING" | "RUNNING" |
  "PASS" | "BLOCKED"> = {}) {
  return Object.freeze({ IDENTITY: "WAITING", DUPLICATE: "WAITING",
    STOCK: "WAITING", DEMAND: "WAITING", SHIPPING: "WAITING",
    ECONOMICS: "WAITING", PRODUCT_TRUTH: "WAITING",
    LISTING_PACKAGE: "WAITING", MARKETPLACE_READINESS: "WAITING",
    LISTING_READY: "WAITING", ...overrides })
}

function card(input: Partial<LunaQuickPickCardV1> &
  Pick<LunaQuickPickCardV1, "sourceUrl">): LunaQuickPickCardV1 {
  return Object.freeze({ sourceUrl: input.sourceUrl,
    canonicalUrl: input.canonicalUrl ?? null, sourceSku: input.sourceSku ?? null,
    lunaProductId: input.lunaProductId ?? null,
    lunaVariantId: input.lunaVariantId ?? null,
    candidateId: input.candidateId ?? null,
    opportunityId: input.opportunityId ?? null,
    candidateKey: input.candidateKey ?? null,
    listingPackageId: input.listingPackageId ?? null,
    title: input.title ?? null, state: input.state ?? "BLOCKED",
    lastStage: input.lastStage ?? "IDENTITY",
    disposition: input.disposition ?? "BLOCKED",
    exactBlocker: input.exactBlocker ?? null,
    variantSelectionRequired: input.variantSelectionRequired ?? false,
    variants: Object.freeze([...(input.variants ?? [])]),
    alreadyLive: input.alreadyLive ?? false,
    linkedLiveItemIds: Object.freeze([...(input.linkedLiveItemIds ?? [])]),
    stages: input.stages ?? emptyStages(), dollarCheck: input.dollarCheck ?? null,
    elapsedMs: input.elapsedMs ?? 0 })
}

function outcomeStages(outcome: JsonRecord,
  candidate: RadarRevenueFactoryCandidateV1) {
  const stages = record(outcome.stages)
  const shippingWaiting = outcome.shippingJobStatus === "WAITING_BROWSER_WORKER"
  const demandReady = candidate.source ===
      "RADAR_FAMILY_LUNA_SUPPLY_IDENTITY" || candidate.source ===
      "RADAR_FRONTIER_LUNA_IDENTITY"
  const shippingReady = candidate.readyForEconomics ||
    (candidate.economicsNextEvidence !== null &&
      candidate.economicsNextEvidence !== "ACTUAL_LUNA_SHIPPING")
  const pass = (name: string) => stages[name] === "READY" ? "PASS" as const
    : "BLOCKED" as const
  return emptyStages({ IDENTITY: "PASS", DUPLICATE: "PASS",
    STOCK: candidate.stockReady ? "PASS" : "BLOCKED",
    DEMAND: demandReady ? "PASS" : pass("DEMAND_READY"),
    SHIPPING: shippingWaiting ? "RUNNING" :
      shippingReady ? "PASS" : "BLOCKED",
    ECONOMICS: candidate.readyForEconomics ? "PASS" :
      pass("ECONOMICS_READY"),
    PRODUCT_TRUTH: pass("PRODUCT_TRUTH_READY"),
    LISTING_PACKAGE: pass("LISTING_PACKAGE_READY"),
    MARKETPLACE_READINESS:
      outcome.canonicalMarketplaceReadinessReady === true ? "PASS" : "BLOCKED",
    LISTING_READY: outcome.listingReady === true ? "PASS" : "BLOCKED" })
}

export async function processLunaQuickPickBatchV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  urls: unknown
  selectedVariants?: Readonly<Record<string, string>>
  taxonomyReader: RadarMarketplaceTaxonomyReaderV1
  fetchImpl?: typeof fetch
}>) {
  const startedAt = Date.now()
  const collected = collectLunaQuickPickInputsV1(input.urls)
  const sourceUrls = collected.urls
  const [catalog, radarRead, frontierRead] = await Promise.all([
    readRadarRevenueFactoryLunaCatalogV1(input.supabase),
    input.supabase.rpc("get_seller_os_family_market_radar_v1",
      { p_family_id: null, p_limit: 100 }),
    input.supabase.rpc("get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey, p_marketplace_id: "EBAY_US",
      p_family_ids: null, p_limit: 100,
    }),
  ])
  if (radarRead.error) throw new Error("LUNA_QUICK_PICK_DEMAND_AUTHORITY_UNAVAILABLE")
  if (frontierRead.error) throw new Error("LUNA_QUICK_PICK_ECONOMICS_AUTHORITY_UNAVAILABLE")
  const resolutionAttempts = await mapBounded<string, ResolutionAttempt>(sourceUrls,
    LUNA_QUICK_PICK_CONCURRENCY, async (sourceUrl) => {
      const canonical = parseDirectedLunaProductUrl(sourceUrl).canonicalUrl
      try {
        return Object.freeze({ result: await resolveLunaQuickPickInputV1({
          sourceUrl, catalogRows: catalog.rows,
          selectedVariantId: input.selectedVariants?.[canonical] ?? null,
          fetchImpl: input.fetchImpl }), error: null }) as ResolutionAttempt
      } catch (error) {
        return Object.freeze({ result: null,
          error: safeError(error) }) as ResolutionAttempt
      }
    })
  const resolved = resolutionAttempts.flatMap((attempt) => attempt.result
    ? [attempt.result] : [])
  const selected = resolved.filter((entry) => entry.selected && entry.selectedRow)
  const liveGuard = await readAlreadyLiveExactLunaIdentitiesV1({
    supabase: input.supabase, accountKey: input.accountKey,
    identities: selected.map((entry) => ({
      identityKey: identityKey(entry.selected!.lunaProductId,
        entry.selected!.lunaVariantId, entry.selected!.supplierSku),
      lunaProductId: entry.selected!.lunaProductId,
      lunaVariantId: entry.selected!.lunaVariantId,
      supplierSku: entry.selected!.supplierSku,
    })),
  })
  const cards = new Map<string, LunaQuickPickCardV1>()
  for (const invalid of collected.invalid) {
    cards.set(invalid.sourceUrl, card({ sourceUrl: invalid.sourceUrl,
      state: "BLOCKED", lastStage: "IDENTITY", disposition: "BLOCKED",
      exactBlocker: invalid.blocker,
      stages: emptyStages({ IDENTITY: "BLOCKED" }) }))
  }
  resolutionAttempts.forEach((attempt, index) => {
    if (!attempt.result) cards.set(sourceUrls[index], card({
      sourceUrl: sourceUrls[index], state: "BLOCKED", lastStage: "IDENTITY",
      disposition: "BLOCKED", exactBlocker: attempt.error,
      stages: emptyStages({ IDENTITY: "BLOCKED" }),
    }))
  })
  const candidateRows: JsonRecord[] = []
  const acceptedIdentityKeys = new Set<string>()
  for (const entry of resolved) {
    const selectedVariant = entry.selected
    if (!selectedVariant || !entry.selectedRow) {
      cards.set(entry.sourceUrl, card({ sourceUrl: entry.sourceUrl,
        canonicalUrl: entry.canonicalUrl, title: entry.title,
        state: "WAITING", lastStage: "IDENTITY",
        disposition: entry.blocker === "LUNA_QUICK_PICK_VARIANT_SELECTION_REQUIRED"
          ? "WAITING_VARIANT_SELECTION" : "BLOCKED",
        exactBlocker: entry.blocker,
        variantSelectionRequired:
          entry.blocker === "LUNA_QUICK_PICK_VARIANT_SELECTION_REQUIRED",
        variants: entry.variants,
        stages: emptyStages({ IDENTITY: entry.blocker ? "BLOCKED" : "PASS" }) }))
      continue
    }
    const key = identityKey(selectedVariant.lunaProductId,
      selectedVariant.lunaVariantId, selectedVariant.supplierSku)
    if (liveGuard.status !== "AVAILABLE") {
      cards.set(entry.sourceUrl, card({ sourceUrl: entry.sourceUrl,
        canonicalUrl: entry.canonicalUrl, title: entry.title,
        sourceSku: selectedVariant.supplierSku,
        lunaProductId: selectedVariant.lunaProductId,
        lunaVariantId: selectedVariant.lunaVariantId,
        state: "BLOCKED", lastStage: "DUPLICATE",
        disposition: "BLOCKED_FAIL_CLOSED",
        exactBlocker: liveGuard.reasonCode,
        variants: entry.variants,
        stages: emptyStages({ IDENTITY: "PASS", DUPLICATE: "BLOCKED" }) }))
      continue
    }
    const live = liveGuard.matches.get(key)
    if (live) {
      cards.set(entry.sourceUrl, card({ sourceUrl: entry.sourceUrl,
        canonicalUrl: entry.canonicalUrl, title: entry.title,
        sourceSku: selectedVariant.supplierSku,
        lunaProductId: selectedVariant.lunaProductId,
        lunaVariantId: selectedVariant.lunaVariantId,
        state: "BLOCKED", lastStage: "DUPLICATE",
        disposition: "EXCLUDED_ALREADY_LIVE",
        exactBlocker: "ALREADY_LIVE_EXACT_PRODUCT", variants: entry.variants,
        alreadyLive: true, linkedLiveItemIds: live.ebayItemIds,
        stages: emptyStages({ IDENTITY: "PASS", DUPLICATE: "BLOCKED" }) }))
      continue
    }
    if (acceptedIdentityKeys.has(key)) {
      cards.set(entry.sourceUrl, card({ sourceUrl: entry.sourceUrl,
        canonicalUrl: entry.canonicalUrl, title: entry.title,
        sourceSku: selectedVariant.supplierSku,
        lunaProductId: selectedVariant.lunaProductId,
        lunaVariantId: selectedVariant.lunaVariantId,
        state: "BLOCKED", lastStage: "DUPLICATE",
        disposition: "EXCLUDED_DUPLICATE_INPUT",
        exactBlocker: "LUNA_QUICK_PICK_DUPLICATE_PRODUCT_IDENTITY",
        variants: entry.variants,
        stages: emptyStages({ IDENTITY: "PASS", DUPLICATE: "BLOCKED" }) }))
      continue
    }
    acceptedIdentityKeys.add(key)
    if (!selectedVariant.available) {
      cards.set(entry.sourceUrl, card({ sourceUrl: entry.sourceUrl,
        canonicalUrl: entry.canonicalUrl, title: entry.title,
        sourceSku: selectedVariant.supplierSku,
        lunaProductId: selectedVariant.lunaProductId,
        lunaVariantId: selectedVariant.lunaVariantId,
        state: "BLOCKED", lastStage: "STOCK",
        disposition: "BLOCKED_STOCK",
        exactBlocker: "LUNA_QUICK_PICK_CANONICAL_STOCK_NOT_READY",
        variants: entry.variants,
        stages: emptyStages({ IDENTITY: "PASS", DUPLICATE: "PASS",
          STOCK: "BLOCKED" }) }))
      continue
    }
    candidateRows.push(entry.selectedRow)
  }
  let currentBatch = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload: radarRead.data, frontierPayload: frontierRead.data,
    lunaCatalogRows: candidateRows, targetCandidates: LUNA_QUICK_PICK_MAX_INPUTS,
    catalogReadMetadata: { pageCount: catalog.pageCount,
      rowsRead: catalog.rowsRead, uniqueIdentities: catalog.uniqueIdentities,
      truncated: catalog.truncated },
  })
  for (const entry of resolved) {
    if (cards.has(entry.sourceUrl) || !entry.selected) continue
    const exact = currentBatch.candidates.find((candidate) =>
      candidate.lunaProductId === entry.selected!.lunaProductId &&
      candidate.lunaVariantId === entry.selected!.lunaVariantId &&
      candidate.supplierSku === entry.selected!.supplierSku)
    if (!exact) {
      const single = buildRadarRevenueFactoryCandidateBatchV1({
        radarPayload: radarRead.data, frontierPayload: frontierRead.data,
        lunaCatalogRows: entry.selectedRow ? [entry.selectedRow] : [],
        targetCandidates: 2,
      })
      cards.set(entry.sourceUrl, card({ sourceUrl: entry.sourceUrl,
        canonicalUrl: entry.canonicalUrl, title: entry.title,
        sourceSku: entry.selected.supplierSku,
        lunaProductId: entry.selected.lunaProductId,
        lunaVariantId: entry.selected.lunaVariantId,
        state: "BLOCKED", lastStage: "DEMAND",
        disposition: "BLOCKED",
        exactBlocker: single.ambiguousFamilyAssignments > 0
          ? "LUNA_QUICK_PICK_DEMAND_FAMILY_AMBIGUOUS"
          : "LUNA_QUICK_PICK_COMPATIBLE_FAMILY_DEMAND_UNAVAILABLE",
        variants: entry.variants,
        stages: emptyStages({ IDENTITY: "PASS", DUPLICATE: "PASS",
          STOCK: entry.selected.available ? "PASS" : "BLOCKED",
          DEMAND: "BLOCKED" }) }))
    }
  }
  const preflight = await ensureRadarCandidateEconomicsPreflightsV1({
    supabase: input.supabase, accountKey: input.accountKey, batch: currentBatch,
  })
  if (preflight.created > 0 || preflight.reused > 0) {
    const refreshedFrontier = await input.supabase.rpc(
      "get_seller_os_latest_profitability_frontiers_v1", {
        p_account_key: input.accountKey, p_marketplace_id: "EBAY_US",
        p_family_ids: null, p_limit: 100,
      })
    if (refreshedFrontier.error) {
      throw new Error("LUNA_QUICK_PICK_ECONOMICS_READBACK_FAILED")
    }
    currentBatch = buildRadarRevenueFactoryCandidateBatchV1({
      radarPayload: radarRead.data, frontierPayload: refreshedFrontier.data,
      lunaCatalogRows: candidateRows, targetCandidates: LUNA_QUICK_PICK_MAX_INPUTS,
      catalogReadMetadata: { pageCount: catalog.pageCount,
        rowsRead: catalog.rowsRead, uniqueIdentities: catalog.uniqueIdentities,
        truncated: catalog.truncated },
    })
  }
  const materialized = currentBatch.candidates.length
    ? await materializeRadarRevenueFactoryCandidateBatchV1({
        supabase: input.supabase, accountKey: input.accountKey,
        batch: currentBatch, taxonomyReader: input.taxonomyReader,
        // Quick Pick permits a single residual AI pass. Text receives every
        // exact field and every unresolved aspect; residuals fail to review.
        requiredSpecificsAiStages: ["TEXT"],
      }) : null
  for (const entry of resolved) {
    if (cards.has(entry.sourceUrl) || !entry.selected) continue
    const candidate = currentBatch.candidates.find((item) =>
      item.lunaProductId === entry.selected!.lunaProductId &&
      item.lunaVariantId === entry.selected!.lunaVariantId &&
      item.supplierSku === entry.selected!.supplierSku)
    const outcome = candidate ? record(materialized?.outcomes.find((item) =>
      item.candidateId === candidate.candidateId)) : {}
    if (!candidate || !outcome.candidateId) continue
    const ready = outcome.listingReady === true
    cards.set(entry.sourceUrl, card({ sourceUrl: entry.sourceUrl,
      canonicalUrl: entry.canonicalUrl, title: entry.title,
      sourceSku: entry.selected.supplierSku,
      lunaProductId: entry.selected.lunaProductId,
      lunaVariantId: entry.selected.lunaVariantId,
      candidateId: candidate.candidateId,
      opportunityId: text(outcome.opportunityId, 80),
      candidateKey: text(outcome.candidateKey, 120),
      listingPackageId: text(outcome.listingPackageId, 80),
      state: ready ? "READY" :
        outcome.shippingJobStatus === "WAITING_BROWSER_WORKER"
          ? "RUNNING" : "BLOCKED",
      lastStage: ready ? "LISTING_READY" :
        outcome.shippingJobStatus === "WAITING_BROWSER_WORKER"
          ? "SHIPPING" : text(outcome.economicsNextEvidence, 120) ??
            text(record(outcome.priceDistributionContinuation).finalReason, 120) ??
            text(outcome.reasonCode, 120) ?? "ECONOMICS",
      disposition: text(outcome.status, 80) ?? "PARKED",
      exactBlocker: ready ? null :
        text(outcome.economicsNextEvidence, 120) ??
        text(record(outcome.priceDistributionContinuation).finalReason, 120) ??
        text(outcome.reasonCode, 120),
      variants: entry.variants, stages: outcomeStages(outcome, candidate),
      dollarCheck: ready ? record(outcome.dollarCheck) : null }))
  }
  const orderedUrls = [...collected.invalid.map((entry) => entry.sourceUrl),
    ...sourceUrls]
  const ordered = orderedUrls.map((url) => cards.get(url) ?? card({
    sourceUrl: url, state: "BLOCKED", lastStage: "IDENTITY",
    disposition: "BLOCKED", exactBlocker: "LUNA_QUICK_PICK_RESULT_MISSING",
  })).map((entry) => Object.freeze({ ...entry,
    elapsedMs: Date.now() - startedAt }))
  const aiCallCount = Number(record(materialized?.requiredSpecificsBatch)
    .aiCallCount ?? 0)
  return Object.freeze({ contractVersion: LUNA_QUICK_PICK_FAST_LISTING_V1,
    inputCount: orderedUrls.length,
    uniqueProductCount: new Set(ordered.flatMap((entry) => entry.sourceSku
      ? [identityKey(entry.lunaProductId!, entry.lunaVariantId!, entry.sourceSku)]
      : [])).size,
    exactIdentityCount: ordered.filter((entry) => entry.sourceSku).length,
    cards: Object.freeze(ordered), aiCallCount,
    aiProductsBatchedCount: aiCallCount > 0
      ? Number(record(materialized?.requiredSpecificsBatch).productCount ?? 0) : 0,
    noArtificialBatchWait: true as const, opportunisticBatching: true as const,
    maximumAiCallsPerQuickPick: 1 as const,
    boundedConcurrency: LUNA_QUICK_PICK_CONCURRENCY,
    elapsedMs: Date.now() - startedAt,
    safety: Object.freeze({ marketplaceWrites: 0 as const,
      publishCalls: 0 as const, newTable: 0 as const, newScheduler: 0 as const,
      newStateMachine: 0 as const, newExtension: 0 as const,
      newBrowserAutomation: 0 as const }) })
}

export function quickPickSafeTechnicalIdentityV1(candidate:
  RadarRevenueFactoryCandidateV1) {
  return Object.freeze({ candidateId: candidate.candidateId,
    exactIdentityDigest: digest({ productId: candidate.lunaProductId,
      variantId: candidate.lunaVariantId, sku: candidate.supplierSku }) })
}

export async function readLunaQuickPickProgressV1(input: Readonly<{
  supabase: SupabaseClient
  candidateKeys: readonly string[]
}>) {
  const candidateKeys = [...new Set(input.candidateKeys.filter((value) =>
    /^sha256:[0-9a-f]{64}$/.test(value)))].slice(0, LUNA_QUICK_PICK_MAX_INPUTS)
  if (!candidateKeys.length) return Object.freeze([])
  const queueRead = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,product_title,queue_status,decision,assessment,updated_at")
    .in("candidate_key", candidateKeys).limit(LUNA_QUICK_PICK_MAX_INPUTS)
  if (queueRead.error) throw new Error("LUNA_QUICK_PICK_PROGRESS_READ_FAILED")
  const queueRows = rows(queueRead.data)
  const opportunityIds = queueRows.flatMap((row) => text(row.id, 80)
    ? [String(row.id)] : [])
  const packageRead = opportunityIds.length
    ? await input.supabase.from("ebay_listing_packages")
      .select("id,opportunity_id").in("opportunity_id", opportunityIds)
      .limit(LUNA_QUICK_PICK_MAX_INPUTS)
    : { data: [], error: null }
  if (packageRead.error) throw new Error("LUNA_QUICK_PICK_PACKAGE_READ_FAILED")
  const packages = new Map(rows(packageRead.data).map((row) =>
    [String(row.opportunity_id), String(row.id)]))
  return Object.freeze(queueRows.map((row) => {
    const assessment = record(row.assessment)
    const factory = record(assessment.sellerOsDeterministicFactory)
    const stages = record(factory.stageStatuses)
    const intake = record(assessment.smartStockingListingIntakeV1)
    const shipping = record(assessment.radarAutomaticLunaShippingContinuationV1)
    const listingReady = intake.finalDecision === "LISTING_READY" ||
      row.decision === "LISTING_READY"
    const mapped = emptyStages({ IDENTITY: "PASS", DUPLICATE: "PASS",
      STOCK: "PASS", DEMAND: stages.DEMAND_READY === "READY"
        ? "PASS" : "BLOCKED",
      SHIPPING: shipping.shippingJobStatus === "WAITING_BROWSER_WORKER"
        ? "RUNNING" : shipping.shippingJobStatus === "SHIPPING_EVIDENCE_DURABLE"
          ? "PASS" : "BLOCKED",
      ECONOMICS: stages.ECONOMICS_READY === "READY" ? "PASS" : "BLOCKED",
      PRODUCT_TRUTH: stages.PRODUCT_TRUTH_READY === "READY"
        ? "PASS" : "BLOCKED",
      LISTING_PACKAGE: stages.LISTING_PACKAGE_READY === "READY"
        ? "PASS" : "BLOCKED",
      MARKETPLACE_READINESS: listingReady ? "PASS" : "BLOCKED",
      LISTING_READY: listingReady ? "PASS" : "BLOCKED" })
    return Object.freeze({ candidateKey: String(row.candidate_key),
      candidateId: String(row.candidate_key), opportunityId: String(row.id),
      listingPackageId: packages.get(String(row.id)) ?? null,
      sourceSku: text(row.supplier_sku, 120),
      lunaProductId: text(row.supplier_product_id, 80),
      lunaVariantId: text(row.supplier_variant_id, 80),
      title: text(row.product_title, 350),
      state: listingReady ? "READY" as const :
        shipping.shippingJobStatus === "WAITING_BROWSER_WORKER"
          ? "RUNNING" as const : "BLOCKED" as const,
      lastStage: listingReady ? "LISTING_READY" :
        shipping.shippingJobStatus === "WAITING_BROWSER_WORKER"
          ? "SHIPPING" : text(factory.blockers, 120) ?? "ECONOMICS",
      disposition: String(row.decision ?? row.queue_status ?? "PARKED"),
      exactBlocker: listingReady ? null :
        Array.isArray(factory.blockers) ? text(factory.blockers[0], 120) : null,
      stages: mapped,
      dollarCheck: listingReady ? Object.freeze({
        title: row.product_title,
        targetPrice: intake.finalPriceUsd ?? null,
        supplierCost: intake.supplierCostUsd ?? null,
        shipping: intake.supplierShippingUsd ?? null,
        ebayFees: intake.estimatedEbayFeesUsd ?? null,
        profit: intake.contributionProfitUsd ?? null,
        margin: intake.contributionMarginPercent ?? null,
        roi: intake.roiPercent ?? null,
        stock: "STOCK_SAFE",
        demandGrain: "FAMILY",
      }) : null,
      updatedAt: text(row.updated_at, 80),
    })
  }))
}
