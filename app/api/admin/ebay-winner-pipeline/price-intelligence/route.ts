export const runtime = "nodejs"

import { NextResponse } from "next/server"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"
import {
  createPriceIntelligenceSnapshot,
  listPriceIntelligenceSnapshots,
} from "@/lib/ebay-winner-pipeline/price-intelligence-service.mjs"

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

async function readJson(req: Request) {
  const text =
    await req.text()

  if (!text) {
    return {}
  }

  return JSON.parse(text)
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

    const supabase =
      getSupabaseAdminClient()

    const result =
      await listPriceIntelligenceSnapshots({
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
          supplierSku:
            url.searchParams.get("supplierSku") ||
            "",
          candidateId:
            url.searchParams.get("candidateId") ||
            "",
        },
      })

    return NextResponse.json({
      success: true,
      dryRunOnly: true,
      ...result,
    })
  } catch (error) {
    console.error(
      "PRICE INTELLIGENCE READ ERROR:",
      error
    )

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "price_intelligence_read_failed",
      },
      {
        status: 500,
      }
    )
  }
}

export async function POST(
  req: Request
) {
  const unauthorizedResponse =
    await validateAdmin(req)

  if (unauthorizedResponse) {
    return unauthorizedResponse
  }

  try {
    const body =
      await readJson(req)

    const supabase =
      getSupabaseAdminClient()

    const snapshot =
      await createPriceIntelligenceSnapshot({
        supabase,
        input:
          body,
        actor:
          "admin",
      })

    return NextResponse.json({
      success: true,
      dryRunOnly: true,
      snapshot,
    })
  } catch (error) {
    console.error(
      "PRICE INTELLIGENCE WRITE ERROR:",
      error
    )

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "price_intelligence_write_failed",
      },
      {
        status: 500,
      }
    )
  }
}
