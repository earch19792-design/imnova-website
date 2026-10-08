export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextResponse } from "next/server"

import {
  buildAmazonContributorObservationV1,
  linkAmazonContributorCostAndQuantityV1,
  linkAmazonContributorSupplierCostV1,
  persistAmazonContributorObservationV1,
  readAmazonContributorPerformanceV1,
  SELLER_OS_AMAZON_CONTRIBUTOR_PERFORMANCE_V1,
} from "@/lib/marketplace/seller-os-amazon-contributor-performance-v1"
import { getAmazonSpApiReadOnlyConfigurationV1 } from
  "@/lib/marketplace/amazon-sp-api-readonly-v1"
import { runSellerOsAmazonConnieAutomaticCaptureV1 } from
  "@/lib/marketplace/seller-os-amazon-connie-auto-sync-v1"
import { assertAmazonWholesaleScoutLimitV1,
  scoutAmazonWholesaleOpportunitiesV1 } from
  "@/lib/marketplace/seller-os-amazon-wholesale-opportunity-scout-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function positiveNumber(value: unknown, integer = false) {
  const parsed = typeof value === "number" ? value
    : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 &&
      (!integer || Number.isInteger(parsed)) ? parsed : null
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: {
    "Cache-Control": "private, no-store, max-age=0",
  } })
}

function publicAmazonErrorCode(error: unknown, fallback: string) {
  const code = error instanceof Error ? error.message : ""
  return /^(?:SELLER_OS_AMAZON_|AMAZON_SP_API_)[A-Z0-9_]{2,119}$/.test(code)
    ? code : fallback
}

async function owner(req: Request) {
  const auth = await validateAdminApiRequest(req)
  return auth.ok && auth.authenticationMode === "admin_user" && auth.userId
    ? auth : null
}

export async function GET(req: Request) {
  const auth = await owner(req)
  if (!auth) {
    return json({ success: false, error: "OWNER_SELLER_OS_AUTH_REQUIRED" }, 403)
  }
  try {
    const monitor = await readAmazonContributorPerformanceV1({
      supabase: getSupabaseAdminClient(), limit: 100,
    })
    return json({ success: true,
      contractVersion: SELLER_OS_AMAZON_CONTRIBUTOR_PERFORMANCE_V1,
      monitor, connection: getAmazonSpApiReadOnlyConfigurationV1(),
      nextStep: "REVIEW_HIGHEST_VALUE_MISSING_EVIDENCE",
      safety: { readOnly: true, amazonWrites: 0, supplierPurchases: 0,
        publications: 0, repricing: 0 } })
  } catch (error) {
    return json({ success: false, error: publicAmazonErrorCode(error,
      "SELLER_OS_AMAZON_CONTRIBUTOR_MONITOR_READ_FAILED") }, 503)
  }
}

