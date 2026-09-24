export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { canonicalLunaOpportunityCandidateKeyV1 } from
  "@/lib/ebay/ebay-luna-opportunity-identity-v1"
import {
  createOwnerFulfillmentReceiptV1,
  normalizeOwnerFulfillmentFieldsV1,
  readOwnerFulfillmentAttestationV1,
  reconcileOwnerFulfillmentAttestationV1,
} from "@/lib/ebay/seller-os-owner-fulfillment-attestation-v1"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const json = (body: unknown, status = 200) => NextResponse.json(body,
  { status, headers: { "Cache-Control": "private, no-store, max-age=0" } })
const safety = Object.freeze({ taxonomyExecutions: 0,
  shippingRecaptures: 0, feeEconomicsExecutions: 0,
  finalPriceCalculations: 0, ebayWrites: 0, publication: 0,
  inventoryWrites: 0, stockGuardWrites: 0 })

async function canonicalOpportunity(opportunityId: string) {
  if (!UUID.test(opportunityId)) throw new Error(
    "OWNER_FULFILLMENT_OPPORTUNITY_ID_INVALID")
  const supabase = getSupabaseAdminClient()
  const found = await supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,supplier_sku,supplier_product_id,supplier_variant_id,market_radar_product_id,assessment,updated_at")
    .eq("id", opportunityId).limit(2)
  const row = found.data?.[0]
  if (found.error || found.data?.length !== 1 || !row ||
      !row.supplier_sku || !row.supplier_product_id ||
      !row.supplier_variant_id ||
      row.candidate_key !== canonicalLunaOpportunityCandidateKeyV1(
        row.supplier_product_id, row.supplier_variant_id)) {
    throw new Error("OWNER_FULFILLMENT_CANONICAL_IDENTITY_UNPROVEN")
  }
  const catalog = await supabase.from("market_radar_latest_variants")
    .select("product_id,sku")
    .eq("source_key", "lunaportex")
    .eq("supplier_product_id", row.supplier_product_id)
    .eq("supplier_variant_id", row.supplier_variant_id)
    .eq("sku", row.supplier_sku).limit(2)
  if (catalog.error || catalog.data?.length !== 1 ||
      catalog.data[0].product_id !== row.market_radar_product_id) {
    throw new Error("OWNER_FULFILLMENT_CATALOG_IDENTITY_UNPROVEN")
  }
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) throw new Error("EBAY_US_ACCOUNT_SCOPE_MISSING")
  const identity = Object.freeze({ accountKey, marketplace: "EBAY_US" as const,
    opportunityId, candidateKey: row.candidate_key,
    sku: row.supplier_sku,
    productId: row.supplier_product_id,
    variantId: row.supplier_variant_id })
  return { supabase, row, identity }
}

function responseFor(assessment: unknown,
  identity: Awaited<ReturnType<typeof canonicalOpportunity>>["identity"]) {
  const authority = readOwnerFulfillmentAttestationV1({
    assessment, identity })
  return { success: true, identity,
    fulfillmentReceiptId: authority.current?.receiptId ?? null,
    fulfillmentAuthorityStatus: authority.fulfillmentAuthorityStatus,
    classification: authority.classification,
    restrictionStatus: authority.current?.restrictionStatus ?? "UNKNOWN",
    ownerConfirmedAt: authority.current?.ownerConfirmedAt ?? null,
    provenance: authority.current?.provenance ?? null,
    historyCount: authority.history.length,
    supersedesReceiptId: authority.current?.supersedesReceiptId ?? null,
    specializedRestrictedGoodsAuthorityRequired:
      authority.specializedRestrictedGoodsAuthorityRequired,
    restrictedGoodsEscalationRule:
      "ANY_TRUE_OR_UNKNOWN_REQUIRES_SPECIALIZED_RESTRICTED_GOODS_AUTHORITY",
    readyForOwnerConfirmation: true,
    safety }
}

export async function GET(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok || auth.authenticationMode !== "admin_user" || !auth.userId) {
    return json({ success: false, error: "OWNER_SELLER_OS_AUTH_REQUIRED",
      safety }, 403)
  }
  try {
    const id = new URL(req.url).searchParams.get("opportunityId") ?? ""
    const { row, identity } = await canonicalOpportunity(id)
    return json(responseFor(row.assessment, identity))
  } catch (error) {
    return json({ success: false,
      error: error instanceof Error ? error.message :
        "OWNER_FULFILLMENT_READ_FAILED", safety }, 409)
  }
}

export async function POST(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok || auth.authenticationMode !== "admin_user" || !auth.userId) {
    return json({ success: false, error: "OWNER_SELLER_OS_AUTH_REQUIRED",
      safety }, 403)
  }
  try {
    const body = await req.json() as Record<string, unknown>
    const opportunityId = String(body.opportunityId ?? "")
    const fields = normalizeOwnerFulfillmentFieldsV1(body.fields)
    const { supabase, row, identity } = await canonicalOpportunity(
      opportunityId)
    const previous = readOwnerFulfillmentAttestationV1({
      assessment: row.assessment, identity }).current
    const confirmedAt = new Date().toISOString()
    const receipt = createOwnerFulfillmentReceiptV1({
      identity, fields, ownerActorUserId: auth.userId,
      ownerConfirmedAt: confirmedAt,
      previousReceiptId: previous?.receiptId ?? null,
    })
    const assessment = reconcileOwnerFulfillmentAttestationV1({
      assessment: row.assessment, identity, receipt,
    })
    const updated = await supabase.from("ebay_luna_opportunity_queue")
      .update({ assessment, updated_at: confirmedAt })
      .eq("id", opportunityId)
      .eq("candidate_key", identity.candidateKey)
      .eq("updated_at", row.updated_at)
      .select("id").limit(1)
    if (updated.error || updated.data?.length !== 1) {
      throw new Error("OWNER_FULFILLMENT_STALE_VERSION_RETRY")
    }
    const durable = await canonicalOpportunity(opportunityId)
    const result = responseFor(durable.row.assessment, durable.identity)
    if (result.fulfillmentReceiptId !== receipt.receiptId ||
        result.fulfillmentAuthorityStatus !==
          receipt.fulfillmentAuthorityStatus) {
      throw new Error("OWNER_FULFILLMENT_DURABLE_READBACK_FAILED")
    }
    return json(result)
  } catch (error) {
    return json({ success: false,
      error: error instanceof Error ? error.message :
        "OWNER_FULFILLMENT_CONFIRMATION_FAILED", safety }, 409)
  }
}
