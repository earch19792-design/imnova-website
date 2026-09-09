import "server-only"

import { createHash, createHmac, timingSafeEqual } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  certifyLunaShippingCapturePostV1,
  LUNA_SHIPPING_EXTENSION_MAXIMUM_BATCH,
  LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
  LUNA_SHIPPING_RUNTIME_TRACE_MAXIMUM_EVENTS,
  LUNA_SHIPPING_RUNTIME_TRACE_VERSION,
  LUNA_PRODUCT_PAGE_STOCK_MAXIMUM_AGE_SECONDS,
  LUNA_PRODUCT_PAGE_STOCK_OBSERVATION_VERSION,
  LUNA_NORMAL_CHROME_PRODUCT_PAGE_STOCK_SOURCE,
  normalizeLunaChromeShippingDestinationV1,
  normalizeLunaChromeShippingJobV1,
  normalizeLunaShippingRuntimeTraceEventV1,
  type LunaChromeShippingJobV1,
  type LunaProductPageOosPostV1,
  type LunaShippingCapturePostV1,
  type LunaShippingRuntimeTraceEventV1,
} from "./ebay-luna-chrome-shipping-capture-v1"
import { EBAY_LUNA_BOCA_RATON_LOCATION } from
  "./ebay-merchant-location-one-shot-gateway"
import {
  readProductFitStrongPromotionsV1,
  resolveDurableProductFitStrongV1,
} from "./ebay-product-fit-durable-promotion-v1"
import {
  SELLER_OS_ECONOMIC_SHIPPING_BATCH_LIMIT_V1,
  SELLER_OS_ECONOMIC_SHIPPING_MAX_ATTEMPTS_V1,
  economicShippingFreshnessGenerationV1,
  reusableEconomicShippingEvidenceV1,
} from "../seller-os/economic-shipping-refresh-reclaim-loop-v1"
import {
  SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_MAX_ATTEMPTS_V1,
  SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_RUNTIME_SHA_V1,
  certifySellerOsEconomicShippingLegacyRecoveryGateV1,
  sellerOsEconomicShippingLegacyRecoveryGenerationV1,
  type SellerOsEconomicShippingLegacyRecoveryGateV1,
} from "../seller-os/economic-shipping-legacy-recovery-authority-v1"
import {
  SELLER_OS_LEGACY_OUT_OF_SCOPE_DISPOSITION_AUTHORITY_V2,
  SELLER_OS_LEGACY_SHIPPING_INCIDENT_COHORT_ID_V1,
} from "../seller-os/incident-cohort-reconciler-authority-guard-v1"
import { LUNA_HTTP_SHIPPING_SOURCE } from
  "./ebay-luna-authoritative-shipping-v1"
import {
  persistLiveListingShippingQuoteV1,
  readLatestLiveListingShippingEvidenceV1,
  resolveExactCurrentLiveIdentityV1,
  type LiveListingShippingCaptureTargetV1,
} from "./ebay-live-listing-shipping-evidence-server-v1"
import { calculateEbayMinimumOperatorPrice, calculateEbayUnitEconomics } from
  "./ebay-unit-economics"
import { buildEconomicEvidenceV1 } from
  "../seller-os/economic-evidence-refresh-v1"

export const LUNA_SHIPPING_CANARY_CANDIDATE_ID =
  "sha256:39f9566e97c230d9fdf9882a802af7dad8a7a0e54ab000999bcc3da779f4ab60" as const
export const LUNA_CHROME_LIVE_LISTING_CAPTURE_SCOPE_V1 =
  "LUNA_CHROME_LIVE_LISTING_CAPTURE_SCOPE_V1" as const

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

