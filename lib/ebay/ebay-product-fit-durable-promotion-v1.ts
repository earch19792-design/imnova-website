import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

export const SELLER_OS_PRODUCT_FIT_STRONG_REVALIDATION_VERSION =
  "SELLER_OS_PRODUCT_FIT_STRONG_REVALIDATION_V1" as const
export const SELLER_OS_PRODUCT_FIT_DURABLE_PROMOTION_VERSION =
  "SELLER_OS_PRODUCT_FIT_DURABLE_PROMOTION_V1" as const

const SHA256 = /^sha256:[0-9a-f]{64}$/
const FAMILY_ID = /^market-family-v1:sha256:[0-9a-f]{64}$/
const LUNA_ID = /^\d{1,30}$/
const SAFE_SKU = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$/
const ACCOUNT_KEY = /^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$/
const PRODUCT_FITS = new Set(["STRONG", "MEDIUM", "WEAK", "UNPROVEN"])
const MAXIMUM_RUNS = 100
const MAXIMUM_PROMOTIONS = 1_000

type JsonRecord = Record<string, unknown>

export type SellerOsProductFitStrongRevalidationV1 = Readonly<{
  contractVersion: typeof SELLER_OS_PRODUCT_FIT_STRONG_REVALIDATION_VERSION
  candidateId: string
  familyId: string
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  productFitBefore: "STRONG" | "MEDIUM" | "WEAK" | "UNPROVEN"
  productFitAfter: "STRONG"
  exactLunaProductId: true
  exactLunaVariantId: true
  exactSupplierSku: true
  exactProductSemantics: true
  variantCompatibility: true
  noTitleOnlyInference: true
  evidenceComplete: true
  evidenceReference: string
  evidenceDigest: string
  evidenceVersion: string
  evidenceObservedAt: string
  evaluatedAt: string
}>

export type SellerOsProductFitDurablePromotionV1 = Readonly<
  Omit<SellerOsProductFitStrongRevalidationV1, "contractVersion"> & {
    contractVersion: typeof SELLER_OS_PRODUCT_FIT_DURABLE_PROMOTION_VERSION
    durableProductFitStrong: true
    decisionDigest: string
  }
>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function safeText(value: unknown, maximum = 240) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  return normalized && normalized.length <= maximum ? normalized : null
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"))
      .map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value))).digest("hex")}`
}

export function sellerOsShippingCandidateIdV1(input: Readonly<{
  familyId: string
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
}>) {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    familyId: input.familyId,
    productId: input.lunaProductId,
    variantId: input.lunaVariantId,
    sku: input.supplierSku,
  })).digest("hex")}`
}

function normalizeTime(value: unknown, code: string) {
  const text = safeText(value, 48)
  const milliseconds = text ? Date.parse(text) : Number.NaN
  if (!Number.isFinite(milliseconds)) throw new Error(code)
  return new Date(milliseconds).toISOString()
}

export function normalizeProductFitStrongRevalidationV1(
  value: SellerOsProductFitStrongRevalidationV1,
) : SellerOsProductFitStrongRevalidationV1 {
  const input = record(value)
  const familyId = safeText(input.familyId, 120)
  const lunaProductId = safeText(input.lunaProductId, 30)
  const lunaVariantId = safeText(input.lunaVariantId, 30)
  const supplierSku = safeText(input.supplierSku, 160)
  const candidateId = safeText(input.candidateId, 80)
  const evidenceReference = safeText(input.evidenceReference, 240)
  const evidenceVersion = safeText(input.evidenceVersion, 120)
  const evidenceDigest = safeText(input.evidenceDigest, 80)
  const evidenceObservedAt = normalizeTime(input.evidenceObservedAt,
    "PRODUCT_FIT_REVALIDATION_EVIDENCE_TIME_INVALID")
  const evaluatedAt = normalizeTime(input.evaluatedAt,
    "PRODUCT_FIT_REVALIDATION_EVALUATED_AT_INVALID")
  if (input.contractVersion !== SELLER_OS_PRODUCT_FIT_STRONG_REVALIDATION_VERSION ||
      !familyId || !FAMILY_ID.test(familyId) ||
      !lunaProductId || !LUNA_ID.test(lunaProductId) ||
      !lunaVariantId || !LUNA_ID.test(lunaVariantId) ||
      !supplierSku || !SAFE_SKU.test(supplierSku) ||
      !candidateId || !SHA256.test(candidateId) ||
      candidateId !== sellerOsShippingCandidateIdV1({ familyId,
        lunaProductId, lunaVariantId, supplierSku }) ||
      !PRODUCT_FITS.has(String(input.productFitBefore)) ||
      input.productFitAfter !== "STRONG" ||
      input.exactLunaProductId !== true ||
      input.exactLunaVariantId !== true || input.exactSupplierSku !== true ||
      input.exactProductSemantics !== true ||
      input.variantCompatibility !== true ||
      input.noTitleOnlyInference !== true || input.evidenceComplete !== true ||
      !evidenceReference || !SAFE_REFERENCE.test(evidenceReference) ||
      !evidenceVersion || !SAFE_REFERENCE.test(evidenceVersion) ||
      !evidenceDigest || !SHA256.test(evidenceDigest) ||
      Date.parse(evidenceObservedAt) > Date.parse(evaluatedAt)) {
    throw new Error("PRODUCT_FIT_STRONG_REVALIDATION_INVALID")
  }
  return Object.freeze({
    contractVersion: SELLER_OS_PRODUCT_FIT_STRONG_REVALIDATION_VERSION,
    candidateId, familyId, lunaProductId, lunaVariantId, supplierSku,
    productFitBefore: input.productFitBefore as
      SellerOsProductFitStrongRevalidationV1["productFitBefore"],
    productFitAfter: "STRONG",
    exactLunaProductId: true, exactLunaVariantId: true,
    exactSupplierSku: true, exactProductSemantics: true,
    variantCompatibility: true, noTitleOnlyInference: true,
    evidenceComplete: true, evidenceReference, evidenceDigest,
    evidenceVersion, evidenceObservedAt, evaluatedAt,
  })
}

