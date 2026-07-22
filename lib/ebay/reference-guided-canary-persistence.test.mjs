import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

import sharp from "sharp"

import {
  persistReferenceGuidedCanaryPng,
  runReferenceGuidedCanaryAutomaticQa,
} from "./reference-guided-canary-persistence.ts"

const migration = readFileSync(new URL("../../supabase/migrations/20260722020000_fix_reference_guided_png_persistence.sql", import.meta.url), "utf8")
const route = readFileSync(new URL("../../app/api/admin/ebay/images/reference-guided-canary/route.ts", import.meta.url), "utf8")
const fixtureScript = readFileSync(new URL("../../scripts/test-reference-guided-canary-persistence-fixture.mjs", import.meta.url), "utf8")

function storageMock() {
  let stored = null
  return {
    storage: {
      async listBuckets() {
        return { data: [{ id: "ebay-listing-image-staging", public: false,
          file_size_limit: 12582912,
          allowed_mime_types: ["image/jpeg", "image/png"] }], error: null }
      },
      from() {
        return {
          async upload(_path, value) { stored = Buffer.from(value); return { error: null } },
          async download() { return { data: new Blob([stored]), error: null } },
          async remove() { stored = null; return { error: null } },
        }
      },
    },
  }
}

test("shared canary persistence validates and round-trips an exact 1600 PNG", async () => {
  const output = await sharp({ create: { width: 1600, height: 1600,
    channels: 3, background: { r: 240, g: 242, b: 244 } } }).png().toBuffer()
  const hash = createHash("sha256").update(output).digest("hex")
  const result = await persistReferenceGuidedCanaryPng({
    supabase: storageMock(), output, expectedSha256: hash,
    storagePath: "reference-guided-canary-fixtures/unit/fixture.png",
  })
  assert.equal(result.hashMatch, true)
  assert.equal(result.dimensions, "1600x1600")
  assert.equal((await runReferenceGuidedCanaryAutomaticQa(output)).automaticStatus, "PARTIAL")
})

test("wrong MIME, false extension and disguised JPEG fail before upload", async () => {
  const png = await sharp({ create: { width: 1600, height: 1600,
    channels: 3, background: "white" } }).png().toBuffer()
  const hash = createHash("sha256").update(png).digest("hex")
  await assert.rejects(persistReferenceGuidedCanaryPng({ supabase: storageMock(),
    output: png, expectedSha256: hash, storagePath: "fixture.png",
    contentType: "image/webp" }), /OUTPUT_MIME_INVALID/)
  await assert.rejects(persistReferenceGuidedCanaryPng({ supabase: storageMock(),
    output: png, expectedSha256: hash, storagePath: "fixture.jpg" }),
  /OUTPUT_EXTENSION_INVALID/)
  const jpeg = await sharp(png).jpeg().toBuffer()
  await assert.rejects(persistReferenceGuidedCanaryPng({ supabase: storageMock(),
    output: jpeg, expectedSha256: createHash("sha256").update(jpeg).digest("hex"),
    storagePath: "fixture.png" }), /OUTPUT_BYTES_INVALID/)
})

test("migration preserves call one, scopes PNG to private output bucket and disables replacement", () => {
  assert.match(migration, /provider_calls <> 1/)
  assert.match(migration, /PROVIDER_SUCCEEDED_PERSISTENCE_FAILED/)
  assert.match(migration, /STORAGE_MIME_CONFIGURATION_DEFECT/)
  assert.match(migration, /where id = 'ebay-listing-image-staging'/)
  assert.match(migration, /array\['image\/jpeg','image\/png'\]/)
  assert.doesNotMatch(migration, /update storage\.buckets[\s\S]{0,300}ebay-listing-image-sources/)
  assert.match(migration, /AWAITING_EXPLICIT_HUMAN_AUTHORIZATION/)
  assert.match(migration, /REFERENCE_GUIDED_REPLACEMENT_CANARY_DISABLED/)
  assert.match(migration, /provider_calls = 1[\s\S]*provider_calls \+ 1/)
  assert.match(migration, /j\.position between 2 and 6/)
})

test("route and staging fixture use the same persistence and QA implementation", () => {
  assert.match(route, /persistReferenceGuidedCanaryPng/)
  assert.match(fixtureScript, /persistReferenceGuidedCanaryPng/)
  assert.match(fixtureScript, /removeReferenceGuidedCanaryPng/)
})
