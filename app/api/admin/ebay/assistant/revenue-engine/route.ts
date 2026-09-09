export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60
import { NextResponse } from "next/server"
import { getSupabaseAdminClient, validateSellerOsApiRequest } from "@/lib/supabase-admin"
import { SELLER_OS_ACCESS_ROLES } from "@/lib/seller-os-access-control"
import { isSameSellerOsAdminOriginV1 } from "@/lib/admin-session-origin-v1"
import { getEbayProRuntimeBoundary } from "@/lib/ebay/environment-boundaries"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { loadSellerOsAssistantMonitorSnapshotV1 } from "@/lib/ebay/ebay-seller-os-assistant-runtime"
import { readMayelListingSelectionV1 } from "@/lib/seller-os/mayel-listing-selection-v1"
import { readListingTreatmentsV1, prepareTreatmentPreviewV1, persistTreatmentSimulationReceiptV1, measureLatestTreatmentV1 } from "@/lib/seller-os/listing-treatment-runtime-v1"
import { METRIC_WINDOWS, type MetricWindow, type PromotionPolicy } from "@/lib/seller-os/listing-treatment-engine-v1"
import { revenueTraceIdV1 } from "@/lib/seller-os/revenue-first-diagnostics-v1"

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } })
async function authorize(request: Request) {
  if (getEbayProRuntimeBoundary({ pathname: new URL(request.url).pathname, method: request.method }).runtime !== "seller_os_dedicated_preprod") return false
  if (!isSameSellerOsAdminOriginV1({ requestUrl: request.url, origin: request.headers.get("origin"), secFetchSite: request.headers.get("sec-fetch-site") })) return false
  const auth = await validateSellerOsApiRequest(request)
  return auth.ok && auth.authenticationMode === "seller_os_user" && auth.accessRole && auth.userId ? auth : false
}
export async function GET(request: Request) {
  const traceId = revenueTraceIdV1(request.headers.get("x-seller-os-trace-id"))
  if (!await authorize(request)) return reply({ success: false, error: "REVENUE_OWNER_PREPROD_REQUIRED", traceId }, 403)
  try {
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) throw Error("REVENUE_ACCOUNT_REQUIRED")
    const selection = await readMayelListingSelectionV1({ supabase: getSupabaseAdminClient(), accountKey,
      after: new URL(request.url).searchParams.get("after") ?? undefined })
    return reply({ success: true, ...selection, traceId,
      timeZone: process.env.SELLER_OS_MARKETPLACE_TIMEZONE?.trim() || null })
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]{3,120}$/.test(error.message) ? error.message : "LISTING_SELECTION_READ_FAILED"
    return reply({ success: false, error: code, traceId }, code.includes("INVALID") ? 400 : 503)
  }
}
export async function POST(request: Request) {
  const traceId = revenueTraceIdV1(request.headers.get("x-seller-os-trace-id"))
  const auth = await authorize(request)
  if (!auth) return reply({ error: "REVENUE_OWNER_PREPROD_REQUIRED", traceId }, 403)
  try {
    const raw = await request.text()
    if (raw.length > 12000) return reply({ error: "REVENUE_INPUT_TOO_LARGE", traceId }, 413)
    const body = JSON.parse(raw)
    if (!body || Object.keys(body).some(k => !["mode", "itemIds", "policy", "window", "idempotencyKey"].includes(k)) ||
      !["ANALYZE", "PREVIEW", "SIMULATE", "RECEIPT", "MEASURE", "IMAGE"].includes(body.mode) || !Array.isArray(body.itemIds) ||
      !METRIC_WINDOWS.includes(body.window)) throw Error("REVENUE_INPUT_INVALID")
    if (["RECEIPT", "IMAGE"].includes(body.mode) && auth.accessRole !== SELLER_OS_ACCESS_ROLES.owner)
      return reply({ success: false, error: "REVENUE_OWNER_ACTION_REQUIRED", traceId }, 403)
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) throw Error("REVENUE_ACCOUNT_REQUIRED")
    const input = { supabase: getSupabaseAdminClient(), accountKey,
      monitor: await loadSellerOsAssistantMonitorSnapshotV1(), itemIds: body.itemIds as string[],
      policy: body.policy as PromotionPolicy, window: body.window as MetricWindow }
    const result = body.mode === "PREVIEW" ? await prepareTreatmentPreviewV1({ ...input, traceId }) : await readListingTreatmentsV1(input)
    if (body.mode === "IMAGE") {
      if (result.rows.length !== 1) throw Error("IMAGE_SINGLE_LISTING_REQUIRED")
      const { prepareTreatmentImageV1 } = await import("@/lib/seller-os/listing-treatment-image-v1")
      const image = await prepareTreatmentImageV1({ supabase: input.supabase, accountKey, monitor: input.monitor,
        treatment: result.rows[0], actorId: auth.userId!, traceId, apiKey: process.env.OPENAI_API_KEY?.trim() ?? "" })
      const path = image.variants[0]?.outputStoragePath
      const asset = typeof path === "string" ? await input.supabase.storage.from("ebay-listing-image-staging").createSignedUrl(path, 300) : null
      return reply({ success: true, result, image, imagePreviewUrl: asset?.data?.signedUrl ?? null, traceId })
    }
    const receipts = []
    if (body.mode === "RECEIPT") for (const itemId of input.itemIds) receipts.push(await persistTreatmentSimulationReceiptV1({
      supabase: input.supabase, accountKey, itemId, idempotencyKey: body.idempotencyKey, result }))
    const measurements = []
    if (body.mode === "MEASURE") for (const row of result.rows) measurements.push(await measureLatestTreatmentV1({ supabase: input.supabase, accountKey, row, window: input.window }))
    return reply({ success: true, result, receipts, measurements, traceId })
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]{3,120}$/.test(error.message) ? error.message : "REVENUE_REQUEST_FAILED"
    return reply({ success: false, error: code, traceId }, code.includes("FAILED") ? 503 : 400)
  }
}