function exactFrontierSourceForCandidate(
  sources: readonly JsonRecord[],
  expectedCandidateId: string,
  identity: Readonly<{
    lunaProductId: string
    lunaVariantId: string
    supplierSku: string
  }>,
) {
  return sources.find((outer) => {
    const frontier = record(outer.frontier)
    const familyId = text(frontier.familyId, 120)
    return Boolean(familyId) &&
      frontier.lunaProductId === identity.lunaProductId &&
      frontier.lunaVariantId === identity.lunaVariantId &&
      frontier.lunaSku === identity.supplierSku &&
      candidateId(familyId!, identity.lunaProductId, identity.lunaVariantId,
        identity.supplierSku) === expectedCandidateId
  })
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

async function freshProductPageOosCandidateIds(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  candidates: readonly Readonly<{ candidateId: string
    lunaProductId: string; lunaVariantId: string; supplierSku: string }>[]
  now: number
}>) {
  if (!input.candidates.length) return new Set<string>()
  const runs = await input.supabase.from("ebay_same_day_pilot_runs")
    .select("id").eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US").order("created_at", { ascending: false })
    .limit(100)
  if (runs.error) throw new Error("LUNA_PRODUCT_PAGE_OOS_AUTHORITY_READ_FAILED")
  const runIds = records(runs.data).map((row) => text(row.id, 80))
    .filter((id): id is string => Boolean(id))
  if (!runIds.length) return new Set<string>()
  const events = await input.supabase.from("ebay_same_day_pilot_events")
    .select("event_payload,created_at").in("run_id", runIds)
    .eq("event_type", LUNA_PRODUCT_PAGE_STOCK_OBSERVATION_VERSION)
    .order("created_at", { ascending: false }).limit(1_000)
  if (events.error) throw new Error("LUNA_PRODUCT_PAGE_OOS_AUTHORITY_READ_FAILED")
  const candidates = new Map(input.candidates.map((candidate) =>
    [candidate.candidateId, candidate]))
  const rejected = new Set<string>()
  for (const row of records(events.data)) {
    const evidence = record(row.event_payload)
    const candidateId = text(evidence.candidateId, 80)
    const candidate = candidateId ? candidates.get(candidateId) : null
    const observedAt = Date.parse(String(evidence.observedAt ?? ""))
    const maximumAgeSeconds = Number(evidence.maximumAgeSeconds)
    const { decisionDigest: _decisionDigest, ...body } = evidence
    if (!candidate || rejected.has(candidateId!) ||
        evidence.contractVersion !== LUNA_PRODUCT_PAGE_STOCK_OBSERVATION_VERSION ||
        evidence.productPageStockStatus !== "FRESH_OUT_OF_STOCK" ||
        evidence.productOosConfirmed !== true ||
        evidence.observedAvailability !== false ||
        evidence.candidateDecision !== "REJECT_STOCK" ||
        evidence.lunaProductId !== candidate.lunaProductId ||
        evidence.lunaVariantId !== candidate.lunaVariantId ||
        evidence.supplierSku !== candidate.supplierSku ||
        !SHA256.test(String(evidence.decisionDigest ?? "")) ||
        evidence.decisionDigest !== digest(body) ||
        !Number.isFinite(observedAt) || !Number.isInteger(maximumAgeSeconds) ||
        maximumAgeSeconds !== LUNA_PRODUCT_PAGE_STOCK_MAXIMUM_AGE_SECONDS ||
        input.now < observedAt ||
        input.now - observedAt > maximumAgeSeconds * 1_000) continue
    rejected.add(candidateId!)
  }
  return rejected
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

function liveListingChromeAuthority(input: Awaited<ReturnType<
  typeof resolveExactCurrentLiveIdentityV1>>) {
  const salePriceUsd = money(input.salePriceUsd)
  const supplierCostUsd = money(input.supplierCostUsd)
  const productName = text(input.productName, 200)
  if (input.currency !== "USD" || salePriceUsd === null || salePriceUsd <= 0 ||
      supplierCostUsd === null || !productName) {
    throw new Error("LUNA_SHIPPING_EXTENSION_LIVE_ECONOMIC_FACTS_UNPROVEN")
  }
  const captureScopeId = digest({
    contract: LUNA_CHROME_LIVE_LISTING_CAPTURE_SCOPE_V1,
    identity: input.identity,
  })
  const snapshotDigest = digest({
    contract: LUNA_CHROME_LIVE_LISTING_CAPTURE_SCOPE_V1,
    identity: input.identity,
    canonicalProductUrl: input.canonicalProductUrl,
    linkageDecisionId: input.linkageDecisionId,
    activeListingRegistryId: input.activeListingRegistryId,
    salePriceUsd,
    supplierCostUsd,
    productName,
    destinationProfileDigest: CANONICAL_DESTINATION.profileDigest,
  })
  return Object.freeze({ captureScopeId, snapshotDigest, salePriceUsd,
    supplierCostUsd, productName })
}

export async function resolveLunaChromeShippingLiveListingJobV1(
  input: Readonly<{
    supabase: SupabaseClient
    target: LiveListingShippingCaptureTargetV1
    sessionSecret: string
    now?: number
  }>,
) {
  const resolved = await resolveExactCurrentLiveIdentityV1(input)
  const authority = liveListingChromeAuthority(resolved)
  const session = issueLunaShippingCaptureSessionV1({
    secret: input.sessionSecret,
    candidateId: authority.captureScopeId,
    snapshotDigest: authority.snapshotDigest,
    now: input.now,
  })
  return normalizeLunaChromeShippingJobV1({
    contractVersion: LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
    ...session, snapshotDigest: authority.snapshotDigest,
    identity: {
      candidateId: authority.captureScopeId,
      canonicalProductUrl: resolved.canonicalProductUrl,
      lunaProductId: resolved.identity.lunaProductId,
      lunaVariantId: resolved.identity.lunaVariantId,
      supplierSku: resolved.identity.sourceSku,
      quantity: 1,
    },
    destination: CANONICAL_DESTINATION,
    salePriceUsd: authority.salePriceUsd,
    supplierCostUsd: authority.supplierCostUsd,
    productName: authority.productName,
  })
}

export async function persistLunaChromeLiveListingShippingCaptureV1(
  input: Readonly<{
    supabase: SupabaseClient
    target: LiveListingShippingCaptureTargetV1
    capture: LunaShippingCapturePostV1
    sessionSecret: string
    now?: number
  }>,
) {
  const resolved = await resolveExactCurrentLiveIdentityV1(input)
  const authority = liveListingChromeAuthority(resolved)
  if (input.capture.candidateId !== authority.captureScopeId) {
    throw new Error("LUNA_SHIPPING_EXTENSION_LIVE_SCOPE_MISMATCH")
  }
  verifyLunaShippingCaptureSessionV1({
    secret: input.sessionSecret,
    candidateId: authority.captureScopeId,
    snapshotDigest: authority.snapshotDigest,
    captureSessionId: input.capture.captureSessionId,
    nonce: input.capture.nonce,
    now: input.now,
  })
  const job = normalizeLunaChromeShippingJobV1({
    contractVersion: LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
    captureSessionId: input.capture.captureSessionId,
    nonce: input.capture.nonce,
    snapshotDigest: authority.snapshotDigest,
    identity: {
      candidateId: authority.captureScopeId,
      canonicalProductUrl: resolved.canonicalProductUrl,
      lunaProductId: resolved.identity.lunaProductId,
      lunaVariantId: resolved.identity.lunaVariantId,
      supplierSku: resolved.identity.sourceSku,
      quantity: 1,
    },
    destination: CANONICAL_DESTINATION,
    salePriceUsd: authority.salePriceUsd,
    supplierCostUsd: authority.supplierCostUsd,
    productName: authority.productName,
  })
  const certified = certifyLunaShippingCapturePostV1({
    job, capture: input.capture, now: input.now,
  })
  if (certified.quote.acquisitionMethod !== LUNA_HTTP_SHIPPING_SOURCE) {
    throw new Error("LUNA_SHIPPING_EXTENSION_LIVE_CANONICAL_QUOTE_REQUIRED")
  }
  const liveQuote = Object.freeze({ ...certified.quote,
    acquisitionMethod: LUNA_HTTP_SHIPPING_SOURCE })
  const persisted = await persistLiveListingShippingQuoteV1({
    supabase: input.supabase,
    target: input.target,
    quote: liveQuote,
    resolved,
    now: input.now,
    lunaReaderExecuted: false,
  })
  return Object.freeze({
    ...persisted,
    capturePostAccepted: true as const,
    captureResultDurable: true as const,
    durableReadbackMatch: true as const,
    durableStore: "seller_os_live_listing_shipping_evidence" as const,
    productName: authority.productName,
    identity: job.identity,
    capture: Object.freeze({ subtotalUsd: input.capture.subtotalUsd,
      shippingUsd: input.capture.shippingUsd, totalUsd: input.capture.totalUsd }),
    quote: certified.quote,
    economics: Object.freeze({ status: "NOT_EVALUATED" as const }),
    chromeShippingCaptureAttempts: 1 as const,
    serverHttpLunaRequests: 0 as const,
    marketplaceWrites: 0 as const,
  })
}

export async function resolveLunaChromeShippingJobsV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  candidateIds?: readonly string[]
  sessionSecret: string
  purpose?: "CANONICAL_BIND_BOOTSTRAP"
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
          !lunaProductId || !lunaVariantId || !supplierSku) return []
      const resolvedCandidateId = candidateId(familyId, lunaProductId,
        lunaVariantId, supplierSku)
      const certificationBootstrap =
        input.purpose === "CANONICAL_BIND_BOOTSTRAP" &&
        input.candidateIds?.length === 1 &&
        input.candidateIds[0] === LUNA_SHIPPING_CANARY_CANDIDATE_ID &&
        resolvedCandidateId === LUNA_SHIPPING_CANARY_CANDIDATE_ID
      if (frontier.economicClassification === "ECONOMICALLY_DEAD" &&
          !certificationBootstrap) return []
      const snapshotDigest = text(outer.snapshotDigest, 80)
      if (!snapshotDigest || !SHA256.test(snapshotDigest)) return []
      const calculatedAt = text(outer.calculatedAt, 48) ??
        text(frontier.evaluatedAt, 48)
      if (!calculatedAt || !Number.isFinite(Date.parse(calculatedAt))) return []
      return [Object.freeze({ familyId, lunaProductId, lunaVariantId,
        supplierSku, frontier, outer, snapshotDigest, calculatedAt,
        candidateId: resolvedCandidateId })]
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
  const freshOosCandidateIds = await freshProductPageOosCandidateIds({
    supabase: input.supabase, accountKey: input.accountKey,
    candidates: exactCandidates, now: input.now ?? Date.now(),
  })
  const stockEligibleCandidates = exactCandidates.filter((candidate) =>
    !freshOosCandidateIds.has(candidate.candidateId))
  const requested = input.candidateIds?.length
    ? [...new Set(input.candidateIds)]
    : stockEligibleCandidates.filter((candidate) =>
      !["SHIPPING_DURABLY_PERSISTED", "SHIPPING_OBSERVED"]
        .includes(String(candidate.frontier.shippingStatus)))
      .map((candidate) => candidate.candidateId)
      .slice(0, 2)
  if (requested.length > LUNA_SHIPPING_EXTENSION_MAXIMUM_BATCH ||
      requested.some((candidateId) => !/^sha256:[0-9a-f]{64}$/.test(candidateId))) {
    throw new Error("LUNA_SHIPPING_EXTENSION_CANDIDATE_SCOPE_INVALID")
  }
  if (!requested.length) return Object.freeze([])
  const selected = requested.map((requestedId) => stockEligibleCandidates.find((candidate) =>
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
    const salePriceUsd = money(frontier.marketPriceMedian ??
      record(frontier.quickPickMarketTestV1).preliminaryShippingPendingPrice)
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
      ...session, snapshotDigest: exact.snapshotDigest,
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

export type LunaChromeShippingJobAcquisitionV1 = Readonly<{
  jobs: readonly LunaChromeShippingJobV1[]
  eligiblePendingJobCount: number
  claimedJobCount: number
  reusedEvidenceCount?: number
  leaseConflictCount: number
  claimFailureCount: number
}>

type EconomicShippingRefreshJobV1 = Readonly<{
  job_id: string
  marketplace_account_key: string
  ebay_item_id: string
  source_identity: JsonRecord
  status: string
  last_evidence_id: string | null
  next_retry_at: string | null
  attempt_count: number
  first_detected_at: string
  lease_owner: string | null
  lease_expires_at: string | null
  shipping_freshness_generation?: string | null
  shipping_required_evidence_after?: string | null
  shipping_legacy_recovery_generation?: string | null
}>

function economicLiveTarget(job: EconomicShippingRefreshJobV1,
  accountKey: string): LiveListingShippingCaptureTargetV1 {
  const identity = record(job.source_identity)
  return Object.freeze({
    accountKey,
    marketplaceId: "EBAY_US" as const,
    ebayItemId: job.ebay_item_id,
    lunaProductId: text(identity.lunaProductId, 30) ?? "",
    lunaVariantId: text(identity.lunaVariantId, 30) ?? "",
    sourceSku: text(identity.sourceSku, 160) ?? "",
  })
}

async function acquireEconomicLiveListingShippingJobsV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  runtimeInstanceId: string
  sessionSecret: string
  limit: number
  now?: number
}>) {
  if (input.limit <= 0) return Object.freeze({ jobs: Object.freeze([]),
    eligiblePendingJobCount: 0, claimedJobCount: 0, reusedEvidenceCount: 0,
    leaseConflictCount: 0, claimFailureCount: 0 })
  const observedAt = new Date(input.now ?? Date.now()).toISOString()
  const pending = await input.supabase.from(
    "seller_os_economic_evidence_refresh_jobs_v1")
    .select("job_id,marketplace_account_key,ebay_item_id,source_identity,status,last_evidence_id,next_retry_at,attempt_count,first_detected_at,lease_owner,lease_expires_at,shipping_legacy_recovery_generation")
    .eq("marketplace_account_key", input.accountKey)
    .eq("evidence_type", "LUNA_CURRENT_SHIPPING")
    .in("status", ["STALE", "MISSING", "WAITING_FOR_WORKER",
      "FAILED_RETRYABLE"])
    .is("shipping_legacy_recovery_generation", null)
    .or(`next_retry_at.is.null,next_retry_at.lte.${observedAt}`)
    .order("last_detected_at", { ascending: true })
    .limit(SELLER_OS_ECONOMIC_SHIPPING_BATCH_LIMIT_V1)
  if (pending.error) {
    throw new Error("LUNA_ECONOMIC_SHIPPING_JOB_DISCOVERY_FAILED")
  }
  const rows = records(pending.data) as EconomicShippingRefreshJobV1[]
  const jobs: LunaChromeShippingJobV1[] = []
  let reusedEvidenceCount = 0
  let claimFailureCount = 0
  let leaseConflictCount = 0
  for (const row of rows) {
    let admittedContext: Readonly<{ freshnessGeneration: string }> | null = null
    try {
      const job = await resolveLunaChromeShippingLiveListingJobV1({
        supabase: input.supabase,
        target: economicLiveTarget(row, input.accountKey),
        sessionSecret: input.sessionSecret,
        now: input.now,
      })
      const priorEconomic = row.last_evidence_id
        ? await input.supabase.from("seller_os_live_economic_evidence_v1")
          .select("evidence_id,captured_at,fresh_until,freshness_status,value_amount")
          .eq("evidence_id", row.last_evidence_id).limit(1).maybeSingle()
        : { data: null, error: null }
      if (priorEconomic.error) {
        throw new Error("LUNA_ECONOMIC_SHIPPING_PRIOR_EVIDENCE_READ_FAILED")
      }
      const requiredEvidenceAfter = String(
        priorEconomic.data?.fresh_until ?? row.first_detected_at)
      const freshnessGeneration = economicShippingFreshnessGenerationV1({
        jobId: row.job_id, accountKey: input.accountKey,
        ebayItemId: row.ebay_item_id,
        lunaProductId: job.identity.lunaProductId,
        lunaVariantId: job.identity.lunaVariantId,
        sourceSku: job.identity.supplierSku, requiredEvidenceAfter,
      })
      const priorShipping = await readLatestLiveListingShippingEvidenceV1({
        supabase: input.supabase,
        identity: {
          accountKey: input.accountKey, marketplaceId: "EBAY_US",
          ebayItemId: row.ebay_item_id,
          linkageId: String(row.source_identity.linkageId ?? ""),
          lunaProductId: job.identity.lunaProductId,
          lunaVariantId: job.identity.lunaVariantId,
          sourceSku: job.identity.supplierSku,
        },
        now: input.now,
      })
      const reuseFresh = reusableEconomicShippingEvidenceV1({
        evidence: priorShipping.evidence ? {
          observedAt: priorShipping.evidence.observed_at,
          maximumAgeSeconds: priorShipping.evidence.maximum_age_seconds,
        } : null,
        requiredEvidenceAfter,
        bindingMatches: priorShipping.status === "AVAILABLE" &&
          priorShipping.freshness === "FRESH",
        now: input.now,
      })
      const admission = await input.supabase.rpc(
        "admit_seller_os_economic_shipping_refresh_v1", {
          p_job_id: row.job_id, p_worker_id: input.runtimeInstanceId,
          p_candidate_id: job.identity.candidateId,
          p_snapshot_digest: job.snapshotDigest,
          p_capture_session_id: job.captureSessionId,
          p_freshness_generation: freshnessGeneration,
          p_required_evidence_after: requiredEvidenceAfter,
          p_reuse_fresh_evidence: reuseFresh,
          p_lease_seconds: 900,
          p_max_attempts: SELLER_OS_ECONOMIC_SHIPPING_MAX_ATTEMPTS_V1,
        })
      const admitted = record(admission.data)
      if (admission.error || admitted.admitted !== true) {
        if (admitted.deadLetter === true) claimFailureCount += 1
        else leaseConflictCount += 1
        continue
      }
      admittedContext = { freshnessGeneration }
      if (reuseFresh && priorShipping.evidence) {
        const evidence = buildEconomicEvidenceV1({
          accountKey: input.accountKey, itemId: row.ebay_item_id,
          evidenceType: "LUNA_CURRENT_SHIPPING",
          value: Number(priorShipping.evidence.shipping_cost),
          sourceAuthority: priorShipping.evidence.source_authority,
          sourceEntityId: priorShipping.evidence.evidence_id,
          capturedAt: priorShipping.evidence.observed_at,
          status: "FRESH",
          metadata: { exactBindingReuse: true, freshnessGeneration },
        })
        const evidenceWrite = await input.supabase.from(
          "seller_os_live_economic_evidence_v1")
          .upsert(evidence, { onConflict: "evidence_id", ignoreDuplicates: true })
        if (evidenceWrite.error) {
          throw new Error("LUNA_ECONOMIC_SHIPPING_FRESH_REUSE_WRITE_FAILED")
        }
        const finish = await input.supabase.rpc(
          "finish_seller_os_economic_refresh_job_v1", {
            p_job_id: row.job_id, p_worker_id: input.runtimeInstanceId,
            p_status: "FRESH", p_last_evidence_id: evidence.evidence_id,
            p_failure_class: null, p_next_retry_at: null,
          })
        if (finish.error || finish.data !== true) {
          throw new Error("LUNA_ECONOMIC_SHIPPING_FRESH_REUSE_FINISH_FAILED")
        }
        reusedEvidenceCount += 1
        continue
      }
      jobs.push(Object.freeze({ ...job, economicRefresh: Object.freeze({
        jobId: row.job_id, workerId: input.runtimeInstanceId,
        freshnessGeneration, requiredEvidenceAfter,
        attemptOrdinal: Number(admitted.attemptOrdinal),
      }) }))
    } catch (error) {
      const reasonCode = error instanceof Error &&
        /^[A-Z][A-Z0-9_]{7,159}$/.test(error.message)
        ? error.message : "LUNA_ECONOMIC_SHIPPING_PRECLAIM_FAILED"
      const closed = admittedContext
        ? await input.supabase.rpc(
          "fail_seller_os_economic_shipping_refresh_v1", {
            p_job_id: row.job_id, p_worker_id: input.runtimeInstanceId,
            p_freshness_generation: admittedContext.freshnessGeneration,
            p_reason_code: reasonCode, p_retryable: true,
            p_max_attempts: SELLER_OS_ECONOMIC_SHIPPING_MAX_ATTEMPTS_V1,
          })
        : await input.supabase.rpc(
          "close_seller_os_economic_shipping_preclaim_v1", {
            p_job_id: row.job_id, p_reason_code: reasonCode,
            p_retryable: reasonCode !==
              "LIVE_LISTING_SHIPPING_EXACT_CURRENT_LIVE_REQUIRED",
            p_max_attempts: SELLER_OS_ECONOMIC_SHIPPING_MAX_ATTEMPTS_V1,
          })
      if (closed.error || record(closed.data).closed !== true) {
        throw new Error(admittedContext
          ? "LUNA_ECONOMIC_SHIPPING_EXECUTION_CLOSE_FAILED"
          : "LUNA_ECONOMIC_SHIPPING_PRECLAIM_CLOSE_FAILED")
      }
      claimFailureCount += 1
    }
  }
  return Object.freeze({ jobs: Object.freeze(jobs),
    eligiblePendingJobCount: rows.length, claimedJobCount: jobs.length,
    reusedEvidenceCount, leaseConflictCount, claimFailureCount })
}

