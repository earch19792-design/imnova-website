import assert from "node:assert/strict"
import test from "node:test"
import sharp from "sharp"
import { readFileSync } from "node:fs"

import {
  assertReferenceGuidedProviderAllowed,
  createDeterministicPrimaryMain,
  createDeterministicPrimaryMainPreview,
  createDeterministicPositionOneCrop,
  referenceGuidedRenderingContract,
} from "./reference-guided-deterministic-source-crop.ts"

test("material detail overrides every global category signal", () => {
  const contract = referenceGuidedRenderingContract("MATERIAL_AND_FINISH_DETAIL")
  assert.equal(contract.renderingMode, "DETERMINISTIC_SOURCE_CROP_V1")
  assert.equal(contract.providerAllowed, false)
  assert.equal(contract.generatedContextAllowed, false)
  assert.deepEqual(contract.compatibleCategorySignals, [])
  assert.throws(() => assertReferenceGuidedProviderAllowed(
    "MATERIAL_AND_FINISH_DETAIL"),
  /REFERENCE_GUIDED_POSITION_REQUIRES_DETERMINISTIC_SOURCE_CROP/)
})

test("ordinal zero primary is deterministic, square and pure-white at the border", async () => {
  const source = await sharp({
    create: { width: 1500, height: 905, channels: 3, background: "#eeeeee" },
  }).jpeg().toBuffer()
  const { createHash } = await import("node:crypto")
  const sourceSha256 = createHash("sha256").update(source).digest("hex")
  const main = await createDeterministicPrimaryMain({ source, sourceSha256 })
  const pixel = await sharp(main.output).extract({ left: 0, top: 0,
    width: 1, height: 1 }).raw().toBuffer()
  assert.deepEqual([...pixel], [255, 255, 255])
  assert.equal(main.transform.assetOrdinal, 0)
  assert.equal(main.transform.assetRole, "PRIMARY_MAIN")
  assert.equal(main.transform.canvas.background, "#FFFFFF")
  assert.equal(main.transform.generatedPixels, false)
  const preview = await createDeterministicPrimaryMainPreview({
    attemptId: "attempt", revisionId: "revision", source, sourceSha256,
    sourceStoragePath: "private/MAIN.jpg",
  })
  assert.equal(preview.transformManifest.assetOrdinal, 0)
  assert.equal(preview.transformManifest.sourceStoragePath, "private/MAIN.jpg")
  assert.match(preview.transformManifestHash, /^[0-9a-f]{64}$/)
})

test("crop is square, reproducible and never exceeds 2x", async () => {
  const source = await sharp({
    create: { width: 1500, height: 905, channels: 3, background: "white" },
  }).jpeg().toBuffer()
  const { createHash } = await import("node:crypto")
  const sourceSha256 = createHash("sha256").update(source).digest("hex")
  const input = { attemptId: "a", revisionId: "r", jobId: "j", source,
    sourceSha256, sourceStoragePath: "private/MAIN.jpg",
    sourceNativeWidth: 1500, sourceNativeHeight: 905 }
  const first = await createDeterministicPositionOneCrop(input)
  const second = await createDeterministicPositionOneCrop(input)
  assert.equal(first.outputSha256, second.outputSha256)
  assert.equal(first.transformManifestHash, second.transformManifestHash)
  assert.equal(first.upscaleFactor, 2)
  assert.equal(first.transformManifest.generatedPixels, false)
  assert.deepEqual(first.transformManifest.categorySignalsApplied, [])
  assert.deepEqual(first.transformManifest.crop,
    { left: 0, top: 0, width: 800, height: 800 })
})

test("human rejection evidence is append-only and Secondary 1 is not reassigned", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260722024000_reference_guided_human_rejection_and_deterministic_crop.sql",
    import.meta.url), "utf8")
  assert.match(migration, /asset_ordinal[^\n]*check \(asset_ordinal = 1\)/)
  assert.match(migration, /asset_role[^\n]*SECONDARY_MATERIAL_DETAIL/)
  assert.match(migration, /COMMERCIAL_OBJECTIVE_MISMATCH/)
  assert.match(migration, /BROADLY_CONSISTENT_NOT_PIXEL_CERTIFIED/)
  assert.match(migration, /output_preserved[\s\S]*true/)
  assert.match(migration, /REFERENCE_GUIDED_HUMAN_EVIDENCE_APPEND_ONLY/)
  assert.match(migration, /j\.position between 2 and 6[\s\S]*j\.status <> 'PENDING'/)
})
