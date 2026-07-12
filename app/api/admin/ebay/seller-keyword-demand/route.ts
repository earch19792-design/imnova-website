export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { validateAdminApiRequest } from "@/lib/supabase-admin"
import { runEbaySellerKeywordDemandValidation } from "@/lib/ebay/ebay-seller-keyword-demand-gateway"

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message)
    ? message
    : "EBAY_READONLY_MARKET_VALIDATION_FAILED"
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 }
    )
  }

  try {
    const raw = await req.json() as Record<string, unknown>
    const candidate = {
      productName: text(raw.productName, 240),
      productTitle: text(raw.productTitle, 240),
      variantTitle: text(raw.variantTitle, 160),
      supplierSku: text(raw.supplierSku, 100),
      categoryId: text(raw.categoryId, 20),
    }
    if (!candidate.productName && !candidate.productTitle) {
      return NextResponse.json(
        { success: false, error: "EBAY_CANDIDATE_NAME_REQUIRED" },
        { status: 400 }
      )
    }

    const report = await runEbaySellerKeywordDemandValidation(candidate)
    return NextResponse.json({
      success: true,
      report,
      safety: {
        mode: "EBAY_OFFICIAL_READ_ONLY",
        ebayWriteUsed: false,
        supabaseWriteUsed: false,
        tokenReturnedToBrowser: false,
        imagesCopied: false,
        canPublish: false,
      },
    })
  } catch (error) {
    const code = safeErrorCode(error)
    const status = code === "EBAY_READONLY_ENV_MISSING" ? 503 : 502
    return NextResponse.json(
      { success: false, error: code },
      { status }
    )
  }
}