export async function closeLunaEconomicShippingExecutionFailureV1(input:
  Readonly<{ supabase: SupabaseClient; accountKey?: string; jobId: string;
    workerId: string; freshnessGeneration: string;
    legacyRecoveryGeneration?: string; reasonCode: string;
    retryable?: boolean }>) {
  const legacy = Boolean(input.legacyRecoveryGeneration)
  const result = await input.supabase.rpc(legacy
    ? "fail_seller_os_economic_shipping_legacy_recovery_v1"
    : "fail_seller_os_economic_shipping_refresh_v1", legacy ? {
      p_marketplace_account_key: input.accountKey,
      p_job_id: input.jobId, p_worker_id: input.workerId,
      p_recovery_generation: input.legacyRecoveryGeneration,
      p_shipping_freshness_generation: input.freshnessGeneration,
      p_reason_code: input.reasonCode,
      p_retryable: input.retryable !== false,
    } : {
      p_job_id: input.jobId, p_worker_id: input.workerId,
      p_freshness_generation: input.freshnessGeneration,
      p_reason_code: input.reasonCode,
      p_retryable: input.retryable !== false,
      p_max_attempts: SELLER_OS_ECONOMIC_SHIPPING_MAX_ATTEMPTS_V1,
    })
  if (result.error || record(result.data).closed !== true) {
    throw new Error("LUNA_ECONOMIC_SHIPPING_FAILURE_CLOSE_FAILED")
  }
  return Object.freeze(record(result.data))
}

