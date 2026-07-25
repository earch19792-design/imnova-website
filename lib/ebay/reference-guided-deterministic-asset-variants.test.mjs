import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { readFileSync } from "node:fs"
import sharp from "sharp"

import {
  createPrimaryVerticalCenterAudit,
  createSideMaterialDetailVariant,
  SIDE_DETAIL_CROP,
} from "./reference-guided-deterministic-asset-variants.ts"

const sha256 = (value) => createHash("sha256").update(value).digest("hex")

test("PRIMARY_MAIN keeps centered pixels byte-for-byte and measures safe margins", async () => {
  const base = await sharp({
    create: { width: 1600, height: 1600, channels: 3, background: "white" },
  }).composite([{ input: {
    create: { width: 1360, height: 821, channels: 3, background: "#777777" },
  }, left: 120, top: 389 }]).png().toBuffer()
  const result = await createPrimaryVerticalCenterAudit({
    attemptId: "attempt", revisionId: "revision", currentPng: base,
    currentSha256: sha256(base), currentStoragePath: "private/primary.png",
    protectedMainSha256: "a".repeat(64),
  })
  assert.equal(result.translationY, 0)
  assert.equal(result.outputSha256, sha256(base))
  assert.deepEqual(result.output, base)
  assert.deepEqual(result.qa.margins,
    { left: 120, right: 120, top: 389, bottom: 390 })
  assert.equal(result.qa.exactWhiteCorners, true)
  assert.equal(result.qa.bluePixelCount, 0)
  assert.equal(result.transformManifest.operation.resampled, false)
  assert.equal(result.transformManifest.operation.generatedPixels, false)
})

test("SIDE material detail uses the exact normalized 800 crop and 2x output", async () => {
  const white = await sharp({
    create: { width: 1500, height: 1051, channels: 3, background: "white" },
  }).composite([
    { input: { create: { width: 860, height: 70, channels: 3,
      background: "#707070" } }, left: 320, top: 170 },
    { input: { create: { width: 1120, height: 20, channels: 3,
      background: "#999999" } }, left: 190, top: 80 },
    { input: { create: { width: 1050, height: 640, channels: 3,
      background: "#eeeeee" } }, left: 225, top: 250 },
  ]).jpeg({ quality: 100 }).toBuffer()
  const result = await createSideMaterialDetailVariant({
    attemptId: "attempt", revisionId: "revision", source: white,
    sourceSha256: sha256(white), sourceStoragePath: "private/SIDE.jpg",
  })
  assert.deepEqual(result.transformManifest.crop.left, SIDE_DETAIL_CROP.left)
  assert.deepEqual(result.transformManifest.crop.top, SIDE_DETAIL_CROP.top)
  assert.deepEqual(result.transformManifest.crop.width, 800)
  assert.deepEqual(result.transformManifest.crop.height, 800)
  assert.equal(result.transformManifest.output.upscaleFactor, 2)
  assert.equal(result.transformManifest.output.generatedPixels, false)
  assert.ok(result.transformManifest.handleSafeMargins.left >= 24)
  assert.ok(result.transformManifest.handleSafeMargins.right >= 24)
  assert.equal(result.qa.width, 1600)
  assert.equal(result.qa.height, 1600)
  assert.equal(result.qa.bluePixelCount, 0)
  assert.equal(result.qa.coloredBorderPixelCount, 0)
})

test("variant evidence is append-only and service-role only", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260722026000_deterministic_primary_and_side_variants.sql",
    import.meta.url), "utf8")
  assert.match(migration, /DETERMINISTIC_PRIMARY_VERTICAL_CENTER_V1/)
  assert.match(migration, /DETERMINISTIC_SOURCE_CROP_SIDE_V1/)
  assert.match(migration, /asset_ordinal = 0[\s\S]*PRIMARY_MAIN/)
  assert.match(migration, /asset_ordinal = 1[\s\S]*SECONDARY_MATERIAL_DETAIL/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /grant select, insert[\s\S]*service_role/)
  assert.match(migration,
    /prevent_reference_guided_human_evidence_mutation/)
})

test("review API and UI expose both material-detail variants for human selection", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/images/route.ts", import.meta.url), "utf8")
  const page = readFileSync(new URL(
    "../../app/admin/ebay/listing-workspace/page.tsx", import.meta.url), "utf8")
  assert.match(route,
    /ebay_reference_guided_deterministic_asset_variants/)
  assert.match(route, /deterministicVariants: variantReviews/)
  assert.match(page, /DETERMINISTIC_SOURCE_CROP_SIDE_V1/)
  assert.match(page, /variante determinista SIDE/)
  assert.match(page, /La variante MAIN anterior se conserva/)
  assert.match(page, /selecta esta alternativa|selecciona esta alternativa/)
})
