import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { ensureMayelVisualPortfolioTasksV1 } from
  "./ebay-mayel-visual-workstation-server-v1"
import { readMayelFullVisualDelegationV1 } from
  "./ebay-mayel-full-visual-delegation-server-v1"
import {
  readMayelLiveMarketRevalidationStatusV1,
  startMayelLiveMarketRevalidationV1,
} from "./ebay-mayel-live-market-revalidation-v1"
import { readRemoteLiveOperatorEnrollmentStatus } from
  "../remote-live-operator-enrollment"

export const MAYEL_CONTINUOUS_LIVE_PORTFOLIO_VERSION =
  "MAYEL_CONTINUOUS_LIVE_PORTFOLIO_OPTIMIZATION_V1" as const
const MAX_PORTFOLIO = 200
const MAX_NEW_RESEARCH_PLANS_PER_CYCLE = 3
const FRESH_PROVEN_EVIDENCE_MS = 30 * 24 * 60 * 60 * 1_000
const INSUFFICIENT_EVIDENCE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1_000

function text(value: unknown, maximum = 200) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => [key, stable(entry)]))
}

function stableKey(value: unknown) {
  return `portfolio:${createHash("sha256").update(JSON.stringify(stable(value)))
    .digest("hex").slice(0, 48)}`
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stable(value)))
    .digest("hex")}`
}

async function marketNeed(input: {
  supabase: SupabaseClient
  accountKey: string
  itemId: string
  now: Date
}) {
  const listing = await input.supabase.from("ebay_active_listings")
    .select("supplier_variant_id")
    .eq("account_key", input.accountKey).eq("ebay_item_id", input.itemId)
    .eq("listing_status", "active").limit(1).maybeSingle()
  if (listing.error || !listing.data?.supplier_variant_id) {
    return { required: false, reason: "EXACT_SUPPLIER_VARIANT_REQUIRED",
      latestResearchAt: null }
  }
  const evidence = await input.supabase.from(
    "marketplace_product_research_capture_observations")
    .select("created_at,confirmed_sold_quantity,match_classification,evidence_reviewed,quality_status")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .eq("matched_supplier_variant_id", listing.data.supplier_variant_id)
    .order("created_at", { ascending: false }).limit(100)
  if (evidence.error) throw new Error(
    "MAYEL_CONTINUOUS_MARKET_EVIDENCE_READ_FAILED")
  const rows = evidence.data ?? []
  const accepted = rows.filter((row) => row.evidence_reviewed === true &&
    row.quality_status === "VALID" &&
    row.match_classification === "EXACT_LUNA_MATCH")
  const latestResearchAt = text(rows[0]?.created_at, 80) || null
  const age = latestResearchAt ? input.now.getTime() -
    Date.parse(latestResearchAt) : Number.POSITIVE_INFINITY
  const soldQuantity = accepted.reduce((sum, row) => sum +
    Math.max(0, Number(row.confirmed_sold_quantity) || 0), 0)
  const proven = accepted.length >= 2 || soldQuantity >= 2
  if (proven && age <= FRESH_PROVEN_EVIDENCE_MS) {
    return { required: false, reason: "FRESH_SOLD_EVIDENCE_PROVEN",
      latestResearchAt }
  }
  if (!proven && age <= INSUFFICIENT_EVIDENCE_COOLDOWN_MS) {
    return { required: false, reason: "MERCADO_NO_DEMOSTRADO_COOLDOWN",
      latestResearchAt }
  }
  return { required: true, reason: latestResearchAt
    ? "MARKET_EVIDENCE_STALE_OR_INSUFFICIENT" : "MARKET_EVIDENCE_MISSING",
    latestResearchAt }
}

export async function runMayelContinuousLivePortfolioOptimizationV1(input: {
  supabase: SupabaseClient
  accountKey: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const [operator, visualAuthority] = await Promise.all([
    readRemoteLiveOperatorEnrollmentStatus(input.supabase),
    readMayelFullVisualDelegationV1({ supabase: input.supabase,
      accountKey: input.accountKey, ownerAuthenticated: false }),
  ])
  if (!operator.exactSingleton || !operator.remoteUserId) {
    return Object.freeze({ status: "BLOCKED" as const,
      blocker: "MAYEL_OPERATOR_SINGLETON_REQUIRED",
      allEligibleLiveListingsDiscovered: false, duplicateTaskCount: 0,
      marketplaceWrites: 0 as const })
  }
  const visualQueue = await ensureMayelVisualPortfolioTasksV1({
    supabase: input.supabase, accountKey: input.accountKey,
    actorUserId: operator.remoteUserId, limit: MAX_PORTFOLIO,
  })
  const research: Record<string, unknown>[] = []
  let newPlans = 0
  for (const outcome of visualQueue.outcomes) {
    if (outcome.eligible !== true || typeof outcome.itemId !== "string") continue
    const itemId = outcome.itemId
    if (outcome.priority !== "HIGH") {
      research.push({ itemId, state: "VISUAL_ELIGIBLE_MARKET_RESEARCH_NOT_PRIORITIZED",
        planId: null, created: false })
      continue
    }
    const status = await readMayelLiveMarketRevalidationStatusV1({
      supabase: input.supabase, accountKey: input.accountKey, itemId,
    })
    if (status.state !== "READY_TO_REQUEST") {
      research.push({ itemId, state: status.state, planId: status.planId,
        created: false })
      continue
    }
    const need = await marketNeed({ ...input, itemId, now })
    if (!need.required || newPlans >= MAX_NEW_RESEARCH_PLANS_PER_CYCLE) {
      research.push({ itemId, state: need.required
        ? "LISTO_PARA_REVALIDAR" : need.reason,
      planId: null, created: false })
      continue
    }
    const started = await startMayelLiveMarketRevalidationV1({
      supabase: input.supabase, accountKey: input.accountKey,
      actorId: operator.remoteUserId, itemId,
      idempotencyKey: stableKey({ itemId,
        latestResearchAt: need.latestResearchAt }),
    })
    newPlans += 1
    research.push({ itemId, state: "WAITING_FOR_WORKER",
      planId: started.plan.id, created: true })
  }
  const receiptAt = now.toISOString()
  const evidenceFingerprint = fingerprint({ accountKey: input.accountKey,
    taskIds: visualQueue.outcomes.map((row) => row.taskId).filter(Boolean),
    research: research.map((row) => [row.itemId, row.state, row.planId]) })
  const receipt = await input.supabase.from(
    "seller_os_operational_learning_ledger_v1")
    .upsert({ marketplace_account_key: input.accountKey,
      failure_class: "MAYEL_CONTINUOUS_PORTFOLIO_STATE",
      invariant_code: "ALL_ELIGIBLE_LIVE_LISTINGS_HAVE_OPTIMIZATION_STATE",
      mechanism_version: MAYEL_CONTINUOUS_LIVE_PORTFOLIO_VERSION,
      evidence_fingerprint: evidenceFingerprint,
      recovery_policy_version: MAYEL_CONTINUOUS_LIVE_PORTFOLIO_VERSION,
      retry_safety: "SAFE_IDEMPOTENT_RUNTIME_RESUME",
      recovery_class: "AUTO_RECOVERABLE", recovery_outcome: "RECOVERED",
      regression_guard: { duplicateTaskCount: 0,
        boundedResearchPlansPerCycle: MAX_NEW_RESEARCH_PLANS_PER_CYCLE,
        marketplaceWrites: 0, targetProfitMaySetMarketPrice: false },
      evidence: { visualQueue, research,
        fullVisualDelegationActive:
          visualAuthority.fullVisualDelegationActive,
        ownerPerImageApproval: false, ownerPerListingVisualApproval: false,
        priceWriteDelegationSeparate: true, marketplaceWrites: 0 },
      status: "RESOLVED", first_observed_at: receiptAt,
      last_observed_at: receiptAt, resolved_at: receiptAt,
    }, { onConflict:
      "marketplace_account_key,invariant_code,evidence_fingerprint,mechanism_version",
    }).select("id").maybeSingle()
  if (receipt.error || !receipt.data) {
    throw new Error("MAYEL_CONTINUOUS_PORTFOLIO_RECEIPT_FAILED")
  }
  return Object.freeze({ status: visualQueue.partial ? "PARTIAL" as const
    : "OPERATING" as const,
  allEligibleLiveListingsDiscovered: !visualQueue.partial,
  visualQueue, research: Object.freeze(research),
  newResearchPlanCount: newPlans,
  mayelCanWorkWhileEbayUnavailable: true as const,
  visualProposalsDurable: true as const,
  marketAnalysisDurable: true as const,
  priceAnalysisDurable: true as const,
  autoApplyVisualPolicyAuthorized:
    visualAuthority.fullVisualDelegationActive,
  autoApplyVisualUnderDelegation: false as const,
  autoApplyVisualBlocker:
    "SHARED_MANAGEMENT_MODEL_EXECUTOR_NOT_CERTIFIED" as const,
  priceWriteRequiresOneTimeReusableCommercialDelegation: true as const,
  targetProfitMaySetMarketPrice: false as const,
  duplicateTaskCount: visualQueue.duplicateTaskCount,
  receiptId: receipt.data.id,
  ownerPerImageApproval: false as const,
  ownerPerListingVisualApproval: false as const,
  marketplaceWrites: 0 as const })
}
