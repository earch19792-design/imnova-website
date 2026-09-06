import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const server = readFileSync(new URL(
  "./ebay-mayel-visual-phase-b-server-v1.ts", import.meta.url), "utf8")
const route = readFileSync(new URL(
  "../../app/api/admin/ebay/mayel-visual-workstation/route.ts",
  import.meta.url), "utf8")
const official = readFileSync(new URL(
  "./ebay-active-listing-image-revision-service.ts", import.meta.url), "utf8")
const migration = readFileSync(new URL(
  "../../supabase/migrations/20260906084354_mayel_trading_visual_live_canary_v1.sql",
  import.meta.url), "utf8")
const urlRegexFix = readFileSync(new URL(
  "../../supabase/migrations/20260906085708_fix_mayel_phase_b_image_url_regex_v1.sql",
  import.meta.url), "utf8")

test("live canary requires service-role confirmation and exact subject bindings", () => {
  assert.match(route, /authenticationMode === "service_role"/)
  assert.match(route, /EXECUTE_TRADING_VISUAL_CANARY_V1/)
  assert.match(server, /MAYEL_TRADING_VISUAL_LIVE_CANARY_CONFIRMATION/)
  assert.match(server, /expectedBeforeImageDigest/)
  assert.match(server, /expectedManifestId/)
  assert.match(server, /expectedItemId/)
})

test("Media preparation and listing revision have separate one-shot counts", () => {
  assert.match(server, /mediaApiWriteCount/)
  assert.match(server, /tradingListingWriteCount: 1/)
  assert.match(server, /MAYEL_TRADING_MEDIA_SECOND_WRITE_BLOCKED/)
  assert.match(server, /media_preparation_write_count/)
})

test("fresh Trading snapshots cover all protected commercial fields", () => {
  for (const selector of ["Item.Title", "Item.Quantity",
    "Item.SellingStatus.CurrentPrice", "Item.PrimaryCategory.CategoryID",
    "Item.ConditionID", "Item.Description", "Item.ItemSpecifics",
    "Item.ShippingDetails", "Item.ReturnPolicy", "Item.PaymentMethods",
    "Item.SellerProfiles"]) {
    assert.match(official, new RegExp(selector.replaceAll(".", "\\.")))
  }
  assert.match(server, /protectedFieldDifferences/)
  assert.match(server, /unauthorizedFieldDiffCount/)
})

test("global delegation is reusable without weakening exact execution bindings", () => {
  assert.match(migration, /drop constraint\s+ebay_mayel_visual_phase_b_executions_v1_owner_approval_id_key/s)
  assert.match(server, /idempotencyBindingDigest/)
  assert.match(server, /claim_ebay_mayel_trading_visual_write_v1/)
  assert.match(server, /visual_task_id/)
  assert.match(server, /visual_manifest_digest/)
})

test("ambiguous Revise outcome goes to readback and never a second write", () => {
  assert.match(server, /write\.status === "AMBIGUOUS"/)
  assert.match(server, /EBAY_WRITE_CONFIRMED_BY_OFFICIAL_READBACK/)
  assert.equal((server.match(
    /reviseMayelTradingPicturesOnceV1\(\{/g) ?? []).length, 1)
})

test("Phase B URL validation avoids unsupported large POSIX intervals", () => {
  assert.doesNotMatch(urlRegexFix, /\{1,1000\}/)
  assert.match(urlRegexFix, /char_length\(image\.value\) not between 1 and 1000/)
  assert.match(urlRegexFix, /\^https:\/\/\[\^\[:space:\]\[:cntrl:\]\]\+\$/)
})
