import type { SupabaseClient } from "@supabase/supabase-js"

import { readLunaQuickPickProgressV1 } from "./ebay-luna-quick-pick-v1"
import { buildQuickPickOwnerReviewPackageDataV1 } from
  "./ebay-quick-pick-market-test-package-v1"
import { ensureAutomaticLunaSupplierImagesV1 } from
  "./luna-supplier-image-auto-runtime-v1"

type JsonRecord = Record<string, unknown>
function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}
function uuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value) ? value : null
}

export async function persistQuickPickOwnerReviewV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  body: JsonRecord
}>) {
  const candidateKey = typeof input.body.candidateKey === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(input.body.candidateKey)
    ? input.body.candidateKey : null
  const listingPackageId = uuid(input.body.listingPackageId)
  const intent = input.body.intent === "EDIT" ? "EDIT" as const
    : input.body.intent === "CONFIRM" ? "CONFIRM" as const : null
  if (!candidateKey || !listingPackageId || !intent) {
    throw new Error("QUICK_PICK_OWNER_REVIEW_INPUT_INVALID")
  }
  let progress = await readLunaQuickPickProgressV1({
    supabase: input.supabase, candidateKeys: [candidateKey],
    accountKey: input.accountKey,
  })
  let card = progress.find((entry) => entry.candidateKey === candidateKey)
  let review = record(card?.listingReview)
  if (!card || card.listingPackageId !== listingPackageId ||
      (!card.marketTestReady && card.disposition !== "LISTING_READY") ||
      review.finalListingPackageReady !== true ||
      review.factInvented !== false || review.marketplaceWrites !== 0) {
    throw new Error("QUICK_PICK_OWNER_REVIEW_PACKAGE_NOT_READY")
  }
  const currentRead = await input.supabase.from("ebay_listing_packages")
    .select("id,account_key,opportunity_id,candidate_key,status,package_data,readiness,source_observed_at,created_by,updated_at")
    .eq("id", listingPackageId).eq("candidate_key", candidateKey)
    .eq("account_key", input.accountKey).maybeSingle()
  let current = record(currentRead.data)
  if (currentRead.error || !current.id ||
      current.opportunity_id !== card.opportunityId ||
      !["draft", "ready_for_review", "approved"].includes(
        String(current.status ?? "")) ||
      (current.created_by !== null && current.created_by !== input.actorUserId)) {
    throw new Error("QUICK_PICK_OWNER_REVIEW_PACKAGE_OWNERSHIP_MISMATCH")
  }
  const edits = record(input.body.edits)
  if (intent === "EDIT" && typeof edits.title !== "string" &&
      typeof edits.description !== "string") {
    throw new Error("QUICK_PICK_OWNER_REVIEW_EDIT_REQUIRED")
  }
  if (intent === "CONFIRM") {
    if (current.created_by === null) {
      const claimedAt = new Date().toISOString()
      const claimed = await input.supabase.from("ebay_listing_packages")
        .update({ created_by: input.actorUserId, updated_at: claimedAt })
        .eq("id", listingPackageId).eq("opportunity_id", card.opportunityId)
        .eq("candidate_key", candidateKey).eq("account_key", input.accountKey)
        .eq("updated_at", current.updated_at).is("created_by", null)
        .select("id,account_key,opportunity_id,candidate_key,status,package_data,readiness,source_observed_at,created_by,updated_at")
        .maybeSingle()
      if (claimed.error || !claimed.data) throw new Error(
        "QUICK_PICK_OWNER_REVIEW_PACKAGE_OWNERSHIP_MISMATCH")
      current = record(claimed.data)
    }
    if (record(record(current.package_data).supplierImageReadiness)
        .imageReady !== true) {
      const preparedImages = await ensureAutomaticLunaSupplierImagesV1({
        supabase: input.supabase as Parameters<
          typeof ensureAutomaticLunaSupplierImagesV1>[0]["supabase"],
        accountKey: input.accountKey, actor: input.actorUserId,
        packageRow: current,
      })
      current = record(preparedImages.listingPackage)
    }
    progress = await readLunaQuickPickProgressV1({ supabase: input.supabase,
      candidateKeys: [candidateKey], accountKey: input.accountKey })
    card = progress.find((entry) => entry.candidateKey === candidateKey)
    review = record(card?.listingReview)
    if (!card || card.listingPackageId !== listingPackageId ||
        review.finalListingPackageReady !== true ||
        record(review.authorizationBinding).imageCount === 0) {
      throw new Error("QUICK_PICK_OWNER_REVIEW_FINAL_PACKAGE_NOT_READY")
    }
  }
  const now = new Date().toISOString()
  const nextPackageData = buildQuickPickOwnerReviewPackageDataV1({
    currentPackageData: record(current.package_data),
    review: review as Parameters<
      typeof buildQuickPickOwnerReviewPackageDataV1>[0]["review"],
    actorUserId: input.actorUserId, action: intent, edits, now,
  })
  let write = input.supabase.from("ebay_listing_packages").update({
    created_by: input.actorUserId, package_data: nextPackageData,
    status: "ready_for_review", readiness: 100, updated_at: now,
  }).eq("id", listingPackageId).eq("opportunity_id", card.opportunityId)
    .eq("candidate_key", candidateKey).eq("account_key", input.accountKey)
    .eq("updated_at", current.updated_at)
  write = current.created_by === null ? write.is("created_by", null)
    : write.eq("created_by", input.actorUserId)
  const readback = await write.select(
    "id,opportunity_id,candidate_key,status,package_data,readiness,created_by,updated_at",
  ).maybeSingle()
  const stored = record(readback.data)
  const storedReview = record(record(stored.package_data)
    .quickPickOwnerReviewV1)
  if (readback.error || !stored.id || stored.created_by !== input.actorUserId ||
      storedReview.contractVersion !== "QUICK_PICK_REMOTE_OWNER_REVIEW_V1" ||
      storedReview.status !== (intent === "CONFIRM" ? "CONFIRMED"
        : "EDITED_PENDING_CONFIRMATION")) {
    throw new Error("QUICK_PICK_OWNER_REVIEW_DURABLE_WRITE_FAILED")
  }
  return Object.freeze({ listingPackageId, candidateKey,
    reviewStatus: storedReview.status,
    readyForOwnerPublishAuthorization:
      storedReview.readyForOwnerPublishAuthorization === true,
    packageStatus: stored.status, packageReadiness: stored.readiness,
    marketplaceWrites: 0 as const, listingPublications: 0 as const })
}
