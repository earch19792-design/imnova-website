export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { getEbayTaxonomyListingIntelligence } from
  "@/lib/ebay/ebay-seller-keyword-demand-gateway"
import { preflightEbayCategoryProductIdentifiers } from
  "@/lib/ebay/ebay-draft-only-gateway"
import { recoverInterruptedLunaQuickPickRuntimeV1 } from
  "@/lib/ebay/ebay-quick-pick-interrupted-runtime-recovery-v1"
import { recoverFalseExactCategoryAuthorityRuntimeV1 } from
  "@/lib/ebay/ebay-category-authority-runtime-recovery-v1"
import { recoverQuickPickPublisherPackagesV1 } from
  "@/lib/ebay/ebay-quick-pick-publisher-package-recovery-v1"
import { reconcileQuickPickProductResearchHandoffV1 } from
  "@/lib/ebay/ebay-quick-pick-product-research-handoff-v1"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { sellerOsPostOnlyGetResponseV1,
  sellerOsPostRuntimeAuthorizedV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"
import { reconcileCurrentFactoryKeywordContinuationsV2_1 } from
  "@/lib/seller-os/current-keyword-continuation-v2-1"
import { materializeSellerOsDeterministicFactoryCandidateV1 } from
  "@/lib/ebay/ebay-smart-stocking-durable-factory-v1"
import { readEbayPackageFeeContextReadonlyV1 } from
  "@/lib/ebay/ebay-package-fee-context-readonly-v1"
import { persistProducedEbayFeeV1, readEbayFeeHandoffV1 } from
  "@/lib/seller-os/ebay-fee-runtime-v1"
import { readSellOneLikeThisV1 } from
  "@/lib/seller-os/sell-one-like-this-runtime-v1"

function authorized(req: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? ""
  const runtimeSecret = process.env.SELLER_OS_RUNTIME_RECOVERY_SECRET
    ?.trim() ?? ""
  return Boolean(
    cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`
    || runtimeSecret && req.headers.get(
      "x-seller-os-runtime-recovery-secret") === runtimeSecret,
  )
}

export async function POST(req: Request) {
  const supabase = getSupabaseAdminClient()
  if (!authorized(req) && !await sellerOsPostRuntimeAuthorizedV1({
    request: req, supabase,
  })) return NextResponse.json({ success: false,
    error: "CRON_UNAUTHORIZED" }, { status: 401 })
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return NextResponse.json({ success: false,
    error: "QUICK_PICK_RECOVERY_ACCOUNT_SCOPE_REQUIRED" }, { status: 500 })
  try {
    if (req.headers.get("x-seller-os-runtime-lane") ===
        "CURRENT_PREPUBLICATION_SAME_LINK_CLOSEOUT") {
      const packageId = "695a862f-2385-4b6c-b996-5e4aac2ca36c"
      const materialized =
        await materializeSellerOsDeterministicFactoryCandidateV1({
          supabase, accountKey,
          opportunityId: "5acad932-7595-4659-9822-b8084ff5a107",
          candidateKey:
            "sha256:f574d51362e8d7869bcc139caf180abceb9f7ff72ccb84fe801d40960ca93ab2",
          taxonomyReader: getEbayTaxonomyListingIntelligence,
          productIdentifierPolicyReader:
            preflightEbayCategoryProductIdentifiers,
          skipKeywordContinuation: true,
        })
      if (materialized.listingPackageId !== packageId ||
          materialized.packageCreated) {
        throw new Error("SAME_LINK_CURRENT_PACKAGE_REUSE_REQUIRED")
      }
      const now = new Date()
      const currentFee = await readEbayFeeHandoffV1({
        supabase, accountKey, packageId, itemId: null,
        sku: "FL-NH4784642", now,
      })
      const feeContext = currentFee?.status === "PROVEN"
        ? null : await readEbayPackageFeeContextReadonlyV1(packageId)
      const feeAuthority = currentFee?.status === "PROVEN"
        ? currentFee.authority as Awaited<ReturnType<
          typeof persistProducedEbayFeeV1
        >>
        : await persistProducedEbayFeeV1({
          supabase, accountKey, packageId, itemId: null,
          sku: "FL-NH4784642",
          context: feeContext,
          // Official reads above establish their own observation timestamps.
          // Evaluate only after they complete so fresh evidence is never
          // rejected as being a few seconds in the future.
          now: new Date(),
        })
      const current = await readSellOneLikeThisV1({
        // The CURRENT package has its own factory marker. No historical item
        // may become a category, specifics, price or exposure authority here.
        supabase, accountKey, packageId, referenceItemId: "",
      })
      return NextResponse.json({
        success: feeAuthority.state === "PROVEN_PRE_SALE",
        contractVersion: "CURRENT_PREPUBLICATION_SAME_LINK_CLOSEOUT_V1",
        packageId,
        packageCreated: false,
        keywordContinuationSkipped: true,
        categoryId: materialized.categoryId,
        categoryReady: materialized.categoryReady,
        conditionReady: materialized.conditionReady,
        requiredItemSpecificsReady:
          materialized.requiredItemSpecificsReady,
        listingPolicyReady: materialized.listingPolicyReady,
        feeAuthority: {
          authorityId: feeAuthority.authorityId,
          state: feeAuthority.state,
          economicsState: feeAuthority.economicsState,
          amount: feeAuthority.amount,
          feeEstimateMode: feeAuthority.feeEstimateMode,
          resolutionBlockers: feeAuthority.resolutionBlockers,
          buyerTaxFeeClassification:
            feeAuthority.buyerTaxFeeClassification,
        },
        feeAuthorityReused: currentFee?.status === "PROVEN",
        current: {
          status: current.status,
          blockers: current.blockers,
          publicationGate: current.publicationGate,
        },
        safety: { ownerRoutineApprovalRequired: false,
          marketplaceWrites: 0, publicationWrites: 0, adsWrites: 0 },
      }, { status: feeAuthority.state === "PROVEN_PRE_SALE" ? 200 : 503 })
    }
    const currentKeywordHandoff =
      await reconcileCurrentFactoryKeywordContinuationsV2_1({
        supabase, accountKey,
      }).catch(() => Object.freeze({
        contractVersion: "CURRENT_FACTORY_KEYWORD_CONTINUATION_V2_1",
        status: "FAIL" as const,
        errorCode: "CURRENT_KEYWORD_CONTINUATION_RECONCILIATION_FAILED",
        marketplaceWrites: 0 as const, publicationWrites: 0 as const,
        adsWrites: 0 as const, ownerActionRequired: false as const,
      }))
    // This bounded reconciliation runs through the already scheduled Quick Pick
    // runtime. It makes old and new eligible intake rows discoverable without
    // requiring an owner resubmission or creating another scheduler/worker.
    const productResearchHandoff =
      await reconcileQuickPickProductResearchHandoffV1({
        supabase, accountKey,
      }).catch(() => Object.freeze({
        contractVersion: "QUICK_PICK_PRODUCT_RESEARCH_HANDOFF_V1",
        status: "FAIL" as const,
        errorCode: "QUICK_PICK_PRODUCT_RESEARCH_HANDOFF_RECONCILIATION_FAILED",
        marketplaceWrites: 0 as const,
        ownerActionRequired: false as const,
      }))
    if (req.headers.get("x-seller-os-runtime-lane") ===
        "PUBLISHER_PREAUTHORIZATION_RECOVERY") {
      const recovery = await recoverQuickPickPublisherPackagesV1({
        supabase, accountKey,
      })
      return NextResponse.json({ success: recovery.status === "PASS" &&
          currentKeywordHandoff.status === "PASS",
        recovery, productResearchHandoff, currentKeywordHandoff,
        safety: { sellerOsRuntimeAuthority: true,
          preAuthorizationPreparationOnly: true,
          activeAuthorizedPackagesExcluded: true,
          ownerAuthorizationCreatedCount: 0,
          marketplaceWrites: 0, listingPublications: 0,
          productDecisions: 0, categorySelections: 0,
          publisherDispatches: 0 } },
      { status: recovery.status === "PASS" &&
          currentKeywordHandoff.status === "PASS" ? 200 : 503 })
    }
    const interruptedClaims = await recoverInterruptedLunaQuickPickRuntimeV1({
      supabase, accountKey,
      taxonomyReader: getEbayTaxonomyListingIntelligence,
      productIdentifierPolicyReader: preflightEbayCategoryProductIdentifiers,
    })
    const categoryAuthority = await recoverFalseExactCategoryAuthorityRuntimeV1({
      supabase, accountKey,
      taxonomyReader: getEbayTaxonomyListingIntelligence,
      productIdentifierPolicyReader: preflightEbayCategoryProductIdentifiers,
    })
    const publisherPackages = await recoverQuickPickPublisherPackagesV1({
      supabase, accountKey,
    })
    const success = interruptedClaims.status === "PASS"
      && categoryAuthority.status === "PASS"
      && publisherPackages.status === "PASS"
      && productResearchHandoff.status === "PASS"
      && currentKeywordHandoff.status === "PASS"
    console.info("SELLER_OS_CATEGORY_AUTHORITY_RECOVERY_V1", {
      status: categoryAuthority.status,
      scannedPackageCount: categoryAuthority.scannedPackageCount,
      eligiblePackageCount: categoryAuthority.eligiblePackageCount,
      rematerializedPackageCount:
        categoryAuthority.rematerializedPackageCount,
      marketplaceWrites: categoryAuthority.marketplaceWrites,
    })
    return NextResponse.json({ success,
      recovery: { currentKeywordHandoff, productResearchHandoff, interruptedClaims,
        categoryAuthority, publisherPackages },
      safety: { marketplaceWrites: 0, listingPublications: 0,
        manualFactInjection: 0, codexProductDecisions: 0,
        codexCategorySelection: 0, itemSpecificPatches: 0 } },
    { status: success ? 200 : 503 })
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    return NextResponse.json({ success: false,
      error: /^[A-Z][A-Z0-9_]{2,119}$/.test(code) ? code
        : "QUICK_PICK_RECOVERY_FAILED",
      safety: { marketplaceWrites: 0, listingPublications: 0,
        manualFactInjection: 0, codexProductDecisions: 0 } }, { status: 503 })
  }
}

export function GET() {
  return sellerOsPostOnlyGetResponseV1()
}
