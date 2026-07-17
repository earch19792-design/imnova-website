export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import {
  approveListingGeneration,
  approveWinnerDecisionPackage,
  generateListingFactoryPackage,
  getOpenAiListingFactoryConfiguration,
} from "@/lib/ebay/ebay-openai-listing-factory-service"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

function response(payload: unknown, status = 200) {
  const result = NextResponse.json(payload, { status })
  result.headers.set("Cache-Control", "private, no-store, max-age=0")
  return result
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function string(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(code) ? code : "LISTING_FACTORY_REQUEST_FAILED"
}

async function admin(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || !validation.userId) return {
    error: response(
      { success: false, error: validation.error ?? "LISTING_FACTORY_HUMAN_ADMIN_REQUIRED" },
      validation.status || 403,
    ),
    actorId: "",
  }
  return { error: null, actorId: validation.userId }
}

export async function GET(req: Request) {
  const auth = await admin(req)
  if (auth.error) return auth.error
  return response({
    success: true,
    configuration: getOpenAiListingFactoryConfiguration(),
    safety: {
      serverSideOnly: true,
      secretsReturned: false,
      ebayWrites: 0,
      canPublish: false,
    },
  })
}

export async function POST(req: Request) {
  const auth = await admin(req)
  if (auth.error) return auth.error
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return response({ success: false, error: "LISTING_FACTORY_ACCOUNT_REQUIRED" }, 400)
  const length = Number(req.headers.get("content-length") ?? 0)
  if (length > 500_000) return response({ success: false, error: "LISTING_FACTORY_INPUT_TOO_LARGE" }, 413)
  try {
    const body = record(await req.json())
    const action = string(body.action)
    const supabase = getSupabaseAdminClient()
    if (action === "approve_decision_package") {
      const result = await approveWinnerDecisionPackage({
        supabase,
        accountKey,
        packageId: string(body.packageId),
        packageHash: string(body.packageHash),
        actorId: auth.actorId,
        confirmed: body.confirmed === true,
      })
      return response({ success: true, action, result })
    }
    if (action === "generate") {
      const result = await generateListingFactoryPackage({
        supabase,
        accountKey,
        packageId: string(body.packageId),
        packageHash: string(body.packageHash),
        context: record(body.context),
        adapterMode: body.adapterMode === "real" ? "real" : "fake",
      })
      return response({ success: true, action, result })
    }
    if (action === "approve_generation") {
      const result = await approveListingGeneration({
        supabase,
        accountKey,
        generationId: string(body.generationId),
        outputHash: string(body.outputHash),
        actorId: auth.actorId,
        confirmed: body.confirmed === true,
      })
      return response({ success: true, action, result })
    }
    return response({ success: false, error: "LISTING_FACTORY_ACTION_INVALID" }, 400)
  } catch (error) {
    return response({ success: false, error: safeCode(error) }, 400)
  }
}
