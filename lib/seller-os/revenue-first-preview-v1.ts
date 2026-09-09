import type { SupabaseClient } from "@supabase/supabase-js"
import { readSellerOsProductCaseAuditV1 } from "./audit-observability-gateway-v1"
import { consumeListingPackageKeywordHandoffV1, keywordWireDigestV1,
  type KeywordBindingV1 } from "./keyword-intelligence-handoff-v1"
import { revenueFailureV1, revenueTraceIdV1 } from "./revenue-first-diagnostics-v1"
import { readDurableListingQualityArtifactV1 } from "../ebay/ebay-listing-quality-report-read-v1"
import { normalizeEbayListingQualityReport } from "../ebay/ebay-commercial-monitor-intelligence-v1"
import { buildQuickPickMarketTestListingReviewV1 } from "../ebay/ebay-quick-pick-market-test-package-v1"
import type { CommercialMonitorGetDto } from "../ebay/commercial-monitor-readonly-contract"

export const REVENUE_FIRST_PREVIEW_TOOL_V1 = "seller_os_prepare_listing_optimization_preview"
export const REVENUE_FIRST_PREVIEW_VERSION = "SELLER_OS_REVENUE_FIRST_ASSISTANT_P0_IMPLEMENTATION_V1"
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {}
const safety = Object.freeze({ readOnly: true, draftOnly: true, persistenceUsed: false,
  canPublish: false, marketplaceWrites: 0, databaseBusinessWrites: 0, providerCalls: 0,
  researchRecomputations: 0, credentialsIncluded: false, buyerPiiIncluded: false })