export async function POST(req: Request) {
  const auth = await owner(req)
  if (!auth) {
    return json({ success: false, error: "OWNER_SELLER_OS_AUTH_REQUIRED" }, 403)
  }
  try {
    const body = record(await req.json())
    if (body.action === "SCOUT_AMAZON_WHOLESALE_OPPORTUNITIES") {
      const scout = await scoutAmazonWholesaleOpportunitiesV1({
        supabase: getSupabaseAdminClient(),
        limit: assertAmazonWholesaleScoutLimitV1(body.limit),
        query: typeof body.query === "string" ? body.query : null,
      })
      return json({ success: true, scout,
        safety: { readOnly: true, internalDatabaseWrites: false,
          amazonWrites: 0, supplierPurchases: 0, publications: 0,
          inventoryChanges: 0, repricing: 0, paidServicesActivated: 0 } })
    }
    if (body.action === "SYNC_FROM_AMAZON_READ_ONLY") {
      const supabase = getSupabaseAdminClient()
      const sync = await runSellerOsAmazonConnieAutomaticCaptureV1({ supabase })
      const monitor = await readAmazonContributorPerformanceV1({
        supabase, limit: 100,
      })
      return json({ success: true,
        contractVersion: SELLER_OS_AMAZON_CONTRIBUTOR_PERFORMANCE_V1,
        sync, monitor, connection: getAmazonSpApiReadOnlyConfigurationV1(),
        safety: { internalDatabaseWrites: true, amazonReadOnly: true,
          amazonWrites: 0, supplierPurchases: 0, publications: 0,
        repricing: 0 } })
    }
    if (body.action === "CONFIRM_COST_AND_QUANTITY") {
      const supabase = getSupabaseAdminClient()
      const sellerSku = typeof body.sellerSku === "string"
        ? body.sellerSku.trim() : ""
      if (!sellerSku || sellerSku.length > 160) {
        return json({ success: false,
          error: "SELLER_OS_AMAZON_SELLER_SKU_REQUIRED" }, 400)
      }
      const unitCostUsd = positiveNumber(body.unitCostUsd)
      const supplierInventoryQuantity = positiveNumber(
        body.supplierInventoryQuantity, true)
      if (unitCostUsd === null || supplierInventoryQuantity === null) {
        return json({ success: false,
          error: unitCostUsd === null
            ? "SELLER_OS_AMAZON_UNIT_COST_REQUIRED"
            : "SELLER_OS_AMAZON_SUPPLIER_QUANTITY_REQUIRED" }, 400)
      }
      let before = await readAmazonContributorPerformanceV1({
        supabase, limit: 100,
      })
      let card = before.cards.find((candidate) =>
        record(record(candidate.observation).amazonListing).sellerSku === sellerSku)
      if (!card) {
        const candidate = before.proposalInbox.find((row) =>
          row.seller_sku === sellerSku)
        if (!candidate) {
          return json({ success: false,
            error: "SELLER_OS_AMAZON_PROPOSAL_NOT_FOUND" }, 404)
        }
        const confirmed = await supabase
          .from("seller_os_amazon_contributor_sku_attribution_v1")
          .update({ attribution_basis: "OWNER_CONFIRMED", status: "ACTIVE" })
          .eq("id", candidate.id).eq("status", "PENDING_REVIEW")
          .select("id,seller_sku,attribution_basis,status").maybeSingle()
        if (confirmed.error || confirmed.data?.status !== "ACTIVE" ||
            confirmed.data?.attribution_basis !== "OWNER_CONFIRMED") {
          throw new Error("SELLER_OS_AMAZON_PROPOSAL_CONFIRMATION_FAILED")
        }
        await runSellerOsAmazonConnieAutomaticCaptureV1({ supabase })
        before = await readAmazonContributorPerformanceV1({
          supabase, limit: 100,
        })
        card = before.cards.find((candidateCard) =>
          record(record(candidateCard.observation).amazonListing).sellerSku ===
            sellerSku)
      }
      if (!card) {
        throw new Error("SELLER_OS_AMAZON_CONFIRMED_PROPOSAL_READBACK_FAILED")
      }
      const observation = linkAmazonContributorCostAndQuantityV1({
        existingObservation: card.observation,
        unitCostUsd, supplierInventoryQuantity,
        now: new Date(),
      })
      const persistence = await persistAmazonContributorObservationV1({
        supabase, recordedByUserId: auth.userId, observation,
      })
      const monitor = await readAmazonContributorPerformanceV1({
        supabase, limit: 100,
      })
      return json({ success: true, observation, persistence, monitor,
        connection: getAmazonSpApiReadOnlyConfigurationV1(),
        safety: { internalDatabaseWrites: true, amazonReadOnly: true,
          amazonWrites: 0, supplierPurchases: 0, publications: 0,
          repricing: 0 } })
    }
    if (body.action === "LINK_SUPPLIER_AND_COST") {
      const supabase = getSupabaseAdminClient()
      const sellerSku = typeof body.sellerSku === "string"
        ? body.sellerSku.trim() : ""
      const before = await readAmazonContributorPerformanceV1({
        supabase, limit: 100,
      })
      const card = before.cards.find((candidate) =>
        record(record(candidate.observation).amazonListing).sellerSku === sellerSku)
      if (!card) {
        return json({ success: false,
          error: "SELLER_OS_AMAZON_SELLER_SKU_NOT_FOUND" }, 404)
      }
      const observation = linkAmazonContributorSupplierCostV1({
        existingObservation: card.observation,
        supplier: record(body.supplier), economics: record(body.economics),
        unitsPurchased: body.unitsPurchased,
        otherActualCostsUsd: body.otherActualCostsUsd, now: new Date(),
      })
      const persistence = await persistAmazonContributorObservationV1({
        supabase, recordedByUserId: auth.userId, observation,
      })
      const monitor = await readAmazonContributorPerformanceV1({
        supabase, limit: 100,
      })
      return json({ success: true, observation, persistence, monitor,
        connection: getAmazonSpApiReadOnlyConfigurationV1(),
        safety: { internalDatabaseWrites: true, amazonWrites: 0,
          supplierPurchases: 0, publications: 0, repricing: 0 } })
    }
    if (body.action !== "CAPTURE_CONTRIBUTOR_PRODUCT_OBSERVATION") {
      return json({ success: false,
        error: "SELLER_OS_AMAZON_CONTRIBUTOR_ACTION_REQUIRED" }, 400)
    }
    const now = new Date()
    const observation = buildAmazonContributorObservationV1(
      body.observation, { now })
    const persistence = await persistAmazonContributorObservationV1({
      supabase: getSupabaseAdminClient(),
      recordedByUserId: auth.userId,
      observation,
    })
    const monitor = await readAmazonContributorPerformanceV1({
      supabase: getSupabaseAdminClient(), limit: 100,
    })
    return json({ success: true,
      contractVersion: SELLER_OS_AMAZON_CONTRIBUTOR_PERFORMANCE_V1,
      observation, persistence, monitor,
      safety: { internalDatabaseWrites: true, amazonWrites: 0,
        supplierPurchases: 0, publications: 0, repricing: 0 } })
  } catch (error) {
    return json({ success: false, error: publicAmazonErrorCode(error,
      "SELLER_OS_AMAZON_CONTRIBUTOR_CAPTURE_FAILED") }, 409)
  }
}
