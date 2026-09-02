import type { SupabaseClient } from "@supabase/supabase-js"

const STAGING_BUCKET = "ebay-listing-image-staging"
const EXPECTED_ASSET_COUNT = 7

type JsonRecord = Record<string, unknown>

export type RemoteOperatorPreparedImageProposalV1 = Readonly<{
  proposalId: string
  ebayItemId: string
  preparedAt: string
  proposedMainImageUrl: string
  proposedLifestyleImageUrl: string | null
  proposedImageUrls: readonly string[]
  guards: Readonly<{
    pipelineExactProductIdentity: boolean
    noFalseFeatures: boolean
    noUnprovenAccessories: boolean
    productNotMisrepresented: boolean
  }>
  reviewDecision: "APPROVE" | "REJECT" | null
  reviewedAt: string | null
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().slice(0, maximum) : ""
}

function uuid(value: unknown) {
  const normalized = text(value, 40)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : ""
}

function exactAssetIds(value: unknown) {
  if (!Array.isArray(value) || value.length !== EXPECTED_ASSET_COUNT) return []
  const ids = value.map(uuid)
  return ids.every(Boolean) && new Set(ids).size === EXPECTED_ASSET_COUNT
    ? ids : []
}

function blockersEmpty(value: unknown) {
  return Array.isArray(value) && value.length === 0
}

function visualGuards(assets: readonly JsonRecord[]) {
  const transformations = assets.map((asset) => record(asset.transformation))
  const qaRows = assets.map((asset) => record(asset.qa_result))
  const productFingerprints = new Set(transformations.map((row) =>
    text(row.productVariantFingerprint, 200)).filter(Boolean))
  const sourcePolicyExact = transformations.every((row) =>
    row.sourceVisualPolicy === "EXACT_AUTHORIZED_PIXELS_ONLY" &&
    row.authorizedSourceViewReused === true)
  const productFidelityPassed = qaRows.every((row) =>
    row.automaticStatus === "PASSED" &&
    row.productFidelityPassed === true &&
    row.hiddenProductGeometryGenerated === false &&
    blockersEmpty(row.blockers))
  return Object.freeze({
    pipelineExactProductIdentity:
      productFingerprints.size === 1 && sourcePolicyExact,
    noFalseFeatures: productFidelityPassed &&
      transformations.every((row) => row.verifiedFactsOnly === true) &&
      qaRows.every((row) => row.textDerivedFromVerifiedFacts === true),
    noUnprovenAccessories: productFidelityPassed && qaRows.every((row) =>
      row.contextualPropsPassed === true),
    productNotMisrepresented: productFidelityPassed &&
      transformations.every((row) =>
        row.productRetouchGenerative !== true &&
        row.productDeformation !== true &&
        row.productOcclusion !== true),
  })
}

function lifestyleAsset(asset: JsonRecord) {
  const slot = text(record(asset.transformation).slot, 100).toUpperCase()
  return text(asset.asset_role, 40).toLowerCase() === "lifestyle" ||
    slot.includes("LIFESTYLE") || slot.includes("USE_CONTEXT")
}

