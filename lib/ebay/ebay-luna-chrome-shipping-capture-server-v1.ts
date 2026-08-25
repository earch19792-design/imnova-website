import "server-only"

import { createHash, createHmac, timingSafeEqual } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  certifyLunaShippingCapturePostV1,
  LUNA_SHIPPING_EXTENSION_MAXIMUM_BATCH,
  LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
  LUNA_SHIPPING_RUNTIME_TRACE_MAXIMUM_EVENTS,
  LUNA_SHIPPING_RUNTIME_TRACE_VERSION,
  normalizeLunaChromeShippingDestinationV1,
  normalizeLunaChromeShippingJobV1,
  normalizeLunaShippingRuntimeTraceEventV1,
  type LunaChromeShippingJobV1,
  type LunaShippingCapturePostV1,
  type LunaShippingRuntimeTraceEventV1,
} from "./ebay-luna-chrome-shipping-capture-v1"
import { EBAY_LUNA_BOCA_RATON_LOCATION } from
  "./ebay-merchant-location-one-shot-gateway"
import {
  readProductFitStrongPromotionsV1,
  resolveDurableProductFitStrongV1,
} from "./ebay-product-fit-durable-promotion-v1"

export const LUNA_SHIPPING_CANARY_CANDIDATE_ID =
  "sha256:39f9566e97c230d9fdf9882a802af7dad8a7a0e54ab000999bcc3da779f4ab60" as const

type JsonRecord = Record<string, unknown>

const CAPTURE_SESSION_MAXIMUM_AGE_MS = 10 * 60 * 1_000
const SHA256 = /^sha256:[0-9a-f]{64}$/

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 240) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  return normalized && normalized.length <= maximum ? normalized : null
}

function money(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round((parsed + Number.EPSILON) * 100) / 100 : null
}

function exactKey(productId: string, variantId: string, sku: string) {
  return `${productId}\n${variantId}\n${sku}`
}

