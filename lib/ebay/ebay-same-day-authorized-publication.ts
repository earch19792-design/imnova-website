import type { SupabaseClient } from "@supabase/supabase-js"

import {
  controlledRiskEconomicsConfig,
  EBAY_CONTROLLED_RISK_OVERRIDE_VERSION,
} from "./ebay-controlled-risk-manual-override"
import type { EbayUnitEconomicsConfig } from "./ebay-unit-economics"
import {
  orderReferenceGuidedAssetsForEbay,
  REFERENCE_GUIDED_SEVEN_ASSET_ROLES,
  type ReferenceGuidedSevenAssetRole,
} from "./reference-guided-seven-asset-contract"
import {
  validateV3PublicationAssets,
  v3AuthorizationHash,
} from "./ebay-v3-unpublished-offer-authorization"

export const SAME_DAY_SELLER_OS_PUBLICATION_AUTHORIZATION_VERSION =
  "SELLER_OS_AUTHORIZED_PUBLICATION_V1_2026_07_20"

type JsonRecord = Record<string, unknown>

export type SameDayAuthorizedPublicationContext = {
  authorization: JsonRecord & {
    validated: true
    version: string
    runId: string
    candidateId: string
    listingPackageId: string
    sourceObservedAt: string
    controlledRisk: boolean
  }
  candidate: JsonRecord
  handoffPackage: JsonRecord
  opportunity: JsonRecord
  economicsConfig?: Partial<EbayUnitEconomicsConfig>
  sourceObservedAt: string
}

const READY_STATES = new Set([
  "READY_FOR_MANUAL_PUBLICATION",
  "WAITING_ITEM_ID",
])

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, maximum = 2_000) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().slice(0, maximum)
    : ""
}

function uuid(value: unknown) {
  const normalized = text(value, 50)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => text(entry)).filter(Boolean)
    : []
}

function exactSevenHttpsUrls(value: unknown) {
  return exactHttpsUrls(value, 7)
}

function exactHttpsUrls(value: unknown, expected: number) {
  if (!Array.isArray(value)) return []
  const urls = value.map((entry) => text(entry)).filter((entry) => {
    try {
      return new URL(entry).protocol === "https:"
    } catch {
      return false
    }
  })
  return urls.length === expected && new Set(urls).size === expected ? urls : []
}

function latestIso(...values: unknown[]) {
  const timestamps = values.map((value) => text(value, 50))
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))
  return timestamps[0] ? new Date(timestamps[0]).toISOString() : ""
}

function sourceMaximumAgeMinutes() {
  const configured = Number(process.env.EBAY_DRAFT_ONLY_SOURCE_MAX_AGE_MINUTES)
  return Number.isFinite(configured) && configured > 0
    ? Math.min(Math.trunc(configured), 1_440)
    : 360
}

function recent(value: string, now: Date) {
  const timestamp = Date.parse(value)
  const age = now.getTime() - timestamp
  return Number.isFinite(timestamp) && age >= 0
    && age <= sourceMaximumAgeMinutes() * 60_000
}

function economicsOverrides(value: JsonRecord) {
  const config = record(value.config)
  const parsed = (key: keyof EbayUnitEconomicsConfig) => number(config[key]) ?? undefined
  return {
    estimatedEbayFeeRate: parsed("estimatedEbayFeeRate"),
    fixedOrderFee: parsed("fixedOrderFee"),
    estimatedOutboundShipping: parsed("estimatedOutboundShipping"),
    returnsReserveRate: parsed("returnsReserveRate"),
    promotedListingsReserveRate: parsed("promotedListingsReserveRate"),
    minimumNetProfit: parsed("minimumNetProfit"),
    minimumNetMarginPercent: parsed("minimumNetMarginPercent"),
    minimumRoiPercent: parsed("minimumRoiPercent"),
  }
}

