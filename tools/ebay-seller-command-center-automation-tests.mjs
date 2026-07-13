import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  new URL("../supabase/migrations/20260713040000_create_ebay_seller_command_center_v2.sql", import.meta.url),
  "utf8",
)
const accountScopeMigration = readFileSync(
  new URL("../supabase/migrations/20260713073000_scope_ebay_seller_whatsapp_claims.sql", import.meta.url),
  "utf8",
)
const service = readFileSync(
  new URL("../lib/ebay/ebay-seller-command-center-automation.ts", import.meta.url),
  "utf8",
)
const protectionDomain = readFileSync(
  new URL("../lib/ebay/ebay-active-listing-protection-domain.ts", import.meta.url),
  "utf8",
)
const scanService = readFileSync(
  new URL("../lib/ebay/ebay-first-luna-scan-service.ts", import.meta.url),
  "utf8",
)
const scanCron = readFileSync(
  new URL("../app/api/cron/ebay-luna-opportunity-scan/route.ts", import.meta.url),
  "utf8",
)
const lunaCron = readFileSync(
  new URL("../app/api/cron/market-radar-luna-sync/route.ts", import.meta.url),
  "utf8",
)
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"))

test("V2 persists the mobile review and internal listing package without an eBay write", () => {
  assert.match(migration, /create table if not exists public\.ebay_command_center_reviews/)
  assert.match(migration, /unique \(user_id, candidate_key\)/)
  assert.match(migration, /create table if not exists public\.ebay_listing_packages/)
  assert.match(migration, /opportunity_id uuid not null unique/)
  assert.match(migration, /status in \('draft', 'ready_for_review', 'approved', 'rejected', 'archived'\)/)
  assert.doesNotMatch(`${service}\n${scanService}`, /createOrReplaceInventoryItem|createOffer|publishOffer/)
})

test("the task queue uses stable keys, lanes, due dates and transactional leases", () => {
  assert.match(migration, /ebay_seller_candidate_task_key/)
  assert.match(migration, /constraint ebay_seller_scan_tasks_candidate_kind_unique unique \(candidate_key, task_kind\)/)
  for (const lane of ["protection", "event", "hot", "baseline", "coverage"]) {
    assert.match(migration, new RegExp(`'${lane}'`))
  }
  assert.match(migration, /due_at timestamptz not null/)
  assert.match(migration, /for update skip locked/i)
  assert.match(migration, /lease_expires_at/)
  assert.match(migration, /TASK_LEASE_NOT_OWNED/)
  assert.match(migration, /power\(2, greatest\(task\.attempts - 1, 0\)\)/)
  assert.match(migration, /'dead_letter'/)
  assert.match(migration, /last_completed_at = now\(\),\s+attempts = 0/)
  assert.match(migration, /source_snapshot_id is distinct from excluded\.source_snapshot_id[\s\S]*excluded\.lane in \('protection', 'event', 'hot'\)/)
  assert.match(migration, /extract\(epoch from \(now\(\) - task\.due_at\)\) \/ 1800/)
})

test("queue RPCs are server-only and cannot be claimed by a normal authenticated client", () => {
  assert.match(migration, /revoke all on function public\.claim_ebay_seller_scan_tasks[\s\S]*from public, anon, authenticated/)
  assert.match(migration, /grant execute on function public\.claim_ebay_seller_scan_tasks[\s\S]*to service_role/)
  assert.match(migration, /alter table public\.ebay_seller_scan_tasks enable row level security/)
})

