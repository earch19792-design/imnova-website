import type { SupabaseClient } from "@supabase/supabase-js"
import { goldenRecord as record, goldenDigest as digest } from "../ebay/commercial-golden-path-domain-v1"
import { loadFastListingV1, projectLoadedFastListingV1 } from "./fast-listing-runtime-v1"
import { issueLunaShippingCaptureSessionV1, verifyLunaShippingCaptureSessionV1 } from "../ebay/ebay-luna-chrome-shipping-capture-server-v1"
import { LUNA_SHIPPING_QUOTE_CAPTURE_VERSION, normalizeLunaChromeShippingJobV1, certifyLunaShippingCapturePostV1,
  type LunaChromeShippingJobV1, type LunaShippingCapturePostV1 } from "../ebay/ebay-luna-chrome-shipping-capture-v1"
import { SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1 } from "../ebay/ebay-luna-authoritative-shipping-server-v1"

type Scope = { supabase: SupabaseClient; accountKey: string; sessionSecret: string; now?: number; candidateIds?: readonly string[] }
/** An additional discovery provider for the existing Capture executor. No
 * quote calculator, checkout executor, scheduler or claim engine lives here. */
export async function resolveFastListingShippingJobsV1(input: Scope): Promise<readonly LunaChromeShippingJobV1[]> {
  const contexts = await input.supabase.from("seller_os_fast_listing_contexts_v1").select("opportunity_id,owner_user_id,preferences")
    .eq("account_key", input.accountKey).not("preferences->>shippingRequested", "is", null)
    .gte("updated_at",new Date((input.now??Date.now())-6*3600000).toISOString()).order("updated_at").limit(20)
    .abortSignal(AbortSignal.timeout(8000)).retry(false)
  if (contexts.error) return [] // Other discovery lanes remain independent.
  const jobs: LunaChromeShippingJobV1[] = []
  for (const context of contexts.data ?? []) {
    try {
      const scope={supabase:input.supabase,accountKey:input.accountKey,ownerId:context.owner_user_id,now:new Date(input.now ?? Date.now())}
      const loaded = await loadFastListingV1(scope, context.opportunity_id)
      const projection = projectLoadedFastListingV1(scope, loaded), p = record(loaded.context.preferences)
      if (!projection.identityConfirmed || !projection.canPrepareDraft) continue
      for (const offer of projection.matrix) {
        const request = record(record(p.shippingRequested)[String(offer.quantity)])
        if (request.truthDigest !== projection.truth.evidenceDigest || request.sourceFingerprint !== loaded.source.source_fingerprint ||
          Date.parse(String(request.requestedAt)) + 6 * 3600000 <= (input.now ?? Date.now()) || offer.shipping !== null) continue
        const candidateId = digest({ contract: "FAST_LISTING_CAPTURE_OFFER_V1", accountKey: input.accountKey, opportunityId: context.opportunity_id, quantity: offer.quantity })
        if (input.candidateIds && !input.candidateIds.includes(candidateId)) continue
        const snapshotDigest = digest({ sourceFingerprint: loaded.source.source_fingerprint, truthDigest: projection.truth.evidenceDigest,
          quantity: offer.quantity, supplierCost: offer.totalLunaCost, destination: SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1.profileDigest })
        const session = issueLunaShippingCaptureSessionV1({ secret: input.sessionSecret, candidateId, snapshotDigest, now: input.now })
        jobs.push(normalizeLunaChromeShippingJobV1({ contractVersion: LUNA_SHIPPING_QUOTE_CAPTURE_VERSION, ...session, snapshotDigest,
          identity: { candidateId, lunaProductId: String(loaded.source.product_id), lunaVariantId: String(loaded.source.variant_id),
            supplierSku: String(loaded.source.sku), canonicalProductUrl: String(loaded.source.canonical_url), quantity: offer.quantity },
          supplierCostUsd: offer.totalLunaCost!, salePriceUsd: offer.price, productName: String(projection.truth.values.TITLE).slice(0, 200),
          destination: SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1 }))
      }
    } catch { /* A broken product never prevents another job or existing lane. */ }
  }
  return jobs.slice(0, 20)
}

