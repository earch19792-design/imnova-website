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
  assert.doesNotMatch(route, /recoverPublisherBatchPrewriteObservabilityGapsV1/)
  assert.match(route, /canonicalPublisherBatchJson/)
  assert.match(route, /Object\.entries\(value as JsonRecord\)[\s\S]*\.sort/)
  assert.match(route,
    /SELLER_OS_PUBLISHER_BATCH_CHILD_BINDING_CHANGED/)
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
  const readiness = read("lib/ebay/ebay-draft-only-readiness.ts")
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
  assert.doesNotMatch(batchRuntime, /persistQuickPickOwnerReviewV1/)
  assert.match(readiness, /SELLER_OS_PUBLISHER_BATCH_AUTHORIZATION_V1/)
  assert.match(readiness, /authorizedImagesDigest/)
  assert.match(readiness, /quickPickMaterialBinding\.imagesDigest/)
  assert.doesNotMatch(batchRuntime, /package_data|ensureAutomaticLunaSupplierImagesV1/)
  assert.match(batchRuntime, /candidate\.publisherRuntimeEligible !== true/)
  assert.match(batchRuntime,
    /conditionId = text\(binding\.condition\)/)
  assert.match(batchRuntime,
    /condition = text\(candidate\.publisherConditionCode\)/)
  assert.match(batchRuntime,
    /candidate\.publisherConditionId !== conditionId/)
  assert.doesNotMatch(batchRuntime, /condition:\s*"NEW"/)
  assert.match(batchRuntime, /approveDraft\(/)
  assert.match(batchRuntime, /executeDraft\(/)
  assert.match(batchRuntime, /prepareFinalPublication\(/)
  assert.match(batchRuntime, /publishFinalPublication\(/)
  assert.doesNotMatch(batchRuntime, /ITEM3438|FL-LONG-SPOONS|ITEM5313/)
  assert.match(batchRuntime, /Array\.isArray\(payload\.blockers\)/)
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
  assert.doesNotMatch(runtimeHandler, /recoverQuickPickPublisherPackagesV1/)
  assert.match(runtimeHandler, /READ_ONLY_PREFLIGHT_MUST_NOT_MUTATE_PACKAGE/)
  assert.match(publisher,
    /SELLER_OS_PUBLISHER_BATCH_RUNTIME_CONFIGURATION_MISSING/)
  assert.match(runtimeHandler, /publisherBatchRuntimeFailure\(error\)/)
})

test("preauthorization package recovery is a separate bounded POST-only lane", () => {
  const route = read("app/api/cron/quick-pick-runtime-recovery/route.ts")
  const migration = read(
    "supabase/migrations/20260905155900_seller_os_publisher_preauthorization_recovery_v1.sql",
  )
  assert.match(route, /export async function POST/)
  assert.match(route, /recoverQuickPickPublisherPackagesV1/)
  assert.match(route, /PUBLISHER_PREAUTHORIZATION_RECOVERY/)
  assert.match(route, /preAuthorizationPreparationOnly: true/)
  assert.match(route, /activeAuthorizedPackagesExcluded: true/)
  assert.match(route, /ownerAuthorizationCreatedCount: 0/)
  assert.match(route, /marketplaceWrites: 0/)
  assert.match(route, /sellerOsPostOnlyGetResponseV1/)
  assert.match(migration, /PUBLISHER_PREAUTHORIZATION_RECOVERY/)
  assert.match(migration, /\/api\/cron\/quick-pick-runtime-recovery/)
  assert.match(migration, /'\*\/15 \* \* \* \*', 900/)
  assert.match(migration, /dispatch_seller_os_post_runtime_v1/)
})

test("database guards freeze authorized package, images and batch bindings", () => {
  const migration = read(
    "supabase/migrations/20260905152304_protect_authorized_publisher_package_immutability.sql",
  )
  assert.match(migration, /SELLER_OS_AUTHORIZED_PACKAGE_IMMUTABLE/)
  assert.match(migration, /SELLER_OS_AUTHORIZED_PACKAGE_IMAGES_IMMUTABLE/)
  assert.match(migration, /SELLER_OS_PUBLISHER_BATCH_BINDING_IMMUTABLE/)
  assert.match(migration, /new\.package_data is distinct from old\.package_data/)
  assert.match(migration, /before insert or update or delete on public\.ebay_listing_image_assets/)
  assert.match(migration, /'AUTHORIZED', 'CLAIMED', 'RUNNING', 'FAILED_RETRY_SAFE'/)
})

test("normal runtime atomically rearms only unchanged no-write preflight failures", () => {
  const migration = read(
    "supabase/migrations/20260905173500_seller_os_publisher_prewrite_recovery_v1.sql",
  )
  const route = read("app/api/admin/ebay/draft-only/route.ts")
  assert.match(migration,
    /rearm_seller_os_publisher_batch_prewrite_child_v1/)
  assert.match(migration, /child\.status = 'FAILED_BLOCKED'/)
  assert.match(migration, /child\.stage = 'PREFLIGHT'/)
  assert.match(migration, /child\.marketplace_write_count = 0/)
  assert.match(migration, /child\.approval_id is null/)
  assert.match(migration, /package_row\.updated_at <= batch\.authorized_at/)
  assert.match(migration,
    /quickPickMarketTestPackageV1,packageDigest/)
  assert.match(migration,
    /quickPickMarketTestPackageV1,authorizationBinding,imagesDigest/)
  assert.match(migration, /child\.attempt_count < 3/)
  assert.match(migration, /for update of child, batch, package_row/)
  assert.match(migration, /'FAILED_RETRY_SAFE'/)
  assert.match(migration, /'FAILED_BLOCKED', 'AMBIGUOUS_FAIL_CLOSED'/)
  assert.match(route,
    /candidate\?\.publisherRuntimeEligible === true/)
  assert.match(route,
    /rearm_seller_os_publisher_batch_prewrite_child_v1/)
  assert.match(route,
    /SELLER_OS_PUBLISHER_PREFLIGHT_RECOVERY_V1/)
  assert.match(route,
    /"AUTHORIZED", "RUNNING", "PARTIAL", "BLOCKED"/)
})

test("batch approval freezes package rows and preserves exact readback evidence", () => {
  const migration = read(
    "supabase/migrations/20260905180000_freeze_batch_packages_and_persist_readback_v1.sql",
  )
  const route = read("app/api/admin/ebay/draft-only/route.ts")
  const reconciliation = route.slice(
    route.indexOf("async function reconcilePublisherBatchOfficialReadbacksV1"),
    route.indexOf("async function resumeSellerOsPublisherBatchV1"),
  )
  assert.match(migration, /mismatch_classification jsonb/)
  assert.match(migration, /if not v_batch_authorized then[\s\S]*update public\.ebay_listing_packages/)
  assert.match(migration,
    /SELLER_OS_PUBLISHER_BATCH_AUTHORIZATION_V1/)
  assert.match(migration, /\^IMNOVA\[A-Z0-9\]\{16,32\}\$/)
  assert.match(migration,
    /from public\.seller_os_publisher_batch_children_v1 child[\s\S]*where child\.package_id = v_package_id/)
  assert.doesNotMatch(migration,
    /new\.package_data is distinct from old\.package_data/)
  assert.match(route, /quickPickBatchAuthorized/)
  assert.match(route,
    /listingPackage\.status === "ready_for_review" &&[\s\S]*quickPickBatchAuthorized/)
  assert.match(route, /publisherBatchFailureDetails/)
  assert.match(route, /mismatch_classification:/)
  assert.match(reconciliation, /readExactUnpublishedPublicationState/)
  assert.doesNotMatch(reconciliation,
    /approveDraft\(|executeDraft\(|publishFinalPublication\(/)
  assert.equal((route.match(/idempotentReplay: true,\n\s+execution:/g) ?? []).length, 2)
})

test("exact batch lineage resumes through semantic readback without a new Offer", () => {
  const migration = read(
    "supabase/migrations/20260905181500_resume_exact_batch_offer_lineage_v1.sql",
  )
  const route = read("app/api/admin/ebay/draft-only/route.ts")
  assert.match(migration, /EBAY_DRAFT_ONLY_REAPPROVAL_REQUIRED/)
  assert.match(migration, /EXACT_BATCH_APPROVAL_LINEAGE_RESUME_SAFE/)
  assert.match(migration, /approval_id = coalesce\(approval_id, v_approval\.id\)/)
  assert.doesNotMatch(migration, /package_row\.updated_at <= batch\.authorized_at/)
  assert.match(route,
    /hasExactPublisherBatchApprovalContinuationAuthorityV1/)
  assert.match(route, /approvalExpired = Date\.parse\(approval\.expires_at\) <= Date\.now\(\)[\s\S]*!batchContinuationAuthority/)
  assert.match(route, /maximumReadbacksPerDispatch/)
  assert.match(route, /retry_after_at: safe \? new Date\(\)\.toISOString\(\)/)
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
