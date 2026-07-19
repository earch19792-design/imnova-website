import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8")
}

test("same-day state machine chains generation and batch approval automatically", async () => {
  const service = await source("./ebay-same-day-pilot-service.ts")
  assert.match(service, /jobType: "GENERATE_SIX_IMAGE_PACKAGE"/)
  assert.match(service, /previousState: "PREPARING_IMAGE_PACKAGE",\s*nextState: "WAITING_IMAGE_APPROVAL"/)
  assert.match(service, /jobType: "APPROVE_SIX_IMAGE_SET"/)
  assert.match(service, /jobType: "FINALIZE_MANUAL_HANDOFF"/)
  assert.match(service, /continuationJobType: "APPROVE_SIX_IMAGE_SET"/)
  assert.doesNotMatch(service, /continuationJobType: "FINALIZE_MANUAL_HANDOFF"[^]*title: "Revisa el set completo/)
})

test("one product approval contains rights and one-call spend authorization", async () => {
  const [service, route, panel] = await Promise.all([
    source("./ebay-same-day-pilot-service.ts"),
    readFile(new URL("../../app/api/admin/ebay/same-day-pilot/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/today-launch-panel.tsx", import.meta.url), "utf8"),
  ])
  for (const value of [service, route, panel]) {
    assert.match(value, /imageRightsConfirmed/)
    assert.match(value, /openAiImageSpendApproved/)
  }
  assert.match(service, /openAiImageMaximumCallsApproved: 1/)
  assert.match(panel, /hasta 1 llamada OpenAI de calidad low/)
})

test("runtime persists six review assets but never invokes an eBay write API", async () => {
  const runtime = await source("./ebay-same-day-image-package-runtime.ts")
  assert.match(runtime, /ebay_create_pending_listing_image_set/)
  assert.match(runtime, /persistedAssetIds\.length !== 6/)
  assert.match(runtime, /review_ebay_same_day_pilot_image_package_set/)
  assert.match(runtime, /ebayWrites: 0/)
  assert.doesNotMatch(runtime, /Inventory API|publishOffer|createOffer|createOrReplaceInventoryItem|reviseItem/i)
  assert.doesNotMatch(runtime, /recursive|\/api\/admin\/ebay\/images/)
})

test("database boundary requires exact six, current human gate and safe partial context", async () => {
  const migration = await readFile(
    new URL("../../supabase/migrations/20260718054000_create_same_day_pilot_image_package_control.sql", import.meta.url),
    "utf8",
  )
  assert.match(migration, /cardinality\(p_asset_ids\).*<> 6/s)
  assert.match(migration, /gate_type = 'IMAGE_APPROVAL_REQUIRED'/)
  assert.match(migration, /task\.status = 'OPEN'/)
  assert.match(migration, /'USE_CONTEXT'/)
  assert.match(migration, /'EBAY_OPENAI_BACKGROUND_PLATE_V1'/)
  assert.match(migration, /rights_evidence_confirmed is distinct from true/)
  assert.match(migration, /competitor_image_count = 0/)
  assert.match(migration, /ebay_writes = 0/)
  assert.match(migration, /production_changed = false/)
})

test("the browser receives temporary previews only and cannot approve an incomplete set", async () => {
  const [route, panel] = await Promise.all([
    readFile(new URL("../../app/api/admin/ebay/same-day-pilot/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/today-launch-panel.tsx", import.meta.url), "utf8"),
  ])
  assert.match(route, /createSignedUrl\(text\(asset\.output_storage_path, 1_000\), 300\)/)
  assert.doesNotMatch(route, /source_storage_path[^]*return \{/)
  assert.match(panel, /assets\.length === IMAGE_REVIEW_SLOTS\.length/)
  assert.match(panel, /disabled=\{working \|\| !imageSetReady\}/)
  assert.match(panel, /APROBAR IMÁGENES · SET DE 6/)
})
