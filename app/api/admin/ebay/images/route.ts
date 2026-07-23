export const runtime = "nodejs"
export const maxDuration = 300

import { createHash, createHmac } from "node:crypto"
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
import {
  loadAuthorizedCatalogNativeMedia,
  resolveProtectedAuthorizedCatalogNativeMedia,
} from "@/lib/ebay/authorized-catalog-native-media"
import { persistAuthorizedCatalogSourcePack } from "@/lib/ebay/luna-catalog-source-pack-persistence"
import { LUNA_CATALOG_SOURCE_RESOLVER_VERSION } from "@/lib/ebay/luna-catalog-original-source-resolver"
import { productFactsHash } from "@/lib/ebay/ebay-product-facts-readiness"
import { resolveCanonicalProductIdentity } from "@/lib/ebay/canonical-product-identity"
import {
  buildReferenceGuidedV3CompositionManifest,
  verifyExactReferenceGuidedPrompt,
} from "@/lib/ebay/reference-guided-v3-manifest"
import {
  isInitialReferenceGuidedPrepare,
  persistedReferenceGuidedManifestMatches,
} from "@/lib/ebay/reference-guided-prepare-idempotency"
import { REFERENCE_GUIDED_SEVEN_ASSET_ROLES } from
  "@/lib/ebay/reference-guided-seven-asset-contract"

const OUTPUT_BUCKET = "ebay-listing-images"
const SOURCE_BUCKET = EBAY_IMAGE_SOURCE_BUCKET
const STAGING_BUCKET = EBAY_IMAGE_STAGING_BUCKET
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024
const PREVIEW_SECRET = process.env.SELLER_OS_PREVIEW_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "staging-preview-secret"
const REFERENCE_GUIDED_PROVIDER_ENABLED =
  process.env.OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED === "true"
