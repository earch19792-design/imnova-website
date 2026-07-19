export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { randomUUID, timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { previewSameDayPilot, processSameDayPilotJobChain } from "@/lib/ebay/ebay-same-day-pilot-service"
import { getListingImageFactoryConfiguration } from "@/lib/ebay/ebay-listing-image-factory"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function authorized(request: Request, validateOnly: boolean) {
  const provided = Buffer.from(request.headers.get("authorization") ?? "")
  const secrets = [process.env.EBAY_SAME_DAY_PILOT_CRON_SECRET,
    ...(validateOnly ? [process.env.CRON_SECRET] : [])]
    .map((value) => value?.trim() ?? "").filter(Boolean)
  return secrets.some((secret) => {
    const expected = Buffer.from(`Bearer ${secret}`)
    return expected.length === provided.length && timingSafeEqual(expected, provided)
  })
}

export async function GET(req: Request) {
  try {
    const validationMode = new URL(req.url).searchParams.get("mode") === "validate"
    if (!authorized(req, validationMode)) return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" }, { status: 401 })
    if (process.env.VERCEL_ENV !== "preview") return NextResponse.json({ success: true, status: "disabled", safety: { previewOnly: true, ebayWrites: 0, productionChanged: false } })
    if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes("vsfthqydfrdzulldbfbe")) {
      return NextResponse.json({ success: false, error: "SAME_DAY_PILOT_STAGING_DATABASE_REQUIRED" }, { status: 503 })
    }
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) return NextResponse.json({ success: false, error: "SAME_DAY_PILOT_ACCOUNT_SCOPE_REQUIRED" }, { status: 503 })
    if (validationMode) {
      const preview = await previewSameDayPilot({ supabase: getSupabaseAdminClient(), accountKey })
      const imageFactory = getListingImageFactoryConfiguration()
      return NextResponse.json({
        success: true,
        mode: "STAGING_READONLY_VALIDATION",
        observedAt: preview.observedAt,
        counts: preview.counts,
        exactVerificationLane: preview.exactVerificationLane,
        candidates: preview.selected.map((candidate, index) => ({
          ordinal: index + 1,
          productTitle: candidate.productTitle,
          supplierSku: candidate.supplierSku,
          state: candidate.state,
          blockers: candidate.blockers,
          queryPlan: candidate.queryPlan,
          localPackagePrepared: true,
        })),
        packages: preview.localPreparationPackages,
        safety: preview.safety,
        imageFactory,
      })
    }
    if (process.env.EBAY_SAME_DAY_PILOT_PREVIEW_WORKER_ENABLED !== "true") {
      const imageFactory = getListingImageFactoryConfiguration()
      return NextResponse.json({ success: true, status: "disabled", reason: "SAME_DAY_PILOT_PREVIEW_WORKER_DISABLED",
        imageFactory,
        safety: { previewOnly: true, ebayWrites: 0, openAiCalls: 0, productionChanged: false } })
    }
    const result = await processSameDayPilotJobChain({ supabase: getSupabaseAdminClient(), accountKey,
      workerId: `same-day:${randomUUID()}`, maximumJobs: 30, maximumDurationMs: 240_000 })
    const imageFactory = getListingImageFactoryConfiguration()
    return NextResponse.json({ success: true, result, imageFactory,
      safety: { recursiveHttp: false, ebayWrites: 0, productionChanged: false } })
  } catch (error) {
    const rawCode = error instanceof Error ? error.message : ""
    const code = /^[A-Z0-9_]+$/.test(rawCode) ? rawCode : "SAME_DAY_PILOT_WORKER_FAILED"
    return NextResponse.json({ success: false, error: code,
      safety: { secretsDisplayed: false, ebayWrites: 0, productionChanged: false } }, { status: 500 })
  }
}
