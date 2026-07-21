export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { after, NextResponse } from "next/server"

import { EBAY_IMAGE_STAGING_BUCKET } from "@/lib/ebay/ebay-image-storage-cleanup"
import { getListingImageFactoryConfiguration } from "@/lib/ebay/ebay-listing-image-factory"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { evaluateEbayProductApprovalFulfillmentBasis } from "@/lib/ebay/ebay-fulfillment-policy-compliance"
import { getProductResearchQueryPlanStatus } from "@/lib/ebay/ebay-product-research-query-plan"
import { isValidSameDayLunaConfirmation } from "@/lib/ebay/ebay-same-day-pilot-domain"
import {
  authorizeSameDayControlledRiskOverride,
  confirmSameDayLuna,
  decideSameDayFactException,
  decideSameDayImages,
  decideSameDayProduct,
  getSameDayPilot,
  processSameDayPilotJobChain,
  resumeSameDayPilotAfterAccountPolicyProfile,
  startSameDayPilot,
} from "@/lib/ebay/ebay-same-day-pilot-service"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}
function uuid(value: unknown) {
  const normalized = text(value, 40)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}
function safeHttpsUrl(value: unknown) {
  const normalized = text(value, 2_000)
  try {
    const url = new URL(normalized)
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

async function imageReviewAssetsForPilot(
  access: Exclude<Awaited<ReturnType<typeof authorization>>, { response: NextResponse }>,
  pilot: Awaited<ReturnType<typeof getSameDayPilot>>,
) {
  if (!pilot) return {}
  const openImageCandidateIds = new Set((pilot.tasks ?? [])
    .filter((task) => task.status === "OPEN" &&
      task.gate_type === "IMAGE_APPROVAL_REQUIRED")
    .map((task) => uuid(task.candidate_id))
    .filter(Boolean))
  const requestedSets = (pilot.candidates ?? []).flatMap((candidate) => {
    const candidateId = uuid(candidate.id)
    if (!candidateId || !openImageCandidateIds.has(candidateId) ||
      candidate.machine_state !== "WAITING_IMAGE_APPROVAL") return []
    const summary = object(candidate.image_package_summary)
    const embeddedAssets = Array.isArray(summary.assets)
      ? summary.assets.map((asset) => uuid(object(asset).id))
      : []
    const assetIds = [...new Set([
      ...(Array.isArray(summary.assetIds) ? summary.assetIds.map(uuid) : []),
      ...(Array.isArray(summary.asset_ids) ? summary.asset_ids.map(uuid) : []),
      ...embeddedAssets,
    ].filter(Boolean))].slice(0, 6)
    const listingPackageId = uuid(summary.listingPackageId ?? summary.listing_package_id)
    return assetIds.length ? [{ candidateId, listingPackageId, assetIds }] : []
  })
  const allAssetIds = [...new Set(requestedSets.flatMap((entry) => entry.assetIds))]
  if (!allAssetIds.length) return {}
  const { data, error } = await access.supabase
    .from("ebay_listing_image_assets")
    .select("id,listing_package_id,asset_role,status,position,output_storage_path,public_url,output_width,output_height,transformation_version,transformation,qa_result")
    .eq("account_key", access.accountKey)
    .eq("created_by", access.auth.userId)
    .in("id", allAssetIds)
    .in("status", ["pending_review", "approved"])
    .order("position", { ascending: true })
  if (error) throw new Error("SAME_DAY_PILOT_IMAGE_REVIEW_READ_FAILED")
  const assetsById = new Map((data ?? []).map((asset) => [asset.id, asset]))
  const result: Record<string, Array<Record<string, unknown>>> = {}
  for (const requested of requestedSets) {
    const matching = requested.assetIds.map((assetId) => assetsById.get(assetId))
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
      .filter((asset) => !requested.listingPackageId ||
        asset.listing_package_id === requested.listingPackageId)
      .sort((left, right) => Number(left.position) - Number(right.position))
    result[requested.candidateId] = await Promise.all(matching.map(async (asset) => {
      const transformation = object(asset.transformation)
      const qa = object(asset.qa_result)
      let outputPreviewUrl = asset.status === "approved"
        ? safeHttpsUrl(asset.public_url)
        : null
      if (!outputPreviewUrl && asset.status === "pending_review" &&
        text(asset.output_storage_path, 1_000)) {
        const { data: signed } = await access.supabase.storage
          .from(EBAY_IMAGE_STAGING_BUCKET)
          .createSignedUrl(text(asset.output_storage_path, 1_000), 300)
        outputPreviewUrl = safeHttpsUrl(signed?.signedUrl)
      }
      return {
        id: asset.id,
        listingPackageId: asset.listing_package_id,
        assetRole: asset.asset_role,
        status: asset.status,
        position: asset.position,
        slot: text(transformation.slot, 80),
        generativeAiUsed: transformation.generativeAiUsed === true,
        compositorContractVersion: text(
          transformation.compositorContractVersion,
          120,
        ),
        presentationMode: text(transformation.presentationMode, 80),
        authorizedSourceTreatment: text(
          transformation.authorizedSourceTreatment,
          80,
        ),
        backgroundPlateVersion: text(
          transformation.backgroundPlateVersion,
          120,
        ),
        backgroundPlateQuality: text(
          transformation.backgroundPlateQuality,
          20,
        ),
        visualStrategyVersion: text(
          transformation.visualStrategyVersion,
          120,
        ),
        foregroundMatteVersion: text(
          transformation.foregroundMatteVersion,
          120,
        ),
        foregroundMatteMethod: text(
          transformation.foregroundMatteMethod,
          80,
        ),
        foregroundMatteValidated: qa.foregroundMatteValidated === true,
        opaqueSourceFrameRemoved: qa.opaqueSourceFrameRemoved === true,
        textSafeAreaVerified: qa.textSafeAreaVerified === true,
        textRendererVersion: text(
          transformation.textRendererVersion,
          120,
        ),
        textGlyphsValidated: qa.textGlyphsValidated === true,
        transformationVersion: asset.transformation_version,
        automaticQaStatus: text(qa.automaticStatus, 40),
        manualChecksRequired: Array.isArray(qa.manualChecksRequired)
          ? qa.manualChecksRequired.map((entry) => text(entry, 100)).filter(Boolean).slice(0, 12)
          : [],
        width: asset.output_width,
        height: asset.output_height,
        outputPreviewUrl,
        previewExpiresInSeconds: outputPreviewUrl && asset.status === "pending_review" ? 300 : null,
      }
    }))
  }
  return result
}
function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message) ? message : "SAME_DAY_PILOT_REQUEST_FAILED"
}
function safeErrorStatus(error: unknown) {
  const code = safeError(error)
  return /(?:INVALID|REQUIRED|BLOCKED|CONFLICT|TASK_|CANDIDATE_)/.test(code) ? 409 : 502
}
async function authorization(req: Request) {
  const auth = await validateAdminApiRequest(req)
  if (!auth.ok || !auth.userId) return { response: NextResponse.json({ success: false, error: auth.error ?? "admin_forbidden" }, { status: auth.status || 403 }) }
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return { response: NextResponse.json({ success: false, error: "SAME_DAY_PILOT_ACCOUNT_SCOPE_REQUIRED" }, { status: 503 }) }
  return { auth, accountKey, supabase: getSupabaseAdminClient() }
}