export async function closeLegacyShippingIncidentOutOfScopeDispositionV2(
  input: Readonly<{ supabase: SupabaseClient; accountKey: string;
    jobId: string }>,
) {
  const disposition = await input.supabase.rpc(
    SELLER_OS_LEGACY_OUT_OF_SCOPE_DISPOSITION_AUTHORITY_V2, {
      p_marketplace_account_key: input.accountKey,
      p_cohort_id: SELLER_OS_LEGACY_SHIPPING_INCIDENT_COHORT_ID_V1,
      p_job_id: input.jobId,
    })
  const receipt = record(disposition.data)
  if (disposition.error || receipt.closed !== true ||
      receipt.economicJobStateMutated !== false ||
      receipt.recoveryRowCreated !== false ||
      receipt.recoveryGenerationCreated !== false ||
      receipt.shippingLegacyRecoveryGenerationCreated !== false ||
      receipt.chromeDispatchCount !== 0 ||
      receipt.marketplaceWriteCount !== 0) {
    throw new Error("SELLER_OS_INCIDENT_OUT_OF_SCOPE_DISPOSITION_FAILED")
  }
  return Object.freeze(receipt)
}

export async function acquireOneLegacyEconomicShippingRecoveryV1(input:
  Readonly<{ supabase: SupabaseClient; accountKey: string; jobId: string;
    runtimeInstanceId: string; leaderSessionId: string; sessionSecret: string;
    gate: Omit<SellerOsEconomicShippingLegacyRecoveryGateV1,
      "jobLegacyClassificationProven">; now?: number }>) {
  const gate = certifySellerOsEconomicShippingLegacyRecoveryGateV1({
    ...input.gate, jobLegacyClassificationProven: true,
  })
  const recoveryRead = await input.supabase.from(
    "seller_os_economic_shipping_legacy_recoveries_v1")
    .select("recovery_generation,classification,classification_fingerprint,runtime_commit_sha,status,historical_attempt_count,recovery_attempt_count,recovery_next_retry_at,candidate_id,snapshot_digest,capture_session_id,shipping_freshness_generation,required_evidence_after,last_reason_code")
    .eq("marketplace_account_key", input.accountKey)
    .eq("job_id", input.jobId).limit(1).maybeSingle()
  if (recoveryRead.error) {
    throw new Error("SELLER_OS_LEGACY_SHIPPING_RECOVERY_READ_FAILED")
  }
  const existing = recoveryRead.data ? record(recoveryRead.data) : null
  let classification: JsonRecord
  if (existing) {
    if (existing.runtime_commit_sha !==
        SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_RUNTIME_SHA_V1) {
      throw new Error("SELLER_OS_LEGACY_SHIPPING_RECOVERY_RUNTIME_MISMATCH")
    }
    classification = {
      classification: existing.classification,
      classificationProven: true,
      classificationFingerprint: existing.classification_fingerprint,
      historicalAttemptCount: existing.historical_attempt_count,
      reasonCode: existing.last_reason_code,
    }
  } else {
    const classified = await input.supabase.rpc(
      "classify_seller_os_economic_shipping_legacy_job_v1", {
        p_marketplace_account_key: input.accountKey, p_job_id: input.jobId,
      })
    if (classified.error) {
      throw new Error("SELLER_OS_LEGACY_SHIPPING_CLASSIFICATION_READ_FAILED")
    }
    classification = record(classified.data)
  }
  const fingerprint = text(classification.classificationFingerprint, 80)
  if (classification.classificationProven !== true || !fingerprint ||
      !/^sha256:[0-9a-f]{64}$/.test(fingerprint)) {
    throw new Error("SELLER_OS_LEGACY_SHIPPING_CLASSIFICATION_UNPROVEN")
  }
  const recoveryGeneration =
    sellerOsEconomicShippingLegacyRecoveryGenerationV1({
      accountKey: input.accountKey, jobId: input.jobId,
      classificationFingerprint: fingerprint,
    })
  if (existing && existing.recovery_generation !== recoveryGeneration) {
    throw new Error("SELLER_OS_LEGACY_SHIPPING_RECOVERY_BINDING_MISMATCH")
  }
  const commonGate = {
    p_marketplace_account_key: input.accountKey, p_job_id: input.jobId,
    p_runtime_commit_sha:
      SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_RUNTIME_SHA_V1,
    p_legacy_shipping_runtime_active: gate.legacyShippingRuntimeActive,
    p_heartbeat_v1_total: gate.heartbeatV1Total,
    p_phase_a_v2_active: gate.phaseAV2Active,
    p_b618_runtime_active: gate.b618RuntimeActive,
    p_classification_fingerprint: fingerprint,
    p_recovery_generation: recoveryGeneration,
  }
  if (existing && ["COMPLETED", "FAILED_TERMINAL"].includes(
    String(existing.status))) {
    return Object.freeze({ jobs: Object.freeze([]), classification,
      recoveryGeneration, outOfScopeClosed:
        existing.classification === "OUT_OF_SCOPE_NO_ACTIVE_LISTING",
      terminal: true as const,
      historicalAttemptCount: Number(classification.historicalAttemptCount) })
  }
  if (classification.classification === "OUT_OF_SCOPE_NO_ACTIVE_LISTING") {
    throw new Error("SELLER_OS_INCIDENT_OUT_OF_SCOPE_MEMBERSHIP_REQUIRED")
  }
  if (classification.classification !== "RECOVERABLE_VALID_SCOPE") {
    throw new Error("SELLER_OS_LEGACY_SHIPPING_RECOVERABLE_SCOPE_REQUIRED")
  }
  const jobRead = await input.supabase.from(
    "seller_os_economic_evidence_refresh_jobs_v1")
    .select("job_id,marketplace_account_key,ebay_item_id,source_identity,status,last_evidence_id,next_retry_at,attempt_count,first_detected_at,lease_owner,lease_expires_at,shipping_legacy_recovery_generation")
    .eq("marketplace_account_key", input.accountKey)
    .eq("job_id", input.jobId).limit(1).maybeSingle()
  if (jobRead.error || !jobRead.data) {
    throw new Error("SELLER_OS_LEGACY_SHIPPING_JOB_READ_FAILED")
  }
  const row = jobRead.data as EconomicShippingRefreshJobV1
  const job = await resolveLunaChromeShippingLiveListingJobV1({
    supabase: input.supabase, target: economicLiveTarget(row, input.accountKey),
    sessionSecret: input.sessionSecret, now: input.now,
  })
  const requiredEvidenceAfter = text(existing?.required_evidence_after, 48) ??
    text(classification.legacyLastDetectedAt, 48) ??
    new Date(input.now ?? Date.now()).toISOString()
  const computedFreshnessGeneration = economicShippingFreshnessGenerationV1({
    jobId: row.job_id, accountKey: input.accountKey,
    ebayItemId: row.ebay_item_id, lunaProductId: job.identity.lunaProductId,
    lunaVariantId: job.identity.lunaVariantId,
    sourceSku: job.identity.supplierSku, requiredEvidenceAfter,
  })
  const freshnessGeneration = text(existing?.shipping_freshness_generation,
    160) ?? computedFreshnessGeneration
  if (existing?.shipping_freshness_generation &&
      freshnessGeneration !== computedFreshnessGeneration) {
    throw new Error("SELLER_OS_LEGACY_SHIPPING_FRESHNESS_BINDING_MISMATCH")
  }
  const priorShipping = await readLatestLiveListingShippingEvidenceV1({
    supabase: input.supabase,
    identity: { accountKey: input.accountKey, marketplaceId: "EBAY_US",
      ebayItemId: row.ebay_item_id,
      linkageId: String(row.source_identity.linkageId ?? ""),
      lunaProductId: job.identity.lunaProductId,
      lunaVariantId: job.identity.lunaVariantId,
      sourceSku: job.identity.supplierSku },
    now: input.now,
  })
  const reuseFresh = reusableEconomicShippingEvidenceV1({
    evidence: priorShipping.evidence ? {
      observedAt: priorShipping.evidence.observed_at,
      maximumAgeSeconds: priorShipping.evidence.maximum_age_seconds,
    } : null,
    requiredEvidenceAfter,
    bindingMatches: priorShipping.status === "AVAILABLE" &&
      priorShipping.freshness === "FRESH",
    now: input.now,
  })
  const admission = await input.supabase.rpc(
    "begin_seller_os_economic_shipping_legacy_recovery_v1", {
      ...commonGate, p_worker_id: input.runtimeInstanceId,
      p_leader_session_id: input.leaderSessionId,
      p_candidate_id: job.identity.candidateId,
      p_snapshot_digest: job.snapshotDigest,
      p_capture_session_id: job.captureSessionId,
      p_shipping_freshness_generation: freshnessGeneration,
      p_required_evidence_after: requiredEvidenceAfter,
      p_reuse_fresh_evidence: reuseFresh,
      p_lease_seconds: 900,
      p_max_recovery_attempts:
        SELLER_OS_ECONOMIC_SHIPPING_LEGACY_RECOVERY_MAX_ATTEMPTS_V1,
    })
  const admitted = record(admission.data)
  if (admission.error) {
    throw new Error("SELLER_OS_LEGACY_SHIPPING_RECOVERY_ADMISSION_FAILED")
  }
  if (admitted.admitted !== true) {
    return Object.freeze({ jobs: Object.freeze([]), classification,
      recoveryGeneration, admission: Object.freeze(admitted),
      outOfScopeClosed: false as const,
      historicalAttemptCount: Number(classification.historicalAttemptCount) })
  }
  if (reuseFresh && priorShipping.evidence) {
    const evidence = buildEconomicEvidenceV1({
      accountKey: input.accountKey, itemId: row.ebay_item_id,
      evidenceType: "LUNA_CURRENT_SHIPPING",
      value: Number(priorShipping.evidence.shipping_cost),
      sourceAuthority: priorShipping.evidence.source_authority,
      sourceEntityId: priorShipping.evidence.evidence_id,
      capturedAt: priorShipping.evidence.observed_at, status: "FRESH",
      metadata: { exactBindingReuse: true, freshnessGeneration,
        legacyRecoveryGeneration: recoveryGeneration },
    })
    const evidenceWrite = await input.supabase.from(
      "seller_os_live_economic_evidence_v1").upsert(evidence, {
        onConflict: "evidence_id", ignoreDuplicates: true,
      })
    if (evidenceWrite.error) {
      throw new Error("SELLER_OS_LEGACY_SHIPPING_FRESH_REUSE_WRITE_FAILED")
    }
    const finish = await input.supabase.rpc(
      "finish_seller_os_economic_shipping_legacy_recovery_v1", {
        p_marketplace_account_key: input.accountKey,
        p_job_id: row.job_id, p_worker_id: input.runtimeInstanceId,
        p_recovery_generation: recoveryGeneration,
        p_shipping_freshness_generation: freshnessGeneration,
        p_last_evidence_id: evidence.evidence_id,
      })
    if (finish.error || record(finish.data).finished !== true) {
      throw new Error("SELLER_OS_LEGACY_SHIPPING_FRESH_REUSE_FINISH_FAILED")
    }
    return Object.freeze({ jobs: Object.freeze([]), classification,
      recoveryGeneration, admission: Object.freeze(admitted),
      outOfScopeClosed: false as const, reusedEvidenceCount: 1 as const,
      historicalAttemptCount: Number(classification.historicalAttemptCount) })
  }
  const recoveryJob = Object.freeze({ ...job, economicRefresh: Object.freeze({
    jobId: row.job_id, workerId: input.runtimeInstanceId,
    freshnessGeneration, recoveryGeneration,
    legacyRecoveryGeneration: recoveryGeneration, requiredEvidenceAfter,
    attemptOrdinal: Number(admitted.recoveryAttemptOrdinal),
  }) })
  return Object.freeze({ jobs: Object.freeze([recoveryJob]), classification,
    recoveryGeneration, admission: Object.freeze(admitted),
    outOfScopeClosed: false as const,
    historicalAttemptCount: Number(classification.historicalAttemptCount) })
}

