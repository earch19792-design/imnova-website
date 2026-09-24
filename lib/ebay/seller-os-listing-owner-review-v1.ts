import type { SupabaseClient } from "@supabase/supabase-js"

import { packageIdFromCustomLabelV1 } from "./seller-os-listing-identity-review-v1"

type Case = { case_id: string; account_key: string; marketplace_id: string;
  ebay_item_id: string; ebay_custom_label: string | null; identity_status: string;
  listing_status: string; last_reconciled_sweep_id: string | null }
type Candidate = { productId: string; variantId: string; sku: string;
  opportunityId: string | null; source: string; preflightStatus: string | null }

function fail(code: string): never { throw new Error(code) }

export function canConfirmListingOwnerCandidateV1(input: {
  identityStatus: string; duplicateItemIds: readonly string[];
  candidates: readonly Candidate[];
  alreadyLinkedToOtherLiveItem: boolean;
  lastAction: Record<string, unknown> | null
}) {
  const candidate = input.candidates[0]
  return input.identityStatus === "MISSING_LUNA_IDENTITY" &&
    input.duplicateItemIds.length === 0 && input.candidates.length === 1 &&
    candidate.preflightStatus === "PREFLIGHT_PASS" &&
    !input.alreadyLinkedToOtherLiveItem &&
    !(input.lastAction?.action === "REJECT_CANDIDATE" &&
      input.lastAction.candidateProductId === candidate.productId &&
      input.lastAction.candidateVariantId === candidate.variantId)
}

