export const runtime = "nodejs"
export const maxDuration = 60

import { NextResponse } from "next/server"

import {
  confirmTeoOwnerListingExperimentV1,
  evaluateTeoOwnerListingExperimentV1,
  loadTeoOwnerListingDashboardV1,
  startTeoOwnerListingExperimentV1,
  verifyTeoOwnerListingExperimentV1,
} from "@/lib/ebay/teo-owner-listing-experiment-service-v1"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message)
    ? message
    : "TEO_LISTING_WORKFLOW_FAILED"
}

async function ownerValidation(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return validation
  if (validation.authenticationMode !== "admin_user" || !validation.userId) {
    return {
      ok: false as const,
      status: 403,
      error: "owner_user_required",
      userId: null,
    }
  }
  return validation
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  try {
    const dashboard = await loadTeoOwnerListingDashboardV1(
      getSupabaseAdminClient(),
    )
    return NextResponse.json({ success: true, dashboard })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeError(error) },
      { status: 503 },
    )
  }
}

export async function POST(req: Request) {
  const validation = await ownerValidation(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "owner_user_required" },
      { status: validation.status || 403 },
    )
  }
  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json(
      { success: false, error: "TEO_REQUEST_JSON_INVALID" },
      { status: 400 },
    )
  }
  const action = typeof body.action === "string" ? body.action : ""
  const experimentId = typeof body.experimentId === "string"
    ? body.experimentId.trim()
    : ""
  const ebayItemId = typeof body.ebayItemId === "string"
    ? body.ebayItemId.trim()
    : ""
  try {
    const supabase = getSupabaseAdminClient()
    const result = action === "START_EXPERIMENT"
      ? await startTeoOwnerListingExperimentV1(supabase, { ebayItemId })
      : action === "CONFIRM_EXECUTED"
        ? await confirmTeoOwnerListingExperimentV1(supabase, {
          experimentId,
          ownerUserId: validation.userId,
          note: typeof body.note === "string" ? body.note : undefined,
        })
        : action === "VERIFY_READBACK"
          ? await verifyTeoOwnerListingExperimentV1(supabase, {
            experimentId,
            actorRole: "OWNER",
          })
          : action === "EVALUATE_RESULT"
            ? await evaluateTeoOwnerListingExperimentV1(supabase, {
              experimentId,
            })
            : null
    if (!result) {
      return NextResponse.json(
        { success: false, error: "TEO_ACTION_INVALID" },
        { status: 400 },
      )
    }
    return NextResponse.json({ success: true, result })
  } catch (error) {
    const code = safeError(error)
    const conflict = code === "TEO_LISTING_ALREADY_HAS_ACTIVE_EXPERIMENT" ||
      code === "TEO_ACTIONABLE_IMPROVEMENT_NOT_PROVEN" ||
      code === "TEO_PRICE_DECISION_EVIDENCE_REQUIRED"
    return NextResponse.json(
      { success: false, error: code },
      { status: conflict ? 409 : 502 },
    )
  }
}
