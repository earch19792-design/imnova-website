export const runtime = "nodejs"

import { NextResponse } from "next/server"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"
import {
  getActiveListingRiskSummary,
  getOpenActiveListingRisks,
  getRisksByEbaySku,
  getRisksBySupplierSku,
} from "@/lib/ebay-winner-pipeline/active-listing-risk-read-service.mjs"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"

const DEFAULT_LIMIT =
  25

const MAX_LIMIT =
  100

function createUnauthorizedResponse(
  error: string,
  status: number
) {
  return NextResponse.json(
    {
      success: false,
      error,
    },
    {
      status,
    }
  )
}

async function validateAdmin(
  req: Request
) {
  const validation =
    await validateAdminApiRequest(req)

  if (!validation.ok) {
    return createUnauthorizedResponse(
      validation.error ||
        "admin_validation_failed",
      validation.status || 403
    )
  }

  return null
}

function getQueryFlag(
  searchParams: URLSearchParams,
  key: string
) {
  const value =
    searchParams.get(key)

  return (
    value === "true" ||
    value === "1"
  )
}

function getCleanQueryValue(
  searchParams: URLSearchParams,
  key: string
) {
  return (
    searchParams.get(key)?.trim() ||
    ""
  )
}

function getLimitParam(
  searchParams: URLSearchParams
) {
  const rawLimit =
    searchParams.get("limit")

  if (!rawLimit) {
    return {
      ok: true,
      limit:
        DEFAULT_LIMIT,
    }
  }

  const numericLimit =
    Number(rawLimit)

  if (
    !Number.isInteger(numericLimit) ||
    numericLimit <= 0
  ) {
    return {
      ok: false,
      error:
        "active_listing_risk_invalid_limit",
    }
  }

  return {
    ok: true,
    limit:
      Math.min(
        numericLimit,
        MAX_LIMIT
      ),
  }
}

function createBadRequestResponse(
  error: string
) {
  return NextResponse.json(
    {
      success: false,
      error,
    },
    {
      status:
        400,
    }
  )
}

function getSafeErrorMessage(
  error: unknown
) {
  const message =
    error instanceof Error
      ? error.message
      : ""

  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/apikey=[^&\s]+/gi, "apikey=[redacted]")
    .slice(0, 160) ||
    "active_listing_risk_admin_read_failed"
}

export async function GET(
  req: Request
) {
  const unauthorizedResponse =
    await validateAdmin(req)

  if (unauthorizedResponse) {
    return unauthorizedResponse
  }

  try {
    const url =
      new URL(req.url)

    const limitResult =
      getLimitParam(
        url.searchParams
      )

    if (!limitResult.ok) {
      return createBadRequestResponse(
        limitResult.error ||
          "active_listing_risk_invalid_query"
      )
    }

    const summary =
      getQueryFlag(
        url.searchParams,
        "summary"
      )

    const sku =
      getCleanQueryValue(
        url.searchParams,
        "sku"
      )

    const supplierSku =
      getCleanQueryValue(
        url.searchParams,
        "supplierSku"
      )

    if (
      summary &&
      (sku || supplierSku)
    ) {
      return createBadRequestResponse(
        "active_listing_risk_ambiguous_query"
      )
    }

    if (
      sku &&
      supplierSku
    ) {
      return createBadRequestResponse(
        "active_listing_risk_ambiguous_query"
      )
    }

    const supabase =
      getSupabaseAdminClient()
    const accountScope =
      getEbaySellerAccountScopeConfiguration()

    if (!accountScope.accountKey) {
      return NextResponse.json(
        {
          success: false,
          error: "active_listing_account_scope_required",
          accountScopeReason: accountScope.reason,
        },
        {
          status: 503,
        }
      )
    }
    const accountKey =
      accountScope.accountKey

    if (summary) {
      const riskSummary =
        await getActiveListingRiskSummary({
          supabase,
          accountKey,
        })

      return NextResponse.json({
        success: true,
        dryRunOnly: true,
        mode:
          "summary",
        summary:
          riskSummary,
      })
    }

    if (sku) {
      const risks =
        await getRisksByEbaySku({
          supabase,
          accountKey,
          sku,
          limit:
            limitResult.limit,
        })

      return NextResponse.json({
        success: true,
        dryRunOnly: true,
        mode:
          "ebay_sku",
        limit:
          limitResult.limit,
        risks,
      })
    }

    if (supplierSku) {
      const risks =
        await getRisksBySupplierSku({
          supabase,
          accountKey,
          supplierSku,
          limit:
            limitResult.limit,
        })

      return NextResponse.json({
        success: true,
        dryRunOnly: true,
        mode:
          "supplier_sku",
        limit:
          limitResult.limit,
        risks,
      })
    }

    const risks =
      await getOpenActiveListingRisks({
        supabase,
        accountKey,
        limit:
          limitResult.limit,
      })

    return NextResponse.json({
      success: true,
      dryRunOnly: true,
      mode:
        "open",
      limit:
        limitResult.limit,
      risks,
    })
  } catch (error) {
    console.error(
      "ACTIVE LISTING RISK ADMIN READ ERROR:",
      getSafeErrorMessage(error)
    )

    return NextResponse.json(
      {
        success: false,
        error:
          getSafeErrorMessage(error),
      },
      {
        status:
          500,
      }
    )
  }
}
