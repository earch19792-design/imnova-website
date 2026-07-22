import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import sharp from "sharp"

import { createDeterministicPackageContents } from
  "./reference-guided-deterministic-package-contents.ts"

async function fixture() {
  return sharp({ create: { width: 1500, height: 1051, channels: 3,
    background: "#FFFFFF" } }).composite([{ input: await sharp({ create: {
      width: 1400, height: 900, channels: 3, background: "#777777",
    } }).png().toBuffer(), left: 50, top: 75 }]).jpeg({ quality: 100 })
    .toBuffer()
}

test("position 2 uses one complete SIDE input on an exact white canvas", async () => {
  const source = await fixture()
  const sourceSha256 = createHash("sha256").update(source).digest("hex")
  const result = await createDeterministicPackageContents({
    planId: "c54a0bbc-b16c-47b3-8f4e-93d2152e3b34",
    planHash: "a".repeat(64), attemptId: "attempt", revisionId: "revision",
    jobId: "job", source, sourceSha256, sourceStoragePath: "SIDE.jpg",
  })
  assert.equal(result.qa.width, 1600)
  assert.equal(result.qa.height, 1600)
  assert.equal(result.qa.backgroundPureWhite, true)
  assert.equal(result.qa.singleCompleteUnit, true)
  assert.equal(result.qa.safeMargins, true)
  assert.equal(result.qa.clippingDetected, false)
  assert.equal(result.qa.textDetected, false)
  assert.equal(result.transformManifest.operation.compositeInputCount, 1)
  assert.equal(result.transformManifest.operation.generatedPixels, false)
  assert.equal(result.transformManifest.source.sourceImageId, "SIDE")
  assert.equal(createHash("sha256").update(Buffer.from(
    result.transformManifestText, "utf8")).digest("hex"),
  result.transformManifestHash)
  result.output.fill(0)
  source.fill(0)
})

test("position 2 fails closed when protected SIDE bytes differ", async () => {
  const source = await fixture()
  await assert.rejects(() => createDeterministicPackageContents({
    planId: "plan", planHash: "a".repeat(64), attemptId: "attempt",
    revisionId: "revision", jobId: "job", source,
    sourceSha256: "b".repeat(64), sourceStoragePath: "SIDE.jpg",
  }), /DETERMINISTIC_PACKAGE_CONTENTS_SOURCE_HASH_MISMATCH/)
  source.fill(0)
})

test("Phase A migration creates no provider authority or reservation", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260722030000_execute_successor_phase_a_position_2.sql",
    import.meta.url), "utf8")
  assert.match(migration, /HUMAN_REVIEW_REQUIRED/)
  assert.match(migration, /provider_calls <> 2/)
  assert.match(migration, /position between 3 and 6/)
  assert.match(migration, /prevent_reference_guided_human_evidence_mutation/)
  assert.doesNotMatch(migration,
    /reserve_ebay_reference_guided_provider_call|claim_ebay_reference_guided_generation_jobs|OPENAI/i)
  assert.doesNotMatch(migration, /set provider_calls\s*=/i)
})

test("private Phase A preview is exposed only through a temporary signed URL", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/images/route.ts", import.meta.url), "utf8")
  const page = readFileSync(new URL(
    "../../app/admin/ebay/listing-workspace/page.tsx", import.meta.url), "utf8")
  assert.match(route, /ebay_reference_guided_phase_a_position_2_assets/)
  assert.match(route,
    /createSignedUrl\(phaseAPosition2Asset\.output_storage_path, 300\)/)
  assert.match(route, /REFERENCE_GUIDED_POSITION_2_PREVIEW_BINDING_INVALID/)
  assert.match(route, /REFERENCE_GUIDED_POSITION_2_SIGNED_URL_INVALID/)
  assert.match(route, /!\[0, 1, 2\]\.includes\(assetOrdinal\)/)
  assert.match(page, /Secundaria 2 · SECONDARY_PACKAGE_CONTENTS/)
  assert.match(page, /phaseAPosition2Asset\.output_preview_url/)
  assert.match(page, /phaseAPosition2MappingValid/)
  assert.match(page, /key=\{`position-2-\$\{/)
  assert.match(page, /data-output-sha256=/)
  assert.match(page, /assetOrdinal: 2/)
})
