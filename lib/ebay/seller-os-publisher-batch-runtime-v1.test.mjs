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
  assert.match(route, /recoverPublisherBatchPrewriteObservabilityGapsV1/)
  assert.match(route, /PUBLISHER_BATCH_PREWRITE_OBSERVABILITY_GAP/)
  assert.match(route, /canonicalPublisherBatchJson/)
  assert.match(route, /Object\.entries\(value as JsonRecord\)[\s\S]*\.sort/)
  assert.match(route,
    /SELLER_OS_PUBLISHER_BATCH_CHILD_BINDING_CHANGED/)
  assert.match(route, /Number\(child\.attempt_count \?\? 0\) <= 2/)
  assert.match(route, /marketplace_write_count", 0/)
  assert.match(route, /\.is\("approval_id", null\)\.is\("execution_id", null\)/)
  assert.match(route,
    /text\(payload\.errorClass\) \|\| text\(payload\.error\)/)
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
  assert.match(page, /batchButtonN \?\? "—"/)
  assert.doesNotMatch(page, /batchSummary\?\.batchButtonN \?\? 0/)
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

test("publisher authority loads before legacy Quick Pick without concurrent read amplification", () => {
  const page = read("app/admin/ebay/quick-pick/page.tsx")
  const cohortRead = page.indexOf('"/api/admin/ebay/publisher-cohort"')
  const quickPickRead = page.indexOf('"/api/admin/ebay/luna-quick-pick"')
  assert.ok(cohortRead > 0)
  assert.ok(quickPickRead > cohortRead)
  assert.doesNotMatch(page, /Promise\.allSettled/)
  assert.match(page, /window\.setTimeout\(resolve, 1_500\)/)
  assert.match(page, /SELLER_OS_READ_MODEL_HTTP_/)
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
  assert.match(runtime, /getEbayDraftWriteEnvironmentBoundary/)
  assert.match(runtime, /branchMatches: boundary\.branchMatches/)
  assert.match(runtime, /observedGitRef: boundary\.observedGitRef/)
  assert.match(runtime, /branchAuthority: boundary\.branchAuthority/)
  assert.match(runtime, /x-vercel-protection-bypass/)
  assert.match(runtime, /PUBLISHER_BATCH_RUNTIME_UPSTREAM_NON_JSON/)
  assert.match(runtime, /marketplaceWrites: 0/)
  assert.match(runtimeHandler, /recoverQuickPickPublisherPackagesV1/)
  assert.match(publisher,
    /SELLER_OS_PUBLISHER_BATCH_RUNTIME_CONFIGURATION_MISSING/)
  assert.match(runtimeHandler, /publisherBatchRuntimeFailure\(error\)/)
  assert.ok(runtimeHandler.indexOf("recoverQuickPickPublisherPackagesV1({") <
    runtimeHandler.indexOf("seller_os_publisher_batch_authorizations_v1"))
})

test("service-role cohort audit resolves the unique owner without creating a session", () => {
  const route = read("app/api/admin/ebay/publisher-cohort/route.ts")
  const cohort = read("lib/ebay/seller-os-publisher-operational-cohort-v1.ts")
  assert.match(route, /authenticationMode !== "service_role"/)
  assert.match(route, /supabase\.auth\.admin\.listUsers/)
  assert.match(route, /owners\.length !== 1/)
  assert.match(route, /sellerOsAccessRoleFromUser/)
  assert.match(route, /authSessionsCreated: 0/)
  assert.doesNotMatch(route, /generateLink|signInWith|magiclink/i)
  assert.match(cohort, /publish_http_status,sanitized_result/)
  assert.doesNotMatch(cohort, /last_http_status,error_details/)
  assert.match(cohort, /COHORT_\$\{failedAuthority\[0\]\}_READ_FAILED/)
  assert.match(cohort, /publicationPhase === "monitor_registered"/)
  assert.match(cohort, /publishedItemId:[\s\S]*publication\.listing_id/)
  assert.match(cohort, /publishedCount:/)
  const page = read("app/admin/ebay/quick-pick/page.tsx")
  assert.match(page, /batchRuntime\.published !== true/)
})

test("blocked runtime exposes bounded boundary diagnostics without values", () => {
  const middleware = read("middleware.ts")
  const boundary = read("lib/ebay/environment-boundaries.ts")
  assert.match(middleware,
    /getBlockedEbayProResponsePayload\(pathname, boundary\)/)
  assert.match(boundary, /failedDedicatedPreprodSignal/)
  assert.match(boundary, /draftBranchMatches/)
  assert.match(boundary, /valuesDisplayed: false/)
})
