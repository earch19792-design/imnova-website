export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { getEbayTaxonomyListingIntelligence } from
  "@/lib/ebay/ebay-seller-keyword-demand-gateway"
import { completeLunaQuickPickBatchReceiptV1,
  processLunaQuickPickBatchV1, readLunaQuickPickBatchReceiptsV1,
  readLunaQuickPickBatchRehydrationV1, readLunaQuickPickProgressV1,
  receiveLunaQuickPickBatchV1,
  type LunaQuickPickCardV1 } from
  "@/lib/ebay/ebay-luna-quick-pick-v1"
import { buildSellerOsOnDemandCapabilityGapFallbackV1 } from
  "@/lib/ebay/ebay-demand-first-broad-net-orchestrator-v1"
import { continueLunaQuickPickRequiredSpecificsV1 } from
  "@/lib/ebay/ebay-luna-quick-pick-required-specifics-v1"
import { continueLunaQuickPickExactSoldEnrichmentV1 } from
  "@/lib/ebay/ebay-luna-quick-pick-exact-sold-enrichment-v1"
import { mergeSellerOsQuickPickPresentationV1 } from
  "@/lib/ebay/seller-os-quick-pick-presentation-v1"
import { buildQuickPickOwnerReviewPackageDataV1 } from
  "@/lib/ebay/ebay-quick-pick-market-test-package-v1"
import { resolveQuickPickCanonicalPublishHandoffV1 } from
  "@/lib/ebay/ebay-quick-pick-canonical-publish-handoff-v1"
import { readLatestQuickPickRadarOvernightEnrichmentV1 } from
  "@/lib/ebay/ebay-quick-pick-radar-overnight-enrichment-v1"
import { loadFinalListingReviewPublicationGate } from
  "@/lib/ebay/final-listing-review-publication-gate"
import { ensureAutomaticLunaSupplierImagesV1 } from
  "@/lib/ebay/luna-supplier-image-auto-runtime-v1"
import { persistQuickPickRequiredUpcResolutionV1 } from
  "@/lib/ebay/ebay-quick-pick-required-upc-resolution-v1"
import { preflightEbayCategoryProductIdentifiers } from
  "@/lib/ebay/ebay-draft-only-gateway"
import { materializeSellerOsDeterministicFactoryCandidateV1 } from
  "@/lib/ebay/ebay-smart-stocking-durable-factory-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function response(payload: unknown, status = 200) {
  const result = NextResponse.json(payload, { status })
  result.headers.set("Cache-Control", "private, no-store, max-age=0")
  return result
}

function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(code)
    ? code : "LUNA_QUICK_PICK_REQUEST_FAILED"
}

function mergeProgress(receiptCards: readonly LunaQuickPickCardV1[],
  durableCards: readonly LunaQuickPickCardV1[]) {
  return [...mergeSellerOsQuickPickPresentationV1(
    receiptCards, durableCards)]
}

function uuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value) ? value : null
}

