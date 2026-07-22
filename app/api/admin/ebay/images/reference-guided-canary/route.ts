export const runtime = "nodejs"
export const maxDuration = 300

import { createHash, randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import sharp from "sharp"

import {
  requestReferenceGuidedProductGeneration,
  type EbayReferenceGuidedGenerationPlan,
  type EbayReferenceGuidedProviderResult,
} from "@/lib/ebay/ebay-listing-image-factory"
import {
  EBAY_IMAGE_SOURCE_BUCKET,
} from "@/lib/ebay/ebay-image-storage-cleanup"
import {
  persistReferenceGuidedCanaryPng,
  REFERENCE_GUIDED_CANARY_OUTPUT_BUCKET,
  removeReferenceGuidedCanaryPng,
} from "@/lib/ebay/reference-guided-canary-persistence"
import {
  runReferenceGuidedGenerationCanary,
  type ReferenceGuidedJobRecord,
  type ReferenceGuidedPersistence,
} from "@/lib/ebay/reference-guided-generation-orchestrator"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

const AUTHORIZED_ATTEMPT_ID = "f166b395-8d3a-4921-b273-1a62a6032707"
const AUTHORIZED_REVISION_ID = "3a4a233e-d4bc-4a65-825f-c4882bceb9d1"
const AUTHORIZED_POSITION = 1
const AUTHORIZED_OBJECTIVE = "MATERIAL_AND_FINISH_DETAIL"
const AUTHORIZED_BRANCH = "feature/centralize-ebay-mobile-command-center"
const STAGING_PROJECT_REF = "vsfthqydfrdzulldbfbe"
const EXECUTION_CONFIRMATION = "RUN_ONE_STAGING_REFERENCE_GUIDED_CANARY_POSITION_1"
const SOURCE_AUTHORIZATION = "AUTHORIZED_CATALOG_NATIVE_HIGH_RES"
const PROMPT_TEMPLATE_VERSION = "REFERENCE_GUIDED_EXACT_PROMPT_V2_2026_07_22"
const MANIFEST_VERSION = "REFERENCE_GUIDED_COMPOSITION_MANIFEST_V2"
const GENERATION_VERSION = "REFERENCE_GUIDED_PRODUCT_GENERATION_V1"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, max = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex")
}

function rows<T>(value: unknown) {
  return (Array.isArray(value) ? value : []) as T[]
}

function safeCode(error: unknown, fallback = "REFERENCE_GUIDED_CANARY_FAILED") {
  const message = error instanceof Error ? error.message : ""
  const match = message.match(/[A-Z][A-Z0-9_:.-]{2,180}/)
  return match?.[0] ?? fallback
}