export async function acquireLunaChromeShippingJobsV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  runtimeInstanceId: string
  sessionSecret: string
  now?: number
}>): Promise<LunaChromeShippingJobAcquisitionV1> {
  let eligible: readonly LunaChromeShippingJobV1[] = Object.freeze([])
  let standardDiscoveryError: unknown = null
  try {
    eligible = await resolveLunaChromeShippingJobsV1({
      supabase: input.supabase, accountKey: input.accountKey,
      sessionSecret: input.sessionSecret, now: input.now,
    })
  } catch (error) {
    // Quick Pick and LIVE economics share the certified Chrome executor, but
    // their discovery authorities are independent. A degraded frontier must
    // not strand a durable LIVE economic shipping job.
    standardDiscoveryError = error
  }
  const jobs: LunaChromeShippingJobV1[] = []
  let leaseConflictCount = 0
  let claimFailureCount = 0
  for (const job of eligible) {
    const claim = await input.supabase.rpc(
      "claim_seller_os_luna_shipping_job_v1", {
        p_account_key: input.accountKey,
        p_candidate_id: job.identity.candidateId,
        p_snapshot_digest: job.snapshotDigest,
        p_runtime_instance_id: input.runtimeInstanceId,
        p_capture_session_id: job.captureSessionId,
      })
    if (claim.error) {
      claimFailureCount += 1
      continue
    }
    const result = records(claim.data)[0]
    if (result?.claimed === true) jobs.push(job)
    else leaseConflictCount += 1
  }
  const economic = await acquireEconomicLiveListingShippingJobsV1({
    supabase: input.supabase, accountKey: input.accountKey,
    runtimeInstanceId: input.runtimeInstanceId,
    sessionSecret: input.sessionSecret,
    limit: Math.min(SELLER_OS_ECONOMIC_SHIPPING_BATCH_LIMIT_V1,
      Math.max(0, LUNA_SHIPPING_EXTENSION_MAXIMUM_BATCH - jobs.length)),
    now: input.now,
  })
  jobs.push(...economic.jobs)
  leaseConflictCount += economic.leaseConflictCount
  claimFailureCount += economic.claimFailureCount
  if (standardDiscoveryError && economic.eligiblePendingJobCount === 0) {
    throw standardDiscoveryError
  }
  if (claimFailureCount > 0 && jobs.length === 0) {
    throw new Error("LUNA_SHIPPING_JOB_CLAIM_AUTHORITY_UNAVAILABLE")
  }
  return Object.freeze({ jobs: Object.freeze(jobs),
    eligiblePendingJobCount: eligible.length +
      economic.eligiblePendingJobCount,
    claimedJobCount: jobs.length, leaseConflictCount, claimFailureCount })
}

