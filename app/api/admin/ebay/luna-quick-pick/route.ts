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
import { continueLunaQuickPickPostShippingRuntimeV1 } from
  "@/lib/ebay/ebay-quick-pick-post-shipping-continuation-v1"
import { persistQuickPickOwnerExplicitFactV1 } from
  "@/lib/ebay/ebay-quick-pick-owner-fact-capture-v1"
import { buildQuickPickOwnerReadModelV1,
  readRecentDurableQuickPickCandidateKeysV1 } from
  "@/lib/ebay/seller-os-quick-pick-owner-read-model-v1"
import { mergeSellerOsQuickPickPresentationV1 } from
  "@/lib/ebay/seller-os-quick-pick-presentation-v1"
import { persistQuickPickOwnerReviewV1 } from
  "@/lib/ebay/ebay-quick-pick-owner-review-persistence-v1"
import { resolveQuickPickCanonicalPublishHandoffV1 } from
  "@/lib/ebay/ebay-quick-pick-canonical-publish-handoff-v1"
import { readLatestQuickPickRadarOvernightEnrichmentV1 } from
  "@/lib/ebay/ebay-quick-pick-radar-overnight-enrichment-v1"
import { buildSellerOsNightWorkProvenanceReadModelV1,
  readNightWorkProvenanceAuthorityRowsV1 } from
  "@/lib/ebay/seller-os-night-work-provenance-read-model-v1"
import { loadFinalListingReviewPublicationGate } from
  "@/lib/ebay/final-listing-review-publication-gate"
import { ensureAutomaticLunaSupplierImagesV1 } from
  "@/lib/ebay/luna-supplier-image-auto-runtime-v1"
import { persistQuickPickRequiredUpcResolutionV1 } from
  "@/lib/ebay/ebay-quick-pick-required-upc-resolution-v1"
import { preflightEbayCategoryProductIdentifiers } from
  "@/lib/ebay/ebay-draft-only-gateway"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"