/** Reads only the latest complete official cohort; no historical row can authorize a link. */
export async function readCurrentListingOwnerReviewTargetV1(input: {
  supabase: SupabaseClient; accountKey: string; itemId: string; now?: Date
}) {
  const { supabase, accountKey, itemId } = input
  const now = input.now ?? new Date()
  const sweepRead = await supabase.from("seller_os_listing_registry_sweeps_v1")
    .select("sweep_id,official_observed_at,official_live_item_count,reconciled_item_count")
    .eq("account_key", accountKey).eq("marketplace_id", "EBAY_US")
    .eq("status", "COMPLETE").order("completed_at", { ascending: false })
    .limit(1).maybeSingle()
  const sweep = sweepRead.data
  if (sweepRead.error || !sweep ||
    now.getTime() - Date.parse(sweep.official_observed_at) > 20 * 60_000 ||
    Date.parse(sweep.official_observed_at) - now.getTime() > 60_000) {
    fail("LISTING_REGISTRY_FRESH_OFFICIAL_SWEEP_REQUIRED")
  }
  const caseRead = await supabase.from("seller_os_listing_cases_v1")
    .select("case_id,account_key,marketplace_id,ebay_item_id,ebay_custom_label,identity_status,listing_status,last_reconciled_sweep_id,luna_product_id,luna_variant_id")
    .eq("account_key", accountKey).eq("marketplace_id", "EBAY_US")
    .eq("last_reconciled_sweep_id", sweep.sweep_id).limit(1000)
  const cases = (caseRead.data ?? []) as (Case & {
    luna_product_id: string | null; luna_variant_id: string | null })[]
  if (caseRead.error || cases.length >= 1000 ||
    cases.length !== sweep.official_live_item_count ||
    cases.length !== sweep.reconciled_item_count) {
    fail("LISTING_REGISTRY_COMPLETE_CURRENT_COHORT_REQUIRED")
  }
  const target = cases.find((row) => row.ebay_item_id === itemId)
  if (!target || target.listing_status !== "ACTIVE" ||
    target.identity_status === "LINKED_EXACT") {
    fail("LISTING_REGISTRY_UNRESOLVED_ACTIVE_CASE_REQUIRED")
  }
  const label = target.ebay_custom_label?.trim() || null
  const duplicateItemIds = label ? cases.filter((row) =>
    row.ebay_item_id !== itemId &&
    row.ebay_custom_label?.trim().toUpperCase() === label.toUpperCase())
    .map((row) => row.ebay_item_id) : []
  const packageId = packageIdFromCustomLabelV1(label)
  const [snapshotRead, packageRead, actionRead] = await Promise.all([
    supabase.from("luna_catalog_snapshots_v1").select("snapshot_id")
      .eq("snapshot_status", "COMPLETE")
      .order("snapshot_completed_at", { ascending: false }).limit(1).maybeSingle(),
    packageId ? supabase.from("ebay_listing_packages")
      .select("id,opportunity_id,candidate_key")
      .eq("account_key", accountKey).eq("id", packageId).maybeSingle() :
      Promise.resolve({ data: null, error: null }),
    supabase.from("seller_os_listing_case_events_v1")
      .select("event_id,current_state,recorded_at")
      .eq("case_id", target.case_id).eq("event_type", "OWNER_REVIEW_ACTION")
      .order("event_id", { ascending: false }).limit(1).maybeSingle(),
  ])
  if (snapshotRead.error || packageRead.error || actionRead.error ||
    !snapshotRead.data?.snapshot_id) fail("LISTING_REGISTRY_REVIEW_EVIDENCE_READ_FAILED")
  const snapshotId = snapshotRead.data.snapshot_id as string
  const candidateRows: Candidate[] = []
  if (label) {
    const direct = await supabase.from("luna_catalog_snapshot_variants_v1")
      .select("product_id,variant_id,sku,preflight_status")
      .eq("snapshot_id", snapshotId).eq("sku", label).limit(3)
    if (direct.error || (direct.data?.length ?? 0) >= 3) {
      fail("LISTING_REGISTRY_REVIEW_EVIDENCE_READ_FAILED")
    }
    for (const row of direct.data ?? []) {
      if (row.sku.toUpperCase() !== label.toUpperCase()) continue
      candidateRows.push({ productId: row.product_id, variantId: row.variant_id,
        sku: row.sku, opportunityId: null,
        source: "CURRENT_LUNA_CATALOG_EXACT_SKU",
        preflightStatus: row.preflight_status })
    }
  }
  if (packageRead.data) {
    const opportunityRead = await supabase.from("ebay_luna_opportunity_queue")
      .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku")
      .eq("id", packageRead.data.opportunity_id).maybeSingle()
    const opportunity = opportunityRead.data
    if (opportunityRead.error) fail("LISTING_REGISTRY_REVIEW_EVIDENCE_READ_FAILED")
    if (opportunity && opportunity.candidate_key === packageRead.data.candidate_key &&
      opportunity.supplier_product_id && opportunity.supplier_variant_id &&
      opportunity.supplier_sku) {
      const variantRead = await supabase.from("luna_catalog_snapshot_variants_v1")
        .select("product_id,variant_id,sku,preflight_status")
        .eq("snapshot_id", snapshotId)
        .eq("product_id", opportunity.supplier_product_id)
        .eq("variant_id", opportunity.supplier_variant_id)
        .eq("sku", opportunity.supplier_sku).limit(2)
      if (variantRead.error || (variantRead.data?.length ?? 0) > 1) {
        fail("LISTING_REGISTRY_REVIEW_EVIDENCE_READ_FAILED")
      }
      candidateRows.push({ productId: opportunity.supplier_product_id,
        variantId: opportunity.supplier_variant_id, sku: opportunity.supplier_sku,
        opportunityId: opportunity.id, source: "EXACT_PACKAGE_LABEL_LINEAGE",
        preflightStatus: variantRead.data?.[0]?.preflight_status ?? null })
    }
  }
  const candidates = [...new Map(candidateRows.map((row) =>
    [`${row.productId}:${row.variantId}:${row.sku}`, row])).values()]
  const lastAction = actionRead.data?.current_state as Record<string, unknown> | null ?? null
  return { target, cases, sweepId: sweep.sweep_id as string, snapshotId,
    candidates, duplicateItemIds, lastAction,
    canConfirm: canConfirmListingOwnerCandidateV1({
      identityStatus: target.identity_status, duplicateItemIds, candidates,
      alreadyLinkedToOtherLiveItem: candidates.length === 1 && cases.some((row) =>
        row.ebay_item_id !== itemId &&
        row.identity_status === "LINKED_EXACT" &&
        row.luna_product_id === candidates[0].productId &&
        row.luna_variant_id === candidates[0].variantId), lastAction,
    }),
  }
}