function scheduleImmediateContinuation(input: {
  supabase: Parameters<typeof processSameDayPilotJobChain>[0]["supabase"]
  accountKey: string
  workerId: string
}) {
  after(async () => {
    try {
      await processSameDayPilotJobChain({ ...input, maximumJobs: 30, maximumDurationMs: 240_000 })
    } catch {
      // The one-minute durable scheduler is the recovery path. Never make a
      // completed human gate look rejected because post-response work failed.
      console.error("SAME_DAY_PILOT_IMMEDIATE_CONTINUATION_DEFERRED_TO_SCHEDULER")
    }
  })
  return { processed: 0, status: "SCHEDULED_IMMEDIATE", schedulerFallback: true,
    recursiveHttp: false }
}

export async function GET(req: Request) {
  const access = await authorization(req)
  if ("response" in access) return access.response
  try {
    const pilot = await getSameDayPilot({ supabase: access.supabase, accountKey: access.accountKey })
    const imageReviewAssets = await imageReviewAssetsForPilot(access, pilot)
    const imageFactoryConfiguration = getListingImageFactoryConfiguration()
    const productResearchPlanId = typeof pilot?.run?.source_inventory?.productResearchPlanId === "string"
      ? pilot.run.source_inventory.productResearchPlanId : null
    const productResearchTaskOpen = pilot?.tasks?.some((task) =>
      task.gate_type === "PRODUCT_RESEARCH_CAPTURE_REQUIRED" && task.status === "OPEN") === true
    let productResearchGuidance: Record<string, unknown> | null = null
    if (productResearchPlanId && productResearchTaskOpen) {
      try {
        const plan = await getProductResearchQueryPlanStatus({
          supabase: access.supabase,
          accountKey: access.accountKey,
          planId: productResearchPlanId,
        })
        productResearchGuidance = plan ? {
          status: plan.status,
          queryCount: plan.queryCount,
          capturedCount: plan.capturedCount,
          pendingCount: plan.pendingCount,
          nextQuery: plan.nextQuery ? {
            ordinal: plan.nextQuery.ordinal,
            searchQuery: plan.nextQuery.searchQuery,
            candidateCount: plan.nextQuery.candidateCount,
          } : null,
        } : null
      } catch {
        // The operating view must remain usable with its candidate-level
        // fallback if the read-only plan projection is temporarily unavailable.
        productResearchGuidance = { status: "TEMPORARILY_UNAVAILABLE", nextQuery: null }
      }
    }
    return NextResponse.json({ success: true, pilot: pilot ? {
      ...pilot, productResearchGuidance, imageReviewAssets,
      imageFactoryConfiguration,
    } : null,
      safety: { fullCatalogRescan: false, ebayWrites: 0, productionChanged: false } })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeError(error) }, { status: 502 })
  }
}

