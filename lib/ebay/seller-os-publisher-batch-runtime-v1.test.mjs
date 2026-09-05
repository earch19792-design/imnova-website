import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")

test("batch authorization is exact, atomic, durable and service-role only", () => {
  const migration = read(
    "supabase/migrations/20260905110828_seller_os_publisher_batch_authority_v1.sql",
  )
  assert.match(migration, /seller_os_publisher_batch_authorizations_v1/)
  assert.match(migration, /seller_os_publisher_batch_children_v1/)
  assert.match(migration, /authorize_seller_os_publisher_batch_v1/)
  assert.match(migration, /jsonb_array_length\(authorized_members\) = exact_member_count/)
  assert.match(migration, /SELLER_OS_PUBLISHER_BATCH_CHILD_COUNT_DIVERGENCE/)
  assert.match(migration, /force row level security/g)
  assert.match(migration, /from public, anon, authenticated/)
  assert.match(migration, /to service_role/)
})

test("claims are atomic, leased and retry-safe children cannot spin in one dispatch", () => {
  const migration = read(
    "supabase/migrations/20260905110828_seller_os_publisher_batch_authority_v1.sql",
  )
  assert.match(migration, /for update of child skip locked/)
  assert.match(migration, /retry_after_at <= pg_catalog\.clock_timestamp\(\)/)
  assert.match(migration, /attempt_count = attempt_count \+ 1/)
  assert.match(migration, /lease_expires_at/)
  const route = read("app/api/admin/ebay/draft-only/route.ts")
  assert.match(route, /Math\.min\(4,/)
  assert.match(route, /15 \* 60_000/)
  assert.match(route, /FAILED_RETRY_SAFE/)
})

test("one owner click binds the exact current material cohort and runtime operates children", () => {
  const page = read("app/admin/ebay/quick-pick/page.tsx")
  const route = read("app/api/admin/ebay/draft-only/route.ts")
  const batchRuntime = route.slice(
    route.indexOf("async function resumeSellerOsPublisherBatchV1"),
    route.indexOf("async function handlePost"),
  )
  assert.match(page, /batchSummary\.authoritativeReadyCount ===/)
  assert.match(page, /batchSummary\.visibleReadyCount ===/)
  assert.match(page, /batchSummary\.actionableReadyCount === batchSummary\.batchEligibleCount/)
  assert.match(page, /confirmExactMemberCount: members\.length/)
  assert.match(page, /confirmCommercialAuthorization: true/)
  assert.match(page, /`PUBLICAR \$\{members\.length\} LISTOS`/)
  assert.doesNotMatch(page, /Continuar resolución automática/)
  assert.match(route, /publisherBatchDigest\(expected\) !== publisherBatchDigest\(requested\)/)
  assert.match(route, /authorize_seller_os_publisher_batch_v1/)
  assert.match(batchRuntime, /persistQuickPickOwnerReviewV1/)
  assert.match(batchRuntime, /candidate\.publisherRuntimeEligible !== true/)
  assert.match(batchRuntime, /condition = text\(binding\.condition\)/)
  assert.doesNotMatch(batchRuntime, /condition:\s*"NEW"/)
  assert.match(batchRuntime, /approveDraft\(/)
  assert.match(batchRuntime, /executeDraft\(/)
  assert.match(batchRuntime, /prepareFinalPublication\(/)
  assert.match(batchRuntime, /publishFinalPublication\(/)
  assert.doesNotMatch(batchRuntime, /ITEM3438|FL-LONG-SPOONS|ITEM5313/)
})

test("existing and new Offer classes remain in the same fail-closed Publisher", () => {
  const route = read("app/api/admin/ebay/draft-only/route.ts")
  assert.match(route, /crossApprovalExistingOffer/)
  assert.match(route, /classifyExactDraftOnlyPublicationSelfLineageV1/)
  assert.match(route, /createEbayUnpublishedOffer/)
  assert.match(route, /verifyEbayUnpublishedOffer/)
  assert.match(route, /publishEbayOfferOnce/)
  assert.match(route, /completeFinalPublicationMonitor/)
})

test("batch continuation is POST-only and forwards runtime authorization", () => {
  const runtime = read("app/api/runtime/publisher-batch/route.ts")
  const publisher = read("app/api/admin/ebay/draft-only/route.ts")
  const runtimeHandler = publisher.slice(publisher.indexOf(
    "async function handlePost"))
  assert.match(runtime, /export async function POST/)
  assert.match(runtime, /action: "batch_runtime"/)
  assert.match(runtime, /sellerOsPostOnlyGetResponseV1/)
  assert.match(runtime, /x-vercel-protection-bypass/)
  assert.match(runtimeHandler, /recoverQuickPickPublisherPackagesV1/)
  assert.ok(runtimeHandler.indexOf("recoverQuickPickPublisherPackagesV1({") <
    runtimeHandler.indexOf("seller_os_publisher_batch_authorizations_v1"))
})
