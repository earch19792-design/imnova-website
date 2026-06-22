export const runtime = "nodejs"

import { NextResponse } from "next/server"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"
import {
  getEbayWinnerAdminDashboard,
  getEbayWinnerCandidateDetail,
} from "@/lib/ebay-winner-pipeline/admin-read-service.mjs"

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

function getNumberParam(
  searchParams: URLSearchParams,
  key: string,
  fallback: number
) {
  const value =
    Number(
      searchParams.get(key)
    )

  return Number.isFinite(value)
    ? value
    : fallback
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

    const candidateId =
      url.searchParams.get("candidateId") ||
      ""

    const supabase =
      getSupabaseAdminClient()

    if (candidateId) {
      const detail =
        await getEbayWinnerCandidateDetail({
          supabase,
          candidateId,
        })

      return NextResponse.json({
        success: true,
        dryRunOnly: true,
        detail,
      })
    }

    const dashboard =
      await getEbayWinnerAdminDashboard({
        supabase,
        page:
          getNumberParam(
            url.searchParams,
            "page",
            0
          ),
        limit:
          getNumberParam(
            url.searchParams,
            "limit",
            25
          ),
        filters: {
          state:
            url.searchParams.get("state") ||
            "",
          complianceStatus:
            url.searchParams.get("complianceStatus") ||
            "",
          draftStatus:
            url.searchParams.get("draftStatus") ||
            "",
          search:
            url.searchParams.get("search") ||
            "",
        },
      })

    return NextResponse.json({
      success: true,
      dryRunOnly: true,
      dashboard,
    })
  } catch (error) {
    console.error(
      "EBAY WINNER ADMIN READ ERROR:",
      error
    )

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "ebay_winner_admin_read_failed",
      },
      {
        status: 500,
      }
    )
  }
}
