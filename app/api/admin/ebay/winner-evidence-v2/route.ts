export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import {
  createWinnerEvidenceDecisionPackage,
  readWinnerEvidenceDecisionPackage,
  winnerEvidencePreviewConfiguration,
} from "@/lib/ebay/ebay-winner-evidence-v2-service"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

function response(payload: unknown, status = 200) {
  const result = NextResponse.json(payload, { status })
  result.headers.set("Cache-Control", "private, no-store, max-age=0")
  return result
}

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(code) ? code : "WINNER_EVIDENCE_REQUEST_FAILED"
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || !validation.userId) return response(
    { success: false, error: validation.error ?? "WINNER_EVIDENCE_HUMAN_ADMIN_REQUIRED" },
    validation.status || 403,
  )
  const configuration = winnerEvidencePreviewConfiguration()
  const packageId = new URL(req.url).searchParams.get("packageId")?.trim() ?? ""
  if (packageId) {
    try {
      const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
      if (!accountKey) throw new Error("WINNER_EVIDENCE_ACCOUNT_SCOPE_REQUIRED")
      const result = await readWinnerEvidenceDecisionPackage(
        getSupabaseAdminClient(),
        packageId,
        accountKey,
      )
      return response({ success: true, ...result })
    } catch (error) {
      const code = safeCode(error)
      return response(
        { success: false, error: code },
        code === "WINNER_EVIDENCE_PACKAGE_NOT_FOUND" ? 404 : 400,
      )
    }
  }
  return response({
    success: true,
    configuration,
    sourcePolicy: {
      active: "EBAY_BROWSE_API",
      soldOrCompleted: "MARKETPLACE_INSIGHTS_IF_ENTITLED_OR_REVIEWED_IMPORT",
      visualEvidence: "STRUCTURED_OFFICIAL_METADATA_OR_HUMAN_REVIEWED_IMPORT_ONLY",
      scrapingAllowed: false,
      browserAutomationAllowed: false,
      competitorImageDownloadAllowed: false,
      competitorImageGenerativeInputAllowed: false,
    },
  })
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || !validation.userId) return response(
    { success: false, error: validation.error ?? "WINNER_EVIDENCE_HUMAN_ADMIN_REQUIRED" },
    validation.status || 403,
  )
  const length = Number(req.headers.get("content-length") ?? 0)
  if (length > 1_000_000) return response(
    { success: false, error: "WINNER_EVIDENCE_INPUT_TOO_LARGE" },
    413,
  )
  try {
    const body = record(await req.json())
    if (body.action !== "analyze") return response(
      { success: false, error: "WINNER_EVIDENCE_ACTION_INVALID" },
      400,
    )
    const input = record(body.input)
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) throw new Error("WINNER_EVIDENCE_ACCOUNT_SCOPE_REQUIRED")
    const result = await createWinnerEvidenceDecisionPackage(
      getSupabaseAdminClient(),
      {
        ...input,
        marketplaceAccountKey: accountKey,
      } as Parameters<typeof createWinnerEvidenceDecisionPackage>[1],
      {
        useOfficialRead: body.useOfficialRead === true,
        persist: body.persist !== false,
      },
    )
    return response({ success: true, ...result })
  } catch (error) {
    return response({ success: false, error: safeCode(error) }, 400)
  }
}