export async function readRemoteOperatorPreparedImageProposalsV1(input: {
  supabase: SupabaseClient
  accountKey: string
  operatorUserId: string
}): Promise<readonly RemoteOperatorPreparedImageProposalV1[]> {
  const { data: revisionRows, error: revisionError } = await input.supabase
    .from("ebay_same_day_pilot_image_revisions")
    .select("id,created_by,candidate_id,listing_package_id,status,asset_ids,asset_manifest,completed_at,created_at")
    .eq("marketplace_account_key", input.accountKey)
    .eq("status", "PENDING_REVIEW")
    .order("completed_at", { ascending: false })
    .limit(20)
  if (revisionError) {
    throw new Error("REMOTE_OPERATOR_IMAGE_PROPOSAL_READ_FAILED")
  }
  const revisions = (revisionRows ?? []).map(record).filter((row) =>
    uuid(row.id) && uuid(row.created_by) && uuid(row.candidate_id) &&
    uuid(row.listing_package_id) && exactAssetIds(row.asset_ids).length > 0)
  if (!revisions.length) return Object.freeze([])

  const candidateIds = revisions.map((row) => uuid(row.candidate_id))
  const { data: candidateRows, error: candidateError } = await input.supabase
    .from("ebay_same_day_pilot_candidates")
    .select("id,opportunity_id,candidate_key")
    .in("id", candidateIds)
  if (candidateError) {
    throw new Error("REMOTE_OPERATOR_IMAGE_CANDIDATE_READ_FAILED")
  }
  const candidates = (candidateRows ?? []).map(record)
  const opportunityIds = [...new Set(candidates.map((row) =>
    uuid(row.opportunity_id)).filter(Boolean))]
  if (!opportunityIds.length) return Object.freeze([])

  const { data: linkRows, error: linkError } = await input.supabase
    .from("ebay_manual_listing_links")
    .select("opportunity_id,candidate_key,ebay_item_id,verification_status,verification_method,connector_listing_status,connector_listing_id,connector_ebay_sku,created_by")
    .eq("account_key", input.accountKey)
    .eq("marketplace_id", "EBAY_US")
    .in("opportunity_id", opportunityIds)
  if (linkError) throw new Error("REMOTE_OPERATOR_IMAGE_LINK_READ_FAILED")
  const links = (linkRows ?? []).map(record)

  const allAssetIds = [...new Set(revisions.flatMap((row) =>
    exactAssetIds(row.asset_ids)))]
  const { data: assetRows, error: assetError } = await input.supabase
    .from("ebay_listing_image_assets")
    .select("id,created_by,listing_package_id,status,asset_role,position,output_storage_path,public_url,rights_evidence_confirmed,output_width,output_height,transformation,qa_result")
    .eq("account_key", input.accountKey)
    .in("id", allAssetIds)
  if (assetError) throw new Error("REMOTE_OPERATOR_IMAGE_ASSET_READ_FAILED")
  const assets = (assetRows ?? []).map(record)

  const proposalIds = revisions.map((row) => uuid(row.id))
  const { data: reviewRows, error: reviewError } = await input.supabase
    .from("ebay_remote_operator_visual_review_events")
    .select("proposal_revision_id,decision,reviewed_at")
    .eq("marketplace_account_key", input.accountKey)
    .eq("operator_user_id", input.operatorUserId)
    .in("proposal_revision_id", proposalIds)
  if (reviewError) {
    throw new Error("REMOTE_OPERATOR_IMAGE_REVIEW_HISTORY_READ_FAILED")
  }
  const reviews = (reviewRows ?? []).map(record)

  const proposals = await Promise.all(revisions.map(async (revision) => {
    const candidate = candidates.find((row) =>
      uuid(row.id) === uuid(revision.candidate_id))
    if (!candidate) return null
    const link = links.find((row) =>
      uuid(row.opportunity_id) === uuid(candidate.opportunity_id) &&
      text(row.candidate_key, 300) === text(candidate.candidate_key, 300) &&
      uuid(row.created_by) === uuid(revision.created_by))
    const ebayItemId = text(link?.ebay_item_id, 20)
    const exactLink = Boolean(link && /^\d{9,20}$/.test(ebayItemId) &&
      link.verification_status === "verified" &&
      link.verification_method === "EBAY_TRADING_GET_ITEM_READONLY" &&
      link.connector_listing_status === "active" &&
      uuid(link.connector_listing_id) && text(link.connector_ebay_sku, 80))
    if (!exactLink) return null
    const orderedIds = exactAssetIds(revision.asset_ids)
    const revisionAssets = orderedIds.map((id) => assets.find((row) =>
      uuid(row.id) === id)).filter(Boolean) as JsonRecord[]
    if (revisionAssets.length !== EXPECTED_ASSET_COUNT ||
        revisionAssets.some((asset) =>
          uuid(asset.created_by) !== uuid(revision.created_by) ||
          uuid(asset.listing_package_id) !== uuid(revision.listing_package_id) ||
          !["pending_review", "approved"].includes(text(asset.status, 30)) ||
          asset.rights_evidence_confirmed !== true ||
          Number(asset.output_width) !== 1600 ||
          Number(asset.output_height) !== 1600)) return null
    const urls = await Promise.all(revisionAssets.map(async (asset) => {
      const publicUrl = text(asset.public_url, 2_000)
      if (publicUrl.startsWith("https://")) return publicUrl
      const path = text(asset.output_storage_path, 1_000)
      if (!path || text(asset.status, 30) !== "pending_review") return ""
      const { data, error } = await input.supabase.storage
        .from(STAGING_BUCKET).createSignedUrl(path, 300)
      if (error) return ""
      const signedUrl = text(data?.signedUrl, 2_000)
      return signedUrl.startsWith("https://") ? signedUrl : ""
    }))
    if (urls.some((url) => !url)) return null
    const guards = visualGuards(revisionAssets)
    const mainIndex = revisionAssets.findIndex((asset) =>
      Number(asset.position) === 0 ||
      text(record(asset.transformation).slot, 100) ===
        "MAIN_WHITE_BACKGROUND")
    const lifestyleIndex = revisionAssets.findIndex(lifestyleAsset)
    if (mainIndex < 0 || lifestyleIndex < 0) return null
    const review = reviews.find((row) =>
      uuid(row.proposal_revision_id) === uuid(revision.id))
    const decision = ["APPROVE", "REJECT"].includes(text(review?.decision, 20))
      ? text(review?.decision, 20) as "APPROVE" | "REJECT" : null
    return Object.freeze({
      proposalId: uuid(revision.id),
      ebayItemId,
      preparedAt: text(revision.completed_at ?? revision.created_at, 80),
      proposedMainImageUrl: urls[mainIndex],
      proposedLifestyleImageUrl: urls[lifestyleIndex],
      proposedImageUrls: Object.freeze(urls),
      guards: Object.freeze({
        ...guards,
        pipelineExactProductIdentity:
          exactLink && guards.pipelineExactProductIdentity,
      }),
      reviewDecision: decision,
      reviewedAt: decision ? text(review?.reviewed_at, 80) || null : null,
    })
  }))
  return Object.freeze(proposals.filter(Boolean) as
    RemoteOperatorPreparedImageProposalV1[])
}

