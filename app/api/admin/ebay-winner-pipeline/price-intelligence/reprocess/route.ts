export const runtime = "nodejs"

import { NextResponse } from "next/server"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"
import {
  reprocessCandidateWithPriceIntelligence,
  reprocessCandidateWithSuggestedPrice,
} from "@/lib/ebay-winner-pipeline/service.mjs"

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

function getErrorStatus(error: unknown) {
  if (!(error instanceof Error)) {
    return 500
  }

  return [
    "candidate_identifier_required",
    "candidate_not_found",
    "price_intelligence_snapshot_not_found",
    "price_intelligence_missing_recommended_price",
    "price_intelligence_snapshot_mismatch",
    "suggested_target_price_required",
    "suggested_target_price_requires_market_evidence",
    "suggested_target_price_not_competitive",
  ].includes(error.message)
    ? 400
    : 500
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

    const isSuggestedPriceReprocess =
      body.action ===
        "reprocess_with_suggested_price" ||
      body.suggestedTargetPrice !== undefined

    const result =
      isSuggestedPriceReprocess
        ? await reprocessCandidateWithSuggestedPrice({
            supabase,
            candidateId:
              body.candidateId,
            supplierSku:
              body.supplierSku,
            candidateKey:
              body.candidateKey,
            suggestedTargetPrice:
              body.suggestedTargetPrice,
            actor:
              "admin",
          })
        : await reprocessCandidateWithPriceIntelligence({
            supabase,
            candidateId:
              body.candidateId,
            supplierSku:
              body.supplierSku,
            candidateKey:
              body.candidateKey,
            priceIntelligenceSnapshotId:
              body.priceIntelligenceSnapshotId,
            actor:
              "admin",
          })

    return NextResponse.json({
      success: true,
      dryRunOnly: true,
      action:
        isSuggestedPriceReprocess
          ? "reprocess_with_suggested_price"
          : "reprocess_with_price_intelligence",
      result,
    })
  } catch (error) {
    console.error(
      "PRICE INTELLIGENCE REPROCESS ERROR:",
      error
    )

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "price_intelligence_reprocess_failed",
      },
      {
        status:
          getErrorStatus(error),
      }
    )
  }
}