function validatedManifest(packageData: JsonRecord, imageUrls: string[],
  requireReferenceGuidedContract = false) {
  if (!Array.isArray(packageData.imageAssetManifest)
    || packageData.imageAssetManifest.length !== 7) return false
  const manifest = packageData.imageAssetManifest.map(record)
  const manifestUrls = manifest.map((asset) => text(asset.url)).filter(Boolean)
  const manifestAssetIds = manifest.map((asset) => uuid(asset.assetId)).filter(Boolean)
  const contractRoles = manifest.map((asset) => text(
    asset.referenceGuidedAssetRole ?? asset.assetRole, 80))
  const referenceGuidedContractPresent = contractRoles.some(Boolean)
  if (requireReferenceGuidedContract && !referenceGuidedContractPresent) {
    return false
  }
  if (referenceGuidedContractPresent) {
    if (!contractRoles.every((role) =>
      REFERENCE_GUIDED_SEVEN_ASSET_ROLES.includes(
        role as ReferenceGuidedSevenAssetRole))) return false
    let ordered: string[]
    try {
      ordered = orderReferenceGuidedAssetsForEbay(manifest.map((asset, index) => ({
        role: contractRoles[index] as ReferenceGuidedSevenAssetRole,
        url: text(asset.url),
      })))
    } catch {
      return false
    }
    if (!ordered.every((url, index) => imageUrls[index] === url)) return false
  }
  return new Set(manifestAssetIds).size === 7
    && manifest.every((asset) =>
    uuid(asset.assetId)
    && asset.automaticQa === "PASSED"
    && /^[0-9a-f]{64}$/.test(text(asset.sha256, 80))
    && Number.isFinite(Date.parse(text(asset.humanApprovedAt, 50)))
    && text(asset.url).startsWith("https://"))
    && imageUrls.every((url, index) => manifestUrls[index] === url)
}

function exactManifestAssetIds(packageData: JsonRecord, expected: number) {
  if (!Array.isArray(packageData.imageAssetManifest)
    || packageData.imageAssetManifest.length !== expected) return []
  const ids = packageData.imageAssetManifest.map((entry) =>
    uuid(record(entry).assetId)).filter(Boolean)
  return ids.length === expected && new Set(ids).size === expected ? ids : []
}

async function approvedPreferredImageRevision(input: {
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  packageId: string
  candidateId: string
  runId: string
  packageData: JsonRecord
  packageImageUrls: string[]
}) {
  const revisionId = uuid(input.packageData.preferredImageRevisionId)
  const manifestAssetIds = exactManifestAssetIds(input.packageData, 7)
  if (!revisionId || input.packageImageUrls.length !== 7
    || manifestAssetIds.length !== 7) return null
  const { data, error } = await input.supabase
    .from("ebay_same_day_pilot_image_revisions")
    .select("id,asset_ids,image_set_hash,status,strategy_version,revision_contract")
    .eq("id", revisionId)
    .eq("marketplace_account_key", input.accountKey)
    .eq("created_by", input.actorUserId)
    .eq("listing_package_id", input.packageId)
    .eq("candidate_id", input.candidateId)
    .eq("run_id", input.runId)
    .eq("status", "APPROVED")
    .maybeSingle()
  if (error) throw new Error("SAME_DAY_PUBLICATION_IMAGE_REVISION_READ_FAILED")
  const revisionAssetIds = Array.isArray(data?.asset_ids)
    ? data.asset_ids.map(uuid).filter(Boolean)
    : []
  if (!data || revisionAssetIds.length !== 7
    || new Set(revisionAssetIds).size !== 7
    || manifestAssetIds.some((id) => !revisionAssetIds.includes(id))
    || !/^[0-9a-f]{64}$/.test(text(data.image_set_hash, 80))) return null
  const referenceGuidedV3 = data.strategy_version === "VISUAL_STRATEGY_V3"
    && data.revision_contract === "REFERENCE_GUIDED_PRODUCT_GENERATION_V1"
  if (!validatedManifest(input.packageData, input.packageImageUrls,
    referenceGuidedV3)) return null
  return { id: revisionId, imageSetHash: text(data.image_set_hash, 80) }
}

