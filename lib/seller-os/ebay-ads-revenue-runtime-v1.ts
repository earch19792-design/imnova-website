import { attachPortexShippingEvidenceV1 } from "./portex-shipping-authority-v1"
import { readAdsDecisionEvidenceV1 } from "./ads-decision-evidence-v1"
import { quotaHoldEconomicsReportV1, postQuotaResetResumeV1 } from "./ebay-economics-quota-hold-v1"
import type { SupabaseClient } from "@supabase/supabase-js"
import { readCurrentLiveAuthorityV1 } from "../ebay/ebay-current-live-authority-v1"
import { ADS_REVENUE_ACTIVATION_V1, buildAdsActivationListingV1, selectAdsCanaryV1, adsOfficialContractV1 } from "./ebay-ads-revenue-activation-v1"
import type { PromotionPolicy } from "./listing-treatment-engine-v1"
import { readAdsActivationOfficialV1 } from "../ebay/ebay-ads-activation-readonly-v1"

/** Normal Mayel path; no Trading reads during quota hold and no marketplace writes. Reads the
 * durable policy/economic heads even during quota hold. No new outbox/worker. */
export async function readAdsRevenueActivationV1(input: { supabase: SupabaseClient; accountKey: string; actorId: string;
  itemIds: string[]; policy?: PromotionPolicy; durableOnly?: boolean; now?: Date }) {
  if (!Array.isArray(input.itemIds) || input.itemIds.length < 1 || input.itemIds.length > 20 ||
    new Set(input.itemIds).size !== input.itemIds.length || input.itemIds.some(id => typeof id !== "string" || !/^\d{9,20}$/.test(id))) throw Error("ADS_BOUNDED_INPUT_REQUIRED")
  const now = input.now ?? new Date()
  const authority = await readCurrentLiveAuthorityV1({ ...input, now })
  const known = new Set([...authority.currentItemIds, ...authority.lastCertifiedItemIds])
  if (input.itemIds.some(id => !known.has(id))) throw Error("ADS_ACCOUNT_LISTING_BINDING_REQUIRED")
  const data = await input.supabase.rpc("seller_os_ads_activation_inputs_v1", {
    p_account_key: input.accountKey, p_item_ids: input.itemIds, p_actor_id: input.actorId,
  })
  if (data.error || !Array.isArray(data.data) || data.data.length !== input.itemIds.length) throw Error("ADS_DURABLE_INPUT_READ_FAILED")
  const economicRows = await attachPortexShippingEvidenceV1({ ...input, rawRows: data.data, now })
  const economicsAudit = quotaHoldEconomicsReportV1({accountKey:input.accountKey,rawRows:economicRows,now})
  const decisionEvidence = await readAdsDecisionEvidenceV1({ ...input, now, listings: economicRows.map(raw => ({
    itemId: String(raw.itemId), sku: Array.isArray(raw.listings) ? raw.listings[0]?.ebay_sku ?? null : null })) })
  const rows = economicRows.map(raw => buildAdsActivationListingV1({ accountKey: input.accountKey, raw,
    currentItemIds: authority.currentItemIds, currentLiveFresh: authority.currentState === "CURRENT_FRESH",
    policyOverride: input.policy, ...decisionEvidence.get(String(raw.itemId)), now }))
  let officialApiCalls = 0
  let officialReadBlocker: string | null = null
  // Resolve economics for all selected listings first. Only economically sound,
  // current candidates consume official reads, and only one is ever selected.
  const candidates = rows.map((row,index) => ({row,index})).filter(({row}) => row.exactItemBinding && row.inStock && row.supportedListingModel && row.economicsProven && row.ownerPolicyValid &&
    !row.promotionBlockedMargin && row.preview.PROPOSED_AD_RATE_PCT !== null && !row.blockers.includes("OWNER_POLICY_WINDOW_NOT_ACTIVE"))
    .sort((a,b) => a.row.economicUncertaintyCount - b.row.economicUncertaintyCount || a.row.itemId.localeCompare(b.row.itemId))
  const deadline = Date.now() + 40000
  let officialCandidatesExamined = 0
  for (const {index} of input.durableOnly ? [] : candidates) {
    if (officialCandidatesExamined >= 3 || Date.now() > deadline) { officialReadBlocker = "ADS_OFFICIAL_READ_BUDGET_REACHED"; break }
    const read = await readAdsActivationOfficialV1({ accountKey: input.accountKey, itemId: rows[index].itemId,
      currentLiveFresh: authority.currentState === "CURRENT_FRESH", now })
    officialCandidatesExamined++; officialApiCalls += read.officialApiCalls; officialReadBlocker = read.error
    rows[index] = buildAdsActivationListingV1({ accountKey: input.accountKey, raw: economicRows[index], currentItemIds: authority.currentItemIds,
      currentLiveFresh: authority.currentState === "CURRENT_FRESH", policyOverride: input.policy, official: read.observation, ...decisionEvidence.get(rows[index].itemId), now })
    if (rows[index].singleListingAdsCanaryReady || read.error) break
  }
  const candidate = selectAdsCanaryV1(rows)
  return { contractVersion: ADS_REVENUE_ACTIVATION_V1, observedAt: now.toISOString(),
    status: candidate ? "OWNER_APPROVAL_REQUIRED" : input.durableOnly ? "EBAY_QUOTA_HOLD" : "WAITING_FOR_DATA", economicsAudit, rows, proposedCanary: candidate?.preview ?? null,
    officialContract: adsOfficialContractV1(now), currentLiveState: authority.currentState,
    sourceFailureCode: authority.sourceFailureCode, nextAutomaticLiveRetryAt: authority.nextRetryAt,
    summary: { examined: rows.length, economicsProven: rows.filter(r => r.economicsProven).length,
      ready: rows.filter(r => r.singleListingAdsCanaryReady).length, selectedCanaryCount: candidate ? 1 : 0 },
    resume:postQuotaResetResumeV1({quotaHeld:input.durableOnly===true || authority.currentState!=="CURRENT_FRESH",currentEvidenceFresh:authority.currentState==="CURRENT_FRESH",
      economicsProven:rows.some(r=>r.economicsProven),eligibilityProven:!!candidate,canaryItemId:candidate?.itemId??null}),
    candidateSelection: "LOWEST_ECONOMIC_UNCERTAINTY", newListingEconomicsAutoReady: true,
    ownerManualEconomicsRepairRequired: false, stopForOwnerApproval: true,
    ownerApprovalRequired: true, ebayAdsWriteEnabled: false, multiListingAdsWriteEnabled: false,
    marketplaceWrites: 0, ebayAdsWrites: 0, officialApiCalls, officialCandidatesExamined, officialReadBlocker, codexRuntimeDependency: false }
}