export async function tryPersistEconomicLiveListingShippingCaptureV1(
  input: Readonly<{
    supabase: SupabaseClient
    accountKey: string
    capture: LunaShippingCapturePostV1
    sessionSecret: string
    now?: number
  }>,
) {
  const candidates = await input.supabase.from(
    "seller_os_economic_evidence_refresh_jobs_v1")
    .select("job_id,ebay_item_id,source_identity,lease_owner,lease_expires_at,shipping_freshness_generation,shipping_required_evidence_after,shipping_legacy_recovery_generation")
    .eq("marketplace_account_key", input.accountKey)
    .eq("evidence_type", "LUNA_CURRENT_SHIPPING")
    .eq("status", "REFRESHING")
    .gt("lease_expires_at", new Date(input.now ?? Date.now()).toISOString())
    .order("updated_at", { ascending: false }).limit(20)
  if (candidates.error) {
    throw new Error("LUNA_ECONOMIC_SHIPPING_REFRESH_READ_FAILED")
  }
  for (const raw of records(candidates.data)) {
    const row = raw as EconomicShippingRefreshJobV1
    const target = economicLiveTarget(row, input.accountKey)
    let job: LunaChromeShippingJobV1
    try {
      job = await resolveLunaChromeShippingLiveListingJobV1({
        supabase: input.supabase, target, sessionSecret: input.sessionSecret,
        now: input.now,
      })
    } catch { continue }
    if (job.identity.candidateId !== input.capture.candidateId) continue
    const activeClaim = await input.supabase.from(
      "seller_os_luna_shipping_job_claims")
      .select("capture_session_id,snapshot_digest,status,freshness_generation,required_evidence_after")
      .eq("account_key", input.accountKey)
      .eq("candidate_id", job.identity.candidateId)
      .eq("capture_session_id", input.capture.captureSessionId)
      .eq("snapshot_digest", job.snapshotDigest)
      .eq("status", "CLAIMED").limit(1).maybeSingle()
    if (activeClaim.error) {
      throw new Error("LUNA_ECONOMIC_SHIPPING_EXECUTOR_BINDING_READ_FAILED")
    }
    const freshnessGeneration = text(
      row.shipping_freshness_generation, 160)
    const requiredEvidenceAfter = text(
      row.shipping_required_evidence_after, 48)
    if (!activeClaim.data || !freshnessGeneration ||
        activeClaim.data.freshness_generation !== freshnessGeneration ||
        !requiredEvidenceAfter ||
        Date.parse(activeClaim.data.required_evidence_after) !==
          Date.parse(requiredEvidenceAfter)) {
      continue
    }
    const persisted = await persistLunaChromeLiveListingShippingCaptureV1({
      supabase: input.supabase, target, capture: input.capture,
      sessionSecret: input.sessionSecret, now: input.now,
    })
    const observedAt = new Date(input.now ?? Date.now()).toISOString()
    const evidence = buildEconomicEvidenceV1({
      accountKey: input.accountKey, itemId: target.ebayItemId,
      evidenceType: "LUNA_CURRENT_SHIPPING",
      value: persisted.shippingCost,
      sourceAuthority: persisted.acquisitionMethod,
      sourceEntityId: persisted.evidenceId,
      capturedAt: observedAt, status: "FRESH",
      metadata: { destinationFingerprint: persisted.destinationFingerprint,
        supplierSubtotal: persisted.supplierSubtotal,
        purchaseBoundaryEnforced: persisted.purchaseBoundaryEnforced,
        freshnessGeneration },
    })
    const evidenceWrite = await input.supabase.from(
      "seller_os_live_economic_evidence_v1")
      .upsert(evidence, { onConflict: "evidence_id",
        ignoreDuplicates: true })
    if (evidenceWrite.error) {
      throw new Error("LUNA_ECONOMIC_SHIPPING_EVIDENCE_PERSIST_FAILED")
    }
    const shippingClaim = await input.supabase.rpc(
      "complete_seller_os_luna_shipping_job_v1", {
        p_account_key: input.accountKey,
        p_candidate_id: job.identity.candidateId,
        p_snapshot_digest: job.snapshotDigest,
        p_capture_session_id: input.capture.captureSessionId,
      })
    if (shippingClaim.error || shippingClaim.data !== true) {
      throw new Error("LUNA_ECONOMIC_SHIPPING_SECONDARY_FINISH_FAILED")
    }
    const recoveryGeneration = text(
      row.shipping_legacy_recovery_generation, 180)
    const finish = await input.supabase.rpc(recoveryGeneration
      ? "finish_seller_os_economic_shipping_legacy_recovery_v1"
      : "finish_seller_os_economic_refresh_job_v1", recoveryGeneration ? {
        p_marketplace_account_key: input.accountKey,
        p_job_id: row.job_id, p_worker_id: row.lease_owner,
        p_recovery_generation: recoveryGeneration,
        p_shipping_freshness_generation: freshnessGeneration,
        p_last_evidence_id: evidence.evidence_id,
      } : {
        p_job_id: row.job_id,
        p_worker_id: row.lease_owner,
        p_status: "FRESH",
        p_last_evidence_id: evidence.evidence_id,
        p_failure_class: null,
        p_next_retry_at: null,
      })
    if (finish.error || (recoveryGeneration
      ? record(finish.data).finished !== true : finish.data !== true)) {
      throw new Error("LUNA_ECONOMIC_SHIPPING_JOB_FINISH_FAILED")
    }
    return Object.freeze({ ...persisted,
      economicRefreshJobId: row.job_id,
      economicEvidenceId: evidence.evidence_id,
      automaticWorkerClaim: true as const,
      economicsRecomputationScheduled: true as const,
    })
  }
  return null
}

