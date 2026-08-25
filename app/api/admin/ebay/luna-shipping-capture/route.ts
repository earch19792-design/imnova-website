export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import {
  authorizeListingAiRequest,
  enforceListingAiRouteRateLimit,
  listingAiFailure,
  listingAiJson,
  listingAiRecord,
  listingAiResponse,
} from "@/lib/ebay/ebay-listing-ai-api"
import {
  type LunaShippingCapturePostV1,
  type LunaShippingRuntimeTraceEventV1,
} from "@/lib/ebay/ebay-luna-chrome-shipping-capture-v1"
import {
  persistLunaChromeShippingCaptureV1,
  persistLunaShippingRuntimeTraceV1,
  readLatestLunaShippingRuntimeTraceV1,
  resolveLunaChromeShippingJobsV1,
} from
  "@/lib/ebay/ebay-luna-chrome-shipping-capture-server-v1"
import {
  persistProductFitStrongPromotionV1,
  type SellerOsProductFitStrongRevalidationV1,
} from "@/lib/ebay/ebay-product-fit-durable-promotion-v1"

function candidateIds(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim()).filter(Boolean).slice(0, 20)
}

function sessionSecret() {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ""
  if (value.length < 32) throw new Error("LUNA_SHIPPING_CAPTURE_SESSION_SECRET_MISSING")
  return value
}

export async function POST(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    const body = await listingAiJson(req)
    if (body.action === "resolve_jobs") {
      enforceListingAiRouteRateLimit(auth.actorId, "READ")
      const requested = candidateIds(body.candidateIds)
      const jobs = await resolveLunaChromeShippingJobsV1({
        supabase: auth.supabase,
        accountKey: auth.accountKey,
        candidateIds: requested.length ? requested : undefined,
        sessionSecret: sessionSecret(),
        purpose: body.purpose === "CANONICAL_BIND_BOOTSTRAP"
          ? "CANONICAL_BIND_BOOTSTRAP" : undefined,
      })
      return listingAiResponse({ success: true, jobs,
        safety: { readOnly: true, cookieAccess: false,
          credentialAccess: false, lunaPurchases: 0, marketplaceWrites: 0 } })
    }
    if (body.action === "promote_product_fit_strong") {
      enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
      const result = await persistProductFitStrongPromotionV1({
        supabase: auth.supabase,
        accountKey: auth.accountKey,
        revalidation: listingAiRecord(body.revalidation) as
          SellerOsProductFitStrongRevalidationV1,
      })
      return listingAiResponse({ success: true, result,
        safety: { durableAuthorityReused: "ebay_same_day_pilot_events",
          newInfrastructureCreated: false,
          lunaPurchases: 0, marketplaceWrites: 0 } })
    }
    if (body.action === "certify_capture") {
      enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
      const result = await persistLunaChromeShippingCaptureV1({
        supabase: auth.supabase, accountKey: auth.accountKey,
        capture: listingAiRecord(body.capture) as
          LunaShippingCapturePostV1,
        sessionSecret: sessionSecret(),
      })
      return listingAiResponse({ success: true, result,
        safety: { cookieAccess: false,
          credentialAccess: false, lunaPurchases: 0, marketplaceWrites: 0 } })
    }
    if (body.action === "persist_runtime_trace") {
      enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
      const events = (Array.isArray(body.events) ? body.events : [])
        .map((event) => listingAiRecord(event) as LunaShippingRuntimeTraceEventV1)
        .slice(0, 100)
      const result = await persistLunaShippingRuntimeTraceV1({
        supabase: auth.supabase, accountKey: auth.accountKey,
        events,
      })
      return listingAiResponse({ success: true, result,
        safety: { traceSafeNoPii: true, cookieAccess: false,
          credentialAccess: false, lunaPurchases: 0, marketplaceWrites: 0 } })
    }
    if (body.action === "read_runtime_trace") {
      enforceListingAiRouteRateLimit(auth.actorId, "READ")
      const result = await readLatestLunaShippingRuntimeTraceV1({
        supabase: auth.supabase, accountKey: auth.accountKey,
      })
      return listingAiResponse({ success: true, result,
        safety: { traceSafeNoPii: true, cookieAccess: false,
          credentialAccess: false, lunaPurchases: 0, marketplaceWrites: 0 } })
    }
    throw new Error("LUNA_SHIPPING_EXTENSION_ACTION_INVALID")
  } catch (error) {
    return listingAiFailure(error)
  }
}