export async function persistFastListingShippingCaptureV1(input: Scope & { capture: LunaShippingCapturePostV1 }) {
  if(!/^sha256:[0-9a-f]{64}$/.test(input.capture.candidateId)) return null
  const contexts = await input.supabase.from("seller_os_fast_listing_contexts_v1").select("opportunity_id,owner_user_id")
    .eq("account_key", input.accountKey).contains("preferences",{shippingCandidateIds:[input.capture.candidateId]})
    .limit(2).abortSignal(AbortSignal.timeout(8000)).retry(false)
  if (contexts.error) return null
  let context = null
  for (const c of contexts.data ?? []) if ([1, 2, 3, 4].some(quantity => digest({ contract: "FAST_LISTING_CAPTURE_OFFER_V1",
    accountKey: input.accountKey, opportunityId: c.opportunity_id, quantity }) === input.capture.candidateId)) { context = c; break }
  if (!context) return null
  const eventKey = `fast-listing-capture:${digest({ account: input.accountKey, case: context.opportunity_id, evidence: input.capture.evidenceDigest })}`
  const prior = await input.supabase.from("ebay_luna_opportunity_queue_events").select("new_value").eq("opportunity_id", context.opportunity_id)
    .eq("idempotency_key", eventKey).limit(1).maybeSingle()
  if (prior.error) throw Error("FAST_LISTING_CAPTURE_HISTORY_READ_FAILED")
  if (prior.data) {
    const previous=record(record(record(prior.data.new_value).patch).shippingReceipts), receipt=Object.values(previous).map(record).find(r=>r.receiptId===eventKey)
    if(!receipt || receipt.captureSessionId !== input.capture.captureSessionId) throw Error("FAST_LISTING_CAPTURE_REPLAY_MISMATCH")
    verifyLunaShippingCaptureSessionV1({ secret:input.sessionSecret,candidateId:input.capture.candidateId,snapshotDigest:String(receipt.snapshotDigest),
      captureSessionId:input.capture.captureSessionId,nonce:input.capture.nonce,now:input.now })
    await input.supabase.rpc("complete_seller_os_luna_shipping_job_v1",{p_account_key:input.accountKey,p_candidate_id:input.capture.candidateId,
      p_snapshot_digest:receipt.snapshotDigest,p_capture_session_id:input.capture.captureSessionId})
    return { receipt, reused: true, marketplaceWrites: 0 }
  }
  const [job] = await resolveFastListingShippingJobsV1({ ...input, candidateIds: [input.capture.candidateId] })
  if (!job) throw Error("FAST_LISTING_CAPTURE_SOURCE_CHANGED")
  verifyLunaShippingCaptureSessionV1({ secret: input.sessionSecret, candidateId: job.identity.candidateId, snapshotDigest: job.snapshotDigest,
    captureSessionId: input.capture.captureSessionId, nonce: input.capture.nonce, now: input.now })
  const bound = { ...job, captureSessionId: input.capture.captureSessionId, nonce: input.capture.nonce }
  const certified = certifyLunaShippingCapturePostV1({ job: bound, capture: input.capture, now: input.now })
  if(Math.round(input.capture.subtotalUsd*100)!==Math.round(job.supplierCostUsd*100)) throw Error("FAST_LISTING_CAPTURE_COST_CHANGED")
  const claim = await input.supabase.from("seller_os_luna_shipping_job_claims").select("status,capture_session_id,snapshot_digest,lease_expires_at")
    .eq("account_key", input.accountKey).eq("candidate_id", job.identity.candidateId).limit(1).maybeSingle()
  if (claim.error || claim.data?.status !== "CLAIMED" || claim.data.capture_session_id !== bound.captureSessionId ||
    claim.data.snapshot_digest !== bound.snapshotDigest || Date.parse(claim.data.lease_expires_at) <= (input.now ?? Date.now())) throw Error("FAST_LISTING_CAPTURE_ACTIVE_LEASE_REQUIRED")
  const scope = {supabase:input.supabase,accountKey:input.accountKey,ownerId:context.owner_user_id,now:new Date(input.now ?? Date.now())}
  const loaded = await loadFastListingV1(scope, context.opportunity_id), p = record(loaded.context.preferences)
  const now = new Date(input.now ?? Date.now())
  const receipt = { status: "PROVEN", source: "LUNA_SHIPPING_CAPTURE", acquisitionMethod: input.capture.acquisitionMethod,
    productId: job.identity.lunaProductId, variantId: job.identity.lunaVariantId, supplierSku: job.identity.supplierSku,
    quantity: job.identity.quantity, sourceFingerprint: loaded.source.source_fingerprint,
    truthDigest:projectLoadedFastListingV1(scope,loaded).truth.evidenceDigest,snapshotDigest:job.snapshotDigest,captureSessionId:bound.captureSessionId,amountUsd: input.capture.shippingUsd,
    subtotalUsd: input.capture.subtotalUsd, totalUsd: input.capture.totalUsd, currency: "USD", receiptId: eventKey,
    observedAt: input.capture.observedAt, freshUntil: new Date(Date.parse(input.capture.observedAt) + 6 * 3600000).toISOString(),
    destinationProfileDigest: job.destination.profileDigest, noPurchase: true, noPayment: true, certified }
  const remainingRequests={...record(p.shippingRequested)}
  delete remainingRequests[String(job.identity.quantity)]
  const patch = { shippingReceipts: { ...record(p.shippingReceipts), [String(job.identity.quantity)]: receipt },
    shippingRequested:Object.keys(remainingRequests).length?remainingRequests:null }
  const projection = {...projectLoadedFastListingV1({ ...scope, now }, { ...loaded, context: { ...loaded.context, preferences: { ...p, ...patch } } }),learningEvidenceDigest:digest({eventKey,patch})}
  const written = await input.supabase.rpc("write_seller_os_fast_listing_v1", { p_account_key: input.accountKey, p_owner_user_id: context.owner_user_id,
    p_opportunity_id: context.opportunity_id, p_revision: loaded.context.revision, p_event_key: eventKey, p_event_type: "SHIPPING_CAPTURE",
    p_patch: patch, p_projection: projection, p_lease_token: null })
  if (written.error) throw Error("FAST_LISTING_CAPTURE_PERSIST_FAILED")
  const completed = await input.supabase.rpc("complete_seller_os_luna_shipping_job_v1", { p_account_key: input.accountKey,
    p_candidate_id: job.identity.candidateId, p_snapshot_digest: job.snapshotDigest, p_capture_session_id: bound.captureSessionId })
  if (completed.error || completed.data !== true) throw Error("FAST_LISTING_CAPTURE_COMPLETION_FAILED")
  return { receipt, projection, marketplaceWrites: 0 }
}
