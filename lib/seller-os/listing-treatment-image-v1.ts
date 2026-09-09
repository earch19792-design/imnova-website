import type { SupabaseClient } from "@supabase/supabase-js"
import type { CommercialMonitorGetDto } from "../ebay/commercial-monitor-readonly-contract"
import { buildSellerOsCurrentLiveVisualQualityV1 } from "../ebay/ebay-seller-os-visual-quality-v1"
import { createSellerOsVisualVariantsV1 } from "../ebay/ebay-seller-os-visual-variant-v1"
import { canGenerateVisualFindingV1 } from "../ebay/ebay-visual-generation-capabilities-v1"
import { keywordWireDigestV1 } from "./keyword-intelligence-handoff-v1"
import { TREATMENT_RECEIPT_V1, type diagnoseListingTreatmentV1 } from "./listing-treatment-engine-v1"

export async function prepareTreatmentImageV1(input: { supabase: SupabaseClient; accountKey: string;
  monitor: CommercialMonitorGetDto; treatment: ReturnType<typeof diagnoseListingTreatmentV1>;
  actorId: string; traceId: string; apiKey: string;
  review?: typeof buildSellerOsCurrentLiveVisualQualityV1; generate?: typeof createSellerOsVisualVariantsV1 }) {
  if (input.treatment.treatment !== "OPTIMIZE" || !input.treatment.diagnosticPriorities.includes("MAIN_IMAGE"))
    throw Error("IMAGE_NOT_REQUIRED_METRICS_GATE")
  if (!input.apiKey) throw Error("DEDICATED_PREPROD_OPENAI_KEY_REQUIRED")
  const itemId = input.treatment.itemId
  const monitor = { ...input.monitor, listings: input.monitor.listings.filter(l => l.identity.itemId === itemId) }
  const review = await (input.review ?? buildSellerOsCurrentLiveVisualQualityV1)({ monitor })
  const listing = review.listings.find(l => l.ebayItemId === itemId)
  const finding = listing?.findings.find(f => canGenerateVisualFindingV1(f.findingCode))
  if (!listing?.sourceResolution.sourceImageFullResolutionCertified || !finding) throw Error("AUTHORIZED_IMAGE_REPAIR_EVIDENCE_REQUIRED")
  // Same source and diagnosis has one durable reservation. A timeout requires
  // receipt reconciliation; it never silently issues another paid generation.
  const key = keywordWireDigestV1(["IMAGE", input.accountKey, itemId, listing.heroImageUrl, finding.findingCode, input.treatment.supportingEvidence])
  const existing = await input.supabase.from("seller_os_assistant_treatment_receipts_v1").select("receipt_id,result")
    .eq("marketplace_account_key", input.accountKey).eq("ebay_item_id", itemId).eq("receipt_id", key).maybeSingle()
  if (existing.error) throw Error("IMAGE_RECEIPT_READ_FAILED")
  if (existing.data) throw Error("IMAGE_REQUEST_ALREADY_RESERVED_RECONCILE_RECEIPT")
  const reserved = await input.supabase.from("seller_os_assistant_treatment_receipts_v1").insert({
    receipt_id: key, marketplace_account_key: input.accountKey, ebay_item_id: itemId,
    contract_version: TREATMENT_RECEIPT_V1, input_digest: key, treatment: "OPTIMIZE", receipt_kind: "IMAGE_REQUEST",
    policy: {}, before_evidence: { sourceImage: listing.heroImageUrl, finding, evidence: input.treatment.supportingEvidence },
    result: { status: "RESERVED", traceId: input.traceId, marketplaceWrites: 0 } })
  if (reserved.error) throw Error("IMAGE_RESERVATION_CONFLICT_OR_UNAVAILABLE")
  return (input.generate ?? createSellerOsVisualVariantsV1)({ supabase: input.supabase, accountKey: input.accountKey,
    monitor, actorId: input.actorId, ebayItemId: itemId, findingCode: finding.findingCode,
    variantCount: 1, apiKey: input.apiKey, traceId: input.traceId })
}
