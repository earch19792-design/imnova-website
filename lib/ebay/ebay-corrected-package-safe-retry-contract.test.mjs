import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const route = readFileSync(
  new URL("../../app/api/admin/ebay/draft-only/route.ts", import.meta.url),
  "utf8",
)
const workspace = readFileSync(
  new URL(
    "../../app/admin/ebay/listing-workspace/page.tsx",
    import.meta.url,
  ),
  "utf8",
)
const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260902033208_scan_reader_corrected_package_safe_retry_rearm_v1.sql",
    import.meta.url,
  ),
  "utf8",
)

test("terminal publication history no longer owns the active Offer uniqueness slot", () => {
  assert.match(migration, /create unique index ebay_authorized_publication_offer_uidx[\s\S]*where phase <> 'terminal_failure'/)
  assert.match(migration, /historicalAttemptStatus', 'FAILED_RESOLVED'/)
  assert.match(migration, /CATEGORY_94861_REQUIRED_UPC_MISSING/)
})

test("corrected successor can only update inventory and must reuse its exact Offer", () => {
  assert.match(migration, /array\['createOrReplaceInventoryItem'\]::text\[\]/)
  assert.match(migration, /v_prior_publication\.offer_id is distinct from p_offer_id/)
  assert.match(migration, /v_prior_execution\.offer_id is distinct from p_offer_id/)
  assert.match(migration, /v_error->>'errorId' <> '25002'/)
  assert.match(migration, /createOfferCalled', false/)
  assert.doesNotMatch(
    migration,
    /permitted_operations[\s\S]{0,200}publishOffer/,
  )
})

test("only service role may claim or complete the corrected successor", () => {
  assert.match(migration, /revoke all on function public\.claim_ebay_corrected_package_retry_execution_v1[\s\S]*from public, anon, authenticated/)
  assert.match(migration, /grant execute on function public\.claim_ebay_corrected_package_retry_execution_v1[\s\S]*to service_role/)
  assert.match(migration, /grant execute on function public\.complete_ebay_corrected_package_retry_execution_v1[\s\S]*to service_role/)
})

test("route returns after corrected PUT and GET verification before createOffer", () => {
  const correctedBranch = route.indexOf(
    "if (correctedPackageSafeRetry && correctedRetryHistory)",
  )
  const correctedReturn = route.indexOf("return NextResponse.json({", correctedBranch)
  const genericOfferCreate = route.indexOf(
    "const offerResult = await createEbayUnpublishedOffer",
    correctedBranch,
  )
  assert.ok(correctedBranch > 0)
  assert.ok(correctedReturn > correctedBranch)
  assert.ok(genericOfferCreate > correctedReturn)
  assert.match(route, /correctedInventoryReadbackMatch: true/)
  assert.match(route, /existingOfferReadbackMatch: true/)
  assert.match(route, /createOfferCalled: false/)
})

test("corrected retry lineage is certified before the generic SKU collision guard", () => {
  const authorityLoad = route.indexOf(
    "await loadCorrectedPackageRetryCollisionAuthorityV1",
    route.indexOf("async function executeDraft"),
  )
  const contextLoad = route.indexOf(
    "let context = await loadPackageContext",
    route.indexOf("async function executeDraft"),
  )
  assert.ok(authorityLoad > 0)
  assert.ok(contextLoad > authorityLoad)
  assert.match(
    route,
    /loadCorrectedPackageRetryCollisionAuthorityV1/,
  )
  assert.match(route, /collisionSelfLineage/)
  assert.match(route, /const historicalSelfLineage = history/)
})

test("canonical GET readiness resolves corrected lineage before collision reads", () => {
  const getStart = route.indexOf("export async function GET(req: Request)")
  const postStart = route.indexOf("export async function POST(req: Request)")
  const get = route.slice(getStart, postStart)
  const lineageResolution = get.indexOf(
    "loadCorrectedPackageRetryCollisionAuthorityV1",
  )
  const initialContext = get.indexOf(
    "const initialContext = await loadPackageContext",
  )
  assert.ok(lineageResolution > 0)
  assert.ok(initialContext > lineageResolution)
  assert.match(get, /fingerprint,\s*collisionSelfLineage,\s*true,/)
})

test("GET, approve POST and executeDraft share corrected-retry collision authority", () => {
  const getStart = route.indexOf("export async function GET(req: Request)")
  const postStart = route.indexOf("export async function POST(req: Request)")
  const approveStart = route.indexOf("async function approveDraft(")
  const executeStart = route.indexOf("async function executeDraft(")
  const prepareStart = route.indexOf("async function prepareFinalPublication(")
  const get = route.slice(getStart, postStart)
  const approve = route.slice(approveStart, executeStart)
  const execute = route.slice(executeStart, prepareStart)
  for (const source of [get, approve, execute]) {
    assert.match(source, /loadCorrectedPackageRetryCollisionAuthorityV1/)
    assert.match(source, /collisionSelfLineage/)
    assert.match(source, /loadPackageContext\(/)
  }
  assert.match(
    approve,
    /correctedRetryCollisionAuthority\.collisionSelfLineage/,
  )
  assert.ok(
    approve.indexOf("loadCorrectedPackageRetryCollisionAuthorityV1")
      < approve.indexOf("context = await loadPackageContext"),
  )
})

test("workspace projects the old rejection as resolved history", () => {
  assert.match(workspace, /LISTO PARA REINTENTO SEGURO/)
  assert.match(workspace, /Intento anterior: falló por UPC requerido/)
  assert.match(workspace, /Category Policy ✓/)
  assert.match(workspace, /Offer UNPUBLISHED ✓/)
  assert.match(
    workspace,
    /publicationPhase === "terminal_failure" && !correctedPackageSafeRetryReady/,
  )
  assert.match(
    workspace,
    /correctedPackageSafeRetryCertified[\s\S]*draftState\.readiness\?\.ready === true[\s\S]*canonicalUiBlockers\.length === 0/,
  )
  assert.match(workspace, /data-workspace-contradictory-state-count/)
})

test("workspace hides only a specifically correlated resolved prewrite 409", () => {
  assert.match(
    workspace,
    /parseDraftOnlyPrewriteFailureV1/,
  )
  assert.match(
    workspace,
    /draftOnlyPrewriteFailureResolvedV1/,
  )
  assert.doesNotMatch(workspace, /historicalResolvedDraftOnlyPrewrite409/)
  assert.match(workspace, /const currentHeaderError = currentPrewriteFailure \? "" : error/)
  assert.match(workspace, /data-current-workspace-header-status="SAFE_RETRY_READY"/)
  assert.match(workspace, /data-header-status-source="CANONICAL_DRAFT_ONLY_GET_READINESS"/)
  assert.match(workspace, /data-current-header-blocked="false"/)
  assert.match(workspace, /data-current-header-blocked="true"/)
  assert.match(workspace, /data-historical-header-http-409/)
  assert.match(workspace, /data-header-http-409-request-id/)
  assert.match(workspace, /data-header-http-409-package-digest/)
  assert.match(workspace, /data-header-http-409-authorization-id/)
  assert.match(workspace, /\{currentHeaderError && <p role="alert"/)
})
