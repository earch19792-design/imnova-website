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
  certifyLunaChromeShippingVisibleCaptureV1,
  normalizeLunaChromeShippingJobV1,
  type LunaChromeShippingVisibleCaptureV1,
} from "@/lib/ebay/ebay-luna-chrome-shipping-capture-v1"
import { resolveLunaChromeShippingJobsV1 } from
  "@/lib/ebay/ebay-luna-chrome-shipping-capture-server-v1"

function candidateIds(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim()).filter(Boolean).slice(0, 20)
}

function sameAuthority(left: ReturnType<typeof normalizeLunaChromeShippingJobV1>,
  right: ReturnType<typeof normalizeLunaChromeShippingJobV1>) {
  return JSON.stringify({ identity: left.identity, destination: left.destination,
    salePriceUsd: left.salePriceUsd, supplierCostUsd: left.supplierCostUsd,
    productName: left.productName }) ===
    JSON.stringify({ identity: right.identity, destination: right.destination,
      salePriceUsd: right.salePriceUsd, supplierCostUsd: right.supplierCostUsd,
      productName: right.productName })
}

export async function POST(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "READ")
    const body = await listingAiJson(req)
    if (body.action === "resolve_jobs") {
      const requested = candidateIds(body.candidateIds)
      const jobs = await resolveLunaChromeShippingJobsV1({
        supabase: auth.supabase,
        accountKey: auth.accountKey,
        candidateIds: requested.length ? requested : undefined,
      })
      return listingAiResponse({ success: true, jobs,
        safety: { readOnly: true, cookieAccess: false,
          credentialAccess: false, lunaPurchases: 0, marketplaceWrites: 0 } })
    }
    if (body.action === "certify_capture") {
      const claimed = normalizeLunaChromeShippingJobV1(
        listingAiRecord(body.job) as never)
      const [authority] = await resolveLunaChromeShippingJobsV1({
        supabase: auth.supabase,
        accountKey: auth.accountKey,
        candidateIds: [claimed.identity.candidateId],
      })
      if (!authority || !sameAuthority(claimed, authority)) {
        throw new Error("LUNA_SHIPPING_EXTENSION_JOB_AUTHORITY_MISMATCH")
      }
      const certified = certifyLunaChromeShippingVisibleCaptureV1({
        job: Object.freeze({ ...authority,
          captureSessionId: claimed.captureSessionId,
          nonce: claimed.nonce }),
        capture: listingAiRecord(body.capture) as
          LunaChromeShippingVisibleCaptureV1,
      })
      return listingAiResponse({ success: true, result: certified,
        safety: { readOnly: true, cookieAccess: false,
          credentialAccess: false, lunaPurchases: 0, marketplaceWrites: 0 } })
    }
    throw new Error("LUNA_SHIPPING_EXTENSION_ACTION_INVALID")
  } catch (error) {
    return listingAiFailure(error)
  }
}