async function approvedFinalV3ImageTransport(input: {
  supabase: SupabaseClient
  actorUserId: string
  packageId: string
  packageData: JsonRecord
  packageImageUrls: string[]
}) {
  if (input.packageImageUrls.length !== 7) return null
  const packageManifest = Array.isArray(input.packageData.imageAssetManifest)
    ? input.packageData.imageAssetManifest.map(record)
    : []
  const imageAuthorization = record(
    record(input.packageData.draftConfiguration).imageAuthorization,
  )
  const approvedImageUrls = exactSevenHttpsUrls(
    imageAuthorization.approvedImageUrls,
  )
  if (
    packageManifest.length !== 7
    || imageAuthorization.approved !== true
    || imageAuthorization.protectedManifestVerified !== true
    || number(imageAuthorization.protectedManifestAssetCount) !== 7
    || approvedImageUrls.length !== 7
    || text(imageAuthorization.approvedBy, 50) !== input.actorUserId
    || !Number.isFinite(Date.parse(text(imageAuthorization.approvedAt, 50)))
    || approvedImageUrls.some((url, index) =>
      input.packageImageUrls[index] !== url)
  ) return null

  const { data: review, error: reviewError } = await input.supabase
    .from("ebay_reference_guided_final_listing_review_previews")
    .select("id,revision_id,attempt_id,preview_hash,blockers,visual_phase,final_visual_set_locked,generation_controls_hidden,ready_for_unpublished_offer_authorization,provider_calls_snapshot,created_by")
    .eq("listing_package_id", input.packageId)
    .eq("created_by", input.actorUserId)
    .eq("visual_phase", "COMPLETED")
    .eq("final_visual_set_locked", true)
    .eq("generation_controls_hidden", true)
    .eq("ready_for_unpublished_offer_authorization", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (reviewError) {
    throw new Error("SAME_DAY_PUBLICATION_V3_FINAL_REVIEW_READ_FAILED")
  }
  if (
    !review
    || review.provider_calls_snapshot !== 8
    || !Array.isArray(review.blockers)
    || review.blockers.length > 0
    || !/^[0-9a-f]{64}$/.test(text(review.preview_hash, 80))
  ) return null

  const { data: transport, error: transportError } = await input.supabase
    .from("ebay_v3_publication_image_transports")
    .select("id,revision_id,attempt_id,listing_package_id,final_preview_id,preview_hash,transport_hash,assets,image_count,scope,status,created_by")
    .eq("listing_package_id", input.packageId)
    .eq("final_preview_id", review.id)
    .eq("attempt_id", review.attempt_id)
    .eq("preview_hash", review.preview_hash)
    .eq("status", "READY")
    .eq("image_count", 7)
    .eq("scope", "EBAY_US_UNPUBLISHED_OFFER_ONLY")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (transportError) {
    throw new Error("SAME_DAY_PUBLICATION_V3_TRANSPORT_READ_FAILED")
  }
  if (
    !transport
    || transport.revision_id !== review.revision_id
    || transport.created_by !== input.actorUserId
    || !/^[0-9a-f]{64}$/.test(text(transport.transport_hash, 80))
  ) return null

  let assets
  try {
    assets = validateV3PublicationAssets(transport.assets)
  } catch {
    return null
  }
  const exactContract = assets.every((asset, index) =>
    asset.position === index
    && asset.assetRole === REFERENCE_GUIDED_SEVEN_ASSET_ROLES[index]
    && asset.url === input.packageImageUrls[index]
    && packageManifest[index]?.position === asset.position
    && text(
      packageManifest[index]?.assetRole
        ?? packageManifest[index]?.referenceGuidedAssetRole,
      80,
    ) === asset.assetRole
    && text(packageManifest[index]?.sha256, 80) === asset.sha256
    && text(packageManifest[index]?.url) === asset.url
  )
  const expectedTransportHash = v3AuthorizationHash({
    version: "EBAY_V3_PUBLICATION_IMAGE_TRANSPORT_V1",
    previewHash: review.preview_hash,
    assets,
  })
  if (!exactContract || expectedTransportHash !== transport.transport_hash) {
    return null
  }
  return {
    finalPreviewId: text(review.id, 50),
    imageTransportId: text(transport.id, 50),
    previewHash: text(review.preview_hash, 80),
    transportHash: text(transport.transport_hash, 80),
  }
}

function normalizedAspects(value: unknown) {
  const output: Record<string, string> = {}
  for (const [name, rawValue] of Object.entries(record(value))) {
    const values = Array.isArray(rawValue)
      ? rawValue.map((entry) => text(entry, 100)).filter(Boolean)
      : [text(rawValue, 100)].filter(Boolean)
    if (text(name, 40) && values.length === 1) output[text(name, 40)] = values[0]
  }
  return output
}

function shippingConfiguration(value: unknown) {
  const shipping = record(value)
  const values = record(shipping.values)
  const measurement = (key: string) => record(values[key])
  const length = measurement("shippingLength")
  const width = measurement("shippingWidth")
  const height = measurement("shippingHeight")
  const weight = measurement("shippingWeight")
  return {
    dimensions: {
      length: number(length.value),
      width: number(width.value),
      height: number(height.value),
      unit: text(length.unit || width.unit || height.unit, 30).toUpperCase(),
    },
    weight: {
      value: number(weight.value),
      unit: text(weight.unit, 30).toUpperCase(),
    },
  }
}

export async function loadSameDayAuthorizedPublicationContext(input: {
  supabase: SupabaseClient
  accountKey: string
  actorUserId: string
  listingPackage: JsonRecord
  opportunity: JsonRecord
  now?: Date
  allowRecoverablePackageImages?: boolean
}): Promise<SameDayAuthorizedPublicationContext | null> {
  const packageId = uuid(input.listingPackage.id)
  const opportunityId = uuid(input.opportunity.id)
  const candidateKey = text(input.listingPackage.candidate_key, 300)
  const packageData = record(input.listingPackage.package_data)
  const binding = record(packageData.sameDayPilot)
  if (!Object.keys(binding).length) return null

  const runId = uuid(binding.runId)
  const candidateId = uuid(binding.candidateId)
  if (!packageId || !opportunityId || !runId || !candidateId || !candidateKey) {
    throw new Error("SAME_DAY_PUBLICATION_BINDING_INVALID")
  }
  const [candidateResult, runResult] = await Promise.all([
    input.supabase.from("ebay_same_day_pilot_candidates").select("*")
      .eq("id", candidateId).eq("run_id", runId)
      .eq("opportunity_id", opportunityId).eq("candidate_key", candidateKey)
      .maybeSingle(),
    input.supabase.from("ebay_same_day_pilot_runs")
      .select("id,marketplace_account_key,created_by")
      .eq("id", runId).eq("marketplace_account_key", input.accountKey)
      .eq("created_by", input.actorUserId).maybeSingle(),
  ])
  if (candidateResult.error || runResult.error
    || !candidateResult.data || !runResult.data) {
    throw new Error("SAME_DAY_PUBLICATION_SCOPE_INVALID")
  }
  const candidate = record(candidateResult.data)
  const handoffSummary = record(candidate.manual_handoff_package)
  const handoffPackage = record(handoffSummary.package)
  const imageSummary = record(candidate.image_package_summary)
  const packageImageUrls = exactSevenHttpsUrls(packageData.imageUrls)
  const approvedImageUrls = exactSevenHttpsUrls(imageSummary.publicUrls)
  const handoffImageUrls = exactSevenHttpsUrls(record(handoffPackage.images).urls)
  const approvedRevision = await approvedPreferredImageRevision({
    supabase: input.supabase,
    accountKey: input.accountKey,
    actorUserId: input.actorUserId,
    packageId,
    candidateId,
    runId,
    packageData,
    packageImageUrls,
  })
  const finalV3ImageTransport = await approvedFinalV3ImageTransport({
    supabase: input.supabase,
    actorUserId: input.actorUserId,
    packageId,
    packageData,
    packageImageUrls,
  })
  const legacyPackageImageUrls = exactHttpsUrls(packageData.imageUrls, 6)
  const legacyApprovedImageUrls = exactHttpsUrls(imageSummary.publicUrls, 6)
  const legacyHandoffImageUrls = exactHttpsUrls(
    record(handoffPackage.images).urls,
    6,
  )
  const recoverableMissingPackageImages =
    input.allowRecoverablePackageImages === true
    && Array.isArray(packageData.imageUrls)
    && packageData.imageUrls.length === 0
    && Array.isArray(packageData.imageAssetManifest)
    && packageData.imageAssetManifest.length === 0
  const recoverableLegacySixImageSet =
    input.allowRecoverablePackageImages === true
    && legacyApprovedImageUrls.length === 6
    && legacyHandoffImageUrls.length === 6
    && legacyApprovedImageUrls.every((url, index) =>
      legacyHandoffImageUrls[index] === url)
    && (
      recoverableMissingPackageImages
      || (
        legacyPackageImageUrls.length === 6
        && legacyPackageImageUrls.every((url, index) =>
          legacyApprovedImageUrls[index] === url)
        && exactManifestAssetIds(packageData, 6).length === 6
      )
    )
  const approvedRevisionImagesReady = Boolean(approvedRevision)
  const finalV3ImagesReady = Boolean(finalV3ImageTransport)
  const authoritativeSevenImageSetReady =
    approvedRevisionImagesReady || finalV3ImagesReady
  const packageImagesReady = authoritativeSevenImageSetReady || (
    packageImageUrls.length === 7
    && validatedManifest(packageData, packageImageUrls)
    && packageImageUrls.every((url, index) =>
      approvedImageUrls[index] === url && handoffImageUrls[index] === url)
  )
  const effectiveApprovedImageUrls = authoritativeSevenImageSetReady
    ? packageImageUrls
    : recoverableLegacySixImageSet ? legacyApprovedImageUrls : approvedImageUrls
  const effectiveHandoffImageUrls = authoritativeSevenImageSetReady
    ? packageImageUrls
    : recoverableLegacySixImageSet ? legacyHandoffImageUrls : handoffImageUrls
  const effectiveHandoffPackage = authoritativeSevenImageSetReady
    ? {
      ...handoffPackage,
      images: {
        ...record(handoffPackage.images),
        urls: packageImageUrls,
        count: 7,
        source: finalV3ImagesReady
          ? "REFERENCE_GUIDED_V3_FINAL_SET"
          : "LUNA_AUTHORIZED_DERIVATIVE_SET",
      },
      imageApproval: {
        ...record(handoffPackage.imageApproval),
        approved: true,
        approvedImageCount: 7,
        revisionId: approvedRevision?.id,
        imageSetHash: approvedRevision?.imageSetHash,
        finalPreviewId: finalV3ImageTransport?.finalPreviewId,
        imageTransportId: finalV3ImageTransport?.imageTransportId,
      },
    }
    : handoffPackage
  if (
    text(candidate.state, 80) !== "READY_FOR_MANUAL_PUBLICATION"
    || !READY_STATES.has(text(candidate.machine_state, 80))
    || strings(candidate.blockers).length > 0
    || text(handoffSummary.status, 80) !== "READY_FOR_MANUAL_PUBLICATION"
    || !/^[0-9a-f]{64}$/.test(text(handoffSummary.packageHash, 80))
    || uuid(handoffPackage.candidateId) !== candidateId
    || number(handoffPackage.quantity) !== 1
    || !number(handoffPackage.price) || !/^\d{1,12}$/.test(text(handoffPackage.categoryId, 20))
    || text(handoffPackage.conditionId, 20) !== "1000"
    || !text(handoffPackage.title, 80) || !text(handoffPackage.description, 100_000)
    || Object.keys(normalizedAspects(handoffPackage.itemSpecifics)).length === 0
    || imageSummary.approved !== true
    || uuid(imageSummary.listingPackageId) !== packageId
    || !uuid(imageSummary.controlId)
    || !effectiveApprovedImageUrls.length || !effectiveHandoffImageUrls.length
    || (!packageImagesReady && !recoverableLegacySixImageSet)
  ) throw new Error("SAME_DAY_PUBLICATION_PACKAGE_NOT_READY")

  const policies = record(effectiveHandoffPackage.businessPolicies)
  if (![policies.fulfillmentPolicyId, policies.paymentPolicyId, policies.returnPolicyId]
    .every((value) => /^[A-Za-z0-9_-]{1,80}$/.test(text(value, 80)))) {
    throw new Error("SAME_DAY_PUBLICATION_POLICIES_NOT_READY")
  }

  const productId = uuid(input.opportunity.market_radar_product_id)
  const supplierVariantId = text(candidate.supplier_variant_id, 300)
  if (!productId || !supplierVariantId
    || supplierVariantId !== text(input.opportunity.supplier_variant_id, 300)) {
    throw new Error("SAME_DAY_PUBLICATION_LUNA_IDENTITY_INVALID")
  }
  const { data: latestVariant, error: variantError } = await input.supabase
    .from("market_radar_latest_variants")
    .select("product_id,supplier_variant_id,sku,price,available,inventory_quantity,captured_at")
    .eq("source_key", "lunaportex").eq("product_id", productId)
    .eq("supplier_variant_id", supplierVariantId)
    .order("captured_at", { ascending: false }).limit(1).maybeSingle()
  if (variantError) throw new Error("SAME_DAY_PUBLICATION_LUNA_READ_FAILED")

  const economics = record(candidate.economics_summary)
  const lunaConfirmation = record(economics.lunaConfirmation)
  const operatorObservedAt = text(lunaConfirmation.confirmedAt, 50)
  const supplierObservedAt = text(latestVariant?.captured_at, 50)
  const sourceObservedAt = latestIso(supplierObservedAt, operatorObservedAt)
  const supplierObservedTimestamp = Date.parse(supplierObservedAt)
  const latestVariantIsNewest = Number.isFinite(supplierObservedTimestamp)
    && sourceObservedAt === new Date(supplierObservedTimestamp).toISOString()
  const confirmationStatusValid = [
    "AVAILABLE_QUANTITY_NOT_SHOWN",
    "AVAILABLE_EXACT_QUANTITY",
  ].includes(text(lunaConfirmation.status, 80))
  const confirmationSource = text(lunaConfirmation.source, 80)
  const operatorAvailable = confirmationStatusValid
    && confirmationSource === "OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE"
  const automatedPublicObservationAvailable = confirmationStatusValid
    && confirmationSource === "LUNA_PUBLIC_PRODUCT_JSON"
    && lunaConfirmation.automatedPublicPreflight === true
    && lunaConfirmation.confirmedByActorRecorded === false
    && /^[0-9a-f]{64}$/.test(text(lunaConfirmation.observationHash, 80))
    && text(lunaConfirmation.publicVariantId, 300) === supplierVariantId
    && text(lunaConfirmation.publicSku, 300) === text(candidate.supplier_sku, 300)
  const confirmedAvailable =
    operatorAvailable || automatedPublicObservationAvailable
  const available = latestVariantIsNewest
    ? latestVariant?.available === true
    : confirmedAvailable
  const currentSupplierCost = latestVariantIsNewest
    ? number(latestVariant?.price)
    : number(economics.confirmedLunaPrice ?? economics.supplierCost)
  const exactQuantity = latestVariantIsNewest
    ? number(latestVariant?.inventory_quantity)
    : lunaConfirmation.quantityVisible === true
      ? number(lunaConfirmation.confirmedQuantity)
      : 1
  const effectiveQuantity = exactQuantity !== null && exactQuantity > 0
    ? Math.trunc(exactQuantity)
    : available && lunaConfirmation.quantityVisible !== true ? 1 : 0
  const now = input.now ?? new Date()
  if (!available || !currentSupplierCost || effectiveQuantity < 1
    || !sourceObservedAt || !recent(sourceObservedAt, now)) {
    throw new Error("SAME_DAY_PUBLICATION_LUNA_RECHECK_REQUIRED")
  }

  const controlledRisk = record(economics.controlledRiskOverride)
  const isControlledRisk = controlledRisk.authorized === true
  if (isControlledRisk && (
    text(controlledRisk.version, 100) !== EBAY_CONTROLLED_RISK_OVERRIDE_VERSION
    || controlledRisk.promotionAllowed !== false
    || number(controlledRisk.minimumNetMarginPercent) !== 10
    || number(effectiveHandoffPackage.price) !== number(economics.operatorApprovedSalePrice)
  )) throw new Error("SAME_DAY_PUBLICATION_CONTROLLED_RISK_INVALID")

  const opportunity = {
    ...input.opportunity,
    supplier_available: true,
    supplier_inventory_quantity: effectiveQuantity,
    supplier_price: currentSupplierCost,
    supplier_sku: text(candidate.supplier_sku, 300),
    supplier_variant_id: supplierVariantId,
    supplier_snapshot_at: sourceObservedAt,
    last_scanned_at: sourceObservedAt,
  }
  const authorization = {
    validated: true as const,
    version: SAME_DAY_SELLER_OS_PUBLICATION_AUTHORIZATION_VERSION,
    runId,
    candidateId,
    listingPackageId: packageId,
    machineState: text(candidate.machine_state, 80),
    handoffPackageHash: text(handoffSummary.packageHash, 80),
    imageControlId: uuid(imageSummary.controlId),
    imageRevisionId: approvedRevision?.id ?? null,
    imageRevisionSetHash: approvedRevision?.imageSetHash ?? null,
    legacyImageRevisionRequired: recoverableLegacySixImageSet,
    sourceObservedAt,
    source: latestVariantIsNewest
      ? "LUNA_LATEST_VARIANT"
      : confirmationSource,
    quantityVisible: latestVariantIsNewest
      ? exactQuantity !== null
      : lunaConfirmation.quantityVisible === true,
    controlledRisk: isControlledRisk,
    finalHumanAuthorizationRequired: true,
    unattendedPublicationAllowed: false,
  }
  return {
    authorization,
    candidate,
    handoffPackage: effectiveHandoffPackage,
    opportunity,
    economicsConfig: isControlledRisk
      ? controlledRiskEconomicsConfig(economicsOverrides(economics))
      : undefined,
    sourceObservedAt,
  }
}

export function buildSameDayAuthorizedWorkspacePackage(input: {
  context: SameDayAuthorizedPublicationContext
  currentPackageData: JsonRecord
  pricing: JsonRecord
}) {
  const handoff = input.context.handoffPackage
  const current = input.currentPackageData
  const currentDraft = record(current.draftConfiguration)
  const currentPolicies = record(currentDraft.businessPolicies)
  const handoffPolicies = record(handoff.businessPolicies)
  const currentAuthorization = record(currentDraft.imageAuthorization)
  const currentPackageWeightAndSize = record(currentDraft.packageWeightAndSize)
  const handoffPackageWeightAndSize = shippingConfiguration(handoff.shipping)
  const currentImageUrls = exactSevenHttpsUrls(current.imageUrls)
  const handoffImageUrls = exactSevenHttpsUrls(record(handoff.images).urls)
  const legacyRevisionRequired =
    input.context.authorization.legacyImageRevisionRequired === true
  const recoverableCurrentImageUrls = legacyRevisionRequired
    ? exactHttpsUrls(current.imageUrls, 6)
    : []
  const recoverableHandoffImageUrls = legacyRevisionRequired
    ? exactHttpsUrls(record(handoff.images).urls, 6)
    : []
  const currentDimensions = record(currentPackageWeightAndSize.dimensions)
  const currentWeight = record(currentPackageWeightAndSize.weight)
  const currentMeasurementsProvided = [
    currentDimensions.length,
    currentDimensions.width,
    currentDimensions.height,
    currentWeight.value,
  ].some((value) => (number(value) ?? 0) > 0)
  const policy = (name: string) =>
    text(currentPolicies[name], 80) || text(handoffPolicies[name], 80)
  return {
    ...current,
    title: text(handoff.title, 80),
    categoryId: text(handoff.categoryId, 20),
    conditionId: text(handoff.conditionId, 20),
    categoryName: text(current.categoryName, 200),
    aspects: normalizedAspects(handoff.itemSpecifics),
    description: text(handoff.description, 100_000),
    imageUrls: currentImageUrls.length
      ? currentImageUrls
      : handoffImageUrls.length
        ? handoffImageUrls
        : recoverableCurrentImageUrls.length
          ? recoverableCurrentImageUrls
          : recoverableHandoffImageUrls,
    imageAssetManifest: current.imageAssetManifest,
    pricing: input.pricing,
    shipping: record(handoff.shipping),
    draftConfiguration: {
      ...currentDraft,
      quantity: 1,
      condition: "NEW",
      businessPolicies: {
        fulfillmentPolicyId: policy("fulfillmentPolicyId"),
        paymentPolicyId: policy("paymentPolicyId"),
        returnPolicyId: policy("returnPolicyId"),
      },
      packageWeightAndSize: currentMeasurementsProvided
        ? currentPackageWeightAndSize
        : handoffPackageWeightAndSize,
      imageAuthorization: {
        ...currentAuthorization,
        rightsBasis: "supplier_authorized",
        source: "luna",
      },
    },
    sameDayPilot: {
      ...record(current.sameDayPilot),
      authorizationVersion: SAME_DAY_SELLER_OS_PUBLICATION_AUTHORIZATION_VERSION,
      handoffPackageHash: input.context.authorization.handoffPackageHash,
      sourceObservedAt: input.context.sourceObservedAt,
      finalHumanAuthorizationRequired: true,
      unattendedPublicationAllowed: false,
    },
    controlledRiskPolicy: handoff.controlledRiskPolicy ?? null,
    evidenceSnapshot: {
      ...record(current.evidenceSnapshot),
      sameDayPilotAuthorization: input.context.authorization,
    },
  }
}
