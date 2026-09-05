import assert from "node:assert/strict"
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
  projectQuickPickPublisherPackageRecoveryV1,
  recoverQuickPickPublisherPackagesV1,
} = await import("./ebay-quick-pick-publisher-package-recovery-v1.ts")
const { canonicalApprovedLunaImageUrlsV1 } = await import(
  "./luna-supplier-image-auto-runtime-v1.ts")

const candidateKey = `sha256:${"a".repeat(64)}`
const card = {
  candidateKey,
  opportunityId: "11111111-1111-4111-8111-111111111111",
  listingPackageId: "22222222-2222-4222-8222-222222222222",
  state: "READY",
  disposition: "MARKET_TEST_READY",
  marketTestReady: true,
  alreadyLive: false,
  ownerTruePublicationBlockers: [],
  listingReview: {
    finalListingPackageReady: true,
    packageDigest: `sha256:${"b".repeat(64)}`,
    title: "Exact product",
    description: "Exact description",
    category: { id: "123", name: "Exact category" },
    condition: { id: "1000", label: "New" },
    itemSpecifics: { Brand: "Unbranded" },
    shipping: { amount: 6.99, currency: "USD",
      source: "DURABLE_LUNA_SHIPPING_EVIDENCE" },
    dollarCheck: { supplierCost: 5, targetPrice: 24.99,
      ebayFees: 4.2, shipping: 6.99, expectedContribution: 8.8,
      expectedMargin: 35.21, expectedRoi: 176,
      breakEvenPrice: 16.19, minimumProfitablePrice: 19.99,
      evidenceClass: "MARKET_TEST_MINIMUM_MARGIN_SAFE_PRICE" },
    supportedPriceBand: { status: "UNPROVEN" },
    authorizationBinding: { packageId:
      "22222222-2222-4222-8222-222222222222", quantity: 1,
    imageCount: 1 },
    publishAuthorizationHandoff: { ownerPublicationDecisionReady: true },
    runtimeMaterialization: { materialPackageCurrent: false,
      persistedCommercialEconomicsComplete: false,
      ownerActionPathAvailable: false },
  },
}

test("only a complete projected package is generically retry eligible", () => {
  const result = projectQuickPickPublisherPackageRecoveryV1(card)
  assert.equal(result.eligible, true)
  assert.equal(result.reasonCode,
    "DOWNSTREAM_COMMERCIAL_PACKAGE_NOT_CURRENT")
  assert.equal(projectQuickPickPublisherPackageRecoveryV1({ ...card,
    listingReview: { ...card.listingReview,
      finalListingPackageReady: false } }).eligible, false)
})

test("preauthorization image recovery projects approved asset URLs canonically", () => {
  assert.deepEqual(canonicalApprovedLunaImageUrlsV1([
    { public_url: " https://img.test/first.jpg " },
    { public_url: "https://img.test/second.jpg" },
    { public_url: "https://img.test/first.jpg" },
    { public_url: null },
  ]), [
    "https://img.test/first.jpg",
    "https://img.test/second.jpg",
  ])
})

test("runtime uses optimistic single-flight and creates no owner authority", async () => {
  const updates = []
  const query = {
    select() { return this }, eq() { return this }, is() { return this },
    maybeSingle: async () => ({ data: {
      id: card.listingPackageId, opportunity_id: card.opportunityId,
      candidate_key: candidateKey, account_key: "account", created_by: null,
      updated_at: "2026-09-05T10:00:00.000Z",
      package_data: { imageUrls: ["https://img.test/1.jpg"] },
    }, error: null }),
    update(value) { updates.push(value); return {
      eq() { return this }, is() { return this }, select() { return this },
      maybeSingle: async () => ({ data: { id: card.listingPackageId,
        package_data: value.package_data }, error: null }),
    } },
  }
  const supabase = { from: (table) => [
      "seller_os_publisher_batch_children_v1",
      "seller_os_publisher_batch_authorizations_v1",
    ].includes(table)
    ? { select() { return this }, eq() { return this }, in() { return this },
      limit() { return this },
      maybeSingle: async () => ({ data: null, error: null }) }
    : query }
  const result = await recoverQuickPickPublisherPackagesV1({
    supabase, accountKey: "account",
    actorUserId: "33333333-3333-4333-8333-333333333333",
    now: new Date("2026-09-05T10:01:00.000Z"),
    dependencies: { readCards: async () => [card],
      readCandidate: async () => card,
      ensureImages: async ({ packageRow }) => ({ listingPackage: {
        ...packageRow, package_data: { ...packageRow.package_data,
          supplierImageReadiness: { imageReady: true } } } }) },
  })
  assert.equal(result.status, "PASS")
  assert.equal(result.rematerializedPackageCount, 1)
  assert.equal(result.optimisticSingleFlight, true)
  assert.equal(result.ownerAuthorizationCreatedCount, 0)
  assert.equal(result.marketplaceWrites, 0)
  const materialization = updates.find((entry) => entry.package_data)
  assert.equal(materialization.package_data.quickPickOwnerReviewV1, undefined)
})