function candidateId(familyId: string, productId: string,
  variantId: string, sku: string) {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    familyId, productId, variantId, sku,
  })).digest("hex")}`
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

async function latestSameDayRun(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
}>) {
  const result = await input.supabase.from("ebay_same_day_pilot_runs")
    .select("id").eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US").order("created_at", { ascending: false })
    .limit(1).maybeSingle()
  if (result.error || !text(record(result.data).id, 80)) {
    throw new Error("LUNA_SHIPPING_RUNTIME_TRACE_DURABLE_RUN_UNAVAILABLE")
  }
  return text(record(result.data).id, 80)!
}

export async function persistLunaShippingRuntimeTraceEventV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  event: LunaShippingRuntimeTraceEventV1
  now?: number
}>) {
  const event = normalizeLunaShippingRuntimeTraceEventV1(input.event,
    input.now ?? Date.now())
  const runId = await latestSameDayRun(input)
  let durableCandidateId: string | null = null
  if (event.candidateId) {
    const candidate = await input.supabase.from("ebay_same_day_pilot_candidates")
      .select("id").eq("run_id", runId)
      .eq("candidate_key", event.candidateId).limit(1).maybeSingle()
    if (!candidate.error) durableCandidateId = text(record(candidate.data).id, 80)
  }
  const idempotencyKey = [runId, LUNA_SHIPPING_RUNTIME_TRACE_VERSION,
    event.captureSessionIdHash.slice("sha256:".length), event.sequence].join(":")
  const eventPayload = event
  const write = await input.supabase.from("ebay_same_day_pilot_events").upsert({
    run_id: runId,
    candidate_id: durableCandidateId,
    event_type: LUNA_SHIPPING_RUNTIME_TRACE_VERSION,
    event_payload: eventPayload,
    idempotency_key: idempotencyKey,
    ebay_read_calls: 0,
    openai_calls: 0,
    ebay_writes: 0,
    production_changed: false,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (write.error) throw new Error("LUNA_SHIPPING_RUNTIME_TRACE_DURABLE_WRITE_FAILED")
  const readback = await input.supabase.from("ebay_same_day_pilot_events")
    .select("event_payload").eq("idempotency_key", idempotencyKey).maybeSingle()
  const stored = record(record(readback.data).event_payload)
  if (readback.error || stored.traceId !== event.traceId ||
      stored.sequence !== event.sequence || stored.state !== event.state) {
    throw new Error("LUNA_SHIPPING_RUNTIME_TRACE_DURABLE_READBACK_FAILED")
  }
  return Object.freeze({ traceDurable: true as const,
    durableReadbackMatch: true as const, event })
}

export async function persistLunaShippingRuntimeTraceV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  events: readonly LunaShippingRuntimeTraceEventV1[]
  now?: number
}>) {
  if (!input.events.length ||
      input.events.length > LUNA_SHIPPING_RUNTIME_TRACE_MAXIMUM_EVENTS) {
    throw new Error("LUNA_SHIPPING_RUNTIME_TRACE_CONTRACT_INVALID")
  }
  const events = input.events.map((event) =>
    normalizeLunaShippingRuntimeTraceEventV1(event, input.now ?? Date.now()))
  const traceId = events[0].traceId
  if (events.some((event, index) => event.traceId !== traceId ||
      event.sequence !== index + 1 ||
      event.captureSessionIdHash !== events[0].captureSessionIdHash ||
      event.candidateId !== events[0].candidateId)) {
    throw new Error("LUNA_SHIPPING_RUNTIME_TRACE_SEQUENCE_INVALID")
  }
  const runId = await latestSameDayRun(input)
  let durableCandidateId: string | null = null
  if (events[0].candidateId) {
    const candidate = await input.supabase.from("ebay_same_day_pilot_candidates")
      .select("id").eq("run_id", runId)
      .eq("candidate_key", events[0].candidateId).limit(1).maybeSingle()
    if (!candidate.error) durableCandidateId = text(record(candidate.data).id, 80)
  }
  const rows = events.map((event) => ({
    run_id: runId,
    candidate_id: durableCandidateId,
    event_type: LUNA_SHIPPING_RUNTIME_TRACE_VERSION,
    event_payload: event,
    idempotency_key: [runId, LUNA_SHIPPING_RUNTIME_TRACE_VERSION,
      event.captureSessionIdHash.slice("sha256:".length), event.sequence].join(":"),
    ebay_read_calls: 0,
    openai_calls: 0,
    ebay_writes: 0,
    production_changed: false,
  }))
  const write = await input.supabase.from("ebay_same_day_pilot_events")
    .upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (write.error) throw new Error("LUNA_SHIPPING_RUNTIME_TRACE_DURABLE_WRITE_FAILED")
  const keys = rows.map((row) => row.idempotency_key)
  const readback = await input.supabase.from("ebay_same_day_pilot_events")
    .select("idempotency_key,event_payload").in("idempotency_key", keys)
  const persisted = records(readback.data)
  if (readback.error || persisted.length !== events.length ||
      persisted.some((row) => {
        const stored = record(row.event_payload)
        return stored.traceId !== traceId ||
          !events.some((event) => event.sequence === stored.sequence &&
            event.state === stored.state)
      })) {
    throw new Error("LUNA_SHIPPING_RUNTIME_TRACE_DURABLE_READBACK_FAILED")
  }
  return Object.freeze({ traceId, eventCount: events.length,
    traceDurable: true as const, durableReadbackMatch: true as const,
    events: Object.freeze(events) })
}

export async function readLatestLunaShippingRuntimeTraceV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  now?: number
}>) {
  const runId = await latestSameDayRun(input)
  const result = await input.supabase.from("ebay_same_day_pilot_events")
    .select("event_payload,created_at").eq("run_id", runId)
    .eq("event_type", LUNA_SHIPPING_RUNTIME_TRACE_VERSION)
    .order("created_at", { ascending: false })
    .limit(LUNA_SHIPPING_RUNTIME_TRACE_MAXIMUM_EVENTS)
  if (result.error) throw new Error("LUNA_SHIPPING_RUNTIME_TRACE_READ_FAILED")
  const valid = records(result.data).flatMap((row) => {
    try {
      return [normalizeLunaShippingRuntimeTraceEventV1(
        record(row.event_payload) as LunaShippingRuntimeTraceEventV1,
        input.now ?? Date.now())]
    } catch { return [] }
  })
  const latestTraceId = valid[0]?.traceId ?? null
  const events = latestTraceId ? valid.filter((entry) =>
    entry.traceId === latestTraceId).sort((left, right) =>
    left.sequence - right.sequence) : []
  return Object.freeze({ traceId: latestTraceId,
    events: Object.freeze(events.slice(0,
      LUNA_SHIPPING_RUNTIME_TRACE_MAXIMUM_EVENTS)),
    traceDurable: events.length > 0 })
}

function sessionSignature(input: Readonly<{
  secret: string
  candidateId: string
  snapshotDigest: string
  issuedAtMs: number
}>) {
  return createHmac("sha256", input.secret).update([
    "SELLER_OS_LUNA_SHIPPING_CAPTURE_SESSION_V1",
    input.candidateId, input.snapshotDigest, String(input.issuedAtMs),
  ].join("\n")).digest()
}

function sessionId(signature: Buffer) {
  const bytes = Buffer.from(signature.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function issueLunaShippingCaptureSessionV1(input: Readonly<{
  secret: string
  candidateId: string
  snapshotDigest: string
  now?: number
}>) {
  const issuedAtMs = input.now ?? Date.now()
  if (input.secret.length < 32 || !/^sha256:[0-9a-f]{64}$/.test(input.candidateId) ||
      !SHA256.test(input.snapshotDigest) || !Number.isInteger(issuedAtMs)) {
    throw new Error("LUNA_SHIPPING_CAPTURE_SESSION_AUTHORITY_INVALID")
  }
  const signature = sessionSignature({ ...input, issuedAtMs })
  return Object.freeze({ captureSessionId: sessionId(signature),
    nonce: `${issuedAtMs}.${signature.toString("base64url")}` })
}

export function verifyLunaShippingCaptureSessionV1(input: Readonly<{
  secret: string
  candidateId: string
  snapshotDigest: string
  captureSessionId: string
  nonce: string
  now?: number
}>) {
  const [issuedAtRaw, providedRaw, ...rest] = input.nonce.split(".")
  const issuedAtMs = Number(issuedAtRaw)
  const now = input.now ?? Date.now()
  if (rest.length || !Number.isInteger(issuedAtMs) || issuedAtMs > now + 60_000 ||
      now - issuedAtMs > CAPTURE_SESSION_MAXIMUM_AGE_MS ||
      !/^[A-Za-z0-9_-]{43}$/.test(providedRaw ?? "") || input.secret.length < 32 ||
      !SHA256.test(input.snapshotDigest)) {
    throw new Error("LUNA_SHIPPING_CAPTURE_SESSION_INVALID")
  }
  const expected = sessionSignature({ ...input, issuedAtMs })
  const provided = Buffer.from(providedRaw, "base64url")
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected) ||
      input.captureSessionId !== sessionId(expected)) {
    throw new Error("LUNA_SHIPPING_CAPTURE_SESSION_INVALID")
  }
  return Object.freeze({ issuedAt: new Date(issuedAtMs).toISOString() })
}

const canonicalAddress = EBAY_LUNA_BOCA_RATON_LOCATION.location.address
const destinationFingerprintInput = Object.freeze({
  profileId: EBAY_LUNA_BOCA_RATON_LOCATION.merchantLocationKey,
  country: canonicalAddress.country,
  province: canonicalAddress.stateOrProvince,
  postalCode: canonicalAddress.postalCode,
})
const CANONICAL_DESTINATION = normalizeLunaChromeShippingDestinationV1({
  profileId: "LUNA_BOCA_RATON_US",
  profileDigest: `sha256:${createHash("sha256")
    .update(JSON.stringify(destinationFingerprintInput)).digest("hex")}`,
  country: "US",
  province: canonicalAddress.stateOrProvince,
  postalCode: canonicalAddress.postalCode,
})

export async function resolveLunaChromeShippingJobsV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  candidateIds?: readonly string[]
  sessionSecret: string
  now?: number
}>) : Promise<readonly LunaChromeShippingJobV1[]> {
  const frontierResult = await input.supabase.rpc(
    "get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey,
      p_marketplace_id: "EBAY_US",
      p_family_ids: null,
      p_limit: 100,
    })
  if (frontierResult.error) {
    throw new Error("LUNA_SHIPPING_EXTENSION_CANDIDATE_EVIDENCE_READ_FAILED")
  }
  const frontierCandidates = records(record(frontierResult.data).frontiers)
    .flatMap((outer) => {
      const frontier = record(outer.frontier)
      const familyId = text(frontier.familyId, 120)
      const lunaProductId = text(frontier.lunaProductId, 30)
      const lunaVariantId = text(frontier.lunaVariantId, 30)
      const supplierSku = text(frontier.lunaSku, 160)
      if (!familyId || !/^market-family-v1:sha256:[0-9a-f]{64}$/.test(familyId) ||
          !lunaProductId || !lunaVariantId || !supplierSku ||
          frontier.economicClassification === "ECONOMICALLY_DEAD") return []
      const snapshotDigest = text(outer.snapshotDigest, 80)
      if (!snapshotDigest || !SHA256.test(snapshotDigest)) return []
      const calculatedAt = text(outer.calculatedAt, 48) ??
        text(frontier.evaluatedAt, 48)
      if (!calculatedAt || !Number.isFinite(Date.parse(calculatedAt))) return []
      return [Object.freeze({ familyId, lunaProductId, lunaVariantId,
        supplierSku, frontier, outer, snapshotDigest, calculatedAt,
        candidateId: candidateId(familyId, lunaProductId, lunaVariantId,
          supplierSku) })]
    })
  const promotions = await readProductFitStrongPromotionsV1({
    supabase: input.supabase, accountKey: input.accountKey,
    candidateIds: frontierCandidates.filter((candidate) =>
      candidate.frontier.productFit !== "STRONG")
      .map((candidate) => candidate.candidateId),
  })
  const exactCandidates = frontierCandidates.filter((candidate) =>
    resolveDurableProductFitStrongV1({
      candidateId: candidate.candidateId, familyId: candidate.familyId,
      lunaProductId: candidate.lunaProductId,
      lunaVariantId: candidate.lunaVariantId,
      supplierSku: candidate.supplierSku,
      frontierProductFit: candidate.frontier.productFit,
      frontierCalculatedAt: candidate.calculatedAt,
      promotion: promotions.get(candidate.candidateId),
    }).productFitStrongDurable)
  const requested = input.candidateIds?.length
    ? [...new Set(input.candidateIds)]
    : exactCandidates.filter((candidate) =>
      !["SHIPPING_DURABLY_PERSISTED", "SHIPPING_OBSERVED"]
        .includes(String(candidate.frontier.shippingStatus)))
      .map((candidate) => candidate.candidateId)
      .slice(0, 2)
  if (requested.length > LUNA_SHIPPING_EXTENSION_MAXIMUM_BATCH ||
      requested.some((candidateId) => !/^sha256:[0-9a-f]{64}$/.test(candidateId))) {
    throw new Error("LUNA_SHIPPING_EXTENSION_CANDIDATE_SCOPE_INVALID")
  }
  if (!requested.length) return Object.freeze([])
  const selected = requested.map((requestedId) => exactCandidates.find((candidate) =>
    candidate.candidateId === requestedId)).filter((candidate) => Boolean(candidate))
  if (selected.length !== requested.length) {
    throw new Error("LUNA_SHIPPING_EXTENSION_EXACT_CANDIDATE_NOT_FOUND")
  }
  const productIds = selected.map((candidate) => candidate!.lunaProductId)
  const catalogResult = await input.supabase.from("market_radar_latest_variants")
      .select("product_id,supplier_product_id,supplier_variant_id,sku,title,variant_title,price,product_url,captured_at")
      .eq("source_key", "lunaportex").in("supplier_product_id", productIds)
      .order("captured_at", { ascending: false }).limit(100)
  if (catalogResult.error) {
    throw new Error("LUNA_SHIPPING_EXTENSION_CANDIDATE_EVIDENCE_READ_FAILED")
  }
  const catalogByIdentity = new Map(records(catalogResult.data).flatMap((row) => {
    const productId = text(row.supplier_product_id, 30)
    const variantId = text(row.supplier_variant_id, 30)
    const sku = text(row.sku, 160)
    return productId && variantId && sku
      ? [[exactKey(productId, variantId, sku), row] as const] : []
  }))
  return Object.freeze(selected.map((candidate) => {
    const exact = candidate!
    const catalog = catalogByIdentity.get(exactKey(exact.lunaProductId,
      exact.lunaVariantId, exact.supplierSku)) ?? {}
    const frontier = exact.frontier
    const supplierProductId = text(catalog.supplier_product_id, 30)
    const supplierVariantId = text(catalog.supplier_variant_id, 30)
    const supplierSku = text(catalog.sku, 160)
    const canonicalProductUrl = text(catalog.product_url, 500)
    const supplierCostUsd = money(frontier.lunaUnitCost ?? catalog.price)
    const salePriceUsd = money(frontier.marketPriceMedian)
    const productName = text(catalog.title, 200)
    if (!supplierProductId || !supplierVariantId || !supplierSku ||
        supplierProductId !== exact.lunaProductId ||
        supplierVariantId !== exact.lunaVariantId ||
        supplierSku !== exact.supplierSku || !canonicalProductUrl ||
        supplierCostUsd === null || salePriceUsd === null || !productName) {
      throw new Error("LUNA_SHIPPING_EXTENSION_AUTHORITATIVE_FACTS_UNPROVEN")
    }
    const session = issueLunaShippingCaptureSessionV1({
      secret: input.sessionSecret, candidateId: exact.candidateId,
      snapshotDigest: exact.snapshotDigest, now: input.now,
    })
    return normalizeLunaChromeShippingJobV1({
      contractVersion: LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
      ...session,
      identity: {
        candidateId: exact.candidateId,
        canonicalProductUrl,
        lunaProductId: supplierProductId,
        lunaVariantId: supplierVariantId,
        supplierSku,
        quantity: 1,
      },
      destination: CANONICAL_DESTINATION,
      salePriceUsd,
      supplierCostUsd,
      productName,
    })
  }))
}

function persistedFrontier(input: Readonly<{
  source: JsonRecord
  certified: ReturnType<typeof certifyLunaShippingCapturePostV1>
  capture: LunaShippingCapturePostV1
}>) {
  const previous = record(input.source.frontier)
  const { frontierDigest: _previousDigest,
    shippingCaptureEvidence: _previousShippingEvidence,
    ...previousWithoutDigest } = previous
  const economics = input.certified.economics
  const quote = input.certified.quote
  const nextWithoutDigest = {
    ...previousWithoutDigest,
    shippingStatus: "SHIPPING_DURABLY_PERSISTED",
    shippingValue: quote.shippingAmountUsd,
    provisionalShippingReserve: null,
    ebayFeeEstimateAtMedian: economics.ebayFeeUsd,
    otherVariableCostEstimateAtMedian:
      economics.returnsReserveUsd === null || economics.promotionReserveUsd === null
        ? null : Math.round((economics.returnsReserveUsd +
          economics.promotionReserveUsd) * 100) / 100,
    contributionProfitAtMarketMedian: economics.contributionProfitUsd,
    contributionMarginAtMarketMedian: economics.contributionMarginPercent,
    economicClassification: economics.passesEconomics
      ? "ECONOMICALLY_PROMISING" : "ECONOMICALLY_RECOVERABLE",
    shippingEvidenceRequired: false,
    nextBestEvidence: economics.passesEconomics ? "NONE" :
      previous.nextBestEvidence === "ACTUAL_LUNA_SHIPPING"
        ? "BETTER_PRICE_DISTRIBUTION" : previous.nextBestEvidence,
    nextEvidenceValue: economics.passesEconomics ? "NEAR_ZERO" :
      previous.nextEvidenceValue,
    inputAuthority: { ...record(previous.inputAuthority),
      shipping: "DURABLY_PERSISTED_FACT" },
    evaluatedAt: input.capture.observedAt,
    shippingCaptureEvidence: {
      contractVersion: LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
      candidateId: input.capture.candidateId,
      lunaProductId: input.capture.lunaProductId,
      lunaVariantId: input.capture.lunaVariantId,
      supplierSku: input.capture.supplierSku,
      quantity: input.capture.quantity,
      subtotalUsd: input.capture.subtotalUsd,
      shippingUsd: input.capture.shippingUsd,
      totalUsd: input.capture.totalUsd,
      currency: input.capture.currency,
      observedAt: input.capture.observedAt,
      acquisitionMethod: input.capture.acquisitionMethod,
      evidenceDigest: quote.evidenceDigest,
      extensionEvidenceDigest: input.capture.evidenceDigest,
      captureSessionId: input.capture.captureSessionId,
      noPurchase: true,
      noCredentials: true,
      noRawHtml: true,
    },
  }
  return Object.freeze({ ...nextWithoutDigest,
    frontierDigest: digest(nextWithoutDigest) })
}

export async function persistLunaChromeShippingCaptureV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  capture: LunaShippingCapturePostV1
  sessionSecret: string
  now?: number
}>) {
  const [authority] = await resolveLunaChromeShippingJobsV1({
    supabase: input.supabase, accountKey: input.accountKey,
    candidateIds: [input.capture.candidateId], sessionSecret: input.sessionSecret,
    now: input.now,
  })
  if (!authority) throw new Error("LUNA_SHIPPING_EXTENSION_JOB_AUTHORITY_MISMATCH")
  const latestResult = await input.supabase.rpc(
    "get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey, p_marketplace_id: "EBAY_US",
      p_family_ids: null, p_limit: 100,
    })
  if (latestResult.error) {
    throw new Error("LUNA_SHIPPING_EXTENSION_CANDIDATE_EVIDENCE_READ_FAILED")
  }
  const source = records(record(latestResult.data).frontiers).find((outer) => {
    const frontier = record(outer.frontier)
    return frontier.lunaProductId === authority.identity.lunaProductId &&
      frontier.lunaVariantId === authority.identity.lunaVariantId &&
      frontier.lunaSku === authority.identity.supplierSku
  })
  const snapshotDigest = text(source?.snapshotDigest, 80)
  if (!source || !snapshotDigest || !SHA256.test(snapshotDigest)) {
    throw new Error("LUNA_SHIPPING_CAPTURE_SESSION_REPLAYED")
  }
  verifyLunaShippingCaptureSessionV1({
    secret: input.sessionSecret, candidateId: input.capture.candidateId,
    snapshotDigest, captureSessionId: input.capture.captureSessionId,
    nonce: input.capture.nonce, now: input.now,
  })
  const certified = certifyLunaShippingCapturePostV1({
    job: Object.freeze({ ...authority,
      captureSessionId: input.capture.captureSessionId,
      nonce: input.capture.nonce }),
    capture: input.capture, now: input.now,
  })
  const frontier = persistedFrontier({ source, certified, capture: input.capture })
  const persistedFamilyId = text(record(frontier).familyId, 120)
  if (!persistedFamilyId ||
      !/^market-family-v1:sha256:[0-9a-f]{64}$/.test(persistedFamilyId)) {
    throw new Error("LUNA_SHIPPING_CAPTURE_DURABLE_WRITE_FAILED")
  }
  const observedAt = new Date(input.capture.observedAt).toISOString()
  const write = await input.supabase.rpc("put_seller_os_profitability_frontier_v1", {
    p_account_key: input.accountKey,
    p_marketplace_id: "EBAY_US",
    p_opportunity_case_id: source.opportunityCaseId ?? null,
    p_market_price_evidence_reference: source.marketPriceEvidenceReference,
    p_market_price_evidence_digest: source.marketPriceEvidenceDigest,
    p_ebay_fee_policy_reference: source.ebayFeePolicyReference,
    p_economic_policy_reference: source.economicPolicyReference,
    p_economic_policy_digest: source.economicPolicyDigest,
    p_source_updated_at: observedAt,
    p_evidence_cutoff_at: observedAt,
    p_frontier: frontier,
  })
  if (write.error) throw new Error("LUNA_SHIPPING_CAPTURE_DURABLE_WRITE_FAILED")
  if (record(write.data).outcome !== "CREATED") {
    throw new Error("LUNA_SHIPPING_CAPTURE_SESSION_REPLAYED")
  }
  const readback = await input.supabase.rpc(
    "get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey, p_marketplace_id: "EBAY_US",
      p_family_ids: [persistedFamilyId], p_limit: 10,
    })
  if (readback.error) throw new Error("LUNA_SHIPPING_CAPTURE_DURABLE_READBACK_FAILED")
  const matched = records(record(readback.data).frontiers).find((outer) => {
    const stored = record(outer.frontier)
    const evidence = record(stored.shippingCaptureEvidence)
    return stored.frontierDigest === frontier.frontierDigest &&
      stored.shippingStatus === "SHIPPING_DURABLY_PERSISTED" &&
      evidence.evidenceDigest === certified.quote.evidenceDigest &&
      evidence.candidateId === input.capture.candidateId
  })
  if (!matched) throw new Error("LUNA_SHIPPING_CAPTURE_DURABLE_READBACK_FAILED")
  return Object.freeze({
    capturePostAccepted: true as const,
    captureResultDurable: true as const,
    durableReadbackMatch: true as const,
    durableStore: "seller_os_profitability_frontier_snapshots" as const,
    productName: authority.productName,
    identity: authority.identity,
    capture: Object.freeze({ subtotalUsd: input.capture.subtotalUsd,
      shippingUsd: input.capture.shippingUsd, totalUsd: input.capture.totalUsd }),
    quote: certified.quote,
    economics: certified.economics,
    ack: Object.freeze({ status: "LUNA_SHIPPING_CAPTURE_DURABLY_ACCEPTED" as const,
      frontierId: text(record(write.data).frontierId, 120),
      frontierDigest: frontier.frontierDigest }),
    lunaPurchases: 0 as const,
    marketplaceWrites: 0 as const,
  })
}
