import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const {
  assertLifecycleStateContextV1,
  assertListingPackageContextV1,
  assertCategoryResolverBindingContextV1,
  assertTaxonomySnapshotContextV1,
  EBAY_LISTING_CONTEXT_ISOLATION_V1,
} = await import("./ebay-listing-context-isolation-v1.ts")

const item3404 = {
  marketplaceId: "EBAY_US",
  listingPackageId: "11111111-1111-4111-8111-111111111111",
  opportunityId: "22222222-2222-4222-8222-222222222222",
  candidateKey:
    "smart-stocking:EBAY_US:9220837146848:48809648488672",
}

const cake = {
  listingPackageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  opportunityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  candidateKey:
    "smart-stocking:EBAY_US:9220835475680:48809646653664",
}

test("cross-candidate listing package leakage fails closed", () => {
  assert.throws(() => assertListingPackageContextV1({
    expected: item3404,
    listingPackage: {
      id: cake.listingPackageId,
      opportunity_id: cake.opportunityId,
      candidate_key: cake.candidateKey,
    },
  }), /EBAY_LISTING_PACKAGE_CONTEXT_IDENTITY_MISMATCH/)
})

test("stale category or candidate Taxonomy snapshot reuse fails closed", () => {
  const binding = {
    contextBindingVersion: EBAY_LISTING_CONTEXT_ISOLATION_V1,
    marketplaceId: "EBAY_US",
    listingPackageId: item3404.listingPackageId,
    opportunityId: item3404.opportunityId,
    candidateKey: item3404.candidateKey,
    categoryId: "175757",
  }
  assert.doesNotThrow(() => assertTaxonomySnapshotContextV1({
    expected: item3404, taxonomyPreflight: binding, categoryId: "175757",
  }))
  assert.throws(() => assertTaxonomySnapshotContextV1({
    expected: item3404,
    taxonomyPreflight: { ...binding, categoryId: "183335" },
    categoryId: "175757",
  }), /EBAY_LISTING_TAXONOMY_CONTEXT_IDENTITY_MISMATCH/)
  assert.throws(() => assertTaxonomySnapshotContextV1({
    expected: item3404,
    taxonomyPreflight: { ...binding, candidateKey: cake.candidateKey },
    categoryId: "175757",
  }), /EBAY_LISTING_TAXONOMY_CONTEXT_IDENTITY_MISMATCH/)
})

test("category resolver binding cannot cross candidate, package, or preflight", () => {
  const taxonomyPreflight = {
    evidenceDigest: `sha256:${"a".repeat(64)}`,
  }
  const resolver = {
    authorityClass: "SELLER_OS_EBAY_CATEGORY_RESOLVER_V1",
    status: "AUTO_SELECTED",
    resolutionClass: "HIGH_CONFIDENCE",
    contextBindingVersion: EBAY_LISTING_CONTEXT_ISOLATION_V1,
    marketplaceId: "EBAY_US",
    listingPackageId: item3404.listingPackageId,
    opportunityId: item3404.opportunityId,
    candidateKey: item3404.candidateKey,
    selectedCategoryId: "175757",
    learningId: "33333333-3333-4333-8333-333333333333",
    taxonomySnapshotDigest: `sha256:${"b".repeat(64)}`,
    taxonomyPreflightEvidenceDigest: taxonomyPreflight.evidenceDigest,
  }
  assert.doesNotThrow(() => assertCategoryResolverBindingContextV1({
    expected: item3404,
    categoryResolver: resolver,
    taxonomyPreflight,
    categoryId: "175757",
  }))
  assert.throws(() => assertCategoryResolverBindingContextV1({
    expected: item3404,
    categoryResolver: { ...resolver, candidateKey: cake.candidateKey },
    taxonomyPreflight,
    categoryId: "175757",
  }), /EBAY_CATEGORY_RESOLVER_CONTEXT_IDENTITY_MISMATCH/)
  assert.throws(() => assertCategoryResolverBindingContextV1({
    expected: item3404,
    categoryResolver: resolver,
    taxonomyPreflight: { evidenceDigest: `sha256:${"c".repeat(64)}` },
    categoryId: "175757",
  }), /EBAY_CATEGORY_RESOLVER_CONTEXT_IDENTITY_MISMATCH/)
})

test("Offer and publication state from another package never enters ITEM3404", () => {
  assert.throws(() => assertLifecycleStateContextV1({
    expected: item3404,
    approval: {
      id: "33333333-3333-4333-8333-333333333333",
      listing_package_id: cake.listingPackageId,
      opportunity_id: cake.opportunityId,
      candidate_key: cake.candidateKey,
    },
    execution: {
      id: "44444444-4444-4444-8444-444444444444",
      approval_id: "33333333-3333-4333-8333-333333333333",
      listing_package_id: cake.listingPackageId,
      opportunity_id: cake.opportunityId,
      offer_id: "247475747011",
    },
  }), /EBAY_DRAFT_ONLY_CONTEXT_IDENTITY_MISMATCH/)
})

test("Taxonomy cache identity includes marketplace and category", () => {
  const gateway = readFileSync(
    "lib/ebay/ebay-seller-keyword-demand-gateway.ts", "utf8")
  assert.match(gateway,
    /return `marketplace:\$\{input\.marketplaceId\}:\$\{identity\}`/)
  assert.match(gateway,
    /marketplaceId: MARKETPLACE_ID,[\s\S]*categoryId: normalizedKnownCategory/)
})

test("Workspace and draft lifecycle wire the exact context guards", () => {
  const workspace = readFileSync(
    "app/admin/ebay/listing-workspace/page.tsx", "utf8")
  const draftRoute = readFileSync(
    "app/api/admin/ebay/draft-only/route.ts", "utf8")
  const commandCenter = readFileSync(
    "app/api/admin/ebay/command-center/route.ts", "utf8")
  assert.match(workspace, /taxonomySnapshotMatchesContextV1/)
  assert.match(workspace,
    /packageId=.*opportunityId=.*candidateKey=/)
  assert.match(draftRoute, /assertListingPackageContextV1/)
  assert.match(draftRoute, /assertTaxonomySnapshotContextV1/)
  assert.match(draftRoute, /assertLifecycleStateContextV1/)
  assert.match(commandCenter, /taxonomySnapshotMatchesContextV1/)
})
