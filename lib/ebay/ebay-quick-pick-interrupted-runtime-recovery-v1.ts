import type { SupabaseClient } from "@supabase/supabase-js"

import { continueLunaQuickPickPostShippingRuntimeV1 } from
  "./ebay-quick-pick-post-shipping-continuation-v1"
import type { RadarMarketplaceTaxonomyReaderV1,
  RadarProductIdentifierPolicyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1"

export const QUICK_PICK_INTERRUPTED_RUNTIME_RECOVERY_V1 =
  "QUICK_PICK_INTERRUPTED_RUNTIME_RECOVERY_V1" as const

const MAXIMUM_RECOVERY_CLAIMS = 20
const MAXIMUM_SCAN_ROWS = 100
const STALE_CLAIM_MS = 5 * 60 * 1_000
type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function candidateKey(value: unknown) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
    ? value : null
}

function batchId(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value) ? value : null
}

export function projectInterruptedQuickPickClaimV1(input: Readonly<{
  row: unknown
  now: Date
}>) {
  const row = record(input.row)
  const assessment = record(row.assessment)
  const operation = record(assessment.lunaQuickPickOperationV1)
  const claim = record(assessment.quickPickRequiredSpecificsContinuationV1)
  const key = candidateKey(row.candidate_key)
  const claimedAt = Date.parse(String(claim.autonomousClaimedAt
    ?? claim.claimedAt ?? ""))
  const stale = Number.isFinite(claimedAt)
    && input.now.getTime() - claimedAt >= STALE_CLAIM_MS
  const eligible = operation.contractVersion ===
      "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1"
    && claim.contractVersion ===
      "QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1"
    && !claim.completedAt && Boolean(key) && stale
  return Object.freeze({ eligible, candidateKey: eligible ? key : null,
    batchId: batchId(operation.batchId), claimedAt: Number.isFinite(claimedAt)
      ? new Date(claimedAt).toISOString() : null,
    reasonCode: eligible ? "INTERRUPTED_DURABLE_CLAIM_RECLAIMABLE"
      : claim.completedAt ? "CLAIM_ALREADY_COMPLETED"
        : !stale ? "CLAIM_NOT_STALE" : "CLAIM_CONTRACT_NOT_RECLAIMABLE" })
}

async function readRecoveryRowsV1(supabase: SupabaseClient) {
  const read = await supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,assessment,updated_at")
    .contains("assessment", { lunaQuickPickOperationV1: {
      contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
    } })
    .order("updated_at", { ascending: true }).limit(MAXIMUM_SCAN_ROWS)
  if (read.error) throw new Error("QUICK_PICK_RECOVERY_SCOPE_READ_FAILED")
  return rows(read.data)
}

type RuntimeContinuation = typeof continueLunaQuickPickPostShippingRuntimeV1

export async function recoverInterruptedLunaQuickPickRuntimeV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  taxonomyReader: RadarMarketplaceTaxonomyReaderV1
  productIdentifierPolicyReader?: RadarProductIdentifierPolicyReaderV1
  dependencies?: Readonly<{
    now?: () => Date
    readRows?: typeof readRecoveryRowsV1
    continueRuntime?: RuntimeContinuation
  }>
}>) {
  const now = input.dependencies?.now?.() ?? new Date()
  const durableRows = await (input.dependencies?.readRows ??
    readRecoveryRowsV1)(input.supabase)
  const reclaimable = durableRows.map((row) => ({ row,
    claim: projectInterruptedQuickPickClaimV1({ row, now }) }))
    .filter((entry) => entry.claim.eligible)
    .sort((left, right) => String(left.claim.claimedAt)
      .localeCompare(String(right.claim.claimedAt)))
    .slice(0, MAXIMUM_RECOVERY_CLAIMS)
  const grouped = new Map<string, string[]>()
  for (const entry of reclaimable) {
    const group = entry.claim.batchId ?? "UNBATCHED_DURABLE_QUICK_PICK"
    const keys = grouped.get(group) ?? []
    if (entry.claim.candidateKey) keys.push(entry.claim.candidateKey)
    grouped.set(group, keys)
  }
  const outcomes: JsonRecord[] = []
  for (const [durableScope, candidateKeys] of grouped) {
    try {
      const result = await (input.dependencies?.continueRuntime ??
        continueLunaQuickPickPostShippingRuntimeV1)({
        supabase: input.supabase, accountKey: input.accountKey,
        candidateKeys, scopeMode: "EXACT_REQUEST",
        trigger: "DEPENDENCY_RECOVERY",
        taxonomyReader: input.taxonomyReader,
        productIdentifierPolicyReader: input.productIdentifierPolicyReader,
      })
      const specifics = record(result.requiredSpecificsContinuation)
      outcomes.push(Object.freeze({ durableScope,
        candidateCount: candidateKeys.length,
        claimed: Number(specifics.claimed ?? 0),
        productsEvaluated: Number(specifics.productsEvaluated ?? 0),
        aiCallCount: Number(specifics.aiCallCount ?? 0),
        marketplaceWrites: 0 }))
    } catch (error) {
      const code = error instanceof Error ? error.message : ""
      outcomes.push(Object.freeze({ durableScope,
        candidateCount: candidateKeys.length, claimed: 0,
        productsEvaluated: 0, aiCallCount: 0,
        errorCode: /^[A-Z][A-Z0-9_]{2,119}$/.test(code)
          ? code : "QUICK_PICK_RECOVERY_RUNTIME_FAILED",
        marketplaceWrites: 0 }))
    }
  }
  const failureCount = outcomes.filter((outcome) => outcome.errorCode).length
  return Object.freeze({
    contractVersion: QUICK_PICK_INTERRUPTED_RUNTIME_RECOVERY_V1,
    status: failureCount ? "PARTIAL" as const : "PASS" as const,
    observedAt: now.toISOString(),
    scannedDurableOperationCount: durableRows.length,
    reclaimableClaimCount: reclaimable.length,
    durableScopeCount: grouped.size,
    durableReceiptsDiscovered: reclaimable.length,
    outcomes: Object.freeze(outcomes),
    claimedCount: outcomes.reduce((sum, outcome) =>
      sum + Number(outcome.claimed ?? 0), 0),
    productsEvaluated: outcomes.reduce((sum, outcome) =>
      sum + Number(outcome.productsEvaluated ?? 0), 0),
    aiCallCount: outcomes.reduce((sum, outcome) =>
      sum + Number(outcome.aiCallCount ?? 0), 0),
    failedScopeCount: failureCount,
    normalRuntimePath: true as const,
    ownerSecondClickRequired: false as const,
    manualFactInjection: 0 as const,
    codexProductDecisions: 0 as const,
    marketplaceWrites: 0 as const,
  })
}
