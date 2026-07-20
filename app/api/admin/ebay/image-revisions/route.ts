export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import {
  generateAndPersistSameDayImageRevision,
  getSameDayImageRevision,
  reviewSameDayImageRevision,
} from "@/lib/ebay/ebay-same-day-image-revision-runtime"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

function uuid(value: unknown) {
  const normalized = text(value, 40)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_:.-]+$/.test(message)
    ? message
    : "SAME_DAY_IMAGE_REVISION_REQUEST_FAILED"
}

function errorStatus(code: string) {
  if (/NOT_FOUND/.test(code)) return 404
  if (/INVALID|REQUIRED|MISSING/.test(code)) return 400
  if (/CONFLICT|BUSY|NOT_APPROVED|NOT_REVIEWABLE|BLOCKED|LEASE/.test(code)) return 409
  return 502
}

async function authorization(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok || !auth.userId) {
    return {
      response: NextResponse.json(
        { success: false, error: auth.error ?? "admin_forbidden" },
        { status: auth.status || 403 },
      ),
    }
  }
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) {
    return {
      response: NextResponse.json(
        { success: false, error: "SAME_DAY_IMAGE_REVISION_ACCOUNT_REQUIRED" },
        { status: 503 },
      ),
    }
  }
  return { auth, accountKey, supabase: getSupabaseAdminClient() }
}

export async function GET(req: Request) {
  const access = await authorization(req)
  if ("response" in access) return access.response
  try {
    const revisionId = uuid(new URL(req.url).searchParams.get("revisionId"))
    if (!revisionId) {
      return NextResponse.json(
        { success: false, error: "SAME_DAY_IMAGE_REVISION_ID_REQUIRED" },
        { status: 400 },
      )
    }
    const result = await getSameDayImageRevision({
      supabase: access.supabase,
      accountKey: access.accountKey,
      actorId: access.auth.userId,
      revisionId,
    })
    return NextResponse.json({
      success: true,
      ...result,
      safety: { ebayWrites: 0, productionChanged: false },
    })
  } catch (error) {
    const code = safeError(error)
    return NextResponse.json({ success: false, error: code }, { status: errorStatus(code) })
  }
}

export async function POST(req: Request) {
  const access = await authorization(req)
  if ("response" in access) return access.response
  try {
    const body = await req.json() as Record<string, unknown>
    if (body.action === "generate") {
      const baseControlId = uuid(body.baseControlId)
      const requestKey = body.requestKey == null ? undefined : uuid(body.requestKey)
      if (!baseControlId || (body.requestKey != null && !requestKey)) {
        return NextResponse.json(
          { success: false, error: "SAME_DAY_IMAGE_REVISION_GENERATE_INVALID" },
          { status: 400 },
        )
      }
      const generated = await generateAndPersistSameDayImageRevision({
        supabase: access.supabase,
        accountKey: access.accountKey,
        actorId: access.auth.userId,
        baseControlId,
        requestKey,
      })
      const revisionId = uuid(
        "revisionId" in generated ? generated.revisionId : generated.revision.id,
      )
      const result = revisionId
        ? await getSameDayImageRevision({
          supabase: access.supabase,
          accountKey: access.accountKey,
          actorId: access.auth.userId,
          revisionId,
        })
        : generated
      return NextResponse.json({
        success: true,
        ...result,
        safety: {
          exactSixHumanReviewRequired: true,
          ebayWrites: 0,
          productionChanged: false,
        },
      })
    }
    if (body.action === "review") {
      const revisionId = uuid(body.revisionId)
      const decision = body.decision === "APPROVE" || body.decision === "REJECT"
        ? body.decision
        : null
      if (!revisionId || !decision || body.confirmed !== true) {
        return NextResponse.json(
          { success: false, error: "SAME_DAY_IMAGE_REVISION_REVIEW_INVALID" },
          { status: 400 },
        )
      }
      const reviewed = await reviewSameDayImageRevision({
        supabase: access.supabase,
        accountKey: access.accountKey,
        actorId: access.auth.userId,
        revisionId,
        decision,
      })
      return NextResponse.json({
        success: true,
        reviewed,
        safety: { ebayWrites: 0, productionChanged: false },
      })
    }
    return NextResponse.json(
      { success: false, error: "SAME_DAY_IMAGE_REVISION_ACTION_INVALID" },
      { status: 400 },
    )
  } catch (error) {
    const code = safeError(error)
    return NextResponse.json({ success: false, error: code }, { status: errorStatus(code) })
  }
}