// Authenticated callers supply the account; the tool never accepts account or content overrides.
export async function prepareRevenueFirstListingPreviewV1(input: {
  supabase: SupabaseClient; accountKey: string; itemId: string;
  monitor: CommercialMonitorGetDto; traceId?: string; now?: Date
}) {
  const traceId = revenueTraceIdV1(input.traceId)
  const base = { contractVersion: REVENUE_FIRST_PREVIEW_VERSION, TRACE_ID: traceId, safety }
  if (!/^\d{9,19}$/.test(input.itemId)) return { ...base, status: "NEEDS_EVIDENCE",
    ...revenueFailureV1(null, "INPUT_VALIDATION", "LISTING_OPTIMIZATION_INPUT_INVALID", traceId), preview: null }
  const audit = await readSellerOsProductCaseAuditV1({ supabase: input.supabase,
    accountKey: input.accountKey, identityType: "EBAY_ITEM_ID", identity: input.itemId,
    detailMode: "EVIDENCE", now: input.now, traceId })
  const identity = record(audit.RESOLVED_CANONICAL_IDENTITY)
  const linkage = record(record(audit).IDENTITY_LINKAGE_PROVENANCE)
  // This flow requires the exact verified binding, including when a legacy SKU could resolve.
  if (!identity.packageId || !identity.opportunityId || !identity.candidateId || !linkage.linkId) {
    return { ...base, status: "NEEDS_EVIDENCE", identity: null, preview: null,
      ...revenueFailureV1(null, "EXACT_LISTING_IDENTITY", "CANONICAL_PRODUCT_IDENTITY_NOT_FOUND", traceId) }
  }
  const [packageRead, opportunityRead, quality] = await Promise.all([
    input.supabase.from("ebay_listing_packages").select("id,opportunity_id,candidate_key,status,package_data")
      .eq("account_key", input.accountKey).eq("id", identity.packageId)
      .eq("opportunity_id", identity.opportunityId).eq("candidate_key", identity.candidateId).maybeSingle(),
    input.supabase.from("ebay_luna_opportunity_queue").select("*")
      .eq("id", identity.opportunityId).eq("candidate_key", identity.candidateId)
      .eq("supplier_product_id", identity.lunaProductId).eq("supplier_variant_id", identity.lunaVariantId).maybeSingle(),
    readDurableListingQualityArtifactV1({ supabase: input.supabase, accountKey: input.accountKey,
      now: input.now?.toISOString() }).catch(() => ({ durable: true, status: "UNAVAILABLE", reportExists: null })),
  ])
  if (packageRead.error || opportunityRead.error || !packageRead.data || !opportunityRead.data) {
    return { ...base, status: "UNAVAILABLE", identity, preview: null,
      ...revenueFailureV1(null, "PACKAGE_PREVIEW", "PACKAGE_PREVIEW_EVIDENCE_REQUIRED", traceId) }
  }
  const binding: KeywordBindingV1 = { ACCOUNT_KEY: input.accountKey,
    PRODUCT_ID: String(identity.lunaProductId ?? ""), VARIANT_ID: String(identity.lunaVariantId ?? ""),
    CANDIDATE_KEY: String(identity.candidateId), OPPORTUNITY_ID: String(identity.opportunityId) }
  const keywordRead = record(audit).KEYWORD_INTELLIGENCE
  const handoff = consumeListingPackageKeywordHandoffV1(keywordRead, binding)
  const review = buildQuickPickMarketTestListingReviewV1({ opportunity: opportunityRead.data,
    listingPackage: packageRead.data, keywordDecisionHandoff: keywordRead,
    keywordDecisionBinding: binding, requireKeywordDecisionV2_1: true })
  const qualityReport = normalizeEbayListingQualityReport({ artifact: quality, listings: input.monitor.listings })
  const data = record(packageRead.data.package_data)
  const original = { title: data.title ?? null, description: data.description ?? null,
    itemSpecifics: data.itemSpecifics ?? data.aspects ?? {}, imageUrls: data.imageUrls ?? [],
    categoryId: data.categoryId ?? null, conditionId: data.conditionId ?? null }
  const keywordAccepted = handoff.STATUS === "ACCEPTED"
  const preview = keywordAccepted ? { ...original, title: review.title,
    description: review.description, itemSpecifics: review.itemSpecifics } : original
  const blockers = [...handoff.BLOCKERS,
    ...(!review.finalListingPackageReady ? ["PACKAGE_PREVIEW_EVIDENCE_REQUIRED"] : []),
    ...(!Array.isArray(original.imageUrls) || original.imageUrls.length === 0 ? ["IMAGE_EVIDENCE_REQUIRED"] : [])]
  return { ...base, status: blockers.length ? "NEEDS_EVIDENCE" : "PREVIEW_READY",
    identity, identityLinkageProvenance: linkage, sourcePackageId: identity.packageId,
    sourcePackageStatus: packageRead.data.status,
    original, preview, previewDigest: keywordWireDigestV1({ binding, preview }),
    sourcePackageDigest: keywordWireDigestV1({ binding, packageData: data }),
    keywordIntelligence: handoff, qualityReport, blockers,
    commercialEnvelope: record(audit).COMMERCIAL_ENVELOPE,
    ...(blockers.length ? revenueFailureV1(null, keywordAccepted ? "PACKAGE_PREVIEW" : "KEYWORD_INTELLIGENCE",
      keywordAccepted ? "PACKAGE_PREVIEW_EVIDENCE_REQUIRED" : "KEYWORD_DECISION_UNPROVEN", traceId) : {}),
    previewUrl: `/admin/ebay/listing-optimization/preview?itemId=${input.itemId}`,
    evidence: { titleSource: review.titleSource, descriptionSource: review.descriptionSource,
      itemSpecificsSource: "EXISTING_CANONICAL_PACKAGE_AND_READINESS",
      images: "EXISTING_PACKAGE_ASSETS_NO_GENERATION", liveContentFullyRead: false,
      sellOneLikeThis: "UNPROVEN_NO_EXECUTABLE_HANDOFF", publication: "OUT_OF_SCOPE" } }
}

export async function loadRevenueFirstListingPreviewV1(itemId: string, traceId?: string) {
  const [{ getSupabaseAdminClient }, { getEbaySellerAccountScopeConfiguration },
    { loadSellerOsAssistantMonitorSnapshotV1 }] = await Promise.all([
    import("../supabase-admin"), import("../ebay/ebay-seller-account-scope"),
    import("../ebay/ebay-seller-os-assistant-runtime"),
  ])
  const account = getEbaySellerAccountScopeConfiguration()
  if (!account.accountKey) throw new Error("AUDIT_ACCOUNT_SCOPE_REQUIRED")
  return prepareRevenueFirstListingPreviewV1({ supabase: getSupabaseAdminClient(),
    accountKey: account.accountKey, itemId, traceId,
    monitor: await loadSellerOsAssistantMonitorSnapshotV1() })
}
