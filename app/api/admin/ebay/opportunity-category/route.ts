export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { canonicalLunaOpportunityCandidateKeyV1 } from "@/lib/ebay/ebay-luna-opportunity-identity-v1"
import { readEbayUsNoStoreFvfCategoryV1 } from "@/lib/ebay/ebay-us-no-store-fvf-category-read-v1"
import { readEbayUsNoStoreFvfPolicyV1,
  resolveEbayUsNoStoreFvfPolicyV1 } from "@/lib/ebay/ebay-us-no-store-fvf-policy-v1"
import { createEbayListingCategoryReceiptV1,
  readEbayOpportunityCategoryAuthorityV1,
  reconcileEbayOpportunityCategoryReceiptV1 } from
  "@/lib/ebay/ebay-listing-category-authority-v1"

const json = (body: unknown, status = 200) => NextResponse.json(body,
  { status, headers: { "Cache-Control": "private, no-store, max-age=0" } })
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}

async function canonicalOpportunity(opportunityId: string, candidateKey: string) {
  if (!/^[0-9a-f-]{36}$/i.test(opportunityId) || !candidateKey ||
    candidateKey.length > 300) throw Error("CANONICAL_OPPORTUNITY_IDENTITY_REQUIRED")
  const supabase = getSupabaseAdminClient()
  const read = await supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_sku,supplier_product_id,supplier_variant_id,market_radar_product_id,product_title,assessment,updated_at")
    .eq("id", opportunityId).eq("candidate_key", candidateKey).limit(2)
  const row = read.data?.[0]
  if (read.error || read.data?.length !== 1 || !row ||
    !row.supplier_sku || !row.supplier_product_id || !row.supplier_variant_id ||
    candidateKey !== canonicalLunaOpportunityCandidateKeyV1(
      row.supplier_product_id, row.supplier_variant_id)) {
    throw Error("CANONICAL_OPPORTUNITY_IDENTITY_MISMATCH")
  }
  const catalog = await supabase.from("market_radar_latest_variants")
    .select("product_id,sku")
    .eq("source_key", "lunaportex")
    .eq("supplier_product_id", row.supplier_product_id)
    .eq("supplier_variant_id", row.supplier_variant_id)
    .eq("sku", row.supplier_sku).limit(2)
  if (catalog.error || catalog.data?.length !== 1 ||
    catalog.data[0].product_id !== row.market_radar_product_id) {
    throw Error("CANONICAL_OPPORTUNITY_CATALOG_MISMATCH")
  }
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) throw Error("EBAY_US_ACCOUNT_SCOPE_MISSING")
  return { supabase, row, accountKey }
}

async function responseFor(row: Record<string, unknown>, accountKey: string) {
  const assessment = record(row.assessment)
  const receipt = record(record(record(
    assessment.categoryAuthorityByAccountV1)[accountKey]).current)
  const identity = { accountKey,
    opportunityId: String(row.id), candidateKey: String(row.candidate_key),
    sku: String(row.supplier_sku), productId: String(row.supplier_product_id),
    variantId: String(row.supplier_variant_id),
    categoryId: String(receipt.categoryId ?? "") }
  const category = readEbayOpportunityCategoryAuthorityV1({
    assessment, identity })
  const policy = await readEbayUsNoStoreFvfPolicyV1()
  const fee = resolveEbayUsNoStoreFvfPolicyV1({
    accountKey, categoryId: category.status === "PROVEN"
      ? identity.categoryId : null,
    categoryAuthority: category.status === "PROVEN"
      ? record(category.receipt).officialAncestry : null,
    policy,
  })
  return { success: true, marketplace: "EBAY_US", identity,
    categoryAuthorityStatus: category.status,
    categoryReceiptId: category.status === "PROVEN"
      ? category.receipt.receiptId : null,
    categoryId: category.status === "PROVEN" ? identity.categoryId : null,
    exactCategoryPath: category.status === "PROVEN"
      ? category.receipt.categoryPath : null,
    taxonomyVersion: category.status === "PROVEN"
      ? category.receipt.taxonomyTreeVersion : null,
    feePolicyStatus: fee.status,
    applicableFvfRule: fee.status === "PROVEN" ? {
      ruleId: fee.ruleId, method: fee.method,
      percentageTiers: fee.percentageTiers } : null,
    perOrderFeeRule: fee.perOrderFeeRule,
    readyForEconomics: category.status === "PROVEN" && fee.status === "PROVEN",
    packageIdRequiredForCategoryAuthority: false,
    blocker: category.status !== "PROVEN" ? `CATEGORY_${category.status}`
      : fee.blocker,
    safety: { taxonomyExecutions: 0, databaseWrites: 0,
      economicsExecutions: 0,
      ebayWrites: 0, publication: 0, inventoryWrites: 0,
      stockGuardWrites: 0 },
  }
}