function assertPreviewBoundary() {
  let projectRef = ""
  try {
    projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "")
      .hostname.split(".")[0] ?? ""
  } catch {
    projectRef = ""
  }
  if (process.env.VERCEL_ENV !== "preview" ||
    process.env.VERCEL_GIT_COMMIT_REF !== AUTHORIZED_BRANCH ||
    projectRef !== STAGING_PROJECT_REF) {
    throw new Error("REFERENCE_GUIDED_CANARY_PREVIEW_STAGING_REQUIRED")
  }
  if (process.env.OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED !== "true") {
    throw new Error("REFERENCE_GUIDED_GENERATION_DISABLED")
  }
  if (process.env.OPENAI_IMAGE_MODEL?.trim() !== "gpt-image-2" ||
    !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("REFERENCE_GUIDED_CANARY_PROVIDER_CONFIGURATION_INVALID")
  }
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok || validation.authenticationMode !== "service_role") {
    return NextResponse.json(
      { success: false, error: validation.error ?? "service_role_required" },
      { status: validation.status && validation.status !== 200 ? validation.status : 403 },
    )
  }

  let httpStatus: number | null = null
  let providerRequestId: string | null = null
  let providerFetches = 0
  let outputStoragePath: string | null = null
  let outputSha256: string | null = null
  let automaticQaResult: JsonRecord | null = null
  let claimedJobId: string | null = null
  let leaseOwner: string | null = null
  let budgetReserved = false

  try {
    assertPreviewBoundary()
    const body = record(await req.json())
    if (body.attemptId !== AUTHORIZED_ATTEMPT_ID ||
      body.position !== AUTHORIZED_POSITION ||
      body.objective !== AUTHORIZED_OBJECTIVE ||
      body.confirmation !== EXECUTION_CONFIRMATION) {
      throw new Error("REFERENCE_GUIDED_CANARY_AUTHORIZATION_MISMATCH")
    }

    const supabase = getSupabaseAdminClient()
    const { data: attempt, error: attemptError } = await supabase
      .from("ebay_reference_guided_generation_attempts")
      .select("*")
      .eq("id", AUTHORIZED_ATTEMPT_ID)
      .maybeSingle()
    if (attemptError || !attempt || attempt.revision_id !== AUTHORIZED_REVISION_ID ||
      attempt.status !== "PENDING" || Number(attempt.provider_calls) !== 0 ||
      Number(attempt.max_provider_calls) !== 6 || attempt.retry_consumed !== false ||
      Number(attempt.ebay_writes) !== 0 || attempt.production_changed !== false) {
      throw new Error("REFERENCE_GUIDED_CANARY_ATTEMPT_INVALID")
    }
    const manifestText = text(attempt.composition_manifest_text, 200_000)
    if (!manifestText || sha256(Buffer.from(manifestText, "utf8")) !==
      attempt.composition_manifest_hash) {
      throw new Error("REFERENCE_GUIDED_CANARY_MANIFEST_MISMATCH")
    }
    const manifest = record(JSON.parse(manifestText))
    const manifestJobs = rows<JsonRecord>(manifest.jobs)
    if (manifest.version !== MANIFEST_VERSION ||
      manifest.revisionId !== AUTHORIZED_REVISION_ID ||
      manifest.strategyVersion !== "VISUAL_STRATEGY_V3" ||
      manifest.revisionContract !== GENERATION_VERSION ||
      manifest.promptTemplateVersion !== PROMPT_TEMPLATE_VERSION ||
      manifestJobs.length !== 6) {
      throw new Error("REFERENCE_GUIDED_CANARY_MANIFEST_MISMATCH")
    }

    const [{ data: revision, error: revisionError },
      { data: persistedJobs, error: jobsError },
      { data: buckets, error: bucketsError }] = await Promise.all([
      supabase.from("ebay_same_day_pilot_image_revisions").select("*")
        .eq("id", AUTHORIZED_REVISION_ID).maybeSingle(),
      supabase.from("ebay_reference_guided_generation_jobs").select("*")
        .eq("generation_attempt_id", AUTHORIZED_ATTEMPT_ID).order("position"),
      supabase.storage.listBuckets(),
    ])
    if (revisionError || !revision || jobsError || bucketsError ||
      revision.status !== "READY_FOR_PREPARE" ||
      revision.strategy_version !== "VISUAL_STRATEGY_V3" ||
      revision.revision_contract !== GENERATION_VERSION ||
      revision.product_dossier_hash !== manifest.productDossierHash ||
      revision.market_visual_brief_hash !== manifest.marketVisualBriefHash ||
      revision.main_source_hash !== manifest.mainSourceHash ||
      revision.side_source_hash !== manifest.sideSourceHash) {
      throw new Error("REFERENCE_GUIDED_CANARY_REVISION_MISMATCH")
    }
    const jobs = rows<JsonRecord>(persistedJobs)
    if (jobs.length !== 6 || jobs.some((job, index) => {
      const planned = manifestJobs[index]
      return Number(job.position) !== index + 1 || job.status !== "PENDING" ||
        job.lease_owner != null || job.lease_expires_at != null ||
        job.provider_request_id != null || job.provider_call_started_at != null ||
        job.commercial_role !== planned?.commercialObjective ||
        job.exact_prompt_text !== planned?.exactPromptText ||
        job.prompt_hash !== planned?.promptHash ||
        job.prompt_hash !== sha256(Buffer.from(text(job.exact_prompt_text, 100_000), "utf8")) ||
        job.prompt_template_version !== PROMPT_TEMPLATE_VERSION ||
        job.product_dossier_hash !== revision.product_dossier_hash ||
        job.market_visual_brief_hash !== revision.market_visual_brief_hash ||
        job.source_main_hash !== revision.main_source_hash ||
        job.source_side_hash !== revision.side_source_hash
    })) {
      throw new Error("REFERENCE_GUIDED_CANARY_JOB_SET_INVALID")
    }
    if (Number(jobs[0]?.position) !== AUTHORIZED_POSITION ||
      jobs[0]?.commercial_role !== AUTHORIZED_OBJECTIVE) {
      throw new Error("REFERENCE_GUIDED_CANARY_POSITION_INVALID")
    }
    const stagingBucket = rows<{ id?: string; public?: boolean }>(buckets)
      .find((bucket) => bucket.id === REFERENCE_GUIDED_CANARY_OUTPUT_BUCKET)
    const sourceBucket = rows<{ id?: string; public?: boolean }>(buckets)
      .find((bucket) => bucket.id === EBAY_IMAGE_SOURCE_BUCKET)
    if (!stagingBucket || stagingBucket.public !== false ||
      !sourceBucket || sourceBucket.public !== false) {
      throw new Error("REFERENCE_GUIDED_CANARY_PRIVATE_STORAGE_REQUIRED")
    }

    const { data: binding, error: bindingError } = await supabase
      .from("luna_catalog_source_pack_dossier_bindings")
      .select("*")
      .eq("listing_package_id", revision.listing_package_id)
      .eq("dossier_hash", revision.product_dossier_hash)
      .eq("policy_version", GENERATION_VERSION)
      .order("verified_at", { ascending: false }).limit(1).maybeSingle()
    if (bindingError || !binding || binding.source_pack_manifest_hash !==
      manifest.sourcePackManifestHash) {
      throw new Error("REFERENCE_GUIDED_CANARY_DOSSIER_BINDING_INVALID")
    }
    const [{ data: sourcePack, error: sourcePackError },
      { data: candidate, error: candidateError }] = await Promise.all([
      supabase.from("luna_catalog_authorized_source_packs").select("*")
        .eq("id", binding.source_pack_id).eq("listing_package_id", revision.listing_package_id)
        .maybeSingle(),
      supabase.from("ebay_same_day_pilot_candidates").select("product_facts_summary")
        .eq("id", revision.candidate_id).maybeSingle(),
    ])
    const factsPackage = record(record(candidate?.product_facts_summary).authoritativeFactsPackage)
    if (sourcePackError || !sourcePack || candidateError || !candidate ||
      sourcePack.source_pack_hash !== binding.source_pack_manifest_hash ||
      (sourcePack.manifest_hash ?? sourcePack.source_pack_hash) !== binding.source_pack_manifest_hash ||
      factsPackage.factPackageHash !== revision.product_dossier_hash) {
      throw new Error("REFERENCE_GUIDED_CANARY_SOURCE_PACK_INVALID")
    }
    const sourceAssets = rows<JsonRecord>(sourcePack.source_assets)
    const mainAsset = sourceAssets.find((asset) => asset.sourceImageId === "MAIN" &&
      asset.sourceAngle === "FRONT" && asset.authorizationStatus === SOURCE_AUTHORIZATION)
    const sideAsset = sourceAssets.find((asset) => asset.sourceImageId === "SIDE" &&
      asset.sourceAngle === "SIDE" && asset.authorizationStatus === SOURCE_AUTHORIZATION)
    if (sourceAssets.length !== 2 || !mainAsset || !sideAsset) {
      throw new Error("REFERENCE_GUIDED_CANARY_PROTECTED_SOURCES_INVALID")
    }
    const excludedHashes = rows<string>(mainAsset.excludedSourceSha256s)
    if (excludedHashes.length !== 5 || excludedHashes.includes(text(mainAsset.sha256)) ||
      excludedHashes.includes(text(sideAsset.sha256))) {
      throw new Error("REFERENCE_GUIDED_CANARY_PROTECTED_SOURCES_INVALID")
    }
    const downloadSource = async (asset: JsonRecord, expectedHash: unknown) => {
      const path = text(asset.storagePath, 1_000)
      const { data, error } = await supabase.storage.from(EBAY_IMAGE_SOURCE_BUCKET)
        .download(path)
      if (error || !data) throw new Error("REFERENCE_GUIDED_CANARY_SOURCE_DOWNLOAD_FAILED")
      const bytes = Buffer.from(await data.arrayBuffer())
      const metadata = await sharp(bytes).metadata()
      if (sha256(bytes) !== expectedHash || sha256(bytes) !== asset.sha256 ||
        metadata.width !== Number(asset.nativeWidth) ||
        metadata.height !== Number(asset.nativeHeight)) {
        throw new Error("REFERENCE_GUIDED_CANARY_SOURCE_BYTES_MISMATCH")
      }
      return bytes
    }
    const [main, side] = await Promise.all([
      downloadSource(mainAsset, revision.main_source_hash),
      downloadSource(sideAsset, revision.side_source_hash),
    ])

    const manifestJob = manifestJobs[0]
    const plan = {
      version: GENERATION_VERSION,
      model: "gpt-image-2",
      size: "1600x1600",
      quality: "high",
      outputFormat: "png",
      productBytesSentToProvider: true,
      competitorImagesSentToProvider: false,
      excludedSourceSha256s: excludedHashes,
      compositionManifestHash: text(attempt.composition_manifest_hash, 64),
      jobs: [{
        slot: "PACK_AND_COUNT",
        salesObjective: AUTHORIZED_OBJECTIVE,
        prompt: text(manifestJob.exactPromptText, 100_000),
        promptHash: text(manifestJob.promptHash, 64),
        sourceImageIds: ["MAIN", "SIDE"],
        sourceHashes: [text(manifest.mainSourceHash, 64), text(manifest.sideSourceHash, 64)],
      }],
    } as unknown as EbayReferenceGuidedGenerationPlan
    leaseOwner = `vercel-canary:${randomUUID()}`

    const persistence: ReferenceGuidedPersistence = {
      async claimCanary(manifestHash, owner) {
        const { data, error } = await supabase.rpc(
          "claim_ebay_reference_guided_canary_job",
          { p_attempt_id: AUTHORIZED_ATTEMPT_ID, p_manifest_hash: manifestHash,
            p_lease_owner: owner, p_feature_enabled: true },
        )
        if (error) throw new Error(safeCode(error, "REFERENCE_GUIDED_CANARY_CLAIM_FAILED"))
        const claimed = rows<JsonRecord>(data)
        claimedJobId = text(claimed[0]?.id, 40) || null
        return claimed.map((job) => ({ id: text(job.id, 40), position: Number(job.position),
          status: text(job.status, 40), sourceMainHash: text(job.source_main_hash, 64),
          sourceSideHash: text(job.source_side_hash, 64), promptHash: text(job.prompt_hash, 64),
          exactPromptText: text(job.exact_prompt_text, 100_000) })) as ReferenceGuidedJobRecord[]
      },
      async reserveCanaryProviderCall(input) {
        const { data, error } = await supabase.rpc(
          "reserve_ebay_reference_guided_canary_call",
          { p_attempt_id: input.attemptId, p_job_id: input.jobId,
            p_manifest_hash: input.manifestHash, p_lease_owner: input.leaseOwner,
            p_exact_prompt_hash: input.exactPromptHash, p_feature_enabled: true },
        )
        if (error) {
          await supabase.from("ebay_reference_guided_generation_jobs")
            .update({ status: "PENDING", lease_owner: null, lease_expires_at: null })
            .eq("id", input.jobId).eq("status", "RESERVED").eq("lease_owner", input.leaseOwner)
          throw new Error(safeCode(error, "REFERENCE_GUIDED_CANARY_RESERVE_FAILED"))
        }
        budgetReserved = Number(data) === 1
        return Number(data)
      },
      async saveGenerated(jobId: string, result: EbayReferenceGuidedProviderResult,
        manifestHash: string) {
        if (manifestHash !== attempt.composition_manifest_hash) {
          throw new Error("REFERENCE_GUIDED_CANARY_MANIFEST_CHANGED")
        }
        outputSha256 = result.outputSha256
        providerRequestId = result.providerRequestId ?? providerRequestId
        const proposedStoragePath = `${revision.created_by}/reference-guided-canary/${AUTHORIZED_ATTEMPT_ID}/position-1/${outputSha256}.png`
        const persisted = await persistReferenceGuidedCanaryPng({
          supabase,
          output: result.output,
          expectedSha256: result.outputSha256,
          storagePath: proposedStoragePath,
        })
        automaticQaResult = persisted.qaResult
        const { data: updated, error: updateError } = await supabase
          .from("ebay_reference_guided_generation_jobs")
          .update({ status: "QA_PENDING", provider_request_id: providerRequestId,
            provider_call_completed_at: new Date().toISOString(),
            output_storage_path: proposedStoragePath, output_sha256: outputSha256,
            qa_result: automaticQaResult, error_code: null,
            lease_owner: null, lease_expires_at: null })
          .eq("id", jobId).eq("status", "PROVIDER_CALLING")
          .select("id").maybeSingle()
        if (updateError || !updated) {
          await removeReferenceGuidedCanaryPng({
            supabase,
            storagePath: proposedStoragePath,
          })
          throw new Error("REFERENCE_GUIDED_CANARY_RESULT_PERSIST_FAILED")
        }
        outputStoragePath = proposedStoragePath
      },
      async markOutcomeUnknown(jobId, errorCode) {
        await supabase.from("ebay_reference_guided_generation_jobs")
          .update({ status: "PROVIDER_OUTCOME_UNKNOWN", error_code: errorCode,
            provider_request_id: providerRequestId,
            provider_call_completed_at: new Date().toISOString(),
            lease_owner: null, lease_expires_at: null })
          .eq("id", jobId)
      },
      async markRetryable(jobId, errorCode) {
        await supabase.from("ebay_reference_guided_generation_jobs")
          .update({ status: "PROVIDER_RETRYABLE_ERROR", error_code: errorCode,
            provider_request_id: providerRequestId,
            provider_call_completed_at: new Date().toISOString(),
            lease_owner: null, lease_expires_at: null })
          .eq("id", jobId)
      },
    }

    const fetchOnce: typeof fetch = async (url, init) => {
      providerFetches += 1
      if (providerFetches !== 1 || String(url) !== "https://api.openai.com/v1/images/edits") {
        throw new Error("REFERENCE_GUIDED_CANARY_HTTP_BUDGET_EXCEEDED")
      }
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(230_000),
      })
      httpStatus = response.status
      providerRequestId = response.headers.get("x-request-id") || providerRequestId
      return response
    }
    const result = await runReferenceGuidedGenerationCanary({
      attemptId: AUTHORIZED_ATTEMPT_ID,
      manifestHash: text(attempt.composition_manifest_hash, 64),
      leaseOwner,
      plan,
      main,
      side,
      apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
      persistence,
      fetchImpl: fetchOnce,
      featureEnabled: true,
      shouldContinue: () =>
        process.env.OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED === "true",
    })
    main.fill(0)
    side.fill(0)
    const qaResponse = record(automaticQaResult)

    return NextResponse.json({
      success: Boolean(outputStoragePath),
      canaryStarted: true,
      positionClaimed: result.claimedJobs === 1 ? 1 : null,
      providerBudgetReserved: budgetReserved,
      providerCalls: result.providerCalls,
      httpStatus,
      providerRequestId,
      outputCreated: Boolean(outputStoragePath),
      outputDimensions: outputStoragePath ? "1600x1600" : null,
      outputSha256,
      privateStoragePath: outputStoragePath,
      automaticQaStatus: text(qaResponse.automaticStatus, 40) || "NOT_RUN",
      qaIdentityChecks: qaResponse.identityChecks ?? null,
      automaticRetryOccurred: false,
      ebayWrites: 0,
      productionChanged: false,
    }, { status: outputStoragePath ? 200 : 502 })
  } catch (error) {
    const code = safeCode(error)
    if (claimedJobId && leaseOwner && !budgetReserved) {
      const supabase = getSupabaseAdminClient()
      await supabase.from("ebay_reference_guided_generation_jobs")
        .update({ status: "PENDING", lease_owner: null, lease_expires_at: null,
          error_code: code })
        .eq("id", claimedJobId).eq("status", "RESERVED").eq("lease_owner", leaseOwner)
    }
    return NextResponse.json({ success: false, error: code,
      canaryStarted: Boolean(claimedJobId), providerBudgetReserved: budgetReserved,
      providerCalls: budgetReserved ? 1 : 0, httpStatus, providerRequestId,
      outputCreated: false, automaticQaStatus: "NOT_RUN",
      automaticRetryOccurred: false, ebayWrites: 0, productionChanged: false },
    { status: budgetReserved ? 502 : 409 })
  }
}
