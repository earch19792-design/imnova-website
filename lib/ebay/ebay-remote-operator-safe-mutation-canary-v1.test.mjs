import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

let implementation = readFileSync(
  "lib/ebay/ebay-remote-operator-safe-mutation-canary-v1.ts", "utf8")
implementation = implementation
  .replace(/import \{ createHash \} from "node:crypto"\n/, `import { createHash } from "node:crypto"\n`)
  .replace(/import type \{ SupabaseClient \} from "@supabase\/supabase-js"\n\n/, "")
  .replace(/import \{[\s\S]*?\} from "\.\/commercial-monitor-readonly-contract"\n/,
    `const isProvenSupplierLinkageV1 = (stock) =>
  stock.supplierLinkageStatus === "CERTIFIED" ||
  stock.supplierLinkageStatus === "EXACT_PROVEN"\n`)
  .replace(/import \{[\s\S]*?\} from "\.\/ebay-active-listing-title-revision-service"\n/,
    `const ACTIVE_LISTING_TITLE_REVISION_CONFIRMATION = "CONFIRM"
const applyPreparedVerifiedActiveListingTitle = async () => ({})\n`)
  .replace(/import \{ buildVerifiedEbayTitle \} from "\.\/ebay-verified-title-strategy"\n/,
    `const buildVerifiedEbayTitle = ({ productTitle, color }) =>
  productTitle.toLowerCase().includes(color.toLowerCase())
    ? productTitle : productTitle + " " + color\n`)
  .replace(/import \{[\s\S]*?\} from "\.\.\/seller-os-access-control"\n/,
    `const SELLER_OS_ACCESS_ROLES = {
  remoteLiveOptimizationOperator: "REMOTE_LIVE_OPTIMIZATION_OPERATOR",
}
const sellerOsAccessRoleFromUser = (user) => user?.app_metadata?.role ?? null\n`)
const compiled = ts.transpileModule(implementation, { compilerOptions: {
  module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022,
} }).outputText
const { selectRemoteOperatorSafeMutationCanaryV1 } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`)

const itemId = "366634810965"
const ownerId = "75c9d5d5-03d2-478e-8999-714ba84ee994"
const operatorId = "95fe998d-d772-4dee-90fb-f58807503663"
const packageId = "3a394c94-108b-4ca0-b373-5e589dc4a652"
const opportunityId = "0281c5dc-669c-4de0-a94d-a8c7e7621c2a"
const linkId = "9dd12341-6596-4b90-bd07-66af764edd75"
const activeId = "46036f7e-97dd-4aac-9982-28a372bfcb9e"
const sku = "IMNOVA3A394C94108B4CA0B3735E589DC4A652"
const currentTitle =
  "Window Privacy Film One Way 23.6 in x 9.84 ft Tint for Home"
const truthDigest = `sha256:${"a".repeat(64)}`

function exactListing(overrides = {}) {
  return {
    key: `listing:${itemId}`,
    identity: { itemId, title: currentTitle, sku,
      marketplaceCertification: { status: "US_CERTIFIED" },
      ...overrides.identity },
    discovery: { livePresence: { status: "LIVE_ACTIVE",
      source: "EBAY_TRADING_GET_MY_EBAY_SELLING" } },
    stock: { state: "IN_STOCK_SIGNAL", freshness: { status: "FRESH" },
      supplierLinkageStatus: "CERTIFIED", supplierProductId: "9220837146848",
      supplierVariantId: "48809648488672", supplierSku: "ITEM3404",
      ...overrides.stock },
  }
}

function canonicalSignal(overrides = {}) {
  return { entityKey: itemId, entityType: "EBAY_LIVE_LISTING",
    classification: "ACTIONABLE_COMMERCIAL",
    reasonCodes: ["LOW_CTR_WITH_SUFFICIENT_IMPRESSIONS"],
    recommendedAction: "IMPROVE_CTR", actionBlockedByEvidence: false,
    experimentProtectionExists: false,
    lastObservationTime: "2026-09-02T21:28:00.000Z",
    dedupeIdentity: "exception_49e4f02cd5707fb9d11365e8", material: true,
    ...overrides }
}

function exactLineage() {
  return {
    manualListingLinks: [{ id: linkId, opportunity_id: opportunityId,
      candidate_key: "smart-stocking:EBAY_US:9220837146848:48809648488672",
      created_by: ownerId, ebay_item_id: itemId,
      connector_listing_id: activeId, connector_ebay_sku: sku,
      verification_status: "verified",
      verification_method: "EBAY_TRADING_GET_ITEM_READONLY",
      connector_listing_status: "active" }],
    listingPackages: [{ id: packageId, opportunity_id: opportunityId,
      candidate_key: "smart-stocking:EBAY_US:9220837146848:48809648488672",
      status: "approved", created_by: ownerId, package_data: {
        title: currentTitle, aspects: { Type: "Window Film", Color: "Black" },
        evidenceSnapshot: { assessment: { productTruth: {
          authorityClass: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
          evidenceDigest: truthDigest, exactIdentityVerified: true,
          lunaProductId: "9220837146848", lunaVariantId: "48809648488672",
          supplierSku: "ITEM3404", humanConfirmedAspectEvidenceV1: [{
            aspectName: "Color", normalizedValue: "Black",
            provenance: "OPERATOR_CONFIRMED_EXACT_SUPPLIER_EVIDENCE",
            authorityClass:
              "SELLER_OS_HUMAN_CONFIRMED_PRODUCT_TRUTH_EVIDENCE_V1",
            confirmedBy: ownerId, listingPackageId: packageId,
            evidenceDigest: `sha256:${"b".repeat(64)}`,
          }],
        } } },
      } }],
    activeListings: [{ id: activeId, ebay_item_id: itemId, ebay_sku: sku,
      listing_status: "active" }],
    publications: [{ id: "dfa50de8-0427-44a1-bbf9-0b2170df99f9",
      listing_package_id: packageId, listing_id: itemId,
      phase: "monitor_registered",
      monitor_registered_at: "2026-08-28T19:39:15.159Z" }],
  }
}

function select(overrides = {}) {
  return selectRemoteOperatorSafeMutationCanaryV1({
    listings: [exactListing()], commercialExceptions: [canonicalSignal()],
    ...exactLineage(), authorizations: [], operatorUserId: operatorId,
    executionEnabled: true, ...overrides,
  })
}

test("selects one reversible title enrichment from canonical evidence only", () => {
  const result = select()
  assert.ok(result)
  assert.equal(result.candidate.ebayItemId, itemId)
  assert.equal(result.candidate.currentLive, true)
  assert.equal(result.candidate.actionType, "TITLE_ENRICHMENT")
  assert.equal(result.candidate.currentValue, currentTitle)
  assert.equal(result.candidate.proposedValue, `${currentTitle} Black`)
  assert.equal(result.candidate.sourceAuthority, "COMMERCIAL_EXCEPTION_QUEUE")
  assert.equal(result.candidate.productTruthSupported, true)
  assert.equal(result.candidate.ownerApprovalRequired, true)
  assert.equal(result.candidate.ownerApprovalStatus, "PENDING_OWNER_APPROVAL")
  assert.equal(result.candidate.authorizationId, null)
  assert.equal(result.candidate.reversible, true)
  assert.equal(result.candidate.economicsChanged, false)
  assert.equal(result.candidate.idempotency, true)
  assert.equal(result.candidate.doubleTapSafe, true)
  assert.equal(result.candidate.ambiguousOutcomeAutoRetry, false)
})

test("fails closed on stale stock, blocked signal, or missing exact fact", () => {
  assert.equal(select({ listings: [exactListing({ stock: {
    freshness: { status: "STALE" },
  } })] }), null)
  assert.equal(select({ commercialExceptions: [canonicalSignal({
    actionBlockedByEvidence: true,
  })] }), null)
  const lineage = exactLineage()
  lineage.listingPackages[0].package_data.evidenceSnapshot.assessment
    .productTruth.humanConfirmedAspectEvidenceV1 = []
  assert.equal(select({ ...lineage }), null)
})

test("an exact owner authorization enables only the bound operator", () => {
  const authorizationId = "11111111-1111-4111-8111-111111111111"
  const authorization = { id: authorizationId, actor_user_id: operatorId,
    execution_authority: "REMOTE_OPERATOR_SAFE_TITLE_CANARY",
    ebay_item_id: itemId, source_authority: "COMMERCIAL_EXCEPTION_QUEUE",
    source_signal_id: "exception_49e4f02cd5707fb9d11365e8",
    authorized_current_title: currentTitle,
    target_title: `${currentTitle} Black`, product_truth_reference: truthDigest,
    phase: "preview_ready" }
  const accepted = select({ authorizations: [authorization] })
  assert.equal(accepted.candidate.authorizationId, authorizationId)
  assert.equal(accepted.candidate.ownerApprovalStatus, "AUTHORIZED")
  assert.equal(accepted.candidate.applyAvailable, true)
  const other = select({ authorizations: [authorization],
    operatorUserId: "22222222-2222-4222-8222-222222222222" })
  assert.equal(other.candidate.authorizationId, null)
  assert.equal(other.candidate.applyAvailable, false)
})

test("storage and route preserve owner authority, one write, and official readback", () => {
  const migration = readFileSync(
    "supabase/migrations/20260902223000_remote_operator_safe_title_canary_v1.sql",
    "utf8")
  const service = readFileSync(
    "lib/ebay/ebay-remote-operator-safe-mutation-canary-v1.ts", "utf8")
  const executor = readFileSync(
    "lib/ebay/ebay-active-listing-title-revision-service.ts", "utf8")
  const route = readFileSync(
    "app/api/admin/ebay/live-optimization-operator/route.ts", "utf8")
  const page = readFileSync(
    "app/admin/remote-live-optimization-operator.tsx", "utf8")
  assert.match(migration, /REMOTE_OPERATOR_SAFE_TITLE_CANARY/)
  assert.match(migration, /source_authority = 'COMMERCIAL_EXCEPTION_QUEUE'/)
  assert.match(migration, /owner_approved_by <> actor_user_id/)
  assert.match(migration, /ebay_write_attempt_count > 1/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /revoke all on table[\s\S]*public, anon, authenticated/)
  assert.match(service, /operator_idempotency_key_hash/)
  assert.match(service, /applyPreparedVerifiedActiveListingTitle/)
  assert.match(executor, /ReviseFixedPriceItem/)
  assert.match(executor, /readOfficialSnapshot/)
  assert.match(executor, /AUTHORIZED_CURRENT_CHANGED/)
  assert.match(route, /AUTHORIZE_SAFE_MUTATION_CANARY/)
  assert.match(route, /SELLER_OS_ACCESS_ROLES\.owner/)
  assert.match(route, /APPLY_SAFE_MUTATION_CANARY/)
  assert.match(route,
    /SELLER_OS_ACCESS_ROLES\.remoteLiveOptimizationOperator/)
  assert.match(route, /postActionReadbackPass: verified/)
  assert.match(route, /unknownResultAutoRetry: false/)
  assert.match(page, /remote-title-canary:/)
  assert.match(page, /Aplicando cambio…/)
  assert.match(page, /Verificando con eBay…/)
  assert.match(page, /Cambio confirmado ✓/)
  assert.doesNotMatch(service,
    /price|promoted|EndFixedPriceItem|quantity|buyer.?message/i)
})
