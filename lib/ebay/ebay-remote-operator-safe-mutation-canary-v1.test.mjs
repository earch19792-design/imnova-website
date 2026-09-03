import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

let implementation = readFileSync(
  "lib/ebay/ebay-remote-operator-safe-mutation-canary-v1.ts", "utf8")
implementation = implementation
  .replace(/import \{ createHash \} from "node:crypto"\n/, `import { createHash } from "node:crypto"\n`)
  .replace(/import type \{ SupabaseClient \} from "@supabase\/supabase-js"\n\n/, "")
  .replace(/import \{\n  isProvenSupplierLinkageV1,[\s\S]*?\} from "\.\/commercial-monitor-readonly-contract"\n/,
    `const isProvenSupplierLinkageV1 = (stock) =>
  stock.supplierLinkageStatus === "CERTIFIED" ||
  stock.supplierLinkageStatus === "EXACT_PROVEN"\n`)
  .replace(/import \{\n  ACTIVE_LISTING_TITLE_REVISION_CONFIRMATION,[\s\S]*?\} from "\.\/ebay-active-listing-title-revision-service"\n/,
    `const ACTIVE_LISTING_TITLE_REVISION_CONFIRMATION = "CONFIRM"
const applyPreparedVerifiedActiveListingTitle = async () => ({})\n`)
  .replace(/import \{ buildVerifiedEbayTitle \} from "\.\/ebay-verified-title-strategy"\n/,
    `const buildVerifiedEbayTitle = ({ productTitle, color }) =>
  productTitle.toLowerCase().includes(color.toLowerCase())
    ? productTitle : productTitle + " " + color\n`)
  .replace(/import \{\n  SELLER_OS_ACCESS_ROLES,[\s\S]*?\} from "\.\.\/seller-os-access-control"\n/,
    `const SELLER_OS_ACCESS_ROLES = {
  remoteLiveOptimizationOperator: "REMOTE_LIVE_OPTIMIZATION_OPERATOR",
}
const sellerOsAccessRoleFromUser = (user) => user?.app_metadata?.role ?? null\n`)
const compiled = ts.transpileModule(implementation, { compilerOptions: {
  module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022,
} }).outputText
const { REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORIZATION_VERSION,
  REMOTE_OPERATOR_SAFE_TITLE_CANARY_STRATEGY,
  authorizeRemoteOperatorSafeMutationCanaryV1,
  remoteOperatorSafeTitleCanaryAuthorizationDigestV1,
  selectRemoteOperatorSafeMutationCanaryV1 } = await import(
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
const accountKey = "EBAY_US:preprod-safe-title-canary"

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
          evidenceDigest: truthDigest,
          stock: { state: "IN_STOCK_SUPPLIER_STATED", freshness: "FRESH",
            exactIdentityVerified: true },
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
    accountKey, listings: [exactListing()],
    commercialExceptions: [canonicalSignal()],
    ...exactLineage(), authorizations: [], operatorUserId: operatorId,
    executionEnabled: true, ...overrides,
  })
}

function authorizationSupabaseMock() {
  let authorization = null
  let writeAttempts = 0
  const dataFor = (table) => {
    if (table === "ebay_manual_listing_links") {
      return exactLineage().manualListingLinks
    }
    if (table === "ebay_listing_packages") {
      return exactLineage().listingPackages
    }
    if (table === "ebay_active_listings") {
      return exactLineage().activeListings
    }
    if (table === "ebay_authorized_listing_publications") {
      return exactLineage().publications
    }
    if (table === "ebay_active_listing_title_revision_executions") {
      return authorization ? [authorization] : []
    }
    return []
  }
  return {
    get writeAttempts() { return writeAttempts },
    get authorization() { return authorization },
    from(table) {
      let operation = "read"
      let ordered = false
      let inserted = null
      const builder = {
        select() { return builder },
        eq() { return builder },
        in() { return builder },
        order() { ordered = true; return builder },
        upsert(payload, options) {
          operation = "upsert"
          writeAttempts += 1
          assert.deepEqual(options, {
            onConflict: "idempotency_key_hash", ignoreDuplicates: true,
          })
          inserted = { id: "11111111-1111-4111-8111-111111111111",
            phase: "preview_ready", candidate_id: null, ...payload }
          return builder
        },
        maybeSingle() {
          if (operation === "upsert") {
            authorization = inserted
            return Promise.resolve({ data: { id: authorization.id }, error: null })
          }
          if (table ===
              "ebay_active_listing_title_revision_executions") {
            return Promise.resolve({ data: authorization, error: null })
          }
          return Promise.resolve({ data: null, error: null })
        },
        then(resolve, reject) {
          const value = { data: dataFor(table), error: null }
          return Promise.resolve(value).then(resolve, reject)
        },
      }
      void ordered
      return builder
    },
  }
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
  assert.equal(result.candidate.authorizationVersion,
    REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORIZATION_VERSION)
  assert.match(result.candidate.authorizationDigest, /^sha256:[0-9a-f]{64}$/)
  assert.equal(result.candidate.authorizationInvalidated, false)
  assert.equal(result.candidate.executionBlocked, true)
  assert.equal(result.candidate.humanExplanation,
    "Agrega el color Black, confirmado para este producto.")
  assert.equal(result.candidate.currentValuePreconditionEnforced, true)
  assert.equal(result.candidate.maximumMarketplaceWrites, 1)
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
  const unprovenIdentity = exactLineage()
  unprovenIdentity.listingPackages[0].package_data.evidenceSnapshot.assessment
    .productTruth.stock.exactIdentityVerified = false
  assert.equal(select({ ...unprovenIdentity }), null)
})

