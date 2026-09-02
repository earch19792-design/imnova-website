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
  const historyLoad = route.indexOf(
    "const correctedRetryHistory = await loadCorrectedPackageRetryHistory",
    route.indexOf("async function executeDraft"),
  )
  const contextLoad = route.indexOf(
    "let context = await loadPackageContext",
    route.indexOf("async function executeDraft"),
  )
  assert.ok(historyLoad > 0)
  assert.ok(contextLoad > historyLoad)
  assert.match(
    route,
    /resolveCorrectedPackageRetryCollisionSelfLineageV1/,
  )
  assert.match(route, /collisionSelfLineage/)
  assert.match(route, /historicalSelfLineage:/)
})

test("canonical GET readiness resolves corrected lineage before collision reads", () => {
  const getStart = route.indexOf("export async function GET(req: Request)")
  const postStart = route.indexOf("export async function POST(req: Request)")
  const get = route.slice(getStart, postStart)
  const historyLoad = get.indexOf(
    "await loadCorrectedPackageRetryHistory",
  )
  const lineageResolution = get.indexOf(
    "resolveCorrectedPackageRetryCollisionSelfLineageV1",
  )
  const initialContext = get.indexOf(
    "const initialContext = await loadPackageContext",
  )
  assert.ok(historyLoad > 0)
  assert.ok(lineageResolution > historyLoad)
  assert.ok(initialContext > lineageResolution)
  assert.match(get, /fingerprint,\s*collisionSelfLineage,\s*true,/)
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

test("workspace keeps a resolved prewrite 409 in history, not the current header", () => {
  assert.match(
    workspace,
    /historicalResolvedDraftOnlyPrewrite409\(error\)/,
  )
  assert.match(
    workspace,
    /const currentHeaderError = historicalHeaderPrewrite409 \? "" : error/,
  )
  assert.match(workspace, /data-current-workspace-header-status="SAFE_RETRY_READY"/)
  assert.match(workspace, /data-header-status-source="CANONICAL_DRAFT_ONLY_GET_READINESS"/)
  assert.match(workspace, /data-current-header-blocked="false"/)
  assert.match(workspace, /data-historical-header-http-409/)
  assert.match(workspace, /data-header-http-409-attempt-id="NONE_PREWRITE"/)
  assert.match(workspace, /\{currentHeaderError && <p role="alert"/)
})