export function buildProductFitDurablePromotionV1(
  value: SellerOsProductFitStrongRevalidationV1,
) : SellerOsProductFitDurablePromotionV1 {
  const revalidation = normalizeProductFitStrongRevalidationV1(value)
  const body = { ...revalidation,
    contractVersion: SELLER_OS_PRODUCT_FIT_DURABLE_PROMOTION_VERSION,
    durableProductFitStrong: true as const }
  return Object.freeze({ ...body, decisionDigest: digest(body) })
}

export function normalizeProductFitDurablePromotionV1(
  value: unknown,
) : SellerOsProductFitDurablePromotionV1 {
  const input = record(value)
  const revalidation = normalizeProductFitStrongRevalidationV1({
    ...input,
    contractVersion: SELLER_OS_PRODUCT_FIT_STRONG_REVALIDATION_VERSION,
  } as SellerOsProductFitStrongRevalidationV1)
  const promotion = buildProductFitDurablePromotionV1(revalidation)
  if (input.contractVersion !== SELLER_OS_PRODUCT_FIT_DURABLE_PROMOTION_VERSION ||
      input.durableProductFitStrong !== true ||
      input.decisionDigest !== promotion.decisionDigest) {
    throw new Error("PRODUCT_FIT_DURABLE_PROMOTION_INVALID")
  }
  return promotion
}

async function accountRunIds(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
}>) {
  if (!ACCOUNT_KEY.test(input.accountKey)) {
    throw new Error("PRODUCT_FIT_DURABLE_ACCOUNT_INVALID")
  }
  const result = await input.supabase.from("ebay_same_day_pilot_runs")
    .select("id").eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US").order("created_at", { ascending: false })
    .limit(MAXIMUM_RUNS)
  if (result.error) throw new Error("PRODUCT_FIT_DURABLE_RUN_READ_FAILED")
  return records(result.data).map((row) => safeText(row.id, 80))
    .filter((id): id is string => Boolean(id))
}