import { SELLER_OS_ACCESS_ROLES } from
  "@/lib/seller-os-access-control"

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
    const explicitCandidateScope = keys.length > 0
    const selectedReceipt = explicitCandidateScope ? null : receipts[0] ?? null
    const selectedBatchKeys = selectedReceipt?.candidateKeys ?? []
    const globalQueueKeys = explicitCandidateScope ? []
      : await readRecentDurableQuickPickCandidateKeysV1({ supabase })
    const [selectedDurableCards, globalDurableCards] = await Promise.all([
      readLunaQuickPickProgressV1({ supabase, accountKey,
        candidateKeys: explicitCandidateScope ? keys : selectedBatchKeys,
        includeRecent: false }),
      explicitCandidateScope ? Promise.resolve([]) :
        readLunaQuickPickProgressV1({ supabase, accountKey,
          candidateKeys: globalQueueKeys, includeRecent: false }),
    ])
    const selectedBatchCards = explicitCandidateScope
      ? selectedDurableCards
      : mergeProgress(selectedReceipt?.cards ?? [], selectedDurableCards)
    const overnightOutcomes = Array.isArray(record(overnightEnrichment).outcomes)
      ? record(overnightEnrichment).outcomes as unknown[] : []
    const authorityOperationIds = [...new Set([
      ...selectedBatchCards.flatMap((card) =>
        card.opportunityId ? [card.opportunityId] : []),
      ...(explicitCandidateScope
        ? selectedDurableCards : globalDurableCards).flatMap((card) =>
        card.opportunityId ? [card.opportunityId] : []),
      ...overnightOutcomes.flatMap((value) => {
        const operationId = uuid(record(value).opportunityId)
        return operationId ? [operationId] : []
      }),
    ])]
    const provenanceRows = await readNightWorkProvenanceAuthorityRowsV1({
      supabase, operationIds: authorityOperationIds,
    })
    const readModel = buildQuickPickOwnerReadModelV1({ receipts,
      selectedBatchCards,
      globalQueueCards: explicitCandidateScope
        ? selectedDurableCards : globalDurableCards,
      explicitCandidateScope, authorityRows: provenanceRows })
    const nightWorkProvenance = buildSellerOsNightWorkProvenanceReadModelV1({
      authorityRows: provenanceRows, receipts,
      currentCards: readModel.globalQueue.cards, overnightEnrichment,
    })
    const progress = readModel.globalQueue.cards
    const ownerLastMileCards = progress.filter((card) =>
      card.ownerTruePublicationBlockers.length > 0)
      .sort((left, right) =>
        left.ownerTruePublicationBlockers.length
          - right.ownerTruePublicationBlockers.length
        || String(left.sourceSku ?? "").localeCompare(
          String(right.sourceSku ?? "")))
    const ownerLastMileCanary = ownerLastMileCards[0]
      ? Object.freeze({
        sourceSku: ownerLastMileCards[0].sourceSku,
        title: ownerLastMileCards[0].title,
        candidateKey: ownerLastMileCards[0].candidateKey,
        listingPackageId: ownerLastMileCards[0].listingPackageId,
        missingRequiredFact:
          ownerLastMileCards[0].ownerTruePublicationBlockers[0]
            ?.specificName ?? null,
        ownerInputSurfaceReady: true,
        safeResumePathReady:
          ownerLastMileCards[0].safeResumeAfterOwnerFact,
      }) : null
    return response({ success: true, progress,
      summary: { ...readModel.globalQueue.summary,
      ownerLastMileProducts: ownerLastMileCards.length,
      ownerLastMileFacts: ownerLastMileCards.reduce((total, card) =>
        total + card.ownerTruePublicationBlockers.length, 0) },
      receipt: receipts[0] ?? null, receipts,
      ownerLastMileCanary,
      readModel,
      nightWorkProvenance,
      readOnly: true,
      continuationExecuted: false,
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
    if (body.action === "OWNER_FACT_CAPTURE") {
      if (auth.authenticationMode !== "admin_user"
          || auth.accessRole !== SELLER_OS_ACCESS_ROLES.owner
          || !auth.userId) return response({ success: false,
        error: "QUICK_PICK_OWNER_FACT_OWNER_AUTH_REQUIRED" }, 403)
      const candidateKey = typeof body.candidateKey === "string"
        ? body.candidateKey : ""
      const listingPackageId = typeof body.listingPackageId === "string"
        ? body.listingPackageId : ""
      const specificName = typeof body.specificName === "string"
        ? body.specificName : ""
      const exactValue = typeof body.exactValue === "string"
        ? body.exactValue : ""
      const ownerFact = await persistQuickPickOwnerExplicitFactV1({
        supabase: getSupabaseAdminClient(), accountKey,
        actorUserId: auth.userId, candidateKey, listingPackageId,
        specificName, exactValue,
      })
      const progress = await readLunaQuickPickProgressV1({
        supabase: getSupabaseAdminClient(), candidateKeys: [candidateKey],
        accountKey,
      })
      return response({ success: true, ownerFact, progress,
        safety: { marketplaceWrites: 0, listingPublications: 0,
          listingMutations: 0, canPublish: false,
          customerProductionTouched: false } })
    }
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
    if (body.action === "CONTINUE_FULL_LUNA_EVIDENCE") {
      const batchId = typeof body.batchId === "string" ? body.batchId : null
      if (!batchId) return response({ success: false,
        error: "LUNA_QUICK_PICK_BATCH_ID_REQUIRED" }, 400)
      const supabase = getSupabaseAdminClient()
      const rehydration = await readLunaQuickPickBatchRehydrationV1({
        supabase, batchId,
      })
      const storedCandidateKeys = [...new Set(
        rehydration.storedCards.flatMap((card) =>
          card.candidateKey ? [card.candidateKey] : []),
      )]
      const before = await readLunaQuickPickProgressV1({
        supabase, accountKey, candidateKeys: storedCandidateKeys,
        includeRecent: false,
      })
      const eligibleCandidateKeys = before.flatMap((card) =>
        card.candidateKey
        && card.fullLunaBrandEvidenceReviewPending
        && card.aiCallCount < 1
        && card.stages.SHIPPING === "PASS"
        && card.stages.ECONOMICS === "PASS"
        && card.stages.PRODUCT_TRUTH === "PASS"
        && !card.alreadyLive
          ? [card.candidateKey] : [])
      const postShippingContinuation =
        await continueLunaQuickPickPostShippingRuntimeV1({
          supabase, accountKey, candidateKeys: eligibleCandidateKeys,
          scopeMode: "EXACT_REQUEST",
          taxonomyReader: getEbayTaxonomyListingIntelligence,
          productIdentifierPolicyReader:
            preflightEbayCategoryProductIdentifiers,
        })
      const after = await readLunaQuickPickProgressV1({
        supabase, accountKey, candidateKeys: storedCandidateKeys,
        includeRecent: false,
      })
      const continuationResult = record(
        postShippingContinuation.requiredSpecificsContinuation)
      return response({ success: true,
        runtimeExecution: {
          batchFound: true,
          eligibleCandidateCount: eligibleCandidateKeys.length,
          continuationStarted: Number(continuationResult.claimed ?? 0) > 0,
          continuationCompletedCount: Number(
            continuationResult.productsEvaluated ?? 0),
          state: Number(continuationResult.claimed ?? 0) > 0
            ? "COMPLETED" : "NO_ELIGIBLE_OR_ALREADY_CONSUMED",
        },
        progress: after,
        postShippingContinuation,
        requiredSpecificsContinuation:
          postShippingContinuation.requiredSpecificsContinuation,
        minimumReadinessContinuation:
          postShippingContinuation.minimumReadinessContinuation,
        safety: { marketplaceWrites: 0, listingPublications: 0,
          listingMutations: 0, canPublish: false,
          customerProductionTouched: false } })
    }
    if (!auth.userId) return response({ success: false,
      error: "LUNA_QUICK_PICK_ADMIN_REQUIRED" }, 403)
    if (body.action === "OWNER_REVIEW") {
      const ownerReview = await persistQuickPickOwnerReviewV1({
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
      if (!rehydration.rehydrateUrls.length) {
        const postShippingContinuation =
          await continueLunaQuickPickPostShippingRuntimeV1({
            supabase, accountKey,
            candidateKeys: rehydration.storedCards.flatMap((card) =>
              card.candidateKey && !card.alreadyLive
                ? [card.candidateKey] : []),
            taxonomyReader: getEbayTaxonomyListingIntelligence,
            productIdentifierPolicyReader:
              preflightEbayCategoryProductIdentifiers,
          })
        return response({ success: true,
          result: { inputCount: rehydration.originalBatchOperationCount,
            cards: rehydration.storedCards },
        receipt: { batchId, cards: rehydration.storedCards },
        postShippingContinuation,
        requiredSpecificsContinuation:
          postShippingContinuation.requiredSpecificsContinuation,
        minimumReadinessContinuation:
          postShippingContinuation.minimumReadinessContinuation,
        rehydration: { originalBatchOperationCount:
          rehydration.originalBatchOperationCount,
        rehydratedInputCount: 0, alreadyRehydrated: true,
        newOperationCount: 0, duplicateOperationCount: 0,
        marketplaceWrites: 0 },
        safety: { marketplaceWrites: 0, canPublish: false,
          customerProductionTouched: false } })
      }
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
      const postShippingContinuation =
        await continueLunaQuickPickPostShippingRuntimeV1({
          supabase, accountKey,
          candidateKeys: result.cards.flatMap((card) =>
            card.candidateKey && !card.alreadyLive
              ? [card.candidateKey] : []),
          taxonomyReader: getEbayTaxonomyListingIntelligence,
          productIdentifierPolicyReader:
            preflightEbayCategoryProductIdentifiers,
        })
      return response({ success: true, result, receipt,
        postShippingContinuation,
        requiredSpecificsContinuation:
          postShippingContinuation.requiredSpecificsContinuation,
        minimumReadinessContinuation:
          postShippingContinuation.minimumReadinessContinuation,
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
    const postShippingContinuation =
      await continueLunaQuickPickPostShippingRuntimeV1({
        supabase, accountKey,
        candidateKeys: result.cards.flatMap((card) =>
          card.candidateKey && !card.alreadyLive ? [card.candidateKey] : []),
        taxonomyReader: getEbayTaxonomyListingIntelligence,
        productIdentifierPolicyReader:
          preflightEbayCategoryProductIdentifiers,
      })
    return response({ success: true, result, receipt,
      postShippingContinuation,
      requiredSpecificsContinuation:
        postShippingContinuation.requiredSpecificsContinuation,
      minimumReadinessContinuation:
        postShippingContinuation.minimumReadinessContinuation,
      safety: { marketplaceWrites: 0, canPublish: false,
        customerProductionTouched: false } })
  } catch (error) {
    return response({ success: false, error: safeError(error),
      safety: { marketplaceWrites: 0, canPublish: false } }, 400)
  }
}
