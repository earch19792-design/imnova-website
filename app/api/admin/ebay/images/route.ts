export const runtime = "nodejs"
export const maxDuration = 300

import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import sharp from "sharp"

import {
  EBAY_IMAGE_MAX_SOURCE_BYTES,
  EBAY_IMAGE_TRANSFORMATION_VERSION,
  fetchAuthorizedImageSource,
  optimizeAuthorizedEbayMainImage,
  validateImageRightsEvidence,
} from "@/lib/ebay/ebay-image-optimization-service"
import {
  assertEbayImageEvidenceSufficiency,
  buildSafeOpenAiBackgroundPlatePlan,
  composeAuthorizedEbayListingImageSet,
  EBAY_LISTING_IMAGE_SLOTS,
  EBAY_LISTING_IMAGE_SET_VERSION,
  getListingImageFactoryConfiguration,
  requestSafeOpenAiBackgroundPlate,
  validateListingImageFactoryInput,
} from "@/lib/ebay/ebay-listing-image-factory"
import {
  EBAY_IMAGE_SOURCE_BUCKET,
  EBAY_IMAGE_STAGING_BUCKET,
  enqueueEbayImageStorageCleanup,
} from "@/lib/ebay/ebay-image-storage-cleanup"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { assertEbayImageAccountScope } from "@/lib/ebay/ebay-image-account-scope"
import {
  generateAndPersistSameDayImageRevision,
  getSameDayImageRevision,
  reviewSameDayImageRevision,
} from "@/lib/ebay/ebay-same-day-image-revision-runtime"
import {
  ACTIVE_LISTING_IMAGE_REVISION_CONFIRMATION,
  applyApprovedImageRevisionToActiveListing,
} from "@/lib/ebay/ebay-active-listing-image-revision-service"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

const OUTPUT_BUCKET = "ebay-listing-images"
const SOURCE_BUCKET = EBAY_IMAGE_SOURCE_BUCKET
const STAGING_BUCKET = EBAY_IMAGE_STAGING_BUCKET
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function uuid(value: unknown) {
  const normalized = text(value, 40)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_:.-]+$/.test(message)
    ? message
    : "EBAY_IMAGE_PIPELINE_FAILED"
}

function imageRevisionErrorStatus(code: string) {
  if (/NOT_FOUND/.test(code)) return 404
  if (/INVALID|REQUIRED|MISSING/.test(code)) return 400
  if (/CONFLICT|BUSY|NOT_APPROVED|NOT_REVIEWABLE|BLOCKED|LEASE|OUTCOME_UNKNOWN|TERMINAL|MISMATCH|WRITE_IN_PROGRESS/.test(code)) {
    return 409
  }
  return 502
}

function databaseErrorCode(error: unknown, fallback: string) {
  const message = text(record(error).message, 1_000)
  return message.match(/EBAY_[A-Z0-9_]+/)?.[0] ?? fallback
}

function imageRevisionResultState(value: unknown) {
  const result = record(value)
  const revision = record(result.revision)
  const status = text(revision.status, 40)
  const assetCount = Array.isArray(result.assets) ? result.assets.length : 0
  const failed = ["FAILED_RETRYABLE", "FAILED_FINAL"].includes(status)
  return {
    status,
    assetCount,
    ready: ["PENDING_REVIEW", "APPROVED"].includes(status) && assetCount === 7,
    error: failed
      ? text(revision.last_error_code, 120) || "SAME_DAY_IMAGE_REVISION_FAILED"
      : assetCount === 7 ? null : "SAME_DAY_IMAGE_REVISION_EXACT_SEVEN_INVALID",
  }
}

function candidatePath(candidateKey: string) {
  return createHash("sha256").update(candidateKey).digest("hex").slice(0, 24)
}

function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function openAiImageRuntime() {
  const capabilities = getListingImageFactoryConfiguration()
  if (capabilities.aiGeneration !== "READY") {
    throw new Error("EBAY_IMAGE_OPENAI_CONTEXT_NOT_READY")
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? ""
  const model = process.env.OPENAI_IMAGE_MODEL?.trim() ?? ""
  if (!apiKey || !model) throw new Error("EBAY_IMAGE_OPENAI_CONTEXT_NOT_READY")
  return { apiKey, model, dailyCallLimit: capabilities.dailyCallLimit }
}

function retryableOpenAiImageError(error: unknown) {
  const code = safeError(error)
  return code === "EBAY_IMAGE_OPENAI_TIMEOUT"
    || code === "EBAY_IMAGE_OPENAI_NETWORK_FAILED"
    || /^EBAY_IMAGE_OPENAI_HTTP_(429|5[0-9]{2})$/.test(code)
}

async function existingOpenAiImageSet(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  input: {
    accountKey: string
    actor: string
    packageId: string
    generationId: string
    requestHash: string
  },
) {
  const { data: contextAsset, error: contextError } = await supabase
    .from("ebay_listing_image_assets")
    .select("*")
    .eq("account_key", input.accountKey)
    .eq("created_by", input.actor)
    .eq("listing_package_id", input.packageId)
    .in("status", ["pending_review", "approved"])
    .contains("transformation", {
      listingGenerationId: input.generationId,
      backgroundPlateRequestHash: input.requestHash,
    })
    .limit(1)
    .maybeSingle()
  if (contextError) throw new Error("EBAY_IMAGE_OPENAI_IDEMPOTENCY_CHECK_FAILED")
  if (!contextAsset) return null
  const { data: assets, error: assetsError } = await supabase
    .from("ebay_listing_image_assets")
    .select("*")
    .eq("account_key", input.accountKey)
    .eq("created_by", input.actor)
    .eq("listing_package_id", input.packageId)
    .eq("transformation_version", EBAY_LISTING_IMAGE_SET_VERSION)
    .in("status", ["pending_review", "approved"])
    .contains("transformation", { listingGenerationId: input.generationId })
    .order("position", { ascending: true })
    .limit(24)
  if (assetsError) throw new Error("EBAY_IMAGE_OPENAI_IDEMPOTENCY_CHECK_FAILED")
  const selected = EBAY_LISTING_IMAGE_SLOTS.map((slot) => {
    if (slot === "USE_CONTEXT") return contextAsset
    return (assets ?? []).find((asset) =>
      record(asset.transformation).slot === slot
    ) ?? null
  })
  if (selected.some((asset) => !asset)) {
    throw new Error("EBAY_IMAGE_OPENAI_PARTIAL_SET_REVIEW_REQUIRED")
  }
  return selected as JsonRecord[]
}

function supportedUpload(file: File) {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type)
    && file.size > 0
    && file.size <= EBAY_IMAGE_MAX_SOURCE_BYTES
}