test("candidate failures are isolated and acknowledged independently", () => {
  assert.match(scanService, /for \(const task of tasks\)/)
  assert.match(scanService, /completeSellerScanTask\(supabase, task\.id, workerId/)
  assert.match(scanService, /failSellerScanTask\(supabase, task, workerId, error\)/)
  assert.match(scanService, /failures\.push/)
  assert.match(scanService, /processClaimedCandidate\(supabase, run, task\)/)
  assert.match(scanService, /bestSellingCategoriesDue/)
  assert.match(scanService, /24 \* 60 \* 60 \* 1000/)
})

test("active listing protection emits one canonical risk and alert per account + item + SKU", () => {
  assert.match(migration, /risk_fingerprint text/)
  assert.match(migration, /ebay_active_listing_risk_fingerprint_uidx/)
  assert.match(migration, /create table if not exists public\.ebay_seller_alert_outbox/)
  assert.match(migration, /alert_fingerprint text not null unique/)
  assert.match(migration, /create table if not exists public\.ebay_seller_alert_delivery_attempts/)
  assert.match(service, /inventory_quantity !== null && latest\.inventory_quantity <= 3/)
  assert.match(service, /currentCost > linkedCost \* 1\.05/)
  assert.match(service, /mapping_broken/)
  assert.match(migration, /occurrence_count = public\.ebay_active_listing_risk_events\.occurrence_count \+ 1/)
  assert.match(service, /upsert_ebay_active_listing_risk/)
  assert.match(service, /canonicalizeActiveListingProtectionRows\(listingRows\)/)
  assert.match(protectionDomain, /source === EBAY_INVENTORY_READONLY_SOURCE/)
  assert.match(protectionDomain, /itemSkus\?\.size === 1/)
  assert.match(protectionDomain, /canonicalListingStatus:|listingStatus:/)
  assert.match(service, /active-listing-v2:\$\{listingIdentityHash\}:\$\{riskType\}/)
  assert.match(service, /const alertFingerprint = `risk:\$\{input\.riskFingerprint\}`/)
  assert.match(service, /listingIds: group\.memberListingIds/)
  assert.match(service, /CANONICAL_LISTING_DEDUPED/)
  assert.doesNotMatch(service, /const alertFingerprint = `\$\{riskFingerprint\}:\$\{input\.snapshotId/)
  assert.match(lunaCron, /reconcileActiveListingProtectionRisks/)
})

test("active listing identity is offer and account aware, not item-id unique", () => {
  assert.match(migration, /add column if not exists source text not null default 'manual'/)
  assert.match(migration, /add column if not exists account_key text not null default 'default'/)
  assert.match(migration, /add column if not exists sync_key text null/)
  assert.match(migration, /add column if not exists sync_run_id uuid null/)
  assert.match(migration, /add column if not exists supplier_cost_at_linking numeric\(12,2\) null/)
  assert.match(migration, /drop constraint if exists ebay_active_listings_item_unique/)
  assert.match(migration, /ebay_active_listings_sync_key_uidx\s+on public\.ebay_active_listings\(sync_key\)/)
  assert.match(accountScopeMigration, /alter column account_key drop default/)
  assert.match(accountScopeMigration, /account_key <> 'default'/)
  assert.match(service, /getEbaySellerAccountScopeConfiguration/)
  assert.match(service, /\.eq\("account_key", accountScope\.accountKey\)/)
  assert.match(service, /accountKey: input\.accountKey/)
  assert.match(scanService, /accountKey,/)
})

test("cron cadence preserves priority while respecting the serverless budget", () => {
  assert.match(scanCron, /CRON_MAX_CANDIDATES = 5/)
  assert.match(scanCron, /CRON_TIME_BUDGET_MS = 45_000/)
  assert.match(scanCron, /reconcileSellerScanTasks/)
  assert.match(scanCron, /limit: 200/)
  assert.match(scanCron, /batchSize: 1/)
  assert.match(lunaCron, /reconcileSellerScanTasks/)
  assert.match(lunaCron, /limit: 300/)
  assert.match(lunaCron, /finishSellerAutomationRun/)
  assert.deepEqual(vercel.crons, [
    { path: "/api/cron/market-radar-luna-sync", schedule: "0 9 * * *" },
    { path: "/api/cron/ebay-luna-opportunity-scan", schedule: "17 9 * * *" },
  ])
  assert.match(scanService, /productionSchedule: "17 9 \* \* \*"/)
  assert.match(scanService, /lunaProductionSchedule: "0 9 \* \* \*"/)
  assert.doesNotMatch(scanService, /productionSchedule: "\*\/15 \* \* \* \*"/)
})

test("dashboard exposes operational health instead of reporting an empty queue as healthy", () => {
  assert.match(scanService, /getSellerAutomationHealth/)
  assert.match(service, /dueTasks/)
  assert.match(service, /retryTasks/)
  assert.match(service, /deadLetterTasks/)
  assert.match(service, /pendingAlerts/)
  assert.match(scanService, /health: automationHealth/)
})
