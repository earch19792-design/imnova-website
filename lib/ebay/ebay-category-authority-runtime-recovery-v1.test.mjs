import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const {
  projectFalseExactCategoryAuthorityRecoveryV1,
  prioritizeCategoryAuthorityRecoveryRowsV1,
  recoverFalseExactCategoryAuthorityRuntimeV1,
} = await import("./ebay-category-authority-runtime-recovery-v1.ts")

const candidateKey = `sha256:${"4".repeat(64)}`
const legacyPackage = (semanticCompatibility = null) => ({
  id: "11111111-1111-4111-8111-111111111111",
  account_key: "seller-os-preview",
  opportunity_id: "22222222-2222-4222-8222-222222222222",
  candidate_key: candidateKey,
  created_by: null,
  updated_at: "2026-09-04T12:00:00.000Z",
  package_data: {
    categoryId: "123",
    factoryPreparationAuthority: {
      contractVersion: "SELLER_OS_GENERAL_DURABLE_FACTORY_AUTHORITY_V1",
      authority: "SELLER_OS_DETERMINISTIC_FACTORY",
      humanApproved: false,
      reviewerUserId: null,
      evidenceDigest: `sha256:${"5".repeat(64)}`,
    },
    categoryResolverV1: {
      status: "AUTO_SELECTED",
      selectedCategoryId: "123",
      familyTypeFingerprint: `sha256:${"6".repeat(64)}`,
      authorityClass: "EXACT_PREVIOUSLY_CERTIFIED_CATEGORY",
      listingAcceptance: "UNKNOWN",
      semanticCompatibility,
    },
  },
})

test("legacy exact authority without semantic proof is generically recoverable", () => {
  const result = projectFalseExactCategoryAuthorityRecoveryV1(legacyPackage())
  assert.equal(result.eligible, true)
  assert.equal(result.reasonCode, "CATEGORY_SEMANTIC_AUTHORITY_UNPROVEN")
  assert.equal(result.oldCategoryId, "123")
})

test("owner claim does not shield a stale category-bound authorization", () => {
  const result = projectFalseExactCategoryAuthorityRecoveryV1({
    ...legacyPackage(),
    created_by: "33333333-3333-4333-8333-333333333333",
  })
  assert.equal(result.eligible, true)
  assert.equal(result.reasonCode, "CATEGORY_SEMANTIC_AUTHORITY_UNPROVEN")
})

test("matching semantic proof is idempotently excluded", () => {
  const fingerprint = `sha256:${"6".repeat(64)}`
  const result = projectFalseExactCategoryAuthorityRecoveryV1(legacyPackage({
    status: "PROVEN", categoryId: "123",
    familyTypeFingerprint: fingerprint,
    evidenceClass: "OFFICIAL_TITLE_SUGGESTION",
  }))
  assert.equal(result.eligible, false)
  assert.equal(result.reasonCode, "SEMANTIC_AUTHORITY_ALREADY_PROVEN")
})

test("persisted semantic proof remains retry eligible until package rematerialization completes", () => {
  const fingerprint = `sha256:${"6".repeat(64)}`
  const pending = legacyPackage({
    status: "PROVEN", categoryId: "123",
    familyTypeFingerprint: fingerprint,
    evidenceClass: "OFFICIAL_TITLE_SUGGESTION",
  })
  pending.package_data.categoryDerivedStateInvalidationV1 = {
    contractVersion: "SELLER_OS_CATEGORY_DERIVED_STATE_INVALIDATION_V1",
    packageReadinessInvalidated: true,
    packageRematerializedByRuntime: false,
  }
  const retry = projectFalseExactCategoryAuthorityRecoveryV1(pending)
  assert.equal(retry.eligible, true)
  assert.equal(retry.reasonCode,
    "CATEGORY_PACKAGE_REMATERIALIZATION_PENDING")
  pending.package_data.categoryDerivedStateInvalidationV1
    .packageRematerializedByRuntime = true
  assert.equal(projectFalseExactCategoryAuthorityRecoveryV1(pending).eligible,
    false)
})