async function parseBody(req: Request) {
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData()
    const file = form.get("file")
    return {
      action: text(form.get("action"), 40),
      candidateKey: text(form.get("candidateKey"), 300),
      opportunityId: text(form.get("opportunityId"), 40),
      listingPackageId: text(form.get("listingPackageId"), 40),
      generationId: text(form.get("generationId"), 40),
      assetRole: text(form.get("assetRole"), 30),
      rightsBasis: text(form.get("rightsBasis"), 40),
      authorizationReference: text(form.get("authorizationReference"), 500),
      rightsEvidenceConfirmed: form.get("rightsEvidenceConfirmed") === "true",
      file: file instanceof File ? file : null,
    }
  }
  return record(await req.json())
}

async function packageForActor(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  packageId: string,
  actor: string,
  accountKey: string,
) {
  const { data, error } = await supabase
    .from("ebay_listing_packages")
    .select("*")
    .eq("id", packageId)
    .eq("created_by", actor)
    .eq("account_key", accountKey)
    .maybeSingle()
  if (error || !data) throw new Error("EBAY_IMAGE_PACKAGE_NOT_FOUND")
  assertEbayImageAccountScope(accountKey, data.account_key)
  return data as JsonRecord
}

async function approvedGenerationForPackage(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  generationId: string,
  packageRow: JsonRecord,
  accountKey: string,
) {
  const { data: generation, error: generationError } = await supabase
    .from("marketplace_listing_generations")
    .select("id,decision_package_id,decision_package_hash,identity_fingerprint,generation_output,output_hash,status")
    .eq("id", generationId)
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("status", "APPROVED")
    .maybeSingle()
  if (generationError || !generation) {
    throw new Error("EBAY_IMAGE_GENERATION_APPROVAL_REQUIRED")
  }
  const { data: decision, error: decisionError } = await supabase
    .from("marketplace_listing_decision_packages")
    .select("id,package_hash,product_identity_fingerprint,supplier_sku,status,package_payload")
    .eq("id", generation.decision_package_id)
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .eq("status", "APPROVED")
    .maybeSingle()
  if (decisionError || !decision) throw new Error("EBAY_IMAGE_DECISION_APPROVAL_REQUIRED")
  const packageOpportunityId = uuid(packageRow.opportunity_id)
  if (!packageOpportunityId) throw new Error("EBAY_IMAGE_PACKAGE_OPPORTUNITY_INVALID")
  const { data: opportunity, error: opportunityError } = await supabase
    .from("ebay_luna_opportunity_queue")
    .select("id,supplier_sku,candidate_key")
    .eq("id", packageOpportunityId)
    .maybeSingle()
  if (opportunityError || !opportunity) throw new Error("EBAY_IMAGE_OPPORTUNITY_NOT_FOUND")
  if (
    text(opportunity.candidate_key, 300) !== text(packageRow.candidate_key, 300) ||
    !text(opportunity.supplier_sku, 100) ||
    text(opportunity.supplier_sku, 100) !== text(decision.supplier_sku, 100) ||
    generation.decision_package_hash !== decision.package_hash ||
    generation.identity_fingerprint !== decision.product_identity_fingerprint
  ) throw new Error("EBAY_IMAGE_PRODUCT_IDENTITY_MISMATCH")
  const output = record(generation.generation_output)
  const facts = record(output.factAssertions)
  const legacyBriefs = Array.isArray(output.imageBriefs)
    ? output.imageBriefs.map(record)
    : []
  const briefs = EBAY_LISTING_IMAGE_SLOTS.map((slot) => {
    const existing = legacyBriefs.find((brief) => brief.slot === slot)
    return existing ?? {
      slot,
      objective: slot === "MAIN_WHITE_BACKGROUND"
        ? "Preserve the exact authorized Luna Portex product on pure white."
        : "Execute the evidence-selected commercial objective without reconstructing the product.",
      overlayText: null,
      preserveOriginalPackage: true,
      sourcePolicy: "AUTHORIZED_PRODUCT_IMAGE_ONLY",
    }
  })
  return {
    generation,
    factoryInput: {
      identityFingerprint: generation.identity_fingerprint,
      facts: {
        manufacturerBrand: text(facts.manufacturerBrand, 120) || null,
        normalizedProductName: text(facts.normalizedProductName, 300),
        packCount: facts.packCount ?? null,
        unitCount: facts.unitCount ?? null,
        size: text(facts.size, 100) || null,
        color: text(facts.color, 100) || null,
        scent: text(facts.scent, 100) || null,
        variant: text(facts.variant, 100) || null,
        condition: text(facts.condition, 100) || null,
        dimensions: text(facts.dimensions, 160) || null,
        capacity: text(facts.capacity, 100) || null,
        weight: text(facts.weight, 100) || null,
        material: text(facts.material, 120) || null,
        verifiedUseCases: Array.isArray(facts.verifiedUseCases)
          ? facts.verifiedUseCases.map((value) => text(value, 160)).filter(Boolean)
          : [],
      },
      briefs,
    },
  }
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || !validation.userId) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  try {
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) {
      return NextResponse.json(
        { success: false, error: "EBAY_IMAGE_ACCOUNT_SCOPE_REQUIRED" },
        { status: 503 },
      )
    }
    const url = new URL(req.url)
    const revisionId = uuid(url.searchParams.get("revisionId"))
    if (revisionId) {
      try {
        const result = await getSameDayImageRevision({
          supabase: getSupabaseAdminClient(),
          accountKey,
          actorId: validation.userId,
          revisionId,
        })
        return NextResponse.json({
          success: true,
          ...result,
          revisionState: imageRevisionResultState(result),
          safety: { ebayWrites: 0, productionChanged: false },
        })
      } catch (error) {
        const code = safeError(error)
        return NextResponse.json(
          { success: false, error: code },
          { status: imageRevisionErrorStatus(code) },
        )
      }
    }
    const packageId = uuid(url.searchParams.get("packageId"))
    const candidateKey = text(url.searchParams.get("candidateKey"), 300)
    const supabase = getSupabaseAdminClient()
    let query = supabase
      .from("ebay_listing_image_assets")
      .select("*")
      .eq("created_by", validation.userId)
      .eq("account_key", accountKey)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(50)
    if (packageId) query = query.eq("listing_package_id", packageId)
    else if (candidateKey) query = query.eq("candidate_key", candidateKey)
    else return NextResponse.json({ success: false, error: "EBAY_IMAGE_SCOPE_REQUIRED" }, { status: 400 })
    const { data, error } = await query
    if (error) throw new Error("EBAY_IMAGE_ASSET_LIST_FAILED")
    const assets = await Promise.all((data ?? []).map(async (asset) => {
      const reviewable = asset.status !== "rejected"
      const [sourcePreview, outputPreview] = await Promise.all([
        reviewable && asset.source_storage_path
          ? supabase.storage.from(SOURCE_BUCKET)
            .createSignedUrl(asset.source_storage_path, 300)
          : Promise.resolve({ data: null }),
        asset.status === "pending_review" && asset.output_storage_path
          ? supabase.storage.from(STAGING_BUCKET)
            .createSignedUrl(asset.output_storage_path, 300)
          : Promise.resolve({ data: null }),
      ])
      return {
        ...asset,
        source_preview_url: sourcePreview.data?.signedUrl
          ?? (reviewable ? asset.source_url : null),
        output_preview_url: asset.public_url
          ?? outputPreview.data?.signedUrl
          ?? null,
      }
    }))
    return NextResponse.json({
      success: true,
      assets,
      capabilities: {
        deterministicWhiteBackground: true,
        ownedUpload: true,
        authorizedUrl: true,
        humanApprovalRequired: true,
        pendingOutputsPrivate: true,
        generativeAiEnabled:
          getListingImageFactoryConfiguration().aiGeneration === "READY",
        sevenImageVisualStrategyV2: true,
        listingImageFactory: getListingImageFactoryConfiguration(),
        reviewActions: ["APPROVE", "REGENERATE", "CORRECT", "REJECT"],
        output: "1600x1600 JPEG",
      },
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeError(error) }, { status: 502 })
  }
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || !validation.userId) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  const actor = validation.userId
  try {
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) {
      return NextResponse.json(
        { success: false, error: "EBAY_IMAGE_ACCOUNT_SCOPE_REQUIRED" },
        { status: 503 },
      )
    }
    const body = await parseBody(req)
    const action = text(body.action, 40)
    const supabase = getSupabaseAdminClient()

    if (action === "generate") {
      try {
        const baseControlId = uuid(body.baseControlId)
        const requestKey = body.requestKey == null ? undefined : uuid(body.requestKey)
        if (!baseControlId || (body.requestKey != null && !requestKey)) {
          return NextResponse.json(
            { success: false, error: "SAME_DAY_IMAGE_REVISION_GENERATE_INVALID" },
            { status: 400 },
          )
        }
        const generated = await generateAndPersistSameDayImageRevision({
          supabase,
          accountKey,
          actorId: actor,
          baseControlId,
          requestKey,
        })
        const revisionId = uuid(
          "revisionId" in generated
            ? generated.revisionId
            : generated.revision.id,
        )
        const result = revisionId
          ? await getSameDayImageRevision({
            supabase,
            accountKey,
            actorId: actor,
            revisionId,
          })
          : generated
        return NextResponse.json({
          success: true,
          ...result,
          revisionState: imageRevisionResultState(result),
          safety: {
            exactSevenHumanReviewRequired: true,
            ebayWrites: 0,
            productionChanged: false,
          },
        })
      } catch (error) {
        const code = safeError(error)
        return NextResponse.json(
          { success: false, error: code },
          { status: imageRevisionErrorStatus(code) },
        )
      }
    }

    if (action === "review") {
      try {
        const revisionId = uuid(body.revisionId)
        const decision = body.decision === "APPROVE" || body.decision === "REJECT"
          ? body.decision
          : null
        if (!revisionId || !decision || body.confirmed !== true) {
          return NextResponse.json(
            { success: false, error: "SAME_DAY_IMAGE_REVISION_REVIEW_INVALID" },
            { status: 400 },
          )
        }
        const reviewed = await reviewSameDayImageRevision({
          supabase,
          accountKey,
          actorId: actor,
          revisionId,
          decision,
        })
        return NextResponse.json({
          success: true,
          reviewed,
          safety: { ebayWrites: 0, productionChanged: false },
        })
      } catch (error) {
        const code = safeError(error)
        return NextResponse.json(
          { success: false, error: code },
          { status: imageRevisionErrorStatus(code) },
        )
      }
    }

    if (action === "apply_active_revision") {
      try {
        const revisionId = uuid(body.revisionId)
        const baseControlId = uuid(body.baseControlId)
        const ebayItemId = text(body.ebayItemId, 20)
        const idempotencyKey = text(body.idempotencyKey, 120)
        const confirmation = text(body.confirmation, 80)
        if (
          !revisionId || !baseControlId || !/^\d{9,20}$/.test(ebayItemId) ||
          !/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey) ||
          confirmation !== ACTIVE_LISTING_IMAGE_REVISION_CONFIRMATION
        ) {
          return NextResponse.json(
            { success: false, error: "EBAY_ACTIVE_IMAGE_REVISION_CONFIRMATION_INVALID" },
            { status: 400 },
          )
        }
        const application = await applyApprovedImageRevisionToActiveListing({
          supabase,
          accountKey,
          actorId: actor,
          revisionId,
          baseControlId,
          ebayItemId,
          idempotencyKey,
          confirmation,
        })
        const success = application.phase === "applied_verified"
        return NextResponse.json({
          success,
          application,
          safety: {
            permittedMutation: "PICTURE_DETAILS_ONLY",
            exactSevenApprovedImages: application.imageCount === 7,
            maxEbayListingWrites: 1,
            ebayListingWriteAttempts: application.ebayWriteAttemptCount,
            priceChanged: false,
            quantityChanged: false,
            promotionsChanged: false,
            blindRetryAllowed: false,
          },
        }, { status: success ? 200 : 409 })
      } catch (error) {
        const code = safeError(error)
        return NextResponse.json(
          { success: false, error: code },
          { status: imageRevisionErrorStatus(code) },
        )
      }
    }

    const composeSetAction = [
      "compose_set_url",
      "compose_set_upload",
      "compose_ai_set_url",
      "compose_ai_set_upload",
    ].includes(action)
    if (composeSetAction) {
      const aiContextRequested = action === "compose_ai_set_url"
        || action === "compose_ai_set_upload"
      const candidateKey = text(body.candidateKey, 300)
      const packageId = uuid(body.listingPackageId)
      const generationId = uuid(body.generationId)
      if (!candidateKey || !packageId || !generationId) {
        return NextResponse.json(
          { success: false, error: "EBAY_IMAGE_SET_SCOPE_REQUIRED" },
          { status: 400 },
        )
      }
      const packageRow = await packageForActor(supabase, packageId, actor, accountKey)
      if (text(packageRow.candidate_key, 300) !== candidateKey) {
        throw new Error("EBAY_IMAGE_PACKAGE_CANDIDATE_MISMATCH")
      }
      const approved = await approvedGenerationForPackage(
        supabase,
        generationId,
        packageRow,
        accountKey,
      )
      const rights = validateImageRightsEvidence(body)
      let sourceBuffer: Buffer
      let sourceUrl: string | null = null
      let sourceContentType = "image/jpeg"
      let sourceKind: "authorized_url" | "owned_upload"
      if (action === "compose_set_url" || action === "compose_ai_set_url") {
        const fetched = await fetchAuthorizedImageSource(body.sourceUrl)
        sourceBuffer = fetched.buffer
        sourceUrl = fetched.sourceUrl
        sourceContentType = fetched.contentType
        sourceKind = "authorized_url"
      } else {
        const file = body.file
        if (!(file instanceof File) || !supportedUpload(file)) {
          return NextResponse.json(
            { success: false, error: "EBAY_IMAGE_UPLOAD_INVALID" },
            { status: 400 },
          )
        }
        sourceBuffer = Buffer.from(await file.arrayBuffer())
        sourceContentType = file.type
        sourceKind = "owned_upload"
      }
      const sourceMetadata = await sharp(sourceBuffer).metadata()
      const validatedFactoryInput = validateListingImageFactoryInput(
        approved.factoryInput,
      )
      assertEbayImageEvidenceSufficiency({
        facts: validatedFactoryInput.facts,
        briefs: validatedFactoryInput.briefs,
        sourceSha256s: [createHash("sha256").update(sourceBuffer).digest("hex")],
      })
      const aiRuntime = aiContextRequested ? openAiImageRuntime() : null
      const aiPlan = aiRuntime
        ? buildSafeOpenAiBackgroundPlatePlan(
          approved.factoryInput,
          aiRuntime.model,
          "high",
        )
        : null
      const generationIdForPlan = uuid(approved.generation.id)
      if (!generationIdForPlan) throw new Error("EBAY_IMAGE_GENERATION_ID_INVALID")
      if (aiPlan) {
        const existing = await existingOpenAiImageSet(supabase, {
          accountKey,
          actor,
          packageId,
          generationId: generationIdForPlan,
          requestHash: aiPlan.requestHash,
        })
        if (existing) {
          return NextResponse.json({
            success: true,
            setVersion: EBAY_LISTING_IMAGE_SET_VERSION,
            assets: existing,
            created: 0,
            reused: existing.length,
            expected: 7,
            status: "PENDING_HUMAN_REVIEW",
            sourcePolicy: "AUTHORIZED_PRODUCT_IMAGE_ONLY",
            openAiBackgroundPlates: 0,
            openAiResult: "REUSED_IDEMPOTENT_SET",
            competitorImagesUsed: 0,
            ebayWrites: 0,
          })
        }
      }
      let aiRunId = ""
      let aiLeaseToken = ""
      let providerRequestDispatched = false
      let providerOutputReceived = false
      const persistedSetAssetIds: string[] = []
      const uploadedSetObjects: Array<{ bucketId: string; path: string }> = []
      let backgroundOutputSha256: string | null = null
      let backgroundProviderRequestId: string | null = null
      let backgroundUsage = {
        inputTokens: null as number | null,
        outputTokens: null as number | null,
        totalTokens: null as number | null,
      }
      let compositions
      try {
        if (aiPlan && aiRuntime) {
          aiLeaseToken = crypto.randomUUID()
          const idempotencyKeyHash = sha256Text([
            accountKey,
            actor,
            packageId,
            generationIdForPlan,
            aiPlan.requestHash,
          ].join(":"))
          const { data: claimData, error: claimError } = await supabase.rpc(
            "claim_ebay_openai_image_context_run",
            {
              p_account_key: accountKey,
              p_actor: actor,
              p_listing_package_id: packageId,
              p_listing_generation_id: generationIdForPlan,
              p_identity_fingerprint: approved.factoryInput.identityFingerprint,
              p_context_kind: aiPlan.context,
              p_model: aiPlan.model,
              p_plate_version: aiPlan.version,
              p_prompt_hash: aiPlan.promptHash,
              p_request_hash: aiPlan.requestHash,
              p_idempotency_key_hash: idempotencyKeyHash,
              p_lease_token: aiLeaseToken,
              p_daily_call_limit: aiRuntime.dailyCallLimit,
            },
          )
          if (claimError) {
            throw new Error(databaseErrorCode(
              claimError,
              "EBAY_IMAGE_OPENAI_CLAIM_FAILED",
            ))
          }
          const claim = record(claimData)
          aiRunId = uuid(claim.runId)
          if (claim.claimed !== true || !aiRunId) {
            if (claim.status === "COMPLETED") {
              const existing = await existingOpenAiImageSet(supabase, {
                accountKey,
                actor,
                packageId,
                generationId: generationIdForPlan,
                requestHash: aiPlan.requestHash,
              })
              if (existing) {
                return NextResponse.json({
                  success: true,
                  setVersion: EBAY_LISTING_IMAGE_SET_VERSION,
                  assets: existing,
                  created: 0,
                  reused: existing.length,
                  expected: 7,
                  status: "PENDING_HUMAN_REVIEW",
                  sourcePolicy: "AUTHORIZED_PRODUCT_IMAGE_ONLY",
                  openAiBackgroundPlates: 0,
                  openAiResult: "REUSED_IDEMPOTENT_SET",
                  competitorImagesUsed: 0,
                  ebayWrites: 0,
                })
              }
            }
            throw new Error("EBAY_IMAGE_OPENAI_RUN_NOT_CLAIMED")
          }
          // From this point onward a timeout is ambiguous: OpenAI may have
          // accepted the request even if Seller OS never receives the pixels.
          // Fail closed instead of buying a duplicate generation automatically.
          providerRequestDispatched = true
          const backgroundPlate = await requestSafeOpenAiBackgroundPlate({
            plan: aiPlan,
            apiKey: aiRuntime.apiKey,
          })
          providerOutputReceived = true
          backgroundOutputSha256 = backgroundPlate.outputSha256
          backgroundProviderRequestId = backgroundPlate.providerRequestId
          backgroundUsage = backgroundPlate.usage
          try {
            compositions = await composeAuthorizedEbayListingImageSet(
              sourceBuffer,
              approved.factoryInput,
              backgroundPlate,
            )
          } finally {
            // The standalone provider output is never persisted or returned.
            // Only the locally composited review asset survives.
            backgroundPlate.output.fill(0)
          }
        } else {
          compositions = await composeAuthorizedEbayListingImageSet(
            sourceBuffer,
            approved.factoryInput,
          )
        }
      const roleBySlot: Record<string, string> = {
        MAIN_WHITE_BACKGROUND: "main",
        PACK_AND_COUNT: "detail",
        KEY_FEATURES: "detail",
        SIZE_AND_CONTENT: "label",
        USE_CONTEXT: "lifestyle",
        PACKAGE_CONTENTS: "packaging",
        SECONDARY_6: "detail",
      }
      const created: JsonRecord[] = []
      const reused: JsonRecord[] = []
      const pendingAssets: JsonRecord[] = []
      for (const composition of compositions) {
        const { data: duplicate, error: duplicateError } = await supabase
          .from("ebay_listing_image_assets")
          .select("*")
          .eq("account_key", accountKey)
          .eq("created_by", actor)
          .eq("listing_package_id", packageId)
          .eq("output_sha256", composition.outputSha256)
          .in("status", ["pending_review", "approved"])
          .contains("transformation", {
            listingGenerationId: approved.generation.id,
            slot: composition.slot,
          })
          .maybeSingle()
        if (duplicateError) throw new Error("EBAY_IMAGE_DUPLICATE_CHECK_FAILED")
        if (duplicate) {
          reused.push(duplicate)
          continue
        }
        const assetId = crypto.randomUUID()
        const basePath = `${actor}/${candidatePath(candidateKey)}/${assetId}`
        const outputPath = `${basePath}-optimized.jpg`
        const sourceExtension = sourceContentType === "image/png"
          ? "png" : sourceContentType === "image/webp" ? "webp" : "jpg"
        const sourcePath = `${basePath}-source.${sourceExtension}`
        const { error: sourceUploadError } = await supabase.storage
          .from(SOURCE_BUCKET)
          .upload(sourcePath, sourceBuffer, { contentType: sourceContentType, upsert: false })
        if (sourceUploadError) throw new Error("EBAY_IMAGE_SOURCE_STORAGE_FAILED")
        uploadedSetObjects.push({ bucketId: SOURCE_BUCKET, path: sourcePath })
        const { error: outputUploadError } = await supabase.storage
          .from(STAGING_BUCKET)
          .upload(outputPath, composition.output, { contentType: "image/jpeg", upsert: false })
        if (outputUploadError) {
          await supabase.storage.from(SOURCE_BUCKET).remove([sourcePath])
          uploadedSetObjects.pop()
          throw new Error("EBAY_IMAGE_OUTPUT_STORAGE_FAILED")
        }
        uploadedSetObjects.push({ bucketId: STAGING_BUCKET, path: outputPath })
        pendingAssets.push({
          id: assetId,
          asset_role: roleBySlot[composition.slot],
          source_kind: sourceKind,
          source_url: sourceUrl,
          source_storage_path: sourcePath,
          output_storage_path: outputPath,
          source_sha256: composition.sourceSha256,
          output_sha256: composition.outputSha256,
          source_width: sourceMetadata.width,
          source_height: sourceMetadata.height,
          output_width: composition.width,
          output_height: composition.height,
          output_bytes: composition.bytes,
          rights_basis: rights.rightsBasis,
          authorization_reference: rights.authorizationReference,
          rights_evidence_confirmed: rights.rightsEvidenceConfirmed,
          transformation_version: EBAY_LISTING_IMAGE_SET_VERSION,
          transformation: {
            ...composition.transformation,
            listingGenerationId: approved.generation.id,
            listingGenerationOutputHash: approved.generation.output_hash,
          },
          qa_result: composition.qa,
        })
      }
      if (pendingAssets.length > 0) {
        const { data, error } = await supabase.rpc(
          "ebay_create_pending_listing_image_set",
          {
            p_package_id: packageId,
            p_account_key: accountKey,
            p_actor: actor,
            p_opportunity_id: packageRow.opportunity_id,
            p_candidate_key: candidateKey,
            p_assets: pendingAssets,
          },
        )
        const rows = (Array.isArray(data) ? data : data ? [data] : [])
          .map(record)
        if (
          error
          || rows.length !== pendingAssets.length
          || rows.some((row) => !uuid(row.id))
        ) {
          throw new Error(databaseErrorCode(error, "EBAY_IMAGE_ASSET_SET_SAVE_FAILED"))
        }
        created.push(...rows)
        persistedSetAssetIds.push(...rows.map((row) => uuid(row.id)))
      }
      if (created.length + reused.length !== EBAY_LISTING_IMAGE_SLOTS.length) {
        throw new Error("EBAY_IMAGE_SET_INCOMPLETE")
      }
      if (aiRunId && aiLeaseToken && backgroundOutputSha256) {
        const { error: completionError } = await supabase.rpc(
          "complete_ebay_openai_image_context_run",
          {
            p_run_id: aiRunId,
            p_actor: actor,
            p_lease_token: aiLeaseToken,
            p_output_sha256: backgroundOutputSha256,
            p_provider_request_id: backgroundProviderRequestId ?? "",
            p_input_tokens: backgroundUsage.inputTokens,
            p_output_tokens: backgroundUsage.outputTokens,
            p_total_tokens: backgroundUsage.totalTokens,
          },
        )
        if (completionError) {
          throw new Error(databaseErrorCode(
            completionError,
            "EBAY_IMAGE_OPENAI_COMPLETION_FAILED",
          ))
        }
      }
      return NextResponse.json({
        success: true,
        setVersion: EBAY_LISTING_IMAGE_SET_VERSION,
        assets: [...reused, ...created],
        created: created.length,
        reused: reused.length,
        expected: 7,
        status: "PENDING_HUMAN_REVIEW",
        sourcePolicy: "AUTHORIZED_PRODUCT_IMAGE_ONLY",
        openAiBackgroundPlates: aiContextRequested ? 1 : 0,
        openAiResult: aiContextRequested ? "GENERATED_BACKGROUND_ONLY" : "NOT_USED",
        competitorImagesUsed: 0,
        ebayWrites: 0,
      })
      } catch (error) {
        let failureCode = safeError(error)
        try {
          if (persistedSetAssetIds.length > 0) {
            const { error: deleteError } = await supabase
              .from("ebay_listing_image_assets")
              .delete()
              .eq("account_key", accountKey)
              .eq("created_by", actor)
              .eq("listing_package_id", packageId)
              .in("id", persistedSetAssetIds)
            if (deleteError) {
              throw new Error("EBAY_IMAGE_PARTIAL_SET_DATABASE_CLEANUP_FAILED")
            }
          }
          for (const bucketId of [SOURCE_BUCKET, STAGING_BUCKET]) {
            const paths = uploadedSetObjects
              .filter((object) => object.bucketId === bucketId)
              .map((object) => object.path)
            if (paths.length === 0) continue
            const { error: removalError } = await supabase.storage
              .from(bucketId)
              .remove(paths)
            if (removalError) {
              throw new Error("EBAY_IMAGE_PARTIAL_SET_STORAGE_CLEANUP_FAILED")
            }
          }
        } catch {
          failureCode = "EBAY_IMAGE_PARTIAL_SET_CLEANUP_REQUIRED"
        }
        if (aiRunId && aiLeaseToken) {
          try {
            await supabase.rpc("fail_ebay_openai_image_context_run", {
              p_run_id: aiRunId,
              p_actor: actor,
              p_lease_token: aiLeaseToken,
              p_error_code: failureCode,
              // Once pixels were returned, fail closed instead of silently
              // purchasing a duplicate generation on retry.
              p_retryable: !providerRequestDispatched
                && !providerOutputReceived
                && retryableOpenAiImageError(error),
            })
          } catch {
            // The original sanitized pipeline failure remains authoritative.
          }
        }
        throw new Error(failureCode)
      }
    }

    if (action === "optimize_url" || action === "optimize_upload") {
      const candidateKey = text(body.candidateKey, 300)
      if (!candidateKey) {
        return NextResponse.json({ success: false, error: "EBAY_IMAGE_CANDIDATE_REQUIRED" }, { status: 400 })
      }
      const packageId = uuid(body.listingPackageId)
      const opportunityId = uuid(body.opportunityId)
      if (!packageId) {
        return NextResponse.json(
          { success: false, error: "EBAY_IMAGE_PACKAGE_REQUIRED" },
          { status: 400 },
        )
      }
      const rights = validateImageRightsEvidence(body)
      const assetRole = ["main", "detail", "packaging", "label", "lifestyle"]
        .includes(text(body.assetRole, 30)) ? text(body.assetRole, 30) : "main"
      const packageRow = await packageForActor(
        supabase,
        packageId,
        actor,
        accountKey,
      )
      if (text(packageRow.candidate_key, 300) !== candidateKey) {
        throw new Error("EBAY_IMAGE_PACKAGE_CANDIDATE_MISMATCH")
      }
      const packageOpportunityId = uuid(packageRow.opportunity_id)
      if (!packageOpportunityId) {
        throw new Error("EBAY_IMAGE_PACKAGE_OPPORTUNITY_INVALID")
      }
      if (opportunityId && packageOpportunityId !== opportunityId) {
        throw new Error("EBAY_IMAGE_PACKAGE_OPPORTUNITY_MISMATCH")
      }

      let sourceBuffer: Buffer
      let sourceUrl: string | null = null
      let sourceContentType = "image/jpeg"
      let sourceKind: "authorized_url" | "owned_upload"
      if (action === "optimize_url") {
        const fetched = await fetchAuthorizedImageSource(body.sourceUrl)
        sourceBuffer = fetched.buffer
        sourceUrl = fetched.sourceUrl
        sourceContentType = fetched.contentType
        sourceKind = "authorized_url"
      } else {
        const file = body.file
        if (!(file instanceof File) || !supportedUpload(file)) {
          return NextResponse.json({ success: false, error: "EBAY_IMAGE_UPLOAD_INVALID" }, { status: 400 })
        }
        sourceBuffer = Buffer.from(await file.arrayBuffer())
        sourceContentType = file.type
        sourceKind = "owned_upload"
      }

      const optimized = await optimizeAuthorizedEbayMainImage(sourceBuffer)
      const duplicateQuery = supabase
        .from("ebay_listing_image_assets")
        .select("*")
        .eq("account_key", accountKey)
        .eq("created_by", actor)
        .eq("candidate_key", candidateKey)
        .eq("output_sha256", optimized.outputSha256)
        .eq("listing_package_id", packageId)
        .in("status", ["pending_review", "approved"])
      const { data: duplicate, error: duplicateError } = await duplicateQuery.maybeSingle()
      if (duplicateError) throw new Error("EBAY_IMAGE_DUPLICATE_CHECK_FAILED")
      if (duplicate) return NextResponse.json({ success: true, created: false, asset: duplicate })

      const assetId = crypto.randomUUID()
      const basePath = `${actor}/${candidatePath(candidateKey)}/${assetId}`
      const outputPath = `${basePath}-optimized.jpg`
      const sourceExtension = sourceContentType === "image/png" ? "png" : sourceContentType === "image/webp" ? "webp" : "jpg"
      const sourcePath = `${basePath}-source.${sourceExtension}`
      const { error: sourceUploadError } = await supabase.storage
        .from(SOURCE_BUCKET)
        .upload(sourcePath, sourceBuffer, { contentType: sourceContentType, upsert: false })
      if (sourceUploadError) throw new Error("EBAY_IMAGE_SOURCE_STORAGE_FAILED")
      const { error: outputUploadError } = await supabase.storage
        .from(STAGING_BUCKET)
        .upload(outputPath, optimized.output, { contentType: "image/jpeg", upsert: false })
      if (outputUploadError) {
        await supabase.storage.from(SOURCE_BUCKET).remove([sourcePath])
        throw new Error("EBAY_IMAGE_OUTPUT_STORAGE_FAILED")
      }
      const { data: createdAssets, error: insertError } = await supabase.rpc(
        "ebay_create_pending_listing_image",
        {
          p_package_id: packageId,
          p_account_key: accountKey,
          p_actor: actor,
          p_opportunity_id: packageOpportunityId,
          p_candidate_key: candidateKey,
          p_asset: {
            id: assetId,
            asset_role: assetRole,
            source_kind: sourceKind,
            source_url: sourceUrl,
            source_storage_path: sourcePath,
            output_storage_path: outputPath,
            source_sha256: optimized.sourceSha256,
            output_sha256: optimized.outputSha256,
            source_width: optimized.source.width,
            source_height: optimized.source.height,
            output_width: optimized.outputMetadata.width,
            output_height: optimized.outputMetadata.height,
            output_bytes: optimized.outputMetadata.bytes,
            rights_basis: rights.rightsBasis,
            authorization_reference: rights.authorizationReference,
            rights_evidence_confirmed: rights.rightsEvidenceConfirmed,
            transformation_version: EBAY_IMAGE_TRANSFORMATION_VERSION,
            transformation: optimized.transformation,
            qa_result: optimized.qa,
          },
        },
      )
      const asset = Array.isArray(createdAssets)
        ? record(createdAssets[0])
        : record(createdAssets)
      if (insertError || !asset.id) {
        const { data: concurrentDuplicate } = await supabase
          .from("ebay_listing_image_assets")
          .select("*")
          .eq("account_key", accountKey)
          .eq("created_by", actor)
          .eq("candidate_key", candidateKey)
          .eq("output_sha256", optimized.outputSha256)
          .eq("listing_package_id", packageId)
          .in("status", ["pending_review", "approved"])
          .maybeSingle()
        if (concurrentDuplicate) {
          const rpcCommittedThisAsset = concurrentDuplicate.id === assetId
          if (!rpcCommittedThisAsset) {
            await supabase.storage.from(STAGING_BUCKET).remove([outputPath])
            await supabase.storage.from(SOURCE_BUCKET).remove([sourcePath])
          }
          return NextResponse.json({
            success: true,
            created: rpcCommittedThisAsset,
            asset: concurrentDuplicate,
          })
        }
        await supabase.storage.from(STAGING_BUCKET).remove([outputPath])
        await supabase.storage.from(SOURCE_BUCKET).remove([sourcePath])
        throw new Error(databaseErrorCode(insertError, "EBAY_IMAGE_ASSET_SAVE_FAILED"))
      }
      return NextResponse.json({ success: true, created: true, asset })
    }

    if (action === "approve" || action === "reject") {
      const assetId = uuid(body.assetId)
      const packageId = uuid(body.listingPackageId)
      if (!assetId || !packageId) {
        return NextResponse.json(
          { success: false, error: "EBAY_IMAGE_REVIEW_SCOPE_REQUIRED" },
          { status: 400 },
        )
      }
      const { data: reviewAsset, error: reviewAssetError } = await supabase
        .from("ebay_listing_image_assets")
        .select("*")
        .eq("id", assetId)
        .eq("listing_package_id", packageId)
        .eq("account_key", accountKey)
        .eq("created_by", actor)
        .eq("status", "pending_review")
        .maybeSingle()
      if (reviewAssetError || !reviewAsset) {
        throw new Error("EBAY_IMAGE_ASSET_NOT_REVIEWABLE")
      }
      if (action === "approve" &&
        record(reviewAsset.qa_result).automaticStatus !== "PASSED") {
        throw new Error("SAME_DAY_IMAGE_SET_QA_NOT_PASSED")
      }

      let publicUrl: string | null = null
      let publishedPath: string | null = null
      let publishedObjectCreated = false
      if (action === "approve") {
        const stagingPath = text(reviewAsset.output_storage_path, 1_000)
        if (!stagingPath) throw new Error("EBAY_IMAGE_STAGING_ASSET_MISSING")
        const { data: stagedBlob, error: stagingDownloadError } = await supabase.storage
          .from(STAGING_BUCKET)
          .download(stagingPath)
        if (stagingDownloadError || !stagedBlob) {
          throw new Error("EBAY_IMAGE_STAGING_DOWNLOAD_FAILED")
        }
        const stagedOutput = Buffer.from(await stagedBlob.arrayBuffer())
        if (
          !stagedOutput.length
          || stagedOutput.length > MAX_OUTPUT_BYTES
          || stagedOutput.length !== Number(reviewAsset.output_bytes)
          || createHash("sha256").update(stagedOutput).digest("hex")
            !== text(reviewAsset.output_sha256, 64)
        ) {
          throw new Error("EBAY_IMAGE_STAGING_INTEGRITY_FAILED")
        }
        const reviewCandidateKey = text(reviewAsset.candidate_key, 300)
        if (!reviewCandidateKey) throw new Error("EBAY_IMAGE_CANDIDATE_REQUIRED")
        publishedPath = `${actor}/${candidatePath(reviewCandidateKey)}/${assetId}.jpg`
        const { error: publishError } = await supabase.storage
          .from(OUTPUT_BUCKET)
          .upload(publishedPath, stagedOutput, {
            contentType: "image/jpeg",
            upsert: false,
          })
        publishedObjectCreated = !publishError
        if (publishError) {
          // The storage upload and SQL review cannot be one cross-service
          // transaction. A prior request may therefore have uploaded these
          // exact bytes and stopped before committing the review. Reuse only
          // a byte-for-byte/hash-identical object; never overwrite a conflict.
          const { data: existingPublishedBlob, error: existingPublishedError } =
            await supabase.storage.from(OUTPUT_BUCKET).download(publishedPath)
          if (existingPublishedError || !existingPublishedBlob) {
            throw new Error("EBAY_IMAGE_PUBLICATION_STORAGE_FAILED")
          }
          const existingPublished = Buffer.from(
            await existingPublishedBlob.arrayBuffer(),
          )
          if (
            existingPublished.length !== stagedOutput.length ||
            createHash("sha256").update(existingPublished).digest("hex") !==
              text(reviewAsset.output_sha256, 64)
          ) {
            throw new Error("EBAY_IMAGE_PUBLICATION_CONFLICT")
          }
        }
        publicUrl = supabase.storage.from(OUTPUT_BUCKET)
          .getPublicUrl(publishedPath).data.publicUrl
      }

      const { data: reviewData, error: reviewError } = await supabase.rpc(
        "ebay_review_listing_image_and_attach",
        {
          p_package_id: packageId,
          p_account_key: accountKey,
          p_asset_id: assetId,
          p_actor: actor,
          p_decision: action,
          p_public_url: publicUrl,
          p_published_storage_path: publishedPath,
        },
      )
      let resolvedReviewData: unknown = reviewData
      if (reviewError || !resolvedReviewData) {
        const { data: reconciledAsset } = await supabase
          .from("ebay_listing_image_assets")
          .select("*")
          .eq("id", assetId)
          .eq("listing_package_id", packageId)
          .eq("account_key", accountKey)
          .eq("created_by", actor)
          .maybeSingle()
        const reviewCommitted = action === "approve"
          ? reconciledAsset?.status === "approved"
            && reconciledAsset.published_storage_path === publishedPath
            && reconciledAsset.public_url === publicUrl
          : reconciledAsset?.status === "rejected"
        if (reviewCommitted && reconciledAsset) {
          const reconciledPackage = await packageForActor(
            supabase,
            packageId,
            actor,
            accountKey,
          )
          resolvedReviewData = {
            asset: reconciledAsset,
            package: {
              imageUrls: record(reconciledPackage.package_data).imageUrls ?? [],
            },
          }
        } else {
          if (publishedPath && publishedObjectCreated) {
            const compensation = await supabase.storage.from(OUTPUT_BUCKET)
              .remove([publishedPath])
            if (compensation.error) {
              throw new Error("PUBLIC_STORAGE_COMPENSATION_FAILED")
            }
          }
          throw new Error(databaseErrorCode(
            reviewError,
            "EBAY_IMAGE_ASSET_REVIEW_FAILED",
          ))
        }
      }
      let cleanupPending = false
      let cleanupTracked = true
      if (action === "approve") {
        const cleanupPaths = [text(reviewAsset.output_storage_path, 1_000)]
          .filter(Boolean)
        const { error: cleanupError } = await supabase.storage
          .from(STAGING_BUCKET)
          .remove(cleanupPaths)
        cleanupPending = Boolean(cleanupError)
        if (cleanupError && cleanupPaths[0]) {
          try {
            await enqueueEbayImageStorageCleanup(supabase, {
              accountKey,
              assetId,
              packageId,
              cleanupKind: "approved_staging",
              bucketId: STAGING_BUCKET,
              storageKey: cleanupPaths[0],
              expectedSha256: text(reviewAsset.output_sha256, 64),
              requestedBy: actor,
            })
          } catch {
            cleanupTracked = false
          }
        }
      } else {
        const stagingPath = text(reviewAsset.output_storage_path, 1_000)
        const sourcePath = text(reviewAsset.source_storage_path, 1_000)
        const [stagingCleanup, sourceCleanup] = await Promise.all([
          stagingPath
            ? supabase.storage.from(STAGING_BUCKET).remove([stagingPath])
            : Promise.resolve({ error: null }),
          sourcePath
            ? supabase.storage.from(SOURCE_BUCKET).remove([sourcePath])
            : Promise.resolve({ error: null }),
        ])
        cleanupPending = Boolean(stagingCleanup.error || sourceCleanup.error)
        const cleanupRequests = [
          ...(stagingCleanup.error && stagingPath ? [{
            cleanupKind: "rejected_staging" as const,
            bucketId: STAGING_BUCKET,
            storageKey: stagingPath,
            expectedSha256: text(reviewAsset.output_sha256, 64),
          }] : []),
          ...(sourceCleanup.error && sourcePath ? [{
            cleanupKind: "rejected_source" as const,
            bucketId: SOURCE_BUCKET,
            storageKey: sourcePath,
            expectedSha256: text(reviewAsset.source_sha256, 64),
          }] : []),
        ]
        for (const cleanup of cleanupRequests) {
          try {
            await enqueueEbayImageStorageCleanup(supabase, {
              accountKey,
              assetId,
              packageId,
              requestedBy: actor,
              ...cleanup,
            })
          } catch {
            cleanupTracked = false
          }
        }
      }
      const result = record(resolvedReviewData)
      const packageResult = record(result.package)
      const imageUrls = Array.isArray(packageResult.imageUrls)
        ? packageResult.imageUrls.filter(
          (value): value is string => typeof value === "string",
        )
        : []
      return NextResponse.json({
        success: true,
        asset: record(result.asset),
        imageUrls,
        storageCleanupPending: cleanupPending,
        storageCleanupTracked: cleanupPending ? cleanupTracked : true,
      })
    }

    if (action === "reorder") {
      const packageId = uuid(body.listingPackageId)
      const orderedAssetIds = Array.isArray(body.orderedAssetIds)
        ? body.orderedAssetIds.map(uuid).filter(Boolean).slice(0, 24)
        : []
      if (!packageId || !orderedAssetIds.length) {
        return NextResponse.json({ success: false, error: "EBAY_IMAGE_ORDER_REQUIRED" }, { status: 400 })
      }
      if (new Set(orderedAssetIds).size !== orderedAssetIds.length) {
        throw new Error("EBAY_IMAGE_ORDER_OWNERSHIP_MISMATCH")
      }
      const { data, error } = await supabase.rpc(
        "ebay_reorder_listing_images_and_attach",
        {
          p_package_id: packageId,
          p_account_key: accountKey,
          p_actor: actor,
          p_ordered_asset_ids: orderedAssetIds,
        },
      )
      if (error || !data) {
        throw new Error(databaseErrorCode(error, "EBAY_IMAGE_ORDER_SAVE_FAILED"))
      }
      const result = record(data)
      const imageUrls = Array.isArray(result.imageUrls)
        ? result.imageUrls.filter(
          (value): value is string => typeof value === "string",
        )
        : []
      return NextResponse.json({ success: true, imageUrls })
    }

    return NextResponse.json({ success: false, error: "EBAY_IMAGE_ACTION_INVALID" }, { status: 400 })
  } catch (error) {
    const code = safeError(error)
    const status = /CAP_REACHED|NOT_REVIEWABLE|PENDING_REVIEW_BLOCKS_REORDER|STAGING_INTEGRITY|QA_NOT_PASSED|NEEDS_MORE|MARKET_VISUAL_SIGNALS_INSUFFICIENT|PUBLIC_STORAGE_COMPENSATION_FAILED/.test(code)
      ? 409
      : /REQUIRED|INVALID|NOT_ALLOWED|BELOW_500PX|MANUAL_REMOVAL|MISMATCH/.test(code)
      ? 400
      : /NOT_FOUND/.test(code) ? 404 : 502
    return NextResponse.json({ success: false, error: code }, { status })
  }
}
