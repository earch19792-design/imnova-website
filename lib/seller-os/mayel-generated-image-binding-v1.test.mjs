import { registerHooks } from "node:module"
import { visualAssetSyncKeyV1, VISUAL_OWNER_SYNC_CONFIRMATION } from './visual-asset-sync-state-v1.ts'
import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { validateMayelGeneratedImageV1, assertMayelGeneratedBytesV1, replaceMayelHeroIntentV1, isMayelGeneratedSourceBoundV1 } from "./mayel-generated-image-binding-v1.ts"
import { readMayelImageWorkspaceV1 } from "./mayel-image-workspace-v1.ts"

registerHooks({resolve(s,c,n){if(s==='server-only')return {url:'data:text/javascript,export{}',shortCircuit:true};return n(s,c)}})
const experimentId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
const assetId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"
const itemId = "366643122092"
function fixture() {
  const variant = { assetId, status: "EXPERIMENT_READY", outputStoragePath: `seller-os-visual-variants/${itemId}/${experimentId}/variant-a.png`,
    outputSha256: "a".repeat(64), variantRejected: false, productTruthPreserved: true, protectedLayerRoundtripExact: true,
    sourceImageFullResolutionCertified: true, backgroundQa: { passed: true } }
  return { account_key: "account", marketplace: "EBAY_US", ebay_item_id: itemId, experiment_id: experimentId,
    experiment_type: "HERO_VISUAL_VARIANT", lifecycle_status: "DRAFT", created_at: "2026-09-06T09:00:00Z",
    baseline_evidence_ref: { sellerOsVisualVariant: { contractVersion: "SELLER_OS_VISUAL_VARIANT_V1_2026_08_29", experimentId,
      ebayItemId: itemId, sourceHash: "b".repeat(64), sourceImageUrl: "https://example.com/authorized.jpg", variants: [variant] } } }
}
const validate = row => validateMayelGeneratedImageV1({ accountKey: "account", itemId, experimentId, assetId, row })
test("certified eBay size derivatives bind the same source without accepting other pictures or hosts", () => {
  const source = "https://i.ebayimg.com/images/g/same/s-l1600.png"
  assert.equal(isMayelGeneratedSourceBoundV1("https://i.ebayimg.com/images/g/same/s-l140.png", source), true)
  assert.equal(isMayelGeneratedSourceBoundV1("https://i.ebayimg.com/images/g/other/s-l140.png", source), false)
  assert.equal(isMayelGeneratedSourceBoundV1("https://i.ebayimg.com.evil.test/images/g/same/s-l140.png", source), false)
  assert.equal(isMayelGeneratedSourceBoundV1("https://i.ebayimg.com/images/g/same/s-l140.jpg", source), false)
  assert.equal(isMayelGeneratedSourceBoundV1("https://i.ebayimg.com/images/g/same/s-l140.png?different=true", source), false)
})
test("durable generated image retains exact source and never uses supplied remote storage", () => {
  const row = fixture()
  assert.equal(validate(row).assetId, assetId)
  for (const key of ["account_key", "marketplace", "ebay_item_id", "experiment_id"]) {
    assert.throws(() => validate({ ...row, [key]: "other" }), /BINDING_OR_QA_INVALID/)
  }
  row.baseline_evidence_ref.sellerOsVisualVariant.variants[0].outputStoragePath = "../../other-account.png"
  assert.throws(() => validate(row), /BINDING_OR_QA_INVALID/)
})
test("incomplete or rejected generation never becomes a reviewable asset", () => {
  for (const key of ["productTruthPreserved", "protectedLayerRoundtripExact", "sourceImageFullResolutionCertified"]) {
    const row = fixture(); row.baseline_evidence_ref.sellerOsVisualVariant.variants[0][key] = false
    assert.throws(() => validate(row), /BINDING_OR_QA_INVALID/)
  }
  const row = fixture(); row.baseline_evidence_ref.sellerOsVisualVariant.variants[0].backgroundQa.passed = false
  assert.throws(() => validate(row), /BINDING_OR_QA_INVALID/)
})
test("private bytes must match durable generator hash before normalization", () => {
  const bytes = Buffer.from("fixture")
  assertMayelGeneratedBytesV1(bytes, createHash("sha256").update(bytes).digest("hex"))
  assert.throws(() => assertMayelGeneratedBytesV1(bytes, "a".repeat(64)), /BYTES_MISMATCH/)
  assert.throws(() => assertMayelGeneratedBytesV1(Buffer.alloc(0), "a".repeat(64)), /BYTES_MISMATCH/)
})
test("replacement preserves secondary ordering and replay never duplicates the new hero", () => {
  const before = [{ kind: "CURRENT_OFFICIAL", publicUrl: "old" }, { kind: "MAYEL_ASSET", assetId: "secondary" }, { kind: "CURRENT_OFFICIAL", publicUrl: "detail" }]
  const after = replaceMayelHeroIntentV1(before, assetId)
  assert.deepEqual(after, [{ kind: "MAYEL_ASSET", assetId }, ...before.slice(1)])
  assert.deepEqual(replaceMayelHeroIntentV1(after, assetId), after)
})
function dbForWorkspace(phase, approved = true) {
  const canonical = { id: assetId, mayel_visual_task_id: "task", status: "approved", output_sha256: "a".repeat(64), source_image_set_digest: "sources", product_truth_digest: "truth", mayel_approval_status: "APPROVED", qa_result: { automaticStatus: "PASSED", humanReview: { decision: "APPROVE" } } }
  if (approved) canonical.owner_sync_approval = { confirmation: VISUAL_OWNER_SYNC_CONFIRMATION, assetId, generation: `${assetId}:${canonical.output_sha256}`, idempotencyKey: visualAssetSyncKeyV1(canonical), ownerUserId: "00000000-0000-4000-8000-000000000001", approvedAt: "2026-09-09T00:00:00Z", sourceImageSetDigest: "sources", productTruthDigest: "truth" }
  const calls = []
  const db = { from(table) { calls.push(table)
    const data = table === "ebay_listing_experiments_v1" ? [fixture()] : table === "ebay_mayel_visual_tasks_v1" ? [{
      id: "task", ebay_item_id: itemId, assigned_operator_user_id: "actor", visual_manifest_digest: "manifest",
      source_image_set_digest: "sources", product_truth_digest: "truth", current_image_set: ["https://example.com/old.jpg"], status: "OWNER_PREVIEW_READY",
      visual_manifest: { proposedOrderedImages: [{ assetId }] },
    }] : table === "ebay_listing_image_assets" ? [canonical] : table === "seller_os_ipad_outbox_v1" || table === "seller_os_mayel_optimization_grants_v1" ? [] : [
      { visual_task_id: "task", visual_manifest_digest: "another-manifest", phase: "APPLIED_AND_OFFICIALLY_VERIFIED" },
      ...(phase ? [{ visual_task_id: "task", visual_manifest_digest: "manifest", phase }] : []) ]
    const chain = { async maybeSingle(){return {data:data[0]??null,error:null}}, then(resolve) { return Promise.resolve({ data, error: null }).then(resolve) } }
    for (const name of ["select", "eq", "neq", "in", "is", "order", "limit"]) chain[name] = () => chain
    return chain
  }, storage: { from() { return { createSignedUrl: async () => ({ data: { signedUrl: "https://example.com/private-signed" } }) } } } }
  return { db, calls }
}
test("offline reload resolves queued/applied only for the exact manifest without Trading or generation", async () => {
  const original = globalThis.fetch; globalThis.fetch = () => { throw Error("NETWORK_FORBIDDEN") }
  try {
    const { db, calls } = dbForWorkspace(null)
    const first = await readMayelImageWorkspaceV1({ supabase: db, accountKey: "account", actorUserId: "actor", itemIds: [itemId] })
    assert.equal(first.proposals[0].status, "QUEUED")
    assert.equal(first.tradingCalls, 0); assert.equal(calls.length, 6)
    const verified = dbForWorkspace("APPLIED_AND_OFFICIALLY_VERIFIED")
    const next = await readMayelImageWorkspaceV1({ supabase: verified.db, accountKey: "account", actorUserId: "actor", itemIds: [itemId] })
    assert.equal(next.proposals[0].status, "APPLIED")
    assert.equal(next.marketplaceWrites, 0)
    const pending = dbForWorkspace(null, false)
    const unapproved = await readMayelImageWorkspaceV1({ supabase: pending.db, accountKey: "account", actorUserId: "actor", itemIds: [itemId] })
    assert.equal(unapproved.proposals[0].status, "DRAFT")
    assert.equal(unapproved.proposals[0].sync.state, "OWNER_APPROVAL_REQUIRED")
  } finally { globalThis.fetch = original }
})
