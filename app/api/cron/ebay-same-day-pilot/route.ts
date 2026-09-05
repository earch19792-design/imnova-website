export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { previewSameDayPilot, processSameDayPilotJobChain } from "@/lib/ebay/ebay-same-day-pilot-service"
import { getListingImageFactoryConfiguration } from "@/lib/ebay/ebay-listing-image-factory"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { sellerOsPostOnlyGetResponseV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"

function authorized(request: Request, validateOnly: boolean) {
  const providedHeaders = [
    request.headers.get("authorization"),
    // Vercel Deployment Protection can reserve Authorization for its own
    // identity. Keep the same shared-secret contract on a dedicated Preview
    // header so protected cron execution remains possible.
    request.headers.get("x-ebay-same-day-authorization"),
  ].map((value) => value?.trim() ?? "").filter(Boolean)
  const secrets = [process.env.EBAY_SAME_DAY_PILOT_CRON_SECRET,
    ...(validateOnly ? [process.env.CRON_SECRET] : [])]
    .map((value) => value?.trim() ?? "").filter(Boolean)
  return providedHeaders.some((providedHeader) => secrets.some((secret) => {
    const provided = Buffer.from(providedHeader)
    const expected = Buffer.from(`Bearer ${secret}`)
    return expected.length === provided.length &&
      timingSafeEqual(expected, provided)
  }))
}

async function authorizedBySchedulerVault(
  request: Request,
  supabase: SupabaseClient,
) {
  const authorizationHashes = [
    request.headers.get("authorization"),
    request.headers.get("x-ebay-same-day-authorization"),
  ].map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .map((value) => createHash("sha256").update(value).digest("hex"))
  if (!authorizationHashes.length) return false
  const { data, error } = await supabase.rpc(
    "verify_same_day_pilot_staging_worker_authorization",
    { p_authorization_sha256_values: authorizationHashes },
  )
  return !error && data === true
}

export async function POST(req: Request) {
  try {
    const validationMode = new URL(req.url).searchParams.get("mode") === "validate"
    const supabase = getSupabaseAdminClient()
    const environmentAuthorized = authorized(req, validationMode)
    const schedulerVaultAuthorized = environmentAuthorized
      ? false
      : await authorizedBySchedulerVault(req, supabase)
    if (!environmentAuthorized && !schedulerVaultAuthorized) {
      return NextResponse.json({
        success: false,
        error: "CRON_UNAUTHORIZED",
        diagnostics: {
          authorizationHeaderPresent: Boolean(
            req.headers.get("authorization")?.trim(),
          ),
          alternateAuthorizationHeaderPresent: Boolean(
            req.headers.get("x-ebay-same-day-authorization")?.trim(),
          ),
          sameDaySecretConfigured: Boolean(
            process.env.EBAY_SAME_DAY_PILOT_CRON_SECRET?.trim(),
          ),
          validationSecretConfigured: validationMode && Boolean(
            process.env.CRON_SECRET?.trim(),
          ),
          schedulerVaultAuthorized: false,
          secretsReturned: false,
        },
      }, { status: 401 })
    }
    if (process.env.VERCEL_ENV !== "preview") return NextResponse.json({ success: true, status: "disabled", safety: { previewOnly: true, ebayWrites: 0, productionChanged: false } })
    if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes("vsfthqydfrdzulldbfbe")) {
      return NextResponse.json({ success: false, error: "SAME_DAY_PILOT_STAGING_DATABASE_REQUIRED" }, { status: 503 })
    }
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) return NextResponse.json({ success: false, error: "SAME_DAY_PILOT_ACCOUNT_SCOPE_REQUIRED" }, { status: 503 })
    if (validationMode) {
      const preview = await previewSameDayPilot({ supabase, accountKey })
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
    const result = await processSameDayPilotJobChain({ supabase, accountKey,
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

export function GET() {
  return sellerOsPostOnlyGetResponseV1()
}