async function completeLunaChromeShippingJobClaimV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  candidateId: string
  snapshotDigest: string
  captureSessionId: string
}>) {
  try {
    const completion = await input.supabase.rpc(
      "complete_seller_os_luna_shipping_job_v1", {
        p_account_key: input.accountKey,
        p_candidate_id: input.candidateId,
        p_snapshot_digest: input.snapshotDigest,
        p_capture_session_id: input.captureSessionId,
      })
    return !completion.error && completion.data === true
  } catch { return false }
}

const PRODUCT_PAGE_OOS_KEYS = Object.freeze([
  "acquisitionMethod", "candidateId", "captureSessionId", "evidenceDigest",
  "lunaProductId", "lunaVariantId", "nonce", "observedAt",
  "outOfStockMarker", "productOosConfirmed", "productPageStockStatus",
  "quantity", "soldOutMarker", "supplierSku",
].sort())

function normalizeProductPageOos(input: LunaProductPageOosPostV1,
  authority: LunaChromeShippingJobV1, now: number) {
  const keys = Object.keys(input).sort()
  const observedAt = Date.parse(input.observedAt)
  if (keys.length !== PRODUCT_PAGE_OOS_KEYS.length ||
      keys.some((key, index) => key !== PRODUCT_PAGE_OOS_KEYS[index]) ||
      input.candidateId !== authority.identity.candidateId ||
      input.lunaProductId !== authority.identity.lunaProductId ||
      input.lunaVariantId !== authority.identity.lunaVariantId ||
      input.supplierSku !== authority.identity.supplierSku ||
      input.quantity !== authority.identity.quantity ||
      input.productPageStockStatus !== "FRESH_OUT_OF_STOCK" ||
      input.productOosConfirmed !== true ||
      (input.soldOutMarker !== true && input.outOfStockMarker !== true) ||
      typeof input.soldOutMarker !== "boolean" ||
      typeof input.outOfStockMarker !== "boolean" ||
      input.acquisitionMethod !== LUNA_NORMAL_CHROME_PRODUCT_PAGE_STOCK_SOURCE ||
      !SHA256.test(input.evidenceDigest) || !Number.isFinite(observedAt) ||
      observedAt > now + 60_000 || now - observedAt > CAPTURE_SESSION_MAXIMUM_AGE_MS) {
    throw new Error("LUNA_PRODUCT_PAGE_OOS_EVIDENCE_INVALID")
  }
  return Object.freeze({ ...input, observedAt: new Date(observedAt).toISOString() })
}