function previewToken(parentRevisionId: string, expiresAt: number, hashes: string[]) {
  const body = `${parentRevisionId}.${expiresAt}.${hashes.sort().join(",")}`
  return `${expiresAt}.${createHmac("sha256", PREVIEW_SECRET).update(body).digest("hex")}`
}

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
  if (/^(NEEDS_ADDITIONAL_SOURCE_IMAGE:|NEEDS_VERIFIED_PRODUCT_FACTS:|MARKET_VISUAL_SIGNALS_INSUFFICIENT$|LUNA_CATALOG_MEDIA_MISSING$)/.test(code)) {
    return 422
  }
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
    const protectedParentId = uuid(url.searchParams.get("protectedSourcePreview"))
    if (protectedParentId) {
      const { data: parent } = await getSupabaseAdminClient().from("ebay_same_day_pilot_image_revisions").select("listing_package_id,candidate_id").eq("id", protectedParentId).maybeSingle()
      if (!parent) return NextResponse.json({ success: false, error: "PARENT_REVISION_NOT_FOUND" }, { status: 404 })
      const { data: candidate } = await getSupabaseAdminClient().from("ebay_same_day_pilot_candidates").select("opportunity_id,supplier_sku,supplier_variant_id").eq("id", parent.candidate_id).maybeSingle()
      const { data: opportunity } = candidate?.opportunity_id ? await getSupabaseAdminClient().from("ebay_luna_opportunity_queue").select("supplier_product_id,supplier_variant_id").eq("id", candidate.opportunity_id).maybeSingle() : { data: null }
      const definitions = await loadAuthorizedCatalogNativeMedia({ supabase: getSupabaseAdminClient(), accountKey, actorId: validation.userId, listingPackageId: parent.listing_package_id, candidateId: parent.candidate_id, supplierProductId: text(opportunity?.supplier_product_id || candidate?.supplier_sku, 40), supplierVariantId: text(opportunity?.supplier_variant_id || candidate?.supplier_variant_id, 40) })
      const assets = await resolveProtectedAuthorizedCatalogNativeMedia({ definitions })
      const expiresAt = Date.now() + 5 * 60 * 1000
      const previewSetId = previewToken(protectedParentId, expiresAt, assets.map((a) => a.sha256))
      const response = NextResponse.json({ success: true, previewSetId, expiresAt, images: assets.map((asset) => ({ sourceImageId: asset.sourceImageId, sourceAngle: asset.sourceAngle, width: asset.nativeWidth, height: asset.nativeHeight, sha256: asset.sha256, dataUrl: `data:image/jpeg;base64,${asset.nativeBuffer.toString("base64")}` })) })
      response.headers.set("Cache-Control", "no-store")
      return response
    }
    if (url.searchParams.get("activeRevision") === "1") {
      const candidateKey = text(url.searchParams.get("candidateKey"), 300)
      const adminDb = getSupabaseAdminClient()
      const visualReviewRevisionId = uuid(
        url.searchParams.get("visualReviewRevisionId"),
      )
      if (!candidateKey && !visualReviewRevisionId) return NextResponse.json({ success: false, error: "VISUAL_REVIEW_SCOPE_REQUIRED" }, { status: 400 })
      const { data: requestedRevision, error: requestedRevisionError } =
        visualReviewRevisionId
          ? await adminDb.from("ebay_same_day_pilot_image_revisions")
            .select("id,candidate_id")
            .eq("id", visualReviewRevisionId)
            .eq("created_by", validation.userId)
            .eq("marketplace_account_key", accountKey)
            .maybeSingle()
          : { data: null, error: null }
      if (requestedRevisionError || (visualReviewRevisionId && !requestedRevision)) {
        return NextResponse.json({ success: false, error: "ACTIVE_REVISION_NOT_FOUND" }, { status: 404 })
      }
      const { data: candidate } = requestedRevision
        ? { data: { id: requestedRevision.candidate_id } }
        : await adminDb.from("ebay_same_day_pilot_candidates").select("id")
          .eq("candidate_key", candidateKey).order("created_at", { ascending: false })
          .limit(1).maybeSingle()
      if (!candidate) return NextResponse.json({ success: true, revision: null, v3Eligible: false, blockedReason: "ACTIVE_REVISION_NOT_FOUND" })
      const { data: revisions, error: revisionError } = await adminDb.from("ebay_same_day_pilot_image_revisions").select("id,listing_package_id,strategy_version,revision_contract,parent_revision_id,status,revision_fingerprint,created_at").eq("candidate_id", candidate.id).eq("created_by", validation.userId).eq("marketplace_account_key", accountKey).order("created_at", { ascending: false }).limit(20)
      if (revisionError) throw new Error("ACTIVE_REVISION_LOOKUP_FAILED")
      const active = (revisions ?? []).find((row) => row.strategy_version === "VISUAL_STRATEGY_V3" && row.revision_contract === "REFERENCE_GUIDED_PRODUCT_GENERATION_V1") ?? (revisions ?? []).find((row) => row.strategy_version === "VISUAL_STRATEGY_V2") ?? null
      if (visualReviewRevisionId && active?.id !== visualReviewRevisionId) {
        return NextResponse.json({ success: false, error: "VISUAL_REVIEW_REVISION_NOT_ACTIVE" }, { status: 409 })
      }
      const child = active?.strategy_version === "VISUAL_STRATEGY_V2" ? (revisions ?? []).find((row) => row.parent_revision_id === active.id && row.strategy_version === "VISUAL_STRATEGY_V3") : active
      const { data: pack } = active?.listing_package_id ? await adminDb.from("luna_catalog_authorized_source_packs").select("id,source_pack_hash,manifest_hash,source_assets,authoritative_fact_package_hash").eq("marketplace_account_key", accountKey).eq("listing_package_id", active.listing_package_id).order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null }
      const packAssets = Array.isArray(pack?.source_assets) ? pack.source_assets as Array<Record<string, unknown>> : []
      const protectedSourcePackReady = Boolean(pack?.id && packAssets.length === 2 && packAssets.every((asset) => typeof asset.storagePath === "string" && asset.storagePath.length > 0))
      const { data: candidateFacts } = await adminDb.from("ebay_same_day_pilot_candidates").select("product_facts_summary").eq("id", candidate.id).maybeSingle()
      const factsPackage = record(record(candidateFacts?.product_facts_summary).authoritativeFactsPackage)
      const productDossierAvailable = factsPackage.ready === true && typeof factsPackage.factPackageHash === "string" && factsPackage.factPackageHash.length > 0
      const v3CreateEligible = Boolean(active?.strategy_version === "VISUAL_STRATEGY_V2" && protectedSourcePackReady && productDossierAvailable && !child)
      const { data: persistedAttempt, error: persistedAttemptError } = active?.strategy_version === "VISUAL_STRATEGY_V3"
        ? await adminDb.from("ebay_reference_guided_generation_attempts")
          .select("id,revision_id,status,completed_job_count,expected_job_count,provider_calls")
          .eq("revision_id", active.id)
          .neq("status", "SUPERSEDED_INVALID_MANIFEST")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        : { data: null, error: null }
      if (persistedAttemptError) throw new Error("REFERENCE_GUIDED_STATUS_FAILED")
      return NextResponse.json({ success: true, revision: active, existingV3RevisionId: child?.id ?? null, persistedAttemptId: persistedAttempt?.id ?? null, persistedAttempt: persistedAttempt ?? null, sourcePackId: pack?.id ?? null, protectedSourcePackReady, sourcePackManifestHash: pack?.manifest_hash ?? pack?.source_pack_hash ?? null, productDossierAvailable, v3CreateEligible, v3Eligible: v3CreateEligible, blockedReason: active ? null : "ACTIVE_REVISION_NOT_FOUND" })
    }
    const attemptId = uuid(url.searchParams.get("attemptId"))
    if (attemptId) {
      const requestedRevisionId = uuid(url.searchParams.get("revisionId"))
      const supabase = getSupabaseAdminClient()
      const [{ data: attempt, error: attemptError }, { data: jobs, error: jobsError },
        { data: deterministicPreview, error: deterministicPreviewError },
        { data: assetSlots, error: assetSlotsError },
        { data: primaryMainPreview, error: primaryMainPreviewError },
        { data: deterministicVariants, error: deterministicVariantsError },
        { data: finalAssetSelection, error: finalAssetSelectionError },
        { data: phaseAPosition2Asset, error: phaseAPosition2AssetError },
        { data: assetReviews, error: assetReviewsError }] = await Promise.all([
        supabase.from("ebay_reference_guided_generation_attempts").select("id,revision_id,composition_manifest_hash,status,completed_job_count,expected_job_count,provider_calls,retry_consumed,created_at,started_at,completed_at").eq("id", attemptId).maybeSingle(),
        supabase.from("ebay_reference_guided_generation_jobs").select("id,position,commercial_role,status,provider_request_id,output_storage_path,output_sha256,qa_result,error_code,lease_owner,lease_expires_at,provider_call_started_at,provider_call_completed_at").eq("generation_attempt_id", attemptId).order("position"),
        supabase.from("ebay_reference_guided_deterministic_previews")
          .select("id,job_id,job_position,asset_ordinal,asset_role,contract_version,source_sha256,crop_left,crop_top,crop_width,crop_height,upscale_factor,output_width,output_height,output_storage_path,output_sha256,transform_manifest_hash,status,original_canary_output_sha256,created_at")
          .eq("attempt_id", attemptId).eq("job_position", 1)
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("ebay_reference_guided_asset_contract_slots")
          .select("asset_ordinal,asset_role,source_job_position,source_job_id,rendering_contract")
          .eq("attempt_id", attemptId).order("asset_ordinal"),
        supabase.from("ebay_reference_guided_primary_main_previews")
          .select("id,revision_id,asset_ordinal,asset_role,contract_version,source_sha256,safe_margin_pixels,background_color,output_width,output_height,output_storage_path,output_sha256,transform_manifest_hash,status,created_at")
          .eq("attempt_id", attemptId).eq("asset_ordinal", 0).maybeSingle(),
        supabase.from("ebay_reference_guided_deterministic_asset_variants")
          .select("id,revision_id,asset_ordinal,asset_role,variant_version,source_image_id,source_sha256,crop_coordinates,output_width,output_height,output_storage_path,output_sha256,transform_manifest_hash,qa_metrics,status,created_at")
          .eq("attempt_id", attemptId).order("asset_ordinal"),
        supabase.from("ebay_reference_guided_final_asset_selection_events")
          .select("id,primary_sha256,primary_verdict,primary_background,primary_safe_margin_pixels,material_detail_sha256,material_detail_source,material_detail_verdict,rejected_main_detail_sha256,rejected_main_detail_reason,rejected_canary_sha256,rejected_canary_reason,provider_calls_snapshot,created_at")
          .eq("attempt_id", attemptId).maybeSingle(),
        supabase.from("ebay_reference_guided_phase_a_position_2_assets")
          .select("id,successor_plan_id,job_id,position,asset_ordinal,asset_role,execution_mode,source_image_id,source_sha256,output_width,output_height,background_color,output_storage_path,output_sha256,transform_manifest_hash,qa_result,status,provider_calls_snapshot,created_at")
          .eq("attempt_id", attemptId).eq("position", 2).maybeSingle(),
        supabase.from("ebay_reference_guided_asset_review_events")
          .select("id,asset_ordinal,asset_role,preview_sha256,decision,reason,created_at")
          .eq("attempt_id", attemptId).order("created_at", { ascending: false }),
      ])
      if (attemptError || jobsError || deterministicPreviewError || assetSlotsError || primaryMainPreviewError || deterministicVariantsError || finalAssetSelectionError || phaseAPosition2AssetError || assetReviewsError) throw new Error("REFERENCE_GUIDED_STATUS_FAILED")
      if (!attempt) return NextResponse.json({ success: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 })
      if (requestedRevisionId && attempt.revision_id !== requestedRevisionId) return NextResponse.json({ success: false, error: "REFERENCE_GUIDED_REVISION_MISMATCH" }, { status: 409 })
      let ownedRevisionQuery = supabase
        .from("ebay_same_day_pilot_image_revisions")
        .select("id")
        .eq("id", attempt.revision_id)
        .eq("marketplace_account_key", accountKey)
      if (validation.authenticationMode !== "service_role") {
        ownedRevisionQuery = ownedRevisionQuery.eq("created_by", validation.userId)
      }
      const { data: ownedRevision, error: ownedRevisionError } =
        await ownedRevisionQuery.maybeSingle()
      if (ownedRevisionError || !ownedRevision) return NextResponse.json({ success: false, error: "ATTEMPT_NOT_FOUND" }, { status: 404 })
      const positionSixSlot = (assetSlots ?? []).find((slot) =>
        Number(slot.asset_ordinal) === 6)
      const reviewJobs = await Promise.all((jobs ?? []).map(async (job) => {
        const outputPath = text(job.output_storage_path, 1_000)
        if (!outputPath) return { ...job, output_preview_url: null }
        if (Number(job.position) === 6) {
          const outputSha256 = text(job.output_sha256, 64)
          const previewBinding = {
            attemptId: attempt.id,
            position: 6,
            assetRole: "SECONDARY_HUMAN_CONTEXT",
            storagePath: outputPath,
            outputSha256,
          }
          const bindingValid = job.status === "QA_PENDING"
            && positionSixSlot?.asset_role === "SECONDARY_HUMAN_CONTEXT"
            && Number(positionSixSlot?.source_job_position) === 6
            && positionSixSlot?.source_job_id === job.id
            && /^[0-9a-f]{64}$/.test(outputSha256)
            && outputPath.includes("/reference-guided-successor/")
            && outputPath.includes(`/${attempt.id}/position-6/`)
            && outputPath.endsWith(`/${outputSha256}.png`)
          if (!bindingValid) {
            return { ...job, assetRole: "SECONDARY_HUMAN_CONTEXT",
              output_preview_url: null, signedPreviewUrl: null,
              preview_binding: previewBinding,
              preview_error: "REFERENCE_GUIDED_POSITION_6_PREVIEW_BINDING_INVALID" }
          }
          const roundtrip = await supabase.storage.from(STAGING_BUCKET)
            .download(outputPath)
          if (roundtrip.error || !roundtrip.data) {
            return { ...job, assetRole: "SECONDARY_HUMAN_CONTEXT",
              output_preview_url: null, signedPreviewUrl: null,
              preview_binding: previewBinding,
              preview_error: "REFERENCE_GUIDED_POSITION_6_ROUNDTRIP_FAILED" }
          }
          const bytes = Buffer.from(await roundtrip.data.arrayBuffer())
          const metadata = await sharp(bytes).metadata().catch(() => null)
          const roundtripValid = roundtrip.data.type === "image/png"
            && metadata?.format === "png"
            && metadata.width === 1600 && metadata.height === 1600
            && createHash("sha256").update(bytes).digest("hex") === outputSha256
          bytes.fill(0)
          if (!roundtripValid) {
            return { ...job, assetRole: "SECONDARY_HUMAN_CONTEXT",
              output_preview_url: null, signedPreviewUrl: null,
              preview_binding: previewBinding,
              preview_error: "REFERENCE_GUIDED_POSITION_6_ROUNDTRIP_INVALID" }
          }
          const preview = await supabase.storage.from(STAGING_BUCKET)
            .createSignedUrl(outputPath, 300)
          if (preview.error || !preview.data?.signedUrl) {
            return { ...job, assetRole: "SECONDARY_HUMAN_CONTEXT",
              output_preview_url: null, signedPreviewUrl: null,
              preview_binding: previewBinding,
              preview_error: "REFERENCE_GUIDED_POSITION_6_SIGNING_FAILED" }
          }
          const signedPath = decodeURIComponent(new URL(
            preview.data.signedUrl,
          ).pathname)
          if (!signedPath.endsWith(`/${STAGING_BUCKET}/${outputPath}`)) {
            return { ...job, assetRole: "SECONDARY_HUMAN_CONTEXT",
              output_preview_url: null, signedPreviewUrl: null,
              preview_binding: previewBinding,
              preview_error: "REFERENCE_GUIDED_POSITION_6_SIGNED_URL_INVALID" }
          }
          return { ...job, assetRole: "SECONDARY_HUMAN_CONTEXT",
            output_preview_url: preview.data.signedUrl,
            signedPreviewUrl: preview.data.signedUrl,
            signedPreviewExpiresAt: new Date(Date.now() + 300_000).toISOString(),
            preview_binding: { ...previewBinding, roundtripVerified: true },
            preview_error: null }
        }
        const preview = await supabase.storage.from(STAGING_BUCKET)
          .createSignedUrl(outputPath, 300)
        if (preview.error || !preview.data?.signedUrl) {
          throw new Error("REFERENCE_GUIDED_OUTPUT_PREVIEW_FAILED")
        }
        return { ...job, output_preview_url: preview.data.signedUrl }
      }))
      const progressedJobs = reviewJobs.filter((job) => job.status !== "PENDING").length
      let deterministicReview = deterministicPreview
        ? { ...deterministicPreview, output_preview_url: null as string | null }
        : null
      if (deterministicPreview?.output_storage_path) {
        const preview = await supabase.storage.from(STAGING_BUCKET)
          .createSignedUrl(deterministicPreview.output_storage_path, 300)
        if (preview.error || !preview.data?.signedUrl) {
          throw new Error("REFERENCE_GUIDED_OUTPUT_PREVIEW_FAILED")
        }
        deterministicReview = { ...deterministicPreview,
          output_preview_url: preview.data.signedUrl }
      }
      let primaryReview = primaryMainPreview
        ? { ...primaryMainPreview, output_preview_url: null as string | null }
        : null
      if (primaryMainPreview?.output_storage_path) {
        const preview = await supabase.storage.from(STAGING_BUCKET)
          .createSignedUrl(primaryMainPreview.output_storage_path, 300)
        if (preview.error || !preview.data?.signedUrl) {
          throw new Error("REFERENCE_GUIDED_OUTPUT_PREVIEW_FAILED")
        }
        primaryReview = { ...primaryMainPreview,
          output_preview_url: preview.data.signedUrl }
      }
      const variantReviews = await Promise.all((deterministicVariants ?? [])
        .map(async (variant) => {
          const preview = await supabase.storage.from(STAGING_BUCKET)
            .createSignedUrl(variant.output_storage_path, 300)
          if (preview.error || !preview.data?.signedUrl) {
            throw new Error("REFERENCE_GUIDED_OUTPUT_PREVIEW_FAILED")
          }
          return { ...variant, output_preview_url: preview.data.signedUrl }
        }))
      let phaseAReview: Record<string, unknown> | null = phaseAPosition2Asset
        ? { ...phaseAPosition2Asset, output_preview_url: null as string | null }
        : null
      if (phaseAPosition2Asset?.output_storage_path) {
        const position2Job = reviewJobs.find((job) => Number(job.position) === 2)
        if (Number(phaseAPosition2Asset.position) !== 2 ||
          Number(phaseAPosition2Asset.asset_ordinal) !== 2 ||
          phaseAPosition2Asset.asset_role !== "SECONDARY_PACKAGE_CONTENTS" ||
          position2Job?.output_storage_path !==
            phaseAPosition2Asset.output_storage_path ||
          position2Job?.output_sha256 !== phaseAPosition2Asset.output_sha256) {
          throw new Error("REFERENCE_GUIDED_POSITION_2_PREVIEW_BINDING_INVALID")
        }
        const preview = await supabase.storage.from(STAGING_BUCKET)
          .createSignedUrl(phaseAPosition2Asset.output_storage_path, 300)
        if (preview.error || !preview.data?.signedUrl) {
          throw new Error("REFERENCE_GUIDED_OUTPUT_PREVIEW_FAILED")
        }
        const signedPath = decodeURIComponent(new URL(
          preview.data.signedUrl,
        ).pathname)
        if (!signedPath.endsWith(
          `/${STAGING_BUCKET}/${phaseAPosition2Asset.output_storage_path}`,
        )) {
          throw new Error("REFERENCE_GUIDED_POSITION_2_SIGNED_URL_INVALID")
        }
        phaseAReview = { ...phaseAPosition2Asset,
          output_preview_url: preview.data.signedUrl,
          preview_binding: { position: 2, assetOrdinal: 2,
            assetRole: "SECONDARY_PACKAGE_CONTENTS",
            storagePath: phaseAPosition2Asset.output_storage_path,
            outputSha256: phaseAPosition2Asset.output_sha256 } }
      }
      const response = NextResponse.json({ success: true, attempt: { ...attempt, executionAuthorizedAt: null }, jobs: reviewJobs, primaryMainPreview: primaryReview, deterministicPreview: deterministicReview, deterministicVariants: variantReviews, phaseAPosition2Asset: phaseAReview, finalAssetSelection: finalAssetSelection ?? null, assetReviews: assetReviews ?? [], assetContract: REFERENCE_GUIDED_SEVEN_ASSET_ROLES, assetSlots: assetSlots ?? [], progress: `${progressedJobs}/${attempt.expected_job_count}`, safety: { providerCalls: attempt.provider_calls, retryConsumed: attempt.retry_consumed, ebayWrites: 0, productionChanged: false } })
      response.headers.set("Cache-Control", "no-store")
      return response
    }
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
    let action = text(body.action, 40)
    let persistedPrepareRevisionId = ""
    const supabase = getSupabaseAdminClient()

    if (action === "ensure_protected_authorized_source_pack") {
      const parentRevisionId = uuid(body.parentRevisionId)
      if (!parentRevisionId) return NextResponse.json({ success: false, error: "PARENT_REVISION_ID_REQUIRED" }, { status: 400 })
      const { data: parent, error: parentError } = await supabase
        .from("ebay_same_day_pilot_image_revisions")
        .select("id,listing_package_id,candidate_id,product_dossier_hash")
        .eq("id", parentRevisionId).maybeSingle()
      if (parentError || !parent) return NextResponse.json({ success: false, error: "PARENT_REVISION_NOT_FOUND" }, { status: 404 })
      const { data: candidate } = await supabase.from("ebay_same_day_pilot_candidates")
        .select("candidate_key,opportunity_id,supplier_sku,supplier_variant_id")
        .eq("id", parent.candidate_id).maybeSingle()
      const { data: opportunity } = candidate?.opportunity_id
        ? await supabase.from("ebay_luna_opportunity_queue").select("market_radar_product_id,supplier_product_id,supplier_variant_id").eq("id", candidate.opportunity_id).maybeSingle()
        : { data: null }
      const supplierProductId = text(opportunity?.supplier_product_id || candidate?.supplier_sku, 40)
      const supplierVariantId = text(opportunity?.supplier_variant_id || candidate?.supplier_variant_id, 40)
      const { data: product } = opportunity?.market_radar_product_id
        ? await supabase.from("market_radar_products").select("product_url").eq("id", opportunity.market_radar_product_id).maybeSingle()
        : { data: null }
      if (!candidate || !supplierProductId || !supplierVariantId || !opportunity?.market_radar_product_id || !product?.product_url) {
        return NextResponse.json({ success: false, error: "SOURCE_VARIANT_MISMATCH", sourcePackCreated: false }, { status: 422 })
      }
      const definitions = await loadAuthorizedCatalogNativeMedia({
        supabase, accountKey, actorId: actor, listingPackageId: parent.listing_package_id,
        candidateId: parent.candidate_id, supplierProductId,
        supplierVariantId,
      })
      const assets = await resolveProtectedAuthorizedCatalogNativeMedia({ definitions })
      const preview = assets.map((asset) => ({ sourceImageId: asset.sourceImageId, sourceAngle: asset.sourceAngle, width: asset.nativeWidth, height: asset.nativeHeight, sha256: asset.sha256, historicalSha256: definitions.find((d) => d.sourceImageId === asset.sourceImageId)?.expectedSha256 ?? null, changed: asset.sourceImageId === "SIDE" && asset.sha256 !== definitions.find((d) => d.sourceImageId === asset.sourceImageId)?.expectedSha256 }))
      if (body.confirm !== true) {
        return NextResponse.json({ success: true, preview, sideChanged: preview.some((item) => item.sourceImageId === "SIDE" && item.changed), protectedSnapshotExecuted: false, requiresConfirmation: true, productDossierFound: Boolean(parent.product_dossier_hash), missingDossier: parent.product_dossier_hash ? [] : ["product_dossier_hash"] })
      }
      const suppliedPreview = text(body.previewSetId, 200)
      const suppliedExpiry = Number(suppliedPreview.split(".")[0])
      if (!body.visualConfirmation || !suppliedPreview || !Number.isFinite(suppliedExpiry) || suppliedExpiry < Date.now() || suppliedPreview !== previewToken(parentRevisionId, suppliedExpiry, assets.map((a) => a.sha256))) {
        return NextResponse.json({ success: false, error: "PROTECTED_SOURCE_PREVIEW_INVALID", preview, sourcePackCreated: false }, { status: 409 })
      }
      const sourcePack = {
        productId: supplierProductId,
        productIdentityHash: `sha256:${createHash("sha256").update(`${supplierProductId}:${supplierVariantId}`).digest("hex")}`,
        productUrl: product.product_url,
        sourceAssets: assets,
        sourceAssetCount: assets.length,
        largestNativeWidth: Math.max(...assets.map((a) => a.nativeWidth)),
        largestNativeHeight: Math.max(...assets.map((a) => a.nativeHeight)),
        galleryCoverage: "MULTI_VIEW" as const,
        availableViewTypes: assets.map((a) => a.viewClassification),
        authorizationEvidenceHash: createHash("sha256").update(definitions.map((d) => d.id).sort().join(":")).digest("hex"),
        resolverVersion: LUNA_CATALOG_SOURCE_RESOLVER_VERSION as typeof LUNA_CATALOG_SOURCE_RESOLVER_VERSION,
        discoveredCandidateCount: 2, inspectedCandidateCount: 2,
        precheck: { CATALOG_ORIGINAL_DISCOVERY_COMPLETED: true, ALL_CATALOG_MEDIA_INSPECTED: true, PRODUCT_IDENTITY_MATCHED: true, SOURCE_PACK_READY: true, SIX_SECONDARY_JOBS_FEASIBLE: true, MARKET_VISUAL_SIGNALS_USABLE: true } as const,
      }
      const persisted = await persistAuthorizedCatalogSourcePack({
        supabase, accountKey, actorId: actor, listingPackageId: parent.listing_package_id,
        candidateId: parent.candidate_id, marketRadarProductId: opportunity.market_radar_product_id,
        supplierVariantId, factPackageHash: parent.product_dossier_hash || undefined,
        pack: sourcePack,
        sourcePackVersion: `PROTECTED_SNAPSHOT_${assets.map((a) => a.sha256).sort().join("").slice(0, 16)}`,
        policyVersion: "REFERENCE_GUIDED_PRODUCT_GENERATION_V1",
        reconciliationReason: "EXTERNAL_SOURCE_CHANGED_BEFORE_PROTECTED_SNAPSHOT",
      })
      return NextResponse.json({ success: true, sourcePackCreated: true, sourcePackId: persisted.packId, sourcePackHash: persisted.sourcePackHash, reconciliation: "EXTERNAL_SOURCE_CHANGED_BEFORE_PROTECTED_SNAPSHOT", providerCalls: 0, ebayWrites: 0, productionChanged: false })
    }

    if (action === "ensure_visual_strategy_v3_revision") {
      const parentRevisionId = uuid(body.parentRevisionId)
      if (!parentRevisionId) return NextResponse.json({ success: false, error: "PARENT_REVISION_ID_REQUIRED" }, { status: 400 })
      const { data: parent, error: parentError } = await supabase.from("ebay_same_day_pilot_image_revisions").select("*").eq("id", parentRevisionId).maybeSingle()
      if (parentError || !parent) return NextResponse.json({ success: false, error: "PARENT_REVISION_NOT_FOUND" }, { status: 404 })
      if (parent.strategy_version !== "VISUAL_STRATEGY_V2" || parent.revision_contract !== "LEGACY_VISUAL_STRATEGY_V2") return NextResponse.json({ success: false, error: "PARENT_REVISION_STRATEGY_INVALID" }, { status: 409 })
      const { data: pack } = await supabase.from("luna_catalog_authorized_source_packs").select("id,source_pack_hash,resolver_version,source_assets,authoritative_fact_package_hash").eq("marketplace_account_key", accountKey).eq("listing_package_id", parent.listing_package_id).order("created_at", { ascending: false }).limit(1).maybeSingle()
      const assets = Array.isArray(pack?.source_assets) ? pack.source_assets as Array<Record<string, unknown>> : []
      if (!pack) return NextResponse.json({ success: false, error: "V3_SOURCE_PACK_INVALID", attemptRows: 0, jobRows: 0 }, { status: 422 })
      const { data: dossierCandidate } = await supabase.from("ebay_same_day_pilot_candidates").select("candidate_key,product_facts_summary").eq("id", parent.candidate_id).maybeSingle()
      const dossier = record(record(dossierCandidate?.product_facts_summary).authoritativeFactsPackage)
      const dossierFacts = Array.isArray(dossier.facts) ? dossier.facts : []
      const recomputedDossierHash = productFactsHash({ version: dossier.version, sourcePolicy: dossier.sourcePolicy, facts: dossierFacts })
      const expectedDossierHash = "sha256:94c279fcca948a0d1767fe4a0d5ae602545e131a8fd5d96cd2df47f5f98c74c8"
      if (recomputedDossierHash !== expectedDossierHash) return NextResponse.json({ success: false, error: "PRODUCT_DOSSIER_HASH_MISMATCH", attemptRows: 0, jobRows: 0 }, { status: 422 })
      const canonicalIdentity = resolveCanonicalProductIdentity(dossierCandidate?.product_facts_summary)
      if (canonicalIdentity.identity.mpn !== "08300" || canonicalIdentity.identity.gtin !== "036588083005" || canonicalIdentity.identity.color !== "White" || String(canonicalIdentity.identity.netContent) !== "1.5") return NextResponse.json({ success: false, error: "PRODUCT_DOSSIER_IDENTITY_MISMATCH", attemptRows: 0, jobRows: 0 }, { status: 422 })
      await supabase.from("luna_catalog_source_pack_dossier_bindings").insert({ source_pack_id: pack.id, listing_package_id: parent.listing_package_id, dossier_hash: recomputedDossierHash, source_pack_manifest_hash: pack.source_pack_hash, policy_version: "REFERENCE_GUIDED_PRODUCT_GENERATION_V1" }).then(({ error }) => { if (error && !String(error.message).includes("duplicate")) throw new Error("SOURCE_PACK_DOSSIER_BINDING_FAILED") })
      for (const asset of assets) {
        const path = text(asset.storagePath, 1000)
        if (!path) return NextResponse.json({ success: false, error: "SOURCE_STORAGE_PATH_MISSING", attemptRows: 0, jobRows: 0 }, { status: 422 })
        const downloaded = await supabase.storage.from(SOURCE_BUCKET).download(path)
        if (downloaded.error || !downloaded.data) return NextResponse.json({ success: false, error: "SOURCE_STORAGE_ROUNDTRIP_FAILED", attemptRows: 0, jobRows: 0 }, { status: 422 })
        const bytes = Buffer.from(await downloaded.data.arrayBuffer())
        const actual = createHash("sha256").update(bytes).digest("hex")
        const metadata = await sharp(bytes).metadata()
        const expected = asset.sourceImageId === "MAIN" ? { hash: "3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1", width: 1500, height: 905 } : { hash: "f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21", width: 1500, height: 1051 }
        if (actual !== expected.hash || metadata.width !== expected.width || metadata.height !== expected.height) return NextResponse.json({ success: false, error: "SOURCE_STORAGE_ROUNDTRIP_FAILED", attemptRows: 0, jobRows: 0 }, { status: 422 })
      }
      const mains = assets.filter((asset) => asset.sourceImageId === "MAIN" && asset.sourceAngle === "FRONT" && asset.authorizationStatus === "AUTHORIZED_CATALOG_NATIVE_HIGH_RES")
      const sides = assets.filter((asset) => asset.sourceImageId === "SIDE" && asset.sourceAngle === "SIDE" && asset.authorizationStatus === "AUTHORIZED_CATALOG_NATIVE_HIGH_RES")
      if (!pack || mains.length !== 1 || sides.length !== 1) return NextResponse.json({ success: false, error: "V3_SOURCE_PACK_INVALID", attemptRows: 0, jobRows: 0 }, { status: 422 })
      const { data: brief } = await supabase.from("marketplace_product_research_visual_market_briefs").select("id,brief,confidence,sample_size,created_at,query_context_hash,product_family_fingerprint,visual_market_brief_version").eq("marketplace_account_key", accountKey).in("confidence", ["HIGH", "MEDIUM"]).order("created_at", { ascending: false }).limit(1).maybeSingle()
      if (!brief || Number(brief.sample_size) < 3) return NextResponse.json({ success: false, error: "MARKET_VISUAL_BRIEF_REFRESH_REQUIRED", attemptRows: 0, jobRows: 0 }, { status: 422 })
      const briefHash = createHash("sha256").update(JSON.stringify(brief)).digest("hex")
      const sourcePackVersion = text(pack.resolver_version, 120)
      const fingerprint = createHash("sha256").update(JSON.stringify({ parentRevisionId, listingPackageId: parent.listing_package_id, strategyVersion: "VISUAL_STRATEGY_V3", revisionContract: "REFERENCE_GUIDED_PRODUCT_GENERATION_V1", sourcePackVersion, main: mains[0].sha256, side: sides[0].sha256, productDossierHash: recomputedDossierHash, marketVisualBriefHash: briefHash })).digest("hex")
      const { data: existing } = await supabase.from("ebay_same_day_pilot_image_revisions").select("id").eq("revision_fingerprint", fingerprint).maybeSingle()
      if (existing?.id) return NextResponse.json({ success: true, revisionId: existing.id, revisionFingerprint: fingerprint, reused: true })
      const { data: rpcResult, error: rpcError } = await supabase.rpc("ensure_visual_strategy_v3_revision_from_binding", { p_parent_revision_id: parentRevisionId })
      if (rpcError) throw new Error(`ENSURE_V3_RPC:${rpcError.code ?? "UNKNOWN"}`)
      const result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
      return NextResponse.json({ success: true, revisionId: result?.revision_id, revisionFingerprint: fingerprint, reused: result?.created !== true })
    }

    if (action === "review_reference_guided_asset") {
      const attemptId = uuid(body.attemptId)
      const revisionId = uuid(body.revisionId)
      const assetOrdinal = Number(body.assetOrdinal)
      const previewSha256 = text(body.previewSha256, 80)
      const decision = body.decision === "APPROVED" || body.decision === "REJECTED"
        ? body.decision
        : ""
      const reason = text(body.reason, 200)
      if (!attemptId || !revisionId || ![0, 1, 2].includes(assetOrdinal) ||
        !/^[0-9a-f]{64}$/.test(previewSha256) || !decision || !reason) {
        return NextResponse.json({ success: false,
          error: "REFERENCE_GUIDED_VISUAL_REVIEW_INVALID" }, { status: 400 })
      }
      const [{ data: revision, error: revisionError },
        { data: attempt, error: attemptError },
        { data: slot, error: slotError }] = await Promise.all([
        supabase.from("ebay_same_day_pilot_image_revisions")
          .select("id,strategy_version,revision_contract")
          .eq("id", revisionId).eq("created_by", actor)
          .eq("marketplace_account_key", accountKey).maybeSingle(),
        supabase.from("ebay_reference_guided_generation_attempts")
          .select("id,revision_id,status,provider_calls,ebay_writes,production_changed")
          .eq("id", attemptId).eq("revision_id", revisionId)
          .neq("status", "SUPERSEDED_INVALID_MANIFEST").maybeSingle(),
        supabase.from("ebay_reference_guided_asset_contract_slots")
          .select("asset_ordinal,asset_role")
          .eq("attempt_id", attemptId).eq("asset_ordinal", assetOrdinal)
          .maybeSingle(),
      ])
      if (revisionError || attemptError || slotError || !revision || !attempt ||
        !slot || revision.strategy_version !== "VISUAL_STRATEGY_V3" ||
        revision.revision_contract !== "REFERENCE_GUIDED_PRODUCT_GENERATION_V1" ||
        Number(attempt.provider_calls) !== 2 || Number(attempt.ebay_writes) !== 0 ||
        attempt.production_changed !== false) {
        return NextResponse.json({ success: false,
          error: "REFERENCE_GUIDED_VISUAL_REVIEW_SCOPE_INVALID" }, { status: 409 })
      }
      const previewQuery = assetOrdinal === 0
        ? supabase.from("ebay_reference_guided_primary_main_previews")
          .select("output_sha256").eq("attempt_id", attemptId)
          .eq("asset_ordinal", 0).eq("output_sha256", previewSha256).maybeSingle()
        : assetOrdinal === 1
          ? supabase.from("ebay_reference_guided_deterministic_previews")
          .select("output_sha256").eq("attempt_id", attemptId)
          .eq("asset_ordinal", 1).eq("output_sha256", previewSha256).maybeSingle()
          : supabase.from("ebay_reference_guided_phase_a_position_2_assets")
            .select("output_sha256").eq("attempt_id", attemptId)
            .eq("asset_ordinal", 2).eq("output_sha256", previewSha256)
            .maybeSingle()
      const { data: basePreview, error: previewError } = await previewQuery
      if (previewError) return NextResponse.json({ success: false,
        error: "REFERENCE_GUIDED_VISUAL_PREVIEW_NOT_FOUND" }, { status: 404 })
      const variantResult = basePreview ? { data: null, error: null }
        : await supabase.from("ebay_reference_guided_deterministic_asset_variants")
          .select("output_sha256").eq("attempt_id", attemptId)
          .eq("asset_ordinal", assetOrdinal).eq("output_sha256", previewSha256)
          .maybeSingle()
      if (variantResult.error || (!basePreview && !variantResult.data)) {
        return NextResponse.json({ success: false,
          error: "REFERENCE_GUIDED_VISUAL_PREVIEW_NOT_FOUND" }, { status: 404 })
      }
      if (assetOrdinal === 2 && decision === "APPROVED") {
        const approved = await supabase.rpc(
          "approve_ebay_reference_guided_phase_a_position_2", {
            p_attempt_id: attemptId,
            p_output_sha256: previewSha256,
            p_reason: reason,
          })
        if (approved.error || !approved.data) {
          throw new Error("REFERENCE_GUIDED_POSITION_2_APPROVAL_FAILED")
        }
        return NextResponse.json({ success: true, review: approved.data,
          safety: { commercialFieldsUpdated: false, providerCalls: 2,
            ebayWrites: 0, productionChanged: false } })
      }
      const { data: prior, error: priorError } = await supabase
        .from("ebay_reference_guided_asset_review_events")
        .select("id,asset_ordinal,asset_role,preview_sha256,decision,reason,created_at")
        .eq("attempt_id", attemptId).eq("asset_ordinal", assetOrdinal)
        .eq("preview_sha256", previewSha256).eq("decision", decision)
        .maybeSingle()
      if (priorError) throw new Error("REFERENCE_GUIDED_VISUAL_REVIEW_FAILED")
      let review = prior
      if (!review) {
        const inserted = await supabase.from("ebay_reference_guided_asset_review_events")
          .insert({ attempt_id: attemptId, revision_id: revisionId,
            asset_ordinal: assetOrdinal, asset_role: slot.asset_role,
            preview_sha256: previewSha256, decision, reason,
            reviewer_id: actor })
          .select("id,asset_ordinal,asset_role,preview_sha256,decision,reason,created_at")
          .single()
        if (inserted.error || !inserted.data) {
          throw new Error("REFERENCE_GUIDED_VISUAL_REVIEW_FAILED")
        }
        review = inserted.data
      }
      return NextResponse.json({ success: true, review, reused: Boolean(prior),
        safety: { commercialFieldsUpdated: false, providerCalls: 2,
          ebayWrites: 0, productionChanged: false } })
    }

    if (action === "prepare_visual_review") {
      const listingPackageId = uuid(body.listingPackageId)
      if (!listingPackageId) return NextResponse.json({ success: false, error: "LISTING_PACKAGE_ID_REQUIRED" }, { status: 400 })
      await packageForActor(supabase, listingPackageId, actor, accountKey)
      const { data: routingRevision, error: routingError } = await supabase
        .from("ebay_same_day_pilot_image_revisions")
        .select("id,status,strategy_version,revision_contract")
        .eq("listing_package_id", listingPackageId)
        .eq("created_by", actor)
        .eq("marketplace_account_key", accountKey)
        .eq("strategy_version", "VISUAL_STRATEGY_V3")
        .order("revision_number", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (routingError || !routingRevision) return NextResponse.json({ success: false, error: "SAME_DAY_IMAGE_REVISION_NOT_FOUND" }, { status: 404 })
      if (!routingRevision.strategy_version) return NextResponse.json({ success: false, error: "REVISION_STRATEGY_MISSING", attemptRows: 0, jobRows: 0 }, { status: 409 })
      if (!routingRevision.revision_contract) return NextResponse.json({ success: false, error: "REVISION_CONTRACT_MISSING", attemptRows: 0, jobRows: 0 }, { status: 409 })
      if (routingRevision.strategy_version !== "VISUAL_STRATEGY_V3" || routingRevision.revision_contract !== "REFERENCE_GUIDED_PRODUCT_GENERATION_V1") {
        return NextResponse.json({ success: false, error: "REVISION_STRATEGY_CONTRACT_MISMATCH", attemptRows: 0, jobRows: 0 }, { status: 409 })
      }
      if (routingRevision.status !== "READY_FOR_PREPARE") {
        return NextResponse.json({ success: false, error: "VISUAL_STRATEGY_V3_NOT_READY_FOR_PREPARE", attemptRows: 0, jobRows: 0 }, { status: 409 })
      }
      persistedPrepareRevisionId = routingRevision.id
      action = "reference_guided_prepare"
    }

    if (action === "reference_guided_prepare") {
      const revisionId = persistedPrepareRevisionId
      if (!revisionId) return NextResponse.json({ success: false, error: "REFERENCE_GUIDED_DIRECT_PREPARE_FORBIDDEN" }, { status: 400 })
      const { data: revisionRow, error: revisionLookupError } = await supabase
        .from("ebay_same_day_pilot_image_revisions")
        .select("id,listing_package_id,candidate_id,status,strategy_version,revision_contract,product_dossier_hash,market_visual_brief_hash,main_source_hash,side_source_hash")
        .eq("id", revisionId)
        .maybeSingle()
      if (revisionLookupError || !revisionRow) return NextResponse.json({ success: false, error: "SAME_DAY_IMAGE_REVISION_NOT_FOUND" }, { status: 404 })
      if (!revisionRow.strategy_version) return NextResponse.json({ success: false, error: "REVISION_STRATEGY_MISSING", attemptRows: 0, jobRows: 0 }, { status: 409 })
      if (!revisionRow.revision_contract) return NextResponse.json({ success: false, error: "REVISION_CONTRACT_MISSING", attemptRows: 0, jobRows: 0 }, { status: 409 })
      if (revisionRow.strategy_version !== "VISUAL_STRATEGY_V3" || revisionRow.revision_contract !== "REFERENCE_GUIDED_PRODUCT_GENERATION_V1") return NextResponse.json({ success: false, error: "REVISION_STRATEGY_CONTRACT_MISMATCH", attemptRows: 0, jobRows: 0 }, { status: 409 })
      if (revisionRow.status !== "READY_FOR_PREPARE") return NextResponse.json({ success: false, error: "VISUAL_STRATEGY_V3_NOT_READY_FOR_PREPARE", attemptRows: 0, jobRows: 0 }, { status: 409 })
      if (!revisionRow.product_dossier_hash || !revisionRow.market_visual_brief_hash ||
        !revisionRow.main_source_hash || !revisionRow.side_source_hash) {
        return NextResponse.json({ success: false, error: "REFERENCE_GUIDED_REVISION_BINDING_INCOMPLETE", attemptRows: 0, jobRows: 0 }, { status: 422 })
      }
      const { data: binding, error: bindingError } = await supabase
        .from("luna_catalog_source_pack_dossier_bindings")
        .select("source_pack_id,dossier_hash,source_pack_manifest_hash,policy_version")
        .eq("listing_package_id", revisionRow.listing_package_id)
        .eq("dossier_hash", revisionRow.product_dossier_hash)
        .eq("policy_version", "REFERENCE_GUIDED_PRODUCT_GENERATION_V1")
        .order("verified_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (bindingError || !binding) return NextResponse.json({ success: false, error: "SOURCE_PACK_DOSSIER_BINDING_REQUIRED", attemptRows: 0, jobRows: 0 }, { status: 422 })
      const { data: sourcePack, error: packError } = await supabase
        .from("luna_catalog_authorized_source_packs")
        .select("id,source_pack_hash,manifest_hash,source_pack_version,resolver_version,source_assets,precheck")
        .eq("id", binding.source_pack_id)
        .eq("marketplace_account_key", accountKey)
        .eq("listing_package_id", revisionRow.listing_package_id)
        .maybeSingle()
      if (packError || !sourcePack) return NextResponse.json({ success: false, error: "AUTHORIZED_SOURCE_COUNT_INVALID" }, { status: 422 })
      const sourcePackManifestHash = text(sourcePack.manifest_hash || sourcePack.source_pack_hash, 100)
      if (sourcePackManifestHash !== binding.source_pack_manifest_hash ||
        sourcePack.source_pack_hash !== binding.source_pack_manifest_hash ||
        binding.dossier_hash !== revisionRow.product_dossier_hash) {
        return NextResponse.json({ success: false, error: "SOURCE_PACK_BINDING_INVALID", attemptRows: 0, jobRows: 0 }, { status: 422 })
      }
      const { data: dossierCandidate, error: dossierError } = await supabase
        .from("ebay_same_day_pilot_candidates")
        .select("product_facts_summary")
        .eq("id", revisionRow.candidate_id)
        .maybeSingle()
      const authoritativeFactsPackage = record(record(dossierCandidate?.product_facts_summary).authoritativeFactsPackage)
      if (dossierError || authoritativeFactsPackage.factPackageHash !== revisionRow.product_dossier_hash) {
        return NextResponse.json({ success: false, error: "PRODUCT_DOSSIER_HASH_MISMATCH", attemptRows: 0, jobRows: 0 }, { status: 422 })
      }
      const sourceAssets = Array.isArray(sourcePack.source_assets) ? sourcePack.source_assets as Array<Record<string, unknown>> : []
      const nativeMainAssets = sourceAssets.filter((asset) => asset.sourceImageId === "MAIN" && asset.authorizationStatus === "AUTHORIZED_CATALOG_NATIVE_HIGH_RES")
      const nativeSideAssets = sourceAssets.filter((asset) => asset.sourceImageId === "SIDE" && asset.authorizationStatus === "AUTHORIZED_CATALOG_NATIVE_HIGH_RES")
      if (nativeMainAssets.length !== 1 || nativeSideAssets.length !== 1) return NextResponse.json({ success: false, error: "AUTHORIZED_SOURCE_COUNT_INVALID" }, { status: 422 })
      const main = sourceAssets.find((asset) => asset.sourceImageId === "MAIN" && asset.sourceAngle === "FRONT" && asset.authorizationStatus === "AUTHORIZED_CATALOG_NATIVE_HIGH_RES")
      const side = sourceAssets.find((asset) => asset.sourceImageId === "SIDE" && asset.sourceAngle === "SIDE" && asset.authorizationStatus === "AUTHORIZED_CATALOG_NATIVE_HIGH_RES")
      if (!main) return NextResponse.json({ success: false, error: "AUTHORIZED_MAIN_MISSING" }, { status: 422 })
      if (!side) return NextResponse.json({ success: false, error: "AUTHORIZED_SIDE_MISSING" }, { status: 422 })
      if (main.sha256 === side.sha256 || main.sourceSha256 === side.sourceSha256) return NextResponse.json({ success: false, error: "AUTHORIZED_SOURCE_COUNT_INVALID" }, { status: 422 })
      const excluded = new Set(sourceAssets.flatMap((asset) => Array.isArray(asset.excludedSourceSha256s) ? asset.excludedSourceSha256s.filter((value): value is string => typeof value === "string") : []))
      const readAndVerify = async (asset: Record<string, unknown>) => {
        const path = text(asset.storagePath, 1_000)
        if (!path) throw new Error("AUTHORIZED_MAIN_MISSING")
        const downloaded = await supabase.storage.from(EBAY_IMAGE_SOURCE_BUCKET).download(path)
        if (downloaded.error || !downloaded.data) throw new Error("SOURCE_BYTES_HASH_MISMATCH")
        const bytes = Buffer.from(await downloaded.data.arrayBuffer())
        const actual = createHash("sha256").update(bytes).digest("hex")
        const expected = text(asset.sha256, 100) || text(asset.sourceSha256, 100)
        if (actual !== expected || excluded.has(actual)) throw new Error(excluded.has(actual) ? "SOURCE_HASH_EXCLUDED" : "SOURCE_BYTES_HASH_MISMATCH")
        const meta = await sharp(bytes).metadata()
        if (meta.width !== Number(asset.nativeWidth) || meta.height !== Number(asset.nativeHeight)) throw new Error("SOURCE_DIMENSIONS_MISMATCH")
        return { actual, width: meta.width, height: meta.height }
      }
      const mainVerified = await readAndVerify(main)
      const sideVerified = await readAndVerify(side)
      if (mainVerified.actual !== revisionRow.main_source_hash ||
        sideVerified.actual !== revisionRow.side_source_hash) {
        return NextResponse.json({ success: false, error: "REFERENCE_GUIDED_REVISION_SOURCE_MISMATCH", attemptRows: 0, jobRows: 0 }, { status: 422 })
      }
      const preparedManifest = buildReferenceGuidedV3CompositionManifest({
        revisionId,
        strategyVersion: revisionRow.strategy_version,
        revisionContract: revisionRow.revision_contract,
        productDossierHash: revisionRow.product_dossier_hash,
        marketVisualBriefHash: revisionRow.market_visual_brief_hash,
        sourcePackManifestHash,
        mainSourceHash: mainVerified.actual,
        sideSourceHash: sideVerified.actual,
        authoritativeFactsPackage,
      })
      const { data: existingAttempt, error: existingAttemptError } = await supabase
        .from("ebay_reference_guided_generation_attempts")
        .select("id,revision_id,composition_manifest_hash,status,provider_calls,retry_consumed,expected_job_count,completed_job_count")
        .eq("revision_id", revisionId)
        .eq("composition_manifest_hash", preparedManifest.compositionManifestHash)
        .maybeSingle()
      if (existingAttemptError) throw new Error("REFERENCE_GUIDED_STATUS_FAILED")
      if (existingAttempt?.status === "SUPERSEDED_INVALID_MANIFEST") {
        return NextResponse.json({ success: false, error: "REFERENCE_GUIDED_MANIFEST_PERMANENTLY_SUPERSEDED" }, { status: 409 })
      }
      let attempt = existingAttempt
      if (!attempt) {
        const { data, error } = await supabase.rpc("create_ebay_reference_guided_generation_attempt_v2", {
          p_revision_id: revisionId,
          p_composition_manifest_text: preparedManifest.compositionManifestText,
        })
        if (error) throw error
        attempt = Array.isArray(data) ? data[0] : data
      }
      const { data: persistedJobs, error: persistedJobsError } = await supabase
        .from("ebay_reference_guided_generation_jobs")
        .select("position,commercial_role,status,lease_owner,lease_expires_at,provider_request_id,output_storage_path,output_sha256,qa_result,error_code,exact_prompt_text,prompt_hash,prompt_template_version,allowed_product_facts,allowed_generated_context,prohibited_claims")
        .eq("generation_attempt_id", attempt?.id)
        .order("position", { ascending: true })
      if (persistedJobsError) throw new Error("REFERENCE_GUIDED_STATUS_FAILED")
      const persistedManifestMatches = persistedReferenceGuidedManifestMatches({
        jobs: persistedJobs ?? [],
        manifestJobs: preparedManifest.manifest.jobs,
        verifyPrompt: verifyExactReferenceGuidedPrompt,
      })
      if (!persistedManifestMatches) {
        return NextResponse.json({ success: false, error: "REFERENCE_GUIDED_PERSISTED_JOB_MANIFEST_MISMATCH" }, { status: 409 })
      }
      const initialPrepareInvariant = isInitialReferenceGuidedPrepare({
        jobs: persistedJobs ?? [],
        providerCalls: Number(attempt?.provider_calls),
      })
      if (!existingAttempt && !REFERENCE_GUIDED_PROVIDER_ENABLED && !initialPrepareInvariant) {
        return NextResponse.json({ success: false, error: "REFERENCE_GUIDED_INITIAL_PREPARE_INVARIANT_FAILED" }, { status: 422 })
      }
      const progressedJobs = persistedJobs?.filter((job) => job.status !== "PENDING").length ?? 0
      return NextResponse.json({ success: true, revisionId, attemptId: attempt?.id, manifestHash: preparedManifest.compositionManifestHash, state: attempt?.status ?? "PENDING", progress: `${progressedJobs}/6`, reused: Boolean(existingAttempt), providerState: REFERENCE_GUIDED_PROVIDER_ENABLED ? "READY_FOR_EXPLICIT_EXECUTION" : "WAITING_PROVIDER_ENABLEMENT", featureFlagEnabled: REFERENCE_GUIDED_PROVIDER_ENABLED, attemptRows: 1, jobRows: persistedJobs?.length ?? 0, jobs: persistedJobs ?? [], providerCalls: Number(attempt?.provider_calls ?? 0), retryConsumed: Boolean(attempt?.retry_consumed), ebayWrites: 0, productionChanged: false }, { status: existingAttempt ? 200 : 202 })
    }

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