async function persistQuickPickOwnerReview(input: Readonly<{
  supabase: ReturnType<typeof getSupabaseAdminClient>
  accountKey: string
  actorUserId: string
  body: Record<string, unknown>
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
  const progress = await readLunaQuickPickProgressV1({
    supabase: input.supabase, candidateKeys: [candidateKey],
    accountKey: input.accountKey,
  })
  const card = progress.find((entry) => entry.candidateKey === candidateKey)
  const review = record(card?.listingReview)
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
  const current = record(currentRead.data)
  if (currentRead.error || !current.id ||
      current.opportunity_id !== card.opportunityId ||
      !["draft", "ready_for_review"].includes(String(current.status ?? "")) ||
      (current.created_by !== null &&
        current.created_by !== input.actorUserId)) {
    throw new Error("QUICK_PICK_OWNER_REVIEW_PACKAGE_OWNERSHIP_MISMATCH")
  }
  const edits = record(input.body.edits)
  if (intent === "EDIT" &&
      typeof edits.title !== "string" &&
      typeof edits.description !== "string") {
    throw new Error("QUICK_PICK_OWNER_REVIEW_EDIT_REQUIRED")
  }
  const now = new Date().toISOString()
  const nextPackageData = buildQuickPickOwnerReviewPackageDataV1({
    currentPackageData: record(current.package_data),
    review: review as Parameters<
      typeof buildQuickPickOwnerReviewPackageDataV1>[0]["review"],
    actorUserId: input.actorUserId, action: intent, edits, now,
  })
  let write = input.supabase.from("ebay_listing_packages").update({
    created_by: input.actorUserId,
    package_data: nextPackageData,
    status: "ready_for_review",
    readiness: 100,
    updated_at: now,
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

export async function GET(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok) return response({ success: false,
    error: auth.error ?? "LUNA_QUICK_PICK_ADMIN_REQUIRED" },
  auth.status || 403)
  try {
    const keys = new URL(req.url).searchParams.getAll("candidate")
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) return response({ success: false,
      error: "LUNA_QUICK_PICK_ACCOUNT_SCOPE_REQUIRED" }, 400)
    const supabase = getSupabaseAdminClient()
    const [receipts, overnightEnrichment] = await Promise.all([
      readLunaQuickPickBatchReceiptsV1({ supabase }),
      readLatestQuickPickRadarOvernightEnrichmentV1(supabase)
        .catch(() => null),
    ])
    const receiptKeys = receipts.flatMap((receipt) => receipt.candidateKeys)
    const requestedKeys = [...new Set([...keys, ...receiptKeys])]
    const receiptSupplierIdentities = receipts.flatMap((receipt) =>
      receipt.cards.flatMap((card) => card.lunaProductId &&
        card.lunaVariantId && card.sourceSku ? [{
          lunaProductId: card.lunaProductId,
          lunaVariantId: card.lunaVariantId,
          supplierSku: card.sourceSku,
        }] : []))
    let durableProgress = await readLunaQuickPickProgressV1({
      supabase, candidateKeys: requestedKeys, accountKey,
      supplierIdentities: receiptSupplierIdentities,
      includeRecent: requestedKeys.length === 0 &&
        receiptSupplierIdentities.length === 0,
    })
    const receiptCards = receipts.flatMap((receipt) => receipt.cards)
    let progress = mergeProgress(receiptCards, durableProgress)
    const pendingCategory = progress.flatMap((card) =>
      card.candidateKey && card.opportunityId
        && card.exactBlockers.some((blocker) =>
          blocker === "MARKETPLACE_CATEGORY_NOT_READY")
        && card.stages.SHIPPING === "PASS"
        && card.stages.ECONOMICS === "PASS"
        && card.stages.PRODUCT_TRUTH === "PASS"
        ? [{ candidateKey: card.candidateKey,
          opportunityId: card.opportunityId }] : [])
    const categoryContinuation: Array<Readonly<{
      candidateKey: string
      status: "COMPLETED" | "BLOCKED"
      categoryId?: string | null
      blocker?: string | null
    }>> = []
    // This endpoint already performs bounded durable continuation for required
    // specifics. Category continuation follows the same model and only resumes
    // candidates whose Shipping, Economics, and Product Truth gates are already
    // certified; it never recreates an intake operation.
    for (let offset = 0; offset < pendingCategory.length; offset += 3) {
      const batch = await Promise.all(pendingCategory.slice(offset, offset + 3)
        .map(async (candidate) => {
          try {
            const materialized =
              await materializeSellerOsDeterministicFactoryCandidateV1({
                supabase, accountKey,
                opportunityId: candidate.opportunityId,
                candidateKey: candidate.candidateKey,
                taxonomyReader: getEbayTaxonomyListingIntelligence,
                productIdentifierPolicyReader:
                  preflightEbayCategoryProductIdentifiers,
              })
            return Object.freeze({ candidateKey: candidate.candidateKey,
              status: "COMPLETED" as const,
              categoryId: typeof materialized.categoryId === "string"
                ? materialized.categoryId : null,
              blocker: typeof materialized.firstBlocker === "string"
                ? materialized.firstBlocker : null })
          } catch (error) {
            return Object.freeze({ candidateKey: candidate.candidateKey,
              status: "BLOCKED" as const, blocker: safeError(error) })
          }
        }))
      categoryContinuation.push(...batch)
    }
    if (pendingCategory.length) {
      durableProgress = await readLunaQuickPickProgressV1({
        supabase, candidateKeys: requestedKeys, accountKey,
        supplierIdentities: receiptSupplierIdentities,
        includeRecent: false,
      })
      progress = mergeProgress(receiptCards, durableProgress)
    }
    const pendingSpecifics = progress.flatMap((card) =>
      card.candidateKey && (card.unresolvedRequiredAspects.length > 0
        || card.exactBlocker?.startsWith(
          "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN")
        || card.exactBlockers.some((blocker) => blocker.startsWith(
          "MARKETPLACE_CONDITION_NOT_READY")))
        ? [card.candidateKey] : [])
    let requiredSpecificsContinuation: unknown = null
    let exactSoldMarketEnrichment: unknown = null
    if (pendingSpecifics.length) {
      try {
        requiredSpecificsContinuation =
          await continueLunaQuickPickRequiredSpecificsV1({
            supabase, accountKey,
            candidateKeys: pendingSpecifics,
            taxonomyReader: getEbayTaxonomyListingIntelligence,
            productIdentifierPolicyReader:
              preflightEbayCategoryProductIdentifiers,
          })
      } catch (error) {
        requiredSpecificsContinuation = { status: "BLOCKED",
          reasonCode: safeError(error), marketplaceWrites: 0 }
      }
      durableProgress = await readLunaQuickPickProgressV1({
        supabase, candidateKeys: requestedKeys, accountKey,
        supplierIdentities: receiptSupplierIdentities,
        includeRecent: requestedKeys.length === 0 &&
          receiptSupplierIdentities.length === 0,
      })
      progress = mergeProgress(receiptCards, durableProgress)
      const residualProductTruthKeys = progress.flatMap((card) =>
        card.candidateKey && (card.unresolvedRequiredAspects.length > 0
          || card.conditionReady === false)
          ? [card.candidateKey] : [])
      if (residualProductTruthKeys.length) {
        try {
          exactSoldMarketEnrichment =
            await continueLunaQuickPickExactSoldEnrichmentV1({
              supabase, accountKey,
              candidateKeys: residualProductTruthKeys,
              taxonomyReader: getEbayTaxonomyListingIntelligence,
              productIdentifierPolicyReader:
                preflightEbayCategoryProductIdentifiers,
            })
        } catch (error) {
          exactSoldMarketEnrichment = { status: "BLOCKED",
            reasonCode: safeError(error), marketplaceWrites: 0 }
        }
        durableProgress = await readLunaQuickPickProgressV1({
          supabase, candidateKeys: requestedKeys, accountKey,
          supplierIdentities: receiptSupplierIdentities,
          includeRecent: requestedKeys.length === 0 &&
            receiptSupplierIdentities.length === 0,
        })
        progress = mergeProgress(receiptCards, durableProgress)
      }
    }
    return response({ success: true, progress,
      summary: { inProgress: progress.filter((card) =>
        card.state === "RUNNING").length,
      readyForReview: progress.filter((card) => card.state === "READY").length,
      blocked: progress.filter((card) => card.state === "BLOCKED").length,
      total: progress.length }, receipt: receipts[0] ?? null, receipts,
      categoryContinuation,
      requiredSpecificsContinuation,
      exactSoldMarketEnrichment,
      overnightEnrichment,
      safety: { marketplaceWrites: 0, canPublish: false } })
  } catch (error) {
    return response({ success: false, error: safeError(error) }, 400)
  }
}

export async function POST(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok) return response({ success: false,
    error: auth.error ?? "LUNA_QUICK_PICK_ADMIN_REQUIRED" },
  auth.status || 403)
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return response({ success: false,
    error: "LUNA_QUICK_PICK_ACCOUNT_SCOPE_REQUIRED" }, 400)
  const length = Number(req.headers.get("content-length") ?? 0)
  if (length > 100_000) return response({ success: false,
    error: "LUNA_QUICK_PICK_INPUT_TOO_LARGE" }, 413)
  try {
    const body = record(await req.json())
    if (body.action === "RESOLVE_REQUIRED_UPC") {
      const candidateKey = typeof body.candidateKey === "string" &&
        /^sha256:[0-9a-f]{64}$/.test(body.candidateKey)
        ? body.candidateKey : null
      const listingPackageId = uuid(body.listingPackageId)
      if (!candidateKey || !listingPackageId) return response({
        success: false,
        error: "QUICK_PICK_REQUIRED_UPC_INPUT_INVALID",
      }, 400)
      const resolution = await persistQuickPickRequiredUpcResolutionV1({
        supabase: getSupabaseAdminClient(), accountKey,
        actorUserId: auth.userId, candidateKey, listingPackageId,
      })
      if (!resolution.categoryId) throw new Error(
        "QUICK_PICK_REQUIRED_UPC_CATEGORY_REQUIRED")
      const categoryPolicyPreflight =
        await preflightEbayCategoryProductIdentifiers({
          categoryId: resolution.categoryId,
          marketplaceId: "EBAY_US",
          inventoryItemPayload: resolution.inventoryItemPayload,
        })
      if (!categoryPolicyPreflight.safe) throw new Error(
        categoryPolicyPreflight.blocker
          ?? "QUICK_PICK_REQUIRED_UPC_CATEGORY_PREFLIGHT_FAILED")
      return response({ success: true, resolution,
        categoryPolicyPreflight,
        safety: { marketplaceWrites: 0, listingPublications: 0,
          publishCallIncrement: 0, offerRecreations: 0,
          inventoryItemRecreations: 0,
          customerProductionTouched: false } })
    }
    if (!auth.userId) return response({ success: false,
      error: "LUNA_QUICK_PICK_ADMIN_REQUIRED" }, 403)
    if (body.action === "OWNER_REVIEW") {
      const ownerReview = await persistQuickPickOwnerReview({
        supabase: getSupabaseAdminClient(), accountKey,
        actorUserId: auth.userId, body,
      })
      return response({ success: true, ownerReview,
        safety: { marketplaceWrites: 0, listingPublications: 0,
          canPublish: false, customerProductionTouched: false } })
    }
    if (body.action === "PUBLISH_HANDOFF") {
      const candidateKey = typeof body.candidateKey === "string" &&
        /^sha256:[0-9a-f]{64}$/.test(body.candidateKey)
        ? body.candidateKey : null
      const listingPackageId = uuid(body.listingPackageId)
      if (!candidateKey || !listingPackageId) return response({
        success: false,
        error: "QUICK_PICK_CANONICAL_PUBLISH_HANDOFF_INPUT_INVALID",
      }, 400)
      const supabase = getSupabaseAdminClient()
      let canonical = await resolveQuickPickCanonicalPublishHandoffV1({
        supabase, accountKey, actorUserId: auth.userId, candidateKey,
        listingPackageId,
      })
      let visualPublicationGate =
        await loadFinalListingReviewPublicationGate({
          supabase, listingPackageId, actorId: auth.userId,
        })
      let automaticImageAuthorityReused = false
      if (!visualPublicationGate.allowed) {
        await ensureAutomaticLunaSupplierImagesV1({ supabase, accountKey,
          actor: auth.userId, packageRow: canonical.listingPackage })
        automaticImageAuthorityReused = true
        canonical = await resolveQuickPickCanonicalPublishHandoffV1({
          supabase, accountKey, actorUserId: auth.userId, candidateKey,
          listingPackageId,
        })
        visualPublicationGate =
          await loadFinalListingReviewPublicationGate({
            supabase, listingPackageId, actorId: auth.userId,
          })
      }
      if (!visualPublicationGate.allowed) return response({
        success: false,
        error: visualPublicationGate.reason ??
          "QUICK_PICK_CANONICAL_PUBLISH_IMAGE_GATE_NOT_READY",
        handoff: canonical.handoff,
        visualPublicationGate,
        safety: { marketplaceWrites: 0, listingPublications: 0,
          canPublish: false, customerProductionTouched: false },
      }, 409)
      return response({ success: true,
        listingPackage: canonical.listingPackage,
        opportunity: canonical.opportunity,
        handoff: canonical.handoff,
        visualPublicationGate,
        automaticImageAuthorityReused,
        safety: { marketplaceWrites: 0, listingPublications: 0,
          canPublish: false, customerProductionTouched: false } })
    }
    if (body.action === "RECEIVE") {
      const receipt = await receiveLunaQuickPickBatchV1({
        supabase: getSupabaseAdminClient(), urls: body.urls,
      })
      return response({ success: true, receipt,
        safety: { marketplaceWrites: 0, canPublish: false,
          customerProductionTouched: false } }, 202)
    }
    const batchId = typeof body.batchId === "string" ? body.batchId : null
    if (body.action === "REHYDRATE") {
      if (!batchId) return response({ success: false,
        error: "LUNA_QUICK_PICK_BATCH_ID_REQUIRED" }, 400)
      const supabase = getSupabaseAdminClient()
      const rehydration = await readLunaQuickPickBatchRehydrationV1({
        supabase, batchId,
      })
      if (!rehydration.rehydrateUrls.length) return response({ success: true,
        result: { inputCount: rehydration.originalBatchOperationCount,
          cards: rehydration.storedCards },
        receipt: { batchId, cards: rehydration.storedCards },
        rehydration: { originalBatchOperationCount:
          rehydration.originalBatchOperationCount,
        rehydratedInputCount: 0, alreadyRehydrated: true,
        newOperationCount: 0, duplicateOperationCount: 0,
        marketplaceWrites: 0 },
        safety: { marketplaceWrites: 0, canPublish: false,
          customerProductionTouched: false } })
      const capabilityGaps = [...rehydration.capabilityGaps.values()]
      const partialResult = await processLunaQuickPickBatchV1({
        supabase, accountKey, urls: rehydration.rehydrateUrls,
        taxonomyReader: getEbayTaxonomyListingIntelligence,
        productIdentifierPolicyReader: preflightEbayCategoryProductIdentifiers,
        batchId,
        onDemandDemandDiscovery: async ({ lunaCatalogRow }) => {
          const candidate = record(lunaCatalogRow)
          const gap = capabilityGaps.find((entry) =>
            entry.lunaProductId === candidate.supplier_product_id &&
            entry.lunaVariantId === candidate.supplier_variant_id &&
            entry.supplierSku === candidate.sku)
          if (!gap) throw new Error(
            "LUNA_QUICK_PICK_DURABLE_DEMAND_EVIDENCE_REQUIRED")
          return buildSellerOsOnDemandCapabilityGapFallbackV1({
            lunaCatalogRow,
            reasonCode: gap.reasonCode,
            observedAt: gap.observedAt,
          })
        },
      })
      const identity = (card: LunaQuickPickCardV1) => card.lunaProductId &&
        card.lunaVariantId && card.sourceSku
        ? `${card.lunaProductId}\n${card.lunaVariantId}\n${card.sourceSku}` : null
      const rehydratedByIdentity = new Map(partialResult.cards.flatMap((card) => {
        const key = identity(card)
        return key ? [[key, card] as const] : []
      }))
      const cards = rehydration.storedCards.map((stored) => {
        const key = identity(stored)
        return key ? rehydratedByIdentity.get(key) ?? stored : stored
      })
      if (cards.length !== rehydration.originalBatchOperationCount) throw new Error(
        "LUNA_QUICK_PICK_BATCH_REHYDRATION_RESULT_INCOMPLETE")
      const result = Object.freeze({ ...partialResult,
        inputCount: rehydration.originalBatchOperationCount,
        cards: Object.freeze(cards) })
      const receipt = await completeLunaQuickPickBatchReceiptV1({
        supabase, batchId, result,
      })
      return response({ success: true, result, receipt,
        rehydration: { originalBatchOperationCount:
          rehydration.originalBatchOperationCount,
        rehydratedInputCount: rehydration.rehydrateUrls.length,
        newOperationCount: 0, duplicateOperationCount: 0,
        marketplaceWrites: 0 },
        safety: { marketplaceWrites: 0, canPublish: false,
          customerProductionTouched: false } })
    }
    if (body.action === "PROCESS" && !batchId) return response({ success: false,
      error: "LUNA_QUICK_PICK_BATCH_ID_REQUIRED" }, 400)
    const supabase = getSupabaseAdminClient()
    let result
    try {
      result = await processLunaQuickPickBatchV1({
        supabase, accountKey,
        urls: body.urls,
        selectedVariants: record(body.selectedVariants) as Record<string, string>,
        taxonomyReader: getEbayTaxonomyListingIntelligence,
        productIdentifierPolicyReader: preflightEbayCategoryProductIdentifiers,
        batchId,
      })
    } catch (error) {
      if (batchId) await completeLunaQuickPickBatchReceiptV1({ supabase,
        batchId, failureCode: safeError(error) }).catch(() => undefined)
      throw error
    }
    const receipt = batchId
      ? await completeLunaQuickPickBatchReceiptV1({ supabase, batchId,
        result }) : null
    return response({ success: true, result, receipt,
      safety: { marketplaceWrites: 0, canPublish: false,
        customerProductionTouched: false } })
  } catch (error) {
    return response({ success: false, error: safeError(error),
      safety: { marketplaceWrites: 0, canPublish: false } }, 400)
  }
}
