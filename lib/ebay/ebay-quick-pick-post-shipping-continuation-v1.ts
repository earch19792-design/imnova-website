import type { SupabaseClient } from "@supabase/supabase-js"

import { continueLunaQuickPickRequiredSpecificsV1 } from
  "./ebay-luna-quick-pick-required-specifics-v1"
import { continueLunaQuickPickMinimumReadinessV1 } from
  "./ebay-quick-pick-minimum-readiness-continuation-v1"
import type { RadarMarketplaceTaxonomyReaderV1,
  RadarProductIdentifierPolicyReaderV1 } from
  "./ebay-radar-canonical-marketplace-readiness-v1"

export const QUICK_PICK_POST_SHIPPING_CONTINUATION_V1 =
  "QUICK_PICK_POST_SHIPPING_CONTINUATION_V1" as const

const MAXIMUM_QUICK_PICKS = 20
type JsonRecord = Record<string, unknown>

type RequiredSpecificsContinuation =
  typeof continueLunaQuickPickRequiredSpecificsV1
type MinimumReadinessContinuation =
  typeof continueLunaQuickPickMinimumReadinessV1

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

async function readDurableBatchScopeV1(input: Readonly<{
  supabase: SupabaseClient
  candidateKeys: readonly string[]
}>) {
  const seedRead = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("candidate_key,assessment").in("candidate_key", input.candidateKeys)
    .limit(MAXIMUM_QUICK_PICKS)
  if (seedRead.error) {
    throw new Error("QUICK_PICK_POST_SHIPPING_SCOPE_READ_FAILED")
  }
  const batchIds = [...new Set(rows(seedRead.data).flatMap((row) => {
    const value = batchId(record(record(row.assessment)
      .lunaQuickPickOperationV1).batchId)
    return value ? [value] : []
  }))]
  if (!batchIds.length) return input.candidateKeys
  const receiptRead = await input.supabase.from("ebay_seller_automation_runs")
    .select("id,run_kind,lanes,metrics").in("id", batchIds)
    .eq("run_kind", "manual_acceleration").contains("lanes", ["quick_pick"])
    .limit(MAXIMUM_QUICK_PICKS)
  if (receiptRead.error) {
    throw new Error("QUICK_PICK_POST_SHIPPING_RECEIPT_READ_FAILED")
  }
  return [...new Set([
    ...input.candidateKeys,
    ...rows(receiptRead.data).flatMap((row) => {
      const keys = record(row.metrics).candidateKeys
      return Array.isArray(keys) ? keys.flatMap((value) => {
        const key = candidateKey(value)
        return key ? [key] : []
      }) : []
    }),
  ])].slice(0, MAXIMUM_QUICK_PICKS)
}

/**
 * The single mutating continuation boundary after Shipping/Economics. It
 * expands one worker result to its durable Quick Pick receipt so the existing
 * Required Specifics resolver retains one bounded batch, then projects Minimum
 * Truthful Readiness from the rematerialized package. GET/read-model routes do
 * not call this function.
 */
export async function continueLunaQuickPickPostShippingRuntimeV1(
  input: Readonly<{
    supabase: SupabaseClient
    accountKey: string
    candidateKeys: readonly string[]
    scopeMode?: "DURABLE_BATCH" | "EXACT_REQUEST"
    trigger?: "IMMEDIATE" | "OVERNIGHT_ENRICHMENT" | "DEPENDENCY_RECOVERY"
    taxonomyReader: RadarMarketplaceTaxonomyReaderV1
    productIdentifierPolicyReader?: RadarProductIdentifierPolicyReaderV1
    dependencies?: Readonly<{
      readBatchScope?: typeof readDurableBatchScopeV1
      continueRequiredSpecifics?: RequiredSpecificsContinuation
      continueMinimumReadiness?: MinimumReadinessContinuation
    }>
  }>,
) {
  const requestedKeys = [...new Set(input.candidateKeys.flatMap((value) => {
    const key = candidateKey(value)
    return key ? [key] : []
  }))].slice(0, MAXIMUM_QUICK_PICKS)
  if (!requestedKeys.length) return Object.freeze({
    contractVersion: QUICK_PICK_POST_SHIPPING_CONTINUATION_V1,
    requestedCandidateCount: 0,
    scopedCandidateCount: 0,
    requiredSpecificsContinuation: null,
    minimumReadinessContinuation: null,
    retryConsumerPresent: true as const,
    overnightDependency: false as const,
    marketplaceWrites: 0 as const,
  })
  const scope = input.scopeMode === "EXACT_REQUEST"
    ? requestedKeys
    : await (input.dependencies?.readBatchScope ??
      readDurableBatchScopeV1)({
      supabase: input.supabase, candidateKeys: requestedKeys,
    })
  const scopedCandidateKeys = [...new Set(scope.flatMap((value) => {
    const key = candidateKey(value)
    return key ? [key] : []
  }))].slice(0, MAXIMUM_QUICK_PICKS)
  const requiredSpecificsContinuation = await (
    input.dependencies?.continueRequiredSpecifics ??
      continueLunaQuickPickRequiredSpecificsV1)({
    supabase: input.supabase,
    accountKey: input.accountKey,
    candidateKeys: scopedCandidateKeys,
    taxonomyReader: input.taxonomyReader,
    productIdentifierPolicyReader: input.productIdentifierPolicyReader,
    trigger: input.trigger ?? "IMMEDIATE",
  })
  const minimumReadinessContinuation = await (
    input.dependencies?.continueMinimumReadiness ??
      continueLunaQuickPickMinimumReadinessV1)({
    supabase: input.supabase,
    accountKey: input.accountKey,
    candidateKeys: scopedCandidateKeys,
  })
  return Object.freeze({
    contractVersion: QUICK_PICK_POST_SHIPPING_CONTINUATION_V1,
    scopeMode: input.scopeMode ?? "DURABLE_BATCH",
    trigger: input.trigger ?? "IMMEDIATE",
    requestedCandidateCount: requestedKeys.length,
    scopedCandidateCount: scopedCandidateKeys.length,
    requiredSpecificsContinuation,
    minimumReadinessContinuation,
    retryConsumerPresent: true as const,
    overnightDependency: false as const,
    marketplaceWrites: 0 as const,
  })
}