export async function recordRemoteOperatorImageReviewV1(input: {
  supabase: SupabaseClient
  accountKey: string
  operatorUserId: string
  proposal: RemoteOperatorPreparedImageProposalV1
  decision: "APPROVE" | "REJECT"
}) {
  const guards = input.proposal.guards
  if (!uuid(input.operatorUserId) || !uuid(input.proposal.proposalId) ||
      !/^\d{9,20}$/.test(input.proposal.ebayItemId) ||
      !guards.pipelineExactProductIdentity || !guards.noFalseFeatures ||
      !guards.noUnprovenAccessories || !guards.productNotMisrepresented) {
    throw new Error("REMOTE_OPERATOR_IMAGE_REVIEW_GUARDS_REQUIRED")
  }
  const insert = {
    marketplace_account_key: input.accountKey,
    operator_user_id: input.operatorUserId,
    proposal_revision_id: input.proposal.proposalId,
    ebay_item_id: input.proposal.ebayItemId,
    decision: input.decision,
    exact_product_identity: true,
    no_false_features: true,
    no_unproven_accessories: true,
    product_not_misrepresented: true,
    marketplace_writes: 0,
    new_listing_publications: 0,
    listing_ends: 0,
    promotion_spend_writes: 0,
  }
  const { data, error } = await input.supabase
    .from("ebay_remote_operator_visual_review_events")
    .insert(insert).select("decision,reviewed_at").maybeSingle()
  if (!error && data) return Object.freeze({
    decision: data.decision as "APPROVE" | "REJECT",
    reviewedAt: String(data.reviewed_at), marketplaceWrites: 0 as const,
  })
  const { data: existing, error: existingError } = await input.supabase
    .from("ebay_remote_operator_visual_review_events")
    .select("decision,reviewed_at")
    .eq("marketplace_account_key", input.accountKey)
    .eq("operator_user_id", input.operatorUserId)
    .eq("proposal_revision_id", input.proposal.proposalId)
    .maybeSingle()
  if (existingError || !existing || existing.decision !== input.decision) {
    throw new Error("REMOTE_OPERATOR_IMAGE_REVIEW_WRITE_FAILED")
  }
  return Object.freeze({ decision: existing.decision as "APPROVE" | "REJECT",
    reviewedAt: String(existing.reviewed_at), marketplaceWrites: 0 as const })
}
