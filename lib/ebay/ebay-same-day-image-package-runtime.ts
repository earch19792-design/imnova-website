import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  assertStoredSameDayImageSetQaPassed,
  currentAttemptPublicObjects,
  hasReviewableSameDaySecondaryAssetContracts,
  isReviewableDeterministicSingleSourceInformationalSet,
} from "./ebay-image-approval-policy"
import sharp from "sharp"

import {
  EBAY_IMAGE_SOURCE_BUCKET,
  EBAY_IMAGE_STAGING_BUCKET,
} from "./ebay-image-storage-cleanup"
import {
  buildSafeOpenAiBackgroundPlatePlan,
  EBAY_AUTHORIZED_FOREGROUND_MATTE_VERSION,
  EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION,
  EBAY_IMAGE_TEXT_RENDERER_VERSION,
  EBAY_LISTING_IMAGE_SET_VERSION,
  EBAY_LISTING_IMAGE_SLOTS,
  EBAY_SQUARE_PRESENTATION_QA_VERSION,
  buildSellerOsEbayVisualStrategyV2,
  getListingImageFactoryConfiguration,
  requestSafeOpenAiBackgroundPlate,
} from "./ebay-listing-image-factory"
import {
  buildSameDayImagePackagePlan,
  disposeTransientSameDayImageAssets,
  generateTransientSameDayImagePackage,
} from "./ebay-same-day-image-package-service"
import {
  isEbayImageMarketBriefUsable,
  loadEbayImageMarketBrief,
} from "./ebay-image-market-brief"
import {
  assertLunaCatalogCommercialSourceDiversity,
  disposeAuthorizedCatalogSourcePack,
  bindLunaCatalogSourcesToStrategy,
  LUNA_CATALOG_SOURCE_RESOLVER_VERSION,
  resolveLunaCatalogOriginalSourcePack,
  selectForegroundSafeLunaCatalogGenerationSources,
} from "./luna-catalog-original-source-resolver"
import { persistAuthorizedCatalogSourcePack } from "./luna-catalog-source-pack-persistence"

const OUTPUT_BUCKET = "ebay-listing-images"
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024
const PUBLISH_OPENAI_IMAGE_QUALITY = "high" as const

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

function uuid(value: unknown) {
  const normalized = text(value, 40)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex")
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_:.-]+$/.test(message)
    ? message
    : "SAME_DAY_IMAGE_PACKAGE_RUNTIME_FAILED"
}

function databaseErrorCode(error: unknown, fallback: string) {
  return text(record(error).message, 1_000).match(/[A-Z][A-Z0-9_]{5,}/)?.[0]
    ?? fallback
}

function candidatePath(candidateKey: string) {
  return sha256(candidateKey).slice(0, 24)
}

function exactSevenAssetIds(value: unknown) {
  if (!Array.isArray(value)) return []
  const ids = [...new Set(value.map(uuid).filter(Boolean))]
  return ids.length === 7 ? ids : []
}


function currentHandoffPackage(candidate: JsonRecord) {
  const summary = record(candidate.manual_handoff_package)
  const handoffPackage = record(summary.package)
  const packageHash = text(summary.packageHash, 64)
  if (!Object.keys(handoffPackage).length || !/^[0-9a-f]{64}$/.test(packageHash)) {
    throw new Error("SAME_DAY_IMAGE_HANDOFF_CHECKPOINT_MISSING")
  }
  return { summary, handoffPackage, packageHash }
}

function currentFactsBinding(candidate: JsonRecord) {
  const summary = record(candidate.product_facts_summary)
  const factsPackage = record(summary.authoritativeFactsPackage)
  const factRunId = uuid(summary.factRunId)
  const factPackageHash = text(factsPackage.factPackageHash, 80)
  if (summary.currentRunBound !== true || !factRunId ||
    !/^sha256:[0-9a-f]{64}$/.test(factPackageHash)) {
    throw new Error("SAME_DAY_IMAGE_CURRENT_FACT_BINDING_MISSING")
  }
  return { summary, factsPackage, factRunId, factPackageHash }
}

function authorizationReference(candidate: JsonRecord) {
  const economics = record(candidate.economics_summary)
  if (economics.imageRightsConfirmed !== true ||
    economics.openAiImageSpendApproved !== true ||
    Number(economics.openAiImageMaximumCallsApproved) !== 1) {
    throw new Error("SAME_DAY_IMAGE_OPERATOR_AUTHORIZATION_REQUIRED")
  }
  const confirmedAt = text(economics.imageRightsConfirmedAt, 40)
  if (!Number.isFinite(Date.parse(confirmedAt))) {
    throw new Error("SAME_DAY_IMAGE_RIGHTS_ATTESTATION_INVALID")
  }
  return `SAME_DAY_OPERATOR_ATTESTATION:${text(candidate.id, 40)}:${confirmedAt}`
}