export async function GET(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok || auth.authenticationMode !== "admin_user" || !auth.userId) {
    return json({ success: false, error: "OWNER_SELLER_OS_AUTH_REQUIRED" }, 403)
  }
  try {
    const params = new URL(req.url).searchParams
    const { row, accountKey } = await canonicalOpportunity(
      params.get("opportunityId") ?? "", params.get("candidateKey") ?? "")
    return json(await responseFor(row, accountKey))
  } catch (error) {
    return json({ success: false, error: error instanceof Error
      ? error.message : "OPPORTUNITY_CATEGORY_READ_FAILED" }, 409)
  }
}

/** OWNER selection is stamped from the authenticated request. The only eBay
 * calls are the existing exact-leaf Taxonomy GETs, if no current receipt exists. */
export async function POST(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok || auth.authenticationMode !== "admin_user" || !auth.userId) {
    return json({ success: false, error: "OWNER_SELLER_OS_AUTH_REQUIRED" }, 403)
  }
  try {
    const body = record(await req.json())
    const opportunityId = String(body.opportunityId ?? "")
    const candidateKey = String(body.candidateKey ?? "")
    const categoryId = String(body.categoryId ?? "")
    if (!/^\d{1,20}$/.test(categoryId)) {
      return json({ success: false, error: "EXACT_CATEGORY_ID_REQUIRED" }, 400)
    }
    const { supabase, row, accountKey } = await canonicalOpportunity(
      opportunityId, candidateKey)
    const identity = { accountKey, opportunityId, candidateKey,
      sku: String(row.supplier_sku),
      productId: String(row.supplier_product_id),
      variantId: String(row.supplier_variant_id), categoryId }
    const existing = readEbayOpportunityCategoryAuthorityV1({
      assessment: row.assessment, identity })
    if (existing.status === "PROVEN") {
      return json({ ...await responseFor(row, accountKey),
        taxonomyExecutions: 0, databaseWrites: 0 })
    }
    const official = await readEbayUsNoStoreFvfCategoryV1({
      categoryId, query: String(row.product_title ?? "").trim() })
    if (!official) return json({ success: false,
      error: "EXACT_AUTHENTICATED_TAXONOMY_LEAF_REQUIRED" }, 409)
    const now = new Date()
    const receipt = createEbayListingCategoryReceiptV1({ identity,
      selection: { source: "OWNER_SELLER_OS_OPPORTUNITY_SELECTION",
        sourceId: opportunityId, opportunityId, candidateKey,
        packageId: null, marketplace: "EBAY_US", accountKey,
        sku: identity.sku, productId: identity.productId,
        variantId: identity.variantId, categoryId,
        categoryPath: official.path, actorUserId: auth.userId,
        selectedAt: now.toISOString() },
      officialAncestry: official, now })
    if (!receipt) return json({ success: false,
      error: "CATEGORY_AUTHORITY_RECEIPT_REJECTED" }, 409)
    const assessment = reconcileEbayOpportunityCategoryReceiptV1({
      assessment: row.assessment, accountKey, nextReceipt: receipt })
    const write = await supabase.from("ebay_luna_opportunity_queue")
      .update({ assessment, updated_at: now.toISOString() })
      .eq("id", opportunityId)
      .eq("candidate_key", candidateKey).eq("updated_at", row.updated_at)
      .select("id").limit(1)
    if (write.error || write.data?.length !== 1) {
      return json({ success: false,
        error: "OPPORTUNITY_CATEGORY_STALE_VERSION_RETRY" }, 409)
    }
    const durable = await canonicalOpportunity(opportunityId, candidateKey)
    const result = await responseFor(durable.row, accountKey)
    if (result.categoryAuthorityStatus !== "PROVEN" ||
      result.categoryReceiptId !== receipt.receiptId) {
      throw Error("CATEGORY_AUTHORITY_DURABLE_READBACK_FAILED")
    }
    return json({ ...result, taxonomyExecutions: 1, databaseWrites: 1,
      safety: { ...result.safety, taxonomyExecutions: 1,
        databaseWrites: 1 } })
  } catch (error) {
    return json({ success: false, error: error instanceof Error
      ? error.message : "OPPORTUNITY_CATEGORY_WRITE_FAILED" }, 409)
  }
}
