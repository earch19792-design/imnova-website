import type { SupabaseClient } from "@supabase/supabase-js"

import { readProductionStockGuardV1 } from "./ebay-production-stock-read-service-v1"
import { reconcileSellerOsStockIdentityV1 } from
  "./ebay-stock-identity-auto-reconciliation-v1"

// Identity is already durable when this runs. A source failure must leave the
// link intact and return an honest UNKNOWN/STALE stock state to the OWNER.
export async function refreshStockAfterExactLinkV1(input: {
  supabase: SupabaseClient; accountKey: string; accountAlias: string;
  itemId: string;
}) {
  let captureBlocker: string | null = null
  try {
    const result = await reconcileSellerOsStockIdentityV1(input.supabase, {
      accountKey: input.accountKey, targetItemIds: [input.itemId],
      allowApprovedDecisionFallback: true,
    })
    const outcome = (result.outcomes as readonly Record<string, unknown>[])
      .find((row) => row.itemId === input.itemId)
    if (!outcome || outcome.status !== "AUTO_RESOLVED" &&
        outcome.status !== "ALREADY_CURRENT") {
      captureBlocker = String(outcome?.reasonCodes &&
        Array.isArray(outcome.reasonCodes) ? outcome.reasonCodes[0] :
        outcome?.status ?? "STOCK_CAPTURE_NO_OUTCOME")
    } else if (Array.isArray(outcome.reasonCodes) && outcome.reasonCodes.length) {
      captureBlocker = String(outcome.reasonCodes[0])
    }
  } catch (error) {
    captureBlocker = error instanceof Error &&
      /^STOCK_[A-Z0-9_]+$/.test(error.message)
      ? error.message : "STOCK_CAPTURE_FAILED"
  }
  try {
    const readback = await readProductionStockGuardV1({
      supabase: input.supabase, accountKey: input.accountKey,
      accountAlias: input.accountAlias, itemId: input.itemId,
      includeKnownListingStockEvidence: true,
    })
    const row = readback.listings.find((entry) => entry.itemId === input.itemId)
    return { stockFreshness: row?.stockFreshness ?? "UNKNOWN",
      stockObservedAt: row?.stockObservedAt ?? null,
      stockFreshUntil: row?.stockFreshUntil ?? null,
      stockBlocker: captureBlocker ?? row?.limitationCode ?? null,
      stockMonitoringActive: row?.supplierLinkage === "CERTIFIED" }
  } catch {
    return { stockFreshness: "UNKNOWN" as const, stockObservedAt: null,
      stockFreshUntil: null,
      stockBlocker: captureBlocker ?? "STOCK_CANONICAL_READBACK_FAILED",
      stockMonitoringActive: true }
  }
}
