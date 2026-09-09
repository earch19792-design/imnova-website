import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { startMayelSavedImageDraftV1, completeMayelSavedImageDraftV1 } from "./mayel-saved-image-draft-v1.ts"
import { confirmMayelImageQueueV1 } from "./mayel-image-workspace-v1.ts"

const hash = bytes => createHash("sha256").update(bytes).digest("hex")
const bytes = Buffer.from("normalized-private-draft")
const origin = { itemId: "366582671136", assetId: "asset", experimentId: "experiment", sourceType: "SELLER_OS_ASSISTANT_IMAGE_VARIANT",
  sourceImageUrl: "https://i.ebayimg.com/images/g/same/s-l1600.png", outputSha256: "a".repeat(64) }
function fixture() {
  const tables = {
    ebay_mayel_visual_tasks_v1: [{ id: "task", marketplace_account_key: "account", ebay_item_id: origin.itemId,
      assigned_operator_user_id: "operator", status: "PROMPT_READY", selection_signal: { existingSignal: true },
      current_image_set: ["https://i.ebayimg.com/images/g/same/s-l140.png", "https://example.com/secondary.jpg"],
      source_image_set_digest: "sha256:" + "b".repeat(64), visual_manifest_digest: null, updated_at: "2026-09-06T11:00:00Z" }],
    ebay_listing_image_assets: [], ebay_mayel_visual_phase_b_executions_v1: [],
  }
  const writes = []
  const db = { from(table) {
    const filters = []; let patch
    const run = () => {
      const rows = tables[table].filter(row => filters.every(([k,v]) => row[k] === v))
      if (patch) { writes.push({ table, patch }); for (const row of rows) Object.assign(row, structuredClone(patch)) }
      return { data: structuredClone(rows), error: null }
    }
    const chain = { select: () => chain, limit: () => chain,
      eq: (k,v) => { filters.push([k,v]); return chain }, is: (k,v) => { filters.push([k,v]); return chain },
      update: p => { patch = p; return chain }, maybeSingle: async () => { const r = run(); return { ...r, data: r.data[0] ?? null } },
      then: resolve => Promise.resolve(run()).then(resolve) }
    return chain
  }, storage: { from(bucket) { assert.equal(bucket, "ebay-listing-image-staging"); return {
    download: async () => ({ data: new Blob([bytes]), error: null }),
  } } } }
  return { tables, writes, db, input: { supabase: db, accountKey: "account", taskId: "task", actorUserId: "owner", owner: true, origin } }
}
function addAsset(f, overrides = {}) {
  f.tables.ebay_listing_image_assets.push({ id: origin.assetId, account_key: "account", mayel_visual_task_id: "task",
    uploaded_by: "owner", status: "pending_review", source_type: origin.sourceType, source_sha256: origin.outputSha256,
    output_sha256: hash(bytes), output_storage_path: "private/draft.jpg", output_width: 1600, output_height: 1600,
    output_bytes: bytes.length, qa_result: { automaticStatus: "PASSED" }, provenance: { originalProvenance: true }, ...overrides })
  f.tables.ebay_mayel_visual_tasks_v1[0].status = "MAYEL_REVIEW_PENDING"
}
test("OWNER takes only the exact unused task; other operators and active work stay protected", async () => {
  for (const mutate of [f => { f.input.owner = false }, f => { f.input.accountKey = "other" },
    f => { f.tables.ebay_mayel_visual_tasks_v1[0].visual_manifest_digest = "approved-manifest" },
    f => { f.tables.ebay_mayel_visual_tasks_v1[0].current_image_set = ["https://example.com/another.jpg"] },
    f => { f.tables.ebay_listing_image_assets.push({ id: "colleague-asset", account_key: "account", mayel_visual_task_id: "task" }) },
    f => { f.tables.ebay_mayel_visual_phase_b_executions_v1.push({ id: "execution", marketplace_account_key: "account", visual_task_id: "task" }) }]) {
    const f = fixture(); mutate(f)
    await assert.rejects(startMayelSavedImageDraftV1(f.input))
    assert.equal(f.writes.length, 0)
  }
  const f = fixture(); const result = await startMayelSavedImageDraftV1(f.input)
  assert.equal(f.tables.ebay_mayel_visual_tasks_v1[0].assigned_operator_user_id, "owner")
  assert.equal(result.receipt.previousAssignee, "operator")
  assert.equal(result.receipt.assignmentAuthority, "OWNER_EXPLICIT_PREPARE")
  assert.equal(result.receipt.phase, "DRAFT_PREPARING")
  assert.equal(f.tables.ebay_mayel_visual_tasks_v1[0].selection_signal.existingSignal, true)
  await assert.rejects(startMayelSavedImageDraftV1(f.input), /ALREADY_RUNNING/)
})
test("draft completion verifies bytes and QA, preserves the secondary gallery, and cannot enqueue publication", async () => {
  const f = fixture(); const started = await startMayelSavedImageDraftV1(f.input); addAsset(f)
  const result = await completeMayelSavedImageDraftV1({ ...f.input, executionId: started.receipt.executionId })
  assert.equal(result.phase, "DRAFT_PREVIEW_READY"); assert.equal(result.imageQaPassed, true)
  assert.equal(result.manifest.proposedOrderedImages[0].assetId, origin.assetId)
  assert.equal(result.manifest.proposedOrderedImages[1].url, "https://example.com/secondary.jpg")
  assert.equal(result.manifestDigest, "sha256:" + hash(JSON.stringify(result.manifest)))
  assert.equal(result.marketplaceWrites, 0); assert.equal(result.publishAuthorized, false)
  assert.equal(result.humanPublicationReviewCompleted, false)
  assert.equal(f.tables.ebay_mayel_visual_tasks_v1[0].visual_manifest_digest, null)
  assert.equal(f.tables.ebay_mayel_visual_tasks_v1[0].status, "MAYEL_REVIEW_PENDING")
  assert.equal(f.tables.ebay_listing_image_assets[0].status, "pending_review")
  assert.equal(f.tables.ebay_listing_image_assets[0].provenance.originalProvenance, true)
  const count = f.writes.length
  const replay = await startMayelSavedImageDraftV1(f.input)
  assert.equal(replay.completed, true); assert.equal(replay.receipt.executionId, result.executionId)
  assert.equal(f.writes.length, count)
  assert.ok(f.writes.every(w => !('visual_manifest_digest' in w.patch) && !('visual_manifest' in w.patch)))
  await assert.rejects(confirmMayelImageQueueV1({ ...f.input, itemId: origin.itemId, assetId: origin.assetId,
    replaceMainImage: true, expectedSourceDigest: f.tables.ebay_mayel_visual_tasks_v1[0].source_image_set_digest,
    humanQa: {} }), /DRAFT_ONLY_NO_PUBLICATION_AUTHORITY/)
  assert.equal(f.writes.length, count)
})
test("concurrent prepare requests cannot both claim the same task", async () => {
  const f = fixture()
  const results = await Promise.allSettled([startMayelSavedImageDraftV1(f.input), startMayelSavedImageDraftV1(f.input)])
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1)
  assert.equal(results.filter(r => r.status === "rejected").length, 1)
})
test("failed automatic QA, wrong bytes, or a changed actor cannot produce a completed draft receipt", async () => {
  for (const overrides of [{ qa_result: { automaticStatus: "FAILED" } }, { output_sha256: "c".repeat(64) },
    { uploaded_by: "other" }, { source_sha256: "d".repeat(64) }, { output_bytes: 0 }]) {
    const f = fixture(); const start = await startMayelSavedImageDraftV1(f.input); addAsset(f, overrides)
    await assert.rejects(completeMayelSavedImageDraftV1({ ...f.input, executionId: start.receipt.executionId }))
    assert.equal(f.tables.ebay_mayel_visual_tasks_v1[0].selection_signal.savedImageDraft.phase, "DRAFT_PREPARING")
    assert.equal(f.writes.length, 1)
  }
})
