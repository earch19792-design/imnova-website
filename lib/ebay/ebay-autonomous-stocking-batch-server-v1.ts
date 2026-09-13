import "server-only"

import { EBAY_FINAL_PUBLISH_CONFIRMATION,
  preflightEbayCategoryProductIdentifiers } from
  "@/lib/ebay/ebay-draft-only-gateway"
import { getEbayDraftWriteEnvironmentBoundary } from
  "@/lib/ebay/environment-boundaries"
import { publishCurrentRevisionV1 } from
  "@/lib/ebay/ebay-current-publication-executor-server-v1"
import { evaluateCurrentPrepublicationArtifactPolicyV1 } from
  "@/lib/ebay/ebay-current-prepublication-artifact-policy-v1"
import { autonomousGreenfieldCurrentCertificationReadyV1 } from
  "@/lib/ebay/ebay-autonomous-greenfield-current-certification-v1"
import { collectRadarRevenueFactoryCandidateBatchV1,
  ensureRadarCandidateEconomicsPreflightsV1,
  materializeRadarRevenueFactoryCandidateBatchV1,
  resumeRadarFactoryCandidateAfterShippingV1 } from
  "@/lib/ebay/ebay-opportunity-radar-revenue-factory-adapter-v1"
import { getEbayTaxonomyListingIntelligence } from
  "@/lib/ebay/ebay-seller-keyword-demand-gateway"
import { reconcileCurrentFactoryKeywordContinuationsV2_1 } from
  "@/lib/seller-os/current-keyword-continuation-v2-1"
import { materializeSellerOsDeterministicFactoryCandidateV1 } from
  "@/lib/ebay/ebay-smart-stocking-durable-factory-v1"
import { readEbayPackageFeeContextReadonlyV1 } from
  "@/lib/ebay/ebay-package-fee-context-readonly-v1"
import { persistProducedEbayFeeV1, readEbayFeeHandoffV1 } from
  "@/lib/seller-os/ebay-fee-runtime-v1"
import { readSellOneLikeThisV1 } from
  "@/lib/seller-os/sell-one-like-this-runtime-v1"
import { publicationFeeStructureV1 } from
  "@/lib/seller-os/publication-fee-structure-v1"
import { knownBuyerShippingV1 } from
  "@/lib/seller-os/publication-prevalidation-boundary-v1"
import { keywordRecord as record } from
  "@/lib/seller-os/keyword-intelligence-handoff-v1"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { certifyCurrentBatchShippingSlotReadbackV1,
  currentBatchShippingSlotBindingV1,
  currentBatchShippingSlotRolloverV1,
  hydrateCurrentBatchShippingWaitingPackagesV1,
  resolveCurrentBatchSlotExactPackageV1 } from
  "@/lib/ebay/ebay-autonomous-stocking-shipping-slot-v1"

type SupabaseAdmin = ReturnType<typeof getSupabaseAdminClient>
type Row = Record<string, unknown>
type RuntimeResult = Readonly<{ body: Row; status: number }>

