import { keywordRecord as record, keywordWireDigestV1 as digest } from "./keyword-intelligence-handoff-v1"
import type { listingPipelineConsistencyV1 } from "./listing-pipeline-consistency-v1"
import { canonicalEbayPackageSku } from "../ebay/ebay-sku"

export const PUBLICATION_STAGES_V1 = ["DRAFT", "PACKAGE_CERTIFIED", "EBAY_PREVALIDATED", "INVENTORY_READY",
  "OFFER_READY", "PUBLISH_REQUESTED", "READBACK_REQUIRED", "PUBLISHED_CONFIRMED"] as const

// A projection of the existing publisher ledgers, never another executor or
// authorization. The preview preparation key is not a publish execution key.
export function publicationLedgerStateV1(value: unknown) {
  const p = record(value), phase = p.phase
  const confirmed = phase === "monitor_registered" && /^\d{9,20}$/.test(String(p.listing_id)) &&
    Boolean(p.active_listing_id && p.manual_registration_id) &&
    Number.isFinite(Date.parse(String(p.verified_active_at))) && Number.isFinite(Date.parse(String(p.monitor_registered_at)))
  return confirmed ? "PUBLISHED_CONFIRMED" : phase === "outcome_unknown" ? "UNKNOWN_COMMIT_STATE" :
    phase === "publish_in_flight" ? "PUBLISH_REQUESTED" :
    ["published_pending_verification", "monitor_registered"].includes(String(phase)) ? "READBACK_REQUIRED" :
    phase === "preview_ready" ? "OFFER_READY" : phase === "terminal_failure" ? "REQUIRES_ATTENTION" : "DRAFT"
}

export function listingPublicationE2eGateV1(g: ReturnType<typeof listingPipelineConsistencyV1>, publication?: unknown, publicationReadAvailable = true) {
  const p = record(publication), snapshot = record(g.snapshot), binding = record(snapshot.binding), preview = record(p.preview)
  const content = record(snapshot.content), product = record(record(preview.inventoryItemPayload).product), offer = record(preview.offerPayload)
  const packageId = Array.isArray(snapshot.sourceEvidenceReferences) ? snapshot.sourceEvidenceReferences[0] : null
  const present = Boolean(p.id)
  const identity = !present || p.listing_package_id === packageId && p.marketplace_account_key === binding.ACCOUNT_KEY &&
    p.sku === canonicalEbayPackageSku(packageId) && preview.sku === p.sku && offer.sku === p.sku &&
    offer.marketplaceId === "EBAY_US" && preview.accountFingerprint === p.account_fingerprint &&
    String(binding.ACCOUNT_KEY).endsWith(`:${p.account_fingerprint}`) &&
    preview.listingPackageId === packageId && preview.opportunityId === binding.OPPORTUNITY_ID && preview.candidateKey === binding.CANDIDATE_KEY
  const aspects = Object.fromEntries(Object.entries(record(content.itemSpecifics)).map(([k,v]) => [k, [v]]))
  // Hosted image aliases require their own provenance handoff. A different
  // historical Preview is not silently treated as this certified generation.
  const generationMatches = !present || identity && product.title === content.title && product.description === content.description &&
    digest(product.aspects) === digest(aspects) && digest(product.imageUrls) === digest(content.imageUrls) &&
    offer.categoryId === content.categoryId && record(record(offer.pricingSummary).price).currency === "USD" &&
    Number(record(record(offer.pricingSummary).price).value) === content.price
  const publicationKey = present && identity && typeof p.id === "string" ?
    typeof p.publication_idempotency_key === "string" ? p.publication_idempotency_key : `publish:${p.id}` : null
  const materialReady = publicationReadAvailable && g.PACKAGE_CONSISTENT && g.READY_TO_PUBLISH && identity && generationMatches
  const ledgerState = publicationLedgerStateV1(p)
  const irreversible = ["PUBLISH_REQUESTED", "UNKNOWN_COMMIT_STATE", "READBACK_REQUIRED", "PUBLISHED_CONFIRMED"].includes(ledgerState)
  return Object.freeze({ contractVersion: "SELLER_OS_LISTING_PUBLICATION_E2E_GATE_V1", operation: "NEW_LISTING_PUBLICATION",
    stages: PUBLICATION_STAGES_V1, PACKAGE_CERTIFIED: g.PACKAGE_CONSISTENT && g.IMMUTABLE && g.PACKAGE_HASH_PRESENT,
    PACKAGE_CONSISTENT: g.PACKAGE_CONSISTENT, PACKAGE_HASH: g.PACKAGE_HASH,
    READY_TO_PUBLISH: materialReady && (!present || ledgerState === "OFFER_READY"),
    status: !identity ? "REQUIRES_REVIEW" : irreversible && generationMatches ? ledgerState : !g.PACKAGE_CONSISTENT ? "DRAFT" :
      !materialReady ? "PACKAGE_CERTIFIED" : ledgerState === "OFFER_READY" ? "OFFER_READY" : "PACKAGE_CERTIFIED",
    existingLedgerState: present ? ledgerState : null, existingPublicationGenerationMatches: generationMatches,
    publicationIdempotencyKey: publicationKey, PUBLICATION_IDEMPOTENCY_KEY_PRESENT: Boolean(publicationKey),
    // Existing RPC binds this exact key atomically on claim; deriving it does not claim.
    publicationIdempotencyKeyDurablyClaimed: Boolean(p.publication_idempotency_key),
    publicationPreparationKey: g.publicationPreparationKey,
    blockingEvidence: [...g.inconsistencies, ...g.waiting, ...(!publicationReadAvailable ? ["PUBLICATION_EVIDENCE_UNAVAILABLE"] : []), ...(!identity ? ["PUBLICATION_IDENTITY_MISMATCH"] : []),
      ...(!generationMatches ? ["PUBLICATION_PREVIEW_GENERATION_MISMATCH"] : [])],
    inventoryStatus: g.evidence.inventory.status === "PROVEN" ? "READY" : "WAITING_FOR_DATA",
    shippingStatus: g.SHIPPING_STATUS, feeAuthorityStatus: g.evidence.feeAuthority.status === "PROVEN" ? "PROVEN" : "WAITING_FOR_DATA",
    BLIND_RETRY_ALLOWED: false, OFFICIAL_READBACK_REQUIRED: true, PUBLICATION_AUTHORIZATION_GRANTED: false,
    retryPolicy: "UNKNOWN_GET_ONLY; REARM_ONLY_AFTER_PROVEN_NOT_PUBLISHED_AND_FULL_REVALIDATION",
    CODEX_RUNTIME_DEPENDENCY: false, publicationWrites: 0, adsWrites: 0 })
}
