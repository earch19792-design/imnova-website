import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")

test("429 remains HTTP 429 and Retry-After is persisted with a checkpoint", () => {
  const route = read("app/api/admin/ebay/luna-opportunity-queue/route.ts")
  const coordinator = read("lib/ebay/ebay-persistent-quota-coordinator.ts")
  assert.match(route, /status: rateLimit\?\.httpStatus \?\? 502/)
  assert.match(coordinator, /retry_after_seconds: rateLimit\.retryAfterSeconds/)
  assert.match(coordinator, /checkpoint: input\.checkpoint/)
  assert.match(coordinator, /affected_lane: input\.lane/)
})

test("restart cannot enqueue all 1,513 tasks", () => {
  const route = read("app/api/admin/ebay/luna-opportunity-queue/route.ts")
  assert.match(route, /RESET_ALL_1513_BLOCKED/)
  assert.match(route, /RESUME_FROM_CHECKPOINT/)
  assert.doesNotMatch(route, /action === "restart_priority"[\s\S]{0,700}startEbayFirstLunaScan/)
})

test("lightweight discovery has one family query and deep detail defaults to two", () => {
  const gateway = read("lib/ebay/ebay-seller-keyword-demand-gateway.ts")
  const lightweight = gateway.match(/export async function discoverEbayListingSignals[\s\S]*?\n}\n/)?.[0] ?? ""
  assert.match(gateway, /DEFAULT_DETAIL_SAMPLE_LIMIT = 2/)
  assert.equal((lightweight.match(/searchActiveListings\(/g) ?? []).length, 1)
  assert.doesNotMatch(lightweight, /enrichActiveListing|mappedActiveComparable/)
})

test("persistent caches never store competitor image URLs", () => {
  const gateway = read("lib/ebay/ebay-seller-keyword-demand-gateway.ts")
  const migration = read("supabase/migrations/20260717190000_create_ebay_two_speed_quota_control_plane.sql")
  assert.match(gateway, /imageUrl: null,[\s\S]*itemWebUrl: null/)
  assert.doesNotMatch(migration, /image_url|thumbnail_url|base64|blob|screenshot/i)
})

test("Product Research related pack never increments exact sold", () => {
  const scanner = read("lib/ebay/ebay-first-luna-scan-service.ts")
  assert.match(scanner, /EXACT_LUNA_MATCH"\) current\.soldExactCount \+= sold/)
  assert.match(scanner, /SAME_PRODUCT_DIFFERENT_PACK"\) current\.soldRelatedPackCount \+= sold/)
})

test("Product Research ranking uses the Luna variant schema and cannot take down the queue", () => {
  const scanner = read("lib/ebay/ebay-first-luna-scan-service.ts")
  assert.match(scanner, /matched_supplier_variant_id,match_classification,confirmed_sold_quantity,last_sold_date/)
  assert.match(scanner, /\.eq\("marketplace_account_key", accountKey\)/)
  assert.match(scanner, /\.in\("matched_supplier_variant_id", supplierVariantIds\)/)
  assert.match(scanner, /\.eq\("evidence_reviewed", true\)/)
  assert.match(scanner, /productResearchRankingStatus = "UNAVAILABLE"/)
  assert.doesNotMatch(scanner, /throw new Error\("EBAY_PRODUCT_RESEARCH_RANKING_READ_FAILED"\)/)
  assert.doesNotMatch(scanner, /\.eq\("reviewed", true\)/)
})

test("Commercial Monitor and WhatsApp activation use independent flags", () => {
  const workflow = read(".github/workflows/ebay-commercial-preview-monitor.yml")
  assert.match(workflow, /EBAY_COMMERCIAL_PREVIEW_MONITOR_ENABLED/)
  assert.match(workflow, /EBAY_COMMERCIAL_PREVIEW_WHATSAPP_DISPATCHER_ENABLED/)
  const domain = read("lib/marketplace/commercial-monitor-domain.ts")
  assert.match(domain, /ZERO_SALES_HEALTHY/)
})

test("manual market verification persists its pause and keeps local work available", () => {
  const route = read("app/api/admin/ebay/seller-keyword-demand/route.ts")
  const page = read("app/admin/ebay/mobile-review/page.tsx")
  assert.match(route, /EXACT_VERIFICATION/)
  assert.match(route, /P1_EXACT_VERIFICATION/)
  assert.match(route, /checkpointPreserved: true/)
  assert.match(route, /localFlowAvailable: true/)
  assert.match(page, /sellerKeywordDemand\s*\?\s*"eBay pausó la actualización\. La evidencia anterior permanece visible/)
  assert.match(page, /Capturar ventas en Product Research/)
  assert.match(page, /Revisar otra oportunidad/)
})

test("an expired 429 pause permits one probe after the authorized reset", () => {
  const coordinator = read("lib/ebay/ebay-persistent-quota-coordinator.ts")
  assert.match(coordinator, /resetReached/)
  assert.match(coordinator, /status: "RESET_REACHED"/)
  assert.match(coordinator, /available: true/)
})

test("the browser reads persisted pause state without consuming eBay quota", () => {
  const route = read("app/api/admin/ebay/seller-keyword-demand/route.ts")
  const page = read("app/admin/ebay/mobile-review/page.tsx")
  assert.match(route, /export async function GET\(req: Request\)/)
  assert.match(route, /ebayCalls: 0/)
  assert.match(page, /payload\.quota\?\.available === false/)
  assert.match(page, /EBAY_QUOTA_STATE_READ_FAILED/)
})
