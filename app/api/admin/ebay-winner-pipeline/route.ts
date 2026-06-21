export const runtime = "nodejs"

import { NextResponse } from "next/server"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"
import {
  processRadarCandidate,
} from "@/lib/ebay-winner-pipeline/core.mjs"
import {
  processRadarCandidateWithPersistence,
  recordCandidateDecision,
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

    const action =
      body.action ||
      "process_radar_candidate"

    if (action === "process_radar_candidate") {
      if (!body.radarProduct) {
        return NextResponse.json(
          {
            success: false,
            error: "radar_product_required",
          },
          {
            status: 400,
          }
        )
      }

      if (body.persist === true) {
        const supabase =
          getSupabaseAdminClient()

        const result =
          await processRadarCandidateWithPersistence({
            supabase,
            radarProduct:
              body.radarProduct,
            config:
              body.config || {},
          })

        return NextResponse.json({
          success: true,
          dryRun: true,
          result,
        })
      }

      const result =
        processRadarCandidate(
          body.radarProduct,
          body.config || {}
        )

      return NextResponse.json({
        success: true,
        dryRun: true,
        result,
      })
    }

    if (action === "record_decision") {
      const supabase =
        getSupabaseAdminClient()

      const result =
        await recordCandidateDecision({
          supabase,
          candidateId:
            body.candidateId,
          candidateKey:
            body.candidateKey,
          action:
            body.decision,
          messageId:
            body.messageId,
          decidedBy:
            body.decidedBy ||
            "admin",
          payload:
            body.payload || {},
        })

      return NextResponse.json({
        success: true,
        dryRun: true,
        result,
      })
    }

    return NextResponse.json(
      {
        success: false,
        error: "unsupported_action",
      },
      {
        status: 400,
      }
    )
  } catch (error) {
    console.error(
      "EBAY WINNER PIPELINE ERROR:",
      error
    )

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "ebay_winner_pipeline_failed",
      },
      {
        status: 500,
      }
    )
  }
}