export async function POST(req: Request) {
  const access = await authorization(req)
  if ("response" in access) return access.response
  try {
    const body = object(await req.json())
    if (body.action === "start") {
      const pilot = await startSameDayPilot({ supabase: access.supabase, accountKey: access.accountKey, actorId: access.auth.userId })
      const continuation = scheduleImmediateContinuation({ supabase: access.supabase,
        accountKey: access.accountKey, workerId: `pilot-start:${access.auth.userId}` })
      return NextResponse.json({ success: true, pilot, continuation,
        safety: { oneClickStarted: true, fullCatalogRescan: false, ebayWrites: 0, productionChanged: false } },
      { status: pilot.created ? 201 : 200 })
    }
    if (body.action === "confirm_luna") {
      const availability = object(body.availability)
      const quantity = availability.quantity === null || availability.quantity === undefined || availability.quantity === ""
        ? null : Number(availability.quantity)
      const nativePackCount = body.nativePackCount === null || body.nativePackCount === undefined || body.nativePackCount === ""
        ? null : Number(body.nativePackCount)
      const price = body.price === null || body.price === undefined || body.price === ""
        ? null : Number(body.price)
      if (typeof body.taskId !== "string" || typeof availability.available !== "boolean" ||
        !isValidSameDayLunaConfirmation({
          price,
          available: availability.available,
          quantity,
          nativePackCount,
        })) {
        return NextResponse.json({ success: false, error: "SAME_DAY_PILOT_LUNA_CONFIRMATION_INVALID" }, { status: 400 })
      }
      await confirmSameDayLuna({ supabase: access.supabase, accountKey: access.accountKey, actorId: access.auth.userId,
        taskId: body.taskId, price, available: availability.available, quantity,
        identityAndPackConfirmed: body.identityAndPackConfirmed === true, nativePackCount })
      const continuation = scheduleImmediateContinuation({ supabase: access.supabase, accountKey: access.accountKey,
        workerId: `user-confirmation:${access.auth.userId}` })
      const pilot = await getSameDayPilot({ supabase: access.supabase, accountKey: access.accountKey })
      return NextResponse.json({ success: true, pilot, continuation, autoResumed: true, safety: { ebayWrites: 0, productionChanged: false } })
    }
    if (body.action === "fact_exception_decision") {
      const decision = body.decision === "CONFIRM" || body.decision === "REJECT"
        ? body.decision : null
      const unbrandedConfirmation = body.brandAbsentConfirmed === true
      if (typeof body.taskId !== "string" || !decision ||
        (decision === "CONFIRM" && !unbrandedConfirmation &&
          (!text(body.value, 250) || body.visibleOfficialLabelConfirmed !== true))) {
        return NextResponse.json({ success: false,
          error: "SAME_DAY_PILOT_FACT_EXCEPTION_DECISION_INVALID" }, { status: 400 })
      }
      await decideSameDayFactException({ supabase: access.supabase,
        accountKey: access.accountKey, actorId: access.auth.userId,
        taskId: body.taskId, decision, value: text(body.value, 250) || null,
        visibleOfficialLabelConfirmed: body.visibleOfficialLabelConfirmed === true,
        brandAbsentConfirmed: unbrandedConfirmation })
      const continuation = scheduleImmediateContinuation({ supabase: access.supabase,
        accountKey: access.accountKey,
        workerId: `fact-exception:${access.auth.userId}` })
      const pilot = await getSameDayPilot({ supabase: access.supabase,
        accountKey: access.accountKey })
      return NextResponse.json({ success: true, pilot, continuation,
        autoResumed: true, safety: { openAiCalls: 0, ebayWrites: 0,
          fullCatalogRescan: false, productionChanged: false } })
    }
    if (body.action === "product_decision") {
      const decision = body.decision === "APPROVE" || body.decision === "REJECT" ? body.decision : null
      const salePrice = body.salePrice === null || body.salePrice === undefined || body.salePrice === ""
        ? null : Number(body.salePrice)
      const fulfillmentDecision = evaluateEbayProductApprovalFulfillmentBasis(
        decision,
        body.fulfillmentBasis,
      )
      const fulfillmentBasis = fulfillmentDecision.basis
      if (typeof body.taskId !== "string" || !decision ||
        (decision === "APPROVE" &&
          (!(salePrice && Number.isFinite(salePrice)) || salePrice <= 0 ||
            !fulfillmentDecision.allowed || body.imageRightsConfirmed !== true ||
            body.openAiImageSpendApproved !== true))) {
        return NextResponse.json({ success: false, error: "SAME_DAY_PILOT_PRODUCT_DECISION_INVALID" }, { status: 400 })
      }
      await decideSameDayProduct({ supabase: access.supabase, accountKey: access.accountKey,
        actorId: access.auth.userId, taskId: body.taskId, decision, salePrice, fulfillmentBasis,
        imageRightsConfirmed: body.imageRightsConfirmed === true,
        openAiImageSpendApproved: body.openAiImageSpendApproved === true,
        noPromotionConfirmed: body.noPromotionConfirmed === true })
      const continuation = scheduleImmediateContinuation({ supabase: access.supabase,
        accountKey: access.accountKey, workerId: `product-decision:${access.auth.userId}` })
      const pilot = await getSameDayPilot({ supabase: access.supabase, accountKey: access.accountKey })
      return NextResponse.json({ success: true, pilot, continuation, autoResumed: true,
        safety: { openAiCalls: 0, ebayWrites: 0, automaticPricingUsed: false, productionChanged: false } })
    }
    if (body.action === "controlled_risk_override") {
      const candidateId = uuid(body.candidateId)
      const salePrice = Number(body.salePrice)
      const fulfillmentDecision = evaluateEbayProductApprovalFulfillmentBasis(
        "APPROVE",
        body.fulfillmentBasis,
      )
      if (!candidateId || !Number.isFinite(salePrice) || salePrice <= 0 ||
        !fulfillmentDecision.allowed || !fulfillmentDecision.basis ||
        body.imageRightsConfirmed !== true || body.openAiImageSpendApproved !== true ||
        body.commercialRiskAccepted !== true || body.noPromotionConfirmed !== true ||
        body.voluntaryReturnsPolicyAcknowledged !== true ||
        body.ebayMoneyBackGuaranteeAcknowledged !== true) {
        return NextResponse.json({
          success: false,
          error: "SAME_DAY_PILOT_CONTROLLED_RISK_OVERRIDE_INVALID",
        }, { status: 400 })
      }
      await authorizeSameDayControlledRiskOverride({
        supabase: access.supabase,
        accountKey: access.accountKey,
        actorId: access.auth.userId,
        candidateId,
        salePrice,
        fulfillmentBasis: fulfillmentDecision.basis,
        imageRightsConfirmed: true,
        openAiImageSpendApproved: true,
        commercialRiskAccepted: true,
        noPromotionConfirmed: true,
        voluntaryReturnsPolicyAcknowledged: true,
        ebayMoneyBackGuaranteeAcknowledged: true,
      })
      const continuation = scheduleImmediateContinuation({
        supabase: access.supabase,
        accountKey: access.accountKey,
        workerId: `controlled-risk:${access.auth.userId}`,
      })
      const pilot = await getSameDayPilot({
        supabase: access.supabase,
        accountKey: access.accountKey,
      })
      return NextResponse.json({
        success: true,
        pilot,
        continuation,
        autoResumed: true,
        safety: {
          minimumNetMarginPercent: 10,
          promotionAllowed: false,
          manualPublicationOnly: false,
          finalHumanAuthorizationRequired: true,
          sellerOsPublicationAfterAuthorization: true,
          unattendedPublicationAllowed: false,
          automaticPricingUsed: false,
          ebayWrites: 0,
          productionChanged: false,
        },
      })
    }
    if (body.action === "resume_account_policy_profile") {
      const candidateId = uuid(body.candidateId)
      if (!candidateId) {
        return NextResponse.json({
          success: false,
          error: "SAME_DAY_PILOT_POLICY_RECOVERY_CANDIDATE_REQUIRED",
        }, { status: 400 })
      }
      const recovery = await resumeSameDayPilotAfterAccountPolicyProfile({
        supabase: access.supabase,
        accountKey: access.accountKey,
        actorId: access.auth.userId,
        candidateId,
      })
      const continuation = scheduleImmediateContinuation({
        supabase: access.supabase,
        accountKey: access.accountKey,
        workerId: `account-policy-recovery:${access.auth.userId}`,
      })
      const pilot = await getSameDayPilot({
        supabase: access.supabase,
        accountKey: access.accountKey,
      })
      return NextResponse.json({
        success: true,
        recovery,
        pilot,
        continuation,
        autoResumed: true,
        safety: {
          candidateScoped: true,
          ebayWrites: 0,
          productionChanged: false,
        },
      })
    }
    if (body.action === "image_decision") {
      const decision = body.decision === "APPROVE" || body.decision === "REJECT" ? body.decision : null
      if (typeof body.taskId !== "string" || !decision) {
        return NextResponse.json({ success: false, error: "SAME_DAY_PILOT_IMAGE_DECISION_INVALID" }, { status: 400 })
      }
      await decideSameDayImages({ supabase: access.supabase, accountKey: access.accountKey,
        actorId: access.auth.userId, taskId: body.taskId, decision })
      const continuation = scheduleImmediateContinuation({ supabase: access.supabase,
        accountKey: access.accountKey, workerId: `image-decision:${access.auth.userId}` })
      const pilot = await getSameDayPilot({ supabase: access.supabase, accountKey: access.accountKey })
      return NextResponse.json({ success: true, pilot, continuation, autoResumed: true,
        safety: { openAiCalls: 0, ebayWrites: 0, competitorImages: 0, productionChanged: false } })
    }
    return NextResponse.json({ success: false, error: "SAME_DAY_PILOT_ACTION_INVALID" }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeError(error) }, { status: safeErrorStatus(error) })
  }
}
