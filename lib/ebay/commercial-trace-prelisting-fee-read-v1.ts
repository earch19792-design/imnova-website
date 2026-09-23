import type { SupabaseClient } from "@supabase/supabase-js"
import { readEbayFeeHandoffV1 } from "../seller-os/ebay-fee-runtime-v1"
import { feePackageRevisionV1 } from "../seller-os/ebay-fee-producer-v1"

type R = Record<string, unknown>
const record = (value: unknown): R => value && typeof value === "object" &&
  !Array.isArray(value) ? value as R : {}

/** Existing-package-only fee handoff. It never creates a package, a fee
 * binding or a marketplace item. A new Trace without a matching current
 * package remains MISSING instead of borrowing another listing's tariff. */
export async function readCommercialTracePreListingFeeV1(input: Readonly<{
  supabase: SupabaseClient
  marketplaceAccountKey: string
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  categoryId: string | null
  salePrice: number | null
  now?: Date
  readFeeHandoff?: typeof readEbayFeeHandoffV1
}>) {
  const missing = (reason: string) => ({ status: "MISSING" as const,
    reason, fee: null })
  if (!input.categoryId || input.salePrice === null ||
      !Number.isFinite(input.salePrice) || input.salePrice <= 0) {
    return missing("FEE_EXACT_CATEGORY_OR_PRICE_MISSING")
  }
  const queue = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku")
    .eq("supplier_product_id", input.lunaProductId)
    .eq("supplier_variant_id", input.lunaVariantId)
    .eq("supplier_sku", input.supplierSku).limit(2)
  if (queue.error || queue.data?.length !== 1) return missing(
    "FEE_EXACT_OPPORTUNITY_UNAVAILABLE")
  const opportunity = queue.data[0]
  const packages = await input.supabase.from("ebay_listing_packages")
    .select("id,account_key,opportunity_id,candidate_key,package_data")
    .eq("account_key", input.marketplaceAccountKey)
    .eq("opportunity_id", opportunity.id)
    .eq("candidate_key", opportunity.candidate_key).limit(2)
  if (packages.error || packages.data?.length !== 1) return missing(
    "FEE_EXACT_PACKAGE_UNAVAILABLE")
  const pkg = packages.data[0]
  const data = record(pkg.package_data), pricing = record(data.pricing)
  if (pkg.account_key !== input.marketplaceAccountKey ||
      pkg.opportunity_id !== opportunity.id ||
      pkg.candidate_key !== opportunity.candidate_key ||
      data.categoryId !== input.categoryId ||
      pricing.targetPrice !== input.salePrice ||
      pricing.currency !== "USD") return missing(
    "FEE_PACKAGE_CATEGORY_OR_PRICE_CONFLICT")
  const packageRevision = feePackageRevisionV1(data)
  const read = input.readFeeHandoff ?? readEbayFeeHandoffV1
  const handoff = await read({ supabase: input.supabase,
    accountKey: input.marketplaceAccountKey, itemId: null,
    packageId: String(pkg.id), sku: input.supplierSku,
    now: input.now ?? new Date() })
  if (handoff?.status === "STALE") return { status: "STALE" as const,
    reason: "FEE_CURRENT_PACKAGE_AUTHORITY_STALE",
    fee: { status: "STALE" as const } }
  const authority = record(handoff?.resolvedAuthority)
  if (handoff?.status !== "PROVEN" ||
      authority.marketplaceAccountKey !== input.marketplaceAccountKey ||
      authority.marketplace !== "EBAY_US" ||
      authority.itemId !== null || authority.packageId !== pkg.id ||
      authority.packageRevision !== packageRevision ||
      authority.sku !== input.supplierSku ||
      authority.categoryId !== input.categoryId ||
      record(authority.feeBasis).salePrice !== input.salePrice) {
    return missing("FEE_CURRENT_PACKAGE_AUTHORITY_UNPROVEN")
  }
  return { status: "PROVEN" as const,
    reason: "EXACT_EXISTING_PACKAGE_PRE_SALE_AUTHORITY",
    fee: { itemId: null, packageId: String(pkg.id), packageRevision,
      sku: input.supplierSku,
      packageIdentity: { marketplaceAccountKey: input.marketplaceAccountKey,
        lunaProductId: input.lunaProductId,
        lunaVariantId: input.lunaVariantId,
        supplierSku: input.supplierSku,
        packageId: String(pkg.id), packageRevision },
      metadata: { feeAuthorityV1: authority },
      // No canonical interval-wide maximum producer exists yet. The quote
      // at one target is not silently reused as the economic-floor bound.
      floorFeeIntervalBound: null } }
}