async function exactListingPackage(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  runId: string
  candidate: JsonRecord
  handoffPackage: JsonRecord
}) {
  const opportunityId = uuid(input.candidate.opportunity_id)
  const candidateKey = text(input.candidate.candidate_key, 300)
  if (!opportunityId || !candidateKey || !uuid(input.actorId)) {
    throw new Error("SAME_DAY_IMAGE_LISTING_PACKAGE_SCOPE_INVALID")
  }
  const read = () => input.supabase.from("ebay_listing_packages").select("*")
    .eq("account_key", input.accountKey)
    .eq("opportunity_id", opportunityId)
    .maybeSingle()
  let { data, error } = await read()
  if (error) throw new Error("SAME_DAY_IMAGE_LISTING_PACKAGE_READ_FAILED")
  if (!data) {
    const inserted = await input.supabase.from("ebay_listing_packages").insert({
      account_key: input.accountKey,
      opportunity_id: opportunityId,
      candidate_key: candidateKey,
      status: "draft",
      package_data: {
        ...input.handoffPackage,
        sameDayPilot: { runId: input.runId, candidateId: input.candidate.id },
      },
      readiness: 0,
      source_observed_at: new Date().toISOString(),
      created_by: input.actorId,
    }).select("*").single()
    if (inserted.error) {
      const raced = await read()
      if (raced.error || !raced.data) {
        throw new Error("SAME_DAY_IMAGE_LISTING_PACKAGE_CREATE_FAILED")
      }
      data = raced.data
    } else data = inserted.data
  }
  if (text(data.account_key) !== input.accountKey ||
    uuid(data.created_by) !== input.actorId ||
    uuid(data.opportunity_id) !== opportunityId ||
    text(data.candidate_key, 300) !== candidateKey || data.status === "archived") {
    throw new Error("SAME_DAY_IMAGE_LISTING_PACKAGE_OWNERSHIP_INVALID")
  }
  const existingPackageData = record(data.package_data)
  const existingBinding = record(existingPackageData.sameDayPilot)
  const requestedBinding = {
    runId: input.runId,
    candidateId: input.candidate.id,
  }
  if (Object.keys(existingBinding).length && (
    uuid(existingBinding.runId) !== input.runId
    || uuid(existingBinding.candidateId) !== uuid(input.candidate.id)
  )) {
    throw new Error("SAME_DAY_IMAGE_LISTING_PACKAGE_BINDING_CONFLICT")
  }
  if (!Object.keys(existingBinding).length) {
    const { data: bound, error: bindingError } = await input.supabase
      .from("ebay_listing_packages")
      .update({
        package_data: {
          ...existingPackageData,
          sameDayPilot: requestedBinding,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("account_key", input.accountKey)
      .eq("created_by", input.actorId)
      .eq("updated_at", data.updated_at)
      .select("*")
      .maybeSingle()
    if (bindingError || !bound) {
      throw new Error("SAME_DAY_IMAGE_LISTING_PACKAGE_BINDING_FAILED")
    }
    data = bound
  }
  return record(data)
}

async function controlRow(
  supabase: SupabaseClient,
  controlId: string,
  actorId: string,
) {
  const { data, error } = await supabase
    .from("ebay_same_day_pilot_image_package_runs")
    .select("*")
    .eq("id", controlId)
    .eq("created_by", actorId)
    .maybeSingle()
  if (error || !data) throw new Error("SAME_DAY_IMAGE_CONTROL_READ_FAILED")
  return record(data)
}

async function reusableCompletedSet(input: {
  supabase: SupabaseClient
  control: JsonRecord
  accountKey: string
  actorId: string
  listingPackageId: string
}) {
  if (!["PENDING_REVIEW", "APPROVED"].includes(text(input.control.status))) return null
  const assetIds = exactSevenAssetIds(input.control.asset_ids)
  if (!assetIds.length) throw new Error("SAME_DAY_IMAGE_COMPLETED_SET_INVALID")
  const { data, error } = await input.supabase.from("ebay_listing_image_assets")
    .select("id,transformation,qa_result,status,position")
    .eq("account_key", input.accountKey)
    .eq("created_by", input.actorId)
    .eq("listing_package_id", input.listingPackageId)
    .in("id", assetIds)
    .in("status", ["pending_review", "approved"])
  if (error || data?.length !== 7) {
    throw new Error("SAME_DAY_IMAGE_COMPLETED_SET_ASSETS_MISSING")
  }
  const slots = new Set(data.map((asset) => text(record(asset.transformation).slot)))
  if (EBAY_LISTING_IMAGE_SLOTS.some((slot) => !slots.has(slot))) {
    throw new Error("SAME_DAY_IMAGE_COMPLETED_SET_SLOTS_INVALID")
  }
  const generated = data.map((asset) => record(asset.transformation))
    .filter((transformation) => transformation.generativeAiUsed === true)
  const currentContract = data.every((asset) =>
    record(asset.transformation).compositorContractVersion ===
      EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION)
  const secondaryForegroundsValid = data
    .filter((asset) => record(asset.transformation).slot !==
      "MAIN_WHITE_BACKGROUND")
    .every((asset) => {
      const transformation = record(asset.transformation)
      const qa = record(asset.qa_result)
      return transformation.authorizedSourceTreatment ===
          "LOCAL_AUTHORIZED_FOREGROUND" &&
        transformation.foregroundMatteVersion ===
          EBAY_AUTHORIZED_FOREGROUND_MATTE_VERSION &&
        qa.foregroundMatteValidated === true &&
        qa.opaqueSourceFrameRemoved === true &&
        qa.textSafeAreaVerified === true &&
        transformation.textRendererVersion ===
          EBAY_IMAGE_TEXT_RENDERER_VERSION &&
        qa.textGlyphsValidated === true
    })
  if (!currentContract || !secondaryForegroundsValid) {
    throw new Error("SAME_DAY_IMAGE_COMPOSITOR_REGENERATION_REQUIRED")
  }
  if (generated.length && generated.some((transformation) =>
    transformation.backgroundPlateQuality !== PUBLISH_OPENAI_IMAGE_QUALITY)) {
    throw new Error("SAME_DAY_IMAGE_PUBLISH_QUALITY_REGENERATION_REQUIRED")
  }
  return {
    listingPackageId: input.listingPackageId,
    controlId: text(input.control.id),
    assetIds,
    openAiCalls: Number(input.control.openai_calls) === 1 ? 1 : 0,
    generationMode: text(input.control.generation_mode),
    reused: true,
  }
}

async function cleanupUploaded(
  supabase: SupabaseClient,
  objects: Array<{ bucket: string; path: string }>,
) {
  const grouped = new Map<string, string[]>()
  for (const object of objects) {
    grouped.set(object.bucket, [...(grouped.get(object.bucket) ?? []), object.path])
  }
  await Promise.all([...grouped].map(([bucket, paths]) =>
    supabase.storage.from(bucket).remove(paths).catch(() => undefined)))
}

export async function generateAndPersistSameDayImagePackage(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  runId: string
  candidate: JsonRecord
  forceDeterministicImageFallback?: boolean
}) {
  const runId = uuid(input.runId)
  const candidateId = uuid(input.candidate.id)
  const actorId = uuid(input.actorId)
  if (!runId || !candidateId || !actorId) {
    throw new Error("SAME_DAY_IMAGE_RUNTIME_SCOPE_INVALID")
  }
  const { handoffPackage, packageHash } = currentHandoffPackage(input.candidate)
  const facts = currentFactsBinding(input.candidate)
  const rightsReference = authorizationReference(input.candidate)
  const listingPackage = await exactListingPackage({
    ...input,
    actorId,
    runId,
    handoffPackage,
  })
  const listingPackageId = uuid(listingPackage.id)
  if (!listingPackageId) throw new Error("SAME_DAY_IMAGE_LISTING_PACKAGE_ID_INVALID")
  const { data: handoff, error: handoffError } = await input.supabase
    .from("ebay_same_day_pilot_handoffs")
    .select("id,fact_run_id,package_hash,package_data,status")
    .eq("run_id", runId)
    .eq("candidate_id", candidateId)
    .eq("fact_run_id", facts.factRunId)
    .eq("package_hash", packageHash)
    .eq("status", "AWAITING_IMAGE_APPROVAL")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (handoffError || !handoff || !uuid(handoff.id)) {
    throw new Error("SAME_DAY_IMAGE_DURABLE_HANDOFF_MISSING")
  }
  const configuration = getListingImageFactoryConfiguration()
  if (configuration.deterministicComposition !== "READY") {
    throw new Error("SAME_DAY_IMAGE_COMPOSITION_ENVIRONMENT_BLOCKED")
  }
  const aiEnabled = configuration.aiGeneration === "READY" &&
    input.forceDeterministicImageFallback !== true
  const model = process.env.OPENAI_IMAGE_MODEL?.trim() ?? ""
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? ""
  const capturedMarketVisualBrief = await loadEbayImageMarketBrief({
    supabase: input.supabase,
    accountKey: input.accountKey,
    captureBatchId: input.candidate.product_research_capture_batch_id,
    familyFingerprint: input.candidate.family_fingerprint,
  })
  // Aggregate market imagery improves art direction but never defines the
  // product. When it is unavailable, the factory uses its explicit
  // professional fallback prompt while Luna Portex supplies the authorized
  // product pixels and the dossier supplies every factual claim.
  const marketVisualBrief = isEbayImageMarketBriefUsable(
    capturedMarketVisualBrief,
  )
    ? capturedMarketVisualBrief
    : null
  const opportunityId = uuid(input.candidate.opportunity_id)
  const supplierVariantId = text(input.candidate.supplier_variant_id, 160)
  const { data: opportunity, error: opportunityError } = await input.supabase
    .from("ebay_luna_opportunity_queue")
    .select("market_radar_product_id,supplier_variant_id")
    .eq("id", opportunityId)
    .maybeSingle()
  const marketRadarProductId = uuid(opportunity?.market_radar_product_id)
  if (opportunityError || !opportunityId || !marketRadarProductId ||
    !supplierVariantId ||
    text(opportunity?.supplier_variant_id, 160) !== supplierVariantId) {
    throw new Error("LUNA_CATALOG_PRODUCT_IDENTITY_MISMATCH")
  }
  const { data: lunaCatalog, error: lunaCatalogError } = await input.supabase
    .from("market_radar_latest_variants")
    .select("supplier_product_id,supplier_variant_id,product_url,featured_image_url,image_urls")
    .eq("source_key", "lunaportex")
    .eq("product_id", marketRadarProductId)
    .eq("supplier_variant_id", supplierVariantId)
    .maybeSingle()
  const supplierProductId = text(lunaCatalog?.supplier_product_id, 40)
  const productUrl = text(lunaCatalog?.product_url, 2_000)
  if (lunaCatalogError || !/^\d{1,30}$/.test(supplierProductId) ||
    !productUrl.startsWith("https://")) {
    throw new Error("LUNA_CATALOG_CANONICAL_PRODUCT_MISSING")
  }
  const catalogPack = await resolveLunaCatalogOriginalSourcePack({
    productUrl,
    expectedProductId: supplierProductId,
    expectedVariantId: supplierVariantId,
    productIdentityHash: facts.factPackageHash,
    authorizationEvidenceHash: sha256([
      rightsReference,
      facts.factPackageHash,
      productUrl,
    ].join(":")),
    marketVisualSignalsUsable: true,
    knownCatalogImageUrls: [
      text(lunaCatalog?.featured_image_url, 2_000),
      ...(Array.isArray(lunaCatalog?.image_urls) ? lunaCatalog.image_urls : []),
    ].map((value) => text(value, 2_000)).filter(Boolean),
  })
  const generationSources =
    await selectForegroundSafeLunaCatalogGenerationSources(catalogPack)
  const catalogCapabilities = generationSources.map((asset) => ({
    id: `LUNA_CATALOG_SOURCE:${asset.sha256}`,
    nativeWidth: asset.nativeWidth,
    nativeHeight: asset.nativeHeight,
    effectiveWidth: asset.effectiveWidth,
    effectiveHeight: asset.effectiveHeight,
    qualityTier: asset.qualityTier,
    viewClassification: asset.viewClassification,
    enhancedDerivative: asset.enhancedDerivative,
  }))
  const resolvedHandoffPackage = {
    ...handoffPackage,
    images: {
      ...record(handoffPackage.images),
      urls: generationSources.map((asset) => asset.sourceUrl),
      count: generationSources.length,
      catalogSourceResolverVersion: LUNA_CATALOG_SOURCE_RESOLVER_VERSION,
    },
  }
  let plan: ReturnType<typeof buildSameDayImagePackagePlan>
  try {
    plan = buildSameDayImagePackagePlan({
      handoffPackage: resolvedHandoffPackage,
      authoritativeFactsPackage: facts.factsPackage,
      currentBinding: {
        candidateId,
        factRunId: facts.factRunId,
        factPackageHash: facts.factPackageHash,
      },
      rightsEvidence: {
        rightsBasis: "supplier_authorized",
        authorizationReference: rightsReference,
        rightsEvidenceConfirmed: true,
      },
      aiContext: aiEnabled ? {
        enabled: true,
        model,
        quality: PUBLISH_OPENAI_IMAGE_QUALITY,
      } : { enabled: false },
      marketVisualBrief,
      authorizedCatalogSources: catalogCapabilities,
    })
    const strategy = buildSellerOsEbayVisualStrategyV2(plan.factoryInput)
    if (strategy.length !== 6 ||
      new Set(strategy.map((position) => position.salesObjective)).size !== 6) {
      throw new Error("NEEDS_VERIFIED_PRODUCT_FACTS:VISUAL_STRATEGY")
    }
    assertLunaCatalogCommercialSourceDiversity(
      catalogPack,
      generationSources,
      catalogCapabilities.map((source) => source.id),
      strategy,
    )
    bindLunaCatalogSourcesToStrategy(
      catalogPack,
      generationSources,
      catalogCapabilities.map((source) => source.id),
      strategy,
    )
  } catch (error) {
    disposeAuthorizedCatalogSourcePack(catalogPack)
    throw error
  }
  let persistedCatalogPack: { packId: string; sourcePackHash: string }
  try {
    persistedCatalogPack = await persistAuthorizedCatalogSourcePack({
      supabase: input.supabase,
      accountKey: input.accountKey,
      actorId,
      listingPackageId,
      candidateId,
      marketRadarProductId,
      supplierVariantId,
      factPackageHash: facts.factPackageHash,
      pack: catalogPack,
    })
  } catch (error) {
    disposeAuthorizedCatalogSourcePack(catalogPack)
    throw error
  }
  const generationMode = aiEnabled
    ? "OPENAI_CONTEXT_PLATE"
    : "DETERMINISTIC_ONLY"
  const requestHash = plan.backgroundPlatePlan?.requestHash ?? "deterministic"
  const idempotencyKeyHash = sha256([
    input.accountKey, actorId, runId, candidateId, listingPackageId,
    facts.factRunId, packageHash, requestHash,
    EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION,
    EBAY_SQUARE_PRESENTATION_QA_VERSION,
  ].join(":"))
  const leaseToken = randomUUID()
  const claimInput = {
    p_account_key: input.accountKey,
    p_actor: actorId,
    p_run_id: runId,
    p_candidate_id: candidateId,
    p_listing_package_id: listingPackageId,
    p_fact_run_id: facts.factRunId,
    p_handoff_id: handoff.id,
    p_handoff_hash: packageHash,
    p_generation_mode: generationMode,
    p_idempotency_key_hash: idempotencyKeyHash,
    p_lease_token: leaseToken,
  }
  let claimResponse = await input.supabase.rpc(
    "claim_ebay_same_day_pilot_image_package_run",
    claimInput,
  )
  if (claimResponse.error &&
    generationMode === "DETERMINISTIC_ONLY" &&
    databaseErrorCode(claimResponse.error, "") ===
      "SAME_DAY_IMAGE_PACKAGE_IDEMPOTENCY_CONFLICT") {
    const { error: reconciliationError } = await input.supabase.rpc(
      "reconcile_same_day_pregeneration_image_mode_v1",
      {
        p_account_key: input.accountKey,
        p_actor: actorId,
        p_run_id: runId,
        p_candidate_id: candidateId,
        p_listing_package_id: listingPackageId,
        p_fact_run_id: facts.factRunId,
        p_handoff_id: handoff.id,
        p_handoff_hash: packageHash,
        p_expected_idempotency_hash: idempotencyKeyHash,
      },
    )
    if (reconciliationError) {
      disposeAuthorizedCatalogSourcePack(catalogPack)
      throw new Error(databaseErrorCode(
        reconciliationError,
        "SAME_DAY_IMAGE_PREGENERATION_RECONCILIATION_FAILED",
      ))
    }
    claimResponse = await input.supabase.rpc(
      "claim_ebay_same_day_pilot_image_package_run",
      claimInput,
    )
  }
  const priorClaim = record(claimResponse.data)
  if (!claimResponse.error &&
    generationMode === "DETERMINISTIC_ONLY" &&
    priorClaim.claimed !== true &&
    text(priorClaim.status) === "FAILED_FINAL") {
    const {
      data: gateReconciliationData,
      error: gateReconciliationError,
    } = await input.supabase.rpc(
      "reconcile_same_day_visual_gate_version_v1",
      {
        p_account_key: input.accountKey,
        p_actor: actorId,
        p_run_id: runId,
        p_candidate_id: candidateId,
        p_listing_package_id: listingPackageId,
        p_fact_run_id: facts.factRunId,
        p_handoff_id: handoff.id,
        p_handoff_hash: packageHash,
        p_expected_idempotency_hash: idempotencyKeyHash,
      },
    )
    if (gateReconciliationError) {
      disposeAuthorizedCatalogSourcePack(catalogPack)
      throw new Error(databaseErrorCode(
        gateReconciliationError,
        "SAME_DAY_IMAGE_VISUAL_GATE_RECONCILIATION_FAILED",
      ))
    }
    if (record(gateReconciliationData).reconciled === true) {
      claimResponse = await input.supabase.rpc(
        "claim_ebay_same_day_pilot_image_package_run",
        claimInput,
      )
    }
  }
  const { data: claimData, error: claimError } = claimResponse
  if (claimError) {
    disposeAuthorizedCatalogSourcePack(catalogPack)
    throw new Error(databaseErrorCode(
      claimError,
      "SAME_DAY_IMAGE_CONTROL_CLAIM_FAILED",
    ))
  }
  const claim = record(claimData)
  const controlId = uuid(claim.controlId ?? claim.runId ?? claim.id)
  if (!controlId) {
    disposeAuthorizedCatalogSourcePack(catalogPack)
    throw new Error("SAME_DAY_IMAGE_CONTROL_ID_INVALID")
  }
  if (claim.claimed !== true) {
    const control = await controlRow(input.supabase, controlId, actorId)
    const reused = await reusableCompletedSet({
      supabase: input.supabase,
      control,
      accountKey: input.accountKey,
      actorId,
      listingPackageId,
    })
    if (reused) {
      disposeAuthorizedCatalogSourcePack(catalogPack)
      return { ...reused, aiConfiguration: configuration.aiGeneration }
    }
    disposeAuthorizedCatalogSourcePack(catalogPack)
    throw new Error("SAME_DAY_IMAGE_CONTROL_NOT_CLAIMED")
  }

  let providerDispatched = false
  let providerRequestId: string | null = null
  let generated: Awaited<ReturnType<typeof generateTransientSameDayImagePackage>> | null = null
  const uploaded: Array<{ bucket: string; path: string }> = []
  const persistedAssetIds: string[] = []
  try {
    const uniqueSourceDetails = await Promise.all(generationSources.map(async (asset, index) => ({
      source: {
        buffer: asset.buffer,
        sourceUrl: asset.sourceUrl,
        contentType: asset.enhancedDerivative ? "image/jpeg" as const : asset.contentType,
      },
      index,
      sourceSha256: asset.sha256,
      metadata: await sharp(asset.buffer).metadata(),
      catalogAsset: asset,
    })))
    generated = await generateTransientSameDayImagePackage({
      handoffPackage: resolvedHandoffPackage,
      authoritativeFactsPackage: facts.factsPackage,
      currentBinding: {
        candidateId,
        factRunId: facts.factRunId,
        factPackageHash: facts.factPackageHash,
      },
      rightsEvidence: {
        rightsBasis: "supplier_authorized",
        authorizationReference: rightsReference,
        rightsEvidenceConfirmed: true,
      },
      aiContext: aiEnabled ? {
        enabled: true,
        model,
        quality: PUBLISH_OPENAI_IMAGE_QUALITY,
      } : { enabled: false },
      marketVisualBrief,
      authorizedCatalogSources: catalogCapabilities,
      source: uniqueSourceDetails.map((entry) => entry.source.buffer),
      requestBackgroundPlate: aiEnabled ? async (safePlan) => {
        providerDispatched = true
        const plate = await requestSafeOpenAiBackgroundPlate({
          plan: safePlan,
          apiKey,
        })
        providerRequestId = plate.providerRequestId
        return plate
      } : undefined,
    })
    const roleBySlot: Record<string, string> = {
      MAIN_WHITE_BACKGROUND: "main",
      PACK_AND_COUNT: "detail",
      KEY_FEATURES: "detail",
      SIZE_AND_CONTENT: "label",
      USE_CONTEXT: "lifestyle",
      PACKAGE_CONTENTS: "packaging",
      SECONDARY_6: "detail",
    }
    const pendingAssets: JsonRecord[] = []
    for (const composition of generated.transientAssets) {
      const selectedSource = uniqueSourceDetails.find((entry) =>
        entry.sourceSha256 === composition.sourceSha256)
      if (!selectedSource) throw new Error("SAME_DAY_IMAGE_COMPOSITION_SOURCE_MISMATCH")
      const assetId = randomUUID()
      const base = `${actorId}/${candidatePath(text(input.candidate.candidate_key, 300))}/${assetId}`
      const sourceExtension = selectedSource.source.contentType === "image/png"
        ? "png" : selectedSource.source.contentType === "image/webp" ? "webp" : "jpg"
      const sourcePath = `${base}-source.${sourceExtension}`
      const outputPath = `${base}-optimized.jpg`
      const sourceUpload = await input.supabase.storage
        .from(EBAY_IMAGE_SOURCE_BUCKET)
        .upload(sourcePath, selectedSource.source.buffer, {
          contentType: selectedSource.source.contentType,
          upsert: false,
        })
      if (sourceUpload.error) throw new Error("SAME_DAY_IMAGE_SOURCE_STORAGE_FAILED")
      uploaded.push({ bucket: EBAY_IMAGE_SOURCE_BUCKET, path: sourcePath })
      const outputUpload = await input.supabase.storage
        .from(EBAY_IMAGE_STAGING_BUCKET)
        .upload(outputPath, composition.output, {
          contentType: "image/jpeg",
          upsert: false,
        })
      if (outputUpload.error) throw new Error("SAME_DAY_IMAGE_OUTPUT_STORAGE_FAILED")
      uploaded.push({ bucket: EBAY_IMAGE_STAGING_BUCKET, path: outputPath })
      pendingAssets.push({
        id: assetId,
        asset_role: roleBySlot[composition.slot],
        source_kind: "authorized_url",
        source_url: selectedSource.source.sourceUrl,
        source_storage_path: sourcePath,
        output_storage_path: outputPath,
        source_sha256: composition.sourceSha256,
        output_sha256: composition.outputSha256,
        source_width: selectedSource.metadata.width,
        source_height: selectedSource.metadata.height,
        output_width: composition.width,
        output_height: composition.height,
        output_bytes: composition.bytes,
        rights_basis: "supplier_authorized",
        authorization_reference: rightsReference,
        rights_evidence_confirmed: true,
        transformation_version: EBAY_LISTING_IMAGE_SET_VERSION,
        transformation: {
          ...composition.transformation,
          sameDayPilotRunId: runId,
          sameDayPilotCandidateId: candidateId,
          sameDayImageControlId: controlId,
          authoritativeFactPackageHash: facts.factPackageHash,
          authorizedCatalogSourcePackId: persistedCatalogPack.packId,
          authorizedCatalogSourcePackHash: persistedCatalogPack.sourcePackHash,
          catalogSourceResolverVersion: LUNA_CATALOG_SOURCE_RESOLVER_VERSION,
          catalogNativeSourceSha256: selectedSource.catalogAsset.sourceSha256,
          catalogEnhancedDerivative: selectedSource.catalogAsset.enhancedDerivative,
          catalogEnhancedSha256: selectedSource.catalogAsset.enhancedSha256,
        },
        qa_result: composition.qa,
      })
    }
    const { data: saved, error: saveError } = await input.supabase.rpc(
      "ebay_create_pending_listing_image_set",
      {
        p_package_id: listingPackageId,
        p_account_key: input.accountKey,
        p_actor: actorId,
        p_opportunity_id: input.candidate.opportunity_id,
        p_candidate_key: input.candidate.candidate_key,
        p_assets: pendingAssets,
      },
    )
    const savedRows = (Array.isArray(saved) ? saved : saved ? [saved] : [])
      .map(record)
    persistedAssetIds.push(...savedRows.map((row) => uuid(row.id)).filter(Boolean))
    if (saveError || persistedAssetIds.length !== 7) {
      throw new Error(databaseErrorCode(
        saveError,
        "SAME_DAY_IMAGE_ASSET_SET_SAVE_FAILED",
      ))
    }
    const { data: completed, error: completionError } = await input.supabase.rpc(
      "complete_ebay_same_day_pilot_image_package_run",
      {
        p_control_id: controlId,
        p_actor: actorId,
        p_lease_token: leaseToken,
        p_asset_ids: persistedAssetIds,
        p_openai_calls: generated.counters.openAiCalls,
        p_provider_request_id: providerRequestId,
      },
    )
    if (completionError || !completed) {
      throw new Error(databaseErrorCode(
        completionError,
        "SAME_DAY_IMAGE_CONTROL_COMPLETION_FAILED",
      ))
    }
    return {
      listingPackageId,
      controlId,
      assetIds: persistedAssetIds,
      openAiCalls: generated.counters.openAiCalls,
      generationMode,
      aiConfiguration: configuration.aiGeneration,
      reused: false,
    }
  } catch (error) {
    const code = safeError(error)
    if (persistedAssetIds.length) {
      await input.supabase.from("ebay_listing_image_assets").delete()
        .eq("account_key", input.accountKey)
        .eq("created_by", actorId)
        .eq("listing_package_id", listingPackageId)
        .in("id", persistedAssetIds)
    }
    await cleanupUploaded(input.supabase, uploaded)
    const knownRejectedRequest = /^EBAY_IMAGE_OPENAI_HTTP_(429|5[0-9]{2})$/.test(code)
    const rejectedBeforeNetwork = code === "EBAY_IMAGE_OPENAI_KEY_MISSING"
      || code === "EBAY_IMAGE_OPENAI_PLAN_NOT_ALLOWED"
    await input.supabase.rpc("fail_ebay_same_day_pilot_image_package_run", {
      p_control_id: controlId,
      p_actor: actorId,
      p_lease_token: leaseToken,
      p_error_code: code,
      p_openai_call_made: providerDispatched && !knownRejectedRequest && !rejectedBeforeNetwork,
    })
    throw error
  } finally {
    if (generated) disposeTransientSameDayImageAssets(generated.transientAssets)
    disposeAuthorizedCatalogSourcePack(catalogPack)
  }
}

async function verifiedStagedPublication(input: {
  supabase: SupabaseClient
  actorId: string
  candidateKey: string
  asset: JsonRecord
}) {
  const assetId = uuid(input.asset.id)
  const stagingPath = text(input.asset.output_storage_path, 1_000)
  if (!assetId || !stagingPath) throw new Error("SAME_DAY_IMAGE_STAGING_ASSET_INVALID")
  const { data: blob, error } = await input.supabase.storage
    .from(EBAY_IMAGE_STAGING_BUCKET)
    .download(stagingPath)
  if (error || !blob) throw new Error("SAME_DAY_IMAGE_STAGING_DOWNLOAD_FAILED")
  const bytes = Buffer.from(await blob.arrayBuffer())
  try {
    if (!bytes.length || bytes.length > MAX_OUTPUT_BYTES ||
      bytes.length !== Number(input.asset.output_bytes) ||
      sha256(bytes) !== text(input.asset.output_sha256, 64)) {
      throw new Error("SAME_DAY_IMAGE_STAGING_INTEGRITY_FAILED")
    }
    const publishedPath = `${input.actorId}/${candidatePath(input.candidateKey)}/${assetId}.jpg`
    const uploaded = await input.supabase.storage.from(OUTPUT_BUCKET)
      .upload(publishedPath, bytes, { contentType: "image/jpeg", upsert: false })
    if (uploaded.error) {
      const existing = await input.supabase.storage.from(OUTPUT_BUCKET)
        .download(publishedPath)
      if (existing.error || !existing.data) {
        throw new Error("SAME_DAY_IMAGE_PUBLICATION_STORAGE_FAILED")
      }
      const existingBytes = Buffer.from(await existing.data.arrayBuffer())
      try {
        if (existingBytes.length !== bytes.length || sha256(existingBytes) !== sha256(bytes)) {
          throw new Error("SAME_DAY_IMAGE_PUBLICATION_CONFLICT")
        }
      } finally {
        existingBytes.fill(0)
      }
    }
    const publicUrl = input.supabase.storage.from(OUTPUT_BUCKET)
      .getPublicUrl(publishedPath).data.publicUrl
    return {
      asset_id: assetId,
      public_url: publicUrl,
      published_storage_path: publishedPath,
      public_object_created: !uploaded.error,
      output_sha256: text(input.asset.output_sha256, 64),
    }
  } finally {
    bytes.fill(0)
  }
}

export async function reviewSameDayImagePackage(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  candidate: JsonRecord
  decision: "APPROVE" | "REJECT"
}) {
  const actorId = uuid(input.actorId)
  const candidateId = uuid(input.candidate.id)
  const candidateKey = text(input.candidate.candidate_key, 300)
  const summary = record(input.candidate.image_package_summary)
  const controlId = uuid(summary.controlId)
  const listingPackageId = uuid(summary.listingPackageId)
  const assetIds = exactSevenAssetIds(summary.assetIds)
  if (!actorId || !candidateId || !candidateKey || !controlId ||
    !listingPackageId || !assetIds.length) {
    throw new Error("SAME_DAY_IMAGE_REVIEW_SET_SCOPE_INVALID")
  }
  const { data, error } = await input.supabase.from("ebay_listing_image_assets")
    .select("*")
    .eq("account_key", input.accountKey)
    .eq("created_by", actorId)
    .eq("listing_package_id", listingPackageId)
    .in("id", assetIds)
    .in("status", input.decision === "REJECT"
      ? ["pending_review", "rejected"]
      : ["pending_review", "approved"])
    .order("position", { ascending: true })
  if (error || data?.length !== 7) throw new Error("SAME_DAY_IMAGE_REVIEW_SET_MISSING")
  const assets = data.map(record)
  const slots = new Set(assets.map((asset) => text(record(asset.transformation).slot)))
  if (EBAY_LISTING_IMAGE_SLOTS.some((slot) => !slots.has(slot))) {
    throw new Error("SAME_DAY_IMAGE_REVIEW_SET_SLOTS_INVALID")
  }
  if (input.decision === "APPROVE") {
    assertStoredSameDayImageSetQaPassed(assets)
    const transformations = assets.map((asset) => record(asset.transformation))
    const secondaryForegroundsValid = assets
      .filter((asset) => record(asset.transformation).slot !==
        "MAIN_WHITE_BACKGROUND")
      .every((asset) => hasReviewableSameDaySecondaryAssetContracts(asset, {
        foregroundMatteVersion: EBAY_AUTHORIZED_FOREGROUND_MATTE_VERSION,
        textRendererVersion: EBAY_IMAGE_TEXT_RENDERER_VERSION,
      }))
    const generated = transformations.filter((transformation) =>
      transformation.generativeAiUsed === true)
    const aiBoardSet = generated.length === 6 && transformations.every((transformation) =>
      transformation.compositorContractVersion ===
        EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION) &&
      generated.every((transformation) =>
        transformation.backgroundPlateQuality === PUBLISH_OPENAI_IMAGE_QUALITY) &&
      secondaryForegroundsValid &&
      transformations.find((transformation) =>
        transformation.slot === "MAIN_WHITE_BACKGROUND")?.generativeAiUsed !== true
    const deterministicMultiSourceSet = generated.length === 0 &&
      transformations.every((transformation) =>
        transformation.compositorContractVersion ===
          EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION &&
        transformation.presentationMode === "AUTHORIZED_MULTI_SOURCE") &&
      secondaryForegroundsValid
    const deterministicSingleSourceInformationalSet =
      isReviewableDeterministicSingleSourceInformationalSet(assets, {
        compositorContractVersion: EBAY_IMAGE_COMPOSITOR_CONTRACT_VERSION,
        foregroundMatteVersion: EBAY_AUTHORIZED_FOREGROUND_MATTE_VERSION,
        textRendererVersion: EBAY_IMAGE_TEXT_RENDERER_VERSION,
        slots: EBAY_LISTING_IMAGE_SLOTS,
      })
    if (!aiBoardSet && !deterministicMultiSourceSet &&
      !deterministicSingleSourceInformationalSet) {
      throw new Error("SAME_DAY_IMAGE_LEGACY_SET_REGENERATION_REQUIRED")
    }
  }
  let manifest: JsonRecord[] = []
  if (input.decision === "APPROVE") {
    const publications = await Promise.allSettled(assets.map(async (asset) => {
      if (asset.status === "approved") return {
        asset_id: asset.id,
        public_url: asset.public_url,
        published_storage_path: asset.published_storage_path,
        public_object_created: false,
      }
      return verifiedStagedPublication({
        supabase: input.supabase, actorId, candidateKey, asset,
      })
    }))
    const completed = publications.flatMap((entry) =>
      entry.status === "fulfilled" ? [entry.value] : [])
    const failed = publications.find((entry) => entry.status === "rejected")
    if (failed) {
      const createdPaths = currentAttemptPublicObjects(completed)
        .map((entry) => entry.path)
      if (createdPaths.length) {
        const cleanup = await input.supabase.storage.from(OUTPUT_BUCKET)
          .remove(createdPaths)
        if (cleanup.error) {
          throw new Error("PUBLIC_STORAGE_COMPENSATION_FAILED")
        }
      }
      throw failed.reason
    }
    manifest = completed
  }
  const { data: reviewed, error: reviewError } = await input.supabase.rpc(
    "review_ebay_same_day_pilot_image_package_set",
    {
      p_control_id: controlId,
      p_actor: actorId,
      p_decision: input.decision,
      p_confirmed: true,
      p_publication_manifest: manifest.map((entry) => ({
        asset_id: entry.asset_id,
        public_url: entry.public_url,
        published_storage_path: entry.published_storage_path,
      })),
    },
  )
  if (reviewError || !reviewed) {
    const createdPaths = currentAttemptPublicObjects(manifest)
      .map((entry) => entry.path)
    if (createdPaths.length) {
      const cleanup = await input.supabase.storage.from(OUTPUT_BUCKET)
        .remove(createdPaths)
      if (cleanup.error) {
        throw new Error("PUBLIC_STORAGE_COMPENSATION_FAILED")
      }
    }
    throw new Error(databaseErrorCode(
      reviewError,
      "SAME_DAY_IMAGE_SET_REVIEW_FAILED",
    ))
  }
  const result = record(reviewed)
  const urls = Array.isArray(result.publicUrls)
    ? result.publicUrls.map((value) => text(value, 2_000)).filter((value) => value.startsWith("https://"))
    : manifest.map((entry) => text(entry.public_url, 2_000)).filter((value) => value.startsWith("https://"))
  if (input.decision === "APPROVE" && urls.length !== 7) {
    throw new Error("SAME_DAY_IMAGE_APPROVED_URL_SET_INVALID")
  }
  await Promise.all(assets.map(async (asset) => {
    const paths = [text(asset.output_storage_path, 1_000), text(asset.source_storage_path, 1_000)]
    await Promise.all([
      paths[0] ? input.supabase.storage.from(EBAY_IMAGE_STAGING_BUCKET).remove([paths[0]]) : null,
      paths[1] ? input.supabase.storage.from(EBAY_IMAGE_SOURCE_BUCKET).remove([paths[1]]) : null,
    ])
  }))
  return {
    controlId,
    listingPackageId,
    assetIds,
    approved: input.decision === "APPROVE",
    publicUrls: input.decision === "APPROVE" ? urls : [],
    ebayWrites: 0,
  }
}