export async function persistProductFitStrongPromotionV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  revalidation: SellerOsProductFitStrongRevalidationV1
}>) {
  const promotion = buildProductFitDurablePromotionV1(input.revalidation)
  const [runId] = await accountRunIds(input)
  if (!runId) throw new Error("PRODUCT_FIT_DURABLE_RUN_UNAVAILABLE")
  const candidate = await input.supabase.from("ebay_same_day_pilot_candidates")
    .select("id").eq("run_id", runId)
    .eq("candidate_key", promotion.candidateId).limit(1).maybeSingle()
  const durableCandidateId = candidate.error
    ? null : safeText(record(candidate.data).id, 80)
  const idempotencyKey = [runId,
    SELLER_OS_PRODUCT_FIT_DURABLE_PROMOTION_VERSION,
    promotion.decisionDigest.slice("sha256:".length)].join(":")
  const write = await input.supabase.from("ebay_same_day_pilot_events").upsert({
    run_id: runId,
    candidate_id: durableCandidateId,
    event_type: SELLER_OS_PRODUCT_FIT_DURABLE_PROMOTION_VERSION,
    event_payload: promotion,
    idempotency_key: idempotencyKey,
    ebay_read_calls: 0, openai_calls: 0, ebay_writes: 0,
    production_changed: false,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (write.error) throw new Error("PRODUCT_FIT_DURABLE_WRITE_FAILED")
  const readback = await input.supabase.from("ebay_same_day_pilot_events")
    .select("event_payload").eq("idempotency_key", idempotencyKey).maybeSingle()
  let stored: SellerOsProductFitDurablePromotionV1
  try { stored = normalizeProductFitDurablePromotionV1(
    record(readback.data).event_payload) } catch {
    throw new Error("PRODUCT_FIT_DURABLE_READBACK_FAILED")
  }
  if (readback.error || stored.decisionDigest !== promotion.decisionDigest) {
    throw new Error("PRODUCT_FIT_DURABLE_READBACK_FAILED")
  }
  return Object.freeze({ productFitStrong: true as const,
    productFitStrongDurable: true as const,
    durableWriteVerified: true as const,
    durableReadbackMatch: true as const, promotion: stored })
}

export async function readProductFitStrongPromotionsV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  candidateIds: readonly string[]
}>) {
  const candidateIds = [...new Set(input.candidateIds)]
  if (candidateIds.length > 100 ||
      candidateIds.some((candidateId) => !SHA256.test(candidateId))) {
    throw new Error("PRODUCT_FIT_DURABLE_SELECTOR_INVALID")
  }
  if (!candidateIds.length) return new Map<string,
    SellerOsProductFitDurablePromotionV1>()
  const runIds = await accountRunIds(input)
  if (!runIds.length) throw new Error("PRODUCT_FIT_DURABLE_RUN_UNAVAILABLE")
  const result = await input.supabase.from("ebay_same_day_pilot_events")
    .select("event_payload,created_at").in("run_id", runIds)
    .eq("event_type", SELLER_OS_PRODUCT_FIT_DURABLE_PROMOTION_VERSION)
    .order("created_at", { ascending: false }).limit(MAXIMUM_PROMOTIONS)
  if (result.error) throw new Error("PRODUCT_FIT_DURABLE_READ_FAILED")
  const requested = new Set(candidateIds)
  const promotions = new Map<string, SellerOsProductFitDurablePromotionV1>()
  for (const row of records(result.data)) {
    let promotion: SellerOsProductFitDurablePromotionV1
    try { promotion = normalizeProductFitDurablePromotionV1(row.event_payload) }
    catch { continue }
    if (!requested.has(promotion.candidateId)) continue
    const existing = promotions.get(promotion.candidateId)
    if (!existing || Date.parse(promotion.evaluatedAt) >
        Date.parse(existing.evaluatedAt)) {
      promotions.set(promotion.candidateId, promotion)
    }
  }
  return promotions
}

export function resolveDurableProductFitStrongV1(input: Readonly<{
  candidateId: string
  familyId: string
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  frontierProductFit: unknown
  frontierCalculatedAt: unknown
  promotion?: SellerOsProductFitDurablePromotionV1 | null
}>) {
  const identityMatches = input.candidateId === sellerOsShippingCandidateIdV1({
    familyId: input.familyId, lunaProductId: input.lunaProductId,
    lunaVariantId: input.lunaVariantId, supplierSku: input.supplierSku,
  })
  if (!identityMatches) throw new Error("PRODUCT_FIT_DURABLE_IDENTITY_MISMATCH")
  if (input.frontierProductFit === "STRONG") return Object.freeze({
    productFitStrongDurable: true as const,
    authority: "SELLER_OS_PROFITABILITY_FRONTIER_V1" as const,
    decisionDigest: null,
  })
  const promotion = input.promotion
  const frontierTime = normalizeTime(input.frontierCalculatedAt,
    "PRODUCT_FIT_DURABLE_FRONTIER_TIME_INVALID")
  if (!promotion || promotion.candidateId !== input.candidateId ||
      promotion.familyId !== input.familyId ||
      promotion.lunaProductId !== input.lunaProductId ||
      promotion.lunaVariantId !== input.lunaVariantId ||
      promotion.supplierSku !== input.supplierSku ||
      Date.parse(promotion.evaluatedAt) <= Date.parse(frontierTime)) {
    return Object.freeze({ productFitStrongDurable: false as const,
      authority: "UNPROVEN" as const, decisionDigest: null })
  }
  return Object.freeze({ productFitStrongDurable: true as const,
    authority: SELLER_OS_PRODUCT_FIT_DURABLE_PROMOTION_VERSION,
    decisionDigest: promotion.decisionDigest })
}
