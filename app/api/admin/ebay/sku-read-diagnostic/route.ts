export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { inspectEbayDraftSkuState } from
  "@/lib/ebay/ebay-draft-only-gateway"
import { canonicalEbayPackageSku } from "@/lib/ebay/ebay-sku"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

const LISTING_PACKAGE_ID = "34608f12-b90c-4241-ac11-3b86d20f0a3e"

function safeCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_:-]+$/.test(value)
    ? value
    : "EBAY_SKU_READ_DIAGNOSTIC_FAILED"
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || validation.authenticationMode !== "service_role") {
    return NextResponse.json({
      success: false,
      error: validation.error ?? "service_role_required",
    }, { status: validation.status || 403 })
  }

  try {
    const canonical = canonicalEbayPackageSku(LISTING_PACKAGE_ID)
    const compactPackageId = LISTING_PACKAGE_ID
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
    const candidates = [
      { name: "CURRENT_CANONICAL_38", sku: canonical },
      {
        name: "IMNOVA_PREFIX_TOTAL_32",
        sku: `IMNOVA${compactPackageId.slice(0, 26)}`,
      },
      {
        name: "IMNOVA_PREFIX_TOTAL_30",
        sku: `IMNOVA${compactPackageId.slice(0, 24)}`,
      },
      {
        name: "PACKAGE_ID_ALPHANUMERIC_32",
        sku: compactPackageId,
      },
      {
        name: "IMNOVA_PREFIX_TOTAL_22",
        sku: `IMNOVA${compactPackageId.slice(0, 16)}`,
      },
    ]
    const results = []
    for (const candidate of candidates) {
      const result = await inspectEbayDraftSkuState(candidate.sku)
      results.push({
        name: candidate.name,
        skuLength: candidate.sku.length,
        alphanumeric: /^[A-Z0-9]+$/.test(candidate.sku),
        safe: result.safe,
        collision: result.collision,
        blocker: result.blocker,
        inventoryHttpStatus: result.inventoryHttpStatus,
        offersHttpStatus: result.offersHttpStatus,
        inventoryErrorIds: result.inventoryErrorIds,
        offersErrorIds: result.offersErrorIds,
        inventoryErrors: result.inventoryErrors,
        offersErrors: result.offersErrors,
        offerResponseShape: result.offerResponseShape,
      })
    }
    return NextResponse.json({
      success: true,
      results,
      safety: {
        methods: ["GET"],
        inventoryItemCreated: false,
        offerCreated: false,
        publishOfferCalled: false,
        ebayInventoryWrites: 0,
        productionChanged: false,
      },
    }, {
      status: 200,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: safeCode(error),
      safety: {
        inventoryItemCreated: false,
        offerCreated: false,
        publishOfferCalled: false,
        ebayInventoryWrites: 0,
        productionChanged: false,
      },
    }, {
      status: 409,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  }
}