export async function persistLunaProductPageOosV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  observation: LunaProductPageOosPostV1
  sessionSecret: string
  now?: number
}>) {
  const now = input.now ?? Date.now()
  const [authority] = await resolveLunaChromeShippingJobsV1({
    supabase: input.supabase, accountKey: input.accountKey,
    candidateIds: [input.observation.candidateId],
    sessionSecret: input.sessionSecret, now,
  })
  if (!authority) throw new Error("LUNA_PRODUCT_PAGE_OOS_AUTHORITY_MISMATCH")
  const observation = normalizeProductPageOos(input.observation, authority, now)
  const latest = await input.supabase.rpc(
    "get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey, p_marketplace_id: "EBAY_US",
      p_family_ids: null, p_limit: 100,
    })
  if (latest.error) throw new Error("LUNA_PRODUCT_PAGE_OOS_AUTHORITY_READ_FAILED")
  const source = exactFrontierSourceForCandidate(
    records(record(latest.data).frontiers), observation.candidateId, {
      lunaProductId: observation.lunaProductId,
      lunaVariantId: observation.lunaVariantId,
      supplierSku: observation.supplierSku,
    })
  const snapshotDigest = text(source?.snapshotDigest, 80)
  if (!source || !snapshotDigest || !SHA256.test(snapshotDigest)) {
    throw new Error("LUNA_PRODUCT_PAGE_OOS_AUTHORITY_MISMATCH")
  }
  verifyLunaShippingCaptureSessionV1({
    secret: input.sessionSecret, candidateId: observation.candidateId,
    snapshotDigest, captureSessionId: observation.captureSessionId,
    nonce: observation.nonce, now,
  })
  const eventBody = {
    contractVersion: LUNA_PRODUCT_PAGE_STOCK_OBSERVATION_VERSION,
    candidateId: observation.candidateId,
    lunaProductId: observation.lunaProductId,
    lunaVariantId: observation.lunaVariantId,
    supplierSku: observation.supplierSku,
    quantity: observation.quantity,
    productPageStockStatus: "FRESH_OUT_OF_STOCK",
    productOosConfirmed: true,
    soldOutMarker: observation.soldOutMarker,
    outOfStockMarker: observation.outOfStockMarker,
    observedAvailability: false,
    observedAt: observation.observedAt,
    maximumAgeSeconds: LUNA_PRODUCT_PAGE_STOCK_MAXIMUM_AGE_SECONDS,
    acquisitionMethod: observation.acquisitionMethod,
    extensionEvidenceDigest: observation.evidenceDigest,
    candidateDecision: "REJECT_STOCK",
    exactIdentityOnly: true,
    titleOnlyAttribution: false,
  }
  const eventPayload = Object.freeze({ ...eventBody,
    decisionDigest: digest(eventBody) })
  const runId = await latestSameDayRun(input)
  const candidate = await input.supabase.from("ebay_same_day_pilot_candidates")
    .select("id").eq("run_id", runId)
    .eq("candidate_key", observation.candidateId).limit(1).maybeSingle()
  const durableCandidateId = candidate.error
    ? null : text(record(candidate.data).id, 80)
  const idempotencyKey = [runId, LUNA_PRODUCT_PAGE_STOCK_OBSERVATION_VERSION,
    observation.candidateId.slice("sha256:".length),
    eventPayload.decisionDigest.slice("sha256:".length)].join(":")
  const write = await input.supabase.from("ebay_same_day_pilot_events").upsert({
    run_id: runId, candidate_id: durableCandidateId,
    event_type: LUNA_PRODUCT_PAGE_STOCK_OBSERVATION_VERSION,
    event_payload: eventPayload, idempotency_key: idempotencyKey,
    ebay_read_calls: 0, openai_calls: 0, ebay_writes: 0,
    production_changed: false,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  if (write.error) {
    throw new Error("LUNA_PRODUCT_PAGE_OOS_DURABLE_WRITE_FAILED")
  }
  const readback = await input.supabase.from("ebay_same_day_pilot_events")
    .select("event_payload").eq("idempotency_key", idempotencyKey).maybeSingle()
  const stored = record(record(readback.data).event_payload)
  if (readback.error || stored.decisionDigest !== eventPayload.decisionDigest ||
      stored.candidateId !== observation.candidateId ||
      stored.lunaProductId !== observation.lunaProductId ||
      stored.lunaVariantId !== observation.lunaVariantId ||
      stored.supplierSku !== observation.supplierSku ||
      stored.productPageStockStatus !== "FRESH_OUT_OF_STOCK" ||
      stored.productOosConfirmed !== true) {
    throw new Error("LUNA_PRODUCT_PAGE_OOS_DURABLE_READBACK_FAILED")
  }
  const shippingClaimCompleted = await completeLunaChromeShippingJobClaimV1({
    supabase: input.supabase, accountKey: input.accountKey,
    candidateId: observation.candidateId, snapshotDigest,
    captureSessionId: observation.captureSessionId,
  })
  return Object.freeze({
    productPageStockStatus: "FRESH_OUT_OF_STOCK" as const,
    productOosConfirmed: true as const,
    candidateDecision: "REJECT_STOCK" as const,
    stockEvidenceReconciled: true as const,
    durableWriteVerified: true as const,
    durableReadbackMatch: true as const,
    shippingClaimCompleted,
    stockAuthority: "ebay_same_day_pilot_events" as const,
    lunaPurchases: 0 as const,
    marketplaceWrites: 0 as const,
  })
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
  const marketTest = record(previous.quickPickMarketTestV1)
  const marketTestEligible = marketTest.contractVersion ===
      "LUNA_QUICK_PICK_MARKET_TEST_PATH_V1" &&
    marketTest.marketTestPathEligible === true &&
    marketTest.demandNegativeEvidencePresent === false
  const floor = marketTestEligible ? calculateEbayMinimumOperatorPrice({
    supplierCost: previous.lunaUnitCost,
  }, { estimatedOutboundShipping: quote.shippingAmountUsd }) : null
  const marketTestEconomics = floor?.ready && floor.minimumOperatorPrice !== null
    ? calculateEbayUnitEconomics({ salePrice: floor.minimumOperatorPrice,
      supplierCost: previous.lunaUnitCost }, {
      estimatedOutboundShipping: quote.shippingAmountUsd,
    }) : null
  const marketTestReady = Boolean(marketTestEconomics?.ready &&
    marketTestEconomics.passesProfitGate)
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
    economicClassification: marketTestReady || economics.passesEconomics
      ? "ECONOMICALLY_PROMISING" : "ECONOMICALLY_RECOVERABLE",
    shippingEvidenceRequired: false,
    nextBestEvidence: marketTestReady || economics.passesEconomics ? "NONE" :
      previous.nextBestEvidence === "ACTUAL_LUNA_SHIPPING"
        ? "BETTER_PRICE_DISTRIBUTION" : previous.nextBestEvidence,
    nextEvidenceValue: marketTestReady || economics.passesEconomics ? "NEAR_ZERO" :
      previous.nextEvidenceValue,
    ...(marketTestEligible ? { quickPickMarketTestV1: {
      ...marketTest,
      minimumMarginSafePrice: floor?.minimumOperatorPrice ?? null,
      testPrice: floor?.minimumOperatorPrice ?? null,
      testPriceBasis: "MINIMUM_MARGIN_SAFE_PRICE",
      supplierCost: marketTestEconomics?.supplierCost ?? null,
      shipping: quote.shippingAmountUsd,
      ebayFees: marketTestEconomics?.estimatedEbayFees ?? null,
      testPriceProfit: marketTestEconomics?.estimatedNetProfit ?? null,
      testPriceMargin: marketTestEconomics?.estimatedNetMarginPercent ?? null,
      testPriceRoi: marketTestEconomics?.estimatedRoiPercent ?? null,
      economicsMarginFloorPass: marketTestEconomics?.passesProfitGate === true,
      economicsReady: marketTestReady,
      marketTestReady: false,
      marketPriceSupport: "UNPROVEN",
      priceCompetitiveness: "UNPROVEN",
      feeEvidenceClass: "CONSERVATIVE_PRE_SALE_MODEL",
      calculationSource: floor?.calculationSource ?? null,
    } } : {}),
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
      ...(input.capture.canonicalDestinationAuthority ? {
        canonicalDestinationAuthority:
          input.capture.canonicalDestinationAuthority,
        canonicalDestinationCountryClass: "US",
        canonicalDestinationFingerprint:
          input.capture.canonicalDestinationFingerprint,
        canonicalDestinationMatch: input.capture.canonicalDestinationMatch,
        selectedShippingStateProof:
          input.capture.selectedShippingStateProof,
      } : {}),
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
  const source = exactFrontierSourceForCandidate(
    records(record(latestResult.data).frontiers), input.capture.candidateId,
    authority.identity)
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
  const writeOutcome = record(write.data).outcome
  if (writeOutcome !== "CREATED" && writeOutcome !== "IDEMPOTENT_SUCCESS") {
    throw new Error("LUNA_SHIPPING_CAPTURE_DURABLE_WRITE_FAILED")
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
    const canonicalProfileReadbackMatches =
      input.capture.acquisitionMethod !== LUNA_HTTP_SHIPPING_SOURCE ||
      (evidence.canonicalDestinationAuthority ===
          input.capture.canonicalDestinationAuthority &&
        evidence.canonicalDestinationCountryClass === "US" &&
        evidence.canonicalDestinationFingerprint ===
          input.capture.canonicalDestinationFingerprint &&
        evidence.canonicalDestinationMatch === true &&
        evidence.selectedShippingStateProof ===
          input.capture.selectedShippingStateProof)
    return stored.frontierDigest === frontier.frontierDigest &&
      stored.shippingStatus === "SHIPPING_DURABLY_PERSISTED" &&
      evidence.evidenceDigest === certified.quote.evidenceDigest &&
      evidence.candidateId === input.capture.candidateId &&
      canonicalProfileReadbackMatches
  })
  if (!matched) throw new Error("LUNA_SHIPPING_CAPTURE_DURABLE_READBACK_FAILED")
  const shippingClaimCompleted = await completeLunaChromeShippingJobClaimV1({
    supabase: input.supabase, accountKey: input.accountKey,
    candidateId: input.capture.candidateId, snapshotDigest,
    captureSessionId: input.capture.captureSessionId,
  })
  return Object.freeze({
    capturePostAccepted: true as const,
    captureResultDurable: true as const,
    durableReadbackMatch: true as const,
    shippingClaimCompleted,
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