test("runtime performs shared rematerialization then normal continuation", async () => {
  const materializeCalls = []
  const continuationCalls = []
  const result = await recoverFalseExactCategoryAuthorityRuntimeV1({
    supabase: {}, accountKey: "seller-os-preview",
    taxonomyReader: async () => { throw new Error("NOT_CALLED_BY_TEST_DOUBLE") },
    dependencies: {
      readRows: async () => [legacyPackage()],
      materialize: async (input) => {
        materializeCalls.push(input)
        return { listingReady: false, marketTestReady: true }
      },
      continueRuntime: async (input) => {
        continuationCalls.push(input)
        return { requiredSpecificsContinuation: { aiCallCount: 0 },
          minimumReadinessContinuation: {}, marketplaceWrites: 0 }
      },
    },
  })
  assert.equal(result.status, "PASS")
  assert.equal(result.rematerializedPackageCount, 1)
  assert.equal(materializeCalls.length, 1)
  assert.equal(materializeCalls[0].opportunityId,
    "22222222-2222-4222-8222-222222222222")
  assert.equal(continuationCalls.length, 1)
  assert.deepEqual(continuationCalls[0].candidateKeys, [candidateKey])
  assert.equal(continuationCalls[0].scopeMode, "EXACT_REQUEST")
  assert.equal(continuationCalls[0].trigger, "OVERNIGHT_ENRICHMENT")
  assert.equal(result.codexCategorySelection, 0)
  assert.equal(result.marketplaceWrites, 0)
})

test("bounded recovery prioritizes the current owner-ready cohort", () => {
  const ready = `sha256:${"7".repeat(64)}`
  const background = `sha256:${"8".repeat(64)}`
  const ordered = prioritizeCategoryAuthorityRecoveryRowsV1([
    { candidate_key: background }, { candidate_key: ready },
  ], [ready])
  assert.deepEqual(ordered.map((row) => row.candidate_key),
    [ready, background])
})

test("systemic recovery contains no product, SKU, or category special case", () => {
  const source = readFileSync(
    "lib/ebay/ebay-category-authority-runtime-recovery-v1.ts", "utf8")
  const route = readFileSync(
    "app/api/cron/quick-pick-runtime-recovery/route.ts", "utf8")
  const scheduler = readFileSync(
    "supabase/migrations/20260905090044_seller_os_post_only_runtime_dispatch_v1.sql",
    "utf8",
  )
  assert.doesNotMatch(source, /ITEM\d+|VOYAGER|PERFUME|COIN CONDITION/i)
  assert.doesNotMatch(source,
    /publishEbay|createEbayUnpublishedOffer|offerRecreate|withdrawEbay/i)
  assert.match(source, /materializeSellerOsDeterministicFactoryCandidateV1/)
  assert.match(source, /continueLunaQuickPickPostShippingRuntimeV1/)
  assert.match(source, /MAXIMUM_SCAN_ROWS = 100/)
  assert.match(source, /\.eq\("queue_status", "ready"\)/)
  assert.match(source, /\.limit\(250\)/)
  assert.doesNotMatch(source,
    /package_data->categoryResolverV1->semanticCompatibility/)
  assert.match(route, /recoverFalseExactCategoryAuthorityRuntimeV1/)
  assert.match(route, /export async function POST\(/)
  assert.match(route,
    /export function GET\(\)[\s\S]*sellerOsPostOnlyGetResponseV1\(\)/)
  assert.match(scheduler,
    /QUICK_PICK_RUNTIME_RECOVERY[\s\S]*\/api\/cron\/quick-pick-runtime-recovery[\s\S]*20 7 \* \* \*/)
  assert.match(scheduler, /net\.http_post\(/)
})

test("the only exact previously-certified emitter requires semantic proof", () => {
  const factory = readFileSync(
    "lib/ebay/ebay-smart-stocking-durable-factory-v1.ts", "utf8")
  assert.equal((factory.match(/"EXACT_PREVIOUSLY_CERTIFIED_CATEGORY"/g)
    ?? []).length, 1)
  assert.match(factory, /resolverExact && semanticExact \? Object\.freeze/)
  assert.match(factory, /semantic\.familyTypeFingerprint === productTruth/)
})
