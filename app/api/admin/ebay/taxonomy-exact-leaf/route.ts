export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { validateAdminApiRequest } from "@/lib/supabase-admin"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { readEbayUsNoStoreFvfCategoryV1 } from
  "@/lib/ebay/ebay-us-no-store-fvf-category-read-v1"

/** Bounded authenticated Taxonomy probe. GET-only eBay calls; no package,
 * offer, inventory, or database mutation. This proves a current leaf/path,
 * never an exact SKU selection by itself. */
export async function GET(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok || !auth.userId) return NextResponse.json({
    success: false, error: auth.error ?? "admin_forbidden",
  }, { status: auth.status || 403 })
  const params = new URL(req.url).searchParams
  const categoryId = params.get("categoryId")?.trim() ?? ""
  const query = params.get("query")?.trim() ?? ""
  if (!/^\d{1,20}$/.test(categoryId) || !query || query.length > 350) {
    return NextResponse.json({ success: false,
      error: "EXACT_CATEGORY_ID_AND_BOUNDED_QUERY_REQUIRED" }, { status: 400 })
  }
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return NextResponse.json({ success: false,
    error: "EBAY_US_ACCOUNT_SCOPE_MISSING" }, { status: 503 })
  try {
    const official = await readEbayUsNoStoreFvfCategoryV1({ categoryId, query })
    return NextResponse.json({ success: Boolean(official),
      status: official ? "PROVEN" : "MISSING",
      marketplace: "EBAY_US", accountKey,
      categoryId: official?.categoryId ?? null,
      categoryPath: official?.path ?? null,
      leafStatus: official?.leafCategoryTreeNode === true
        ? "SELECTABLE_LEAF" : "UNVERIFIED",
      taxonomyTreeId: official?.treeId ?? null,
      taxonomyTreeVersion: official?.treeVersion ?? null,
      taxonomyObservedAt: official?.observedAt ?? null,
      taxonomyFreshUntil: official?.freshUntil ?? null,
      taxonomyDigest: official?.digest ?? null,
      skuBindingStatus: "NOT_ESTABLISHED_BY_TAXONOMY_PROBE",
      safety: { ebayResourceMethods: ["GET"], ebayWrites: 0,
        databaseWrites: 0, publishCalled: false },
    }, { status: official ? 200 : 404,
      headers: { "Cache-Control": "private, no-store, max-age=0" } })
  } catch {
    return NextResponse.json({ success: false,
      error: "EBAY_TAXONOMY_EXACT_LEAF_READ_FAILED",
      safety: { ebayResourceMethods: ["GET"], ebayWrites: 0,
        databaseWrites: 0, publishCalled: false },
    }, { status: 502 })
  }
}
