import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildProductResearchQueryPlan,
  PRODUCT_RESEARCH_QUERY_PLAN_VERSION,
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
} from "./ebay-product-research-query-plan.ts"

export const QUICK_PICK_PRODUCT_RESEARCH_HANDOFF_V1 =
  "QUICK_PICK_PRODUCT_RESEARCH_HANDOFF_V1" as const

const MAXIMUM_SCAN_ROWS = 100
const MAXIMUM_RECONCILIATIONS = 20
const RUNTIME_CAPABILITY_ASSURANCE_AUTHORITY =
  "SELLER_OS_RUNTIME_CAPABILITY_ASSURANCE_V1"
type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown, maximum = 160) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
    : ""
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(value),
  ).digest("hex")}`
}

function candidateKey(value: unknown) {
  const candidate = text(value, 80)
  return /^sha256:[0-9a-f]{64}$/.test(candidate) ? candidate : null
}

function numericIdentity(value: unknown) {
  const identity = text(value, 30)
  return /^\d{1,30}$/.test(identity) ? identity : null
}

function familyDemandStatus(assessment: JsonRecord) {
  const market = record(assessment.market)
  const radar = record(assessment.radarFactoryCandidateV1)
  const radarLineage = record(radar.lineage)
  const factoryLineage = record(
    record(assessment.sellerOsDeterministicFactory).lineage)
  const explicitResearch = record(assessment.productResearchRequiredV1)
  return text(market.familyDemandStatus, 80)
    || text(radar.familyDemandStatus, 80)
    || text(radarLineage.familyDemandStatus, 80)
    || text(factoryLineage.familyDemandStatus, 80)
    || (explicitResearch.required === true ? "FAMILY_DEMAND_UNPROVEN" : "")
}

export function projectQuickPickProductResearchEligibilityV1(value: unknown) {
  const row = record(value)
  const assessment = record(row.assessment)
  const operation = record(assessment.lunaQuickPickOperationV1)
  const candidateId = candidateKey(row.candidate_key)
  const lunaProductId = numericIdentity(row.supplier_product_id)
  const lunaVariantId = numericIdentity(row.supplier_variant_id)
  const supplierSku = text(row.supplier_sku, 160)
  const productTitle = text(row.product_title, 350)
  const status = familyDemandStatus(assessment)
  const exactIdentityProven = Boolean(candidateId && lunaProductId &&
    lunaVariantId && supplierSku && productTitle)
  const processed = operation.contractVersion ===
    "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1"
  const researchRequired = [
    "FAMILY_DEMAND_UNPROVEN",
    "FAMILY_DEMAND_UNAVAILABLE",
    "DEMAND_NOT_PROVEN",
  ].includes(status)
  const eligible = processed && exactIdentityProven && researchRequired
  return Object.freeze({
    eligible,
    candidateId,
    opportunityId: text(row.id, 40) || null,
    lunaProductId,
    lunaVariantId,
    supplierSku: supplierSku || null,
    productTitle: productTitle || null,
    familyDemandStatus: status || null,
    reasonCode: eligible
      ? "MARKET_RESEARCH_REQUIRED"
      : !processed
        ? "QUICK_PICK_NOT_PROCESSED"
        : !exactIdentityProven
          ? "QUICK_PICK_EXACT_IDENTITY_UNPROVEN"
          : "MARKET_RESEARCH_NOT_REQUIRED",
  })
}

async function readEligibleRows(input: Readonly<{
  supabase: SupabaseClient
  candidateKeys?: readonly string[]
}>) {
  let query = input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,product_title,opportunity_score,assessment,updated_at")
    .contains("assessment", { lunaQuickPickOperationV1: {
      contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
    } })
    .order("updated_at", { ascending: true })
    .limit(MAXIMUM_SCAN_ROWS)
  const keys = [...new Set((input.candidateKeys ?? []).flatMap((value) =>
    candidateKey(value) ? [candidateKey(value) as string] : []))]
  if (keys.length) query = query.in("candidate_key", keys)
  const read = await query
  if (read.error) {
    throw new Error("QUICK_PICK_PRODUCT_RESEARCH_HANDOFF_SCOPE_READ_FAILED")
  }
  return rows(read.data)
}

function capabilityStateFromReceipt(receipt: unknown) {
  const matrix = rows(record(receipt).capabilityMatrix)
  const extension = matrix.find((entry) =>
    entry.capabilityId === "PRODUCT_RESEARCH_EXTENSION")
  const worker = matrix.find((entry) =>
    entry.capabilityId === "PRODUCT_RESEARCH_BROWSER_WORKER")
  const fresh = extension?.finalHealthState === "HEALTHY" &&
    worker?.finalHealthState === "HEALTHY"
  return Object.freeze({ fresh, extensionState:
    text(extension?.finalHealthState, 80) || "UNKNOWN",
  workerState: text(worker?.finalHealthState, 80) || "UNKNOWN" })
}

async function readProductResearchWorkerCapability(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
}>) {
  const read = await input.supabase
    .from("seller_os_operational_integrity_runs_v1")
    .select("id,audit_receipt,observed_at")
    .eq("marketplace_account_key", input.accountKey)
    .eq("mechanism_version", RUNTIME_CAPABILITY_ASSURANCE_AUTHORITY)
    .order("observed_at", { ascending: false }).limit(1).maybeSingle()
  if (read.error) {
    throw new Error("QUICK_PICK_PRODUCT_RESEARCH_CAPABILITY_READ_FAILED")
  }
  const projected = capabilityStateFromReceipt(read.data?.audit_receipt)
  return Object.freeze({ ...projected,
    receiptId: read.data?.id ?? null,
    observedAt: read.data?.observed_at ?? null })
}

type EligibleResearch = ReturnType<
  typeof projectQuickPickProductResearchEligibilityV1>

async function createOrReusePlan(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  row: JsonRecord
  eligibility: EligibleResearch
  workerCapabilityFresh: boolean
  observedAt: string
}>) {
  const candidate = input.eligibility
  if (!candidate.eligible || !candidate.candidateId ||
      !candidate.opportunityId || !candidate.lunaProductId ||
      !candidate.lunaVariantId || !candidate.supplierSku ||
      !candidate.productTitle) {
    throw new Error("QUICK_PICK_PRODUCT_RESEARCH_HANDOFF_IDENTITY_INVALID")
  }
  const plan = buildProductResearchQueryPlan([{
    supplierVariantId: candidate.lunaVariantId,
    productName: candidate.productTitle,
    priorityScore: Number(input.row.opportunity_score ?? 0),
  }])
  if (plan.queries.length !== 1 || plan.candidateCount !== 1) {
    throw new Error("QUICK_PICK_PRODUCT_RESEARCH_QUERY_PLAN_EMPTY")
  }
  const inputHash = sha256({
    contractVersion: QUICK_PICK_PRODUCT_RESEARCH_HANDOFF_V1,
    candidateId: candidate.candidateId,
    lunaProductId: candidate.lunaProductId,
    lunaVariantId: candidate.lunaVariantId,
    planInputHash: plan.inputHash,
  })
  const write = await input.supabase.rpc(
    "create_or_reuse_quick_pick_product_research_plan_v1", {
      p_plan_id: randomUUID(),
      p_marketplace_account_key: input.accountKey,
      p_plan_version: PRODUCT_RESEARCH_QUERY_PLAN_VERSION,
      p_input_hash: inputHash,
      p_opportunity_id: candidate.opportunityId,
      p_candidate_key: candidate.candidateId,
      p_luna_product_id: candidate.lunaProductId,
      p_luna_variant_id: candidate.lunaVariantId,
      p_supplier_sku: candidate.supplierSku,
      p_worker_capability_fresh: input.workerCapabilityFresh,
      p_observed_at: input.observedAt,
      p_queries: plan.queries.map((query) => ({
        ordinal: query.ordinal,
        search_query: query.searchQuery,
        query_hash: query.queryHash,
        cluster_key_hash: query.clusterKeyHash,
        category_id: query.categoryId,
        candidate_count: query.candidateCount,
        candidate_variant_hashes: query.candidateVariantHashes,
      })),
    })
  if (write.error || !write.data) {
    throw new Error("QUICK_PICK_PRODUCT_RESEARCH_PLAN_PERSIST_FAILED")
  }
  return record(write.data)
}

type CreatePlan = typeof createOrReusePlan
type ReadRows = typeof readEligibleRows
type ReadCapability = typeof readProductResearchWorkerCapability

export async function reconcileQuickPickProductResearchHandoffV1(
  input: Readonly<{
    supabase: SupabaseClient
    accountKey: string
    candidateKeys?: readonly string[]
    now?: Date
    dependencies?: Readonly<{
      readRows?: ReadRows
      readCapability?: ReadCapability
      createPlan?: CreatePlan
    }>
  }>,
) {
  const observedAt = (input.now ?? new Date()).toISOString()
  const [durableRows, capability] = await Promise.all([
    (input.dependencies?.readRows ?? readEligibleRows)({
      supabase: input.supabase, candidateKeys: input.candidateKeys,
    }),
    (input.dependencies?.readCapability ??
      readProductResearchWorkerCapability)({
      supabase: input.supabase, accountKey: input.accountKey,
    }),
  ])
  const eligible = durableRows.map((row) => ({ row,
    eligibility: projectQuickPickProductResearchEligibilityV1(row) }))
    .filter((entry) => entry.eligibility.eligible)
    .slice(0, MAXIMUM_RECONCILIATIONS)
  const outcomes: JsonRecord[] = []
  for (const entry of eligible) {
    try {
      const plan = await (input.dependencies?.createPlan ?? createOrReusePlan)({
        supabase: input.supabase,
        accountKey: input.accountKey,
        row: entry.row,
        eligibility: entry.eligibility,
        workerCapabilityFresh: capability.fresh,
        observedAt,
      })
      outcomes.push(Object.freeze({
        candidateId: entry.eligibility.candidateId,
        lunaProductId: entry.eligibility.lunaProductId,
        lunaVariantId: entry.eligibility.lunaVariantId,
        planId: plan.planId ?? null,
        planCreated: plan.planCreated === true,
        researchState: text(plan.researchState, 80) ||
          (capability.fresh ? "CLAIMABLE" : "WAITING_FOR_WORKER"),
        errorCode: null,
        marketplaceWrites: 0,
      }))
    } catch (error) {
      const code = error instanceof Error ? error.message : ""
      outcomes.push(Object.freeze({
        candidateId: entry.eligibility.candidateId,
        lunaProductId: entry.eligibility.lunaProductId,
        lunaVariantId: entry.eligibility.lunaVariantId,
        planId: null,
        planCreated: false,
        researchState: "HANDOFF_FAILED",
        errorCode: /^[A-Z][A-Z0-9_]{2,119}$/.test(code)
          ? code : "QUICK_PICK_PRODUCT_RESEARCH_HANDOFF_FAILED",
        marketplaceWrites: 0,
      }))
    }
  }
  const failedCount = outcomes.filter((outcome) => outcome.errorCode).length
  return Object.freeze({
    contractVersion: QUICK_PICK_PRODUCT_RESEARCH_HANDOFF_V1,
    status: failedCount ? "PARTIAL" as const : "PASS" as const,
    observedAt,
    scannedCandidateCount: durableRows.length,
    eligibleCandidateCount: eligible.length,
    reconciledPlanCount: outcomes.length - failedCount,
    createdPlanCount: outcomes.filter((outcome) =>
      outcome.planCreated === true).length,
    reusedPlanCount: outcomes.filter((outcome) =>
      outcome.planId && outcome.planCreated !== true).length,
    waitingForWorkerCount: outcomes.filter((outcome) =>
      outcome.researchState === "WAITING_FOR_WORKER").length,
    claimableCount: outcomes.filter((outcome) =>
      outcome.researchState === "CLAIMABLE").length,
    failedCount,
    workerCapability: capability.fresh ? "FRESH" as const
      : "EXPIRED_OR_UNPROVEN" as const,
    extensionState: capability.extensionState,
    workerState: capability.workerState,
    capabilityReceiptId: capability.receiptId,
    outcomes: Object.freeze(outcomes),
    normalContinuation: true as const,
    ownerActionRequired: false as const,
    manualTaskCreationCount: 0 as const,
    productSpecificPatchCount: 0 as const,
    marketplaceWrites: 0 as const,
  })
}