const CONTRACT = "AUTONOMOUS_EBAY_STOCKING_BATCH_V1"
const RECOVERABLE_SHIPPING_BLOCKERS = Object.freeze([
  "AUTONOMOUS_STOCKING_SHIPPING_SLOT_BINDING_CONTRADICTION",
  "AUTONOMOUS_STOCKING_SHIPPING_SLOT_ROLLOVER_READBACK_INVALID",
  "AUTONOMOUS_STOCKING_SHIPPING_PACKAGE_AMBIGUOUS",
  "LUNA_SHIPPING_CLAIM_LEASE_EXPIRED_WITHOUT_DURABLE_RESULT",
])

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function numeric(value: unknown): number | null {
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function errorCode(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message.slice(0, 240) : "AUTONOMOUS_STOCKING_BATCH_RUNTIME_FAILED"
}

async function readCurrentBatchExactPackageResolutionV1(input: Readonly<{
  supabase: SupabaseAdmin
  accountKey: string
  slotReadback: unknown
  priorResolution?: unknown
}>) {
  const slot = record(input.slotReadback)
  const opportunityId = text(slot.opportunityId)
  if (!opportunityId || !text(slot.listingPackageId)) {
    throw new Error("AUTONOMOUS_STOCKING_EXACT_SLOT_PACKAGE_NOT_FOUND")
  }
  const [opportunityRead, packageRead] = await Promise.all([
    input.supabase.from("ebay_luna_opportunity_queue").select(
      "id,candidate_key,supplier_product_id,supplier_variant_id,supplier_sku,assessment")
      .eq("id", opportunityId).maybeSingle(),
    input.supabase.from("ebay_listing_packages").select(
      "id,opportunity_id,candidate_key,account_key,status,package_data,created_at,updated_at")
      .eq("account_key", input.accountKey)
      .eq("opportunity_id", opportunityId),
  ])
  if (opportunityRead.error || !opportunityRead.data || packageRead.error) {
    throw new Error("AUTONOMOUS_STOCKING_EXACT_PACKAGE_READ_FAILED")
  }
  return resolveCurrentBatchSlotExactPackageV1({
    accountKey: input.accountKey,
    slotBinding: slot,
    opportunity: opportunityRead.data,
    packageRows: rows(packageRead.data),
    priorResolution: input.priorResolution,
  })
}

async function resumeBatchAfterRecoveredShippingClaimV1(input: Readonly<{
  supabase: SupabaseAdmin
  accountKey: string
}>) {
  let batch: Row | null = null
  let recoveredBlocker = ""
  for (const blocker of RECOVERABLE_SHIPPING_BLOCKERS) {
    const blockedRead = await input.supabase.from(
      "seller_os_autonomous_stocking_batches_v1").select("*")
      .eq("account_key", input.accountKey).eq("status", "BLOCKED")
      .contains("evidence", { firstStructuralBlocker: blocker })
      .order("started_at", { ascending: true }).limit(1).maybeSingle()
    if (blockedRead.error) {
      throw new Error("AUTONOMOUS_STOCKING_BATCH_BLOCKED_READ_FAILED")
    }
    if (blockedRead.data) {
      batch = record(blockedRead.data)
      recoveredBlocker = blocker
      break
    }
  }
  if (!batch || !recoveredBlocker) return null
  const slotRead = await input.supabase.rpc(
    "get_autonomous_stocking_batch_shipping_slot_readback_v1", {
      p_account_key: input.accountKey,
      p_batch_id: text(batch.id),
    })
  if (slotRead.error) {
    throw new Error("AUTONOMOUS_STOCKING_BATCH_SHIPPING_RECOVERY_READ_FAILED")
  }
  const exact = certifyCurrentBatchShippingSlotReadbackV1(slotRead.data)
  if (!exact.slotPresent || !exact.shippingReady) return null
  const readback = record(exact.readback)
  const exactPackageResolution =
    recoveredBlocker === "AUTONOMOUS_STOCKING_SHIPPING_PACKAGE_AMBIGUOUS"
      ? await readCurrentBatchExactPackageResolutionV1({
        supabase: input.supabase,
        accountKey: input.accountKey,
        slotReadback: readback,
        priorResolution: record(batch.evidence)
          .currentBatchSlotExactPackageResolutionV1,
      }) : null
  const rearmed = await input.supabase.from(
    "seller_os_autonomous_stocking_batches_v1").update({
      status: "ACTIVE",
      evidence: { ...record(batch.evidence), recoveredStructuralBlocker: {
        blocker: recoveredBlocker,
        candidateId: readback.canonicalCandidateId,
        captureSessionId: readback.captureSessionId,
        frontierId: readback.frontierId,
        shippingReceiptCommercialIdentityMatch: true,
        foreignReceiptAdopted: false,
        automaticExpiredShippingClaimRecovery: recoveredBlocker ===
          "LUNA_SHIPPING_CLAIM_LEASE_EXPIRED_WITHOUT_DURABLE_RESULT",
      }, ...(exactPackageResolution ? {
        currentBatchSlotExactPackageResolutionV1: exactPackageResolution,
      } : {}) },
      updated_at: new Date().toISOString(),
    }).eq("id", text(batch.id)).eq("account_key", input.accountKey)
      .eq("status", "BLOCKED")
      .contains("evidence", {
        firstStructuralBlocker: recoveredBlocker,
      }).select("*").maybeSingle()
  if (rearmed.error) {
    throw new Error("AUTONOMOUS_STOCKING_BATCH_SHIPPING_RECOVERY_REARM_FAILED")
  }
  return rearmed.data ? record(rearmed.data) : null
}

async function activeCount(input: Readonly<{
  supabase: SupabaseAdmin
  accountKey: string
}>) {
  const result = await input.supabase.rpc(
    "get_autonomous_stocking_active_listing_count_v1", {
      p_account_key: input.accountKey,
    })
  const count = Number(result.data)
  if (result.error || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("AUTONOMOUS_STOCKING_BATCH_ACTIVE_COUNT_READ_FAILED")
  }
  return count
}

function publicationInput(input: Readonly<{
  supabase: SupabaseAdmin
  accountKey: string
  publication: Row
}>) {
  const revision = record(record(record(input.publication.sanitized_result)
    .publicationPreparationV1).current)
  return {
    supabase: input.supabase,
    actor: text(input.publication.actor_user_id),
    accountKey: input.accountKey,
    publicationId: text(input.publication.id),
    packageId: text(input.publication.listing_package_id),
    offerId: text(input.publication.offer_id),
    sku: text(input.publication.sku),
    packageHash: text(revision.packageHash),
    packageGeneration: text(revision.packageGeneration),
    previewHash: text(revision.previewHash),
    idempotencyKey: `publish:${text(input.publication.id)}`,
    confirmation: EBAY_FINAL_PUBLISH_CONFIRMATION,
  }
}

async function readPublication(input: Readonly<{
  supabase: SupabaseAdmin
  accountKey: string
  publicationId: string
  packageId: string
}>) {
  const result = await input.supabase.from(
    "ebay_authorized_listing_publications").select("*")
    .eq("id", input.publicationId)
    .eq("listing_package_id", input.packageId)
    .eq("marketplace_account_key", input.accountKey).single()
  if (result.error || !result.data) {
    throw new Error("AUTONOMOUS_STOCKING_BATCH_PUBLICATION_READ_FAILED")
  }
  return record(result.data)
}

function childDecisionFields(input: Readonly<{
  publication: Row
  current: Row
  materialized: Row
}>) {
  const preview = record(input.publication.preview)
  const offer = record(preview.offerPayload)
  const pricing = record(offer.pricingSummary)
  const price = record(pricing.price)
  const inventory = record(preview.inventoryItemPayload)
  const product = record(inventory.product)
  const economics = record(input.current.publicationEconomics)
  const intake = record(input.materialized.smartStockingListingIntakeV1)
  return {
    title: text(product.title) || null,
    price: numeric(price.value),
    quantity: numeric(offer.availableQuantity),
    decision_profit: numeric(intake.contributionProfitUsd)
      ?? numeric(economics.budgetedProfitBeforePostOrderAdjustments),
    decision_margin: numeric(intake.contributionMarginPercent)
      ?? numeric(economics.budgetedMarginBeforePostOrderAdjustments),
  }
}

async function completePublishedChild(input: Readonly<{
  supabase: SupabaseAdmin
  accountKey: string
  batch: Row
  child: Row
  publicationRow: Row
  publication: Row
  current?: Row
  materialized?: Row
}>) {
  const before = Number(input.child.active_listing_count_before)
  const after = await activeCount(input)
  if (!Number.isFinite(before) || after - before !== 1
      || input.publication.pass !== true
      || input.publication.OFFICIAL_READBACK_PASS !== true
      || input.publication.PUBLISHED_CONFIRMED !== true
      || input.publication.DUPLICATE_LISTING_CREATED !== false
      || input.publication.DUPLICATE_OFFER_CREATED !== false) {
    throw new Error("AUTONOMOUS_STOCKING_BATCH_PUBLICATION_READBACK_INVALID")
  }
  const existingEvidence = record(input.child.evidence)
  const current = input.current ?? record(existingEvidence.current)
  const materialized = input.materialized
    ?? record(existingEvidence.materialized)
  const writeCount = Math.max(
    Number(input.child.publication_write_count ?? 0),
    Number(input.publication.publicationWrites ?? 0),
    input.publicationRow.publish_attempt_count === 1
      && input.publicationRow.publication_idempotency_key
        === `publish:${input.publicationRow.id}`
      && input.publicationRow.listing_id === input.publication.listingId
      ? 1 : 0,
  )
  if (writeCount !== 1) {
    throw new Error("AUTONOMOUS_STOCKING_BATCH_PUBLICATION_WRITE_COUNT_INVALID")
  }
  const updated = await input.supabase.from(
    "seller_os_autonomous_stocking_batch_children_v1").update({
      status: "PUBLISHED_CONFIRMED",
      offer_id: input.publicationRow.offer_id,
      listing_id: input.publication.listingId,
      active_listing_count_after: after,
      publication_write_count: 1,
      official_readback_pass: true,
      duplicate_listing_created: false,
      duplicate_offer_created: false,
      published_confirmed_at: new Date().toISOString(),
      ...childDecisionFields({ publication: input.publicationRow,
        current, materialized }),
      evidence: { ...existingEvidence, current, materialized,
        publication: input.publication,
        publicationCommitReadbackPass: true },
      updated_at: new Date().toISOString(),
    }).eq("id", text(input.child.id)).eq("batch_id", text(input.batch.id))
      .in("status", ["PREPUBLICATION_READY", "PUBLISHING"])
      .select("*").single()
  if (updated.error || !updated.data) {
    throw new Error("AUTONOMOUS_STOCKING_BATCH_CHILD_COMPLETE_FAILED")
  }
  const publicationCount = await input.supabase.from(
    "seller_os_autonomous_stocking_batch_children_v1")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", text(input.batch.id))
    .in("status", ["PUBLISHED_CONFIRMED", "REPLAY_CONFIRMED"])
  if (publicationCount.error || publicationCount.count === null) {
    throw new Error("AUTONOMOUS_STOCKING_BATCH_COUNT_READ_FAILED")
  }
  const batchUpdate = await input.supabase.from(
    "seller_os_autonomous_stocking_batches_v1").update({
      publication_write_count: publicationCount.count,
      updated_at: new Date().toISOString(),
    }).eq("id", text(input.batch.id)).eq("status", "ACTIVE")
  if (batchUpdate.error) {
    throw new Error("AUTONOMOUS_STOCKING_BATCH_COUNT_WRITE_FAILED")
  }
  return record(updated.data)
}

async function finishBatchIfReady(input: Readonly<{
  supabase: SupabaseAdmin
  accountKey: string
  batch: Row
}>) {
  const children = await input.supabase.from(
    "seller_os_autonomous_stocking_batch_children_v1")
    .select("id,status,publication_write_count,official_readback_pass,idempotent_replay_confirmed,duplicate_listing_created,duplicate_offer_created")
    .eq("batch_id", text(input.batch.id)).order("sequence_no")
  if (children.error) {
    throw new Error("AUTONOMOUS_STOCKING_BATCH_FINAL_CHILD_READ_FAILED")
  }
  const values = rows(children.data)
  const target = Number(input.batch.target_published_count)
  if (values.length !== target || values.some((child) =>
    child.status !== "REPLAY_CONFIRMED"
    || child.publication_write_count !== 1
    || child.official_readback_pass !== true
    || child.idempotent_replay_confirmed !== true
    || child.duplicate_listing_created !== false
    || child.duplicate_offer_created !== false)) return false
  const finalCount = await activeCount(input)
  if (finalCount - Number(input.batch.baseline_active_count) !== target) {
    throw new Error("AUTONOMOUS_STOCKING_BATCH_ACTIVE_DELTA_INVALID")
  }
  const complete = await input.supabase.from(
    "seller_os_autonomous_stocking_batches_v1").update({
      status: "COMPLETED", final_active_count: finalCount,
      publication_write_count: target, ads_write_count: 0,
      completed_at: new Date().toISOString(),
      evidence: { ...record(input.batch.evidence),
        allThreeOfficialReadbackPass: true,
        allThreeIdempotentReplayPass: true,
        duplicateListingCount: 0, duplicateOfferCount: 0 },
      updated_at: new Date().toISOString(),
    }).eq("id", text(input.batch.id)).eq("status", "ACTIVE")
      .select("*").single()
  if (complete.error || !complete.data) {
    throw new Error("AUTONOMOUS_STOCKING_BATCH_FINALIZATION_FAILED")
  }
  return true
}

async function executeBatch(input: Readonly<{
  supabase: SupabaseAdmin
  accountKey: string
  request: Request
  batch: Row
}>): Promise<RuntimeResult> {
  const ensured = await input.supabase.rpc(
    "ensure_autonomous_stocking_batch_child_v1", {
      p_account_key: input.accountKey,
      p_batch_id: text(input.batch.id),
    })
  if (ensured.error) {
    throw new Error("AUTONOMOUS_STOCKING_BATCH_CHILD_ENSURE_FAILED")
  }
  let child = record(ensured.data)
  if (!child.id) {
    const completed = await finishBatchIfReady(input)
    return { status: completed ? 200 : 409, body: {
      success: completed, contractVersion: CONTRACT,
      status: completed ? "COMPLETED" : "BATCH_FINALIZATION_PENDING",
      batchId: input.batch.id, OWNER_ACTION_REQUIRED: false,
      CODEX_RUNTIME_DEPENDENCY: false, LEGACY_DEPENDENCY_COUNT: 0,
      safety: { concurrency: 1, marketplaceWrites: 0,
        publicationWrites: 0, adsWrites: 0, blindRetryAllowed: false },
    } }
  }

  if (child.status === "PUBLISHED_CONFIRMED") {
    const publicationRow = await readPublication({ ...input,
      publicationId: text(child.publication_id),
      packageId: text(child.listing_package_id) })
    const replay = record(await publishCurrentRevisionV1(
      publicationInput({ ...input, publication: publicationRow })))
    const pass = replay.pass === true && replay.publicationWrites === 0
      && replay.IDEMPOTENT_REPLAY_CONFIRMED === true
      && replay.listingId === child.listing_id
      && replay.DUPLICATE_LISTING_CREATED === false
      && replay.DUPLICATE_OFFER_CREATED === false
    if (!pass) return { status: 409, body: {
      success: false, contractVersion: CONTRACT,
      status: "REPLAY_READBACK_REQUIRED", batchId: input.batch.id,
      sequenceNo: child.sequence_no, publication: replay,
      OWNER_ACTION_REQUIRED: false, CODEX_RUNTIME_DEPENDENCY: false,
      safety: { concurrency: 1, marketplaceWrites: 0,
        publicationWrites: 0, adsWrites: 0, blindRetryAllowed: false },
    } }
    const replayed = await input.supabase.from(
      "seller_os_autonomous_stocking_batch_children_v1").update({
        status: "REPLAY_CONFIRMED", idempotent_replay_confirmed: true,
        additional_publication_write_count: 0,
        replay_confirmed_at: new Date().toISOString(),
        evidence: { ...record(child.evidence), replay },
        updated_at: new Date().toISOString(),
      }).eq("id", text(child.id)).eq("status", "PUBLISHED_CONFIRMED")
      .select("*").single()
    if (replayed.error || !replayed.data) {
      throw new Error("AUTONOMOUS_STOCKING_BATCH_REPLAY_PERSIST_FAILED")
    }
    const batchCompleted = Number(child.sequence_no)
      === Number(input.batch.target_published_count)
      ? await finishBatchIfReady(input) : false
    return { status: 200, body: {
      success: true, contractVersion: CONTRACT,
      status: batchCompleted ? "COMPLETED" : "REPLAY_CONFIRMED",
      batchId: input.batch.id, sequenceNo: child.sequence_no,
      publication: replay, ADDITIONAL_PUBLICATION_WRITE_COUNT: 0,
      SECOND_LISTING_CREATED: false,
      IDEMPOTENT_REPLAY_CONFIRMED: true,
      OWNER_ACTION_REQUIRED: false, CODEX_RUNTIME_DEPENDENCY: false,
      LEGACY_DEPENDENCY_COUNT: 0,
      safety: { concurrency: 1, marketplaceWrites: 0,
        publicationWrites: 0, adsWrites: 0, blindRetryAllowed: false },
    } }
  }

  if (child.publication_id && ["PREPUBLICATION_READY", "PUBLISHING"]
      .includes(text(child.status))) {
    const publicationRow = await readPublication({ ...input,
      publicationId: text(child.publication_id),
      packageId: text(child.listing_package_id) })
    const publication = record(await publishCurrentRevisionV1(
      publicationInput({ ...input, publication: publicationRow })))
    if (publication.pass !== true) {
      await input.supabase.from(
        "seller_os_autonomous_stocking_batch_children_v1").update({
          status: "PUBLISHING",
          publication_write_count: Math.max(
            Number(child.publication_write_count ?? 0),
            Number(publication.publicationWrites ?? 0)),
          evidence: { ...record(child.evidence), publication },
          updated_at: new Date().toISOString(),
        }).eq("id", text(child.id))
      return { status: 409, body: {
        success: false, contractVersion: CONTRACT,
        status: "UNKNOWN_COMMIT_STATE", batchId: input.batch.id,
        sequenceNo: child.sequence_no, publication,
        OWNER_ACTION_REQUIRED: false,
        safety: { concurrency: 1,
          marketplaceWrites: Number(publication.publicationWrites ?? 0),
          publicationWrites: Number(publication.publicationWrites ?? 0),
          adsWrites: 0, blindRetryAllowed: false },
      } }
    }
    child = await completePublishedChild({ ...input, child, publicationRow,
      publication })
    const additionalWrites = Number(publication.publicationWrites ?? 0)
    return { status: 200, body: {
      success: true, contractVersion: CONTRACT,
      status: "PUBLISHED_CONFIRMED", batchId: input.batch.id,
      sequenceNo: child.sequence_no, selection: child, publication,
      PUBLICATION_COMMIT_READBACK_PASS: true,
      PUBLICATION_WRITE_COUNT: 1,
      ADDITIONAL_PUBLICATION_WRITE_COUNT: additionalWrites,
      PUBLISH_OFFER_CALLED: additionalWrites === 1,
      RECONCILED_EXISTING_PUBLICATION: additionalWrites === 0,
      DUPLICATE_LISTING_CREATED: false, DUPLICATE_OFFER_CREATED: false,
      OWNER_ACTION_REQUIRED: false, CODEX_RUNTIME_DEPENDENCY: false,
      LEGACY_DEPENDENCY_COUNT: 0,
      safety: { concurrency: 1, marketplaceWrites: additionalWrites,
        publicationWrites: additionalWrites, adsWrites: 0,
        blindRetryAllowed: false },
    } }
  }

  let selectionEvidence: Row = {}
  if (!child.listing_package_id) {
    const existingSlot = record(record(child.evidence).currentShippingSlotV1)
    let exactSlot: ReturnType<
      typeof certifyCurrentBatchShippingSlotReadbackV1> | null = null
    if (Object.keys(existingSlot).length) {
      const slotRead = await input.supabase.rpc(
        "get_autonomous_stocking_batch_shipping_slot_readback_v1", {
          p_account_key: input.accountKey,
          p_batch_id: text(input.batch.id),
        })
      if (slotRead.error) {
        throw new Error("AUTONOMOUS_STOCKING_SHIPPING_SLOT_READ_FAILED")
      }
      exactSlot = certifyCurrentBatchShippingSlotReadbackV1(slotRead.data)
      if (!exactSlot.slotPresent) {
        throw new Error("AUTONOMOUS_STOCKING_SHIPPING_SLOT_DURABILITY_MISMATCH")
      }
      if (!exactSlot.shippingReady) return { status: 202, body: {
        success: false, contractVersion: CONTRACT,
        status: "CURRENT_EXACT_SHIPPING_CAPTURE_PENDING",
        batchId: input.batch.id, sequenceNo: child.sequence_no,
        shippingSlot: exactSlot.readback,
        TARGET_ACTIVE_CAPTURE_COUNT:
          record(exactSlot.readback).targetActiveCaptureCount,
        FOREIGN_RECEIPT_ADOPTED: false,
        MANUAL_IDENTITY_REBIND: false,
        CODEX_RUNTIME_DEPENDENCY: false,
        OWNER_ACTION_REQUIRED: false,
        safety: { concurrency: 1, marketplaceWrites: 0,
          publicationWrites: 0, adsWrites: 0 },
      } }
    }
    let exactShippingContinuation: Row | null = null
    let exactPackageResolution: Row | null = null
    if (exactSlot?.shippingReady) {
      const exactReadback = record(exactSlot.readback)
      exactPackageResolution = record(
        await readCurrentBatchExactPackageResolutionV1({
          supabase: input.supabase,
          accountKey: input.accountKey,
          slotReadback: exactReadback,
          priorResolution: record(input.batch.evidence)
            .currentBatchSlotExactPackageResolutionV1,
        }))
      exactShippingContinuation = record(
        await resumeRadarFactoryCandidateAfterShippingV1({
          supabase: input.supabase,
          accountKey: input.accountKey,
          candidateId: text(exactReadback.canonicalCandidateId),
          lunaProductId: text(exactReadback.productId),
          lunaVariantId: text(exactReadback.variantId),
          supplierSku: text(exactReadback.supplierSku),
          taxonomyReader: getEbayTaxonomyListingIntelligence,
          productIdentifierPolicyReader:
            preflightEbayCategoryProductIdentifiers,
        }))
      if (exactShippingContinuation.applicable !== true ||
          exactShippingContinuation.durableReadback !== true ||
          exactShippingContinuation.marketplaceWrites !== 0 ||
          exactShippingContinuation.candidateId !==
            exactReadback.canonicalCandidateId ||
          exactShippingContinuation.listingPackageId !==
            exactPackageResolution.listingPackageId) {
        throw new Error(
          "AUTONOMOUS_STOCKING_EXACT_SHIPPING_CONTINUATION_INVALID")
      }
    }
    let batch = await collectRadarRevenueFactoryCandidateBatchV1({
      supabase: input.supabase, accountKey: input.accountKey,
      targetCandidates: 100,
    })
    const economics = await ensureRadarCandidateEconomicsPreflightsV1({
      supabase: input.supabase, accountKey: input.accountKey, batch,
    })
    if (economics.attempted > 0) {
      batch = await collectRadarRevenueFactoryCandidateBatchV1({
        supabase: input.supabase, accountKey: input.accountKey,
        targetCandidates: 100,
      })
    }
    let factory = await materializeRadarRevenueFactoryCandidateBatchV1({
      supabase: input.supabase, accountKey: input.accountKey, batch,
      taxonomyReader: getEbayTaxonomyListingIntelligence,
      productIdentifierPolicyReader: preflightEbayCategoryProductIdentifiers,
    })
    const keyword = await reconcileCurrentFactoryKeywordContinuationsV2_1({
      supabase: input.supabase, accountKey: input.accountKey,
    })
    if (keyword.status === "PASS" && factory.listingReady === 0) {
      factory = await materializeRadarRevenueFactoryCandidateBatchV1({
        supabase: input.supabase, accountKey: input.accountKey, batch,
        taxonomyReader: getEbayTaxonomyListingIntelligence,
        productIdentifierPolicyReader: preflightEbayCategoryProductIdentifiers,
      })
    }
    const profile = await input.supabase.from("ebay_account_policy_profiles")
      .select("*").eq("account_key", input.accountKey)
      .eq("marketplace_id", "EBAY_US").maybeSingle()
    if (profile.error || !profile.data) {
      throw new Error("CURRENT_ACCOUNT_POLICY_AUTHORITY_REQUIRED")
    }
    const prior = await input.supabase.from(
      "seller_os_autonomous_stocking_batch_children_v1")
      .select("candidate_id,listing_package_id").eq("batch_id", input.batch.id)
    if (prior.error) {
      throw new Error("AUTONOMOUS_STOCKING_BATCH_PRIOR_CHILD_READ_FAILED")
    }
    const priorCandidates = new Set(rows(prior.data)
      .map((value) => text(value.candidate_id)).filter(Boolean))
    const priorPackages = new Set(rows(prior.data)
      .map((value) => text(value.listing_package_id)).filter(Boolean))
    let selection: Row | null = null
    const rawFactoryOutcomes = factory.outcomes.map(record)
    const exactCandidateId = exactSlot?.shippingReady
      ? text(record(exactSlot.readback).canonicalCandidateId) : ""
    const nonExactFactoryOutcomes = rawFactoryOutcomes.filter((outcome) =>
      !exactCandidateId || outcome.candidateId !== exactCandidateId)
    const waitingOpportunityIds = nonExactFactoryOutcomes.filter((outcome) =>
      outcome.reasonCode === "WAITING_BROWSER_WORKER" &&
      outcome.shippingJobIdentityMatch === true &&
      text(outcome.opportunityId)).map((outcome) =>
      text(outcome.opportunityId))
    let hydratedFactoryOutcomes = nonExactFactoryOutcomes
    if (waitingOpportunityIds.length) {
      const packageRead = await input.supabase.from("ebay_listing_packages")
        .select("id,opportunity_id,account_key")
        .eq("account_key", input.accountKey)
        .in("opportunity_id", waitingOpportunityIds)
      if (packageRead.error) {
        throw new Error("AUTONOMOUS_STOCKING_SHIPPING_PACKAGE_READ_FAILED")
      }
      hydratedFactoryOutcomes = [
        ...hydrateCurrentBatchShippingWaitingPackagesV1({
          accountKey: input.accountKey,
          factoryOutcomes: nonExactFactoryOutcomes,
          packageRows: rows(packageRead.data),
        }),
      ]
    }
    const exactOutcome = exactShippingContinuation ? {
      candidateId: exactShippingContinuation.candidateId,
      opportunityId: exactShippingContinuation.opportunityId,
      listingPackageId: exactShippingContinuation.listingPackageId,
      candidateKey: exactShippingContinuation.candidateKey,
      lunaProductId: exactShippingContinuation.lunaProductId,
      lunaVariantId: exactShippingContinuation.lunaVariantId,
      supplierSku: exactShippingContinuation.supplierSku,
      status: exactShippingContinuation.parkedEconomics === true
        ? "PARKED_ECONOMICS" : "PARKED",
      reasonCode: exactShippingContinuation.firstBlocker,
      listingReady: exactShippingContinuation.listingReady,
      exactShippingCurrentCertificationReady:
        exactShippingContinuation.currentCertificationReady === true,
    } : null
    const currentOutcomes = exactOutcome
      ? [exactOutcome, ...hydratedFactoryOutcomes.filter((outcome) =>
        outcome.candidateId !== exactOutcome.candidateId)]
      : hydratedFactoryOutcomes
    for (const outcome of currentOutcomes) {
      if (!(autonomousGreenfieldCurrentCertificationReadyV1(outcome) ||
          outcome.exactShippingCurrentCertificationReady === true)
          || !outcome.listingPackageId || !outcome.opportunityId
          || !outcome.candidateKey || !outcome.lunaProductId
          || !outcome.lunaVariantId || !outcome.supplierSku
          || exactSlot?.shippingReady && outcome.candidateId !==
            record(exactSlot.readback).canonicalCandidateId
          || priorCandidates.has(text(outcome.candidateId))
          || priorPackages.has(text(outcome.listingPackageId))) continue
      const [packageRead, opportunityRead, publicationRead] =
        await Promise.all([
          input.supabase.from("ebay_listing_packages").select("*")
            .eq("id", text(outcome.listingPackageId))
            .eq("account_key", input.accountKey).maybeSingle(),
          input.supabase.from("ebay_luna_opportunity_queue").select("*")
            .eq("id", text(outcome.opportunityId)).maybeSingle(),
          input.supabase.from("ebay_authorized_listing_publications")
            .select("id").eq("listing_package_id",
              text(outcome.listingPackageId)).limit(1),
        ])
      if (packageRead.error || !packageRead.data || opportunityRead.error
          || !opportunityRead.data || publicationRead.error
          || publicationRead.data?.length) continue
      const policy = evaluateCurrentPrepublicationArtifactPolicyV1({
        listingPackage: packageRead.data,
        opportunity: opportunityRead.data,
        accountProfile: profile.data,
        accountKey: input.accountKey,
      })
      if (!policy.pass) continue
      selection = outcome
      break
    }
    selectionEvidence = { automaticCandidateBatch: {
      evaluated: factory.lunaProductsEvaluated,
      listingReady: factory.listingReady, parked: factory.parked,
      exceptions: factory.exceptions,
      alreadyLiveExcluded: factory.alreadyLiveExcludedCount,
      waitingBrowserWorker: factory.waitingBrowserWorker,
      autonomouslyContinued: true,
    }, economics, keywordStatus: keyword.status,
      exactShippingContinuation,
      exactPackageResolution,
      manualProductSelection: false, manualProductIdInjection: false,
      codexRuntimeDependency: false }
    if (!selection) {
      const rollover = exactSlot?.shippingReady
        ? currentBatchShippingSlotRolloverV1({
          accountKey: input.accountKey,
          factoryOutcomes: currentOutcomes,
          readySlotReadback: exactSlot.readback,
        }) : null
      if (rollover) {
        const rolled = await input.supabase.rpc(
          "rollover_autonomous_stocking_batch_shipping_slot_v1", {
            p_account_key: input.accountKey,
            p_batch_id: text(input.batch.id),
            p_child_id: text(child.id),
            p_prior_candidate_id: rollover.priorCandidateId,
            p_retirement_status: rollover.retirementStatus,
            p_retirement_reason: rollover.retirementReason,
            p_canonical_candidate_id: rollover.next.canonicalCandidateId,
            p_opportunity_id: rollover.next.opportunityId,
            p_listing_package_id: rollover.next.listingPackageId,
            p_product_id: rollover.next.productId,
            p_variant_id: rollover.next.variantId,
            p_supplier_sku: rollover.next.supplierSku,
          })
        if (rolled.error || !rolled.data) {
          throw new Error(
            "AUTONOMOUS_STOCKING_SHIPPING_SLOT_ROLLOVER_FAILED")
        }
        const rolloverReadback = await input.supabase.rpc(
          "get_autonomous_stocking_batch_shipping_slot_readback_v1", {
            p_account_key: input.accountKey,
            p_batch_id: text(input.batch.id),
          })
        if (rolloverReadback.error) {
          throw new Error("AUTONOMOUS_STOCKING_SHIPPING_SLOT_READ_FAILED")
        }
        const nextExact = certifyCurrentBatchShippingSlotReadbackV1(
          rolloverReadback.data)
        if (!nextExact.slotPresent) {
          throw new Error(
            "AUTONOMOUS_STOCKING_SHIPPING_SLOT_ROLLOVER_READBACK_INVALID")
        }
        return { status: 202, body: {
          success: false, contractVersion: CONTRACT,
          status: nextExact.shippingReady
            ? "CURRENT_EXACT_SHIPPING_READY"
            : "CURRENT_EXACT_SHIPPING_CAPTURE_PENDING",
          batchId: input.batch.id, sequenceNo: child.sequence_no,
          priorSlot: { canonicalCandidateId: rollover.priorCandidateId,
            status: rollover.retirementStatus,
            reasonCode: rollover.retirementReason },
          shippingSlot: nextExact.readback,
          AUTONOMOUS_CANDIDATE_CONTINUATION: true,
          TARGET_ACTIVE_CAPTURE_COUNT:
            record(nextExact.readback).targetActiveCaptureCount,
          FOREIGN_RECEIPT_ADOPTED: false,
          MANUAL_IDENTITY_REBIND: false,
          CODEX_RUNTIME_DEPENDENCY: false,
          OWNER_ACTION_REQUIRED: false,
          safety: { concurrency: 1, marketplaceWrites: 0,
            publicationWrites: 0, adsWrites: 0 },
        } }
      }
      const slot = currentBatchShippingSlotBindingV1({
        accountKey: input.accountKey,
        factoryOutcomes: currentOutcomes,
        existingBinding: Object.keys(existingSlot).length
          ? existingSlot : undefined,
      })
      if (slot && !Object.keys(existingSlot).length) {
        const binding = await input.supabase.rpc(
          "bind_autonomous_stocking_batch_shipping_slot_v1", {
            p_account_key: input.accountKey,
            p_batch_id: text(input.batch.id),
            p_child_id: text(child.id),
            p_canonical_candidate_id: slot.canonicalCandidateId,
            p_opportunity_id: slot.opportunityId,
            p_listing_package_id: slot.listingPackageId,
            p_product_id: slot.productId,
            p_variant_id: slot.variantId,
            p_supplier_sku: slot.supplierSku,
          })
        if (binding.error || !binding.data) {
          throw new Error("AUTONOMOUS_STOCKING_SHIPPING_SLOT_BIND_FAILED")
        }
        const readback = await input.supabase.rpc(
          "get_autonomous_stocking_batch_shipping_slot_readback_v1", {
            p_account_key: input.accountKey,
            p_batch_id: text(input.batch.id),
          })
        if (readback.error) {
          throw new Error("AUTONOMOUS_STOCKING_SHIPPING_SLOT_READ_FAILED")
        }
        const exact = certifyCurrentBatchShippingSlotReadbackV1(readback.data)
        if (!exact.slotPresent) {
          throw new Error("AUTONOMOUS_STOCKING_SHIPPING_SLOT_DURABILITY_MISMATCH")
        }
        return { status: 202, body: {
          success: false, contractVersion: CONTRACT,
          status: exact.shippingReady
            ? "CURRENT_EXACT_SHIPPING_READY_REEVALUATION_PENDING"
            : "CURRENT_EXACT_SHIPPING_CAPTURE_PENDING",
          batchId: input.batch.id, sequenceNo: child.sequence_no,
          shippingSlot: exact.readback,
          TARGET_ACTIVE_CAPTURE_COUNT:
            record(exact.readback).targetActiveCaptureCount,
          FOREIGN_RECEIPT_ADOPTED: false,
          MANUAL_IDENTITY_REBIND: false,
          CODEX_RUNTIME_DEPENDENCY: false,
          OWNER_ACTION_REQUIRED: false,
          safety: { concurrency: 1, marketplaceWrites: 0,
            publicationWrites: 0, adsWrites: 0 },
        } }
      }
      await input.supabase.from(
        "seller_os_autonomous_stocking_batch_children_v1").update({
          evidence: { ...record(child.evidence), ...selectionEvidence },
          updated_at: new Date().toISOString(),
        }).eq("id", text(child.id)).eq("status", "SELECTING")
      return { status: 202, body: {
        success: false, contractVersion: CONTRACT,
        status: "AUTONOMOUS_CANDIDATE_CONTINUATION_PENDING",
        batchId: input.batch.id, sequenceNo: child.sequence_no,
        selectionEvidence, AUTONOMOUS_CANDIDATE_CONTINUATION: true,
        MANUAL_PRODUCT_SELECTION: false,
        MANUAL_PRODUCT_ID_INJECTION: false,
        CODEX_RUNTIME_DEPENDENCY: false, OWNER_ACTION_REQUIRED: false,
        safety: { concurrency: 1, marketplaceWrites: 0,
          publicationWrites: 0, adsWrites: 0 },
      } }
    }
    const claimed = await input.supabase.rpc(
      "claim_autonomous_stocking_batch_candidate_v1", {
        p_account_key: input.accountKey,
        p_batch_id: text(input.batch.id),
        p_child_id: text(child.id),
        p_candidate_id: text(selection.candidateId),
        p_opportunity_id: text(selection.opportunityId),
        p_candidate_key: text(selection.candidateKey),
        p_listing_package_id: text(selection.listingPackageId),
        p_product_id: text(selection.lunaProductId),
        p_variant_id: text(selection.lunaVariantId),
        p_supplier_sku: text(selection.supplierSku),
        p_evidence: selectionEvidence,
      })
    if (claimed.error || !claimed.data) {
      throw new Error("AUTONOMOUS_STOCKING_BATCH_CANDIDATE_CLAIM_FAILED")
    }
    child = record(claimed.data)
  }

  const materialized = record(
    await materializeSellerOsDeterministicFactoryCandidateV1({
      supabase: input.supabase, accountKey: input.accountKey,
      opportunityId: text(child.opportunity_id),
      candidateKey: text(child.candidate_key),
      taxonomyReader: getEbayTaxonomyListingIntelligence,
      productIdentifierPolicyReader: preflightEbayCategoryProductIdentifiers,
    }))
  if (materialized.listingPackageId !== child.listing_package_id
      || !autonomousGreenfieldCurrentCertificationReadyV1(materialized)) {
    return { status: 202, body: {
      success: false, contractVersion: CONTRACT,
      status: "CURRENT_PREPUBLICATION_CONTINUATION_PENDING",
      batchId: input.batch.id, sequenceNo: child.sequence_no,
      selection: child, materialized,
      AUTONOMOUS_CANDIDATE_CONTINUATION: true,
      OWNER_ACTION_REQUIRED: false,
      safety: { concurrency: 1, marketplaceWrites: 0,
        publicationWrites: 0, adsWrites: 0 },
    } }
  }
  const packageId = text(child.listing_package_id)
  const now = new Date()
  const currentFee = await readEbayFeeHandoffV1({
    supabase: input.supabase, accountKey: input.accountKey,
    packageId, itemId: null, sku: text(child.supplier_sku), now,
  })
  const currentAuthority = record(record(currentFee).authority)
  const currentSource = record(currentAuthority.preSaleSourceContextV1)
  const currentListing = record(currentSource.listing)
  const currentFeeReady = record(currentFee).publicationSubjectMatched === true
    && publicationFeeStructureV1({ authority: currentAuthority,
      subjectMatched: true, accountKey: input.accountKey, packageId,
      sku: text(child.supplier_sku),
      categoryId: text(currentAuthority.categoryId),
      salePrice: Number(currentListing.price),
      buyerShipping: knownBuyerShippingV1(
        currentSource.fulfillmentFeeBasis), now }).feeAuthorityReady
  if (!currentFeeReady) {
    const context = await readEbayPackageFeeContextReadonlyV1(packageId)
    await persistProducedEbayFeeV1({ supabase: input.supabase,
      accountKey: input.accountKey, packageId, itemId: null,
      sku: text(child.supplier_sku), context, now: new Date() })
  }
  const authorization = input.request.headers.get("authorization") ?? ""
  const protectionBypass = input.request.headers.get(
    "x-vercel-protection-bypass") ?? ""
  const artifactResponse = await fetch(new URL(
    "/api/admin/ebay/draft-only", input.request.url), {
    method: "POST", cache: "no-store",
    headers: { Authorization: authorization,
      "Content-Type": "application/json",
      ...(protectionBypass
        ? { "x-vercel-protection-bypass": protectionBypass } : {}) },
    body: JSON.stringify({
      action: "materialize_current_prepublication_artifacts", packageId,
    }), signal: AbortSignal.timeout(240_000),
  })
  const artifacts = record(await artifactResponse.json().catch(() => null))
  if (!artifactResponse.ok || artifacts.success !== true) {
    return { status: artifactResponse.status, body: {
      success: false, contractVersion: CONTRACT,
      status: "CURRENT_PREPUBLICATION_ARTIFACTS_PENDING",
      batchId: input.batch.id, sequenceNo: child.sequence_no,
      selection: child, artifacts, OWNER_ACTION_REQUIRED: false,
      safety: { concurrency: 1,
        marketplaceWrites: Number(record(artifacts.safety)
          .marketplaceWrites ?? 0), publicationWrites: 0, adsWrites: 0 },
    } }
  }
  const current = record(await readSellOneLikeThisV1({
    supabase: input.supabase, accountKey: input.accountKey,
    packageId, referenceItemId: "",
  }))
  const gate = record(current.publicationGate)
  if (gate.READY_TO_PUBLISH !== true
      || gate.EXECUTOR_CLAIMABLE !== true) {
    return { status: 409, body: {
      success: false, contractVersion: CONTRACT,
      status: "CURRENT_EXECUTION_CONTRACT_NOT_CLAIMABLE",
      batchId: input.batch.id, sequenceNo: child.sequence_no,
      selection: child, current, OWNER_ACTION_REQUIRED: false,
      safety: { concurrency: 1,
        marketplaceWrites: Number(record(artifacts.safety)
          .marketplaceWrites ?? 0), publicationWrites: 0, adsWrites: 0 },
    } }
  }
  const publicationRow = await readPublication({ ...input,
    publicationId: text(artifacts.publicationIntentId), packageId })
  const before = child.active_listing_count_before === null
    || child.active_listing_count_before === undefined
    ? await activeCount(input) : Number(child.active_listing_count_before)
  const armed = await input.supabase.from(
    "seller_os_autonomous_stocking_batch_children_v1").update({
      status: "PREPUBLICATION_READY",
      publication_id: publicationRow.id, offer_id: publicationRow.offer_id,
      active_listing_count_before: before,
      evidence: { ...record(child.evidence), ...selectionEvidence,
        currentExecutionContractValid: true, executorClaimable: true,
        materialized, current, artifacts },
      updated_at: new Date().toISOString(),
    }).eq("id", text(child.id)).eq("status", "SELECTED")
      .select("*").single()
  if (armed.error || !armed.data) {
    throw new Error("AUTONOMOUS_STOCKING_BATCH_PREPUBLICATION_ARM_FAILED")
  }
  child = record(armed.data)
  const publication = record(await publishCurrentRevisionV1(
    publicationInput({ ...input, publication: publicationRow })))
  if (publication.pass !== true) {
    await input.supabase.from(
      "seller_os_autonomous_stocking_batch_children_v1").update({
        status: "PUBLISHING",
        publication_write_count: Number(publication.publicationWrites ?? 0),
        evidence: { ...record(child.evidence), publication },
        updated_at: new Date().toISOString(),
      }).eq("id", text(child.id)).eq("status", "PREPUBLICATION_READY")
    return { status: 409, body: {
      success: false, contractVersion: CONTRACT,
      status: "UNKNOWN_COMMIT_STATE", batchId: input.batch.id,
      sequenceNo: child.sequence_no, publication,
      PUBLICATION_COMMIT_ALLOWED: true, OWNER_ACTION_REQUIRED: false,
      safety: { concurrency: 1,
        marketplaceWrites: Number(publication.publicationWrites ?? 0),
        publicationWrites: Number(publication.publicationWrites ?? 0),
        adsWrites: 0, blindRetryAllowed: false },
    } }
  }
  child = await completePublishedChild({ ...input, child, publicationRow,
    publication, current, materialized })
  return { status: 200, body: {
    success: true, contractVersion: CONTRACT,
    status: "PUBLISHED_CONFIRMED", batchId: input.batch.id,
    sequenceNo: child.sequence_no,
    selection: { candidateId: child.candidate_id,
      productId: child.product_id, variantId: child.variant_id,
      supplierSku: child.supplier_sku,
      packageId: child.listing_package_id,
      manualProductSelection: false, manualProductIdInjection: false },
    current, artifacts, publication,
    AUTONOMOUS_CANDIDATE_CONTINUATION: true,
    PUBLICATION_COMMIT_ALLOWED: true,
    PUBLICATION_COMMIT_READBACK_PASS: true,
    PUBLICATION_WRITE_COUNT: 1, PUBLISH_OFFER_CALLED: true,
    DUPLICATE_LISTING_CREATED: false, DUPLICATE_OFFER_CREATED: false,
    OWNER_ACTION_REQUIRED: false, CODEX_RUNTIME_DEPENDENCY: false,
    LEGACY_DEPENDENCY_COUNT: 0,
    safety: { concurrency: 1, marketplaceWrites: 1,
      publicationWrites: 1, adsWrites: 0, blindRetryAllowed: false },
  } }
}

export async function runAutonomousEbayStockingBatchV1(input: Readonly<{
  supabase: SupabaseAdmin
  accountKey: string
  request: Request
}>): Promise<RuntimeResult | null> {
  const boundary = getEbayDraftWriteEnvironmentBoundary()
  if (!boundary.productionDedicatedPreprodBound || !boundary.writeAllowed) {
    throw new Error("CERTIFIED_PREPROD_ONLY")
  }
  const read = await input.supabase.from(
    "seller_os_autonomous_stocking_batches_v1").select("*")
    .eq("account_key", input.accountKey).eq("status", "ACTIVE")
    .order("started_at", { ascending: true }).limit(1).maybeSingle()
  if (read.error) {
    const missing = read.error.code === "42P01"
      || /does not exist/i.test(read.error.message ?? "")
    if (missing) return null
    throw new Error("AUTONOMOUS_STOCKING_BATCH_READ_FAILED")
  }
  const activeBatch = read.data ??
    await resumeBatchAfterRecoveredShippingClaimV1(input)
  if (!activeBatch) return null
  const batch = record(activeBatch)
  try {
    return await executeBatch({ ...input, batch })
  } catch (error) {
    const blocker = errorCode(error)
    await input.supabase.from(
      "seller_os_autonomous_stocking_batches_v1").update({
        status: "BLOCKED",
        evidence: { ...record(batch.evidence),
          firstStructuralBlocker: blocker,
          blockedAt: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }).eq("id", text(batch.id)).eq("status", "ACTIVE")
    return { status: 500, body: {
      success: false, contractVersion: CONTRACT,
      status: "BLOCKED", batchId: batch.id,
      FIRST_REPRODUCIBLE_BLOCKER: blocker,
      OWNER_ACTION_REQUIRED: false, CODEX_RUNTIME_DEPENDENCY: false,
      LEGACY_DEPENDENCY_COUNT: 0,
      safety: { concurrency: 1, marketplaceWrites: 0,
        publicationWrites: 0, adsWrites: 0, blindRetryAllowed: false },
    } }
  }
}
