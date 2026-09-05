export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import {
  enforceListingAiRouteRateLimit,
  listingAiFailure,
  listingAiJson,
  listingAiRecord,
  listingAiResponse,
} from "@/lib/ebay/ebay-listing-ai-api"
import {
  SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION,
  getEbayProRuntimeBoundary,
} from "@/lib/ebay/environment-boundaries"
import {
  getEbaySellerAccountScopeConfiguration,
} from "@/lib/ebay/ebay-seller-account-scope"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"
import {
  type LunaShippingCapturePostV1,
  type LunaProductPageOosPostV1,
  type LunaShippingRuntimeTraceEventV1,
} from "@/lib/ebay/ebay-luna-chrome-shipping-capture-v1"
import {
  persistLunaChromeShippingCaptureV1,
  persistLunaChromeLiveListingShippingCaptureV1,
  persistLunaProductPageOosV1,
  persistLunaShippingRuntimeTraceV1,
  readLatestLunaShippingRuntimeTraceV1,
  acquireLunaChromeShippingJobsV1,
  resolveLunaChromeShippingJobsV1,
  resolveLunaChromeShippingLiveListingJobV1,
} from
  "@/lib/ebay/ebay-luna-chrome-shipping-capture-server-v1"
import {
  persistProductFitStrongPromotionV1,
  type SellerOsProductFitStrongRevalidationV1,
} from "@/lib/ebay/ebay-product-fit-durable-promotion-v1"
import { resumeRadarFactoryCandidateAfterShippingV1 } from
  "@/lib/ebay/ebay-opportunity-radar-revenue-factory-adapter-v1"
import { continueLunaQuickPickPostShippingRuntimeV1 } from
  "@/lib/ebay/ebay-quick-pick-post-shipping-continuation-v1"
import { getEbayTaxonomyListingIntelligence } from
  "@/lib/ebay/ebay-seller-keyword-demand-gateway"
import { preflightEbayCategoryProductIdentifiers } from
  "@/lib/ebay/ebay-draft-only-gateway"

function candidateIds(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim()).filter(Boolean).slice(0, 20)
}

function runtimeInstanceId(value: unknown, fallback: string) {
  const requested = typeof value === "string" ? value.trim() : ""
  const resolved = requested || fallback
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(resolved)) {
    throw new Error("LUNA_SHIPPING_RUNTIME_INSTANCE_INVALID")
  }
  return resolved
}

function liveListingTarget(value: unknown, accountKey: string) {
  const target = listingAiRecord(value)
  return Object.freeze({
    accountKey,
    marketplaceId: "EBAY_US" as const,
    ebayItemId: typeof target.ebayItemId === "string"
      ? target.ebayItemId.trim() : "",
    lunaProductId: typeof target.lunaProductId === "string"
      ? target.lunaProductId.trim() : "",
    lunaVariantId: typeof target.lunaVariantId === "string"
      ? target.lunaVariantId.trim() : "",
    sourceSku: typeof target.sourceSku === "string"
      ? target.sourceSku.trim() : "",
  })
}

function sessionSecret() {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ""
  if (value.length < 32) throw new Error("LUNA_SHIPPING_CAPTURE_SESSION_SECRET_MISSING")
  return value
}

async function authorizeLunaShippingCaptureRequest(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || !validation.userId) return {
    ok: false as const,
    response: listingAiResponse({
      success: false,
      error: validation.error ?? "LUNA_SHIPPING_ADMIN_REQUIRED",
      safety: { lunaRequests: 0, marketplaceWrites: 0 },
    }, validation.status || 403),
  }
  const account = getEbaySellerAccountScopeConfiguration()
  if (!account.accountKey) return {
    ok: false as const,
    response: listingAiResponse({
      success: false,
      error: "LUNA_SHIPPING_ACCOUNT_REQUIRED",
      reason: account.reason,
      safety: { lunaRequests: 0, marketplaceWrites: 0 },
    }, 409),
  }
  const boundary = getEbayProRuntimeBoundary({
    pathname: "/api/admin/ebay/luna-shipping-capture",
    method: req.method,
  })
  if (boundary.boundaryClassification !==
        SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION ||
      !boundary.dedicatedPreprod.certified || boundary.isProductionRuntime) {
    return {
      ok: false as const,
      response: listingAiResponse({
        success: false,
        error: "LUNA_SHIPPING_DEDICATED_PREPROD_REQUIRED",
        safety: { lunaRequests: 0, marketplaceWrites: 0 },
      }, 403),
    }
  }
  return {
    ok: true as const,
    actorId: validation.userId,
    accountKey: account.accountKey,
    supabase: getSupabaseAdminClient(),
  }
}

