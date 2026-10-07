import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import { SELLER_OS_ACCESS_ROLES } from "../seller-os-access-control"
import { requestLunaPreResearchV1 } from
  "../ebay/luna-pre-research-intake-v1"
import {
  LUNA_PRE_RESEARCH_RESULT_CONTRACT_V2,
  requestControlledLunaPreResearchRerunV1,
} from "../ebay/luna-pre-research-rerun-cohort-v1"
import { SELLER_OS_WORKER_RESILIENCE_VERSION_V2 } from
  "./worker-self-healing-v2"

export const SELLER_OS_WORKER_FUNCTIONAL_CANARY_V2 =
  "SELLER_OS_WORKER_FUNCTIONAL_CANARY_V2" as const
export const SELLER_OS_WORKER_FUNCTIONAL_CANARY_INTERVAL_MS_V2 =
  6 * 60 * 60 * 1_000

const ITEM6127 = Object.freeze({
  productId: "9220801986784",
  variantId: "48809603137760",
  sku: "ITEM6127",
})

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function recent(value: unknown, now: number) {
  if (typeof value !== "string") return false
  const observedAt = Date.parse(value)
  return Number.isFinite(observedAt) &&
    observedAt >= now - SELLER_OS_WORKER_FUNCTIONAL_CANARY_INTERVAL_MS_V2
}

/**
 * Ensures one bounded, read-only marketplace canary at a time. The canary uses
 * Product Truth plus the existing Luna controlled-rerun contract and therefore
 * enters the same plan/task tables and browser claim path as ordinary work.
 */
export async function ensureSellerOsWorkerFunctionalCanaryV2(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  ownerUserId: string
  ownerAccessRole: string
  now?: number
}>) {
  const now = input.now ?? Date.now()
  if (input.ownerAccessRole !== SELLER_OS_ACCESS_ROLES.owner ||
      !/^[0-9a-f-]{36}$/i.test(input.ownerUserId)) {
    throw new Error("PRODUCT_RESEARCH_FUNCTIONAL_CANARY_OWNER_REQUIRED")
  }

  const latestReceipt = await input.supabase
    .from("seller_os_operational_learning_ledger_v1")
    .select("status,incident_state,evidence,last_observed_at,recovery_succeeded_at")
    .eq("marketplace_account_key", input.accountKey)
    .eq("invariant_code", "PRODUCT_RESEARCH_FUNCTIONAL_CANARY")
    .eq("mechanism_version", SELLER_OS_WORKER_RESILIENCE_VERSION_V2)
    .order("last_observed_at", { ascending: false }).limit(1)
  if (latestReceipt.error) {
    throw new Error("PRODUCT_RESEARCH_FUNCTIONAL_CANARY_LEDGER_READ_FAILED")
  }
  const receipt = rows(latestReceipt.data)[0]
  const receiptEvidence = record(receipt?.evidence)
  if (receiptEvidence.stage === "COMPLETED" &&
      recent(receipt.recovery_succeeded_at ?? receipt.last_observed_at, now)) {
    return Object.freeze({ status: "RECENTLY_PROVEN" as const,
      planId: String(receiptEvidence.planId ?? "") || null,
      candidateSku: ITEM6127.sku, marketplaceWrites: 0 })
  }

  const active = await input.supabase
    .from("marketplace_product_research_query_plans")
    .select("id,created_at")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("source_context", "LUNA_PRE_RESEARCH")
    .eq("source_luna_product_id", ITEM6127.productId)
    .eq("source_supplier_sku", ITEM6127.sku)
    .eq("status", "ACTIVE")
    .not("pre_research_rerun_cohort_id", "is", null)
    .order("created_at", { ascending: false }).limit(1)
  if (active.error) {
    throw new Error("PRODUCT_RESEARCH_FUNCTIONAL_CANARY_ACTIVE_READ_FAILED")
  }
  const activePlan = rows(active.data)[0]
  if (activePlan?.id) return Object.freeze({ status: "IN_FLIGHT" as const,
    planId: String(activePlan.id), candidateSku: ITEM6127.sku,
    marketplaceWrites: 0 })

  const snapshot = await input.supabase
    .from("luna_catalog_snapshot_variants_v1")
    .select("snapshot_id,product_id,variant_id,sku,observed_at,preflight_status")
    .eq("product_id", ITEM6127.productId)
    .eq("variant_id", ITEM6127.variantId)
    .eq("sku", ITEM6127.sku)
    .eq("preflight_status", "PREFLIGHT_PASS")
    .order("observed_at", { ascending: false }).limit(1)
  if (snapshot.error) {
    throw new Error("PRODUCT_RESEARCH_FUNCTIONAL_CANARY_TRUTH_READ_FAILED")
  }
  const truth = rows(snapshot.data)[0]
  const snapshotId = String(truth?.snapshot_id ?? "")
  if (!/^[0-9a-f-]{36}$/i.test(snapshotId)) {
    throw new Error("PRODUCT_RESEARCH_FUNCTIONAL_CANARY_TRUTH_UNAVAILABLE")
  }

  // This idempotent intake guarantees that the controlled rerun is based on
  // the current Product Truth fingerprint instead of replaying stale keywords.
  await requestLunaPreResearchV1({ supabase: input.supabase,
    accountKey: input.accountKey, snapshotId, candidates: [ITEM6127] })
  const rerun = await requestControlledLunaPreResearchRerunV1({
    supabase: input.supabase, accountKey: input.accountKey,
    adminValidation: { ok: true, userId: input.ownerUserId,
      authenticationMode: "admin_user", accessRole: input.ownerAccessRole },
    rerunCohortId: randomUUID(), snapshotId,
    reasonCode: "WORKER_V2_FUNCTIONAL_CANARY",
    expectedContractVersion: LUNA_PRE_RESEARCH_RESULT_CONTRACT_V2,
    candidates: [ITEM6127],
  })
  const plan = rows(rerun.plans)[0]
  const planId = String(plan?.planId ?? plan?.plan_id ?? "")
  if (!/^[0-9a-f-]{36}$/i.test(planId) ||
      rerun.safety.marketplaceWrites !== 0) {
    throw new Error("PRODUCT_RESEARCH_FUNCTIONAL_CANARY_CREATE_READBACK_FAILED")
  }
  return Object.freeze({ status: "CREATED" as const, planId,
    rerunCohortId: rerun.rerunCohortId, candidateSku: ITEM6127.sku,
    sourceSnapshotId: snapshotId, marketplaceWrites: 0 })
}
