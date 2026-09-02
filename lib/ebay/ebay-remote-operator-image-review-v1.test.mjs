import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

let implementation = readFileSync(
  "lib/ebay/ebay-remote-operator-image-review-v1.ts", "utf8")
implementation = implementation.replace(
  /import type \{ SupabaseClient \} from "@supabase\/supabase-js"\n\n/, "")
const compiled = ts.transpileModule(implementation, { compilerOptions: {
  module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022,
} }).outputText
const reviewModule = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`)

const operatorId = "11111111-1111-4111-8111-111111111111"
const revisionId = "22222222-2222-4222-8222-222222222222"
const candidateId = "33333333-3333-4333-8333-333333333333"
const packageId = "44444444-4444-4444-8444-444444444444"
const opportunityId = "55555555-5555-4555-8555-555555555555"
const listingLinkId = "66666666-6666-4666-8666-666666666666"
const assetIds = Array.from({ length: 7 }, (_, index) =>
  `77777777-7777-4777-8777-77777777777${index}`)

function query(result) {
  const value = {
    select: () => value, eq: () => value, in: () => value,
    order: () => value, limit: () => value,
    maybeSingle: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  return value
}

function asset(id, position) {
  return {
    id, created_by: operatorId, listing_package_id: packageId,
    status: "pending_review", asset_role: position === 1
      ? "lifestyle" : "gallery", position,
    output_storage_path: `proposal/${id}.jpg`, public_url: null,
    rights_evidence_confirmed: true, output_width: 1600,
    output_height: 1600,
    transformation: {
      slot: position === 0 ? "MAIN_WHITE_BACKGROUND" :
        position === 1 ? "LIFESTYLE_USE_CONTEXT" : `GALLERY_${position}`,
      productVariantFingerprint: "verified-product-variant",
      sourceVisualPolicy: "EXACT_AUTHORIZED_PIXELS_ONLY",
      authorizedSourceViewReused: true,
      verifiedFactsOnly: true,
      productRetouchGenerative: false,
      productDeformation: false,
      productOcclusion: false,
    },
    qa_result: { automaticStatus: "PASSED", productFidelityPassed: true,
      hiddenProductGeometryGenerated: false, blockers: [],
      textDerivedFromVerifiedFacts: true, contextualPropsPassed: true },
  }
}

function client({ unsafeAccessory = false } = {}) {
  const assets = assetIds.map(asset)
  if (unsafeAccessory) assets[1].qa_result.contextualPropsPassed = false
  const rows = {
    ebay_same_day_pilot_image_revisions: [{ id: revisionId,
      created_by: operatorId, candidate_id: candidateId,
      listing_package_id: packageId, status: "PENDING_REVIEW", asset_ids: assetIds,
      asset_manifest: {}, completed_at: "2026-09-02T00:00:00.000Z",
      created_at: "2026-09-02T00:00:00.000Z" }],
    ebay_same_day_pilot_candidates: [{ id: candidateId, opportunity_id: opportunityId,
      candidate_key: "candidate-key" }],
    ebay_manual_listing_links: [{ opportunity_id: opportunityId,
      candidate_key: "candidate-key", ebay_item_id: "366600000001",
      verification_status: "verified",
      verification_method: "EBAY_TRADING_GET_ITEM_READONLY",
      connector_listing_status: "active", connector_listing_id: listingLinkId,
      connector_ebay_sku: "SKU-1", created_by: operatorId }],
    ebay_listing_image_assets: assets,
    ebay_remote_operator_visual_review_events: [],
  }
  const inserted = []
  return {
    inserted,
    from(table) {
      return {
        select: () => query({ data: rows[table] ?? [], error: null }),
        insert(input) {
          inserted.push(input)
          return { select: () => query({ data: {
            decision: input.decision,
            reviewed_at: "2026-09-02T01:00:00.000Z",
          }, error: null }) }
        },
      }
    },
    storage: { from: () => ({ createSignedUrl: async (path) => ({
      data: { signedUrl: `https://signed.example/${path}` }, error: null,
    }) }) },
  }
}

test("prepared image review exposes only an exact, guarded Actual vs Propuesta set", async () => {
  const supabase = client()
  const proposals = await reviewModule.readRemoteOperatorPreparedImageProposalsV1({
    supabase, accountKey: `seller:${"a".repeat(64)}`,
    operatorUserId: operatorId,
  })
  assert.equal(proposals.length, 1)
  assert.equal(proposals[0].ebayItemId, "366600000001")
  assert.match(proposals[0].proposedMainImageUrl, /^https:\/\/signed\.example/)
  assert.match(proposals[0].proposedLifestyleImageUrl,
    /^https:\/\/signed\.example/)
  assert.deepEqual(proposals[0].guards, {
    pipelineExactProductIdentity: true,
    noFalseFeatures: true,
    noUnprovenAccessories: true,
    productNotMisrepresented: true,
  })
  assert.equal("assetIds" in proposals[0], false)
  assert.equal("fingerprint" in proposals[0], false)

  const recorded = await reviewModule.recordRemoteOperatorImageReviewV1({
    supabase, accountKey: `seller:${"a".repeat(64)}`,
    operatorUserId: operatorId, proposal: proposals[0], decision: "APPROVE",
  })
  assert.equal(recorded.marketplaceWrites, 0)
  assert.equal(supabase.inserted[0].new_listing_publications, 0)
  assert.equal(supabase.inserted[0].listing_ends, 0)
  assert.equal(supabase.inserted[0].promotion_spend_writes, 0)
})

test("prepared image review fails closed when an accessory guard is not proven", async () => {
  const supabase = client({ unsafeAccessory: true })
  const proposals = await reviewModule.readRemoteOperatorPreparedImageProposalsV1({
    supabase, accountKey: `seller:${"a".repeat(64)}`,
    operatorUserId: operatorId,
  })
  assert.equal(proposals[0].guards.noUnprovenAccessories, false)
  await assert.rejects(reviewModule.recordRemoteOperatorImageReviewV1({
    supabase, accountKey: `seller:${"a".repeat(64)}`,
    operatorUserId: operatorId, proposal: proposals[0], decision: "APPROVE",
  }), /REMOTE_OPERATOR_IMAGE_REVIEW_GUARDS_REQUIRED/)
  assert.equal(supabase.inserted.length, 0)
})
