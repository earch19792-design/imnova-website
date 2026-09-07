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
      return NextResponse.json({ success: recovery.status === "PASS",
        recovery, productResearchHandoff,
        safety: { sellerOsRuntimeAuthority: true,
          preAuthorizationPreparationOnly: true,
          activeAuthorizedPackagesExcluded: true,
          ownerAuthorizationCreatedCount: 0,
          marketplaceWrites: 0, listingPublications: 0,
          productDecisions: 0, categorySelections: 0,
          publisherDispatches: 0 } },
      { status: recovery.status === "PASS" ? 200 : 503 })
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
    console.info("SELLER_OS_CATEGORY_AUTHORITY_RECOVERY_V1", {
      status: categoryAuthority.status,
      scannedPackageCount: categoryAuthority.scannedPackageCount,
      eligiblePackageCount: categoryAuthority.eligiblePackageCount,
      rematerializedPackageCount:
        categoryAuthority.rematerializedPackageCount,
      marketplaceWrites: categoryAuthority.marketplaceWrites,
    })
    return NextResponse.json({ success,
      recovery: { productResearchHandoff, interruptedClaims,
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