test("an exact owner authorization enables only the bound operator", () => {
  const authorizationId = "11111111-1111-4111-8111-111111111111"
  const candidate = select().candidate
  const requestHash = createHash("sha256").update(JSON.stringify({
    authorizationVersion:
      REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORIZATION_VERSION,
    authorizationDigest: candidate.authorizationDigest,
    ownerUserId: ownerId,
    operatorUserId: operatorId,
  })).digest("hex")
  const authorization = { id: authorizationId, actor_user_id: operatorId,
    marketplace_account_key: accountKey,
    execution_authority: "REMOTE_OPERATOR_SAFE_TITLE_CANARY",
    listing_package_id: packageId, opportunity_id: opportunityId,
    manual_listing_link_id: linkId, active_listing_id: activeId,
    ebay_item_id: itemId, ebay_sku: sku,
    source_authority: "COMMERCIAL_EXCEPTION_QUEUE",
    source_signal_id: "exception_49e4f02cd5707fb9d11365e8",
    source_observed_at: "2026-09-02T21:28:00.000Z",
    authorized_current_title: currentTitle,
    authorized_current_title_hash:
      createHash("sha256").update(currentTitle).digest("hex"),
    target_title: `${currentTitle} Black`, product_truth_reference: truthDigest,
    target_title_hash: createHash("sha256")
      .update(`${currentTitle} Black`).digest("hex"),
    title_strategy_version: REMOTE_OPERATOR_SAFE_TITLE_CANARY_STRATEGY,
    authorization_contract_version:
      REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORIZATION_VERSION,
    authorization_digest: candidate.authorizationDigest,
    idempotency_key_hash: candidate.authorizationDigest.slice(7),
    request_hash: requestHash, owner_approved_by: ownerId,
    owner_approved_at: "2026-09-02T22:00:00.000Z",
    phase: "preview_ready" }
  const accepted = select({ authorizations: [authorization] })
  assert.equal(accepted.candidate.authorizationId, authorizationId)
  assert.equal(accepted.candidate.ownerApprovalStatus, "AUTHORIZED")
  assert.equal(accepted.candidate.applyAvailable, true)
  assert.equal(accepted.candidate.executionBlocked, false)
  const other = select({ authorizations: [authorization],
    operatorUserId: "22222222-2222-4222-8222-222222222222" })
  assert.equal(other.candidate.authorizationId, null)
  assert.equal(other.candidate.applyAvailable, false)
  const invalidated = select({ authorizations: [{ ...authorization,
    phase: "terminal_failure",
    last_error_code: "REMOTE_OPERATOR_CANARY_AUTHORIZATION_INVALIDATED",
  }] })
  assert.equal(invalidated.candidate.ownerApprovalStatus, "INVALIDATED")
  assert.equal(invalidated.candidate.authorizationInvalidated, true)
  assert.equal(invalidated.candidate.executionBlocked, true)
  assert.equal(invalidated.candidate.applyAvailable, false)
})

test("authorization digest changes with every owner-approved exact value", () => {
  const base = { accountKey, ebayItemId: itemId, ebaySku: sku,
    currentValue: currentTitle, proposedValue: `${currentTitle} Black`,
    sourceSignalId: canonicalSignal().dedupeIdentity,
    observedAt: canonicalSignal().lastObservationTime,
    productTruthReference: truthDigest, listingPackageId: packageId,
    opportunityId, manualListingLinkId: linkId, activeListingId: activeId,
    operatorUserId: operatorId }
  const digest = remoteOperatorSafeTitleCanaryAuthorizationDigestV1(base)
  assert.notEqual(remoteOperatorSafeTitleCanaryAuthorizationDigestV1({
    ...base, ebayItemId: "366634810966",
  }), digest)
  assert.notEqual(remoteOperatorSafeTitleCanaryAuthorizationDigestV1({
    ...base, currentValue: `${currentTitle} Black`,
  }), digest)
  assert.notEqual(remoteOperatorSafeTitleCanaryAuthorizationDigestV1({
    ...base, proposedValue: `${currentTitle} Black Film`,
  }), digest)
})