export async function POST(req: Request) {
  const auth = await authorizeLunaShippingCaptureRequest(req)
  if (!auth.ok) return auth.response
  try {
    const body = await listingAiJson(req)
    if (body.action === "resolve_jobs") {
      enforceListingAiRouteRateLimit(auth.actorId, "READ")
      const requested = candidateIds(body.candidateIds)
      if (!requested.length) {
        const acquisition = await acquireLunaChromeShippingJobsV1({
          supabase: auth.supabase,
          accountKey: auth.accountKey,
          runtimeInstanceId: runtimeInstanceId(body.runtimeInstanceId,
            auth.actorId),
          sessionSecret: sessionSecret(),
        })
        return listingAiResponse({ success: true,
          jobs: acquisition.jobs, acquisition,
          safety: { readOnly: false,
            durableWriteScope: "SELLER_OS_LUNA_SHIPPING_JOB_CLAIM_V1",
            cookieAccess: false, credentialAccess: false,
            lunaPurchases: 0, marketplaceWrites: 0 } })
      }
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
    if (body.action === "resolve_live_listing_job") {
      enforceListingAiRouteRateLimit(auth.actorId, "READ")
      const target = liveListingTarget(body.target, auth.accountKey)
      const job = await resolveLunaChromeShippingLiveListingJobV1({
        supabase: auth.supabase,
        target,
        sessionSecret: sessionSecret(),
      })
      return listingAiResponse({ success: true, jobs: [job],
        target: { ebayItemId: target.ebayItemId,
          lunaProductId: target.lunaProductId,
          lunaVariantId: target.lunaVariantId,
          sourceSku: target.sourceSku },
        safety: { exactCurrentLiveIdentity: true,
          durableCandidateCreated: false, serverHttpLunaRequests: 0,
          lunaPurchases: 0, marketplaceWrites: 0 } })
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
      let economicsContinuation: unknown
      try {
        economicsContinuation = await resumeRadarFactoryCandidateAfterShippingV1({
          supabase: auth.supabase,
          accountKey: auth.accountKey,
          candidateId: String(result.identity.candidateId ??
            listingAiRecord(body.capture).candidateId ?? ""),
          lunaProductId: result.identity.lunaProductId,
          lunaVariantId: result.identity.lunaVariantId,
          supplierSku: result.identity.supplierSku,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : ""
        economicsContinuation = Object.freeze({
          applicable: true,
          status: "EXCEPTION",
          reasonCode: /^[A-Z][A-Z0-9_]{2,119}$/.test(message)
            ? message : "RADAR_SHIPPING_CONTINUATION_FAILED",
          economicsResumed: false,
          listingReady: false,
          marketplaceWrites: 0,
        })
      }
      let postShippingContinuation: unknown = null
      const continuationCandidateId = String(result.identity.candidateId ??
        listingAiRecord(body.capture).candidateId ?? "")
      if (economicsContinuation &&
          listingAiRecord(economicsContinuation).status !== "EXCEPTION") {
        try {
          postShippingContinuation =
            await continueLunaQuickPickPostShippingRuntimeV1({
              supabase: auth.supabase,
              accountKey: auth.accountKey,
              candidateKeys: [continuationCandidateId],
              taxonomyReader: getEbayTaxonomyListingIntelligence,
              productIdentifierPolicyReader:
                preflightEbayCategoryProductIdentifiers,
            })
        } catch (error) {
          const message = error instanceof Error ? error.message : ""
          postShippingContinuation = Object.freeze({
            contractVersion: "QUICK_PICK_POST_SHIPPING_CONTINUATION_V1",
            status: "RETRYABLE_INCOMPLETE",
            reasonCode: /^[A-Z][A-Z0-9_]{2,119}$/.test(message)
              ? message : "QUICK_PICK_POST_SHIPPING_CONTINUATION_FAILED",
            retryConsumerPresent: true,
            overnightDependency: false,
            marketplaceWrites: 0,
          })
        }
      }
      return listingAiResponse({ success: true,
        result: { ...result, economicsContinuation,
          postShippingContinuation },
        safety: { cookieAccess: false,
          credentialAccess: false, lunaPurchases: 0, marketplaceWrites: 0 } })
    }
    if (body.action === "certify_live_listing_capture") {
      enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
      const result = await persistLunaChromeLiveListingShippingCaptureV1({
        supabase: auth.supabase,
        target: liveListingTarget(body.target, auth.accountKey),
        capture: listingAiRecord(body.capture) as LunaShippingCapturePostV1,
        sessionSecret: sessionSecret(),
      })
      return listingAiResponse({ success: true, result,
        safety: { exactCurrentLiveIdentity: true,
          durableStore: "seller_os_live_listing_shipping_evidence",
          serverHttpLunaRequests: 0, lunaPurchases: 0,
          marketplaceWrites: 0 } })
    }
    if (body.action === "reject_product_oos") {
      enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
      const result = await persistLunaProductPageOosV1({
        supabase: auth.supabase, accountKey: auth.accountKey,
        observation: listingAiRecord(body.observation) as
          LunaProductPageOosPostV1,
        sessionSecret: sessionSecret(),
      })
      return listingAiResponse({ success: true, result,
        safety: { exactIdentityOnly: true, shippingExecuted: false,
          economicsExecuted: false, lunaPurchases: 0, marketplaceWrites: 0 } })
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
