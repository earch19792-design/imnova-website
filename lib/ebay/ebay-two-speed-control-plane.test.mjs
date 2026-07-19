import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")

test("429 remains HTTP 429 and Retry-After is persisted with a checkpoint", () => {
  const route = read("app/api/admin/ebay/luna-opportunity-queue/route.ts")
  const coordinator = read("lib/ebay/ebay-persistent-quota-coordinator.ts")
  const listingAiApi = read("lib/ebay/ebay-listing-ai-api.ts")
  assert.match(route, /status: rateLimit\?\.httpStatus \?\? 502/)
  assert.match(route, /status: 429, headers: \{ "Retry-After": String\(retryAfter\) \}/)
  assert.match(route, /\.\.\.\(retryAfter \? \{ headers: \{ "Retry-After": String\(retryAfter\) \} \} : \{\}\)/)
  assert.match(coordinator, /retry_after_seconds: rateLimit\.retryAfterSeconds/)
  assert.match(coordinator, /checkpoint: input\.checkpoint/)
  assert.match(coordinator, /affected_lane: input\.lane/)
  assert.match(listingAiApi, /code === "EBAY_READONLY_GET_429"\) return 429/)
  assert.doesNotMatch(listingAiApi, /code\.includes\("429"\)/)
  assert.match(listingAiApi, /response\.headers\.set\("Retry-After"/)
  const failureHelper = listingAiApi.slice(listingAiApi.indexOf("export function listingAiFailure"))
  assert.doesNotMatch(failureHelper, /endpoint|authorization|token/i)
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

test("scheduler reconciliation clears only expired persistent 429 rows and preserves the audit events", () => {
  const coordinator = read("lib/ebay/ebay-persistent-quota-coordinator.ts")
  const pilot = read("lib/ebay/ebay-same-day-pilot-service.ts")
  assert.match(coordinator, /export async function releaseExpiredEbayQuotaPauses/)
  assert.match(coordinator, /\.eq\("marketplace", "EBAY_US"\)/)
  assert.match(coordinator, /\.eq\("status", "PAUSED_429"\)/)
  assert.match(coordinator, /\.lte\("reset_at", observedAt\)/)
  assert.match(coordinator, /if \(releaseError\) throw new Error\("EBAY_QUOTA_EXPIRED_PAUSE_RELEASE_FAILED"\)/)
  assert.doesNotMatch(coordinator.match(/export async function releaseExpiredEbayQuotaPauses[\s\S]*?\n}/)?.[0] ?? "", /ebay_api_quota_events.*(?:update|delete)/)
  assert.match(pilot, /const expiredQuotaPauses = await releaseExpiredEbayQuotaPauses\(input\.supabase, now\)/)
  assert.match(pilot, /projectEffectiveEbayQuotaLane\(lane, now\)/)
})

test("the browser reads persisted pause state without consuming eBay quota", () => {
  const route = read("app/api/admin/ebay/seller-keyword-demand/route.ts")
  const page = read("app/admin/ebay/mobile-review/page.tsx")
  assert.match(route, /export async function GET\(req: Request\)/)
  assert.match(route, /ebayCalls: 0/)
  assert.match(page, /payload\.quota\?\.available === false/)
  assert.match(page, /EBAY_QUOTA_STATE_READ_FAILED/)
})

test("scanner quota pauses are never completed or counted as terminal work", () => {
  const scanner = read("lib/ebay/ebay-first-luna-scan-service.ts")
  const batch = scanner.slice(scanner.indexOf("export async function processNextEbayFirstLunaBatch"))
  const pauseGuard = batch.indexOf('"quotaPause" in processed')
  const complete = batch.indexOf("await completeSellerScanTask")
  assert.ok(pauseGuard >= 0)
  assert.ok(complete > pauseGuard)
  assert.match(batch, /processed: terminalCount/)
  assert.match(batch, /pausedTasks: quotaPausedTasks\.length/)
  assert.doesNotMatch(batch, /processed: attemptedCount/)
})

test("a live 429 is persisted and paused before the generic failure path", () => {
  const scanner = read("lib/ebay/ebay-first-luna-scan-service.ts")
  const batch = scanner.slice(scanner.indexOf("export async function processNextEbayFirstLunaBatch"))
  const live429 = batch.indexOf("const rateLimit = getEbayReadonlyRateLimitMetadata(error)")
  const genericFailure = batch.indexOf("const failedTask = await failSellerScanTask")
  assert.ok(live429 >= 0)
  assert.ok(genericFailure > live429)
  assert.match(batch, /pauseClaimedScanTasks\(supabase, quotaPausedTasks, workerId, exactResumeAt\)/)
  assert.match(batch, /last_error: batchRateLimit[\s\S]*?"EBAY_READONLY_GET_429"/)
})

test("active quota lanes are filtered before task claiming", () => {
  const scanner = read("lib/ebay/ebay-first-luna-scan-service.ts")
  assert.match(scanner, /const quotaPlan = await eligibleScanLanes\(supabase, requestedLanes\)/)
  assert.match(scanner, /if \(!quotaPlan\.lanes\.length && preflightPause\)/)
  assert.match(scanner, /lanes: quotaPlan\.lanes/)
  assert.match(scanner, /taskUsesQuotaLane/)
  assert.match(scanner, /QUOTA_OTHER_LANE_DEFERRED/)
})

test("quota release preserves the exact resume instant and does not consume an attempt", () => {
  const migration = read("supabase/migrations/20260718041000_pause_ebay_seller_scan_tasks_on_quota.sql")
  assert.match(migration, /create or replace function public\.pause_ebay_seller_scan_tasks_for_quota/)
  assert.match(migration, /due_at = p_resume_at/)
  assert.match(migration, /attempts = greatest\(task\.attempts - 1, 0\)/)
  assert.match(migration, /task\.status = 'leased'/)
  assert.match(migration, /task\.lease_owner = trim\(p_worker_id\)/)
  const originalClaim = read("supabase/migrations/20260713040000_create_ebay_seller_command_center_v2.sql")
  assert.match(originalClaim, /task\.due_at <= now\(\)/)
})

test("the persistent pause reuses the original Retry-After metadata", () => {
  const coordinator = read("lib/ebay/ebay-persistent-quota-coordinator.ts")
  const scanner = read("lib/ebay/ebay-first-luna-scan-service.ts")
  const migration = read("supabase/migrations/20260718041000_pause_ebay_seller_scan_tasks_on_quota.sql")
  assert.match(coordinator, /retry_after_source: rateLimit\.retryAfterSource/)
  assert.match(coordinator, /retry_after_seconds,retry_after_source,observed_at,resume_at,affected_lane/)
  assert.match(coordinator, /retryAfterSeconds: event\?\.retry_after_seconds \?\? null/)
  assert.match(coordinator, /resumeAt: event\?\.resume_at \?\? decision\.resumeAt/)
  assert.match(scanner, /retryAfterSeconds: derivedSeconds !== null[\s\S]*\? derivedSeconds/)
  assert.match(migration, /add column if not exists retry_after_source text null/)
})