test("owner approval creates-or-reads one exact row with durable readback", async () => {
  const supabase = authorizationSupabaseMock()
  const candidate = select().candidate
  const input = {
    supabase,
    accountKey,
    listings: [exactListing()],
    commercialExceptions: [canonicalSignal()],
    ownerUserId: ownerId,
    operatorUserId: operatorId,
    expectedItemId: itemId,
    expectedSourceSignalId: candidate.sourceSignalId,
    expectedCurrentValue: candidate.currentValue,
    expectedProposedValue: candidate.proposedValue,
    expectedAuthorizationVersion: candidate.authorizationVersion,
    expectedAuthorizationDigest: candidate.authorizationDigest,
    executionEnabled: true,
  }
  const first = await authorizeRemoteOperatorSafeMutationCanaryV1(input)
  assert.equal(first.databaseWriteAttempted, true)
  assert.equal(first.databaseWriteResult, "CREATED_EXACT_AUTHORIZATION")
  assert.equal(first.durableReadbackPass, true)
  assert.equal(first.candidate.ownerApprovalStatus, "AUTHORIZED")
  assert.equal(first.candidate.authorizationId,
    "11111111-1111-4111-8111-111111111111")
  assert.equal(supabase.writeAttempts, 1)

  const second = await authorizeRemoteOperatorSafeMutationCanaryV1(input)
  assert.equal(second.databaseWriteAttempted, false)
  assert.equal(second.databaseWriteResult, "EXISTING_EXACT_AUTHORIZATION")
  assert.equal(second.durableReadbackPass, true)
  assert.equal(second.candidate.authorizationId,
    first.candidate.authorizationId)
  assert.equal(supabase.writeAttempts, 1)
  assert.equal(supabase.authorization.authorization_digest,
    candidate.authorizationDigest)
})

test("storage and route preserve owner authority, one write, and official readback", () => {
  const migration = readFileSync(
    "supabase/migrations/20260902223000_remote_operator_safe_title_canary_v1.sql",
    "utf8")
  const bindingMigration = readFileSync(
    "supabase/migrations/20260902235000_remote_operator_safe_title_authorization_binding_v1.sql",
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
  assert.match(bindingMigration, /authorization_contract_version/)
  assert.match(bindingMigration, /authorization_digest/)
  assert.match(bindingMigration,
    /authorization_digest = 'sha256:' \|\| idempotency_key_hash/)
  assert.match(bindingMigration, /AUTHORIZATION_BINDING_IMMUTABLE/)
  assert.match(bindingMigration, /force row level security/)
  assert.match(service, /operator_idempotency_key_hash/)
  assert.match(service, /applyPreparedVerifiedActiveListingTitle/)
  assert.match(executor, /ReviseFixedPriceItem/)
  assert.match(executor, /readOfficialSnapshot/)
  assert.match(executor, /AUTHORIZED_CURRENT_CHANGED/)
  assert.match(executor, /REMOTE_OPERATOR_CANARY_AUTHORIZATION_INVALIDATED/)
  assert.match(executor, /eq\("ebay_write_attempt_count", 0\)/)
  const applyContract = executor.slice(executor.indexOf(
    "export async function applyPreparedVerifiedActiveListingTitle"))
  assert.ok(applyContract.indexOf("before.title !== expectedCurrentTitle") <
    applyContract.indexOf('callName: "ReviseFixedPriceItem"'))
  assert.match(route, /AUTHORIZE_SAFE_MUTATION_CANARY/)
  assert.match(route, /SELLER_OS_ACCESS_ROLES\.owner/)
  assert.match(route, /APPLY_SAFE_MUTATION_CANARY/)
  assert.match(route,
    /SELLER_OS_ACCESS_ROLES\.remoteLiveOptimizationOperator/)
  assert.match(route, /postActionReadbackPass: verified/)
  assert.match(route, /success: verified \|\| verifying/)
  assert.match(route, /status: verified \? 200 : verifying \? 202 : 409/)
  assert.match(route, /unknownResultAutoRetry: false/)
  assert.match(route, /expectedAuthorizationDigest/)
  assert.match(route, /expectedCurrentValue/)
  assert.match(route, /expectedProposedValue/)
  assert.match(route, /candidateRefreshAttempted/)
  assert.match(route, /loadSellerOsAssistantMonitorV1/)
  assert.match(route, /REMOTE_OPERATOR_OWNER_AUTHORIZATION_RESULT_V1/)
  assert.match(service, /onConflict: "idempotency_key_hash"/)
  assert.match(service, /REMOTE_OPERATOR_CANARY_AUTHORIZATION_READBACK_FAILED/)
  assert.match(page, /remote-title-canary:/)
  assert.match(page, /Aplicando cambio…/)
  assert.match(page, /Verificando con eBay…/)
  assert.match(page, /Cambio confirmado ✓/)
  assert.match(page, /Revisar propuesta/)
  assert.match(page, /Propuesta Seller OS/)
  assert.match(page, /Aplicar esta mejora/)
  assert.match(page,
    /Confirmo que autorizo para este Item ID el valor actual y la propuesta exacta/)
  assert.match(page, /canApply && activeCanary\.ownerApprovalStatus ===[\s\S]*"PENDING_OWNER_APPROVAL"\) return null/)
  assert.doesNotMatch(page, />Canary LIVE seguro</)
  assert.doesNotMatch(page, />Autorizar este canary</)
  assert.doesNotMatch(service,
    /price|promoted|EndFixedPriceItem|quantity|buyer.?message/i)
})
